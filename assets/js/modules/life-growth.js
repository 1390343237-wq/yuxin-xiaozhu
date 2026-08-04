/* ====================================================================
   life-growth.js - 个人成长中心
   子系统：技能成长地图 / 读书管理 / 学习打卡
   SPA module: window['life-growth'].render(root)
   ==================================================================== */

const LifeGrowth = {
  name: '个人成长',
  desc: '技能·读书·打卡',
  async render(root) {
    root.innerHTML = '';
    root.classList.add('module-life-growth');

    const tabs = [
      { id:'skill', label:'技能成长地图' },
      { id:'book',  label:'读书管理' },
      { id:'check', label:'学习打卡' }
    ];
    let active = Store.get('lg_tab', 'skill');

    const page = document.createElement('div');
    page.className='module-page';
    root.appendChild(page);

    const mount = ()=>{
      page.innerHTML = `
        <div class="mb-6">
          <h1 class="section-title">个人成长中心</h1>
          <p class="text-ink-400 text-sm mt-1">技能进阶 · 高效阅读 · 持续打卡</p>
        </div>
        <div class="tab-bar mb-6" id="lgTabs">
          ${tabs.map(t=>`<button class="tab-btn ${t.id===active?'active':''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div id="lgBody"></div>`;
      page.querySelectorAll('#lgTabs .tab-btn').forEach(b=>{
        b.onclick=()=>{ active=b.dataset.tab; Store.set('lg_tab',active); mount(); };
      });
      const body=page.querySelector('#lgBody');
      if(active==='skill') this._skill(body);
      if(active==='book')  this._book(body);
      if(active==='check') this._check(body);
      if(window.lucide) lucide.createIcons();
    };
    mount();
  },

  /* ---------- 技能成长地图 ---------- */
  _skill(root) {
    const skills = Store.skills();
    const cats = [{k:'hobby',label:'爱好类技能',icon:'palette'},{k:'work',label:'工作类技能',icon:'briefcase'}];
    root.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-serif text-lg text-ink-600">技能成长地图</h3>
        <button class="btn btn-primary btn-sm" id="addSkill">+ 新增技能</button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        ${cats.map(cat=>{
          const list = skills.filter(s=>s.cat===cat.k);
          return `<div class="card p-5">
            <div class="flex items-center gap-2 mb-3 text-clay-500"><i data-lucide="${cat.icon}" class="w-4 h-4"></i><span class="font-medium">${cat.label}</span><span class="text-xs text-ink-400">(${list.length})</span></div>
            <div class="space-y-3">
              ${list.length?list.map(s=>{
                const pct = Math.min(100, Math.round((s.done||0)/(s.goal||1)*100));
                return `<div class="border-l-2 border-sage-300 pl-3">
                  <div class="flex justify-between items-center">
                    <span class="font-medium text-ink-600 text-sm">${s.name}</span>
                    <span class="text-xs text-ink-400">${pct}%</span>
                  </div>
                  <div class="text-xs text-ink-400 mt-0.5">目标：${s.goal||0} 次 · 已完成 ${s.done||0} 次</div>
                  <div class="progress-bar mt-1"><div class="progress-fill" style="width:${pct}%"></div></div>
                  <div class="flex gap-2 mt-2">
                    <button class="btn btn-secondary btn-xs" data-done="${s.id}">打卡 +1</button>
                    <button class="btn btn-secondary btn-xs" data-del="${s.id}">删除</button>
                  </div>
                </div>`;
              }).join(''):'<div class="text-xs text-ink-400">暂无，点击右上角添加</div>'}
            </div>
          </div>`;
        }).join('')}
      </div>`;

    root.querySelector('#addSkill').onclick=()=>{
      const name=prompt('技能名称：',''); if(name==null)return;
      const cat=prompt('分类（hobby=爱好 / work=工作）：','hobby');
      const goal=prompt('打卡目标次数：','30');
      Store.add('skills',{id:'s'+Date.now(),name,cat:cat==='work'?'work':'hobby',goal:parseInt(goal)||30,done:0});
      Notify.success('已添加技能'); this._skill(root);
    };
    root.querySelectorAll('[data-done]').forEach(b=>b.onclick=()=>{
      const s=Store.findById('skills',b.dataset.done);
      Store.update('skills',s.id,{done:(s.done||0)+1}); this._skill(root);
    });
    root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ if(confirm('删除？')){Store.removeById('skills',b.dataset.del);this._skill(root);} });
  },

  /* ---------- 读书管理 ---------- */
  _book(root) {
    const books = Store.books();
    const cats = [{k:'hobby',label:'爱好类书籍'},{k:'tool',label:'工具类书籍'}];
    root.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-serif text-lg text-ink-600">读书管理</h3>
        <button class="btn btn-primary btn-sm" id="addBook">+ 录入书单</button>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        ${cats.map(cat=>{
          const list = books.filter(b=>b.cat===cat.k);
          return `<div class="card p-5">
            <div class="font-medium text-clay-500 mb-3">${cat.label} (${list.length})</div>
            <div class="space-y-3">
              ${list.length?list.map(b=>{
                const pct=Math.min(100,Math.round((b.progress||0)));
                return `<div class="border rounded-lg p-3 bg-paper">
                  <div class="flex justify-between items-start">
                    <div>
                      <div class="font-medium text-ink-600 text-sm">${b.title}</div>
                      <div class="text-xs text-ink-400">${b.author||''} · ${b.progress||0}%</div>
                    </div>
                    <button class="text-ink-400 hover:text-red-500" data-del="${b.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                  </div>
                  <div class="progress-bar mt-2"><div class="progress-fill" style="width:${pct}%"></div></div>
                  ${(cat.k==='tool') ? (()=>{ const t=b.summaryText||b.summary; if(!t) return ''; const src=b.summarySrc||'local'; const isReal = src==='ai'||src==='google-books'; const label = src==='google-books'?'Google Books':(src==='ai'?'AI生成':'本地启发'); return `<div class="mt-2 text-xs text-ink-500 bg-sage-50 rounded p-2"><div class="flex items-center gap-2 mb-0.5"><b>核心摘要</b><span class="text-[10px] px-1.5 py-0.5 rounded ${isReal?'bg-sage-100 text-sage-600':'bg-ink-100 text-ink-400'}">${label}</span></div>${t}</div>`; })() : ''}
                  ${(cat.k==='hobby') ? (()=>{ const t=b.recText||b.rec; if(!t) return ''; const src=b.recSrc||'local'; const isReal = src==='ai'||src==='google-books'; const label = src==='google-books'?'Google Books':(src==='ai'?'AI生成':'本地启发'); return `<div class="mt-2 text-xs text-clay-600 bg-clay-50 rounded p-2"><div class="flex items-center gap-2 mb-0.5"><b>智能推荐</b><span class="text-[10px] px-1.5 py-0.5 rounded ${isReal?'bg-sage-100 text-sage-600':'bg-ink-100 text-ink-400'}">${label}</span></div>${t}</div>`; })() : ''}
                  <div class="flex gap-2 mt-2">
                    <button class="btn btn-secondary btn-xs" data-prog="${b.id}">更新进度</button>
                    ${cat.k==='tool'?`<button class="btn btn-secondary btn-xs" data-sum="${b.id}">生成摘要</button>`:`<button class="btn btn-secondary btn-xs" data-rec="${b.id}">智能推荐</button>`}
                  </div>
                </div>`;
              }).join(''):'<div class="text-xs text-ink-400">暂无</div>'}
            </div>
          </div>`;
        }).join('')}
      </div>`;

    root.querySelector('#addBook').onclick=()=>{
      const title=prompt('书名：',''); if(title==null)return;
      const author=prompt('作者：','');
      const cat=prompt('分类（hobby=爱好 / tool=工具）：','tool');
      Store.add('books',{id:'b'+Date.now(),title,author:author||'',cat:cat==='hobby'?'hobby':'tool',progress:0});
      Notify.success('已加入书单'); this._book(root);
    };
    root.querySelectorAll('[data-prog]').forEach(b=>b.onclick=()=>{
      const bk=Store.findById('books',b.dataset.prog); const p=prompt('当前进度（0-100）：',bk.progress||0);
      if(p==null)return; Store.update('books',bk.id,{progress:parseInt(p)||0}); this._book(root);
    });
    root.querySelectorAll('[data-sum]').forEach(b=>b.onclick=async()=>{
      const bk=Store.findById('books',b.dataset.sum);
      const r = await this._genSummary(bk);
      Store.update('books',bk.id,{summaryText:r.text, summarySrc:r.src});
      Notify.success(r.src==='ai' ? 'AI 摘要已生成' : '已生成核心摘要（本地启发）'); this._book(root);
    });
    root.querySelectorAll('[data-rec]').forEach(b=>b.onclick=async()=>{
      const bk=Store.findById('books',b.dataset.rec);
      const r = await this._genRec(bk);
      Store.update('books',bk.id,{recText:r.text, recSrc:r.src});
      Notify.success(r.src==='ai' ? 'AI 推荐已生成' : '已生成推荐（本地启发）'); this._book(root);
    });
    root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ if(confirm('删除？')){Store.removeById('books',b.dataset.del);this._book(root);} });
  },

  // 真实 AI 接入点：若前端挂载了 window.YxzAI（对接生成模型后端），优先调用；
  // 否则回退到"基于书目标签的本地结构化摘要"，并在卡片上显式标注来源。
  async _genSummary(bk) {
    if (window.YxzAI && typeof window.YxzAI.summarize === 'function') {
      try {
        const ai = await window.YxzAI.summarize(bk);
        if (ai && typeof ai === 'object' && ai.text) return { text: ai.text, src: ai.src || 'ai' };
        if (ai && typeof ai === 'string' && ai.trim()) return { text: ai, src: 'ai' };
      }
      catch (e) { console.warn('AI 摘要失败，回退本地', e); }
    }
    return { text: this._localSummary(bk), src: 'local' };
  },
  _localSummary(bk) {
    const t = bk.title || '本书';
    const a = bk.author ? ('（' + bk.author + '）') : '';
    const prog = bk.progress || 0;
    return `${t}${a}｜框架：① 背景与核心命题；② 关键概念与方法论；③ 案例与实践；④ 行动清单。当前进度 ${prog}%，建议先精读第②③章并输出笔记。`;
  },
  async _genRec(bk) {
    if (window.YxzAI && typeof window.YxzAI.recommend === 'function') {
      try {
        const ai = await window.YxzAI.recommend(bk);
        if (ai && typeof ai === 'object' && ai.text) return { text: ai.text, src: ai.src || 'ai' };
        if (ai && typeof ai === 'string' && ai.trim()) return { text: ai, src: 'ai' };
      }
      catch (e) { console.warn('AI 推荐失败，回退本地', e); }
    }
    return { text: this._localRec(bk), src: 'local' };
  },
  _localRec(bk) {
    const pool = ['《被讨厌的勇气》','《认知觉醒》','《人类简史》','《活着》','《小王子》','《解忧杂货店》','《蛤蟆先生去看心理医生》','《你当像鸟飞往你的山》'];
    const pick = pool.filter(p => p !== bk.title).slice(0, 3);
    return '同类型优质书单：' + pick.join('、') + '（接入真实推荐模型后可按你的偏好精准推荐）';
  },

  /* ---------- 学习打卡 ---------- */
  _check(root) {
    const checkins = Store.checkins();
    const today = DateUtil.fmt(new Date());
    const todayDone = checkins.filter(c=>c.date===today && c.done);
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate()-weekStart.getDay());
    const weekCount = checkins.filter(c=>{ const d=new Date(c.date); return d>=weekStart && c.done; }).length;
    const tasks = checkins.filter(c=>!c.done);

    root.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="card p-5">
          <div class="text-sm text-ink-400">本周完成打卡</div>
          <div class="text-3xl font-serif text-ink-600 mt-1">${weekCount}<span class="text-base text-ink-400 ml-1">次</span></div>
          <div class="text-xs text-ink-400 mt-1">今日已完成 ${todayDone.length} 项</div>
          <button class="btn btn-primary btn-sm mt-3" id="addTask">+ 新增学习任务</button>
        </div>
        <div class="card p-5 lg:col-span-2">
          <h3 class="font-serif text-lg text-ink-600 mb-3">待完成 / 全部任务</h3>
          <div class="space-y-2">
            ${checkins.length?checkins.slice().reverse().map(c=>`
              <div class="flex items-center justify-between border rounded-lg px-3 py-2 ${c.done?'bg-sage-50':''}">
                <div class="flex items-center gap-2">
                  <input type="checkbox" ${c.done?'checked':''} data-toggle="${c.id}" class="accent-sage-500 w-4 h-4">
                  <span class="${c.done?'line-through text-ink-400':'text-ink-600'} text-sm">${c.title}</span>
                </div>
                <span class="text-xs text-ink-400">${c.date}${c.freq?(' · '+c.freq):''}</span>
              </div>`).join(''):'<div class="text-ink-400 text-sm">暂无任务</div>'}
          </div>
        </div>
      </div>
      <div class="card p-5 mt-5">
        <h3 class="font-serif text-lg text-ink-600 mb-2">成长月报</h3>
        <p class="text-sm text-ink-500">本月累计打卡 <b class="text-clay-500">${checkins.filter(c=>c.done && c.date.startsWith(DateUtil.fmt(new Date()).slice(0,7))).length}</b> 次，涵盖技能、读书、学习任务。保持节奏，复利成长。</p>
      </div>`;

    root.querySelector('#addTask').onclick=()=>{
      const title=prompt('学习任务：',''); if(title==null)return;
      const freq=prompt('频率（每日/每周/单次）：','每日');
      Store.add('checkins',{id:'k'+Date.now(),title,date:today,freq:freq||'每日',done:false});
      Notify.success('已添加'); this._check(root);
    };
    root.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>{
      const c=Store.findById('checkins',b.dataset.toggle);
      Store.update('checkins',c.id,{done:b.checked}); this._check(root);
    });
  }
};
window['life-growth'] = LifeGrowth;
