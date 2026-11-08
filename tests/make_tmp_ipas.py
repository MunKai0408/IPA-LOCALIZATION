#!/usr/bin/env python3
"""Fixture GIẢ LẬP cho SUB-PHASE 5.2d (TMP_FontAsset). SerializedFile v17 dựng THỦ CÔNG; bố cục TMP (FaceInfo + bảng glyph 36 byte) là GIẢ ĐỊNH của module JS,
KHÔNG phải file Unity/TextMesh Pro thật → chỉ chứng minh logic nhất quán, không chứng minh đúng với game thật. Đáp án (tập code point, độ phủ Việt) do Python tính ĐỘC LẬP.
Dùng: python3 tests/make_tmp_ipas.py OUT_DIR → OUT_DIR/tmp_all.ipa, OUT_DIR/tmp_expected.json"""
import sys, os, zipfile, plistlib, struct, json, unicodedata
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
def align(n, a): return (n + a - 1) // a * a

def astr(s, e): return struct.pack(e + 'i', len(s)) + s + b'\0' * (align(len(s), 4) - len(s))
def monoscript(name, cn, ns, asm, e): return astr(name.encode(), e) + struct.pack(e + 'i', 0) + bytes(16) + astr(cn.encode(), e) + astr(ns.encode(), e) + astr(asm.encode(), e) + b'\1'

def build(version=17, le=True, types=None, objs=None, scripts=(), externals=(), unity='5.6.5p2'):
    e = '<' if le else '>'; v = version; objs = objs or []
    hdr_len = 20; m = bytearray()
    pos = lambda: hdr_len + len(m)
    def al4():
        while pos() % 4: m.append(0)
    m += unity.encode() + b'\0'; m += struct.pack(e + 'i', 9); m.append(0)
    m += struct.pack(e + 'i', len(types))
    for t in types:
        m += struct.pack(e + 'i', t['cid']); m.append(0); m += struct.pack(e + 'h', t['sti'])
        if t['cid'] == 114: m += bytes(16)
        m += bytes(16)
    m += struct.pack(e + 'i', len(objs)); off = 0; starts = []
    for o in objs: starts.append(off); off = align(off + len(o['data']), 8)
    for o, st in zip(objs, starts):
        al4(); m += struct.pack(e + 'q', o['pid']); m += struct.pack(e + 'I', st); m += struct.pack(e + 'I', len(o['data'])); m += struct.pack(e + 'i', o['tidx'])
    m += struct.pack(e + 'i', len(scripts))
    for fi, pid in scripts: m += struct.pack(e + 'i', fi); al4(); m += struct.pack(e + 'q', pid)
    m += struct.pack(e + 'i', len(externals))
    for p in externals: m.append(0); m += bytes(16) + struct.pack(e + 'i', 0) + p.encode() + b'\0'
    m.append(0)
    data_off = align(hdr_len + len(m), 16); total = data_off + off
    head = struct.pack('>IIII', len(m), total, v, data_off) + bytes([0 if le else 1]) + b'\0\0\0'
    blob = bytearray(head + bytes(m) + b'\0' * (data_off - hdr_len - len(m)))
    for o in objs: blob += o['data'] + b'\0' * (align(len(o['data']), 8) - len(o['data']))
    return bytes(blob)
def O(pid, cid, data, tidx): return dict(pid=pid, cid=cid, data=data, tidx=tidx)

# ---- đáp án độc lập: 134 ký tự Việt dựng sẵn ----
bases = 'aăâeêioôơuưy'; tones = ['', '\u0300', '\u0309', '\u0303', '\u0301', '\u0323']; VI = set()
for b in bases + bases.upper():
    for t in tones:
        s = unicodedata.normalize('NFC', b + t)
        if len(s) == 1 and ord(s) > 127: VI.add(ord(s))
VI |= {0x110, 0x111}; assert len(VI) == 134, len(VI)
ASCII = set(range(32, 127)); LATIN1_HI = set(range(0xC0, 0x100)); LATIN1_ALL = set(range(0xA0, 0x100))

def ranges(cps):
    a = sorted(cps); out_ = []; s = e = None
    for c in a:
        if s is None: s = e = c
        elif c == e + 1: e = c
        else: out_.append([s, e]); s = e = c
    if s is not None: out_.append([s, e])
    return out_

