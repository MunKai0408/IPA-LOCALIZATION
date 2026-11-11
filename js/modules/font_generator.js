/* font_generator.js – bộ sinh glyph tiếng Việt cho font BITMAP (BMFont .fnt dạng text/XML + atlas PNG).
 * Chỉ dùng API trình duyệt (Canvas) + code thuần; không backend, không thư viện ngoài.
 * Hai chế độ:
 *   append  – GIỮ nguyên atlas gốc, vẽ riêng các glyph còn thiếu vào trang atlas MỚI, thêm vào .fnt (page + char).
 *   rebuild – dựng LẠI toàn bộ atlas 1 trang từ font nguồn (mất hình dáng gốc; dùng khi engine không đọc nhiều trang).
 * Rasterizer là giao diện cắm vào được: Canvas trong trình duyệt, bản giả trong test Node.
 * [HYPOTHESIS] Chưa kiểm trên game thật: engine có nhận trang atlas thêm/atlas dựng lại hay không là CHƯA BIẾT. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};
  const SCHEMA = 'font_generator/1';
  const LIMITS = { max_pages: 16, max_atlas: 4096, max_glyph: 512, max_chars: 20000 };
  const NOT_DONE = [
    'font TTF/OTF/WOFF (chưa sinh lại bảng glyf/cmap; chỉ báo thiếu glyph)',
    'BMFont nhị phân (v3) – chưa ghi lại',
    'font bitmap kênh gói (packed/chnl khác 15) ở chế độ append',
    'khớp nét/viền/màu của atlas gốc (glyph mới là trắng + alpha, không giải mã atlas gốc)',
    'kerning cho glyph mới',
    'đóng gói ngược vào pak/IPA',
    'xác nhận trên game thật'
  ];

  /* ---------- tiện ích ---------- */
  const hex = function (cp) { return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'); };
  function viRequired() { return (NS.FontMetrics && NS.FontMetrics.VI_REQUIRED) ? NS.FontMetrics.VI_REQUIRED.slice() : []; }
  function attrs(s) { const o = {}, re = /(\w+)=(?:"([^"]*)"|([^\s"]+))/g; let m; while ((m = re.exec(s))) o[m[1]] = m[2] !== undefined ? m[2] : m[3]; return o; }
  const num = function (v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; };
  const dirOf = function (p) { const i = (p || '').lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); };
  const baseOf = function (p) { const i = (p || '').lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); };
  const stemOf = function (p) { return baseOf(p).replace(/\.[^.]*$/, ''); };

  /* ---------- đọc .fnt (text/XML) ---------- */
  function parseFnt(bytes) {
    if (!bytes || bytes.length < 8) return { error: 'too_short', reason: 'File .fnt quá ngắn' };
    if (bytes[0] === 66 && bytes[1] === 77 && bytes[2] === 70) return { error: 'binary', reason: 'BMFont nhị phân chưa được hỗ trợ ghi lại' };
    let text; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch (e) { return { error: 'encoding', reason: 'File .fnt không phải UTF-8' }; }
    let bom = false; if (text.charCodeAt(0) === 0xFEFF) { bom = true; text = text.slice(1); }
    const eol = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n', xml = /^\s*(<\?xml|<font)/.test(text);
    const m = { format: xml ? 'xml' : 'text', bom: bom, eol: eol, text: text, info: null, infoRaw: null, common: null, pages: [], charIds: new Set(), chnls: new Set(), charCount: 0, declaredCount: null };
    if (xml) {
      const re = /<(info|common|page|chars|char)\s([^>]*?)\/?>/g; let x;
      while ((x = re.exec(text))) { const a = attrs(x[2]); take(m, x[1], a, x[0]); }
    } else {
      text.split(/\r?\n/).forEach(function (ln) {
        const t = /^\s*(info|common|page|chars|char)\s+(.*)$/.exec(ln); if (t) take(m, t[1], attrs(t[2]), ln);
      });
    }
    if (!m.common || !m.common.scaleW || !m.common.scaleH) return { error: 'no_common', reason: 'Thiếu dòng common/scaleW/scaleH – không dám đoán' };
    if (!m.charIds.size) return { error: 'no_chars', reason: 'Không có ký tự nào trong .fnt' };
    if (!m.pages.length) return { error: 'no_pages', reason: 'Không có dòng page' };
    return m;
  }
  function take(m, tag, a, raw) {
    if (tag === 'info') { m.info = { face: a.face || null, size: a.size != null ? Math.abs(num(a.size)) : null }; m.infoRaw = raw; }
    else if (tag === 'common') m.common = { lineHeight: num(a.lineHeight), base: num(a.base), scaleW: num(a.scaleW), scaleH: num(a.scaleH), pages: num(a.pages), packed: num(a.packed) || 0 };
    else if (tag === 'page') m.pages.push({ id: num(a.id), file: a.file || '' });
    else if (tag === 'chars') m.declaredCount = num(a.count);
    else if (tag === 'char') { const id = num(a.id); if (id != null) { m.charIds.add(id); m.charCount++; if (a.chnl != null) m.chnls.add(num(a.chnl)); } }
  }

  /* ---------- PNG RGBA thuần (deflate dạng STORE) ---------- */
  const CRC_T = (function () { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function adler32(b) { let a = 1, s = 0; for (let i = 0; i < b.length; i++) { a = (a + b[i]) % 65521; s = (s + a) % 65521; } return ((s << 16) | a) >>> 0; }
  function encodePng(w, h, rgba) {
    if (!(w > 0 && h > 0) || rgba.length !== w * h * 4) throw new Error('Kích thước PNG không khớp dữ liệu');
    const stride = w * 4, raw = new Uint8Array((stride + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); }
    const nb = Math.ceil(raw.length / 65535) || 1, z = new Uint8Array(2 + raw.length + nb * 5 + 4); let p = 0; z[p++] = 0x78; z[p++] = 0x01;
    for (let i = 0; i < nb; i++) {
      const s = i * 65535, n = Math.min(65535, raw.length - s); z[p++] = i === nb - 1 ? 1 : 0; z[p++] = n & 255; z[p++] = n >>> 8; z[p++] = (~n) & 255; z[p++] = ((~n) >>> 8) & 255;
      z.set(raw.subarray(s, s + n), p); p += n;
    }
    const ad = adler32(raw); z[p++] = ad >>> 24; z[p++] = (ad >>> 16) & 255; z[p++] = (ad >>> 8) & 255; z[p++] = ad & 255;
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z.subarray(0, p)), chunk('IEND', new Uint8Array(0))];
    let tot = 0; parts.forEach(function (x) { tot += x.length; }); const out = new Uint8Array(tot); let o = 0; parts.forEach(function (x) { out.set(x, o); o += x.length; }); return out;
  }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer); dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
  }

  /* ---------- xếp glyph (shelf packer) ---------- */
  /** glyphs: [{cp,w,h}] → {pages:[[{g,x,y}]], oversize:[cp]}; mỗi trang W×H, cách nhau `gap` px. */
  function pack(glyphs, W, H, gap) {
    const list = glyphs.filter(function (g) { return g.w > 0 && g.h > 0; }).sort(function (a, b) { return b.h - a.h || b.w - a.w || a.cp - b.cp; });
    const pages = [], oversize = []; let cur = null, x = 0, y = 0, rowH = 0;
    list.forEach(function (g) {
      if (g.w + 2 * gap > W || g.h + 2 * gap > H) { oversize.push(g.cp); return; }
      if (!cur) { cur = []; pages.push(cur); x = gap; y = gap; rowH = 0; }
      if (x + g.w + gap > W) { x = gap; y += rowH + gap; rowH = 0; }
      if (y + g.h + gap > H) { cur = []; pages.push(cur); x = gap; y = gap; rowH = 0; }
      cur.push({ g: g, x: x, y: y }); x += g.w + gap; if (g.h > rowH) rowH = g.h;
    });
    return { pages: pages, oversize: oversize };
  }
  function pageRgba(W, H, placed) {
    const px = new Uint8Array(W * H * 4);
    placed.forEach(function (p) {
      const g = p.g;
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) { const a = g.a[j * g.w + i], o = ((p.y + j) * W + p.x + i) * 4; px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = a; }
    });
    return px;
  }

  /* ---------- ghi .fnt ---------- */
  const charLine = function (c, xml) {
    return xml ? '    <char id="' + c.id + '" x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h + '" xoffset="' + c.xo + '" yoffset="' + c.yo + '" xadvance="' + c.xa + '" page="' + c.page + '" chnl="15" />'
      : 'char id=' + c.id + ' x=' + c.x + ' y=' + c.y + ' width=' + c.w + ' height=' + c.h + ' xoffset=' + c.xo + ' yoffset=' + c.yo + ' xadvance=' + c.xa + ' page=' + c.page + ' chnl=15';
  };
  /** Thêm page + char vào .fnt có sẵn (chỉ chỉnh chuỗi; giữ nguyên mọi thứ khác, kể cả kerning và kiểu xuống dòng). */
  function patchAppend(m, newPages, newChars) {
    const xml = m.format === 'xml', total = m.pages.length + newPages.length, count = m.charCount + newChars.length; let out;
    if (xml) {
      out = m.text;
      out = out.replace(/<common\s[^>]*?\/?>/, function (t) { return /\bpages="\d+"/.test(t) ? t.replace(/\bpages="\d+"/, 'pages="' + total + '"') : t.replace(/\s*\/?>$/, ' pages="' + total + '"$&'); });
      out = out.replace(/<chars\s[^>]*?>/, function (t) { return /\bcount="\d+"/.test(t) ? t.replace(/\bcount="\d+"/, 'count="' + count + '"') : t.replace(/>$/, ' count="' + count + '">'); });
      if (!/<\/pages>/.test(out) || !/<\/chars>/.test(out)) return null;
      out = out.replace('</pages>', newPages.map(function (p) { return '    <page id="' + p.id + '" file="' + p.file + '" />'; }).join(m.eol) + m.eol + '  </pages>');
      out = out.replace('</chars>', newChars.map(function (c) { return charLine(c, true); }).join(m.eol) + m.eol + '  </chars>');
    } else {
      const lines = m.text.split(/\r?\n/); let lastChar = -1, lastPage = -1, charsLn = -1, commonLn = -1;
      lines.forEach(function (l, i) { if (/^\s*char\s/.test(l)) lastChar = i; else if (/^\s*page\s/.test(l)) lastPage = i; else if (/^\s*chars\s/.test(l)) charsLn = i; else if (/^\s*common\s/.test(l)) commonLn = i; });
      if (lastChar < 0 || lastPage < 0 || commonLn < 0) return null;
      lines.splice.apply(lines, [lastChar + 1, 0].concat(newChars.map(function (c) { return charLine(c, false); })));
      if (charsLn >= 0) lines[charsLn] = /count=\d+/.test(lines[charsLn]) ? lines[charsLn].replace(/count=\d+/, 'count=' + count) : lines[charsLn] + ' count=' + count;
      lines.splice.apply(lines, [lastPage + 1, 0].concat(newPages.map(function (p) { return 'page id=' + p.id + ' file="' + p.file + '"'; })));
      lines[commonLn] = /\bpages=\d+/.test(lines[commonLn]) ? lines[commonLn].replace(/\bpages=\d+/, 'pages=' + total) : lines[commonLn] + ' pages=' + total;
      out = lines.join(m.eol);
    }
    return new TextEncoder().encode((m.bom ? '\uFEFF' : '') + out);
  }
  /** Dựng .fnt mới (1 trang) cho chế độ rebuild; giữ dòng info và lineHeight/base gốc. Kerning bị bỏ. */
  function buildFnt(m, pageFile, W, H, chars) {
    const xml = m.format === 'xml', lh = m.common.lineHeight, bs = m.common.base, e = m.eol; let s;
    if (xml) {
      s = '<?xml version="1.0"?>' + e + '<font>' + e + '  ' + (m.infoRaw ? m.infoRaw.trim() : '<info />') + e + '  <common lineHeight="' + lh + '" base="' + bs + '" scaleW="' + W + '" scaleH="' + H + '" pages="1" packed="0" alphaChnl="0" redChnl="4" greenChnl="4" blueChnl="4" />' + e +
        '  <pages>' + e + '    <page id="0" file="' + pageFile + '" />' + e + '  </pages>' + e + '  <chars count="' + chars.length + '">' + e + chars.map(function (c) { return charLine(c, true); }).join(e) + e + '  </chars>' + e + '</font>' + e;
    } else {
      s = (m.infoRaw ? m.infoRaw.trim() : 'info') + e + 'common lineHeight=' + lh + ' base=' + bs + ' scaleW=' + W + ' scaleH=' + H + ' pages=1 packed=0 alphaChnl=0 redChnl=4 greenChnl=4 blueChnl=4' + e +
        'page id=0 file="' + pageFile + '"' + e + 'chars count=' + chars.length + e + chars.map(function (c) { return charLine(c, false); }).join(e) + e;
    }
    return new TextEncoder().encode((m.bom ? '\uFEFF' : '') + s);
  }

  /* ---------- sinh ---------- */
  function glyphEntry(cp, g, base) {
    return { cp: cp, w: g.w | 0, h: g.h | 0, a: g.a, xo: Math.round(g.left), yo: Math.round(base - g.ascent), xa: Math.max(0, Math.round(g.advance)) };
  }
  /** o: {fntBytes, fntPath, raster, mode:'append'|'rebuild', ensureAscii?, gap?, onProgress?}. Không ném lỗi; trả {status, reason, files, report}. */
  async function generate(o) {
    const rep = { schema: SCHEMA, mode: o.mode || 'append', fnt_path: o.fntPath || null, face: null, size: null, atlas: null, summary: null, added: [], skipped_not_in_source: [], oversize: [], dropped_existing: [], pages: [], warnings: [], limitations: NOT_DONE.slice(), evidence: '[HYPOTHESIS] sinh bằng Canvas/logic; chưa kiểm trên game thật' };
    const fail = function (status, reason) { return { status: status, reason: reason, files: [], report: Object.assign(rep, { status: status, reason: reason }) }; };
    try {
      const mode = rep.mode; if (mode !== 'append' && mode !== 'rebuild') return fail('bad_mode', 'mode phải là append hoặc rebuild');
      const m = parseFnt(o.fntBytes); if (m.error) return fail(m.error === 'binary' ? 'unsupported' : 'unreadable', m.reason);
      rep.face = m.info && m.info.face; rep.size = m.info && m.info.size; rep.format = m.format;
      const W0 = m.common.scaleW, H0 = m.common.scaleH, base = m.common.base == null ? 0 : m.common.base, gap = o.gap == null ? 1 : o.gap, dir = dirOf(o.fntPath || ''), stem = stemOf(o.fntPath || 'font.fnt');
      rep.atlas = { scaleW: W0, scaleH: H0, pages_in: m.pages.length }; rep.base = base; rep.line_height = m.common.lineHeight;
      if (!o.raster || typeof o.raster.glyph !== 'function') return fail('no_raster', 'Thiếu rasterizer (font nguồn)');
      if (mode === 'append') {
        const odd = Array.from(m.chnls).filter(function (c) { return c !== 15; });
        if (m.common.packed || odd.length) return fail('unsupported_channels', 'Font dùng kênh gói (packed/chnl ' + (odd.join(',') || 'packed=1') + ') – chế độ append sẽ hỏng; dùng rebuild');
      }
      const want = viRequired(); if (!want.length) return fail('no_metrics', 'Thiếu font_metrics.js (VI_REQUIRED)');
      if (o.ensureAscii) for (let c = 32; c < 127; c++) want.push(c);
      const targets = [];
      if (mode === 'append') want.forEach(function (c) { if (!m.charIds.has(c) && targets.indexOf(c) < 0) targets.push(c); });
      else { const all = new Set(want); m.charIds.forEach(function (c) { all.add(c); }); for (let c = 32; c < 127; c++) all.add(c); all.forEach(function (c) { targets.push(c); }); targets.sort(function (a, b) { return a - b; }); }
      if (!targets.length) return { status: 'nothing_to_do', reason: 'Font đã có đủ ký tự cần thiết', files: [], report: Object.assign(rep, { status: 'nothing_to_do', reason: 'Font đã có đủ ký tự cần thiết', summary: { added: 0 } }) };
      if (targets.length > LIMITS.max_chars) return fail('too_many', 'Quá nhiều ký tự cần sinh');
      const glyphs = []; let maxAsc = 0, maxDesc = 0;
      for (let i = 0; i < targets.length; i++) {
        const cp = targets[i]; let g = await o.raster.glyph(cp);
        if (!g) { if (mode === 'rebuild' && m.charIds.has(cp)) rep.dropped_existing.push(hex(cp)); else rep.skipped_not_in_source.push(hex(cp)); continue; }
        if (g.w > LIMITS.max_glyph || g.h > LIMITS.max_glyph) { rep.oversize.push(hex(cp)); continue; }
        const e = glyphEntry(cp, g, base); glyphs.push(e); if (g.h) { if (g.ascent > maxAsc) maxAsc = g.ascent; if (g.h - g.ascent > maxDesc) maxDesc = g.h - g.ascent; }
        if (o.onProgress && i % 25 === 0) o.onProgress(i, targets.length);
      }
      if (!glyphs.length) return fail('no_glyphs', 'Font nguồn không có glyph nào cần thiết (' + rep.skipped_not_in_source.length + ' ký tự thiếu)');
      const lh = m.common.lineHeight || 0;
      if (lh && (maxAsc - base > 0 || maxDesc > lh - base + 2)) rep.warnings.push('Glyph cao/thấp hơn khung dòng gốc (trên base ' + Math.round(maxAsc) + ' px so với base ' + base + '; dưới base ' + Math.round(maxDesc) + ' px): dấu chồng có thể bị cắt trong game');
      if (rep.skipped_not_in_source.length) rep.warnings.push('Font nguồn không có ' + rep.skipped_not_in_source.length + ' ký tự – các ký tự này vẫn thiếu');
      const files = [], newChars = []; let W = W0, H = H0, packed;
      if (mode === 'append') {
        packed = pack(glyphs, W, H, gap);
        if (packed.oversize.length) rep.oversize = rep.oversize.concat(packed.oversize.map(hex));
        if (packed.pages.length > LIMITS.max_pages) return fail('too_many_pages', 'Cần quá nhiều trang atlas (' + packed.pages.length + ')');
      } else {
        packed = pack(glyphs, W, H, gap);
        while ((packed.pages.length > 1 || packed.oversize.length) && (W < LIMITS.max_atlas || H < LIMITS.max_atlas)) { if (W <= H && W < LIMITS.max_atlas) W *= 2; else if (H < LIMITS.max_atlas) H *= 2; else W *= 2; packed = pack(glyphs, W, H, gap); }
        if (packed.pages.length > 1 || packed.oversize.length) return fail('atlas_too_large', 'Không nhét vừa 1 trang atlas ≤ ' + LIMITS.max_atlas + ' px');
      }
      const pageFiles = [], nextId = Math.max.apply(null, m.pages.map(function (p) { return p.id == null ? 0 : p.id; })) + 1, newPages = [];
      const placedCp = new Set();
      packed.pages.forEach(function (pg, k) {
        const id = mode === 'append' ? nextId + k : 0, name = mode === 'append' ? stem + '_vi' + (k + 1) + '.png' : baseOf(m.pages[0].file || (stem + '.png'));
        const png = encodePng(W, H, pageRgba(W, H, pg)); files.push({ path: dir + name, data: png, role: 'atlas-page' }); pageFiles.push(dir + name);
        newPages.push({ id: id, file: name }); rep.pages.push({ id: id, file: dir + name, glyphs: pg.length, bytes: png.length });
        pg.forEach(function (p) { placedCp.add(p.g.cp); newChars.push({ id: p.g.cp, x: p.x, y: p.y, w: p.g.w, h: p.g.h, xo: p.g.xo, yo: p.g.yo, xa: p.g.xa, page: id }); });
      });
      glyphs.forEach(function (g) { if (!(g.w > 0 && g.h > 0)) { placedCp.add(g.cp); newChars.push({ id: g.cp, x: 0, y: 0, w: 0, h: 0, xo: g.xo, yo: g.yo, xa: g.xa, page: mode === 'append' ? nextId : 0 }); } });   // ký tự trống (space)
      if (!newChars.length) return fail('no_glyphs', 'Không có glyph nào xếp được');
      newChars.sort(function (a, b) { return a.id - b.id; });
      if (mode === 'append' && newChars.some(function (c) { return !(c.w > 0) && c.page === nextId; }) && newPages.every(function (p) { return p.id !== nextId; })) newChars.forEach(function (c) { if (!(c.w > 0)) c.page = 0; });
      const fnt = mode === 'append' ? patchAppend(m, newPages, newChars) : buildFnt(m, newPages[0].file, W, H, newChars);
      if (!fnt) return fail('patch_failed', 'Không chỉnh được .fnt (bố cục lạ) – không ghi để tránh làm hỏng file');
      files.unshift({ path: o.fntPath || 'font.fnt', data: fnt, role: 'fnt' });
      const check = parseFnt(fnt); if (check.error || (mode === 'append' && check.charIds.size !== m.charIds.size + newChars.length)) return fail('verify_failed', 'Kiểm lại .fnt sau khi ghi không khớp – bỏ kết quả');
      rep.atlas.scaleW = W; rep.atlas.scaleH = H; rep.atlas.pages_out = mode === 'append' ? m.pages.length + newPages.length : 1;
      if (mode === 'rebuild' && m.pages.length > 1) rep.warnings.push('Font gốc có ' + m.pages.length + ' trang; rebuild chỉ ghi trang 0, các trang còn lại không còn được .fnt dùng');
      if (mode === 'rebuild') rep.warnings.push('rebuild bỏ kerning và mất hình dáng atlas gốc');
      if (mode === 'append' && m.pages.length + newPages.length > 1) rep.warnings.push('Nhiều trang atlas: một số engine (vd. Heaps) có thể không đọc trang > 0 – CHƯA kiểm; nếu không hiển thị hãy thử rebuild');
      rep.added = newChars.map(function (c) { return hex(c.id); }); const after = new Set(m.charIds); newChars.forEach(function (c) { after.add(c.id); });
      const need = viRequired(), still = need.filter(function (c) { return !after.has(c); });
      rep.summary = { added: newChars.length, vietnamese_required: need.length, vietnamese_after: need.length - still.length, vietnamese_still_missing: still.map(hex), pages_written: newPages.length };
      rep.status = still.length ? 'partial' : 'ok'; rep.reason = 'Thêm ' + newChars.length + ' glyph; tiếng Việt sau khi sinh: ' + (need.length - still.length) + '/' + need.length;
      return { status: rep.status, reason: rep.reason, files: files, report: rep };
    } catch (e) { return fail('error', (e && e.message) || String(e)); }
  }

  /** Gói kết quả thành danh sách file zip (đường dẫn dưới prefix) + report.json + HUONG_DAN.txt. */
  function toFiles(res, prefix) {
    const enc = new TextEncoder(), pre = prefix || 'font_generator/', out = res.files.map(function (f) { return { name: pre + f.path, data: f.data }; });
    out.push({ name: pre + 'font_generator_report.json', data: enc.encode(JSON.stringify(res.report, null, 2)) });
    out.push({ name: pre + 'HUONG_DAN.txt', data: enc.encode('Font đã sinh bởi font_generator (' + SCHEMA + ').\r\n1. File .fnt cùng đường dẫn với bản gốc trong pak; các PNG đặt cạnh .fnt (cùng thư mục).\r\n2. Đóng gói ngược vào pak/IPA là bước RIÊNG (chưa có trong trang).\r\n3. CHƯA kiểm trên game thật; xem warnings/limitations trong font_generator_report.json.\r\n') });
    return out;
  }

  /* ---------- rasterizer Canvas (trình duyệt) ---------- */
  /** o: {family, size, weight?, style?, threshold?} → {glyph(cp), has?}. Glyph trắng + alpha, bbox đã cắt.
   *  Kiểm "glyph có thật trong font nguồn" bằng cách vẽ với 2 font dự phòng khác nhau: khác nhau → glyph lấy từ font dự phòng → null.
   *  o.has(cp) (nếu có, vd. từ cmap của file TTF tải lên) được ưu tiên. KHÔNG chắc 100% với font hệ thống (cùng một font dự phòng cho cả hai). */
  function createCanvasRasterizer(o) {
    const size = Math.max(4, Math.round(o.size || 16)), W = size * 3 + 8, H = size * 3 + 8, ox = size + 4, oy = size * 2;
    const mk = function () { if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H); const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const cv = mk(), ctx = cv.getContext('2d', { willReadFrequently: true });
    function draw(cp, fb) {
      ctx.clearRect(0, 0, W, H); ctx.font = (o.style || 'normal') + ' ' + (o.weight || 'normal') + ' ' + size + 'px "' + String(o.family).replace(/"/g, '') + '", ' + fb;
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; const ch = String.fromCodePoint(cp); ctx.fillText(ch, ox, oy);
      const d = ctx.getImageData(0, 0, W, H).data; let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const adv = ctx.measureText(ch).width;
      if (x1 < 0) return { w: 0, h: 0, a: new Uint8Array(0), left: 0, ascent: 0, advance: adv };
      const w = x1 - x0 + 1, h = y1 - y0 + 1, a = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = d[((y0 + y) * W + x0 + x) * 4 + 3]; if (o.threshold) v = v >= o.threshold ? 255 : 0; a[y * w + x] = v; }
      return { w: w, h: h, a: a, left: x0 - ox, ascent: oy - y0, advance: adv };
    }
    const same = function (p, q) { if (p.w !== q.w || p.h !== q.h) return false; for (let i = 0; i < p.a.length; i++) if (p.a[i] !== q.a[i]) return false; return true; };
    return {
      kind: 'canvas', family: o.family, size: size,
      glyph: function (cp) {
        if (o.has && o.has(cp) === false) return null;
        const g = draw(cp, 'monospace');
        if (cp !== 32 && g.w === 0) return null;                                   // font không vẽ được gì (hoặc ký tự trống)
        if (!(o.has && o.has(cp) === true) && cp > 127 && !same(g, draw(cp, 'serif'))) return null;   // lấy từ font dự phòng
        return g;
      }
    };
  }
  /** Font hệ thống có tồn tại không (so độ rộng với font dự phòng). */
  function systemFontAvailable(family) {
    try {
      const c = document.createElement('canvas').getContext('2d'), t = 'mmmmmmmmmmlliWÀỆ', q = String(family).replace(/"/g, '');
      return ['monospace', 'serif', 'sans-serif'].some(function (fb) { c.font = '40px ' + fb; const a = c.measureText(t).width; c.font = '40px "' + q + '", ' + fb; return c.measureText(t).width !== a; });
    } catch (_) { return false; }
  }

  NS.FontGenerator = { SCHEMA: SCHEMA, LIMITS: LIMITS, NOT_DONE: NOT_DONE, parseFnt: parseFnt, pack: pack, encodePng: encodePng, patchAppend: patchAppend, buildFnt: buildFnt, generate: generate, toFiles: toFiles, createCanvasRasterizer: createCanvasRasterizer, systemFontAvailable: systemFontAvailable };
})(typeof window !== 'undefined' ? window : self);
