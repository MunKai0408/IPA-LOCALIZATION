#!/usr/bin/env python3
"""IPA GIẢ LẬP cho text_extract (iOS strings/stringsdict/xcstrings/json/csv/po/xml + pak Heaps nén deflate có text & font). KHÔNG phải game thật.
Dùng: python3 tests/make_text_ipas.py OUT_DIR"""
import sys, os, zipfile, struct, plistlib, json
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
plist = plistlib.dumps({'CFBundleIdentifier': 'com.test.game', 'CFBundleName': 'Game', 'CFBundleExecutable': 'GameExe',
                        'CFBundleShortVersionString': '1.0', 'CFBundleVersion': '1'}, fmt=plistlib.FMT_BINARY)

def ent(name, files=None, size=0, pos=0):
    n = name.encode()
    if files is not None:
        return bytes([len(n)]) + n + b'\x01' + struct.pack('<I', len(files)) + b''.join(files)
    return bytes([len(n)]) + n + b'\x00' + struct.pack('<II', pos, size) + b'\xaa\xbb\xcc\xdd'

def heaps(files):
    data = b''; es = []
    for path, content in files:
        es.append((path, len(data), len(content))); data += content
    def tree():
        d = {}
        for p, pos, sz in es:
            parts = p.split('/'); cur = d
            for q in parts[:-1]: cur = cur.setdefault(q, {})
            cur[parts[-1]] = (pos, sz)
        def enc(name, node):
            if isinstance(node, tuple): return ent(name, size=node[1], pos=node[0])
            return ent(name, [enc(k, v) for k, v in node.items()])
        return enc('', d)
    t = tree(); hs = 12 + len(t)
    return b'PAK\x00' + struct.pack('<II', hs, len(data)) + t + b'DATA' + data

ttf = b'\x00\x01\x00\x00' + b'\x00' * 60
strings = '/* c */\n"hello" = "Xin chào %@!";\n"quit" = "Quit\\nGame";\n"empty" = "";\n'.encode('utf-16')
sdict = plistlib.dumps({'items': {'NSStringLocalizedFormatKey': '%#@n@', 'n': {'NSStringFormatSpecTypeKey': 'NSStringPluralRuleType', 'NSStringFormatValueTypeKey': 'd', 'one': '%d item', 'other': '%d items'}}}, fmt=plistlib.FMT_XML)
xcs = json.dumps({'sourceLanguage': 'en', 'strings': {'Play': {'localizations': {'en': {'stringUnit': {'state': 'translated', 'value': 'Play'}}, 'vi': {'stringUnit': {'state': 'translated', 'value': 'Chơi'}}}}}}).encode()
pak_files = [('lang/en.xml', b'<l><t id="hi">Hello %s &amp; welcome</t><t id="bye">Goodbye</t></l>'), ('lang/fr.xml', '<l><t id="hi">Bonjour %s</t></l>'.encode()),
             ('data.cdb', json.dumps({'sheets': [{'name': 'items', 'lines': [{'id': 'Sword', 'name': 'Sword of doom'}]}]}).encode()),
             ('fonts/main.ttf', ttf), ('fonts/bad.ttf', b'NOTAFONT' * 4), ('img/a.png', b'\x89PNG' + b'0' * 20)]
CASES = {
  'text_ios': {'en.lproj/Localizable.strings': strings, 'vi.lproj/Localizable.stringsdict': sdict, 'Localizable.xcstrings': xcs,
               'Data/Localization/en.json': json.dumps({'ui': {'start': 'Start the game', 'id': 'btn_start_01', 'n': 5}}).encode(),
               'Data/dialog.csv': b'id,en,vi\nd1,"Hello, world",Chao\nd2,Bye,Tam biet\n',
               'translations/vi.po': b'msgid ""\nmsgstr ""\n\nmsgctxt "menu"\nmsgid "Quit"\nmsgstr "Tho\\u00e1t"\n\nmsgid "Save"\nmsgstr "L\xc6\xb0u"\n',
               'values/strings.xml': b'<resources><string name="app">My Game</string></resources>',
               'bad/lang.json': b'{not json', 'Frameworks/X.framework/lang.json': b'{"a":"Should be skipped"}'},
  'text_pak': {'res.pak': heaps(pak_files)},   # lưu DEFLATE (như IPA thật: pak bị nén)
  'text_pak_wrong': {'res.pak': b'PAK\x00' + struct.pack('<II', 40, 10) + ent('', [ent('lang', [ent('en.xml', size=10, pos=0)])]) + b'DATA' + b'\xff\xfe\x00\x01' * 10},
}
for name, files in CASES.items():
    with zipfile.ZipFile(os.path.join(out, name + '.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(APP + 'Info.plist', plist)
        for k, v in files.items(): z.writestr(APP + k, v)
print('OK', list(CASES))
