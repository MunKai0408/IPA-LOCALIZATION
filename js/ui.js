/* ui.js – render giao diện từ state. Không có logic phân tích ở đây.
   Dữ liệu từ IPA/game LUÔN đi qua textContent, không bao giờ innerHTML. */
(function (NS) {
  'use strict';

  const VIEWS = {
    overview:     { title: 'Tổng quan',      icon: '▦' },
    analyze:      { title: 'Phân tích IPA',  icon: '⬆' },
    engine:       { title: 'Engine',         icon: '⚙', phase: 2, empty: 'Chưa có kết quả nhận diện engine. Tải IPA ở mục “Phân tích IPA”.' },
    explorer:     { title: 'File Explorer',  icon: '🗂', phase: 3, empty: 'Chưa có danh sách file. Cây thư mục, magic bytes và manifest sẽ hiện ở đây sau khi quét.' },
    fonts:        { title: 'Font',           icon: 'Aa', phase: 5, empty: 'Chưa có dữ liệu font. Độ phủ tiếng Việt sẽ được kiểm tra trên font thực sự đọc được.' },
    text:         { title: 'Văn bản',        icon: '✎', phase: 6, empty: 'Chưa có chuỗi nào được trích xuất.' },
    localization: { title: 'Localization',   icon: '🌐', phase: 6, empty: 'Chưa có bảng ngôn ngữ nào được nhận diện.' },
    runtime:      { title: 'Runtime Strings',icon: '⏱', phase: 7, empty: 'Chưa nhập runtime_strings.jsonl. Website không thể hook game; chỉ nhập dữ liệu do công cụ runtime bên ngoài tạo.' },
    metadata:     { title: 'Metadata',       icon: '🧬', phase: 4, empty: 'Chưa có metadata Mach-O / IL2CPP.' },
    report:       { title: 'Báo cáo',        icon: '📄', phase: 9, empty: 'Báo cáo sẽ được tạo từ kết quả phân tích thật sau khi hoàn tất.' },
    settings:     { title: 'Cài đặt',        icon: '☰' }
  };

  const STAT_DEFS = [
    ['appName', 'Tên game'], ['bundleId', 'Bundle ID'], ['version', 'Phiên bản'],
    ['engine', 'Engine phát hiện'], ['arch', 'Kiến trúc'], ['ipaSize', 'Dung lượng IPA'],
    ['totalFiles', 'Tổng số file'], ['fontCount', 'Số font'], ['stringCount', 'Số chuỗi'],
    ['tableCount', 'Số bảng ngôn ngữ'], ['status', 'Trạng thái']
  ];

  const STATUS_LABEL = {
    idle: ['Chưa có IPA', ''], file_selected: ['Đã chọn file', 'info'], running: ['Đang phân tích', 'info'],
    done: ['Hoàn tất', 'success'], error: ['Lỗi', 'danger'], cancelled: ['Đã hủy', 'warning']
  };

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /** Tạo phần tử an toàn: text luôn là textContent. */
  function h(tag, props, children) {
    const el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') el.className = props[k];
      else if (k === 'text') el.textContent = props[k];
      else el.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  function formatBytes(n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n >= 100 ? 0 : 1) + ' ' + u[i];
  }

  function toast(message, kind, ms) {
    const box = $('#toasts'); if (!box) return;
    const t = h('div', { class: 'toast ' + (kind || 'info'), role: 'status', text: message });
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 4500);
  }

  /* ---------- Render ---------- */
  function buildStatGrid() {
    const grid = $('#stat-grid'); if (!grid || grid.children.length) return;
    STAT_DEFS.forEach(function (d) {
      grid.appendChild(h('div', { class: 'stat' }, [
        h('div', { class: 'stat-label', text: d[1] }),
        h('div', { class: 'stat-value is-empty', 'data-stat': d[0], text: '—' })
      ]));
    });
  }

  function setStat(key, value) {
    const el = $('[data-stat="' + key + '"]'); if (!el) return;
    const empty = value == null || value === '';
    el.textContent = empty ? '—' : String(value);
    el.classList.toggle('is-empty', empty);
  }

  function buildGenericViews() {
    const host = $('#generic-views'); if (!host || host.children.length) return;
    Object.keys(VIEWS).forEach(function (id) {
      const v = VIEWS[id];
      if (!v.empty) return;
      host.appendChild(h('section', { class: 'view', id: 'view-' + id, hidden: '' }, [
        h('div', { class: 'card empty' }, [
          h('div', { class: 'empty-icon', text: v.icon }),
          h('h2', { text: v.title }),
          h('p', { text: v.empty }),
          h('div', { class: 'phase-tag' }, [h('span', { class: 'badge', text: 'Triển khai ở Phase ' + v.phase })])
        ])
      ]));
    });
  }

  function buildSteps() {
    const host = $('#steps'); if (!host) return;
    host.replaceChildren();
    NS.State.get().session.steps.forEach(function (s) {
      const dotText = s.status === 'done' ? '✓' : s.status === 'error' ? '!' : '';
      host.appendChild(h('div', { class: 'step ' + s.status }, [
        h('span', { class: 'step-dot', text: dotText }),
        h('span', { class: 'step-name', text: s.label }),
        h('span', { class: 'step-status', text: s.message || ({ pending: 'Chờ', running: 'Đang chạy', done: 'Xong', error: 'Lỗi', skipped: 'Bỏ qua' }[s.status]) })
      ]));
    });
  }

  function renderFileInfo(session) {
    const dz = $('#dropzone'), info = $('#file-info'), check = $('#file-check');
    const f = session.file;
    dz.classList.toggle('has-file', !!f);
    info.replaceChildren();
    check.textContent = ''; check.className = 'badge'; check.hidden = !f;
    if (!f) return;
    [['Tên file', f.name], ['Dung lượng', formatBytes(f.size)]].forEach(function (p) {
      info.appendChild(h('dt', { text: p[0] }));
      info.appendChild(h('dd', { text: p[1] }));
    });
    if (session.fileCheck) {
      check.textContent = session.fileCheck.message;
      check.classList.add(session.fileCheck.ok ? 'success' : 'danger');
    }
  }

  function render(state) {
    const s = state.session;

    // điều hướng + view
    $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.view === state.view); });
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + state.view; });
    $('#page-title').textContent = (VIEWS[state.view] || {}).title || '';

    // dashboard: chỉ hiển thị dữ liệu thật, thiếu thì "—"
    const app = s.app || {};
    setStat('appName', app.name);
    setStat('bundleId', app.bundleId);
    setStat('version', app.version ? app.version + (app.build ? ' (' + app.build + ')' : '') : null);
    setStat('engine', s.engine ? s.engine.engine + (s.engine.variant ? ' ' + s.engine.variant : '') : null);
    setStat('arch', app.architectures && app.architectures.length ? app.architectures.join(', ') : null);
    setStat('ipaSize', s.file ? formatBytes(s.file.size) : null);
    setStat('totalFiles', s.stats.totalFiles);
    setStat('fontCount', s.stats.fontCount);
    setStat('stringCount', s.stats.stringCount);
    setStat('tableCount', s.stats.localizationTables);
    const st = STATUS_LABEL[s.status] || STATUS_LABEL.idle;
    const stEl = $('[data-stat="status"]');
    stEl.textContent = st[0]; stEl.classList.toggle('is-empty', s.status === 'idle');

    // trạng thái trống trên Tổng quan
    $('#overview-empty').hidden = !!s.file;

    renderFileInfo(s);
    buildSteps();
    $('#progress-bar').style.width = Math.round((s.progress || 0) * 100) + '%';

    // nút – Phase 0: chưa có parser nên "Bắt đầu" luôn bị khóa
    const running = s.status === 'running';
    $('#btn-start').disabled = true;
    $('#btn-start').title = 'Parser IPA sẽ được triển khai ở Phase 1';
    $('#btn-cancel').disabled = !running;
    $('#btn-clear').disabled = !s.file && s.status === 'idle';
    $('#phase0-note').hidden = !s.file;
  }

  /* ---------- Log viewer ---------- */
  function appendLog(entry) {
    const box = $('#log-viewer'); if (!box) return;
    if (entry === null) { box.replaceChildren(h('div', { class: 'log-empty', text: 'Chưa có log.' })); return; }
    const empty = $('.log-empty', box); if (empty) empty.remove();
    const line = h('div', { class: 'log-line lv-' + entry.level }, [
      h('span', { class: 'lv', text: entry.level + ' ' }),
      document.createTextNode(NS.Logger.formatLine(entry).replace(/^\[[^\]]+\]\s+\S+\s+/, ''))
    ]);
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- Theme ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const b = $('#btn-theme'); if (b) b.textContent = theme === 'dark' ? '☀ Sáng' : '☾ Tối';
  }

  function init() {
    buildStatGrid();
    buildGenericViews();
    NS.Logger.subscribe(appendLog);
    appendLog(null);
    NS.Logger.getEntries().forEach(appendLog);
  }

  NS.UI = { VIEWS: VIEWS, $: $, $$: $$, h: h, init: init, render: render, toast: toast, formatBytes: formatBytes, applyTheme: applyTheme };
})(window.IPAStudio = window.IPAStudio || {});
