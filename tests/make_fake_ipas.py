#!/usr/bin/env python3
"""Tạo IPA giả lập (chỉ cấu trúc + vài byte magic) để kiểm thử detect_engine. Dùng: python3 make_fake_ipas.py OUT_DIR"""
import sys, os, zipfile, plistlib, struct

out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'
os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
EXE = 'GameExe'

def plist(extra=None):
    d = {'CFBundleIdentifier': 'com.test.game', 'CFBundleName': 'Game', 'CFBundleExecutable': EXE,
         'CFBundleShortVersionString': '1.0', 'CFBundleVersion': '1'}
    d.update(extra or {})
    return plistlib.dumps(d, fmt=plistlib.FMT_BINARY)

def unityfs(rev='2021.3.16f1'):
    return b'UnityFS\0' + struct.pack('>I', 8) + b'5.x.x\0' + rev.encode() + b'\0' + b'\0' * 32

def metadata(ver=24):
    return b'\xAF\x1B\xB1\xFA' + struct.pack('<i', ver) + b'\0' * 32

def gdpc(ver=(4, 2, 1)):
    return b'GDPC' + struct.pack('<IIII', 2, *ver) + b'\0' * 32

HERMES = bytes([0xC6, 0x1F, 0xBC, 0x03, 0xC1, 0x03, 0x19, 0x1F]) + struct.pack('<I', 96) + b'\0' * 32
GM = b'FORM' + struct.pack('<I', 100) + b'GEN8' + b'\0' * 32
J = b'x' * 16

CASES = {
  'unity_il2cpp': {
    'Frameworks/UnityFramework.framework/UnityFramework': J,
    'Data/Managed/Metadata/global-metadata.dat': metadata(24),
    'Data/globalgamemanagers': J, 'Data/data.unity3d': unityfs()},
  'unity_mono': {
    'Data/Managed/Assembly-CSharp.dll': J, 'Data/Managed/UnityEngine.dll': J,
    'Data/Managed/mscorlib.dll': J, 'Data/globalgamemanagers': J},
  'unity_conflict': {
    'Frameworks/UnityFramework.framework/UnityFramework': J,
    'Data/Managed/Metadata/global-metadata.dat': metadata(24),
    'Data/Managed/Assembly-CSharp.dll': J},
  'unity_novariant': {
    'Frameworks/UnityFramework.framework/UnityFramework': J, 'Data/globalgamemanagers': J},
  'unity_weak_only': {'Data/foo.assets': J},
  'unity_bad_magic': {'Data/Managed/Metadata/global-metadata.dat': b'ENCRYPTED' + b'\0' * 40},
  'unreal': {'cookeddata/Game/Content/Paks/Game.pak': J, 'Game-Content-Paks/x.utoc': J, 'Game-Content-Paks/x.ucas': J},
  'flutter': {'Frameworks/Flutter.framework/Flutter': J, 'Frameworks/App.framework/App': J,
              'Frameworks/App.framework/flutter_assets/AssetManifest.json': J,
              'Frameworks/App.framework/flutter_assets/FontManifest.json': J},
  'react_native': {'main.jsbundle': HERMES, 'Frameworks/hermes.framework/hermes': J},
  'godot': {'game.pck': gdpc()},
  'godot_one_medium_nomagic': {'a.pck': b'NOPE' + b'\0' * 40},
  'native_ios': {'Frameworks/libswiftCore.dylib': J, 'Base.lproj/Main.storyboardc/Info.plist': J},
  'native_weak_only': {'Assets.car': J},
  'unknown': {'Data/x.bin': J, 'readme.txt': J},
  'cocos_creator': {'assets/main/index.js': J, 'assets/main/config.json': J, 'jsb-adapter/x.js': J, 'project.manifest': J},
  'gamemaker': {'game.ios': GM, 'data.win': GM},
  'defold': {'game.arcd': J, 'game.projectc': J, 'game.project': J},
  'solar2d': {'resource.car': J, 'config.lua': J},
  'renpy': {'renpy/common/x': J, 'game/script.rpyc': J, 'lib/x.rpa': J},
  'rpgmaker_mv': {'www/js/rpg_core.js': J, 'www/data/System.json': J, 'www/js/plugins.js': J},
  'rpgmaker_mz': {'js/rmmz_core.js': J, 'data/System.json': J},
  'multi_flutter_unity': {'Frameworks/Flutter.framework/Flutter': J, 'Frameworks/App.framework/flutter_assets/AssetManifest.json': J,
                          'Frameworks/UnityFramework.framework/UnityFramework': J},
}

for name, files in CASES.items():
    with zipfile.ZipFile(os.path.join(out, name + '.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', plist())
        z.writestr(APP + EXE, J)
        for p, data in files.items():
            z.writestr(APP + p, data)
print('Đã tạo', len(CASES), 'IPA giả lập trong', out)
