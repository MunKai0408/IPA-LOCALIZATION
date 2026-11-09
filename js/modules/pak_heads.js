/* pak_heads.js – thay cho tools extract_pak_heads.py: lấy N byte ĐẦU của mọi *.pak trong IPA ngay trong trình duyệt
   (File.slice, KHÔNG giải nén cả IPA, KHÔNG nạp cả pak vào RAM, KHÔNG gửi dữ liệu đi đâu) + đọc thử danh mục file bên trong.
   Phụ thuộc call-time: NS.IpaReader.readEntry, NS.Hash. Chạy được ở Worker và luồng chính. Không ném lỗi (trừ CANCELLED).

   NHÃN BẰNG CHỨNG: mọi kết luận về định dạng pak là [HYPOTHESIS] (logic-only, chưa đối chiếu pak thật).
   - Đuôi .pak KHÔNG chứng minh Unreal. Dead Cells (Heaps/HashLink) cũng dùng .pak nhưng magic ở ĐẦU file là "PAK".
   - Unreal pak có magic ở FOOTER (0x5A6F12E1) → module này chỉ có head nên KHÔNG kết luận Unreal, chỉ ghi "unknown".
   - Bố cục Heaps PAK (hxd.fmt.pak): "PAK" + version u8 + headerSize u32 + dataSize u32, rồi cây entry:
       nameLen u8 + name + flags u8 (bit0 = thư mục); thư mục: count u32 + con; file: pos u32 + size u32 + checksum 4 byte.
     Sau header (offset = headerSize) kỳ vọng "DATA". Nếu không khớp → status 'unverified' (không đoán). */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const SCHEMA = 'pak_heads/1';
  const LIMITS = { head_bytes: 2 * 1048576, max_pak: 64, max_tree_entries: 200000, max_depth: 32, sample_paths: 2000 };

  function hex(u8, n) { const a = []; for (let i = 0; i < Math.min(n, u8.length); i++) a.push(('0' + u8[i].toString(16)).slice(-2)); return a.join(' '); }
  function sha256(u8) { const h = NS.Hash.create('sha256'); h.update(u8); return h.hex(); }
  function ascii(u8, o, n) { let s = ''; for (let i = 0; i < n && o + i < u8.length; i++) s += String.fromCharCode(u8[o + i]); return s; }
  function extOf(n) { const i = n.lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); }

  /** Thử 1 bố cục cây (csum = số byte checksum sau pos/size; rootNamed = gốc có tên-độ-dài). Thuần hàm. */
  function walkTree(head, dv, csum, rootNamed, start) {
    const r = { pos: start || 12, truncated: false, bad: null, entries: 0, files: [], dirs: 0, top: {} };
    const need = function (n) { if (r.pos + n > head.length) { r.truncated = true; return false; } return true; };
    function walk(prefix, depth) {
      if (r.truncated || r.bad) return;
      if (depth > LIMITS.max_depth) { r.bad = 'cây quá sâu'; return; }
      let name = '';
      if (depth > 0 || rootNamed) {
        if (!need(1)) return;
        const nl = head[r.pos++]; if (!need(nl)) return;
        try { name = new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(r.pos, r.pos + nl)); } catch (_) { r.bad = 'tên entry không phải UTF-8 tại offset ' + r.pos; return; }
        r.pos += nl;
        if (name.indexOf('\0') >= 0 || name.indexOf('/') >= 0) { r.bad = 'tên entry đáng ngờ'; return; }
      }
      if (!need(1)) return; const flags = head[r.pos++];
      const full = depth === 0 ? '' : (prefix ? prefix + '/' : '') + name;
      if (r.entries >= LIMITS.max_tree_entries) { r.bad = 'vượt giới hạn số entry'; return; }
      r.entries++;
      if (flags & 1) {
        if (!need(4)) return; const cnt = dv.getUint32(r.pos, true); r.pos += 4;
        if (cnt > LIMITS.max_tree_entries) { r.bad = 'số con thư mục bất thường (' + cnt + ')'; return; }
        r.dirs++;
        for (let i = 0; i < cnt && !r.truncated && !r.bad; i++) walk(full, depth + 1);
      } else {
        if (!need(8 + csum)) return; const p = dv.getUint32(r.pos, true), sz = dv.getUint32(r.pos + 4, true); r.pos += 8 + csum;
        r.files.push({ path: full, pos: p, size: sz });
        const t = full.split('/')[0]; r.top[t] = (r.top[t] || 0) + 1;
      }
    }
    walk('', 0);
    return r;
  }

  /** Chẩn đoán header khi không khớp bố cục: hex 64 byte sau header 12 byte, entropy Shannon và tỉ lệ ASCII in được trên vùng header đã đọc.
      Entropy ≳ 7.5 bit/byte → header có thể bị nén/mã hóa/xáo trộn (không phải cây Heaps thuần). Thuần hàm. */
  function probeHeader(head, headerSize) {
    const n = Math.max(0, Math.min(head.length, headerSize || head.length) - 12), cnt = new Array(256).fill(0); let pr = 0;
    for (let i = 12; i < 12 + n; i++) { cnt[head[i]]++; if (head[i] >= 32 && head[i] < 127) pr++; }
    let ent = 0; for (let b = 0; b < 256; b++) if (cnt[b]) { const q = cnt[b] / n; ent -= q * Math.log2(q); }
    return { bytes_12_76_hex: hex(head.subarray(12, 76), 64), sampled_bytes: n, entropy_bits_per_byte: n ? Math.round(ent * 100) / 100 : null, printable_ratio: n ? Math.round(pr / n * 100) / 100 : null,
      interpretation: !n ? 'không đủ dữ liệu' : ent > 7.5 ? '[HYPOTHESIS] entropy cao: header có thể bị nén/mã hóa/xáo trộn' : ent < 5 ? '[HYPOTHESIS] entropy thấp: cấu trúc thô, có thể là cây với bố cục khác' : '[HYPOTHESIS] entropy trung bình: chưa kết luận' };
  }

  /** Đọc thử header Heaps PAK từ phần đầu. Thử vài bố cục; chỉ nhận bố cục nào kết thúc cây đúng chỗ có "DATA". Thuần hàm (không I/O). */
  function parseHeapsPak(head, pakSize) {
    const out = { format: 'heaps_pak', status: 'unverified', evidence: 'HYPOTHESIS', version: null, header_size: null, data_size: null, layout: null,
      tree_complete: false, entries_total: 0, files_total: 0, dirs_total: 0, languages_hint: [], ext_histogram: {}, top_dirs: [], sample_paths: [],
      text_like_paths: [], notes: [] };
    if (head.length < 12 || ascii(head, 0, 3) !== 'PAK') { out.status = 'not_heaps_pak'; out.notes.push('Không có magic "PAK" ở đầu file.'); return out; }
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    out.version = head[3]; out.header_size = dv.getUint32(4, true); out.data_size = dv.getUint32(8, true);
    if (out.header_size < 12 || out.header_size > pakSize) { out.notes.push('header_size ngoài phạm vi file → không đọc cây.'); return out; }
    if (pakSize && out.header_size + out.data_size > pakSize + 16) out.notes.push('header_size + data_size lớn hơn kích thước file (lệch ' + (out.header_size + out.data_size - pakSize) + ' byte).');

    const at = function (o) { return o + 4 <= head.length ? ascii(head, o, 4) : null; };
    const LAYOUTS = [{ csum: 4, rootNamed: true }, { csum: 4, rootNamed: false }, { csum: 0, rootNamed: true }, { csum: 0, rootNamed: false }, { csum: 8, rootNamed: true }, { csum: 8, rootNamed: false }, { csum: 16, rootNamed: true }, { csum: 32, rootNamed: true },
      /* [HYPOTHESIS] pak Dead Cells thật có 4 byte lạ ngay sau header 12 byte (log: 66 35 66 65 ở mọi pak) → thử cây bắt đầu ở offset 16 */
      { csum: 4, rootNamed: true, start: 16 }, { csum: 4, rootNamed: false, start: 16 }, { csum: 0, rootNamed: true, start: 16 }, { csum: 0, rootNamed: false, start: 16 }];
    let best = null, bestLay = null, dataStart = null; const tried = [];
    for (let i = 0; i < LAYOUTS.length; i++) {
      const w = walkTree(head, dv, LAYOUTS[i].csum, LAYOUTS[i].rootNamed, LAYOUTS[i].start);
      const ds = (!w.truncated && !w.bad) ? (at(w.pos) === 'DATA' ? w.pos + 4 : null) : null;
      tried.push('csum=' + LAYOUTS[i].csum + (LAYOUTS[i].rootNamed ? '' : ',gốc không tên') + (LAYOUTS[i].start ? ',bắt đầu@' + LAYOUTS[i].start : '') + ': ' + (w.bad || (w.truncated ? 'cụt' : (ds === null ? 'không thấy DATA tại offset ' + w.pos : 'OK'))));
      if (ds !== null) { best = w; bestLay = LAYOUTS[i]; dataStart = ds; break; }
      if (!best) { best = w; bestLay = LAYOUTS[i]; } // giữ bố cục đầu tiên làm mặc định để báo cáo
      if (w.truncated && head.length < pakSize) { best = w; bestLay = LAYOUTS[i]; break; } // header dài hơn phần đã đọc (file còn nữa): dừng thử, cần đọc thêm
    }
    out.layout = bestLay ? { checksum_bytes: bestLay.csum, root_named: bestLay.rootNamed, tree_start: bestLay.start || 12 } : null; out.layouts_tried = tried;
    const w = best;
    out.entries_total = w.entries; out.dirs_total = w.dirs; out.files_total = w.files.length;
    if (dataStart !== null) { out.status = 'ok'; out.tree_complete = true; out.tree_end = w.pos; out.data_start = dataStart; }
    else if (w.truncated) { out.status = 'partial'; out.notes.push('Header dài hơn phần đầu đã đọc (' + head.length + ' byte); cần đọc ≥ ' + out.header_size + ' byte để thấy đủ cây.'); }
    else { out.status = 'unverified'; out.header_probe = probeHeader(head, out.header_size); out.notes.push('Không bố cục nào khớp "DATA": ' + tried.join(' | ')); }
    if (out.status === 'ok') { const oob = w.files.filter(function (f) { return f.pos + f.size > out.data_size; }).length; if (oob) out.notes.push(oob + ' file có pos+size vượt data_size → bố cục có thể sai.'); }
    const files = w.files; const eh = {}, langs = {};
    files.forEach(function (f) {
      const e = extOf(f.path) || '(không đuôi)'; eh[e] = (eh[e] || 0) + 1;
      const m = /(?:^|[\/_.-])(en|fr|de|es|ru|zh|ja|ko|pt|it|vi|tr|pl|cs|uk)(?:[\/_.-]|$)/i.exec(f.path); if (m) langs[m[1].toLowerCase()] = 1;
    });
    out._files = files; out.ext_histogram = eh; out.languages_hint = Object.keys(langs).sort();
    out.top_dirs = Object.keys(w.top).sort(function (a, b) { return w.top[b] - w.top[a]; }).slice(0, 20).map(function (k) { return { name: k || '(gốc)', files: w.top[k] }; });
    const textRe = /(lang|locale|locali[sz]|i18n|l10n|string|text|dialog|message|translat|subtitle|\.cdb$|\.po$|\.xml$|\.json$|\.csv$|\.txt$)/i;
    const tl = files.filter(function (f) { return textRe.test(f.path); });
    out.text_like_paths = tl.slice(0, 300).map(function (f) { return f.path; }); out.text_like_total = tl.length;
    out.sample_paths = files.slice(0, LIMITS.sample_paths).map(function (f) { return f.path; });
    out.notes.push('[HYPOTHESIS] Tên file không phải bằng chứng file chứa text hiển thị; chưa qua Cổng 0.');
    return out;
  }

  /** Chạy trên danh sách entry của IPA. entries: mảng từ openZip. */
  async function run(file, entries, opts) {
    opts = opts || {};
    const IR = NS.IpaReader, cancelled = opts.isCancelled || function () { return false; };
    const headBytes = Math.max(4096, Math.min(opts.headBytes || LIMITS.head_bytes, 64 * 1048576));
    const res = { schema: SCHEMA, status: 'no_pak', reason: 'Không thấy file .pak', head_bytes_requested: headBytes, pak_files: [], warnings: [],
      limitations: ['Chỉ đọc phần ĐẦU mỗi pak; pak kiểu Unreal có magic ở footer nên không kết luận Unreal/Heaps chỉ từ đuôi file.',
        'Chưa đối chiếu với pak thật: kết luận định dạng là [HYPOTHESIS]. Gửi pak_heads.json (+ file .head nếu cần) để đối chiếu.'] };
    const paks = entries.filter(function (e) { return !e.dir && !e.unsafe && /\.pak$/i.test(e.name); }).slice(0, LIMITS.max_pak);
    if (!paks.length) return res;
    for (let i = 0; i < paks.length; i++) {
      if (cancelled()) { const e = new Error('Đã hủy'); e.code = 'CANCELLED'; throw e; }
      const e = paks[i], row = { zip_path: e.name, size: e.size, csize: e.csize, compress_type: e.method, saved_bytes: 0, first_16_hex: null, sha256_of_saved_head: null, format_guess: 'unknown', heaps: null, error: null };
      try {
        if (e.method !== 0 && e.method !== 8) throw new Error('Phương thức nén ' + e.method + ' chưa hỗ trợ');
        const r = await IR.readEntry(file, e, { head: true, max: headBytes });
        row.saved_bytes = r.data.length; row.first_16_hex = hex(r.data, 16); row.sha256_of_saved_head = sha256(r.data);
        row._head = r.data; // giữ để tải .head; bị loại khỏi JSON trong toIndex
        if (ascii(r.data, 0, 3) === 'PAK') {
          row.heaps = parseHeapsPak(r.data, e.size);
          if (row.heaps.status === 'partial' && row.heaps.header_size + 8 <= 64 * 1048576) {
            const r2 = await IR.readEntry(file, e, { head: true, max: row.heaps.header_size + 8 }); // đọc đủ header (pak lưu không nén hoặc deflate đều được)
            row._head = r2.data;
            row.heaps = parseHeapsPak(r2.data, e.size);
          } row.format_guess = row.heaps.status === 'ok' ? 'heaps_pak' : 'heaps_pak?'; }
        else if (ascii(r.data, 0, 4) === 'GDPC') row.format_guess = 'godot_pck';
        else row.format_guess = 'unknown'; // Unreal: magic ở footer → không kết luận từ head
      } catch (err) {
        if (err && err.code === 'CANCELLED') throw err;
        row.error = (err && err.message) || String(err); res.warnings.push('Không đọc được ' + e.name + ': ' + row.error);
      }
      res.pak_files.push(row);
    }
    if (entries.filter(function (e) { return !e.dir && /\.pak$/i.test(e.name); }).length > LIMITS.max_pak) res.warnings.push('Chỉ xử lý ' + LIMITS.max_pak + ' pak đầu.');
    const okN = res.pak_files.filter(function (p) { return p.saved_bytes > 0; }).length;
    res.status = okN ? 'ok' : 'error';
    res.reason = okN + '/' + res.pak_files.length + ' pak đã lấy phần đầu (' + Math.round(headBytes / 1048576 * 10) / 10 + ' MB/file tối đa)';
    return res;
  }

  /** JSON gọn để tải về (không chứa byte thô). */
  function toIndex(r) {
    return { schema: SCHEMA, status: r.status, reason: r.reason, head_bytes_requested: r.head_bytes_requested, limitations: r.limitations, warnings: r.warnings,
      pak_files: r.pak_files.map(function (p) { const o = Object.assign({}, p); delete o._head; if (o.heaps) { o.heaps = Object.assign({}, o.heaps); delete o.heaps._files; } return o; }) };
  }

  /** Danh sách {name, data} các file .head (cùng quy ước tên với extract_pak_heads.py: '/' → '__'). */
  function headFiles(r) {
    return r.pak_files.filter(function (p) { return p._head; }).map(function (p) { return { name: p.zip_path.replace(/\//g, '__') + '.head', data: p._head }; });
  }

  /** ZIP kiểu STORE (không nén) tối giản để tải gộp pak_heads/*.head + summary.json. */
  function buildZip(files) {
    const enc = new TextEncoder(), parts = [], cd = []; let off = 0;
    const u16 = function (v) { return [v & 255, (v >>> 8) & 255]; }, u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    files.forEach(function (f) {
      const nm = enc.encode(f.name), c = NS.Hash.create('crc32'); c.update(f.data); const crc = c.value();
      const lh = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 33, 0].concat(u32(crc), u32(f.data.length), u32(f.data.length), u16(nm.length), [0, 0]));
      parts.push(lh, nm, f.data);
      cd.push({ nm: nm, crc: crc, size: f.data.length, off: off }); off += lh.length + nm.length + f.data.length;
    });
    let cdSize = 0;
    cd.forEach(function (x) {
      const h = new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 33, 0].concat(u32(x.crc), u32(x.size), u32(x.size), u16(x.nm.length), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], u32(x.off)));
      parts.push(h, x.nm); cdSize += h.length + x.nm.length;
    });
    parts.push(new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0].concat(u16(cd.length), u16(cd.length), u32(cdSize), u32(off), [0, 0])));
    return new Blob(parts, { type: 'application/zip' });
  }

  NS.PakHeads = { SCHEMA: SCHEMA, LIMITS: LIMITS, run: run, parseHeapsPak: parseHeapsPak, probeHeader: probeHeader, toIndex: toIndex, headFiles: headFiles, buildZip: buildZip };
})(typeof window !== 'undefined' ? window : self);
