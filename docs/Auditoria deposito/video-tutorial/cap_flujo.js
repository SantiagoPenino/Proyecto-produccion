// Recorre la pantalla real (Chrome con sesión iniciada) y guarda capturas + rectángulos en capturas/rects.json
// Uso: node cap_flujo.js --pasos=modulo,barra,abrir,escanear,termometro,situacion,cerrar,casos,sync,reportes,ciclico [--anular]
const fs = require('fs'); const path = require('path');
const L = require('./cap_lib');
const { page: _p, espera, shot, escanear, APP, DIR } = L;
const pasosArg = (process.argv.find(a => a.startsWith('--pasos=')) || '--pasos=modulo').split('=')[1].split(',');
const ANULAR = process.argv.includes('--anular');
const RECTS_F = path.join(DIR, 'capturas', 'rects.json');
fs.mkdirSync(path.join(DIR, 'capturas'), { recursive: true });
const rects = fs.existsSync(RECTS_F) ? JSON.parse(fs.readFileSync(RECTS_F, 'utf8')) : {};
const guardar = () => fs.writeFileSync(RECTS_F, JSON.stringify(rects, null, 1));
const union = (...rs) => { const v = rs.filter(Boolean); if (!v.length) return null; const x = Math.min(...v.map(r => r.x)), y = Math.min(...v.map(r => r.y)); return { x, y, w: Math.max(...v.map(r => r.x + r.w)) - x, h: Math.max(...v.map(r => r.y + r.h)) - y }; };

// rect del elemento que contiene el texto, subiendo a un ancestro (closest selector o ancho mínimo)
async function rectDe(page, texto, o = {}) {
  const r = await page.evaluate((t, o) => {
    const tags = o.tags || ['button', 'a', 'span', 'div', 'th', 'td', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'p', 'li', 'b', 'input', 'option', 'select'];
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); const q = norm(t);
    let mejor = null;
    for (const tag of tags) for (const el of document.querySelectorAll(tag)) {
      const txt = tag === 'input' ? norm(el.placeholder) : norm(el.innerText);
      if (!txt) continue; if (o.regex ? !new RegExp(t, 'i').test(txt) : !txt.includes(q)) continue; if (o.exacto && txt !== q) continue;
      const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2 || b.bottom < 0 || b.top > innerHeight) continue;
      const area = b.width * b.height; if (!mejor || area < mejor.area) mejor = { area, el };
    }
    if (!mejor) return null;
    let el = mejor.el;
    if (o.closest) el = el.closest(o.closest) || el;
    if (o.anchoMin) { let a = el; while (a && a.getBoundingClientRect().width < o.anchoMin) a = a.parentElement; if (a) el = a; }
    if (o.subir) { for (let i = 0; i < o.subir && el.parentElement; i++) el = el.parentElement; }
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), tag: el.tagName, txt: norm(el.innerText).slice(0, 50) };
  }, texto, o);
  if (!r && !o.opcional) throw new Error('No encontré: ' + texto);
  return r;
}
async function rectSel(page, sel, opcional) {
  const r = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; }, sel);
  if (!r && !opcional) throw new Error('No encontré selector: ' + sel); return r;
}
async function click(page, r, ms = 500) { await page.mouse.click(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)); await espera(ms); }
async function clickTexto(page, texto, o = {}) { const r = await rectDe(page, texto, o); await click(page, r, o.ms); return r; }
async function esperarTexto(page, texto, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const r = await rectDe(page, texto, { opcional: true }); if (r) return r; await espera(400); } throw new Error('No apareció: ' + texto); }
async function textosBotones(page) { return page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 80)); }
async function irTab(page, label) { await clickTexto(page, label, { tags: ['button', 'span', 'div'], ms: 900 }); }

