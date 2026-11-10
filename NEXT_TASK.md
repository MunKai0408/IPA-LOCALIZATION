# NEXT_TASK (sau v0.18.0-apply)

Mục tiêu: một trong các việc READY (chọn 1, không viết lại phần cũ):
1. **Dựng lại pak Heaps** từ translated/ + patch_plan.json (ghi pak mới, cây offset mới) – cần log/pak thật của Dead Cells để đối chiếu bố cục; làm trong trang hoặc tools/apply_patch.py.
2. Ghi xml/plist; 7.4 Godot; 7.3 Cocos; 6.2 bộ dò chuỗi chung.
3. Bộ sinh font Việt (bitmap atlas/TTF) dựa font_inventory.

Đầu vào bắt buộc: zip v0.18.0 + HANDOFF.md + ROADMAP.md; `node --check` mọi .js; sinh IPA giả bằng mọi tests/make_*.py vào CÙNG 1 thư mục; 18 bộ test phải đạt (359/112/86/72/53/314/76/217/141/120/297 + candidates 47, pakheads 24, text 39, raw 20, apply 32).
Không được làm: vượt DRM; tuyên bố đã kiểm trên game thật khi chưa có dữ liệu thật; thêm backend/thư viện ngoài.
Người dùng: chạy trang trên IPA thật, dịch thử 1–2 dòng trong texts.csv, bấm nhập bản dịch, gửi translated.zip/apply_report.json + pak_heads.zip để đối chiếu.
