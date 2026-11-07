# INTERFACES.md – API hiện tại (Phase 0 → 3)

Namespace: `window.IPAStudio` (gọi tắt NS). Chỉ liệt kê cái ĐÃ tồn tại. Cập nhật file này mỗi khi thêm/sửa chữ ký.

## NS.Logger (js/modules/logger.js)
```
Logger.info(message, opts?)    -> entry
Logger.success(message, opts?) -> entry
Logger.warning(message, opts?) -> entry
Logger.error(message, opts?)   -> entry
Logger.debug(message, opts?)   -> entry
  opts = { step?:string, module?:string, details?:any, error?:Error|any }
  entry = { timestamp:ISO, level, step|null, module, message, details|null, error:{name,message,stack}|null }
Logger.LEVELS                  -> ['INFO','SUCCESS','WARNING','ERROR','DEBUG']
Logger.getEntries()            -> entry[]   (bản sao, tối đa 5000)
Logger.clear()                 -> void      (listener nhận null)
Logger.subscribe(fn(entry|null)) -> unsubscribe()
Logger.formatLine(entry)       -> string
Logger.toText()                -> string    (dùng cho Logs/extractor.log)
```

## NS.State (js/state.js)
```
State.PIPELINE_STEPS           -> [{id,label}] ids: read, plist, engine, scan, extract, fonts, report, package
State.get()                    -> { view:string, session:Session }
State.subscribe(fn(state, changedKeys)) -> unsubscribe()
State.setView(viewId)
State.updateSession(patch)     // Object.assign vào session, phát sự kiện
State.setStep(id, status, message?)  // status: pending|running|done|error|skipped
State.resetSession()           // xóa dữ liệu phiên

Session = {
  status: 'idle'|'file_selected'|'running'|'done'|'error'|'cancelled',
  file: File|null, fileCheck: {ok,message}|null,
  app: null | { name, bundleId, version, build, architectures:string[] },   // Phase 1 điền
  engine: null | { engine, variant, confidence, ... },                      // Phase 2 điền
  manifest: null, results: {},
  stats: { totalFiles, fontCount, stringCount, localizationTables }  // null = chưa có
  steps: [{id,label,status,message}], progress: 0..1,
  startedAt, completedAt
}
```
view ids: overview, analyze, engine, explorer, fonts, text, localization, runtime, metadata, report, settings.

## NS.UI (js/ui.js)
```
UI.VIEWS                       -> { [viewId]: {title, icon, phase?, empty?} }
UI.$(sel, root?) / UI.$$(sel, root?)
UI.h(tag, props?, children?)   -> HTMLElement   // props: class, text, hoặc attribute; text luôn là textContent
UI.init()                      // dựng stat grid, view rỗng, nối logger → log viewer
UI.render(state)               // vẽ lại toàn bộ từ state (được subscribe trong app.js)
UI.toast(message, kind?, ms?)  // kind: success|error|warning|info
UI.formatBytes(n)              -> string
UI.applyTheme('dark'|'light')
```
View có `empty` trong `UI.VIEWS` được sinh section `#view-<id>` dạng trạng thái trống. Phase sau thay bằng nội dung thật (bỏ `empty` hoặc render đè vào `#view-<id>`).

## NS.Events (js/events.js)
```
Events.bind()                  // gắn mọi listener DOM, gọi 1 lần ở boot
Events.selectFile(file)        // reset session, kiểm tra đuôi .ipa, set status
```

## NS.VERSION (js/app.js) = '0.4.0-phase3'

## DOM id quan trọng
#btn-start, #btn-cancel, #btn-clear, #btn-pick, #file-input, #dropzone, #file-info, #file-check, #progress-bar, #steps, #log-viewer, #stat-grid, #generic-views, #toasts.

## Chưa tồn tại (đừng gọi)
IpaReader, PlistParser, BinaryReader, Hash, Manifest, Report, Export, WorkerManager, DetectEngine và mọi module phân tích khác.

---
# Bổ sung Phase 1 (Account 01)

Module dùng chung luồng chính + worker: `(function(root){...})(typeof window!=='undefined'?window:self)`; namespace `root.IPAStudio`.

## NS.PlistParser (js/plist_parser.js)
```
PlistParser.parse(bytes:Uint8Array) -> { format:'xml'|'binary', value:any }   // ném PlistError{code:'PLIST_ERROR'}
PlistParser.isBinary(bytes) -> boolean
```
data → Uint8Array; date → chuỗi ISO; integer vượt 2^53 → chuỗi.

## NS.BinaryReader (js/binary_reader.js)
```
BinaryReader.parseMachO(bytes:Uint8Array, fileSize?:number)
  -> { format:'thin'|'fat'|'unknown', archs:[{name,cpuType,cpuSubtype,offset,size,bits,encrypted:true|false|null,cryptid}], needBytes:number, error?:string }
```
`needBytes` > bytes.length nghĩa là cần đọc thêm phần đầu file để xác định `encrypted`.

