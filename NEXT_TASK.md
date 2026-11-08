# NEXT_TASK.md – dành cho Account 07

## BƯỚC 0 (bắt buộc, trước mọi việc mới): XÁC NHẬN 5.2a + 5.2c TRÊN DỮ LIỆU THẬT
Chưa có file Unity thật nào được dùng để kiểm 5.2a (UnityFS) và 5.2c (SerializedFile): fixture do Account 06 dựng theo cùng giả định bố cục. Việc đầu tiên:
1. Xin người dùng chạy bản 0.11.0 trên IPA Unity thật (DATA WING) rồi gửi `unity_serialized.json` (nút trong view Unity/Metadata) hoặc log + ảnh thẻ “SerializedFile”.
2. Nếu trạng thái file là `not_serialized`/`invalid`/`unsupported_*`, hoặc số object/class bất thường (ví dụ 0 TextAsset dù game có text) → SỬA 5.2c trước (đối chiếu từng giả định trong INTERFACES.md “Rủi ro #1”). Chỉ khi dữ liệu thật khớp mới sang bước kế tiếp.

## SUB-PHASE KẾ TIẾP (sau Bước 0): 5.2b — FONT METADATA sfnt/WOFF
Áp dụng cho font ngoài Unity (`fonts.json`) VÀ font trong `results.serialized.fonts`. Đọc `name` (family 1/16, subfamily 2/17, full 4, PostScript 6, version 5; platform 3/1 UTF-16BE và 1/0 MacRoman), `head`/`maxp` (unitsPerEm, numGlyphs), `OS/2`, `cmap` (format 4/12 → đếm code point; độ phủ tiếng Việt để 5.3), TTC từng font con, WOFF (DecompressionStream), WOFF2 (Brotli: không có parser hợp pháp → `unsupported`, KHÔNG đoán). Điền `family/subfamily/postscript_name/version/glyph_count/analysis_status` vào `fonts.json`; UI thêm cột. Fixture dựng độc lập bằng Python (fontTools nếu có). KHÔNG làm TMP, KHÔNG làm 5.3.

## Trước khi làm (bắt buộc)
1. Đọc `HANDOFF.md`, `INTERFACES.md` (mục 5.1 FontDump, 5.2a UnityFS, 5.2c SerializedFile), file này; prompt mục 11, 12, 22, 24, 27 (PHASE 5), 28.
2. Giải nén zip, `for f in js/*.js js/modules/*.js js/workers/*.js; do node --check $f; done`, tạo IPA giả: `D=/tmp/fake_ipas; for g in make_fake_ipas make_scan_ipa make_unity_ipas make_metadata_ipas make_literal_ipas make_tables_ipas make_font_ipas make_unityfs_ipas make_serialized_ipas; do python3 tests/$g.py $D; done`, chạy 9 bộ test (`node tests/run_<tên>_tests.js $D`): detect **359**, scan **112**, unity **86**, metadata **72**, literal **53**, tables **314**, font **76**, unityfs **217**, serialized **140**.
3. Không viết lại Phase 0–5.2c, không đổi kiến trúc. Nếu không tải được OpenType/WOFF spec: ghi “từ kiến thức, chưa đối chiếu nguồn”.

## Gợi ý sau 5.2b (chỉ khi được yêu cầu)
TMP_FontAsset/MonoBehaviour cần type tree hoặc đọc theo bố cục script đã biết (TMP_FontAsset: tên, bảng ký tự, tham chiếu atlas Texture2D); file `.resS` cho Texture/Font streaming; localization (Phase 6).

## Quy tắc bàn giao
- Gần hết ngữ cảnh: dừng, cập nhật 3 file, báo người dùng; không tuyên bố commit/push nếu chưa thành công (zip không có `.git`, không có GitHub liên kết).
- Không sang sub-phase khác khi chưa được yêu cầu.
