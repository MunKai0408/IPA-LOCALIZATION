// Chạy: node tests/run_fontgen_tests.js  (Node ≥ 20). Rasterizer GIẢ LẬP (ô vuông), không phải font thật.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
globalThis.self = globalThis; globalThis.window = globalThis;
['modules/hash', 'modules/font_metrics', 'modules/text_extract', 'modules/font_generator'].forEach(function (f) { (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8')); });
const NS = globalThis.IPAStudio, G = NS.FontGenerator, T = NS.TextExtract, VI = NS.FontMetrics.VI_REQUIRED;
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const enc = function (s) { return new TextEncoder().encode(s); }, dec = function (b) { return new TextDecoder().decode(b); };
const fake = function (lack) { lack = lack || []; return { glyph: function (cp) { if (lack.indexOf(cp) >= 0) return null; if (cp === 32) return { w: 0, h: 0, a: new Uint8Array(0), left: 0, ascent: 0, advance: 5 };
  const w = 6 + (cp % 3), h = 9 + (cp % 4), a = new Uint8Array(w * h).fill(200); return { w: w, h: h, a: a, left: 1, ascent: 12 + (cp % 2), advance: w + 1 }; } }; };
const ascii = []; for (let c = 33; c < 127; c++) ascii.push(c);
const txt = function (ids, eol, extra) { eol = eol || '\n'; return ['info face="Pixel" size=-16 bold=0 italic=0 charset="" unicode=1 padding=0,0,0,0 spacing=1,1', 'common lineHeight=18 base=14 scaleW=256 scaleH=256 pages=1 packed=0', 'page id=0 file="pix.png"', 'chars count=' + ids.length]
  .concat(ids.map(function (i) { return 'char id=' + i + ' x=0 y=0 width=8 height=8 xoffset=0 yoffset=0 xadvance=8 page=0 chnl=15'; })).concat(extra || ['kernings count=1', 'kerning first=65 second=86 amount=-1']).join(eol) + eol; };
const xmlf = function (ids) { return '<?xml version="1.0"?>\n<font>\n  <info face="XmlF" size="24" />\n  <common lineHeight="28" base="22" scaleW="512" scaleH="512" pages="1" packed="0" />\n  <pages>\n    <page id="0" file="x.png" />\n  </pages>\n  <chars count="' + ids.length + '">\n' + ids.map(function (i) { return '    <char id="' + i + '" x="0" y="0" width="8" height="8" xoffset="0" yoffset="0" xadvance="8" page="0" chnl="15" />'; }).join('\n') + '\n  </chars>\n  <kernings count="0">\n  </kernings>\n</font>\n'; };
(async function () {
  ok(VI.length === 134, 'VI_REQUIRED 134');
  // --- parse ---
  let m = G.parseFnt(enc(txt(ascii)));
  ok(!m.error && m.format === 'text' && m.charIds.size === 94 && m.common.scaleW === 256 && m.pages.length === 1 && m.info.size === 16, 'parseFnt text');
  ok(G.parseFnt(enc(xmlf(ascii))).format === 'xml', 'parseFnt xml');
  ok(G.parseFnt(new Uint8Array([66, 77, 70, 3, 0, 0, 0, 0, 0])).error === 'binary', 'nhị phân → không hỗ trợ ghi');
  ok(G.parseFnt(enc('hello world this is junk')).error, 'rác → lỗi');
  ok(G.parseFnt(enc('info face="x"\ncommon lineHeight=1 base=1\npage id=0 file="a.png"\nchar id=1 x=0')).error === 'no_common', 'thiếu scaleW → không đoán');
  // --- PNG hợp lệ ---
  const rgba = new Uint8Array(5 * 3 * 4).map(function (_, i) { return (i * 37) & 255; }), png = G.encodePng(5, 3, rgba);
  const idat = (function () { let p = 8, parts = []; while (p < png.length) { const len = new DataView(png.buffer, png.byteOffset + p).getUint32(0), t = String.fromCharCode.apply(null, png.subarray(p + 4, p + 8)); if (t === 'IDAT') parts.push(png.subarray(p + 8, p + 8 + len)); p += 12 + len; } return Buffer.concat(parts); })();
  const raw = zlib.inflateSync(idat); let same = raw.length === 3 * 21; for (let y = 0; y < 3 && same; y++) for (let i = 0; i < 20; i++) if (raw[y * 21 + 1 + i] !== rgba[y * 20 + i]) same = false;
  ok(same && png[0] === 137 && png[12] === 73, 'PNG: zlib giải nén ra đúng pixel');
  ok((function () { let p = 8, good = true, cnt = 0; while (p < png.length) { const len = new DataView(png.buffer, png.byteOffset + p).getUint32(0), crc = new DataView(png.buffer, png.byteOffset + p).getUint32(8 + len); if (zlib.crc32(png.subarray(p + 4, p + 8 + len)) !== crc) good = false; cnt++; p += 12 + len; } return good && cnt === 3; })(), 'PNG: CRC từng chunk đúng (IHDR/IDAT/IEND)');
  const big = G.encodePng(300, 300, new Uint8Array(300 * 300 * 4)); ok(zlib.inflateSync((function () { let p = 8; while (p < big.length) { const len = new DataView(big.buffer, big.byteOffset + p).getUint32(0); if (String.fromCharCode.apply(null, big.subarray(p + 4, p + 8)) === 'IDAT') return Buffer.from(big.subarray(p + 8, p + 8 + len)); p += 12 + len; } })()).length === 300 * 1201, 'PNG >64KB (nhiều khối STORE)');
  // --- packer ---
  const gl = []; for (let i = 0; i < 60; i++) gl.push({ cp: 1000 + i, w: 10 + (i % 5), h: 12 + (i % 7), a: null });
  let pk = G.pack(gl, 64, 64, 1);
  let overlap = false, inb = true; pk.pages.forEach(function (pg) { pg.forEach(function (p, i) { if (p.x < 1 || p.y < 1 || p.x + p.g.w > 63 || p.y + p.g.h > 63) inb = false; pg.forEach(function (q, j) { if (i < j && p.x < q.x + q.g.w && q.x < p.x + p.g.w && p.y < q.y + q.g.h && q.y < p.y + p.g.h) overlap = true; }); }); });
  ok(pk.pages.length > 1 && !overlap && inb && pk.pages.reduce(function (s, p) { return s + p.length; }, 0) === 60, 'pack: nhiều trang, không chồng, trong biên, đủ 60 glyph');
  ok(G.pack([{ cp: 1, w: 70, h: 5 }], 64, 64, 1).oversize[0] === 1, 'pack: glyph quá khổ báo oversize');
  // --- append (text) ---
  const base = txt(ascii); let r = await G.generate({ fntBytes: enc(base), fntPath: 'font/pix.fnt', raster: fake(), mode: 'append' });
  ok(r.status === 'ok' && r.report.summary.added === 134 && r.report.summary.vietnamese_after === 134, 'append text: ok, thêm 134, đủ Việt');
  const f0 = r.files.filter(function (f) { return f.role === 'fnt'; })[0], pngs = r.files.filter(function (f) { return f.role === 'atlas-page'; });
  ok(f0.path === 'font/pix.fnt' && pngs.length >= 1 && pngs[0].path === 'font/pix_vi1.png', 'đường dẫn: .fnt giữ nguyên, PNG cạnh .fnt, tên pix_vi1.png');
  const pm = T.parseBmfont(f0.data); ok(pm.vietnamese.level === 'full' && pm.chars === 94 + 134, 'TextExtract.parseBmfont đọc lại: full, 228 ký tự');
  const out1 = dec(f0.data); ok(/pages=2/.test(out1) && /page id=1 file="pix_vi1.png"/.test(out1) && /chars count=228/.test(out1) && /kerning first=65/.test(out1) && /info face="Pixel"/.test(out1), 'text: pages=2, thêm page, count=228, giữ kerning + info');
  ok(out1.split('\n').filter(function (l) { return /^char id=/.test(l); }).length === 228, 'text: đúng 228 dòng char, không trùng id');
  ok(out1.split('\n').filter(function (l) { return /^char id=/.test(l) && /page=1 /.test(l); }).length === 134, '134 char mới trỏ page=1');
  // chnl/yoffset: base=14, ascent 12|13 → yoffset 2|1
  ok(/char id=224 .*yoffset=(1|2) /.test(out1.replace(/\n/g, '\n')), 'yoffset = base − ascent');
  // CRLF + BOM
  r = await G.generate({ fntBytes: enc('\uFEFF' + txt(ascii, '\r\n')), fntPath: 'a.fnt', raster: fake(), mode: 'append' });
  const o2 = r.files[0].data; ok(o2[0] === 0xEF && /\r\n/.test(dec(o2)) && !/[^\r]\n/.test(dec(o2).slice(1)), 'giữ BOM + CRLF');
  // append xml
  r = await G.generate({ fntBytes: enc(xmlf(ascii)), fntPath: 'x.fnt', raster: fake(), mode: 'append' });
  const ox = dec(r.files[0].data); ok(r.status === 'ok' && /pages="2"/.test(ox) && /<chars count="228">/.test(ox) && /<page id="1" file="x_vi1.png"/.test(ox) && /<\/font>\s*$/.test(ox) && T.parseBmfont(r.files[0].data).vietnamese.level === 'full', 'append XML');
  // font nguồn thiếu glyph
  const lack = [VI[0], VI[1], VI[2]]; r = await G.generate({ fntBytes: enc(base), fntPath: 'a.fnt', raster: fake(lack), mode: 'append' });
  ok(r.status === 'partial' && r.report.skipped_not_in_source.length === 3 && r.report.summary.vietnamese_still_missing.length === 3 && T.parseBmfont(r.files[0].data).vietnamese.level === 'partial', 'nguồn thiếu 3 ký tự → partial, báo đúng, không bịa');
  ok(r.report.warnings.some(function (w) { return /không có 3 ký tự/.test(w); }), 'cảnh báo ký tự nguồn thiếu');
  // đã đủ
  r = await G.generate({ fntBytes: enc(txt(ascii.concat(VI))), fntPath: 'a.fnt', raster: fake(), mode: 'append' }); ok(r.status === 'nothing_to_do' && !r.files.length, 'đủ rồi → nothing_to_do');
  // chỉ thiếu 10 ký tự
  r = await G.generate({ fntBytes: enc(txt(ascii.concat(VI.slice(10)))), fntPath: 'a.fnt', raster: fake(), mode: 'append' }); ok(r.report.summary.added === 10 && r.status === 'ok', 'chỉ thêm đúng ký tự thiếu (10)');
  // kênh gói
  r = await G.generate({ fntBytes: enc(txt(ascii).replace('packed=0', 'packed=1')), fntPath: 'a.fnt', raster: fake(), mode: 'append' }); ok(r.status === 'unsupported_channels', 'packed=1 → từ chối append');
  r = await G.generate({ fntBytes: enc(txt(ascii).replace(/chnl=15/g, 'chnl=1')), fntPath: 'a.fnt', raster: fake(), mode: 'append' }); ok(r.status === 'unsupported_channels', 'chnl≠15 → từ chối append');
  r = await G.generate({ fntBytes: enc(txt(ascii).replace('packed=0', 'packed=1')), fntPath: 'a.fnt', raster: fake(), mode: 'rebuild' }); ok(r.status === 'ok' && !/packed=1/.test(dec(r.files[0].data)), 'packed → rebuild được, ghi packed=0');
  // nhiều trang (atlas nhỏ)
  r = await G.generate({ fntBytes: enc(txt(ascii).replace('scaleW=256 scaleH=256', 'scaleW=64 scaleH=64')), fntPath: 'a.fnt', raster: fake(), mode: 'append' });
  ok(r.status === 'ok' && r.report.pages.length > 1 && new Set(r.report.pages.map(function (p) { return p.id; })).size === r.report.pages.length && /pages=\d+/.test(dec(r.files[0].data)) && r.report.warnings.some(function (w) { return /Nhiều trang/.test(w); }), 'atlas 64×64 → nhiều trang, id khác nhau, có cảnh báo engine');
  r = await G.generate({ fntBytes: enc(txt(ascii).replace('scaleW=256 scaleH=256', 'scaleW=8 scaleH=8')), fntPath: 'a.fnt', raster: fake(), mode: 'append' }); ok(r.status !== 'ok' || r.report.oversize.length > 0, 'atlas 8×8 → glyph quá khổ, không ghi bừa');
  // rebuild
  r = await G.generate({ fntBytes: enc(txt(ascii.concat([0xA9]))), fntPath: 'f/pix.fnt', raster: fake([0xA9]), mode: 'rebuild' });
  ok(r.status === 'ok' && r.report.pages.length === 1 && r.report.pages[0].file === 'f/pix.png' && r.report.dropped_existing[0] === 'U+00A9' && r.report.warnings.some(function (w) { return /kerning/.test(w); }), 'rebuild: 1 trang trùng tên trang gốc, báo glyph gốc bị mất (©), cảnh báo kerning');
  const rb = T.parseBmfont(r.files[0].data); ok(rb.vietnamese.level === 'full' && rb.size === 16 && rb.face === 'Pixel' && /lineHeight=18 base=14/.test(dec(r.files[0].data)), 'rebuild: giữ info/lineHeight/base, đủ Việt');
  // rebuild atlas tự lớn lên
  r = await G.generate({ fntBytes: enc(txt(ascii).replace('scaleW=256 scaleH=256', 'scaleW=64 scaleH=64')), fntPath: 'a.fnt', raster: fake(), mode: 'rebuild' });
  ok(r.status === 'ok' && r.report.pages.length === 1 && r.report.atlas.scaleW >= 128, 'rebuild: atlas nhỏ tự nới (' + r.report.atlas.scaleW + '×' + r.report.atlas.scaleH + ')');
  // rebuild XML
  r = await G.generate({ fntBytes: enc(xmlf(ascii)), fntPath: 'x.fnt', raster: fake(), mode: 'rebuild' }); ok(r.status === 'ok' && T.parseBmfont(r.files[0].data).format === 'xml' && T.parseBmfont(r.files[0].data).vietnamese.level === 'full', 'rebuild XML');
  // lỗi đầu vào
  ok((await G.generate({ fntBytes: enc(base), fntPath: 'a.fnt', mode: 'append' })).status === 'no_raster', 'thiếu rasterizer → no_raster');
  ok((await G.generate({ fntBytes: enc(base), fntPath: 'a.fnt', raster: fake(), mode: 'xyz' })).status === 'bad_mode', 'mode lạ');
  ok((await G.generate({ fntBytes: new Uint8Array([66, 77, 70, 3, 1, 1, 1, 1, 1, 1]), fntPath: 'a.fnt', raster: fake(), mode: 'append' })).status === 'unsupported', 'binary → unsupported');
  ok((await G.generate({ fntBytes: enc(base), fntPath: 'a.fnt', raster: { glyph: function () { throw new Error('boom'); } }, mode: 'append' })).status === 'error', 'rasterizer ném lỗi → status error, không sập');
  r = await G.generate({ fntBytes: enc(base), fntPath: 'a.fnt', raster: fake(VI.concat([32])), mode: 'append' }); ok(r.status === 'no_glyphs', 'nguồn không có glyph nào → no_glyphs');
  // zip
  const zf = G.toFiles(await G.generate({ fntBytes: enc(base), fntPath: 'font/pix.fnt', raster: fake(), mode: 'append' }), 'fg/'); ok(zf.some(function (f) { return f.name === 'fg/font/pix.fnt'; }) && zf.some(function (f) { return f.name === 'fg/font_generator_report.json'; }) && JSON.parse(dec(zf.filter(function (f) { return /report/.test(f.name); })[0].data)).limitations.length > 3, 'toFiles: .fnt + png + report có limitations');
    if (process.argv[2]) { const rr = await G.generate({ fntBytes: enc(base), fntPath: 'font/pix.fnt', raster: fake(), mode: 'append' }); rr.files.forEach(function (f) { const p = path.join(process.argv[2], f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.data); }); }
  console.log(fail ? fail + ' THẤT BẠI / ' + n : 'PASS ' + n + '/' + n); process.exit(fail ? 1 : 0);
})();