## NS.IpaReader (js/ipa_reader.js)
```
IpaReader.LIMITS            -> { MAX_ENTRIES, MAX_CD_BYTES, MAX_TOTAL_UNCOMPRESSED, MAX_PLIST_BYTES, SUSPICIOUS_RATIO, MACHO_FIRST_READ, MACHO_MAX_READ }
IpaReader.IpaError          -> class Error { code }  // NOT_ZIP, NO_PAYLOAD, NO_INFO_PLIST, ZIP_BOMB, TOO_MANY_ENTRIES, BAD_ZIP, ZIP64_TOO_LARGE, UNSAFE_PATH, ENCRYPTED_ENTRY, UNSUPPORTED_METHOD, ENTRY_TOO_LARGE, SIZE_MISMATCH, INFLATE_FAILED, NO_DECOMPRESSION, CANCELLED, ...
IpaReader.openZip(file:File) -> Promise<{ entries:Entry[], zip64:boolean, fileSize:number }>
  Entry = { name, size, csize, method, flags, crc, offset, dir, encrypted, symlink, unsafe:string|null }
IpaReader.readEntry(file, entry, {max?:number, head?:boolean}) -> Promise<{ data:Uint8Array, truncated:boolean }>
  head:true = chỉ đọc `max` byte đầu rồi dừng; head:false = đọc đủ, lỗi nếu vượt max hoặc vượt size khai báo.
IpaReader.analyze(file, {bundle?:string}, hooks:{step?(id,status,msg), progress?(0..1), log?(level,msg,details), isCancelled?()})
  -> Promise<IpaResult>
IpaResult = {
  fileName, ipaSize,
  zip:{ entryCount, fileCount, totalCompressed, totalUncompressed, zip64, unsafeEntries, encryptedEntries, unsupportedMethodEntries },
  bundles:string[], selectedBundle:string, appRoot:'Payload/X.app/',
  app:{ bundleId,name,displayName,version,build,minOS,executable,category,deviceFamily:number[],deviceFamilyNames:string[],requiredCapabilities:string[],appFonts:string[] },
  infoPlistFormat:'xml'|'binary', infoPlist:object,
  architectures:string[], macho:null|{ path,size,format,archs,encrypted:true|false|null },
  topLevel:[{name,isDir,files,bytes}], frameworks:string[], plugins:string[], lprojs:string[],
  dataDir:null|{files,bytes}, hasScInfo:boolean,
  entries:[{path,size,csize,method,dir,unsafe,encrypted}],   // TOÀN BỘ entry của IPA
  warnings:string[], errors:string[]
}
```

## NS.WorkerManager (js/worker_manager.js)
```
WorkerManager.runIpa(file, opts:{bundle?}, handlers:{onStep?,onProgress?,onLog?}) -> { promise:Promise<IpaResult>, cancel():void }
  // promise reject Error có .code ('CANCELLED' khi hủy). Tự fallback luồng chính nếu Worker không tạo được.
```
Giao thức worker: main→`{type:'analyze',file,opts}`; worker→`{type:'step'|'progress'|'log'|'result'|'error'}`.

## Thay đổi ở module cũ
- `State`: thêm `resetSteps()`, `session.error:{code,message}|null`, status `'read_done'`.
- `Events`: thêm `startAnalysis(bundle?)`.
- `NS.VERSION = '0.2.0-phase1'`.
- Cập nhật mục “Chưa tồn tại”: còn thiếu DetectEngine, Hash, Manifest, Report, Export và mọi module dump/phân tích khác.
- DOM mới: #phase-note, #error-banner, #bundle-picker (#bundle-select), #app-detail, #progress.

---
# Bổ sung Phase 2 (Account 02)

## NS.DetectEngine (js/modules/detect_engine.js)
Dùng chung luồng chính + worker (bọc `root`). Phụ thuộc call-time vào `NS.IpaReader.readEntry` (chỉ trong `runProbes`).
```
DetectEngine.detect(ipaResult, probes?) -> EngineResult        // ĐỒNG BỘ, không I/O
DetectEngine.planProbes(ipaResult)      -> [{kind, path}]      // path tương đối với appRoot
DetectEngine.runProbes(file, ipaResult, zipEntries, hooks?:{isCancelled?}) -> Promise<Probe[]>
   // zipEntries = entries GỐC của IpaReader.openZip (cần offset) – KHÔNG phải ipaResult.entries
Probe = { kind:'unityfs'|'il2cpp_metadata'|'gdpc'|'rn_bundle'|'gm_data', path, matched:false|true|'hermes'|'metro'|'gen8'|'form', info:object|null, error?:string }
   info: unityfs{signature,formatVersion,minPlayerVersion,unityRevision?}, il2cpp_metadata{metadataVersion}, gdpc{packFormat,version?}, rn_bundle{hermesBytecodeVersion?}
DetectEngine.toReportFields(engineResult) -> { engine, engine_variant, engine_confidence, engine_status }   // phần engine của report.json
DetectEngine.TIER = {strong:0.75, medium:0.45, weak:0.12}; MIN_CONFIDENCE = 0.2; ENGINE_NAMES:string[]

EngineResult (= nội dung engine.json) = {
  engine: 'Unity'|'Unreal Engine'|'Cocos2d-x / Cocos Creator'|'Godot'|'GameMaker'|'Defold'|'Flutter'|'React Native'|'Solar2D / Corona'|"Ren'Py"|'RPG Maker MV/MZ'|'Native iOS'|'Unknown',
  variant: 'IL2CPP'|'Mono'|'Creator'|'Hermes'|'MV'|'MZ'|null,
  confidence: 0..1, status: 'confirmed'|'probable'|'possible'|'unknown',
  evidence: [{indicator, path, weight, tier:'strong'|'medium'|'weak', id}],
  missing_indicators: string[], version: string|null, version_source: string|null,
  analysis_branch: 'unity_il2cpp'|'unity_mono'|'unity_unresolved'|'unreal'|'cocos'|'godot'|'gamemaker'|'defold'|'flutter'|'react_native'|'solar2d'|'renpy'|'rpgmaker'|'native_ios'|'generic',
  notes: string[], alternatives: [{engine, confidence, status}]
}
```
Quy tắc đã cài: confidence = noisy-or các weight; `confirmed` cần ≥1 strong, ≥2 bằng chứng, confidence ≥ 0.85; `probable` = ≥1 strong hoặc ≥2 medium (trần 0.8); `possible` trần 0.45; confidence < 0.2 → Unknown. Native iOS không bao giờ confirmed (trần 0.6). `analysis_branch` chỉ là nhánh engine khi status là confirmed/probable; possible/unknown → `generic`. `version` chỉ lấy từ dữ liệu thật (UnityFS header, GDPC header), không đoán. Dấu hiệu cùng nguồn khai báo `skipIf` để không đếm hai lần.

