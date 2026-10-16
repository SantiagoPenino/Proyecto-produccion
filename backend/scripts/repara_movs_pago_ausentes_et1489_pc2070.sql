/* ═══════════════════════════════════════════════════════════════════════════
   BUCKET B — MOVIMIENTO REALMENTE AUSENTE: reponer 2 movs PAGO  ·  27-jul-2026
   Auditoría "cobro sin movimiento que lo respalde" (mismo caso que PC-2221
   MoreggiT: cobro real en caja con Pago registrado, pero SIN movimiento en
   MovimientosCuenta — el cliente figura debiendo plata que YA pagó).
   ───────────────────────────────────────────────────────────────────────────
   ⚠ REQUISITO PREVIO EN PROD: el SP_RegistrarMovimiento debe aceptar @MovFecha
     (correr antes add_MovFecha_SP_RegistrarMovimiento.sql si aún no se corrió).

   CASO 1 — ET-1489, Uniformes vym (cli 154, doc 3100, US$ 2.926,87)
     13-jul 16:09: cobro "Pago de deudas combinadas" Tca 3732, Pago #52938
     (COBRO US$ 2.926,87). La deuda #4964 quedó COBRADO, pero NO existe ningún
     movimiento PAGO en la cuenta 73 (DINERO_USD). Se repone +2.926,87.

   CASO 2 — PC-2070, Támara flores (cli 5216, doc 3961, US$ 352,84)
     Cobro combinado Tca 4645, Pago #54000 (COBRO US$ 352,84, 15-jul 14:35).
     Su hermano de la misma sesión (Pago #53999, $14.559,62 de PC-2071) SÍ
     generó movimiento (el 21600); el de US$ 352,84 no. La deuda #6207 quedó
     COBRADO sin respaldo en la cuenta 68 (DINERO_USD). Se repone +352,84.

   Idempotente: si ya existe un movimiento con ese PagIdPago, no hace nada.
   NO toca deudas (ya están COBRADO, correcto) ni otros clientes.

   OJO al verificar vym: la cuenta 73 queda con saldo POSITIVO (~ +1.585,19).
   No lo genera este script: ese cliente tiene además un DOBLE cobro del
   E-Ticket ET-2152 (doc 4074: deuda de 1.221,38 con dos pagos de 1.221,38),
   fuera del alcance de esta reparación.

   MODO DE USO: PASO 0 (lectura). Si cuadra, PASO 1 y verificar PASO 2:
   cta 73 pasa de -1.341,68 a +1.585,19 · cta 68 pasa de -1.231,37 a -878,53
   (valores al 27-jul; si hubo movimiento nuevo del cliente, ajustar la cuenta).
   Si cierra → COMMIT. Si no → ROLLBACK.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT 'Pagos de caja' AS Que, PagIdPago, CONVERT(varchar(19),PagFechaPago,120) AS Fecha,
       PagMontoPago, PagIdMonedaPago, PagUsuarioAlta, PagTcaIdTransaccion
FROM dbo.Pagos WHERE PagIdPago IN (52938, 54000);

SELECT 'Deudas (deben estar COBRADO)' AS Que, DDeIdDocumento, DocIdDocumento, DDeEstado,
       DDeImporteOriginal, DDeImportePendiente
FROM dbo.DeudaDocumento WHERE DDeIdDocumento IN (4964, 6207);

SELECT 'Mov ya existe?' AS Que, PagIdPago, COUNT(*) AS Existe
FROM dbo.MovimientosCuenta WHERE PagIdPago IN (52938, 54000) GROUP BY PagIdPago;

SELECT 'Saldo vivo ANTES' AS Que, CueIdCuenta,
       CAST(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                      AND (MovAnulado IS NULL OR MovAnulado = 0)
                     THEN MovImporte ELSE 0 END) AS DECIMAL(18,2)) AS Saldo
FROM dbo.MovimientosCuenta WHERE CueIdCuenta IN (73, 68) GROUP BY CueIdCuenta;

/* ── PASO 1 — Reposición ───────────────────────────────────────────────── */
BEGIN TRANSACTION;

