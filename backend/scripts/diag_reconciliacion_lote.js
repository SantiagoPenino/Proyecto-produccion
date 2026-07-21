// SOLO LECTURA — corre diag_reconciliacion_cliente.sql para varios clientes de una vez
// (los 6 casos del fix cross-moneda de la sesión de Palmero, sin contar a Palmero).
// Muestra también CueSaldoActual cacheado de cada cuenta para ver si hay saldo a favor fantasma.
const fs = require('fs');
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));

const clientes = [
  { id: 257, nombre: 'elea' },
  { id: 896, nombre: 'Martina Berriel' },
  { id: 930, nombre: 'Rdssport' },
  { id: 644, nombre: 'SRL Tienda Online' },
  { id: 8627, nombre: 'Ventas local USER' },
];

const plantilla = fs.readFileSync(path.resolve(__dirname, 'diag_reconciliacion_cliente.sql'), 'utf8');

(async () => {
  try {
    const pool = await getPool();
    for (const c of clientes) {
      console.log(`\n\n══════════════════════════════════════════════════════════════`);
      console.log(`  ${c.nombre}  (CliId ${c.id})`);
      console.log(`══════════════════════════════════════════════════════════════`);

      const texto = plantilla.replace('DECLARE @Cli INT = 998;', `DECLARE @Cli INT = ${c.id};`);
      const r = await pool.request().query(texto);
      const [docs, anomalias, huerfanos, mayor] = r.recordsets;

      console.log(`\n-- Saldo cacheado de las cuentas --`);
      const cuentas = await pool.request().input('c', sql.Int, c.id).query(`
        SELECT cc.CueIdCuenta, RTRIM(cc.CueTipo) AS CueTipo, CAST(cc.CueSaldoActual AS DECIMAL(18,2)) AS CueSaldoActual
        FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @c AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD')`);
      console.table(cuentas.recordset);

      console.log(`\n-- Sección 2: anomalías (deuda duplicada / no coincide lo cobrado) --`);
      if (anomalias.length) console.table(anomalias); else console.log('   (ninguna)');

      console.log(`\n-- Sección 3: pagos huérfanos (no atados a ningún documento) --`);
      if (huerfanos.length) console.table(huerfanos); else console.log('   (ninguno)');
    }
    process.exit(0);
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
