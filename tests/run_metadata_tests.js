// Chạy: python3 tests/make_metadata_ipas.py DIR && node tests/run_metadata_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 4.2 (header + phiên bản global-metadata.dat). IPA/HEADER GIẢ LẬP do script tự dựng: chỉ chứng minh logic, không chứng minh độ chính xác trên metadata thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, MD = NS.MetadataDump, dir = process.argv[2] || '/tmp/fake_ipas';
const exp = JSON.parse(fs.readFileSync(path.join(dir, 'm42_expected.json'), 'utf8'));
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const hooks = { step() {}, progress() {}, log() {} };
const run = async function (name, steps) {
  const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa');
  const h = steps ? { step: function (id, st, msg) { steps.push([id, st, msg]); }, progress() {}, log() {} } : hooks;
  return NS.IpaReader.analyze(file, { hashMode: 'standard' }, h);
};
const mh = async function (name) { const r = await run(name); return r.unity && r.unity.metadata_header; };
const has = function (m, code) { return m.findings.some(function (f) { return f.code === code; }); };
const le = function (arr) { return Uint8Array.from(arr); };

(async function () {
  /* ---- 1. Header giả lập đúng cấu trúc: đối chiếu với bytes trong file ---- */
  let r = await run('m42_ok_v24'), u = r.unity, m = u.metadata_header;
  ok(u.schema === 'unity_info/3' && u.sub_phase === '4.3', 'unity schema/sub_phase');
  ok(m && m.schema === 'metadata_header/1' && m.sub_phase === '4.2', 'header schema');
  ok(m.status === 'generic_ok', 'v24: status=' + m.status + ' ' + m.reason);
  ok(m.magic.matches === true && m.magic.hex === 'AF 1B B1 FA', 'v24: magic');
  ok(m.version.value === 24 && m.version.in_reference_list === true, 'v24: version');
  ok(m.header.header_size === 264 && m.header.first_table_offset === 264 && m.header.pair_count === 32, 'v24: header 264 B / 32 cặp');
  ok(m.file_size === exp.m42_ok_v24.size, 'v24: file_size=' + m.file_size);
  ok(m.header.empty_tables === 32 - 8 - 24 + 2, 'v24: số bảng rỗng=' + m.header.empty_tables);   // SZ có 2 phần tử 0 trong 8 đầu; còn lại 24 phần tử 32 + 0 cặp thừa
  ok(m.header.pairs[0].offset === 264 && m.header.pairs[0].size === 100 && m.header.pairs[2].size === 300, 'v24: cặp đối chiếu bytes');
  const raw = fs.readFileSync(path.join(dir, 'm42_ok_v24.ipa'));
  ok(m.header.overlaps === 0 && m.header.max_table_end === exp.m42_ok_v24.size && m.header.trailing_bytes === 0, 'v24: không chồng chéo, bảng cuối = hết file');
  ok(m.layout.field_names_verified === false && m.layout.field_parse_supported === false, 'v24: không nhận đã xác minh bố cục trường');
  ok(m.path === 'Data/Managed/Metadata/global-metadata.dat' && m.entry_path === 'Payload/Game.app/' + m.path, 'v24: path/entry_path');
  ok(m.bytes_read <= MD.READ_LIMIT && m.bytes_read > 0, 'v24: bytes_read=' + m.bytes_read);
  ok(u.metadata_input.status === 'selected', 'v24: 4.1 vẫn chọn file');
  ok(m.raw_header_hex.indexOf('AF 1B B1 FA 18 00 00 00 08 01 00 00') === 0, 'v24: raw hex (264 = 08 01 00 00)');
  ok(JSON.stringify(m).length > 0 && JSON.stringify(structuredClone(m)) === JSON.stringify(m), 'v24: JSON/structuredClone');

  m = await mh('m42_ok_v29');
  ok(m.status === 'generic_ok' && m.version.value === 29 && m.header.header_size === 272 && m.header.pair_count === 33, 'v29: ' + m.status);
  m = await mh('m42_ok_v31_trailing');
  ok(m.status === 'generic_ok' && m.header.trailing_bytes === 77 && has(m, 'trailing_bytes'), 'v31 trailing=' + m.header.trailing_bytes);

  /* ---- 2. Lỗi/không hỗ trợ: trạng thái có cấu trúc, không ném lỗi, không đoán ---- */
  m = await mh('m42_bad_magic');
  ok(m.status === 'bad_magic' && m.magic.matches === false && m.version === null && m.header === null, 'bad_magic: ' + m.status);
  ok(/CÓ THỂ/.test(m.reason) && !/chắc chắn bị mã hóa/.test(m.reason), 'bad_magic: lời lẽ “có thể”, không khẳng định mã hóa');
  for (const nm of ['m42_short_6', 'm42_short_8', 'm42_short_10']) {
    m = await mh(nm);
    ok(m.status === 'invalid_header' && has(m, 'too_small'), nm + ': ' + m.status);
  }
  m = await mh('m42_short_8'); ok(m.version && m.version.value === 24, 'short_8: vẫn đọc được version');
  m = await mh('m42_empty'); ok(m.status === 'invalid_header' && has(m, 'too_small') && m.bytes_read === 0, 'file 0 byte: ' + m.status);
  m = await mh('m42_offset_beyond'); ok(m.status === 'invalid_header' && has(m, 'offset_beyond_file'), 'offset vượt file: ' + m.status);
  m = await mh('m42_range_beyond'); ok(m.status === 'invalid_header' && has(m, 'range_beyond_file'), 'offset+size vượt file: ' + m.status);
  m = await mh('m42_offset_in_header'); ok(m.status === 'invalid_header' && has(m, 'offset_in_header'), 'offset trong header: ' + m.status);
  m = await mh('m42_negative'); ok(m.status === 'invalid_header' && has(m, 'negative'), 'giá trị âm: ' + m.status);
  m = await mh('m42_overlap'); ok(m.status === 'generic_ok' && m.header.overlaps >= 1 && has(m, 'overlap'), 'chồng chéo → cảnh báo, status=' + m.status);
  for (const [nm, v] of [['m42_version_23', 23], ['m42_version_15', 15], ['m42_version_150', 150]]) {
    m = await mh(nm);
    ok(m.status === 'unsupported_version' && m.version.value === v && m.header === null && m.raw_header_hex.length > 0, nm + ': ' + m.status);
  }
  m = await mh('m42_version_999999'); ok(m.status === 'invalid_header' && has(m, 'version_implausible'), 'version 999999: ' + m.status);
  m = await mh('m42_version_neg'); ok(m.status === 'invalid_header' && has(m, 'version_implausible'), 'version âm: ' + m.status);
  m = await mh('m42_zero_first_offset'); ok(m.status === 'header_unverified' && m.header.pairs.length === 0 && has(m, 'generic_check_not_applicable'), 'offset đầu = 0: ' + m.status);
  m = await mh('m42_huge_first_offset'); ok(m.status === 'header_unverified', 'offset đầu 5000 > byte hiện có: ' + m.status);
  m = await mh('m42_odd_header'); ok(m.header && m.header.header_size === 36 && m.header.pair_count === 3 && has(m, 'pairs_not_even'), 'header lẻ: ' + (m.header && m.header.header_size));

  /* ---- 3. Không áp dụng: không đọc, không ném lỗi, pipeline vẫn xong ---- */
  for (const [nm, want] of [['m42_no_metadata', 'missing'], ['m42_ambiguous', 'ambiguous'], ['m42_mono', 'not_il2cpp']]) {
    const steps = []; r = await run(nm, steps);
    ok(r.unity.metadata_input.status === want, nm + ': 4.1=' + r.unity.metadata_input.status);
    ok(r.unity.metadata_header && r.unity.metadata_header.status === 'not_checked' && r.unity.metadata_header.bytes_read === 0 && r.unity.metadata_header.applicable === false, nm + ': not_checked, 0 byte');
    const st = steps.filter(function (s) { return s[0] === 'metadata'; }).pop();
    ok(st && st[1] === 'skipped', nm + ': bước metadata skipped');
  }
  { const steps = []; r = await run('m42_not_unity', steps); const st = steps.filter(function (s) { return s[0] === 'metadata'; }).pop();
    ok(r.unity.status === 'not_unity' && r.unity.metadata_header === null && st && st[1] === 'skipped', 'không phải Unity: header=null, skipped'); }
  { const steps = []; await run('m42_ok_v24', steps); const ids = steps.map(function (s) { return s[0]; });
    ok(ids.indexOf('metadata') > ids.indexOf('unity') && steps.filter(function (s) { return s[0] === 'metadata' && s[1] === 'done'; }).length === 1, 'thứ tự bước unity → metadata, done'); }

  /* ---- 4. Chỉ đọc header: đếm byte thật sự đọc từ File ---- */
  for (const nm of ['m42_big_stored', 'm42_big_deflated']) {
    const real = new File([fs.readFileSync(path.join(dir, nm + '.ipa'))], nm + '.ipa');
    // dò: chạy analyze bình thường để lấy unity + entries, sau đó đo riêng MetadataDump.check trên File bọc bộ đếm
    const res = await NS.IpaReader.analyze(real, { hashMode: 'fast' }, hooks);
    const zip = await NS.IpaReader.openZip(real);
    let counted = 0;
    const wrap = function (blob) {
      return { size: blob.size, slice: function (a, b) { return wrap(blob.slice(a, b)); },
               arrayBuffer: async function () { const ab = await blob.arrayBuffer(); counted += ab.byteLength; return ab; },
               stream: function () { const s = blob.stream(); return s.pipeThrough(new TransformStream({ transform(c, ctl) { counted += c.length; ctl.enqueue(c); } })); } };
    };
    const t0 = Date.now();
    const h = await MD.check(wrap(real), res.unity, zip.entries, hooks);
    const ms = Date.now() - t0;
    ok(h.status === 'generic_ok', nm + ': status=' + h.status + ' ' + h.reason);
    ok(h.file_size > 15 * 1024 * 1024, nm + ': file_size lớn=' + h.file_size);
    ok(h.bytes_read <= MD.READ_LIMIT, nm + ': bytes_read=' + h.bytes_read);
    const limit = nm === 'm42_big_stored' ? MD.READ_LIMIT + 64 + 30 : 2 * 1024 * 1024;   // deflate: trình giải nén đọc theo chunk; phải ≪ file
    ok(counted > 0 && counted <= limit, nm + ': byte thật sự đọc từ file = ' + counted + ' (giới hạn ' + limit + '; file ' + h.file_size + '), ' + ms + ' ms');
  }

  /* ---- 5. Hàm thuần / đầu vào xấu ---- */
  ok(MD.inspectHeader(le([]), 0).status === 'invalid_header', 'inspect: rỗng');
  ok(MD.inspectHeader(null, 10).status === 'invalid_header', 'inspect: null');
  ok(MD.inspectHeader(le([1, 2, 3, 4]), -1).status === 'invalid_header', 'inspect: size âm');
  ok(MD.inspectHeader(le([0xAF, 0x1B, 0xB1, 0xFA, 24, 0, 0, 0]), 8).status === 'invalid_header', 'inspect: 8 byte, thiếu bảng đầu');
  const big = new Uint8Array(100000); big.set([0xAF, 0x1B, 0xB1, 0xFA, 24, 0, 0, 0, 8, 1, 0, 0]);
  { const bi = MD.inspectHeader(big, 100000); ok(bi.status === 'generic_ok' && bi.header.pair_count === 32 && bi.header.empty_tables === 32, 'inspect: 100000 byte đưa vào, 32 bảng rỗng: ' + bi.status); }
  let threw = false; try { MD.inspectHeader(undefined, undefined); } catch (_) { threw = true; } ok(!threw, 'inspect: không ném với undefined');
  ok((await MD.check(null, null, [], hooks)).status === 'not_checked', 'check: unity=null');
  ok((await MD.check(null, { metadata_input: { status: 'selected', entry_path: 'x', path: 'x' } }, [], hooks)).status === 'read_error', 'check: entry không tồn tại → read_error');
  ok((await MD.check(null, { metadata_input: { status: 'selected', entry_path: 'x', path: 'x' } }, [{ name: 'x' }, { name: 'x' }], hooks)).status === 'read_error', 'check: entry trùng tên → read_error');
  const rf = await MD.check({ slice() { throw new Error('boom'); } }, { metadata_input: { status: 'selected', entry_path: 'x', path: 'x', candidates: [] } }, [{ name: 'x', offset: 0, size: 10, csize: 10, method: 0 }], hooks);
  ok(rf.status === 'read_error' && /boom/.test(rf.reason), 'check: lỗi đọc → read_error');
  let cancelled = false; try { await MD.check(null, { metadata_input: { status: 'selected', entry_path: 'x', path: 'x' } }, [{ name: 'x' }], { isCancelled: function () { return true; } }); } catch (e) { cancelled = e.code === 'CANCELLED'; }
  ok(cancelled, 'check: hủy → CANCELLED');
  ok(MD.toReportFields(null) === null && MD.toSummary(null) === null, 'report/summary null');
  const rep = MD.toReportFields((await mh('m42_ok_v24'))); ok(rep.metadata_header_status === 'generic_ok' && rep.metadata_version === 24, 'toReportFields');
  const sm = MD.toSummary(await mh('m42_ok_v24')); ok(sm.partial === true && sm.header.status === 'generic_ok', 'toSummary partial');
  ok(Object.isFrozen(MD) === false && MD.KNOWN_VERSIONS.indexOf(24) >= 0 && MD.KNOWN_VERSIONS.indexOf(23) < 0, 'danh sách version tham chiếu');

  console.log(fail ? ('CÓ ' + fail + ' LỖI / ' + n + ' kiểm tra') : ('TẤT CẢ ĐẠT (' + n + ' kiểm tra)'));
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('NGOẠI LỆ', e); process.exit(2); });
