#!/usr/bin/env python3
"""IPA GIẢ LẬP cho SUB-PHASE 5.1 (phát hiện/trích xuất font). Font dựng THỦ CÔNG đúng cấu trúc header (sfnt directory, WOFF length, BMFont) – KHÔNG phải font thật,
không có glyph; chỉ để kiểm tra logic phát hiện/trích xuất/kiểm cấu trúc. Dùng: python3 tests/make_font_ipas.py OUT_DIR → OUT_DIR/font_*.ipa + font_expected.json"""
import sys, os, zipfile, plistlib, struct, json, hashlib
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'

def sfnt(magic=b'\x00\x01\x00\x00', tables=(b'cmap', b'head', b'glyf'), pad=64, fill=0xAB, cut=0):
    n = len(tables); hdr = magic + struct.pack('>HHHH', n, 0, 0, 0); dirsz = 12 + 16 * n; off = dirsz; recs = b''; body = b''
    for t in tables:
        ln = pad; recs += t + struct.pack('>III', 0, off, ln); body += bytes([fill]) * ln; off += ln
    d = hdr + recs + body
    return d[:len(d) - cut] if cut else d
def ttc(n_fonts=2):
    fonts = [sfnt(fill=0x10 + i) for i in range(n_fonts)]; hsz = 12 + 4 * n_fonts; blob = b''; offs = []; pos = hsz
    for f in fonts:
        # offsets trong từng font phải tuyệt đối trong TTC: dựng lại với base
        n = 3; base = pos; recs = b''; body = b''; off = base + 12 + 16 * n
        for t in (b'cmap', b'head', b'glyf'): recs += t + struct.pack('>III', 0, off, 64); body += bytes([0x10]) * 64; off += 64
        fb = b'\x00\x01\x00\x00' + struct.pack('>HHHH', n, 0, 0, 0) + recs + body; offs.append(base); blob += fb; pos += len(fb)
    return b'ttcf' + struct.pack('>HHI', 1, 0, n_fonts) + b''.join(struct.pack('>I', o) for o in offs) + blob
def woff(w2=False, body_len=100, wrong_len=None):
    hdr_sz = 48 if w2 else 44; total = hdr_sz + body_len
    h = (b'wOF2' if w2 else b'wOFF') + b'\x00\x01\x00\x00' + struct.pack('>I', wrong_len if wrong_len is not None else total) + struct.pack('>H', 3) + b'\x00' * (hdr_sz - 14)
    return h + b'\x77' * body_len
BM_TXT = b'info face="Test" size=32 bold=0 italic=0 charset="" unicode=1\ncommon lineHeight=36 base=29 scaleW=256 scaleH=256 pages=1 packed=0\npage id=0 file="t.png"\nchars count=0\n'
BM_XML = b'<?xml version="1.0"?>\n<font><info face="Test" size="32"/><common lineHeight="36" base="29"/><pages><page id="0" file="t.png"/></pages></font>'
BM_BIN = b'BMF\x03' + b'\x01' + struct.pack('<I', 5) + b'abcde'
def info(app_fonts=()):
    d = {'CFBundleIdentifier': 'com.test.font', 'CFBundleName': 'FNT', 'CFBundleExecutable': 'Exe'}
    if app_fonts: d['UIAppFonts'] = list(app_fonts)
    return plistlib.dumps(d, fmt=plistlib.FMT_BINARY)
def macho(): return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64
def write(name, files, app_fonts=(), extra=None):
    with zipfile.ZipFile(os.path.join(out, name + '.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', info(app_fonts)); z.writestr(APP + 'Exe', macho())
        for p, d in files.items(): z.writestr(APP + p, d)
        for p, d in (extra or {}).items(): z.writestr(p, d)
sha = lambda b: hashlib.sha256(b).hexdigest()
F = {}
F['Fonts/Main.ttf'] = sfnt(); F['Fonts/Bold.otf'] = sfnt(b'OTTO', (b'CFF ', b'cmap', b'head')); F['Fonts/Pack.ttc'] = ttc(2)
F['Fonts/Web.woff'] = woff(False); F['Fonts/Web2.woff2'] = woff(True)
F['Fonts/atlas/Title.fnt'] = BM_TXT; F['Fonts/atlas/Xml.fnt'] = BM_XML; F['Fonts/atlas/Bin.bmfont'] = BM_BIN
F['Fonts/Dup/Main_copy.ttf'] = F['Fonts/Main.ttf']                       # trùng nội dung
F['Fonts/BadLen.woff'] = woff(False, wrong_len=500)                       # WOFF khai báo length ≠ kích thước thật
F['Fonts/Cut.ttf'] = sfnt(cut=40)                                         # bị cắt cụt
F['Fonts/Fake.ttf'] = b'this is not a font at all' * 5                    # đuôi .ttf nhưng không phải font
F['Fonts/Disguised.ttf'] = woff(False)                                    # woff đặt tên .ttf → sai đuôi
F['Data/NoExt_font'] = sfnt(fill=0x55)                                    # font không đuôi (nhận bằng magic qua manifest)
F['Fonts/Weird.fnt'] = b'MZ\x90\x00' + b'\x00' * 40                       # .fnt không phải BMFont
F['Fonts/sheet.atlas'] = b'sheet.png\nsize: 64,64\nformat: RGBA8888\n'    # atlas (chưa xác minh)
F['Data/level0'] = b'UnityFS\x00' + b'\x00' * 32; F['Data/data.unity3d'] = b'UnityFS\x00' + b'\x00' * 32; F['Data/x.assets'] = b'\x00' * 64
F['Data/readme.txt'] = b'hello'
write('font_all', F, app_fonts=['Fonts/Main.ttf', 'Bold.otf', 'Missing.ttf'])
exp = {'font_all': {k: {'sha': sha(v), 'size': len(v)} for k, v in F.items()}}
write('font_none', {'Data/readme.txt': b'hello'})
write('font_unity_only', {'Data/data.unity3d': b'UnityFS\x00' + b'\x00' * 32, 'Data/x.assets': b'\x00' * 64})
# unsafe path + symlink-like + empty file
write('font_unsafe', {'Fonts/Ok.ttf': sfnt(), 'Fonts/Empty.ttf': b''}, extra={'Payload/Game.app/../evil.ttf': sfnt()})
# nhiều font để kiểm hạn mức (mỗi font 200 B)
write('font_many', {'Fonts/f%02d.ttf' % i: sfnt(fill=i) for i in range(12)})
json.dump(exp, open(os.path.join(out, 'font_expected.json'), 'w'))
print('OK IPA giả lập Phase 5.1 trong', out)
