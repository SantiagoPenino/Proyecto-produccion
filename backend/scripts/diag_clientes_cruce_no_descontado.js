// Solo lectura, contra el local. Busca el patrón EXACTO de Favio Curbelo:
// una factura (DeudaDocumento con DocIdDocumento real) que sigue PENDIENTE,
// cuyo ciclo YA había recibido créditos de PAGO_CRUZADO (cruces de moneda,
// plata real) ANTES del cierre — créditos que el cierre no descontó del
// pendiente de la factura.
const { getPool, sql } = require('../config/db');

(async () => {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT
      dd.DDeIdDocumento, cc.CueIdCuenta, cli.CliIdCliente, RTRIM(cli.Nombre) AS Cliente,
      RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR(20)) AS Factura,
      mo.MonSimbolo,
      CAST(dd.DDeImporteOriginal AS DECIMAL(18,2))   AS FacturaTotal,
      CAST(dd.DDeImportePendiente AS DECIMAL(18,2))  AS PendienteHoy,
      cierre.CicIdCiclo,
      CAST(ISNULL(cruce.CrucesPrevios, 0) AS DECIMAL(18,2)) AS CrucesYaCobrados_no_descontados
    FROM dbo.DeudaDocumento dd
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
    JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
    JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
    LEFT JOIN dbo.Monedas mo ON mo.MonIdMoneda = cc.MonIdMoneda
    OUTER APPLY (
      SELECT TOP 1 m.CicIdCiclo, m.MovFecha
      FROM dbo.MovimientosCuenta m
      WHERE m.DocIdDocumento = dd.DocIdDocumento AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      ORDER BY m.MovIdMovimiento DESC
    ) cierre
    OUTER APPLY (
      SELECT SUM(m2.MovImporte) AS CrucesPrevios
      FROM dbo.MovimientosCuenta m2
      WHERE m2.CueIdCuenta = cc.CueIdCuenta AND m2.MovTipo = 'PAGO_CRUZADO' AND m2.MovImporte > 0
        AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
        AND m2.CicIdCiclo = cierre.CicIdCiclo
        AND m2.MovFecha <= cierre.MovFecha
    ) cruce
    WHERE dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
      AND dd.DocIdDocumento IS NOT NULL
      AND cierre.CicIdCiclo IS NOT NULL
      AND ISNULL(cruce.CrucesPrevios, 0) > 1
    ORDER BY cruce.CrucesPrevios DESC
  `);
  console.log(`${r.recordset.length} facturas pendientes con cruces previos no descontados.`);
  console.table(r.recordset.slice(0, 40));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
