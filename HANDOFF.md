# HANDOFF.md

## Phiên hiện tại: Account 06 (tiếp) – SUB-PHASE 5.2c SerializedFile reader HOÀN THÀNH (trên dữ liệu giả lập) → bàn giao Account 07 (Bước 0: xác nhận trên dữ liệu thật, rồi 5.2b)
Lý do làm 5.2c trước 5.2b (người dùng đồng ý “Làm đi”): log thật (extractor_5/6) cho thấy DATA WING KHÔNG có AssetBundle UnityFS nào (“Không có file nào có đuôi/magic của AssetBundle Unity”); 55 file Unity chưa parse là SerializedFile. Dead Cells và PvZ2 không phải Unity; bước UnityFS chạy sạch, không lỗi.

### KẾT QUẢ DỮ LIỆU THẬT ĐẦU TIÊN cho 5.2c (log extractor.log/extractor_2.log, bản 0.11.0, Account 06 ghi nhận)
DATA WING v1.4.1 (Unity IL2CPP, Unity 5.6.4p1/5.6.5p2): UnityFS = 0 bundle (đúng như dự đoán); SerializedFile **91/91 đọc được, tất cả version 17**, 38.874 object, 1.562 MonoScript đọc được, **9.344/9.344 MonoBehaviour quy được về class (0 chưa xác định)**, 3 TextAsset (đều UTF-8) , 9 font trong object Font (7 hợp lệ, **2 không hợp lệ – chưa rõ vì sao**), tổng 1,3 MB trích xuất; thời gian bước ≈ 0,3 s. Dead Cells, Dadish 2: không có SerializedFile (Dadish 2: 18 BMFont XML hợp lệ ở bước font).
→ Đã xác nhận trên dữ liệu thật: header v17 LE, bảng type/object (38.874 object, không `problems`?—log không liệt kê, cần JSON), bảng scripts, bố cục MonoScript, phép quy MonoBehaviour→script cùng file/ngoài file. **CHƯA xác nhận:** v19–22, big-endian, type tree bật, bundle UnityFS, TextAsset ngoài UTF-8, 2 font không hợp lệ (cần `unity_serialized.json`: `fonts[].problems`), tên class MonoBehaviour (log không in `mono_classes`), game dùng TMP/localization nào.
Việc cần người dùng: gửi `unity_serialized.json` của DATA WING (nút “Tải unity_serialized.json”) để (1) xem 2 font invalid là gì (heuristic quét có thể nhận nhầm blob), (2) xem `mono_classes` để biết chữ của game nằm ở class nào (đoán: MonoBehaviour/ScriptableObject tự định nghĩa vì chỉ có 3 TextAsset).

