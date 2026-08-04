/* ====================================================================
   biz-settings.js - 设置中心
   子系统：权限设置（本地 RBAC）/ 字段可视化配置（热点关键词·合规词库·预算）
   SPA module: window['biz-settings'].render(root)
   ==================================================================== */

const BizSettings = {
  _tab: 'role',

  async render(root) {
    root.innerHTML = `
      <div class="mb-5">
        <h1 class="font-serif text-2xl font-semibold text-ink-600">设置</h1>
        <p class="text-sm text-ink-400 mt-1">权限角色与字段可视化配置（随账号云端同步）</p>
      </div>
      <div class="tab-bar mb-6" id="setTabs">
        <button class="tab-btn ${this._tab === 'role' ? 'active' : ''}" data-tab="role">权限设置</button>
        <button class="tab-btn ${this._tab === 'field' ? 'active' : ''}" data-tab="field">字段配置</button>
        <button class="tab-btn ${this._tab === 'cloud' ? 'active' : ''}" data-tab="cloud">云端同步</button>
      </div>
      <div id="setBody"></div>`;
    root.querySelectorAll('#setTabs .tab-btn').forEach(b => {
      b.onclick = () => { this._tab = b.dataset.tab; this.render(root); };
    });
    const body = root.querySelector('#setBody');
    if (this._tab === 'role') this._role(body);
    else if (this._tab === 'field') this._field(body);
    else this._cloud(body);
    if (window.lucide) lucide.createIcons();
  },

  /* ---------- 权限设置（RBAC） ---------- */
  _role(root) {
    const cur = Router.role();
    const roles = [
      { id: 'owner',  name: '主理人',     desc: '全部权限：查看/编辑所有模块，并管理「设置」与字段配置。', level: 3 },
      { id: 'family', name: '家属',       desc: '可查看与生活/民宿各模块，可操作房态，但不可进入「设置」管理。', level: 2 },
      { id: 'guest',  name: '临时访客',   desc: '仅查看首页与房态（只读），不含编辑操作与设置入口。', level: 1 }
    ];
    root.innerHTML = `
      <div class="surface-card p-5 mb-5">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-serif text-lg text-ink-600">当前角色</h3>
          <span class="chip chip-clay">${roles.find(r => r.id === cur)?.name || '主理人'}</span>
        </div>
        <p class="text-sm text-ink-500">切换角色后，越权模块将在导航中隐藏且无法直接访问。更改实时生效并随账号云端同步。</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        ${roles.map(r => `
          <div class="card p-5 ${cur === r.id ? 'ring-2 ring-clay-300' : ''}">
            <div class="flex items-center justify-between">
              <span class="font-medium text-ink-600">${r.name}</span>
              ${cur === r.id ? '<span class="badge badge-ok">当前</span>' : `<span class="text-xs text-ink-300">L${r.level}</span>`}
            </div>
            <p class="text-xs text-ink-400 mt-2 mb-3">${r.desc}</p>
            ${cur === r.id ? '' : `<button class="btn btn-primary btn-sm" data-setrole="${r.id}">切换为${r.name}</button>`}
          </div>`).join('')}
      </div>
      <div class="surface-card p-5 mt-5">
        <h3 class="font-serif text-lg text-ink-600 mb-3">角色能力矩阵</h3>
        <table class="mini-table">
          <thead><tr><th>模块 / 操作</th><th>主理人</th><th>家属</th><th>临时访客</th></tr></thead>
          <tbody>
            ${[
              ['首页总览', '✅', '✅', '✅'],
              ['生活管理（记账/健康/成长）', '✅', '✅', '✅'],
              ['房态管理（查看）', '✅', '✅', '✅'],
              ['房态管理（新增/改期/取消）', '✅', '✅', '⛔'],
              ['自媒体中台', '✅', '✅', '⛔'],
              ['设置（权限/字段配置）', '✅', '⛔', '⛔']
            ].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}
          </tbody>
        </table>
        <p class="text-xs text-ink-300 mt-3">说明：临时访客的房态编辑入口在前端会提示无权限；如需更严格只读，可在 RoomState 操作入口追加角色校验。</p>
      </div>`;
    root.querySelectorAll('[data-setrole]').forEach(b => b.onclick = () => {
      Store.set('yxz_role', b.dataset.setrole);
      Notify.success('已切换角色：' + (roles.find(r => r.id === b.dataset.setrole).name));
      if (window.applyRoleNav) window.applyRoleNav();
      this._role(root);
    });
  },

  /* ---------- 字段可视化配置 ---------- */
  async _field(root) {
    let hk = Store.get('cfg_hot_keywords', null);
    if (!hk) { try { hk = await (await fetch('data/hot_keywords.json?t=' + Date.now())).json(); } catch (e) { hk = { primary: [], secondary: [] }; } }
    let mb = Store.get('cfg_medical_blacklist', null);
    if (!mb) { try { mb = await (await fetch('data/medical_blacklist.json?t=' + Date.now())).json(); } catch (e) { mb = { rules: { block: { words: [] } } }; } }
    const blockWords = (mb.rules && mb.rules.block && mb.rules.block.words) || [];
    const budgets = Store.get('budgets', {});

    root.innerHTML = `
      <div class="space-y-5">
        <div class="surface-card p-5">
          <h3 class="font-serif text-lg text-ink-600 mb-1">热点关键词</h3>
          <p class="text-xs text-ink-400 mb-3">用于自媒体选题与热点采集，标签形式管理，保存即生效。</p>
          <label class="text-sm text-ink-500">主关键词</label>
          <div class="tag-editor mt-1" data-key="primary"></div>
          <label class="text-sm text-ink-500 mt-3 block">次级关键词</label>
          <div class="tag-editor mt-1" data-key="secondary"></div>
          <button class="btn btn-primary btn-sm mt-3" id="saveHk">保存关键词</button>
        </div>

        <div class="surface-card p-5">
          <h3 class="font-serif text-lg text-ink-600 mb-1">医疗合规词库（阻断级）</h3>
          <p class="text-xs text-ink-400 mb-3">命中即要求改写，标签形式管理，保存即生效。</p>
          <div class="tag-editor" data-key="block"></div>
          <button class="btn btn-primary btn-sm mt-3" id="saveMb">保存合规词库</button>
        </div>

        <div class="surface-card p-5">
          <h3 class="font-serif text-lg text-ink-600 mb-1">月度预算</h3>
          <p class="text-xs text-ink-400 mb-3">设置分类月度预算，超 90% 自动提醒。</p>
          <div id="budgetEditor" class="grid grid-cols-1 sm:grid-cols-2 gap-3"></div>
          <button class="btn btn-primary btn-sm mt-3" id="saveBudget">保存预算</button>
        </div>
      </div>`;

    // 标签编辑器
    root.querySelectorAll('.tag-editor').forEach(te => {
      const key = te.dataset.key;
      const vals = (key === 'block' ? blockWords.slice() : (hk[key] || []).slice());
      const render = () => {
        te.innerHTML = `
          <div class="flex flex-wrap gap-2 mb-2 min-h-[28px]">${
            vals.length ? vals.map((v, i) => `<span class="chip chip-sage">${v}<button class="ml-1 text-ink-300 hover:text-red-500" data-rm="${i}">×</button></span>`).join('')
                       : '<span class="text-xs text-ink-300">暂无，添加后生效</span>'
          }</div>
          <div class="flex gap-2">
            <input class="field field-xs flex-1" placeholder="输入后回车添加" data-add>
            <button class="btn btn-secondary btn-xs" data-addbtn>添加</button>
          </div>`;
        te.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { vals.splice(Number(b.dataset.rm), 1); render(); });
        const inp = te.querySelector('[data-add]');
        const add = () => { const v = inp.value.trim(); if (v && !vals.includes(v)) { vals.push(v); render(); } inp.value = ''; };
        inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
        te.querySelector('[data-addbtn]').onclick = add;
        te._vals = vals;
      };
      render();
    });

    // 预算编辑器
    const be = root.querySelector('#budgetEditor');
    const cats = ['餐饮', '购物', '居住', '交通', '工资', '娱乐', '医疗', '其他'];
    be.innerHTML = cats.map(c => `
      <div class="flex items-center gap-2">
        <span class="text-sm text-ink-500 w-16">${c}</span>
        <input class="field field-xs flex-1" type="number" min="0" data-cat="${c}" value="${budgets[c]?.limit || ''}" placeholder="月度上限¥">
      </div>`).join('');

    root.querySelector('#saveHk').onclick = () => {
      const primary = root.querySelector('[data-key="primary"]')._vals || [];
      const secondary = root.querySelector('[data-key="secondary"]')._vals || [];
      Store.set('cfg_hot_keywords', { primary, secondary });
      Notify.success('热点关键词已保存');
    };
    root.querySelector('#saveMb').onclick = () => {
      const words = root.querySelector('[data-key="block"]')._vals || [];
      const base = (mb && mb.rules) ? mb : { rules: { block: { words: [] }, warn: { words: [] }, rewrite: { replacements: {} } } };
      base.rules = base.rules || {};
      base.rules.block = Object.assign({ level: 'high', label: '阻断级 - 必须改写' }, base.rules.block || {});
      base.rules.block.words = words;
      Store.set('cfg_medical_blacklist', base);
      if (window.Compliance) Compliance._dict = base; // 即时生效
      Notify.success('合规词库已保存');
    };
    root.querySelector('#saveBudget').onclick = () => {
      const b = {};
      be.querySelectorAll('[data-cat]').forEach(inp => { const v = Number(inp.value); if (v > 0) b[inp.dataset.cat] = { limit: v }; });
      Store.set('budgets', b);
      Notify.success('预算已保存');
    };
  },

  /* ---------- 云端同步与 AI 后端配置 ---------- */
  _cloud(root) {
    const sheetApi = Store.get('yxz_sheet_api', window.__SHEET_API__ || '');
    const aiEndpoint = Store.get('yxz_ai_endpoint', '');
    const aiKey = Store.get('yxz_ai_key', '');
    const aiModel = Store.get('yxz_ai_model', 'gpt-4o-mini');
    root.innerHTML = `
      <div class="space-y-5">
        <div class="surface-card p-5">
          <h3 class="font-serif text-lg text-ink-600 mb-1">腾讯文档同步代理</h3>
          <p class="text-xs text-ink-400 mb-3">填入你部署的代理服务地址，即可在任意设备上实现房态/订单的真·实时同步。CloudStudio 静态部署本身不运行后端，需另起代理。</p>
          <label class="field-label">代理 Base URL</label>
          <input id="cfgSheetApi" class="field" value="${sheetApi}" placeholder="https://your-proxy.example.com 或 http://127.0.0.1:8080">
          <div class="text-xs text-ink-300 mt-2">代理代码位于 <code>server/proxy.py</code>（Python）与 <code>server/proxy-node.js</code>（Node）。本地开发运行 <code>python server/proxy.py</code>。</div>
          <div class="mt-3 flex gap-2">
            <button class="btn btn-primary btn-sm" id="saveSheetApi">保存并探测</button>
            <button class="btn btn-secondary btn-sm" id="resetSheetApi">恢复默认</button>
          </div>
          <div id="sheetApiStatus" class="text-xs mt-2"></div>
        </div>

        <div class="surface-card p-5">
          <h3 class="font-serif text-lg text-ink-600 mb-1">读书 AI 后端</h3>
          <p class="text-xs text-ink-400 mb-3">不填时默认使用 Google Books 公开 API；填写后可接入 OpenAI/Claude/Gemini 等真实模型后端。</p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="md:col-span-2"><label class="field-label">后端 Endpoint</label><input id="cfgAiEndpoint" class="field" value="${aiEndpoint}" placeholder="https://your-ai-proxy.example.com"></div>
            <div><label class="field-label">Model</label><input id="cfgAiModel" class="field" value="${aiModel}" placeholder="gpt-4o-mini"></div>
          </div>
          <label class="field-label mt-3">API Key（可选）</label>
          <input id="cfgAiKey" type="password" class="field" value="${aiKey}" placeholder="sk-...">
          <button class="btn btn-primary btn-sm mt-3" id="saveAi">保存 AI 配置</button>
          <button class="btn btn-secondary btn-sm mt-3" id="testAi">测试连接</button>
          <div id="aiStatus" class="text-xs mt-2"></div>
        </div>
      </div>`;

    const status = root.querySelector('#sheetApiStatus');
    root.querySelector('#saveSheetApi').onclick = async () => {
      const url = root.querySelector('#cfgSheetApi').value.trim();
      Store.set('yxz_sheet_api', url);
      window.__SHEET_API__ = url || 'http://127.0.0.1:8080';
      status.innerHTML = '<span class="text-ink-400">探测中…</span>';
      try {
        const r = await fetch((url || window.__SHEET_API__) + '/health', { method: 'GET' });
        const j = await r.json();
        status.innerHTML = `<span class="text-sage-600">✅ 代理可达 · 模式 ${j.mode || 'unknown'}</span>`;
        Notify.success('代理配置已保存');
        if (window.Sheet && Sheet.probe) { await Sheet.probe(); Notify.toast('Sheet 模式：' + (Sheet.MOCK ? '本地 Mock' : '腾讯文档'), 'success'); }
      } catch (e) {
        status.innerHTML = '<span class="text-clay-600">⚠️ 代理不可达，将使用本地 Mock 数据</span>';
        Notify.warn('代理探测失败，已保存配置但当前不可用');
      }
    };
    root.querySelector('#resetSheetApi').onclick = () => {
      Store.set('yxz_sheet_api', '');
      window.__SHEET_API__ = 'http://127.0.0.1:8080';
      root.querySelector('#cfgSheetApi').value = window.__SHEET_API__;
      Notify.success('已恢复默认代理地址');
    };
    root.querySelector('#saveAi').onclick = () => {
      Store.set('yxz_ai_endpoint', root.querySelector('#cfgAiEndpoint').value.trim());
      Store.set('yxz_ai_model', root.querySelector('#cfgAiModel').value.trim());
      Store.set('yxz_ai_key', root.querySelector('#cfgAiKey').value.trim());
      Notify.success('AI 后端配置已保存');
    };
    root.querySelector('#testAi').onclick = async () => {
      const ep = root.querySelector('#cfgAiEndpoint').value.trim();
      const key = root.querySelector('#cfgAiKey').value.trim();
      const model = root.querySelector('#cfgAiModel').value.trim() || 'gpt-4o-mini';
      const st = root.querySelector('#aiStatus');
      st.innerHTML = '<span class="text-ink-400">测试中…</span>';
      if (!ep) { st.innerHTML = '<span class="text-clay-600">未配置 Endpoint</span>'; return; }
      try {
        const r = await fetch(ep.replace(/\/$/,'') + '/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { 'Authorization': 'Bearer ' + key } : {}) },
          body: JSON.stringify({ title: '被讨厌的勇气', author: '岸见一郎', progress: 50, tags: ['心理'] })
        });
        const j = await r.json();
        if (j.text || j.summary) st.innerHTML = `<span class="text-sage-600">✅ 连接成功 · ${j.src || 'ai'} · ${j.model || model}</span>`;
        else st.innerHTML = `<span class="text-clay-600">⚠️ 返回格式异常：${JSON.stringify(j).slice(0, 120)}</span>`;
      } catch (e) {
        st.innerHTML = `<span class="text-clay-600">❌ 连接失败：${e.message}</span>`;
      }
    };
  }
};
window['biz-settings'] = BizSettings;
