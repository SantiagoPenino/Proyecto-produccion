'use strict';
/**
 * export_libro_ventas_contador.js
 * ────────────────────────────────────────────────────────────────────────────
 * CLI del libro de VENTAS para el contador (solo documentos ACEPTADO_DGI).
 * La lógica vive en services/libroContadorService.js (compartida con el botón
 * de Reportes de Contabilidad → Libro Contador).
 *
 * Uso:
 *   node backend/scripts/export_libro_ventas_contador.js 2026-07 [carpeta_salida] [--fecha=dgi]
 *
 *   --fecha=contable (default) → columna Dia según DocFechaEmision
 *   --fecha=dgi                → columna Dia según CfeFechaDgi (fecha real DGI)
 */

const fs = require('fs');
const path = require('path');
const { generarLibroVentas } = require('../services/libroContadorService');

(async () => {
  const args = process.argv.slice(2);
  const mes = args.find(a => /^\d{4}-\d{2}$/.test(a));
  if (!mes) {
    console.error('Uso: node export_libro_ventas_contador.js YYYY-MM [carpeta_salida] [--fecha=dgi]');
    process.exit(1);
  }
  const outDir = args.find(a => !a.startsWith('--') && a !== mes) || process.cwd();
  const fechaBase = (args.find(a => a.startsWith('--fecha=')) || '--fecha=contable').split('=')[1];

  const { archivos, stats } = await generarLibroVentas({ mes, fechaBase });

  if (!archivos.length) {
    console.log(`No hay documentos ACEPTADO_DGI en ${mes} (fecha ${fechaBase}).`);
    process.exit(0);
  }

  for (const a of archivos) {
    const file = path.join(outDir, a.filename);
    fs.writeFileSync(file, a.csv, 'latin1');
    console.log(`✔ ${file}  (${a.lineas} líneas)`);
  }

  console.log(`\nDocumentos incluidos: ${stats.total} (solo CfeEstado=ACEPTADO_DGI, fecha base: ${fechaBase})`);
  console.log('Por tipo:', stats.porTipo);
  console.log(`En USD: ${stats.usd} | Sin IVA (exentos): ${stats.sinIva} | Sin RUC/CI: ${stats.sinRuc} | Sin nro oficial parseable: ${stats.sinOficial}`);
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