## Thay đổi ở module cũ
- `IpaReader.analyze` → IpaResult có thêm `engine: EngineResult|null` và `engineProbes: Probe[]`; gọi `step('engine', ...)` sau bước plist. Lỗi detect chỉ thành warning + step engine `error`, không làm hỏng kết quả Phase 1.
- `Events.applyResult`: `session.engine = {engine, variant, confidence, status, analysis_branch, version}`; `session.results.engine = EngineResult` (engine.json); `session.results.reportEngine = toReportFields(...)`.
- `UI`: view `engine` không còn là view trống; thêm `renderEngine(session)` (nội bộ); stat dashboard “Engine phát hiện” = tên + biến thể + status.
- `NS.VERSION = '0.3.0-phase2'`. Worker `importScripts` thêm `../modules/detect_engine.js` (trước ipa_reader.js). `index.html` thêm `<script src="js/modules/detect_engine.js">` sau binary_reader.js; thêm `#view-engine`, `#engine-empty`, `#engine-detail`.

## Chưa tồn tại (đừng gọi)
Hash, Manifest, Report, Export và mọi module quét/dump/phân tích khác (Phase 3+).

---
# Bổ sung Phase 3 (Account 02)

## Module mới (đều bọc `root`, chạy được ở Worker và luồng chính)
```
NS.Hash.create('sha1'|'sha256'|'crc32') -> { update(Uint8Array), hex(), value?() }     // băm tăng dần, đã đối chiếu crypto của Node
NS.MagicBytes.identify(head:Uint8Array, name:string, relPath?:string) -> { type, format, source:'magic'|'content'|'extension'|'none', magic:'HEX HEX…', extMismatch:boolean, note:string, priority:boolean }
   type ∈ Text|Font|Image|Audio|Video|Archive|Binary|Executable|Database|Unity asset|Unreal asset|Localization|Unknown
NS.MagicBytes.extOf(name), .hexOf(bytes,n), .PRIORITY_EXT:Set, .TYPES:string[]
NS.ArchiveScanner.describe(head, format, size) -> { status:'recognized_not_unpacked'|'encrypted'|'unsupported', info:object, note }   // CHỈ đọc header, KHÔNG giải nén
NS.ArchiveScanner.isArchiveLike(det) -> boolean
NS.FileScanner.scan(file, ipaResult, zipEntries, {hashMode:'auto'|'fast'|'standard'}, hooks:{step?,log?,isCancelled?}) -> Promise<Manifest>
NS.FileScanner.toCsv(manifest) -> string (BOM UTF-8, CRLF, chống formula injection bằng dấu ' đầu ô nếu bắt đầu bằng = + - @ tab CR)
NS.FileScanner.COLUMNS, HEAD_BYTES=4096, SHA256_MAX_BYTES=64MiB, resolveMode(mode, ipaSize)
NS.DetectEngine.makeRelatedFn(engineResult) -> (relPath)=>true|false|null   // null khi engine chưa confirmed/probable hoặc Native
NS.IpaReader.streamEntry(file, entry, onChunk(Uint8Array), {isCancelled?}) -> Promise<{bytes}>   // đọc luồng, kiểm tra size khai báo; entry = ENTRY GỐC của openZip
```
Manifest = { columns:string[], rows:Row[], summary, options:{hashMode,requested,headBytes,sha256MaxBytes}, generatedAt:ISO }
Row (cột manifest.csv, theo thứ tự): relative_path (tương đối .app; ngoài Payload thì đường dẫn đầy đủ), file_name, extension, file_size, compressed_size, sha1, sha256, magic_bytes, detected_type, detected_format, type_source, ext_mismatch, engine_related ('yes'|'no'|'unknown'), priority, area, extraction_status, archive_status, archive_info (JSON), error.
extraction_status ∈ ok | head_only (chế độ fast) | crc_mismatch | read_error | unsafe_path | symlink_not_followed | encrypted_zip | unsupported_method.
summary = { totalFiles, totalBytes, byType{}, byStatus{}, byArea{}, hashed, sha256Hashed, priorityFiles, mismatches, archives, errors }.
Chế độ: `standard` = đọc đầy đủ, SHA-1 mọi file, SHA-256 chỉ file ≤ 64 MiB, kiểm CRC32 với ZIP; `fast` = chỉ đọc 4 KB đầu để phân loại, KHÔNG băm; `auto` = standard nếu IPA ≤ 512 MiB, ngược lại fast.

