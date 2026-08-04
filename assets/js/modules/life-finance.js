/* ====================================================================
   life-finance.js - 经济管家模块
   子系统：资产总览 / 收支记账 / 理财健康 / 预算管控
   SPA module: window['life-finance'].render(root)
   ==================================================================== */

const LifeFinance = {
  name: '经济管家',
  desc: '储蓄 + 理财全管理',
  async render(root) {
    root.innerHTML = '';
    root.classList.add('module-life-finance');

    const tabs = [
      { id:'overview', label:'资产总览' },
      { id:'ledger',   label:'收支记账' },
      { id:'health',   label:'理财健康' },
      { id:'budget',   label:'预算管控' }
    ];
    let activeTab = Store.get('lf_tab', 'overview');

    const topEl = document.createElement('div');
    topEl.className = 'module-page';
    topEl.innerHTML = `
      <div class="mb-6">
        <h1 class="section-title">经济管家</h1>
        <p class="text-ink-400 text-sm mt-1">资产 · 理财 · 记账 · 预算，一个不落</p>
      </div>
      <div class="tab-bar mb-6" id="fTabBar">
        ${tabs.map(t=>`<button class="tab-btn ${t.id===activeTab?'active':''}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div id="fPanel"></div>`;
    root.appendChild(topEl);

    const panel = topEl.querySelector('#fPanel');
    const switchTab = (id) => {
      activeTab = id; Store.set('lf_tab', id);
      topEl.querySelectorAll('#fTabBar .tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === id));
      renderPanel(id, panel);
    };
    topEl.querySelectorAll('#fTabBar .tab-btn').forEach(b =>
      b.onclick = () => switchTab(b.dataset.tab));
    switchTab(activeTab);
  }
};

/* ============ 面板分发 ============ */
function renderPanel(id, panel) {
  panel.innerHTML = '';
  if (id === 'overview') renderOverview(panel);
  else if (id === 'ledger') renderLedger(panel);
  else if (id === 'health') renderHealth(panel);
  else if (id === 'budget') renderBudget(panel);
}

/* ---------- 资产总览 ---------- */
function renderOverview(panel) {
  const accs = Store.list('accounts');
  const savings = accs.filter(a=>a.type==='savings').reduce((s,a)=>s+Number(a.balance||0),0);
  const wealth  = accs.filter(a=>a.type==='wealth').reduce((s,a)=>s+Number(a.balance||0),0);
  const credit  = accs.filter(a=>a.type==='credit').reduce((s,a)=>s+Number(a.balance||0),0);
  const total   = savings + wealth + credit;

  panel.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
      <div class="card p-4"><div class="text-xs text-ink-400">资产总额</div><div class="text-2xl font-serif text-ink-600 mt-1 font-mono">¥${total.toFixed(2)}</div></div>
      <div class="card p-4"><div class="text-xs text-ink-400">储蓄</div><div class="text-2xl font-serif text-sage-600 mt-1 font-mono">¥${savings.toFixed(2)}</div></div>
      <div class="card p-4"><div class="text-xs text-ink-400">理财</div><div class="text-2xl font-serif text-clay-600 mt-1 font-mono">¥${wealth.toFixed(2)}</div></div>
      <div class="card p-4"><div class="text-xs text-ink-400">信用卡</div><div class="text-2xl font-serif text-ink-600 mt-1 font-mono">¥${credit.toFixed(2)}</div></div>
    </div>
    <div class="card p-5 mb-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-serif text-lg text-ink-600">资产配置结构</h3>
        <button class="btn btn-primary btn-sm" id="addAcc">+ 添加账户</button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div><canvas id="assetPie" height="180"></canvas></div>
        <div class="space-y-2" id="assetList">
          ${accs.length?accs.map(a=>`<div class="flex justify-between items-center border rounded-lg px-3 py-2">
            <span class="text-sm text-ink-600">${a.name} <span class="text-xs text-ink-400">· ${a.type==='savings'?'储蓄':a.type==='wealth'?'理财':'信用卡'}</span></span>
            <span class="font-mono text-sm ${a.type==='credit'?'text-clay-500':'text-sage-600'}">¥${Number(a.balance||0).toFixed(2)}</span>
          </div>`).join(''):'<div class="text-sm text-ink-400">暂无账户，点击添加</div>'}
        </div>
      </div>
    </div>
    <div class="card p-5 mb-5">
      <h3 class="font-serif text-lg text-ink-600 mb-3">民宿营收（房态模块实时同步）</h3>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3" id="bizRevCards"></div>
    </div>`;

  const cp = panel.querySelector('#assetPie');
  if (cp && window.Chart) {
    new Chart(cp, { type:'doughnut',
      data:{ labels:['储蓄','理财','信用卡'], datasets:[{ data:[savings,wealth,credit], backgroundColor:['#a3ba97','#d09a7e','#c9b89a'], borderWidth:0 }] },
      options:{ plugins:{ legend:{ position:'bottom' } }, maintainAspectRatio:false } });
  }

  const rev = (window.RoomState ? RoomState.revenueSummary(DateUtil.today()) : null);
  const revEl = panel.querySelector('#bizRevCards');
  if (revEl && rev) {
    revEl.innerHTML = [
      ['本月营收', '¥' + rev.totalRevenue.toLocaleString()],
      ['本月间夜', rev.totalNights],
      ['本月入住率', rev.occRate + '%'],
      ['可租单元', rev.totalRooms]
    ].map(([l,v]) => `<div class="surface-card p-3"><div class="text-xs text-ink-400">${l}</div><div class="text-lg font-serif text-clay-600 mt-1">${v}</div></div>`).join('');
  }

  panel.querySelector('#addAcc').onclick = () => {
    const name = prompt('账户名称：',''); if(name==null) return;
    const balance = parseFloat(prompt('余额：','0'))||0;
    const type = prompt('类型（savings=储蓄 / wealth=理财 / credit=信用卡）：','savings');
    Store.add('accounts', { id:'a'+Date.now(), name, balance, type });
    Notify.success('账户已添加'); renderOverview(panel);
  };
}

/* ---------- 收支记账 ---------- */
function renderLedger(panel) {
  const items = Store.ledger().slice().reverse();
  const catStat = {};
  items.forEach(i=>{ catStat[i.cat]=(catStat[i.cat]||0)+Number(i.amount||0); });
  const needless = items.filter(i=>i.needless).reduce((s,i)=>s+Number(i.amount||0),0);

  // —— 图表数据：分类支出占比 ——
  const CAT_COLORS = { '餐饮':'#e0a96d','交通':'#6b8f71','购物':'#c98b6b','居住':'#8aa6a3','医疗':'#b56b5e','娱乐':'#9a8bb5','其他':'#c9b89a' };
  const catExp = {};
  items.forEach(i => { const a = Number(i.amount || 0); if (a < 0) catExp[i.cat || '其他'] = (catExp[i.cat || '其他'] || 0) + (-a); });
  const catLabels = Object.keys(catExp);
  const catValues = catLabels.map(c => catExp[c]);
  const totalExp = catValues.reduce((s, n) => s + n, 0);
  // —— 图表数据：月度收支趋势 ——
  const monthMap = {};
  items.forEach(i => {
    const m = (i.date || '').slice(0, 7); if (!m) return;
    const a = Number(i.amount || 0);
    const e = monthMap[m] || { inc: 0, exp: 0 };
    if (a >= 0) e.inc += a; else e.exp += (-a);
    monthMap[m] = e;
  });
  const months = Object.keys(monthMap).sort();
  const incData = months.map(m => monthMap[m].inc);
  const expData = months.map(m => monthMap[m].exp);
  // —— 非必要支出透视 ——
  const needlessAbs = Math.abs(needless);
  const needlessPct = totalExp ? Math.round(needlessAbs / totalExp * 100) : 0;
  const needlessCat = {};
  items.filter(i => i.needless).forEach(i => { const a = Number(i.amount || 0); if (a < 0) needlessCat[i.cat || '其他'] = (needlessCat[i.cat || '其他'] || 0) + (-a); });

  panel.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-serif text-lg text-ink-600">收支记账</h3>
      <div class="flex gap-2">
        <button class="btn btn-secondary btn-sm" id="importCsv">批量导入</button>
        <button class="btn btn-primary btn-sm" id="addItem">+ 记一笔</button>
      </div>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <div class="card p-3"><div class="text-xs text-ink-400">笔数</div><div class="text-xl font-serif text-ink-600">${items.length}</div></div>
      <div class="card p-3"><div class="text-xs text-ink-400">非必要支出</div><div class="text-xl font-serif text-clay-500">¥${needless.toFixed(2)}</div></div>
      <div class="card p-3"><div class="text-xs text-ink-400">支出分类</div><div class="text-xl font-serif text-ink-600">${Object.keys(catStat).length}</div></div>
      <div class="card p-3"><div class="text-xs text-ink-400">本月支出</div><div class="text-xl font-serif text-clay-500">¥${(items.filter(i=>i.date&&i.date.startsWith(DateUtil.today().slice(0,7))).reduce((s,i)=>s+Number(i.amount||0),0)).toFixed(2)}</div></div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
      <div class="card p-5">
        <div class="flex items-baseline justify-between mb-3">
          <h4 class="font-serif text-base text-ink-600">支出分类占比</h4>
          <span class="text-xs text-ink-400">全部记账</span>
        </div>
        <div class="relative" style="height:220px"><canvas id="ledgerCatChart"></canvas></div>
      </div>
      <div class="card p-5">
        <div class="flex items-baseline justify-between mb-3">
          <h4 class="font-serif text-base text-ink-600">月度收支趋势</h4>
          <span class="text-xs text-ink-400">收入 vs 支出</span>
        </div>
        <div class="relative" style="height:220px"><canvas id="ledgerMonthChart"></canvas></div>
      </div>
    </div>
    <div class="card p-5 mb-4">
      <div class="flex items-baseline justify-between mb-3">
        <h4 class="font-serif text-base text-ink-600">非必要支出透视</h4>
        <span class="text-xs text-ink-400">可优化空间</span>
      </div>
      <div id="needlessInsight"></div>
    </div>
    <div class="card p-5">
      <div class="overflow-x-auto">
        <table class="mini-table">
          <thead><tr><th>日期</th><th>分类</th><th>说明</th><th>金额</th><th>非必要</th><th></th></tr></thead>
          <tbody>
            ${items.length?items.map(i=>`<tr>
              <td>${i.date||'—'}</td><td>${i.cat||'—'}</td><td class="max-w-[200px] truncate">${i.note||''}</td>
              <td class="${Number(i.amount||0)<0?'text-sage-600':'text-clay-500'} font-mono">${Number(i.amount||0)<0?'-':'+'}¥${Math.abs(Number(i.amount||0)).toFixed(2)}</td>
              <td>${i.needless?'<span class="badge badge-warn">是</span>':'<span class="text-ink-300">—</span>'}</td>
              <td><button class="text-ink-400 hover:text-red-500" data-del="${i.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td>
            </tr>`).join(''):'<tr><td colspan="6" class="text-center text-ink-400 py-4">暂无记账，点击「记一笔」</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;

  // 渲染图表 + 非必要支出透视
  setTimeout(() => {
    const ni = document.getElementById('needlessInsight');
    if (ni) {
      ni.innerHTML = needlessAbs > 0 ? `
        <div class="flex items-center justify-between text-sm mb-2">
          <span class="text-ink-500">非必要支出合计</span>
          <span class="font-mono text-clay-500">¥${needlessAbs.toFixed(2)}（占支出 ${needlessPct}%）</span>
        </div>
        <div class="progress-bar mb-3"><div class="progress-fill bg-clay-500" style="width:${needlessPct}%"></div></div>
        <div class="space-y-1.5">
          ${Object.entries(needlessCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `
            <div class="flex items-center justify-between text-xs">
              <span class="text-ink-400">${c}</span>
              <span class="font-mono text-ink-500">¥${v.toFixed(2)}</span>
            </div>`).join('')}
        </div>
      ` : '<div class="text-sm text-ink-300">暂无非必要支出记录，保持得不错 ✨</div>';
    }
    if (!window.Chart) return;
    const cc = document.getElementById('ledgerCatChart');
    if (cc && catLabels.length) {
      new Chart(cc, { type: 'doughnut',
        data: { labels: catLabels, datasets: [{ data: catValues, backgroundColor: catLabels.map(c => CAT_COLORS[c] || '#c9b89a'), borderWidth: 2, borderColor: '#fbf7ef' }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'IBM Plex Sans' }, boxWidth: 12 } } } } });
    }
    const mc = document.getElementById('ledgerMonthChart');
    if (mc && months.length) {
      new Chart(mc, { type: 'bar',
        data: { labels: months, datasets: [
          { label: '收入', data: incData, backgroundColor: '#7d9a6f' },
          { label: '支出', data: expData, backgroundColor: '#b97859' }
        ] },
        options: { maintainAspectRatio: false, responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { family: 'IBM Plex Sans' } } } },
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(155,148,132,.12)' } }, x: { grid: { display: false } } } } });
    }
  }, 60);

  panel.querySelector('#addItem').onclick = () => {
    const note = prompt('说明：',''); if(note==null) return;
    const amount = parseFloat(prompt('金额（负数=支出）：','-100')); if(isNaN(amount)) return;
    const cat = prompt('分类（餐饮/交通/购物/居住/医疗/娱乐/其他）：','餐饮');
    const needless = confirm('是否非必要支出？');
    Store.addLedger({ date:DateUtil.today(), cat, note, amount, needless });
    Notify.success('已记录'); renderLedger(panel);
  };
  panel.querySelector('#importCsv').onclick = () => {
    const raw = prompt('粘贴 CSV（每行：日期,分类,说明,金额,是否非必要）：','');
    if(!raw) return;
    raw.trim().split('\n').forEach(line=>{
      const p = line.split(',');
      if(p.length<4) return;
      Store.addLedger({ date:p[0].trim(), cat:p[1].trim(), note:p[2].trim(), amount:parseFloat(p[3])||0, needless:(p[4]||'').includes('是') });
    });
    Notify.success('批量导入完成'); renderLedger(panel);
  };
  panel.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ if(confirm('删除？')){Store.removeById('ledger',b.dataset.del);renderLedger(panel);} });
}

/* ---------- 理财健康 ---------- */
function renderHealth(panel) {
  const holdings = Store.list('holdings');
  const total = holdings.reduce((s,h)=>s+Number(h.value||0),0);
  const riskMap = { low:'低风险', mid:'中风险', high:'高风险' };
  panel.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-serif text-lg text-ink-600">理财健康评估</h3>
      <button class="btn btn-primary btn-sm" id="addHold">+ 添加持仓</button>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <div class="card p-4"><div class="text-xs text-ink-400">持仓总额</div><div class="text-2xl font-serif text-ink-600 mt-1 font-mono">¥${total.toFixed(2)}</div></div>
      <div class="card p-4"><div class="text-xs text-ink-400">持仓数</div><div class="text-2xl font-serif text-ink-600 mt-1">${holdings.length}</div></div>
      <div class="card p-4"><div class="text-xs text-ink-400">健康度</div><div class="text-2xl font-serif ${holdings.length?'text-sage-600':'text-ink-400'} mt-1">${holdings.length?'良好':'待配置'}</div></div>
    </div>
    <div class="card p-5">
      <div class="space-y-2">
        ${holdings.length?holdings.map(h=>`<div class="flex justify-between items-center border rounded-lg px-3 py-2">
          <div><span class="text-sm text-ink-600 font-medium">${h.name}</span> <span class="text-xs text-ink-400">· ${riskMap[h.risk]||'未评级'}</span></div>
          <div class="flex items-center gap-3"><span class="font-mono text-sm ${Number(h.profit||0)>=0?'text-sage-600':'text-clay-500'}">¥${Number(h.value||0).toFixed(2)} (${Number(h.profit||0)>=0?'+':''}${Number(h.profit||0).toFixed(2)})</span>
          <button class="text-ink-400 hover:text-red-500" data-del="${h.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>
        </div>`).join(''):'<div class="text-sm text-ink-400">暂无持仓</div>'}
      </div>
      ${holdings.length?`<div class="mt-4 p-3 bg-sage-50 rounded text-xs text-sage-700">建议：保持低风险与中风险持仓 3:7 配置，单产品占比不超过 30%，设置收益回撤 10% 预警线。</div>`:''}
    </div>`;

  panel.querySelector('#addHold').onclick = () => {
    const name = prompt('产品名称：',''); if(name==null) return;
    const value = parseFloat(prompt('当前市值：','0'))||0;
    const profit = parseFloat(prompt('累计收益：','0'))||0;
    const risk = prompt('风险等级（low/mid/high）：','mid');
    Store.add('holdings', { id:'h'+Date.now(), name, value, profit, risk });
    Notify.success('已添加持仓'); renderHealth(panel);
  };
  panel.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ if(confirm('删除？')){Store.removeById('holdings',b.dataset.del);renderHealth(panel);} });
}

