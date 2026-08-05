'use strict';
/**
 * export_libro_ventas_contador.js
 * ────────────────────────────────────────────────────────────────────────────
 * Genera el libro de VENTAS para el contador (formato de importación):
 *   Dia,Debe,Haber,Concepto,RUC,Moneda,Total,CodigoIVA,IVA,Cotizacion,Libro
 *
 * SOLO incluye documentos con CfeEstado = 'ACEPTADO_DGI' (aceptados por DGI).
 * Cada documento genera el asiento clásico de ventas:
 *   - Debe  CTA_DEUDORES  por el total
 *   - Haber CTA_VENTAS    por el neto (total - IVA)
 *   - Haber CTA_IVA       por el IVA          (si el doc tiene IVA)
 * Las Notas de Crédito van con Debe/Haber invertidos.
 *
 * SOLO LECTURA sobre la base. Uso:
 *   node backend/scripts/export_libro_ventas_contador.js 2026-07 [carpeta_salida]
 */

const fs = require('fs');
const path = require('path');
const { getPool } = require('../config/db');

// ── Cuentas del plan del CONTADOR (confirmar con él) ────────────────────────
const CTA_DEUDORES = '1121001'; // Debe: total del documento
const CTA_VENTAS   = '5130';    // Haber: neto gravado
const CTA_IVA      = '21332';   // Haber: IVA ventas

// Código de moneda que usa el sistema del contador (0 = pesos).
const MONEDA_UYU = '0';
const MONEDA_USD = '1'; // ⚠ confirmar con el contador (puede ser 2 u otro código)

const num = (v) => {
  const n = Math.round(Number(v || 0) * 100) / 100;
  // sin separador de miles, punto decimal, sin ceros de más (5355.9, 29701)
  return String(n).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
};

// "Nro. de CAE 90262053670 Serie A 27677 / 29250" → { serie: 'A', numero: '27677' }
const parseOficial = (texto, fallbackSerie, fallbackNumero) => {
  const m = String(texto || '').match(/Serie\s+([A-Za-z]+)\s+(\d+)/i);
  if (m) return { serie: m[1].toUpperCase(), numero: m[2] };
  return { serie: fallbackSerie || '', numero: fallbackNumero || '' };
};

// Etiqueta del concepto según el tipo de CFE
const conceptoTipo = (docTipo, cfeTipoCFE) => {
  const t = String(docTipo || '').toUpperCase();
  const esNC = cfeTipoCFE === 102 || cfeTipoCFE === 112 || t.includes('NOTA');
  const esFactura = cfeTipoCFE === 111 || cfeTipoCFE === 112 || t.includes('FACTURA');
  if (esNC) return esFactura ? 'NCREDFACT' : 'NCREDTICK';
  const esCredito = t.includes('CREDITO');
  if (esFactura) return esCredito ? 'FACTCRED' : 'FACTCONT';
  return esCredito ? 'ETICKCRED' : 'ETICKCONT';
};

(async () => {
  const mes = process.argv[2]; // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(mes || '')) {
    console.error('Uso: node export_libro_ventas_contador.js YYYY-MM [carpeta_salida]');
    process.exit(1);
  }
  const outDir = process.argv[3] || process.cwd();

  const [anio, mesNum] = mes.split('-').map(Number);
  const desde = `${mes}-01`;
  const hasta = new Date(Date.UTC(anio, mesNum, 1)).toISOString().slice(0, 10); // 1º del mes siguiente

  const pool = await getPool();

  const docs = (await pool.request()
    .input('Desde', desde)
    .input('Hasta', hasta)
    .query(`
      SELECT d.DocIdDocumento,
             LTRIM(RTRIM(d.DocTipo))            AS DocTipo,
             d.CfeTipoCFE,
             d.DocSerie, d.DocNumero, d.CfeNumeroOficial,
             DAY(d.DocFechaEmision)             AS Dia,
             CAST(d.DocFechaEmision AS DATE)    AS Fecha,
             d.DocTotal, d.DocImpuestos, d.MonIdMoneda,
             d.DocCliDocumento, d.DocCliNombre, d.EmpIdEmpresa,
             cot.CotDolar
      FROM dbo.DocumentosContables d WITH(NOLOCK)
      OUTER APPLY (
        SELECT TOP 1 c.CotDolar
        FROM dbo.Cotizaciones c WITH(NOLOCK)
        WHERE c.CotFecha <= CAST(d.DocFechaEmision AS DATE)
        ORDER BY c.CotFecha DESC
      ) cot
      WHERE d.CfeEstado = 'ACEPTADO_DGI'
        AND d.DocFechaEmision >= @Desde
        AND d.DocFechaEmision <  @Hasta
      ORDER BY d.DocFechaEmision ASC, d.DocIdDocumento ASC
    `)).recordset;

  if (!docs.length) {
    console.log(`No hay documentos ACEPTADO_DGI en ${mes}.`);
    process.exit(0);
  }

  // Un archivo por empresa (si hay más de una)
  const porEmpresa = new Map();
  const stats = { total: 0, usd: 0, sinIva: 0, sinRuc: 0, sinOficial: 0, porTipo: {} };

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

    // (debe, haber, importe) — en la NC el asiento va al revés
    const lineas = [];
    lineas.push(esNC ? [CTA_VENTAS, '', neto] : ['', CTA_VENTAS, neto]);
    if (iva) lineas.push(esNC ? [CTA_IVA, '', iva] : ['', CTA_IVA, iva]);
    lineas.push(esNC ? ['', CTA_DEUDORES, total] : [CTA_DEUDORES, '', total]);

    const filas = lineas.map(([debe, haber, importe]) =>
      [d.Dia, debe, haber, concepto, ruc, moneda, num(importe), '0', '0', cotizacion, 'V'].join(','));

    const emp = d.EmpIdEmpresa || 1;
    if (!porEmpresa.has(emp)) porEmpresa.set(emp, []);
    porEmpresa.get(emp).push(...filas);
  }

  const header = 'Dia,Debe,Haber,Concepto,RUC,Moneda,Total,CodigoIVA,IVA,Cotizacion,Libro';
  const archivos = [];
  for (const [emp, filas] of porEmpresa) {
    const sufijo = porEmpresa.size > 1 ? `_empresa${emp}` : '';
    const file = path.join(outDir, `libro_ventas_${mes}${sufijo}.csv`);
    fs.writeFileSync(file, [header, ...filas].join('\r\n') + '\r\n', 'latin1');
    archivos.push(file);
    console.log(`✔ ${file}  (${filas.length} líneas)`);
  }

  console.log(`\nDocumentos incluidos: ${stats.total} (solo CfeEstado=ACEPTADO_DGI)`);
  console.log('Por tipo:', stats.porTipo);
  console.log(`En USD: ${stats.usd} | Sin IVA (exentos): ${stats.sinIva} | Sin RUC/CI: ${stats.sinRuc} | Sin nro oficial parseable: ${stats.sinOficial}`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
