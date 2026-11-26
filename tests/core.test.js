'use strict';
/* Se3ry core tests — run: node --test tests/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

test('normalize: kg unit price', () => {
  const n = C.normalize(30, 1, 'kg');
  assert.equal(n.dim, 'mass');
  assert.equal(n.displayUnit, 'kg');
  assert.equal(n.unitPrice, 30);
});

test('normalize: grams to per-kg price', () => {
  const n = C.normalize(10, 250, 'g');
  assert.equal(n.unitPrice, 40); // 10 EGP / 250g = 40 EGP/kg
});

test('normalize: ml to per-liter price', () => {
  const n = C.normalize(20, 500, 'ml');
  assert.equal(n.displayUnit, 'l');
  assert.equal(n.unitPrice, 40);
});

test('normalize: pieces', () => {
  const n = C.normalize(15, 3, 'piece');
  assert.equal(n.unitPrice, 5);
});

test('normalize: rejects bad input', () => {
  assert.equal(C.normalize(-5, 1, 'kg'), null);
  assert.equal(C.normalize(10, 0, 'kg'), null);
  assert.equal(C.normalize(10, 1, 'furlong'), null);
  assert.equal(C.normalize('abc', 1, 'kg'), null);
});

test('sameDimension across units', () => {
  assert.ok(C.sameDimension('g', 'kg'));
  assert.ok(C.sameDimension('ml', 'l'));
  assert.ok(!C.sameDimension('kg', 'l'));
  assert.ok(!C.sameDimension('piece', 'g'));
});

test('median and mean', () => {
  assert.equal(C.median([1, 2, 3]), 2);
  assert.equal(C.median([1, 2, 3, 4]), 2.5);
  assert.equal(C.median([]), null);
  assert.equal(C.mean([10, 20]), 15);
});

test('stats over a price history', () => {
  const entries = [
    { price: 40, qty: 1, unit: 'kg', date: '2026-01-01', store: 'A' },
    { price: 20, qty: 500, unit: 'g', date: '2026-02-01', store: 'B' }, // 40/kg
    { price: 30, qty: 1, unit: 'kg', date: '2026-03-01', store: 'A' },
    { price: 50, qty: 2, unit: 'kg', date: '2026-04-01', store: 'C' }    // 25/kg
  ];
  const st = C.stats(entries);
  assert.equal(st.count, 4);
  assert.equal(st.min, 25);
  assert.equal(st.max, 40);
  assert.equal(st.median, 35);
  assert.equal(st.latest, 25);
  assert.equal(st.displayUnit, 'kg');
});

test('evaluateDiscount: unknown with too little history', () => {
  const r = C.evaluateDiscount([{ price: 30, qty: 1, unit: 'kg', date: '2026-01-01' }], { price: 25, qty: 1, unit: 'kg' });
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.historyCount, 1);
});

const HISTORY = [
  { price: 30, qty: 1, unit: 'kg', date: '2026-01-01' },
  { price: 32, qty: 1, unit: 'kg', date: '2026-02-01' },
  { price: 34, qty: 1, unit: 'kg', date: '2026-03-01' },
  { price: 31, qty: 1, unit: 'kg', date: '2026-04-01' }
]; // median 31.5, min 30

test('evaluateDiscount: great at new low', () => {
  const r = C.evaluateDiscount(HISTORY, { price: 29, qty: 1, unit: 'kg' });
  assert.equal(r.verdict, 'great');
});

test('evaluateDiscount: good when clearly below median but above min', () => {
  const hist = [
    { price: 30, qty: 1, unit: 'kg', date: '2026-01-01' },
    { price: 34, qty: 1, unit: 'kg', date: '2026-02-01' },
    { price: 36, qty: 1, unit: 'kg', date: '2026-03-01' },
    { price: 35, qty: 1, unit: 'kg', date: '2026-04-01' }
  ]; // median 34.5, min 30
  const r = C.evaluateDiscount(hist, { price: 30.5, qty: 1, unit: 'kg' }, 0.10);
  assert.equal(r.verdict, 'good'); // 11.6% below median, above the 30 low
});

test('evaluateDiscount: fair near typical', () => {
  const r = C.evaluateDiscount(HISTORY, { price: 31, qty: 1, unit: 'kg' }, 0.10);
  assert.equal(r.verdict, 'fair'); // below median, within 10%
});

test('evaluateDiscount: fake above typical', () => {
  const r = C.evaluateDiscount(HISTORY, { price: 35, qty: 1, unit: 'kg' });
  assert.equal(r.verdict, 'fake');
  assert.ok(r.vsMedianPct > 0);
});

test('evaluateDiscount: mixed-unit history works', () => {
  const hist = HISTORY.concat([{ price: 16, qty: 500, unit: 'g', date: '2026-05-01' }]); // 32/kg
  const r = C.evaluateDiscount(hist, { price: 155, qty: 5, unit: 'kg' }); // 31/kg
  assert.equal(r.verdict, 'fair');
});

test('evaluateDiscount: invalid candidate', () => {
  const r = C.evaluateDiscount(HISTORY, { price: 0, qty: 1, unit: 'kg' });
  assert.equal(r.verdict, 'invalid');
});

test('detectShrinkflation: same price, smaller pack', () => {
  const entries = [
    { price: 10, qty: 40, unit: 'g', date: '2026-01-01' },
    { price: 10, qty: 36, unit: 'g', date: '2026-02-01' },
    { price: 10, qty: 32, unit: 'g', date: '2026-03-01' }
  ];
  const f = C.detectShrinkflation(entries);
  assert.equal(f.length, 2);
  assert.equal(Math.round(f[0].sizeDropPct), 10);
  assert.ok(f[0].unitPriceRisePct > 10);
});

test('detectShrinkflation: price drop matching size drop is not flagged', () => {
  const entries = [
    { price: 10, qty: 40, unit: 'g', date: '2026-01-01' },
    { price: 8, qty: 32, unit: 'g', date: '2026-02-01' } // same unit price
  ];
  const f = C.detectShrinkflation(entries);
  assert.equal(f.length, 0);
});

test('bestPricePerProduct picks cheapest store', () => {
  const products = [{ id: 'p1', name: 'Rice' }];
  const entries = [
    { productId: 'p1', price: 30, qty: 1, unit: 'kg', date: '2026-01-01', store: 'A' },
    { productId: 'p1', price: 28, qty: 1, unit: 'kg', date: '2026-02-01', store: 'B' },
    { productId: 'p1', price: 29, qty: 1, unit: 'kg', date: '2026-03-01', store: 'A' }
  ];
  const best = C.bestPricePerProduct(products, entries);
  assert.equal(best.length, 1);
  assert.equal(best[0].bestStore, 'B');
  assert.equal(best[0].bestUnitPrice, 28);
});

test('toCSV escapes commas and quotes', () => {
  const products = [{ id: 'p1', name: 'Rice, premium "basmati"' }];
  const entries = [{ productId: 'p1', store: 'A', date: '2026-01-01', price: 30, qty: 1, unit: 'kg', onSale: true }];
  const csv = C.toCSV(entries, products);
  assert.ok(csv.indexOf('"Rice, premium ""basmati"""') >= 0);
  assert.ok(csv.split('\n')[1].endsWith(',1'));
});

test('mergeSettings: defaults and overrides', () => {
  const s = C.mergeSettings({ appName: 'Souq Mart', primary: '#123456', saleThreshold: 99 });
  assert.equal(s.appName, 'Souq Mart');
  assert.equal(s.primary, '#123456');
  assert.equal(s.locale, 'ar');        // default preserved
  assert.equal(s.saleThreshold, 0.10); // out-of-range rejected
});

test('uid is unique-ish', () => {
  const a = C.uid('p'), b = C.uid('p');
  assert.notEqual(a, b);
  assert.ok(a.startsWith('p-'));
});
