/* Juan CRM - IndexedDB data layer with versioned schema + migration framework.
 * Browser: window.CrmDB. Node (tests): require('./db.js') with a global indexedDB (fake-indexeddb).
 *
 * HOW TO ADD A SCHEMA VERSION LATER (e.g. Step 2 contacts):
 *   1. Bump SCHEMA_VERSION to 2.
 *   2. Add MIGRATIONS[2] = function (db, tx) { db.createObjectStore('contacts', { keyPath: 'id' }) ... }
 *      Only ADD stores/indexes or transform records in place via tx.objectStore(...).openCursor().
 *      Never delete a store holding user data.
 *   3. Add BACKUP_MIGRATIONS[2] = function (backup) { ...; return backup; } so older JSON backups import cleanly.
 *   4. Add the new store name to STORES.
 * IndexedDB runs every migration from (oldVersion + 1) to SCHEMA_VERSION in order, inside the
 * upgrade transaction, so existing records are kept.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.CrmDB = factory(root);
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const APP_ID = 'juan-crm';
  const APP_VERSION = '1.1.0';
  const DB_NAME = 'juan-crm-db';
  const SCHEMA_VERSION = 2;
  const STORE_INVENTORY = 'inventory';
  const STORE_META = 'meta';
  const STORE_PRICESHEETS = 'priceSheets';
  const STORES = [STORE_INVENTORY, STORE_META, STORE_PRICESHEETS];

  const CATEGORIES = [
    { id: 'phone', label: 'Phone' },
    { id: 'dts', label: 'DTS / Diabetic supplies' },
    { id: 'other', label: 'Other' },
  ];
  const STATUSES = [
    { id: 'bought', label: 'Bought' },
    { id: 'in_stock', label: 'In stock' },
    { id: 'listed', label: 'Listed' },
    { id: 'sold', label: 'Sold' },
    { id: 'paid', label: 'Paid' },
  ];

  // Schema migrations: key = version being upgraded TO.
  const MIGRATIONS = {
    1: function (db) {
      const inv = db.createObjectStore(STORE_INVENTORY, { keyPath: 'id' });
      inv.createIndex('status', 'status', { unique: false });
      inv.createIndex('category', 'category', { unique: false });
      inv.createIndex('updatedAt', 'updatedAt', { unique: false });
      inv.createIndex('serial', 'serial', { unique: false });
      // Link fields for later steps (contacts / price sheets / deals):
      inv.createIndex('sellerId', 'sellerId', { unique: false });
      inv.createIndex('buyerId', 'buyerId', { unique: false });
      db.createObjectStore(STORE_META, { keyPath: 'key' });
    },
    // v2 (Step 2, Offer tab): additive store for uploaded / bundled buyer price sheets. Inventory untouched.
    2: function (db) {
      if (!db.objectStoreNames.contains(STORE_PRICESHEETS)) {
        const ps = db.createObjectStore(STORE_PRICESHEETS, { keyPath: 'id' });
        ps.createIndex('sheetDate', 'sheetDate', { unique: false });
        ps.createIndex('kind', 'kind', { unique: false });
      }
    },
  };

  // Backup-file migrations: upgrade an exported JSON from older schemaVersion to current.
  const BACKUP_MIGRATIONS = {
    2: function (backup) { backup.stores.priceSheets = backup.stores.priceSheets || []; return backup; },
  };

  // Every inventory field. Records are plain objects; unknown extra fields are preserved.
  const INVENTORY_FIELDS = {
    id: null,
    category: 'phone',        // phone | dts | other
    title: '',                // model (phone) or product name (DTS/other)
    brand: '',
    storage: '',              // phone
    color: '',                // phone
    carrier: '',              // phone: carrier / lock status (e.g. "Unlocked", "AT&T locked")
    boxSize: '',              // DTS: e.g. "100 ct", "50 ct"
    qty: 1,                   // units in this record (1 for a phone, N for a lot)
    serial: '',               // IMEI / serial / lot number
    expirationDate: '',       // DTS
    condition: '',
    status: 'bought',         // bought | in_stock | listed | sold | paid
    seller: '',               // free-text name now...
    sellerId: null,           // ...contact id in a later step
    purchaseDate: '',
    cost: null,               // total paid for this record
    sheetPrice: null,         // per-unit sheet price at purchase
    offer: null,              // per-unit offer at purchase
    priceSheetId: null,       // link to a price sheet (later step)
    buyer: '',
    buyerId: null,
    saleDate: '',
    salePrice: null,          // total sale price for this record
    fees: null,
    shipping: null,
    notes: '',
    dealId: null,             // link to deals / real estate (later step)
    createdAt: null,
    updatedAt: null,
  };

  function idb() {
    const f = root.indexedDB || (typeof globalThis !== 'undefined' && globalThis.indexedDB);
    if (!f) throw new Error('IndexedDB is not available in this browser.');
    return f;
  }

  function newId() {
    const c = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
    if (c && c.randomUUID) return c.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function nowIso() { return new Date().toISOString(); }

  let dbPromise = null;
  let openOptions = {};

  // options (tests only): { name, version, migrations }
  function configure(options) {
    close();
    openOptions = options || {};
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    const name = openOptions.name || DB_NAME;
    const version = openOptions.version || SCHEMA_VERSION;
    const migrations = openOptions.migrations || MIGRATIONS;
    dbPromise = new Promise(function (resolve, reject) {
      const req = idb().open(name, version);
      req.onupgradeneeded = function (event) {
        const db = req.result;
        const tx = req.transaction;
        const from = event.oldVersion || 0;
        const to = event.newVersion || version;
        for (let v = from + 1; v <= to; v++) {
          const m = migrations[v];
          if (typeof m !== 'function') throw new Error('Missing migration for schema v' + v);
          m(db, tx, from);
        }
        const meta = tx.objectStore(STORE_META);
        meta.put({ key: 'schemaVersion', value: to, migratedAt: nowIso(), from: from });
        const hist = meta.get('migrationLog');
        hist.onsuccess = function () {
          const log = (hist.result && hist.result.value) || [];
          log.push({ from: from, to: to, at: nowIso() });
          meta.put({ key: 'migrationLog', value: log });
        };
      };
      req.onsuccess = function () {
        const db = req.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { dbPromise = null; reject(req.error || new Error('Failed to open database')); };
      req.onblocked = function () { /* another tab holds an older version; it will close on versionchange */ };
    });
    return dbPromise;
  }

  function close() {
    if (dbPromise) {
      const p = dbPromise;
      dbPromise = null;
      return p.then(function (db) { db.close(); }).catch(function () {});
    }
    return Promise.resolve();
  }

  function deleteDatabase(name) {
    return close().then(function () {
      return new Promise(function (resolve, reject) {
        const req = idb().deleteDatabase(name || openOptions.name || DB_NAME);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
        req.onblocked = function () { resolve(); };
      });
    });
  }

  // Run fn(stores) in one transaction; resolve with fn's return value after commit.
  function tx(storeNames, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(storeNames, mode);
        const stores = {};
        [].concat(storeNames).forEach(function (n) { stores[n] = t.objectStore(n); });
        let out;
        try { out = fn(stores, t); } catch (e) { try { t.abort(); } catch (_) {} reject(e); return; }
        t.oncomplete = function () {
          if (out && typeof out === 'object' && 'result' in out && out.onsuccess !== undefined) resolve(out.result);
          else resolve(out);
        };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Transaction aborted')); };
      });
    });
  }

  function getAll(store) { return tx(store, 'readonly', function (s) { return s[store].getAll(); }); }
  function get(store, key) {
    return tx(store, 'readonly', function (s) { return s[store].get(key); }).then(function (r) { return r === undefined ? null : r; });
  }

  // ----- meta / settings -----
  function getMeta(key) { return get(STORE_META, key).then(function (r) { return r ? r.value : null; }); }
  function setMeta(key, value) {
    return tx(STORE_META, 'readwrite', function (s) { s[STORE_META].put({ key: key, value: value }); }).then(function () { return value; });
  }
  function getSettings() { return getMeta('settings').then(function (v) { return v || {}; }); }
  function saveSettings(patch) {
    return getSettings().then(function (cur) { return setMeta('settings', Object.assign({}, cur, patch)); });
  }
  function getSchemaVersion() { return getMeta('schemaVersion'); }

  // ----- inventory -----
  const MONEY = ['cost', 'sheetPrice', 'offer', 'salePrice', 'fees', 'shipping'];

  function normalizeItem(input, existing) {
    const base = Object.assign({}, INVENTORY_FIELDS, existing || {}, input || {});
    MONEY.forEach(function (k) {
      const v = base[k];
      if (v === '' || v === undefined) base[k] = null;
      else if (v !== null) {
        const n = Number(String(v).replace(/[$,\s]/g, ''));
        base[k] = Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
      }
    });
    const q = Number(base.qty);
    base.qty = Number.isFinite(q) && q > 0 ? q : 1;
    if (!CATEGORIES.some(function (c) { return c.id === base.category; })) base.category = 'other';
    if (!STATUSES.some(function (c) { return c.id === base.status; })) base.status = 'bought';
    return base;
  }

  function saveItem(input) {
    const id = input && input.id;
    const load = id ? get(STORE_INVENTORY, id) : Promise.resolve(null);
    return load.then(function (existing) {
      const rec = normalizeItem(input, existing);
      const now = nowIso();
      rec.id = rec.id || newId();
      rec.createdAt = (existing && existing.createdAt) || rec.createdAt || now;
      rec.updatedAt = now;
      return tx(STORE_INVENTORY, 'readwrite', function (s) { s[STORE_INVENTORY].put(rec); }).then(function () { return rec; });
    });
  }

  function getItem(id) { return get(STORE_INVENTORY, id); }

  function listItems(filter) {
    const f = filter || {};
    return getAll(STORE_INVENTORY).then(function (rows) {
      const q = (f.q || '').trim().toLowerCase();
      return rows.filter(function (r) {
        if (f.status && r.status !== f.status) return false;
        if (f.category && r.category !== f.category) return false;
        if (q) {
          const hay = [r.title, r.brand, r.storage, r.color, r.carrier, r.boxSize, r.serial, r.seller, r.buyer, r.condition, r.notes]
            .join(' ').toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      }).sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    });
  }

  function deleteItem(id) {
    return tx(STORE_INVENTORY, 'readwrite', function (s) { s[STORE_INVENTORY].delete(id); });
  }

  // ----- price sheets (v2) -----
  function savePriceSheet(rec) {
    if (!rec || !rec.id) return Promise.reject(new Error('Price sheet needs an id'));
    const r = Object.assign({ uploadedAt: nowIso() }, rec);
    return tx(STORE_PRICESHEETS, 'readwrite', function (s) { s[STORE_PRICESHEETS].put(r); }).then(function () { return r; });
  }
  function getPriceSheet(id) { return get(STORE_PRICESHEETS, id); }
  function listPriceSheets() {
    return getAll(STORE_PRICESHEETS).then(function (rows) {
      return rows.map(function (r) { return { id: r.id, kind: r.kind, sheetDate: r.sheetDate, uploadedAt: r.uploadedAt, source: r.source, buyers: r.buyers }; })
        .sort(function (a, b) { return String(b.sheetDate).localeCompare(String(a.sheetDate)) || String(b.uploadedAt).localeCompare(String(a.uploadedAt)); });
    });
  }
  function getLatestPriceSheet(kind) {
    return getAll(STORE_PRICESHEETS).then(function (rows) {
      const list = rows.filter(function (r) { return !kind || r.kind === kind; })
        .sort(function (a, b) { return String(b.sheetDate).localeCompare(String(a.sheetDate)) || String(b.uploadedAt).localeCompare(String(a.uploadedAt)); });
      return list[0] || null;
    });
  }

  // ----- backup -----
  function exportBackup() {
    return tx(STORES, 'readonly', function (s) {
      const out = {};
      STORES.forEach(function (n) { out[n] = s[n].getAll(); });
      return out;
    }).then(function (reqs) {
      const stores = {};
      STORES.forEach(function (n) { stores[n] = reqs[n].result || []; });
      return { app: APP_ID, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), stores: stores };
    });
  }

  function validateBackup(data) {
    const errors = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['File is not a Juan CRM backup (not a JSON object).'] };
    if (data.app && data.app !== APP_ID) errors.push('This backup is from a different app ("' + data.app + '").');
    if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) errors.push('Missing or invalid schemaVersion.');
    else if (data.schemaVersion > SCHEMA_VERSION) errors.push('Backup is from a newer app version (schema v' + data.schemaVersion + '). Update the app first.');
    if (!data.stores || typeof data.stores !== 'object') errors.push('Missing "stores".');
    else {
      Object.keys(data.stores).forEach(function (n) {
        if (!Array.isArray(data.stores[n])) errors.push('Store "' + n + '" is not a list.');
      });
      (Array.isArray(data.stores[STORE_INVENTORY]) ? data.stores[STORE_INVENTORY] : []).forEach(function (r, i) {
        if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) errors.push('Inventory record #' + (i + 1) + ' has no id.');
      });
      (Array.isArray(data.stores[STORE_PRICESHEETS]) ? data.stores[STORE_PRICESHEETS] : []).forEach(function (r, i) {
        if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !r.id) errors.push('Price sheet #' + (i + 1) + ' has no id.');
      });
      (Array.isArray(data.stores[STORE_META]) ? data.stores[STORE_META] : []).forEach(function (r, i) {
        if (!r || typeof r !== 'object' || typeof r.key !== 'string') errors.push('Meta record #' + (i + 1) + ' has no key.');
      });
    }
    const counts = {};
    if (data.stores && typeof data.stores === 'object') {
      STORES.forEach(function (n) { counts[n] = Array.isArray(data.stores[n]) ? data.stores[n].length : 0; });
    }
    return { ok: errors.length === 0, errors: errors.slice(0, 10), counts: counts, schemaVersion: data.schemaVersion, exportedAt: data.exportedAt || null };
  }

  function migrateBackup(data) {
    let b = JSON.parse(JSON.stringify(data));
    for (let v = b.schemaVersion + 1; v <= SCHEMA_VERSION; v++) {
      if (BACKUP_MIGRATIONS[v]) b = BACKUP_MIGRATIONS[v](b);
      b.schemaVersion = v;
    }
    return b;
  }

  const PROTECTED_META = ['schemaVersion', 'migrationLog'];

  // mode: 'replace' (wipe and load) or 'merge' (upsert by id; newer updatedAt wins, ties go to the file).
  function importBackup(data, mode) {
    const v = validateBackup(data);
    if (!v.ok) return Promise.reject(new Error(v.errors.join(' ')));
    if (mode !== 'replace' && mode !== 'merge') return Promise.reject(new Error('Import mode must be "replace" or "merge".'));
    const b = migrateBackup(data);
    const inv = b.stores[STORE_INVENTORY] || [];
    const meta = (b.stores[STORE_META] || []).filter(function (m) { return PROTECTED_META.indexOf(m.key) === -1; });
    const sheets = b.stores[STORE_PRICESHEETS] || [];
    const result = { mode: mode, added: 0, updated: 0, skipped: 0, removed: 0, priceSheets: 0 };

    return Promise.all([getAll(STORE_INVENTORY), getAll(STORE_PRICESHEETS)]).then(function (both) {
      const current = both[0];
      const sheetIds = {};
      both[1].forEach(function (r) { sheetIds[r.id] = r; });
      const byId = {};
      current.forEach(function (r) { byId[r.id] = r; });
      return tx(STORES, 'readwrite', function (s) {
        // Price sheets: replace keeps the backup's set (plus nothing else); merge adds ones not already here.
        if (mode === 'replace' && sheets.length) s[STORE_PRICESHEETS].clear();
        sheets.forEach(function (r) {
          if (mode === 'replace' || !sheetIds[r.id]) { s[STORE_PRICESHEETS].put(r); result.priceSheets++; }
        });
        if (mode === 'replace') {
          result.removed = current.length;
          s[STORE_INVENTORY].clear();
          inv.forEach(function (r) { s[STORE_INVENTORY].put(normalizeItem(r)); result.added++; });
          meta.forEach(function (m) { s[STORE_META].put(m); });
        } else {
          inv.forEach(function (r) {
            const ex = byId[r.id];
            if (!ex) { s[STORE_INVENTORY].put(normalizeItem(r)); result.added++; }
            else if (String(r.updatedAt || '') >= String(ex.updatedAt || '')) { s[STORE_INVENTORY].put(normalizeItem(r)); result.updated++; }
            else result.skipped++;
          });
          meta.forEach(function (m) {
            if (m.key === 'settings') {
              const g = s[STORE_META].get('settings');
              g.onsuccess = function () {
                const cur = (g.result && g.result.value) || {};
                s[STORE_META].put({ key: 'settings', value: Object.assign({}, cur, m.value || {}) });
              };
            } else s[STORE_META].put(m);
          });
        }
      }).then(function () { return result; });
    });
  }

  return {
    APP_ID, APP_VERSION, DB_NAME, SCHEMA_VERSION, STORES, STORE_INVENTORY, STORE_META, STORE_PRICESHEETS,
    CATEGORIES, STATUSES, INVENTORY_FIELDS, MIGRATIONS, BACKUP_MIGRATIONS,
    configure, openDb, close, deleteDatabase,
    getMeta, setMeta, getSettings, saveSettings, getSchemaVersion,
    normalizeItem, saveItem, getItem, listItems, deleteItem,
    savePriceSheet, getPriceSheet, listPriceSheets, getLatestPriceSheet,
    exportBackup, validateBackup, migrateBackup, importBackup,
  };
});
