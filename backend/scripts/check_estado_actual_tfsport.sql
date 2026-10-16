/* ═══════════════════════════════════════════════════════════════════════════
   SOLO LECTURA — Estado actual de Tamara Flores (TF SPORT) en PRODUCCIÓN
   30-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   Mi local está atrasado respecto a producción (menos actividad reciente),
   así que antes de proponer nada hay que ver los datos reales de acá. No
   modifica nada.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

-- 1) Cliente
SELECT CliIdCliente, Nombre, IDCliente, CioRuc
FROM   dbo.Clientes WHERE IDCliente = 'TF SPORT';

-- 2) Cuentas (dinero y recursos)
SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual, mo.MonSimbolo, cc.ProIdProducto
FROM   dbo.CuentasCliente cc
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Monedas mo ON mo.MonIdMoneda = cc.MonIdMoneda
WHERE  c.IDCliente = 'TF SPORT';

-- 3) TODAS las deudas (vivas y muertas) del cliente, con el documento
SELECT dd.DDeIdDocumento, dd.CueIdCuenta, dd.DocIdDocumento, dc.DocSerie, dc.DocNumero,
       dc.DocTotal, dc.DocFechaEmision, dc.DocEstado AS DocEstadoDoc,
       dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado, dd.DDeObservaciones
FROM   dbo.DeudaDocumento dd
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE  c.IDCliente = 'TF SPORT'
ORDER  BY dd.DDeIdDocumento DESC;

-- 4) Saldo real de la cuenta USD (lo que muestra la barra "Saldos")
SELECT cc.CueIdCuenta,
       CAST(SUM(CASE WHEN m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (m.MovAnulado IS NULL OR m.MovAnulado=0)
                     THEN m.MovImporte END) AS DECIMAL(18,4)) AS SaldoReal_hoy
FROM   dbo.CuentasCliente cc
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
JOIN   dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
WHERE  c.IDCliente = 'TF SPORT' AND cc.CueTipo = 'DINERO_USD'
GROUP  BY cc.CueIdCuenta;

-- 5) TODOS los movimientos que afectan el saldo (no-ORDEN) de la cuenta USD,
--    para ver de dónde sale cada crédito/débito real
SELECT m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte, m.DocIdDocumento,
       m.MovConcepto, m.MovAnulado, m.PagIdPago
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE  c.IDCliente = 'TF SPORT' AND cc.CueTipo = 'DINERO_USD'
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER  BY m.MovFecha, m.MovIdMovimiento;

-- 6) El documento de US$212,81 puntualmente (para ver por qué su pendiente es 39,55)
SELECT dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTotal, dc.DocFechaEmision, dc.TcaIdTransaccion
FROM   dbo.DocumentosContables dc
JOIN   dbo.Clientes c ON c.CliIdCliente = dc.CliIdCliente
WHERE  c.IDCliente = 'TF SPORT' AND ABS(dc.DocTotal - 212.81) < 0.02;
