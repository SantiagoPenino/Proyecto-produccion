-- ============================================================
-- DIAGNÓSTICO PRECISO: Deudas monetarias duplicadas en clientes ROLLO
--
-- Solo muestra deudas donde la MISMA ORDEN tiene:
--   ✅ ENTREGA en cuenta de recursos (metros descontados)
--   ❌ ORDEN en cuenta monetaria (dinero cobrado también)
-- Eso es la duplicación incorrecta.
-- ============================================================

-- 1. RESUMEN POR CLIENTE — solo los verdaderamente afectados
SELECT
  c.CliIdCliente,
  RTRIM(LTRIM(c.Nombre))           AS Cliente,
  RTRIM(LTRIM(tc.TClDescripcion))  AS TipoCliente,
  cc_usd.CueIdCuenta               AS CuentaMonetaria,
  cc_usd.CueTipo,
  cc_usd.CueSaldoActual,
  COUNT(DISTINCT m_ord.MovIdMovimiento) AS OrdenesConDeudaDuplicada,
  SUM(ABS(m_ord.MovImporte))           AS TotalDineroACancelar

FROM       dbo.Clientes          c      WITH(NOLOCK)
JOIN       dbo.TiposClientes     tc     WITH(NOLOCK) ON tc.TClIdTipoCliente  = c.TClIdTipoCliente
-- Cuenta monetaria donde está la deuda incorrecta
JOIN       dbo.CuentasCliente    cc_usd WITH(NOLOCK) ON cc_usd.CliIdCliente  = c.CliIdCliente
                                                     AND cc_usd.CueTipo IN ('DINERO_USD','DINERO_UYU')
                                                     AND cc_usd.CueActiva    = 1
-- Movimiento ORDEN en la cuenta monetaria (la deuda incorrecta)
JOIN       dbo.MovimientosCuenta m_ord  WITH(NOLOCK) ON m_ord.CueIdCuenta   = cc_usd.CueIdCuenta
                                                     AND m_ord.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                                                     AND (m_ord.MovAnulado IS NULL OR m_ord.MovAnulado = 0)
                                                     AND m_ord.OrdIdOrden IS NOT NULL
-- La misma orden TAMBIÉN tiene ENTREGA en cuenta de recursos (metros descontados)
-- → eso confirma que fue cubierta por plan, no debería tener deuda monetaria
WHERE  UPPER(tc.TClDescripcion) LIKE '%ROLLO%'
  AND  EXISTS (
         SELECT 1
         FROM   dbo.MovimientosCuenta m_ent WITH(NOLOCK)
         JOIN   dbo.CuentasCliente    cc_rec WITH(NOLOCK) ON cc_rec.CueIdCuenta = m_ent.CueIdCuenta
                                                          AND cc_rec.CliIdCliente = c.CliIdCliente
                                                          AND cc_rec.CueTipo NOT IN (
                                                                'DINERO_USD','DINERO_UYU',
                                                                'USD','UYU','ARS','EUR','PYG','BRL',
                                                                'CORRIENTE','CREDITO','DEBITO','CAJA'
                                                              )
         WHERE  m_ent.OrdIdOrden = m_ord.OrdIdOrden
           AND  m_ent.MovTipo = 'ENTREGA'
           AND  (m_ent.MovAnulado IS NULL OR m_ent.MovAnulado = 0)
       )

GROUP BY c.CliIdCliente, c.Nombre, tc.TClDescripcion, cc_usd.CueIdCuenta, cc_usd.CueTipo, cc_usd.CueSaldoActual
ORDER BY TotalDineroACancelar DESC;


-- ============================================================
-- 2. DETALLE POR ORDEN — cada orden duplicada con sus dos movimientos
-- ============================================================
SELECT
  RTRIM(LTRIM(c.Nombre))          AS Cliente,
  m_ord.OrdIdOrden,
  COALESCE(od.OrdCodigoOrden,'—') AS CodigoOrden,
  -- El movimiento monetario incorrecto
  m_ord.MovIdMovimiento           AS MovMonetario_ID,
  m_ord.MovImporte                AS MovMonetario_Importe,
  cc_usd.CueTipo                  AS CuentaMonetaria,
  -- El movimiento de recursos que confirma que ya estaba cubierto
  m_ent.MovIdMovimiento           AS MovRecurso_ID,
  m_ent.MovImporte                AS MovRecurso_Metros,
  -- Deuda documento pendiente
  dd.DDeIdDocumento,
  dd.DDeImportePendiente,
  dd.DDeEstado

FROM       dbo.Clientes          c      WITH(NOLOCK)
JOIN       dbo.TiposClientes     tc     WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
JOIN       dbo.CuentasCliente    cc_usd WITH(NOLOCK) ON cc_usd.CliIdCliente = c.CliIdCliente
                                                     AND cc_usd.CueTipo IN ('DINERO_USD','DINERO_UYU')
                                                     AND cc_usd.CueActiva = 1
JOIN       dbo.MovimientosCuenta m_ord  WITH(NOLOCK) ON m_ord.CueIdCuenta  = cc_usd.CueIdCuenta
                                                     AND m_ord.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                                                     AND (m_ord.MovAnulado IS NULL OR m_ord.MovAnulado = 0)
                                                     AND m_ord.OrdIdOrden IS NOT NULL
-- El ENTREGA correspondiente en recursos
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
LEFT JOIN  dbo.OrdenesDeposito   od     WITH(NOLOCK) ON od.OrdIdOrden      = m_ord.OrdIdOrden
LEFT JOIN  dbo.DeudaDocumento    dd     WITH(NOLOCK) ON dd.CueIdCuenta     = cc_usd.CueIdCuenta
                                                     AND dd.OrdIdOrden     = m_ord.OrdIdOrden
                                                     AND dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')

WHERE  UPPER(tc.TClDescripcion) LIKE '%ROLLO%'

ORDER BY c.Nombre, m_ord.OrdIdOrden;
