'use strict';
/* =====================================================================
   Precios para góndola — lógica de la aplicación
   ===================================================================== */

const S = { products: [], byId: new Map(), templates: [], settings: null, queue: [], catMap: {}, lastBulk: null, tab: 'imprimir' };

const DEFAULT_SETTINGS = {
  paper: 'A4', orient: 'portrait', margin: 6, gap: 2, cutLines: true, optimize: true,
  currency: '$', decimals: 'auto', roundTo: 10, roundMode: 'up',
  defaultTpl: '', lastBackup: 0, snoozeBackup: 0, importMap: null,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const COLL = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const DAY = 86400000;

/* ---------------- Guardado ---------------- */
const saveSettings = () => DB.kvSet('settings', S.settings);
const saveQueue = () => DB.kvSet('queue', S.queue);
const saveCatMap = () => DB.kvSet('catMap', S.catMap);
const saveTemplatesNow = () => DB.kvSet('templates', S.templates);
const saveTemplates = U.debounce(saveTemplatesNow, 300);

/* ---------------- Artículos ---------------- */
function indexProduct(p) {
  p._n = U.norm(p.name);
  p._c = U.normCode(p.code);
  p._b = U.normCode(p.barcode);
  p._h = [p._n, p._c, p._b, U.norm(p.category)].join(' ');
}
function newProduct(o) {
  const now = Date.now();
  const p = Object.assign({ id: U.uid('p'), code: '', barcode: '', name: '', price: 0, prevPrice: null, offer: null, category: '',
    tpl: '', content: null, unit: '', createdAt: now, updatedAt: now }, o);
  indexProduct(p);
  S.products.push(p);
  S.byId.set(p.id, p);
  return p;
}
async function saveProducts(list) {
  list.forEach(indexProduct);
  await DB.putProducts(list);
  updateCounts();
}
function setPrice(p, price) {
  if (!(price >= 0) || price === p.price) return false;
  p.prevPrice = p.price;
  p.price = price;
  p.updatedAt = Date.now();
  return true;
}
/* ---------------- Control de errores de tipeo en precios ---------------- */
// Si el precio nuevo es el doble o más, o la mitad o menos, suele ser un cero de más o de menos.
const bigJump = (oldP, newP) => oldP > 0 && newP > 0 && (newP >= oldP * 2 || newP <= oldP / 2);
const pctTxt = (oldP, newP) => { const d = Math.round((newP / oldP - 1) * 100); return (d > 0 ? '+' : '') + d + '%'; };
function confirmJump(p, newP) {
  if (!bigJump(p.price, newP)) return Promise.resolve(true);
  return confirmDlg(`<b>${U.esc(p.name)}</b> pasa de <b>${U.esc(U.fmt(p.price, S.settings))}</b> a <b>${U.esc(U.fmt(newP, S.settings))}</b> (${pctTxt(p.price, newP)}).<br><br>¿Está bien? A veces es un cero de más o de menos.`, 'Sí, está bien');
}
// La oferta tiene que ser más barata que el precio normal
const badOffer = (offer, price) => offer > 0 && price > 0 && offer >= price;
const offerMsg = (offer, price) => `La oferta (${U.esc(U.fmt(offer, S.settings))}) tiene que ser más barata que el precio (${U.esc(U.fmt(price, S.settings))}).`;
function warnOffer(p) {
  if (badOffer(p.offer, p.price)) toast(`Ojo: “${U.esc(p.name)}” tiene una oferta de ${U.esc(U.fmt(p.offer, S.settings))}, igual o más cara que el precio nuevo. Revisala.`, { ms: 7000 });
}

const isPending = (p) => p.printedPrice !== p.price || (p.offer ?? null) !== (p.printedOffer ?? null);
function markPrinted(list) {
  for (const p of list) { p.printedPrice = p.price; p.printedOffer = p.offer ?? null; }
  return saveProducts(list);
}
/* Borra artículos del catálogo (y de la cola). Deja un botón "Deshacer" unos segundos. */
async function removeProducts(list, msg) {
  const ids = new Set(list.map((p) => p.id));
  const qGone = S.queue.filter((q) => ids.has(q.pid));
  const snap = list.map(plainProduct);
  await DB.deleteProducts([...ids]);
  S.products = S.products.filter((p) => !ids.has(p.id));
  ids.forEach((id) => { S.byId.delete(id); C.sel.delete(id); });
  S.queue = S.queue.filter((q) => !ids.has(q.pid));
  saveQueue();
  updateCounts();
  toast(msg, { ms: 10000, action: { label: 'Deshacer', fn: async () => {
    const back = snap.filter((o) => !S.byId.has(o.id)).map((o) => newProduct(o));
    await saveProducts(back);
    for (const q of qGone) if (!S.queue.some((x) => x.id === q.id)) S.queue.push(q);
    saveQueue();
    refreshView();
    toast(back.length === 1 ? `“${U.esc(back[0].name)}” volvió al catálogo` : `${back.length} artículos volvieron al catálogo`);
  } } });
}
/* Vuelve a dibujar lo que se está viendo (después de deshacer algo) */
function refreshView() {
  if (!$('#printView').hidden) {
    if (!S.queue.some((x) => x.id === PV.selQ)) PV.selQ = null;
    buildSheets();
    renderSide();
    return;
  }
  updateCounts();
  if (S.tab === 'imprimir') renderQueue();
  else if (S.tab === 'catalogo') renderCatalog();
  else if (S.tab === 'plantillas') renderTemplatesTab();
}
function findByCode(q) {
  const c = U.normCode(q);
  if (!c) return null;
  return S.products.find((p) => p._c === c) || S.products.find((p) => p._b === c) || null;
}
function findByName(q) {
  const n = U.norm(q);
  return n ? S.products.find((p) => p._n === n) || null : null;
}
function categories() {
  const m = new Map();
  for (const p of S.products) if (p.category) m.set(p.category, (m.get(p.category) || 0) + 1);
  return [...m.entries()].sort((a, b) => COLL.compare(a[0], b[0]));
}
function statusOk(p, s) {
  switch (s) {
    case 'pending': return isPending(p);
    case 'recent': return p.prevPrice != null && p.updatedAt > Date.now() - 7 * DAY;
    case 'offer': return p.offer > 0;
    case 'nocat': return !p.category;
    default: return true;
  }
}
/* Búsqueda: todas las palabras tienen que aparecer (sin importar tildes ni mayúsculas) */
function searchProducts(q, opts = {}) {
  const nq = U.norm(q);
  const toks = nq.split(' ').filter(Boolean);
  const cq = U.normCode(q);
  const out = [];
  for (const p of S.products) {
    if (opts.cat && opts.cat !== '__all' && (p.category || '') !== opts.cat) continue;
    if (opts.status && !statusOk(p, opts.status)) continue;
    if (toks.length && !toks.every((t) => p._h.includes(t))) continue;
    out.push(p);
  }
  if (toks.length) {
    const score = (p) => (p._c === cq || p._b === cq ? 0 : p._n.startsWith(toks[0]) ? 1 : p._n.includes(' ' + toks[0]) ? 2 : 3);
    for (const p of out) p._s = score(p);
    out.sort((a, b) => a._s - b._s || COLL.compare(a.name, b.name));
  } else {
    out.sort((a, b) => COLL.compare(a.name, b.name));
  }
  return out;
}

/* ---------------- Plantillas ---------------- */
const tplById = (id) => (id ? S.templates.find((t) => t.id === id) : null);
const defaultTpl = () => tplById(S.settings.defaultTpl) || S.templates[0];
function tplFor(p, override) {
  return tplById(override) || tplById(p.tpl) || tplById(S.catMap[p.category]) || defaultTpl();
}
function labelHTML(p, t) {
  const showPrice = p.offer > 0 ? p.offer : p.price;
  const content = p.content > 0 && p.unit ? { content: p.content, unit: p.unit } : U.detectContent(p.name);
  return renderLabel({ name: p.name, price: p.price, offer: p.offer, code: p.code, unitTxt: U.unitPriceText(showPrice, content, S.settings) }, t, S.settings);
}
function tplOptions(sel, autoLabel) {
  return (autoLabel ? `<option value="">${U.esc(autoLabel)}</option>` : '')
    + S.templates.map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${U.esc(t.name)} (${t.w}×${t.h})</option>`).join('');
}
function showPreview(box, html, t, maxScale = 1.6) {
  const avail = Math.max(120, box.clientWidth - 32);
  const wpx = t.w * MM_PX, hpx = t.h * MM_PX;
  const s = Math.min(maxScale, avail / wpx);
  box.innerHTML = `<div class="scaler" style="width:${wpx * s}px;height:${hpx * s}px">${html}</div>`;
  const lbl = box.querySelector('.lbl');
  if (lbl) lbl.style.transform = `scale(${s})`;
  fitAll(box);
}

/* ---------------- Avisos, diálogos ---------------- */
function toast(msg, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${msg}</span>`;
  if (opts.action) {
    const b = document.createElement('button');
    b.textContent = opts.action.label;
    b.onclick = () => { el.remove(); opts.action.fn(); };
    el.appendChild(b);
  }
  const box = $('#toasts');
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), opts.ms || 3500);
}
function openDialog(html) {
  const d = $('#dlg');
  d.onclick = d.oninput = d.onchange = d.onkeydown = d.onclose = null;
  d.innerHTML = html;
  if (!d.open) d.showModal();
  return d;
}
const closeDialog = () => $('#dlg').close();
function confirmDlg(msg, okLabel = 'Aceptar', danger = false) {
  return new Promise((resolve) => {
    const d = openDialog(`<div class="dlg-body"><p style="font-size:15px;margin:0">${msg}</p></div>
      <div class="dlg-foot"><button data-r="0">Cancelar</button><button data-r="1" class="${danger ? 'danger' : 'primary'}">${okLabel}</button></div>`);
    d.onclick = (e) => { const r = e.target.dataset.r; if (r != null) { d.onclick = null; closeDialog(); resolve(r === '1'); } };
    d.onclose = () => resolve(false);
  });
}

/* ---------------- Encabezado y aviso de respaldo ---------------- */
function updateCounts() {
  $('#tabQ').textContent = S.queue.reduce((a, it) => a + (+it.qty || 0), 0);
  $('#tabC').textContent = S.products.length;
  $('#pendCount').textContent = S.products.filter(isPending).length;
  renderBanner();
}
function renderBanner() {
  const st = S.settings;
  const now = Date.now();
  const need = S.products.length > 0 && now - (st.lastBackup || 0) > 7 * DAY && now > (st.snoozeBackup || 0);
  if (!need) { $('#banner').innerHTML = ''; return; }
  const days = st.lastBackup ? Math.floor((now - st.lastBackup) / DAY) : null;
  $('#banner').innerHTML = `<div class="warnbar">${days == null ? 'Todavía no descargaste ninguna copia de seguridad de tus artículos.' : `Hace ${days} días que no descargás una copia de seguridad.`}
    <button class="primary small" id="bnBackup">Descargar ahora</button><button class="small ghost" id="bnLater">Recordame mañana</button></div>`;
  $('#bnBackup').onclick = downloadBackup;
  $('#bnLater').onclick = () => { st.snoozeBackup = now + DAY; saveSettings(); renderBanner(); };
}

/* ---------------- Pestañas ---------------- */
function showTab(name) {
  S.tab = name;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + name));
  ({ imprimir: renderImprimir, catalogo: renderCatalog, importar: renderLastImport, plantillas: renderTemplatesTab, ajustes: renderSettings })[name]();
}

/* =====================================================================
   IMPRIMIR: carga rápida + cola
   ===================================================================== */
const Q = { sel: null, ac: [], acIdx: -1, previewId: null };

function renderImprimir() {
  const cur = $('#qTpl').value;
  $('#qTpl').innerHTML = tplOptions(cur, 'Plantilla automática');
  renderQueue();
  setTimeout(() => $('#qName').focus(), 0);
}

/* Sugerencias mientras escribís. La primera ya viene marcada: Enter la elige.
   La última opción (índice = Q.ac.length) es "crear como artículo nuevo". */
