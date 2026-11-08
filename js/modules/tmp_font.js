/* tmp_font.js – Phase 5, SUB-PHASE 5.2d: đọc TMP_FontAsset (TextMesh Pro) để biết ATLAS chứa những ký tự nào và có đủ tiếng Việt không.
   Đối tượng: MonoBehaviour có script TMP_FontAsset (đã được 5.2c ghi vào file.tmp_font_assets = [chỉ số object]). Không có type tree trong bản build → KHÔNG có sơ đồ trường đáng tin.
   Cách làm (heuristic có kiểm chứng chặt, KHÔNG đoán mù):
     1. Header MonoBehaviour (m_GameObject, m_Enabled, m_Script, m_Name) – nếu không khớp thì quét từ đầu object và ghi vấn đề.
     2. Neo FaceInfo: chuỗi tên + PointSize/Scale/CharacterCount hợp lý → tên font nguồn, số ký tự khai báo, kích thước atlas (nếu suy ra được).
     3. Neo bảng glyph: số lượng N (int32) rồi N phần tử 36 byte {id:int32, x,y,width,height,xOffset,yOffset,xAdvance,scale: float32}; CHỈ nhận khi MỌI phần tử hợp lệ
        (id là code point, số hữu hạn, hình chữ nhật nằm trong atlas nếu biết kích thước – NGOẠI LỆ: glyph khoảng trắng/điều khiển được TMP đặt ngoài atlas, id không trùng) → code point trong atlas.
     4. Các PPtr khớp object thật trong cùng file (Texture2D, Material, Font, TMP_FontAsset khác) – chỉ là THAM CHIẾU THẤY ĐƯỢC, không khẳng định ý nghĩa trường.
   Bố cục TMP_Glyph 9 trường/36 byte ĐÃ ĐƯỢC XÁC NHẬN trên DỮ LIỆU THẬT của DATA WING (3/7 asset đọc đủ, count khớp khai báo; 4 asset còn lại bị loại oan vì glyph khoảng trắng nằm ngoài atlas và FaceInfo 20 trường – đã sửa ở Account 08, CHƯA chạy lại trên DATA WING). Nếu bố cục khác ở game khác, kết quả là `glyph_table_not_found`
   kèm dữ liệu chẩn đoán (hex), KHÔNG bịa danh sách ký tự. Chạy ở Worker/luồng chính. Chỉ ném CANCELLED. Không giải mã ảnh atlas (Texture2D). */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const SCHEMA = 'tmp_fonts/1';
  const STRIDE = 36;
  const LIMITS = { max_assets: 200, max_asset_bytes: 64 * 1048576, max_file_bytes: 256 * 1048576, max_glyphs: 70000, max_ranges: 5000, max_listed_missing: 150, hex_head_bytes: 192, max_refs: 8, max_diag_hits: 6 };
  const NOT_DONE = ['giải mã ảnh atlas (Texture2D) và kiểm glyph có hình', 'TMP_FontAsset nằm trong AssetBundle UnityFS (node) – chỉ đọc file .assets/level/sharedassets', 'liên kết TextMeshPro component → TMP_FontAsset đang dùng thật',
    'bảng kerning, fallback font, font weights, material SDF', 'ghi ngược/tạo lại atlas (cần công cụ ngoài, ví dụ Unity Editor)'];

  const hex = function (cp) { return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'); };
  function viRequired() {
    const bases = 'aăâeêioôơuưy', tones = ['', '\u0300', '\u0309', '\u0303', '\u0301', '\u0323'], set = {}, out = [];
    (bases + bases.toUpperCase()).split('').forEach(function (b) { tones.forEach(function (t) { const ch = (b + t).normalize('NFC'); if (ch.length === 1 && ch.charCodeAt(0) > 127) set[ch.charCodeAt(0)] = 1; }); });
    set[0x111] = 1; set[0x110] = 1; Object.keys(set).forEach(function (k) { out.push(+k); }); out.sort(function (a, b) { return a - b; }); return out;
  }
  const VI_REQUIRED = viRequired();
  const ASCII_LETTERS = (function () { const a = []; for (let i = 65; i <= 90; i++) { a.push(i); a.push(i + 32); } return a; })();

  /* ---------- đọc số theo endian ---------- */
  function mk(ob, le) {
    const dv = new DataView(ob.buffer, ob.byteOffset, ob.byteLength);
    return { len: ob.length, le: le, i32: function (o) { return dv.getInt32(o, le); }, u32: function (o) { return dv.getUint32(o, le); }, f32: function (o) { return dv.getFloat32(o, le); }, u8: function (o) { return ob[o]; } };
  }
  function pid64(R, o) { const lo = R.le ? R.u32(o) : R.u32(o + 4), hi = R.le ? R.i32(o + 4) : R.i32(o); return hi >= 0 && hi <= 0x1FFFFF ? hi * 4294967296 + lo : null; }
  function align4(n) { return (n + 3) & ~3; }
  function readStr(R, ob, o, maxLen) {
    if (o < 0 || o + 4 > R.len) return null; const n = R.i32(o);
    if (n < 0 || n > maxLen || o + 4 + n > R.len) return null;
    let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(ob[o + 4 + i]);
    try { s = decodeURIComponent(escape(s)); } catch (e) { /* giữ nguyên nếu không phải UTF-8 */ }
    return { s: s, next: align4(o + 4 + n) };
  }
  function printable(ob, o, n) { for (let i = 0; i < n; i++) { const c = ob[o + i]; if (c < 0x20 || c > 0x7E) return false; } return true; }
  const isPow2 = function (v) { return Number.isFinite(v) && v >= 32 && v <= 16384 && Math.floor(v) === v && (v & (v - 1)) === 0; };
  const norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };

  /* ---------- 1. Header MonoBehaviour ---------- */
  function readHeader(R, ob, problems) {
    if (R.len < 32) { problems.push('Object quá ngắn (' + R.len + ' byte) cho header MonoBehaviour'); return null; }
    const goFile = R.i32(0), goPid = pid64(R, 4), scFile = R.i32(16), scPid = pid64(R, 20), nm = readStr(R, ob, 28, 512);
    if (goPid === null || scPid === null || !nm || scPid === 0 || scFile < 0 || scFile > 4096 || goFile < 0 || goFile > 4096) { problems.push('Header MonoBehaviour không khớp bố cục giả định (m_GameObject, m_Enabled, m_Script, m_Name) – quét từ đầu object'); return null; }
    return { game_object: { file_id: goFile, path_id: goPid }, enabled: ob[12], script: { file_id: scFile, path_id: scPid }, name: nm.s, data_start: nm.next };
  }

  /* ---------- 2. Neo FaceInfo ---------- */
  function findFaceInfo(R, ob, from) {
    for (let p = align4(from); p + 8 <= R.len; p += 4) {
      const L = R.i32(p); if (L < 1 || L > 120 || p + 4 + L > R.len || !printable(ob, p + 4, L)) continue;
      const e = align4(p + 4 + L); if (e + 4 * 20 > R.len) continue;
      const pt = R.f32(e), sc = R.f32(e + 4), cc = R.i32(e + 8), lh = R.f32(e + 12);
      if (!(pt >= 1 && pt <= 4096) || !(sc > 0 && sc <= 64) || cc < 0 || cc > LIMITS.max_glyphs || !(lh > 0 && lh <= 20000)) continue;
      let name = ''; for (let i = 0; i < L; i++) name += String.fromCharCode(ob[p + 4 + i]);
      const info = { offset: p, name: name, point_size: pt, scale: sc, declared_char_count: cc, line_height: lh, atlas_width: null, atlas_height: null, atlas_basis: null };
      /* DỮ LIỆU THẬT (DATA WING, TMP cho Unity 5.6): FaceInfo có 20 trường – sau CharacterCount còn LineHeight, Baseline, Ascender, CapHeight, Descender, CenterLine, SuperscriptOffset, SubscriptOffset, SubSize,
         Underline, UnderlineThickness, strikethrough, strikethroughThickness, TabWidth, Padding, AtlasWidth, AtlasHeight → AtlasWidth/Height ở +72/+76 byte từ PointSize. Bản 18 trường (không có 2 trường strikethrough) là giả định cũ, giữ làm dự phòng. */
      const w20 = R.f32(e + 4 * 18), h20 = R.f32(e + 4 * 19), w18 = R.f32(e + 4 * 16), h18 = R.f32(e + 4 * 17);
      if (isPow2(w20) && isPow2(h20)) { info.atlas_width = w20; info.atlas_height = h20; info.atlas_basis = 'faceinfo_layout'; }
      else if (isPow2(w18) && isPow2(h18)) { info.atlas_width = w18; info.atlas_height = h18; info.atlas_basis = 'faceinfo_layout_18'; }
      else for (let k = 3; k + 1 < 28 && e + 4 * (k + 2) <= R.len; k++) {
        const a = R.f32(e + 4 * k), b = R.f32(e + 4 * (k + 1));
        if (isPow2(a) && isPow2(b) && a >= 64 && b >= 64 && Math.max(a, b) / Math.min(a, b) <= 4) { info.atlas_width = a; info.atlas_height = b; info.atlas_basis = 'scan'; break; }
      }
      return info;
    }
    return null;
  }

  /* ---------- 3. Neo bảng glyph ---------- */
  /** Ký tự khoảng trắng/điều khiển/định dạng: TMP đặt glyph của chúng NGOÀI atlas (DỮ LIỆU THẬT: y = chiều cao atlas + padding, vd y=259 trên atlas cao 256, y=1027 trên atlas cao 1024). */
  function isInvisibleId(id) {
    return id <= 0x20 || (id >= 0x7F && id <= 0xA0) || id === 0xAD || id === 0x1680 || (id >= 0x2000 && id <= 0x200F) || (id >= 0x2028 && id <= 0x202F) || (id >= 0x205F && id <= 0x206F) || id === 0x3000 || id === 0xFEFF;
  }
  /** @returns 0 = không hợp lệ; 1 = hợp lệ (nằm trong atlas); 2 = hợp lệ nhưng là glyph vô hình đặt ngoài atlas (chỉ chấp nhận cho id khoảng trắng/điều khiển). */
  function glyphKind(R, o, aw, ah) {
    const id = R.i32(o); if (id < 0 || id > 0x10FFFF) return 0;
    const f = []; for (let k = 0; k < 8; k++) { const v = R.f32(o + 4 + 4 * k); if (!Number.isFinite(v) || Math.abs(v) > 100000) return 0; f.push(v); }
    const x = f[0], y = f[1], w = f[2], h = f[3], sc = f[7];
    if (w < 0 || h < 0 || x < -0.5 || y < -0.5 || !(sc > 0 && sc <= 1000)) return 0;
    if (aw !== null && (x + w > aw + 1 || y + h > ah + 1)) return isInvisibleId(id) ? 2 : 0;
    return 1;
  }
  /** CHẨN ĐOÁN: vì sao bảng N phần tử tại p (số nguyên = số ký tự khai báo) bị từ chối: số phần tử vi phạm + phần tử vi phạm đầu tiên. */
  function tableCheck(R, p, n, aw, ah) {
    const out = { records: n, fail_count: 0, placeholder_glyphs: 0, first_fail: null };
    for (let i = 0; i < n; i++) {
      const o = p + 4 + STRIDE * i, k = glyphKind(R, o, aw, ah);
      if (k === 2) out.placeholder_glyphs++;
      if (k !== 0) continue;
      out.fail_count++;
      if (!out.first_fail) {
        const id = R.i32(o), f = []; for (let j = 0; j < 8; j++) f.push(R.f32(o + 4 + 4 * j));
        const finite = f.every(function (v) { return Number.isFinite(v) && Math.abs(v) <= 100000; });
        out.first_fail = { index: i, id: id, reason: (id < 0 || id > 0x10FFFF) ? 'id_not_code_point' : !finite ? 'non_finite_or_huge' : (f[2] < 0 || f[3] < 0 || f[0] < -0.5 || f[1] < -0.5 || !(f[7] > 0 && f[7] <= 1000)) ? 'negative_or_bad_scale' : 'outside_atlas',
          x: finite ? f[0] : null, y: finite ? f[1] : null, width: finite ? f[2] : null, height: finite ? f[3] : null, scale: finite ? f[7] : null };
      }
    }
    return out;
  }
  /** Mọi ứng viên bảng glyph mà TOÀN BỘ phần tử hợp lệ. Chọn: bảng có số phần tử = CharacterCount khai báo (nếu có); không thì bảng LỚN NHẤT. Báo các ứng viên còn lại.
   *  @returns {offset,count,duplicate_ids,others:[{offset,count}]}|null */
  function findGlyphTable(R, from, aw, ah, declared) {
    const cands = [];
    for (let p = align4(from); p + 4 + STRIDE <= R.len; p += 4) {
      const n = R.i32(p); if (n < 1 || n > LIMITS.max_glyphs || p + 4 + STRIDE * n > R.len) continue;
      let ph = 0, ok = true; for (let i = 0; i < n && ok; i++) { const k = glyphKind(R, p + 4 + STRIDE * i, aw, ah); if (k === 0) ok = false; else if (k === 2) ph++; }
      if (!ok || ph > Math.max(8, Math.floor(n / 10))) continue;      // glyph vô hình ngoài atlas chỉ là số ít; nhiều hơn → không phải bảng glyph
      const ids = new Set(); let dup = 0; for (let i = 0; i < n; i++) { const id = R.i32(p + 4 + STRIDE * i); if (ids.has(id)) dup++; else ids.add(id); }
      if (dup > Math.max(0, Math.floor(n / 100))) continue;      // TMP dùng từ điển id→glyph: trùng nhiều = không phải bảng glyph
      cands.push({ offset: p, count: n, duplicate_ids: dup, placeholder_glyphs: ph });
    }
    if (!cands.length) return null;
    let pick = declared > 0 ? cands.find(function (c) { return c.count === declared; }) : null;
    if (!pick) pick = cands.reduce(function (a, c) { return c.count > a.count ? c : a; }, cands[0]);
    pick.others = cands.filter(function (c) { return c !== pick; }).slice(0, 4).map(function (c) { return { offset: c.offset, count: c.count }; });
    return pick;
  }

  function ranges(cps) {
    const a = cps.slice().sort(function (x, y) { return x - y; }), out = []; let s = null, e = null;
    a.forEach(function (c) { if (s === null) { s = e = c; } else if (c === e + 1) e = c; else if (c > e) { out.push([s, e]); s = e = c; } });
    if (s !== null) out.push([s, e]); return out;
  }
  function vietnamese(set) {
    const miss = VI_REQUIRED.filter(function (c) { return !set.has(c); }), cov = VI_REQUIRED.length - miss.length, amiss = ASCII_LETTERS.filter(function (c) { return !set.has(c); });
    return { level: miss.length === 0 ? 'full' : cov === 0 ? 'none' : 'partial', required: VI_REQUIRED.length, covered: cov, missing_count: miss.length, missing: miss.slice(0, LIMITS.max_listed_missing).map(hex),
      percent: Math.round(cov * 1000 / VI_REQUIRED.length) / 10, ascii_letters_ok: amiss.length === 0, ascii_missing: amiss.map(hex) };
  }

  /* ---------- 4. PPtr thấy được ---------- */
  function findRefs(R, ob, ranges2, ctx) {
    const found = { texture: [], material: [], font: [], tmp_font_asset: [] }, seen = new Set();
    const kindOf = function (pid) { if (ctx.textures.has(pid)) return 'texture'; if (ctx.materials.has(pid)) return 'material'; if (ctx.fonts.has(pid)) return 'font'; if (ctx.tmp.has(pid)) return 'tmp_font_asset'; return null; };
    ranges2.forEach(function (rg) {
      for (let p = align4(rg[0]); p + 12 <= rg[1]; p += 4) {
        if (R.i32(p) !== 0) continue; const pid = pid64(R, p + 4); if (pid === null || pid === 0) continue;
        const k = kindOf(pid); if (!k) continue; const key = k + '#' + pid; if (seen.has(key)) continue; seen.add(key);
        const nm = k === 'texture' ? ctx.textures.get(pid) : k === 'material' ? ctx.materials.get(pid) : k === 'font' ? ctx.fonts.get(pid) : ctx.tmp.get(pid);
        if (found[k].length < LIMITS.max_refs) found[k].push({ path_id: pid, name: nm, offset: p });
      }
    });
    return found;
  }

  /**
   * THUẦN. Giải mã một object TMP_FontAsset.
   * @param {Uint8Array} ob  byte của object; @param {boolean} le  little endian
   * @param {{textures:Map,materials:Map,fonts:Map,tmp:Map}} ctx  path_id → tên (cùng file)
   */
  function decodeObject(ob, le, ctx) {
    ctx = ctx || { textures: new Map(), materials: new Map(), fonts: new Map(), tmp: new Map() };
    const problems = [], R = mk(ob, le), out = { status: 'layout_unknown', reason: '', name: null, header: null, font_info: null, glyph_table: null, refs: null, matched_fonts: [], code_points: null, vietnamese: null, problems: problems, diagnostics: null };
    const hdr = readHeader(R, ob, problems); out.header = hdr ? { script_file_id: hdr.script.file_id, script_path_id: hdr.script.path_id, enabled: hdr.enabled } : null;
    out.name = hdr ? hdr.name : null;
    const start = hdr ? hdr.data_start : 0, fi = findFaceInfo(R, ob, start);
    if (fi) out.font_info = { name: fi.name, point_size: Math.round(fi.point_size * 100) / 100, scale: Math.round(fi.scale * 1000) / 1000, declared_char_count: fi.declared_char_count, line_height: Math.round(fi.line_height * 100) / 100,
      atlas_width: fi.atlas_width, atlas_height: fi.atlas_height, atlas_basis: fi.atlas_basis, offset: fi.offset };
    else problems.push('Không thấy neo FaceInfo (tên font + PointSize/Scale/CharacterCount hợp lý)');
    const gt = findGlyphTable(R, fi ? fi.offset : start, fi ? fi.atlas_width : null, fi ? fi.atlas_height : null, fi ? fi.declared_char_count : 0);
    const hexHead = function (o, n) { let s = ''; for (let i = o; i < Math.min(R.len, o + n); i++) s += (i > o ? ' ' : '') + (ob[i] < 16 ? '0' : '') + ob[i].toString(16); return s; };
    out.diagnostics = { object_size: R.len, data_start: start, faceinfo_offset: fi ? fi.offset : null, hex_head: hexHead(start, LIMITS.hex_head_bytes), stride: STRIDE };
    if (!gt) {
      out.status = fi ? 'glyph_table_not_found' : 'layout_unknown';
      out.reason = 'Không thấy bảng glyph 36 byte/phần tử hợp lệ' + (fi ? ' (FaceInfo: ' + fi.name + ', khai báo ' + fi.declared_char_count + ' ký tự)' : '') + '. Bố cục TMP của bản TextMesh Pro này có thể khác giả định; xem diagnostics.';
      if (fi && fi.declared_char_count > 0) {      // giúp suy ra bố cục thật: nơi nào có số nguyên bằng số ký tự khai báo
        const hits = []; for (let p = align4(start); p + 4 <= R.len && hits.length < LIMITS.max_diag_hits; p += 4) if (R.i32(p) === fi.declared_char_count) { const h = { offset: p, next_hex: hexHead(p + 4, 48) }; if (p + 4 + STRIDE * fi.declared_char_count <= R.len) h.table_check = tableCheck(R, p, fi.declared_char_count, fi.atlas_width, fi.atlas_height); hits.push(h); }
        out.diagnostics.count_hits = hits;
        let best = null; hits.forEach(function (h) { if (h.table_check && (!best || h.table_check.fail_count <= best.table_check.fail_count)) best = h; });
        if (best) out.diagnostics.best_table_check = Object.assign({ offset: best.offset }, best.table_check);      // ứng viên ÍT vi phạm nhất (thường là bảng thật, không phải trường CharacterCount)
      }
      return out;
    }
    const ids = []; for (let i = 0; i < gt.count; i++) ids.push(R.i32(gt.offset + 4 + STRIDE * i));
    const sample = []; for (let i = 0; i < Math.min(3, gt.count); i++) { const o = gt.offset + 4 + STRIDE * i; sample.push({ id: R.i32(o), x: R.f32(o + 4), y: R.f32(o + 8), width: R.f32(o + 12), height: R.f32(o + 16), x_offset: R.f32(o + 20), y_offset: R.f32(o + 24), x_advance: R.f32(o + 28), scale: R.f32(o + 32) }); }
    const set = new Set(ids), rg = ranges(Array.from(set));
    out.glyph_table = { offset: gt.offset, stride: STRIDE, count: gt.count, duplicate_ids: gt.duplicate_ids, count_matches_declared: fi ? fi.declared_char_count === gt.count : null, placeholder_glyphs: gt.placeholder_glyphs, other_tables: gt.others, sample: sample };
    out.code_points = { count: set.size, ranges: rg.slice(0, LIMITS.max_ranges), ranges_total: rg.length, ranges_truncated: rg.length > LIMITS.max_ranges };
    out.vietnamese = vietnamese(set);
    const skip = gt.offset + 4 + STRIDE * gt.count;
    out.refs = findRefs(R, ob, [[start, gt.offset], [skip, R.len]], ctx);
    if (fi) {
      const nf = norm(fi.name);
      ctx.fonts.forEach(function (name, pid) { const nn = norm(name); if (nn && nf && (nn === nf || (Math.min(nn.length, nf.length) >= 4 && (nn.indexOf(nf) === 0 || nf.indexOf(nn) === 0)))) out.matched_fonts.push({ path_id: pid, name: name, basis: 'tên giống FaceInfo.name (không phải tham chiếu)' }); });
    }
    if (gt.others.length) problems.push('Có thêm ' + gt.others.length + ' bảng glyph hợp lệ khác (đã chọn bảng ' + gt.count + ' phần tử' + (fi && fi.declared_char_count === gt.count ? ' khớp CharacterCount' : ' lớn nhất') + '): ' + gt.others.map(function (o) { return o.count + '@' + o.offset; }).join(', '));
    if (gt.duplicate_ids) problems.push(gt.duplicate_ids + ' id glyph trùng (≤1% nên vẫn nhận)');
    let st = 'parsed';
    if (fi && fi.declared_char_count !== gt.count) { problems.push('CharacterCount khai báo ' + fi.declared_char_count + ' ≠ số glyph đọc được ' + gt.count + ' (có thể bảng glyph thực khác hoặc FaceInfo cũ)'); st = 'partial'; }
    if (!fi) { problems.push('Không có FaceInfo: không biết tên font nguồn/kích thước atlas; bảng glyph chỉ được kiểm bằng ràng buộc chung'); st = 'partial'; }
    out.status = st;
    out.reason = 'Atlas có ' + set.size + ' ký tự khác nhau; tiếng Việt ' + out.vietnamese.covered + '/' + out.vietnamese.required + ' (' + out.vietnamese.level + ')';
    return out;
  }

  /* ---------- quét ---------- */
  function baseResult() { return { schema: SCHEMA, sub_phase: '5.2d', status: 'not_run', reason: '', items: [], summary: null, limits: Object.assign({}, LIMITS), limitations: NOT_DONE.slice(), warnings: [] }; }
  function objName(ob, le, off) { try { const R = mk(ob, le), s = readStr(R, ob, off || 0, 512); return s ? s.s : ''; } catch (e) { return ''; } }

  /** Phần THUẦN của quét một file đã parse: trả danh sách item. */
  function decodeFile(bytes, info, tmpIdx, fileRec, res) {
    const le = info.header.endian === 'little', ctx = { textures: new Map(), materials: new Map(), fonts: new Map(), tmp: new Map() };
    const tmpSet = new Set(tmpIdx);
    info.objects.forEach(function (o) {
      if (!o.in_range || o.byte_start + o.byte_size > bytes.length) return;
      const cid = o.class_id, k = cid === 28 ? 'textures' : cid === 21 ? 'materials' : cid === 128 ? 'fonts' : (cid === 114 && tmpSet.has(o.index)) ? 'tmp' : null;
      if (!k) return; ctx[k].set(o.path_id, objName(bytes.subarray(o.byte_start, o.byte_start + o.byte_size), le, k === 'tmp' ? 28 : 0));
    });
    tmpIdx.forEach(function (idx) {
      if (res.items.length >= LIMITS.max_assets) { if (!res._cap) { res.warnings.push('Quá ' + LIMITS.max_assets + ' TMP_FontAsset, bỏ phần còn lại'); res._cap = 1; } return; }
      const o = info.objects[idx], item = { id: res.items.length, file_id: fileRec.id, source: fileRec.path, object_index: idx, path_id: o ? o.path_id : null, size: o ? o.byte_size : 0, name: null };
      res.items.push(item);
      if (!o || !o.in_range || o.byte_start + o.byte_size > bytes.length) { Object.assign(item, { status: 'error', reason: 'Object ngoài dữ liệu đã đọc', problems: [] }); return; }
      if (o.byte_size > LIMITS.max_asset_bytes) { Object.assign(item, { status: 'too_large', reason: 'Object ' + o.byte_size + ' byte vượt giới hạn ' + LIMITS.max_asset_bytes, problems: [] }); return; }
      const d = decodeObject(bytes.subarray(o.byte_start, o.byte_start + o.byte_size), le, ctx);
      Object.assign(item, d); item.id = res.items.length - 1; item.name = d.name !== null ? d.name : (ctx.tmp.get(o.path_id) || null);
    });
  }

  /**
   * @param {File} file
   * @param {object} ipa  IpaResult (cần serialized.files[].tmp_font_assets)
   * @param {object[]} entries  entry GỐC của openZip
   * @param {{isCancelled?:Function, progress?:Function}} hooks
   */
  async function scan(file, ipa, entries, hooks) {
    hooks = hooks || {}; const IR = NS.IpaReader, SF = NS.SerializedFile, cancelled = hooks.isCancelled || function () { return false; }, res = baseResult();
    try {
      const sr = ipa && ipa.serialized;
      if (!sr || !Array.isArray(sr.files) || !IR || !SF) { res.status = 'not_run'; res.reason = 'Chưa có kết quả SerializedFile (5.2c)'; return res; }
      const files = sr.files.filter(function (f) { return f.tmp_font_assets && f.tmp_font_assets.length; });
      if (!files.length) { res.status = 'no_tmp'; res.reason = 'Không có MonoBehaviour nào thuộc class TMP_FontAsset trong các SerializedFile đã đọc.'; res.summary = summarize(res); return res; }
      const byName = new Map(); (entries || []).forEach(function (e) { byName.set(e.name, e); });
      let done = 0;
      for (const f of files) {
        if (cancelled()) { const e = new Error('Đã hủy'); e.code = 'CANCELLED'; throw e; }
        if (f.source !== 'file') { res.warnings.push(f.tmp_font_assets.length + ' TMP_FontAsset trong node bundle “' + f.path + '” chưa được đọc (chỉ hỗ trợ file .assets/level/sharedassets).'); done++; continue; }
        const ent = byName.get(f.zip_path);
        if (!ent) res.warnings.push('Không thấy entry ' + f.zip_path + ' để đọc TMP_FontAsset');
        else if (ent.size > LIMITS.max_file_bytes) res.warnings.push('File ' + f.path + ' (' + ent.size + ' byte) vượt giới hạn ' + LIMITS.max_file_bytes + ': bỏ qua ' + f.tmp_font_assets.length + ' TMP_FontAsset');
        else {
          try {
            const bytes = (await IR.readEntry(file, ent, { max: LIMITS.max_file_bytes })).data, info = SF.parse(bytes, ent.size);
            if (info.status !== 'parsed') res.warnings.push('File ' + f.path + ': đọc lại không thành công (' + info.status + ')');
            else decodeFile(bytes, info, f.tmp_font_assets, f, res);
          } catch (e) { if (e && e.code === 'CANCELLED') throw e; res.warnings.push('File ' + f.path + ': ' + ((e && e.message) || e)); }
        }
        done++; if (hooks.progress) hooks.progress(done / files.length);
      }
      delete res._cap;
      res.summary = summarize(res);
      const s = res.summary; res.status = s.assets === 0 ? 'none_parsed' : s.parsed === s.assets ? 'ok' : s.parsed + s.partial > 0 ? 'partial' : 'none_parsed';
      res.reason = s.assets + ' TMP_FontAsset: ' + s.parsed + ' đọc đủ, ' + s.partial + ' một phần, ' + s.not_found + ' không đọc được bảng glyph; tiếng Việt đủ ' + s.vietnamese_full + ', thiếu ' + s.vietnamese_partial + ', không có ' + s.vietnamese_none;
    } catch (e) { if (e && e.code === 'CANCELLED') throw e; res.status = 'error'; res.reason = 'Lỗi không mong đợi: ' + ((e && e.message) || e); }
    return res;
  }

  function summarize(res) {
    const s = { assets: res.items.length, parsed: 0, partial: 0, not_found: 0, other: 0, by_status: {}, vietnamese_full: 0, vietnamese_partial: 0, vietnamese_none: 0 };
    res.items.forEach(function (it) {
      s.by_status[it.status] = (s.by_status[it.status] || 0) + 1;
      if (it.status === 'parsed') s.parsed++; else if (it.status === 'partial') s.partial++; else if (it.status === 'glyph_table_not_found' || it.status === 'layout_unknown') s.not_found++; else s.other++;
      if (it.vietnamese) { if (it.vietnamese.level === 'full') s.vietnamese_full++; else if (it.vietnamese.level === 'partial') s.vietnamese_partial++; else s.vietnamese_none++; }
    });
    return s;
  }
  function toIndex(r) { return r ? JSON.parse(JSON.stringify(r)) : null; }
  function toReportFields(r) {
    if (!r || !r.summary) return null; const s = r.summary;
    return { tmp_status: r.status, tmp_font_assets: s.assets, tmp_parsed: s.parsed, tmp_not_found: s.not_found, tmp_vi_full: s.vietnamese_full, tmp_vi_partial: s.vietnamese_partial, tmp_vi_none: s.vietnamese_none };
  }

  NS.TmpFont = { SCHEMA: SCHEMA, LIMITS: LIMITS, NOT_DONE: NOT_DONE, STRIDE: STRIDE, VI_REQUIRED: VI_REQUIRED, decodeObject: decodeObject, decodeFile: decodeFile, scan: scan, toIndex: toIndex, toReportFields: toReportFields };
})(typeof window !== 'undefined' ? window : self);
