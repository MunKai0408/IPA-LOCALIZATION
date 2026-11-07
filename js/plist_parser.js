/* plist_parser.js – đọc plist XML và binary (bplist00) thành đối tượng JS.
   Chạy được cả trong Web Worker (không dùng DOMParser). Không thực thi gì từ dữ liệu. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};
  const MAX_DEPTH = 64;

  class PlistError extends Error {
    constructor(message) { super(message); this.name = 'PlistError'; this.code = 'PLIST_ERROR'; }
  }

  /* ---------------- XML ---------------- */
  function decodeXmlText(bytes) {
    let enc = 'utf-8', start = 0;
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) { enc = 'utf-16le'; start = 2; }
    else if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) { enc = 'utf-16be'; start = 2; }
    else if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) { start = 3; }
    return new TextDecoder(enc).decode(start ? bytes.subarray(start) : bytes);
  }

  function unescapeXml(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, function (m, e) {
      switch (e) {
        case 'lt': return '<'; case 'gt': return '>'; case 'amp': return '&';
        case 'quot': return '"'; case 'apos': return "'";
      }
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch (_) { return m; }
    });
  }
  function escapeXml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function tokenizeXml(str) {
    str = str.replace(/<!--[\s\S]*?-->/g, '')
             .replace(/<\?[\s\S]*?\?>/g, '')
             .replace(/<!DOCTYPE[^>]*>/gi, '')
             .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, function (m, t) { return escapeXml(t); });
    const re = /<(\/?)([A-Za-z][\w-]*)[^>]*?(\/?)>|([^<]+)/g;
    const tokens = []; let m;
    while ((m = re.exec(str)) !== null) {
      if (m[4] !== undefined) tokens.push({ k: 'text', v: m[4] });
      else tokens.push({ k: m[1] ? 'close' : (m[3] ? 'self' : 'open'), n: m[2] });
    }
    return tokens;
  }

  function parseXml(bytes) {
    const tokens = tokenizeXml(decodeXmlText(bytes));
    let i = 0;
    const skipWs = function () { while (i < tokens.length && tokens[i].k === 'text' && !tokens[i].v.trim()) i++; };

    function readText(name) { // đọc nội dung chữ tới thẻ đóng </name>
      let s = '';
      while (i < tokens.length && tokens[i].k === 'text') s += tokens[i++].v;
      if (!(i < tokens.length && tokens[i].k === 'close' && tokens[i].n === name)) throw new PlistError('Thiếu thẻ đóng </' + name + '>');
      i++;
      return unescapeXml(s);
    }

    function value(depth) {
      if (depth > MAX_DEPTH) throw new PlistError('plist lồng quá sâu');
      skipWs();
      const t = tokens[i++];
      if (!t) throw new PlistError('plist kết thúc bất ngờ');
      if (t.k === 'close' || t.k === 'text') throw new PlistError('Cấu trúc plist không hợp lệ');
      const n = t.n;
      if (t.k === 'self') {
        switch (n) {
          case 'true': return true; case 'false': return false;
          case 'string': case 'key': case 'date': return '';
          case 'array': return []; case 'dict': return {};
          case 'data': return new Uint8Array(0);
          default: throw new PlistError('Thẻ <' + n + '/> không được hỗ trợ');
        }
      }
      switch (n) {
        case 'plist': { const v = value(depth + 1); skipWs(); if (tokens[i] && tokens[i].k === 'close') i++; return v; }
        case 'dict': {
          const obj = {};
          for (;;) {
            skipWs();
            const k = tokens[i];
            if (!k) throw new PlistError('dict không đóng');
            if (k.k === 'close' && k.n === 'dict') { i++; return obj; }
            if (!(k.k === 'open' && k.n === 'key')) throw new PlistError('Mong đợi <key> trong dict');
            i++;
            const key = readText('key');
            obj[key] = value(depth + 1);
          }
        }
        case 'array': {
          const arr = [];
          for (;;) {
            skipWs();
            const k = tokens[i];
            if (!k) throw new PlistError('array không đóng');
            if (k.k === 'close' && k.n === 'array') { i++; return arr; }
            arr.push(value(depth + 1));
          }
        }
        case 'string': return readText('string');
        case 'key': return readText('key');
        case 'integer': {
          const txt = readText('integer').trim(); const v = Number(txt);
          if (!isFinite(v)) throw new PlistError('integer không hợp lệ: ' + txt);
          return Number.isSafeInteger(v) ? v : txt;
        }
        case 'real': { const v = Number(readText('real').trim()); if (isNaN(v)) throw new PlistError('real không hợp lệ'); return v; }
        case 'date': return readText('date').trim();
        case 'data': {
          const b64 = readText('data').replace(/\s+/g, '');
          const bin = atob(b64); const out = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
          return out;
        }
        case 'true': case 'false': { readText(n); return n === 'true'; }
        default: throw new PlistError('Thẻ <' + n + '> không được hỗ trợ');
      }
    }
    return value(0);
  }

  /* ---------------- Binary (bplist00) ---------------- */
  function parseBinary(bytes) {
    if (bytes.length < 40) throw new PlistError('bplist quá ngắn');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tr = bytes.length - 32;
    const offSize = dv.getUint8(tr + 6), refSize = dv.getUint8(tr + 7);
    const numObjs = Number(dv.getBigUint64(tr + 8)), top = Number(dv.getBigUint64(tr + 16)), tableOff = Number(dv.getBigUint64(tr + 24));
    if (!offSize || offSize > 8 || !refSize || refSize > 8) throw new PlistError('bplist trailer không hợp lệ');
    if (numObjs <= 0 || tableOff + numObjs * offSize > tr) throw new PlistError('bảng offset bplist ngoài phạm vi');
    if (top >= numObjs) throw new PlistError('top object ngoài phạm vi');

    const uint = function (pos, size) {
      if (pos < 0 || pos + size > bytes.length) throw new PlistError('đọc ngoài phạm vi bplist');
      let v = 0; for (let j = 0; j < size; j++) v = v * 256 + dv.getUint8(pos + j); return v;
    };
    const objOffset = function (idx) {
      if (idx >= numObjs) throw new PlistError('tham chiếu object ngoài phạm vi');
      const o = uint(tableOff + idx * offSize, offSize);
      if (o >= tr) throw new PlistError('offset object ngoài phạm vi');
      return o;
    };
    const lenAt = function (pos, low) { // trả [độ dài, vị trí dữ liệu]
      if (low !== 0xF) return [low, pos + 1];
      const m = dv.getUint8(pos + 1);
      if ((m >> 4) !== 1) throw new PlistError('độ dài mở rộng không hợp lệ');
      const sz = 1 << (m & 0xF);
      return [uint(pos + 2, sz), pos + 2 + sz];
    };

    let counter = 0;
    function read(idx, depth) {
      if (depth > MAX_DEPTH) throw new PlistError('bplist lồng quá sâu (nghi vòng lặp)');
      if (++counter > numObjs * 4 + 16) throw new PlistError('bplist có vòng tham chiếu');
      const pos = objOffset(idx);
      const marker = dv.getUint8(pos), hi = marker >> 4, lo = marker & 0xF;
      switch (hi) {
        case 0x0:
          if (marker === 0x08) return false; if (marker === 0x09) return true; if (marker === 0x00) return null;
          throw new PlistError('marker 0x' + marker.toString(16) + ' không hỗ trợ');
        case 0x1: {
          const sz = 1 << lo;
          if (sz > 8) throw new PlistError('integer >64-bit không hỗ trợ');
          if (sz === 8) { const b = dv.getBigInt64(pos + 1); return (b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(b) : b.toString(); }
          return uint(pos + 1, sz);
        }
        case 0x2:
          if (lo === 2) return dv.getFloat32(pos + 1); if (lo === 3) return dv.getFloat64(pos + 1);
          throw new PlistError('real size không hỗ trợ');
        case 0x3: return new Date(978307200000 + dv.getFloat64(pos + 1) * 1000).toISOString();
        case 0x4: { const r = lenAt(pos, lo); if (r[1] + r[0] > tr) throw new PlistError('data ngoài phạm vi'); return bytes.slice(r[1], r[1] + r[0]); }
        case 0x5: { const r = lenAt(pos, lo); if (r[1] + r[0] > tr) throw new PlistError('string ngoài phạm vi'); return new TextDecoder('utf-8').decode(bytes.subarray(r[1], r[1] + r[0])); }
        case 0x6: { const r = lenAt(pos, lo); if (r[1] + r[0] * 2 > tr) throw new PlistError('string16 ngoài phạm vi'); return new TextDecoder('utf-16be').decode(bytes.subarray(r[1], r[1] + r[0] * 2)); }
        case 0x8: return { UID: uint(pos + 1, lo + 1) };
        case 0xA: case 0xC: {
          const r = lenAt(pos, lo); const arr = [];
          if (r[1] + r[0] * refSize > tr) throw new PlistError('array ngoài phạm vi');
          for (let j = 0; j < r[0]; j++) arr.push(read(uint(r[1] + j * refSize, refSize), depth + 1));
          return arr;
        }
        case 0xD: {
          const r = lenAt(pos, lo); const obj = {};
          if (r[1] + r[0] * refSize * 2 > tr) throw new PlistError('dict ngoài phạm vi');
          for (let j = 0; j < r[0]; j++) {
            const k = read(uint(r[1] + j * refSize, refSize), depth + 1);
            obj[String(k)] = read(uint(r[1] + (r[0] + j) * refSize, refSize), depth + 1);
          }
          return obj;
        }
        default: throw new PlistError('marker 0x' + marker.toString(16) + ' không hỗ trợ');
      }
    }
    return read(top, 0);
  }

  function isBinary(bytes) {
    return bytes.length >= 8 && bytes[0] === 0x62 && bytes[1] === 0x70 && bytes[2] === 0x6C && bytes[3] === 0x69 &&
           bytes[4] === 0x73 && bytes[5] === 0x74 && bytes[6] === 0x30 && bytes[7] === 0x30;
  }

  NS.PlistParser = {
    PlistError: PlistError,
    isBinary: isBinary,
    /** @param {Uint8Array} bytes  @returns {{format:'xml'|'binary', value:any}} */
    parse: function (bytes) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError('PlistParser.parse cần Uint8Array');
      if (isBinary(bytes)) return { format: 'binary', value: parseBinary(bytes) };
      return { format: 'xml', value: parseXml(bytes) };
    }
  };
})(typeof window !== 'undefined' ? window : self);