function renderAc() {
  const v = $('#qName').value.trim();
  const box = $('#qAc');
  if (!v || v.includes('\n')) { box.hidden = true; Q.ac = []; Q.acIdx = -1; return; }
  Q.ac = searchProducts(v).slice(0, 8);
  Q.acIdx = Q.ac.length ? 0 : -1;
  if (!Q.ac.length) {
    box.innerHTML = `<div class="ac-new" style="cursor:default"><span>No está en el catálogo: se crea como <b>artículo nuevo</b>. Poné el precio y Enter.</span></div>`;
    box.hidden = false;
    return;
  }
  const inQ = new Set(S.queue.map((q) => q.pid));
  box.innerHTML = Q.ac.map((p, i) => `<div data-i="${i}"${i === Q.acIdx ? ' class="on"' : ''}><span><b>${U.esc(p.name)}</b> ${p.code ? `<small class="mono">${U.esc(p.code)}</small>` : ''}${inQ.has(p.id) ? ' <small class="ac-inq">en la cola</small>' : ''}</span><span class="pr">${U.esc(U.fmt(p.price, S.settings))}</span></div>`).join('')
    + `<div data-i="${Q.ac.length}" class="ac-new"><span>➕ Crear <b>“${U.esc(v)}”</b> como artículo nuevo</span></div>`
    + `<p class="ac-tip">↑ ↓ para elegir · <b>Enter</b> confirma · Esc cierra</p>`;
  box.hidden = false;
}
function moveAc(d) {
  if (!Q.ac.length) return;
  const n = Q.ac.length + 1; // sugerencias + "crear nuevo"
  Q.acIdx = ((Q.acIdx < 0 ? 0 : Q.acIdx) + d + n) % n;
  $$('#qAc [data-i]').forEach((el) => el.classList.toggle('on', +el.dataset.i === Q.acIdx));
  const on = $('#qAc .on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}
/* Elegiste "crear nuevo": se queda el texto como nombre y pasa al precio */
function chooseNew() {
  Q.sel = null;
  $('#qAc').hidden = true;
  $('#qInfo').innerHTML = `Artículo <b>nuevo</b>: se agrega al catálogo cuando pongas el precio y apretes Enter.`;
  $('#qPrice').focus();
}
function pickProduct(p) {
  Q.sel = p;
  $('#qName').value = p.name;
  $('#qPrice').value = U.num(p.price);
  $('#qOffer').value = U.num(p.offer);
  $('#qAc').hidden = true;
  renderPriceHint();
  Q.previewId = p.id;
  renderQPreview();
  $('#qPrice').focus();
  $('#qPrice').select();
}
/* Debajo de la carga rápida: datos del artículo elegido y, mientras escribís, cuánto cambia el precio */
function renderPriceHint() {
  const p = Q.sel;
  if (!p) return;
  const st = S.settings;
  const t = tplFor(p);
  let h = `Del catálogo${p.code ? ' · código <b>' + U.esc(p.code) + '</b>' : ''}${p.category ? ' · ' + U.esc(p.category) : ''} · plantilla <b>${U.esc(t.name)}</b> · precio actual <b>${U.esc(U.fmt(p.price, st))}</b>`;
  const v = U.parsePrice($('#qPrice').value);
  if (v > 0 && v !== p.price) {
    const jump = bigJump(p.price, v);
    h += ` → nuevo <b>${U.esc(U.fmt(v, st))}</b> <span class="badge ${jump ? 'b-warn' : v > p.price ? 'b-up' : 'b-down'}">${pctTxt(p.price, v)}</span>`
      + (jump ? ' <b class="bad-txt">¿Seguro? Revisá los ceros.</b>' : '');
  }
  const o = $('#qOffer').value.trim() ? U.parsePrice($('#qOffer').value) : null;
  const ref = v > 0 ? v : p.price;
  if (badOffer(o, ref)) h += ` <b class="bad-txt">La oferta tiene que ser más barata que el precio.</b>`;
  $('#qInfo').innerHTML = h;
}
function resetEntry() {
  Q.sel = null;
  $('#qName').value = '';
  $('#qPrice').value = '';
  $('#qOffer').value = '';
  $('#qQty').value = 1;
  $('#qInfo').textContent = '';
  $('#qAc').hidden = true;
  $('#qName').focus();
}
function addToQueue(items, merge = true) {
  let added = 0;
  for (const it of items) {
    const ex = S.queue.find((q) => q.pid === it.pid && (q.tpl || '') === (it.tpl || ''));
    if (ex) { if (merge) ex.qty = (+ex.qty || 0) + (+it.qty || 1); continue; }
    S.queue.push({ id: U.uid('q'), pid: it.pid, qty: +it.qty || 1, tpl: it.tpl || '' });
    added++;
  }
  saveQueue();
  updateCounts();
  return added;
}

async function commitEntry() {
  const name = $('#qName').value.trim();
  if (!name) { $('#qName').focus(); return; }
  let p = Q.sel && Q.sel.name === name ? Q.sel : findByCode(name) || findByName(name);
  const price = U.parsePrice($('#qPrice').value);
  const offerRaw = $('#qOffer').value.trim();
  const offer = offerRaw ? U.parsePrice(offerRaw) : null;
  const tpl = $('#qTpl').value;
  const qty = Math.max(1, parseInt($('#qQty').value, 10) || 1);
  let isNew = false;
  if (!p && !(price > 0)) { toast('Falta el precio'); $('#qPrice').focus(); return; }
  const ref = price > 0 ? price : p ? p.price : 0;
  if (badOffer(offer, ref)) { toast(offerMsg(offer, ref)); $('#qOffer').focus(); $('#qOffer').select(); return; }
  if (p && price > 0 && !(await confirmJump(p, price))) { $('#qPrice').focus(); $('#qPrice').select(); return; }
  resetEntry(); // limpiar ya, así se puede seguir escribiendo o escaneando sin esperar
  if (!p) {
    p = newProduct({ name, price, offer: offer > 0 ? offer : null, tpl });
    isNew = true;
    await saveProducts([p]);
  } else {
    let ch = false;
    if (price > 0 && price !== p.price) ch = setPrice(p, price) || ch;
    const off = offer > 0 ? offer : null;
    if ((p.offer ?? null) !== off) { p.offer = off; ch = true; }
    if (ch) await saveProducts([p]);
  }
  addToQueue([{ pid: p.id, qty, tpl: isNew ? '' : tpl }]);
  Q.previewId = p.id;
  renderQueue();
  if (isNew) toast(`Nuevo en el catálogo: “${U.esc(name)}”`);
}

/* Pegar una lista: "Nombre precio" por línea, o columnas copiadas de Excel */
async function pasteList(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tpl = $('#qTpl').value;
  const toSave = [], items = [], bad = [];
  let created = 0;
  for (const line of lines) {
    let name = '', price = NaN;
    if (line.includes('\t')) {
      const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
      for (let i = cells.length - 1; i >= 0; i--) { const v = U.parsePrice(cells[i]); if (v > 0 && /^[$\s\d.,]+$/.test(cells[i])) { price = v; cells.splice(i, 1); break; } }
      const byCode = cells.map(findByCode).find(Boolean);
      name = byCode ? byCode.name : cells.sort((a, b) => b.length - a.length)[0] || '';
    } else {
      const m = /^(.*?)[\s;:=\-–]*\$?\s*(\d[\d.,]*)\s*$/.exec(line);
      if (m) { name = m[1].trim(); price = U.parsePrice(m[2]); }
    }
    if (!name || !(price > 0)) { bad.push(line); continue; }
    let p = findByCode(name) || findByName(name);
    if (p) { if (setPrice(p, price)) toSave.push(p); }
    else { p = newProduct({ name, price, tpl }); toSave.push(p); created++; }
    items.push({ pid: p.id, qty: 1, tpl: '' });
  }
  if (toSave.length) await saveProducts(toSave);
  addToQueue(items);
  renderQueue();
  resetEntry();
  toast(`${items.length} artículos a la cola${created ? ` (${created} nuevos en el catálogo)` : ''}${bad.length ? ` · ${bad.length} líneas sin precio no se cargaron` : ''}`, { ms: 6000 });
}

function renderQueue() {
  const tb = $('#qTable');
  S.queue = S.queue.filter((it) => S.byId.has(it.pid));
  $('#qCount').textContent = S.queue.reduce((a, it) => a + (+it.qty || 0), 0);
  updateCounts();
  if (!S.queue.length) {
    tb.innerHTML = `<tr><td class="empty">La cola está vacía. Cargá artículos arriba, mandalos desde el <b>Catálogo</b> o tocá <b>“+ Pendientes de imprimir”</b>.</td></tr>`;
    renderQPreview();
    return;
  }
  tb.innerHTML = `<thead><tr><th>Artículo</th><th>Plantilla</th><th>Precio</th><th>Oferta</th><th>Cant.</th><th></th></tr></thead><tbody>`
    + S.queue.map((it) => {
      const p = S.byId.get(it.pid);
      return `<tr data-id="${it.id}"><td class="nm">${U.esc(p.name)}<small>${[p.code, p.category].filter(Boolean).map(U.esc).join(' · ')}</small></td>
        <td><select class="q-tpl">${tplOptions(it.tpl, 'Auto: ' + tplFor(p).name)}</select></td>
        <td><input class="money q-price" value="${U.num(p.price)}" inputmode="decimal"></td>
        <td><input class="money q-offer" value="${U.num(p.offer)}" inputmode="decimal" placeholder="—"></td>
        <td><input class="qty q-qty" type="number" min="1" value="${it.qty}"></td>
        <td><button class="small ghost q-del" title="Sacar de la cola">✕</button></td></tr>`;
    }).join('') + '</tbody>';
  renderQPreview();
}
function renderQPreview() {
  const box = $('#qPreview');
  let p = Q.previewId && S.byId.get(Q.previewId);
  let it = S.queue.find((q) => q.pid === (p && p.id));
  if (!p && S.queue.length) { it = S.queue[S.queue.length - 1]; p = S.byId.get(it.pid); }
  if (!p) { box.innerHTML = '<span class="hint">Acá vas a ver cómo queda el cartel.</span>'; $('#qPrevInfo').textContent = ''; return; }
  const t = tplFor(p, it && it.tpl);
  showPreview(box, labelHTML(p, t), t);
  $('#qPrevInfo').textContent = `${t.name}: ${t.w} × ${t.h} mm · entran ${perPage(t, S.settings)} por hoja ${S.settings.paper}`;
}

function bindImprimir() {
  const qn = $('#qName');
  qn.addEventListener('input', () => { if (Q.sel && qn.value !== Q.sel.name) { Q.sel = null; $('#qInfo').textContent = ''; } renderAc(); });
  qn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveAc(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveAc(-1); }
    else if (e.key === 'Escape') { if (!$('#qAc').hidden) $('#qAc').hidden = true; else resetEntry(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const v = qn.value.trim();
      if (!v) return;
      // Código exacto (lector de barras) o nombre exacto: va directo
      const exact = Q.sel || findByCode(v) || findByName(v);
      if (exact) return pickProduct(exact);
      // Si no, la sugerencia marcada (la primera, salvo que elijas otra con las flechas)
      if (!$('#qAc').hidden && Q.acIdx >= 0 && Q.ac[Q.acIdx]) return pickProduct(Q.ac[Q.acIdx]);
      chooseNew();
    }
  });
  qn.addEventListener('focus', () => { if (!Q.sel && qn.value.trim()) renderAc(); });
  qn.addEventListener('blur', () => setTimeout(() => { $('#qAc').hidden = true; }, 150));
  qn.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text && /\r?\n/.test(text.trim())) { e.preventDefault(); pasteList(text); }
  });
  $('#qAc').addEventListener('mousedown', (e) => {
    const d = e.target.closest('[data-i]');
    if (!d) return;
    e.preventDefault();
    const p = Q.ac[+d.dataset.i];
    if (p) pickProduct(p); else chooseNew();
  });
  for (const id of ['#qPrice', '#qOffer', '#qQty', '#qTpl']) {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commitEntry(); }
      if (e.key === 'Escape') resetEntry();
    });
  }
  $('#qPrice').addEventListener('input', renderPriceHint);
  $('#qOffer').addEventListener('input', renderPriceHint);
  $('#qAdd').onclick = commitEntry;

  const tb = $('#qTable');
  tb.addEventListener('change', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const it = S.queue.find((q) => q.id === tr.dataset.id);
    const p = it && S.byId.get(it.pid);
    if (!p) return;
    const el = e.target;
    if (el.classList.contains('q-qty')) { it.qty = Math.max(1, parseInt(el.value, 10) || 1); el.value = it.qty; saveQueue(); updateCounts(); $('#qCount').textContent = $('#tabQ').textContent; }
    if (el.classList.contains('q-tpl')) { it.tpl = el.value; saveQueue(); }
    if (el.classList.contains('q-price')) {
      const v = U.parsePrice(el.value);
      if (v > 0 && v !== p.price && (await confirmJump(p, v)) && setPrice(p, v)) { await saveProducts([p]); warnOffer(p); }
      el.value = U.num(p.price);
    }
    if (el.classList.contains('q-offer')) {
      const v = el.value.trim() ? U.parsePrice(el.value) : null;
      if (badOffer(v, p.price)) toast(offerMsg(v, p.price));
      else { p.offer = v > 0 ? v : null; await saveProducts([p]); }
      el.value = U.num(p.offer);
    }
    Q.previewId = p.id;
    renderQPreview();
  });
  tb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      const cls = [...e.target.classList].find((c) => c.startsWith('q-'));
      const next = e.target.closest('tr').nextElementSibling;
      e.target.blur();
      if (next) { const n = next.querySelector('.' + cls); if (n) { n.focus(); n.select && n.select(); } }
    }
  });
  tb.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const it = S.queue.find((q) => q.id === tr.dataset.id);
    if (e.target.closest('.q-del')) {
      S.queue = S.queue.filter((q) => q !== it);
      saveQueue();
      renderQueue();
      return;
    }
    if (it) { Q.previewId = it.pid; renderQPreview(); }
  });
  $('#btnPending').onclick = () => {
    const list = S.products.filter(isPending).sort((a, b) => COLL.compare(a.name, b.name));
    if (!list.length) return toast('No hay artículos pendientes: todo lo que está en góndola tiene el precio al día.');
    const n = addToQueue(list.map((p) => ({ pid: p.id, qty: 1 })), false);
    renderQueue();
    toast(`${n} artículos pendientes agregados a la cola`);
  };
  $('#btnClearQ').onclick = async () => {
    if (!S.queue.length) return;
    if (!(await confirmDlg('¿Vaciar la cola de impresión? Los artículos siguen en el catálogo.', 'Vaciar'))) return;
    S.queue = [];
    saveQueue();
    renderQueue();
  };
  $('#btnSheet').onclick = openSheets;
}

