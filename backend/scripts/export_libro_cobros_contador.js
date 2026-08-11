'use strict';
/**
 * export_libro_cobros_contador.js
 * ────────────────────────────────────────────────────────────────────────────
 * CLI del libro de COBROS de facturas crédito ACEPTADO_DGI.
 * La lógica vive en services/libroContadorService.js (compartida con el botón
 * de Reportes de Contabilidad → Libro Contador).
 *
 * Uso:
 *   node backend/scripts/export_libro_cobros_contador.js 2026-07 [carpeta_salida]
 */

const fs = require('fs');
const path = require('path');
const { generarLibroCobros } = require('../services/libroContadorService');

(async () => {
  const mes = process.argv[2];
  if (!/^\d{4}-\d{2}$/.test(mes || '')) {
    console.error('Uso: node export_libro_cobros_contador.js YYYY-MM [carpeta_salida]');
    process.exit(1);
  }
  const outDir = process.argv[3] || process.cwd();

  const { archivos, stats } = await generarLibroCobros({ mes });

  if (!archivos.length) {
    console.log(`No hay cobros de facturas crédito ACEPTADO_DGI en ${mes}.`);
    process.exit(0);
  }

  for (const a of archivos) {
    const file = path.join(outDir, a.filename);
    fs.writeFileSync(file, a.csv, 'latin1');
    console.log(`✔ ${file}  (${a.lineas} líneas)`);
  }

  console.log(`\nCobros incluidos: ${stats.movs} (solo facturas crédito CfeEstado=ACEPTADO_DGI, pagos no anulados)`);
  console.log('Por método de pago:', stats.porMetodo);
  console.log(`En USD: ${stats.usd} | Sin método identificable: ${stats.sinMetodo}`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
