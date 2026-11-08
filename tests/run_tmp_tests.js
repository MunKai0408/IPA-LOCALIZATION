// Chạy: python3 tests/make_tmp_ipas.py DIR && node tests/run_tmp_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 5.2d (TMP_FontAsset). DỮ LIỆU GIẢ LẬP theo bố cục giả định của module: chỉ chứng minh logic, KHÔNG chứng minh đúng với TextMesh Pro thật.
const fs = require('fs'), path = require('path');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables',
 'modules/font_dump', 'modules/unity_fs', 'modules/serialized_file', 'modules/font_metrics', 'modules/tmp_font', 'ipa_reader'].forEach(function (f) { (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8')); });
const NS = globalThis.IPAStudio, dir = process.argv[2] || '/tmp/fake_ipas', EXP = JSON.parse(fs.readFileSync(path.join(dir, 'tmp_expected.json'), 'utf8'));
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } return !!c; };
const hooks = { step() {}, progress() {}, log() {} };
const hexs = function (a) { return a.map(function (c) { return 'U+' + c.toString(16).toUpperCase().padStart(4, '0'); }); };

(async function () {
  const file = new File([fs.readFileSync(path.join(dir, 'tmp_all.ipa'))], 'tmp_all.ipa');
  const r = await NS.IpaReader.analyze(file, {}, hooks);

  /* 0. Danh sách VI dùng chung với FontMetrics */
  ok(JSON.stringify(NS.TmpFont.VI_REQUIRED) === JSON.stringify(NS.FontMetrics.VI_REQUIRED) && JSON.stringify(NS.TmpFont.VI_REQUIRED) === JSON.stringify(EXP.vi_required), '134 ký tự Việt khớp FontMetrics và Python');

  /* 1. 5.2c ghi nhận đúng chỉ số object TMP_FontAsset theo file */
  const rf = r.serialized.files.find(function (f) { return f.path === 'Data/resources.assets'; });
  ok(rf && JSON.stringify(rf.tmp_font_assets) === JSON.stringify(EXP.tmp_object_indexes), '5.2c: tmp_font_assets = ' + JSON.stringify(rf && rf.tmp_font_assets) + ' (mong ' + JSON.stringify(EXP.tmp_object_indexes) + ')');
  ok(!rf.tmp_font_assets.some(function (i) { return EXP.non_tmp_mb_index.indexOf(i) >= 0; }), 'MonoBehaviour class khác (TextMeshProUGUI) không được tính là TMP_FontAsset');
  const sh = r.serialized.files.find(function (f) { return f.path === 'Data/sharedassets0.assets'; });
  ok(sh && !sh.tmp_font_assets, 'file không có TMP: không có tmp_font_assets');
  const bn = r.serialized.files.find(function (f) { return f.source === 'bundle_node'; });
  ok(bn && bn.tmp_font_assets && bn.tmp_font_assets.length === 1, 'node bundle cũng được đánh dấu');

  /* 2. Kết quả TMP */
  const t = r.tmp_fonts; ok(t && t.schema === 'tmp_fonts/1' && t.sub_phase === '5.2d', 'schema');
  const NA = Object.keys(EXP.assets).length; ok(t.items.length === NA, 'số TMP_FontAsset = ' + t.items.length + ' (mong ' + NA + ')');
  const by = {}; t.items.forEach(function (it) { by[it.name] = it; });
  Object.keys(EXP.assets).forEach(function (name) {
    const ex = EXP.assets[name], it = by[name]; if (!ok(!!it, 'thiếu asset ' + name)) return;
    if (!it) return;
    ok(it.status === ex.status, name + ': status=' + it.status + ' (mong ' + ex.status + ') ' + it.reason);
    ok(it.path_id === ex.pid, name + ': path_id=' + it.path_id);
    ok(it.font_info && it.font_info.name === ex.face, name + ': FaceInfo.name=' + (it.font_info && it.font_info.name));
    if (ex.declared !== undefined) ok(it.font_info && it.font_info.declared_char_count === ex.declared, name + ': declared=' + (it.font_info && it.font_info.declared_char_count));
    if (ex.atlas) ok(it.font_info.atlas_width === ex.atlas[0] && it.font_info.atlas_height === ex.atlas[1] && it.font_info.atlas_basis === ex.atlas[2], name + ': atlas ' + JSON.stringify([it.font_info.atlas_width, it.font_info.atlas_height, it.font_info.atlas_basis]));
    if (ex.status === 'glyph_table_not_found') {
      ok(it.glyph_table === null && it.code_points === null && it.vietnamese === null, name + ': không được bịa danh sách ký tự');
      ok(it.diagnostics && it.diagnostics.hex_head && it.diagnostics.faceinfo_offset > 0, name + ': có diagnostics để suy ra bố cục thật');
      ok(it.diagnostics.count_hits && it.diagnostics.count_hits.length >= 1, name + ': có count_hits (vị trí số nguyên = số ký tự khai báo)');
      return;
    }
    ok(it.glyph_table.count === ex.count + (ex.problem === 'id glyph trùng' ? 2 : 0), name + ': glyph count=' + it.glyph_table.count);
    ok(it.code_points.count === ex.count, name + ': code point=' + it.code_points.count + ' (mong ' + ex.count + ')');
    ok(JSON.stringify(it.code_points.ranges) === JSON.stringify(ex.ranges), name + ': ranges khác Python');
    ok(it.vietnamese.covered === ex.vi_covered && it.vietnamese.missing_count === ex.vi_missing && it.vietnamese.level === ex.vi_level, name + ': VI ' + it.vietnamese.covered + '/' + it.vietnamese.required + ' ' + it.vietnamese.level);
    ok(it.vietnamese.ascii_letters_ok === ex.ascii_ok, name + ': ascii_ok');
    ok(it.vietnamese.missing.length === Math.min(150, ex.vi_missing), name + ': số mục missing liệt kê');
    if (ex.problem) ok(it.problems.some(function (p) { return p.indexOf(ex.problem) >= 0; }), name + ': thiếu vấn đề "' + ex.problem + '" trong ' + JSON.stringify(it.problems));
    else ok(it.problems.length === 0, name + ': không được có vấn đề: ' + JSON.stringify(it.problems));
    ok(it.glyph_table.sample.length === Math.min(3, it.glyph_table.count) && it.glyph_table.sample[0].scale === 1, name + ': mẫu glyph');
  });
  ok(by['SourceCodePro SDF'].vietnamese.level === 'full' && by['Orbitron SDF'].vietnamese.level === 'partial', 'full vs partial');
  ok(by['OneMissing SDF'].vietnamese.level === 'partial' && by['OneMissing SDF'].vietnamese.missing.join() === 'U+1EF9', 'thiếu đúng 1 ký tự (ỹ) KHÔNG được coi là đủ');
  ok(by['TwoLists-A SDF'].glyph_table.other_tables.length === 1 && by['TwoLists-A SDF'].glyph_table.other_tables[0].count === 40, 'TwoLists-A: ghi nhận bảng glyph khác');
  ok(by['SourceCodePro SDF'].glyph_table.count_matches_declared === true && by['CountMismatch SDF'].glyph_table.count_matches_declared === false, 'count_matches_declared');
  ok(by['CJK SDF'].code_points.ranges.length === 2 && by['CJK SDF'].vietnamese.level === 'none' && by['CJK SDF'].vietnamese.covered === 0, 'CJK: 2 khoảng, không có Việt');
  ok(by['NoHeader SDF'].header === null, 'NoHeader: header null');
  ok(by['SourceCodePro SDF'].header && by['SourceCodePro SDF'].header.script_path_id === 5, 'header.script_path_id');

  /* 3. Tham chiếu thấy được + font cùng tên */
  Object.keys(EXP.refs).forEach(function (name) {
    const it = by[name], ex = EXP.refs[name];
    ['texture', 'material', 'font', 'tmp_font_asset'].forEach(function (k) {
      const got = (it.refs[k] || []).map(function (x) { return x.name; }).sort(), want = ex[k].slice().sort();
      ok(JSON.stringify(got) === JSON.stringify(want), name + ': refs.' + k + ' = ' + JSON.stringify(got) + ' (mong ' + JSON.stringify(want) + ')');
    });
    const mf = it.matched_fonts.map(function (x) { return x.name; }).sort();
    ok(JSON.stringify(mf) === JSON.stringify(EXP.matched_fonts[name]), name + ': matched_fonts ' + JSON.stringify(mf));
  });

  /* 4. Big-endian */
  const be = by['BE SDF']; ok(be && be.status === 'parsed' && be.vietnamese.level === 'full' && be.refs.texture[0].name === 'BE Atlas' && be.refs.font[0].name === 'BE-Font', 'BE: đọc đủ ' + (be && be.reason));
  ok(be && be.source === 'Data/level0', 'BE: nguồn file');

  /* 5. Bundle node: cảnh báo, KHÔNG bịa kết quả */
  ok(t.warnings.some(function (w) { return /node bundle/.test(w) && /chưa được đọc/.test(w); }), 'cảnh báo TMP trong node bundle');
  ok(!t.items.some(function (i) { return i.name === 'InBundle SDF'; }), 'không có kết quả cho TMP trong bundle');

  /* 6. Tổng kết */
  const s = t.summary; ok(s.assets === NA && s.parsed + s.partial + s.not_found + s.other === NA, 'summary tổng');
  const lv = function (k) { return Object.keys(EXP.assets).filter(function (x) { return EXP.assets[x].vi_level === k; }).length; };
  ok(s.vietnamese_full === lv('full') && s.vietnamese_partial === lv('partial') && s.vietnamese_none === lv('none'), 'summary VI: full ' + s.vietnamese_full + '/' + lv('full') + ' partial ' + s.vietnamese_partial + '/' + lv('partial') + ' none ' + s.vietnamese_none + '/' + lv('none'));
  ok(t.status === 'partial', 'status tổng = partial (có asset không đọc được): ' + t.status);
  JSON.parse(JSON.stringify(t)); structuredClone(t); ok(NS.TmpFont.toReportFields(t).tmp_font_assets === NA, 'toReportFields');
  ok(NS.TmpFont.toIndex(t).items.length === NA, 'toIndex');

  /* 7. decodeObject thuần: dữ liệu rác / cắt cụt / rỗng không ném lỗi */
  const mk = function (u8) { return NS.TmpFont.decodeObject(u8, true); };
  ok(mk(new Uint8Array(0)).status === 'layout_unknown', 'object rỗng');
  const rnd = new Uint8Array(5000); let seed = 12345; for (let i = 0; i < rnd.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; rnd[i] = seed >> 16; }
  const dr = mk(rnd); ok(dr.status === 'layout_unknown' || dr.status === 'glyph_table_not_found', 'dữ liệu ngẫu nhiên → không nhận bừa: ' + dr.status);
  ok(dr.glyph_table === null, 'ngẫu nhiên: không có bảng glyph');
  const raw = fs.readFileSync(path.join(dir, 'tmp_all.ipa')); // lấy lại byte object SourceCodePro SDF qua SerializedFile.parse
  const rb = new Uint8Array((await file.slice(0, file.size).arrayBuffer())); void raw; void rb;
  const ent = (await NS.IpaReader.openZip(file)).entries.find(function (e) { return e.name.endsWith('Data/resources.assets'); });
  const bytes = (await NS.IpaReader.readEntry(file, ent, { max: ent.size })).data, info = NS.SerializedFile.parse(bytes, ent.size);
  const oa = info.objects[EXP.tmp_object_indexes[0]], ob = bytes.subarray(oa.byte_start, oa.byte_start + oa.byte_size);
  const whole = NS.TmpFont.decodeObject(ob, true); ok(whole.status === 'parsed' && whole.name === 'SourceCodePro SDF', 'decodeObject trực tiếp');
  const cutAt = whole.glyph_table.offset + 4 + 36 * 50;
  const cut = NS.TmpFont.decodeObject(ob.subarray(0, cutAt), true); ok(cut.status === 'glyph_table_not_found' && cut.glyph_table === null, 'cắt cụt giữa bảng glyph → không nhận bảng thiếu: ' + cut.status);
  const flip = ob.slice(); const fo = whole.glyph_table.offset + 4 + 36 * 7; new DataView(flip.buffer).setInt32(fo, 0x7FFFFFFF, true);   // id vô lý ở phần tử 7
  const fl = NS.TmpFont.decodeObject(flip, true); ok(fl.status === 'glyph_table_not_found', 'MỘT phần tử hỏng làm hỏng cả bảng (không nhận 99%): ' + fl.status);
  const nan = ob.slice(); new DataView(nan.buffer).setUint32(whole.glyph_table.offset + 4 + 36 * 3 + 8, 0x7FC00000, true);   // NaN ở y của phần tử 3
  ok(NS.TmpFont.decodeObject(nan, true).status === 'glyph_table_not_found', 'NaN trong bảng glyph → từ chối');
  const wrongEndian = NS.TmpFont.decodeObject(ob, false); ok(wrongEndian.status !== 'parsed', 'sai endian không được đọc ra bảng hợp lệ: ' + wrongEndian.status);
  const trunc = NS.TmpFont.decodeObject(ob.subarray(0, 20), true); ok(trunc.status === 'layout_unknown' && trunc.problems.length >= 1, 'object ngắn hơn header');

  /* 8. Giới hạn và hủy */
  const savedMax = NS.TmpFont.LIMITS.max_assets; NS.TmpFont.LIMITS.max_assets = 3;
  const lim = await NS.TmpFont.scan(file, r, (await NS.IpaReader.openZip(file)).entries, hooks); NS.TmpFont.LIMITS.max_assets = savedMax;
  ok(lim.items.length === 3 && lim.warnings.some(function (w) { return /Quá 3 TMP_FontAsset/.test(w); }), 'giới hạn số asset: ' + lim.items.length);
  let cancelled = false; try { await NS.TmpFont.scan(file, r, (await NS.IpaReader.openZip(file)).entries, { isCancelled: function () { return true; } }); } catch (e) { cancelled = e.code === 'CANCELLED'; } ok(cancelled, 'hủy → CANCELLED');
  const none = await NS.TmpFont.scan(file, { serialized: { files: [{ tmp_font_assets: [] }] } }, [], hooks); ok(none.status === 'no_tmp', 'không có TMP → no_tmp');
  const nr = await NS.TmpFont.scan(file, {}, [], hooks); ok(nr.status === 'not_run', 'thiếu serialized → not_run');
  const small = await NS.TmpFont.scan(file, r, (await NS.IpaReader.openZip(file)).entries.map(function (e) { return e.name.endsWith('resources.assets') ? Object.assign({}, e, { size: 1 << 30 }) : e; }), hooks);
  ok(small.warnings.some(function (w) { return /vượt giới hạn/.test(w); }), 'file quá lớn → cảnh báo, không đọc');
  ok(r.tmp_fonts.items.every(function (i) { return i.source; }), 'mọi item có nguồn');

  console.log(fail ? '\n' + fail + ' KIỂM TRA THẤT BẠI / ' + n : '\nTẤT CẢ ĐẠT (' + n + ' kiểm tra)'); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('Lỗi test:', e); process.exit(2); });