/* =====================================================================
   VISTA DE HOJA E IMPRESIÓN
   ===================================================================== */
const PV = { sel: null, selQ: null, orig: new Map(), raf: 0, timer: 0 };

function openSheets() {
  if (!S.queue.length) return toast('La cola está vacía');
  const st = S.settings;
  $('#pvPaper').value = st.paper;
  $('#pvOrient').value = st.orient;
  $('#pvMargin').value = st.margin;
  $('#pvGap').value = st.gap;
  $('#pvCut').checked = !!st.cutLines;
  $('#printView').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#sheets').scrollTop = 0;
  // Se guarda cómo estaba cada plantilla para poder volver atrás
  PV.orig = new Map(queueTemplates().map(([t]) => [t.id, { w: t.w, h: t.h }]));
  if (!queueTemplates().some(([t]) => t.id === PV.sel)) { PV.sel = null; PV.selQ = null; }
  buildSheets();
  renderSide();
}
function closeSheets() {
  saveTemplatesNow();
  $('#printView').hidden = true;
  $('#sheets').innerHTML = '';
  document.body.style.overflow = '';
  showTab(S.tab);
}
/* Plantillas que usa la cola, con la cantidad de carteles de cada una */
function queueTemplates() {
  const m = new Map();
  for (const it of S.queue) {
    const p = S.byId.get(it.pid);
    if (!p) continue;
    const t = tplFor(p, it.tpl);
    const e = m.get(t.id) || [t, 0];
    e[1] += +it.qty || 1;
    m.set(t.id, e);
  }
  return [...m.values()];
}
function buildSheets() {
  const st = S.settings;
  const labels = [];
  const cache = new Map();
  for (const it of S.queue) {
    const p = S.byId.get(it.pid);
    if (!p) continue;
    const t = tplFor(p, it.tpl);
    const key = p.id + '|' + t.id;
    let html = cache.get(key);
    if (!html) { html = labelHTML(p, t); cache.set(key, html); }
    for (let i = 0; i < (+it.qty || 1); i++) labels.push({ html, w: t.w, h: t.h, t: t.id, q: it.id });
  }
  const { pages, PW, PH } = packLabels(labels, st);
  const m = +st.margin || 0;
  const usable = (PW - 2 * m) * (PH - 2 * m);
  $('#pageStyle').textContent = `@page { size: ${PW}mm ${PH}mm; margin: 0; }`;
  const cut = st.cutLines ? `outline:0.2mm dashed #9ca3af;outline-offset:${(+st.gap || 0) / 2}mm;` : '';
  $('#sheets').innerHTML = pages.map((pg, i) => {
    const used = Math.min(100, Math.round(pg.reduce((a, { l }) => a + l.w * l.h, 0) / usable * 100));
    return `<div class="pg-num">Hoja ${i + 1} de ${pages.length} · ${used}% aprovechada</div>`
      + `<div class="sheet" style="width:${PW}mm;height:calc(${PH}mm - 1px)">`
      + pg.map(({ l, x, y }) => `<div class="slot${l.t === PV.sel ? ' hl' : ''}${l.q === PV.selQ ? ' me' : ''}" data-t="${l.t}" data-q="${l.q}" style="left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm;width:${l.w}mm;height:${l.h}mm;${cut}">${l.html}`
        + (l.q === PV.selQ ? '<button class="slot-x" data-x title="Sacar este cartel de la hoja (tecla Supr)">✕ Quitar</button>' : '') + '</div>').join('')
      + '</div>';
  }).join('');
  fitAll($('#sheets'));
  $('#pvInfo').textContent = `${labels.length} carteles · ${pages.length} ${pages.length === 1 ? 'hoja' : 'hojas'}`;
  PV.count = labels.length;
}
/* Con muchos carteles se espera un poquito a que dejes de tocar; con pocos, es al instante */
function scheduleBuild() {
  cancelAnimationFrame(PV.raf);
  clearTimeout(PV.timer);
  if ((PV.count || 0) > 300) PV.timer = setTimeout(buildSheets, 350);
  else PV.raf = requestAnimationFrame(buildSheets);
}

/* ---------- Panel de tamaños en vivo ---------- */
const mm = (x) => (Math.round(x * 10) / 10).toLocaleString('es-AR', { maximumFractionDigits: 1 });
function usableArea() {
  const [PW, PH] = paperSize(S.settings);
  const m = +S.settings.margin || 0;
  return { uw: PW - 2 * m, uh: PH - 2 * m, g: +S.settings.gap || 0 };
}
const fitsIn = (len, size, g) => Math.max(0, Math.floor((len + g + 0.01) / (size + g)));
const sizeFor = (n, len, g) => Math.floor(((len - (n - 1) * g) / n) * 10) / 10;

function fitInfo(t) {
  const { uw, uh, g } = usableArea();
  const cols = fitsIn(uw, t.w, g), rows = fitsIn(uh, t.h, g);
  const restW = uw - (cols * t.w + (cols - 1) * g), restH = uh - (rows * t.h + (rows - 1) * g);
  const line = (n, word, rest, max) => (n === 0
    ? `<span class="bad">No entra: el máximo es ${mm(max)} mm</span>`
    : `<b>${n}</b> ${word}${rest >= 3 ? ` · <span class="warn">sobran ${mm(rest)} mm</span>` : ' · justo'}`);
  return `Por fila: ${line(cols, cols === 1 ? 'cartel' : 'carteles', restW, uw)}<br>`
    + `Filas por hoja: ${line(rows, rows === 1 ? 'fila' : 'filas', restH, uh)}<br>`
    + `<b>${cols * rows} por hoja</b> (si van solos)`;
}
function fitChips(t, dim) {
  const { uw, uh, g } = usableArea();
  const len = dim === 'w' ? uw : uh;
  const cur = fitsIn(len, t[dim], g);
  const out = [];
  for (let n = Math.max(1, cur - 1); n <= cur + 2; n++) {
    const s = sizeFor(n, len, g);
    if (s < 15) break;
    out.push(`<button data-chip="${dim}" data-v="${s}" class="${Math.abs(s - t[dim]) < 0.15 ? 'cur' : ''}" title="Deja el ${dim === 'w' ? 'ancho' : 'alto'} justo para que entren ${n} sin que sobre espacio">${n} → ${mm(s)}</button>`);
  }
  return `<span>${dim === 'w' ? 'Llenar el ancho:' : 'Llenar el alto:'}</span>` + out.join('');
}
function sideCard(t, n) {
  const o = PV.orig.get(t.id);
  const changed = o && (o.w !== t.w || o.h !== t.h);
  const step = (k) => `<label class="pv-dim">${k === 'w' ? 'Ancho' : 'Alto'} (mm)<span class="pv-step"><button data-step="${k}" data-d="-1" title="1 mm menos">−</button><input type="number" step="any" min="10" data-dim="${k}" value="${t[k]}"><button data-step="${k}" data-d="1" title="1 mm más">+</button></span></label>`;
  return `<div class="pv-card${t.id === PV.sel ? ' on' : ''}" data-card="${t.id}">
    <div class="pv-card-h"><b>${U.esc(t.name)}</b><small>${n} ${n === 1 ? 'cartel' : 'carteles'}</small></div>
    <div class="pv-dims">${step('w')}${step('h')}</div>
    <div class="pv-fit">${fitInfo(t)}</div>
    <div class="pv-chips" data-chips="w">${fitChips(t, 'w')}</div>
    <div class="pv-chips" data-chips="h">${fitChips(t, 'h')}</div>
    <div class="row" style="gap:6px">${changed ? `<button data-reset title="Vuelve a ${mm(o.w)} × ${mm(o.h)} mm">↺ Volver a como estaba</button>` : ''}<button data-edit class="ghost" title="Colores, letra, franja y demás">Más opciones…</button></div>
  </div>`;
}
function renderSide() {
  const list = queueTemplates();
  let sel = '';
  const q = S.queue.find((x) => x.id === PV.selQ);
  const p = q && S.byId.get(q.pid);
  if (p) {
    sel = `<div class="pv-sel"><b>${U.esc(p.name)}</b>
      <div class="row" style="gap:8px;align-items:center"><span class="pv-dim" style="flex-direction:row;align-items:center;gap:6px">Cantidad
        <span class="pv-step" style="width:120px"><button data-qqty="-1" title="Uno menos">−</button><input type="number" min="0" step="1" data-qqtyv value="${+q.qty || 1}"><button data-qqty="1" title="Uno más">+</button></span></span></div>
      <div class="row" style="gap:6px"><button data-qdel class="danger" title="Saca este artículo de la hoja (sigue en el catálogo)">🗑 Sacar de la hoja${(+q.qty || 1) > 1 ? ` (los ${+q.qty})` : ''}</button>
        <button data-pdel class="ghost" title="Lo borra del catálogo para siempre">Borrar del catálogo…</button></div>
      <label class="pv-dim">Plantilla de este cartel<select data-qtpl>${tplOptions(q.tpl, 'Automática (' + tplFor(p).name + ')')}</select></label>
      <small>Para que salga más grande o más chico solo este, elegí otra plantilla.</small></div>`;
  }
  $('#pvSide').innerHTML = `<div><h3>Tamaño de los carteles</h3><p class="hint">Hacé clic en un cartel de la hoja para elegirlo. Para sacarlo, tocá <b>✕ Quitar</b> o la tecla <b>Supr</b>. Cambiá el ancho o el alto y mirá cómo se reacomoda la hoja. Los botones verdes dejan la medida justa para no desperdiciar papel.</p></div>`
    + sel + list.map(([t, n]) => sideCard(t, n)).join('')
    + `<p class="hint">Los cambios se guardan en la plantilla y se usan en todos los carteles con esa plantilla.</p>`;
}
/* Actualiza solo los números de una tarjeta, sin tocar el campo donde estás escribiendo */
function refreshCard(id, keepInput) {
  const card = $(`#pvSide [data-card="${id}"]`);
  const t = tplById(id);
  if (!card || !t) return;
  for (const inp of card.querySelectorAll('[data-dim]')) if (inp !== keepInput) inp.value = t[inp.dataset.dim];
  card.querySelector('.pv-fit').innerHTML = fitInfo(t);
  card.querySelector('[data-chips="w"]').innerHTML = fitChips(t, 'w');
  card.querySelector('[data-chips="h"]').innerHTML = fitChips(t, 'h');
  const o = PV.orig.get(id);
  const row = card.querySelector('.row');
  const changed = o && (o.w !== t.w || o.h !== t.h);
  if (!!row.querySelector('[data-reset]') !== changed) {
    row.innerHTML = (changed ? `<button data-reset title="Vuelve a ${mm(o.w)} × ${mm(o.h)} mm">↺ Volver a como estaba</button>` : '') + '<button data-edit class="ghost" title="Colores, letra, franja y demás">Más opciones…</button>';
  }
}
function setTplSize(id, k, v, keepInput) {
  const t = tplById(id);
  if (!t || !isFinite(v)) return;
  v = Math.round(Math.max(10, Math.min(1000, v)) * 10) / 10;
  if (t[k] === v) return;
  t[k] = v;
  t.v = (t.v || 0) + 1;
  saveTemplates();
  selectTpl(id, false);
  refreshCard(id, keepInput);
  scheduleBuild();
}
function selectTpl(id, scroll = true) {
  if (PV.sel === id) return;
  PV.sel = id;
  $$('#pvSide .pv-card').forEach((c) => c.classList.toggle('on', c.dataset.card === id));
  $$('#sheets .slot').forEach((s) => s.classList.toggle('hl', s.dataset.t === id));
  if (scroll) { const c = $(`#pvSide [data-card="${id}"]`); if (c) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

/* ---------- Sacar carteles de la hoja ---------- */
function afterQueueChange() {
  saveQueue();
  updateCounts();
  if (!S.queue.length) { closeSheets(); return; }
  if (!S.queue.some((x) => x.id === PV.selQ)) PV.selQ = null;
  buildSheets();
  renderSide();
}
function setQueueQty(qid, qty) {
  const i = S.queue.findIndex((x) => x.id === qid);
  if (i < 0) return;
  const q = S.queue[i];
  const before = { item: Object.assign({}, q), i };
  const p = S.byId.get(q.pid);
  const name = p ? U.esc(p.name) : 'Cartel';
  qty = Math.max(0, Math.round(qty));
  if (qty === (+q.qty || 1)) return;
  if (qty === 0) S.queue.splice(i, 1); else q.qty = qty;
  afterQueueChange();
  if (qty < (+before.item.qty || 1)) {
    toast(qty === 0 ? `“${name}” salió de la hoja` : `“${name}”: quedan ${qty}`, {
      ms: 6000,
      action: { label: 'Deshacer', fn: () => {
        const j = S.queue.findIndex((x) => x.id === qid);
        if (j >= 0) S.queue[j] = before.item; else S.queue.splice(Math.min(before.i, S.queue.length), 0, before.item);
        if ($('#printView').hidden) { saveQueue(); updateCounts(); renderQueue(); return; }
        PV.selQ = qid;
        afterQueueChange();
      } },
    });
  }
}
async function deleteProductFromSheet(qid) {
  const q = S.queue.find((x) => x.id === qid);
  const p = q && S.byId.get(q.pid);
  if (!p) return;
  if (!(await confirmDlg(`¿Borrar <b>“${U.esc(p.name)}”</b> del catálogo? Sale de la hoja y de la lista de artículos.`, 'Borrar', true))) return;
  await removeProducts([p], `“${U.esc(p.name)}” borrado del catálogo`);
  afterQueueChange();
}

function bindPrintView() {
  const st = () => S.settings;
  const upd = (k, v) => { st()[k] = v; saveSettings(); buildSheets(); renderSide(); };
  $('#pvPaper').onchange = (e) => upd('paper', e.target.value);
  $('#pvOrient').onchange = (e) => upd('orient', e.target.value);
  $('#pvMargin').onchange = (e) => upd('margin', Math.max(0, parseFloat(e.target.value) || 0));
  $('#pvGap').onchange = (e) => upd('gap', Math.max(0, parseFloat(e.target.value) || 0));
  $('#pvCut').onchange = (e) => upd('cutLines', e.target.checked);
  $('#pvClose').onclick = closeSheets;
  $('#pvPrint').onclick = () => {
    saveTemplatesNow();
    window.print();
    $('#pvDone').classList.remove('flash');
    void $('#pvDone').offsetWidth;
    $('#pvDone').classList.add('flash');
  };
  $('#pvDone').onclick = async () => {
    const list = [...new Set(S.queue.map((q) => S.byId.get(q.pid)).filter(Boolean))];
    await markPrinted(list);
    S.queue = [];
    saveQueue();
    closeSheets();
    toast(`${list.length} artículos marcados como impresos. Cola vacía.`);
  };

  // Clic en un cartel de la hoja: lo elige
  $('#sheets').addEventListener('click', (e) => {
    const slot = e.target.closest('.slot');
    if (!slot) return;
    if (e.target.closest('[data-x]')) {
      const q = S.queue.find((x) => x.id === slot.dataset.q);
      if (q) setQueueQty(q.id, (+q.qty || 1) - 1);
      return;
    }
    const same = PV.selQ === slot.dataset.q;
    PV.selQ = same ? null : slot.dataset.q;
    PV.sel = slot.dataset.t;
    buildSheets();
    renderSide();
    $('#pvSide').scrollTop = 0;
  });

  const side = $('#pvSide');
  side.addEventListener('input', (e) => {
    const inp = e.target.closest('[data-dim]');
    if (!inp) return;
    const v = parseFloat(String(inp.value).replace(',', '.'));
    clearTimeout(PV.typing);
    if (!(v >= 10)) return; // mientras escribís "6" para llegar a "64" no hace nada
    // Espera un instante a que termines de escribir el número (así "100" no pasa por "10")
    PV.typing = setTimeout(() => setTplSize(inp.closest('[data-card]').dataset.card, inp.dataset.dim, v, inp), 250);
  });
  side.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-dim]');
    if (inp) {
      clearTimeout(PV.typing);
      const id = inp.closest('[data-card]').dataset.card;
      const v = parseFloat(String(inp.value).replace(',', '.'));
      if (!(v >= 10)) inp.value = tplById(id)[inp.dataset.dim];
      else setTplSize(id, inp.dataset.dim, v);
      return;
    }
    if (e.target.matches('[data-qqtyv]')) {
      const v = parseInt(e.target.value, 10);
      if (PV.selQ && v >= 0) setQueueQty(PV.selQ, v);
      return;
    }
    if (e.target.matches('[data-qtpl]')) {
      const q = S.queue.find((x) => x.id === PV.selQ);
      if (!q) return;
      q.tpl = e.target.value;
      saveQueue();
      const p = S.byId.get(q.pid);
      const t = tplFor(p, q.tpl);
      if (!PV.orig.has(t.id)) PV.orig.set(t.id, { w: t.w, h: t.h });
      PV.sel = t.id;
      buildSheets();
      renderSide();
    }
  });
  side.addEventListener('click', (e) => {
    const b0 = e.target.closest('button');
    if (b0 && PV.selQ) {
      const q = S.queue.find((x) => x.id === PV.selQ);
      if (b0.dataset.qqty && q) return setQueueQty(q.id, (+q.qty || 1) + +b0.dataset.qqty);
      if (b0.hasAttribute('data-qdel') && q) return setQueueQty(q.id, 0);
      if (b0.hasAttribute('data-pdel')) return deleteProductFromSheet(PV.selQ);
    }
    const card = e.target.closest('[data-card]');
    if (!card) return;
    const id = card.dataset.card;
    const t = tplById(id);
    const b = e.target.closest('button');
    if (!b) { if (!e.target.closest('input,select,label')) selectTpl(id, false); return; }
    if (b.dataset.step) setTplSize(id, b.dataset.step, t[b.dataset.step] + +b.dataset.d);
    else if (b.dataset.chip) setTplSize(id, b.dataset.chip, +b.dataset.v);
    else if (b.hasAttribute('data-reset')) {
      const o = PV.orig.get(id);
      if (o) { setTplSize(id, 'w', o.w); setTplSize(id, 'h', o.h); }
    } else if (b.hasAttribute('data-edit')) {
      curTplId = id;
      S.tab = 'plantillas';
      closeSheets();
    }
  });
}

