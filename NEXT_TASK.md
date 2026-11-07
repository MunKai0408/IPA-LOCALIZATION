# NEXT_TASK.md – dành cho Account 06

## SUB-PHASE KẾ TIẾP: 5.2 — FONT METADATA AND TMP ANALYSIS
Prompt (mục 27, PHASE 5): “Phân tích metadata font và dữ liệu liên quan đến TextMesh Pro.” Gốc: mục 12 (font_dump.js: Family name, Subfamily, PostScript name, Version, Format, Character map, Unicode ranges, Glyph count; TMP_FontAsset: atlas texture, character/glyph table, fallback, material, source font) và mục 11 (Unity asset bundle). CHỈ 5.2; KHÔNG làm 5.3 (độ phủ tiếng Việt: vi_coverage.json, missing_characters.txt).

## Trước khi làm (bắt buộc)
1. Đọc `HANDOFF.md`, `INTERFACES.md` (mục 5.1 FontDump, mục 4.3 MetadataTables, Phase 3), file này; prompt mục 3, 11, 12, 22, 24, 27 (PHASE 5), 28. Mã nguồn là căn cứ nếu tài liệu mâu thuẫn.
2. Giải nén zip, `node --check` mọi JS, tạo IPA giả: `D=/tmp/fake_ipas; for g in make_fake_ipas make_scan_ipa make_unity_ipas make_metadata_ipas make_literal_ipas make_tables_ipas make_font_ipas; do python3 tests/$g.py $D; done`, chạy 7 bộ test (`node tests/run_<tên>_tests.js $D`): detect **359**, scan **112**, unity **86**, metadata **72**, literal **53**, tables **314**, font **76**.
3. Không viết lại Phase 0–5.1, không đổi kiến trúc. Nếu cần nguồn tham chiếu (OpenType/WOFF/Unity serialized file), dùng `git clone --depth 1` rồi đọc file đầy đủ (WebFetch chỉ cho bản tóm tắt – bài học từ 4.3); ghi nguồn+commit trong mã.
4. Xin người dùng log/ảnh view Font trên IPA thật (có font .ttf/.otf nếu có). Đã biết: IPA DATA WING (Unity IL2CPP, metadata v23) chưa có kết quả view Font.

## Phạm vi 5.2 (đối chiếu lại với prompt)
- Mở rộng `FontDump` (hoặc module phụ `font_meta.js`, nhưng giữ interface 5.1): với mỗi font `is_font` và đã trích xuất (bytes ở `font_files`), đọc bảng `name` (family nameID 1/16, subfamily 2/17, full 4, PostScript 6, version 5; xử lý platform 3/1 UTF-16BE và 1/0 MacRoman; không bịa khi thiếu), `head`/`maxp` (unitsPerEm, numGlyphs), `OS/2` (nếu có: unicode range bits), `cmap` (đọc format 4/12 → tập code point; CHỈ liệt kê/đếm, độ phủ tiếng Việt để 5.3), TTC (từng font con), WOFF (giải zlib từng bảng cần – dùng `DecompressionStream`/pako-like tự viết hợp pháp; nếu không giải được ghi unsupported), WOFF2 (Brotli: nếu không có parser hợp pháp trong dự án → `unsupported`, KHÔNG đoán). Điền `family/subfamily/postscript_name/version/glyph_count/analysis_status` vào `fonts.json`.
- TMP/Unity: font trong UnityFS/asset bundle CHƯA parse ở 5.1. Chỉ làm nếu parser UnityFS đọc được an toàn (kiểm header, nén LZ4/LZMA); nếu chưa thể thì ghi `unsupported` rõ lý do, đề xuất parser cần thêm. Không giả định TMP có trong IPA.
- Cập nhật UI view Font (cột family/glyph), `toFontsJson`, `toReportFields`, bước pipeline; giữ mọi test cũ.

## Tiêu chí nghiệm thu 5.2
1. Fixture font có bảng name/head/maxp/cmap/OS2 dựng độc lập (Python) đúng cấu trúc → metadata đọc đúng từng trường, Unicode (tiếng Việt/CJK) trong tên; font thiếu bảng/hỏng → `analysis_status` có cấu trúc, không crash, không bịa.
2. WOFF/WOFF2/TTC xử lý đúng hoặc `unsupported` có lý do. Đối chiếu độc lập (ví dụ fontTools nếu có sẵn trong Python; nếu không, tự dựng dữ liệu biết trước).
3. Kiểm soát bộ nhớ/thời gian, có hủy; test mới + 7 bộ cũ đạt; Chromium headless kiểm view (390 px, 0 lỗi JS, 0 request ngoài).
4. Cập nhật `INTERFACES.md`, `HANDOFF.md`, `NEXT_TASK.md` (trỏ sang 5.3), `README.md`.

## Quy tắc bàn giao
- Gần hết ngữ cảnh: dừng, cập nhật 3 file, báo người dùng; không tuyên bố commit/push nếu chưa thành công (hiện không có GitHub liên kết).
- Không sang 5.3 khi chưa được yêu cầu.
