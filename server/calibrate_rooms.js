#!/usr/bin/env node
/**
 * 房态数据校准引擎（自动化任务）
 * ---------------------------------------------------------------
 * 比对「订单主表」(room_orders) 与「房态日历矩阵」(由订单派生，见 RoomState.unitStatusOn)，
 * 检测并自动修正三类状态不一致：
 *   1) 在住越界：订单 status=在住，但今日不在其 [入住,退房) 区间内
 *      → 日历该单元显示为可售/空置，与「在住」矛盾
 *      → 修正：今日<入住 → 待入住；今日>=退房 → 已退房（并补打扫标记）
 *   2) 整租未锁定子房：整租订单与同套房子房上的其他订单时间重叠（双重占用）
 *      → 修正：取消侵入方（较晚创建的订单 / 分租单），释放子房
 *   3) 退房后未释放房态：已退房订单缺少退房日打扫标记，房态未闭环
 *      → 修正：补打扫标记，确保工作看板一致
 *
 * 所有修正写入操作日志，来源统一标记为「自动化校准」。
 * 若两端一致则不改订单/日历，仅追加一条「巡检成功」日志。
 *
 * 用法：
 *   node server/calibrate_rooms.js            # 真实运行（写入 KV）
 *   node server/calibrate_rooms.js --dry-run  # 只读，不写 KV
 *   node server/calibrate_rooms.js --selftest # 用合成数据校验逻辑，不写 KV
 */

'use strict';
const fs = require('fs');
const path = require('path');

const KV_FILE = process.env.KV_FILE || path.join(__dirname, 'kv_store.json');
// 命名空间：云端登录账号优先；CloudStudio mock 部署为 local
const PRIMARY = '1390343237@shturl.';
const SECONDARY = 'local';

// 与 roomstate.js 的 SUITES 保持一致
const SUITES = [
  { id:'401',  attr:'divide_only', subRooms:['1','2','3','4'] },
  { id:'1302', attr:'both',        subRooms:['5','6'] },
  { id:'407',  attr:'both',        subRooms:['7','8'] },
  { id:'1502', attr:'divide_only', subRooms:['9','10','11','12'] },
  { id:'503',  attr:'both',        subRooms:['15','16'] },
  { id:'1202', attr:'whole_only',  subRooms:[] }
];

