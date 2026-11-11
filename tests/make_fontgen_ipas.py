#!/usr/bin/env python3
"""IPA GIẢ LẬP cho smoke test bộ sinh font Việt: pak Heaps (không nén, 1 trang) chứa ui/pix.fnt (ASCII, thiếu chữ Việt) + ui/pix.png thật. KHÔNG phải game thật.
Dùng: python3 tests/make_fontgen_ipas.py OUT_DIR"""
import sys, os, zipfile, struct, plistlib, io
from PIL import Image
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
plist = plistlib.dumps({'CFBundleIdentifier': 'com.test.fontgen', 'CFBundleName': 'Game', 'CFBundleExecutable': 'GameExe', 'CFBundleShortVersionString': '1.0', 'CFBundleVersion': '1'}, fmt=plistlib.FMT_BINARY)
def ent(name, files=None, size=0, pos=0):
    n = name.encode()
    if files is not None: return bytes([len(n)]) + n + b'\x01' + struct.pack('<I', len(files)) + b''.join(files)
    return bytes([len(n)]) + n + b'\x00' + struct.pack('<II', pos, size) + b'\xaa\xbb\xcc\xdd'
def heaps(files):
    data = b''; es = []
    for path, content in files: es.append((path, len(data), len(content))); data += content
    d = {}
    for p, pos, sz in es:
        cur = d; parts = p.split('/')
        for q in parts[:-1]: cur = cur.setdefault(q, {})
        cur[parts[-1]] = (pos, sz)
    def enc(name, node):
        if isinstance(node, tuple): return ent(name, size=node[1], pos=node[0])
        return ent(name, [enc(k, v) for k, v in node.items()])
    t = enc('', d); return b'PAK\x00' + struct.pack('<II', 12 + len(t), len(data)) + t + b'DATA' + data
ids = list(range(33, 127))
fnt = ('info face="Pix" size=-16 bold=0 italic=0 charset="" unicode=1 padding=0,0,0,0 spacing=1,1\ncommon lineHeight=18 base=14 scaleW=256 scaleH=256 pages=1 packed=0\npage id=0 file="pix.png"\nchars count=%d\n' % len(ids)
       + ''.join('char id=%d x=0 y=0 width=8 height=10 xoffset=0 yoffset=3 xadvance=9 page=0 chnl=15\n' % i for i in ids) + 'kernings count=1\nkerning first=65 second=86 amount=-1\n').encode()
buf = io.BytesIO(); Image.new('RGBA', (256, 256), (255, 255, 255, 0)).save(buf, 'PNG')
with zipfile.ZipFile(os.path.join(out, 'fontgen_pak.ipa'), 'w', zipfile.ZIP_STORED) as z:
    z.writestr(APP + 'Info.plist', plist); z.writestr(APP + 'res.pak', heaps([('ui/pix.fnt', fnt), ('ui/pix.png', buf.getvalue())]))
print('OK fontgen_pak.ipa')
