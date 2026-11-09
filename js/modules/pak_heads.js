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

  /** Đọc thử header Heaps PAK từ phần đầu. Thuần hàm (không I/O). */
  function parseHeapsPak(head, pakSize) {
    const out = { format: 'heaps_pak', status: 'unverified', evidence: 'HYPOTHESIS', version: null, header_size: null, data_size: null,
      tree_complete: false, entries_total: 0, files_total: 0, dirs_total: 0, languages_hint: [], ext_histogram: {}, top_dirs: [], sample_paths: [],
      text_like_paths: [], notes: [] };
    if (head.length < 12 || ascii(head, 0, 3) !== 'PAK') { out.status = 'not_heaps_pak'; out.notes.push('Không có magic "PAK" ở đầu file.'); return out; }
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    out.version = head[3]; out.header_size = dv.getUint32(4, true); out.data_size = dv.getUint32(8, true);
    if (out.header_size < 12 || out.header_size > pakSize) { out.notes.push('header_size ngoài phạm vi file → không đọc cây.'); return out; }
    if (pakSize && out.header_size + out.data_size > pakSize + 16) out.notes.push('header_size + data_size lớn hơn kích thước file (lệch ' + (out.header_size + out.data_size - pakSize) + ' byte).');

    let pos = 12, truncated = false, bad = null;
    const files = [], dirs = []; const top = {};
    const need = function (n) { if (pos + n > head.length) { truncated = true; return false; } return true; };
    function walk(prefix, depth) {
      if (truncated || bad) return;
      if (depth > LIMITS.max_depth) { bad = 'cây quá sâu'; return; }
      if (!need(1)) return;
      const nl = head[pos++]; if (!need(nl + 1)) return;
      let name = ''; try { name = new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(pos, pos + nl)); } catch (_) { bad = 'tên entry không phải UTF-8 tại offset ' + pos; return; }
      pos += nl; const flags = head[pos++];
      if (name.indexOf('\0') >= 0 || name.indexOf('..') >= 0 && /(^|\/)\.\.(\/|$)/.test(name)) { bad = 'tên entry đáng ngờ'; return; }
      const full = depth === 0 ? '' : (prefix ? prefix + '/' : '') + name;
      if (out.entries_total >= LIMITS.max_tree_entries) { bad = 'vượt giới hạn số entry'; return; }
      out.entries_total++;
      if (flags & 1) {
        if (!need(4)) return; const cnt = dv.getUint32(pos, true); pos += 4;
        if (cnt > LIMITS.max_tree_entries) { bad = 'số con thư mục bất thường (' + cnt + ')'; return; }
        out.dirs_total++; if (full) dirs.push(full);
        for (let i = 0; i < cnt && !truncated && !bad; i++) walk(full, depth + 1);
      } else {
        if (!need(12)) return; const p = dv.getUint32(pos, true), sz = dv.getUint32(pos + 4, true); pos += 12;
        out.files_total++; files.push({ path: full, pos: p, size: sz });
        const t = full.split('/')[0]; top[t] = (top[t] || 0) + 1;
      }
    }
    walk('', 0);
    if (bad) { out.status = 'unverified'; out.notes.push('Dừng đọc cây: ' + bad + '.'); }
    else if (truncated) { out.status = 'partial'; out.notes.push('Header dài hơn phần đầu đã đọc (' + head.length + ' byte); cần tăng head_bytes ≥ ' + out.header_size + ' để đọc đủ cây.'); }
    else {
      out.tree_complete = true;
      const at = function (o) { return o + 4 <= head.length ? ascii(head, o, 4) : null; };
      out.tree_end = pos; out.data_start = null;
      if (at(pos) === 'DATA') out.data_start = pos + 4; else if (at(out.header_size) === 'DATA') out.data_start = out.header_size + 4;
      if (out.data_start !== null) { out.status = 'ok'; }
      else { out.status = 'unverified'; out.notes.push('Cây đọc xong ở offset ' + pos + ' nhưng không thấy "DATA" tại header_size (' + out.header_size + ') → bố cục có thể khác Heaps chuẩn.'); }
      // kiểm tra vị trí dữ liệu nằm trong phạm vi
      const oob = files.filter(function (f) { return f.pos + f.size > out.data_size; }).length;
      if (oob) out.notes.push(oob + ' file có pos+size vượt data_size → bố cục có thể sai.');
    }
    const eh = {}; const langs = {};
    files.forEach(function (f) {
      const e = extOf(f.path) || '(không đuôi)'; eh[e] = (eh[e] || 0) + 1;
      const m = /(?:^|[\/_.-])(en|fr|de|es|ru|zh|ja|ko|pt|it|vi|tr|pl|cs|uk)(?:[\/_.-]|$)/i.exec(f.path); if (m) langs[m[1].toLowerCase()] = 1;
    });
    out._files = files; // nội bộ: {path,pos,size}; bị loại khỏi toIndex
    out.ext_histogram = eh; out.languages_hint = Object.keys(langs).sort();
    out.top_dirs = Object.keys(top).sort(function (a, b) { return top[b] - top[a]; }).slice(0, 20).map(function (k) { return { name: k || '(gốc)', files: top[k] }; });
    const textRe = /(lang|locale|locali[sz]|i18n|l10n|string|text|dialog|message|translat|subtitle|\.cdb$|\.po$|\.xml$|\.json$|\.csv$|\.txt$)/i;
    const tl = files.filter(function (f) { return textRe.test(f.path); });
    out.text_like_paths = tl.slice(0, 300).map(function (f) { return f.path; });
    out.text_like_total = tl.length;
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
          if (row.heaps.status === 'partial' && e.method === 0 && row.heaps.header_size + 8 <= 64 * 1048576) {
            const r2 = await IR.readEntry(file, e, { head: true, max: row.heaps.header_size + 8 }); // pak lưu không nén → đọc đủ header
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

  NS.PakHeads = { SCHEMA: SCHEMA, LIMITS: LIMITS, run: run, parseHeapsPak: parseHeapsPak, toIndex: toIndex, headFiles: headFiles, buildZip: buildZip };
})(typeof window !== 'undefined' ? window : self);
