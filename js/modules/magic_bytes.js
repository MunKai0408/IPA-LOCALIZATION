/* magic_bytes.js – phân loại file bằng magic bytes + nội dung đầu file; đuôi file chỉ là gợi ý phụ.
   identify(head, name) -> { type, format, source:'magic'|'content'|'extension'|'none', magic:hex, extMismatch:boolean, note }
   type ∈ Text, Font, Image, Audio, Video, Archive, Binary, Executable, Database, Unity asset, Unreal asset, Localization, Unknown */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const PRIORITY_EXT = new Set(['ttf','otf','ttc','woff','woff2','fnt','bmfont','atlas','csv','tsv','json','xml','po','mo','strings','stringsdict','arb','properties','txt','lua','yaml','yml','plist','bytes','asset','assets','bundle','ress','resource','pak','utoc','ucas','pck']);
  const LOC_EXT = new Set(['strings', 'stringsdict', 'po', 'mo', 'arb', 'properties', 'xliff', 'xlf']);
  const EXPECT = { png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', webp: 'Image', ttf: 'Font', otf: 'Font', ttc: 'Font', woff: 'Font', woff2: 'Font',
                   ogg: 'Audio', mp3: 'Audio', wav: 'Audio', mp4: 'Video', mov: 'Video', zip: 'Archive' };
  const TEXT_FMT = { json: 'JSON', xml: 'XML', csv: 'CSV', tsv: 'TSV', po: 'gettext PO', properties: 'Java properties', lua: 'Lua', yaml: 'YAML', yml: 'YAML',
                     txt: 'Plain text', strings: 'Apple .strings', stringsdict: 'Apple .stringsdict', plist: 'XML plist', arb: 'ARB (JSON)', fnt: 'BMFont', atlas: 'Atlas', ini: 'INI', md: 'Markdown', html: 'HTML', js: 'JavaScript', css: 'CSS' };
  const EXT_ONLY = { // dùng khi không có magic và nội dung không phải text
    assets: ['Unity asset', 'Unity serialized file (theo đuôi)'], ress: ['Unity asset', 'Unity .resS (theo đuôi)'], resource: ['Unity asset', 'Unity .resource (theo đuôi)'],
    unity3d: ['Unity asset', 'Unity bundle (theo đuôi)'], bundle: ['Unity asset', 'AssetBundle? (theo đuôi, chưa xác minh)'], bytes: ['Binary', 'Unity TextAsset .bytes (theo đuôi)'],
    pak: ['Unreal asset', 'Unreal PAK (theo đuôi; magic ở footer chưa kiểm tra)'], ucas: ['Unreal asset', 'Unreal IoStore UCAS (theo đuôi)'],
    utoc: ['Unreal asset', 'Unreal IoStore UTOC (theo đuôi)'], uasset: ['Unreal asset', 'Unreal uasset (theo đuôi)'], umap: ['Unreal asset', 'Unreal umap (theo đuôi)'],
    pck: ['Archive', 'Godot PCK (theo đuôi)'], asset: ['Unity asset', 'Unity .asset (theo đuôi)']
  };

  function eq(b, off, arr) { if (b.length < off + arr.length) return false; for (let i = 0; i < arr.length; i++) if (b[off + i] !== arr[i]) return false; return true; }
  function asc(s) { const a = []; for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i)); return a; }
  const A = asc;

  // [offset, bytes, type, format]
  const SIGS = [
    [0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 'Image', 'PNG'],
    [0, [0xFF, 0xD8, 0xFF], 'Image', 'JPEG'],
    [0, A('GIF8'), 'Image', 'GIF'],
    [0, A('DDS '), 'Image', 'DDS'],
    [0, [0x50, 0x56, 0x52, 0x03], 'Image', 'PVR v3'],
    [0, [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x31, 0x31], 'Image', 'KTX'],
    [0, [0x13, 0xAB, 0xA1, 0x5C], 'Image', 'ASTC'],
    [0, A('OggS'), 'Audio', 'OGG'],
    [0, A('ID3'), 'Audio', 'MP3 (ID3)'],
    [0, A('caff'), 'Audio', 'CAF'],
    [0, A('fLaC'), 'Audio', 'FLAC'],
    [0, [0x50, 0x4B, 0x03, 0x04], 'Archive', 'ZIP'],
    [0, [0x50, 0x4B, 0x05, 0x06], 'Archive', 'ZIP (rỗng)'],
    [0, [0x1F, 0x8B, 0x08], 'Archive', 'gzip'],
    [0, [0x04, 0x22, 0x4D, 0x18], 'Archive', 'LZ4 frame'],
    [0, [0x28, 0xB5, 0x2F, 0xFD], 'Archive', 'Zstandard'],
    [0, A('UnityFS\0'), 'Unity asset', 'UnityFS'],
    [0, A('UnityWeb'), 'Unity asset', 'UnityWeb'],
    [0, A('UnityRaw'), 'Unity asset', 'UnityRaw'],
    [0, A('GDPC'), 'Archive', 'Godot PCK'],
    [0, A('-==--==--==--==-'), 'Unreal asset', 'Unreal IoStore UTOC'],
    [0, [0xC1, 0x83, 0x2A, 0x9E], 'Unreal asset', 'Unreal package (uasset/umap)'],
    [0, [0xFE, 0xED, 0xFA, 0xCE], 'Executable', 'Mach-O 32-bit'],
    [0, [0xFE, 0xED, 0xFA, 0xCF], 'Executable', 'Mach-O 64-bit'],
    [0, [0xCE, 0xFA, 0xED, 0xFE], 'Executable', 'Mach-O 32-bit (LE)'],
    [0, [0xCF, 0xFA, 0xED, 0xFE], 'Executable', 'Mach-O 64-bit (LE)'],
    [0, A('!<arch>\n'), 'Executable', 'ar (thư viện tĩnh .a)'],
    [0, [0x7F, 0x45, 0x4C, 0x46], 'Executable', 'ELF'],
    [0, A('SQLite format 3\0'), 'Database', 'SQLite'],
    [0, [0x00, 0x01, 0x00, 0x00], 'Font', 'TTF'],
    [0, A('true'), 'Font', 'TTF (Apple)'],
    [0, A('OTTO'), 'Font', 'OTF'],
    [0, A('ttcf'), 'Font', 'TTC'],
    [0, A('wOFF'), 'Font', 'WOFF'],
    [0, A('wOF2'), 'Font', 'WOFF2'],
    [0, A('bplist00'), 'Binary', 'Binary plist'],
    [0, A('BOMStore'), 'Binary', 'Apple asset catalog (Assets.car)'],
    [0, [0xC6, 0x1F, 0xBC, 0x03, 0xC1, 0x03, 0x19, 0x1F], 'Binary', 'Hermes bytecode'],
    [0, [0x95, 0x04, 0x12, 0xDE], 'Localization', 'gettext MO'],
    [0, [0xDE, 0x12, 0x04, 0x95], 'Localization', 'gettext MO (LE)']
  ];

  function hexOf(b, n) { let s = ''; const m = Math.min(n, b.length); for (let i = 0; i < m; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16) + (i < m - 1 ? ' ' : ''); return s.toUpperCase(); }
  function extOf(name) { const i = name.lastIndexOf('.'); return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : ''; }

  function looksText(b) {
    if (!b.length) return false;
    let start = 0;
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) start = 3;
    else if (b.length >= 2 && ((b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF))) return true; // BOM UTF-16
    let bad = 0; const n = Math.min(b.length, 4096);
    for (let i = start; i < n; i++) {
      const c = b[i];
      if (c === 0) return false;
      if (c < 9 || (c > 13 && c < 32) || c === 127) bad++;
    }
    return bad / Math.max(1, n - start) < 0.02;
  }

  function textFormat(b, ext) {
    let s = ''; const n = Math.min(b.length, 512);
    for (let i = 0; i < n; i++) s += String.fromCharCode(b[i]);
    s = s.replace(/^\u00EF\u00BB\u00BF/, '').replace(/^[\s]+/, '');
    if (/^<\?xml/i.test(s) || /^<!DOCTYPE plist/i.test(s) || /^<plist/i.test(s)) return /<plist|DOCTYPE plist/i.test(s) ? 'XML plist' : 'XML';
    if (/^<(!doctype html|html)/i.test(s)) return 'HTML';
    if ((s[0] === '{' || s[0] === '[') && /"/.test(s)) return 'JSON (suy đoán từ đầu file)';
    if (s[0] === '<') return 'XML (suy đoán)';
    if (TEXT_FMT[ext]) return TEXT_FMT[ext];
    return 'Plain text';
  }

  function identify(head, name, relPath) {
    const b = head || new Uint8Array(0);
    const ext = extOf(name || '');
    const out = { type: 'Unknown', format: 'Không đọc được dữ liệu', source: 'none', magic: hexOf(b, 8), extMismatch: false, note: '', priority: PRIORITY_EXT.has(ext) };
    if (!b.length) { out.format = 'File rỗng hoặc không có dữ liệu'; return out; }

    let hit = null;
    for (let i = 0; i < SIGS.length; i++) if (eq(b, SIGS[i][0], SIGS[i][1])) { hit = SIGS[i]; break; }
    if (!hit && b.length >= 12 && eq(b, 0, A('RIFF'))) {
      if (eq(b, 8, A('WEBP'))) hit = [0, null, 'Image', 'WebP'];
      else if (eq(b, 8, A('WAVE'))) hit = [0, null, 'Audio', 'WAV'];
    }
    if (!hit && b.length >= 12 && eq(b, 4, A('ftyp'))) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      hit = [0, null, brand === 'M4A ' ? 'Audio' : 'Video', brand === 'qt  ' ? 'QuickTime MOV' : brand === 'M4A ' ? 'M4A' : 'MP4/ISO-BMFF (' + brand.trim() + ')'];
    }
    if (!hit && b.length >= 8 && b[0] === 0xCA && b[1] === 0xFE && b[2] === 0xBA && b[3] === 0xBE) {
      const n = (b[4] << 24 | b[5] << 16 | b[6] << 8 | b[7]) >>> 0;
      hit = n > 0 && n < 20 ? [0, null, 'Executable', 'Mach-O fat (' + n + ' kiến trúc)'] : [0, null, 'Binary', 'Java class hoặc 0xCAFEBABE khác'];
    }
    if (!hit && b.length >= 2 && b[0] === 0x78 && (b[1] === 0x01 || b[1] === 0x5E || b[1] === 0x9C || b[1] === 0xDA) && ((b[0] << 8) | b[1]) % 31 === 0)
      hit = [0, null, 'Archive', 'zlib (nhận diện 2 byte đầu, độ chắc chắn thấp)'];
    if (!hit && ext === 'mp3' && b.length >= 2 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) hit = [0, null, 'Audio', 'MP3 (frame sync)'];

    if (hit) { out.type = hit[2]; out.format = hit[3]; out.source = 'magic'; }
    else if (looksText(b)) { out.type = 'Text'; out.format = textFormat(b, ext); out.source = 'content'; }
    else if (EXT_ONLY[ext]) { out.type = EXT_ONLY[ext][0]; out.format = EXT_ONLY[ext][1]; out.source = 'extension'; }
    else { out.type = 'Binary'; out.format = 'Không nhận diện được định dạng'; out.source = 'none'; }

    // Bảng ngôn ngữ: theo đuôi chuyên dụng (kể cả khi nội dung là binary plist); không gán cho csv/json (Phase 6 quyết định)
    if (LOC_EXT.has(ext) && out.type !== 'Image' && out.type !== 'Archive') {
      if (out.type !== 'Localization') out.format = 'Localization (' + ext + '): ' + out.format;
      out.type = 'Localization';
    } else if (/\.lproj\//i.test(relPath || '') && ext === 'strings') out.type = 'Localization';

    if (EXPECT[ext] && out.source !== 'extension' && out.type !== EXPECT[ext]) {
      out.extMismatch = true;
      out.note = 'Đuôi .' + ext + ' nhưng nội dung là ' + out.format + ' (' + out.type + ')';
    }
    return out;
  }

  NS.MagicBytes = { identify: identify, extOf: extOf, hexOf: hexOf, PRIORITY_EXT: PRIORITY_EXT, TYPES: ['Text','Font','Image','Audio','Video','Archive','Binary','Executable','Database','Unity asset','Unreal asset','Localization','Unknown'] };
})(typeof window !== 'undefined' ? window : self);
