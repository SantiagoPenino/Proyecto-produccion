/* ============================================================================
   diag_desglose_saldo_palmero.sql   —   SOLO LECTURA
   ----------------------------------------------------------------------------
   Desglosa el saldo "en vivo" de Palmero (la misma fórmula que usa la
   pantalla: SUM(MovImporte) de movimientos no-ORDEN, no-anulados) por
   MovTipo, para ver de dónde sale cada peso sin sumar nada a mano.
   Además prueba puntualmente el efecto del bug de los 12 pares
   PAGO_CRUZADO sin revertir (ver diag_anulados_sin_revertir.sql).
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Cli INT = 998;

-- ── 1. Saldo actual "en vivo" por cuenta (la fórmula real de la pantalla) ────
SELECT cc.CueIdCuenta, cc.CueTipo,
    SaldoEnVivo = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2))
                   FROM dbo.MovimientosCuenta m
                   WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                     AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'))
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

-- ── 2. Ese mismo saldo, desglosado por MovTipo — para ver qué categoría pesa ──
SELECT cc.CueTipo, m.MovTipo,
    Cantidad = COUNT(*),
    Total = CAST(SUM(m.MovImporte) AS DECIMAL(18,2))
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
GROUP BY cc.CueTipo, m.MovTipo
ORDER BY cc.CueTipo, Total;

-- ── 3. Efecto EXACTO (calculado, no a mano) de revertir los 12 pares
--       PAGO_CRUZADO huérfanos (USD anulado, UYU no) ────────────────────────
;WITH cruzados AS (
    SELECT m.MovIdMovimiento, m.MovFecha, cc.CueTipo, m.MovImporte, m.MovAnulado
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND m.MovTipo = 'PAGO_CRUZADO'
),
huerfanos AS (
    SELECT a.MovIdMovimiento, a.MovImporte
    FROM cruzados a
    JOIN cruzados b ON b.CueTipo <> a.CueTipo AND ABS(DATEDIFF(SECOND, a.MovFecha, b.MovFecha)) <= 1
    WHERE a.CueTipo = 'DINERO_UYU' AND a.MovAnulado = 0 AND b.MovAnulado = 1
)
SELECT
    CantidadPares = COUNT(*),
    SumaUYU_huerfana = CAST(SUM(MovImporte) AS DECIMAL(18,2)),
    SaldoUYU_ActualEnVivo = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta=m.CueIdCuenta WHERE cc.CliIdCliente=@Cli AND cc.CueTipo='DINERO_UYU' AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
    SaldoUYU_SiSeAnulanLosHuerfanos = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2)) FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta=m.CueIdCuenta WHERE cc.CliIdCliente=@Cli AND cc.CueTipo='DINERO_UYU' AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) - CAST(SUM(MovImporte) AS DECIMAL(18,2))
FROM huerfanos;

-- ── 4. Deudas vivas actuales (para comparar contra el saldo en vivo) ────────
SELECT SUM(dd.DDeImportePendiente) AS TotalDeudaViva, cc.CueTipo
FROM dbo.DeudaDocumento dd
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
WHERE cc.CliIdCliente = @Cli AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
GROUP BY cc.CueTipo;
