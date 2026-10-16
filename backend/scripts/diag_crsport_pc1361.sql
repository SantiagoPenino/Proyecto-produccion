/* ═══════════════════════════════════════════════════════════════════════════
   DIAGNÓSTICO SOLO LECTURA — CR SPORT, cuenta USD (222)  ·  28-jul-2026
   No modifica nada. Correr y pasar el resultado.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

-- 1) Las 5 deudas vivas con su historial de observaciones (para ver si el
--    fix de esta mañana quedó registrado o no)
SELECT DDeIdDocumento, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente,
       DDeEstado, DDeObservaciones
FROM   dbo.DeudaDocumento
WHERE  CueIdCuenta = 222 AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
ORDER  BY DDeIdDocumento;

-- 2) Todos los movimientos de dinero (no-ORDEN) de la cuenta
SELECT MovIdMovimiento, MovTipo, LEFT(MovConcepto,50) AS Concepto, MovImporte,
       DocIdDocumento, CONVERT(varchar(16), MovFecha, 120) AS Fecha, MovAnulado
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 222 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER  BY MovIdMovimiento;

-- 3) Billetera recalculada
SELECT CAST(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado = 0)
                      THEN MovImporte END) AS DECIMAL(18,2)) AS Billetera
FROM   dbo.MovimientosCuenta WHERE CueIdCuenta = 222;
