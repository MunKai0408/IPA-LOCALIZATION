# NEXT_TASK.md – dành cho Account 05

> CẬP NHẬT (Account 04, 4.3 một phần): string literal đã xong. CÒN THIẾU của 4.3: assembly/namespace/class/method/field + dump.cs (cần nguồn xác minh bố cục struct; xem HANDOFF). Ưu tiên: hỏi người dùng log/ảnh trên IPA Unity IL2CPP thật (thẻ “Header metadata” + “String literal”) và/hoặc file `MetadataClasses.cs`. Nếu chưa có, hỏi người dùng muốn (a) chờ phần còn thiếu hay (b) sang SUB-PHASE 5.1 Font Discovery. Test phải đạt 359/112/86/72/53 (thêm `python3 tests/make_literal_ipas.py /tmp/fake_ipas` và `node tests/run_literal_tests.js /tmp/fake_ipas`). Phần dưới là kế hoạch 4.3 gốc (string literal đã làm).

## SUB-PHASE KẾ TIẾP: 4.3 — METADATA EXTRACTION AND REPORT
Prompt (mục 27): “Trích xuất dữ liệu metadata theo phạm vi gốc và hiển thị kết quả.” Gốc (mục 10, 16): string literal, assembly/namespace/class/method/field nếu parser hỗ trợ; đầu ra `Meta/metadata_summary.json`, `Meta/dump.cs` hoặc JSON tương đương, `Text/unity_string_literals.json`, ghi vào report. Mỗi lượt CHỈ một sub-phase; xong 4.3 thì dừng, không sang Phase 5.

## Trước khi làm (bắt buộc)
1. Đọc `HANDOFF.md`, `INTERFACES.md` (mục 4.1 và 4.2), file này, prompt mục 3, 10, 16, 22, 27 (PHASE 4), 28. Mã nguồn là căn cứ nếu tài liệu mâu thuẫn.
2. Giải nén zip, `node --check` mọi JS, chạy: `python3 tests/make_fake_ipas.py /tmp/fake_ipas && python3 tests/make_scan_ipa.py /tmp/fake_ipas && python3 tests/make_unity_ipas.py /tmp/fake_ipas && python3 tests/make_metadata_ipas.py /tmp/fake_ipas` rồi 4 bộ test (phải đạt 359 / 112 / 86 / 72).
3. Không viết lại Phase 0–4.2, không đổi kiến trúc.
4. Hỏi người dùng log/ảnh chụp trên IPA Unity IL2CPP THẬT (kết quả thẻ “Header metadata”, version thật). Nếu 4.2 cho kết quả sai trên dữ liệu thật, sửa 4.2 trước.

## Phạm vi 4.3
- **Việc đầu tiên: xác minh bố cục header + bảng cho từng version cần hỗ trợ từ nguồn đáng tin** (4.2 chưa có version nào xác minh ở mức trường; xem HANDOFF). Nguồn gợi ý: `Perfare/Il2CppDumper` (`MetadataClasses.cs`, `Metadata.cs`), il2cpp_dumper (`structures.rs`, `metadata.rs`) — dùng WebSearch rồi WebFetch link kết quả. Ghi nguồn + version trong code và INTERFACES.md. Version nào không xác minh được → `unsupported`, không đoán offset.
- Chỉ chạy khi `metadata_header.status === 'generic_ok'` và version nằm trong tập đã xác minh; các trạng thái khác: không trích xuất, nêu lý do, không làm dừng pipeline.
- Đọc bảng cần thiết theo offset/size trong file qua `IpaReader.readEntry` không phải đủ (giới hạn kích thước) → dùng `streamEntry`/đọc theo vùng có giới hạn bộ nhớ; metadata có thể hàng chục MB, có tiến trình + hủy. Không nạp mọi thứ vào RAM nếu không cần.
- Trích xuất (theo parser đã xác minh): string literal (bảng literal + dữ liệu), assembly/image, namespace, class, method, field; không tự tạo tên, không suy diễn offset. Xuất: `Meta/metadata_summary.json` (mở rộng `toSummary`, bỏ `partial` khi đủ), `Meta/dump.cs` hoặc JSON tương đương, `Text/unity_string_literals.json`, trường báo cáo (mở rộng `toReportFields`). Hiển thị kết quả trong view “Unity / Metadata” (bảng có tìm kiếm, tải JSON).
- Chuỗi: UTF-8 đúng theo dữ liệu; lỗi giải mã ghi cờ, không bỏ chuỗi im lặng. Escape khi hiển thị (đã có h()).
- Không giải mã/obfuscation, không vượt FairPlay.

## Tiêu chí nghiệm thu 4.3
1. Metadata GIẢ LẬP đúng bố cục đã xác minh (nêu rõ giả lập) → số lượng và nội dung trích xuất đối chiếu được với bytes dựng độc lập (Python).
2. Version chưa xác minh/bảng trỏ ra ngoài file/chỉ số vượt phạm vi → lỗi có cấu trúc, không crash, không đoán.
3. Kiểm soát bộ nhớ trên file lớn; test hủy giữa chừng.
4. 4 bộ test cũ vẫn đạt + test mới; Chromium headless kiểm view; cập nhật `INTERFACES.md`, `HANDOFF.md`, `NEXT_TASK.md` (trỏ sang Phase 5 / SUB-PHASE 5.1), `README.md`.

## Quy tắc bàn giao
- Gần hết ngữ cảnh/tài nguyên: dừng, cập nhật 3 file, báo người dùng; không tuyên bố commit/push nếu chưa thành công. Zip gửi lên GitHub cố ý KHÔNG kèm `.git`.
- Không sang Phase 5 khi chưa được yêu cầu.
