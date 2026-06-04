const { getPool } = require('./config/db');

(async () => {
    const pool = await getPool();

    // 1. Buscar la TransaccionCaja del pedido PC-1 / PC-00001 de Jorge Barranco (CliId=?)
    const tca = await pool.request().query(`
        SELECT TOP 5 
            t.TcaIdTransaccion, t.TcaFecha, t.TcaTipoDocumento, t.TcaSerieDoc, t.TcaNumeroDoc,
            t.TcaClienteId, t.TcaEstado, t.TcaTotalNeto
        FROM dbo.TransaccionesCaja t
        WHERE CAST(t.TcaFecha AS DATE) = '2026-06-03'
        ORDER BY t.TcaIdTransaccion DESC
    `);
    console.log('=== TransaccionesCaja hoy ===');
    console.log(JSON.stringify(tca.recordset, null, 2));

    for (const t of tca.recordset) {
        const id = t.TcaIdTransaccion;

        // 2. ¿Existe MovimientosCuenta para este TcaId?
        const mov = await pool.request().query(`
            SELECT mc.MovIdMovimiento, mc.CueIdCuenta, mc.MovTipo, mc.MovImporte, 
                   mc.MovSaldoPosterior, mc.DocIdDocumento, mc.MovFecha
            FROM dbo.MovimientosCuenta mc
            JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = mc.CueIdCuenta
            WHERE cc.CliIdCliente = ${t.TcaClienteId}
              AND CAST(mc.MovFecha AS DATE) = '2026-06-03'
            ORDER BY mc.MovIdMovimiento DESC
        `);
        console.log(`\n--- MovimientosCuenta CliId=${t.TcaClienteId} hoy ---`);
        console.log(JSON.stringify(mov.recordset, null, 2));

        // 3. ¿Existe DocumentosContables linkeado?
        const doc = await pool.request().query(`
            SELECT dc.DocIdDocumento, dc.DocTipo, dc.DocNumero, dc.DocEstado, dc.CfeEstado,
                   dc.DocTotal, dc.TcaIdTransaccion
            FROM dbo.DocumentosContables dc
            WHERE dc.TcaIdTransaccion = ${id}
        `);
        console.log(`\n--- DocumentosContables para TcaId=${id} ---`);
        console.log(JSON.stringify(doc.recordset, null, 2));
    }

    process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
