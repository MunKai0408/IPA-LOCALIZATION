# NEXT_TASK.md – dành cho Account 07

## BƯỚC 0 (bắt buộc): lấy dữ liệu thật cho 5.2b+5.3 và 5.2a
1. Xin người dùng chạy bản 0.12.0 trên DATA WING và gửi `font_metrics.json` hoặc ảnh thẻ “Độ phủ tiếng Việt của font” (view Font). Nếu số liệu bất thường (font thật hiện `unknown`/`invalid`, hoặc tên/glyph sai) → SỬA font_metrics.js trước.
2. 5.2a (UnityFS) vẫn CHƯA kiểm trên bundle thật (DATA WING không có bundle); 5.2c đã kiểm trên v17 thật (HANDOFF.md). Không coi 5.2a là đã xác nhận.

## LỰA CHỌN KẾ TIẾP (hỏi người dùng, không tự chọn)
A. **Phase 6 – công cụ dịch bảng chuỗi CSV** của DATA WING (TextAsset “Localization”: CSV UTF-8, CRLF, mọi ô bọc nháy kép, 615 dòng × 19 cột, 613 khóa; ghi lại bằng `csv.writer(QUOTE_ALL, CRLF)` giống từng byte – xem HANDOFF.md). Việc: parser/ghi CSV an toàn, bảo toàn `\n`, thẻ `<c>…</>`, `{0}`, kiểm placeholder khi dịch, xuất bản dịch.
B. **Đọc TMP_FontAsset** (7 cái trong DATA WING, MonoBehaviour không có type tree → cần bố cục theo version TextMeshPro cũ): tên, font nguồn, danh sách ký tự trong atlas. Cần để biết game hiển thị được tiếng Việt không.
C. **Ghi ngược** TextAsset đã sửa vào `resources.assets` (dịch offset bảng object, header, rồi đóng gói lại IPA; ký lại ngoài phạm vi).
Câu hỏi MỞ: game chọn cột ngôn ngữ theo enum trong code (khi đó phải THAY nội dung một cột sẵn có thay vì thêm cột “Vietnamese”) hay đọc theo header?

## Trước khi làm (bắt buộc)
1. Đọc `HANDOFF.md`, `INTERFACES.md` (5.1 FontDump, 5.2a UnityFS, 5.2c SerializedFile, 5.2b+5.3 FontMetrics), file này; prompt mục 11, 12, 22, 24, 27 (PHASE 5), 28.
2. Giải nén zip, `for f in js/*.js js/modules/*.js js/workers/*.js; do node --check $f; done`, tạo IPA giả: `D=/tmp/fake_ipas; for g in make_fake_ipas make_scan_ipa make_unity_ipas make_metadata_ipas make_literal_ipas make_tables_ipas make_font_ipas make_unityfs_ipas make_serialized_ipas make_fontmetrics_fonts; do python3 tests/$g.py $D; done` (make_fontmetrics_fonts cần `pip install fonttools`), chạy 10 bộ test: detect **359**, scan **112**, unity **86**, metadata **72**, literal **53**, tables **314**, font **76**, unityfs **217**, serialized **141**, fontmetrics **120**.
3. Không viết lại Phase 0–5.3, không đổi kiến trúc.

## Quy tắc bàn giao
- Gần hết ngữ cảnh: dừng, cập nhật 3 file, báo người dùng; không tuyên bố commit/push nếu chưa thành công (zip không có `.git`, không có GitHub liên kết).
- Không sang sub-phase khác khi chưa được yêu cầu.
