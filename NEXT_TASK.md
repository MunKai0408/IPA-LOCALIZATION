# NEXT_TASK.md – dành cho Account 02

## Trước khi làm
1. Đọc `HANDOFF.md`, `INTERFACES.md`, file này, rồi `prompt gốc` (IPA_Localization_Studio_Prompt_Full.txt) mục 6, 24, 26 (Giai đoạn 1–2), 27 (PHASE 1), 28.
2. Chạy `git log --oneline` và `git status` để xác nhận trạng thái code khớp với HANDOFF.
3. Mở `index.html` kiểm tra Phase 0 còn chạy. **Không viết lại Phase 0, không đổi kiến trúc.**

## Nhiệm vụ: PHASE 1 – IPA READER (chỉ Phase 1)
Mục tiêu: người dùng chọn IPA → bấm “Bắt đầu phân tích” → đọc ZIP cục bộ, tìm `Payload/*.app`, đọc `Info.plist`, hiển thị thông tin app lên dashboard.

File cần tạo:
- `js/vendor/` thư viện ZIP đóng gói cục bộ (đề xuất `fflate`, MIT; ghi phiên bản + giấy phép trong README). Nếu không tải được thư viện (mạng bị chặn), tự viết bộ đọc ZIP (End of Central Directory → central directory → inflate bằng `DecompressionStream('deflate-raw')`) và nói rõ giới hạn.
- `js/ipa_reader.js`: đọc central directory, kiểm tra ZIP, chống ZIP bomb (giới hạn tổng dung lượng giải nén và số file), chặn path traversal, tìm `Payload/*.app`, liệt kê Frameworks/PlugIns/*.lproj, chọn bundle nếu có nhiều app.
- `js/plist_parser.js`: plist XML trước; binary plist (`bplist00`) nếu làm được ổn định.
- `js/binary_reader.js`: đọc Mach-O header (kể cả fat) để lấy kiến trúc.
- `js/worker_manager.js` + `js/workers/ipa.worker.js`: chạy nặng trong worker, có tiến trình và hủy.

File cần sửa:
- `js/ui.js`: bật `#btn-start` khi `status === 'file_selected'` và `fileCheck.ok` (hiện đang cố ý `disabled = true`); render thông tin app thật.
- `js/events.js`: nối nút Bắt đầu và Hủy với WorkerManager; xóa `#phase0-note` khi Phase 1 xong.
- `index.html`: thêm `<script>` mới trước `app.js`.
- `INTERFACES.md`, `HANDOFF.md`: cập nhật.

Ghi vào `State`: `session.app = {name, bundleId, version, build, architectures, minOS, deviceFamily, ...}`, `stats.totalFiles`, `setStep('read'|'plist', ...)`, `progress`.

Tiêu chí nghiệm thu: IPA thật đọc được; hiển thị Bundle ID, tên, phiên bản, kiến trúc, tổng số file; file không phải ZIP/IPA báo lỗi cụ thể, không crash; IPA không có Payload báo lỗi; Hủy hoạt động; log đầy đủ; không có request mạng; không có số liệu hard-code.

## Quy tắc bàn giao
- Không sang Phase 2 khi chưa được yêu cầu. Không tự đổi kiến trúc.
- Khi ngữ cảnh/tài nguyên gần hết: dừng, cập nhật HANDOFF.md, INTERFACES.md, NEXT_TASK.md (đổi “Account 02” thành số kế tiếp), commit, rồi báo người dùng. Không tuyên bố đã commit/push nếu lệnh chưa thành công.
- Đầu phiên: người dùng nên nói “Bạn là Account 0X”.
