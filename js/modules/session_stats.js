/* session_stats.js – tính số liệu dashboard (stringCount, localizationTables, …) từ IpaResult ĐÃ CÓ. Thuần dữ liệu, không I/O, chạy được trong Node.
   Quy ước: null = chưa có dữ liệu thật (bước lỗi/chưa chạy); 0 = đã chạy và thật sự không thấy.
   stringCount = số dòng text trích được (texts.summary.rows); nếu 0 dòng thì dùng số string literal IL2CPP (unity.metadata_literals.count, status ok); nếu texts đã chạy mà không có gì → 0.
   localizationTables = số bảng/file ngôn ngữ ĐÃ THẤY: (a) file text đã đọc có mã ngôn ngữ (container|file) + (b) bảng Unity chưa đọc nội dung từ candidates (unity.i2, unity.localization_package, unity.textasset; mỗi path 1 bảng, không path thì 1).
   Chỉ là số lượng "đã thấy", KHÔNG phải bằng chứng game dùng bảng đó lúc chạy. Dùng chung với events.js. */
(function (root) {
  'use strict';
  const NS = root.IPAStudio = root.IPAStudio || {};
  const UNITY_TABLE_KINDS = { 'unity.i2': 1, 'unity.localization_package': 1, 'unity.textasset': 1 };

  function stringStat(r) {
    const tx = r && r.texts, rows = tx && tx.summary ? tx.summary.rows : null;
    if (typeof rows === 'number' && rows > 0) return { value: rows, source: 'texts' };
    const lit = r && r.unity && r.unity.metadata_literals;
    if (lit && lit.status === 'ok' && typeof lit.count === 'number' && lit.count > 0) return { value: lit.count, source: 'il2cpp_literals' };
    if (typeof rows === 'number') return { value: 0, source: 'texts' };
    return { value: null, source: null };
  }

  function tableStat(r) {
    const tx = r && r.texts, cr = r && r.candidates, ran = !!((tx && tx.summary) || (cr && cr.summary));
    if (!ran) return { value: null, read: null, unity_unread: null };
    const files = new Set();
    ((tx && tx.rows) || []).forEach(function (x) { if (x.lang && x.lang !== 'base') files.add(x.container + '|' + x.file); });
    let unread = 0;
    ((cr && cr.candidates) || []).forEach(function (c) { if (UNITY_TABLE_KINDS[c.kind]) unread += (c.paths && c.paths.length) || 1; });
    return { value: files.size + unread, read: files.size, unity_unread: unread };
  }

  /** @returns {{totalFiles, fontCount, stringCount, localizationTables, stringSource, tableBreakdown}} */
  function compute(r) {
    const s = stringStat(r), t = tableStat(r);
    return {
      totalFiles: r.manifest && r.manifest.summary ? r.manifest.summary.totalFiles : (r.zip ? r.zip.fileCount : null),
      fontCount: r.fonts && r.fonts.summary ? r.fonts.summary.fonts_valid : null,
      stringCount: s.value, localizationTables: t.value, stringSource: s.source, tableBreakdown: t.value === null ? null : { read: t.read, unity_unread: t.unity_unread }
    };
  }

  NS.SessionStats = { compute: compute, stringStat: stringStat, tableStat: tableStat };
})(typeof window !== 'undefined' ? window : self);
