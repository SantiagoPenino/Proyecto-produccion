/* ============================================================================
   diag_pago_puntual.sql                   SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Detalle completo de un documento puntual: todos sus movimientos (todas
   las cuentas del cliente) con su PagIdPago, y el detalle real de cada
   PagIdPago encontrado en dbo.Pagos (metodo, fecha, monto, usuario).

   Sirve para confirmar si dos "PAGO" atados al mismo documento son dos
   cobros de caja realmente distintos, o la misma venta contado partida en
   dos monedas (normal, no es un problema).

   EDITAR @DocIdDocumento antes de correr.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @DocIdDocumento INT = 4735;   -- <<< editar: andrea silva ET-3182

SELECT dc.DocIdDocumento, Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
       MonedaDoc = CASE WHEN dc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2)), dc.CfeEstado, dc.CliIdCliente
FROM dbo.DocumentosContables dc WITH(NOLOCK) WHERE dc.DocIdDocumento = @DocIdDocumento;

SELECT
    m.MovIdMovimiento, m.CueIdCuenta, Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    m.MovFecha, Usuario = RTRIM(ISNULL(u.Usuario,'?')), m.MovTipo,
    Importe = CAST(m.MovImporte AS DECIMAL(18,2)), m.OrdIdOrden, m.PagIdPago,
    Concepto = LEFT(m.MovConcepto, 100)
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = m.MovUsuarioAlta
WHERE m.DocIdDocumento = @DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY m.MovFecha;

-- El detalle real de cada PagIdPago involucrado
SELECT p.PagIdPago, p.MPaIdMetodoPago, Moneda = CASE WHEN p.PagIdMonedaPago=2 THEN 'US$' ELSE '$' END,
       PagMontoPago = CAST(p.PagMontoPago AS DECIMAL(18,2)), p.PagFechaPago, p.PagUsuarioAlta,
       p.PagTcaIdTransaccion, p.PagCotizacion, PagMontoConvertido = CAST(p.PagMontoConvertido AS DECIMAL(18,2))
FROM dbo.Pagos p WITH(NOLOCK)
WHERE p.PagIdPago IN (
    SELECT DISTINCT m.PagIdPago FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    WHERE m.DocIdDocumento = @DocIdDocumento AND m.PagIdPago IS NOT NULL
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
);

-- Todas las ordenes (y sus totales) que este documento agrupa
SELECT o.OrdIdOrden, o.MovFecha, Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       Importe = CAST(o.MovImporte AS DECIMAL(18,2)), Concepto = LEFT(o.MovConcepto,80)
FROM dbo.MovimientosCuenta o WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = o.CueIdCuenta
WHERE o.DocIdDocumento = @DocIdDocumento AND o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
ORDER BY o.MovFecha;
