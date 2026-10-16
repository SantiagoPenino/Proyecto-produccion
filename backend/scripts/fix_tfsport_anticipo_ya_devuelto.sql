/* ═══════════════════════════════════════════════════════════════════════════
   CORRECCIÓN — Tamara Flores (TF SPORT, cuenta 68 US$): anticipo ya devuelto
   30-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   CONTEXTO (confirmado con el negocio)
     El 23/06 se registró un anticipo real de US$4.363,43 (recibo RC-11). Al
     día siguiente se cancelaron 3 pedidos por un monto similar (PC-1117
     $2.920,68 + A-13 $4.377,98 + A-14 $2.169,87) y esa plata se le devolvió
     a la clienta POR FUERA DEL SISTEMA. Esa devolución nunca quedó asentada:
     no hay egreso de caja, ni movimiento de reverso/devolución, ni nota en
     los 3 documentos anulados que la explique (se buscó explícitamente y no
     aparece en ningún lado).

     Como el anticipo seguía "vivo" en el sistema, se fue consumiendo solo
     (sin ningún pago real de por medio) contra facturas posteriores:
       - PC-1137 (doc 1758, $5.241,96): quedó con pendiente $4.491,96 (de un
         arreglo previo que ya había marcado esto "a validar por
         administración" — repara_casos_27jul_tanda2.sql)
       - PC-2705 (doc 5886, $212,81): quedó con pendiente $39,55, sin ninguna
         nota que lo explique

     El negocio confirmó: no hay nada a favor de la clienta. Debe el monto
     completo de sus 2 facturas vivas: $5.241,96 + $212,81 = $5.454,77.

   QUÉ HACE
     1. Anula el movimiento ANTICIPO (#6983, $4.363,43) — deja de contar como
        crédito disponible en cualquier cálculo de saldo (todas las consultas
        del sistema ya excluyen MovAnulado=1).
     2. Restaura PC-1137 a su pendiente completo ($5.241,96).
     3. Restaura PC-2705 a su pendiente completo ($212,81).
     4. Realinea CuentasCliente.CueSaldoActual (columna cacheada) al valor
        real recalculado, para que quede consistente en todos los reportes.

   RESULTADO ESPERADO: Saldos (Panel 360) = US$ -5.454,77 · Pendiente US$
   5.454,77 · sin nada a favor.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT MovIdMovimiento, MovFecha, MovTipo, MovImporte, MovAnulado
FROM   dbo.MovimientosCuenta WHERE MovIdMovimiento = 6983;   -- esperado: ANTICIPO 4363.43, no anulado

SELECT DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento WHERE DDeIdDocumento IN (2890, 8389);
-- esperado: 2890 -> 4491.96 (PARCIAL) · 8389 -> 39.55 (PENDIENTE)

BEGIN TRANSACTION;

/* ── PASO 1 — Anular el anticipo (idempotente) ─────────────────────────── */
UPDATE dbo.MovimientosCuenta
SET    MovAnulado = 1,
       MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | ANULADO: la plata de este anticipo se le devolvió a la clienta por fuera del sistema el 24/06 al cancelarse PC-1117/A-13/A-14 — nunca se asentó esa devolución. Confirmado por el negocio 30-jul-2026. fix_tfsport_anticipo_ya_devuelto.sql', 500)
WHERE  MovIdMovimiento = 6983
  AND  (MovAnulado IS NULL OR MovAnulado = 0);

PRINT CONCAT('Anticipo anulado: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 2 — Restaurar PC-1137 a pendiente completo (idempotente) ─────── */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = 5241.96,
       DDeEstado = 'PENDIENTE',
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | REVERTIDO: el anticipo que cubría estos 750 fue devuelto a la clienta por fuera del sistema — no es un pago real. Pendiente vuelve al monto completo. fix_tfsport_anticipo_ya_devuelto.sql', 500)
WHERE  DDeIdDocumento = 2890
  AND  ABS(DDeImportePendiente - 4491.96) < 0.02;

PRINT CONCAT('PC-1137 restaurada: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 3 — Restaurar PC-2705 a pendiente completo (idempotente) ─────── */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = 212.81,
       DDeEstado = 'PENDIENTE',
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | REVERTIDO: mismo caso que PC-1137, cubierto sin querer por el anticipo ya devuelto. Pendiente vuelve al monto completo. fix_tfsport_anticipo_ya_devuelto.sql', 500)
WHERE  DDeIdDocumento = 8389
  AND  ABS(DDeImportePendiente - 39.55) < 0.02;

PRINT CONCAT('PC-2705 restaurada: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 4 — Realinear CueSaldoActual (columna cacheada) ──────────────── */
UPDATE dbo.CuentasCliente
SET    CueSaldoActual = (
         SELECT ISNULL(SUM(MovImporte), 0) FROM dbo.MovimientosCuenta
         WHERE  CueIdCuenta = 68 AND (MovAnulado IS NULL OR MovAnulado = 0)
           AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
       )
WHERE  CueIdCuenta = 68;

/* ── PASO 5 — Verificación ─────────────────────────────────────────────── */
SELECT ISNULL(SUM(MovImporte), 0) AS SaldoMostrado_final
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 68 AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');   -- esperado: -5454.77

SELECT CueIdCuenta, CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = 68;   -- esperado: -5454.77

SELECT DDeIdDocumento, DDeImportePendiente, DDeEstado FROM dbo.DeudaDocumento WHERE DDeIdDocumento IN (2890, 8389);
-- esperado: 5241.96 / 212.81, ambas PENDIENTE

/* Si el saldo final da -5454.77 y las 2 deudas dan su monto completo →
   COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
