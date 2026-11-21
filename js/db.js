'use strict';
/* Base de datos local (IndexedDB). Aguanta cientos de miles de artículos sin problema. */
const DB = (() => {
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('paraimprimir', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('products')) d.createObjectStore('products', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => { db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  function run(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const s = tx.objectStore(store);
      let result;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  const clean = (p) => { const o = Object.assign({}, p); for (const k of Object.keys(o)) if (k[0] === '_') delete o[k]; return o; };

  return {
    open,
    getAllProducts: () => run('products', 'readonly', (s) => s.getAll()),
    putProducts: (list) => run('products', 'readwrite', (s) => { for (const p of list) s.put(clean(p)); }),
    deleteProducts: (ids) => run('products', 'readwrite', (s) => { for (const id of ids) s.delete(id); }),
    clearProducts: () => run('products', 'readwrite', (s) => s.clear()),
    kvGet: (k) => run('kv', 'readonly', (s) => s.get(k)),
    kvSet: (k, v) => run('kv', 'readwrite', (s) => s.put(v, k)),
    kvClear: () => run('kv', 'readwrite', (s) => s.clear()),
    /* Para el modo compartido (sync.js). Las claves que empiezan con "_" son de este aparato y no se tocan. */
    kvAll: () => new Promise((resolve, reject) => {
      const out = {};
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    }),
    /* Lee todo y lo reemplaza por fn(productos, kv) en una sola transacción, sin que nada se meta en el medio. */
    transformAll: (fn) => new Promise((resolve, reject) => {
      const tx = db.transaction(['products', 'kv'], 'readwrite');
      const ps = tx.objectStore('products');
      const ks = tx.objectStore('kv');
      let products, keys, vals, n = 0;
      const go = () => {
        if (++n < 3) return;
        const kv = {};
        keys.forEach((k, i) => { if (String(k)[0] !== '_') kv[k] = vals[i]; });
        const out = fn(products, kv);
        ps.clear();
        for (const p of out.products) ps.put(clean(p));
        for (const k of keys) if (String(k)[0] !== '_') ks.delete(k);
        for (const k of Object.keys(out.kv)) if (k[0] !== '_') ks.put(out.kv[k], k);
      };
      const a = ps.getAll(); a.onsuccess = () => { products = a.result; go(); };
      const b = ks.getAllKeys(); b.onsuccess = () => { keys = b.result; go(); };
      const c = ks.getAll(); c.onsuccess = () => { vals = c.result; go(); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }),
  };
})();
