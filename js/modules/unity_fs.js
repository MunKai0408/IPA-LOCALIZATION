/* unity_fs.js – Phase 5, SUB-PHASE 5.2a: PARSER CONTAINER UnityFS (AssetBundle "UnityFS\0").
   Phạm vi: đọc header, giải nén bảng "blocks + directory" (LZ4/LZ4HC/LZMA/không nén), liệt kê block và node, giải nén NỘI DUNG MỘT NODE theo yêu cầu.
   KHÔNG làm: parse SerializedFile (danh sách object, TextAsset/Font/TMP…), UnityWeb/UnityRaw/UnityArchive (định dạng cũ), LZHAM, giải mã/bẻ khóa bundle bị mã hóa riêng.
   Nguồn bố cục: kiến thức về định dạng UnityFS như AssetStudio/UnityPy mô tả (header: signature, version BE, minPlayerVersion, unityRevision, size int64 BE, compressedInfoSize, uncompressedInfoSize, flags;
   bảng info: hash 16B, blocks {u32 usize,u32 csize,u16 flags}, nodes {i64 offset,i64 size,u32 flags,cstr path}). KHÔNG có bản tham chiếu tải được trong phiên viết → cách căn lề dữ liệu
   được TỰ KIỂM bằng tổng kích thước block so với kích thước file (xem chooseDataStart), và mọi kết luận chỉ được kiểm bằng fixture tự dựng; CHƯA kiểm trên bundle thật.
   Phụ thuộc call-time (chỉ scan): NS.IpaReader.readEntry. Chạy được ở Worker và luồng chính. Không ném lỗi (trừ CANCELLED) ở API mức cao. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const SCHEMA = 'unityfs_index/1', BUNDLE_SCHEMA = 'unityfs_bundle/1';
  const LIMITS = { max_bundle_bytes: 256 * 1048576, max_info_bytes: 64 * 1048576, max_blocks: 200000, max_nodes: 100000, max_node_bytes: 256 * 1048576, max_bundles: 500, max_listed_nodes: 2000, head_bytes: 4096 };
  const COMPRESSION = { 0: 'none', 1: 'LZMA', 2: 'LZ4', 3: 'LZ4HC', 4: 'LZHAM' };
  const NOT_DONE = ['SerializedFile bên trong node (danh sách object, TextAsset, Font, TMP_FontAsset, Texture2D…)', 'UnityWeb/UnityRaw/UnityArchive (định dạng cũ)', 'LZHAM', 'bundle mã hóa riêng của game'];

  class FsError extends Error { constructor(code, msg) { super(msg); this.name = 'FsError'; this.code = code; } }

  /* ---------- byte helpers ---------- */
  function u16be(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u32be(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function i32be(b, o) { return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; }
  /** int64 big-endian → number; null nếu âm hoặc > 2^53-1 (không an toàn). */
  function i64be(b, o) { const hi = i32be(b, o), lo = u32be(b, o + 4); if (hi < 0 || hi > 0x1FFFFF) return null; return hi * 4294967296 + lo; }
  function cstr(b, o, max) { let i = o; const end = Math.min(b.length, o + max); while (i < end && b[i] !== 0) i++; if (i >= end) return null; return { s: utf8(b.subarray(o, i)), next: i + 1 }; }
  function utf8(u8) { try { return new TextDecoder('utf-8', { fatal: false }).decode(u8); } catch (e) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; } }
  function ascii(b, o, n) { let s = ''; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; }
  function align16(n) { return (n + 15) & ~15; }

  /* ---------- LZ4 (block format) ---------- */
  function lz4Block(src, dstSize) {
    const dst = new Uint8Array(dstSize); let sp = 0, dp = 0; const n = src.length;
    while (sp < n) {
      const token = src[sp++]; let lit = token >> 4;
      if (lit === 15) { let s; do { if (sp >= n) throw new FsError('LZ4_BAD', 'LZ4: thiếu byte độ dài literal'); s = src[sp++]; lit += s; } while (s === 255); }
      if (sp + lit > n || dp + lit > dstSize) throw new FsError('LZ4_BAD', 'LZ4: literal vượt vùng dữ liệu');
      dst.set(src.subarray(sp, sp + lit), dp); sp += lit; dp += lit;
      if (sp >= n) break;                                           // khối cuối chỉ có literal
      if (sp + 2 > n) throw new FsError('LZ4_BAD', 'LZ4: thiếu offset');
      const off = src[sp] | (src[sp + 1] << 8); sp += 2;
      if (off === 0 || off > dp) throw new FsError('LZ4_BAD', 'LZ4: offset ' + off + ' không hợp lệ tại ' + dp);
      let ml = token & 15;
      if (ml === 15) { let s; do { if (sp >= n) throw new FsError('LZ4_BAD', 'LZ4: thiếu byte độ dài match'); s = src[sp++]; ml += s; } while (s === 255); }
      ml += 4;
      if (dp + ml > dstSize) throw new FsError('LZ4_BAD', 'LZ4: match vượt kích thước đích');
      for (let i = 0, from = dp - off; i < ml; i++) dst[dp++] = dst[from + i];     // chồng lấn: sao chép từng byte
    }
    if (dp !== dstSize) throw new FsError('LZ4_BAD', 'LZ4: giải nén ra ' + dp + ' byte, khai báo ' + dstSize);
    return dst;
  }

  /* ---------- LZMA (raw: 5 byte [props, dictSize u32 LE] + luồng; kích thước đích biết trước) ---------- */
  function lzma(src, dstSize) {
    if (src.length < 6) throw new FsError('LZMA_BAD', 'LZMA: dữ liệu quá ngắn');
    let pr = src[0]; if (pr >= 225) throw new FsError('LZMA_BAD', 'LZMA: byte props ' + pr + ' không hợp lệ');
    const lc = pr % 9; pr = (pr / 9) | 0; const lp = pr % 5, pb = (pr / 5) | 0;
    const out = new Uint8Array(dstSize); let pos = 5, outPos = 0, range = 0xFFFFFFFF, code = 0;
    if (src[pos++] !== 0) throw new FsError('LZMA_BAD', 'LZMA: byte đầu của range coder phải = 0');
    for (let i = 0; i < 4; i++) code = ((code << 8) | src[pos++]) >>> 0;
    const n = src.length;
    /* bố cục mảng xác suất */
    const O_MATCH = 0, O_REP = O_MATCH + 192, O_G0 = O_REP + 12, O_G1 = O_G0 + 12, O_G2 = O_G1 + 12, O_REP0L = O_G2 + 12, O_SLOT = O_REP0L + 192, O_SPEC = O_SLOT + 256, O_ALIGN = O_SPEC + 128,
      O_LEN = O_ALIGN + 16, LEN_SZ = 2 + 128 + 128 + 256, O_RLEN = O_LEN + LEN_SZ, O_LIT = O_RLEN + LEN_SZ, total = O_LIT + (0x300 << (lc + lp));
    const P = new Uint16Array(total).fill(1024);
    function norm() { if (range < 16777216) { if (pos >= n) throw new FsError('LZMA_BAD', 'LZMA: hết dữ liệu nguồn'); range = (range << 8) >>> 0; code = ((code << 8) | src[pos++]) >>> 0; } }
    function bit(i) {
      norm(); const p = P[i], bound = (range >>> 11) * p;
      if (code < bound) { range = bound; P[i] = p + ((2048 - p) >> 5); return 0; }
      range -= bound; code -= bound; P[i] = p - (p >> 5); return 1;
    }
    function tree(base, nb) { let m = 1; for (let i = 0; i < nb; i++) m = (m << 1) + bit(base + m); return m - (1 << nb); }
    function rtree(base, nb) { let m = 1, s = 0; for (let i = 0; i < nb; i++) { const b = bit(base + m); m = (m << 1) + b; s |= b << i; } return s; }
    function direct(nb) { let r = 0; for (let i = 0; i < nb; i++) { norm(); range >>>= 1; let b = 0; if (code >= range) { code -= range; b = 1; } r = ((r << 1) | b) >>> 0; } return r; }
    function len(o, ps) {
      if (!bit(o)) return tree(o + 2 + (ps << 3), 3);
      if (!bit(o + 1)) return 8 + tree(o + 2 + 128 + (ps << 3), 3);
      return 16 + tree(o + 2 + 256, 8);
    }
    let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0; const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
    while (outPos < dstSize) {
      const ps = outPos & pbMask;
      if (!bit(O_MATCH + (state << 4) + ps)) {
        const prev = outPos > 0 ? out[outPos - 1] : 0, base = O_LIT + 0x300 * (((outPos & lpMask) << lc) + (prev >> (8 - lc)));
        let sym = 1;
        if (state >= 7) {
          if (rep0 >= outPos) throw new FsError('LZMA_BAD', 'LZMA: khoảng cách match vượt dữ liệu');
          let mb = out[outPos - rep0 - 1];
          do { const mbit = (mb >> 7) & 1; mb <<= 1; const b = bit(base + ((1 + mbit) << 8) + sym); sym = (sym << 1) | b; if (mbit !== b) break; } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | bit(base + sym);
        out[outPos++] = sym & 0xFF; state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6; continue;
      }
      let l;
      if (bit(O_REP + state)) {
        if (outPos === 0) throw new FsError('LZMA_BAD', 'LZMA: rep match khi chưa có dữ liệu');
        if (!bit(O_G0 + state)) {
          if (!bit(O_REP0L + (state << 4) + ps)) { if (rep0 >= outPos) throw new FsError('LZMA_BAD', 'LZMA: short rep ngoài vùng'); state = state < 7 ? 9 : 11; out[outPos] = out[outPos - rep0 - 1]; outPos++; continue; }
        } else {
          let d;
          if (!bit(O_G1 + state)) d = rep1; else { if (!bit(O_G2 + state)) d = rep2; else { d = rep3; rep3 = rep2; } rep2 = rep1; }
          rep1 = rep0; rep0 = d;
        }
        l = len(O_RLEN, ps); state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2; rep2 = rep1; rep1 = rep0; l = len(O_LEN, ps); state = state < 7 ? 7 : 10;
        const slot = tree(O_SLOT + ((l < 4 ? l : 3) << 6), 6);
        if (slot < 4) rep0 = slot;
        else {
          const nd = (slot >> 1) - 1; rep0 = ((2 | (slot & 1)) << nd) >>> 0;
          if (slot < 14) rep0 = (rep0 + rtree(O_SPEC + rep0 - slot, nd)) >>> 0;
          else { rep0 = (rep0 + (direct(nd - 4) << 4 >>> 0)) >>> 0; rep0 = (rep0 + rtree(O_ALIGN, 4)) >>> 0; if (rep0 === 0xFFFFFFFF) throw new FsError('LZMA_BAD', 'LZMA: gặp end marker khi chưa đủ dữ liệu (' + outPos + '/' + dstSize + ')'); }
        }
      }
      l += 2;
      if (rep0 >= outPos) throw new FsError('LZMA_BAD', 'LZMA: khoảng cách match ' + (rep0 + 1) + ' > đã giải ' + outPos);
      if (outPos + l > dstSize) throw new FsError('LZMA_BAD', 'LZMA: match vượt kích thước đích');
      for (let i = 0, from = outPos - rep0 - 1; i < l; i++) out[outPos++] = out[from + i];
    }
    return out;
  }

  /** Giải nén theo mã nén UnityFS. 0 = không nén. Ném FsError('UNSUPPORTED_COMPRESSION'|'*_BAD'|'SIZE'). */
  function decompress(method, src, dstSize) {
    if (!(dstSize >= 0) || dstSize > LIMITS.max_bundle_bytes) throw new FsError('SIZE', 'Kích thước giải nén ' + dstSize + ' vượt giới hạn');
    if (method === 0) { if (src.length !== dstSize) throw new FsError('SIZE', 'Không nén nhưng kích thước nguồn ' + src.length + ' ≠ ' + dstSize); return src; }
    if (method === 1) return lzma(src, dstSize);
    if (method === 2 || method === 3) return lz4Block(src, dstSize);
    throw new FsError('UNSUPPORTED_COMPRESSION', 'Kiểu nén ' + method + (COMPRESSION[method] ? ' (' + COMPRESSION[method] + ')' : '') + ' chưa hỗ trợ');
  }

  /* ---------- Header ---------- */
  /** THUẦN. @returns {ok, code?, error?, signature, version, min_player_version, unity_revision, size, compressed_info_size, uncompressed_info_size, flags, compression, combined, info_at_end, padding_flag, unknown_flag_bits, header_end} */
  function parseHeader(b) {
    const r = { ok: false, signature: null };
    if (!b || b.length < 8) { r.code = 'TOO_SHORT'; r.error = 'File quá ngắn'; return r; }
    const sig = ascii(b, 0, 8); r.signature = sig.replace(/\0+$/, '');
    if (sig !== 'UnityFS\0') {
      r.code = /^Unity(Web|Raw|Archive)/.test(sig) ? 'OLD_FORMAT' : 'BAD_MAGIC';
      r.error = r.code === 'OLD_FORMAT' ? 'Định dạng cũ ' + r.signature + ' chưa hỗ trợ' : 'Không phải UnityFS (magic không khớp)'; return r;
    }
    if (b.length < 12) { r.code = 'TOO_SHORT'; r.error = 'Thiếu trường version'; return r; }
    r.version = u32be(b, 8);
    const a = cstr(b, 12, 64); if (!a) { r.code = 'BAD_HEADER'; r.error = 'Chuỗi minPlayerVersion không kết thúc'; return r; }
    const v = cstr(b, a.next, 64); if (!v) { r.code = 'BAD_HEADER'; r.error = 'Chuỗi unityRevision không kết thúc'; return r; }
    r.min_player_version = a.s; r.unity_revision = v.s;
    const p = v.next; if (p + 20 > b.length) { r.code = 'TOO_SHORT'; r.error = 'Thiếu các trường kích thước/flags'; return r; }
    r.size = i64be(b, p); r.compressed_info_size = u32be(b, p + 8); r.uncompressed_info_size = u32be(b, p + 12); r.flags = u32be(b, p + 16); r.header_end = p + 20;
    r.compression = r.flags & 0x3F; r.combined = (r.flags & 0x40) !== 0; r.info_at_end = (r.flags & 0x80) !== 0; r.padding_flag = (r.flags & 0x200) !== 0;
    r.unknown_flag_bits = (r.flags & ~(0x3F | 0x40 | 0x80 | 0x100 | 0x200)) >>> 0;
    if (r.version < 6 || r.version > 8) { r.code = 'UNKNOWN_VERSION'; r.error = 'Phiên bản định dạng UnityFS ' + r.version + ' ngoài dải đã biết (6–8); không đoán bố cục'; return r; }
    if (r.size === null) { r.code = 'BAD_HEADER'; r.error = 'Trường size không an toàn (âm/quá lớn)'; return r; }
    r.ok = true; return r;
  }

  /* ---------- Bảng info ---------- */
  /** THUẦN. Phân tích bảng đã giải nén. @returns {ok, error?, blocks:[{index,uncompressed_size,compressed_size,flags,compression,streamed}], nodes:[{index,path,offset,size,flags,is_serialized,unsafe_path}], consumed, hash_hex, problems[]} */
  function parseInfo(b) {
    const r = { ok: false, blocks: [], nodes: [], problems: [], consumed: 0, hash_hex: '' };
    if (b.length < 20) { r.error = 'Bảng info quá ngắn (' + b.length + ' byte)'; return r; }
    let h = ''; for (let i = 0; i < 16; i++) h += (b[i] < 16 ? '0' : '') + b[i].toString(16); r.hash_hex = h;
    const bc = i32be(b, 16); let p = 20;
    if (bc < 0 || bc > LIMITS.max_blocks) { r.error = 'Số block ' + bc + ' không hợp lệ (giới hạn ' + LIMITS.max_blocks + ')'; return r; }
    if (p + bc * 10 + 4 > b.length) { r.error = 'Bảng block (' + bc + ') vượt bảng info'; return r; }
    for (let i = 0; i < bc; i++, p += 10) { const f = u16be(b, p + 8); r.blocks.push({ index: i, uncompressed_size: u32be(b, p), compressed_size: u32be(b, p + 4), flags: f, compression: f & 0x3F, streamed: (f & 0x40) !== 0 }); }
    const nc = i32be(b, p); p += 4;
    if (nc < 0 || nc > LIMITS.max_nodes) { r.error = 'Số node ' + nc + ' không hợp lệ (giới hạn ' + LIMITS.max_nodes + ')'; return r; }
    for (let i = 0; i < nc; i++) {
      if (p + 20 > b.length) { r.error = 'Bảng node bị cắt tại node ' + i; return r; }
      const off = i64be(b, p), size = i64be(b, p + 8), fl = u32be(b, p + 16), s = cstr(b, p + 20, 1024);
      if (!s) { r.error = 'Đường dẫn node ' + i + ' không kết thúc'; return r; }
      if (off === null || size === null) { r.error = 'Node ' + i + ' có offset/size không an toàn'; return r; }
      r.nodes.push({ index: i, path: s.s, offset: off, size: size, flags: fl, is_serialized: (fl & 4) !== 0, unsafe_path: unsafeName(s.s) });
      p = s.next;
    }
    r.consumed = p; r.ok = true;
    if (p !== b.length) r.problems.push('Bảng info còn ' + (b.length - p) + ' byte thừa sau node cuối');
    return r;
  }
  function unsafeName(n) { if (!n) return 'rỗng'; if (n.indexOf('\0') >= 0) return 'chứa NUL'; if (/(^|[\\/])\.\.([\\/]|$)/.test(n)) return 'chứa ..'; if (/^[\\/]|^[a-zA-Z]:/.test(n)) return 'đường dẫn tuyệt đối'; return null; }

  /* ---------- Mở bundle (không giải nén dữ liệu) ---------- */
  /** Vị trí bảng info và các ứng viên bắt đầu vùng dữ liệu. */
  function layoutOf(h, fileSize) {
    const ver7 = h.version >= 7, start = ver7 ? align16(h.header_end) : h.header_end;
    const infoOff = h.info_at_end ? fileSize - h.compressed_info_size : start;
    return { info_offset: infoOff, info_end: infoOff + h.compressed_info_size, header_aligned: start };
  }
  /** Chọn điểm bắt đầu vùng dữ liệu: ứng viên khớp CHÍNH XÁC (start + Σcsize == mốc cuối) được ưu tiên; không ứng viên nào khớp → null. */
  function chooseDataStart(h, L, blocks, fileSize) {
    const sum = blocks.reduce(function (a, x) { return a + x.compressed_size; }, 0), limit = h.info_at_end ? L.info_offset : fileSize;
    const raw = h.info_at_end ? [L.header_aligned, h.header_end] : [L.info_end, align16(L.info_end)];
    const cands = []; (h.padding_flag ? [raw[raw.length - 1], raw[0]] : raw).forEach(function (c) { if (cands.indexOf(c) < 0) cands.push(c); });
    for (let i = 0; i < cands.length; i++) if (cands[i] + sum === limit) return { start: cands[i], exact: true, sum: sum, tried: cands };
    for (let i = 0; i < cands.length; i++) if (cands[i] + sum < limit) return { start: cands[i], exact: false, sum: sum, tried: cands };
    return { start: null, exact: false, sum: sum, tried: cands };
  }
  /** Phần byte tối thiểu cần để đọc bảng info: {need:int} nếu `b` (đã có b.length byte) chưa đủ, hoặc null nếu đủ. */
  function bytesNeeded(h, fileSize) { const L = layoutOf(h, fileSize); return L.info_end; }

  /** THUẦN, đồng bộ, không ném lỗi. b = toàn bộ file (hoặc ≥ bytesNeeded byte đầu khi info ở đầu). */
  function open(b, fileSize) {
    if (!(b instanceof Uint8Array)) b = new Uint8Array(0);
    fileSize = fileSize == null ? b.length : fileSize;
    const res = { schema: BUNDLE_SCHEMA, status: 'invalid', reason: '', header: null, compression: null, blocks: [], nodes: [], data_start: null, data_start_exact: null, total_uncompressed: null, problems: [], notes: [] };
    const h = parseHeader(b); res.header = h;
    if (!h.ok) {
      res.status = h.code === 'OLD_FORMAT' ? 'unsupported_format' : h.code === 'BAD_MAGIC' ? 'not_unityfs' : h.code === 'UNKNOWN_VERSION' ? 'unsupported_version' : 'invalid';
      res.reason = h.error; return res;
    }
    res.compression = { code: h.compression, name: COMPRESSION[h.compression] || 'không rõ' };
    if (h.unknown_flag_bits) res.notes.push('Flags có bit chưa biết (0x' + h.unknown_flag_bits.toString(16) + '): có thể là biến thể/bundle mã hóa riêng; kết quả dưới đây có thể sai.');
    if (!h.combined) res.notes.push('Flag 0x40 (blocks+directory gộp) không bật: vẫn đọc theo bố cục gộp; nếu giải nén lỗi thì định dạng khác với giả định.');
    if (h.size !== fileSize) res.problems.push('Trường size trong header = ' + h.size + ' ≠ kích thước file ' + fileSize + (h.size > fileSize ? ' (file bị cắt cụt?)' : ' (có dữ liệu thừa?)'));
    if (h.compressed_info_size > LIMITS.max_info_bytes || h.uncompressed_info_size > LIMITS.max_info_bytes) { res.status = 'too_large'; res.reason = 'Bảng info ' + h.compressed_info_size + '/' + h.uncompressed_info_size + ' byte vượt giới hạn'; return res; }
    const L = layoutOf(h, fileSize); res.info_offset = L.info_offset;
    if (L.info_offset < h.header_end || L.info_end > fileSize) { res.status = 'truncated'; res.reason = 'Bảng info [' + L.info_offset + ', ' + L.info_end + ') nằm ngoài file ' + fileSize; return res; }
    if (L.info_end > b.length) { res.status = 'need_more_bytes'; res.reason = 'Cần ' + L.info_end + ' byte đầu'; res.need = L.info_end; return res; }
    if (h.compression === 4 || !(h.compression in COMPRESSION)) { res.status = 'unsupported_compression'; res.reason = 'Bảng info dùng kiểu nén ' + h.compression + ' (' + (COMPRESSION[h.compression] || 'không rõ') + '), chưa hỗ trợ'; return res; }
    let info;
    try { info = decompress(h.compression, b.subarray(L.info_offset, L.info_end), h.uncompressed_info_size); }
    catch (e) { res.status = e.code === 'UNSUPPORTED_COMPRESSION' ? 'unsupported_compression' : 'decompress_failed'; res.reason = 'Giải nén bảng info thất bại: ' + e.message + (res.status === 'decompress_failed' ? ' (file hỏng, biến thể không hỗ trợ hoặc bundle mã hóa riêng – không thử giải mã)' : ''); return res; }
    const pi = parseInfo(info);
    if (!pi.ok) { res.status = 'invalid'; res.reason = 'Bảng info sai cấu trúc: ' + pi.error + ' (giả định bố cục có thể không áp dụng cho bundle này)'; return res; }
    res.blocks = pi.blocks; res.nodes = pi.nodes; res.info_hash = pi.hash_hex; pi.problems.forEach(function (x) { res.problems.push(x); });
    const ds = chooseDataStart(h, L, pi.blocks, fileSize);
    if (ds.start === null) { res.status = 'invalid'; res.reason = 'Vùng dữ liệu không khớp: Σ kích thước nén của block = ' + ds.sum + ' không vừa file (ứng viên bắt đầu: ' + ds.tried.join(', ') + ')'; return res; }
    res.data_start = ds.start; res.data_start_exact = ds.exact;
    if (!ds.exact) res.problems.push('Vùng dữ liệu không khớp chính xác với kích thước file (Σ block nén = ' + ds.sum + '); vị trí bắt đầu dữ liệu chọn gần đúng');
    let tot = 0; pi.blocks.forEach(function (x) { tot += x.uncompressed_size; }); res.total_uncompressed = tot;
    pi.blocks.forEach(function (x) { if (!(x.compression in COMPRESSION) || x.compression === 4) res.problems.push('Block ' + x.index + ' dùng kiểu nén ' + x.compression + ' chưa hỗ trợ'); });
    pi.nodes.forEach(function (nd) {
      if (nd.offset + nd.size > tot) res.problems.push('Node #' + nd.index + ' "' + nd.path + '" [' + nd.offset + ', +' + nd.size + ') vượt tổng dữ liệu ' + tot);
      if (nd.unsafe_path) res.problems.push('Node #' + nd.index + ' có đường dẫn không an toàn (' + nd.unsafe_path + '); sẽ không dùng làm tên file');
    });
    res.status = 'parsed'; res.reason = 'Đã đọc header, ' + pi.blocks.length + ' block, ' + pi.nodes.length + ' node (CHƯA giải nén dữ liệu node, CHƯA parse SerializedFile)';
    return res;
  }

  /** Giải nén nội dung MỘT node. b = TOÀN BỘ file bundle. @returns {Promise<Uint8Array>}; ném FsError (kể cả CANCELLED). */
  async function readNode(b, bundle, index, hooks) {
    hooks = hooks || {};
    if (!bundle || bundle.status !== 'parsed') throw new FsError('NOT_PARSED', 'Bundle chưa được parse');
    const nd = bundle.nodes[index]; if (!nd) throw new FsError('NO_NODE', 'Không có node #' + index);
    if (nd.size > LIMITS.max_node_bytes) throw new FsError('TOO_LARGE', 'Node ' + nd.size + ' byte vượt giới hạn');
    if (nd.offset + nd.size > bundle.total_uncompressed) throw new FsError('NODE_RANGE', 'Node vượt tổng dữ liệu');
    const out = new Uint8Array(nd.size); let cpos = bundle.data_start, upos = 0, filled = 0;
    const lo = nd.offset, hi = nd.offset + nd.size;
    for (let i = 0; i < bundle.blocks.length && upos < hi; i++) {
      const bl = bundle.blocks[i], uend = upos + bl.uncompressed_size, cend = cpos + bl.compressed_size;
      if (uend > lo && bl.uncompressed_size > 0) {
        if (hooks.isCancelled && hooks.isCancelled()) throw new FsError('CANCELLED', 'Đã hủy');
        if (cend > b.length) throw new FsError('TRUNCATED', 'Block ' + i + ' vượt dữ liệu file đã có');
        const data = decompress(bl.compression, b.subarray(cpos, cend), bl.uncompressed_size);
        const s = Math.max(lo, upos), e = Math.min(hi, uend);
        out.set(data.subarray(s - upos, e - upos), s - lo); filled += e - s;
      }
      upos = uend; cpos = cend;
    }
    if (filled !== nd.size) throw new FsError('SIZE', 'Chỉ giải nén được ' + filled + '/' + nd.size + ' byte của node');
    return out;
  }

  /* ---------- Quét bundle trong IPA ---------- */
  const EXTS = ['unity3d', 'bundle', 'ab', 'assetbundle'];
  function extOf(name) { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i + 1).toLowerCase(); }
  function isUnityFsRow(r) { return !!(r && /^Unity(FS|Web|Raw|Archive)/i.test(r.detected_format || '')); }

  /** THUẦN. Ứng viên = manifest nhận UnityFS/Unity* theo magic HOẶC đuôi unity3d/bundle/ab/assetbundle (đuôi chỉ là gợi ý, cần magic khi đọc). */
  function selectCandidates(entries, manifest, rootPath) {
    const rows = new Map(); if (manifest && Array.isArray(manifest.rows)) manifest.rows.forEach(function (r) { rows.set(r.relative_path, r); });
    const out = [];
    (entries || []).forEach(function (e) {
      if (!e || e.dir) return;
      const inApp = rootPath && e.name.indexOf(rootPath) === 0, rel = inApp ? e.name.slice(rootPath.length) : e.name, row = rows.get(rel) || null, byMagic = isUnityFsRow(row), byExt = EXTS.indexOf(extOf(e.name)) >= 0;
      if (byMagic || byExt) out.push({ entry: e, rel: rel, selected_by: byMagic && byExt ? 'ext+magic' : byMagic ? 'magic' : 'ext' });
    });
    return { candidates: out, manifest_used: !!manifest };
  }

  function baseResult() { return { schema: SCHEMA, sub_phase: '5.2a', status: 'not_run', reason: '', items: [], summary: null, limits: Object.assign({}, LIMITS), limitations: NOT_DONE.slice(), warnings: [], source: { manifest_used: false } }; }

  /** Quét mọi ứng viên: đọc header (+ bảng info), KHÔNG giải nén dữ liệu node. Chỉ ném CANCELLED. @returns {Promise<UnityFsResult>} */
  async function scan(file, ipa, entries, hooks) {
    hooks = hooks || {}; const IR = NS.IpaReader, cancelled = hooks.isCancelled || function () { return false; }, res = baseResult();
    try {
      if (!ipa || !Array.isArray(entries) || !IR) { res.reason = 'Thiếu dữ liệu IPA/entries'; return res; }
      const sel = selectCandidates(entries, ipa.manifest || null, ipa.appRoot || ''); res.source.manifest_used = sel.manifest_used;
      let cands = sel.candidates;
      if (cands.length > LIMITS.max_bundles) { res.warnings.push('Có ' + cands.length + ' ứng viên, chỉ xử lý ' + LIMITS.max_bundles + ' đầu tiên.'); cands = cands.slice(0, LIMITS.max_bundles); }
      if (!cands.length) { res.status = 'no_bundles'; res.reason = 'Không có file nào có đuôi/magic của AssetBundle Unity'; res.summary = summarize(res.items); return res; }
      let i = 0;
      for (const c of cands) {
        if (cancelled()) throw new FsError('CANCELLED', 'Đã hủy');
        const it = { id: res.items.length, path: c.rel, zip_path: c.entry.name, size: c.entry.size, selected_by: c.selected_by, status: 'read_error', reason: '', signature: null, format_version: null, min_player_version: null, unity_revision: null,
          compression: null, block_count: null, node_count: null, total_uncompressed: null, data_start_exact: null, nodes: [], nodes_truncated: false, problems: [], notes: [], flags_hex: null };
        try { await inspectEntry(file, c.entry, it, IR); }
        catch (e) { if (e && e.code === 'CANCELLED') throw e; it.status = 'read_error'; it.reason = 'Không đọc được entry: ' + ((e && e.message) || e); }
        res.items.push(it); i++; if (hooks.progress) hooks.progress(i / cands.length);
      }
      res.summary = summarize(res.items);
      const s = res.summary; res.status = s.parsed > 0 ? (s.parsed === s.bundles ? 'ok' : 'partial') : 'none_parsed';
      res.reason = s.parsed + '/' + s.bundles + ' bundle đã đọc được container (' + s.nodes + ' node); nội dung node chưa được parse';
    } catch (e) { if (e && e.code === 'CANCELLED') throw e; res.status = 'error'; res.reason = 'Lỗi không mong đợi: ' + ((e && e.message) || e); }
    return res;
  }

  async function inspectEntry(file, entry, it, IR) {
    const head = (await IR.readEntry(file, entry, { max: Math.min(LIMITS.head_bytes, Math.max(entry.size, 1)), head: true })).data;
    const h = parseHeader(head);
    it.signature = h.signature;
    if (!h.ok) { const o = open(head, entry.size); it.status = o.status; it.reason = o.reason; if (h.version != null) it.format_version = h.version; return; }
    if (entry.size > LIMITS.max_bundle_bytes && h.info_at_end) { it.status = 'too_large'; it.reason = 'Bundle ' + entry.size + ' byte có bảng info ở cuối, vượt giới hạn đọc ' + LIMITS.max_bundle_bytes; return; }
    const L = layoutOf(h, entry.size), want = h.info_at_end ? entry.size : L.info_end;
    let bytes = head;
    if (want > head.length) {
      if (want > LIMITS.max_bundle_bytes) { it.status = 'too_large'; it.reason = 'Cần đọc ' + want + ' byte > giới hạn ' + LIMITS.max_bundle_bytes; return; }
      bytes = (await IR.readEntry(file, entry, { max: want, head: !h.info_at_end })).data;
    }
    const o = open(bytes, entry.size);
    it.status = o.status; it.reason = o.reason; it.format_version = h.version; it.min_player_version = h.min_player_version; it.unity_revision = h.unity_revision; it.flags_hex = '0x' + h.flags.toString(16);
    it.compression = o.compression; it.problems = o.problems; it.notes = o.notes;
    if (o.status !== 'parsed') return;
    it.block_count = o.blocks.length; it.node_count = o.nodes.length; it.total_uncompressed = o.total_uncompressed; it.data_start_exact = o.data_start_exact;
    it.block_compression = {}; o.blocks.forEach(function (b) { const n = COMPRESSION[b.compression] || ('#' + b.compression); it.block_compression[n] = (it.block_compression[n] || 0) + 1; });
    it.nodes = o.nodes.slice(0, LIMITS.max_listed_nodes).map(function (n) { return { index: n.index, path: n.path, offset: n.offset, size: n.size, flags: n.flags, is_serialized: n.is_serialized, unsafe_path: n.unsafe_path }; });
    it.nodes_truncated = o.nodes.length > it.nodes.length;
  }

  function summarize(items) {
    const s = { bundles: items.length, parsed: 0, nodes: 0, serialized_nodes: 0, total_uncompressed: 0, by_status: {}, by_compression: {}, unity_revisions: [] };
    const rev = {};
    items.forEach(function (it) {
      s.by_status[it.status] = (s.by_status[it.status] || 0) + 1;
      if (it.status === 'parsed') { s.parsed++; s.nodes += it.node_count; s.total_uncompressed += it.total_uncompressed; it.nodes.forEach(function (n) { if (n.is_serialized) s.serialized_nodes++; }); }
      if (it.compression) s.by_compression[it.compression.name] = (s.by_compression[it.compression.name] || 0) + 1;
      if (it.unity_revision) rev[it.unity_revision] = 1;
    });
    s.unity_revisions = Object.keys(rev).sort(); return s;
  }

  function toIndex(r) { return r ? JSON.parse(JSON.stringify(r)) : null; }
  function toReportFields(r) {
    if (!r || r.status === 'not_run') return null; const s = r.summary || {};
    return { unityfs_status: r.status, unityfs_bundles: s.bundles || 0, unityfs_bundles_parsed: s.parsed || 0, unityfs_nodes: s.nodes || 0, unityfs_unity_revisions: s.unity_revisions || [] };
  }

  NS.UnityFS = { SCHEMA: SCHEMA, BUNDLE_SCHEMA: BUNDLE_SCHEMA, LIMITS: LIMITS, COMPRESSION: COMPRESSION, NOT_DONE: NOT_DONE, FsError: FsError,
    lz4Block: lz4Block, lzma: lzma, decompress: decompress, parseHeader: parseHeader, parseInfo: parseInfo, layoutOf: layoutOf, chooseDataStart: chooseDataStart, bytesNeeded: bytesNeeded,
    open: open, readNode: readNode, selectCandidates: selectCandidates, scan: scan, toIndex: toIndex, toReportFields: toReportFields };
})(typeof window !== 'undefined' ? window : self);
