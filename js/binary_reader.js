/* binary_reader.js – đọc header Mach-O (thin/fat): kiến trúc + cờ mã hóa FairPlay (cryptid).
   Chỉ ĐỌC và BÁO CÁO. Không giải mã, không chạy binary. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const MH_MAGIC = 0xFEEDFACE, MH_MAGIC_64 = 0xFEEDFACF;
  const FAT_MAGIC = 0xCAFEBABE, FAT_MAGIC_64 = 0xCAFEBABF;
  const LC_ENCRYPTION_INFO = 0x21, LC_ENCRYPTION_INFO_64 = 0x2C;
  const SLICE_PROBE = 1024 * 1024; // lượng byte cần để đọc load commands của 1 slice trong fat

  function archName(cpu, sub) {
    const s = sub & 0x00FFFFFF;
    switch (cpu) {
      case 0x0100000C: return s === 2 ? 'arm64e' : 'arm64';
      case 0x0200000C: return 'arm64_32';
      case 0x0C: return ({ 6: 'armv6', 9: 'armv7', 11: 'armv7s', 12: 'armv7k' })[s] || 'arm';
      case 0x01000007: return 'x86_64';
      case 0x07: return 'i386';
      default: return 'cpu_0x' + (cpu >>> 0).toString(16);
    }
  }

  /** Đọc 1 slice bắt đầu tại `off` trong `dv`. Trả về null nếu không phải Mach-O thin. */
  function parseThin(dv, off) {
    if (off + 28 > dv.byteLength) return { incomplete: true, need: off + 32 };
    const magic = dv.getUint32(off, true);
    if (magic !== MH_MAGIC && magic !== MH_MAGIC_64) return null;
    const is64 = magic === MH_MAGIC_64;
    const cpu = dv.getUint32(off + 4, true), sub = dv.getUint32(off + 8, true);
    const filetype = dv.getUint32(off + 12, true);
    const ncmds = dv.getUint32(off + 16, true), sizeofcmds = dv.getUint32(off + 20, true);
    const hdr = is64 ? 32 : 28;
    const r = { name: archName(cpu, sub), cpuType: cpu, cpuSubtype: sub & 0x00FFFFFF, bits: is64 ? 64 : 32, filetype: filetype,
                encrypted: null, cryptid: null, loadCommandsComplete: false, need: 0 };
    if (sizeofcmds > 8 * 1024 * 1024 || ncmds > 100000) { r.note = 'load commands bất thường'; return r; }
    const end = off + hdr + sizeofcmds;
    if (end > dv.byteLength) { r.need = end; return r; }
    let p = off + hdr;
    for (let i = 0; i < ncmds; i++) {
      if (p + 8 > end) break;
      const cmd = dv.getUint32(p, true), size = dv.getUint32(p + 4, true);
      if (size < 8 || p + size > end) break;
      if ((cmd === LC_ENCRYPTION_INFO || cmd === LC_ENCRYPTION_INFO_64) && size >= 20) {
        r.cryptid = dv.getUint32(p + 16, true);
        r.encrypted = r.cryptid !== 0;
      }
      p += size;
    }
    r.loadCommandsComplete = true;
    if (r.encrypted === null) r.encrypted = false; // đã duyệt hết load commands, không có LC_ENCRYPTION_INFO
    return r;
  }

  NS.BinaryReader = {
    /**
     * @param {Uint8Array} bytes phần đầu của file (có thể bị cắt)
     * @param {number} [fileSize] kích thước thật của file (để biết slice nằm ngoài vùng đã đọc)
     * @returns {{format:'thin'|'fat'|'unknown', archs:Array, needBytes:number, error?:string}}
     */
    parseMachO: function (bytes, fileSize) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError('parseMachO cần Uint8Array');
      const out = { format: 'unknown', archs: [], needBytes: 0 };
      if (bytes.length < 8) { out.error = 'File quá ngắn để là Mach-O'; return out; }
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const be = dv.getUint32(0, false);

      if (be === FAT_MAGIC || be === FAT_MAGIC_64) {
        const is64 = be === FAT_MAGIC_64, rec = is64 ? 32 : 20;
        const n = dv.getUint32(4, false);
        if (n === 0 || n > 32) { out.error = 'Header fat không hợp lệ (nfat_arch=' + n + ')'; return out; }
        if (8 + n * rec > dv.byteLength) { out.format = 'fat'; out.needBytes = 8 + n * rec; return out; }
        out.format = 'fat';
        for (let i = 0; i < n; i++) {
          const p = 8 + i * rec;
          const cpu = dv.getUint32(p, false), sub = dv.getUint32(p + 4, false);
          const offset = is64 ? Number(dv.getBigUint64(p + 8, false)) : dv.getUint32(p + 8, false);
          const size = is64 ? Number(dv.getBigUint64(p + 16, false)) : dv.getUint32(p + 12, false);
          const a = { name: archName(cpu, sub), cpuType: cpu, cpuSubtype: sub & 0x00FFFFFF, offset: offset, size: size,
                      bits: null, encrypted: null, cryptid: null };
          const t = offset < dv.byteLength ? parseThin(dv, offset) : { incomplete: true, need: offset + SLICE_PROBE };
          if (t && !t.incomplete) {
            a.bits = t.bits; a.encrypted = t.encrypted; a.cryptid = t.cryptid;
            if (t.need) out.needBytes = Math.max(out.needBytes, t.need);
          } else if (t && t.incomplete) {
            out.needBytes = Math.max(out.needBytes, t.need);
          }
          out.archs.push(a);
        }
        return out;
      }

      const t = parseThin(dv, 0);
      if (!t) { out.error = 'Không phải Mach-O (magic 0x' + dv.getUint32(0, true).toString(16) + ')'; return out; }
      if (t.incomplete) { out.format = 'thin'; out.needBytes = t.need; return out; }
      out.format = 'thin';
      out.needBytes = t.need || 0;
      out.archs.push({ name: t.name, cpuType: t.cpuType, cpuSubtype: t.cpuSubtype, offset: 0, size: fileSize != null ? fileSize : null,
                       bits: t.bits, encrypted: t.encrypted, cryptid: t.cryptid });
      return out;
    }
  };
})(typeof window !== 'undefined' ? window : self);
