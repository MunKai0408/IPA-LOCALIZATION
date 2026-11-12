# NEXT_TASK (sau v0.20.0-fontgen)

Mục tiêu: một trong các việc READY (chọn 1, không viết lại phần cũ):
1. **Dựng lại pak Heaps** từ translated/ + font_generator/ + patch_plan.json (ghi pak mới, cây offset mới) – cần log/pak thật của Dead Cells để đối chiếu bố cục; làm trong trang hoặc tools/apply_patch.py. Cần để font Việt sinh ra thật sự vào game.
2. Font TTF/OTF thiếu chữ Việt: sinh bảng glyf/cmap (glyph ghép từ chữ cái + dấu) – hiện thẻ chỉ liệt kê.
3. Ghi xml/plist; 7.4 Godot; 7.3 Cocos; 6.2 bộ dò chuỗi chung.

Đầu vào bắt buộc: zip v0.20.0 + HANDOFF.md + ROADMAP.md; `node --check` mọi .js; sinh IPA giả bằng mọi tests/make_*.py vào CÙNG 1 thư mục; 23 bộ test phải đạt (stats 23 + inventory 29 + 359/112/86/72/53/314/76/217/141/120/297 + candidates 47, pakheads 24, text 39, raw 20, apply 32, pakfont 16, localization 16, fontgen 39).
Không được làm: vượt DRM; tuyên bố đã kiểm trên game thật khi chưa có dữ liệu thật; thêm backend/thư viện ngoài.
Người dùng: chạy trang trên IPA thật, sinh glyph cho font bitmap thiếu chữ Việt, gửi font_generator.zip + report để đối chiếu; dịch thử 1–2 dòng trong texts.csv.
