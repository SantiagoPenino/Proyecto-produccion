'use strict';
/**
 * libroContadorService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Genera los libros CSV para el contador (formato de importación):
 *   Dia,Debe,Haber,Concepto,RUC,Moneda,Total,CodigoIVA,IVA,Cotizacion,Libro
 *
 * - generarLibroVentas({ mes, fechaBase }): un asiento por CFE ACEPTADO_DGI
 *     (debe deudores total / haber ventas neto / haber IVA; NC invertidas).
 *     fechaBase: 'contable' usa DocFechaEmision; 'dgi' usa CfeFechaDgi (la
 *     fecha real con la que el CFE quedó emitido ante DGI).
 * - generarLibroCobros({ mes }): movimientos PAGO no anulados aplicados a
 *     facturas crédito ACEPTADO_DGI (debe caja/banco/cheques según método,
 *     haber deudores). La fecha es siempre la del cobro (MovFecha).
 *
 * SOLO LECTURA. Lo usan los scripts CLI export_libro_*_contador.js y los
 * endpoints /api/contabilidad/reportes/libro-contador-*.
 */

const { getPool } = require('../config/db');

// ── Cuentas del plan del CONTADOR (confirmar con él) ────────────────────────
const CTA_DEUDORES = '1121001'; // deudores por ventas
const CTA_VENTAS   = '5130';    // ventas
const CTA_IVA      = '21332';   // IVA ventas

// Debe de los cobros según método de pago (MetodosPagos). ⚠ A CONFIRMAR.
const CTA_CAJA    = '1111001'; // efectivo / tarjetas / cobros en el local
const CTA_BANCO   = '1112001'; // transferencias / Handy / MercadoPago online / Take
const CTA_CHEQUES = '1113001'; // cheques recibidos
const CUENTA_POR_METODO = {
  1: CTA_CAJA, 3: CTA_CAJA, 4: CTA_CAJA, 5: CTA_CAJA, 8: CTA_CAJA,
  2: CTA_BANCO, 6: CTA_BANCO, 9: CTA_BANCO, 10: CTA_BANCO,
  11: CTA_CHEQUES,
};
const CTA_DEFAULT = CTA_CAJA;

const MONEDA_UYU = '0';
const MONEDA_USD = '1'; // ⚠ confirmar código de moneda del sistema del contador
const LIBRO_VENTAS = 'V';
const LIBRO_COBROS = 'D'; // ⚠ confirmar: los cobros no van al libro de IVA

const HEADER = 'Dia,Debe,Haber,Concepto,RUC,Moneda,Total,CodigoIVA,IVA,Cotizacion,Libro';

