/* ═══════════════════════════════════════════════════════════════════════════
   SOLO LECTURA — Estado actual de Favio Curbelo (FVR) en PRODUCCIÓN
   29-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   Antes de correr los 2 scripts de corrección, hay que confirmar que
   producción está en el mismo punto de partida que el local (donde se
   armaron y probaron los scripts). Esta consulta no modifica nada.
   Resuelve todo por RUC/IDCliente 'FVR' — no asume que los IDs numéricos
   (CueIdCuenta 472, DDeIdDocumento 8224, etc.) sean iguales en prod.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

-- 1) Cliente e IDs reales en esta base
SELECT CliIdCliente, Nombre, IDCliente, CioRuc
FROM   dbo.Clientes WHERE IDCliente = 'FVR';

-- 2) Cuentas de dinero del cliente (para confirmar CueIdCuenta)
SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual, mo.MonSimbolo
FROM   dbo.CuentasCliente cc
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Monedas mo ON mo.MonIdMoneda = cc.MonIdMoneda
WHERE  c.IDCliente = 'FVR';

-- 3) FA-332: estado de la deuda (para saber si el neteo ya se revirtió o no)
SELECT dd.DDeIdDocumento, dd.DocIdDocumento, dd.DDeImporteOriginal, dd.DDeImportePendiente,
       dd.DDeEstado, dd.DDeObservaciones
FROM   dbo.DeudaDocumento dd
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
JOIN   dbo.DocumentosContables dc ON dc.DocIdDocumento = dd.DocIdDocumento
WHERE  c.IDCliente = 'FVR' AND dc.DocSerie = 'FA' AND dc.DocNumero = 332;

-- 4) Saldo real de la cuenta USD (suma de movimientos, excluyendo ORDEN) — lo
--    que hoy muestra la barra "Saldos" del Panel 360
SELECT cc.CueIdCuenta,
       CAST(SUM(CASE WHEN m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                     THEN m.MovImporte END) AS DECIMAL(18,4)) AS SaldoReal_hoy
FROM   dbo.CuentasCliente cc
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
JOIN   dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
WHERE  c.IDCliente = 'FVR' AND cc.CueTipo = 'DINERO_USD'
GROUP BY cc.CueIdCuenta;

-- 5) ¿Ya existe algún ajuste manual previo sobre esta cuenta? (para no duplicar)
SELECT m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte, m.MovConcepto
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE  c.IDCliente = 'FVR' AND cc.CueTipo = 'DINERO_USD'
  AND  m.MovTipo IN ('AJUSTE_POS','AJUSTE_NEG','AJUSTE_MANUAL');
