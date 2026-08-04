/* ====================================================================
   ai.js - 愈心小筑 · 真实 AI 后端接入层
   - 摘要/推荐优先调用配置的后端（window.__AI_API__）
   - 无后端时，使用 Google Books API 作为公开真实数据源生成摘要与推荐
   - 所有结果标注来源：ai / google-books / local
   ==================================================================== */

const YxzAI = {
  // 用户可在「设置」中配置自己的后端（支持 OpenAI/Claude/Gemini 等代理）
  config() {
    return {
      endpoint: window.__AI_API__ || Store.get('yxz_ai_endpoint', ''),
      key: Store.get('yxz_ai_key', ''),
      model: Store.get('yxz_ai_model', 'gpt-4o-mini')
    };
  },

  // 统一 AI 通道：所有 AI 请求都走代理（若配置了 SHEET_API）
  // 代理对外提供 /ai/summarize /ai/recommend /ai/generate 等 OpenAI 兼容端点
  async _viaProxy(endpoint, payload) {
    const base = (typeof window !== 'undefined' && window.__SHEET_API__) || '';
    if (!base) return null; // 提示调用方走 fallback
    try {
      const res = await fetch(base + '/ai/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json();
      if (j && (j.text || j.content)) {
        return { text: j.text || j.content, src: j.src || 'ai', model: j.model };
      }
    } catch (e) { console.warn('代理 AI /' + endpoint + ' 失败', e); }
    return null;
  },

  async summarize(book) {
    // 1) 走代理（部署到 Railway 后默认走这里）
    const viaProxy = await this._viaProxy('summarize', {
      title: book.title, author: book.author, progress: book.progress, tags: book.tags
    });
    if (viaProxy) return viaProxy;
    // 2) 走用户自定义后端（兼容旧配置）
    const cfg = this.config();
    if (cfg.endpoint) {
      try {
        const res = await fetch(cfg.endpoint + '/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cfg.key ? { 'Authorization': 'Bearer ' + cfg.key } : {}) },
          body: JSON.stringify({ title: book.title, author: book.author, progress: book.progress, tags: book.tags })
        });
        const j = await res.json();
        if (j.text || j.summary || j.content) return { text: j.text || j.summary || j.content, src: 'ai' };
      } catch (e) { console.warn('自定义 AI 后端摘要失败，回退 Google Books', e); }
    }
    return this._googleSummary(book);
  },

  async recommend(book) {
    const viaProxy = await this._viaProxy('recommend', {
      title: book.title, author: book.author, tags: book.tags
    });
    if (viaProxy) return viaProxy;
    const cfg = this.config();
    if (cfg.endpoint) {
      try {
        const res = await fetch(cfg.endpoint + '/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cfg.key ? { 'Authorization': 'Bearer ' + cfg.key } : {}) },
          body: JSON.stringify({ title: book.title, author: book.author, tags: book.tags })
        });
        const j = await res.json();
        if (j.text || j.rec || j.recommendations || j.content) return { text: j.text || j.rec || j.content, src: 'ai' };
      } catch (e) { console.warn('自定义 AI 后端推荐失败，回退 Google Books', e); }
    }
    return this._googleRecommend(book);
  },

  // 自媒体文案生成（小红书 / 抖音）
  async generate(topic, plat) {
    const viaProxy = await this._viaProxy('generate', { topic, plat });
    if (viaProxy) return viaProxy;
    // fallback：模板
    return { text: this._localContent(topic, plat), src: 'local' };
  },

  // 内容生成的本地模板（兜底）
  _localContent(topic, plat) {
    if (plat === 'dy') {
      return `【${topic} · 抖音口播】
（镜头1，天坛医院外景，3s）来北京看病，住哪儿最省心？
（镜头2，步行 5 分钟，2s）医院旁这处民宿，步行就能到。
（镜头3，房间全景，4s）自煮厨房、安静楼层，养病休息两不误。
（镜头4，周边街景，3s）药店、超市、地铁，啥都方便。
（镜头5，博主出镜，3s）异地就医，住得安心最重要。需要的朋友可以问我。
#北京就医住宿 #天坛医院陪诊`;
    }
    return `📍【${topic}】｜天坛医院旁的安心小筑
来北京陪诊/就医，住得安心比啥都重要。愈心小筑就在天坛医院附近，步行可达，安静整洁的一人居。
✨ 为什么选我们：
· 交通枢纽旁，地铁直达
· 全套厨具可自煮清淡饮食
· 周边药店超市一应俱全
· 安静楼层，保证休息质量
🏠 适合：异地就医、陪诊家属、复查旅居
#北京就医住宿 #天坛医院 #陪诊旅居 #安心小筑 #异地就医`;
  },

  // 使用 Google Books API（公开、免费、浏览器可直接调用）获取真实书籍数据
  async _googleSummary(book) {
    try {
      const q = encodeURIComponent([book.title, book.author].filter(Boolean).join(' '));
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3&langRestrict=zh`);
      const data = await res.json();
      const vol = (data.items && data.items[0] && data.items[0].volumeInfo);
      if (!vol) throw new Error('no google books result');
      const desc = (vol.description || vol.subtitle || '暂无详细简介');
      const cats = (vol.categories || []).slice(0, 2).join(' / ') || '综合';
      const pages = vol.pageCount ? `全书约 ${vol.pageCount} 页，` : '';
      const text = `《${book.title}》${book.author ? '（' + book.author + '）' : ''}｜${pages}分类：${cats}。\n核心内容：${desc.slice(0, 220)}${desc.length > 220 ? '…' : ''}\n阅读建议：当前进度 ${book.progress || 0}%，建议结合目录精读与你目标最相关的章节，并输出 3 条行动清单。`;
      return { text, src: 'google-books' };
    } catch (e) {
      console.warn('Google Books 摘要失败，回退本地', e);
      return { text: this._localSummary(book), src: 'local' };
    }
  },

  async _googleRecommend(book) {
    try {
      const subject = book.tags || book.title;
      const q = encodeURIComponent('subject:' + subject);
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=6&langRestrict=zh`);
      const data = await res.json();
      const items = (data.items || []).map(it => it.volumeInfo).filter(v => v && v.title !== book.title).slice(0, 4);
      if (items.length < 2) throw new Error('not enough results');
      const list = items.map(v => `《${v.title}》${v.authors ? v.authors.join('、') : ''}`).join('、');
      const text = `基于「${book.title}」的相似主题，Google Books 为你找到：${list}。可优先阅读评分高、页数适中的那一本做主题延伸阅读。`;
      return { text, src: 'google-books' };
    } catch (e) {
      console.warn('Google Books 推荐失败，回退本地', e);
      return { text: this._localRec(book), src: 'local' };
    }
  },

  _localSummary(bk) {
    const t = bk.title || '本书';
    const a = bk.author ? ('（' + bk.author + '）') : '';
    const prog = bk.progress || 0;
    return `${t}${a}｜框架：① 背景与核心命题；② 关键概念与方法论；③ 案例与实践；④ 行动清单。当前进度 ${prog}%，建议先精读第②③章并输出笔记。`;
  },

  _localRec(bk) {
    const pool = ['《被讨厌的勇气》', '《认知觉醒》', '《人类简史》', '《活着》', '《小王子》', '《解忧杂货店》', '《蛤蟆先生去看心理医生》', '《你当像鸟飞往你的山》'];
    const pick = pool.filter(p => p !== bk.title).slice(0, 3);
    return '同类型优质书单：' + pick.join('、') + '（接入真实推荐模型后可按你的偏好精准推荐）';
  }
};

window.YxzAI = YxzAI;
