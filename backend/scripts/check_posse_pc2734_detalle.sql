/* ═══════════════════════════════════════════════════════════════════════════
   SOLO LECTURA — Por qué PC-2734 y FA-391 (Posse Gutierrez) muestran pendiente
   parcial. No modifica nada.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

-- 1) TODOS los movimientos (cualquier tipo) ligados a estos 2 documentos
SELECT MovIdMovimiento, MovFecha, MovTipo, MovImporte, CueIdCuenta, DocIdDocumento,
       MovConcepto, MovAnulado, PagIdPago
FROM   dbo.MovimientosCuenta
WHERE  DocIdDocumento IN (6104, 6110)
ORDER  BY MovFecha, MovIdMovimiento;

-- 2) El CueSaldoActual (columna cacheada, con la posible contaminación de
--    órdenes) de la cuenta USD justo hoy
SELECT CueIdCuenta, CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = 65;

-- 3) Todas las órdenes (ORDEN/ORDEN_ANTICIPO) de la cuenta USD de HOY, para ver
--    cuánta "deuda de órdenes abiertas" está contaminando el saldo cacheado
SELECT MovIdMovimiento, MovFecha, MovTipo, MovImporte, DocIdDocumento, MovConcepto, MovAnulado
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 65 AND MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND  MovFecha >= '2026-07-25'
ORDER  BY MovFecha;

-- 4) Los detalles del pedido PC-2734 (por si el plan de tela cubrió parte)
SELECT dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTotal, dc.DocFechaEmision
FROM   dbo.DocumentosContables dc WHERE dc.DocIdDocumento IN (6104, 6110, 6100, 6114);
