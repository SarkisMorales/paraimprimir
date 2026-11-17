'use strict';
/* Núcleo: utilidades, formato de precios, plantillas, dibujo de etiquetas,
   ajuste automático del texto y acomodo de etiquetas en la hoja. */

const U = {
  norm(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  },
  // Códigos: sin espacios y sin ceros a la izquierda si son solo números (Excel los come).
  normCode(s) {
    let c = String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
    if (/^\d+$/.test(c)) c = c.replace(/^0+(?=\d)/, '');
    return c;
  },
  uid(prefix = '') {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  // Entiende "1.250", "1250,50", "$ 1.250,50", "1,250.50", 1250 (número de Excel)...
  parsePrice(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) / 100 : NaN;
    let s = String(v ?? '').trim();
    if (!s) return NaN;
    s = s.replace(/[^\d.,-]/g, '');
    if (!/\d/.test(s)) return NaN;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) {
      const dec = lc > ld ? ',' : '.';
      const th = dec === ',' ? '.' : ',';
      s = s.split(th).join('').replace(dec, '.');
    } else if (lc >= 0) {
      s = /^-?\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(/,(?=.*,)/g, '').replace(',', '.');
    } else if (ld >= 0) {
      if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      else s = s.replace(/\.(?=.*\.)/g, '');
    }
    const n = parseFloat(s);
    return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  },
  group(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); },
  // decimals: 'auto' (solo si hay centavos) | 'never' | 'always'
  fmtParts(n, decimals) {
    if (n == null || !isFinite(n)) return { int: '—', dec: '' };
    const neg = n < 0;
    n = Math.abs(n);
    if (decimals === 'never') n = Math.round(n);
    const totalCents = Math.round(n * 100);
    const int = Math.floor(totalCents / 100);
    const cents = totalCents % 100;
    const showDec = decimals === 'always' || (decimals === 'auto' && cents !== 0);
    return { int: (neg ? '-' : '') + U.group(String(int)), dec: showDec ? String(cents).padStart(2, '0') : '' };
  },
  fmt(n, st) {
    const p = U.fmtParts(n, st.decimals);
    return (st.currency ? st.currency + ' ' : '') + p.int + (p.dec ? ',' + p.dec : '');
  },
  // Número para poner en un campo de texto (sin signo, con coma decimal)
  num(n) {
    if (n == null || !isFinite(n)) return '';
    const p = U.fmtParts(n, 'auto');
    return p.int + (p.dec ? ',' + p.dec : '');
  },
  roundTo(x, step, mode) {
    if (!step) return Math.round(x * 100) / 100;
    const f = mode === 'near' ? Math.round : Math.ceil;
    return f(x / step - 1e-9) * step;
  },
  debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  },
  download(filename, data, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  dateShort(ts) {
    const d = ts ? new Date(ts) : new Date();
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(2);
  },

  /* Contenido neto a partir del nombre: "Yerba 500g", "Coca 2,25 L", "Aceite 900 cc" */
  UNIT_MAP: { g: 'g', gr: 'g', grs: 'g', grm: 'g', gramo: 'g', gramos: 'g', kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg',
    ml: 'ml', cc: 'ml', cm3: 'ml', l: 'l', lt: 'l', lts: 'l', ltr: 'l', litro: 'l', litros: 'l' },
  detectContent(name) {
    const m = /(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|gramos?|grs?|grm|g|ml|cc|cm3|lts?|ltr|litros?|l)(?![a-z0-9])/i.exec(U.norm(name));
    if (!m) return null;
    const content = parseFloat(m[1].replace(',', '.'));
    const unit = U.UNIT_MAP[m[2].toLowerCase()];
    return content > 0 && unit ? { content, unit } : null;
  },
  unitPriceText(price, c, st) {
    if (!c || !(c.content > 0) || !(price > 0)) return '';
    let per, u;
    switch (c.unit) {
      case 'g': per = price / c.content * 1000; u = 'kg'; break;
      case 'kg': per = price / c.content; u = 'kg'; break;
      case 'ml': per = price / c.content * 1000; u = 'litro'; break;
      case 'l': per = price / c.content; u = 'litro'; break;
      default: return '';
    }
    return U.fmt(Math.round(per * 100) / 100, Object.assign({}, st, { decimals: per < 100 ? 'auto' : 'never' })) + ' x ' + u;
  },
};

/* ---------------- Plantillas ---------------- */

