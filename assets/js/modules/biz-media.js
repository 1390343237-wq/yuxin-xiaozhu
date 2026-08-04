/* ====================================================================
   biz-media.js - 自媒体营销中台
   子系统：热点采集 / 选题转化 / 内容生成(小红书+抖音) / 合规风控 / 发布日历
   SPA module: window['biz-media'].render(root)
   ==================================================================== */

const BizMedia = {
  name: '自媒体营销',
  desc: '热点·选题·生成·合规',
  async render(root) {
    root.innerHTML = '';
    root.classList.add('module-biz-media');

    const tabs = [
      { id:'hot',    label:'热点榜单' },
      { id:'topic',  label:'选题库' },
      { id:'gen',    label:'内容生成' },
      { id:'cal',    label:'发布日历' }
    ];
    let active = Store.get('bm_tab', 'hot');
    const page = document.createElement('div'); page.className='module-page'; root.appendChild(page);

    const mount = ()=>{
      page.innerHTML = `
        <div class="mb-6">
          <h1 class="section-title">自媒体营销中台</h1>
          <p class="text-ink-400 text-sm mt-1">垂直领域热点 → 选题 → 合规内容，为民宿引流</p>
        </div>
        <div class="tab-bar mb-6" id="bmTabs">
          ${tabs.map(t=>`<button class="tab-btn ${t.id===active?'active':''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div id="bmBody"></div>`;
      page.querySelectorAll('#bmTabs .tab-btn').forEach(b=>{
        b.onclick=()=>{ active=b.dataset.tab; Store.set('bm_tab',active); mount(); };
      });
      const body=page.querySelector('#bmBody');
      if(active==='hot')   this._hot(body);
      if(active==='topic') this._topic(body);
      if(active==='gen')   this._gen(body);
      if(active==='cal')   this._cal(body);
      if(window.lucide) lucide.createIcons();
    };
    mount();
  },

  /* ---------- 热点采集 ---------- */
  _hot(root) {
    const cache = Store.hotTopics();
    const isFresh = cache.date === DateUtil.fmt(new Date());
    root.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="font-serif text-lg text-ink-600">垂直领域热点榜单</h3>
          <p class="text-xs text-ink-400 mt-1">${isFresh?'今日已更新':'缓存可能过期'} · 更新日期 ${cache.date||'—'}</p>
        </div>
        <button class="btn btn-primary btn-sm" id="refreshHot"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> 抓取最新</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="hotGrid">
        ${(cache.topics&&cache.topics.length)?cache.topics.map((t,i)=>`
          <div class="card p-4">
            <div class="flex items-center justify-between">
              <span class="badge badge-rank">#${i+1}</span>
              <span class="text-xs text-ink-400">${t.heat||'热'}🔥</span>
            </div>
            <div class="font-medium text-ink-600 text-sm mt-2">${t.title}</div>
            <div class="text-xs text-ink-400 mt-1">${t.tag||''}</div>
            <button class="btn btn-secondary btn-xs mt-3" data-use="${i}">转选题</button>
          </div>`).join(''):'<div class="card p-4 col-span-full text-ink-400 text-center">暂无热点，点击抓取</div>'}
      </div>`;

    root.querySelector('#refreshHot').onclick=async ()=>{
      const btn = root.querySelector('#refreshHot'); btn.disabled=true; btn.textContent='抓取中…';
      // 优先尝试读取自动化任务更新的本地缓存文件；失败则用内置种子兜底
      let topics = null;
      try {
        const r = await fetch('data/hot_cache.json?t='+Date.now());
        if (r.ok) { const j = await r.json(); topics = j.topics; }
      } catch(e) {}
      if (!topics) {
        try {
          let j = Store.get('cfg_hot_keywords', null);
          if (!j) {
            const r = await fetch('data/hot_keywords.json?t='+Date.now());
            if (r.ok) j = await r.json();
          }
          if (j) {
            if (Array.isArray(j.topics)) {
              topics = j.topics;
            } else {
              // 兼容 {primary:[...], secondary:[...]} 结构
              const flat = [...(j.primary||[]), ...(j.secondary||[])];
              topics = flat.map(x => typeof x === 'string' ? { title:x, tag:'就医旅居', heat:'中' } : x);
            }
          }
        } catch(e) {}
      }
      if (!topics) topics = [
        {title:'天坛医院周边住宿攻略',tag:'天坛医院',heat:'高'},
        {title:'异地就医医保报销流程',tag:'医保报销',heat:'高'},
        {title:'陪诊师一天的工作',tag:'陪诊',heat:'中'},
        {title:'北京就医民宿怎么选',tag:'就医民宿',heat:'中'},
        {title:'肿瘤患者家属照护指南',tag:'就医攻略',heat:'高'}
      ];
      Store.setHotTopics({date:DateUtil.fmt(new Date()), topics});
      Notify.success('热点已更新'); this._hot(root);
    };
    root.querySelectorAll('[data-use]').forEach(b=>b.onclick=()=>{
      const t = cache.topics[parseInt(b.dataset.use)];
      Store.set('bm_draft_topic', t.title); Store.set('bm_tab','topic'); this.render(root);
    });
  },

  /* ---------- 选题转化 ---------- */
  _topic(root) {
    const cache = Store.hotTopics();
    const draft = Store.get('bm_draft_topic','');
    const topics = (cache.topics&&cache.topics.length)?cache.topics:[
      {title:'天坛医院周边住宿攻略',tag:'天坛医院'},
      {title:'异地就医医保报销流程',tag:'医保报销'}
    ];
    root.innerHTML = `
      <h3 class="font-serif text-lg text-ink-600 mb-3">每日专属选题库</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${topics.map((t,i)=>`
          <div class="card p-4">
            <div class="flex items-center justify-between">
              <span class="font-medium text-ink-600 text-sm">${t.title}</span>
              <span class="badge badge-soft">${t.tag||'就医旅居'}</span>
            </div>
            <div class="text-xs text-ink-500 mt-2 bg-paper rounded p-2">${this._adapt(t)}</div>
            <div class="flex gap-2 mt-3">
              <label class="text-xs text-ink-400 flex items-center gap-1">适用平台：
                <select class="input input-sm" data-plat="${i}"><option value="xhs">小红书</option><option value="dy">抖音</option></select>
              </label>
              <button class="btn btn-primary btn-xs ml-auto" data-gen="${i}">去生成</button>
            </div>
          </div>`).join('')}
      </div>`;
    root.querySelectorAll('[data-gen]').forEach(b=>b.onclick=()=>{
      const i=parseInt(b.dataset.gen);
      const plat=root.querySelector(`[data-plat="${i}"]`).value;
      Store.set('bm_draft_topic', topics[i].title);
      Store.set('bm_draft_plat', plat);
      Store.set('bm_tab','gen'); this.render(root);
    });
  },

  _adapt(t) {
    return `结合「愈心小筑」民宿定位（天坛医院旁·安静舒适·陪诊便利），将“${t.title}”转化为：靠近医院的安心住宿 + 本地生活配套 + 就医陪伴体验内容，规避任何医疗效果宣称。`;
  },

  /* ---------- 内容生成（AI 驱动 + v1 升级：双层风控 + 替换建议）---------- */
  async _gen(root) {
    const topic = Store.get('bm_draft_topic','天坛医院周边住宿攻略');
    const plat = Store.get('bm_draft_plat','xhs');
    // 预热平台词库
    await Compliance.loadPlatform().catch(() => {});

    root.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-serif text-lg text-ink-600">一键内容生成（AI 驱动）</h3>
        <div class="flex gap-2">
          <input class="input input-sm" id="genTopic" value="${topic}" style="width:200px">
          <select class="input input-sm" id="genPlat">
            <option value="xhs" ${plat==='xhs'?'selected':''}>小红书</option>
            <option value="dy" ${plat==='dy'?'selected':''}>抖音</option>
          </select>
          <button class="btn btn-primary btn-sm" id="doGen"><i data-lucide="sparkles" class="w-3.5 h-3.5"></i> AI 生成</button>
        </div>
      </div>
      <div class="text-xs text-ink-400 mb-3">${this._aiHint()}</div>
      <div id="genOut" class="card p-5 min-h-[200px] text-xs text-ink-400">点击"AI 生成"，将基于选题 + 民宿定位产出文案，<b>双层风控自动扫描</b>（医疗敏感词 + 平台违禁词），命中后给出替换建议（不丢弃）。</div>`;

    const btn = root.querySelector('#doGen');
    btn.onclick = async () => {
      const t = root.querySelector('#genTopic').value;
      const p = root.querySelector('#genPlat').value;
      Store.set('bm_draft_topic', t); Store.set('bm_draft_plat', p);
      const out = root.querySelector('#genOut');
      btn.disabled = true; btn.innerHTML = '<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> 生成中…';
      try {
        const ai = await YxzAI.generate(t, p);
        let text = (ai && ai.text) || '';
        const src = (ai && ai.src) || 'local';
        const model = ai && ai.model;

        // v1 升级：双层风控（医疗 + 平台）
        const res = Compliance.check(text, p);
        this._renderGenResult(out, { text, src, model, platform: p, topic: t }, res);
      } catch (e) {
        out.innerHTML = `<div class="text-clay-600">生成失败：${e.message || e}</div>`;
      } finally {
        btn.disabled = false; btn.innerHTML = '<i data-lucide="sparkles" class="w-3.5 h-3.5"></i> AI 生成';
        if (window.lucide) lucide.createIcons();
      }
    };
  },

  /**
   * 渲染生成结果：含高亮 + 替换建议 + 一键采纳
   */
  _renderGenResult(out, ctx, res) {
    // 命中按层分组
    const byLayer = { medical: { high: [], medium: [] }, platform: { high: [], medium: [] } };
    res.hits.forEach(h => { byLayer[h.layer][h.level].push(h); });
    const total = res.hits.length;
    const platName = ctx.platform === 'xhs' ? '小红书' : '抖音';

    const renderSuggestions = () => {
      if (res.suggestions.length === 0) return '';
      return res.suggestions.map((s, i) => `
        <div class="flex items-center gap-2 py-1.5 border-b border-ink-100/60 last:border-0" data-sug="${i}">
          <span class="chip ${s.level === 'high' ? 'chip-clay' : 'chip-amber'} text-[10px]">${s.layer === 'medical' ? '医疗' : '平台'}</span>
          <span class="text-sm text-ink-600 font-mono">「${s.original}」</span>
          <span class="text-xs text-ink-300">→</span>
          <div class="flex flex-wrap gap-1.5">
            ${s.candidates.map((c, j) => `<button class="text-xs px-2 py-0.5 rounded bg-sand-200/60 hover:bg-sage-100 text-ink-600 transition" data-sug-apply="${i}" data-cand="${j}">${c}</button>`).join('')}
          </div>
        </div>
      `).join('');
    };

    out.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="font-medium text-ink-600">${ctx.platform==='xhs'?'📕 小红书文案':'🎬 抖音脚本'}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded ${ctx.src==='ai'?'bg-sage-100 text-sage-600':(ctx.src==='google-books'?'bg-blue-100 text-blue-600':'bg-ink-100 text-ink-400')}">${ctx.src==='ai'?'AI生成':(ctx.src==='google-books'?'Google Books':'本地模板')}${ctx.model ? ' · ' + ctx.model : ''}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs ${total === 0 ? 'text-sage-600' : (res.level === 'high' ? 'text-clay-600' : 'text-amber-600')}">${total === 0 ? '✓ 合规' : `命中 ${total} 处`}</span>
          <span class="badge ${res.level==='safe'?'badge-ok':(res.level==='medium'?'badge-warn':'badge-danger')}">${res.level==='safe'?'通过':(res.level==='medium'?'待确认':'拦截')}</span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- 左侧：原文 + 红色高亮 -->
        <div class="lg:col-span-2">
          <div class="text-xs text-ink-400 mb-1">生成文案 ${total > 0 ? '（<mark class="bg-clay-100 text-clay-600 px-0.5 rounded">橙色高亮</mark>=命中词）' : ''}</div>
          <pre id="genText" class="whitespace-pre-wrap text-sm text-ink-600 leading-relaxed bg-paper p-3 rounded">${Compliance.highlight(ctx.text, res.hits)}</pre>
        </div>
        <!-- 右侧：检测摘要 + 替换建议 -->
        <div>
          <div class="text-xs text-ink-400 mb-1">检测摘要</div>
          <div class="bg-paper p-3 rounded text-xs space-y-1">
            <div><span class="text-ink-300">医疗·阻断</span> <span class="text-clay-600 font-medium">${byLayer.medical.high.length}</span></div>
            <div><span class="text-ink-300">医疗·提示</span> <span class="text-amber-600 font-medium">${byLayer.medical.medium.length}</span></div>
            <div><span class="text-ink-300">${platName}·阻断</span> <span class="text-clay-600 font-medium">${byLayer.platform.high.length}</span></div>
            <div><span class="text-ink-300">${platName}·提示</span> <span class="text-amber-600 font-medium">${byLayer.platform.medium.length}</span></div>
          </div>
          ${total > 0 ? `
            <div class="text-xs text-ink-400 mt-3 mb-1">替换建议（点击直接采纳）</div>
            <div id="sugList" class="bg-paper p-2 rounded">${renderSuggestions()}</div>
            <div class="flex gap-1.5 mt-2">
              <button class="btn btn-secondary btn-xs flex-1" id="applyAllBtn">一键采纳全部（医疗）</button>
              <button class="btn btn-secondary btn-xs flex-1" id="recheckBtn"><i data-lucide="refresh-cw" class="w-3 h-3"></i> 重跑检测</button>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="mt-3 p-3 bg-paper rounded text-xs text-ink-500"><b>合规检测说明：</b><pre class="whitespace-pre-wrap mt-1">${res.report}</pre></div>

      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary btn-sm" id="saveContent">保存到内容库${res.level !== 'safe' ? '（含命中）' : ''}</button>
        <button class="btn btn-secondary btn-sm" id="regenContent"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> 重新生成</button>
        <button class="btn btn-secondary btn-sm" id="copyContent">复制全文</button>
        <button class="btn btn-secondary btn-sm" id="autoRewriteBtn" title="按医疗字典自动改写后再保存">自动改写</button>
      </div>`;

    if (window.lucide) lucide.createIcons();

    // 绑定事件
    out.querySelector('#saveContent').onclick = () => {
      Store.add('contents',{id:'m'+Date.now(),topic:ctx.topic,plat:ctx.platform,content:ctx.text,level:res.level,src:ctx.src,date:DateUtil.fmt(new Date()),status: res.level === 'safe' ? '草稿' : 'compliance_review'});
      Notify.success(res.level === 'safe' ? '已保存到内容库' : '已保存（待人工复核）');
      Store.set('bm_tab','cal'); this.render(root);
    };
    out.querySelector('#regenContent').onclick = () => btn.click();
    out.querySelector('#copyContent').onclick = async () => {
      try { await navigator.clipboard.writeText(ctx.text); Notify.success('已复制'); } catch(e) { Notify.warn('复制失败，请手动选择'); }
    };
    out.querySelector('#autoRewriteBtn').onclick = async () => {
      const newText = await Compliance.autoRewrite(ctx.text);
      const newRes = Compliance.check(newText, ctx.platform);
      Notify.success('已按医疗字典自动改写，重新检测中…');
      this._renderGenResult(out, { ...ctx, text: newText }, newRes);
    };
    out.querySelector('#recheckBtn')?.addEventListener('click', () => {
      const newRes = Compliance.check(ctx.text, ctx.platform);
      this._renderGenResult(out, ctx, newRes);
    });
    out.querySelector('#applyAllBtn')?.addEventListener('click', () => {
      // 一键采纳所有医疗替换（按 rewrite 字典）
      let newText = ctx.text;
      const rep = Compliance._dict?.rules?.rewrite?.replacements || {};
      for (const [k, v] of Object.entries(rep)) {
        newText = newText.replaceAll(k, v);
      }
      const newRes = Compliance.check(newText, ctx.platform);
      Notify.success('已一键采纳医疗替换，重新检测中…');
      this._renderGenResult(out, { ...ctx, text: newText }, newRes);
    });
    // 单个建议采纳
    out.querySelectorAll('[data-sug-apply]').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.sugApply);
        const j = parseInt(b.dataset.cand);
        const sug = res.suggestions[i];
        if (!sug) return;
        const cand = sug.candidates[j];
        const newText = ctx.text.replaceAll(sug.original, cand);
        const newRes = Compliance.check(newText, ctx.platform);
        Notify.success(`已采纳「${sug.original}」→「${cand}」`);
        this._renderGenResult(out, { ...ctx, text: newText }, newRes);
      });
    });
  },

  // 根据当前 AI 配置状态给用户一个提示
  _aiHint() {
    const api = (typeof window !== 'undefined' && window.__SHEET_API__) || '';
    if (api) return '✅ 已连接云端代理，文案由代理 AI 生成（请在代理环境变量配置 AI_API_KEY）。';
    return '💡 当前使用本地模板；连接云端代理后启用 AI 真实生成。前往「设置 → 云端同步与 AI」配置。';
  },

  /* ---------- 发布日历 ---------- */
  _cal(root) {
    const contents = Store.contents();
    // 未来 14 天日历占位
    const days=[];
    for(let i=0;i<14;i++){ const d=new Date(); d.setDate(d.getDate()+i); days.push(d); }
    root.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-serif text-lg text-ink-600">内容发布日历</h3>
        <span class="text-xs text-ink-400">已规划 ${contents.length} 条内容</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-5">
        ${days.map(d=>{
          const ds=DateUtil.fmt(d);
          const items=contents.filter(c=>c.date===ds);
          return `<div class="card p-2 min-h-[70px] ${items.length?'ring-1 ring-sage-300':''}">
            <div class="text-xs text-ink-400">${ds.slice(5)}</div>
            ${items.map(c=>`<div class="text-[11px] mt-1 truncate ${c.status==='已发布'?'text-sage-600':'text-clay-500'}" title="${c.topic}">${c.plat==='xhs'?'📕':'🎬'} ${c.status}</div>`).join('')}
          </div>`;
        }).join('')}
      </div>
      <div class="card p-5">
        <h4 class="font-serif text-base text-ink-600 mb-2">内容库</h4>
        <div class="space-y-2">
          ${contents.length?contents.slice().reverse().map(c=>`
            <div class="flex items-center justify-between border rounded-lg px-3 py-2">
              <div class="text-sm text-ink-600">${c.plat==='xhs'?'📕 小红书':'🎬 抖音'} · ${c.topic}</div>
              <div class="flex items-center gap-2">
                <select class="input input-xs" data-status="${c.id}">
                  ${['草稿','已排期','已发布'].map(s=>`<option ${c.status===s?'selected':''}>${s}</option>`).join('')}
                </select>
              </div>
            </div>`).join(''):'<div class="text-ink-400 text-sm">暂无内容，去「内容生成」创建</div>'}
        </div>
      </div>`;
    root.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{});
    root.querySelectorAll('[data-status]').forEach(b=>b.onchange=()=>{
      Store.update('contents',b.dataset.status,{status:b.value}); Notify.success('状态已更新'); this._cal(root);
    });
  }
};
window['biz-media'] = BizMedia;
