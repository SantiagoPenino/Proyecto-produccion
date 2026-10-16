/* ============================================================
   GRUPO B — CLIENTES B PUROS (DINÁMICO, mixtos EXCLUIDOS automáticamente)
   Corrige los desfasajes variante B (ledger < DocTotal) SOLO de clientes que NO
   tienen ningún desfasaje A ni C (los mixtos se corrigen de a uno con fix_saldo_por_cliente.sql).
   Fija el movimiento = -DocTotal (la factura manda). NO toca facturas.

   *** ATENCION *** AGREGA deuda. Revisá el control. Guard de 1 línea (excluye multi-línea/cross-moneda).
   Por defecto ROLLBACK. Revisá y cambiá a COMMIT para aplicar.
   ============================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('tempdb..#objetivo') IS NOT NULL DROP TABLE #objetivo;

SELECT
    m.MovIdMovimiento, m.CueIdCuenta, doc.DocIdDocumento, doc.DocTotal,
    m.MovImporte AS ImporteViejo,
    CAST(-doc.DocTotal AS DECIMAL(18,4)) AS ImporteNuevo
INTO #objetivo
FROM dbo.MovimientosCuenta   m
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = m.DocIdDocumento
JOIN dbo.CuentasCliente      cc  ON cc.CueIdCuenta     = m.CueIdCuenta
WHERE m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovImporte <> 0
  AND (doc.DocEstado IS NULL OR doc.DocEstado NOT LIKE '%ANULAD%')
  AND ISNULL(doc.MonIdMoneda, cc.MonIdMoneda) = cc.MonIdMoneda
  -- Variante B
  AND ABS(m.MovImporte) - doc.DocTotal < -0.01
  -- Factura CONSISTENTE
  AND EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = doc.DocIdDocumento)
  AND ABS(doc.DocTotal - ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = doc.DocIdDocumento), 0)) <= 0.05
  -- Guard: una sola línea de facturación por documento
  AND (SELECT COUNT(*) FROM dbo.MovimientosCuenta m2
       WHERE m2.DocIdDocumento = doc.DocIdDocumento AND m2.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
         AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0) AND m2.MovImporte <> 0) = 1
  -- EXCLUIR MIXTOS: el cliente NO debe tener ningún desfasaje variante A ni C
  AND NOT EXISTS (
      SELECT 1
      FROM dbo.MovimientosCuenta ma
      JOIN dbo.DocumentosContables da ON da.DocIdDocumento = ma.DocIdDocumento
      JOIN dbo.CuentasCliente cca ON cca.CueIdCuenta = ma.CueIdCuenta
      WHERE cca.CliIdCliente = cc.CliIdCliente
        AND ma.MovTipo IN ('CIERRE_CICLO','VTA_CAJA') AND (ma.MovAnulado IS NULL OR ma.MovAnulado = 0) AND ma.MovImporte <> 0
        AND (da.DocEstado IS NULL OR da.DocEstado NOT LIKE '%ANULAD%')
        AND ISNULL(da.MonIdMoneda, cca.MonIdMoneda) = cca.MonIdMoneda
        AND ABS(ABS(ma.MovImporte) - da.DocTotal) > 0.01
        AND (
             ABS(ma.MovImporte) - da.DocTotal > 0.01   -- variante A
          OR NOT EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle dd WHERE dd.DocIdDocumento = da.DocIdDocumento)  -- C (sin detalle)
          OR ABS(da.DocTotal - ISNULL((SELECT SUM(dd.DcdTotal) FROM dbo.DocumentosContablesDetalle dd WHERE dd.DocIdDocumento = da.DocIdDocumento), 0)) > 0.05  -- C (header != líneas)
        )
  );

/* ---- Control ---- */
SELECT o.MovIdMovimiento, RTRIM(cli.NombreFantasia) AS Cliente,
       RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
       o.ImporteViejo, o.ImporteNuevo,
       CAST(o.ImporteNuevo - o.ImporteViejo AS DECIMAL(18,4)) AS DeudaAgregada
FROM #objetivo o
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = o.DocIdDocumento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = o.CueIdCuenta
JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
ORDER BY Cliente;

DECLARE @nDocs INT = (SELECT COUNT(*) FROM #objetivo);
DECLARE @nCli  INT = (SELECT COUNT(DISTINCT cc.CliIdCliente) FROM #objetivo o JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = o.CueIdCuenta);
PRINT CONCAT('Documentos a corregir: ', @nDocs, ' | Clientes: ', @nCli);

/* ---- Corregir = -DocTotal ---- */
UPDATE m
SET m.MovImporte       = o.ImporteNuevo,
    m.MovObservaciones = N'FIX_SALDO_DESFASAJE(B): corregido a ' + CONVERT(varchar(30), o.ImporteNuevo)
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

/* ---- Verificación ---- */
SELECT cc.CueIdCuenta, RTRIM(cli.NombreFantasia) AS Cliente, RTRIM(cc.CueTipo) AS Tipo,
       (SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = cc.CueIdCuenta AND (MovAnulado IS NULL OR MovAnulado = 0) AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoMostrado
FROM dbo.CuentasCliente cc JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #objetivo)
ORDER BY Cliente, Tipo;

DROP TABLE #objetivo;

/* Revisá control + verificación. Si está OK cambiá la línea siguiente a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
