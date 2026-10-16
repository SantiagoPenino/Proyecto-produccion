/* ============================================================
   FIX SALDOS CR SPORT (CR-755)  —  caso específico, 27/07/2026

   Qué arregla (con evidencia del análisis del 27/07):
     1) CueSaldoActual guardado desincronizado de los movimientos vivos:
          - DINERO_UYU: guardado 0, real +8.532 (VEN-2220 -5.742 y EMB-4252 -2.790
            se ANULARON sin devolver el saldo guardado). Esos $8.532 a favor
            existen pero la cascada de cobertura automática lee el guardado (0)
            y nunca los cruza.
          - DINERO_USD: guardado con drift de -12,93 vs movimientos.
        -> Se recalcula CueSaldoActual (y MovSaldoPosterior) desde los movs vivos.
     2) PC-2004: DocEstado='PAGADO' pero DocPagado=0, deuda VIVA por 800 y CERO
        pagos registrados (ni MovimientosCuenta ni caja). El estado miente.
        -> Se vuelve a 'EMITIDO' (solo si sigue sin tener ningún pago vivo).

   Qué NO arregla (ver sección 3, comentada):
     - Coberturas cruzadas desde $ sin imputar a deudas (422,65 US$): bajaron el
       saldo pero la deuda de PC-1361 sigue por el precio pleno. La factura
       incluyó SB-64451 y DTF-2026 completas sin netear esos pagos -> corresponde
       descontarlos de la deuda. Queda COMENTADO para decidirlo aparte.
   Nota (verificado línea por línea el 27/07): la diferencia órdenes vs factura
   (PC-1361 5.766,78->3.204,38 / PC-1878 / PC-2035) NO es plata sin facturar:
   son reprecios del cierre que no se propagan a los movs ORDEN (bug conocido).
   Las facturas están bien; no hay nada que re-facturar. En PC-1878 además las
   líneas 'VEN-2220' (141,52) y 'Bordado' (68,82) son las dos órdenes en pesos
   anuladas, convertidas a US$ (por eso se anularon en la cuenta UYU).

   Correr, revisar los SELECT de control y cambiar ROLLBACK -> COMMIT.
   Idempotente: recalcula desde los movimientos, correrlo 2 veces da lo mismo.
   ============================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @CliId INT = (SELECT TOP 1 CliIdCliente FROM dbo.Clientes WHERE RTRIM(IDCliente) = 'CR-755');
PRINT CONCAT('CR SPORT -> CliIdCliente = ', ISNULL(CONVERT(varchar(20), @CliId), 'NO ENCONTRADO'));
IF @CliId IS NULL BEGIN ROLLBACK TRANSACTION; RETURN; END;

/* ---- CONTROL INICIAL: guardado vs recalculado por cuenta ---- */
SELECT 'ANTES' AS Etapa, cc.CueIdCuenta, RTRIM(cc.CueTipo) AS Tipo,
       CAST(cc.CueSaldoActual AS DECIMAL(18,2)) AS SaldoGuardado,
       CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0) AS DECIMAL(18,2)) AS SaldoPorMovs
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @CliId
ORDER BY cc.CueIdCuenta;

/* ============================================================
   1) Resincronizar CueSaldoActual + MovSaldoPosterior desde los movs vivos
   ============================================================ */
