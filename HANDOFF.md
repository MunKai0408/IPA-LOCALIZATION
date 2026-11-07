# HANDOFF.md

## Phiên hiện tại: Account 02 (làm Phase 2) → bàn giao cho Account 03
Vòng quay: 01 → 02 → … → 10 → 01. Ghi rõ số tài khoản đầu mỗi lần cập nhật file này.

## Trạng thái tổng
- **Phase 0 – Foundation: HOÀN THÀNH** (Account 01).
- **Phase 1 – IPA Reader: HOÀN THÀNH** (Account 01).
- **Phase 2 – Engine Detection: HOÀN THÀNH** (Account 02). Nhận diện 12 engine + Native iOS + Unknown, có bằng chứng/magic bytes/độ tin cậy; hiển thị ở Dashboard và view Engine; dữ liệu engine.json + phần engine của report.json nằm trong session (đóng gói file là Phase 9).
- Phase 3 trở đi: chưa bắt đầu, không có code dang dở.

## File đã tạo/sửa trong Phase 2
Tạo: js/modules/detect_engine.js, tests/make_fake_ipas.py, tests/run_detect_tests.js.
Sửa: js/ipa_reader.js (bước engine cuối analyze, IpaResult.engine/engineProbes), js/workers/ipa.worker.js (importScripts), index.html (script, #view-engine, phase-note), js/ui.js (renderEngine, stat engine, VIEWS.engine bỏ empty), js/events.js (applyResult/startAnalysis), js/app.js (VERSION 0.3.0-phase2), README.md, INTERFACES.md, HANDOFF.md, NEXT_TASK.md.

## Kiểm thử đã chạy (Phase 2)
- `python3 tests/make_fake_ipas.py /tmp/fake_ipas && node tests/run_detect_tests.js /tmp/fake_ipas` (Node ≥ 20): 22 IPA giả lập, **359 kiểm tra đạt**. Gồm Unity IL2CPP (đọc được version 2021.3.16f1 từ header UnityFS), Unity Mono, Unity xung đột IL2CPP+Mono (variant=null), Unity không rõ biến thể, Unity chỉ 1 dấu hiệu yếu (→ Unknown), metadata sai magic (→ probable + ghi chú), Unreal, Flutter, React Native+Hermes, Godot (version 4.2.1 từ GDPC), Godot chỉ có .pck không magic (→ possible, không confirmed), Native iOS, Native chỉ Assets.car (→ Unknown), Unknown, Cocos Creator, GameMaker, Defold, Solar2D, Ren'Py, RPG Maker MV và MZ, Flutter+Unity (có alternatives).
- Chromium headless qua http (có Worker): 3 IPA giả lập (Unity IL2CPP, Unknown, React Native) → dashboard + view Engine đúng; không lỗi JS; không request ra ngoài.
**Chưa kiểm thử:** IPA thật (mọi engine), Safari iPhone thật, chế độ fallback file:// sau Phase 2, IPA >1 GB, ZIP64 thật. Dữ liệu giả lập do chính mình tạo nên chỉ chứng minh logic, KHÔNG chứng minh độ chính xác trên IPA thật – cần người dùng thử IPA thật và gửi log.

## Quyết định kiến trúc (không đổi khi bàn giao)
- Như Phase 0/1: script thường + `window.IPAStudio`, CSP chặt, không thư viện ngoài, dữ liệu IPA chỉ vào UI qua textContent, `session.results.ipa` là nguồn cho Phase 3+.
- Phase 2: `detect()` đồng bộ thuần dữ liệu; magic bytes đọc riêng bằng `runProbes` (cần `zipEntries` gốc vì `ipaResult.entries` không có offset). Bảng dấu hiệu nằm trong mảng `ENGINES` đầu detect_engine.js: thêm engine/dấu hiệu bằng cách thêm phần tử, không sửa logic.
- `analysis_branch` = nhánh engine chỉ khi confirmed/probable; còn lại `generic`.

## Hạn chế / lỗi còn tồn tại
- Chưa quét chuỗi/symbol trong binary Mach-O (Unity/UE/Godot/GameMaker trong binary chính không phát hiện được nếu tên file bị đổi/đóng gói lại); nếu binary mã hóa FairPlay thì có ghi chú.
- Unreal: footer `.pak` (magic 0x5A6F12E1) chưa đọc; chỉ dựa tên/đường dẫn.
- Ngưỡng/trọng số (TIER, MIN_CONFIDENCE) là lựa chọn thiết kế, chưa hiệu chỉnh bằng IPA thật. Dấu hiệu `game.ios` (GameMaker), `.lu` (Corona), `Data/Raw` (Unity), `cookeddata/` (Unreal iOS) dựa trên hiểu biết chung, chưa kiểm chứng.
- Tồn đọng từ Phase 1: `stats.totalFiles` đếm cả entry unsafe; chỉ phân tích `Payload/*.app` cấp 1; Hủy ở chế độ fallback luồng chính chỉ dừng ở điểm kiểm tra; chưa có extractor.log đóng gói (Phase 9).

## Git
- Commit cục bộ trong thư mục dự án (xem `git log`). **Chưa push**: phiên không có kết nối GitHub. Người dùng tự đẩy lên repo `Ipa-localization` (hoặc tải zip bàn giao).

## Việc tiếp theo
`NEXT_TASK.md` (Phase 3 – File Scanner). Theo mục 28 prompt gốc: người dùng gửi log/kết quả Phase 2 trước, rồi mới sang Phase 3.
