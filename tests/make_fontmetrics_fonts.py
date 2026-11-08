#!/usr/bin/env python3
"""Fixture font cho SUB-PHASE 5.2b+5.3. Font dựng bằng fontTools (ĐỘC LẬP với parser JS); giá trị mong đợi đọc lại bằng fontTools.
Dùng: python3 tests/make_fontmetrics_fonts.py OUT_DIR → OUT_DIR/fm_<tên>.<đuôi> + OUT_DIR/fontmetrics_expected.json"""
import sys, os, json, random, struct, unicodedata
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import TTFont, TTCollection, newTable
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)

REQ = set()
for b in 'aăâeêioôơuưyAĂÂEÊIOÔƠUƯY':
    for t in ['', '\u0300', '\u0309', '\u0303', '\u0301', '\u0323']:
        s = unicodedata.normalize('NFC', b + t)
        if len(s) == 1 and ord(s) > 127: REQ.add(ord(s))
REQ |= {0x111, 0x110}
assert len(REQ) == 134 and min(REQ) == 0xC0 and max(REQ) == 0x1EF9
ASCII = [ord(c) for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz']

def build(path, cps, family='Test Sans', style='Regular', cff=False, scramble=False, version='Version 1.234', names=True, upem=1000, notdef=()):
    cps = sorted(set(cps)); gn = lambda c: '.notdef' if c in notdef else ('uni%04X' % c if c <= 0xFFFF else 'u%X' % c); order = ['.notdef'] + [gn(c) for c in cps if c not in notdef]
    if scramble: rest = order[1:]; random.Random(7).shuffle(rest); order = ['.notdef'] + rest
    fb = FontBuilder(upem, isTTF=not cff); fb.setupGlyphOrder(order)
    fb.setupCharacterMap({c: gn(c) for c in cps})
    if cff: fb.setupCFF(family.replace(' ', '') + '-' + style, {'FullName': family + ' ' + style}, {g: T2CharStringPen(500, None).getCharString() for g in order}, {})
    else: fb.setupGlyf({g: TTGlyphPen(None).glyph() for g in order})
    fb.setupHorizontalMetrics({g: (500, 0) for g in order}); fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': family, 'styleName': style, 'version': version}); fb.setupOS2(); fb.setupPost(); fb.save(path); return path

EXP = {}
def expect(name, path):
    f = TTFont(path, fontNumber=0) if not path.endswith('.ttc') else None
    return f
def describe(path, num=0):
    f = TTFont(path, fontNumber=num); cm = f.getBestCmap() or {}
    nm = f['name']; g = lambda i: (nm.getName(i, 3, 1, 0x409) or nm.getName(i, 1, 0, 0))
    mapped = {c for c, g in cm.items() if g != '.notdef'}; miss = sorted(REQ - mapped)
    return dict(family=g(1).toUnicode() if g(1) else None, subfamily=g(2).toUnicode() if g(2) else None, full=g(4).toUnicode() if g(4) else None, postscript=g(6).toUnicode() if g(6) else None,
                version=g(5).toUnicode() if g(5) else None, upem=f['head'].unitsPerEm, glyphs=f['maxp'].numGlyphs, cps=len(cm), missing=len(miss), covered=134 - len(miss),
                level='full' if not miss else 'none' if len(miss) == 134 else 'partial', ascii_ok=all(c in mapped for c in ASCII))

P = lambda n: os.path.join(out, 'fm_' + n)
full = ASCII + sorted(REQ) + [0x20, 0x2019]
build(P('full_vi_bmp.ttf'), full, 'FullVi Sans', scramble=True); EXP['full_vi_bmp.ttf'] = dict(container='ttf', **describe(P('full_vi_bmp.ttf')), fmt=4)
build(P('full_vi_astral.ttf'), full + [0x1F600], 'FullVi Astral'); EXP['full_vi_astral.ttf'] = dict(container='ttf', **describe(P('full_vi_astral.ttf')), fmt=12)
part = [c for c in sorted(REQ) if not (0x1EA0 <= c <= 0x1EF9)]
build(P('partial_vi.ttf'), ASCII + part, 'Partial Vi'); EXP['partial_vi.ttf'] = dict(container='ttf', **describe(P('partial_vi.ttf')), fmt=4)
build(P('ascii_only.ttf'), ASCII + [0x20], 'Ascii Only', scramble=True); EXP['ascii_only.ttf'] = dict(container='ttf', **describe(P('ascii_only.ttf')), fmt=4)
build(P('cff_full.otf'), full, 'Cff Full', cff=True); EXP['cff_full.otf'] = dict(container='otf', **describe(P('cff_full.otf')), fmt=4)
build(P('almost_full.ttf'), ASCII + [c for c in sorted(REQ) if c != 0x1EF9], 'Almost Full'); EXP['almost_full.ttf'] = dict(container='ttf', **describe(P('almost_full.ttf')), fmt=4)
build(P('nonascii_letters_missing.ttf'), sorted(REQ), 'No Ascii'); EXP['nonascii_letters_missing.ttf'] = dict(container='ttf', **describe(P('nonascii_letters_missing.ttf')), fmt=4)
ND = {0x1EA0, 0x111}
build(P('notdef_seq.ttf'), full, 'Notdef Seq', notdef=ND); EXP['notdef_seq.ttf'] = dict(container='ttf', **{k: v for k, v in describe(P('notdef_seq.ttf')).items() if k != 'cps'}, fmt=4)
build(P('notdef_scr.ttf'), full, 'Notdef Scr', scramble=True, notdef=ND); EXP['notdef_scr.ttf'] = dict(container='ttf', **{k: v for k, v in describe(P('notdef_scr.ttf')).items() if k != 'cps'}, fmt=4)
build(P('notdef_astral.ttf'), full + [0x1F600], 'Notdef Astral', notdef=ND); EXP['notdef_astral.ttf'] = dict(container='ttf', **{k: v for k, v in describe(P('notdef_astral.ttf')).items() if k != 'cps'}, fmt=12)
build(P('upem_bad.ttf'), full, 'Upem Bad', upem=8); EXP['upem_bad.ttf'] = dict(container='ttf', expect_problem='unitsPerEm')
# TTC
c = TTCollection(); c.fonts = [TTFont(P('full_vi_bmp.ttf')), TTFont(P('partial_vi.ttf'))]; c.save(P('two.ttc'))
EXP['two.ttc'] = dict(container='ttc', fonts=[describe(P('two.ttc'), 0), describe(P('two.ttc'), 1)])
# WOFF
w = TTFont(P('full_vi_bmp.ttf')); w.flavor = 'woff'; w.save(P('full_vi.woff')); EXP['full_vi.woff'] = dict(container='woff', **describe(P('full_vi.woff')), fmt=4)
w = TTFont(P('partial_vi.ttf')); w.flavor = 'woff'; w.save(P('partial_vi.woff')); EXP['partial_vi.woff'] = dict(container='woff', **describe(P('partial_vi.woff')), fmt=4)
open(P('stub.woff2'), 'wb').write(b'wOF2' + b'\0' * 200); EXP['stub.woff2'] = dict(container='woff2')
# Tên chỉ có bản ghi Mac (MacRoman)
f = TTFont(P('ascii_only.ttf')); nm = f['name']; nm.names = []
nm.setName('Café Mono', 1, 1, 0, 0); nm.setName('Regular', 2, 1, 0, 0); nm.setName('Café Mono Regular', 4, 1, 0, 0); nm.setName('CafeMono-Regular', 6, 1, 0, 0); f.save(P('mac_names.ttf'))
EXP['mac_names.ttf'] = dict(container='ttf', family='Café Mono', subfamily='Regular', full='Café Mono Regular', postscript='CafeMono-Regular')
# cmap chỉ có (3,0) symbol → không có cmap Unicode
f = TTFont(P('full_vi_bmp.ttf')); old = f['cmap'].tables[0]; sub = type(old)(4); sub.platformID, sub.platEncID, sub.language = 3, 0, 0; sub.cmap = {0xF000 + k: v for k, v in list(old.cmap.items())[:50]}
f['cmap'].tables = [sub]; f.save(P('symbol_cmap.ttf')); EXP['symbol_cmap.ttf'] = dict(container='ttf', cmap_status='no_unicode_cmap')
# Hỏng
full_bytes = open(P('full_vi_bmp.ttf'), 'rb').read()
open(P('truncated.ttf'), 'wb').write(full_bytes[:int(len(full_bytes) * 0.55)]); EXP['truncated.ttf'] = dict(container='ttf', expect_problem='vượt file')
def tabledir(b):
    n = struct.unpack('>H', b[4:6])[0]; return {b[12 + i * 16:16 + i * 16].decode('latin1'): (12 + i * 16, struct.unpack('>II', b[20 + i * 16:28 + i * 16])) for i in range(n)}
d = tabledir(full_bytes)
bad = bytearray(full_bytes); co = d['cmap'][1][0]; struct.pack_into('>H', bad, co + 2, 0xFFFF); open(P('cmap_bad.ttf'), 'wb').write(bytes(bad)); EXP['cmap_bad.ttf'] = dict(container='ttf', cmap_status='invalid')
bad = bytearray(full_bytes); struct.pack_into('>H', bad, 4, 0xFFFF); open(P('numtables_huge.ttf'), 'wb').write(bytes(bad)); EXP['numtables_huge.ttf'] = dict(status='invalid')
bad = bytearray(full_bytes); bad[d['head'][0]:d['head'][0] + 4] = b'hexd'; open(P('no_head.ttf'), 'wb').write(bytes(bad)); EXP['no_head.ttf'] = dict(container='ttf', expect_problem='head')
bad = bytearray(full_bytes); struct.pack_into('>H', bad, d['cmap'][1][0] + 2, 3); 
open(P('random.bin'), 'wb').write(random.Random(3).randbytes(500)); EXP['random.bin'] = dict(status='not_font')
open(P('empty.bin'), 'wb').write(b''); EXP['empty.bin'] = dict(status='not_font')
open(P('tiny.ttf'), 'wb').write(b'\x00\x01\x00\x00\x00\x01'); EXP['tiny.ttf'] = dict(status='not_font')
json.dump(EXP, open(os.path.join(out, 'fontmetrics_expected.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok', len(EXP), 'font ->', out, '| required', len(REQ))

# ---- IPA chứa font thật (cho test end-to-end qua pipeline FontDump) ----
import zipfile, plistlib
APP = 'Payload/Game.app/'
with zipfile.ZipFile(os.path.join(out, 'fm_all.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(APP + 'Info.plist', plistlib.dumps({'CFBundleIdentifier': 'com.test.fm', 'CFBundleName': 'FM', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY))
    z.writestr(APP + 'Exe', struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64)
    for nm in ('full_vi_bmp.ttf', 'partial_vi.ttf', 'ascii_only.ttf', 'cff_full.otf', 'two.ttc', 'full_vi.woff', 'mac_names.ttf'):
        z.writestr(APP + 'Fonts/' + nm, open(P(nm), 'rb').read())
print('ipa ok')