### ĐỊNH DẠNG TextAsset “Localization” CỦA DATA WING (người dùng gửi `Localization_106.txt`, Account 06 phân tích)
- CSV UTF-8 (không BOM), **dòng kết thúc CRLF**, mọi ô đều bọc nháy kép (`QUOTE_ALL`), 615 dòng × **19 cột** (không dòng nào lệch cột), 951.414 byte. Dòng 1: `"Language"` + 18 tên ngôn ngữ dạng enum (English, Spanish, German, French, BrazilianPortuguese, Swedish, Italian, Georgian, Russian, Japanese, Dutch, Polish, Hungarian, Danish, Turkish, Korean, Czech, ChineseSimplified). Dòng 2: `"TranslationKey"` + mã (EN, ES, FR, PT-BR; còn lại để trống). Từ dòng 3: **613 khóa duy nhất** (UI_*, ChExp_*, ChInt_*, Credits_*, Obj_*, Tutorial_*, …), cột 2 = tiếng Anh (0 ô trống), các ngôn ngữ khác thiếu 2–3 ô.
- 14 dòng có xuống dòng THẬT trong ô; 896 ký hiệu `\n` (chữ), thẻ `<c>…</>`, `<e>`, placeholder `{0}`/`{1}`, vài chuỗi “nhiễu” cố ý (`<<.>`, `[+1(413)```-````]`) – phải giữ nguyên khi dịch. Tiếng Anh tổng ~40.114 ký tự (~65 ký tự/chuỗi): khối lượng dịch nhỏ.
- **Ghi lại bằng `csv.writer(QUOTE_ALL, lineterminator='\r\n')` cho ra file GIỐNG HỆT từng byte** (đã kiểm) → sửa/ghi lại CSV an toàn.
- Câu hỏi MỞ (chưa trả lời, không đoán): (1) game chọn cột bằng tên enum trong code C# (IL2CPP) hay đọc động theo header? Nếu theo enum thì THÊM cột “Vietnamese” sẽ không chọn được; khả thi hơn là THAY nội dung một cột ngôn ngữ sẵn có (nhãn trong menu ngôn ngữ cũng cần xem). (2) Font TMP của ngôn ngữ đó có glyph tiếng Việt (dấu) không – cần đọc TMP_FontAsset (chưa làm). (3) Ghi ngược TextAsset đã sửa vào `resources.assets` (đổi kích thước object → dịch offset/bảng object, và gói lại IPA/ký lại) chưa có.

### 5.2c – SERIALIZEDFILE READER
Tạo: `js/modules/serialized_file.js`, `tests/make_serialized_ipas.py`, `tests/run_serialized_tests.js`.
Sửa: `js/ipa_reader.js` (bước 11 `serialized`), `js/state.js`, `js/workers/ipa.worker.js`, `index.html` (module + nút `#btn-serialized-json`), `js/events.js` (`results.serialized`, `results.serializedFiles`, nút tải), `js/ui.js` (`buildSerializedCard`, cache theo `results.serialized`), `js/app.js` (0.11.0-phase5.2c), INTERFACES/NEXT_TASK/HANDOFF.
**Làm được:** header v9–22 (LE/BE, v22 mở rộng), metadata (type, bảng object, scripts, externals), thống kê ClassID, trích NGUYÊN BẢN TextAsset (`.txt`/`.bin`), trích font nhúng trong object Font (heuristic quét magic + kiểm FontDump), đọc tên MonoScript và quy MonoBehaviour về tên class, đọc cả node SerializedFile trong bundle UnityFS, JSON `unity_serialized.json`, UI có nút ⬇ từng TextAsset/font. **Chưa làm (cố ý):** giải mã MonoBehaviour/TMP_FontAsset/Texture2D/Sprite/AudioClip, .resS/.resource, type tree kiểu cũ (v<10, v11), ZIP (Phase 9), gộp font Unity vào `fonts.json`.
**Kiểm thử đã chạy (TOÀN BỘ DỮ LIỆU GIẢ LẬP):** `node tests/run_serialized_tests.js` **140 đạt**: 12 SerializedFile hợp lệ (v13, v15 LE+BE, v17 LE+BE, v19/v21 có type tree, v22), trích TextAsset khớp SHA-256 tính độc lập (UTF-8 tiếng Việt giữ nguyên, nhị phân → `.bin`), 5 font trích đúng (blob giả đứng trước font thật → chọn font thật; blob giả một mình → `valid=false` kèm lý do), MonoBehaviour quy về class (script cùng file, ở file ngoài qua externals, không tồn tại → “không xác định”; v15 script ở object; BE), node trong bundle UnityFS; ca lỗi (v9 type tree cũ, version 23, rác, rỗng, cắt cụt, object vượt file, TextAsset hỏng, Font không có font nhúng); hủy, ngân sách trích xuất, file quá lớn, giới hạn số file, đầu vào xấu. Mutation: 12 phá hoại (align4, ngưỡng v14, byteStart v22, node type tree 24/32, typeDependencies v21, script idx v11–16, stripped byte, hash MonoScript, u16 endian, kiểm biên, endian độ dài font, nhận blob không hợp lệ) → test đều fail (3 mutation ban đầu sống sót ⇒ đã thêm fixture level10/level11 để giết). Hồi quy 8 bộ test cũ đạt nguyên số lượng. Chromium headless (390/1100 px, worker thật): bước `serialized` “14/18 file, 13 TextAsset, 5 font”, tải JSON và tải TextAsset (tiếng Việt đúng), 0 lỗi JS, 0 request ngoài, không tràn ngang.
**CHƯA kiểm thử – quan trọng:** SerializedFile/bundle Unity THẬT (chưa từng có). Fixture do chính Account 06 dựng theo CÙNG giả định bố cục với module → chỉ chứng minh logic nhất quán, KHÔNG chứng minh khớp định dạng Unity thật. Mạng tắt nên không đối chiếu được AssetStudio/UnityPy. Rủi ro lớn nhất: bố cục header/metadata/object table các version, layout TextAsset (m_Name, m_Script), MonoScript (m_Name, executionOrder, hash16, class/namespace/assembly), heuristic tìm font trong object Font. Cũng chưa kiểm: bộ nhớ khi đọc file gần 256 MiB trên iPhone, Safari thật, hiệu năng, game dùng type tree bật (đã bỏ qua node tree theo kích thước 24/32 byte nhưng chưa thử thật), file Unity 3/4 (version <9).
**Lưu ý game thật:** nhiều game Unity lưu chữ trong MonoBehaviour/ScriptableObject/bảng localization riêng (không phải TextAsset) và TMP_FontAsset; 5.2c chỉ báo CÓ các class đó (qua tên class script) chứ chưa đọc nội dung. Font nhiều khi nằm trong `.resS`/stream hoặc font hệ thống → object Font có thể không có byte font.