## Thay đổi ở module cũ
- `IpaReader.analyze(file, opts{bundle?,hashMode?}, hooks)`: sau bước engine có bước `scan`; IpaResult có thêm `manifest: Manifest|null`. Lỗi quét chỉ thành warning + step scan `error`.
- Worker importScripts: plist_parser, binary_reader, hash, magic_bytes, archive_scanner, detect_engine, file_scanner, ipa_reader. `index.html` nạp cùng thứ tự (trước ipa_reader).
- `Events.applyResult`: `session.manifest = {summary, options, generatedAt}`; `session.results.manifest = Manifest` (đủ hàng); `stats.totalFiles` = số file đã quét. `startAnalysis` đọc `#hash-mode`.
- UI: view `explorer` thật (tóm tắt, lọc loại/tìm đường dẫn/chỉ file ưu tiên, phân trang 100 hàng, nút `#btn-manifest` tải manifest.csv). `index.html` thêm `#hash-mode`, `#view-explorer`.

## Chưa tồn tại (đừng gọi)
Giải nén archive lồng nhau, phân tích metadata IL2CPP (Phase 4), font (5), chuỗi/localization (6), runtime import (7), template (8), Packager/Report/Export (9), engine khác (10).

---
# Nâng cấp Phase 3 (Account 02, đợt 2)
- `Row` có thêm cột **`duplicate_of`** (đứng sau `sha256`): đường dẫn bản đầu tiên có cùng SHA-1 + kích thước; '' nếu không trùng. Chỉ có ở chế độ `standard` (fast không băm nên không biết). File rỗng không bao giờ được tính là trùng.
- `summary` có thêm `suspiciousRatio` (số file ≥100 MB có tỉ lệ nén >200:1, vẫn đọc có giới hạn theo size khai báo, ghi chú vào cột `error`) và `duplicates:{groups, extraCopies, wastedBytes, top:[{sha1,size,count,paths[≤3]}]}` (top 10 theo dung lượng lãng phí).
- `options` có thêm `concurrency`. `FileScanner.scan`: file ≤ 4 MiB (và mọi file ở chế độ fast) chạy song song 8 luồng, file lớn hơn tuần tự; hàng trong `rows` luôn đúng thứ tự gốc, summary tính sau khi xong nên không phụ thuộc thứ tự hoàn thành.
- `Hash`: API không đổi; SHA-1/SHA-256 đọc byte trực tiếp, CRC32 slicing-by-4 (đo trong Node: SHA-1 156→206, SHA-256 96→139, CRC32 204→512 MB/s; đã đối chiếu lại `crypto`).
- UI Explorer: chế độ **Xem theo thư mục** (breadcrumb, thư mục tổng hợp số file/dung lượng, “..”) hoặc **Danh sách phẳng**; bật bộ lọc/tìm kiếm thì tự chuyển sang danh sách phẳng; sắp xếp theo đường dẫn/kích thước/loại; bấm một file để xem toàn bộ cột (`#ex-detail`); thẻ tóm tắt hiển thị file trùng. Ids mới: `#ex-mode`, `#ex-sort`, `#ex-crumb`, `#ex-detail`.

---
# Bổ sung Phase 4 – SUB-PHASE 4.1 Unity Component Discovery (Account 03)

