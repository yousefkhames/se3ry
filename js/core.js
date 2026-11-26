/* Se3ry — core logic. Pure functions, no DOM, no localStorage.
   Usable in the browser (window.Se3ryCore) and in Node (module.exports) for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Se3ryCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Units ---------- */
  // Every unit normalizes to a base unit of its dimension.
  var UNITS = {
    g:     { dim: 'mass',   toBase: 1 },
    kg:    { dim: 'mass',   toBase: 1000 },
    ml:    { dim: 'volume', toBase: 1 },
    l:     { dim: 'volume', toBase: 1000 },
    piece: { dim: 'count',  toBase: 1 },
    pack:  { dim: 'count',  toBase: 1 }
  };
  // What unit price is expressed in, per dimension.
  var DISPLAY_UNIT = { mass: 'kg', volume: 'l', count: 'piece' };

  function isUnit(u) { return Object.prototype.hasOwnProperty.call(UNITS, u); }
  function dimension(u) { return isUnit(u) ? UNITS[u].dim : null; }

  // Normalize a {price, qty, unit} purchase into unit price per display unit.
  // Returns null when the entry is invalid.
  function normalize(price, qty, unit) {
    price = Number(price); qty = Number(qty);
    if (!isFinite(price) || !isFinite(qty) || price <= 0 || qty <= 0 || !isUnit(unit)) return null;
    var dim = UNITS[unit].dim;
    var baseQty = qty * UNITS[unit].toBase;              // in g / ml / piece
    var display = DISPLAY_UNIT[dim];
    var displayQty = baseQty / UNITS[display].toBase;    // in kg / l / piece
    return {
      dim: dim,
      baseQty: baseQty,
      displayUnit: display,
      unitPrice: displayQty > 0 ? price / displayQty : null
    };
  }

  function sameDimension(aUnit, bUnit) {
    return isUnit(aUnit) && isUnit(bUnit) && UNITS[aUnit].dim === UNITS[bUnit].dim;
  }

  /* ---------- Statistics ---------- */
  function sortedNums(xs) {
    return xs.filter(function (x) { return isFinite(x); }).slice().sort(function (a, b) { return a - b; });
  }
  function median(xs) {
    var s = sortedNums(xs);
    if (!s.length) return null;
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mean(xs) {
    var s = sortedNums(xs);
    if (!s.length) return null;
    return s.reduce(function (a, b) { return a + b; }, 0) / s.length;
  }

  // entries: [{price, qty, unit, date}] for ONE product (any store, or pre-filtered).
  // Returns unit-price statistics in the product's display unit, or null if unusable.
  function unitPriceSeries(entries) {
    var out = [];
    (entries || []).forEach(function (e) {
      var n = normalize(e.price, e.qty, e.unit);
      if (n) out.push({ date: e.date || '', store: e.store || '', unitPrice: n.unitPrice, dim: n.dim, raw: e });
    });
    out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return out;
  }

  function stats(entries) {
    var series = unitPriceSeries(entries);
    if (!series.length) return null;
    var prices = series.map(function (s) { return s.unitPrice; });
    return {
      count: series.length,
      min: Math.min.apply(null, prices),
      max: Math.max.apply(null, prices),
      median: median(prices),
      mean: mean(prices),
      latest: series[series.length - 1].unitPrice,
      latestDate: series[series.length - 1].date,
      displayUnit: series[0].dim === 'mass' ? 'kg' : series[0].dim === 'volume' ? 'l' : 'piece',
      series: series
    };
  }

  /* ---------- Real-discount detector ---------- */
  // Compare a candidate shelf price against recorded history for the product.
  // candidate: {price, qty, unit}; history: prior entries for the same product.
  // threshold: fraction below median that counts as a genuinely good price (default 0.10).
  function evaluateDiscount(history, candidate, threshold) {
    if (threshold == null) threshold = 0.10;
    var cand = normalize(candidate.price, candidate.qty, candidate.unit);
    if (!cand) return { verdict: 'invalid', reason: 'bad-input' };
    var usable = (history || []).filter(function (e) { return sameDimension(e.unit, candidate.unit); });
    var st = stats(usable);
    if (!st || st.count < 3) {
      return { verdict: 'unknown', reason: 'not-enough-history', historyCount: st ? st.count : 0, needed: 3, candidateUnitPrice: cand.unitPrice, displayUnit: cand.displayUnit };
    }
    var p = cand.unitPrice;
    var vsMedian = (p - st.median) / st.median;         // negative = cheaper than typical
    var vsMin = (p - st.min) / st.min;
    var result = {
      candidateUnitPrice: p,
      displayUnit: st.displayUnit,
      median: st.median, min: st.min, mean: st.mean, max: st.max,
      historyCount: st.count,
      vsMedianPct: vsMedian * 100,
      vsBestPct: vsMin * 100
    };
    if (p <= st.min * 1.001) {
      result.verdict = 'great';                        // at or below the best price ever seen
      result.reason = 'at-or-below-historical-low';
    } else if (vsMedian <= -Math.abs(threshold)) {
      result.verdict = 'good';                         // clearly cheaper than typical
      result.reason = 'below-typical-price';
    } else if (p <= st.median) {
      result.verdict = 'fair';                         // a bit cheaper than typical, nothing special
      result.reason = 'near-typical-price';
    } else {
      result.verdict = 'fake';                         // marketed as a deal but costs more than usual
      result.reason = 'above-typical-price';
    }
    return result;
  }

  /* ---------- Shrinkflation detector ---------- */
  // Find cases where price stayed ~same (or rose) while pack size shrank.
  // Returns [{before, after, sizeDropPct, priceChangePct, unitPriceRisePct}].
  function detectShrinkflation(entries) {
    var series = unitPriceSeries(entries);
    var findings = [];
    for (var i = 1; i < series.length; i++) {
      var prev = series[i - 1].raw, cur = series[i].raw;
      if (!sameDimension(prev.unit, cur.unit)) continue;
      var pn = normalize(prev.price, prev.qty, prev.unit);
      var cn = normalize(cur.price, cur.qty, cur.unit);
      if (!pn || !cn) continue;
      var sizeDrop = (pn.baseQty - cn.baseQty) / pn.baseQty;
      var priceChange = pn.baseQty && prev.price > 0 ? (cur.price - prev.price) / prev.price : 0;
      if (sizeDrop >= 0.05 && priceChange > -0.03) {   // size down 5%+, price not meaningfully down
        findings.push({
          beforeDate: prev.date, afterDate: cur.date,
          beforeQty: prev.qty, beforeUnit: prev.unit, beforePrice: prev.price,
          afterQty: cur.qty, afterUnit: cur.unit, afterPrice: cur.price,
          sizeDropPct: sizeDrop * 100,
          priceChangePct: priceChange * 100,
          unitPriceRisePct: ((cn.unitPrice - pn.unitPrice) / pn.unitPrice) * 100
        });
      }
    }
    return findings;
  }

  /* ---------- Store comparison ---------- */
  // For each product: the store with the cheapest most-recent unit price.
  function bestPricePerProduct(products, entries) {
    var byProduct = {};
    (entries || []).forEach(function (e) {
      if (!byProduct[e.productId]) byProduct[e.productId] = [];
      byProduct[e.productId].push(e);
    });
    var out = [];
    Object.keys(byProduct).forEach(function (pid) {
      var st = stats(byProduct[pid]);
      if (!st) return;
      var best = null;
      st.series.forEach(function (s) {
        if (!best || s.unitPrice < best.unitPrice) best = s;
      });
      var prod = null;
      (products || []).forEach(function (p) { if (p.id === pid) prod = p; });
      out.push({
        productId: pid,
        productName: prod ? prod.name : pid,
        bestStore: best.store,
        bestUnitPrice: best.unitPrice,
        bestDate: best.date,
        displayUnit: st.displayUnit,
        latestUnitPrice: st.latest,
        historyCount: st.count
      });
    });
    out.sort(function (a, b) { return a.productName < b.productName ? -1 : 1; });
    return out;
  }

  /* ---------- CSV ---------- */
  function toCSV(entries, products) {
    var nameOf = {};
    (products || []).forEach(function (p) { nameOf[p.id] = p.name; });
    var rows = [['product', 'store', 'date', 'price', 'qty', 'unit', 'on_sale']];
    (entries || []).forEach(function (e) {
      rows.push([nameOf[e.productId] || e.productId, e.store || '', e.date || '', e.price, e.qty, e.unit, e.onSale ? '1' : '0']);
    });
    return rows.map(function (r) {
      return r.map(function (c) {
        c = String(c == null ? '' : c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\n');
  }

  /* ---------- Settings (white-label) ---------- */
  var DEFAULT_SETTINGS = {
    appName: 'Se3ry',
    appNameAr: 'سعري',
    tagline: 'Supermarket price memory',
    taglineAr: 'ذاكرة أسعار السوبرماركت',
    logoEmoji: '🏷️',
    primary: '#0e9f6e',
    accent: '#f59e0b',
    currency: 'EGP',
    locale: 'ar',
    theme: 'light',
    saleThreshold: 0.10
  };

  function mergeSettings(saved) {
    var s = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (k) { s[k] = DEFAULT_SETTINGS[k]; });
    if (saved && typeof saved === 'object') {
      Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
        if (saved[k] !== undefined && saved[k] !== null && saved[k] !== '') s[k] = saved[k];
      });
    }
    ['appName','appNameAr','tagline','taglineAr','logoEmoji','currency'].forEach(function (k) { s[k] = String(s[k]).slice(0, 60); });
    ['primary','accent'].forEach(function (k) { if (!/^#[0-9a-fA-F]{3,8}$/.test(String(s[k]))) s[k] = DEFAULT_SETTINGS[k]; });
    if (s.locale !== 'en' && s.locale !== 'ar') s.locale = 'ar';
    if (s.theme !== 'light' && s.theme !== 'dark') s.theme = 'light';
    s.saleThreshold = Number(s.saleThreshold);
    if (!isFinite(Number(s.saleThreshold)) || s.saleThreshold < 0 || s.saleThreshold > 0.9) s.saleThreshold = 0.10;
    return s;
  }

  /* Number from user text: Arabic-Indic digits, decimal comma or Arabic decimal mark. NaN when not a number. */
  function toNum(v) {
    if (typeof v === 'number') return v;
    var t = String(v == null ? '' : v).trim()
      .replace(/[\u0660-\u0669]/g, function (c) { return c.charCodeAt(0) - 0x660; })
      .replace(/[\u06F0-\u06F9]/g, function (c) { return c.charCodeAt(0) - 0x6F0; })
      .replace(/\u066B/g, '.').replace(/[\u066C\s]/g, '').replace(',', '.');
    return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : NaN;
  }

  /* Rebuild products and entries from untrusted data; drops anything invalid. */
  function sanitizeData(d) {
    var str = function (v, n) { return String(v == null ? '' : v).slice(0, n); };
    var ids = {}, products = [];
    (Array.isArray(d.products) ? d.products : []).slice(0, 5000).forEach(function (p) {
      if (!p || typeof p !== 'object' || !p.id || !p.name || ids[String(p.id)]) return;
      ids[String(p.id)] = 1;
      products.push({ id: str(p.id, 80), name: str(p.name, 120), brand: str(p.brand, 80), category: str(p.category, 80) });
    });
    var entries = [];
    (Array.isArray(d.entries) ? d.entries : []).slice(0, 50000).forEach(function (e) {
      if (!e || typeof e !== 'object' || !ids[String(e.productId)]) return;
      var price = toNum(e.price), qty = toNum(e.qty);
      if (!normalize(price, qty, e.unit)) return;
      var date = /^\d{4}-\d{2}-\d{2}/.test(String(e.date)) ? String(e.date).slice(0, 10) : new Date().toISOString().slice(0, 10);
      entries.push({ id: str(e.id || uid('e'), 80), productId: str(e.productId, 80), store: str(e.store, 80), date: date, price: price, qty: qty, unit: e.unit, onSale: e.onSale === true });
    });
    return { products: products, entries: entries };
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  return {
    UNITS: UNITS,
    DISPLAY_UNIT: DISPLAY_UNIT,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    isUnit: isUnit,
    dimension: dimension,
    normalize: normalize,
    toNum: toNum,
    sanitizeData: sanitizeData,
    sameDimension: sameDimension,
    median: median,
    mean: mean,
    unitPriceSeries: unitPriceSeries,
    stats: stats,
    evaluateDiscount: evaluateDiscount,
    detectShrinkflation: detectShrinkflation,
    bestPricePerProduct: bestPricePerProduct,
    toCSV: toCSV,
    mergeSettings: mergeSettings,
    uid: uid
  };
});
