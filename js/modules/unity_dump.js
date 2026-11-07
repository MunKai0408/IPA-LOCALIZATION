/* unity_dump.js – Phase 4, SUB-PHASE 4.1: UNITY COMPONENT DISCOVERY.
   Chỉ làm: (1) kiểm tra sự tồn tại của các thành phần Unity (mục 10 prompt), (2) xác định Mono hay IL2CPP từ bằng chứng,
   (3) xác định file global-metadata.dat làm đầu vào cho sub-phase sau.
   KHÔNG đọc nội dung file, KHÔNG phân tích header/phiên bản metadata (4.2), KHÔNG trích xuất (4.3).
   Hàm thuần dữ liệu, đồng bộ, không I/O: dùng manifest (Phase 3) + engine/probes (Phase 2) có sẵn trong IpaResult.
   Dùng chung luồng chính + Web Worker. Kết quả = nội dung Meta/unity_info.json. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const SCHEMA = 'unity_info/1';
  const SAMPLE_MAX = 25;                              // số file mẫu tối đa lưu cho mỗi thành phần (số đếm vẫn đầy đủ)
  const IL2CPP_MAGIC = 'AF 1B B1 FA';                // 4 byte đầu global-metadata.dat (cùng giá trị Phase 2 đã dùng)
  const STD_METADATA_PATH = 'data/managed/metadata/global-metadata.dat';

  /* ---------- Bảng thành phần ----------
     test(p, n): p = đường dẫn tương đối với .app (chữ thường), n = tên file (chữ thường); chỉ gọi cho file TRONG .app
     strong: dấu hiệu đủ mạnh để coi là có Unity; runtime: 'il2cpp' | 'mono' | null (thành phần này chứng minh biến thể nào)
     group: 'file' = nhóm theo tên file, loại trừ lẫn nhau theo thứ tự khai báo (một file chỉ vào một nhóm 'file'); 'dir' = theo thư mục, có thể chồng lấn */
  const COMPONENTS = [
    { id: 'unity_framework', label: 'UnityFramework', kind: 'framework', group: 'dir', strong: true, runtime: null,
      test: function (p) { return p.indexOf('frameworks/unityframework.framework/') === 0; },
      note: 'Runtime Unity dạng framework (iOS). IL2CPP thường được liên kết tĩnh vào đây.' },
    { id: 'libil2cpp', label: 'libil2cpp', kind: 'library', group: 'dir', strong: true, runtime: 'il2cpp',
      test: function (p, n) { return n.indexOf('libil2cpp') === 0; },
      note: 'Trên iOS libil2cpp thường nằm trong binary nên KHÔNG có file riêng; vắng mặt là bình thường.' },
    { id: 'global_metadata', label: 'global-metadata.dat', kind: 'metadata', group: 'dir', strong: true, runtime: 'il2cpp',
      test: function (p, n) { return n === 'global-metadata.dat'; },
      note: 'Metadata IL2CPP (tên class/method/chuỗi). Header và phiên bản sẽ được kiểm ở sub-phase 4.2.' },
    { id: 'metadata_dir', label: 'Data/Managed/Metadata (hoặc il2cpp_data)', kind: 'directory', group: 'dir', strong: true, runtime: 'il2cpp',
      test: function (p) { return p.indexOf('data/managed/metadata/') === 0 || /(^|\/)il2cpp_data\//.test(p); },
      note: 'Thư mục chứa metadata của IL2CPP.' },
    { id: 'mono_assemblies', label: 'Data/Managed/*.dll (Mono)', kind: 'assembly', group: 'dir', strong: true, runtime: 'mono',
      test: function (p) { return /^data\/managed\/[^/]+\.dll$/.test(p); },
      note: 'Assembly .NET dạng DLL: dấu hiệu Unity Mono (bản IL2CPP không đóng gói các DLL này).' },
    { id: 'libmono', label: 'libmono*', kind: 'library', group: 'dir', strong: false, runtime: 'mono',
      test: function (p, n) { return n.indexOf('libmono') === 0; }, note: 'Runtime Mono.' },
    { id: 'data_resources', label: 'Data/Resources', kind: 'directory', group: 'dir', strong: false, runtime: null,
      test: function (p) { return p.indexOf('data/resources/') === 0; }, note: '' },
    { id: 'streaming_assets', label: 'StreamingAssets', kind: 'directory', group: 'dir', strong: false, runtime: null,
      test: function (p) { return /(^|\/)streamingassets\//.test(p); }, note: 'Trên iOS StreamingAssets thường nằm ở Data/Raw.' },
    { id: 'data_raw', label: 'Data/Raw', kind: 'directory', group: 'dir', strong: false, runtime: null,
      test: function (p) { return p.indexOf('data/raw/') === 0; }, note: '' },
    { id: 'data_unity3d', label: 'data.unity3d', kind: 'asset', group: 'dir', strong: true, runtime: null,
      test: function (p, n) { return n === 'data.unity3d'; }, note: '' },
    // --- nhóm theo tên file (loại trừ lẫn nhau, thứ tự quan trọng) ---
    { id: 'globalgamemanagers', label: 'globalgamemanagers*', kind: 'asset', group: 'file', strong: true, runtime: null,
      test: function (p, n) { return /^globalgamemanagers(\.|$)/.test(n); }, note: '' },
    { id: 'sharedassets', label: 'sharedassets*', kind: 'asset', group: 'file', strong: false, runtime: null,
      test: function (p, n) { return /^sharedassets\d+(\.|$)/.test(n); }, note: '' },
    { id: 'levels', label: 'level*', kind: 'asset', group: 'file', strong: false, runtime: null,
      test: function (p, n) { return /^level\d+(\.|$)/.test(n); }, note: '' },
    { id: 'assets', label: '*.assets', kind: 'asset', group: 'file', strong: false, runtime: null,
      test: function (p, n) { return /\.assets$/.test(n); }, note: 'Chưa gồm sharedassets*/globalgamemanagers* (đã tính ở nhóm riêng).' },
    { id: 'resource', label: '*.resource', kind: 'asset', group: 'file', strong: false, runtime: null,
      test: function (p, n) { return /\.resource$/.test(n); }, note: '' },
    { id: 'ress', label: '*.resS', kind: 'asset', group: 'file', strong: false, runtime: null,
      test: function (p, n) { return /\.ress$/.test(n); }, note: '' },
    { id: 'bundle', label: '*.bundle', kind: 'asset', group: 'file', strong: false, runtime: null,
      test: function (p, n) { return /\.bundle$/.test(n); }, note: 'Chỉ khớp theo đuôi file; không chắc là AssetBundle Unity (xem “AssetBundle UnityFS” theo magic).' }
  ];
  const UNITYFS = { id: 'unityfs_by_magic', label: 'AssetBundle UnityFS/UnityWeb/UnityRaw (theo magic bytes)', kind: 'asset', strong: true, runtime: null,
    note: 'Nhận theo 8–13 byte đầu file do Phase 3 đọc, không phụ thuộc đuôi.' };

  function inAppRows(ipa) {
    const rootPath = ipa.appRoot || '';
    const mf = ipa.manifest;
    if (mf && Array.isArray(mf.rows)) {
      return { source: 'manifest', scanned: true, rows: mf.rows.filter(function (r) { return r.area !== 'ngoài Payload'; }) };
    }
    // Không có manifest (bước scan lỗi): dựng hàng tối thiểu từ danh sách entry; không có magic/hash/loại.
    const rows = [];
    (ipa.entries || []).forEach(function (e) {
      if (e.dir || e.unsafe || e.path.indexOf(rootPath) !== 0) return;
      rows.push({ relative_path: e.path.slice(rootPath.length), file_size: e.size, detected_type: '', detected_format: '', magic_bytes: '', sha1: '', extraction_status: 'not_scanned', error: '' });
    });
    return { source: 'entries', scanned: false, rows: rows };
  }

  function sample(r) {
    return { path: r.relative_path, size: r.file_size, detected_type: r.detected_type || '', detected_format: r.detected_format || '', extraction_status: r.extraction_status || '' };
  }

  function newComp(def) {
    return { id: def.id, label: def.label, kind: def.kind, strong: !!def.strong, runtime: def.runtime || null, found: false, files: 0, bytes: 0, samples: [], truncated: false, note: def.note || '' };
  }
  function addTo(c, r) {
    c.found = true; c.files++; c.bytes += r.file_size || 0;
    if (c.samples.length < SAMPLE_MAX) c.samples.push(sample(r)); else c.truncated = true;
  }

  /**
   * @param {object} ipa  IpaResult (cần appRoot, engine, engineProbes, manifest, macho)
   * @returns {object} UnityInfo (Meta/unity_info.json)
   */
  function discover(ipa) {
    if (!ipa || typeof ipa !== 'object') throw new Error('UnityDump.discover: thiếu IpaResult');
    const eng = ipa.engine || null;
    const src = inAppRows(ipa);
    const notes = [], warnings = [];
    if (!src.scanned) warnings.push('Không có manifest (bước quét file lỗi hoặc chưa chạy): chỉ dò theo tên đường dẫn, không dùng được magic bytes/hash.');
    else if (ipa.manifest.options && ipa.manifest.options.hashMode === 'fast') notes.push('Manifest ở chế độ nhanh: magic bytes có (đọc đầu file) nhưng chưa có SHA-1/SHA-256.');

    const comps = COMPONENTS.map(newComp), byId = {};
    comps.forEach(function (c) { byId[c.id] = c; });
    const unityfs = newComp(UNITYFS); byId[unityfs.id] = unityfs;

    // gom file vào thành phần
    src.rows.forEach(function (r) {
      const p = String(r.relative_path || '').toLowerCase(), n = p.slice(p.lastIndexOf('/') + 1);
      let fileGroupTaken = false;
      for (let i = 0; i < COMPONENTS.length; i++) {
        const d = COMPONENTS[i];
        if (d.group === 'file' && fileGroupTaken) continue;
        if (d.test(p, n)) { addTo(comps[i], r); if (d.group === 'file') fileGroupTaken = true; }
      }
      if (/^unity(fs|web|raw|archive)/i.test(r.detected_format || '')) addTo(unityfs, r);
    });
    const all = comps.concat([unityfs]);

    // ----- có phải Unity? -----
    const engineUnity = !!(eng && eng.engine === 'Unity' && (eng.status === 'confirmed' || eng.status === 'probable'));
    const strongFound = all.filter(function (c) { return c.strong && c.found; }).map(function (c) { return c.id; });
    const weakFound = all.filter(function (c) { return !c.strong && c.found && c.kind === 'asset'; }).map(function (c) { return c.id; });
    const applicable = engineUnity || strongFound.length > 0;
    let status = applicable ? 'discovered' : (weakFound.length ? 'insufficient_evidence' : 'not_unity');
    if (applicable && !engineUnity && eng) notes.push('Phase 2 xác định engine chính là “' + eng.engine + '” (' + eng.status + ') nhưng có thành phần Unity (có thể Unity nhúng trong ứng dụng khác).');
    if (!applicable && weakFound.length) notes.push('Chỉ có dấu hiệu yếu (' + weakFound.join(', ') + '): chưa đủ để kết luận là Unity.');

    // ----- Mono hay IL2CPP -----
    const il2 = all.filter(function (c) { return c.runtime === 'il2cpp' && c.found; });
    const mono = all.filter(function (c) { return c.runtime === 'mono' && c.found; });
    const ev = function (c) { return { component: c.id, label: c.label, files: c.files, example: c.samples[0] ? c.samples[0].path : '' }; };
    let runtime = 'unresolved', basis = [];
    if (applicable) {
      if (il2.length && mono.length) { runtime = 'conflict'; basis = il2.map(ev).concat(mono.map(ev)); }
      else if (il2.length) { runtime = 'IL2CPP'; basis = il2.map(ev); }
      else if (mono.length) { runtime = 'Mono'; basis = mono.map(ev); }
      if (runtime === 'conflict') warnings.push('Có đồng thời dấu hiệu IL2CPP và Mono: không chọn biến thể; cần kiểm tra thủ công (xem runtime.evidence).');
      if (runtime === 'unresolved') warnings.push('Có Unity nhưng không thấy dấu hiệu phân biệt IL2CPP/Mono trong các file đã quét (metadata có thể bị đổi tên/đóng gói riêng, hoặc IL2CPP chỉ nằm trong binary).');
    } else runtime = 'not_applicable';
    const engVariant = eng ? eng.variant : null;
    const agrees = (runtime === 'IL2CPP' || runtime === 'Mono') ? (engVariant === null ? null : engVariant === runtime) : null;
    if (agrees === false) warnings.push('Biến thể từ thành phần (' + runtime + ') khác kết quả Phase 2 (' + engVariant + ').');

    // ----- file metadata đầu vào -----
    const probes = (ipa.engineProbes || []).filter(function (x) { return x && x.kind === 'il2cpp_metadata'; });
    const probeFor = function (rel) {
      const l = rel.toLowerCase();
      for (let i = 0; i < probes.length; i++) if (String(probes[i].path || '').toLowerCase() === l) return probes[i];
      return null;
    };
    const candRows = src.rows.filter(function (r) {
      const p = String(r.relative_path || '').toLowerCase();
      return p.slice(p.lastIndexOf('/') + 1) === 'global-metadata.dat' || String(r.magic_bytes || '').indexOf(IL2CPP_MAGIC) === 0;
    });
    const candidates = candRows.map(function (r) {
      const p = r.relative_path, l = p.toLowerCase(), named = l.slice(l.lastIndexOf('/') + 1) === 'global-metadata.dat';
      const hasMagic = !!r.magic_bytes;
      const pr = probeFor(p);
      return {
        path: p, entry_path: (ipa.appRoot || '') + p, size: r.file_size, sha1: r.sha1 || '',
        by_name: named, by_magic: String(r.magic_bytes || '').indexOf(IL2CPP_MAGIC) === 0,
        magic_bytes: r.magic_bytes || '', magic_matches: hasMagic ? String(r.magic_bytes).indexOf(IL2CPP_MAGIC) === 0 : null,
        phase2_probe_version: pr && pr.info && typeof pr.info.metadataVersion === 'number' ? pr.info.metadataVersion : null,
        standard_location: l === STD_METADATA_PATH,
        extraction_status: r.extraction_status || '', error: r.error || ''
      };
    });
    const input = { status: 'not_applicable', path: null, entry_path: null, reason: '', candidates: candidates };
    if (applicable && runtime === 'Mono') { input.status = 'not_il2cpp'; input.reason = 'Unity Mono không dùng global-metadata.dat.'; }
    else if (applicable) {
      const usable = function (c) { return c.extraction_status !== 'unsafe_path' && c.extraction_status !== 'encrypted_zip' && c.extraction_status !== 'unsupported_method' && c.extraction_status !== 'read_error'; };
      const ok = candidates.filter(usable);
      if (!candidates.length) {
        input.status = 'missing';
        input.reason = runtime === 'IL2CPP' ? 'Không có file global-metadata.dat nào trong IPA (cũng không có file nào mang magic metadata IL2CPP). Không đoán vị trí khác.'
          : 'Không tìm thấy file global-metadata.dat hoặc file mang magic metadata IL2CPP.';
      } else if (!ok.length) {
        input.status = 'unreadable'; input.reason = 'Có ' + candidates.length + ' file ứng viên nhưng không đọc được (xem extraction_status/error).';
      } else {
        const std = ok.filter(function (c) { return c.standard_location && c.magic_matches !== false; });
        let pick = null;
        if (ok.length === 1) pick = ok[0];
        else if (std.length === 1) pick = std[0];
        if (pick) {
          input.status = 'selected'; input.path = pick.path; input.entry_path = pick.entry_path;
          input.reason = ok.length === 1 ? 'Chỉ có một file ứng viên.' : 'Chọn file ở vị trí chuẩn Data/Managed/Metadata có magic hợp lệ; ' + (ok.length - 1) + ' file khác giữ làm ứng viên phụ.';
          if (pick.magic_matches === false) { input.reason += ' LƯU Ý: magic bytes KHÔNG khớp chữ ký metadata IL2CPP (có thể bị mã hóa/obfuscate hoặc không phải metadata); sub-phase 4.2 sẽ kiểm tra header, không đoán cấu trúc.'; }
          if (pick.magic_matches === null) input.reason += ' Chưa có magic bytes (không đọc được đầu file ở bước quét).';
          if (pick.extraction_status === 'crc_mismatch') input.reason += ' CẢNH BÁO: CRC32 không khớp khi quét → dữ liệu có thể hỏng.';
        } else {
          input.status = 'ambiguous'; input.reason = 'Có ' + ok.length + ' file ứng viên và không có đúng một file ở vị trí chuẩn với magic hợp lệ: không tự chọn.';
        }
      }
    }

    // ----- thông tin binary chính (chỉ ghi nhận, không giải mã) -----
    const m = ipa.macho || null;
    const mainBinary = m ? { path: m.path, size: m.size, archs: (m.archs || []).map(function (a) { return a.name; }), encrypted: m.encrypted } : null;
    if (m && m.encrypted === true) warnings.push('Binary chính mã hóa FairPlay (cryptid≠0): công cụ không giải mã. Chưa kiểm cryptid của UnityFramework; ảnh hưởng tới file metadata sẽ biết sau khi sub-phase 4.2 đọc header.');
    notes.push('Sub-phase 4.1 chỉ dò sự tồn tại và chọn file đầu vào: chưa đọc nội dung, chưa kiểm header/phiên bản metadata, chưa trích xuất chuỗi/class/method.');

    const found = all.filter(function (c) { return c.found; }).length;
    return {
      schema: SCHEMA, sub_phase: '4.1', status: status, applicable: applicable,
      source: { kind: src.source, rows: src.rows.length, scanned: src.scanned, hash_mode: src.scanned && ipa.manifest.options ? ipa.manifest.options.hashMode : null },
      engine: eng ? { engine: eng.engine, variant: eng.variant, status: eng.status, confidence: eng.confidence, analysis_branch: eng.analysis_branch } : null,
      unity_version: eng && eng.engine === 'Unity' && eng.version ? { value: eng.version, source: eng.version_source } : null,
      runtime: { value: runtime, evidence: basis, engine_variant: engVariant, agrees_with_engine: agrees },
      components: all, components_found: found, components_total: all.length,
      metadata_input: input, main_binary: mainBinary,
      notes: notes, warnings: warnings
    };
  }

  /** Phần Unity của report.json (Phase 9 sẽ gộp). */
  function toReportFields(info) {
    if (!info) return null;
    return { unity_status: info.status, unity_runtime: info.runtime.value, unity_version: info.unity_version ? info.unity_version.value : null,
             unity_metadata_input: info.metadata_input.status, unity_metadata_path: info.metadata_input.path };
  }

  NS.UnityDump = { discover: discover, toReportFields: toReportFields, COMPONENTS: COMPONENTS, SCHEMA: SCHEMA, SAMPLE_MAX: SAMPLE_MAX, IL2CPP_MAGIC: IL2CPP_MAGIC, STD_METADATA_PATH: STD_METADATA_PATH };
})(typeof window !== 'undefined' ? window : self);
