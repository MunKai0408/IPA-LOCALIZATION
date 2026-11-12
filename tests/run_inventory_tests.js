// Chạy: python3 tests/make_inventory_ipas.py DIR && node tests/run_inventory_tests.js DIR
// Kiểm kê object Unity (class → số lượng/dung lượng, tên MonoBehaviour, carriers). Fixture GIẢ LẬP; CHƯA kiểm trên game thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'modules/unity_fs', 'modules/serialized_file', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, SF = NS.SerializedFile, dir = process.argv[2] || '/tmp/fake_ipas';
const EXP = JSON.parse(fs.readFileSync(path.join(dir, 'inventory_expected.json'), 'utf8'));
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const eq = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
const raw = function (p) { return new Uint8Array(fs.readFileSync(path.join(dir, 'inv_raw_' + p.replace(/\//g, '__')))); };
const mk = function () { return new File([fs.readFileSync(path.join(dir, 'inv_all.ipa'))], 'inv_all.ipa'); };
(async function () {
  /* hàm thuần */
  ok(SF.CLASS_NAMES[102] === 'TextMesh' && SF.CLASS_NAMES[132] === 'GUIText' && SF.classIdOf('TextAsset') === 49 && SF.classIdOf('ClassID 9999') === 9999 && SF.classIdOf('xyz') === null, 'bảng class + classIdOf');
  { const b = raw('Data/level0'), i = SF.parse(b); ok(i.status === 'parsed' && eq(i.class_bytes, (function () { const e = EXP.level0_class_bytes, o = {}; Object.keys(i.class_counts).forEach(function (k) { o[k] = e[k] !== undefined ? e[k] : i.class_bytes[k]; }); return o; })()), 'class_bytes khớp tổng kích thước object: ' + JSON.stringify(i.class_bytes));
    ok(i.class_bytes.TextAsset === EXP.level0_class_bytes.TextAsset && i.class_bytes.MonoBehaviour === EXP.level0_class_bytes.MonoBehaviour && i.class_counts['ClassID 9999'] === 1 && i.class_counts.TextMesh === 1, 'đếm TextAsset/MB/TextMesh/ClassID lạ');
    ok(SF.monoName(SF.readObject(b, i, 5), true, 17) === 'I2Languages' && SF.monoName(SF.readObject(b, i, 0), true, 17) !== 'I2Languages', 'monoName v17');
    ok(SF.monoName(SF.readObject(b, i, 5), false, 17) === null, 'monoName sai endian → null'); ok(SF.monoName(new Uint8Array(10), true, 17) === null && SF.monoName(new Uint8Array(0), true, 13) === null, 'monoName quá ngắn → null');
    const i1 = SF.parse(raw('Data/level1')); ok(SF.monoName(SF.readObject(raw('Data/level1'), i1, 1), true, 13) === 'V13Name', 'monoName v13 (PPtr 8 byte)'); }
  ok(SF.sniffText(new TextEncoder().encode('{"a":1}')) === 'json' && SF.sniffText(new TextEncoder().encode('<?xml version="1.0"?><a/>')) === 'xml' && SF.sniffText(new TextEncoder().encode('a,b\n1,2')) === 'csv' && SF.sniffText(new TextEncoder().encode('a\tb\n1\t2')) === 'tsv'
    && SF.sniffText(new TextEncoder().encode('[x]\nk=v')) === 'ini' && SF.sniffText(new TextEncoder().encode('  \n')) === 'empty' && SF.sniffText(new TextEncoder().encode('xin chào mọi người')) === 'plain', 'sniffText');
  { const e = SF.buildInventory(null); ok(e.classes.length === 0 && e.carriers.length === 0 && e.schema === 'unity_inventory/1', 'buildInventory(null) không ném'); }
  /* scan */
  const r = await NS.IpaReader.analyze(mk(), { hashMode: 'standard' }, { step() {}, progress() {}, log() {} }), entries = (await NS.IpaReader.openZip(mk())).entries;
  const R = await SF.scan(mk(), r, entries, {}), S = R.serialized, inv = S.inventory;
  ok(S.status === 'ok' && inv && inv.schema === 'unity_inventory/1', 'scan ok + có inventory: ' + S.status + ' ' + S.reason);
  const cl = function (nm) { return inv.classes.find(function (c) { return c.class_name === nm; }); };
  ok(cl('TextAsset').count === 3 && cl('TextAsset').bytes === EXP.level0_class_bytes.TextAsset && cl('TextAsset').class_id === 49 && cl('TextAsset').files === 1, 'inventory.classes TextAsset');
  ok(cl('MonoBehaviour').count === 6 && cl('ClassID 9999').class_id === 9999 && cl('TextMesh').class_id === 102, 'MonoBehaviour gộp 3 file; ClassID lạ giữ nguyên id');
  ok(inv.classes.every(function (c, i, a) { return i === 0 || a[i - 1].count >= c.count; }), 'classes sắp theo số lượng giảm dần');
  ok(S.summary.by_class_bytes.TextAsset === cl('TextAsset').bytes, 'summary.by_class_bytes');
  /* tên MonoBehaviour */
  const md = S.mono_detail;
  ok(eq(md['I2.Loc.LanguageSourceData'].samples, ['I2Languages']) && md['I2.Loc.LanguageSourceData'].count === 1, 'mono_detail I2: ' + JSON.stringify(md['I2.Loc.LanguageSourceData']));
  ok(eq(md['TMPro.TextMeshProUGUI'].samples, ['Title', 'Subtitle', 'V13Name']) && md['TMPro.TextMeshProUGUI'].count === 4 && md['TMPro.TextMeshProUGUI'].files === 2, 'mẫu tên TMP (khử trùng lặp, gộp file): ' + JSON.stringify(md['TMPro.TextMeshProUGUI']));
  ok(md['(không xác định)'] && md['(không xác định)'].count === 1 && md['(không xác định)'].samples[0] === 'OnlyMB', 'MB chỉ có trong file không có MonoScript vẫn lấy được tên: ' + JSON.stringify(md['(không xác định)']));
  ok(S.files.find(function (f) { return f.path === 'Data/level2'; }).extraction === 'done', 'file chỉ có MB được đọc đủ để lấy tên');
  /* TextAsset enrich */
  const ta = function (nm) { return S.text_assets.find(function (t) { return t.name === nm; }); };
  ok(ta('Localization_en').looks_like === 'json' && ta('Localization_en').preview.indexOf('{"hello":"Xin chào"}') === 0 && ta('Localization_en').name_hint === true && ta('config').looks_like === 'csv' && ta('config').name_hint === false && ta('blob').looks_like === undefined && ta('blob').is_text === false, 'TextAsset: looks_like/preview/name_hint');
  /* carriers */
  const car = inv.carriers;
  ok(car.length > 0 && car.every(function (c, i, a) { return i === 0 || a[i - 1].score >= c.score; }), 'carriers sắp theo điểm giảm dần');
  ok(car[0].kind === 'localization_script' && car[0].label === 'I2.Loc.LanguageSourceData' && car[0].file === 'Data/level0' && eq(car[0].sample_names, ['I2Languages']), 'carrier đầu = bảng localization I2: ' + JSON.stringify(car[0]));
  { const t = car.find(function (c) { return c.kind === 'text_asset'; }); ok(t && t.file === 'Data/level0' && t.count === 3 && t.text_count === 2 && t.binary_count === 1 && t.name_hint_count === 1 && eq(t.looks_like, { json: 1, csv: 1 }) && t.sample_names[0] === 'Localization_en' && /NAME_HINT/.test(t.evidence), 'carrier text_asset: ' + JSON.stringify(t)); }
  ok(car.filter(function (c) { return c.kind === 'ui_text_component'; }).map(function (c) { return c.file + ':' + c.count; }).sort().join() === 'Data/level0:3,Data/level1:1', 'carrier ui_text_component theo file');
  ok(car.some(function (c) { return c.kind === 'legacy_text_component' && c.label === 'TextMesh' && c.file === 'Data/level0'; }), 'carrier TextMesh');
  ok(car.every(function (c) { return c.evidence && c.why; }) && /HYPOTHESIS/.test(inv.evidence), 'mọi carrier có evidence + why; nhãn HYPOTHESIS');
  ok(inv.files.length === 3 && inv.files[0].path === 'Data/level0' && inv.files[0].classes[0].bytes >= inv.files[0].classes[1].bytes, 'inventory.files theo dung lượng');
  ok(SF.toReportFields(S).unity_text_carriers === car.length && JSON.stringify(SF.toIndex(S)).indexOf('unity_inventory/1') > 0 && typeof structuredClone(S) === 'object', 'report/JSON/structuredClone');
  /* mono_names tắt */
  { SF.LIMITS.mono_names = false; const x = await SF.scan(mk(), r, entries, {}); SF.LIMITS.mono_names = true; const s2 = x.serialized;
    ok(s2.files.find(function (f) { return f.path === 'Data/level2'; }).extraction === 'not_needed' && Object.keys(s2.mono_detail).every(function (k) { return s2.mono_detail[k].samples.length === 0; }) && s2.inventory.notes.some(function (t) { return /mono_names tắt/.test(t); }), 'mono_names=false: không đọc thêm, không có mẫu tên'); }
  /* file quá lớn chỉ có MB: không phát vấn đề TextAsset/Font */
  { const old = SF.LIMITS.max_file_bytes; SF.LIMITS.max_file_bytes = 100; const x = await SF.scan(mk(), r, entries, {}); SF.LIMITS.max_file_bytes = old; const l2 = x.serialized.files.find(function (f) { return f.path === 'Data/level2'; }); ok(l2.extraction === 'too_large' && l2.problems.some(function (p) { return /tên MonoBehaviour/.test(p); }) && !l2.problems.some(function (p) { return /TextAsset\/Font/.test(p); }), 'file lớn chỉ có MB → ghi chú riêng'); }
  console.log(fail ? ('THẤT BẠI ' + fail + '/' + n) : ('Tất cả ' + n + ' kiểm tra đạt')); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('LỖI TEST', e && e.stack || e); process.exit(2); });
