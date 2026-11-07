#!/usr/bin/env python3
"""Dẫn xuất schema struct IL2CPP metadata TRỰC TIẾP từ file nguồn Il2CppDumper/Il2Cpp/MetadataClass.cs (nguồn đã xác minh, MIT).
Dùng: python3 tests/derive_schema_from_cs.py PATH/MetadataClass.cs OUT.json [COMMIT]
Kết quả là fixture để test đối chiếu với bảng schema viết tay trong js/modules/metadata_tables.js (không thay thế nguồn)."""
import re, sys, json
src, out = sys.argv[1], sys.argv[2]
commit = sys.argv[3] if len(sys.argv) > 3 else None
WANT = ['Il2CppGlobalMetadataHeader', 'Il2CppAssemblyDefinition', 'Il2CppAssemblyNameDefinition', 'Il2CppImageDefinition',
        'Il2CppTypeDefinition', 'Il2CppMethodDefinition', 'Il2CppParameterDefinition', 'Il2CppFieldDefinition']
text = open(src, encoding='utf-8-sig').read()
schema = {}; cur = None; pend = {}
for line in text.splitlines():
    s = line.strip()
    m = re.match(r'public class (\w+)', s)
    if m: cur = m.group(1) if m.group(1) in WANT else None; pend = {}; 
    if m and cur: schema[cur] = []; continue
    if cur is None: continue
    a = re.match(r'\[Version\((.*)\)\]', s)
    if a:
        pend = {}
        for k, v in re.findall(r'(Min|Max)\s*=\s*([0-9.]+)', a.group(1)): pend[k.lower()] = float(v) if '.' in v else int(v)
        continue
    if re.match(r'\[ArrayLength\(Length\s*=\s*(\d+)\)\]', s): pend['len'] = int(re.match(r'\[ArrayLength\(Length\s*=\s*(\d+)\)\]', s).group(1)); continue
    f = re.match(r'public (uint|int|ushort|short|byte\[\]|Il2CppAssemblyNameDefinition) (\w+);', s)
    if f:
        schema[cur].append({'name': f.group(2), 'type': f.group(1), 'min': pend.get('min', 0), 'max': pend.get('max', 99), 'len': pend.get('len')})
        pend = {}
json.dump({'source': 'Perfare/Il2CppDumper Il2CppDumper/Il2Cpp/MetadataClass.cs', 'commit': commit, 'classes': schema}, open(out, 'w'), indent=1)
print({k: len(v) for k, v in schema.items()})
