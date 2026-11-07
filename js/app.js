/* app.js – điểm khởi động. Phải nạp SAU logger, state, ui, events. */
(function (NS) {
  'use strict';
  NS.VERSION = '0.3.0-phase2';

  function boot() {
    let theme = 'dark';
    try { theme = localStorage.getItem('ipals.theme') || (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch (_) {}
    NS.UI.applyTheme(theme);
    NS.UI.init();
    NS.Events.bind();
    NS.State.subscribe(NS.UI.render);
    NS.UI.render(NS.State.get());
    document.getElementById('app-version').textContent = 'v' + NS.VERSION;
    NS.Logger.info('IPA Localization Studio đã khởi động', { module: 'app', step: 'boot', details: { version: NS.VERSION } });
    NS.Logger.info('Xử lý hoàn toàn cục bộ trong trình duyệt, không upload dữ liệu', { module: 'app', step: 'boot' });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.IPAStudio = window.IPAStudio || {});
