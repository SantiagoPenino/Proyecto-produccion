-- ============================================================
-- FIX PRECISO: Cliente "Srb" — CueIdCuenta monetaria = 144
-- Solo anula ORDEN monetarios donde la misma orden tiene
-- ENTREGA en la cuenta de recursos (metros ya descontados).
-- NO toca movimientos insertados manualmente sin ENTREGA par.
-- ============================================================

BEGIN TRANSACTION;
BEGIN TRY

  DECLARE @CueIdCuenta INT = 144;  -- DINERO_USD de Srb
  DECLARE @CliIdCliente INT;

  SELECT @CliIdCliente = CliIdCliente
  FROM   dbo.CuentasCliente WITH(NOLOCK)
  WHERE  CueIdCuenta = @CueIdCuenta;

  PRINT 'CliIdCliente: ' + CAST(@CliIdCliente AS VARCHAR);

  -- DIAGNÓSTICO: qué movimientos van a ser anulados vs cuáles se quedan
  PRINT '── ORDEN monetarios que SÍ se anulan (tienen ENTREGA en recursos) ──';
  SELECT
    m_ord.MovIdMovimiento,
    m_ord.MovConcepto,
    m_ord.MovImporte,
    m_ent.MovIdMovimiento AS EntregaRecursoId,
    m_ent.MovImporte      AS EntregaMetros
  FROM   dbo.MovimientosCuenta m_ord WITH(NOLOCK)
  JOIN   dbo.MovimientosCuenta m_ent WITH(NOLOCK) ON m_ent.OrdIdOrden  = m_ord.OrdIdOrden
                                                  AND m_ent.MovTipo = 'ENTREGA'
                                                  AND (m_ent.MovAnulado IS NULL OR m_ent.MovAnulado = 0)
  JOIN   dbo.CuentasCliente    cc_rec WITH(NOLOCK) ON cc_rec.CueIdCuenta = m_ent.CueIdCuenta
                                                  AND cc_rec.CliIdCliente = @CliIdCliente
                                                  AND cc_rec.CueTipo NOT IN (
                                                        'DINERO_USD','DINERO_UYU','USD','UYU',
                                                        'ARS','EUR','PYG','BRL',
                                                        'CORRIENTE','CREDITO','DEBITO','CAJA'
                                                      )
  WHERE  m_ord.CueIdCuenta = @CueIdCuenta
    AND  m_ord.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
    AND  (m_ord.MovAnulado IS NULL OR m_ord.MovAnulado = 0)
    AND  m_ord.OrdIdOrden IS NOT NULL;

  PRINT '── ORDEN monetarios que NO se tocan (sin ENTREGA en recursos) ──';
  SELECT
    m_ord.MovIdMovimiento,
    m_ord.MovConcepto,
    m_ord.MovImporte,
    'SIN ENTREGA EN RECURSOS — se deja intacto' AS Motivo
  FROM   dbo.MovimientosCuenta m_ord WITH(NOLOCK)
  WHERE  m_ord.CueIdCuenta = @CueIdCuenta
    AND  m_ord.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
    AND  (m_ord.MovAnulado IS NULL OR m_ord.MovAnulado = 0)
    AND  m_ord.OrdIdOrden IS NOT NULL
    AND  NOT EXISTS (
           SELECT 1
           FROM   dbo.MovimientosCuenta m_ent WITH(NOLOCK)
           JOIN   dbo.CuentasCliente    cc_rec WITH(NOLOCK) ON cc_rec.CueIdCuenta  = m_ent.CueIdCuenta
                                                           AND cc_rec.CliIdCliente = @CliIdCliente
                                                           AND cc_rec.CueTipo NOT IN (
                                                                 'DINERO_USD','DINERO_UYU','USD','UYU',
                                                                 'ARS','EUR','PYG','BRL',
                                                                 'CORRIENTE','CREDITO','DEBITO','CAJA'
                                                               )
           WHERE  m_ent.OrdIdOrden = m_ord.OrdIdOrden
             AND  m_ent.MovTipo = 'ENTREGA'
             AND  (m_ent.MovAnulado IS NULL OR m_ent.MovAnulado = 0)
         );

  -- 1. Cancelar DeudaDocumento solo de órdenes con ENTREGA en recursos
  UPDATE dd
  SET    dd.DDeEstado           = 'CANCELADO',
         dd.DDeImportePendiente = 0
  FROM   dbo.DeudaDocumento dd
  WHERE  dd.CueIdCuenta = @CueIdCuenta
    AND  dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
    AND  dd.OrdIdOrden IS NOT NULL
    AND  EXISTS (
           SELECT 1
           FROM   dbo.MovimientosCuenta m_ent WITH(NOLOCK)
           JOIN   dbo.CuentasCliente    cc_rec WITH(NOLOCK) ON cc_rec.CueIdCuenta  = m_ent.CueIdCuenta
                                                           AND cc_rec.CliIdCliente = @CliIdCliente
                                                           AND cc_rec.CueTipo NOT IN (
                                                                 'DINERO_USD','DINERO_UYU','USD','UYU',
                                                                 'ARS','EUR','PYG','BRL',
                                                                 'CORRIENTE','CREDITO','DEBITO','CAJA'
                                                               )
           WHERE  m_ent.OrdIdOrden = dd.OrdIdOrden
             AND  m_ent.MovTipo = 'ENTREGA'
             AND  (m_ent.MovAnulado IS NULL OR m_ent.MovAnulado = 0)
         );

  PRINT 'Deudas canceladas: ' + CAST(@@ROWCOUNT AS VARCHAR);

  -- 2. Anular solo los ORDEN monetarios con ENTREGA en recursos
  UPDATE m_ord
  SET    m_ord.MovAnulado       = 1,
         m_ord.MovObservaciones = ISNULL(m_ord.MovObservaciones,'') + ' [ANULADO: cubierto por ENTREGA en plan ROLLO]'
  FROM   dbo.MovimientosCuenta m_ord
  WHERE  m_ord.CueIdCuenta = @CueIdCuenta
    AND  m_ord.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
    AND  (m_ord.MovAnulado IS NULL OR m_ord.MovAnulado = 0)
    AND  m_ord.OrdIdOrden IS NOT NULL
    AND  EXISTS (
           SELECT 1
           FROM   dbo.MovimientosCuenta m_ent WITH(NOLOCK)
           JOIN   dbo.CuentasCliente    cc_rec WITH(NOLOCK) ON cc_rec.CueIdCuenta  = m_ent.CueIdCuenta
                                                           AND cc_rec.CliIdCliente = @CliIdCliente
                                                           AND cc_rec.CueTipo NOT IN (
                                                                 'DINERO_USD','DINERO_UYU','USD','UYU',
                                                                 'ARS','EUR','PYG','BRL',
                                                                 'CORRIENTE','CREDITO','DEBITO','CAJA'
                                                               )
           WHERE  m_ent.OrdIdOrden = m_ord.OrdIdOrden
             AND  m_ent.MovTipo = 'ENTREGA'
             AND  (m_ent.MovAnulado IS NULL OR m_ent.MovAnulado = 0)
         );

  PRINT 'Movimientos ORDEN anulados: ' + CAST(@@ROWCOUNT AS VARCHAR);

  -- 3. Recalcular saldo monetario
  DECLARE @NuevoSaldo DECIMAL(18,4);
  SELECT @NuevoSaldo = ISNULL(SUM(MovImporte), 0)
  FROM   dbo.MovimientosCuenta WITH(NOLOCK)
  WHERE  CueIdCuenta = @CueIdCuenta
    AND  (MovAnulado IS NULL OR MovAnulado = 0)
    AND  MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');

  UPDATE dbo.CuentasCliente
  SET    CueSaldoActual = @NuevoSaldo
  WHERE  CueIdCuenta = @CueIdCuenta;

  PRINT 'Saldo USD actualizado a: ' + CAST(@NuevoSaldo AS VARCHAR);

  -- Cambiar ROLLBACK → COMMIT para aplicar
  ROLLBACK;
  PRINT '  MODO DIAGNÓSTICO — sin cambios. Cambiar ROLLBACK → COMMIT para aplicar.';

END TRY
BEGIN CATCH
  ROLLBACK;
  PRINT '❌ Error: ' + ERROR_MESSAGE() + ' (línea ' + CAST(ERROR_LINE() AS VARCHAR) + ')';
END CATCH;
