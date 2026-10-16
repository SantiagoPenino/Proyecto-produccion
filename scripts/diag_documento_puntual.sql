/* ============================================================================
   diag_documento_puntual.sql              SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Movimientos crudos de UN documento puntual, en TODAS las cuentas del
   cliente (para ver si algun pago quedo cargado en la moneda equivocada,
   como se sospecha de GSPORT ET-7128 y otros con numeros absurdos).

   EDITAR @DocIdDocumento antes de correr.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @DocIdDocumento INT = 10462;   -- <<< editar: Horacio Vaiz PC-3890

SELECT dc.DocIdDocumento, Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
       MonedaDoc = CASE WHEN dc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2)), dc.CfeEstado, dc.DocEstado, dc.CliIdCliente
FROM dbo.DocumentosContables dc WITH(NOLOCK) WHERE dc.DocIdDocumento = @DocIdDocumento;

SELECT
    m.MovIdMovimiento, m.CueIdCuenta, Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    m.MovFecha, Usuario = RTRIM(ISNULL(u.Usuario,'?')), m.MovTipo,
    Importe = CAST(m.MovImporte AS DECIMAL(18,2)), m.OrdIdOrden, m.PagIdPago,
    Concepto = LEFT(m.MovConcepto, 100), Anulado = ISNULL(m.MovAnulado,0)
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = m.MovUsuarioAlta
WHERE m.DocIdDocumento = @DocIdDocumento
ORDER BY m.MovFecha;

-- Tambien las coberturas de sus ordenes (DocIdDocumento NULL, atadas por OrdIdOrden)
SELECT
    m.MovIdMovimiento, m.CueIdCuenta, Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    m.MovFecha, m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)), m.OrdIdOrden,
    Concepto = LEFT(m.MovConcepto, 100)
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento IS NULL AND m.MovTipo = 'PAGO_CRUZADO'
  AND m.OrdIdOrden IN (SELECT DISTINCT OrdIdOrden FROM dbo.MovimientosCuenta WITH(NOLOCK)
                        WHERE DocIdDocumento = @DocIdDocumento AND MovTipo IN ('ORDEN','ORDEN_ANTICIPO'))
ORDER BY m.MovFecha;
