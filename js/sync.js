'use strict';
/* =====================================================================
   Modo compartido (compu + celular)
   Cuando la app se abre desde la dirección que muestra COMPARTIR-CON-CELULAR.bat
   (http://...:8787), cada cambio se guarda también en la compu y les llega
   solo a los demás aparatos conectados a la misma red Wi-Fi.
   Abierta con doble clic en index.html funciona como siempre (solo este navegador).
   ===================================================================== */
const Sync = (() => {
  const on = /^https?:$/.test(location.protocol);
  const META = '_sync';
  const raw = {};
  const P = { products: new Set(), deleted: new Set(), cleared: false, kv: new Set(), kvCleared: false };
  let sending = null;
  let rev = 0, ready = false, busy = false, again = false, needReload = false, timer = null, state = '';
  let opts = {};

  const isLocalKey = (k) => String(k)[0] === '_';
  const hasPending = () => P.cleared || P.kvCleared || P.products.size > 0 || P.deleted.size > 0 || P.kv.size > 0;

  /* ---------- Qué cambió en este aparato y todavía no llegó a la compu ---------- */
  function saveMeta() {
    const all = { products: new Set(P.products), deleted: new Set(P.deleted), kv: new Set(P.kv), cleared: P.cleared, kvCleared: P.kvCleared };
    if (sending) {
      if (sending.cleared) all.cleared = true;
      if (sending.kvCleared) all.kvCleared = true;
      sending.products.forEach((id) => { if (!P.deleted.has(id)) all.products.add(id); });
      sending.deleted.forEach((id) => { if (!P.products.has(id)) all.deleted.add(id); });
      sending.kv.forEach((k) => all.kv.add(k));
    }
    return raw.kvSet(META, { rev, products: [...all.products], deleted: [...all.deleted], kv: [...all.kv], cleared: all.cleared, kvCleared: all.kvCleared })
      .catch(() => {});
  }
  function takePending() {
    sending = { products: new Set(P.products), deleted: new Set(P.deleted), kv: new Set(P.kv), cleared: P.cleared, kvCleared: P.kvCleared };
    P.products.clear(); P.deleted.clear(); P.kv.clear(); P.cleared = false; P.kvCleared = false;
  }
  /* Si no se pudo mandar, lo devuelvo a pendientes (lo que cambió después manda) */
  function giveBack() {
    const s = sending;
    sending = null;
    if (!s) return;
    if (P.cleared) return;
    if (s.cleared) P.cleared = true;
    s.products.forEach((id) => { if (!P.deleted.has(id)) P.products.add(id); });
    s.deleted.forEach((id) => { if (!P.products.has(id)) P.deleted.add(id); });
    if (!P.kvCleared) {
      if (s.kvCleared) P.kvCleared = true;
      s.kv.forEach((k) => P.kv.add(k));
    }
  }
  function changed() {
    saveMeta();
    schedule(600);
  }
  function wrap() {
    for (const k of ['putProducts', 'deleteProducts', 'clearProducts', 'kvSet', 'kvClear']) raw[k] = DB[k];
    DB.putProducts = async (list) => {
      await raw.putProducts(list);
      for (const p of list) { P.products.add(p.id); P.deleted.delete(p.id); }
      changed();
    };
    DB.deleteProducts = async (ids) => {
      await raw.deleteProducts(ids);
      for (const id of ids) { P.deleted.add(id); P.products.delete(id); }
      changed();
    };
    DB.clearProducts = async () => {
      await raw.clearProducts();
      P.cleared = true; P.products.clear(); P.deleted.clear();
      changed();
    };
    DB.kvSet = async (k, v) => {
      await raw.kvSet(k, v);
      if (isLocalKey(k)) return;
      P.kv.add(k);
      changed();
    };
    DB.kvClear = async () => {
      await raw.kvClear();
      P.kvCleared = true; P.kv.clear();
      changed();
    };
  }

  /* ---------- Hablar con la compu ---------- */
  async function api(path, init) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await fetch('api/' + path, Object.assign({ cache: 'no-store', signal: ctl.signal }, init || {}));
      if (r.status === 409) { const e = new Error('Otro aparato guardó antes'); e.conflict = true; throw e; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }
  async function snapshot() {
    const products = await DB.getAllProducts();
    const all = await DB.kvAll();
    const kv = {};
    for (const k of Object.keys(all)) if (!isLocalKey(k)) kv[k] = all[k];
    return { products, kv };
  }
  /* Lo de la compu + lo que cambié acá y todavía no mandé (lo mío gana) */
  function merge(srv, localProducts, localKv) {
    const map = new Map();
    if (!P.cleared) for (const p of (srv && srv.products) || []) map.set(p.id, p);
    for (const id of P.deleted) map.delete(id);
    if (P.products.size) {
      const lmap = new Map(localProducts.map((p) => [p.id, p]));
      for (const id of P.products) { const p = lmap.get(id); if (p) map.set(id, p); }
    }
    const kv = P.kvCleared ? {} : Object.assign({}, (srv && srv.kv) || {});
    for (const k of P.kv) if (k in localKv) kv[k] = localKv[k];
    return { products: [...map.values()], kv };
  }
  async function applyServer(srv) {
    await DB.transformAll((lp, lkv) => merge(srv.data, lp, lkv));
    rev = srv.rev;
    await saveMeta();
    needReload = true;
  }
  /* La compu no tiene nada (primera vez, o borraron la carpeta de datos): le mando todo lo de acá */
  async function markAll(serverRev) {
    rev = serverRev || 0;
    const s = await snapshot();
    for (const p of s.products) P.products.add(p.id);
    for (const k of Object.keys(s.kv)) P.kv.add(k);
    await saveMeta();
  }
  async function push() {
    takePending();
    setState('saving');
    try {
      const data = await snapshot();
      const r = await api('data?base=' + rev, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data) });
      sending = null;
      rev = r.rev;
      await saveMeta();
    } catch (e) {
      giveBack();
      await saveMeta();
      if (!e.conflict) throw e;
      // Otro aparato guardó mientras tanto: traigo lo suyo, le sumo lo mío y vuelvo a mandar
      const srv = await api('data');
      if (!srv.data) await markAll(srv.rev); else await applyServer(srv);
      again = true;
    }
  }
  async function pull() {
    const r = await api('rev');
    if (r.rev === rev) return;
    const srv = await api('data');
    if (!srv.data) { await markAll(srv.rev); again = true; return; }
    await applyServer(srv);
    if (hasPending()) again = true;
  }

  async function tick() {
    if (!on || !ready) return;
    if (busy) { again = true; return; }
    busy = true;
    clearTimeout(timer);
    let ok = true;
    try {
      do {
        again = false;
        if (hasPending()) await push(); else await pull();
      } while (again);
    } catch (e) {
      ok = false;
    } finally {
      busy = false;
    }
    setState(ok ? 'ok' : 'offline');
    maybeReload();
    schedule(!ok ? 5000 : hasPending() ? 600 : document.hidden ? 30000 : 3000);
  }
  function schedule(ms) {
    if (!on || !ready) return;
    clearTimeout(timer);
    timer = setTimeout(tick, ms);
  }
  function maybeReload() {
    if (!needReload || !opts.onRemote) return;
    if (opts.canApply && !opts.canApply()) return;
    needReload = false;
    Promise.resolve(opts.onRemote()).catch((e) => console.error(e));
  }
  function setState(s) {
    if (s === state) return;
    state = s;
    if (opts.onState) opts.onState(s);
  }

  /* ---------- Arranque: antes de que la app lea los datos ---------- */
  async function start(o) {
    opts = o || {};
    if (!on) return false;
    wrap();
    const m = await DB.kvGet(META).catch(() => null);
    if (m) {
      rev = m.rev || 0;
      (m.products || []).forEach((id) => P.products.add(id));
      (m.deleted || []).forEach((id) => P.deleted.add(id));
      (m.kv || []).forEach((k) => P.kv.add(k));
      P.cleared = !!m.cleared;
      P.kvCleared = !!m.kvCleared;
    }
    setState('saving');
    try {
      const srv = await api('data');
      if (!srv.data) await markAll(srv.rev);
      else if (srv.rev !== rev) await applyServer(srv);
      needReload = false; // la app todavía no cargó: va a leer lo nuevo igual
      setState('ok');
    } catch (e) {
      setState('offline');
    }
    ready = true;
    schedule(hasPending() ? 300 : 3000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); else if (hasPending()) tick(); });
    window.addEventListener('online', tick);
    window.addEventListener('focus', tick);
    return true;
  }

  return {
    on,
    start,
    /* Para cuando se cierra un diálogo o la vista de hoja: aplicar lo que llegó mientras tanto */
    check: () => { maybeReload(); if (ready) schedule(100); },
    state: () => state,
    info: () => api('info'),
  };
})();
