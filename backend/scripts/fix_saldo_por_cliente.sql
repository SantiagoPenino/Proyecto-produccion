/* ============================================================
   CORRECCIÓN DEL ESTADO DE CUENTA — CLIENTE POR CLIENTE  (no toca facturas)

   Poné el código del cliente en @IDCliente, corré, revisá los SELECT de control
   y verificación, y si está OK cambiá ROLLBACK -> COMMIT.
   Repetí cambiando @IDCliente por cada cliente de la lista.

   Autodetecta y clasifica los desfasajes del cliente:
     A = libro mayor infló  (|MovImporte| > DocTotal, factura consistente)
     B = libro mayor facturó de menos (|MovImporte| < DocTotal, factura consistente)
     C = factura INCONSISTENTE (DocTotal != suma de sus líneas) -> se muestra marcada para que la mires

   Corrige las 3 variantes fijando la línea de facturación = -DocTotal (la factura manda).
   Como es de a un cliente con revisión, mirá el control (sobre todo las C) antes del COMMIT.
   ============================================================ */

DECLARE @IDCliente VARCHAR(50) = 'mrivero-745';   -- <<<<<<<< CAMBIAR por cada cliente

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @CliId INT = (SELECT TOP 1 CliIdCliente FROM dbo.Clientes WHERE RTRIM(IDCliente) = @IDCliente);
PRINT CONCAT('Cliente: ', @IDCliente, ' -> CliIdCliente = ', ISNULL(CONVERT(varchar(20),@CliId),'NO ENCONTRADO'));

/* ---- 1) Detectar y clasificar los desfasajes del cliente ---- */
IF OBJECT_ID('tempdb..#d') IS NOT NULL DROP TABLE #d;
SELECT
    m.MovIdMovimiento, m.CueIdCuenta, doc.DocIdDocumento, doc.DocTotal,
    m.MovImporte AS ImporteViejo,
    CAST(-doc.DocTotal AS DECIMAL(18,4)) AS ImporteNuevo,
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    CAST(ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d
                 WHERE d.DocIdDocumento = doc.DocIdDocumento), 0) AS DECIMAL(18,4)) AS SumaLineas,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = doc.DocIdDocumento)
        OR ABS(doc.DocTotal - ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d
                                      WHERE d.DocIdDocumento = doc.DocIdDocumento), 0)) > 0.05
      THEN 'C'
      WHEN ABS(m.MovImporte) - doc.DocTotal > 0 THEN 'A'
      ELSE 'B'
    END AS Variante,
    (SELECT COUNT(*) FROM dbo.MovimientosCuenta m2
     WHERE m2.DocIdDocumento = doc.DocIdDocumento
       AND m2.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
       AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0) AND m2.MovImporte <> 0) AS NLineasFact
INTO #d
FROM dbo.MovimientosCuenta   m
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = m.DocIdDocumento
JOIN dbo.CuentasCliente      cc  ON cc.CueIdCuenta     = m.CueIdCuenta
WHERE cc.CliIdCliente = @CliId
  AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.MovImporte <> 0
  AND (doc.DocEstado IS NULL OR doc.DocEstado NOT LIKE '%ANULAD%')
  AND ISNULL(doc.MonIdMoneda, cc.MonIdMoneda) = cc.MonIdMoneda
  AND ABS(ABS(m.MovImporte) - doc.DocTotal) > 0.01;

/* ---- Control: qué se detectó y qué acción se toma ----
       Variante C = factura con header != suma de líneas: SE CORRIGE igual (usa -DocTotal),
       pero prestale atención antes del COMMIT. Solo se saltea si hay >1 línea de facturación. */
SELECT Comprobante, Variante, ImporteViejo, ImporteNuevo, DocTotal, SumaLineas, NLineasFact,
       CASE WHEN NLineasFact = 1 THEN 'SE CORRIGE' + CASE WHEN Variante = 'C' THEN ' (revisar factura)' ELSE '' END
            ELSE 'REVISAR (>1 línea de facturación, no se toca)' END AS Accion
FROM #d ORDER BY Variante, Comprobante;

/* ---- 2) Corregir TODAS las variantes (A, B y C) con 1 sola línea de facturación ---- */
UPDATE m
SET m.MovImporte       = d.ImporteNuevo,
    m.MovObservaciones = N'FIX_SALDO_DESFASAJE: ' + CONVERT(varchar(30), d.ImporteViejo)
                       + N' -> ' + CONVERT(varchar(30), d.ImporteNuevo) + N' (=-DocTotal ' + d.Comprobante + N')'
FROM dbo.MovimientosCuenta m
JOIN #d d ON d.MovIdMovimiento = m.MovIdMovimiento
WHERE d.NLineasFact = 1;

/* ---- 3) Recomputar saldo corrido de las cuentas del cliente ---- */
;WITH ord AS (
    SELECT mc.MovIdMovimiento,
           SUM(mc.MovImporte) OVER (PARTITION BY mc.CueIdCuenta
                                    ORDER BY mc.MovFecha, mc.MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
    FROM dbo.MovimientosCuenta mc
    WHERE mc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #d)
      AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
)
UPDATE mc SET mc.MovSaldoPosterior = ord.run
FROM dbo.MovimientosCuenta mc JOIN ord ON ord.MovIdMovimiento = mc.MovIdMovimiento;

UPDATE cc SET cc.CueSaldoActual = x.s
FROM dbo.CuentasCliente cc
JOIN (SELECT mc.CueIdCuenta, SUM(mc.MovImporte) AS s
      FROM dbo.MovimientosCuenta mc
      WHERE mc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #d)
        AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
      GROUP BY mc.CueIdCuenta) x ON x.CueIdCuenta = cc.CueIdCuenta;

/* ---- 4) Verificación: saldo mostrado del cliente (todas sus cuentas) ---- */
SELECT cc.CueIdCuenta, RTRIM(cc.CueTipo) AS Tipo,
       (SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = cc.CueIdCuenta AND (MovAnulado IS NULL OR MovAnulado = 0)
          AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoMostrado
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @CliId
ORDER BY Tipo;

IF OBJECT_ID('tempdb..#d') IS NOT NULL DROP TABLE #d;

/* Revisá control + verificación. Si está OK cambiá la línea siguiente a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<<<<<< cambiar a COMMIT TRANSACTION; para aplicar