// ── 日期工具（统一按 GMT+8 处理，与宿主时区一致） ──────────────
function todayStr() {
  const now = new Date();
  const sh = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
  return fmtUTC(sh);
}
function toDate(d) { const [y, m, da] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, da, 12, 0, 0)); }
function fmtUTC(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDays(d, n) { const dt = toDate(d); dt.setUTCDate(dt.getUTCDate() + n); return fmtUTC(dt); }
function overlap(aS, aE, bS, bE) { return aS < bE && bS < aE; } // 半开区间

function suiteOf(roomId) {
  for (const s of SUITES) {
    if (s.subRooms.includes(String(roomId))) return s;
    if (s.id === String(roomId)) return s;
  }
  return null;
}

// ── 派生房态（与修正后的引擎一致：排除 已取消 与 已退房） ────────
function expectedStatus(unitId, date, orders, cleaning, today) {
  const active = orders.filter(o => o.status !== '已取消' && o.status !== '已退房');
  for (const o of active) {
    if (o.type !== '整租') continue;
    const s = suiteOf(o.room); if (!s) continue;
    const locked = s.subRooms.length ? s.subRooms.includes(unitId) : (o.room === unitId);
    if (locked && overlap(o.checkIn, o.checkOut, date, addDays(date, 1))) return 'whole';
  }
  for (const o of active) {
    if (o.type === '整租') continue;
    if (String(o.subRoom != null ? o.subRoom : o.room) !== unitId) continue;
    if (overlap(o.checkIn, o.checkOut, date, addDays(date, 1))) return date > today ? 'reserved' : 'occupied';
  }
  if (cleaning.some(c => c.unit === unitId && c.date === date)) return 'clean';
  return 'vacant';
}

// ── 核心校准逻辑 ────────────────────────────────────────────────
/**
 * @returns {{orders:Array, cleaning:Array, fixes:Array, summary:Object}}
 */
function reconcile(orders, cleaning, today) {
  orders = orders.map(o => ({ ...o }));
  cleaning = cleaning.map(c => ({ ...c }));
  const fixes = [];

  const subUnit = (o) => o.type === '整租' ? o.room : o.room; // 与 RoomState.checkOut 一致：unit = order.room
  const ensureCleaning = (unit, date) => {
    if (!cleaning.some(c => c.unit === unit && c.date === date)) {
      cleaning.push({ unit, date });
      return true;
    }
    return false;
  };

  // —— P1：在住越界 ——
  for (const o of orders) {
    if (o.status !== '在住') continue;
    const inWin = o.checkIn <= today && today < o.checkOut;
    if (inWin) continue; // 今日确实在住，日历应为 occupied，一致
    let target, reason;
    if (today < o.checkIn) {
      target = '待入住';
      reason = '在住订单的入住日期仍在未来，日历该单元为可售状态，状态回退为待入住';
    } else {
      target = '已退房';
      reason = '在住订单已超过退房日期，房态应释放，自动办理退房';
    }
    const before = o.status;
    o.status = target;
    if (target === '已退房') {
      const added = ensureCleaning(subUnit(o), o.checkOut);
      fixes.push({
        type: '在住状态越界', orderId: o.id, room: o.room, type2: o.type,
        before, after: target, changeRange: `${o.checkIn}~${o.checkOut}`,
        reason, cleaningAdded: added
      });
    } else {
      fixes.push({
        type: '在住状态越界', orderId: o.id, room: o.room, type2: o.type,
        before, after: target, changeRange: `${o.checkIn}~${o.checkOut}`,
        reason, cleaningAdded: false
      });
    }
  }

  // —— P2：整租未锁定子房（整租 vs 其它订单重叠） ——
  const activeForP2 = orders.filter(o => o.status !== '已取消' && o.status !== '已退房');
  for (const whole of activeForP2) {
    if (whole.type !== '整租') continue;
    const s = suiteOf(whole.room);
    if (!s || !s.subRooms.length) continue;
    for (const sub of s.subRooms) {
      const intruders = activeForP2.filter(o =>
        o.id !== whole.id &&
        String(o.subRoom != null ? o.subRoom : o.room) === sub &&
        overlap(o.checkIn, o.checkOut, whole.checkIn, whole.checkOut)
      );
      for (const it of intruders) {
        // 取消侵入方（整租优先；同级取较晚创建者）
        const createdIt = it.createdAt || '';
        const createdWhole = whole.createdAt || '';
        const cancel = (it.type === '整租' && createdIt > createdWhole) ? it : (it.type === '分租' ? it : null);
        if (!cancel) continue;
        const idx = orders.findIndex(x => x.id === cancel.id);
        if (idx === -1 || orders[idx].status === '已取消') continue;
        orders[idx] = { ...orders[idx], status: '已取消', cancelReason: '自动化校准：与整租订单冲突，子房未释放' };
        fixes.push({
          type: '整租未锁定子房', orderId: cancel.id, room: cancel.room, type2: cancel.type,
          before: cancel.status, after: '已取消',
          changeRange: `${cancel.checkIn}~${cancel.checkOut}`,
          reason: `整租订单 ${whole.room} (${whole.checkIn}~${whole.checkOut}) 已占用子房 ${sub}，自动取消重叠的${cancel.type}订单`,
          cleaningAdded: false
        });
      }
    }
  }

  // —— P3：退房后未释放（补打扫标记，闭合房态） ——
  for (const o of orders) {
    if (o.status !== '已退房') continue;
    const added = ensureCleaning(subUnit(o), o.checkOut);
    if (added) {
      fixes.push({
        type: '退房未释放房态', orderId: o.id, room: o.room, type2: o.type,
        before: '（无打扫标记）', after: '已补打扫标记',
        changeRange: o.checkOut,
        reason: `已退房订单缺少退房日(${o.checkOut})打扫标记，已补以便工作看板闭环`,
        cleaningAdded: true
      });
    }
  }

  // 去重 cleaning（按 unit+date）
  const seen = new Set();
  cleaning = cleaning.filter(c => {
    const k = c.unit + '@' + c.date;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const summary = {
    scanned: orders.length,
    fixed: fixes.length,
    byType: fixes.reduce((m, f) => { m[f.type] = (m[f.type] || 0) + 1; return m; }, {})
  };
  return { orders, cleaning, fixes, summary };
}

// ── KV 读写 ────────────────────────────────────────────────────
function loadKV() {
  try { return JSON.parse(fs.readFileSync(KV_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function saveKV(data) { fs.mkdirSync(path.dirname(KV_FILE), { recursive: true }); fs.writeFileSync(KV_FILE, JSON.stringify(data, null, 2), 'utf8'); }

function pickNamespace(kv) {
  if (kv[PRIMARY + ':room_orders'] !== undefined) return PRIMARY;
  if (kv[SECONDARY + ':room_orders'] !== undefined) return SECONDARY;
  return null;
}
function existingNamespaces(kv) {
  const set = new Set();
  for (const ns of [PRIMARY, SECONDARY]) {
    if (kv[ns + ':room_orders'] !== undefined || kv[ns + ':room_logs'] !== undefined || kv[ns + ':room_cleaning'] !== undefined) set.add(ns);
  }
  return set;
}

function newLogId() { return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const selfTest = args.includes('--selftest');

  if (selfTest) return runSelfTest();

  const today = todayStr();
  const kv = loadKV();
  const ns = pickNamespace(kv);

  let orders = ns ? (kv[ns + ':room_orders'] || []) : [];
  let cleaning = ns ? (kv[ns + ':room_cleaning'] || []) : [];
  const existingLogs = ns ? (kv[ns + ':room_logs'] || []) : (kv[PRIMARY + ':room_logs'] || kv[SECONDARY + ':room_logs'] || []);

  const { orders: newOrders, cleaning: newCleaning, fixes, summary } = reconcile(orders, cleaning, today);

  // 写入日志（追加，仅保留最近 2000 条）
  let logs = existingLogs.slice();
  if (fixes.length > 0) {
    for (const f of fixes) {
      logs.push({
        id: newLogId(), ts: new Date().toISOString(), opType: '自动化校准',
        room: f.room, guest: '', changeRange: f.changeRange || '',
        before: f.before, after: f.after, source: '自动化校准', detail: f.reason
      });
    }
  } else {
    logs.push({
      id: newLogId(), ts: new Date().toISOString(), opType: '自动化校准',
      room: '—', guest: '', changeRange: '', before: '', after: '一致',
      source: '自动化校准', detail: '订单主表与房态日历矩阵比对一致，本周期无需修正'
    });
  }
  logs = logs.slice(-2000);

  if (!dryRun) {
    const targets = ns ? new Set([ns, ...existingNamespaces(kv)]) : new Set([PRIMARY, ...existingNamespaces(kv)]);
    // 不向「从未有过订单」的命名空间写入空 room_orders（避免触发演示播种）；仅写日志
    for (const t of targets) {
      // 日志：所有目标命名空间都记录
      kv[t + ':room_logs'] = logs;
      // 订单/打扫：仅当该命名空间本来就持有 room_orders 时才回写
      if (kv[t + ':room_orders'] !== undefined) {
        kv[t + ':room_orders'] = (t === ns) ? newOrders : (kv[t + ':room_orders'] || []);
        kv[t + ':room_cleaning'] = (t === ns) ? newCleaning : (kv[t + ':room_cleaning'] || []);
      }
    }
    saveKV(kv);
  }

  const report = buildReport(today, ns, summary, fixes, dryRun);
  console.log(report.text);
  if (!dryRun) fs.writeFileSync(path.join(__dirname, '..', 'data', 'calibration_last.md'), report.md, 'utf8');
  return report;
}

function buildReport(today, ns, summary, fixes, dryRun) {
  const head = `【房态数据校准】${today} ${dryRun ? '(dry-run)' : ''}\n命名空间：${ns || '(无订单数据，写入 ' + PRIMARY + ')'}\n扫描订单：${summary.scanned} 条`;
  let body;
  if (summary.fixed === 0) {
    body = `结果：✅ 巡检成功，订单主表与房态日历矩阵一致，无需修正。`;
  } else {
    const lines = fixes.map((f, i) =>
      `  ${i + 1}. [${f.type}] ${f.type2} ${f.room} 单号${f.orderId}\n     变更：${f.before} → ${f.after}（${f.changeRange}）\n     原因：${f.reason}`
    );
    body = `结果：🔧 发现 ${summary.fixed} 处不一致，已自动修正：\n` + lines.join('\n');
  }
  const text = `${head}\n${body}`;
  const md = `# 房态数据校准报告\n\n- **运行时间**：${today} ${dryRun ? '（dry-run，未写入）' : ''}\n- **命名空间**：${ns || '(无订单数据)'}\n- **扫描订单数**：${summary.scanned}\n- **修正项数**：${summary.fixed}\n- **分类统计**：${JSON.stringify(summary.byType)}\n\n## 结论\n\n${summary.fixed === 0 ? '✅ 巡检成功：订单主表与房态日历矩阵一致，本周期无需修正。' : '🔧 已自动修正以下不一致（来源：自动化校准）：'}\n\n${fixes.map((f, i) => `${i + 1}. **[${f.type}]** ${f.type2} ${f.room}（单号 ${f.orderId}）\n   - 变更：${f.before} → ${f.after}（区间 ${f.changeRange}）\n   - 原因：${f.reason}`).join('\n\n')}\n`;
  return { text, md };
}

// ── 自测：合成不一致数据，校验逻辑（不写 KV） ───────────────────
function runSelfTest() {
  const today = '2026-08-04';
  const orders = [
    { id:'O-A', room:'407',  type:'整租', subRoom:'407', checkIn:'2026-08-01', checkOut:'2026-08-03', status:'在住', createdAt:'2026-08-01T10:00:00Z' },
    { id:'O-B', room:'5',    type:'分租', subRoom:'5',   checkIn:'2026-08-10', checkOut:'2026-08-12', status:'在住', createdAt:'2026-08-02T10:00:00Z' },
    { id:'O-C', room:'1302', type:'整租', subRoom:'1302',checkIn:'2026-08-05', checkOut:'2026-08-08', status:'待入住', createdAt:'2026-08-03T10:00:00Z' },
    { id:'O-D', room:'5',    type:'分租', subRoom:'5',   checkIn:'2026-08-05', checkOut:'2026-08-08', status:'待入住', createdAt:'2026-08-04T10:00:00Z' },
    { id:'O-E', room:'9',    type:'分租', subRoom:'9',   checkIn:'2026-07-30', checkOut:'2026-08-02', status:'已退房', createdAt:'2026-07-29T10:00:00Z' },
    { id:'O-F', room:'15',   type:'分租', subRoom:'15',  checkIn:'2026-08-04', checkOut:'2026-08-06', status:'在住', createdAt:'2026-08-03T10:00:00Z' } // 一致，不应改动
  ];
  const cleaning = [];
  const { orders: no, cleaning: nc, fixes, summary } = reconcile(orders, cleaning, today);
  console.log('=== 自测 ===');
  console.log('扫描订单：', summary.scanned, ' 修正项：', summary.fixed);
  console.log('分类：', JSON.stringify(summary.byType));
  fixes.forEach((f, i) => console.log(`  ${i + 1}. [${f.type}] ${f.type2} ${f.room} ${f.before}→${f.after} (${f.changeRange})`));
  console.log('修正后订单状态：', no.map(o => `${o.id}:${o.status}`).join(', '));
  console.log('打扫标记：', JSON.stringify(nc));
  // 断言
  const assert = (cond, msg) => { if (!cond) { console.error('❌ 断言失败：', msg); process.exit(1); } };
  assert(no.find(o => o.id === 'O-A').status === '已退房', 'O-A 应退房');
  assert(no.find(o => o.id === 'O-B').status === '待入住', 'O-B 应回退待入住');
  assert(no.find(o => o.id === 'O-D').status === '已取消', 'O-D 整租冲突应取消');
  assert(no.find(o => o.id === 'O-F').status === '在住', 'O-F 一致不动');
  assert(nc.some(c => c.unit === '407' && c.date === '2026-08-03'), 'O-A 退房日应补打扫');
  assert(nc.some(c => c.unit === '9' && c.date === '2026-08-02'), 'O-E 退房日应补打扫');
  console.log('✅ 自测全部断言通过');
}

if (require.main === module) main();

module.exports = { reconcile, expectedStatus, suiteOf, todayStr, addDays, overlap };
