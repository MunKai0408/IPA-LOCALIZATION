# ROADMAP – nâng cấp IPA Localization Studio cho MỌI game iOS

Nguồn: PROMPT_NANG_CAP_STUDIO_MOI_ENGINE_V1. Việc cũ (NEXT_TASK/HANDOFF 0.13.1) đã HỦY, lưu ở `docs/archive/` (STALE). Code Phase 0–5.3 giữ làm nền.

| Subphase | Nội dung | Trạng thái | Ghi chú |
|---|---|---|---|
| 6.1 | Khung hệ ứng viên (candidates.js, view, candidates.json) | DONE | 47 test GIẢ LẬP; chưa kiểm trên game thật |
| 6.2 | Bộ dò chuỗi chung cho engine lạ | READY | |
| 7.1 | Native iOS (.strings/.stringsdict/.xcstrings) | READY | |
| 7.2 | RPG Maker MV/MZ | READY | |
| 7.3 | Cocos2d-x / Creator | READY | |
| 7.4 | Godot (.pck, .translation, project.godot) | READY | |
| 7.1/7.2 (một phần) | Text iOS native + JSON/CSV/PO/XML trong IPA và pak Heaps (text_extract.js) | DONE (GIẢ LẬP) | chưa kiểm trên game thật |
| 8 | Xuất text CSV chung + validate | PARTIAL | texts.csv + validate nhẹ có; chưa có validate nâng cao/so khớp bản dịch |
| 8.2 | Nhập bản dịch CSV → vá file text + kiểm lại (translation_apply.js) | DONE (GIẢ LẬP) | chưa ghi vào pak/IPA; chưa thử trên game thật |
| 8.3 | View Localization: ngôn ngữ, so khớp nguồn→đích, mẫu dịch (localization.js) | DONE (GIẢ LẬP) | heuristic ghép khóa; chưa thêm file ngôn ngữ mới |
| 9.4 | Bộ sinh glyph Việt cho font BMFont (font_generator.js; append/rebuild) | DONE (GIẢ LẬP) | chưa kiểm trên game thật; TTF/OTF chưa làm |
| 9.1 | Unity: I2Languages / StringTable | PENDING | cần đọc MonoBehaviour |
| 9.2 | Unity: Cổng 0 tĩnh | PENDING | sau 9.1 |
| 9.3 | Unity: liên kết TMP → font | PENDING | |
| 10.1 | Unreal pak/locres | PENDING | |
| 10.2 | GameMaker / Ren'Py / Defold / Flutter | PENDING | |
| 11 | patch_plan.json + tools/apply_patch.py | PENDING | ngoài trình duyệt |
| 12 | canary_plan.json | PENDING | |
