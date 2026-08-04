/* ====================================================================
   app.js - 启动器 / 登录闸门 / 云端拉取 / 路由分发 / 全局初始化
   ==================================================================== */

// 云端绑定账号（与需求一致）
const CLOUD_ACCOUNT = '1390343237@shturl.';
const CLOUD_PASS    = 'Yuxin2026!';

(async function() {
  // 初始化图标
  if (window.lucide) lucide.createIcons();

  bindLogin();

  // 提醒按钮（即使未登录也可点击查看本地提醒）
  document.getElementById('notifBell')?.addEventListener('click', () => {
    const list = Notify.getAll();
    const body = list.length === 0
      ? '<div class="empty-state">暂无未读提醒</div>'
      : '<ul class="space-y-2">' + list.slice(0, 10).map(n =>
          `<li class="surface-card p-3"><div class="text-xs text-ink-300">${n.ts || ''}</div><div class="text-sm">${n.title || n.message}</div></li>`
        ).join('') + '</ul>';
    Notify.modal({
      title: '提醒中心',
      body: body,
      primary: '知道了',
      onPrimary: () => Notify.markAllRead()
    });
  });
})();

/* ====================================================================
   登录闸门
   ==================================================================== */
function bindLogin() {
  const gate = document.getElementById('loginGate');
  const btn  = document.getElementById('loginBtn');
  const acc  = document.getElementById('loginAccount');
  const pass = document.getElementById('loginPass');
  if (!gate || !btn) return;

  // 已会话过则直接进
  if (sessionStorage.getItem('yxz_logged_in') === '1') {
    gate.classList.add('hidden');
    boot();
    return;
  }

  const submit = () => {
    const a = (acc.value || '').trim();
    const p = pass.value || '';
    if (!a || !p) {
      Notify.toast('请输入云端账号与访问口令', 'warn');
      return;
    }
    // 校验绑定账号（区分大小写，要求与需求一致）
    if (a !== CLOUD_ACCOUNT || p !== CLOUD_PASS) {
      Notify.toast('账号或口令不正确', 'danger');
      return;
    }
    // 设置云端身份（用于 KV 命名空间隔离）
    window.__ACCOUNT__ = a;
    sessionStorage.setItem('yxz_logged_in', '1');
    gate.classList.add('hidden');
    boot();
  };

  btn.addEventListener('click', submit);
  pass.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  acc.addEventListener('keydown', e => { if (e.key === 'Enter') pass.focus(); });
}

/* ====================================================================
   启动主流程（登录后）
   ==================================================================== */
async function boot() {
  try {
    await _boot();
  } catch (e) {
    console.error('[boot] 致命错误，降级为 mock 模式继续:', e);
    if (window.Sheet) Sheet.MOCK = true;
    try { await _boot(); } catch (e2) {
      console.error('[boot] 二次启动仍失败:', e2);
      const root = document.getElementById('app');
      if (root) root.innerHTML = `<div class="empty-state">启动失败：${e2.message}<br><span class="text-xs text-ink-300 mt-2 block">F12 → Console 查看详细堆栈</span></div>`;
    }
  }
}