## NS.UnityDump (js/modules/unity_dump.js) – Worker + luồng chính, thuần dữ liệu, KHÔNG I/O
```
UnityDump.discover(ipaResult) -> UnityInfo        // ĐỒNG BỘ; ném Error nếu thiếu ipaResult; không sửa đầu vào; kết quả JSON/structuredClone được
UnityDump.toReportFields(unityInfo) -> { unity_status, unity_runtime, unity_version, unity_metadata_input, unity_metadata_path } | null   // phần Unity của report.json (Phase 9 gộp)
UnityDump.COMPONENTS (bảng định nghĩa), SCHEMA = 'unity_info/1', SAMPLE_MAX = 25, IL2CPP_MAGIC = 'AF 1B B1 FA', STD_METADATA_PATH = 'data/managed/metadata/global-metadata.dat'
```
Đầu vào cần từ IpaResult: `appRoot`, `engine`, `engineProbes`, `manifest.rows` (Phase 3; nếu `manifest` null thì tự dựng hàng tối thiểu từ `entries`), `macho`. Chỉ xét file TRONG `.app` (hàng có `area !== 'ngoài Payload'`).
```
UnityInfo (= Meta/unity_info.json) = {
  schema:'unity_info/1', sub_phase:'4.1',
  status:'discovered'|'insufficient_evidence'|'not_unity', applicable:boolean,
     // applicable = (engine Unity & status confirmed/probable) HOẶC có ≥1 thành phần mạnh. insufficient_evidence = chỉ có dấu hiệu yếu (*.assets/*.bundle…)
  source:{ kind:'manifest'|'entries', rows:number, scanned:boolean, hash_mode:'standard'|'fast'|null },
  engine: null | { engine, variant, status, confidence, analysis_branch },               // sao từ Phase 2
  unity_version: null | { value, source },                                                // chỉ từ EngineResult.version (header UnityFS)
  runtime:{ value:'IL2CPP'|'Mono'|'conflict'|'unresolved'|'not_applicable',
            evidence:[{component,label,files,example}], engine_variant, agrees_with_engine:true|false|null },
  components: Component[], components_found:number, components_total:number,
  metadata_input: MetadataInput, main_binary: null | { path, size, archs:string[], encrypted:true|false|null },
  notes:string[], warnings:string[]
}
Component = { id, label, kind:'framework'|'library'|'metadata'|'directory'|'assembly'|'asset', strong:boolean, runtime:'il2cpp'|'mono'|null,
              found:boolean, files:number, bytes:number, samples:[{path,size,detected_type,detected_format,extraction_status}] (≤25), truncated:boolean, note }
   id ∈ unity_framework, libil2cpp, global_metadata, metadata_dir, mono_assemblies, libmono, data_resources, streaming_assets, data_raw, data_unity3d,
        globalgamemanagers, sharedassets, levels, assets, resource, ress, bundle, unityfs_by_magic            (18 nhóm)
   Nhóm theo tên file (globalgamemanagers…bundle) loại trừ lẫn nhau theo thứ tự trên; các nhóm còn lại có thể chồng lấn. unityfs_by_magic dựa trên detected_format của Phase 3.
MetadataInput = {
  status:'selected'|'missing'|'ambiguous'|'unreadable'|'not_il2cpp'|'not_applicable',
  path:string|null,          // tương đối với .app
  entry_path:string|null,    // đường dẫn ĐẦY ĐỦ trong ZIP (dùng cho IpaReader.openZip entries + readEntry/streamEntry ở 4.2)
  reason:string,
  candidates:[{ path, entry_path, size, sha1, by_name, by_magic, magic_bytes, magic_matches:true|false|null, phase2_probe_version:number|null,
                standard_location, extraction_status, error }]
}
```
Quy tắc: ứng viên = tên `global-metadata.dat` HOẶC magic `AF 1B B1 FA` (không phân biệt hoa/thường ở đường dẫn). `selected` khi có đúng một ứng viên đọc được, hoặc đúng một ứng viên ở `Data/Managed/Metadata/` có magic không sai. `magic_matches:false` vẫn có thể `selected` (theo tên) nhưng `reason` cảnh báo; `null` = chưa có magic (không đọc được đầu file). Runtime `Mono` → `not_il2cpp`. Ứng viên bị `unsafe_path/encrypted_zip/unsupported_method/read_error` không được chọn. `phase2_probe_version` chỉ là số đọc nhanh của Phase 2, KHÔNG phải kiểm tra hợp lệ (việc của 4.2).

## Thay đổi ở module cũ
- `State.PIPELINE_STEPS`: thêm `{ id:'unity', label:'Unity IL2CPP (thành phần)' }` giữa `scan` và `extract` (id cũ giữ nguyên).
- `IpaReader.analyze`: sau `scan` có bước `unity` (`step('unity', 'done'|'skipped'|'error', …)`); `IpaResult.unity: UnityInfo|null`. Lỗi chỉ thành warning.
- `Events.applyResult`: `session.results.unity = r.unity`. Nút `#btn-unity-json` tải `unity_info.json`.
- `UI`: view `metadata` (nhãn “Unity / Metadata”) không còn là view trống: `renderUnity(session)` nội bộ, cache theo tham chiếu `results.unity`. DOM mới: `#view-metadata`, `#unity-empty`, `#unity-detail`, `#unity-body`, `#btn-unity-json`.
- Worker `importScripts` thêm `../modules/unity_dump.js` (trước `ipa_reader.js`); `index.html` nạp `js/modules/unity_dump.js` sau `file_scanner.js`.
- `NS.VERSION = '0.5.0-phase4.1'`.

## Chưa tồn tại (đừng gọi)
Kiểm tra header/phiên bản global-metadata.dat (4.2), trích xuất string literal/namespace/class/method/field và `Meta/metadata_summary.json`, `Text/unity_string_literals.json` (4.3), `il2cpp_api.js`, font (5), text/localization (6), runtime import (7), template (8), Packager/Report/Export (9), engine khác (10).


---
# Bổ sung Phase 4 – SUB-PHASE 4.2 Metadata Header and Version (Account 04)

