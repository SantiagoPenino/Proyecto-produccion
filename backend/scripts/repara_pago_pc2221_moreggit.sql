/* ═══════════════════════════════════════════════════════════════════════════
   REPARACIÓN — Pago de PC-2221 (MoreggiT) sin movimiento en cuenta  ·  27-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ PASÓ
     El 17-jul 12:43 se cobró el PC-2221 (doc 3985, US$ 16,20): existen el pago
     de caja (Pagos #53602), la transacción (Tca #4318), los recibos RC-99/RC-100
     y la deuda #6227 quedó COBRADO. Pero el movimiento 'PAGO' de la cuenta 362
     (DINERO_USD de MoreggiT) NO está: fue el MovId 20315, borrado después
     (único DELETE posible: endpoint /ordenes/eliminar-metros, ya blindado).
     Resultado: la billetera del 360 muestra US$ -158,23 en vez de -142,04
     (el cliente figura debiendo 16,20 que YA pagó).

   QUÉ HACE
     1) Reinserta el movimiento PAGO (+16,20) vía SP_RegistrarMovimiento,
        con la fecha real del cobro y vinculado al pago #53602 y al doc 3985.
     2) Marca DocPagado=1 en el doc 3985 (su deuda está 100% cobrada).
   Idempotente: si ya existe un movimiento con PagIdPago=53602, no hace nada.

   NO toca: la deuda #6227 (ya está COBRADO), el PC-2445 (deuda real, sigue viva),
   ni ningún otro cliente.

   MODO DE USO: correr PASO 0 (lectura). Si cuadra, PASO 1. Verificar PASO 2:
   la suma debe dar -142,03 → COMMIT. Si no → ROLLBACK.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT 'Pago de caja'  AS Que, PagIdPago, PagFechaPago, PagMontoPago, PagTcaIdTransaccion
FROM   dbo.Pagos WHERE PagIdPago = 53602;

SELECT 'Deuda PC-2221' AS Que, DDeIdDocumento, DDeEstado, DDeImporteOriginal, DDeImportePendiente, DDeFechaCobro
FROM   dbo.DeudaDocumento WHERE DDeIdDocumento = 6227;

SELECT 'Mov ya existe?' AS Que, COUNT(*) AS Existe
FROM   dbo.MovimientosCuenta WHERE PagIdPago = 53602;

SELECT 'Billetera USD hoy (debe dar -158.23)' AS Que,
       CAST(SUM(MovImporte) AS DECIMAL(18,2)) AS SaldoUSD
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 362
  AND  (MovAnulado IS NULL OR MovAnulado = 0)
  AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');

/* ── PASO 1 — Reparación ───────────────────────────────────────────────── */
BEGIN TRANSACTION;

IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE PagIdPago = 53602)
BEGIN
    PRINT 'El movimiento del pago #53602 ya existe: no se hace nada.';
END
ELSE
BEGIN
    DECLARE @MovId INT, @Saldo DECIMAL(18,4);
    EXEC dbo.SP_RegistrarMovimiento
        @CueIdCuenta      = 362,
        @MovTipo          = 'PAGO',
        @MovConcepto      = N'Pago deuda - PC-2221 (reposición: movimiento del cobro 17-jul borrado por error)',
        @MovImporte       = 16.20,
        @MovUsuarioAlta   = 11,            -- cajero del cobro original (Tca #4318)
        @PagIdPago        = 53602,
        @DocIdDocumento   = 3985,
        @MovObservaciones = N'DeudaDoc #6227 | Reposición del MovId 20315 eliminado. Cobro real: 17-jul-2026 12:43, RC-99. Script repara_pago_pc2221_moreggit.sql',
        @MovFecha         = '2026-07-17T12:43:14',
        @MovIdGenerado    = @MovId  OUTPUT,
        @SaldoResultante  = @Saldo  OUTPUT;
    PRINT CONCAT('Movimiento repuesto: MovId=', @MovId);

    -- El doc quedó totalmente cobrado el 17-jul: marcarlo pagado (Bandeja CFE / edición)
    UPDATE dbo.DocumentosContables
    SET    DocPagado = 1
    WHERE  DocIdDocumento = 3985 AND (DocPagado IS NULL OR DocPagado = 0);
END

/* ── PASO 2 — Verificación (debe dar -142.03: la deuda real del PC-2445,
      con 1 centavo de residuo histórico del redondeo del PC-449) ─────────── */
SELECT 'Billetera USD luego del fix' AS Que,
       CAST(SUM(MovImporte) AS DECIMAL(18,2)) AS SaldoUSD
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 362
  AND  (MovAnulado IS NULL OR MovAnulado = 0)
  AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');

/* Si el saldo da -142.03 →   COMMIT TRANSACTION;
   Si da otra cosa       →   ROLLBACK TRANSACTION;  y avisar. */