const num = (v) => {
  const n = Math.round(Number(v || 0) * 100) / 100;
  return String(n).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

// "Nro. de CAE 90262053670 Serie A 27677 / 29250" → { serie: 'A', numero: '27677' }
const parseOficial = (texto, fallbackSerie, fallbackNumero) => {
  const m = String(texto || '').match(/Serie\s+([A-Za-z]+)\s+(\d+)/i);
  if (m) return { serie: m[1].toUpperCase(), numero: m[2] };
  return { serie: fallbackSerie || '', numero: fallbackNumero || '' };
};

const conceptoTipo = (docTipo, cfeTipoCFE) => {
  const t = String(docTipo || '').toUpperCase();
  const esNC = cfeTipoCFE === 102 || cfeTipoCFE === 112 || t.includes('NOTA');
  const esFactura = cfeTipoCFE === 111 || cfeTipoCFE === 112 || t.includes('FACTURA');
  if (esNC) return esFactura ? 'NCREDFACT' : 'NCREDTICK';
  const esCredito = t.includes('CREDITO');
  if (esFactura) return esCredito ? 'FACTCRED' : 'FACTCONT';
  return esCredito ? 'ETICKCRED' : 'ETICKCONT';
};

const validarMes = (mes) => {
  if (!/^\d{4}-\d{2}$/.test(mes || '')) throw new Error('Mes inválido: se espera YYYY-MM');
  const [anio, mesNum] = mes.split('-').map(Number);
  return {
    desde: `${mes}-01`,
    hasta: new Date(Date.UTC(anio, mesNum, 1)).toISOString().slice(0, 10),
  };
};

/** Libro de VENTAS: documentos ACEPTADO_DGI del mes. */
exports.generarLibroVentas = async ({ mes, fechaBase = 'contable' }) => {
  const { desde, hasta } = validarMes(mes);
  if (!['contable', 'dgi'].includes(fechaBase)) throw new Error("fechaBase inválida: 'contable' o 'dgi'");

  // Con base DGI, los docs sin CfeFechaDgi (no debería haber tras el backfill)
  // caen a la fecha contable para no desaparecer del libro.
  const exprFecha = fechaBase === 'dgi'
    ? 'ISNULL(d.CfeFechaDgi, CAST(d.DocFechaEmision AS DATE))'
    : 'CAST(d.DocFechaEmision AS DATE)';

  const pool = await getPool();
  const docs = (await pool.request()
    .input('Desde', desde)
    .input('Hasta', hasta)
    .query(`
      SELECT d.DocIdDocumento,
             LTRIM(RTRIM(d.DocTipo))            AS DocTipo,
             d.CfeTipoCFE,
             d.DocSerie, d.DocNumero, d.CfeNumeroOficial,
             DAY(${exprFecha})                  AS Dia,
             d.DocTotal, d.DocImpuestos, d.MonIdMoneda,
             d.DocCliDocumento, d.EmpIdEmpresa,
             cot.CotDolar
      FROM dbo.DocumentosContables d WITH(NOLOCK)
      OUTER APPLY (
        SELECT TOP 1 c.CotDolar
        FROM dbo.Cotizaciones c WITH(NOLOCK)
        WHERE c.CotFecha <= ${exprFecha}
        ORDER BY c.CotFecha DESC
      ) cot
      WHERE d.CfeEstado = 'ACEPTADO_DGI'
        AND ${exprFecha} >= @Desde
        AND ${exprFecha} <  @Hasta
      ORDER BY ${exprFecha} ASC, d.DocIdDocumento ASC
    `)).recordset;

  const porEmpresa = new Map();
  const stats = { total: 0, usd: 0, sinIva: 0, sinRuc: 0, sinOficial: 0, porTipo: {}, fechaBase };

  for (const d of docs) {
    const esNC = d.CfeTipoCFE === 102 || d.CfeTipoCFE === 112 ||
                 String(d.DocTipo).toUpperCase().includes('NOTA');
    const { serie, numero } = parseOficial(d.CfeNumeroOficial, d.DocSerie, d.DocNumero);
    if (!/Serie/i.test(String(d.CfeNumeroOficial || ''))) stats.sinOficial++;

    const etiqueta = conceptoTipo(d.DocTipo, d.CfeTipoCFE);
    const concepto = `${etiqueta} ${serie} ${numero}`.trim();
    const ruc = String(d.DocCliDocumento || '').replace(/\D/g, '');
    if (!ruc) stats.sinRuc++;

    const esUSD = d.MonIdMoneda === 2;
    const moneda = esUSD ? MONEDA_USD : MONEDA_UYU;
    const cotizacion = esUSD ? num(d.CotDolar || 0) : '0';
    if (esUSD) stats.usd++;

    const total = Math.round(Number(d.DocTotal || 0) * 100) / 100;
    const iva = Math.round(Number(d.DocImpuestos || 0) * 100) / 100;
    const neto = Math.round((total - iva) * 100) / 100;
    if (!iva) stats.sinIva++;

    stats.total++;
    stats.porTipo[etiqueta] = (stats.porTipo[etiqueta] || 0) + 1;

    const lineas = [];
    lineas.push(esNC ? [CTA_VENTAS, '', neto] : ['', CTA_VENTAS, neto]);
    if (iva) lineas.push(esNC ? [CTA_IVA, '', iva] : ['', CTA_IVA, iva]);
    lineas.push(esNC ? ['', CTA_DEUDORES, total] : [CTA_DEUDORES, '', total]);

    const filas = lineas.map(([debe, haber, importe]) =>
      [d.Dia, debe, haber, concepto, ruc, moneda, num(importe), '0', '0', cotizacion, LIBRO_VENTAS].join(','));

    const emp = d.EmpIdEmpresa || 1;
    if (!porEmpresa.has(emp)) porEmpresa.set(emp, []);
    porEmpresa.get(emp).push(...filas);
  }

  const archivos = [...porEmpresa].map(([empresa, filas]) => ({
    empresa,
    filename: `libro_ventas_${mes}${porEmpresa.size > 1 ? `_empresa${empresa}` : ''}.csv`,
    csv: [HEADER, ...filas].join('\r\n') + '\r\n',
    lineas: filas.length,
  }));

  return { archivos, stats };
};

/** Libro de COBROS: pagos del mes aplicados a facturas crédito ACEPTADO_DGI. */
exports.generarLibroCobros = async ({ mes }) => {
  const { desde, hasta } = validarMes(mes);
  const pool = await getPool();

  const movs = (await pool.request()
    .input('Desde', desde)
    .input('Hasta', hasta)
    .query(`
      SELECT m.MovIdMovimiento,
             DAY(m.MovFecha)                    AS Dia,
             m.MovImporte,
             p.MPaIdMetodoPago,
             mp.MPaDescripcionMetodo,
             LTRIM(RTRIM(d.DocTipo))            AS DocTipo,
             d.CfeTipoCFE, d.DocSerie, d.DocNumero, d.CfeNumeroOficial,
             d.DocCliDocumento, d.MonIdMoneda, d.EmpIdEmpresa,
             cot.CotDolar
      FROM dbo.MovimientosCuenta m WITH(NOLOCK)
      JOIN dbo.DocumentosContables d WITH(NOLOCK) ON d.DocIdDocumento = m.DocIdDocumento
      LEFT JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagIdPago = m.PagIdPago
      LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
      OUTER APPLY (
        SELECT TOP 1 c.CotDolar
        FROM dbo.Cotizaciones c WITH(NOLOCK)
        WHERE c.CotFecha <= CAST(m.MovFecha AS DATE)
        ORDER BY c.CotFecha DESC
      ) cot
      WHERE m.MovTipo = 'PAGO'
        AND m.MovAnulado = 0
        AND d.CfeEstado = 'ACEPTADO_DGI'
        AND UPPER(d.DocTipo) LIKE '%CREDITO%'
        AND m.MovFecha >= @Desde
        AND m.MovFecha <  @Hasta
      ORDER BY m.MovFecha ASC, m.MovIdMovimiento ASC
    `)).recordset;

  const porEmpresa = new Map();
  const stats = { movs: 0, usd: 0, sinMetodo: 0, porMetodo: {} };

  for (const m of movs) {
    const { serie, numero } = parseOficial(m.CfeNumeroOficial, m.DocSerie, m.DocNumero);
    const esFactura = m.CfeTipoCFE === 111 || String(m.DocTipo || '').toUpperCase().includes('FACTURA');
    const concepto = `COBRO ${esFactura ? 'FACTCRED' : 'ETICKCRED'} ${serie} ${numero}`.trim();
    const ruc = String(m.DocCliDocumento || '').replace(/\D/g, '');

    const esUSD = m.MonIdMoneda === 2;
    const moneda = esUSD ? MONEDA_USD : MONEDA_UYU;
    const cotizacion = esUSD ? num(m.CotDolar || 0) : '0';
    if (esUSD) stats.usd++;

    const ctaDebe = CUENTA_POR_METODO[m.MPaIdMetodoPago] || CTA_DEFAULT;
    const metodo = m.MPaDescripcionMetodo || 'SIN MÉTODO';
    if (!m.MPaIdMetodoPago) stats.sinMetodo++;
    stats.porMetodo[metodo] = (stats.porMetodo[metodo] || 0) + 1;
    stats.movs++;

    const importe = num(m.MovImporte);
    const filas = [
      [m.Dia, ctaDebe, '', concepto, ruc, moneda, importe, '0', '0', cotizacion, LIBRO_COBROS].join(','),
      [m.Dia, '', CTA_DEUDORES, concepto, ruc, moneda, importe, '0', '0', cotizacion, LIBRO_COBROS].join(','),
    ];

    const emp = m.EmpIdEmpresa || 1;
    if (!porEmpresa.has(emp)) porEmpresa.set(emp, []);
    porEmpresa.get(emp).push(...filas);
  }

  const archivos = [...porEmpresa].map(([empresa, filas]) => ({
    empresa,
    filename: `libro_cobros_${mes}${porEmpresa.size > 1 ? `_empresa${empresa}` : ''}.csv`,
    csv: [HEADER, ...filas].join('\r\n') + '\r\n',
    lineas: filas.length,
  }));

  return { archivos, stats };
};
