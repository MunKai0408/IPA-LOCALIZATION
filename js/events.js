/* events.js – gắn sự kiện DOM → State và điều phối tác vụ phân tích. */
(function (NS) {
  'use strict';
  const S = NS.State, L = NS.Logger, UI = NS.UI;
  const $ = UI.$, $$ = UI.$$;
  let currentJob = null;

  /** Kiểm tra sơ bộ theo tên file. Kiểm tra ZIP/Payload thật nằm trong IpaReader. */
  function checkFile(file) {
    if (!/\.ipa$/i.test(file.name)) return { ok: false, message: 'Không phải file .ipa' };
    if (file.size === 0) return { ok: false, message: 'File rỗng' };
    return { ok: true, message: 'Đúng đuôi .ipa (chưa kiểm tra ZIP)' };
  }

  function selectFile(file) {
    if (!file) return;
    if (currentJob) { currentJob.cancel(); currentJob = null; }
    const check = checkFile(file);
    S.resetSession();
    S.updateSession({ file: file, fileCheck: check, status: check.ok ? 'file_selected' : 'error',
                      error: check.ok ? null : { code: 'BAD_FILE', message: check.message } });
    if (check.ok) {
      L.info('Đã chọn file (chưa giải nén)', { module: 'events', step: 'input', details: { name: file.name, size: file.size } });
      if (file.size > 2 * 1024 * 1024 * 1024) L.warning('IPA lớn (>2 GB): trình duyệt đọc theo từng phần nhưng có thể chậm; Safari iOS có thể hết bộ nhớ', { module: 'events', step: 'input' });
      UI.toast('Đã chọn ' + file.name, 'success');
    } else {
      L.error('File không hợp lệ: ' + check.message, { module: 'events', step: 'input', details: { name: file.name } });
      UI.toast(check.message, 'error');
    }
  }

  function applyResult(r) {
    const s = S.get().session;
    S.updateSession({
      status: 'read_done', error: null, completedAt: new Date().toISOString(), progress: 1,
      app: {
        name: r.app.displayName || r.app.name || r.app.executable, bundleId: r.app.bundleId,
        version: r.app.version, build: r.app.build, minOS: r.app.minOS,
        deviceFamily: r.app.deviceFamily, architectures: r.architectures
      },
      engine: r.engine ? { engine: r.engine.engine, variant: r.engine.variant, confidence: r.engine.confidence, status: r.engine.status,
                           analysis_branch: r.engine.analysis_branch, version: r.engine.version } : null,
      stats: Object.assign({}, s.stats, { totalFiles: r.manifest ? r.manifest.summary.totalFiles : r.zip.fileCount, fontCount: r.fonts && r.fonts.summary ? r.fonts.summary.fonts_valid : null }),
      manifest: r.manifest ? { summary: r.manifest.summary, options: r.manifest.options, generatedAt: r.manifest.generatedAt } : null,
      results: Object.assign({}, s.results, { ipa: r, engine: r.engine || null, manifest: r.manifest || null, unity: r.unity || null, fonts: r.fonts || null, fontFiles: r.font_files || null, reportEngine: r.engine ? NS.DetectEngine.toReportFields(r.engine) : null })
    });
    r.warnings.forEach(function (w) { /* đã log trong IpaReader qua hook */ });
    L.success('Phase 1–4.3 hoàn tất: đã đọc cấu trúc IPA, nhận diện engine, quét file, dò thành phần Unity, kiểm tra header metadata, trích xuất string literal, assembly/class/method/field và phát hiện/trích xuất font (Phase 5.1)', { module: 'events', step: 'read', details: { bundleId: r.app.bundleId, files: r.zip.fileCount, arch: r.architectures } });
    UI.toast(r.engine ? 'Engine: ' + r.engine.engine + (r.engine.variant ? ' ' + r.engine.variant : '') + ' (' + r.engine.status + ')' : 'Đã đọc xong cấu trúc IPA', r.engine && r.engine.status === 'unknown' ? 'warning' : 'success');
  }

  async function startAnalysis(bundle) {
    const s = S.get().session;
    if (!s.file || !s.fileCheck || !s.fileCheck.ok || s.status === 'running') return;
    S.updateSession({ status: 'running', error: null, app: null, engine: null, results: {}, stats: { totalFiles: null, fontCount: null, stringCount: null, localizationTables: null }, startedAt: new Date().toISOString(), completedAt: null, progress: 0 });
    S.resetSteps();
    L.info('Bắt đầu phân tích', { module: 'events', step: 'read', details: { file: s.file.name, bundle: bundle || null } });

    const job = NS.WorkerManager.runIpa(s.file, { bundle: bundle || undefined, hashMode: ($('#hash-mode') && $('#hash-mode').value) || 'auto' }, {
      onStep: function (id, status, msg) { S.setStep(id, status, msg); },
      onProgress: function (v) { S.updateSession({ progress: v }); },
      onLog: function (level, msg, details) {
        const fn = ({ INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error', DEBUG: 'debug' })[level] || 'info';
        L[fn](msg, { module: 'ipa_reader', step: 'read', details: details });
      }
    });
    currentJob = job;
    try {
      const result = await job.promise;
      if (currentJob !== job) return; // đã bị thay thế/xóa
      applyResult(result);
    } catch (e) {
      if (currentJob !== job) return;
      if (e.code === 'CANCELLED') {
        S.updateSession({ status: 'cancelled', error: null });
        S.get().session.steps.forEach(function (st) { if (st.status === 'running') S.setStep(st.id, 'pending', 'Đã hủy'); });
        L.warning('Đã hủy phân tích', { module: 'events' });
        UI.toast('Đã hủy', 'warning');
      } else {
        S.updateSession({ status: 'error', error: { code: e.code || 'ERROR', message: e.message } });
        L.error('Phân tích thất bại: ' + e.message, { module: 'events', step: 'read', error: e, details: { code: e.code } });
        UI.toast(e.message, 'error', 7000);
      }
    } finally {
      if (currentJob === job) currentJob = null;
    }
  }

  function closeNav() { document.body.classList.remove('nav-open'); $('#backdrop').hidden = true; }
  function openNav() { document.body.classList.add('nav-open'); $('#backdrop').hidden = false; }

  function bind() {
    $$('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { S.setView(b.dataset.view); closeNav(); window.scrollTo(0, 0); });
    });
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { S.setView(b.dataset.goto); });
    });
    $('#btn-menu').addEventListener('click', openNav);
    $('#backdrop').addEventListener('click', closeNav);

    const dz = $('#dropzone'), input = $('#file-input');
    $('#btn-pick').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { selectFile(input.files[0]); input.value = ''; });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('dragover'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault(); dz.classList.remove('dragover');
      selectFile(e.dataTransfer && e.dataTransfer.files[0]);
    });

    $('#btn-start').addEventListener('click', function () { startAnalysis(); });
    $('#btn-cancel').addEventListener('click', function () { if (currentJob) currentJob.cancel(); });
    $('#bundle-picker').addEventListener('change', function (e) {
      if (e.target && e.target.id === 'bundle-select') startAnalysis(e.target.value);
    });
    $('#btn-clear').addEventListener('click', function () {
      if (!window.confirm('Xóa phiên phân tích hiện tại? File IPA gốc trên máy bạn không bị ảnh hưởng.')) return;
      if (currentJob) { currentJob.cancel(); currentJob = null; }
      S.resetSession();
      L.info('Đã xóa phiên làm việc', { module: 'events' });
      UI.toast('Đã xóa phiên', 'info');
    });

    $('#btn-theme').addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      UI.applyTheme(next);
      try { localStorage.setItem('ipals.theme', next); } catch (_) { /* storage có thể bị chặn */ }
    });

    $('#btn-log-clear').addEventListener('click', function () { L.clear(); });
    $('#btn-manifest').addEventListener('click', function () {
      const m = S.get().session.results.manifest;
      if (!m) { UI.toast('Chưa có manifest để tải', 'warning'); return; }
      const url = URL.createObjectURL(new Blob([NS.FileScanner.toCsv(m)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'manifest.csv';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    $('#btn-unity-json').addEventListener('click', function () {
      const u = S.get().session.results.unity;
      if (!u) { UI.toast('Chưa có kết quả Unity để tải', 'warning'); return; }
      const url = URL.createObjectURL(new Blob([JSON.stringify(u, null, 2)], { type: 'application/json;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'unity_info.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    $('#btn-metaheader-json').addEventListener('click', function () {
      const u = S.get().session.results.unity;
      const sum = u && u.metadata_header ? NS.MetadataDump.toSummary(u.metadata_header, u.metadata_literals, u.metadata_tables) : null;
      if (!sum) { UI.toast('Chưa có kết quả header metadata để tải', 'warning'); return; }
      const url = URL.createObjectURL(new Blob([JSON.stringify(sum, null, 2)], { type: 'application/json;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'metadata_summary.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    $('#btn-literals-json').addEventListener('click', function () {
      const u = S.get().session.results.unity;
      if (!u || !u.metadata_literals || u.metadata_literals.status !== 'ok') { UI.toast('Chưa có string literal để tải', 'warning'); return; }
      const url = URL.createObjectURL(new Blob([JSON.stringify(u.metadata_literals, null, 2)], { type: 'application/json;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'unity_string_literals.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    function dl(name, text, type) {
      const url = URL.createObjectURL(new Blob([text], { type: type }));
      const a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    $('#btn-metatables-json').addEventListener('click', function () {
      const u = S.get().session.results.unity;
      if (!u || !u.metadata_tables || u.metadata_tables.status !== 'ok') { UI.toast('Chưa có bảng assembly/class/method/field để tải', 'warning'); return; }
      dl('metadata_tables.json', JSON.stringify(u.metadata_tables, null, 2), 'application/json;charset=utf-8');
    });
    $('#btn-dumpcs').addEventListener('click', function () {
      const u = S.get().session.results.unity;
      const txt = u && u.metadata_tables ? NS.MetadataTables.toDumpCs(u.metadata_tables) : null;
      if (!txt) { UI.toast('Chưa có dữ liệu để tạo dump.cs', 'warning'); return; }
      dl('dump.cs', txt, 'text/plain;charset=utf-8');
    });
    $('#btn-fontindex-json').addEventListener('click', function () {
      const f = S.get().session.results.fonts; if (!f) { UI.toast('Chưa có kết quả font', 'warning'); return; }
      dl('font_index.json', JSON.stringify(NS.FontDump.toFontIndex(f), null, 2), 'application/json;charset=utf-8');
    });
    $('#btn-fonts-json').addEventListener('click', function () {
      const f = S.get().session.results.fonts; if (!f) { UI.toast('Chưa có kết quả font', 'warning'); return; }
      dl('fonts.json', JSON.stringify(NS.FontDump.toFontsJson(f), null, 2), 'application/json;charset=utf-8');
    });
    $('#btn-log-download').addEventListener('click', function () {
      const text = L.toText();
      if (!text) { UI.toast('Chưa có log để tải', 'warning'); return; }
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = 'extractor.log';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });

    window.addEventListener('error', function (e) { L.error('Lỗi không bắt được', { module: 'window', error: e.error || e.message }); });
    window.addEventListener('unhandledrejection', function (e) { L.error('Promise bị từ chối', { module: 'window', error: e.reason }); });
  }

  NS.Events = { bind: bind, selectFile: selectFile, startAnalysis: startAnalysis };
})(window.IPAStudio = window.IPAStudio || {});
