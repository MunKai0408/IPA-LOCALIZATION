#!/usr/bin/env python3
"""IPA GIẢ LẬP cho raw_strings (quét chuỗi thô, mọi engine). KHÔNG phải game thật. Dùng: python3 tests/make_raw_ipas.py OUT_DIR"""
import sys, os, zipfile, plistlib, random
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
plist = plistlib.dumps({'CFBundleIdentifier': 'com.test.raw', 'CFBundleName': 'Raw', 'CFBundleExecutable': 'RawExe', 'CFBundleShortVersionString': '1', 'CFBundleVersion': '1'}, fmt=plistlib.FMT_BINARY)
random.seed(7); junk = lambda n: bytes(random.randrange(256) for _ in range(n))
cdb = ('{"sheets":[{"name":"ui","lines":[{"id":"btn_play","text":"Start your adventure"},{"id":"b2","text":"Quit"},{"id":"b3","text":"Tiếp tục hành trình"}]}]}').encode()
body = junk(3000) + b'\x00' + b'Press any button to continue the game.' + b'\x00' + junk(500) + cdb + junk(800) + 'Welcome back, hero!'.encode('utf-16-le') + junk(200) + b'<s>Settings menu</s>' + junk(300)
pak = b'PAK\x01' + (999).to_bytes(4, 'little') + (5).to_bytes(4, 'little') + b'\x66\x35\x66\x65' + body       # header không đọc được → unsupported
CASES = {
  'raw_pak': {'res.pak': pak, 'data.bin': b'\x00' * 400 + 'Unity-style scene text line here'.encode() + junk(600)},
  'raw_encrypted': {'res.pak': b'PAK\x01' + junk(20000)},
}
for name, files in CASES.items():
    with zipfile.ZipFile(os.path.join(out, name + '.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', plist)
        for k, v in files.items(): z.writestr(APP + k, v)
print('OK', list(CASES))
