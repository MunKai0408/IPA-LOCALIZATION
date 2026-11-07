/* worker_manager.js – chạy tác vụ nặng trong Web Worker, có tiến trình và hủy.
   Nếu Worker không khả dụng (vd mở bằng file://), tự chạy trên luồng chính (async, đọc theo từng phần) và ghi cảnh báo. */
(function (NS) {
  'use strict';
  const WORKER_URL = 'js/workers/ipa.worker.js';

  /**
   * @param {File} file
   * @param {{bundle?:string}} opts
   * @param {{onStep?:Function,onProgress?:Function,onLog?:Function}} h
   * @returns {{promise:Promise<object>, cancel:Function}}
   */
  function runIpa(file, opts, h) {
    h = h || {};
    let cancelled = false, settled = false, worker = null, gotMessage = false;
    let rejectFn;

    const emitStep = function (id, status, msg) { if (h.onStep) h.onStep(id, status, msg); };
    const emitProgress = function (v) { if (h.onProgress) h.onProgress(v); };
    const emitLog = function (level, msg, details) { if (h.onLog) h.onLog(level, msg, details); };

    const promise = new Promise(function (resolve, reject) {
      rejectFn = reject;
      const done = function (fn, v) { if (settled) return; settled = true; if (worker) { worker.terminate(); worker = null; } fn(v); };
      const fail = function (err) { done(reject, Object.assign(new Error(err.message), { code: err.code || 'ERROR' })); };

      function runOnMainThread(reason) {
        emitLog('WARNING', 'Web Worker không khả dụng, chạy trên luồng chính', { reason: String(reason) });
        NS.IpaReader.analyze(file, opts, {
          step: emitStep, progress: emitProgress, log: emitLog, isCancelled: function () { return cancelled; }
        }).then(function (r) { done(resolve, r); }, function (e) { fail(e); });
      }

      try { worker = new Worker(WORKER_URL); }
      catch (e) { runOnMainThread(e && e.message ? e.message : e); return; }

      worker.onmessage = function (ev) {
        gotMessage = true;
        const m = ev.data || {};
        if (m.type === 'step') emitStep(m.id, m.status, m.message);
        else if (m.type === 'progress') emitProgress(m.value);
        else if (m.type === 'log') emitLog(m.level, m.message, m.details);
        else if (m.type === 'result') done(resolve, m.result);
        else if (m.type === 'error') fail(m.error);
      };
      worker.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (settled) return;
        if (!gotMessage) { if (worker) { worker.terminate(); worker = null; } runOnMainThread(ev && ev.message ? ev.message : 'worker load error'); }
        else fail({ code: 'WORKER_ERROR', message: (ev && ev.message) || 'Lỗi trong worker' });
      };
      worker.postMessage({ type: 'analyze', file: file, opts: opts || {} });
    });

    return {
      promise: promise,
      cancel: function () {
        if (settled) return;
        cancelled = true;
        if (worker) { worker.terminate(); worker = null; }
        settled = true;
        rejectFn(Object.assign(new Error('Đã hủy'), { code: 'CANCELLED' }));
      }
    };
  }

  NS.WorkerManager = { runIpa: runIpa };
})(window.IPAStudio = window.IPAStudio || {});
