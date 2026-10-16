/* =====================================================================
   CORRECCIÓN MULTITELA (órdenes hermanas, mismo NoDocERP)
   Base: SecureAppDB
   Problema: cada orden hermana quedó en OrdenesDeposito con el
             código/cantidad/importe del PEDIDO completo (duplica el retiro),
             y las etiquetas llevan el QR del pedido en vez del de cada orden.
   Fuente de verdad por orden: PedidosCobranzaDetalle (por OrdenID).

   >>> CORRER POR PASOS. Cada PREVIEW (SELECT) es inofensivo: revisalo
       ANTES de correr el UPDATE que le sigue. Hacer el BACKUP (PASO 0). <<<

   Orden sugerido: PASO 0 -> SCRIPT 2 (OrdenesDeposito) -> SCRIPT 1 (Etiquetas)
   ===================================================================== */


/* =====================================================================
   PASO 0 — BACKUP (obligatorio antes de cualquier UPDATE)
   ===================================================================== */
DROP TABLE IF EXISTS OrdenesDeposito_bkp_multitela;
DROP TABLE IF EXISTS Etiquetas_bkp_multitela;
SELECT * INTO OrdenesDeposito_bkp_multitela FROM OrdenesDeposito;
SELECT * INTO Etiquetas_bkp_multitela        FROM Etiquetas;
-- Para revertir: restaurás desde estas tablas.


/* =====================================================================
   SCRIPT 2 — OrdenesDeposito (lo crítico: el importe del retiro)
   ===================================================================== */

/* --- 2.1  PREVIEW: hermanas con código correcto (ej. "SUB-4727 (2/2)") --- */
;WITH d AS (
    SELECT OrdenID, SUM(Cantidad) AS Cant, SUM(Subtotal) AS Imp,
           MIN(ProIdProducto) AS ProId, COUNT(*) AS Lineas
    FROM PedidosCobranzaDetalle WHERE OrdenID IS NOT NULL GROUP BY OrdenID
)
SELECT pc.NoDocERP, od.OrdIdOrden, od.OrdCodigoOrden, od.OrdEstadoActual AS Estado,
       od.OrdCostoFinal AS Costo_Actual, d.Imp  AS Costo_Correcto,
       od.OrdCantidad   AS Cant_Actual,  d.Cant AS Cant_Correcta,
       od.ProIdProducto AS Prod_Actual,  d.ProId AS Prod_Correcto
FROM OrdenesDeposito od
JOIN Ordenes o ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
JOIN d ON d.OrdenID = o.OrdenID
JOIN PedidosCobranza pc ON pc.ID = (SELECT MIN(PedidoCobranzaID) FROM PedidosCobranzaDetalle WHERE OrdenID = o.OrdenID)
WHERE d.Lineas = 1
  AND ( ABS(ISNULL(od.OrdCostoFinal,0) - d.Imp)  > 0.01
     OR ABS(ISNULL(od.OrdCantidad,0)  - d.Cant) > 0.001
     OR ISNULL(od.ProIdProducto,0) <> d.ProId )
ORDER BY pc.NoDocERP, od.OrdCodigoOrden;


/* --- 2.2  UPDATE: hermanas con código correcto (match directo) ---
   Si NO querés tocar órdenes ya retiradas/entregadas, agregá:  AND od.OrdEstadoActual IN (1,6) */
;WITH d AS (
    SELECT OrdenID, SUM(Cantidad) AS Cant, SUM(Subtotal) AS Imp,
           MIN(ProIdProducto) AS ProId, COUNT(*) AS Lineas
    FROM PedidosCobranzaDetalle WHERE OrdenID IS NOT NULL GROUP BY OrdenID
)
UPDATE od
SET od.OrdCostoFinal = d.Imp,
    od.OrdCantidad   = d.Cant,
    od.ProIdProducto = d.ProId
FROM OrdenesDeposito od
JOIN Ordenes o ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
JOIN d ON d.OrdenID = o.OrdenID
WHERE d.Lineas = 1
  AND ( ABS(ISNULL(od.OrdCostoFinal,0) - d.Imp)  > 0.01
     OR ABS(ISNULL(od.OrdCantidad,0)  - d.Cant) > 0.001
     OR ISNULL(od.ProIdProducto,0) <> d.ProId );


