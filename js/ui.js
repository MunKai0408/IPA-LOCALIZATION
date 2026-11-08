/* ui.js – render giao diện từ state. Không có logic phân tích ở đây.
   Dữ liệu từ IPA/game LUÔN đi qua textContent, không bao giờ innerHTML. */
(function (NS) {
  'use strict';

  const VIEWS = {
    overview:     { title: 'Tổng quan',      icon: '▦' },
    analyze:      { title: 'Phân tích IPA',  icon: '⬆' },
    engine:       { title: 'Engine',         icon: '⚙', phase: 2 },
    explorer:     { title: 'File Explorer',  icon: '🗂', phase: 3 },
    fonts:        { title: 'Font',           icon: 'Aa', phase: 5 },
    text:         { title: 'Văn bản',        icon: '✎', phase: 6, empty: 'Chưa có chuỗi nào được trích xuất.' },
    localization: { title: 'Localization',   icon: '🌐', phase: 6, empty: 'Chưa có bảng ngôn ngữ nào được nhận diện.' },
    runtime:      { title: 'Runtime Strings',icon: '⏱', phase: 7, empty: 'Chưa nhập runtime_strings.jsonl. Website không thể hook game; chỉ nhập dữ liệu do công cụ runtime bên ngoài tạo.' },
    metadata:     { title: 'Unity / Metadata', icon: '🧬', phase: 4 },
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
    read_done: ['Đã đọc cấu trúc IPA', 'success'], done: ['Hoàn tất', 'success'], error: ['Lỗi', 'danger'], cancelled: ['Đã hủy', 'warning']
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
    setStat('engine', s.engine ? (s.engine.engine === 'Unknown' ? 'Unknown (chưa đủ bằng chứng)' : s.engine.engine + (s.engine.variant ? ' ' + s.engine.variant : '') + ' · ' + s.engine.status) : null);
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
    const total = s.steps.length;
    const doneCount = s.steps.filter(function (x) { return x.status === 'done'; }).length;
    const runCount = s.steps.filter(function (x) { return x.status === 'running'; }).length;
    const pct = Math.round(((doneCount + runCount * 0.5) / total) * 100);
    $('#progress-bar').style.width = pct + '%';
    $('#progress').setAttribute('aria-valuenow', String(pct));

    const running = s.status === 'running';
    const canStart = !!s.file && !!s.fileCheck && s.fileCheck.ok && !running;
    $('#btn-start').disabled = !canStart;
    $('#btn-start').classList.toggle('loading', running);
    $('#btn-start').title = canStart ? '' : (running ? 'Đang phân tích' : 'Chọn file .ipa hợp lệ trước');
    $('#btn-cancel').disabled = !running;
    $('#btn-clear').disabled = !s.file && s.status === 'idle';
    $('#phase-note').hidden = s.status !== 'read_done';
    renderError(s);
    renderDetails(s);
    renderEngine(s);
    renderExplorer(s);
    renderUnity(s);
    renderFonts(s);
  }

  /* ---------- Lỗi + chi tiết ứng dụng ---------- */
  function renderError(s) {
    const box = $('#error-banner');
    if (!s.error) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = 'Lỗi [' + s.error.code + ']: ' + s.error.message;
  }

  function kvRow(dl, k, v) {
    dl.appendChild(h('dt', { text: k }));
    dl.appendChild(h('dd', { text: v == null || v === '' ? '—' : String(v) }));
  }

  function listBlock(title, arr, max) {
    const cap = max || 300;
    const items = arr.slice(0, cap).map(function (x) { return h('li', { text: x }); });
    if (arr.length > cap) items.push(h('li', { text: '… và ' + (arr.length - cap) + ' mục khác' }));
    return h('details', { class: 'list-block' }, [
      h('summary', { text: title + ' (' + arr.length + ')' }),
      arr.length ? h('ul', { class: 'plain-list' }, items) : h('p', { class: 'dim', text: 'Không có.' })
    ]);
  }

  let lastIpa = null;
  function renderDetails(s) {
    const ipa = (s.results && s.results.ipa) || null;
    if (ipa === lastIpa) return;
    lastIpa = ipa;
    const box = $('#app-detail'); box.replaceChildren(); box.hidden = !ipa;
    const picker = $('#bundle-picker'); picker.replaceChildren(); picker.hidden = !ipa || ipa.bundles.length < 2;
    if (!ipa) return;

    if (ipa.bundles.length > 1) {
      const sel = h('select', { id: 'bundle-select', class: 'select' }, ipa.bundles.map(function (b) { return h('option', { value: b, text: b }); }));
      sel.value = ipa.selectedBundle;
      picker.appendChild(h('label', { class: 'field' }, [h('span', { text: 'IPA có nhiều bundle .app. Chọn bundle cần phân tích (sẽ đọc lại):' }), sel]));
    }

    const a = ipa.app, m = ipa.macho;
    const info = h('dl', { class: 'kv' });
    kvRow(info, 'Tên', a.displayName || a.name || a.executable);
    kvRow(info, 'Bundle ID', a.bundleId);
    kvRow(info, 'Phiên bản', a.version ? a.version + (a.build ? ' (build ' + a.build + ')' : '') : a.build);
    kvRow(info, 'MinimumOSVersion', a.minOS);
    kvRow(info, 'Thiết bị', a.deviceFamilyNames.join(', '));
    kvRow(info, 'Danh mục', a.category);
    kvRow(info, 'File thực thi', a.executable);
    kvRow(info, 'Kiến trúc', ipa.architectures.join(', ') || 'Không đọc được');
    kvRow(info, 'Mã hóa FairPlay', !m ? 'Không xác định' : m.encrypted === true ? 'Có (cryptid≠0) – binary không đọc được' : m.encrypted === false ? 'Không' : 'Không xác định');
    kvRow(info, 'Định dạng Info.plist', ipa.infoPlistFormat === 'binary' ? 'Binary plist' : 'XML');
    kvRow(info, 'UIRequiredDeviceCapabilities', a.requiredCapabilities.join(', '));
    box.appendChild(h('div', { class: 'card' }, [h('h2', { class: 'section-title', text: 'Thông tin ứng dụng' }), info]));

    const z = ipa.zip, st = h('dl', { class: 'kv' });
    kvRow(st, 'Bundle đang phân tích', ipa.selectedBundle);
    kvRow(st, 'Tổng số file', z.fileCount);
    kvRow(st, 'Dung lượng nén / giải nén', formatBytes(z.totalCompressed) + ' / ' + formatBytes(z.totalUncompressed));
    kvRow(st, 'Thư mục Data', ipa.dataDir ? ipa.dataDir.files + ' file, ' + formatBytes(ipa.dataDir.bytes) : 'Không có');
    kvRow(st, 'ZIP64', z.zip64 ? 'Có' : 'Không');
    box.appendChild(h('div', { class: 'card' }, [
      h('h2', { class: 'section-title', text: 'Cấu trúc bundle' }), st,
      listBlock('Frameworks', ipa.frameworks), listBlock('PlugIns', ipa.plugins), listBlock('Thư mục *.lproj', ipa.lprojs),
      listBlock('Thư mục cấp 1 của .app', ipa.topLevel.map(function (c) { return c.name + (c.isDir ? '/ (' + c.files + ' file)' : ''); }))
    ]));

    if (ipa.warnings.length) {
      box.appendChild(h('div', { class: 'card' }, [
        h('h2', { class: 'section-title', text: 'Cảnh báo (' + ipa.warnings.length + ')' }),
        h('ul', { class: 'plain-list' }, ipa.warnings.map(function (w) { return h('li', { text: w }); }))
      ]));
    }
  }

  /* ---------- View Engine (Phase 2) ---------- */
  const ENGINE_STATUS = {
    confirmed: ['Xác nhận (confirmed)', 'success'], probable: ['Nhiều khả năng (probable)', 'info'],
    possible: ['Có thể (possible)', 'warning'], unknown: ['Không xác định (unknown)', 'danger']
  };
  let lastEngine = null;
  function renderEngine(s) {
    const res = (s.results && s.results.engine) || null;
    if (res === lastEngine) return;
    lastEngine = res;
    const box = $('#engine-detail'), empty = $('#engine-empty');
    if (!box || !empty) return;
    box.replaceChildren(); box.hidden = !res; empty.hidden = !!res;
    if (!res) return;

    const st = ENGINE_STATUS[res.status] || ENGINE_STATUS.unknown;
    const info = h('dl', { class: 'kv' });
    kvRow(info, 'Engine', res.engine);
    kvRow(info, 'Biến thể', res.variant || 'Chưa xác định');
    info.appendChild(h('dt', { text: 'Trạng thái' }));
    info.appendChild(h('dd', {}, [h('span', { class: 'badge ' + st[1], text: st[0] })]));
    kvRow(info, 'Độ tin cậy', Math.round(res.confidence * 100) + '%');
    kvRow(info, 'Phiên bản engine', res.version ? res.version + ' (đọc từ ' + res.version_source + ')' : 'Không đọc được từ dữ liệu');
    kvRow(info, 'Nhánh phân tích', res.analysis_branch);
    box.appendChild(h('div', { class: 'card' }, [h('h2', { class: 'section-title', text: 'Kết quả nhận diện' }), info]));

    const evCard = h('div', { class: 'card' }, [h('h2', { class: 'section-title', text: 'Bằng chứng (' + res.evidence.length + ')' })]);
    if (res.evidence.length) {
      evCard.appendChild(h('ul', { class: 'plain-list' }, res.evidence.map(function (e) {
        return h('li', { text: '[' + e.tier + ' ' + e.weight + '] ' + e.indicator + ' — ' + e.path });
      })));
    } else evCard.appendChild(h('p', { class: 'dim', text: 'Không có bằng chứng nào đạt ngưỡng.' }));
    box.appendChild(evCard);

    box.appendChild(h('div', { class: 'card' }, [
      listBlock('Dấu hiệu còn thiếu (missing_indicators)', res.missing_indicators),
      listBlock('Ghi chú', res.notes),
      listBlock('Engine khác có dấu hiệu', res.alternatives.map(function (a) { return a.engine + ' – ' + a.status + ' (' + Math.round(a.confidence * 100) + '%)'; }))
    ]));
  }

  /* ---------- View File Explorer (Phase 3) ---------- */
  const EX = { manifest: null, tree: null, dir: '', page: 0, size: 100, bound: false, list: [] };

  function buildTree(rows) {
    const nodes = new Map();
    const node = function (p) { let n = nodes.get(p); if (!n) { n = { dirs: new Map(), files: [] }; nodes.set(p, n); } return n; };
    node('');
    rows.forEach(function (r) {
      const parts = r.relative_path.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        const parent = parts.slice(0, i).join('/'), cur = node(parent).dirs.get(parts[i]) || { count: 0, bytes: 0 };
        cur.count++; cur.bytes += r.file_size; node(parent).dirs.set(parts[i], cur);
        node(parts.slice(0, i + 1).join('/'));
      }
      node(parts.slice(0, -1).join('/')).files.push(r);
    });
    return nodes;
  }
  function exSorter(kind) {
    return kind === 'size' ? function (a, b) { return b.file_size - a.file_size; }
      : kind === 'type' ? function (a, b) { return a.detected_type.localeCompare(b.detected_type) || a.relative_path.localeCompare(b.relative_path); }
      : function (a, b) { return a.relative_path.localeCompare(b.relative_path); };
  }
  function exFiltersActive() { return !!($('#ex-search').value.trim() || $('#ex-type').value || $('#ex-priority').checked); }
  function exCell(text, props) { return h('td', Object.assign({ text: text }, props || {})); }

  function exRender() {
    const m = EX.manifest; if (!m) return;
    const flat = $('#ex-mode').value === 'flat' || exFiltersActive(), sort = exSorter($('#ex-sort').value);
    const tbl = $('#ex-table'), crumb = $('#ex-crumb');
    crumb.replaceChildren();
    let entries; // {kind:'up'|'dir'|'file', ...}
    if (flat) {
      const q = $('#ex-search').value.trim().toLowerCase(), t = $('#ex-type').value, pr = $('#ex-priority').checked;
      entries = m.rows.filter(function (r) { return (!t || r.detected_type === t) && (!pr || r.priority) && (!q || r.relative_path.toLowerCase().indexOf(q) >= 0); })
        .sort(sort).map(function (r) { return { kind: 'file', row: r }; });
      if ($('#ex-mode').value !== 'flat') crumb.appendChild(h('span', { class: 'badge', text: 'Đang lọc: hiển thị danh sách phẳng' }));
    } else {
      const parts = EX.dir ? EX.dir.split('/') : [];
      const mk = function (label, path) { const b = h('button', { class: 'btn', type: 'button', text: label }); b.addEventListener('click', function () { EX.dir = path; EX.page = 0; exRender(); }); return b; };
      crumb.appendChild(mk('Gốc .app', ''));
      parts.forEach(function (p, i) { crumb.appendChild(mk(p, parts.slice(0, i + 1).join('/'))); });
      const n = EX.tree.get(EX.dir) || { dirs: new Map(), files: [] };
      entries = [];
      if (EX.dir) entries.push({ kind: 'up' });
      Array.from(n.dirs.keys()).sort().forEach(function (k) { entries.push({ kind: 'dir', name: k, info: n.dirs.get(k) }); });
      n.files.slice().sort(sort).forEach(function (r) { entries.push({ kind: 'file', row: r }); });
    }
    EX.list = entries;
    const total = entries.length, from = EX.page * EX.size, to = Math.min(total, from + EX.size);
    tbl.replaceChildren(h('thead', {}, [h('tr', {}, ['Tên / đường dẫn', 'Kích thước', 'Loại', 'Định dạng', 'Magic', 'SHA-1', 'Engine', 'Trạng thái'].map(function (t) { return h('th', { text: t }); }))]));
    const tb = h('tbody', {});
    entries.slice(from, to).forEach(function (en) {
      let tr;
      if (en.kind === 'up') {
        tr = h('tr', {}, [exCell('📁 .. (lên một cấp)', { class: 'path' })]);
        tr.addEventListener('click', function () { EX.dir = EX.dir.split('/').slice(0, -1).join('/'); EX.page = 0; exRender(); });
      } else if (en.kind === 'dir') {
        tr = h('tr', {}, [exCell('📁 ' + en.name + '/', { class: 'path' }), exCell(formatBytes(en.info.bytes)), exCell(en.info.count + ' file'), exCell(''), exCell(''), exCell(''), exCell(''), exCell('')]);
        tr.addEventListener('click', function () { EX.dir = EX.dir ? EX.dir + '/' + en.name : en.name; EX.page = 0; exRender(); });
      } else {
        const r = en.row;
        tr = h('tr', {}, [exCell(flat ? r.relative_path : r.file_name, { class: 'path' }), exCell(formatBytes(r.file_size)), exCell(r.detected_type), exCell(r.detected_format, { title: r.error || '' }),
          exCell(r.magic_bytes), exCell(r.sha1 ? r.sha1.slice(0, 12) + '…' : '—', { title: r.sha1 }), exCell(r.engine_related), exCell(r.extraction_status + (r.duplicate_of ? ' · trùng' : ''))]);
        tr.addEventListener('click', function () { exDetail(r); });
      }
      tr.style.cursor = 'pointer'; tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    $('#ex-count').textContent = total ? 'Hiển thị ' + (from + 1) + '–' + to + ' / ' + total + (flat ? ' file' : ' mục trong thư mục này') : 'Không có mục nào';
    $('#ex-prev').disabled = EX.page === 0; $('#ex-next').disabled = to >= total;
  }

  function exDetail(r) {
    const box = $('#ex-detail'); box.hidden = false; box.replaceChildren(h('h2', { class: 'section-title', text: 'Chi tiết file' }));
    const dl = h('dl', { class: 'kv' });
    EX.manifest.columns.forEach(function (c) { kvRow(dl, c, r[c] === '' || r[c] == null ? '—' : String(r[c])); });
    box.appendChild(dl);
  }

  function renderExplorer(s) {
    const m = (s.results && s.results.manifest) || null;
    if (m === EX.manifest) return;
    EX.manifest = m; EX.dir = ''; EX.page = 0;
    const box = $('#explorer-detail'), empty = $('#explorer-empty');
    if (!box || !empty) return;
    box.hidden = !m; empty.hidden = !!m; $('#ex-detail').hidden = true;
    if (!m) return;
    EX.tree = buildTree(m.rows);
    const sm = m.summary, sum = $('#explorer-summary');
    sum.replaceChildren(h('h2', { class: 'section-title', text: 'Tóm tắt quét' }));
    const dl = h('dl', { class: 'kv' });
    kvRow(dl, 'Tổng số file', String(sm.totalFiles)); kvRow(dl, 'Tổng dung lượng giải nén', formatBytes(sm.totalBytes));
    kvRow(dl, 'Chế độ', m.options.hashMode === 'standard' ? 'Đầy đủ (SHA-1 ' + sm.hashed + ' file, SHA-256 ' + sm.sha256Hashed + ' file)' : 'Nhanh (chưa băm)');
    kvRow(dl, 'File ưu tiên', String(sm.priorityFiles)); kvRow(dl, 'Đuôi ≠ nội dung', String(sm.mismatches));
    kvRow(dl, 'File nén/đóng gói (chỉ ghi header)', String(sm.archives)); kvRow(dl, 'File lỗi/không đọc được', String(sm.errors));
    if (sm.suspiciousRatio) kvRow(dl, 'Tỉ lệ nén bất thường', String(sm.suspiciousRatio));
    kvRow(dl, 'File trùng nội dung', m.options.hashMode === 'standard' ? sm.duplicates.extraCopies + ' bản dư trong ' + sm.duplicates.groups + ' nhóm (lãng phí ' + formatBytes(sm.duplicates.wastedBytes) + ')' : 'Chưa xác định (cần chế độ Đầy đủ)');
    sum.appendChild(dl);
    sum.appendChild(h('div', { class: 'chips' }, Object.keys(sm.byType).sort().map(function (k) { return h('span', { class: 'badge', text: k + ': ' + sm.byType[k] }); })));
    if (sm.duplicates.top.length) sum.appendChild(listBlock('Nhóm trùng lớn nhất', sm.duplicates.top.map(function (g) { return g.count + '× ' + formatBytes(g.size) + ' — ' + g.paths.join(', ') + (g.count > g.paths.length ? ', …' : ''); })));
    const sel = $('#ex-type'); sel.replaceChildren(h('option', { value: '', text: 'Mọi loại' }));
    Object.keys(sm.byType).sort().forEach(function (k) { sel.appendChild(h('option', { value: k, text: k + ' (' + sm.byType[k] + ')' })); });
    if (!EX.bound) {
      EX.bound = true;
      const re = function () { EX.page = 0; exRender(); };
      ['#ex-search'].forEach(function (id) { $(id).addEventListener('input', re); });
      ['#ex-type', '#ex-priority', '#ex-mode', '#ex-sort'].forEach(function (id) { $(id).addEventListener('change', re); });
      $('#ex-prev').addEventListener('click', function () { if (EX.page > 0) { EX.page--; exRender(); } });
      $('#ex-next').addEventListener('click', function () { if ((EX.page + 1) * EX.size < EX.list.length) { EX.page++; exRender(); } });
    }
    exRender();
  }

  /* ---------- View Unity / Metadata (Phase 4 – sub-phase 4.1) ---------- */
  const UNITY_STATUS = {
    discovered: ['Đã tìm thấy thành phần Unity', 'success'], insufficient_evidence: ['Chưa đủ bằng chứng Unity', 'warning'], not_unity: ['Không phải Unity', 'danger']
  };
  const META_STATUS = {
    selected: ['Đã chọn file metadata', 'success'], missing: ['Không tìm thấy file metadata', 'danger'], ambiguous: ['Nhiều ứng viên, chưa chọn', 'warning'],
    unreadable: ['Có ứng viên nhưng không đọc được', 'danger'], not_il2cpp: ['Không áp dụng (Unity Mono)', ''], not_applicable: ['Không áp dụng', '']
  };
  const HEADER_STATUS = {
    generic_ok: ['Header hợp lệ ở mức chung', 'success'], header_unverified: ['Chưa thể kiểm tra chung (bố cục chưa xác minh)', 'warning'],
    unsupported_version: ['Phiên bản chưa hỗ trợ', 'warning'], invalid_header: ['Header không hợp lệ', 'danger'], bad_magic: ['Sai magic (có thể mã hóa/obfuscate)', 'danger'],
    read_error: ['Không đọc được header', 'danger'], not_checked: ['Chưa kiểm tra', '']
  };
  function buildMetaHeaderCard(m) {
    const card = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'Header metadata (sub-phase 4.2)' })]);
    if (!m) { card.appendChild(h('p', { class: 'dim', text: 'Bước kiểm tra header không chạy (không có kết quả).' })); return card; }
    const hs = HEADER_STATUS[m.status] || [m.status, ''];
    const kv = h('dl', { class: 'kv' });
    kv.appendChild(h('dt', { text: 'Trạng thái' }));
    kv.appendChild(h('dd', {}, [h('span', { class: 'badge ' + hs[1], text: hs[0] })]));
    kvRow(kv, 'Lý do', m.reason);
    if (m.applicable) {
      kvRow(kv, 'File', m.path || '—');
      kvRow(kv, 'Kích thước file', m.file_size === null ? '—' : formatBytes(m.file_size) + ' (' + m.file_size + ' byte)');
      kvRow(kv, 'Đã đọc', m.bytes_read + ' byte đầu (giới hạn ' + m.read_limit + ')');
    }
    if (m.magic) kvRow(kv, 'Magic', m.magic.hex + (m.magic.matches ? ' — khớp ' : ' — KHÔNG khớp ') + m.magic.expected);
    if (m.version) kvRow(kv, 'Version', m.version.value + (m.version.in_reference_list ? ' (có trong danh sách đã biết)' : ' (không có trong danh sách đã biết)'));
    if (m.header && m.header.header_size) {
      kvRow(kv, 'Header (giả định chung)', m.header.header_size + ' byte · ' + m.header.pair_count + ' cặp offset/size · ' + m.header.empty_tables + ' bảng rỗng · ' + (m.header.overlaps || 0) + ' chồng chéo');
      if (m.header.max_table_end !== null) kvRow(kv, 'Bảng kết thúc xa nhất', m.header.max_table_end + ' (còn ' + m.header.trailing_bytes + ' byte sau đó)');
    }
    card.appendChild(kv);
    if (m.raw_header_hex) card.appendChild(listBlock('64 byte đầu (hex)', [m.raw_header_hex]));
    if (m.header && m.header.pairs && m.header.pairs.length) {
      card.appendChild(listBlock('Các cặp (offset, size) – chỉ đánh số, chưa gán tên trường', m.header.pairs.map(function (p) { return '#' + p.index + ': offset ' + p.offset + ', size ' + p.size; }), 40));
    }
    if (m.findings.length) card.appendChild(listBlock('Phát hiện', m.findings.map(function (f) { return '[' + f.level + '] ' + f.message; }), 40));
    card.appendChild(h('p', { class: 'dim mt-2', text: m.layout.note }));
    return card;
  }
  const LIT_STATUS = { ok: ['Đã trích xuất', 'success'], unsupported_version: ['Version chưa hỗ trợ trích xuất', 'warning'], invalid_table: ['Bảng không hợp lệ', 'danger'],
    too_large: ['Quá lớn cho trình duyệt', 'danger'], read_error: ['Không đọc được', 'danger'], not_eligible: ['Không đủ điều kiện', ''] };
  function buildLiteralsCard(l) {
    const card = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'String literal (sub-phase 4.3)' })]);
    if (!l) { card.appendChild(h('p', { class: 'dim', text: 'Chưa trích xuất: chỉ chạy khi header metadata đạt kiểm tra chung (xem thẻ trên).' })); return card; }
    const ls = LIT_STATUS[l.status] || [l.status, ''];
    const kv = h('dl', { class: 'kv' });
    kv.appendChild(h('dt', { text: 'Trạng thái' })); kv.appendChild(h('dd', {}, [h('span', { class: 'badge ' + ls[1], text: ls[0] })]));
    kvRow(kv, 'Lý do', l.reason);
    if (l.status === 'ok') {
      kvRow(kv, 'Số literal', l.count + ' (' + l.distinct + ' khác nhau, ' + l.empty + ' rỗng)');
      kvRow(kv, 'Lỗi dữ liệu', l.invalid_utf8 + ' UTF-8 không hợp lệ · ' + l.out_of_range + ' trỏ ngoài vùng dữ liệu');
      kvRow(kv, 'Tổng dung lượng chữ', formatBytes(l.total_text_bytes));
    }
    card.appendChild(kv);
    if (l.status === 'ok' && l.literals.length) {
      const PAGE = 100; let page = 0, query = '';
      const input = h('input', { type: 'search', class: 'input', placeholder: 'Tìm trong literal…', 'aria-label': 'Tìm literal' });
      const info = h('span', { class: 'dim' }), prev = h('button', { class: 'btn btn-sm', type: 'button', text: '‹' }), next = h('button', { class: 'btn btn-sm', type: 'button', text: '›' });
      const tbody = h('tbody'), table = h('table', { class: 'tbl' }, [h('thead', {}, [h('tr', {}, ['#', 'Văn bản', 'Byte', 'Cờ'].map(function (x) { return h('th', { text: x }); }))]), tbody]);
      const draw = function () {
        const q = query.toLowerCase();
        const rows = q ? l.literals.filter(function (e) { return e.text !== null && e.text.toLowerCase().indexOf(q) >= 0; }) : l.literals;
        const pages = Math.max(1, Math.ceil(rows.length / PAGE)); if (page >= pages) page = pages - 1;
        tbody.replaceChildren();
        rows.slice(page * PAGE, page * PAGE + PAGE).forEach(function (e) {
          tbody.appendChild(h('tr', {}, [h('td', { text: String(e.index) }), h('td', { class: 'path', text: e.text === null ? '(không đọc được)' : (e.text.length > 300 ? e.text.slice(0, 300) + '…' : e.text) }), h('td', { text: String(e.length) }), h('td', { text: e.flags.join(', ') })]));
        });
        info.textContent = rows.length + ' / ' + l.literals.length + ' literal · trang ' + (page + 1) + '/' + pages;
        prev.disabled = page === 0; next.disabled = page >= pages - 1;
      };
      input.addEventListener('input', function () { query = input.value; page = 0; draw(); });
      prev.addEventListener('click', function () { page--; draw(); }); next.addEventListener('click', function () { page++; draw(); });
      card.appendChild(h('div', { class: 'toolbar mt-2' }, [input, prev, next, info]));
      card.appendChild(h('div', { class: 'table-wrap' }, [table]));
      draw();
    }
    card.appendChild(h('p', { class: 'dim mt-2', text: 'Chuỗi trùng không bị gộp; chỉ hiển thị tối đa 300 ký tự mỗi dòng (JSON tải về đầy đủ).' }));
    return card;
  }
  const TBL_STATUS = { ok: ['Đã trích xuất', 'success'], unsupported_version: ['Version chưa có bố cục xác minh', 'warning'], layout_mismatch: ['Bố cục không khớp', 'danger'], invalid_table: ['Bảng không hợp lệ', 'danger'],
    too_large: ['Quá lớn cho trình duyệt', 'danger'], read_error: ['Không đọc được', 'danger'], not_eligible: ['Không đủ điều kiện', ''] };
  /** Bảng có tìm kiếm + phân trang (chỉ dựng DOM cho một trang). cols: tiêu đề; rowsOf(): mảng dữ liệu; cells(x): mảng chuỗi; hay(x): chuỗi để tìm. */
  function buildPagedTable(cols, rows, cells, hay, label) {
    const PAGE = 100; let page = 0, query = '';
    const input = h('input', { type: 'search', class: 'input', placeholder: 'Tìm…', 'aria-label': label });
    const info = h('span', { class: 'dim' }), prev = h('button', { class: 'btn btn-sm', type: 'button', text: '‹' }), next = h('button', { class: 'btn btn-sm', type: 'button', text: '›' });
    const tbody = h('tbody'), table = h('table', { class: 'tbl' }, [h('thead', {}, [h('tr', {}, cols.map(function (x) { return h('th', { text: x }); }))]), tbody]);
    const draw = function () {
      const q = query.toLowerCase();
      const list = q ? rows.filter(function (x) { return hay(x).toLowerCase().indexOf(q) >= 0; }) : rows;
      const pages = Math.max(1, Math.ceil(list.length / PAGE)); if (page >= pages) page = pages - 1;
      tbody.replaceChildren();
      list.slice(page * PAGE, page * PAGE + PAGE).forEach(function (x) { tbody.appendChild(h('tr', {}, cells(x).map(function (c) { return typeof c === 'string' ? h('td', { class: 'path', text: c }) : h('td', {}, [c]); }))); });
      info.textContent = list.length + ' / ' + rows.length + ' · trang ' + (page + 1) + '/' + pages;
      prev.disabled = page === 0; next.disabled = page >= pages - 1;
    };
    input.addEventListener('input', function () { query = input.value; page = 0; draw(); });
    prev.addEventListener('click', function () { page--; draw(); }); next.addEventListener('click', function () { page++; draw(); });
    draw();
    return h('div', {}, [h('div', { class: 'toolbar mt-2' }, [input, prev, next, info]), h('div', { class: 'table-wrap' }, [table])]);
  }
  function buildTablesCard(t) {
    const card = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'Assembly / namespace / class / method / field (sub-phase 4.3)' })]);
    if (!t) { card.appendChild(h('p', { class: 'dim', text: 'Chưa trích xuất: chỉ chạy khi header metadata đạt kiểm tra chung (xem thẻ Header) và version có bố cục xác minh.' })); return card; }
    const ts = TBL_STATUS[t.status] || [t.status, ''];
    const kv = h('dl', { class: 'kv' });
    kv.appendChild(h('dt', { text: 'Trạng thái' })); kv.appendChild(h('dd', {}, [h('span', { class: 'badge ' + ts[1], text: ts[0] })]));
    kvRow(kv, 'Lý do', t.reason);
    if (t.status === 'ok') {
      kvRow(kv, 'Bố cục', 'version ' + t.version + (t.layout && t.layout.detected !== t.version ? ' (nhận diện ' + t.layout.detected + ')' : '') + ' · kích thước struct: ' + Object.keys(t.struct_sizes).map(function (k) { return k + ' ' + t.struct_sizes[k] + ' B'; }).join(', '));
      kvRow(kv, 'Số lượng', t.counts.assemblies + ' assembly · ' + t.counts.images + ' image · ' + t.counts.namespaces + ' namespace · ' + t.counts.types + ' type · ' + t.counts.methods + ' method · ' + t.counts.fields + ' field');
      const pc = Object.keys(t.problem_counts).reduce(function (a, k) { return a + t.problem_counts[k]; }, 0);
      kvRow(kv, 'Bất thường', pc + ' (cấu trúc) · ' + t.name_problems.name_out_of_range + ' tên ngoài vùng · ' + t.name_problems.unterminated + ' tên không kết thúc · ' + t.name_problems.invalid_utf8 + ' UTF-8 sai');
    }
    card.appendChild(kv);
    if (t.status === 'ok') {
      const holder = h('div'), sel = h('select', { class: 'input', 'aria-label': 'Chọn bảng' });
      const views = {
        'Assembly': function () { return buildPagedTable(['#', 'Tên', 'Phiên bản', 'Image', 'Token'], t.assemblies, function (a) { return [String(a.index), a.name === null ? '(không đọc được)' : a.name, a.version, String(a.image_index), a.token === null ? '' : '0x' + a.token.toString(16).toUpperCase()]; }, function (a) { return a.name || ''; }, 'Tìm assembly'); },
        'Image': function () { return buildPagedTable(['#', 'Tên', 'Type bắt đầu', 'Số type'], t.images, function (a) { return [String(a.index), a.name === null ? '(không đọc được)' : a.name, String(a.type_start), String(a.type_count)]; }, function (a) { return a.name || ''; }, 'Tìm image'); },
        'Type / class': function () { return buildPagedTable(['#', 'Namespace', 'Tên', 'Loại', 'Hiển thị', 'Field', 'Method'], t.types, function (a) { return [String(a.index), a.namespace || '', a.name === null ? '(không đọc được)' : a.name, a.kind, a.visibility, String(a.field_count), String(a.method_count)]; }, function (a) { return (a.full_name || '') + ' ' + a.kind; }, 'Tìm type'); },
        'Method': function () { return buildPagedTable(['#', 'Type', 'Tên', 'Truy cập', 'Tham số', 'Token'], t.methods, function (a) { return [String(a.index), a.type_index >= 0 && t.types[a.type_index] ? t.types[a.type_index].full_name : '(không rõ)', a.name === null ? '(không đọc được)' : a.name, a.access + (a.is_static ? ' static' : ''), a.parameters.map(function (p) { return p.name; }).join(', '), '0x' + a.token.toString(16).toUpperCase()]; }, function (a) { return (a.name || '') + ' ' + (a.type_index >= 0 && t.types[a.type_index] ? t.types[a.type_index].full_name : ''); }, 'Tìm method'); },
        'Field': function () { return buildPagedTable(['#', 'Type', 'Tên', 'Chỉ số kiểu (thô)'], t.fields, function (a) { return [String(a.index), a.type_index >= 0 && t.types[a.type_index] ? t.types[a.type_index].full_name : '(không rõ)', a.name === null ? '(không đọc được)' : a.name, 'type#' + a.type_raw_index]; }, function (a) { return (a.name || '') + ' ' + (a.type_index >= 0 && t.types[a.type_index] ? t.types[a.type_index].full_name : ''); }, 'Tìm field'); }
      };
      Object.keys(views).forEach(function (k) { sel.appendChild(h('option', { value: k, text: k })); });
      const show = function () { holder.replaceChildren(views[sel.value]()); };
      sel.addEventListener('change', show);
      card.appendChild(h('div', { class: 'toolbar mt-2' }, [h('label', { class: 'dim', text: 'Xem: ' }), sel]));
      card.appendChild(holder); sel.value = 'Type / class'; show();
      if (t.problems.length) card.appendChild(listBlock('Bất thường cấu trúc (tối đa 200 dòng đầu)', t.problems.map(function (p) { return '[' + p.code + '] ' + p.message; }), 40));
    }
    card.appendChild(listBlock('Không có trong kết quả (có chủ đích)', t.not_extracted));
    card.appendChild(h('p', { class: 'dim mt-2', text: 'Bố cục lấy từ mã nguồn Il2CppDumper (xem metadata_tables.js). Dữ liệu trên là từ metadata, chưa đối chiếu với metadata của game thật. Tên kiểu của field/tham số là chỉ số thô vào bảng kiểu của binary, không được suy ra.' }));
    return card;
  }
  const FONT_ST = { extracted: 'Đã trích xuất', not_font_content: 'Nội dung không phải font', skipped_too_large: 'Bỏ qua: quá lớn', skipped_budget: 'Bỏ qua: hết hạn mức bộ nhớ', read_error: 'Lỗi đọc',
    unsafe_path: 'Đường dẫn không an toàn', symlink_not_followed: 'Symlink', encrypted_zip: 'Entry mã hóa ZIP', unsupported_method: 'Nén chưa hỗ trợ', pending: 'Chờ' };
  const FONT_RES = { ok: ['Hoàn tất', 'success'], no_fonts: ['Không tìm thấy font', 'warning'], partial: ['Hoàn tất một phần', 'warning'], error: ['Lỗi', 'danger'], not_run: ['Chưa chạy', ''] };
  let lastFonts = null, lastFontMetrics = null;
  function saveBlob(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function renderFonts(s) {
    const f = (s.results && s.results.fonts) || null, fmx = (s.results && s.results.fontMetrics) || null;
    if (f === lastFonts && fmx === lastFontMetrics) return; lastFonts = f; lastFontMetrics = fmx;
    const box = $('#fonts-body'), wrap = $('#fonts-detail'), empty = $('#fonts-empty'); if (!box || !wrap || !empty) return;
    box.replaceChildren(); wrap.hidden = !f && !fmx; empty.hidden = !!(f || fmx); if (!f && !fmx) return;
    if (!f) { const only = buildFontMetricsCard(fmx); if (only) box.appendChild(only); return; }
    const st = FONT_RES[f.status] || [f.status, ''], sm = f.summary || {};
    const kv = h('dl', { class: 'kv' });
    kv.appendChild(h('dt', { text: 'Trạng thái' })); kv.appendChild(h('dd', {}, [h('span', { class: 'badge ' + st[1], text: st[0] })]));
    kvRow(kv, 'Kết quả', f.reason);
    kvRow(kv, 'Nguồn ứng viên', f.source.manifest_used ? 'Đuôi file + magic bytes (manifest Phase 3)' : 'Chỉ theo đuôi file (không có manifest)');
    if (f.summary) {
      kvRow(kv, 'Ứng viên', sm.candidates + ' · đã trích xuất ' + sm.extracted + ' (' + formatBytes(sm.total_bytes) + ') · font hợp lệ ' + sm.fonts_valid + ' · lỗi cấu trúc/chưa xác minh ' + sm.invalid_or_unverified);
      kvRow(kv, 'Bị loại/bỏ qua', sm.not_font_content + ' không phải font · ' + sm.skipped + ' quá lớn/hết hạn mức · ' + sm.read_errors + ' lỗi đọc · ' + sm.unsafe_or_unreadable + ' không đọc được');
      kvRow(kv, 'Định dạng', Object.keys(sm.by_format).map(function (k) { return k + ': ' + sm.by_format[k]; }).join(' · ') || '—');
      kvRow(kv, 'Khác', sm.duplicates + ' trùng nội dung · ' + sm.ext_mismatch + ' sai đuôi · ' + sm.hash_mismatch + ' SHA-256 khác manifest');
    }
    box.appendChild(kv);
    if (f.items.length) {
      const files = (s.results && s.results.fontFiles) || {};
      box.appendChild(buildPagedTable(['#', 'Đường dẫn', 'Định dạng', 'Kích thước', 'Trạng thái', 'Hợp lệ', 'Ghi chú', 'Tải'], f.items, function (it) {
        const btn = h('button', { class: 'btn btn-sm', type: 'button', text: '⬇', 'aria-label': 'Tải ' + it.file_name });
        if (it.extracted_path && files[it.extracted_path]) btn.addEventListener('click', function () { saveBlob(it.file_name, files[it.extracted_path]); }); else btn.disabled = true;
        const notes = [].concat(it.problems, it.error ? [it.error] : [], it.duplicate_of ? ['trùng với ' + it.duplicate_of] : [], it.ext_mismatch ? ['sai đuôi'] : [], it.declared_in_plist ? ['có trong UIAppFonts'] : []);
        return [String(it.id), it.path, it.format || '—', formatBytes(it.size), FONT_ST[it.extraction_status] || it.extraction_status, it.valid === true ? 'Có' : it.valid === false ? 'Không' : 'Chưa xác minh', notes.join('; '), btn];
      }, function (it) { return it.path + ' ' + (it.format || '') + ' ' + it.extraction_status; }, 'Tìm font'));
    }
    if (f.app_fonts_check.length) box.appendChild(listBlock('UIAppFonts (Info.plist) đối chiếu với file thật', f.app_fonts_check.map(function (x) { return x.declared + ' → ' + (x.status === 'found' ? x.paths.join(', ') : 'KHÔNG THẤY FILE'); })));
    if (f.not_analyzed.unity_containers.count) box.appendChild(listBlock('Asset/bundle Unity có thể chứa font (chưa parse): ' + f.not_analyzed.unity_containers.count, f.not_analyzed.unity_containers.listed.map(function (x) { return x.path + ' (' + formatBytes(x.size) + ')'; }), 50));
    if (f.warnings.length) box.appendChild(listBlock('Cảnh báo', f.warnings));
    box.appendChild(listBlock('Chưa làm ở sub-phase 5.1 (có chủ đích)', f.limitations));
    const fmCard = buildFontMetricsCard(fmx); if (fmCard) box.appendChild(fmCard);
  }
  NS.UI_saveBlob = saveBlob;

  /* Thẻ metadata font + độ phủ tiếng Việt (5.2b+5.3). Chỉ nói cmap có ánh xạ; KHÔNG đảm bảo TMP/atlas của game hiển thị được. */
  const VI_LEVEL = { full: ['Đủ', 'ok'], partial: ['Thiếu', 'warn'], none: ['Không', 'err'], unknown: ['Chưa rõ', ''] };
  function buildFontMetricsCard(fm) {
    if (!fm || fm.status === 'not_run') return null;
    const card = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'Độ phủ tiếng Việt của font (5.2b + 5.3)' })]);
    if (fm.status === 'no_fonts' || !fm.summary) { card.appendChild(h('p', { class: 'dim', text: fm.reason || 'Không có font.' })); return card; }
    const s = fm.summary, kv = h('dl', { class: 'kv' });
    kvRow(kv, 'Kết quả', fm.reason);
    kvRow(kv, 'Tiêu chí', 'cmap có ánh xạ tới glyph khác 0 cho 134 ký tự Việt có dấu dựng sẵn (Ạ…ỹ, ă â ê ô ơ ư đ) và chữ cái A–Z a–z');
    card.appendChild(kv);
    const items = [];
    fm.items.forEach(function (it) {
      if (it.fonts.length) it.fonts.forEach(function (f) { items.push({ it: it, f: f }); }); else items.push({ it: it, f: null });
    });
    card.appendChild(buildPagedTable(['Font', 'Tiếng Việt', 'Thiếu', 'Họ font', 'Glyph', 'Nguồn'], items, function (x) {
      const f = x.f, it = x.it;
      const nm = it.path.split('/').pop() + (it.fonts.length > 1 && f ? ' #' + f.index : ''), src = it.source === 'unity_font' ? 'Unity' : 'IPA';
      if (!f) return [nm, it.status + (it.reason ? ' – ' + it.reason : ''), '', '—', '', src];
      const v = f.vietnamese, lv = VI_LEVEL[v.level] || [v.level, ''];
      return [nm, lv[0] + (v.covered !== null ? ' (' + v.covered + '/' + v.required + ')' : '') + (v.ascii_letters_ok === false ? ' · thiếu chữ ASCII' : ''), v.missing_count ? v.missing.slice(0, 6).join(' ') + (v.missing_count > 6 ? ' … (' + v.missing_count + ')' : '') : '',
        f.names.family || f.names.postscript || '—', f.num_glyphs === null ? '' : String(f.num_glyphs), src];
    }, function (x) { return x.it.path + ' ' + (x.f ? (x.f.names.family || '') + ' ' + x.f.vietnamese.level : x.it.status); }, 'Tìm font'));
    const probs = []; fm.items.forEach(function (it) { it.problems.forEach(function (p) { probs.push(it.path + ': ' + p); }); it.fonts.forEach(function (f) { f.problems.forEach(function (p) { probs.push(it.path + ': ' + p); }); }); });
    if (probs.length) card.appendChild(listBlock('Vấn đề trong font', probs, 30));
    if (fm.warnings.length) card.appendChild(listBlock('Cảnh báo', fm.warnings));
    card.appendChild(listBlock('Chưa làm', fm.limitations));
    return card;
  }
  let lastUnity = null, lastUnityFs = null, lastSerialized = null;

  /* Thẻ SerializedFile (sub-phase 5.2c): thống kê object, TextAsset/font nhúng đã trích, MonoBehaviour theo class. Chưa giải mã MonoBehaviour/TMP/Texture. */
  const SF_STATUS = { parsed: 'Đọc được', not_serialized: 'Không giống SerializedFile', unsupported_version: 'Version chưa hỗ trợ', unsupported_typetree: 'Type tree kiểu cũ', invalid: 'Cấu trúc không hợp lệ', truncated: 'Bị cắt cụt', too_large: 'Quá lớn', read_error: 'Lỗi đọc' };
  function buildSerializedCard(sr, files) {
    if (!sr || sr.status === 'not_run') return null;
    const card = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'SerializedFile (sub-phase 5.2c)' })]);
    if (sr.status === 'no_serialized' || !sr.summary) { card.appendChild(h('p', { class: 'dim', text: sr.reason || 'Không có SerializedFile.' })); return card; }
    const s = sr.summary, kv = h('dl', { class: 'kv' });
    kvRow(kv, 'Kết quả', sr.reason);
    kvRow(kv, 'File / đọc được', s.files + ' / ' + s.parsed + ' · ' + s.objects + ' object · version ' + Object.keys(s.versions).join(', '));
    kvRow(kv, 'Phiên bản Unity (từ header file)', s.unity_versions.join(', ') || 'Không đọc được');
    kvRow(kv, 'TextAsset', s.text_assets_extracted + ' trích xuất / ' + s.text_assets + ' (' + s.text_assets_text + ' là văn bản UTF-8)');
    kvRow(kv, 'Font trong object Font', s.fonts_extracted + ' trích xuất (' + s.fonts_valid + ' hợp lệ) / ' + s.fonts);
    kvRow(kv, 'MonoBehaviour', s.monobehaviours_resolved + ' quy về class script · ' + s.monobehaviours_unresolved + ' chưa xác định');
    card.appendChild(kv);
    const top = Object.keys(s.by_class).sort(function (a, b) { return s.by_class[b] - s.by_class[a]; });
    card.appendChild(buildPagedTable(['Loại object', 'Số lượng'], top, function (k) { return [k, String(s.by_class[k])]; }, function (k) { return k; }, 'Tìm loại'));
    const mono = Object.keys(sr.mono_classes).sort(function (a, b) { return sr.mono_classes[b] - sr.mono_classes[a]; });
    if (mono.length) card.appendChild(buildPagedTable(['Class script (MonoBehaviour)', 'Số lượng'], mono, function (k) { return [k, String(sr.mono_classes[k])]; }, function (k) { return k; }, 'Tìm class'));
    card.appendChild(buildPagedTable(['File', 'Trạng thái', 'Version', 'Object', 'Trích xuất'], sr.files, function (it) {
      return [it.path, (SF_STATUS[it.status] || it.status) + (it.status !== 'parsed' && it.reason ? ' – ' + it.reason : ''), it.version === null ? '' : String(it.version), it.object_count === null ? '' : String(it.object_count), it.extraction || ''];
    }, function (it) { return it.path + ' ' + it.status; }, 'Tìm file'));
    const dlBtn = function (rec) {
      const b = h('button', { class: 'btn btn-sm', type: 'button', text: '⬇', 'aria-label': 'Tải ' + (rec.name || 'tệp') });
      if (rec.extracted_path && files && files[rec.extracted_path]) b.addEventListener('click', function () { saveBlob(rec.extracted_path.split('/').pop(), files[rec.extracted_path]); }); else b.disabled = true; return b;
    };
    if (sr.text_assets.length) card.appendChild(buildPagedTable(['TextAsset', 'Nguồn', 'Kích thước', 'Loại', ''], sr.text_assets, function (t) {
      return [t.name || '(không tên)', t.source, formatBytes(t.size), t.extraction_status === 'extracted' ? (t.is_text ? 'văn bản' : 'nhị phân') : t.extraction_status + (t.problem ? ' – ' + t.problem : ''), dlBtn(t)];
    }, function (t) { return t.name + ' ' + t.source; }, 'Tìm TextAsset'));
    if (sr.fonts.length) card.appendChild(buildPagedTable(['Font (Unity)', 'Nguồn', 'Định dạng', 'Hợp lệ', ''], sr.fonts, function (t) {
      return [t.name || '(không tên)', t.source, t.format || t.extraction_status, t.valid === true ? 'có' : t.valid === false ? 'không: ' + t.problems.join('; ') : '?', dlBtn(t)];
    }, function (t) { return t.name + ' ' + t.source; }, 'Tìm font'));
    const probs = []; sr.files.forEach(function (it) { it.problems.forEach(function (p) { probs.push(it.path + ': ' + p); }); });
    if (probs.length) card.appendChild(listBlock('Vấn đề trong file', probs, 30));
    if (sr.warnings.length) card.appendChild(listBlock('Cảnh báo', sr.warnings));
    card.appendChild(listBlock('Chưa làm', sr.limitations));
    return card;
  }

  /* Thẻ AssetBundle UnityFS (sub-phase 5.2a): CHỈ container (header/block/node); nội dung node chưa parse. */
  const UFS_STATUS = { parsed: 'Đọc được container', not_unityfs: 'Không phải UnityFS', unsupported_format: 'Định dạng cũ (chưa hỗ trợ)', unsupported_version: 'Phiên bản UnityFS lạ', unsupported_compression: 'Kiểu nén chưa hỗ trợ',
    decompress_failed: 'Giải nén bảng info lỗi', invalid: 'Cấu trúc không hợp lệ', truncated: 'Bị cắt cụt', too_large: 'Quá lớn để đọc', read_error: 'Lỗi đọc entry' };
  function buildUnityFsCard(uf) {
    if (!uf || uf.status === 'not_run') return null;
    const card = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'AssetBundle UnityFS (sub-phase 5.2a)' })]);
    if (uf.status === 'no_bundles' || !uf.summary) { card.appendChild(h('p', { class: 'dim', text: uf.reason || 'Không có AssetBundle.' })); return card; }
    const s = uf.summary, kv = h('dl', { class: 'kv' });
    kvRow(kv, 'Kết quả', uf.reason);
    kvRow(kv, 'Bundle / đọc được', s.bundles + ' / ' + s.parsed + ' · ' + s.nodes + ' node (' + s.serialized_nodes + ' đánh dấu SerializedFile) · ' + formatBytes(s.total_uncompressed) + ' sau giải nén');
    kvRow(kv, 'Kiểu nén bảng info', Object.keys(s.by_compression).map(function (k) { return k + ' ×' + s.by_compression[k]; }).join(', ') || '—');
    kvRow(kv, 'Phiên bản Unity (từ header bundle)', s.unity_revisions.join(', ') || 'Không đọc được');
    card.appendChild(kv);
    card.appendChild(h('p', { class: 'dim mt-2', text: 'Chỉ mới đọc container (header, block, node). Nội dung node chưa được giải nén/parse nên CHƯA biết bên trong có TextAsset, Font hay TMP hay không.' }));
    card.appendChild(buildPagedTable(['Bundle', 'Trạng thái', 'Revision', 'Nén', 'Block', 'Node', 'Kích thước'], uf.items, function (it) {
      return [it.path, (UFS_STATUS[it.status] || it.status) + (it.status !== 'parsed' && it.reason ? ' – ' + it.reason : ''), it.unity_revision || '', it.compression ? it.compression.name : '', it.block_count === null ? '' : String(it.block_count), it.node_count === null ? '' : String(it.node_count), formatBytes(it.size)];
    }, function (it) { return it.path + ' ' + it.status; }, 'Tìm bundle'));
    const nodes = []; uf.items.forEach(function (it) { it.nodes.forEach(function (n) { nodes.push({ b: it.path, n: n }); }); });
    if (nodes.length) card.appendChild(buildPagedTable(['Bundle', 'Node', 'Offset', 'Kích thước', 'Serialized'], nodes, function (x) { return [x.b, x.n.path + (x.n.unsafe_path ? ' ⚠ ' + x.n.unsafe_path : ''), String(x.n.offset), formatBytes(x.n.size), x.n.is_serialized ? 'có (cờ)' : ''] }, function (x) { return x.b + ' ' + x.n.path; }, 'Tìm node'));
    const probs = []; uf.items.forEach(function (it) { it.problems.concat(it.notes).forEach(function (p) { probs.push(it.path + ': ' + p); }); });
    if (probs.length) card.appendChild(listBlock('Vấn đề/ghi chú trong bundle', probs, 30));
    if (uf.warnings.length) card.appendChild(listBlock('Cảnh báo', uf.warnings));
    card.appendChild(listBlock('Chưa làm', uf.limitations));
    return card;
  }
  function renderUnity(s) {
    const u = (s.results && s.results.unity) || null, uf = (s.results && s.results.unityfs) || null, sr = (s.results && s.results.serialized) || null, srFiles = (s.results && s.results.serializedFiles) || null;
    if (u === lastUnity && uf === lastUnityFs && sr === lastSerialized) return;
    lastUnity = u; lastUnityFs = uf; lastSerialized = sr;
    const box = $('#unity-body'), wrap = $('#unity-detail'), empty = $('#unity-empty');
    if (!box || !wrap || !empty) return;
    box.replaceChildren(); wrap.hidden = !u && !uf && !sr; empty.hidden = !!(u || uf || sr);
    if (!u) { const o1 = buildUnityFsCard(uf), o2 = buildSerializedCard(sr, srFiles); if (o1) box.appendChild(o1); if (o2) box.appendChild(o2); return; }   // AssetBundle có thể tồn tại dù Phase 4.1 không kết luận Unity

    const st = UNITY_STATUS[u.status] || ['', ''];
    const info = h('dl', { class: 'kv' });
    info.appendChild(h('dt', { text: 'Kết luận' }));
    info.appendChild(h('dd', {}, [h('span', { class: 'badge ' + st[1], text: st[0] })]));
    kvRow(info, 'Engine (Phase 2)', u.engine ? u.engine.engine + (u.engine.variant ? ' ' + u.engine.variant : '') + ' · ' + u.engine.status : 'Không có');
    kvRow(info, 'Biến thể runtime', ({ IL2CPP: 'IL2CPP', Mono: 'Mono', conflict: 'Xung đột (có cả IL2CPP và Mono)', unresolved: 'Chưa xác định', not_applicable: 'Không áp dụng' })[u.runtime.value] || u.runtime.value);
    kvRow(info, 'Phiên bản Unity', u.unity_version ? u.unity_version.value + ' (đọc từ ' + u.unity_version.source + ')' : 'Không đọc được từ dữ liệu');
    kvRow(info, 'Binary chính', u.main_binary ? u.main_binary.path + ' · ' + (u.main_binary.archs.join(', ') || '?') + (u.main_binary.encrypted === true ? ' · MÃ HÓA FairPlay' : u.main_binary.encrypted === false ? ' · không mã hóa' : ' · không rõ mã hóa') : 'Không đọc được');
    kvRow(info, 'Nguồn dữ liệu', u.source.kind === 'manifest' ? 'Manifest Phase 3 (' + u.source.rows + ' file trong .app' + (u.source.hash_mode ? ', chế độ ' + u.source.hash_mode : '') + ')' : 'Chỉ danh sách entry (không có manifest)');
    const head = h('div', { class: 'card' }, [h('h2', { class: 'section-title', text: 'Kết quả dò Unity' }), info]);
    if (u.runtime.evidence.length) {
      head.appendChild(listBlock('Bằng chứng phân biệt IL2CPP/Mono', u.runtime.evidence.map(function (e) { return e.label + ' — ' + e.files + ' file' + (e.example ? ' (vd ' + e.example + ')' : ''); })));
    }
    box.appendChild(head);

    const comp = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'Thành phần Unity (' + u.components_found + '/' + u.components_total + ' nhóm có mặt)' })]);
    u.components.forEach(function (c) {
      if (!c.found) return;
      const items = c.samples.map(function (x) { return x.path + ' — ' + formatBytes(x.size) + (x.detected_format ? ' · ' + x.detected_format : ''); });
      if (c.truncated) items.push('… (chỉ liệt kê ' + c.samples.length + ' / ' + c.files + ' file)');
      comp.appendChild(listBlock(c.label + ' — ' + c.files + ' file, ' + formatBytes(c.bytes), items, 40));
      if (c.note) comp.appendChild(h('p', { class: 'dim', text: c.note }));
    });
    const missing = u.components.filter(function (c) { return !c.found; }).map(function (c) { return c.label; });
    comp.appendChild(listBlock('Không tìm thấy', missing));
    box.appendChild(comp);

    const ms = META_STATUS[u.metadata_input.status] || ['', ''];
    const mi = h('dl', { class: 'kv' });
    mi.appendChild(h('dt', { text: 'Trạng thái' }));
    mi.appendChild(h('dd', {}, [h('span', { class: 'badge ' + ms[1], text: ms[0] })]));
    kvRow(mi, 'File đầu vào', u.metadata_input.path);
    kvRow(mi, 'Lý do', u.metadata_input.reason);
    const mc = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'File global-metadata.dat đầu vào' }), mi]);
    if (u.metadata_input.candidates.length) {
      mc.appendChild(listBlock('Ứng viên', u.metadata_input.candidates.map(function (c) {
        return c.path + ' — ' + formatBytes(c.size) + ' · magic: ' + (c.magic_bytes ? c.magic_bytes.split(' ').slice(0, 8).join(' ') : 'chưa đọc') + (c.magic_matches === true ? ' (khớp IL2CPP)' : c.magic_matches === false ? ' (KHÔNG khớp)' : '')
          + (c.phase2_probe_version !== null ? ' · probe Phase 2: v' + c.phase2_probe_version : '') + (c.extraction_status && c.extraction_status !== 'ok' ? ' · ' + c.extraction_status : '');
      })));
    }
    mc.appendChild(h('p', { class: 'dim mt-2', text: 'Phiên bản “probe Phase 2” chỉ là số đọc nhanh từ 8 byte đầu, chưa phải kiểm tra hợp lệ; kết quả kiểm tra header nằm ở thẻ bên dưới (sub-phase 4.2).' }));
    box.appendChild(mc);
    box.appendChild(buildMetaHeaderCard(u.metadata_header));
    box.appendChild(buildLiteralsCard(u.metadata_literals));
    box.appendChild(buildTablesCard(u.metadata_tables));
    const ufCard = buildUnityFsCard(uf); if (ufCard) box.appendChild(ufCard);
    const sfCard = buildSerializedCard(sr, srFiles); if (sfCard) box.appendChild(sfCard);

    if (u.warnings.length || u.notes.length) {
      box.appendChild(h('div', { class: 'card mt-3' }, [
        u.warnings.length ? listBlock('Cảnh báo', u.warnings) : null,
        u.notes.length ? listBlock('Ghi chú', u.notes) : null
      ]));
    }
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
