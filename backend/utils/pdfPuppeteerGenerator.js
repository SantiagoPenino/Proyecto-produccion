const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Genera un PDF a partir de una cadena HTML y lo guarda en el disco.
 * Retorna la ruta física del PDF generado y los bytes del PDF.
 *
 * @param {string} htmlContent El HTML del estado de cuenta
 * @param {string} filename Nombre sugerido del archivo (sin extensión o con ella)
 * @returns {Promise<{ filePath: string, pdfBytes: Buffer }>}
 */
async function generarPDFDesdeHTML(htmlContent, filename) {
  let browser;
  try {
    // Iniciar Puppeteer (asegurarse de que funciona sin UI en el server)
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    
    // Inyectar el HTML en la página
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Definir directorio donde se guardarán los comprobantes
    const baseDir = process.env.COMPROBANTES_PATH || path.join(__dirname, '..', 'comprobantesPagos', 'estadosCuenta');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const cleanName = filename.replace(/[<>:"/\\|?*]/g, '_').trim();
    const finalName = cleanName.endsWith('.pdf') ? cleanName : `${cleanName}.pdf`;
    const filePath = path.join(baseDir, finalName);

    // Generar PDF
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        bottom: '20px',
        left: '20px',
        right: '20px'
      }
    });

    // Guardar físicamente
    fs.writeFileSync(filePath, pdfBytes);
    
    logger.info(`[PUPPETEER] PDF de Estado de Cuenta generado y guardado en: ${filePath}`);

    return { filePath, pdfBytes };
  } catch (error) {
    logger.error('[PUPPETEER] Error generando PDF desde HTML:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  generarPDFDesdeHTML
};