/* --- 2.3  DIAGNÓSTICO: filas con código PELADO (ej. "SUB-4727" = la 1/2) ---
   Estas no matchean por código. Acá ves a qué orden corresponde cada una.
   REVISÁ que "Codigo_Pelado" -> "Codigo_Correcto" tenga sentido antes del 2.4. */
;WITH d AS (
    SELECT OrdenID, SUM(Cantidad) AS Cant, SUM(Subtotal) AS Imp,
           MIN(ProIdProducto) AS ProId, COUNT(*) AS Lineas
    FROM PedidosCobranzaDetalle WHERE OrdenID IS NOT NULL GROUP BY OrdenID
)
SELECT pc.NoDocERP,
       od.OrdIdOrden, od.OrdCodigoOrden AS Codigo_Pelado,
       o.OrdenID AS Orden_Objetivo, o.CodigoOrden AS Codigo_Correcto,
       od.OrdCostoFinal AS Costo_Actual, d.Imp  AS Costo_Correcto,
       od.OrdCantidad   AS Cant_Actual,  d.Cant AS Cant_Correcta,
       od.ProIdProducto AS Prod_Actual,  d.ProId AS Prod_Correcto
FROM OrdenesDeposito od
JOIN Ordenes o ON o.CodigoOrden LIKE LTRIM(RTRIM(od.OrdCodigoOrden)) + ' (%'
JOIN d ON d.OrdenID = o.OrdenID AND d.Lineas = 1
JOIN PedidosCobranza pc ON pc.ID = (SELECT MIN(PedidoCobranzaID) FROM PedidosCobranzaDetalle WHERE OrdenID = o.OrdenID)
WHERE NOT EXISTS (SELECT 1 FROM Ordenes ox
                  WHERE LTRIM(RTRIM(ox.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden)))
  AND NOT EXISTS (SELECT 1 FROM OrdenesDeposito od2
                  WHERE LTRIM(RTRIM(od2.OrdCodigoOrden)) = LTRIM(RTRIM(o.CodigoOrden)))
ORDER BY pc.NoDocERP;


/* --- 2.4  UPDATE: filas peladas -> código correcto + importe/cant/prod de la orden ---
   Asume 1 fila pelada por pedido (la 1/N, con el resto ya con sufijo). Si el 2.3
   mostró casos raros (varias peladas en un pedido), corregí esos a mano. */
;WITH d AS (
    SELECT OrdenID, SUM(Cantidad) AS Cant, SUM(Subtotal) AS Imp,
           MIN(ProIdProducto) AS ProId, COUNT(*) AS Lineas
    FROM PedidosCobranzaDetalle WHERE OrdenID IS NOT NULL GROUP BY OrdenID
)
UPDATE od
SET od.OrdCodigoOrden = o.CodigoOrden,   -- renombra "SUB-4727" -> "SUB-4727 (1/2)"
    od.OrdCostoFinal  = d.Imp,
    od.OrdCantidad    = d.Cant,
    od.ProIdProducto  = d.ProId
FROM OrdenesDeposito od
JOIN Ordenes o ON o.CodigoOrden LIKE LTRIM(RTRIM(od.OrdCodigoOrden)) + ' (%'
JOIN d ON d.OrdenID = o.OrdenID AND d.Lineas = 1
WHERE NOT EXISTS (SELECT 1 FROM Ordenes ox
                  WHERE LTRIM(RTRIM(ox.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden)))
  AND NOT EXISTS (SELECT 1 FROM OrdenesDeposito od2
                  WHERE LTRIM(RTRIM(od2.OrdCodigoOrden)) = LTRIM(RTRIM(o.CodigoOrden)));


/* =====================================================================
   SCRIPT 1 — Etiquetas.CodigoQR (para que las etiquetas ya impresas,
   al escanearse, lean el dato de SU orden). Se linkea por OrdenID, así
   que es limpio (no depende del código pelado).
   ===================================================================== */