async function _boot() {
  // 读取用户配置的云端代理（如房态真同步代理、AI 后端）
  const savedSheetApi = Store.get('yxz_sheet_api', '');
  if (savedSheetApi) window.__SHEET_API__ = savedSheetApi;
  if (window.Sheet) { Sheet.API_BASE = window.__SHEET_API__ || ''; }

  // 先拉取云端数据（经代理 KV；失败静默回退本地）
  try {
    const kvReachable = await SyncBadge.probe();
    if (kvReachable) {
      const ok = await Store.cloudPull();
      SyncBadge.set(ok ? 'kv_doc_ok' : 'local_only');
    } else {
      SyncBadge.set('local_only');
    }
  } catch (e) {
    SyncBadge.set('local_only');
  }

  // 探测腾讯文档连接
  await Sheet.probe();
  console.log(`[app] Sheet mode: ${Sheet.MOCK ? 'mock' : 'live'}`);

  // 确保两个新 sheet 存在（文档留痕）
  await Sheet.addSheet('订单同步明细');
  await Sheet.addSheet('工作台操作日志');

  // 本地演示账号且账本为空时，播种示例记账（让图表开箱可见；云端账号不播种）
  seedDemoData();

  // 房态模块：确保文档 5 个 Sheet 存在 + 本地账号播种示例订单
  await RoomState.ensureSheets().catch(() => {});
  seedRoomData();

  // 导航交互
  const navToggle = document.getElementById('navToggle');
  const sideNav   = document.getElementById('sideNav');
  const navMask   = document.getElementById('navMask');
  navToggle?.addEventListener('click', () => {
    sideNav.classList.toggle('-translate-x-full');
    navMask.classList.toggle('hidden');
  });
  navMask?.addEventListener('click', () => {
    sideNav.classList.add('-translate-x-full');
    navMask.classList.add('hidden');
  });

  // 启动路由
  Router.start();

  // 路由分发
  Router.on(async (path) => {
    const meta = Router.routes[path];
    const root = document.getElementById('app');
    if (!meta) {
      root.innerHTML = '<div class="empty-state">页面不存在</div>';
      return;
    }
    // 权限角色校验（RBAC）：越权模块拒绝访问
    if (!Router.canAccess(path)) {
      root.innerHTML = `
        <div class="empty-state">
          <i data-lucide="lock" class="w-10 h-10 text-ink-300 mx-auto mb-3"></i>
          <div class="text-lg text-ink-500 font-medium">无访问权限</div>
          <div class="text-sm text-ink-400 mt-1">当前角色「${Router.role() === 'owner' ? '主理人' : Router.role() === 'family' ? '家属' : '临时访客'}」无权访问「${meta.name}」。</div>
          <div class="text-xs text-ink-300 mt-2">如需调整，请主理人在「设置 → 权限设置」中切换角色。</div>
        </div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }
    root.innerHTML = '<div class="text-center text-ink-300 py-20"><div class="inline-block animate-pulse">加载中…</div></div>';
    const mod = window[meta.module];
    if (!mod || typeof mod.render !== 'function') {
      root.innerHTML = `<div class="empty-state">模块【${meta.module}】未实现</div>`;
      return;
    }
    try {
      // 8s 安全网：避免某个 await 永远挂起
      await Promise.race([
        mod.render(root),
        new Promise((_, rej) => setTimeout(() => rej(new Error('render 超时（8s）——某次 fetch/await 挂死')), 8000))
      ]);
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      console.error('render error', e, 'stack:', e.stack);
      root.innerHTML = `<div class="empty-state"><div class="text-clay-600 font-medium">加载失败：${e.message}</div><div class="text-xs text-ink-300 mt-2 max-w-md mx-auto whitespace-pre-wrap text-left">${(e.stack || '').split('\n').slice(0,4).join('\n')}</div><div class="text-xs text-ink-300 mt-3">打开浏览器 DevTools (F12) → Console 查看完整堆栈</div></div>`;
    }
  });

  // 初次渲染当前路由（确保首屏渲染）
  Router.reload();

  // 角色权限：按当前角色隐藏越权导航项
  window.applyRoleNav = function() {
    const lvl = Router.roleLevel();
    document.querySelectorAll('.nav-item[data-minrole]').forEach(el => {
      const min = Number(el.dataset.minrole || 1);
      el.style.display = (lvl >= min) ? '' : 'none';
    });
  };
  window.applyRoleNav();

  // 文档后台改 → 前端即时刷新（轮询）
  startDocPolling();

  // 启动时扫描当日提醒
  setTimeout(() => scanDailyReminders(), 800);
}

// === 首次运行播种示例记账（仅本地演示账号、账本为空时） ===
function seedDemoData() {
  if (window.__ACCOUNT__ && window.__ACCOUNT__ !== 'local') return;
  if (Store.ledger().length > 0) return;
  const t = DateUtil.today();
  const d = (n) => DateUtil.fmt(DateUtil.addDays(t, -n));
  const seed = [
    [d(92),'餐饮','午餐·小区面馆',-68,false],
    [d(84),'购物','夏季衣物',-329,true],
    [d(75),'居住','房租',-1200,false],
    [d(66),'交通','地铁+打车',-120,false],
    [d(60),'工资','月度工资',8600,false],
    [d(55),'餐饮','周末聚餐',-95,false],
    [d(45),'娱乐','电影+奶茶',-199,true],
    [d(38),'医疗','体检挂号',-460,false],
    [d(33),'居住','房租',-1200,false],
    [d(30),'工资','月度工资',8600,false],
    [d(24),'餐饮','买菜',-210,false],
    [d(16),'购物','护肤品',-688,true],
    [d(9),'交通','高铁票',-240,false],
    [d(3),'餐饮','外卖',-156,false],
    [d(2),'娱乐','视频会员',-88,true],
    [d(1),'餐饮','早餐',-32,false]
  ];
  seed.forEach(([date, cat, note, amount, needless]) => {
    Store.addLedger({ date, cat, note, amount, needless });
  });
}

/* ====================================================================
   数据同步状态（v1 升级：3 状态徽章 + 写入回执）
   - 状态 A: kv_doc_ok    = 已落 KV + 文档同步成功
   - 状态 B: kv_only      = 已落 KV + 文档同步失败（不阻塞）
   - 状态 C: local_only   = 仅本地（代理离线）
   - 状态 D: syncing      = 正在同步
   ==================================================================== */
const SyncBadge = {
  state: 'local_only',  // 初始假设本地
  lastWrite: null,       // {ts, kvOk, docOk}
  lastPoll: null,        // ts
  timer: null,

  // 状态→文案+颜色
  _meta(s) {
    return {
      kv_doc_ok:  { text: '✓ 已落 KV + 已落文档',  dot: 'bg-sage-500',    wrap: 'text-sage-600' },
      kv_only:    { text: '✓ 落 KV · ⚠ 文档失败', dot: 'bg-clay-400',    wrap: 'text-clay-600' },
      local_only: { text: '⚠ 仅本地（代理离线）',   dot: 'bg-ink-300',     wrap: 'text-ink-400' },
      syncing:    { text: '↻ 同步中…',             dot: 'bg-blue-400 animate-pulse', wrap: 'text-blue-500' }
    }[s] || { text: s, dot: 'bg-ink-300', wrap: 'text-ink-400' };
  },

  set(state) {
    this.state = state;
    this.render();
  },

  setWriteResult(kvOk, docOk) {
    this.lastWrite = { ts: Date.now(), kvOk, docOk };
    if (kvOk && docOk) this.set('kv_doc_ok');
    else if (kvOk) this.set('kv_only');
    else this.set('local_only');
  },

  setPollTick() { this.lastPoll = Date.now(); this.render(); },

  render() {
    const el = document.getElementById('syncText');
    const dot = document.querySelector('#syncStatus .w-1\\.5');
    if (!el) return;
    const m = this._meta(this.state);
    el.textContent = m.text;
    el.className = m.wrap;
    if (dot) dot.className = `w-1.5 h-1.5 rounded-full ${m.dot}`;

    // 工具提示：显示最近一次写操作的回执
    const wrap = document.getElementById('syncStatus');
    if (wrap && this.lastWrite) {
      const ago = Math.round((Date.now() - this.lastWrite.ts) / 1000);
      wrap.title = `最近写：${ago}秒前 · KV ${this.lastWrite.kvOk ? '✓' : '✗'} · 文档 ${this.lastWrite.docOk ? '✓' : '✗'}`;
    }
  },

  // 启动时探测 KV 代理是否可达
  async probe() {
    const base = (typeof window !== 'undefined' && window.__SHEET_API__) || '';
    if (!base) { this.set('local_only'); return false; }
    try {
      const r = await fetch(base + '/health', { method: 'GET' });
      if (r.ok) { this.set('local_only'); /* KV 通但还没写，先显示本地 */ return true; }
      this.set('local_only');
      return false;
    } catch { this.set('local_only'); return false; }
  }
};
window.SyncBadge = SyncBadge;

function setSyncStatus(text, ok) {
  // 兼容旧调用：转给 SyncBadge
  SyncBadge.set(ok ? 'kv_doc_ok' : 'local_only');
  const el = document.getElementById('syncText');
  if (el && text) el.textContent = text;
}

// === 房态模块：本地演示账号且订单为空时，播种示例订单（云端账号不播种） ===
function seedRoomData() {
  if (window.__ACCOUNT__ && window.__ACCOUNT__ !== 'local') return;
  if (Store.list('room_orders').length > 0) return;
  const t = DateUtil.today();
  const d = (n) => DateUtil.fmt(DateUtil.addDays(t, n));
  const seed = [
    { room:'407',  type:'整租', checkIn:d(6),  checkOut:d(8),  nights:2, total:760,  guest:'张先生', phone:'', status:'待入住', payStatus:'已收款', note:'NL 示例订单' },
    { room:'5',    type:'分租', checkIn:d(1),  checkOut:d(4),  nights:3, total:420,  guest:'李女士', phone:'', status:'在住',   payStatus:'已收款', note:'' },
    { room:'9',    type:'分租', checkIn:d(2),  checkOut:d(5),  nights:3, total:360,  guest:'王同学', phone:'', status:'待入住', payStatus:'未收款', note:'' },
    { room:'1',    type:'分租', checkIn:t,      checkOut:d(2),  nights:2, total:260,  guest:'赵先生', phone:'', status:'在住',   payStatus:'部分收款', note:'' },
    { room:'1202', type:'整租', checkIn:d(11), checkOut:d(14), nights:3, total:1100, guest:'某科技公司', phone:'', status:'待入住', payStatus:'未收款', note:'团队团建' }
  ];
  const orders = seed.map(s => ({
    id: RoomState._newId(), subRoom: s.room, customerSource: s.guest, createdAt: new Date().toISOString(), ...s
  }));
  Store.set('room_orders', orders);
}

// === 文档后台改 → 前端即时刷新（v1 升级：30 分钟轮询 + SyncBadge 状态） ===
function startDocPolling() {
  if (Sheet.MOCK) return; // 仅在代理 live 模式下轮询真实文档
  const DOC_ROUTES = { 'biz/rooms': 1, 'biz/bnb': 1, 'biz/media': 1 };
  let last = 0;
  // v1 spec：30 分钟轮询一次（文档后台改 → 前端即时刷新）
  setInterval(() => {
    const path = Router.getCurrent();
    if (!DOC_ROUTES[path]) return;
    // 避免打断弹窗或正在输入
    if (document.querySelector('.modal-backdrop') ||
        document.querySelector('input:focus, textarea:focus, [contenteditable="true"]')) return;
    const now = Date.now();
    // 30 分钟 = 1_800_000 ms（保留 60s 起步间隔作为启动后立即拉一次的窗口）
    if (now - last < 60_000) return;
    last = now;
    Router.reload();
    if (window.SyncBadge) SyncBadge.setPollTick();
  }, 1_800_000); // 30 分钟
}

// === 启动时扫描当日提醒（健康/保单/预算/学习/民宿工作） ===
async function scanDailyReminders() {
  const today = DateUtil.today();
  // 民宿当日工作
  try {
    const orders = await Lock.loadAllOrders();
    const onDay = orders.filter(o =>
      DateUtil.range(o.checkIn, o.checkOut || o.checkIn).slice(0, -1).includes(today));
    if (onDay.length) {
      Notify.push({ ts: today, title: `民宿今日 ${onDay.length} 间在住`, message: onDay.map(o => `${o.subRoom}号 · ${o.customerSource || ''}`).join('；'), module: '民宿' });
    }
  } catch (e) {}

  // 健康：生理周期
  const cycles = Store.cycles();
  if (cycles.length) {
    const pred = DateUtil.cycle.predict(cycles);
    if (pred && pred.daysUntilNext >= 0 && pred.daysUntilNext <= 3) {
      Notify.push({ title: '生理周期提醒', message: `预计 ${pred.daysUntilNext} 天后开始 (${pred.nextStart})，请提前准备`, module: '健康' });
    }
  }

  // 保单（≤30 天续保）
  const ins = Store.insurances();
  ins.forEach(p => {
    if (!p.renewDate) return;
    const d = DateUtil.fromToday(p.renewDate);
    if (d >= 0 && d <= 30) {
      Notify.push({ title: '保单即将到期', message: `${p.name} 将在 ${d} 天后续保 (${p.renewDate})`, module: '健康' });
    }
  });

  // 预算（>90%）
  const budgets = Store.budgets();
  Object.entries(budgets).forEach(([cat, b]) => {
    if (!b.limit) return;
    const month = today.slice(0, 7);
    const used = Store.ledger()
      .filter(l => l.date?.startsWith(month) && l.category === cat)
      .reduce((s, l) => s + Number(l.amount || 0), 0);
    const pct = used / b.limit;
    if (pct > 0.9) {
      Notify.push({ title: '预算预警', message: `${cat} 预算已用 ${(pct*100).toFixed(0)}%（¥${used.toFixed(0)} / ¥${b.limit}）`, module: '经济', level: pct > 1 ? 'danger' : 'warn' });
    }
  });

  // 体重今日未打
  const weights = Store.weights();
  const last = weights[weights.length - 1];
  if (!last || last.date !== today) {
    Notify.push({ title: '体重打卡', message: '今日还未记录体重', module: '健康' });
  }
}
