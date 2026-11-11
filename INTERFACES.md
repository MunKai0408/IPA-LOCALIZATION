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
MetadataDump.LITERAL_VERSIONS=[16,17,19,20,21,22,23,24,27,29,31], LITERAL_SCHEMA='unity_string_literals/1', NOT_SUPPORTED[5]
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
MetadataTables.TABLE_VERSIONS=[16,17,19,20,21,22,23,24,27,29,31], LIMITS, SOURCES, STRUCTS, CS_CLASS, NOT_EXTRACTED, SCHEMA='metadata_tables/1'
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


---
# Bổ sung Phase 5 – SUB-PHASE 5.1 Font Discovery and Extraction (Account 05)

## NS.FontDump (js/modules/font_dump.js) – Worker + luồng chính. Nạp SAU metadata_tables.js, TRƯỚC ipa_reader.js (index.html + worker importScripts đã cập nhật)
```
FontDump.discover(file, ipaResult, entries, {isCancelled?, progress?(0..1)}) -> Promise<{fonts:FontsResult, files:{[extractedPath:string]:Uint8Array}}>   // chỉ ném CANCELLED. ipaResult cần: appRoot, manifest?, app.appFonts. entries = ENTRY GỐC của openZip
FontDump.classifyBytes(bytes:Uint8Array, ext:string) -> {kind:'sfnt'|'woff'|'woff2'|'bmfont'|'atlas'|'not_font', format, valid:true|false|null, problems[], num_fonts?, num_tables?}   // THUẦN, theo BYTE
FontDump.selectCandidates(entries, manifest|null, rootPath) -> {candidates:[{entry,rel,row,ext,selected_by:'ext'|'magic'|'ext+magic'}], unity_containers:[{path,size,detected_format}], manifest_used}   // THUẦN
FontDump.safeOutPath(rel) -> 'Fonts/original/<rel>'|null   // null nếu có '..', '.', rỗng, ổ đĩa, NUL
FontDump.toFontIndex(fonts) -> object (= Fonts/font_index.json, schema 'font_index/1', KHÔNG có byte)
FontDump.toFontsJson(fonts) -> object (= Fonts/fonts.json, schema 'fonts/1': chỉ mục đã trích xuất; family/subfamily/postscript_name/version/glyph_count = null, analysis_status='not_analyzed' – 5.2 điền)
FontDump.toReportFields(fonts) -> {fonts_status, font_candidates, font_files_extracted, font_files_valid, font_files_invalid_or_unverified, font_files_skipped, font_read_errors, font_app_fonts_missing, font_unity_containers_unparsed}|null
FontDump.FONT_EXTS=['ttf','otf','ttc','woff','woff2','fnt','bmfont','atlas'], LIMITS={max_file_bytes:64MiB,max_total_bytes:256MiB,max_files:2000,max_listed_unparsed:200} (đối tượng dùng chung; test có thể chỉnh), NOT_DONE[4]
```
```
FontsResult (= results.fonts) = { schema:'fonts_discovery/1', sub_phase:'5.1', status:'ok'|'partial'|'no_fonts'|'error'|'not_run', reason,
  items:[{id, path(tương đối .app), zip_path, file_name, extension, size, selected_by, kind, format, valid, is_font(valid===true), problems[], 
          extraction_status:'extracted'|'not_font_content'|'skipped_too_large'|'skipped_budget'|'read_error'|'unsafe_path'|'symlink_not_followed'|'encrypted_zip'|'unsupported_method'|'pending',
          extracted_path:'Fonts/original/<path>'|null, sha256 (tự tính trên byte đã đọc)|null, manifest_sha256|null, hash_match:true|false|null, duplicate_of:path|null, ext_mismatch, declared_in_plist, num_fonts?, num_tables?, error, analysis_status:'not_analyzed'}],
  summary:{candidates, extracted, fonts_valid, invalid_or_unverified, not_font_content, skipped, read_errors, unsafe_or_unreadable, duplicates, ext_mismatch, hash_mismatch, total_bytes, by_format{}, app_fonts_declared, app_fonts_missing, unity_containers_unparsed}|null,
  app_fonts_check:[{declared, status:'found'|'missing', paths[]}], not_analyzed:{unity_containers:{count, listed[≤200], note}}, limits, limitations[], warnings[], source:{manifest_used} }
```
**Ngữ nghĩa:** ứng viên = đuôi font HOẶC manifest nhận `Font` theo magic. Phân loại cuối theo BYTE đã đọc (không tin đuôi). `.ttf` không phải font → `not_font_content`, KHÔNG trích xuất. Font nhận ra nhưng cấu trúc sai/cắt cụt → vẫn trích xuất nguyên bản, `valid=false`, `is_font=false`, `problems` nêu lý do. `.atlas` → `valid=null` (không xác minh được là atlas font), không tính là font. Kiểm cấu trúc chỉ ở mức header: sfnt (numTables 1..512, thư mục bảng và từng bảng nằm trong file; TTC kiểm tới 64 font), WOFF/WOFF2 (`length` == kích thước file), BMFont text/XML/binary v3. KHÔNG đọc name/cmap/glyph (5.2/5.3). File asset/bundle Unity (`*.assets|bundle|unity3d|resS|resource` hoặc magic Unity asset) chỉ được LIỆT KÊ là “có thể chứa font, chưa parse”.
**Byte** nằm ở `results.fontFiles` (UI) / `IpaResult.font_files` (khóa = `extracted_path`); `FontsResult` là JSON thuần (structuredClone OK). Không đưa byte vào JSON.