### Quyết định
- Quét theo TÊN file (không có magic cho SerializedFile) + cổng cấu trúc (version 9–22, endian 0/1, data_offset hợp lý).
- TextAsset giữ NGUYÊN BYTE; không đoán mã hóa. Font: heuristic có gắn `valid`.
- MonoScript đọc từ mọi file có class 115 (đọc đủ file một lần); MB → class quy sau khi quét xong.
- Bundle: `UnityFS.open` đọc lại cả bundle (≤ 256 MiB) để `readNode` từng node SerializedFile.

### Hạn chế còn tồn tại
- Git/GitHub: không có `.git` trong zip, không GitHub liên kết → KHÔNG commit/push được; người dùng cần tự đưa zip lên repo.
- Như 5.1/5.2a (font thật, Safari iPhone, bộ nhớ).

---

## (Trước đó) Account 06 (theo yêu cầu người dùng “viết thêm parser UnityFS”) – SUB-PHASE 5.2a HOÀN THÀNH (trên dữ liệu giả lập) → bàn giao Account 07 làm 5.2b
Vòng quay: 01 → … → 10 → 01. Account 05 đã bàn giao 5.1; NEXT_TASK cũ là “5.2 font metadata + TMP (UnityFS chỉ làm nếu parser đọc được an toàn)”. Người dùng yêu cầu parser UnityFS nên Account 06 làm đúng phần UnityFS (5.2a) và CHƯA làm metadata font (chuyển thành 5.2b).

### 5.2a – UNITYFS CONTAINER PARSER
Tạo: `js/modules/unity_fs.js`, `tests/make_unityfs_ipas.py`, `tests/run_unityfs_tests.js`.
Sửa: `js/ipa_reader.js` (bước 10 `unityfs`), `js/state.js` (bước pipeline), `js/workers/ipa.worker.js` + `index.html` (nạp module, nút `#btn-unityfs-json`), `js/events.js` (`results.unityfs`, nút tải), `js/ui.js` (`buildUnityFsCard`, `renderUnity` cache theo cả unityfs, hiện thẻ cả khi `results.unity` rỗng), `js/app.js` (0.10.0-phase5.2a), INTERFACES/NEXT_TASK/HANDOFF/README.
**Làm được:** header UnityFS (v6–8), bảng blocks+directory (LZ4/LZ4HC/LZMA/không nén), liệt kê block/node, giải nén nội dung MỘT node (`readNode`), quét mọi bundle trong IPA (chọn bằng đuôi hoặc magic qua manifest), JSON `unityfs_index.json`, UI. **Chưa làm (cố ý):** SerializedFile/object (TextAsset, Font, TMP…), LZHAM, UnityWeb/Raw/Archive, xuất node ra file/ZIP.
**Kiểm thử đã chạy (TẤT CẢ DỮ LIỆU GIẢ LẬP):** `node tests/run_unityfs_tests.js` **217 đạt**: 12 bundle hợp lệ (LZ4, LZ4HC, LZMA, không nén, info ở cuối v6/v7, cờ 0x200, block hỗn hợp 4 kiểu nén, LZMA lc/lp/pb khác mặc định, 2,5 MB với match xa, node rỗng, tên node Unicode) – từng node giải nén khớp SHA-256 tính độc lập bằng hashlib; 17 ca lỗi (cắt cụt, header cụt, info LZHAM, version 9, UnityWeb, magic sai, info 2 GB, info LZ4/LZMA bị phá, bit flag lạ, size header sai, node vượt dữ liệu, đường dẫn node `..`/tuyệt đối, block LZHAM, rỗng, chỉ chữ ký); `readNode` (node không tồn tại, bundle chưa parse, hủy, thiếu byte, sửa byte → SHA khác); `scan` trong IPA (29 ứng viên, 18 đọc được, file không đuôi chọn bằng magic, hủy, giới hạn số bundle/dung lượng, không manifest, không có bundle). Mutation: 8 phá hoại (LZ4 chồng lấn, LZMA matched-literal, LZMA rep3, bỏ căn lề v7, bỏ ứng viên căn lề, bỏ kiểm node vượt, bỏ kiểm version, giải nén block thừa) → test đều fail. Hồi quy: detect 359, scan 112, unity 86, metadata 72, literal 53, tables 314, font 76 – đạt. Chromium headless (390 px và 1100 px, worker thật): bước `unityfs` “18/29 bundle, 35 node”, thẻ hiển thị, tải `unityfs_index.json` đúng schema, 0 lỗi JS, 0 request ngoài, không tràn ngang.
**CHƯA kiểm thử – quan trọng:** bundle UnityFS THẬT (chưa từng có). Fixture do chính Account 06 dựng theo CÙNG giả định bố cục với module → chỉ chứng minh logic nhất quán, KHÔNG chứng minh khớp định dạng Unity thật. Mạng tắt nên không đối chiếu được AssetStudio/UnityPy; bố cục viết từ kiến thức. Điểm rủi ro nhất: vị trí bắt đầu vùng dữ liệu (căn lề 16 ở v7/flag 0x200) – đã có tự kiểm bằng tổng kích thước block, nếu sai sẽ báo `invalid` chứ không đọc bậy. Cũng chưa kiểm: LZMA trên bundle Unity thật (dùng props+dict 5 byte), bộ nhớ với bundle gần 256 MiB trên iPhone, Safari thật, hiệu năng LZMA JS (chưa đo trên thiết bị).
**Đừng hiểu nhầm về DATA WING:** log thật cho thấy 55 “file Unity asset/bundle chưa parse”. Chưa biết chúng là UnityFS hay SerializedFile (`*.assets`, `level*`, `sharedassets*`, `*.resS`). Rất có thể phần lớn KHÔNG phải UnityFS → parser này chưa chắc giúp được. Cần `unity_info.json`/manifest hoặc ảnh view Unity/Metadata sau khi chạy bản 0.10.0 để biết bao nhiêu file có magic UnityFS (thẻ UnityFS sẽ hiện số bundle).

