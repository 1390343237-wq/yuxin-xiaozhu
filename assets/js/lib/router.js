/* ====================================================================
   router.js - 简易 hash 路由
   路由：#/home, #/life/finance, #/life/health, #/life/growth,
        #/biz/bnb, #/biz/media
   ==================================================================== */

const Router = {
  routes: {
    'home':           { name: '首页总览',     module: 'home' },
    'life/finance':   { name: '经济管家',     module: 'life-finance', group: '生活管理' },
    'life/health':    { name: '健康管家',     module: 'life-health',  group: '生活管理' },
    'life/growth':    { name: '个人成长中心', module: 'life-growth',  group: '生活管理' },
    'biz/bnb':        { name: '民宿管理系统', module: 'biz-bnb',      group: '工作经营' },
    'biz/rooms':      { name: '房态管理',     module: 'biz-bnb-rooms', group: '工作经营' },
    'biz/media':      { name: '自媒体营销中台', module: 'biz-media',  group: '工作经营' },
    'settings':       { name: '设置',           module: 'biz-settings', group: '生活管理', minRole: 3 }
  },
  _current: null,
  _listeners: [],

  parse() {
    const h = (location.hash || '#/home').replace(/^#\/?/, '');
    return h || 'home';
  },

  go(path) {
    location.hash = '#/' + path.replace(/^#?\/?/, '');
  },

  on(fn) { this._listeners.push(fn); },

  start() {
    const handle = () => {
      const path = this.parse();
      this._current = path;
      this._listeners.forEach(fn => fn(path));
      this._updateNav(path);
    };
    window.addEventListener('hashchange', handle);
    handle();
  },

  _updateNav(path) {
    document.querySelectorAll('.nav-item').forEach(el => {
      const r = el.dataset.route;
      el.classList.toggle('active', r === path);
    });
    // 面包屑
    const bc = document.getElementById('breadcrumb');
    if (bc) {
      const meta = this.routes[path];
      if (!meta) bc.innerHTML = '<span>首页</span>';
      else if (meta.group) {
        bc.innerHTML = `<span class="text-ink-300">${meta.group}</span>
                        <span class="mx-2 text-ink-200">/</span>
                        <span class="text-ink-500">${meta.name}</span>`;
      } else {
        bc.innerHTML = `<span class="text-ink-500">${meta.name}</span>`;
      }
    }
    // 移动端自动关闭抽屉
    if (window.innerWidth < 1024) {
      const nav = document.getElementById('sideNav');
      if (nav) nav.classList.add('-translate-x-full');
    }
  },

  getCurrent() { return this._current; },

  // ── 权限角色（本地 RBAC，随账号云端同步） ──
  ROLES: { owner: 3, family: 2, guest: 1 },
  routeMin: { 'settings': 3 },
  role() { return Store.get('yxz_role', 'owner'); },
  roleLevel() { return this.ROLES[this.role()] || 3; },
  canAccess(path) { const min = this.routeMin[path] || 1; return this.roleLevel() >= min; },
  reload() { const p = this.parse(); this._listeners.forEach(fn => fn(p)); }
};
