/* ============================================================================
   diag_recurso_deportivo_new_delbur.sql        SOLO LECTURA
   ----------------------------------------------------------------------------
   Devuelve SOLO el plan de recurso de DEPORTIVO NEW de Javier Burguez (DELBUR),
   con el movimiento ENTRADA de esa compra. Los dos IDs que necesita
   fix_eliminar_compra_recurso.sql son: PlaIdPlan y MovEntradaId.

   El plan de DEPORTIVO PRO no aparece acá: queda intacto.
   ============================================================================ */
SELECT
    cli.IDCliente,
    RTRIM(cli.Nombre)                              AS Cliente,
    RTRIM(art.Descripcion)                         AS Articulo,
    pm.PlaIdPlan,                                  -- ← @PlaIdPlan
    mov.MovIdMovimiento                            AS MovEntradaId,   -- ← @MovEntradaId
    mov.MovImporte                                 AS MovEntradaMetros,
    mov.MovConcepto                                AS MovEntradaConcepto,
    mov.MovAnulado                                 AS MovEntradaAnulado,
    pm.PlaCantidadTotal                            AS MetrosComprados,
    pm.PlaCantidadUsada                            AS MetrosConsumidos,
    pm.PlaCantidadTotal - pm.PlaCantidadUsada      AS MetrosVivos,
    pm.PlaActivo,
    pm.PlaFechaAlta,
    cc.CueIdCuenta,
    cc.CueSaldoActual                              AS SaldoMetrosCuenta
FROM dbo.PlanesMetros     pm
JOIN dbo.Clientes         cli ON cli.CliIdCliente  = pm.CliIdCliente
JOIN dbo.CuentasCliente   cc  ON cc.CueIdCuenta    = pm.CueIdCuenta
JOIN dbo.Articulos        art ON art.ProIdProducto = pm.ProIdProducto
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
WHERE cli.IDCliente LIKE 'DELBUR%'
  AND art.Descripcion LIKE '%DEPORTIVO NEW%'
ORDER BY pm.PlaFechaAlta DESC;
