# NEXT_TASK.md – dành cho Account 07

## SUB-PHASE KẾ TIẾP: 5.2b — FONT METADATA (sfnt/WOFF) cho font ĐÃ trích xuất
(5.2a = parser UnityFS container đã xong ở Account 06; xem HANDOFF.md.) Sau 5.2b mới tới 5.2c (SerializedFile) rồi 5.3.

## Trước khi làm (bắt buộc)
1. Đọc `HANDOFF.md`, `INTERFACES.md` (mục 5.1 FontDump, 5.2a UnityFS), file này; prompt mục 11, 12, 22, 24, 27 (PHASE 5), 28.
2. Giải nén zip, `for f in js/*.js js/modules/*.js js/workers/*.js; do node --check $f; done`, tạo IPA giả: `D=/tmp/fake_ipas; for g in make_fake_ipas make_scan_ipa make_unity_ipas make_metadata_ipas make_literal_ipas make_tables_ipas make_font_ipas make_unityfs_ipas; do python3 tests/$g.py $D; done`, chạy 8 bộ test (`node tests/run_<tên>_tests.js $D`): detect **359**, scan **112**, unity **86**, metadata **72**, literal **53**, tables **314**, font **76**, unityfs **217**.
3. Không viết lại Phase 0–5.2a, không đổi kiến trúc. Nguồn tham chiếu mạng có thể tắt: nếu không tải được OpenType/WOFF spec, ghi rõ “từ kiến thức, chưa đối chiếu nguồn”.
4. **Xin người dùng dữ liệu THẬT** (chưa có từ trước tới nay cho 5.1/5.2a): (a) `unityfs_index.json` hoặc ảnh view Unity/Metadata sau khi phân tích IPA Unity có AssetBundle thật (vd Addressables/`*.bundle`), (b) view Font với IPA có .ttf/.otf thật. Nếu parser UnityFS cho `invalid`/`decompress_failed` trên bundle thật thì SỬA 5.2a TRƯỚC (rủi ro lớn nhất: căn lề vùng dữ liệu, xem INTERFACES.md).

## Phạm vi 5.2b
Đọc `name` (family 1/16, subfamily 2/17, full 4, PostScript 6, version 5; platform 3/1 UTF-16BE và 1/0 MacRoman), `head`/`maxp` (unitsPerEm, numGlyphs), `OS/2` (nếu có), `cmap` (format 4/12 → ĐẾM/liệt kê code point; độ phủ tiếng Việt để 5.3), TTC từng font con, WOFF (zlib từng bảng bằng DecompressionStream), WOFF2 (Brotli: nếu không có parser hợp pháp → `unsupported`, KHÔNG đoán). Điền `family/subfamily/postscript_name/version/glyph_count/analysis_status` vào `fonts.json`; UI view Font thêm cột. Fixture font có bảng thật (dựng độc lập bằng Python; fontTools nếu có). CHỈ font file thường; KHÔNG làm TMP/Unity (5.2c), KHÔNG làm 5.3.

## Gợi ý cho 5.2c (sau 5.2b, chỉ khi được yêu cầu)
SerializedFile reader (header, metadata/type tree, bảng object → ClassID: 28 Texture2D, 48/49 TextAsset, 128 Font, 114 MonoBehaviour…) chạy trên node `is_serialized` đọc bằng `UnityFS.readNode`, VÀ trên file `*.assets`/`level*`/`sharedassets*` rời (nhiều game, có thể cả DATA WING, không dùng UnityFS cho các file này → parser UnityFS không giúp được). Cần xác nhận bằng manifest/`unity_info.json` thật trước khi kết luận.

## Quy tắc bàn giao
- Gần hết ngữ cảnh: dừng, cập nhật 3 file, báo người dùng; không tuyên bố commit/push nếu chưa thành công (zip không có `.git`, không có GitHub liên kết).
- Không sang sub-phase khác khi chưa được yêu cầu.
