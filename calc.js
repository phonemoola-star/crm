/* Juan CRM - pure business math. Works in the browser (window.CrmCalc) and Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrmCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_RULES = { phoneOfferDiscount: 100, dtsOfferPct: 80 };

  // Parse a user-typed money value ("$1,234.50", "12", "") to a number or null.
  function parseMoney(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null;
    const s = String(v).replace(/[$,\s]/g, '');
    if (s === '' || s === '-' || s === '.') return null;
    const n = Number(s);
    return Number.isFinite(n) ? round2(n) : null;
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function cents(n) {
    return Math.round((Number(n) || 0) * 100);
  }

  // Suggested offer per unit from a sheet price.
  // Phone: sheet - $100 (never below 0). DTS: 80% of sheet. Other: no suggestion.
  function suggestOffer(category, sheetPrice, rules) {
    const r = Object.assign({}, DEFAULT_RULES, rules || {});
    const sheet = parseMoney(sheetPrice);
    if (sheet === null) return null;
    if (category === 'phone') return Math.max(0, (cents(sheet) - cents(r.phoneOfferDiscount)) / 100);
    if (category === 'dts') return Math.round(cents(sheet) * Number(r.dtsOfferPct) / 100) / 100;
    return null;
  }

  // Profit = sale price - cost - fees - shipping. Null until a sale price exists.
  function profit(item) {
    if (!item) return null;
    const sale = parseMoney(item.salePrice);
    if (sale === null) return null;
    return (cents(sale) - cents(item.cost) - cents(item.fees) - cents(item.shipping)) / 100;
  }

  function qtyOf(item) {
    const q = Number(item && item.qty);
    return Number.isFinite(q) && q > 0 ? q : 1;
  }

  function profitPerUnit(item) {
    const p = profit(item);
    return p === null ? null : round2(p / qtyOf(item));
  }

  const ON_HAND = ['bought', 'in_stock', 'listed'];
  const SOLD = ['sold', 'paid'];

  function isSold(item) {
    return SOLD.includes(item && item.status);
  }

  // Header totals: on-hand units, cost on hand, realized profit (sold/paid with a sale price).
  function totals(items) {
    let units = 0, costOnHand = 0, realized = 0, soldCount = 0;
    for (const it of items || []) {
      if (ON_HAND.includes(it.status)) {
        units += qtyOf(it);
        costOnHand += cents(it.cost);
      } else if (isSold(it)) {
        const p = profit(it);
        if (p !== null) { realized += cents(p); soldCount += 1; }
      }
    }
    return { units, costOnHand: costOnHand / 100, realizedProfit: realized / 100, soldCount, records: (items || []).length };
  }

  function formatMoney(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
    const v = Number(n);
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-$' : '$') + s;
  }

  return { DEFAULT_RULES, parseMoney, round2, suggestOffer, profit, profitPerUnit, qtyOf, totals, isSold, formatMoney, ON_HAND, SOLD };
});
