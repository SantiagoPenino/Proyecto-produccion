// Solo lectura, contra el local. Busca cuentas de dinero donde el saldo real
// (movimientos, excluyendo ORDEN) es MENOS negativo de lo que las deudas vivas
// (DeudaDocumento) dicen que debería ser — el mismo patrón de Favio Curbelo:
// plata ya recibida (anticipos/cruces) que el cierre de ciclo no descontó del
// pendiente de la factura, y quedó como sobrante flotante sin exponer.
const { getPool, sql } = require('../config/db');

(async () => {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT
      cc.CueIdCuenta, cc.CliIdCliente, RTRIM(cli.Nombre) AS Cliente, cli.IDCliente,
      mo.MonSimbolo,
      CAST(ISNULL(saldo.SaldoReal, 0) AS DECIMAL(18,2))        AS SaldoReal,
      CAST(ISNULL(deuda.PendienteDocs, 0) AS DECIMAL(18,2))    AS PendienteDocs,
      CAST(ISNULL(deuda.PendienteDocs, 0) + ISNULL(saldo.SaldoReal, 0) AS DECIMAL(18,2)) AS Sobrante_no_expuesto
    FROM dbo.CuentasCliente cc
    JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
    LEFT JOIN dbo.Monedas mo ON mo.MonIdMoneda = cc.MonIdMoneda
    OUTER APPLY (
      SELECT SUM(MovImporte) AS SaldoReal
      FROM dbo.MovimientosCuenta
      WHERE CueIdCuenta = cc.CueIdCuenta AND (MovAnulado IS NULL OR MovAnulado = 0)
        AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
    ) saldo
    OUTER APPLY (
      SELECT SUM(DDeImportePendiente) AS PendienteDocs
      FROM dbo.DeudaDocumento
      WHERE CueIdCuenta = cc.CueIdCuenta AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
    ) deuda
    WHERE cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
      AND cc.CueActiva = 1
      AND ISNULL(deuda.PendienteDocs, 0) > 0   -- solo tiene sentido si hay deuda viva que comparar
    ORDER BY ABS(ISNULL(deuda.PendienteDocs, 0) + ISNULL(saldo.SaldoReal, 0)) DESC
  `);
  console.log(`${r.recordset.length} cuentas con deuda viva evaluadas.`);
  console.table(r.recordset.filter(x => Math.abs(x.Sobrante_no_expuesto) > 5).slice(0, 40));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
