/* ============================================================================
   fix_saldo_palmero_ajuste_final.sql
   ----------------------------------------------------------------------------
   AJUSTE FINAL del saldo de Palmero (CliId 998). Después de arreglar todos
   los documentos puntuales (BUG 1-4 del catálogo, ya confirmados 100%
   limpios con el barrido general), queda un desfasaje histórico en el
   mecanismo de PAGO_CRUZADO (BUG 5) que no se puede reconstruir línea por
   línea: la relación entre cada cruce y el pedido que dispara no es 1 a 1
   (cubre el déficit acumulado de la cuenta en ese momento, no el costo de
   un pedido puntual) — imposible de reconstruir con precisión histórica.

   DECISIÓN DEL USUARIO (dueño del criterio de negocio): "la realidad la
   tiene la factura, y las que están pagas están resueltas — es ajustar a
   esos valores." O sea: en vez de perseguir cada cruce histórico, se ajusta
   el saldo directo a lo que las facturas y deudas vivas de HOY dicen que es
   la realidad (mismo principio "la factura manda" ya usado en el resto de
   los fixes de hoy, aplicado ahora al nivel de cuenta en vez de documento).

   OBJETIVO:
     UYU → -14.050,15 (exactamente las 2 deudas vivas actuales, ambas en $)
     USD → 0,00 (cero deuda viva confirmada en dólares)

   Es un AJUSTE contable, no un movimiento real nuevo — queda como tal,
   con nota de auditoría explícita, para que en el futuro cualquiera que
   audite la cuenta entienda que este número no corresponde a un cobro o
   cargo real sino a un cierre de desfasaje histórico.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 998;
DECLARE @CuentaUYU INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_UYU');
DECLARE @CuentaUSD INT = (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');

-- ── 1. PREVIEW — saldo actual y deudas vivas, para calcular el ajuste exacto ──
SELECT cc.CueIdCuenta, cc.CueTipo,
    SaldoEnVivo_ANTES = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
    DeudaViva = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'))
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

-- Verificar antes de aplicar: DeudaViva de UYU debe ser 14050.15 y de USD 0.
-- Si cambió, recalcular el ajuste (no usar los valores fijos de abajo a ciegas).

-- ── 2. EL AJUSTE — descomentar tras confirmar el preview ────────────────────
/*
BEGIN TRANSACTION;

DECLARE @DeudaUYU DECIMAL(18,2), @DeudaUSD DECIMAL(18,2);
DECLARE @SaldoUYU DECIMAL(18,2), @SaldoUSD DECIMAL(18,2);

SELECT @SaldoUYU = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = @CuentaUYU AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
       @DeudaUYU = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = @CuentaUYU AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')),
       @SaldoUSD = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = @CuentaUSD AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
       @DeudaUSD = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = @CuentaUSD AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'));

-- El objetivo es que SaldoEnVivo termine en -DeudaViva (deuda = negativo, nada a favor)
DECLARE @AjusteUYU DECIMAL(18,2) = (-@DeudaUYU) - @SaldoUYU;
DECLARE @AjusteUSD DECIMAL(18,2) = (-@DeudaUSD) - @SaldoUSD;

PRINT 'Ajuste a insertar UYU: ' + CAST(@AjusteUYU AS VARCHAR(20));
PRINT 'Ajuste a insertar USD: ' + CAST(@AjusteUSD AS VARCHAR(20));

IF ABS(@AjusteUYU) > 0.01
BEGIN
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones)
    VALUES
        (@CuentaUYU, 'AJUSTE', 'Ajuste de desfasaje histórico (cruces de moneda 2026-06/07)', @AjusteUYU, 0, GETDATE(), 11, 0,
         'AJUSTE CONTABLE, no es un cobro/cargo real. Cierra el desfasaje del mecanismo PAGO_CRUZADO (BUG 5, ver CATALOGO_BUGS_SALDO_CLIENTES.md) que no se pudo reconstruir línea por línea. Deja el saldo en -DeudaViva (sin nada a favor ni de más). fix_saldo_palmero_ajuste_final.sql');
END

IF ABS(@AjusteUSD) > 0.01
BEGIN
    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones)
    VALUES
        (@CuentaUSD, 'AJUSTE', 'Ajuste de desfasaje histórico (cruces de moneda 2026-06/07)', @AjusteUSD, 0, GETDATE(), 11, 0,
         'AJUSTE CONTABLE, no es un cobro/cargo real. Cierra el desfasaje del mecanismo PAGO_CRUZADO (BUG 5, ver CATALOGO_BUGS_SALDO_CLIENTES.md) que no se pudo reconstruir línea por línea. Deja el saldo en -DeudaViva (sin nada a favor ni de más). fix_saldo_palmero_ajuste_final.sql');
END

-- Recomputar MovSaldoPosterior + CueSaldoActual (mismo método de siempre)
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

PRINT '[OK] Ajuste final aplicado y saldos recalculados.';

-- ── 3. VERIFICACIÓN — debe dar SaldoEnVivo = -DeudaViva exacto ──────────────
SELECT cc.CueTipo,
    SaldoEnVivo_DESPUES = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
    DeudaViva = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'))
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
