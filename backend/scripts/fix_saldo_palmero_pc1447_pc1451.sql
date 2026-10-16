/* ============================================================================
   fix_saldo_palmero_pc1447_pc1451.sql
   ----------------------------------------------------------------------------
   Mismo bug que PC-1156 (ya arreglado), confirmado por el usuario: la factura
   se ajustó manualmente (descuento) en el cierre, pero ese ajuste nunca se
   propagó al libro mayor — el cargo quedó en dólares con el valor VIEJO (sin
   descuento) y nunca se generó el cargo en pesos por el total real (con
   descuento) de la factura.

   PC-1447 (DocId 2238): factura $93.584,55. Cargo viejo en USD: -3.019,95
   (movimiento 10307, sin descuento). Falta el cargo en UYU por -93.584,55.
   PC-1451 (DocId 2243): factura $12.159,89. Cargo viejo en USD: -517,20
   (movimiento 10322, sin descuento). Falta el cargo en UYU por -12.159,89.
   (El pago de PC-1451 ya se había reclasificado a UYU en el fix de esta
   mañana — acá solo falta el CARGO, no el pago.)

   FIX: poner en 0 el cargo viejo en USD (igual que en los documentos que sí
   quedaron bien armados, ej. PC-1982/PC-2220: el lado USD queda en 0 como
   marca de "convertido") e insertar el cargo real en UYU por -DocTotal.
   Recalcula MovSaldoPosterior/CueSaldoActual al final, mismo método de
   siempre.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 998;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');

-- ── 1. PREVIEW ───────────────────────────────────────────────────────────
SELECT m.MovIdMovimiento, cc.CueTipo, m.MovTipo, m.MovImporte, m.MovAnulado, m.DocIdDocumento
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento IN (2238, 2243) ORDER BY m.DocIdDocumento, m.MovFecha;

SELECT cc.CueTipo,
    (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoEnVivo_ANTES
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

-- ── 2. EL FIX — descomentar tras confirmar el preview ───────────────────────
/*
BEGIN TRANSACTION;

DECLARE @OK BIT = 1;
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta=m.CueIdCuenta
               WHERE m.MovIdMovimiento = 10307 AND m.DocIdDocumento = 2238 AND cc.CueTipo='DINERO_USD' AND m.MovImporte = -3019.95)
    SET @OK = 0;
IF NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta=m.CueIdCuenta
               WHERE m.MovIdMovimiento = 10322 AND m.DocIdDocumento = 2243 AND cc.CueTipo='DINERO_USD' AND m.MovImporte = -517.20)
    SET @OK = 0;
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta=m.CueIdCuenta
           WHERE m.DocIdDocumento IN (2238,2243) AND cc.CueTipo='DINERO_UYU' AND m.MovTipo='CIERRE_CICLO')
    SET @OK = 0;

IF @OK = 0
BEGIN
    PRINT '[ABORTA] El estado ya no coincide con el diagnóstico. No se tocó nada.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    -- 2a. Poner en 0 los cargos viejos en USD (quedan como marca "convertido")
    UPDATE dbo.MovimientosCuenta
    SET MovImporte = 0,
        MovObservaciones = LEFT(ISNULL(MovObservaciones + ' | ','') + 'Puesto en 0: se generó el cargo correcto (con descuento) en UYU. fix_saldo_palmero_pc1447_pc1451.sql', 500)
    WHERE MovIdMovimiento IN (10307, 10322);

    -- 2b. Insertar los cargos reales en UYU (con descuento, = -DocTotal)
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, DocIdDocumento,
         MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones, CicIdCiclo)
    SELECT
        @CuentaUYU, 'CIERRE_CICLO',
        'Facturado (cargo con descuento faltante)',
        -dc.DocTotal, 0, dc.DocIdDocumento,
        CASE dc.DocIdDocumento WHEN 2238 THEN '2026-06-29 18:06:01.947' ELSE '2026-06-29 18:18:08.187' END,
        11, 0,
        'Cargo en UYU que faltaba: el descuento aplicado en el cierre no se había propagado al libro mayor. fix_saldo_palmero_pc1447_pc1451.sql',
        dc.CicIdCiclo
    FROM dbo.DocumentosContables dc WHERE dc.DocIdDocumento IN (2238, 2243);

    PRINT '[OK] Insertados ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' cargos faltantes en UYU (PC-1447 / PC-1451).';

    -- 2c. Recomputar MovSaldoPosterior
    ;WITH ord AS (
        SELECT mc.MovIdMovimiento,
               SUM(mc.MovImporte) OVER (PARTITION BY mc.CueIdCuenta ORDER BY mc.MovFecha, mc.MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
        FROM dbo.MovimientosCuenta mc
        WHERE mc.CueIdCuenta IN (@CuentaUYU, @CuentaUSD) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
    )
    UPDATE mc SET mc.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta mc JOIN ord ON ord.MovIdMovimiento = mc.MovIdMovimiento;

    -- 2d. Recomputar CueSaldoActual
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
        DeudaViva = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'))
    FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

    --   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
END
*/
