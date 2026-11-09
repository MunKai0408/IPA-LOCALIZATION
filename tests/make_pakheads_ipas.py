#!/usr/bin/env python3
"""IPA GIẢ LẬP cho module pak_heads (Heaps PAK). KHÔNG phải game thật. Dùng: python3 tests/make_pakheads_ipas.py OUT_DIR"""
import sys, os, zipfile, struct, plistlib
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
plist = plistlib.dumps({'CFBundleIdentifier': 'com.test.game', 'CFBundleName': 'Game', 'CFBundleExecutable': 'GameExe',
                        'CFBundleShortVersionString': '1.0', 'CFBundleVersion': '1'}, fmt=plistlib.FMT_BINARY)

def ent(name, files=None, size=0, pos=0):
    n = name.encode()
    if files is not None:
        return bytes([len(n)]) + n + b'\x01' + struct.pack('<I', len(files)) + b''.join(files)
    return bytes([len(n)]) + n + b'\x00' + struct.pack('<II', pos, size) + b'\xaa\xbb\xcc\xdd'

def heaps(ok_data=True, bad_name=False):
    tree = ent('', [ent('lang', [ent('en.xml', size=10, pos=0), ent('fr.xml', size=10, pos=10)]), ent('data.cdb', size=20, pos=20)])
    hs = 12 + len(tree)
    return b'PAK' + b'\x00' + struct.pack('<II', hs, 40) + tree + (b'DATA' if ok_data else b'XXXX') + b'\x00' * 40

CASES = {
  'pak_heaps': {'res.pak': heaps(), 'res1.pak': b'\x01\x02' * 64},
  'pak_heaps_nodata': {'res.pak': heaps(ok_data=False)},
  'pak_none': {'a.png': b'x' * 8},
  'pak_godot': {'game.pak': b'GDPC' + b'\0' * 40},
}
for name, files in CASES.items():
    with zipfile.ZipFile(os.path.join(out, name + '.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', plist)
        for k, v in files.items(): z.writestr(APP + k, v)
print('OK', list(CASES))
