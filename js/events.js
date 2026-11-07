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
      stats: Object.assign({}, s.stats, { totalFiles: r.zip.fileCount }),
      results: Object.assign({}, s.results, { ipa: r })
    });
    r.warnings.forEach(function (w) { /* đã log trong IpaReader qua hook */ });
    L.success('Phase 1 hoàn tất: đã đọc cấu trúc IPA', { module: 'events', step: 'read', details: { bundleId: r.app.bundleId, files: r.zip.fileCount, arch: r.architectures } });
    UI.toast('Đã đọc xong cấu trúc IPA', 'success');
  }

  async function startAnalysis(bundle) {
    const s = S.get().session;
    if (!s.file || !s.fileCheck || !s.fileCheck.ok || s.status === 'running') return;
    S.updateSession({ status: 'running', error: null, app: null, results: {}, stats: { totalFiles: null, fontCount: null, stringCount: null, localizationTables: null }, startedAt: new Date().toISOString(), completedAt: null, progress: 0 });
    S.resetSteps();
    L.info('Bắt đầu phân tích', { module: 'events', step: 'read', details: { file: s.file.name, bundle: bundle || null } });

    const job = NS.WorkerManager.runIpa(s.file, { bundle: bundle || undefined }, {
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
