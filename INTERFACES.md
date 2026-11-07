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
