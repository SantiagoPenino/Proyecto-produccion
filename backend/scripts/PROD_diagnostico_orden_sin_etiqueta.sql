/* =====================================================================================
   DIAGNÓSTICO: orden PRONTA sin etiqueta ("No hay etiquetas generadas para las órdenes
   seleccionadas"), a la que le cargaron la cotización DESPUÉS de completarla.
   Caso: EUV-30014 (pedido 30014, Asesores de Vida, 02-oct-2026).

   SOLO LECTURA. No modifica nada. Cambiá @Codigo para mirar otra orden.

   Cadena que se rompe:
     1) completarOrden (Control/"Completada manualmente") busca SUM(Cantidad) en
        PedidosCobranzaDetalle por OrdenID → 0 → NO genera etiqueta (avisa en pantalla
        "La orden no tiene cantidad cotizada").
     2) Después se guarda la cotización → se insertan las líneas, pero NADIE vuelve a
        generar la etiqueta (saveQuotation no lo hace).
     3) Sin etiqueta no hay bulto → no hay remito → Depósito queda "PENDIENTE A RECIBIR".
   ===================================================================================== */
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @Codigo VARCHAR(50) = 'EUV-30014';

DECLARE @OID INT, @Doc VARCHAR(50), @ProId INT;
SELECT TOP 1 @OID = OrdenID,
             @Doc = LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))),
             @ProId = ProIdProducto
FROM Ordenes WHERE LTRIM(RTRIM(CodigoOrden)) = @Codigo;

/* 1. LA ORDEN ------------------------------------------------------------------------ */
SELECT '1. ORDEN' AS Bloque, OrdenID, CodigoOrden, NoDocERP, AreaID, Estado, EstadoenArea,
       ProximoServicio, Magnitud, CostoTotal, ProIdProducto, CodArticulo, IdProductoReact,
       PerfilesPrecio, Validacion, ValidacionOBS, RolloID, Prioridad, FechaIngreso, FechaPronto,
       CliIdCliente, CodCliente
FROM Ordenes WHERE OrdenID = @OID;

-- Hermanas del mismo pedido (si hay PRO madre la etiqueta se trata distinto)
SELECT '1b. HERMANAS DEL PEDIDO' AS Bloque, OrdenID, CodigoOrden, AreaID, Estado, EstadoenArea, Magnitud
FROM Ordenes WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) = @Doc ORDER BY OrdenID;

/* 2. CABECERAS DE COTIZACIÓN ---------------------------------------------------------
   OJO: si aparece una cabecera con NoDocERP = 'EUV-30014' (con prefijo) la creó el botón
   "Guardar Cotización" del detalle de la orden: manda el CÓDIGO de la orden en vez del
   NoDocERP. La etiqueta y la caja buscan por '30014' y NO la encuentran.               */
SELECT '2. CABECERAS PedidosCobranza' AS Bloque, PC.ID, PC.NoDocERP, PC.ClienteID, PC.MontoTotal,
       PC.Moneda, PC.EstadoCobro, PC.QR_String, PC.FechaGeneracion, PC.Origen,
       CASE WHEN LTRIM(RTRIM(PC.NoDocERP)) = @Doc THEN 'OK (NoDocERP real)'
            ELSE '!! CABECERA CON NoDocERP EQUIVOCADO' END AS Diagnostico
FROM PedidosCobranza PC
WHERE LTRIM(RTRIM(PC.NoDocERP)) IN (@Doc, @Codigo)
   OR PC.ID IN (SELECT PedidoCobranzaID FROM PedidosCobranzaDetalle WHERE OrdenID = @OID);

/* 3. LÍNEAS DE COTIZACIÓN DE LA ORDEN ----------------------------------------------- */
SELECT '3. LINEAS PCD' AS Bloque, PCD.ID, PCD.PedidoCobranzaID, PC.NoDocERP AS NoDocCabecera,
       PCD.OrdenID, PCD.CodArticulo, PCD.ProIdProducto, PCD.Cantidad, PCD.PrecioUnitario,
       PCD.Subtotal, PCD.Moneda, PCD.EsFacturable, PCD.PerfilAplicado, PCD.LogPrecioAplicado,
       LEFT(PCD.PricingTrace, 300) AS PricingTrace
FROM PedidosCobranzaDetalle PCD
LEFT JOIN PedidosCobranza PC ON PC.ID = PCD.PedidoCobranzaID
WHERE PCD.OrdenID = @OID
   OR PCD.PedidoCobranzaID IN (SELECT ID FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) IN (@Doc, @Codigo));

/* 4. ETIQUETAS Y BULTOS ------------------------------------------------------------- */
SELECT '4. ETIQUETAS' AS Bloque, E.EtiquetaID, E.CodigoEtiqueta, E.NumeroBulto, E.TotalBultos,
       E.CodigoQR, E.FechaGeneracion, E.Usuario, LB.BultoID, LB.Estado AS EstadoBulto, LB.UbicacionActual
FROM Etiquetas E
LEFT JOIN Logistica_Bultos LB ON LB.CodigoEtiqueta = E.CodigoEtiqueta
WHERE E.OrdenID = @OID;

