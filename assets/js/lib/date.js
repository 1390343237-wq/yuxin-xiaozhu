/* ====================================================================
   date.js - 日期/周期预测工具
   ==================================================================== */

const DateUtil = {
  // 格式化 yyyy-MM-dd
  fmt(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  // 中文格式
  fmtCN(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return '';
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    const week = ['日','一','二','三','四','五','六'][dt.getDay()];
    return `${m}-${day} 周${week}`;
  },
  // 解析 yyyy-MM-dd 或 yyyy/MM/dd
  parse(s) {
    if (!s) return null;
    if (s instanceof Date) return s;
    const m = String(s).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!m) return null;
    return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  },
  // 加天数
  addDays(d, n) {
    const dt = (d instanceof Date) ? new Date(d) : new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
  },
  // 区间内所有日期
  range(from, to) {
    const a = this.parse(from), b = this.parse(to);
    if (!a || !b) return [];
    const out = [];
    let cur = new Date(a);
    while (cur <= b) {
      out.push(this.fmt(cur));
      cur = this.addDays(cur, 1);
    }
    return out;
  },
  // 两日期间相差天数（含头不含尾）
  diffDays(a, b) {
    const d1 = this.parse(a), d2 = this.parse(b);
    return Math.round((d2 - d1) / 86400000);
  },
  // 间夜数（退房日 - 入住日，退房当日不计）
  nights(from, to) {
    return Math.max(0, this.diffDays(from, to));
  },
  // 今日
  today() { return this.fmt(new Date()); },
  // 当月天数
  daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  },
  // 未来 N 天（可指定起点 start；默认从今天）
  nextDays(n, start) {
    const out = [];
    let cur = start ? this.parse(start) : new Date();
    if (!cur) cur = new Date();
    for (let i = 0; i < n; i++) {
      out.push(this.fmt(cur));
      cur = this.addDays(cur, 1);
    }
    return out;
  },
  // 月份范围
  monthRange(year, month) {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    return [this.fmt(start), this.fmt(end)];
  },
  // 是否同日
  isSame(a, b) { return this.fmt(a) === this.fmt(b); },
  // 区间重叠判断
  overlap(s1, e1, s2, e2) {
    const a1 = this.parse(s1), a2 = this.parse(e1);
    const b1 = this.parse(s2), b2 = this.parse(e2);
    return a1 < b2 && b1 < a2;
  },
  // 相对今天的天数（-10=10天前，+5=5天后）
  fromToday(d) {
    return this.diffDays(this.today(), d);
  },
  // === 生理周期预测 ===
  cycle: {
    // 从历史周期记录预测下一周期
    predict(records, defaultCycle = 28) {
      if (!records || records.length === 0) return null;
      // 按开始日期降序
      const sorted = [...records].sort((a, b) =>
        new Date(b.startDate) - new Date(a.startDate));
      const latest = sorted[0];
      const lastDate = DateUtil.parse(latest.startDate);
      // 平均周期
      let avgCycle = defaultCycle;
      if (sorted.length >= 2) {
        const cycles = [];
        for (let i = 0; i < sorted.length - 1; i++) {
          const d1 = DateUtil.parse(sorted[i].startDate);
          const d2 = DateUtil.parse(sorted[i + 1].startDate);
          const diff = Math.round((d1 - d2) / 86400000);
          if (diff > 15 && diff < 60) cycles.push(diff);
        }
        if (cycles.length) {
          avgCycle = Math.round(cycles.reduce((s, n) => s + n, 0) / cycles.length);
        }
      }
      const nextStart = DateUtil.addDays(lastDate, avgCycle);
      const nextEnd   = DateUtil.addDays(nextStart, 5);
      return {
        nextStart: DateUtil.fmt(nextStart),
        nextEnd:   DateUtil.fmt(nextEnd),
        avgCycle,
        daysUntilNext: DateUtil.fromToday(DateUtil.fmt(nextStart))
      };
    }
  }
};
