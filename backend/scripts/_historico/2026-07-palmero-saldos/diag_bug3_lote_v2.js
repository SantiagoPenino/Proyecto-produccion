// SOLO LECTURA — BUG 3 (cargo faltante en la moneda del documento), join por CueTipo
// (no por MonIdMoneda: esa columna viene NULL en algunas cuentas, ver fix_crossmoneda_lote1.sql).
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));

const clientes = [
  { id: 257, nombre: 'elea' },
  { id: 896, nombre: 'Martina Berriel' },
  { id: 930, nombre: 'Rdssport' },
  { id: 644, nombre: 'SRL Tienda Online' },
  { id: 8627, nombre: 'Ventas local USER' },
];

(async () => {
  try {
    const pool = await getPool();
    for (const c of clientes) {
      const r = await pool.request().input('c', sql.Int, c.id).query(`
        SELECT dc.DocIdDocumento, RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) AS Doc,
               CAST(dc.DocTotal AS DECIMAL(18,2)) AS DocTotal, mo.MonSimbolo AS DocMoneda,
               CargoMismaMoneda = (SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    JOIN dbo.CuentasCliente cc2 ON cc2.CueIdCuenta = m.CueIdCuenta
                                    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
                                      AND cc2.CueTipo = CASE WHEN dc.MonIdMoneda = 1 THEN 'DINERO_UYU' ELSE 'DINERO_USD' END
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado=0))
        FROM dbo.DocumentosContables dc
        JOIN dbo.Monedas mo ON mo.MonIdMoneda = dc.MonIdMoneda
        WHERE dc.CliIdCliente = @c AND dc.DocEstado <> 'ANULADO' AND RTRIM(dc.DocSerie) NOT IN ('RC')
        ORDER BY dc.DocIdDocumento`);
      const alertas = r.recordset.filter(x => x.CargoMismaMoneda == null || Math.abs(Number(x.CargoMismaMoneda) + Number(x.DocTotal)) > 1);
      console.log(`\n${c.nombre} (CliId ${c.id}) — BUG 3 real (join por CueTipo):`);
      if (alertas.length) console.table(alertas); else console.log('   (ninguno)');
    }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
