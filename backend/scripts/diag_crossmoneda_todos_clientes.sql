/* ============================================================================
   diag_crossmoneda_todos_clientes.sql   —   SOLO LECTURA
   ----------------------------------------------------------------------------
   Igual criterio que diag_crossmoneda_cliente.sql (ver ese archivo para el
   detalle del bug), pero barriendo TODOS los clientes en vez de uno solo.

   Busca documentos donde el PAGO cayó en una cuenta de moneda distinta a la
   del documento. Eso NO es la conversión normal del cierre de ciclo (orden en
   US$ facturada en $, que es esperada) — es la anomalía real tipo PC-1451,
   donde el pago quedó anotado en la cuenta equivocada.

   MismoNumero = 'SÍ' marca los casos donde, además, el importe del pago
   coincide con el total del documento (±$1) — el patrón exacto de PC-1451:
   alguien cobró el importe correcto pero lo cargó en la cuenta de moneda que
   no correspondía. Esos son los candidatos más claros a mover de cuenta con
   el mismo tipo de fix puntual (ver fix_crossmoneda_pc1451.sql como plantilla).

   Sin MismoNumero (importe del pago distinto al total del doc) suele ser un
   pago PARCIAL a propósito en otra moneda (excedente/vuelto en dólares sobre
   una factura en pesos, o viceversa) — comportamiento soportado, revisar caso
   a caso antes de asumir que es un error.
   ============================================================================ */

SET NOCOUNT ON;

SELECT
    Cliente      = RTRIM(c.Nombre),
    dc.CliIdCliente,
    Doc          = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero),
    dc.DocIdDocumento,
    DocMoneda    = moDoc.MonSimbolo,
    DocTotal     = CAST(dc.DocTotal AS DECIMAL(18,2)),
    PagoMoneda   = moP.MonSimbolo,
    PagoImporte  = CAST(pago.MovImporte AS DECIMAL(18,2)),
    PagoCueId    = pago.CueIdCuenta,
    PagoMovId    = pago.MovIdMovimiento,
    MismoNumero  = CASE WHEN ABS(ABS(pago.MovImporte) - dc.DocTotal) <= 1 THEN 'SÍ' ELSE '' END
FROM dbo.DocumentosContables dc
JOIN dbo.Clientes c ON c.CliIdCliente = dc.CliIdCliente
JOIN dbo.Monedas moDoc ON moDoc.MonIdMoneda = dc.MonIdMoneda
CROSS APPLY (
    SELECT TOP 1 m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte
    FROM dbo.MovimientosCuenta m
    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('PAGO','COBRO')
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
) pago
JOIN dbo.CuentasCliente ccP ON ccP.CueIdCuenta = pago.CueIdCuenta
JOIN dbo.Monedas moP ON moP.MonIdMoneda = ccP.MonIdMoneda
WHERE dc.DocEstado <> 'ANULADO'
  AND ccP.MonIdMoneda <> dc.MonIdMoneda
ORDER BY MismoNumero DESC, c.Nombre, dc.DocIdDocumento DESC;
