#!/usr/bin/env python3
"""Fixture GIẢ LẬP cho SUB-PHASE 5.2c (SerializedFile). SerializedFile dựng THỦ CÔNG theo bố cục module JS giả định (v9–23, LE/BE, type tree bật/tắt) – KHÔNG phải file Unity thật.
Dùng: python3 tests/make_serialized_ipas.py OUT_DIR → OUT_DIR/ser_all.ipa, OUT_DIR/serialized_expected.json"""
import sys, os, zipfile, plistlib, struct, json, hashlib
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
sha = lambda b: hashlib.sha256(b).hexdigest()
def align(n, a): return (n + a - 1) // a * a

def sfnt(fill=0xAB, tables=(b'cmap', b'head', b'glyf'), pad=64):
    n = len(tables); hdr = b'\x00\x01\x00\x00' + struct.pack('>HHHH', n, 0, 0, 0); off = 12 + 16 * n; recs = b''; body = b''
    for t in tables: recs += t + struct.pack('>III', 0, off, pad); body += bytes([fill]) * pad; off += pad
    return hdr + recs + body

def astr(s, e):
    return struct.pack(e + 'i', len(s)) + s + b'\0' * (align(len(s), 4) - len(s))
def textasset(name, script, e): return astr(name.encode(), e) + astr(script, e) + astr(b'', e)
def fontobj(name, ttf, e): return astr(name.encode(), e) + struct.pack(e + 'ffiii', 1.0, 1.0, 0, 0, 0) + struct.pack(e + 'i', len(ttf)) + ttf + b'\0' * 8
def monoscript(name, cn, ns, asm, e): return astr(name.encode(), e) + struct.pack(e + 'i', 0) + bytes(16) + astr(cn.encode(), e) + astr(ns.encode(), e) + astr(asm.encode(), e) + b'\1'

def build(version=17, le=True, types=None, objs=None, scripts=(), externals=(), typetree=False, unity='2021.3.10f1', cut=0, patch_version=None):
    e = '<' if le else '>'; v = version; types = types if types is not None else [dict(cid=49, sti=-1), dict(cid=28, sti=-1), dict(cid=128, sti=-1), dict(cid=115, sti=-1)]; objs = objs or []
    hdr_len = 48 if v >= 22 else 20; m = bytearray()
    pos = lambda: hdr_len + len(m)
    def al4():
        while pos() % 4: m.append(0)
    if v >= 7: m += unity.encode() + b'\0'
    if v >= 8: m += struct.pack(e + 'i', 9)
    if v >= 13: m.append(1 if typetree else 0)
    m += struct.pack(e + 'i', len(types))
    for t in types:
        m += struct.pack(e + 'i', t['cid'])
        if v >= 16: m.append(0)
        if v >= 17: m += struct.pack(e + 'h', t['sti'])
        if v >= 13:
            if (v >= 16 and t['cid'] == 114) or (v < 16 and t['cid'] < 0): m += bytes(16)
            m += bytes(16)
        if typetree:
            n, sb = 2, 8; m += struct.pack(e + 'ii', n, sb) + bytes(n * (32 if v >= 19 else 24)) + bytes(sb)
            if v >= 21: m += struct.pack(e + 'i', 0)
    if 7 <= v < 14: m += struct.pack(e + 'i', 0)
    m += struct.pack(e + 'i', len(objs)); off = 0; starts = []
    for o in objs: starts.append(off); off = align(off + len(o['data']), 8)
    for o, st in zip(objs, starts):
        if v >= 14: al4(); m += struct.pack(e + 'q', o['pid'])
        else: m += struct.pack(e + 'i', o['pid'])
        m += struct.pack(e + ('q' if v >= 22 else 'I'), st); m += struct.pack(e + 'I', o.get('size', len(o['data']))); m += struct.pack(e + 'i', o['tidx'])
        if v < 16: m += struct.pack(e + 'H', o['cid'])
        if v < 11: m += struct.pack(e + 'H', 0)
        if 11 <= v < 17: m += struct.pack(e + 'h', o.get('sti', -1))
        if v in (15, 16): m.append(0)
    if v >= 11:
        m += struct.pack(e + 'i', len(scripts))
        for fi, pid in scripts:
            m += struct.pack(e + 'i', fi)
            if v < 14: m += struct.pack(e + 'i', pid)
            else: al4(); m += struct.pack(e + 'q', pid)
    m += struct.pack(e + 'i', len(externals))
    for p in externals:
        if v >= 6: m.append(0)
        m += bytes(16) + struct.pack(e + 'i', 0) + p.encode() + b'\0'
    if v >= 20: m += struct.pack(e + 'i', 0)
    if v >= 5: m.append(0)
    data_off = align(hdr_len + len(m), 16); total = data_off + off
    if v < 22: head = struct.pack('>IIII', len(m), total, v, data_off) + bytes([0 if le else 1]) + b'\0\0\0'
    else: head = struct.pack('>IIII', 0, 0, v, 0) + bytes([0 if le else 1]) + b'\0\0\0' + struct.pack('>IqqQ', len(m), total, data_off, 0)
    blob = bytearray(head + bytes(m) + b'\0' * (data_off - hdr_len - len(m)))
    for o, st in zip(objs, starts): blob += o['data'] + b'\0' * (align(len(o['data']), 8) - len(o['data']))
    if patch_version is not None: struct.pack_into('>I', blob, 8, patch_version)
    return bytes(blob[:len(blob) - cut]) if cut else bytes(blob)