;WITH ord AS (
    SELECT mc.MovIdMovimiento,
           SUM(mc.MovImporte) OVER (PARTITION BY mc.CueIdCuenta
                                    ORDER BY mc.MovFecha, mc.MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
    FROM dbo.MovimientosCuenta mc
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = mc.CueIdCuenta
    WHERE cc.CliIdCliente = @CliId
      AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
)
UPDATE mc SET mc.MovSaldoPosterior = ord.run
FROM dbo.MovimientosCuenta mc JOIN ord ON ord.MovIdMovimiento = mc.MovIdMovimiento;

UPDATE cc SET cc.CueSaldoActual = x.s
FROM dbo.CuentasCliente cc
JOIN (SELECT mc.CueIdCuenta, SUM(mc.MovImporte) AS s
      FROM dbo.MovimientosCuenta mc
      WHERE (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
      GROUP BY mc.CueIdCuenta) x ON x.CueIdCuenta = cc.CueIdCuenta
WHERE cc.CliIdCliente = @CliId;

/* ============================================================
   2) PC-2004: DocEstado 'PAGADO' -> 'EMITIDO'
      Guard: solo si sigue sin DocPagado, con deuda viva y sin ningún pago vivo.
   ============================================================ */
UPDATE doc
SET doc.DocEstado = 'EMITIDO'
FROM dbo.DocumentosContables doc
WHERE doc.CliIdCliente = @CliId
  AND RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) = 'PC-2004'
  AND doc.DocEstado = 'PAGADO'
  AND ISNULL(doc.DocPagado, 0) = 0
  AND EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd
              WHERE dd.DocIdDocumento = doc.DocIdDocumento
                AND dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
                AND dd.DDeImportePendiente > 0.01)
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                  WHERE m.DocIdDocumento = doc.DocIdDocumento
                    AND m.MovTipo IN ('PAGO','COBRO')
                    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0));
PRINT CONCAT('PC-2004 corregido: ', @@ROWCOUNT, ' fila(s) (0 = ya estaba bien o apareció un pago).');

/* ============================================================
   3) (COMENTADO — DECISIÓN) Imputar las coberturas cruzadas a la deuda PC-1361
      Los PAGO_CRUZADO +277,40 y +160,07 bajaron el saldo pero solo 14,82 entró
      a la deuda. Si se decide que la deuda de PC-1361 debe reflejarlas:
      descontaría ~422,65 del pendiente (3.189,56 -> 2.766,91).
      OJO: si en cambio se va a RE-FACTURAR PC-1361 (salió por 3.204,38 con
      órdenes por 5.766,78), resolver eso primero y NO tocar la deuda acá.

-- UPDATE dd
-- SET dd.DDeImportePendiente = dd.DDeImportePendiente - 422.65,
--     dd.DDeEstado = CASE WHEN dd.DDeImportePendiente - 422.65 <= 0.01 THEN 'CANCELADA' ELSE 'PARCIAL' END,
--     dd.DDeObservaciones = ISNULL(dd.DDeObservaciones,'') + ' | FIX 27/07/2026: imputadas coberturas PAGO_CRUZADO +277,40 y +160,07 (neto 422,65) que ya estaban acreditadas en el saldo'
-- FROM dbo.DeudaDocumento dd
-- JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = dd.DocIdDocumento
-- WHERE doc.CliIdCliente = @CliId
--   AND RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) = 'PC-1361'
--   AND dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
--   AND dd.DDeImportePendiente >= 422.65;
   ============================================================ */

/* ---- VERIFICACIÓN FINAL ---- */
SELECT 'DESPUES' AS Etapa, cc.CueIdCuenta, RTRIM(cc.CueTipo) AS Tipo,
       CAST(cc.CueSaldoActual AS DECIMAL(18,2)) AS SaldoGuardado,
       CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0) AS DECIMAL(18,2)) AS SaldoPorMovs,
       CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)) AS SaldoPanel360
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @CliId
ORDER BY cc.CueIdCuenta;

SELECT RTRIM(doc.DocSerie)+'-'+RTRIM(doc.DocNumero) AS Doc, doc.DocEstado, doc.DocPagado,
       dd.DDeEstado, CAST(dd.DDeImportePendiente AS DECIMAL(18,2)) AS Pendiente
FROM dbo.DeudaDocumento dd
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
LEFT JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = dd.DocIdDocumento
WHERE cc.CliIdCliente = @CliId
ORDER BY dd.DDeIdDocumento;

/* Revisá control + verificación. Si está OK cambiá la línea siguiente a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<<<<<< cambiar a COMMIT TRANSACTION; para aplicar
