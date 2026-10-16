-- =====================================================================================
-- PROD_reparar_lineas_prepago_sin_cantidad.sql  (25-sep-2026)
--
-- PROBLEMA: desde el deploy del 23-sep (commit 213f994 del 17-sep), el sync ya no guarda
-- en PedidosCobranzaDetalle la línea "Cubierto 100% por Plan" (Prepago / Rollo) porque
-- está en $0. Sin esa línea la orden no tiene CANTIDAD -> no se genera etiqueta
-- ("SIN ETIQUETA: NO SE PUEDE DESPACHAR") -> no hay bulto -> no entra a depósito -> no se
-- rebaja el rollo. Caso: SUB-26932 (PODIUM2024).
--
-- QUÉ HACE:
--   A) Lista las órdenes afectadas (cliente con plan activo para el artículo, sin ninguna
--      línea de cobranza, desde @Desde).
--   B) Lista líneas "Prepago" que alguien guardó A MANO con precio > 0 (cobrarían al
--      cliente metros que el rollo ya cubre). Ej: SUB-26932 guardada a USD 10,50. Solo lista.
--   C) Con @Aplicar = 1: inserta para cada orden de (A) la línea a $0, NO facturable,
--      con la cantidad de la orden, y marca el pedido como Prepago si no lo estaba
--      (LabelGenerationService exige "prepago" en PerfilesPrecio para aceptar $0).
--
-- DESPUÉS: abrir cada orden -> botón "Etiquetas" (o volver a darla "pronta") para generar
-- el bulto. El rollo se rebaja recién cuando el bulto ENTRA A DEPÓSITO, como siempre.
--
-- Correr primero con @Aplicar = 0 (solo muestra). Nada se toca hasta poner 1.
-- =====================================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar BIT  = 0;              -- 0 = solo mostrar | 1 = insertar
DECLARE @Desde   DATE = '2026-09-23';   -- deploy con el cambio

IF OBJECT_ID('tempdb..#Afectadas') IS NOT NULL DROP TABLE #Afectadas;

SELECT
    o.OrdenID,
    RTRIM(o.CodigoOrden)                          AS Cod,
    o.NoDocERP,
    o.Estado,
    o.FechaIngreso,
    o.CliIdCliente,
    o.ProIdProducto,
    -- Cantidad igual que el sync (erpSyncService, 'SUBLIMACIÓN por CANTIDAD'): en SB con artículo por
    -- UNIDAD (Articulos.UniIdUnidad = 1, ej. banderas confeccionadas) se cotiza por PIEZAS = suma de
    -- copias de los archivos de la orden; en el resto, por la Magnitud (metros).
    CASE WHEN LTRIM(RTRIM(o.AreaID)) = 'SB' AND art.UniIdUnidad = 1 AND pz.Piezas > 0 THEN pz.Piezas
         ELSE TRY_CONVERT(DECIMAL(18,2), o.Magnitud) END AS Cant,
    CASE WHEN LTRIM(RTRIM(o.AreaID)) = 'SB' AND art.UniIdUnidad = 1 AND pz.Piezas > 0 THEN 'PIEZAS (copias)' ELSE 'metros (Magnitud)' END AS CantOrigen,
    pc.ID                                         AS PedidoCobranzaID,
    pc.Moneda,
    pc.PerfilesPrecio,
    pl.PlaIdPlan,
    art.CodArticulo,
    (SELECT COUNT(*) FROM dbo.Etiquetas e WHERE e.OrdenID = o.OrdenID) AS Etiquetas
INTO #Afectadas
FROM dbo.Ordenes o
OUTER APPLY (SELECT TOP 1 p.ID, p.Moneda, p.PerfilesPrecio
             FROM dbo.PedidosCobranza p WHERE p.NoDocERP = o.NoDocERP ORDER BY p.ID DESC) pc
OUTER APPLY (SELECT TOP 1 pm.PlaIdPlan
             FROM dbo.PlanesMetros pm
             WHERE pm.CliIdCliente = o.CliIdCliente AND pm.PlaActivo = 1
               AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
               AND (pm.ProIdProducto = o.ProIdProducto
                    OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap
                               WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = o.ProIdProducto))
             ORDER BY pm.PlaFechaAlta) pl
-- el código del artículo aunque esté marcado 'borrar' (ej. producto 218 Bandera Confeccionada: sigue en uso
-- por órdenes y planes pero figura borrado); si hay varios, primero el no borrado
OUTER APPLY (SELECT TOP 1 a.CodArticulo, a.UniIdUnidad FROM dbo.Articulos a
             WHERE a.ProIdProducto = o.ProIdProducto ORDER BY ISNULL(a.borrar, 0) ASC) art
OUTER APPLY (SELECT CAST(ISNULL(SUM(ao.Copias), 0) AS DECIMAL(18,2)) AS Piezas FROM dbo.ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID) pz
WHERE o.FechaIngreso >= @Desde
  AND o.CodigoOrden NOT LIKE '%-R%' AND o.CodigoOrden NOT LIKE '%-F%'
  AND o.Estado NOT IN ('Cancelado', 'Anulado', 'RECHAZADO')
  AND pl.PlaIdPlan IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = o.OrdenID);

