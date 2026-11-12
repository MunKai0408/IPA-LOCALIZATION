#!/usr/bin/env python3
"""Fixture GIẢ LẬP cho kiểm kê object Unity (unity_inventory/1). Dùng lại bộ dựng SerializedFile của make_serialized_ipas.py (exec phần đầu, trước 'def O(').
Dùng: python3 tests/make_inventory_ipas.py OUT_DIR → OUT_DIR/inv_all.ipa, OUT_DIR/inventory_expected.json"""
import sys, os, zipfile, plistlib, struct, json
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, 'make_serialized_ipas.py'), encoding='utf-8').read().split('def O(')[0]
exec(compile(src, 'make_serialized_ipas(head)', 'exec'))   # cung cấp build, astr, textasset, monoscript, sfnt, align, APP, out
def O(pid, cid, data, tidx=0, **kw): return dict(pid=pid, cid=cid, data=data, tidx=tidx, **kw)
def mbdata(name, e='<', pp=12): return bytes(pp) + b'\1\0\0\0' + bytes(pp) + astr(name.encode(), e) + bytes(8)
JSONT = '{"hello":"Xin chào"}'.encode('utf-8'); CSVT = b'a,b\n1,2\n3,4'; BIN = bytes([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x81]) * 7
SI2 = ('LanguageSourceData', 'LanguageSourceData', 'I2.Loc', 'Assembly-CSharp'); STM = ('TextMeshProUGUI', 'TextMeshProUGUI', 'TMPro', 'Unity.TextMeshPro')
ty = [dict(cid=49, sti=-1), dict(cid=28, sti=-1), dict(cid=128, sti=-1), dict(cid=115, sti=-1), dict(cid=114, sti=0), dict(cid=114, sti=1), dict(cid=102, sti=-1), dict(cid=9999, sti=-1)]
l0 = [O(1, 49, textasset('Localization_en', JSONT, '<'), 0), O(2, 49, textasset('config', CSVT, '<'), 0), O(3, 49, textasset('blob', BIN, '<'), 0),
      O(5, 115, monoscript(*SI2, '<'), 3), O(6, 115, monoscript(*STM, '<'), 3),
      O(10, 114, mbdata('I2Languages'), 4), O(11, 114, mbdata('Title'), 5), O(12, 114, mbdata('Subtitle'), 5), O(13, 114, mbdata('Title'), 5),
      O(20, 102, bytes(32), 6), O(21, 9999, bytes(16), 7)]
FILES = {}; EXP = {}
FILES['Data/level0'] = build(17, True, ty, l0, scripts=[(0, 5), (0, 6)])
cb = {}
for o in l0:
    nm = {49: 'TextAsset', 115: 'MonoScript', 114: 'MonoBehaviour', 102: 'TextMesh', 9999: 'ClassID 9999'}[o['cid']]; cb[nm] = cb.get(nm, 0) + len(o['data'])
EXP['level0_class_bytes'] = cb
# level1: v13 (PPtr 8 byte), script ở object; chỉ có MonoBehaviour (kiểm tra đọc tên khi file không có TextAsset/Font)
ty13 = [dict(cid=115, sti=-1), dict(cid=114, sti=-1)]
FILES['Data/level1'] = build(13, True, ty13, [O(4, 115, monoscript(*STM, '<'), 0), O(6, 114, mbdata('V13Name', pp=8), 1, sti=0)], scripts=[(0, 4)])
# level2: chỉ MonoBehaviour trỏ script ở file khác, không có MonoScript nào trong file
FILES['Data/level2'] = build(17, True, [dict(cid=114, sti=0)], [O(1, 114, mbdata('OnlyMB'), 0)], scripts=[(1, 77)], externals=['level1'])
EXP['strings'] = {'json': JSONT.decode('utf-8'), 'csv': CSVT.decode()}
with zipfile.ZipFile(os.path.join(out, 'inv_all.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(APP + 'Info.plist', plistlib.dumps({'CFBundleIdentifier': 'com.test.inv', 'CFBundleName': 'INV', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY))
    z.writestr(APP + 'Exe', struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64)
    for p, d in FILES.items(): z.writestr(APP + p, d)
json.dump(EXP, open(os.path.join(out, 'inventory_expected.json'), 'w'), ensure_ascii=False, indent=1)
for p, d in FILES.items(): open(os.path.join(out, 'inv_raw_' + p.replace('/', '__')), 'wb').write(d)
print('ok', len(FILES), 'file ->', out)
