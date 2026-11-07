#!/usr/bin/env python3
"""Tạo IPA giả lập cho kiểm thử Phase 3 + file expected.json (hash tính độc lập bằng hashlib). Dùng: make_scan_ipa.py OUT_DIR"""
import sys, os, zipfile, plistlib, struct, hashlib, json, zlib
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'
os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
plist = plistlib.dumps({'CFBundleIdentifier': 'com.test.scan', 'CFBundleName': 'Scan', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY)
PNG = b'\x89PNG\r\n\x1a\n' + b'\0' * 40
files = {  # tên -> (dữ liệu, kiểu nén)
  'Exe': (b'\xcf\xfa\xed\xfe' + b'\0' * 60, zipfile.ZIP_DEFLATED),
  'icon.png': (PNG, zipfile.ZIP_DEFLATED),
  'fake.png': (b'PK\x03\x04' + b'\0' * 40, zipfile.ZIP_DEFLATED),               # đuôi png nhưng là ZIP
  'font.ttf': (b'\x00\x01\x00\x00' + b'\0' * 40, zipfile.ZIP_STORED),
  'data/config.json': (b'{"a": "b", "n": 1}\n', zipfile.ZIP_DEFLATED),
  'en.lproj/Localizable.strings': (b'bplist00' + b'\0' * 30, zipfile.ZIP_DEFLATED),
  'text/empty.txt': (b'', zipfile.ZIP_STORED),
  'Data/Managed/Metadata/global-metadata.dat': (b'\xAF\x1B\xB1\xFA' + struct.pack('<i', 24) + b'\0' * 100, zipfile.ZIP_DEFLATED),
  'Data/data.unity3d': (b'UnityFS\0' + struct.pack('>I', 8) + b'5.x.x\0' + b'2021.3.16f1\0' + b'\0' * 40, zipfile.ZIP_STORED),
  'Frameworks/UnityFramework.framework/UnityFramework': (b'\xcf\xfa\xed\xfe' + b'x' * 500, zipfile.ZIP_DEFLATED),
  'Data/Managed/Assembly-CSharp.dll': (b'MZ' + b'x' * 200, zipfile.ZIP_DEFLATED),
  'content/=evil name.csv': (b'a,b\n1,2\n', zipfile.ZIP_DEFLATED),               # tên bắt đầu bằng '=' (CSV injection)
  'big/zeros.bin': (b'\0' * (70 * 1024 * 1024), zipfile.ZIP_DEFLATED),           # > 64 MB: chỉ SHA-1
}
exp = {}
with zipfile.ZipFile(os.path.join(out, 'scan_mix.ipa'), 'w') as z:
    z.writestr(APP + 'Info.plist', plist, zipfile.ZIP_DEFLATED)
    for n, (d, c) in files.items():
        z.writestr(zipfile.ZipInfo(APP + n, (2026, 1, 1, 0, 0, 0)), d, c)
        exp[n] = {'size': len(d), 'sha1': hashlib.sha1(d).hexdigest(), 'sha256': hashlib.sha256(d).hexdigest(), 'crc': '%08x' % (zlib.crc32(d) & 0xffffffff)}
    z.writestr('../escape.txt', b'x')   # đường dẫn không an toàn
json.dump(exp, open(os.path.join(out, 'scan_expected.json'), 'w'))
print('OK', len(files), 'file')
