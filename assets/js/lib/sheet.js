/* ====================================================================
   sheet.js - 腾讯文档读写封装层
   实际工作台部署到 CloudStudio 后，前端通过 fetch 调用一个轻代理
   代理服务器负责 OAuth/Token 鉴权后再调腾讯文档 OpenAPI
   本文件同时提供"模拟数据"模式，便于无后端演示
   ==================================================================== */

const Sheet = {
  FILE_ID: 'DYUdtRWlQTmxheW11',
  // 在真实部署中，这个 API_BASE 指向 CloudStudio 内的 Node 代理或 WorkBuddy bridge
  API_BASE: (typeof window !== 'undefined' && window.__SHEET_API__) || '',
  API_PREFIX: '/api', // 当 API_BASE 为空时，使用同域 /api/* 路径
  MOCK: true, // 默认 mock，可由 app.js 初始化时根据探测关闭

  _cache: {},
  _cacheTime: {},
  TTL: 60_000, // 60s 缓存

  // === 基础：探测模式 ===
  _base() { return this.API_BASE || this.API_PREFIX; },

  async probe() {
    try {
      const r = await fetch(`${this._base()}/health`, { method: 'GET' });
      const ct = r.headers.get('content-type') || '';
      // 静态服务器/SPA fallback 会返回 HTML（200 + text/html），不能当 live
      if (!r.ok || !ct.includes('application/json')) {
        this.MOCK = true;
        return false;
      }
      this.MOCK = false;
      return true;
    } catch { this.MOCK = true; return false; }
  },

  // === 读取单元格范围 ===
  async getRange(sheetId, range) {
    const cacheKey = `${sheetId}:${range}`;
    if (this._cache[cacheKey] && Date.now() - this._cacheTime[cacheKey] < this.TTL) {
      return this._cache[cacheKey];
    }
    let result;
    if (this.MOCK) {
      result = await this._mockGet(sheetId, range);
    } else {
      const r = await fetch(`${this._base()}/sheet/range?file_id=${this.FILE_ID}&sheet_id=${sheetId}&range=${encodeURIComponent(range)}`);
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        // 后端不可用，降到 mock
        this.MOCK = true;
        result = await this._mockGet(sheetId, range);
      } else {
        result = await r.json();
      }
    }
    this._cache[cacheKey] = result;
    this._cacheTime[cacheKey] = Date.now();
    return result;
  },

  // === 写入单元格（覆盖式） ===
  async setRange(sheetId, range, values) {
    if (this.MOCK) return this._mockSet(sheetId, range, values);
    const r = await fetch(`${this._base()}/sheet/range`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: this.FILE_ID, sheet_id: sheetId, range, values })
    });
    return r.json();
  },

  // === 追加行（用于订单同步明细/操作日志） ===
  async appendRow(sheetName, row) {
    if (this.MOCK) return this._mockAppend(sheetName, row);
    const r = await fetch(`${this._base()}/sheet/append`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: this.FILE_ID, sheet_name: sheetName, row })
    });
    return r.json();
  },

  // === 列出工作表 ===
  async listSheets() {
    if (this.MOCK) return this._MOCK_SHEETS;
    const r = await fetch(`${this._base()}/sheet/info?file_id=${this.FILE_ID}`);
    return (await r.json()).sheets;
  },

  // === 按名称解析真实 sheet_id（live 模式；带缓存） ===
  async _sid(name) {
    if (this.MOCK) return 'mock_' + name;
    if (!this._sidCache) this._sidCache = {};
    if (this._sidCache[name]) return this._sidCache[name];
    const sheets = await this.listSheets();
    const hit = sheets.find(s => s.name === name);
    const id = hit ? hit.sheet_id : null;
    this._sidCache[name] = id;
    return id;
  },

  // === 创建工作表 ===
  async addSheet(name) {
    if (this.MOCK) {
      if (this._MOCK_SHEETS.find(s => s.name === name)) return { ok: true, existed: true };
      this._MOCK_SHEETS.push({ sheet_id: 'mock_' + name, name });
      return { ok: true, created: true };
    }
    try {
      const r = await fetch(`${this.API_BASE}/sheet/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: this.FILE_ID, name })
      });
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        this.MOCK = true;
        if (!this._MOCK_SHEETS.find(s => s.name === name)) this._MOCK_SHEETS.push({ sheet_id: 'mock_' + name, name });
        return { ok: true, created: true, fallback: 'mock' };
      }
      return await r.json();
    } catch (e) {
      this.MOCK = true;
      if (!this._MOCK_SHEETS.find(s => s.name === name)) this._MOCK_SHEETS.push({ sheet_id: 'mock_' + name, name });
      return { ok: true, created: true, fallback: 'mock' };
    }
  },

  // === 判断网格是否为"空"（仅表头或全空） ===
  _isEmptyGrid(grid) {
    if (!Array.isArray(grid) || grid.length <= 1) return true;
    const body = grid.slice(1);
    return body.every(row => !row || row.every(c => c === '' || c == null));
  },

  // === 解析 vr6hto「2026年」为标准订单列表 ===
  async getMainOrders() {
    // 「2026年」是日历式：行=日期，列=每个子房间的[入住/退房/押金/客源/目的]
    // 我们用 getRange 拉取大范围再解析
    let data = await this.getRange('vr6hto', 'A1:Z500');
    // 文档该表为空时回退到 mock 演示数据（文档一旦填写即自动切换为实时）
    if (this._isEmptyGrid(data)) data = this._MOCK_MAIN_ROWS;
    return this._parseMainSheet(data);
  },

  _parseMainSheet(data) {
    // data = [[row0col0, row0col1, ...], ...]
    if (!Array.isArray(data) || data.length < 2) return [];
    const orders = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[0]) continue;
      const date = String(row[0]).trim();
      // 简化：每 5 列一组子房间（入住/退房/押金/客源/目的）
      // 列结构在真实 sheet 中是预定义的（401→1-4号, 1302→5-6号 ...）
      // 这里用 ROOMS_CONFIG 来定位
      const cellMap = [
        // [subRoom, col indices: in, out, deposit, source, purpose]
      ];
      // 真实数据已根据用户读取结果建模：
      // 列 1-4 = 401(1,2,3,4)，列 5-6 = 1302(5,6)，列 7-8 = 407(7,8)
      // 列 9-12 = 1502(9,10,11,12)，列 13-14 = 503(15,16)
      // 每房 5 列：入住/退房/押金/客源/目的
      // 这里仅抽取"入住"列是否非空判断占用
      const rooms = {
        '1': 1, '2': 2, '3': 3, '4': 4,
        '5': 5, '6': 6,
        '7': 7, '8': 8,
        '9': 9, '10': 10, '11': 11, '12': 12,
        '15': 13, '16': 14
      };
      for (const [sub, col] of Object.entries(rooms)) {
        const inCol = row[col] ? String(row[col]).trim() : '';
        if (inCol) {
          const outCol = row[col + 1] ? String(row[col + 1]).trim() : '';
          orders.push({
            id: `main-${date}-${sub}`,
            source: 'main_sheet',
            date,
            subRoom: sub,
            checkIn: inCol,
            checkOut: outCol,
            raw: inCol
          });
        }
      }
    }
    return orders;
  },

  // === 拉取新增订单（订单同步明细 sheet） ===
  async getNewOrders() {
    // 先确保 sheet 存在
    await this.addSheet('订单同步明细');
    const sid = await this._sid('订单同步明细');
    if (this.MOCK) {
      const data = await this.getRange('mock_订单同步明细', 'A1:K500');
      return this._parseOrderSheet(data);
    }
    if (!sid) return [];
    const data = await this.getRange(sid, 'A1:K500');
    return this._parseOrderSheet(data);
  },

  _parseOrderSheet(data) {
    if (!Array.isArray(data) || data.length < 2) return [];
    const orders = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[0]) continue;
      const [orderId, room, roomType, checkIn, checkOut, deposit, source, purpose, ts, operator, note] = row;
      orders.push({
        id: orderId,
        source: 'new_sheet',
        subRoom: String(room),
        type: roomType,  // '整租' | '分租'
        checkIn: checkIn ? String(checkIn) : '',
        checkOut: checkOut ? String(checkOut) : '',
        deposit: deposit ? String(deposit) : '',
        customerSource: source ? String(source) : '',
        purpose: purpose ? String(purpose) : '',
        ts: ts ? String(ts) : '',
        operator: operator ? String(operator) : '',
        note: note ? String(note) : ''
      });
    }
    return orders;
  },

  // === 拉取月度报表（营收/成本） ===
  async getMonthlyReport() {
    let data = await this.getRange('3p6db7', 'A1:N50');
    // 文档该表为空时回退到 mock 演示数据
    if (this._isEmptyGrid(data)) {
      data = [
        ['月份', '401收益', '1302收益', '407收益', '401房租', '1302房租', '407房租', '401水电', '1302水电', '407水电', '401燃气', '1302燃气', '407燃气', '备注'],
        ['2026-07', 8200, 12500, 11000, 5500, 7800, 7800, 480, 620, 580, 120, 180, 160, '入住率 88%'],
        ['2026-08', 4500, 6800, 5900, 5500, 7800, 7800, 220, 380, 310, 60, 100, 80, '数据持续更新']
      ];
    }
    return data;
  },

  // === 拉取操作日志 ===
  async getAuditLog({ limit = 50, type = null } = {}) {
    await this.addSheet('工作台操作日志');
    let data;
    if (this.MOCK) {
      data = await this.getRange('mock_工作台操作日志', `A1:H${Math.max(limit + 1, 100)}`);
    } else {
      const sid = await this._sid('工作台操作日志');
      if (!sid) return [];
      data = await this.getRange(sid, `A1:H${Math.max(limit + 1, 100)}`);
    }
    const rows = (data || []).slice(1);
    let logs = rows.map(row => ({
      ts: row[0] || '',
      operator: row[1] || '',
      module: row[2] || '',
      action: row[3] || '',
      refId: row[4] || '',
      payload: row[5] || '',
      type: row[6] || '',
      note: row[7] || ''
    })).filter(r => r.ts);
    if (type) logs = logs.filter(r => r.type === type);
    return logs.sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, limit);
  },

  // === 写入操作日志 ===
  async writeAudit({ operator = '小污', module, action, refId = '', payload = '', type = 'audit', note = '' }) {
    const ts = new Date().toISOString();
    const row = [ts, operator, module, action, refId, payload, type, note];
    return this.appendRow('工作台操作日志', row);
  },

  // === 写入新订单 ===
  async writeOrder(order) {
    const ts = new Date().toISOString();
    const row = [
      order.id, order.subRoom, order.type, order.checkIn, order.checkOut,
      order.deposit || '', order.customerSource || '', order.purpose || '',
      ts, '小污', order.note || ''
    ];
    await this.writeAudit({
      module: '民宿', action: '新增订单',
      refId: order.id, payload: JSON.stringify(order), type: 'order_new'
    });
    return this.appendRow('订单同步明细', row);
  },

  // === 取消订单 ===
  async cancelOrder(orderId, reason = '') {
    const ts = new Date().toISOString();
    await this.writeAudit({
      module: '民宿', action: '取消订单',
      refId: orderId, payload: reason, type: 'order_cancel'
    });
    return { ok: true, ts };
  },

  // === 房态模块：批量回写订单主表（尽力；文档写受限时静默失败） ===
  async appendOrders(rows) {
    const data = (rows || []).map(o => [
      o.id, o.room, o.type, o.checkIn, o.checkOut, o.nights,
      o.price, o.total, o.guest, o.phone, o.status, o.payStatus, o.note, o.createdAt
    ]);
    if (this.MOCK) { for (const r of data) this._mockAppend('订单主表', r); return { ok: true }; }
    // live：先确保 sheet 存在，再逐行追加
    try {
      await this.addSheet('订单主表');
      const sid = await this._sid('订单主表');
      if (!sid) return { ok: false };
      for (const r of data) await this.appendRow('订单主表', r);
      return { ok: true };
    } catch (e) { return { ok: false, err: String(e) }; }
  },

  // === 房态模块：批量回写操作日志 ===
  async appendLog(rows) {
    const data = (rows || []).map(l => [
      l.ts, l.opType, l.room, l.changeRange, `${l.before}→${l.after}`, l.source
    ]);
    if (this.MOCK) { for (const r of data) this._mockAppend('操作日志', r); return { ok: true }; }
    try {
      await this.addSheet('操作日志');
      const sid = await this._sid('操作日志');
      if (!sid) return { ok: false };
      for (const r of data) await this.appendRow('操作日志', r);
      return { ok: true };
    } catch (e) { return { ok: false, err: String(e) }; }
  },

  // === 保存周期汇报 ===
  async saveReport({ kind, content, period }) {
    const ts = new Date().toISOString();
    await this.writeAudit({
      module: '自动化', action: `${kind}生成`,
      refId: period, payload: content.slice(0, 200), type: kind
    });
    return { ok: true, ts };
  },

  // === Mock 数据 ===
  _MOCK_SHEETS: [
    { sheet_id: 'vr6hto', name: '2026年' },
    { sheet_id: '3p6db7', name: '月度报表' },
    { sheet_id: 'w7wj03', name: '陪诊' },
    { sheet_id: 'zhcb7q', name: '耗材' },
    { sheet_id: '46t788', name: '(历史)订房1-8号' }
  ],
  _MOCK_MAIN_ROWS: [
    // [date, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16]
    ['2026-08-01', '李女士', '', '', '', '', '', '张先生', '', '', '', '', '', '陈姐', ''],
    ['2026-08-02', '李女士', '', '', '', '', '', '张先生', '', '', '', '', '', '陈姐', ''],
    ['2026-08-03', '', '', '王先生', '', '', '', '张先生', '', '', '', '', '', '', ''],
    ['2026-08-04', '', '', '王先生', '', '', '', '', '', '', '', '', '', '', ''],
    ['2026-08-05', '', '', '', '', '刘先生', '刘先生', '', '', '', '', '', '', '周先生', '周先生'],
  ],
  _MOCK_NEW_ORDERS: [],
  _MOCK_AUDIT: [
    ['2026-08-01T08:00:00Z', '小污', '系统', '初始化', '', '首次部署', 'system', '']
  ],

  async _mockGet(sheetId, range) {
    if (sheetId === 'vr6hto') return this._MOCK_MAIN_ROWS;
    if (sheetId === '3p6db7') {
      return [
        ['月份', '401收益', '1302收益', '407收益', '401房租', '1302房租', '407房租', '401水电', '1302水电', '407水电', '401燃气', '1302燃气', '407燃气', '备注'],
        ['2026-07', 8200, 12500, 11000, 5500, 7800, 7800, 480, 620, 580, 120, 180, 160, '入住率 88%'],
        ['2026-08', 4500, 6800, 5900, 5500, 7800, 7800, 220, 380, 310, 60, 100, 80, '数据持续更新']
      ];
    }
    if (sheetId.startsWith('mock_订单同步明细')) {
      this._loadMock();
      return [['订单号', '房号', '房型', '入住', '退房', '押金', '客源', '目的', '时间', '操作人', '备注'],
              ...this._MOCK_NEW_ORDERS];
    }
    if (sheetId.startsWith('mock_工作台操作日志')) {
      this._loadMock();
      return [['时间', '操作人', '模块', '动作', '关联ID', '内容', '类型', '备注'],
              ...this._MOCK_AUDIT];
    }
    return [];
  },

  async _mockSet(sheetId, range, values) { return { ok: true, sheetId, range, rows: values.length }; },

  async _mockAppend(sheetName, row) {
    if (sheetName === '订单同步明细') {
      this._MOCK_NEW_ORDERS.push(row);
    } else if (sheetName === '工作台操作日志') {
      this._MOCK_AUDIT.unshift(row);
      if (this._MOCK_AUDIT.length > 200) this._MOCK_AUDIT.length = 200;
    }
    this._persistMock();
    // 失效缓存
    Object.keys(this._cache).forEach(k => { if (k.includes(sheetName)) { delete this._cache[k]; delete this._cacheTime[k]; }});
    return { ok: true, appended: true };
  },

  // === mock 数据本地持久化（模拟双向同步的留痕） ===
  _loadMock() {
    try {
      const o = localStorage.getItem('yxz:sheet_mock_orders');
      if (o) this._MOCK_NEW_ORDERS = JSON.parse(o);
      const a = localStorage.getItem('yxz:sheet_mock_audit');
      if (a) this._MOCK_AUDIT = JSON.parse(a);
    } catch (e) {}
  },
  _persistMock() {
    try {
      localStorage.setItem('yxz:sheet_mock_orders', JSON.stringify(this._MOCK_NEW_ORDERS));
      localStorage.setItem('yxz:sheet_mock_audit', JSON.stringify(this._MOCK_AUDIT));
    } catch (e) {}
  },

  // 清理缓存
  invalidate() {
    this._cache = {};
    this._cacheTime = {};
  }
};
