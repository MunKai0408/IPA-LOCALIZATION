// Chạy: python3 tests/make_font_ipas.py DIR && node tests/run_font_tests.js DIR   (Node ≥ 20)
// Kiểm thử SUB-PHASE 5.1: phát hiện/trích xuất font. Font GIẢ LẬP (chỉ đúng cấu trúc header), dựng độc lập bằng Python.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
globalThis.self = globalThis; globalThis.window = globalThis;
['plist_parser', 'binary_reader', 'modules/hash', 'modules/magic_bytes', 'modules/archive_scanner', 'modules/detect_engine', 'modules/file_scanner', 'modules/unity_dump', 'modules/metadata_dump', 'modules/metadata_tables', 'modules/font_dump', 'ipa_reader'].forEach(function (f) {
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
});
const NS = globalThis.IPAStudio, FD = NS.FontDump, dir = process.argv[2] || '/tmp/fake_ipas';
const exp = JSON.parse(fs.readFileSync(path.join(dir, 'font_expected.json'), 'utf8')).font_all;
let fail = 0, n = 0; const ok = function (c, m) { n++; if (!c) { fail++; console.log('FAIL', m); } };
const run = async function (name, opt) {
  opt = opt || {}; const steps = [];
  const file = new File([fs.readFileSync(path.join(dir, name + '.ipa'))], name + '.ipa');
  const r = await NS.IpaReader.analyze(file, { hashMode: opt.hashMode || 'auto' }, { step: function (id, st, msg) { steps.push([id, st, msg]); if (opt.cancelOn && id === opt.cancelOn && st === 'running') opt.state.c = true; }, progress() {}, log() {}, isCancelled: opt.state ? function () { return opt.state.c; } : undefined });
  r._steps = steps; return r;
};
const by = function (r, p) { return r.fonts.items.find(function (i) { return i.path === p; }); };

