/* metadata_dump.js – Phase 4: SUB-PHASE 4.2 (kiểm tra HEADER và PHIÊN BẢN của global-metadata.dat) + SUB-PHASE 4.3 (trích xuất STRING LITERAL).
   4.2 chỉ đọc phần đầu file (≤ READ_LIMIT byte). 4.3 ở file này chỉ trích xuất string literal (extractLiterals); assembly/image/class/method/field và dump.cs nằm ở js/modules/metadata_tables.js
   (bố cục đã xác minh từ mã nguồn Il2CppDumper; phần ghi chú “chưa xác minh” bên dưới là lịch sử của 4.2 và chỉ còn đúng cho phần kiểm tra chung ở inspectHeader).
   KHÔNG giải mã, KHÔNG phá obfuscation. Chạy được ở Worker và luồng chính.

   Về độ tin cậy của bố cục (quan trọng):
   - Đã đối chiếu từ mã nguồn công khai (xem SOURCES): magic = 0xFAB11BAF (u32 đầu file), version = int32 ngay sau, dải version đã biết.
   - Bố cục TỪNG TRƯỜNG của header theo từng phiên bản CHƯA được xác minh trong phiên này → module KHÔNG gán tên trường, KHÔNG nói phiên bản nào
     “được hỗ trợ đọc bảng”. Kiểm tra “chung” chỉ dùng giả định: header là dãy cặp int32 (offset, size|count) bắt đầu ở byte 8 và kết thúc tại
     offset của bảng đầu tiên (giá trị int32 ở byte 8). Giả định này chỉ có bằng chứng trực tiếp cho v24.2 (stringLiteralOffset = 264); với phiên bản khác,
     nếu giả định không dùng được thì trạng thái là header_unverified (không kết luận hỏng). 4.3 PHẢI xác minh bố cục từng phiên bản trước khi đọc bảng. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const SCHEMA = 'metadata_header/1';
  const READ_LIMIT = 4096;                         // số byte đầu tối đa được đọc
  const MAGIC_HEX = 'AF 1B B1 FA';                 // 0xFAB11BAF little-endian
  const MAGIC_U32 = 0xFAB11BAF;
  const VERSION_RANGE = [16, 200];                 // il2cpp_dumper 0.5.5 từ chối version <16 hoặc >200; Il2CppDumper (Perfare) chỉ nhận 16..31
  const VERSION_PLAUSIBLE_MAX = 1000;              // Il2CppDumper coi version <0 hoặc >1000 là “không phải metadata hợp lệ”
  // Danh sách version “đã biết” theo il2cpp_dumper 0.5.5 (docs.rs). Chỉ dùng để phân loại; KHÔNG kèm bố cục trường.
  const KNOWN_VERSIONS = [16, 17, 19, 20, 21, 22, 24, 27, 29, 31, 33, 35, 38, 39, 104, 105, 106];
  const HEADER_MIN = 16, HEADER_MAX = 1024;        // kích thước header chấp nhận ở kiểm tra chung (v24.2 = 264)
  const SOURCES = [
    'Perfare/Il2CppDumper – Il2CppDumper/Il2Cpp/Metadata.cs (magic 0xFAB11BAF, version là int32 kế tiếp, nhận 16..31, v24.2 khi stringLiteralOffset == 264)',
    'il2cpp_dumper 0.5.5 – src/il2cpp/metadata.rs (docs.rs; magic 0xFAB11BAF, nhận 16..200, danh sách version đã biết)'
  ];

  function hex(bytes, n) {
    const out = []; const m = Math.min(n, bytes.length);
    for (let i = 0; i < m; i++) out.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16).toUpperCase());
    return out.join(' ');
  }
  function find(info, level, code, message) { info.push({ level: level, code: code, message: message }); }

  function base(extra) {
    return Object.assign({
      schema: SCHEMA, sub_phase: '4.2', status: 'not_checked', applicable: false,
      path: null, entry_path: null, file_size: null, bytes_read: 0, read_limit: READ_LIMIT,
      magic: null, version: null, header: null,
      layout: { field_names_verified: false, field_parse_supported: false,
                note: 'Bố cục từng trường theo từng phiên bản CHƯA được xác minh; mọi cặp (offset, size) chỉ đánh số thứ tự, chưa gán tên. Sub-phase 4.3 phải xác minh bố cục trước khi đọc bảng.' },
      reference_sources: SOURCES.slice(), findings: [], reason: '', notes: [], raw_header_hex: ''
    }, extra || {});
  }

  /** Phân tích mảng byte đầu file. Thuần, đồng bộ, không ném lỗi với dữ liệu xấu.
   *  @param {Uint8Array} bytes  phần đầu file (≤ READ_LIMIT)  @param {number} fileSize  kích thước THẬT của file */
  function inspectHeader(bytes, fileSize) {
    const r = base({ applicable: true, file_size: fileSize, bytes_read: bytes ? bytes.length : 0 });
    if (!(bytes instanceof Uint8Array)) { r.status = 'invalid_header'; r.reason = 'Đầu vào không phải Uint8Array'; return r; }
    if (typeof fileSize !== 'number' || fileSize < 0 || !isFinite(fileSize)) { r.status = 'invalid_header'; r.reason = 'Kích thước file không hợp lệ'; return r; }
    r.raw_header_hex = hex(bytes, 64);
    const F = r.findings;

    if (fileSize === 0 || bytes.length < 4) {
      r.status = 'invalid_header';
      r.reason = fileSize === 0 ? 'File 0 byte' : 'File ngắn hơn 4 byte, không đọc được magic';
      find(F, 'error', 'too_small', r.reason); return r;
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magicHex = hex(bytes, 4), magicOk = dv.getUint32(0, true) === MAGIC_U32;
    r.magic = { hex: magicHex, expected: MAGIC_HEX, matches: magicOk };
    if (!magicOk) {
      r.status = 'bad_magic';
      r.reason = 'Magic không phải ' + MAGIC_HEX + '. File CÓ THỂ đã bị mã hóa/obfuscate hoặc không phải global-metadata.dat; không có cách xác định chắc chắn từ header.';
      find(F, 'error', 'bad_magic', 'Magic đọc được: ' + magicHex);
      r.notes.push('Không thử giải mã hay đoán khóa (mục 3 của prompt).');
      return r;
    }
    if (bytes.length < 8 || fileSize < 8) {
      r.status = 'invalid_header'; r.reason = 'Magic đúng nhưng file ngắn hơn 8 byte, thiếu trường version';
      find(F, 'error', 'too_small', r.reason); return r;
    }

    const ver = dv.getInt32(4, true);
    r.version = { value: ver, in_reference_list: KNOWN_VERSIONS.indexOf(ver) >= 0, reference_range: VERSION_RANGE.slice(), known_versions: KNOWN_VERSIONS.slice() };
    if (ver < 0 || ver > VERSION_PLAUSIBLE_MAX) {
      r.status = 'invalid_header'; r.reason = 'Giá trị version ' + ver + ' không hợp lý (ngoài 0–' + VERSION_PLAUSIBLE_MAX + '); header có thể hỏng hoặc đã bị biến đổi';
      find(F, 'error', 'version_implausible', r.reason); return r;
    }
    if (!r.version.in_reference_list) {
      r.status = 'unsupported_version';
      r.reason = 'Version ' + ver + (ver < VERSION_RANGE[0] || ver > VERSION_RANGE[1] ? ' nằm ngoài dải tham chiếu ' + VERSION_RANGE[0] + '–' + VERSION_RANGE[1] : ' không có trong danh sách version đã biết') +
                 '. Không đoán bố cục; chỉ giữ header thô.';
      find(F, 'warning', 'unsupported_version', r.reason);
      r.notes.push('Cần bổ sung parser cho version này từ nguồn đã kiểm chứng, không đoán offset/trường.');
      return r;
    }

    /* ---- Kiểm tra chung (không cần biết ý nghĩa trường) ---- */
    r.header = { first_table_offset: null, header_size: null, pair_count: 0, pairs: [], empty_tables: 0, max_table_end: null, trailing_bytes: null };
    if (bytes.length < 12 || fileSize < 12) {
      r.status = 'invalid_header'; r.reason = 'File ngắn hơn 12 byte: không đủ chỗ cho bảng offset đầu tiên'; find(F, 'error', 'too_small', r.reason); return r;
    }
    const H = dv.getInt32(8, true);
    r.header.first_table_offset = H;
    const usable = H >= HEADER_MIN && H <= HEADER_MAX && H % 4 === 0 && H <= bytes.length && H <= fileSize;
    if (!usable) {
      r.status = 'header_unverified';
      r.reason = 'Magic và version thuộc danh sách đã biết, nhưng giá trị int32 ở byte 8 (' + H + ') không dùng được làm kích thước header theo giả định chung ' +
                 '(' + HEADER_MIN + '–' + HEADER_MAX + ', chia hết cho 4, nằm trong ' + bytes.length + ' byte đã đọc và trong file). Không kết luận header hỏng vì bố cục version ' + ver + ' chưa được xác minh.';
      find(F, 'warning', 'generic_check_not_applicable', r.reason);
      return r;
    }
    r.header.header_size = H;
    const span = H - 8;
    if (span % 8 !== 0) find(F, 'warning', 'pairs_not_even', 'Vùng header sau byte 8 dài ' + span + ' byte, không chia hết cho 8: có thể chứa trường không theo cặp (offset,size). Chỉ kiểm tra ' + Math.floor(span / 8) + ' cặp đầu.');
    const n = Math.floor(span / 8);
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push({ index: i, offset: dv.getInt32(8 + i * 8, true), size: dv.getInt32(12 + i * 8, true) });
    r.header.pair_count = n; r.header.pairs = pairs;

    let errs = 0;
    pairs.forEach(function (p) {
      if (p.offset < 0 || p.size < 0) { errs++; find(F, 'error', 'negative', 'Cặp #' + p.index + ': giá trị âm (offset=' + p.offset + ', size=' + p.size + ')'); return; }
      if (p.size === 0) { r.header.empty_tables++; return; }
      if (p.offset < H) { errs++; find(F, 'error', 'offset_in_header', 'Cặp #' + p.index + ': offset ' + p.offset + ' nằm trong vùng header (< ' + H + ')'); }
      else if (p.offset > fileSize) { errs++; find(F, 'error', 'offset_beyond_file', 'Cặp #' + p.index + ': offset ' + p.offset + ' vượt kích thước file ' + fileSize); }
      else if (p.offset + p.size > fileSize) { errs++; find(F, 'error', 'range_beyond_file', 'Cặp #' + p.index + ': offset ' + p.offset + ' + size ' + p.size + ' = ' + (p.offset + p.size) + ' vượt kích thước file ' + fileSize); }
    });
    // chồng chéo: chỉ xét cặp hợp lệ, size>0. Nếu trường thứ hai là “count” thì độ dài thật ≥ giá trị này nên chồng chéo tìm thấy luôn là thật.
    const ranges = pairs.filter(function (p) { return p.size > 0 && p.offset >= H && p.offset + p.size <= fileSize; })
      .sort(function (a, b) { return a.offset - b.offset || a.index - b.index; });
    let maxEnd = 0, overlaps = 0;
    for (let i = 0; i < ranges.length; i++) {
      const cur = ranges[i];
      if (i > 0 && cur.offset < ranges[i - 1].offset + ranges[i - 1].size) {
        overlaps++;
        if (overlaps <= 10) find(F, 'warning', 'overlap', 'Cặp #' + ranges[i - 1].index + ' [' + ranges[i - 1].offset + ', ' + (ranges[i - 1].offset + ranges[i - 1].size) + ') chồng lên cặp #' + cur.index + ' bắt đầu ở ' + cur.offset);
      }
      if (cur.offset + cur.size > maxEnd) maxEnd = cur.offset + cur.size;
    }
    if (overlaps > 10) find(F, 'warning', 'overlap_more', 'Còn ' + (overlaps - 10) + ' chồng chéo khác chưa liệt kê');
    if (ranges.length) { r.header.max_table_end = maxEnd; r.header.trailing_bytes = fileSize - maxEnd; }
    r.header.overlaps = overlaps;

    if (errs > 0) {
      r.status = 'invalid_header';
      r.reason = errs + ' cặp offset/size không nhất quán với kích thước file (' + fileSize + ' byte). Header có thể bị cắt/hỏng, hoặc bố cục version ' + ver + ' khác giả định chung.';
    } else {
      r.status = 'generic_ok';
      r.reason = 'Magic đúng, version ' + ver + ' thuộc danh sách đã biết, ' + n + ' cặp offset/size nằm trong file' + (overlaps ? ' (' + overlaps + ' chồng chéo – xem cảnh báo)' : '') +
                 '. Đây CHỈ là kiểm tra chung: chưa xác minh tên/ý nghĩa từng trường.';
    }
    if (ranges.length && r.header.trailing_bytes > 0) find(F, 'info', 'trailing_bytes', r.header.trailing_bytes + ' byte sau bảng kết thúc xa nhất (có thể là padding hoặc bảng mà giả định chung không bao phủ)');
    return r;
  }

  /** Kết quả khi không thể/không cần đọc. status 'not_checked'. */
  function notChecked(reason) { const r = base(); r.reason = reason; return r; }

  /** Đọc header của metadata đã chọn ở 4.1 rồi kiểm tra. Không ném lỗi (trừ CANCELLED); lỗi đọc → status 'read_error'.
   *  @param {File} file  @param {UnityInfo} unity  kết quả UnityDump.discover  @param {Array} entries  ENTRY GỐC từ IpaReader.openZip
   *  @param {{isCancelled?:Function}} hooks */
  async function check(file, unity, entries, hooks) {
    hooks = hooks || {};
    if (!unity || typeof unity !== 'object' || !unity.metadata_input) return notChecked('Không có kết quả dò Unity (4.1)');
    const mi = unity.metadata_input;
    if (mi.status !== 'selected') {
      const r = notChecked('Không đọc metadata vì bước 4.1 chưa chọn được file (trạng thái: ' + mi.status + '). ' + (mi.reason || ''));
      r.applicable = false; return r;
    }
    const r0 = base({ applicable: true, path: mi.path, entry_path: mi.entry_path });
    if (!Array.isArray(entries) || !mi.entry_path) { r0.status = 'read_error'; r0.reason = 'Thiếu danh sách entry hoặc entry_path'; return r0; }
    const matches = entries.filter(function (e) { return e && !e.dir && e.name === mi.entry_path; });
    if (matches.length !== 1) {
      r0.status = 'read_error';
      r0.reason = matches.length === 0 ? 'Không tìm thấy entry “' + mi.entry_path + '” trong ZIP' : 'Có ' + matches.length + ' entry trùng tên “' + mi.entry_path + '”, không biết đọc entry nào';
      return r0;
    }
    if (hooks.isCancelled && hooks.isCancelled()) { const c = new Error('Đã hủy'); c.code = 'CANCELLED'; throw c; }
    const entry = matches[0];
    try {
      if (!NS.IpaReader || typeof NS.IpaReader.readEntry !== 'function') throw new Error('Thiếu IpaReader.readEntry');
      const res = await NS.IpaReader.readEntry(file, entry, { max: READ_LIMIT, head: true });
      const bytes = res.data.length > READ_LIMIT ? res.data.subarray(0, READ_LIMIT) : res.data;
      const r = inspectHeader(bytes, entry.size);
      r.path = mi.path; r.entry_path = mi.entry_path;
      if (mi.status === 'selected' && mi.candidates) {
        const c = mi.candidates.filter(function (x) { return x.entry_path === mi.entry_path; })[0];
        if (c && c.phase2_probe_version !== null && r.version && c.phase2_probe_version !== r.version.value) {
          find(r.findings, 'warning', 'probe_mismatch', 'Version đọc ở 4.2 (' + r.version.value + ') khác số probe nhanh của Phase 2 (' + c.phase2_probe_version + '); lấy số 4.2 làm căn cứ');
        }
      }
      return r;
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      r0.status = 'read_error';
      r0.reason = 'Không đọc được phần đầu file: ' + ((e && e.message) || e);
      r0.file_size = entry.size;
      find(r0.findings, 'error', (e && e.code) || 'read_error', r0.reason);
      return r0;
    }
  }


  /* ================= SUB-PHASE 4.3: TRÍCH XUẤT STRING LITERAL =================
     Căn cứ đã đối chiếu (2 nguồn công khai, xem LITERAL_SOURCES):
       - Il2CppDumper Metadata.cs: bảng literal = ReadMetadataClassArray<Il2CppStringLiteral>(header.stringLiteralOffset, header.stringLiteralSize) (size tính bằng BYTE,
         số phần tử = size / sizeof(struct)); dữ liệu: vị trí = header.stringLiteralDataOffset + literal.dataIndex, đọc literal.length byte, giải mã UTF-8.
       - il2cpp_dumper 0.5.5 structures.rs (tóm tắt): Il2CppStringLiteral = { u32 length (chỉ có trước v35), u32 dataIndex }; thứ tự trường header: string literal (offset,size),
         string literal data (offset,size), string (offset…) → ba cặp đầu = cặp #0 và #1 trong header.pairs.
     Chỉ hỗ trợ các version mà CẢ HAI nguồn đều nhận (LITERAL_VERSIONS). v≥35 (bỏ length) và header index biến thiên (v38+) → unsupported, KHÔNG đoán.
     assembly/namespace/class/method/field: struct Il2CppImage/TypeDefinition/MethodDefinition/FieldDefinition thay đổi theo version; chỉ có tóm tắt diễn giải, chưa có byte-layout xác minh → KHÔNG trích xuất. */
  const LITERAL_VERSIONS = [16, 17, 19, 20, 21, 22, 24, 27, 29, 31];
  const LITERAL_STRUCT_SIZE = 8;
  const LITERAL_MAX_TABLE = 64 * 1048576;     // 64 MiB bảng (8 triệu literal)
  const LITERAL_MAX_DATA = 256 * 1048576;     // 256 MiB vùng dữ liệu nạp vào RAM
  const LITERAL_SCHEMA = 'unity_string_literals/1';
  const LITERAL_SOURCES = [
    'Perfare/Il2CppDumper – Il2CppDumper/Il2Cpp/Metadata.cs (ReadMetadataClassArray(stringLiteralOffset, stringLiteralSize); Position = stringLiteralDataOffset + dataIndex; UTF8.GetString(length byte))',
    'il2cpp_dumper 0.5.5 – src/il2cpp/structures.rs (Il2CppStringLiteral: length [trước v35], dataIndex; thứ tự trường header)'
  ];
  const NOT_SUPPORTED = ['assemblies', 'namespaces', 'classes', 'methods', 'fields'];
  const NOT_SUPPORTED_REASON = 'Bố cục struct (Il2CppImageDefinition/TypeDefinition/MethodDefinition/FieldDefinition) thay đổi theo version và CHƯA được xác minh byte-by-byte từ nguồn đáng tin; không đoán. Cần nguồn mã (vd Il2CppDumper MetadataClasses.cs) được đọc đầy đủ.';

  function litBase(extra) {
    return Object.assign({ schema: LITERAL_SCHEMA, sub_phase: '4.3', status: 'not_eligible', reason: '', version: null, path: null, entry_path: null,
      source: null, count: 0, empty: 0, invalid_utf8: 0, out_of_range: 0, distinct: 0, total_text_bytes: 0, literals: [],
      limits: { max_table_bytes: LITERAL_MAX_TABLE, max_data_bytes: LITERAL_MAX_DATA }, reference_sources: LITERAL_SOURCES.slice(), notes: [] }, extra || {});
  }

  /** THUẦN: giải bảng literal từ hai vùng đã nạp. table: Uint8Array (bội của 8), data: Uint8Array. */
  function decodeLiterals(table, data) {
    const out = { literals: [], empty: 0, invalid_utf8: 0, out_of_range: 0, distinct: 0, total_text_bytes: 0 };
    const dv = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const strict = new TextDecoder('utf-8', { fatal: true }), loose = new TextDecoder('utf-8', { fatal: false });
    const seen = new Set(); const n = Math.floor(table.length / LITERAL_STRUCT_SIZE);
    for (let i = 0; i < n; i++) {
      const length = dv.getUint32(i * 8, true), idx = dv.getUint32(i * 8 + 4, true);
      const e = { index: i, text: null, length: length, data_index: idx, flags: [] };
      if (idx + length > data.length) { e.flags.push('out_of_range'); out.out_of_range++; }
      else {
        const slice = data.subarray(idx, idx + length);
        try { e.text = strict.decode(slice); } catch (_) { e.text = loose.decode(slice); e.flags.push('invalid_utf8'); out.invalid_utf8++; }
        if (length === 0) { e.flags.push('empty'); out.empty++; }
        out.total_text_bytes += length; seen.add(e.text);
      }
      out.literals.push(e);
    }
    out.distinct = seen.size;
    return out;
  }

  /** Trích xuất string literal. Không ném lỗi (trừ CANCELLED). Chỉ chạy khi header.status === 'generic_ok' và version ∈ LITERAL_VERSIONS.
   *  @param hooks {isCancelled?, progress?(0..1)} */
  async function extractLiterals(file, unity, entries, hooks) {
    hooks = hooks || {};
    const h = unity && unity.metadata_header;
    const r = litBase({ path: h ? h.path : null, entry_path: h ? h.entry_path : null, version: h && h.version ? h.version.value : null });
    if (!h || h.status !== 'generic_ok') { r.reason = 'Không trích xuất: header metadata chưa đạt kiểm tra chung (trạng thái: ' + (h ? h.status : 'không có') + ').'; return r; }
    if (LITERAL_VERSIONS.indexOf(h.version.value) < 0) {
      r.status = 'unsupported_version';
      r.reason = 'Version ' + h.version.value + ' chưa hỗ trợ trích xuất string literal (chỉ ' + LITERAL_VERSIONS.join(', ') + ' đã đối chiếu ở cả hai nguồn). Không đoán bố cục.'; return r;
    }
    const t = h.header.pairs[0], d = h.header.pairs[1], F = h.file_size;
    if (!t || !d) { r.status = 'invalid_table'; r.reason = 'Header thiếu cặp #0/#1'; return r; }
    r.source = { table: { offset: t.offset, size: t.size }, data: { offset: d.offset, size: d.size }, struct_size: LITERAL_STRUCT_SIZE };
    if (t.size % LITERAL_STRUCT_SIZE !== 0) { r.status = 'invalid_table'; r.reason = 'Kích thước bảng literal (' + t.size + ') không chia hết cho ' + LITERAL_STRUCT_SIZE + '; bố cục có thể khác giả định.'; return r; }
    if (t.size > LITERAL_MAX_TABLE || d.size > LITERAL_MAX_DATA) {
      r.status = 'too_large'; r.reason = 'Bảng (' + t.size + ' B) hoặc dữ liệu literal (' + d.size + ' B) vượt giới hạn bộ nhớ trình duyệt (' + LITERAL_MAX_TABLE + ' / ' + LITERAL_MAX_DATA + ').'; return r;
    }
    if (t.size === 0) { r.status = 'ok'; r.reason = 'Bảng string literal rỗng (0 phần tử).'; return r; }
    if (t.offset + t.size > F || d.offset + d.size > F) { r.status = 'invalid_table'; r.reason = 'Vùng literal vượt kích thước file'; return r; }
    const matches = (entries || []).filter(function (e) { return e && !e.dir && e.name === r.entry_path; });
    if (matches.length !== 1) { r.status = 'read_error'; r.reason = 'Không xác định được entry metadata (' + matches.length + ' khớp)'; return r; }
    const table = new Uint8Array(t.size), data = new Uint8Array(d.size);
    let pos = 0;
    const copy = function (chunk, region, off, size) {
      const s = Math.max(pos, off), e = Math.min(pos + chunk.length, off + size);
      if (e > s) region.set(chunk.subarray(s - pos, e - pos), s - off);
    };
    try {
      await NS.IpaReader.streamEntry(file, matches[0], function (chunk) {
        copy(chunk, table, t.offset, t.size); copy(chunk, data, d.offset, d.size);
        pos += chunk.length;
        if (hooks.progress) hooks.progress(pos / F);
      }, { isCancelled: hooks.isCancelled });
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      r.status = 'read_error'; r.reason = 'Không đọc được metadata: ' + ((e && e.message) || e); return r;
    }
    const dec = decodeLiterals(table, data);
    Object.assign(r, { count: dec.literals.length, empty: dec.empty, invalid_utf8: dec.invalid_utf8, out_of_range: dec.out_of_range, distinct: dec.distinct, total_text_bytes: dec.total_text_bytes });
    if (dec.literals.length >= 8 && dec.out_of_range / dec.literals.length > 0.5) {
      r.status = 'invalid_table';
      r.reason = dec.out_of_range + '/' + dec.literals.length + ' literal trỏ ra ngoài vùng dữ liệu: bố cục thực tế có thể khác giả định (hoặc dữ liệu bị mã hóa/obfuscate). Không xuất literal.';
      return r;
    }
    r.literals = dec.literals; r.status = 'ok';
    r.reason = 'Đã giải ' + r.count + ' string literal (UTF-8)' + (r.out_of_range ? '; ' + r.out_of_range + ' mục trỏ ngoài vùng dữ liệu (text=null)' : '') + (r.invalid_utf8 ? '; ' + r.invalid_utf8 + ' mục UTF-8 không hợp lệ (đã thay ký tự lỗi, có cờ)' : '') + '.';
    r.notes.push('Mỗi literal giữ index, length, data_index gốc; chuỗi trùng KHÔNG bị gộp.');
    return r;
  }

  /** Phần Unity metadata của report.json (Phase 9 gộp). */
  function toReportFields(h, lit, tables) {
    if (!h) return null;
    const o = { metadata_header_status: h.status, metadata_version: h.version ? h.version.value : null, metadata_header_generic_checked: h.status === 'generic_ok' };
    if (lit) { o.string_literals_status = lit.status; o.string_literals_count = lit.count; o.string_literals_invalid_utf8 = lit.invalid_utf8; o.string_literals_out_of_range = lit.out_of_range; }
    if (tables && tables.status === 'ok' && NS.MetadataTables) { Object.assign(o, NS.MetadataTables.toReportFields(tables)); o.metadata_not_supported = []; }
    else { if (tables) o.metadata_tables_status = tables.status; o.metadata_not_supported = NOT_SUPPORTED.slice(); }
    return o;
  }

  /** Nội dung Meta/metadata_summary.json. tables (tùy chọn) = kết quả MetadataTables.extractTables; không có hoặc không ok → partial=true và liệt kê phần chưa có. */
  function toSummary(h, lit, tables) {
    if (!h) return null;
    const tOk = !!(tables && tables.status === 'ok');
    const ns = {};
    if (!tOk) NOT_SUPPORTED.forEach(function (k) {
      ns[k] = { status: 'not_supported', reason: tables ? 'Bảng metadata: ' + tables.status + ' – ' + tables.reason : 'Chưa chạy trích xuất bảng metadata (cần header generic_ok và version có bố cục xác minh).' };
    });
    const tsum = tables ? { status: tables.status, reason: tables.reason, version: tables.version, layout: tables.layout, counts: tables.counts, struct_sizes: tables.struct_sizes,
      problem_counts: tables.problem_counts, name_problems: tables.name_problems, not_extracted: tables.not_extracted, reference_sources: tables.reference_sources, notes: tables.notes } : null;
    return { schema: 'metadata_summary/3', sub_phase: '4.3', partial: !tOk,
             note: tOk ? 'Đầy đủ phạm vi 4.3: header/version (4.2), string literal, assembly/image/type/method/field. Tên kiểu của field/tham số/return KHÔNG có (nằm trong binary); xem tables.not_extracted.'
                       : 'Có header/version (4.2) và string literal (nếu status=ok). Bảng assembly/class/method/field chưa có: xem not_supported.',
             header: h, tables: tsum,
             string_literals: lit ? { status: lit.status, reason: lit.reason, version: lit.version, count: lit.count, empty: lit.empty, distinct: lit.distinct, invalid_utf8: lit.invalid_utf8, out_of_range: lit.out_of_range, total_text_bytes: lit.total_text_bytes, source: lit.source } : null,
             not_supported: ns };
  }

  NS.MetadataDump = { SCHEMA: SCHEMA, READ_LIMIT: READ_LIMIT, MAGIC_HEX: MAGIC_HEX, KNOWN_VERSIONS: KNOWN_VERSIONS, VERSION_RANGE: VERSION_RANGE, SOURCES: SOURCES,
                      inspectHeader: inspectHeader, check: check, extractLiterals: extractLiterals, decodeLiterals: decodeLiterals, LITERAL_VERSIONS: LITERAL_VERSIONS, LITERAL_SCHEMA: LITERAL_SCHEMA, NOT_SUPPORTED: NOT_SUPPORTED, notChecked: notChecked, toReportFields: toReportFields, toSummary: toSummary };
})(typeof window !== 'undefined' ? window : self);
