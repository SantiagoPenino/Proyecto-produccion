// ─────────────────────────────────────────────────────────────────────────────
// Diagnóstico SOLO-LECTURA: coherencia moneda del documento vs moneda de líneas
// ─────────────────────────────────────────────────────────────────────────────
// Detecta el bug "pagar en UY cosas que están en USD" (y su inverso): el cabezal
// (DocumentosContables.DocTotal + MonIdMoneda) quedó en una moneda pero las líneas
// (DocumentosContablesDetalle.DcdTotal) quedaron guardadas en la otra.
//
// Firma del bug: el ratio DocTotal / SUM(DcdTotal) cae en la banda del tipo de
// cambio. Es la misma heurística que el fix del front en FacturacionManualModal.jsx
// (factorConversion, ratio 30–55), acá contrastada contra la base real.
//
// NO escribe nada. Uso:  node backend/scripts/diagnostico_coherencia_moneda_facturas.js
// ─────────────────────────────────────────────────────────────────────────────
const { sql, getPool } = require('../config/db');

// Cuántos días atrás se considera "reciente" (para ver si el bug sigue naciendo
// después del fix de conversión en el backend).
const DIAS_RECIENTE = 60;

(async () => {
  try {
    const pool = await getPool();

    // 1) Cotización vigente (misma fuente que aplicarCotizacion en contabilidadCore.js)
    const cotRes = await pool.request().query(
      "SELECT TOP 1 CotDolar, CotFecha FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC"
    );
    const cot = parseFloat(cotRes.recordset[0]?.CotDolar) || 40;
    // Banda ancha alrededor de la cotización para tolerar variación histórica del TC.
    const cotLow  = cot * 0.6;   // ~24 si cot=40
    const cotHigh = cot * 1.6;   // ~64 si cot=40
    console.log(`\nCotización vigente usada: US$ 1 = $ ${cot}  (CotFecha ${cotRes.recordset[0]?.CotFecha})`);
    console.log(`Banda de detección por ratio: [${cotLow.toFixed(2)} , ${cotHigh.toFixed(2)}]  (inverso [${(1/cotHigh).toFixed(4)} , ${(1/cotLow).toFixed(4)}])`);

    // 2) Documentos con líneas, clasificados por coherencia de moneda.
    //    Filtramos a los que tienen alguna incoherencia (descuadre > 1) para no traer
    //    los miles de documentos correctos.
    const res = await pool.request()
      .input('cotLow',  sql.Float, cotLow)
      .input('cotHigh', sql.Float, cotHigh)
      .query(`
        WITH Lineas AS (
          SELECT DocIdDocumento,
                 SUM(CAST(DcdTotal AS float)) AS SumaLineas,
                 COUNT(*) AS NLineas
          FROM dbo.DocumentosContablesDetalle
          GROUP BY DocIdDocumento
        ),
        Docs AS (
          SELECT
            dc.DocIdDocumento, dc.DocTipo, dc.DocSerie, dc.DocNumero,
            dc.DocFechaEmision, dc.DocEstado, dc.CfeEstado, dc.MonIdMoneda,
            CAST(dc.DocTotal AS DECIMAL(18,2))        AS DocTotal,
            CAST(l.SumaLineas AS DECIMAL(18,2))       AS SumaLineas,
            l.NLineas,
            CASE WHEN l.SumaLineas <> 0
                 THEN CAST(dc.DocTotal / l.SumaLineas AS DECIMAL(18,4)) END AS Ratio
          FROM dbo.DocumentosContables dc
          JOIN Lineas l ON l.DocIdDocumento = dc.DocIdDocumento
          WHERE l.SumaLineas > 0 AND dc.DocTotal > 0
        )
        SELECT *,
          CASE
            WHEN MonIdMoneda = 1 AND Ratio BETWEEN @cotLow AND @cotHigh
              THEN 'DOC_UYU_LINEAS_USD'
            WHEN MonIdMoneda = 2 AND Ratio BETWEEN (1.0/@cotHigh) AND (1.0/@cotLow)
              THEN 'DOC_USD_LINEAS_UYU'
            WHEN ABS(DocTotal - SumaLineas) > 1
              THEN 'DESCUADRE_OTRO'
            ELSE 'OK'
          END AS Clasificacion
        FROM Docs
        ORDER BY DocIdDocumento DESC;
      `);

    const rows = res.recordset;
    const byClass = {};
    for (const r of rows) {
      byClass[r.Clasificacion] = (byClass[r.Clasificacion] || 0) + 1;
    }

    console.log(`\n=== Resumen de ${rows.length} documentos con líneas ===`);
    console.table(
      Object.entries(byClass).map(([Clasificacion, Cantidad]) => ({ Clasificacion, Cantidad }))
    );

    const monedaMal = rows.filter(r =>
      r.Clasificacion === 'DOC_UYU_LINEAS_USD' || r.Clasificacion === 'DOC_USD_LINEAS_UYU');
    const descuadreOtro = rows.filter(r => r.Clasificacion === 'DESCUADRE_OTRO');

    const fmt = (r) => ({
      Doc: r.DocIdDocumento,
      Tipo: r.DocTipo,
      Comprobante: `${r.DocSerie || ''}${r.DocNumero || ''}`,
      Fecha: r.DocFechaEmision ? new Date(r.DocFechaEmision).toISOString().slice(0, 10) : '',
      Moneda: r.MonIdMoneda === 2 ? 'USD' : 'UYU',
      DocTotal: r.DocTotal,
      SumaLineas: r.SumaLineas,
      Ratio: r.Ratio,
      Estado: r.DocEstado,
      CFE: r.CfeEstado,
      Clasificacion: r.Clasificacion,
    });

    console.log(`\n=== INCOHERENCIA DE MONEDA (líneas en la otra moneda que el cabezal): ${monedaMal.length} ===`);
    if (monedaMal.length) console.table(monedaMal.slice(0, 60).map(fmt));

    console.log(`\n=== OTROS DESCUADRES (líneas ≠ total, pero ratio NO es tipo de cambio): ${descuadreOtro.length} ===`);
    if (descuadreOtro.length) console.table(descuadreOtro.slice(0, 40).map(fmt));

    // 3) ¿El bug sigue naciendo? Incoherencias de moneda en los últimos N días.
    const limite = new Date();
    limite.setDate(limite.getDate() - DIAS_RECIENTE);
    const recientesMal = monedaMal.filter(r =>
      r.DocFechaEmision && new Date(r.DocFechaEmision) >= limite);
    console.log(`\n=== ¿SIGUE PASANDO? Incoherencias de moneda en los últimos ${DIAS_RECIENTE} días: ${recientesMal.length} ===`);
    if (recientesMal.length) console.table(recientesMal.slice(0, 40).map(fmt));
    else console.log('  → Ninguna reciente: el fix de conversión estaría conteniendo el bug al generar los CFE.');

    // 4) Documentos SIN líneas (no se puede verificar coherencia; posible dato faltante)
    const sinLineas = await pool.request().query(`
      SELECT COUNT(*) AS DocsSinLineas
      FROM dbo.DocumentosContables dc
      WHERE dc.DocTotal > 0
        AND NOT EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d
                        WHERE d.DocIdDocumento = dc.DocIdDocumento);
    `);
    console.log(`\nDocumentos con DocTotal>0 y SIN líneas de detalle: ${sinLineas.recordset[0].DocsSinLineas}`);

    await pool.close();
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
})();
