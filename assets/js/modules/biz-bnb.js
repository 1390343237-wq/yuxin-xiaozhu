/* ====================================================================
   biz-bnb.js - 民宿管理系统（核心）
   - 6 套房分组
   - 30 天日历视图
   - 整分租互斥锁房（下单前强校验）
   - 营收/成本统计
   - 当日工作排班
   - 空置房源营销提醒
   ==================================================================== */

const BnbModule = {
  state: {
    startDate: DateUtil.today(),
    view: 'calendar' // 'calendar' | 'list' | 'revenue' | 'schedule'
  },

  async render(root) {
    root.innerHTML = `
      <div class="space-y-6 module-fade">
        <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <div class="section-eyebrow">工作经营 / 民宿管理</div>
            <h1 class="section-title">民宿房态与订单</h1>
            <p class="mt-2 text-ink-400 text-sm">6 套房分组 · 14 间分租单间 · 整分租互斥锁房强校验</p>
          </div>
          <div class="flex gap-2">
            <button id="newOrderBtn" class="btn btn-primary"><i data-lucide="plus" class="w-4 h-4"></i>新增订单</button>
          </div>
        </div>

        <!-- Tab -->
        <div class="flex flex-wrap gap-1 text-sm border-b border-ink-100/60">
          <button data-view="calendar"  class="tab-btn px-4 py-2.5 text-ink-500 border-b-2 border-transparent">日历视图</button>
          <button data-view="list"     class="tab-btn px-4 py-2.5 text-ink-500 border-b-2 border-transparent">订单列表</button>
          <button data-view="schedule" class="tab-btn px-4 py-2.5 text-ink-500 border-b-2 border-transparent">当日排班</button>
          <button data-view="revenue"  class="tab-btn px-4 py-2.5 text-ink-500 border-b-2 border-transparent">营收成本</button>
        </div>

        <div id="bnbView"></div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    this._bindTabs();
    await this._renderView();
  },

  _bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.tab-btn').forEach(b => {
          b.classList.remove('border-ink-500', 'text-ink-600', 'font-medium');
          b.classList.add('border-transparent', 'text-ink-500');
        });
        btn.classList.add('border-ink-500', 'text-ink-600', 'font-medium');
        btn.classList.remove('border-transparent');
        this.state.view = btn.dataset.view;
        await this._renderView();
      });
    });
    // 默认激活 calendar
    const def = document.querySelector('[data-view="calendar"]');
    if (def) {
      def.classList.add('border-ink-500', 'text-ink-600', 'font-medium');
      def.classList.remove('border-transparent');
    }
  },

  async _renderView() {
    const v = document.getElementById('bnbView');
    if (!v) return;
    if (this.state.view === 'calendar')  return this._renderCalendar(v);
    if (this.state.view === 'list')     return this._renderList(v);
    if (this.state.view === 'schedule') return this._renderSchedule(v);
    if (this.state.view === 'revenue')  return this._renderRevenue(v);
  },

  // === 日历视图（30 天） ===
  async _renderCalendar(root) {
    const orders = await Lock.loadAllOrders();
    const days = DateUtil.nextDays(30);
    const suites = Lock.ROOMS;

    root.innerHTML = `
      <div class="surface-card p-4 lg:p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-serif text-lg font-semibold text-ink-600">未来 30 天房态</h3>
          <div class="flex items-center gap-3 text-xs text-ink-400">
            <span class="flex items-center gap-1.5"><span class="status-dot status-occupied"></span>分租在住</span>
            <span class="flex items-center gap-1.5"><span class="status-dot status-whole"></span>整租占用</span>
            <span class="flex items-center gap-1.5"><span class="status-dot status-vacant"></span>空置</span>
            <span class="flex items-center gap-1.5"><span class="status-dot status-cleaning"></span>当日退/打扫</span>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs" id="calTable">
            <thead>
              <tr>
                <th class="sticky left-0 bg-sand-50 z-10 text-left py-2 px-2 min-w-[100px]">套房 / 子房</th>
                ${days.map(d => {
                  const dt = DateUtil.parse(d);
                  return `<th class="text-center py-1 px-0.5 min-w-[26px] ${dt.getDay() === 0 || dt.getDay() === 6 ? 'text-clay-400' : 'text-ink-400'}">
                    <div>${d.slice(5)}</div>
                    <div class="text-[9px] text-ink-300">${['日','一','二','三','四','五','六'][dt.getDay()]}</div>
                  </th>`;
                }).join('')}
              </tr>
            </thead>
            <tbody>
              ${Object.entries(suites).map(([suiteId, info]) => {
                const subs = info.subRooms.length ? info.subRooms : [suiteId];
                return subs.map((sub, idx) => {
                  const isFirst = idx === 0;
                  const label = isFirst
                    ? `<div class="font-medium text-ink-600">${suiteId}</div><div class="text-[10px] text-ink-300">${info.type === 'whole_only' ? '纯整租' : info.type === 'sublet_only' ? '仅分租' : '可整可分'}</div>`
                    : `<div class="text-ink-400 pl-3">↳ ${sub}号</div>`;
                  const cells = days.map(d => {
                    const status = this._cellStatus(sub, d, orders);
                    return `<td class="p-0.5"><div class="cal-cell ${status.cls}" title="${d} · ${sub}号 · ${status.title}">${status.label || ''}</div></td>`;
                  }).join('');
                  return `<tr>${isFirst ? `<td class="sticky left-0 bg-sand-50 z-10 py-2 pr-3 align-top" rowspan="${subs.length}"><div class="text-sm">${label}</div></td>` : ''}${cells}</tr>`;
                }).join('');
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        ${this._alertsCard(orders)}
        <div class="surface-card p-5">
          <div class="section-eyebrow">房型规则</div>
          <h4 class="font-serif text-base font-semibold text-ink-600 mb-3">整分租互斥</h4>
          <ul class="text-xs text-ink-500 space-y-1.5">
            <li>· 401/1502：仅分租（子房独立管控）</li>
            <li>· 1302/407/503：可整租或分租（互斥锁房）</li>
            <li>· 1202：纯整租（无子房）</li>
            <li class="text-clay-500 pt-1">⚠ 整租 → 子房自动锁定；分租占用 → 整租通道关闭</li>
          </ul>
        </div>
        <div class="surface-card p-5">
          <div class="section-eyebrow">操作</div>
          <h4 class="font-serif text-base font-semibold text-ink-600 mb-3">快捷动作</h4>
          <div class="space-y-2">
            <button class="btn btn-secondary w-full justify-center" onclick="document.getElementById('newOrderBtn').click()">+ 新增订单</button>
            <button class="btn btn-ghost w-full justify-center" id="vacantListBtn">查看空置房源</button>
          </div>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    document.getElementById('newOrderBtn')?.addEventListener('click', () => this._openOrderModal());
    document.getElementById('vacantListBtn')?.addEventListener('click', () => this._showVacant(orders));
  },

  _cellStatus(subRoom, date, orders) {
    const range = (s, e) => DateUtil.range(s, e || s).slice(0, -1).includes(date);
    // 整租覆盖
    for (const o of orders) {
      if (o.type !== '整租') continue;
      if (Lock.ROOMS[o.subRoom] && Lock.ROOMS[o.subRoom].subRooms.includes(subRoom)) {
        if (range(o.checkIn, o.checkOut)) return { cls: 'whole', title: '整租占用', label: '整' };
      }
    }
    // 分租占用
    for (const o of orders) {
      if (String(o.subRoom) !== subRoom) continue;
      if (o.type === '整租') continue;
      if (range(o.checkIn, o.checkOut)) {
        const isCheckOut = o.checkOut === date;
        return isCheckOut
          ? { cls: 'cleaning', title: '今日退房', label: '退' }
          : { cls: 'occupied', title: `${o.customerSource || '分租'} 在住`, label: '' };
      }
      if (o.checkIn === date) return { cls: 'cleaning', title: '今日入住', label: '入' };
    }
    return { cls: 'future-empty', title: '空置', label: '' };
  },

  _alertsCard(orders) {
    const days = DateUtil.nextDays(8).slice(1); // 未来 7 天（不含今日）
    const vac = Lock.computeVacancy(orders, days)
      .filter(u => u.freeDays > 0)
      .sort((a, b) => b.freeDays - a.freeDays);
    const totalFree = vac.reduce((s, u) => s + u.freeDays, 0);
    const top = vac.slice(0, 6);
    // 按套房聚合空置夜，找出最该推广的套房
    const suiteFree = {};
    vac.forEach(u => { suiteFree[u.suite] = (suiteFree[u.suite] || 0) + u.freeDays; });
    const best = Object.entries(suiteFree).sort((a, b) => b[1] - a[1])[0];
    const suggest = best
      ? `建议优先推广 <b class="text-clay-500">${best[0]}</b> 的空置窗口（累计 ${best[1]} 个空置夜），结合「陪诊旅居 / 异地就医」主题推送。`
      : '未来一周满房，房源紧张 🎉';
    return `
      <div class="surface-card p-5">
        <div class="section-eyebrow">空置提醒</div>
        <h4 class="font-serif text-base font-semibold text-ink-600 mb-3">未来 7 天空置房源</h4>
        <div class="text-sm text-ink-500 leading-relaxed">
          <div>共 <b class="text-sage-600">${vac.length}</b> 间有空置窗口，合计 <b class="text-sage-600">${totalFree}</b> 个空置夜。</div>
          <div class="mt-3 flex flex-wrap gap-1.5">
            ${top.length ? top.map(u => `<span class="chip chip-sand" title="${u.label} · ${u.freeDays} 个空置夜">${u.label}<span class="ml-1 text-ink-400">· ${u.freeDays} 夜</span></span>`).join('') : '<span class="text-ink-300 text-xs">未来一周满房</span>'}
          </div>
          <div class="mt-3 text-xs text-clay-500">${suggest}</div>
        </div>
        <a href="#/biz/media" class="mt-3 inline-flex items-center gap-1 text-xs text-sage-600 hover:underline">
          去生成营销内容 <i data-lucide="arrow-right" class="w-3 h-3"></i>
        </a>
      </div>
    `;
  },

  _showVacant(orders) {
    const days = DateUtil.nextDays(8).slice(1);
    const vac = Lock.computeVacancy(orders, days)
      .filter(u => u.freeDays > 0)
      .sort((a, b) => b.freeDays - a.freeDays);
    // 按套房分组
    const bySuite = {};
    vac.forEach(u => { (bySuite[u.suite] = bySuite[u.suite] || []).push(u); });
    const body = vac.length === 0
      ? '<div class="text-sm text-ink-400">未来 7 天所有房源均已订满 🎉</div>'
      : `<div class="space-y-3">${Object.entries(bySuite).map(([sid, us]) => `
          <div>
            <div class="text-xs text-ink-400 mb-1.5">${sid} 套房（${us.reduce((s, u) => s + u.freeDays, 0)} 个空置夜）</div>
            <div class="grid grid-cols-4 gap-2">
              ${us.map(u => `<div class="chip chip-sand text-center" title="${u.freeDays} 个空置夜">${u.id}号<span class="ml-1 text-ink-400">·${u.freeDays}</span></div>`).join('')}
            </div>
          </div>`).join('')}</div>`;
    Notify.modal({
      title: `未来 7 天空置房源（${vac.length} 间）`,
      body,
      primary: '去营销',
      onPrimary: () => { location.hash = '#/biz/media'; }
    });
  },

  // === 订单列表 ===
  async _renderList(root) {
    const orders = await Lock.loadAllOrders();
    orders.sort((a, b) => (b.checkIn || '').localeCompare(a.checkIn || ''));
    root.innerHTML = `
      <div class="surface-card p-4 lg:p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-serif text-lg font-semibold text-ink-600">全部订单（${orders.length}）</h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-xs text-ink-400 border-b border-ink-100">
              <tr>
                <th class="text-left py-2">订单号</th>
                <th class="text-left py-2">房型</th>
                <th class="text-left py-2">子房</th>
                <th class="text-left py-2">入住 → 退房</th>
                <th class="text-left py-2">客源</th>
                <th class="text-left py-2">来源</th>
                <th class="text-right py-2">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-ink-100/50">
              ${orders.length === 0
                ? '<tr><td colspan="7" class="text-center text-ink-300 py-8">暂无订单</td></tr>'
                : orders.map(o => `
                  <tr class="hover:bg-sand-50/50">
                    <td class="py-2.5 font-mono text-xs text-ink-400">${(o.id || '').slice(-8)}</td>
                    <td class="py-2.5"><span class="chip ${o.type === '整租' ? 'chip-clay' : 'chip-sage'}">${o.type || '分租'}</span></td>
                    <td class="py-2.5">${o.subRoom || '—'}号</td>
                    <td class="py-2.5 text-ink-500">${o.checkIn || '—'} → ${o.checkOut || '—'}</td>
                    <td class="py-2.5">${o.customerSource || '—'}</td>
                    <td class="py-2.5 text-xs text-ink-400">${o.source === 'main_sheet' ? '原台账' : '工作台'}</td>
                    <td class="py-2.5 text-right">
                      ${o.source === 'new_sheet' ? `<button class="btn btn-ghost btn-sm" onclick="BnbModule._cancelOrder('${o.id}')">取消</button>` : '<span class="text-xs text-ink-300">只读</span>'}
                    </td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async _cancelOrder(orderId) {
    const ok = await Notify.confirm({
      title: '确认取消订单',
      body: `订单 <span class="font-mono">${orderId}</span> 取消后不可恢复，将写入操作日志。`,
      primary: '确认取消', danger: true
    });
    if (!ok) return;
    await Sheet.cancelOrder(orderId, '前端手动取消');
    Notify.toast('订单已取消', 'success');
    await this._renderView();
  },

  // === 当日排班 ===
  async _renderSchedule(root) {
    const orders = await Lock.loadAllOrders();
    const today = DateUtil.today();
    const inToday = orders.filter(o => o.checkIn === today);
    const outToday = orders.filter(o => o.checkOut === today);
    const onDay = orders.filter(o => DateUtil.range(o.checkIn, o.checkOut || o.checkIn).slice(0, -1).includes(today));
    const stay = onDay.filter(o => o.checkIn !== today && o.checkOut !== today);

    root.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="surface-card p-5 border-l-4 border-sage-400">
          <div class="section-eyebrow">退房 · 需打扫</div>
          <div class="metric-display text-3xl text-sage-500 mt-2">${outToday.length}</div>
          <ul class="mt-3 space-y-2 text-sm">
            ${outToday.length === 0 ? '<li class="text-ink-300">今日无退房</li>' :
              outToday.map(o => `<li class="flex items-center gap-2"><span class="status-dot status-occupied"></span>${o.subRoom}号 · ${o.customerSource || '—'}</li>`).join('')}
          </ul>
        </div>
        <div class="surface-card p-5 border-l-4 border-clay-400">
          <div class="section-eyebrow">新入住</div>
          <div class="metric-display text-3xl text-clay-500 mt-2">${inToday.length}</div>
          <ul class="mt-3 space-y-2 text-sm">
            ${inToday.length === 0 ? '<li class="text-ink-300">今日无新入住</li>' :
              inToday.map(o => `<li class="flex items-center gap-2"><span class="status-dot status-cleaning"></span>${o.subRoom}号 · ${o.customerSource || '—'}</li>`).join('')}
          </ul>
        </div>
        <div class="surface-card p-5 border-l-4 border-ink-400">
          <div class="section-eyebrow">续住</div>
          <div class="metric-display text-3xl text-ink-500 mt-2">${stay.length}</div>
          <ul class="mt-3 space-y-2 text-sm">
            ${stay.length === 0 ? '<li class="text-ink-300">无续住客人</li>' :
              stay.slice(0, 6).map(o => `<li class="flex items-center gap-2"><span class="status-dot status-whole"></span>${o.subRoom}号 · ${o.customerSource || '—'}</li>`).join('')}
          </ul>
        </div>
      </div>
      <div class="surface-card p-5">
        <h4 class="font-serif text-lg font-semibold text-ink-600 mb-3">${today} 全部在住 (${onDay.length})</h4>
        <div class="text-sm text-ink-500">
          ${onDay.length === 0 ? '<div class="text-ink-300 py-3">今日无在住</div>' :
            `<div class="grid grid-cols-2 md:grid-cols-4 gap-2">${onDay.map(o => `<div class="surface-elevated p-2.5"><div class="text-xs text-ink-300">${o.subRoom}号</div><div class="text-sm">${o.customerSource || '—'}</div></div>`).join('')}</div>`}
        </div>
      </div>
    `;
  },

  // === 营收成本 ===
  async _renderRevenue(root) {
    const rep = await Sheet.getMonthlyReport().catch(() => []);
    if (!rep || rep.length < 2) {
      root.innerHTML = '<div class="empty-state">暂无营收数据</div>';
      return;
    }
    const header = rep[0];
    const months = rep.slice(1);
    const totals = months.map(row => {
      const revenue = (Number(row[1]||0) + Number(row[2]||0) + Number(row[3]||0));
      const rent    = (Number(row[4]||0) + Number(row[5]||0) + Number(row[6]||0));
      const water   = (Number(row[7]||0) + Number(row[8]||0) + Number(row[9]||0));
      const gas     = (Number(row[10]||0) + Number(row[11]||0) + Number(row[12]||0));
      const cost = rent + water + gas;
      return { month: row[0], revenue, rent, water, gas, cost, profit: revenue - cost };
    });
    const total = totals.reduce((s, t) => ({
      revenue: s.revenue + t.revenue, cost: s.cost + t.cost, profit: s.profit + t.profit
    }), { revenue: 0, cost: 0, profit: 0 });

    root.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="surface-card p-5"><div class="section-eyebrow">累计营收</div><div class="metric-display text-3xl text-sage-500 mt-2">¥${total.revenue.toLocaleString()}</div></div>
        <div class="surface-card p-5"><div class="section-eyebrow">累计成本</div><div class="metric-display text-3xl text-clay-500 mt-2">¥${total.cost.toLocaleString()}</div></div>
        <div class="surface-card p-5"><div class="section-eyebrow">累计净利</div><div class="metric-display text-3xl text-ink-600 mt-2">¥${total.profit.toLocaleString()}</div></div>
      </div>
      <div class="surface-card p-5">
        <h3 class="font-serif text-lg font-semibold text-ink-600 mb-4">月度营收 vs 成本</h3>
        <canvas id="revChart" height="100"></canvas>
      </div>
      <div class="surface-card p-5">
        <h3 class="font-serif text-lg font-semibold text-ink-600 mb-4">明细</h3>
        <table class="w-full text-sm">
          <thead class="text-xs text-ink-400 border-b border-ink-100">
            <tr>
              <th class="text-left py-2">月份</th>
              <th class="text-right py-2">营收</th>
              <th class="text-right py-2">房租</th>
              <th class="text-right py-2">水电</th>
              <th class="text-right py-2">燃气</th>
              <th class="text-right py-2">成本合计</th>
              <th class="text-right py-2">净利润</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100/50">
            ${totals.map(t => `
              <tr>
                <td class="py-2.5">${t.month}</td>
                <td class="py-2.5 text-right text-sage-500">¥${t.revenue.toLocaleString()}</td>
                <td class="py-2.5 text-right">¥${t.rent.toLocaleString()}</td>
                <td class="py-2.5 text-right">¥${t.water.toLocaleString()}</td>
                <td class="py-2.5 text-right">¥${t.gas.toLocaleString()}</td>
                <td class="py-2.5 text-right text-clay-500">¥${t.cost.toLocaleString()}</td>
                <td class="py-2.5 text-right font-medium">¥${t.profit.toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    // 渲染图表
    setTimeout(() => {
      const ctx = document.getElementById('revChart');
      if (!ctx) return;
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: totals.map(t => t.month),
          datasets: [
            { label: '营收', data: totals.map(t => t.revenue), backgroundColor: '#7d9a6f' },
            { label: '成本', data: totals.map(t => t.cost),    backgroundColor: '#b97859' },
            { label: '净利', type: 'line', data: totals.map(t => t.profit), borderColor: '#485f3f', backgroundColor: 'transparent', tension: 0.3 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { font: { family: 'IBM Plex Sans' } } } },
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(155,148,132,.1)' } }, x: { grid: { display: false } } }
        }
      });
    }, 50);
  },

  // === 新增订单弹窗 ===
  _openOrderModal() {
    const subs = ['1','2','3','4','5','6','7','8','9','10','11','12','15','16'];
    const suiteOpts = ['401','1302','407','1502','503','1202'];
    Notify.modal({
      title: '新增订单',
      body: `
        <div class="space-y-3 text-sm">
          <div>
            <label class="field-label">订单类型</label>
            <div class="flex gap-2">
              <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="oType" value="分租" checked> 分租</label>
              <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="oType" value="整租"> 整租</label>
            </div>
          </div>
          <div id="roomField">
            <label class="field-label">子房号</label>
            <select id="oSubRoom" class="field">${subs.map(s => `<option value="${s}">${s}号</option>`).join('')}</select>
          </div>
          <div id="suiteField" class="hidden">
            <label class="field-label">套房号（整租）</label>
            <select id="oSuite" class="field">
              <option value="">-- 选择 --</option>
              <option value="1302">1302（可整租）</option>
              <option value="407">407（可整租）</option>
              <option value="503">503（可整租）</option>
              <option value="1202">1202（纯整租）</option>
            </select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">入住日期</label><input id="oCheckIn"  type="date" class="field" value="${DateUtil.today()}"></div>
            <div><label class="field-label">退房日期</label><input id="oCheckOut" type="date" class="field" value="${DateUtil.fmt(DateUtil.addDays(DateUtil.today(), 1))}"></div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="field-label">客源</label><input id="oSource" class="field" placeholder="李女士 / 客户名"></div>
            <div><label class="field-label">押金</label><input id="oDeposit" class="field" type="number" placeholder="500"></div>
          </div>
          <div><label class="field-label">目的（陪诊/异地就医/旅游...）</label><input id="oPurpose" class="field" placeholder="陪诊旅居"></div>
          <div><label class="field-label">备注</label><input id="oNote" class="field" placeholder="可选"></div>
        </div>
      `,
      primary: '校验并下单',
      onPrimary: () => this._submitOrder()
    });
    // 类型切换
    setTimeout(() => {
      document.querySelectorAll('input[name="oType"]').forEach(r => {
        r.addEventListener('change', () => {
          const isWhole = document.querySelector('input[name="oType"]:checked').value === '整租';
          document.getElementById('roomField').classList.toggle('hidden', isWhole);
          document.getElementById('suiteField').classList.toggle('hidden', !isWhole);
        });
      });
    }, 50);
  },

  async _submitOrder() {
    const orderType = document.querySelector('input[name="oType"]:checked').value;
    const checkIn  = document.getElementById('oCheckIn').value;
    const checkOut = document.getElementById('oCheckOut').value;
    const target   = orderType === '整租'
      ? document.getElementById('oSuite').value
      : document.getElementById('oSubRoom').value;
    if (!target) { Notify.toast('请选择房号', 'error'); return; }
    if (!checkIn || !checkOut) { Notify.toast('请选择入住/退房日期', 'error'); return; }
    if (checkOut <= checkIn) { Notify.toast('退房日期必须晚于入住日期', 'error'); return; }

    const existing = await Lock.loadAllOrders();
    const result = Lock.check({ targetRoom: target, orderType, checkIn, checkOut, existing });
    if (!result.ok) {
      const conflictHtml = (result.conflicts || []).slice(0, 5).map(c => `<li>· ${c}</li>`).join('');
      Notify.modal({
        title: '⛔ 互斥锁房冲突',
        body: `<div class="text-clay-500 mb-2">${result.reason}</div>${conflictHtml ? `<ul class="text-xs text-ink-400 mt-2 space-y-1">${conflictHtml}</ul>` : ''}<div class="text-xs text-ink-300 mt-3">本订单已阻止写入，请调整日期或房型。</div>`,
        primary: '我知道了'
      });
      return;
    }
    const order = {
      id: 'O' + Date.now() + Math.random().toString(36).slice(2, 5).toUpperCase(),
      subRoom: target,
      type: orderType,
      checkIn, checkOut,
      deposit: document.getElementById('oDeposit').value,
      customerSource: document.getElementById('oSource').value || '客户',
      purpose: document.getElementById('oPurpose').value,
      note: document.getElementById('oNote').value
    };
    await Sheet.writeOrder(order);
    Notify.toast('订单已创建，写入「订单同步明细」+「工作台操作日志」', 'success');
    Sheet.invalidate();
    await this._renderView();
  }
};

window['biz-bnb'] = BnbModule;