### Quyết định
- `readNode` chỉ giải nén block phủ node; không giữ bundle trong state (scan chỉ đọc header+info; bundle có info ở cuối phải đọc cả file, tối đa 256 MiB, vượt → `too_large`).
- Không thử giải mã bundle lỗi/mã hóa; chỉ báo trạng thái.
- Thẻ UnityFS nằm trong view “Unity / Metadata”, không tạo view mới.

### Hạn chế còn tồn tại
- Git/GitHub: không có `.git` trong zip và không có GitHub liên kết → KHÔNG commit/push được trong phiên này; người dùng cần tự đưa zip lên repo.
- Như 5.1 (font thật, Safari iPhone, bộ nhớ).

---

## (Trước đó) Account 05 (làm tiếp theo yêu cầu người dùng) – SUB-PHASE 5.1 HOÀN THÀNH (trên dữ liệu giả lập) → bàn giao cho Account 06 làm 5.2
Phase 4 đã xác nhận trên IPA thật (xem mục “XÁC NHẬN TRÊN FILE THẬT” bên dưới). Người dùng yêu cầu “làm tiếp 5.1” nên 5.1 được làm trong cùng phiên.

### 5.1 – FONT DISCOVERY AND EXTRACTION
Tạo: `js/modules/font_dump.js`, `tests/make_font_ipas.py`, `tests/run_font_tests.js`.
Sửa: `js/ipa_reader.js` (bước 9 `fonts`), `js/state.js` (nhãn bước), `js/workers/ipa.worker.js` + `index.html` (nạp module, `#view-fonts`, 2 nút tải), `js/ui.js` (`renderFonts`, `buildPagedTable` nhận Node, bỏ placeholder fonts), `js/events.js` (fonts vào session, `stats.fontCount`, nút tải), `js/app.js` (0.9.0-phase5.1), README/INTERFACES/NEXT_TASK/HANDOFF.
Kiểm thử đã chạy (TẤT CẢ DỮ LIỆU GIẢ LẬP): `node tests/run_font_tests.js` **76 đạt** (classifyBytes thuần; TTF/OTF/TTC 2 font/WOFF/WOFF2/BMFont text-XML-binary/font không đuôi nhận bằng magic; byte trích xuất khớp SHA-256 tính độc lập bằng hashlib và khớp manifest; cắt cụt, WOFF sai length, đuôi sai, .ttf không phải font, .fnt không phải BMFont, .atlas chưa xác minh; trùng nội dung; UIAppFonts found/missing; liệt kê Unity asset chưa parse; ../ không an toàn; file rỗng; chế độ fast; không manifest; hạn mức file/tổng/số lượng; hủy; đầu vào xấu). Mutation: tắt kiểm tra length WOFF / giới hạn bảng sfnt → test fail. Hồi quy: detect 359, scan 112, unity 86, metadata 72, literal 53, tables 314 – đạt. Chromium headless (khung 390 px & 1100 px): view Font, tìm kiếm, tải font (SHA-256 đúng), tải font_index.json/fonts.json, 0 lỗi JS, 0 request ngoài, không tràn ngang.
**Chưa kiểm thử:** font THẬT (font fixture chỉ có header, không glyph), IPA thật có font; Safari iPhone; bộ nhớ với font lớn (hạn mức 64 MiB/file, 256 MiB tổng là ước lượng, chưa đo trên thiết bị). IPA DATA WING (Unity) chưa kiểm view Font – nhiều game Unity để font trong asset bundle nên có thể “Không tìm thấy font” + cảnh báo Unity chưa parse (đúng thiết kế).
**Quyết định:** phân loại theo byte đã đọc; font hỏng vẫn giữ nguyên + cờ; `.atlas` không tính là font; byte nằm ngoài JSON (`font_files`); `fonts.json` chỉ có phần phát hiện (metadata = null, không bịa).
**Hạn chế/ghi nhớ:** không có GitHub liên kết, không commit/push được (zip không có `.git`).