const FONTS = {
  'Arial': 'Arial, Helvetica, sans-serif',
  'Arial Narrow (angosta)': "'Arial Narrow', 'Roboto Condensed', 'Liberation Sans Narrow', 'Nimbus Sans Narrow', Arial, sans-serif",
  'Impact (gruesa)': "Impact, 'Haettenschweiler', 'Arial Black', sans-serif",
  'Arial Black': "'Arial Black', 'Arial Bold', Arial, sans-serif",
  'Verdana': 'Verdana, Geneva, sans-serif',
  'Tahoma': 'Tahoma, Verdana, sans-serif',
  'Trebuchet MS': "'Trebuchet MS', Arial, sans-serif",
  'Georgia': 'Georgia, serif',
  'Courier New': "'Courier New', monospace",
};

function makeTemplate(over = {}) {
  return Object.assign({
    id: U.uid('t'), name: 'Nueva plantilla', w: 80, h: 50, pad: 2.5,
    font: 'Arial', bg: '#ffffff', borderColor: '#1f2937', borderW: 0.4, radius: 2,
    nameH: 42, nameMax: 22, nameLines: 2, nameAlign: 'center', nameColor: '#111111', nameBold: true, nameUpper: true,
    priceMax: 80, priceAlign: 'center', priceColor: '#111111', priceBold: true, priceSymbol: true, priceSupCents: true,
    bandText: '', offerBand: true, offerText: 'OFERTA', bandH: 0, bandBg: '#dc2626', bandColor: '#ffffff',
    showUnitPrice: true, showCode: false, showDate: false, footColor: '#4b5563',
    v: 1,
  }, over);
}

function defaultTemplates() {
  return [
    // Medidas pensadas para aprovechar el A4: 3, 4 y 2 por fila
    makeTemplate({ name: 'Estándar', w: 64, h: 42, pad: 2, nameMax: 18 }),
    makeTemplate({ name: 'Galletas (chica)', w: 48, h: 30, pad: 1.4, nameMax: 11, nameH: 40, priceMax: 44, borderW: 0.3, radius: 1.5 }),
    makeTemplate({ name: 'Heladeras (grande)', w: 96, h: 66, pad: 3, nameMax: 28, nameH: 38, priceMax: 120, borderW: 0.5, radius: 3 }),
    makeTemplate({ name: 'Oferta', w: 96, h: 66, pad: 3, nameMax: 26, nameH: 34, priceMax: 120, borderColor: '#dc2626', borderW: 0.8,
      radius: 3, priceColor: '#dc2626', bandText: 'OFERTA', bandH: 11 }),
  ];
}

const fontCss = (f) => FONTS[f] || FONTS.Arial;
const MM_PX = 96 / 25.4;
const PT_PX = 96 / 72;
const PT_PER_MM = 72 / 25.4;
const NAME_LH = 1.08;

/* Que "118 g", "1,5 L" o "x 25" no se partan en dos renglones */
function keepTogether(name) {
  return String(name ?? '')
    .replace(/(\d)\s+(?=(kgs?|grs?|gramos|g|ml|cc|lts?|litros?|l|u|un|unid|uds?|mts?|m|cm)(?![a-z]))/gi, '$1\u00a0')
    .replace(/(^|\s)(x)\s+(?=\d)/gi, '$1$2\u00a0');
}

/* d = { name, price, offer, code, unitTxt }  t = plantilla  st = ajustes */
function renderLabel(d, t, st) {
  const hasOffer = d.offer != null && d.offer > 0;
  const band = hasOffer && t.offerBand ? (t.offerText || 'OFERTA') : (t.bandText || '');
  const bandH = t.bandH > 0 ? t.bandH : Math.max(4, t.h * 0.16);
  const foot = [];
  if (t.showUnitPrice && d.unitTxt) foot.push(U.esc(d.unitTxt));
  if (t.showCode && d.code) foot.push('Cód. ' + U.esc(d.code));
  if (t.showDate) foot.push(U.dateShort());
  const main = hasOffer ? d.offer : d.price;
  const pp = U.fmtParts(main, st.decimals);
  const sym = t.priceSymbol && st.currency ? `<span class="sym">${U.esc(st.currency)}</span>` : '';
  const dec = pp.dec ? (t.priceSupCents ? `<span class="sup">${pp.dec}</span>` : `<span>,${pp.dec}</span>`) : '';
  const old = hasOffer ? `<div class="old">${U.esc(U.fmt(d.price, st))}</div>` : '';
  const jc = (a) => (a === 'left' ? 'flex-start' : a === 'right' ? 'flex-end' : 'center');
  const k = `${t.id}.${t.v}.${band ? 1 : 0}${foot.length ? 1 : 0}`;
  const border = t.borderW > 0 ? `${t.borderW}mm solid ${t.borderColor}` : 'none';
  return `<div class="lbl" style="width:${t.w}mm;height:${t.h}mm;background:${t.bg};border:${border};border-radius:${t.radius}mm;font-family:${fontCss(t.font)}">`
    + (band ? `<div class="band fit" data-k="${k}b" data-max="${(bandH * PT_PER_MM * 0.78).toFixed(1)}" style="height:${bandH}mm;background:${t.bandBg};color:${t.bandColor}"><div class="t one">${U.esc(band)}</div></div>` : '')
    + `<div class="body" style="padding:${t.pad}mm">`
    + `<div class="name fit" data-k="${k}n" data-max="${t.nameMax}" data-lines="${t.nameLines}" style="flex:0 0 ${t.nameH}%;color:${t.nameColor};font-weight:${t.nameBold ? 700 : 400};text-transform:${t.nameUpper ? 'uppercase' : 'none'}">`
    + `<div class="t${+t.nameLines === 1 ? ' one' : ''}" style="text-align:${t.nameAlign}">${U.esc(keepTogether(d.name))}</div></div>`
    + `<div class="price fit" data-k="${k}p" data-max="${t.priceMax}" style="justify-content:${jc(t.priceAlign)};color:${t.priceColor};font-weight:${t.priceBold ? 800 : 400}">`
    + `<div class="t one" style="text-align:${t.priceAlign}">${old}<div class="cur">${sym}<span>${pp.int}</span>${dec}</div></div></div>`
    + (foot.length ? `<div class="foot" style="color:${t.footColor}">${foot.join(' · ')}</div>` : '')
    + `</div></div>`;
}

