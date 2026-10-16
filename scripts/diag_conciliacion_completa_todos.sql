/* ============================================================================
   diag_conciliacion_completa_todos.sql     SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Busca, entre los clientes Comunes tocados por el arreglo del cobro doble,
   los documentos que NO cierran por un error real — no los que solo
   parecen descuadrados porque la cobertura de billetera no queda atada al
   documento (esa se le atribuye ACA a traves de la orden, correctamente,
   antes de comparar).

   Por documento (solo ACEPTADO_DGI):
     Registrado = pagos reales + coberturas de sus ordenes (atribuidas via
                  ORDEN->OrdIdOrden, no via DocIdDocumento) + notas de
                  credito + cierres de ciclo + ajustes, convirtiendo la
                  moneda que no sea la del documento con la cotizacion de
                  HOY (margen 5% o $50, lo que sea mayor, por el tipo de
                  cambio viejo).
     Diferencia = Registrado - DocTotal
        > 0  -> se registro MAS de lo que vale el documento (sobrante real)
        < 0  -> se registro MENOS (falta cobrar, o el DocTotal esta mal)

   El objetivo es el mismo diagnostico que encontro ET-3523/NC-000012 de
   Iqui ferreri, pero para todos. No escribe ni ajusta nada.
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Coti DECIMAL(18,4);
SELECT TOP 1 @Coti = CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC;

IF OBJECT_ID('tempdb..#Docs') IS NOT NULL DROP TABLE #Docs;
SELECT dc.DocIdDocumento, dc.CliIdCliente, dc.MonIdMoneda, dc.DocTotal, dc.DocSerie, dc.DocNumero, dc.DocFechaEmision
INTO #Docs
FROM dbo.DocumentosContables dc WITH(NOLOCK)
WHERE ISNULL(dc.DocEstado,'') <> 'ANULADO'
  AND dc.CfeEstado = 'ACEPTADO_DGI'
  AND dc.CliIdCliente IN (
      SELECT DISTINCT cc.CliIdCliente FROM dbo.MovimientosCuenta mm WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = mm.CueIdCuenta
      WHERE mm.MovConcepto LIKE N'Correccion cobro doble billetera+caja%'
        AND (mm.MovAnulado IS NULL OR mm.MovAnulado = 0)
  );

-- Ordenes de cada documento (para atribuirle su cobertura, aunque la
-- cobertura en si tenga DocIdDocumento = NULL).
IF OBJECT_ID('tempdb..#OrdenesDelDoc') IS NOT NULL DROP TABLE #OrdenesDelDoc;
SELECT DISTINCT o.DocIdDocumento, o.OrdIdOrden
INTO #OrdenesDelDoc
FROM dbo.MovimientosCuenta o WITH(NOLOCK)
WHERE o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND o.DocIdDocumento IS NOT NULL
  AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
  AND o.DocIdDocumento IN (SELECT DocIdDocumento FROM #Docs);

IF OBJECT_ID('tempdb..#Registrado') IS NOT NULL DROP TABLE #Registrado;
SELECT d.DocIdDocumento,
       -- directo al documento
       PropiaMoneda = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
                     WHERE m.DocIdDocumento = d.DocIdDocumento AND cc2.CliIdCliente = d.CliIdCliente
                       AND cc2.MonIdMoneda = d.MonIdMoneda
                       AND m.MovTipo IN ('PAGO','ANTICIPO','PAGO_CRUZADO','NOTA_CREDITO','CIERRE_CICLO','AJUSTE_NEG','AJUSTE_POS')
                       AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
     + ISNULL((SELECT SUM(m.MovImporte) FROM #OrdenesDelDoc od
                     JOIN dbo.MovimientosCuenta m WITH(NOLOCK) ON m.OrdIdOrden = od.OrdIdOrden AND m.DocIdDocumento IS NULL
                     JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
                     WHERE od.DocIdDocumento = d.DocIdDocumento AND cc2.CliIdCliente = d.CliIdCliente
                       AND cc2.MonIdMoneda = d.MonIdMoneda AND m.MovTipo = 'PAGO_CRUZADO'
                       AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0),
       OtraMoneda = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                     JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
                     WHERE m.DocIdDocumento = d.DocIdDocumento AND cc2.CliIdCliente = d.CliIdCliente
                       AND cc2.MonIdMoneda <> d.MonIdMoneda
                       AND m.MovTipo IN ('PAGO','ANTICIPO','PAGO_CRUZADO','NOTA_CREDITO','CIERRE_CICLO','AJUSTE_NEG','AJUSTE_POS')
                       AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
     + ISNULL((SELECT SUM(m.MovImporte) FROM #OrdenesDelDoc od
                     JOIN dbo.MovimientosCuenta m WITH(NOLOCK) ON m.OrdIdOrden = od.OrdIdOrden AND m.DocIdDocumento IS NULL
                     JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
                     WHERE od.DocIdDocumento = d.DocIdDocumento AND cc2.CliIdCliente = d.CliIdCliente
                       AND cc2.MonIdMoneda <> d.MonIdMoneda AND m.MovTipo = 'PAGO_CRUZADO'
                       AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
INTO #Registrado
FROM #Docs d;

SELECT
    Cliente = RTRIM(cli.Nombre), d.CliIdCliente,
    Doc = RTRIM(d.DocSerie) + '-' + CAST(d.DocNumero AS VARCHAR),
    d.DocIdDocumento, d.DocFechaEmision,
    MonedaDoc = CASE WHEN d.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    DocTotal = CAST(d.DocTotal AS DECIMAL(18,2)),
    PropiaMoneda = CAST(r.PropiaMoneda AS DECIMAL(18,2)),
    OtraMonedaConvertida = CAST(r.OtraMoneda * CASE WHEN d.MonIdMoneda = 2 THEN 1.0/@Coti ELSE @Coti END AS DECIMAL(18,2)),
    Diferencia = CAST(r.PropiaMoneda + r.OtraMoneda * CASE WHEN d.MonIdMoneda = 2 THEN 1.0/@Coti ELSE @Coti END - d.DocTotal AS DECIMAL(18,2))
FROM #Docs d
JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = d.CliIdCliente
JOIN #Registrado r ON r.DocIdDocumento = d.DocIdDocumento
WHERE ABS(r.PropiaMoneda + r.OtraMoneda * CASE WHEN d.MonIdMoneda = 2 THEN 1.0/@Coti ELSE @Coti END - d.DocTotal)
      > CASE WHEN d.DocTotal * 0.05 > 50 THEN d.DocTotal * 0.05 ELSE 50 END
ORDER BY d.CliIdCliente, ABS(r.PropiaMoneda + r.OtraMoneda * CASE WHEN d.MonIdMoneda = 2 THEN 1.0/@Coti ELSE @Coti END - d.DocTotal) DESC;

DROP TABLE #Docs;
DROP TABLE #OrdenesDelDoc;
DROP TABLE #Registrado;