/* --- 1.1  PREVIEW: QR viejo (del pedido) vs QR nuevo (de la orden) --- */
;WITH d AS (
    SELECT OrdenID, SUM(Cantidad) AS Cant, SUM(Subtotal) AS Imp,
           MIN(ProIdProducto) AS ProId, COUNT(*) AS Lineas
    FROM PedidosCobranzaDetalle WHERE OrdenID IS NOT NULL GROUP BY OrdenID
)
SELECT e.EtiquetaID, e.OrdenID, o.CodigoOrden,
       e.CodigoQR AS QR_Actual,
       CONCAT( LTRIM(RTRIM(o.CodigoOrden)), '$*',
               ISNULL(pc.QR_Cliente,''), '$*',
               ISNULL(pc.QR_Trabajo,''), '$*',
               ISNULL(pc.QR_Urgencia,'1'), '$*',
               ISNULL(CONVERT(VARCHAR(20), art.IDProdReact), CONVERT(VARCHAR(20), d.ProId)), '$*',
               CONVERT(VARCHAR(30), CAST(d.Cant AS DECIMAL(18,2))), '$*',
               CONVERT(VARCHAR(30), CAST(d.Imp  AS DECIMAL(18,2))) ) AS QR_Nuevo
FROM Etiquetas e
JOIN Ordenes o ON o.OrdenID = e.OrdenID
JOIN d ON d.OrdenID = e.OrdenID
LEFT JOIN PedidosCobranza pc ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(CONVERT(VARCHAR(50), o.NoDocERP)))
LEFT JOIN Articulos art ON art.ProIdProducto = d.ProId
WHERE d.Lineas = 1
  AND e.CodigoQR IS NOT NULL
  AND EXISTS (SELECT 1 FROM Ordenes o2 WHERE o2.NoDocERP = o.NoDocERP AND o2.OrdenID <> o.OrdenID)  -- solo pedidos multi-orden
ORDER BY o.NoDocERP, e.OrdenID;


/* --- 1.2  UPDATE: reescribe el CodigoQR por orden --- */
;WITH d AS (
    SELECT OrdenID, SUM(Cantidad) AS Cant, SUM(Subtotal) AS Imp,
           MIN(ProIdProducto) AS ProId, COUNT(*) AS Lineas
    FROM PedidosCobranzaDetalle WHERE OrdenID IS NOT NULL GROUP BY OrdenID
)
UPDATE e
SET e.CodigoQR = CONCAT( LTRIM(RTRIM(o.CodigoOrden)), '$*',
                         ISNULL(pc.QR_Cliente,''), '$*',
                         ISNULL(pc.QR_Trabajo,''), '$*',
                         ISNULL(pc.QR_Urgencia,'1'), '$*',
                         ISNULL(CONVERT(VARCHAR(20), art.IDProdReact), CONVERT(VARCHAR(20), d.ProId)), '$*',
                         CONVERT(VARCHAR(30), CAST(d.Cant AS DECIMAL(18,2))), '$*',
                         CONVERT(VARCHAR(30), CAST(d.Imp  AS DECIMAL(18,2))) )
FROM Etiquetas e
JOIN Ordenes o ON o.OrdenID = e.OrdenID
JOIN d ON d.OrdenID = e.OrdenID
LEFT JOIN PedidosCobranza pc ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(CONVERT(VARCHAR(50), o.NoDocERP)))
LEFT JOIN Articulos art ON art.ProIdProducto = d.ProId
WHERE d.Lineas = 1
  AND e.CodigoQR IS NOT NULL
  AND EXISTS (SELECT 1 FROM Ordenes o2 WHERE o2.NoDocERP = o.NoDocERP AND o2.OrdenID <> o.OrdenID);


/* =====================================================================
   VERIFICACIÓN FINAL (opcional) — el retiro de un pedido debe sumar el MontoTotal
   ===================================================================== */
-- SELECT od.OrdCodigoOrden, od.OrdCantidad, od.OrdCostoFinal, od.ProIdProducto
-- FROM OrdenesDeposito od
-- JOIN Ordenes o ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
-- WHERE o.NoDocERP = '4727';   -- debería dar 102.20 + 4.32 = 106.52