PRINT '=== A) Órdenes de clientes con plan que quedaron SIN línea de cobranza (sin cantidad) ===';
SELECT Cod, Estado, FechaIngreso, Cant, CantOrigen, Moneda, PlaIdPlan, CodArticulo, PedidoCobranzaID, Etiquetas,
       CASE WHEN PedidoCobranzaID IS NULL THEN 'SIN PEDIDO DE COBRANZA: no se puede insertar, revisar'
            WHEN Cant IS NULL OR Cant <= 0 THEN 'MAGNITUD INVÁLIDA: no se puede insertar, revisar'
            WHEN CodArticulo IS NULL        THEN 'ARTÍCULO SIN CÓDIGO: no se puede insertar, revisar'
            ELSE 'OK -> se inserta línea a $0 no facturable' END AS Accion
FROM #Afectadas ORDER BY FechaIngreso DESC;

PRINT '=== B) Líneas Prepago guardadas A MANO con precio > 0 desde @Desde (revisar: cobrarían metros ya cubiertos) ===';
SELECT RTRIM(o.CodigoOrden) AS Cod, d.ID AS LineaID, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.Moneda,
       d.EsFacturable, d.PerfilAplicado, LEFT(d.LogPrecioAplicado, 60) AS Log, d.PedidoCobranzaID
FROM dbo.PedidosCobranzaDetalle d
JOIN dbo.Ordenes o ON o.OrdenID = d.OrdenID
WHERE o.FechaIngreso >= @Desde
  AND d.PerfilAplicado LIKE '%Prepago%' AND d.PerfilAplicado NOT LIKE '%Excedente%'
  AND d.Subtotal > 0
ORDER BY o.FechaIngreso DESC;
-- Para corregir UNA de esas líneas (ej. SUB-26932) después de confirmar que el plan la cubre:
--   UPDATE dbo.PedidosCobranzaDetalle SET PrecioUnitario = 0, Subtotal = 0, EsFacturable = 0,
--          LogPrecioAplicado = 'Cubierto 100% por plan - corregido a mano 25-sep-2026'
--   WHERE ID = <LineaID>;
--   y recalcular el total del pedido:
--   UPDATE pc SET MontoTotal = (SELECT ISNULL(SUM(Subtotal),0) FROM dbo.PedidosCobranzaDetalle x
--                               WHERE x.PedidoCobranzaID = pc.ID AND ISNULL(x.EsFacturable,1) = 1
--                                 AND ISNULL(x.EsHermanaConsolidada,0) = 0 AND x.Moneda = pc.Moneda),
--             QR_Importe = '0.00'
--   FROM dbo.PedidosCobranza pc WHERE pc.ID = <PedidoCobranzaID>;

IF @Aplicar = 1
BEGIN
    BEGIN TRAN;

    INSERT INTO dbo.PedidosCobranzaDetalle
        (PedidoCobranzaID, OrdenID, CodArticulo, ProIdProducto, Cantidad, PrecioUnitario, Subtotal,
         LogPrecioAplicado, Moneda, PerfilAplicado, PricingTrace, MonedaOriginal,
         PrecioUnitarioOriginal, SubtotalOriginal, EsHermanaConsolidada, EsFacturable)
    SELECT
        a.PedidoCobranzaID, a.OrdenID, a.CodArticulo, a.ProIdProducto, a.Cant, 0, 0,
        'Cubierto 100% por Plan #' + CAST(a.PlaIdPlan AS VARCHAR(20)) + ' (línea repuesta 25-sep-2026)',
        ISNULL(a.Moneda, 'UYU'),
        'Prepago (Rollo Pre-Comprado)',
        'Reparación: la línea cubierta por plan no se había guardado (deploy 23-sep)',
        ISNULL(a.Moneda, 'UYU'),
        0, 0, 0, 0
    FROM #Afectadas a
    WHERE a.PedidoCobranzaID IS NOT NULL AND a.Cant > 0 AND a.CodArticulo IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.PedidosCobranzaDetalle d WHERE d.OrdenID = a.OrdenID);

    PRINT 'Líneas insertadas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    -- El pedido tiene que decir "Prepago" para que la etiqueta acepte importe $0.
    UPDATE pc
       SET PerfilesPrecio = LTRIM(ISNULL(pc.PerfilesPrecio, '') + ' Prepago (Rollo Pre-Comprado)')
    FROM dbo.PedidosCobranza pc
    WHERE pc.ID IN (SELECT PedidoCobranzaID FROM #Afectadas WHERE PedidoCobranzaID IS NOT NULL)
      AND ISNULL(pc.PerfilesPrecio, '') NOT LIKE '%repago%';

    PRINT 'Pedidos marcados Prepago: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

    COMMIT;
    PRINT 'LISTO. Ahora generar la etiqueta de cada orden (botón Etiquetas).';
END
ELSE
    PRINT 'Solo vista previa (@Aplicar = 0). Nada se modificó.';

DROP TABLE #Afectadas;
