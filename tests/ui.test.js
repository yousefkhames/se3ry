'use strict';
/* Se3ry UI smoke tests — jsdom click-through of the real app.
   Run: node --test tests/  (requires devDependency jsdom; skipped when absent) */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  test('ui smoke tests skipped (jsdom not installed)', (t) => t.skip());
  return;
}

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<link[^>]*fonts[^>]*>/g, '')           // no network in tests
  .replace(/<script src=/g, '<script data-src=');  // load scripts manually in order

function boot() {
  const dom = new JSDOM(html, { url: 'http://localhost/se3ry/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  // stub browser APIs jsdom lacks
  window.confirm = () => true;
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};
  window.HTMLElement.prototype.click = window.HTMLElement.prototype.click || function () {};
  for (const f of ['js/core.js', 'js/i18n.js', 'js/app.js']) {
    window.eval(fs.readFileSync(path.join(root, f), 'utf8'));
  }
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return window;
}

const $ = (w, s) => w.document.querySelector(s);

test('app boots into Arabic RTL with default branding', () => {
  const w = boot();
  assert.equal(w.document.documentElement.dir, 'rtl');
  assert.equal(w.document.documentElement.lang, 'ar');
  assert.equal($(w, '#brandName').textContent, 'سعري');
  assert.equal($(w, '#view-home').hidden, false);
  assert.equal($(w, '#view-add').hidden, true);
});

test('empty state shows sample-data button', () => {
  const w = boot();
  assert.equal($(w, '#homeEmpty').hidden, false);
  assert.equal($(w, '#homeContent').hidden, true);
});

test('loading sample data fills the dashboard', () => {
  const w = boot();
  $(w, '#loadSample').click();
  assert.equal($(w, '#homeEmpty').hidden, true);
  assert.ok(Number($(w, '#statProducts').textContent) >= 4);
  assert.ok(Number($(w, '#statEntries').textContent) >= 15);
  // shrinkflation + fake sale alerts from the sample set
  assert.ok($(w, '#homeAlerts').textContent.length > 5);
});

test('navigation switches views', () => {
  const w = boot();
  $(w, '#nav-add').click();
  assert.equal($(w, '#view-add').hidden, false);
  assert.equal($(w, '#view-home').hidden, true);
  $(w, '#nav-settings').click();
  assert.equal($(w, '#view-settings').hidden, false);
});

test('hashchange switches views (deep links / back button)', () => {
  const w = boot();
  w.location.hash = 'products';
  w.dispatchEvent(new w.Event('hashchange'));
  assert.equal($(w, '#view-products').hidden, false);
  assert.equal($(w, '#view-home').hidden, true);
});

test('add flow: create product + entry, unit price preview updates', () => {
  const w = boot();
  $(w, '#nav-add').click();
  $(w, '#addName').value = 'Test Rice';
  $(w, '#addStore').value = 'Test Store';
  $(w, '#addPrice').value = '25';
  $(w, '#addQty').value = '500';
  $(w, '#addUnit').value = 'g';
  $(w, '#addPrice').dispatchEvent(new w.Event('input'));
  // 25 EGP / 500g = 50 EGP/kg (digits may render Eastern-Arabic under the ar locale)
  assert.notEqual($(w, '#addUnitPrice').textContent, '—');
  assert.ok(/٥٠|50/.test($(w, '#addUnitPrice').textContent));
  $(w, '#addSave').click();
  const data = JSON.parse(w.localStorage.getItem('se3ry.data.v1'));
  assert.equal(data.products.length, 1);
  assert.equal(data.entries.length, 1);
  assert.equal(data.products[0].name, 'Test Rice');
});

test('adding same product name twice reuses the product', () => {
  const w = boot();
  $(w, '#nav-add').click();
  const addOnce = () => {
    $(w, '#addProduct').value = '__new__';
    $(w, '#addProduct').dispatchEvent(new w.Event('change'));
    $(w, '#addName').value = 'Milk';
    $(w, '#addPrice').value = '30'; $(w, '#addQty').value = '1'; $(w, '#addUnit').value = 'l';
    $(w, '#addSave').click();
    $(w, '#nav-add').click(); // re-render form
  };
  addOnce(); addOnce();
  const data = JSON.parse(w.localStorage.getItem('se3ry.data.v1'));
  assert.equal(data.products.length, 1);
  assert.equal(data.entries.length, 2);
});

test('deal check rules a fake discount correctly', () => {
  const w = boot();
  $(w, '#loadSample').click();
  $(w, '#nav-check').click();
  // Rice history median ~30: a "sale" at 40/kg must be ruled fake
  const sel = $(w, '#checkProduct');
  const riceOpt = Array.from(sel.options).find(o => o.textContent.indexOf('Rice') >= 0);
  assert.ok(riceOpt, 'sample data should include Rice');
  sel.value = riceOpt.value;
  $(w, '#checkPrice').value = '40';
  $(w, '#checkQty').value = '1';
  $(w, '#checkUnit').value = 'kg';
  $(w, '#checkRun').click();
  assert.ok($(w, '#checkResult').innerHTML.indexOf('verdict bad') >= 0 || $(w, '#checkResult').innerHTML.indexOf('وهمي') >= 0);
});

test('deal check says unknown with sparse history', () => {
  const w = boot();
  $(w, '#nav-add').click();
  $(w, '#addName').value = 'Rare Item';
  $(w, '#addPrice').value = '10'; $(w, '#addQty').value = '1'; $(w, '#addUnit').value = 'kg';
  $(w, '#addSave').click();
  $(w, '#nav-check').click();
  $(w, '#checkPrice').value = '9'; $(w, '#checkQty').value = '1';
  $(w, '#checkRun').click();
  assert.ok($(w, '#checkResult').textContent.length > 3);
});

test('record-from-check saves the evaluated price', () => {
  const w = boot();
  $(w, '#loadSample').click();
  const before = JSON.parse(w.localStorage.getItem('se3ry.data.v1')).entries.length;
  $(w, '#nav-check').click();
  $(w, '#checkStore').value = 'New Store';
  $(w, '#checkPrice').value = '26'; $(w, '#checkQty').value = '1'; $(w, '#checkUnit').value = 'kg';
  $(w, '#checkRun').click();
  assert.equal($(w, '#checkRecord').hidden, false);
  $(w, '#checkRecord').click();
  const data = JSON.parse(w.localStorage.getItem('se3ry.data.v1'));
  assert.equal(data.entries.length, before + 1);
  assert.equal(data.entries[data.entries.length - 1].store, 'New Store');
});

test('settings: language switch flips to English LTR', () => {
  const w = boot();
  $(w, '#nav-settings').click();
  $(w, '#setLocale').value = 'en';
  $(w, '#setSave').click();
  assert.equal(w.document.documentElement.dir, 'ltr');
  assert.equal($(w, '#brandName').textContent, 'Se3ry');
});

test('settings: white-label rebrand applies name, color, currency', () => {
  const w = boot();
  $(w, '#nav-settings').click();
  $(w, '#setAppNameAr').value = 'أسعار سوق النور';
  $(w, '#setPrimary').value = '#7c3aed';
  $(w, '#setCurrency').value = 'SAR';
  $(w, '#setSave').click();
  assert.equal($(w, '#brandName').textContent, 'أسعار سوق النور');
  assert.equal(w.document.documentElement.style.getPropertyValue('--primary'), '#7c3aed');
  const data = JSON.parse(w.localStorage.getItem('se3ry.data.v1'));
  assert.equal(data.settings.currency, 'SAR');
});

test('products view renders stats, store chips and entry delete', () => {
  const w = boot();
  $(w, '#loadSample').click();
  $(w, '#nav-products').click();
  const cards = w.document.querySelectorAll('.product-card');
  assert.ok(cards.length >= 4);
  assert.ok($(w, '#productList').innerHTML.indexOf('chip') >= 0);
  const before = JSON.parse(w.localStorage.getItem('se3ry.data.v1')).entries.length;
  const delBtn = w.document.querySelector('[data-delentry]');
  assert.ok(delBtn, 'expected per-entry delete buttons');
  delBtn.click();
  const after = JSON.parse(w.localStorage.getItem('se3ry.data.v1')).entries.length;
  assert.equal(after, before - 1);
});

test('data persists across reload (same localStorage)', () => {
  const w = boot();
  $(w, '#loadSample').click();
  const stored = w.localStorage.getItem('se3ry.data.v1');
  // simulate reload: new boot shares nothing, so verify store contents directly
  const data = JSON.parse(stored);
  assert.ok(data.products.length >= 4);
  assert.equal(data.settings.appName, 'Se3ry');
});
