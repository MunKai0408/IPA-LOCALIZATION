/* font_metrics.js – Phase 5, SUB-PHASE 5.2b + 5.3: metadata font sfnt (TTF/OTF/TTC/WOFF) và ĐỘ PHỦ TIẾNG VIỆT theo bảng cmap.
   Đọc: name (family/subfamily/full/PostScript/version/typographic), head (unitsPerEm), maxp (numGlyphs), cmap (format 4/12/6) → đếm code point + kiểm 134 ký tự tiếng Việt có dấu dựng sẵn (NFC) + chữ cái ASCII.
   KHÔNG làm: WOFF2 (Brotli – không có parser: trạng thái unsupported), GSUB/GPOS/mark-to-base (chữ Việt dựng từ dấu rời), hinting, kiểm hình dạng glyph có thật hay chỉ là ô trống,
   atlas TMP_FontAsset (font TMP tĩnh chỉ hiển thị được ký tự CÓ trong atlas – độ phủ của file font nguồn chưa đủ để kết luận game hiển thị được).
   Độ phủ chỉ nói "cmap có ánh xạ code point tới glyph khác 0". Bố cục bảng lấy từ kiến thức về OpenType/WOFF (mạng tắt trong phiên viết, không đối chiếu spec); fixture dựng bằng fontTools (độc lập).
   Không ném lỗi trừ CANCELLED. Chạy ở Worker và luồng chính. WOFF cần DecompressionStream('deflate'). */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};
  const SCHEMA = 'font_metrics/1';
  const LIMITS = { max_fonts: 2000, max_font_bytes: 64 * 1048576, max_tables: 1000, max_ttc_fonts: 64, max_woff_total: 128 * 1048576, max_listed_missing: 150 };
  const NOT_DONE = ['WOFF2 (Brotli)', 'chữ Việt dựng từ dấu rời (GSUB/GPOS/mark)', 'kiểm glyph có hình thật', 'atlas TMP_FontAsset (font tĩnh chỉ hiển thị ký tự có trong atlas)', 'font bitmap (.fnt/BMFont)'];

  /* ---- 134 ký tự tiếng Việt dựng sẵn (không tính ASCII) + 52 chữ cái ASCII ---- */
  const VI_REQUIRED = (function () {
    const bases = 'aăâeêioôơuưy', tones = ['', '\u0300', '\u0309', '\u0303', '\u0301', '\u0323'], set = {}, out = [];
    (bases + bases.toUpperCase()).split('').forEach(function (b) { tones.forEach(function (t) { const ch = (b + t).normalize('NFC'); if (ch.length === 1 && ch.charCodeAt(0) > 127) set[ch.charCodeAt(0)] = 1; }); });
    set[0x111] = 1; set[0x110] = 1;                                // đ Đ
    Object.keys(set).forEach(function (k) { out.push(+k); }); out.sort(function (a, b) { return a - b; }); return out;
  })();
  const ASCII_LETTERS = (function () { const a = []; for (let i = 65; i <= 90; i++) { a.push(i); a.push(i + 32); } return a; })();
  const hex = function (cp) { return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'); };

  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function tag4(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }
  function inRange(b, o, n) { return o >= 0 && n >= 0 && o + n <= b.length; }

  /* ---- name ---- */
  function decodeName(raw, plat) {
    if (plat === 1) { try { return new TextDecoder('macintosh').decode(raw); } catch (e) { let s = ''; for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]); return s; } }
    let s = ''; for (let i = 0; i + 1 < raw.length; i += 2) s += String.fromCharCode((raw[i] << 8) | raw[i + 1]); return s;
  }
  function parseName(t, problems) {
    const out = { family: null, subfamily: null, full: null, postscript: null, version: null, typographic_family: null, typographic_subfamily: null };
    if (!t || t.length < 6) return out;
    try {
      const count = u16(t, 2), so = u16(t, 4), best = {}, want = { 1: 'family', 2: 'subfamily', 4: 'full', 5: 'version', 6: 'postscript', 16: 'typographic_family', 17: 'typographic_subfamily' };
      if (6 + count * 12 > t.length) { problems.push('Bảng name khai báo ' + count + ' bản ghi vượt kích thước bảng'); return out; }
      for (let i = 0; i < count; i++) {
        const o = 6 + i * 12, plat = u16(t, o), enc = u16(t, o + 2), lang = u16(t, o + 4), id = u16(t, o + 6), len = u16(t, o + 8), off = u16(t, o + 10), key = want[id];
        if (!key) continue;
        const score = plat === 3 && (enc === 1 || enc === 10) ? (lang === 0x409 ? 0 : 1) : plat === 0 ? 2 : plat === 1 && enc === 0 ? 3 : 9;
        if (score === 9 || !inRange(t, so + off, len)) continue;
        if (best[key] === undefined || score < best[key]) { best[key] = score; out[key] = decodeName(t.subarray(so + off, so + off + len), plat); }
      }
    } catch (e) { problems.push('Lỗi đọc bảng name: ' + e.message); }
    return out;
  }

  /* ---- cmap ---- */
  function cmapLookup(t, problems) {
    const res = { status: 'none', subtables: [], chosen: null, has: null, count: 0 };
    if (!t || t.length < 4) { res.status = 'missing'; return res; }
    const n = u16(t, 2); if (4 + n * 8 > t.length) { res.status = 'invalid'; problems.push('cmap khai báo ' + n + ' subtable vượt kích thước bảng'); return res; }
    for (let i = 0; i < n; i++) { const o = 4 + i * 8, off = u32(t, o + 4); res.subtables.push({ platform: u16(t, o), encoding: u16(t, o + 2), offset: off, format: inRange(t, off, 2) ? u16(t, off) : null }); }
    const uni = res.subtables.filter(function (s) { return s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10)); });
    const rank = function (s) { return s.format === 12 ? 0 : s.format === 4 ? 1 : s.format === 6 ? 2 : 9; };
    uni.sort(function (a, b) { return rank(a) - rank(b); });
    const pick = uni.find(function (s) { return rank(s) < 9; });
    if (!pick) { res.status = uni.length ? 'unsupported_format' : 'no_unicode_cmap'; return res; }
    const o = pick.offset;
    try {
      if (pick.format === 4) {
        const segX2 = u16(t, o + 6), sc = segX2 >> 1, endO = o + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, roO = deltaO + segX2;
        if (!inRange(t, o, 16 + 4 * segX2) || sc === 0) throw new Error('format 4 vượt bảng');
        const has = function (cp) {
          if (cp > 0xFFFF) return false; let lo = 0, hi = sc - 1;
          while (lo < hi) { const m = (lo + hi) >> 1; if (u16(t, endO + 2 * m) >= cp) hi = m; else lo = m + 1; }
          if (u16(t, endO + 2 * lo) < cp || u16(t, startO + 2 * lo) > cp) return false;
          const delta = u16(t, deltaO + 2 * lo), ro = u16(t, roO + 2 * lo);
          if (ro === 0) return ((cp + delta) & 0xFFFF) !== 0;
          const a = roO + 2 * lo + ro + 2 * (cp - u16(t, startO + 2 * lo)); if (!inRange(t, a, 2)) return false;
          const g = u16(t, a); return g !== 0 && ((g + delta) & 0xFFFF) !== 0;
        };
        let c = 0; for (let s = 0; s < sc; s++) { const st = u16(t, startO + 2 * s), en = u16(t, endO + 2 * s); for (let cp = st; cp <= en && cp < 0xFFFF; cp++) if (has(cp)) c++; }
        res.has = has; res.count = c;
      } else if (pick.format === 12) {
        const ng = u32(t, o + 12); if (ng > (t.length - o - 16) / 12) throw new Error('format 12 khai báo ' + ng + ' nhóm vượt bảng');
        const gO = o + 16, has = function (cp) {
          let lo = 0, hi = ng - 1;
          while (lo <= hi) { const m = (lo + hi) >> 1, st = u32(t, gO + 12 * m), en = u32(t, gO + 12 * m + 4); if (cp < st) hi = m - 1; else if (cp > en) lo = m + 1; else return u32(t, gO + 12 * m + 8) + cp - st !== 0; }
          return false;
        };
        let c = 0; for (let g = 0; g < ng; g++) c += u32(t, gO + 12 * g + 4) - u32(t, gO + 12 * g) + 1;
        res.has = has; res.count = c;
      } else {
        const first = u16(t, o + 6), cnt = u16(t, o + 8); if (!inRange(t, o + 10, cnt * 2)) throw new Error('format 6 vượt bảng');
        res.has = function (cp) { return cp >= first && cp < first + cnt && u16(t, o + 10 + 2 * (cp - first)) !== 0; };
        let c = 0; for (let i = 0; i < cnt; i++) if (u16(t, o + 10 + 2 * i) !== 0) c++; res.count = c;
      }
      res.chosen = { platform: pick.platform, encoding: pick.encoding, format: pick.format }; res.status = 'ok';
    } catch (e) { res.status = 'invalid'; problems.push('cmap subtable (' + pick.platform + ',' + pick.encoding + ' fmt ' + pick.format + ') lỗi: ' + e.message); }
    return res;
  }

  function vietnamese(cm) {
    if (cm.status !== 'ok') return { level: 'unknown', reason: cm.status === 'no_unicode_cmap' ? 'Font không có cmap Unicode (font symbol/Mac?)' : 'Không đọc được cmap (' + cm.status + ')', required: VI_REQUIRED.length, covered: null, missing_count: null, missing: [], percent: null, ascii_letters_ok: null };
    const miss = VI_REQUIRED.filter(function (cp) { return !cm.has(cp); }), cov = VI_REQUIRED.length - miss.length, ascii = ASCII_LETTERS.every(function (cp) { return cm.has(cp); });
    return { level: miss.length === 0 ? 'full' : cov === 0 ? 'none' : 'partial', required: VI_REQUIRED.length, covered: cov, missing_count: miss.length, missing: miss.slice(0, LIMITS.max_listed_missing).map(hex), percent: Math.round(cov * 1000 / VI_REQUIRED.length) / 10, ascii_letters_ok: ascii };
  }

  /* ---- một font từ bảng sfnt ---- */
  function fromTables(tables, flavorTag, extraProblems) {
    const problems = (extraProblems || []).slice(), f = { flavor: flavorTag === 'OTTO' ? 'cff' : flavorTag === 'true' || flavorTag === '\u0000\u0001\u0000\u0000' ? 'truetype' : 'khác', tables: Object.keys(tables).sort() };
    f.names = parseName(tables.name, problems); f.units_per_em = null; f.num_glyphs = null;
    if (tables.head && tables.head.length >= 20) f.units_per_em = u16(tables.head, 18); else problems.push('Thiếu hoặc cụt bảng head');
    if (tables.maxp && tables.maxp.length >= 6) f.num_glyphs = u16(tables.maxp, 4); else problems.push('Thiếu hoặc cụt bảng maxp');
    if (f.units_per_em !== null && (f.units_per_em < 16 || f.units_per_em > 16384)) problems.push('unitsPerEm = ' + f.units_per_em + ' ngoài dải 16–16384');
    const cm = cmapLookup(tables.cmap, problems);
    f.cmap = { status: cm.status, chosen: cm.chosen, code_points: cm.status === 'ok' ? cm.count : null, subtables: cm.subtables.map(function (s) { return { platform: s.platform, encoding: s.encoding, format: s.format }; }) };
    f.vietnamese = vietnamese(cm); f.problems = problems; return f;
  }

  function readDir(b, base, problems) {
    if (!inRange(b, base, 12)) throw new Error('Thiếu bảng thư mục sfnt');
    const n = u16(b, base + 4); if (n === 0 || n > LIMITS.max_tables) throw new Error('numTables = ' + n + ' vô lý');
    if (!inRange(b, base + 12, n * 16)) throw new Error('Thư mục bảng (' + n + ') vượt file');
    const tables = {};
    for (let i = 0; i < n; i++) {
      const o = base + 12 + i * 16, tg = tag4(b, o), off = u32(b, o + 8), len = u32(b, o + 12);
      if (!inRange(b, off, len)) { problems.push('Bảng "' + tg + '" [' + off + ', +' + len + ') vượt file: bỏ qua'); continue; }
      tables[tg] = b.subarray(off, off + len);
    }
    return tables;
  }

  async function inflate(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Môi trường không có DecompressionStream');
    const ds = new DecompressionStream('deflate'), w = ds.writable.getWriter(); w.write(u8).catch(function () {}); w.close().catch(function () {});
    const buf = await new Response(ds.readable).arrayBuffer(); return new Uint8Array(buf);
  }

  /** Phân tích một file font. @returns {Promise<{status, container, fonts[], problems[], reason}>}; không ném. */
  async function parse(b) {
    const res = { status: 'invalid', container: null, fonts: [], problems: [], reason: '' };
    try {
      if (!(b instanceof Uint8Array) || b.length < 12) { res.status = 'not_font'; res.reason = 'Quá ngắn'; return res; }
      if (b.length > LIMITS.max_font_bytes) { res.status = 'too_large'; res.reason = b.length + ' byte vượt giới hạn'; return res; }
      const m = tag4(b, 0);
      if (m === 'wOF2') { res.status = 'unsupported_woff2'; res.container = 'woff2'; res.reason = 'WOFF2 (Brotli) chưa hỗ trợ'; return res; }
      if (m === 'wOFF') {
        res.container = 'woff'; const n = u16(b, 12), flavor = tag4(b, 4);
        if (n === 0 || n > LIMITS.max_tables || !inRange(b, 44, n * 20)) { res.status = 'invalid'; res.reason = 'Thư mục bảng WOFF không hợp lệ'; return res; }
        const tables = {}; let total = 0;
        for (let i = 0; i < n; i++) {
          const o = 44 + i * 20, tg = tag4(b, o), off = u32(b, o + 4), cl = u32(b, o + 8), ol = u32(b, o + 12);
          total += ol; if (total > LIMITS.max_woff_total) { res.status = 'too_large'; res.reason = 'Tổng kích thước giải nén WOFF vượt giới hạn'; return res; }
          if (!inRange(b, off, cl)) { res.problems.push('Bảng WOFF "' + tg + '" vượt file: bỏ qua'); continue; }
          const raw = b.subarray(off, off + cl);
          try { const d = cl < ol ? await inflate(raw) : raw; if (d.length !== ol) { res.problems.push('Bảng "' + tg + '": giải nén ra ' + d.length + ' ≠ khai báo ' + ol); if (d.length < ol) continue; } tables[tg] = d; }
          catch (e) { res.problems.push('Bảng "' + tg + '" giải nén lỗi: ' + e.message); }
        }
        res.fonts.push(Object.assign({ index: 0 }, fromTables(tables, flavor, []))); res.status = 'parsed'; res.reason = 'WOFF, 1 font'; return res;
      }
      if (m === 'ttcf') {
        res.container = 'ttc'; const nf = u32(b, 8); if (nf === 0 || nf > LIMITS.max_ttc_fonts || !inRange(b, 12, nf * 4)) { res.status = 'invalid'; res.reason = 'TTC khai báo ' + nf + ' font không hợp lệ'; return res; }
        for (let i = 0; i < nf; i++) {
          const pr = [], base = u32(b, 12 + 4 * i);
          try { const t = readDir(b, base, pr); res.fonts.push(Object.assign({ index: i }, fromTables(t, tag4(b, base), pr))); } catch (e) { res.problems.push('Font con #' + i + ': ' + e.message); }
        }
        res.status = res.fonts.length ? 'parsed' : 'invalid'; res.reason = 'TTC, ' + res.fonts.length + '/' + nf + ' font đọc được'; return res;
      }
      if (m === '\u0000\u0001\u0000\u0000' || m === 'OTTO' || m === 'true') {
        res.container = m === 'OTTO' ? 'otf' : 'ttf'; const pr = []; const t = readDir(b, 0, pr);
        res.fonts.push(Object.assign({ index: 0 }, fromTables(t, m, pr))); res.status = 'parsed'; res.reason = '1 font'; return res;
      }
      res.status = 'not_font'; res.reason = 'Magic không phải sfnt/TTC/WOFF'; return res;
    } catch (e) { res.status = 'invalid'; res.reason = 'Lỗi cấu trúc: ' + ((e && e.message) || e); return res; }
  }

  function bestLevel(fonts) {
    const rank = { full: 3, partial: 2, none: 1, unknown: 0 }; let best = null;
    fonts.forEach(function (f) { if (best === null || rank[f.vietnamese.level] > rank[best]) best = f.vietnamese.level; }); return best;
  }

  /** Quét mọi font đã trích (ipa.font_files + ipa.serialized_files, khóa 'Fonts/…'). @returns {Promise<FontMetricsResult>}; chỉ ném CANCELLED. */
  async function scan(ipa, hooks) {
    hooks = hooks || {}; const res = { schema: SCHEMA, sub_phase: '5.2b+5.3', status: 'not_run', reason: '', items: [], summary: null, vietnamese_required: VI_REQUIRED.length, limits: Object.assign({}, LIMITS), limitations: NOT_DONE.slice(), warnings: [] };
    try {
      if (!ipa) { res.reason = 'Thiếu kết quả IPA'; return res; }
      const sources = [], add = function (map, label) { if (map && typeof map === 'object') Object.keys(map).forEach(function (k) { if (/^Fonts\//.test(k) && map[k] instanceof Uint8Array) sources.push({ path: k, bytes: map[k], source: /^Fonts\/unity\//.test(k) ? 'unity_font' : label }); }); };
      add(ipa.font_files, 'ipa_file'); add(ipa.serialized_files, 'unity_font');
      let list = sources; if (list.length > LIMITS.max_fonts) { res.warnings.push('Có ' + list.length + ' font, chỉ xử lý ' + LIMITS.max_fonts + ' đầu tiên.'); list = list.slice(0, LIMITS.max_fonts); }
      if (!list.length) { res.status = 'no_fonts'; res.reason = 'Không có font nào đã trích xuất để phân tích'; res.summary = summarize(res.items); return res; }
      let i = 0;
      for (const s of list) {
        if (hooks.isCancelled && hooks.isCancelled()) { const e = new Error('Đã hủy'); e.code = 'CANCELLED'; throw e; }
        const p = await parse(s.bytes);
        res.items.push({ id: res.items.length, path: s.path, source: s.source, size: s.bytes.length, status: p.status, reason: p.reason, container: p.container, fonts: p.fonts, vietnamese_level: p.fonts.length ? bestLevel(p.fonts) : null, problems: p.problems });
        i++; if (hooks.progress) hooks.progress(i / list.length);
      }
      res.summary = summarize(res.items); const sm = res.summary; res.status = sm.parsed === 0 ? 'none_parsed' : sm.parsed === sm.fonts ? 'ok' : 'partial';
      res.reason = sm.parsed + '/' + sm.fonts + ' file font phân tích được; đủ tiếng Việt ' + sm.vietnamese_full + ', thiếu một phần ' + sm.vietnamese_partial + ', không có ' + sm.vietnamese_none + ', chưa xác định ' + sm.vietnamese_unknown;
    } catch (e) { if (e && e.code === 'CANCELLED') throw e; res.status = 'error'; res.reason = 'Lỗi không mong đợi: ' + ((e && e.message) || e); }
    return res;
  }

  function summarize(items) {
    const s = { fonts: items.length, parsed: 0, by_status: {}, vietnamese_full: 0, vietnamese_partial: 0, vietnamese_none: 0, vietnamese_unknown: 0 };
    items.forEach(function (it) {
      s.by_status[it.status] = (s.by_status[it.status] || 0) + 1;
      if (it.status === 'parsed') { s.parsed++; const l = it.vietnamese_level; if (l === 'full') s.vietnamese_full++; else if (l === 'partial') s.vietnamese_partial++; else if (l === 'none') s.vietnamese_none++; else s.vietnamese_unknown++; }
    });
    return s;
  }
  function toIndex(r) { return r ? JSON.parse(JSON.stringify(r)) : null; }
  function toReportFields(r) { if (!r || !r.summary) return null; const s = r.summary; return { fontmetrics_status: r.status, fonts_analyzed: s.parsed, fonts_vi_full: s.vietnamese_full, fonts_vi_partial: s.vietnamese_partial, fonts_vi_none: s.vietnamese_none }; }

  NS.FontMetrics = { SCHEMA: SCHEMA, LIMITS: LIMITS, NOT_DONE: NOT_DONE, VI_REQUIRED: VI_REQUIRED, ASCII_LETTERS: ASCII_LETTERS, parse: parse, scan: scan, toIndex: toIndex, toReportFields: toReportFields };
})(typeof window !== 'undefined' ? window : self);
