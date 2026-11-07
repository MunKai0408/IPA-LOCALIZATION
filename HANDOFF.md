# HANDOFF.md

## Phiên hiện tại: Account 01 (làm Phase 0 và Phase 1) → bàn giao cho Account 02
Vòng quay: 01 → 02 → … → 10 → 01. Ghi rõ số tài khoản đầu mỗi lần cập nhật file này.

## Trạng thái tổng
- **Phase 0 – Foundation: HOÀN THÀNH.**
- **Phase 1 – IPA Reader: HOÀN THÀNH**, kiểm thử bằng IPA giả lập tự tạo (10 trường hợp) trên Chromium headless qua http (có Worker) và file:// (fallback luồng chính). Không có lỗi JS, không có request mạng ngoài.
- Phase 2 trở đi: chưa bắt đầu, không có code dang dở.

## File đã tạo/sửa
Phase 0: index.html, manifest.json, LICENSE, README.md, css/{reset,variables,layout,components,dashboard,responsive}.css, js/{app,state,ui,events}.js, js/modules/logger.js.
Phase 1 (mới): js/plist_parser.js, js/binary_reader.js, js/ipa_reader.js, js/worker_manager.js, js/workers/ipa.worker.js, css/analyzer.css.
Phase 1 (sửa): index.html (script, banner lỗi, bundle picker, #app-detail, #phase-note), js/state.js (error, resetSteps, trạng thái read_done), js/ui.js (nút Bắt đầu, tiến trình theo bước, chi tiết app), js/events.js (startAnalysis/hủy/chọn bundle), js/app.js (VERSION 0.2.0-phase1).

## Kiểm thử đã chạy (Phase 1)
Binary plist; XML plist (có ký tự & < > " ü); ZIP stored; Mach-O thin arm64; fat arm64+arm64e có cryptid=1 (cảnh báo FairPlay); not_zip; no_payload; no_plist; plist hỏng; file rỗng; nhiều .app + chọn bundle; entry path traversal bị loại; hủy; fallback file://.
**Chưa kiểm thử:** IPA thật lớn (>1 GB), ZIP64 thật, iPhone Safari thật, entry mã hóa ZIP.

## Quyết định kiến trúc (không đổi khi bàn giao)
- Script thường + namespace `window.IPAStudio` (không ES module). Module dùng chung với worker bọc bằng `(function(root){...})(typeof window!=='undefined'?window:self)`. Module mới chạy trong worker phải thêm vào `importScripts` của worker; module chạy ở luồng chính thêm `<script>` trước `state.js`/`app.js`.
- CSP: `script-src 'self'; style-src 'self'; connect-src 'none'`. Không inline style/script; dùng class (css/analyzer.css, components.css có tiện ích .mt-2/.mt-3/.mb-3/.m-0).
- ZIP đọc bằng `File.slice` (không nạp cả IPA vào RAM), giải nén qua `DecompressionStream('deflate-raw')`. Không dùng thư viện ngoài.
- Dữ liệu từ IPA chỉ hiển thị bằng textContent (`UI.h`).
- `session.results.ipa` chứa kết quả Phase 1 (gồm `entries[]` đầy đủ, `infoPlist`) – Phase 2/3 đọc từ đây, không đọc lại central directory.
- Tiến trình UI tính từ số bước pipeline (done + running×0.5)/8, không dùng `session.progress`.

## Hạn chế / lỗi còn tồn tại
- `stats.totalFiles` đếm cả entry bị đánh dấu unsafe.
- Chỉ phân tích `Payload/*.app` cấp 1; app lồng (Watch/, appex) mới liệt kê tên.
- Mach-O chỉ đọc kiến trúc + cryptid; chưa đọc load commands khác/symbols (Phase 4).
- Nút Hủy dùng `worker.terminate()`; ở chế độ fallback luồng chính chỉ dừng ở các điểm kiểm tra.
- Chưa có Logs/extractor.log đóng gói (Phase 9); hiện chỉ có nút “Tải log”.

## Git
- Commit cục bộ trong `/home/claude/IPA-Localization-Studio` (xem `git log`). **Chưa push**: phiên không có kết nối GitHub. Người dùng tự đẩy lên repo `Ipa-localization` (ZIP + GitHub Actions unzip, hoặc dán tay).

## Việc tiếp theo
`NEXT_TASK.md` (Phase 2 – Engine Detection).
