// Chạy: node tests/run_scan_tests.js DIR   (sau make_scan_ipa.py). Hash kỳ vọng do Python/hashlib tính độc lập.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, dir = process.argv[2] || '/tmp/fake_ipas';
const exp = JSON.parse(fs.readFileSync(path.join(dir, 'scan_expected.json'), 'utf8'));
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const hooks = { step() {}, progress() {}, log() {} };

(async function () {
  const buf = fs.readFileSync(path.join(dir, 'scan_mix.ipa')); const file = new File([buf], 'scan_mix.ipa');

  // --- chế độ standard ---
  let r = await NS.IpaReader.analyze(file, { hashMode: 'standard' }, hooks);
  let mf = r.manifest; ok(!!mf, 'có manifest');
  const by = {}; mf.rows.forEach(function (x) { by[x.relative_path] = x; });
  Object.keys(exp).forEach(function (k) {
    const row = by[k]; ok(!!row, 'thiếu hàng ' + k); if (!row) return;
    ok(row.file_size === exp[k].size, k + ' size');
    ok(row.sha1 === exp[k].sha1, k + ' sha1 lệch');
    if (exp[k].size <= 64 * 1024 * 1024) ok(row.sha256 === exp[k].sha256, k + ' sha256 lệch'); else ok(row.sha256 === '', k + ' >64MB không được băm SHA-256');
    ok(row.extraction_status === 'ok', k + ' status=' + row.extraction_status);
  });
  const T = function (k, type, fmt) { const x = by[k]; ok(x && x.detected_type === type && (!fmt || x.detected_format.indexOf(fmt) >= 0), k + ' type=' + (x && x.detected_type + '/' + x.detected_format) + ' mong ' + type); };
  T('icon.png', 'Image', 'PNG'); T('fake.png', 'Archive', 'ZIP'); T('font.ttf', 'Font', 'TTF'); T('data/config.json', 'Text', 'JSON');
  T('en.lproj/Localizable.strings', 'Localization'); T('Data/data.unity3d', 'Unity asset', 'UnityFS'); T('Exe', 'Executable', 'Mach-O');
  T('Data/Managed/Metadata/global-metadata.dat', 'Binary');
  ok(by['fake.png'].ext_mismatch === true, 'fake.png phải bị đánh dấu đuôi ≠ nội dung');
  ok(by['icon.png'].ext_mismatch === false, 'icon.png không mismatch');
  ok(by['text/empty.txt'].detected_type === 'Unknown', 'file rỗng → Unknown');
  ok(by['Data/data.unity3d'].archive_status === 'recognized_not_unpacked' && /2021\.3\.16f1/.test(by['Data/data.unity3d'].archive_info), 'archive_info UnityFS');
  ok(by['data/config.json'].priority === true && by['Exe'].priority === false, 'cờ priority');
  ok(by['Data/data.unity3d'].engine_related === 'yes' && by['data/config.json'].engine_related === 'no', 'engine_related Unity (' + r.engine.engine + ' ' + r.engine.status + ')');
  ok(by['Frameworks/UnityFramework.framework/UnityFramework'].engine_related === 'yes', 'engine_related framework');
  const unsafe = mf.rows.filter(function (x) { return x.extraction_status === 'unsafe_path'; });
  ok(unsafe.length === 1 && unsafe[0].sha1 === '', 'đường dẫn không an toàn bị từ chối, không băm');
  ok(mf.summary.totalFiles === Object.keys(exp).length + 2, 'tổng file = ' + mf.summary.totalFiles); // + Info.plist + ../escape.txt

  // --- CSV ---
  const csv = NS.FileScanner.toCsv(mf), lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  ok(lines[0] === NS.FileScanner.COLUMNS.join(','), 'header CSV');
  ok(csv.indexOf('content/=evil name.csv') >= 0, 'relative_path (= ở giữa) giữ nguyên');
  ok(csv.indexOf(",'=evil name.csv,") >= 0, 'file_name bắt đầu bằng = phải được thêm dấu nháy đơn (chống formula injection)');
  const t = NS.FileScanner.toCsv({ columns: ['a'], rows: [{ a: '=1+1' }, { a: 'x,"y"' }] });
  ok(t.indexOf("'=1+1") >= 0 && t.indexOf('"x,""y"""') >= 0, 'chống formula injection + escape dấu phẩy/nháy');

  // --- chế độ fast ---
  r = await NS.IpaReader.analyze(file, { hashMode: 'fast' }, hooks); mf = r.manifest;
  ok(mf.options.hashMode === 'fast' && mf.summary.hashed === 0, 'fast: không băm');
  const f2 = {}; mf.rows.forEach(function (x) { f2[x.relative_path] = x; });
  ok(f2['icon.png'].detected_type === 'Image' && f2['icon.png'].sha1 === '' && f2['icon.png'].extraction_status === 'head_only', 'fast vẫn phân loại, status head_only');
  ok(f2['big/zeros.bin'].sha1 === '', 'fast: không băm file lớn');

  // --- auto: IPA nhỏ → standard ---
  r = await NS.IpaReader.analyze(file, {}, hooks);
  ok(r.manifest.options.hashMode === 'standard', 'auto → standard với IPA nhỏ');

  // --- hủy giữa chừng ---
  let cancelled = false, threw = null; let calls = 0;
  try { await NS.IpaReader.analyze(file, { hashMode: 'standard' }, { step() {}, progress() {}, log() {}, isCancelled: function () { return ++calls > 40; } }); } catch (e) { threw = e.code; }
  ok(threw === 'CANCELLED', 'hủy khi đang quét (' + threw + ')');

  console.log(fail ? fail + ' THẤT BẠI / ' + n : 'TẤT CẢ ĐẠT (' + n + ' kiểm tra)');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('LỖI', e); process.exit(1); });
