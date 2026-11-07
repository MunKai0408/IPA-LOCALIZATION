# HANDOFF.md

## Phiên hiện tại: Account 03 (SUB-PHASE 4.1) → bàn giao cho Account 04
(Các phần bên dưới ghi từ Account 02 vẫn đúng; phần mới của Account 03 nằm ở mục “Sub-phase 4.1”.)
Vòng quay: 01 → 02 → … → 10 → 01. Ghi rõ số tài khoản đầu mỗi lần cập nhật file này.

## Trạng thái tổng
- Phase 0 Foundation, Phase 1 IPA Reader (Account 01): hoàn thành.
- Phase 2 Engine Detection (Account 02): hoàn thành; chi tiết rule trong INTERFACES.md.
- **Phase 3 File Scanner (Account 02): hoàn thành phần code + test giả lập.** Quét toàn bộ entry, magic bytes, SHA-1/SHA-256 (tự cài, đối chiếu hashlib/crypto), CRC32, manifest.csv, File Explorer, ghi nhận header archive (không giải nén).
- **Phase 4 – sub-phase 4.1 (Unity Component Discovery, Account 03): hoàn thành.** 4.2 (header + phiên bản metadata) và 4.3 (trích xuất + báo cáo) CHƯA làm, không có code dang dở. Theo mục 27 prompt: mỗi lượt đúng MỘT sub-phase.

