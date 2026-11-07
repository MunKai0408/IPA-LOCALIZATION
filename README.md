# IPA Localization Studio

Website phân tích **tĩnh** file IPA game iOS ngay trong trình duyệt để phục vụ Việt hóa. Không backend, không upload dữ liệu.

> Trạng thái: **Phase 0 – Project Foundation** (giao diện + kiến trúc nền). Chưa có parser IPA.

## Chạy thử

Không cần cài đặt hay build. Code dùng script thường (không ES module) nên mở trực tiếp được.

- **Máy tính:** mở `index.html` bằng trình duyệt, hoặc chạy `python3 -m http.server 8000` rồi vào `http://localhost:8000`.
- **GitHub Pages (khuyên dùng khi dùng iPhone):** repo → Settings → Pages → Source: *Deploy from a branch* → Branch `main`, thư mục `/ (root)` → Save. Sau 1–2 phút mở `https://<user>.github.io/<repo>/`.

## Kiểm tra Phase 0

1. Trang mở ra, sidebar có 11 mục; bấm từng mục đều chuyển được.
2. Tổng quan: mọi ô hiển thị “—” (không có số liệu giả).
3. Phân tích IPA: chọn hoặc kéo thả file bất kỳ → hiện tên, dung lượng; file không phải `.ipa` báo lỗi đỏ.
4. Nút “Bắt đầu phân tích” bị khóa (đúng, vì parser ở Phase 1). “Hủy” khóa. “Xóa phiên” xóa được.
5. Log hiển thị các dòng khởi động; “Tải log” tải được `extractor.log`.
6. Nút Sáng/Tối ở Cài đặt hoạt động. Thu nhỏ cửa sổ < 900px: sidebar thành menu ☰.

## Kiến trúc

Namespace toàn cục `window.IPAStudio`. Thứ tự nạp script: `logger → state → ui → events → app`. Chi tiết API: `INTERFACES.md`. Tiến độ: `HANDOFF.md`. Việc tiếp theo: `NEXT_TASK.md`.

- `State` giữ trạng thái; `UI.render` vẽ lại từ state; `Events` chỉ nối DOM → State.
- Dữ liệu từ IPA luôn hiển thị bằng `textContent`, không `innerHTML`.
- CSP trong `index.html` chặn mọi kết nối mạng ra ngoài (`connect-src 'none'`).

## Giới hạn

Công cụ chỉ phân tích tĩnh. Trình duyệt không thể đọc RAM hay hook game đang chạy; runtime strings sẽ được nhập từ file do công cụ ngoài tạo (Phase 7). Không vượt DRM/FairPlay hay mã hóa.
