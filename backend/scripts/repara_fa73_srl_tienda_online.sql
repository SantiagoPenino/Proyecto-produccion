/* ═══════════════════════════════════════════════════════════════════════════
   REPARACIÓN — FA-73 SRL TIENDA ONLINE (doc 3429)  ·  27-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ PASÓ
     FA-73 nació el 09-jul 13:35 a CRÉDITO en USD: cargo −7.100 en la cuenta
     USD (71). A las 13:41 se editó: moneda → UYU y crédito → CONTADO.
     El editarFactura viejo de prod insertó el PAGO +7.100 en la cuenta UYU
     nueva (1596, creada en ese momento) y borró la deuda, pero NO migró el
     cargo: quedó varado en la cuenta USD. Resultado: USD "debe" 7.100 y UYU
     tiene 7.100 "a favor" — ambos falsos. La factura es CONTADO, PAGADA y
     aceptada por DGI: el neto real es 0 en las dos monedas.
     (El fix de código —migración de movimientos al cambiar moneda— ya está
     en cfeController local, pendiente de deploy.)

   QUÉ HACE
     Mueve el cargo (mov 15989) de la cuenta 71 (USD) a la 1596 (UYU), donde
     ya vive su pago. Ajusta CueSaldoActual de ambas cuentas por consistencia.

   VERIFICACIÓN (PASO 2): ambas billeteras del cliente 644 deben quedar en 0.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

/* ── PASO 0 — Estado actual (solo lectura) ─────────────────────────────── */
SELECT MovIdMovimiento, CueIdCuenta, MovTipo, MovImporte, LEFT(MovConcepto,50) AS Conc
FROM   dbo.MovimientosCuenta
WHERE  DocIdDocumento = 3429 AND (MovAnulado IS NULL OR MovAnulado = 0);

BEGIN TRANSACTION;

/* ── PASO 1 — Migrar el cargo a la cuenta de la moneda del documento ────── */
UPDATE dbo.MovimientosCuenta
SET    CueIdCuenta = 1596,
       MovObservaciones = LEFT(ISNULL(MovObservaciones,'') +
         ' | Migrado de cuenta 71 (USD) a 1596 (UYU): la edición del 09-jul cambió la moneda del doc pero dejó el cargo en la cuenta vieja. repara_fa73_srl_tienda_online.sql', 500)
WHERE  MovIdMovimiento = 15989 AND CueIdCuenta = 71;

PRINT CONCAT('Cargo migrado: ', @@ROWCOUNT);   -- esperado: 1

/* Consistencia de CueSaldoActual (columna legacy; la billetera recalcula) */
UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + 7100 WHERE CueIdCuenta = 71;
UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - 7100 WHERE CueIdCuenta = 1596;

/* ── PASO 2 — Verificación: ambas billeteras de SRL TIENDA ONLINE en 0 ──── */
SELECT cc.CueIdCuenta, cc.CueTipo,
       CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) AS BilleteraDespues
FROM   dbo.MovimientosCuenta m
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE  m.CueIdCuenta IN (71, 1596)
  AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
GROUP  BY cc.CueIdCuenta, cc.CueTipo;

/* Si ambas dan 0.00 →  COMMIT TRANSACTION;
   Si no             →  ROLLBACK TRANSACTION;  y avisar. */
