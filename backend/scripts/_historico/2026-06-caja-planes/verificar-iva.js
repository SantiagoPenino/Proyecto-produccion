// Script de verificación de un solo uso: deduce la tasa de IVA por línea
// (DcdImpuestos / DcdSubtotal) y reporta cualquiera que no sea ~22%.
// Uso:  node backend/scripts/verificar-iva.js
const { sql, getPool } = require('../config/db');

(async () => {
  try {
    const pool = await getPool();

    // 1) Distribución global de tasas de IVA (toda la tabla de detalle)
    const global = await pool.request().query(`
      SELECT
        ROUND( (CAST(DcdImpuestos AS float) / NULLIF(DcdSubtotal, 0)) * 100, 1) AS TasaIvaPct,
        COUNT(*) AS Lineas
      FROM dbo.DocumentosContablesDetalle
      WHERE DcdSubtotal IS NOT NULL AND DcdSubtotal <> 0
      GROUP BY ROUND( (CAST(DcdImpuestos AS float) / NULLIF(DcdSubtotal, 0)) * 100, 1)
      ORDER BY Lineas DESC;
    `);

    console.log('\n=== Distribución de tasas de IVA en TODA la tabla detalle ===');
    console.table(global.recordset);

    // 2) Líneas que NO son 22% (con margen de redondeo)
    const noSon22 = await pool.request().query(`
      SELECT
        dcd.DocIdDocumento,
        dcd.DcdIdDetalle,
        dcd.DcdNomItem,
        dcd.DcdSubtotal,
        dcd.DcdImpuestos,
        dcd.DcdTotal,
        ROUND( (CAST(dcd.DcdImpuestos AS float) / NULLIF(dcd.DcdSubtotal, 0)) * 100, 2) AS TasaIvaPct
      FROM dbo.DocumentosContablesDetalle dcd
      WHERE dcd.DcdSubtotal IS NOT NULL AND dcd.DcdSubtotal <> 0
        AND ABS( (CAST(dcd.DcdImpuestos AS float) / NULLIF(dcd.DcdSubtotal, 0)) - 0.22 ) > 0.01
      ORDER BY dcd.DocIdDocumento, dcd.DcdIdDetalle;
    `);

    console.log(`\n=== Líneas que NO son 22% (toda la tabla): ${noSon22.recordset.length} ===`);
    if (noSon22.recordset.length) console.table(noSon22.recordset.slice(0, 50));

    // 3) Lo mismo pero SOLO en las facturas descuadradas (las que el fix tocaría)
    const enDescuadradas = await pool.request().query(`
      WITH FacturasMalas AS (
        SELECT dc.DocIdDocumento
        FROM dbo.DocumentosContables dc
        JOIN dbo.DocumentosContablesDetalle dcd ON dc.DocIdDocumento = dcd.DocIdDocumento
        GROUP BY dc.DocIdDocumento, dc.DocTotal
        HAVING ABS(dc.DocTotal - SUM(dcd.DcdTotal)) > 0.1 AND SUM(dcd.DcdTotal) > 0
      )
      SELECT
        dcd.DocIdDocumento,
        dcd.DcdIdDetalle,
        dcd.DcdSubtotal,
        dcd.DcdImpuestos,
        ROUND( (CAST(dcd.DcdImpuestos AS float) / NULLIF(dcd.DcdSubtotal, 0)) * 100, 2) AS TasaIvaPct
      FROM dbo.DocumentosContablesDetalle dcd
      JOIN FacturasMalas fm ON dcd.DocIdDocumento = fm.DocIdDocumento
      WHERE dcd.DcdSubtotal IS NOT NULL AND dcd.DcdSubtotal <> 0
        AND ABS( (CAST(dcd.DcdImpuestos AS float) / NULLIF(dcd.DcdSubtotal, 0)) - 0.22 ) > 0.01
      ORDER BY dcd.DocIdDocumento, dcd.DcdIdDetalle;
    `);

    console.log(`\n=== Líneas NO-22% dentro de facturas DESCUADRADAS: ${enDescuadradas.recordset.length} ===`);
    if (enDescuadradas.recordset.length) console.table(enDescuadradas.recordset);

    // 4) Líneas con subtotal 0 (no se puede deducir la tasa)
    const sinSubtotal = await pool.request().query(`
      SELECT COUNT(*) AS LineasConSubtotalCero
      FROM dbo.DocumentosContablesDetalle
      WHERE DcdSubtotal IS NULL OR DcdSubtotal = 0;
    `);
    console.log(`\nLíneas con DcdSubtotal NULL/0 (tasa no deducible): ${sinSubtotal.recordset[0].LineasConSubtotalCero}`);

    await pool.close();
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
})();
