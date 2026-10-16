/* ============================================================================
   fix_saldo_palmero_completo.sql
   ----------------------------------------------------------------------------
   Cierra el "saldo a favor" fantasma de Palmero (CliId 998) con las DOS causas
   confirmadas hoy con evidencia (no a mano — todo calculado por SQL):

   CAUSA 1 — PC-1156 (DocId 1795, $271.157,55 UYU) nunca tuvo su cargo en
   pesos en el libro mayor. Se ve el pago completo (+271.157,55) pero el único
   cargo real es en USD (-7.369,43, el trabajo de las 23 órdenes) — falta el
   CIERRE_CICLO en UYU que debería existir (mismo patrón que TODAS las demás
   facturas de Palmero: PC-1451, PC-1982, PC-2220 sí lo tienen). La transacción
   se creó vía "Pago Factura Manual Edicion" sin sesión de caja ni detalle —
   se armó a mano y se saltó el paso que genera ese cargo.
   FIX: insertar el CIERRE_CICLO en UYU por -DocTotal (-271157.55), mismo
   criterio que usa toda la contabilidad de este sistema (factura manda).

   CAUSA 2 — 12 pares de "cruce automático" (UYU→USD) donde el lado USD se
   anuló (al anularse la factura PC-1932) pero el lado UYU que lo financió
   nunca se anuló. Total $104.119,45 en UYU contando de más como gasto.
   FIX: anular también el lado UYU de esos 12 pares (ver
   diag_anulados_sin_revertir.sql, ya verificado).

   Después de las dos correcciones, recalcula MovSaldoPosterior y
   CueSaldoActual de las cuentas UYU/USD de Palmero (mismo método que ya usa
   fix_saldo_por_cliente.sql, la herramienta existente para este tipo de bug).

   Con las DOS causas el saldo UYU en vivo debería quedar MUY cerca de
   -14.050,15 (exactamente lo que dicen las 2 deudas vivas de hoy, sin nada
   a favor). Puede quedar un resto chico sin explicar (~$1.100) — se revisa
   aparte si hace falta, no bloquea este fix.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 998;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');

-- ── 1. PREVIEW — qué hay hoy, antes de tocar nada ───────────────────────────
PRINT '--- 1a. Movimientos de PC-1156 (debe faltar el CIERRE_CICLO en UYU) ---';
SELECT m.MovIdMovimiento, cc.CueTipo, m.MovTipo, m.MovImporte, m.MovAnulado
FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento = 1795 ORDER BY m.MovFecha;

PRINT '--- 1b. Los 12 pares huerfanos (deben salir 12 filas) ---';
;WITH cruzados AS (
    SELECT m.MovIdMovimiento, m.MovFecha, cc.CueTipo, m.MovImporte, m.MovAnulado
    FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND m.MovTipo = 'PAGO_CRUZADO'
)
SELECT a.MovIdMovimiento, a.MovImporte, a.MovFecha
FROM cruzados a
JOIN cruzados b ON b.CueTipo <> a.CueTipo AND ABS(DATEDIFF(SECOND, a.MovFecha, b.MovFecha)) <= 1
WHERE a.CueTipo = 'DINERO_UYU' AND a.MovAnulado = 0 AND b.MovAnulado = 1;

PRINT '--- 1c. Saldo en vivo ANTES ---';
SELECT cc.CueTipo,
    (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SaldoEnVivo_ANTES
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

-- Si 1a NO muestra exactamente 25 filas (23 ORDEN + 1 CIERRE_CICLO USD + 1 PAGO),
-- o 1b no da exactamente 12 filas, ALGO CAMBIÓ — no seguir sin revisar.

-- ── 2. EL FIX — descomentar tras confirmar el preview ───────────────────────
/*
BEGIN TRANSACTION;

DECLARE @OK BIT = 1;

-- Guard: PC-1156 sigue sin su CIERRE_CICLO en UYU
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta=m.CueIdCuenta
           WHERE m.DocIdDocumento = 1795 AND cc.CueTipo='DINERO_UYU' AND m.MovTipo='CIERRE_CICLO')
    SET @OK = 0;

-- Guard: siguen existiendo los 12 pares huerfanos
IF (SELECT COUNT(*) FROM (
      SELECT a.MovIdMovimiento
      FROM dbo.MovimientosCuenta a
      JOIN dbo.CuentasCliente cca ON cca.CueIdCuenta = a.CueIdCuenta
      JOIN dbo.MovimientosCuenta b ON b.MovTipo = 'PAGO_CRUZADO' AND b.MovAnulado = 1
      JOIN dbo.CuentasCliente ccb ON ccb.CueIdCuenta = b.CueIdCuenta AND ccb.CueTipo <> cca.CueTipo
      WHERE cca.CliIdCliente = @Cli AND a.MovTipo = 'PAGO_CRUZADO' AND cca.CueTipo = 'DINERO_UYU' AND a.MovAnulado = 0
        AND ABS(DATEDIFF(SECOND, a.MovFecha, b.MovFecha)) <= 1
    ) x) <> 12
    SET @OK = 0;

IF @OK = 0
BEGIN
    PRINT '[ABORTA] El estado ya no coincide con el diagnóstico. No se tocó nada.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    -- 2a. Insertar el CIERRE_CICLO faltante de PC-1156 en UYU
    DECLARE @DocTotalPC1156 DECIMAL(18,2) = (SELECT DocTotal FROM dbo.DocumentosContables WHERE DocIdDocumento = 1795);

    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, DocIdDocumento,
         MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones, CicIdCiclo)
    SELECT
        @CuentaUYU, 'CIERRE_CICLO', 'Facturado (E-TICKET CREDITO ET-22, cargo faltante)',
        -dc.DocTotal, 0, dc.DocIdDocumento,
        '2026-06-25 12:58:46.617', 11, 0,
        'Cargo en UYU que faltaba desde el alta (Pago Factura Manual Edicion no lo generó). fix_saldo_palmero_completo.sql',
        dc.CicIdCiclo
    FROM dbo.DocumentosContables dc WHERE dc.DocIdDocumento = 1795;

    PRINT '[OK] Insertado cargo faltante de PC-1156 en UYU: -' + CAST(@DocTotalPC1156 AS VARCHAR(20));

    -- 2b. Anular el lado UYU de los 12 pares huerfanos
    ;WITH cruzados AS (
        SELECT m.MovIdMovimiento, m.MovFecha, cc.CueTipo, m.MovAnulado
        FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
        WHERE cc.CliIdCliente = @Cli AND m.MovTipo = 'PAGO_CRUZADO'
    ),
    huerfanos AS (
        SELECT a.MovIdMovimiento
        FROM cruzados a
        JOIN cruzados b ON b.CueTipo <> a.CueTipo AND ABS(DATEDIFF(SECOND, a.MovFecha, b.MovFecha)) <= 1
        WHERE a.CueTipo = 'DINERO_UYU' AND a.MovAnulado = 0 AND b.MovAnulado = 1
    )
    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(ISNULL(m.MovObservaciones + ' | ','') + 'ANULADO: la cobertura que financiaba se anuló del lado USD y este lado UYU había quedado vivo. fix_saldo_palmero_completo.sql', 500)
    FROM dbo.MovimientosCuenta m
    JOIN huerfanos h ON h.MovIdMovimiento = m.MovIdMovimiento;

    PRINT '[OK] Anulados ' + CAST(@@ROWCOUNT AS VARCHAR(10)) + ' movimientos huerfanos en UYU.';

    -- 2c. Recomputar MovSaldoPosterior (saldo corrido) de las cuentas afectadas
    ;WITH ord AS (
        SELECT mc.MovIdMovimiento,
               SUM(mc.MovImporte) OVER (PARTITION BY mc.CueIdCuenta ORDER BY mc.MovFecha, mc.MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS run
        FROM dbo.MovimientosCuenta mc
        WHERE mc.CueIdCuenta IN (@CuentaUYU, @CuentaUSD) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
    )
    UPDATE mc SET mc.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta mc JOIN ord ON ord.MovIdMovimiento = mc.MovIdMovimiento;

    -- 2d. Recomputar CueSaldoActual de ambas cuentas
    UPDATE cc SET cc.CueSaldoActual = x.s
    FROM dbo.CuentasCliente cc
    JOIN (SELECT mc.CueIdCuenta, SUM(mc.MovImporte) AS s
          FROM dbo.MovimientosCuenta mc
          WHERE mc.CueIdCuenta IN (@CuentaUYU, @CuentaUSD) AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
          GROUP BY mc.CueIdCuenta) x ON x.CueIdCuenta = cc.CueIdCuenta;

    PRINT '[OK] Saldos recalculados.';

    -- ── 3. VERIFICACIÓN — el número que importa ──────────────────────────────
    SELECT cc.CueTipo,
        SaldoEnVivo_DESPUES = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
        DeudaViva = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'))
    FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

    --   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
END
*/
