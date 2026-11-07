# NEXT_TASK.md – dành cho Account 04

## SUB-PHASE KẾ TIẾP: 4.2 — METADATA HEADER AND VERSION
Theo prompt (mục 27, bản chia sub-phase): “Phân tích metadata header, xác định version và kiểm tra tính hợp lệ.” Mỗi lượt CHỈ làm đúng một sub-phase; xong 4.2 thì dừng, không làm 4.3.

## Trước khi làm (bắt buộc)
1. Đọc `HANDOFF.md`, `INTERFACES.md` (mục “Phase 4 – SUB-PHASE 4.1”), file này, rồi prompt (IPA_Localization_Studio_Prompt_Split_Phases.txt) mục 3, 10, 22, 27 (PHASE 4), 28. Nếu chưa có prompt, yêu cầu người dùng gửi. Nếu tài liệu mâu thuẫn mã nguồn, mã nguồn là căn cứ; ghi nhận mâu thuẫn.
2. Giải nén zip, `node --check` mọi file JS, rồi chạy đủ 4 lệnh (phải đạt toàn bộ: 359 / 112 / 86 kiểm tra):
   `python3 tests/make_fake_ipas.py /tmp/fake_ipas && python3 tests/make_scan_ipa.py /tmp/fake_ipas && python3 tests/make_unity_ipas.py /tmp/fake_ipas && node tests/run_detect_tests.js /tmp/fake_ipas && node tests/run_scan_tests.js /tmp/fake_ipas && node tests/run_unity_tests.js /tmp/fake_ipas`
3. **Không viết lại Phase 0–3 và 4.1, không đổi kiến trúc.** Đầu phiên người dùng nên nói “Bạn là Account 0X”.
4. **Bước 0 vẫn chưa có dữ liệu:** chưa ai thấy kết quả Phase 2–3–4.1 trên IPA THẬT (chỉ test giả lập). Hãy hỏi người dùng log/ảnh chụp (mục Engine, File Explorer, “Unity / Metadata”, `unity_info.json` tải được, extractor.log) trên một game Unity IL2CPP thật. Nếu người dùng muốn làm 4.2 ngay, được phép, nhưng ghi rõ trong HANDOFF là chưa kiểm trên dữ liệu thật; nếu log cho thấy 4.1 sai (vd metadata_input không tìm đúng file), sửa 4.1 trước.

## Phạm vi 4.2 (chỉ những việc này)
- Đọc `session.results.unity.metadata_input` (`status === 'selected'`, dùng `entry_path`). Các trạng thái khác (`missing/ambiguous/unreadable/not_il2cpp/not_applicable`): không đọc gì, ghi lý do rõ ràng, KHÔNG làm dừng pipeline.
- Đọc phần đầu file (header) bằng `IpaReader.openZip(file)` (lấy entry gốc có offset theo `entry_path`) + `IpaReader.readEntry(file, entry, {max, head:true})`. Không nạp cả file; đặt giới hạn đọc header rõ ràng.
- Kiểm tra: magic `AF 1B B1 FA`, version (int32), tính hợp lệ của header (các cặp offset/size nằm trong kích thước file, không chồng chéo vô lý…). Kết quả theo mức: `supported` / `unsupported_version` / `invalid_header` / `bad_magic` (có thể bị mã hóa/obfuscate – nói rõ là “có thể”, không khẳng định).
- CHỈ hỗ trợ phiên bản có bố cục header được xác minh từ nguồn đáng tin; phiên bản khác → `unsupported_version` kèm header thô (magic, version, kích thước file), KHÔNG đoán offset/trường. Đừng viết bố cục từ trí nhớ rồi coi là đã kiểm chứng: nếu không có nguồn xác minh cho một phiên bản, đánh dấu phiên bản đó là chưa hỗ trợ và nói rõ với người dùng. Có thể làm kiểm tra header CHUNG (magic + version trong khoảng hợp lý + các cặp offset/size không vượt file) mà không cần biết ý nghĩa từng trường.
- Không giải mã, không phá obfuscation, không vượt FairPlay (mục 3 prompt).
- Module mới: `js/modules/metadata_dump.js` (hoặc tên hợp lý, ghi lý do), thêm vào `importScripts` của worker và `<script>` trong `index.html` (sau `unity_dump.js`). Có thể thêm bước pipeline mới (chèn, không đổi id cũ) hoặc mở rộng bước `unity`; kết quả đặt vào `session.results.unity.metadata_header` (mở rộng schema `unity_info`, cập nhật `schema`/`sub_phase`) hoặc `session.results.metadataHeader` – chọn một cách và ghi INTERFACES.md. Hiển thị trong view “Unity / Metadata” (đã có `renderUnity`): thêm thẻ “Header metadata”.
- Output dự kiến (xuất file là Phase 9): phần `Meta/metadata_summary.json` chỉ gồm header/version ở bước này; chưa có string literal/class/method (4.3).

## Tiêu chí nghiệm thu 4.2
1. Header giả lập đúng cấu trúc (do bạn tự dựng, nêu rõ là giả lập) → phiên bản và trạng thái đúng; số liệu trong UI/JSON đối chiếu được với bytes trong file.
2. Magic sai, file ngắn hơn header, cặp offset/size vượt file, version lạ, file 0 byte → trạng thái lỗi/không hỗ trợ có cấu trúc, không ném lỗi làm hỏng pipeline, không đoán.
3. Chỉ đọc header (kiểm bằng test: số byte đọc ≤ giới hạn); không nạp cả file.
4. Bộ test cũ vẫn đạt (359/112/86) + test mới; Chromium headless kiểm view; cập nhật `INTERFACES.md`, `HANDOFF.md`, `NEXT_TASK.md` (trỏ sang 4.3), `README.md` (mục kiểm tra 4.2).

## Quy tắc bàn giao
- Khi ngữ cảnh/tài nguyên gần hết: dừng, cập nhật 3 file, báo người dùng; không tuyên bố commit/push nếu lệnh chưa thành công. Zip gửi lên GitHub cố ý KHÔNG kèm `.git` (workflow giải nén lỗi Permission denied).
- Không sang 4.3 hoặc Phase 5 khi chưa được yêu cầu.
