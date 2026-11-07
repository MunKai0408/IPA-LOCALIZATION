# IPA Localization Studio

Website phân tích **tĩnh** file IPA game iOS ngay trong trình duyệt để phục vụ Việt hóa. Không backend, không upload dữ liệu.

> Trạng thái: **Phase 1 – IPA Reader hoàn thành** (đọc ZIP, Info.plist XML/binary, kiến trúc Mach-O, cờ mã hóa FairPlay). Engine, file scanner, font, chuỗi… ở các phase sau.

## Chạy thử

Không cần cài đặt hay build. Code dùng script thường (không ES module) nên mở trực tiếp được.

- **Máy tính:** mở `index.html` bằng trình duyệt, hoặc chạy `python3 -m http.server 8000` rồi vào `http://localhost:8000`.
- **GitHub Pages (khuyên dùng khi dùng iPhone):** repo → Settings → Pages → Source: *Deploy from a branch* → Branch `main`, thư mục `/ (root)` → Save. Sau 1–2 phút mở `https://<user>.github.io/<repo>/`.

## Kiểm tra Phase 3

1. Ở “Phân tích IPA” chọn **Chế độ quét file** (Tự động / Đầy đủ / Nhanh) rồi bấm Bắt đầu. Bước **Quét file** chuyển Xong.
2. Mục **File Explorer**: tóm tắt (số file, loại, file ưu tiên, đuôi ≠ nội dung, file nén chỉ ghi header, file lỗi), lọc theo loại/đường dẫn/“Chỉ file ưu tiên”, phân trang.
3. Chế độ **Nhanh** chỉ đọc đầu file để phân loại, KHÔNG băm (cột SHA trống, trạng thái `head_only`). Chế độ **Đầy đủ** băm SHA-1 mọi file, SHA-256 file ≤ 64 MB và kiểm CRC32; với IPA lớn trên điện thoại sẽ chậm.
4. Nút **Tải manifest.csv**: UTF-8 có BOM, ô bắt đầu bằng `= + - @` được thêm dấu `'` để tránh formula injection khi mở bằng Excel.
5. File nén/đóng gói (ZIP, gzip, LZ4, UnityFS, PCK, PAK…) chỉ được ghi nhận header, **không giải nén**.
6. Kiểm thử tự động (Node ≥ 20, Python 3): `python3 tests/make_scan_ipa.py /tmp/fake_ipas && node tests/run_scan_tests.js /tmp/fake_ipas`. IPA giả lập chỉ kiểm tra logic, không đảm bảo kết quả trên IPA thật.

## Kiểm tra Phase 2

1. Chạy phân tích một IPA thật → bước **Nhận diện engine** chuyển Xong, kèm kết quả (vd “Unity IL2CPP · confirmed”).
2. Tổng quan: ô **Engine phát hiện** có tên, biến thể và trạng thái. Mục **Engine**: bảng kết quả, bằng chứng (đường dẫn thật trong IPA), dấu hiệu còn thiếu, ghi chú, engine khác có dấu hiệu.
3. IPA ít dấu hiệu → trạng thái *possible/unknown*, **không bao giờ “confirmed” chỉ từ một dấu hiệu yếu**; Unknown chuyển nhánh phân tích chung.
4. Phiên bản engine chỉ hiện khi đọc được từ dữ liệu (header UnityFS, GDPC); không thì “Không đọc được từ dữ liệu”.
5. Kiểm thử tự động bằng IPA giả lập (cần Node ≥ 20 và Python 3): `python3 tests/make_fake_ipas.py /tmp/fake_ipas && node tests/run_detect_tests.js /tmp/fake_ipas`. Lưu ý: IPA giả lập chỉ kiểm tra logic, không đảm bảo độ chính xác trên IPA thật.

## Kiểm tra Phase 1

1. Phân tích IPA → chọn file `.ipa` thật → bấm **Bắt đầu phân tích** (không tự chạy khi chọn file).
2. Hai bước “Đọc IPA” và “Phân tích Info.plist” chuyển Xong; thẻ **Thông tin ứng dụng** hiện Bundle ID, phiên bản, kiến trúc, trạng thái mã hóa.
3. Tổng quan: các ô Tên game / Bundle ID / Phiên bản / Kiến trúc / Dung lượng / Tổng số file có số liệu thật; Engine, Số font, Số chuỗi, Số bảng vẫn “—” (phase sau).
4. File không phải ZIP, ZIP không có `Payload/*.app`, thiếu `Info.plist`: báo lỗi đỏ cụ thể, không crash.
5. IPA nhiều `.app`: có ô chọn bundle. Nút **Hủy tác vụ** dừng được. **Xóa phiên** giải phóng dữ liệu.
6. Mở DevTools → Network: không có request ra ngoài.

Lưu ý: nếu IPA tải từ App Store còn mã hóa FairPlay (cryptid≠0), công cụ chỉ cảnh báo; không giải mã, không vượt DRM.

## Kiểm tra Phase 0

1. Trang mở ra, sidebar có 11 mục; bấm từng mục đều chuyển được.
2. Tổng quan: mọi ô hiển thị “—” (không có số liệu giả).
3. Phân tích IPA: chọn hoặc kéo thả file bất kỳ → hiện tên, dung lượng; file không phải `.ipa` báo lỗi đỏ.
4. Nút “Bắt đầu phân tích” bị khóa (đúng, vì parser ở Phase 1). “Hủy” khóa. “Xóa phiên” xóa được.
5. Log hiển thị các dòng khởi động; “Tải log” tải được `extractor.log`.
6. Nút Sáng/Tối ở Cài đặt hoạt động. Thu nhỏ cửa sổ < 900px: sidebar thành menu ☰.

## Kiến trúc

Namespace toàn cục `window.IPAStudio`. Thứ tự nạp script: `logger → plist_parser → binary_reader → hash → magic_bytes → archive_scanner → detect_engine → file_scanner → ipa_reader → worker_manager → state → ui → events → app`. Phân tích IPA chạy trong `js/workers/ipa.worker.js`; nếu Worker không có (vd mở bằng `file://`) thì tự chạy trên luồng chính và ghi cảnh báo. Chi tiết API: `INTERFACES.md`. Tiến độ: `HANDOFF.md`. Việc tiếp theo: `NEXT_TASK.md`.

- `State` giữ trạng thái; `UI.render` vẽ lại từ state; `Events` chỉ nối DOM → State.
- Dữ liệu từ IPA luôn hiển thị bằng `textContent`, không `innerHTML`.
- CSP trong `index.html` chặn mọi kết nối mạng ra ngoài (`connect-src 'none'`).

## Giới hạn

Công cụ chỉ phân tích tĩnh. Trình duyệt không thể đọc RAM hay hook game đang chạy; runtime strings sẽ được nhập từ file do công cụ ngoài tạo (Phase 7). Không vượt DRM/FairPlay hay mã hóa.

## Thư viện ngoài

Không dùng. ZIP được đọc bằng parser tự viết + `DecompressionStream('deflate-raw')` của trình duyệt (Safari 16.4+, Chrome 80+, Firefox 113+).
