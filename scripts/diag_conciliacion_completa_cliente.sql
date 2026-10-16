/* ============================================================================
   diag_conciliacion_completa_cliente.sql   SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Para UN cliente: revisa TODOS los documentos (PC/ET/FA) que tocan sus
   cuentas de dinero, y compara DocTotal contra lo que realmente entro a la
   cuenta por ese documento (pagos reales con PagIdPago + coberturas
   internas + notas de credito + cierres de ciclo), en la MISMA moneda del
   documento (sin convertir, para no arriesgar otro error de cotizacion —
   un documento con partes en otra moneda va a aparecer con diferencia y hay
   que mirarlo a mano, como ET-4169/ET-6470 en el caso ya visto).

   Objetivo: encontrar POR QUE la cuenta no cierra en cero despues de sacar
   el sobrante fantasma del cobro doble — puede ser un documento con menos
   plata registrada de la que deberia (falta cobrar), o con mas (otro
   sobrante), sin relacion con el bug de billetera+caja.

   Diferencia = (PagoReal + CoberturaFantasma + NotaCredito + CierreCiclo) - DocTotal
     > 0  -> entro mas plata de la que vale el documento (revisar, sobrante)
     < 0  -> entro menos plata de la que vale el documento (revisar, falta cobrar)
     ~ 0  -> el documento cierra bien, no es el origen del problema
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @CliIdCliente INT = 795;   -- <<< editar por cliente
DECLARE @Tol DECIMAL(18,4) = 1.00;

IF OBJECT_ID('tempdb..#DocsCliente') IS NOT NULL DROP TABLE #DocsCliente;
SELECT DISTINCT m.DocIdDocumento
INTO #DocsCliente
FROM dbo.MovimientosCuenta m WITH(NOLOCK)
JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @CliIdCliente AND m.DocIdDocumento IS NOT NULL;

SELECT
    Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
    dc.DocIdDocumento, dc.CfeEstado, dc.DocFechaEmision,
    MonedaDoc = CASE WHEN dc.MonIdMoneda=2 THEN 'US$' ELSE '$' END,
    DocTotal = CAST(dc.DocTotal AS DECIMAL(18,2)),
    RegistradoMismaMoneda = CAST(ISNULL((
        SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
        JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
        WHERE m.DocIdDocumento = dc.DocIdDocumento AND cc2.MonIdMoneda = dc.MonIdMoneda
          AND m.MovTipo IN ('PAGO','ANTICIPO','PAGO_CRUZADO','NOTA_CREDITO','CIERRE_CICLO')
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    ), 0) AS DECIMAL(18,2)),
    HayOtraMoneda = CASE WHEN EXISTS (
        SELECT 1 FROM dbo.MovimientosCuenta m WITH(NOLOCK)
        JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
        WHERE m.DocIdDocumento = dc.DocIdDocumento AND cc2.MonIdMoneda <> dc.MonIdMoneda
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    ) THEN 1 ELSE 0 END,
    VivaDoc = CAST(ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                  WHERE dd.DocIdDocumento = dc.DocIdDocumento AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                    AND dd.DDeImportePendiente > 0.01), 0) AS DECIMAL(18,2)),
    Diferencia = CAST(ISNULL((
        SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
        JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
        WHERE m.DocIdDocumento = dc.DocIdDocumento AND cc2.MonIdMoneda = dc.MonIdMoneda
          AND m.MovTipo IN ('PAGO','ANTICIPO','PAGO_CRUZADO','NOTA_CREDITO','CIERRE_CICLO')
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    ), 0) - dc.DocTotal AS DECIMAL(18,2))
FROM #DocsCliente d
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = d.DocIdDocumento
WHERE ISNULL(dc.DocEstado,'') <> 'ANULADO'
ORDER BY ABS(ISNULL((
        SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
        JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = m.CueIdCuenta
        WHERE m.DocIdDocumento = dc.DocIdDocumento AND cc2.MonIdMoneda = dc.MonIdMoneda
          AND m.MovTipo IN ('PAGO','ANTICIPO','PAGO_CRUZADO','NOTA_CREDITO','CIERRE_CICLO')
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    ), 0) - dc.DocTotal) DESC;

DROP TABLE #DocsCliente;
