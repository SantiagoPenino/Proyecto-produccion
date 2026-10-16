/* ============================================================================
   fix_saldo_srl_fa73.sql
   ----------------------------------------------------------------------------
   Cliente: SRL Tienda Online (CliIdCliente 644). BUG 7 del catálogo: el CARGO
   de la factura cayó en la cuenta de la moneda equivocada, con el mismo
   número sin convertir.

   FA-73 (DocId 3429, $7.100 pesos): el pago (MovId 15990, +7.100) ya está
   bien, en la cuenta UYU (1596) — corregido ayer (BUG 2). El CARGO (MovId
   15989, VTA_CAJA, -7.100) quedó en la cuenta USD (71) en vez de UYU.
   Verificado contra el libro mayor completo del cliente: es el único
   movimiento de ese documento en la cuenta USD, y los otros 2 documentos de
   este cliente (1386, 1842) ya cierran perfecto en USD (cargo+pago=0) — no
   hay ningún cargo "bien puesto" que este estuviera duplicando.

   FIX: reclasificar el movimiento a la cuenta UYU (mismo patrón que
   fix_crossmoneda_lote1.sql). Recalcula MovSaldoPosterior/CueSaldoActual.

   Probado con ROLLBACK contra la réplica local: después del fix, cuenta USD
   queda en 0 (antes: -7.100) y cuenta UYU en 0.

   ⚠️ NO INCLUIDO EN ESTE FIX (fuera de alcance, no tocar): la cuenta USD de
   este cliente tiene una `DeudaDocumento` (DDeIdDocumento 20) por $91,44
   pendiente que NO está ligada a ningún documento (`DocIdDocumento IS NULL`)
   — un residuo viejo de una ORDEN que nunca se facturó, sin relación con
   BUG 2/7. Después de este fix, el saldo en vivo de USD dará 0 mientras la
   deuda viva siga marcando $91,44 — es una discrepancia real pero distinta,
   pendiente de investigar aparte (no improvisar un fix).
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 644;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');

-- ── 1. PREVIEW ───────────────────────────────────────────────────────────
SELECT m.MovIdMovimiento, cc.CueTipo, m.MovTipo, m.MovImporte, m.MovAnulado, m.DocIdDocumento
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento = 3429 ORDER BY m.MovFecha;

SELECT cc.CueTipo,
    (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoEnVivo_ANTES,
    (SELECT CAST(ISNULL(SUM(dd.DDeImportePendiente),0) AS DECIMAL(18,2)) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')) AS DeudaViva
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');
GO

-- ── 2. EL FIX — descomentar tras confirmar el preview ───────────────────────
/*
BEGIN TRANSACTION;

DECLARE @Cli INT = 644;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');
DECLARE @OK BIT = 1;

IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = 15989 AND DocIdDocumento = 3429
               AND CueIdCuenta = @CuentaUSD AND MovTipo = 'VTA_CAJA' AND MovImporte = -7100 AND (MovAnulado IS NULL OR MovAnulado = 0))
    SET @OK = 0;

IF @OK = 0
BEGIN
    PRINT '[ABORTA] El estado ya no coincide con el diagnóstico. No se tocó nada.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    UPDATE dbo.MovimientosCuenta
    SET CueIdCuenta = @CuentaUYU,
        MovObservaciones = LEFT(ISNULL(MovObservaciones + ' | ','') + 'Reclasificado a la cuenta UYU (moneda del documento FA-73). fix_saldo_srl_fa73.sql', 500)
    WHERE MovIdMovimiento = 15989;

    PRINT '[OK] Movimiento reclasificado: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    ;WITH ord AS (
        SELECT mc.MovIdMovimiento,
               SUM(mc.MovImporte) OVER (PARTITION BY mc.CueIdCuenta ORDER BY mc.MovFecha, mc.MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
        FROM dbo.MovimientosCuenta mc
        WHERE mc.CueIdCuenta IN (@CuentaUYU, @CuentaUSD) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
    )
    UPDATE mc SET mc.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta mc JOIN ord ON ord.MovIdMovimiento = mc.MovIdMovimiento;

    UPDATE cc SET cc.CueSaldoActual = x.s
    FROM dbo.CuentasCliente cc
    JOIN (SELECT mc.CueIdCuenta, SUM(mc.MovImporte) AS s
          FROM dbo.MovimientosCuenta mc
          WHERE mc.CueIdCuenta IN (@CuentaUYU, @CuentaUSD) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
          GROUP BY mc.CueIdCuenta) x ON x.CueIdCuenta = cc.CueIdCuenta;

    PRINT '[OK] Saldos recalculados.';

    -- ── 3. VERIFICACIÓN ──────────────────────────────────────────────────
    SELECT cc.CueTipo,
        SaldoEnVivo_DESPUES = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
        DeudaViva = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA'))
    FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

    --   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
END
*/
GO
