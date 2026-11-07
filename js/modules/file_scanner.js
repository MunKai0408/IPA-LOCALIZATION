/* file_scanner.js – Phase 3: quét TOÀN BỘ file trong IPA, phân loại bằng magic bytes, băm SHA-1/SHA-256, tạo manifest.
   Chỉ đọc IPA, không ghi/sửa dữ liệu gốc. Chạy được ở Worker và luồng chính. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const HEAD_BYTES = 4096;
  const SHA256_MAX_BYTES = 64 * 1024 * 1024;     // chế độ standard: SHA-256 chỉ cho file ≤ 64 MB (SHA-1 cho mọi file)
  const AUTO_STANDARD_MAX_IPA = 512 * 1024 * 1024; // auto: IPA lớn hơn mức này → fast
  const COLUMNS = ['relative_path', 'file_name', 'extension', 'file_size', 'compressed_size', 'sha1', 'sha256', 'duplicate_of', 'magic_bytes',
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

  const SMALL_MAX = 4 * 1024 * 1024;     // file ≤ 4 MB được xử lý song song; file lớn hơn xử lý tuần tự (giới hạn RAM)
  const CONCURRENCY = 8;
  const RATIO_FLAG_MIN_SIZE = 100 * 1024 * 1024, RATIO_FLAG = 200;

  /**
   * @param {File} file  @param {object} ipa  IpaResult  @param {object[]} zipEntries entries gốc của openZip
   * @param {{hashMode?:'auto'|'fast'|'standard'}} opts
   * @param {{log?:Function, isCancelled?:Function, step?:Function}} hooks
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
    const rows = new Array(items.length);
    let doneCount = 0, doneBytes = 0, lastTick = 0;

    async function processOne(idx) {
      if (cancelled()) throw new IR.IpaError('CANCELLED', 'Đã hủy');
      const e = items[idx];
      const inApp = e.name.indexOf(rootPath) === 0;
      const rel = inApp ? e.name.slice(rootPath.length) : e.name;
      const name = e.name.slice(e.name.lastIndexOf('/') + 1);
      const row = {
        relative_path: rel, file_name: name, extension: MB.extOf(name), file_size: e.size, compressed_size: e.csize,
        sha1: '', sha256: '', duplicate_of: '', magic_bytes: '', detected_type: 'Unknown', detected_format: '', type_source: 'none', ext_mismatch: false,
        engine_related: 'unknown', priority: false, area: areaOf(e.name, rootPath),
        extraction_status: 'ok', archive_status: '', archive_info: '', error: ''
      };
      let head = new Uint8Array(0);
      try {
        if (e.unsafe) { row.extraction_status = 'unsafe_path'; row.error = 'Đường dẫn không an toàn: ' + e.unsafe; }
        else if (e.symlink) { row.extraction_status = 'symlink_not_followed'; row.error = 'Symlink: không theo liên kết'; }
        else if (e.encrypted) { row.extraction_status = 'encrypted_zip'; row.error = 'Entry bị mã hóa ZIP, không đọc, không thử khóa'; }
        else if (e.method !== 0 && e.method !== 8) { row.extraction_status = 'unsupported_method'; row.error = 'Phương thức nén ' + e.method + ' chưa hỗ trợ'; }
        else if (e.size === 0) { if (mode === 'standard') { row.sha1 = HS.create('sha1').hex(); row.sha256 = HS.create('sha256').hex(); } }
        else if (mode === 'fast') {
          const r = await IR.readEntry(file, e, { max: Math.min(HEAD_BYTES, e.size), head: true });
          head = r.data; row.extraction_status = 'head_only';
        } else {
          const h1 = HS.create('sha1'), h2 = e.size <= SHA256_MAX_BYTES ? HS.create('sha256') : null, crc = HS.create('crc32');
          const hbuf = new Uint8Array(HEAD_BYTES); let hl = 0;
          await IR.streamEntry(file, e, function (chunk) {
            if (hl < HEAD_BYTES) { const t = Math.min(HEAD_BYTES - hl, chunk.length); hbuf.set(chunk.subarray(0, t), hl); hl += t; }
            h1.update(chunk); if (h2) h2.update(chunk); crc.update(chunk);
          }, { isCancelled: cancelled });
          head = hbuf.subarray(0, hl);
          if (crc.value() !== (e.crc >>> 0)) { row.extraction_status = 'crc_mismatch'; row.error = 'CRC32 không khớp (' + crc.hex() + ' ≠ ' + ('00000000' + (e.crc >>> 0).toString(16)).slice(-8) + ')'; }
          row.sha1 = h1.hex(); if (h2) row.sha256 = h2.hex();
        }
      } catch (err) {
        if (err && err.code === 'CANCELLED') throw err;
        row.extraction_status = 'read_error'; row.error = (err && err.message) || String(err); row.sha1 = ''; row.sha256 = '';
      }
      if (e.size >= RATIO_FLAG_MIN_SIZE && e.size / Math.max(e.csize, 1) > RATIO_FLAG)
        row.error = (row.error ? row.error + '; ' : '') + 'Tỉ lệ nén bất thường (' + Math.round(e.size / Math.max(e.csize, 1)) + ':1): nghi ZIP bomb, đã đọc có giới hạn theo kích thước khai báo';

      if (head.length || row.extraction_status === 'ok') {
        const det = MB.identify(head, name, rel);
        row.magic_bytes = det.magic; row.detected_type = det.type; row.detected_format = det.format; row.type_source = det.source;
        row.ext_mismatch = det.extMismatch; row.priority = det.priority;
        if (det.extMismatch && !row.error) row.error = det.note;
        if (AS.isArchiveLike(det)) { const d = AS.describe(head, det.format, e.size); row.archive_status = d.status; row.archive_info = JSON.stringify(d.info); }
      } else { row.priority = MB.PRIORITY_EXT.has(row.extension); }
      if (inApp) { const rel2 = isRelated(rel); row.engine_related = rel2 === null ? 'unknown' : rel2 ? 'yes' : 'no'; }
      else row.engine_related = 'no';

      rows[idx] = row; doneCount++; doneBytes += e.size;
      const now = Date.now();
      if (hooks.step && (now - lastTick > 250 || doneCount === items.length)) {
        lastTick = now;
        hooks.step('scan', 'running', doneCount + '/' + items.length + ' file' + (mode === 'standard' && totalBytes ? ' · ' + Math.round(doneBytes / totalBytes * 100) + '%' : ''));
      }
    }

    // Pha A: file nhỏ chạy song song (chế độ fast: mọi file, vì chỉ đọc đầu). Pha B: file lớn tuần tự.
    const small = [], big = [];
    items.forEach(function (e, i) { (mode === 'fast' || e.size <= SMALL_MAX ? small : big).push(i); });
    let next = 0;
    const lane = async function () { while (next < small.length) await processOne(small[next++]); };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, small.length) }, lane));
    for (let i = 0; i < big.length; i++) await processOne(big[i]);

    /* Tổng hợp theo thứ tự gốc (không phụ thuộc thứ tự hoàn thành song song) */
    const summary = { totalFiles: items.length, totalBytes: totalBytes, byType: {}, byStatus: {}, byArea: {}, hashed: 0, sha256Hashed: 0,
                      priorityFiles: 0, mismatches: 0, archives: 0, errors: 0, suspiciousRatio: 0, duplicates: { groups: 0, extraCopies: 0, wastedBytes: 0, top: [] } };
    const groups = new Map();
    rows.forEach(function (r) {
      summary.byType[r.detected_type] = (summary.byType[r.detected_type] || 0) + 1;
      summary.byStatus[r.extraction_status] = (summary.byStatus[r.extraction_status] || 0) + 1;
      summary.byArea[r.area] = (summary.byArea[r.area] || 0) + 1;
      if (r.sha1) summary.hashed++;
      if (r.sha256) summary.sha256Hashed++;
      if (r.priority) summary.priorityFiles++;
      if (r.ext_mismatch) summary.mismatches++;
      if (r.archive_status) summary.archives++;
      if (r.extraction_status === 'read_error' || r.extraction_status === 'crc_mismatch') summary.errors++;
      if (/Tỉ lệ nén bất thường/.test(r.error)) summary.suspiciousRatio++;
      if (r.sha1 && r.file_size > 0) {
        const k = r.sha1 + ':' + r.file_size, g = groups.get(k);
        if (g) { g.count++; g.paths.push(r.relative_path); r.duplicate_of = g.paths[0]; } else groups.set(k, { sha1: r.sha1, size: r.file_size, count: 1, paths: [r.relative_path] });
      }
    });
    const dups = [];
    groups.forEach(function (g) { if (g.count > 1) dups.push(g); });
    dups.forEach(function (g) { summary.duplicates.groups++; summary.duplicates.extraCopies += g.count - 1; summary.duplicates.wastedBytes += (g.count - 1) * g.size; });
    dups.sort(function (a, b) { return (b.count - 1) * b.size - (a.count - 1) * a.size; });
    summary.duplicates.top = dups.slice(0, 10).map(function (g) { return { sha1: g.sha1, size: g.size, count: g.count, paths: g.paths.slice(0, 3) }; });

    if (mode === 'fast') log('WARNING', 'Chế độ nhanh: chỉ đọc phần đầu mỗi file để phân loại; chưa băm SHA-1/SHA-256 nên chưa phát hiện được file trùng', { files: items.length });
    return { columns: COLUMNS, rows: rows, summary: summary, options: { hashMode: mode, requested: opts.hashMode || 'auto', headBytes: HEAD_BYTES, sha256MaxBytes: SHA256_MAX_BYTES, concurrency: CONCURRENCY }, generatedAt: new Date().toISOString() };
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
