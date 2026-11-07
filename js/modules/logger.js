/* logger.js – ghi log có cấu trúc, phát cho UI và cho packager (Logs/extractor.log) */
(function (NS) {
  'use strict';
  const LEVELS = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'DEBUG'];
  const MAX_ENTRIES = 5000;
  const entries = [];
  const listeners = new Set();

  function serializeError(err) {
    if (err == null) return null;
    if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack || null };
    return { name: 'Error', message: String(err), stack: null };
  }

  function write(level, message, opts) {
    const o = opts || {};
    const entry = {
      timestamp: new Date().toISOString(),
      level: LEVELS.includes(level) ? level : 'INFO',
      step: o.step || null,
      module: o.module || 'app',
      message: String(message),
      details: o.details === undefined ? null : o.details,
      error: serializeError(o.error)
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    listeners.forEach(function (fn) {
      try { fn(entry); } catch (e) { /* listener lỗi không được làm hỏng logger */ console.error(e); }
    });
    return entry;
  }

  function formatLine(e) {
    let s = '[' + e.timestamp + '] ' + e.level.padEnd(7) + ' ' + (e.step ? e.step + '/' : '') + e.module + ': ' + e.message;
    if (e.details != null) {
      try { s += ' | ' + JSON.stringify(e.details); } catch (_) { s += ' | [details không serialize được]'; }
    }
    if (e.error) s += ' | ' + e.error.name + ': ' + e.error.message;
    return s;
  }

  NS.Logger = {
    LEVELS: LEVELS,
    info:    function (m, o) { return write('INFO', m, o); },
    success: function (m, o) { return write('SUCCESS', m, o); },
    warning: function (m, o) { return write('WARNING', m, o); },
    error:   function (m, o) { return write('ERROR', m, o); },
    debug:   function (m, o) { return write('DEBUG', m, o); },
    getEntries: function () { return entries.slice(); },
    clear: function () { entries.length = 0; listeners.forEach(function (fn) { try { fn(null); } catch (_) {} }); },
    subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
    formatLine: formatLine,
    /** Nội dung cho Logs/extractor.log */
    toText: function () { return entries.map(formatLine).join('\n'); }
  };
})(window.IPAStudio = window.IPAStudio || {});
