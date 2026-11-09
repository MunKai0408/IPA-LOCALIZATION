/* ipa.worker.js – chạy phân tích IPA ngoài luồng chính.
   Giao thức: main → {type:'analyze', file, opts}
              worker → {type:'step'|'progress'|'log'|'result'|'error', ...} */
'use strict';
importScripts('../plist_parser.js', '../binary_reader.js', '../modules/hash.js', '../modules/magic_bytes.js', '../modules/archive_scanner.js', '../modules/detect_engine.js', '../modules/file_scanner.js', '../modules/unity_dump.js', '../modules/metadata_dump.js', '../modules/metadata_tables.js', '../modules/font_dump.js', '../modules/unity_fs.js', '../modules/serialized_file.js', '../modules/font_metrics.js', '../modules/tmp_font.js', '../modules/candidates.js', '../ipa_reader.js');

self.onmessage = async function (ev) {
  const m = ev.data;
  if (!m || m.type !== 'analyze') return;
  try {
    const result = await self.IPAStudio.IpaReader.analyze(m.file, m.opts || {}, {
      step: function (id, status, message) { self.postMessage({ type: 'step', id: id, status: status, message: message || '' }); },
      progress: function (v) { self.postMessage({ type: 'progress', value: v }); },
      log: function (level, message, details) { self.postMessage({ type: 'log', level: level, message: message, details: details === undefined ? null : details }); },
      isCancelled: function () { return false; } // hủy bằng worker.terminate() từ luồng chính
    });
    self.postMessage({ type: 'result', result: result });
  } catch (e) {
    self.postMessage({ type: 'error', error: { code: (e && e.code) || 'ERROR', message: (e && e.message) || String(e) } });
  }
};
