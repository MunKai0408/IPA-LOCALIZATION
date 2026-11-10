/* translation_apply.js – nhập bản dịch (texts.csv có thêm cột "translation") → kiểm placeholder → ghi vào file GỐC → tự kiểm lại.
   Định dạng ghi được: .strings (text), .json, .cdb (cột localizable), .xcstrings (localization đã có), .po/.pot, .properties, .csv/.tsv, .txt.
   KHÔNG ghi: xml, plist/stringsdict, dòng quét thô (raw:), pak (chỉ xuất file đã vá + patch_plan.json; đóng gói lại pak/IPA là bước sau).
   Bất biến: file vá xong được đọc lại bằng chính bộ trích (extractBytes); chỉ cần lệch 1 dòng so với kỳ vọng là file đó KHÔNG được xuất.
   Nhãn: logic-only (dữ liệu GIẢ LẬP); chưa chứng minh game đọc được file đã vá. Phụ thuộc call-time: NS.TextExtract, NS.Hash (tùy chọn). */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};
  const SCHEMA = 'translation_apply/1';
  const TR_COLS = ['translation', 'dich', 'dịch', 'bản dịch', 'ban dich', 'ban_dich', 'vi'];
  const MAX_TEXT = 20000;
  const TE = function () { return NS.TextExtract; };

  /* ---------- đọc CSV dịch ---------- */
  function parseTranslationCsv(text) {
    const out = { rows: [], problems: [] };
    const s = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    const t = TE().splitCsv(s, s.split('\n', 1)[0].split('\t').length > s.split('\n', 1)[0].split(',').length ? '\t' : ',');
    if (!t.length) { out.problems.push('CSV rỗng'); return out; }
    const h = t[0].map(function (x) { return String(x).trim().toLowerCase(); });
    const ix = function (n) { return h.indexOf(n); };
    const c = { container: ix('container'), file: ix('file'), key: ix('key'), text: ix('text'), lang: ix('lang'), format: ix('format') };
    let ti = -1; TR_COLS.forEach(function (n) { if (ti < 0 && ix(n) >= 0) ti = ix(n); });
    ['container', 'file', 'key', 'text'].forEach(function (n) { if (c[n] < 0) out.problems.push('Thiếu cột "' + n + '"'); });
    if (ti < 0) out.problems.push('Thiếu cột bản dịch (đặt tên "translation")');
    if (out.problems.length) return out;
    for (let r = 1; r < t.length; r++) {
      const row = t[r]; if (row.length === 1 && row[0] === '') continue;
      out.rows.push({ line: r + 1, container: row[c.container] || '', file: row[c.file] || '', format: c.format >= 0 ? row[c.format] : '', lang: c.lang >= 0 ? (row[c.lang] || null) : null,
        key: row[c.key] || '', text: row[c.text] || '', translation: row[ti] === undefined ? '' : row[ti] });
    }
    return out;
  }

  /* ---------- kiểm tra ---------- */
  function countOf(s, p) { return s.split(p).length - 1; }
  function checkRow(orig, tr) {
    const issues = [];
    const a = TE().placeholders(orig), b = TE().placeholders(tr);
    a.forEach(function (p) { const co = countOf(orig, p), ct = countOf(tr, p); if (ct < co) issues.push({ level: 'error', msg: 'thiếu placeholder ' + p + (ct ? ' (' + ct + '/' + co + ')' : '') }); });
    b.forEach(function (p) { if (a.indexOf(p) < 0) issues.push({ level: 'error', msg: 'thừa placeholder ' + p }); else if (countOf(tr, p) > countOf(orig, p)) issues.push({ level: 'error', msg: 'placeholder ' + p + ' nhiều hơn bản gốc' }); });
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(tr)) issues.push({ level: 'error', msg: 'chứa ký tự điều khiển' });
    if (countOf(orig, '\n') !== countOf(tr, '\n')) issues.push({ level: 'warning', msg: 'số dòng (xuống dòng thật) khác bản gốc' });
    if (/^\s/.test(orig) !== /^\s/.test(tr) || /\s$/.test(orig) !== /\s$/.test(tr)) issues.push({ level: 'warning', msg: 'khoảng trắng đầu/cuối khác bản gốc' });
    if (tr.length > MAX_TEXT) issues.push({ level: 'warning', msg: 'dài hơn ' + MAX_TEXT + ' ký tự' });
    if (orig.length >= 4 && tr.length > orig.length * 2.5) issues.push({ level: 'warning', msg: 'dài gấp >2,5 lần bản gốc (có thể tràn UI)' });
    return issues;
  }
  /** Gắn status cho từng dòng: skip (không dịch) | ok | warning | error. */
  function validate(rows) {
    const sum = { total: rows.length, translated: 0, untranslated: 0, ok: 0, warning: 0, error: 0 };
    rows.forEach(function (r) {
      r.issues = [];
      if (r.translation === '' || r.translation === r.text) { r.status = 'skip'; sum.untranslated++; return; }
      sum.translated++;
      r.issues = checkRow(r.text, r.translation);
      r.status = r.issues.some(function (i) { return i.level === 'error'; }) ? 'error' : r.issues.length ? 'warning' : 'ok'; sum[r.status]++;
    });
    return sum;
  }

  /* ---------- ghi từng định dạng ---------- */
  function queuesOf(items, withLang) {
    const q = new Map();
    items.forEach(function (it) { const k = (withLang ? (it.lang || '') + '\u0000' : '') + it.key; if (!q.has(k)) q.set(k, []); q.get(k).push(it); });
    return q;
  }
  function encode(text, enc, bom) {
    if (enc === 'utf-16le' || enc === 'utf-16be') {
      const le = enc === 'utf-16le', n = text.length, o = new Uint8Array((n + 1) * 2); let p = 0;
      const put = function (u) { if (le) { o[p++] = u & 255; o[p++] = u >> 8; } else { o[p++] = u >> 8; o[p++] = u & 255; } };
      put(0xFEFF); for (let i = 0; i < n; i++) put(text.charCodeAt(i)); return o;
    }
    const b = new TextEncoder().encode(text);
    if (!bom) return b; const o = new Uint8Array(b.length + 3); o.set([0xEF, 0xBB, 0xBF]); o.set(b, 3); return o;
  }
  function hasBom(bytes) { return bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF; }
  function sameOrig(row, it) { return row === it.text || row.slice(0, MAX_TEXT) === it.text; }
  /** takeItem: lấy mục dịch kế tiếp của khóa; kiểm bản gốc. Trả item hoặc null (đã ghi vào failed). */
  function makeTaker(queues, withLang, failed, applied) {
    return function (key, lang, origText) {
      const q = queues.get((withLang ? (lang || '') + '\u0000' : '') + key); if (!q || !q.length) return null;
      const it = q.shift();
      if (!sameOrig(origText, it)) { failed.push({ key: key, reason: 'bản gốc trong file khác cột text của CSV (file đã đổi hoặc CSV sai phiên bản)' }); return null; }
      applied.add(it); return it;
    };
  }
  function indentOf(s) { const m = /^\s*[\[{]\s*\n([ \t]+)\S/.exec(s); return m ? m[1] : (/\n/.test(s) ? '\t' : 0); }
  function jsonOut(j, orig) { const ind = indentOf(orig); let t = JSON.stringify(j, null, ind); if (/\r\n/.test(orig)) t = t.replace(/\n/g, '\r\n'); return t; }
  function escStrings(v) { return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'); }

  const WRITERS = {
    strings: function (d, items, f, ap) {
      const rows = TE().parseStringsText(d.text).rows, take = makeTaker(queuesOf(items, false), false, f, ap); const rep = [];
      rows.forEach(function (r) { const it = take(r.key, null, r.text); if (it) rep.push([r.vs, r.ve, '"' + escStrings(it.translation) + '"']); });
      let s = d.text; for (let i = rep.length - 1; i >= 0; i--) s = s.slice(0, rep[i][0]) + rep[i][2] + s.slice(rep[i][1]);
      return s;
    },
    cdb: function (d, items, f, ap) {
      const take = makeTaker(queuesOf(items, false), false, f, ap);
      const r = TE().parseCdb(d.text, function (k, v) { const it = take(k, null, v); return it ? it.translation : undefined; });
      if (!r) throw new Error('không phải CDB'); return jsonOut(r.json, d.text);
    },
    json: function (d, items, f, ap) {
      const take = makeTaker(queuesOf(items, false), false, f, ap); const j = JSON.parse(d.text);
      const w = function (o, path, dep) {
        if (dep > 40) return o;
        if (typeof o === 'string') { const it = take(path || '$', null, o); return it ? it.translation : o; }
        if (Array.isArray(o)) { for (let i = 0; i < o.length; i++) o[i] = w(o[i], path + '[' + i + ']', dep + 1); return o; }
        if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { o[k] = w(o[k], path ? path + '.' + k : k, dep + 1); });
        return o;
      };
      return jsonOut(w(j, '', 0), d.text);
    },
    xcstrings: function (d, items, f, ap) {
      const take = makeTaker(queuesOf(items, true), true, f, ap); const j = JSON.parse(d.text);
      Object.keys(j.strings || {}).forEach(function (k) {
        const loc = (j.strings[k] || {}).localizations || {};
        Object.keys(loc).forEach(function (l) { const u = loc[l] && loc[l].stringUnit; if (u && typeof u.value === 'string') { const it = take(k, l, u.value); if (it) u.value = it.translation; } });
      });
      items.forEach(function (it) { if (!ap.has(it) && !f.some(function (x) { return x.key === it.key; })) f.push({ key: it.key, reason: 'khóa/ngôn ngữ không có localization sẵn (chưa hỗ trợ thêm localization mới)' }); });
      return jsonOut(j, d.text);
    },
    po: function (d, items, f, ap) {
      const take = makeTaker(queuesOf(items, false), false, f, ap);
      const un = function (x) { return x.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); };
      const esc = function (x) { return x.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t'); };
      const eol = /\r\n/.test(d.text) ? '\r\n' : '\n';
      const blocks = d.text.split(/\r?\n(?:[ \t]*\r?\n)+/);
      const outB = blocks.map(function (b) {
        const lines = b.split(/\r?\n/); let ctx = null, id = null, cur = null, val = null, start = -1, end = -1;
        lines.forEach(function (ln, i) {
          let m;
          if ((m = /^msgctxt\s+"(.*)"\s*$/.exec(ln))) { ctx = un(m[1]); cur = 'c'; }
          else if ((m = /^msgid\s+"(.*)"\s*$/.exec(ln))) { id = un(m[1]); cur = 'i'; }
          else if ((m = /^msgstr\s+"(.*)"\s*$/.exec(ln))) { val = un(m[1]); cur = 'v'; start = i; end = i; }
          else if ((m = /^"(.*)"\s*$/.exec(ln))) { if (cur === 'i') id += un(m[1]); else if (cur === 'v') { val += un(m[1]); end = i; } else if (cur === 'c') ctx += un(m[1]); }
        });
        if (id === null || id === '' || val === null || start < 0) return b;
        const it = take((ctx ? ctx + '|' : '') + id, null, val); if (!it) return b;
        return lines.slice(0, start).concat(['msgstr "' + esc(it.translation) + '"'], lines.slice(end + 1)).join(eol);
      });
      const seps = d.text.match(/\r?\n(?:[ \t]*\r?\n)+/g) || [];
      return outB.map(function (b, i) { return b + (seps[i] || ''); }).join('');
    },
    properties: function (d, items, f, ap) {
      const take = makeTaker(queuesOf(items, false), false, f, ap);
      return d.text.split(/(\r?\n)/).map(function (ln) {
        const m = /^(\s*)([^#!=:\s][^=:]*?)(\s*[=:]\s*)(.*)$/.exec(ln); if (!m) return ln;
        const it = take(m[2], null, m[4]); return it ? m[1] + m[2] + m[3] + it.translation.replace(/\r?\n/g, '\\n') : ln;
      }).join('');
    },
    csv: function (d, items, f, ap, delim) {
      const take = makeTaker(queuesOf(items, false), false, f, ap); const t = TE().splitCsv(d.text, delim); const hdr = t[0] || [];
      for (let r = 1; r < t.length; r++) for (let c = 0; c < t[r].length; c++) {
        if (t[r][c] === '' || (c === 0 && hdr.length > 1)) continue;
        const id = t[r][0] || 'R' + (r + 1), cn = hdr[c] || 'C' + (c + 1);
        const it = take(hdr.length > 1 ? id + ' [' + cn + ']' : id, null, t[r][c]); if (it) t[r][c] = it.translation;
      }
      const eol = /\r\n/.test(d.text) ? '\r\n' : '\n', q = function (v) { return (v.indexOf(delim) >= 0 || /["\r\n]/.test(v)) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      return t.map(function (row) { return row.map(q).join(delim); }).join(eol) + (/\n$/.test(d.text) ? eol : '');
    },
    txt: function (d, items, f, ap) {
      const take = makeTaker(queuesOf(items, false), false, f, ap), eol = /\r\n/.test(d.text) ? '\r\n' : '\n';
      return d.text.split(/\r?\n/).map(function (ln, i) {
        if (!ln.trim()) return ln; const it = take('L' + (i + 1), null, ln); if (!it) return ln;
        if (/[\r\n]/.test(it.translation)) { ap.delete(it); f.push({ key: it.key, reason: 'txt: mỗi dòng phải là 1 dòng, bản dịch có xuống dòng' }); return ln; }
        return it.translation;
      }).join(eol);
    }
  };

  /** Vá 1 file. src: {path, format, data}; items: các dòng CSV (đã qua validate) của file đó. Trả {data|null, applied, failed[], reason?}. */
  function applyFile(src, items, opts) {
    const ext = TE().extOf(src.path), failed = [], ap = new Set();
    const res = function (o) { return Object.assign({ data: null, applied: 0, failed: failed, items: items.length }, o); };
    if (!items.length) return res({ reason: 'không có dòng dịch' });
    const kind = ({ strings: 'strings', json: 'json', cdb: 'cdb', xcstrings: 'xcstrings', po: 'po', pot: 'po', properties: 'properties', csv: 'csv', tsv: 'csv', txt: 'txt' })[ext];
    if (!kind) return res({ reason: 'định dạng .' + ext + ' chưa hỗ trợ ghi' });
    const orig = TE().extractBytes(src.path, src.data);
    if (orig.skip || !orig.rows) return res({ reason: 'không đọc lại được file gốc: ' + (orig.skip || '?') });
    if (/plist/.test(orig.format || '')) return res({ reason: 'file plist chưa hỗ trợ ghi' });
    const d = TE().decode(src.data); if (!d) return res({ reason: 'không giải mã được file gốc' });
    if ((kind === 'json' || kind === 'cdb' || kind === 'xcstrings') && /(^|[^"\w.])-?\d{16,}(?![\w."])/.test(d.text.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) return res({ reason: 'JSON có số nguyên ≥16 chữ số: JavaScript làm mất độ chính xác nếu ghi lại → không vá' });
    let text;
    try { text = WRITERS[kind](d, items, failed, ap, ext === 'tsv' ? '\t' : ','); }
    catch (e) { return res({ reason: 'lỗi khi ghi: ' + ((e && e.message) || e) }); }
    if (!ap.size) return res({ reason: failed.length ? 'không dòng nào áp dụng được' : 'không khớp dòng nào trong file' });
    const data = encode(text, d.enc, hasBom(src.data));
    /* kiểm lại: đọc file mới bằng chính bộ trích → từng dòng phải = (bản dịch nếu đã áp dụng, ngược lại bản gốc) */
    const chk = TE().extractBytes(src.path, data);
    if (chk.skip || !chk.rows) return res({ reason: 'KIỂM LẠI THẤT BẠI: file mới không đọc được (' + (chk.skip || '?') + ')' });
    if (chk.rows.length !== orig.rows.length) return res({ reason: 'KIỂM LẠI THẤT BẠI: số dòng đổi ' + orig.rows.length + ' → ' + chk.rows.length });
    const withLang = kind === 'xcstrings', q = queuesOf(items, withLang);
    for (let i = 0; i < orig.rows.length; i++) {
      const o = orig.rows[i], n = chk.rows[i]; let exp = o.text;
      const qq = q.get((withLang ? (o.lang || '') + '\u0000' : '') + o.key);
      if (qq && qq.length) { const it = qq.shift(); if (ap.has(it)) exp = it.translation; }
      if (n.key !== o.key || n.text !== exp) return res({ reason: 'KIỂM LẠI THẤT BẠI tại khóa "' + o.key + '"' + (n.key !== o.key ? ' (khóa đổi)' : ' (nội dung không như kỳ vọng)') });
    }
    return res({ data: data, applied: ap.size });
  }

  /* ---------- toàn bộ ---------- */
  function sha(u8) { try { const h = NS.Hash.create('sha256'); h.update(u8); return h.hex(); } catch (_) { return null; } }
  /** texts: kết quả TextExtract.run (cần _src). csvText: nội dung CSV đã dịch. opts: {force:false} → force=true áp cả dòng lỗi placeholder. */
  function build(texts, csvText, opts) {
    opts = opts || {}; const enc = new TextEncoder();
    const pr = parseTranslationCsv(csvText);
    const rep = { schema: SCHEMA, created: new Date().toISOString(), status: 'ok', problems: pr.problems, summary: null, files: [], errors: [], warnings: [], skipped_rows: [] };
    if (pr.problems.length) { rep.status = 'invalid_csv'; return { files: [], report: rep }; }
    rep.summary = validate(pr.rows);
    const srcBy = new Map(); (texts._src || []).forEach(function (s) { srcBy.set(s.container + '\u0000' + s.path, s); });
    const groups = new Map();
    pr.rows.forEach(function (r) {
      if (r.status === 'skip') return;
      if (r.issues.length) (r.status === 'error' ? rep.errors : rep.warnings).push({ line: r.line, file: r.file, key: r.key, issues: r.issues.map(function (i) { return i.msg; }) });
      if (r.status === 'error' && !opts.force) { rep.skipped_rows.push({ line: r.line, reason: 'lỗi placeholder/ký tự – không áp dụng' }); return; }
      const g = r.container + '\u0000' + r.file; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r);
    });
    const files = [], plan = [];
    groups.forEach(function (items, g) {
      const src = srcBy.get(g), first = items[0];
      if (!src) { rep.files.push({ container: first.container, file: first.file, status: 'not_applied', reason: first.container.indexOf('raw:') === 0 ? 'dòng quét thô (cần ghi theo offset – chưa hỗ trợ)' : 'file không có trong gói gốc của phiên này', rows: items.length }); return; }
      const r = applyFile(src, items, opts);
      if (!r.data) { rep.files.push({ container: src.container, file: src.path, status: 'not_applied', reason: r.reason || 'không áp dụng được', rows: items.length, failed: r.failed }); return; }
      const name = 'translated/' + src.name; files.push({ name: name, data: r.data });
      rep.files.push({ container: src.container, file: src.path, status: 'applied', applied: r.applied, failed: r.failed, verified: true });
      plan.push({ container: src.container, path: src.path, out: name, pak: src.pak || null, pak_data_offset: src.pak_data_offset === undefined ? null : src.pak_data_offset,
        orig_size: src.data.length, new_size: r.data.length, same_size: src.data.length === r.data.length, orig_sha256: sha(src.data), new_sha256: sha(r.data),
        how: src.pak ? 'cần dựng lại pak (kích thước đổi → offset các file sau đổi)' : 'thay entry trong IPA (cần ký lại IPA)' });
    });
    const rowsApplied = rep.files.reduce(function (a, f) { return a + (f.applied || 0); }, 0);
    rep.summary.applied_rows = rowsApplied; rep.summary.files_applied = files.length; rep.summary.files_not_applied = rep.files.length - files.length;
    rep.status = files.length ? 'ok' : 'nothing_applied';
    files.push({ name: 'translated/patch_plan.json', data: enc.encode(JSON.stringify({ schema: 'patch_plan/0', note: 'Kế hoạch thô; KHÔNG tự động hóa việc ghi vào pak/IPA. Đã kiểm lại nội dung file, chưa kiểm trong game.', files: plan }, null, 2)) });
    files.push({ name: 'translated/apply_report.json', data: enc.encode(JSON.stringify(rep, null, 2)) });
    files.push({ name: 'translated/HUONG_DAN.txt', data: enc.encode('File trong translated/ipa/… và translated/pak/… là bản ĐÃ DỊCH của file gốc cùng đường dẫn.\r\nMỗi file đã được đọc lại bằng bộ trích để chắc chỉ các dòng dịch thay đổi (xem apply_report.json).\r\nCHƯA ghi vào IPA/pak: xem patch_plan.json (pak cần dựng lại vì kích thước đổi; IPA cần ký lại).\r\nFont: chữ Việt có dấu cần font/atlas hỗ trợ – bản dịch chưa chắc hiển thị đúng nếu font game thiếu glyph.\r\n') });
    return { files: files, report: rep };
  }

  NS.TranslationApply = { SCHEMA: SCHEMA, parseTranslationCsv: parseTranslationCsv, validate: validate, checkRow: checkRow, applyFile: applyFile, build: build };
})(typeof window !== 'undefined' ? window : self);
