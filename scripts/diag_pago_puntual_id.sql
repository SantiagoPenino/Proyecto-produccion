/* ============================================================================
   diag_pago_puntual_id.sql                SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Detalle real de UN PagIdPago puntual: metodo de pago, moneda, fecha,
   usuario. Sirve para confirmar si un pago sin VTA_CAJA visible es un
   anticipo real (metodo de pago valido, transaccion real) o un dato mal
   cargado.

   EDITAR @PagIdPago antes de correr.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @PagIdPago INT = 61467;   -- <<< editar: andrea silva PC-3894

SELECT p.PagIdPago,
       MetodoPago = mp.MPaDescripcionMetodo,
       Moneda = CASE WHEN p.PagIdMonedaPago=2 THEN 'US$' ELSE '$' END,
       PagMontoPago = CAST(p.PagMontoPago AS DECIMAL(18,2)),
       p.PagFechaPago,
       Usuario = RTRIM(ISNULL(u.Usuario,'?')),
       p.PagTcaIdTransaccion, p.PagCotizacion,
       PagMontoConvertido = CAST(p.PagMontoConvertido AS DECIMAL(18,2)),
       p.PagRutaComprobante
FROM dbo.Pagos p WITH(NOLOCK)
LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = p.PagUsuarioAlta
LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
WHERE p.PagIdPago = @PagIdPago;