/* =====================================================================
   CATÁLOGO
   ===================================================================== */
const C = { q: '', cat: '__all', status: '', sel: new Set(), limit: 200, list: [] };

function badge(p) {
  let h = p.offer > 0 ? '<span class="badge b-offer">Oferta</span> ' : '';
  if (p.printedPrice == null) return h + '<span class="badge b-new">Sin imprimir</span>';
  if (p.printedPrice !== p.price) {
    const up = p.price > p.printedPrice;
    return h + `<span class="badge ${up ? 'b-up' : 'b-down'}" title="El cartel en góndola dice ${U.esc(U.fmt(p.printedPrice, S.settings))}">${up ? '▲' : '▼'} góndola: ${U.esc(U.fmt(p.printedPrice, S.settings))}</span>`;
  }
  if ((p.offer ?? null) !== (p.printedOffer ?? null)) return h + '<span class="badge b-new">Oferta sin imprimir</span>';
  return h + '<span class="badge b-ok">Al día</span>';
}
function catRow(p) {
  const t = tplFor(p);
  const auto = !p.tpl;
  return `<tr data-id="${p.id}" class="${C.sel.has(p.id) ? 'sel' : ''}">
    <td><input type="checkbox" class="c-sel"${C.sel.has(p.id) ? ' checked' : ''}></td>
    <td class="mono">${U.esc(p.code)}</td>
    <td class="nm">${U.esc(p.name)}${p.barcode ? `<small class="mono">${U.esc(p.barcode)}</small>` : ''}</td>
    <td>${U.esc(p.category)}</td>
    <td><small>${U.esc(t.name)}${auto ? ' · auto' : ''}</small></td>
    <td><input class="money c-price" value="${U.num(p.price)}" inputmode="decimal"></td>
    <td><input class="money c-offer" value="${U.num(p.offer)}" inputmode="decimal" placeholder="—"></td>
    <td class="st">${badge(p)}</td>
    <td style="white-space:nowrap"><button class="small c-q">+ Cola</button> <button class="small c-edit">Editar</button></td></tr>`;
}
function renderCatalog() {
  const cats = categories();
  if (C.cat !== '__all' && C.cat !== '' && !cats.some(([c]) => c === C.cat)) C.cat = '__all';
  $('#cCat').innerHTML = `<option value="__all">Todas las categorías</option>` + cats.map(([c, n]) => `<option value="${U.esc(c)}"${c === C.cat ? ' selected' : ''}>${U.esc(c)} (${n})</option>`).join('');
  $('#cStatus').value = C.status;
  C.list = searchProducts(C.q, { cat: C.cat, status: C.status });
  for (const id of C.sel) if (!S.byId.has(id)) C.sel.delete(id);
  $('#cCount').textContent = `${C.list.length} de ${S.products.length}`;
  $('#cUndo').hidden = !S.lastBulk;
  renderScope();
  const tb = $('#cTable');
  if (!S.products.length) {
    tb.innerHTML = `<tr><td class="empty"><p style="font-size:16px">Todavía no hay artículos.</p>
      <button class="primary big" onclick="showTab('importar')">Importar desde Excel</button> &nbsp; <button class="big" onclick="editProduct(null)">Cargar uno a mano</button></td></tr>`;
    $('#cMore').hidden = true;
    return;
  }
  const allSel = C.list.length > 0 && C.list.every((p) => C.sel.has(p.id));
  tb.innerHTML = `<thead><tr><th><input type="checkbox" id="cAll" title="Seleccionar todos los de la lista"${allSel ? ' checked' : ''}></th><th>Código</th><th>Nombre</th><th>Categoría</th><th>Plantilla</th><th>Precio</th><th>Oferta</th><th>Estado</th><th></th></tr></thead><tbody>`
    + (C.list.length ? C.list.slice(0, C.limit).map(catRow).join('') : `<tr><td colspan="9" class="empty">No se encontró nada. Probá con menos palabras.</td></tr>`)
    + '</tbody>';
  $('#cMore').hidden = C.list.length <= C.limit;
  $('#cMore').textContent = `Mostrar más (${C.list.length - C.limit} restantes)`;
}
function renderScope() {
  $('#cScope').innerHTML = C.sel.size
    ? `<b>${C.sel.size} seleccionados.</b> Los botones de arriba actúan sobre los seleccionados. <a href="#" id="cClearSel">Quitar selección</a>`
    : `Sin selección: los botones de arriba actúan sobre los <b>${C.list.length}</b> artículos de la lista. Tip: en la columna Precio, escribí y apretá Enter para pasar al siguiente.`;
  const a = $('#cClearSel');
  if (a) a.onclick = (e) => { e.preventDefault(); C.sel.clear(); renderCatalog(); };
}
const scopeList = () => (C.sel.size ? S.products.filter((p) => C.sel.has(p.id)) : C.list);
const scopeText = () => (C.sel.size ? `${C.sel.size} artículos seleccionados` : `los ${C.list.length} artículos de la lista${C.q || C.cat !== '__all' || C.status ? ' filtrada' : ' (todo el catálogo)'}`);

function bindCatalog() {
  const rerender = U.debounce(() => { C.limit = 200; renderCatalog(); }, 90);
  $('#cSearch').addEventListener('input', (e) => { C.q = e.target.value; rerender(); });
  $('#cSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const p = findByCode(e.target.value);
      if (p) { editProduct(p); e.target.select(); }
    }
  });
  $('#cCat').onchange = (e) => { C.cat = e.target.value; C.limit = 200; renderCatalog(); };
  $('#cStatus').onchange = (e) => { C.status = e.target.value; C.limit = 200; renderCatalog(); };
  $('#cMore').onclick = () => { C.limit += 300; renderCatalog(); };
  const tb = $('#cTable');
  tb.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.id === 'cAll') {
      for (const p of C.list) el.checked ? C.sel.add(p.id) : C.sel.delete(p.id);
      renderCatalog();
      return;
    }
    const tr = el.closest('tr[data-id]');
    const p = tr && S.byId.get(tr.dataset.id);
    if (!p) return;
    if (el.classList.contains('c-sel')) { el.checked ? C.sel.add(p.id) : C.sel.delete(p.id); tr.classList.toggle('sel', el.checked); renderScope(); return; }
    if (el.classList.contains('c-price')) {
      const v = U.parsePrice(el.value);
      if (v > 0 && v !== p.price && (await confirmJump(p, v)) && setPrice(p, v)) { await saveProducts([p]); warnOffer(p); }
      el.value = U.num(p.price);
    }
    if (el.classList.contains('c-offer')) {
      const v = el.value.trim() ? U.parsePrice(el.value) : null;
      if (badOffer(v, p.price)) toast(offerMsg(v, p.price));
      else { p.offer = v > 0 ? v : null; await saveProducts([p]); }
      el.value = U.num(p.offer);
    }
    tr.querySelector('.st').innerHTML = badge(p);
  });
  tb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.c-price, .c-offer')) {
      e.preventDefault();
      const cls = e.target.classList.contains('c-price') ? '.c-price' : '.c-offer';
      const next = e.target.closest('tr').nextElementSibling;
      e.target.blur();
      if (next) { const n = next.querySelector(cls); if (n) { n.focus(); n.select(); } }
    }
  });
  tb.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    const p = tr && S.byId.get(tr.dataset.id);
    if (!p) return;
    if (e.target.closest('.c-q')) { addToQueue([{ pid: p.id, qty: 1 }]); toast(`“${U.esc(p.name)}” a la cola`); }
    if (e.target.closest('.c-edit')) editProduct(p);
  });
  $('#cNew').onclick = () => editProduct(null);
  $('#cQueue').onclick = () => {
    const list = scopeList();
    if (!list.length) return toast('No hay artículos en la lista');
    const n = addToQueue(list.map((p) => ({ pid: p.id, qty: 1 })), false);
    toast(`${n} artículos agregados a la cola`, { action: { label: 'Ir a imprimir', fn: () => showTab('imprimir') } });
  };
  $('#cBulk').onclick = bulkDialog;
  $('#cAssign').onclick = assignDialog;
  $('#cPrinted').onclick = async () => {
    const list = scopeList();
    if (!list.length) return;
    if (!(await confirmDlg(`¿Marcar ${scopeText()} como <b>ya impresos</b>? (Quiere decir que el cartel de la góndola ya tiene el precio actual.)`, 'Marcar'))) return;
    await markPrinted(list);
    renderCatalog();
  };
  $('#cDel').onclick = async () => {
    const list = scopeList();
    if (!list.length) return;
    if (!(await confirmDlg(`¿Eliminar ${scopeText()} del catálogo?<br><small>Si te equivocás, vas a tener unos segundos para deshacerlo.</small>`, 'Eliminar', true))) return;
    await removeProducts(list, list.length === 1 ? `“${U.esc(list[0].name)}” eliminado` : `${list.length} artículos eliminados`);
    renderCatalog();
  };
  $('#cUndo').onclick = async () => {
    const b = S.lastBulk;
    if (!b) return;
    const list = [];
    for (const s of b.items) { const p = S.byId.get(s.id); if (p) { p.price = s.price; p.prevPrice = s.prevPrice; p.updatedAt = s.updatedAt; list.push(p); } }
    await saveProducts(list);
    S.lastBulk = null;
    DB.kvSet('lastBulk', null);
    renderCatalog();
    toast(`Se deshizo el ${b.pct > 0 ? 'aumento' : 'descuento'} de ${b.pct}% en ${list.length} artículos`);
  };
  $('#cExport').onclick = exportExcel;
}

