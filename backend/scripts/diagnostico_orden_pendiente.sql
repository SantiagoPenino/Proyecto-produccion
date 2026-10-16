/* ============================================================================
   DIAGNÓSTICO: ¿por qué una orden NO aparece en "Órdenes Pendientes de Facturar"?
   Poné el código abajo y corré (SOLO LECTURA). Dice EXACTAMENTE qué condición falla.

   La bandeja (getOrdenesAnticipo) muestra la orden solo si su movimiento ORDEN cumple:
     · MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
     · DocIdDocumento IS NULL            (no facturada)
     · MovAnulado = 0                    (no anulada)
     · MovObservaciones NO empieza con 'CUBIERTO'
   Y en pantalla, además, el movimiento tiene que estar en la CUENTA (moneda) que
   estás mirando en ese momento (pestaña US$ / $).
   ============================================================================ */
SET NOCOUNT ON;
DECLARE @Codigo varchar(40) = 'SB-66303';   -- <<<< cambiá acá

/* Resolver el/los OrdIdOrden posibles del código (ERP y Depósito) */
IF OBJECT_ID('tempdb..#ord') IS NOT NULL DROP TABLE #ord;
SELECT OrdId
INTO #ord
FROM (
    SELECT OrdenID AS OrdId FROM dbo.Ordenes WHERE CodigoOrden = @Codigo
    UNION
    SELECT OrdIdOrden FROM dbo.OrdenesDeposito WHERE OrdCodigoOrden LIKE @Codigo + '%'
) t;

/* 1) TODOS los movimientos de esa orden (para ver el panorama) */
SELECT
    m.MovIdMovimiento, RTRIM(m.MovTipo) AS Tipo,
    CAST(m.MovImporte AS decimal(18,2)) AS Importe,
    ISNULL(m.MovAnulado,0) AS Anulado,
    m.DocIdDocumento,
    RTRIM(cc.CueTipo) AS Cuenta, RTRIM(ISNULL(mo.MonSimbolo,'')) AS Moneda,
    LEFT(RTRIM(ISNULL(m.MovConcepto,'')),35) AS Concepto,
    RTRIM(ISNULL(m.MovObservaciones,'(null)')) AS Observaciones
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.Monedas mo ON mo.MonIdMoneda = cc.MonIdMoneda
WHERE m.OrdIdOrden IN (SELECT OrdId FROM #ord)
ORDER BY m.MovIdMovimiento;

/* 2) VEREDICTO sobre el movimiento ORDEN: ¿aparece en la bandeja? ¿por qué no? */
SELECT
    m.MovIdMovimiento,
    RTRIM(cc.CueTipo) AS Cuenta,
    CASE
        WHEN m.DocIdDocumento IS NOT NULL              THEN 'NO — ya está FACTURADA (DocId ' + CAST(m.DocIdDocumento AS varchar(20)) + ')'
        WHEN ISNULL(m.MovAnulado,0) = 1               THEN 'NO — está ANULADA'
        WHEN m.MovObservaciones LIKE 'CUBIERTO%'       THEN 'NO — sigue marcada CUBIERTO (obs: ' + RTRIM(m.MovObservaciones) + ') → falta revertir/reiniciar backend o correr el fix'
        ELSE 'SÍ debería aparecer — si no la ves, es por la PESTAÑA de moneda (' + RTRIM(ISNULL(mo.MonSimbolo,'?')) + '): mirá en esa moneda'
    END AS Veredicto
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.Monedas mo ON mo.MonIdMoneda = cc.MonIdMoneda
WHERE m.OrdIdOrden IN (SELECT OrdId FROM #ord)
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO');

/* 3) Deuda de la orden */
SELECT dd.DDeIdDocumento, RTRIM(dd.DDeEstado) AS Estado, dd.DDeImportePendiente, dd.DDeImporteOriginal
FROM dbo.DeudaDocumento dd
WHERE dd.OrdIdOrden IN (SELECT OrdId FROM #ord);

DROP TABLE #ord;