SELECT '4b. BULTOS SUELTOS (sin etiqueta)' AS Bloque, LB.*
FROM Logistica_Bultos LB
WHERE LB.OrdenID = @OID AND ISNULL(LB.Tipocontenido, '') <> 'ENCOMIENDA'
  AND NOT EXISTS (SELECT 1 FROM Etiquetas E WHERE E.CodigoEtiqueta = LB.CodigoEtiqueta);

/* 5. DEPÓSITO ----------------------------------------------------------------------- */
SELECT '5. DEPOSITO' AS Bloque, OrdIdOrden, OrdCodigoOrden, OrdCantidad, OrdCostoFinal, MonIdMoneda,
       OrdEstadoActual, OrdFechaIngresoOrden, BultosEsperados, BultosRecibidos
FROM OrdenesDeposito
WHERE OrdCodigoOrden = @Codigo OR OrdCodigoOrden LIKE @Codigo + ' (%';

/* 6. HISTORIAL (para ver la hora de "Completada manualmente" vs. la cotización) ------ */
SELECT '6. HISTORIAL' AS Bloque, HistorialID, Estado, FechaInicio, Usuario, Detalle
FROM HistorialOrdenes WHERE OrdenID = @OID ORDER BY FechaInicio DESC;

/* 7. ¿POR QUÉ NACIÓ SIN COTIZACIÓN? — precio base del producto ---------------------
   Si el precio se cargó DESPUÉS del ingreso de la orden (UltimaActualizacion > FechaIngreso)
   o no hay precio para su ProIdProducto, el sync cotizó $0 y desde el 17-sep una línea en
   $0 NO se guarda (erpSyncService: "solo guardar lo facturable") → orden sin cantidad.   */
SELECT '7. ARTICULO' AS Bloque, A.ProIdProducto, A.CodArticulo, A.IDProdReact, A.Descripcion,
       A.MonIdMoneda, A.borrar, A.Mostrar
FROM Articulos A WHERE A.ProIdProducto = @ProId;

SELECT '7b. PRECIO BASE' AS Bloque, PB.ID, PB.ProIdProducto, PB.CodArticulo, PB.Precio, PB.MonIdMoneda,
       PB.UltimaActualizacion,
       CASE WHEN PB.UltimaActualizacion > (SELECT FechaIngreso FROM Ordenes WHERE OrdenID = @OID)
            THEN '!! precio cargado/modificado DESPUÉS del ingreso de la orden' ELSE 'ya existía' END AS Cuando
FROM PreciosBase PB WHERE PB.ProIdProducto = @ProId;

-- IDProdReact repetido: el portal pudo resolver OTRO ProIdProducto para el mismo IDProdReact
SELECT '7c. MISMO IDProdReact' AS Bloque, A2.ProIdProducto, A2.CodArticulo, A2.Descripcion, A2.borrar,
       (SELECT TOP 1 Precio FROM PreciosBase WHERE ProIdProducto = A2.ProIdProducto) AS PrecioBase
FROM Articulos A1
JOIN Articulos A2 ON A2.IDProdReact = A1.IDProdReact
WHERE A1.ProIdProducto = @ProId AND A1.IDProdReact IS NOT NULL;

/* 8. SIMULACIÓN: ¿el botón "Generar" de Producción > Etiquetas va a funcionar? ------
   Replica los 3 frenos de LabelGenerationService.regenerateLabelsForOrder.            */
;WITH X AS (
    SELECT
        (SELECT ISNULL(SUM(Cantidad), 0) FROM PedidosCobranzaDetalle WHERE OrdenID = @OID) AS CantCotizada,
        (SELECT TOP 1 MontoTotal FROM PedidosCobranza WHERE NoDocERP = @Doc) AS MontoCabeceraReal,
        (SELECT CostoTotal FROM Ordenes WHERE OrdenID = @OID) AS CostoTotalOrden,
        (SELECT COUNT(*) FROM Etiquetas WHERE OrdenID = @OID) AS EtiquetasHoy,
        @Doc AS NoDocERP
)
SELECT '8. SIMULACION ETIQUETA' AS Bloque, X.*,
    CASE
        WHEN X.EtiquetasHoy > 0 THEN 'Ya tiene etiqueta: imprimir, no generar'
        WHEN NULLIF(X.NoDocERP, '') IS NULL THEN 'FRENA: la orden no tiene NoDocERP'
        WHEN X.CantCotizada <= 0 THEN 'FRENA: magnitud cotizada 0 → falta línea en PCD con OrdenID de la orden'
        WHEN ISNULL(X.MontoCabeceraReal, ISNULL(X.CostoTotalOrden, 0)) <= 0
            THEN 'FRENA: "Calculo Frio" (no hay cabecera con NoDocERP real o MontoTotal=0)'
        ELSE 'OK: Producción > Etiquetas → seleccionar la orden → Generar'
    END AS Veredicto
FROM X;

/* 9. BARRIDO: otras órdenes en la misma situación (últimos 30 días) -------------------
   Pronta en el área, sin etiqueta, no cancelada/entregada.                            */
