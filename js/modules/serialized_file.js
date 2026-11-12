/* serialized_file.js – Phase 5, SUB-PHASE 5.2c: đọc Unity SerializedFile (*.assets, level*, sharedassets*, globalgamemanagers, node của UnityFS).
   Phạm vi: header (v9–22), metadata (type, object table, scripts, externals), thống kê ClassID, trích xuất NGUYÊN BẢN TextAsset (m_Script) và font nhúng trong object Font,
   đọc tên MonoScript và quy MonoBehaviour về tên class script (để biết có TMP_FontAsset/localization hay không). KHÔNG đọc type tree để giải mã MonoBehaviour/ScriptableObject,
   KHÔNG giải mã Texture2D/AudioClip/Sprite, KHÔNG đọc file .resS/.resource, KHÔNG xử lý định dạng trước v9 hoặc type tree kiểu cũ (v<10, v11).
   Bố cục lấy từ kiến thức về AssetStudio/UnityPy (mạng tắt trong phiên viết, KHÔNG đối chiếu được nguồn); fixture tự dựng theo cùng giả định → CHƯA kiểm trên file Unity thật.
   Phụ thuộc call-time (chỉ scan): NS.IpaReader.readEntry, NS.Hash, NS.UnityFS, NS.FontDump.classifyBytes (tùy chọn). Không ném lỗi (trừ CANCELLED). */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};
  const SCHEMA = 'unity_serialized/1';
  const LIMITS = { max_file_bytes: 256 * 1048576, max_head_bytes: 64 * 1048576, max_object_bytes: 64 * 1048576, max_total_extract: 256 * 1048576, max_files: 3000, max_types: 100000, max_objects: 500000,
    max_text_assets: 20000, max_fonts: 500, max_bundles: 200, max_listed: 5000, max_scripts_listed: 5000,
    mono_names: true, max_mono_samples: 5, max_carriers: 1000, max_inventory_files_classes: 40 };
  /* Bảng ClassID → tên (theo ClassIDReference của Unity, viết từ trí nhớ – [HYPOTHESIS], chưa đối chiếu nguồn vì mạng tắt). ID lạ vẫn hiện 'ClassID n'. */
  const CLASS_NAMES = { 1: 'GameObject', 2: 'Component', 3: 'LevelGameManager', 4: 'Transform', 5: 'TimeManager', 6: 'GlobalGameManager', 8: 'Behaviour', 9: 'GameManager', 11: 'AudioManager', 13: 'InputManager',
    18: 'EditorExtension', 19: 'Physics2DSettings', 20: 'Camera', 21: 'Material', 23: 'MeshRenderer', 25: 'Renderer', 27: 'Texture', 28: 'Texture2D', 30: 'GraphicsSettings', 33: 'MeshFilter', 43: 'Mesh', 47: 'QualitySettings',
    48: 'Shader', 49: 'TextAsset', 50: 'Rigidbody2D', 53: 'Collider2D', 54: 'Rigidbody', 55: 'PhysicsManager', 56: 'Collider', 58: 'CircleCollider2D', 60: 'PolygonCollider2D', 61: 'BoxCollider2D', 62: 'PhysicsMaterial2D',
    64: 'MeshCollider', 65: 'BoxCollider', 68: 'EdgeCollider2D', 70: 'CapsuleCollider2D', 72: 'ComputeShader', 74: 'AnimationClip', 78: 'TagManager', 81: 'AudioListener', 82: 'AudioSource', 83: 'AudioClip', 84: 'RenderTexture',
    89: 'Cubemap', 90: 'Avatar', 91: 'AnimatorController', 93: 'RuntimeAnimatorController', 94: 'ScriptMapper', 95: 'Animator', 96: 'TrailRenderer', 98: 'DelayedCallManager', 102: 'TextMesh', 104: 'RenderSettings', 108: 'Light',
    111: 'Animation', 114: 'MonoBehaviour', 115: 'MonoScript', 116: 'MonoManager', 117: 'Texture3D', 120: 'LineRenderer', 124: 'FlareLayer', 128: 'Font', 129: 'PlayerSettings', 130: 'NamedObject', 131: 'GUITexture',
    132: 'GUIText', 133: 'GUIElement', 134: 'PhysicMaterial', 135: 'SphereCollider', 136: 'CapsuleCollider', 137: 'SkinnedMeshRenderer', 141: 'BuildSettings', 142: 'AssetBundle', 147: 'ResourceManager', 150: 'PreloadData',
    152: 'MovieTexture', 156: 'TerrainData', 157: 'LightmapSettings', 158: 'WebCamTexture', 187: 'Texture2DArray', 198: 'ParticleSystem', 199: 'ParticleSystemRenderer', 200: 'ShaderVariantCollection', 205: 'LODGroup',
    206: 'BlendTree', 207: 'Motion', 210: 'SortingGroup', 212: 'SpriteRenderer', 213: 'Sprite', 215: 'ReflectionProbe', 218: 'Terrain', 221: 'AnimatorOverrideController', 222: 'CanvasRenderer', 223: 'Canvas',
    224: 'RectTransform', 225: 'CanvasGroup', 240: 'AudioMixer', 241: 'AudioMixerController', 258: 'LightProbes', 272: 'AudioMixerSnapshot', 273: 'AudioMixerGroup', 290: 'AssetBundleManifest', 300: 'RuntimeInitializeOnLoadManager',
    310: 'UnityConnectSettings', 319: 'AvatarMask', 320: 'PlayableDirector', 328: 'VideoPlayer', 329: 'VideoClip', 331: 'SpriteMask', 363: 'OcclusionCullingData', 1001: 'PrefabInstance',
    156049354: 'Grid', 483693784: 'TilemapRenderer', 687078895: 'SpriteAtlas', 1839735485: 'Tilemap', 1953259897: 'TerrainLayer' };
  const NOT_DONE = ['giải mã MonoBehaviour/ScriptableObject (cần type tree hoặc DLL); chỉ đếm theo tên class script', 'TMP_FontAsset (atlas, bảng ký tự)', 'Texture2D, Sprite, SpriteAtlas, AudioClip', 'file .resS/.resource (dữ liệu streaming)',
    'SerializedFile trước v9, type tree kiểu cũ (v<10, v11)', 'font Unity nằm ngoài object Font (ví dụ dữ liệu streaming) và TMP'];

  class SfError extends Error { constructor(code, msg) { super(msg); this.name = 'SfError'; this.code = code; } }
  function className(id) { return CLASS_NAMES[id] || ('ClassID ' + id); }
  function utf8(u8, fatal) { return new TextDecoder('utf-8', { fatal: !!fatal }).decode(u8); }
  function validUtf8(u8) { try { utf8(u8, true); return true; } catch (e) { return false; } }

  /** Bộ đọc có kiểm tra biên; p là vị trí tuyệt đối trong b. */
  function Reader(b, p, le) { this.b = b; this.p = p; this.le = le; }
  Reader.prototype.need = function (n) { if (n < 0 || this.p + n > this.b.length) throw new SfError('TRUNC', 'Hết dữ liệu tại ' + this.p + ' (cần ' + n + ')'); };
  Reader.prototype.u8 = function () { this.need(1); return this.b[this.p++]; };
  Reader.prototype.u16 = function () { this.need(2); const b = this.b, p = this.p; this.p += 2; return this.le ? (b[p] | (b[p + 1] << 8)) : ((b[p] << 8) | b[p + 1]); };
  Reader.prototype.i16 = function () { const v = this.u16(); return v & 0x8000 ? v - 0x10000 : v; };
  Reader.prototype.u32 = function () { this.need(4); const b = this.b, p = this.p; this.p += 4; return (this.le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3])) >>> 0; };
  Reader.prototype.i32 = function () { return this.u32() | 0; };
  Reader.prototype.i64 = function () {
    const a = this.u32(), c = this.u32(), lo = this.le ? a : c, hi = (this.le ? c : a) | 0;
    if (hi < 0 || hi > 0x1FFFFF) throw new SfError('BAD_INT64', 'Số 64-bit âm/quá lớn tại ' + (this.p - 8));
    return hi * 4294967296 + lo;
  };
  Reader.prototype.skip = function (n) { this.need(n); this.p += n; };
  Reader.prototype.bytes = function (n) { this.need(n); const r = this.b.subarray(this.p, this.p + n); this.p += n; return r; };
  Reader.prototype.align4 = function () { this.p = (this.p + 3) & ~3; };
  Reader.prototype.cstr = function (max) {
    let i = this.p; const end = Math.min(this.b.length, this.p + (max || 4096));
    while (i < end && this.b[i] !== 0) i++;
    if (i >= end) throw new SfError('BAD_STRING', 'Chuỗi không kết thúc tại ' + this.p);
    const s = utf8(this.b.subarray(this.p, i)); this.p = i + 1; return s;
  };
  Reader.prototype.hex = function (n) { const u = this.bytes(n); let s = ''; for (let i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16); return s; };

  function u32be(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

  function readType(r, v, tree, isRef) {
    const t = { class_id: r.i32(), is_stripped: false, script_type_index: -1, script_id: null };
    if (v >= 16) t.is_stripped = r.u8() !== 0;
    if (v >= 17) t.script_type_index = r.i16();
    if (v >= 13) {
      if ((isRef && t.script_type_index >= 0) || (v < 16 && t.class_id < 0) || (v >= 16 && t.class_id === 114)) t.script_id = r.hex(16);
      r.skip(16);                                                 // oldTypeHash
    }
    if (tree) {
      if (!(v >= 12 || v === 10)) throw new SfError('OLD_TYPETREE', 'Type tree kiểu cũ (version ' + v + ') chưa hỗ trợ');
      const n = r.i32(), sb = r.i32();
      if (n < 0 || n > 100000 || sb < 0 || sb > 16 * 1048576) throw new SfError('BAD_TYPETREE', 'Type tree có số nút/chuỗi bất thường');
      r.skip(n * (v >= 19 ? 32 : 24) + sb);
      if (v >= 21) { if (isRef) { r.cstr(); r.cstr(); r.cstr(); } else { const dc = r.i32(); if (dc < 0 || dc > 100000) throw new SfError('BAD_TYPETREE', 'typeDependencies bất thường'); r.skip(dc * 4); } }
    }
    return t;
  }

  /** THUẦN, không ném lỗi. b = ≥ data_offset byte đầu (hoặc cả file). @returns SerializedInfo */
  function parse(b, fileSize) {
    const res = { schema: 'serialized_file/1', status: 'invalid', reason: '', header: null, unity_version: null, target_platform: null, enable_type_tree: null, types: [], objects: [], scripts: [], externals: [], problems: [], class_counts: {}, class_bytes: {}, need: null };
    try {
      if (!(b instanceof Uint8Array)) b = new Uint8Array(0);
      fileSize = fileSize == null ? b.length : fileSize;
      if (b.length < 20) { res.status = 'not_serialized'; res.reason = 'Quá ngắn (' + b.length + ' byte) để là SerializedFile'; return res; }
      const v = u32be(b, 8); let metaSize = u32be(b, 0), fsz = u32be(b, 4), dataOff = u32be(b, 12);
      if (v < 9 || v > 22) { res.status = v >= 1 && v <= 64 ? 'unsupported_version' : 'not_serialized'; res.reason = 'Version ' + v + ' ngoài dải hỗ trợ 9–22' + (res.status === 'not_serialized' ? ' (không giống SerializedFile)' : ''); return res; }
      const endian = b[16]; if (endian > 1) { res.status = 'not_serialized'; res.reason = 'Byte endian = ' + endian + ' không hợp lệ'; return res; }
      let pos = 20;
      if (v >= 22) {
        if (b.length < 48) { res.status = 'need_more_bytes'; res.need = 48; res.reason = 'Cần 48 byte header'; return res; }
        const rb = new Reader(b, 20, false); metaSize = rb.u32(); fsz = rb.i64(); dataOff = rb.i64(); rb.skip(8); pos = rb.p;
      }
      res.header = { version: v, endian: endian === 0 ? 'little' : 'big', metadata_size: metaSize, file_size: fsz, data_offset: dataOff };
      if (dataOff > fileSize || dataOff < pos) { res.status = 'not_serialized'; res.reason = 'data_offset ' + dataOff + ' ngoài file ' + fileSize + ' (không giống SerializedFile hoặc file cắt cụt)'; return res; }
      if (fsz !== fileSize) res.problems.push('file_size trong header = ' + fsz + ' ≠ kích thước file ' + fileSize);
      if (metaSize > dataOff || pos + metaSize > fileSize) { res.status = 'invalid'; res.reason = 'metadata_size ' + metaSize + ' vô lý so với data_offset/file'; return res; }
      if (b.length < dataOff) { res.status = 'need_more_bytes'; res.need = dataOff; res.reason = 'Cần ' + dataOff + ' byte đầu để đọc metadata'; return res; }
      const r = new Reader(b.subarray(0, dataOff), pos, endian === 0);
      res.unity_version = v >= 7 ? r.cstr(64) : null;
      if (res.unity_version !== null && !/^[\w.\-+]{1,40}$/.test(res.unity_version)) { res.status = 'not_serialized'; res.reason = 'Chuỗi phiên bản Unity không hợp lệ'; return res; }
      res.target_platform = v >= 8 ? r.i32() : null;
      res.enable_type_tree = v >= 13 ? r.u8() !== 0 : true;
      const tc = r.i32(); if (tc < 0 || tc > LIMITS.max_types) { res.status = 'invalid'; res.reason = 'Số type ' + tc + ' bất thường'; return res; }
      for (let i = 0; i < tc; i++) { const t = readType(r, v, res.enable_type_tree, false); t.index = i; t.class_name = className(t.class_id); res.types.push(t); }
      let big = false; if (v >= 7 && v < 14) big = r.i32() !== 0;
      const oc = r.i32(); if (oc < 0 || oc > LIMITS.max_objects) { res.status = 'invalid'; res.reason = 'Số object ' + oc + ' bất thường'; return res; }
      for (let i = 0; i < oc; i++) {
        let pid; if (big) pid = r.i64(); else if (v < 14) pid = r.i32(); else { r.align4(); pid = r.i64(); }
        const bs = (v >= 22 ? r.i64() : r.u32()) + dataOff, size = r.u32(), tid = r.i32(); let cid, sti = -1;
        if (v < 16) cid = r.u16(); else { const t = res.types[tid]; if (!t) { res.problems.push('Object #' + i + ' có typeID ' + tid + ' ngoài bảng type'); cid = -1; } else cid = t.class_id; }
        if (v < 11) r.u16();
        if (v >= 11 && v < 17) sti = r.i16();
        if (v === 15 || v === 16) r.u8();
        const o = { index: i, path_id: pid, byte_start: bs, byte_size: size, type_index: tid, class_id: cid, class_name: className(cid), script_type_index: sti, in_range: bs + size <= fileSize };
        if (!o.in_range) res.problems.push('Object #' + i + ' (path_id ' + pid + ') [' + bs + ', +' + size + ') vượt file ' + fileSize);
        res.objects.push(o); res.class_counts[o.class_name] = (res.class_counts[o.class_name] || 0) + 1; res.class_bytes[o.class_name] = (res.class_bytes[o.class_name] || 0) + size;
      }
      res.status = 'parsed'; res.reason = 'Đã đọc ' + tc + ' type, ' + oc + ' object (CHƯA giải mã nội dung object)';
      try {                                                        // phần đuôi: lỗi chỉ thành vấn đề, bảng object vẫn dùng được
        if (v >= 11) { const sc = r.i32(); if (sc < 0 || sc > 1000000) throw new SfError('BAD', 'Số script bất thường');
          for (let i = 0; i < sc; i++) { const fi = r.i32(); let pid; if (v < 14) pid = r.i32(); else { r.align4(); pid = r.i64(); } res.scripts.push({ file_index: fi, path_id: pid }); } }
        const ec = r.i32(); if (ec < 0 || ec > 100000) throw new SfError('BAD', 'Số external bất thường');
        for (let i = 0; i < ec; i++) { if (v >= 6) r.cstr(); const guid = r.hex(16); const ty = r.i32(); const p = r.cstr(); res.externals.push({ path: p, guid: guid, type: ty }); }
        if (v >= 20) { const rc = r.i32(); if (rc < 0 || rc > 100000) throw new SfError('BAD', 'Số refType bất thường'); for (let i = 0; i < rc; i++) readType(r, v, res.enable_type_tree, true); }
        if (v >= 5) r.cstr();
      } catch (e) { res.problems.push('Phần scripts/externals đọc lỗi: ' + e.message + ' (liên kết MonoBehaviour→script có thể thiếu)'); }
      return res;
    } catch (e) {
      res.status = e && e.code === 'OLD_TYPETREE' ? 'unsupported_typetree' : e && e.code === 'TRUNC' ? 'truncated' : 'invalid';
      res.reason = 'Lỗi đọc metadata: ' + ((e && e.message) || e); return res;
    }
  }

  function readObject(b, info, i) {
    const o = info && info.objects[i]; if (!o) throw new SfError('NO_OBJECT', 'Không có object #' + i);
    if (!o.in_range || o.byte_start + o.byte_size > b.length) throw new SfError('RANGE', 'Object #' + i + ' vượt dữ liệu đã có');
    return b.subarray(o.byte_start, o.byte_start + o.byte_size);
  }

  function readAlignedString(r) { const n = r.i32(); if (n < 0 || n > r.b.length - r.p) throw new SfError('BAD_STRING', 'Độ dài chuỗi ' + n + ' vô lý'); const u = r.bytes(n); r.align4(); return u; }

  /** TextAsset: m_Name, m_Script (chuỗi căn 4). @returns {ok, name, script:Uint8Array, problem?} */
  function decodeTextAsset(ob, le) {
    let name = '';
    try { const r = new Reader(ob, 0, le); name = utf8(readAlignedString(r)); const sc = readAlignedString(r); return { ok: true, name: name, script: sc }; }
    catch (e) { return { ok: false, name: name, script: null, problem: e.message }; }
  }
  /** MonoScript: m_Name, m_ExecutionOrder, m_PropertiesHash(16), m_ClassName, m_Namespace, m_AssemblyName. null nếu không hợp lệ. */
  function decodeMonoScript(ob, le) {
    try {
      const r = new Reader(ob, 0, le), nm = utf8(readAlignedString(r)); r.skip(4 + 16);
      const cn = utf8(readAlignedString(r)), ns = utf8(readAlignedString(r)), asm = utf8(readAlignedString(r)), ok = /^[\w.<>`+\[\],\-]{0,200}$/;
      if (!cn || !ok.test(cn) || !ok.test(ns) || !/^[\w.\-]{0,200}$/.test(asm)) return null;
      return { name: nm, class_name: cn, namespace: ns, assembly: asm };
    } catch (e) { return null; }
  }
  const FONT_MAGICS = [[0, 1, 0, 0], [0x4F, 0x54, 0x54, 0x4F], [0x74, 0x72, 0x75, 0x65], [0x74, 0x74, 0x63, 0x66], [0x77, 0x4F, 0x46, 0x46], [0x77, 0x4F, 0x46, 0x32]];
  /** Object Font: tên (chuỗi đầu) + QUÉT mảng byte có int32 độ dài ngay trước và magic font (TTF/OTF/TTC/WOFF/WOFF2). Heuristic: không dựa bố cục trường của Font.
   Trả blob HỢP LỆ đầu tiên; nếu chỉ có blob không hợp lệ → trả ứng viên đó với rejected=true (người gọi không trích). Dữ liệu thật: font Arial built-in 63 byte là false positive. */
  function objectName(ob, le) { try { return utf8(readAlignedString(new Reader(ob, 0, le))); } catch (e) { return ''; } }
  function findEmbeddedFont(ob, le) {
    const name = objectName(ob, le);
    const FD = NS.FontDump; let first = null;
    for (let i = 4; i + 12 <= ob.length; i++) {
      let m = false; for (let k = 0; k < FONT_MAGICS.length && !m; k++) { const g = FONT_MAGICS[k]; m = ob[i] === g[0] && ob[i + 1] === g[1] && ob[i + 2] === g[2] && ob[i + 3] === g[3]; }
      if (!m) continue;
      const len = le ? ((ob[i - 4] | (ob[i - 3] << 8) | (ob[i - 2] << 16) | (ob[i - 1] << 24)) >>> 0) : u32be(ob, i - 4);
      if (len < 12 || i + len > ob.length) continue;
      const bytes = ob.subarray(i, i + len), ext = ob[i] === 0x4F ? 'otf' : ob[i] === 0x74 && ob[i + 1] === 0x74 ? 'ttc' : ob[i] === 0x77 ? (ob[i + 3] === 0x32 ? 'woff2' : 'woff') : 'ttf';
      const c = FD && FD.classifyBytes ? FD.classifyBytes(bytes, ext) : { valid: null, format: ext.toUpperCase(), problems: ['FontDump không có sẵn để kiểm tra'] };
      const hit = { name: name, offset: i, length: len, ext: ext, format: c.format, valid: c.valid, problems: c.problems || [] };
      if (c.valid !== false) return hit; if (!first) first = hit;                 // valid=null (không có FontDump) vẫn nhận; valid=false thì chỉ ghi nhận ứng viên
    }
    if (first) first.rejected = true;                                              // chỉ có blob không hợp lệ (vd font Arial built-in 63 byte): KHÔNG trích
    return first;
  }

  /** MonoBehaviour: m_GameObject(PPtr) + m_Enabled(u8, căn 4) + m_Script(PPtr) + m_Name. Chỉ đọc m_Name (KHÔNG cần type tree). null nếu bố cục không khớp/chuỗi vô lý. [HYPOTHESIS: bố cục từ trí nhớ] */
  function monoName(ob, le, v) {
    try {
      const pp = v >= 14 ? 12 : 8, r = new Reader(ob, 0, le); r.skip(pp + 4 + pp);
      const n = r.i32(); if (n < 0 || n > 256 || n > ob.length - r.p) return null;
      const s = utf8(r.bytes(n), true); return /^[^\u0000-\u001f\u007f]*$/.test(s) ? s : null;
    } catch (e) { return null; }
  }
  /* Đoán dạng nội dung TextAsset (chỉ để xếp hạng, KHÔNG phải bằng chứng): đọc ≤ 4 KB đầu. */
  function sniffText(u8) {
    let t; try { t = utf8(u8.subarray(0, 4096), false); } catch (e) { return 'unknown'; }
    t = t.replace(/^﻿/, ''); const tt = t.trim(); if (!tt) return 'empty';
    if (/^\s*\[[^\]\n"{,]+\]\s*$/m.test(tt) && /^\s*[\w.\-]+\s*=/m.test(tt) && !/^[{]/.test(tt)) return 'ini';
    if (/^[\[{]/.test(tt)) return 'json';
    if (/^<\?xml|^<[A-Za-z!]/.test(tt)) return 'xml';
    const lines = tt.split(/\r?\n/).filter(function (x) { return x.trim(); }).slice(0, 12);
    if (lines.length >= 2) {
      for (const sep of [',', '\t', ';', '|']) { const c = lines[0].split(sep).length - 1; if (c >= 1 && lines.every(function (l) { return l.split(sep).length - 1 === c; })) return sep === '\t' ? 'tsv' : 'csv'; }
    }
    if (/^\s*\[[^\]\n]+\]\s*$/m.test(tt) && /^\s*[\w.\-]+\s*=/m.test(tt)) return 'ini';
    if (/^[A-Za-z0-9+\/=\s]{80,}$/.test(tt)) return 'base64?';
    if (/\b(function|local|end)\b/.test(tt) && /\b(local|return)\b/.test(tt)) return 'lua?';
    return 'plain';
  }
  function previewOf(u8) { try { return utf8(u8.subarray(0, 240), false).replace(/^﻿/, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); } catch (e) { return ''; } }
  /* Tên/lớp gợi ý nơi chứa text hiển thị. CHỈ gợi ý theo tên → luôn là [HYPOTHESIS], không dùng làm kết luận. */
  const NAME_LOC_RE = /(^|[_\-. ])(loc|l10n|i18n|lang|language|locale|string|strings|text|texts|dialog|dialogue|subtitle|subtitles|translation|translations|caption|captions|message|messages|story|script|quest|item_?name|ui_?text)([_\-. ]|$)|^(en|vi|ja|ko|zh|fr|de|es|pt|ru|it|th|id|tr|ar)([_\-.]|$)|(_|-)(en|vi|ja|ko|zh|fr|de|es|pt|ru|it|th|id|tr|ar|en-us|zh-cn|zh-tw|pt-br)$/i;
  const SCRIPT_TABLE_RE = /(I2|LanguageSource|LanguageData|LocalizationManager|LocalizationSettings|LocalizedString|LocalizedAsset|LocalizeStringEvent|StringTable|StringTableCollection|SharedTableData|AssetTable|Localize(r)?$|Localisation|Translat|Dialog(ue)?(Database|Table|Data|Asset|Container)|TextDatabase|StringDatabase)/i;
  const SCRIPT_UI_TEXT_RE = /(^|\.)(TextMeshProUGUI|TextMeshPro|TMP_Text|TMP_InputField|TMP_Dropdown|Text|InputField|Dropdown)$/;
  const SCRIPT_FONT_RE = /(^|\.)TMP_FontAsset$/;

  /* ---------- Quét trong IPA ---------- */
  function baseOf(p) { return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1); }
  function isSerializedName(n) {
    n = n.toLowerCase();
    return /^globalgamemanagers(\.assets)?$/.test(n) || /^level\d+$/.test(n) || /^sharedassets\d+\.assets$/.test(n) || /\.assets$/.test(n) || n === 'maindata' || n === 'unity default resources' || n === 'unity_builtin_extra';
  }
  function selectCandidates(entries, rootPath) {
    const out = [];
    (entries || []).forEach(function (e) {
      if (!e || e.dir || e.name.indexOf(rootPath || '\u0000') !== 0 && rootPath) return;
      const rel = rootPath ? e.name.slice(rootPath.length) : e.name;
      if (isSerializedName(baseOf(rel)) && !/\.(resS|resource)$/i.test(rel)) out.push({ entry: e, rel: rel });
    });
    return out;
  }
  function safeSeg(s, max) { s = String(s).replace(/[^A-Za-z0-9._\-]+/g, '_').replace(/^\.+/, '_'); return (s || 'unnamed').slice(0, max || 80); }
  function sha256(u8) { const h = NS.Hash.create('sha256'); h.update(u8); return h.hex(); }

  function baseResult() {
    return { schema: SCHEMA, sub_phase: '5.2c', status: 'not_run', reason: '', files: [], text_assets: [], fonts: [], mono_scripts: [], mono_classes: {}, mono_detail: {}, inventory: null, summary: null, limits: Object.assign({}, LIMITS), limitations: NOT_DONE.slice(), warnings: [], source: {} };
  }

  /** Quét mọi SerializedFile (file rời + node SerializedFile của UnityFS). Trả {serialized:Result (JSON thuần), files:{'Text/text_assets/…'|'Fonts/unity/…': Uint8Array}}. Chỉ ném CANCELLED. */
  async function scan(file, ipa, entries, hooks) {
    hooks = hooks || {}; const IR = NS.IpaReader, UF = NS.UnityFS, cancelled = hooks.isCancelled || function () { return false; }, res = baseResult(), out = {};
    try {
      if (!ipa || !Array.isArray(entries) || !IR || !NS.Hash) { res.reason = 'Thiếu dữ liệu IPA/entries/Hash'; return { serialized: res, files: out }; }
      const ctx = { scripts: new Map(), total: 0, mbRefs: [] };
      let cands = selectCandidates(entries, ipa.appRoot || '');
      res.source = { candidates_by_name: cands.length, bundle_nodes: 0 };
      if (cands.length > LIMITS.max_files) { res.warnings.push('Có ' + cands.length + ' ứng viên, chỉ xử lý ' + LIMITS.max_files + ' đầu tiên.'); cands = cands.slice(0, LIMITS.max_files); }
      const work = cands.map(function (c) { return { kind: 'file', rel: c.rel, entry: c.entry, size: c.entry.size }; });
      const bundleItems = (ipa.unityfs && ipa.unityfs.items || []).filter(function (it) { return it.status === 'parsed' && it.nodes.some(function (n) { return n.is_serialized && !n.unsafe_path; }); }).slice(0, LIMITS.max_bundles);
      const zipByName = new Map(); entries.forEach(function (e) { zipByName.set(e.name, e); });
      let done = 0; const total = work.length + bundleItems.length;
      const tick = function () { done++; if (hooks.progress) hooks.progress(total ? done / total : 1); };

      for (const w of work) {
        if (cancelled()) throw new SfError('CANCELLED', 'Đã hủy');
        const it = newItem(res, w.rel, w.entry.name, 'file', w.size);
        try { await processEntryFile(file, w, it, ctx, res, out, IR); } catch (e) { if (e && e.code === 'CANCELLED') throw e; it.status = 'read_error'; it.reason = 'Không đọc được: ' + ((e && e.message) || e); }
        tick();
      }
      if (bundleItems.length && !UF) res.warnings.push('Thiếu NS.UnityFS: bỏ qua node SerializedFile trong bundle.');
      else for (const bi of bundleItems) {
        if (cancelled()) throw new SfError('CANCELLED', 'Đã hủy');
        const ent = zipByName.get(bi.zip_path);
        try {
          if (!ent || ent.size > LIMITS.max_file_bytes) { res.warnings.push('Bundle ' + bi.path + ' ' + (ent ? 'quá lớn để đọc (' + ent.size + ' byte)' : 'không tìm thấy entry') + '; bỏ qua node.'); tick(); continue; }
          const bytes = (await IR.readEntry(file, ent, { max: LIMITS.max_file_bytes })).data, bundle = UF.open(bytes, ent.size);
          if (bundle.status !== 'parsed') { res.warnings.push('Bundle ' + bi.path + ': mở lại thất bại (' + bundle.status + ')'); tick(); continue; }
          for (const nd of bundle.nodes) {
            if (!nd.is_serialized || nd.unsafe_path) continue; if (cancelled()) throw new SfError('CANCELLED', 'Đã hủy');
            res.source.bundle_nodes++; const it = newItem(res, bi.path + '!' + nd.path, bi.zip_path, 'bundle_node', nd.size); it.bundle = bi.path; it.node = nd.path;
            try { const nb = await UF.readNode(bytes, bundle, nd.index, { isCancelled: cancelled }); processBytes(nb, it, ctx, res, out, nd.path, true); }
            catch (e) { if (e && e.code === 'CANCELLED') throw e; it.status = 'read_error'; it.reason = 'Giải nén node thất bại: ' + ((e && e.message) || e); }
          }
        } catch (e) { if (e && e.code === 'CANCELLED') throw e; res.warnings.push('Bundle ' + bi.path + ': ' + ((e && e.message) || e)); }
        tick();
      }
      /* Quy MonoBehaviour → tên class script (đã có đủ MonoScript của mọi file) */
      const classes = {}, detail = {}; let unresolved = 0, resolved = 0;
      ctx.mbRefs.forEach(function (m) {
        m.refs.forEach(function (cnt, key) {
          const sc = ctx.scripts.get(key), nm = sc ? (sc.namespace ? sc.namespace + '.' : '') + sc.class_name : null;
          if (sc && sc.class_name === 'TMP_FontAsset' && m.objs.get(key)) { m.item.tmp_font_assets = (m.item.tmp_font_assets || []).concat(m.objs.get(key)).slice(0, 5000); }
          const dn = nm || '(không xác định)', dd = detail[dn] || (detail[dn] = { count: 0, bytes: 0, files: 0, samples: [] }); dd.count += cnt; dd.bytes += m.szs.get(key) || 0; dd.files++;
          (m.names.get(key) || []).forEach(function (x) { if (dd.samples.length < LIMITS.max_mono_samples && dd.samples.indexOf(x) < 0) dd.samples.push(x); });
          if (nm) { classes[nm] = (classes[nm] || 0) + cnt; resolved += cnt; m.item.monobehaviours[nm] = (m.item.monobehaviours[nm] || 0) + cnt; } else { unresolved += cnt; m.item.monobehaviours['(không xác định)'] = (m.item.monobehaviours['(không xác định)'] || 0) + cnt; }
        });
      });
      res.mono_classes = classes; res.mono_unresolved = unresolved; res.mono_detail = detail;
      res.mono_scripts = Array.from(ctx.scripts.entries()).slice(0, LIMITS.max_scripts_listed).map(function (kv) { return Object.assign({ key: kv[0] }, kv[1]); });
      res.summary = summarize(res, resolved, unresolved);
      res.inventory = buildInventory(res);
      const s = res.summary; res.status = s.files === 0 ? 'no_serialized' : s.parsed === s.files ? 'ok' : s.parsed ? 'partial' : 'none_parsed';
      res.reason = s.parsed + '/' + s.files + ' SerializedFile đọc được; ' + s.objects + ' object; TextAsset trích xuất ' + s.text_assets_extracted + '; font ' + s.fonts_extracted + '; MonoBehaviour ' + resolved + ' đã quy về class';
    } catch (e) { if (e && e.code === 'CANCELLED') throw e; res.status = 'error'; res.reason = 'Lỗi không mong đợi: ' + ((e && e.message) || e); }
    return { serialized: res, files: out };
  }

  function newItem(res, rel, zipPath, source, size) {
    const it = { id: res.files.length, path: rel, zip_path: zipPath, source: source, size: size, status: 'read_error', reason: '', version: null, unity_version: null, endian: null, target_platform: null, enable_type_tree: null,
      type_count: null, object_count: null, classes: {}, class_bytes: {}, externals: [], script_count: null, monobehaviours: {}, extraction: 'not_needed', problems: [] };
    res.files.push(it); return it;
  }

  async function processEntryFile(file, w, it, ctx, res, out, IR) {
    const head = (await IR.readEntry(file, w.entry, { max: Math.min(4096, Math.max(w.size, 1)), head: true })).data;
    let info = parse(head, w.size), bytes = head;
    if (info.status === 'need_more_bytes') {
      if (info.need > LIMITS.max_head_bytes) { it.status = 'too_large'; it.reason = 'Metadata ' + info.need + ' byte vượt giới hạn'; return; }
      bytes = (await IR.readEntry(file, w.entry, { max: info.need, head: true })).data; info = parse(bytes, w.size);
    }
    if (info.status !== 'parsed') { fillFail(it, info); return; }
    const needsFullBase = info.objects.some(function (o) { return o.class_id === 49 || o.class_id === 128 || o.class_id === 115; });
    const needsNames = LIMITS.mono_names && info.objects.some(function (o) { return o.class_id === 114; });
    const needsFull = needsFullBase || needsNames;
    if (needsFull) {
      if (w.size > LIMITS.max_file_bytes) { fillInfo(it, info, ctx, res, w.rel); it.extraction = 'too_large'; it.problems.push('File ' + w.size + ' byte > ' + LIMITS.max_file_bytes + (needsFullBase ? ': không đọc đủ, TextAsset/Font/MonoScript trong file này chưa được xử lý' : ': không đọc đủ nên chưa lấy tên MonoBehaviour (chỉ ảnh hưởng mẫu tên)')); return; }
      bytes = (await IR.readEntry(file, w.entry, { max: LIMITS.max_file_bytes })).data;
    }
    processBytes(bytes, it, ctx, res, out, w.rel, needsFull, info);
  }

  function fillFail(it, info) { it.status = info.status; it.reason = info.reason; if (info.header) it.version = info.header.version; it.problems = info.problems.slice(); }
  function fillInfo(it, info, ctx, res, srcKey) {
    it.status = 'parsed'; it.reason = info.reason; it.version = info.header.version; it.endian = info.header.endian; it.unity_version = info.unity_version; it.target_platform = info.target_platform; it.enable_type_tree = info.enable_type_tree;
    it.type_count = info.types.length; it.object_count = info.objects.length; it.classes = info.class_counts; it.class_bytes = info.class_bytes; it.externals = info.externals.map(function (e) { return e.path; }); it.script_count = info.scripts.length; it.problems = info.problems.slice();
    const key = baseOf(srcKey).toLowerCase(), refs = new Map(), objs = new Map(), szs = new Map();
    info.objects.forEach(function (o) {
      if (o.class_id !== 114) return;
      const idx = info.header.version >= 17 ? (info.types[o.type_index] ? info.types[o.type_index].script_type_index : -1) : o.script_type_index, sc = idx >= 0 ? info.scripts[idx] : null;
      let k = 'unknown#' + o.index;
      if (sc && sc.path_id !== 0) { const fk = sc.file_index === 0 ? key : (info.externals[sc.file_index - 1] ? baseOf(info.externals[sc.file_index - 1].path).toLowerCase() : '?'); k = fk + '#' + sc.path_id; }
      refs.set(k, (refs.get(k) || 0) + 1); szs.set(k, (szs.get(k) || 0) + o.byte_size);
      if (!objs.has(k)) objs.set(k, []); objs.get(k).push(o.index);   // chỉ số object theo script (5.2d dùng để tìm TMP_FontAsset)
    });
    if (refs.size) ctx.mbRefs.push({ item: it, refs: refs, objs: objs, szs: szs, names: new Map(), info: info });
  }

  function processBytes(bytes, it, ctx, res, out, srcKey, full, info0) {
    const info = info0 || parse(bytes, bytes.length);
    if (info.status !== 'parsed') { fillFail(it, info); return; }
    fillInfo(it, info, ctx, res, srcKey);
    if (!full) return;
    const le = info.header.endian === 'little', key = baseOf(srcKey).toLowerCase(), srcDir = safeSeg(it.path, 100); it.extraction = 'done';
    let ta = 0, fo = 0, errs = 0;
    if (LIMITS.mono_names) {                                       // tên MonoBehaviour (mẫu ≤ max_mono_samples/loại script) – nhờ đó nhận ra ScriptableObject kiểu "I2Languages", "Localization_en"
      const mr = ctx.mbRefs.length && ctx.mbRefs[ctx.mbRefs.length - 1].item === it ? ctx.mbRefs[ctx.mbRefs.length - 1] : null;
      if (mr) mr.objs.forEach(function (idxs, k) {
        const got = []; for (let q = 0; q < idxs.length && got.length < LIMITS.max_mono_samples; q++) { const o = info.objects[idxs[q]]; if (!o || !o.in_range || o.byte_start + o.byte_size > bytes.length || o.byte_size > LIMITS.max_object_bytes) continue; const nm = monoName(bytes.subarray(o.byte_start, o.byte_start + o.byte_size), le, info.header.version); if (nm) got.push(nm); }
        if (got.length) mr.names.set(k, got);
      });
    }
    for (const o of info.objects) {
      if (o.class_id !== 49 && o.class_id !== 128 && o.class_id !== 115) continue;
      if (!o.in_range || o.byte_start + o.byte_size > bytes.length) { errs++; continue; }
      const ob = bytes.subarray(o.byte_start, o.byte_start + o.byte_size);
      if (o.class_id === 115) { const ms = decodeMonoScript(ob, le); if (ms) ctx.scripts.set(key + '#' + o.path_id, ms); continue; }
      if (o.byte_size > LIMITS.max_object_bytes) { it.problems.push('Object #' + o.index + ' ' + o.class_name + ' ' + o.byte_size + ' byte > giới hạn, bỏ qua'); continue; }
      if (o.class_id === 49) {
        if (res.text_assets.length >= LIMITS.max_text_assets) { if (!res._ta_cap) { res.warnings.push('Quá ' + LIMITS.max_text_assets + ' TextAsset, bỏ phần còn lại'); res._ta_cap = 1; } continue; }
        const d = decodeTextAsset(ob, le), rec = { id: res.text_assets.length, file_id: it.id, source: it.path, path_id: o.path_id, name: d.name, size: d.script ? d.script.length : 0, is_text: null, extraction_status: 'failed', extracted_path: null, sha256: null, problem: d.problem || null };
        if (d.ok) {
          if (ctx.total + d.script.length > LIMITS.max_total_extract) { rec.extraction_status = 'skipped_budget'; }
          else {
            rec.is_text = validUtf8(d.script); if (rec.is_text) { rec.looks_like = sniffText(d.script); rec.preview = previewOf(d.script); } rec.name_hint = NAME_LOC_RE.test(d.name || ''); const p = 'Text/text_assets/' + srcDir + '/' + safeSeg(d.name) + '_' + o.path_id + (rec.is_text ? '.txt' : '.bin');
            out[p] = d.script.slice(); ctx.total += d.script.length; rec.extracted_path = p; rec.sha256 = sha256(d.script); rec.extraction_status = 'extracted'; ta++;
          }
        } else errs++;
        res.text_assets.push(rec);
      } else {
        if (res.fonts.length >= LIMITS.max_fonts) continue;
        const f = findEmbeddedFont(ob, le), rec = { id: res.fonts.length, file_id: it.id, source: it.path, path_id: o.path_id, name: f ? f.name : objectName(ob, le), size: f ? f.length : 0, format: f ? f.format : null, valid: f ? f.valid : null, problems: f ? f.problems : [], extraction_status: 'no_embedded_font_found', extracted_path: null, sha256: null };
        if (f && f.rejected) rec.extraction_status = 'rejected_invalid_candidate';
        else if (f) {
          if (ctx.total + f.length > LIMITS.max_total_extract) rec.extraction_status = 'skipped_budget';
          else { const p = 'Fonts/unity/' + srcDir + '/' + safeSeg(f.name || 'font') + '_' + o.path_id + '.' + f.ext; const fb = ob.slice(f.offset, f.offset + f.length); out[p] = fb; ctx.total += f.length; rec.extracted_path = p; rec.sha256 = sha256(fb); rec.extraction_status = 'extracted'; fo++; }
        }
        res.fonts.push(rec);
      }
    }
    if (errs) it.problems.push(errs + ' object TextAsset/Font/MonoScript không đọc được hoặc ngoài dữ liệu');
    it.extracted = { text_assets: ta, fonts: fo };
  }

  function summarize(res, resolved, unresolved) {
    const s = { files: res.files.length, parsed: 0, objects: 0, by_status: {}, by_class: {}, by_class_bytes: {}, versions: {}, unity_versions: [], text_assets: res.text_assets.length, text_assets_extracted: 0, text_assets_text: 0, fonts: res.fonts.length, fonts_extracted: 0, fonts_valid: 0,
      mono_scripts: res.mono_scripts.length, monobehaviours_resolved: resolved, monobehaviours_unresolved: unresolved, extracted_bytes: 0 }, uv = {};
    res.files.forEach(function (f) {
      s.by_status[f.status] = (s.by_status[f.status] || 0) + 1;
      if (f.status === 'parsed') { s.parsed++; s.objects += f.object_count; Object.keys(f.classes).forEach(function (k) { s.by_class[k] = (s.by_class[k] || 0) + f.classes[k]; s.by_class_bytes[k] = (s.by_class_bytes[k] || 0) + ((f.class_bytes && f.class_bytes[k]) || 0); }); s.versions['v' + f.version] = (s.versions['v' + f.version] || 0) + 1; if (f.unity_version) uv[f.unity_version] = 1; }
    });
    res.text_assets.forEach(function (t) { if (t.extraction_status === 'extracted') { s.text_assets_extracted++; s.extracted_bytes += t.size; if (t.is_text) s.text_assets_text++; } });
    res.fonts.forEach(function (t) { if (t.extraction_status === 'extracted') { s.fonts_extracted++; s.extracted_bytes += t.size; if (t.valid === true) s.fonts_valid++; } });
    s.fonts_rejected = res.fonts.filter(function (t) { return t.extraction_status === 'rejected_invalid_candidate'; }).length;
    s.unity_versions = Object.keys(uv).sort(); return s;
  }


  /* ---------- Kiểm kê object theo loại + danh sách "nơi có thể chứa text hiển thị" ----------
     THUẦN (đọc res đã quét, không I/O). Mọi dòng carriers là GỢI Ý theo tên class/tên object/dạng nội dung: [HYPOTHESIS], không phải bằng chứng text nào được game hiển thị
     (cần giải mã MonoBehaviour bằng type tree/DLL – chưa làm – và đối chiếu runtime). */
  const ID_BY_NAME = {}; Object.keys(CLASS_NAMES).forEach(function (k) { ID_BY_NAME[CLASS_NAMES[k]] = Number(k); });
  function classIdOf(name) { if (ID_BY_NAME[name] !== undefined) return ID_BY_NAME[name]; const m = /^ClassID (-?\d+)$/.exec(name); return m ? Number(m[1]) : null; }

  function buildInventory(res) {
    const inv = { schema: 'unity_inventory/1', evidence: 'HYPOTHESIS (logic-only, fixture giả lập)', classes: [], files: [], carriers: [], carriers_truncated: false, notes: [] };
    if (!res || !Array.isArray(res.files)) return inv;
    const byClass = {}, parsed = res.files.filter(function (f) { return f.status === 'parsed'; });
    parsed.forEach(function (f) {
      const names = Object.keys(f.classes || {}), fc = [];
      names.forEach(function (k) {
        const c = byClass[k] || (byClass[k] = { class_id: classIdOf(k), class_name: k, count: 0, bytes: 0, files: 0 });
        const b = (f.class_bytes && f.class_bytes[k]) || 0; c.count += f.classes[k]; c.bytes += b; c.files++; fc.push({ name: k, count: f.classes[k], bytes: b });
      });
      fc.sort(function (a, b) { return b.bytes - a.bytes || b.count - a.count; });
      inv.files.push({ path: f.path, source: f.source, version: f.version, unity_version: f.unity_version, objects: f.object_count, bytes: fc.reduce(function (t, x) { return t + x.bytes; }, 0), classes: fc.slice(0, LIMITS.max_inventory_files_classes), classes_truncated: fc.length > LIMITS.max_inventory_files_classes });
    });
    inv.classes = Object.keys(byClass).map(function (k) { return byClass[k]; }).sort(function (a, b) { return b.count - a.count || b.bytes - a.bytes; });
    inv.files.sort(function (a, b) { return b.bytes - a.bytes; });

    const car = [], add = function (c) { car.push(c); };
    const detail = res.mono_detail || {};
    parsed.forEach(function (f) {
      Object.keys(f.monobehaviours || {}).forEach(function (cn) {
        const n = f.monobehaviours[cn], samples = detail[cn] ? detail[cn].samples : [];
        if (SCRIPT_FONT_RE.test(cn)) add({ kind: 'font_asset', file: f.path, label: cn, count: n, bytes: null, score: 30, evidence: 'CLASS_NAME', sample_names: samples, why: 'TMP_FontAsset: không chứa text nhưng quyết định font/atlas hiển thị (cần cho chữ Việt).' });
        else if (SCRIPT_TABLE_RE.test(cn)) add({ kind: 'localization_script', file: f.path, label: cn, count: n, bytes: null, score: 90, evidence: 'CLASS_NAME', sample_names: samples, why: 'Tên class script giống bảng localization (I2/StringTable/…). Nội dung bảng nằm trong dữ liệu MonoBehaviour, CHƯA giải mã.' });
        else if (SCRIPT_UI_TEXT_RE.test(cn)) add({ kind: 'ui_text_component', file: f.path, label: cn, count: n, bytes: null, score: 40, evidence: 'CLASS_NAME', sample_names: [], why: 'Thành phần UI hiển thị text trong scene/prefab; chuỗi nằm trong m_text của component (CHƯA giải mã) và có thể bị script localization ghi đè lúc chạy.' });
      });
      ['TextMesh', 'GUIText'].forEach(function (cn) { if (f.classes && f.classes[cn]) add({ kind: 'legacy_text_component', file: f.path, label: cn, count: f.classes[cn], bytes: (f.class_bytes && f.class_bytes[cn]) || null, score: 35, evidence: 'CLASS_ID', sample_names: [], why: 'Thành phần text cũ của Unity; chuỗi nằm trong object (CHƯA giải mã).' }); });
      if (f.classes && f.classes.Font) add({ kind: 'font', file: f.path, label: 'Font', count: f.classes.Font, bytes: (f.class_bytes && f.class_bytes.Font) || null, score: 30, evidence: 'CLASS_ID', sample_names: [], why: 'Object Font (xem danh sách font đã trích để biết có TTF/OTF nhúng và độ phủ chữ Việt).' });
    });
    const taBy = {};
    (res.text_assets || []).forEach(function (t) { (taBy[t.source] || (taBy[t.source] = [])).push(t); });
    Object.keys(taBy).forEach(function (src) {
      const list = taBy[src], texts = list.filter(function (t) { return t.is_text === true; }), hinted = texts.filter(function (t) { return t.name_hint; }), kinds = {};
      texts.forEach(function (t) { if (t.looks_like) kinds[t.looks_like] = (kinds[t.looks_like] || 0) + 1; });
      const top = (hinted.length ? hinted : texts.length ? texts : list).slice().sort(function (a, b) { return b.size - a.size; }).slice(0, 5).map(function (t) { return t.name || '(không tên)'; });
      const score = hinted.length ? 80 : texts.length ? 60 : 20, ev = hinted.length ? 'NAME_HINT + CONTENT_SNIFF' : texts.length ? 'CONTENT_SNIFF' : 'CLASS_ID';
      add({ kind: 'text_asset', file: src, label: 'TextAsset', count: list.length, bytes: list.reduce(function (t, x) { return t + (x.size || 0); }, 0), score: score, evidence: ev, sample_names: top, text_count: texts.length, binary_count: list.filter(function (t) { return t.is_text === false; }).length, name_hint_count: hinted.length, looks_like: kinds,
        why: hinted.length ? hinted.length + ' TextAsset có tên giống bảng text/ngôn ngữ và là UTF-8; đã trích nguyên bản (xem Text/text_assets/).' : texts.length ? texts.length + ' TextAsset là UTF-8 nhưng tên không gợi ý: cần mở xem.' : 'TextAsset nhị phân/không đọc được: có thể nén/mã hóa.' });
    });
    car.sort(function (a, b) { return b.score - a.score || (b.bytes || 0) - (a.bytes || 0) || b.count - a.count; });
    if (car.length > LIMITS.max_carriers) { inv.carriers_truncated = true; car.length = LIMITS.max_carriers; }
    inv.carriers = car;
    inv.notes.push('Xếp hạng chỉ theo tên class/tên object/dạng nội dung (HYPOTHESIS). Chưa giải mã MonoBehaviour nên chưa thấy chuỗi nằm trong component hay bảng ScriptableObject; chưa đọc .resS/.resource.');
    if (!LIMITS.mono_names) inv.notes.push('mono_names tắt: không có tên mẫu của MonoBehaviour.');
    if (!car.length) inv.notes.push('Không thấy ứng viên nào: text có thể nằm ngoài SerializedFile (StreamingAssets, bundle chưa đọc, dữ liệu trong binary IL2CPP).');
    return inv;
  }

  function toIndex(r) { return r ? JSON.parse(JSON.stringify(r)) : null; }
  function toReportFields(r) {
    if (!r || r.status === 'not_run' || !r.summary) return null; const s = r.summary;
    return { serialized_status: r.status, serialized_files: s.files, serialized_parsed: s.parsed, serialized_objects: s.objects, unity_text_assets: s.text_assets_extracted, unity_embedded_fonts: s.fonts_extracted, unity_monobehaviours_resolved: s.monobehaviours_resolved,
      unity_text_carriers: r.inventory ? r.inventory.carriers.length : null };
  }

  NS.SerializedFile = { SCHEMA: SCHEMA, LIMITS: LIMITS, CLASS_NAMES: CLASS_NAMES, NOT_DONE: NOT_DONE, SfError: SfError, parse: parse, readObject: readObject, decodeTextAsset: decodeTextAsset, decodeMonoScript: decodeMonoScript, monoName: monoName, sniffText: sniffText, buildInventory: buildInventory, classIdOf: classIdOf,
    findEmbeddedFont: findEmbeddedFont, isSerializedName: isSerializedName, selectCandidates: selectCandidates, scan: scan, toIndex: toIndex, toReportFields: toReportFields };
})(typeof window !== 'undefined' ? window : self);
