/* ═══════════════════════════════════════════════════════════════════════════
   FIX — Cargo faltante por precio editado en cierre: PC-412 (Uniformes vym)
   28-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ PASA
     Mismo bug que Mrivero-745 (project_bug_deuda_neteo_cierreciclo.md):
     un ajuste manual de precio en el cierre de ciclo no se propaga a
     MovimientosCuenta. Acá vym mostraba US$ 363,81 "a favor" que en
     realidad no es un anticipo:

       Doc real detrás del cargo (mov 3067, "FA-4"): PC-412 (doc 667)
       Suma de las 7 órdenes que se cerraron:         427,03
       Cargo que quedó en la cuenta (CIERRE_CICLO):   -427,03  (= las órdenes)
       Total REAL del documento PC-412:                790,84
       Lo que el cliente PAGÓ:                          790,84  (correcto)
       Diferencia (cargo que nunca se registró):        363,81

     El cliente pagó bien lo que decía su factura; lo que falta es el cargo
     de esa diferencia en el libro mayor (alguien subió el precio en el
     cierre y el ajuste no bajó a MovimientosCuenta).

   QUÉ HACE
     Repone el cargo faltante de -363,81 (MovTipo AJUSTE, vinculado al doc 667,
     fecha del cierre original 16-jun). Idempotente (no duplica si ya existe
     un AJUSTE para este doc).

   VALIDADO EN LOCAL: vym USD pasó de +363,81 "a favor" a 0,00 exacto.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT MovIdMovimiento, MovTipo, MovImporte, DocIdDocumento, CONVERT(varchar(16), MovFecha, 120) AS Fecha
FROM   dbo.MovimientosCuenta
WHERE  DocIdDocumento = 667 AND (MovAnulado IS NULL OR MovAnulado = 0);

SELECT CAST(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado = 0)
                      THEN MovImporte END) AS DECIMAL(18,2)) AS BilleteraAntes
FROM   dbo.MovimientosCuenta WHERE CueIdCuenta = 73;

BEGIN TRANSACTION;

/* ── PASO 1 — Reponer el cargo faltante ────────────────────────────────── */
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE DocIdDocumento = 667 AND MovTipo = 'AJUSTE')
    PRINT 'El ajuste para el doc 667 ya existe, no se hace nada.';
ELSE
BEGIN
    DECLARE @Mov INT, @Sal DECIMAL(18,4);
    EXEC dbo.SP_RegistrarMovimiento
        @CueIdCuenta      = 73,
        @MovTipo          = 'AJUSTE',
        @MovConcepto      = N'Ajuste PC-412: cargo faltante por precio editado en el cierre (factura 790,84 vs 427,03 de las ordenes originales)',
        @MovImporte       = -363.81,
        @MovUsuarioAlta   = 1,
        @DocIdDocumento   = 667,
        @MovObservaciones = N'Mismo bug que Mrivero-745 (guardarPrecios/cierre no propaga el ajuste de precio a MovimientosCuenta). El cliente pago el total real (790,84); faltaba este cargo para que el libro mayor coincida. fix_ajuste_precio_pc412_vym.sql',
        @MovFecha         = '2026-06-16T17:24:00',
        @MovIdGenerado    = @Mov OUTPUT, @SaldoResultante = @Sal OUTPUT;
    PRINT CONCAT('Ajuste repuesto, MovId=', @Mov);
END

/* ── PASO 2 — Verificación: vym USD debe quedar en 0,00 ────────────────── */
SELECT CAST(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado = 0)
                      THEN MovImporte END) AS DECIMAL(18,2)) AS BilleteraDespues
FROM   dbo.MovimientosCuenta WHERE CueIdCuenta = 73;

/* Si da 0.00 → COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
