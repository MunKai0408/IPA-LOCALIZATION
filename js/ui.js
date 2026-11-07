/* ui.js – render giao diện từ state. Không có logic phân tích ở đây.
   Dữ liệu từ IPA/game LUÔN đi qua textContent, không bao giờ innerHTML. */
(function (NS) {
  'use strict';

  const VIEWS = {
    overview:     { title: 'Tổng quan',      icon: '▦' },
    analyze:      { title: 'Phân tích IPA',  icon: '⬆' },
    engine:       { title: 'Engine',         icon: '⚙', phase: 2 },
    explorer:     { title: 'File Explorer',  icon: '🗂', phase: 3 },
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
