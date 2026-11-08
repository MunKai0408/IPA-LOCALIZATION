# IPA Localization Studio

Website phân tích **tĩnh** file IPA game iOS ngay trong trình duyệt để phục vụ Việt hóa. Không backend, không upload dữ liệu.

> Trạng thái: **Phase 5.1 (font discovery/extraction) hoàn thành trên dữ liệu GIẢ LẬP; Phase 4 đã xác nhận trên 1 IPA thật (Unity IL2CPP, metadata v23)**. Trước đó: Phase 4 (4.1, 4.2, 4.3) trên dữ liệu GIẢ LẬP (4.3 gồm string literal, assembly/image/type/method/field, dump.cs; chưa kiểm thử trên metadata thật). Dòng cũ: sub-phase 4.1 (Unity Component Discovery), trên nền Phase 0–3 (đọc IPA, Info.plist, Mach-O/FairPlay, nhận diện engine, quét file + manifest). Header/phiên bản metadata (4.2), trích xuất metadata (4.3), font, chuỗi… ở các bước sau.

## Chạy thử

Không cần cài đặt hay build. Code dùng script thường (không ES module) nên mở trực tiếp được.

- **Máy tính:** mở `index.html` bằng trình duyệt, hoặc chạy `python3 -m http.server 8000` rồi vào `http://localhost:8000`.
- **GitHub Pages (khuyên dùng khi dùng iPhone):** repo → Settings → Pages → Source: *Deploy from a branch* → Branch `main`, thư mục `/ (root)` → Save. Sau 1–2 phút mở `https://<user>.github.io/<repo>/`.

## Kiểm tra Phase 5.1 (phát hiện và trích xuất font)
```
D=/tmp/fake_ipas; python3 tests/make_font_ipas.py $D && node tests/run_font_tests.js $D   # 76
```
Tìm font theo nội dung (TTF/OTF/TTC/WOFF/WOFF2/BMFont) và theo đuôi; trích xuất nguyên bản, kiểm tra cấu trúc header, đối chiếu UIAppFonts, liệt kê asset Unity chưa parse. Chưa đọc family/glyph/độ phủ tiếng Việt (5.2/5.3). Font trong test là GIẢ LẬP (chỉ có header).

## Kiểm tra Phase 4.3 (assembly/image/type/method/field + dump.cs)
```
D=/tmp/fake_ipas; python3 tests/make_tables_ipas.py $D && python3 tests/make_literal_ipas.py $D && python3 tests/make_metadata_ipas.py $D && node tests/run_tables_tests.js $D   # 314
```
Bố cục struct lấy từ mã nguồn Il2CppDumper (commit 4741d46, xem `js/modules/metadata_tables.js`); test đối chiếu với schema dẫn xuất tự động từ file C# (`tests/derive_schema_from_cs.py`). Hỗ trợ version 16, 17, 19, 20, 21, 22, 23, 24 (24.0/24.1/24.2/24.4), 27, 29, 31. Tên kiểu của field/tham số KHÔNG có (nằm trong binary). Test dùng metadata GIẢ LẬP.

## Kiểm tra Phase 4.3 (string literal)
```
python3 tests/make_literal_ipas.py /tmp/fake_ipas && node tests/run_literal_tests.js /tmp/fake_ipas   # 53 (cần cả make_metadata_ipas.py cho 6 ca “không đủ điều kiện”)
```
Trích xuất string literal (v16–31 đã đối chiếu). Test dùng metadata GIẢ LẬP.

## Kiểm tra Phase 4.2 (Header và phiên bản global-metadata.dat)
```
python3 tests/make_fake_ipas.py /tmp/fake_ipas && python3 tests/make_scan_ipa.py /tmp/fake_ipas && python3 tests/make_unity_ipas.py /tmp/fake_ipas && python3 tests/make_metadata_ipas.py /tmp/fake_ipas
node tests/run_detect_tests.js /tmp/fake_ipas   # 359
node tests/run_scan_tests.js /tmp/fake_ipas     # 112
node tests/run_unity_tests.js /tmp/fake_ipas    # 86
node tests/run_metadata_tests.js /tmp/fake_ipas # 72
```
Trong trình duyệt: mục “Unity / Metadata” → thẻ “Header metadata”; chỉ đọc 4096 byte đầu, KHÔNG trích xuất. Trạng thái `generic_ok` chỉ là kiểm tra chung, không phải xác minh bố cục trường. Toàn bộ test dùng header GIẢ LẬP.

## Kiểm tra Phase 4.1 (Unity Component Discovery)

1. Phân tích một IPA game Unity → bước **Unity IL2CPP (thành phần)** Xong (vd “IL2CPP · metadata selected”). IPA không phải Unity → bước “Bỏ qua”.
2. Mục **Unity / Metadata**: kết luận (đã tìm thấy / chưa đủ bằng chứng / không phải Unity), biến thể runtime (IL2CPP, Mono, xung đột, chưa xác định), phiên bản Unity (chỉ khi đọc được từ header UnityFS), danh sách thành phần đã thấy (UnityFramework, global-metadata.dat, Data/Managed/Metadata, Data/Resources, StreamingAssets, Data/Raw, *.assets, *.resource, *.resS, *.bundle, globalgamemanagers, sharedassets*, level*…) và nhóm không thấy, file `global-metadata.dat` đầu vào (đã chọn / thiếu / nhiều ứng viên / không đọc được).
3. “Không tìm thấy libil2cpp” là bình thường trên iOS (thường nằm trong binary). “Xung đột” hoặc “Chưa xác định” là kết quả trung thực, không phải lỗi: công cụ không đoán.
4. Bước này **chưa đọc nội dung** metadata. Nếu magic bytes của file không khớp chữ ký IL2CPP, UI nói “có thể bị mã hóa/obfuscate” và không đi tiếp. Header/phiên bản sẽ kiểm ở 4.2.
5. Nút **Tải unity_info.json** tải kết quả (schema `unity_info/1`) để gửi lại cho người phát triển.
6. Kiểm thử tự động (Node ≥ 20, Python 3), toàn bộ trên IPA giả lập: `python3 tests/make_fake_ipas.py /tmp/fake_ipas && python3 tests/make_scan_ipa.py /tmp/fake_ipas && python3 tests/make_unity_ipas.py /tmp/fake_ipas && node tests/run_unity_tests.js /tmp/fake_ipas`. Lưu ý: giả lập chỉ chứng minh logic, không chứng minh độ chính xác trên IPA thật.

