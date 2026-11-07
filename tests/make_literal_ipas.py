#!/usr/bin/env python3
"""IPA GIẢ LẬP cho SUB-PHASE 4.3 (string literal). Metadata giả: header v24 (264 B, cặp #0 = bảng literal 8 B/phần tử {length,dataIndex}, cặp #1 = dữ liệu UTF-8),
dựng độc lập; expected JSON do script tính. KHÔNG phải metadata thật. Dùng: python3 tests/make_literal_ipas.py OUT_DIR"""
import sys, os, zipfile, plistlib, struct, json
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'
os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'; J = b'x' * 16
UF = 'Frameworks/UnityFramework.framework/UnityFramework'; META = 'Data/Managed/Metadata/global-metadata.dat'
def info(): return plistlib.dumps({'CFBundleIdentifier': 'com.test.m43', 'CFBundleName': 'M43', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY)
def macho(): return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64

def build(version, strings, raw_table=None, corrupt=None, extra_sizes=(40, 100), table_size_override=None):
    """strings: list[bytes]; dùng lại dữ liệu cho chuỗi trùng (dataIndex trỏ cùng vị trí)."""
    data = b''; table = b''; pos = {}
    for sb in strings:
        if sb not in pos: pos[sb] = len(data); data += sb
        table += struct.pack('<II', len(sb), pos[sb])
    if raw_table is not None: table = raw_table
    H = 264
    pairs = [[H, len(table) if table_size_override is None else table_size_override], [H + len(table), len(data)]]
    off = H + len(table) + len(data)
    for s in extra_sizes: pairs.append([off, s]); off += s
    while len(pairs) < 32: pairs.append([H, 0])
    hdr = b'\xAF\x1B\xB1\xFA' + struct.pack('<i', version) + b''.join(struct.pack('<ii', o, s) for o, s in pairs)
    assert len(hdr) == 264
    return hdr + table + data + bytes(range(256))[:extra_sizes[0]] + b'\x07' * extra_sizes[1]

def write(name, data, method=zipfile.ZIP_DEFLATED):
    with zipfile.ZipFile(os.path.join(out, name + '.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', info()); z.writestr(APP + 'Exe', macho()); z.writestr(APP + UF, J)
        zi = zipfile.ZipInfo(APP + META); zi.compress_type = method; z.writestr(zi, data)

S = ['Start Game', '', '{0} coins', 'Bắt đầu — Việt hóa ✓', '<color=#FF0000>Hi</color>', 'Start Game', '日本語テキスト', 'x' * 5000, '%d/%s']
exp = {}
sb = [s.encode('utf-8') for s in S]
write('m43_ok_v24', build(24, sb)); exp['m43_ok_v24'] = {'strings': S}
write('m43_ok_v29_stored', build(29, sb), zipfile.ZIP_STORED); exp['m43_ok_v29_stored'] = {'strings': S}
write('m43_v31', build(31, sb)); exp['m43_v31'] = {'strings': S}
write('m43_v33_unsupported', build(33, sb)); write('m43_v35_unsupported', build(35, sb))
bad = sb + [b'\xff\xfe\xc3(', b'ok']
write('m43_invalid_utf8', build(24, bad)); exp['m43_invalid_utf8'] = {'n': len(bad), 'bad_index': len(sb)}
# bảng có 1 mục trỏ ngoài vùng dữ liệu (ít mục hỏng) và bảng hỏng nặng
t = bytearray(b''.join(struct.pack('<II', len(x), 0) for x in sb)); struct.pack_into('<II', t, 8 * 2, 50, 9999999)
write('m43_one_oor', build(24, sb, raw_table=bytes(t))); exp['m43_one_oor'] = {'n': len(sb), 'oor_index': 2}
t2 = b''.join(struct.pack('<II', 100, 0xFFFFFF) for _ in range(20))
write('m43_all_oor', build(24, sb, raw_table=t2))
write('m43_table_not_div8', build(24, sb, table_size_override=len(sb) * 8 + 3))
write('m43_empty_table', build(24, [])); 
big = [('string-%06d' % i).encode() for i in range(120000)]
write('m43_many', build(24, big)); exp['m43_many'] = {'n': len(big)}
json.dump(exp, open(os.path.join(out, 'm43_expected.json'), 'w'), ensure_ascii=False)
print('OK IPA giả lập Phase 4.3 trong', out)
