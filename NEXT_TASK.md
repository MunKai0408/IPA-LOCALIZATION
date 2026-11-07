# NEXT_TASK.md – dành cho Account 03

## Trước khi làm
1. Đọc `HANDOFF.md`, `INTERFACES.md`, file này, rồi prompt gốc (IPA_Localization_Studio_Prompt_Full.txt) mục 3, 7, 22, 26, 27 (PHASE 4), 28. Nếu chưa có prompt gốc, yêu cầu người dùng gửi.
2. Giải nén zip, `node --check` mọi file JS, chạy 2 bộ test: `python3 tests/make_fake_ipas.py /tmp/fake_ipas && python3 tests/make_scan_ipa.py /tmp/fake_ipas && node tests/run_detect_tests.js /tmp/fake_ipas && node tests/run_scan_tests.js /tmp/fake_ipas` – phải đạt toàn bộ.
3. **Không viết lại Phase 0–3, không đổi kiến trúc.** Đầu phiên người dùng nên nói “Bạn là Account 0X”.
4. **Bước 0 bắt buộc:** hỏi/đọc log và ảnh chụp kết quả Phase 2–3 trên IPA THẬT của người dùng (mục Engine, File Explorer, manifest.csv, extractor.log). Mới chỉ test IPA giả lập. Nếu phát hiện sai (engine nhận nhầm/Unknown dù game thuộc 12 engine, phân loại sai, quét treo/chậm trên iPhone, thiếu bộ nhớ), SỬA Phase 2–3 trước rồi mới sang Phase 4. Gợi ý nếu IPA lớn bị chậm: chế độ fast hoặc giảm chi phí băm; nếu manifest quá lớn: phân trang/ghi từng phần.

## Nhiệm vụ kế tiếp: PHASE 4 – UNITY IL2CPP STATIC ANALYSIS (chỉ khi bước 0 ổn)
Theo prompt mục 27: nhận diện Unity (đã có ở Phase 2: `session.results.engine`, `analysis_branch === 'unity_il2cpp'`), đọc `global-metadata.dat`, phân tích metadata theo phiên bản hỗ trợ, liệt kê string literal, tạo metadata report. Chi tiết mục 7/26 prompt.
Ràng buộc từ kiến trúc hiện có:
- Tìm file qua `session.results.manifest.rows` (cột relative_path, detected_format) hoặc `ipa.entries`; đọc nội dung bằng `IpaReader.openZip` (entries gốc có offset) + `readEntry`/`streamEntry`. `global-metadata.dat` có thể lớn: đọc theo vùng/luồng, không nạp bừa cả file khi không cần; metadata version đã có ở `engineProbes` (kind `il2cpp_metadata`, info.metadataVersion) nếu probe thành công.
- CHỈ hỗ trợ các phiên bản metadata đã kiểm chứng được cấu trúc header; phiên bản lạ → báo “chưa hỗ trợ” rõ ràng, không đoán offset. Không giải mã/phá obfuscation; nếu magic không khớp (đã có ghi chú ở Phase 2) thì báo “có thể bị mã hóa/obfuscate”.
- Module mới trong `js/modules/` (vd `il2cpp_metadata.js`), thêm vào `importScripts` của worker và `<script>` trong index.html; gắn vào một bước pipeline mới (thêm vào `State.PIPELINE_STEPS` nếu cần, KHÔNG đổi các bước cũ); view tương ứng thay trạng thái trống như cách Phase 2/3 đã làm.
- Test bằng file metadata giả lập do bạn tự dựng đúng cấu trúc header + nêu rõ là giả lập; cập nhật INTERFACES.md, HANDOFF.md, README.md.

## Quy tắc bàn giao
- Khi ngữ cảnh/tài nguyên gần hết: dừng, cập nhật 3 file, commit, báo người dùng; không tuyên bố push/commit nếu lệnh chưa thành công.
- Không sang Phase 5 khi chưa được yêu cầu.
