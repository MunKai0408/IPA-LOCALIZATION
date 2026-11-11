// Chạy: node tests/run_localization_tests.js   (Node ≥ 20; không cần fixture ngoài). Dữ liệu GIẢ LẬP.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['modules/hash', 'modules/font_metrics', 'modules/text_extract', 'modules/translation_apply', 'modules/localization'].forEach(function (f) { (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8')); });
const NS = globalThis.IPAStudio, T = NS.TextExtract, L = NS.Localization, A = NS.TranslationApply;
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const R = function (container, file, format, lang, key, text) { return { container: container, file: file, format: format, lang: lang, key: key, text: text, confidence: 'high', placeholders: T.placeholders(text), context: '' }; };
const rows = [
  R('ipa', 'Payload/G.app/en.lproj/L.strings', 'strings', 'en', 'play', 'Play game'), R('ipa', 'Payload/G.app/en.lproj/L.strings', 'strings', 'en', 'quit', 'Quit now'), R('ipa', 'Payload/G.app/en.lproj/L.strings', 'strings', 'en', 'hi', 'Hello %s'),
  R('ipa', 'Payload/G.app/fr.lproj/L.strings', 'strings', 'fr', 'play', 'Jouer'), R('ipa', 'Payload/G.app/fr.lproj/L.strings', 'strings', 'fr', 'quit', 'Quitter'),
  R('ipa', 'Payload/G.app/vi.lproj/L.strings', 'strings', 'vi', 'play', 'Chơi'), R('ipa', 'Payload/G.app/vi.lproj/L.strings', 'strings', 'vi', 'quit', 'Quit now'),   // quit: y nguyên bản nguồn
  R('ipa', 'Payload/G.app/zh-Hans.lproj/L.strings', 'strings', 'zh', 'play', '开始'),
  R('pak:res.pak', 'lang/strings_en.json', 'json', 'en', 'menu.start', 'Start'), R('pak:res.pak', 'lang/strings_jp.json', 'json', 'ja', 'menu.start', 'スタート'),   // jp → ja
  R('ipa', 'Loc.csv', 'csv', 'en', 'k1 [en]', 'Sword'), R('ipa', 'Loc.csv', 'csv', 'vi', 'k1 [vi]', 'Kiếm'), R('ipa', 'Loc.csv', 'csv', 'en', 'k2 [en]', 'Shield'),
  R('ipa', 'Payload/G.app/misc.json', 'json', null, 'x', 'No language here')
];
const texts = { rows: rows };
const an = L.analyze(texts), by = {}; an.languages.forEach(function (l) { by[l.code] = l; });
ok(an.languages.length === 5 && an.unknown_lang_rows === 1, 'nhận 5 ngôn ngữ (en,fr,vi,zh,ja), 1 dòng không rõ ngôn ngữ');
ok(by.en.rows === 6 && by.en.keys === 6 && an.base === 'en', 'en: 6 khóa, là ngôn ngữ chuẩn');
ok(L.normPath('Payload/G.app/zh-Hans.lproj/L.strings', 'zh') === 'Payload/G.app/{lang}.lproj/L.strings', 'normPath: lproj có script (zh-Hans) → {lang}');
ok(L.normPath('lang/strings_jp.json', 'ja') === 'lang/strings_{lang}.json', 'normPath: jp ↔ ja qua bảng LANG');
ok(L.normKey('k1 [vi]', 'vi') === 'k1 [{lang}]' && L.normKey('a [note]', 'vi') === 'a [note]', 'normKey: chỉ thay cột là mã ngôn ngữ');
const c = L.compare(texts, an, 'en', 'vi');
ok(c.source_keys === 6 && c.present === 3 && c.missing.length === 3, 'en→vi: 3/6 khóa có, 3 thiếu (hi, menu.start, k2)');
ok(c.identical.length === 1 && rows[c.identical[0]].key === 'quit', 'phát hiện "quit" còn y nguyên bản nguồn (chưa dịch)');
ok(c.coverage_pct === 50, 'độ phủ 50%');
ok(Object.keys(c.by_file).length === 3, 'thiếu theo file: 3 file');
const c2 = L.compare(texts, an, 'en', 'fr');
ok(c2.present === 2 && c2.identical.length === 0, 'en→fr: 2 khóa');
const c3 = L.compare(texts, an, 'en', 'ja');
ok(c3.present === 1 && rows[c3.missing[0]] && c3.missing.length === 5, 'en→ja ghép được json strings_en/strings_jp');
const csv = L.toTemplateCsv(texts, an, c.missing, ['fr', 'ja']);
ok(/^﻿container,file,format,lang,key,text,confidence,placeholders,context,ref_fr,ref_ja,translation\r\n/.test(csv), 'mẫu CSV: có cột ref_fr, ref_ja, translation');
const pr = A.parseTranslationCsv(csv);
ok(pr.problems.length === 0 && pr.rows.length === 3 && pr.rows.every(function (x) { return x.translation === ''; }), 'mẫu CSV đọc được bởi parseTranslationCsv');
const jp = pr.rows.find(function (x) { return x.key === 'menu.start'; });
ok(csv.indexOf('スタート') > 0, 'cột ref_ja chứa bản tiếng Nhật cùng khóa');
const mg = A.mergeCsv(texts, csv.replace(/Hello %s,high,%s,,,,/, 'Hello %s,high,%s,,,,').replace(/(Hello %s.*),\r\n/, '$1,Xin chào %s\r\n'));
ok(mg.problems.length === 0, 'mergeCsv đọc lại mẫu không lỗi');
ok(L.analyze({ rows: [] }).base === null && L.compare({ rows: [] }, L.analyze({ rows: [] }), 'en', 'vi').coverage_pct === null, 'rỗng: base null, coverage null, không ném');
console.log(fail ? fail + ' THẤT BẠI / ' + n : 'PASS ' + n + '/' + n); process.exit(fail ? 1 : 0);
