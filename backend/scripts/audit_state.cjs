const { getPool, sql } = require('../config/db');
getPool().then(async p => {
  // Ver ENTREGAs del dia actual de hoy + cuales ordenes tienen MovObservaciones CUBIERTO
  const r = await p.request().query(`
    SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovConcepto, m.MovImporte, m.MovFecha
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.MovTipo = 'ENTREGA' AND CAST(m.MovFecha AS DATE) = '2026-06-16'
    ORDER BY m.MovIdMovimiento
  `);
  console.log('ENTREGAs 16/6:', JSON.stringify(r.recordset, null, 2));

  const r2 = await p.request().query(`
    SELECT MovIdMovimiento, MovConcepto, MovObservaciones
    FROM dbo.MovimientosCuenta
    WHERE MovObservaciones LIKE 'CUBIERTO%'
  `);
  console.log('Ordenes cubiertas:', JSON.stringify(r2.recordset, null, 2));

  // Plan 1 estado actual
  const r3 = await p.request().query(`SELECT PlaIdPlan, PlaCantidadTotal, PlaCantidadUsada, PlaCantidadTotal-PlaCantidadUsada AS Saldo FROM dbo.PlanesMetros WHERE PlaIdPlan=1`);
  console.log('Plan 1:', JSON.stringify(r3.recordset, null, 2));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
