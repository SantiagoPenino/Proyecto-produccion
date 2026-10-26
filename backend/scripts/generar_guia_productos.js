// Arma en PDF la guía "Crear un producto terminado" (Configurar Productos) desde
// backend/docs/guias/guia-productos-terminados.html, con Chrome (puppeteer): índice clickeable,
// marcadores (panel del visor) y número de página. Mismo mecanismo que generar_guias_solicitudes.js.
// Uso (desde la raíz del proyecto):  node backend/scripts/generar_guia_productos.js
// Para cambiar el texto: editar el .html (las capturas están en backend/docs/guias/img-productos/) y volver a correr esto.
const path = require('path');
const puppeteer = require('puppeteer');

const RAIZ = path.resolve(__dirname, '..', '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const GUIA = {
  html: path.join(RAIZ, 'backend', 'docs', 'guias', 'guia-productos-terminados.html'),
  pdf: path.join(RAIZ, 'public', 'guias', 'guia-productos-terminados.pdf'),
  titulo: 'Guía · Crear un producto terminado (Configurar Productos)',
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file:///${GUIA.html.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
    // que estén todas las capturas antes de imprimir
    await page.evaluate(() => Promise.all([...document.images].map(i => (i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })))));
    const faltan = await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src')));
    if (faltan.length) throw new Error('No cargaron estas imágenes: ' + faltan.join(', '));
    await page.pdf({
      path: GUIA.pdf,
      format: 'A4', printBackground: true,
      margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;text-align:center;font-family:'Segoe UI',Arial,sans-serif;font-size:7.5pt;color:#94a3b8;">${GUIA.titulo} · versión 1.0 · página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`,
      outline: true,   // marcadores con los títulos (h2/h3)
      tagged: true,
    });
    console.log('ok public/guias/guia-productos-terminados.pdf');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
