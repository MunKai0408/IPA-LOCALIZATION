/* raw_strings.js – PHƯƠNG ÁN DỰ PHÒNG cho MỌI engine/định dạng chưa có trình đọc riêng.
   Không cần biết header/cây file: đọc tuần tự (streamEntry, không nạp cả file vào RAM) và nhặt các chuỗi giống text người đọc được:
     - UTF-8 (ASCII + đa byte hợp lệ, gồm Việt/Trung/Nhật/Hàn/Nga…), UTF-16LE dạng Latin (byte cao = 0).
     - Bên trong một chuỗi dài: giá trị JSON "…" và nội dung XML >…< được tách riêng (JSON/cdb/XML nhỏ gọn nằm trong pak).
   Mỗi dòng ghi OFFSET (@hex) trong dữ liệu đã giải nén của container → dùng để vá lại sau này.
   NHÃN BẰNG CHỨNG: [HYPOTHESIS]. Có thể lẫn rác (chuỗi trong mã/ký hiệu) và bỏ sót (text nén/mã hóa/UTF-16 không phải Latin/đóng gói riêng).
   Dữ liệu mã hóa → quét không ra gì, trang báo 0 dòng chứ không đoán. Thuần hàm + 1 hàm I/O. Không ném lỗi (trừ CANCELLED). */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};
  const LIMITS = { min_len: 4, max_run: 65536, max_rows_per_file: 120000, max_text_len: 4000 };
  const HAS_LETTER = /\p{L}/u, NON_ASCII_LETTER = /[^\x00-\x7f]/;

  function letterRatio(t) { let l = 0; for (const ch of t) if (/\p{L}/u.test(ch)) l++; return l / Math.max(1, Array.from(t).length); }

  /* Phân loại chữ theo hệ: dữ liệu ngẫu nhiên trộn Latin + Hán + Cyrillic… trong 1 chuỗi ngắn, văn bản thật thì không. */
  const SCRIPTS = [['latin', /\p{Script=Latin}/u], ['han', /\p{Script=Han}/u], ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/u], ['hangul', /\p{Script=Hangul}/u], ['cyrillic', /\p{Script=Cyrillic}/u],
    ['arabic', /\p{Script=Arabic}/u], ['thai', /\p{Script=Thai}/u], ['greek', /\p{Script=Greek}/u], ['hebrew', /\p{Script=Hebrew}/u], ['devanagari', /\p{Script=Devanagari}/u]];
  function scriptsOf(t) {
    const seen = {}; for (const ch of t) { if (!/\p{L}/u.test(ch)) continue; let k = 'other'; for (let i = 0; i < SCRIPTS.length; i++) if (SCRIPTS[i][1].test(ch)) { k = SCRIPTS[i][0]; break; } seen[k] = (seen[k] || 0) + 1; }
    return seen;
  }
  /** Chuỗi có giống câu/nhãn người đọc? sure=true: đã nằm trong dấu ngoặc JSON/XML nên nới lỏng (cho phép nhãn 1 từ). */
  function plausible(t, sure) {
    t = t.trim(); if (!t) return false;
    if (t.length < LIMITS.min_len && !(sure && NON_ASCII_LETTER.test(t))) return false;
    if (!HAS_LETTER.test(t) || letterRatio(t) < 0.5) return false;
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ue000-\uf8ff\ufffd]/.test(t)) return false;
    const sc = scriptsOf(t), ks = Object.keys(sc);
    if (ks.length > 1 && !(ks.length === 2 && (sc.han && sc.kana))) return false;                  // trộn hệ chữ → rác (trừ Hán+Kana của tiếng Nhật)
    const sym = (t.match(/[^\p{L}\p{N}\s.,!?'’"“”\-:;()\/&%+…*~\[\]<>=@#_{}|\\]/gu) || []).length; if (sym / t.length > 0.08) return false;
    const toks = t.split(/\s+/).filter(Boolean), cjk = ks.length && ks.every(function (k) { return k === 'han' || k === 'kana' || k === 'hangul' || k === 'thai'; });
    if (cjk) return !/[A-Za-z]{2,}/.test(t) && (t.length >= 2 || sure);                         // CJK/Thái không có dấu cách: ≥ 2 ký tự, không lẫn từ ASCII
    if (toks.length >= 2) {                                                                          // ≥ 2 từ, mỗi từ phải có dạng chữ thường / Viết hoa đầu / IN HOA / số
      if (t.length < 8) return false;
      const core = function (w) { return w.replace(/^[("'“‘\[¿¡<{*-]+|[)"'”’\].,!?:;…>}*%-]+$/gu, ''); };
      let good = 0; for (let i = 0; i < toks.length; i++) { const c = core(toks[i]); if (c === '') continue; if (!/^(?:\p{Lu}?[\p{Ll}\p{M}'’\-]+|\p{Lu}+|\p{N}+[\p{Ll}%]*)$/u.test(c)) return false; if (Array.from(c).length >= 3) good++; }
      return good >= 1 && toks.length - good <= good + 2;
    }
    if (sure && /^\p{Lu}\p{Ll}{2,24}$/u.test(t)) return true;                                   // nhãn 1 từ chỉ nhận khi nằm trong JSON/XML
    return /^\p{Lu}?\p{Ll}[\p{Ll}\p{M}'’\-]{3,}[.!?…:]$/u.test(t);                                           // 1 từ có dấu câu cuối
  }

  /** Tách 1 chuỗi thô thành các text ứng viên. Thuần hàm. @returns {Array<{text,sure}>} */
  function splitRun(s) {
    const out = []; let m;
    if (s.indexOf('"') >= 0) {
      const re = /"((?:[^"\\]|\\.){2,})"/g;
      while ((m = re.exec(s))) { const v = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); if (plausible(v, true)) out.push({ text: v, sure: true }); }
      if (out.length) return out;
    }
    if (s.indexOf('<') >= 0 && s.indexOf('>') >= 0) {
      const re = />([^<>]{2,})</g;
      while ((m = re.exec(s))) if (plausible(m[1], true)) out.push({ text: m[1].trim(), sure: true });
      if (out.length) return out;
    }
    if (plausible(s, false)) out.push({ text: s.trim(), sure: false });
    return out;
  }

  /** Máy trạng thái quét luồng. feed(chunk) nhiều lần, end() cuối. emit({text, offset, enc}). Giữ trạng thái giữa các chunk. */
  function createScanner(emit, opts) {
    opts = opts || {};
    const maxRun = opts.max_run || LIMITS.max_run, dec = new TextDecoder('utf-8', { fatal: false });
    let run = new Uint8Array(1024), n = 0, runStart = 0, need = 0, pos = 0;                      // UTF-8
    let u = [], uStart = 0, uLoOk = false, uLo = 0;                                               // UTF-16LE Latin: (lo, 0)
    function pushU8(b) { if (n === run.length) { const r = new Uint8Array(run.length * 2); r.set(run); run = r; } run[n++] = b; }
    function endU8() {
      if (need > 0) { while (n > 0 && run[n - 1] >= 0x80 && run[n - 1] < 0xC0) n--; if (n > 0 && run[n - 1] >= 0xC0) n--; }   // cắt ký tự đa byte dở
      if (n >= LIMITS.min_len) {
        const s = dec.decode(run.subarray(0, n)); const parts = splitRun(s);
        for (let i = 0; i < parts.length; i++) emit({ text: parts[i].text.slice(0, LIMITS.max_text_len), offset: runStart, enc: 'utf-8' });
      }
      n = 0; need = 0;
    }
    function endU() { if (u.length >= LIMITS.min_len) { const s = String.fromCharCode.apply(null, u); if (plausible(s, false)) emit({ text: s.trim().slice(0, LIMITS.max_text_len), offset: uStart, enc: 'utf-16le' }); } u = []; }
    function feed(chunk) {
      for (let i = 0; i < chunk.length; i++, pos++) {
        const b = chunk[i];
        /* UTF-8 */
        if ((b >= 0x20 && b < 0x7f) || b === 9) { if (need > 0) { endU8(); } if (n === 0) runStart = pos; pushU8(b); }
        else if (b >= 0xC2 && b <= 0xF4) { if (need > 0) endU8(); if (n === 0) runStart = pos; pushU8(b); need = b >= 0xF0 ? 3 : b >= 0xE0 ? 2 : 1; }
        else if (b >= 0x80 && b < 0xC0 && need > 0) { pushU8(b); need--; }
        else if (n > 0) endU8();
        if (n >= maxRun) endU8();
        /* UTF-16LE Latin: cặp (ký tự in được, 0x00) */
        if (uLoOk) { if (b === 0) { if (u.length === 0) uStart = pos - 1; u.push(uLo); uLoOk = false; continue; } uLoOk = false; endU(); }
        if (b >= 0x20 && b < 0x7f) { uLo = b; uLoOk = true; } else if (u.length) endU();
        if (u.length >= 8192) endU();
      }
    }
    function end() { if (n > 0) endU8(); endU(); }
    return { feed: feed, end: end, get position() { return pos; } };
  }

  /** Quét 1 entry zip. @returns {Promise<{rows:Array<{text,offset,enc}>, bytes:number, truncated:boolean}>} */
  async function scanEntry(file, entry, opts) {
    opts = opts || {};
    const rows = [], seen = new Set(), cap = opts.max_rows || LIMITS.max_rows_per_file; let truncated = false;
    const sc = createScanner(function (r) {
      if (rows.length >= cap) { truncated = true; return; }
      if (seen.has(r.text)) return; seen.add(r.text); rows.push(r);
    });
    const res = await NS.IpaReader.streamEntry(file, entry, function (c) { sc.feed(c); }, { isCancelled: opts.isCancelled });
    sc.end();
    return { rows: rows, bytes: res.bytes, truncated: truncated };
  }

  NS.RawStrings = { LIMITS: LIMITS, plausible: plausible, splitRun: splitRun, createScanner: createScanner, scanEntry: scanEntry };
})(typeof window !== 'undefined' ? window : self);
