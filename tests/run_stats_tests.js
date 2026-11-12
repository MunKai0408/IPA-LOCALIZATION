// Chạy (cùng thư mục fixture với text/candidates/unity): node tests/run_stats_tests.js DIR
// NGHIỆM THU A3: session.stats.stringCount và localizationTables có SỐ sau khi chạy IpaReader.analyze → SessionStats.compute. Dữ liệu GIẢ LẬP.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'modules/unity_fs', 'modules/serialized_file', 'modules/font_metrics', 'modules/tmp_font', 'modules/pak_heads', 'modules/raw_strings', 'modules/text_extract', 'modules/candidates', 'modules/session_stats', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, SS = NS.SessionStats, dir = process.argv[2] || '/tmp/fake_ipas';
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const stats = async function (name) { const f = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa'); return SS.compute(await NS.IpaReader.analyze(f, { hashMode: 'auto' }, { step() {}, progress() {}, log() {} })); };
(async function () {
  /* Chạy thật qua pipeline: hai ô phải là SỐ (không null) */
  const exp = { text_ios: [15, 6], text_pak: [4, 2], raw_pak: [7, 0], cand_unity_bundles: [0, 2], inv_all: [0, 2], ser_all: [1, 1], cand_none: [0, 0] };
  for (const k of Object.keys(exp)) { const s = await stats(k); ok(typeof s.stringCount === 'number' && typeof s.localizationTables === 'number', k + ': hai ô là số, không null: ' + JSON.stringify(s)); ok(s.stringCount === exp[k][0] && s.localizationTables === exp[k][1], k + ': ' + s.stringCount + '/' + s.localizationTables + ' (mong đợi ' + exp[k] + ')'); }
  { const s = await stats('text_ios'); ok(s.tableBreakdown.read === 6 && s.tableBreakdown.unity_unread === 0 && s.stringSource === 'texts' && s.totalFiles === 10, 'text_ios: nguồn + breakdown'); }
  { const s = await stats('inv_all'); ok(s.tableBreakdown.unity_unread === 2 && s.tableBreakdown.read === 0, 'Unity: bảng chưa đọc tính riêng'); }
  /* Hàm thuần: null vs 0, fallback IL2CPP, đầu vào thiếu */
  ok(SS.compute({ zip: { fileCount: 3 } }).stringCount === null && SS.compute({ zip: { fileCount: 3 } }).localizationTables === null && SS.compute({ zip: { fileCount: 3 } }).totalFiles === 3, 'không có texts/candidates → null (không bịa số 0)');
  ok(SS.compute({ texts: { summary: { rows: 0 }, rows: [] }, zip: {} }).stringCount === 0, 'texts chạy, 0 dòng → 0');
  { const r = { zip: {}, texts: { summary: { rows: 0 }, rows: [] }, unity: { metadata_literals: { status: 'ok', count: 321 } } }; const s = SS.compute(r); ok(s.stringCount === 321 && s.stringSource === 'il2cpp_literals', 'fallback literal IL2CPP khi không có dòng text'); }
  { const r = { zip: {}, texts: { summary: { rows: 5 }, rows: [] }, unity: { metadata_literals: { status: 'ok', count: 321 } } }; ok(SS.compute(r).stringCount === 5, 'ưu tiên dòng text hơn literal'); }
  { const r = { zip: {}, unity: { metadata_literals: { status: 'invalid', count: 99 } } }; ok(SS.compute(r).stringCount === null, 'literal status≠ok không được dùng'); }
  { const r = { zip: {}, texts: { summary: { rows: 3 }, rows: [{ container: 'ipa', file: 'a.strings', lang: 'en' }, { container: 'ipa', file: 'a.strings', lang: 'en' }, { container: 'ipa', file: 'b.strings', lang: 'base' }, { container: 'ipa', file: 'c.json', lang: null }] }, candidates: { summary: {}, candidates: [{ kind: 'unity.i2', paths: [] }, { kind: 'unity.textasset', paths: [{}, {}, {}] }, { kind: 'heaps.pak', paths: [{}] }] } };
    const s = SS.compute(r); ok(s.localizationTables === 5 && s.tableBreakdown.read === 1 && s.tableBreakdown.unity_unread === 4, 'bảng: 1 file có lang (trùng gộp, base/null bỏ) + 1 I2 + 3 TextAsset; pak không tính: ' + JSON.stringify(s)); }
  ok(JSON.stringify(SS.compute({ zip: { fileCount: 1 }, texts: { summary: { rows: 2 }, rows: [] } })) !== undefined, 'JSON hóa được');
  console.log(fail ? ('THẤT BẠI ' + fail + '/' + n) : ('Tất cả ' + n + ' kiểm tra đạt')); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('LỖI TEST', e && e.stack || e); process.exit(2); });
