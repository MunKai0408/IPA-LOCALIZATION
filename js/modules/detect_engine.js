/* detect_engine.js – Phase 2: nhận diện engine game dựa trên BẰNG CHỨNG.
   Chạy được ở luồng chính và Web Worker. Chỉ đọc dữ liệu đã có (ipaResult) + vài byte đầu của vài file đặc trưng.
   Không đoán: mỗi kết luận có evidence, missing_indicators; một dấu hiệu yếu không bao giờ cho "confirmed". */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};

  /* Trọng số theo mức dấu hiệu. Độ tin cậy = 1 - Π(1 - w) (noisy-or) rồi bị chặn theo trạng thái. */
  const TIER = { strong: 0.75, medium: 0.45, weak: 0.12 };
  const MIN_CONFIDENCE = 0.2;               // dưới ngưỡng này => Unknown
  const CAP = { possible: 0.45, probable: 0.8 };
  const NATIVE_CAP = 0.6;                   // Native iOS suy ra từ việc thiếu engine → không bao giờ confirmed

  /* ---------- Bảng dấu hiệu ----------
     skipIf: danh sách id (khai báo trước đó) – nếu một id đã khớp thì dấu hiệu này bị bỏ qua vì cùng một nguồn
     re   : regex trên đường dẫn (chữ thường) tương đối với .app; thư mục kết thúc bằng '/'
     abs  : true => dùng đường dẫn tuyệt đối trong IPA (vd SwiftSupport/ ở ngoài Payload)
     fw   : regex trên tên framework trong Frameworks/ (chữ thường)
     exe  : regex trên CFBundleExecutable (chữ thường)
     plist: hàm(infoPlist) -> chuỗi mô tả | null
     probe: {kind, match?} khớp với kết quả runProbes (magic bytes)
     variant: biến thể mà dấu hiệu này chứng minh */
  const ENGINES = [
    { key: 'unity', name: 'Unity', variants: ['IL2CPP', 'Mono'], needVariantNote: true, indicators: [
      { id: 'unity.framework', tier: 'strong', label: 'UnityFramework.framework', fw: /^unityframework\.framework$/ },
      { id: 'unity.il2cpp.metadata', tier: 'strong', variant: 'IL2CPP', label: 'global-metadata.dat', re: /(^|\/)global-metadata\.dat$/ },
      { id: 'unity.il2cpp.lib', tier: 'strong', variant: 'IL2CPP', label: 'libil2cpp', re: /(^|\/)libil2cpp/ },
      { id: 'unity.il2cpp.dir', tier: 'medium', variant: 'IL2CPP', label: 'Data/Managed/Metadata hoặc il2cpp_data', skipIf: ['unity.il2cpp.metadata'], re: /(^|\/)(data\/managed\/metadata|il2cpp_data)\/$/ },
      { id: 'unity.il2cpp.magic', tier: 'medium', variant: 'IL2CPP', label: 'Magic bytes global-metadata.dat (AF 1B B1 FA)', probe: { kind: 'il2cpp_metadata' } },
      { id: 'unity.mono.assembly', tier: 'strong', variant: 'Mono', label: 'Managed/Assembly-CSharp.dll', re: /(^|\/)managed\/assembly-csharp(-firstpass)?\.dll$/ },
      { id: 'unity.mono.engine', tier: 'medium', variant: 'Mono', label: 'Managed/UnityEngine*.dll', re: /(^|\/)managed\/unityengine[^\/]*\.dll$/ },
      { id: 'unity.mono.mscorlib', tier: 'medium', variant: 'Mono', label: 'Managed/mscorlib.dll', re: /(^|\/)managed\/mscorlib\.dll$/ },
      { id: 'unity.mono.runtime', tier: 'medium', variant: 'Mono', label: 'Thư viện runtime Mono (libmono*)', re: /(^|\/)libmono[^\/]*$/ },
      { id: 'unity.ggm', tier: 'strong', label: 'globalgamemanagers', re: /(^|\/)globalgamemanagers(\.assets)?$/ },
      { id: 'unity.data3d', tier: 'strong', label: 'data.unity3d', re: /(^|\/)data\.unity3d$/ },
      { id: 'unity.magic', tier: 'strong', label: 'Magic bytes UnityFS/UnityWeb/UnityRaw', probe: { kind: 'unityfs' } },
      { id: 'unity.defaultres', tier: 'medium', label: 'unity default resources', re: /(^|\/)unity default resources$/ },
      { id: 'unity.levels', tier: 'medium', label: 'levelN / sharedassetsN.assets / resources.assets', re: /(^|\/)(level\d+|sharedassets\d+\.assets|resources\.assets)$/ },
      { id: 'unity.bootconfig', tier: 'medium', label: 'Data/boot.config', re: /(^|\/)data\/boot\.config$/ },
      { id: 'unity.raw', tier: 'medium', label: 'Data/Raw (StreamingAssets)', re: /(^|\/)data\/raw\/$/ },
      { id: 'unity.assets', tier: 'weak', label: '*.assets', re: /(^|\/)(?!sharedassets|resources\.|globalgamemanagers)[^\/]+\.assets$/ },
      { id: 'unity.bundle', tier: 'weak', label: '*.bundle (file)', re: /(^|\/)(?!index\.|main\.)[^\/]+\.bundle$/ },
      { id: 'unity.exe', tier: 'weak', label: 'File thực thi tên Unity-iPhone', exe: /^unity-iphone$/ }
    ] },
    { key: 'unreal', name: 'Unreal Engine', indicators: [
      { id: 'unreal.paks', tier: 'strong', label: 'Content/Paks/', re: /(^|\/)content\/paks\/$/ },
      { id: 'unreal.iostore', tier: 'strong', label: '*.utoc / *.ucas', re: /\.(utoc|ucas)$/ },
      { id: 'unreal.lib', tier: 'strong', label: 'libUE4 / libUnreal', re: /(^|\/)(libue4|libunreal)[^\/]*$/ },
      { id: 'unreal.exe', tier: 'strong', label: 'File thực thi UnrealGame', exe: /^unrealgame$/ },
      { id: 'unreal.cooked', tier: 'medium', label: 'cookeddata/', re: /^cookeddata\/$/ },
      { id: 'unreal.pak', tier: 'medium', skipIf: ['unreal.paks'], label: '*.pak', re: /\.pak$/ },
      { id: 'unreal.uasset', tier: 'medium', label: '*.uasset / *.umap / *.ubulk / *.uexp', re: /\.(uasset|umap|ubulk|uexp)$/ }
    ] },
    { key: 'cocos', name: 'Cocos2d-x / Cocos Creator', variants: ['Creator'], indicators: [
      { id: 'cocos.libjs', tier: 'strong', variant: 'Creator', label: 'libcocos2djs', re: /(^|\/)libcocos2djs/ },
      { id: 'cocos.jsb', tier: 'strong', variant: 'Creator', label: 'jsb-adapter/ hoặc cocos-js/', re: /(^|\/)(jsb-adapter|cocos-js)\/$/ },
      { id: 'cocos.fw', tier: 'strong', label: 'Framework/thư viện cocos2d', fw: /^(lib)?cocos2d[^\/]*$/ },
      { id: 'cocos.assetsmain', tier: 'medium', variant: 'Creator', label: 'assets/main/', re: /(^|\/)assets\/main\/$/ },
      { id: 'cocos.manifest', tier: 'medium', label: 'project.manifest', re: /(^|\/)project\.manifest$/ },
      { id: 'cocos.jsc', tier: 'medium', label: '*.jsc', re: /\.jsc$/ },
      { id: 'cocos.dir', tier: 'medium', label: 'Thư mục cocos2d*', re: /(^|\/)cocos2d[^\/]*\/$/ },
      { id: 'cocos.luac', tier: 'weak', label: '*.luac', re: /\.luac$/ }
    ] },
    { key: 'godot', name: 'Godot', indicators: [
      { id: 'godot.project', tier: 'strong', label: 'project.godot', re: /(^|\/)project\.godot$/ },
      { id: 'godot.fw', tier: 'strong', label: 'Framework/thư viện Godot', fw: /^(lib)?godot[^\/]*$/ },
      { id: 'godot.magic', tier: 'strong', label: 'Magic bytes GDPC trong *.pck', probe: { kind: 'gdpc' } },
      { id: 'godot.pck', tier: 'medium', label: '*.pck', re: /\.pck$/ },
      { id: 'godot.scene', tier: 'medium', label: '*.tscn / *.tres / *.gdc / *.gdextension', re: /\.(tscn|tres|gdc|gdextension)$/ }
    ] },
    { key: 'gamemaker', name: 'GameMaker', indicators: [
      { id: 'gm.data', tier: 'strong', label: 'data.win / game.droid / game.unx', re: /(^|\/)(data\.win|game\.droid|game\.unx)$/ },
      { id: 'gm.magic.gen8', tier: 'strong', label: 'Magic bytes FORM + chunk GEN8', probe: { kind: 'gm_data', match: 'gen8' } },
      { id: 'gm.ios', tier: 'medium', label: 'game.ios', re: /(^|\/)game\.ios$/ },
      { id: 'gm.runtime', tier: 'medium', label: 'Runtime GameMaker/YoYo', re: /(^|\/)(libyoyo[^\/]*|gamemaker[^\/]*|yoyorunner[^\/]*)$/ },
      { id: 'gm.magic.form', tier: 'weak', label: 'Magic bytes FORM (không thấy chunk GEN8)', probe: { kind: 'gm_data', match: 'form' } }
    ] },
    { key: 'defold', name: 'Defold', indicators: [
      { id: 'defold.arc', tier: 'strong', label: 'game.arcd / game.arci', re: /(^|\/)game\.arc[di]$/ },
      { id: 'defold.projectc', tier: 'strong', label: 'game.projectc / game.dmanifest', re: /(^|\/)game\.(projectc|dmanifest)$/ },
      { id: 'defold.engine', tier: 'strong', label: 'Runtime dmengine', re: /(^|\/)dmengine[^\/]*$/ },
      { id: 'defold.project', tier: 'medium', label: 'game.project', re: /(^|\/)game\.project$/ }
    ] },
    { key: 'flutter', name: 'Flutter', indicators: [
      { id: 'flutter.fw', tier: 'strong', label: 'Flutter.framework', fw: /^flutter\.framework$/ },
      { id: 'flutter.assets', tier: 'strong', label: 'flutter_assets/', re: /(^|\/)flutter_assets\/$/ },
      { id: 'flutter.app', tier: 'medium', label: 'App.framework', fw: /^app\.framework$/ },
      { id: 'flutter.assetmanifest', tier: 'medium', label: 'AssetManifest.json/.bin', skipIf: ['flutter.assets'], re: /(^|\/)assetmanifest\.(json|bin|bin\.json)$/ },
      { id: 'flutter.fontmanifest', tier: 'medium', label: 'FontManifest.json', skipIf: ['flutter.assets'], re: /(^|\/)fontmanifest\.json$/ },
      { id: 'flutter.snapshot', tier: 'medium', label: 'kernel_blob.bin / *_snapshot_data', skipIf: ['flutter.assets'], re: /(^|\/)(kernel_blob\.bin|isolate_snapshot_data|vm_snapshot_data)$/ }
    ] },
    { key: 'reactnative', name: 'React Native', variants: ['Hermes'], indicators: [
      { id: 'rn.main', tier: 'strong', label: 'main.jsbundle', re: /(^|\/)main\.jsbundle$/ },
      { id: 'rn.fw', tier: 'strong', label: 'React.framework', fw: /^react(-native|native|-core)?\.framework$/ },
      { id: 'rn.hermes.magic', tier: 'strong', variant: 'Hermes', label: 'Magic bytes Hermes bytecode', probe: { kind: 'rn_bundle', match: 'hermes' } },
      { id: 'rn.bundle', tier: 'medium', label: 'index.bundle / *.jsbundle', re: /(^|\/)(index\.(ios\.)?bundle|(?!main\.)[^\/]+\.jsbundle)$/ },
      { id: 'rn.metro', tier: 'medium', label: 'Bundle JS dạng văn bản của Metro', probe: { kind: 'rn_bundle', match: 'metro' } },
      { id: 'rn.hermesfw', tier: 'medium', label: 'hermes.framework', fw: /^hermes\.framework$/ },
      { id: 'rn.assets', tier: 'medium', label: 'assets/node_modules/', re: /(^|\/)assets\/node_modules\/$/ }
    ] },
    { key: 'solar2d', name: 'Solar2D / Corona', indicators: [
      { id: 'solar.car', tier: 'strong', label: 'resource.car', re: /(^|\/)resource\.car$/ },
      { id: 'solar.fw', tier: 'strong', label: 'Corona/Solar2D runtime', fw: /^(corona|coronacards|solar2d)[^\/]*$/ },
      { id: 'solar.config', tier: 'medium', label: 'config.lua', re: /(^|\/)config\.lua$/ },
      { id: 'solar.main', tier: 'weak', label: 'main.lua', re: /(^|\/)main\.lua$/ },
      { id: 'solar.lu', tier: 'weak', label: '*.lu', re: /\.lu$/ }
    ] },
    { key: 'renpy', name: "Ren'Py", indicators: [
      { id: 'renpy.script', tier: 'strong', label: '*.rpy / *.rpyc / *.rpymc', re: /\.(rpy|rpyc|rpymc)$/ },
      { id: 'renpy.rpa', tier: 'strong', label: '*.rpa', re: /\.rpa$/ },
      { id: 'renpy.dir', tier: 'strong', label: 'Thư mục renpy/', re: /(^|\/)renpy\/$/ },
      { id: 'renpy.game', tier: 'weak', label: 'Thư mục game/', re: /(^|\/)game\/$/ }
    ] },
    { key: 'rpgmaker', name: 'RPG Maker MV/MZ', variants: ['MV', 'MZ'], needVariantNote: true, indicators: [
      { id: 'rpgm.mv', tier: 'strong', variant: 'MV', label: 'js/rpg_core.js', re: /(^|\/)js\/rpg_core\.js$/ },
      { id: 'rpgm.mz', tier: 'strong', variant: 'MZ', label: 'js/rmmz_core.js', re: /(^|\/)js\/rmmz_core\.js$/ },
      { id: 'rpgm.data', tier: 'medium', label: 'www/data/*.json hoặc data/System.json', re: /(^|\/)(www\/data\/[^\/]+|data\/(system|mapinfos))\.json$/ },
      { id: 'rpgm.plugins', tier: 'medium', label: 'js/plugins.js', re: /(^|\/)js\/plugins\.js$/ },
      { id: 'rpgm.fonts', tier: 'weak', label: 'www/fonts/', re: /(^|\/)www\/fonts\/$/ },
      { id: 'rpgm.package', tier: 'weak', label: 'package.json', re: /(^|\/)package\.json$/ }
    ] },
    { key: 'native', name: 'Native iOS', native: true, indicators: [
      { id: 'native.swift', tier: 'medium', abs: true, label: 'Swift runtime (libswift*.dylib / SwiftSupport)', re: /(^payload\/[^\/]+\.app\/frameworks\/libswift[^\/]*\.dylib$|^swiftsupport\/)/ },
      { id: 'native.storyboard', tier: 'weak', label: '*.storyboardc (UIKit)', re: /(^|\/)[^\/]+\.storyboardc\/$/ },
      { id: 'native.nib', tier: 'weak', label: '*.nib (UIKit)', re: /(^|\/)[^\/]+\.nib\/?$/ },
      { id: 'native.assetscar', tier: 'weak', label: 'Assets.car', re: /(^|\/)assets\.car$/ },
      { id: 'native.plist', tier: 'weak', label: 'Info.plist có UIMainStoryboardFile/NSMainNibFile', plist: function (p) { return (p && (p.UIMainStoryboardFile || p.NSMainNibFile)) ? 'Info.plist' : null; } }
    ] }
  ];

  const BRANCH = {
    unity: 'unity', unreal: 'unreal', cocos: 'cocos', godot: 'godot', gamemaker: 'gamemaker', defold: 'defold',
    flutter: 'flutter', reactnative: 'react_native', solar2d: 'solar2d', renpy: 'renpy', rpgmaker: 'rpgmaker', native: 'native_ios'
  };

  /* ---------- Ngữ cảnh đường dẫn ---------- */
  function buildContext(ipa) {
    const rootPath = ipa.appRoot || '';
    const abs = [];                  // tất cả đường dẫn (chữ thường), không thư mục
    const rel = [];                  // [{p, l}] dưới .app; thư mục có '/' cuối; thư mục xếp trước
    const dirSeen = new Map();       // lower -> original
    const files = [];
    (ipa.entries || []).forEach(function (e) {
      if (e.unsafe) return;
      abs.push(e.path.toLowerCase());
      if (e.path.indexOf(rootPath) !== 0 || e.path.length <= rootPath.length) return;
      const r = e.path.slice(rootPath.length);
      const parts = r.split('/');
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc += parts[i] + '/';
        const l = acc.toLowerCase();
        if (!dirSeen.has(l)) dirSeen.set(l, acc);
      }
      if (!e.dir && !r.endsWith('/')) files.push({ p: r, l: r.toLowerCase() });
    });
    dirSeen.forEach(function (orig, l) { rel.push({ p: orig, l: l }); });
    files.forEach(function (f) { rel.push(f); });
    return {
      rel: rel, abs: abs,
      fws: (ipa.frameworks || []).map(function (n) { return { p: n, l: n.toLowerCase() }; }),
      exe: ((ipa.app && ipa.app.executable) || '').toLowerCase(),
      exeRaw: (ipa.app && ipa.app.executable) || '',
      plist: ipa.infoPlist || null
    };
  }

  function firstMatch(list, re) {
    let first = null, count = 0;
    for (let i = 0; i < list.length; i++) {
      if (re.test(list[i].l)) { if (!first) first = list[i].p; count++; }
    }
    return first ? { path: first, count: count } : null;
  }

  function evalIndicator(ind, ctx, probes) {
    if (ind.re) {
      if (ind.abs) {
        let first = null, count = 0;
        for (let i = 0; i < ctx.abs.length; i++) if (ind.re.test(ctx.abs[i])) { if (!first) first = ctx.abs[i]; count++; }
        return first ? { path: first, count: count } : null;
      }
      return firstMatch(ctx.rel, ind.re);
    }
    if (ind.fw) { const m = firstMatch(ctx.fws, ind.fw); return m ? { path: 'Frameworks/' + m.path, count: m.count } : null; }
    if (ind.exe) return ind.exe.test(ctx.exe) ? { path: ctx.exeRaw, count: 1 } : null;
    if (ind.plist) { const r = ind.plist(ctx.plist); return r ? { path: r, count: 1 } : null; }
    if (ind.probe) {
      const hits = probes.filter(function (p) {
        return p.kind === ind.probe.kind && p.matched && (ind.probe.match === undefined || p.matched === ind.probe.match);
      });
      return hits.length ? { path: hits[0].path, count: hits.length } : null;
    }
    return null;
  }

  function combine(evidence) {
    let miss = 1;
    evidence.forEach(function (e) { miss *= (1 - e.weight); });
    return 1 - miss;
  }

  function classify(evidence) {
    const strong = evidence.filter(function (e) { return e.tier === 'strong'; }).length;
    const medium = evidence.filter(function (e) { return e.tier === 'medium'; }).length;
    let c = combine(evidence), status;
    if (!evidence.length) { status = 'unknown'; c = 0; }
    else if (strong >= 1 && evidence.length >= 2 && c >= 0.85) status = 'confirmed';
    else if (strong >= 1 || medium >= 2) status = 'probable';
    else status = 'possible';
    if (status === 'probable') c = Math.min(c, CAP.probable);
    if (status === 'possible') c = Math.min(c, CAP.possible);
    return { confidence: c, status: status, strong: strong, medium: medium };
  }

  function scoreEngine(def, ctx, probes) {
    const evidence = [], missing = [];
    const matched = new Set();
    def.indicators.forEach(function (ind) {
      // dấu hiệu phụ thuộc: nếu dấu hiệu "cha" đã khớp thì bỏ qua (tránh đếm hai lần cùng một sự kiện)
      if (ind.skipIf && ind.skipIf.some(function (id) { return matched.has(id); })) return;
      const m = evalIndicator(ind, ctx, probes);
      if (m) matched.add(ind.id);
      if (m) evidence.push({ indicator: ind.label, path: m.path, weight: TIER[ind.tier], tier: ind.tier, id: ind.id, variant: ind.variant || null, count: m.count });
      else missing.push(ind);
    });
    evidence.sort(function (a, b) { return b.weight - a.weight; });
    const cl = classify(evidence);
    return { def: def, evidence: evidence, missing: missing, confidence: cl.confidence, status: cl.status, strong: cl.strong, medium: cl.medium };
  }

  /* Chọn biến thể: chỉ khi đúng một biến thể có bằng chứng đủ (≥1 strong hoặc ≥2 medium). */
  function pickVariant(cand, notes) {
    const def = cand.def; if (!def.variants) return null;
    const groups = {};
    cand.evidence.forEach(function (e) {
      if (!e.variant) return;
      const g = groups[e.variant] = groups[e.variant] || { strong: 0, medium: 0 };
      if (e.tier === 'strong') g.strong++; else if (e.tier === 'medium') g.medium++;
    });
    const eligible = Object.keys(groups).filter(function (v) { return groups[v].strong >= 1 || groups[v].medium >= 2; });
    if (eligible.length === 1) return eligible[0];
    if (eligible.length > 1) { notes.push('Bằng chứng mâu thuẫn giữa các biến thể (' + eligible.join(', ') + '): không chọn biến thể nào.'); return null; }
    if (def.needVariantNote) notes.push('Chưa đủ bằng chứng để xác định biến thể (' + def.variants.join(' / ') + ').');
    return null;
  }

  function probeVersion(chosenKey, probes) {
    const p = probes.filter(function (x) { return x.matched && x.info; });
    if (chosenKey === 'unity') {
      const u = p.find(function (x) { return x.kind === 'unityfs' && x.info.unityRevision; });
      if (u) return { version: u.info.unityRevision, source: u.path };
    }
    if (chosenKey === 'godot') {
      const g = p.find(function (x) { return x.kind === 'gdpc' && x.info.version; });
      if (g) return { version: g.info.version, source: g.path };
    }
    return { version: null, source: null };
  }

  /** Nhận diện engine từ IpaResult (+ kết quả runProbes, tùy chọn). Đồng bộ, không I/O. */
  function detect(ipa, probesIn) {
    const probes = probesIn || [];
    const ctx = buildContext(ipa);
    const notes = [];
    const cands = ENGINES.map(function (d) { return scoreEngine(d, ctx, probes); });
    const hit = cands.filter(function (c) { return c.confidence >= MIN_CONFIDENCE; });
    hit.sort(function (a, b) { return b.confidence - a.confidence || b.strong - a.strong || b.evidence.length - a.evidence.length; });

    const encrypted = ipa.macho && ipa.macho.encrypted === true;
    if (encrypted) notes.push('Binary chính bị mã hóa FairPlay (cryptid≠0): không đọc được nội dung binary; nhận diện chỉ dựa vào cấu trúc file, tên và magic bytes.');
    probes.forEach(function (p) {
      if (p.error) notes.push('Không đọc được ' + p.path + ' để kiểm tra magic bytes (' + p.kind + '): ' + p.error);
      else if (!p.matched) notes.push('Magic bytes của ' + p.path + ' không khớp định dạng ' + p.kind + ' (có thể bị mã hóa, nén hoặc định dạng khác): không dùng làm bằng chứng.');
    });

    const out = { engine: 'Unknown', variant: null, confidence: 0, status: 'unknown', evidence: [], missing_indicators: [], version: null, version_source: null,
                  analysis_branch: 'generic', notes: notes, alternatives: [] };
    const mk = function (c) { return { engine: c.def.name, confidence: round(c.confidence), status: c.status }; };

    if (!hit.length) {
      out.missing_indicators = ['Không có dấu hiệu nào của các engine được hỗ trợ đạt ngưỡng tối thiểu'];
      notes.push('Không đủ bằng chứng để kết luận engine; chuyển sang nhánh phân tích chung.');
      out.alternatives = cands.filter(function (c) { return c.evidence.length; }).map(mk);
      return out;
    }

    let chosen = hit[0];
    if (chosen.def.native) {
      const others = hit.filter(function (c) { return !c.def.native; });
      if (!others.length) {
        const ev = chosen.evidence.concat([{ indicator: 'Không phát hiện dấu hiệu engine game phổ biến', path: '—', weight: TIER.medium, tier: 'medium', id: 'native.absence', variant: null, count: 1 }]);
        const cl = classify(ev);
        chosen = Object.assign({}, chosen, { evidence: ev, confidence: cl.confidence, status: cl.status });
      }
      if (chosen.status === 'confirmed') chosen.status = 'probable';
      chosen.confidence = Math.min(chosen.confidence, NATIVE_CAP);
      notes.push('Native iOS được suy ra từ dấu hiệu UIKit/Swift và việc thiếu dấu hiệu engine game; đây không phải xác nhận trực tiếp.');
    }

    const variant = pickVariant(chosen, notes);
    const ver = chosen.def.native ? { version: null, source: null } : probeVersion(chosen.def.key, probes);
    if (chosen.def.key === 'unity' && !ver.version) notes.push('Không đọc được phiên bản Unity từ dữ liệu (không có bundle UnityFS hợp lệ); để trống, không suy đoán.');

    const usable = chosen.missing.filter(function (ind) {
      if (ind.tier === 'weak') return false;
      if (variant && ind.variant && ind.variant !== variant) return false;
      return true;
    });

    out.engine = chosen.def.name;
    out.variant = variant;
    out.confidence = round(chosen.confidence);
    out.status = chosen.status;
    out.evidence = chosen.evidence.map(function (e) { return { indicator: e.indicator, path: e.path, weight: e.weight, tier: e.tier, id: e.id }; });
    out.missing_indicators = usable.map(function (i) { return i.label; });
    out.version = ver.version; out.version_source = ver.source;
    out.alternatives = hit.filter(function (c) { return c !== hit[0]; }).map(mk);

    if (chosen.status === 'confirmed' || chosen.status === 'probable') {
      let br = BRANCH[chosen.def.key];
      if (chosen.def.key === 'unity') br = variant === 'IL2CPP' ? 'unity_il2cpp' : variant === 'Mono' ? 'unity_mono' : 'unity_unresolved';
      out.analysis_branch = br;
    } else {
      out.analysis_branch = 'generic';
      notes.push('Mức tin cậy "possible": dùng nhánh phân tích chung cho đến khi có thêm bằng chứng.');
    }
    if (out.alternatives.length) notes.push('Có dấu hiệu của engine khác: ' + out.alternatives.map(function (a) { return a.engine + ' (' + a.status + ')'; }).join(', ') + '.');
    return out;
  }

  function round(x) { return Math.round(x * 100) / 100; }

  /* ---------- Kiểm tra magic bytes (đọc vài byte đầu) ---------- */
  const PROBE_BYTES = 64;

  function asciiAt(b, off, n) { let s = ''; for (let i = 0; i < n && off + i < b.length; i++) s += String.fromCharCode(b[off + i]); return s; }
  function cstr(b, off, max) { let s = '', i = off; while (i < b.length && i < off + max && b[i] !== 0) { s += String.fromCharCode(b[i]); i++; } return { s: s, next: i + 1, ok: i < b.length && b[i] === 0 }; }
  function u32le(b, o) { return o + 4 <= b.length ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : null; }
  function u32be(b, o) { return o + 4 <= b.length ? ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 : null; }

  const PARSERS = {
    unityfs: function (b) {
      const sig = asciiAt(b, 0, 8);
      if (sig !== 'UnityFS\0' && sig !== 'UnityWeb' && sig !== 'UnityRaw') return { matched: false };
      const info = { signature: sig.replace(/\0$/, '') };
      if (sig === 'UnityFS\0') {
        info.formatVersion = u32be(b, 8);
        const a = cstr(b, 12, 32), r = a.ok ? cstr(b, a.next, 32) : { ok: false };
        if (a.ok) info.minPlayerVersion = a.s;
        if (r.ok && /^\d+\.\d+\.\d+([abfp]\d+)?$/.test(r.s)) info.unityRevision = r.s;
      }
      return { matched: true, info: info };
    },
    il2cpp_metadata: function (b) {
      if (b.length < 8 || b[0] !== 0xAF || b[1] !== 0x1B || b[2] !== 0xB1 || b[3] !== 0xFA) return { matched: false };
      return { matched: true, info: { metadataVersion: u32le(b, 4) | 0 } };
    },
    gdpc: function (b) {
      if (asciiAt(b, 0, 4) !== 'GDPC') return { matched: false };
      const info = { packFormat: u32le(b, 4) }, ma = u32le(b, 8), mi = u32le(b, 12), pa = u32le(b, 16);
      if (ma !== null && mi !== null && pa !== null && ma >= 1 && ma <= 9 && mi < 100 && pa < 100) info.version = ma + '.' + mi + '.' + pa;
      return { matched: true, info: info };
    },
    rn_bundle: function (b) {
      if (b.length >= 12 && b[0] === 0xC6 && b[1] === 0x1F && b[2] === 0xBC && b[3] === 0x03 && b[4] === 0xC1 && b[5] === 0x03 && b[6] === 0x19 && b[7] === 0x1F)
        return { matched: 'hermes', info: { hermesBytecodeVersion: u32le(b, 8) } };
      if (asciiAt(b, 0, b.length).indexOf('__BUNDLE_START_TIME__') >= 0) return { matched: 'metro', info: {} };
      return { matched: false };
    },
    gm_data: function (b) {
      if (asciiAt(b, 0, 4) !== 'FORM') return { matched: false };
      return { matched: asciiAt(b, 8, 4) === 'GEN8' ? 'gen8' : 'form', info: {} };
    }
  };

  /** Lập kế hoạch kiểm tra magic bytes: chọn tối đa vài file đặc trưng (không đọc toàn bộ). */
  function planProbes(ipa) {
    const ctx = buildContext(ipa);
    const files = ctx.rel.filter(function (x) { return !/\/$/.test(x.p); });
    const pick = function (re, n, exclude) {
      const r = []; for (let i = 0; i < files.length && r.length < n; i++) if (re.test(files[i].l) && !(exclude && exclude.test(files[i].l))) r.push(files[i].p); return r;
    };
    const plan = [];
    const seen = new Set();
    const add = function (kind, paths) { paths.forEach(function (p) { const k = kind + '|' + p; if (!seen.has(k)) { seen.add(k); plan.push({ kind: kind, path: p }); } }); };
    add('unityfs', pick(/(^|\/)data\.unity3d$/, 1).concat(pick(/\.(unity3d|ab|assetbundle|bundle)$/, 3, /(^|\/)(index|main)\.[^\/]*bundle$/)).slice(0, 3));
    add('il2cpp_metadata', pick(/(^|\/)global-metadata\.dat$/, 2));
    add('gdpc', pick(/\.pck$/, 2));
    add('rn_bundle', pick(/(^|\/)(main\.jsbundle|index\.(ios\.)?bundle|[^\/]+\.jsbundle)$/, 2));
    add('gm_data', pick(/(^|\/)(data\.win|game\.droid|game\.unx|game\.ios)$/, 1));
    return plan;
  }

  /** Đọc vài byte đầu của các file trong kế hoạch. zipEntries = entries gốc của IpaReader.openZip. */
  async function runProbes(file, ipa, zipEntries, hooks) {
    hooks = hooks || {};
    const byName = new Map();
    (zipEntries || []).forEach(function (e) { if (!byName.has(e.name)) byName.set(e.name, e); });
    const out = [];
    const plan = planProbes(ipa);
    for (let i = 0; i < plan.length; i++) {
      if (hooks.isCancelled && hooks.isCancelled()) break;
      const item = plan[i], ze = byName.get((ipa.appRoot || '') + item.path);
      if (!ze) { out.push({ kind: item.kind, path: item.path, matched: false, error: 'không tìm thấy entry' }); continue; }
      try {
        const r = await NS.IpaReader.readEntry(file, ze, { max: PROBE_BYTES, head: true });
        const res = PARSERS[item.kind](r.data);
        out.push({ kind: item.kind, path: item.path, matched: res.matched, info: res.info || null });
      } catch (e) {
        out.push({ kind: item.kind, path: item.path, matched: false, error: (e && e.message) || String(e) });
      }
    }
    return out;
  }

  /** Phần engine của report.json (Phase 9 sẽ gộp vào file). */
  function toReportFields(res) {
    return { engine: res.engine, engine_variant: res.variant, engine_confidence: res.confidence, engine_status: res.status };
  }

  NS.DetectEngine = { TIER: TIER, MIN_CONFIDENCE: MIN_CONFIDENCE, ENGINE_NAMES: ENGINES.map(function (e) { return e.name; }),
                      detect: detect, planProbes: planProbes, runProbes: runProbes, toReportFields: toReportFields };
})(typeof window !== 'undefined' ? window : self);
