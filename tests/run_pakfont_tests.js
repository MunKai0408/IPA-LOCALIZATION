// Chạy: python3 tests/make_pakfont_fonts.py DIR && node tests/run_pakfont_tests.js DIR  (Node ≥ 20). Font GIẢ LẬP, không phải game thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['modules/hash', 'modules/font_metrics', 'modules/text_extract', 'modules/translation_apply'].forEach(function (f) { (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8')); });
const NS = globalThis.IPAStudio, T = NS.TextExtract, A = NS.TranslationApply, dir = process.argv[2] || '/tmp/fake_ipas';
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const enc = function (s) { return new TextEncoder().encode(s); };
const VI = NS.FontMetrics.VI_REQUIRED;
(async function () {
  ok(VI.length === 134, 'VI_REQUIRED có 134 ký tự');
  const charsTxt = function (ids) { return 'info face="Pixel" size=-16 bold=0\ncommon lineHeight=18 base=14\n' + ids.map(function (i) { return 'char id=' + i + ' x=0 y=0 width=8 height=8 xoffset=0 yoffset=0 xadvance=8 page=0 chnl=15\n'; }).join(''); };
  const ascii = []; for (let c = 32; c < 127; c++) ascii.push(c);
  let r = T.parseBmfont(enc(charsTxt(ascii)));
  ok(r && r.format === 'text' && r.face === 'Pixel' && r.size === 16 && r.chars === 95 && r.vietnamese.level === 'none' && r.vietnamese.ascii_letters_ok === true, 'BMFont text: face/size/đếm ký tự, tiếng Việt none');
  r = T.parseBmfont(enc(charsTxt(ascii.concat(VI.slice(0, 100)))));
  ok(r.vietnamese.level === 'partial' && r.vietnamese.covered === 100 && r.vietnamese.missing_count === 34 && /^U\+[0-9A-F]{4}$/.test(r.vietnamese.missing[0]), 'BMFont text: partial 100/134, thiếu 34 ghi U+XXXX');
  r = T.parseBmfont(enc(charsTxt(ascii.concat(VI))));
  ok(r.vietnamese.level === 'full' && r.vietnamese.percent === 100, 'BMFont text: full');
  r = T.parseBmfont(enc('<?xml version="1.0"?><font><info face="Xml F" size="24"/><chars count="2"><char id="65" x="0"/><char id="7843" x="0"/></chars></font>'));
  ok(r && r.format === 'xml' && r.face === 'Xml F' && r.size === 24 && r.chars === 2 && r.vietnamese.covered === 1, 'BMFont XML');
  // nhị phân v3
  const face = enc('BinF\0'), b1 = new Uint8Array(5 + 14 + face.length), d1 = new DataView(b1.buffer); b1[0] = 1; d1.setUint32(1, 14 + face.length, true); d1.setInt16(5, 20, true); b1.set(face, 5 + 14);
  const ids = [65, 66, 7843], b4 = new Uint8Array(5 + 20 * 3), d4 = new DataView(b4.buffer); b4[0] = 4; d4.setUint32(1, 60, true); ids.forEach(function (id, i) { d4.setUint32(5 + i * 20, id, true); });
  const bin = new Uint8Array(4 + b1.length + b4.length); bin.set([66, 77, 70, 3]); bin.set(b1, 4); bin.set(b4, 4 + b1.length);
  r = T.parseBmfont(bin);
  ok(r && r.format === 'binary' && r.face === 'BinF' && r.size === 20 && r.chars === 3, 'BMFont nhị phân v3: face/size/số ký tự');
  ok(T.parseBmfont(enc('info face="X"\ncommon\n')) === null, 'BMFont không có char → null (không đoán)');
  ok(T.parseBmfont(enc('hello world')) === null, 'rác → null');
  ok(T.parseBmfont(new Uint8Array([66, 77, 70, 3, 4, 255, 255, 255, 127])) === null, 'nhị phân hỏng (kích thước khối vô lý) → null, không ném');
  // TTF thật dựng bằng fontTools
  const f1 = fs.readFileSync(path.join(dir, 'vi_full.ttf')), f2 = fs.readFileSync(path.join(dir, 'vi_none.ttf'));
  let m = await T.fontMetricsOf('ttf', new Uint8Array(f1));
  ok(m.status === 'parsed' && m.family === 'ViFull' && m.vietnamese.level === 'full' && m.vietnamese.covered === 134, 'TTF đủ chữ Việt → full 134/134, họ font ViFull');
  m = await T.fontMetricsOf('ttf', new Uint8Array(f2));
  ok(m.vietnamese.level === 'none' && m.vietnamese.covered === 0 && m.vietnamese.ascii_letters_ok === true, 'TTF chỉ ASCII → none, ASCII ok');
  m = await T.fontMetricsOf('ttf', new Uint8Array(60));
  ok(m.status !== 'parsed' && !m.vietnamese, 'TTF rác → không parsed, không có kết luận tiếng Việt');
  m = await T.fontMetricsOf('bmfont', enc('xx'));
  ok(m.status === 'unparsed', 'BMFont rác → unparsed');
  // editor helpers
  const texts = { rows: [{ container: 'ipa', file: 'a.strings', format: 'strings', lang: 'en', key: 'k', text: 'Hi %s', confidence: 'high', placeholders: ['%s'], context: '' }, { container: 'ipa', file: 'a.strings', format: 'strings', lang: 'en', key: 'k', text: 'Two', confidence: 'high', placeholders: [], context: '' }] };
  const csv = A.toTranslatedCsv(texts, { 0: 'Chào, %s', 1: 'Hai "đôi"' });
  const mg = A.mergeCsv(texts, csv);
  ok(mg.matched === 2 && mg.map[0] === 'Chào, %s' && mg.map[1] === 'Hai "đôi"' && !mg.unmatched.length, 'toTranslatedCsv → mergeCsv khứ hồi (dấu phẩy, ngoặc kép, khóa trùng theo thứ tự)');
  const csv2 = csv.replace('Hi %s,', 'Hi CHANGED,');
  ok(A.mergeCsv(texts, csv2).unmatched.length === 1, 'cột text khác bản gốc → không nạp, báo dòng');
  ok(Object.keys(A.mergeCsv(texts, A.toTranslatedCsv(texts, {})).map).length === 0, 'CSV chưa dịch → map rỗng');
  console.log(fail ? fail + ' THẤT BẠI / ' + n : 'PASS ' + n + '/' + n); process.exit(fail ? 1 : 0);
})();
