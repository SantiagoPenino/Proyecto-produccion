/* ============================================================================
   diag_estado_cuenta_corrido.sql          SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Estado de cuenta reconstruido de un cliente, en sus DOS monedas, con
   SALDO CORRIDO (acumulado, igual que MovSaldoPosterior pero recalculado
   desde cero excluyendo ORDEN/ORDEN_ANTICIPO) para ver a simple vista en
   que movimiento puntual salta el saldo — en vez de tener que sumar a
   mano todo el historial.

   Bloque 1: busca CUALQUIER movimiento (cualquier cuenta, cualquier
             moneda) atado a un documento puntual — para confirmar si un
             pago quedo cargado en la moneda equivocada.
   Bloque 2 y 3: estado de cuenta corrido de cada cuenta principal
             (pesos y dolares), ordenado por fecha.

   EDITAR @CliIdCliente y @DocIdDocumentoAVerificar antes de correr.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @CliIdCliente INT = 5205;         -- <<< editar: Horacio Vaiz
DECLARE @DocIdDocumentoAVerificar INT = NULL;  -- sin doc puntual todavia

SELECT 'Bloque 1: cualquier movimiento atado a este documento, cualquier cuenta' AS etapa;
SELECT m.MovIdMovimiento, m.CueIdCuenta, Moneda = CASE WHEN cc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
       RTRIM(c.Nombre) AS Cliente, m.MovFecha, m.MovTipo,
       Importe = CAST(m.MovImporte AS DECIMAL(18,2)), m.PagIdPago, Concepto = LEFT(m.MovConcepto,90)
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE m.DocIdDocumento = @DocIdDocumentoAVerificar
ORDER BY m.MovFecha;

SELECT 'Bloque 2: estado de cuenta corrido — PESOS' AS etapa;
;WITH mov AS (
    SELECT m.*, cc.MonIdMoneda FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @CliIdCliente AND cc.CueEsPrincipal = 1 AND cc.MonIdMoneda = 1
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
)
SELECT MovFecha, MovTipo, Importe = CAST(MovImporte AS DECIMAL(18,2)),
       CuentaEnSaldo = CASE WHEN MovTipo IN ('ORDEN','ORDEN_ANTICIPO') THEN 'NO' ELSE 'SI' END,
       SaldoCorrido = CAST(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') THEN MovImporte ELSE 0 END)
                     OVER (ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS DECIMAL(18,2)),
       OrdIdOrden, DocIdDocumento, Usuario = MovUsuarioAlta, Concepto = LEFT(MovConcepto,90)
FROM mov
ORDER BY MovFecha, MovIdMovimiento;

SELECT 'Bloque 3: estado de cuenta corrido — DOLARES' AS etapa;
;WITH mov AS (
    SELECT m.*, cc.MonIdMoneda FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @CliIdCliente AND cc.CueEsPrincipal = 1 AND cc.MonIdMoneda = 2
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
)
SELECT MovFecha, MovTipo, Importe = CAST(MovImporte AS DECIMAL(18,2)),
       CuentaEnSaldo = CASE WHEN MovTipo IN ('ORDEN','ORDEN_ANTICIPO') THEN 'NO' ELSE 'SI' END,
       SaldoCorrido = CAST(SUM(CASE WHEN MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') THEN MovImporte ELSE 0 END)
                     OVER (ORDER BY MovFecha, MovIdMovimiento ROWS UNBOUNDED PRECEDING) AS DECIMAL(18,2)),
       OrdIdOrden, DocIdDocumento, Usuario = MovUsuarioAlta, Concepto = LEFT(MovConcepto,90)
FROM mov
ORDER BY MovFecha, MovIdMovimiento;
