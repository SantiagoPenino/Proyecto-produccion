/* ═══════════════════════════════════════════════════════════════════════════
   FIX — Favio Curbelo (FVR): cargo desactualizado + surplus sin aplicar
   28-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   RECONSTRUCCIÓN (con datos reales de producción, reconciliada al centavo:
   billetera −303,63 = suma exacta de los movimientos de abajo):

   BUG 1 (mismo patrón que Uniformes vym el mismo día): doc 3852 (FA-127/128)
     tiene 3 PAGO_CRUZADO (18,80+26,10+276,6602=321,5602) fechados ANTES de
     que existiera la factura — cash real que el viejo bug de vinculación del
     cierre de ciclo (ya corregido en código hoy) adoptó de otra cosa. Neto
     del documento: +316,1502 de plata sin aplicar a ninguna deuda viva.

   BUG 2 (nuevo): doc 5668 se facturó como "FA-331" CONTADO por 619,78
     (mov 25243), pero HOY el documento es "FA-332" CRÉDITO por 459,57
     (= DocTotal real, = DDeImporteOriginal de la deuda #8224 viva). Alguien
     editó la factura (contado→crédito, bajó el total) y el cargo del libro
     mayor nunca se actualizó al nuevo importe. Sobrefacturado por 160,21.

   QUÉ HACE
     1) Corrige el cargo del doc 5668 a -459,57 (= su DocTotal real).
     2) Aplica el surplus de 316,15 (bug 1) a la deuda viva de FA-332 (#8224)
        vía PEPS: pendiente baja de 459,57 a 143,42.

   RESULTADO ESPERADO: billetera Y deuda viva de Favio Curbelo quedan
   AMBAS en US$ 143,42 — el monto real que debe.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT MovIdMovimiento, MovTipo, MovImporte, DocIdDocumento, MovAnulado
FROM   dbo.MovimientosCuenta
WHERE  MovIdMovimiento = 25243;

SELECT DDeIdDocumento, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado
FROM   dbo.DeudaDocumento
WHERE  DDeIdDocumento = 8224;

BEGIN TRANSACTION;

/* ── PASO 1 — Corregir el cargo desactualizado del doc 5668 ────────────── */
UPDATE dbo.MovimientosCuenta
SET    MovImporte = -459.57,
       MovConcepto = 'Facturado (E-FACTURA CREDITO FA-332)',
       MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | Cargo corregido de -619,78 a -459,57: la factura se edito (contado FA-331 -> credito FA-332, total 619,78 -> 459,57) y este cargo nunca se actualizo. fix_favio_curbelo_cargo_y_surplus.sql', 500)
WHERE  MovIdMovimiento = 25243
  AND  ABS(MovImporte + 619.78) < 0.01;   -- idempotente

PRINT CONCAT('Cargo doc 5668 corregido: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 2 — Aplicar el surplus de 316,15 (doc 3852) a la deuda FA-332 ── */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = 143.4198,
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Aplicados 316,15 de cruces de moneda reales sin vincular (mismo bug que Uniformes vym, doc 3852/FA-127-128) -> pendiente real 143,42. fix_favio_curbelo_cargo_y_surplus.sql', 500)
WHERE  DDeIdDocumento = 8224
  AND  ABS(DDeImportePendiente - 459.57) < 0.01;

PRINT CONCAT('Deuda FA-332 realineada: ', @@ROWCOUNT);   -- esperado 1

/* ── PASO 3 — Verificación: billetera Y deuda deben coincidir en 143,42 ── */
SELECT CAST(SUM(CASE WHEN m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      THEN m.MovImporte END) AS DECIMAL(18,2)) AS BilleteraDespues
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN   dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE  LTRIM(RTRIM(c.IDCliente)) = 'FVR' AND cc.CueTipo = 'DINERO_USD';

SELECT DDeIdDocumento, DDeImportePendiente, DDeEstado FROM dbo.DeudaDocumento WHERE DDeIdDocumento = 8224;

/* Si ambas dan 143,42 → COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