def glyphs(ids, e, aw=1024, ah=1024, bad_index=None, dup=0, ph_ids=()):
    ids = list(ids)
    for i in range(dup): ids.append(ids[i])
    b = b''
    for i, cp in enumerate(ids):
        x, y, w, h = (i % 30) * 32, (i // 30) * 32 % (ah - 32), 30, 30
        if bad_index == i: x = aw - 5                                # chữ nhật tràn khỏi atlas
        if cp in ph_ids: x, y, w, h = 4, ah + 3, (0 if cp == 10 else 8.8125), (0 if cp == 10 else 24.625)   # DỮ LIỆU THẬT: glyph vô hình đặt ngoài atlas (y = cao atlas + padding)
        b += struct.pack(e + 'i8f', cp, float(x), float(y), float(w), float(h), 1.5, 24.0, 20.0, 1.0)
    return struct.pack(e + 'i', len(ids)) + b

def faceinfo(name, e, pt=36.0, count=0, aw=1024.0, ah=1024.0, legacy=False):
    vals = [pt, 1.0]
    # BỐ CỤC THẬT (DATA WING): sau CharacterCount có 17 giá trị: LineHeight, Baseline, Ascender, CapHeight, Descender, CenterLine, SuperscriptOffset, SubscriptOffset, SubSize, Underline,
    # UnderlineThickness, strikethrough, strikethroughThickness, TabWidth, Padding, AtlasWidth, AtlasHeight. Bản `legacy` (15 giá trị, không có 2 trường strikethrough) là giả định cũ.
    after = [48.0, 36.0, 30.0, 25.0, -9.0, 15.0, 10.0, -10.0, 8.0, -12.0, 3.0] + ([] if legacy else [14.0, 3.0]) + [16.0, 6.0, aw, ah]
    return astr(name.encode(), e) + struct.pack(e + 'ff', *vals) + struct.pack(e + 'i', count) + struct.pack(e + '%df' % len(after), *after)

def pptr(file_id, pid, e): return struct.pack(e + 'iq', file_id, pid)

def tmp_asset(name, e, script_pid=5, face=None, ids=None, declared=None, atlas_pid=20, mat_pid=30, font_pid=40, fallback_pid=None, bad_index=None, dup=0, aw=1024.0, ah=1024.0,
              no_glyphs=False, pad=96, pre_ids=None, legacy_fi=False, ph_ids=()):
    hdr = pptr(0, 0, e) + b'\1\0\0\0' + pptr(0, script_pid, e) + astr(name.encode(), e)
    body = struct.pack(e + 'i', 1)                                   # fontAssetType (giả định)
    if font_pid: body += pptr(0, font_pid, e)                       # tham chiếu Font nguồn (trước FaceInfo)
    body += faceinfo(face, e, count=declared if declared is not None else len(ids or []), aw=aw, ah=ah, legacy=legacy_fi)
    if atlas_pid: body += pptr(0, atlas_pid, e)
    if pre_ids: body += glyphs(pre_ids, e, aw=int(aw), ah=int(ah))      # bảng glyph thứ hai (hợp lệ) đứng TRƯỚC bảng chính
    body += (bytes(2000) if no_glyphs else glyphs(ids, e, aw=int(aw), ah=int(ah), bad_index=bad_index, dup=dup, ph_ids=ph_ids))
    if mat_pid: body += pptr(0, mat_pid, e)
    if fallback_pid: body += pptr(0, fallback_pid, e)
    return hdr + body + bytes(pad)

def tex(name, e): return astr(name.encode(), e) + bytes(40)
SA = ('TMP_FontAsset', 'TMP_FontAsset', 'TMPro', 'Unity.TextMeshPro'); SB = ('TextMeshProUGUI', 'TextMeshProUGUI', 'TMPro', 'Unity.TextMeshPro')
TY = [dict(cid=49, sti=-1), dict(cid=28, sti=-1), dict(cid=128, sti=-1), dict(cid=115, sti=-1), dict(cid=21, sti=-1), dict(cid=114, sti=0), dict(cid=114, sti=1)]

EXP = {'assets': {}, 'refs': {}}
def rec(name, **kw): EXP['assets'][name] = kw

CJK = set(range(0x4E00, 0x4E00 + 3000))
A_ids = ASCII | VI | LATIN1_ALL; B_ids = ASCII | LATIN1_HI
specs = [
    # (pid, name, kwargs, expected)
    (100, 'SourceCodePro SDF', dict(face='Source Code Pro', ids=sorted(A_ids), fallback_pid=101), dict(status='parsed', cps=A_ids, face='Source Code Pro', declared=len(A_ids), atlas=(1024, 1024, 'faceinfo_layout'))),
    (101, 'Orbitron SDF', dict(face='Orbitron Bold', ids=sorted(B_ids), atlas_pid=21, font_pid=41, mat_pid=None), dict(status='parsed', cps=B_ids, face='Orbitron Bold', declared=len(B_ids), atlas=(1024, 1024, 'faceinfo_layout'))),
    (102, 'NoGlyphs SDF', dict(face='Broken Font', ids=[], declared=90, no_glyphs=True), dict(status='glyph_table_not_found', face='Broken Font', declared=90)),
    (103, 'CountMismatch SDF', dict(face='Mismatch', ids=sorted(range(65, 165)), declared=120), dict(status='partial', cps=set(range(65, 165)), face='Mismatch', declared=120, problem='CharacterCount khai báo 120')),
    (104, 'OutOfAtlas SDF', dict(face='Overflow', ids=sorted(range(65, 165)), bad_index=50), dict(status='glyph_table_not_found', face='Overflow', declared=100)),
    (106, 'FewDup SDF', dict(face='FewDup', ids=sorted(range(65, 265)), dup=2, declared=202), dict(status='parsed', cps=set(range(65, 265)), face='FewDup', declared=202, problem='id glyph trùng')),
    (107, 'ManyDup SDF', dict(face='ManyDup', ids=sorted(range(65, 265)), dup=3, declared=203), dict(status='glyph_table_not_found', face='ManyDup', declared=203)),
    (108, 'OddAtlas SDF', dict(face='OddAtlas', ids=sorted(ASCII), aw=1000.0, ah=1000.0), dict(status='parsed', cps=ASCII, face='OddAtlas', declared=len(ASCII), atlas=(None, None, None))),
    (110, 'OneMissing SDF', dict(face='One Missing', ids=sorted(ASCII | (VI - {0x1EF9}))), dict(status='parsed', cps=ASCII | (VI - {0x1EF9}), face='One Missing', declared=len(ASCII | (VI - {0x1EF9})), atlas=(1024, 1024, 'faceinfo_layout'))),
    (111, 'TwoLists-A SDF', dict(face='Two A', ids=sorted(range(105, 205)), pre_ids=sorted(range(65, 105)), declared=100), dict(status='parsed', cps=set(range(105, 205)), face='Two A', declared=100, problem='bảng glyph hợp lệ khác')),
    (112, 'TwoLists-B SDF', dict(face='Two B', ids=sorted(range(105, 205)), pre_ids=sorted(range(65, 105)), declared=40), dict(status='parsed', cps=set(range(65, 105)), face='Two B', declared=40, problem='bảng glyph hợp lệ khác')),
    (113, 'TwoLists-C SDF', dict(face='Two C', ids=sorted(range(105, 205)), pre_ids=sorted(range(65, 105)), declared=77), dict(status='partial', cps=set(range(105, 205)), face='Two C', declared=77, problem='bảng glyph hợp lệ khác')),
    (120, 'Placeholders SDF', dict(face='Xolonium', ids=sorted(ASCII | LATIN1_ALL | {10, 0x3000}), ph_ids={10, 32, 0xA0, 0x3000}), dict(status='parsed', cps=ASCII | LATIN1_ALL | {10, 0x3000}, face='Xolonium', declared=len(ASCII | LATIN1_ALL | {10, 0x3000}), atlas=(1024, 1024, 'faceinfo_layout'), placeholders=4)),
    (121, 'TooManyPlaceholders SDF', dict(face='TooMany', ids=sorted(set(range(0, 33)) | set(range(65, 85))), ph_ids=set(range(0, 33))), dict(status='glyph_table_not_found', face='TooMany', declared=53)),
    (122, 'Legacy18 SDF', dict(face='Legacy18', ids=sorted(ASCII), legacy_fi=True), dict(status='parsed', cps=ASCII, face='Legacy18', declared=len(ASCII), atlas=(1024, 1024, 'faceinfo_layout_18'))),
    (109, 'CJK SDF', dict(face='Noto CJK', ids=sorted(CJK | ASCII), aw=4096.0, ah=4096.0), dict(status='parsed', cps=CJK | ASCII, face='Noto CJK', declared=len(CJK | ASCII), atlas=(4096, 4096, 'faceinfo_layout'))),
]
objs = [O(1, 115, monoscript(*SA, '<'), 3), O(6, 115, monoscript(*SB, '<'), 3), O(20, 28, tex('SourceCodePro Atlas', '<'), 1), O(21, 28, tex('Orbitron Atlas', '<'), 1),
        O(30, 21, tex('SourceCodePro Material', '<'), 4), O(40, 128, tex('SourceCodePro-Regular', '<'), 2), O(41, 128, tex('Orbitron-Bold', '<'), 2)]
# script pid trong scripts[] = pid của MonoScript: dùng 5 và 6 → đặt pid MonoScript = 5 và 6
objs[0]['pid'] = 5; objs[1]['pid'] = 6
for pid, name, kw, ex in specs:
    objs.append(O(pid, 114, tmp_asset(name, '<', **kw), 5)); ex = dict(ex); ex['pid'] = pid; rec(name, **{k: (sorted(v) if k == 'cps' else v) for k, v in ex.items()})
# header không khớp: script PPtr pathID = 0 (nhưng vẫn là object MonoBehaviour của TMP_FontAsset theo bảng type)
nh = tmp_asset('NoHeader SDF', '<', script_pid=0, face='NoHeader', ids=sorted(ASCII)); objs.append(O(105, 114, nh, 5))
rec('NoHeader SDF', pid=105, status='parsed', cps=sorted(ASCII), face='NoHeader', declared=len(ASCII), problem='Header MonoBehaviour không khớp')
# MonoBehaviour khác class (không được giải mã như TMP)
objs.append(O(200, 114, tmp_asset('NotTmp', '<', ids=sorted(ASCII), face='Decoy'), 6))

for k in list(EXP['assets']):
    ex = EXP['assets'][k]
    if 'cps' in ex:
        s = set(ex['cps']); ex['count'] = len(s); ex['ranges'] = ranges(s); cov = len(VI & s); ex['vi_covered'] = cov; ex['vi_missing'] = 134 - cov
        ex['vi_level'] = 'full' if cov == 134 else ('none' if cov == 0 else 'partial'); ex['ascii_ok'] = all(c in s for c in list(range(65, 91)) + list(range(97, 123)))
        del ex['cps']
EXP['vi_required'] = sorted(VI)
EXP['refs'] = {'SourceCodePro SDF': {'texture': ['SourceCodePro Atlas'], 'material': ['SourceCodePro Material'], 'font': ['SourceCodePro-Regular'], 'tmp_font_asset': ['Orbitron SDF']},
               'Orbitron SDF': {'texture': ['Orbitron Atlas'], 'material': [], 'font': ['Orbitron-Bold'], 'tmp_font_asset': []}}
EXP['matched_fonts'] = {'SourceCodePro SDF': ['SourceCodePro-Regular'], 'Orbitron SDF': ['Orbitron-Bold']}
EXP['tmp_object_indexes'] = [i for i, o in enumerate(objs) if o['tidx'] == 5]
EXP['non_tmp_mb_index'] = [i for i, o in enumerate(objs) if o['tidx'] == 6]
FILES = {'Data/resources.assets': build(17, True, TY, objs, scripts=[(0, 5), (0, 6)])}
# file big-endian v17: 1 TMP đầy đủ (+ MonoScript)
BE = '>'
objs_be = [O(5, 115, monoscript(*SA, '>'), 3), O(20, 28, tex('BE Atlas', '>'), 1), O(40, 128, tex('BE-Font', '>'), 2), O(300, 114, tmp_asset('BE SDF', '>', script_pid=5, face='BE Font', ids=sorted(ASCII | VI), atlas_pid=20, mat_pid=None, font_pid=40), 4)]
FILES['Data/level0'] = build(17, False, TY[:4] + [TY[5]], objs_be, scripts=[(0, 5)])
rec('BE SDF', pid=300, status='parsed', face='BE Font', declared=len(ASCII | VI), count=len(ASCII | VI), ranges=ranges(ASCII | VI), vi_covered=134, vi_missing=0, vi_level='full', ascii_ok=True)
EXP['be_file'] = 'Data/level0'
# file không có TMP (không được tạo mục TMP)
FILES['Data/sharedassets0.assets'] = build(17, True, TY[:4], [O(1, 49, astr(b'x', '<') + astr(b'y', '<'), 0)])

# bundle UnityFS chứa node SerializedFile có TMP_FontAsset (chưa hỗ trợ đọc TMP trong node → phải có cảnh báo, KHÔNG bịa kết quả)
def cstr(s): return s.encode() + b'\0'
def unityfs(nodes):
    data = b''.join(d for _, _, d in nodes); blocks = struct.pack('>IIH', len(data), len(data), 0)
    info = bytes(16) + struct.pack('>i', 1) + blocks + struct.pack('>i', len(nodes)); off = 0
    for p, fl, d in nodes: info += struct.pack('>qqI', off, len(d), fl) + cstr(p); off += len(d)
    hdr = b'UnityFS\0' + struct.pack('>I', 6) + cstr('5.x.x') + cstr('5.6.5p2'); hl = len(hdr) + 20
    total = hl + len(info) + len(data); head = hdr + struct.pack('>qIII', total, len(info), len(info), 0x40)
    return head + info + data
IN_B = build(17, True, TY[:4] + [TY[5]], [O(5, 115, monoscript(*SA, '<'), 3), O(400, 114, tmp_asset('InBundle SDF', '<', script_pid=5, face='Bundled', ids=sorted(ASCII)), 4)], scripts=[(0, 5)])
FILES['Data/Bundles/b.bundle'] = unityfs([('CAB-1', 4, IN_B)])

# ---- Bản tái dựng từ BYTE THẬT (DATA WING: 'European Chars - Xolonium', 254 ký tự; hex_head + count_hits trong tmp_fonts.json) ----
REAL_HEAD = ("1a 77 c6 4a 00 00 00 00 1b 00 00 00 00 00 00 00 66 88 63 66 01 00 00 00 08 00 00 00 58 6f 6c 6f 6e 69 75 6d 00 00 b0 41 00 00 80 3f fe 00 00 00 00 00 d4 41 00 00 00 00 00 00 9d 41 "
             "00 00 68 41 00 00 a0 c0 00 00 00 00 00 00 9d 41 7b 14 3e c0 00 00 00 3f 7b 14 3e c0 c3 f5 a8 3f 8c 2e aa 40 c3 f5 a8 3f 00 40 b0 42 00 00 40 40 00 00 00 44 00 00 80 43 "
             "00 00 00 00 39 00 00 00 00 00 00 00 fe 00 00 00")
REAL_SPACE = "20 00 00 00 00 00 80 40 00 80 81 43 00 00 0d 41 00 00 c5 41 00 00 00 00 00 00 9d 41 00 00 0d 41 00 00 80 3f"       # glyph id 32: y = 259 > cao atlas 256
head = bytes.fromhex(REAL_HEAD.replace(' ', '')); space = bytes.fromhex(REAL_SPACE.replace(' ', '')); assert len(space) == 36
real_name = 'European Chars - Xolonium'
real = pptr(0, 0, '<') + b'\1\0\0\0' + pptr(1, 67, '<') + astr(real_name.encode(), '<') + head + space
real_ids = list(range(33, 286)); assert len(real_ids) == 253
for i, cp in enumerate(real_ids): real += struct.pack('<i8f', cp, float((i % 24) * 20), float((i // 24) * 22), 12.0 + (i % 5), 21.0, 0.5, 19.6, 13.0 + (i % 4), 1.0)
real += pptr(0, 31, '<') + bytes(64)
open(os.path.join(out, 'tmp_real_xolonium.bin'), 'wb').write(real)
REAL_SET = set(range(32, 286)); rcov = len(VI & REAL_SET)
EXP['real_xolonium'] = dict(name=real_name, declared=254, count=254, atlas=(512, 256), point_size=22, covered=rcov, missing=134 - rcov, level='partial' if 0 < rcov < 134 else ('full' if rcov == 134 else 'none'), placeholders=1,
                            script=(1, 67), face='Xolonium', ranges=ranges(REAL_SET))

def info_plist(): return plistlib.dumps({'CFBundleIdentifier': 'com.test.tmp', 'CFBundleName': 'TMP', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY)
def macho(): return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64
with zipfile.ZipFile(os.path.join(out, 'tmp_all.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(APP + 'Info.plist', info_plist()); z.writestr(APP + 'Exe', macho())
    for p, d in FILES.items(): z.writestr(APP + p, d)
json.dump(EXP, open(os.path.join(out, 'tmp_expected.json'), 'w'), ensure_ascii=False, indent=1)
print('OK tmp_all.ipa:', len(EXP['assets']), 'TMP_FontAsset giả lập')
