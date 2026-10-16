/* ============================================================================
   diag_pagos_sin_respaldo_cliente.sql     SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Para UN cliente: todos los PAGO/ANTICIPO con PagIdPago que NO existe de
   verdad en dbo.Pagos — el mismo patron encontrado en PC-3894 de andrea
   silva (movimiento que dice tener un pago de caja real detras, pero ese
   pago no esta en ningun lado). Busca en TODAS las cuentas del cliente.

   EDITAR @CliIdCliente antes de correr.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @CliIdCliente INT = 2564;   -- <<< editar

SELECT
    RTRIM(c.Nombre) AS Cliente, m.CueIdCuenta, Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    m.MovFecha, Usuario = RTRIM(ISNULL(u.Usuario,'?')), m.MovTipo,
    Importe = CAST(m.MovImporte AS DECIMAL(18,2)), m.PagIdPago, m.DocIdDocumento,
    Concepto = LEFT(m.MovConcepto, 90)
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = m.MovUsuarioAlta
WHERE cc.CliIdCliente = @CliIdCliente
  AND m.MovTipo IN ('PAGO','ANTICIPO') AND m.PagIdPago IS NOT NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND NOT EXISTS (SELECT 1 FROM dbo.Pagos p WITH(NOLOCK) WHERE p.PagIdPago = m.PagIdPago)
ORDER BY m.MovFecha;
