const { getPool, sql } = require('../config/db');
getPool().then(async p => {
  // Ver entregas duplicadas de hoy (causadas por el bug del preview)
  const r = await p.request().query(`
    SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovConcepto, m.MovImporte, m.MovFecha, cc.CueTipo
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.MovTipo = 'ENTREGA'
      AND CAST(m.MovFecha AS DATE) = CAST(GETDATE() AS DATE)
    ORDER BY m.MovIdMovimiento DESC
  `);
  console.log('ENTREGAs de hoy:', JSON.stringify(r.recordset, null, 2));

  // Ver MovObservaciones de las ordenes cubiertas
  const r2 = await p.request().query(`
    SELECT MovIdMovimiento, MovConcepto, MovObservaciones
    FROM dbo.MovimientosCuenta
    WHERE MovObservaciones LIKE 'CUBIERTO%' AND MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  `);
  console.log('Ordenes cubiertas:', JSON.stringify(r2.recordset, null, 2));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
