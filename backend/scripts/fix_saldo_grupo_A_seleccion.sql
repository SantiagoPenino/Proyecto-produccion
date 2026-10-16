/* ============================================================
   GRUPO A — SELECCIÓN de 15 clientes (todos variante A, solo baja deuda fantasma)
   Detección dinámica, filtrada a la lista de IDClientes de abajo.

   Corrige el ESTADO DE CUENTA (libro mayor) cuando la línea de facturación
   (CIERRE_CICLO/VTA_CAJA) quedó con importe MAYOR que el DocTotal de la factura.
   Fija el movimiento = -DocTotal (la factura manda). NO toca facturas.

   Por defecto ROLLBACK. Revisá el control y cambiá a COMMIT para aplicar.
   ============================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

/* ---- 1) Detectar los movimientos a corregir (solo estos clientes, solo variante A) ---- */
IF OBJECT_ID('tempdb..#objetivo') IS NOT NULL DROP TABLE #objetivo;

SELECT
    m.MovIdMovimiento, m.CueIdCuenta, doc.DocIdDocumento, doc.DocTotal,
    m.MovImporte AS ImporteViejo,
    CAST(-doc.DocTotal AS DECIMAL(18,4)) AS ImporteNuevo
INTO #objetivo
FROM dbo.MovimientosCuenta   m
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = m.DocIdDocumento
JOIN dbo.CuentasCliente      cc  ON cc.CueIdCuenta     = m.CueIdCuenta
JOIN dbo.Clientes            cli ON cli.CliIdCliente   = cc.CliIdCliente
WHERE RTRIM(cli.IDCliente) IN (
        'ELEA','Andres XU','ENZOSVR-12','GANDINI-979','JuanBordado','GIOCOTELA2025',
        'Martina Berriel','SUNDAYCLUB15','GranAventura','51814799','PUNTOGYF',
        'RodrigoFalero','nperez','GLIDE','Yesusport'
      )
  AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovImporte <> 0
  AND (doc.DocEstado IS NULL OR doc.DocEstado NOT LIKE '%ANULAD%')
  AND ISNULL(doc.MonIdMoneda, cc.MonIdMoneda) = cc.MonIdMoneda
  -- Variante A: el libro mayor facturó de MÁS
  AND ABS(m.MovImporte) - doc.DocTotal > 0.01
  -- Factura CONSISTENTE (DocTotal = suma de sus líneas)
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

/* ---- Control: qué se va a modificar ---- */
SELECT o.MovIdMovimiento, RTRIM(cli.NombreFantasia) AS Cliente,
       RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
       o.ImporteViejo, o.ImporteNuevo,
       CAST(o.ImporteViejo - o.ImporteNuevo AS DECIMAL(18,4)) AS DeudaFantasmaQuitada
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
    m.MovObservaciones  = N'FIX_SALDO_DESFASAJE: corregido a ' + CONVERT(varchar(30), o.ImporteNuevo)
                          + N' (=-DocTotal, era ' + CONVERT(varchar(30), o.ImporteViejo) + N')'
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
SELECT cc.CueIdCuenta, RTRIM(cli.NombreFantasia) AS Cliente, RTRIM(cc.CueTipo) AS Tipo,
       (SELECT SUM(MovImporte) FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = cc.CueIdCuenta AND (MovAnulado IS NULL OR MovAnulado = 0)
          AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoMostrado
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #objetivo)
ORDER BY Cliente, Tipo;

DROP TABLE #objetivo;

/* Revisá control + verificación. Si está OK cambiá la línea siguiente a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
