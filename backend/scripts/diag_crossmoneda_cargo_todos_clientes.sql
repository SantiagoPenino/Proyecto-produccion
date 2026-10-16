/* ============================================================================
   diag_crossmoneda_cargo_todos_clientes.sql   —   SOLO LECTURA
   ----------------------------------------------------------------------------
   Variante de diag_crossmoneda_todos_clientes.sql (BUG 2 del catálogo), pero
   mirando el CARGO (VTA_CAJA/CIERRE_CICLO) en vez del PAGO/COBRO.

   Encontrado el 21/7 revisando los 5 clientes del lote de BUG 2 (elea,
   Martina Berriel, Rdssport, SRL Tienda Online, Ventas local USER): en varios
   de esos mismos documentos, además del pago cruzado (ya corregido), el CARGO
   también cayó en la cuenta de la moneda equivocada, con el mismo número sin
   convertir. El detector original (diag_crossmoneda_todos_clientes.sql) solo
   mira MovTipo IN ('PAGO','COBRO') y por eso nunca lo vio.

   Join por CueTipo, no por CuentasCliente.MonIdMoneda — esa columna viene
   NULL en algunas cuentas (ver comentario en fix_crossmoneda_lote1.sql), y
   comparar contra NULL nunca matchea (falso negativo).
   ============================================================================ */

SET NOCOUNT ON;

SELECT
    Cliente      = RTRIM(c.Nombre),
    dc.CliIdCliente,
    Doc          = RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero),
    dc.DocIdDocumento,
    DocMoneda    = moDoc.MonSimbolo,
    DocTotal     = CAST(dc.DocTotal AS DECIMAL(18,2)),
    CargoCueTipo = RTRIM(ccC.CueTipo),
    CargoImporte = CAST(cargo.MovImporte AS DECIMAL(18,2)),
    CargoMovId   = cargo.MovIdMovimiento,
    CargoTipo    = cargo.MovTipo,
    MismoNumero  = CASE WHEN ABS(ABS(cargo.MovImporte) - dc.DocTotal) <= 1 THEN 'SÍ' ELSE '' END
FROM dbo.DocumentosContables dc
JOIN dbo.Clientes c ON c.CliIdCliente = dc.CliIdCliente
JOIN dbo.Monedas moDoc ON moDoc.MonIdMoneda = dc.MonIdMoneda
CROSS APPLY (
    SELECT TOP 1 m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte, m.MovTipo
    FROM dbo.MovimientosCuenta m
    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovImporte <> 0
) cargo
JOIN dbo.CuentasCliente ccC ON ccC.CueIdCuenta = cargo.CueIdCuenta
WHERE dc.DocEstado <> 'ANULADO'
  AND ccC.CueTipo <> CASE WHEN dc.MonIdMoneda = 1 THEN 'DINERO_UYU' ELSE 'DINERO_USD' END
ORDER BY MismoNumero DESC, c.Nombre, dc.DocIdDocumento DESC;
