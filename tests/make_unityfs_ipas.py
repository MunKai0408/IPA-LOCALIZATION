#!/usr/bin/env python3
"""Fixture GIẢ LẬP cho SUB-PHASE 5.2a (parser UnityFS). Bundle dựng THỦ CÔNG theo bố cục UnityFS mà module JS giả định (không phải bundle Unity thật!).
Nén LZMA bằng module `lzma` của Python (FORMAT_RAW, tự thêm 5 byte props+dict), nén LZ4 bằng bộ nén tự viết bên dưới (độc lập với bộ giải nén JS).
Dùng: python3 tests/make_unityfs_ipas.py OUT_DIR → OUT_DIR/ufs_all.ipa, OUT_DIR/ufs_raw_<tên>.bin, OUT_DIR/unityfs_expected.json"""
import sys, os, zipfile, plistlib, struct, json, hashlib, lzma, random
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake_ipas'; os.makedirs(out, exist_ok=True)
APP = 'Payload/Game.app/'
sha = lambda b: hashlib.sha256(b).hexdigest()

def lz4_compress(src):
    n = len(src); o = bytearray(); table = {}; anchor = 0; i = 0; end = n - 5
    def emit(lit_end, off=None, mlen=None):
        nonlocal anchor
        lit = lit_end - anchor; tok = (min(lit, 15) << 4)
        if mlen is not None: tok |= min(mlen - 4, 15)
        o.append(tok)
        if lit >= 15:
            r = lit - 15
            while r >= 255: o.append(255); r -= 255
            o.append(r)
        o.extend(src[anchor:lit_end])
        if mlen is not None:
            o.extend(struct.pack('<H', off))
            if mlen - 4 >= 15:
                r = mlen - 4 - 15
                while r >= 255: o.append(255); r -= 255
                o.append(r)
    while i + 4 <= end:
        key = bytes(src[i:i + 4]); c = table.get(key); table[key] = i
        if c is not None and i - c <= 65535:
            m = 4
            while i + m < end and src[c + m] == src[i + m]: m += 1
            emit(i, i - c, m); i += m; anchor = i
        else: i += 1
    emit(n); return bytes(o)

def lzma_compress(data, lc=3, lp=0, pb=2, dict_size=1 << 20):
    raw = lzma.compress(data, format=lzma.FORMAT_RAW, filters=[{'id': lzma.FILTER_LZMA1, 'dict_size': dict_size, 'lc': lc, 'lp': lp, 'pb': pb}])
    return bytes([(pb * 5 + lp) * 9 + lc]) + struct.pack('<I', dict_size) + raw

def comp(method, data, **kw):
    if method == 0: return data
    if method == 1: return lzma_compress(data, **kw)
    if method in (2, 3): return lz4_compress(data)
    raise ValueError(method)

def content(seed, size):
    """Dữ liệu có cả phần lặp gần/xa và byte ngẫu nhiên để thực sự dùng match/rep/literal."""
    r = random.Random(seed); buf = bytearray(); words = [bytes(r.getrandbits(8) for _ in range(r.randint(3, 12))) for _ in range(40)]
    while len(buf) < size:
        k = r.random()
        if k < 0.5: buf += r.choice(words)
        elif k < 0.7: buf += bytes(r.getrandbits(8) for _ in range(r.randint(1, 30)))
        elif k < 0.85 and len(buf) > 300: s = r.randint(0, len(buf) - 200); buf += buf[s:s + r.randint(20, 200)]
        else: buf += bytes([r.getrandbits(8)]) * r.randint(5, 80)
    return bytes(buf[:size])

def cstr(s): return s.encode('utf-8') + b'\0'
def a16(n): return (n + 15) & ~15

