#!/usr/bin/env python3
"""Sinh font TTF GIẢ LẬP cho run_pakfont_tests.js: vi_full.ttf (đủ 134 chữ Việt + ASCII), vi_none.ttf (chỉ ASCII). Dùng fontTools."""
import sys, os, unicodedata
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
base = 'aăâeêioôơuưy'
vi = set()
for ch in base + base.upper():
    for mark in ['̀', '́', '̃', '̉', '̣', '']:
        c = unicodedata.normalize('NFC', ch + mark)
        if len(c) == 1 and ord(c) > 127: vi.add(ord(c))
vi |= {0x111, 0x110}
def build(path, cps, fam):
    cps = sorted(cps); names = ['.notdef'] + ['g%d' % c for c in cps]
    fb = FontBuilder(1000, isTTF=True); fb.setupGlyphOrder(names); fb.setupCharacterMap({c: 'g%d' % c for c in cps})
    pen = TTGlyphPen(None); pen.moveTo((0, 0)); pen.lineTo((0, 500)); pen.lineTo((500, 500)); pen.closePath(); g = pen.glyph()
    fb.setupGlyf({n: g for n in names}); fb.setupHorizontalMetrics({n: (600, 0) for n in names}); fb.setupHorizontalHeader(ascent=800, descent=-200)
    fb.setupNameTable({'familyName': fam, 'styleName': 'Regular'}); fb.setupOS2(); fb.setupPost(); fb.save(path)
ascii_ = set(range(32, 127))
build(os.path.join(out, 'vi_full.ttf'), ascii_ | vi, 'ViFull'); build(os.path.join(out, 'vi_none.ttf'), ascii_, 'ViNone')
print('ok', len(vi))
