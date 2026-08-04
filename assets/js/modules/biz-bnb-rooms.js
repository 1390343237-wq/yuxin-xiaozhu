/* ====================================================================
   biz-bnb-rooms.js - 房态管理（民宿管理模块下属页）
   四视图：套房分组日历(默认) / 当日工作看板 / 订单明细列表
   顶部固定：房态数据总览卡片 + 自然语言指令栏
   所有写操作经 RoomState 锁房引擎校验闭环
   ==================================================================== */

const BizBnbRooms = {
  _tab: 'dashboard',
  _filter: { room:'', type:'', status:'', from:'', to:'' },

  async render(root) {
    root.innerHTML = `
      <div class="mb-5">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 class="font-serif text-2xl font-semibold text-ink-600">房态管理</h1>
            <p class="text-sm text-ink-400 mt-1">唯一数据底座：腾讯文档《【愈心小筑】入住情况》· 整分租互斥锁房 · 实时同步</p>
          </div>
          <div class="flex gap-2">
            <button id="roomsRefresh" class="btn btn-ghost"><i data-lucide="refresh-cw" class="w-4 h-4"></i> 刷新</button>
            <button id="roomsAdd" class="btn btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> 新增订单</button>
          </div>
        </div>
      </div>

      <!-- 自然语言指令栏 -->
      <div class="surface-card p-3 mb-4 flex items-center gap-2 flex-wrap">
        <i data-lucide="message-square-command" class="w-4 h-4 text-sage-600"></i>
        <input id="nlInput" class="field flex-1 min-w-[220px]" placeholder="用自然语言操作，例如：新增 407 套房整租订单 8月10日入住 8月12日退房 客人张先生 总价760元" />
        <button id="nlRun" class="btn btn-primary"><i data-lucide="sparkles" class="w-4 h-4"></i> 执行</button>
        <span class="text-xs text-ink-300">支持：新增订单 / 续住 / 查询可售空房 / 标记打扫完成</span>
      </div>

      <!-- 总览卡片 -->
      <div id="roomsOverview" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5"></div>

      <!-- Tab 切换 -->
      <div class="flex gap-1 mb-4 border-b border-ink-100 overflow-x-auto">
        <button class="rooms-tab px-4 py-2 text-sm font-medium whitespace-nowrap" data-tab="dashboard">总控台</button>
        <button class="rooms-tab px-4 py-2 text-sm font-medium whitespace-nowrap" data-tab="timeline">房态时间轴</button>
        <button class="rooms-tab px-4 py-2 text-sm font-medium whitespace-nowrap" data-tab="calendar">套房分组日历</button>
        <button class="rooms-tab px-4 py-2 text-sm font-medium whitespace-nowrap" data-tab="board">当日工作看板</button>
        <button class="rooms-tab px-4 py-2 text-sm font-medium whitespace-nowrap" data-tab="orders">订单明细列表</button>
        <button class="rooms-tab px-4 py-2 text-sm font-medium whitespace-nowrap" data-tab="report">营收报告</button>
      </div>

      <div id="roomsView"></div>
    `;

    await this._renderOverview();
    await this._renderView();

    root.querySelector('#roomsRefresh').onclick = () => { this._renderOverview(); this._renderView(); };
    root.querySelector('#roomsAdd').onclick = () => this.openOrderModal(null, {});
    root.querySelector('#nlRun').onclick = () => this._runNL(root.querySelector('#nlInput').value);
    root.querySelector('#nlInput').addEventListener('keydown', e => { if (e.key === 'Enter') this._runNL(e.target.value); });
    root.querySelectorAll('.rooms-tab').forEach(b => {
      b.onclick = () => { this._tab = b.dataset.tab; this._renderView(); };
    });
    if (window.lucide) lucide.createIcons();
  },

  async _renderOverview() {
    const el = document.getElementById('roomsOverview');
    if (!el) return;
    const today = DateUtil.today();
    const board = RoomState.dailyBoard();
    const rev = RoomState.revenueSummary(today);
    const vac = RoomState.vacancy(7).filter(v => v.freeDays > 0);
    const vacNights = vac.reduce((s,v)=>s+v.freeDays,0);
    const newOrders = RoomState.orders().filter(o => (o.createdAt||'').slice(0,10) === today || o.checkIn === today).length;
    const pendingTasks = board.checkins.length + board.checkouts.length + board.cleaning.length;
    const cards = [
      { label:'可售房源', value: RoomState.units().length, sub:'总单元数', icon:'home', color:'text-ink-600' },
      { label:'今日入住率', value: rev.occRate + '%', sub:`在住 ${board.occupied.length} 间`, icon:'trending-up', color:'text-sage-600' },
      { label:'今日入住', value: board.checkins.length, sub:'新到店', icon:'log-in', color:'text-emerald-600' },
      { label:'今日退房', value: board.checkouts.length, sub:'需打扫', icon:'log-out', color:'text-orange-600' },
      { label:'待处理任务', value: pendingTasks, sub:`入住+退房+打扫`, icon:'clipboard-list', color:'text-clay-600' },
      { label:'本月累计营收', value:'¥' + rev.totalRevenue.toLocaleString(), sub:`${rev.totalNights} 间夜 · 空置 ${vacNights} 晚`, icon:'banknote', color:'text-clay-600' }
    ];
    el.innerHTML = cards.map(c => `
      <div class="surface-card p-4 kpi-card">
        <div class="flex items-center justify-between">
          <div class="text-xs text-ink-400">${c.label}</div>
          <i data-lucide="${c.icon}" class="w-4 h-4 text-ink-300"></i>
        </div>
        <div class="font-serif text-2xl font-semibold ${c.color} mt-2">${c.value}</div>
        <div class="text-[11px] text-ink-300 mt-1">${c.sub}</div>
      </div>`).join('');
  },

  // ── 视图0：总控台（经营看板） ────────────────────────────────────
  async _renderDashboard(el) {
    const today = DateUtil.today();
    const board = RoomState.dailyBoard();
    const rev = RoomState.revenueSummary(today);
    const vac = RoomState.vacancy(7);
    const orders = RoomState.orders().filter(o => o.status !== '已取消');

    // 早报简报
    const briefItems = [
      `今日入住 ${board.checkins.length} 单：${board.checkins.map(o => o.type==='整租'?o.room+'整套':o.room+'号').join('、') || '—'}`,
      `今日退房 ${board.checkouts.length} 单：${board.checkouts.map(o => o.type==='整租'?o.room+'整套':o.room+'号').join('、') || '—'}`,
      `当前入住率 ${rev.occRate}%：可售 ${RoomState.units().length} 间，在住 ${board.occupied.length} 间`,
      `待处理任务 ${board.checkins.length + board.checkouts.length + board.cleaning.length} 条：${board.cleaning.length ? '退房后深度清洁与布草更换' : '暂无'}`,
      `经营建议：${rev.occRate >= 80 ? '入住率良好，重点跟进退房保洁和客人好评提醒' : '入住率偏低，建议对空置房源做小红书/抖音内容种草'}`
    ];

    // 近7天入住率 + 客源渠道 + 未来7天预警 数据
    const last7 = DateUtil.nextDays(7, DateUtil.addDays(today, -6));
    const occ7 = last7.map(d => {
      const occ = RoomState.units().filter(u => RoomState.unitStatusOn(u.id, d, { today }).startsWith('occupied') || RoomState.unitStatusOn(u.id, d, { today }) === 'reserved').length;
      return { date: d.slice(5), rate: Math.round(occ / RoomState.units().length * 100) };
    });
    const channel = {};
    orders.forEach(o => { const s = o.source || o.customerSource || '未知'; channel[s] = (channel[s] || 0) + 1; });
    const channelArr = Object.entries(channel).map(([k,v])=>({name:k,value:v})).sort((a,b)=>b.value-a.value).slice(0,5);
    const next7 = DateUtil.nextDays(7, today);
    const warn7 = next7.map(d => {
      const free = RoomState.units().filter(u => RoomState.unitStatusOn(u.id, d, { today }) === 'vacant').length;
      return { date: d.slice(5), free };
    });

    // 多房源对比
    const bySuite = {};
    RoomState.SUITES.forEach(s => bySuite[s.id] = { label: s.label, attr: s.attr, revenue: 0, nights: 0, count: 0 });
    orders.forEach(o => {
      const sid = RoomState.suiteOf(o.room)?.id || o.room;
      if (bySuite[sid]) { bySuite[sid].revenue += Number(o.total||0); bySuite[sid].nights += (o.nights||0); bySuite[sid].count += 1; }
    });
    const suiteArr = Object.values(bySuite);
    const maxSuiteRev = Math.max(1, ...suiteArr.map(s => s.revenue));

    el.innerHTML = `
      <!-- 早报简报 -->
      <div class="surface-card p-5 mb-5">
        <div class="flex items-baseline justify-between mb-3">
          <h3 class="font-serif text-lg font-semibold text-ink-600">早报简报 · ${today}</h3>
          <span class="chip chip-sage text-[11px]">每日 8:00 自动生成</span>
        </div>
        <ul class="space-y-2">
          ${briefItems.map(it => `<li class="flex items-start gap-2 text-sm text-ink-500"><span class="w-1.5 h-1.5 rounded-full bg-clay-400 mt-1.5 shrink-0"></span>${it}</li>`).join('')}
        </ul>
      </div>

      <!-- 图表区 -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div class="surface-card p-5">
          <h3 class="font-serif text-base font-semibold text-ink-600 mb-3">近7天入住率趋势</h3>
          <canvas id="chartOcc7" height="160"></canvas>
        </div>
        <div class="surface-card p-5">
          <h3 class="font-serif text-base font-semibold text-ink-600 mb-3">近7天客源渠道占比</h3>
          <div class="flex justify-center"><canvas id="chartChannel" height="160"></canvas></div>
        </div>
        <div class="surface-card p-5">
          <h3 class="font-serif text-base font-semibold text-ink-600 mb-3">未来7天空置预警</h3>
          <canvas id="chartWarn7" height="160"></canvas>
        </div>
      </div>

      <!-- 多房源对比 -->
      <div class="surface-card p-5">
        <div class="flex items-baseline justify-between mb-4">
          <h3 class="font-serif text-lg font-semibold text-ink-600">多房源对比概览</h3>
          <span class="text-sm text-ink-400">本月累计</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          <div class="bg-sand-100/50 rounded-lg p-4 text-center">
            <div class="text-xs text-ink-400">预估总收入</div>
            <div class="font-serif text-2xl font-semibold text-clay-600 mt-1">¥${rev.totalRevenue.toLocaleString()}</div>
          </div>
          <div class="bg-sand-100/50 rounded-lg p-4 text-center">
            <div class="text-xs text-ink-400">入住率</div>
            <div class="font-serif text-2xl font-semibold text-sage-600 mt-1">${rev.occRate}%</div>
            <div class="text-xs text-ink-400">${board.occupied.length} / ${RoomState.units().length} 间</div>
          </div>
          <div class="bg-sand-100/50 rounded-lg p-4 text-center">
            <div class="text-xs text-ink-400">总房源</div>
            <div class="font-serif text-2xl font-semibold text-ink-600 mt-1">${RoomState.units().length} 间</div>
            <div class="text-xs text-ink-400">${RoomState.SUITES.length} 套房</div>
          </div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          ${suiteArr.map(s => {
            const attrTxt = { divide_only:'仅分租', whole_only:'仅整租', both:'可整可分' }[s.attr];
            return `<div class="suite-mini-card p-3 rounded-lg border border-ink-100/60">
              <div class="text-xs text-ink-400 flex justify-between"><span>${s.label}</span><span class="chip chip-sand text-[9px]">${attrTxt}</span></div>
              <div class="font-serif text-lg font-semibold text-ink-600 mt-1">¥${s.revenue.toLocaleString()}</div>
              <div class="text-[10px] text-ink-300 mt-1">入住 ${s.nights} 间夜 · ${s.count} 单</div>
              <div class="progress-bar mt-2"><div class="progress-fill" style="width:${Math.round(s.revenue/maxSuiteRev*100)}%"></div></div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;

    setTimeout(() => {
      if (!window.Chart) return;
      const ctx1 = document.getElementById('chartOcc7');
      if (ctx1) new Chart(ctx1, {
        type: 'line',
        data: { labels: occ7.map(x=>x.date), datasets: [{ label:'入住率%', data: occ7.map(x=>x.rate), borderColor:'#7d9a6f', backgroundColor:'rgba(125,154,111,.15)', fill:true, tension:.35, pointRadius:3 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,max:100,ticks:{stepSize:20},grid:{color:'rgba(46,42,34,.06)'}},x:{grid:{display:false}}} }
      });
      const ctx2 = document.getElementById('chartChannel');
      const palette = ['#7d9a6f','#b97859','#d4a574','#8a9a7d','#c7b299'];
      if (ctx2) new Chart(ctx2, {
        type: 'doughnut',
        data: { labels: channelArr.map(x=>x.name), datasets: [{ data: channelArr.map(x=>x.value), backgroundColor: palette, borderWidth:0 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right',labels:{boxWidth:12,font:{size:11}}}}, cutout:'60%' }
      });
      const ctx3 = document.getElementById('chartWarn7');
      if (ctx3) new Chart(ctx3, {
        type: 'bar',
        data: { labels: warn7.map(x=>x.date), datasets: [{ label:'空置间数', data: warn7.map(x=>x.free), backgroundColor:'#d4a574', borderRadius:4 }] },
        options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true,ticks:{stepSize:2},grid:{color:'rgba(46,42,34,.06)'}},x:{grid:{display:false}}} }
      });
    }, 0);
  },

  // ── 视图1：房态时间轴 ────────────────────────────────────────────
  async _renderTimeline(el) {
    const today = DateUtil.today();
    const start = DateUtil.addDays(today, -2);
    const days = DateUtil.nextDays(21, start); // 前后共 21 天
    const orders = RoomState.orders().filter(o => o.status !== '已取消');
    const units = RoomState.units();

    // 单元格宽度
    const cellW = 60;
    const labelW = 100;

    // 右侧今日待办数据
    const board = RoomState.dailyBoard();

    el.innerHTML = `
      <div class="flex flex-col xl:flex-row gap-5">
        <div class="flex-1 surface-card p-4 overflow-x-auto">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-serif text-base font-semibold text-ink-600">房态时间轴</h3>
            <span class="text-xs text-ink-300">${days[0].slice(5)} ~ ${days[days.length-1].slice(5)} · 横向滚动查看</span>
          </div>
          <div class="timeline-wrap" style="min-width:${labelW + days.length*cellW}px">
            <div class="flex" style="margin-left:${labelW}px">
              ${days.map(d => `<div class="timeline-day-head ${d===today?'today':''}" style="width:${cellW}px">${d.slice(5)}<br>${['日','一','二','三','四','五','六'][new Date(d).getDay()]}</div>`).join('')}
            </div>
            ${RoomState.SUITES.map(s => {
              const rows = s.subRooms.length
                ? s.subRooms.map(u => this._timelineRow(u, s, days, orders, today, cellW, labelW))
                : [this._timelineRow(s.id, s, days, orders, today, cellW, labelW, true)];
              return `<div class="timeline-suite mb-1"><div class="timeline-suite-head">${s.label}</div>${rows.join('')}</div>`;
            }).join('')}
          </div>
        </div>
        <div class="w-full xl:w-72 shrink-0 space-y-4">
          <div class="surface-card p-4">
            <h3 class="font-serif text-base font-semibold text-ink-600 mb-3">今日待办</h3>
            ${['checkins','checkouts','cleaning'].map(k => {
              const title = {checkins:'今日入住',checkouts:'今日退房',cleaning:'待打扫'}[k];
              const items = board[k];
              return `<div class="mb-3"><div class="text-xs text-ink-400 mb-1">${title} (${items.length})</div>${items.length ? items.map(i => `<div class="text-sm text-ink-500 py-1 border-l-2 ${k==='cleaning'?'border-clay-300':'border-sage-300'} pl-2">${i.type==='整租'?i.room+'整套':i.room+'号'} ${i.guest||''}</div>`).join('') : '<div class="text-xs text-ink-300">无</div>'}</div>`;
            }).join('')}
          </div>
          <div class="surface-card p-4">
            <h3 class="font-serif text-base font-semibold text-ink-600 mb-2">图例</h3>
            <div class="space-y-2 text-xs text-ink-500">
              ${Object.entries(RoomState.STATUS).map(([k,m])=>`<div class="flex items-center gap-2"><span class="w-3 h-3 rounded" style="background:${m.color}"></span>${m.label}</div>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    el.querySelectorAll('.timeline-cell').forEach(c => {
      c.onclick = () => {
        const u = c.dataset.unit, d = c.dataset.date;
        const st = RoomState.unitStatusOn(u, d, { today });
        if (st === 'vacant' || st === 'clean') {
          this.openOrderModal(null, { room:u, checkIn:d });
        } else {
          // 在当前行的 cov 中查找订单：遍历所有行 cov 不够优雅，这里通过订单反查
          const o = orders.find(order => {
            const affected = order.type === '整租' ? (RoomState.suiteOf(order.room)?.subRooms || [order.room]) : [order.room];
            return affected.includes(u) && DateUtil.range(order.checkIn, order.checkOut).slice(0,-1).includes(d);
          });
          if (o) this.openOrderActions(o);
        }
      };
    });
  },

  _timelineRow(unit, suite, days, orders, today, cellW, labelW, isWhole=false) {
    const cov = {};
    orders.forEach(o => {
      const units = o.type === '整租' && !isWhole ? (suite.subRooms.length ? suite.subRooms : [o.room]) : [o.room];
      if (!units.includes(unit)) return;
      const ds = DateUtil.range(o.checkIn, o.checkOut).slice(0, -1);
      ds.forEach(d => { cov[d] = o; });
    });
    return `<div class="flex items-center timeline-row">
      <div class="timeline-label" style="width:${labelW}px">${isWhole ? suite.label+' 整套' : suite.id+'·'+unit+'号'}</div>
      <div class="flex">${days.map(d => {
        const o = cov[d];
        const st = RoomState.unitStatusOn(unit, d, { today });
        const meta = RoomState.STATUS[st];
        const isToday = d === today;
        const lightBg = meta.color + '18'; // 加 16 进制透明度 ~10%
        if (o) {
          const tip = `${o.type} · ${o.guest||'—'} · ¥${o.total||0}`;
          return `<div class="timeline-cell has-order" style="width:${cellW}px;background:${meta.color}" title="${tip}" data-unit="${unit}" data-date="${d}">
            <div class="truncate px-1">${o.guest||'客人'}</div>
            <div class="truncate px-1 text-[9px] opacity-80">¥${o.total||0}</div>
          </div>`;
        }
        return `<div class="timeline-cell ${isToday?'today':''}" style="width:${cellW}px;background:${lightBg};${isToday?'box-shadow:inset 0 0 0 2px #b97859;':''}" data-unit="${unit}" data-date="${d}"></div>`;
      }).join('')}</div>
    </div>`;
  },

  async _renderView() {
    const el = document.getElementById('roomsView');
    if (!el) return;
    document.querySelectorAll('.rooms-tab').forEach(b => {
      const on = b.dataset.tab === this._tab;
      b.className = 'rooms-tab px-4 py-2 text-sm font-medium ' + (on ? 'text-ink-600 border-b-2 border-clay-400 -mb-px' : 'text-ink-400 hover:text-ink-500');
    });
    if (this._tab === 'dashboard') await this._renderDashboard(el);
    else if (this._tab === 'timeline') await this._renderTimeline(el);
    else if (this._tab === 'calendar') await this._renderCalendar(el);
    else if (this._tab === 'board') await this._renderBoard(el);
    else if (this._tab === 'report') await this._renderReport(el);
    else await this._renderOrders(el);
    if (window.lucide) lucide.createIcons();
  },

  // ── 视图4：季 / 年报（基于房态订单实时聚合） ─────────────────────
  async _renderReport(el) {
    if (!this._reportMode) this._reportMode = 'quarter';
    const now = new Date();
    const curYear = now.getFullYear();
    if (!this._reportYear) this._reportYear = curYear;
    const year = this._reportYear;
    const mode = this._reportMode;

    const periods = mode === 'quarter'
      ? [['Q1', `${year}-01-01`, `${year}-03-31`], ['Q2', `${year}-04-01`, `${year}-06-30`], ['Q3', `${year}-07-01`, `${year}-09-30`], ['Q4', `${year}-10-01`, `${year}-12-31`]]
      : [[`${year} 全年`, `${year}-01-01`, `${year}-12-31`]];
    const data = periods.map(([label, s, e]) => ({ label, ...RoomState.rangeSummary(s, e) }));

    // 全范围汇总（季报考量各季度；年报考量全年）
    const sum = data.reduce((a, b) => ({ revenue: a.revenue + b.revenue, nights: a.nights + b.nights, count: a.count + b.count }), { revenue: 0, nights: 0, count: 0 });
    const avgOcc = data.length ? Math.round(data.reduce((a, b) => a + b.occRate, 0) / data.length) : 0;

    // 各房型累计贡献
    const bySuite = {};
    for (const s of RoomState.SUITES) bySuite[s.id] = { label: s.label, revenue: 0, nights: 0, count: 0 };
    data.forEach(d => { for (const k in d.bySuite) if (bySuite[k]) { bySuite[k].revenue += d.bySuite[k].revenue; bySuite[k].nights += d.bySuite[k].nights; bySuite[k].count += d.bySuite[k].count; } });
    const suiteArr = Object.values(bySuite);
    const maxSuiteRev = Math.max(1, ...suiteArr.map(s => s.revenue));

    const yearOpts = [];
    const minYear = Math.min(curYear, ...RoomState.orders().map(o => Number((o.checkIn || '').slice(0, 4) || curYear)));
    for (let y = curYear; y >= minYear; y--) yearOpts.push(y);

    el.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div class="flex gap-2">
          <button class="btn btn-sm ${mode==='quarter'?'btn-primary':'btn-secondary'}" data-rmode="quarter">按季度</button>
          <button class="btn btn-sm ${mode==='year'?'btn-primary':'btn-secondary'}" data-rmode="year">按年度</button>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-ink-400">年份</span>
          <select id="reportYear" class="field field-xs w-24">${yearOpts.map(y=>`<option ${y===year?'selected':''}>${y}</option>`).join('')}</select>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        ${[
          { l:'营收合计', v:'¥'+sum.revenue.toLocaleString(), c:'text-clay-600' },
          { l:'间夜合计', v:sum.nights, c:'text-orange-600' },
          { l:'订单合计', v:sum.count, c:'text-emerald-600' },
          { l:'平均入住率', v:avgOcc+'%', c:'text-sage-600' }
        ].map(c=>`<div class="surface-card p-4"><div class="text-xs text-ink-400">${c.l}</div><div class="font-serif text-2xl font-semibold ${c.c} mt-1">${c.v}</div></div>`).join('')}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div class="surface-card p-5">
          <h3 class="font-serif text-lg text-ink-600 mb-3">${mode==='quarter'?'各季度营收':'年度营收'}</h3>
          <div class="space-y-3">
            ${data.map(d=>{
              const pct = maxSuiteRev ? Math.round(d.revenue / maxSuiteRev * 100) : 0;
              return `<div>
                <div class="flex justify-between text-sm mb-1"><span class="text-ink-500">${d.label}</span><span class="font-medium text-ink-600">¥${d.revenue.toLocaleString()} · ${d.nights}间夜 · ${d.occRate}%</span></div>
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="surface-card p-5">
          <h3 class="font-serif text-lg text-ink-600 mb-3">各房型贡献</h3>
          <div class="space-y-3">
            ${suiteArr.map(s=>{
              const pct = maxSuiteRev ? Math.round(s.revenue / maxSuiteRev * 100) : 0;
              return `<div>
                <div class="flex justify-between text-sm mb-1"><span class="text-ink-500">${s.label}</span><span class="font-medium text-ink-600">¥${s.revenue.toLocaleString()} · ${s.nights}间夜 · ${s.count}单</span></div>
                <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:#c2724e"></div></div>
              </div>`;
            }).join('')}
          </div>
          ${sum.revenue===0?`<div class="text-xs text-ink-300 mt-3">当前范围内暂无已结算订单，录入订单后此处自动汇总。</div>`:''}
        </div>
      </div>`;

    el.querySelectorAll('[data-rmode]').forEach(b => b.onclick = () => { this._reportMode = b.dataset.rmode; this._renderReport(el); });
    const ysel = el.querySelector('#reportYear');
    if (ysel) ysel.onchange = () => { this._reportYear = Number(ysel.value); this._renderReport(el); };
  },

  // ── 视图1：套房分组日历 ──────────────────────────────────────────
  async _renderCalendar(el) {
    const today = DateUtil.today();
    const days = DateUtil.nextDays(31, today); // 当日 + 未来30天
    const orders = RoomState.orders().filter(o => o.status !== '已取消');
    // 覆盖图：unit -> date -> order
    const cov = {};
    for (const o of orders) {
      const suite = RoomState.suiteOf(o.room);
      const units = o.type === '整租' ? (suite && suite.subRooms.length ? suite.subRooms : [o.room]) : [o.room];
      const ds = DateUtil.range(o.checkIn, o.checkOut).slice(0, -1);
      for (const u of units) for (const d of ds) { (cov[u] = cov[u] || {})[d] = o; }
    }
    const statusOf = (u, d) => RoomState.unitStatusOn(u, d, { today });
    const cell = (u, d) => {
      const st = statusOf(u.id, d);
      const meta = RoomState.STATUS[st];
      const o = cov[u.id] && cov[u.id][d];
      const tip = o ? `${o.type} ${o.room} ${o.checkIn}~${o.checkOut} · ${o.guest||'—'}` : meta.label;
      const isToday = d === today;
      return `<div class="rcal-cell ${meta.bg} ${isToday?'rcal-today':''}" title="${tip}" data-unit="${u.id}" data-date="${d}" style="min-width:34px;height:30px;"></div>`;
    };
    const group = (s) => {
      const rows = s.subRooms.length
        ? s.subRooms.map(u => `<div class="flex items-stretch"><div class="rcal-label">${s.id}·${u}号</div><div class="flex">${days.map(d=>cell({id:u,suite:s.id},d)).join('')}</div></div>`).join('')
        : `<div class="flex items-stretch"><div class="rcal-label">${s.id} 整套</div><div class="flex">${days.map(d=>cell({id:s.id,suite:s.id},d)).join('')}</div></div>`;
      const attrTxt = { divide_only:'仅分租', whole_only:'仅整租', both:'可整可分' }[s.attr];
      return `<div class="mb-2">
        <div class="rcal-group-head">${s.label} <span class="chip chip-sand text-[10px]">${attrTxt}</span> <span class="text-[11px] text-ink-300">¥${s.weekday}/平 · ¥${s.weekend}/末</span></div>
        ${rows}
      </div>`;
    };
    // 日期表头
    const head = `<div class="flex"><div class="rcal-label" style="position:sticky;left:0;z-index:2;background:#fff"></div><div class="flex">${days.map(d=>{
      const dt=new Date(d); const wd=['日','一','二','三','四','五','六'][dt.getDay()];
      const isToday=d===today;
      return `<div class="text-center text-[10px] ${isToday?'font-bold text-clay-600':''}" style="min-width:34px">${d.slice(5)}\n${wd}</div>`;
    }).join('')}</div></div>`;
    el.innerHTML = `
      <div class="surface-card p-4 overflow-x-auto">
        <div class="flex items-center gap-3 mb-3 text-xs">
          ${Object.entries(RoomState.STATUS).map(([k,m])=>`<span class="inline-flex items-center gap-1"><span class="w-3 h-3 rounded" style="background:${m.color}"></span>${m.label}</span>`).join('')}
        </div>
        ${head}
        ${RoomState.SUITES.map(group).join('')}
      </div>
      <p class="text-xs text-ink-300 mt-2">点击单元格可快速新增（空置）或查看/操作订单（占用）。横向可滑动查看未来 30 天。</p>
    `;
    // 单元格点击
    el.querySelectorAll('.rcal-cell').forEach(c => {
      c.onclick = () => {
        const u = c.dataset.unit, d = c.dataset.date;
        const st = statusOf(u, d);
        if (st === 'vacant' || st === 'clean') {
          this.openOrderModal(null, { room:u, checkIn:d });
        } else {
          const o = cov[u] && cov[u][d];
          if (o) this.openOrderActions(o);
        }
      };
    });
  },

  // ── 视图2：当日工作看板 ──────────────────────────────────────────
  async _renderBoard(el) {
    const b = RoomState.dailyBoard();
    const block = (title, icon, items, empty) => `
      <div class="surface-card p-5">
        <div class="flex items-center gap-2 mb-3"><i data-lucide="${icon}" class="w-4 h-4 text-clay-500"></i><h3 class="font-serif text-base font-semibold text-ink-600">${title}</h3><span class="chip chip-sand">${items.length}</span></div>
        ${items.length ? `<ul class="space-y-2">${items.map(i=>`
          <li class="flex items-center justify-between border-l-2 border-sage-300 pl-3 py-1.5">
            <div>
              <div class="text-sm font-medium text-ink-600">${i.type==='整租'?i.room+' 整套':i.room+'号'} · ${i.guest||'—'}</div>
              <div class="text-xs text-ink-400">${i.checkIn}~${i.checkOut} · ${i.note||''}</div>
            </div>
            <div class="flex gap-1">
              ${i.status==='在住'||i.status==='待入住'?`<button class="btn btn-ghost text-xs" data-act="checkout" data-id="${i.id}">退房</button>`:''}
              ${i.status==='待入住'?`<button class="btn btn-ghost text-xs" data-act="checkin" data-id="${i.id}">入住</button>`:''}
              ${i.status==='待打扫'?`<button class="btn btn-ghost text-xs" data-clean-unit="${i.room}" data-clean-date="${i.checkIn}">完成</button>`:''}
            </div>
          </li>`).join('')}</ul>` : `<div class="text-sm text-ink-300 py-2">${empty}</div>`}
      </div>`;
    el.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        ${block('今日入住', 'log-in', b.checkins, '今日无新入住')}
        ${block('今日退房', 'log-out', b.checkouts, '今日无退房')}
        ${block('待打扫房源', 'sparkles', b.cleaning.map(c=>({room:c.unit,guest:'',checkIn:c.date,checkOut:c.date,note:'需打扫',status:'待打扫',id:c.unit+c.date})), '全部已打扫')}
        ${block('空置可售房源', 'door-open', b.vacant.map(v=>({room:v.label,guest:'',checkIn:'',checkOut:'',note:'可售',status:'空置',id:'vac'+v.id})), '无可售空房')}
      </div>
      <div class="surface-card p-5 mt-4">
        <h3 class="font-serif text-base font-semibold text-ink-600 mb-3">今日全量在住（${b.occupied.length}）</h3>
        ${b.occupied.length?`<div class="flex flex-wrap gap-2">${b.occupied.map(o=>`<span class="chip ${o.type==='整租'?'chip-clay':'chip-sage'}">${o.type==='整租'?o.room+' 整套':o.room+'号'} · ${o.guest||'—'} · ${o.status}</span>`).join('')}</div>`:'<div class="text-sm text-ink-300">今日无在住</div>'}
      </div>
    `;
    el.querySelectorAll('[data-act="checkout"]').forEach(btn => btn.onclick = async () => { await RoomState.checkOut(btn.dataset.id); Notify.toast('已办理退房，标记待打扫','success'); this._renderOverview(); this._renderView(); });
    el.querySelectorAll('[data-act="checkin"]').forEach(btn => btn.onclick = async () => { await RoomState.checkIn(btn.dataset.id); Notify.toast('已办理入住','success'); this._renderOverview(); this._renderView(); });
    el.querySelectorAll('[data-clean-unit]').forEach(btn => btn.onclick = async () => { await RoomState.markClean(btn.dataset.cleanUnit, btn.dataset.cleanDate); Notify.toast('已标记打扫完成','success'); this._renderView(); });
  },

  // ── 视图3：订单明细列表 ──────────────────────────────────────────
  async _renderOrders(el) {
    const f = this._filter;
    const all = RoomState.orders();
    const filtered = all.filter(o =>
      (!f.room || (o.room||'').includes(f.room)) &&
      (!f.type || o.type === f.type) &&
      (!f.status || o.status === f.status) &&
      (!f.from || o.checkIn >= f.from) &&
      (!f.to || o.checkOut <= f.to)
    ).sort((a,b)=> (b.checkIn||'').localeCompare(a.checkIn||''));
    el.innerHTML = `
      <div class="surface-card p-4 mb-4 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
        <div><label class="field-label">房号</label><input id="fRoom" class="field" value="${f.room}" placeholder="如 407 / 5"></div>
        <div><label class="field-label">类型</label><select id="fType" class="field"><option value="">全部</option><option value="整租">整租</option><option value="分租">分租</option></select></div>
        <div><label class="field-label">状态</label><select id="fStatus" class="field"><option value="">全部</option><option>待入住</option><option>在住</option><option>已退房</option><option>已取消</option></select></div>
        <div><label class="field-label">起始</label><input id="fFrom" type="date" class="field" value="${f.from}"></div>
        <div><label class="field-label">结束</label><input id="fTo" type="date" class="field" value="${f.to}"></div>
        <div class="flex gap-2">
          <button id="fApply" class="btn btn-primary flex-1 justify-center">筛选</button>
          <button id="fExport" class="btn btn-ghost"><i data-lucide="download" class="w-4 h-4"></i></button>
        </div>
      </div>
      <div class="surface-card p-0 overflow-x-auto">
        <table class="mini-table w-full">
          <thead><tr><th>订单号</th><th>房源</th><th>类型</th><th>入住</th><th>退房</th><th>间夜</th><th>总价</th><th>客人</th><th>状态</th><th>收款</th><th>操作</th></tr></thead>
          <tbody>
            ${filtered.length ? filtered.map(o=>`
              <tr>
                <td class="font-mono text-xs">${o.id}</td>
                <td>${o.type==='整租'?o.room+' 整套':o.room+'号'}</td>
                <td>${o.type}</td>
                <td>${o.checkIn}</td><td>${o.checkOut}</td><td>${o.nights}</td>
                <td>¥${Number(o.total||0).toLocaleString()}</td>
                <td>${o.guest||'—'}</td>
                <td><span class="chip ${o.status==='已取消'?'chip-clay':o.status==='在住'?'chip-sage':'chip-sand'}">${o.status}</span></td>
                <td>${o.payStatus||'—'}</td>
                <td class="whitespace-nowrap">
                  <button class="btn btn-ghost text-xs" data-edit="${o.id}">改</button>
                  ${o.status!=='已取消'&&o.status!=='已退房'?`<button class="btn btn-ghost text-xs" data-cancel="${o.id}">取消</button>`:''}
                  ${o.status==='待入住'?`<button class="btn btn-ghost text-xs" data-checkin="${o.id}">入住</button>`:''}
                  ${o.status==='在住'||o.status==='待入住'?`<button class="btn btn-ghost text-xs" data-checkout="${o.id}">退房</button>`:''}
                </td>
              </tr>`).join('') : `<tr><td colspan="11" class="text-center text-ink-300 py-6">暂无订单</td></tr>`}
          </tbody>
        </table>
      </div>`;
    const apply = () => {
      this._filter = { room: el.querySelector('#fRoom').value.trim(), type: el.querySelector('#fType').value, status: el.querySelector('#fStatus').value, from: el.querySelector('#fFrom').value, to: el.querySelector('#fTo').value };
      this._renderOrders(el);
    };
    el.querySelector('#fApply').onclick = apply;
    el.querySelector('#fExport').onclick = () => this._exportCsv(filtered);
    el.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{ const o=RoomState.orders().find(x=>x.id===b.dataset.edit); this.openOrderModal(o, {}); });
    el.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{ if(confirm('确认取消该订单？')){ await RoomState.cancelOrder(b.dataset.cancel,'用户取消'); Notify.toast('已取消订单','success'); this._renderOverview(); this._renderView(); }});
    el.querySelectorAll('[data-checkin]').forEach(b=>b.onclick=async()=>{ await RoomState.checkIn(b.dataset.checkin); Notify.toast('已入住','success'); this._renderOverview(); this._renderView(); });
    el.querySelectorAll('[data-checkout]').forEach(b=>b.onclick=async()=>{ await RoomState.checkOut(b.dataset.checkout); Notify.toast('已退房','success'); this._renderOverview(); this._renderView(); });
  },

  _exportCsv(rows) {
    const head = ['订单号','房源','类型','入住','退房','间夜','单价','总价','客人','联系方式','状态','收款','备注','录入时间'];
    const lines = [head.join(',')];
    rows.forEach(o => lines.push([
      o.id, o.type==='整租'?o.room+'整套':o.room+'号', o.type, o.checkIn, o.checkOut, o.nights, o.price, o.total, o.guest, o.phone, o.status, o.payStatus, o.note, o.createdAt
    ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')));
    const blob = new Blob(['\ufeff'+lines.join('\n')], { type:'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `房态订单_${DateUtil.today()}.csv`; a.click();
    Notify.toast('已导出 CSV（Excel 可打开）','success');
  },

  // ── 订单新增/编辑弹窗（经锁房校验） ───────────────────────────────
  openOrderModal(existing, prefill) {
    const isEdit = !!existing;
    const suites = RoomState.SUITES;
    const subOptions = (type) => {
      if (type === '整租') return suites.filter(s=>s.attr!=='divide_only').map(s=>`<option value="${s.id}">${s.label}（整租）</option>`).join('');
      // 分租：列出所有单间
      const opts = [];
      suites.forEach(s => s.subRooms.forEach(u => opts.push(`<option value="${u}">${s.id}·${u}号</option>`)));
      return opts.join('');
    };
    const type0 = prefill.type || (existing?existing.type:'分租');
    const room0 = prefill.room || (existing?existing.room:'');
    const body = `
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="field-label">订单类型</label>
            <select id="omType" class="field"><option value="分租" ${type0==='分租'?'selected':''}>分租（单间）</option><option value="整租" ${type0==='整租'?'selected':''}>整租（整套）</option></select>
          </div>
          <div><label class="field-label">房源</label>
            <select id="omRoom" class="field">${room0?`<option value="${room0}">${room0}</option>`:subOptions(type0)}</select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="field-label">入住日期</label><input id="omIn" type="date" class="field" value="${prefill.checkIn||(existing?existing.checkIn:DateUtil.today())}"></div>
          <div><label class="field-label">退房日期</label><input id="omOut" type="date" class="field" value="${existing?existing.checkOut:DateUtil.fmt(DateUtil.addDays(prefill.checkIn||DateUtil.today(),1))}"></div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="field-label">客人姓名</label><input id="omGuest" class="field" value="${existing?existing.guest:''}"></div>
          <div><label class="field-label">手机号</label><input id="omPhone" class="field" value="${existing?existing.phone:''}"></div>
          <div><label class="field-label">总价(¥)</label><input id="omTotal" type="number" class="field" value="${existing?existing.total:''}"></div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="field-label">收款状态</label><select id="omPay" class="field"><option>未收款</option><option>已收款</option><option>部分收款</option></select></div>
          <div><label class="field-label">备注</label><input id="omNote" class="field" value="${existing?existing.note:''}"></div>
        </div>
        <div id="omMsg" class="text-sm"></div>
      </div>`;
    Notify.modal({
      title: isEdit ? '修改订单' : '新增订单',
      body,
      primary: isEdit ? '保存修改' : '创建订单',
      onPrimary: async () => {
        const type = document.getElementById('omType').value;
        const room = document.getElementById('omRoom').value;
        const checkIn = document.getElementById('omIn').value;
        const checkOut = document.getElementById('omOut').value;
        const msg = document.getElementById('omMsg');
        if (!checkIn || !checkOut || checkOut <= checkIn) { msg.innerHTML = '<span class="text-red-500">退房日期须晚于入住日期</span>'; return; }
        const input = { room, type, checkIn, checkOut, guest: document.getElementById('omGuest').value, phone: document.getElementById('omPhone').value, total: Number(document.getElementById('omTotal').value||0), payStatus: document.getElementById('omPay').value, note: document.getElementById('omNote').value };
        let res;
        if (isEdit) res = await RoomState.updateOrderDates(existing.id, checkIn, checkOut, input.note);
        else res = await RoomState.addOrder(input);
        if (!res.ok) {
          msg.innerHTML = `<span class="text-red-500">⛔ 锁房冲突：${res.reason}${res.conflicts?('<br>· '+res.conflicts.join('<br>· ')):''}</span>`;
          return;
        }
        Notify.toast(isEdit?'订单已更新':'订单已创建（锁房校验通过）','success');
        if (Notify.close) Notify.close();
        this._renderOverview(); this._renderView();
      }
    });
    // 类型切换时刷新房源下拉
    setTimeout(() => {
      const t = document.getElementById('omType'); const r = document.getElementById('omRoom');
      if (t && r) t.onchange = () => { r.innerHTML = subOptions(t.value); };
    }, 50);
  },

  openOrderActions(o) {
    const body = `
      <div class="space-y-2 text-sm">
        <div><b>订单：</b>${o.type==='整租'?o.room+' 整套':o.room+'号'}（${o.type}）</div>
        <div><b>日期：</b>${o.checkIn} ~ ${o.checkOut}（${o.nights} 间夜）</div>
        <div><b>客人：</b>${o.guest||'—'} · ${o.phone||''}</div>
        <div><b>总价：</b>¥${Number(o.total||0).toLocaleString()} · ${o.payStatus}</div>
        <div><b>状态：</b>${o.status}</div>
      </div>
      <div class="mt-4 flex gap-2">
        <button class="btn btn-ghost text-xs" id="oaCancel">取消订单</button>
        <button class="btn btn-ghost text-xs" id="oaEdit">修改日期</button>
      </div>`;
    Notify.modal({
      title: '订单操作', body,
      primary: '办理入住', secondary: '办理退房',
      onPrimary: async () => { await RoomState.checkIn(o.id); Notify.toast('已入住','success'); this._renderOverview(); this._renderView(); },
      onSecondary: async () => { await RoomState.checkOut(o.id); Notify.toast('已退房','success'); this._renderOverview(); this._renderView(); }
    });
    setTimeout(() => {
      const c = document.getElementById('oaCancel'); const e = document.getElementById('oaEdit');
      if (c) c.onclick = async () => { if (confirm('确认取消该订单？')) { await RoomState.cancelOrder(o.id, '用户取消'); Notify.toast('已取消订单','success'); Notify.close(); this._renderOverview(); this._renderView(); } };
      if (e) e.onclick = () => { Notify.close(); this.openOrderModal(o, {}); };
    }, 50);
  },

  // ── 自然语言执行 ─────────────────────────────────────────────────
  async _runNL(text) {
    const cmd = RoomState.parseCommand(text);
    let msg = '';
    if (cmd.action === 'add') {
      if (!cmd.room || !cmd.checkIn || !cmd.checkOut) { Notify.toast('指令解析不完整：需要 房号/套房 + 入住 + 退房 日期','warn'); return; }
      const res = await RoomState.addOrder({ room:cmd.room, type:cmd.type, checkIn:cmd.checkIn, checkOut:cmd.checkOut, guest:cmd.guest, total:cmd.total });
      msg = res.ok ? `✅ 已创建${cmd.type}订单：${cmd.room} ${cmd.checkIn}~${cmd.checkOut}` : `⛔ ${res.reason}`;
    } else if (cmd.action === 'extend') {
      const o = RoomState.orders().find(x => x.room === cmd.unit && (x.status==='待入住'||x.status==='在住') && (!cmd.from || x.checkIn===cmd.from));
      if (!o) { Notify.toast('未找到该房源的待续住订单','warn'); return; }
      const res = await RoomState.extendStay(o.id, cmd.to);
      msg = res.ok ? `✅ 已续住至 ${cmd.to}` : `⛔ ${res.reason}`;
    } else if (cmd.action === 'clean') {
      if (!cmd.unit) { Notify.toast('请指定房号，如「标记 8 号房打扫完成」','warn'); return; }
      await RoomState.markClean(cmd.unit, DateUtil.today());
      msg = `✅ 已标记 ${cmd.unit} 号房打扫完成`;
    } else if (cmd.action === 'query') {
      const vac = RoomState.vacancy(cmd.days).filter(v => v.freeDays > 0).sort((a,b)=>b.freeDays-a.freeDays);
      msg = vac.length ? `🔍 未来${cmd.days}天可售空房：${vac.slice(0,8).map(v=>`${v.label}(空${v.freeDays}晚)`).join('、')}` : `未来${cmd.days}天暂无可售空房`;
    } else {
      msg = '未能识别指令。示例：新增 407 套房整租订单 8月10日入住 8月12日退房 客人张先生 总价760元';
    }
    Notify.toast(msg, cmd.action==='unknown'?'warn':'success');
    this._renderOverview(); this._renderView();
  }
};

window['biz-bnb-rooms'] = BizBnbRooms;