---

## (Trước đó) Account 05 – SUB-PHASE 4.3
Vòng quay: 01 → 02 → … → 10 → 01.

## Cập nhật sau log THẬT đầu tiên (Account 05, v0.8.1)
Log người dùng gửi: `DATA WING_v1.4.1-AppAssassin.ipa` (61 MB, 165 entry, arm64, Unity IL2CPP confirmed 99%, Unity phiên bản không đọc được, 9/18 nhóm thành phần Unity, metadata `Data/Managed/Metadata/global-metadata.dat`) → **metadata version 23**, trước đó bị `unsupported_version` nên literal/tables bị bỏ qua. Il2CppDumper nhận 16..31 (có 23) và schema Min/Max của MetadataClass.cs đã phủ v23, nên đã thêm 23 vào `KNOWN_VERSIONS` (metadata_dump.js), `LITERAL_VERSIONS`, `TABLE_VERSIONS`. 18/25/26/28/30 vẫn KHÔNG hỗ trợ (chưa có bằng chứng). Test: ca “unsupported” đổi từ v23 sang `m42_version_25`; thêm IPA giả `tbl_v23`; kết quả: detect 359, scan 112, unity 86, metadata 72, literal 53, tables 314 – đều đạt.
**XÁC NHẬN TRÊN FILE THẬT (log extractor_2.log, bản 0.8.1):** DATA WING, metadata v23 → header `generic_ok` (32 cặp offset/size trong file); string literal `ok` 8491 (0 UTF-8 sai, 0 ngoài vùng); bảng metadata `ok` – 13 assembly, 13 image, 165 namespace, 4674 type, 36662 method, 24497 field, 33277 tham số (bố cục v23); không báo bất thường cấu trúc (mọi vùng chia hết struct, chỉ số trong phạm vi). Đây là bằng chứng mạnh bố cục v23 đúng, nhưng CHƯA có ảnh/xem nội dung tên (assembly/class) và chưa mở dump.cs thật để kiểm tên; v24.x/27/29/31 và các version khác vẫn chỉ kiểm bằng dữ liệu giả lập. Phase 4 được coi là xong; sang SUB-PHASE 5.1.