function bulkDialog() {
  const list = scopeList();
  if (!list.length) return toast('No hay artículos en la lista');
  const st = S.settings;
  const d = openDialog(`<div class="dlg-body"><h2>Aumento o descuento por porcentaje</h2>
    <p>Se aplica a <b>${scopeText()}</b>.</p>
    <div class="fields">
      <label class="field">Porcentaje (negativo = descuento)<input id="bPct" value="10" inputmode="decimal" style="font-size:18px"></label>
      <label class="field">Redondear<select id="bRound">${[0, 1, 5, 10, 50, 100].map((v) => `<option value="${v}"${+st.roundTo === v ? ' selected' : ''}>${v ? 'a $' + v : 'Sin redondear'}</option>`).join('')}</select></label>
      <label class="field">Forma<select id="bMode"><option value="up"${st.roundMode === 'up' ? ' selected' : ''}>Hacia arriba</option><option value="near"${st.roundMode === 'near' ? ' selected' : ''}>Al más cercano</option></select></label>
    </div>
    <h3>Así quedan (ejemplos)</h3><div id="bPrev"></div></div>
    <div class="dlg-foot"><button id="bCancel">Cancelar</button><button id="bOk" class="primary">Aplicar a ${list.length} artículos</button></div>`);
  const calc = (p) => {
    const pct = U.parsePrice($('#bPct').value) || 0;
    return U.roundTo(p.price * (1 + pct / 100), +$('#bRound').value, $('#bMode').value);
  };
  const prev = () => {
    $('#bPrev').innerHTML = `<table class="tbl">${list.slice(0, 6).map((p) => `<tr><td>${U.esc(p.name)}</td><td>${U.esc(U.fmt(p.price, st))}</td><td>→</td><td><b>${U.esc(U.fmt(calc(p), st))}</b></td></tr>`).join('')}</table>`;
  };
  prev();
  d.oninput = prev;
  d.onchange = prev;
  $('#bPct').select();
  $('#bCancel').onclick = closeDialog;
  $('#bOk').onclick = async () => {
    const pct = U.parsePrice($('#bPct').value);
    if (!pct) return toast('Poné un porcentaje');
    const snap = [], changed = [];
    for (const p of list) {
      const np = calc(p);
      if (np > 0 && np !== p.price) {
        snap.push({ id: p.id, price: p.price, prevPrice: p.prevPrice, updatedAt: p.updatedAt });
        setPrice(p, np);
        changed.push(p);
      }
    }
    await saveProducts(changed);
    S.lastBulk = { pct, items: snap, at: Date.now() };
    DB.kvSet('lastBulk', S.lastBulk);
    st.roundTo = +$('#bRound').value;
    st.roundMode = $('#bMode').value;
    saveSettings();
    closeDialog();
    renderCatalog();
    toast(`${changed.length} precios actualizados (${pct > 0 ? '+' : ''}${pct}%). Ya quedan como pendientes de imprimir.`, { ms: 8000, action: { label: 'Mandar a la cola', fn: () => { addToQueue(changed.map((p) => ({ pid: p.id, qty: 1 })), false); showTab('imprimir'); } } });
  };
}

function assignDialog() {
  const list = scopeList();
  if (!list.length) return toast('No hay artículos en la lista');
  openDialog(`<div class="dlg-body"><h2>Categoría y plantilla</h2>
    <p>Se aplica a <b>${scopeText()}</b>. Dejá en blanco lo que no quieras cambiar.</p>
    <div class="fields" style="grid-template-columns:1fr 1fr">
      <label class="field">Categoría<input id="aCat" list="catList" placeholder="(no cambiar)"></label>
      <label class="field">Plantilla<select id="aTpl"><option value="__keep">(no cambiar)</option><option value="">Automática según categoría</option>${tplOptions('', '')}</select></label>
    </div>
    <datalist id="catList">${categories().map(([c]) => `<option value="${U.esc(c)}">`).join('')}</datalist></div>
    <div class="dlg-foot"><button onclick="closeDialog()">Cancelar</button><button id="aOk" class="primary">Aplicar</button></div>`);
  $('#aOk').onclick = async () => {
    const cat = $('#aCat').value.trim();
    const tpl = $('#aTpl').value;
    for (const p of list) {
      if (cat) p.category = cat;
      if (tpl !== '__keep') p.tpl = tpl;
    }
    await saveProducts(list);
    closeDialog();
    renderCatalog();
    toast(`${list.length} artículos actualizados`);
  };
}

