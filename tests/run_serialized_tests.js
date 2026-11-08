// Chạy: python3 tests/make_serialized_ipas.py DIR && node tests/run_serialized_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 5.2c (SerializedFile). Fixture GIẢ LẬP dựng độc lập bằng Python theo CÙNG giả định bố cục của module → chứng minh logic nhất quán, KHÔNG chứng minh khớp file Unity thật.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'modules/unity_fs', 'modules/serialized_file', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, SF = NS.SerializedFile, dir = process.argv[2] || '/tmp/fake_ipas';
const EXP = JSON.parse(fs.readFileSync(path.join(dir, 'serialized_expected.json'), 'utf8'));
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const raw = function (p) { return new Uint8Array(fs.readFileSync(path.join(dir, 'ser_raw_' + p.replace(/\//g, '__')))); };
const sha = function (u8) { return crypto.createHash('sha256').update(u8).digest('hex'); };
const eq = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
const rejects = async function (fn) { try { await fn(); return null; } catch (e) { return e; } };
const CAND = Object.keys(EXP).filter(function (k) { return !EXP[k].not_candidate && !EXP[k].bundle; });

(async function () {
  /* 1. parse thuần từng file */
  for (const p of CAND) {
    const ex = EXP[p], b = raw(p), info = SF.parse(b);
    if (ex.expect_status) { ok(info.status === ex.expect_status, p + ': status=' + info.status + ' (mong đợi ' + ex.expect_status + ') ' + info.reason); if (ex.expect_problem) ok(info.problems.some(function (x) { return x.indexOf(ex.expect_problem) >= 0; }), p + ': có vấn đề "' + ex.expect_problem + '"'); continue; }
    ok(info.status === 'parsed', p + ': status=' + info.status + ' ' + info.reason); if (info.status !== 'parsed') continue;
    ok(info.header.version === ex.version && info.unity_version === '2021.3.10f1', p + ': version/unity_version');
    ok(eq(info.class_counts, ex.classes), p + ': thống kê class ' + JSON.stringify(info.class_counts));
    ok(info.problems.length === 0, p + ': không vấn đề ' + JSON.stringify(info.problems));
  }
  { const i3 = SF.parse(raw('Data/level3')), i0 = SF.parse(raw('Data/level0')), i22 = SF.parse(raw('Data/resources.assets'));
    ok(i3.header.endian === 'big' && i0.header.endian === 'little', 'endian big/little');
    ok(SF.parse(raw('Data/sharedassets0.assets')).enable_type_tree === true && i0.enable_type_tree === false && SF.parse(raw('Data/level2')).enable_type_tree === false, 'cờ type tree');
    ok(i22.header.version === 22 && i22.header.data_offset > 48 && i22.objects.length === 2, 'v22: header mở rộng 48 byte');
    ok(i0.scripts.length === 3 && i0.externals.length === 1 && i0.externals[0].path === 'globalgamemanagers.assets', 'scripts/externals của level0');
    ok(i0.objects.every(function (o) { return o.in_range; }) && i0.objects[0].path_id === 1 && i0.objects[3].class_name === 'MonoScript', 'object table level0');
    const b = raw('Data/level0'); const t = SF.readObject(b, i0, 0); const d = SF.decodeTextAsset(t, true); ok(d.ok && d.name === 'dialog_vi' && sha(d.script) === EXP['Data/level0'].text[0][1], 'decodeTextAsset');
    ok(SF.decodeTextAsset(t, false).ok === false, 'decode sai endian → không ok (không lén trả rác)');
    const ms = SF.decodeMonoScript(SF.readObject(b, i0, 3), true); ok(ms && ms.class_name === 'LocalizationManager' && ms.namespace === 'MyGame' && ms.assembly === 'Assembly-CSharp', 'decodeMonoScript');
    ok(SF.decodeMonoScript(SF.readObject(b, i0, 0), true) === null, 'decodeMonoScript trên TextAsset → null');
    const f = SF.findEmbeddedFont(SF.readObject(b, i0, 2), true); ok(f && f.name === 'Roboto' && f.valid === true && f.ext === 'ttf' && f.length === 12 + 48 + 192, 'findEmbeddedFont: ' + JSON.stringify(f && [f.name, f.valid, f.length]));
    ok(SF.findEmbeddedFont(SF.readObject(b, i0, 0), true) === null, 'findEmbeddedFont: object không có font → null');
    { const fake = new Uint8Array(80); fake.set([5, 0, 0, 0, 65, 114, 105, 97, 108, 0, 0, 0], 0); fake.set([63, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0xFE], 12); const f2 = SF.findEmbeddedFont(fake, true); ok(f2 && f2.rejected === true && f2.valid === false && f2.name === 'Arial', 'tái hiện false positive thật (Arial built-in 63 byte): rejected'); }
    ok((await rejects(function () { return SF.readObject(b, i0, 99); })).code === 'NO_OBJECT', 'readObject không tồn tại');
    ok((await rejects(function () { return SF.readObject(b.subarray(0, 100), i0, 0); })).code === 'RANGE', 'readObject ngoài dữ liệu → RANGE');
  }
  /* parse: đầu vào xấu / thiếu byte / cắt */
  ok(SF.parse(null).status === 'not_serialized' && SF.parse(new Uint8Array(0)).status === 'not_serialized', 'parse(null)/rỗng không ném');
  { const b = raw('Data/level0'), h = SF.parse(b).header; const a = SF.parse(b.subarray(0, 40), b.length); ok(a.status === 'need_more_bytes' && a.need === h.data_offset, 'đầu file thiếu → need_more_bytes = data_offset');
    ok(SF.parse(b.subarray(0, h.data_offset), b.length).status === 'parsed', 'chỉ cần data_offset byte đầu là đọc được metadata');
    const bad = new Uint8Array(b); bad.set([0x7F, 0xFF, 0xFF, 0xFF], 40); const t = SF.parse(bad); ok(typeof t.status === 'string' && (t.status !== 'parsed' || t.objects.length < 9 || t.problems.length > 0 || t.objects.every(function (o) { return typeof o.path_id === 'number'; })), 'phá số type không ném: ' + t.status); }
  { const b = new Uint8Array(raw('Data/level0')); const h = SF.parse(b).header; for (let i = 0; i < 12; i++) b[h.data_offset - 12 + i] = 0xFF; { const t = SF.parse(b); ok(t.status === 'parsed' && t.objects.length === 9 && t.problems.some(function (x) { return /scripts\/externals/.test(x); }), 'đuôi metadata bị phá: bảng object vẫn dùng được + ghi vấn đề (' + t.status + ' ' + t.problems.length + ')'); } }
  { const b = raw('Data/level0'); const cut = SF.parse(b.subarray(0, 150), 150); ok(cut.status === 'not_serialized' || cut.status === 'truncated' || cut.status === 'need_more_bytes', 'cắt trong metadata: ' + cut.status); }

  /* 2. scan trong IPA */
  const ipaName = path.join(dir, 'ser_all.ipa'), mk = function () { return new File([fs.readFileSync(ipaName)], 'ser_all.ipa'); };
  const r = await NS.IpaReader.analyze(mk(), { hashMode: 'standard' }, { step() {}, progress() {}, log() {} });
  const entries = (await NS.IpaReader.openZip(mk())).entries;
  const cands = SF.selectCandidates(entries, r.appRoot);
  ok(cands.length === CAND.length && cands.every(function (c) { return CAND.indexOf(c.rel) >= 0; }), 'ứng viên: ' + cands.length + '/' + CAND.length + ' (global-metadata.dat và .resS bị loại)');
  const R = await SF.scan(mk(), r, entries, {}), S = R.serialized, F = R.files;
  ok(S.schema === 'unity_serialized/1' && S.sub_phase === '5.2c' && S.status === 'partial', 'scan status=' + S.status + ' ' + S.reason);
  ok(S.summary.files === 18 && S.summary.parsed === 14, 'scan: 18 mục, 14 đọc được: ' + JSON.stringify([S.summary.files, S.summary.parsed, S.summary.by_status]));
  const it = function (p) { return S.files.find(function (x) { return x.path === p; }); };
  const wantStatus = { 'Data/level4': 'unsupported_typetree', 'Data/level5': 'unsupported_version', 'Data/level6': 'not_serialized', 'Data/empty.assets': 'not_serialized' };
  Object.keys(wantStatus).forEach(function (p) { ok(it(p) && it(p).status === wantStatus[p], p + ' → ' + (it(p) && it(p).status)); });
  CAND.filter(function (p) { return !wantStatus[p]; }).forEach(function (p) { ok(it(p) && it(p).status === 'parsed', p + ' parsed'); });
  /* TextAsset: mọi cái mong đợi đều có mặt, đúng nội dung (SHA độc lập) */
  let expText = 0; const exTxt = [];
  CAND.forEach(function (p) { (EXP[p].text || []).forEach(function (t) { exTxt.push([p, t[0], t[1], t[2]]); }); (EXP[p].text_ok || []).forEach(function (nm) { exTxt.push([p, nm, null, true]); }); });
  exTxt.push(['Data/Bundles/b.bundle!CAB-1', 'in_bundle', EXP['Data/Bundles/b.bundle'].text[0][1], true]);
  for (const [p, nm, h, isTxt] of exTxt) {
    const rec = S.text_assets.find(function (t) { return t.source === p && t.name === nm; });
    ok(rec && rec.extraction_status === 'extracted', p + ' / ' + nm + ': đã trích xuất'); if (!rec) continue; expText++;
    const bytes = F[rec.extracted_path]; ok(bytes && sha(bytes) === rec.sha256 && (h === null || h === rec.sha256) && rec.is_text === isTxt && bytes.length === rec.size, p + ' / ' + nm + ': nội dung khớp SHA-256, is_text=' + rec.is_text);
  }
  ok(S.summary.text_assets_extracted === expText && expText === 13, 'tổng TextAsset trích xuất = ' + S.summary.text_assets_extracted);
  ok(S.text_assets.some(function (t) { return t.name === 'bad' && t.extraction_status === 'failed' && t.problem; }) && !S.text_assets.some(function (t) { return t.name === 'big' || t.name === 'oops'; }), 'TextAsset hỏng → failed; object ngoài file bị bỏ qua, không rác');
  ok(F['Text/text_assets/Data_level0/dialog_vi_1.txt'] && utf8(F['Text/text_assets/Data_level0/dialog_vi_1.txt']).startsWith('ĐỐI THOẠI'), 'tiếng Việt UTF-8 giữ nguyên trong file đã trích');
  ok(F['Text/text_assets/Data_level0/blob_2.bin'] && S.text_assets.find(function (t) { return t.name === 'blob'; }).is_text === false, 'TextAsset nhị phân → .bin');
  /* Font nhúng */
  const exF = [['Data/level0', 'Roboto'], ['Data/resources.assets', 'Arial'], ['Data/level3', 'BeFont'], ['Data/level11', 'TwoBlobs']];
  for (const [p, nm] of exF) { const rec = S.fonts.find(function (t) { return t.source === p && t.name === nm; }); ok(rec && rec.extraction_status === 'extracted' && rec.valid === true && sha(F[rec.extracted_path]) === EXP[p].fonts[0][1] && /\.ttf$/.test(rec.extracted_path), p + ' / ' + nm + ': font trích đúng SHA-256'); }
  ok(S.fonts.length === 6 && S.fonts.some(function (f) { return f.name === 'NoFont' && f.extraction_status === 'no_embedded_font_found'; }) && S.summary.fonts_extracted === 4 && S.summary.fonts_valid === 4 && S.summary.fonts_rejected === 1, 'font: 4 trích xuất (đều hợp lệ), 1 bị loại, 1 không tìm thấy font nhúng: ' + JSON.stringify([S.fonts.length, S.summary.fonts_extracted, S.summary.fonts_valid]));
  { const fk = S.fonts.find(function (f) { return f.name === 'FakeOnly'; }); ok(fk && fk.extraction_status === 'rejected_invalid_candidate' && fk.valid === false && fk.problems.length > 0 && fk.extracted_path === null && !Object.keys(F).some(function (k) { return /FakeOnly/.test(k); }), 'blob giả chỉ có một mình (như font Arial built-in thật): KHÔNG trích, ghi lý do bị loại'); }
  /* MonoBehaviour → class */
  ok(eq(S.mono_classes, { 'MyGame.LocalizationManager': 6, 'TMPro.TMP_FontAsset': 1 }) && S.mono_unresolved === 1, 'MonoBehaviour quy về class: ' + JSON.stringify(S.mono_classes) + ' unresolved=' + S.mono_unresolved);
  ok(eq(it('Data/level0').monobehaviours, EXP['Data/level0'].mb), 'level0: MB theo class (kể cả script ở file ngoài và không xác định): ' + JSON.stringify(it('Data/level0').monobehaviours));
  ok(eq(it('Data/level10').monobehaviours, EXP['Data/level10'].mb) && eq(it('Data/level1').monobehaviours, EXP['Data/level1'].mb) && eq(it('Data/level3').monobehaviours, EXP['Data/level3'].mb), 'v15 (script ở object) và BE: MB đúng class');
  ok(S.mono_scripts.length === 6 && S.mono_scripts.some(function (m) { return m.class_name === 'TMP_FontAsset'; }), 'danh sách MonoScript');
  /* node SerializedFile trong bundle */
  { const bn = S.files.find(function (x) { return x.source === 'bundle_node'; }); ok(bn && bn.status === 'parsed' && bn.bundle === 'Data/Bundles/b.bundle' && bn.node === 'CAB-1' && bn.version === 17, 'node SerializedFile trong UnityFS đọc được'); ok(!S.files.some(function (x) { return /resS/.test(x.path); }), 'node .resS không bị coi là SerializedFile'); }
  ok(it('Data/level7').problems.some(function (x) { return /vượt file/.test(x); }) && it('Data/level7').extraction === 'done', 'level7: vấn đề ghi nhận, phần đọc được vẫn trích');
  ok(JSON.stringify(SF.toIndex(S)) && SF.toReportFields(S).unity_text_assets === 13 && typeof structuredClone(S) === 'object', 'JSON/structuredClone/report');
  ok(S.limitations.length === 6 && S.files.every(function (f) { return !('data' in f); }), 'ghi rõ phần chưa làm; JSON không chứa byte');
  /* 3. Hủy, giới hạn, đầu vào xấu */
  { let c = 0; const e = await rejects(function () { return SF.scan(mk(), r, entries, { isCancelled: function () { return ++c > 4; } }); }); ok(e && e.code === 'CANCELLED', 'scan hủy giữa chừng'); }
  { const old = SF.LIMITS.max_total_extract; SF.LIMITS.max_total_extract = 30; const x = await SF.scan(mk(), r, entries, {}); SF.LIMITS.max_total_extract = old; ok(x.serialized.text_assets.some(function (t) { return t.extraction_status === 'skipped_budget'; }) && Object.keys(x.files).length < 13, 'ngân sách trích xuất tổng bị chặn'); }
  { const old = SF.LIMITS.max_file_bytes; SF.LIMITS.max_file_bytes = 100; const x = await SF.scan(mk(), r, entries, {}); SF.LIMITS.max_file_bytes = old; const l0 = x.serialized.files.find(function (f) { return f.path === 'Data/level0'; }); ok(l0.status === 'parsed' && l0.extraction === 'too_large' && Object.keys(x.files).length === 0, 'file quá lớn: vẫn thống kê class, không trích, ghi rõ'); }
  { const old = SF.LIMITS.max_files; SF.LIMITS.max_files = 3; const x = await SF.scan(mk(), r, entries, {}); SF.LIMITS.max_files = old; ok(x.serialized.warnings.some(function (w) { return /chỉ xử lý 3/.test(w); }), 'giới hạn số file + cảnh báo'); }
  { const x = await SF.scan(null, null, [], {}); ok(x.serialized.status === 'not_run', 'đầu vào xấu → not_run'); }
  { const x = await SF.scan(mk(), r, entries.filter(function (e) { return !/Data\//.test(e.name); }), {}); ok(x.serialized.status === 'no_serialized', 'không có SerializedFile → no_serialized'); }
  { const r2 = Object.assign({}, r, { unityfs: null }); const x = await SF.scan(mk(), r2, entries, {}); ok(x.serialized.summary.files === 17, 'không có kết quả UnityFS → bỏ node bundle'); }
  console.log(fail ? ('THẤT BẠI ' + fail + '/' + n) : ('Tất cả ' + n + ' kiểm tra đạt'));
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('LỖI TEST', e && e.stack || e); process.exit(2); });
function utf8(u8) { return new TextDecoder().decode(u8); }
