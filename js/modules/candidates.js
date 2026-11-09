/* candidates.js – SUB-PHASE 6.1: khung "hệ ứng viên chứa text" cho MỌI engine.
   Thuần dữ liệu (không I/O): chỉ dùng danh sách entry của IPA (+ kết quả SerializedFile nếu có).
   Mục tiêu: liệt kê MỌI nơi có thể chứa text hiển thị, xếp hạng, và gắn nhãn bằng chứng.
   QUY TẮC CỨNG (prompt V4.1 nguyên tắc 11–12):
   - TÊN FILE KHÔNG PHẢI BẰNG CHỨNG. Ở 6.1 mọi ứng viên là evidence='HYPOTHESIS', ui_status='UNKNOWN'.
   - evidence='STATIC-OK' chỉ được đặt khi có evidence_note (cách kiểm); ngược lại bị hạ về HYPOTHESIS.
   - Không có Cổng 0 ở 6.1: result.gate0.done = false. Cổng 0 theo engine làm ở 7.x/9.2.
   - Detector lỗi KHÔNG làm sập detector khác (ghi vào detector_errors).
   Detector mới đăng ký bằng NS.Candidates.register({ id, run(ctx) }) → mảng ứng viên thô. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const SCHEMA = 'candidates/1';
  const LIMITS = { max_candidates: 500, max_paths_per_candidate: 50, max_entries: 300000 };
  const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
  const EVIDENCE = ['STATIC-OK', 'HYPOTHESIS'];
  const UI_STATUS = ['DRIVES_UI', 'UNUSED', 'UNKNOWN'];
  const LIMITATIONS = [
    '6.1 chỉ dựa vào đường dẫn/tên file và danh sách class Unity đã có; KHÔNG đọc nội dung bảng text (số term để null).',
    'Chưa có Cổng 0 (bằng chứng tĩnh game có dùng bảng này để hiển thị không): mọi ứng viên là HYPOTHESIS/UNKNOWN.',
    'Chỉ canary chạy trên thiết bị mới chứng minh hệ nào hiển thị ([RUNTIME-OK]); trang không tự gán nhãn này.'
  ];

  /* ---------- tiện ích ---------- */
  const LANG_TOKENS = {
    en: 'en', eng: 'en', english: 'en', zh: 'zh', chs: 'zh-Hans', cht: 'zh-Hant', cn: 'zh-Hans', tw: 'zh-Hant', chinese: 'zh',
    ja: 'ja', jp: 'ja', jpn: 'ja', japanese: 'ja', ko: 'ko', kr: 'ko', kor: 'ko', korean: 'ko',
    fr: 'fr', de: 'de', es: 'es', ru: 'ru', pt: 'pt', it: 'it', vi: 'vi', vn: 'vi', th: 'th', id: 'id', tr: 'tr', ar: 'ar'
  };
  const LOC_RE = /(lang|locale|locali[sz]|i18n|l10n|string|text|dialog|message|msg|translat|subtitle|script)/i;
  const TABLE_EXT = { json: 1, csv: 1, tsv: 1, xml: 1, txt: 1, po: 1, pot: 1, properties: 1, lua: 1, bytes: 1, plist: 1, yaml: 1, yml: 1, ini: 1, dat: 1, bin: 1, tsx: 0 };
  const SKIP_DIR_RE = /(^|\/)(frameworks|_codesignature|sc_info|plugins|watch)\//i;

  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  function baseName(p) { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }
  function dirName(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function extOf(n) { const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); }
  function stem(n) { const i = n.lastIndexOf('.'); return i <= 0 ? n : n.slice(0, i); }
  function detectLang(name) {
    const toks = stem(name).toLowerCase().split(/[^a-z]+/).filter(Boolean);
    for (let i = 0; i < toks.length; i++) if (LANG_TOKENS[toks[i]]) return LANG_TOKENS[toks[i]];
    return null;
  }
  function pushUnique(arr, v) { if (arr.indexOf(v) < 0) arr.push(v); }

  /* ---------- đăng ký detector ---------- */
  const detectors = [];
  function register(d) {
    if (!d || typeof d.id !== 'string' || typeof d.run !== 'function') throw new Error('Detector phải có id (string) và run(ctx)');
    const i = detectors.findIndex(function (x) { return x.id === d.id; });
    if (i >= 0) detectors[i] = d; else detectors.push(d);
  }
  function unregister(id) { const i = detectors.findIndex(function (x) { return x.id === id; }); if (i >= 0) detectors.splice(i, 1); }
  function list() { return detectors.map(function (d) { return d.id; }); }

  /* ---------- chuẩn hóa + bất biến ---------- */
  function normalize(c, warnings) {
    const o = {
      id: '', engine: String(c.engine || 'generic'), kind: String(c.kind || 'unknown'),
      level: LEVELS.indexOf(c.level) >= 0 ? c.level : 'L1',
      paths: [], paths_total: 0, paths_truncated: false,
      languages: [], componentRefs: (typeof c.componentRefs === 'number') ? c.componentRefs : null,
      ui_status: UI_STATUS.indexOf(c.ui_status) >= 0 ? c.ui_status : 'UNKNOWN',
      evidence: EVIDENCE.indexOf(c.evidence) >= 0 ? c.evidence : 'HYPOTHESIS',
      evidence_note: typeof c.evidence_note === 'string' ? c.evidence_note : '',
      writable: (c.writable === true || c.writable === false) ? c.writable : 'unknown',
      risks: Array.isArray(c.risks) ? c.risks.slice(0, 20).map(String) : [],
      notes: Array.isArray(c.notes) ? c.notes.slice(0, 20).map(String) : [],
      detail: c.detail && typeof c.detail === 'object' ? c.detail : null,
      rank: 0, suspected_secondary: false
    };
    const ps = Array.isArray(c.paths) ? c.paths : [];
    o.paths_total = ps.length;
    o.paths = ps.slice(0, LIMITS.max_paths_per_candidate).map(function (p) { return { path: String(p.path), size: typeof p.size === 'number' ? p.size : null, lang: p.lang || null }; });
    o.paths_truncated = ps.length > o.paths.length;
    o.languages = (Array.isArray(c.languages) ? c.languages : []).map(function (l) { return { code: l.code == null ? null : String(l.code), slot: l.slot == null ? null : String(l.slot), termCount: typeof l.termCount === 'number' ? l.termCount : null }; });
    // BẤT BIẾN: STATIC-OK cần evidence_note; DRIVES_UI/UNUSED cần bằng chứng STATIC-OK.
    if (o.evidence === 'STATIC-OK' && !o.evidence_note.trim()) { o.evidence = 'HYPOTHESIS'; if (warnings) warnings.push('Ứng viên ' + o.kind + ': STATIC-OK thiếu evidence_note → hạ về HYPOTHESIS'); }
    if (o.evidence !== 'STATIC-OK' && o.ui_status !== 'UNKNOWN') { if (warnings) warnings.push('Ứng viên ' + o.kind + ': ui_status ' + o.ui_status + ' không có bằng chứng tĩnh → đặt UNKNOWN'); o.ui_status = 'UNKNOWN'; }
    o.id = o.kind + ':' + fnv(o.kind + '|' + (c.key || '') + '|' + ps.map(function (p) { return p.path; }).sort().join('|'));
    return o;
  }
  function langCount(c) { return c.languages.length; }
  function termTotal(c) { return c.languages.reduce(function (s, l) { return s + (l.termCount || 0); }, 0); }
  function rankAll(list) {
    list.sort(function (a, b) {
      return (langCount(b) - langCount(a)) || (termTotal(b) - termTotal(a)) || ((b.componentRefs || 0) - (a.componentRefs || 0)) ||
             (b.paths_total - a.paths_total) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
    const multi = list.some(function (c) { return langCount(c) >= 2; });
    list.forEach(function (c, i) { c.rank = i + 1; c.suspected_secondary = multi && langCount(c) <= 1; });
  }

  /* ---------- DETECTOR 1: theo đường dẫn (mọi engine) ---------- */
  function relPath(ctx, p) { return ctx.appRoot && p.indexOf(ctx.appRoot) === 0 ? p.slice(ctx.appRoot.length) : p; }

  function detectByPath(ctx) {
    const out = [];
    const files = ctx.files; // [{path, rel, size}]
    const used = Object.create(null);

    /* a) iOS *.lproj – nhóm theo bảng (Localizable, ...) */
    const lprojTables = Object.create(null); let lprojDirs = {};
    files.forEach(function (f) {
      const d = /(^|\/)([^/]+)\.lproj\//i.exec(f.rel); if (!d) return;
      lprojDirs[d[2]] = 1;
      const m = /(^|\/)([^/]+)\.lproj\/([^/]+)$/i.exec(f.rel); if (!m) return; // chỉ file nằm trực tiếp trong *.lproj
      const file = m[3], ext = extOf(file);
      if (ext !== 'strings' && ext !== 'stringsdict' && ext !== 'xcstrings') return;
      used[f.path] = 1;
      const key = stem(file) + '.' + ext;
      (lprojTables[key] = lprojTables[key] || []).push({ path: f.path, size: f.size, lang: m[2] });
    });
    Object.keys(lprojTables).sort().forEach(function (key) {
      const ps = lprojTables[key], info = /^InfoPlist\.strings$/i.test(key);
      out.push({ engine: 'ios', kind: info ? 'ios.infoplist_strings' : 'ios.strings', key: key, level: 'L1', paths: ps,
        languages: ps.map(function (p) { return { code: p.lang, slot: p.lang + '.lproj', termCount: null }; }),
        notes: [info ? 'InfoPlist.strings thường chỉ chứa tên app/mô tả quyền, hiếm khi là text game.' : 'Bảng .strings theo ngôn ngữ; số term chưa đọc (7.1).'],
        risks: ['*.lproj có thể chỉ là metadata App Store, không phải ngôn ngữ trong game: cần Cổng 0 (có dùng NSLocalizedString không).'] });
    });
    const hadTables = Object.keys(lprojTables).length > 0;
    const lprojNames = Object.keys(lprojDirs).filter(function (n) { return n !== 'Base'; });
    if (!hadTables && lprojNames.length) {
      out.push({ engine: 'ios', kind: 'ios.lproj_only', key: 'lproj', level: 'L1', paths: lprojNames.map(function (n) { return { path: ctx.appRoot + n + '.lproj/', size: null, lang: n }; }),
        languages: lprojNames.map(function (n) { return { code: n, slot: n + '.lproj', termCount: null }; }),
        notes: ['Có thư mục *.lproj nhưng không có file .strings/.stringsdict/.xcstrings.'],
        risks: ['Nhiều *.lproj chỉ là metadata iOS của App Store, không phải ngôn ngữ trong game.'] });
    }

    /* b) RPG Maker MV/MZ */
    const rpg = [];
    files.forEach(function (f) {
      if (/(^|\/)(www\/)?data\/(System|Actors|Items|Skills|Weapons|Armors|Enemies|States|Classes|CommonEvents|Troops|MapInfos|Map\d{3})\.json$/i.test(f.rel)) { rpg.push({ path: f.path, size: f.size }); used[f.path] = 1; }
    });
    if (rpg.length >= 3 && rpg.some(function (p) { return /System\.json$/i.test(p.path); })) {
      out.push({ engine: 'rpgmaker', kind: 'rpgmaker.data_json', key: 'data', level: 'L1', paths: rpg, languages: [],
        notes: ['Cấu trúc data/*.json của RPG Maker (có System.json). Thường một ngôn ngữ; text nằm trong trường name/description/message.'],
        risks: ['Plugin js/plugins.js có thể chứa chuỗi cứng riêng.'] });
    }

    /* c) Godot */
    const godot = [];
    files.forEach(function (f) { if (/\.(translation|po|pot)$/i.test(f.rel)) { godot.push({ path: f.path, size: f.size, lang: detectLang(baseName(f.rel)) }); used[f.path] = 1; } });
    if (godot.length) {
      const langs = []; godot.forEach(function (p) { if (p.lang) pushUnique(langs, p.lang); });
      out.push({ engine: 'godot', kind: 'godot.translation', key: 'translation', level: 'L1', paths: godot,
        languages: langs.map(function (l) { return { code: l, slot: l, termCount: null }; }),
        notes: ['File bản dịch Godot (*.translation/*.po); ngôn ngữ suy từ tên file (chưa đọc nội dung).'] });
    }

    /* d) Unreal .locres */
    const loc = Object.create(null);
    files.forEach(function (f) {
      if (!/\.locres$/i.test(f.rel)) return; used[f.path] = 1;
      const parts = f.rel.split('/'); const cult = parts.length >= 2 ? parts[parts.length - 2] : null;
      (loc[dirName(dirName(f.path))] = loc[dirName(dirName(f.path))] || []).push({ path: f.path, size: f.size, lang: cult });
    });
    Object.keys(loc).sort().forEach(function (k) {
      const ps = loc[k], langs = []; ps.forEach(function (p) { if (p.lang) pushUnique(langs, p.lang); });
      out.push({ engine: 'unreal', kind: 'unreal.locres', key: k, level: 'L1', paths: ps,
        languages: langs.map(function (l) { return { code: l, slot: l, termCount: null }; }),
        notes: ['Unreal *.locres theo culture (thư mục cha của file là culture).'] });
    });
    const knownPak = Object.create(null);
    ((ctx.pakHeads && ctx.pakHeads.pak_files) || []).forEach(function (p) { if (p.format_guess === 'heaps_pak' || p.format_guess === 'heaps_pak?' || p.format_guess === 'godot_pck') knownPak[p.zip_path] = p.format_guess; });
    const heapsPaks = files.filter(function (f) { return knownPak[f.path] === 'heaps_pak' || knownPak[f.path] === 'heaps_pak?'; });
    if (heapsPaks.length) out.push({ engine: 'heaps', kind: 'heaps.pak', key: 'heaps_pak', level: 'L2', paths: heapsPaks.map(function (f) { return { path: f.path, size: f.size }; }), languages: [],
      notes: ['Magic "PAK" ở đầu file = pak kiểu Heaps (không phải Unreal). Text/font bên trong được trích ở bước text_extract nếu đọc được cây.'], risks: ['Bố cục pak là giả thuyết; xem texts_index.json.'] });
    const paks = files.filter(function (f) { return (/\.pak$/i.test(f.rel) && !knownPak[f.path]) || /\.(utoc|ucas)$/i.test(f.rel); });
    if (paks.length && !Object.keys(loc).length) {
      out.push({ engine: 'unreal', kind: 'unreal.pak_container', key: 'paks', level: 'L2', paths: paks.map(function (f) { return { path: f.path, size: f.size }; }), languages: [],
        notes: ['Có pak/utoc/ucas nhưng không thấy *.locres lộ thiên: locres có thể nằm TRONG pak (chưa đọc, 10.1).'],
        risks: ['Pak có thể mã hóa/nén; hiện chỉ liệt kê.'] });
    }

    /* e) Dò theo tên: bảng text/ngôn ngữ chung (json/csv/xml/txt/lua/...) – nhóm theo thư mục */
    const groups = Object.create(null);
    files.forEach(function (f) {
      if (used[f.path] || SKIP_DIR_RE.test(f.rel) || !f.size) return;
      const name = baseName(f.rel), ext = extOf(name); if (!TABLE_EXT[ext]) return;
      const dir = dirName(f.rel), lang = detectLang(name);
      const kwName = LOC_RE.test(stem(name)), kwDir = LOC_RE.test(dir), exactLang = !!lang && /^[a-z]{2,3}([-_][a-z]{2,4})?$/i.test(stem(name));
      if (!(kwName || kwDir || exactLang)) return;
      if (!lang && !kwName && !kwDir) return;
      (groups[dir] = groups[dir] || []).push({ path: f.path, size: f.size, lang: lang });
    });
    Object.keys(groups).sort().forEach(function (dir) {
      const ps = groups[dir], langs = []; ps.forEach(function (p) { if (p.lang) pushUnique(langs, p.lang); });
      out.push({ engine: 'generic', kind: langs.length >= 2 ? 'generic.multilang_files' : 'generic.named_table', key: dir, level: 'L1', paths: ps,
        languages: langs.map(function (l) { return { code: l, slot: l, termCount: null }; }),
        notes: ['Chọn theo TÊN file/thư mục (không phải bằng chứng). Cần đọc nội dung + Cổng 0.'],
        risks: ['Tên giống bảng text chưa chứng minh game đọc nó để hiển thị.'] });
    });
    return out;
  }

  /* ---------- DETECTOR 2: Unity (từ SerializedFile + tên bundle) ---------- */
  function detectUnity(ctx) {
    const out = [], sr = ctx.ipa.serialized;
    const bundles = ctx.files.filter(function (f) { return /localization-(stringtables|assettables)-[^/]*\.bundle$/i.test(f.rel); });
    if (bundles.length) {
      out.push({ engine: 'unity', kind: 'unity.localization_package', key: 'bundles', level: 'L2', paths: bundles.map(function (f) { return { path: f.path, size: f.size }; }), languages: [],
        notes: ['Tên bundle giống Unity Localization package + Addressables; nội dung StringTable chưa đọc (9.1).'], risks: ['Bundle có CRC/hash trong catalog Addressables.'] });
    }
    if (!sr || !sr.summary) return out;
    const classes = sr.mono_classes || {}, i2 = {}, pkg = {}; let i2n = 0, pkgn = 0;
    Object.keys(classes).forEach(function (k) {
      if (/^(I2|LanguageSourceAsset|LanguageSource$|Localize$|LocalizationManager|I2Languages)/i.test(k) || /^Localize$/i.test(k)) { i2[k] = classes[k]; i2n += classes[k]; }
      else if (/(StringTable|LocalizedString|LocalizeStringEvent|SharedTableData|LocalizationSettings)/i.test(k)) { pkg[k] = classes[k]; pkgn += classes[k]; }
    });
    if (Object.keys(i2).length) out.push({ engine: 'unity', kind: 'unity.i2', key: 'i2', level: 'L2', paths: [], componentRefs: i2n, languages: [],
      detail: { classes: i2 }, notes: ['Có script kiểu I2 Localization trong SerializedFile; bảng I2Languages chưa đọc (9.1) nên chưa biết số ngôn ngữ/term.'],
      risks: ['TMP/Text m_text trong scene có component Localize bị ghi đè lúc chạy → chỉ là PLACEHOLDER.'] });
    if (Object.keys(pkg).length) out.push({ engine: 'unity', kind: 'unity.localization_package', key: 'pkg', level: 'L2', paths: [], componentRefs: pkgn, languages: [],
      detail: { classes: pkg }, notes: ['Có script kiểu Unity Localization package; StringTable chưa đọc (9.1).'] });
    const tas = (sr.text_assets || []).filter(function (t) { return LOC_RE.test(t.name || ''); });
    if (tas.length) {
      const langs = []; tas.forEach(function (t) { const l = detectLang(t.name || ''); if (l) pushUnique(langs, l); });
      out.push({ engine: 'unity', kind: 'unity.textasset', key: 'textasset', level: 'L2',
        paths: tas.map(function (t) { return { path: (t.source || '?') + '#' + (t.name || '?') + '@' + t.path_id, size: t.size, lang: detectLang(t.name || '') }; }),
        languages: langs.map(function (l) { return { code: l, slot: l, termCount: null }; }),
        notes: ['TextAsset có tên giống bảng text (' + tas.length + ' cái); chọn theo TÊN, chưa phải bằng chứng.'] });
    }
    return out;
  }

  register({ id: 'generic.path', run: detectByPath });
  register({ id: 'unity.serialized', run: detectUnity });

  /* ---------- chạy ---------- */
  function emptyResult() {
    return { schema: SCHEMA, sub_phase: '6.1', status: 'not_run', reason: '', engine: null, candidates: [], detectors_run: [], detector_errors: [],
      gate0: { done: false, note: 'Cổng 0 (bằng chứng tĩnh) chưa triển khai ở 6.1; mọi ứng viên là HYPOTHESIS/UNKNOWN.' },
      summary: null, limitations: LIMITATIONS.slice(), warnings: [] };
  }
  async function run(ipa, opts) {
    opts = opts || {}; const res = emptyResult();
    if (!ipa || !Array.isArray(ipa.entries)) { res.status = 'error'; res.reason = 'Thiếu danh sách entry của IPA'; return res; }
    res.engine = ipa.engine ? { name: ipa.engine.engine || null, variant: ipa.engine.variant || null, status: ipa.engine.status || null } : null;
    const appRoot = ipa.appRoot || '';
    let files = [];
    if (ipa.entries.length > LIMITS.max_entries) { res.warnings.push('Quá ' + LIMITS.max_entries + ' entry, chỉ xét phần đầu'); }
    ipa.entries.slice(0, LIMITS.max_entries).forEach(function (e) {
      if (e.dir || e.unsafe) return;
      if (appRoot && e.path.indexOf(appRoot) !== 0) return; // chỉ trong .app đang phân tích
      files.push({ path: e.path, rel: relPath({ appRoot: appRoot }, e.path), size: e.size });
    });
    const ctx = { ipa: ipa, appRoot: appRoot, files: files, engine: res.engine, pakHeads: ipa.pak_heads || null };
    let raw = [];
    for (let i = 0; i < detectors.length; i++) {
      if (opts.isCancelled && opts.isCancelled()) { const e = new Error('Đã hủy'); e.code = 'CANCELLED'; throw e; }
      const d = detectors[i];
      try { const r = await d.run(ctx); (r || []).forEach(function (c) { raw.push(c); }); res.detectors_run.push(d.id); }
      catch (e) { if (e && e.code === 'CANCELLED') throw e; res.detector_errors.push({ id: d.id, message: String((e && e.message) || e) }); }
    }
    if (raw.length > LIMITS.max_candidates) { res.warnings.push('Quá ' + LIMITS.max_candidates + ' ứng viên, bỏ phần còn lại'); raw = raw.slice(0, LIMITS.max_candidates); }
    const list = raw.map(function (c) { return normalize(c, res.warnings); });
    rankAll(list); res.candidates = list;
    const by = function (k) { const m = {}; list.forEach(function (c) { m[c[k]] = (m[c[k]] || 0) + 1; }); return m; };
    res.summary = { total: list.length, by_engine: by('engine'), by_kind: by('kind'), by_level: by('level'), by_ui_status: by('ui_status'), by_evidence: by('evidence'),
      with_languages: list.filter(function (c) { return c.languages.length > 0; }).length, suspected_secondary: list.filter(function (c) { return c.suspected_secondary; }).length };
    if (res.detector_errors.length) res.warnings.push(res.detector_errors.length + ' detector lỗi (xem detector_errors); kết quả có thể thiếu');
    if (!list.length) { res.status = 'no_candidates'; res.reason = 'Không thấy ứng viên chứa text theo đường dẫn/class; thử bộ dò chuỗi chung (6.2) hoặc canary.'; }
    else { res.status = 'ok'; res.reason = list.length + ' ứng viên (HYPOTHESIS/UNKNOWN, chưa qua Cổng 0); hạng 1: ' + list[0].kind; }
    return res;
  }

  function toIndex(r) { return r ? JSON.parse(JSON.stringify(r)) : null; }
  function toReportFields(r) {
    if (!r || r.status === 'not_run' || !r.summary) return null;
    return { candidates_status: r.status, candidates_total: r.summary.total, candidates_top: r.candidates.length ? r.candidates[0].kind : null, candidates_gate0_done: false };
  }

  NS.Candidates = { SCHEMA: SCHEMA, LIMITS: LIMITS, LEVELS: LEVELS, EVIDENCE: EVIDENCE, UI_STATUS: UI_STATUS, LIMITATIONS: LIMITATIONS,
    register: register, unregister: unregister, list: list, normalize: normalize, rankAll: rankAll, detectLang: detectLang, run: run, toIndex: toIndex, toReportFields: toReportFields };
})(typeof window !== 'undefined' ? window : self);
