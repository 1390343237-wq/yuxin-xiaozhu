/* ====================================================================
   store.js - 浏览器 localStorage 状态管理（生活数据/草稿/排序等）
   ==================================================================== */

const Store = {
  PREFIX: 'yxz:',

  _k(key) { return this.PREFIX + key; },

  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(this._k(key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(this._k(key), JSON.stringify(value)); }
    catch (e) { console.error('Store.set failed', e); return false; }
    // v1 升级：set 只写本地 + 异步推 KV（不带文档回执，因为 set 通常不是"业务事件"）
    this._push(key, value).then(kvOk => {
      if (window.SyncBadge) window.SyncBadge.setWriteResult(!!kvOk, true);
    });
    return true;
  },
  remove(key) { localStorage.removeItem(this._k(key)); this._push(key, null); },

  // === 云端同步（经代理 KV；单写点镜像，失败静默回退本地） ===
  account() { return (typeof window !== 'undefined' && window.__ACCOUNT__) || 'local'; },
  _cloudKey(key) { return this.account() + ':' + key; },
  _api() { return ((typeof window !== 'undefined' && window.__SHEET_API__) || ''); },
  _kvBase() {
    const api = this._api();
    return api ? api + '/kv' : '/kv'; // 同域 /kv 用于一体化代理
  },
  _sheetBase() {
    const api = this._api();
    return api ? api + '/api' : '/api';
  },
  _push(key, value) {
    const base = this._kvBase();
    if (!base) return Promise.resolve(false);
    return fetch(base + '/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: this._cloudKey(key), value })
    })
      .then(r => r.ok)
      .catch(() => false);
  },

  /**
   * v1 升级：带回执的"主写入"封装
   * 流程：1) 写 localStorage（同步、可靠） 2) 写 KV（异步、可靠） 3) 写腾讯文档（异步、尽力）
   * 返回：{ kvOk, docOk, value }
   * 调用方依据此更新 SyncBadge 徽章
   */
  async write(key, value, { alsoAppendDoc, sheetName, row } = {}) {
    // 1) 落本地（同步）
    try { localStorage.setItem(this._k(key), JSON.stringify(value)); }
    catch (e) { console.error('Store.write local failed', e); return { kvOk: false, docOk: false, error: e }; }

    // 2) 推 KV（异步，可靠）
    const kvOk = await this._push(key, value);

    // 3) 同步到腾讯文档（异步，尽力；不阻塞）
    let docOk = true;
    if (alsoAppendDoc && sheetName && row && typeof Sheet !== 'undefined') {
      docOk = false; // 默认失败，等成功再翻
      try {
        const r = await Sheet.appendRow(sheetName, row);
        docOk = !!(r && (r.ok || r.appended));
      } catch (e) { docOk = false; }
    }

    // 4) 更新徽章
    if (window.SyncBadge) window.SyncBadge.setWriteResult(kvOk, docOk);

    return { kvOk, docOk, value };
  },
  async cloudPull() {
    const base = this._kvBase();
    if (!base) return false;
    try {
      const pre = this.account() + ':';
      const ks = await (await fetch(base + '/keys?prefix=' + encodeURIComponent(pre))).json();
      for (const full of (ks.keys || [])) {
        const localKey = full.slice(pre.length);
        const r = await (await fetch(base + '/get?key=' + encodeURIComponent(full))).json();
        if (r.value !== undefined && r.value !== null) {
          localStorage.setItem(this._k(localKey), JSON.stringify(r.value));
        }
      }
      return true;
    } catch (e) { return false; }
  },

  // 集合类操作（带默认结构）
  list(key) { return this.get(key, []); },
  add(key, item) {
    const list = this.list(key);
    list.push(item);
    this.set(key, list);
    return item;
  },
  update(key, id, patch) {
    const list = this.list(key);
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...patch };
    this.set(key, list);
    return list[idx];
  },
  removeById(key, id) {
    const list = this.list(key).filter(x => x.id !== id);
    this.set(key, list);
  },
  findById(key, id) {
    return this.list(key).find(x => x.id === id) || null;
  },

  // === 预定义的全局状态 ===
  // 首页卡片排序
  homeCardOrder() {
    return this.get('home_card_order', [
      'work_today','life_today','metrics','shortcuts',
      'daily_report','weekly_report'
    ]);
  },
  setHomeCardOrder(order) { this.set('home_card_order', order); },

  // 记账
  ledger() { return this.list('ledger'); },
  addLedger(item) { return this.add('ledger', { ...item, id: 'l' + Date.now() + Math.random().toString(36).slice(2,6) }); },

  // 资产账户
  accounts() { return this.list('accounts'); },

  // 预算
  budgets() { return this.get('budgets', {}); },

  // 持仓（理财）
  holdings() { return this.list('holdings'); },

  // 体重
  weights() { return this.list('weights'); },

  // 生理周期
  cycles() { return this.list('cycles'); },

  // 体检
  healthChecks() { return this.list('health_checks'); },

  // 保单
  insurances() { return this.list('insurances'); },

  // 技能
  skills() { return this.list('skills'); },

  // 书籍
  books() { return this.list('books'); },

  // 学习打卡
  checkins() { return this.list('checkins'); },

  // 自媒体内容
  contents() { return this.list('contents'); },

  // 热点缓存
  hotTopics() { return this.get('hot_topics', { date: '', topics: [] }); },
  setHotTopics(t) { this.set('hot_topics', t); },

  // 周期汇报
  reports() { return this.list('reports'); },
  addReport(r) { return this.add('reports', { ...r, id: 'r' + Date.now() }); }
};
