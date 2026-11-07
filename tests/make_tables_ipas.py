#!/usr/bin/env python3
"""IPA GIẢ LẬP cho SUB-PHASE 4.3 (assembly/image/type/method/field). Metadata giả được dựng theo bố cục DẪN XUẤT TỰ ĐỘNG từ MetadataClass.cs
(tests/fixtures/il2cpp_struct_schema.json), độc lập với bảng schema viết tay trong JS. KHÔNG phải metadata thật.
Dùng: python3 tests/make_tables_ipas.py OUT_DIR   → OUT_DIR/*.ipa + OUT_DIR/tbl_expected.json"""
import sys, os, zipfile, plistlib, struct, json
here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'
os.makedirs(out, exist_ok=True)
SCH = json.load(open(os.path.join(here, 'fixtures', 'il2cpp_struct_schema.json')))['classes']
TYPEFMT = {'uint': '<I', 'int': '<i', 'ushort': '<H', 'short': '<h'}
CLS = {'header': 'Il2CppGlobalMetadataHeader', 'assembly': 'Il2CppAssemblyDefinition', 'aname': 'Il2CppAssemblyNameDefinition', 'image': 'Il2CppImageDefinition',
       'typedef': 'Il2CppTypeDefinition', 'method': 'Il2CppMethodDefinition', 'param': 'Il2CppParameterDefinition', 'field': 'Il2CppFieldDefinition'}

def active(cls, V): return [f for f in SCH[CLS[cls]] if f['min'] <= V <= f['max']]
def size(cls, V):
    t = 0
    for f in active(cls, V):
        if f['type'] == 'byte[]': t += f['len']
        elif f['type'] in TYPEFMT: t += struct.calcsize(TYPEFMT[f['type']])
        else: t += size('aname', V)
    return t
def pack(cls, V, vals):
    b = b''
    for f in active(cls, V):
        v = vals.get(f['name'], 0)
        if f['type'] == 'byte[]': b += (v if isinstance(v, bytes) else bytes(8))
        elif f['type'] in TYPEFMT: b += struct.pack(TYPEFMT[f['type']], v)
        else: b += pack('aname', V, v if isinstance(v, dict) else {})
    assert len(b) == size(cls, V)
    return b

class Strings:
    def __init__(self): self.data = b'\0'; self.idx = {'': 0}
    def add(self, s):
        if s in self.idx: return self.idx[s]
        i = len(self.data); self.data += s.encode('utf-8') + b'\0'; self.idx[s] = i; return i

def content(n_images):
    """Nội dung logic độc lập với version."""
    imgs = [('Assembly-CSharp.dll', 0, 5), ('UnityEngine.CoreModule.dll', 5, 3)]
    for k in range(n_images - 2): imgs.append(('Extra%d.dll' % k, 8 + k, 1))
    types = [  # ns, name, flags, bitfield, nested_in_idx(None), fields, methods
        ('Game.UI', 'MenuController', 0x00100001, 0, None, [('titleText', 11), ('<Count>k__BackingField', 12)], [('Start', 0x00C6, 0, [('arg', 5)]), ('SetTitle', 0x0006, 1, [('text', 7), ('size', 8)]), ('.ctor', 0x1886, 0, [])]),
        ('Game.UI', 'Inner', 0x00000002, 0, 0, [('v', 3)], [('Do', 0x0010 | 0x0006, 0, [])]),
        ('Game', 'IService', 0x000000A1, 0, None, [], [('Run', 0x0446, 0, [('日本語', 4)])]),
        ('Game.Data', 'ItemKind', 0x00000101, 0x3, None, [('Sword', 20), ('Shield', 20)], []),
        ('', 'List`1', 0x00000101, 0x1, None, [], []),
        ('UnityEngine', 'Object', 0x00000001, 0, None, [], [('Destroy', 0x0016, 0, [('obj', 1)])]),
        ('UnityEngine', 'Việt hóa ✓', 0x00000181, 0, None, [('x', 2)], []),
        ('UnityEngine', 'Mathf', 0x00000181, 0, None, [], [('Abs', 0x0016, 0, [('f', 6)]), ('Max', 0x0016, 0, [('a', 6), ('b', 6)])]),
    ]
    return imgs, types

