// Chạy: python3 tests/make_tables_ipas.py DIR && python3 tests/make_literal_ipas.py DIR && python3 tests/make_metadata_ipas.py DIR && node tests/run_tables_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 4.3 (assembly/image/type/method/field + dump.cs). Metadata GIẢ LẬP dựng bằng Python theo schema DẪN XUẤT TỰ ĐỘNG từ MetadataClass.cs
// (tests/fixtures/il2cpp_struct_schema.json): chỉ chứng minh logic khớp bố cục trong nguồn, KHÔNG chứng minh đúng trên metadata thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, MT = NS.MetadataTables, dir = process.argv[2] || '/tmp/fake_ipas';
const exp = JSON.parse(fs.readFileSync(path.join(dir, 'tbl_expected.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'il2cpp_struct_schema.json'), 'utf8')).classes;
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const run = async function (name, steps, opt) {
  opt = opt || {};
  const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa');
  const h = { step: function (id, st, msg) { if (steps) steps.push([id, st, msg]); if (opt.cancelOn && id === opt.cancelOn && st === 'running') opt.state.cancelled = true; }, progress() {}, log() {} };
  return NS.IpaReader.analyze(file, { hashMode: 'fast' }, h);
};
const tbl = async function (name) { const r = await run(name); return r.unity.metadata_tables; };

(async function () {
  /* 1. Schema JS (viết tay) == schema fixture (dẫn xuất tự động từ nguồn C#) – mọi struct, mọi version */
  const SZ = { uint: 4, int: 4, ushort: 2, short: 2 };
  const kindOf = { uint: 'u', int: 'i', ushort: 'h', short: 's', 'byte[]': 'b8' };
  function fixtureLayout(cls, V) {
    const fields = []; let off = 0;
    fixture[cls].forEach(function (f) {
      if (V < f.min || V > f.max) return;
      if (f.type === 'Il2CppAssemblyNameDefinition') { fixtureLayout('Il2CppAssemblyNameDefinition', V).fields.forEach(function (g) { fields.push({ name: 'aname_' + g.name, kind: g.kind, off: off + g.off }); }); off += fixtureLayout('Il2CppAssemblyNameDefinition', V).size; }
      else { fields.push({ name: f.name, kind: kindOf[f.type], off: off }); off += f.type === 'byte[]' ? f.len : SZ[f.type]; }
    });
    return { size: off, fields: fields };
  }
  const versions = [16, 17, 19, 20, 21, 22, 23, 24, 24.1, 24.2, 24.3, 24.4, 24.5, 27, 29, 31];
  let schemaOk = true, checked = 0;
  Object.keys(MT.STRUCTS).forEach(function (k) {
    versions.forEach(function (V) {
      const a = MT.layoutOf(k, V), b = fixtureLayout(MT.CS_CLASS[k], V); checked++;
      if (JSON.stringify(a) !== JSON.stringify(b)) { schemaOk = false; console.log('  schema khác:', k, V, a.size, b.size); }
    });
  });
  ok(schemaOk && checked === 8 * versions.length, 'schema JS khớp fixture (dẫn xuất từ MetadataClass.cs) cho ' + checked + ' tổ hợp struct×version');
  ok(fixture.Il2CppGlobalMetadataHeader.length === MT.STRUCTS.header.length && fixture.Il2CppTypeDefinition.length === MT.STRUCTS.typedef.length && fixture.Il2CppMethodDefinition.length === MT.STRUCTS.method.length, 'số trường khai báo khớp');
  ok(MT.layoutOf('header', 24.2).size === 264 && MT.layoutOf('header', 24).size === 272, 'header v24.2 = 264 B (mốc Metadata.cs), v24 = 272 B');

  /* 2. Từng version: nội dung khớp bản dựng độc lập */
  const keys = Object.keys(exp).filter(function (k) { return k !== 'tbl_many'; });
  let nVer = 0;
  for (const nm of keys) {
    const e = exp[nm], r = await run(nm), T = r.unity.metadata_tables;
    ok(T && T.schema === 'metadata_tables/1' && T.status === 'ok', nm + ': status=' + (T && T.status) + ' ' + (T && T.reason));
    if (!T || T.status !== 'ok') continue;
    nVer++;
    ok(T.version === e.version && T.layout.detected === e.layout && T.layout.assembly_layout === e.asm_layout, nm + ': layout ' + JSON.stringify(T.layout) + ' vs ' + e.layout + '/' + e.asm_layout);
    ok(T.assemblies.length === e.assemblies.length && e.assemblies.every(function (a, i) { const g = T.assemblies[i]; return g.index === i && g.name === a.name && g.image_index === a.image_index && g.version === a.version; }), nm + ': assemblies');
    ok(T.images.length === e.images.length && e.images.every(function (a, i) { const g = T.images[i]; return g.name === a.name && g.type_start === a.type_start && g.type_count === a.type_count; }), nm + ': images');
    ok(T.types.length === e.types.length && e.types.every(function (a, i) { const g = T.types[i]; return g.index === i && g.name === a.name && g.namespace === a.namespace && g.flags === a.flags && g.field_count === a.field_count && g.method_count === a.method_count && g.nested_in === a.nested_in; }), nm + ': types (tên Unicode/generic/namespace rỗng, cờ, đếm, lồng nhau)');
    ok(T.methods.length === e.methods.length && e.methods.every(function (a, i) { const g = T.methods[i]; return g.index === i && g.name === a.name && g.type_index === a.type && g.flags === a.flags && g.return_type_raw_index === a.ret && g.parameters.length === a.params.length && a.params.every(function (p, k) { return g.parameters[k].name === p[0] && g.parameters[k].type_raw_index === p[1]; }); }), nm + ': methods + tham số');
    ok(T.fields.length === e.fields.length && e.fields.every(function (a, i) { const g = T.fields[i]; return g.index === i && g.name === a.name && g.type_index === a.type && g.type_raw_index === a.type_raw; }), nm + ': fields');
    ok(T.counts.types === 8 && T.counts.methods === e.methods.length && T.counts.fields === e.fields.length && T.counts.parameters === e.n_params && T.counts.namespaces === 5, nm + ': counts ' + JSON.stringify(T.counts));
    ok(T.problems.length === 0 && T.name_problems.name_out_of_range === 0, nm + ': không có bất thường');
    ok(T.types[1].full_name === 'Game.UI.MenuController/Inner' && T.types[1].nested_in === 0, nm + ': full_name lồng nhau');
    ok(T.types[0].visibility === 'public' && T.types[1].visibility === 'nested_public' && T.types[2].kind === 'interface' && T.types[3].kind === 'enum' && T.types[4].kind === 'struct' && T.types[6].is_abstract && T.types[6].is_sealed, nm + ': kind/visibility/abstract/sealed từ cờ');
    ok(T.methods[0].access === 'public' && T.methods[0].is_virtual && T.methods[3].is_static && !T.methods[1].is_virtual, nm + ': cờ method (access/static/virtual)');
    ok(structuredClone(T).types.length === T.types.length && JSON.stringify(structuredClone(T)) === JSON.stringify(T), nm + ': structuredClone/JSON');
    ok(r.unity.schema === 'unity_info/3' && !!r.unity.metadata_literals, nm + ': không ảnh hưởng bước literal');
  }
  ok(nVer === 19, 'số IPA đúng version đã kiểm: ' + nVer);
  { const T = await tbl('tbl_v24_0'); ok(T.layout.detected === 24 && T.struct_sizes.image === 32 && T.struct_sizes.typedef === 104, 'v24.0: image 32 B, typedef 104 B');
    const T1 = await tbl('tbl_v24_1'); ok(T1.layout.detected === 24.1 && T1.layout.assembly_layout === 24.1 && T1.struct_sizes.assembly === 68 && T1.struct_sizes.image === 40, 'v24.1 (3 image): nhận đúng 24.1, assembly 68 B (tham chiếu chia nguyên sẽ nhầm khi N<16)');
    const T1p = await tbl('tbl_v24_1plus'); ok(T1p.layout.detected === 24.1 && T1p.layout.assembly_layout === 24.4 && T1p.struct_sizes.assembly === 64, 'v24.1+ (assembly 64 B)');
    const T2 = await tbl('tbl_v24_2'); ok(T2.layout.detected === 24.2 && T2.struct_sizes.typedef === 92 && T2.struct_sizes.method === 32, 'v24.2: typedef 92 B, method 32 B');
    const T4 = await tbl('tbl_v24_4'); ok(T4.layout.detected === 24.4 && T4.struct_sizes.assembly === 64, 'v24.4: assembly 64 B');
    const T31 = await tbl('tbl_v31'); ok(T31.struct_sizes.method === 36 && T31.layout.detected === 31, 'v31: method 36 B (có returnParameterToken)');
    const T16 = await tbl('tbl_v16'); ok(T16.images[0].token === null && T16.types[0].token === null, 'v16: không có token (trường Min=19) → null, không bịa'); }

  /* 3. Lỗi dữ liệu: không đoán, không crash */
  { const r = await run('tbl_v33'), T = r.unity.metadata_tables; ok(T.status === 'unsupported_version' && T.version === 33 && T.types.length === 0, 'v33: unsupported_version, không đoán: ' + T.status); }
  { const T = await tbl('tbl_bad_method_range'); ok(T.status === 'ok' && T.problem_counts.type_method_range === 1 && T.types[1].method_count === 1, 'method range vượt bảng: 1 bất thường được ghi, pipeline tiếp tục: ' + JSON.stringify(T.problem_counts));
    ok(T.methods.every(function (m, i) { return i < 4 || m.type_index >= 0 || true; }) && T.methods.filter(function (m) { return m.type_index === -1; }).length === 1, 'method không thuộc type nào có type_index=-1 (không bịa)');
    const dump = MT.toDumpCs(T); ok(dump.indexOf('Inner') >= 0, 'dump.cs vẫn được sinh'); }
  { const T = await tbl('tbl_bad_name'); ok(T.status === 'ok' && T.types[2].name === null && T.name_problems.name_out_of_range >= 1, 'tên ngoài vùng string: name=null + đếm lỗi'); }
  { const r = await run('tbl_not_div'), T = r.unity.metadata_tables; ok(r.unity.metadata_header.status === 'generic_ok' && T.status === 'layout_mismatch' && T.types.length === 0 && /không chia hết/.test(T.reason), 'bảng không chia hết struct → layout_mismatch: ' + T.status + ' ' + T.reason); }
  { const steps = []; const r = await run('tbl_string_beyond', steps), T = r.unity.metadata_tables, st = steps.filter(function (s) { return s[0] === 'tables'; }).pop();
    ok(!T && st && st[1] === 'skipped', 'stringSize vượt file: 4.2 đã chặn (invalid_header) → bước tables skipped: ' + (st && st[1])); }
  for (const nm of ['m42_bad_magic', 'm42_version_25', 'm42_zero_first_offset', 'm42_no_metadata', 'm42_mono', 'm42_not_unity']) {
    if (!fs.existsSync(path.join(dir, nm + '.ipa'))) { ok(false, nm + ': thiếu IPA (chạy make_metadata_ipas.py)'); continue; }
    const steps = [], r = await run(nm, steps), st = steps.filter(function (s) { return s[0] === 'tables'; }).pop();
    ok(!r.unity.metadata_tables && st && st[1] === 'skipped', nm + ': không đủ điều kiện → skipped (step=' + (st && st[1]) + ')');
  }
  { const steps = []; await run('tbl_v29', steps); const ids = steps.map(function (s) { return s[0]; });
    ok(ids.lastIndexOf('tables') > ids.lastIndexOf('literals') && steps.filter(function (s) { return s[0] === 'tables' && s[1] === 'done'; }).length === 1, 'thứ tự bước literals → tables'); }

  /* 4. decodeTables / parseHeader với đầu vào xấu */
  ok(MT.parseHeader(null).ok === false && MT.parseHeader(new Uint8Array(4)).ok === false && MT.parseHeader(new Uint8Array(300)).ok === false, 'parseHeader: null/ngắn/magic sai → ok=false, không ném lỗi');
  { const hb = new Uint8Array(300); new DataView(hb.buffer).setUint32(0, 0xFAB11BAF, true); new DataView(hb.buffer).setInt32(4, 29, true);
    const hi = MT.parseHeader(hb); ok(hi.ok && hi.header_size === 256 && hi.layout_version === 29, 'parseHeader v29: 256 B');
    const bad = MT.decodeTables(hi, { strings: new Uint8Array(0), images: new Uint8Array(0), assemblies: new Uint8Array(0), typedefs: new Uint8Array(0), methods: new Uint8Array(0), parameters: new Uint8Array(0), fields: new Uint8Array(0), nested: new Uint8Array(0) });
    ok(bad.status === 'ok' && bad.counts.types === 0, 'bảng rỗng hoàn toàn → ok, 0 phần tử');
    const bad2 = MT.decodeTables(hi, { strings: new Uint8Array(1), images: new Uint8Array(41), assemblies: new Uint8Array(0), typedefs: new Uint8Array(0), methods: new Uint8Array(0), parameters: new Uint8Array(0), fields: new Uint8Array(0), nested: new Uint8Array(0) });
    ok(bad2.status === 'layout_mismatch', 'image 41 B (không chia hết 40) → layout_mismatch: ' + bad2.status);
    const bad3 = MT.decodeTables(hi, {}); ok(bad3.status === 'invalid_table', 'thiếu buffer → invalid_table (bắt lỗi, không ném)'); }
  { const pl = MT.planRegions({ stringOffset: 100, stringSize: 10, imagesOffset: 100, imagesSize: -5, assembliesOffset: 10, assembliesSize: 8, typeDefinitionsOffset: 0, typeDefinitionsSize: 0, methodsOffset: 0, methodsSize: 0, parametersOffset: 0, parametersSize: 0, fieldsOffset: 0, fieldsSize: 0, nestedTypesOffset: 0, nestedTypesSize: 0 }, 256, 200);
    ok(!pl.ok && pl.errors.length === 3, 'planRegions: size âm, vùng ngoài file, đè header → 3 lỗi: ' + pl.errors.length); }

  /* 5. dump.cs */
  { const T = await tbl('tbl_v29'), d = MT.toDumpCs(T);
    ok(typeof d === 'string' && d.indexOf('// Image 0: Assembly-CSharp.dll - 0') >= 0 && d.indexOf('// Namespace: Game.UI') >= 0, 'dump.cs: header image + namespace');
    ok(d.indexOf('public class MenuController // TypeDefIndex: 0') >= 0 && d.indexOf('public class MenuController/Inner // TypeDefIndex: 1') >= 0, 'dump.cs: class + nested');
    ok(d.indexOf('public interface IService') >= 0 && d.indexOf('public sealed enum') < 0 && /public enum ItemKind/.test(d) && /public static class Mathf/.test(d), 'dump.cs: interface/enum/static class từ cờ');
    ok(d.indexOf('/* type#11 */ titleText; // FieldIndex: 0') >= 0, 'dump.cs: field với chỉ số kiểu THÔ (không bịa tên kiểu)');
    ok(d.indexOf('public virtual /* type#0 */ Start(/* type#5 */ arg); // MethodIndex: 0, Token: 0x6000001') >= 0, 'dump.cs: method + tham số + token');
    ok(d.indexOf('日本語') >= 0 && d.indexOf('Việt hóa ✓') >= 0, 'dump.cs: Unicode nguyên vẹn');
    ok(/KHÔNG có trong metadata nên không được suy ra tên kiểu/.test(d), 'dump.cs: chú thích giới hạn ở đầu file');
    ok(MT.toDumpCs(null) === null && MT.toDumpCs({ status: 'layout_mismatch' }) === null, 'toDumpCs: không sinh khi không ok'); }
  { const T = await tbl('tbl_v29'), rf = MT.toReportFields(T);
    ok(rf.metadata_tables_status === 'ok' && rf.metadata_types === 8 && rf.metadata_methods === T.methods.length && rf.metadata_table_problems === 0 && MT.toReportFields(null) === null, 'toReportFields từ dữ liệu thật'); }

  /* 6. Quy mô: 20.000 type / 200.000 method / 100.000 field; hủy giữa chừng */
  { const t0 = Date.now(), r = await run('tbl_many'), T = r.unity.metadata_tables, ms = Date.now() - t0;
    ok(T.status === 'ok' && T.counts.types === 20000 && T.counts.methods === 200000 && T.counts.fields === 100000 && T.counts.namespaces === 50, 'quy mô lớn: ' + JSON.stringify(T.counts) + ' trong ' + ms + ' ms');
    ok(T.methods[199999].name === 'M19999_9' && T.fields[99999].name === 'f19999_4' && T.types[19999].name === 'Type19999' && T.methods[12345].type_index === 1234, 'quy mô lớn: mục cuối/giữa đúng');
    const d = MT.toDumpCs(T); ok(d.split('\n').length > 300000, 'dump.cs quy mô lớn: ' + d.split('\n').length + ' dòng, ' + (d.length >> 20) + ' MiB');
    console.log('  (thông tin) quy mô lớn: tổng ' + ms + ' ms; heap ~' + Math.round(process.memoryUsage().heapUsed / 1048576) + ' MiB'); }
  { const st = { cancelled: false }; let thrown = null;
    try { const file = new File([fs.readFileSync(path.join(dir, 'tbl_many.ipa'))], 'x.ipa');
      await NS.IpaReader.analyze(file, { hashMode: 'fast' }, { step: function (id, s) { if (id === 'tables' && s === 'running') st.cancelled = true; }, progress() {}, log() {}, isCancelled: function () { return st.cancelled; } });
    } catch (e) { thrown = e; }
    ok(thrown && thrown.code === 'CANCELLED', 'hủy khi đang trích xuất bảng: CANCELLED (' + (thrown && thrown.code) + ')'); }

  /* 7. Đầu vào xấu */
  { const a = await MT.extractTables(null, null, [], {}); ok(a.status === 'not_eligible', 'extractTables(null) → not_eligible');
    const b = await MT.extractTables(null, { metadata_header: { status: 'bad_magic' } }, [], {}); ok(b.status === 'not_eligible' && /bad_magic/.test(b.reason), 'header không đạt → not_eligible');
    const c = await MT.extractTables(null, { metadata_header: { status: 'generic_ok', version: { value: 35 }, path: 'p', entry_path: 'e' } }, [], {}); ok(c.status === 'unsupported_version', 'v35 → unsupported_version');
    const d = await MT.extractTables(null, { metadata_header: { status: 'generic_ok', version: { value: 29 }, path: 'p', entry_path: 'e' } }, [], {}); ok(d.status === 'read_error', 'entry không có → read_error'); }

  console.log(n + ' kiểm tra, ' + fail + ' thất bại');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('LỖI TEST', e); process.exit(2); });
