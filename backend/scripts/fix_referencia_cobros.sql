/* ============================================================================
   FIX REFERENCIA COBROS — estampar DocIdDocumento en los PAGO "Sin referencia"
   ----------------------------------------------------------------------------
   En una venta CONTADO se crean dos movimientos hermanos: la VENTA (VTA_CAJA),
   que SÍ queda linkeada al documento, y el PAGO, que quedó con DocIdDocumento
   NULL -> en la vista 360 sale "Sin referencia".

   Este script empareja cada PAGO sin doc con su VENTA hermana (misma cuenta,
   misma fecha, mismo importe) y le copia el DocIdDocumento. Solo estampa cuando
   el emparejamiento es ÚNICO (si hay 2 ventas del mismo importe ese día, se saltea).

   Solo escribe DocIdDocumento donde hoy es NULL. NO toca importes, saldos ni
   deuda (es lo mismo que ya estampa el flujo de cobro para los nuevos).
   Por defecto ROLLBACK. Revisá CONTROL + VERIFICACIÓN y cambiá a COMMIT.
   ============================================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

/* ---- 1) Emparejar PAGO sin doc <-> VENTA hermana con doc ÚNICO ---- */
IF OBJECT_ID('tempdb..#map') IS NOT NULL DROP TABLE #map;

SELECT
    m.MovIdMovimiento AS PagoMov,
    m.CueIdCuenta,
    MIN(v.DocIdDocumento) AS DocId
INTO #map
FROM dbo.MovimientosCuenta m
JOIN dbo.MovimientosCuenta v
      ON  v.CueIdCuenta = m.CueIdCuenta
      AND v.MovTipo IN ('VTA_CAJA','CIERRE_CICLO','VENTA','CARGO')
      AND v.DocIdDocumento IS NOT NULL
      AND (v.MovAnulado IS NULL OR v.MovAnulado = 0)
      AND CAST(v.MovFecha AS DATE) = CAST(m.MovFecha AS DATE)
      AND ABS(ABS(v.MovImporte) - ABS(m.MovImporte)) <= 0.5
JOIN dbo.DocumentosContables dc
      ON  dc.DocIdDocumento = v.DocIdDocumento
      AND RTRIM(dc.DocSerie) <> 'RC'
      AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
WHERE m.MovTipo IN ('PAGO','COBRO')
  AND m.DocIdDocumento IS NULL
  AND m.OrdIdOrden    IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
GROUP BY m.MovIdMovimiento, m.CueIdCuenta
HAVING COUNT(DISTINCT v.DocIdDocumento) = 1;   -- emparejamiento único

/* ---- 2) CONTROL — qué se va a estampar ---- */
DECLARE @n INT = (SELECT COUNT(*) FROM #map);
PRINT CONCAT('Cobros a estampar: ', @n);

SELECT TOP 30
    x.PagoMov,
    RTRIM(cli.NombreFantasia) AS Cliente,
    RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) AS Documento,
    CAST(dc.DocTotal AS decimal(18,2)) AS DocTotal,
    CONVERT(varchar(10), m.MovFecha, 23) AS Fecha
FROM #map x
JOIN dbo.MovimientosCuenta   m   ON m.MovIdMovimiento = x.PagoMov
JOIN dbo.DocumentosContables dc  ON dc.DocIdDocumento = x.DocId
LEFT JOIN dbo.Clientes       cli ON cli.CliIdCliente  = dc.CliIdCliente
ORDER BY m.MovFecha DESC;

/* ---- 3) ESTAMPAR ---- */
UPDATE m
SET m.DocIdDocumento = x.DocId
FROM dbo.MovimientosCuenta m
JOIN #map x ON x.PagoMov = m.MovIdMovimiento
WHERE m.DocIdDocumento IS NULL;

/* ---- 4) VERIFICACIÓN — cobros que quedaban sin referencia, antes vs después ---- */
SELECT
    (SELECT COUNT(*) FROM dbo.MovimientosCuenta
       WHERE MovTipo IN ('PAGO','COBRO') AND OrdIdOrden IS NULL
         AND (MovAnulado IS NULL OR MovAnulado = 0) AND DocIdDocumento IS NULL) AS SinReferencia_Ahora,
    @n AS Estampados_EnEstaCorrida;

DROP TABLE #map;

/* Revisá CONTROL + VERIFICACIÓN. Si está OK, cambiá abajo a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
