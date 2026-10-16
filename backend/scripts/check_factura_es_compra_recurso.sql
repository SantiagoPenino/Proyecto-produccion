/* ============================================================================
   check_factura_es_compra_recurso.sql        SOLO LECTURA
   ----------------------------------------------------------------------------
   ANTES de anular una factura o de hacerle una Nota de Crédito: decí qué
   documento es y esto te contesta

     1) si esa factura fue una COMPRA DE RECURSO (rollo/metros por adelantado)
     2) cuántos metros de esa compra ya se consumieron
     3) si se puede revertir limpio o si hay que revertir consumos primero

   La marca es TransaccionDetalle.TdeTipoReferencia = 'RECURSO' sobre la
   transacción de caja del documento (TdeReferenciaId = PlanesMetros.PlaIdPlan).
   Una factura de trabajo normal no tiene ninguna línea así.

   Cargá el documento por ID o por serie+número (dejá en NULL el que no uses).
   ============================================================================ */
DECLARE @DocIdDocumento INT         = NULL;      -- ej: 6028
DECLARE @DocSerie       VARCHAR(10) = NULL;      -- ej: 'ET'
DECLARE @DocNumero      VARCHAR(20) = NULL;      -- ej: '3375'

IF @DocIdDocumento IS NULL AND @DocSerie IS NOT NULL
    SELECT @DocIdDocumento = MAX(DocIdDocumento)
    FROM dbo.DocumentosContables
    WHERE LTRIM(RTRIM(DocSerie)) = LTRIM(RTRIM(@DocSerie))
      AND LTRIM(RTRIM(CAST(DocNumero AS VARCHAR(20)))) = LTRIM(RTRIM(@DocNumero));

SELECT
    doc.DocIdDocumento,
    doc.DocTipo,
    LTRIM(RTRIM(doc.DocSerie)) + '-' + CAST(doc.DocNumero AS VARCHAR(20)) AS Documento,
    RTRIM(cli.Nombre)                                   AS Cliente,
    doc.DocTotal,
    doc.DocEstado,
    CASE WHEN rec.PlaIdPlan IS NULL
         THEN 'NO — factura normal, la NC/anulacion no deja recursos colgados'
         ELSE 'SI — ES COMPRA DE RECURSO: la NC no revierte los metros por si sola'
    END                                                 AS EsCompraDeRecurso,
    rec.PlaIdPlan,
    RTRIM(art.Descripcion)                              AS Articulo,
    rec.MetrosComprados,
    rec.MetrosConsumidos,
    rec.MetrosComprados - rec.MetrosConsumidos          AS MetrosVivos,
    rec.MovEntradaId,
    CASE
        WHEN rec.PlaIdPlan IS NULL                      THEN 'Nada que revisar.'
        WHEN rec.MetrosConsumidos > 0.0001              THEN 'OJO: ya se consumieron metros de este rollo. Reverti los consumos (boton de revertir del libro del plan) ANTES de la NC/anulacion.'
        ELSE 'Se puede revertir limpio: 0 metros consumidos.'
    END                                                 AS Recomendacion
FROM dbo.DocumentosContables doc
JOIN dbo.Clientes cli ON cli.CliIdCliente = doc.CliIdCliente
OUTER APPLY (
    SELECT TOP 1
           pm.PlaIdPlan, pm.ProIdProducto,
           pm.PlaCantidadTotal AS MetrosComprados,
           pm.PlaCantidadUsada AS MetrosConsumidos,
           mov.MovIdMovimiento AS MovEntradaId
    FROM dbo.TransaccionDetalle td
    JOIN dbo.PlanesMetros pm ON pm.PlaIdPlan = td.TdeReferenciaId
    OUTER APPLY (
        SELECT TOP 1 m.MovIdMovimiento
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta = pm.CueIdCuenta
          AND m.MovTipo = 'ENTRADA'
          AND (
                m.MovObservaciones = 'Plan #' + CAST(pm.PlaIdPlan AS VARCHAR(20))
             OR PATINDEX('%plan #' + CAST(pm.PlaIdPlan AS VARCHAR(20)) + '[^0-9]%', ISNULL(m.MovConcepto, '') + ' ') > 0
              )
        ORDER BY m.MovIdMovimiento DESC
    ) mov
    WHERE td.TcaIdTransaccion = doc.TcaIdTransaccion
      AND td.TdeTipoReferencia = 'RECURSO'
    ORDER BY pm.PlaIdPlan DESC
) rec
LEFT JOIN dbo.Articulos art ON art.ProIdProducto = rec.ProIdProducto
WHERE doc.DocIdDocumento = @DocIdDocumento;
