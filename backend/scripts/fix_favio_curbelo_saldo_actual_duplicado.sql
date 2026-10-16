/* ═══════════════════════════════════════════════════════════════════════════
   CORRECCIÓN — Favio Curbelo (cuenta 472, US$): alinear billetera a lo que debe
   29-jul-2026 (v2 — reemplaza la versión anterior de este mismo script)
   ───────────────────────────────────────────────────────────────────────────
   CAUSA RAÍZ DEL DESCUADRE ORIGINAL (ver project_bug_saldoactual_duplica_orden.md)
     dbo.SP_RegistrarMovimiento resta de CueSaldoActual CUALQUIER movimiento,
     incluidas las órdenes (MovTipo='ORDEN'/'ORDEN_ANTICIPO'), cosa que el resto
     del sistema da por hecho que NO pasa. Además, al facturar FA-128 el cierre
     de ciclo no descontó $321,56 que Favio ya había pagado por adelantado (vía
     cruces de moneda de 3 órdenes), así que terminó entrando más plata de la
     que hacía falta ($316,15 de sobrante real, con recibo RC-14 de respaldo).
     Esto es un bug de PROCEDIMIENTO que afecta a TODOS los clientes con ciclos
     ya facturados, no solo a Favio — queda pendiente para otra instancia.

   DECISIÓN DEL NEGOCIO (29-jul-2026)
     El sobrante de $316,15, aunque es plata real, NO se expone como "saldo a
     favor": la cuenta debe mostrar UN SOLO número — lo que debe (FA-332,
     $459,57) — sin desdoblarlo en pendiente + a favor.

   QUÉ HACE
     Fija CueSaldoActual de la cuenta 472 en -(pendiente real de sus deudas
     vivas) = -459,57 (hoy, solo FA-332). Si el día de mañana FA-332 se cobra
     o cambia el pendiente vivo de la cuenta, este mismo script (re-ejecutado)
     recalcula solo, porque toma el valor de dbo.DeudaDocumento en vez de un
     número fijo.
     NO modifica MovimientosCuenta ni DeudaDocumento — el sobrante de 316,15
     sigue en el historial de movimientos (auditable), solo deja de reflejarse
     en el saldo mostrado.

   RESULTADO ESPERADO: CueSaldoActual (cuenta 472) = -459,57
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT CueIdCuenta, CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = 472;

SELECT CAST(ISNULL(SUM(DDeImportePendiente), 0) AS DECIMAL(18,4)) AS PendienteReal_esperado
FROM   dbo.DeudaDocumento
WHERE  CueIdCuenta = 472;

BEGIN TRANSACTION;

/* ── PASO 1 — Fijar CueSaldoActual = -(pendiente vivo de la cuenta) ────── */
UPDATE dbo.CuentasCliente
SET    CueSaldoActual = -1 * (
         SELECT ISNULL(SUM(DDeImportePendiente), 0)
         FROM   dbo.DeudaDocumento
         WHERE  CueIdCuenta = 472
       )
WHERE  CueIdCuenta = 472
  AND  ABS(CueSaldoActual - (
         SELECT -1 * ISNULL(SUM(DDeImportePendiente), 0) FROM dbo.DeudaDocumento WHERE CueIdCuenta = 472
       )) > 0.01;   -- idempotente: no-op si ya está alineado

PRINT CONCAT('Cuenta 472 corregida: ', @@ROWCOUNT);   -- esperado 1 (0 si ya se había corrido)

/* ── PASO 2 — Verificación ─────────────────────────────────────────────── */
SELECT CueIdCuenta, CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = 472;   -- esperado: -459.57

/* Si CueSaldoActual = -459.57 → COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
