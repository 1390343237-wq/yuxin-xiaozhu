/* ====================================================================
   roomstate.js - 房态管理核心引擎（数据底座 + 锁房规则 + 操作闭环 + 自然语言）
   --------------------------------------------------------------------
   数据底座说明（重要）：
   - 当前腾讯文档 MCP 连接「读正常、写不落盘」，故所有房态/订单/日志/营收的
     可靠写入走云端 KV（经 Store → 代理 server/proxy.py），跨设备实时同步。
   - 文档侧：5 个 Sheet 由 ensureSheets() 创建（元数据可落盘），表头与新增行
     尽力回写（若平台后续开放写入即自动生效）；文档手动录入的数据可被前端读取。
   - 文档 file_id 以用户指定链接为准：DYUdtRWlQTmxheW11（与 aGmEiPNlaymu 同源）。
   ==================================================================== */

const RoomState = {
  FILE_ID: 'DYUdtRWlQTmxheW11',
  SHEETS: {
    config:   '房源基础配置',
    orders:   '订单主表',
    calendar: '房态日历矩阵',
    log:      '操作日志',
    revenue:  '房态营收汇总'
  },

  // 房态枚举 → 中文 + 配色（与需求一致）
  STATUS: {
    vacant:   { label: '空置可售', color: '#22c55e', bg: 'bg-emerald-100',  text: 'text-emerald-700' },
    reserved: { label: '已预定',   color: '#3b82f6', bg: 'bg-blue-100',     text: 'text-blue-700' },
    occupied: { label: '在住',     color: '#f97316', bg: 'bg-orange-100',   text: 'text-orange-700' },
    clean:    { label: '待打扫',   color: '#9ca3af', bg: 'bg-gray-200',     text: 'text-gray-600' },
    whole:    { label: '整租占用', color: '#4b5563', bg: 'bg-gray-700',     text: 'text-gray-100' }
  },

  // 套房基础配置（房型属性 / 对应分租 / 售价 / 床型 / 备注）
  // attr: divide_only=仅分租  whole_only=仅整租  both=可整可分
  SUITES: [
    { id:'401',  label:'401 套房', attr:'divide_only',    subRooms:['1','2','3','4'],            weekday:138, weekend:168, bed:'1.5m 大床', note:'近电梯，安静' },
    { id:'1302', label:'1302 套房', attr:'both',          subRooms:['5','6'],                    weekday:158, weekend:198, bed:'1.8m 大床', note:'高层采光好' },
    { id:'407',  label:'407 套房',  attr:'both',          subRooms:['7','8'],                    weekday:158, weekend:198, bed:'双床',       note:'' },
    { id:'1502', label:'1502 套房', attr:'divide_only',   subRooms:['9','10','11','12'],         weekday:128, weekend:158, bed:'1.5m 大床', note:'性价比高' },
    { id:'503',  label:'503 套房',  attr:'both',          subRooms:['15','16'],                  weekday:168, weekend:208, bed:'1.8m 大床', note:'带飘窗' },
    { id:'1202', label:'1202 套房', attr:'whole_only',    subRooms:[],                           weekday:368, weekend:428, bed:'三室一厅',   note:'整套出租' }
  ],

  // ── 数据层（可靠云端 KV） ──────────────────────────────────────────
  orders()  { return Store.list('room_orders'); },
  setOrders(a) { Store.set('room_orders', a); },
  logs()    { return Store.list('room_logs'); },
  setLogs(a){ Store.set('room_logs', a); },
  cleaning() { return Store.get('room_cleaning', []); },
  setCleaning(a) { Store.set('room_cleaning', a); },

  // 单元全集（含纯整租套房本身）；顺序与套房分组一致
  units() {
    const out = [];
    for (const s of this.SUITES) {
      if (s.subRooms.length) s.subRooms.forEach(u => out.push({ id:u, suite:s.id, label:`${s.id}·${u}号` }));
      else out.push({ id:s.id, suite:s.id, label:`${s.id} 整套` });
    }
    return out;
  },
  suiteOf(unitId) {
    for (const s of this.SUITES) {
      if (s.subRooms.includes(unitId)) return s;
      if (s.id === unitId) return s;
    }
    return null;
  },
  // 分租单间 → 所属套房
  parentOf(unitId) { return this.suiteOf(unitId)?.id || null; },

  // ── 校验（复用 Lock.check 整分租互斥规则） ─────────────────────────
  // order: {room, type, checkIn, checkOut}
  validate(order) {
    const existing = this.orders().filter(o => o.status !== '已取消');
    return Lock.check({
      targetRoom: order.room,
      orderType: order.type,
      checkIn: order.checkIn,
      checkOut: order.checkOut,
      existing,
      excludeId: order.id || null
    });
  },

  // ── 操作闭环：校验 → 写订单 → 写日志 → 回写文档 ────────────────────
  _newId() { return 'O' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase(); },

  async addOrder(input) {
    const room = String(input.room).trim();
    const type = input.type === '整租' ? '整租' : '分租';
    const order = {
      id: this._newId(),
      room, type,
      subRoom: room,            // 整租=套房号；分租=单间号（供 Lock.check 互斥校验）
      customerSource: input.guest || '',
      checkIn: input.checkIn,
      checkOut: input.checkOut || DateUtil.fmt(DateUtil.addDays(input.checkIn, 1)),
      nights: DateUtil.nights(input.checkIn, input.checkOut),
      price: Number(input.price || 0),
      total: Number(input.total || input.price || 0),
      guest: input.guest || '',
      phone: input.phone || '',
      status: '待入住',
      payStatus: input.payStatus || '未收款',
      note: input.note || '',
      createdAt: new Date().toISOString()
    };
    const v = this.validate(order);
    if (!v.ok) return { ok:false, reason: v.reason, conflicts: v.conflicts };
    const orders = this.orders(); orders.push(order); this.setOrders(orders);
    this._log('新增订单', order, { before:'', after:`${type} ${room} ${order.checkIn}~${order.checkOut}` });
    this._docAppendOrders([order]);
    return { ok:true, order };
  },

  async updateOrderDates(id, checkIn, checkOut, note) {
    const orders = this.orders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return { ok:false, reason:'订单不存在' };
    const old = orders[idx];
    const draft = { ...old, checkIn, checkOut, nights: DateUtil.nights(checkIn, checkOut) };
    const v = this.validate(draft);
    if (!v.ok) return { ok:false, reason: v.reason, conflicts: v.conflicts };
    const before = `${old.type} ${old.room} ${old.checkIn}~${old.checkOut}`;
    orders[idx] = { ...old, checkIn, checkOut, nights: DateUtil.nights(checkIn, checkOut), note: note !== undefined ? note : old.note };
    this.setOrders(orders);
    this._log('修改订单', old, { before, after:`${draft.type} ${draft.room} ${checkIn}~${checkOut}`, changeRange:`${checkIn}~${checkOut}` });
    this._docAppendOrders([orders[idx]]);
    return { ok:true, order: orders[idx] };
  },

  async extendStay(id, newCheckOut) {
    const orders = this.orders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return { ok:false, reason:'订单不存在' };
    const old = orders[idx];
    return this.updateOrderDates(id, old.checkIn, newCheckOut);
  },

  async cancelOrder(id, reason) {
    const orders = this.orders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return { ok:false, reason:'订单不存在' };
    const old = orders[idx];
    const before = `${old.type} ${old.room} ${old.checkIn}~${old.checkOut} (${old.status})`;
    orders[idx] = { ...old, status:'已取消', cancelReason: reason || '' };
    this.setOrders(orders);
    this._log('取消订单', old, { before, after:'已取消', changeRange:`${old.checkIn}~${old.checkOut}` });
    this._docAppendOrders([orders[idx]]);
    return { ok:true };
  },

  async checkIn(id) {
    const orders = this.orders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return { ok:false, reason:'订单不存在' };
    const old = orders[idx];
    orders[idx] = { ...old, status:'在住' };
    this.setOrders(orders);
    this._log('办理入住', old, { before:old.status, after:'在住', changeRange:`${old.checkIn}~${old.checkOut}` });
    this._docAppendOrders([orders[idx]]);
    return { ok:true };
  },

  async checkOut(id) {
    const orders = this.orders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return { ok:false, reason:'订单不存在' };
    const old = orders[idx];
    const today = DateUtil.today();
    orders[idx] = { ...old, status:'已退房' };
    this.setOrders(orders);
    // 退房当天标记「待打扫」
    const cleaning = this.cleaning();
    const unit = old.type === '整租' ? old.room : old.room;
    if (!cleaning.find(c => c.unit === unit && c.date === today)) {
      cleaning.push({ unit, date: today });
      this.setCleaning(cleaning);
    }
    this._log('办理退房', old, { before:old.status, after:'已退房', changeRange:`${old.checkIn}~${old.checkOut}` });
    this._docAppendOrders([orders[idx]]);
    return { ok:true };
  },

  async markClean(unit, date) {
    let cleaning = this.cleaning();
    const before = cleaning.find(c => c.unit === unit && c.date === (date||DateUtil.today()));
    cleaning = cleaning.filter(c => !(c.unit === unit && c.date === (date||DateUtil.today())));
    this.setCleaning(cleaning);
    this._log('标记打扫完成', { room:unit }, { before: before?'待打扫':'—', after:'已打扫', changeRange: date||DateUtil.today() });
    return { ok:true };
  },

  // ── 房态计算 ──────────────────────────────────────────────────────
  // 单单元单日状态
  unitStatusOn(unitId, date, opts = {}) {
    const today = opts.today || DateUtil.today();
    // 已退房订单即释放房态（否则退房后日历仍显示占用）—— 自动化校准亦依赖此规则
    const orders = this.orders().filter(o => o.status !== '已取消' && o.status !== '已退房');
    // 整租占用：套房被整租覆盖
    for (const o of orders) {
      if (o.type !== '整租') continue;
      const s = this.suiteOf(o.room);
      if (!s) continue;
      const locked = s.subRooms.length ? s.subRooms.includes(unitId) : (o.room === unitId);
      if (locked && DateUtil.overlap(o.checkIn, o.checkOut, date, DateUtil.fmt(DateUtil.addDays(date,1)))) {
        return 'whole';
      }
    }
    // 分租占用
    for (const o of orders) {
      if (o.type === '整租') continue;
      if (String(o.subRoom || o.room) !== unitId) continue;
      if (DateUtil.overlap(o.checkIn, o.checkOut, date, DateUtil.fmt(DateUtil.addDays(date,1)))) {
        return date > today ? 'reserved' : 'occupied';
      }
    }
    // 待打扫
    const cleaning = this.cleaning();
    if (cleaning.find(c => c.unit === unitId && c.date === date)) return 'clean';
    return 'vacant';
  },

  // 某日全部单元状态
  dayStatus(date) {
    const today = DateUtil.today();
    const map = {};
    for (const u of this.units()) map[u.id] = this.unitStatusOn(u.id, date, { today });
    return map;
  },

  // 窗口期每日状态矩阵（供日历视图）
  windowStatus(startDate, days) {
    const dates = DateUtil.nextDays(days, startDate);
    return dates.map(d => ({ date:d, status: this.dayStatus(d) }));
  },

  // 空置统计：未来 N 天各单元空闲夜数 + 连续空置 >=3 天的房源
  vacancy(days) {
    const today = DateUtil.today();
    const window = DateUtil.nextDays(days, today);
    return this.units().map(u => {
      let free = 0; const freeDates = [];
      for (const d of window) {
        const s = this.unitStatusOn(u.id, d, { today });
        if (s === 'vacant') { free++; freeDates.push(d); }
      }
      // 连续空置 >=3 天
      let maxStreak = 0, streak = 0;
      for (const d of window) {
        if (this.unitStatusOn(u.id, d, { today }) === 'vacant') { streak++; maxStreak = Math.max(maxStreak, streak); }
        else streak = 0;
      }
      return { ...u, freeDays: free, total: window.length, maxStreak, freeDates };
    });
  },

  // 当日工作看板
  dailyBoard() {
    const today = DateUtil.today();
    const orders = this.orders().filter(o => o.status !== '已取消');
    const checkins = [], checkouts = [], occupied = [];
    for (const o of orders) {
      if (o.checkIn === today && o.status === '待入住') checkins.push(o);
      if (o.checkOut === today && (o.status === '在住' || o.status === '待入住')) checkouts.push(o);
      if (DateUtil.overlap(o.checkIn, o.checkOut, today, DateUtil.fmt(DateUtil.addDays(today,1))) && o.status !== '已取消' && o.status !== '已退房') occupied.push(o);
    }
    const cleaning = this.cleaning().filter(c => c.date === today);
    const vacant = this.units().filter(u => this.unitStatusOn(u.id, today, { today }) === 'vacant');
    return { today, checkins, checkouts, occupied, cleaning, vacant };
  },

  // 营收汇总（按日/周/月）
  revenueSummary(period) {
    const orders = this.orders().filter(o => o.status !== '已取消' && o.status !== '已退房'? true : o.status !== '已取消');
    const settled = this.orders().filter(o => o.status !== '已取消');
    const totalRevenue = settled.reduce((s,o)=> s + Number(o.total||0), 0);
    const totalNights = settled.reduce((s,o)=> s + Number(o.nights||0), 0);
    const totalRooms = this.units().length;
    // 入住率（本月）：本月有在住/预定夜 / （房间数×本月天数）
    const month = (period || DateUtil.today()).slice(0,7);
    const monthOrders = settled.filter(o => (o.checkIn||'').startsWith(month) || (o.checkOut||'').startsWith(month));
    let monthNights = 0;
    for (const o of monthOrders) {
      const s = o.checkIn < month+'-01' ? month+'-01' : o.checkIn;
      const e = (o.checkOut||o.checkIn) > month+'-31' ? month+'-31' : (o.checkOut||o.checkIn);
      monthNights += Math.max(0, DateUtil.nights(s, e));
    }
    const monthDays = new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate();
    const occRate = totalRooms * monthDays ? Math.round(monthNights / (totalRooms * monthDays) * 100) : 0;
    // 各房型营收
    const bySuite = {};
    for (const s of this.SUITES) bySuite[s.id] = { revenue:0, nights:0 };
    for (const o of settled) {
      const sid = o.type === '整租' ? o.room : this.parentOf(o.room);
      if (bySuite[sid]) { bySuite[sid].revenue += Number(o.total||0); bySuite[sid].nights += Number(o.nights||0); }
    }
    return { totalRevenue, totalNights, totalRooms, occRate, month, monthNights, bySuite };
  },

  // 任意时间窗口的营收聚合（季/年报用）：收入、间夜、订单数、各房型贡献、入住率
  rangeSummary(start, end) {
    const settled = this.orders().filter(o => o.status !== '已取消');
    const inRange = settled.filter(o => o.checkIn <= end && (o.checkOut || o.checkIn) >= start);
    const revenue = inRange.reduce((s, o) => s + Number(o.total || 0), 0);
    const nights = inRange.reduce((s, o) => s + Number(o.nights || 0), 0);
    const bySuite = {};
    for (const s of this.SUITES) bySuite[s.id] = { revenue: 0, nights: 0, count: 0 };
    for (const o of inRange) {
      const sid = o.type === '整租' ? o.room : this.parentOf(o.room);
      if (bySuite[sid]) { bySuite[sid].revenue += Number(o.total || 0); bySuite[sid].nights += Number(o.nights || 0); bySuite[sid].count += 1; }
    }
    const totalRooms = this.units().length;
    const days = DateUtil.nights(start, end) || 1;
    const occRate = totalRooms * days ? Math.round((nights) / (totalRooms * days) * 100) : 0;
    return { revenue, nights, count: inRange.length, bySuite, occRate, totalRooms, days };
  },

  // ── 操作日志（不可篡改：仅追加，前端不提供删除入口） ───────────────
  _log(opType, order, extra = {}) {
    const logs = this.logs();
    logs.push({
      id: 'L' + Date.now().toString(36),
      ts: new Date().toISOString(),
      opType,
      room: extra.room || (order && (order.room || order.subRoom)) || '',
      guest: order && order.guest || '',
      changeRange: extra.changeRange || (order ? `${order.checkIn}~${order.checkOut}` : ''),
      before: extra.before || '',
      after: extra.after || '',
      source: extra.source || '工作台'
    });
    // 仅保留最近 2000 条，避免无限膨胀
    this.setLogs(logs.slice(-2000));
    this._docAppendLog([logs[logs.length-1]]);
  },

  // ── 文档最佳实践回写（写受限时静默失败，不影响功能） ───────────────
  async ensureSheets() {
    if (!window.__SHEET_API__ && Sheet.MOCK) return;
    for (const name of Object.values(this.SHEETS)) {
      try { await Sheet.addSheet(name); } catch (e) {}
    }
  },
  _docAppendOrders(rows) { /* 文档写入当前受限：尽力回写，失败静默 */
    if (!window.__SHEET_API__ && Sheet.MOCK) return;
    try { Sheet.appendOrders(rows); } catch (e) {}
  },
  _docAppendLog(rows) {
    if (!window.__SHEET_API__ && Sheet.MOCK) return;
    try { Sheet.appendLog(rows); } catch (e) {}
  },

  // ── 自然语言指令解析 ──────────────────────────────────────────────
  // 返回 {action:'add'|'extend'|'query'|'clean'|'unknown', ...parsed}
  parseCommand(text) {
    const t = (text || '').trim();
    if (!t) return { action:'unknown' };
    const year = new Date().getFullYear();

    // 工具：解析中文/数字日期
    const parseDate = (s) => {
      if (!s) return null;
      let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
      m = s.match(/(\d{1,2})月(\d{1,2})[日号]/);
      if (m) return `${year}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
      m = s.match(/(\d{1,2})[.\/](\d{1,2})/);
      if (m) return `${year}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
      return null;
    };

    // 1) 查询可售空房
    if (/查询|可售|空房|空置|有哪些房/.test(t) && /(周|天|日)/.test(t)) {
      const wm = t.match(/(\d+)\s*(周|天|日)/);
      const days = wm ? (wm[2]==='周' ? 7*Number(wm[1]) : Number(wm[1])) : 7;
      return { action:'query', days };
    }

    // 2) 标记打扫完成
    if (/打扫|清扫|清洁/.test(t) && /完成|好了|完毕|标记/.test(t)) {
      const um = t.match(/(\d{1,3})\s*号?房?/);
      const unit = um ? um[1] : null;
      return { action:'clean', unit };
    }

    // 3) 续住 / 延长
    if (/续住|延长|延到|住到|改到/.test(t)) {
      const um = t.match(/(\d{1,3})\s*号?房?/);
      const d2 = parseDate(t.match(/到\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}月\d{1,2}[日号]|\d{1,2}[.\/]\d{1,2})/)?.[1] || '');
      const d1 = parseDate(t.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}月\d{1,2}[日号]|\d{1,2}[.\/]\d{1,2})/)?.[1] || '');
      return { action:'extend', unit: um?um[1]:null, from:d1, to:d2 };
    }

    // 4) 新增订单
    if (/新增|添加|下单|预订|预定|入住/.test(t)) {
      const whole = /整租/.test(t);
      // 套房或单间
      let room = null, type = whole ? '整租' : '分租';
      if (whole) {
        const sm = t.match(/(401|1302|407|1502|503|1202)\s*套房?/);
        room = sm ? sm[1] : null;
      } else {
        const um = t.match(/(\d{1,3})\s*号房?/);
        room = um ? um[1] : null;
        if (!room) { const sm = t.match(/(401|1302|407|1502|503|1202)\s*套房?/); if (sm) room = sm[1]; }
      }
      // 位置感知：取离「入住」「退房」关键词最近的日期（兼容"8月10日入住"与"入住8月10日"两种语序）
      const dateRe = /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}月\d{1,2}[日号]|\d{1,2}[.\/]\d{1,2})/g;
      const dates = []; let _dm;
      while ((_dm = dateRe.exec(t)) !== null) dates.push({ raw:_dm[0], idx:_dm.index, val: parseDate(_dm[0]) });
      const near = (kwPos) => {
        if (kwPos < 0 || !dates.length) return null;
        // 优先取关键词「之前」最近的一个日期；无前置日期则取之后第一个
        let best = null;
        for (const d of dates) { if (d.idx < kwPos && (!best || d.idx > best.idx)) best = d; }
        if (best) return best.val;
        return (dates.find(d => d.idx > kwPos) || {}).val || null;
      };
      const ci = t.indexOf('入住');
      const co = t.search(/退房|离店|退房/);
      const d1 = ci >= 0 ? near(ci) : (dates[0] && dates[0].val);
      const d2 = co >= 0 ? near(co) : (dates[1] && dates[1].val);
      const guest = (t.match(/客人\s*([^\s，,。]+)/) || t.match(/([张王李赵刘陈杨黄周吴])[先生女士]/))?.[1] || '';
      const total = (t.match(/总价\s*(\d+)/) || t.match(/(\d+)\s*元/))?.[1] || '';
      return { action:'add', room, type, checkIn:d1, checkOut:d2, guest, total: total?Number(total):0 };
    }

    return { action:'unknown', raw:t };
  }
};
window.RoomState = RoomState;
