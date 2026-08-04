/* ====================================================================
   life-health.js - 健康管家模块
   子系统：生理周期 / 体重管理 / 体检管理 / 保单管理
   SPA module: window['life-health'].render(root)
   ==================================================================== */

const LifeHealth = {
  name: '健康管家',
  desc: '保险·体检·周期·体重',
  async render(root) {
    root.innerHTML = '';
    root.classList.add('module-life-health');

    const tabs = [
      { id:'cycle',  label:'生理周期' },
      { id:'weight', label:'体重管理' },
      { id:'check',  label:'体检管理' },
      { id:'policy', label:'保单管理' }
    ];
    let active = Store.get('lh_tab', 'cycle');

    const page = document.createElement('div');
    page.className = 'module-page';
    root.appendChild(page);

    const mount = () => {
      page.innerHTML = `
        <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 class="section-title">健康管家</h1>
            <p class="text-ink-400 text-sm mt-1">保险 · 体检 · 生理周期 · 体重，一站式守护</p>
          </div>
        </div>
        <div class="tab-bar mb-6" id="lhTabs">
          ${tabs.map(t=>`<button class="tab-btn ${t.id===active?'active':''}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div id="lhBody"></div>`;
      page.querySelectorAll('#lhTabs .tab-btn').forEach(b=>{
        b.onclick = ()=>{ active=b.dataset.tab; Store.set('lh_tab',active); mount(); };
      });
      const body = page.querySelector('#lhBody');
      if (active==='cycle')  this._cycle(body);
      if (active==='weight') this._weight(body);
      if (active==='check')  this._check(body);
      if (active==='policy') this._policy(body);
      if (window.lucide) lucide.createIcons();
    };
    mount();
  },

  /* ---------- 生理周期 ---------- */
  _cycle(root) {
    const cycles = Store.cycles();
    // 预测下一周期：取最近几次平均周期
    let avg = 28, next = null, remind = null;
    if (cycles.length) {
      const sorted = cycles.map(c=>({s:new Date(c.start), e:c.end?new Date(c.end):null}))
                           .sort((a,b)=>a.s-b.s);
      const gaps = [];
      for (let i=1;i<sorted.length;i++) gaps.push(Math.round((sorted[i].s-sorted[i-1].s)/864e5));
      if (gaps.length) avg = Math.round(gaps.reduce((a,b)=>a+b,0)/gaps.length);
      const last = sorted[sorted.length-1].s;
      next = new Date(last); next.setDate(next.getDate()+avg);
      remind = new Date(next); remind.setDate(remind.getDate()-3);
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const inRemind = remind && today >= remind && today < next;

    root.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="card p-5">
          <div class="flex items-center gap-2 text-clay-500 mb-1"><i data-lucide="calendar-heart" class="w-4 h-4"></i><span class="text-sm font-medium">周期概览</span></div>
          <div class="text-3xl font-serif text-ink-600 mt-2">${avg}<span class="text-base text-ink-400 ml-1">天</span></div>
          <div class="text-xs text-ink-400 mt-1">平均周期长度</div>
          <div class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between"><span class="text-ink-400">下次预测</span><span class="font-medium text-ink-600">${next?DateUtil.fmt(next):'—'}</span></div>
            <div class="flex justify-between"><span class="text-ink-400">提前提醒</span><span class="font-medium text-ink-600">${remind?DateUtil.fmt(remind):'—'}</span></div>
          </div>
          ${inRemind?`<div class="mt-4 p-3 rounded-lg bg-clay-50 text-clay-600 text-sm flex items-center gap-2"><i data-lucide="bell-ring" class="w-4 h-4"></i>距下次生理期还有 ${Math.round((next-today)/864e5)} 天，请提前准备</div>`:''}
        </div>

        <div class="card p-5 lg:col-span-2">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-serif text-lg text-ink-600">记录周期</h3>
            <button class="btn btn-primary btn-sm" id="addCycle">+ 新增记录</button>
          </div>
          <div class="overflow-x-auto">
            <table class="mini-table">
              <thead><tr><th>开始</th><th>结束</th><th>周期天数</th><th>症状</th><th></th></tr></thead>
              <tbody>
                ${cycles.length?cycles.slice().reverse().map(c=>{
                  const s=new Date(c.start); const e=c.end?new Date(c.end):null;
                  const days = e?Math.round((e-s)/864e5)+1:'进行中';
                  return `<tr><td>${DateUtil.fmt(s)}</td><td>${e?DateUtil.fmt(e):'—'}</td><td>${days}</td><td class="text-ink-400 max-w-[160px] truncate">${c.note||'—'}</td><td><button class="text-ink-400 hover:text-red-500" data-del="${c.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td></tr>`;
                }).join(''):'<tr><td colspan="5" class="text-center text-ink-400 py-4">暂无记录</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card p-5 mt-5">
        <h3 class="font-serif text-lg text-ink-600 mb-3">周期趋势</h3>
        <canvas id="cycleChart" height="90"></canvas>
      </div>`;

    root.querySelector('#addCycle').onclick = ()=>{
      const start = prompt('本次开始日期（YYYY-MM-DD）：', DateUtil.fmt(new Date()));
      if(!start) return;
      const end = prompt('本次结束日期（留空表示进行中）：', '');
      const note = prompt('症状/备注：', '')||'';
      Store.add('cycles',{id:'c'+Date.now(),start,end: end||null,note});
      Notify.success('已记录生理周期');
      this._cycle(root);
    };
    root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
      if(confirm('确认删除该记录？')){ Store.removeById('cycles',b.dataset.del); this._cycle(root); }
    });

    // 趋势图
    const cv = root.querySelector('#cycleChart');
    if (cv && window.Chart && cycles.length>1) {
      const sorted = cycles.map(c=>({s:new Date(c.start)})).sort((a,b)=>a.s-b.s);
      const gaps=[]; for(let i=1;i<sorted.length;i++) gaps.push(Math.round((sorted[i].s-sorted[i-1].s)/864e5));
      new Chart(cv,{type:'line',data:{labels:gaps.map((_,i)=>'第'+(i+1)+'次'),datasets:[{label:'周期天数',data:gaps,borderColor:'#c2724e',backgroundColor:'rgba(194,114,78,.12)',tension:.35,fill:true,pointRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:'#f0ebe4'}}},maintainAspectRatio:false}});
    } else if (cv && !cycles.length) {
      cv.style.display='none';
    }
  },

  /* ---------- 体重管理 ---------- */
  _weight(root) {
    const weights = Store.weights().slice().sort((a,b)=>new Date(a.date)-new Date(b.date));
    const target = Store.get('weight_target', null);
    const latest = weights.length?weights[weights.length-1].v:null;
    const loss = (latest!=null && target!=null)?(latest-target):null;

    root.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="card p-5">
          <div class="text-sm text-ink-400">当前体重</div>
          <div class="text-3xl font-serif text-ink-600 mt-1">${latest!=null?latest:'—'}<span class="text-base text-ink-400 ml-1">kg</span></div>
          ${target!=null?`<div class="text-xs mt-1 ${loss>0?'text-sage-600':'text-clay-500'}">距目标 ${target}kg ${loss>0?('还需减 '+loss.toFixed(1)+'kg'):(loss<0?('已超 '+(-loss).toFixed(1)+'kg'):'已达标')}}</div>`:'<div class="text-xs text-ink-400 mt-1">未设目标</div>'}
          <button class="btn btn-secondary btn-sm mt-3" id="setTarget">设置目标体重</button>
          <button class="btn btn-primary btn-sm mt-3 ml-2" id="addWeight">+ 记录今日</button>
        </div>
        <div class="card p-5 lg:col-span-2">
          <h3 class="font-serif text-lg text-ink-600 mb-3">体重趋势</h3>
          <canvas id="wChart" height="160"></canvas>
        </div>
      </div>`;

    root.querySelector('#setTarget').onclick=()=>{
      const t = prompt('目标体重（kg）：', target||''); if(t==null) return;
      Store.set('weight_target', parseFloat(t)); this._weight(root);
    };
    root.querySelector('#addWeight').onclick=()=>{
      const v = prompt('今日体重（kg）：', latest||''); if(v==null) return;
      const date = DateUtil.fmt(new Date());
      const exist = Store.weights().find(w=>w.date===date);
      if(exist){ Store.update('weights',exist.id,{v:parseFloat(v)}); }
      else Store.add('weights',{id:'w'+Date.now(),date,v:parseFloat(v)});
      Notify.success('已记录'); this._weight(root);
    };

    const cv = root.querySelector('#wChart');
    if (cv && window.Chart && weights.length) {
      const ds=[{label:'体重kg',data:weights.map(w=>w.v),borderColor:'#7a9471',backgroundColor:'rgba(122,148,113,.12)',tension:.35,fill:true,pointRadius:3}];
      if(target!=null) ds.push({label:'目标',data:weights.map(()=>target),borderColor:'#c2724e',borderDash:[5,5],pointRadius:0,fill:false});
      new Chart(cv,{type:'line',data:{labels:weights.map(w=>w.date.slice(5)),datasets:ds},options:{plugins:{legend:{display:ds.length>1}},scales:{y:{grid:{color:'#f0ebe4'}}},maintainAspectRatio:false}});
    } else if (cv && !weights.length) cv.style.display='none';
  },

  /* ---------- 体检管理 ---------- */
  _check(root) {
    const checks = Store.healthChecks();
    const today = new Date(); today.setHours(0,0,0,0);
    const filePreview = (c) => {
      if (!c.files || !c.files.length) return '';
      return `<div class="mt-2 space-y-1">${c.files.map((f, idx) => `
        <div class="flex items-center gap-2 text-xs">
          ${f.type && f.type.indexOf('image/') === 0 ? `<img src="${f.dataUrl}" class="w-10 h-10 rounded object-cover border border-sand-300" alt="">` : `<i data-lucide="file-text" class="w-4 h-4 text-ink-400"></i>`}
          <a href="${f.dataUrl}" target="_blank" class="text-sage-600 hover:underline truncate flex-1" title="${f.name}">${f.name}</a>
          <button class="text-ink-400 hover:text-red-500" data-delfile="${c.id}:${idx}" title="删除附件"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
        </div>`).join('')}</div>`;
    };
    root.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-serif text-lg text-ink-600">体检计划与档案</h3>
        <button class="btn btn-primary btn-sm" id="addCheck">+ 新增体检</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${checks.length?checks.map(c=>{
          const due = c.next?new Date(c.next):null;
          const days = due?Math.round((due-today)/864e5):null;
          const alarm = days!=null && days<=14;
          return `<div class="card p-4">
            <div class="flex items-center justify-between">
              <span class="font-medium text-ink-600">${c.name||'体检'}</span>
              ${alarm?`<span class="badge badge-warn">${days<=0?'已到期':'剩'+days+'天'}</span>`:''}
            </div>
            <div class="text-xs text-ink-400 mt-2 space-y-1">
              <div>计划日期：${c.date?DateUtil.fmt(new Date(c.date)):'—'}</div>
              <div>下次提醒：${c.next?DateUtil.fmt(new Date(c.next)):'—'}</div>
              <div>机构：${c.org||'—'}</div>
            </div>
            ${c.metrics?`<div class="mt-2 text-xs text-ink-400">关键指标：${c.metrics}</div>`:''}
            ${filePreview(c)}
            <div class="flex gap-2 mt-3 flex-wrap">
              <button class="btn btn-secondary btn-xs" data-up="${c.id}"><i data-lucide="upload" class="w-3 h-3"></i>上传报告</button>
              <input type="file" accept="image/*,application/pdf" class="hidden" data-file="${c.id}">
              <button class="btn btn-secondary btn-xs" data-edit="${c.id}">编辑</button>
              <button class="btn btn-secondary btn-xs" data-del="${c.id}">删除</button>
            </div>
          </div>`;
        }).join(''):'<div class="card p-4 col-span-full text-ink-400 text-center">暂无体检计划，点击右上角新增</div>'}
      </div>`;

    root.querySelector('#addCheck').onclick=()=>{
      const name=prompt('体检项目/名称：','年度体检'); if(name==null)return;
      const date=prompt('体检日期（YYYY-MM-DD）：',DateUtil.fmt(new Date()));
      const next=prompt('下次提醒日期（YYYY-MM-DD）：','');
      const org=prompt('体检机构：','');
      const metrics=prompt('关键指标摘要（选填）：','');
      Store.add('health_checks',{id:'h'+Date.now(),name,date:date||null,next:next||null,org:org||'',metrics:metrics||'',files:[]});
      Notify.success('已添加体检计划'); this._check(root);
    };
    root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{
      const c=Store.findById('health_checks',b.dataset.edit);
      const name=prompt('名称：',c.name); if(name==null)return;
      const date=prompt('日期：',c.date||''); const next=prompt('下次提醒：',c.next||'');
      Store.update('health_checks',c.id,{name,date:date||null,next:next||null}); this._check(root);
    });
    root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ if(confirm('删除该体检计划及其附件？')){Store.removeById('health_checks',b.dataset.del);this._check(root);} });
    root.querySelectorAll('[data-up]').forEach(btn=>{
      const id=btn.dataset.up;
      const inp=root.querySelector(`[data-file="${id}"]`);
      btn.onclick=()=>inp.click();
      inp.onchange=()=>{
        const file=inp.files[0]; if(!file) return;
        if(file.size>3*1024*1024){ Notify.toast('文件超过 3MB，建议压缩后再上传','warn',2500); inp.value=''; return; }
        const reader=new FileReader();
        reader.onload=()=>{
          const c=Store.findById('health_checks',id);
          const files=(c.files||[]).concat({name:file.name,type:file.type,size:file.size,dataUrl:reader.result});
          Store.update('health_checks',id,{files});
          Notify.success('报告已归档'); this._check(root);
        };
        reader.readAsDataURL(file);
        inp.value='';
      };
    });
    root.querySelectorAll('[data-delfile]').forEach(b=>b.onclick=()=>{
      const parts=b.dataset.delfile.split(':'); const id=parts[0]; const idx=Number(parts[1]);
      const c=Store.findById('health_checks',id);
      const files=(c.files||[]).slice(); files.splice(idx,1);
      Store.update('health_checks',id,{files}); this._check(root);
    });
    if(window.lucide) lucide.createIcons();
  },

  /* ---------- 保单管理 ---------- */
  _policy(root) {
    const ins = Store.insurances();
    const today = new Date(); today.setHours(0,0,0,0);
    root.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-serif text-lg text-ink-600">保单中心（${ins.length} 份）</h3>
        <button class="btn btn-primary btn-sm" id="addPolicy">+ 录入保单</button>
      </div>
      <div class="overflow-x-auto">
        <table class="mini-table">
          <thead><tr><th>险种</th><th>保额</th><th>年缴/月缴</th><th>缴费日</th><th>保障到期</th><th>状态</th><th></th></tr></thead>
          <tbody>
            ${ins.length?ins.map(p=>{
              const due=p.payDate?new Date(p.payDate):null;
              const exp=p.expire?new Date(p.expire):null;
              const daysDue=due?Math.round((due-today)/864e5):null;
              const alarm = daysDue!=null && daysDue<=14;
              const expired = exp && exp<today;
              return `<tr>
                <td class="font-medium text-ink-600">${p.type}</td>
                <td>${p.amount?('¥'+p.amount):'—'}</td>
                <td>${p.premium?('¥'+p.premium+(p.cycle==='月'?'/月':'/年')):'—'}</td>
                <td>${due?DateUtil.fmt(due):'—'}</td>
                <td>${exp?DateUtil.fmt(exp):'—'}</td>
                <td>${expired?'<span class="badge badge-danger">已脱保</span>':(alarm?'<span class="badge badge-warn">待缴费</span>':'<span class="badge badge-ok">正常</span>')}</td>
                <td><button class="text-ink-400 hover:text-red-500" data-del="${p.id}"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td>
              </tr>`;
            }).join(''):'<tr><td colspan="7" class="text-center text-ink-400 py-4">暂无保单，点击右上角录入</td></tr>'}
          </tbody>
        </table>
      </div>`;

    root.querySelector('#addPolicy').onclick=()=>{
      const type=prompt('险种名称（如 重疾险）：',''); if(type==null)return;
      const amount=prompt('保额（元）：',''); 
      const premium=prompt('保费（元）：',''); 
      const cycle=prompt('缴费周期（年/月）：','年'); 
      const payDate=prompt('下次缴费日（YYYY-MM-DD）：',''); 
      const expire=prompt('保障到期日（YYYY-MM-DD）：','');
      Store.add('insurances',{id:'i'+Date.now(),type,amount:amount||null,premium:premium||null,cycle:cycle||'年',payDate:payDate||null,expire:expire||null});
      Notify.success('保单已录入'); this._policy(root);
    };
    root.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{ if(confirm('删除？')){Store.removeById('insurances',b.dataset.del);this._policy(root);} });
  }
};
window['life-health'] = LifeHealth;