def build(version=7, rev='2021.3.10f1', minp='5.x.x', nodes=None, info_comp=2, block_comp=(2,), block_size=65536, at_end=False, pad_flag=False, lzma_kw=None, info_flags_extra=0,
          size_override=None, node_override=None, blockflags_override=None):
    nodes = nodes or [('CAB-aaaa', 4, content(1, 50000)), ('CAB-aaaa.resS', 0, content(2, 120000))]
    data = b''.join(d for _, _, d in nodes)
    blocks = []; cdata = b''; i = 0; pos = 0
    while pos < len(data) or (not data and not blocks):
        chunk = data[pos:pos + block_size]; m = block_comp[i % len(block_comp)]; c = comp(m, chunk, **(lzma_kw or {})); fl = m | (0x40 if i % 2 else 0)
        if blockflags_override and i in blockflags_override: fl = blockflags_override[i]
        blocks.append((len(chunk), len(c), fl)); cdata += c; pos += len(chunk); i += 1
        if not data: break
    info = b'\x11' * 16 + struct.pack('>i', len(blocks)) + b''.join(struct.pack('>IIH', u, c, f) for u, c, f in blocks) + struct.pack('>i', len(nodes))
    off = 0
    for idx, (p, fl, d) in enumerate(nodes):
        o2, s2 = (node_override[idx] if node_override and idx in node_override else (off, len(d)))
        info += struct.pack('>qqI', o2, s2, fl) + cstr(p); off += len(d)
    cinfo = comp(info_comp, info, **(lzma_kw or {}))
    flags = info_comp | 0x40 | (0x80 if at_end else 0) | (0x200 if pad_flag else 0) | info_flags_extra
    hdr = b'UnityFS\0' + struct.pack('>I', version) + cstr(minp) + cstr(rev)
    tail = struct.pack('>qIII', 0, len(cinfo), len(info), flags)
    head = hdr + tail
    if version >= 7: head += b'\0' * (a16(len(head)) - len(head))
    if at_end: body = cdata + cinfo
    else:
        body = cinfo
        if pad_flag: body += b'\0' * (a16(len(head) + len(body)) - len(head) - len(body))
        body += cdata
    total = len(head) + len(body)
    raw = bytearray(head + body); psz = len(hdr)
    struct.pack_into('>q', raw, psz, total if size_override is None else size_override)
    return bytes(raw), nodes, blocks

EXP = {}; RAW = {}
def add(name, bundle_tuple, extra=None):
    raw, nodes, blocks = bundle_tuple; RAW[name] = raw
    e = {'size': len(raw), 'sha256': sha(raw), 'blocks': len(blocks), 'total_uncompressed': sum(b[0] for b in blocks), 'block_flags': [b[2] for b in blocks],
         'nodes': [{'path': p, 'flags': fl, 'size': len(d), 'sha256': sha(d)} for p, fl, d in nodes]}
    e.update(extra or {}); EXP[name] = e

# ---- bundle hợp lệ ----
add('v7_lz4_info_lz4', build(7, info_comp=2, block_comp=(2,)), {'comp': 'LZ4', 'rev': '2021.3.10f1'})
add('v7_lz4hc', build(7, info_comp=3, block_comp=(3, 2), rev='2020.3.34f1'), {'comp': 'LZ4HC', 'rev': '2020.3.34f1'})
add('v6_lzma', build(6, rev='2018.4.36f1', info_comp=1, block_comp=(1,)), {'comp': 'LZMA', 'rev': '2018.4.36f1'})
add('v7_none', build(7, info_comp=0, block_comp=(0,)), {'comp': 'none', 'rev': '2021.3.10f1'})
add('v7_info_at_end', build(7, info_comp=2, block_comp=(2, 1), at_end=True), {'comp': 'LZ4', 'rev': '2021.3.10f1'})
add('v6_info_at_end', build(6, info_comp=1, block_comp=(1,), at_end=True), {'comp': 'LZMA', 'rev': '2021.3.10f1'})
add('v7_pad_flag', build(7, info_comp=1, block_comp=(1, 2), pad_flag=True), {'comp': 'LZMA', 'rev': '2021.3.10f1'})
add('v7_mixed_blocks', build(7, info_comp=2, block_comp=(0, 1, 2, 3), block_size=30000), {'comp': 'LZ4', 'rev': '2021.3.10f1'})
add('lzma_params', build(7, info_comp=1, block_comp=(1,), lzma_kw={'lc': 0, 'lp': 2, 'pb': 0}), {'comp': 'LZMA', 'rev': '2021.3.10f1'})
add('lzma_big_far', build(7, info_comp=2, block_comp=(1,), block_size=4 << 20, nodes=[('CAB-big', 4, content(9, 2500000))], lzma_kw={'dict_size': 4 << 20}), {'comp': 'LZ4', 'rev': '2021.3.10f1'})
add('single_empty_node', build(7, info_comp=2, block_comp=(2,), nodes=[('CAB-empty', 4, b'')]), {'comp': 'LZ4', 'rev': '2021.3.10f1'})
add('unicode_node_path', build(7, info_comp=2, block_comp=(2,), nodes=[('CAB-việt', 4, content(3, 3000)), ('assets/Ảnh/ñ.resS', 0, content(4, 2000))]), {'comp': 'LZ4', 'rev': '2021.3.10f1'})

