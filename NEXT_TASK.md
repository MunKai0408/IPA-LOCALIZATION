# NEXT_TASK

Giao cho: dev (bất kỳ account). Mục tiêu: Subphase READY tiếp theo theo ROADMAP (đề xuất 7.1 Native iOS hoặc 6.2 bộ dò chuỗi chung).

## ĐẦU VÀO BẮT BUỘC
- Zip dự án v0.14.0-phase6.1 + HANDOFF.md + ROADMAP.md; prompt PROMPT_NANG_CAP_STUDIO_MOI_ENGINE_V1.
- Chạy `node --check` mọi .js; sinh IPA giả (make_*.py + make_candidates_ipas.py); 12 bộ test phải đạt: 359/112/86/72/53/314/76/217/141/120/297 + candidates 47.

## Các bước
1. Chọn 1 Subphase READY (không làm lại 6.1). Thêm detector/parser dạng module độc lập + tests/make_<ten>_ipas.py + tests/run_<ten>_tests.js.
2. Giữ bất biến nhãn bằng chứng; parser không chắc → unknown + diagnostics.
3. Cập nhật README (mục "Cập nhật"), INTERFACES.md, HANDOFF.md, ROADMAP.md, NEXT_TASK.md; tăng NS.VERSION; zip + MANIFEST (SHA256).

## Tiêu chí xong
- Test mới đạt, 12 bộ cũ không đổi số ca; ROADMAP đúng trạng thái.

## Không được làm
- Viết lại Phase 0–5.3; thêm backend/thư viện ngoài; vượt DRM; tuyên bố đã kiểm trên game thật khi chưa có JSON từ người dùng.

## Người dùng (một việc, không chặn dev)
- Chạy trang trên IPA thật (máy tính, chế độ Nhanh), tải `candidates.json` + `manifest.csv` + `unity_info.json` gửi lại để đối chiếu.

## Điểm dừng an toàn
- Sau mỗi Subphase xong test + cập nhật 4 tài liệu.