## Thay đổi ở module cũ (Account 05, 5.1)
- `IpaReader.analyze`: bước 9 `fonts` (sau `tables`); `IpaResult.fonts`, `IpaResult.font_files`. Lỗi chỉ thành cảnh báo; hủy → CANCELLED. `State.PIPELINE_STEPS`: nhãn `fonts` = 'Font (phát hiện, trích xuất)'.
- `Events.applyResult`: `session.results.fonts/fontFiles`; `stats.fontCount` = `summary.fonts_valid`. Nút `#btn-fontindex-json`, `#btn-fonts-json`.
- UI: view `fonts` thật (`#view-fonts`; bỏ placeholder trong `VIEWS.fonts`): tóm tắt, bảng tìm kiếm/phân trang + nút tải từng font, UIAppFonts, Unity chưa parse, cảnh báo, giới hạn. `buildPagedTable` cho phép ô là Node. `NS.VERSION='0.9.0-phase5.1'`.

## Chưa tồn tại (đừng gọi)
Đóng gói `Fonts/` vào ZIP (Phase 9); `Fonts/vi_coverage.json`, `missing_characters.txt`, `character_coverage.json` (5.3); family/glyph (5.2).


---
# Bổ sung Phase 5 – SUB-PHASE 5.2a UnityFS container parser (Account 06)