const pasos = {
  async modulo(page) {
    await page.goto(APP + '/logistica/auditoria-deposito', { waitUntil: 'networkidle2', timeout: 60000 }); await espera(1500);
    await esperarTexto(page, 'Escaneo Físico');
    // ícono activo de la barra lateral (menú colapsado): el elemento clickeable bajo el punto (32, 246)
    const menu = await page.evaluate(() => { const el = document.elementFromPoint(32, 246); const a = el && (el.closest('a,button,li') || el); if (!a) return null; const b = a.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; });
    const tabs = union(...await Promise.all(['Escaneo Físico', 'Situación depósito', 'Registro de Casos', 'Reportes', 'Conteo cíclico'].map(t => rectDe(page, t, { tags: ['button', 'span'], opcional: true }))));
    const titulo = await rectDe(page, 'Auditoría de Depósito / Control Físico', { opcional: true });
    rects['02'] = { menu, tabs, titulo, img: await shot(page, '02_modulo') };
    // ¿el menú se expande al pasar el mouse? probamos y guardamos una segunda captura
    await page.mouse.move(32, 246); await espera(900);
    const menuTexto = await rectDe(page, 'Auditoría de Depósito', { tags: ['a', 'button', 'span', 'li'], opcional: true });
    if (menuTexto && menuTexto.y < 700 && menuTexto.x < 400) { rects['02'].menuTexto = menuTexto; rects['02'].imgMenu = await shot(page, '02b_menu'); }
    await page.mouse.move(640, 150); await espera(500);
    console.log('modulo:', JSON.stringify(rects['02']));
  },
  async barra(page) {
    const abiertaBtn = await rectDe(page, 'Anular (sin generar casos)', { opcional: true });
    if (abiertaBtn) {
      if (!ANULAR) throw new Error('Hay una auditoría abierta y no se autorizó anularla (--anular)');
      await click(page, abiertaBtn, 800);
      const inp = await page.$('input[placeholder*="otivo"], input[maxlength="400"]'); if (inp) { await inp.click(); await inp.type('Tutorial: se anula para grabar el paso a paso', { delay: 5 }); }
      await clickTexto(page, 'Anular sin generar casos', { tags: ['button'], ms: 1500 });
      await esperarTexto(page, 'Abrir auditoría (tomar fotografía)', 20000);
    }
    const btnAbrir = await rectDe(page, 'Abrir auditoría (tomar fotografía)', { tags: ['button'] });
    const barra = await rectDe(page, 'Abrir auditoría (tomar fotografía)', { tags: ['button'], anchoMin: 900 });
    const input = await rectSel(page, 'input[placeholder*="Abrí una auditoría"]', true);
    const aviso = await rectDe(page, 'el escaneo está bloqueado', { opcional: true, anchoMin: 600 });
    rects['03'] = { btnAbrir, barra, input, aviso, img: await shot(page, '03_barra') };
    console.log('barra:', JSON.stringify(rects['03']));
  },
  async abrir(page) {
    await clickTexto(page, 'Abrir auditoría (tomar fotografía)', { tags: ['button'], ms: 1200 });
    console.log('botones del modal:', (await textosBotones(page)).join(' | '));
    const prefijoBtn = await clickTexto(page, 'Solo algunas áreas', { tags: ['button'], ms: 600 });
    const total = await rectDe(page, 'Todo el depósito', { tags: ['button'], opcional: true }) || await rectDe(page, 'Todo', { tags: ['button'], opcional: true });
    const chipTP = await clickTexto(page, '^tp( |$)', { tags: ['button'], regex: true, ms: 600 });
    const confirmar = await rectDe(page, 'y abrir', { tags: ['button'] });
    const modal = await rectDe(page, 'y abrir', { tags: ['button'], anchoMin: 420 });
    const tipos = await rectDe(page, 'Tipos', { opcional: true, anchoMin: 300 });
    rects['04'] = { alcance: union(total, prefijoBtn), prefijoBtn, chipTP, confirmar, modal, tipos, img: await shot(page, '04_abrir') };
    console.log('abrir:', JSON.stringify(rects['04']));
    await click(page, confirmar, 1500);
    await esperarTexto(page, 'Cerrar auditoría y generar casos', 30000); await espera(1200);
  },
  async escanear(page) {
    await escanear(page, 'TP-372'); await espera(600);
    const input = await rectSel(page, 'input[placeholder*="Pistola"]');
    const card1 = await rectDe(page, 'TP-372', { closest: '.rounded-md' });
    rects['05'] = { input, card1, img: await shot(page, '05_escaneo') };
    for (const c of ['TP-474', 'TP-250', 'TP-99999', 'TP-372', 'TP-359']) await escanear(page, c);
    await espera(800);
    const cardEntregada = await rectDe(page, 'Entregada', { closest: '.rounded-md', opcional: true });
    const cardNoIngresada = await rectDe(page, 'No ingresada', { closest: '.rounded-md', opcional: true });
    const cardDesconocida = await rectDe(page, 'Desconocida', { closest: '.rounded-md', opcional: true });
    const cardRepetida = await rectDe(page, 'Repetida', { closest: '.rounded-md', opcional: true });
    const botones = cardEntregada ? await page.evaluate((r) => { const el = document.elementFromPoint(r.x + 5, r.y + 5); const card = el && el.closest('.rounded-md'); if (!card) return null; return [...card.querySelectorAll('button')].map(b => { const bb = b.getBoundingClientRect(); return { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height), title: b.title }; }); }, cardEntregada) : null;
    rects['06'] = { cardEntregada, cardNoIngresada, cardDesconocida, cardRepetida, botones, img: await shot(page, '06_tarjetas') };
    if (botones && botones[0]) { await click(page, botones[0], 700); const ayuda = await rectDe(page, 'figura ENTREGADA', { opcional: true, anchoMin: 200 }); rects['06'].ayuda = ayuda; rects['06'].imgAyuda = await shot(page, '06b_ayuda'); await click(page, botones[0], 500); }
    console.log('escanear:', JSON.stringify(rects['06']));
  },
  async tarjetas(page) {
    // baja el contenido para que el bloque del escáner y las tarjetas queden enteras en pantalla
    await page.evaluate(() => { const c = document.querySelector('div.absolute.inset-0.overflow-y-auto'); if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = 0; } });
    await espera(300);
    await page.evaluate(() => { const c = document.querySelector('div.absolute.inset-0.overflow-y-auto'); if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = 300; } });
    await espera(900);
    const card = async (t) => rectDe(page, t, { tags: ['span', 'div'], closest: '.rounded-md', opcional: true });
    const input = await rectSel(page, 'input[placeholder*="Pistola"]');
    const c372 = await card('TP-372'), c359 = await card('TP-359'), c474 = await card('TP-474'), c250 = await card('TP-250'), c99999 = await card('TP-99999');
    const botones = c474 ? await page.evaluate((r) => { const el = document.elementFromPoint(r.x + 4, r.y + 4); const cardEl = el && el.closest('.rounded-md'); if (!cardEl) return null; return [...cardEl.querySelectorAll('button')].map(b => { const bb = b.getBoundingClientRect(); return { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height), title: b.title }; }); }, c474) : null;
    const pct = await rectDe(page, '^\\d+(\\.\\d+)?%$', { regex: true, tags: ['span'], opcional: true });
    const termo = pct ? await rectDe(page, '^\\d+(\\.\\d+)?%$', { regex: true, tags: ['span'], anchoMin: 250 }) : null;
    const filtroTodas = await rectDe(page, 'Todas', { tags: ['button'], opcional: true });
    const filtros = filtroTodas ? await rectDe(page, 'Todas', { tags: ['button'], anchoMin: 300 }) : null;
    const etiquetas = await page.evaluate(() => [...document.querySelectorAll('.rounded-md.border')].map(c => c.innerText.replace(/\s+/g, ' ').trim().slice(0, 40)));
    rects['05'] = { input, card1: c372, cardOk2: c359, img: await shot(page, '05_escaneo') };
    rects['06'] = { cardEntregada: c474, cardNoIngresada: c250, cardDesconocida: c99999, cardOk: c372, botones, etiquetas, img: rects['05'].img };
    rects['07'] = { pct, termo, filtros, img: rects['05'].img };
    if (botones && botones[0]) { await click(page, botones[0], 800); rects['06'].ayuda = await rectDe(page, 'figura ENTREGADA', { opcional: true, anchoMin: 200 }); rects['06'].imgAyuda = await shot(page, '06b_ayuda'); await click(page, botones[0], 500); }
    console.log('tarjetas:', JSON.stringify(rects['06']), JSON.stringify(rects['07']));
  },
  async termometro(page) {
    const pct = await rectDe(page, '^\\d+(\\.\\d+)?%$', { regex: true, tags: ['span'], opcional: true });
    const termo = pct ? await rectDe(page, '^\\d+(\\.\\d+)?%$', { regex: true, tags: ['span'], anchoMin: 250 }) : null;
    const filtroTodas = await rectDe(page, 'Todas', { tags: ['button'], opcional: true });
    const filtros = filtroTodas ? await rectDe(page, 'Todas', { tags: ['button'], anchoMin: 300 }) : null;
    const sinEscanear = await rectDe(page, 'Sin escanear', { tags: ['button'], opcional: true });
    rects['07'] = { pct, termo, filtros, sinEscanear, img: await shot(page, '07_termometro') };
    console.log('termometro:', JSON.stringify(rects['07']));
  },
  async situacion(page) {
    await page.evaluate(() => { const c = document.querySelector('div.absolute.inset-0.overflow-y-auto'); if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = 0; } }); await espera(400);
    await irTab(page, 'Situación depósito'); await espera(1500);
    const plazo = await rectSel(page, '[title^="Plazo en depósito"]', true), esc = await rectSel(page, '[title="Escaneo"]', true), aviso = await rectSel(page, '[title="Aviso al cliente"]', true);
    const pago = await rectSel(page, '[title^="Situación de pago"]', true);
    const tabla = await rectSel(page, 'table', true);
    const avisar = await rectDe(page, 'Avisar', { tags: ['button'], opcional: true }); const entregar = await rectDe(page, 'Entregad', { tags: ['button'], opcional: true });
    rects['08'] = { switches: union(plazo, esc, aviso), plazo, esc, aviso, pago, tabla, acciones: union(avisar, entregar), img: await shot(page, '08_situacion') };
    console.log('situacion:', JSON.stringify(rects['08']));
    await irTab(page, 'Escaneo Físico'); await espera(800);
  },
  async cerrar(page) {
    await page.evaluate(() => { const n = document.querySelector('nav.overflow-y-auto'); if (n) { n.style.scrollBehavior = 'auto'; n.scrollTop = 0; } });
    await page.evaluate(() => { const c = document.querySelector('div.absolute.inset-0.overflow-y-auto'); if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = 0; } }); await espera(400);
    const btnCerrar = await rectDe(page, 'Cerrar auditoría y generar casos', { tags: ['button'] });
    const btnAnular = await rectDe(page, 'Anular (sin generar casos)', { tags: ['button'] });
    rects['09'] = { btnCerrar, btnAnular, img: await shot(page, '09_cerrar') };
    await click(page, btnCerrar, 1200);
    console.log('botones modal cerrar:', (await textosBotones(page)).join(' | '));
    const inp = await page.$('input[maxlength="500"]'); if (inp) { await inp.click(); await inp.type('Tutorial paso a paso', { delay: 5 }); }
    rects['09'].confirmar = await rectDe(page, 'Cerrar y generar casos', { tags: ['button'] });
    rects['09'].imgModal = await shot(page, '09b_modal_cerrar');
    await click(page, rects['09'].confirmar, 1500);
    await esperarTexto(page, 'Casos nuevos', 40000); await espera(1200);
    const k = async (t) => rectDe(page, t, { opcional: true, subir: 1 });
    rects['10'] = { nuevos: await k('Casos nuevos'), yaEstaban: await k('Ya estaban'), reincidentes: await k('Reincidentes'), resueltos: await k('Resueltos solos'), abiertos: await k('Abiertos en el registro'), movidas: await rectDe(page, 'Movidas', { opcional: true, subir: 1 }), img: await shot(page, '10_resumen') };
    console.log('cerrar:', JSON.stringify(rects['10']));
    await clickTexto(page, 'Ver el Registro de Casos', { tags: ['button'], ms: 1500 });
  },
  async casos(page) {
    if (!(await rectDe(page, 'Severidad alta', { opcional: true }))) { await irTab(page, 'Registro de Casos'); }
    await esperarTexto(page, 'Severidad alta', 20000); await espera(1500);
    const kpiAlta = await rectDe(page, 'Severidad alta', { subir: 1 });
    const kpis = union(await rectDe(page, 'Casos abiertos', { subir: 1, opcional: true }), kpiAlta, await rectDe(page, 'Auditorías', { subir: 1, opcional: true, tags: ['div'] }));
    const filtroAb = await rectDe(page, 'Abiertos', { tags: ['button'], opcional: true }); const filtros = filtroAb ? await rectDe(page, 'Abiertos', { tags: ['button'], anchoMin: 400 }) : null;
    const tabla = await rectSel(page, 'table', true);
    rects['11'] = { kpiAlta, kpis, filtros, tabla, img: await shot(page, '11_casos') };
    console.log('casos:', JSON.stringify(rects['11']));
    let fila = null; for (const c of ['TP-474', 'TP-250', 'TP-211', 'TP-167', 'TP-39']) { fila = await rectDe(page, c, { tags: ['td'], opcional: true }); if (fila) { console.log('fila elegida', c); break; } }
    if (!fila) throw new Error('No hay fila TP visible');
    await click(page, fila, 1500);
    await page.evaluate(() => { const el = [...document.querySelectorAll('span,div')].find(e => /Acciones sobre depósito/.test(e.innerText) && e.children.length < 3); if (el) el.scrollIntoView({ block: 'center' }); }); await espera(600);
    const problemas = await rectDe(page, 'Problemas (', { anchoMin: 300, opcional: true });
    const acciones = await rectDe(page, 'Acciones sobre depósito', { anchoMin: 300, opcional: true });
    const seguimiento = await rectDe(page, 'Seguimiento de la orden', { anchoMin: 300, opcional: true });
    const historia = await rectDe(page, 'Historia', { anchoMin: 300, opcional: true });
    rects['12'] = { fila, problemas, acciones, seguimiento, historia, img: await shot(page, '12_detalle') };
    console.log('detalle:', JSON.stringify(rects['12']));
  },
  async sync(page) {
    if (!(await rectDe(page, 'Severidad alta', { opcional: true }))) { await irTab(page, 'Registro de Casos'); await espera(1200); }
    const rec = await rectDe(page, 'Cerrados recientes', { tags: ['button'], opcional: true });
    const filtro = rec || await rectDe(page, 'Cerrados', { tags: ['button'], exacto: false });
    await click(page, filtro, 1800);
    const tabla = await rectSel(page, 'table', true);
    const fila = await rectDe(page, 'utomátic', { tags: ['td', 'span'], opcional: true, closest: 'tr' }) || await rectDe(page, 'TP-', { tags: ['td'], opcional: true, closest: 'tr' });
    rects['13'] = { filtro, tabla, fila, img: await shot(page, '13_sync') };
    console.log('sync:', JSON.stringify(rects['13']));
    await clickTexto(page, 'Abiertos', { tags: ['button'], ms: 800 });
  },
  async reportes(page) {
    await irTab(page, 'Reportes'); await espera(1500);
    const sel = await page.$('select'); if (sel) { const ops = await page.evaluate(s => [...s.options].map(o => o.text), sel); console.log('opciones:', ops.slice(0, 4).join(' | ')); if (ops.length > 1) { await sel.select(await page.evaluate(s => s.options[1].value, sel)); } }
    await esperarTexto(page, 'Hallazgos', 30000); await espera(1500);
    const selector = await rectSel(page, 'select', true);
    const versiones = union(await rectDe(page, 'Ejecutivo', { tags: ['button'], opcional: true }), await rectDe(page, 'Completo', { tags: ['button'], opcional: true }));
    const botones = union(await rectDe(page, 'PDF', { tags: ['button'], opcional: true }), await rectDe(page, 'Imprimir', { tags: ['button'], opcional: true }), await rectDe(page, 'Excel', { tags: ['button'], opcional: true }));
    rects['14'] = { selector, versiones, botones, img: await shot(page, '14_reportes') };
    const hay = await rectDe(page, 'Análisis Gráfico Ejecutivo', { opcional: true });
    if (hay) { await page.evaluate(() => { const el = [...document.querySelectorAll('h3,h4,div,span')].find(e => /Análisis Gráfico Ejecutivo/.test(e.innerText) && e.children.length < 3); el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); }); await espera(900); rects['14'].graficos = await rectDe(page, 'Análisis Gráfico Ejecutivo', { anchoMin: 700 }); rects['14'].imgGraficos = await shot(page, '14b_graficos'); }
    console.log('reportes:', JSON.stringify(rects['14']));
    window.scrollTo && 0;
  },
  async casos2(page) {
    const scroll = async (y) => { await page.evaluate((y) => { const c = document.querySelector('div.absolute.inset-0.overflow-y-auto'); if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = y; } }, y); await espera(700); };
    await scroll(0);
    if (!(await rectDe(page, 'Severidad alta', { opcional: true }))) { await irTab(page, 'Registro de Casos'); await esperarTexto(page, 'Severidad alta', 20000); await espera(1200); }
    // filtro Abiertos, sin búsqueda
    await clickTexto(page, 'Abiertos', { tags: ['button'], ms: 1200 });
    await scroll(230);
    const kpiAlta = await rectDe(page, 'Severidad alta', { subir: 1 });
    const kpis = await rectDe(page, 'Severidad alta', { subir: 2 });
    const filtros = await rectDe(page, 'Abiertos', { tags: ['button'], anchoMin: 600 });
    const tabla = await rectSel(page, 'table', true);
    rects['11'] = { kpiAlta, kpis, filtros, tabla: tabla ? { ...tabla, h: Math.min(tabla.h, 720 - tabla.y) } : null, img: await shot(page, '11_casos') };
    console.log('casos2:', JSON.stringify(rects['11']));
    // detalle de una orden: buscar TP-474 por el campo Orden
    await scroll(0);
    const inp = await page.$('input[placeholder*="Orden (ej"]'); if (!inp) throw new Error('sin campo Orden');
    await inp.click({ clickCount: 3 }); await page.keyboard.type('TP-474', { delay: 30 }); await espera(2500);
    let fila = await rectDe(page, 'TP-474', { tags: ['td'], opcional: true });
    if (!fila) { await inp.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await page.keyboard.type('TP-250', { delay: 30 }); await espera(2500); fila = await rectDe(page, 'TP-250', { tags: ['td'] }); }
    await click(page, fila, 1800);
    await scroll(fila.y - 120 + 0);
    await espera(500);
    const problemas = await rectDe(page, 'Problemas (', { anchoMin: 300, opcional: true });
    const acciones = await rectDe(page, 'Acciones sobre depósito', { anchoMin: 300, opcional: true });
    const seguimiento = await rectDe(page, 'Seguimiento de la orden', { anchoMin: 300, opcional: true });
    const historia = await rectDe(page, 'Historia', { anchoMin: 300, opcional: true });
    const filaAb = await rectDe(page, fila.txt.toUpperCase().slice(0, 6), { tags: ['td'], opcional: true, closest: 'tr' });
    rects['12'] = { fila: filaAb, problemas, acciones, seguimiento, historia, img: await shot(page, '12_detalle') };
    console.log('detalle:', JSON.stringify(rects['12']));
    // cerrados recientes
    await scroll(0);
    await inp.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await espera(1500);
    const rec = await rectDe(page, 'Cerrados recientes', { tags: ['button'], opcional: true }) || await rectDe(page, 'Cerrados', { tags: ['button'] });
    await click(page, rec, 2000);
    await scroll(230);
    const filtro = await rectDe(page, 'Cerrados recientes', { tags: ['button'], opcional: true }) || await rectDe(page, 'Cerrados', { tags: ['button'] });
    const tabla2 = await rectSel(page, 'table', true);
    const fila2 = await rectDe(page, 'TP-', { tags: ['td'], opcional: true, closest: 'tr' });
    rects['13'] = { filtro, tabla: tabla2, fila: fila2, img: await shot(page, '13_sync') };
    console.log('sync2:', JSON.stringify(rects['13']));
    await scroll(0); await clickTexto(page, 'Abiertos', { tags: ['button'], ms: 800 });
  },
  async detalle(page) {
    const scroll = async (y) => { await page.evaluate((y) => { const c = document.querySelector('div.absolute.inset-0.overflow-y-auto'); if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = y; } }, y); await espera(700); };
    const scrollTop = () => page.evaluate(() => { const c = document.querySelector('div.absolute.inset-0.overflow-y-auto'); return c ? c.scrollTop : 0; });
    const setOrden = async (v) => { await page.evaluate((v) => { const i = document.querySelector('input[placeholder*="Orden (ej"]'); if (!i) throw new Error('sin campo Orden'); const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }, v); await espera(3000); };
    await scroll(0);
    if (!(await rectDe(page, 'Severidad alta', { opcional: true }))) { await irTab(page, 'Registro de Casos'); await esperarTexto(page, 'Severidad alta', 20000); await espera(1200); }
    await clickTexto(page, 'Abiertos', { tags: ['button'], ms: 1500 });
    await setOrden('TP-474');
    let fila = await rectDe(page, 'TP-474', { tags: ['td'], opcional: true });
    if (!fila) { await setOrden('TP-250'); fila = await rectDe(page, 'TP-250', { tags: ['td'] }); }
    const codigo = fila.txt.toUpperCase().slice(0, 6);
    await click(page, fila, 2000);
    const f2 = await rectDe(page, codigo, { tags: ['td'] }); const st = await scrollTop();
    await scroll(st + f2.y - 115);
    const filaAb = await rectDe(page, codigo, { tags: ['td'], closest: 'tr' });
    const problemas = await rectDe(page, 'Problemas (', { anchoMin: 300, opcional: true });
    const acciones = await rectDe(page, 'Acciones sobre depósito', { anchoMin: 300, opcional: true });
    const seguimiento = await rectDe(page, 'Seguimiento de la orden', { anchoMin: 300, opcional: true });
    const historia = await rectDe(page, 'Historia', { anchoMin: 300, opcional: true });
    rects['12'] = { fila: filaAb, problemas, acciones, seguimiento, historia, img: await shot(page, '12_detalle') };
    console.log('detalle:', JSON.stringify(rects['12']));
    await scroll(0); await setOrden('');
    const rec = await rectDe(page, 'Cerrados recientes', { tags: ['button'], opcional: true }) || await rectDe(page, 'Cerrados', { tags: ['button'] });
    await click(page, rec, 2500);
    await scroll(230);
    const filtro = await rectDe(page, 'Cerrados recientes', { tags: ['button'], opcional: true }) || await rectDe(page, 'Cerrados', { tags: ['button'] });
    const tabla2 = await rectSel(page, 'table', true);
    const fila2 = await rectDe(page, 'TP-', { tags: ['td'], opcional: true, closest: 'tr' });
    rects['13'] = { filtro, tabla: tabla2 ? { ...tabla2, h: Math.min(tabla2.h, 632 - tabla2.y) } : null, fila: fila2, img: await shot(page, '13_sync') };
    console.log('sync:', JSON.stringify(rects['13']));
    await scroll(0); await clickTexto(page, 'Abiertos', { tags: ['button'], ms: 800 });
  },
  async reportes2(page) {
    const scroll = async (y) => { await page.evaluate((y) => { const c = document.querySelector('div.absolute.inset-0.overflow-y-auto'); if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = y; } }, y); await espera(700); };
    await scroll(0); await irTab(page, 'Reportes'); await espera(1500);
    const sel = await page.$('select'); if (sel) { await sel.select(await page.evaluate(s => s.options[1].value, sel)); }
    await esperarTexto(page, 'Análisis Gráfico Ejecutivo', 30000); await espera(2500);
    const selector = await rectSel(page, 'select', true);
    const versiones = union(await rectDe(page, 'Ejecutivo', { tags: ['button'], opcional: true }), await rectDe(page, 'Completo', { tags: ['button'], opcional: true }));
    const botones = union(await rectDe(page, 'PDF', { tags: ['button'], opcional: true }), await rectDe(page, 'Excel', { tags: ['button'], opcional: true }));
    const kpis = await rectDe(page, 'ERI', { tags: ['div'], opcional: true, anchoMin: 900 });
    rects['14'] = { selector, versiones, botones, kpis, img: await shot(page, '14_reportes') };
    const h = await rectDe(page, 'Análisis Gráfico Ejecutivo', { opcional: true });
    if (h) { await scroll(h.y - 70); const graficos = await rectDe(page, 'Análisis Gráfico Ejecutivo', { anchoMin: 700 }); rects['14'].graficos = { ...graficos, h: Math.min(graficos.h, 632 - graficos.y) }; rects['14'].graficosTitulo = await rectDe(page, 'Análisis Gráfico Ejecutivo', {}); rects['14'].imgGraficos = await shot(page, '14b_graficos'); }
    console.log('reportes2:', JSON.stringify(rects['14']));
    await scroll(0);
  },
  async ciclico2(page) {
    const scroll = async (y) => { await page.evaluate((y) => { const c = document.querySelector('div.absolute.inset-0.overflow-y-auto'); if (c) { c.style.scrollBehavior = 'auto'; c.scrollTop = y; } }, y); await espera(700); };
    await scroll(0); await irTab(page, 'Conteo cíclico'); await espera(2000); await scroll(250);
    const tabla = await rectSel(page, 'table', true);
    const btn = await rectDe(page, 'Auditar solo', { tags: ['button'], opcional: true });
    const th = union(await rectDe(page, 'Clase', { tags: ['th'], opcional: true }), await rectDe(page, 'Cada', { tags: ['th'], opcional: true }), await rectDe(page, 'Estado', { tags: ['th'], opcional: true }), await rectDe(page, 'Próxima', { tags: ['th'], opcional: true }));
    const leyenda = await rectDe(page, 'Clase A', { opcional: true, anchoMin: 500 });
    const kpis = await rectDe(page, 'Cobertura', { opcional: true, subir: 2 });
    rects['15'] = { tabla: tabla ? { ...tabla, h: Math.min(tabla.h, 632 - tabla.y) } : null, btn, th, leyenda, kpis, img: await shot(page, '15_ciclico') };
    console.log('ciclico2:', JSON.stringify(rects['15']));
    await scroll(0);
  },
  async ciclico(page) {
    await irTab(page, 'Conteo cíclico'); await espera(2000);
    const tabla = await rectSel(page, 'table', true);
    const btn = await rectDe(page, 'Auditar solo', { tags: ['button'], opcional: true });
    const th = union(await rectDe(page, 'Clase', { tags: ['th'], opcional: true }), await rectDe(page, 'Frecuencia', { tags: ['th'], opcional: true }), await rectDe(page, 'Estado', { tags: ['th'], opcional: true }));
    const cobertura = await rectDe(page, 'Cobertura', { opcional: true, subir: 1 });
    rects['15'] = { tabla, btn, th, cobertura, img: await shot(page, '15_ciclico') };
    console.log('ciclico:', JSON.stringify(rects['15']));
  },
};

(async () => {
  const { browser, page } = await L.conectar();
  const st = await L.estado(page); if (!st.logueado) throw new Error('La ventana no tiene sesión iniciada: ' + st.url);
  for (const p of pasosArg) {
    if (!pasos[p]) { console.log('paso desconocido', p); continue; }
    try { await pasos[p](page); guardar(); } catch (e) { console.log(`✗ ${p}: ${e.message}`); guardar(); await shot(page, '_error_' + p); if (process.argv.includes('--seguir')) continue; else break; }
  }
  browser.disconnect();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
