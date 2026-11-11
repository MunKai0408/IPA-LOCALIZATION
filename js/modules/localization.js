/* localization.js – tổng quan ĐA NGÔN NGỮ từ kết quả trích text: ngôn ngữ nào có, mỗi ngôn ngữ phủ bao nhiêu khóa so với ngôn ngữ nguồn,
   khóa nào CHƯA có ở ngôn ngữ đích (vd. vi) hoặc còn y nguyên bản nguồn, và mẫu CSV dịch kèm cột tham chiếu các ngôn ngữ khác.
   Nhãn: logic-only trên text đã trích; ghép "cùng khóa giữa các ngôn ngữ" là HEURISTIC theo đường dẫn/khóa (đổi mã ngôn ngữ thành {lang}).
   Phụ thuộc call-time: NS.TextExtract (LANG, csvEscape). Chỉ luồng chính. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};
  const SCHEMA = 'localization/1';
  const esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  function normPath(p, lang) {
    let s = p.replace(/(^|\/)[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,4})*\.lproj(?=\/)/g, '$1{lang}.lproj');
    const L = NS.TextExtract.LANG, parts = s.split(/([^A-Za-z]+)/);
    return parts.map(function (t) { return t && /^[A-Za-z]+$/.test(t) && (L[t.toLowerCase()] === lang || t.toLowerCase() === String(lang).toLowerCase()) ? '{lang}' : t; }).join('');
  }
  function normKey(k, lang) {
    const L = NS.TextExtract.LANG;
    return k.replace(/\[([^\]]+)\]$/, function (m, c) { return L[c.toLowerCase()] === lang || c.toLowerCase() === String(lang).toLowerCase() ? '[{lang}]' : m; });
  }

  /** texts = TextResult. Trả {schema, languages[], base, groups(Map nội bộ), unknown_lang_rows}. */
  function analyze(texts) {
    const langs = new Map(), groups = new Map(); let unknown = 0;
    (texts.rows || []).forEach(function (r, i) {
      if (!r.lang || r.lang === 'base') { unknown++; return; }
      let l = langs.get(r.lang); if (!l) { l = { code: r.lang, rows: 0, keys: 0, files: new Set(), formats: new Set() }; langs.set(r.lang, l); }
      l.rows++; l.files.add(r.container + '|' + r.file); l.formats.add(r.format);
      const id = r.container.replace(/^pak:.*$/, 'pak') + '\u0000' + normPath(r.file, r.lang) + '\u0000' + normKey(r.key, r.lang);
      let g = groups.get(id); if (!g) { g = {}; groups.set(id, g); }
      (g[r.lang] = g[r.lang] || []).push(i);
    });
    groups.forEach(function (g) { Object.keys(g).forEach(function (c) { langs.get(c).keys++; }); });
    const list = Array.from(langs.values()).sort(function (a, b) { return b.keys - a.keys; }).map(function (l) { return { code: l.code, rows: l.rows, keys: l.keys, files: l.files.size, formats: Array.from(l.formats).sort() }; });
    const base = list.some(function (l) { return l.code === 'en'; }) ? 'en' : (list[0] ? list[0].code : null);
    return { schema: SCHEMA, languages: list, base: base, unknown_lang_rows: unknown, groups: groups };
  }

  /** So sánh nguồn → đích. missing = chỉ số dòng nguồn mà đích KHÔNG có; identical = đích có nhưng text y hệt nguồn (nhiều khả năng chưa dịch). */
  function compare(texts, an, source, target) {
    const out = { source: source, target: target, source_keys: 0, present: 0, missing: [], identical: [], extra_in_target: 0, coverage_pct: null, by_file: {} };
    an.groups.forEach(function (g) {
      const s = g[source], t = g[target];
      if (!s) { if (t) out.extra_in_target++; return; }
      out.source_keys++;
      if (!t) { out.missing.push(s[0]); const f = texts.rows[s[0]].container + ' | ' + texts.rows[s[0]].file; out.by_file[f] = (out.by_file[f] || 0) + 1; return; }
      out.present++;
      if (texts.rows[t[0]].text === texts.rows[s[0]].text && /\p{L}/u.test(texts.rows[s[0]].text)) out.identical.push(s[0]);
    });
    out.missing.sort(function (a, b) { return a - b; }); out.identical.sort(function (a, b) { return a - b; });
    out.coverage_pct = out.source_keys ? Math.round(out.present * 1000 / out.source_keys) / 10 : null;
    return out;
  }

  /** CSV mẫu dịch, tương thích TranslationApply.mergeCsv (cột container,file,key,text,translation) + cột tham chiếu ref_<lang>.
   *  idx: danh sách chỉ số dòng NGUỒN cần dịch. Bản dịch sẽ ghi đè lên file của ngôn ngữ nguồn (không tạo file ngôn ngữ mới). */
  function toTemplateCsv(texts, an, idx, refLangs) {
    const E = NS.TextExtract.csvEscape, refs = refLangs || [];
    const cols = ['container', 'file', 'format', 'lang', 'key', 'text', 'confidence', 'placeholders', 'context'].concat(refs.map(function (l) { return 'ref_' + l; }), ['translation']);
    const byRow = new Map(); an.groups.forEach(function (g) { Object.keys(g).forEach(function (c) { g[c].forEach(function (i) { byRow.set(i, g); }); }); });
    const lines = [cols.join(',')];
    idx.forEach(function (i) {
      const x = texts.rows[i], g = byRow.get(i) || {};
      lines.push([x.container, x.file, x.format, x.lang, x.key, x.text, x.confidence, x.placeholders.join(' '), x.context].concat(refs.map(function (l) { return g[l] ? texts.rows[g[l][0]].text : ''; }), ['']).map(E).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  function toIndex(an) { return an ? { schema: SCHEMA, base: an.base, languages: an.languages, unknown_lang_rows: an.unknown_lang_rows } : null; }

  NS.Localization = { SCHEMA: SCHEMA, analyze: analyze, compare: compare, toTemplateCsv: toTemplateCsv, toIndex: toIndex, normPath: normPath, normKey: normKey };
})(typeof window !== 'undefined' ? window : self);