## NS.UnityFS (js/modules/unity_fs.js) – Worker + luồng chính. Nạp SAU font_dump.js, TRƯỚC ipa_reader.js (index.html + worker importScripts đã cập nhật)
```
UnityFS.parseHeader(bytes) -> {ok, code?:'TOO_SHORT'|'OLD_FORMAT'|'BAD_MAGIC'|'BAD_HEADER'|'UNKNOWN_VERSION', error?, signature, version, min_player_version, unity_revision, size, compressed_info_size, uncompressed_info_size, flags, compression, combined, info_at_end, padding_flag, unknown_flag_bits, header_end}   // THUẦN; version hỗ trợ 6..8
UnityFS.parseInfo(decompressedBytes) -> {ok, error?, blocks:[{index,uncompressed_size,compressed_size,flags,compression,streamed}], nodes:[{index,path,offset,size,flags,is_serialized(flags&4),unsafe_path}], consumed, hash_hex, problems[]}   // THUẦN
UnityFS.open(bytes, fileSize?) -> Bundle   // THUẦN, đồng bộ, không ném lỗi, KHÔNG giải nén dữ liệu node. bytes = toàn bộ file, hoặc ≥ bytesNeeded byte đầu khi bảng info ở đầu file
UnityFS.bytesNeeded(header, fileSize) -> số byte đầu cần để đọc bảng info
UnityFS.readNode(bytes /*TOÀN BỘ file*/, bundle, nodeIndex, {isCancelled?}) -> Promise<Uint8Array>   // chỉ giải nén các block phủ node; ném FsError{code: NOT_PARSED|NO_NODE|TOO_LARGE|NODE_RANGE|TRUNCATED|CANCELLED|SIZE|UNSUPPORTED_COMPRESSION|LZ4_BAD|LZMA_BAD}
UnityFS.decompress(method, src, dstSize) / lz4Block(src,dstSize) / lzma(src,dstSize)   // method 0 none, 1 LZMA (raw: 5 byte props+dict), 2 LZ4, 3 LZ4HC; 4 LZHAM → ném UNSUPPORTED_COMPRESSION
UnityFS.selectCandidates(entries, manifest|null, rootPath) -> {candidates:[{entry,rel,selected_by:'ext'|'magic'|'ext+magic'}], manifest_used}   // THUẦN
UnityFS.scan(file, ipaResult, entries, {isCancelled?, progress?(0..1)}) -> Promise<UnityFsResult>   // chỉ ném CANCELLED; entries = ENTRY GỐC của openZip
UnityFS.toIndex(res) -> object (= Meta/unityfs_index.json), UnityFS.toReportFields(res) -> {unityfs_status, unityfs_bundles, unityfs_bundles_parsed, unityfs_nodes, unityfs_unity_revisions}|null
UnityFS.LIMITS = {max_bundle_bytes:256MiB, max_info_bytes:64MiB, max_blocks:200000, max_nodes:100000, max_node_bytes:256MiB, max_bundles:500, max_listed_nodes:2000, head_bytes:4096} (đối tượng dùng chung; test chỉnh được), SCHEMA='unityfs_index/1', NOT_DONE[4]
```
```
Bundle (kết quả open) = { schema:'unityfs_bundle/1', status:'parsed'|'not_unityfs'|'unsupported_format'|'unsupported_version'|'unsupported_compression'|'decompress_failed'|'invalid'|'truncated'|'too_large'|'need_more_bytes',
  reason, header, compression:{code,name}|null, blocks[], nodes[], data_start, data_start_exact:true|false|null, total_uncompressed, info_offset, info_hash, problems[], notes[], need? }
UnityFsResult (= results.unityfs) = { schema:'unityfs_index/1', sub_phase:'5.2a', status:'ok'|'partial'|'none_parsed'|'no_bundles'|'error'|'not_run', reason,
  items:[{id, path, zip_path, size, selected_by, status(như Bundle.status | 'read_error'), reason, signature, format_version, min_player_version, unity_revision, flags_hex, compression:{code,name}|null,
          block_count, node_count, total_uncompressed, data_start_exact, block_compression:{LZ4:n,…}, nodes:[{index,path,offset,size,flags,is_serialized,unsafe_path}] (≤2000), nodes_truncated, problems[], notes[]}],
  summary:{bundles, parsed, nodes, serialized_nodes, total_uncompressed, by_status{}, by_compression{}, unity_revisions[]}|null, limits, limitations[4], warnings[], source:{manifest_used} }
```
**Ngữ nghĩa/quyết định:** `parsed` = đọc được header + bảng info + liệt kê node; KHÔNG có nghĩa đã đọc nội dung node hay SerializedFile. `is_serialized` chỉ là cờ node (flags & 4), chưa kiểm nội dung. Bảng info nén LZ4/LZ4HC/LZMA/không nén; LZHAM, version ngoài 6..8, UnityWeb/UnityRaw/UnityArchive → trạng thái unsupported (giữ nguyên, không đoán). Giải nén lỗi → `decompress_failed` (ghi rõ: file hỏng/biến thể không hỗ trợ/mã hóa riêng; KHÔNG thử giải mã). Đường dẫn node không an toàn (`..`, tuyệt đối, NUL) chỉ gắn cờ `unsafe_path` – không dùng làm tên file.
**Vị trí dữ liệu (rủi ro #1 chưa kiểm trên bundle thật):** bảng info ở đầu: sau header (căn 16 nếu version ≥ 7); info ở cuối (flag 0x80): tại `fileSize − compressed_info_size`. Điểm bắt đầu vùng dữ liệu là ứng viên (có/không căn 16, ưu tiên căn 16 khi flag 0x200) được CHỌN BẰNG TỰ KIỂM: ứng viên nào làm `start + Σ csize(block)` khớp CHÍNH XÁC cuối vùng (fileSize hoặc đầu bảng info) thì chọn (`data_start_exact=true`); không khớp nào → `invalid`. Bố cục header/info lấy từ kiến thức về AssetStudio/UnityPy (không tải được nguồn trong phiên, mạng tắt).
**LZMA:** bộ giải tự viết (range coder + literal/match/rep), kích thước đích biết trước, dùng chính vùng đích làm từ điển (chặn khoảng cách vượt dữ liệu đã giải). **LZ4:** block format; offset 0/vượt/thiếu/thừa byte → lỗi.

## Thay đổi ở module cũ (Account 06, 5.2a)
- `IpaReader.analyze`: bước 10 `unityfs` (sau `fonts`): `IpaResult.unityfs: UnityFsResult|null`; `skipped` khi `no_bundles`; lỗi chỉ thành cảnh báo; hủy → CANCELLED. `State.PIPELINE_STEPS`: thêm `{id:'unityfs', label:'AssetBundle UnityFS (container)'}` sau `fonts`.
- `Events.applyResult`: `session.results.unityfs`; nút `#btn-unityfs-json` (trong view Unity/Metadata) tải `unityfs_index.json`.
- UI: `buildUnityFsCard` trong view `metadata` (hiện cả khi Phase 4.1 không kết luận Unity): tóm tắt, bảng bundle, bảng node (tìm kiếm/phân trang), vấn đề/ghi chú, “Chưa làm”. `renderUnity` cache theo cả `results.unity` và `results.unityfs`. `NS.VERSION='0.10.0-phase5.2a'`.
- Worker importScripts thêm `../modules/unity_fs.js`; `index.html` nạp `js/modules/unity_fs.js` sau `font_dump.js`.
- `FontDump` KHÔNG đổi: vẫn chỉ liệt kê `unity_containers` là “chưa parse”; font bên trong bundle CHƯA được trích xuất.

## Chưa tồn tại (đừng gọi)
SerializedFile reader (danh sách object, ClassID, TextAsset/Font/TMP_FontAsset/Texture2D), xuất node ra `Raw/`/ZIP (Phase 9), metadata font (5.2b), độ phủ tiếng Việt (5.3).


---
# Bổ sung Phase 5 – SUB-PHASE 5.2c SerializedFile reader (Account 06)

## NS.SerializedFile (js/modules/serialized_file.js) – Worker + luồng chính. Nạp SAU unity_fs.js, TRƯỚC ipa_reader.js (index.html + worker đã cập nhật)
```
SerializedFile.parse(bytes, fileSize?) -> SerializedInfo   // THUẦN, không ném lỗi. bytes = ≥ header.data_offset byte đầu (hoặc cả file)
SerializedFile.readObject(bytes /*phải phủ object*/, info, objectIndex) -> Uint8Array(subarray)   // ném SfError{code: NO_OBJECT|RANGE}
SerializedFile.decodeTextAsset(objBytes, littleEndian) -> {ok, name, script:Uint8Array|null, problem?}   // m_Name + m_Script (chuỗi int32 + căn 4); name giữ lại cả khi lỗi
SerializedFile.decodeMonoScript(objBytes, littleEndian) -> {name, class_name, namespace, assembly}|null   // null nếu không hợp lệ
SerializedFile.findEmbeddedFont(objBytes, littleEndian) -> {name, offset, length, ext, format, valid:true|false|null, problems[]}|null   // HEURISTIC: quét mảng byte có int32 độ dài ngay trước + magic sfnt/TTC/WOFF; ưu tiên blob hợp lệ (FontDump.classifyBytes)
SerializedFile.isSerializedName(basename) / selectCandidates(entries, rootPath) -> [{entry, rel}]   // theo TÊN: globalgamemanagers(.assets), level<N>, sharedassets<N>.assets, *.assets, mainData, unity default resources, unity_builtin_extra
SerializedFile.scan(file, ipaResult, entries, {isCancelled?, progress?}) -> Promise<{serialized:SerializedResult, files:{[path]:Uint8Array}}>   // chỉ ném CANCELLED; đọc cả node is_serialized của bundle UnityFS (ipaResult.unityfs)
SerializedFile.toIndex(res) / toReportFields(res) -> {serialized_status, serialized_files, serialized_parsed, serialized_objects, unity_text_assets, unity_embedded_fonts, unity_monobehaviours_resolved}|null
SerializedFile.LIMITS = {max_file_bytes:256MiB, max_head_bytes:64MiB, max_object_bytes:64MiB, max_total_extract:256MiB, max_files:3000, max_types:1e5, max_objects:5e5, max_text_assets:20000, max_fonts:500, max_bundles:200, max_listed:5000, max_scripts_listed:5000}; SCHEMA='unity_serialized/1'; CLASS_NAMES; NOT_DONE[6]
```
```
SerializedInfo = { status:'parsed'|'not_serialized'|'unsupported_version'|'unsupported_typetree'|'invalid'|'truncated'|'need_more_bytes', reason, need?, header:{version,endian:'little'|'big',metadata_size,file_size,data_offset}|null,
  unity_version, target_platform, enable_type_tree, types:[{index,class_id,class_name,is_stripped,script_type_index,script_id}], objects:[{index,path_id,byte_start(tuyệt đối),byte_size,type_index,class_id,class_name,script_type_index,in_range}],
  scripts:[{file_index,path_id}], externals:[{path,guid,type}], class_counts:{ClassName:n}, problems[] }
SerializedResult (= results.serialized) = { schema:'unity_serialized/1', sub_phase:'5.2c', status:'ok'|'partial'|'none_parsed'|'no_serialized'|'error'|'not_run', reason,
  files:[{id,path,zip_path,source:'file'|'bundle_node',bundle?,node?,size,status(như SerializedInfo.status|'too_large'|'read_error'),reason,version,unity_version,endian,target_platform,enable_type_tree,type_count,object_count,classes{},externals[],script_count,
          monobehaviours:{'Namespace.Class':n,'(không xác định)':n}, extraction:'not_needed'|'done'|'too_large', extracted?:{text_assets,fonts}, problems[]}],
  text_assets:[{id,file_id,source,path_id,name,size,is_text,extraction_status:'extracted'|'failed'|'skipped_budget',extracted_path,sha256,problem}],
  fonts:[{id,file_id,source,path_id,name,size,format,valid,problems[],extraction_status:'extracted'|'rejected_invalid_candidate'|'no_embedded_font_found'|'skipped_budget',extracted_path,sha256}],
  mono_scripts:[{key,name,class_name,namespace,assembly}], mono_classes:{'Namespace.Class':n}, mono_unresolved:n,
  summary:{files,parsed,objects,by_status,by_class,versions{'v17':n},unity_versions[],text_assets,text_assets_extracted,text_assets_text,fonts,fonts_extracted,fonts_valid,fonts_rejected,mono_scripts,monobehaviours_resolved,monobehaviours_unresolved,extracted_bytes}, limits, limitations[6], warnings[], source:{candidates_by_name,bundle_nodes} }
files (byte map, KHÔNG nằm trong JSON) = { 'Text/text_assets/<nguồn>/<tên>_<pathID>.txt|.bin': Uint8Array, 'Fonts/unity/<nguồn>/<tên>_<pathID>.ttf|otf|ttc|woff|woff2': Uint8Array }
```
**Ngữ nghĩa/quyết định:** `parsed` = đọc được metadata + bảng object; KHÔNG đọc type tree để giải mã MonoBehaviour. Hỗ trợ version 9–22 (header v22 mở rộng 48 byte; LE/BE theo byte endian; header đầu luôn BE). Type tree kiểu cũ (v<10, v11) → `unsupported_typetree`; version ngoài 9–22 → `unsupported_version`/`not_serialized`. Phần đuôi metadata (scripts/externals) lỗi chỉ thành `problems`, bảng object vẫn dùng. Object ngoài vùng file → `in_range=false`, không trích. TextAsset trích NGUYÊN BYTE (`.txt` nếu UTF-8 hợp lệ, ngược lại `.bin`), KHÔNG chuyển mã/xử lý BOM. Font: trích đúng đoạn byte sfnt tìm được (heuristic); chỉ trích blob HỢP LỆ; nếu chỉ có blob không hợp lệ (dữ liệu thật: font Arial built-in 63 byte) → `extraction_status:'rejected_invalid_candidate'`, `valid=false`, `problems` ghi lý do, KHÔNG trích. MonoBehaviour → class: qua `scripts` (v≥17: `types[type].script_type_index`; v11–16: `object.script_type_index`) → (file_index, path_id) → MonoScript đọc được trong IPA (file_index>0 dùng `externals[k-1]` theo basename chữ thường); không tìm thấy → `(không xác định)`. Chỉ đọc đủ file khi có TextAsset/Font/MonoScript và ≤ 256 MiB; lớn hơn: vẫn thống kê class, `extraction:'too_large'`.
**Rủi ro #1 (chưa kiểm trên file Unity thật):** toàn bộ bố cục (header, type, object table, scripts, externals, TextAsset/MonoScript, căn 4, type tree node 24/32 byte). Nguồn: kiến thức về AssetStudio/UnityPy; mạng tắt, không đối chiếu được.

## Thay đổi ở module cũ (5.2c)
- `IpaReader.analyze`: bước 11 `serialized` (sau `unityfs`): `IpaResult.serialized`, `IpaResult.serialized_files`. `State.PIPELINE_STEPS` thêm `{id:'serialized', label:'SerializedFile (TextAsset, font, script)'}`. `Events.applyResult`: `results.serialized`, `results.serializedFiles`; nút `#btn-serialized-json` tải `unity_serialized.json`.
- UI: `buildSerializedCard` trong view `metadata` (hiện cả khi không có `results.unity`): tóm tắt, loại object, class MonoBehaviour, bảng file, TextAsset và font có nút ⬇ tải từng mục, vấn đề, “Chưa làm”. `NS.VERSION='0.11.0-phase5.2c'`. Worker importScripts + index.html thêm `serialized_file.js`.
- `FontDump` không đổi (font ngoài Unity); font trong object Font nằm ở `results.serialized.fonts`, CHƯA gộp vào `fonts.json`/ZIP (Phase 9).

## Chưa tồn tại (đừng gọi)
Giải mã MonoBehaviour/TMP_FontAsset/Texture2D/Sprite/AudioClip, đọc .resS/.resource, xuất ZIP (Phase 9), metadata font sfnt (5.2b), độ phủ tiếng Việt (5.3), gộp font Unity vào `fonts.json`.


---
# Bổ sung Phase 5 – SUB-PHASE 5.2b + 5.3 Metadata font & độ phủ tiếng Việt (Account 06)

## NS.FontMetrics (js/modules/font_metrics.js) – Worker + luồng chính. Nạp SAU serialized_file.js, TRƯỚC ipa_reader.js (index.html + worker đã cập nhật)
```
FontMetrics.parse(bytes) -> Promise<{status:'parsed'|'not_font'|'invalid'|'too_large'|'unsupported_woff2', container:'ttf'|'otf'|'ttc'|'woff'|'woff2'|null, fonts:[FontInfo], problems[], reason}>   // không ném
FontMetrics.scan(ipaResult, {isCancelled?, progress?}) -> Promise<FontMetricsResult>   // chỉ ném CANCELLED; lấy byte từ ipaResult.font_files + ipaResult.serialized_files, chỉ khóa 'Fonts/…' và giá trị Uint8Array
FontMetrics.toIndex(res) / toReportFields(res) -> {fontmetrics_status, fonts_analyzed, fonts_vi_full, fonts_vi_partial, fonts_vi_none}|null
FontMetrics.VI_REQUIRED (134 code point đã sắp xếp), ASCII_LETTERS (52), LIMITS={max_fonts:2000,max_font_bytes:64MiB,max_tables:1000,max_ttc_fonts:64,max_woff_total:128MiB,max_listed_missing:150}, SCHEMA='font_metrics/1', NOT_DONE[5]
FontInfo = { index, flavor:'truetype'|'cff'|'khác', tables[], names:{family,subfamily,full,postscript,version,typographic_family,typographic_subfamily}, units_per_em|null, num_glyphs|null,
  cmap:{status:'ok'|'missing'|'invalid'|'no_unicode_cmap'|'unsupported_format', chosen:{platform,encoding,format}|null, code_points:n|null, subtables[]},
  vietnamese:{level:'full'|'partial'|'none'|'unknown', required:134, covered:n|null, missing_count:n|null, missing:['U+1EA0',…](≤150), percent:n|null, ascii_letters_ok:bool|null, reason?}, problems[] }
FontMetricsResult (= results.fontMetrics) = { schema:'font_metrics/1', sub_phase:'5.2b+5.3', status:'ok'|'partial'|'none_parsed'|'no_fonts'|'error'|'not_run', reason,
  items:[{id,path,source:'ipa_file'|'unity_font',size,status,reason,container,fonts:[FontInfo],vietnamese_level(tốt nhất trong TTC)|null,problems[]}],
  summary:{fonts,parsed,by_status,vietnamese_full,vietnamese_partial,vietnamese_none,vietnamese_unknown}|null, vietnamese_required:134, limits, limitations[5], warnings[] }
```
**Ngữ nghĩa:** `vietnamese.level` chỉ nói cmap Unicode có ánh xạ tới glyph ≠ 0 cho 134 ký tự Việt có dấu dựng sẵn (NFC của a ă â e ê i o ô ơ u ư y × 5 dấu + 6 dạng, hoa/thường, + đ Đ; không tính ASCII). `full` = thiếu 0; `none` = có 0/134; `unknown` = không đọc được cmap Unicode. `ascii_letters_ok` tách biệt (A–Z a–z). KHÔNG kiểm glyph có hình thật, GSUB/GPOS/dấu rời, WOFF2. **Font TMP tĩnh chỉ hiển thị ký tự có trong atlas của TMP_FontAsset → độ phủ file font nguồn là điều kiện cần, không phải đủ.** cmap: ưu tiên format 12 > 4 > 6 trên subtable Unicode (platform 0, hoặc 3 với encoding 1/10). `cmap.code_points` với format 12 đếm theo nhóm (có thể gồm ánh xạ tới glyph 0); với format 4/6 chỉ đếm glyph ≠ 0. name: ưu tiên (3,1,0x409) > (3,1) > platform 0 > (1,0) MacRoman. WOFF giải nén bằng `DecompressionStream('deflate')` (chặn tổng ≤ 128 MiB). TTC: mỗi font con một FontInfo.
**Rủi ro #1 (chưa kiểm trên font thật của game):** bố cục viết từ kiến thức OpenType/WOFF, không đối chiếu spec (mạng tắt). Đã kiểm với 24 font dựng bằng fontTools (độc lập), CHƯA kiểm trên 7 font của DATA WING.

## Thay đổi ở module cũ (5.2b+5.3)
- `IpaReader.analyze`: bước 12 `fontmetrics` (sau `serialized`): `IpaResult.font_metrics`; `skipped` khi không có font. `State.PIPELINE_STEPS` thêm `{id:'fontmetrics', label:'Metadata font & độ phủ tiếng Việt'}`. `Events.applyResult`: `results.fontMetrics`; nút `#btn-fontmetrics-json` (view Font) tải `font_metrics.json`. UI: `buildFontMetricsCard` trong view Font (cột: Font, Tiếng Việt, Thiếu, Họ font, Glyph, Nguồn; thứ tự cột ưu tiên màn hình điện thoại); `renderFonts` cache theo cả `results.fontMetrics`. `NS.VERSION='0.12.0-phase5.3'`.
- `fonts.json`/`FontDump` KHÔNG đổi (chưa ghi family/glyph vào fonts.json; xem NEXT_TASK).

## Chưa tồn tại (đừng gọi)
Đọc TMP_FontAsset (atlas, bảng ký tự, font nguồn), WOFF2, kiểm dấu rời/GSUB, ghi family/glyph vào `fonts.json`, xuất ZIP (Phase 9), parser/công cụ dịch bảng chuỗi CSV (Phase 6).


---
# Bổ sung Phase 5 – SUB-PHASE 5.2d TMP_FontAsset (Account 07)

## NS.TmpFont (js/modules/tmp_font.js) – Worker + luồng chính. Nạp SAU font_metrics.js, TRƯỚC ipa_reader.js (index.html + worker importScripts đã cập nhật)
```
TmpFont.decodeObject(objBytes, littleEndian, ctx?) -> TmpItemCore   // 0.13.1: glyph_table.placeholder_glyphs; font_info.atlas_basis ∈ {'faceinfo_layout'(20 trường, THẬT),'faceinfo_layout_18'(dự phòng),'scan'}; diagnostics.best_table_check        // THUẦN, không ném lỗi. ctx={textures,materials,fonts,tmp: Map path_id→tên} (mặc định rỗng)
TmpFont.decodeFile(bytes, info, objectIndexes, fileRec, res)             // THUẦN: đẩy item vào res.items (dùng nội bộ bởi scan)
TmpFont.scan(file, ipaResult, entries, {isCancelled?, progress?}) -> Promise<TmpResult>   // chỉ ném CANCELLED; entries = ENTRY GỐC của openZip
TmpFont.toIndex(res) -> JSON thuần (= tmp_fonts.json); TmpFont.toReportFields(res) -> {tmp_status, tmp_font_assets, tmp_parsed, tmp_not_found, tmp_vi_full, tmp_vi_partial, tmp_vi_none}|null
TmpFont.LIMITS = {max_assets:200, max_asset_bytes:64MiB, max_file_bytes:256MiB, max_glyphs:70000, max_ranges:5000, max_listed_missing:150, hex_head_bytes:192, max_refs:8, max_diag_hits:6}; STRIDE=36; SCHEMA='tmp_fonts/1'; NOT_DONE[5]; VI_REQUIRED (134 code point, bằng FontMetrics.VI_REQUIRED)
```
```
TmpResult = { schema:'tmp_fonts/1', sub_phase:'5.2d', status:'ok'|'partial'|'none_parsed'|'no_tmp'|'error'|'not_run', reason, items:TmpItem[], summary:{assets,parsed,partial,not_found,other,by_status{},vietnamese_full,vietnamese_partial,vietnamese_none}|null, limits, limitations[5], warnings[] }
TmpItem = { id, file_id, source(đường dẫn file .assets), object_index, path_id, size, name(m_Name),
  status:'parsed'|'partial'|'glyph_table_not_found'|'layout_unknown'|'too_large'|'error', reason, problems[],
  header:{script_file_id, script_path_id, enabled}|null,
  font_info:{name, point_size, scale, declared_char_count, line_height, atlas_width, atlas_height, atlas_basis:'faceinfo_layout'|'scan'|null, offset}|null,
  glyph_table:{offset, stride:36, count, duplicate_ids, count_matches_declared:true|false|null, other_tables:[{offset,count}], sample:[{id,x,y,width,height,x_offset,y_offset,x_advance,scale}×≤3]}|null,
  code_points:{count, ranges:[[s,e]], ranges_total, ranges_truncated}|null,
  vietnamese:{level:'full'|'partial'|'none', required:134, covered, missing_count, missing:['U+1EF9'…≤150], percent, ascii_letters_ok, ascii_missing[]}|null,
  refs:{texture:[{path_id,name,offset}], material:[], font:[], tmp_font_asset:[]}|null,   // PPtr (fileID=0) khớp object thật trong cùng file; KHÔNG khẳng định ý nghĩa trường
  matched_fonts:[{path_id,name,basis}],                                                  // Font cùng tên với FaceInfo.name (đối chiếu tên, không phải tham chiếu)
  diagnostics:{object_size,data_start,faceinfo_offset,hex_head,stride,count_hits?:[{offset,next_hex}]} }
```
**Ngữ nghĩa/quyết định:** `parsed` = có bảng glyph hợp lệ VÀ (nếu có FaceInfo) số phần tử = CharacterCount; `partial` = có bảng nhưng lệch khai báo hoặc không có FaceInfo; không tìm được bảng → `glyph_table_not_found`/`layout_unknown`, `vietnamese=null` (KHÔNG suy diễn). `vietnamese.level` chỉ nói ATLAS có glyph cho 134 chữ Việt dựng sẵn; ‘full’ chỉ khi thiếu 0 ký tự. Bảng glyph: nhận khi MỌI phần tử hợp lệ (id 0..0x10FFFF, số hữu hạn |v|≤1e5, width/height≥0, x/y≥-0.5, 0<scale≤1000, x+width≤AtlasWidth+1 và y+height≤AtlasHeight+1 nếu biết, id trùng ≤1%); nhiều bảng hợp lệ → chọn bảng có count = CharacterCount, nếu không có thì lớn nhất. Header MonoBehaviour giả định: m_GameObject PPtr(12) + m_Enabled(1)+pad + m_Script PPtr(12) + m_Name (chuỗi căn 4); không khớp → quét từ đầu object và ghi `problems`. int64 (path_id) đọc theo endian của file. Chỉ xử lý file có `source:'file'`; TMP trong node bundle → cảnh báo.
**Rủi ro #1 (chưa kiểm trên TextMesh Pro thật):** bố cục TMP_Glyph 36 byte và FaceInfo (xem HANDOFF.md).

## Thay đổi ở module cũ (5.2d)
- `SerializedFile.scan`: mỗi mục `files[]` có thể có `tmp_font_assets: number[]` (chỉ số object MonoBehaviour mà script resolve ra class `TMP_FontAsset`, ≤5000). Cộng thêm, không đổi trường cũ.
- `IpaReader.analyze`: bước 13 `tmp` (sau `fontmetrics`): `IpaResult.tmp_fonts: TmpResult|null`; `skipped` khi `no_tmp`/`not_run`; lỗi chỉ thành cảnh báo; hủy → CANCELLED. `State.PIPELINE_STEPS` thêm `{id:'tmp', label:'TMP_FontAsset (atlas ký tự)'}` sau `fontmetrics`.
- `Events.applyResult`: `session.results.tmpFonts`; nút `#btn-tmp-json` tải `tmp_fonts.json`.
- UI: `buildTmpCard` trong view `fonts` (hiện cả khi không có file font/metrics); `renderFonts` cache theo `fonts`, `fontMetrics`, `tmpFonts`. Bảng đặt cột “Tiếng Việt” ngay sau tên asset. `NS.VERSION='0.13.0-phase5.2d'`.

## Chưa tồn tại (đừng gọi)
Giải mã Texture2D atlas, liên kết component TextMeshPro → TMP_FontAsset, TMP trong node bundle, kerning/fallback/material, ghi ngược/tạo lại atlas, gộp TMP vào `fonts.json`/ZIP (Phase 9).

## 6.1 Candidates (`js/modules/candidates.js`, schema `candidates/1`)

`NS.Candidates.run(ipaResult, {isCancelled}) → Promise<Result>` (thuần dữ liệu, dùng `ipaResult.entries/appRoot/engine/serialized`).
`register({id, run(ctx)})` / `unregister(id)` / `list()`: detector trả mảng ứng viên thô; `ctx = {ipa, appRoot, files:[{path,rel,size}], engine}`. Detector ném lỗi → ghi `detector_errors`, các detector khác vẫn chạy; `CANCELLED` được ném lại.
`normalize(c, warnings)`: ép bất biến (STATIC-OK cần `evidence_note`; `ui_status` DRIVES_UI/UNUSED chỉ khi STATIC-OK; level∈L1–L6; paths ≤ 50 + `paths_total`).
Ứng viên: `{id, engine, kind, level, paths[{path,size,lang}], languages[{code,slot,termCount|null}], componentRefs|null, ui_status, evidence, evidence_note, writable, risks[], notes[], detail, rank, suspected_secondary}`.
Result: `{schema, sub_phase, status: ok|no_candidates|error|not_run, reason, engine, candidates[], detectors_run[], detector_errors[], gate0:{done:false}, summary, limitations[], warnings[]}`. `toIndex`, `toReportFields`.
Xếp hạng: #ngôn ngữ ↓, tổng term ↓, componentRefs ↓, #file ↓; hệ ≤1 ngôn ngữ khi có hệ ≥2 ngôn ngữ → `suspected_secondary`.

## 8.2 TranslationApply (`js/modules/translation_apply.js`, schema `translation_apply/1`) – chỉ luồng chính, nạp SAU text_extract.js
`parseTranslationCsv(text) → {rows:[{line,container,file,format,lang,key,text,translation}], problems[]}` (cột bắt buộc: container,file,key,text + cột `translation`/`dịch`/`vi`; BOM, CRLF, ngoặc kép).
`checkRow(orig, tr) → [{level:'error'|'warning', msg}]`: lỗi = thiếu/thừa/nhiều hơn placeholder (đếm theo số lần), ký tự điều khiển; cảnh báo = khác số dòng, khoảng trắng đầu/cuối, dài >2,5 lần.
`validate(rows)`: gắn `status` (skip|ok|warning|error) + `issues`, trả tổng.
`applyFile({path,data}, items) → {data|null, applied, failed[{key,reason}], reason?}`: ghi .strings(text)/.json/.cdb(localizable)/.xcstrings(localization có sẵn)/.po/.properties/.csv/.tsv/.txt; giữ mã hóa+BOM+EOL. Từ chối: xml, plist, stringsdict, JSON có số ≥16 chữ số. **Kiểm lại bắt buộc**: đọc file mới bằng `TextExtract.extractBytes`, từng dòng phải bằng bản dịch (nếu đã áp) hoặc bản gốc; lệch → `data=null`. Bản gốc trong file ≠ cột `text` CSV → dòng đó không áp.
`build(texts, csvText, {force}) → {files:[{name,data}], report}`: file đã vá `translated/<ipa|pak>/…`, `patch_plan.json` (sha256, kích thước, pak_data_offset; pak cần dựng lại), `apply_report.json`, `HUONG_DAN.txt`. Dòng lỗi placeholder bị chặn trừ khi `force`. Dòng `raw:` không áp.
`TextExtract` bổ sung: `parseStringsText` rows có `vs/ve`; `parseCdb(s, setter)` trả thêm `json`; export thêm `splitCsv, csvEscape, parseXcstrings, parseJsonWalk, parseProperties, decode, extOf`.
UI: nút `#btn-apply-csv` + `#apply-csv-input` (view Text trích xuất) → tải `translated.zip`. Chưa có: ghi vào pak/IPA, xml, thêm localization mới vào xcstrings.

## 8.3 Nâng cấp mục Font (5) + Text (6) – v0.18.1
`TextExtract.parseBmfont(bytes) → {format:'text'|'xml'|'binary', face, size, chars, vietnamese}|null` (BMFont v3 nhị phân/XML/text; không có danh sách ký tự → null, không đoán). `fontMetricsOf(magic, bytes) → {status, kind, family, full?, glyphs, fonts_in_file?, bmfont_format?, vietnamese:{level,required,covered,missing_count,missing≤150,percent,ascii_letters_ok}}` (TTF/OTF/TTC/WOFF qua `FontMetrics.parse`, chọn font con phủ tốt nhất; không ném).
`TextResult.pak_fonts[i].metrics` = kết quả trên (mới); `summary.pak_fonts_vi = {full,partial,none}`. Cần `font_metrics.js` nạp TRƯỚC `text_extract.js` (đã đúng ở index.html + worker); thiếu → `metrics.status:'unparsed'`.
`TranslationApply.toTranslatedCsv(texts, map)` / `mergeCsv(texts, csv) → {map,matched,unmatched[{line,reason}],problems}`: map = {chỉ số dòng trong `texts.rows` → bản dịch}; khớp theo (container,file,key)+thứ tự xuất hiện, cột text phải trùng bản gốc.
UI: view Font có thẻ “Font trong file .pak – độ phủ tiếng Việt” (cả khi chưa có font trong IPA). View Text có trình soạn: tìm, lọc (chưa dịch/đã dịch/lỗi, theo file), 50 dòng/trang, ô dịch + kiểm placeholder trực tiếp, bộ đếm. Nút: `#btn-apply-now` (áp dụng → translated.zip), `#btn-apply-csv` (NẠP CSV vào trình soạn, không áp ngay), `#btn-translated-csv` (xuất CSV kèm bản dịch). Hàm công khai: `NS.UI_importTranslations/UI_exportTranslated/UI_applyTranslations`. Bản dịch chỉ nằm trong bộ nhớ trang (đổi IPA/tải lại là mất) → hãy xuất CSV thường xuyên.

## 8.4 Localization (`js/modules/localization.js`, schema `localization/1`) – chỉ luồng chính, nạp SAU translation_apply.js
`analyze(texts) → {schema, languages:[{code,rows,keys,files,formats[]}], base, unknown_lang_rows, groups(Map nội bộ)}`; `base` = 'en' nếu có, không thì ngôn ngữ nhiều khóa nhất. Ghép khóa giữa ngôn ngữ = HEURISTIC: đường dẫn đổi `xx(-Yyy).lproj`/token ngôn ngữ (theo bảng `TextExtract.LANG`, jp↔ja…) và cột `[en]` của CSV thành `{lang}`; pak gộp chung.
`compare(texts, an, source, target) → {source_keys, present, missing[idx dòng nguồn], identical[idx: đích y nguyên nguồn, có chữ], extra_in_target, coverage_pct, by_file{}}`.
`toTemplateCsv(texts, an, idx, refLangs)` → CSV (BOM, CRLF) cột `container,file,format,lang,key,text,confidence,placeholders,context,ref_<lang>…,translation`; đọc lại được bằng `TranslationApply.parseTranslationCsv/mergeCsv` (bản dịch ghi đè file NGUỒN; chưa tạo file ngôn ngữ mới). `toIndex(an)` → localization.json.
`TextExtract` export thêm `LANG`. UI: view `localization` (section tĩnh trong index.html; bỏ khỏi generic-views): bảng ngôn ngữ, chọn nguồn/đích/tham khảo, thống kê so khớp, 3 nút tải mẫu, nút `#btn-loc-json`.
