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
    texts:        { title: 'Text trích xuất', icon: 'Aa', phase: 6 },
    pakheads:     { title: 'File .pak',      icon: '▤', phase: 6 },
    candidates:   { title: 'Hệ ứng viên',    icon: '◎', phase: 6 },
    text:         { title: 'Văn bản',        icon: '✎', phase: 6, empty: 'Chưa có chuỗi nào được trích xuất.' },
    localization: { title: 'Localization',   icon: '🌐', phase: 6 },
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
    renderCandidates(s);
    renderPakHeads(s);
    renderTexts(s);
    renderLocalization(s);
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
  let lastFonts = null, lastFontMetrics = null, lastTmp = null, lastPakFonts = null;
  function saveBlob(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  const CAND_RES = { ok: ['Hoàn tất', 'success'], no_candidates: ['Không thấy ứng viên', 'warning'], error: ['Lỗi', 'danger'], not_run: ['Chưa chạy', ''] };
  let lastCandidates = null;
  function renderCandidates(s) {
    const c = (s.results && s.results.candidates) || null;
    if (c === lastCandidates) return; lastCandidates = c;
    const box = $('#candidates-body'), wrap = $('#candidates-detail'), empty = $('#candidates-empty'); if (!box || !wrap || !empty) return;
    box.replaceChildren(); wrap.hidden = !c; empty.hidden = !!c; if (!c) return;
    const st = CAND_RES[c.status] || [c.status, ''], sm = c.summary || {};
    const kv = h('dl', { class: 'kv' });
    kv.appendChild(h('dt', { text: 'Trạng thái' })); kv.appendChild(h('dd', {}, [h('span', { class: 'badge ' + st[1], text: st[0] })]));
    kvRow(kv, 'Kết quả', c.reason);
    kvRow(kv, 'Cổng 0', c.gate0 && c.gate0.done ? 'Đã chạy' : 'CHƯA chạy – mọi ứng viên là HYPOTHESIS/UNKNOWN; chỉ canary trên thiết bị mới chứng minh hệ nào hiển thị');
    if (c.summary) kvRow(kv, 'Tổng', sm.total + ' ứng viên · có thông tin ngôn ngữ ' + sm.with_languages + ' · nghi là hệ phụ ' + sm.suspected_secondary);
    box.appendChild(kv);
    (c.detector_errors || []).forEach(function (e) { box.appendChild(h('p', { class: 'badge danger', text: 'Detector lỗi: ' + e.id + ' – ' + e.message })); });
    if (!c.candidates.length) return;
    const tbl = h('table', { class: 'tbl' });
    tbl.appendChild(h('thead', {}, [h('tr', {}, ['#', 'Hệ', 'Cấp', 'Ngôn ngữ', 'Số file', 'UI', 'Bằng chứng'].map(function (t) { return h('th', { text: t }); }))]));
    const tb = h('tbody');
    c.candidates.slice(0, 200).forEach(function (x) {
      const langs = x.languages.map(function (l) { return l.code; }).filter(Boolean).join(', ') || '—';
      tb.appendChild(h('tr', {}, [
        h('td', { text: String(x.rank) }), h('td', { text: x.kind + (x.suspected_secondary ? ' (nghi hệ phụ)' : '') }), h('td', { text: x.level }),
        h('td', { text: langs }), h('td', { text: String(x.paths_total) }), h('td', { text: x.ui_status }), h('td', { text: '[' + x.evidence + ']' })]));
    });
    tbl.appendChild(tb);
    const scroll = h('div', { class: 'table-wrap' }); scroll.appendChild(tbl); box.appendChild(scroll);
    if (c.candidates.length > 200) box.appendChild(h('p', { text: 'Chỉ hiện 200 ứng viên đầu; tải candidates.json để xem đủ.' }));
  }
  const State = function () { return NS.State.get(); };
  let lastTexts = null;
  function renderTexts(s) {
    const t = (s.results && s.results.texts) || null;
    if (t === lastTexts) return; lastTexts = t;
    const box = $('#texts-body'), wrap = $('#texts-detail'), empty = $('#texts-empty'); if (!box || !wrap || !empty) return;
    box.replaceChildren(); wrap.hidden = !t; empty.hidden = !!t; if (!t) return;
    const sm = t.summary || {}, kv = h('dl', { class: 'kv' });
    kv.appendChild(h('dt', { text: 'Trạng thái' })); kv.appendChild(h('dd', {}, [h('span', { class: 'badge ' + (t.status === 'ok' ? 'success' : 'warning'), text: t.status === 'ok' ? 'Hoàn tất' : 'Không có text' })]));
    kvRow(kv, 'Kết quả', t.reason);
    if (t.summary) {
      kvRow(kv, 'Ngôn ngữ', Object.keys(sm.by_lang).map(function (k) { return k + ' ×' + sm.by_lang[k]; }).join(', ') || '—');
      kvRow(kv, 'Định dạng', Object.keys(sm.by_format).map(function (k) { return k + ' ×' + sm.by_format[k]; }).join(', ') || '—');
      kvRow(kv, 'Kiểm tra', 'có placeholder ' + sm.with_placeholders + ' · độ tin cậy thấp (giống ID/đường dẫn) ' + sm.low_confidence + ' · khóa trùng ' + sm.duplicate_keys + ' · file bị bỏ ' + sm.skipped + ' · chưa hỗ trợ ' + sm.unsupported);
      kvRow(kv, 'Font trong pak', sm.pak_fonts_ok + '/' + sm.pak_fonts + ' hợp lệ (magic) · font/atlas liệt kê: ' + ((t.font_inventory || []).length) + (t.font_inventory && t.font_inventory.length ? ' (' + t.font_inventory.slice(0, 6).map(function (f) { return f.path; }).join(', ') + (t.font_inventory.length > 6 ? '…' : '') + ')' : ''));
    }
    kvRow(kv, 'Lưu ý', 'Là text có trong file; việc game có hiển thị hay không là giả thuyết (chưa Cổng 0).');
    box.appendChild(kv);
    (t.warnings || []).forEach(function (w) { box.appendChild(h('p', { class: 'badge warning', text: w })); });
    (t.unsupported || []).forEach(function (u) { box.appendChild(h('p', { class: 'badge', text: 'Chưa hỗ trợ: ' + u.file + ' – ' + u.reason })); });
    if (!t.rows.length) return;
    box.appendChild(buildTranslationEditor(t));
  }

  /* ---- Trình soạn bản dịch (6): dịch ngay trong bảng, kiểm placeholder trực tiếp ---- */
  let trMap = {}, trTexts = null, trRefresh = null;
  function trCounts() {
    const A = NS.TranslationApply; let done = 0, err = 0, warn = 0;
    Object.keys(trMap).forEach(function (i) { const r = trTexts.rows[i]; done++; const is = A.checkRow(r.text, trMap[i]); if (is.some(function (x) { return x.level === 'error'; })) err++; else if (is.length) warn++; });
    return { done: done, err: err, warn: warn };
  }
  function buildTranslationEditor(t) {
    if (trTexts !== t) { trTexts = t; trMap = {}; }
    const A = NS.TranslationApply, PAGE = 50; let page = 0, q = '', mode = 'all', fileSel = '';
    const files = []; t.rows.forEach(function (r) { const k = r.container + ' | ' + r.file; if (files.indexOf(k) < 0) files.push(k); });
    const input = h('input', { type: 'search', class: 'input', placeholder: 'Tìm khóa/text/bản dịch…', 'aria-label': 'Tìm text' });
    const selMode = h('select', { class: 'input', 'aria-label': 'Lọc trạng thái' }, [['all', 'Tất cả'], ['todo', 'Chưa dịch'], ['done', 'Đã dịch'], ['bad', 'Có lỗi/cảnh báo']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    const selFile = h('select', { class: 'input', 'aria-label': 'Lọc theo file' }, [h('option', { value: '', text: 'Mọi file (' + files.length + ')' })].concat(files.slice(0, 500).map(function (f) { return h('option', { value: f, text: f.length > 70 ? '…' + f.slice(-69) : f }); })));
    const info = h('span', { class: 'dim' }), stat = h('span', { class: 'badge' }), prev = h('button', { class: 'btn btn-sm', type: 'button', text: '‹' }), next = h('button', { class: 'btn btn-sm', type: 'button', text: '›' });
    const tbody = h('tbody'), table = h('table', { class: 'tbl' }, [h('thead', {}, [h('tr', {}, ['Ng.ngữ', 'File · Khóa', 'Bản gốc', 'Bản dịch', 'Kiểm tra'].map(function (x) { return h('th', { text: x }); }))]), tbody]);
    const status = function (i) { const v = trMap[i]; if (v === undefined) return null; return A.checkRow(trTexts.rows[i].text, v); };
    const badgeFor = function (iss, el) {
      el.className = 'badge ' + (!iss ? '' : iss.some(function (x) { return x.level === 'error'; }) ? 'danger' : iss.length ? 'warning' : 'success');
      el.textContent = !iss ? '—' : iss.length ? iss.map(function (x) { return x.msg; }).join('; ') : 'OK'; el.title = el.textContent;
    };
    const updStat = function () { const c = trCounts(); stat.textContent = 'Đã dịch ' + c.done + '/' + t.rows.length + (c.err ? ' · ' + c.err + ' lỗi' : '') + (c.warn ? ' · ' + c.warn + ' cảnh báo' : ''); stat.className = 'badge ' + (c.err ? 'danger' : c.done ? 'success' : ''); };
    const draw = function () {
      const ql = q.toLowerCase(), idx = [];
      for (let i = 0; i < t.rows.length; i++) {
        const r = t.rows[i]; if (fileSel && (r.container + ' | ' + r.file) !== fileSel) continue;
        const v = trMap[i];
        if (mode === 'todo' && v !== undefined) continue; if (mode === 'done' && v === undefined) continue;
        if (mode === 'bad') { if (v === undefined) continue; const is = A.checkRow(r.text, v); if (!is.length) continue; }
        if (ql && (r.key + ' ' + r.text + ' ' + r.file + ' ' + (v || '')).toLowerCase().indexOf(ql) < 0) continue;
        idx.push(i);
      }
      const pages = Math.max(1, Math.ceil(idx.length / PAGE)); if (page >= pages) page = pages - 1;
      tbody.replaceChildren();
      idx.slice(page * PAGE, page * PAGE + PAGE).forEach(function (i) {
        const r = t.rows[i], ta = h('textarea', { class: 'input', rows: String(Math.min(6, Math.max(2, r.text.split('\n').length))), 'aria-label': 'Bản dịch ' + r.key, spellcheck: 'false' }), bd = h('span', { class: 'badge' });
        ta.value = trMap[i] !== undefined ? trMap[i] : ''; badgeFor(status(i), bd);
        ta.addEventListener('input', function () { if (ta.value === '') delete trMap[i]; else trMap[i] = ta.value; badgeFor(status(i), bd); updStat(); });
        const conf = r.confidence === 'low' ? ' (giống ID/đường dẫn)' : '';
        tbody.appendChild(h('tr', {}, [h('td', { class: 'path', text: r.lang || '—' }), h('td', { class: 'path', text: r.file + ' · ' + r.key + conf }), h('td', { class: 'path', text: r.text.length > 400 ? r.text.slice(0, 400) + '…' : r.text }), h('td', {}, [ta]), h('td', {}, [bd])]));
      });
      info.textContent = idx.length + ' / ' + t.rows.length + ' dòng · trang ' + (page + 1) + '/' + pages; prev.disabled = page === 0; next.disabled = page >= pages - 1; updStat();
    };
    input.addEventListener('input', function () { q = input.value; page = 0; draw(); });
    selMode.addEventListener('change', function () { mode = selMode.value; page = 0; draw(); });
    selFile.addEventListener('change', function () { fileSel = selFile.value; page = 0; draw(); });
    prev.addEventListener('click', function () { page--; draw(); }); next.addEventListener('click', function () { page++; draw(); });
    trRefresh = draw; draw();
    const sc = h('div', { class: 'table-wrap' }); sc.appendChild(table);
    return h('div', { class: 'mt-3' }, [h('div', { class: 'toolbar' }, [input, selMode, selFile, prev, next, info, h('span', { class: 'spacer' }), stat]), sc]);
  }
  function trNeedRows() { const t = (State().session.results || {}).texts || null; return t && t.rows && t.rows.length ? t : null; }
  NS.UI_importTranslations = function (csvText) {
    const t = trNeedRows(); if (!t) { toast('Chưa có text trích xuất', 'warning'); return; }
    if (trTexts !== t) { trTexts = t; trMap = {}; }
    const r = NS.TranslationApply.mergeCsv(t, csvText);
    if (r.problems.length) { toast('CSV không hợp lệ: ' + r.problems.join('; '), 'error', 7000); return; }
    Object.keys(r.map).forEach(function (i) { trMap[i] = r.map[i]; });
    toast('Đã nạp ' + r.matched + ' bản dịch' + (r.unmatched.length ? '; ' + r.unmatched.length + ' dòng không khớp (dòng đầu: CSV dòng ' + r.unmatched[0].line + ' – ' + r.unmatched[0].reason + ')' : ''), r.unmatched.length ? 'warning' : 'success', 7000);
    if (trRefresh) trRefresh();
  };
  NS.UI_exportTranslated = function () {
    const t = trNeedRows(); if (!t) { toast('Chưa có text trích xuất', 'warning'); return; }
    saveBlob('texts_translated.csv', NS.TranslationApply.toTranslatedCsv(t, trMap), 'text/csv;charset=utf-8');
  };
  NS.UI_applyTranslations = function () {
    const t = trNeedRows(); if (!t) { toast('Chưa có text trích xuất', 'warning'); return; }
    if (!t._src || !t._src.length) { toast('Không còn file gốc trong phiên này – hãy phân tích lại IPA', 'warning'); return; }
    if (!Object.keys(trMap).length) { toast('Chưa có bản dịch nào (dịch trong bảng hoặc nạp CSV)', 'warning'); return; }
    const b = NS.TranslationApply.build(t, NS.TranslationApply.toTranslatedCsv(t, trMap), {}), r = b.report;
    if (r.status !== 'ok') { toast('Không áp dụng được dòng nào (' + r.errors.length + ' lỗi placeholder; ' + r.files.length + ' file không ghi được)', 'warning', 7000); return; }
    toast('Đã áp dụng ' + r.summary.applied_rows + ' dòng vào ' + r.summary.files_applied + ' file; ' + r.errors.length + ' dòng lỗi bị chặn; ' + r.summary.files_not_applied + ' file không ghi được', r.errors.length || r.summary.files_not_applied ? 'warning' : 'success', 7000);
    saveBlob('translated.zip', NS.PakHeads.buildZip(b.files), 'application/zip');
  };
  /* ---- Localization: ngôn ngữ có trong game + so khớp nguồn → đích ---- */
  let lastLocTexts = null, locAn = null, locSel = { source: null, target: 'vi', refs: {} };
  function renderLocalization(s) {
    const t = (s.results && s.results.texts) || null, cand = (s.results && s.results.candidates) || null;
    if (t === lastLocTexts) return; lastLocTexts = t;
    const box = $('#loc-body'), wrap = $('#loc-detail'), empty = $('#loc-empty'); if (!box || !wrap || !empty) return;
    box.replaceChildren(); locAn = t && t.rows && t.rows.length ? NS.Localization.analyze(t) : null;
    wrap.hidden = !locAn; empty.hidden = !!locAn; if (!locAn) return;
    const L = NS.Localization, an = locAn; locSel = { source: an.base, target: 'vi', refs: {} };
    const hasVi = an.languages.some(function (l) { return l.code === 'vi'; });
    const kv = h('dl', { class: 'kv' });
    kvRow(kv, 'Ngôn ngữ nhận ra', an.languages.length + ' (' + an.languages.map(function (l) { return l.code; }).join(', ') + ') · ' + an.unknown_lang_rows + ' dòng không rõ ngôn ngữ');
    kvRow(kv, 'Tiếng Việt (vi)', hasVi ? 'Đã có trong game (' + an.languages.filter(function (l) { return l.code === 'vi'; })[0].keys + ' khóa)' : 'Chưa có trong text đã trích – cần dịch từ ngôn ngữ nguồn');
    kvRow(kv, 'Lưu ý', 'Ghép “cùng khóa giữa các ngôn ngữ” là heuristic theo đường dẫn/khóa. Mẫu dịch sẽ ghi đè lên file của ngôn ngữ nguồn; chưa tạo được file ngôn ngữ mới (vd. vi.lproj).');
    box.appendChild(kv);
    const base = an.languages.filter(function (l) { return l.code === an.base; })[0];
    box.appendChild(buildPagedTable(['Ngôn ngữ', 'Khóa', 'Dòng', 'File', 'So với ' + an.base, 'Định dạng'], an.languages, function (l) {
      return [l.code, String(l.keys), String(l.rows), String(l.files), base && base.keys ? Math.round(l.keys * 100 / base.keys) + '%' : '—', l.formats.join(', ')];
    }, function (l) { return l.code; }, 'Tìm ngôn ngữ'));
    const cl = cand && cand.candidates ? cand.candidates.filter(function (c) { return c.languages && c.languages.length; }) : [];
    if (cl.length) box.appendChild(listBlock('Bảng ngôn ngữ nhận diện bởi hệ ứng viên', cl.map(function (c) { return c.kind + ' (' + c.level + '): ' + c.languages.map(function (l) { return l.code + (l.termCount != null ? ' ×' + l.termCount : ''); }).join(', '); }), 100));
    /* so khớp */
    const codes = an.languages.map(function (l) { return l.code; }); if (codes.indexOf('vi') < 0) codes.push('vi');
    const mkSel = function (label, val, cb) { const sel = h('select', { class: 'input', 'aria-label': label }, codes.map(function (c) { return h('option', { value: c, text: c }); })); sel.value = val; sel.addEventListener('change', function () { cb(sel.value); }); return sel; };
    const out = h('div', { class: 'mt-3' }), refsBox = h('span', {});
    const draw = function () {
      out.replaceChildren(); const c = L.compare(t, an, locSel.source, locSel.target);
      out.appendChild(h('h3', { class: 'section-title', text: 'So khớp ' + c.source + ' → ' + c.target }));
      const k2 = h('dl', { class: 'kv' });
      kvRow(k2, 'Khóa ở nguồn', c.source_keys); kvRow(k2, 'Đã có ở đích', c.present + (c.coverage_pct != null ? ' (' + c.coverage_pct + '%)' : ''));
      kvRow(k2, 'Chưa có ở đích', c.missing.length); kvRow(k2, 'Có nhưng y nguyên nguồn (nghi chưa dịch)', c.identical.length); kvRow(k2, 'Chỉ có ở đích', c.extra_in_target);
      out.appendChild(k2);
      const refs = Object.keys(locSel.refs).filter(function (x) { return locSel.refs[x] && x !== c.source && x !== c.target; });
      const mkBtn = function (label, idx, name) { const b = h('button', { class: 'btn btn-sm', type: 'button', text: label + ' (' + idx.length + ')' }); b.disabled = !idx.length; b.addEventListener('click', function () { saveBlob(name, L.toTemplateCsv(t, an, idx, refs), 'text/csv;charset=utf-8'); }); return b; };
      out.appendChild(h('div', { class: 'toolbar' }, [mkBtn('Tải mẫu dịch: khóa chưa có', c.missing, 'localization_missing_' + c.target + '.csv'), mkBtn('Tải mẫu: khóa nghi chưa dịch', c.identical, 'localization_untranslated_' + c.target + '.csv'), mkBtn('Tải mẫu: cả hai', c.missing.concat(c.identical).sort(function (a, b) { return a - b; }), 'localization_all_' + c.target + '.csv')]));
      const files = Object.keys(c.by_file).sort(function (a, b) { return c.by_file[b] - c.by_file[a]; });
      if (files.length) out.appendChild(listBlock('Khóa chưa có ở đích, theo file', files.map(function (f) { return f + ' — ' + c.by_file[f]; }), 100));
      out.appendChild(h('p', { class: 'dim', text: 'Dịch xong, mở “Text trích xuất” → “Nạp CSV đã dịch” → “Áp dụng bản dịch”.' }));
    };
    const drawRefs = function () {
      refsBox.replaceChildren(); refsBox.appendChild(h('span', { class: 'dim', text: ' Tham khảo: ' }));
      codes.filter(function (c2) { return c2 !== locSel.source && c2 !== locSel.target && an.languages.some(function (l) { return l.code === c2; }); }).forEach(function (c2) {
        const cb = h('input', { type: 'checkbox', 'aria-label': 'Tham khảo ' + c2 }); cb.checked = !!locSel.refs[c2]; cb.addEventListener('change', function () { locSel.refs[c2] = cb.checked; draw(); });
        refsBox.appendChild(h('label', { class: 'dim' }, [cb, document.createTextNode(' ' + c2 + '  ')]));
      });
    };
    box.appendChild(h('div', { class: 'toolbar mt-3' }, [h('span', { class: 'dim', text: 'Nguồn' }), mkSel('Ngôn ngữ nguồn', locSel.source, function (v) { locSel.source = v; drawRefs(); draw(); }), h('span', { class: 'dim', text: '→ Đích' }), mkSel('Ngôn ngữ đích', locSel.target, function (v) { locSel.target = v; drawRefs(); draw(); }), refsBox]));
    box.appendChild(out); drawRefs(); draw();
  }
  let lastPak = null;
  function renderPakHeads(s) {
    const p = (s.results && s.results.pakHeads) || null;
    if (p === lastPak) return; lastPak = p;
    const box = $('#pak-body'), wrap = $('#pak-detail'), empty = $('#pak-empty'); if (!box || !wrap || !empty) return;
    box.replaceChildren(); wrap.hidden = !p; empty.hidden = !!p; if (!p) return;
    const kv = h('dl', { class: 'kv' });
    kv.appendChild(h('dt', { text: 'Trạng thái' })); kv.appendChild(h('dd', {}, [h('span', { class: 'badge ' + (p.status === 'ok' ? 'success' : p.status === 'no_pak' ? 'warning' : 'danger'), text: p.status === 'ok' ? 'Hoàn tất' : p.status === 'no_pak' ? 'Không có .pak' : 'Lỗi' })]));
    kvRow(kv, 'Kết quả', p.reason);
    box.appendChild(kv);
    p.pak_files.forEach(function (x) {
      const k = h('dl', { class: 'kv' }); const hp = x.heaps;
      kvRow(k, 'File', x.zip_path + ' · ' + formatBytes(x.size));
      kvRow(k, 'Đã lấy', x.error ? ('Lỗi: ' + x.error) : (formatBytes(x.saved_bytes) + ' · 16 byte đầu: ' + x.first_16_hex));
      kvRow(k, 'Định dạng', x.format_guess + ' [HYPOTHESIS] – đuôi .pak không chứng minh Unreal');
      if (hp) {
        kvRow(k, 'Header Heaps', 'v' + hp.version + ' · header ' + hp.header_size + ' B · data ' + formatBytes(hp.data_size) + ' · cây: ' + hp.status);
        kvRow(k, 'Bên trong', hp.files_total + ' file / ' + hp.dirs_total + ' thư mục' + (hp.languages_hint.length ? ' · ngôn ngữ gợi ý: ' + hp.languages_hint.join(', ') : ''));
        kvRow(k, 'Đuôi file', Object.keys(hp.ext_histogram).sort(function (a, b) { return hp.ext_histogram[b] - hp.ext_histogram[a]; }).slice(0, 12).map(function (e) { return e + ' ×' + hp.ext_histogram[e]; }).join(', ') || '—');
        if (hp.text_like_paths.length) kvRow(k, 'Đường dẫn giống text (' + hp.text_like_total + ')', hp.text_like_paths.slice(0, 15).join(' · '));
        hp.notes.forEach(function (n) { kvRow(k, 'Ghi chú', n); });
      }
      box.appendChild(h('div', { class: 'card mt-3' }, [k]));
    });
    (p.warnings || []).forEach(function (w) { box.appendChild(h('p', { class: 'badge warning', text: w })); });
  }
  function renderFonts(s) {
    const f = (s.results && s.results.fonts) || null, fmx = (s.results && s.results.fontMetrics) || null, tmx = (s.results && s.results.tmpFonts) || null;
    const tx0 = (s.results && s.results.texts) || null, pkx = tx0 && ((tx0.pak_fonts && tx0.pak_fonts.length) || (tx0.font_inventory && tx0.font_inventory.length)) ? tx0 : null;
    if (f === lastFonts && fmx === lastFontMetrics && tmx === lastTmp && pkx === lastPakFonts) return; lastFonts = f; lastFontMetrics = fmx; lastTmp = tmx; lastPakFonts = pkx;
    const box = $('#fonts-body'), wrap = $('#fonts-detail'), empty = $('#fonts-empty'); if (!box || !wrap || !empty) return;
    box.replaceChildren(); wrap.hidden = !f && !fmx && !tmx && !pkx; empty.hidden = !!(f || fmx || tmx || pkx); if (!f && !fmx && !tmx && !pkx) return;
    if (!f) { const only = buildFontMetricsCard(fmx); if (only) box.appendChild(only); const ot = buildTmpCard(tmx); if (ot) box.appendChild(ot); const op = buildPakFontsCard(pkx); if (op) box.appendChild(op); return; }
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
    const tmCard = buildTmpCard(tmx); if (tmCard) box.appendChild(tmCard);
    const pkCard = buildPakFontsCard(pkx); if (pkCard) box.appendChild(pkCard);
  }
  NS.UI_saveBlob = saveBlob;

  /* Thẻ font trong pak (nguồn: bước Text): TTF/OTF/WOFF qua FontMetrics, BMFont qua danh sách ký tự. Chỉ nói font CÓ glyph/ký tự tiếng Việt, không nói game dùng font nào. */
  const VI_LV = { full: ['Đủ', 'success'], partial: ['Thiếu một phần', 'warning'], none: ['Không có', 'danger'], unknown: ['Không rõ', ''] };
  function buildPakFontsCard(t) {
    if (!t) return null;
    const card = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'Font trong file .pak – độ phủ tiếng Việt' })]);
    const pf = t.pak_fonts || [], vi = (t.summary && t.summary.pak_fonts_vi) || { full: 0, partial: 0, none: 0 };
    if (pf.length) {
      const kv = h('dl', { class: 'kv' });
      kvRow(kv, 'Tổng quan', pf.length + ' font · đủ tiếng Việt ' + vi.full + ' · thiếu một phần ' + vi.partial + ' · không có ' + vi.none + ' · không đọc được ' + (pf.length - vi.full - vi.partial - vi.none));
      kvRow(kv, 'Ý nghĩa', '“Đủ” = có glyph/ký tự cho cả 134 chữ Việt có dấu dựng sẵn. Font có thể không phải font game thật sự dùng; BMFont chỉ đếm ký tự khai báo trong .fnt (không kiểm ảnh atlas).');
      card.appendChild(kv);
      card.appendChild(buildPagedTable(['Font trong pak', 'Loại', 'Kích thước', 'Họ font', 'Glyph', 'Tiếng Việt', 'Phủ', 'Thiếu (đầu)'], pf, function (x) {
        const m = x.metrics || {}, v = m.vietnamese, lv = v ? (VI_LV[v.level] || [v.level, '']) : null;
        return [x.container + ': ' + x.file, (x.magic || '?') + (m.bmfont_format ? '/' + m.bmfont_format : ''), formatBytes(x.size), m.family || m.full || '—', m.glyphs == null ? '—' : String(m.glyphs),
          lv ? h('span', { class: 'badge ' + lv[1], text: lv[0] }) : (m.status || 'chưa đọc'), v && v.percent != null ? v.covered + '/' + v.required + ' (' + v.percent + '%)' : '—', v && v.missing && v.missing.length ? v.missing.slice(0, 6).join(' ') + (v.missing_count > 6 ? ' … (+' + (v.missing_count - 6) + ')' : '') : '—'];
      }, function (x) { return x.container + ' ' + x.file + ' ' + ((x.metrics && x.metrics.family) || ''); }, 'Tìm font trong pak'));
    }
    const inv = t.font_inventory || [];
    if (inv.length) card.appendChild(listBlock('File font/atlas liệt kê trong pak (gồm ảnh atlas, chưa phân tích)', inv.map(function (x) { return x.path + (x.container ? ' [' + x.container + ']' : '') + (x.role ? ' · ' + x.role : ''); }), 100));
    const fg = buildFontGenCard(t); if (fg) card.appendChild(fg);
    return card;
  }
  /* Bộ sinh glyph tiếng Việt cho font bitmap (BMFont) trong pak: chọn font thiếu → font nguồn (TTF tải lên hoặc font hệ thống) → .fnt + atlas PNG mới. */
  let fgSeq = 0;
  function buildFontGenCard(t) {
    const FG = NS.FontGenerator; if (!FG || !t) return null;
    const blobs = {}; (NS.TextExtract.fontFiles(t) || []).forEach(function (b) { blobs[b.name] = b.data; });
    const bn = function (pf) { return pf.container.replace(/[:\/]/g, '_') + '__' + pf.file.replace(/\//g, '__'); };
    const all = (t.pak_fonts || []).filter(function (pf) { return pf.ok && blobs[bn(pf)]; });
    const cands = all.filter(function (pf) { return pf.magic === 'bmfont' && pf.metrics && pf.metrics.vietnamese && pf.metrics.vietnamese.level !== 'full'; });
    const vector = all.filter(function (pf) { return pf.magic !== 'bmfont' && pf.metrics && pf.metrics.vietnamese && pf.metrics.vietnamese.level !== 'full'; });
    if (!cands.length && !vector.length) return null;
    const card = h('div', { class: 'card mt-3' }, [h('h3', { class: 'section-title', text: 'Bộ sinh font Việt (bitmap/BMFont)' })]);
    const kv = h('dl', { class: 'kv' });
    kvRow(kv, 'Làm gì', 'Với font bitmap thiếu chữ Việt: vẽ các glyph còn thiếu từ một font nguồn bằng Canvas, xuất .fnt mới + atlas PNG. “Thêm trang” giữ nguyên atlas gốc; “Dựng lại” thay cả atlas bằng font nguồn.');
    kvRow(kv, 'Chưa làm', 'Font TTF/OTF (' + vector.length + ' font thiếu chữ Việt trong pak chỉ được liệt kê), BMFont nhị phân, đóng gói ngược vào pak. Chưa kiểm trên game thật: engine có nhận trang atlas thêm/dựng lại hay không chưa biết.');
    card.appendChild(kv);
    if (!cands.length) { card.appendChild(h('p', { class: 'dim', text: 'Không có font bitmap (.fnt) nào thiếu chữ Việt trong pak.' })); return card; }
    const selFont = h('select', { class: 'input', 'aria-label': 'Font bitmap cần bổ sung' }, cands.map(function (pf, i) { const v = pf.metrics.vietnamese; return h('option', { value: String(i), text: pf.file + ' — ' + v.covered + '/' + v.required + ' chữ Việt' }); }));
    const selMode = h('select', { class: 'input', 'aria-label': 'Chế độ' }, [h('option', { value: 'append', text: 'Thêm trang atlas (giữ atlas gốc)' }), h('option', { value: 'rebuild', text: 'Dựng lại atlas 1 trang (mất kiểu gốc)' })]);
    const fileIn = h('input', { type: 'file', accept: '.ttf,.otf,.woff', class: 'input', 'aria-label': 'Font nguồn (TTF/OTF/WOFF)' });
    const famIn = h('input', { type: 'text', class: 'input', placeholder: 'hoặc tên font hệ thống, vd. Arial', 'aria-label': 'Tên font hệ thống' });
    const sizeIn = h('input', { type: 'number', class: 'input', min: '4', max: '128', 'aria-label': 'Cỡ chữ (px)' });
    const thrIn = h('input', { type: 'checkbox', 'aria-label': 'Làm sắc nét (pixel font)' });
    const syncSize = function () { const pf = cands[+selFont.value], z = pf && pf.metrics && pf.metrics.size; sizeIn.value = z ? String(z) : '16'; }; selFont.addEventListener('change', syncSize); syncSize();
    const out = h('div', { class: 'mt-3' }), btn = h('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Sinh glyph' }), dlBtn = h('button', { class: 'btn btn-sm', type: 'button', text: 'Tải font_generator.zip' });
    dlBtn.hidden = true; let lastZip = null;
    const field = function (label, el) { return h('label', { class: 'field' }, [h('span', { class: 'dim', text: label }), el]); };
    const form = h('div', { class: 'mt-3' }, [field('Font bitmap thiếu chữ Việt', selFont), field('Chế độ', selMode), field('Font nguồn: tải file TTF/OTF', fileIn), field('…hoặc font hệ thống', famIn), field('Cỡ chữ (px)', sizeIn), field('Làm sắc nét (ngưỡng alpha, cho pixel font)', thrIn)]);
    card.appendChild(form); card.appendChild(h('div', { class: 'toolbar mt-3' }, [btn, dlBtn])); card.appendChild(out);
    btn.addEventListener('click', async function () {
      const pf = cands[+selFont.value], data = pf && blobs[bn(pf)]; out.replaceChildren(); dlBtn.hidden = true; lastZip = null;
      if (!data) { toast('Không còn dữ liệu font – hãy phân tích lại IPA', 'warning'); return; }
      const file = fileIn.files && fileIn.files[0], sysFam = famIn.value.trim(), size = Math.max(4, Math.min(128, parseInt(sizeIn.value, 10) || 16));
      if (!file && !sysFam) { toast('Chọn file TTF/OTF hoặc nhập tên font hệ thống', 'warning'); return; }
      btn.disabled = true; btn.textContent = 'Đang sinh…';
      try {
        let family = sysFam, has = null, srcNote = 'font hệ thống “' + sysFam + '”';
        if (file) {
          const buf = new Uint8Array(await file.arrayBuffer()); family = 'ipals-src-' + (++fgSeq); srcNote = 'file ' + file.name;
          const face = new FontFace(family, buf.buffer.slice(0)); await face.load(); document.fonts.add(face);
          try { const pm = await NS.FontMetrics.parse(buf); if (pm.status === 'parsed' && pm.fonts.length) { const req = new Set(NS.FontMetrics.VI_REQUIRED), vm = pm.fonts[0].vietnamese; if (vm.level !== 'unknown') { const missHex = new Set(vm.missing || []); has = function (cp) { return req.has(cp) ? !missHex.has('U+' + cp.toString(16).toUpperCase().padStart(4, '0')) : undefined; }; } } } catch (_) { has = null; }
        } else if (!FG.systemFontAvailable(family)) { toast('Không thấy font hệ thống “' + family + '” (canvas sẽ dùng font mặc định, kết quả sai) – đã dừng', 'warning', 7000); return; }
        const raster = FG.createCanvasRasterizer({ family: family, size: size, has: has, threshold: thrIn.checked ? 128 : 0 });
        const res = await FG.generate({ fntBytes: data, fntPath: pf.file, raster: raster, mode: selMode.value });
        const rp = res.report, kv2 = h('dl', { class: 'kv' });
        kvRow(kv2, 'Kết quả', res.status + ' — ' + res.reason); kvRow(kv2, 'Font nguồn', srcNote + ' · cỡ ' + size + ' px' + (file ? '' : ' · KHÔNG kiểm chắc glyph có trong font hệ thống, hãy xem ảnh bên dưới'));
        if (rp.summary) kvRow(kv2, 'Tiếng Việt sau khi sinh', rp.summary.vietnamese_after + '/' + rp.summary.vietnamese_required + ' · trang mới ' + rp.summary.pages_written);
        out.appendChild(kv2); if (rp.warnings.length) out.appendChild(listBlock('Cảnh báo', rp.warnings)); if (rp.skipped_not_in_source.length) out.appendChild(listBlock('Font nguồn không có glyph', rp.skipped_not_in_source, 60));
        const pg = res.files.filter(function (f) { return f.role === 'atlas-page'; })[0];
        if (pg) { const url = URL.createObjectURL(new Blob([pg.data], { type: 'image/png' })), img = h('img', { src: url, alt: 'Atlas glyph mới (xem trước)', width: String(Math.min(rp.atlas.scaleW, 512)), class: 'fontgen-preview' }); img.addEventListener('load', function () { setTimeout(function () { URL.revokeObjectURL(url); }, 2000); }); out.appendChild(h('p', { class: 'dim', text: 'Xem trước atlas trang đầu (nền trong suốt, glyph trắng):' })); out.appendChild(img); }
        if (res.files.length) {
          const prefix = 'font_generator/pak/' + pf.container.replace(/^pak:/, '').replace(/^.*\//, '') + '/';
          lastZip = NS.PakHeads.buildZip(FG.toFiles(res, prefix)); dlBtn.hidden = false;
        }
        toast(res.status === 'ok' ? 'Đã sinh glyph' : (res.status === 'partial' ? 'Sinh được một phần – xem cảnh báo' : 'Không sinh được: ' + res.reason), res.status === 'ok' ? 'success' : 'warning', 6000);
      } catch (e) { toast('Lỗi sinh font: ' + ((e && e.message) || e), 'error', 7000); }
      finally { btn.disabled = false; btn.textContent = 'Sinh glyph'; }
    });
    dlBtn.addEventListener('click', function () { if (lastZip) saveBlob('font_generator.zip', lastZip, 'application/zip'); });
    return card;
  }
  /* Thẻ TMP_FontAsset (5.2d): ký tự có trong ATLAS của TextMesh Pro (khác với ký tự có trong file font nguồn). Heuristic: ghi rõ mức tin cậy. */
  const TMP_ST = { parsed: 'Đọc đủ', partial: 'Một phần', glyph_table_not_found: 'Không thấy bảng glyph', layout_unknown: 'Không nhận ra bố cục', too_large: 'Quá lớn', error: 'Lỗi' };
  function buildTmpCard(t) {
    if (!t || t.status === 'not_run') return null;
    const card = h('div', { class: 'card mt-3' }, [h('h2', { class: 'section-title', text: 'TMP_FontAsset – ký tự trong atlas (5.2d)' })]);
    if (t.status === 'no_tmp' || !t.summary || !t.items.length) { card.appendChild(h('p', { class: 'dim', text: t.reason || 'Không có TMP_FontAsset.' })); if (t.warnings.length) card.appendChild(listBlock('Cảnh báo', t.warnings)); return card; }
    const kv = h('dl', { class: 'kv' });
    kvRow(kv, 'Kết quả', t.reason);
    kvRow(kv, 'Cách đọc', 'Heuristic: tìm bảng glyph 36 byte/phần tử (id + 8 số thực) và chỉ nhận khi mọi phần tử hợp lệ; chưa kiểm trên file thật. Nếu không thấy sẽ báo rõ, không đoán.');
    kvRow(kv, 'Ý nghĩa', 'Số ký tự Việt (134 chữ có dấu dựng sẵn) mà ATLAS đang chứa. TMP bản tĩnh chỉ vẽ được ký tự có sẵn trong atlas; font nguồn đủ chữ chưa đủ để hiển thị.');
    card.appendChild(kv);
    card.appendChild(buildPagedTable(['TMP_FontAsset', 'Tiếng Việt', 'Ký tự trong atlas', 'Font (FaceInfo)', 'Atlas', 'Trạng thái'], t.items, function (it) {
      const v = it.vietnamese, fi = it.font_info;
      return [it.name || ('#' + it.path_id), v ? v.covered + '/' + v.required + ' (' + ({ full: 'đủ', partial: 'thiếu', none: 'không có' })[v.level] + ')' : '—', it.code_points ? String(it.code_points.count) : '—', fi ? fi.name : '—',
        fi && fi.atlas_width ? fi.atlas_width + '×' + fi.atlas_height : '—', TMP_ST[it.status] || it.status];
    }, function (it) { return (it.name || '') + ' ' + (it.font_info ? it.font_info.name : '') + ' ' + it.status; }, 'Tìm TMP_FontAsset'));
    const det = t.items.map(function (it) {
      const parts = [(it.name || ('#' + it.path_id)) + ' [' + it.source + ' · path_id ' + it.path_id + ']'];
      if (it.glyph_table) parts.push('bảng glyph ' + it.glyph_table.count + ' ký tự' + (it.glyph_table.count_matches_declared === false ? ' (≠ khai báo ' + it.font_info.declared_char_count + ')' : it.glyph_table.count_matches_declared ? ' (khớp khai báo)' : ''));
      if (it.refs) { ['texture', 'material', 'font', 'tmp_font_asset'].forEach(function (k) { if (it.refs[k] && it.refs[k].length) parts.push(({ texture: 'Texture2D', material: 'Material', font: 'Font', tmp_font_asset: 'TMP khác' })[k] + ': ' + it.refs[k].map(function (r) { return (r.name || '?') + ' #' + r.path_id; }).join(', ')); }); }
      if (it.matched_fonts && it.matched_fonts.length) parts.push('Font cùng tên: ' + it.matched_fonts.map(function (m) { return m.name + ' #' + m.path_id; }).join(', '));
      if (it.vietnamese && it.vietnamese.missing_count) parts.push('Thiếu ' + it.vietnamese.missing_count + ' ký tự Việt, ví dụ: ' + it.vietnamese.missing.slice(0, 12).join(' '));
      if (it.problems && it.problems.length) parts.push('Vấn đề: ' + it.problems.join('; '));
      if (!it.glyph_table) parts.push(it.reason);
      return parts.join(' — ');
    });
    card.appendChild(listBlock('Chi tiết từng TMP_FontAsset', det, 40));
    if (t.warnings.length) card.appendChild(listBlock('Cảnh báo', t.warnings));
    card.appendChild(listBlock('Chưa làm ở sub-phase 5.2d (có chủ đích)', t.limitations));
    return card;
  }

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