## File đã tạo/sửa trong phiên này
Tạo: js/modules/{detect_engine,hash,magic_bytes,archive_scanner,file_scanner}.js, tests/{make_fake_ipas.py,run_detect_tests.js,make_scan_ipa.py,run_scan_tests.js}.
Sửa: js/ipa_reader.js (bước engine + scan, streamEntry), js/workers/ipa.worker.js, index.html (script, #view-engine, #view-explorer, #hash-mode), js/ui.js (renderEngine, renderExplorer), js/events.js, js/app.js (VERSION 0.4.0-phase3), css/analyzer.css, README.md, INTERFACES.md, HANDOFF.md, NEXT_TASK.md.

## Sub-phase 4.1 – UNITY COMPONENT DISCOVERY (Account 03)
Phạm vi đã làm: (1) kiểm tra sự tồn tại của các thành phần Unity theo mục 10 prompt, (2) xác định Unity Mono hay IL2CPP từ bằng chứng, (3) xác định file `global-metadata.dat` đầu vào cho 4.2. **Không đọc nội dung file nào**, không kiểm header/phiên bản metadata (4.2), không trích xuất (4.3).
Tạo: `js/modules/unity_dump.js` (`NS.UnityDump.discover(ipaResult)` – thuần dữ liệu, đồng bộ, dùng manifest Phase 3 + engine/probes Phase 2), `tests/make_unity_ipas.py`, `tests/run_unity_tests.js`.
Sửa (chỉ chèn, không đổi hành vi cũ): `js/state.js` (thêm bước pipeline `unity` giữa `scan` và `extract`; id cũ giữ nguyên), `js/ipa_reader.js` (bước 5 `unity` sau `scan`; `IpaResult.unity`), `js/workers/ipa.worker.js` (importScripts), `index.html` (script, `#view-metadata` thật với `#unity-empty/#unity-detail/#unity-body/#btn-unity-json`, nhãn nav “Unity / Metadata”, ghi chú phase), `js/ui.js` (`renderUnity`, bỏ `empty` của view `metadata`), `js/events.js` (`session.results.unity`, nút tải `unity_info.json`), `js/app.js` (VERSION `0.5.0-phase4.1`), `README.md`, `INTERFACES.md`, `HANDOFF.md`, `NEXT_TASK.md`.
Kết quả = nội dung `Meta/unity_info.json` (schema `unity_info/1`), nằm ở `session.results.unity`; tải thử được từ view “Unity / Metadata”. Chưa đóng gói vào ZIP (Phase 9).

### Kiểm thử đã chạy (4.1) – tất cả trên IPA GIẢ LẬP
- `python3 tests/make_fake_ipas.py /tmp/fake_ipas && python3 tests/make_scan_ipa.py /tmp/fake_ipas && python3 tests/make_unity_ipas.py /tmp/fake_ipas`
- `node tests/run_unity_tests.js /tmp/fake_ipas`: **86 kiểm tra đạt** (15 IPA giả lập mới + 8 fixture Phase 2 dùng lại): IL2CPP đầy đủ (đếm từng nhóm thành phần, nhóm theo tên file loại trừ lẫn nhau, version Unity từ header UnityFS, SHA-1 ứng viên khớp hashlib độc lập), Mono, xung đột IL2CPP+Mono (không chọn biến thể), có Unity nhưng không phân biệt được runtime, magic sai (không đoán, ghi “có thể mã hóa/obfuscate”), metadata đổi tên nhưng đúng magic, hai ứng viên (chọn vị trí chuẩn) / ambiguous (không tự chọn), chỉ dấu hiệu yếu, không phải Unity, FairPlay, Unity nhúng trong Flutter, 40 file (mẫu bị cắt có đánh dấu), không phân biệt hoa/thường, metadata 0 byte, chế độ fast, thiếu manifest (fallback theo entry), hàm không sửa đầu vào, JSON/structuredClone được.
- `node tests/run_detect_tests.js /tmp/fake_ipas`: 359 đạt. `node tests/run_scan_tests.js /tmp/fake_ipas`: 112 đạt (không hồi quy).
- Chromium headless (Playwright) qua http (có Worker): view “Unity / Metadata” trống trước khi phân tích; IPA IL2CPP giả lập → bước `unity` Xong, view hiện kết luận, bằng chứng, thành phần, ứng viên metadata; tải `unity_info.json` đúng schema; IPA không phải Unity → bước `unity` “Bỏ qua”; IPA hai ứng viên → badge “Nhiều ứng viên, chưa chọn”; Xóa phiên đưa view về trạng thái trống; không lỗi JS, không request ra ngoài. Chưa xem bố cục trên màn hình điện thoại thật.
**Chưa kiểm thử:** IPA Unity thật (mọi phiên bản Unity, có/không IL2CPP, có/không FairPlay), Safari iPhone thật, chế độ `file://` sau 4.1.

### Quyết định kiến trúc (4.1)
- `discover` là hàm thuần chạy trong `analyze` ngay sau `scan` (cùng worker); lỗi chỉ thành warning + step `unity` = error, không làm mất kết quả Phase 1–3. Không phải Unity → step `skipped`.
- Thành phần có hai loại: nhóm theo thư mục/tên chuẩn (`group:'dir'`, có thể chồng lấn) và nhóm theo tên file (`group:'file'`: globalgamemanagers*, sharedassets*, level*, *.assets, *.resource, *.resS, *.bundle – mỗi file chỉ vào một nhóm theo thứ tự khai báo).
- Runtime: chỉ dựa vào thành phần mang cờ `runtime` (`global-metadata.dat`, `Data/Managed/Metadata`/`il2cpp_data`, `libil2cpp` → IL2CPP; `Data/Managed/*.dll`, `libmono*` → Mono). Cả hai → `conflict` (không chọn). Không có dấu hiệu nào → `unresolved` (KHÔNG mặc định IL2CPP). Không dùng tên Unity-iPhone/UnityFramework để suy ra runtime.
- Ứng viên metadata = file tên `global-metadata.dat` HOẶC file có 4 byte đầu `AF 1B B1 FA` (đổi tên). Chọn tự động chỉ khi có đúng một ứng viên đọc được, hoặc đúng một ứng viên ở vị trí chuẩn `Data/Managed/Metadata/` với magic không sai. Ngược lại `ambiguous`/`missing`/`unreadable`, không đoán. `entry_path` là đường dẫn đầy đủ trong ZIP để 4.2 mở bằng `IpaReader.openZip` + `readEntry`.
- `phase2_probe_version` chỉ là số int32 đọc nhanh bởi Phase 2 (probe `il2cpp_metadata`), KHÔNG phải kết quả kiểm tra hợp lệ; 4.2 phải tự đọc lại header.
- `unity_version` chỉ lấy từ `engine.version` (header UnityFS thật); không đoán.

### Hạn chế / việc còn tồn tại (4.1)
- Phase 3 gán `detected_type = Binary`, `detected_format = “Không nhận diện được định dạng”` cho `global-metadata.dat` (magic_bytes.js chưa biết chữ ký `AF 1B B1 FA`). 4.1 tự so `magic_bytes` nên không bị ảnh hưởng; có thể bổ sung chữ ký vào magic_bytes.js ở lượt sửa Phase 3 riêng (không làm trong 4.1 để giữ đúng phạm vi).
- Chưa kiểm `cryptid` của `UnityFramework` (Phase 1 chỉ đọc Mach-O của binary chính) nên chưa biết framework có mã hóa FairPlay hay không; chỉ cảnh báo khi binary chính mã hóa.
- Thành phần `libil2cpp` hầu như luôn vắng trên iOS (liên kết tĩnh); đã ghi chú trong UI, không coi là lỗi. Danh sách thành phần phản ánh đúng các mục ở mục 10 prompt, chưa hiệu chỉnh bằng IPA thật.
- Bước 0 trong lượt trước (đọc log/ảnh chụp IPA THẬT của Phase 2–3) vẫn CHƯA có dữ liệu từ người dùng; 4.1 được làm theo yêu cầu trực tiếp của người dùng.

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
- (Account 03) Không có `.git` trong zip nhận được nên không có lịch sử để nối; commit trong sandbox của phiên này chỉ để kiểm tra, KHÔNG nằm trong zip bàn giao và chưa push.
- Commit cục bộ trong phiên Account 02 (xem `git log` nếu zip có .git; zip gửi lên GitHub cố ý KHÔNG kèm .git vì làm workflow giải nén lỗi Permission denied). **Chưa push** từ phiên này. Workflow `.github/workflows/unzip.yml` đã được sửa để bỏ qua `.git` trong zip.

## Việc tiếp theo (cập nhật bởi Account 03)
`NEXT_TASK.md` = SUB-PHASE 4.2. (Dòng cũ của Account 02 về Phase 4 nói chung đã được thay bằng cách chia sub-phase.)

## (Ghi chú cũ của Account 02) Việc tiếp theo
`NEXT_TASK.md`. Theo mục 28 prompt gốc: người dùng gửi log/kết quả Phase 2–3 trên IPA thật trước; nếu có sai lệch thì sửa Phase 2–3 trước khi sang Phase 4.
