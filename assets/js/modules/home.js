/* ====================================================================
   home.js - 首页：4 区卡片 + 周期汇报 + 拖拽排序
   ==================================================================== */

const HomeModule = {
  async render(root) {
    console.log('[home] render start');
    root.innerHTML = `
      <div class="space-y-8 module-fade">
        <div>
          <div class="section-eyebrow">${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
          <h1 class="section-title">早安，小污</h1>
          <p class="mt-2 text-ink-400 text-sm">今日民宿有 <span id="occCount" class="text-clay-500 font-medium">—</span> 间在住、<span id="vacantCount" class="text-sage-500 font-medium">—</span> 间空置。</p>
        </div>

        <div id="homeCards" class="grid grid-cols-1 lg:grid-cols-2 gap-5"></div>

        <div class="divider"></div>

        <section>
          <div class="flex items-baseline justify-between mb-4">
            <h2 class="font-serif text-2xl font-semibold text-ink-600">周期汇报</h2>
            <div class="flex gap-2">
              <button id="genDailyBtn"  class="btn btn-secondary btn-sm"><i data-lucide="sun" class="w-3.5 h-3.5"></i>生成晨间日报</button>
              <button id="genWeeklyBtn" class="btn btn-secondary btn-sm"><i data-lucide="calendar" class="w-3.5 h-3.5"></i>生成本周周报</button>
            </div>
          </div>
          <div id="reportsArea" class="grid grid-cols-1 lg:grid-cols-2 gap-5"></div>
        </section>
      </div>
    `;
    if (window.lucide) lucide.createIcons();

    // 拉数据
    let orders = [];
    try { orders = await Lock.loadAllOrders(); }
    catch (e) { console.warn('[home] Lock.loadAllOrders failed', e); }
    const today = DateUtil.today();
    const units = Lock.rentableUnits();
    const occupiedUnits = units.filter(u => Lock.isOccupiedOn(u.id, today, orders));
    document.getElementById('occCount').textContent = occupiedUnits.length;
    document.getElementById('vacantCount').textContent = units.length - occupiedUnits.length;

    // 渲染卡片
    console.log('[home] rendering cards...');
    this._renderCards(orders);
    this._renderReports();
    this._bindActions();
    this._initSortable();
    // 自动化汇报：进入首页若无今日/本周汇报则自动生成
    console.log('[home] kicking _autoReports (fire-and-forget)');
    this._autoReports().catch(e => console.error('[home] _autoReports failed', e));
    console.log('[home] render done');
  },

  _cardTemplate(id, eyebrow, title, bodyHtml, badge = '') {
    return `
      <article data-card-id="${id}" class="surface-card p-5 lg:p-6 cursor-grab active:cursor-grabbing">
        <div class="flex items-start justify-between mb-3">
          <div>
            <div class="section-eyebrow">${eyebrow}</div>
            <h3 class="font-serif text-lg font-semibold text-ink-600 mt-0.5">${title}</h3>
          </div>
          <div class="flex items-center gap-2">
            ${badge}
            <i data-lucide="grip-vertical" class="w-4 h-4 text-ink-200"></i>
          </div>
        </div>
        <div class="text-sm text-ink-500 leading-relaxed">${bodyHtml}</div>
      </article>
    `;
  },

  async _renderCards(orders) {
    const wrap = document.getElementById('homeCards');
    if (!wrap) return;
    const today = DateUtil.today();
    const order = Store.homeCardOrder();

    // 1. 当日工作速览
    const unitsCalc = Lock.rentableUnits();
    const occupiedUnits = new Set(unitsCalc.filter(u => Lock.isOccupiedOn(u.id, today, orders)).map(u => u.id));
    const vacantSubs = unitsCalc.filter(u => !occupiedUnits.has(u.id)).map(u => u.id);
    const onDay = orders.filter(o => DateUtil.range(o.checkIn, o.checkOut || o.checkIn).slice(0, -1).includes(today));
    const pendingContents = Store.contents().filter(c => c.status === 'draft' || c.status === 'compliance_ok' || c.status === '已排期').slice(0, 3);
    const workHtml = `
      <div class="grid grid-cols-2 gap-3">
        <div class="surface-elevated p-3">
          <div class="text-[11px] text-ink-300 tracking-wider uppercase">在住</div>
          <div class="metric-display text-2xl text-clay-500 mt-1">${onDay.length}<span class="text-sm text-ink-300 ml-1">间</span></div>
          <div class="text-xs text-ink-400 mt-1">${onDay.slice(0, 3).map(o => o.subRoom + '号').join('、') || '—'}</div>
        </div>
        <div class="surface-elevated p-3">
          <div class="text-[11px] text-ink-300 tracking-wider uppercase">空置</div>
          <div class="metric-display text-2xl text-sage-500 mt-1">${vacantSubs.length}<span class="text-sm text-ink-300 ml-1">间</span></div>
          <div class="text-xs text-ink-400 mt-1">${vacantSubs.slice(0, 3).map(s => s + '号').join('、') || '—'}</div>
        </div>
      </div>
      ${pendingContents.length ? `
        <div class="mt-4">
          <div class="text-xs text-ink-400 mb-2">自媒体待发 (${pendingContents.length})</div>
          <ul class="space-y-1.5">
            ${pendingContents.map(c => `<li class="flex items-center gap-2 text-sm"><span class="chip chip-sage">${c.platform}</span><span class="truncate flex-1">${c.title || c.topic}</span></li>`).join('')}
          </ul>
        </div>
      ` : ''}
      <a href="#/biz/bnb" class="mt-4 inline-flex items-center gap-1 text-xs text-sage-600 hover:underline">前往房态管理 <i data-lucide="arrow-right" class="w-3 h-3"></i></a>
    `;

    // 2. 当日生活提醒
    const reminders = Notify.getAll().slice(0, 4);
    const lifeHtml = reminders.length === 0
      ? '<div class="text-ink-300 text-sm py-4 text-center">今日无紧急提醒 ✨</div>'
      : `<ul class="space-y-2">
          ${reminders.map(r => `
            <li class="flex items-start gap-3 py-1">
              <span class="status-dot ${r.level === 'danger' ? 'status-blocked' : r.level === 'warn' ? 'status-cleaning' : 'status-occupied'} mt-1.5"></span>
              <div class="flex-1 min-w-0">
                <div class="text-sm text-ink-500">${r.title}</div>
                <div class="text-xs text-ink-400 truncate">${r.message}</div>
              </div>
            </li>
          `).join('')}
        </ul>`;

    // 3. 核心数据概览
    let monthlyRev = 0, lastMonth = '';
    try {
      const rep = await Sheet.getMonthlyReport();
      if (rep && rep.length > 1) {
        const last = rep[rep.length - 1];
        lastMonth = last[0] || '';
        for (let i = 1; i <= 3; i++) monthlyRev += Number(last[i] || 0);
      }
    } catch (e) {}
    const accounts = Store.accounts();
    const totalAssets = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
    const occRate = unitsCalc.length === 0 ? 0 : Math.round((occupiedUnits.size / unitsCalc.length) * 100);
    const checkins = Store.checkins();
    const weekCheckin = checkins.filter(c => c.date && DateUtil.fromToday(c.date) >= -7).length;
    const metricsHtml = `
      <div class="grid grid-cols-2 gap-3">
        <div class="surface-elevated p-3">
          <div class="text-[11px] text-ink-300 tracking-wider uppercase">民宿月营收</div>
          <div class="metric-display text-2xl text-ink-600 mt-1">¥${(monthlyRev/1000).toFixed(1)}<span class="text-sm text-ink-300 ml-1">k</span></div>
          <div class="text-xs text-ink-400 mt-1">${lastMonth || '—'}</div>
        </div>
        <div class="surface-elevated p-3">
          <div class="text-[11px] text-ink-300 tracking-wider uppercase">入住率</div>
          <div class="metric-display text-2xl text-sage-500 mt-1">${occRate}<span class="text-sm text-ink-300 ml-1">%</span></div>
          <div class="text-xs text-ink-400 mt-1">今日</div>
        </div>
        <div class="surface-elevated p-3">
          <div class="text-[11px] text-ink-300 tracking-wider uppercase">个人资产</div>
          <div class="metric-display text-2xl text-clay-500 mt-1">¥${(totalAssets/10000).toFixed(2)}<span class="text-sm text-ink-300 ml-1">w</span></div>
          <div class="text-xs text-ink-400 mt-1">${accounts.length} 个账户</div>
        </div>
        <div class="surface-elevated p-3">
          <div class="text-[11px] text-ink-300 tracking-wider uppercase">本周打卡</div>
          <div class="metric-display text-2xl text-ink-600 mt-1">${weekCheckin}<span class="text-sm text-ink-300 ml-1">次</span></div>
          <div class="text-xs text-ink-400 mt-1">近 7 天</div>
        </div>
      </div>
    `;

    // 4. 快捷入口
    const shortcutsHtml = `
      <div class="grid grid-cols-2 gap-2.5">
        <a href="#/biz/bnb"        class="surface-elevated p-3 hover:translate-y-[-1px] transition flex items-center gap-3">
          <i data-lucide="bed-double" class="w-4 h-4 text-sage-500"></i><span class="text-sm">房态管理</span>
        </a>
        <a href="#/life/finance"   class="surface-elevated p-3 hover:translate-y-[-1px] transition flex items-center gap-3">
          <i data-lucide="pencil-line" class="w-4 h-4 text-sage-500"></i><span class="text-sm">快速记账</span>
        </a>
        <a href="#/life/growth"    class="surface-elevated p-3 hover:translate-y-[-1px] transition flex items-center gap-3">
          <i data-lucide="book-open"  class="w-4 h-4 text-sage-500"></i><span class="text-sm">读书笔记</span>
        </a>
        <a href="#/biz/media"      class="surface-elevated p-3 hover:translate-y-[-1px] transition flex items-center gap-3">
          <i data-lucide="sparkles"   class="w-4 h-4 text-sage-500"></i><span class="text-sm">一键生成</span>
        </a>
      </div>
    `;

    const cards = [
      { id: 'work_today',  eyebrow: '当日工作',  title: '民宿工作速览',     body: workHtml,   badge: '<span class="chip chip-clay">实时</span>' },
      { id: 'life_today',  eyebrow: '当日生活',  title: '生活提醒',         body: lifeHtml,   badge: '' },
      { id: 'metrics',     eyebrow: '核心数据',  title: '一眼掌控',         body: metricsHtml,badge: '' },
      { id: 'shortcuts',   eyebrow: '快捷入口',  title: '直达高频功能',     body: shortcutsHtml, badge: '' }
    ];
    const sorted = order.map(id => cards.find(c => c.id === id)).filter(Boolean);
    // 追加新卡片（如果顺序中有但 cards 中没有，跳过；cards 中有但 order 中没有，追加到末尾）
    cards.forEach(c => { if (!sorted.find(s => s.id === c.id)) sorted.push(c); });

    wrap.innerHTML = sorted.map(c => this._cardTemplate(c.id, c.eyebrow, c.title, c.body, c.badge)).join('');
    if (window.lucide) lucide.createIcons();
  },

  async _renderReports() {
    const wrap = document.getElementById('reportsArea');
    if (!wrap) return;
    // 汇报从云端 KV（Store.reports）读取 —— 可靠跨设备，不依赖文档写入
    const all = Store.reports();
    const daily = all.filter(r => r.kind === 'daily_report').slice(-3).reverse();
    const weekly = all.filter(r => r.kind === 'weekly_report').slice(-3).reverse();
    const dimsHtml = (r) => {
      if (!r || !r.content) return `<div class="text-ink-500 line-clamp-2">—</div>`;
      // v1：完整内容展示（结构化文本，按行换行）
      const escaped = (r.content || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const lines = escaped.split('\n').map(l => `<div>${l}</div>`).join('');
      return `<details class="mt-1"><summary class="text-xs text-ink-400 cursor-pointer hover:text-sage-600">${r.period || (r.ts || '').slice(0, 10)} · 点击展开</summary><div class="text-xs text-ink-500 mt-2 space-y-0.5 leading-relaxed">${lines}</div></details>`;
    };
    wrap.innerHTML = `
      <article class="surface-card p-5">
        <div class="flex items-baseline justify-between mb-3">
          <h3 class="font-serif text-lg font-semibold text-ink-600">晨间日报</h3>
          <span class="chip chip-sage">每日 8:00</span>
        </div>
        ${daily.length === 0
          ? '<div class="text-ink-300 text-sm py-3">尚未生成，点击右上角按钮立即生成</div>'
          : `<ul class="space-y-3">${daily.map(r => `
              <li class="text-sm border-l-2 border-sand-300 pl-3 py-1">
                <div class="text-xs text-ink-300">${r.period || (r.ts || '').slice(0, 10)}</div>
                ${dimsHtml(r)}
              </li>`).join('')}</ul>`}
      </article>
      <article class="surface-card p-5">
        <div class="flex items-baseline justify-between mb-3">
          <h3 class="font-serif text-lg font-semibold text-ink-600">周度总结</h3>
          <span class="chip chip-clay">每周一 8:00</span>
        </div>
        ${weekly.length === 0
          ? '<div class="text-ink-300 text-sm py-3">尚未生成</div>'
          : `<ul class="space-y-3">${weekly.map(r => `
              <li class="text-sm border-l-2 border-clay-200 pl-3 py-1">
                <div class="text-xs text-ink-300">${r.period || (r.ts || '').slice(0, 10)}</div>
                ${dimsHtml(r)}
              </li>`).join('')}</ul>`}
      </article>
    `;
  },

  _bindActions() {
    document.getElementById('genDailyBtn')?.addEventListener('click', () => this._generateDaily());
    document.getElementById('genWeeklyBtn')?.addEventListener('click', () => this._generateWeekly());
  },

  // 计算汇报四维度：自媒体产出 / 健康趋势 / 成长完成度 / 下周建议
  _reportDimensions(start, end) {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // 自媒体产出
    const contents = Store.contents();
    const published = contents.filter(c => c.status === '已发布' && c.date >= start && c.date <= end);
    const byPlat = {};
    published.forEach(c => { const p = c.plat || c.platform || '其他'; byPlat[p] = (byPlat[p] || 0) + 1; });
    const platLabel = { xhs: '小红书', dy: '抖音' };
    const media = published.length
      ? `产出 ${published.length} 篇（${Object.entries(byPlat).map(([k, v]) => (platLabel[k] || k) + v).join('、')}）`
      : '本周暂无新发布，建议结合热点排期';

    // 健康趋势
    const weights = Store.weights().slice().sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = weights.length ? weights[weights.length - 1].v : null;
    const target = Store.get('weight_target', null);
    let weight = latest != null ? `体重 ${latest}kg` : '体重未记录';
    if (target != null && latest != null) {
      const diff = latest - target;
      weight += diff > 0 ? `（距目标差 ${diff.toFixed(1)}kg）` : (diff < 0 ? `（低于目标 ${(-diff).toFixed(1)}kg）` : '（已达标）');
    }
    let cycle = '生理周期未记录';
    const cycles = Store.cycles();
    if (cycles.length) {
      const sorted = cycles.map(c => ({ s: new Date(c.start) })).sort((a, b) => a.s - b.s);
      const gaps = []; for (let i = 1; i < sorted.length; i++) gaps.push(Math.round((sorted[i].s - sorted[i - 1].s) / 864e5));
      const avg = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 28;
      const next = new Date(sorted[sorted.length - 1].s); next.setDate(next.getDate() + avg);
      cycle = `下次生理期约 ${DateUtil.fmt(next)}（${Math.round((next - today) / 864e5)} 天）`;
    }
    const due = Store.healthChecks().filter(c => c.next && c.next >= start && c.next <= end);
    const healthParts = [weight, cycle];
    if (due.length) healthParts.push(`${due.length} 项体检/提醒临近（${due.map(c => c.name).join('、')}）`);
    const health = healthParts.join('；');

    // 成长完成度
    const skills = Store.skills();
    const skillPct = skills.length ? Math.round(skills.reduce((s, k) => s + Math.min(100, Math.round((k.done || 0) / (k.goal || 1) * 100)), 0) / skills.length) : 0;
    const books = Store.books();
    const bookPct = books.length ? Math.round(books.reduce((s, b) => s + (b.progress || 0), 0) / books.length) : 0;
    const ck = Store.checkins().filter(c => c.done && c.date >= start && c.date <= end);
    const growth = `技能均进度 ${skillPct}%、书籍均读 ${bookPct}%；区间打卡 ${ck.length} 次`;

    // 下周建议
    const sugg = [];
    let vac = 0;
    try { if (window.RoomState && RoomState.vacancy) { const v = RoomState.vacancy(7); vac = v.reduce((s, u) => s + (u.freeDays || 0), 0); } } catch (e) {}
    sugg.push(vac > 0 ? `未来7天空置 ${vac} 间·夜，优先做 401/1502 分租种草` : '关注空置房源营销');
    const hot = Store.hotTopics();
    if (hot && hot.topics && hot.topics.length) sugg.push(`结合热点「${hot.topics[0].title || hot.topics[0]}」做选题`);
    if (skillPct < 60) sugg.push('技能打卡偏慢，建议每日固定 15 分钟');
    if (target != null && latest != null && latest > target) sugg.push('体重高于目标，注意本周饮食运动');
    const suggText = sugg.slice(0, 3).join('；');

    return { media, health, growth, sugg: suggText };
  },

  _monthlyRevenue() {
    try {
      if (window.RoomState && RoomState.revenueSummary) {
        const rs = RoomState.revenueSummary(DateUtil.today());
        if (rs && rs.revenue) return rs.revenue;
      }
    } catch (e) {}
    return 0;
  },

  async _generateDaily() {
    const today = DateUtil.today();
    const orders = await Lock.loadAllOrders();
    const onDay = orders.filter(o => DateUtil.range(o.checkIn, o.checkOut || o.checkIn).slice(0, -1).includes(today));

    // === 民宿段 ===
    const tomorrow = DateUtil.fmt(DateUtil.addDays(today, 1));
    const tomorrowIn = orders.filter(o => o.checkIn === tomorrow);
    const tomorrowOut = orders.filter(o => o.checkOut === tomorrow);
    const checkoutsToday = onDay.filter(o => o.checkOut === today);
    const monthlyRev = this._monthlyRevenue() || 0;
    const roomBlock = [
      `民宿：在住 ${onDay.length} 间（${onDay.slice(0, 6).map(o => o.subRoom + '号').join('、') || '—'}）`,
      checkoutsToday.length ? `，今日退房 ${checkoutsToday.length} 间（${checkoutsToday.map(o => o.subRoom + '号').join('、')}），需安排打扫` : '，今日无退房',
      `，本月累计营收 ¥${(monthlyRev / 1000).toFixed(1)}k`,
      tomorrowIn.length || tomorrowOut.length
        ? `；明日入住 ${tomorrowIn.length} / 退房 ${tomorrowOut.length}`
        : ''
    ].join('');

    // === 自媒体段 ===
    const contents = Store.contents();
    const todayContents = contents.filter(c => c.date === today);
    const publishedToday = todayContents.filter(c => c.status === '已发布');
    const hot = Store.hotTopics();
    const mediaBlock = `自媒体：${hot?.topics?.length ? `今日热点 ${hot.topics.length} 条` : '热点待抓取'}，${todayContents.length ? `生成 ${todayContents.length} 篇 / 已发布 ${publishedToday.length} 篇` : '尚未生成内容'}`;

    // === 生活段 ===
    const weights = Store.weights();
    const lastWeight = weights.length ? weights[weights.length - 1] : null;
    const target = Store.get('weight_target', null);
    let weightStr = lastWeight ? `体重 ${lastWeight.v}kg` : '体重未记录';
    if (target != null && lastWeight) {
      const diff = lastWeight.v - target;
      weightStr += diff > 0 ? `（距目标 +${diff.toFixed(1)}）` : (diff < 0 ? `（低于目标 ${(-diff).toFixed(1)}）` : '（达标）');
    }
    let cycleStr = '生理周期未记录';
    const cycles = Store.cycles();
    if (cycles.length) {
      try {
        const pred = DateUtil.cycle.predict(cycles);
        if (pred && pred.daysUntilNext >= 0) cycleStr = `下次生理期约 ${DateUtil.fmt(pred.nextStart)}（${pred.daysUntilNext} 天）`;
      } catch (e) {}
    }
    const dueChecks = Store.healthChecks().filter(c => c.next && DateUtil.fromToday(c.next) >= 0 && DateUtil.fromToday(c.next) <= 7);
    const lifeBlock = `生活：${weightStr}；${cycleStr}${dueChecks.length ? '；' + dueChecks.length + ' 项体检临近' : ''}`;

    // === 成长段 ===
    const books = Store.books();
    const reading = books.filter(b => b.progress > 0 && b.progress < 100).sort((a, b) => (b.lastRead || '').localeCompare(a.lastRead || ''))[0];
    const growthBlock = reading ? `成长：在读《${reading.title}》${reading.progress || 0}%` : '成长：今日无阅读记录';

    // === 明日待办 ===
    const tasks = [];
    tomorrowIn.forEach(o => tasks.push(`${o.checkIn} 入住：${o.subRoom}号 · ${o.customerSource || '客户'}`));
    tomorrowOut.forEach(o => tasks.push(`${o.checkOut} 退房：${o.subRoom}号 · ${o.customerSource || '客户'}`));
    if (checkoutsToday.length) tasks.push(`今日打扫：${checkoutsToday.map(o => o.subRoom + '号').join('、')}`);
    if (dueChecks.length) tasks.push(`体检提醒：${dueChecks.map(c => c.name).join('、')}`);
    if (tomorrowIn.length === 0 && tomorrowOut.length === 0) tasks.push('明日暂无入住/退房，建议做空置房源营销');
    const tasksBlock = `明日待办：${tasks.slice(0, 5).join('；')}`;

    // === 汇总 ===
    const content = [
      `【愈心小筑】 ${today} 今日复盘`,
      roomBlock,
      mediaBlock,
      lifeBlock,
      growthBlock,
      tasksBlock
    ].join('\n');

    const kept = Store.reports().filter(r => !(r.kind === 'daily_report' && r.period === today));
    Store.set('reports', kept);
    // v1：用新的 write 方法（含文档同步回执）
    await Store.write('reports',
      [...kept, { kind: 'daily_report', content, period: today, ts: new Date().toISOString() }],
      { alsoAppendDoc: true, sheetName: '工作台操作日志', row: [new Date().toISOString(), '小污', '自动化', '今日复盘生成', today, content.slice(0, 200), 'daily_report', ''] }
    ).catch(() => {});
    Notify.toast('今日复盘已生成', 'success');
    this._renderReports();
  },

  async _generateWeekly() {
    const today = DateUtil.today();
    const d = new Date();
    const monday = DateUtil.fmt(new Date(d.setDate(d.getDate() - ((d.getDay() + 6) % 7))));
    const weekAgo = DateUtil.fmt(DateUtil.addDays(today, -6));
    const orders = await Lock.loadAllOrders();
    const weekOrders = orders.filter(o => o.checkIn >= weekAgo && o.checkIn <= today);
    const monthlyRev = this._monthlyRevenue() || 0;

    // 营收分项
    const wholeOrders = weekOrders.filter(o => o.type === '整租');
    const subOrders = weekOrders.filter(o => o.type === '分租');
    const weekRevenue = weekOrders.reduce((s, o) => s + Number(o.total || 0), 0);
    const revenueLine = `整租 ${wholeOrders.length} 笔 / 分租 ${subOrders.length} 笔 / 区间营收 ¥${(weekRevenue / 1000).toFixed(1)}k / 本月累计 ¥${(monthlyRev / 1000).toFixed(1)}k`;

    // 自媒体
    const contents = Store.contents();
    const weekContents = contents.filter(c => c.date >= weekAgo && c.date <= today);
    const byPlat = { xhs: 0, dy: 0 };
    weekContents.filter(c => c.status === '已发布').forEach(c => { byPlat[c.plat] = (byPlat[c.plat] || 0) + 1; });
    const mediaLine = `本周发布 ${weekContents.filter(c => c.status === '已发布').length} 篇（小红书 ${byPlat.xhs || 0} / 抖音 ${byPlat.dy || 0}），草稿 ${weekContents.filter(c => c.status === '草稿').length} 篇`;

    // 健康
    const weights = Store.weights().filter(w => w.date >= weekAgo && w.date <= today).sort((a, b) => a.date.localeCompare(b.date));
    const weightStart = weights[0]?.v;
    const weightEnd = weights[weights.length - 1]?.v;
    const weightDelta = (weightStart != null && weightEnd != null) ? (weightEnd - weightStart).toFixed(1) : '—';
    const healthLine = `体重 ${weightStart ?? '—'} → ${weightEnd ?? '—'}（${weightDelta >= 0 ? '+' : ''}${weightDelta}kg），打卡 ${weights.length} 次`;

    // 成长
    const weekCheckin = Store.checkins().filter(c => c.done && c.date >= weekAgo && c.date <= today);
    const growthLine = `本周学习打卡 ${weekCheckin.length} 次，技能均进度 ${this._skillPct()}%`;

    // 下周建议（基于空置 + 热点 + 健康 + 技能）
    const dims = this._reportDimensions(weekAgo, today);
    const suggLine = `下周建议：${dims.sugg}`;

    const content = [
      `【愈心小筑】 ${weekAgo} ~ ${today} 周报`,
      `民宿：订单 ${weekOrders.length} 笔｜${revenueLine}`,
      mediaLine,
      healthLine,
      growthLine,
      suggLine
    ].join('\n');

    const kept = Store.reports().filter(r => !(r.kind === 'weekly_report' && r.period === monday));
    Store.set('reports', kept);
    await Store.write('reports',
      [...kept, { kind: 'weekly_report', content, period: monday, ts: new Date().toISOString() }],
      { alsoAppendDoc: true, sheetName: '工作台操作日志', row: [new Date().toISOString(), '小污', '自动化', '本周周报生成', monday, content.slice(0, 200), 'weekly_report', ''] }
    ).catch(() => {});
    Notify.toast('本周周报已生成', 'success');
    this._renderReports();
  },

  _skillPct() {
    const skills = Store.skills();
    if (!skills.length) return 0;
    const total = skills.reduce((s, k) => s + Math.min(100, Math.round((k.done || 0) / (k.goal || 1) * 100)), 0);
    return Math.round(total / skills.length);
  },

  // 自动化汇报：进入首页时若今日/本周尚未生成，则自动补生成（模拟每日 8:00 / 每周一）
  async _autoReports() {
    const today = DateUtil.today();
    const reports = Store.reports();
    const hasDaily = reports.some(r => r.kind === 'daily_report' && r.period === today);
    if (!hasDaily) await this._generateDaily();
    // 本周周一
    const d = new Date();
    const monday = DateUtil.fmt(new Date(d.setDate(d.getDate() - ((d.getDay() + 6) % 7))));
    const hasWeekly = reports.some(r => r.kind === 'weekly_report' && r.period === monday);
    if (!hasWeekly) await this._generateWeekly();
  },

  _initSortable() {
    const el = document.getElementById('homeCards');
    if (!el || !window.Sortable) return;
    Sortable.create(el, {
      animation: 200,
      handle: '.surface-card',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: (evt) => {
        const order = [...el.querySelectorAll('[data-card-id]')].map(c => c.dataset.cardId);
        Store.setHomeCardOrder(order);
        Notify.toast('首页顺序已保存', 'success', 1500);
      }
    });
  }
};

window['home'] = HomeModule;
