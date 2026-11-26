/* Se3ry — UI layer: localStorage store, routing, rendering. */
(function () {
  'use strict';
  var C = window.Se3ryCore;
  var LS_KEY = 'se3ry.data.v1';

  /* ---------- Store ---------- */
  function blank() { return { products: [], entries: [], settings: C.mergeSettings(null) }; }
  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return blank();
      var d = JSON.parse(raw);
      if (!d || !Array.isArray(d.products) || !Array.isArray(d.entries)) return blank();
      d.settings = C.mergeSettings(d.settings);
      return d;
    } catch (e) { return blank(); }
  }
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(DB)); }
  var DB = load();

  /* ---------- Helpers ---------- */
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function t(key, vars) { return T(key, vars); }
  var T = null;

  function fmtMoney(x) {
    if (!isFinite(x)) return '—';
    var v = Math.round(x * 100) / 100;
    return v.toLocaleString(DB.settings.locale === 'ar' ? 'ar-EG' : 'en-US') + ' ' + DB.settings.currency;
  }
  function fmtUnit(u, unitPrice) {
    var key = u === 'kg' ? 'per.kg' : u === 'l' ? 'per.l' : 'per.piece';
    var v = Math.round(unitPrice * 100) / 100;
    return v.toLocaleString(DB.settings.locale === 'ar' ? 'ar-EG' : 'en-US') + ' ' + DB.settings.currency + t(key);
  }
  function pct(x) {
    var v = Math.round(Math.abs(x) * 10) / 10;
    return (x > 0 ? '+' : x < 0 ? '−' : '') + v.toLocaleString(DB.settings.locale === 'ar' ? 'ar-EG' : 'en-US') + '%';
  }
  function productById(id) {
    for (var i = 0; i < DB.products.length; i++) if (DB.products[i].id === id) return DB.products[i];
    return null;
  }
  function entriesFor(pid) {
    return DB.entries.filter(function (e) { return e.productId === pid; });
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
  function confirmDialog(msg) { return window.confirm(msg); }

  /* ---------- Theme / branding ---------- */
  function applySettings() {
    var s = DB.settings;
    document.documentElement.style.setProperty('--primary', s.primary);
    document.documentElement.style.setProperty('--accent', s.accent);
    document.documentElement.setAttribute('data-theme', s.theme);
    document.documentElement.lang = s.locale;
    document.documentElement.dir = s.locale === 'ar' ? 'rtl' : 'ltr';
    T = window.Se3ryI18n.makeT(s.locale);
    var name = s.locale === 'ar' ? s.appNameAr : s.appName;
    var tag = s.locale === 'ar' ? s.taglineAr : s.tagline;
    $('#brandName').textContent = name;
    $('#brandTag').textContent = tag;
    $('#brandLogo').textContent = s.logoEmoji;
    document.title = name + ' — ' + tag;
    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  }

  /* ---------- Routing ---------- */
  var VIEWS = ['home', 'add', 'products', 'check', 'settings'];
  function go(view) {
    if (VIEWS.indexOf(view) < 0) view = 'home';
    VIEWS.forEach(function (v) {
      $('#view-' + v).hidden = v !== view;
      $('#nav-' + v).classList.toggle('active', v === view);
    });
    location.hash = view;
    render(view);
    window.scrollTo(0, 0);
  }

  function render(view) {
    if (view === 'home') renderHome();
    else if (view === 'add') renderAdd();
    else if (view === 'products') renderProducts();
    else if (view === 'check') renderCheck();
    else if (view === 'settings') renderSettings();
  }

  /* ---------- Home ---------- */
  function renderHome() {
    var stores = {};
    DB.entries.forEach(function (e) { if (e.store) stores[e.store] = 1; });
    $('#statProducts').textContent = DB.products.length;
    $('#statEntries').textContent = DB.entries.length;
    $('#statStores').textContent = Object.keys(stores).length;

    var empty = DB.entries.length === 0;
    $('#homeEmpty').hidden = !empty;
    $('#homeContent').hidden = empty;
    if (empty) return;

    // Cheapest right now: products whose latest unit price is their historical min.
    var best = [];
    var alerts = [];
    DB.products.forEach(function (p) {
      var st = C.stats(entriesFor(p.id));
      if (!st) return;
      if (st.count >= 2 && st.latest <= st.min * 1.001) {
        best.push({ p: p, st: st });
      }
      // fake-sale alert: latest entry flagged on sale but above median
      var entries = entriesFor(p.id).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var last = entries[entries.length - 1];
      if (last && last.onSale && st.count >= 3 && st.latest > st.median) {
        alerts.push({ type: 'fakeSale', p: p, st: st });
      }
      C.detectShrinkflation(entries).forEach(function (f) { alerts.push({ type: 'shrink', p: p, f: f }); });
    });

    var bh = $('#homeBest'); bh.innerHTML = '';
    if (!best.length) bh.innerHTML = '<li class="muted">' + esc(t('home.empty')) + '</li>';
    best.slice(0, 5).forEach(function (b) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="deal-dot good"></span><strong>' + esc(b.p.name) + '</strong> ' +
        '<span>' + esc(fmtUnit(b.st.displayUnit, b.st.latest)) + '</span>';
      bh.appendChild(li);
    });

    var ah = $('#homeAlerts'); ah.innerHTML = '';
    if (!alerts.length) ah.innerHTML = '<li class="muted">—</li>';
    alerts.slice(0, 6).forEach(function (a) {
      var li = document.createElement('li');
      if (a.type === 'fakeSale') {
        li.innerHTML = '<span class="deal-dot bad"></span><strong>' + esc(a.p.name) + '</strong>: ' + esc(t('home.fakeSale'));
      } else {
        li.innerHTML = '<span class="deal-dot warn"></span><strong>' + esc(a.p.name) + '</strong>: ' + esc(t('products.shrinkWarn')) +
          ' (−' + Math.round(a.f.sizeDropPct) + '%)' ;
      }
      ah.appendChild(li);
    });
  }

  /* ---------- Add ---------- */
  function fillProductSelect(sel, includeNew) {
    sel.innerHTML = '';
    DB.products.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      sel.appendChild(o);
    });
    if (includeNew) {
      var o = document.createElement('option');
      o.value = '__new__'; o.textContent = t('add.productNew');
      sel.insertBefore(o, sel.firstChild);
      sel.value = '__new__';
    }
  }

  function renderAdd() {
    fillProductSelect($('#addProduct'), true);
    toggleNewProduct();
    $('#addDate').value = todayISO();
    // store autocomplete from previously used stores
    var dl = $('#storeList'); dl.innerHTML = '';
    var seen = {};
    DB.entries.forEach(function (e) {
      if (e.store && !seen[e.store]) {
        seen[e.store] = 1;
        var o = document.createElement('option');
        o.value = e.store; dl.appendChild(o);
      }
    });
    updateAddUnitPrice();
  }
  function toggleNewProduct() {
    var isNew = $('#addProduct').value === '__new__';
    $('#newProductFields').hidden = !isNew;
  }
  function updateAddUnitPrice() {
    var n = C.normalize($('#addPrice').value, $('#addQty').value, $('#addUnit').value);
    $('#addUnitPrice').textContent = n ? fmtUnit(n.displayUnit, n.unitPrice) : '—';
  }

  function saveEntry() {
    var pid = $('#addProduct').value;
    if (pid === '__new__') {
      var name = $('#addName').value.trim();
      if (!name) { toast(t('check.verdict.invalid')); return; }
      // reuse an existing product with the same name (case-insensitive) instead of duplicating
      var lname = name.toLowerCase();
      var existing = null;
      DB.products.forEach(function (p) { if (p.name.toLowerCase() === lname) existing = p; });
      if (existing) {
        pid = existing.id;
      } else {
        pid = C.uid('p');
        DB.products.push({ id: pid, name: name, brand: $('#addBrand').value.trim(), category: $('#addCategory').value.trim() });
      }
    }
    var price = Number($('#addPrice').value), qty = Number($('#addQty').value), unit = $('#addUnit').value;
    if (!C.normalize(price, qty, unit)) { toast(t('check.verdict.invalid')); return; }
    DB.entries.push({
      id: C.uid('e'), productId: pid,
      store: $('#addStore').value.trim(),
      date: $('#addDate').value || todayISO(),
      price: price, qty: qty, unit: unit,
      onSale: $('#addOnSale').checked
    });
    save();
    toast(t('add.saved'));
    $('#addPrice').value = ''; $('#addQty').value = ''; $('#addOnSale').checked = false;
    updateAddUnitPrice();
  }

  /* ---------- Products ---------- */
  var openProduct = null;
  function renderProducts() {
    var q = ($('#productSearch').value || '').toLowerCase();
    var list = $('#productList');
    list.innerHTML = '';
    var prods = DB.products.filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) >= 0; });
    if (!prods.length) { list.innerHTML = '<p class="muted">' + esc(t('products.noData')) + '</p>'; return; }
    prods.forEach(function (p) {
      var st = C.stats(entriesFor(p.id));
      var card = document.createElement('div');
      card.className = 'card product-card';
      var head = '<div class="product-head"><div><h3>' + esc(p.name) + '</h3>' +
        (p.brand ? '<span class="muted">' + esc(p.brand) + '</span>' : '') + '</div>' +
        '<button class="icon-btn" data-del="' + p.id + '" title="' + esc(t('products.delete')) + '">🗑</button></div>';
      var body = '';
      if (st) {
        body += '<div class="stat-row">' +
          '<div><span class="muted">' + esc(t('products.latest')) + '</span><b>' + esc(fmtUnit(st.displayUnit, st.latest)) + '</b></div>' +
          '<div><span class="muted">' + esc(t('products.median')) + '</span><b>' + esc(fmtUnit(st.displayUnit, st.median)) + '</b></div>' +
          '<div><span class="muted">' + esc(t('products.best')) + '</span><b>' + esc(fmtUnit(st.displayUnit, st.min)) + '</b></div>' +
          '</div>';
        body += chartSVG(st.series, st);
        var shrink = C.detectShrinkflation(entriesFor(p.id));
        if (shrink.length) {
          body += '<p class="shrink-warn">⚠ ' + esc(t('products.shrinkWarn')) + '</p>';
        }
        // by store
        var byStore = {};
        st.series.forEach(function (s) {
          var k = s.store || '—';
          if (!byStore[k] || s.unitPrice < byStore[k]) byStore[k] = s.unitPrice;
        });
        body += '<div class="store-chips">';
        Object.keys(byStore).forEach(function (k) {
          body += '<span class="chip">' + esc(k) + ': ' + esc(fmtUnit(st.displayUnit, byStore[k])) + '</span>';
        });
        body += '</div>';
        body += '<p class="muted">' + st.count + ' ' + esc(t('products.entries')) + '</p>';
        // recent entries with per-entry delete
        body += '<ul class="entry-list">';
        entriesFor(p.id).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 5).forEach(function (e) {
          body += '<li><span>' + esc(e.date) + ' · ' + esc(e.store || '—') + ' · ' + esc(fmtMoney(e.price)) +
            ' / ' + esc(String(e.qty)) + ' ' + esc(t('unit.' + e.unit)) + (e.onSale ? ' 🏷' : '') + '</span>' +
            '<button class="icon-btn" data-delentry="' + e.id + '" title="✕">✕</button></li>';
        });
        body += '</ul>';
      } else {
        body += '<p class="muted">' + esc(t('products.noData')) + '</p>';
      }
      card.innerHTML = head + body;
      list.appendChild(card);
    });
    $$('#productList [data-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!confirmDialog(t('common.confirmDeleteProduct'))) return;
        var id = btn.getAttribute('data-del');
        DB.products = DB.products.filter(function (p) { return p.id !== id; });
        DB.entries = DB.entries.filter(function (e) { return e.productId !== id; });
        save(); renderProducts();
      });
    });
    $$('#productList [data-delentry]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-delentry');
        DB.entries = DB.entries.filter(function (e) { return e.id !== id; });
        save(); renderProducts();
      });
    });
  }

  // Minimal dependency-free SVG line chart of unit price over time.
  function chartSVG(series, st) {
    if (series.length < 2) return '';
    var W = 320, H = 90, P = 10;
    var xs = series.map(function (s, i) { return i; });
    var ys = series.map(function (s) { return s.unitPrice; });
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    if (maxY === minY) { maxY = minY + 1; }
    var pts = xs.map(function (x, i) {
      var px = P + (x / (xs.length - 1)) * (W - 2 * P);
      var py = H - P - ((ys[i] - minY) / (maxY - minY)) * (H - 2 * P);
      return px.toFixed(1) + ',' + py.toFixed(1);
    });
    var dots = pts.map(function (pt) {
      var xy = pt.split(',');
      return '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="3" fill="var(--primary)"/>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('products.history')) + '">' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--primary)" stroke-width="2"/>' + dots + '</svg>';
  }

  /* ---------- Deal check ---------- */
  function renderCheck() {
    fillProductSelect($('#checkProduct'), false);
    $('#checkResult').innerHTML = '';
    $('#checkDate').value = todayISO();
  }
  function runCheck() {
    var pid = $('#checkProduct').value;
    var resBox = $('#checkResult');
    if (!pid) { resBox.innerHTML = ''; return; }
    var cand = { price: Number($('#checkPrice').value), qty: Number($('#checkQty').value), unit: $('#checkUnit').value };
    var r = C.evaluateDiscount(entriesFor(pid), cand, Number(DB.settings.saleThreshold));
    var cls = { great: 'good', good: 'good', fair: 'warn', fake: 'bad', unknown: 'muted', invalid: 'bad' }[r.verdict];
    var html = '<div class="verdict ' + cls + '"><div class="verdict-label">' + esc(t('check.verdict.' + r.verdict, { n: r.needed || 3 })) + '</div>';
    if (r.candidateUnitPrice != null && r.median != null) {
      html += '<div class="verdict-stats">' +
        '<span>' + esc(fmtUnit(r.displayUnit, r.candidateUnitPrice)) + '</span>' +
        '<span>' + esc(t('check.vsTypical')) + ': <b>' + esc(pct(r.vsMedianPct)) + '</b></span>' +
        '<span>' + esc(t('check.vsBest')) + ': <b>' + esc(pct(r.vsBestPct)) + '</b></span>' +
        '</div><p class="muted">' + esc(t('check.history', { n: r.historyCount })) + '</p>';
    } else if (r.candidateUnitPrice != null) {
      html += '<div class="verdict-stats"><span>' + esc(fmtUnit(r.displayUnit, r.candidateUnitPrice)) + '</span></div>';
    }
    html += '</div>';
    resBox.innerHTML = html;
    // offer to record the checked price as a real entry
    var recBtn = $('#checkRecord');
    if (r.candidateUnitPrice != null) {
      recBtn.hidden = false;
      recBtn.onclick = function () {
        DB.entries.push({
          id: C.uid('e'), productId: pid,
          store: $('#checkStore').value.trim(),
          date: $('#checkDate').value || todayISO(),
          price: cand.price, qty: cand.qty, unit: cand.unit, onSale: true
        });
        save(); toast(t('add.saved'));
        recBtn.hidden = true;
      };
    } else {
      recBtn.hidden = true;
    }
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    var s = DB.settings;
    $('#setAppName').value = s.appName; $('#setAppNameAr').value = s.appNameAr;
    $('#setTagline').value = s.tagline; $('#setTaglineAr').value = s.taglineAr;
    $('#setLogo').value = s.logoEmoji;
    $('#setPrimary').value = s.primary; $('#setAccent').value = s.accent;
    $('#setCurrency').value = s.currency;
    $('#setLocale').value = s.locale; $('#setTheme').value = s.theme;
    $('#setThreshold').value = Math.round(Number(s.saleThreshold) * 100);
  }
  function saveSettings() {
    var s = DB.settings;
    s.appName = $('#setAppName').value.trim() || 'Se3ry';
    s.appNameAr = $('#setAppNameAr').value.trim() || 'سعري';
    s.tagline = $('#setTagline').value.trim(); s.taglineAr = $('#setTaglineAr').value.trim();
    s.logoEmoji = $('#setLogo').value.trim() || '🏷️';
    s.primary = $('#setPrimary').value; s.accent = $('#setAccent').value;
    s.currency = $('#setCurrency').value.trim().toUpperCase() || 'EGP';
    s.locale = $('#setLocale').value; s.theme = $('#setTheme').value;
    s.saleThreshold = Math.min(90, Math.max(0, Number($('#setThreshold').value) || 10)) / 100;
    save(); applySettings(); renderSettings();
    toast(t('settings.saved'));
  }
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  function readFile(input, cb) {
    var f = input.files && input.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { cb(String(r.result)); input.value = ''; };
    r.readAsText(f);
  }

  /* ---------- Sample data ---------- */
  function loadSample() {
    var mk = function (name, brand, cat) {
      var id = C.uid('p');
      DB.products.push({ id: id, name: name, brand: brand, category: cat });
      return id;
    };
    var rice = mk('Rice 1kg', 'El Doha', 'Pantry');
    var milk = mk('Milk', 'Juhayna', 'Dairy');
    var oil = mk('Sunflower oil', 'Crystal', 'Pantry');
    var choc = mk('Chocolate bar', 'Corona', 'Snacks');
    function e(pid, store, date, price, qty, unit, sale) {
      DB.entries.push({ id: C.uid('e'), productId: pid, store: store, date: date, price: price, qty: qty, unit: unit, onSale: !!sale });
    }
    e(rice, 'Carrefour', '2026-09-02', 32, 1, 'kg');
    e(rice, 'Seoudi', '2026-09-20', 34, 1, 'kg');
    e(rice, 'Carrefour', '2026-10-10', 30, 1, 'kg');
    e(rice, 'Kazyon', '2026-11-01', 28.5, 1, 'kg');
    e(rice, 'Carrefour', '2026-11-20', 27.9, 1, 'kg');
    e(milk, 'Seoudi', '2026-09-05', 38, 1, 'l');
    e(milk, 'Carrefour', '2026-09-25', 37, 1, 'l');
    e(milk, 'Seoudi', '2026-10-15', 39, 1, 'l');
    e(milk, 'Carrefour', '2026-11-18', 42, 1, 'l', true);   // fake sale
    e(oil, 'Kazyon', '2026-09-01', 95, 1, 'l');
    e(oil, 'Carrefour', '2026-10-01', 92, 1, 'l');
    e(oil, 'Seoudi', '2026-11-05', 90, 800, 'ml');          // smaller pack
    e(choc, 'Kiosk', '2026-08-15', 10, 40, 'g');
    e(choc, 'Kiosk', '2026-09-15', 10, 36, 'g');            // shrinkflation
    e(choc, 'Kiosk', '2026-10-15', 10, 32, 'g');            // shrinkflation again
    e(choc, 'Carrefour', '2026-11-10', 12, 40, 'g', true);
    save();
    render('home');
    toast(t('settings.imported'));
  }

  /* ---------- Wire up ---------- */
  function init() {
    applySettings();
    VIEWS.forEach(function (v) {
      $('#nav-' + v).addEventListener('click', function () { go(v); });
    });
    $('#addProduct').addEventListener('change', toggleNewProduct);
    ['addPrice', 'addQty', 'addUnit'].forEach(function (id) { $('#' + id).addEventListener('input', updateAddUnitPrice); });
    $('#addSave').addEventListener('click', saveEntry);
    $('#productSearch').addEventListener('input', renderProducts);
    $('#checkRun').addEventListener('click', runCheck);
    $('#setSave').addEventListener('click', saveSettings);
    $('#setReset').addEventListener('click', function () {
      DB.settings = C.mergeSettings(null); save(); applySettings(); renderSettings(); toast(t('settings.saved'));
    });
    $('#loadSample').addEventListener('click', loadSample);
    $('#clearAll').addEventListener('click', function () {
      if (!confirmDialog(t('common.confirmErase'))) return;
      DB = blank(); save(); applySettings(); render('home');
    });
    $('#exportBrand').addEventListener('click', function () {
      download('se3ry-branding.json', JSON.stringify({ kind: 'se3ry-branding', version: 1, settings: DB.settings }, null, 2));
    });
    $('#importBrand').addEventListener('change', function (ev) {
      readFile(ev.target, function (text) {
        try {
          var d = JSON.parse(text);
          if (d.kind !== 'se3ry-branding' || !d.settings) throw new Error('bad');
          DB.settings = C.mergeSettings(d.settings);
          save(); applySettings(); renderSettings(); toast(t('settings.imported'));
        } catch (e) { toast(t('settings.importFailed')); }
      });
    });
    $('#exportData').addEventListener('click', function () {
      download('se3ry-backup.json', JSON.stringify({ kind: 'se3ry-backup', version: 1, products: DB.products, entries: DB.entries, settings: DB.settings }, null, 2));
    });
    $('#exportCSV').addEventListener('click', function () {
      download('se3ry-prices.csv', C.toCSV(DB.entries, DB.products), 'text/csv');
    });
    $('#importData').addEventListener('change', function (ev) {
      readFile(ev.target, function (text) {
        try {
          var d = JSON.parse(text);
          if (d.kind !== 'se3ry-backup' || !Array.isArray(d.products) || !Array.isArray(d.entries)) throw new Error('bad');
          DB.products = d.products; DB.entries = d.entries;
          DB.settings = C.mergeSettings(d.settings);
          save(); applySettings(); render('home'); toast(t('settings.imported'));
        } catch (e) { toast(t('settings.importFailed')); }
      });
    });
    var start = (location.hash || '').replace('#', '');
    go(VIEWS.indexOf(start) >= 0 ? start : 'home');
    window.addEventListener('hashchange', function () {
      var v = (location.hash || '').replace('#', '');
      if (VIEWS.indexOf(v) >= 0) go(v);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
