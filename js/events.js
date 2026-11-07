/* events.js – gắn sự kiện DOM → State. Không chứa logic phân tích. */
(function (NS) {
  'use strict';
  const S = NS.State, L = NS.Logger, UI = NS.UI;
  const $ = UI.$, $$ = UI.$$;

  /** Kiểm tra sơ bộ theo tên file. Kiểm tra ZIP/Payload thật ở Phase 1. */
  function checkFile(file) {
    if (!/\.ipa$/i.test(file.name)) return { ok: false, message: 'Không phải file .ipa' };
    if (file.size === 0) return { ok: false, message: 'File rỗng' };
    return { ok: true, message: 'Đúng đuôi .ipa (chưa kiểm tra ZIP)' };
  }

  function selectFile(file) {
    if (!file) return;
    const check = checkFile(file);
    S.resetSession();
    S.updateSession({ file: file, fileCheck: check, status: check.ok ? 'file_selected' : 'error' });
    if (check.ok) {
      L.info('Đã chọn file (chưa giải nén)', { module: 'events', step: 'input', details: { name: file.name, size: file.size } });
      UI.toast('Đã chọn ' + file.name, 'success');
    } else {
      L.error('File không hợp lệ: ' + check.message, { module: 'events', step: 'input', details: { name: file.name } });
      UI.toast(check.message, 'error');
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

    $('#btn-cancel').addEventListener('click', function () {
      // Phase 1+ sẽ gọi WorkerManager.cancel(); nút chỉ bật khi có tác vụ chạy
      L.warning('Yêu cầu hủy tác vụ', { module: 'events' });
    });
    $('#btn-clear').addEventListener('click', function () {
      if (!window.confirm('Xóa phiên phân tích hiện tại? File IPA gốc trên máy bạn không bị ảnh hưởng.')) return;
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

    // Lỗi không bắt được → log, không để UI chết im lặng
    window.addEventListener('error', function (e) { L.error('Lỗi không bắt được', { module: 'window', error: e.error || e.message }); });
    window.addEventListener('unhandledrejection', function (e) { L.error('Promise bị từ chối', { module: 'window', error: e.reason }); });
  }

  NS.Events = { bind: bind, selectFile: selectFile };
})(window.IPAStudio = window.IPAStudio || {});
