/* text_extract.js – trích xuất TEXT và FONT trong pak, cho mọi game iOS (phần định dạng mở / đọc được tĩnh).
   Nguồn: (1) file trong IPA; (2) file BÊN TRONG pak Heaps (đọc tuần tự qua streamEntry nên chạy được cả khi pak bị nén trong IPA).
   Định dạng đọc được: .strings (text/UTF-16/plist), .stringsdict, .xcstrings, .json/.cdb, .csv/.tsv, .po/.pot, .xml, .properties, .txt (tên giống bảng text).
   KHÔNG làm: Unity (I2/TextAsset/bundle), Unreal locres/pak (footer), Cocos/Godot pck, mã hóa/DRM → ghi vào result.unsupported để làm ở sub-phase sau.
   NHÃN BẰNG CHỨNG: mỗi dòng là text TRÍCH ĐƯỢC từ file (STATIC-OK về nội dung file), nhưng "có hiển thị trong game không" = HYPOTHESIS (chưa Cổng 0).
   Phụ thuộc call-time: NS.IpaReader.streamEntry/readEntry, NS.PlistParser, NS.PakHeads. Chạy được ở Worker. Không ném lỗi (trừ CANCELLED). */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const SCHEMA = 'texts/1';
  const LIMITS = { max_file_bytes: 8 * 1048576, max_files: 3000, max_rows: 300000, max_text_len: 20000, max_font_bytes: 6 * 1048576, max_font_total: 48 * 1048576, max_pak_target_bytes: 160 * 1048576,
    raw_file_bytes: 1100 * 1048576, raw_total_bytes: 2500 * 1048576, raw_max_files: 40, pack_total: 256 * 1048576 };
  const RAW_EXT = { pak: 1, pck: 1, bin: 1, dat: 1, data: 1, obb: 1, assets: 1, bundle: 1, unity3d: 1, bytes: 1, res: 1, arc: 1, pkg: 1, wad: 1, lua: 1, luac: 1, jsc: 1, js: 1, db: 1, sqlite: 1, bank: 1, resource: 1, resS: 1, mpq: 1, vfs: 1, big: 1, rpa: 1, rgss3a: 1, dll: 1, hl: 1, lang: 1, loc: 1, msg: 1, bd: 1, cfg: 1, ini: 1, dict: 1, lng: 1 };
  const TEXT_EXT = { strings: 1, stringsdict: 1, xcstrings: 1, json: 1, cdb: 1, csv: 1, tsv: 1, po: 1, pot: 1, xml: 1, properties: 1, txt: 1 };
  const IMG_EXT = { png: 1, tga: 1, dds: 1, jpg: 1, jpeg: 1, webp: 1, pvr: 1, ktx: 1 };
  const FONT_EXT = { ttf: 'ttf', otf: 'otf', ttc: 'ttc', woff: 'woff', woff2: 'woff2', fnt: 'bmfont' };
  const SKIP_RE = /(^|\/)(frameworks|_codesignature|sc_info|plugins|watch)\//i;
  const NOISE_RE = /(^|\/)(info\.plist|coderesources|privacyinfo\.xcprivacy|gamecontrollerdb\.txt|readme\.txt|ipastore?|ipa\.store|googleservice-info\.plist)$/i;
  const LOC_RE = /(lang|locale|locali[sz]|i18n|l10n|string|text|dialog|message|msg|translat|subtitle|script|quest|item|name|desc)/i;
  const LANG = { en: 'en', eng: 'en', zh: 'zh', chs: 'zh-Hans', cht: 'zh-Hant', cn: 'zh-Hans', tw: 'zh-Hant', ja: 'ja', jp: 'ja', ko: 'ko', kr: 'ko', fr: 'fr', de: 'de', es: 'es', ru: 'ru', pt: 'pt', it: 'it', vi: 'vi', vn: 'vi', th: 'th', id: 'id', tr: 'tr', ar: 'ar', pl: 'pl', cs: 'cs', uk: 'uk', base: 'base' };

  function extOf(n) { const b = n.slice(n.lastIndexOf('/') + 1); const i = b.lastIndexOf('.'); return i < 0 ? '' : b.slice(i + 1).toLowerCase(); }
  function langOfPath(p) {
    const toks = p.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z]+/).filter(Boolean);
    for (let i = toks.length - 1; i >= 0; i--) if (LANG[toks[i]]) return LANG[toks[i]];
    const m = /([a-z]{2}(?:-[A-Za-z]{2,4})?)\.lproj/i.exec(p); return m ? m[1] : null;
  }
  function decode(bytes) {
    let enc = 'utf-8', off = 0;
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) { enc = 'utf-16le'; off = 2; }
    else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) { enc = 'utf-16be'; off = 2; }
    else if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) { off = 3; }
    try { return { text: new TextDecoder(enc, { fatal: true }).decode(bytes.subarray(off)), enc: enc }; }
    catch (_) { return null; }
  }
  const HAS_LETTER = /\p{L}/u;
  function confidence(t) {
    if (!HAS_LETTER.test(t)) return null;
    if (/\.(png|jpe?g|webp|tga|dds|atlas|wav|ogg|mp3|caf|m4a|json|ase|aseprite|psd|ttf|otf)$/i.test(t)) return null;   // tên file tài nguyên, không phải text hiển thị                                   // số/ký hiệu thuần → bỏ
    if (/\s/.test(t) || /[^\x00-\x7f]/.test(t) || /[.!?…:]$/.test(t)) return 'high';
    if (/^[\w.\-\/\\:#@]+$/.test(t) && (/[_\/\\]|\.[a-z0-9]{2,4}$/i.test(t) || /^[a-z0-9]+([A-Z][a-z0-9]*)+$/.test(t) || /^[A-Z0-9_]+$/.test(t))) return 'low'; // giống ID/đường dẫn
    return 'medium';
  }
  const PH_RE = /::[+-]?[A-Za-z_]\w*::|\{(?=[^{}]*@\w+\})|@\w+\}|%(?:\d+\$)?[-+0#]*\d*(?:\.\d+)?(?:l{0,2}[dioxXufeEgGcs@]|@)|%%|\{\d+\}|\{[A-Za-z_]\w*\}|<\/?[A-Za-z][^>]*>|\\n/g;
  function placeholders(t) { const m = t.match(PH_RE); return m ? Array.from(new Set(m)) : []; }

  /* ---------- parser thuần (text → [{key,text,lang?}]) ---------- */
  function parseStringsText(s) {
    const rows = []; let i = 0; const n = s.length; let bad = 0;
    const isWs = function (c) { return c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\uFEFF'; };
    function ws() { for (;;) { while (i < n && isWs(s[i])) i++; if (s.startsWith('/*', i)) { const j = s.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; } else if (s.startsWith('//', i)) { const j = s.indexOf('\n', i); i = j < 0 ? n : j + 1; } else break; } }
    function str() {
      if (s[i] === '"') {
        i++; let o = '';
        while (i < n && s[i] !== '"') {
          if (s[i] === '\\') {
            i++; const c = s[i++];
            if (c === 'n') o += '\n'; else if (c === 't') o += '\t'; else if (c === 'r') o += '\r';
            else if (c === 'U' || c === 'u') { const h = s.substr(i, 4); if (/^[0-9a-fA-F]{4}$/.test(h)) { o += String.fromCharCode(parseInt(h, 16)); i += 4; } else o += c; }
            else o += c;
          } else o += s[i++];
        }
        i++; return o;
      }
      const m = /^[A-Za-z0-9_.$\-\/]+/.exec(s.slice(i, i + 200)); if (!m) return null; i += m[0].length; return m[0];
    }
    while (i < n) {
      ws(); if (i >= n) break;
      const k = str(); ws();
      if (k !== null && s[i] === '=') { i++; ws(); const vs = i, v = str(), ve = i; ws(); if (s[i] === ';') i++; if (v === null) bad++; else rows.push({ key: k, text: v, vs: vs, ve: ve }); }   // vs/ve: khoảng giá trị trong chuỗi gốc (cho translation_apply)
      else { bad++; const j = s.indexOf(';', i); i = j < 0 ? n : j + 1; }
    }
    return { rows: rows, bad: bad };
  }
  function parsePlistDict(bytes, kind) {
    const P = NS.PlistParser; if (!P) return null;
    let v; try { v = P.parse(bytes).value; } catch (_) { return null; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const rows = [];
    (function walk(o, path) {
      Object.keys(o).forEach(function (k) {
        const x = o[k], p = path ? path + '/' + k : k;
        if (typeof x === 'string') { if (kind === 'dict' && (k === 'NSStringFormatSpecTypeKey' || k === 'NSStringFormatValueTypeKey')) return; rows.push({ key: p, text: x }); }
        else if (x && typeof x === 'object' && !Array.isArray(x)) walk(x, p);
      });
    })(v, '');
    return { rows: rows, bad: 0 };
  }
  function parseXcstrings(s) {
    let j; try { j = JSON.parse(s); } catch (_) { return null; }
    if (!j || typeof j.strings !== 'object') return null;
    const rows = []; const src = j.sourceLanguage || null;
    Object.keys(j.strings).forEach(function (k) {
      const e = j.strings[k] || {}, loc = e.localizations || {}, langs = Object.keys(loc);
      if (!langs.length && src) rows.push({ key: k, text: k, lang: src, ctx: 'khóa gốc (chưa có localizations)' });
      langs.forEach(function (l) {
        const u = loc[l] && loc[l].stringUnit;
        if (u && typeof u.value === 'string') rows.push({ key: k, text: u.value, lang: l });
        else if (loc[l] && loc[l].variations) rows.push({ key: k, text: '', lang: l, ctx: 'variations: chưa trích' });
      });
    });
    return { rows: rows, bad: 0 };
  }
  function parseJsonWalk(s) {
    let j; try { j = JSON.parse(s); } catch (_) { return null; }
    const rows = [];
    (function walk(o, path, d) {
      if (d > 40 || rows.length >= LIMITS.max_rows) return;
      if (typeof o === 'string') { rows.push({ key: path || '$', text: o }); return; }
      if (Array.isArray(o)) { o.forEach(function (x, i) { walk(x, path + '[' + i + ']', d + 1); }); return; }
      if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { walk(o[k], path ? path + '.' + k : k, d + 1); });
    })(j, '', 0);
    return { rows: rows, bad: 0 };
  }
  /** CastleDB (.cdb): chỉ lấy các cột có kind="localizable" (game tự đánh dấu cột cần dịch), kể cả sheet con "cha@cột". Trả null nếu không phải CDB. */
  function parseCdb(s, setter) {   // setter(key, text) → chuỗi mới hoặc undefined (dùng cho translation_apply); r.json = đối tượng đã (có thể) sửa
    let j; try { j = JSON.parse(s); } catch (_) { return null; }
    if (!j || !Array.isArray(j.sheets)) return null;
    const by = {}; j.sheets.forEach(function (sh) { if (sh && sh.name) by[sh.name] = sh; });
    const rows = []; let nCols = 0;
    function locCols(sh) { const m = {}; (sh.columns || []).forEach(function (c) { if (c && c.name) { m[c.name] = c.kind === 'localizable'; } }); return m; }
    function walkLine(sh, line, prefix, depth) {
      if (!line || typeof line !== 'object' || depth > 8 || rows.length >= LIMITS.max_rows) return;
      const lc = locCols(sh);
      (sh.columns || []).forEach(function (c) {
        if (!c || !c.name) return; const v = line[c.name];
        if (lc[c.name]) { nCols++; if (typeof v === 'string' && v !== '') { const k = prefix + '.' + c.name; rows.push({ key: k, text: v, ctx: 'CDB localizable' }); if (setter) { const nv = setter(k, v); if (typeof nv === 'string') line[c.name] = nv; } } return; }
        if (Array.isArray(v)) { const sub = by[sh.name + '@' + c.name]; if (sub) v.forEach(function (x, i) { walkLine(sub, x, prefix + '.' + c.name + '[' + (x && x.id ? x.id : i) + ']', depth + 1); }); }
      });
    }
    j.sheets.forEach(function (sh) {
      if (!sh || !sh.name || sh.name.indexOf('@') >= 0 || !Array.isArray(sh.lines)) return;
      sh.lines.forEach(function (line, i) { walkLine(sh, line, sh.name + '[' + (line && line.id ? line.id : i) + ']', 0); });
    });
    return { rows: rows, bad: 0, json: j };
  }
  function splitCsv(s, delim) {
    const out = []; let row = [], cell = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"' && cell === '') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; out.push(row); row = []; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); out.push(row); }
    return out;
  }
  function parseCsv(s, delim) {
    const t = splitCsv(s, delim); if (!t.length) return { rows: [], bad: 0 };
    const hdr = t[0], rows = [];
    for (let r = 1; r < t.length; r++) for (let c = 0; c < t[r].length; c++) {
      if (t[r][c] === '' || (c === 0 && hdr.length > 1)) continue; // cột đầu (khi có ≥2 cột) coi là khóa, không phải text
      const id = t[r][0] || 'R' + (r + 1);
      const colName = hdr[c] || 'C' + (c + 1);
      rows.push({ key: hdr.length > 1 ? id + ' [' + colName + ']' : id, text: t[r][c], lang: LANG[String(colName).toLowerCase()] || null });
    }
    return { rows: rows, bad: 0 };
  }
  function parsePo(s) {
    const rows = []; let ctx = null, id = null, val = null, cur = null;
    const un = function (x) { return x.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); };
    const flush = function () { if (id !== null && id !== '' && val !== null) rows.push({ key: (ctx ? ctx + '|' : '') + id, text: val }); id = null; val = null; ctx = null; cur = null; };
    s.split(/\r?\n/).forEach(function (ln) {
      let m;
      if ((m = /^msgctxt\s+"(.*)"\s*$/.exec(ln))) { flush(); ctx = un(m[1]); cur = 'c'; }
      else if ((m = /^msgid\s+"(.*)"\s*$/.exec(ln))) { if (cur === 'v') flush(); id = un(m[1]); cur = 'i'; }
      else if ((m = /^msgstr\s+"(.*)"\s*$/.exec(ln))) { val = un(m[1]); cur = 'v'; }
      else if ((m = /^"(.*)"\s*$/.exec(ln))) { if (cur === 'i') id += un(m[1]); else if (cur === 'v') val += un(m[1]); else if (cur === 'c') ctx += un(m[1]); }
      else if (/^\s*$/.test(ln)) { flush(); }
    });
    flush(); return { rows: rows, bad: 0 };
  }
  function parseProperties(s) {
    const rows = [];
    s.split(/\r?\n/).forEach(function (ln) { const m = /^\s*([^#!=:\s][^=:]*?)\s*[=:]\s*(.*)$/.exec(ln); if (m) rows.push({ key: m[1], text: m[2] }); });
    return { rows: rows, bad: 0 };
  }
  function unent(t) {
    return t.replace(/&(lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, function (_, n, d, h) {
      if (n) return { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[n];
      const cp = d ? parseInt(d, 10) : parseInt(h, 16); try { return String.fromCodePoint(cp); } catch (_e) { return ''; }
    });
  }
  function parseXml(s) {
    const rows = [], stack = []; let bad = 0;
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.\-]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m, count = 0;
    const keyOf = function () { return stack.map(function (x) { return x.tag + (x.id ? '[' + x.id + ']' : ''); }).join('/'); };
    while ((m = re.exec(s)) !== null) {
      if (++count > 2000000) { bad++; break; }
      if (m[1] !== undefined) { if (m[1].trim()) rows.push({ key: keyOf() || '$', text: m[1] }); continue; }
      if (m[3]) {
        if (m[2]) { if (stack.length && stack[stack.length - 1].tag === m[3]) stack.pop(); else bad++; }
        else {
          const am = /\b(?:id|name|key)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[4] || '');
          if (m[5] !== '/') stack.push({ tag: m[3], id: am ? (am[1] !== undefined ? am[1] : am[2]) : null });
        }
      } else if (m[6] !== undefined) {
        const t = unent(m[6]).trim(); if (t) rows.push({ key: keyOf() || '$', text: t });
      }
    }
    return { rows: rows, bad: bad + stack.length };
  }
  function parseLines(s) { const rows = []; s.split(/\r?\n/).forEach(function (ln, i) { if (ln.trim()) rows.push({ key: 'L' + (i + 1), text: ln }); }); return { rows: rows, bad: 0 }; }

  /** Trích 1 file. Trả {format, rows, bad, enc, note} hoặc {skip:'lý do'}. */
  function extractBytes(path, bytes) {
    const ext = extOf(path);
    if (!TEXT_EXT[ext]) return { skip: 'đuôi không hỗ trợ' };
    if (ext === 'strings' || ext === 'stringsdict') {
      const isPlist = bytes.length > 8 && (String.fromCharCode.apply(null, bytes.subarray(0, 6)) === 'bplist' || /^\s*(<\?xml|<plist)/.test(String.fromCharCode.apply(null, bytes.subarray(0, 64))));
      if (isPlist) { const r = parsePlistDict(bytes, ext === 'stringsdict' ? 'dict' : 'flat'); if (r) return Object.assign({ format: ext + '(plist)', enc: 'plist' }, r); }
    }
    const d = decode(bytes); if (!d) return { skip: 'không giải mã được UTF-8/UTF-16 (nhị phân hoặc mã hóa lạ)' };
    const s = d.text; let r = null, fmt = ext;
    if (ext === 'strings') r = parseStringsText(s);
    else if (ext === 'stringsdict') r = parsePlistDict(new TextEncoder().encode(s), 'dict');
    else if (ext === 'xcstrings') r = parseXcstrings(s);
    else if (ext === 'cdb' && (r = parseCdb(s))) { fmt = 'cdb-localizable'; }
    else if (ext === 'json' || ext === 'cdb') { r = parseJsonWalk(s); if (!r) return { skip: 'JSON không hợp lệ' }; r.rows = r.rows.filter(function (x) { return confidence(x.text) === 'high'; }); } // JSON thường: bỏ ID/tên 1 từ
    else if (ext === 'csv') r = parseCsv(s, ',');
    else if (ext === 'tsv') r = parseCsv(s, '\t');
    else if (ext === 'po' || ext === 'pot') r = parsePo(s);
    else if (ext === 'properties') r = parseProperties(s);
    else if (ext === 'xml') { if (!/^\s*(<\?xml|<)/.test(s)) return { skip: 'không phải XML văn bản' }; r = parseXml(s); }
    else if (ext === 'txt') { if (!LOC_RE.test(path)) return { skip: 'txt không có tên giống bảng text' }; r = parseLines(s); }
    if (!r) return { skip: 'không đọc được định dạng ' + fmt };
    return { format: fmt, rows: r.rows, bad: r.bad, enc: d.enc };
  }

  function fontMagic(b) {
    if (b.length < 4) return null;
    const m = String.fromCharCode(b[0], b[1], b[2], b[3]);
    if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || m === 'true') return 'ttf';
    if (m === 'OTTO') return 'otf'; if (m === 'ttcf') return 'ttc'; if (m === 'wOFF') return 'woff'; if (m === 'wOF2') return 'woff2';
    if (m.slice(0, 3) === 'BMF' || /^\s*(<font|info )/.test(String.fromCharCode.apply(null, b.subarray(0, Math.min(16, b.length))))) return 'bmfont';
    return null;
  }

  /** Đọc BMFont (.fnt: text, XML hoặc nhị phân v3) → {format, face, size, chars, vietnamese}. Không chắc → null. */
  function viCoverage(idSet) {
    const FM = NS.FontMetrics; if (!FM || !FM.VI_REQUIRED) return null;
    const req = FM.VI_REQUIRED, miss = req.filter(function (c) { return !idSet.has(c); });
    let asciiOk = true; for (let c = 65; c <= 122; c++) if ((c <= 90 || c >= 97) && !idSet.has(c)) { asciiOk = false; break; }
    return { level: miss.length === 0 ? 'full' : miss.length === req.length ? 'none' : 'partial', required: req.length, covered: req.length - miss.length, missing_count: miss.length,
      missing: miss.slice(0, 150).map(function (c) { return 'U+' + c.toString(16).toUpperCase().padStart(4, '0'); }), percent: Math.round((req.length - miss.length) * 1000 / req.length) / 10, ascii_letters_ok: asciiOk };
  }
  function parseBmfont(b) {
    const ids = new Set(); let fmt = null, face = null, size = null;
    if (b.length > 4 && b[0] === 66 && b[1] === 77 && b[2] === 70 && b[3] === 3) {
      fmt = 'binary'; let p = 4; const dv = new DataView(b.buffer, b.byteOffset, b.length);
      while (p + 5 <= b.length) {
        const type = b[p], sz = dv.getUint32(p + 1, true); p += 5; if (sz > b.length - p) break;
        if (type === 1 && sz > 15) { size = Math.abs(dv.getInt16(p, true)); let q = p + 14, e = q; while (e < p + sz && b[e] !== 0) e++; face = new TextDecoder().decode(b.subarray(q, e)); }
        else if (type === 4) for (let q = p; q + 20 <= p + sz; q += 20) ids.add(dv.getUint32(q, true));
        p += sz;
      }
    } else {
      const d = decode(b); if (!d) return null; const t = d.text;
      let m;
      if (/^\s*(<\?xml|<font)/.test(t)) { fmt = 'xml'; const re = /<char\s[^>]*?\bid="(\d+)"/g; while ((m = re.exec(t))) ids.add(+m[1]); m = /<info[^>]*?\bface="([^"]*)"/.exec(t); face = m ? m[1] : null; m = /<info[^>]*?\bsize="(-?\d+)"/.exec(t); size = m ? Math.abs(+m[1]) : null; }
      else if (/^\s*info\s/.test(t)) { fmt = 'text'; const re = /^\s*char\s+id=(\d+)/gm; while ((m = re.exec(t))) ids.add(+m[1]); m = /^\s*info\s[^\n]*?face="([^"]*)"/m.exec(t); face = m ? m[1] : null; m = /^\s*info\s[^\n]*?size=(-?\d+)/m.exec(t); size = m ? Math.abs(+m[1]) : null; }
      else return null;
    }
    if (!ids.size) return null;
    return { format: fmt, face: face, size: size, chars: ids.size, vietnamese: viCoverage(ids) };
  }
  /** Metadata font trong pak: TTF/OTF/TTC/WOFF qua FontMetrics.parse, BMFont qua parseBmfont. Không ném. */
  async function fontMetricsOf(magic, bytes) {
    try {
      if (magic === 'bmfont') { const r = parseBmfont(bytes); return r ? { status: 'parsed', kind: 'bmfont', family: r.face, size: r.size, glyphs: r.chars, bmfont_format: r.format, vietnamese: r.vietnamese } : { status: 'unparsed', kind: 'bmfont', reason: 'không đọc được danh sách ký tự BMFont' }; }
      const FM = NS.FontMetrics; if (!FM) return { status: 'unparsed', reason: 'thiếu font_metrics.js' };
      const r = await FM.parse(bytes);
      if (r.status !== 'parsed' || !r.fonts.length) return { status: r.status, kind: magic, reason: r.reason || null };
      const rank = { full: 3, partial: 2, none: 1, unknown: 0 };
      const best = r.fonts.slice().sort(function (a, b) { return (rank[b.vietnamese.level] || 0) - (rank[a.vietnamese.level] || 0) || (b.vietnamese.covered || 0) - (a.vietnamese.covered || 0); })[0];
      const v = best.vietnamese;
      return { status: 'parsed', kind: magic, family: best.names.typographic_family || best.names.family || null, full: best.names.full || null, glyphs: best.num_glyphs, fonts_in_file: r.fonts.length,
        vietnamese: { level: v.level, required: v.required, covered: v.covered, missing_count: v.missing_count, missing: (v.missing || []).slice(0, 150), percent: v.percent, ascii_letters_ok: v.ascii_letters_ok } };
    } catch (e) { return { status: 'error', reason: (e && e.message) || String(e) }; }
  }

  /** Đọc tuần tự 1 entry zip, gom các khoảng byte cần lấy. ranges: [{start,end,tag}] sắp theo start. */
  async function captureRanges(file, entry, ranges, cancelled) {
    const IR = NS.IpaReader; let off = 0, k = 0; const bufs = ranges.map(function () { return []; });
    await IR.streamEntry(file, entry, function (chunk) {
      const cs = off, ce = off + chunk.length;
      while (k < ranges.length && ranges[k].end <= cs) k++;
      for (let j = k; j < ranges.length && ranges[j].start < ce; j++) {
        const a = Math.max(ranges[j].start, cs), b = Math.min(ranges[j].end, ce);
        if (b > a) bufs[j].push(chunk.slice(a - cs, b - cs));
      }
      off = ce;
    }, { isCancelled: cancelled });
    return bufs.map(function (parts) { let n = 0; parts.forEach(function (p) { n += p.length; }); const o = new Uint8Array(n); let q = 0; parts.forEach(function (p) { o.set(p, q); q += p.length; }); return o; });
  }

  function csvEscape(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  const CSV_COLS = ['container', 'file', 'format', 'lang', 'key', 'text', 'confidence', 'placeholders', 'context'];

  /** Chạy toàn bộ. result: kết quả analyze (để lấy pak_heads). */
  async function run(file, entries, result, opts) {
    opts = opts || {};
    const IR = NS.IpaReader, cancelled = opts.isCancelled || function () { return false; };
    const chk = function () { if (cancelled()) { const e = new Error('Đã hủy'); e.code = 'CANCELLED'; throw e; } };
    const out = { schema: SCHEMA, status: 'no_text', reason: 'Không trích được text', rows: [], files: [], font_inventory: [], skipped: [], unsupported: [], warnings: [], pak_fonts: [], summary: null,
      limitations: ['Chỉ trích text ở định dạng mở/đọc được tĩnh. Unity (I2/TextAsset/bundle), Unreal locres/pak, Cocos/Godot pck, dữ liệu mã hóa/nén riêng: CHƯA có trình đọc riêng (xem unsupported) – nhưng được quét chuỗi thô dự phòng (format \'raw\', [HYPOTHESIS]).',
        'Mỗi dòng là text có trong file (nội dung), nhưng việc game có HIỂN THỊ nó hay không là [HYPOTHESIS] – chưa qua Cổng 0, chưa canary.',
        'Cấu trúc pak Heaps đọc theo giả thuyết; nếu danh sách file hợp lệ nhưng nội dung không giải mã được thì bị bỏ qua và ghi vào skipped.'] };
    let nFiles = 0; out._src = []; let srcTotal = 0;
    const keep = function (name, container, path, data, format, extra) { if (srcTotal + data.length > LIMITS.pack_total) { if (!out._srcCapped) { out._srcCapped = true; out.warnings.push('Gói dịch đạt giới hạn ' + Math.round(LIMITS.pack_total / 1048576) + ' MB; một số file không được đưa vào gói.'); } return; } srcTotal += data.length; out._src.push(Object.assign({ name: name, container: container, path: path, data: data, format: format }, extra || {})); };
    const addRows = function (container, path, ex, lang0) {
      const fl = { container: container, file: path, format: ex.format, rows: 0, bad: ex.bad || 0, enc: ex.enc, lang: lang0 };
      const seen = new Set();
      ex.rows.forEach(function (r) {
        if (out.rows.length >= LIMITS.max_rows) { if (!out._capped) { out._capped = true; out.warnings.push('Đạt giới hạn ' + LIMITS.max_rows + ' dòng; phần còn lại bị bỏ.'); } return; }
        const text = r.text.length > LIMITS.max_text_len ? r.text.slice(0, LIMITS.max_text_len) : r.text;
        if (text === '' && !r.ctx) return;
        const conf = text === '' ? null : confidence(text); if (text !== '' && conf === null) return;
        const dup = seen.has(r.key); seen.add(r.key);
        out.rows.push({ container: container, file: path, format: ex.format, lang: r.lang || lang0 || null, key: r.key, text: text, confidence: conf, placeholders: placeholders(text), context: r.ctx || (dup ? 'khóa trùng trong file' : '') });
        fl.rows++;
      });
      out.files.push(fl);
    };

    /* (1) file trong IPA */
    const cands = entries.filter(function (e) {
      if (e.dir || e.unsafe || e.encrypted) return false;
      if (SKIP_RE.test(e.name) || NOISE_RE.test(e.name)) return false;
      const x = extOf(e.name); return TEXT_EXT[x] && e.size > 0;
    });
    for (let i = 0; i < cands.length && nFiles < LIMITS.max_files; i++) {
      chk(); const e = cands[i];
      if (e.size > LIMITS.max_file_bytes) { out.skipped.push({ container: 'ipa', file: e.name, reason: 'lớn hơn ' + LIMITS.max_file_bytes + ' byte' }); continue; }
      try {
        const r = await IR.readEntry(file, e, { max: LIMITS.max_file_bytes });
        const ex = extractBytes(e.name, r.data);
        if (ex.skip) { out.skipped.push({ container: 'ipa', file: e.name, reason: ex.skip }); continue; }
        nFiles++; addRows('ipa', e.name, ex, langOfPath(e.name)); keep('ipa/' + e.name, 'ipa', e.name, r.data, ex.format);
      } catch (err) { if (err && err.code === 'CANCELLED') throw err; out.skipped.push({ container: 'ipa', file: e.name, reason: (err && err.message) || String(err) }); }
    }

    /* (2) bên trong pak Heaps (text + font) */
    const ph = result && result.pak_heads; let fontTotal = 0; out._fontBlobs = []; const fontJobs = [];
    if (ph && ph.pak_files) for (let pi = 0; pi < ph.pak_files.length; pi++) {
      const pk = ph.pak_files[pi], hp = pk.heaps;
      if (!hp || hp.status !== 'ok' || !hp._files) { if (pk.format_guess && pk.format_guess !== 'heaps_pak') out.unsupported.push({ file: pk.zip_path, reason: 'pak định dạng ' + pk.format_guess + ' – chưa có trình đọc' }); else if (hp) out.unsupported.push({ file: pk.zip_path, reason: 'cây pak chưa xác minh (' + hp.status + '): ' + hp.notes.join(' ') }); continue; }
      const ent = entries.find(function (e) { return e.name === pk.zip_path; }); if (!ent) continue;
      const targets = []; let budget = 0;
      const stems = new Set(); hp._files.forEach(function (f) { if (extOf(f.path) === 'fnt') stems.add(f.path.replace(/\.[^.\/]+$/, '')); });
      hp._files.forEach(function (f) {
        const x = extOf(f.path), isT = TEXT_EXT[x] && !(x === 'txt' && !LOC_RE.test(f.path)), isF = FONT_EXT[x];
        const isAux = !isT && !isF && IMG_EXT[x] && (stems.has(f.path.replace(/\.[^.\/]+$/, '')) || /(^|[\/_.-])(fonts?|glyphs?|charset)([\/_.-]|$)/i.test(f.path));   // atlas ảnh của font bitmap
        if (isF || isAux) out.font_inventory.push({ container: 'pak:' + pk.zip_path, path: f.path, size: f.size, ext: x, role: isAux ? 'bitmap-atlas (ảnh)' : (x === 'fnt' ? 'bitmap-font-desc' : 'font-file') });
        if (!isT && !isF && !isAux) return;
        if (f.size === 0 || f.size > ((isF || isAux) ? LIMITS.max_font_bytes : LIMITS.max_file_bytes)) { if (f.size) out.skipped.push({ container: 'pak:' + pk.zip_path, file: f.path, reason: 'lớn hơn giới hạn' }); return; }
        if (budget + f.size > LIMITS.max_pak_target_bytes) return;
        budget += f.size; targets.push({ start: hp.data_start + f.pos, end: hp.data_start + f.pos + f.size, path: f.path, font: !!isF, aux: !!isAux });
      });
      if (!targets.length) continue;
      targets.sort(function (a, b) { return a.start - b.start; });
      try {
        const bufs = await captureRanges(file, ent, targets, cancelled);
        let okText = 0, failText = 0;
        targets.forEach(function (t, j) {
          const b = bufs[j], c = 'pak:' + pk.zip_path;
          if (t.aux) { keep('pak/' + pk.zip_path.replace(/^.*\//, '') + '/' + t.path, c, t.path, b, 'font-atlas-image', { pak: pk.zip_path, pak_data_offset: t.start, pak_entry_size: b.length }); return; }
          if (t.font) {
            if (fontMagic(b)) keep('pak/' + pk.zip_path.replace(/^.*\//, '') + '/' + t.path, c, t.path, b, 'font-' + fontMagic(b), { pak: pk.zip_path, pak_data_offset: t.start, pak_entry_size: b.length });
            const fm = fontMagic(b), kind = fm || 'không nhận ra magic';
            const pf = { container: c, file: t.path, size: b.length, magic: fm, ok: !!fm }; out.pak_fonts.push(pf); if (fm) fontJobs.push({ pf: pf, magic: fm, bytes: b });
            if (fm && fontTotal + b.length <= LIMITS.max_font_total) { fontTotal += b.length; out._fontBlobs.push({ name: c.replace(/[:\/]/g, '_') + '__' + t.path.replace(/\//g, '__'), data: b }); }
            return;
          }
          const ex = extractBytes(t.path, b);
          if (ex.skip) { failText++; out.skipped.push({ container: c, file: t.path, reason: ex.skip }); return; }
          okText++; nFiles++; addRows(c, t.path, ex, langOfPath(t.path)); keep('pak/' + pk.zip_path.replace(/^.*\//, '') + '/' + t.path, c, t.path, b, ex.format, { pak: pk.zip_path, pak_data_offset: t.start, pak_entry_size: b.length });
        });
        if (failText > 0 && okText === 0) out.warnings.push('Pak ' + pk.zip_path + ': MỌI file text đều không giải mã được → bố cục pak (offset dữ liệu) có thể sai, hoặc nội dung nén/mã hóa riêng.');
      } catch (err) { if (err && err.code === 'CANCELLED') throw err; out.warnings.push('Không đọc được nội dung pak ' + pk.zip_path + ': ' + ((err && err.message) || err)); }
    }

    for (let i = 0; i < fontJobs.length; i++) { chk(); fontJobs[i].pf.metrics = await fontMetricsOf(fontJobs[i].magic, fontJobs[i].bytes); fontJobs[i].bytes = null; }   // độ phủ tiếng Việt của font trong pak

    /* (3) DỰ PHÒNG MỌI ENGINE: quét chuỗi thô các container chưa có trình đọc (pak không rõ cấu trúc, .bin/.dat/.obb/.assets…). [HYPOTHESIS] */
    if (opts.rawFallback !== false && NS.RawStrings) {
      const okPaks = new Set(((result && result.pak_heads && result.pak_heads.pak_files) || []).filter(function (p) { return p.heaps && p.heaps.status === 'ok'; }).map(function (p) { return p.zip_path; }));
      const unsup = new Set(out.unsupported.map(function (u) { return u.file; }));
      const done = new Set(out.files.filter(function (f) { return f.container === 'ipa'; }).map(function (f) { return f.file; }));
      const rc = entries.filter(function (e) {
        if (e.dir || e.unsafe || e.encrypted || (e.method !== 0 && e.method !== 8) || e.size < 256 || e.size > LIMITS.raw_file_bytes) return false;
        if (/(^|\/)(_codesignature|sc_info)\//i.test(e.name) || /(^|\/)frameworks\//i.test(e.name) || done.has(e.name) || okPaks.has(e.name)) return false;   // pak đã đọc được cây → không quét thô nữa
        return unsup.has(e.name) || !!RAW_EXT[extOf(e.name)];
      }).sort(function (a, b) { return (unsup.has(b.name) ? 1 : 0) - (unsup.has(a.name) ? 1 : 0) || b.size - a.size; }).slice(0, LIMITS.raw_max_files);
      let rawBytes = 0; out.raw = [];
      for (let i = 0; i < rc.length; i++) {
        chk(); const e = rc[i];
        if (rawBytes + e.size > LIMITS.raw_total_bytes) { out.warnings.push('Quét thô dừng ở giới hạn ' + Math.round(LIMITS.raw_total_bytes / 1048576) + ' MB; bỏ ' + (rc.length - i) + ' file.'); break; }
        try {
          if (opts.onRawProgress) opts.onRawProgress(e.name, i, rc.length);
          const r = await NS.RawStrings.scanEntry(file, e, { isCancelled: cancelled }); rawBytes += e.size;
          const kept = r.rows.map(function (x) { const c = confidence(x.text); return c === null ? null : { key: '@0x' + x.offset.toString(16), text: x.text, lang: null, ctx: 'quét thô ' + x.enc + ' (chưa biết cấu trúc file)', conf: c }; }).filter(Boolean);
          const before = out.rows.length;
          addRows('raw:' + e.name, e.name, { format: 'raw', rows: kept, bad: 0, enc: 'raw' }, langOfPath(e.name));
          out.raw.push({ file: e.name, bytes: r.bytes, rows: out.rows.length - before, truncated: r.truncated });
          if (unsup.has(e.name)) { const u = out.unsupported.find(function (x) { return x.file === e.name; }); if (u) u.raw_rows = out.rows.length - before; }
        } catch (err) { if (err && err.code === 'CANCELLED') throw err; out.skipped.push({ container: 'raw', file: e.name, reason: (err && err.message) || String(err) }); }
      }
      if (out.raw.length) out.warnings.push('Quét thô [HYPOTHESIS]: ' + out.raw.length + ' file, có thể lẫn rác và bỏ sót text nén/mã hóa; mỗi dòng có offset để đối chiếu.');
    }

    /* tóm tắt + kiểm tra (validate) */
    const byLang = {}, byFmt = {}; let withPh = 0, low = 0, emptyT = 0, dups = 0;
    out.rows.forEach(function (r) {
      byLang[r.lang || '(không rõ)'] = (byLang[r.lang || '(không rõ)'] || 0) + 1; byFmt[r.format] = (byFmt[r.format] || 0) + 1;
      if (r.placeholders.length) withPh++; if (r.confidence === 'low') low++; if (r.text === '') emptyT++; if (r.context === 'khóa trùng trong file') dups++;
    });
    out.summary = { rows: out.rows.length, files: out.files.length, skipped: out.skipped.length, unsupported: out.unsupported.length, by_lang: byLang, by_format: byFmt,
      with_placeholders: withPh, low_confidence: low, empty_text: emptyT, duplicate_keys: dups, pak_fonts: out.pak_fonts.length, pak_fonts_ok: out.pak_fonts.filter(function (f) { return f.ok; }).length,
      pak_fonts_vi: { full: out.pak_fonts.filter(function (f) { return f.metrics && f.metrics.vietnamese && f.metrics.vietnamese.level === 'full'; }).length, partial: out.pak_fonts.filter(function (f) { return f.metrics && f.metrics.vietnamese && f.metrics.vietnamese.level === 'partial'; }).length, none: out.pak_fonts.filter(function (f) { return f.metrics && f.metrics.vietnamese && f.metrics.vietnamese.level === 'none'; }).length } };
    if (out.rows.length) { out.status = 'ok'; out.reason = out.rows.length + ' dòng text từ ' + out.files.length + ' file' + (out.pak_fonts.length ? ' · ' + out.pak_fonts.length + ' font trong pak' : ''); }
    else if (out.pak_fonts.length) { out.status = 'ok'; out.reason = 'Không có text; có ' + out.pak_fonts.length + ' font trong pak'; }
    return out;
  }

  /** Gói dịch: file GỐC (đúng đường dẫn) + manifest.json + texts.csv + HUONG_DAN.txt. Trả mảng {name,data}. */
  function toPack(r, meta) {
    meta = meta || {}; const enc = new TextEncoder(), files = [];
    const sha = function (u8) { try { const h = NS.Hash.create('sha256'); h.update(u8); return h.hex(); } catch (_) { return null; } };
    const man = { schema: 'translation_pack/1', ipa: meta.ipa || null, bundleId: meta.bundleId || null, version: meta.version || null, engine: meta.engine || null, created: new Date().toISOString(),
      note: 'Dịch NỘI DUNG text; GIỮ NGUYÊN tên file, đường dẫn, cấu trúc, ID/khóa, placeholder (::x::, {x@XX}, %s, {0}, <tag>). Trả lại file cùng tên.',
      files: (r._src || []).map(function (f) { return { file: f.name, container: f.container, path: f.path, format: f.format, size: f.data.length, sha256: sha(f.data), pak: f.pak || null, pak_data_offset: f.pak_data_offset === undefined ? null : f.pak_data_offset }; }),
      font_inventory: r.font_inventory || [],
      not_exported: (r.raw || []).map(function (x) { return { file: x.file, reason: 'định dạng chưa có trình đọc – chỉ có dòng text quét thô trong texts.csv (có offset)', rows: x.rows }; }) };
    (r._src || []).forEach(function (f) { files.push({ name: 'translation_pack/' + f.name, data: f.data }); });
    files.push({ name: 'translation_pack/manifest.json', data: enc.encode(JSON.stringify(man, null, 2)) });
    files.push({ name: 'translation_pack/texts.csv', data: enc.encode(toCsv(r)) });
    files.push({ name: 'translation_pack/HUONG_DAN.txt', data: enc.encode(
      'GÓI DỊCH – ' + (meta.bundleId || '') + '\r\n' +
      '1. Dịch text trong các file thư mục ipa/ và pak/. KHÔNG đổi tên file, KHÔNG đổi cấu trúc.\r\n' +
      '2. File .cdb (CastleDB): chỉ dịch giá trị của các cột có kind="localizable"; giữ nguyên id, tag, đường dẫn tài nguyên.\r\n' +
      '3. Giữ nguyên mọi placeholder: ::prct::, ::+power::, {Từ@XX}, %s, %d, {0}, <b>…</b>, \\n.\r\n' +
      '4. texts.csv chỉ để tham khảo (cột key cho biết vị trí chuỗi trong file).\r\n' +
      '5. Trả lại các file đã dịch cùng tên + cùng thư mục con (ipa/… và pak/…).\r\n' +
      '6. File font/atlas (manifest.font_inventory) KHÔNG dịch: dùng để dựng font tiếng Việt thay thế.\r\n') });
    return files;
  }

  function toCsv(r) {
    const lines = [CSV_COLS.join(',')];
    r.rows.forEach(function (x) { lines.push([x.container, x.file, x.format, x.lang, x.key, x.text, x.confidence, x.placeholders.join(' '), x.context].map(csvEscape).join(',')); });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }
  function toIndex(r) {
    return { raw: r.raw || [], font_inventory: r.font_inventory || [], schema: SCHEMA, status: r.status, reason: r.reason, summary: r.summary, files: r.files, skipped: r.skipped, unsupported: r.unsupported, pak_fonts: r.pak_fonts, warnings: r.warnings, limitations: r.limitations };
  }
  function fontFiles(r) { return (r._fontBlobs || []).slice(); }

  NS.TextExtract = { SCHEMA: SCHEMA, LIMITS: LIMITS, run: run, extractBytes: extractBytes, LANG: LANG, parseCdb: parseCdb, parseBmfont: parseBmfont, fontMetricsOf: fontMetricsOf, parseStringsText: parseStringsText, parseXml: parseXml, parsePo: parsePo, parseCsv: parseCsv, splitCsv: splitCsv, csvEscape: csvEscape, parseXcstrings: parseXcstrings, parseJsonWalk: parseJsonWalk, parseProperties: parseProperties, decode: decode, extOf: extOf,
    placeholders: placeholders, confidence: confidence, fontMagic: fontMagic, toCsv: toCsv, toPack: toPack, toIndex: toIndex, fontFiles: fontFiles };
})(typeof window !== 'undefined' ? window : self);
