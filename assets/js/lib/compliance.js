/* ====================================================================
   compliance.js - 医疗 + 平台双层合规风控（v1 升级）
   - 第一层：医疗敏感词（block 阻断 + warn 提示 + rewrite 替换建议）
   - 第二层：平台违禁词（小红书 / 抖音 各自的硬规则）
   - 输出：命中词列表 + 等级 + 替换建议（按词给 3 个）+ 可读报告
   - 设计：被命中不丢弃，红色高亮 + 一键采纳替换
   ==================================================================== */

const Compliance = {
  _dict: null,        // 医疗词库
  _platform: null,    // 平台词库

  async load() {
    if (this._dict) return this._dict;
    // 优先使用「字段配置」中保存的覆盖（实时生效）
    const override = Store.get('cfg_medical_blacklist', null);
    if (override) { this._dict = override; return this._dict; }
    try {
      const r = await fetch('data/medical_blacklist.json');
      this._dict = await r.json();
    } catch (e) {
      console.warn('compliance dict load failed', e);
      this._dict = { rules: { block: { words: [] }, warn: { words: [] }, rewrite: { replacements: {} } } };
    }
    return this._dict;
  },

  async loadPlatform() {
    if (this._platform) return this._platform;
    const override = Store.get('cfg_platform_blacklist', null);
    if (override) { this._platform = override; return this._platform; }
    try {
      const r = await fetch('data/platform_blacklist.json');
      this._platform = await r.json();
    } catch (e) {
      console.warn('platform dict load failed', e);
      this._platform = { platforms: { xhs: { block: { words: [] }, warn: { words: [] } }, dy: { block: { words: [] }, warn: { words: [] } } } };
    }
    return this._platform;
  },

  /**
   * 同步合规检查（业务入口）
   * @param {string} text 待检测文案
   * @param {string} platform 平台 xhs | dy | ''（仅医疗层）
   * @returns {{hits, level, report, suggestions}}
   *   hits: [{word, level, layer: 'medical'|'platform', source, action}]
   *   level: 'safe' | 'medium' | 'high'
   *   report: 多行可读报告
   *   suggestions: [{original, candidates: [..]}] 给一键采纳用
   */
  check(text, platform = '') {
    const dict = this._dict;
    if (!dict) {
      this.load();
      return { hits: [], level: 'safe', report: '⏳ 合规词库加载中，稍后重试…', suggestions: [] };
    }
    const hits = [];
    // === 第一层：医疗敏感词 ===
    for (const w of (dict.rules.block.words || [])) {
      if (text.includes(w)) hits.push({ word: w, level: 'high', layer: 'medical', source: '医疗-阻断', action: '必须改写' });
    }
    for (const w of (dict.rules.warn.words || [])) {
      if (text.includes(w)) hits.push({ word: w, level: 'medium', layer: 'medical', source: '医疗-提示', action: '人工确认' });
    }
    // === 第二层：平台违禁词 ===
    if (platform) {
      const pdict = this._platform;
      if (pdict && pdict.platforms && pdict.platforms[platform]) {
        const p = pdict.platforms[platform];
        for (const w of (p.block.words || [])) {
          if (text.includes(w)) hits.push({ word: w, level: 'high', layer: 'platform', source: `${p.name}-阻断`, action: '必须改写' });
        }
        for (const w of (p.warn.words || [])) {
          if (text.includes(w)) hits.push({ word: w, level: 'medium', layer: 'platform', source: `${p.name}-提示`, action: '人工确认' });
        }
      }
    }
    const level = hits.some(h => h.level === 'high') ? 'high'
                : hits.some(h => h.level === 'medium') ? 'medium' : 'safe';
    const suggestions = this._buildSuggestions(text, hits, dict);
    return { hits, level, report: this._makeReport(text, hits, dict, platform), suggestions };
  },

  async scan(text, platform = '') {
    const dict = await this.load();
    await this.loadPlatform();
    return this.check(text, platform);
  },

  /**
   * 自动改写（按医疗字典 replacements）
   */
  async autoRewrite(text) {
    const dict = await this.load();
    let out = text;
    const rep = dict.rules.rewrite?.replacements || {};
    for (const [k, v] of Object.entries(rep)) {
      out = out.replaceAll(k, v);
    }
    return out;
  },

  /**
   * 构建每个命中词的替换建议（3 个候选）
   * - 优先用医疗 rewrite 字典
   * - 否则给出通用"旅居陪伴"话术
   */
  _buildSuggestions(text, hits, dict) {
    const rep = dict.rules.rewrite?.replacements || {};
    const genericByLayer = {
      'medical-block':   ['温暖陪伴', '贴心照顾', '舒心入住'],
      'medical-warn':    ['便利舒适', '安心短居', '暖心关怀'],
      'platform-block':  ['自然叙述', '真诚分享', '温暖表达'],
      'platform-warn':   ['平和描述', '自然分享', '客观记录']
    };
    // 收集所有不同命中词
    const seen = new Set();
    const suggestions = [];
    for (const h of hits) {
      if (seen.has(h.word)) continue;
      seen.add(h.word);
      const candidates = [];
      if (rep[h.word]) candidates.push(rep[h.word]);
      // 找包含命中词的更长键（更精准替换）
      const longer = Object.keys(rep).filter(k => k.length > h.word.length && text.includes(k));
      longer.forEach(k => candidates.push(rep[k]));
      // 通用兜底
      const key = `${h.layer}-${h.level === 'high' ? 'block' : 'warn'}`;
      genericByLayer[key]?.forEach(g => { if (!candidates.includes(g)) candidates.push(g); });
      suggestions.push({ original: h.word, level: h.level, layer: h.layer, candidates: candidates.slice(0, 3) });
    }
    return suggestions;
  },

  _makeReport(text, hits, dict, platform) {
    if (hits.length === 0) {
      return `✅ 合规检测通过：未命中任何医疗敏感词${platform ? '与 ' + (platform === 'xhs' ? '小红书' : '抖音') + ' 平台违禁词' : ''}。`;
    }
    const lines = [];
    const high = hits.filter(h => h.level === 'high');
    const mid  = hits.filter(h => h.level === 'medium');
    const medHigh = high.filter(h => h.layer === 'medical');
    const medMid  = mid.filter(h => h.layer === 'medical');
    const platHigh = high.filter(h => h.layer === 'platform');
    const platMid  = mid.filter(h => h.layer === 'platform');

    if (medHigh.length) {
      lines.push(`⛔ 【医疗·高风险阻断】共 ${medHigh.length} 处：${medHigh.map(h => h.word).join('、')}`);
      lines.push('   建议替换为：温暖陪伴、贴心照顾、舒心入住、便利舒适 等合规表述');
    }
    if (medMid.length) {
      lines.push(`⚠️ 【医疗·中风险提示】共 ${medMid.length} 处：${medMid.map(h => h.word).join('、')}`);
      lines.push('   需结合上下文人工确认是否符合平台规范');
    }
    if (platHigh.length) {
      lines.push(`⛔ 【${(this._platform?.platforms?.[platform]?.name || '平台')}·高风险阻断】共 ${platHigh.length} 处：${platHigh.map(h => h.word).join('、')}`);
      lines.push('   平台规则禁止，发布前必须改写');
    }
    if (platMid.length) {
      lines.push(`⚠️ 【${(this._platform?.platforms?.[platform]?.name || '平台')}·中风险提示】共 ${platMid.length} 处：${platMid.map(h => h.word).join('、')}`);
      lines.push('   需结合上下文判断，谨慎使用');
    }
    lines.push(`\n   已启用「旅居陪伴 / 就医便利 / 舒适住宿 / 本地生活配套」合规话术框架`);
    return lines.join('\n');
  },

  /**
   * 生成合规检测说明（用于附在内容后）
   */
  async makeDisclaimer() {
    return '\n\n---\n📋 合规检测说明：本文已通过「愈心小筑」工作台医疗内容合规系统校验，规避医疗宣称、疗效承诺等敏感表述，统一转化为「旅居陪伴 / 就医便利 / 舒适住宿 / 本地生活配套」框架。';
  },

  /**
   * 把命中词用 <mark> 高亮，返回 HTML 字符串
   */
  highlight(text, hits) {
    if (!hits || hits.length === 0) return this._escape(text);
    // 按 word 长度降序，避免短词覆盖长词
    const words = [...new Set(hits.map(h => h.word))].sort((a, b) => b.length - a.length);
    let out = this._escape(text);
    for (const w of words) {
      const re = new RegExp(this._escapeReg(w), 'g');
      out = out.replace(re, `<mark class="bg-clay-100 text-clay-600 px-0.5 rounded">${this._escape(w)}</mark>`);
    }
    return out;
  },

  _escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  },
  _escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
};