## NS.MetadataDump (js/modules/metadata_dump.js) – Worker + luồng chính
```
MetadataDump.inspectHeader(bytes:Uint8Array, fileSize:number) -> HeaderResult   // THUẦN, đồng bộ, không ném lỗi với dữ liệu xấu
MetadataDump.check(file, unityInfo, entries, {isCancelled?}) -> Promise<HeaderResult>   // entries = ENTRY GỐC của IpaReader.openZip; đọc ≤ READ_LIMIT byte đầu qua IpaReader.readEntry({head:true}); chỉ ném CANCELLED
MetadataDump.notChecked(reason) -> HeaderResult (status 'not_checked', applicable:false)
MetadataDump.toReportFields(h) -> { metadata_header_status, metadata_version, metadata_header_generic_checked } | null
MetadataDump.toSummary(h) -> { schema:'metadata_summary/1', sub_phase:'4.2', partial:true, note, header:h } | null   // phần header của Meta/metadata_summary.json; 4.3 bổ sung phần còn lại
MetadataDump.SCHEMA='metadata_header/1', READ_LIMIT=4096, MAGIC_HEX='AF 1B B1 FA', KNOWN_VERSIONS[17 số], VERSION_RANGE=[16,200], SOURCES[]
```
```
HeaderResult (= results.unity.metadata_header) = {
  schema:'metadata_header/1', sub_phase:'4.2',
  status:'generic_ok'|'header_unverified'|'unsupported_version'|'invalid_header'|'bad_magic'|'read_error'|'not_checked',
  applicable:boolean, path, entry_path, file_size:number|null, bytes_read:number, read_limit:4096,
  magic:null|{hex, expected, matches}, version:null|{value, in_reference_list, reference_range, known_versions},
  header:null|{first_table_offset, header_size, pair_count, pairs:[{index,offset,size}], empty_tables, max_table_end, trailing_bytes, overlaps},
  layout:{field_names_verified:false, field_parse_supported:false, note}, reference_sources:string[],
  findings:[{level:'error'|'warning'|'info', code, message}], reason:string, notes:string[], raw_header_hex:string(64 byte)
}
```
Ý nghĩa trạng thái: `generic_ok` = magic đúng + version thuộc danh sách đã biết + các cặp offset/size nằm trong file (CHỈ kiểm tra chung, KHÔNG nghĩa là đã xác minh tên/ý nghĩa trường hay đọc được bảng). `header_unverified` = magic+version ổn nhưng giả định chung không áp dụng được (int32 byte 8 không dùng được làm kích thước header) → không kết luận hỏng. `unsupported_version` = version ngoài dải/không có trong danh sách → chỉ header thô, `header:null`. `invalid_header` = file quá ngắn, version vô lý (<0 hoặc >1000), hoặc cặp âm/vượt file/nằm trong header. `bad_magic` = magic ≠ AF 1B B1 FA (CÓ THỂ mã hóa/obfuscate; không khẳng định). `not_checked` = 4.1 không chọn được file metadata. Chồng chéo chỉ là cảnh báo (`overlap`), không đổi status.
**Giả định kiểm tra chung** (ghi trong metadata_dump.js): header = dãy cặp int32 (offset, size|count) từ byte 8 đến offset của bảng đầu tiên (int32 ở byte 8; HEADER_MIN 16 … HEADER_MAX 1024). Chỉ có bằng chứng trực tiếp cho v24.2 (stringLiteralOffset=264). Nguồn đã đối chiếu trong phiên: Perfare/Il2CppDumper `Metadata.cs` (magic 0xFAB11BAF, version int32 kế tiếp, nhận 16..31, nhánh 24.x) và il2cpp_dumper 0.5.5 `metadata.rs` (nhận 16..200, danh sách version 16,17,19,20,21,22,24,27,29,31,33,35,38,39,104,105,106). **Bố cục TỪNG TRƯỜNG theo từng version KHÔNG được xác minh** → không gán tên trường.

## Thay đổi ở module cũ
- `UnityInfo`: `schema:'unity_info/2'`, `sub_phase:'4.2'`, thêm `metadata_header: HeaderResult|null` (`discover` đặt null; `IpaReader.analyze` điền). Phần còn lại không đổi.
- `State.PIPELINE_STEPS`: thêm `{id:'metadata', label:'Metadata IL2CPP (header, phiên bản)'}` giữa `unity` và `extract`.
- `IpaReader.analyze`: bước 6 `metadata` sau `unity` (`skipped` nếu không Unity hoặc 4.1 chưa chọn file; `done`; `error` chỉ khi read_error/ngoại lệ). Lỗi chỉ thành warning.
- Worker importScripts thêm `../modules/metadata_dump.js` (sau unity_dump.js; trước ipa_reader.js); `index.html` nạp cùng thứ tự.
- UI: `buildMetaHeaderCard` (nội bộ ui.js) hiển thị thẻ “Header metadata (sub-phase 4.2)” trong view Unity/Metadata; nút `#btn-metaheader-json` tải `metadata_summary.json` (phần header). `NS.VERSION='0.6.0-phase4.2'`.

## Chưa tồn tại (đừng gọi)
Đọc bảng metadata, string literal/namespace/class/method/field, `Meta/dump.cs`, `Text/unity_string_literals.json` (4.3), `il2cpp_api.js`, font (5), text/localization (6)…


---
# Bổ sung Phase 4 – SUB-PHASE 4.3 String Literal Extraction (Account 04)

