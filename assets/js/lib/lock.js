/* ====================================================================
   lock.js - 整分租互斥锁房规则（核心业务逻辑）
   规则：
   1. 401/1502 仅分租；1202 仅整租；1302/407/503 可整可分
   2. 整租订单覆盖期间，对应子房不可分租
   3. 子房已被分租占用，对应套房不可整租
   4. 子房间日期冲突直接拒绝
   ==================================================================== */

const Lock = {
  ROOMS: {
    '401':  { type: 'sublet_only',   subRooms: ['1','2','3','4'] },
    '1302': { type: 'whole_or_sublet', subRooms: ['5','6'] },
    '407':  { type: 'whole_or_sublet', subRooms: ['7','8'] },
    '1502': { type: 'sublet_only',   subRooms: ['9','10','11','12'] },
    '503':  { type: 'whole_or_sublet', subRooms: ['15','16'] },
    '1202': { type: 'whole_only',    subRooms: [] }
  },

  // 子房 → 所属套房
  parentOf(subRoom) {
    for (const [parent, info] of Object.entries(this.ROOMS)) {
      if (info.subRooms.includes(subRoom)) return parent;
    }
    return null;
  },

  /**
   * 校验订单冲突
   * @param {string} targetRoom  套房号（整租）或子房号（分租）
   * @param {string} orderType   '整租' | '分租'
   * @param {string} checkIn     yyyy-MM-dd
   * @param {string} checkOut    yyyy-MM-dd
   * @param {Array}  existing    已存在的订单列表（来自 main_sheet + 订单同步明细）
   * @param {string} [excludeId] 排除自身（修改时使用）
   * @returns {{ok: boolean, reason?: string, conflicts?: Array}}
   */
  check({ targetRoom, orderType, checkIn, checkOut, existing = [], excludeId = null }) {
    const range = DateUtil.range(checkIn, checkOut).slice(0, -1); // 不含退房日
    if (range.length === 0) return { ok: false, reason: '日期无效' };

    if (orderType === '整租') {
      // 规则 A：仅 1302/407/503/1202 可整租
      if (!['1302', '407', '503', '1202'].includes(targetRoom)) {
        return { ok: false, reason: `【${targetRoom}套房】仅支持分租模式，不允许整租下单` };
      }
      // 规则 B：整租期间，对应子房若被分租占用 → 拒绝
      const subRooms = this.ROOMS[targetRoom].subRooms;
      const conflicts = [];
      for (const sub of subRooms) {
        for (const o of existing) {
          if (excludeId && o.id === excludeId) continue;
          if (String(o.subRoom) !== sub) continue;
          if (DateUtil.overlap(o.checkIn, o.checkOut || o.checkIn, checkIn, checkOut)) {
            conflicts.push(`${sub}号单间被【${o.customerSource || o.raw || o.id}】分租占用`);
          }
        }
      }
      if (conflicts.length) {
        return { ok: false, reason: '整租期间存在子房分租冲突', conflicts };
      }
      return { ok: true, lockSubRooms: subRooms };
    }

    if (orderType === '分租') {
      // 规则 C：分租必须是子房号
      const parent = this.parentOf(targetRoom);
      if (!parent) return { ok: false, reason: `【${targetRoom}】不是有效分租单间` };
      // 规则 D：所属套房是否被整租覆盖
      for (const o of existing) {
        if (excludeId && o.id === excludeId) continue;
        if (o.type !== '整租') continue;
        if (o.subRoom !== parent && o.room !== parent) continue;
        if (DateUtil.overlap(o.checkIn, o.checkOut || o.checkIn, checkIn, checkOut)) {
          return { ok: false, reason: `【${parent}套房】已被整租订单覆盖，期间不能分租【${targetRoom}号单间】` };
        }
      }
      // 规则 E：日期冲突（与同子房其他订单）
      const conflicts = [];
      for (const o of existing) {
        if (excludeId && o.id === excludeId) continue;
        if (String(o.subRoom) !== targetRoom) continue;
        if (DateUtil.overlap(o.checkIn, o.checkOut || o.checkIn, checkIn, checkOut)) {
          conflicts.push(`已被【${o.customerSource || o.id}】占用 ${o.checkIn}→${o.checkOut}`);
        }
      }
      if (conflicts.length) {
        return { ok: false, reason: `${targetRoom}号单间在所选日期已有订单`, conflicts };
      }
      return { ok: true, parentSuite: parent };
    }

    return { ok: false, reason: '未知订单类型' };
  },

  /**
   * 合并 main_sheet + 订单同步明细 为统一订单列表
   * @returns {Promise<Array>}
   */
  async loadAllOrders() {
    const [main, newOrders] = await Promise.all([
      Sheet.getMainOrders().catch(() => []),
      Sheet.getNewOrders().catch(() => [])
    ]);
    // 标准化
    const merged = [
      ...main.map(o => ({
        ...o,
        room: Lock.parentOf(o.subRoom),
        type: '分租',
        checkIn: o.date,  // main sheet 的"入住"列就代表当天有客
        checkOut: DateUtil.fmt(DateUtil.addDays(o.date, 1))
      })),
      ...newOrders
    ];
    return merged;
  },

  /**
   * 计算指定日期所有房态（用于日历视图）
   * @returns {Promise<{date, rooms: {subRoom: {status, source, orderId?}}}>}
   */
  async calcDayStatus(date) {
    const all = await this.loadAllOrders();
    const result = { date, rooms: {} };
    const allSubs = ['1','2','3','4','5','6','7','8','9','10','11','12','15','16'];
    for (const s of allSubs) result.rooms[s] = { status: 'vacant' };

    for (const o of all) {
      const range = DateUtil.range(o.checkIn, o.checkOut || o.checkIn).slice(0, -1);
      if (!range.includes(date)) continue;
      // 整租 → 锁定所有子房
      if (o.type === '整租') {
        const subs = this.ROOMS[o.subRoom]?.subRooms || [];
        for (const s of subs) {
          if (result.rooms[s]) result.rooms[s] = { status: 'whole', source: o.customerSource || '整租', orderId: o.id };
        }
      } else {
        if (result.rooms[o.subRoom]) {
          result.rooms[o.subRoom] = { status: 'occupied', source: o.customerSource || '分租', orderId: o.id };
        }
      }
    }
    return result;
  },

  // 全部可出租单元（含纯整租套房本身作为一个单元）
  rentableUnits() {
    const units = [];
    for (const [sid, info] of Object.entries(this.ROOMS)) {
      const ids = info.subRooms.length ? info.subRooms : [sid];
      for (const uid of ids) {
        units.push({ id: uid, suite: sid, label: info.subRooms.length ? `${sid}·${uid}号` : `${sid}` });
      }
    }
    return units;
  },

  // 某单元在指定日期是否被占用（含整租覆盖锁房）
  // 与日历视图 _cellStatus 的「夜间占用」逻辑一致：入住夜 ~ 退房前一夜占用，退房夜释放
  isOccupiedOn(unitId, date, orders) {
    const range = (s, e) => DateUtil.range(s, e || s).slice(0, -1).includes(date);
    // 整租覆盖：套房被整租，则全部子房占用
    for (const o of orders) {
      if (o.type !== '整租') continue;
      const suite = this.ROOMS[o.subRoom];
      if (!suite) continue;
      const locked = suite.subRooms.length ? suite.subRooms.includes(unitId) : (o.subRoom === unitId);
      if (locked && range(o.checkIn, o.checkOut)) return true;
    }
    // 分租占用
    for (const o of orders) {
      if (o.type === '整租') continue;
      if (String(o.subRoom) !== unitId) continue;
      if (range(o.checkIn, o.checkOut)) return true;
    }
    return false;
  },

  // 计算未来窗口内的空置情况：返回每个单元的空闲夜数
  computeVacancy(orders, days) {
    const units = this.rentableUnits();
    return units.map(u => {
      const freeDays = days.filter(d => !this.isOccupiedOn(u.id, d, orders)).length;
      return { ...u, freeDays, occupiedDays: days.length - freeDays, total: days.length };
    });
  }
};
