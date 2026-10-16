-- ============================================================
-- SCRIPT: Corregir movimientos ORDEN → ENTREGA en cuentas de recursos
-- ============================================================
-- PROBLEMA:
--   Movimientos insertados manualmente con MovTipo = 'ORDEN' en
--   cuentas de metros/kg (recursos). El sistema los trata como
--   "pendiente de facturar" y los OCULTA del estado de cuenta.
--   También quedan excluidos del cálculo de saldo.
--
-- FIX:
--   Cambiar MovTipo = 'ORDEN' → 'ENTREGA' en cuentas de recursos.
--   Esto los hace visibles en el estado de cuenta y los incluye
--   en el saldo de metros.
--
-- ALCANCE:
--   Solo afecta cuentas de tipo RECURSOS (metros, kg, etc.)
--   NO toca cuentas monetarias (DINERO_USD, DINERO_UYU, etc.)
--
-- USO:
--   Paso 1: ejecutar en modo DIAGNÓSTICO (bloque SELECT al inicio)
--   Paso 2: revisar resultados
--   Paso 3: descomentar bloque APLICAR CAMBIOS y cambiar ROLLBACK → COMMIT
-- ============================================================

BEGIN TRANSACTION;
BEGIN TRY

  -- ══════════════════════════════════════════════════════════
  -- PASO 1 — DIAGNÓSTICO
  -- ══════════════════════════════════════════════════════════

  PRINT '── Movimientos ORDEN en cuentas de RECURSOS (candidatos a corregir) ──';

  SELECT
    m.MovIdMovimiento,
    m.CueIdCuenta,
    cc.CueTipo,
    cc.CliIdCliente,
    RTRIM(LTRIM(ISNULL(cli.Nombre, '—')))                      AS Cliente,
    m.MovTipo,
    m.MovConcepto,
    m.MovImporte,
    CAST(m.MovFecha AS DATE)                                   AS Fecha,
    COALESCE(od.OrdCodigoOrden, m.MovRefExterna, '—')         AS CodigoOrden,
    m.MovObservaciones,
    m.MovAnulado
  FROM   dbo.MovimientosCuenta m WITH(NOLOCK)
  JOIN   dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
  LEFT JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
  LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = m.OrdIdOrden
  WHERE  m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
    AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND  cc.CueTipo NOT IN (
           'DINERO_USD','DINERO_UYU',
           'USD','UYU','ARS','EUR','PYG','BRL',
           'CORRIENTE','CREDITO','DEBITO','CAJA'
         )
    AND  cc.CueActiva = 1
  ORDER  BY RTRIM(LTRIM(cli.Nombre)), m.MovFecha;

  PRINT '';
  PRINT '── Resumen por cliente ──';
  SELECT
    RTRIM(LTRIM(ISNULL(cli.Nombre, '—')))                      AS Cliente,
    cc.CueTipo,
    COUNT(*)                                                    AS CantMovimientos,
    SUM(ABS(m.MovImporte))                                      AS TotalMetros
  FROM   dbo.MovimientosCuenta m WITH(NOLOCK)
  JOIN   dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
  LEFT JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
  WHERE  m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
    AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND  cc.CueTipo NOT IN (
           'DINERO_USD','DINERO_UYU',
           'USD','UYU','ARS','EUR','PYG','BRL',
           'CORRIENTE','CREDITO','DEBITO','CAJA'
         )
    AND  cc.CueActiva = 1
  GROUP  BY RTRIM(LTRIM(cli.Nombre))
  ORDER  BY RTRIM(LTRIM(cli.Nombre));

  -- ══════════════════════════════════════════════════════════
  -- PASO 2 — APLICAR CAMBIOS
  -- Descomentar cuando el diagnóstico sea correcto.
  -- ══════════════════════════════════════════════════════════
  /*

  -- 2a. Cambiar ORDEN → ENTREGA en cuentas de recursos
  UPDATE dbo.MovimientosCuenta
  SET    MovTipo = 'ENTREGA',
         MovObservaciones = ISNULL(MovObservaciones, '') + ' [CORREGIDO: ORDEN→ENTREGA]'
  WHERE  MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
    AND  (MovAnulado IS NULL OR MovAnulado = 0)
    AND  CueIdCuenta IN (
           SELECT CueIdCuenta
           FROM   dbo.CuentasCliente WITH(NOLOCK)
           WHERE  CueTipo NOT IN (
                    'DINERO_USD','DINERO_UYU',
                    'USD','UYU','ARS','EUR','PYG','BRL',
                    'CORRIENTE','CREDITO','DEBITO','CAJA'
                  )
             AND  CueActiva = 1
         );

  PRINT 'Movimientos corregidos: ' + CAST(@@ROWCOUNT AS VARCHAR);

  -- 2b. Recalcular CueSaldoActual para las cuentas afectadas
  --     (el SP_RegistrarMovimiento lo calcula, pero tras el cambio de tipo
  --      el valor almacenado puede haberse calculado excluyendo estos movimientos)
  UPDATE cc
  SET    cc.CueSaldoActual = (
           SELECT ISNULL(SUM(m2.MovImporte), 0)
           FROM   dbo.MovimientosCuenta m2 WITH(NOLOCK)
           WHERE  m2.CueIdCuenta = cc.CueIdCuenta
             AND  (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
             AND  m2.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')
         )
  FROM   dbo.CuentasCliente cc
  WHERE  cc.CueTipo NOT IN (
           'DINERO_USD','DINERO_UYU',
           'USD','UYU','ARS','EUR','PYG','BRL',
           'CORRIENTE','CREDITO','DEBITO','CAJA'
         )
    AND  cc.CueActiva = 1
    AND  EXISTS (
           SELECT 1
           FROM   dbo.MovimientosCuenta m3 WITH(NOLOCK)
           WHERE  m3.CueIdCuenta = cc.CueIdCuenta
             AND  m3.MovObservaciones LIKE '%CORREGIDO: ORDEN→ENTREGA%'
         );

  PRINT 'Saldos recalculados en cuentas de recursos afectadas.';

  */

  -- ══════════════════════════════════════════════════════════
  ROLLBACK;
  PRINT '';
  PRINT '══════════════════════════════════════════════════════';
  PRINT '  MODO DIAGNÓSTICO — sin cambios aplicados.';
  PRINT '  Para aplicar: descomentar bloque PASO 2 y cambiar';
  PRINT '  ROLLBACK → COMMIT.';
  PRINT '══════════════════════════════════════════════════════';

END TRY
BEGIN CATCH
  ROLLBACK;
  PRINT '❌ Error: ' + ERROR_MESSAGE() + ' (línea ' + CAST(ERROR_LINE() AS VARCHAR) + ')';
END CATCH;
