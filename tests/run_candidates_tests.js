// Chạy: python3 tests/make_candidates_ipas.py DIR && node tests/run_candidates_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 6.1: hệ ứng viên chứa text (mọi engine). Dữ liệu GIẢ LẬP; chỉ chứng minh logic, KHÔNG chứng minh độ chính xác trên game thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'modules/unity_fs', 'modules/serialized_file', 'modules/font_metrics', 'modules/tmp_font', 'modules/candidates', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, C = NS.Candidates, dir = process.argv[2] || '/tmp/fake_ipas';
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const run = async function (name) {
  const steps = [];
  const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa');
  const r = await NS.IpaReader.analyze(file, { hashMode: 'auto' }, { step: function (id, st, msg) { steps.push([id, st, msg]); }, progress() {}, log() {}, isCancelled: undefined });
  r._steps = steps; return r;
};
const kinds = function (r) { return r.candidates.candidates.map(function (c) { return c.kind; }); };
const find = function (r, k) { return r.candidates.candidates.find(function (c) { return c.kind === k; }); };

(async function () {
  /* 1. khung: đăng ký, chuẩn hóa, bất biến */
  ok(C.list().indexOf('generic.path') >= 0 && C.list().indexOf('unity.serialized') >= 0, 'đã đăng ký 2 detector mặc định');
  let threw = false; try { C.register({ id: 1 }); } catch (_) { threw = true; } ok(threw, 'register detector sai → ném lỗi');
  const w = [];
  const a = C.normalize({ engine: 'x', kind: 'k', evidence: 'STATIC-OK', ui_status: 'DRIVES_UI', paths: [] }, w);
  ok(a.evidence === 'HYPOTHESIS' && a.ui_status === 'UNKNOWN' && w.length === 2, 'STATIC-OK thiếu evidence_note → HYPOTHESIS; DRIVES_UI không bằng chứng → UNKNOWN');
  const b = C.normalize({ engine: 'x', kind: 'k', evidence: 'STATIC-OK', evidence_note: 'key khớp 100%', ui_status: 'DRIVES_UI', paths: [] }, []);
  ok(b.evidence === 'STATIC-OK' && b.ui_status === 'DRIVES_UI', 'STATIC-OK có evidence_note được giữ');
  const bad = C.normalize({ level: 'L9', evidence: 'RUNTIME-OK', ui_status: 'MAYBE', writable: 'yes' }, []);
  ok(bad.level === 'L1' && bad.evidence === 'HYPOTHESIS' && bad.ui_status === 'UNKNOWN' && bad.writable === 'unknown', 'giá trị lạ → mặc định an toàn; trang không tự gán RUNTIME-OK');
  const many = C.normalize({ paths: Array.from({ length: 80 }, function (_, i) { return { path: 'p' + i }; }) }, []);
  ok(many.paths.length === 50 && many.paths_total === 80 && many.paths_truncated, 'cắt paths ≤ 50, ghi paths_total');
  ok(C.normalize({ kind: 'a', paths: [{ path: 'x' }] }, []).id === C.normalize({ kind: 'a', paths: [{ path: 'x' }] }, []).id, 'id ổn định');
  ok(C.detectLang('en.json') === 'en' && C.detectLang('lang_zh-Hans.csv') === 'zh' && C.detectLang('readme.txt') === null, 'detectLang');
  const bn = await C.run(null, {}); ok(bn.status === 'error', 'đầu vào null → status error, không ném');

  /* 2. iOS */
  let r = await run('cand_ios'), cr = r.candidates;
  ok(cr && cr.schema === 'candidates/1' && cr.status === 'ok', 'cand_ios: status ok');
  ok(r._steps.some(function (s) { return s[0] === 'candidates' && s[1] === 'done'; }), 'bước candidates = done');
  let s = find(r, 'ios.strings'); ok(s && s.languages.map(function (l) { return l.code; }).sort().join() === 'en,vi,zh-Hans', 'ios.strings: 3 ngôn ngữ từ lproj');
  ok(s.level === 'L1' && s.evidence === 'HYPOTHESIS' && s.ui_status === 'UNKNOWN', 'ios.strings: HYPOTHESIS/UNKNOWN');
  ok(s.risks.some(function (x) { return /metadata App Store/.test(x); }), 'ios.strings: cảnh báo lproj có thể là metadata');
  ok(find(r, 'ios.infoplist_strings') && find(r, 'ios.infoplist_strings').rank > s.rank, 'InfoPlist.strings xếp sau Localizable');
  ok(cr.gate0.done === false && cr.summary.by_evidence.HYPOTHESIS === cr.summary.total, 'Cổng 0 chưa chạy; mọi ứng viên HYPOTHESIS');
  ok(s.paths.every(function (p) { return p.path.indexOf('Payload/Game.app/') === 0; }), 'path giữ đủ tiền tố zip (dùng cho patch plan)');

  /* 3. lproj-only */
  r = await run('cand_lproj_only'); s = find(r, 'ios.lproj_only');
  ok(s && s.languages.length === 2 && s.risks.length === 1, 'lproj_only: 2 ngôn ngữ + cảnh báo metadata'); ok(!find(r, 'ios.strings'), 'lproj_only: không có ios.strings');

  /* 4. RPG Maker */
  r = await run('cand_rpg'); s = find(r, 'rpgmaker.data_json');
  ok(s && s.paths_total === 4 && s.engine === 'rpgmaker', 'RPG Maker: 4 file data/*.json'); ok(!kinds(r).some(function (k) { return k === 'generic.named_table'; }), 'RPG: file đã nhận không bị đếm lại ở detector tên');

  /* 5. Godot */
  r = await run('cand_godot'); s = find(r, 'godot.translation');
  ok(s && s.languages.length === 2 && s.paths_total === 2, 'Godot: 2 bản dịch, 2 ngôn ngữ');

  /* 6. Unreal */
  r = await run('cand_unreal'); s = find(r, 'unreal.locres');
  ok(s && s.languages.map(function (l) { return l.code; }).sort().join() === 'en,zh-Hans', 'Unreal: culture từ thư mục cha');
  ok(!find(r, 'unreal.pak_container'), 'Unreal có locres lộ thiên → không báo pak_container');
  r = await run('cand_unreal_pak'); s = find(r, 'unreal.pak_container');
  ok(s && s.level === 'L2' && s.paths_total === 2 && /10\.1/.test(s.notes[0]), 'Unreal chỉ pak → pak_container L2, trỏ tới 10.1');

  /* 7. engine lạ: theo tên, nhóm theo thư mục; lọc nhiễu */
  r = await run('cand_generic');
  const ml = find(r, 'generic.multilang_files'); ok(ml && ml.languages.length === 2 && ml.paths_total === 2, 'generic: Data/Localization/{en,zh}.json → multilang_files');
  ok(!r.candidates.candidates.some(function (c) { return c.paths.some(function (p) { return /Frameworks\//.test(p.path) || /a\.png$/.test(p.path) || /empty_lang/.test(p.path); }); }), 'generic: bỏ Frameworks/, ảnh, file rỗng');
  ok(r.candidates.candidates.some(function (c) { return c.paths.some(function (p) { return /dialog\.csv$/.test(p.path); }); }), 'generic: dialog.csv được liệt kê');
  ok(ml.rank === 1 && ml.suspected_secondary === false && r.candidates.candidates.filter(function (c) { return c.id !== ml.id; }).every(function (c) { return c.suspected_secondary; }), 'xếp hạng: nhiều ngôn ngữ nhất = hạng 1; hệ ≤1 ngôn ngữ bị nghi hệ phụ');
  ok(ml.notes[0].indexOf('không phải bằng chứng') > 0, 'generic: ghi rõ tên file không phải bằng chứng');

  /* 8. không có ứng viên */
  r = await run('cand_none'); ok(r.candidates.status === 'no_candidates' && r.candidates.candidates.length === 0 && r.candidates.summary.total === 0, 'cand_none: no_candidates');
  ok(r._steps.some(function (s2) { return s2[0] === 'candidates' && s2[1] === 'done'; }), 'cand_none: bước vẫn done, không lỗi');

  /* 9. Unity bundle Localization package (theo tên) */
  r = await run('cand_unity_bundles'); s = find(r, 'unity.localization_package');
  ok(s && s.level === 'L2' && s.paths_total === 2 && s.evidence === 'HYPOTHESIS', 'Unity: bundle localization-stringtables-* → L2 HYPOTHESIS');

  /* 10. file unsafe / ngoài .app không tạo ứng viên */
  r = await run('cand_unsafe'); ok(!r.candidates.candidates.some(function (c) { return c.paths.some(function (p) { return /evil/.test(p.path); }); }), 'unsafe path bị bỏ qua');

  /* 11. Unity từ SerializedFile (stub dữ liệu thuần) */
  const stub = { appRoot: 'Payload/G.app/', engine: { engine: 'Unity', variant: 'IL2CPP', status: 'confirmed' }, entries: [{ path: 'Payload/G.app/Data/resources.assets', size: 10, dir: false }],
    serialized: { summary: { files: 1 }, mono_classes: { Localize: 40, LocalizationManager: 1, TextMeshProUGUI: 90, LocalizeStringEvent: 3, Foo: 2 },
      text_assets: [{ name: 'Localization', source: 'resources.assets', path_id: 7, size: 1000 }, { name: 'lang_en', source: 'resources.assets', path_id: 8, size: 900 }, { name: 'config', source: 'resources.assets', path_id: 9, size: 5 }] } };
  const ur = await C.run(stub, {}); const i2 = ur.candidates.find(function (c) { return c.kind === 'unity.i2'; });
  ok(i2 && i2.componentRefs === 41 && i2.ui_status === 'UNKNOWN' && i2.detail.classes.Localize === 40, 'Unity I2: tổng component = 41, UNKNOWN');
  const pk = ur.candidates.find(function (c) { return c.kind === 'unity.localization_package'; }); ok(pk && pk.componentRefs === 3, 'Unity package: 3 component');
  const ta = ur.candidates.find(function (c) { return c.kind === 'unity.textasset'; }); ok(ta && ta.paths_total === 2 && !ta.paths.some(function (p) { return /config/.test(p.path); }), 'Unity TextAsset: chỉ tên giống bảng text');
  ok(ur.candidates.every(function (c) { return !/TextMeshPro|Foo/.test(JSON.stringify(c.detail || {})); }), 'class không liên quan không lọt vào detail');

  /* 12. detector lỗi không làm sập cả bước */
  C.register({ id: 'test.boom', run: function () { throw new Error('boom'); } });
  const ber = await C.run(stub, {}); ok(ber.status === 'ok' && ber.detector_errors.length === 1 && ber.detector_errors[0].id === 'test.boom', 'detector ném lỗi → ghi detector_errors, kết quả còn lại giữ nguyên');
  ok(ber.warnings.some(function (x) { return /detector lỗi/.test(x); }), 'có cảnh báo detector lỗi');
  C.unregister('test.boom');
  C.register({ id: 'test.cancel', run: function () { const e = new Error('c'); e.code = 'CANCELLED'; throw e; } });
  let cancelled = false; try { await C.run(stub, {}); } catch (e) { cancelled = e.code === 'CANCELLED'; } ok(cancelled, 'CANCELLED được ném lại, không nuốt');
  C.unregister('test.cancel');
  C.register({ id: 'test.hook', run: function (ctx) { return [{ engine: 'custom', kind: 'custom.table', key: 'k', level: 'L3', paths: [{ path: ctx.files[0].path }], languages: [{ code: 'en', slot: 'en' }, { code: 'zh', slot: 'zh' }, { code: 'ja', slot: 'ja' }] }]; } });
  const hr = await C.run(stub, {}); ok(hr.candidates[0].kind === 'custom.table' && hr.candidates[0].rank === 1, 'detector đăng ký thêm tham gia xếp hạng (3 ngôn ngữ → hạng 1)');
  C.unregister('test.hook');
  let isc = false; try { await C.run(stub, { isCancelled: function () { return true; } }); } catch (e) { isc = e.code === 'CANCELLED'; } ok(isc, 'isCancelled=true → CANCELLED');

  /* 13. toIndex / toReportFields thuần JSON */
  const idx = C.toIndex(ur); ok(JSON.stringify(idx) === JSON.stringify(ur) && idx !== ur, 'toIndex = bản sao JSON');
  const rf = C.toReportFields(ur); ok(rf.candidates_total === ur.summary.total && rf.candidates_gate0_done === false, 'toReportFields');
  ok(C.toReportFields({ status: 'not_run' }) === null, 'toReportFields not_run → null');
  ok(JSON.stringify(ur).length < 200000, 'kích thước kết quả nhỏ');

  console.log(fail ? ('THẤT BẠI: ' + fail + '/' + n) : ('TẤT CẢ ĐẠT (' + n + ' kiểm tra)'));
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('LỖI KHÔNG BẮT ĐƯỢC', e); process.exit(2); });
