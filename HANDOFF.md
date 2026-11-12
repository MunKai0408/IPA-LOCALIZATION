# HANDOFF – v0.14.0-phase6.1

- Account: dev-nâng-cấp | Phase 6.1 DONE | Mục tiêu: Việt hóa MỌI game iOS (mọi engine).
- Việc cũ HỦY theo người dùng → docs/archive/*_OLD_0.13.1.md (STALE). Code Phase 0–5.3 giữ nguyên.
- DONE: js/modules/candidates.js (schema candidates/1: register detector, normalize, rank, toIndex); detector `generic.path` (iOS lproj/strings, RPG Maker data/*.json, Godot translation/po, Unreal locres/pak, bảng theo tên) + `unity.serialized` (I2/Localize/StringTable class, TextAsset tên giống bảng, bundle localization-stringtables-*).
- Pipeline: bước 14 'candidates' (state.js, ipa_reader.js); worker importScripts; view "Hệ ứng viên" + nút "Tải candidates.json".
- BẤT BIẾN: 6.1 chỉ HYPOTHESIS/UNKNOWN; STATIC-OK cần evidence_note; ui_status DRIVES_UI/UNUSED chỉ khi STATIC-OK; trang KHÔNG tự gán RUNTIME-OK. Tên file KHÔNG phải bằng chứng.
- Test: 11 bộ cũ GIỮ NGUYÊN (359/112/86/72/53/314/76/217/141/120/297) + candidates 47 (python3 tests/make_candidates_ipas.py D && node tests/run_candidates_tests.js D). Toàn bộ dữ liệu GIẢ LẬP.
- CHƯA kiểm trên game thật: candidates (cần người dùng chạy trang trên IPA thật và gửi candidates.json), TMP bố cục, UnityFS bundle thật.
- Chưa làm: đọc nội dung bảng (số term = null), Cổng 0, UI chưa thử trong trình duyệt thật (chỉ node --check + test logic).
- Evidence labels: candidates = [HYPOTHESIS]; parser/test = logic-only.
- NEXT READY: 6.2, 7.1, 7.2, 7.3, 7.4 (xem ROADMAP.md).


## v0.14.1-pakheads
- THÊM js/modules/pak_heads.js (thay tools extract_pak_heads.py ngay trong trang): bước pipeline 'pakheads' đọc N byte đầu mọi *.pak bằng File.slice (mặc định 2 MB), nút tải pak_heads.json / pak_heads.zip (cùng quy ước tên .head + summary.json).
- Đọc thử header Heaps PAK (Dead Cells: Heaps/HashLink). [HYPOTHESIS] – bố cục lấy từ trí nhớ về hxd.fmt.pak, CHƯA đối chiếu pak thật; sai lệch → status unverified/partial, không đoán. Đuôi .pak KHÔNG phải bằng chứng Unreal (manifest cũ gán 'Unreal PAK theo đuôi' là sai cho Dead Cells).
- Test: tests/make_pakheads_ipas.py + tests/run_pakheads_tests.js (17 ca, dữ liệu GIẢ LẬP).
- Người dùng: chạy trang trên IPA Dead Cells thật, tải pak_heads.zip gửi lại để đối chiếu bố cục.


## v0.15.0-textextract
- THÊM js/modules/text_extract.js + bước pipeline 'texts' + view "Text trích xuất": trích text từ IPA (.strings UTF-8/UTF-16/plist, .stringsdict, .xcstrings, JSON/.cdb, CSV/TSV, PO, XML kể cả Android strings.xml, .properties, .txt tên giống bảng) và từ BÊN TRONG pak Heaps (đọc tuần tự qua streamEntry nên chạy cả khi pak bị nén deflate trong IPA – manifest Dead Cells cho thấy res*.pak có csize < size).
- Font trong pak: liệt kê + kiểm tra magic (ttf/otf/ttc/woff/woff2/bmfont) + tải pak_fonts.zip. Đọc family/độ phủ tiếng Việt của font này CHƯA làm (5.2/5.3 mới chạy cho font trong IPA/Unity).
- Xuất: texts.csv (container,file,format,lang,key,text,confidence,placeholders,context; BOM UTF-8), texts_index.json. Validate nhẹ: placeholder, độ tin cậy (low = giống ID/đường dẫn), khóa trùng, file bỏ qua + lý do.
- KHÔNG làm (ghi trong result.unsupported/limitations): Unity (I2/TextAsset/bundle), Unreal locres/pak, Godot pck, Cocos, dữ liệu mã hóa. Bố cục Heaps PAK là [HYPOTHESIS], chưa đối chiếu pak thật; nếu mọi file text trong pak không giải mã được → cảnh báo bố cục sai.
- Test: tests/make_text_ipas.py + run_text_tests.js (31 ca, GIẢ LẬP). Các bộ cũ giữ nguyên: 359/112/86/76/217/141 + candidates 47 + pakheads 17 (các bộ metadata/literal/tables/fontmetrics/tmp/unity-test khác chưa chạy lại ở bản này).
- Người dùng: chạy trang trên IPA Dead Cells thật → gửi texts_index.json + pak_heads.zip để đối chiếu.

## v0.15.2-heapsfix (sửa lỗi sau log Dead Cells thật: 0 dòng text, 5 pak "chưa hỗ trợ")
- Nhận diện engine: `unreal.pak` (chỉ có đuôi *.pak) hạ từ medium → weak; pak có magic "PAK" = Heaps nên ipa_reader cảnh báo bỏ kết luận Unreal. candidates.js: pak đã biết Heaps/Godot (theo pak_heads) → `heaps.pak`, KHÔNG còn `unreal.pak_container`.
- pak_heads.js: parseHeapsPak thử 8 bố cục (checksum 4/0/8/16/32 byte; gốc có/không tên), CHỈ nhận bố cục nào kết thúc cây đúng chỗ có "DATA" (bằng chứng mạnh). Header dài hơn phần đầu: đọc lại đủ header cả với pak nén deflate (trước đây chỉ pak không nén). Ghi layouts_tried vào kết quả/log để chẩn đoán.
- ipa_reader: log mỗi pak (16 byte đầu, kích thước, kiểu nén, kết luận, ghi chú) + lý do "chưa hỗ trợ".
- Test: pakheads 21, text 31, candidates 47, + các bộ cũ. VẪN LÀ DỮ LIỆU GIẢ LẬP. NGUYÊN NHÂN THẬT của 5 pak "chưa hỗ trợ" chưa biết (log cũ không ghi) → cần log mới / pak_heads.zip.


## v0.15.3-heapsprobe
- Log Dead Cells 3.5.9 thật: 5 pak (res..res4) có magic "PAK" v1, header_size + data_size == kích thước file (khớp), nhưng 4 byte ở offset 12..15 GIỐNG HỆT ở cả 5 pak (66 35 66 65) và cây không khớp bố cục nào → parser vẫn 'unverified' (0 file, 0 text).
- THÊM: 4 bố cục thử cây bắt đầu @16; `header_probe` (hex byte 12..76, entropy, tỉ lệ ASCII) vào pak_heads.json và dòng log PAK. Tests pak 21→23 ca.
- CHƯA giải quyết: chưa có byte header thật nên chưa biết bố cục đúng (hoặc header bị xáo trộn/mã hóa). Cần người dùng gửi pak_heads.zip (hoặc log mới có `probe`).


## v0.16.0-rawfallback
- Theo yêu cầu người dùng: hỗ trợ MỌI game/engine, kể cả chưa có trình đọc. THÊM js/modules/raw_strings.js: quét chuỗi thô streaming (UTF-8 mọi ngôn ngữ + UTF-16LE Latin; tách giá trị JSON/XML) trên pak không rõ cấu trúc và các container .bin/.dat/.obb/.assets/.lua/…; mỗi dòng có offset @0x…; format 'raw', container 'raw:<file>'.
- Tích hợp text_extract bước (3); giới hạn: 1100 MB/file, 2500 MB tổng, 40 file. Test: tests/make_raw_ipas.py + tests/run_raw_tests.js (15 ca, GIẢ LẬP). Dữ liệu ngẫu nhiên 2 MB → ~3 dòng rác.
- [HYPOTHESIS]: bỏ sót text nén/mã hóa/UTF-16 không-Latin; có thể lẫn rác. CHƯA chạy trên Dead Cells thật.
- Chưa làm: ghi ngược (patch) theo offset, UTF-16 CJK, quét thô executable.


## v0.16.1-hexprefix
- Log Dead Cells thật (extractor_4): bytes 12..75 của mọi pak = chuỗi hex ASCII 64 ký tự giống nhau ("f5fecf6d…15a1", dạng hash). Quét thô chạy được: 4653 dòng / 5 pak / ~60 s.
- THÊM: parseHeapsPak tự bỏ qua dải hex rồi thử cây ở start = hx, hx+1, hx+2, hx+4 (csum 4/0, gốc có/không tên); `hex_prefix`, `data_marker_at_header_size`; probe thêm 96 byte sau dải hex + 16 byte cuối header. Test pak 23→24.
- [HYPOTHESIS]: CHƯA biết cây thật có khớp không. Nếu vẫn unverified: gửi `probe.bytes_after_hex_hex` từ log mới.


## v0.16.2-cdb
- texts.csv Dead Cells thật: cây res4.pak ĐỌC ĐƯỢC (v0.16.1 hex-prefix đúng) → data.cdb (CastleDB, nguồn tiếng Pháp), anims/*.json, cinematics/*.kf.json. JSON walker cũ ra 51k dòng, ~95% là ID/tên anim.
- THÊM parseCdb: chỉ cột kind="localizable" (cả sheet con cha@cột), key dạng `item[Id].col`; JSON thường chỉ giữ confidence 'high'; pak đã đọc được cây thì KHÔNG quét thô nữa. Tests: raw 15→18, text 31 (sửa 2 ca theo hành vi mới).
- CHƯA biết: file lang (en/…) nằm ở đâu — chưa thấy trong CSV; res.pak–res3.pak không có text (cần log mới để xác nhận trạng thái cây).


## v0.16.3-filter
- texts_2.csv (v0.16.2): 4671 dòng; data.cdb → cdb-localizable 3192 dòng text thật (nguồn Pháp, vài dòng Anh). Còn ~1450 dòng rác từ kf.json (features[].name/backed_image = tên file ảnh).
- THÊM: loại chuỗi kết thúc bằng đuôi file tài nguyên; placeholder Dead Cells `::x::`, `{từ@XX}`; bỏ cờ khoảng trắng của printf (tránh bắt nhầm "% dégâts"). Test raw 18→20.
- Việc tiếp: đóng gói bản dịch ngược vào pak (cần tên + vị trí file – đã có).


## v0.17.0-pack
- THÊM nút "Tải gói dịch (zip)": translation_pack.zip = file GỐC cần dịch đúng đường dẫn (ipa/<đường dẫn> và pak/<tên pak>/<đường dẫn>) + manifest.json (container, size, sha256, pak, pak_data_offset) + texts.csv + HUONG_DAN.txt. Giới hạn 256 MB. Mọi engine; container chưa có trình đọc chỉ có dòng quét thô trong texts.csv (manifest.not_exported).
- Test text 31→36. CHƯA có: nhập bản dịch + ghi lại pak (bước kế), xử lý font tiếng Việt. Chưa chạy trên IPA thật.


## v0.17.1-fontinv
- THÊM font_inventory (texts_index.json, manifest gói dịch, UI): liệt kê trong pak các file font (.ttf/.otf/.fnt…) và ảnh atlas font bitmap (cùng tên với .fnt, hoặc đường dẫn có font/glyph/charset); các file này (≤ 6 MB) vào gói dịch để dựng font tiếng Việt thay thế. Test text 36→39.
- CHƯA có: bộ sinh font Việt (bitmap/TTF) – cần danh sách atlas thật của Dead Cells từ lần chạy mới.


## v0.18.0-apply
- THÊM js/modules/translation_apply.js (nhập CSV dịch → validate placeholder → vá file gốc → kiểm lại bằng extractBytes → translated.zip + patch_plan.json + apply_report.json). Nút `#btn-apply-csv`. Sửa nhẹ text_extract: spans `vs/ve` cho .strings, `parseCdb(s, setter)`, export thêm hàm.
- Test: tests/run_apply_tests.js 32 ca (GIẢ LẬP; dùng IPA của make_text_ipas.py). 17 bộ cũ giữ nguyên (chạy chung 1 thư mục: tất cả make_*.py vào cùng DIR rồi mọi run_*).
- NEXT_TASK cũ (0.14.0) đã lỗi thời: đã thay.
- CHƯA có: ghi lại vào pak Heaps/IPA (dựng pak + zip + ký), xml/plist, xcstrings thêm localization mới, font Việt. UI nút chưa thử trong trình duyệt thật (chỉ node --check + logic).

## v0.18.1-ui
- Text: trình soạn bản dịch trong trang (ui.js buildTranslationEditor), `#btn-apply-csv` giờ chỉ NẠP CSV vào trình soạn; áp dụng bằng `#btn-apply-now`. translation_apply.js thêm toTranslatedCsv/mergeCsv.
- Font: text_extract tính metrics cho font trong pak (parseBmfont, fontMetricsOf); ui.js buildPakFontsCard.
- Test: +run_pakfont_tests.js (16). Tổng 19 file test, đều đạt. Smoke UI bằng Playwright (không nằm trong repo).
- CHƯA có: lưu bản dịch qua lần tải lại, glossary/dịch hàng loạt, kiểm atlas BMFont thật, bộ sinh font Việt, ghi lại pak/IPA.

## v0.19.0-loc
- THÊM js/modules/localization.js + view Localization (ui.js renderLocalization, section tĩnh index.html). `LANG` export từ text_extract. Test run_localization_tests.js (16). Tổng 20 file test đều đạt.
- View “Văn bản” (id text) vẫn là placeholder; chưa có: thêm file ngôn ngữ mới (vi.lproj/xcstrings localization vi), Unity I2/StringTable.

## v0.20.0-fontgen
- THÊM js/modules/font_generator.js (NS.FontGenerator) + thẻ "Bộ sinh font Việt" trong view Font (ui.js buildFontGenCard, hiện khi pak có font BMFont .fnt thiếu chữ Việt). Chỉ API trình duyệt (Canvas/FontFace), không thư viện ngoài.
- Chế độ `append`: giữ atlas gốc, vẽ glyph thiếu (theo VI_REQUIRED, 134 chữ) vào trang PNG MỚI `<tên>_vi<k>.png` cạnh .fnt, thêm `page` + `char` vào .fnt (giữ info/kerning/BOM/CRLF; text và XML). Chế độ `rebuild`: dựng lại 1 trang (ghi đè tên trang 0), bỏ kerning, atlas tự nới ≤ 4096.
- Font nguồn: file TTF/OTF/WOFF tải lên (có kiểm cmap qua FontMetrics) hoặc font hệ thống (chỉ kiểm bằng so 2 font dự phòng – KHÔNG chắc 100%, xem ảnh xem trước). Glyph = trắng + alpha; `yoffset = base − ascent`.
- Từ chối/không làm: BMFont nhị phân, `packed`/`chnl`≠15 ở append, TTF/OTF (chỉ liệt kê), kerning glyph mới, đóng gói ngược vào pak. Mọi lỗi → status + reason, không ném; .fnt sau khi ghi được đọc lại để xác minh số ký tự.
- Xuất zip: font_generator/pak/<tên pak>/<đường dẫn .fnt> + PNG + font_generator_report.json (limitations, warnings) + HUONG_DAN.txt.
- Test: tests/run_fontgen_tests.js (39 ca, rasterizer GIẢ LẬP; PNG kiểm bằng zlib + CRC) + tests/make_fontgen_ipas.py (IPA giả có pak Heaps + .fnt). Smoke bằng Playwright/Chromium (ngoài repo): tải TTF DejaVu → 134/134 chữ Việt, ảnh atlas đúng; font hệ thống; tên font không tồn tại bị chặn. 21 file test đều đạt.
- [HYPOTHESIS] CHƯA kiểm trên game thật: engine (Heaps/Dead Cells) có đọc trang atlas > 0 hay atlas dựng lại không CHƯA BIẾT; atlas gốc không được giải mã nên nét/viền/màu glyph mới có thể lệch.
- Người dùng: chạy trang trên IPA thật → view Font → sinh glyph cho .fnt thiếu → gửi font_generator.zip + font_generator_report.json (và .fnt gốc từ pak_fonts.zip) để đối chiếu.

## v0.21.0-unity-inventory
- serialized_file.js: bảng ClassID→tên mở rộng (~150 ID, từ trí nhớ – HYPOTHESIS); `class_bytes` (dung lượng theo loại) ở parse/file/summary (`by_class_bytes`); `monoName` đọc m_Name của MonoBehaviour (không cần type tree) → `mono_detail[class] = {count, bytes, files, samples}`; TextAsset thêm `looks_like` (json/xml/csv/tsv/ini/lua?/base64?/plain), `preview`, `name_hint`; `buildInventory` → `serialized.inventory` (schema unity_inventory/1: classes, files, carriers xếp hạng "nơi có thể chứa text hiển thị"). LIMITS.mono_names (mặc định true) làm file chỉ có MonoBehaviour cũng được đọc đủ để lấy tên.
- ui.js: thẻ SerializedFile có bảng loại object (ClassID, SL, dung lượng, số file), bảng carriers [HYPOTHESIS], bảng class script kèm tên mẫu. Tải qua nút unity_serialized.json (đã gồm inventory).
- Test: tests/make_inventory_ipas.py + run_inventory_tests.js (29 ca, GIẢ LẬP); 21 bộ cũ giữ nguyên, tổng 22.
- CHƯA: kiểm trên Unity thật; UI chưa thử trong trình duyệt thật; giải mã MonoBehaviour (m_text, bảng I2) – 9.1; .resS.

## v0.21.1-stats (A3)
- THÊM js/modules/session_stats.js (NS.SessionStats.compute, thuần dữ liệu); events.js applyResult dùng nó → `session.stats.stringCount` và `localizationTables` hết null sau khi chạy. index.html thêm script (worker KHÔNG cần).
- stringCount = texts.summary.rows; nếu 0 thì dùng unity.metadata_literals.count (status ok); texts đã chạy mà trống → 0; chưa chạy/lỗi → null. localizationTables = số (container|file) text có mã ngôn ngữ + bảng Unity chưa đọc từ candidates (unity.i2/localization_package/textasset, mỗi path 1). stats còn có stringSource, tableBreakdown{read, unity_unread}.
- Test: tests/run_stats_tests.js (23 ca, dùng IPA giả của text/candidates/serialized/inventory); tổng 23 bộ. Smoke Playwright (ngoài repo): text_ios → 15 chuỗi / 6 bảng, text_pak → 4/2, cand_unity_bundles → 0/2 hiển thị đúng trên dashboard.
- Lưu ý: "bảng" là số ĐÃ THẤY, không phải bằng chứng game dùng lúc chạy. Unity TextAsset chưa vào stringCount (text_extract chưa đọc Unity).
