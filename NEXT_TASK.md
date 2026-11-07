# NEXT_TASK.md – dành cho Account 06

## SUB-PHASE KẾ TIẾP: 5.1 — FONT DISCOVERY AND EXTRACTION
Prompt (mục 27, PHASE 5): “Phát hiện, đọc và trích xuất các file font được hỗ trợ.” Gốc: mục 12 (font_dump.js, vùng *.ttf/*.otf/*.ttc/*.woff/*.woff2/*.fnt/*.bmfont/*.atlas, đầu ra `Fonts/original/`, `Fonts/fonts.json`, `Fonts/font_index.json`). Mỗi lượt CHỈ một sub-phase; xong 5.1 thì dừng. KHÔNG làm 5.2 (metadata font/TMP) hay 5.3 (độ phủ tiếng Việt).

## Trước khi làm (bắt buộc)
1. Đọc `HANDOFF.md`, `INTERFACES.md` (mục Phase 3 file_scanner/manifest và mục 4.3), file này; prompt mục 3, 12, 22, 24, 27 (PHASE 5), 28. Mã nguồn là căn cứ nếu tài liệu mâu thuẫn.
2. Giải nén zip, `node --check` mọi JS, tạo IPA giả và chạy: `D=/tmp/fake_ipas; python3 tests/make_fake_ipas.py $D && python3 tests/make_scan_ipa.py $D && python3 tests/make_unity_ipas.py $D && python3 tests/make_metadata_ipas.py $D && python3 tests/make_literal_ipas.py $D && python3 tests/make_tables_ipas.py $D` rồi 6 bộ test: detect **359**, scan **112**, unity **86**, metadata **72**, literal **53**, tables **300** (`node tests/run_<tên>_tests.js $D`; tables/literal cần đủ các IPA của make_metadata_ipas.py).
3. Không viết lại Phase 0–4, không đổi kiến trúc.
4. Hỏi người dùng (nếu chưa có): log/ảnh trên IPA Unity IL2CPP THẬT — thẻ “Header metadata”, “String literal”, “Assembly/class/method/field”, version thật. Nếu kết quả thật sai thì sửa Phase 4 trước (đặc biệt giả định cặp header #0/#1 và nhận diện v24.x).

## Phạm vi 5.1 (gợi ý, đối chiếu lại với prompt mục 12)
- Module mới `js/modules/font_dump.js` (`NS.FontDump`), dùng manifest Phase 3 (`session.results.manifest`) để tìm font theo magic bytes (TTF/OTF/TTC/WOFF/WOFF2 đã có trong magic_bytes.js) VÀ theo đuôi (.fnt/.bmfont/.atlas là text/BMFont, không tin đuôi hoàn toàn).
- Trích xuất NGUYÊN BẢN các file font truy cập được (đọc bằng `IpaReader.streamEntry`/`readEntry` có giới hạn kích thước, hủy được) vào vùng kết quả riêng (`Fonts/original/`); giữ đường dẫn gốc, SHA từ manifest; không sửa IPA. Chống path traversal (dùng `entry.unsafe`/tên đã chuẩn hóa như Phase 3).
- `Fonts/font_index.json`: mỗi font = {path trong IPA, kích thước, định dạng (theo magic), sha1/sha256 nếu có, trạng thái trích xuất, lỗi}; `Fonts/fonts.json` ở mức 5.1 chỉ có phần phát hiện (KHÔNG gồm family/glyph/độ phủ – thuộc 5.2/5.3; để trường rỗng/ghi rõ “chưa phân tích”, không bịa).
- Font nằm trong UnityFS/asset bundle/TMP atlas: 5.1 chỉ ghi nhận “chưa giải được” (không parse bundle); `UIAppFonts` trong Info.plist (đã có ở `ipa.app.appFonts`) đối chiếu với file thật tìm được.
- Giao diện: view “Font” (hiện đang placeholder, `data-view="fonts"` hoặc tương tự – kiểm tra index.html): danh sách font phát hiện, tìm kiếm, tải từng font, tải JSON. Bước pipeline `fonts` đã có sẵn trong `State.PIPELINE_STEPS` (đang “Chờ”).
- Báo cáo: thêm trường font vào `toReportFields` của module mới; số liệu tính từ dữ liệu thật.

## Tiêu chí nghiệm thu 5.1
1. IPA giả lập có TTF/OTF/TTC/WOFF/WOFF2/.fnt thật (dựng độc lập bằng Python, nêu rõ giả lập) → danh sách phát hiện và byte trích xuất khớp từng file (SHA-256 đối chiếu hashlib).
2. File đổi đuôi (đuôi .ttf nhưng không phải font; font không đuôi) xử lý đúng theo magic bytes; file font rỗng/cắt cụt/hỏng → lỗi có cấu trúc, không crash; entry mã hóa/không an toàn bị từ chối.
3. Kiểm soát bộ nhớ (font lớn, nhiều font), có hủy; test mới + 6 bộ test cũ vẫn đạt; Chromium headless kiểm view (khung 390 px, 0 lỗi JS, 0 request ngoài).
4. Cập nhật `INTERFACES.md`, `HANDOFF.md`, `NEXT_TASK.md` (trỏ sang SUB-PHASE 5.2), `README.md`.

## Quy tắc bàn giao
- Gần hết ngữ cảnh/tài nguyên: dừng, cập nhật 3 file, báo người dùng; không tuyên bố commit/push nếu chưa thành công (hiện không có GitHub liên kết, zip không kèm `.git`).
- Không sang 5.2 khi chưa được yêu cầu.
