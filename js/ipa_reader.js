/* ipa_reader.js – đọc IPA (ZIP) cục bộ bằng File.slice, KHÔNG nạp cả file vào RAM.
   An toàn: giới hạn số entry / dung lượng khai báo, chặn path traversal, không đọc entry mã hóa,
   không thực thi bất cứ thứ gì từ IPA. Chạy được trong Web Worker và trên luồng chính. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const LIMITS = {
    MAX_ENTRIES: 300000,
    MAX_CD_BYTES: 256 * 1024 * 1024,
    MAX_TOTAL_UNCOMPRESSED: 64 * 1024 * 1024 * 1024, // tổng dung lượng khai báo
    MAX_PLIST_BYTES: 16 * 1024 * 1024,
    SUSPICIOUS_RATIO: 1000,                          // tỉ lệ nén bất thường (chỉ cảnh báo)
    MACHO_FIRST_READ: 64 * 1024,
    MACHO_MAX_READ: 32 * 1024 * 1024
  };

  class IpaError extends Error {
    constructor(code, message) { super(message); this.name = 'IpaError'; this.code = code; }
  }

  const utf8 = new TextDecoder('utf-8');
  const noop = function () {};

  function num64(dv, pos) {
    const v = dv.getBigUint64(pos, true);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new IpaError('ZIP64_TOO_LARGE', 'Giá trị ZIP64 vượt giới hạn trình duyệt');
    return Number(v);
  }

  function unsafeReason(name) {
    if (name.indexOf('\0') >= 0) return 'chứa ký tự NUL';
    if (name.charAt(0) === '/' || /^[A-Za-z]:/.test(name)) return 'đường dẫn tuyệt đối';
    if (name.indexOf('\\') >= 0) return 'chứa dấu \\';
    if (name.split('/').indexOf('..') >= 0) return 'path traversal (..)';
    return null;
  }

  /* ---------- Đọc central directory ---------- */
  async function openZip(file) {
    if (!file || typeof file.slice !== 'function') throw new IpaError('BAD_INPUT', 'Đầu vào không phải File');
    const size = file.size;
    if (size < 22) throw new IpaError('NOT_ZIP', 'File quá nhỏ để là ZIP/IPA (' + size + ' byte)');

    const tailLen = Math.min(size, 22 + 65535 + 20);
    const tailStart = size - tailLen;
    const tail = new DataView(await file.slice(tailStart, size).arrayBuffer());
    let eocd = -1;
    for (let p = tail.byteLength - 22; p >= 0; p--) {
      if (tail.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
    }
    if (eocd < 0) throw new IpaError('NOT_ZIP', 'Không tìm thấy End-of-Central-Directory: đây không phải file ZIP/IPA hợp lệ (hoặc file bị cắt cụt)');

    let total = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOffset = tail.getUint32(eocd + 16, true);
    let zip64 = false;
    if (total === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF) {
      if (eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
        zip64 = true;
        const e64off = num64(tail, eocd - 20 + 8);
        const e64 = new DataView(await file.slice(e64off, e64off + 56).arrayBuffer());
        if (e64.byteLength < 56 || e64.getUint32(0, true) !== 0x06064b50) throw new IpaError('BAD_ZIP64', 'ZIP64 EOCD không hợp lệ');
        total = num64(e64, 32); cdSize = num64(e64, 40); cdOffset = num64(e64, 48);
      } else {
        throw new IpaError('BAD_ZIP64', 'ZIP64 được báo hiệu nhưng thiếu locator');
      }
    }
    if (total > LIMITS.MAX_ENTRIES) throw new IpaError('TOO_MANY_ENTRIES', 'Số entry (' + total + ') vượt giới hạn an toàn ' + LIMITS.MAX_ENTRIES);
    if (cdSize > LIMITS.MAX_CD_BYTES) throw new IpaError('CD_TOO_LARGE', 'Central directory quá lớn (' + cdSize + ' byte)');
    if (cdOffset + cdSize > size) throw new IpaError('BAD_ZIP', 'Central directory nằm ngoài file (file có thể bị cắt cụt)');

    const buf = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
    const dv = new DataView(buf);
    const entries = [];
    let p = 0;
    for (let i = 0; i < total; i++) {
      if (p + 46 > dv.byteLength || dv.getUint32(p, true) !== 0x02014b50) throw new IpaError('BAD_ZIP', 'Central directory hỏng tại entry #' + i);
      const versionMade = dv.getUint16(p + 4, true), flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      const crc = dv.getUint32(p + 16, true);
      let csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const extAttr = dv.getUint32(p + 38, true);
      let offset = dv.getUint32(p + 42, true);
      if (p + 46 + nameLen + extraLen + commentLen > dv.byteLength) throw new IpaError('BAD_ZIP', 'Entry #' + i + ' vượt quá central directory');
      const name = utf8.decode(new Uint8Array(buf, p + 46, nameLen));

      let q = p + 46 + nameLen; const qe = q + extraLen;
      while (q + 4 <= qe) {
        const id = dv.getUint16(q, true), sz = dv.getUint16(q + 2, true);
        if (id === 1) {
          let r = q + 4;
          if (usize === 0xFFFFFFFF) { usize = num64(dv, r); r += 8; }
          if (csize === 0xFFFFFFFF) { csize = num64(dv, r); r += 8; }
          if (offset === 0xFFFFFFFF) { offset = num64(dv, r); r += 8; }
        }
        q += 4 + sz;
      }
      const isLink = (versionMade >> 8) === 3 && ((extAttr >>> 16) & 0xF000) === 0xA000;
      entries.push({
        name: name, size: usize, csize: csize, method: method, flags: flags, crc: crc, offset: offset,
        dir: name.charAt(name.length - 1) === '/', encrypted: (flags & 1) !== 0, symlink: isLink,
        unsafe: unsafeReason(name)
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries: entries, zip64: zip64, fileSize: size };
  }

  /* ---------- Đọc nội dung 1 entry ---------- */
  /** @returns {Promise<{data:Uint8Array, truncated:boolean}>} */
  async function readEntry(file, entry, opt) {
    opt = opt || {};
    const max = opt.max != null ? opt.max : LIMITS.MAX_PLIST_BYTES;
    if (entry.unsafe) throw new IpaError('UNSAFE_PATH', 'Từ chối đọc đường dẫn không an toàn: ' + entry.unsafe);
    if (entry.encrypted) throw new IpaError('ENCRYPTED_ENTRY', 'Entry bị mã hóa ZIP, không đọc: ' + entry.name);
    const hdr = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
    if (hdr.byteLength < 30 || hdr.getUint32(0, true) !== 0x04034b50) throw new IpaError('BAD_LOCAL_HEADER', 'Local header hỏng: ' + entry.name);
    const start = entry.offset + 30 + hdr.getUint16(26, true) + hdr.getUint16(28, true);
    const blob = file.slice(start, start + entry.csize);

    if (entry.method === 0) {
      if (!opt.head && entry.csize > max) throw new IpaError('ENTRY_TOO_LARGE', 'Entry lớn hơn giới hạn đọc: ' + entry.name);
      const n = Math.min(entry.csize, max);
      return { data: new Uint8Array(await blob.slice(0, n).arrayBuffer()), truncated: entry.csize > n };
    }
    if (entry.method !== 8) throw new IpaError('UNSUPPORTED_METHOD', 'Phương thức nén ' + entry.method + ' chưa hỗ trợ: ' + entry.name);
    if (typeof DecompressionStream === 'undefined' || typeof blob.stream !== 'function')
      throw new IpaError('NO_DECOMPRESSION', 'Trình duyệt thiếu DecompressionStream (cần Safari 16.4+, Chrome 80+, Firefox 113+)');
    if (!opt.head && entry.size > max) throw new IpaError('ENTRY_TOO_LARGE', 'Entry lớn hơn giới hạn đọc: ' + entry.name);

    const reader = blob.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = []; let total = 0, truncated = false;
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        const value = r.value;
        if (opt.head) {
          const room = max - total;
          if (value.length >= room) { chunks.push(value.subarray(0, room)); total += room; truncated = true; await reader.cancel(); break; }
        } else if (total + value.length > Math.min(entry.size, max)) {
          await reader.cancel();
          throw new IpaError('SIZE_MISMATCH', 'Dữ liệu giải nén vượt kích thước khai báo (nghi ZIP bomb): ' + entry.name);
        }
        chunks.push(value); total += value.length;
      }
    } catch (e) {
      if (e instanceof IpaError) throw e;
      throw new IpaError('INFLATE_FAILED', 'Giải nén thất bại (' + entry.name + '): ' + (e && e.message ? e.message : e));
    }
    const out = new Uint8Array(total); let o = 0;
    chunks.forEach(function (c) { out.set(c, o); o += c.length; });
    return { data: out, truncated: truncated };
  }

  /* ---------- Đọc luồng 1 entry (không nạp cả file vào RAM) ---------- */
  /** Gọi onChunk(Uint8Array) lần lượt; ném lỗi nếu dữ liệu vượt/thiếu so với size khai báo. @returns {Promise<{bytes:number}>} */
  async function streamEntry(file, entry, onChunk, opt) {
    opt = opt || {};
    if (entry.unsafe) throw new IpaError('UNSAFE_PATH', 'Từ chối đọc đường dẫn không an toàn: ' + entry.unsafe);
    if (entry.encrypted) throw new IpaError('ENCRYPTED_ENTRY', 'Entry bị mã hóa ZIP, không đọc: ' + entry.name);
    if (entry.method !== 0 && entry.method !== 8) throw new IpaError('UNSUPPORTED_METHOD', 'Phương thức nén ' + entry.method + ' chưa hỗ trợ: ' + entry.name);
    const cancelled = opt.isCancelled || function () { return false; };
    const hdr = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
    if (hdr.byteLength < 30 || hdr.getUint32(0, true) !== 0x04034b50) throw new IpaError('BAD_LOCAL_HEADER', 'Local header hỏng: ' + entry.name);
    const start = entry.offset + 30 + hdr.getUint16(26, true) + hdr.getUint16(28, true);
    let total = 0;
    if (entry.method === 0) {
      const STEP = 4 * 1024 * 1024;
      for (let o = 0; o < entry.csize; o += STEP) {
        if (cancelled()) throw new IpaError('CANCELLED', 'Đã hủy');
        const part = new Uint8Array(await file.slice(start + o, start + Math.min(o + STEP, entry.csize)).arrayBuffer());
        total += part.length; onChunk(part);
      }
    } else {
      if (typeof DecompressionStream === 'undefined') throw new IpaError('NO_DECOMPRESSION', 'Trình duyệt thiếu DecompressionStream');
      const reader = file.slice(start, start + entry.csize).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      try {
        for (;;) {
          if (cancelled()) { await reader.cancel(); throw new IpaError('CANCELLED', 'Đã hủy'); }
          const r = await reader.read();
          if (r.done) break;
          total += r.value.length;
          if (total > entry.size) { await reader.cancel(); throw new IpaError('SIZE_MISMATCH', 'Dữ liệu giải nén vượt kích thước khai báo: ' + entry.name); }
          onChunk(r.value);
        }
      } catch (e) {
        if (e instanceof IpaError) throw e;
        throw new IpaError('INFLATE_FAILED', 'Giải nén thất bại (' + entry.name + '): ' + (e && e.message ? e.message : e));
      }
    }
    if (total !== entry.size) throw new IpaError('SIZE_MISMATCH', 'Kích thước thực ' + total + ' ≠ khai báo ' + entry.size + ': ' + entry.name);
    return { bytes: total };
  }

  /* ---------- Phân tích ---------- */
  function deviceFamilyNames(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (n) { return n === 1 ? 'iPhone/iPod' : n === 2 ? 'iPad' : n === 3 ? 'Apple TV' : n === 4 ? 'Apple Watch' : String(n); });
  }

  function extractApp(plist) {
    const s = function (k) { return typeof plist[k] === 'string' ? plist[k] : null; };
    return {
      bundleId: s('CFBundleIdentifier'), name: s('CFBundleName'), displayName: s('CFBundleDisplayName'),
      version: s('CFBundleShortVersionString'), build: s('CFBundleVersion'), minOS: s('MinimumOSVersion'),
      executable: s('CFBundleExecutable'), category: s('LSApplicationCategoryType'),
      deviceFamily: Array.isArray(plist.UIDeviceFamily) ? plist.UIDeviceFamily.slice() : [],
      deviceFamilyNames: deviceFamilyNames(plist.UIDeviceFamily),
      requiredCapabilities: Array.isArray(plist.UIRequiredDeviceCapabilities) ? plist.UIRequiredDeviceCapabilities.map(String)
        : (plist.UIRequiredDeviceCapabilities && typeof plist.UIRequiredDeviceCapabilities === 'object' ? Object.keys(plist.UIRequiredDeviceCapabilities) : []),
      appFonts: Array.isArray(plist.UIAppFonts) ? plist.UIAppFonts.map(String) : []
    };
  }

  async function inspectExecutable(file, entry) {
    const BR = NS.BinaryReader;
    let res = await readEntry(file, entry, { max: Math.min(LIMITS.MACHO_FIRST_READ, Math.max(entry.size, 1)), head: true });
    let info = BR.parseMachO(res.data, entry.size);
    if (info.needBytes > res.data.length && res.data.length < entry.size) {
      const want = Math.min(info.needBytes, LIMITS.MACHO_MAX_READ, entry.size);
      res = await readEntry(file, entry, { max: want, head: true });
      info = BR.parseMachO(res.data, entry.size);
    }
    return info;
  }

  /**
   * @param {File} file
   * @param {{bundle?:string}} opts  bundle = tên thư mục .app muốn phân tích
   * @param {{step?:Function, progress?:Function, log?:Function, isCancelled?:Function}} hooks
   */
  async function analyze(file, opts, hooks) {
    opts = opts || {}; hooks = hooks || {};
    const step = hooks.step || noop, progress = hooks.progress || noop, log = hooks.log || noop;
    const cancelled = hooks.isCancelled || function () { return false; };
    const check = function () { if (cancelled()) throw new IpaError('CANCELLED', 'Đã hủy'); };
    const warnings = [], errors = [];
    const warn = function (m, d) { warnings.push(m); log('WARNING', m, d); };

    /* --- Bước 1: đọc ZIP --- */
    step('read', 'running', 'Đọc central directory');
    progress(0.02);
    let zip;
    try { zip = await openZip(file); }
    catch (e) { step('read', 'error', e.message); throw e; }
    check();
    const entries = zip.entries;
    log('INFO', 'Đọc xong central directory', { entries: entries.length, zip64: zip.zip64 });
    progress(0.3);

    let totalU = 0, totalC = 0, fileCount = 0, unsafeCount = 0, encCount = 0, unsupportedCount = 0, suspicious = 0, links = 0;
    const seen = new Set(); let dupes = 0;
    entries.forEach(function (e) {
      totalU += e.size; totalC += e.csize;
      if (!e.dir) fileCount++;
      if (e.unsafe) unsafeCount++;
      if (e.encrypted) encCount++;
      if (e.symlink) links++;
      if (!e.dir && e.method !== 0 && e.method !== 8) unsupportedCount++;
      if (e.size > 1048576 && e.csize > 0 && e.size / e.csize > LIMITS.SUSPICIOUS_RATIO) suspicious++;
      if (seen.has(e.name)) dupes++; else seen.add(e.name);
    });
    if (totalU > LIMITS.MAX_TOTAL_UNCOMPRESSED) {
      const err = new IpaError('ZIP_BOMB', 'Tổng dung lượng giải nén khai báo (' + totalU + ' byte) vượt giới hạn an toàn');
      step('read', 'error', err.message); throw err;
    }
    if (unsafeCount) warn(unsafeCount + ' entry có đường dẫn không an toàn đã bị loại khỏi phân tích (path traversal)');
    if (encCount) warn(encCount + ' entry bị mã hóa ZIP: không đọc');
    if (unsupportedCount) warn(unsupportedCount + ' entry dùng phương thức nén chưa hỗ trợ');
    if (suspicious) warn(suspicious + ' entry có tỉ lệ nén bất thường (>' + LIMITS.SUSPICIOUS_RATIO + ':1)');
    if (dupes) warn(dupes + ' tên entry bị trùng trong ZIP; dùng bản đầu tiên');
    if (links) warn(links + ' symlink được ghi nhận, không theo liên kết');

    // Tìm Payload/*.app
    const bundleSet = new Set(); const re = /^Payload\/([^/]+\.app)\//;
    entries.forEach(function (e) { if (e.unsafe) return; const m = re.exec(e.name); if (m) bundleSet.add(m[1]); });
    const bundles = Array.from(bundleSet).sort();
    if (!bundles.length) {
      const err = new IpaError('NO_PAYLOAD', 'Không tìm thấy Payload/*.app: đây không phải IPA hợp lệ');
      step('read', 'error', err.message); throw err;
    }
    let selected = bundles[0];
    if (opts.bundle) {
      if (bundles.indexOf(opts.bundle) >= 0) selected = opts.bundle;
      else warn('Bundle yêu cầu "' + opts.bundle + '" không tồn tại; dùng ' + selected);
    }
    if (bundles.length > 1) warn('IPA chứa ' + bundles.length + ' bundle .app (' + bundles.join(', ') + '); đang phân tích: ' + selected);
    const appRoot = 'Payload/' + selected + '/';
    step('read', 'done', fileCount + ' file');
    check();

    /* --- Bước 2: Info.plist --- */
    step('plist', 'running', 'Đọc Info.plist');
    const plistEntry = entries.find(function (e) { return e.name === appRoot + 'Info.plist' && !e.unsafe; });
    if (!plistEntry) {
      const err = new IpaError('NO_INFO_PLIST', 'Không tìm thấy ' + appRoot + 'Info.plist');
      step('plist', 'error', err.message); throw err;
    }
    let plist, plistFormat;
    try {
      const raw = await readEntry(file, plistEntry, { max: LIMITS.MAX_PLIST_BYTES });
      const parsed = NS.PlistParser.parse(raw.data);
      plist = parsed.value; plistFormat = parsed.format;
      if (!plist || typeof plist !== 'object' || Array.isArray(plist)) throw new IpaError('BAD_PLIST', 'Info.plist không phải dictionary');
    } catch (e) {
      const err = e instanceof IpaError ? e : new IpaError(e.code || 'BAD_PLIST', 'Không đọc được Info.plist: ' + e.message);
      step('plist', 'error', err.message); throw err;
    }
    check();
    const app = extractApp(plist);
    if (!app.bundleId) warn('Info.plist thiếu CFBundleIdentifier');
    if (!app.executable) warn('Info.plist thiếu CFBundleExecutable: không đọc được kiến trúc');
    log('SUCCESS', 'Đọc Info.plist (' + plistFormat + ')', { bundleId: app.bundleId, version: app.version });
    progress(0.7);

    // Mach-O
    let macho = null; const architectures = [];
    if (app.executable) {
      const exeEntry = entries.find(function (e) { return e.name === appRoot + app.executable && !e.unsafe && !e.dir; });
      if (!exeEntry) warn('Không tìm thấy file thực thi ' + app.executable);
      else {
        try {
          const info = await inspectExecutable(file, exeEntry);
          if (info.error) warn('Mach-O: ' + info.error);
          else {
            const encAll = info.archs.length && info.archs.every(function (a) { return a.encrypted === true; });
            const encAny = info.archs.some(function (a) { return a.encrypted === true; });
            macho = { path: exeEntry.name, size: exeEntry.size, format: info.format, archs: info.archs,
                      encrypted: encAny ? true : (info.archs.every(function (a) { return a.encrypted === false; }) ? false : null) };
            info.archs.forEach(function (a) { if (architectures.indexOf(a.name) < 0) architectures.push(a.name); });
            if (encAny) warn('Binary chính có cryptid≠0 (mã hóa FairPlay). Nội dung binary không đọc được; công cụ này không giải mã và không vượt DRM. Cần IPA đã được giải mã hợp pháp bởi chính chủ.');
            if (encAll) log('WARNING', 'Tất cả kiến trúc đều mã hóa');
          }
        } catch (e) { warn('Không đọc được Mach-O: ' + e.message); }
      }
    }
    check();

    // Cấu trúc bundle
    const childrenOf = function (prefix) {
      const m = new Map();
      entries.forEach(function (e) {
        if (e.unsafe || e.name.indexOf(prefix) !== 0 || e.name === prefix) return;
        const rest = e.name.slice(prefix.length); const i = rest.indexOf('/');
        const child = i < 0 ? rest : rest.slice(0, i);
        if (!child) return;
        const c = m.get(child) || { name: child, isDir: i >= 0, files: 0, bytes: 0 };
        if (i >= 0) c.isDir = true;
        if (!e.dir) { c.files++; c.bytes += e.size; }
        m.set(child, c);
      });
      return Array.from(m.values()).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    };
    const topLevel = childrenOf(appRoot);
    const frameworks = childrenOf(appRoot + 'Frameworks/').map(function (c) { return c.name; });
    const plugins = childrenOf(appRoot + 'PlugIns/').map(function (c) { return c.name; });
    const lprojs = topLevel.filter(function (c) { return /\.lproj$/.test(c.name); }).map(function (c) { return c.name; });
    const dataDir = topLevel.find(function (c) { return c.name === 'Data' && c.isDir; }) || null;
    const scInfo = topLevel.some(function (c) { return c.name === 'SC_Info'; });
    if (scInfo && !(macho && macho.encrypted === false)) log('INFO', 'Có thư mục SC_Info (dấu hiệu IPA tải từ App Store)');

    step('plist', 'done', plistFormat === 'binary' ? 'plist nhị phân' : 'plist XML');
    progress(0.85);

    const result = {
      fileName: file.name, ipaSize: file.size,
      zip: { entryCount: entries.length, fileCount: fileCount, totalCompressed: totalC, totalUncompressed: totalU,
             zip64: zip.zip64, unsafeEntries: unsafeCount, encryptedEntries: encCount, unsupportedMethodEntries: unsupportedCount },
      bundles: bundles, selectedBundle: selected, appRoot: appRoot,
      app: app, infoPlistFormat: plistFormat, infoPlist: plist,
      architectures: architectures, macho: macho,
      topLevel: topLevel, frameworks: frameworks, plugins: plugins, lprojs: lprojs,
      dataDir: dataDir ? { files: dataDir.files, bytes: dataDir.bytes } : null,
      hasScInfo: scInfo,
      entries: entries.map(function (e) { return { path: e.name, size: e.size, csize: e.csize, method: e.method, dir: e.dir, unsafe: e.unsafe, encrypted: e.encrypted }; }),
      warnings: warnings, errors: errors,
      engine: null, engineProbes: [], manifest: null, unity: null
    };

    /* --- Bước 3: nhận diện engine (Phase 2). Lỗi ở đây không làm hỏng kết quả Phase 1. --- */
    step('engine', 'running', 'Nhận diện engine');
    try {
      if (!NS.DetectEngine) throw new IpaError('NO_DETECT_MODULE', 'Thiếu module detect_engine.js');
      const probes = await NS.DetectEngine.runProbes(file, result, entries, { isCancelled: cancelled });
      check();
      const eng = NS.DetectEngine.detect(result, probes);
      result.engineProbes = probes; result.engine = eng;
      const label = eng.engine + (eng.variant ? ' ' + eng.variant : '');
      log(eng.status === 'unknown' ? 'WARNING' : 'SUCCESS', 'Engine: ' + label + ' – ' + eng.status + ' (' + Math.round(eng.confidence * 100) + '%)',
          { evidence: eng.evidence.length, branch: eng.analysis_branch, version: eng.version });
      step('engine', 'done', label + ' · ' + eng.status);
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Nhận diện engine thất bại: ' + ((e && e.message) || e));
      step('engine', 'error', (e && e.message) || 'Lỗi');
    }
    progress(0.9);

    /* --- Bước 4: quét toàn bộ file (Phase 3). Lỗi ở đây chỉ thành cảnh báo, không làm mất kết quả Phase 1–2. --- */
    step('scan', 'running', 'Quét file');
    try {
      if (!NS.FileScanner) throw new IpaError('NO_SCAN_MODULE', 'Thiếu module file_scanner.js');
      const mf = await NS.FileScanner.scan(file, result, entries, { hashMode: opts.hashMode || 'auto' }, { step: step, log: log, isCancelled: cancelled });
      result.manifest = mf;
      const sm = mf.summary;
      log('SUCCESS', 'Quét file xong: ' + sm.totalFiles + ' file, ' + sm.hashed + ' file đã băm (chế độ ' + mf.options.hashMode + ')',
          { errors: sm.errors, archives: sm.archives, priority: sm.priorityFiles, mismatches: sm.mismatches });
      step('scan', 'done', sm.totalFiles + ' file · ' + (mf.options.hashMode === 'standard' ? 'đã băm SHA' : 'chưa băm (nhanh)'));
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Quét file thất bại: ' + ((e && e.message) || e));
      step('scan', 'error', (e && e.message) || 'Lỗi');
    }
    progress(0.97);

    /* --- Bước 5: tìm thành phần Unity/IL2CPP (Phase 4, sub-phase 4.1). Thuần dữ liệu (không I/O). Lỗi chỉ thành cảnh báo. --- */
    step('unity', 'running', 'Tìm thành phần Unity');
    try {
      if (!NS.UnityDump) throw new IpaError('NO_UNITY_MODULE', 'Thiếu module unity_dump.js');
      const u = NS.UnityDump.discover(result);
      result.unity = u;
      if (u.status === 'discovered') {
        log('SUCCESS', 'Unity: tìm thấy ' + u.components_found + '/' + u.components_total + ' nhóm thành phần; runtime ' + u.runtime.value + '; metadata đầu vào: ' + u.metadata_input.status,
            { metadataPath: u.metadata_input.path, candidates: u.metadata_input.candidates.length });
        u.warnings.forEach(function (w) { log('WARNING', 'Unity: ' + w); });
        step('unity', 'done', u.runtime.value + ' · metadata ' + u.metadata_input.status);
      } else {
        log('INFO', 'Unity: ' + (u.status === 'insufficient_evidence' ? 'chỉ có dấu hiệu yếu, chưa kết luận là Unity' : 'không có thành phần Unity') + ' – bỏ qua nhánh Unity');
        step('unity', 'skipped', u.status === 'insufficient_evidence' ? 'Chưa đủ bằng chứng Unity' : 'Không phải Unity');
      }
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Tìm thành phần Unity thất bại: ' + ((e && e.message) || e));
      step('unity', 'error', (e && e.message) || 'Lỗi');
    }
    progress(0.99);

    /* --- Bước 6: kiểm tra HEADER + phiên bản global-metadata.dat (Phase 4, sub-phase 4.2). Chỉ đọc ≤ READ_LIMIT byte đầu. Lỗi chỉ thành cảnh báo. --- */
    step('metadata', 'running', 'Kiểm tra header metadata');
    try {
      if (!NS.MetadataDump) throw new IpaError('NO_METADATA_MODULE', 'Thiếu module metadata_dump.js');
      if (!result.unity || result.unity.status !== 'discovered') {
        step('metadata', 'skipped', 'Không có Unity để kiểm tra');
      } else if (result.unity.metadata_input.status !== 'selected') {
        result.unity.metadata_header = NS.MetadataDump.notChecked('Không đọc metadata vì bước 4.1 chưa chọn được file (trạng thái: ' + result.unity.metadata_input.status + '). ' + result.unity.metadata_input.reason);
        log('INFO', 'Metadata: không kiểm tra header – ' + result.unity.metadata_input.status);
        step('metadata', 'skipped', 'Chưa có file metadata (' + result.unity.metadata_input.status + ')');
      } else {
        const h = await NS.MetadataDump.check(file, result.unity, entries, { isCancelled: cancelled });
        result.unity.metadata_header = h;
        const lvl = h.status === 'generic_ok' ? 'SUCCESS' : (h.status === 'read_error' || h.status === 'invalid_header' || h.status === 'bad_magic') ? 'ERROR' : 'WARNING';
        log(lvl, 'Metadata header: ' + h.status + (h.version ? ' · version ' + h.version.value : '') + ' – ' + h.reason, { path: h.path, bytes_read: h.bytes_read, findings: h.findings.length });
        step('metadata', h.status === 'read_error' ? 'error' : 'done', h.status + (h.version ? ' · v' + h.version.value : ''));
      }
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Kiểm tra header metadata thất bại: ' + ((e && e.message) || e));
      step('metadata', 'error', (e && e.message) || 'Lỗi');
    }
    progress(0.995);

    /* --- Bước 7: trích xuất string literal (Phase 4, sub-phase 4.3). Chỉ khi header đạt kiểm tra chung và version đã đối chiếu. Lỗi chỉ thành cảnh báo. --- */
    step('literals', 'running', 'Trích xuất string literal');
    try {
      const mh = result.unity && result.unity.metadata_header;
      if (!mh || mh.status !== 'generic_ok') {
        step('literals', 'skipped', 'Header metadata chưa đạt kiểm tra');
      } else {
        const lit = await NS.MetadataDump.extractLiterals(file, result.unity, entries, { isCancelled: cancelled });
        result.unity.metadata_literals = lit;
        log(lit.status === 'ok' ? 'SUCCESS' : 'WARNING', 'String literal: ' + lit.status + ' – ' + lit.reason, { count: lit.count, invalid_utf8: lit.invalid_utf8, out_of_range: lit.out_of_range });
        step('literals', lit.status === 'ok' ? 'done' : (lit.status === 'unsupported_version' ? 'skipped' : 'error'), lit.status === 'ok' ? lit.count + ' literal' : lit.status);
      }
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Trích xuất string literal thất bại: ' + ((e && e.message) || e));
      step('literals', 'error', (e && e.message) || 'Lỗi');
    }
    progress(0.998);

    /* --- Bước 8: assembly/image/type/method/field (Phase 4, sub-phase 4.3 phần còn lại). Chỉ khi header đạt kiểm tra chung và version có bố cục xác minh. Lỗi chỉ thành cảnh báo. --- */
    step('tables', 'running', 'Trích xuất assembly/class/method/field');
    try {
      const mh2 = result.unity && result.unity.metadata_header;
      if (!mh2 || mh2.status !== 'generic_ok') {
        step('tables', 'skipped', 'Header metadata chưa đạt kiểm tra');
      } else if (!NS.MetadataTables) {
        throw new IpaError('NO_TABLES_MODULE', 'Thiếu module metadata_tables.js');
      } else {
        const tb = await NS.MetadataTables.extractTables(file, result.unity, entries, { isCancelled: cancelled });
        result.unity.metadata_tables = tb;
        const c = tb.counts || {};
        log(tb.status === 'ok' ? 'SUCCESS' : 'WARNING', 'Bảng metadata: ' + tb.status + ' – ' + tb.reason, c);
        step('tables', tb.status === 'ok' ? 'done' : (tb.status === 'unsupported_version' ? 'skipped' : 'error'), tb.status === 'ok' ? c.types + ' type, ' + c.methods + ' method, ' + c.fields + ' field' : tb.status);
      }
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Trích xuất bảng metadata thất bại: ' + ((e && e.message) || e));
      step('tables', 'error', (e && e.message) || 'Lỗi');
    }
    progress(0.999);

    /* --- Bước 9: font (Phase 5, sub-phase 5.1): phát hiện + trích xuất NGUYÊN BẢN. Lỗi chỉ thành cảnh báo. --- */
    step('fonts', 'running', 'Phát hiện và trích xuất font');
    try {
      if (!NS.FontDump) throw new IpaError('NO_FONT_MODULE', 'Thiếu module font_dump.js');
      const fr = await NS.FontDump.discover(file, result, entries, { isCancelled: cancelled });
      result.fonts = fr.fonts; result.font_files = fr.files;
      const fs = fr.fonts.summary || {};
      log(fr.fonts.status === 'ok' || fr.fonts.status === 'no_fonts' ? 'SUCCESS' : 'WARNING', 'Font: ' + fr.fonts.status + ' – ' + fr.fonts.reason, fs);
      fr.fonts.warnings.forEach(function (w) { warn(w); });
      step('fonts', fr.fonts.status === 'error' ? 'error' : 'done', fr.fonts.status === 'no_fonts' ? 'Không có font' : (fs.fonts_valid || 0) + ' font hợp lệ / ' + (fs.candidates || 0) + ' ứng viên');
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Phát hiện font thất bại: ' + ((e && e.message) || e));
      step('fonts', 'error', (e && e.message) || 'Lỗi');
    }
    progress(0.9995);

    /* --- Bước 10: AssetBundle UnityFS (Phase 5, sub-phase 5.2a): chỉ đọc container (header, block, node). KHÔNG giải nén/parse nội dung node. Lỗi chỉ thành cảnh báo. --- */
    step('unityfs', 'running', 'Đọc container AssetBundle (UnityFS)');
    try {
      if (!NS.UnityFS) throw new IpaError('NO_UNITYFS_MODULE', 'Thiếu module unity_fs.js');
      const ur = await NS.UnityFS.scan(file, result, entries, { isCancelled: cancelled });
      result.unityfs = ur; const us = ur.summary || {};
      if (ur.status === 'no_bundles') { log('INFO', 'UnityFS: ' + ur.reason); step('unityfs', 'skipped', 'Không có AssetBundle'); }
      else {
        log(ur.status === 'ok' ? 'SUCCESS' : 'WARNING', 'UnityFS: ' + ur.status + ' – ' + ur.reason, us);
        ur.warnings.forEach(function (w) { warn(w); });
        step('unityfs', ur.status === 'error' ? 'error' : 'done', (us.parsed || 0) + '/' + (us.bundles || 0) + ' bundle, ' + (us.nodes || 0) + ' node');
      }
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Đọc UnityFS thất bại: ' + ((e && e.message) || e));
      step('unityfs', 'error', (e && e.message) || 'Lỗi');
    }
    progress(0.9998);

    /* --- Bước 11: SerializedFile (Phase 5, sub-phase 5.2c): thống kê object, trích TextAsset/font nhúng, quy MonoBehaviour → class. Lỗi chỉ thành cảnh báo. --- */
    step('serialized', 'running', 'Đọc SerializedFile (assets/level/bundle node)');
    try {
      if (!NS.SerializedFile) throw new IpaError('NO_SERIALIZED_MODULE', 'Thiếu module serialized_file.js');
      const sr = await NS.SerializedFile.scan(file, result, entries, { isCancelled: cancelled });
      result.serialized = sr.serialized; result.serialized_files = sr.files; const ss = sr.serialized.summary || {};
      if (sr.serialized.status === 'no_serialized') { log('INFO', 'SerializedFile: không có file nào'); step('serialized', 'skipped', 'Không có SerializedFile'); }
      else {
        log(sr.serialized.status === 'ok' ? 'SUCCESS' : 'WARNING', 'SerializedFile: ' + sr.serialized.status + ' – ' + sr.serialized.reason, ss);
        sr.serialized.warnings.forEach(function (w) { warn(w); });
        step('serialized', sr.serialized.status === 'error' ? 'error' : 'done', (ss.parsed || 0) + '/' + (ss.files || 0) + ' file, ' + (ss.text_assets_extracted || 0) + ' TextAsset, ' + (ss.fonts_extracted || 0) + ' font');
      }
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Đọc SerializedFile thất bại: ' + ((e && e.message) || e));
      step('serialized', 'error', (e && e.message) || 'Lỗi');
    }
    progress(0.9999);

    /* --- Bước 12: metadata font + độ phủ tiếng Việt (Phase 5, sub-phase 5.2b+5.3): dùng byte font ĐÃ trích (font_files + serialized_files). Lỗi chỉ thành cảnh báo. --- */
    step('fontmetrics', 'running', 'Đọc metadata font và độ phủ tiếng Việt');
    try {
      if (!NS.FontMetrics) throw new IpaError('NO_FONTMETRICS_MODULE', 'Thiếu module font_metrics.js');
      const fm = await NS.FontMetrics.scan(result, { isCancelled: cancelled });
      result.font_metrics = fm; const ms = fm.summary || {};
      if (fm.status === 'no_fonts') { log('INFO', 'FontMetrics: ' + fm.reason); step('fontmetrics', 'skipped', 'Không có font đã trích'); }
      else {
        log(fm.status === 'ok' ? 'SUCCESS' : 'WARNING', 'FontMetrics: ' + fm.status + ' – ' + fm.reason, ms);
        fm.warnings.forEach(function (w) { warn(w); });
        step('fontmetrics', fm.status === 'error' ? 'error' : 'done', (ms.vietnamese_full || 0) + ' đủ / ' + (ms.vietnamese_partial || 0) + ' thiếu / ' + (ms.vietnamese_none || 0) + ' không có tiếng Việt');
      }
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      warn('Đọc metadata font thất bại: ' + ((e && e.message) || e));
      step('fontmetrics', 'error', (e && e.message) || 'Lỗi');
    }
    progress(1);
    return result;
  }

  NS.IpaReader = { LIMITS: LIMITS, IpaError: IpaError, openZip: openZip, readEntry: readEntry, streamEntry: streamEntry, analyze: analyze };
})(typeof window !== 'undefined' ? window : self);