## Sub-phase 4.3 – METADATA EXTRACTION AND REPORT: HOÀN THÀNH (trên dữ liệu giả lập)
Account 04 đã làm string literal; **Account 05 đã làm phần còn thiếu: assembly / image / namespace / class / method / field + Meta/dump.cs + báo cáo + UI.**
**Điều kiện được thỏa:** nguồn xác minh bố cục lấy được bằng `git clone --depth 1 https://github.com/Perfare/Il2CppDumper` (qua proxy của phiên; WebFetch trước đó chỉ trả tóm tắt). Đã đọc đầy đủ `MetadataClass.cs`, `Metadata.cs`, `Outputs/Il2CppConstants.cs`, `Outputs/Il2CppDecompiler.cs` ở commit `4741d46ba9cd6159c5d853eb9d6fc48b4bfa2b1a`. Đây là cách làm được cho các nguồn khác nếu cần (git clone thay vì WebFetch).
Tạo: `js/modules/metadata_tables.js`, `tests/derive_schema_from_cs.py`, `tests/fixtures/il2cpp_struct_schema.json`, `tests/make_tables_ipas.py`, `tests/run_tables_tests.js`.
Sửa: `js/ipa_reader.js` (bước 8 `tables`), `js/state.js` (bước `tables`), `js/workers/ipa.worker.js` + `index.html` (nạp module; 2 nút tải), `js/modules/unity_dump.js` (trường `metadata_tables:null`), `js/modules/metadata_dump.js` (`toSummary`/`toReportFields` nhận `tables`, summary → `/3`, sửa chú thích đầu file), `js/ui.js` (`buildTablesCard`, `buildPagedTable`, bỏ câu “chưa hỗ trợ”), `js/events.js` (nút dump.cs / metadata_tables.json, truyền tables vào toSummary), `js/app.js` (0.8.0-phase4.3), `tests/run_literal_tests.js` (nạp module mới + schema `/3`), `tests/run_metadata_tests.js` (nạp module mới), README/INTERFACES/NEXT_TASK/HANDOFF.

### Kiểm thử đã chạy (Account 05) – TẤT CẢ TRÊN DỮ LIỆU GIẢ LẬP
- `node tests/run_tables_tests.js` **300 đạt**: schema JS == schema dẫn xuất tự động từ file C# (8 struct × 15 version, gồm 24.1/24.2/24.3/24.4/24.5); 18 IPA giả lập (v16, 17, 19, 20, 21, 22, 24.0, 24.1, 24.1+, 24.2, 24.4, 27, 29 [deflate+stored], 31, và v24.x với 20 image) khớp từng assembly/image/type/method/field/tham số/token/cờ với bản dựng độc lập bằng Python; v33 unsupported; method range vượt, tên ngoài vùng, bảng không chia hết struct (`layout_mismatch`), stringSize vượt file (4.2 chặn); 6 ca không đủ điều kiện → skipped; parseHeader/planRegions/decodeTables với đầu vào xấu; dump.cs; quy mô 20.000 type / 200.000 method / 100.000 field (~0,6 s trong Node, heap ~320 MiB); hủy giữa chừng; đầu vào xấu. Mutation test: sửa sai 1 trường schema → test fail.
- Hồi quy: detect 359, scan 112, unity 86, metadata 72, literal 53 – đều đạt.
- Chromium headless (http): v29, 200.000 method ở khung 390 px, v33 (unsupported), bảng không chia hết (layout_mismatch): thẻ, chọn bảng, tìm kiếm, tải `dump.cs` / `metadata_tables.json` / `metadata_summary.json` (v3, partial=false) đúng; 0 lỗi JS, 0 request ra ngoài, không tràn ngang.
**Chưa kiểm thử:** metadata THẬT (mọi version), Safari iPhone thật, bộ nhớ trên iPhone với metadata lớn (giới hạn 128 MiB string / 192 MiB bảng là ước lượng, chưa đo trên thiết bị), v24.3/24.5 chưa có IPA giả lập riêng (cùng bố cục 24.2/24.4, chỉ đối chiếu schema).

### Quyết định / lưu ý
- Tên kiểu của field/tham số/return/parent nằm trong bảng `Il2CppType` của binary → chỉ giữ chỉ số thô (`*_raw_index`); KHÔNG đọc binary, KHÔNG suy tên kiểu, KHÔNG có RVA/offset. Ghi rõ trong `not_extracted`, dump.cs và UI.
- Nhận diện v24.2/24.4 và 24.1/24.1+ bằng kích thước assembly khớp chính xác (khác tham chiếu, có lý do trong INTERFACES.md).
- Metadata nhỏ → vẫn đọc hai lượt (literals rồi tables). Nếu IPA thật chậm, gộp hai lượt thành một (tối ưu sau, chưa đo).
- `dump.cs` sinh khi bấm nút (từ `toDumpCs`), không lưu trong state.

### Hạn chế còn tồn tại
- Như 4.1/4.2. Bước 0 (log/ảnh IPA THẬT của Phase 2–4) vẫn chưa có dữ liệu từ người dùng. Nên xin trước khi sang Phase 5 nếu có thể; nếu 4.x sai trên dữ liệu thật thì sửa trước.
- **Git/GitHub:** phiên này không có GitHub account liên kết (`list_repos` báo “no GitHub account linked”) và zip không có `.git` → KHÔNG commit/push được. Người dùng cần tự đưa zip lên repo như các lượt trước.

