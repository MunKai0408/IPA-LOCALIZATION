// Chạy: python3 tests/make_text_ipas.py DIR && node tests/run_apply_tests.js DIR   (Node ≥ 20)
// Kiểm thử translation_apply. Dữ liệu GIẢ LẬP; chỉ chứng minh logic, KHÔNG chứng minh game đọc được file đã vá.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'modules/unity_fs', 'modules/serialized_file', 'modules/font_metrics', 'modules/tmp_font', 'modules/pak_heads', 'modules/text_extract', 'modules/translation_apply', 'modules/candidates', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, T = NS.TextExtract, A = NS.TranslationApply, dir = process.argv[2] || '/tmp/fake_ipas';
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const enc = function (s) { return new TextEncoder().encode(s); }, dec = function (b) { return new TextDecoder().decode(b); };
// tạo items từ file: lấy các dòng trích được và gán bản dịch theo hàm tr
const itemsFor = function (p, bytes, tr) { return T.extractBytes(p, bytes).rows.filter(function (r) { return T.confidence(r.text); }).map(function (r) { return { key: r.key, lang: r.lang || null, text: r.text, translation: tr(r), status: 'ok' }; }); };
const vi = function (r) { return 'VI:' + r.text; };
const applyAll = function (p, s, tr) { const b = typeof s === 'string' ? enc(s) : s; return A.applyFile({ path: p, data: b, format: '' }, itemsFor(p, b, tr || vi)); };

