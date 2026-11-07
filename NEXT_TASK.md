# NEXT_TASK.md – dành cho Account 03

## Trước khi làm
1. Đọc `HANDOFF.md`, `INTERFACES.md`, file này, rồi prompt gốc (IPA_Localization_Studio_Prompt_Full.txt) mục 3, 8, 9, 22, 26 (Giai đoạn 4), 27 (PHASE 3), 28. Nếu chưa có prompt gốc, yêu cầu người dùng gửi.
2. Giải nén zip, `git log --oneline` + `git status` (nếu chưa có `.git` thì `git init`), chạy `node --check` mọi file JS, chạy `python3 tests/make_fake_ipas.py /tmp/fake_ipas && node tests/run_detect_tests.js /tmp/fake_ipas` phải đạt toàn bộ.
3. **Không viết lại Phase 0/1/2, không đổi kiến trúc.** Chỉ sang Phase 3 khi người dùng đã yêu cầu (mục 28 prompt gốc: dừng chờ log Phase 2).
4. Đầu phiên người dùng nên nói “Bạn là Account 0X”.

## Nhiệm vụ: PHASE 3 – FILE SCANNER (chỉ Phase 3)
Theo mục 27 prompt: quét toàn bộ file, magic bytes, SHA1/SHA256, manifest.csv, File Explorer. Chi tiết mục 8 (copy_files.js) và mục 9 (nhận diện định dạng) của prompt gốc – đọc kỹ trước khi thiết kế.
Gợi ý ràng buộc từ kiến trúc hiện có:
- Nguồn danh sách file: `session.results.ipa.entries[]` (đã có path/size/csize/method/dir/unsafe/encrypted) – không đọc lại central directory. Đọc nội dung bằng `IpaReader.openZip` (cần offset) + `IpaReader.readEntry(file, entry, {max, head})`; module mới chạy trong worker phải thêm vào `importScripts` của `ipa.worker.js` (sau `detect_engine.js`), module luồng chính thêm `<script>` trước `state.js`.
- Băm SHA: dùng `crypto.subtle` (SHA-1/SHA-256, không thư viện ngoài); file lớn phải băm theo luồng/từng phần và có tiến trình + hủy; entry unsafe/encrypted/unsupported ghi trạng thái, không bỏ qua im lặng.
- Gắn vào bước pipeline `scan` (đã có trong `State.PIPELINE_STEPS`); lưu `session.manifest`, `session.stats.totalFiles`; view `explorer` thay trạng thái trống (như cách Phase 2 làm với view `engine`: bỏ `empty` trong `UI.VIEWS`, thêm section tĩnh trong index.html, hàm render có cache theo tham chiếu kết quả).
- Có thể dùng `session.results.engine.analysis_branch` để chọn quy tắc phân loại, nhưng không được giả định engine đúng khi status ≠ confirmed.
- Không số liệu hard-code, không dữ liệu giả; cập nhật `INTERFACES.md`, `HANDOFF.md`, `README.md` (mục kiểm tra Phase 3); viết test tạo IPA giả lập trong `tests/`.

## Quy tắc bàn giao
- Khi ngữ cảnh/tài nguyên gần hết: dừng, cập nhật 3 file, commit, báo người dùng; không tuyên bố push/commit nếu lệnh chưa thành công.
- Không sang Phase 4 khi chưa được yêu cầu.
