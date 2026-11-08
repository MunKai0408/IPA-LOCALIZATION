# NEXT_TASK.md – dành cho Account 08

## BƯỚC 0 (bắt buộc): so zip người dùng gửi với HANDOFF.md rồi xin dữ liệu thật của 5.2d
1. Mở zip mới nhất của người dùng, đọc `app.js` VERSION và `HANDOFF.md` trước; nếu đã có việc mới hơn bản này thì KHÔNG làm lại (phiên 07 đã tránh 2 lần viết trùng).
2. Xin `tmp_fonts.json` (nút “Tải tmp_fonts.json” ở view Font) của DATA WING chạy bằng bản 0.13.0 (hoặc ảnh thẻ “TMP_FontAsset – ký tự trong atlas”). 5.2d mới chỉ kiểm trên DỮ LIỆU GIẢ LẬP; bố cục TMP là giả định (HANDOFF.md → “RỦI RO SỐ 1”).
3. Diễn giải dữ liệu thật:
   - Nếu các asset có `status: parsed` và `glyph_table.count_matches_declared: true` → bố cục đúng. Trả lời câu hỏi của người dùng: asset nào (đặc biệt “Source Code Pro”) có `vietnamese.level = full`? Ghi kết luận vào HANDOFF, nói rõ phần CHƯA biết (component nào dùng asset nào; chữ Việt phải ở dạng NFC).
   - Nếu `glyph_table_not_found`/`layout_unknown` hoặc `partial` với số ký tự lệch: đừng đoán. Dùng `diagnostics.hex_head`, `diagnostics.count_hits` (vị trí số nguyên bằng số ký tự khai báo + 48 byte kế tiếp) và `font_info.offset` để suy ra stride/thứ tự trường THẬT, rồi sửa `findGlyphTable`/`glyphAt` + fixture + test (đừng nới ràng buộc cho “vừa” dữ liệu thật mà không hiểu bố cục).
4. 5.2a (UnityFS) vẫn CHƯA kiểm trên bundle thật (DATA WING không có bundle).

## LỰA CHỌN KẾ TIẾP (hỏi người dùng, không tự chọn)
A. **Phase 6 – công cụ dịch bảng chuỗi CSV** của DATA WING (TextAsset “Localization”: CSV UTF-8, CRLF, mọi ô bọc nháy kép, 615 dòng × 19 cột, 613 khóa; xem HANDOFF cũ): parser/ghi CSV an toàn, bảo toàn `\n`, thẻ `<c>…</>`, `{0}`, kiểm placeholder, xuất bản dịch. Câu hỏi MỞ: game chọn cột ngôn ngữ theo enum trong code hay theo header?
B2. **Liên kết TMP**: MonoBehaviour component TextMeshPro(UGUI) → `m_fontAsset` (PPtr) để biết asset nào thật sự được dùng cho chữ (cần bố cục component; làm sau khi bố cục TMP_FontAsset được xác nhận trên dữ liệu thật). **Texture2D atlas**: đọc ảnh atlas để xem glyph có hình thật không.
C. **Ghi ngược** TextAsset đã sửa vào `resources.assets` (dịch offset/bảng object, đóng gói lại IPA; ký lại ngoài phạm vi).
D. TMP_FontAsset trong node bundle UnityFS (hiện chỉ cảnh báo).

## Trước khi làm (bắt buộc)
1. Đọc `HANDOFF.md`, `INTERFACES.md` (mục 5.2d TmpFont, 5.2c SerializedFile, 5.3 FontMetrics), file này; prompt mục 11, 12, 22, 24, 27 (PHASE 5), 28.
2. Giải nén zip, `for f in js/*.js js/modules/*.js js/workers/*.js tests/*.js; do node --check $f; done`, tạo IPA giả (cần `pip install fonttools`): `D=/tmp/fake_ipas; for g in make_fake_ipas make_scan_ipa make_unity_ipas make_metadata_ipas make_literal_ipas make_tables_ipas make_font_ipas make_unityfs_ipas make_serialized_ipas make_fontmetrics_fonts make_tmp_ipas; do python3 tests/$g.py $D; done`, chạy 11 bộ: detect **359**, scan **112**, unity **86**, metadata **72**, literal **53**, tables **314**, font **76**, unityfs **217**, serialized **141**, fontmetrics **120**, tmp **233**.
3. Không viết lại Phase 0–5.3, không đổi kiến trúc.

## Quy tắc bàn giao
- Gần hết ngữ cảnh: dừng, cập nhật 3 file, báo người dùng; không tuyên bố commit/push nếu chưa thành công (zip không có `.git`, không có GitHub liên kết).
- Không sang sub-phase khác khi chưa được yêu cầu.
