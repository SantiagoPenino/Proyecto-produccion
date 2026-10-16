// Arma en PDF las guías de ayuda de Solicitudes (las abre el botón "?" de las pantallas) desde public/guias/*.html,
// con Chrome (puppeteer): índice clickeable, marcadores (panel del visor) y número de página. Los deja en public/guias/.
// Uso (desde la raíz del proyecto):  node backend/scripts/generar_guias_solicitudes.js
// Para cambiar el texto: editar el .html de public/guias/ y volver a correr esto.
const path = require('path');
const puppeteer = require('puppeteer');

const RAIZ = path.resolve(__dirname, '..', '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const GUIAS = [
  { html: 'guia-vendedores.html', pdf: 'guia-solicitudes-vendedores.pdf', titulo: 'Guía para vendedores · Solicitudes' },
  { html: 'guia-disenadores.html', pdf: 'guia-solicitudes-disenadores.pdf', titulo: 'Guía para diseñadores · Bandeja de Diseño' },
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    for (const g of GUIAS) {
      const page = await browser.newPage();
      await page.goto(`file:///${path.join(RAIZ, 'public', 'guias', g.html).replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: path.join(RAIZ, 'public', 'guias', g.pdf),
        format: 'A4', printBackground: true,
        margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;text-align:center;font-family:'Segoe UI',Arial,sans-serif;font-size:7.5pt;color:#94a3b8;">${g.titulo} · versión 1.0 · página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`,
        outline: true,   // marcadores con los títulos (h2/h3)
        tagged: true,
      });
      await page.close();
      console.log(`ok public/guias/${g.pdf}`);
    }
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