---
## Phiên hiện tại: Account 04 (SUB-PHASE 4.3) → bàn giao cho Account 05
Vòng quay: 01 → 02 → … → 10 → 01.

## Sub-phase 4.3 – METADATA EXTRACTION AND REPORT: HOÀN THÀNH MỘT PHẦN (string literal); phần còn lại cố ý chưa làm
**Đã làm:** trích xuất string literal (xem INTERFACES.md “4.3”), hiển thị (tìm kiếm, phân trang), tải `unity_string_literals.json` và `metadata_summary.json` (v2), trường báo cáo. Căn cứ: 2 nguồn công khai (Il2CppDumper Metadata.cs; il2cpp_dumper structures.rs – tóm tắt) cho bảng literal v16–31 (tập LITERAL_VERSIONS).
**Chưa làm, có chủ đích (đừng coi là hoàn thành):** assembly, namespace, class, method, field và `Meta/dump.cs`. Lý do: bố cục struct theo version không xác minh được từ nguồn (WebFetch chỉ trả tóm tắt diễn giải, không có byte-layout). Báo rõ trong UI/JSON (`not_supported`). Muốn làm: tìm nguồn có định nghĩa đầy đủ (vd file `Il2CppDumper/Il2Cpp/MetadataClasses.cs` — lần tìm kiếm này không lấy được) hoặc nhờ người dùng gửi, rồi xác minh bằng metadata thật.
**Vì vậy 4.3 CHƯA nên đánh dấu “đạt đầy đủ”: còn thiếu phần class/method/field/dump.cs.** Account 05 nên hoặc (a) hoàn tất phần còn thiếu của 4.3 nếu đã có nguồn xác minh, hoặc (b) sang Phase 5 sau khi người dùng chấp nhận phạm vi hiện tại.

Tạo: `tests/make_literal_ipas.py`, `tests/run_literal_tests.js`. Sửa: `js/modules/metadata_dump.js`, `js/modules/unity_dump.js` (schema `unity_info/3`, `metadata_literals`), `js/ipa_reader.js` (bước `literals`), `js/state.js`, `js/ui.js`, `js/events.js`, `index.html`, `js/app.js` (0.7.0-phase4.3), `tests/run_unity_tests.js` + `tests/run_metadata_tests.js` (1 dòng schema/sub_phase), README/INTERFACES/NEXT_TASK/HANDOFF.

### Kiểm thử đã chạy – TẤT CẢ TRÊN DỮ LIỆU GIẢ LẬP tự dựng
- detect 359, scan 112, unity 86, metadata 72, **literal 53** đạt: nội dung từng literal khớp bản dựng độc lập (Unicode, markup, trùng, rỗng, 5000 ký tự), v24/v29(stored)/v31, UTF-8 lỗi (cờ + ký tự thay), 1 mục ngoài vùng (text=null), bảng hỏng nặng (invalid_table), bảng không chia hết 8, bảng rỗng, v33/v35 (unsupported), không đủ điều kiện (bad magic, v23, byte8=0, không metadata, Mono, không Unity → skipped), 120.000 literal, hủy, đầu vào xấu, summary/report.
- Chromium headless: 4 ca (v24, 120.000 literal ở khung 390 px, v35 unsupported, bad magic) — thẻ, tìm kiếm, phân trang, tải 2 JSON đúng; 0 lỗi JS, 0 request ngoài.
**Chưa kiểm thử:** metadata THẬT (bất kỳ version), Safari iPhone thật, bộ nhớ với metadata thật lớn (giới hạn bảng 64 MiB / dữ liệu 256 MiB là ước lượng, chưa đo). Cặp #0/#1 = literal/literal-data dựa trên thứ tự trường ở 2 nguồn + mốc 264; chưa xác nhận bằng file thật.

### Hạn chế còn tồn tại
- Như 4.1/4.2; không có `.git` trong zip, không commit/push được từ phiên này.

---
## Phiên hiện tại: Account 04 (SUB-PHASE 4.2) → bàn giao cho Account 05
Vòng quay: 01 → 02 → … → 10 → 01. (Phần Account 02/03 bên dưới vẫn đúng.)

