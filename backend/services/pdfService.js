/**
 * pdfService.js
 * Servicio centralizado para generación y guardado de PDFs en el servidor.
 * Usa pdf-lib (ya instalado en el proyecto).
 * Todos los documentos se guardan en: comprobantesPagos/ (o COMPROBANTES_PATH env var)
 * Organizado por subcarpetas: egresos/, ingresos/, recibos/, facturas/
 */

const { PDFDocument, StandardFonts, rgb, PageSizes } = require('pdf-lib');
const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// ─── Directorio base ──────────────────────────────────────────────────────────
const getBaseDir = (subcarpeta = '') => {
  const base = process.env.COMPROBANTES_PATH || path.join(__dirname, '..', 'comprobantesPagos');
  const dir = subcarpeta ? path.join(base, subcarpeta) : base;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// ─── Helpers de formato ───────────────────────────────────────────────────────
const fmtNum = (n) =>
  new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleString('es-UY', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(d || ''); }
};

// ─── Función de guardado de bytes ─────────────────────────────────────────────
const guardarPDF = (pdfBytes, nombreArchivo, subcarpeta = '') => {
  const dir      = getBaseDir(subcarpeta);
  const clean    = nombreArchivo.replace(/[<>:"/\\|?*]/g, '_').trim();
  const filePath = path.join(dir, `${clean}.pdf`);
  fs.writeFileSync(filePath, Buffer.from(pdfBytes));
  logger.info(`[PDF-SERVICE] Guardado: ${filePath}`);
  return filePath;
};

// ─── Cabecera común (emisor idéntico a la factura electrónica) ──────────────────
/**
 * Dibuja el bloque emisor sobre fondo blanco, replicando la cabecera de la factura
 * (src/utils/pdfGenerator.js). Si la empresa tiene logo PNG local lo embebe; si no,
 * dibuja el wordmark "user" + los 4 cuadritos CMYK. Debajo: nombre fantasía, razón
 * social, dirección/ciudad y RUC. A la derecha, título + número del comprobante.
 *
 * pdf-lib usa origen abajo-izquierda (y crece hacia arriba); posicionamos desde `height`.
 */
const dibujarCabecera = async (page, { doc, fantasia, razon, dir, ciudad, ruc, logoUrl, titulo, numero, fontBold, font, width, height }) => {
  // Fallbacks (mismos valores históricos que la factura)
  const eFantasia = fantasia || 'Centro de Impresión Digital';
  const eRazon    = razon    || 'LALINDE MORALES HECTOR ARTIGAS, LALINDE FALERO FELIPE Y OTROS';
  const eDir      = dir      || 'VILARDEBO 2031';
  const eCiudad   = ciudad   || 'MONTEVIDEO';
  const eRuc      = ruc      || '218973270018';

  // ── Logo / wordmark (arriba-izquierda) ──────────────────────────────────────
  const logoTop = height - 20;   // borde superior del logo
  const logoH   = 40;            // alto del logo/wordmark
  let logoDibujado = false;

  if (logoUrl && typeof logoUrl === 'string' && logoUrl.trim() && doc) {
    try {
      const rel      = logoUrl.replace(/^[/\\]+/, '');           // quitar '/' inicial
      const logoPath = path.join(__dirname, '..', 'public', rel);
      if (fs.existsSync(logoPath) && /\.png$/i.test(logoPath)) {
        const bytes = fs.readFileSync(logoPath);
        const img   = await doc.embedPng(bytes);
        const ratio = img.width && img.height ? img.width / img.height : 2.5;
        const drawW = Math.min(150, logoH * ratio);
        page.drawImage(img, { x: 30, y: logoTop - logoH, width: drawW, height: logoH });
        logoDibujado = true;
      }
    } catch (e) {
      logger.warn(`[PDF-SERVICE] No se pudo embeber logo (${logoUrl}): ${e.message}`);
    }
  }

  if (!logoDibujado) {
    // Wordmark "user" + cuadritos CMYK (rgb de pdf-lib es 0..1)
    page.drawText('user', { x: 30, y: height - 44, size: 26, font: fontBold, color: rgb(0, 0, 0) });
    const sqY = height - 56, sqW = 12, sqH = 4, gap = 14;
    page.drawRectangle({ x: 30,           y: sqY, width: sqW, height: sqH, color: rgb(0, 0.682, 0.937) }); // Cyan
    page.drawRectangle({ x: 30 + gap,     y: sqY, width: sqW, height: sqH, color: rgb(0.925, 0, 0.549) }); // Magenta
    page.drawRectangle({ x: 30 + gap * 2, y: sqY, width: sqW, height: sqH, color: rgb(1, 0.949, 0) });     // Yellow
    page.drawRectangle({ x: 30 + gap * 3, y: sqY, width: sqW, height: sqH, color: rgb(0, 0, 0) });         // Black
  }

  // ── Datos del emisor (debajo del logo) ──────────────────────────────────────
  const dark = rgb(0.1, 0.1, 0.1);
  let ty = height - 72;
  page.drawText(eFantasia.substring(0, 45), { x: 30, y: ty, size: 13, font: fontBold, color: dark });

  ty -= 13;
  const razon1 = eRazon.substring(0, 58);
  const razon2 = eRazon.length > 58 ? eRazon.substring(58, 116) : '';
  page.drawText(razon1, { x: 30, y: ty, size: 8, font, color: dark });
  if (razon2) { ty -= 10; page.drawText(razon2, { x: 30, y: ty, size: 8, font, color: dark }); }

  ty -= 12;
  const addr = `${eDir}${eCiudad ? ', ' + eCiudad : ''}`.substring(0, 60);
  page.drawText(addr, { x: 30, y: ty, size: 9, font, color: dark });

  ty -= 12;
  page.drawText(`RUC: ${eRuc}`, { x: 30, y: ty, size: 9, font, color: dark });

  // ── Título + número (derecha, texto oscuro sobre blanco) ─────────────────────
  const tituloClean = (titulo || 'COMPROBANTE').substring(0, 30);
  page.drawText(tituloClean, {
    x: width - 30 - tituloClean.length * 5.5, y: height - 32,
    size: 11, font: fontBold, color: rgb(0.15, 0.2, 0.35),
  });
  const numClean = (numero || '').substring(0, 20);
  page.drawText(numClean, {
    x: width - 30 - numClean.length * 9.5, y: height - 54,
    size: 16, font: fontBold, color: rgb(0.7, 0.1, 0.1),
  });

  // Línea separadora bajo la cabecera
  page.drawLine({
    start: { x: 20, y: height - 118 }, end: { x: width - 20, y: height - 118 },
    thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
  });
};

// ─── Fila de datos ────────────────────────────────────────────────────────────
const dibujarFila = (page, { y, label, value, font, fontBold, width, highlight = false }) => {
  if (highlight) {
    page.drawRectangle({ x: 25, y: y - 4, width: width - 50, height: 18, color: rgb(0.97, 0.97, 0.97) });
  }
  page.drawText(`${label}:`, { x: 30, y, size: 8.5, font, color: rgb(0.4, 0.4, 0.4) });
  const val = (value || '—').substring(0, 60);
  page.drawText(val, { x: width / 2 - 20, y, size: 9, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
};

// ═══════════════════════════════════════════════════════════════════════════════
// EGRESO DE CAJA
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Genera y guarda el PDF de un egreso de caja.
 * @param {Object} voucher - datos del egreso (resultado de getVoucherEgreso)
 * @returns {string} ruta absoluta del archivo guardado
 */
const generarPdfEgreso = async (voucher) => {
  const doc      = await PDFDocument.create();
  const page     = doc.addPage([595.28, 420.94]); // A5 landscape
  const { width, height } = page.getSize();
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const numero = `EG-${String(voucher.VoucherNumero || voucher.EgrIdEgreso || '000').padStart(6, '0')}`;

  // Cabecera (emisor idéntico a la factura)
  await dibujarCabecera(page, {
    doc,
    fantasia: voucher.EmpresaFantasia,
    razon:    voucher.EmpresaRazon,
    dir:      voucher.EmpresaDir,
    ciudad:   voucher.EmpresaCiudad,
    ruc:      voucher.EmpresaRuc,
    logoUrl:  voucher.EmpresaLogo,
    titulo:   'EGRESO DE CAJA',
    numero,
    fontBold, font, width, height,
  });

  // Marco
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 110, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });

  // Filas de datos
  let y = height - 110;
  const filas = [
    ['Fecha',           fmtDate(voucher.EgrFecha)],
    ['Tipo de Egreso',  voucher.TipoEgresoLabel || voucher.EgrTipoEgreso || ''],
    ['Beneficiario',    voucher.EgrProveedor    || 'Sin especificar'],
    ['Concepto',        voucher.EgrConcepto     || ''],
    ['Método de Pago',  voucher.MetodoPago      || ''],
    ['Cuenta Contable', voucher.CuentaCodigo ? `[${voucher.CuentaCodigo}] ${voucher.CuentaNombre || ''}` : ''],
    ['Operario',        voucher.UsuarioNombre   || ''],
    ['N° Asiento',      String(voucher.AsiIdAsiento || '')],
  ];

  filas.forEach(([label, value], i) => {
    y -= 22;
    dibujarFila(page, { y, label, value, font, fontBold, width, highlight: i % 2 === 0 });
  });

  // Caja de monto
  const montoY = 65;
  page.drawRectangle({ x: width / 2 - 10, y: montoY - 10, width: width / 2 - 30, height: 55,
    color: rgb(0.99, 0.95, 0.95), borderColor: rgb(0.8, 0.2, 0.2), borderWidth: 1.5 });
  page.drawText('TOTAL EGRESO', {
    x: width / 2, y: montoY + 30, size: 8, font, color: rgb(0.5, 0.1, 0.1),
  });
  const montoStr = `${voucher.EgrMoneda === 'USD' ? 'US$ ' : '$ '}${fmtNum(voucher.EgrMonto)}`;
  page.drawText(montoStr, {
    x: width / 2 + 2, y: montoY + 10, size: 16, font: fontBold, color: rgb(0.7, 0.1, 0.1),
  });

  // Observaciones
  if (voucher.EgrObservaciones) {
    page.drawText(`Obs: ${voucher.EgrObservaciones.substring(0, 80)}`, {
      x: 30, y: montoY + 20, size: 8, font, color: rgb(0.4, 0.4, 0.4),
    });
  }

  // Firmas
  page.drawLine({ start: { x: 40, y: 50 }, end: { x: 160, y: 50 }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Entregado por', { x: 55, y: 38, size: 8, font, color: rgb(0.4, 0.4, 0.4) });

  page.drawLine({ start: { x: 220, y: 50 }, end: { x: 360, y: 50 }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
  page.drawText('Recibido por', { x: 255, y: 38, size: 8, font, color: rgb(0.4, 0.4, 0.4) });

  // Pie
  page.drawText(`Documento interno · Generado: ${new Date().toLocaleString('es-UY')}`, {
    x: 30, y: 25, size: 7, font, color: rgb(0.6, 0.6, 0.6),
  });

  const pdfBytes = await doc.save();
  return guardarPDF(pdfBytes, numero, 'egresos');
};

// ═══════════════════════════════════════════════════════════════════════════════
// INGRESO GENÉRICO
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Genera y guarda el PDF de un ingreso genérico.
 * @param {Object} datos - { tcaId, concepto, monto, moneda, metodoPago, fecha, serieDoc, numeroDoc,
 *   empresaFantasia, empresaRazon, empresaDir, empresaCiudad, empresaRuc, empresaLogo }
 *   (empresaNombre sigue aceptándose como alias de empresaFantasia por compatibilidad)
 */
const generarPdfIngreso = async (datos) => {
  const doc      = await PDFDocument.create();
  const page     = doc.addPage([595.28, 420.94]);
  const { width, height } = page.getSize();
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const numero = `${datos.serieDoc || 'A'}-${String(datos.numeroDoc || datos.tcaId || '000').padStart(6, '0')}`;

  await dibujarCabecera(page, {
    doc,
    fantasia: datos.empresaFantasia || datos.EmpresaFantasia || datos.empresaNombre,
    razon:    datos.empresaRazon    || datos.EmpresaRazon,
    dir:      datos.empresaDir      || datos.EmpresaDir,
    ciudad:   datos.empresaCiudad   || datos.EmpresaCiudad,
    ruc:      datos.empresaRuc      || datos.EmpresaRuc,
    logoUrl:  datos.empresaLogo     || datos.EmpresaLogo,
    titulo:   'INGRESO DE CAJA',
    numero,
    fontBold, font, width, height,
  });

  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 110, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });

  const filas = [
    ['Fecha',         fmtDate(datos.fecha || new Date())],
    ['Concepto',      datos.concepto    || ''],
    ['Método de Pago',datos.metodoPago  || ''],
    ['Moneda',        datos.moneda      || 'UYU'],
  ];

  let y = height - 110;
  filas.forEach(([label, value], i) => {
    y -= 22;
    dibujarFila(page, { y, label, value, font, fontBold, width, highlight: i % 2 === 0 });
  });

  // Monto
  const montoY = 80;
  page.drawRectangle({ x: width / 2 - 10, y: montoY - 10, width: width / 2 - 30, height: 55,
    color: rgb(0.95, 0.99, 0.96), borderColor: rgb(0.1, 0.55, 0.2), borderWidth: 1.5 });
  page.drawText('TOTAL INGRESO', { x: width / 2, y: montoY + 30, size: 8, font, color: rgb(0.1, 0.4, 0.1) });
  const montoStr = `${datos.moneda === 'USD' ? 'US$ ' : '$ '}${fmtNum(datos.monto)}`;
  page.drawText(montoStr, { x: width / 2 + 2, y: montoY + 10, size: 16, font: fontBold, color: rgb(0.1, 0.5, 0.2) });

  page.drawText(`Documento interno · ${new Date().toLocaleString('es-UY')}`, {
    x: 30, y: 25, size: 7, font, color: rgb(0.6, 0.6, 0.6),
  });

  const pdfBytes = await doc.save();
  return guardarPDF(pdfBytes, `IG-${String(datos.tcaId || Date.now()).padStart(6, '0')}`, 'ingresos');
};

// ═══════════════════════════════════════════════════════════════════════════════
// TICKET DE VENTA / COBRO (para cuando viene como base64 desde el frontend)
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Guarda un PDF recibido como base64 (generado por jsPDF en el frontend).
 * @param {string} nombreDocumento - nombre del archivo (sin extensión)
 * @param {string} pdfBase64 - PDF en base64
 * @param {string} subcarpeta - subcarpeta destino: 'facturas', 'recibos', etc.
 */
const guardarDesdeBase64 = (nombreDocumento, pdfBase64, subcarpeta = 'facturas') => {
  const buffer = Buffer.from(pdfBase64, 'base64');
  const dir    = getBaseDir(subcarpeta);
  const clean  = nombreDocumento.replace(/[<>:"/\\|?*]/g, '_').trim();
  const filePath = path.join(dir, `${clean}.pdf`);
  fs.writeFileSync(filePath, buffer);
  logger.info(`[PDF-SERVICE] Guardado (base64): ${filePath}`);
  return filePath;
};

// ═══════════════════════════════════════════════════════════════════════════════
// CIERRE DE CAJA (arqueo + listado de movimientos de la sesión)
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Genera y guarda el PDF del cierre de una sesión de caja.
 * Reproduce el "archivo de cierre": encabezado con el arqueo (montos inicial/final/
 * sistema/diferencia) + el listado completo de movimientos de la sesión.
 * @param {Object} params
 *   @param {Object}   params.sesion       fila de SesionesTurno
 *   @param {Array}    params.movimientos  [{ Fecha, Comprobante, Concepto, Usuario, Moneda, Entrada, Salida }]
 *   @param {Object}   [params.empresa]    datos de emisor opcionales
 * @returns {string} ruta absoluta del archivo guardado
 */
const generarPdfCierre = async ({ sesion, movimientos = [], empresa = {} }) => {
  const doc      = await PDFDocument.create();
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4 = [595.28, 841.89]; // portrait
  const [width, height] = A4;
  const marginX = 30;

  const dark  = rgb(0.1, 0.1, 0.1);
  const gray  = rgb(0.45, 0.45, 0.45);
  const green = rgb(0.1, 0.5, 0.2);
  const red   = rgb(0.7, 0.1, 0.1);

  // Columnas del listado (x de inicio; montos alineados a la derecha por endX)
  const COL = { fecha: 32, comp: 96, concepto: 178, usuario: 372, entradaEnd: 500, salidaEnd: 566 };

  const simb = (m) => (m === 'USD' ? 'US$ ' : '$ ');
  const drawRight = (page, text, endX, y, size, f, color) => {
    const w = f.widthOfTextAtSize(text, size);
    page.drawText(text, { x: endX - w, y, size, font: f, color });
  };
  const trunc = (s, n) => { s = String(s || ''); return s.length > n ? s.substring(0, n - 1) + '…' : s; };

  // ── Crear página con la cabecera de columnas ────────────────────────────────
  const nuevaPagina = (conEncabezadoTabla = true) => {
    const page = doc.addPage(A4);
    let y = height - 40;
    if (conEncabezadoTabla) {
      page.drawRectangle({ x: marginX, y: y - 4, width: width - marginX * 2, height: 16, color: rgb(0.93, 0.93, 0.95) });
      page.drawText('FECHA',       { x: COL.fecha,    y, size: 7.5, font: fontBold, color: gray });
      page.drawText('COMPROBANTE', { x: COL.comp,     y, size: 7.5, font: fontBold, color: gray });
      page.drawText('CONCEPTO',    { x: COL.concepto, y, size: 7.5, font: fontBold, color: gray });
      page.drawText('USUARIO',     { x: COL.usuario,  y, size: 7.5, font: fontBold, color: gray });
      drawRight(page, 'ENTRADA', COL.entradaEnd, y, 7.5, fontBold, gray);
      drawRight(page, 'SALIDA',  COL.salidaEnd,  y, 7.5, fontBold, gray);
      y -= 20;
    }
    return { page, y };
  };

  // ── Primera página: bloque de arqueo ────────────────────────────────────────
  let page = doc.addPage(A4);
  let y = height - 45;

  page.drawText('CIERRE DE CAJA', { x: marginX, y, size: 18, font: fontBold, color: dark });
  drawRight(page, `Sesión #${sesion.StuIdSesion}`, width - marginX, y, 13, fontBold, rgb(0.25, 0.3, 0.5));
  y -= 16;
  page.drawText(String(sesion.StuEstado || ''), { x: marginX, y, size: 9, font, color: gray });
  y -= 6;
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 0.7, color: rgb(0.8, 0.8, 0.8) });
  y -= 20;

  // Filas del arqueo en dos columnas
  const colL = marginX, colR = width / 2 + 10;
  const linea = (x, label, value, color = dark) => {
    page.drawText(`${label}:`, { x, y, size: 8.5, font, color: gray });
    page.drawText(String(value ?? '—'), { x: x + 110, y, size: 9, font: fontBold, color });
  };
  const dif = Number(sesion.StuDiferencia || 0);
  linea(colL, 'Apertura', fmtDate(sesion.StuFechaApertura));
  linea(colR, 'Cierre',   sesion.StuFechaCierre ? fmtDate(sesion.StuFechaCierre) : '—');
  y -= 15;
  linea(colL, 'Abrió', sesion.UsuarioAbre || '—');
  linea(colR, 'Cerró', sesion.UsuarioCierra || '—');
  y -= 15;
  linea(colL, 'Monto inicial', `$ ${fmtNum(sesion.StuMontoInicial)}`);
  linea(colR, 'Monto inicial USD', `US$ ${fmtNum(sesion.StuMontoInicialUSD)}`);
  y -= 15;
  linea(colL, 'Monto declarado', `$ ${fmtNum(sesion.StuMontoFinal)}`);
  linea(colR, 'Monto declarado USD', `US$ ${fmtNum(sesion.StuMontoFinalUSD)}`);
  y -= 15;
  linea(colL, 'Monto sistema', `$ ${fmtNum(sesion.StuMontoSistema)}`);
  linea(colR, 'Diferencia', `$ ${fmtNum(dif)}`, Math.abs(dif) < 0.01 ? green : red);
  y -= 22;

  // Encabezado de la tabla en la primera página
  page.drawText('MOVIMIENTOS DE LA SESIÓN', { x: marginX, y, size: 10, font: fontBold, color: dark });
  drawRight(page, `${movimientos.length} movimiento${movimientos.length !== 1 ? 's' : ''}`, width - marginX, y, 8, font, gray);
  y -= 16;
  page.drawRectangle({ x: marginX, y: y - 4, width: width - marginX * 2, height: 16, color: rgb(0.93, 0.93, 0.95) });
  page.drawText('FECHA',       { x: COL.fecha,    y, size: 7.5, font: fontBold, color: gray });
  page.drawText('COMPROBANTE', { x: COL.comp,     y, size: 7.5, font: fontBold, color: gray });
  page.drawText('CONCEPTO',    { x: COL.concepto, y, size: 7.5, font: fontBold, color: gray });
  page.drawText('USUARIO',     { x: COL.usuario,  y, size: 7.5, font: fontBold, color: gray });
  drawRight(page, 'ENTRADA', COL.entradaEnd, y, 7.5, fontBold, gray);
  drawRight(page, 'SALIDA',  COL.salidaEnd,  y, 7.5, fontBold, gray);
  y -= 16;

  // ── Filas de movimientos (con paginación) ───────────────────────────────────
  const rowH = 13, bottomLimit = 45;
  let totInUYU = 0, totOutUYU = 0, totInUSD = 0, totOutUSD = 0;

  for (let i = 0; i < movimientos.length; i++) {
    const m = movimientos[i];
    if (y < bottomLimit) { const np = nuevaPagina(true); page = np.page; y = np.y; }

    if (i % 2 === 0) {
      page.drawRectangle({ x: marginX, y: y - 3, width: width - marginX * 2, height: rowH, color: rgb(0.975, 0.975, 0.975) });
    }
    const inn = Number(m.Entrada || 0), out = Number(m.Salida || 0);
    if (m.Moneda === 'USD') { totInUSD += inn; totOutUSD += out; } else { totInUYU += inn; totOutUYU += out; }

    page.drawText(fmtDate(m.Fecha),          { x: COL.fecha,    y, size: 6.5, font, color: dark });
    page.drawText(trunc(m.Comprobante, 16),  { x: COL.comp,     y, size: 6.5, font, color: dark });
    page.drawText(trunc(m.Concepto, 44),     { x: COL.concepto, y, size: 6.5, font, color: dark });
    page.drawText(trunc(m.Usuario, 14),      { x: COL.usuario,  y, size: 6.5, font, color: dark });
    if (inn > 0) drawRight(page, `${simb(m.Moneda)}${fmtNum(inn)}`, COL.entradaEnd, y, 6.5, fontBold, green);
    if (out > 0) drawRight(page, `${simb(m.Moneda)}${fmtNum(out)}`, COL.salidaEnd,  y, 6.5, fontBold, red);
    y -= rowH;
  }

  // ── Totales del listado ─────────────────────────────────────────────────────
  if (y < bottomLimit + 40) { const np = nuevaPagina(false); page = np.page; y = np.y; }
  y -= 6;
  page.drawLine({ start: { x: marginX, y }, end: { x: width - marginX, y }, thickness: 0.7, color: rgb(0.8, 0.8, 0.8) });
  y -= 14;
  page.drawText('TOTALES', { x: marginX, y, size: 8.5, font: fontBold, color: dark });
  drawRight(page, `$ ${fmtNum(totInUYU)}`, COL.entradaEnd, y, 8, fontBold, green);
  drawRight(page, `$ ${fmtNum(totOutUYU)}`, COL.salidaEnd, y, 8, fontBold, red);
  y -= 12;
  if (totInUSD > 0 || totOutUSD > 0) {
    page.drawText('TOTALES USD', { x: marginX, y, size: 8.5, font: fontBold, color: dark });
    drawRight(page, `US$ ${fmtNum(totInUSD)}`, COL.entradaEnd, y, 8, fontBold, green);
    drawRight(page, `US$ ${fmtNum(totOutUSD)}`, COL.salidaEnd, y, 8, fontBold, red);
    y -= 12;
  }

  // Pie en todas las páginas
  const paginas = doc.getPages();
  paginas.forEach((p, idx) => {
    p.drawText(`Cierre de caja · Sesión #${sesion.StuIdSesion} · Generado: ${new Date().toLocaleString('es-UY')}`,
      { x: marginX, y: 25, size: 6.5, font, color: rgb(0.6, 0.6, 0.6) });
    p.drawText(`Página ${idx + 1} de ${paginas.length}`, { x: width - 90, y: 25, size: 6.5, font, color: rgb(0.6, 0.6, 0.6) });
  });

  const pdfBytes = await doc.save();
  return guardarPDF(pdfBytes, `CIERRE-${sesion.StuIdSesion}-${Date.now()}`, 'cierres');
};

module.exports = {
  generarPdfEgreso,
  generarPdfIngreso,
  generarPdfCierre,
  guardarDesdeBase64,
  guardarPDF,
  getBaseDir,
};
