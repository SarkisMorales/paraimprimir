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
  };
})();