/* ---------- 预算管控 ---------- */
function renderBudget(panel) {
  const budgets = Store.get('budgets', {});
  const month = DateUtil.today().slice(0,7);
  const spent = Store.ledger().filter(i=>i.date&&i.date.startsWith(month)&&Number(i.amount||0)<0)
                  .reduce((s,i)=>s+Math.abs(Number(i.amount||0)),0);
  panel.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <h3 class="font-serif text-lg text-ink-600">预算管控</h3>
      <button class="btn btn-primary btn-sm" id="setBudget">设置预算</button>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card p-5">
        <div class="text-sm text-ink-400">${month} 月度预算</div>
        <div class="text-3xl font-serif text-ink-600 mt-1 font-mono">¥${Number(budgets.monthly||0).toFixed(2)}</div>
        <div class="mt-3"><div class="flex justify-between text-xs text-ink-400"><span>已支出</span><span>¥${spent.toFixed(2)}</span></div>
          <div class="progress-bar mt-1"><div class="progress-fill ${spent>(budgets.monthly||0)?'bg-clay-500':''}" style="width:${budgets.monthly?Math.min(100,spent/budgets.monthly*100):0}%"></div></div>
        </div>
        ${budgets.monthly && spent>budgets.monthly?`<div class="mt-3 p-2 bg-clay-50 text-clay-600 text-xs rounded flex items-center gap-2"><i data-lucide="alert-triangle" class="w-4 h-4"></i>本月已超支 ¥${(spent-budgets.monthly).toFixed(2)}</div>`:''}
      </div>
      <div class="card p-5">
        <div class="text-sm text-ink-400">年度预算</div>
        <div class="text-3xl font-serif text-ink-600 mt-1 font-mono">¥${Number(budgets.yearly||0).toFixed(2)}</div>
        <div class="text-xs text-ink-400 mt-3">年度预算用于长期消费规划，月度预算按月追踪。</div>
        ${budgets.yearly?`<div class="mt-3 p-2 bg-sage-50 text-sage-700 text-xs rounded">建议将年化非必要支出控制在年度预算的 30% 以内。</div>`:''}
      </div>
    </div>`;

  panel.querySelector('#setBudget').onclick = () => {
    const m = prompt('月度预算（元）：', budgets.monthly||'');
    if(m==null) return;
    const y = prompt('年度预算（元）：', budgets.yearly||'');
    Store.set('budgets', { monthly:parseFloat(m)||0, yearly:parseFloat(y)||0 });
    Notify.success('预算已保存'); renderBudget(panel);
  };
}
window['life-finance'] = LifeFinance;
