/* hash.js – SHA-1, SHA-256 (tăng dần theo từng chunk) và CRC32. Không thư viện ngoài, chạy được ở Worker.
   crypto.subtle.digest không hỗ trợ băm theo luồng nên file lớn sẽ phải nạp cả vào RAM; vì vậy tự cài đặt. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  function hex(words, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += ('00000000' + (words[i] >>> 0).toString(16)).slice(-8);
    return s;
  }

  /* Khung chung: gom dữ liệu thành khối 64 byte, gọi block(view, offset). */
  function Hasher(init, block, bigEndianLen) {
    this.h = init; this.block = block; this.buf = new Uint8Array(64); this.bl = 0; this.len = 0; this.done = false;
    this.dv = new DataView(this.buf.buffer);
  }
  Hasher.prototype.update = function (data) {
    if (this.done) throw new Error('đã kết thúc');
    let i = 0; const n = data.length; this.len += n;
    if (this.bl) {
      const take = Math.min(64 - this.bl, n);
      this.buf.set(data.subarray(0, take), this.bl); this.bl += take; i = take;
      if (this.bl === 64) { this.block(this.h, this.dv, 0); this.bl = 0; }
    }
    if (i + 64 <= n) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (; i + 64 <= n; i += 64) this.block(this.h, dv, i);
    }
    if (i < n) { this.buf.set(data.subarray(i), 0); this.bl = n - i; }
  };
  Hasher.prototype.finish = function (words) {
    if (this.done) return;
    this.done = true;
    const bits = this.len * 8, buf = this.buf;
    buf[this.bl++] = 0x80;
    if (this.bl > 56) { buf.fill(0, this.bl, 64); this.block(this.h, this.dv, 0); this.bl = 0; }
    buf.fill(0, this.bl, 56);
    this.dv.setUint32(56, Math.floor(bits / 4294967296), false);
    this.dv.setUint32(60, bits >>> 0, false);
    this.block(this.h, this.dv, 0);
  };

  /* ---- SHA-1 ---- */
  const w1 = new Uint32Array(80);
  function sha1Block(h, dv, o) {
    const w = w1;
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4, false);
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0;
  }

  /* ---- SHA-256: hằng số tính từ căn bậc 2/3 của các số nguyên tố (theo định nghĩa chuẩn) ---- */
  const primes = []; for (let n = 2; primes.length < 64; n++) { let ok = true; for (let j = 0; j < primes.length && primes[j] * primes[j] <= n; j++) if (n % primes[j] === 0) { ok = false; break; } if (ok) primes.push(n); }
  const frac32 = function (x) { return Math.floor((x - Math.floor(x)) * 4294967296) >>> 0; };
  const K256 = new Uint32Array(primes.map(function (p) { return frac32(Math.cbrt(p)); }));
  const H256 = primes.slice(0, 8).map(function (p) { return frac32(Math.sqrt(p)); });
  const w2 = new Uint32Array(64);
  function sha256Block(h, dv, o) {
    const w = w2;
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  /* ---- CRC32 ---- */
  const CRC_T = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; }

  function create(algo) {
    if (algo === 'sha1') {
      const H = new Hasher(new Int32Array([0x67452301, 0xEFCDAB89 | 0, 0x98BADCFE | 0, 0x10325476, 0xC3D2E1F0 | 0]), sha1Block);
      return { update: function (d) { H.update(d); }, hex: function () { H.finish(); return hex(H.h, 5); } };
    }
    if (algo === 'sha256') {
      const H = new Hasher(new Int32Array(H256), sha256Block);
      return { update: function (d) { H.update(d); }, hex: function () { H.finish(); return hex(H.h, 8); } };
    }
    if (algo === 'crc32') {
      let c = 0xFFFFFFFF;
      return {
        update: function (d) { for (let i = 0; i < d.length; i++) c = CRC_T[(c ^ d[i]) & 0xFF] ^ (c >>> 8); },
        hex: function () { return ('00000000' + ((c ^ 0xFFFFFFFF) >>> 0).toString(16)).slice(-8); },
        value: function () { return (c ^ 0xFFFFFFFF) >>> 0; }
      };
    }
    throw new Error('Thuật toán không hỗ trợ: ' + algo);
  }

  NS.Hash = { create: create };
})(typeof window !== 'undefined' ? window : self);
