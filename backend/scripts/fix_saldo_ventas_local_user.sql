/* ============================================================================
   fix_saldo_ventas_local_user.sql
   ----------------------------------------------------------------------------
   Cliente: "Ventas local USER" (CliIdCliente 8627 — cuenta genérica de ventas
   de mostrador, no un cliente real con nombre). BUG 7 del catálogo: el CARGO
   quedó en la cuenta de la moneda equivocada, con el mismo número sin
   convertir.

   Incluye SOLO 2 de los 5 documentos con este patrón en la cuenta — los otros
   3 (ET-1980, ET-1982, ET-2137) tienen además un pago chico en USD sin
   explicación clara (ver nota al final) y NO se tocan en este script.

   ET-2061 (DocId 4094, $198 pesos): cargo (MovId 18889, VTA_CAJA, -198) en la
   cuenta USD en vez de UYU. El pago (+198) ya está bien, en UYU.
   ET-2074 (DocId 4110, $225 pesos): mismo caso — cargo (MovId 18932,
   VTA_CAJA, -225) en USD en vez de UYU. El pago (+225) ya está bien, en UYU.
   Ambos son swaps limpios (un solo cargo, un solo pago, mismo número): no
   hace falta insertar nada, solo reclasificar la cuenta del cargo.

   Probado con ROLLBACK contra la réplica local: después del fix, cuenta USD
   pasa de -3.159,19 a -2.736,19 y UYU de 2.478,00 a 2.055,00 (resultado de
   mover $423 = $198+$225 de una cuenta a la otra).

   ⚠️ NO INCLUIDO EN ESTE FIX (fuera de alcance, no tocar):
   - Después de este fix, la cuenta UYU sigue con un saldo a favor de $2.055
     sin ninguna deuda viva que lo respalde, y la cuenta USD sigue con un
     desfasaje de $73,16 (deuda viva sin cargo que la respalde). Al ser una
     cuenta genérica de mostrador (no un cliente real), no está claro si esto
     es un problema real o el funcionamiento normal de esta cuenta agregada
     — no se investigó a fondo, queda pendiente.
   - ET-1980 (DocId 3999), ET-1982 (DocId 4000) y ET-2137 (DocId 4188): cada
     uno tiene, además del cargo cruzado, un pago chico en USD (ej. "Pago: 1x
     Cuellos Polares Adulto", $1,8364) que no calza claramente con ningún
     cargo — podría ser un ítem con precio de referencia en USD (legítimo) o
     un artefacto del mismo bug. No se tocan hasta entender el origen.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 8627;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');

-- ── 1. PREVIEW ───────────────────────────────────────────────────────────
SELECT m.MovIdMovimiento, cc.CueTipo, m.MovTipo, m.MovImporte, m.MovAnulado, m.DocIdDocumento
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento IN (4094, 4110) ORDER BY m.DocIdDocumento, m.MovFecha;

SELECT cc.CueTipo,
    (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoEnVivo_ANTES,
    (SELECT CAST(ISNULL(SUM(dd.DDeImportePendiente),0) AS DECIMAL(18,2)) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')) AS DeudaViva
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');
GO

-- ── 2. EL FIX — descomentar tras confirmar el preview ───────────────────────
/*
BEGIN TRANSACTION;

DECLARE @Cli INT = 8627;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');
DECLARE @OK BIT = 1;

IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento=18889 AND DocIdDocumento=4094 AND CueIdCuenta=@CuentaUSD AND MovTipo='VTA_CAJA' AND MovImporte=-198 AND (MovAnulado IS NULL OR MovAnulado=0))
    SET @OK = 0;
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE MovIdMovimiento=18932 AND DocIdDocumento=4110 AND CueIdCuenta=@CuentaUSD AND MovTipo='VTA_CAJA' AND MovImporte=-225 AND (MovAnulado IS NULL OR MovAnulado=0))
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
        MovObservaciones = LEFT(ISNULL(MovObservaciones + ' | ','') + 'Reclasificado a la cuenta UYU (moneda del documento). fix_saldo_ventas_local_user.sql', 500)
    WHERE MovIdMovimiento IN (18889, 18932);

    PRINT '[OK] Movimientos reclasificados: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

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
