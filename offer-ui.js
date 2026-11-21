/* Juan CRM - Offer tab UI. Uses CrmOffer (math) and the price bundle (src/data/prices.json or the priceSheets store). */
(function () {
  'use strict';
  const O = window.CrmOffer;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const money = (n) => (n == null ? '-' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }));
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const plain = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();

  const S = { type: 'iphone', modelId: null, storage: null, carrier: null, variant: null, grade: null, basis: 'pod', checked: {}, values: {}, q: '',
    dts: { cat: null, product: null, tier: null, q: '', exp: '' } };
  let B = null; // bundle
  let root = null;
  let hooks = {};

  function typeObj() { return B.types.find((t) => t.id === S.type); }
  function model() { const t = typeObj(); return t && t.models.find((m) => m.id === S.modelId); }
  function isPhone() { return S.type === 'iphone'; }
  function variants(m) { return m ? m.variants : []; }
  function currentVariant(m) {
    if (!m) return null;
    if (isPhone()) return m.variants.find((v) => v.storage === S.storage && v.carrier === S.carrier) || null;
    if (m.variants.length === 1) return m.variants[0];
    return m.variants.find((v) => v.label === S.variant) || null;
  }
  function carrierOf(v) { return v ? (v.carrier || '') : ''; }
  function gradeDef(g) {
    const t = typeObj();
    return (t.gradeDefs && t.gradeDefs[g]) || (B.gradeDefs.fixit[g]) || (g === 'Cracked' || g === 'Bad LCD' ? 'Watch column (no prices filled on this sheet)' : '');
  }
  function resetBelow(level) {
    if (level <= 1) { S.modelId = null; S.q = ''; }
    if (level <= 2) { S.storage = null; S.carrier = null; S.variant = null; }
    if (level <= 3) { S.grade = null; }
    if (level <= 2) { S.checked = {}; S.values = {}; }
  }

  // ---------- rendering ----------
  function chip(act, val, label, on, sub, testid) {
    return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-act="' + act + '" data-val="' + esc(val) + '"' + (testid ? ' data-testid="' + testid + '"' : '') + '>' + esc(label) + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
  }
  function typeBar() {
    const types = B.types.map((t) => chip('type', t.id, t.label, S.type === t.id, '', 'type-' + t.id)).join('') + chip('type', 'dts', 'DTS', S.type === 'dts', '', 'type-dts');
    return '<div class="chips scroll" role="tablist">' + types + '</div>';
  }

  function modelPicker(list, chosen, label, act) {
    if (chosen) {
      return '<div class="picked"><div><small class="muted">' + label + '</small><b data-testid="picked-model">' + esc(chosen) + '</b></div><button type="button" class="btn" data-act="' + act + '-clear">Change</button></div>';
    }
    const q = act === 'model' ? S.q : S.dts.q;
    return '<input type="search" class="search" data-act="' + act + '-q" placeholder="Search ' + label.toLowerCase() + '..." value="' + esc(q) + '" autocomplete="off" aria-label="Search ' + esc(label) + '">' +
      '<div class="pick-list" id="pick-list">' + pickListHtml(list, q, act) + '</div>';
  }
  function pickListHtml(list, q, act) {
    const nq = norm(q);
    const words = nq.split(' ').filter(Boolean);
    const hits = list.filter((x) => { const n = norm(x.name); return words.every((w) => n.includes(w)); });
    if (!hits.length) return '<p class="muted small">No match.</p>';
    return hits.map((x) => '<button type="button" class="pick" data-act="' + act + '" data-val="' + esc(x.id) + '">' + esc(x.name) + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</button>').join('');
  }

  function priceTag(cells) {
    const r = O.resolveCell(cells);
    if (r.status === 'ok') return money(r.price);
    return 'ask';
  }

  function render() {
    if (!B) { root.innerHTML = '<div class="card">Loading price sheets...</div>'; return; }
    let html = '<div class="offer">' + typeBar();
    html += S.type === 'dts' ? renderDts() : renderElectronics();
    html += '</div>';
    root.innerHTML = html;
  }

  function renderElectronics() {
    const t = typeObj(); const m = model();
    let h = '';
    h += '<section class="card step"><h3>' + (t.label === 'iPhone parts' ? 'Model (parts / Chimera)' : 'Model') + '</h3>' +
      modelPicker(t.models.map((x) => ({ id: x.id, name: x.name })), m && m.name, 'Model', 'model') + '</section>';
    if (!m) return h + sourceLine();
    // variant
    if (isPhone()) {
      const storages = [...new Set(m.variants.map((v) => v.storage))];
      const carriers = [...new Set(m.variants.map((v) => v.carrier))];
      h += '<section class="card step"><h3>Storage</h3><div class="chips">' + storages.map((s) => chip('storage', s, s, S.storage === s)).join('') + '</div>' +
        '<h3>Carrier</h3><div class="chips">' + carriers.map((c) => {
          const v = m.variants.find((x) => x.carrier === c && x.lockRaw && /\(/.test(x.lockRaw));
          return chip('carrier', c, c === 'Carrier Locked' ? 'Locked' : c, S.carrier === c, v ? esc(v.lockRaw.replace(/^LOCK\s*/i, '')) : '');
        }).join('') + '</div></section>';
    } else if (m.variants.length > 1) {
      h += '<section class="card step"><h3>' + (S.type === 'samsung' ? 'Carrier' : S.type === 'watch' ? 'Size / version' : 'Variant') + '</h3><div class="chips wrap">' +
        m.variants.map((v) => chip('variant', v.label, v.label, S.variant === v.label)).join('') + '</div></section>';
    }
    const v = currentVariant(m);
    if (!v) return h + sourceLine();
    // grades
    const basis = isPhone() ? S.basis : 'std';
    h += '<section class="card step"><h3>Grade</h3><div class="chips grades">' + m.grades.map((g) => {
      const cells = v.p[basis] && v.p[basis][g];
      return chip('grade', g, g, S.grade === g, cells ? priceTag(cells) : 'ask', 'grade-' + g.replace(/[^A-Za-z0-9+-]/g, '_'));
    }).join('') + '</div>' +
      (S.grade ? '<p class="gdef" data-testid="grade-def"><b>' + esc(S.grade) + ':</b> ' + esc(gradeDef(S.grade) || 'No definition on the sheet.') + '</p>' : '<p class="muted small">Tap the grade.</p>') +
      '</section>';
    if (!S.grade) return h + sourceLine();
    // deductions
    const ctx = { grade: S.grade, carrier: carrierOf(v) };
    const deds = [...m.deds, ...(v.deds || [])].filter((d) => O.applies(d, ctx));
    h += '<section class="card step"><h3>Deductions <small class="muted">(' + deds.length + ')</small></h3><div class="deds">' + deds.map(dedRow).join('') + '</div>' +
      notesHtml(m, v) + '</section>';
    h += resultHtml(m, v, deds);
    h += stickyBar(compute(m, v, deds).res[isPhone() ? S.basis : 'std'], isPhone() ? (S.basis === 'pod' ? 'POD' : 'Credit') : '');
    return h + sourceLine();
  }

  function dedAmountText(d) {
    if (d.noBuy) return '<span class="tag bad">No buy</span>';
    if (d.ask) return '<span class="tag">Ask buyer</span>';
    if (d.forceGrade) return '<span class="tag">= ' + esc(d.forceGrade) + ' price</span>';
    if (d.range) return '<span class="tag">$' + d.range[0] + '–$' + d.range[1] + '</span>';
    if (d.choices) return '<span class="tag">' + d.choices.map((x) => signed(x)).join(' or ') + '</span>';
    if (d.amounts) {
      const p = d.amounts.pod, cr = d.amounts.credit;
      if (p != null && cr != null) return '<span class="amt">' + signed(p) + ' POD / ' + signed(cr) + ' Credit</span>';
      if (p != null) return '<span class="amt">' + signed(p) + ' <small>(POD tab only)</small></span>';
      if (cr != null) return '<span class="amt">' + signed(cr) + ' <small>(Credit tab only)</small></span>';
    }
    if (typeof d.amount === 'number') return '<span class="amt' + (d.amount > 0 ? ' plus' : '') + '">' + signed(d.amount) + '</span>';
    return '';
  }
  function dedRow(d) {
    const on = !!S.checked[d.id];
    let extra = '';
    if (on && d.range) extra = '<div class="ded-input"><label>Amount ($' + d.range[0] + '–$' + d.range[1] + ')<input type="number" inputmode="numeric" min="' + d.range[0] + '" max="' + d.range[1] + '" step="5" data-act="ded-val" data-id="' + esc(d.id) + '" value="' + esc(S.values[d.id] != null ? S.values[d.id] : d.range[0]) + '"></label></div>';
    if (on && d.choices) extra = '<div class="ded-input chips">' + d.choices.map((x) => chip('ded-choice', d.id + '|' + x, signed(x), Number(S.values[d.id] != null ? S.values[d.id] : d.choices[0]) === x)).join('') + '</div>';
    return '<div class="ded' + (on ? ' on' : '') + '"><label class="ded-main"><input type="checkbox" data-act="ded" data-id="' + esc(d.id) + '"' + (on ? ' checked' : '') + '>' +
      '<span class="ded-label">' + esc(d.label) + (d.warn ? '<small class="warn">⚠ ' + esc(d.warn) + '</small>' : '') + '</span>' + dedAmountText(d) + '</label>' + extra + '</div>';
  }
  function notesHtml(m, v) {
    const ns = (m.notes || []).filter((n) => !n.grades || n.grades.includes(S.grade)).map((n) => n.text);
    if (v && v.note) ns.push(v.note);
    return ns.length ? '<ul class="notes">' + ns.map((n) => '<li>' + esc(n) + '</li>').join('') + '</ul>' : '';
  }

  function selection(deds) {
    return deds.filter((d) => S.checked[d.id]).map((d) => ({ ded: d, value: S.values[d.id] }));
  }
  function compute(m, v, deds) {
    const sel = selection(deds);
    const eg = O.effectiveGrade(S.grade, sel);
    const bases = isPhone() ? ['pod', 'credit'] : ['std'];
    const res = {};
    for (const b of bases) res[b] = O.electronics((v.p[b] || {})[eg.grade], sel, b);
    return { res, eg, sel };
  }
  function warningsFor(cell) {
    const w = [];
    if (cell.flags.includes('outlier_grade_inversion')) w.push('Sheet looks off here: this grade is priced out of order vs. the next grade. Double-check with buyer.');
    if (cell.flags.includes('outlier_storage_inversion')) w.push('Sheet looks off here: bigger storage is priced lower than smaller. Double-check with buyer.');
    if (cell.alts && cell.alts.length) w.push('Sheet lists this item twice with different prices: ' + cell.alts.map((a) => money(a.price) + ' (row ' + a.ref.split(':')[0] + ')').join(' and ') + '. Using the lower.');
    else if (cell.dupCount > 1 && cell.flags.includes('duplicate_conflicting_price')) w.push('Sheet lists this item twice; the other entry is blank.');
    return w;
  }
  function resultHtml(m, v, deds) {
    const { res, eg } = compute(m, v, deds);
    const main = isPhone() ? res[S.basis] : res.std;
    const other = isPhone() ? res[S.basis === 'pod' ? 'credit' : 'pod'] : null;
    const name = (b) => (b === 'pod' ? 'POD' : b === 'credit' ? 'Credit' : 'Sheet');
    let big;
    if (main.state === 'ok') big = '<div class="offer-big" data-testid="offer-big">' + money(main.offer) + '</div><div class="offer-sub">Offer = adjusted ' + money(main.adjusted) + ' − $100</div>';
    else if (main.state === 'no_offer') big = '<div class="offer-big no" data-testid="offer-big">No offer (sheet too low)</div><div class="offer-sub">Adjusted ' + money(main.adjusted) + ' − $100 = ' + money(main.offer) + '</div>';
    else if (main.state === 'no_buy') big = '<div class="offer-big no" data-testid="offer-big">Buyer won\'t buy</div><div class="offer-sub">' + esc(main.noBuy) + '</div>';
    else big = '<div class="offer-big ask" data-testid="offer-big">' + esc(main.reason) + '</div>';
    const rows = [];
    if (isPhone()) {
      rows.push('<div class="seg2" role="group" aria-label="Price basis">' + ['pod', 'credit'].map((b) => '<button type="button" data-act="basis" data-val="' + b + '" class="' + (S.basis === b ? 'on' : '') + '" data-testid="basis-' + b + '">' + (b === 'pod' ? 'POD (paid on delivery)' : 'On Credit') + '</button>').join('') + '</div>');
      rows.push('<div class="kv2"><span>Sheet POD</span><b data-testid="sheet-pod">' + sheetText(res.pod) + '</b></div><div class="kv2"><span>Sheet Credit</span><b data-testid="sheet-credit">' + sheetText(res.credit) + '</b></div>');
    } else rows.push('<div class="kv2"><span>Sheet price</span><b data-testid="sheet-std">' + sheetText(main) + '</b></div>');
    if (eg.forcedBy) rows.push('<div class="kv2 warnline"><span>Priced as ' + esc(eg.grade) + '</span><b>' + esc(eg.forcedBy) + '</b></div>');
    main.lines.forEach((l) => rows.push('<div class="kv2 small"><span>' + esc(l.label) + '</span><b>' + signed(l.amount) + '</b></div>'));
    if (main.adjusted != null) rows.push('<div class="kv2"><span>Adjusted sheet (' + name(main.basis) + ')</span><b data-testid="adjusted">' + money(main.adjusted) + '</b></div>');
    if (other) rows.push('<div class="kv2 small muted"><span>' + name(other.basis) + ' offer</span><b data-testid="offer-other">' + (other.state === 'ok' ? money(other.offer) : other.state === 'no_offer' ? 'No offer' : other.state === 'no_buy' ? 'No buy' : 'Ask buyer') + '</b></div>');
    const warns = [...warningsFor(main.cell), ...(other ? warningsFor(other.cell).filter((x) => !warningsFor(main.cell).includes(x)) : [])];
    if (main.asks.length > 1) main.asks.slice(1).forEach((a) => warns.push(a));
    const ref = main.cell.ref ? (typeObj().id === 'iphone' ? (S.basis === 'pod' ? 'iphone pricing POD' : 'iPhones on Credit') : typeObj().tab) + ' row ' + main.cell.ref.replace(':', ' col ') : '';
    return '<section class="card result" data-testid="result">' + big + rows.join('') +
      (warns.length ? '<ul class="warns" data-testid="warnings">' + warns.map((w) => '<li>⚠ ' + esc(w) + '</li>').join('') + '</ul>' : '') +
      '<p class="muted small">Fixit · ' + esc(ref) + ' · sheet ' + esc(B.sheetDate) + '</p>' +
      '<div class="actions"><button type="button" class="btn primary" data-act="add-inv" data-testid="add-to-inventory">Add to inventory</button><button type="button" class="btn" data-act="reset">New lookup</button></div></section>';
  }
  // Always-visible offer while ticking deductions further up the page.
  function stickyBar(r, basisLabel) {
    const txt = r.state === 'ok' ? money(r.offer) : r.state === 'no_offer' ? 'No offer' : r.state === 'no_buy' ? 'No buy' : 'Ask buyer';
    return '<div class="offer-sticky" data-testid="offer-sticky"><span>Offer' + (basisLabel ? ' · ' + basisLabel : '') + (r.adjusted != null ? '<small>adj. sheet ' + money(r.adjusted) + '</small>' : '') + '</span><b class="' + r.state + '">' + txt + '</b></div>';
  }
  function sheetText(r) {
    if (r.cell.status === 'ok') return money(r.cell.price);
    return 'no price (' + esc(r.cell.status) + ')';
  }
  function sourceLine() {
    return '<p class="muted small center">Price sheets dated <b data-testid="sheet-date">' + esc(B.sheetDate) + '</b> · ' + esc(B.sourceLabel || 'Fixit + Path Medical Supply') + '</p>';
  }

  // ---------- DTS ----------
  function dtsCat() { return B.dts.categories.find((c) => c.name === S.dts.cat); }
  function dtsProduct() { const c = dtsCat(); return c && c.products.find((p) => p.name === S.dts.product); }
  function renderDts() {
    const D = B.dts; const cat = dtsCat(); const prod = dtsProduct();
    let h = '<section class="card step"><h3>Category</h3><div class="chips wrap">' + D.categories.map((c) => chip('dts-cat', c.name, c.name, S.dts.cat === c.name)).join('') + '</div></section>';
    if (!cat) return h + '<ul class="notes">' + D.rules.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' + sourceLine();
    h += '<section class="card step"><h3>Product</h3>' + modelPicker(cat.products.map((p) => ({ id: p.name, name: p.name })), prod && prod.name, 'Product', 'dts-prod') + '</section>';
    if (!prod) return h + sourceLine();
    h += '<section class="card step"><h3>Expiration</h3><div class="chips grades">' + cat.tiers.map((t) => chip('dts-tier', t.label, t.label, S.dts.tier === t.label, esc(t.text || '') + '<br>' + (prod.p[t.label] ? priceTag([prod.p[t.label]]) : 'ask'), 'tier-' + t.label.replace(/[^A-Za-z0-9]/g, '_'))).join('') + '</div>' +
      '<label class="small">Or enter expiry month<input type="month" data-act="dts-exp" value="' + esc(S.dts.exp) + '" data-testid="dts-exp"></label>' +
      '<details class="small"><summary>Expiry reference table (sheet)</summary><ul class="notes">' + D.expiryTable.map((r) => '<li>' + esc(r.months) + ' months = ' + esc(r.date) + '</li>').join('') + '</ul></details>' +
      (cat.notes.length ? '<ul class="notes">' + cat.notes.map((n) => '<li>' + linkify(n) + '</li>').join('') + '</ul>' : '') + '</section>';
    if (S.dts.expMsg) h += '<p class="warns small">⚠ ' + esc(S.dts.expMsg) + '</p>';
    if (!S.dts.tier) return h + sourceLine();
    const r = O.dts(prod, S.dts.tier, cat.tiers);
    let big;
    if (r.state === 'ok') big = '<div class="offer-big" data-testid="offer-big">' + money(r.offer) + '</div><div class="offer-sub">Offer = 80% of sheet ' + money(r.sheet) + '</div>';
    else if (r.state === 'no_offer') big = '<div class="offer-big no" data-testid="offer-big">No offer (sheet too low)</div>';
    else big = '<div class="offer-big ask" data-testid="offer-big">' + esc(r.reason) + '</div>';
    h += '<section class="card result" data-testid="result">' + big +
      '<div class="kv2"><span>Sheet price (' + esc(S.dts.tier) + ')</span><b data-testid="sheet-std">' + (r.sheet != null ? money(r.sheet) : 'no price') + '</b></div>' +
      (r.note ? '<p class="small">' + esc(r.note) + '</p>' : '') +
      '<ul class="notes small">' + D.rules.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' +
      '<p class="muted small">' + esc(D.buyer) + ' · ' + esc(D.tab) + (r.cell && r.cell.ref ? ' row ' + esc(r.cell.ref.replace(':', ' col ')) : '') + ' · sheet ' + esc(B.sheetDate) + '</p>' +
      '<div class="actions"><button type="button" class="btn primary" data-act="add-inv" data-testid="add-to-inventory">Add to inventory</button><button type="button" class="btn" data-act="reset">New lookup</button></div></section>';
    return h + sourceLine();
  }
  function linkify(t) {
    return esc(t).replace(/(https:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  // ---------- prefill for inventory ----------
  function prefill() {
    if (S.type === 'dts') {
      const cat = dtsCat(); const prod = dtsProduct(); const r = O.dts(prod, S.dts.tier, cat.tiers);
      return { category: 'dts', title: prod.name, brand: cat.name, sheetPrice: r.sheet, offer: r.state === 'ok' ? r.offer : null, status: 'bought',
        expirationDate: S.dts.exp ? S.dts.exp + '-01' : '',
        notes: 'Offer lookup ' + B.sheetDate + ': ' + B.dts.buyer + ', ' + cat.name + ', expiry tier ' + S.dts.tier + '. Sheet ' + (r.sheet != null ? money(r.sheet) : 'no price') + (r.state === 'ok' ? ' -> offer 80% = ' + money(r.offer) : ' -> ' + r.reason) + (r.note ? ' (' + r.note + ')' : '') + '.' };
    }
    const t = typeObj(); const m = model(); const v = currentVariant(m);
    const ctx = { grade: S.grade, carrier: carrierOf(v) };
    const deds = [...m.deds, ...(v.deds || [])].filter((d) => O.applies(d, ctx));
    const { res, eg, sel } = compute(m, v, deds);
    const main = isPhone() ? res[S.basis] : res.std;
    const basisName = isPhone() ? (S.basis === 'pod' ? 'POD' : 'Credit') : 'sheet';
    const dedText = sel.map((s) => {
      const e = O.effect(s.ded, main.basis, s.value);
      return s.ded.label + (e.amount != null ? ' ' + plain(e.amount) : e.ask ? ' (ask buyer)' : e.forceGrade ? ' (priced as ' + e.forceGrade + ')' : e.noBuy ? ' (no buy)' : '');
    });
    const lines = ['Offer lookup ' + B.sheetDate + ': Fixit ' + t.label + ', grade ' + S.grade + (eg.forcedBy ? ' (priced as ' + eg.grade + ')' : '') + ', basis ' + basisName + '.'];
    if (isPhone()) lines.push('Sheet POD ' + sheetText(res.pod) + ' / Credit ' + sheetText(res.credit) + '.');
    else lines.push('Sheet ' + sheetText(main) + '.');
    lines.push('Deductions: ' + (dedText.length ? dedText.join('; ') : 'none') + '.');
    if (main.adjusted != null) lines.push('Adjusted ' + money(main.adjusted) + (main.state === 'ok' ? ' -> offer ' + money(main.offer) : ' -> ' + (main.reason || main.state)) + '.');
    else lines.push(main.reason || '');
    const phoneCat = S.type === 'iphone' || S.type === 'samsung' || S.type === 'parts';
    return {
      category: phoneCat ? 'phone' : 'other', title: (S.type === 'samsung' ? 'Samsung ' : '') + m.name + (!isPhone() && v.label && v.label !== 'Any' && S.type !== 'samsung' ? ' ' + v.label : ''),
      brand: S.type === 'samsung' ? 'Samsung' : 'Apple', storage: isPhone() ? v.storage : (v.storage || ''), carrier: isPhone() ? (v.carrier === 'Carrier Locked' ? 'Locked' : v.carrier) : (S.type === 'samsung' ? v.carrier : (v.carrier || '')),
      condition: S.grade, status: 'bought', sheetPrice: main.adjusted, offer: main.state === 'ok' ? main.offer : null, notes: lines.join(' '),
    };
  }

  // ---------- events ----------
  function onClick(e) {
    const el = e.target.closest('[data-act]'); if (!el || !root.contains(el)) return;
    const act = el.dataset.act, val = el.dataset.val;
    if (el.tagName === 'INPUT' && (el.type === 'checkbox')) return; // handled in change
    if (el.tagName === 'INPUT') return;
    switch (act) {
      case 'type': S.type = val; resetBelow(1); break;
      case 'model': S.modelId = val; resetBelow(2); autoPick(); break;
      case 'model-clear': resetBelow(1); break;
      case 'storage': S.storage = val; S.checked = {}; S.values = {}; if (!S.carrier) { const m = model(); const cs = [...new Set(m.variants.map((v) => v.carrier))]; if (cs.length === 1) S.carrier = cs[0]; } break;
      case 'carrier': S.carrier = val; S.checked = {}; S.values = {}; break;
      case 'variant': S.variant = val; S.checked = {}; S.values = {}; break;
      case 'grade': S.grade = val; break;
      case 'basis': S.basis = val; break;
      case 'ded-choice': { const [id, x] = val.split('|'); S.values[id] = Number(x); break; }
      case 'reset': if (S.type === 'dts') S.dts = { cat: S.dts.cat, product: null, tier: null, q: '', exp: '' }; else resetBelow(1); break;
      case 'add-inv': hooks.addToInventory && hooks.addToInventory(prefill()); return;
      case 'dts-cat': S.dts = { cat: val, product: null, tier: null, q: '', exp: '' }; break;
      case 'dts-prod': S.dts.product = val; S.dts.tier = null; break;
      case 'dts-prod-clear': S.dts.product = null; S.dts.tier = null; S.dts.q = ''; break;
      case 'dts-tier': S.dts.tier = val; S.dts.expMsg = null; break;
      default: return;
    }
    render();
    if (act === 'model' || act === 'dts-prod' || act === 'grade') scrollNext();
  }
  function scrollNext() {
    const steps = root.querySelectorAll('.step, .result');
    const last = steps[steps.length - 1];
    if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function autoPick() {
    const m = model(); if (!m) return;
    if (isPhone()) {
      const st = [...new Set(m.variants.map((v) => v.storage))]; if (st.length === 1) S.storage = st[0];
      const cs = [...new Set(m.variants.map((v) => v.carrier))]; if (cs.length === 1) S.carrier = cs[0];
    } else if (m.variants.length === 1) S.variant = m.variants[0].label;
  }
  function onInput(e) {
    const el = e.target; const act = el.dataset && el.dataset.act; if (!act) return;
    if (act === 'model-q') { S.q = el.value; const t = typeObj(); root.querySelector('#pick-list').innerHTML = pickListHtml(t.models.map((x) => ({ id: x.id, name: x.name })), S.q, 'model'); }
    if (act === 'dts-prod-q') { S.dts.q = el.value; root.querySelector('#pick-list').innerHTML = pickListHtml(dtsCat().products.map((p) => ({ id: p.name, name: p.name })), S.dts.q, 'dts-prod'); }
  }
  function onChange(e) {
    const el = e.target; const act = el.dataset && el.dataset.act; if (!act) return;
    if (act === 'ded') { const id = el.dataset.id; if (el.checked) S.checked[id] = true; else { delete S.checked[id]; delete S.values[id]; } render(); }
    if (act === 'ded-val') { S.values[el.dataset.id] = el.value === '' ? null : Number(el.value); render(); }
    if (act === 'dts-exp') {
      S.dts.exp = el.value;
      const months = O.monthsFromTable(B.dts.expiryTable, el.value);
      const t = months != null ? O.tierForMonths(dtsCat().tiers, months) : null;
      if (t) { S.dts.tier = t.label; S.dts.expMsg = null; }
      else { S.dts.tier = null; S.dts.expMsg = el.value ? 'That expiry is below the shortest tier on the sheet for ' + S.dts.cat + ' — ask buyer.' : null; }
      render();
    }
  }

  function setBundle(bundle) { B = bundle; }
  function mount(el, h) {
    root = el; hooks = h || {};
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    render();
  }
  window.CrmOfferUI = { mount, setBundle, render, state: S, prefill };
})();