def build(vkey, n_images=3, mutate=None):
    ver, V, asmV, imgV = {'v16': (16, 16, 16, 16), 'v17': (17, 17, 17, 17), 'v19': (19, 19, 19, 19), 'v20': (20, 20, 20, 20), 'v21': (21, 21, 21, 21), 'v22': (22, 22, 22, 22),
        'v24_0': (24, 24, 24, 24), 'v24_1': (24, 24.1, 24.1, 24.1), 'v24_1plus': (24, 24.1, 24.4, 24.1), 'v24_2': (24, 24.2, 24.2, 24.2), 'v24_4': (24, 24.4, 24.4, 24.4),
        'v27': (27, 27, 27, 27), 'v29': (29, 29, 29, 29), 'v31': (31, 31, 31, 31)}[vkey]
    hV = 24 if ver == 24 and V in (24, 24.1) else V   # header v24.0/24.1 cùng bố cục (272 B)
    imgs, types = content(n_images)
    st = Strings()
    # nested
    nested = []; typeraw = []
    methods = []; params = []; fields = []; tdefs = []
    for ti, (ns, nm, fl, bf, nin, fs, ms) in enumerate(types):
        t = {'nameIndex': st.add(nm), 'namespaceIndex': st.add(ns), 'flags': fl, 'bitfield': bf, 'parentIndex': -1, 'declaringTypeIndex': 7000 + ti, 'token': 0x02000001 + ti,
             'byvalTypeIndex': 100 + ti, 'genericContainerIndex': -1, 'elementTypeIndex': -1, 'fieldStart': len(fields), 'field_count': len(fs), 'methodStart': len(methods), 'method_count': len(ms),
             'nestedTypesStart': 0, 'nested_type_count': 0, 'customAttributeIndex': -1}
        for (fn, ftype) in fs: fields.append({'nameIndex': st.add(fn), 'typeIndex': ftype, 'token': 0x04000001 + len(fields), 'customAttributeIndex': -1})
        for (mn, mflags, mret, ps) in ms:
            m = {'nameIndex': st.add(mn), 'declaringType': ti, 'returnType': mret, 'parameterStart': len(params), 'parameterCount': len(ps), 'genericContainerIndex': -1, 'token': 0x06000001 + len(methods),
                 'flags': mflags, 'iflags': 0, 'slot': 65535 if len(methods) % 2 else len(methods) % 40, 'customAttributeIndex': -1, 'returnParameterToken': 0}
            for (pn, pt) in ps: params.append({'nameIndex': st.add(pn), 'typeIndex': pt, 'token': 0x08000001 + len(params), 'customAttributeIndex': -1})
            methods.append(m)
        tdefs.append(t)
    for ti, (ns, nm, fl, bf, nin, fs, ms) in enumerate(types):
        pass
    # nested table: type 0 chứa type 1
    tdefs[0]['nestedTypesStart'] = 0; tdefs[0]['nested_type_count'] = 1; nested = [1]
    # images: type ranges
    imgdefs = []
    for ii, (nm, ts, tc) in enumerate(imgs):
        d = {'nameIndex': st.add(nm), 'assemblyIndex': ii, 'typeStart': ts if ts < len(types) else 0, 'typeCount': tc if ts < len(types) else 0, 'entryPointIndex': -1,
             'token': 1 if (ver == 24 and V == 24) else 0x1000 + ii, 'exportedTypeStart': -1, 'exportedTypeCount': 0, 'customAttributeStart': 0, 'customAttributeCount': 0}
        imgdefs.append(d)
    imgdefs[0]['typeStart'], imgdefs[0]['typeCount'] = 0, 5; imgdefs[1]['typeStart'], imgdefs[1]['typeCount'] = 5, 3
    asm = []
    for ii, (nm, ts, tc) in enumerate(imgs):
        asm.append({'imageIndex': ii, 'token': 0x20000001 + ii, 'customAttributeIndex': -1, 'referencedAssemblyStart': 0, 'referencedAssemblyCount': 0,
                    'aname': {'nameIndex': st.add(nm.replace('.dll', '')), 'cultureIndex': 0, 'hashValueIndex': 0, 'publicKeyIndex': 0, 'hash_alg': 32772, 'hash_len': 0, 'flags': 0,
                              'major': 1, 'minor': 2 + ii, 'build': 3, 'revision': 4, 'public_key_token': bytes(range(ii, ii + 8))}})
    if mutate: mutate(locals())
    regs = {
        'images': b''.join(pack('image', imgV, d) for d in imgdefs),
        'assemblies': b''.join(pack('assembly', asmV, a) for a in asm),
        'typeDefinitions': b''.join(pack('typedef', V, t) for t in tdefs),
        'methods': b''.join(pack('method', V, m) for m in methods),
        'parameters': b''.join(pack('param', V, p) for p in params),
        'fields': b''.join(pack('field', V, f) for f in fields),
        'nestedTypes': b''.join(struct.pack('<i', x) for x in nested),
        'string': st.data,
        'stringLiteral': struct.pack('<II', 2, 0), 'stringLiteralData': b'Hi',
    }
    hsize = size('header', hV)
    off = hsize; hv = {'sanity': 0xFAB11BAF, 'version': ver}
    for k in ['stringLiteral', 'stringLiteralData', 'string', 'images', 'assemblies', 'typeDefinitions', 'methods', 'parameters', 'fields', 'nestedTypes']:
        hv[k + 'Offset'] = off; hv[k + ('Count' if False else 'Size')] = len(regs[k]); off += (len(regs[k]) + 3) & ~3
    if ver == 24 and V in (24, 24.1): assert hv['stringLiteralOffset'] != 264
    hdr = pack('header', hV, hv); assert len(hdr) == hsize
    body = b''
    for k in ['stringLiteral', 'stringLiteralData', 'string', 'images', 'assemblies', 'typeDefinitions', 'methods', 'parameters', 'fields', 'nestedTypes']:
        body += regs[k] + b'\0' * (((len(regs[k]) + 3) & ~3) - len(regs[k]))
    data = hdr + body
    exp = {'version': ver, 'layout': V, 'asm_layout': asmV,
           'assemblies': [{'index': i, 'name': nm.replace('.dll', ''), 'image_index': i, 'version': '1.%d.3.4' % (2 + i)} for i, (nm, _, _) in enumerate(imgs)],
           'images': [{'index': i, 'name': d_nm, 'type_start': imgdefs[i]['typeStart'], 'type_count': imgdefs[i]['typeCount']} for i, (d_nm, _, _) in enumerate(imgs)],
           'types': [{'index': i, 'namespace': t[0], 'name': t[1], 'flags': t[2], 'field_count': len(t[5]), 'method_count': len(t[6]), 'nested_in': t[4]} for i, t in enumerate(types)],
           'methods': [{'index': i, 'name': m_nm, 'type': ti, 'flags': fl, 'ret': ret, 'params': [list(p) for p in ps]} for i, (ti, m_nm, fl, ret, ps) in enumerate([(ti, mn, fl, ret, ps) for ti, t in enumerate(types) for (mn, fl, ret, ps) in t[6]])],
           'fields': [{'index': i, 'name': f_nm, 'type': ti, 'type_raw': ft} for i, (ti, f_nm, ft) in enumerate([(ti, fn, ft) for ti, t in enumerate(types) for (fn, ft) in t[5]])],
           'n_params': len(params)}
    return data, exp

