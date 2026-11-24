'use strict';
/* =====================================================================
   Imprimir rápido con la cámara
   Se escanea el código de barras del producto en la góndola, la app muestra
   el cartel con nombre, precio y código, y con "Confirmar" va a la cola.

   - En el celular conectado por Wi-Fi (http://192.168...:8787) el navegador no
     deja usar la cámara en vivo (solo en páginas https), así que se abre la
     cámara del teléfono para sacar una foto del código y la app la lee.
   - En la compu (localhost) o en páginas seguras usa la cámara en vivo.
   El lector de códigos (lib/zxing.min.js) funciona sin internet.
   ===================================================================== */
const Scan = (() => {
  const SC = { open: false, live: false, stream: null, timer: 0, busy: false, prod: null, code: '', count: 0 };
  const canLive = () => !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const el = (id) => document.getElementById(id);

  /* ---------- Lectura del código ---------- */
  let reader = null, detector = null;
  function zx() {
    if (reader || !window.ZXing) return reader;
    const Z = window.ZXing, F = Z.BarcodeFormat;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.CODABAR]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    return reader;
  }
  async function nativeDetector() {
    if (detector !== null) return detector;
    detector = false;
    try {
      if ('BarcodeDetector' in window) {
        const ok = await window.BarcodeDetector.getSupportedFormats();
        const want = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'].filter((f) => ok.includes(f));
        if (want.length) detector = new window.BarcodeDetector({ formats: want });
      }
    } catch (e) { detector = false; }
    return detector;
  }
  async function readCanvas(cv) {
    const d = await nativeDetector();
    if (d) {
      try { const r = await d.detect(cv); if (r && r[0] && r[0].rawValue) return r[0].rawValue; } catch (e) { /* sigue con ZXing */ }
    }
    const rd = zx();
    if (!rd) return '';
    const Z = window.ZXing;
    for (const Bin of [Z.HybridBinarizer, Z.GlobalHistogramBinarizer]) {
      try {
        const res = rd.decode(new Z.BinaryBitmap(new Bin(new Z.HTMLCanvasElementLuminanceSource(cv))));
        if (res && res.getText()) return res.getText();
      } catch (e) { /* no encontró nada con este método */ } finally { try { rd.reset(); } catch (e) {} }
    }
    return '';
  }
  function drawScaled(img, w0, h0, maxSide, deg) {
    const s = Math.min(1, maxSide / Math.max(w0, h0));
    const w = w0 * s, h = h0 * s, r = (deg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(r)), sin = Math.abs(Math.sin(r));
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * cos + h * sin);
    cv.height = Math.round(w * sin + h * cos);
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    g.translate(cv.width / 2, cv.height / 2);
    g.rotate(r);
    g.drawImage(img, -w / 2, -h / 2, w, h);
    return cv;
  }
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('imagen')); };
      img.src = url;
    });
  }
  // Una foto: se prueba en varios tamaños y ángulos (el teléfono casi nunca está derecho, o el código está parado)
  async function readPhoto(file) {
    const img = await loadImage(file);
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const tries = [[1400, 0], [1000, 0], [1400, 90], [2000, 0], [1000, 8], [1000, -8], [1000, 90 + 8], [1000, 90 - 8], [1000, 16], [1000, -16], [700, 0]];
    for (const [side, deg] of tries) {
      const code = await readCanvas(drawScaled(img, w0, h0, side, deg));
      if (code) return code;
      await new Promise((r) => setTimeout(r, 0)); // que no se congele la pantalla
    }
    return '';
  }

  /* ---------- Pantallas ---------- */
  function show(state) {
    for (const s of ['idle', 'live', 'reading', 'found', 'missing', 'fail']) el('sc-' + s).hidden = s !== state;
    el('scCount').textContent = SC.count ? `${SC.count} a la cola en esta tanda` : '';
  }
  function open() {
    SC.open = true;
    SC.count = 0;
    el('scanView').hidden = false;
    document.body.classList.add('scanning');
    if (canLive()) startLive();
    else { show('idle'); el('scFile').click(); } // celular: abre la cámara directo (sigue siendo el mismo toque)
  }
  function close() {
    stopLive();
    SC.open = false;
    el('scanView').hidden = true;
    document.body.classList.remove('scanning');
    if (S.tab === 'imprimir') renderQueue();
  }
  // Seguir escaneando: en vivo retoma el video; con fotos vuelve a abrir la cámara del teléfono
  function next() {
    SC.prod = null;
    if (SC.live) { show('live'); loop(); return; }
    show('idle');
    el('scFile').click(); // se llama dentro del toque del botón, así el teléfono deja abrir la cámara
  }

  /* ---------- Cámara en vivo ---------- */
  async function startLive() {
    try {
      SC.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const v = el('scVideo');
      v.srcObject = SC.stream;
      await v.play();
      SC.live = true;
      show('live');
      loop();
    } catch (e) {
      SC.live = false;
      stopLive();
      show('idle');
      el('scIdleMsg').innerHTML = 'No se pudo usar la cámara en vivo. Tocá el botón para <b>sacar una foto</b> del código.';
    }
  }
  function stopLive() {
    clearTimeout(SC.timer);
    if (SC.stream) SC.stream.getTracks().forEach((t) => t.stop());
    SC.stream = null;
    SC.live = false;
  }
  function loop() {
    clearTimeout(SC.timer);
    SC.timer = setTimeout(async () => {
      if (!SC.open || !SC.live || el('sc-live').hidden) return;
      const v = el('scVideo');
      if (v.videoWidth) {
        // Solo la franja del medio (donde está el recuadro): más rápido y más preciso
        const cw = v.videoWidth * 0.86, ch = v.videoHeight * 0.5;
        const s = Math.min(1, 900 / cw);
        const cv = document.createElement('canvas');
        cv.width = Math.round(cw * s); cv.height = Math.round(ch * s);
        cv.getContext('2d', { willReadFrequently: true }).drawImage(v, (v.videoWidth - cw) / 2, (v.videoHeight - ch) / 2, cw, ch, 0, 0, cv.width, cv.height);
        const code = await readCanvas(cv);
        if (code && SC.open && !el('sc-live').hidden) return found(code);
      }
      loop();
    }, 180);
  }

  /* ---------- Resultado ---------- */
  async function onPhoto(file) {
    if (!file) return;
    show('reading');
    let code = '';
    try { code = await readPhoto(file); } catch (e) { code = ''; }
    if (code) found(code); else show('fail');
  }
  function found(raw) {
    const code = String(raw).trim();
    SC.code = code;
    if (navigator.vibrate) navigator.vibrate(60);
    const p = findByCode(code);
    if (!p) {
      el('scMissCode').textContent = code;
      show('missing');
      return;
    }
    SC.prod = p;
    const st = S.settings;
    el('scName').textContent = p.name;
    el('scPrice').innerHTML = p.offer > 0
      ? `${U.esc(U.fmt(p.offer, st))} <small class="sc-old">${U.esc(U.fmt(p.price, st))}</small> <span class="sc-offer">OFERTA</span>`
      : U.esc(U.fmt(p.price, st));
    el('scBar').textContent = code;
    const inQ = S.queue.find((q) => q.pid === p.id);
    el('scInQ').hidden = !inQ;
    show('found');
    const t = tplFor(p);
    showPreview(el('scPrev'), labelHTML(p, t), t, 1.4);
  }
  function confirm() {
    const p = SC.prod && S.byId.get(SC.prod.id);
    if (!p) return next();
    const already = S.queue.some((q) => q.pid === p.id);
    if (!already) { addToQueue([{ pid: p.id, qty: 1 }], false); SC.count++; }
    toast(already ? `“${U.esc(p.name)}” ya estaba en la cola` : `✓ A la cola: ${U.esc(p.name)}`);
    next();
  }
  function manual() {
    const v = el('scManual').value.trim();
    if (!v) { el('scManual').focus(); return; }
    el('scManual').value = '';
    found(v);
  }

  function bind() {
    el('btnScan').onclick = open;
    el('scClose').onclick = close;
    el('scFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; onPhoto(f); };
    el('scShoot').onclick = () => el('scFile').click();
    el('scRetry').onclick = () => el('scFile').click();
    el('scOk').onclick = confirm;
    el('scNo').onclick = next;
    el('scMissNext').onclick = next;
    el('scMissAdd').onclick = () => { const c = SC.code; close(); editProduct(null); setTimeout(() => { const b = $('#eBar'); if (b) b.value = c; }, 0); };
    el('scManualGo').onclick = manual;
    el('scManual').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); manual(); } };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && SC.open && !$('#dlg').open) close(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && SC.live) clearTimeout(SC.timer); else if (SC.live && SC.open) loop(); });
  }
  bind();
  return { open, close, isOpen: () => SC.open, readPhoto, onPhoto };
})();