/* ---------------- Ajuste automático del texto ----------------
   Busca el tamaño de letra más grande que entra en su lugar.
   Los resultados se guardan en memoria: el mismo texto en la misma plantilla no se vuelve a medir. */
const FIT_CACHE = new Map();

function fitOne(box, t, max, lines) {
  const W = box.clientWidth, H = box.clientHeight;
  if (!W || !H) return 0;
  const ok = (pt) => {
    t.style.fontSize = pt + 'pt';
    if (t.scrollWidth > W + 0.5) return false;
    const h = t.offsetHeight;
    if (h > H + 0.5) return false;
    if (lines > 0 && h > pt * PT_PX * NAME_LH * lines + 2) return false;
    return true;
  };
  if (ok(max)) return max;
  let lo = 3, hi = max;
  if (!ok(lo)) return lo;
  while (hi - lo > 0.2) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid; else hi = mid;
  }
  lo = Math.floor(lo * 10) / 10;
  t.style.fontSize = lo + 'pt';
  return lo;
}

function fitAll(root) {
  for (const box of root.querySelectorAll('.fit')) {
    const t = box.firstElementChild;
    if (!t) continue;
    const key = box.dataset.k + '|' + t.innerHTML;
    const c = FIT_CACHE.get(key);
    if (c) { t.style.fontSize = c + 'pt'; continue; }
    const pt = fitOne(box, t, +box.dataset.max || 30, +box.dataset.lines || 0);
    if (pt) FIT_CACHE.set(key, pt);
  }
}

/* ---------------- Acomodo en la hoja ---------------- */
const PAPERS = { A4: [210, 297], Carta: [215.9, 279.4], Oficio: [216, 340] };

function paperSize(st) {
  const [w, h] = PAPERS[st.paper] || PAPERS.A4;
  return st.orient === 'landscape' ? [h, w] : [w, h];
}

/* labels: [{ html, w, h }] → páginas con posiciones en mm (acomodo por filas) */
function packLabels(labels, st) {
  const [PW, PH] = paperSize(st);
  const m = +st.margin || 0, g = +st.gap || 0;
  const uw = PW - 2 * m, uh = PH - 2 * m;
  let list = labels.map((l, i) => Object.assign({ i }, l));
  if (st.optimize) list.sort((a, b) => b.h - a.h || b.w - a.w || a.i - b.i);
  const pages = [];
  let page = null, x = 0, y = 0, rowH = 0;
  for (const l of list) {
    if (!page) { page = []; pages.push(page); x = y = rowH = 0; }
    if (x > 0 && x + l.w > uw + 0.01) { x = 0; y += rowH + g; rowH = 0; }
    if (y > 0 && y + l.h > uh + 0.01) { page = []; pages.push(page); x = y = rowH = 0; }
    page.push({ l, x: m + x, y: m + y });
    x += l.w + g;
    rowH = Math.max(rowH, l.h);
  }
  return { pages, PW, PH };
}

function perPage(t, st) {
  const fake = Array.from({ length: 400 }, () => ({ w: t.w, h: t.h }));
  const r = packLabels(fake, Object.assign({}, st, { optimize: false }));
  return r.pages[0] ? r.pages[0].length : 0;
}
