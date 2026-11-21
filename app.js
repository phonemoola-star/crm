/* Juan CRM - UI (no framework). Hash routes: #/inventory  #/new  #/item/:id  #/edit/:id  #/settings */
(function () {
  'use strict';
  const DB = window.CrmDB, C = window.CrmCalc;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const main = $('#main');
  const state = { filter: { q: '', status: '', category: '' }, settings: {} };

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = C.formatMoney;
  const label = (list, id) => (list.find((x) => x.id === id) || {}).label || id || '';
  const catLabel = (id) => (id === 'dts' ? 'DTS' : label(DB.CATEGORIES, id));
  const statusLabel = (id) => label(DB.STATUSES, id);
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const rules = () => Object.assign({}, C.DEFAULT_RULES, state.settings);

  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }

  function setTop(title, actionsHtml) { $('#title').textContent = title; $('#top-actions').innerHTML = actionsHtml || ''; document.title = title + ' - Juan CRM'; }
  function setTab(tab) { $$('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab)); }

  // Bottom-sheet modal. buttons: [{ id, text, cls }]. Resolves with clicked id or null.
  function modal(title, bodyHtml, buttons) {
    return new Promise((resolve) => {
      const root = $('#modal-root');
      root.innerHTML = '<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' +
        bodyHtml + '<div class="actions">' + buttons.map((b) => '<button type="button" class="btn ' + (b.cls || '') + '" data-id="' + b.id + '">' + esc(b.text) + '</button>').join('') +
        '</div></div></div>';
      const done = (v) => { root.innerHTML = ''; resolve(v); };
      root.querySelector('.modal-back').addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-back')) done(null);
        const b = e.target.closest('button[data-id]'); if (b) done(b.dataset.id === 'cancel' ? null : b.dataset.id);
      });
    });
  }

  function describe(it) {
    if (it.category === 'phone') return [it.storage, it.color, it.carrier, it.condition].filter(Boolean).join(' · ');
    if (it.category === 'dts') return [it.brand, it.boxSize, it.qty > 1 ? 'x' + it.qty : '', it.expirationDate ? 'exp ' + it.expirationDate : ''].filter(Boolean).join(' · ');
    return [it.brand, it.condition, it.qty > 1 ? 'x' + it.qty : ''].filter(Boolean).join(' · ');
  }

  // ---------- Inventory list ----------
  async function renderList() {
    setTab('inventory'); setTop('Inventory', '<a href="#/new" data-testid="add-btn">+ Add</a>');
    const f = state.filter;
    const all = await DB.listItems();
    const rows = await DB.listItems(f);
    const t = C.totals(all);
    main.innerHTML =
      '<section class="totals" data-testid="totals">' +
        '<div><b data-testid="t-units">' + t.units + '</b><small>Units on hand</small></div>' +
        '<div><b data-testid="t-cost">' + money(t.costOnHand) + '</b><small>Cost on hand</small></div>' +
        '<div><b data-testid="t-profit" class="' + (t.realizedProfit < 0 ? 'neg' : 'pos') + '">' + money(t.realizedProfit) + '</b><small>Realized profit</small></div>' +
      '</section>' +
      '<section class="filters">' +
        '<input type="search" id="q" placeholder="Search model, IMEI, lot, seller, buyer..." value="' + esc(f.q) + '" aria-label="Search" autocomplete="off">' +
        '<select id="f-status" aria-label="Filter by status"><option value="">All statuses</option>' + DB.STATUSES.map((s) => '<option value="' + s.id + '"' + (f.status === s.id ? ' selected' : '') + '>' + s.label + '</option>').join('') + '</select>' +
        '<select id="f-cat" aria-label="Filter by category"><option value="">All categories</option>' + DB.CATEGORIES.map((c) => '<option value="' + c.id + '"' + (f.category === c.id ? ' selected' : '') + '>' + catLabel(c.id) + '</option>').join('') + '</select>' +
      '</section>' +
      '<div id="results"></div>';
    const draw = (items) => {
      $('#results').innerHTML = items.length ? '<p class="muted small">' + items.length + ' of ' + all.length + ' records</p><ul class="list" data-testid="list">' + items.map((it) => {
        const p = C.isSold(it) ? C.profit(it) : null;
        return '<li><a class="item" href="#/item/' + encodeURIComponent(it.id) + '">' +
          '<div class="row"><span class="t">' + esc(it.title || '(untitled)') + '</span><span class="badge ' + it.status + '">' + statusLabel(it.status) + '</span></div>' +
          '<div class="sub">' + esc(catLabel(it.category)) + (describe(it) ? ' · ' + esc(describe(it)) : '') + '</div>' +
          '<div class="row sub"><span>' + (it.serial ? esc(it.serial) : '&nbsp;') + '</span><span>' +
          (p !== null ? 'Profit <b class="' + (p < 0 ? 'neg' : 'pos') + '">' + money(p) + '</b>' : 'Cost ' + money(it.cost)) + '</span></div>' +
          '</a></li>';
      }).join('') + '</ul>' : '<div class="empty">' + (all.length ? 'No records match.' : 'No inventory yet.<br><br><a class="btn primary" href="#/new">Add your first item</a>') + '</div>';
    };
    draw(rows);
    const refilter = async () => { draw(await DB.listItems(state.filter)); };
    $('#q').addEventListener('input', (e) => { state.filter.q = e.target.value; refilter(); });
    $('#f-status').addEventListener('change', (e) => { state.filter.status = e.target.value; refilter(); });
    $('#f-cat').addEventListener('change', (e) => { state.filter.category = e.target.value; refilter(); });
  }

  // ---------- View ----------
  async function renderView(id) {
    setTab('inventory');
    const it = await DB.getItem(id);
    if (!it) { main.innerHTML = '<div class="empty">Record not found.</div>'; setTop('Not found', '<a href="#/inventory">Back</a>'); return; }
    setTop(it.title || 'Item', '<a href="#/inventory">Back</a>');
    const p = C.profit(it), ppu = C.profitPerUnit(it);
    const rows = [
      ['Category', catLabel(it.category)], ['Status', '<span class="badge ' + it.status + '">' + statusLabel(it.status) + '</span>', true],
      ['Brand', it.brand], ['Storage', it.storage], ['Color', it.color], ['Carrier / lock', it.carrier], ['Box size', it.boxSize],
      ['Quantity', it.qty > 1 ? it.qty : ''], [it.category === 'dts' ? 'Lot #' : 'IMEI / serial', it.serial], ['Expiration', it.expirationDate], ['Condition', it.condition],
    ];
    const buy = [['Seller', it.seller], ['Purchase date', it.purchaseDate], ['Sheet price (unit)', it.sheetPrice != null ? money(it.sheetPrice) : ''],
      ['Offer (unit)', it.offer != null ? money(it.offer) : ''], ['Cost (total)', it.cost != null ? money(it.cost) : '']];
    const sell = [['Buyer', it.buyer], ['Sale date', it.saleDate], ['Sale price', it.salePrice != null ? money(it.salePrice) : ''],
      ['Fees', it.fees != null ? money(it.fees) : ''], ['Shipping', it.shipping != null ? money(it.shipping) : '']];
    const kv = (list) => '<dl class="kv">' + list.filter((r) => r[1] !== '' && r[1] != null).map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + (r[2] ? r[1] : esc(r[1])) + '</dd>').join('') + '</dl>';
    main.innerHTML =
      (C.isSold(it) && p !== null ? '<div class="card profit-box" data-testid="profit"><span>Profit</span><span class="' + (p < 0 ? 'neg' : 'pos') + '">' + money(p) +
        (it.qty > 1 ? ' <small class="muted">(' + money(ppu) + '/unit)</small>' : '') + '</span></div>' : '') +
      '<div class="card">' + kv(rows) + '</div>' +
      '<div class="card"><h3 style="margin:0 0 8px">Purchase</h3>' + kv(buy) + '</div>' +
      (sell.some((r) => r[1]) ? '<div class="card"><h3 style="margin:0 0 8px">Sale</h3>' + kv(sell) + '</div>' : '') +
      (it.notes ? '<div class="card"><h3 style="margin:0 0 8px">Notes</h3><div style="white-space:pre-wrap">' + esc(it.notes) + '</div></div>' : '') +
      '<p class="muted small">Added ' + esc(new Date(it.createdAt).toLocaleString()) + ' · Updated ' + esc(new Date(it.updatedAt).toLocaleString()) + '</p>' +
      '<div class="actions"><a class="btn primary" href="#/edit/' + encodeURIComponent(it.id) + '" data-testid="edit-btn">Edit</a>' +
      '<button class="btn danger" id="del" data-testid="delete-btn">Delete</button></div>';
    $('#del').addEventListener('click', async () => {
      const ok = await modal('Delete this record?', '<p>' + esc(it.title || 'This item') + (it.serial ? ' (' + esc(it.serial) + ')' : '') + ' will be permanently removed from this phone. This cannot be undone.</p>',
        [{ id: 'delete', text: 'Delete', cls: 'danger solid' }, { id: 'cancel', text: 'Cancel' }]);
      if (ok !== 'delete') return;
      await DB.deleteItem(it.id); toast('Deleted'); location.hash = '#/inventory';
    });
  }

  // ---------- Add / Edit form ----------
  function field(name, text, val, opts) {
    const o = opts || {};
    const attrs = (o.type === 'money' ? 'inputmode="decimal" placeholder="$0.00"' : '') + (o.type === 'number' ? 'inputmode="numeric" min="1" step="1"' : '') + (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.list ? ' list="' + o.list + '"' : '');
    const type = o.type === 'date' ? 'date' : o.type === 'number' ? 'number' : 'text';
    const v = o.type === 'money' ? (val == null ? '' : val) : (val == null ? '' : val);
    return '<label class="' + (o.cls || '') + '"' + (o.cat ? ' data-cat="' + o.cat + '"' : '') + '>' + esc(text) +
      '<input name="' + name + '" type="' + type + '" value="' + esc(v) + '" ' + attrs + ' autocomplete="off"></label>' + (o.after || '');
  }

  async function renderForm(id) {
    const existing = id ? await DB.getItem(id) : null;
    if (id && !existing) { main.innerHTML = '<div class="empty">Record not found.</div>'; return; }
    setTab(existing ? 'inventory' : 'new');
    setTop(existing ? 'Edit item' : 'Add item', '<a href="' + (existing ? '#/item/' + encodeURIComponent(id) : '#/inventory') + '">Cancel</a> <button type="submit" form="f" data-testid="save-top">Save</button>');
    const it = existing || Object.assign({}, DB.INVENTORY_FIELDS, { purchaseDate: today(), category: state.lastCategory || 'phone' });
    const r = rules();
    main.innerHTML =
      '<form id="f" novalidate data-cat-current="' + it.category + '">' +
      '<fieldset class="card"><legend>Category</legend><div class="seg">' + DB.CATEGORIES.map((c) =>
        '<label><input type="radio" name="category" value="' + c.id + '"' + (it.category === c.id ? ' checked' : '') + '><span>' + esc(catLabel(c.id)) + '</span></label>').join('') + '</div></fieldset>' +
      '<fieldset class="card"><legend>Item</legend><div class="grid">' +
        field('title', 'Model / product', it.title, { cls: 'full', ph: 'iPhone 15 Pro Max / Dexcom G7 / ...', list: 'dl-titles' }) +
        field('brand', 'Brand', it.brand, { cat: 'dts other' }) +
        field('storage', 'Storage', it.storage, { cat: 'phone', ph: '256GB', list: 'dl-storage' }) +
        field('color', 'Color', it.color, { cat: 'phone' }) +
        field('carrier', 'Carrier / lock', it.carrier, { cat: 'phone', ph: 'Unlocked', list: 'dl-carrier' }) +
        field('boxSize', 'Box size', it.boxSize, { cat: 'dts', ph: '100 ct' }) +
        field('qty', 'Quantity', it.qty, { type: 'number' }) +
        field('serial', 'IMEI / serial', it.serial, { cls: 'full', ph: '', after: '' }) +
        field('expirationDate', 'Expiration date', it.expirationDate, { type: 'date', cat: 'dts' }) +
        field('condition', 'Condition', it.condition, { list: 'dl-condition', ph: 'A / B / New sealed' }) +
        '<label>Status<select name="status">' + DB.STATUSES.map((s) => '<option value="' + s.id + '"' + (it.status === s.id ? ' selected' : '') + '>' + s.label + '</option>').join('') + '</select></label>' +
      '</div></fieldset>' +
      '<fieldset class="card"><legend>Purchase</legend><div class="grid">' +
        field('seller', 'Seller', it.seller, { list: 'dl-sellers' }) +
        field('purchaseDate', 'Purchase date', it.purchaseDate, { type: 'date' }) +
        field('sheetPrice', 'Sheet price (per unit)', it.sheetPrice, { type: 'money' }) +
        field('offer', 'Offer (per unit)', it.offer, { type: 'money' }) +
        '<div class="full hint" id="offer-hint"></div>' +
        field('cost', 'Cost paid (total)', it.cost, { type: 'money', cls: 'full', after: '<div class="full hint" id="cost-hint"></div>' }) +
      '</div></fieldset>' +
      '<fieldset class="card"><legend>Sale</legend><div class="grid">' +
        field('buyer', 'Buyer', it.buyer, { list: 'dl-buyers' }) +
        field('saleDate', 'Sale date', it.saleDate, { type: 'date' }) +
        field('salePrice', 'Sale price (total)', it.salePrice, { type: 'money', cls: 'full' }) +
        field('fees', 'Fees', it.fees, { type: 'money' }) +
        field('shipping', 'Shipping', it.shipping, { type: 'money' }) +
        '<div class="full hint" id="profit-hint" data-testid="profit-preview"></div>' +
      '</div></fieldset>' +
      '<fieldset class="card"><legend>Notes</legend><textarea name="notes" aria-label="Notes">' + esc(it.notes) + '</textarea></fieldset>' +
      '<div id="form-err" class="err"></div>' +
      '<div class="form-actions"><button class="btn primary block" type="submit" data-testid="save-btn">Save</button></div>' +
      '</form>' + await datalists();

    const form = $('#f');
    const val = (n) => { const el = form.elements[n]; return el ? el.value : ''; };
    const cat = () => (form.querySelector('input[name=category]:checked') || {}).value || 'phone';
    let offerTouched = existing ? it.offer != null : false;

    function applyCategory() {
      const c = cat();
      $$('[data-cat]', form).forEach((el) => { el.hidden = el.dataset.cat.split(' ').indexOf(c) === -1; });
      const serialLabel = form.elements.serial.closest('label');
      serialLabel.firstChild.textContent = c === 'dts' ? 'Lot number' : 'IMEI / serial';
      form.elements.serial.placeholder = c === 'phone' ? '15-digit IMEI' : c === 'dts' ? 'Lot #' : 'Serial';
      form.elements.serial.inputMode = c === 'phone' ? 'numeric' : 'text';
      updateOffer(); updateProfit();
    }
    function updateOffer() {
      const c = cat(), sug = C.suggestOffer(c, val('sheetPrice'), r);
      const hint = $('#offer-hint');
      if (sug === null) { hint.textContent = c === 'other' ? '' : 'Type a sheet price to get a suggested offer.'; return; }
      const rule = c === 'phone' ? 'sheet - ' + money(r.phoneOfferDiscount) : r.dtsOfferPct + '% of sheet';
      if (!offerTouched) form.elements.offer.value = sug.toFixed(2);
      hint.innerHTML = 'Suggested offer: <b data-testid="offer-suggestion">' + money(sug) + '</b> (' + esc(rule) + ')' +
        (offerTouched && C.parseMoney(val('offer')) !== sug ? ' <button type="button" id="use-sug">Use</button>' : '');
      const b = $('#use-sug'); if (b) b.onclick = () => { offerTouched = false; updateOffer(); updateCost(); };
      updateCost();
    }
    function updateCost() {
      const o = C.parseMoney(val('offer')), q = Number(val('qty')) || 1;
      const h = $('#cost-hint');
      if (o === null) { h.innerHTML = ''; return; }
      const total = C.round2(o * q);
      h.innerHTML = 'Offer total' + (q > 1 ? ' (' + q + ' units)' : '') + ': ' + money(total) +
        (C.parseMoney(val('cost')) !== total ? ' <button type="button" id="use-cost">Set as cost</button>' : '');
      const b = $('#use-cost'); if (b) b.onclick = () => { form.elements.cost.value = total.toFixed(2); updateCost(); updateProfit(); };
    }
    function updateProfit() {
      const p = C.profit({ salePrice: val('salePrice'), cost: val('cost'), fees: val('fees'), shipping: val('shipping') });
      const q = Number(val('qty')) || 1;
      $('#profit-hint').innerHTML = p === null ? 'Profit appears when a sale price is entered.' :
        'Profit: <b class="' + (p < 0 ? 'neg' : 'pos') + '">' + money(p) + '</b>' + (q > 1 ? ' (' + money(C.round2(p / q)) + '/unit)' : '') + ' = sale - cost - fees - shipping';
    }

    form.addEventListener('change', (e) => { if (e.target.name === 'category') applyCategory(); });
    form.addEventListener('input', (e) => {
      const n = e.target.name;
      if (n === 'offer') { offerTouched = e.target.value !== ''; updateOffer(); }
      if (n === 'sheetPrice') updateOffer();
      if (n === 'qty' || n === 'cost') updateCost();
      if (['salePrice', 'cost', 'fees', 'shipping', 'qty'].indexOf(n) !== -1) updateProfit();
    });
    form.elements.status.addEventListener('change', (e) => {
      if ((e.target.value === 'sold' || e.target.value === 'paid') && !val('saleDate')) form.elements.saleDate.value = today();
    });
    applyCategory();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = { id: existing ? existing.id : undefined, category: cat() };
      ['title', 'brand', 'storage', 'color', 'carrier', 'boxSize', 'qty', 'serial', 'expirationDate', 'condition', 'status', 'seller', 'purchaseDate',
        'sheetPrice', 'offer', 'cost', 'buyer', 'saleDate', 'salePrice', 'fees', 'shipping', 'notes'].forEach((n) => { data[n] = typeof val(n) === 'string' ? val(n).trim() : val(n); });
      // Clear fields hidden for this category so they don't linger.
      const c = data.category;
      if (c !== 'phone') { data.storage = ''; data.color = ''; data.carrier = ''; }
      if (c !== 'dts') { data.boxSize = ''; data.expirationDate = ''; }
      if (c === 'phone') data.brand = data.brand || '';
      const errs = [];
      if (!data.title) errs.push('Enter a model or product name.');
      ['sheetPrice', 'offer', 'cost', 'salePrice', 'fees', 'shipping'].forEach((n) => { if (data[n] !== '' && C.parseMoney(data[n]) === null) errs.push('"' + n + '" is not a valid amount.'); });
      if (c === 'phone' && data.serial && !/^\d{15}$/.test(data.serial.replace(/\s/g, '')) ) {
        const go = await modal('IMEI is not 15 digits', '<p>"' + esc(data.serial) + '" is not a 15-digit IMEI. Save anyway?</p>', [{ id: 'ok', text: 'Save anyway', cls: 'primary' }, { id: 'cancel', text: 'Go back' }]);
        if (go !== 'ok') return;
      }
      if (errs.length) { $('#form-err').innerHTML = errs.map(esc).join('<br>'); return; }
      ['sheetPrice', 'offer', 'cost', 'salePrice', 'fees', 'shipping'].forEach((n) => { data[n] = C.parseMoney(data[n]); });
      data.qty = Math.max(1, parseInt(data.qty, 10) || 1);
      if (existing) Object.keys(existing).forEach((k) => { if (!(k in data)) data[k] = existing[k]; });
      const saved = await DB.saveItem(data);
      state.lastCategory = saved.category;
      toast('Saved');
      location.hash = '#/item/' + encodeURIComponent(saved.id);
    });
  }

  async function datalists() {
    const all = await DB.listItems();
    const uniq = (k) => Array.from(new Set(all.map((x) => x[k]).filter(Boolean))).slice(0, 50);
    const dl = (id, vals) => '<datalist id="' + id + '">' + vals.map((v) => '<option value="' + esc(v) + '">').join('') + '</datalist>';
    return dl('dl-titles', uniq('title')) + dl('dl-sellers', uniq('seller')) + dl('dl-buyers', uniq('buyer')) +
      dl('dl-storage', ['64GB', '128GB', '256GB', '512GB', '1TB']) +
      dl('dl-carrier', Array.from(new Set(['Unlocked', 'AT&T', 'Verizon', 'T-Mobile', 'Locked', 'iCloud locked'].concat(uniq('carrier'))))) +
      dl('dl-condition', Array.from(new Set(['New sealed', 'Open box', 'A', 'B', 'C', 'Cracked', 'Damaged box'].concat(uniq('condition')))));
  }

  // ---------- Settings / Backup ----------
  async function renderSettings() {
    setTab('settings'); setTop('Backup & settings');
    const r = rules();
    const ver = await DB.getSchemaVersion();
    const lastExport = await DB.getMeta('lastExportAt');
    main.innerHTML =
      '<div class="card"><h3 style="margin:0 0 6px">Backup</h3>' +
        '<p class="small muted">All data lives only on this phone. Export a backup regularly and save it to Files / iCloud Drive.</p>' +
        '<p class="small">Last export: <b data-testid="last-export">' + (lastExport ? esc(new Date(lastExport).toLocaleString()) : 'never') + '</b></p>' +
        '<div class="actions"><button class="btn primary" id="export" data-testid="export-btn">Export backup</button>' +
        '<button class="btn" id="import" data-testid="import-btn">Import backup</button></div>' +
        '<div id="dl-fallback" class="small" style="margin-top:8px"></div></div>' +
      '<div class="card"><h3 style="margin:0 0 6px">Storage</h3><div id="storage" class="small" data-testid="storage">Checking...</div></div>' +
      '<div class="card"><h3 style="margin:0 0 6px">Offer rules</h3><form id="rules" class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<label>Phone: sheet minus ($)<input name="phoneOfferDiscount" inputmode="decimal" value="' + esc(r.phoneOfferDiscount) + '"></label>' +
        '<label>DTS: % of sheet<input name="dtsOfferPct" inputmode="decimal" value="' + esc(r.dtsOfferPct) + '"></label>' +
        '<button class="btn" type="submit" style="grid-column:1/-1">Save rules</button></form></div>' +
      '<p class="muted small">App v' + DB.APP_VERSION + ' · Data schema v' + esc(ver) + '</p>';

    $('#export').addEventListener('click', doExport);
    $('#import').addEventListener('click', () => { const i = $('#import-file'); i.value = ''; i.click(); });
    $('#rules').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = C.parseMoney(e.target.elements.phoneOfferDiscount.value), p = C.parseMoney(e.target.elements.dtsOfferPct.value);
      if (d === null || p === null || p <= 0 || p > 100 || d < 0) { toast('Enter a valid $ amount and a % between 1 and 100'); return; }
      state.settings = await DB.saveSettings({ phoneOfferDiscount: d, dtsOfferPct: p });
      toast('Offer rules saved');
    });
    showStorage();
  }

  async function showStorage() {
    const el = $('#storage'); if (!el) return;
    const parts = [];
    try {
      let persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!persisted && navigator.storage && navigator.storage.persist) persisted = await navigator.storage.persist();
      parts.push('Persistent storage: <b>' + (persisted ? 'granted' : 'not granted') + '</b>' + (persisted ? '' : ' <span class="muted">(add to Home Screen and keep exporting backups)</span>'));
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        const mb = (b) => (b / 1048576).toFixed(b < 1048576 * 10 ? 2 : 0) + ' MB';
        parts.push('Used: <b>' + mb(e.usage || 0) + '</b> of about ' + mb(e.quota || 0) + ' available');
      } else parts.push('Storage estimate not supported in this browser.');
    } catch (err) { parts.push('Storage info unavailable.'); }
    const n = (await DB.listItems()).length;
    parts.push('Inventory records: <b>' + n + '</b>');
    el.innerHTML = parts.join('<br>');
  }

  async function doExport() {
    const data = await DB.exportBackup();
    const stamp = data.exportedAt.replace(/[:]/g, '-').slice(0, 16);
    const name = 'juan-crm-backup-' + stamp + '.json';
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    let shared = false;
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Juan CRM backup' });
        shared = true;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') { toast('Export cancelled'); return; }
    }
    if (!shared) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; a.textContent = 'Download ' + name;
      document.body.appendChild(a); a.click(); a.remove();
      $('#dl-fallback').innerHTML = 'If the download did not start: <a href="' + url + '" download="' + esc(name) + '" data-testid="dl-link">' + esc(name) + '</a>';
    }
    await DB.setMeta('lastExportAt', data.exportedAt);
    const le = $('[data-testid=last-export]'); if (le) le.textContent = new Date(data.exportedAt).toLocaleString();
    toast('Backup ready: ' + data.stores.inventory.length + ' inventory records');
  }

  async function onImportFile(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) {
      await modal('Cannot read file', '<p class="err">This is not a valid JSON backup file.</p>', [{ id: 'cancel', text: 'OK' }]); return;
    }
    const v = DB.validateBackup(data);
    if (!v.ok) { await modal('Backup not valid', '<p class="err">' + v.errors.map(esc).join('<br>') + '</p><p class="small">Nothing was changed.</p>', [{ id: 'cancel', text: 'OK' }]); return; }
    const current = (await DB.listItems()).length;
    const choice = await modal('Import backup?',
      '<p class="small">File: <b>' + esc(file.name) + '</b><br>Exported: ' + esc(v.exportedAt ? new Date(v.exportedAt).toLocaleString() : 'unknown') +
      '<br>Schema v' + v.schemaVersion + '</p>' +
      '<p data-testid="import-counts">Backup contains <b>' + v.counts.inventory + '</b> inventory records (' + v.counts.meta + ' settings rows).<br>This phone has <b>' + current + '</b> records now.</p>' +
      '<p class="small muted"><b>Merge</b> adds new records and updates ones with the same id (newer edit wins). <b>Replace all</b> deletes everything on this phone first.</p>',
      [{ id: 'merge', text: 'Merge (by id)', cls: 'primary' }, { id: 'replace', text: 'Replace all', cls: 'danger' }, { id: 'cancel', text: 'Cancel' }]);
    if (!choice) return;
    if (choice === 'replace' && current > 0) {
      const sure = await modal('Replace all data?', '<p>This deletes the ' + current + ' records on this phone and loads the ' + v.counts.inventory + ' from the backup. Export first if unsure.</p>',
        [{ id: 'yes', text: 'Yes, replace all', cls: 'danger solid' }, { id: 'cancel', text: 'Cancel' }]);
      if (sure !== 'yes') return;
    }
    try {
      const res = await DB.importBackup(data, choice);
      state.settings = await DB.getSettings();
      toast(choice === 'replace' ? 'Replaced: ' + res.added + ' records loaded' : 'Merged: ' + res.added + ' added, ' + res.updated + ' updated, ' + res.skipped + ' kept (newer here)', 4000);
      route();
    } catch (err) {
      await modal('Import failed', '<p class="err">' + esc(err.message) + '</p><p class="small">Nothing was changed.</p>', [{ id: 'cancel', text: 'OK' }]);
    }
  }
  $('#import-file').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onImportFile(f); });

  // ---------- Router ----------
  async function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [page, id] = h.split('/');
    window.scrollTo(0, 0);
    try {
      if (page === 'new') await renderForm(null);
      else if (page === 'edit' && id) await renderForm(decodeURIComponent(id));
      else if (page === 'item' && id) await renderView(decodeURIComponent(id));
      else if (page === 'settings') await renderSettings();
      else await renderList();
    } catch (err) {
      console.warn(err);
      main.innerHTML = '<div class="card err">Something went wrong: ' + esc(err && err.message) + '</div>';
    }
  }
  window.addEventListener('hashchange', route);

  async function start() {
    try { await DB.openDb(); state.settings = await DB.getSettings(); }
    catch (err) { main.innerHTML = '<div class="card err">Storage is unavailable (' + esc(err.message) + '). Private Browsing can block it.</div>'; return; }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    route();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) toast('App updated. Reopen to use the new version.', 5000); });
    }
  }
  start();
  window.__crm = { route, state };
})();
