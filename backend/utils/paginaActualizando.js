/**
 * «Estamos actualizando»: lo que ve la gente mientras se sube el build del front y
 * public/index.html todavía no está (19/10/2026: 3 min y medio de 404 en todo el sitio).
 *
 * - La página no usa NADA de public/ (es justo lo que falta): CSS, logo y script van adentro.
 * - Responde 503 + Retry-After y no se cachea: el service worker la deja pasar y no la guarda.
 * - La página se reintenta sola y recarga apenas el index vuelve.
 * - Un archivo (js, css, fuente) pedido en ese momento recibe un 503 corto en texto, nunca el
 *   HTML: así no queda guardado en caché como si fuera el archivo.
 * - El log dice UNA línea por minuto con cuántos pedidos se atendieron así, en vez de un error
 *   por pedido.
 */
const logger = require('./logger');

const RETRY_SEGUNDOS = 10;

const PAGINA = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Estamos actualizando · USER</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; }
  body {
    background: #0e0e10; color: #f4f4f5;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  main { width: 100%; max-width: 460px; text-align: center; }
  .logo { width: 132px; height: auto; display: block; margin: 0 auto 44px; }
  h1 { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 12px; }
  p { color: #a1a1aa; font-size: 15px; line-height: 1.6; }
  .barra { display: flex; gap: 6px; height: 6px; margin: 34px auto 14px; max-width: 280px; }
  .barra span { flex: 1; border-radius: 99px; opacity: .18; animation: tinta 2.4s ease-in-out infinite; }
  .barra span:nth-child(1) { background: #00ABFF; animation-delay: 0s; }
  .barra span:nth-child(2) { background: #FF009D; animation-delay: .3s; }
  .barra span:nth-child(3) { background: #FFFF00; animation-delay: .6s; }
  .barra span:nth-child(4) { background: #f4f4f5; animation-delay: .9s; }
  @keyframes tinta { 0%, 100% { opacity: .18; transform: scaleY(1); } 35% { opacity: 1; transform: scaleY(1.35); } }
  .estado { font-size: 13px; color: #71717a; min-height: 20px; }
  button {
    margin-top: 26px; background: transparent; color: #f4f4f5; cursor: pointer;
    border: 1.5px solid #3f3f46; border-radius: 10px; padding: 10px 20px;
    font: inherit; font-size: 14px; font-weight: 600;
  }
  button:hover { border-color: #00ABFF; color: #00ABFF; }
  @media (prefers-reduced-motion: reduce) { .barra span { animation: none; opacity: 1; } }
</style>
</head>
<body>
<main>
  <svg class="logo" viewBox="0 -15.2 240.08 127.15" role="img" aria-label="USER">
    <path fill="#f4f4f5" d="M0.66 6.54L14.09 6.54L14.09 47.37C14.09 56.81 20.47 63.86 30.05 63.86C39.76 63.86 46.67 56.81 46.67 46.84L46.67 6.54L60.11 6.54L60.11 74.37L46.67 74.37L46.67 66.79C42.02 72.38 34.84 75.7 26.72 75.7C11.16 75.7 0.66 64.4 0.66 49.9L0.66 6.54Z"/>
    <path fill="#f4f4f5" d="M67.36 53.2L80.26 53.23C81.84 60.94 88.48 64.95 96.86 64.97C104.18 64.98 108.7 61.53 108.72 56.35C108.72 52.22 105.8 49.29 99.42 47.55L86.93 44.46C74.83 41.38 68.59 34.98 68.61 25.27C68.64 12.9 78.63 4.94 92.33 4.97C108.16 5.01 118.51 14.74 120.35 27.51L107.45 27.48C105.87 19.76 99.09 15.76 92.18 15.75C85.66 15.73 81.79 19.18 81.78 23.97C81.78 28.23 85.09 31.16 91.47 32.77L103.17 35.85C115.67 39.07 121.91 45.6 121.88 55.31C121.86 67.01 112.13 75.77 96.97 75.74C80.48 75.7 69.73 66.11 67.36 53.2Z"/>
    <path fill="#f4f4f5" d="M234.49 18.51C225.71 18.51 219.33 25.29 219.33 35.8L219.33 74.37L205.89 74.37L205.89 6.54L219.19 6.54L219.19 14.92C222.52 9.47 227.97 6.01 235.42 6.01L240.07 6.01L240.07 18.51L234.49 18.51Z"/>
    <path fill="#f4f4f5" d="M142.09 41.6C142.09 41.6 142.37 19.83 163.14 17.22C173.68 15.89 181.65 23.18 184.19 29.29L142.09 41.6ZM185.17 54.89C182.58 58.34 179.16 60.78 175.81 62.42C173.02 63.77 170.29 64.58 167.13 64.77C162.55 65.14 158.11 64.1 153.86 61.78C149.6 59.44 146.42 56 144.44 52L198.64 36.14C198.37 32.55 197.53 29.06 196.14 25.79C193.31 19.14 188.23 13.41 181.11 9.52C163.73 0 142.82 6.9 133.62 23.71C129.78 30.71 128.47 38.21 129.4 45.31C129.86 48.85 130.87 52.28 132.4 55.51C132.84 56.44 133.32 57.36 133.85 58.25C137.1 63.8 142.04 68.21 148.31 71.65C151.21 73.24 156.41 75.74 165.89 75.74C171.15 75.74 176.31 74.99 180.88 72.97C186.42 70.53 191.13 67.04 194.86 62.1L185.17 54.89Z"/>
    <path fill="#FF009D" d="M122.22 86.24L117.87 96.75L57.85 96.75L62.19 86.24L122.22 86.24Z"/>
    <path fill="#FFFF00" d="M182.24 86.24L177.89 96.75L117.87 96.75L122.22 86.24L182.24 86.24Z"/>
    <path fill="#f4f4f5" d="M240.08 91.49C240.08 94.39 237.73 96.75 234.83 96.75L177.89 96.75L182.24 86.24L234.83 86.24C237.73 86.24 240.08 88.59 240.08 91.49Z"/>
    <path fill="#00ABFF" d="M62.2 86.24L57.85 96.75L5.26 96.75C2.35 96.75 0 94.39 0 91.49C0 88.59 2.35 86.24 5.26 86.24L62.2 86.24Z"/>
  </svg>
  <h1>Estamos actualizando</h1>
  <p>Estamos subiendo mejoras al sistema. Vuelve en unos segundos y la página se recarga sola: no hace falta que hagas nada.</p>
  <div class="barra" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
  <p class="estado" id="estado" role="status">Revisando de nuevo en unos segundos…</p>
  <button type="button" id="reintentar">Reintentar ahora</button>
</main>
<script>
  (function () {
    var estado = document.getElementById('estado');
    var espera = 4, intentos = 0, timer = null;
    function probar() {
      clearTimeout(timer);
      estado.textContent = 'Revisando…';
      fetch(location.href, { cache: 'no-store', headers: { 'X-Probe-Actualizando': '1' } })
        .then(function (r) {
          if (r.ok) { estado.textContent = 'Listo, cargando…'; location.reload(); return; }
          programar();
        })
        .catch(programar);
    }
    function programar() {
      intentos++;
      espera = Math.min(15, 4 + intentos * 2);
      var resta = espera;
      estado.textContent = 'Revisando de nuevo en ' + resta + ' s…';
      timer = setInterval(function () {
        resta--;
        if (resta <= 0) { clearInterval(timer); probar(); return; }
        estado.textContent = 'Revisando de nuevo en ' + resta + ' s…';
      }, 1000);
    }
    document.getElementById('reintentar').addEventListener('click', function () { clearInterval(timer); probar(); });
    programar();
  })();
</script>
</body>
</html>`;

// Una línea de log por minuto mientras dure (en vez de un error por pedido).
let atendidos = 0;
let avisoTimer = null;
function contar(req) {
    atendidos++;
    if (avisoTimer) return;
    logger.warn(`[FRONT] Falta public/index.html (¿deploy en curso?): se muestra «Estamos actualizando» — primer pedido ${req.method} ${req.originalUrl}`);
    avisoTimer = setTimeout(() => {
        logger.warn(`[FRONT] «Estamos actualizando»: ${atendidos} pedido(s) atendidos en el último minuto.`);
        atendidos = 0;
        avisoTimer = null;
    }, 60 * 1000);
    if (avisoTimer.unref) avisoTimer.unref();
}

/** Responde «Estamos actualizando»: la página a una navegación, un 503 corto a un archivo. */
function responderActualizando(req, res) {
    contar(req);
    res.status(503);
    res.setHeader('Retry-After', String(RETRY_SEGUNDOS));
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const esArchivo = /\.[a-z0-9]{1,6}$/i.test(req.path) && !/\.html?$/i.test(req.path);
    if (esArchivo) return res.type('text/plain').send('Actualizando. Reintentá en unos segundos.');
    return res.type('html').send(PAGINA);
}

module.exports = { responderActualizando, PAGINA };
