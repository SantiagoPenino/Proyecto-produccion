/* ═══════════════════════════════════════════════════════════════════════════
   SOLO LECTURA — Estado actual de CAPA Indumentaria Deportiva en PRODUCCIÓN
   30-jul-2026. No modifica nada.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

-- 1) Cliente
SELECT CliIdCliente, Nombre, IDCliente, CioRuc
FROM   dbo.Clientes WHERE IDCliente = 'capa';

-- 2) Cuentas (dinero y recursos)
SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual, mo.MonSimbolo, cc.ProIdProducto
FROM   dbo.CuentasCliente cc
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Monedas mo ON mo.MonIdMoneda = cc.MonIdMoneda
WHERE  c.IDCliente = 'capa';

-- 3) TODAS las deudas vivas (pendiente > 0), ambas monedas
SELECT dd.DDeIdDocumento, dd.CueIdCuenta, dd.DocIdDocumento, dc.DocSerie, dc.DocNumero,
       dc.DocTotal, dc.DocFechaEmision, dc.DocEstado AS DocEstadoDoc,
       dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado, dd.DDeObservaciones
FROM   dbo.DeudaDocumento dd
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE  c.IDCliente = 'capa' AND dd.DDeImportePendiente > 0.01
ORDER  BY dd.CueIdCuenta, dd.DDeIdDocumento DESC;

-- 4) Saldo real de cada cuenta de dinero (lo que muestra la barra "Saldos")
SELECT cc.CueIdCuenta, cc.CueTipo,
       CAST(SUM(CASE WHEN m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (m.MovAnulado IS NULL OR m.MovAnulado=0)
                     THEN m.MovImporte END) AS DECIMAL(18,4)) AS SaldoReal_hoy
FROM   dbo.CuentasCliente cc
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
JOIN   dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
WHERE  c.IDCliente = 'capa' AND cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
GROUP  BY cc.CueIdCuenta, cc.CueTipo;

-- 5) TODOS los movimientos que afectan el saldo (no-ORDEN) de AMBAS cuentas de dinero
SELECT m.CueIdCuenta, m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte, m.DocIdDocumento,
       m.MovConcepto, m.MovAnulado, m.PagIdPago
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE  c.IDCliente = 'capa' AND cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER  BY m.CueIdCuenta, m.MovFecha, m.MovIdMovimiento;
