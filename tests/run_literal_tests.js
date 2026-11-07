// Chạy: python3 tests/make_literal_ipas.py DIR && node tests/run_literal_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 4.3 (string literal). Metadata GIẢ LẬP dựng độc lập bằng Python: chỉ chứng minh logic, không chứng minh độ chính xác trên metadata thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, MD = NS.MetadataDump, dir = process.argv[2] || '/tmp/fake_ipas';
const exp = JSON.parse(fs.readFileSync(path.join(dir, 'm43_expected.json'), 'utf8'));
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const run = async function (name, steps, cancelAfter) {
  const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa');
  let cancelled = false;
  const h = { step: function (id, st, msg) { if (steps) steps.push([id, st, msg]); if (cancelAfter && id === cancelAfter && st === 'running') cancelled = true; }, progress() {}, log() {} };
  return NS.IpaReader.analyze(file, { hashMode: 'fast' }, h);
};
const lit = async function (name) { const r = await run(name); return r.unity.metadata_literals; };

(async function () {
  /* 1. Đúng nội dung, đúng thứ tự, đúng index; Unicode, trùng, rỗng, markup/placeholder giữ nguyên */
  for (const nm of ['m43_ok_v24', 'm43_ok_v29_stored', 'm43_v31']) {
    const L = await lit(nm), want = exp[nm === 'm43_v31' ? 'm43_ok_v24' : nm].strings;
    ok(L && L.schema === 'unity_string_literals/1' && L.sub_phase === '4.3' && L.status === 'ok', nm + ': status=' + (L && L.status) + ' ' + (L && L.reason));
    ok(L.count === want.length && L.literals.length === want.length, nm + ': count=' + L.count);
    ok(L.literals.every(function (e, i) { return e.index === i && e.text === want[i]; }), nm + ': text từng mục khớp bản dựng độc lập (kể cả Unicode, markup, trùng)');
    ok(L.literals[1].flags.indexOf('empty') >= 0 && L.empty === 1, nm + ': chuỗi rỗng có cờ empty');
    ok(L.distinct === new Set(want).size && L.distinct < want.length, nm + ': distinct=' + L.distinct + ' nhưng KHÔNG gộp (count=' + L.count + ')');
    ok(L.literals[0].data_index === L.literals[5].data_index && L.literals[0].length === 10, nm + ': trùng giữ data_index/length gốc');
    ok(L.total_text_bytes === want.reduce(function (a, s) { return a + Buffer.byteLength(s); }, 0), nm + ': tổng byte');
    ok(L.out_of_range === 0 && L.invalid_utf8 === 0, nm + ': không lỗi');
    ok(L.source.table.offset === 264 && L.source.struct_size === 8, nm + ': nguồn bảng');
  }
  { const r = await run('m43_ok_v24'), u = r.unity;
    ok(u.schema === 'unity_info/3' && u.sub_phase === '4.3' && u.metadata_literals.status === 'ok', 'unity_info/3');
    ok(JSON.stringify(structuredClone(u)) === JSON.stringify(u), 'structuredClone'); }

  /* 2. Lỗi dữ liệu: có cờ, không bỏ im lặng */
  let L = await lit('m43_invalid_utf8'), e = exp.m43_invalid_utf8;
  ok(L.status === 'ok' && L.count === e.n && L.invalid_utf8 === 1 && L.literals[e.bad_index].flags.indexOf('invalid_utf8') >= 0 && L.literals[e.bad_index].text.indexOf('�') >= 0, 'UTF-8 lỗi: cờ + thay ký tự lỗi');
  ok(L.literals[e.bad_index + 1].text === 'ok', 'UTF-8 lỗi: mục sau vẫn đúng');
  L = await lit('m43_one_oor'); e = exp.m43_one_oor;
  ok(L.status === 'ok' && L.out_of_range === 1 && L.literals[e.oor_index].text === null && L.literals[e.oor_index].flags.indexOf('out_of_range') >= 0 && L.literals.length === e.n, 'một mục ngoài vùng: text=null + cờ, các mục còn lại giữ');
  L = await lit('m43_all_oor'); ok(L.status === 'invalid_table' && L.literals.length === 0 && /bố cục thực tế có thể khác/.test(L.reason), 'hỏng nặng → invalid_table, không xuất literal: ' + L.status);
  L = await lit('m43_table_not_div8'); ok(L.status === 'invalid_table' && L.count === 0, 'bảng không chia hết 8: ' + L.status);
  L = await lit('m43_empty_table'); ok(L.status === 'ok' && L.count === 0 && L.literals.length === 0, 'bảng rỗng: ' + L.status + ' ' + L.reason);

  /* 3. Version chưa xác minh: không đoán */
  for (const [nm, v] of [['m43_v33_unsupported', 33], ['m43_v35_unsupported', 35]]) {
    const r = await run(nm), l = r.unity.metadata_literals;
    ok(r.unity.metadata_header.status === 'generic_ok' && l.status === 'unsupported_version' && l.version === v && l.literals.length === 0, nm + ': ' + l.status);
  }

  /* 4. Không đủ điều kiện: header không đạt / không có metadata → không chạy, bước skipped */
  for (const nm of ['m42_bad_magic', 'm42_version_25', 'm42_zero_first_offset', 'm42_no_metadata', 'm42_mono', 'm42_not_unity']) {
    const steps = [], r = await run(nm, steps), l = r.unity.metadata_literals, st = steps.filter(function (s) { return s[0] === 'literals'; }).pop();
    ok(!l && st && st[1] === 'skipped', nm + ': không chạy trích xuất (literals=' + (l && l.status) + ', step=' + (st && st[1]) + ')');
  }
  { const steps = []; await run('m43_ok_v24', steps); const ids = steps.map(function (s) { return s[0]; });
    ok(ids.lastIndexOf('literals') > ids.indexOf('metadata') && steps.filter(function (s) { return s[0] === 'literals' && s[1] === 'done'; }).length === 1, 'thứ tự bước metadata → literals'); }

  /* 5. Quy mô, hủy, đầu vào xấu */
  { const t0 = Date.now(); L = await lit('m43_many');
    ok(L.status === 'ok' && L.count === exp.m43_many.n && L.literals[119999].text === 'string-119999' && L.literals[0].text === 'string-000000', '120.000 literal: ' + L.count + ' (' + (Date.now() - t0) + ' ms)'); }
  { const file = new File([fs.readFileSync(path.join(dir, 'm43_many.ipa'))], 'x.ipa'), res = await NS.IpaReader.analyze(file, { hashMode: 'fast' }, { step() {}, progress() {}, log() {} });
    const zip = await NS.IpaReader.openZip(file); let threw = null;
    try { await MD.extractLiterals(file, res.unity, zip.entries, { isCancelled: function () { return true; } }); } catch (x) { threw = x.code; }
    ok(threw === 'CANCELLED', 'hủy giữa chừng: ' + threw);
    const bad = await MD.extractLiterals(file, res.unity, [], {}); ok(bad.status === 'read_error', 'entry không có: ' + bad.status);
    ok((await MD.extractLiterals(null, null, [], {})).status === 'not_eligible', 'unity=null → not_eligible');
    const rf = await MD.extractLiterals({ slice() { throw new Error('boom'); } }, res.unity, zip.entries, {}); ok(rf.status === 'read_error' && /boom/.test(rf.reason), 'lỗi đọc → read_error'); }
  { const big = new Uint8Array(8 * 3); const dv = new DataView(big.buffer); dv.setUint32(0, 3, true); dv.setUint32(4, 0, true);
    const d = MD.decodeLiterals(big, new TextEncoder().encode('abc')); ok(d.literals[0].text === 'abc' && d.literals.length === 3 && d.empty === 2, 'decodeLiterals thuần'); }

  /* 6. Summary/report: nêu rõ phần chưa hỗ trợ, không bịa */
  { const r = await run('m43_ok_v24'), mh = r.unity.metadata_header, l = r.unity.metadata_literals;
    const sm = MD.toSummary(mh, l), rep = MD.toReportFields(mh, l);
    ok(sm.schema === 'metadata_summary/3' && sm.partial === true && sm.string_literals.count === 9 && sm.string_literals.status === 'ok', 'toSummary');
    ok(['assemblies', 'namespaces', 'classes', 'methods', 'fields'].every(function (k) { return sm.not_supported[k].status === 'not_supported'; }), 'summary: assembly/namespace/class/method/field = not_supported');
    ok(rep.string_literals_count === 9 && rep.metadata_not_supported.length === 5, 'toReportFields'); }

  console.log(fail ? ('CÓ ' + fail + ' LỖI / ' + n + ' kiểm tra') : ('TẤT CẢ ĐẠT (' + n + ' kiểm tra)'));
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('NGOẠI LỆ', e); process.exit(2); });
