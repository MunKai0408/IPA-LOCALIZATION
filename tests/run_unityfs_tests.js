// Chạy: python3 tests/make_unityfs_ipas.py DIR && node tests/run_unityfs_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 5.2a: parser container UnityFS. Bundle GIẢ LẬP dựng độc lập bằng Python (LZ4 tự viết, LZMA bằng module lzma của Python).
// LƯU Ý: fixture dựng theo CHÍNH giả định bố cục của module → chỉ chứng minh logic nhất quán, KHÔNG chứng minh khớp bundle Unity thật.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'modules/unity_fs', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, UF = NS.UnityFS, dir = process.argv[2] || '/tmp/fake_ipas';
const E = JSON.parse(fs.readFileSync(path.join(dir, 'unityfs_expected.json'), 'utf8')), EXP = E.bundles;
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const raw = function (name) { return new Uint8Array(fs.readFileSync(path.join(dir, 'ufs_raw_' + name + '.bin'))); };
const sha = function (u8) { return crypto.createHash('sha256').update(u8).digest('hex'); };
const rejects = async function (fn) { try { await fn(); return null; } catch (e) { return e; } };

(async function () {
  /* 1. Bundle hợp lệ: cấu trúc + từng node giải nén khớp SHA-256 độc lập (hashlib) */
  const VALID = ['v7_lz4_info_lz4', 'v7_lz4hc', 'v6_lzma', 'v7_none', 'v7_info_at_end', 'v6_info_at_end', 'v7_pad_flag', 'v7_mixed_blocks', 'lzma_params', 'lzma_big_far', 'single_empty_node', 'unicode_node_path'];
  for (const name of VALID) {
    const b = raw(name), ex = EXP[name], o = UF.open(b);
    ok(o.status === 'parsed', name + ': status=' + o.status + ' ' + o.reason);
    if (o.status !== 'parsed') continue;
    ok(o.data_start_exact === true && o.problems.length === 0, name + ': vùng dữ liệu khớp chính xác, 0 vấn đề ' + JSON.stringify(o.problems));
    ok(o.blocks.length === ex.blocks && o.total_uncompressed === ex.total_uncompressed && o.nodes.length === ex.nodes.length, name + ': số block/node/tổng byte');
    ok(JSON.stringify(o.blocks.map(function (x) { return x.flags; })) === JSON.stringify(ex.block_flags), name + ': cờ từng block');
    ok(o.compression.name === ex.comp, name + ': nén info = ' + o.compression.name);
    ok(o.header.unity_revision === ex.rev, name + ': unityRevision=' + o.header.unity_revision);
    ok(o.header.size === ex.size, name + ': size header == kích thước file');
    for (let i = 0; i < ex.nodes.length; i++) {
      const nd = o.nodes[i], en = ex.nodes[i];
      ok(nd.path === en.path && nd.size === en.size && nd.flags === en.flags && nd.is_serialized === ((en.flags & 4) !== 0), name + ' node ' + i + ': path/size/flags (' + nd.path + ')');
      const data = await UF.readNode(b, o, i);
      ok(data.length === en.size && sha(data) === en.sha256, name + ' node ' + i + ': nội dung giải nén khớp SHA-256 độc lập');
    }
  }
  /* 2. Giải nén thuần */
  const lz = UF.lz4Block(Uint8Array.from([0x50, 1, 2, 3, 4, 5]), 5); ok(lz.length === 5 && lz[4] === 5, 'LZ4 chỉ literal');
  ok((await rejects(function () { return UF.lz4Block(Uint8Array.from([0x11, 7, 0, 0]), 10); })).code === 'LZ4_BAD', 'LZ4 offset 0 → lỗi');
  ok((await rejects(function () { return UF.lz4Block(Uint8Array.from([0x11, 7, 9, 0]), 6); })).code === 'LZ4_BAD', 'LZ4 offset vượt dữ liệu đã giải → lỗi');
  ok((await rejects(function () { return UF.lz4Block(Uint8Array.from([0x50, 1, 2, 3, 4, 5]), 9); })).code === 'LZ4_BAD', 'LZ4 giải ra thiếu so với khai báo → lỗi');
  ok((await rejects(function () { return UF.lz4Block(Uint8Array.from([0x50, 1, 2, 3, 4, 5]), 3); })).code === 'LZ4_BAD', 'LZ4 vượt kích thước đích → lỗi');
  ok((await rejects(function () { return UF.lzma(new Uint8Array(3), 10); })).code === 'LZMA_BAD', 'LZMA quá ngắn → lỗi');
  ok((await rejects(function () { return UF.lzma(Uint8Array.from([255, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 10); })).code === 'LZMA_BAD', 'LZMA props ≥ 225 → lỗi');
  ok((await rejects(function () { return UF.decompress(4, new Uint8Array(4), 4); })).code === 'UNSUPPORTED_COMPRESSION', 'LZHAM → unsupported');
  ok((await rejects(function () { return UF.decompress(9, new Uint8Array(4), 4); })).code === 'UNSUPPORTED_COMPRESSION', 'kiểu nén lạ → unsupported');
  ok((await rejects(function () { return UF.decompress(0, new Uint8Array(4), 5); })).code === 'SIZE', 'không nén nhưng sai kích thước → lỗi');
  ok((await rejects(function () { return UF.decompress(2, new Uint8Array(4), UF.LIMITS.max_bundle_bytes + 1); })).code === 'SIZE', 'đích vượt giới hạn → lỗi, không cấp phát');
  /* LZMA bị cắt cụt giữa chừng: phải ném lỗi, không treo/không trả dữ liệu rác */
  { const o = UF.open(raw('v6_lzma')); const L = UF.layoutOf(o.header, raw('v6_lzma').length), b = raw('v6_lzma');
    const e = await rejects(function () { return UF.lzma(b.subarray(o.data_start, o.data_start + 40), o.blocks[0].uncompressed_size); }); ok(e && e.code === 'LZMA_BAD', 'LZMA cắt cụt → lỗi (' + (e && e.code) + ')'); }

  /* 3. Bundle có vấn đề */
  const st = function (name) { return UF.open(raw(name)); };
  ok(st('truncated').status === 'invalid' && /không khớp/.test(st('truncated').reason), 'cắt cụt 100 byte cuối: invalid (' + st('truncated').reason + ')');
  ok(st('truncated').problems.some(function (p) { return /size trong header/.test(p); }), 'cắt cụt: cảnh báo size header ≠ file');
  ok(st('truncated_header').status === 'invalid', 'header cụt 30 byte → invalid');
  ok(st('only_sig').status === 'invalid' && st('empty').status === 'invalid', 'chỉ có chữ ký / rỗng → invalid, không ném');
  ok(st('info_lzham').status === 'unsupported_compression' && /LZHAM/.test(st('info_lzham').reason), 'info nén LZHAM → unsupported_compression');
  ok(st('version_9').status === 'unsupported_version', 'UnityFS version 9 → unsupported_version (không đoán bố cục)');
  ok(st('unityweb').status === 'unsupported_format' && /UnityWeb/.test(st('unityweb').reason), 'UnityWeb → unsupported_format');
  ok(st('bad_magic').status === 'not_unityfs', 'magic sai → not_unityfs');
  ok(st('info_size_huge').status === 'too_large', 'kích thước info 2 GB → too_large, không cấp phát');
  ok(['decompress_failed', 'invalid'].indexOf(st('info_corrupt_lzma').status) >= 0 && st('info_corrupt_lzma').status !== 'parsed', 'info LZMA hỏng → ' + st('info_corrupt_lzma').status);
  ok(['decompress_failed', 'invalid'].indexOf(st('info_corrupt_lz4').status) >= 0, 'info LZ4 hỏng → ' + st('info_corrupt_lz4').status);
  ok(/không thử giải mã|file hỏng/.test(st('info_corrupt_lzma').reason) || st('info_corrupt_lzma').status === 'invalid', 'lỗi giải nén ghi rõ không thử giải mã');
  { const o = st('unknown_flag_bits'); ok(o.status === 'parsed' && o.notes.some(function (x) { return /bit chưa biết/.test(x); }) && o.header.unknown_flag_bits === 0x10000, 'bit flag lạ: vẫn đọc nhưng có ghi chú cảnh báo'); }
  { const o = st('size_field_wrong'); ok(o.status === 'parsed' && o.problems.some(function (p) { return /123456789/.test(p); }), 'trường size sai: parsed + vấn đề'); }
  { const o = st('node_out_of_range'), b = raw('node_out_of_range'); ok(o.status === 'parsed' && o.problems.some(function (p) { return /vượt tổng dữ liệu/.test(p); }), 'node vượt dữ liệu: vấn đề');
    ok((await rejects(function () { return UF.readNode(b, o, 1); })).code === 'NODE_RANGE', 'readNode node 99999999 byte vượt tổng dữ liệu → NODE_RANGE (chặn trước khi cấp phát)');
    ok(sha(await UF.readNode(b, o, 0)) === EXP.node_out_of_range.nodes[0].sha256, 'node đầu vẫn giải nén đúng'); }
  { const o = st('unsafe_node_path'); ok(o.status === 'parsed' && o.nodes[0].unsafe_path === 'chứa ..' && o.nodes[1].unsafe_path === 'đường dẫn tuyệt đối' && o.nodes[2].unsafe_path === null && o.problems.filter(function (p) { return /không an toàn/.test(p); }).length === 2, 'đường dẫn node không an toàn được gắn cờ'); }
  { const o = st('block_lzham'), b = raw('block_lzham'); ok(o.status === 'parsed' && o.problems.some(function (p) { return /Block 0.*chưa hỗ trợ/.test(p); }), 'block LZHAM: vấn đề');
    ok((await rejects(function () { return UF.readNode(b, o, 0); })).code === 'UNSUPPORTED_COMPRESSION', 'readNode block LZHAM → UNSUPPORTED_COMPRESSION'); }

  /* 4. readNode: đầu vào xấu, hủy, bundle cắt */
  { const b = raw('v7_mixed_blocks'), o = UF.open(b);
    ok((await rejects(function () { return UF.readNode(b, o, 99); })).code === 'NO_NODE', 'readNode node không tồn tại');
    ok((await rejects(function () { return UF.readNode(b, { status: 'invalid' }, 0); })).code === 'NOT_PARSED', 'readNode bundle chưa parse');
    ok((await rejects(function () { return UF.readNode(b, null, 0); })).code === 'NOT_PARSED', 'readNode bundle null');
    ok((await rejects(function () { return UF.readNode(b, o, 0, { isCancelled: function () { return true; } }); })).code === 'CANCELLED', 'readNode hủy giữa chừng');
    const cut = b.subarray(0, o.data_start + 100);
    ok((await rejects(function () { return UF.readNode(cut, o, 1); })).code === 'TRUNCATED', 'readNode khi file bị thiếu byte → TRUNCATED');
    const bad = new Uint8Array(b); bad[o.data_start + 3] ^= 0xFF; bad[o.data_start + 9] ^= 0xFF;   // block 0 không nén → sai nội dung nhưng cùng kích thước: giải nén "đúng" kích thước, SHA phải khác
    const d = await UF.readNode(bad, o, 0); ok(sha(d) !== EXP.v7_mixed_blocks.nodes[0].sha256, 'sửa byte dữ liệu → SHA khác (không lén trả dữ liệu cũ)'); }
  ok(UF.open(null).status !== 'parsed' && UF.open(new Uint8Array(0)).status === 'invalid', 'open(null)/rỗng không ném');
  ok(!UF.parseHeader(null).ok && !UF.parseHeader(Uint8Array.from([1, 2, 3])).ok, 'parseHeader đầu vào xấu');
  { const b = raw('v7_lz4_info_lz4'), h = UF.parseHeader(b); const e = UF.open(b.subarray(0, 60), b.length); ok(e.status === 'need_more_bytes' && e.need === UF.bytesNeeded(h, b.length), 'đọc đầu file thiếu byte → need_more_bytes đúng số byte'); }
  { const b = raw('v7_lz4_info_lz4'), h = UF.parseHeader(b), need = UF.bytesNeeded(h, b.length); ok(UF.open(b.subarray(0, need), b.length).status === 'parsed', 'chỉ cần ' + need + ' byte đầu (info ở đầu) là liệt kê được node'); }

  /* 5. Quét trong IPA */
  const steps = []; const ipaName = path.join(dir, 'ufs_all.ipa');
  const mk = function () { return new File([fs.readFileSync(ipaName)], 'ufs_all.ipa'); };
  const r = await NS.IpaReader.analyze(mk(), { hashMode: 'standard' }, { step: function (id, s, m) { steps.push([id, s, m]); }, progress() {}, log() {} });
  const zipEntries = (await NS.IpaReader.openZip(mk())).entries;
  const U = await UF.scan(mk(), r, zipEntries, {});
  ok(U.schema === 'unityfs_index/1' && U.sub_phase === '5.2a' && U.status === 'partial', 'scan: status=' + U.status + ' ' + U.reason);
  ok(U.summary.bundles === 29 && U.summary.parsed === 18, 'scan: 29 ứng viên, 18 đọc được: ' + JSON.stringify([U.summary.bundles, U.summary.parsed]));
  const bp = function (p) { return U.items.find(function (i) { return i.path === p; }); };
  const no = bp(E.noext.replace('Data/', 'Data/')); ok(no && no.selected_by === 'magic' && no.status === 'parsed', 'file không đuôi chọn bằng magic (manifest) và đọc được: ' + JSON.stringify(no && [no.selected_by, no.status]));
  ok(!bp('Data/readme.txt'), 'file .txt không phải ứng viên');
  for (const name of VALID) {
    const it = bp(E.place[name]); ok(it && it.status === 'parsed' && it.node_count === EXP[name].nodes.length && it.total_uncompressed === EXP[name].total_uncompressed, 'scan ' + name + ': đọc đúng');
    if (it) ok(it.nodes.every(function (nd, i) { return nd.path === EXP[name].nodes[i].path && nd.size === EXP[name].nodes[i].size; }) && it.unity_revision === EXP[name].rev && it.compression.name === EXP[name].comp, 'scan ' + name + ': node/revision/nén khớp');
  }
  const S = { truncated: 'invalid', truncated_header: 'invalid', info_lzham: 'unsupported_compression', version_9: 'unsupported_version', unityweb: 'unsupported_format', bad_magic: 'not_unityfs', only_sig: 'invalid', empty: 'invalid', info_size_huge: 'too_large' };
  Object.keys(S).forEach(function (k) { const it = bp(E.place[k]); ok(it && it.status === S[k], 'scan ' + k + ' → ' + (it && it.status) + ' (mong đợi ' + S[k] + ')'); });
  ok(['decompress_failed', 'invalid'].indexOf(bp(E.place.info_corrupt_lzma).status) >= 0 && ['decompress_failed', 'invalid'].indexOf(bp(E.place.info_corrupt_lz4).status) >= 0, 'scan: info hỏng không làm hỏng cả quá trình');
  ok(U.summary.by_status.parsed === 18 && U.summary.nodes > 20 && U.summary.unity_revisions.indexOf('2018.4.36f1') >= 0, 'summary: ' + JSON.stringify(U.summary.by_status));
  ok(JSON.stringify(UF.toIndex(U)) && UF.toReportFields(U).unityfs_bundles_parsed === 18 && typeof structuredClone(U) === 'object', 'JSON/structuredClone được, toReportFields');
  ok(U.limitations.length === 4 && U.items.every(function (it) { return it.nodes.every(function (nd) { return !('data' in nd); }); }), 'không đưa byte vào JSON; ghi rõ phần chưa làm');
  /* 6. scan: hủy, giới hạn, đầu vào xấu, IPA không có bundle */
  { let c = 0; const e = await rejects(function () { return UF.scan(mk(), r, zipEntries, { isCancelled: function () { return ++c > 3; } }); }); ok(e && e.code === 'CANCELLED', 'scan hủy giữa chừng → CANCELLED'); }
  { const old = UF.LIMITS.max_bundles; UF.LIMITS.max_bundles = 5; const x = await UF.scan(mk(), r, zipEntries, {}); UF.LIMITS.max_bundles = old; ok(x.items.length === 5 && x.warnings.some(function (w) { return /chỉ xử lý 5/.test(w); }), 'giới hạn số bundle + cảnh báo'); }
  { const oldM = UF.LIMITS.max_bundle_bytes; UF.LIMITS.max_bundle_bytes = 5000; const x = await UF.scan(mk(), r, zipEntries, {}); UF.LIMITS.max_bundle_bytes = oldM;
    const ie = x.items.find(function (i) { return /v7_info_at_end\.bundle$/.test(i.path); }); ok(ie && ie.status === 'too_large', 'info ở cuối + file vượt giới hạn → too_large (' + (ie && ie.status) + ')'); }
  { const x = await UF.scan(null, null, [], {}); ok(x.status === 'not_run', 'scan đầu vào xấu → not_run, không ném'); }
  { const x = await UF.scan(mk(), r, zipEntries.filter(function (e) { return !/Bundles|blob_noext/.test(e.name); }), {}); ok(x.status === 'no_bundles' && x.summary.bundles === 0, 'không có bundle → no_bundles'); }
  { const x = await UF.scan(mk(), Object.assign({}, r, { manifest: null }), zipEntries, {}); ok(x.source.manifest_used === false && x.items.length === 28, 'không manifest: chỉ chọn theo đuôi (file không đuôi không thấy)'); }

  console.log(fail ? ('THẤT BẠI ' + fail + '/' + n) : ('Tất cả ' + n + ' kiểm tra đạt'));
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('LỖI TEST', e && e.stack || e); process.exit(2); });
