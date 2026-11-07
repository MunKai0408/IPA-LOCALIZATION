#!/usr/bin/env python3
"""Tạo IPA GIẢ LẬP cho kiểm thử SUB-PHASE 4.2 (header global-metadata.dat). Header do script tự dựng theo giả định chung
(cặp int32 offset,size sau magic+version; offset bảng đầu = kích thước header). KHÔNG phải metadata thật của game.
Dùng: python3 tests/make_metadata_ipas.py OUT_DIR"""
import sys, os, zipfile, plistlib, struct, json, random

out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'
os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
J = b'x' * 16
UF = 'Frameworks/UnityFramework.framework/UnityFramework'
META = 'Data/Managed/Metadata/global-metadata.dat'

def info(): return plistlib.dumps({'CFBundleIdentifier': 'com.test.m42', 'CFBundleName': 'M42', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY)
def macho(): return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64

def build(version, sizes, header_pairs=32, magic=b'\xAF\x1B\xB1\xFA', pad=0, overrides=None, extra_header=b''):
    """header = magic + version + header_pairs*(offset,size) [+ extra_header]; bảng nối tiếp sau header, size[i] byte (0 = rỗng)."""
    H = 8 + header_pairs * 8 + len(extra_header)
    pairs, off = [], H
    for i in range(header_pairs):
        s = sizes[i] if i < len(sizes) else 0
        pairs.append([off if s else H, s]); off += s
    if overrides:
        for i, (o, s) in overrides.items(): pairs[i] = [o, s]
    hdr = magic + struct.pack('<i', version) + b''.join(struct.pack('<ii', o, s) for o, s in pairs) + extra_header
    body = bytes((i * 7 + 3) & 0xFF for i in range(off - H)) + b'\0' * pad
    return hdr + body

SZ = [100, 40, 300, 0, 64, 0, 128, 16] + [32] * 24
CASES = {}   # name -> (bytes, deflate?)
CASES['m42_ok_v24'] = build(24, SZ)                                        # H=264
CASES['m42_ok_v29'] = build(29, SZ, header_pairs=33)                       # H=272
CASES['m42_ok_v31_trailing'] = build(31, SZ, pad=77)
CASES['m42_bad_magic'] = b'ENCRYPTED' + b'\0' * 300
CASES['m42_short_6'] = b'\xAF\x1B\xB1\xFA\x18\x00'
CASES['m42_short_8'] = b'\xAF\x1B\xB1\xFA' + struct.pack('<i', 24)
CASES['m42_short_10'] = b'\xAF\x1B\xB1\xFA' + struct.pack('<i', 24) + b'\0\0'
CASES['m42_offset_beyond'] = build(24, SZ, overrides={2: (100000, 50)})
CASES['m42_range_beyond'] = build(24, SZ, overrides={4: (300, 5000)})
CASES['m42_offset_in_header'] = build(24, SZ, overrides={1: (100, 8)})
CASES['m42_negative'] = build(24, SZ, overrides={5: (-4, 10)})
CASES['m42_overlap'] = build(24, SZ, overrides={7: (270, 60)})
CASES['m42_version_25'] = build(25, SZ)
CASES['m42_version_15'] = build(15, SZ)
CASES['m42_version_150'] = build(150, SZ)
CASES['m42_version_999999'] = build(999999, SZ)
CASES['m42_version_neg'] = build(-5, SZ)
CASES['m42_zero_first_offset'] = b'\xAF\x1B\xB1\xFA' + struct.pack('<i', 24) + b'\0' * 60        # giống fixture 4.1
CASES['m42_huge_first_offset'] = b'\xAF\x1B\xB1\xFA' + struct.pack('<i', 24) + struct.pack('<i', 5000) + b'\0' * 400
CASES['m42_odd_header'] = build(24, SZ, header_pairs=3, extra_header=b'\x01\x02\x03\x04')           # H=36, (36-8)%8=4
CASES['m42_empty'] = b''
rnd = random.Random(42)
CASES['m42_big_stored'] = build(24, [20 * 1024 * 1024] + SZ[1:])            # ~20 MB, lưu STORED
CASES['m42_big_deflated'] = build(24, [30 * 1024 * 1024] + SZ[1:])          # ~30 MB, nén DEFLATE
DEFLATE = {'m42_big_deflated'}
STORED = {'m42_big_stored'}

def write(path, files, method_for_meta):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', info()); z.writestr(APP + 'Exe', macho())
        for p, d, m in files:
            zi = zipfile.ZipInfo(APP + p); zi.compress_type = m; z.writestr(zi, d)

exp = {}
for name, data in CASES.items():
    m = zipfile.ZIP_STORED if name in STORED else zipfile.ZIP_DEFLATED
    write(os.path.join(out, name + '.ipa'), [(UF, J, zipfile.ZIP_DEFLATED), (META, data, m)], m)
    exp[name] = {'size': len(data)}

# IPA không có metadata đủ điều kiện đọc
write(os.path.join(out, 'm42_no_metadata.ipa'), [(UF, J, zipfile.ZIP_DEFLATED), ('Data/globalgamemanagers', J, zipfile.ZIP_DEFLATED)], 0)
write(os.path.join(out, 'm42_mono.ipa'), [('Data/Managed/Assembly-CSharp.dll', J, zipfile.ZIP_DEFLATED), ('Data/Managed/UnityEngine.dll', J, zipfile.ZIP_DEFLATED)], 0)
write(os.path.join(out, 'm42_not_unity.ipa'), [('readme.txt', J, zipfile.ZIP_DEFLATED)], 0)
write(os.path.join(out, 'm42_ambiguous.ipa'), [(UF, J, zipfile.ZIP_DEFLATED), ('Data/A/global-metadata.dat', CASES['m42_ok_v24'], zipfile.ZIP_DEFLATED), ('Data/B/global-metadata.dat', CASES['m42_ok_v24'], zipfile.ZIP_DEFLATED)], 0)
json.dump(exp, open(os.path.join(out, 'm42_expected.json'), 'w'))
print('OK', len(CASES) + 4, 'IPA giả lập Phase 4.2 trong', out)
