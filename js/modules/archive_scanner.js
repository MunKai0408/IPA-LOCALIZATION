/* archive_scanner.js – ghi nhận header của file nén/đóng gói. KHÔNG giải nén, không đoán khóa, không phá mã hóa.
   describe(head, format, size) -> { status, info, note } ; status ∈ recognized_not_unpacked | encrypted | unsupported | invalid_header */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  function u32le(b, o) { return o + 4 <= b.length ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : null; }
  function u32be(b, o) { return o + 4 <= b.length ? ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 : null; }
  function u16le(b, o) { return o + 2 <= b.length ? b[o] | (b[o + 1] << 8) : null; }
  function cstr(b, off, max) { let s = ''; for (let i = off; i < b.length && i < off + max && b[i] !== 0; i++) s += String.fromCharCode(b[i]); return s; }

  const NOTE = 'Chỉ ghi nhận header; chưa giải nén (chưa có parser được kiểm chứng).';

  function describe(head, format, size) {
    const f = format || '';
    const base = { status: 'recognized_not_unpacked', info: {}, note: NOTE };
    if (/^ZIP/.test(f)) {
      const flags = u16le(head, 6), method = u16le(head, 8);
      base.info = { versionNeeded: u16le(head, 4), flags: flags, method: method };
      if (flags !== null && (flags & 1)) { base.status = 'encrypted'; base.note = 'ZIP lồng nhau bị mã hóa: không đọc, không thử khóa.'; }
    } else if (/^gzip/.test(f)) {
      base.info = { method: head[2], flags: head[3], mtime: u32le(head, 4) };
    } else if (/^zlib/.test(f)) {
      base.info = { cmf: head[0], flg: head[1], windowBits: (head[0] >> 4) + 8 };
    } else if (/^LZ4/.test(f)) {
      base.info = { flg: head[4], bd: head[5] };
    } else if (/^Zstandard/.test(f)) {
      base.info = { frameDescriptor: head[4] };
    } else if (/^Unity(FS|Web|Raw)/.test(f)) {
      base.info = { signature: cstr(head, 0, 8) };
      if (head[7] === 0) {
        base.info.formatVersion = u32be(head, 8);
        const a = cstr(head, 12, 32), r = cstr(head, 12 + a.length + 1, 32);
        if (a) base.info.minPlayerVersion = a;
        if (/^\d+\.\d+\.\d+([abfp]\d+)?$/.test(r)) base.info.unityRevision = r;
      }
      base.note = 'Header UnityFS ghi nhận; nội dung bundle (có thể nén LZ4/LZMA) chưa giải nén ở Phase 3.';
    } else if (/^Godot PCK/.test(f)) {
      const ma = u32le(head, 8), mi = u32le(head, 12), pa = u32le(head, 16);
      base.info = { packFormat: u32le(head, 4) };
      if (ma >= 1 && ma <= 9 && mi < 100 && pa < 100) base.info.engineVersion = ma + '.' + mi + '.' + pa;
    } else if (/UTOC/.test(f)) {
      base.info = { tocVersion: head[16] };
    } else if (/PAK|UCAS/.test(f)) {
      base.status = 'unsupported'; base.info = { size: size };
      base.note = 'Nhận diện theo đuôi file; magic/footer chưa được kiểm tra, chưa có parser.';
    } else {
      base.status = 'unsupported'; base.note = 'Định dạng nén chưa hỗ trợ: ghi nhận magic và kích thước.';
    }
    return base;
  }

  function isArchiveLike(det) {
    return det.type === 'Archive' || /^Unity(FS|Web|Raw)/.test(det.format) || /Unreal (PAK|IoStore)/.test(det.format) || /Godot PCK/.test(det.format);
  }

  NS.ArchiveScanner = { describe: describe, isArchiveLike: isArchiveLike };
})(typeof window !== 'undefined' ? window : self);
