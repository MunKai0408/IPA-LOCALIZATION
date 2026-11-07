/* metadata_tables.js – Phase 4, SUB-PHASE 4.3 (phần còn lại): trích xuất ASSEMBLY / IMAGE / NAMESPACE / CLASS / METHOD / FIELD từ global-metadata.dat
   và sinh Meta/dump.cs (chỉ từ dữ liệu có trong metadata). Phân tích TĨNH, không giải mã, không phá obfuscation. Chạy được ở Worker và luồng chính.

   NGUỒN BỐ CỤC (đã đọc ĐẦY ĐỦ bằng git clone, không phải tóm tắt):
     Perfare/Il2CppDumper, commit 4741d46ba9cd6159c5d853eb9d6fc48b4bfa2b1a
       - Il2CppDumper/Il2Cpp/MetadataClass.cs : định nghĩa header + struct, thuộc tính [Version(Min,Max)] của từng trường
       - Il2CppDumper/Il2Cpp/Metadata.cs      : thứ tự đọc, cách nhận diện v24.1/24.2/24.4, string = null-terminated UTF-8 tại stringOffset + index
       - Il2CppDumper/Outputs/Il2CppConstants.cs : giá trị cờ TypeAttributes/MethodAttributes
   Bảng STRUCTS bên dưới là bản chép tay của MetadataClass.cs; tests/run_tables_tests.js đối chiếu nó với tests/fixtures/il2cpp_struct_schema.json
   (do tests/derive_schema_from_cs.py dẫn xuất tự động từ chính file nguồn) cho mọi version.

   GIỚI HẠN CÓ CHỦ ĐÍCH:
     - Tên kiểu của field/tham số/return/parent là chỉ số vào bảng Il2CppType của BINARY (UnityFramework), KHÔNG nằm trong metadata. Module không đọc binary nên các
       chỉ số này chỉ được giữ ở dạng số thô (type_raw_index…); KHÔNG tự suy ra tên kiểu. Cờ truy cập của field cũng nằm trong Il2CppType nên KHÔNG có.
     - Không đọc custom attribute, default value, generic, event, property, vtable (không cần cho Việt hóa; ghi rõ ở not_extracted).
     - Chỉ version ∈ TABLE_VERSIONS (đã có bố cục xác minh VÀ qua kiểm tra header 4.2). Version khác → unsupported_version, không đoán.
   KHÁC BIỆT CÓ CHỦ ĐÍCH SO VỚI THAM CHIẾU: phân biệt v24.2 / v24.4 và v24.1 / “24.1+” bằng kích thước bảng assembly KHỚP CHÍNH XÁC (68×N hoặc 64×N, N = số image),
     không dùng phép chia nguyên (chia nguyên của tham chiếu nhận nhầm khi N < 16). Không khớp → layout_mismatch, không đoán. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  const SCHEMA = 'metadata_tables/1';
  const TABLE_VERSIONS = [16, 17, 19, 20, 21, 22, 24, 27, 29, 31];
  const SOURCES = [
    'Perfare/Il2CppDumper @4741d46 – Il2CppDumper/Il2Cpp/MetadataClass.cs (header + struct + [Version(Min,Max)])',
    'Perfare/Il2CppDumper @4741d46 – Il2CppDumper/Il2Cpp/Metadata.cs (thứ tự đọc, nhận diện v24.x, GetStringFromIndex)',
    'Perfare/Il2CppDumper @4741d46 – Il2CppDumper/Outputs/Il2CppConstants.cs (TYPE_ATTRIBUTE_*, METHOD_ATTRIBUTE_*)'
  ];
  const LIMITS = {
    max_strings_bytes: 128 * 1048576,   // vùng string (tên)
    max_tables_bytes: 192 * 1048576,    // tổng các bảng struct
    max_rows: 1500000,                  // methods / fields mỗi loại
    max_name_scan: 65536                // độ dài tối đa khi tìm byte 0 cho một tên
  };

  /* ---------- Schema (chép tay từ MetadataClass.cs). Mỗi trường: [tên, kiểu, min, max]; mặc định min=0, max=99. Kiểu: u=uint32 i=int32 h=uint16 s=int16 b8=byte[8] A=aname lồng ---------- */
  const U = 'u', I = 'i', H = 'h', S16 = 's';
  const STRUCTS = {
    header: [
      ['sanity', U], ['version', I],
      ['stringLiteralOffset', U], ['stringLiteralSize', I], ['stringLiteralDataOffset', U], ['stringLiteralDataSize', I],
      ['stringOffset', U], ['stringSize', I], ['eventsOffset', U], ['eventsSize', I], ['propertiesOffset', U], ['propertiesSize', I],
      ['methodsOffset', U], ['methodsSize', I], ['parameterDefaultValuesOffset', U], ['parameterDefaultValuesSize', I],
      ['fieldDefaultValuesOffset', U], ['fieldDefaultValuesSize', I], ['fieldAndParameterDefaultValueDataOffset', U], ['fieldAndParameterDefaultValueDataSize', I],
      ['fieldMarshaledSizesOffset', I], ['fieldMarshaledSizesSize', I], ['parametersOffset', U], ['parametersSize', I], ['fieldsOffset', U], ['fieldsSize', I],
      ['genericParametersOffset', U], ['genericParametersSize', I], ['genericParameterConstraintsOffset', U], ['genericParameterConstraintsSize', I],
      ['genericContainersOffset', U], ['genericContainersSize', I], ['nestedTypesOffset', U], ['nestedTypesSize', I], ['interfacesOffset', U], ['interfacesSize', I],
      ['vtableMethodsOffset', U], ['vtableMethodsSize', I], ['interfaceOffsetsOffset', I], ['interfaceOffsetsSize', I], ['typeDefinitionsOffset', U], ['typeDefinitionsSize', I],
      ['rgctxEntriesOffset', U, 0, 24.1], ['rgctxEntriesCount', I, 0, 24.1], ['imagesOffset', U], ['imagesSize', I], ['assembliesOffset', U], ['assembliesSize', I],
      ['metadataUsageListsOffset', U, 19, 24.5], ['metadataUsageListsCount', I, 19, 24.5], ['metadataUsagePairsOffset', U, 19, 24.5], ['metadataUsagePairsCount', I, 19, 24.5],
      ['fieldRefsOffset', U, 19], ['fieldRefsSize', I, 19], ['referencedAssembliesOffset', I, 20], ['referencedAssembliesSize', I, 20],
      ['attributesInfoOffset', U, 21, 27.2], ['attributesInfoCount', I, 21, 27.2], ['attributeTypesOffset', U, 21, 27.2], ['attributeTypesCount', I, 21, 27.2],
      ['attributeDataOffset', U, 29], ['attributeDataSize', I, 29], ['attributeDataRangeOffset', U, 29], ['attributeDataRangeSize', I, 29],
      ['unresolvedVirtualCallParameterTypesOffset', I, 22], ['unresolvedVirtualCallParameterTypesSize', I, 22],
      ['unresolvedVirtualCallParameterRangesOffset', I, 22], ['unresolvedVirtualCallParameterRangesSize', I, 22],
      ['windowsRuntimeTypeNamesOffset', I, 23], ['windowsRuntimeTypeNamesSize', I, 23], ['windowsRuntimeStringsOffset', I, 27], ['windowsRuntimeStringsSize', I, 27],
      ['exportedTypeDefinitionsOffset', I, 24], ['exportedTypeDefinitionsSize', I, 24]
    ],
    aname: [
      ['nameIndex', U], ['cultureIndex', U], ['hashValueIndex', I, 0, 24.3], ['publicKeyIndex', U], ['hash_alg', U], ['hash_len', I], ['flags', U],
      ['major', I], ['minor', I], ['build', I], ['revision', I], ['public_key_token', 'b8']
    ],
    assembly: [
      ['imageIndex', I], ['token', U, 24.1], ['customAttributeIndex', I, 0, 24], ['referencedAssemblyStart', I, 20], ['referencedAssemblyCount', I, 20], ['aname', 'A']
    ],
    image: [
      ['nameIndex', U], ['assemblyIndex', I], ['typeStart', I], ['typeCount', U], ['exportedTypeStart', I, 24], ['exportedTypeCount', U, 24],
      ['entryPointIndex', I], ['token', U, 19], ['customAttributeStart', I, 24.1], ['customAttributeCount', U, 24.1]
    ],
    typedef: [
      ['nameIndex', U], ['namespaceIndex', U], ['customAttributeIndex', I, 0, 24], ['byvalTypeIndex', I], ['byrefTypeIndex', I, 0, 24.5],
      ['declaringTypeIndex', I], ['parentIndex', I], ['elementTypeIndex', I], ['rgctxStartIndex', I, 0, 24.1], ['rgctxCount', I, 0, 24.1], ['genericContainerIndex', I],
      ['delegateWrapperFromManagedToNativeIndex', I, 0, 22], ['marshalingFunctionsIndex', I, 0, 22], ['ccwFunctionIndex', I, 21, 22], ['guidIndex', I, 21, 22],
      ['flags', U], ['fieldStart', I], ['methodStart', I], ['eventStart', I], ['propertyStart', I], ['nestedTypesStart', I], ['interfacesStart', I], ['vtableStart', I], ['interfaceOffsetsStart', I],
      ['method_count', H], ['property_count', H], ['field_count', H], ['event_count', H], ['nested_type_count', H], ['vtable_count', H], ['interfaces_count', H], ['interface_offsets_count', H],
      ['bitfield', U], ['token', U, 19]
    ],
    method: [
      ['nameIndex', U], ['declaringType', I], ['returnType', I], ['returnParameterToken', I, 31], ['parameterStart', I], ['customAttributeIndex', I, 0, 24], ['genericContainerIndex', I],
      ['methodIndex', I, 0, 24.1], ['invokerIndex', I, 0, 24.1], ['delegateWrapperIndex', I, 0, 24.1], ['rgctxStartIndex', I, 0, 24.1], ['rgctxCount', I, 0, 24.1],
      ['token', U], ['flags', H], ['iflags', H], ['slot', H], ['parameterCount', H]
    ],
    parameter: [['nameIndex', U], ['token', U], ['customAttributeIndex', I, 0, 24], ['typeIndex', I]],
    field: [['nameIndex', U], ['typeIndex', I], ['customAttributeIndex', I, 0, 24], ['token', U, 19]]
  };
  // tên class C# tương ứng (dùng cho test đối chiếu fixture)
  const CS_CLASS = { header: 'Il2CppGlobalMetadataHeader', aname: 'Il2CppAssemblyNameDefinition', assembly: 'Il2CppAssemblyDefinition', image: 'Il2CppImageDefinition',
    typedef: 'Il2CppTypeDefinition', method: 'Il2CppMethodDefinition', parameter: 'Il2CppParameterDefinition', field: 'Il2CppFieldDefinition' };
  const KIND_SIZE = { u: 4, i: 4, h: 2, s: 2, b8: 8 };

  const layoutCache = {};
  /** Bố cục của struct tại version V (V có thể là 24.1, 24.2, 24.4…). @returns {{size:number, fields:Array<{name,kind,off}>}} */
  function layoutOf(name, V) {
    const key = name + '@' + V;
    if (layoutCache[key]) return layoutCache[key];
    const fields = []; let off = 0;
    STRUCTS[name].forEach(function (f) {
      const min = f[2] === undefined ? 0 : f[2], max = f[3] === undefined ? 99 : f[3];
      if (V < min || V > max) return;
      if (f[1] === 'A') {
        const sub = layoutOf('aname', V);
        sub.fields.forEach(function (g) { fields.push({ name: 'aname_' + g.name, kind: g.kind, off: off + g.off }); });
        off += sub.size;
      } else { fields.push({ name: f[0], kind: f[1], off: off }); off += KIND_SIZE[f[1]]; }
    });
    return (layoutCache[key] = { size: off, fields: fields });
  }

  function readStruct(dv, base, lay) {
    const o = {};
    for (let i = 0; i < lay.fields.length; i++) {
      const f = lay.fields[i], p = base + f.off;
      switch (f.kind) {
        case 'u': o[f.name] = dv.getUint32(p, true); break;
        case 'i': o[f.name] = dv.getInt32(p, true); break;
        case 'h': o[f.name] = dv.getUint16(p, true); break;
        case 's': o[f.name] = dv.getInt16(p, true); break;
        default: { let hx = ''; for (let k = 0; k < 8; k++) hx += (dv.getUint8(p + k) < 16 ? '0' : '') + dv.getUint8(p + k).toString(16); o[f.name] = hx; }
      }
    }
    return o;
  }
  function viewOf(u8) { return new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }
  /** Đọc mảng struct; trả cả phần dư (bytes không chia hết). */
  function readArray(u8, name, V, limitCount) {
    const lay = layoutOf(name, V), dv = viewOf(u8);
    const n = Math.floor(u8.length / lay.size), cnt = limitCount === undefined ? n : Math.min(n, limitCount), out = new Array(cnt);
    for (let i = 0; i < cnt; i++) out[i] = readStruct(dv, i * lay.size, lay);
    return { items: out, count: n, remainder: u8.length - n * lay.size, struct_size: lay.size };
  }

  /* ---------- Header ---------- */
  /** Đọc header theo schema. Cho v24: đọc như v24 (272 B); nếu stringLiteralOffset == 264 → v24.2 (264 B) – đúng như Metadata.cs.
   *  @returns {{ok:boolean, error?:string, version:number, layout_version:number, header:Object, header_size:number}} */
  function parseHeader(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 8) return { ok: false, error: 'Không đủ byte để đọc magic/version' };
    const dv = viewOf(bytes);
    if (dv.getUint32(0, true) !== 0xFAB11BAF) return { ok: false, error: 'Magic sai' };
    const version = dv.getInt32(4, true);
    if (TABLE_VERSIONS.indexOf(version) < 0) return { ok: false, error: 'Version ' + version + ' không có bố cục xác minh', version: version };
    let V = version, lay = layoutOf('header', V);
    if (bytes.length < lay.size) return { ok: false, error: 'Header v' + version + ' cần ' + lay.size + ' byte, chỉ có ' + bytes.length, version: version };
    let header = readStruct(dv, 0, lay);
    if (version === 24 && header.stringLiteralOffset === 264) {
      V = 24.2; lay = layoutOf('header', V);
      if (bytes.length < lay.size) return { ok: false, error: 'Header v24.2 cần ' + lay.size + ' byte', version: version };
      header = readStruct(dv, 0, lay);
    }
    return { ok: true, version: version, layout_version: V, header: header, header_size: lay.size };
  }

  /** Các vùng cần đọc: [khóa, trường offset, trường size, tên struct|null (null = int32/bytes)] */
  const REGIONS = [
    ['strings', 'stringOffset', 'stringSize', null], ['images', 'imagesOffset', 'imagesSize', 'image'], ['assemblies', 'assembliesOffset', 'assembliesSize', 'assembly'],
    ['typedefs', 'typeDefinitionsOffset', 'typeDefinitionsSize', 'typedef'], ['methods', 'methodsOffset', 'methodsSize', 'method'],
    ['parameters', 'parametersOffset', 'parametersSize', 'parameter'], ['fields', 'fieldsOffset', 'fieldsSize', 'field'], ['nested', 'nestedTypesOffset', 'nestedTypesSize', null]
  ];

  /** Kế hoạch đọc: kiểm tra từng vùng nằm trong file và trong giới hạn bộ nhớ. THUẦN. */
  function planRegions(header, headerSize, fileSize) {
    const plan = { ok: true, regions: [], total_tables: 0, errors: [] };
    REGIONS.forEach(function (r) {
      const off = header[r[1]], size = header[r[2]];
      const reg = { key: r[0], offset: off, size: size };
      if (size < 0) { plan.errors.push(r[0] + ': size âm (' + size + ')'); plan.ok = false; }
      else if (size > 0 && (off < headerSize || off > fileSize || off + size > fileSize)) { plan.errors.push(r[0] + ': vùng [' + off + ', ' + (off + size) + ') nằm ngoài file (' + fileSize + ' byte) hoặc đè lên header (' + headerSize + ' byte)'); plan.ok = false; }
      plan.regions.push(reg);
      if (r[0] !== 'strings' && size > 0) plan.total_tables += size;
    });
    const st = plan.regions[0];
    if (st.size > LIMITS.max_strings_bytes) { plan.errors.push('vùng string ' + st.size + ' B vượt giới hạn ' + LIMITS.max_strings_bytes); plan.too_large = true; plan.ok = false; }
    if (plan.total_tables > LIMITS.max_tables_bytes) { plan.errors.push('tổng bảng ' + plan.total_tables + ' B vượt giới hạn ' + LIMITS.max_tables_bytes); plan.too_large = true; plan.ok = false; }
    return plan;
  }

  /* ---------- Tên ---------- */
  function makeNamer(strings, flags) {
    const cache = new Map(); const dec = new TextDecoder('utf-8', { fatal: false }), strict = new TextDecoder('utf-8', { fatal: true });
    return function (index) {
      if (cache.has(index)) return cache.get(index);
      let s = null;
      if (index >= 0 && index < strings.length) {
        const limit = Math.min(strings.length, index + LIMITS.max_name_scan);
        let e = index; while (e < limit && strings[e] !== 0) e++;
        if (e >= strings.length || strings[e] !== 0) { flags.unterminated++; s = null; }
        else {
          const sl = strings.subarray(index, e);
          try { s = strict.decode(sl); } catch (_) { s = dec.decode(sl); flags.invalid_utf8++; }
        }
      } else flags.name_out_of_range++;
      cache.set(index, s); return s;
    };
  }

  const TYPE_VIS = ['not_public', 'public', 'nested_public', 'nested_private', 'nested_family', 'nested_assembly', 'nested_fam_and_assem', 'nested_fam_or_assem'];
  const METHOD_ACCESS = ['compiler_controlled', 'private', 'fam_and_assem', 'assembly', 'family', 'fam_or_assem', 'public', 'reserved'];

  /** THUẦN: giải các bảng từ vùng đã nạp. buffers = {strings, images, assemblies, typedefs, methods, parameters, fields, nested} (Uint8Array).
   *  @returns kết quả (status 'ok' hoặc 'layout_mismatch'/'invalid_table') – không ném lỗi với dữ liệu xấu. */
  function decodeTables(hdrInfo, buffers) {
    const r = baseResult({ version: hdrInfo.version });
    const flags = { name_out_of_range: 0, invalid_utf8: 0, unterminated: 0 };
    try {
      const hd = hdrInfo.header; let V = hdrInfo.layout_version; const notes = r.notes;
      const asmSize = buffers.assemblies.length;
      // --- nhận diện biến thể v24 (Metadata.cs) ---
      if (hdrInfo.version === 24) {
        if (V === 24) { // 24.0 hay 24.1: đọc image theo v24; token != 1 → 24.1
          const probe = readArray(buffers.images, 'image', 24).items;
          if (probe.some(function (x) { return x.token !== 1; })) V = 24.1;
        }
      }
      let imageV = V, asmV = V;
      let images = readArray(buffers.images, 'image', imageV);
      if (hdrInfo.version === 24) {
        const N = images.count;
        if (V === 24.2) {
          if (asmSize === 68 * N) asmV = 24.2; else if (asmSize === 64 * N) { V = 24.4; asmV = 24.4; }
          else return mismatch(r, 'v24.2/24.4: kích thước bảng assembly ' + asmSize + ' không bằng 68×' + N + ' hoặc 64×' + N + ' (số image)');
        } else if (V === 24.1) {
          if (asmSize === 68 * N) asmV = 24.1; else if (asmSize === 64 * N) asmV = 24.4;
          else return mismatch(r, 'v24.1: kích thước bảng assembly ' + asmSize + ' không bằng 68×' + N + ' hoặc 64×' + N + ' (số image)');
        }
        r.layout = { version_field: 24, detected: V, assembly_layout: asmV };
        notes.push('v24: biến thể bố cục nhận diện = ' + V + ' (24.2 và 24.3 cùng bố cục; 24.4 và 24.5 cùng bố cục).');
      } else r.layout = { version_field: hdrInfo.version, detected: hdrInfo.version, assembly_layout: hdrInfo.version };
      imageV = V;
      images = readArray(buffers.images, 'image', imageV);
      const assemblies = readArray(buffers.assemblies, 'assembly', asmV);
      const typedefs = readArray(buffers.typedefs, 'typedef', V);
      const methods = readArray(buffers.methods, 'method', V);
      const params = readArray(buffers.parameters, 'parameter', V);
      const fields = readArray(buffers.fields, 'field', V);
      const nestedN = Math.floor(buffers.nested.length / 4);
      const chk = [['images', images], ['assemblies', assemblies], ['typedefs', typedefs], ['methods', methods], ['parameters', params], ['fields', fields]];
      for (let i = 0; i < chk.length; i++) {
        if (chk[i][1].remainder !== 0) return mismatch(r, 'Bảng ' + chk[i][0] + ' dài ' + (chk[i][1].count * chk[i][1].struct_size + chk[i][1].remainder) + ' byte, không chia hết cho kích thước struct ' + chk[i][1].struct_size + ' (v' + V + ')');
      }
      if (buffers.nested.length % 4 !== 0) return mismatch(r, 'Bảng nestedTypes dài ' + buffers.nested.length + ' byte, không chia hết cho 4');
      if (methods.count > LIMITS.max_rows || fields.count > LIMITS.max_rows) { r.status = 'too_large'; r.reason = 'Số method (' + methods.count + ') hoặc field (' + fields.count + ') vượt giới hạn ' + LIMITS.max_rows; return r; }
      r.struct_sizes = { image: images.struct_size, assembly: assemblies.struct_size, typedef: typedefs.struct_size, method: methods.struct_size, parameter: params.struct_size, field: fields.struct_size };

      const name = makeNamer(buffers.strings, flags);
      const nv = viewOf(buffers.nested);
      const T = typedefs.items, M = methods.items, F = fields.items, P = params.items;
      const problems = r.problems;
      const prob = function (code, msg) { if (problems.length < 200) problems.push({ code: code, message: msg }); r.problem_counts[code] = (r.problem_counts[code] || 0) + 1; };

      // assembly
      r.assemblies = assemblies.items.map(function (a, i) {
        return { index: i, name: name(a.aname_nameIndex), culture: name(a.aname_cultureIndex) || '', image_index: a.imageIndex, token: a.token === undefined ? null : a.token,
          version: a.aname_major + '.' + a.aname_minor + '.' + a.aname_build + '.' + a.aname_revision, flags: a.aname_flags, hash_alg: a.aname_hash_alg, public_key_token: a.aname_public_key_token,
          referenced_assembly_start: a.referencedAssemblyStart === undefined ? null : a.referencedAssemblyStart, referenced_assembly_count: a.referencedAssemblyCount === undefined ? null : a.referencedAssemblyCount };
      });
      // image + ánh xạ type → image
      const typeImage = new Int32Array(T.length).fill(-1);
      r.images = images.items.map(function (im, i) {
        const o = { index: i, name: name(im.nameIndex), assembly_index: im.assemblyIndex, type_start: im.typeStart, type_count: im.typeCount, entry_point_index: im.entryPointIndex,
          token: im.token === undefined ? null : im.token };
        if (im.exportedTypeStart !== undefined) { o.exported_type_start = im.exportedTypeStart; o.exported_type_count = im.exportedTypeCount; }
        if (im.typeStart < 0 || im.typeStart + im.typeCount > T.length) { prob('image_type_range', 'Image #' + i + ' (' + o.name + '): vùng type [' + im.typeStart + ', ' + (im.typeStart + im.typeCount) + ') vượt số typedef ' + T.length); }
        else for (let k = im.typeStart; k < im.typeStart + im.typeCount; k++) typeImage[k] = i;
        return o;
      });
      // method/field -> type
      const methodType = new Int32Array(M.length).fill(-1), fieldType = new Int32Array(F.length).fill(-1);
      const nestedIn = new Int32Array(T.length).fill(-1);
      r.types = T.map(function (t, i) {
        const vis = t.flags & 7;
        const isIface = (t.flags & 0x20) !== 0, isEnum = ((t.bitfield >>> 1) & 1) === 1, isValue = (t.bitfield & 1) === 1;
        const o = { index: i, image_index: typeImage[i], namespace: name(t.namespaceIndex), name: name(t.nameIndex), full_name: null,
          kind: isIface ? 'interface' : isEnum ? 'enum' : isValue ? 'struct' : 'class', visibility: TYPE_VIS[vis],
          is_abstract: (t.flags & 0x80) !== 0, is_sealed: (t.flags & 0x100) !== 0, flags: t.flags, token: t.token === undefined ? null : t.token,
          field_start: t.fieldStart, field_count: t.field_count, method_start: t.methodStart, method_count: t.method_count,
          nested_types_start: t.nestedTypesStart, nested_type_count: t.nested_type_count, nested_in: null,
          parent_type_raw_index: t.parentIndex, declaring_type_raw_index: t.declaringTypeIndex };
        if (t.method_count > 0) { if (t.methodStart < 0 || t.methodStart + t.method_count > M.length) prob('type_method_range', 'Type #' + i + ' (' + o.name + '): method [' + t.methodStart + ', +' + t.method_count + ') vượt ' + M.length); else for (let k = t.methodStart; k < t.methodStart + t.method_count; k++) methodType[k] = i; }
        if (t.field_count > 0) { if (t.fieldStart < 0 || t.fieldStart + t.field_count > F.length) prob('type_field_range', 'Type #' + i + ' (' + o.name + '): field [' + t.fieldStart + ', +' + t.field_count + ') vượt ' + F.length); else for (let k = t.fieldStart; k < t.fieldStart + t.field_count; k++) fieldType[k] = i; }
        if (t.nested_type_count > 0) {
          if (t.nestedTypesStart < 0 || t.nestedTypesStart + t.nested_type_count > nestedN) prob('type_nested_range', 'Type #' + i + ' (' + o.name + '): nested [' + t.nestedTypesStart + ', +' + t.nested_type_count + ') vượt ' + nestedN);
          else for (let k = 0; k < t.nested_type_count; k++) { const c = nv.getInt32((t.nestedTypesStart + k) * 4, true); if (c >= 0 && c < T.length) nestedIn[c] = i; else prob('nested_index', 'Type #' + i + ': chỉ số nested ' + c + ' ngoài phạm vi'); }
        }
        return o;
      });
      // full_name có xét lồng nhau (chống vòng lặp)
      r.types.forEach(function (o, i) {
        const parts = [o.name]; let cur = nestedIn[i], guard = 0;
        while (cur >= 0 && guard++ < 32) { parts.unshift(r.types[cur].name); cur = nestedIn[cur]; }
        if (guard >= 32) prob('nested_cycle', 'Type #' + i + ': chuỗi nested quá sâu/vòng lặp');
        if (nestedIn[i] >= 0) o.nested_in = nestedIn[i];
        o.full_name = (o.namespace ? o.namespace + '.' : '') + parts.join('/');
      });
      r.methods = M.map(function (m, i) {
        const o = { index: i, type_index: methodType[i], name: name(m.nameIndex), flags: m.flags, iflags: m.iflags, access: METHOD_ACCESS[m.flags & 7], is_static: (m.flags & 0x10) !== 0,
          is_virtual: (m.flags & 0x40) !== 0, is_abstract: (m.flags & 0x400) !== 0, slot: m.slot, token: m.token, parameter_count: m.parameterCount, parameter_start: m.parameterStart,
          return_type_raw_index: m.returnType, parameters: [] };
        if (m.parameterCount > 0) {
          if (m.parameterStart < 0 || m.parameterStart + m.parameterCount > P.length) prob('method_param_range', 'Method #' + i + ' (' + o.name + '): tham số [' + m.parameterStart + ', +' + m.parameterCount + ') vượt ' + P.length);
          else for (let k = 0; k < m.parameterCount; k++) { const p = P[m.parameterStart + k]; o.parameters.push({ name: name(p.nameIndex), type_raw_index: p.typeIndex }); }
        }
        return o;
      });
      r.fields = F.map(function (f, i) { return { index: i, type_index: fieldType[i], name: name(f.nameIndex), token: f.token === undefined ? null : f.token, type_raw_index: f.typeIndex }; });
      r.counts = { assemblies: r.assemblies.length, images: r.images.length, types: r.types.length, methods: r.methods.length, fields: r.fields.length, parameters: P.length,
        namespaces: new Set(r.types.map(function (t) { return t.namespace || ''; })).size };
      r.name_problems = flags;
      r.status = 'ok';
      const pc = Object.keys(r.problem_counts).reduce(function (a, k) { return a + r.problem_counts[k]; }, 0);
      r.reason = 'Đã giải ' + r.counts.assemblies + ' assembly, ' + r.counts.images + ' image, ' + r.counts.types + ' type, ' + r.counts.methods + ' method, ' + r.counts.fields + ' field (bố cục v' + V + ')'
        + (pc ? '; ' + pc + ' bất thường (xem problems)' : '') + (flags.name_out_of_range || flags.unterminated || flags.invalid_utf8 ? '; tên lỗi: ' + flags.name_out_of_range + ' ngoài vùng, ' + flags.unterminated + ' không kết thúc, ' + flags.invalid_utf8 + ' UTF-8 sai' : '') + '.';
      if (r.counts.types > 0 && pc > r.counts.types * 0.5) { r.status = 'invalid_table'; r.reason = pc + ' bất thường trên ' + r.counts.types + ' type: bố cục thực tế có thể khác giả định (hoặc dữ liệu bị mã hóa/obfuscate). Không xuất dữ liệu.'; clearData(r); }
      return r;
    } catch (e) {
      r.status = 'invalid_table'; r.reason = 'Lỗi khi giải bảng: ' + ((e && e.message) || e); clearData(r); return r;
    }
  }
  function mismatch(r, why) { r.status = 'layout_mismatch'; r.reason = why + '. Không đoán bố cục; có thể file bị biến đổi/obfuscate hoặc biến thể version chưa được hỗ trợ.'; return r; }
  function clearData(r) { r.assemblies = []; r.images = []; r.types = []; r.methods = []; r.fields = []; }

  const NOT_EXTRACTED = ['custom attributes', 'default values', 'generic containers/parameters', 'events', 'properties', 'interfaces', 'vtable',
    'tên kiểu của field/tham số/return (nằm trong bảng Il2CppType của binary, không có trong metadata)', 'cờ truy cập của field (nằm trong Il2CppType của binary)'];
  function baseResult(extra) {
    return Object.assign({ schema: SCHEMA, sub_phase: '4.3', status: 'not_eligible', reason: '', version: null, layout: null, path: null, entry_path: null,
      counts: null, struct_sizes: null, assemblies: [], images: [], types: [], methods: [], fields: [], problems: [], problem_counts: {}, name_problems: null,
      limits: Object.assign({}, LIMITS), not_extracted: NOT_EXTRACTED.slice(), reference_sources: SOURCES.slice(), notes: [] }, extra || {});
  }

  /** Trích xuất từ IPA. Không ném lỗi (trừ CANCELLED). Chỉ chạy khi header 4.2 = generic_ok và version ∈ TABLE_VERSIONS.
   *  @param hooks {isCancelled?, progress?(0..1)} */
  async function extractTables(file, unity, entries, hooks) {
    hooks = hooks || {};
    const mh = unity && unity.metadata_header;
    const r = baseResult({ path: mh ? mh.path : null, entry_path: mh ? mh.entry_path : null, version: mh && mh.version ? mh.version.value : null });
    if (!mh || mh.status !== 'generic_ok') { r.reason = 'Không trích xuất: header metadata chưa đạt kiểm tra chung (trạng thái: ' + (mh ? mh.status : 'không có') + ').'; return r; }
    if (TABLE_VERSIONS.indexOf(mh.version.value) < 0) { r.status = 'unsupported_version'; r.reason = 'Version ' + mh.version.value + ' chưa có bố cục xác minh (hỗ trợ: ' + TABLE_VERSIONS.join(', ') + '). Không đoán.'; return r; }
    const matches = (entries || []).filter(function (e) { return e && !e.dir && e.name === r.entry_path; });
    if (matches.length !== 1) { r.status = 'read_error'; r.reason = 'Không xác định được entry metadata (' + matches.length + ' khớp)'; return r; }
    const entry = matches[0], F = entry.size;
    let hdr;
    try {
      const head = await NS.IpaReader.readEntry(file, entry, { max: 4096, head: true });
      hdr = parseHeader(head.data.length > 4096 ? head.data.subarray(0, 4096) : head.data);
    } catch (e) { if (e && e.code === 'CANCELLED') throw e; r.status = 'read_error'; r.reason = 'Không đọc được header: ' + ((e && e.message) || e); return r; }
    if (!hdr.ok) { r.status = 'invalid_table'; r.reason = hdr.error; return r; }
    const plan = planRegions(hdr.header, hdr.header_size, F);
    if (!plan.ok) { r.status = plan.too_large ? 'too_large' : 'invalid_table'; r.reason = plan.errors.join('; '); return r; }
    const bufs = {}; plan.regions.forEach(function (g) { bufs[g.key] = new Uint8Array(g.size); });
    let pos = 0;
    const copy = function (chunk) {
      plan.regions.forEach(function (g) {
        if (g.size === 0) return;
        const s = Math.max(pos, g.offset), e = Math.min(pos + chunk.length, g.offset + g.size);
        if (e > s) bufs[g.key].set(chunk.subarray(s - pos, e - pos), s - g.offset);
      });
    };
    try {
      await NS.IpaReader.streamEntry(file, entry, function (chunk) { copy(chunk); pos += chunk.length; if (hooks.progress) hooks.progress(Math.min(1, pos / F)); }, { isCancelled: hooks.isCancelled });
    } catch (e) {
      if (e && e.code === 'CANCELLED') throw e;
      r.status = 'read_error'; r.reason = 'Không đọc được metadata: ' + ((e && e.message) || e); return r;
    }
    const d = decodeTables(hdr, bufs);
    d.path = r.path; d.entry_path = r.entry_path;
    return d;
  }

  /* ---------- Xuất ---------- */
  function counts(t) { return t && t.counts ? t.counts : null; }

  /** Meta/dump.cs – CHỈ dữ liệu có trong metadata. Kiểu của field/tham số/return là chỉ số thô vào bảng kiểu của binary (không được tự suy ra). */
  function toDumpCs(t) {
    if (!t || t.status !== 'ok') return null;
    const out = [];
    out.push('// IPA Localization Studio – dump từ global-metadata.dat v' + t.version + ' (bố cục ' + t.layout.detected + '), phân tích tĩnh.');
    out.push('// LƯU Ý: kiểu của field/tham số/giá trị trả về là chỉ số thô vào bảng Il2CppType của binary (ví dụ type#123); KHÔNG có trong metadata nên không được suy ra tên kiểu.');
    out.push('// Không có RVA/offset hàm, không có cờ truy cập field, không có custom attribute.');
    t.images.forEach(function (im) { out.push('// Image ' + im.index + ': ' + im.name + ' - ' + im.type_start); });
    const byImage = {};
    t.types.forEach(function (ty) { (byImage[ty.image_index] = byImage[ty.image_index] || []).push(ty); });
    const order = Object.keys(byImage).map(Number).sort(function (a, b) { return a - b; });
    order.forEach(function (imgIdx) {
      byImage[imgIdx].forEach(function (ty) {
        out.push('');
        out.push('// Namespace: ' + (ty.namespace || ''));
        const vis = { public: 'public ', nested_public: 'public ', not_public: 'internal ', nested_fam_and_assem: 'internal ', nested_assembly: 'internal ', nested_private: 'private ', nested_family: 'protected ', nested_fam_or_assem: 'protected internal ' }[ty.visibility] || '';
        let mod = '';
        if (ty.is_abstract && ty.is_sealed) mod = 'static '; else if (ty.kind !== 'interface' && ty.is_abstract) mod = 'abstract '; else if (ty.kind === 'class' && ty.is_sealed) mod = 'sealed ';
        out.push(vis + mod + ty.kind + ' ' + (ty.nested_in !== null ? ty.full_name.slice(ty.namespace ? ty.namespace.length + 1 : 0) : ty.name) + ' // TypeDefIndex: ' + ty.index + (ty.image_index >= 0 ? '' : ' (không thuộc image nào)'));
        out.push('{');
        if (ty.field_count > 0 && ty.field_start >= 0 && ty.field_start + ty.field_count <= t.fields.length) {
          out.push('\t// Fields');
          for (let i = ty.field_start; i < ty.field_start + ty.field_count; i++) { const f = t.fields[i]; out.push('\t/* type#' + f.type_raw_index + ' */ ' + f.name + '; // FieldIndex: ' + i); }
        }
        if (ty.method_count > 0 && ty.method_start >= 0 && ty.method_start + ty.method_count <= t.methods.length) {
          if (ty.field_count > 0) out.push('');
          out.push('\t// Methods');
          for (let i = ty.method_start; i < ty.method_start + ty.method_count; i++) {
            const m = t.methods[i];
            const acc = { private: 'private ', fam_and_assem: 'internal ', assembly: 'internal ', family: 'protected ', fam_or_assem: 'protected internal ', public: 'public ' }[m.access] || '';
            const mm = (m.is_static ? 'static ' : '') + (m.is_abstract ? 'abstract ' : m.is_virtual ? 'virtual ' : '');
            out.push('\t' + acc + mm + '/* type#' + m.return_type_raw_index + ' */ ' + m.name + '(' + m.parameters.map(function (p) { return '/* type#' + p.type_raw_index + ' */ ' + p.name; }).join(', ') + '); // MethodIndex: ' + i + ', Token: 0x' + m.token.toString(16).toUpperCase() + (m.slot !== 65535 ? ', Slot: ' + m.slot : ''));
          }
        }
        out.push('}');
      });
    });
    return out.join('\n') + '\n';
  }

  function toReportFields(t) {
    if (!t) return null;
    const c = counts(t) || {};
    return { metadata_tables_status: t.status, metadata_assemblies: c.assemblies === undefined ? 0 : c.assemblies, metadata_images: c.images === undefined ? 0 : c.images, metadata_namespaces: c.namespaces === undefined ? 0 : c.namespaces,
      metadata_types: c.types === undefined ? 0 : c.types, metadata_methods: c.methods === undefined ? 0 : c.methods, metadata_fields: c.fields === undefined ? 0 : c.fields,
      metadata_table_problems: Object.keys(t.problem_counts || {}).reduce(function (a, k) { return a + t.problem_counts[k]; }, 0) };
  }

  NS.MetadataTables = { SCHEMA: SCHEMA, TABLE_VERSIONS: TABLE_VERSIONS, LIMITS: LIMITS, SOURCES: SOURCES, STRUCTS: STRUCTS, CS_CLASS: CS_CLASS, NOT_EXTRACTED: NOT_EXTRACTED,
    layoutOf: layoutOf, parseHeader: parseHeader, planRegions: planRegions, decodeTables: decodeTables, extractTables: extractTables, toDumpCs: toDumpCs, toReportFields: toReportFields };
})(typeof window !== 'undefined' ? window : self);
