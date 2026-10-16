-- ============================================================
-- FIX PRECISO: Clientes ROLLO — deudas monetarias duplicadas
-- ============================================================
-- SOLO cancela movimientos ORDEN en cuenta monetaria donde
-- la MISMA ORDEN ya tiene ENTREGA en cuenta de recursos.
-- Eso = orden cubierta por metros Y cobrada en dinero = duplicado.
--
-- NO toca movimientos sin ENTREGA en recursos (pueden ser legítimos
-- o insertados manualmente con otro propósito).
-- ============================================================

BEGIN TRANSACTION;
BEGIN TRY

  -- ══════════════════════════════════════════════════════════
  -- DIAGNÓSTICO PREVIO — lo que se va a tocar
  -- ══════════════════════════════════════════════════════════
  PRINT '── Movimientos a anular (ORDEN monetario + ENTREGA en recursos para misma orden) ──';
  SELECT
    RTRIM(LTRIM(c.Nombre))          AS Cliente,
    cc_mon.CueIdCuenta              AS CuentaMonetaria,
    cc_mon.CueTipo,
    m_ord.MovIdMovimiento,
    m_ord.MovConcepto,
    m_ord.MovImporte,
    CAST(m_ord.MovFecha AS DATE)    AS Fecha,
    m_ord.OrdIdOrden,
    -- El movimiento de recursos que justifica la cancelación
    m_ent.MovIdMovimiento           AS EntregaRecursoId,
    m_ent.MovImporte                AS EntregaMetros

  FROM       dbo.Clientes          c      WITH(NOLOCK)
  JOIN       dbo.TiposClientes     tc     WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
  JOIN       dbo.CuentasCliente    cc_mon WITH(NOLOCK) ON cc_mon.CliIdCliente = c.CliIdCliente
                                                       AND cc_mon.CueTipo IN ('DINERO_USD','DINERO_UYU')
                                                       AND cc_mon.CueActiva = 1
  JOIN       dbo.MovimientosCuenta m_ord  WITH(NOLOCK) ON m_ord.CueIdCuenta  = cc_mon.CueIdCuenta
                                                       AND m_ord.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                                                       AND (m_ord.MovAnulado IS NULL OR m_ord.MovAnulado = 0)
                                                       AND m_ord.OrdIdOrden IS NOT NULL
                                                       -- NO tocar si ya fue facturado
                                                       AND m_ord.DocIdDocumento IS NULL
                                                       -- NO tocar las ya marcadas como cubiertas (no aparecen en billing UI)
                                                       AND (m_ord.MovObservaciones IS NULL
                                                            OR (m_ord.MovObservaciones NOT LIKE 'CUBIERTO%'
                                                                AND m_ord.MovObservaciones NOT LIKE 'MATERIAL_CUBIERTO%'))
  -- Confirma que la misma orden tiene ENTREGA en recursos → fue cubierta por metros
  JOIN       dbo.MovimientosCuenta m_ent  WITH(NOLOCK) ON m_ent.OrdIdOrden   = m_ord.OrdIdOrden
                                                       AND m_ent.MovTipo = 'ENTREGA'
                                                       AND (m_ent.MovAnulado IS NULL OR m_ent.MovAnulado = 0)
  JOIN       dbo.CuentasCliente    cc_rec WITH(NOLOCK) ON cc_rec.CueIdCuenta = m_ent.CueIdCuenta
                                                       AND cc_rec.CliIdCliente = c.CliIdCliente
                                                       AND cc_rec.CueTipo NOT IN (
                                                             'DINERO_USD','DINERO_UYU',
                                                             'USD','UYU','ARS','EUR','PYG','BRL',
                                                             'CORRIENTE','CREDITO','DEBITO','CAJA'
                                                           )
  WHERE  UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
  ORDER  BY c.Nombre, m_ord.OrdIdOrden;

  -- ══════════════════════════════════════════════════════════
  -- FIX 1: Cancelar DeudaDocumento solo de las órdenes con ENTREGA en recursos
  -- ══════════════════════════════════════════════════════════
  UPDATE dd
  SET    dd.DDeEstado           = 'CANCELADO',
         dd.DDeImportePendiente = 0
  FROM   dbo.DeudaDocumento     dd
  JOIN   dbo.CuentasCliente     cc_mon ON cc_mon.CueIdCuenta    = dd.CueIdCuenta
  JOIN   dbo.Clientes           c      ON c.CliIdCliente        = cc_mon.CliIdCliente
  JOIN   dbo.TiposClientes      tc     ON tc.TClIdTipoCliente   = c.TClIdTipoCliente
  WHERE  UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
    AND  cc_mon.CueTipo IN ('DINERO_USD','DINERO_UYU')
    AND  cc_mon.CueActiva = 1
    AND  dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')
    AND  dd.OrdIdOrden IS NOT NULL
    AND  dd.DocIdDocumento IS NULL
    -- Solo si esa orden tiene ENTREGA en cuenta de recursos
    AND  EXISTS (
           SELECT 1
           FROM   dbo.MovimientosCuenta m_ent WITH(NOLOCK)
           JOIN   dbo.CuentasCliente    cc_rec WITH(NOLOCK) ON cc_rec.CueIdCuenta  = m_ent.CueIdCuenta
                                                           AND cc_rec.CliIdCliente = c.CliIdCliente
                                                           AND cc_rec.CueTipo NOT IN (
                                                                 'DINERO_USD','DINERO_UYU',
                                                                 'USD','UYU','ARS','EUR','PYG','BRL',
                                                                 'CORRIENTE','CREDITO','DEBITO','CAJA'
                                                               )
           WHERE  m_ent.OrdIdOrden = dd.OrdIdOrden
             AND  m_ent.MovTipo = 'ENTREGA'
             AND  (m_ent.MovAnulado IS NULL OR m_ent.MovAnulado = 0)
         );

  PRINT 'Deudas canceladas: ' + CAST(@@ROWCOUNT AS VARCHAR);

  -- ══════════════════════════════════════════════════════════
  -- FIX 2: Anular solo los ORDEN monetarios con ENTREGA en recursos
  -- ══════════════════════════════════════════════════════════
  UPDATE m_ord
  SET    m_ord.MovAnulado       = 1,
         m_ord.MovObservaciones = ISNULL(m_ord.MovObservaciones,'') + ' [ANULADO: cubierto por ENTREGA en plan ROLLO]'
  FROM   dbo.MovimientosCuenta m_ord
  JOIN   dbo.CuentasCliente    cc_mon ON cc_mon.CueIdCuenta    = m_ord.CueIdCuenta
  JOIN   dbo.Clientes          c      ON c.CliIdCliente        = cc_mon.CliIdCliente
  JOIN   dbo.TiposClientes     tc     ON tc.TClIdTipoCliente   = c.TClIdTipoCliente
  WHERE  UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
    AND  cc_mon.CueTipo IN ('DINERO_USD','DINERO_UYU')
    AND  cc_mon.CueActiva = 1
    AND  m_ord.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
    AND  (m_ord.MovAnulado IS NULL OR m_ord.MovAnulado = 0)
    AND  m_ord.OrdIdOrden IS NOT NULL
    AND  m_ord.DocIdDocumento IS NULL
    AND  (m_ord.MovObservaciones IS NULL
          OR (m_ord.MovObservaciones NOT LIKE 'CUBIERTO%'
              AND m_ord.MovObservaciones NOT LIKE 'MATERIAL_CUBIERTO%'))
    -- Solo si esa orden tiene ENTREGA en cuenta de recursos
    AND  EXISTS (
           SELECT 1
           FROM   dbo.MovimientosCuenta m_ent WITH(NOLOCK)
           JOIN   dbo.CuentasCliente    cc_rec WITH(NOLOCK) ON cc_rec.CueIdCuenta  = m_ent.CueIdCuenta
                                                           AND cc_rec.CliIdCliente = c.CliIdCliente
                                                           AND cc_rec.CueTipo NOT IN (
                                                                 'DINERO_USD','DINERO_UYU',
                                                                 'USD','UYU','ARS','EUR','PYG','BRL',
                                                                 'CORRIENTE','CREDITO','DEBITO','CAJA'
                                                               )
           WHERE  m_ent.OrdIdOrden = m_ord.OrdIdOrden
             AND  m_ent.MovTipo = 'ENTREGA'
             AND  (m_ent.MovAnulado IS NULL OR m_ent.MovAnulado = 0)
         );

  PRINT 'Movimientos ORDEN anulados: ' + CAST(@@ROWCOUNT AS VARCHAR);

  -- ══════════════════════════════════════════════════════════
  -- FIX 3: Recalcular saldo de cuentas monetarias afectadas
  -- ══════════════════════════════════════════════════════════
  UPDATE cc_mon
  SET    cc_mon.CueSaldoActual = (
           SELECT ISNULL(SUM(m2.MovImporte), 0)
           FROM   dbo.MovimientosCuenta m2 WITH(NOLOCK)
           WHERE  m2.CueIdCuenta = cc_mon.CueIdCuenta
             AND  (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
             AND  m2.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
         )
  FROM   dbo.CuentasCliente cc_mon
  JOIN   dbo.Clientes       c   ON c.CliIdCliente      = cc_mon.CliIdCliente
  JOIN   dbo.TiposClientes  tc  ON tc.TClIdTipoCliente = c.TClIdTipoCliente
  WHERE  UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
    AND  cc_mon.CueTipo IN ('DINERO_USD','DINERO_UYU')
    AND  cc_mon.CueActiva = 1;

  PRINT 'Saldos monetarios recalculados: ' + CAST(@@ROWCOUNT AS VARCHAR);

  -- ══════════════════════════════════════════════════════════
  -- VERIFICACIÓN FINAL
  -- ══════════════════════════════════════════════════════════
  PRINT '── Estado final ──';
  SELECT
    RTRIM(LTRIM(c.Nombre))  AS Cliente,
    cc_mon.CueIdCuenta,
    cc_mon.CueTipo,
    cc_mon.CueSaldoActual,
    (SELECT COUNT(*) FROM dbo.DeudaDocumento dd
     WHERE  dd.CueIdCuenta = cc_mon.CueIdCuenta
       AND  dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')) AS DeudaVivaRestante
  FROM   dbo.CuentasCliente cc_mon
  JOIN   dbo.Clientes       c   ON c.CliIdCliente      = cc_mon.CliIdCliente
  JOIN   dbo.TiposClientes  tc  ON tc.TClIdTipoCliente = c.TClIdTipoCliente
  WHERE  UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
    AND  cc_mon.CueTipo IN ('DINERO_USD','DINERO_UYU')
    AND  cc_mon.CueActiva = 1
  ORDER  BY c.Nombre;

  -- Cambiar ROLLBACK → COMMIT cuando estés segura
  ROLLBACK;
  PRINT '';
  PRINT '  MODO DIAGNÓSTICO — sin cambios. Cambiar ROLLBACK → COMMIT para aplicar.';

END TRY
BEGIN CATCH
  ROLLBACK;
  PRINT '❌ Error: ' + ERROR_MESSAGE() + ' (línea ' + CAST(ERROR_LINE() AS VARCHAR) + ')';
END CATCH;
