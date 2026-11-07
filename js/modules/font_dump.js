/* font_dump.js – Phase 5, SUB-PHASE 5.1: PHÁT HIỆN và TRÍCH XUẤT NGUYÊN BẢN các file font truy cập được trong IPA.
   Phạm vi 5.1 (đúng prompt mục 12 phần “tìm font” + “Fonts/original/”): xác định file font theo NỘI DUNG (magic bytes) chứ không chỉ đuôi, kiểm tra cấu trúc header
   (không đọc family/glyph/cmap – đó là 5.2/5.3), đọc nguyên byte vào vùng kết quả riêng (KHÔNG sửa IPA), băm SHA-256, đối chiếu manifest và UIAppFonts.
   KHÔNG làm: phân tích metadata font, TMP, độ phủ tiếng Việt, parse UnityFS/asset bundle (chỉ liệt kê file có thể chứa font bên trong).
   Phụ thuộc call-time: NS.IpaReader.streamEntry, NS.Hash. Chạy được ở Worker và luồng chính. Không ném lỗi (trừ CANCELLED). */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const SCHEMA = 'fonts_discovery/1', INDEX_SCHEMA = 'font_index/1', FONTS_SCHEMA = 'fonts/1';
  const FONT_EXTS = ['ttf', 'otf', 'ttc', 'woff', 'woff2', 'fnt', 'bmfont', 'atlas'];
  const UNITY_CONTAINER_EXTS = ['assets', 'bundle', 'unity3d', 'ress', 'resource'];
  const LIMITS = { max_file_bytes: 64 * 1048576, max_total_bytes: 256 * 1048576, max_files: 2000, max_listed_unparsed: 200 };

  function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function ascii(b, o, n) { let s = ''; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; }

  /** Kiểm tra bảng thư mục sfnt tại offset `base`; trả danh sách vấn đề. Không đọc nội dung bảng. */
  function checkSfnt(b, base, size, problems, label) {
    if (base + 12 > b.length) { problems.push(label + ': header sfnt vượt file'); return false; }
    const n = u16(b, base + 4);
    if (n < 1 || n > 512) { problems.push(label + ': numTables=' + n + ' bất thường'); return false; }
    if (base + 12 + 16 * n > b.length) { problems.push(label + ': thư mục bảng (' + n + ' bảng) vượt file'); return false; }
    let okAll = true;
    for (let i = 0; i < n; i++) {
      const p = base + 12 + 16 * i, off = u32(b, p + 8), len = u32(b, p + 12);
      if (off + len > size) { problems.push(label + ': bảng "' + ascii(b, p, 4) + '" [' + off + ', +' + len + ') vượt kích thước file ' + size + ' (file bị cắt cụt?)'); okAll = false; }
    }
    return okAll;
  }

  /** THUẦN. Phân loại và kiểm tra cấu trúc dựa trên BYTE (không tin đuôi).
   *  @returns {{kind:'sfnt'|'woff'|'woff2'|'bmfont'|'atlas'|'not_font', format:string, valid:boolean|null, problems:string[], num_fonts?:number, num_tables?:number}}
   *  valid: true = cấu trúc đúng; false = nhận ra định dạng nhưng cấu trúc sai/cắt cụt; null = không thể xác minh (atlas). */
  function classifyBytes(bytes, ext) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0), size = b.length, problems = [];
    ext = String(ext || '').toLowerCase();
    if (size >= 4) {
      const m = ascii(b, 0, 4);
      if (m === '\u0000\u0001\u0000\u0000' || m === 'true' || m === 'OTTO') {
        const fmt = m === 'OTTO' ? 'OTF (CFF)' : (m === 'true' ? 'TTF (Apple)' : 'TTF');
        const ok = checkSfnt(b, 0, size, problems, 'sfnt');
        return { kind: 'sfnt', format: fmt, valid: ok, problems: problems, num_fonts: 1, num_tables: size >= 6 ? u16(b, 4) : null };
      }
      if (m === 'ttcf') {
        if (size < 12) return { kind: 'sfnt', format: 'TTC', valid: false, problems: ['TTC: header cụt'], num_fonts: null };
        const nf = u32(b, 8); let ok = true;
        if (nf < 1 || nf > 1024) { problems.push('TTC: numFonts=' + nf + ' bất thường'); ok = false; }
        else if (12 + 4 * nf > size) { problems.push('TTC: bảng offset vượt file'); ok = false; }
        else for (let i = 0; i < Math.min(nf, 64); i++) { if (!checkSfnt(b, u32(b, 12 + 4 * i), size, problems, 'font #' + i)) ok = false; }
        return { kind: 'sfnt', format: 'TTC', valid: ok, problems: problems, num_fonts: nf };
      }
      if (m === 'wOFF' || m === 'wOF2') {
        const w2 = m === 'wOF2', hdr = w2 ? 48 : 44;
        if (size < hdr) return { kind: w2 ? 'woff2' : 'woff', format: w2 ? 'WOFF2' : 'WOFF', valid: false, problems: ['header cụt'] };
        const len = u32(b, 8); let ok = true;
        if (len !== size) { problems.push('trường length=' + len + ' khác kích thước file ' + size + (len > size ? ' (file bị cắt cụt?)' : '')); ok = false; }
        const nt = u16(b, 12); if (nt < 1) { problems.push('numTables=0'); ok = false; }
        return { kind: w2 ? 'woff2' : 'woff', format: w2 ? 'WOFF2' : 'WOFF', valid: ok, problems: problems, num_tables: nt };
      }
    }
    if (ext === 'fnt' || ext === 'bmfont') {
      if (size >= 4 && b[0] === 0x42 && b[1] === 0x4D && b[2] === 0x46) {
        return b[3] === 3 ? { kind: 'bmfont', format: 'BMFont binary v3', valid: true, problems: [] }
          : { kind: 'bmfont', format: 'BMFont binary (version ' + b[3] + ')', valid: false, problems: ['Chỉ nhận BMFont binary v3'] };
      }
      const head = ascii(b, 0, Math.min(size, 2048)).replace(/^ï»¿/, '').replace(/^\s+/, '');
      if (/^info\s+face=/.test(head)) return { kind: 'bmfont', format: 'BMFont text', valid: /\scommon\s+lineHeight=/.test(head) || /\ncommon\s/.test(head), problems: /\scommon\s+lineHeight=/.test(head) || /\ncommon\s/.test(head) ? [] : ['Thiếu dòng "common"'] };
      if (/^<\?xml|^<font[\s>]/i.test(head) && /<info\s/.test(head)) return { kind: 'bmfont', format: 'BMFont XML', valid: /<common\s/.test(head), problems: /<common\s/.test(head) ? [] : ['Thiếu phần tử <common>'] };
      return { kind: 'not_font', format: 'Không nhận ra', valid: false, problems: ['Đuôi .' + ext + ' nhưng không phải BMFont text/XML/binary v3 (có thể là định dạng khác)'] };
    }
    if (ext === 'atlas') return { kind: 'atlas', format: 'Atlas (đuôi .atlas, chưa xác minh là font atlas)', valid: null, problems: ['Không xác minh được đây có phải atlas của font; cần đối chiếu ở sub-phase sau'] };
    return { kind: 'not_font', format: 'Không phải font', valid: false, problems: [] };
  }

  function extOf(name) { const i = name.lastIndexOf('.'); return i < 0 || i === name.length - 1 ? '' : name.slice(i + 1).toLowerCase(); }
  function baseOf(p) { return p.slice(p.lastIndexOf('/') + 1); }

  /** THUẦN. Chọn entry ứng viên: đuôi font HOẶC manifest nhận Font theo magic bytes. entries = ENTRY GỐC (có name, size, dir, unsafe…). */
  function selectCandidates(entries, manifest, rootPath) {
    const rows = new Map();
    if (manifest && Array.isArray(manifest.rows)) manifest.rows.forEach(function (r) { rows.set(r.relative_path, r); });
    const out = [], unity = [];
    (entries || []).forEach(function (e) {
      if (!e || e.dir) return;
      const inApp = rootPath && e.name.indexOf(rootPath) === 0, rel = inApp ? e.name.slice(rootPath.length) : e.name, row = rows.get(rel) || null, ext = extOf(e.name);
      const byExt = FONT_EXTS.indexOf(ext) >= 0, byMagic = !!(row && row.detected_type === 'Font');
      if (byExt || byMagic) out.push({ entry: e, rel: rel, row: row, ext: ext, selected_by: byExt && byMagic ? 'ext+magic' : byExt ? 'ext' : 'magic' });
      else if (inApp && (UNITY_CONTAINER_EXTS.indexOf(ext) >= 0 || (row && row.detected_type === 'Unity asset'))) unity.push({ path: rel, size: e.size, detected_format: row ? row.detected_format : '' });
    });
    return { candidates: out, unity_containers: unity, manifest_used: !!manifest };
  }

  function safeOutPath(rel) {
    const parts = String(rel).split('/');
    if (parts.some(function (p) { return p === '..' || p === '.' || p === ''; }) || /^[a-zA-Z]:|^\\|\0/.test(rel)) return null;
    return 'Fonts/original/' + parts.join('/');
  }

  function baseResult() {
    return { schema: SCHEMA, sub_phase: '5.1', status: 'not_run', reason: '', items: [], summary: null, app_fonts_check: [], not_analyzed: { unity_containers: { count: 0, listed: [], note: '' } },
      limits: Object.assign({}, LIMITS), limitations: [], warnings: [], source: { manifest_used: false } };
  }
  const NOT_DONE = ['family/subfamily/PostScript name/version (5.2)', 'bảng ký tự cmap và độ phủ tiếng Việt (5.2/5.3)', 'TMP_FontAsset và font nằm trong UnityFS/asset bundle (chưa parse bundle)',
    'giải mã atlas bitmap của font'];

  /** Phát hiện + trích xuất. Trả {fonts:Result (JSON thuần), files:{ 'Fonts/original/...': Uint8Array }}. Chỉ ném CANCELLED.
   *  @param ipa IpaResult phần đã có (app.appFonts, appRoot, manifest) – hooks {isCancelled?, progress?(0..1), log?(level,msg,details)} */
  async function discover(file, ipa, entries, hooks) {
    hooks = hooks || {};
    const IR = NS.IpaReader, HS = NS.Hash, cancelled = hooks.isCancelled || function () { return false; };
    const res = baseResult(), files = {};
    res.limitations = NOT_DONE.slice();
    try {
      if (!ipa || !Array.isArray(entries)) { res.status = 'not_run'; res.reason = 'Thiếu dữ liệu IPA/entries'; return { fonts: res, files: files }; }
      const sel = selectCandidates(entries, ipa.manifest || null, ipa.appRoot || '');
      res.source.manifest_used = sel.manifest_used;
      if (!sel.manifest_used) res.warnings.push('Không có manifest Phase 3: chỉ chọn ứng viên theo đuôi file; font không có đuôi sẽ không được thấy.');
      const un = sel.unity_containers;
      res.not_analyzed.unity_containers = { count: un.length, listed: un.slice(0, LIMITS.max_listed_unparsed), note: un.length ? 'File asset/bundle Unity CÓ THỂ chứa Font/TMP_FontAsset bên trong; sub-phase 5.1 không parse asset bundle nên không biết có hay không.' : '' };
      const cands = sel.candidates.slice(0, LIMITS.max_files);
      if (sel.candidates.length > cands.length) res.warnings.push('Có ' + sel.candidates.length + ' ứng viên, chỉ xử lý ' + LIMITS.max_files + ' đầu tiên.');
      let total = 0, done = 0; const seen = new Map();
      for (const c of cands) {
        if (cancelled()) throw new IR.IpaError('CANCELLED', 'Đã hủy');
        const e = c.entry, row = c.row;
        const item = { id: res.items.length, path: c.rel, zip_path: e.name, file_name: baseOf(e.name), extension: c.ext, size: e.size, selected_by: c.selected_by,
          kind: null, format: null, valid: null, is_font: false, problems: [], extraction_status: 'pending', extracted_path: null, sha256: null, manifest_sha256: row && row.sha256 ? row.sha256 : null,
          hash_match: null, duplicate_of: null, ext_mismatch: false, declared_in_plist: false, error: null, analysis_status: 'not_analyzed' };
        res.items.push(item);
        const outPath = safeOutPath(c.rel);
        if (e.unsafe || !outPath) { item.extraction_status = 'unsafe_path'; item.error = 'Đường dẫn không an toàn: ' + (e.unsafe || c.rel); }
        else if (e.symlink) { item.extraction_status = 'symlink_not_followed'; item.error = 'Symlink: không theo liên kết'; }
        else if (e.encrypted) { item.extraction_status = 'encrypted_zip'; item.error = 'Entry bị mã hóa ZIP; không đọc, không thử khóa'; }
        else if (e.method !== 0 && e.method !== 8) { item.extraction_status = 'unsupported_method'; item.error = 'Phương thức nén ' + e.method + ' chưa hỗ trợ'; }
        else if (e.size > LIMITS.max_file_bytes) { item.extraction_status = 'skipped_too_large'; item.error = 'File ' + e.size + ' B vượt giới hạn ' + LIMITS.max_file_bytes + ' B cho mỗi font'; }
        else if (total + e.size > LIMITS.max_total_bytes) { item.extraction_status = 'skipped_budget'; item.error = 'Vượt tổng giới hạn bộ nhớ ' + LIMITS.max_total_bytes + ' B'; }
        else {
          try {
            const buf = new Uint8Array(e.size); let pos = 0;
            const h = HS.create('sha256');
            await IR.streamEntry(file, e, function (chunk) { buf.set(chunk, pos); pos += chunk.length; h.update(chunk); }, { isCancelled: cancelled });
            if (pos !== e.size) throw new Error('Đọc ' + pos + ' byte, khai báo ' + e.size);
            item.sha256 = h.hex();
            const cl = classifyBytes(buf, c.ext);
            item.kind = cl.kind; item.format = cl.format; item.valid = cl.valid; item.problems = cl.problems.slice();
            if (cl.num_fonts !== undefined) item.num_fonts = cl.num_fonts;
            if (cl.num_tables !== undefined && cl.num_tables !== null) item.num_tables = cl.num_tables;
            item.hash_match = item.manifest_sha256 ? item.manifest_sha256 === item.sha256 : null;
            if (item.hash_match === false) item.problems.push('SHA-256 khác manifest');
            if (cl.kind === 'not_font') { item.extraction_status = 'not_font_content'; item.error = 'Nội dung không phải font: ' + (cl.problems[0] || 'không nhận ra'); }
            else {
              files[outPath] = buf; total += e.size; item.extraction_status = 'extracted'; item.extracted_path = outPath;
              item.is_font = cl.valid === true;
              const expectExt = cl.kind === 'sfnt' ? (cl.format === 'TTC' ? ['ttc'] : cl.format === 'OTF (CFF)' ? ['otf'] : ['ttf']) : ({ woff: ['woff'], woff2: ['woff2'], bmfont: ['fnt', 'bmfont'], atlas: ['atlas'] }[cl.kind] || []);
              item.ext_mismatch = expectExt.indexOf(c.ext) < 0;
              const k = item.sha256 + ':' + e.size; if (seen.has(k)) item.duplicate_of = seen.get(k); else seen.set(k, item.path);
            }
          } catch (err) {
            if (err && err.code === 'CANCELLED') throw err;
            item.extraction_status = 'read_error'; item.error = (err && err.message) || String(err);
          }
        }
        done++; if (hooks.progress) hooks.progress(done / Math.max(1, cands.length));
      }
      // đối chiếu UIAppFonts
      const declared = (ipa.app && Array.isArray(ipa.app.appFonts)) ? ipa.app.appFonts : [];
      res.app_fonts_check = declared.map(function (name) {
        const nb = baseOf(String(name)), m = res.items.filter(function (it) { return it.path === name || it.file_name === nb; });
        m.forEach(function (it) { it.declared_in_plist = true; });
        return { declared: name, status: m.length ? 'found' : 'missing', paths: m.map(function (it) { return it.path; }) };
      });
      const missing = res.app_fonts_check.filter(function (x) { return x.status === 'missing'; });
      if (missing.length) res.warnings.push(missing.length + ' font khai báo trong UIAppFonts không thấy file tương ứng trong IPA.');
      const by = function (st) { return res.items.filter(function (it) { return it.extraction_status === st; }).length; };
      const fmt = {}; res.items.forEach(function (it) { if (it.extraction_status === 'extracted') fmt[it.format] = (fmt[it.format] || 0) + 1; });
      res.summary = { candidates: res.items.length, extracted: by('extracted'), fonts_valid: res.items.filter(function (it) { return it.is_font; }).length,
        invalid_or_unverified: res.items.filter(function (it) { return it.extraction_status === 'extracted' && !it.is_font; }).length, not_font_content: by('not_font_content'),
        skipped: by('skipped_too_large') + by('skipped_budget'), read_errors: by('read_error'), unsafe_or_unreadable: by('unsafe_path') + by('symlink_not_followed') + by('encrypted_zip') + by('unsupported_method'),
        duplicates: res.items.filter(function (it) { return it.duplicate_of; }).length, ext_mismatch: res.items.filter(function (it) { return it.ext_mismatch; }).length,
        hash_mismatch: res.items.filter(function (it) { return it.hash_match === false; }).length, total_bytes: total, by_format: fmt,
        app_fonts_declared: declared.length, app_fonts_missing: missing.length, unity_containers_unparsed: un.length };
      res.status = res.items.length === 0 ? 'no_fonts' : (res.summary.read_errors || res.summary.skipped || res.summary.unsafe_or_unreadable ? 'partial' : 'ok');
      res.reason = res.items.length === 0 ? 'Không tìm thấy file font theo đuôi hoặc magic bytes' + (un.length ? '; có ' + un.length + ' file Unity asset/bundle chưa parse nên font bên trong (nếu có) chưa được liệt kê' : '') + '.'
        : 'Đã trích xuất ' + res.summary.extracted + '/' + res.summary.candidates + ' ứng viên (' + res.summary.fonts_valid + ' font hợp lệ)' + (res.status === 'partial' ? '; một phần bị bỏ qua/lỗi (xem từng mục)' : '') + '.';
      return { fonts: res, files: files };
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      res.status = 'error'; res.reason = 'Lỗi khi phát hiện font: ' + ((e && e.message) || e); return { fonts: res, files: files };
    }
  }

  /** Fonts/font_index.json – chỉ dữ liệu thật; không chứa byte. */
  function toFontIndex(res) {
    if (!res) return null;
    return { schema: INDEX_SCHEMA, sub_phase: '5.1', status: res.status, reason: res.reason, summary: res.summary, source: res.source, items: res.items.map(function (it) {
      return { id: it.id, path: it.path, extracted_path: it.extracted_path, size: it.size, extension: it.extension, selected_by: it.selected_by, kind: it.kind, format: it.format, valid: it.valid,
        problems: it.problems, extraction_status: it.extraction_status, sha256: it.sha256, manifest_sha256: it.manifest_sha256, hash_match: it.hash_match, duplicate_of: it.duplicate_of,
        ext_mismatch: it.ext_mismatch, declared_in_plist: it.declared_in_plist, error: it.error };
    }), app_fonts_check: res.app_fonts_check, not_analyzed: res.not_analyzed, warnings: res.warnings, limits: res.limits, limitations: res.limitations };
  }
  /** Fonts/fonts.json – ở 5.1 chỉ phần phát hiện; mọi trường metadata = null và analysis_status='not_analyzed' (5.2 điền). Không bịa. */
  function toFontsJson(res) {
    if (!res) return null;
    return { schema: FONTS_SCHEMA, sub_phase: '5.1', note: 'Mới có phát hiện/trích xuất (5.1). Family/subfamily/PostScript/version/glyph/độ phủ chưa phân tích (5.2/5.3).',
      fonts: res.items.filter(function (it) { return it.extraction_status === 'extracted'; }).map(function (it) {
        return { id: it.id, path: it.path, extracted_path: it.extracted_path, format: it.format, size: it.size, sha256: it.sha256, valid_structure: it.valid, is_font: it.is_font,
          family: null, subfamily: null, postscript_name: null, version: null, glyph_count: null, analysis_status: 'not_analyzed' };
      }) };
  }
  function toReportFields(res) {
    if (!res) return null;
    const s = res.summary || {};
    return { fonts_status: res.status, font_candidates: s.candidates || 0, font_files_extracted: s.extracted || 0, font_files_valid: s.fonts_valid || 0, font_files_invalid_or_unverified: s.invalid_or_unverified || 0,
      font_files_skipped: s.skipped || 0, font_read_errors: s.read_errors || 0, font_app_fonts_missing: s.app_fonts_missing || 0, font_unity_containers_unparsed: s.unity_containers_unparsed || 0 };
  }

  NS.FontDump = { SCHEMA: SCHEMA, INDEX_SCHEMA: INDEX_SCHEMA, FONTS_SCHEMA: FONTS_SCHEMA, FONT_EXTS: FONT_EXTS, LIMITS: LIMITS, NOT_DONE: NOT_DONE,
    classifyBytes: classifyBytes, selectCandidates: selectCandidates, discover: discover, toFontIndex: toFontIndex, toFontsJson: toFontsJson, toReportFields: toReportFields, safeOutPath: safeOutPath };
})(typeof window !== 'undefined' ? window : self);
