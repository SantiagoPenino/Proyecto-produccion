// SOLO LECTURA — metodología del CATALOGO_BUGS_SALDO_CLIENTES.md, punto 4:
// saldo EN VIVO (no CueSaldoActual cacheado, que las pantallas ni leen) vs deuda viva.
// + chequeo BUG 3 (firma "Manual Edicion") para estos 5 clientes.
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
      console.log(`\n\n══════════════════════════════════════════════════════════════`);
      console.log(`  ${c.nombre}  (CliId ${c.id})`);
      console.log(`══════════════════════════════════════════════════════════════`);

      const vivo = await pool.request().input('c', sql.Int, c.id).query(`
        SELECT cc.CueIdCuenta, RTRIM(cc.CueTipo) AS CueTipo,
          CAST(ISNULL((SELECT SUM(mm.MovImporte) FROM dbo.MovimientosCuenta mm
               WHERE mm.CueIdCuenta=cc.CueIdCuenta AND (mm.MovAnulado IS NULL OR mm.MovAnulado=0)
                 AND mm.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),0) AS DECIMAL(18,2)) AS SaldoEnVivo,
          CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
               WHERE dd.CueIdCuenta=cc.CueIdCuenta AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')),0) AS DECIMAL(18,2)) AS DeudaViva,
          CAST(cc.CueSaldoActual AS DECIMAL(18,2)) AS CueSaldoActualCacheado
        FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @c AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD')`);
      console.table(vivo.recordset.map(r => ({
        ...r,
        Diferencia: CAST2(r.SaldoEnVivo + r.DeudaViva) // SaldoEnVivo es negativo si debe; +DeudaViva (positiva) debería dar ~0 si "debe justo lo que la deuda dice"
      })));

      const bug3 = await pool.request().input('c', sql.Int, c.id).query(`
        SELECT dc.DocIdDocumento, RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) AS Doc,
               CAST(dc.DocTotal AS DECIMAL(18,2)) AS DocTotal, mo.MonSimbolo AS DocMoneda,
               CargoMismaMoneda = (SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    JOIN dbo.CuentasCliente cc2 ON cc2.CueIdCuenta = m.CueIdCuenta
                                    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
                                      AND cc2.MonIdMoneda = dc.MonIdMoneda AND (m.MovAnulado IS NULL OR m.MovAnulado=0))
        FROM dbo.DocumentosContables dc
        JOIN dbo.Monedas mo ON mo.MonIdMoneda = dc.MonIdMoneda
        WHERE dc.CliIdCliente = @c AND dc.DocEstado <> 'ANULADO' AND RTRIM(dc.DocSerie) NOT IN ('RC')
        ORDER BY dc.DocIdDocumento`);
      const bug3Alertas = bug3.recordset.filter(r => r.CargoMismaMoneda == null || Math.abs(Number(r.CargoMismaMoneda) + Number(r.DocTotal)) > 1);
      console.log('-- BUG 3 (cargo faltante en la moneda del documento) --');
      if (bug3Alertas.length) console.table(bug3Alertas); else console.log('   (ninguno)');
    }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();

function CAST2(n) { return Math.round(n * 100) / 100; }
