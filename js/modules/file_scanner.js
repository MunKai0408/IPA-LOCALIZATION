/* file_scanner.js – Phase 3: quét TOÀN BỘ file trong IPA, phân loại bằng magic bytes, băm SHA-1/SHA-256, tạo manifest.
   Chỉ đọc IPA, không ghi/sửa dữ liệu gốc. Chạy được ở Worker và luồng chính. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const HEAD_BYTES = 4096;
  const SHA256_MAX_BYTES = 64 * 1024 * 1024;     // chế độ standard: SHA-256 chỉ cho file ≤ 64 MB (SHA-1 cho mọi file)
  const AUTO_STANDARD_MAX_IPA = 512 * 1024 * 1024; // auto: IPA lớn hơn mức này → fast
  const COLUMNS = ['relative_path', 'file_name', 'extension', 'file_size', 'compressed_size', 'sha1', 'sha256', 'magic_bytes',
                   'detected_type', 'detected_format', 'type_source', 'ext_mismatch', 'engine_related', 'priority', 'area',
                   'extraction_status', 'archive_status', 'archive_info', 'error'];

  function areaOf(path, rootPath) {
    if (path.indexOf(rootPath) !== 0) return 'ngoài Payload';
    const r = path.slice(rootPath.length).toLowerCase();
    if (/^frameworks\//.test(r)) return 'Frameworks';
    if (/^plugins\//.test(r)) return 'PlugIns';
    if (/(^|\/)[^\/]+\.lproj\//.test(r)) return '*.lproj';
    if (/(^|\/)streamingassets\//.test(r) || /^data\/raw\//.test(r)) return 'StreamingAssets/Data/Raw';
    if (/^data\//.test(r)) return 'Data';
    return r.indexOf('/') < 0 ? '.app (gốc)' : 'Thư mục asset khác';
  }

  function resolveMode(mode, ipaSize) {
    if (mode === 'fast' || mode === 'standard') return mode;
    return ipaSize <= AUTO_STANDARD_MAX_IPA ? 'standard' : 'fast';
  }

  /**
   * @param {File} file  @param {object} ipa  IpaResult  @param {object[]} zipEntries entries gốc của openZip
   * @param {{hashMode?:'auto'|'fast'|'standard'}} opts
   * @param {{progress?:Function, log?:Function, isCancelled?:Function, step?:Function}} hooks
   */
  async function scan(file, ipa, zipEntries, opts, hooks) {
    opts = opts || {}; hooks = hooks || {};
    const IR = NS.IpaReader, MB = NS.MagicBytes, AS = NS.ArchiveScanner, HS = NS.Hash;
    const cancelled = hooks.isCancelled || function () { return false; };
    const log = hooks.log || function () {};
    const mode = resolveMode(opts.hashMode || 'auto', file.size);
    const isRelated = NS.DetectEngine && ipa.engine ? NS.DetectEngine.makeRelatedFn(ipa.engine) : function () { return null; };
    const rootPath = ipa.appRoot || '';
    const items = zipEntries.filter(function (e) { return !e.dir; });
    const totalBytes = items.reduce(function (a, e) { return a + e.size; }, 0);
    const rows = [];
    const summary = { totalFiles: items.length, totalBytes: totalBytes, byType: {}, byStatus: {}, byArea: {}, hashed: 0, sha256Hashed: 0, priorityFiles: 0, mismatches: 0, archives: 0, errors: 0 };
    let doneBytes = 0, lastTick = 0;

    for (let idx = 0; idx < items.length; idx++) {
      if (cancelled()) throw new IR.IpaError('CANCELLED', 'Đã hủy');
      const e = items[idx];
      const inApp = e.name.indexOf(rootPath) === 0;
      const rel = inApp ? e.name.slice(rootPath.length) : e.name;
      const name = e.name.slice(e.name.lastIndexOf('/') + 1);
      const row = {
        relative_path: rel, file_name: name, extension: MB.extOf(name), file_size: e.size, compressed_size: e.csize,
        sha1: '', sha256: '', magic_bytes: '', detected_type: 'Unknown', detected_format: '', type_source: 'none', ext_mismatch: false,
        engine_related: 'unknown', priority: false, area: areaOf(e.name, rootPath),
        extraction_status: 'ok', archive_status: '', archive_info: '', error: ''
      };
      let head = new Uint8Array(0);
      try {
        if (e.unsafe) { row.extraction_status = 'unsafe_path'; row.error = 'Đường dẫn không an toàn: ' + e.unsafe; }
        else if (e.symlink) { row.extraction_status = 'symlink_not_followed'; row.error = 'Symlink: không theo liên kết'; }
        else if (e.encrypted) { row.extraction_status = 'encrypted_zip'; row.error = 'Entry bị mã hóa ZIP: không đọc, không thử khóa'; }
        else if (e.method !== 0 && e.method !== 8) { row.extraction_status = 'unsupported_method'; row.error = 'Phương thức nén ' + e.method + ' chưa hỗ trợ'; }
        else if (e.size === 0) { head = new Uint8Array(0); row.extraction_status = 'ok'; if (mode === 'standard') { row.sha1 = HS.create('sha1').hex(); row.sha256 = HS.create('sha256').hex(); summary.hashed++; summary.sha256Hashed++; } }
        else if (mode === 'fast') {
          const r = await IR.readEntry(file, e, { max: Math.min(HEAD_BYTES, e.size), head: true });
          head = r.data; row.extraction_status = 'head_only';
        } else {
          const wantSha256 = e.size <= SHA256_MAX_BYTES;
          const h1 = HS.create('sha1'), h2 = wantSha256 ? HS.create('sha256') : null, crc = HS.create('crc32');
          const hbuf = new Uint8Array(HEAD_BYTES); let hl = 0;
          await IR.streamEntry(file, e, function (chunk) {
            if (hl < HEAD_BYTES) { const t = Math.min(HEAD_BYTES - hl, chunk.length); hbuf.set(chunk.subarray(0, t), hl); hl += t; }
            h1.update(chunk); if (h2) h2.update(chunk); crc.update(chunk);
          }, { isCancelled: cancelled });
          head = hbuf.subarray(0, hl);
          if (crc.value() !== (e.crc >>> 0)) { row.extraction_status = 'crc_mismatch'; row.error = 'CRC32 không khớp (' + crc.hex() + ' ≠ ' + ('00000000' + (e.crc >>> 0).toString(16)).slice(-8) + ')'; }
          row.sha1 = h1.hex(); summary.hashed++;
          if (h2) { row.sha256 = h2.hex(); summary.sha256Hashed++; }
          else row.error = row.error || '';
        }
      } catch (err) {
        if (err && err.code === 'CANCELLED') throw err;
        row.extraction_status = 'read_error'; row.error = (err && err.message) || String(err); summary.errors++;
        row.sha1 = ''; row.sha256 = '';
      }
      if (row.extraction_status === 'crc_mismatch') summary.errors++;

      if (head.length || row.extraction_status === 'ok') {
        const det = MB.identify(head, name, rel);
        row.magic_bytes = det.magic; row.detected_type = det.type; row.detected_format = det.format; row.type_source = det.source;
        row.ext_mismatch = det.extMismatch; row.priority = det.priority;
        if (det.extMismatch) { summary.mismatches++; if (!row.error) row.error = det.note; }
        if (AS.isArchiveLike(det)) {
          const d = AS.describe(head, det.format, e.size);
          row.archive_status = d.status; row.archive_info = JSON.stringify(d.info); summary.archives++;
        }
      } else { row.priority = MB.PRIORITY_EXT.has(row.extension); }
      if (inApp) { const rel2 = isRelated(rel); row.engine_related = rel2 === null ? 'unknown' : rel2 ? 'yes' : 'no'; }
      else row.engine_related = 'no';

      rows.push(row);
      summary.byType[row.detected_type] = (summary.byType[row.detected_type] || 0) + 1;
      summary.byStatus[row.extraction_status] = (summary.byStatus[row.extraction_status] || 0) + 1;
      summary.byArea[row.area] = (summary.byArea[row.area] || 0) + 1;
      if (row.priority) summary.priorityFiles++;
      doneBytes += e.size;

      const now = Date.now();
      if (now - lastTick > 250 || idx === items.length - 1) {
        lastTick = now;
        if (hooks.step) hooks.step('scan', 'running', (idx + 1) + '/' + items.length + ' file' + (mode === 'standard' && totalBytes ? ' · ' + Math.round(doneBytes / totalBytes * 100) + '%' : ''));
      }
    }
    if (mode === 'fast') log('WARNING', 'Chế độ nhanh: chỉ đọc phần đầu mỗi file để phân loại; chưa băm SHA-1/SHA-256', { files: items.length });
    return { columns: COLUMNS, rows: rows, summary: summary, options: { hashMode: mode, requested: opts.hashMode || 'auto', headBytes: HEAD_BYTES, sha256MaxBytes: SHA256_MAX_BYTES }, generatedAt: new Date().toISOString() };
  }

  /* ---------- manifest.csv ---------- */
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                 // chống CSV/formula injection khi mở bằng Excel
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(manifest) {
    const cols = manifest.columns, out = [cols.join(',')];
    manifest.rows.forEach(function (r) { out.push(cols.map(function (c) { return csvCell(r[c]); }).join(',')); });
    return '\uFEFF' + out.join('\r\n') + '\r\n';
  }

  NS.FileScanner = { scan: scan, toCsv: toCsv, COLUMNS: COLUMNS, HEAD_BYTES: HEAD_BYTES, SHA256_MAX_BYTES: SHA256_MAX_BYTES, resolveMode: resolveMode };
})(typeof window !== 'undefined' ? window : self);