-- CASO 1: ET-1489 (vym)
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE PagIdPago = 52938)
    PRINT 'CASO 1: el movimiento del pago #52938 ya existe, no se hace nada.';
ELSE
BEGIN
    DECLARE @Mov1 INT, @Sal1 DECIMAL(18,4);
    EXEC dbo.SP_RegistrarMovimiento
        @CueIdCuenta      = 73,
        @MovTipo          = 'PAGO',
        @MovConcepto      = N'Pago deuda - ET-1489 (reposición: el cobro del 13-jul no tenía movimiento en cuenta)',
        @MovImporte       = 2926.87,
        @MovUsuarioAlta   = 1,             -- cajero del cobro original (Pago #52938)
        @PagIdPago        = 52938,
        @DocIdDocumento   = 3100,
        @MovObservaciones = N'DeudaDoc #4964 | Reposición del movimiento ausente del cobro Tca 3732 / Pago #52938 (13-jul-2026 16:09). Script repara_movs_pago_ausentes_et1489_pc2070.sql',
        @MovFecha         = '2026-07-13T16:09:28',
        @MovIdGenerado    = @Mov1 OUTPUT,
        @SaldoResultante  = @Sal1 OUTPUT;
    PRINT CONCAT('CASO 1: movimiento repuesto, MovId=', @Mov1);

    UPDATE dbo.DocumentosContables SET DocPagado = 1
    WHERE DocIdDocumento = 3100 AND (DocPagado IS NULL OR DocPagado = 0);
END

-- CASO 2: PC-2070 (Támara flores)
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE PagIdPago = 54000)
    PRINT 'CASO 2: el movimiento del pago #54000 ya existe, no se hace nada.';
ELSE
BEGIN
    DECLARE @Mov2 INT, @Sal2 DECIMAL(18,4);
    EXEC dbo.SP_RegistrarMovimiento
        @CueIdCuenta      = 68,
        @MovTipo          = 'PAGO',
        @MovConcepto      = N'Pago deuda - PC-2070 (reposición: el cobro no tenía movimiento en cuenta)',
        @MovImporte       = 352.84,
        @MovUsuarioAlta   = 11,            -- cajero del cobro original (Pago #54000)
        @PagIdPago        = 54000,
        @DocIdDocumento   = 3961,
        @MovObservaciones = N'DeudaDoc #6207 | Reposición del movimiento ausente del cobro Tca 4645 / Pago #54000 (15-jul-2026 14:35). Script repara_movs_pago_ausentes_et1489_pc2070.sql',
        @MovFecha         = '2026-07-15T14:35:05',
        @MovIdGenerado    = @Mov2 OUTPUT,
        @SaldoResultante  = @Sal2 OUTPUT;
    PRINT CONCAT('CASO 2: movimiento repuesto, MovId=', @Mov2);

    UPDATE dbo.DocumentosContables SET DocPagado = 1
    WHERE DocIdDocumento = 3961 AND (DocPagado IS NULL OR DocPagado = 0);
END

/* ── PASO 2 — Verificación ─────────────────────────────────────────────── */
SELECT 'Saldo vivo DESPUÉS' AS Que, CueIdCuenta,
       CAST(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                      AND (MovAnulado IS NULL OR MovAnulado = 0)
                     THEN MovImporte ELSE 0 END) AS DECIMAL(18,2)) AS Saldo
FROM dbo.MovimientosCuenta WHERE CueIdCuenta IN (73, 68) GROUP BY CueIdCuenta;

/* cta 73 ≈ +1585.19 (ver nota del encabezado) y cta 68 ≈ -878.53
   → COMMIT TRANSACTION;    si no → ROLLBACK TRANSACTION;  y avisar. */
