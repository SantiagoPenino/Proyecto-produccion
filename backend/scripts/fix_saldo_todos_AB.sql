/* ============================================================
   FIX SALDO — TODOS los desfasajes A y B de una (mixtos incluidos)
   Corrige de una sola pasada TODOS los documentos con desfasaje ledger vs factura
   que sean SEGUROS: factura consistente (DocTotal = suma de líneas) y UNA sola
   línea de facturación. Fija el movimiento = -DocTotal (la factura manda).

   Deja AFUERA automáticamente:
     · Variante C (factura inconsistente) -> requiere re-facturar, no se toca.
     · Multi-línea / cross-moneda -> falsos positivos, no se tocan.

   El control lista TODO lo que va a cambiar (baja o sube deuda) para que lo revisés
   antes del COMMIT. NO toca facturas. Por defecto ROLLBACK.
   ============================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('tempdb..#objetivo') IS NOT NULL DROP TABLE #objetivo;

SELECT
    m.MovIdMovimiento, m.CueIdCuenta, doc.DocIdDocumento, doc.DocTotal,
    m.MovImporte AS ImporteViejo,
    CAST(-doc.DocTotal AS DECIMAL(18,4)) AS ImporteNuevo,
    CASE WHEN ABS(m.MovImporte) - doc.DocTotal > 0 THEN 'A (baja deuda)' ELSE 'B (sube deuda)' END AS Variante
INTO #objetivo
FROM dbo.MovimientosCuenta   m
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = m.DocIdDocumento
JOIN dbo.CuentasCliente      cc  ON cc.CueIdCuenta     = m.CueIdCuenta
WHERE m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovImporte <> 0
  AND (doc.DocEstado IS NULL OR doc.DocEstado NOT LIKE '%ANULAD%')
  AND ISNULL(doc.MonIdMoneda, cc.MonIdMoneda) = cc.MonIdMoneda
  -- Hay desfasaje (A o B, cualquiera)
  AND ABS(ABS(m.MovImporte) - doc.DocTotal) > 0.01
  -- Factura CONSISTENTE (excluye variante C)
  AND EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = doc.DocIdDocumento)
  AND ABS(doc.DocTotal - ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = doc.DocIdDocumento), 0)) <= 0.05
  -- Guard: una sola línea de facturación (excluye multi-línea / cross-moneda)
  AND (SELECT COUNT(*) FROM dbo.MovimientosCuenta m2
       WHERE m2.DocIdDocumento = doc.DocIdDocumento AND m2.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
         AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0) AND m2.MovImporte <> 0) = 1;

/* ---- Control: TODO lo que va a cambiar (revisar antes del COMMIT) ---- */
SELECT RTRIM(cli.NombreFantasia) AS Cliente,
       RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
       o.Variante, o.ImporteViejo, o.ImporteNuevo,
       CAST(o.ImporteNuevo - o.ImporteViejo AS DECIMAL(18,4)) AS CambioSaldo
FROM #objetivo o
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = o.DocIdDocumento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = o.CueIdCuenta
JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
ORDER BY Cliente, Comprobante;

DECLARE @nDocs INT = (SELECT COUNT(*) FROM #objetivo);
DECLARE @nCli  INT = (SELECT COUNT(DISTINCT cc.CliIdCliente) FROM #objetivo o JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = o.CueIdCuenta);
PRINT CONCAT('Documentos a corregir: ', @nDocs, ' | Clientes: ', @nCli);

/* ---- Corregir = -DocTotal ---- */
UPDATE m
SET m.MovImporte       = o.ImporteNuevo,
    m.MovObservaciones = N'FIX_SALDO_DESFASAJE: corregido a ' + CONVERT(varchar(30), o.ImporteNuevo)
                       + N' (=-DocTotal, era ' + CONVERT(varchar(30), o.ImporteViejo) + N')'
FROM dbo.MovimientosCuenta m JOIN #objetivo o ON o.MovIdMovimiento = m.MovIdMovimiento;

/* ---- Recomputar MovSaldoPosterior ---- */
;WITH ord AS (
    SELECT mc.MovIdMovimiento,
           SUM(mc.MovImporte) OVER (PARTITION BY mc.CueIdCuenta ORDER BY mc.MovFecha, mc.MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
    FROM dbo.MovimientosCuenta mc
    WHERE mc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #objetivo) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
)
UPDATE mc SET mc.MovSaldoPosterior = ord.run
FROM dbo.MovimientosCuenta mc JOIN ord ON ord.MovIdMovimiento = mc.MovIdMovimiento;

/* ---- Recomputar CueSaldoActual ---- */
UPDATE cc SET cc.CueSaldoActual = x.s
FROM dbo.CuentasCliente cc
JOIN (SELECT mc.CueIdCuenta, SUM(mc.MovImporte) AS s FROM dbo.MovimientosCuenta mc
      WHERE mc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #objetivo) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
      GROUP BY mc.CueIdCuenta) x ON x.CueIdCuenta = cc.CueIdCuenta;

/* ---- Verificación: saldo por cuenta afectada ---- */
SELECT cc.CueIdCuenta, RTRIM(cli.NombreFantasia) AS Cliente, RTRIM(cc.CueTipo) AS Tipo,
       (SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = cc.CueIdCuenta AND (MovAnulado IS NULL OR MovAnulado = 0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoMostrado
FROM dbo.CuentasCliente cc JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #objetivo)
ORDER BY Cliente, Tipo;

DROP TABLE #objetivo;

/* Revisá control + verificación. Si está OK cambiá la línea siguiente a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
