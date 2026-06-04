const { getPool } = require('./config/db');

(async () => {
    const pool = await getPool();

    // 1. Buscar cliente BANDERAS
    const cli = await pool.request().query(
        "SELECT CliIdCliente, Nombre FROM dbo.Clientes WHERE Nombre LIKE '%BANDERA%'"
    );
    console.log('Clientes:', JSON.stringify(cli.recordset));

    const cliId = cli.recordset[0]?.CliIdCliente;
    if (!cliId) { console.log('No encontrado'); process.exit(0); }

    // 2. Ver CuentasCliente y su CueSaldoActual
    const ctas = await pool.request().query(
        `SELECT CueIdCuenta, CueTipo, CueSaldoActual FROM dbo.CuentasCliente WHERE CliIdCliente = ${cliId}`
    );
    console.log('\nCuentas:', JSON.stringify(ctas.recordset, null, 2));

    // 3. Ver los movimientos — importes y saldos registrados en SP
    if (ctas.recordset.length > 0) {
        const ids = ctas.recordset.map(r => r.CueIdCuenta).join(',');
        const movs = await pool.request().query(
            `SELECT MovIdMovimiento, CueIdCuenta, MovTipo, MovImporte, MovSaldoPosterior
             FROM dbo.MovimientosCuenta WHERE CueIdCuenta IN (${ids})
             ORDER BY MovIdMovimiento`
        );
        console.log('\nMovimientos:', JSON.stringify(movs.recordset, null, 2));

        // 4. Calcular saldo real sumando movimientos vs CueSaldoActual
        for (const cta of ctas.recordset) {
            const sum = await pool.request().query(
                `SELECT ISNULL(SUM(MovImporte),0) AS SumaMovimientos
                 FROM dbo.MovimientosCuenta WHERE CueIdCuenta = ${cta.CueIdCuenta} AND (MovAnulado IS NULL OR MovAnulado = 0)`
            );
            const sumaMovs = sum.recordset[0].SumaMovimientos;
            console.log(`\nCueId=${cta.CueIdCuenta} CueTipo=${cta.CueTipo}:`);
            console.log(`  CueSaldoActual (BD)  = ${cta.CueSaldoActual}`);
            console.log(`  SUM(MovImporte) calc = ${sumaMovs}`);
            console.log(`  Diferencia           = ${(Number(cta.CueSaldoActual) - Number(sumaMovs)).toFixed(4)}`);
        }
    }

    process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
