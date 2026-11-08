/* state.js – trạng thái trung tâm của phiên làm việc.
   Các phase sau chỉ gọi State.set / State.update, UI tự render lại qua subscribe. */
(function (NS) {
  'use strict';

  const PIPELINE_STEPS = [
    { id: 'read',     label: 'Đọc IPA' },
    { id: 'plist',    label: 'Phân tích Info.plist' },
    { id: 'engine',   label: 'Nhận diện engine' },
    { id: 'scan',     label: 'Quét file' },
    { id: 'unity',    label: 'Unity IL2CPP (thành phần)' },
    { id: 'metadata', label: 'Metadata IL2CPP (header, phiên bản)' },
    { id: 'literals', label: 'Metadata IL2CPP (string literal)' },
    { id: 'tables',   label: 'Metadata IL2CPP (assembly/class/method/field)' },
    { id: 'extract',  label: 'Trích xuất dữ liệu' },
    { id: 'fonts',    label: 'Font (phát hiện, trích xuất)' },
    { id: 'unityfs',  label: 'AssetBundle UnityFS (container)' },
    { id: 'serialized', label: 'SerializedFile (TextAsset, font, script)' },
    { id: 'fontmetrics', label: 'Metadata font & độ phủ tiếng Việt' },
    { id: 'report',   label: 'Tạo báo cáo' },
    { id: 'package',  label: 'Đóng gói ZIP' }
  ];

  // status của phiên: idle | file_selected | running | read_done (Phase 1 xong) | done | error | cancelled
  function initialSession() {
    return {
      status: 'idle',
      file: null,            // File object gốc – KHÔNG ghi đè, KHÔNG upload
      fileCheck: null,       // { ok:boolean, message:string }
      app: null,             // Phase 1: { name, bundleId, version, build, architectures[] ... }
      engine: null,          // Phase 2: { engine, variant, confidence, ... }
      manifest: null,        // Phase 3
      results: {},           // fonts, strings, localization, metadata ... (Phase 4+)
      stats: {               // null = chưa có dữ liệu thật
        totalFiles: null, fontCount: null, stringCount: null, localizationTables: null
      },
      steps: PIPELINE_STEPS.map(function (s) { return { id: s.id, label: s.label, status: 'pending', message: '' }; }),
      progress: 0,
      error: null,           // { code, message } khi status = 'error'
      startedAt: null,
      completedAt: null
    };
  }

  let state = { view: 'overview', session: initialSession() };
  const listeners = new Set();

  function emit(changedKeys) {
    listeners.forEach(function (fn) {
      try { fn(state, changedKeys); }
      catch (e) { NS.Logger.error('Lỗi trong listener state', { module: 'state', error: e }); }
    });
  }

  NS.State = {
    PIPELINE_STEPS: PIPELINE_STEPS,
    get: function () { return state; },
    subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
    setView: function (view) {
      if (state.view === view) return;
      state = Object.assign({}, state, { view: view });
      emit(['view']);
    },
    /** Gộp patch vào session. */
    updateSession: function (patch) {
      state = Object.assign({}, state, { session: Object.assign({}, state.session, patch) });
      emit(['session']);
    },
    /** Cập nhật một bước pipeline: status = pending|running|done|error|skipped */
    setStep: function (id, status, message) {
      const steps = state.session.steps.map(function (s) {
        return s.id === id ? Object.assign({}, s, { status: status, message: message || '' }) : s;
      });
      NS.State.updateSession({ steps: steps });
    },
    /** Đặt lại các bước pipeline về 'pending' (trước mỗi lần chạy). */
    resetSteps: function () {
      NS.State.updateSession({ steps: PIPELINE_STEPS.map(function (s) { return { id: s.id, label: s.label, status: 'pending', message: '' }; }) });
    },
    /** Xóa toàn bộ dữ liệu phiên để giải phóng bộ nhớ. */
    resetSession: function () {
      state = Object.assign({}, state, { session: initialSession() });
      emit(['session']);
    }
  };
})(window.IPAStudio = window.IPAStudio || {});