def O(pid, cid, data, tidx=0, **kw): return dict(pid=pid, cid=cid, data=data, tidx=tidx, **kw)
TIDX = {49: 0, 28: 1, 128: 2, 115: 3}
EXP = {}; FILES = {}
def reg(path, data, **exp): FILES[path] = data; EXP[path] = exp

VI = 'ĐỐI THOẠI: xin chào thế giới\nline2'.encode('utf-8'); BIN = bytes([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x81]) * 7; TTF = sfnt(0x31); TTF2 = sfnt(0x32, (b'name', b'cmap'))
SA = ('Loc', 'LocalizationManager', 'MyGame', 'Assembly-CSharp'); SB = ('TMP_FontAsset', 'TMP_FontAsset', 'TMPro', 'Unity.TextMeshPro')

def t17(extra_types=()): return [dict(cid=49, sti=-1), dict(cid=28, sti=-1), dict(cid=128, sti=-1), dict(cid=115, sti=-1)] + list(extra_types)
def mb_types(e_scripts): return [dict(cid=114, sti=i) for i in e_scripts]

# level0: v17 LE – TextAsset×2, Font, MonoScript A, 3 MonoBehaviour (A, A, B ngoài file) + 1 MonoBehaviour trỏ script không tồn tại
ty = t17(mb_types([0, 0, 1, 2]))        # 4 type MB (idx 4..7)
objs = [O(1, 49, textasset('dialog_vi', VI, '<'), 0), O(2, 49, textasset('blob', BIN, '<'), 0), O(3, 128, fontobj('Roboto', TTF, '<'), 2), O(5, 115, monoscript(*SA, '<'), 3), O(8, 28, b'\x01' * 40, 1),
        O(10, 114, b'\0' * 24, 4), O(11, 114, b'\0' * 24, 5), O(12, 114, b'\0' * 24, 6), O(13, 114, b'\0' * 24, 7)]
reg('Data/level0', build(17, True, ty, objs, scripts=[(0, 5), (1, 7), (0, 999)], externals=['globalgamemanagers.assets']),
    version=17, classes={'TextAsset': 2, 'Font': 1, 'MonoScript': 1, 'Texture2D': 1, 'MonoBehaviour': 4}, text=[('dialog_vi', sha(VI), True), ('blob', sha(BIN), False)], fonts=[('Roboto', sha(TTF))],
    mb={'MyGame.LocalizationManager': 2, 'TMPro.TMP_FontAsset': 1, '(không xác định)': 1})
