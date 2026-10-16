-- =====================================================================================
-- diag_rollo_costo_vs_cobertura.sql  —  SOLO LECTURA (no modifica nada)
-- Caso Panda Soluciones (CliId 423), 1 y 3 de setiembre 2026.
--
-- Qué busca: órdenes de clientes "Rollo por adelantado" que entraron a depósito con
-- OrdCostoFinal > 0 (precio fijado al CREAR la orden, cuando no había plan activo) pero
-- cuyos metros SÍ se descontaron de un plan al INGRESAR a depósito (ENTREGA 'Plan #N').
-- Con costo > 0 el retiro frena (crearRetiro mira el costo) y la caja las cobra/factura
-- de nuevo aunque el rollo ya las pagó.
-- Validado contra la réplica local el 03-09-2026.
-- =====================================================================================

-- BLOQUE 1 — Panda: las órdenes del caso, con lo que descontó el plan y con qué se "cobró"
SELECT od.OrdCodigoOrden, od.OrdCantidad, od.OrdCostoFinal,
       o.FechaIngreso            AS FechaCreacionOrden,
       od.OrdFechaIngresoOrden   AS FechaIngresoDeposito,
       mts.MetrosPlan, mts.Obs   AS PlanQueDesconto,
       od.OReIdOrdenRetiro, od.PagIdPago, p.MPaIdMetodoPago, p.PagMontoPago,
       t.TcaSerieDoc, t.TcaNumeroDoc, d.DocIdDocumento, d.CfeEstado
FROM dbo.OrdenesDeposito od WITH(NOLOCK)
JOIN dbo.Ordenes o WITH(NOLOCK) ON o.CodigoOrden = od.OrdCodigoOrden
OUTER APPLY (
    SELECT SUM(-m.MovImporte) AS MetrosPlan, MAX(m.MovObservaciones) AS Obs
    FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.OrdIdOrden = o.OrdenID AND cc.CliIdCliente = od.CliIdCliente
      AND cc.CueTipo NOT IN ('DINERO_USD','DINERO_UYU')
      AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado,0) = 0
      AND m.MovObservaciones LIKE 'Plan #%'
) mts
LEFT JOIN dbo.Pagos               p WITH(NOLOCK) ON p.PagIdPago = od.PagIdPago
LEFT JOIN dbo.TransaccionesCaja   t WITH(NOLOCK) ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
LEFT JOIN dbo.DocumentosContables d WITH(NOLOCK) ON d.TcaIdTransaccion = t.TcaIdTransaccion
WHERE od.CliIdCliente = 423 AND od.OrdFechaIngresoOrden >= '2026-08-25'
ORDER BY od.OrdFechaIngresoOrden;

-- BLOQUE 2 — TODOS los clientes rollo desde el 1/7: costo > 0 y metros descontados de un plan
-- Cobertura TOTAL = el plan cubrió toda la cantidad (no debería haber costo).
-- Cobertura PARCIAL = cubrió parte (el costo debería ser solo el excedente).
SELECT od.OrdCodigoOrden, od.CliIdCliente, c.IDCliente,
       od.OrdCantidad, mts.MetrosPlan,
       CASE WHEN mts.MetrosPlan >= od.OrdCantidad - 0.005 THEN 'TOTAL' ELSE 'PARCIAL' END AS Cobertura,
       od.OrdCostoFinal, od.MonIdMoneda,
       o.FechaIngreso AS FechaCreacionOrden, od.OrdFechaIngresoOrden AS FechaIngresoDeposito,
       od.OReIdOrdenRetiro, r.OReEstadoActual, od.PagIdPago,
       p.MPaIdMetodoPago, mp.MPaDescripcionMetodo, p.PagMontoPago,
       t.TcaSerieDoc, t.TcaNumeroDoc, d.DocIdDocumento, d.CfeEstado
FROM dbo.OrdenesDeposito od WITH(NOLOCK)
JOIN dbo.Clientes      c  WITH(NOLOCK) ON c.CliIdCliente = od.CliIdCliente
JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente AND tc.TClDescripcion LIKE '%ROLLO%'
JOIN dbo.Ordenes       o  WITH(NOLOCK) ON o.CodigoOrden = od.OrdCodigoOrden
CROSS APPLY (
    SELECT SUM(-m.MovImporte) AS MetrosPlan
    FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.OrdIdOrden = o.OrdenID AND cc.CliIdCliente = od.CliIdCliente
      AND cc.CueTipo NOT IN ('DINERO_USD','DINERO_UYU')
      AND m.MovTipo = 'ENTREGA' AND ISNULL(m.MovAnulado,0) = 0
      AND m.MovObservaciones LIKE 'Plan #%'
) mts
LEFT JOIN dbo.OrdenesRetiro       r  WITH(NOLOCK) ON r.OReIdOrdenRetiro = od.OReIdOrdenRetiro
LEFT JOIN dbo.Pagos               p  WITH(NOLOCK) ON p.PagIdPago = od.PagIdPago
LEFT JOIN dbo.MetodosPagos        mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
LEFT JOIN dbo.TransaccionesCaja   t  WITH(NOLOCK) ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
LEFT JOIN dbo.DocumentosContables d  WITH(NOLOCK) ON d.TcaIdTransaccion = t.TcaIdTransaccion
WHERE od.OrdFechaIngresoOrden >= '2026-07-01'
  AND od.OrdCostoFinal > 0
  AND mts.MetrosPlan > 0
ORDER BY od.OrdFechaIngresoOrden;

-- BLOQUE 3 — Uso del medio de pago "Rollo por adelantado" (MPaIdMetodoPago 7) por mes y tipo de documento
-- Sirve para dimensionar cuántos CFE (ET/FA) se emitieron "pagados" con el rollo.
SELECT CONVERT(varchar(7), p.PagFechaPago, 120) AS Mes, t.TcaSerieDoc, ISNULL(d.CfeEstado,'(sin doc)') AS CfeEstado,
       COUNT(*) AS Pagos,
       SUM(CASE WHEN p.PagIdMonedaPago = 2 THEN p.PagMontoPago ELSE 0 END) AS TotalUSD,
       SUM(CASE WHEN p.PagIdMonedaPago = 1 THEN p.PagMontoPago ELSE 0 END) AS TotalUYU
FROM dbo.Pagos p WITH(NOLOCK)
JOIN dbo.TransaccionesCaja t WITH(NOLOCK) ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
LEFT JOIN dbo.DocumentosContables d WITH(NOLOCK) ON d.TcaIdTransaccion = t.TcaIdTransaccion
WHERE p.MPaIdMetodoPago = 7 AND p.PagFechaPago >= '2026-07-01'
GROUP BY CONVERT(varchar(7), p.PagFechaPago, 120), t.TcaSerieDoc, ISNULL(d.CfeEstado,'(sin doc)')
ORDER BY Mes, t.TcaSerieDoc, CfeEstado;
