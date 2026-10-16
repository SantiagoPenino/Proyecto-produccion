-- =====================================================================================
-- PROD_reparar_lineas_prepago_parcial.sql  (25-sep-2026)
--
-- CASO: cobertura PARCIAL del plan. El sync arma DOS líneas (erpSyncService, "CASO 2"):
--   · metros cubiertos  -> $0, perfil 'Prepago Parcial (Rollo Pre-Comprado)'
--   · metros restantes  -> precio normal, perfil 'Precio Base (Excedente de Rollo)'
-- Desde el deploy del 23-sep la primera se descartaba por estar en $0 (mismo bug de la línea
-- cubierta al 100%). Quedó solo el excedente: la orden tiene menos cantidad que su magnitud y
-- al ingresar a depósito el plan se aplicaría sobre el excedente en vez de sobre los metros
-- cubiertos (cobro y rebaja mal). Ej.: DTF-27791, 5 m = 1,5 m cubiertos + 3,5 m a USD 22.
--
-- QUÉ HACE: para cada orden desde @Desde que tiene línea de excedente y NO tiene la línea
-- cubierta, repone la línea cubierta con Cantidad = Magnitud - excedente, a $0, NO facturable,
-- copiando artículo/producto/moneda de la línea de excedente.
-- Las que YA ENTRARON a depósito se listan aparte para revisar a mano (el ingreso ya corrió).
--
-- USO: @Aplicar = 0 lista; @Aplicar = 1 inserta. Idempotente.
-- =====================================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar BIT  = 0;
DECLARE @Desde   DATE = '2026-09-23';

IF OBJECT_ID('tempdb..#P') IS NOT NULL DROP TABLE #P;

SELECT
    RTRIM(o.CodigoOrden)                       AS Cod,
    o.OrdenID, o.Estado, o.FechaIngreso, o.CliIdCliente,
    TRY_CONVERT(DECIMAL(18,2), o.Magnitud)     AS Magnitud,
    ex.ID                                      AS LineaExcedente,
    ex.PedidoCobranzaID, ex.CodArticulo, ex.ProIdProducto, ex.Moneda,
    ex.Cantidad                                AS CantExcedente,
    ex.PrecioUnitarioOriginal,
    CAST(TRY_CONVERT(DECIMAL(18,2), o.Magnitud) - ex.Cantidad AS DECIMAL(18,2)) AS CantCubierta,
    pl.PlaIdPlan,
    CASE WHEN EXISTS (SELECT 1 FROM dbo.OrdenesDeposito x WHERE x.OrdCodigoOrden = RTRIM(o.CodigoOrden) OR x.OrdCodigoOrden LIKE RTRIM(o.CodigoOrden) + ' (%') THEN 1 ELSE 0 END AS EnDeposito
INTO #P
FROM dbo.Ordenes o
CROSS APPLY (SELECT TOP 1 d.ID, d.PedidoCobranzaID, d.CodArticulo, d.ProIdProducto, d.Moneda, d.Cantidad, d.PrecioUnitarioOriginal
             FROM dbo.PedidosCobranzaDetalle d
             WHERE d.OrdenID = o.OrdenID AND (d.PerfilAplicado LIKE '%Excedente%' OR d.LogPrecioAplicado LIKE 'Excedente de prepago%')
             ORDER BY d.ID DESC) ex
OUTER APPLY (SELECT TOP 1 pm.PlaIdPlan FROM dbo.PlanesMetros pm
             WHERE pm.CliIdCliente = o.CliIdCliente
               AND (pm.ProIdProducto = ex.ProIdProducto
                    OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = ex.ProIdProducto))
             ORDER BY pm.PlaActivo DESC, pm.PlaFechaAlta DESC) pl
WHERE o.FechaIngreso >= @Desde
  AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
  AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
  -- no tiene la línea cubierta (a $0 con perfil Prepago)
  AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d
                  WHERE d.OrdenID = o.OrdenID AND d.ID <> ex.ID
                    AND (d.PerfilAplicado LIKE '%Prepago%' OR d.LogPrecioAplicado LIKE '%Plan #%'));

DECLARE @N INT; SELECT @N = COUNT(*) FROM #P;
PRINT '=== Cobertura parcial con la línea cubierta faltante (' + CAST(@N AS VARCHAR(10)) + ') ===';
SELECT Cod, Estado, FechaIngreso, Magnitud, CantExcedente, CantCubierta, Moneda, PlaIdPlan, LineaExcedente,
       CASE WHEN CantCubierta IS NULL OR CantCubierta <= 0 THEN 'MAGNITUD <= EXCEDENTE: nada que reponer, revisar'
            WHEN EnDeposito = 1 THEN 'YA ENTRÓ A DEPÓSITO: se repone la línea, pero revisar cobro y rebaja a mano'
            ELSE 'OK -> se repone la línea cubierta a $0 no facturable' END AS Accion
FROM #P ORDER BY FechaIngreso;

IF @Aplicar = 1 AND EXISTS (SELECT 1 FROM #P WHERE CantCubierta > 0)
BEGIN
    BEGIN TRAN;
    INSERT INTO dbo.PedidosCobranzaDetalle
        (PedidoCobranzaID, OrdenID, CodArticulo, ProIdProducto, Cantidad, PrecioUnitario, Subtotal,
         LogPrecioAplicado, Moneda, PerfilAplicado, PricingTrace, MonedaOriginal,
         PrecioUnitarioOriginal, SubtotalOriginal, EsHermanaConsolidada, EsFacturable)
    SELECT
        p.PedidoCobranzaID, p.OrdenID, p.CodArticulo, p.ProIdProducto, p.CantCubierta, 0, 0,
        'Prepago Parcial - ' + CAST(p.CantCubierta AS VARCHAR(20)) + 'm cubiertos por Plan #' + ISNULL(CAST(p.PlaIdPlan AS VARCHAR(20)), '?') + ' (línea repuesta 25-sep-2026)',
        ISNULL(p.Moneda, 'UYU'),
        'Prepago Parcial (Rollo Pre-Comprado)',
        'Reparación: la línea cubierta por plan (parcial) no se había guardado (deploy 23-sep)',
        ISNULL(p.Moneda, 'UYU'),
        ISNULL(p.PrecioUnitarioOriginal, 0), 0, 0, 0
    FROM #P p
    WHERE p.CantCubierta > 0
      AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d
                      WHERE d.OrdenID = p.OrdenID AND d.ID <> p.LineaExcedente
                        AND (d.PerfilAplicado LIKE '%Prepago%' OR d.LogPrecioAplicado LIKE '%Plan #%'));
    PRINT 'Líneas cubiertas repuestas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    -- el pedido tiene que decir "Prepago" para que la etiqueta acepte la parte en $0
    UPDATE pc SET PerfilesPrecio = LTRIM(ISNULL(pc.PerfilesPrecio, '') + ' Prepago Parcial (Rollo Pre-Comprado)')
    FROM dbo.PedidosCobranza pc
    WHERE pc.ID IN (SELECT PedidoCobranzaID FROM #P WHERE CantCubierta > 0) AND ISNULL(pc.PerfilesPrecio, '') NOT LIKE '%repago%';

    COMMIT;
    PRINT 'LISTO.';
END
ELSE
    PRINT 'Solo vista previa (@Aplicar = 0) o nada que reponer.';

DROP TABLE #P;
