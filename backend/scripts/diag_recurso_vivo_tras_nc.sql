/* ============================================================================
   diag_recurso_vivo_tras_nc.sql        SOLO LECTURA — no modifica nada
   ----------------------------------------------------------------------------
   Compras de RECURSO (rollo/metros por adelantado) que siguen VIVAS aunque la
   factura que las originó fue anulada o tiene una NOTA DE CRÉDITO encima.

   Por qué pasa: generarNotaCredito (cajaController) solo revierte PLATA
   (movimiento NOTA_CREDITO + deuda + asiento). Nunca toca PlanesMetros ni la
   cuenta MTS del cliente, así que los metros quedan disponibles para consumir.

   Cómo se identifica la compra: TransaccionDetalle.TdeTipoReferencia = 'RECURSO'
   y TdeReferenciaId = PlanesMetros.PlaIdPlan.

   Filtrá por cliente descomentando la línea del WHERE si querés ver solo uno.
   ============================================================================ */
SELECT
    cli.IDCliente,
    RTRIM(cli.Nombre)                                   AS Cliente,
    pm.PlaIdPlan,
    RTRIM(ISNULL(art.CodArticulo, ''))                  AS CodArticulo,
    RTRIM(ISNULL(art.Descripcion, ''))                  AS Articulo,
    pm.PlaCantidadTotal                                 AS MetrosComprados,
    pm.PlaCantidadUsada                                 AS MetrosConsumidos,
    pm.PlaCantidadTotal - pm.PlaCantidadUsada           AS MetrosVivos,
    pm.PlaActivo,
    pm.PlaFechaAlta,
    cc.CueIdCuenta,
    cc.CueSaldoActual                                   AS SaldoMetrosCuenta,
    mov.MovIdMovimiento                                 AS MovEntradaId,
    mov.MovImporte                                      AS MovEntradaMetros,
    mov.MovConcepto                                     AS MovEntradaConcepto,
    mov.MovAnulado                                      AS MovEntradaAnulado,
    td.TcaIdTransaccion,
    tc.TcaEstado,
    td.TdeImporteFinal                                  AS ImportePagadoRecurso,
    doc.DocIdDocumento                                  AS DocOrigenId,
    doc.DocTipo                                         AS DocOrigenTipo,
    RTRIM(doc.DocSerie) + '-' + CAST(doc.DocNumero AS VARCHAR(20)) AS DocOrigen,
    doc.DocTotal                                        AS DocOrigenTotal,
    doc.DocEstado                                       AS DocOrigenEstado,
    nc.DocIdDocumento                                   AS NC_Id,
    nc.DocTipo                                          AS NC_Tipo,
    CASE WHEN nc.DocIdDocumento IS NULL THEN NULL
         ELSE RTRIM(nc.DocSerie) + '-' + CAST(nc.DocNumero AS VARCHAR(20)) END AS NC_Numero,
    nc.DocTotal                                         AS NC_Total,
    nc.CfeEstado                                        AS NC_CfeEstado
FROM dbo.PlanesMetros           pm
JOIN dbo.Clientes               cli ON cli.CliIdCliente = pm.CliIdCliente
JOIN dbo.CuentasCliente         cc  ON cc.CueIdCuenta   = pm.CueIdCuenta
LEFT JOIN dbo.Articulos         art ON art.ProIdProducto = pm.ProIdProducto
LEFT JOIN dbo.TransaccionDetalle td ON td.TdeReferenciaId = pm.PlaIdPlan
                                   AND td.TdeTipoReferencia = 'RECURSO'
LEFT JOIN dbo.TransaccionesCaja  tc ON tc.TcaIdTransaccion = td.TcaIdTransaccion
LEFT JOIN dbo.DocumentosContables doc ON doc.TcaIdTransaccion = td.TcaIdTransaccion
LEFT JOIN dbo.DocumentosContables nc  ON nc.DocIdDocumentoRef = doc.DocIdDocumento
                                     AND nc.DocTipo LIKE '%Cre%'
OUTER APPLY (
    SELECT TOP 1 m.MovIdMovimiento, m.MovImporte, m.MovConcepto, m.MovAnulado
    FROM dbo.MovimientosCuenta m
    WHERE m.CueIdCuenta = pm.CueIdCuenta
      AND m.MovTipo = 'ENTRADA'
      AND (
            m.MovObservaciones = 'Plan #' + CAST(pm.PlaIdPlan AS VARCHAR(20))
         OR PATINDEX('%plan #' + CAST(pm.PlaIdPlan AS VARCHAR(20)) + '[^0-9]%', ISNULL(m.MovConcepto, '') + ' ') > 0
          )
    ORDER BY m.MovIdMovimiento DESC
) mov
WHERE pm.PlaCantidadTotal > pm.PlaCantidadUsada            -- todavía hay metros vivos
  AND (
        nc.DocIdDocumento IS NOT NULL                      -- la venta tiene NC encima
     OR tc.TcaEstado = 'ANULADA'                           -- o la transacción está anulada
     OR doc.DocEstado = 'ANULADO'                          -- o el documento está anulado
      )
  -- AND cli.IDCliente = 'DELBUR'                          -- ← descomentar para un cliente
ORDER BY pm.PlaFechaAlta DESC;
