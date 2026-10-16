/* ============================================================
   GRUPO B (DINÁMICO) — SUBE EL SALDO PARA IGUALAR LA FACTURA
   Detección dinámica (sin IDs fijos). Reemplaza al grupo_B viejo (06/07, hardcodeado).

   Corrige el ESTADO DE CUENTA cuando la línea de facturación (CIERRE_CICLO/VTA_CAJA)
   quedó con un importe MENOR que el total de la factura (ledger facturó de MENOS por un
   cambio de precio post-cierre que no se propagó). NO toca ninguna factura.

   *** ATENCION *** Esto AGREGA deuda (o quita saldo a favor). Revisá el control caso por
   caso antes de COMMIT.

   Criterio Grupo B (autodetectado):
     - la factura NO está anulada y es de la misma moneda que la cuenta
     - |MovImporte| - DocTotal < -0.01   (el libro mayor facturó de MENOS)
     - factura CONSISTENTE: DocTotal = suma de sus líneas de detalle (<= 0.05)
     - el documento tiene UNA sola línea de facturación (evita doble edición)

   Por defecto hace ROLLBACK. Revisá los SELECT de control y cambiá a COMMIT para aplicar.
   ============================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

/* ---- 1) Detectar los movimientos a corregir ---- */
IF OBJECT_ID('tempdb..#objetivo') IS NOT NULL DROP TABLE #objetivo;

SELECT
    m.MovIdMovimiento,
    m.CueIdCuenta,
    doc.DocIdDocumento,
    doc.DocTotal,
    m.MovImporte              AS ImporteViejo,
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
  -- Grupo B: el libro mayor facturó de MENOS
  AND ABS(m.MovImporte) - doc.DocTotal < -0.01
  -- Factura CONSISTENTE (total = suma de sus líneas)
  AND EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = doc.DocIdDocumento)
  AND ABS(doc.DocTotal - ISNULL((
        SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d
        WHERE d.DocIdDocumento = doc.DocIdDocumento), 0)) <= 0.05
  -- Guard: una sola línea de facturación por documento
  AND (SELECT COUNT(*) FROM dbo.MovimientosCuenta m2
       WHERE m2.DocIdDocumento = doc.DocIdDocumento
         AND m2.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
         AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
         AND m2.MovImporte <> 0) = 1;

/* ---- Control: qué se va a modificar (revisar: acá se AGREGA deuda) ---- */
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
DECLARE @nCtas INT = (SELECT COUNT(DISTINCT CueIdCuenta) FROM #objetivo);
PRINT CONCAT('Documentos a corregir: ', @nDocs, ' | Cuentas: ', @nCtas);

/* ---- 2) Corregir el importe de la línea de facturación = -DocTotal ---- */
UPDATE m
SET m.MovImporte        = o.ImporteNuevo,
    m.MovObservaciones  = N'FIX_SALDO_DESFASAJE(B): importe corregido a ' + CONVERT(varchar(30), o.ImporteNuevo)
                          + N' (=-DocTotal factura, era ' + CONVERT(varchar(30), o.ImporteViejo) + N')'
FROM dbo.MovimientosCuenta m
JOIN #objetivo o ON o.MovIdMovimiento = m.MovIdMovimiento;

/* ---- 3) Recomputar el saldo corrido (MovSaldoPosterior) de las cuentas afectadas ---- */
;WITH ord AS (
    SELECT mc.MovIdMovimiento,
           SUM(mc.MovImporte) OVER (PARTITION BY mc.CueIdCuenta
                                    ORDER BY mc.MovFecha, mc.MovIdMovimiento
                                    ROWS UNBOUNDED PRECEDING) AS run
    FROM dbo.MovimientosCuenta mc
    WHERE mc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #objetivo)
      AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
)
UPDATE mc SET mc.MovSaldoPosterior = ord.run
FROM dbo.MovimientosCuenta mc
JOIN ord ON ord.MovIdMovimiento = mc.MovIdMovimiento;

/* ---- 4) Recomputar el CueSaldoActual almacenado ---- */
UPDATE cc SET cc.CueSaldoActual = x.s
FROM dbo.CuentasCliente cc
JOIN (
    SELECT mc.CueIdCuenta, SUM(mc.MovImporte) AS s
    FROM dbo.MovimientosCuenta mc
    WHERE mc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #objetivo)
      AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
    GROUP BY mc.CueIdCuenta
) x ON x.CueIdCuenta = cc.CueIdCuenta;

/* ---- 5) Verificación: saldo mostrado (sin ORDEN) por cuenta afectada ---- */
SELECT cc.CueIdCuenta, RTRIM(cli.NombreFantasia) AS Cliente,
       (SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = cc.CueIdCuenta AND (MovAnulado IS NULL OR MovAnulado = 0)
          AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoMostrado
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #objetivo)
ORDER BY Cliente;

DROP TABLE #objetivo;

/* Revisá los resultados. Si están OK cambiá la línea siguiente a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
