/* ====================================================================
   notify.js - 全局 Toast 通知 + 弹窗 + 提醒中心
   ==================================================================== */

const Notify = {
  _toastEl: null,
  _list: [],
  _listeners: [],

  toast(msg, type = 'info', duration = 3000) {
    const root = document.getElementById('toast');
    if (!root) { console.log(`[${type}]`, msg); return; }
    const el = document.createElement('div');
    el.className = `toast-item ${type}`;
    el.textContent = msg;
    root.appendChild(el);
    root.classList.remove('hidden');
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(40px)';
      el.style.transition = 'all .2s';
      setTimeout(() => {
        el.remove();
        if (!root.children.length) root.classList.add('hidden');
      }, 220);
    }, duration);
  },

  // 列表化提醒（小红点用）
  push(item) {
    this._list.push({ ...item, id: item.id || Date.now() + Math.random(), read: false });
    this._emit();
    this._updateBell();
  },
  getAll() { return [...this._list]; },
  getUnreadCount() { return this._list.filter(n => !n.read).length; },
  markAllRead() {
    this._list.forEach(n => n.read = true);
    this._emit();
    this._updateBell();
  },
  clear() { this._list = []; this._emit(); this._updateBell(); },
  onChange(fn) { this._listeners.push(fn); },
  _emit() { this._listeners.forEach(fn => fn(this._list)); },
  _updateBell() {
    const dot = document.getElementById('notifDot');
    if (!dot) return;
    dot.classList.toggle('hidden', this.getUnreadCount() === 0);
  },

  // 弹窗
  modal({ title, body, primary, secondary, onPrimary, onSecondary, size = 'md' }) {
    const root = document.getElementById('modal');
    const content = document.getElementById('modalContent');
    if (!root || !content) return;
    content.innerHTML = `
      <h3 class="section-eyebrow">${title || ''}</h3>
      <h2 class="font-serif text-xl font-semibold text-ink-600 mb-3">${title ? '' : ''}</h2>
      <div class="text-sm text-ink-500 leading-relaxed">${body || ''}</div>
      <div class="mt-6 flex justify-end gap-2">
        ${secondary ? `<button class="btn btn-ghost" data-modal-action="secondary">${secondary}</button>` : ''}
        ${primary ? `<button class="btn btn-primary" data-modal-action="primary">${primary}</button>` : ''}
      </div>
    `;
    if (title && !content.querySelector('h2')) {
      content.innerHTML = `
        <h2 class="font-serif text-xl font-semibold text-ink-600 mb-3">${title}</h2>
        <div class="text-sm text-ink-500 leading-relaxed">${body || ''}</div>
        <div class="mt-6 flex justify-end gap-2">
          ${secondary ? `<button class="btn btn-ghost" data-modal-action="secondary">${secondary}</button>` : ''}
          ${primary ? `<button class="btn btn-primary" data-modal-action="primary">${primary}</button>` : ''}
        </div>
      `;
    }
    root.classList.remove('hidden');
    const close = () => root.classList.add('hidden');
    content.querySelectorAll('[data-modal-action]').forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.modalAction;
        if (action === 'primary' && onPrimary) onPrimary();
        if (action === 'secondary' && onSecondary) onSecondary();
        close();
      };
    });
    root.querySelectorAll('[data-modal-close]').forEach(el => {
      el.onclick = close;
    });
  },

  close() {
    const root = document.getElementById('modal');
    if (root) root.classList.add('hidden');
  },

  // 确认对话框
  confirm({ title = '确认', body, primary = '确认', secondary = '取消', danger = false }) {
    return new Promise(resolve => {
      this.modal({
        title, body,
        primary, secondary,
        onPrimary: () => resolve(true),
        onSecondary: () => resolve(false)
      });
      // 危险操作换红色按钮
      if (danger) {
        const btn = document.querySelector('[data-modal-action="primary"]');
        if (btn) {
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-danger');
        }
      }
    });
  }
};
