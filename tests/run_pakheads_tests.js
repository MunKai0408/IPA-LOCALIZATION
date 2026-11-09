// Chạy: python3 tests/make_pakheads_ipas.py DIR && node tests/run_pakheads_tests.js DIR   (Node ≥ 20)
// Kiểm thử module pak_heads. Dữ liệu GIẢ LẬP; chỉ chứng minh logic, KHÔNG chứng minh đúng trên pak Dead Cells thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'modules/unity_fs', 'modules/serialized_file', 'modules/font_metrics', 'modules/tmp_font', 'modules/pak_heads', 'modules/raw_strings', 'modules/candidates', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, P = NS.PakHeads, dir = process.argv[2] || '/tmp/fake_ipas';
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const run = async function (name) {
  const steps = [];
  const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa');
  const r = await NS.IpaReader.analyze(file, { hashMode: 'auto' }, { step: function (id, st, msg) { steps.push([id, st, msg]); }, progress() {}, log() {}, isCancelled: undefined });
  r._steps = steps; return r;
};
(async function () {
  let r = await run('pak_heaps'); let p = r.pak_heads;
  ok(p && p.status === 'ok' && p.pak_files.length === 2, 'heaps: 2 pak đã lấy đầu');
  const a = p.pak_files.find(function (x) { return x.zip_path.endsWith('res.pak'); }), b = p.pak_files.find(function (x) { return x.zip_path.endsWith('res1.pak'); });
  ok(a.format_guess === 'heaps_pak' && a.heaps.status === 'ok', 'heaps: nhận ra Heaps PAK, cây đọc đủ + thấy DATA');
  ok(a.heaps.files_total === 3 && a.heaps.dirs_total === 2, 'heaps: 3 file / 2 thư mục (gồm gốc)');
  ok(a.heaps.sample_paths.join() === 'lang/en.xml,lang/fr.xml,data.cdb', 'heaps: đường dẫn đúng');
  ok(a.heaps.languages_hint.join() === 'en,fr', 'heaps: gợi ý ngôn ngữ en,fr');
  ok(a.heaps.evidence === 'HYPOTHESIS', 'heaps: nhãn HYPOTHESIS');
  ok(a.first_16_hex.startsWith('50 41 4b') && /^[0-9a-f]{64}$/.test(a.sha256_of_saved_head), 'heaps: hex đầu + sha256');
  ok(b.format_guess === 'unknown' && b.heaps === null, 'pak lạ → unknown, không đoán Unreal');
  ok(r._steps.some(function (s) { return s[0] === 'pakheads' && s[1] === 'done'; }), 'bước pakheads done');
  const idx = P.toIndex(p); ok(JSON.stringify(idx).indexOf('"_head"') < 0, 'toIndex không chứa byte thô');
  ok(P.headFiles(p).length === 2 && P.headFiles(p)[0].name.indexOf('/') < 0, 'headFiles: tên không chứa /');
  const z = P.buildZip([{ name: 'x/a.head', data: new Uint8Array([1, 2, 3]) }, { name: 'x/b.head', data: new Uint8Array(0) }]);
  const zb = Buffer.from(await z.arrayBuffer()); fs.writeFileSync('/tmp/_pak_test.zip', zb);
  r = require('child_process').spawnSync('python3', ['-c', "import zipfile;z=zipfile.ZipFile('/tmp/_pak_test.zip');assert z.testzip() is None;print(sorted(z.namelist()))"]);
  ok(r.status === 0, 'buildZip: python zipfile mở + CRC đúng: ' + String(r.stderr));

  r = await run('pak_heaps_nodata'); const nd = r.pak_heads.pak_files[0];
  ok(nd.heaps.status === 'unverified', 'thiếu "DATA" → unverified, không khẳng định');
  r = await run('pak_none'); ok(r.pak_heads.status === 'no_pak', 'không có pak → no_pak');
  r = await run('pak_godot'); ok(r.pak_heads.pak_files[0].format_guess === 'godot_pck', 'GDPC → godot_pck');
  // head bị cắt: header lớn hơn phần đã đọc → partial
  const big = new Uint8Array(40); big.set([0x50, 0x41, 0x4b, 0]); new DataView(big.buffer).setUint32(4, 5000, true); new DataView(big.buffer).setUint32(8, 100, true);
  big[12] = 0; big[13] = 1; new DataView(big.buffer).setUint32(14, 999, true);
  ok(P.parseHeapsPak(big, 100000).status === 'partial' || P.parseHeapsPak(big, 100000).status === 'unverified', 'head cắt/lệch → partial/unverified, không ném lỗi');
  ok(P.parseHeapsPak(new Uint8Array([1, 2, 3]), 3).status === 'not_heaps_pak', 'không có magic → not_heaps_pak');

  /* bố cục không checksum (csum=0) được nhận nhờ "DATA" khớp */
  (function () {
    const nm = function (t) { return Array.from(Buffer.from(t)); };
    const u32 = function (v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]; };
    const tree = [0, 1].concat(u32(1), [4], nm('x.po'), [0], u32(0), u32(5));
    const hs = 12 + tree.length, b = new Uint8Array([0x50, 0x41, 0x4b, 0].concat(u32(hs), u32(5), tree, nm('DATA'), [1, 2, 3, 4, 5]));
    const q = P.parseHeapsPak(b, b.length);
    ok(q.status === 'ok' && q.layout.checksum_bytes === 0 && q.files_total === 1 && q.sample_paths[0] === 'x.po', 'bố cục csum=0 được nhận (DATA khớp)');
  })();
  /* cây bắt đầu ở offset 16 (4 byte lạ sau header) được nhận nhờ "DATA" khớp; probe chẩn đoán khi không khớp */
  (function () {
    const nm = function (t) { return Array.from(Buffer.from(t)); };
    const u32 = function (v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]; };
    const tree = [0, 1].concat(u32(1), [4], nm('x.po'), [0], u32(0), u32(5), u32(0));
    const hs = 16 + tree.length, b = new Uint8Array([0x50, 0x41, 0x4b, 1].concat(u32(hs), u32(5), [0x66, 0x35, 0x66, 0x65], tree, nm('DATA'), [1, 2, 3, 4, 5]));
    const q = P.parseHeapsPak(b, b.length);
    ok(q.status === 'ok' && q.layout.tree_start === 16 && q.sample_paths[0] === 'x.po', 'cây bắt đầu @16 được nhận (DATA khớp)');
    const g = new Uint8Array(300); g.set([0x50, 0x41, 0x4b, 1]); for (let i = 12; i < 300; i++) g[i] = (i * 197 + 31) & 255;
    new DataView(g.buffer).setUint32(4, 200, true); new DataView(g.buffer).setUint32(8, 50, true);
    const z = P.parseHeapsPak(g, 250);
    ok(z.status === 'unverified' && z.header_probe && z.header_probe.entropy_bits_per_byte > 7 && /^[0-9a-f ]+$/.test(z.header_probe.bytes_12_76_hex), 'header rác → unverified + header_probe (entropy cao)');
  })();
  /* pak nén deflate + header dài hơn head → đọc lại đủ header (partial → ok) */
  const small = new File([fs.readFileSync(path.join(dir, 'text_pak.ipa'))], 't.ipa');
  const rr = await NS.IpaReader.analyze(small, {}, { step() {}, progress() {}, log() {}, isCancelled: undefined });
  const zp = await NS.IpaReader.openZip(small); const pe = zp.entries.find(function (e) { return /res\.pak$/.test(e.name); });
  const pr2 = await P.run(small, zp.entries, { headBytes: 4096 }); ok(pr2.pak_files[0].heaps.status === 'ok', 'head nhỏ nhưng đủ → ok');
  const hs0 = pr2.pak_files[0].heaps.header_size;
  const tiny = await NS.IpaReader.readEntry(small, pe, { head: true, max: 20 });
  const pp = P.parseHeapsPak(tiny.data, pe.size); ok(pp.status === 'partial', 'head 20 byte < header → partial (pak nén method ' + pe.method + ')');
  ok(rr.candidates.candidates.some(function (c) { return c.kind === 'heaps.pak'; }) && !rr.candidates.candidates.some(function (c) { return c.kind === 'unreal.pak_container'; }), 'candidates: pak Heaps → heaps.pak, KHÔNG unreal.pak_container');
  console.log(fail ? 'FAILED ' + fail + '/' + n : 'PASS ' + n + '/' + n); process.exit(fail ? 1 : 0);
})();