## Kiểm tra Phase 3

1. Ở “Phân tích IPA” chọn **Chế độ quét file** (Tự động / Đầy đủ / Nhanh) rồi bấm Bắt đầu. Bước **Quét file** chuyển Xong.
2. Mục **File Explorer**: tóm tắt (số file, loại, file ưu tiên, đuôi ≠ nội dung, file nén chỉ ghi header, file lỗi), lọc theo loại/đường dẫn/“Chỉ file ưu tiên”, phân trang.
2b. Explorer mặc định **Xem theo thư mục**: bấm thư mục để đi vào, breadcrumb để quay lại, bấm một file để xem toàn bộ thông tin (SHA đầy đủ, header archive, lỗi). Bật tìm kiếm/lọc loại/“Chỉ file ưu tiên” thì tự chuyển sang danh sách phẳng; có thể sắp xếp theo đường dẫn, kích thước, loại.
2c. Chế độ Đầy đủ báo **file trùng nội dung** (cột `duplicate_of`, số bản dư và dung lượng lãng phí); chế độ Nhanh không báo được vì chưa băm.
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

Namespace toàn cục `window.IPAStudio`. Thứ tự nạp script: `logger → plist_parser → binary_reader → hash → magic_bytes → archive_scanner → detect_engine → file_scanner → unity_dump → ipa_reader → worker_manager → state → ui → events → app`. Phân tích IPA chạy trong `js/workers/ipa.worker.js`; nếu Worker không có (vd mở bằng `file://`) thì tự chạy trên luồng chính và ghi cảnh báo. Chi tiết API: `INTERFACES.md`. Tiến độ: `HANDOFF.md`. Việc tiếp theo: `NEXT_TASK.md`.

- `State` giữ trạng thái; `UI.render` vẽ lại từ state; `Events` chỉ nối DOM → State.
- Dữ liệu từ IPA luôn hiển thị bằng `textContent`, không `innerHTML`.
- CSP trong `index.html` chặn mọi kết nối mạng ra ngoài (`connect-src 'none'`).

## Giới hạn

Công cụ chỉ phân tích tĩnh. Trình duyệt không thể đọc RAM hay hook game đang chạy; runtime strings sẽ được nhập từ file do công cụ ngoài tạo (Phase 7). Không vượt DRM/FairPlay hay mã hóa.

## Thư viện ngoài

Không dùng. ZIP được đọc bằng parser tự viết + `DecompressionStream('deflate-raw')` của trình duyệt (Safari 16.4+, Chrome 80+, Firefox 113+).

## Cập nhật 0.10.0 (Phase 5, sub-phase 5.2a): parser UnityFS (container)
Đọc header, bảng block/node của AssetBundle UnityFS (LZ4/LZ4HC/LZMA/không nén), liệt kê node và giải nén được nội dung từng node (`NS.UnityFS.readNode`). Thẻ “AssetBundle UnityFS” nằm trong view Unity / Metadata; tải `unityfs_index.json`. **Chưa** parse SerializedFile nên chưa biết bên trong có TextAsset/Font/TMP hay không. Mới kiểm bằng bundle giả lập, chưa kiểm bundle Unity thật. Test: `python3 tests/make_unityfs_ipas.py DIR && node tests/run_unityfs_tests.js DIR`.

## Cập nhật 0.11.0 (Phase 5, sub-phase 5.2c): đọc SerializedFile
Đọc `*.assets`, `level*`, `sharedassets*`, `globalgamemanagers` và node SerializedFile trong bundle UnityFS: thống kê loại object, trích nguyên bản TextAsset (`.txt`/`.bin`) và font nhúng trong object Font, quy MonoBehaviour về tên class script (để biết có TMP/localization hay không). Thẻ “SerializedFile” trong view Unity / Metadata, có nút tải từng mục và `unity_serialized.json`. **Chưa** giải mã MonoBehaviour/TMP_FontAsset/Texture. Mới kiểm bằng file giả lập, chưa kiểm file Unity thật. Test: `python3 tests/make_serialized_ipas.py DIR && node tests/run_serialized_tests.js DIR`.

## Cập nhật 0.12.0 (Phase 5, sub-phase 5.2b+5.3): độ phủ tiếng Việt của font
Đọc name/head/maxp/cmap của TTF/OTF/TTC/WOFF (cả font ngoài Unity và font trích từ object Font của Unity) và kiểm 134 ký tự Việt có dấu dựng sẵn. Thẻ “Độ phủ tiếng Việt của font” trong view Font, tải `font_metrics.json`. Lưu ý: font nguồn đủ tiếng Việt chưa chắc game hiển thị được (TMP dùng atlas tĩnh). Chưa hỗ trợ WOFF2. Test: `python3 tests/make_fontmetrics_fonts.py DIR && node tests/run_fontmetrics_tests.js DIR` (cần fonttools).
