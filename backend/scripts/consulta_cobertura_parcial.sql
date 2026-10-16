-- ============================================================
-- Verificar si los ROLLO con cobertura parcial tienen deuda monetaria
-- por los metros que el plan no alcanzó a cubrir
-- ============================================================
SELECT
  RTRIM(LTRIM(c.Nombre))          AS Cliente,
  od.OrdCodigoOrden               AS Orden,
  m_rec.MovConcepto               AS CoberturaMetros,
  ABS(m_rec.MovImporte)           AS MetrosCubiertos,

  -- ¿Quedó algún movimiento monetario para esta misma orden?
  m_din.MovIdMovimiento           AS MovMonetario_ID,
  m_din.MovTipo                   AS MovMonetario_Tipo,
  ABS(m_din.MovImporte)           AS MovMonetario_Importe,
  cc_din.CueTipo                  AS CuentaMonetaria,
  m_din.MovAnulado,

  -- ¿Hay deuda pendiente?
  dd.DDeIdDocumento,
  dd.DDeEstado,
  dd.DDeImportePendiente

FROM       dbo.MovimientosCuenta m_rec  WITH(NOLOCK)
JOIN       dbo.CuentasCliente    cc_rec WITH(NOLOCK) ON cc_rec.CueIdCuenta    = m_rec.CueIdCuenta
JOIN       dbo.Clientes          c      WITH(NOLOCK) ON c.CliIdCliente        = cc_rec.CliIdCliente
JOIN       dbo.TiposClientes     tc     WITH(NOLOCK) ON tc.TClIdTipoCliente   = c.TClIdTipoCliente
LEFT JOIN  dbo.OrdenesDeposito   od     WITH(NOLOCK) ON od.OrdIdOrden         = m_rec.OrdIdOrden

-- Movimiento monetario para la misma orden
LEFT JOIN  dbo.MovimientosCuenta m_din  WITH(NOLOCK) ON m_din.OrdIdOrden      = m_rec.OrdIdOrden
                                                     AND m_din.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
LEFT JOIN  dbo.CuentasCliente    cc_din WITH(NOLOCK) ON cc_din.CueIdCuenta    = m_din.CueIdCuenta
                                                     AND cc_din.CueTipo IN ('DINERO_USD','DINERO_UYU')

-- Deuda documento
LEFT JOIN  dbo.DeudaDocumento    dd     WITH(NOLOCK) ON dd.OrdIdOrden         = m_rec.OrdIdOrden
                                                     AND dd.DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')

WHERE  m_rec.MovConcepto LIKE 'Cobertura parcial%'
  AND  (m_rec.MovAnulado IS NULL OR m_rec.MovAnulado = 0)
  AND  cc_rec.CueTipo NOT IN (
         'DINERO_USD','DINERO_UYU','USD','UYU','ARS','EUR',
         'PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA'
       )
  AND  UPPER(tc.TClDescripcion) LIKE '%ROLLO%'

ORDER BY c.Nombre;
