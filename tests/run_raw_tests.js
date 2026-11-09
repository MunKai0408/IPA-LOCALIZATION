// Chạy: python3 tests/make_raw_ipas.py DIR && node tests/run_raw_tests.js DIR   (Node ≥ 20). Dữ liệu GIẢ LẬP; không chứng minh đúng trên game thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'modules/unity_fs', 'modules/serialized_file', 'modules/font_metrics', 'modules/tmp_font', 'modules/pak_heads', 'modules/raw_strings', 'modules/text_extract', 'modules/candidates', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, R = NS.RawStrings, dir = process.argv[2] || '/tmp/fake_ipas';
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const run = async function (name) {
  const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa');
  return NS.IpaReader.analyze(file, {}, { step() {}, progress() {}, log() {}, isCancelled: undefined });
};
(async function () {
  ok(R.plausible('Hello world', false) && !R.plausible('btn_play', false) && !R.plausible('a1b2', false) && R.plausible('Quit', true) && !R.plausible('Quit', false) === true, 'plausible: câu/nhãn trong JSON ok, ID/rác không');
  ok(R.splitRun('{"id":"x_1","text":"Start your game"}').map(function (x) { return x.text; }).join('|') === 'Start your game', 'splitRun: chỉ lấy giá trị JSON giống text');
  /* chunk bị cắt giữa ký tự đa byte */
  const rows = []; const sc = R.createScanner(function (r) { rows.push(r); }); const b = new TextEncoder().encode('xx Tiếp tục hành trình xx'); sc.feed(b.subarray(0, 8)); sc.feed(b.subarray(8)); sc.end();
  ok(rows.length === 1 && rows[0].text.indexOf('Tiếp tục hành trình') >= 0, 'scanner: ghép đúng qua ranh giới chunk (UTF-8 đa byte)');

  /* CDB: chỉ lấy cột localizable, gồm sheet con */
  const cdbS = JSON.stringify({ sheets: [
    { name: 'item', columns: [{ name: 'id' }, { name: 'name', kind: 'localizable' }, { name: 'tags' }, { name: 'events' }], lines: [{ id: 'Sword', name: 'Kiếm sắt', tags: [{ tag: 'HasBullets' }], events: [{ text: 'Hello there, traveler', fxId: 'fxKnifeA' }] }] },
    { name: 'item@events', columns: [{ name: 'text', kind: 'localizable' }, { name: 'fxId' }], lines: [] }] });
  const cr = NS.TextExtract.parseCdb(cdbS);
  ok(cr && cr.rows.length === 2 && cr.rows[0].key === 'item[Sword].name' && cr.rows[1].key === 'item[Sword].events[0].text' && cr.rows[1].text === 'Hello there, traveler', 'CDB: chỉ cột localizable (gồm sheet con), bỏ ID/tag/fx');
  ok(NS.TextExtract.extractBytes('data.cdb', new TextEncoder().encode(cdbS)).format === 'cdb-localizable', 'extractBytes: .cdb → cdb-localizable');
  const jx = NS.TextExtract.extractBytes('a.json', new TextEncoder().encode('{"bone":"toesLeftB","t":"Hello world, again."}'));
  ok(jx.rows.length === 1 && jx.rows[0].text === 'Hello world, again.', 'JSON thường: bỏ ID 1 từ');

  let r = await run('raw_pak'); const t = r.texts, tx = t.rows.map(function (x) { return x.text; });
  ok(r.pak_heads.pak_files[0].heaps.status !== 'ok', 'pak header lạ → không đọc được cây (unverified/partial)');
  ok(tx.indexOf('Press any button to continue the game.') >= 0, 'raw: chuỗi UTF-8 trần');
  ok(tx.indexOf('Start your adventure') >= 0 && tx.indexOf('Tiếp tục hành trình') >= 0, 'raw: giá trị JSON/cdb (gồm tiếng Việt)');
  ok(tx.indexOf('Welcome back, hero!') >= 0, 'raw: UTF-16LE Latin');
  ok(tx.indexOf('Settings menu') >= 0, 'raw: nội dung XML');
  ok(tx.indexOf('Unity-style scene text line here') >= 0, 'raw: file .bin ngoài pak');
  ok(tx.indexOf('btn_play') < 0, 'raw: ID không lọt vào');
  ok(t.rows.every(function (x) { return x.container.indexOf('raw:') === 0 && x.format === 'raw' && /^@0x[0-9a-f]+$/.test(x.key); }), 'raw: mọi dòng có container raw: + offset @0x');
  ok(t.status === 'ok' && t.raw.length === 2, 'status ok, 2 file đã quét thô');
  const u = t.unsupported.find(function (x) { return x.file.endsWith('res.pak'); }); ok(u && u.raw_rows >= 4, 'unsupported ghi số dòng quét thô');
  ok(t.warnings.some(function (w) { return w.indexOf('HYPOTHESIS') >= 0; }), 'có cảnh báo nhãn HYPOTHESIS');

  r = await run('raw_encrypted'); ok(r.texts.rows.length <= 3, 'dữ liệu ngẫu nhiên → gần như không có dòng (không bịa): ' + r.texts.rows.length);
  console.log(fail ? 'FAILED ' + fail + '/' + n : 'PASS ' + n + '/' + n); process.exit(fail ? 1 : 0);
})();