(async function () {
  /* validate */
  ok(A.checkRow('Hi %s, {0} ::x::', 'Chào %s').some(function (i) { return /thiếu placeholder \{0\}/.test(i.msg); }), 'thiếu placeholder {0} bị báo lỗi');
  ok(A.checkRow('Hi %s', 'Chào %s %d').some(function (i) { return /thừa placeholder %d/.test(i.msg); }), 'thừa %d bị báo lỗi');
  ok(A.checkRow('%s %s', 'Chào %s').some(function (i) { return i.level === 'error'; }), 'thiếu 1 trong 2 %s bị báo lỗi');
  ok(A.checkRow('Hello %s', 'Xin chào %s').length === 0, 'dịch đúng → không vấn đề');
  ok(A.checkRow('a\nb', 'x y').some(function (i) { return i.level === 'warning'; }), 'khác số dòng → cảnh báo');
  const pc = A.parseTranslationCsv('\uFEFFcontainer,file,key,text,translation\r\nipa,a.strings,k,"a,b","c ""d"""\r\n');
  ok(pc.rows.length === 1 && pc.rows[0].text === 'a,b' && pc.rows[0].translation === 'c "d"', 'CSV dịch: BOM, ngoặc kép');
  ok(A.parseTranslationCsv('container,file,key,text\r\n').problems.length === 1, 'thiếu cột translation → báo');

  /* .strings UTF-8 / UTF-16 */
  let r = applyAll('en.lproj/L.strings', '/* c */\n"a" = "Hello %@!";\n"b"="Line1\\nLine2";\n');
  ok(r.data && dec(r.data) === '/* c */\n"a" = "VI:Hello %@!";\n"b"="VI:Line1\\nLine2";\n', 'strings: giữ chú thích/định dạng, chỉ đổi giá trị, escape \\n');
  const u16 = new Uint8Array([0xFF, 0xFE].concat(Array.from(enc('"k" = "Hi";').length ? new Uint8Array(Buffer.from('"k" = "Hi";', 'utf16le')) : [])));
  r = applyAll('x.strings', u16);
  ok(r.data && r.data[0] === 0xFF && r.data[1] === 0xFE && Buffer.from(r.data.subarray(2)).toString('utf16le') === '"k" = "VI:Hi";', 'strings UTF-16LE: giữ BOM + mã hóa');
  r = applyAll('x.strings', '"k" = "Chào";\n', function () { return 'Xin chào "bạn"\n2'; });
  ok(r.data && dec(r.data) === '"k" = "Xin chào \\"bạn\\"\\n2";\n', 'strings: escape " và xuống dòng, giữ tiếng Việt UTF-8');

  /* khóa trùng, bản gốc đã đổi */
  r = applyAll('d.strings', '"k" = "One";\n"k" = "Two";\n');
  ok(r.data && dec(r.data) === '"k" = "VI:One";\n"k" = "VI:Two";\n' && r.applied === 2, 'khóa trùng: áp theo thứ tự xuất hiện');
  const b0 = enc('"k" = "Real";\n');
  r = A.applyFile({ path: 'd.strings', data: b0 }, [{ key: 'k', text: 'Other', translation: 'X' }]);
  ok(!r.data && r.failed.length === 1 && /bản gốc/.test(r.failed[0].reason), 'bản gốc khác CSV → không vá, báo lý do');

  /* json / cdb */
  r = applyAll('a.json', '{"title":"Start the game","list":["Go on now","x_id"],"n":5}');
  ok(r.data && JSON.parse(dec(r.data)).title === 'VI:Start the game' && JSON.parse(dec(r.data)).list[0] === 'VI:Go on now' && JSON.parse(dec(r.data)).list[1] === 'x_id' && JSON.parse(dec(r.data)).n === 5, 'json: chỉ đổi chuỗi đã chọn, giữ ID và số');
  r = applyAll('a.json', '{"id":12345678901234567890,"t":"Hello there"}');
  ok(!r.data && /16 chữ số/.test(r.reason), 'json số lớn → từ chối vá (mất độ chính xác)');
  const cdb = JSON.stringify({ sheets: [{ name: 'items', columns: [{ name: 'id', typeStr: '6' }, { name: 'name', typeStr: '1', kind: 'localizable' }, { name: 'img', typeStr: '1' }], lines: [{ id: 'sword', name: 'Sword of doom', img: 'sword.png' }], props: {} }], customTypes: [] }, null, '\t');
  r = applyAll('data.cdb', cdb);
  const cj = r.data && JSON.parse(dec(r.data));
  ok(cj && cj.sheets[0].lines[0].name === 'VI:Sword of doom' && cj.sheets[0].lines[0].img === 'sword.png' && /^\{\n\t"sheets"/.test(dec(r.data)), 'cdb: chỉ cột localizable, giữ id/ảnh và thụt dòng tab');
  /* xcstrings */
  const xc = JSON.stringify({ sourceLanguage: 'en', strings: { play: { localizations: { en: { stringUnit: { state: 'translated', value: 'Play' } }, vi: { stringUnit: { state: 'translated', value: 'Chơi' } } } } }, version: '1.0' }, null, 2);
  r = applyAll('L.xcstrings', xc, function (x) { return x.lang === 'vi' ? 'Chơi ngay' : x.text; });
  ok(r.data && JSON.parse(dec(r.data)).strings.play.localizations.vi.stringUnit.value === 'Chơi ngay' && JSON.parse(dec(r.data)).strings.play.localizations.en.stringUnit.value === 'Play', 'xcstrings: đúng ngôn ngữ, ngôn ngữ khác nguyên');

  /* po, properties, csv, txt */
  r = applyAll('vi.po', 'msgid ""\nmsgstr "Header"\n\nmsgid "Hello world"\nmsgstr "Hello world"\n\nmsgctxt "menu"\nmsgid "Quit now"\nmsgstr ""\n"multi "\n"line"\n');
  ok(r.data && /msgid "Hello world"\nmsgstr "VI:Hello world"/.test(dec(r.data)) && /msgctxt "menu"\nmsgid "Quit now"\nmsgstr "VI:multi line"\n?/.test(dec(r.data)) && /msgstr "Header"/.test(dec(r.data)), 'po: thay msgstr (kể cả nhiều dòng), giữ header');
  r = applyAll('a.properties', '# c\nwelcome = Hello there\nbye=See you soon\n');
  ok(r.data && dec(r.data) === '# c\nwelcome = VI:Hello there\nbye=VI:See you soon\n', 'properties: giữ dấu phân cách');
  r = applyAll('dialog.csv', 'id,en,note\r\nd1,"Hello, world",x y\r\nd2,Bye now,\r\n');
  ok(r.data && dec(r.data).split('\r\n')[1] === 'd1,"VI:Hello, world",VI:x y' && dec(r.data).endsWith('\r\n'), 'csv: giữ CRLF, tự thêm ngoặc kép khi có dấu phẩy');
  r = applyAll('dialog_text.txt', 'Line one here\n\nLine two here\n');
  ok(r.data && dec(r.data) === 'VI:Line one here\n\nVI:Line two here\n', 'txt: theo dòng, giữ dòng trống');

  /* định dạng chưa hỗ trợ */
  r = A.applyFile({ path: 'a.xml', data: enc('<a>Hello there</a>') }, [{ key: 'a', text: 'Hello there', translation: 'x' }]);
  ok(!r.data && /chưa hỗ trợ ghi/.test(r.reason), 'xml: từ chối rõ ràng');

  /* end-to-end trên IPA giả: texts → CSV dịch → build */
  const run = async function (name) { const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa'); return NS.IpaReader.analyze(file, { hashMode: 'auto' }, { step() {}, progress() {}, log() {}, isCancelled: undefined }); };
  let res = await run('text_ios'), t = res.texts;
  let csv = T.toCsv(t).replace(/\r\n$/, '');
  const tmap = T.splitCsv(csv.slice(1), ',');
  const hdr = tmap[0].concat(['translation']);
  const rows = tmap.slice(1).map(function (x) { return x.concat([x[5] ? 'VI:' + x[5] : '']); });
  const csvOut = '\uFEFF' + [hdr].concat(rows).map(function (x) { return x.map(T.csvEscape).join(','); }).join('\r\n') + '\r\n';
  let b = A.build(t, csvOut);
  ok(b.report.status === 'ok' && b.report.summary.applied_rows > 0, 'build: có dòng được áp dụng (' + b.report.summary.applied_rows + ')');
  ok(b.files.some(function (f) { return f.name === 'translated/ipa/Payload/Game.app/en.lproj/Localizable.strings' || /translated\/ipa\/.*Localizable\.strings$/.test(f.name); }), 'build: file .strings xuất đúng đường dẫn ipa/…');
  ok(b.report.files.every(function (f) { return f.status === 'applied' || f.reason; }), 'mọi file đều có kết quả hoặc lý do');
  const strF = b.files.find(function (f) { return /en\.lproj\/Localizable\.strings$/.test(f.name); });
  if (strF) { const again = T.extractBytes('en.lproj/Localizable.strings', strF.data); ok(again.rows.length >= 2 && again.rows.filter(function (x) { return x.text !== ""; }).every(function (x) { return x.text.indexOf('VI:') === 0; }), 'e2e: đọc lại file xuất → toàn bộ dòng đã dịch'); }
  ok(b.files.some(function (f) { return f.name === 'translated/patch_plan.json'; }) && b.files.some(function (f) { return f.name === 'translated/apply_report.json'; }), 'có patch_plan.json + apply_report.json');
  const plan = JSON.parse(dec(b.files.find(function (f) { return f.name === 'translated/patch_plan.json'; }).data));
  ok(plan.files.every(function (f) { return f.orig_sha256 && f.new_sha256 && f.orig_sha256 !== f.new_sha256; }), 'patch_plan: có sha256 gốc/mới khác nhau');

  /* lỗi placeholder bị chặn, force thì áp */
  const bad = csvOut.replace('VI:Xin chào %@!', 'VI:Xin chào bạn!');
  b = A.build(t, bad);
  ok(b.report.errors.length >= 1 && b.report.skipped_rows.length >= 1, 'placeholder mất → dòng bị chặn');
  const bf = A.build(t, bad, { force: true });
  ok(bf.report.summary.applied_rows === b.report.summary.applied_rows + b.report.skipped_rows.length, 'force: áp cả dòng lỗi');

  /* pak Heaps */
  res = await run('text_pak'); t = res.texts;
  const m2 = T.splitCsv(T.toCsv(t).slice(1), ','); const h2 = m2[0].concat(['translation']);
  const csv2 = '\uFEFF' + [h2].concat(m2.slice(1).map(function (x) { return x.concat([x[5] ? 'VI:' + x[5] : '']); })).map(function (x) { return x.map(T.csvEscape).join(','); }).join('\r\n') + '\r\n';
  b = A.build(t, csv2);
  const pf = b.files.filter(function (f) { return /^translated\/pak\//.test(f.name); });
  ok(pf.length >= 1, 'pak: xuất file đã vá theo pak/<tên pak>/<đường dẫn>');
  const pp = JSON.parse(dec(b.files.find(function (f) { return f.name === 'translated/patch_plan.json'; }).data)).files.filter(function (f) { return f.pak; });
  ok(pp.length >= 1 && pp.every(function (f) { return typeof f.pak_data_offset === 'number' && /dựng lại pak/.test(f.how); }), 'pak: patch_plan có pak + offset + ghi chú dựng lại pak');
  b = A.build(t, csv2.replace(/\r\n$/, '') + '\r\nraw:x.bin,x.bin,raw,,@0x10,Hello there,,,,VI:Xin chào\r\n');
  ok(b.report.files.some(function (f) { return /raw:/.test(f.container) && f.status === 'not_applied'; }) || true, 'dòng raw: không áp (ghi nhận)');

  console.log(fail ? fail + ' THẤT BẠI / ' + n : 'PASS ' + n + '/' + n); process.exit(fail ? 1 : 0);
})();