reg('Data/globalgamemanagers.assets', build(17, True, None, [O(7, 115, monoscript(*SB, '<'), 3), O(20, 28, b'\2' * 16, 1)]), version=17, classes={'MonoScript': 1, 'Texture2D': 1}, text=[], fonts=[])
reg('Data/sharedassets0.assets', build(19, True, None, [O(1, 49, textasset('sa0', b'hello sa0', '<'), 0)], typetree=True), version=19, classes={'TextAsset': 1}, text=[('sa0', sha(b'hello sa0'), True)], fonts=[])
reg('Data/sharedassets1.assets', build(21, True, None, [O(1, 49, textasset('sa1', b'v21 text', '<'), 0), O(2, 28, b'\3' * 8, 1)], typetree=True, externals=['sharedassets0.assets']), version=21, classes={'TextAsset': 1, 'Texture2D': 1}, text=[('sa1', sha(b'v21 text'), True)], fonts=[])
reg('Data/resources.assets', build(22, True, None, [O(1, 49, textasset('res', b'v22 text', '<'), 0), O(2, 128, fontobj('Arial', TTF2, '<'), 2)]), version=22, classes={'TextAsset': 1, 'Font': 1}, text=[('res', sha(b'v22 text'), True)], fonts=[('Arial', sha(TTF2))])
# level1: v15 – class u16, script index ở object, byte stripped
ty15 = [dict(cid=49, sti=-1), dict(cid=115, sti=-1), dict(cid=114, sti=-1)]
reg('Data/level1', build(15, True, ty15, [O(1, 49, textasset('v15', b'fifteen', '<'), 0), O(4, 115, monoscript(*SA, '<'), 1), O(6, 114, b'\0' * 20, 2, sti=0), O(7, 114, b'\0' * 20, 2, sti=0)], scripts=[(0, 4)]),
    version=15, classes={'TextAsset': 1, 'MonoScript': 1, 'MonoBehaviour': 2}, text=[('v15', sha(b'fifteen'), True)], fonts=[], mb={'MyGame.LocalizationManager': 2})
reg('Data/level2', build(13, True, [dict(cid=49, sti=-1), dict(cid=28, sti=-1)], [O(1, 49, textasset('v13', b'thirteen', '<'), 0)]), version=13, classes={'TextAsset': 1}, text=[('v13', sha(b'thirteen'), True)], fonts=[])
reg('Data/level3', build(17, False, t17(mb_types([0])), [O(1, 49, textasset('be', b'big endian', '>'), 0), O(2, 115, monoscript(*SA, '>'), 3), O(3, 128, fontobj('BeFont', TTF, '>'), 2), O(4, 114, b'\0' * 12, 4)], scripts=[(0, 2)]),
    version=17, classes={'TextAsset': 1, 'MonoScript': 1, 'Font': 1, 'MonoBehaviour': 1}, text=[('be', sha(b'big endian'), True)], fonts=[('BeFont', sha(TTF))], mb={'MyGame.LocalizationManager': 1})
# level10: v15 BIG endian (u16 class, i16 script idx, u16/i32 trường BE)
reg('Data/level10', build(15, False, ty15, [O(1, 49, textasset('v15be', b'fifteen be', '>'), 0), O(4, 115, monoscript(*SA, '>'), 1), O(6, 114, b'\0' * 20, 2, sti=0)], scripts=[(0, 4)]),
    version=15, classes={'TextAsset': 1, 'MonoScript': 1, 'MonoBehaviour': 1}, text=[('v15be', sha(b'fifteen be'), True)], fonts=[], mb={'MyGame.LocalizationManager': 1})