## API mới trong NS.MetadataDump (js/modules/metadata_dump.js)
```
MetadataDump.extractLiterals(file, unityInfo, entries, {isCancelled?, progress?(0..1)}) -> Promise<LiteralResult>   // chỉ ném CANCELLED; dùng IpaReader.streamEntry (luồng, không nạp cả file; chỉ giữ 2 vùng bảng+dữ liệu)
MetadataDump.decodeLiterals(table:Uint8Array, data:Uint8Array) -> {literals, empty, invalid_utf8, out_of_range, distinct, total_text_bytes}   // THUẦN
MetadataDump.toReportFields(h, lit?, tables?)  // string_literals_*; metadata_not_supported[5] khi tables chưa ok, [] khi ok + trường metadata_* của MetadataTables.toReportFields
MetadataDump.toSummary(h, lit?, tables?) -> { schema:'metadata_summary/3' (Account 05; trước là /2), sub_phase:'4.3', partial:!(tables ok), tables:{status,reason,version,layout,counts,struct_sizes,problem_counts,name_problems,not_extracted,reference_sources,notes}|null, header, string_literals:{status,reason,version,count,empty,distinct,invalid_utf8,out_of_range,total_text_bytes,source}|null, not_supported:{assemblies,namespaces,classes,methods,fields:{status:'not_supported',reason}} }
MetadataDump.LITERAL_VERSIONS=[16,17,19,20,21,22,24,27,29,31], LITERAL_SCHEMA='unity_string_literals/1', NOT_SUPPORTED[5]
```
```
LiteralResult (= results.unity.metadata_literals = Text/unity_string_literals.json) = {
  schema:'unity_string_literals/1', sub_phase:'4.3',
  status:'ok'|'not_eligible'|'unsupported_version'|'invalid_table'|'too_large'|'read_error', reason, version, path, entry_path,
  source:null|{table:{offset,size}, data:{offset,size}, struct_size:8}, count, empty, invalid_utf8, out_of_range, distinct, total_text_bytes,
  literals:[{index, text:string|null, length, data_index, flags:('empty'|'invalid_utf8'|'out_of_range')[]}],   // KHÔNG gộp trùng; text=null khi ngoài vùng
  limits:{max_table_bytes:64MiB, max_data_bytes:256MiB}, reference_sources[], notes[]
}
```
**Cơ sở (đã đối chiếu 2 nguồn công khai):** bảng literal = cặp header #0 (offset, size BYTE), mỗi phần tử 8 B `{u32 length, u32 dataIndex}`; dữ liệu = cặp #1, chuỗi = UTF-8 tại `dataOffset + dataIndex`, `length` byte (Il2CppDumper `Metadata.cs`; il2cpp_dumper `structures.rs` – tóm tắt: length chỉ có trước v35). Chỉ hỗ trợ version có trong CẢ HAI nguồn (LITERAL_VERSIONS). v33/35/38+… → `unsupported_version`. Nếu >50% literal (≥8 mục) trỏ ngoài vùng dữ liệu → `invalid_table`, không xuất literal (bố cục thực tế có thể khác hoặc dữ liệu bị mã hóa).
**(Account 05)** assembly/image/class/method/field + `dump.cs` đã được làm ở module riêng `NS.MetadataTables` (mục bên dưới).

## Thay đổi ở module cũ
- `UnityInfo`: `schema:'unity_info/3'`, `sub_phase:'4.3'`, thêm `metadata_literals: LiteralResult|null`.
- `State.PIPELINE_STEPS`: thêm `{id:'literals', label:'Metadata IL2CPP (string literal)'}` sau `metadata`.
- `IpaReader.analyze`: bước 7 `literals` (skipped nếu header ≠ generic_ok hoặc version chưa hỗ trợ; done khi ok; error khi lỗi). Lỗi chỉ thành warning.
- UI: `buildLiteralsCard` (tìm kiếm, phân trang 100 dòng); nút `#btn-literals-json` tải `unity_string_literals.json`; `#btn-metaheader-json` giờ truyền cả literal vào `toSummary`. `NS.VERSION='0.7.0-phase4.3'`.


---
# Bổ sung Phase 4 – SUB-PHASE 4.3 (phần còn lại): Assembly / Image / Type / Method / Field + dump.cs (Account 05)