APP = 'Payload/Game.app/'; J = b'x' * 16
UF = 'Frameworks/UnityFramework.framework/UnityFramework'; META = 'Data/Managed/Metadata/global-metadata.dat'
def info(): return plistlib.dumps({'CFBundleIdentifier': 'com.test.tbl', 'CFBundleName': 'TBL', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY)
def macho(): return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64
def write(name, data, method=zipfile.ZIP_DEFLATED):
    with zipfile.ZipFile(os.path.join(out, name + '.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', info()); z.writestr(APP + 'Exe', macho()); z.writestr(APP + UF, J)
        zi = zipfile.ZipInfo(APP + META); zi.compress_type = method; z.writestr(zi, data)

exp = {}
for vk in ['v16', 'v17', 'v19', 'v20', 'v21', 'v22', 'v24_0', 'v24_1', 'v24_1plus', 'v24_2', 'v24_4', 'v27', 'v29', 'v31']:
    d, e = build(vk, 3); write('tbl_' + vk, d); exp['tbl_' + vk] = e
# nhiều image (≥16) cho v24_1 / v24_2 – kiểm chặt chẽ kích thước
for vk in ['v24_1', 'v24_2', 'v24_4']:
    d, e = build(vk, 20); write('tbl_%s_n20' % vk, d); exp['tbl_%s_n20' % vk] = e
d, e = build('v29', 3); write('tbl_v29_stored', d, zipfile.ZIP_STORED); exp['tbl_v29_stored'] = e
# version chưa hỗ trợ / magic
d, e = build('v29', 3); write('tbl_v33', d[:4] + struct.pack('<i', 33) + d[8:])
# bảng hỏng: type.method range vượt, tên ngoài vùng, kích thước bảng không chia hết
def mut_bad_range(L):
    L['tdefs'][1]['methodStart'] = 9999
d, e = build('v29', 3, mut_bad_range); write('tbl_bad_method_range', d)
def mut_bad_name(L):
    L['tdefs'][2]['nameIndex'] = 0x7fffff
d, e = build('v29', 3, mut_bad_name); write('tbl_bad_name', d)
d, e = build('v29', 3)
hv = list(struct.unpack_from('<' + 'iI'[0] * 0, d, 0))  # no-op
# cắt 3 byte cuối bảng methods bằng cách tăng 'methodsSize' (offset trường tính từ schema)
def field_off(cls, V, name):
    o = 0
    for f in active(cls, V):
        if f['name'] == name: return o
        o += 8 if f['type'] == 'byte[]' else struct.calcsize(TYPEFMT[f['type']])
d_arr = bytearray(d); o = field_off('header', 29, 'methodsSize'); cur = struct.unpack_from('<i', d_arr, o)[0]; struct.pack_into('<i', d_arr, o, cur + 3); write('tbl_not_div', bytes(d_arr))
# stringSize vượt file → invalid (đã bắt ở 4.2 generic nên chỉ kiểm pipeline)
d_arr = bytearray(d); o = field_off('header', 29, 'stringSize'); struct.pack_into('<i', d_arr, o, 10 ** 9); write('tbl_string_beyond', bytes(d_arr))
# 200000 method / 100000 field để kiểm bộ nhớ, tốc độ và hủy (v29)
def build_many(n_types=20000, mpt=10, fpt=5):
    V = 29; st = Strings(); tdefs = []; methods = []; fields = []; params = []
    for i in range(n_types):
        t = {'nameIndex': st.add('Type%d' % i), 'namespaceIndex': st.add('Ns%d' % (i % 50)), 'flags': 1, 'bitfield': 0, 'parentIndex': -1, 'declaringTypeIndex': -1, 'token': 0x02000001 + i,
             'genericContainerIndex': -1, 'elementTypeIndex': -1, 'fieldStart': len(fields), 'field_count': fpt, 'methodStart': len(methods), 'method_count': mpt}
        for k in range(fpt): fields.append({'nameIndex': st.add('f%d_%d' % (i, k)), 'typeIndex': k, 'token': 0x04000001 + len(fields)})
        for k in range(mpt):
            methods.append({'nameIndex': st.add('M%d_%d' % (i, k)), 'declaringType': i, 'returnType': 1, 'parameterStart': len(params), 'parameterCount': 1, 'genericContainerIndex': -1, 'token': 0x06000001 + len(methods), 'flags': 6, 'slot': 65535})
            params.append({'nameIndex': st.add('p'), 'typeIndex': 2, 'token': 0x08000001 + len(params)})
        tdefs.append(t)
    imgs = [{'nameIndex': st.add('Big.dll'), 'assemblyIndex': 0, 'typeStart': 0, 'typeCount': n_types, 'entryPointIndex': -1, 'token': 1, 'exportedTypeStart': -1}]
    asm = [{'imageIndex': 0, 'token': 1, 'aname': {'nameIndex': st.add('Big'), 'major': 1}}]
    regs = [('stringLiteral', b''), ('stringLiteralData', b''), ('string', st.data), ('images', b''.join(pack('image', V, d) for d in imgs)), ('assemblies', b''.join(pack('assembly', V, a) for a in asm)),
            ('typeDefinitions', b''.join(pack('typedef', V, t) for t in tdefs)), ('methods', b''.join(pack('method', V, m) for m in methods)),
            ('parameters', b''.join(pack('param', V, p) for p in params)), ('fields', b''.join(pack('field', V, f) for f in fields)), ('nestedTypes', b'')]
    hsize = size('header', V); off = hsize; hv = {'sanity': 0xFAB11BAF, 'version': 29}
    for k, b in regs: hv[k + 'Offset'] = off; hv[k + 'Size'] = len(b); off += (len(b) + 3) & ~3
    return pack('header', V, hv) + b''.join(b + b'\0' * (((len(b) + 3) & ~3) - len(b)) for k, b in regs)
write('tbl_many', build_many()); exp['tbl_many'] = {'types': 20000, 'methods': 200000, 'fields': 100000}
json.dump(exp, open(os.path.join(out, 'tbl_expected.json'), 'w'), ensure_ascii=False)
print('OK IPA giả lập Phase 4.3 (bảng) trong', out)