## Sub-phase 4.2 – METADATA HEADER AND VERSION (Account 04): HOÀN THÀNH (trên dữ liệu giả lập)
Phạm vi: đọc ≤ 4096 byte đầu của `global-metadata.dat` đã chọn ở 4.1, kiểm magic `AF 1B B1 FA`, version (int32), và kiểm tra chung các cặp offset/size so với kích thước file. KHÔNG trích xuất (4.3), không giải mã.
Tạo: `js/modules/metadata_dump.js`, `tests/make_metadata_ipas.py`, `tests/run_metadata_tests.js`.
Sửa: `js/modules/unity_dump.js` (schema `unity_info/2`, sub_phase `4.2`, trường `metadata_header:null`, cập nhật vài câu chữ), `js/ipa_reader.js` (bước `metadata`), `js/state.js` (bước pipeline), `js/workers/ipa.worker.js`, `index.html` (script, nút `#btn-metaheader-json`, câu chữ), `js/ui.js` (`buildMetaHeaderCard`), `js/events.js` (nút tải, log), `js/app.js` (0.6.0-phase4.2), `tests/run_unity_tests.js` (1 dòng: schema/sub_phase mới), `README.md`, `INTERFACES.md`, `HANDOFF.md`, `NEXT_TASK.md`.

### QUYẾT ĐỊNH QUAN TRỌNG (đọc kỹ)
- Đã dùng WebSearch/WebFetch đối chiếu 2 nguồn công khai (Il2CppDumper `Metadata.cs`, il2cpp_dumper 0.5.5 `metadata.rs`) cho: magic, vị trí version, dải version, danh sách version đã biết, mốc 264 của v24.2. **Không lấy được định nghĩa struct header theo từng version** (trang bị cắt/không có nội dung) và không viết từ trí nhớ → **không có version nào được coi là “supported” ở mức trường**. Vì vậy bộ trạng thái khác NEXT_TASK cũ: thay `supported` bằng `generic_ok` (kiểm tra chung) và thêm `header_unverified`.
- **4.3 BẮT BUỘC xác minh bố cục header từng version từ nguồn đáng tin (ví dụ lấy file `Il2CppDumper/Il2Cpp/MetadataClasses.cs` hoặc `structures.rs` qua WebSearch → WebFetch, hoặc nhờ người dùng gửi) TRƯỚC khi đọc bất kỳ bảng nào.** Nếu không xác minh được, 4.3 chỉ báo unsupported, không đoán.
- Giả định chung (byte 8 = kích thước header) chưa được kiểm trên metadata thật ngoài v24.2; nếu IPA thật cho `header_unverified`/`invalid_header` sai, sửa giả định ở `inspectHeader`.

### Kiểm thử đã chạy (4.2) – TẤT CẢ TRÊN DỮ LIỆU GIẢ LẬP do chính phiên này dựng
- `node tests/run_detect_tests.js` 359 đạt; `run_scan_tests.js` 112 đạt; `run_unity_tests.js` 86 đạt (không hồi quy); `node tests/run_metadata_tests.js` **72 đạt**: header v24 (264 B/32 cặp), v29 (272 B/33 cặp), v31 + trailing; bad magic; file 0/6/8/10 byte; offset vượt file, offset+size vượt file, offset trong header, giá trị âm, chồng chéo (cảnh báo); version 23/15/150 (unsupported), 999999 và âm (invalid); byte 8 = 0 hoặc 5000 (header_unverified); header lẻ; 4.1 không chọn file (missing/ambiguous/mono/không Unity → not_checked/skipped, 0 byte); đo byte thật đọc từ File 20 MB stored (≤ 4096+94) và 30 MB deflate (≤ 2 MB, thực tế cắt luồng sớm); đầu vào xấu, lỗi đọc, hủy.
- Chromium headless qua http: view trống trước phân tích; v24 → bước `metadata` “generic_ok · v24”, thẻ hiện đúng số liệu; bad_magic (khung 390 px, không tràn ngang), version 23, không metadata (not_checked) đều hiển thị đúng; tải `metadata_summary.json` đúng schema; Xóa phiên đưa view về trống; 0 lỗi JS, 0 request ra ngoài.
**Chưa kiểm thử:** metadata THẬT của game (mọi version), IPA Unity thật, Safari iPhone thật, `file://`. Bước 0 (log IPA thật Phase 2–4) vẫn chưa có dữ liệu từ người dùng.

### Hạn chế còn tồn tại
- Như Phase 4.1 (chữ ký `AF 1B B1 FA` chưa có trong magic_bytes.js; chưa kiểm cryptid của UnityFramework).
- Không có `.git` trong zip; không commit/push trong phiên này (không có quyền/remote). Người dùng cần tự đưa zip lên GitHub như các lượt trước.

---
(Ghi chú các phiên trước giữ nguyên bên dưới.)

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
