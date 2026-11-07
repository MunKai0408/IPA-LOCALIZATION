// Chạy: python3 tests/make_unity_ipas.py DIR && node tests/run_unity_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 4.1 (dò thành phần Unity + chọn file metadata). IPA GIẢ LẬP: chỉ chứng minh logic, không chứng minh độ chính xác trên IPA thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, dir = process.argv[2] || '/tmp/fake_ipas';
const exp = JSON.parse(fs.readFileSync(path.join(dir, 'u41_expected.json'), 'utf8'));
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const hooks = { step() {}, progress() {}, log() {} };
const run = async function (name, mode) {
  const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa');
  return NS.IpaReader.analyze(file, { hashMode: mode || 'standard' }, hooks);
};
const cnt = function (u, id) { const c = u.components.find(function (x) { return x.id === id; }); return c ? c.files : -1; };

(async function () {
  /* 1. IL2CPP đầy đủ: đếm thành phần theo danh sách file đã biết */
  let r = await run('u41_full_il2cpp'), u = r.unity;
  ok(u && u.schema === 'unity_info/3' && u.sub_phase === '4.3', 'schema/sub_phase');
  ok(u.status === 'discovered' && u.applicable === true, 'full: status=' + u.status);
  ok(u.runtime.value === 'IL2CPP', 'full: runtime=' + u.runtime.value);
  const want = { unity_framework: 2, libil2cpp: 0, global_metadata: 1, metadata_dir: 1, mono_assemblies: 0, libmono: 0, data_resources: 1, streaming_assets: 1, data_raw: 4,
                 data_unity3d: 1, globalgamemanagers: 3, sharedassets: 3, levels: 3, assets: 2, resource: 1, ress: 1, bundle: 1, unityfs_by_magic: 2 };
  Object.keys(want).forEach(function (k) { ok(cnt(u, k) === want[k], 'full: ' + k + '=' + cnt(u, k) + ' (mong ' + want[k] + ')'); });
  ok(u.components_total === 18 && u.components_found === 15, 'full: found/total=' + u.components_found + '/' + u.components_total);
  ok(u.components.find(function (c) { return c.id === 'libil2cpp'; }).found === false, 'libil2cpp không có → found=false, không bịa');
  // mỗi file chỉ thuộc đúng một nhóm theo tên file
  const fileGroups = ['globalgamemanagers', 'sharedassets', 'levels', 'assets', 'resource', 'ress', 'bundle'];
  ok(fileGroups.reduce(function (a, k) { return a + cnt(u, k); }, 0) === 14, 'nhóm theo tên file phải loại trừ lẫn nhau (tổng 14)');
  ok(u.unity_version && u.unity_version.value === '2021.3.16f1' && u.unity_version.source === 'Data/data.unity3d', 'full: phiên bản Unity từ UnityFS: ' + JSON.stringify(u.unity_version));
  ok(u.runtime.agrees_with_engine === true && u.engine.engine === 'Unity', 'full: khớp Phase 2');
  const mi = u.metadata_input; const e1 = exp.u41_full_il2cpp['Data/Managed/Metadata/global-metadata.dat'];
  ok(mi.status === 'selected' && mi.path === 'Data/Managed/Metadata/global-metadata.dat', 'full: metadata_input=' + mi.status + ' ' + mi.path);
  ok(mi.entry_path === 'Payload/Game.app/Data/Managed/Metadata/global-metadata.dat', 'entry_path phải là đường dẫn đầy đủ trong ZIP: ' + mi.entry_path);
  const c0 = mi.candidates[0];
  ok(mi.candidates.length === 1 && c0.magic_matches === true && c0.by_name && c0.standard_location, 'full: ứng viên');
  ok(c0.size === e1.size && c0.sha1 === e1.sha1, 'full: size/SHA-1 ứng viên khớp hashlib độc lập');
  ok(c0.phase2_probe_version === 24, 'full: probe version=' + c0.phase2_probe_version);
  ok(u.main_binary && u.main_binary.path.endsWith('/Exe') && u.main_binary.encrypted === false, 'main_binary');
  const sampled = u.components.every(function (c) { return c.samples.length <= NS.UnityDump.SAMPLE_MAX && c.samples.length <= c.files; });
  ok(sampled, 'samples không vượt giới hạn');
  ok(u.runtime.evidence.length === 2 && u.runtime.evidence.every(function (e) { return e.files > 0; }), 'evidence chỉ gồm thành phần có thật');
  JSON.parse(JSON.stringify(u)); structuredClone(u);   // phải serialize được (ghi Meta/unity_info.json, postMessage)
  ok(r.warnings.length >= 0, 'ok');

  /* 2. Mono */
  r = await run('u41_mono'); u = r.unity;
  ok(u.status === 'discovered' && u.runtime.value === 'Mono' && cnt(u, 'mono_assemblies') === 4, 'mono: ' + u.runtime.value + ' dll=' + cnt(u, 'mono_assemblies'));
  ok(u.metadata_input.status === 'not_il2cpp' && u.metadata_input.path === null, 'mono: không cần metadata');
  ok(u.runtime.agrees_with_engine === true, 'mono: khớp engine Phase 2');

  /* 3. Xung đột IL2CPP + Mono: không chọn biến thể */
  r = await run('u41_conflict'); u = r.unity;
  ok(u.runtime.value === 'conflict' && u.warnings.some(function (w) { return /đồng thời/.test(w); }), 'conflict');
  ok(u.runtime.evidence.some(function (e) { return e.component === 'mono_assemblies'; }) && u.runtime.evidence.some(function (e) { return e.component === 'global_metadata'; }), 'conflict: evidence cả hai');
  ok(u.runtime.agrees_with_engine === null, 'conflict: không kết luận agrees');

  /* 4. Có Unity nhưng không phân biệt được runtime */
  r = await run('u41_no_runtime'); u = r.unity;
  ok(u.status === 'discovered' && u.runtime.value === 'unresolved' && u.runtime.evidence.length === 0, 'no_runtime: ' + u.runtime.value);
  ok(u.metadata_input.status === 'missing' && u.metadata_input.path === null && u.metadata_input.candidates.length === 0, 'no_runtime: metadata missing');

  /* 5. Magic sai: vẫn chọn (theo tên) nhưng ghi rõ, không đoán */
  r = await run('u41_bad_magic'); u = r.unity;
  ok(u.metadata_input.status === 'selected' && u.metadata_input.candidates[0].magic_matches === false, 'bad_magic: selected + magic_matches=false');
  ok(/KHÔNG khớp/.test(u.metadata_input.reason) && /mã hóa|obfuscate/.test(u.metadata_input.reason), 'bad_magic: lý do nêu mã hóa/obfuscate');
  ok(u.metadata_input.candidates[0].phase2_probe_version === null, 'bad_magic: không có version khi magic sai');

  /* 6. Đổi tên file metadata nhưng magic đúng */
  r = await run('u41_renamed'); u = r.unity;
  ok(u.metadata_input.status === 'selected' && u.metadata_input.path === 'Data/Managed/Metadata/meta.bin', 'renamed: ' + u.metadata_input.status + ' ' + u.metadata_input.path);
  const cr = u.metadata_input.candidates[0];
  ok(cr.by_magic === true && cr.by_name === false && cnt(u, 'global_metadata') === 0 && cnt(u, 'metadata_dir') === 1 && u.runtime.value === 'IL2CPP', 'renamed: nhận theo magic, nhóm theo tên không có');
  ok(cr.sha1 === exp.u41_renamed['Data/Managed/Metadata/meta.bin'].sha1, 'renamed: SHA-1 khớp hashlib');

  /* 7. Hai ứng viên: chọn vị trí chuẩn; không có vị trí chuẩn: ambiguous */
  r = await run('u41_two_candidates'); u = r.unity;
  ok(u.metadata_input.status === 'selected' && u.metadata_input.path === 'Data/Managed/Metadata/global-metadata.dat' && u.metadata_input.candidates.length === 2, 'two: ' + u.metadata_input.path);
  ok(/phụ/.test(u.metadata_input.reason), 'two: lý do nêu ứng viên phụ');
  r = await run('u41_ambiguous'); u = r.unity;
  ok(u.metadata_input.status === 'ambiguous' && u.metadata_input.path === null && u.metadata_input.entry_path === null && u.metadata_input.candidates.length === 2, 'ambiguous: không tự chọn');

  /* 8. Chỉ dấu hiệu yếu / không phải Unity */
  r = await run('u41_weak_only'); u = r.unity;
  ok(u.status === 'insufficient_evidence' && u.applicable === false && u.runtime.value === 'not_applicable' && u.metadata_input.status === 'not_applicable', 'weak_only: ' + u.status);
  ok(u.notes.some(function (x) { return /yếu/.test(x); }), 'weak_only: có ghi chú dấu hiệu yếu');
  r = await run('u41_not_unity'); u = r.unity;
  ok(u.status === 'not_unity' && u.components_found === 0 && u.metadata_input.status === 'not_applicable', 'not_unity: ' + u.status);
  ok(u.unity_version === null, 'not_unity: không có version');

  /* 9. FairPlay: chỉ ghi nhận, không giải mã */
  r = await run('u41_fairplay'); u = r.unity;
  ok(u.main_binary && u.main_binary.encrypted === true && u.warnings.some(function (w) { return /FairPlay/.test(w); }), 'fairplay: cảnh báo mã hóa');
  ok(u.metadata_input.status === 'selected', 'fairplay: vẫn xác định file đầu vào');

  /* 10. Unity nhúng trong engine khác */
  r = await run('u41_flutter_unity'); u = r.unity;
  ok(u.status === 'discovered' && u.engine.engine !== 'Unity' && u.notes.some(function (x) { return /engine chính/.test(x); }), 'flutter+unity: ' + u.engine.engine + ' ' + u.status);

  /* 11. Nhiều file: đếm đủ, mẫu bị cắt có đánh dấu */
  r = await run('u41_many_files'); u = r.unity;
  const dr = u.components.find(function (c) { return c.id === 'data_resources'; });
  ok(dr.files === 40 && dr.samples.length === NS.UnityDump.SAMPLE_MAX && dr.truncated === true, 'many: files=' + dr.files + ' samples=' + dr.samples.length);

  /* 12. Không phân biệt hoa/thường */
  r = await run('u41_case'); u = r.unity;
  ok(cnt(u, 'global_metadata') === 1 && u.metadata_input.status === 'selected' && u.metadata_input.candidates[0].standard_location === true, 'case: ' + u.metadata_input.status);

  /* 13. File metadata rỗng (0 byte): không có magic → magic_matches=false, không crash */
  r = await run('u41_empty_meta'); u = r.unity;
  ok(u.metadata_input.status === 'selected' && u.metadata_input.candidates[0].size === 0 && u.metadata_input.candidates[0].magic_matches === null, 'empty_meta: size 0, chưa có magic');

  /* 14. Chế độ fast: vẫn có magic bytes, không có SHA */
  r = await run('u41_full_il2cpp', 'fast'); u = r.unity;
  ok(u.source.hash_mode === 'fast' && u.metadata_input.candidates[0].sha1 === '' && u.metadata_input.candidates[0].magic_matches === true, 'fast: magic có, sha1 rỗng');
  ok(u.notes.some(function (x) { return /chế độ nhanh/i.test(x); }), 'fast: ghi chú');

  /* 15. Không có manifest (bước quét lỗi): fallback theo entry, có cảnh báo, không bịa magic */
  r = await run('u41_full_il2cpp'); const noMf = Object.assign({}, r, { manifest: null });
  u = NS.UnityDump.discover(noMf);
  ok(u.source.kind === 'entries' && u.source.scanned === false && u.warnings.some(function (w) { return /manifest/.test(w); }), 'no manifest: cảnh báo');
  ok(u.runtime.value === 'IL2CPP' && u.metadata_input.status === 'selected' && u.metadata_input.candidates[0].magic_matches === null, 'no manifest: vẫn tìm theo tên; magic = null');
  ok(cnt(u, 'unityfs_by_magic') === 0, 'no manifest: không có magic thì không nhận UnityFS theo magic');

  /* 16. Hàm thuần: không đổi đầu vào, đầu vào xấu → ném lỗi rõ ràng */
  r = await run('u41_full_il2cpp'); const before = JSON.stringify(r);
  NS.UnityDump.discover(r); ok(JSON.stringify(r) === before, 'discover không được sửa IpaResult');
  let threw = false; try { NS.UnityDump.discover(null); } catch (e) { threw = /IpaResult/.test(e.message); } ok(threw, 'discover(null) phải ném lỗi rõ');
  const rf = NS.UnityDump.toReportFields(r.unity);
  ok(rf.unity_runtime === 'IL2CPP' && rf.unity_metadata_input === 'selected' && rf.unity_version === '2021.3.16f1', 'toReportFields');

  /* 17. Các IPA của Phase 2 (engine fixtures): discover chạy được, kết luận nhất quán với engine */
  const p2 = { unity_il2cpp: ['discovered', 'IL2CPP'], unity_mono: ['discovered', 'Mono'], unity_conflict: ['discovered', 'conflict'], unity_novariant: ['discovered', 'unresolved'],
               unity_weak_only: ['not_unity', 'not_applicable'], flutter: ['not_unity', 'not_applicable'], native_ios: ['not_unity', 'not_applicable'], unknown: ['not_unity', 'not_applicable'] };
  for (const k of Object.keys(p2)) {
    if (!fs.existsSync(path.join(dir, k + '.ipa'))) { ok(false, 'thiếu fixture Phase 2: ' + k); continue; }
    const x = (await run(k)).unity;
    ok(x.status === p2[k][0] || (k === 'unity_weak_only' && x.status === 'insufficient_evidence'), k + ': status=' + x.status);
    ok(x.runtime.value === p2[k][1], k + ': runtime=' + x.runtime.value + ' (mong ' + p2[k][1] + ')');
  }

  console.log(fail ? '\n' + fail + ' KIỂM TRA THẤT BẠI / ' + n : '\nTẤT CẢ ĐẠT (' + n + ' kiểm tra)');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('Lỗi test:', e); process.exit(2); });
