// Genera el PDF de los Términos y Condiciones que se descarga desde /terminos (29/10/2026).
// Imprime /terminos?pdf=1 (solo el documento, a ancho A4) con el puppeteer del backend y lo deja en
// public/legal/, de donde el build lo copia a backend/public/legal/.
//
// Uso, con el front corriendo (npm run dev):
//   node scripts/generar-terminos-pdf.mjs                       → contra http://localhost:5173
//   node scripts/generar-terminos-pdf.mjs http://localhost:5174 → otra dirección
// Hay que correrlo cada vez que cambia src/components/pages/terminos/contenido.js.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(raiz, 'backend', 'package.json'));
const puppeteer = require('puppeteer');
const { VERSION, VIGENCIA, PDF_URL } = await import(pathToFileURL(path.join(raiz, 'src', 'components', 'pages', 'terminos', 'contenido.js')).href);

const base = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const salida = path.join(raiz, 'public', ...PDF_URL.replace(/^\//, '').split('/'));
fs.mkdirSync(path.dirname(salida), { recursive: true });

// Pie de cada página: la barra CMYK, el documento con su versión y «Página n de N»
const pie = `
<div style="width:100%; font-family:'Roboto Mono', Consolas, monospace; font-size:7.5px; color:#71717a;">
  <div style="display:flex; height:3px; margin:0 0 5px;">
    <span style="flex:1; background:#00ABFF"></span><span style="flex:1; background:#FF009D"></span>
    <span style="flex:1; background:#FFFF00"></span><span style="flex:1; background:#000"></span>
  </div>
  <div style="display:flex; justify-content:space-between; padding:0 40px;">
    <span><b style="color:#18181b">TÉRMINOS Y CONDICIONES</b> / Versión ${VERSION} / Vigente desde el ${VIGENCIA} / user.com.uy/terminos</span>
    <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
  </div>
</div>`;

// A4 sin márgenes laterales: la hoja se arma a 210 mm de ancho (96 px por pulgada)
const MM = 96 / 25.4;
const MARGEN = { arriba: 12, abajo: 16 };
const ANCHO_PX = Math.round(210 * MM);
const ALTO_UTIL_PX = (297 - MARGEN.arriba - MARGEN.abajo) * MM;

const navegador = await puppeteer.launch({ headless: true });
try {
    const pagina = await navegador.newPage();
    // al mismo ancho que la hoja impresa, para que lo que se mide abajo sea lo que después se pagina
    await pagina.setViewport({ width: ANCHO_PX, height: 1123 });
    await pagina.goto(`${base}/terminos?pdf=1`, { waitUntil: 'networkidle0', timeout: 60000 });
    await pagina.waitForSelector('.terminos-pdf .guia-hoja', { timeout: 30000 });
    await pagina.evaluate(() => document.fonts.ready);
    // Medios de pantalla: el CSS de impresión del sistema (index.css) oculta todo lo de #root
    await pagina.emulateMediaType('screen');
    // Puntos y subpuntos que entran en una hoja no se cortan (.terminos-junto, ver TermsPage): si no entran en
    // lo que queda, pasan enteros a la siguiente. Los más largos que una hoja se cortan igual, por subpunto.
    const { juntos, largos } = await pagina.evaluate((alto) => {
        const largos = [];
        let juntos = 0;
        for (const el of document.querySelectorAll('.terminos-punto, .terminos-grupo')) {
            if (el.getBoundingClientRect().height <= alto) { el.classList.add('terminos-junto'); juntos++; }
            else if (el.classList.contains('terminos-punto')) largos.push(el.querySelector('h2, h3')?.textContent.trim().slice(0, 50));
        }
        return { juntos, largos };
    }, ALTO_UTIL_PX - 10);
    console.log(`${juntos} puntos/subpuntos sin cortar` + (largos.length ? `; más largos que una hoja (se cortan por subpunto): ${largos.join(' · ')}` : ''));
    await pagina.pdf({
        path: salida,
        format: 'A4',
        printBackground: true,
        margin: { top: `${MARGEN.arriba}mm`, bottom: `${MARGEN.abajo}mm`, left: '0', right: '0' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: pie,
    });
    console.log(`PDF: ${path.relative(raiz, salida)} (${Math.round(fs.statSync(salida).size / 1024)} KB)`);
} finally {
    await navegador.close();
}
