// Chạy: python3 tests/make_fontmetrics_fonts.py DIR && node tests/run_fontmetrics_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 5.2b+5.3. Font dựng bằng fontTools; giá trị mong đợi đọc lại bằng fontTools (độc lập với parser JS).
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'font_metrics.js'), 'utf8'));
const FM = globalThis.IPAStudio.FontMetrics, dir = process.argv[2] || '/tmp/fake_ipas';
const EXP = JSON.parse(fs.readFileSync(path.join(dir, 'fontmetrics_expected.json'), 'utf8'));
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const raw = function (nm) { return new Uint8Array(fs.readFileSync(path.join(dir, 'fm_' + nm))); };
const rejects = async function (fn) { try { await fn(); return null; } catch (e) { return e; } };

(async function () {
  const R = FM.VI_REQUIRED;
  ok(R.length === 134 && R[0] === 0xC0 && R[R.length - 1] === 0x1EF9 && new Set(R).size === 134 && R.every(function (c, i) { return i === 0 || c > R[i - 1]; }), 'danh sách 134 ký tự Việt: số lượng, biên, duy nhất, sắp xếp');
  ok([0x103, 0x111, 0x1A1, 0x1B0, 0x1EA0, 0x1EB6, 0xC0, 0x1EF8].every(function (c) { return R.indexOf(c) >= 0; }) && R.indexOf(0x41) < 0, 'chứa ă đ ơ ư Ạ Ặ À Ỹ; không chứa ASCII');
  const cmp = function (name, f, e) {
    const v = f.vietnamese;
    ok(f.names.family === e.family && f.names.subfamily === e.subfamily && f.names.full === e.full && f.names.postscript === e.postscript && (e.version === undefined || f.names.version === e.version), name + ': tên font ' + JSON.stringify([f.names.family, f.names.subfamily, f.names.full, f.names.postscript]));
    if (e.upem !== undefined) ok(f.units_per_em === e.upem && f.num_glyphs === e.glyphs, name + ': unitsPerEm/numGlyphs ' + f.units_per_em + '/' + f.num_glyphs);
    if (e.cps !== undefined) ok(f.cmap.status === 'ok' && f.cmap.code_points === e.cps, name + ': số code point ' + f.cmap.code_points + ' (mong đợi ' + e.cps + ')');
    if (e.level !== undefined) ok(v.level === e.level && v.covered === e.covered && v.missing_count === e.missing && v.ascii_letters_ok === e.ascii_ok && v.required === 134, name + ': độ phủ Việt ' + JSON.stringify([v.level, v.covered, v.missing_count, v.ascii_letters_ok]) + ' (mong đợi ' + JSON.stringify([e.level, e.covered, e.missing, e.ascii_ok]) + ')');
    if (e.fmt !== undefined) ok(f.cmap.chosen && f.cmap.chosen.format === e.fmt, name + ': cmap format ' + (f.cmap.chosen && f.cmap.chosen.format) + ' (mong đợi ' + e.fmt + ')');
  };
  for (const name of ['full_vi_bmp.ttf', 'full_vi_astral.ttf', 'partial_vi.ttf', 'ascii_only.ttf', 'cff_full.otf', 'almost_full.ttf', 'nonascii_letters_missing.ttf', 'full_vi.woff', 'partial_vi.woff']) {
    const e = EXP[name], p = await FM.parse(raw(name));
    ok(p.status === 'parsed' && p.container === e.container && p.fonts.length === 1, name + ': status=' + p.status + ' container=' + p.container + ' ' + p.reason);
    if (p.fonts.length) { cmp(name, p.fonts[0], e); ok(p.fonts[0].problems.length === 0, name + ': không vấn đề ' + JSON.stringify(p.fonts[0].problems)); }
  }
  { const p = await FM.parse(raw('cff_full.otf')); ok(p.fonts[0].flavor === 'cff' && p.fonts[0].tables.indexOf('CFF ') >= 0, 'OTF: flavor cff + bảng CFF'); const t = await FM.parse(raw('full_vi_bmp.ttf')); ok(t.fonts[0].flavor === 'truetype' && t.fonts[0].tables.indexOf('glyf') >= 0, 'TTF: flavor truetype'); }
  { const p = await FM.parse(raw('almost_full.ttf')); ok(p.fonts[0].vietnamese.level === 'partial' && eq(p.fonts[0].vietnamese.missing, ['U+1EF9']), 'thiếu đúng 1 ký tự (ỹ U+1EF9) → partial và liệt kê đúng ký tự thiếu'); }
  { const p = await FM.parse(raw('nonascii_letters_missing.ttf')); ok(p.fonts[0].vietnamese.level === 'full' && p.fonts[0].vietnamese.ascii_letters_ok === false, 'đủ 134 ký tự Việt nhưng thiếu chữ ASCII: level full + ascii_letters_ok=false (hai thông tin tách biệt)'); }
  { const p = await FM.parse(raw('partial_vi.ttf')); const v = p.fonts[0].vietnamese; ok(v.level === 'partial' && v.missing.length === Math.min(v.missing_count, FM.LIMITS.max_listed_missing) && v.missing.every(function (x) { return /^U\+[0-9A-F]{4}$/.test(x); }), 'danh sách thiếu đúng định dạng U+XXXX'); ok(v.percent === Math.round(v.covered * 1000 / 134) / 10, 'phần trăm làm tròn 1 chữ số'); }
  for (const name of ['notdef_seq.ttf', 'notdef_scr.ttf', 'notdef_astral.ttf']) {
    const e = EXP[name], p = await FM.parse(raw(name)), f = p.fonts[0]; ok(p.status === 'parsed' && e.missing === 2 && f.vietnamese.missing_count === 2 && eq(f.vietnamese.missing, ['U+0111', 'U+1EA0']), name + ': ký tự ánh xạ tới glyph 0 (.notdef) KHÔNG tính là có: ' + JSON.stringify(f.vietnamese.missing)); cmp(name, f, e);
  }
  { const p = await FM.parse(raw('upem_bad.ttf')); ok(p.status === 'parsed' && p.fonts[0].units_per_em === 8 && p.fonts[0].problems.some(function (x) { return /unitsPerEm/.test(x); }), 'unitsPerEm = 8 bị báo'); }
  { const b = new Uint8Array(12 + 16 * 1001); b.set([0, 1, 0, 0, 0x03, 0xE9], 0); const p = await FM.parse(b); ok(p.status === 'invalid' && /1001/.test(p.reason), 'numTables = 1001 (vượt giới hạn 1000) → invalid dù thư mục nằm trong file'); }
  /* TTC */
  { const e = EXP['two.ttc'], p = await FM.parse(raw('two.ttc')); ok(p.status === 'parsed' && p.container === 'ttc' && p.fonts.length === 2, 'TTC: 2 font con'); if (p.fonts.length === 2) { cmp('ttc#0', p.fonts[0], e.fonts[0]); cmp('ttc#1', p.fonts[1], e.fonts[1]); ok(p.fonts[0].index === 0 && p.fonts[1].index === 1, 'TTC: chỉ số font con'); } }
  /* Tên Mac */
  { const e = EXP['mac_names.ttf'], p = await FM.parse(raw('mac_names.ttf')); ok(p.status === 'parsed' && p.fonts[0].names.family === 'Café Mono' && p.fonts[0].names.postscript === e.postscript && p.fonts[0].names.full === e.full, 'tên chỉ có bản ghi Mac (MacRoman) giải mã đúng "Café": ' + JSON.stringify(p.fonts[0].names)); }
  /* cmap không dùng được */
  { const p = await FM.parse(raw('symbol_cmap.ttf')), f = p.fonts[0]; ok(p.status === 'parsed' && f.cmap.status === 'no_unicode_cmap' && f.vietnamese.level === 'unknown' && f.vietnamese.covered === null, 'cmap (3,0) → no_unicode_cmap, level unknown (không bịa số)'); }
  { const p = await FM.parse(raw('cmap_bad.ttf')), f = p.fonts[0]; ok(p.status === 'parsed' && f.cmap.status === 'invalid' && f.vietnamese.level === 'unknown' && f.problems.some(function (x) { return /cmap/.test(x); }), 'cmap khai báo subtable vô lý → invalid + unknown + vấn đề'); }
  { const p = await FM.parse(raw('truncated.ttf')); ok(p.status === 'parsed' && p.fonts[0].problems.some(function (x) { return /vượt file/.test(x); }), 'font cắt cụt: bảng vượt file được báo, không ném'); }
  { const p = await FM.parse(raw('no_head.ttf')); ok(p.status === 'parsed' && p.fonts[0].units_per_em === null && p.fonts[0].problems.some(function (x) { return /head/.test(x); }), 'thiếu head: unitsPerEm=null + vấn đề'); }
  ok((await FM.parse(raw('numtables_huge.ttf'))).status === 'invalid', 'numTables 65535 → invalid');
  ok((await FM.parse(raw('random.bin'))).status === 'not_font' && (await FM.parse(raw('empty.bin'))).status === 'not_font' && (await FM.parse(raw('tiny.ttf'))).status === 'not_font', 'rác/rỗng/quá ngắn → not_font');
  { const p = await FM.parse(raw('stub.woff2')); ok(p.status === 'unsupported_woff2' && p.container === 'woff2', 'WOFF2 → unsupported_woff2'); }
  ok((await FM.parse(null)).status === 'not_font' && (await FM.parse('abc')).status === 'not_font', 'parse(null/chuỗi) không ném');
  { const w = new Uint8Array(raw('full_vi.woff')); w[12] = 0xFF; w[13] = 0xFF; ok((await FM.parse(w)).status === 'invalid', 'WOFF numTables vô lý → invalid'); }
  { const w = new Uint8Array(raw('full_vi.woff')); const n = (w[12] << 8) | w[13]; let off = 0; for (let i = 0; i < n; i++) { const o = 44 + 20 * i; if (String.fromCharCode(w[o], w[o + 1], w[o + 2], w[o + 3]) === 'cmap') off = (w[o + 4] << 24 | w[o + 5] << 16 | w[o + 6] << 8 | w[o + 7]) >>> 0; } for (let i = 0; i < 20; i++) w[off + 2 + i] ^= 0xFF; const p = await FM.parse(w); ok(p.status === 'parsed' && p.problems.some(function (x) { return /cmap|giải nén/.test(x); }) || p.fonts[0].vietnamese.level === 'unknown', 'WOFF bảng cmap bị phá: không ném, ghi vấn đề/unknown'); }
  { const old = FM.LIMITS.max_font_bytes; FM.LIMITS.max_font_bytes = 100; const p = await FM.parse(raw('full_vi_bmp.ttf')); FM.LIMITS.max_font_bytes = old; ok(p.status === 'too_large', 'file vượt giới hạn → too_large'); }
  { const old = FM.LIMITS.max_woff_total; FM.LIMITS.max_woff_total = 1000; const p = await FM.parse(raw('full_vi.woff')); FM.LIMITS.max_woff_total = old; ok(p.status === 'too_large', 'WOFF giải nén vượt giới hạn → too_large (chặn zip-bomb)'); }
  /* scan */
  const ipa = { font_files: { 'Fonts/A/full.ttf': raw('full_vi_bmp.ttf'), 'Fonts/A/part.woff': raw('partial_vi.woff'), 'Fonts/A/bm.fnt': new Uint8Array(30), 'Other/x.ttf': raw('full_vi_bmp.ttf'), 'Fonts/A/notbytes': 'x' },
    serialized_files: { 'Fonts/unity/Data_resources.assets/Orb_1.otf': raw('ascii_only.ttf'), 'Text/text_assets/x.txt': new Uint8Array(3), 'Fonts/unity/Data_level0/sym_2.ttf': raw('symbol_cmap.ttf') } };
  const S = await FM.scan(ipa, {});
  ok(S.schema === 'font_metrics/1' && S.items.length === 5 && S.status === 'partial', 'scan: 5 font (bỏ Other/, Text/, không phải bytes), status=' + S.status + ' ' + S.reason);
  ok(S.summary.parsed === 4 && S.summary.vietnamese_full === 1 && S.summary.vietnamese_partial === 1 && S.summary.vietnamese_none === 1 && S.summary.vietnamese_unknown === 1 && S.summary.by_status.not_font === 1, 'scan: tổng hợp độ phủ ' + JSON.stringify(S.summary));
  { const it = function (p) { return S.items.find(function (x) { return x.path === p; }); };
    ok(it('Fonts/A/full.ttf').source === 'ipa_file' && it('Fonts/unity/Data_resources.assets/Orb_1.otf').source === 'unity_font' && it('Fonts/unity/Data_level0/sym_2.ttf').source === 'unity_font', 'nguồn: ipa_file / unity_font');
    ok(it('Fonts/A/full.ttf').vietnamese_level === 'full' && it('Fonts/A/part.woff').vietnamese_level === 'partial' && it('Fonts/unity/Data_resources.assets/Orb_1.otf').vietnamese_level === 'none' && it('Fonts/unity/Data_level0/sym_2.ttf').vietnamese_level === 'unknown' && it('Fonts/A/bm.fnt').status === 'not_font' && it('Fonts/A/bm.fnt').vietnamese_level === null, 'mức Việt từng font đúng'); }
  ok(JSON.stringify(FM.toIndex(S)) && FM.toReportFields(S).fonts_vi_full === 1 && typeof structuredClone(S) === 'object', 'JSON/structuredClone/report');
  ok(S.limitations.length === 5 && S.vietnamese_required === 134, 'ghi rõ phần chưa làm');
  { let c = 0; const e = await rejects(function () { return FM.scan(ipa, { isCancelled: function () { return ++c > 2; } }); }); ok(e && e.code === 'CANCELLED', 'scan hủy giữa chừng'); }
  { const old = FM.LIMITS.max_fonts; FM.LIMITS.max_fonts = 2; const x = await FM.scan(ipa, {}); FM.LIMITS.max_fonts = old; ok(x.items.length === 2 && x.warnings.some(function (w) { return /chỉ xử lý 2/.test(w); }), 'giới hạn số font + cảnh báo'); }
  ok((await FM.scan(null, {})).status === 'not_run' && (await FM.scan({}, {})).status === 'no_fonts' && (await FM.scan({ font_files: {} }, {})).summary.fonts === 0, 'scan đầu vào xấu/không có font');
  console.log(fail ? ('THẤT BẠI ' + fail + '/' + n) : ('Tất cả ' + n + ' kiểm tra đạt'));
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('LỖI TEST', e && e.stack || e); process.exit(2); });
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
