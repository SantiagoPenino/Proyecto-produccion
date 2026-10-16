/* ============================================================================
   diag_cobertura_sin_pago_real.sql        SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Para un cliente Comun, todo retiro tiene que terminar en documento PAGADO
   o en deuda documentada (si es a credito) — nunca en un saldo suelto. Este
   script busca, para un cliente puntual, las coberturas internas
   (PAGO_CRUZADO "Cobertura desde.../Cruce automatico", sin PagIdPago) que
   TODAVIA no se corrigieron, y muestra el documento de la orden que cubren,
   con el total del documento y CADA pago real (con PagIdPago) que tenga, en
   la moneda en que se registro cada uno (sin convertir nada, para no
   arriesgar otro error de conversion).

   Con esto se decide, documento por documento:
     - Si el total ya esta cubierto por pagos reales -> la cobertura de esa
       orden es el mismo caso que ET-4408/ET-4461: se puede revertir igual.
     - Si NO esta cubierto -> ese trabajo nunca se cobro de verdad, es un
       problema aparte (cobro faltante), no se revierte la cobertura sin
       decidir primero que hacer con esa deuda real.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @CliIdCliente INT = 795;   -- <<< editar por cliente

IF OBJECT_ID('tempdb..#Coberturas') IS NOT NULL DROP TABLE #Coberturas;

-- La cobertura cuelga del OrdIdOrden; el documento real es el del cargo ORDEN de esa orden.
SELECT m.MovIdMovimiento, m.OrdIdOrden, m.CueIdCuenta AS CuentaCobertura, m.MovImporte AS Cobertura,
       od.DocIdDocumento
INTO   #Coberturas
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
CROSS APPLY (
    SELECT TOP 1 o.DocIdDocumento FROM dbo.MovimientosCuenta o WITH(NOLOCK)
    WHERE o.OrdIdOrden = m.OrdIdOrden AND o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
      AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
) od
WHERE cc.CliIdCliente = @CliIdCliente
  AND m.MovTipo = 'PAGO_CRUZADO' AND m.MovImporte > 0 AND m.PagIdPago IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0);

-- ── Resumen por documento: total, coberturas fantasma, y deuda viva ───────
SELECT
    Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
    dc.DocIdDocumento, dc.CfeEstado,
    MonedaDoc = CASE WHEN dc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2)),
    CoberturaFantasma = CAST(SUM(x.Cobertura) AS DECIMAL(18,2)),
    VivaDoc = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                  WHERE dd.DocIdDocumento = dc.DocIdDocumento AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                    AND dd.DDeImportePendiente > 0.01), 0) AS DECIMAL(18,2))
FROM #Coberturas x
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = x.DocIdDocumento
GROUP BY dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.CfeEstado, dc.MonIdMoneda, dc.DocTotal
ORDER BY dc.DocIdDocumento;

-- ── Detalle: cada pago real (PagIdPago no nulo) que tenga ese documento,   ─
--    en TODAS las cuentas/monedas del cliente, sin convertir nada.        ─
SELECT
    Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
    dc.DocIdDocumento,
    Cuenta = p.CueIdCuenta, Moneda = CASE WHEN cc2.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    p.MovFecha, Usuario = RTRIM(ISNULL(u.Usuario,'?')),
    PagoReal = CAST(p.MovImporte AS DECIMAL(18,2)), p.PagIdPago,
    Concepto = LEFT(p.MovConcepto, 90)
FROM (SELECT DISTINCT DocIdDocumento FROM #Coberturas) d
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = d.DocIdDocumento
JOIN dbo.MovimientosCuenta p WITH(NOLOCK) ON p.DocIdDocumento = d.DocIdDocumento
     AND p.MovTipo IN ('PAGO','ANTICIPO') AND p.MovImporte > 0 AND p.PagIdPago IS NOT NULL
     AND (p.MovAnulado IS NULL OR p.MovAnulado = 0)
JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = p.CueIdCuenta
LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = p.MovUsuarioAlta
ORDER BY dc.DocIdDocumento, p.MovFecha;

DROP TABLE #Coberturas;