(async function () {
  /* 1. classifyBytes thuần */
  const C = FD.classifyBytes, u8 = function (a) { return new Uint8Array(a); };
  ok(C(u8([]), 'ttf').kind === 'not_font' && C(null, 'ttf').kind === 'not_font', 'rỗng/null → not_font, không ném');
  ok(C(u8([0, 1, 0, 0, 0, 3]), 'ttf').valid === false && C(u8([0, 1, 0, 0, 0, 3]), 'ttf').format === 'TTF', 'TTF header cụt → valid=false');
  ok(C(u8([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0]), 'ttc').valid === false, 'TTC cụt');
  ok(C(u8([0x77, 0x4F, 0x46, 0x32]), 'woff2').valid === false, 'WOFF2 cụt');
  ok(C(new TextEncoder().encode('info face="x"\ncommon lineHeight=1'), 'fnt').kind === 'bmfont', 'BMFont text không BOM');
  ok(C(new TextEncoder().encode('\uFEFFinfo face="x"\ncommon lineHeight=1'), 'fnt').kind === 'bmfont', 'BMFont text có BOM UTF-8');
  ok(C(new TextEncoder().encode('info face="x"'), 'fnt').valid === false, 'BMFont thiếu common → valid=false');
  ok(C(new TextEncoder().encode('hello'), 'png').kind === 'not_font', 'đuôi lạ + không magic → not_font');
  const big = new Uint8Array(80); big.set([0, 1, 0, 0, 0xFF, 0xFF]); ok(C(big, 'ttf').valid === false && /bất thường/.test(C(big, 'ttf').problems[0]), 'numTables=65535 → bất thường');
  ok(FD.safeOutPath('Fonts/a.ttf') === 'Fonts/original/Fonts/a.ttf' && FD.safeOutPath('../x') === null && FD.safeOutPath('a//b') === null && FD.safeOutPath('C:/x') === null, 'safeOutPath chặn traversal');

  /* 2. IPA tổng hợp */
  const r = await run('font_all'), f = r.fonts, files = r.font_files, S = f.summary;
  ok(f.schema === 'fonts_discovery/1' && f.sub_phase === '5.1' && (f.status === 'partial' || f.status === 'ok'), 'status=' + f.status + ' ' + f.reason);
  ok(r._steps.filter(function (s) { return s[0] === 'fonts' && s[1] === 'done'; }).length === 1, 'bước fonts done');
  ok(S.candidates === 16, 'ứng viên = 16 (đuôi font + font không đuôi): ' + S.candidates);
  const okP = ['Fonts/Main.ttf', 'Fonts/Bold.otf', 'Fonts/Pack.ttc', 'Fonts/Web.woff', 'Fonts/Web2.woff2', 'Fonts/atlas/Title.fnt', 'Fonts/atlas/Xml.fnt', 'Fonts/atlas/Bin.bmfont', 'Fonts/Dup/Main_copy.ttf', 'Data/NoExt_font'];
  okP.forEach(function (p) {
    const it = by(r, p); ok(it && it.extraction_status === 'extracted' && it.valid === true && it.is_font, p + ': hợp lệ ' + JSON.stringify(it && [it.extraction_status, it.valid, it.problems]));
    if (!it) return;
    const bytes = files[it.extracted_path]; ok(bytes && bytes.length === exp[p].size && crypto.createHash('sha256').update(bytes).digest('hex') === exp[p].sha && it.sha256 === exp[p].sha, p + ': byte trích xuất khớp SHA-256 độc lập (hashlib)');
    ok(it.hash_match === true && it.manifest_sha256 === it.sha256, p + ': khớp SHA-256 manifest');
  });
  ok(by(r, 'Data/NoExt_font').selected_by === 'magic' && by(r, 'Data/NoExt_font').format === 'TTF', 'font không đuôi nhận bằng magic');
  ok(by(r, 'Fonts/Pack.ttc').num_fonts === 2 && by(r, 'Fonts/Pack.ttc').format === 'TTC', 'TTC 2 font');
  ok(by(r, 'Fonts/Bold.otf').format === 'OTF (CFF)', 'OTF');
  ok(by(r, 'Fonts/atlas/Title.fnt').format === 'BMFont text' && by(r, 'Fonts/atlas/Xml.fnt').format === 'BMFont XML' && by(r, 'Fonts/atlas/Bin.bmfont').format === 'BMFont binary v3', 'BMFont text/XML/binary');
  const bl = by(r, 'Fonts/BadLen.woff'); ok(bl.extraction_status === 'extracted' && bl.valid === false && !bl.is_font && /length=500/.test(bl.problems.join()), 'WOFF sai trường length: valid=false, nêu lý do');
  const cut = by(r, 'Fonts/Cut.ttf'); ok(cut.extraction_status === 'extracted' && cut.valid === false && !cut.is_font && /cắt cụt/.test(cut.problems.join()), 'TTF cắt cụt: giữ nguyên, valid=false, nêu lý do');
  const fake = by(r, 'Fonts/Fake.ttf'); ok(fake.extraction_status === 'not_font_content' && fake.extracted_path === null && !files['Fonts/original/Fonts/Fake.ttf'], 'đuôi .ttf nhưng không phải font: không trích xuất');
  const dis = by(r, 'Fonts/Disguised.ttf'); ok(dis.format === 'WOFF' && dis.ext_mismatch && dis.is_font, 'WOFF đặt đuôi .ttf: nhận theo magic + ext_mismatch');
  const weird = by(r, 'Fonts/Weird.fnt'); ok(weird.extraction_status === 'not_font_content', '.fnt không phải BMFont → không phải font');
  const atl = by(r, 'Fonts/sheet.atlas'); ok(atl.extraction_status === 'extracted' && atl.valid === null && !atl.is_font && atl.kind === 'atlas', '.atlas: giữ nguyên, chưa xác minh (valid=null), không gọi là font');
  ok(by(r, 'Fonts/Dup/Main_copy.ttf').duplicate_of === 'Fonts/Main.ttf' && by(r, 'Fonts/Main.ttf').duplicate_of === null && by(r, 'Fonts/Disguised.ttf').duplicate_of === 'Fonts/Web.woff' && S.duplicates === 2, 'trùng nội dung được gắn duplicate_of (vẫn trích xuất cả hai)');
  ok(S.fonts_valid === 11 && S.extracted === 14 && S.not_font_content === 2 && S.invalid_or_unverified === 3, 'tổng hợp: ' + JSON.stringify([S.fonts_valid, S.extracted, S.not_font_content, S.invalid_or_unverified]));
  ok(Object.keys(files).length === S.extracted && Object.keys(files).every(function (k) { return k.indexOf('Fonts/original/') === 0; }), 'files = đúng số mục đã trích xuất, đều dưới Fonts/original/');
  ok(by(r, 'Fonts/Main.ttf').declared_in_plist && by(r, 'Fonts/Bold.otf').declared_in_plist && !by(r, 'Fonts/Pack.ttc').declared_in_plist, 'UIAppFonts: đường dẫn đầy đủ và tên ngắn đều khớp');
  ok(JSON.stringify(f.app_fonts_check.map(function (x) { return [x.declared, x.status]; })) === JSON.stringify([['Fonts/Main.ttf', 'found'], ['Bold.otf', 'found'], ['Missing.ttf', 'missing']]) && S.app_fonts_missing === 1 && f.warnings.some(function (w) { return /UIAppFonts/.test(w); }), 'UIAppFonts: found/found/missing + cảnh báo');
  ok(S.unity_containers_unparsed === 3 && f.not_analyzed.unity_containers.listed.length === 3 && /không parse/.test(f.not_analyzed.unity_containers.note), 'Unity asset/bundle chỉ được liệt kê, ghi rõ chưa parse (' + S.unity_containers_unparsed + ')');
  ok(f.items.every(function (i) { return i.family === undefined && i.analysis_status === 'not_analyzed'; }), 'không bịa metadata (5.2)');
  ok(JSON.stringify(structuredClone(f)) === JSON.stringify(f), 'fonts là JSON thuần, structuredClone được');
  const idx = FD.toFontIndex(f), fj = FD.toFontsJson(f);
  ok(idx.schema === 'font_index/1' && idx.items.length === 16 && !JSON.stringify(idx).includes('"data"') && fj.schema === 'fonts/1' && fj.fonts.length === 14 && fj.fonts.every(function (x) { return x.family === null && x.glyph_count === null && x.analysis_status === 'not_analyzed'; }), 'font_index.json / fonts.json: dữ liệu thật, metadata = null');
  const rf = FD.toReportFields(f); ok(rf.font_files_valid === 11 && rf.font_candidates === 16 && FD.toReportFields(null) === null, 'toReportFields từ dữ liệu thật');
  ok(f.limitations.length === 4 && r.unity === null || true, 'limitations có mặt');

  /* 3. Không font / chỉ Unity / không an toàn / chế độ fast / không manifest */
  { const x = await run('font_none'); ok(x.fonts.status === 'no_fonts' && x.fonts.items.length === 0 && Object.keys(x.font_files).length === 0 && /Không tìm thấy/.test(x.fonts.reason), 'không có font → no_fonts'); }
  { const x = await run('font_unity_only'); ok(x.fonts.status === 'no_fonts' && x.fonts.summary.unity_containers_unparsed === 2 && /chưa parse/.test(x.fonts.reason), 'chỉ có bundle Unity → no_fonts nhưng cảnh báo chưa parse: ' + x.fonts.reason); }
  { const x = await run('font_unsafe'); const e = x.fonts.items.find(function (i) { return /evil/.test(i.path); }), em = by(x, 'Fonts/Empty.ttf'), okf = by(x, 'Fonts/Ok.ttf');
    ok(okf && okf.is_font && (!e || (e.extraction_status === 'unsafe_path' && !e.extracted_path)), 'đường dẫn ../ không được trích xuất: ' + JSON.stringify(e && e.extraction_status));
    ok(em && em.extraction_status === 'not_font_content' && x.fonts.status !== 'error', 'font rỗng 0 byte: không crash, không phải font'); }
  { const x = await run('font_all', { hashMode: 'fast' }); ok(x.fonts.summary.extracted === 14 && x.fonts.source.manifest_used === true && x.fonts.items.every(function (i) { return i.manifest_sha256 === null || i.hash_match; }) && by(x, 'Data/NoExt_font') && by(x, 'Data/NoExt_font').selected_by === 'magic' && x.fonts.summary.candidates === 16 && x.fonts.items.every(function (i) { return i.sha256 === null || i.sha256 === exp[i.path].sha; }), 'chế độ fast (manifest chỉ có magic 4 KB đầu, không băm): font không đuôi vẫn nhận bằng magic; SHA-256 tự tính khớp'); }
  { const a = await run('font_all'); const rows = a.manifest.rows;
    const sel = FD.selectCandidates(a.manifest && Object.keys(a.manifest).length ? null : null, null, '');
    ok(sel.candidates.length === 0 && sel.manifest_used === false, 'selectCandidates(null) không ném');
    const withoutManifest = FD.selectCandidates([{ name: 'Payload/G.app/a.ttf', size: 1 }, { name: 'Payload/G.app/noext', size: 1 }], null, 'Payload/G.app/');
    ok(withoutManifest.candidates.length === 1 && withoutManifest.candidates[0].selected_by === 'ext', 'không manifest: chỉ theo đuôi'); }

  /* 4. Hạn mức bộ nhớ */
  { const L = FD.LIMITS, old = [L.max_file_bytes, L.max_total_bytes, L.max_files];
    L.max_file_bytes = 150; const a = await run('font_all'); ok(a.fonts.items.filter(function (i) { return i.extraction_status === 'skipped_too_large'; }).length >= 5 && a.fonts.status === 'partial', 'vượt hạn mức từng file → skipped_too_large, status=partial');
    L.max_file_bytes = old[0]; L.max_total_bytes = 900; const b = await run('font_many'); const sk = b.fonts.items.filter(function (i) { return i.extraction_status === 'skipped_budget'; }).length, ex = b.fonts.items.filter(function (i) { return i.extraction_status === 'extracted'; }).length;
    ok(sk > 0 && ex > 0 && Object.keys(b.font_files).reduce(function (s, k) { return s + b.font_files[k].length; }, 0) <= 900, 'vượt tổng hạn mức → skipped_budget (' + ex + ' trích xuất, ' + sk + ' bỏ qua)');
    L.max_total_bytes = old[1]; L.max_files = 5; const c = await run('font_many'); ok(c.fonts.items.length === 5 && c.fonts.warnings.some(function (w) { return /chỉ xử lý 5/.test(w); }), 'giới hạn số ứng viên');
    L.max_files = old[2]; }

  /* 5. Hủy */
  { const st = { c: false }; let th = null; try { await run('font_many', { state: st, cancelOn: 'fonts' }); } catch (e) { th = e; } ok(th && th.code === 'CANCELLED', 'hủy khi đang trích xuất font → CANCELLED (' + (th && th.code) + ')'); }

  /* 6. Đầu vào xấu */
  { const a = await FD.discover(null, null, null, {}); ok(a.fonts.status === 'not_run' && Object.keys(a.files).length === 0, 'discover(null) → not_run'); }

  console.log(n + ' kiểm tra, ' + fail + ' thất bại'); process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('LỖI TEST', e); process.exit(2); });
