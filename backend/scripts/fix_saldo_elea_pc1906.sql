/* ============================================================================
   fix_saldo_elea_pc1906.sql
   ----------------------------------------------------------------------------
   Cliente: elea (CliIdCliente 257). BUG 7 del catálogo (ver
   CATALOGO_BUGS_SALDO_CLIENTES.md): el CARGO de la factura cayó en la cuenta
   de la moneda equivocada, con el mismo número sin convertir.

   PC-1906 (DocId 3074, US$1.142,28): el pago (MovId 19769, +1.142,28) SÍ está
   bien, en la cuenta USD (75) — se corrigió ayer con el fix de cross-moneda
   (BUG 2). Pero el CARGO (MovId 14510, VTA_CAJA, -1.142,28) quedó en la
   cuenta UYU (1444) en vez de la cuenta USD. Verificado contra el libro mayor
   completo de elea: es el ÚNICO movimiento de esa cuenta UYU (aparte de un
   ORDEN que no cuenta para el saldo), y el ÚNICO cargo de ese documento — no
   hay ningún otro cargo "bien puesto" en USD que este estuviera duplicando.

   FIX: reclasificar el movimiento a la cuenta USD (mismo patrón que
   fix_crossmoneda_lote1.sql, el número ya es correcto, solo está en la cuenta
   que no corresponde). Recalcula MovSaldoPosterior/CueSaldoActual al final.

   Resultado esperado: cuenta USD de elea = -DeudaViva (1.906,59, la única
   factura pendiente real, DocId 3876, no relacionada con esto). Cuenta UYU
   de elea = 0 (no tiene ninguna deuda en pesos).
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 257;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');

-- ── 1. PREVIEW ───────────────────────────────────────────────────────────
SELECT m.MovIdMovimiento, cc.CueTipo, m.MovTipo, m.MovImporte, m.MovAnulado, m.DocIdDocumento
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento = 3074 ORDER BY m.MovFecha;

SELECT cc.CueTipo,
    (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoEnVivo_ANTES,
    (SELECT CAST(ISNULL(SUM(dd.DDeImportePendiente),0) AS DECIMAL(18,2)) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')) AS DeudaViva
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');
GO

-- ── 2. EL FIX — descomentar tras confirmar el preview ───────────────────────
/*
BEGIN TRANSACTION;

DECLARE @Cli INT = 257;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');
DECLARE @OK BIT = 1;

IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = 14510 AND DocIdDocumento = 3074
               AND CueIdCuenta = @CuentaUYU AND MovTipo = 'VTA_CAJA' AND MovImporte = -1142.28 AND (MovAnulado IS NULL OR MovAnulado = 0))
    SET @OK = 0;

IF @OK = 0
BEGIN
    PRINT '[ABORTA] El estado ya no coincide con el diagnóstico. No se tocó nada.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    UPDATE dbo.MovimientosCuenta
    SET CueIdCuenta = @CuentaUSD,
        MovObservaciones = LEFT(ISNULL(MovObservaciones + ' | ','') + 'Reclasificado a la cuenta USD (moneda del documento PC-1906). fix_saldo_elea_pc1906.sql', 500)
    WHERE MovIdMovimiento = 14510;

    PRINT '[OK] Movimiento reclasificado: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    -- Recomputar MovSaldoPosterior
    ;WITH ord AS (
        SELECT mc.MovIdMovimiento,
               SUM(mc.MovImporte) OVER (PARTITION BY mc.CueIdCuenta ORDER BY mc.MovFecha, mc.MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
        FROM dbo.MovimientosCuenta mc
        WHERE mc.CueIdCuenta IN (@CuentaUYU, @CuentaUSD) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
    )
    UPDATE mc SET mc.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta mc JOIN ord ON ord.MovIdMovimiento = mc.MovIdMovimiento;

    -- Recomputar CueSaldoActual
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
