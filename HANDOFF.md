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