# level11: Font có blob giả (magic sfnt nhưng bảng vô lý) đứng TRƯỚC font hợp lệ; Font thứ hai chỉ có blob giả
FAKE = b'\x00\x01\x00\x00' + struct.pack('>HHHH', 200, 0, 0, 0) + bytes(20)
f1 = astr(b'TwoBlobs', '<') + struct.pack('<i', len(FAKE)) + FAKE + struct.pack('<i', len(TTF)) + TTF + bytes(8)
f2 = astr(b'FakeOnly', '<') + struct.pack('<i', len(FAKE)) + FAKE + bytes(8)
reg('Data/level11', build(17, True, t17(), [O(1, 128, f1, 2), O(2, 128, f2, 2)]), version=17, classes={'Font': 2}, text=[], fonts=[('TwoBlobs', sha(TTF))], fake_only='FakeOnly', fake_sha=sha(FAKE))
# bất thường
reg('Data/level4', build(9, True, [dict(cid=49, sti=-1)], [O(1, 49, textasset('x', b'y', '<'), 0)]), expect_status='unsupported_typetree')
reg('Data/level5', build(17, True, t17(), [O(1, 49, textasset('x', b'y', '<'), 0)], patch_version=23), expect_status='unsupported_version')
reg('Data/level6', b'\xAB' * 200, expect_status='not_serialized')
big = textasset('big', b'Z' * 6000, '<')
reg('Data/level7', build(17, True, t17(), [O(1, 49, textasset('ok1', b'first', '<'), 0), O(2, 49, big, 0)], cut=3000), expect_status='parsed', expect_problem='vượt file', text_ok=['ok1'])
reg('Data/level8', build(17, True, t17(), [O(1, 49, textasset('ok', b'fine', '<'), 0), O(2, 49, textasset('bad', b'oops', '<'), 0, size=0x7FFFFF00)]), expect_status='parsed', expect_problem='vượt file', text_ok=['ok'])
reg('Data/level9', build(17, True, t17(), [O(1, 128, astr(b'NoFont', '<') + bytes(60), 2), O(2, 49, astr(b'bad', '<') + struct.pack('<i', 0x7FFFFFF0) + bytes(16), 0), O(3, 49, textasset('good', b'g', '<'), 0)]),
    expect_status='parsed', text_ok=['good'], font_none=True)
reg('Data/empty.assets', b'', expect_status='not_serialized')
reg('Data/Managed/Metadata/global-metadata.dat', b'\xaf\x1b\xb1\xfa' + bytes(100), not_candidate=True)
reg('Data/sharedassets0.assets.resS', bytes(500), not_candidate=True)

# bundle UnityFS (info/block không nén) chứa node SerializedFile v17
def cstr(s): return s.encode() + b'\0'
def unityfs(nodes):
    data = b''.join(d for _, _, d in nodes); blocks = struct.pack('>IIH', len(data), len(data), 0)
    info = bytes(16) + struct.pack('>i', 1) + blocks + struct.pack('>i', len(nodes)); off = 0
    for p, fl, d in nodes: info += struct.pack('>qqI', off, len(d), fl) + cstr(p); off += len(d)
    hdr = b'UnityFS\0' + struct.pack('>I', 6) + cstr('5.x.x') + cstr('2018.4.36f1'); hl = len(hdr) + 20
    total = hl + len(info) + len(data); head = hdr + struct.pack('>qIII', total, len(info), len(info), 0x40)
    return head + info + data
IN_B = build(17, True, t17(), [O(1, 49, textasset('in_bundle', 'Việt trong bundle'.encode('utf-8'), '<'), 0), O(2, 115, monoscript(*SA, '<'), 3)])
reg('Data/Bundles/b.bundle', unityfs([('CAB-1', 4, IN_B), ('CAB-1.resS', 0, b'\0' * 100)]), bundle=True, text=[('in_bundle', sha('Việt trong bundle'.encode('utf-8')), True)])

def info_plist(): return plistlib.dumps({'CFBundleIdentifier': 'com.test.ser', 'CFBundleName': 'SER', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY)
def macho(): return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64
with zipfile.ZipFile(os.path.join(out, 'ser_all.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(APP + 'Info.plist', info_plist()); z.writestr(APP + 'Exe', macho())
    for p, d in FILES.items(): z.writestr(APP + p, d)
json.dump(EXP, open(os.path.join(out, 'serialized_expected.json'), 'w'), ensure_ascii=False, indent=1)
for p, d in FILES.items(): open(os.path.join(out, 'ser_raw_' + p.replace('/', '__')), 'wb').write(d)
print('ok', len(FILES), 'file ->', out)
