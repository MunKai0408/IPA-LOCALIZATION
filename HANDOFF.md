# HANDOFF.md

## Phiên hiện tại: Account 01 → bàn giao cho Account 02
Vòng quay: 01 → 02 → … → 10 → 01. Ghi rõ số tài khoản đầu mỗi lần cập nhật file này.

## Trạng thái tổng
- **Phase 0 – Project Foundation: HOÀN THÀNH** (đã kiểm thử bằng trình duyệt headless: không lỗi console, điều hướng, chọn file, menu mobile).
- Phase 1 trở đi: **chưa bắt đầu**. Không có code dang dở.

## File đã tạo (Account 01)
- `index.html` (CSP chặn kết nối ngoài, không dùng inline style/script)
- `manifest.json`, `LICENSE` (MIT), `README.md`
- `css/`: reset, variables, layout, components, dashboard, responsive (analyzer.css chưa tạo, tạo khi cần)
- `js/modules/logger.js`, `js/state.js`, `js/ui.js`, `js/events.js`, `js/app.js`
- Thư mục rỗng (có .gitkeep): `assets/*`, `js/workers/`, `docs/`

## Quyết định kiến trúc (không đổi khi bàn giao)
- Script thường + namespace `window.IPAStudio` (không ES module) để chạy được cả từ `file://` và GitHub Pages. Thứ tự nạp: logger → state → ui → events → app. Module mới thêm `<script>` vào `index.html` **trước** `app.js`.
- Dữ liệu từ IPA chỉ hiển thị bằng `textContent` (helper `UI.h`).
- Do CSP `style-src 'self'`: không dùng thuộc tính `style="..."` trong HTML; dùng class. (Gán `el.style.x` bằng JS vẫn được.)
- Web Worker (Phase 1+) phải là file trong `js/workers/` (CSP `worker-src 'self' blob:`). Thư viện ZIP phải đóng gói cục bộ trong project (vd `js/vendor/`), ghi tên/phiên bản/giấy phép trong README.

## Lỗi / hạn chế còn tồn tại
- Nút “Bắt đầu phân tích” cố ý bị khóa (`UI.render` đặt `disabled = true`). **Phase 1 phải sửa dòng này** để bật khi `status === 'file_selected'` và `fileCheck.ok`.
- `Events.selectFile` chỉ kiểm tra đuôi `.ipa` và size > 0; kiểm tra ZIP/Payload thật thuộc Phase 1.
- Nút Hủy mới chỉ ghi log; chưa nối `WorkerManager.cancel()` (Phase 1).
- Chưa kiểm thử trên iPhone Safari thật.

## Git
- Commit cục bộ đã tạo trong `/home/claude/IPA-Localization-Studio` (xem mục dưới). **Chưa push lên GitHub** vì phiên này không có remote/quyền truy cập repo. Người dùng cần tạo repo, `git remote add origin ...`, `git push`.

## Việc tiếp theo
Xem `NEXT_TASK.md` (Phase 1 – IPA Reader).
