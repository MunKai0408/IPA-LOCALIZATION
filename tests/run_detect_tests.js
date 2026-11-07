// Chạy: node tests/run_detect_tests.js DIR_IPA   (Node ≥ 20: có File, DecompressionStream)
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['js/plist_parser.js', 'js/binary_reader.js', 'js/modules/detect_engine.js', 'js/ipa_reader.js'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
});
const NS = globalThis.IPAStudio, dir = process.argv[2] || '/tmp/fake_ipas';

// name -> kỳ vọng. status có thể là mảng các giá trị chấp nhận.
const EXPECT = {
  unity_il2cpp: { engine: 'Unity', variant: 'IL2CPP', status: ['confirmed'], branch: 'unity_il2cpp', version: '2021.3.16f1' },
  unity_mono: { engine: 'Unity', variant: 'Mono', status: ['confirmed'], branch: 'unity_mono', version: null },
  unity_conflict: { engine: 'Unity', variant: null, status: ['confirmed', 'probable'], branch: 'unity_unresolved' },
  unity_novariant: { engine: 'Unity', variant: null, status: ['confirmed', 'probable'], branch: 'unity_unresolved' },
  unity_weak_only: { engine: 'Unknown', status: ['unknown'], branch: 'generic' },
  unity_bad_magic: { engine: 'Unity', variant: 'IL2CPP', status: ['probable'], noteMatch: /không khớp/ },
  unreal: { engine: 'Unreal Engine', status: ['confirmed'], branch: 'unreal' },
  flutter: { engine: 'Flutter', status: ['confirmed'], branch: 'flutter' },
  react_native: { engine: 'React Native', variant: 'Hermes', status: ['confirmed'], branch: 'react_native' },
  godot: { engine: 'Godot', status: ['confirmed'], branch: 'godot', version: '4.2.1' },
  godot_one_medium_nomagic: { engine: 'Godot', status: ['possible'], branch: 'generic', noConfirmed: true },
  native_ios: { engine: 'Native iOS', status: ['probable', 'possible'], branch: ['native_ios', 'generic'], noConfirmed: true },
  native_weak_only: { engine: 'Unknown', status: ['unknown'], branch: 'generic' },
  unknown: { engine: 'Unknown', status: ['unknown'], branch: 'generic' },
  cocos_creator: { engine: 'Cocos2d-x / Cocos Creator', variant: 'Creator', status: ['confirmed'] },
  gamemaker: { engine: 'GameMaker', status: ['confirmed'] },
  defold: { engine: 'Defold', status: ['confirmed'] },
  solar2d: { engine: 'Solar2D / Corona', status: ['probable', 'confirmed'] },
  renpy: { engine: "Ren'Py", status: ['confirmed'] },
  rpgmaker_mv: { engine: 'RPG Maker MV/MZ', variant: 'MV', status: ['confirmed'] },
  rpgmaker_mz: { engine: 'RPG Maker MV/MZ', variant: 'MZ', status: ['confirmed', 'probable'] },
  multi_flutter_unity: { engine: ['Flutter', 'Unity'], status: ['confirmed'], hasAlt: true }
};

(async function () {
  let fail = 0, total = 0;
  const rows = [];
  for (const name of Object.keys(EXPECT)) {
    const ex = EXPECT[name], f = path.join(dir, name + '.ipa');
    const buf = fs.readFileSync(f); const file = new File([buf], name + '.ipa');
    const errs = [];
    let r;
    try { r = await NS.IpaReader.analyze(file, {}, { step() {}, progress() {}, log() {} }); }
    catch (e) { rows.push('FAIL ' + name + ' ném lỗi: ' + e.message); fail++; total++; continue; }
    const e = r.engine;
    const chk = function (cond, msg) { total++; if (!cond) errs.push(msg); };
    chk(!!e, 'thiếu r.engine');
    if (e) {
      const engs = [].concat(ex.engine);
      chk(engs.indexOf(e.engine) >= 0, 'engine=' + e.engine);
      if ('variant' in ex) chk(e.variant === ex.variant, 'variant=' + e.variant);
      chk(ex.status.indexOf(e.status) >= 0, 'status=' + e.status);
      if (ex.branch) chk([].concat(ex.branch).indexOf(e.analysis_branch) >= 0, 'branch=' + e.analysis_branch);
      if ('version' in ex) chk(e.version === ex.version, 'version=' + e.version);
      if (ex.noConfirmed) chk(e.status !== 'confirmed', 'không được confirmed');
      if (ex.noteMatch) chk(e.notes.some(function (n) { return ex.noteMatch.test(n); }), 'thiếu ghi chú magic không khớp');
      if (ex.hasAlt) chk(e.alternatives.length >= 1, 'thiếu alternatives');
      // bất biến chung
      chk(e.confidence >= 0 && e.confidence <= 1, 'confidence ngoài 0..1');
      chk(e.status !== 'confirmed' || (e.evidence.length >= 2 && e.evidence.some(function (x) { return x.tier === 'strong'; })), 'confirmed thiếu bằng chứng');
      chk(e.evidence.length !== 1 || e.evidence[0].tier !== 'weak' || e.status !== 'confirmed', 'một dấu hiệu yếu thành confirmed');
      ['engine', 'variant', 'confidence', 'evidence', 'missing_indicators', 'version', 'analysis_branch', 'status', 'notes'].forEach(function (k) { chk(k in e, 'thiếu khóa ' + k); });
    }
    if (errs.length) { fail++; rows.push('FAIL ' + name + ': ' + errs.join('; ')); }
    else rows.push('ok   ' + name.padEnd(26) + e.engine + (e.variant ? ' ' + e.variant : '') + ' | ' + e.status + ' ' + e.confidence + ' | ' + e.analysis_branch + (e.version ? ' | v' + e.version : ''));
  }
  console.log(rows.join('\n'));
  console.log('\n' + (fail ? fail + ' case THẤT BẠI' : 'TẤT CẢ ĐẠT') + ' (' + total + ' kiểm tra)');
  process.exit(fail ? 1 : 0);
})();
