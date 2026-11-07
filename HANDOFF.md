# HANDOFF.md

## Phiên hiện tại: Account 02 (Phase 2 + Phase 3) → bàn giao cho Account 03
Vòng quay: 01 → 02 → … → 10 → 01. Ghi rõ số tài khoản đầu mỗi lần cập nhật file này.

## Trạng thái tổng
- Phase 0 Foundation, Phase 1 IPA Reader (Account 01): hoàn thành.
- Phase 2 Engine Detection (Account 02): hoàn thành; chi tiết rule trong INTERFACES.md.
- **Phase 3 File Scanner (Account 02): hoàn thành phần code + test giả lập.** Quét toàn bộ entry, magic bytes, SHA-1/SHA-256 (tự cài, đối chiếu hashlib/crypto), CRC32, manifest.csv, File Explorer, ghi nhận header archive (không giải nén).
- Phase 4 trở đi: chưa bắt đầu, không có code dang dở.

## File đã tạo/sửa trong phiên này
Tạo: js/modules/{detect_engine,hash,magic_bytes,archive_scanner,file_scanner}.js, tests/{make_fake_ipas.py,run_detect_tests.js,make_scan_ipa.py,run_scan_tests.js}.
Sửa: js/ipa_reader.js (bước engine + scan, streamEntry), js/workers/ipa.worker.js, index.html (script, #view-engine, #view-explorer, #hash-mode), js/ui.js (renderEngine, renderExplorer), js/events.js, js/app.js (VERSION 0.4.0-phase3), css/analyzer.css, README.md, INTERFACES.md, HANDOFF.md, NEXT_TASK.md.

## Nâng cấp Phase 3 đợt 2 (Account 02)
Hash nhanh hơn (đã kiểm lại đúng), quét song song file nhỏ, phát hiện file trùng (`duplicate_of`, summary.duplicates), cờ tỉ lệ nén bất thường, Explorer duyệt theo thư mục + sắp xếp + chi tiết file. Chi tiết trong INTERFACES.md (mục “Nâng cấp Phase 3”).
**Không đo được lợi ích song song hóa:** trong Node, quét 20.000 file nhỏ chỉ 4,0 s → 3,8 s (fast) và 2,6 s → 2,4 s (standard); chưa biết kết quả trên Safari/iPhone thật. Nếu IPA thật vẫn chậm, đo lại bằng log trước khi tối ưu tiếp.

## Kiểm thử đã chạy
- `node tests/run_detect_tests.js /tmp/fake_ipas` (sau `python3 tests/make_fake_ipas.py /tmp/fake_ipas`): 22 IPA, 359 kiểm tra đạt.
- `python3 tests/make_scan_ipa.py /tmp/fake_ipas && node tests/run_scan_tests.js /tmp/fake_ipas`: 112 kiểm tra đạt (thêm file trùng, thứ tự hàng sau khi song song): SHA-1/SHA-256 khớp hashlib (kể cả file 70 MB chỉ SHA-1), CRC, phân loại ~12 loại, đuôi≠nội dung, file rỗng, đường dẫn `../` bị từ chối, CSV (BOM, escape, chống formula injection), fast/standard/auto, hủy giữa chừng.
- Hash: 15 độ dài × 2 thuật toán, chia chunk bất kỳ, khớp `crypto` của Node; CRC32 vector chuẩn.
- Chromium headless qua http (có Worker) với IPA giả lập: duyệt thư mục + breadcrumb, chi tiết file, sắp xếp, lọc, thẻ file trùng đều chạy, không lỗi JS; dashboard (Unity · confirmed, 15 file), Explorer, lọc, tải được `manifest.csv` đúng header; không lỗi JS, không request ngoài. (Số dòng CSV trong trình duyệt chưa đếm lại; số dòng đã kiểm trong test Node.)
**Chưa kiểm thử:** IPA thật (mọi engine), tốc độ băm trên iPhone/Safari thật với IPA 1.2 GB, bộ nhớ khi ~100k+ file, ZIP64 thật, chế độ file://. Dữ liệu giả lập do chính Account 02 tạo nên chỉ chứng minh logic, không chứng minh độ chính xác trên IPA thật.

## Quyết định kiến trúc (không đổi khi bàn giao)
- Như Phase 0/1/2. `session.results.ipa` + `.engine` + `.manifest` là nguồn cho Phase 4+.
- Băm bằng JS tự cài (crypto.subtle không băm theo luồng được). Chế độ `auto/fast/standard` để IPA lớn trên điện thoại không bị treo; `fast` KHÔNG băm (cột sha1/sha256 rỗng, status head_only) – đừng coi là lỗi.
- Archive lồng nhau, PAK, UnityFS: chỉ ghi header (`archive_status=recognized_not_unpacked|unsupported|encrypted`), tuyệt đối không giải nén/thử khóa khi chưa có parser kiểm chứng.
- `engine_related` = 'unknown' khi engine chưa confirmed/probable; không giả định.

## Hạn chế / lỗi còn tồn tại
- Đã nêu ở Phase 2: chưa quét chuỗi/symbol trong Mach-O; Unreal PAK footer chưa đọc; ngưỡng/trọng số chưa hiệu chỉnh bằng IPA thật.
- Phase 3: phân loại dựa 4 KB đầu; `zlib` chỉ nhận qua 2 byte đầu (độ chắc thấp, đã ghi rõ trong format); `.bundle` là file hay thư mục chưa phân biệt ngoài việc chỉ xét file; engine game không có trong danh sách 12 (vd Dead Cells dùng Haxe/Heaps) sẽ ra Unknown/Native – đúng thiết kế, cần log IPA thật để thêm dấu hiệu.
- Hiệu năng: standard đọc toàn bộ IPA một lượt; với IPA >512 MB `auto` chọn fast. Manifest nằm hết trong RAM và được postMessage (structured clone) – chưa đo với hàng trăm nghìn file.
- Tồn đọng từ Phase 1: chỉ phân tích `Payload/*.app` cấp 1; Hủy ở chế độ fallback luồng chính chỉ dừng ở điểm kiểm tra; chưa có extractor.log đóng gói (Phase 9).

## Git
- Commit cục bộ trong phiên Account 02 (xem `git log` nếu zip có .git; zip gửi lên GitHub cố ý KHÔNG kèm .git vì làm workflow giải nén lỗi Permission denied). **Chưa push** từ phiên này. Workflow `.github/workflows/unzip.yml` đã được sửa để bỏ qua `.git` trong zip.

## Việc tiếp theo
`NEXT_TASK.md`. Theo mục 28 prompt gốc: người dùng gửi log/kết quả Phase 2–3 trên IPA thật trước; nếu có sai lệch thì sửa Phase 2–3 trước khi sang Phase 4.
