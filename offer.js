/* Juan CRM - Offer calculator (pure). Browser: window.CrmOffer. Node: require('./offer.js').
 * Rules (Juan): phones/electronics offer = adjusted sheet price - $100; DTS offer = sheet x 80%.
 * Never invents a price: non-numeric sheet cells (ask/offer/SOON/blank/#REF!) => "Ask buyer".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrmOffer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ELECTRONICS_MINUS = 100;
  const DTS_PCT = 0.8;
  const ASK_STATUSES = { ask: 'ASK', offer: '"offer"', soon: 'SOON', blank: 'blank cell', formula_error: 'sheet formula error', non_numeric: 'text cell', not_applicable: "doesn't expire" };
  const c = (n) => Math.round(Number(n) * 100);
  const r2 = (n) => Math.round(n * 100) / 100;

  // cells: [[value|null, status, flags[], "row:col"], ...] (more than one = sheet lists the item twice)
  function resolveCell(cells) {
    const list = (cells || []).map((x) => ({ price: x[0], status: x[1], flags: x[2] || [], ref: x[3] }));
    if (!list.length) return { status: 'blank', price: null, ref: null, alts: [], flags: [] };
    const nums = list.filter((x) => x.status === 'ok' && typeof x.price === 'number');
    const flags = [...new Set(list.flatMap((x) => x.flags))];
    if (!nums.length) return { status: list[0].status, price: null, ref: list[0].ref, alts: [], flags, dupCount: list.length };
    const distinct = [...new Set(nums.map((x) => x.price))];
    const chosen = nums.reduce((a, b) => (b.price < a.price ? b : a)); // conflicting duplicates: use the lower, show both
    return {
      status: 'ok', price: chosen.price, ref: chosen.ref, flags,
      alts: distinct.length > 1 ? nums.map((x) => ({ price: x.price, ref: x.ref })) : [],
      dupCount: list.length,
    };
  }

  function matchList(list, value) {
    if (!list || !list.length) return true;
    const v = String(value || '').trim().toLowerCase();
    return list.some((x) => String(x).trim().toLowerCase() === v);
  }

  // Is this deduction shown for the current grade / carrier?
  function applies(d, ctx) {
    return matchList(d.grades, ctx.grade) && matchList(d.carriers, ctx.carrier);
  }

  // Dollar effect of one selected deduction for a pricing basis ('pod' | 'credit' | 'std').
  // Returns { amount } | { ask } | { noBuy } | { forceGrade } | { na: true } (not on that tab).
  function effect(d, basis, value) {
    if (d.noBuy) return { noBuy: d.noBuy };
    if (d.ask) return { ask: d.ask };
    if (d.forceGrade) return { forceGrade: d.forceGrade };
    if (d.range) {
      const lo = d.range[0], hi = d.range[1];
      const v = Number(value);
      if (!Number.isFinite(v)) return { amount: -lo, clamped: true };
      return { amount: -Math.min(hi, Math.max(lo, Math.abs(v))), clamped: Math.abs(v) < lo || Math.abs(v) > hi };
    }
    if (d.choices) {
      const v = Number(value);
      const pick = d.choices.find((x) => x === v || x === -Math.abs(v));
      return { amount: pick != null ? pick : d.choices[0] };
    }
    if (d.amounts) {
      if (basis in d.amounts) return { amount: d.amounts[basis] };
      return { na: true };
    }
    if (typeof d.amount === 'number') return { amount: d.amount };
    return { na: true };
  }

  // Electronics: sheet cell + selected deductions -> result for one basis.
  // selected: [{ ded, value }]
  function electronics(cells, selected, basis) {
    const cell = resolveCell(cells);
    const lines = []; const asks = []; let noBuy = null; let total = 0;
    for (const s of selected || []) {
      const e = effect(s.ded, basis, s.value);
      if (e.na || e.forceGrade) continue;
      if (e.noBuy) { noBuy = e.noBuy; continue; }
      if (e.ask) { asks.push(e.ask); continue; }
      total += c(e.amount);
      lines.push({ id: s.ded.id, label: s.ded.label, amount: e.amount });
    }
    const out = { basis, cell, sheet: cell.price, lines, deductions: total / 100, asks, noBuy };
    if (noBuy) return Object.assign(out, { state: 'no_buy', adjusted: null, offer: null });
    if (cell.status !== 'ok') return Object.assign(out, { state: 'ask', reason: 'Ask buyer — no price on sheet (' + (ASK_STATUSES[cell.status] || cell.status) + ')', adjusted: null, offer: null });
    const adjusted = (c(cell.price) + total) / 100;
    const offer = (c(adjusted) - c(ELECTRONICS_MINUS)) / 100;
    if (asks.length) return Object.assign(out, { state: 'ask', reason: 'Ask buyer — ' + asks[0], adjusted, offer: null });
    if (offer <= 0) return Object.assign(out, { state: 'no_offer', reason: 'No offer (sheet too low)', adjusted, offer });
    return Object.assign(out, { state: 'ok', adjusted, offer });
  }

  // Which grade's price to use after "graded D" style deductions are ticked.
  function effectiveGrade(grade, selected) {
    for (const s of selected || []) if (s.ded.forceGrade) return { grade: s.ded.forceGrade, forcedBy: s.ded.label };
    return { grade, forcedBy: null };
  }

  // DTS: product prices by tier ({ [tierLabel]: cell }), tier order from sheet.
  function dts(product, tierLabel, tiers) {
    const cell = resolveCell([product.p[tierLabel]].filter(Boolean));
    let note = null;
    let use = cell;
    if (cell.status === 'not_applicable') {
      // "doesn't expire": the sheet gives one price for the item; use it as given.
      const given = (tiers || []).map((t) => resolveCell([product.p[t.label]].filter(Boolean))).find((x) => x.status === 'ok');
      if (given) { use = given; note = "Doesn't expire — price as given on the sheet"; }
    }
    if (use.status !== 'ok') return { state: 'ask', cell: use, reason: 'Ask buyer — no price on sheet (' + (ASK_STATUSES[use.status] || use.status) + ')', sheet: null, offer: null, note };
    const offer = Math.round(c(use.price) * DTS_PCT) / 100;
    if (offer <= 0) return { state: 'no_offer', cell: use, reason: 'No offer (sheet too low)', sheet: use.price, offer, note };
    return { state: 'ok', cell: use, sheet: use.price, offer, note };
  }

  // Pick the expiry tier for "months left" using the sheet's tier labels (e.g. 7+, 6, 5 / 9+, 7-8, 6).
  function tierForMonths(tiers, months) {
    for (const t of tiers || []) {
      if (t.minMonths == null) continue;
      if (t.maxMonths == null && months >= t.minMonths) return t;
      if (t.maxMonths != null && months >= t.minMonths && months <= t.maxMonths) return t;
    }
    return null;
  }
  // Months left from the sheet's own EXPIRATION DATE REFERENCES table ("7 Months - 06/2027").
  function monthsFromTable(table, mmYYYY) {
    const m = String(mmYYYY || '').match(/^(\d{4})-(\d{2})/) || String(mmYYYY || '').match(/^(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const [y, mo] = m[1].length === 4 ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    const key = y * 12 + mo;
    let best = null;
    for (const row of table || []) {
      const [tm, ty] = row.date.split('/').map(Number);
      const tk = ty * 12 + tm;
      const n = parseInt(row.months, 10);
      if (key >= tk && (best === null || n > best)) best = n;
    }
    return best; // null = below the shortest listed tier
  }

  return { ELECTRONICS_MINUS, DTS_PCT, resolveCell, applies, effect, electronics, effectiveGrade, dts, tierForMonths, monthsFromTable, r2 };
});