## NS.MetadataTables (js/modules/metadata_tables.js) – Worker + luồng chính. Nạp SAU metadata_dump.js, TRƯỚC ipa_reader.js (index.html + worker importScripts đã cập nhật)
```
MetadataTables.extractTables(file, unityInfo, entries, {isCancelled?, progress?(0..1)}) -> Promise<TablesResult>   // chỉ ném CANCELLED. Đọc 4096 B đầu (header) rồi 1 lượt streamEntry, chỉ giữ 8 vùng cần thiết
MetadataTables.parseHeader(bytes:Uint8Array) -> {ok, error?, version, layout_version, header:{tên trường C#: số}, header_size}   // THUẦN; v24: 272 B, hoặc 264 B (24.2) khi stringLiteralOffset==264
MetadataTables.planRegions(header, headerSize, fileSize) -> {ok, regions:[{key,offset,size}], total_tables, errors[], too_large?}   // THUẦN, kiểm tra vùng trong file/không đè header/giới hạn bộ nhớ
MetadataTables.decodeTables(hdrInfo, buffers:{strings,images,assemblies,typedefs,methods,parameters,fields,nested}) -> TablesResult   // THUẦN, không ném lỗi
MetadataTables.layoutOf(structName, V) -> {size, fields:[{name,kind,off}]}   // structName ∈ header|aname|assembly|image|typedef|method|parameter|field; V có thể 24.1/24.2/24.4
MetadataTables.toDumpCs(tablesResult) -> string|null   // null nếu status != 'ok'
MetadataTables.toReportFields(tablesResult) -> {metadata_tables_status, metadata_assemblies, metadata_images, metadata_namespaces, metadata_types, metadata_methods, metadata_fields, metadata_table_problems}|null
MetadataTables.TABLE_VERSIONS=[16,17,19,20,21,22,24,27,29,31], LIMITS, SOURCES, STRUCTS, CS_CLASS, NOT_EXTRACTED, SCHEMA='metadata_tables/1'
```
```
TablesResult (= results.unity.metadata_tables = Meta/metadata_tables.json) = {
  schema:'metadata_tables/1', sub_phase:'4.3',
  status:'ok'|'not_eligible'|'unsupported_version'|'layout_mismatch'|'invalid_table'|'too_large'|'read_error', reason, version, path, entry_path,
  layout:{version_field, detected, assembly_layout}|null,      // v24: detected ∈ 24|24.1|24.2|24.4 (24.2≡24.3, 24.4≡24.5 cùng bố cục)
  counts:{assemblies,images,types,methods,fields,parameters,namespaces}|null, struct_sizes:{image,assembly,typedef,method,parameter,field}|null,
  assemblies:[{index,name,culture,image_index,token|null,version:'a.b.c.d',flags,hash_alg,public_key_token(hex),referenced_assembly_start|null,referenced_assembly_count|null}],
  images:[{index,name,assembly_index,type_start,type_count,entry_point_index,token|null,exported_type_start?,exported_type_count?}],
  types:[{index,image_index(-1 nếu không thuộc image),namespace,name,full_name('Ns.Outer/Inner'),kind:'class'|'struct'|'enum'|'interface',visibility,is_abstract,is_sealed,flags,token|null,
          field_start,field_count,method_start,method_count,nested_types_start,nested_type_count,nested_in:number|null,parent_type_raw_index,declaring_type_raw_index}],
  methods:[{index,type_index(-1 nếu không thuộc type),name,flags,iflags,access,is_static,is_virtual,is_abstract,slot,token,parameter_count,parameter_start,return_type_raw_index,parameters:[{name,type_raw_index}]}],
  fields:[{index,type_index,name,token|null,type_raw_index}],
  problems:[{code,message}] (≤200), problem_counts:{code:n}, name_problems:{name_out_of_range,invalid_utf8,unterminated},
  limits:{max_strings_bytes:128MiB,max_tables_bytes:192MiB,max_rows:1.5M,max_name_scan:65536}, not_extracted[9], reference_sources[], notes[]
}
```
**Nguồn bố cục (đọc ĐẦY ĐỦ qua git clone):** Perfare/Il2CppDumper commit `4741d46ba9cd6159c5d853eb9d6fc48b4bfa2b1a` – `MetadataClass.cs`, `Metadata.cs`, `Outputs/Il2CppConstants.cs`, `Outputs/Il2CppDecompiler.cs`. `STRUCTS` trong JS là bản chép tay; `tests/derive_schema_from_cs.py` dẫn xuất lại từ chính file C# → `tests/fixtures/il2cpp_struct_schema.json`; test đối chiếu 15 version × 8 struct.
**Quy ước:** tên = chuỗi null-terminated UTF-8 tại `stringOffset + nameIndex`; `*_raw_index` là chỉ số vào bảng `Il2CppType` của BINARY (không có trong metadata) → KHÔNG suy tên kiểu. Trường chỉ có từ version nào đó (token…) = `null` khi version thấp hơn (không bịa). Dòng/chỉ số trỏ ngoài bảng → `problems` + `-1`/`null`, không crash; > 50% type bất thường → `invalid_table`, không xuất dữ liệu.
**Khác tham chiếu có chủ đích:** nhận diện v24.2/24.4 và 24.1/“24.1+” bằng kích thước bảng assembly KHỚP CHÍNH XÁC (68×N / 64×N), không dùng chia nguyên (tham chiếu nhầm 24.1 khi N<16); không khớp → `layout_mismatch`.
**dump.cs:** chỉ từ metadata: `// Image i: tên - typeStart`, `// Namespace:`, `[visibility] [static|abstract|sealed] class|struct|enum|interface Tên // TypeDefIndex: n`, `/* type#N */ field; // FieldIndex`, method `[access] [static] [abstract|virtual] /* type#ret */ Tên(/* type#N */ tham_số); // MethodIndex, Token, Slot`. Không RVA/offset (không đọc binary), không cờ truy cập field, không attribute.

## Thay đổi ở module cũ (Account 05)
- `UnityInfo`: thêm `metadata_tables: TablesResult|null` (schema vẫn `unity_info/3`, thêm trường – cộng thêm, không phá).
- `State.PIPELINE_STEPS`: thêm `{id:'tables', label:'Metadata IL2CPP (assembly/class/method/field)'}` sau `literals`.
- `IpaReader.analyze`: bước 8 `tables` (skipped nếu header ≠ generic_ok hoặc version chưa hỗ trợ; done khi ok; error khi lỗi; lỗi chỉ thành warning; hủy → CANCELLED).
- `MetadataDump.toSummary/toReportFields`: thêm tham số `tables?` (xem trên). `toSummary` giờ trả `metadata_summary/3`.
- UI: `buildTablesCard` + `buildPagedTable` (chọn Assembly/Image/Type/Method/Field, tìm kiếm, phân trang 100 dòng); nút `#btn-dumpcs` (tải dump.cs, sinh khi bấm từ `toDumpCs`) và `#btn-metatables-json` (tải metadata_tables.json). `NS.VERSION='0.8.0-phase4.3'`.
- Tests: `run_literal_tests.js` và `run_metadata_tests.js` nạp thêm `modules/metadata_tables`; `run_literal_tests.js` đổi 1 dòng schema `/2`→`/3`.

## Chưa tồn tại (đừng gọi)
- Đóng gói `Meta/dump.cs`, `Meta/metadata_tables.json` vào ZIP (Phase 9). Đọc binary UnityFramework (Il2CppType, RVA, tên kiểu) – chưa có và NGOÀI phạm vi 4.3.
