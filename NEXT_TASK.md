# NEXT_TASK.md – dành cho Account 02

## Trước khi làm
1. Đọc `HANDOFF.md`, `INTERFACES.md`, file này, rồi prompt gốc (IPA_Localization_Studio_Prompt_Full.txt) mục 7, 23, 26 (Giai đoạn 3), 27 (PHASE 2), 28.
2. `git log --oneline` + `git status` xác nhận code khớp HANDOFF. Mở trang, chạy thử một IPA (hoặc tạo IPA giả lập) để chắc Phase 1 còn chạy.
3. **Không viết lại Phase 0/1, không đổi kiến trúc.**

## Nhiệm vụ: PHASE 2 – ENGINE DETECTION (chỉ Phase 2)
Mục tiêu: sau khi đọc IPA, nhận diện engine dựa trên bằng chứng và ghi `engine.json` + phần engine của `report.json` (dạng dữ liệu trong session; việc đóng gói file vào ZIP là Phase 9).

File cần tạo:
- `js/modules/detect_engine.js` (dùng được cả luồng chính và worker, cùng kiểu bọc `root`): `DetectEngine.detect(ipaResult) -> EngineResult`.
  Đầu vào: `session.results.ipa` (đã có `entries[]` đầy đủ, `frameworks`, `macho`, `infoPlist`, `topLevel`, `app.executable`).
  Đầu ra theo mục 7 + 23 prompt: `{ engine, variant, confidence (0..1), status:'confirmed'|'probable'|'possible'|'unknown', evidence:[{indicator,path,weight}], missing_indicators:[], version:null, analysis_branch, notes }`.
  Engine: Unity (IL2CPP/Mono), Unreal, Cocos2d-x/Creator, Godot, GameMaker, Defold, Flutter, React Native, Solar2D/Corona, Ren'Py, RPG Maker MV/MZ, Native iOS, Unknown. Luật dấu hiệu theo mục 7 prompt. Một dấu hiệu yếu chỉ cho probable/possible, không bao giờ “chắc chắn”. Tên file/đường dẫn dùng `entries[]`; framework dùng `frameworks`.
  Phân biệt IL2CPP/Mono: `global-metadata.dat` hoặc `libil2cpp`/UnityFramework+metadata → IL2CPP; `Managed/*.dll` (Assembly-CSharp.dll) → Mono. Không đoán phiên bản Unity nếu không đọc được từ dữ liệu (để `version:null`).
  Có thể đọc thêm vài byte đầu của file đặc trưng (magic UnityFS, `GDPC`, `FlutterAssets`…) bằng `IpaReader.readEntry(file, entry, {head:true,max:N})` – chỉ khi cần và có file; không bắt buộc.
- Nối vào pipeline: chạy trong `IpaReader.analyze` hoặc bước riêng ở worker sau bước `plist`, gọi `step('engine', ...)`; lưu `session.engine` và `session.results.engine`. Hiện engine ở Dashboard và view “Engine” (thay trạng thái trống, hiển thị bằng chứng + missing_indicators + confidence).
- Cập nhật `index.html` (script), `INTERFACES.md`, `HANDOFF.md`, `README.md` (mục kiểm tra Phase 2).

Kiểm thử bắt buộc: tạo IPA giả lập cho ít nhất Unity IL2CPP, Unity Mono, Unreal, Flutter, React Native, Godot, Native iOS, Unknown (script Python tạo ZIP, như bài test Phase 1); kiểm tra confidence/status và rằng IPA chỉ có 1 dấu hiệu yếu không được “confirmed”. Không có request mạng, không số liệu hard-code.

## Quy tắc bàn giao
- Không sang Phase 3 khi chưa được yêu cầu.
- Khi ngữ cảnh/tài nguyên gần hết: dừng, cập nhật 3 file, commit, báo người dùng; không tuyên bố push/commit nếu lệnh chưa thành công.
- Đầu phiên người dùng nên nói “Bạn là Account 0X”.