function editProduct(p) {
  const isNew = !p;
  const d0 = p || { code: '', barcode: '', name: '', category: C.cat !== '__all' ? C.cat : '', tpl: '', price: null, offer: null, content: null, unit: '' };
  const d = openDialog(`<div class="dlg-body"><h2>${isNew ? 'Nuevo artículo' : 'Editar artículo'}</h2>
    <div class="fields" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
      <label class="field" style="grid-column:1/-1">Nombre (como sale en el cartel)<input id="eName" value="${U.esc(d0.name)}" style="font-size:17px"></label>
      <label class="field">Precio<input id="ePrice" value="${U.num(d0.price)}" inputmode="decimal" style="font-size:17px;font-weight:700"></label>
      <label class="field">Precio de oferta<input id="eOffer" value="${U.num(d0.offer)}" inputmode="decimal" placeholder="(sin oferta)"></label>
      <label class="field">Código<input id="eCode" value="${U.esc(d0.code)}"></label>
      <label class="field">Código de barras<input id="eBar" value="${U.esc(d0.barcode)}"></label>
      <label class="field">Categoría<input id="eCat" value="${U.esc(d0.category)}" list="eCatList"></label>
      <label class="field">Plantilla<select id="eTpl">${tplOptions(d0.tpl, 'Automática según categoría')}</select></label>
      <label class="field">Contenido neto<input id="eCont" value="${d0.content > 0 ? U.num(d0.content) : ''}" inputmode="decimal" placeholder="auto"></label>
      <label class="field">Unidad<select id="eUnit">${[['', 'Detectar del nombre'], ['g', 'gramos'], ['kg', 'kilos'], ['ml', 'ml / cc'], ['l', 'litros']].map(([v, l]) => `<option value="${v}"${d0.unit === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <datalist id="eCatList">${categories().map(([c]) => `<option value="${U.esc(c)}">`).join('')}</datalist>
    <p id="eWarn" class="warn-box" hidden></p>
    <p class="hint" style="margin-top:8px">El precio por kilo o litro se calcula solo si el nombre dice el contenido (ej: “500 g”, “1,5 L”, “900 cc”, “3 x 100 g”).</p>
    <h3>Vista previa</h3><div id="ePrev" class="preview"></div></div>
    <div class="dlg-foot">${isNew ? '' : '<button id="eDel" class="danger" style="margin-right:auto">Eliminar</button>'}
      <button onclick="closeDialog()">Cancelar</button><button id="eSaveQ">Guardar y mandar a la cola</button><button id="eSave" class="primary">Guardar</button></div>`);
  const read = () => {
    const off = $('#eOffer').value.trim() ? U.parsePrice($('#eOffer').value) : null;
    const cont = U.parsePrice($('#eCont').value);
    return { name: $('#eName').value.trim(), price: U.parsePrice($('#ePrice').value), offer: off > 0 ? off : null, code: $('#eCode').value.trim(),
      barcode: $('#eBar').value.trim(), category: $('#eCat').value.trim(), tpl: $('#eTpl').value, content: cont > 0 ? cont : null, unit: $('#eUnit').value };
  };
  const prev = () => {
    const v = read();
    const tmp = Object.assign({}, v, { price: v.price > 0 ? v.price : 0, name: v.name || 'Nombre del artículo' });
    const t = tplFor(tmp);
    showPreview($('#ePrev'), labelHTML(tmp, t), t, 1.3);
    // Avisos en vivo: salto grande de precio u oferta más cara que el precio
    const w = [];
    if (!isNew && bigJump(p.price, v.price)) w.push(`El precio pasa de <b>${U.esc(U.fmt(p.price, S.settings))}</b> a <b>${U.esc(U.fmt(v.price, S.settings))}</b> (${pctTxt(p.price, v.price)}). ¿No será un cero de más o de menos?`);
    if (badOffer(v.offer, v.price)) w.push(offerMsg(v.offer, v.price));
    $('#eWarn').innerHTML = w.join('<br>');
    $('#eWarn').hidden = !w.length;
  };
  let jumpOk = null; // precio "raro" ya confirmado con un segundo clic en Guardar
  d.oninput = prev;
  d.onchange = prev;
  setTimeout(() => { prev(); (isNew ? $('#eName') : $('#ePrice')).focus(); if (!isNew) $('#ePrice').select(); }, 30);
  const save = async (toQueue) => {
    const v = read();
    if (!v.name) return toast('Falta el nombre');
    if (!(v.price > 0)) return toast('Falta el precio');
    if (badOffer(v.offer, v.price)) return toast(offerMsg(v.offer, v.price));
    if (!isNew && bigJump(p.price, v.price) && jumpOk !== v.price) {
      jumpOk = v.price;
      return toast('Revisá el precio. Si está bien, tocá <b>Guardar</b> otra vez.', { ms: 6000 });
    }
    if (v.code) { const other = findByCode(v.code); if (other && other !== p && other._c === U.normCode(v.code)) return toast(`El código ${U.esc(v.code)} ya lo usa “${U.esc(other.name)}”`); }
    let prod = p;
    if (isNew) prod = newProduct(Object.assign({}, v));
    else { const pr = v.price; delete v.price; Object.assign(prod, v); setPrice(prod, pr); }
    await saveProducts([prod]);
    if (toQueue) addToQueue([{ pid: prod.id, qty: 1 }]);
    closeDialog();
    if (S.tab === 'catalogo') renderCatalog(); else if (S.tab === 'imprimir') renderQueue();
    toast(toQueue ? 'Guardado y en la cola' : 'Guardado');
  };
  $('#eSave').onclick = () => save(false);
  $('#eSaveQ').onclick = () => save(true);
  d.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(false); } };
  if (!isNew) $('#eDel').onclick = async () => {
    closeDialog();
    await removeProducts([p], `“${U.esc(p.name)}” eliminado`);
    refreshView();
  };
}

/* =====================================================================
   IMPORTAR DESDE EXCEL / CSV
   ===================================================================== */
const IMP = { file: '', sheets: {}, names: [], sheet: '', headerRow: -1, map: {}, matchBy: 'code', addNew: true, markPrinted: false, analysis: null };
const IMP_FIELDS = [
  ['name', 'Nombre / descripción *'], ['price', 'Precio de venta *'], ['code', 'Código'],
  ['barcode', 'Código de barras'], ['category', 'Categoría / rubro'], ['offer', 'Precio de oferta'],
];
const IMP_KEYS = {
  barcode: ['codigo de barras', 'cod barras', 'cod de barras', 'barras', 'ean', 'ean13', 'barcode', 'gtin', 'upc', 'cod barra', 'codigo barra'],
  offer: ['precio oferta', 'oferta', 'promo', 'promocion', 'precio promo'],
  price: ['precio venta', 'precio de venta', 'precio final', 'precio publico', 'precio al publico', 'pvp', 'p venta', 'venta', 'precio', 'importe', 'precio unitario', 'precio lista', 'lista', 'pu', 'p unit', 'final'],
  category: ['categoria', 'rubro', 'familia', 'seccion', 'departamento', 'grupo', 'linea', 'subrubro', 'sector', 'tipo'],
  code: ['codigo', 'cod', 'code', 'sku', 'plu', 'id', 'codigo interno', 'cod int', 'interno', 'referencia', 'ref', 'art', 'nro', 'numero', 'cod articulo', 'codigo articulo'],
  name: ['descripcion', 'nombre', 'detalle', 'producto', 'articulo', 'denominacion', 'desc', 'item', 'descripcion articulo', 'nombre articulo'],
};
const IMP_NEG = { price: ['costo', 'compra', 'iva', 'neto', 'margen', '%', 'oferta', 'promo', 'anterior', 'viejo'], code: ['barra', 'ean'], name: ['cod'] };

const cellStr = (v) => (v == null ? '' : typeof v === 'number' ? String(v) : String(v).trim());
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function headerScore(h, field) {
  const n = U.norm(String(h ?? '').replace(/[._:/#°º]/g, ' '));
  if (!n || n.length > 40) return 0;
  if ((IMP_NEG[field] || []).some((x) => n.includes(x))) return 0;
  let best = 0;
  IMP_KEYS[field].forEach((k, i) => {
    if (n === k) best = Math.max(best, 100 - i);
    else if (k.length > 2 && (n.startsWith(k + ' ') || n.endsWith(' ' + k) || n.includes(' ' + k + ' ') || (k.includes(' ') && n.includes(k)))) best = Math.max(best, 50 - i);
  });
  return best;
}
function parseCSV(text) {
  const sample = text.split(/\r?\n/).slice(0, 15).join('\n');
  const delim = [';', '\t', ',', '|'].map((d) => [d, sample.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}
async function readImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const buf = await file.arrayBuffer();
  if (['csv', 'txt', 'tsv'].includes(ext)) {
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    return { sheets: { [file.name]: parseCSV(text.replace(/^﻿/, '')) }, names: [file.name] };
  }
  const wb = XLSX.read(buf, { type: 'array' });
  const sheets = {};
  for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '', blankrows: false });
  return { sheets, names: wb.SheetNames.filter((n) => sheets[n].length) };
}
function detectHeaderRow(rows) {
  let best = -1, bestScore = 0;
  for (let r = 0; r < Math.min(20, rows.length); r++) {
    let s = 0;
    for (const c of rows[r] || []) if (Object.keys(IMP_KEYS).some((f) => headerScore(c, f) > 0)) s++;
    if (s > bestScore) { bestScore = s; best = r; }
  }
  return bestScore >= 1 ? best : -1;
}
function autoMap(rows, hr) {
  const ncol = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const headers = hr >= 0 ? rows[hr] : [];
  const map = {};
  const taken = new Set();
  const saved = S.settings.importMap || {};
  for (const [f] of IMP_FIELDS) {
    if (saved[f]) {
      const i = headers.findIndex((h) => U.norm(h) === saved[f]);
      if (i >= 0 && !taken.has(i)) { map[f] = i; taken.add(i); }
    }
  }
  if (hr >= 0) {
    for (const f of ['barcode', 'offer', 'price', 'category', 'code', 'name']) {
      if (map[f] != null) continue;
      let bi = -1, bs = 0;
      headers.forEach((h, i) => { if (taken.has(i)) return; const s = headerScore(h, f); if (s > bs) { bs = s; bi = i; } });
      if (bi >= 0) { map[f] = bi; taken.add(bi); }
    }
  }
  // Sin títulos o faltan columnas clave: adivinar por el contenido
  const data = rows.slice(hr + 1, hr + 60);
  if (map.name == null || map.price == null) {
    const stats = [];
    for (let c = 0; c < ncol; c++) {
      if (taken.has(c)) continue;
      let num = 0, txt = 0, len = 0;
      for (const r of data) {
        const v = r[c];
        if (v === '' || v == null) continue;
        if (typeof v === 'number' || /^[$\s\d.,-]+$/.test(String(v))) num++; else { txt++; len += String(v).length; }
      }
      stats.push({ c, num, txt, len });
    }
    if (map.name == null) {
      const s = stats.filter((x) => x.txt > x.num).sort((a, b) => b.len - a.len)[0];
      if (s) { map.name = s.c; taken.add(s.c); }
    }
    if (map.price == null) {
      const s = stats.filter((x) => !taken.has(x.c) && x.num > x.txt).sort((a, b) => b.c - a.c)[0];
      if (s) { map.price = s.c; taken.add(s.c); }
    }
  }
  return map;
}
function loadImportSheet(name) {
  IMP.sheet = name;
  const rows = IMP.sheets[name];
  IMP.headerRow = detectHeaderRow(rows);
  IMP.map = autoMap(rows, IMP.headerRow);
  IMP.matchBy = IMP.map.code != null ? 'code' : 'name';
  IMP.addNew = true;
  IMP.markPrinted = S.products.length === 0;
  IMP.analysis = null;
  $('#iStep3').innerHTML = '';
  renderImportStep2();
}
function renderImportStep2() {
  const rows = IMP.sheets[IMP.sheet];
  const hr = IMP.headerRow;
  const headers = hr >= 0 ? rows[hr] : [];
  const ncol = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const colOpts = (sel) => '<option value="">— no usar —</option>' + Array.from({ length: ncol }, (_, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${colName(i)}${headers[i] !== undefined && cellStr(headers[i]) ? ': ' + U.esc(cellStr(headers[i]).slice(0, 30)) : ''}</option>`).join('');
  const data = rows.slice(hr + 1);
  const used = IMP_FIELDS.filter(([f]) => IMP.map[f] != null);
  $('#iStep2').innerHTML = `<div class="card"><h2>2. Revisá qué es cada columna</h2>
    <p class="hint">Archivo <b>${U.esc(IMP.file)}</b> · ${data.length} filas de datos. La app adivinó las columnas: fijate que estén bien y corregí si hace falta.</p>
    <div class="row" style="margin-bottom:12px">
      ${IMP.names.length > 1 ? `<label class="field">Hoja<select id="iSheet">${IMP.names.map((n) => `<option${n === IMP.sheet ? ' selected' : ''}>${U.esc(n)}</option>`).join('')}</select></label>` : ''}
      <label class="field">Fila de títulos<select id="iHr"><option value="-1">No tiene títulos</option>${rows.slice(0, 20).map((r, i) => `<option value="${i}"${i === hr ? ' selected' : ''}>Fila ${i + 1}: ${U.esc(r.map(cellStr).filter(Boolean).slice(0, 4).join(' | ').slice(0, 60))}</option>`).join('')}</select></label>
    </div>
    <div class="map-grid">${IMP_FIELDS.map(([f, l]) => `<label class="field">${l}<select data-map="${f}">${colOpts(IMP.map[f])}</select></label>`).join('')}</div>
    <div class="row" style="gap:20px;margin-bottom:12px">
      <label class="field">Reconocer artículos que ya están en el catálogo por
        <select id="iMatch"><option value="code"${IMP.matchBy === 'code' ? ' selected' : ''}${IMP.map.code == null ? ' disabled' : ''}>Código (recomendado)</option><option value="name"${IMP.matchBy === 'name' ? ' selected' : ''}>Nombre exacto</option></select></label>
      <label class="chk"><input type="checkbox" id="iAdd"${IMP.addNew ? ' checked' : ''}> Agregar los artículos nuevos</label>
      <label class="chk"><input type="checkbox" id="iPrinted"${IMP.markPrinted ? ' checked' : ''}> Los artículos nuevos ya tienen su cartel en la góndola con este precio</label>
    </div>
    <h3>Así se leen las primeras filas</h3>
    <div class="scroll"><table class="tbl"><thead><tr>${used.map(([, l]) => `<th>${l.replace(' *', '')}</th>`).join('')}</tr></thead><tbody>
      ${data.slice(0, 8).map((r) => `<tr>${used.map(([f]) => {
        const v = r[IMP.map[f]];
        if (f === 'price' || f === 'offer') { const n = U.parsePrice(v); return `<td>${cellStr(v) === '' ? '' : n > 0 ? '<b>' + U.esc(U.fmt(n, S.settings)) + '</b>' : '<span class="badge b-up">no es precio: ' + U.esc(cellStr(v)) + '</span>'}</td>`; }
        return `<td>${U.esc(cellStr(v))}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
    <div style="margin-top:14px"><button id="iAnalyze" class="primary big"${IMP.map.name == null || IMP.map.price == null ? ' disabled' : ''}>3. Ver qué cambia →</button>
      <button id="iCancel" class="danger">✕ Cancelar y descartar este archivo</button>
      ${IMP.map.name == null || IMP.map.price == null ? '<span class="hint"> Elegí al menos las columnas de nombre y precio.</span>' : ''}</div></div>`;
  const s2 = $('#iStep2');
  s2.onchange = (e) => {
    const el = e.target;
    if (el.id === 'iSheet') return loadImportSheet(el.value);
    if (el.id === 'iHr') { IMP.headerRow = +el.value; IMP.map = autoMap(rows, IMP.headerRow); IMP.matchBy = IMP.map.code != null ? 'code' : 'name'; }
    if (el.dataset.map) {
      const f = el.dataset.map;
      const v = el.value === '' ? null : +el.value;
      for (const k of Object.keys(IMP.map)) if (IMP.map[k] === v) delete IMP.map[k];
      if (v == null) delete IMP.map[f]; else IMP.map[f] = v;
      if (f === 'code') IMP.matchBy = v == null ? 'name' : 'code';
    }
    if (el.id === 'iMatch') IMP.matchBy = el.value;
    if (el.id === 'iAdd') IMP.addNew = el.checked;
    if (el.id === 'iPrinted') IMP.markPrinted = el.checked;
    IMP.analysis = null;
    $('#iStep3').innerHTML = '';
    renderImportStep2();
  };
  $('#iAnalyze').onclick = analyzeImport;
  $('#iCancel').onclick = cancelImport;
}
function resetImport() {
  Object.assign(IMP, { file: '', sheets: {}, names: [], sheet: '', headerRow: -1, map: {}, analysis: null });
  $('#iStep2').innerHTML = '';
  $('#iStep3').innerHTML = '';
  $('#iFile').value = '';
}
function cancelImport() {
  resetImport();
  toast('Archivo descartado. No se importó nada.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
const plainProduct = (p) => { const o = {}; for (const k in p) if (k[0] !== '_') o[k] = p[k]; return o; };
function renderLastImport() {
  const L = S.lastImport;
  const box = $('#iLast');
  if (!L) { box.innerHTML = ''; return; }
  const d = new Date(L.date);
  box.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;align-items:center">
    <div><b>Última importación:</b> ${U.esc(L.file)} · ${d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      <span class="hint"> · ${L.created.length} artículos nuevos, ${L.before.length} modificados</span></div>
    <button id="iUndo" class="danger">↩ Deshacer esa importación</button></div></div>`;
  $('#iUndo').onclick = undoImport;
}
async function undoImport() {
  const L = S.lastImport;
  if (!L) return;
  if (!(await confirmDlg(`¿Deshacer la importación de <b>${U.esc(L.file)}</b>?<br>Se borran los <b>${L.created.length}</b> artículos que agregó y los <b>${L.before.length}</b> que modificó vuelven a como estaban.`, 'Deshacer', true))) return;
  const ids = L.created.filter((id) => S.byId.has(id));
  const idSet = new Set(ids);
  if (ids.length) await DB.deleteProducts(ids);
  S.products = S.products.filter((p) => !idSet.has(p.id));
  ids.forEach((id) => { S.byId.delete(id); if (typeof C !== 'undefined' && C.sel) C.sel.delete(id); });
  S.queue = S.queue.filter((q) => !idSet.has(q.pid));
  const restored = [];
  for (const o of L.before) { const p = S.byId.get(o.id); if (p) { Object.assign(p, o); restored.push(p); } }
  if (restored.length) await saveProducts(restored);
  S.lastImport = null;
  await DB.kvSet('lastImport', null);
  saveQueue();
  updateCounts();
  resetImport();
  renderLastImport();
  toast(`Importación deshecha: ${ids.length} artículos borrados, ${restored.length} restaurados`);
}
function analyzeImport() {
  const rows = IMP.sheets[IMP.sheet];
  const m = IMP.map;
  const get = (r, f) => (m[f] == null ? '' : cellStr(r[m[f]]));
  const byKey = new Map(), byBar = new Map(), byName = new Map();
  for (const p of S.products) {
    const k = IMP.matchBy === 'code' ? p._c : p._n;
    if (k) byKey.set(k, p);
    if (p._b) byBar.set(p._b, p);
    if (p._n) byName.set(p._n, p);
  }
  const seen = new Map();
  let ignored = 0, dup = 0;
  for (const r of rows.slice(IMP.headerRow + 1)) {
    const name = get(r, 'name');
    const code = get(r, 'code');
    const price = U.parsePrice(m.price == null ? '' : r[m.price]);
    if (!name && !code) continue;
    if (!name || !(price > 0)) { ignored++; continue; }
    const key = IMP.matchBy === 'code' && code ? 'c:' + U.normCode(code) : 'n:' + U.norm(name);
    const offRaw = m.offer == null ? '' : r[m.offer];
    const off = U.parsePrice(offRaw);
    if (seen.has(key)) dup++;
    seen.set(key, { name, code, price, barcode: get(r, 'barcode'), category: get(r, 'category'), offer: off > 0 ? off : null });
  }
  const A = { news: [], changed: [], same: [], ignored, dup };
  for (const [key, row] of seen) {
    let p = byKey.get(key.slice(2));
    if (!p && row.barcode) p = byBar.get(U.normCode(row.barcode));
    if (!p) { const q = byName.get(U.norm(row.name)); if (q && (IMP.matchBy === 'name' || !q._c)) p = q; }
    if (p) (p.price !== row.price ? A.changed : A.same).push({ p, row });
    else A.news.push(row);
  }
  IMP.analysis = A;
  const ups = A.changed.filter((x) => x.row.price > x.p.price).length;
  // Los cambios más grandes (posibles errores) primero
  A.changed.sort((a, b) => Math.abs(Math.log(b.row.price / b.p.price)) - Math.abs(Math.log(a.row.price / a.p.price)));
  const jumps = A.changed.filter((x) => bigJump(x.p.price, x.row.price)).length;
  const st = S.settings;
  $('#iStep3').innerHTML = `<div class="card"><h2>3. Resultado</h2>
    <div class="stats">
      <div class="stat up"><b>${A.changed.length}</b>cambian de precio${A.changed.length ? ` <small>(${ups} suben, ${A.changed.length - ups} bajan)</small>` : ''}</div>
      <div class="stat new"><b>${A.news.length}</b>nuevos${IMP.addNew ? '' : ' <small>(no se agregan)</small>'}</div>
      <div class="stat ok"><b>${A.same.length}</b>sin cambios</div>
      <div class="stat"><b>${A.ignored}</b>filas sin nombre o sin precio (se saltean)</div>
      ${A.dup ? `<div class="stat"><b>${A.dup}</b>filas repetidas <small>(vale la última)</small></div>` : ''}
    </div>
    ${jumps ? `<p class="warn-box">⚠ <b>${jumps}</b> ${jumps === 1 ? 'precio cambia' : 'precios cambian'} al doble o más, o a la mitad o menos. Están arriba de todo en la lista: revisalos antes de confirmar.</p>` : ''}
    ${A.changed.length ? `<h3>Precios que cambian</h3><div class="scroll"><table class="tbl"><thead><tr><th>Artículo</th><th>Antes</th><th>Ahora</th><th>Dif.</th></tr></thead><tbody>
      ${A.changed.slice(0, 300).map(({ p, row }) => { const d = (row.price / p.price - 1) * 100; return `<tr><td>${U.esc(p.name)}</td><td>${U.esc(U.fmt(p.price, st))}</td><td><b>${U.esc(U.fmt(row.price, st))}</b></td><td><span class="badge ${d > 0 ? 'b-up' : 'b-down'}">${d > 0 ? '+' : ''}${d.toFixed(1)}%</span>${bigJump(p.price, row.price) ? ' <span class="badge b-warn" title="Cambio muy grande: fijate que no sea un error en el Excel">⚠ revisar</span>' : ''}</td></tr>`; }).join('')}
      ${A.changed.length > 300 ? `<tr><td colspan="4" class="hint">… y ${A.changed.length - 300} más</td></tr>` : ''}</tbody></table></div>` : ''}
    ${A.news.length && IMP.addNew ? `<h3>Artículos nuevos</h3><div class="scroll" style="max-height:200px"><table class="tbl"><tbody>${A.news.slice(0, 100).map((r) => `<tr><td class="mono">${U.esc(r.code)}</td><td>${U.esc(r.name)}</td><td>${U.esc(r.category)}</td><td><b>${U.esc(U.fmt(r.price, st))}</b></td></tr>`).join('')}${A.news.length > 100 ? `<tr><td colspan="4" class="hint">… y ${A.news.length - 100} más</td></tr>` : ''}</tbody></table></div>` : ''}
    <div style="margin-top:14px"><button id="iApply" class="primary big">Confirmar e importar</button> <button onclick="document.getElementById('iStep3').innerHTML=''">← Volver a las columnas</button> <button id="iCancel3" class="danger">✕ Cancelar y descartar este archivo</button></div></div>`;
  $('#iCancel3').onclick = cancelImport;
  $('#iApply').onclick = applyImport;
  $('#iStep3').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function applyImport() {
  const A = IMP.analysis;
  if (!A) return;
  const m = IMP.map;
  const touched = [];
  const upd = (p, row) => {
    let ch = false;
    if (m.category != null && row.category && row.category !== p.category) { p.category = row.category; ch = true; }
    if (m.barcode != null && row.barcode && row.barcode !== p.barcode) { p.barcode = row.barcode; ch = true; }
    if (m.code != null && row.code && row.code !== p.code && (IMP.matchBy !== 'code' || !p.code)) { p.code = row.code; ch = true; }
    if (IMP.matchBy === 'code' && row.name !== p.name) { p.name = row.name; ch = true; }
    if (m.offer != null && (p.offer ?? null) !== row.offer) { p.offer = row.offer; ch = true; }
    return ch;
  };
  const snap = new Map();
  for (const { p } of A.changed.concat(A.same)) snap.set(p.id, plainProduct(p));
  const changedProducts = [];
  for (const { p, row } of A.changed) { setPrice(p, row.price); upd(p, row); touched.push(p); changedProducts.push(p); }
  for (const { p, row } of A.same) if (upd(p, row)) touched.push(p);
  const created = [];
  if (IMP.addNew) {
    for (const row of A.news) {
      const p = newProduct({ name: row.name, code: row.code, barcode: row.barcode, category: row.category, price: row.price, offer: row.offer });
      if (IMP.markPrinted) { p.printedPrice = p.price; p.printedOffer = p.offer ?? null; }
      created.push(p);
      touched.push(p);
    }
  }
  await saveProducts(touched);
  S.lastImport = { date: Date.now(), file: IMP.file, created: created.map((p) => p.id), before: touched.filter((p) => snap.has(p.id)).map((p) => snap.get(p.id)) };
  await DB.kvSet('lastImport', S.lastImport);
  renderLastImport();
  const rows = IMP.sheets[IMP.sheet];
  if (IMP.headerRow >= 0) {
    const im = {};
    for (const [f] of IMP_FIELDS) if (m[f] != null) im[f] = U.norm(rows[IMP.headerRow][m[f]]);
    S.settings.importMap = im;
    saveSettings();
  }
  const toPrint = changedProducts.concat(IMP.markPrinted ? [] : created);
  $('#iStep2').innerHTML = '';
  $('#iStep3').innerHTML = `<div class="card"><h2>Listo ✓</h2>
    <p style="font-size:16px"><b>${changedProducts.length}</b> precios actualizados y <b>${created.length}</b> artículos nuevos. El catálogo tiene ahora <b>${S.products.length}</b> artículos.</p>
    <div class="row">
      ${toPrint.length ? `<button id="iToQ" class="primary big">Mandar a la cola los ${toPrint.length} que hay que imprimir</button>` : ''}
      <button id="iToCat">Ver el catálogo</button>
      <button id="iBk">Descargar copia de seguridad</button>
      <button id="iUndo2" class="danger">↩ Me equivoqué: deshacer esta importación</button>
    </div></div>`;
  $('#iUndo2').onclick = undoImport;
  if (toPrint.length) $('#iToQ').onclick = () => { addToQueue(toPrint.map((p) => ({ pid: p.id, qty: 1 })), false); showTab('imprimir'); };
  $('#iToCat').onclick = () => showTab('catalogo');
  $('#iBk').onclick = downloadBackup;
  $('#iFile').value = '';
  toast('Importación terminada');
}
function bindImport() {
  const handle = async (file) => {
    if (!file) return;
    try {
      const r = await readImportFile(file);
      if (!r.names.length) return toast('El archivo está vacío');
      IMP.file = file.name;
      IMP.sheets = r.sheets;
      IMP.names = r.names;
      loadImportSheet(r.names[0]);
    } catch (err) {
      console.error(err);
      toast('No se pudo leer el archivo. Probá guardarlo como .xlsx o .csv');
    }
  };
  $('#iFile').onchange = (e) => handle(e.target.files[0]);
  const drop = $('#iDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); });
}

/* =====================================================================
   PLANTILLAS
   ===================================================================== */
let curTplId = null;
const TPL_FIELDS = [
  ['Tamaño', [['name', 'Nombre de la plantilla', 'text'], ['w', 'Ancho (mm)', 'num'], ['h', 'Alto (mm)', 'num'], ['pad', 'Margen interno (mm)', 'num']]],
  ['Estilo', [['font', 'Letra', 'font'], ['bg', 'Fondo', 'color'], ['borderColor', 'Color del borde', 'color'], ['borderW', 'Grosor del borde (mm, 0 = sin borde)', 'num'], ['radius', 'Esquinas redondeadas (mm)', 'num']]],
  ['Nombre del artículo', [['nameH', 'Espacio para el nombre (% del alto)', 'num'], ['nameMax', 'Tamaño máximo de letra (pt)', 'num'], ['nameLines', 'Máximo de renglones', 'sel', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]],
    ['nameAlign', 'Alineación', 'sel', [['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']]], ['nameColor', 'Color', 'color'], ['nameBold', 'Negrita', 'chk'], ['nameUpper', 'TODO EN MAYÚSCULAS', 'chk']]],
  ['Precio', [['priceMax', 'Tamaño máximo de letra (pt)', 'num'], ['priceAlign', 'Alineación', 'sel', [['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']]], ['priceColor', 'Color', 'color'],
    ['priceBold', 'Negrita', 'chk'], ['priceSymbol', 'Mostrar el signo $', 'chk'], ['priceSupCents', 'Centavos chiquitos arriba', 'chk']]],
  ['Franja de arriba', [['bandText', 'Texto fijo (ej: nombre del negocio). Vacío = sin franja', 'text'], ['offerBand', 'Si el artículo está en oferta, mostrar franja de oferta', 'chk'], ['offerText', 'Texto de la franja de oferta', 'text'],
    ['bandH', 'Alto de la franja (mm, 0 = automático)', 'num'], ['bandBg', 'Fondo de la franja', 'color'], ['bandColor', 'Color del texto de la franja', 'color']]],
  ['Letra chica de abajo', [['showUnitPrice', 'Precio por kilo / litro (se calcula del nombre)', 'chk'], ['showCode', 'Código del artículo', 'chk'], ['showDate', 'Fecha de impresión', 'chk'], ['footColor', 'Color', 'color']]],
];
const curTpl = () => tplById(curTplId) || S.templates[0];

function renderTemplatesTab() {
  if (!tplById(curTplId)) curTplId = S.templates[0].id;
  renderTplList();
  renderTplForm();
  renderTplPreview();
  renderTplCats();
}
function renderTplList() {
  const counts = new Map();
  for (const p of S.products) { const t = tplFor(p); counts.set(t.id, (counts.get(t.id) || 0) + 1); }
  $('#tList').innerHTML = S.templates.map((t) => `<button class="tpl-item${t.id === curTplId ? ' on' : ''}" data-id="${t.id}"><span>${U.esc(t.name)}<br><small>${t.w} × ${t.h} mm · ${counts.get(t.id) || 0} art.</small></span>${t.id === S.settings.defaultTpl ? '<small title="Plantilla predeterminada">★</small>' : ''}</button>`).join('');
}
function renderTplForm() {
  const t = curTpl();
  $('#tForm').innerHTML = `<h2>Editar plantilla</h2><p class="hint">Los cambios se guardan solos y se aplican a todos los carteles que usan esta plantilla.</p>`
    + TPL_FIELDS.map(([title, fs]) => `<fieldset><legend>${title}</legend><div class="fields">${fs.map(([k, l, type, opts]) => {
      const v = t[k];
      if (type === 'chk') return `<label class="chk" style="grid-column:1/-1"><input type="checkbox" data-f="${k}"${v ? ' checked' : ''}> ${l}</label>`;
      if (type === 'color') return `<label class="field">${l}<input type="color" data-f="${k}" value="${v}"></label>`;
      if (type === 'font') return `<label class="field">${l}<select data-f="${k}">${Object.keys(FONTS).map((f) => `<option${f === v ? ' selected' : ''}>${f}</option>`).join('')}</select></label>`;
      if (type === 'sel') return `<label class="field">${l}<select data-f="${k}">${opts.map(([ov, ol]) => `<option value="${ov}"${String(v) === ov ? ' selected' : ''}>${ol}</option>`).join('')}</select></label>`;
      if (type === 'num') return `<label class="field">${l}<input type="number" step="0.5" min="0" data-f="${k}" value="${v}"></label>`;
      return `<label class="field" style="grid-column:1/-1">${l}<input data-f="${k}" value="${U.esc(v)}"></label>`;
    }).join('')}</div></fieldset>`).join('');
}
function renderTplPreview() {
  const t = curTpl();
  const price = U.parsePrice($('#tsPrice').value) || 0;
  const offer = $('#tsOffer').checked;
  const fake = { name: $('#tsName').value || 'Nombre del artículo', price, offer: offer ? U.roundTo(price * 0.85, 10, 'near') : null, code: '7790001', content: null, unit: '' };
  showPreview($('#tPreview'), labelHTML(fake, t), t, 2);
  $('#tPrevInfo').textContent = `Tamaño real: ${t.w} × ${t.h} mm · entran ${perPage(t, S.settings)} por hoja ${S.settings.paper} ${S.settings.orient === 'landscape' ? 'horizontal' : 'vertical'}`;
}
function renderTplCats() {
  const cats = categories();
  $('#tCats').innerHTML = `<label class="field" style="margin-bottom:12px"><b>Plantilla predeterminada</b> (para artículos sin categoría o con categoría sin plantilla)
      <select id="tDefault">${tplOptions(S.settings.defaultTpl || S.templates[0].id, '')}</select></label>`
    + (cats.length ? `<div class="scroll" style="max-height:380px"><table class="tbl"><tbody>${cats.map(([c, n]) => `<tr><td>${U.esc(c)} <small>(${n})</small></td><td><select data-cat="${U.esc(c)}">${tplOptions(S.catMap[c] || '', 'Predeterminada')}</select></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">Cuando tus artículos tengan categoría (se importa del Excel, o se pone desde el Catálogo), vas a poder elegir acá la plantilla de cada una.</p>');
}
function bindTemplates() {
  $('#tList').onclick = (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    curTplId = b.dataset.id;
    renderTemplatesTab();
  };
  const onField = (e) => {
    const el = e.target;
    const k = el.dataset.f;
    if (!k) return;
    const t = curTpl();
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') { v = parseFloat(el.value); if (!isFinite(v)) return; v = Math.max(0, v); if ((k === 'w' || k === 'h') && v < 10) return; }
    else if (k === 'nameLines') v = +el.value;
    else v = el.value;
    t[k] = v;
    t.v = (t.v || 0) + 1;
    saveTemplates();
    renderTplPreview();
    if (k === 'name' || k === 'w' || k === 'h') renderTplList();
  };
  $('#tForm').addEventListener('input', onField);
  $('#tForm').addEventListener('change', onField);
  for (const id of ['#tsName', '#tsPrice', '#tsOffer']) $(id).addEventListener('input', renderTplPreview);
  $('#tsOffer').addEventListener('change', renderTplPreview);
  $('#tNew').onclick = () => {
    const t = makeTemplate({ name: 'Nueva plantilla' });
    S.templates.push(t);
    curTplId = t.id;
    saveTemplatesNow();
    renderTemplatesTab();
    $('#tForm input[data-f="name"]').select();
  };
  $('#tDup').onclick = () => {
    const src = curTpl();
    const t = Object.assign({}, src, { id: U.uid('t'), name: src.name + ' (copia)', v: 1 });
    S.templates.push(t);
    curTplId = t.id;
    saveTemplatesNow();
    renderTemplatesTab();
  };
  $('#tDel').onclick = async () => {
    if (S.templates.length < 2) return toast('Tiene que quedar al menos una plantilla');
    const t = curTpl();
    if (!(await confirmDlg(`¿Eliminar la plantilla “${U.esc(t.name)}”? Los artículos que la usaban pasan a la plantilla automática.`, 'Eliminar', true))) return;
    S.templates = S.templates.filter((x) => x !== t);
    const changed = S.products.filter((p) => p.tpl === t.id);
    changed.forEach((p) => { p.tpl = ''; });
    if (changed.length) await saveProducts(changed);
    for (const c of Object.keys(S.catMap)) if (S.catMap[c] === t.id) delete S.catMap[c];
    S.queue.forEach((q) => { if (q.tpl === t.id) q.tpl = ''; });
    if (S.settings.defaultTpl === t.id) S.settings.defaultTpl = S.templates[0].id;
    saveTemplatesNow(); saveCatMap(); saveQueue(); saveSettings();
    curTplId = S.templates[0].id;
    renderTemplatesTab();
  };
  $('#tCats').addEventListener('change', (e) => {
    if (e.target.id === 'tDefault') { S.settings.defaultTpl = e.target.value; saveSettings(); renderTplList(); return; }
    const c = e.target.dataset.cat;
    if (c == null) return;
    if (e.target.value) S.catMap[c] = e.target.value; else delete S.catMap[c];
    saveCatMap();
    renderTplList();
  });
}

/* =====================================================================
   AJUSTES Y RESPALDO
   ===================================================================== */
function renderSettings() {
  const st = S.settings;
  $$('[data-s]').forEach((el) => {
    const v = st[el.dataset.s];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  });
  renderUpdate();
  $('#aLast').innerHTML = st.lastBackup ? `Última copia descargada: <b>${new Date(st.lastBackup).toLocaleString('es-AR')}</b>` : 'Todavía no descargaste ninguna copia.';
}
function bindSettings() {
  $('#tab-ajustes').addEventListener('change', (e) => {
    const k = e.target.dataset.s;
    if (!k) return;
    const el = e.target;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number' || k === 'roundTo') v = Math.max(0, parseFloat(v) || 0);
    S.settings[k] = v;
    saveSettings();
  });
  $('#aBackup').onclick = downloadBackup;
  $('#aExport').onclick = exportExcel;
  $('#aRestore').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'paraimprimir' || !Array.isArray(data.products)) throw new Error('formato');
      if (!(await confirmDlg(`Esta copia es del <b>${new Date(data.date).toLocaleString('es-AR')}</b> y tiene <b>${data.products.length}</b> artículos y <b>${(data.templates || []).length}</b> plantillas.<br><br>Se va a <b>reemplazar todo</b> lo que hay ahora. ¿Seguir?`, 'Restaurar', true))) return;
      await DB.clearProducts();
      await DB.putProducts(data.products);
      await DB.kvSet('templates', data.templates && data.templates.length ? data.templates : defaultTemplates());
      await DB.kvSet('settings', Object.assign({}, DEFAULT_SETTINGS, data.settings || {}, { lastBackup: Date.now() }));
      await DB.kvSet('catMap', data.catMap || {});
      await DB.kvSet('lastImport', null);
      await DB.kvSet('queue', data.queue || []);
      await DB.kvSet('lastBulk', null);
      await loadState();
      FIT_CACHE.clear();
      showTab('catalogo');
      toast(`Copia restaurada: ${S.products.length} artículos`);
    } catch (err) {
      console.error(err);
      toast('Ese archivo no es una copia de seguridad válida');
    }
  };
  $('#aWipe').onclick = async () => {
    if (!(await confirmDlg('¿Borrar <b>todos</b> los artículos, plantillas y ajustes? Esto no se puede deshacer.', 'Borrar todo', true))) return;
    if (!(await confirmDlg('¿Seguro? ¿Descargaste una copia de seguridad?', 'Sí, borrar todo', true))) return;
    await DB.clearProducts();
    await DB.kvClear();
    await loadState();
    showTab('imprimir');
    toast('Se borró todo');
  };
}
function downloadBackup() {
  const data = { app: 'paraimprimir', version: 1, date: Date.now(), products: S.products.map(plainProduct),
    templates: S.templates, settings: S.settings, catMap: S.catMap, queue: S.queue };
  U.download(`precios-copia-${U.today()}.json`, JSON.stringify(data), 'application/json');
  S.settings.lastBackup = Date.now();
  saveSettings();
  renderBanner();
  if (S.tab === 'ajustes') renderSettings();
  toast('Copia descargada. Guardala en un lugar seguro (pendrive, mail, WhatsApp).', { ms: 6000 });
}
function exportExcel() {
  if (!S.products.length) return toast('No hay artículos');
  const list = (S.tab === 'catalogo' && (C.q || C.cat !== '__all' || C.status) ? C.list : [...S.products].sort((a, b) => COLL.compare(a.name, b.name)));
  const rows = list.map((p) => ({ 'Código': p.code, 'Código de barras': p.barcode, 'Nombre': p.name, 'Categoría': p.category, 'Precio': p.price,
    'Oferta': p.offer ?? '', 'Plantilla': tplFor(p).name, 'Precio en góndola': p.printedPrice ?? '', 'Último cambio': p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('es-AR') : '' }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 45 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 12 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Artículos');
  XLSX.writeFile(wb, `articulos-${U.today()}.xlsx`);
}

/* =====================================================================
   INICIO
   ===================================================================== */
async function loadState() {
  S.settings = Object.assign({}, DEFAULT_SETTINGS, (await DB.kvGet('settings')) || {});
  let tpls = await DB.kvGet('templates');
  if (!tpls || !tpls.length) { tpls = defaultTemplates(); await DB.kvSet('templates', tpls); }
  S.templates = tpls.map((t) => makeTemplate(t));
  if (!tplById(S.settings.defaultTpl)) { S.settings.defaultTpl = S.templates[0].id; await saveSettings(); }
  S.catMap = (await DB.kvGet('catMap')) || {};
  S.queue = (await DB.kvGet('queue')) || [];
  S.lastBulk = (await DB.kvGet('lastBulk')) || null;
  S.lastImport = (await DB.kvGet('lastImport')) || null;
  S.products = (await DB.getAllProducts()) || [];
  S.products.forEach(indexProduct);
  S.byId = new Map(S.products.map((p) => [p.id, p]));
  updateCounts();
}

async function init() {
  try {
    await DB.open();
  } catch (e) {
    document.body.innerHTML = '<p style="padding:30px;font-size:18px">Este navegador no deja guardar datos (¿modo incógnito?). Abrí la app en Chrome o Edge normal.</p>';
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await loadState();
  $('#tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };
  bindImprimir();
  bindPrintView();
  bindCatalog();
  bindImport();
  bindTemplates();
  bindSettings();
  document.addEventListener('keydown', (e) => {
    // Ctrl+P: desde la pantalla principal salía una hoja en blanco. Ahora abre la hoja de carteles; ahí adentro, imprime.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      if (!$('#printView').hidden) { $('#pvPrint').click(); return; }
      if ($('#dlg').open) return;
      if (!S.queue.length) { toast('No hay carteles en la cola. Cargá artículos o tocá “+ Pendientes de imprimir”.'); return; }
      openSheets();
      toast('Revisá la hoja y apretá <b>Imprimir</b> (o Ctrl+P otra vez).', { ms: 5000 });
      return;
    }
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#dlg').open && $('#printView').hidden) {
      e.preventDefault();
      if (S.tab === 'catalogo') $('#cSearch').focus(); else { showTab('imprimir'); $('#qName').focus(); }
    }
    if (e.key === 'Escape' && !$('#printView').hidden && !$('#dlg').open) closeSheets();
    if ((e.key === 'Delete' || e.key === 'Backspace') && !$('#printView').hidden && !$('#dlg').open && PV.selQ
      && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault();
      const q = S.queue.find((x) => x.id === PV.selQ);
      if (q) setQueueQty(q.id, (+q.qty || 1) - 1);
    }
  });
  window.addEventListener('afterprint', () => $('#pvDone').classList.add('flash'));
  window.addEventListener('resize', U.debounce(() => { if (S.tab === 'imprimir') renderQPreview(); if (S.tab === 'plantillas') renderTplPreview(); }, 200));
  showTab('imprimir');
  checkUpdate();
  setInterval(checkUpdate, 60 * 60 * 1000);
}

/* ---------------- Aviso de versión nueva ----------------
   Compara la versión instalada (js/version.js, lo escribe ACTUALIZAR.bat) con la última publicada. */
const UPD = { repo: 'SarkisMorales/paraimprimir', branch: 'claude/epic-dirac-dhv0f6', latest: null, hidden: false };
async function checkUpdate() {
  if (navigator.onLine === false) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${UPD.repo}/commits/${UPD.branch}`, { cache: 'no-store' });
    if (!r.ok) return;
    const c = await r.json();
    UPD.latest = { sha: c.sha, msg: String(c.commit && c.commit.message || '').split('\n')[0], date: c.commit && c.commit.committer && c.commit.committer.date };
  } catch (e) { return; }
  renderUpdate();
}
function renderUpdate() {
  const box = $('#updBar');
  const cur = window.APP_VERSION || '';
  const newer = UPD.latest && UPD.latest.sha !== cur;
  box.innerHTML = newer && !UPD.hidden
    ? `<div class="updbar"><span>🔄 <b>Hay una versión nueva de la app</b>${UPD.latest.msg ? `: ${U.esc(UPD.latest.msg)}` : ''}.
        En la carpeta de la app hacé doble clic en <b>ACTUALIZAR</b> y después apretá <b>F5</b> acá.</span>
        <button id="updLater" class="ghost">Ahora no</button></div>`
    : '';
  if ($('#updLater')) $('#updLater').onclick = () => { UPD.hidden = true; renderUpdate(); };
  const info = $('#aVersion');
  if (info) {
    info.innerHTML = `Versión instalada: <b>${cur ? cur.slice(0, 7) : 'sin datos (todavía no usaste ACTUALIZAR)'}</b>`
      + (UPD.latest ? (newer ? ` · Hay una más nueva: <b>${UPD.latest.sha.slice(0, 7)}</b>${UPD.latest.date ? ` del ${new Date(UPD.latest.date).toLocaleDateString('es-AR')}` : ''}` : ' · <span style="color:var(--ok)">Estás al día ✓</span>') : '');
  }
}

init();