SELECT '9. PRONTAS SIN ETIQUETA' AS Bloque, O.OrdenID, O.CodigoOrden, O.NoDocERP, O.AreaID, O.Estado,
       O.EstadoenArea, O.FechaPronto, O.Cliente,
       (SELECT ISNULL(SUM(Cantidad), 0) FROM PedidosCobranzaDetalle WHERE OrdenID = O.OrdenID) AS CantCotizada,
       CASE WHEN (SELECT ISNULL(SUM(Cantidad), 0) FROM PedidosCobranzaDetalle WHERE OrdenID = O.OrdenID) > 0
            THEN 'Cotizada después → falta GENERAR etiqueta'
            ELSE 'Sigue sin cotizar (o es trabajo interno sin línea propia)' END AS Situacion
FROM Ordenes O
WHERE O.EstadoenArea IN ('Pronto', 'PRONTO')
  AND O.Estado NOT IN ('CANCELADO', 'Cancelado', 'ENTREGADO', 'Entregado', 'FINALIZADO', 'Finalizado')
  AND O.FechaIngreso >= DATEADD(DAY, -30, GETDATE())
  AND NOT EXISTS (SELECT 1 FROM Etiquetas E WHERE E.OrdenID = O.OrdenID)
ORDER BY O.FechaPronto DESC;

/* 10. BARRIDO: cabeceras creadas con el CÓDIGO de la orden en vez del NoDocERP ------- */
-- (las ventas VEN- usan ese formato a propósito: acá solo salen las cabeceras cuyo NoDocERP
--  es el CÓDIGO de una orden que tiene OTRO NoDocERP, con la firma de saveQuotation:
--  la cabecera nace SIN QR_Pedido. Hay cabeceras viejas con prefijo y QR completo que
--  vienen de otro camino y no son este problema.)
SELECT '10. CABECERAS CON NoDocERP = CODIGO DE ORDEN' AS Bloque, PC.ID, PC.NoDocERP, PC.MontoTotal, PC.Moneda,
       PC.FechaGeneracion, O.OrdenID, O.NoDocERP AS NoDocERPReal,
       (SELECT TOP 1 PC2.ID FROM PedidosCobranza PC2
         WHERE LTRIM(RTRIM(PC2.NoDocERP)) = LTRIM(RTRIM(CAST(O.NoDocERP AS VARCHAR(50))))) AS IdCabeceraReal,
       (SELECT COUNT(*) FROM PedidosCobranzaDetalle D WHERE D.PedidoCobranzaID = PC.ID) AS LineasColgadas
FROM PedidosCobranza PC
JOIN Ordenes O ON LTRIM(RTRIM(O.CodigoOrden)) = LTRIM(RTRIM(PC.NoDocERP))
WHERE LTRIM(RTRIM(CAST(O.NoDocERP AS VARCHAR(50)))) <> LTRIM(RTRIM(PC.NoDocERP))
  AND NULLIF(LTRIM(RTRIM(PC.QR_Pedido)), '') IS NULL
  AND PC.FechaGeneracion >= DATEADD(DAY, -60, GETDATE())
ORDER BY PC.FechaGeneracion DESC;

/* 11. PREVENTIVO: artículos SIN precio base usados en órdenes de los últimos 60 días -------
   Cada uno es un EUV-30014 en potencia: el sync cotiza $0, la línea no se guarda y la orden
   llega a Control sin cantidad → sin etiqueta. Cargarles el precio por ProIdProducto (no por
   código: el CodArticulo puede estar repetido, ver CodigoCompartidoCon).                    */
SELECT '11. ARTICULOS SIN PRECIO BASE' AS Bloque, A.ProIdProducto, A.CodArticulo, A.Descripcion, A.Grupo,
       COUNT(DISTINCT O.OrdenID) AS Ordenes60d, MAX(O.FechaIngreso) AS UltimaOrden,
       SUM(CASE WHEN SC.OrdenID IS NULL THEN 1 ELSE 0 END) AS OrdenesSinCotizar,
       (SELECT STRING_AGG(CAST(A2.ProIdProducto AS VARCHAR(10)) + ' ' + LTRIM(RTRIM(A2.Descripcion)), ' | ')
          FROM Articulos A2 WHERE LTRIM(RTRIM(A2.CodArticulo)) = LTRIM(RTRIM(A.CodArticulo)) AND A2.ProIdProducto <> A.ProIdProducto) AS CodigoCompartidoCon
FROM Ordenes O
JOIN Articulos A ON A.ProIdProducto = O.ProIdProducto
OUTER APPLY (SELECT TOP 1 D.OrdenID FROM PedidosCobranzaDetalle D WHERE D.OrdenID = O.OrdenID) SC
WHERE O.FechaIngreso >= DATEADD(DAY, -60, GETDATE())
  AND O.Estado NOT IN ('CANCELADO', 'Cancelado')
  AND NOT EXISTS (SELECT 1 FROM PreciosBase PB WHERE PB.ProIdProducto = A.ProIdProducto)
GROUP BY A.ProIdProducto, A.CodArticulo, A.Descripcion, A.Grupo
ORDER BY OrdenesSinCotizar DESC, Ordenes60d DESC;
