/* ============================================================================
   fix_crossmoneda_pc2074.sql
   ----------------------------------------------------------------------------
   PC-2074 (Palmero, DocId 3980): el documento es en PESOS ($154,00) pero el
   cargo (VTA_CAJA) y la deuda que genera quedaron en la cuenta DINERO_USD.
   Mismo patrón de los otros 7 casos de hoy — mismo número, cuenta de moneda
   equivocada, sin conversión (imposible que sea real: US$154 ≠ $154 al TC
   de esos días, que rondaba 40).

   EL FIX: mueve el movimiento VTA_CAJA (el cargo) y la DeudaDocumento que
   quedó pendiente, de la cuenta USD a la cuenta UYU. No hay pago que mover
   (la deuda sigue 100% pendiente, $154).
   ============================================================================ */

SET NOCOUNT ON;
GO

-- ── 1. PREVIEW ───────────────────────────────────────────────────────────
SELECT m.MovIdMovimiento, m.CueIdCuenta, cc.CueTipo, m.MovTipo, m.MovImporte, m.DocIdDocumento
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento = 3980 AND m.MovTipo = 'VTA_CAJA';

SELECT dd.DDeIdDocumento, dd.CueIdCuenta, cc.CueTipo, dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
WHERE dd.DocIdDocumento = 3980;
GO

-- ── 2. EL FIX — descomentar tras confirmar el preview ───────────────────
/*
BEGIN TRANSACTION;

DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = 998 AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = 998 AND CueTipo = 'DINERO_USD');
DECLARE @Importe DECIMAL(18,2) = 154.00;

UPDATE dbo.MovimientosCuenta
SET CueIdCuenta = @CuentaUYU,
    MovObservaciones = LEFT(ISNULL(MovObservaciones + ' | ','') + 'Reclasificado de USD a UYU: PC-2074 es en pesos. fix_crossmoneda_pc2074.sql', 500)
WHERE DocIdDocumento = 3980 AND MovTipo = 'VTA_CAJA' AND CueIdCuenta = @CuentaUSD;

UPDATE dbo.DeudaDocumento
SET CueIdCuenta = @CuentaUYU,
    DDeObservaciones = LEFT(ISNULL(DDeObservaciones + ' | ','') + 'Reclasificada de USD a UYU: PC-2074 es en pesos. fix_crossmoneda_pc2074.sql', 500)
WHERE DocIdDocumento = 3980 AND CueIdCuenta = @CuentaUSD;

UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Importe WHERE CueIdCuenta = @CuentaUSD;
UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Importe WHERE CueIdCuenta = @CuentaUYU;

PRINT '[OK] PC-2074 reclasificado de USD a UYU.';

SELECT dd.DDeIdDocumento, cc.CueTipo, dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
WHERE dd.DocIdDocumento = 3980;

--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
GO
