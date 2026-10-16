/* ═══════════════════════════════════════════════════════════════════════════
   CORRECCIÓN — Posse Gutierrez Santiago (cuenta 65, US$): aplicar saldo a favor
   30-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   CAUSA RAÍZ (ver project_bug_saldoactual_duplica_orden.md)
     crearDeudaDocumento (contabilidadService.js) debía auto-consumir el saldo
     a favor del cliente al crear una deuda nueva, pero miraba
     CuentasCliente.CueSaldoActual — una columna contaminada por las órdenes
     abiertas (-$12.899,95 hoy), siempre negativa, así que el auto-consumo
     nunca se disparaba aunque el cliente tuviera plata real a favor
     ($3.462,51, verificado contra el libro mayor). Ya corregido en el código
     (usa la misma fórmula que el resto del sistema: todo menos ORDEN).

   QUÉ HACE ESTE SCRIPT
     Marca las 2 facturas vivas de Posse como cubiertas por su saldo a favor
     YA EXISTENTE — NO inserta ningún movimiento nuevo en MovimientosCuenta
     (esa plata ya está en la cuenta, solo faltaba reconocerla contra estas
     facturas puntuales). El saldo a favor mostrado seguirá en $3.462,51
     (es su crédito total real), y el pendiente de estas 2 facturas pasa a 0.
       - FA-391 (DDeIdDocumento 8561): $21,60 → $0
       - PC-2734 (DDeIdDocumento 8560): $1.005,33 → $0

   RESULTADO ESPERADO: Pendiente US$ 0,00 · A favor US$ 3.462,51 (sin cambios)
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento WHERE DDeIdDocumento IN (8560, 8561);
-- esperado: 8560 -> 1005.33 (PENDIENTE) · 8561 -> 21.60 (PENDIENTE)

BEGIN TRANSACTION;

/* ── PASO 1 — FA-391: cubierta por saldo a favor (idempotente) ─────────── */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = 0,
       DDeEstado = 'PAGADO',
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Cubierta por saldo a favor existente ($3.462,51 real en la cuenta) — el auto-consumo no se disparó por el bug de CueSaldoActual contaminado con órdenes. fix_posse_aplicar_favor_existente.sql', 500)
WHERE  DDeIdDocumento = 8561
  AND  ABS(DDeImportePendiente - 21.60) < 0.02;

PRINT CONCAT('FA-391 cubierta: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 2 — PC-2734: cubierta por saldo a favor (idempotente) ────────── */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = 0,
       DDeEstado = 'PAGADO',
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Cubierta por saldo a favor existente ($3.462,51 real en la cuenta) — el auto-consumo no se disparó por el bug de CueSaldoActual contaminado con órdenes. fix_posse_aplicar_favor_existente.sql', 500)
WHERE  DDeIdDocumento = 8560
  AND  ABS(DDeImportePendiente - 1005.33) < 0.02;

PRINT CONCAT('PC-2734 cubierta: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 3 — Verificación ─────────────────────────────────────────────── */
SELECT DDeIdDocumento, DDeImportePendiente, DDeEstado FROM dbo.DeudaDocumento WHERE DDeIdDocumento IN (8560, 8561);
-- esperado: ambas en 0 / PAGADO

SELECT ISNULL(SUM(MovImporte), 0) AS SaldoReal_sin_cambios
FROM   dbo.MovimientosCuenta
WHERE  CueIdCuenta = 65 AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');   -- esperado: 3462.5097, IGUAL que antes

/* Si ambas deudas dan 0/PAGADO y el saldo real sigue en 3462.51 →
   COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
