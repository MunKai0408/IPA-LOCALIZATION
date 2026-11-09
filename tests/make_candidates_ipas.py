#!/usr/bin/env python3
"""IPA GIẢ LẬP cho SUB-PHASE 6.1 (hệ ứng viên chứa text, mọi engine). Chỉ có cấu trúc đường dẫn + vài byte; KHÔNG phải game thật.
Dùng: python3 tests/make_candidates_ipas.py OUT_DIR → OUT_DIR/cand_*.ipa"""
import sys, os, zipfile, plistlib
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'; EXE = 'GameExe'

def plist():
    return plistlib.dumps({'CFBundleIdentifier': 'com.test.game', 'CFBundleName': 'Game', 'CFBundleExecutable': EXE,
                           'CFBundleShortVersionString': '1.0', 'CFBundleVersion': '1'}, fmt=plistlib.FMT_BINARY)
J = b'x' * 32

CASES = {
  # iOS native: 3 ngôn ngữ + InfoPlist
  'cand_ios': {'en.lproj/Localizable.strings': J, 'zh-Hans.lproj/Localizable.strings': J, 'vi.lproj/Localizable.strings': J,
               'en.lproj/InfoPlist.strings': J, 'Base.lproj/Main.storyboardc/Info.plist': J},
  # *.lproj chỉ là metadata (không có .strings)
  'cand_lproj_only': {'en.lproj/Main.storyboardc/x': J, 'fr.lproj/Main.storyboardc/x': J},
  'cand_rpg': {'www/data/System.json': J, 'www/data/Actors.json': J, 'www/data/Items.json': J, 'www/data/Map001.json': J, 'www/js/plugins.js': J},
  'cand_godot': {'game.pck': b'GDPC' + b'\0' * 40, 'translations/en.translation': J, 'translations/zh.translation': J},
  'cand_unreal': {'Content/Localization/Game/en/Game.locres': J, 'Content/Localization/Game/zh-Hans/Game.locres': J, 'Content/Paks/Game.pak': J},
  'cand_unreal_pak': {'Content/Paks/Game.pak': J, 'Game-Content-Paks/x.utoc': J},
  # engine lạ: bảng theo tên
  'cand_generic': {'Data/Localization/en.json': J, 'Data/Localization/zh.json': J, 'Data/dialog.csv': J,
                   'Frameworks/Sdk.framework/strings.json': J, 'assets/img/a.png': J, 'Data/empty_lang.json': b''},
  'cand_none': {'assets/img/a.png': J, 'sound/a.caf': J},
  'cand_unity_bundles': {'Data/Raw/aa/iOS/localization-stringtables-en_assets_all.bundle': J,
                         'Data/Raw/aa/iOS/localization-stringtables-zh_assets_all.bundle': J, 'Data/globalgamemanagers': J},
  # file có đuôi lạ trong thư mục unsafe/traversal: không được tạo ứng viên
  'cand_unsafe': {'../evil/lang_en.json': J, 'ok/readme.txt': J},
}

for name, files in CASES.items():
    p = os.path.join(out, name + '.ipa')
    with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', plist()); z.writestr(APP + EXE, b'\xcf\xfa\xed\xfe' + b'\0' * 60)
        for k, v in files.items():
            z.writestr(APP + k if not k.startswith('../') else APP + k, v)
    print('wrote', p)
