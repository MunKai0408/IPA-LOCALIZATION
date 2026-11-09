// Chạy: python3 tests/make_text_ipas.py DIR && node tests/run_text_tests.js DIR   (Node ≥ 20)
// Kiểm thử text_extract. Dữ liệu GIẢ LẬP; chỉ chứng minh logic, KHÔNG chứng minh đúng trên game thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'modules/unity_fs', 'modules/serialized_file', 'modules/font_metrics', 'modules/tmp_font', 'modules/pak_heads', 'modules/text_extract', 'modules/candidates', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, T = NS.TextExtract, dir = process.argv[2] || '/tmp/fake_ipas';
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const run = async function (name) {
  const steps = [];
  const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa');
  const r = await NS.IpaReader.analyze(file, { hashMode: 'auto' }, { step: function (id, st, msg) { steps.push([id, st, msg]); }, progress() {}, log() {}, isCancelled: undefined });
  r._steps = steps; return r;
};
const rowsOf = function (t, f) { return t.rows.filter(function (x) { return x.file.endsWith(f); }); };
(async function () {
  /* parser thuần */
  const ps = T.parseStringsText('/* a */ "k1" = "a\\"b\\n\\U0041"; // x\n k2 = "v2"; "bad" ; "k3"="v3";');
  ok(ps.rows.length === 3 && ps.rows[0].text === 'a"b\nA' && ps.rows[1].key === 'k2' && ps.bad === 1, 'strings: escape, unquoted key, 1 lỗi bỏ qua');
  ok(T.placeholders('Hi %@, %1$d và {0} {name} <b>x</b> 100%%').length === 7, 'placeholder nhận đủ 7 mẫu (%@ %1$d {0} {name} <b> </b> %%)');
  ok(T.confidence('btn_start_01') === 'low' && T.confidence('Start the game') === 'high' && T.confidence('12345') === null && T.confidence('Chơi') === 'high', 'độ tin cậy: ID=low, câu=high, số=bỏ');
  ok(T.parseXml('<a><t id="x">A &lt; B</t><![CDATA[raw]]></a>').rows.map(function (r) { return r.key + '=' + r.text; }).join('|') === 'a/t[x]=A < B|a=raw', 'xml: khóa theo id, entity, CDATA');
  ok(T.parsePo('msgid "a"\nmsgstr "b"\n\nmsgctxt "c"\nmsgid "x"\nmsgstr "y\\n"\n').rows.length === 2, 'po: 2 dòng');
  ok(T.parseCsv('id,en\nd1,"a,b"\n', ',').rows[0].text === 'a,b', 'csv: ngoặc kép có dấu phẩy');
  ok(T.fontMagic(new Uint8Array([0, 1, 0, 0])) === 'ttf' && T.fontMagic(new Uint8Array([79, 84, 84, 79])) === 'otf' && T.fontMagic(new Uint8Array([1, 2, 3, 4])) === null, 'magic font');

  /* iOS native + định dạng mở */
  let r = await run('text_ios'); let t = r.texts;
  ok(t && t.status === 'ok', 'text_ios: status ok');
  const s1 = rowsOf(t, 'en.lproj/Localizable.strings');
  ok(s1.length === 2 && s1[0].lang === 'en' && s1[0].text === 'Xin chào %@!' && s1[0].placeholders[0] === '%@', 'strings UTF-16: 2 dòng (bỏ dòng rỗng), lang=en, placeholder %@');
  const sd = rowsOf(t, 'vi.lproj/Localizable.stringsdict');
  ok(sd.length === 3 && sd.every(function (x) { return x.lang === 'vi'; }) && !sd.some(function (x) { return /NSStringFormat/.test(x.text); }), 'stringsdict: 3 chuỗi (format key + one + other), không lẫn khóa kỹ thuật');
  const xc = rowsOf(t, 'Localizable.xcstrings'); ok(xc.length === 2 && xc.some(function (x) { return x.lang === 'vi' && x.text === 'Chơi'; }), 'xcstrings: en + vi');
  const js = rowsOf(t, 'en.json'); ok(js.length === 1 && js[0].text === 'Start the game', 'json: chỉ giữ text thật; ID (btn_start_01) và số bị bỏ');
  const cv = rowsOf(t, 'dialog.csv'); ok(cv.some(function (x) { return x.text === 'Hello, world' && x.lang === 'en'; }) && cv.some(function (x) { return x.text === 'Tam biet' && x.lang === 'vi'; }), 'csv: lang theo tên cột');
  const po = rowsOf(t, 'vi.po'); ok(po.length === 2 && po.some(function (x) { return x.key === 'menu|Quit'; }), 'po: msgctxt|msgid');
  ok(rowsOf(t, 'strings.xml')[0].key === 'resources/string[app]', 'android strings.xml');
  ok(!t.rows.some(function (x) { return /Frameworks/.test(x.file); }), 'bỏ qua Frameworks/');
  ok(t.skipped.some(function (x) { return /bad\/lang.json/.test(x.file); }), 'json hỏng → skipped có lý do');
  const csv = T.toCsv(t); ok(csv.charCodeAt(0) === 0xFEFF && csv.slice(1).split('\r\n')[0] === 'container,file,format,lang,key,text,confidence,placeholders,context', 'CSV: BOM + đúng cột');
  ok(csv.indexOf('"Hello, world"') >= 0, 'CSV: escape dấu phẩy');
  ok(JSON.stringify(T.toIndex(t)).indexOf('"rows":[') < 0, 'toIndex không chứa rows');
  ok(r._steps.some(function (s) { return s[0] === 'texts' && s[1] === 'done'; }), 'bước texts done');

  /* pak Heaps nén deflate: text + font bên trong */
  r = await run('text_pak'); t = r.texts;
  ok(r.pak_heads.pak_files[0].compress_type === 8 && r.pak_heads.pak_files[0].heaps.status === 'ok', 'pak test thật sự bị nén (method 8) và cây hợp lệ');
  const en = t.rows.filter(function (x) { return x.file === 'lang/en.xml'; });
  ok(en.length === 2 && en[0].container === 'pak:Payload/Game.app/res.pak' && en[0].text === 'Hello %s & welcome' && en[0].lang === 'en', 'pak: đọc lang/en.xml trong pak nén');
  ok(t.rows.some(function (x) { return x.file === 'data.cdb' && x.text === 'Sword of doom'; }), 'pak: đọc data.cdb (JSON)');
  ok(t.pak_fonts.length === 2 && t.pak_fonts.filter(function (f) { return f.ok; }).length === 1, 'pak: 2 font, 1 magic hợp lệ');
  ok(T.fontFiles(t).length === 1 && T.fontFiles(t)[0].data.length === 64, 'fontFiles: chỉ font hợp lệ, đủ 64 byte');
  ok(!t.rows.some(function (x) { return /png/.test(x.file); }), 'pak: bỏ png');

  /* pak sai bố cục: không bịa */
  r = await run('text_pak_wrong'); t = r.texts;
  ok(t.rows.length === 0 && t.skipped.length >= 1, 'pak sai nội dung → 0 dòng, ghi skipped');
  ok(t.warnings.some(function (w) { return /bố cục pak/.test(w); }), 'pak sai → cảnh báo bố cục có thể sai');

  /* pak không phải Heaps → unsupported */
  r = await run('pak_godot'); ok(r.texts.unsupported.length === 1, 'pak Godot → unsupported');
  r = await run('pak_none'); ok(r.texts.status === 'no_text', 'không có text → no_text');
  /* gói dịch: file gốc đúng đường dẫn + manifest + csv + hướng dẫn; byte gốc khớp sha256 */
  await (async function () {
    t = (await run('text_pak')).texts;
    const pk = T.toPack(t, { ipa: 'x.ipa', bundleId: 'com.test.game', engine: 'heaps' }), nm = pk.map(function (f) { return f.name; });
    ok(nm.indexOf('translation_pack/manifest.json') >= 0 && nm.indexOf('translation_pack/texts.csv') >= 0 && nm.indexOf('translation_pack/HUONG_DAN.txt') >= 0, 'gói dịch: có manifest + csv + hướng dẫn');
    ok(nm.some(function (x) { return x === 'translation_pack/pak/res.pak/lang/en.xml'; }), 'gói dịch: file trong pak đúng đường dẫn: ' + nm.join(','));
    const man = JSON.parse(Buffer.from(pk.find(function (f) { return f.name.endsWith('manifest.json'); }).data).toString('utf8'));
    const mf = man.files.find(function (f) { return f.path === 'lang/en.xml'; }), data = pk.find(function (f) { return f.name === 'translation_pack/' + mf.file; }).data;
    ok(mf.size === data.length && mf.pak && mf.pak_data_offset > 0 && /^[0-9a-f]{64}$/.test(mf.sha256), 'gói dịch: manifest ghi pak + offset + sha256');
    ok(/Hello %s/.test(Buffer.from(data).toString('utf8')), 'gói dịch: nội dung gốc nguyên vẹn');
    ok(JSON.stringify(T.toIndex(t)).indexOf('translation_pack') < 0, 'toIndex không chứa byte gói');
  })();

  /* font bitmap: liệt kê .fnt + atlas cùng tên / tên có "font", vào gói dịch; ảnh thường không lẫn */
  await (async function () {
    const fr = (await run('font_pak')).texts, inv = fr.font_inventory.map(function (f) { return f.path; }).sort();
    ok(inv.join() === 'gfx/font_small.png,ui/big.fnt,ui/big.png', 'font_inventory: fnt + atlas cùng tên + atlas tên font, không có other.png: ' + inv.join());
    const pk = T.toPack(fr, {}).map(function (f) { return f.name; });
    ok(pk.indexOf('translation_pack/pak/res.pak/ui/big.png') >= 0 && pk.indexOf('translation_pack/pak/res.pak/ui/big.fnt') >= 0 && pk.indexOf('translation_pack/pak/res.pak/ui/other.png') < 0, 'gói dịch: có fnt + atlas, không có ảnh thường');
    const man = JSON.parse(Buffer.from(T.toPack(fr, {}).find(function (f) { return f.name.endsWith('manifest.json'); }).data).toString('utf8'));
    ok(man.font_inventory.length === 3 && T.toIndex(fr).font_inventory.length === 3, 'manifest + index có font_inventory');
  })();

  console.log(fail ? 'FAILED ' + fail + '/' + n : 'PASS ' + n + '/' + n); process.exit(fail ? 1 : 0);
})();
