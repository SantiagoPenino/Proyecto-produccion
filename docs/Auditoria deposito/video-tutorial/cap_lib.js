// Helpers de captura sobre el Chrome visible (chrome_daemon.js) donde el usuario inició sesión.
const fs = require('fs'); const path = require('path');
const ROOT = require('path').resolve(__dirname, '../../..').replace(/\\/g, '/');
const DIR = __dirname.replace(/\\/g, '/');
const puppeteer = require(ROOT + '/node_modules/puppeteer');
const APP = 'http://localhost:5173';
const VW = 1280, VH = 720;

async function conectar() {
  const ws = fs.readFileSync(DIR + '/ws.txt', 'utf8').trim();
  const browser = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null, protocolTimeout: 240000 });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes('localhost:5173')) || pages[0];
  await page.setViewport({ width: VW, height: VH });
  return { browser, page };
}
const estado = (page) => page.evaluate(() => ({ url: location.href, logueado: !!localStorage.getItem('auth_token'), sesionInterna: !!localStorage.getItem('user_session') }));
const espera = (ms) => new Promise(r => setTimeout(r, ms));

// Elemento más chico que contiene el texto (opcionalmente restringido a tags). Devuelve rect en coordenadas de viewport.
async function porTexto(page, texto, opts = {}) {
  const r = await page.evaluate((t, o) => {
    const tags = o.tags || ['button', 'a', 'span', 'div', 'th', 'td', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'p', 'li', 'input'];
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const q = norm(t);
    let mejor = null;
    for (const tag of tags) for (const el of document.querySelectorAll(tag)) {
      const txt = tag === 'input' ? norm(el.placeholder) : norm(el.innerText);
      if (!txt || !txt.includes(q)) continue;
      if (o.exacto && txt !== q) continue;
      const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) continue;
      if (b.bottom < 0 || b.top > innerHeight) continue;
      const area = b.width * b.height; const nth = o.nth || 0;
      if (!mejor || area < mejor.area) mejor = { area, x: b.x, y: b.y, w: b.width, h: b.height, tag, txt: txt.slice(0, 60) };
    }
    return mejor;
  }, texto, opts);
  if (!r && !opts.opcional) throw new Error('No encontré el texto: ' + texto);
  return r;
}
async function rectSel(page, selector, opcional) {
  const r = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, selector);
  if (!r && !opcional) throw new Error('No encontré el selector: ' + selector);
  return r;
}
const centro = (r) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });
async function clickTexto(page, texto, opts = {}) { const r = await porTexto(page, texto, opts); const c = centro(r); await page.mouse.click(c.x, c.y); await espera(opts.espera ?? 400); return r; }
async function shot(page, nombre) { fs.mkdirSync(DIR + '/capturas', { recursive: true }); await page.mouse.move(1272, 380); await espera(350); const p = path.join(DIR, 'capturas', nombre + '.png'); await page.screenshot({ path: p, clip: { x: 0, y: 0, width: VW, height: VH } }); return 'capturas/' + nombre + '.png'; }
async function escanear(page, codigo) {
  const ok = await page.evaluate(() => { const i = document.querySelector('input[placeholder*="Pistola"]'); if (!i) return false; i.focus(); return true; });
  if (!ok) throw new Error('No está el campo de escaneo');
  process.stdout.write(`  escaneando ${codigo}… `);
  await page.keyboard.type(codigo, { delay: 20 }); await page.keyboard.press('Enter'); await espera(1200);
  const n = await page.evaluate(() => document.querySelectorAll('.rounded-md.border').length);
  console.log(`tarjetas: ${n}`);
}
module.exports = { conectar, estado, espera, porTexto, rectSel, centro, clickTexto, shot, escanear, APP, DIR, VW, VH };