# ---- bundle có vấn đề ----
ok_raw = RAW['v7_lz4_info_lz4']
add('node_out_of_range', build(7, node_override={1: (100, 99999999)}), {})
add('unsafe_node_path', build(7, nodes=[('../evil', 4, content(5, 100)), ('/abs/path', 0, content(6, 100)), ('CAB-ok', 4, content(7, 100))]), {})
add('block_lzham', build(7, blockflags_override={0: 4}), {})
add('size_field_wrong', build(7, size_override=123456789), {})
trunc = ok_raw[:-100]; RAW['truncated'] = trunc; EXP['truncated'] = {'size': len(trunc)}
trunc_hdr = ok_raw[:30]; RAW['truncated_header'] = trunc_hdr; EXP['truncated_header'] = {'size': 30}
corrupt = bytearray(ok_raw)
raw0, _, _ = build(7, info_comp=1); c2 = bytearray(raw0)
for k in range(60, 90): c2[k] ^= 0x5A
RAW['info_corrupt_lzma'] = bytes(c2); EXP['info_corrupt_lzma'] = {'size': len(c2)}
raw1, _, _ = build(7, info_comp=2); c3 = bytearray(raw1)
for k in range(64, 80): c3[k] ^= 0xFF
RAW['info_corrupt_lz4'] = bytes(c3); EXP['info_corrupt_lz4'] = {'size': len(c3)}
lh = bytearray(ok_raw); psz = 8 + 4 + len(b'5.x.x\0') + len(b'2021.3.10f1\0'); lh[psz + 20 - 1] = (lh[psz + 20 - 1] & ~0x3F) | 4   # info nén LZHAM (4)
RAW['info_lzham'] = bytes(lh); EXP['info_lzham'] = {'size': len(lh)}
v9 = bytearray(ok_raw); v9[8:12] = struct.pack('>I', 9); RAW['version_9'] = bytes(v9); EXP['version_9'] = {'size': len(v9)}
RAW['unityweb'] = b'UnityWeb\0' + b'\0' * 100; EXP['unityweb'] = {'size': 109}
RAW['bad_magic'] = b'NotUnity' + b'\0' * 100; EXP['bad_magic'] = {'size': 108}
RAW['only_sig'] = b'UnityFS\0'; EXP['only_sig'] = {'size': 8}
RAW['empty'] = b''; EXP['empty'] = {'size': 0}
big_info = bytearray(ok_raw); psz2 = psz; struct.pack_into('>I', big_info, psz2 + 8, 0x7FFFFFF0); struct.pack_into('>I', big_info, psz2 + 12, 0x7FFFFFF0)
RAW['info_size_huge'] = bytes(big_info); EXP['info_size_huge'] = {'size': len(big_info)}
unk = bytearray(ok_raw); struct.pack_into('>I', unk, psz2 + 16, 2 | 0x40 | 0x10000); RAW['unknown_flag_bits'] = bytes(unk); EXP['unknown_flag_bits'] = {'size': len(unk)}

# ---- IPA ----
def info_plist(): return plistlib.dumps({'CFBundleIdentifier': 'com.test.ufs', 'CFBundleName': 'UFS', 'CFBundleExecutable': 'Exe'}, fmt=plistlib.FMT_BINARY)
def macho(): return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x0100000C, 0, 2, 0, 0, 0, 0) + b'\0' * 64
PLACE = {}
for nme in RAW:
    if nme in ('empty', 'only_sig'): ext = '.bundle'
    else: ext = '.unity3d' if nme.startswith('v6') else '.bundle'
    PLACE[nme] = 'Data/Bundles/' + nme + ext
PLACE['v7_lz4_info_lz4'] = 'Data/Bundles/v7_lz4_info_lz4.bundle'
NOEXT = 'Data/blob_noext'                                            # UnityFS không đuôi → chọn qua magic (manifest)
with zipfile.ZipFile(os.path.join(out, 'ufs_all.ipa'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(APP + 'Info.plist', info_plist()); z.writestr(APP + 'Exe', macho())
    for nme, p in PLACE.items(): z.writestr(APP + p, RAW[nme])
    z.writestr(APP + NOEXT, RAW['v7_lz4_info_lz4'])
    z.writestr(APP + 'Data/readme.txt', b'khong phai bundle')
for nme, d in RAW.items(): open(os.path.join(out, 'ufs_raw_' + nme + '.bin'), 'wb').write(d)
json.dump({'bundles': EXP, 'place': PLACE, 'noext': NOEXT}, open(os.path.join(out, 'unityfs_expected.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', len(RAW), 'bundle ->', out)
