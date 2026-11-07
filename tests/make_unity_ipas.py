#!/usr/bin/env python3
"""Tạo IPA GIẢ LẬP cho kiểm thử Phase 4.1 (Unity component discovery) + u41_expected.json (SHA-1 tính độc lập bằng hashlib).
Chỉ có cấu trúc thư mục + vài byte magic; KHÔNG phải game thật. Dùng: python3 tests/make_unity_ipas.py OUT_DIR"""
import sys, os, zipfile, plistlib, struct, hashlib, json

out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'
os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
J = b'x' * 16

def info():
    return plistlib.dumps({'CFBundleIdentifier': 'com.test.u41', 'CFBundleName': 'U41', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY)

def macho(cryptid=None):
    if cryptid is None:
        return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64
    lc = struct.pack('<IIIIII', 0x2C, 24, 0x4000, 0x1000, cryptid, 0)           # LC_ENCRYPTION_INFO_64
    return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 1, len(lc), 0, 0) + lc + b'\0' * 64

def meta(v=24): return b'\xAF\x1B\xB1\xFA' + struct.pack('<i', v) + b'\0' * 60
def unityfs(rev='2021.3.16f1'): return b'UnityFS\0' + struct.pack('>I', 8) + b'5.x.x\0' + rev.encode() + b'\0' + b'\0' * 40
UF = 'Frameworks/UnityFramework.framework/UnityFramework'

CASES = {}
CASES['u41_full_il2cpp'] = {
    UF: J, 'Frameworks/UnityFramework.framework/Info.plist': J,
    'Data/Managed/Metadata/global-metadata.dat': meta(24),
    'Data/Resources/unity_builtin_extra': J,
    'Data/Raw/config.json': b'{"a":1}', 'Data/Raw/sub/music.bin': J, 'Data/Raw/StreamingAssets/ab.bin': J,
    'Data/globalgamemanagers': J, 'Data/globalgamemanagers.assets': J, 'Data/globalgamemanagers.assets.resS': J,
    'Data/sharedassets0.assets': J, 'Data/sharedassets0.assets.resS': J, 'Data/sharedassets1.resource': J,
    'Data/level0': J, 'Data/level1': J, 'Data/level1.resS': J,
    'Data/resources.assets': J, 'Data/data2.assets': J, 'Data/a.resource': J, 'Data/b.resS': J,
    'Data/Raw/pack.bundle': unityfs('2021.3.16f1'), 'Data/data.unity3d': unityfs('2021.3.16f1'),
}
CASES['u41_mono'] = {'Data/Managed/Assembly-CSharp.dll': J, 'Data/Managed/UnityEngine.dll': J, 'Data/Managed/mscorlib.dll': J, 'Data/Managed/System.dll': J, 'Data/globalgamemanagers': J}
CASES['u41_conflict'] = {UF: J, 'Data/Managed/Metadata/global-metadata.dat': meta(24), 'Data/Managed/Assembly-CSharp.dll': J}
CASES['u41_no_runtime'] = {UF: J, 'Data/globalgamemanagers': J}
CASES['u41_bad_magic'] = {UF: J, 'Data/Managed/Metadata/global-metadata.dat': b'ENCRYPTED' + b'\0' * 60}
CASES['u41_renamed'] = {UF: J, 'Data/Managed/Metadata/meta.bin': meta(27)}
CASES['u41_two_candidates'] = {UF: J, 'Data/Managed/Metadata/global-metadata.dat': meta(24), 'Data/Extra/global-metadata.dat': meta(24)}
CASES['u41_ambiguous'] = {UF: J, 'Data/A/global-metadata.dat': meta(24), 'Data/B/global-metadata.dat': meta(24)}
CASES['u41_weak_only'] = {'Data/foo.assets': J, 'Data/x.bundle': J}
CASES['u41_not_unity'] = {'readme.txt': J, 'Data/x.bin': J}
CASES['u41_fairplay'] = {UF: J, 'Data/Managed/Metadata/global-metadata.dat': meta(24)}
CASES['u41_flutter_unity'] = {'Frameworks/Flutter.framework/Flutter': J, 'Frameworks/App.framework/flutter_assets/AssetManifest.json': J, UF: J, 'Data/globalgamemanagers': J}
CASES['u41_many_files'] = dict({UF: J, 'Data/Managed/Metadata/global-metadata.dat': meta(24)}, **{'Data/Resources/r%02d.bin' % i: J for i in range(40)})
CASES['u41_case'] = {UF: J, 'Data/Managed/Metadata/GLOBAL-METADATA.DAT': meta(24)}
CASES['u41_empty_meta'] = {UF: J, 'Data/Managed/Metadata/global-metadata.dat': b''}

exp = {}
for name, files in CASES.items():
    with zipfile.ZipFile(os.path.join(out, name + '.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', info())
        z.writestr(APP + 'Exe', macho(1 if name == 'u41_fairplay' else None))
        for p, d in files.items():
            z.writestr(APP + p, d)
            if 'global-metadata' in p.lower() or p.endswith('meta.bin'):
                exp.setdefault(name, {})[p] = {'sha1': hashlib.sha1(d).hexdigest(), 'size': len(d)}
json.dump(exp, open(os.path.join(out, 'u41_expected.json'), 'w'))
print('OK', len(CASES), 'IPA giả lập Phase 4.1 trong', out)
