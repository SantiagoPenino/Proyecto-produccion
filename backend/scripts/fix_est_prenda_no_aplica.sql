/* ============================================================================
   fix_est_prenda_no_aplica.sql
   ----------------------------------------------------------------------------
   PROBLEMA
   Al crear un pedido de prendas (Comprar y personalizar, Fabricar a medida, Combo,
   Prenda del cliente) el Estampado encadenado a un DTF/TPU nacía con el requisito
   PRENDA ya CUMPLIDO: "No aplica — el canal real de este Estampado es DTF".
   Pero en esos pedidos siempre hay una prenda física: el Estampado necesita el
   transfer Y la prenda. Con PRENDA marcado de entrada, la orden aparecía lista
   para estampar con solo recibir el transfer, aunque la prenda siguiera en
   Bordado sin remito (caso EST-20947).

   El código ya no lo marca más (prendasOrdersController). Este script corrige las
   órdenes vivas que quedaron así.

   Correr por bloques.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1) DIAGNÓSTICO — Estampados vivos, de pedidos con orden PRO, con PRENDA en
      "no aplica". PrendaYaLlego = 1 significa que a Estampado YA le llegó un
      bulto de un área que entrega prendas (Bordado, Costura, PRO): esas NO hay
      que tocarlas, porque el requisito ya no se volvería a cumplir solo.
   --------------------------------------------------------------------------- */
SELECT o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS Orden, LTRIM(RTRIM(o.NoDocERP)) AS Pedido,
       o.Estado, o.EstadoenArea, c.FechaCumplimiento,
       CASE WHEN EXISTS (
            SELECT 1
            FROM Logistica_Bultos b
            JOIN Ordenes ob ON ob.OrdenID = b.OrdenID
            JOIN MovimientosLogistica m ON m.CodigoBulto = b.CodigoEtiqueta
                                       AND m.EsRecepcion = 1 AND m.AreaID = 'EST'
            WHERE ob.AreaID IN ('EMB', 'TWT', 'PRO')
              AND (LTRIM(RTRIM(ob.NoDocERP)) = LTRIM(RTRIM(o.NoDocERP))
                   OR LTRIM(RTRIM(ob.ComboPedidoNoDocERP)) = LTRIM(RTRIM(o.NoDocERP)))
       ) THEN 1 ELSE 0 END AS PrendaYaLlego
FROM OrdenCumplimientoRequisitos c
JOIN ConfigRequisitosProduccion q ON q.RequisitoID = c.RequisitoID
JOIN Ordenes o ON o.OrdenID = c.OrdenID
WHERE q.AreaID = 'EST' AND q.CodigoRequisito = 'PRENDA'
  AND c.Observaciones LIKE 'No aplica — el canal real%'
  AND o.Estado NOT IN ('Cancelado', 'CANCELADO', 'Finalizado', 'Entregado')
  AND EXISTS (SELECT 1 FROM Ordenes p
              WHERE LTRIM(RTRIM(p.NoDocERP)) = LTRIM(RTRIM(o.NoDocERP)) AND p.AreaID = 'PRO')
ORDER BY o.OrdenID;

/* ---------------------------------------------------------------------------
   2) CORRECCIÓN — saca el "no aplica" de PRENDA solo donde la prenda TODAVÍA NO
      llegó a Estampado. Desde ahí el requisito queda pendiente y se cumple solo
      al recibir el remito de Bordado / Costura / PRO.
   --------------------------------------------------------------------------- */
BEGIN TRAN;

DELETE c
FROM OrdenCumplimientoRequisitos c
JOIN ConfigRequisitosProduccion q ON q.RequisitoID = c.RequisitoID
JOIN Ordenes o ON o.OrdenID = c.OrdenID
WHERE q.AreaID = 'EST' AND q.CodigoRequisito = 'PRENDA'
  AND c.Observaciones LIKE 'No aplica — el canal real%'
  AND o.Estado NOT IN ('Cancelado', 'CANCELADO', 'Finalizado', 'Entregado')
  AND ISNULL(o.EstadoenArea, '') NOT IN ('Pronto', 'Control y Calidad')
  AND EXISTS (SELECT 1 FROM Ordenes p
              WHERE LTRIM(RTRIM(p.NoDocERP)) = LTRIM(RTRIM(o.NoDocERP)) AND p.AreaID = 'PRO')
  AND NOT EXISTS (
        SELECT 1
        FROM Logistica_Bultos b
        JOIN Ordenes ob ON ob.OrdenID = b.OrdenID
        JOIN MovimientosLogistica m ON m.CodigoBulto = b.CodigoEtiqueta
                                   AND m.EsRecepcion = 1 AND m.AreaID = 'EST'
        WHERE ob.AreaID IN ('EMB', 'TWT', 'PRO')
          AND (LTRIM(RTRIM(ob.NoDocERP)) = LTRIM(RTRIM(o.NoDocERP))
               OR LTRIM(RTRIM(ob.ComboPedidoNoDocERP)) = LTRIM(RTRIM(o.NoDocERP)))
  );

SELECT @@ROWCOUNT AS RequisitosReabiertos;

-- Revisar el número contra el bloque 1 y recién ahí:
-- COMMIT TRAN;
-- ROLLBACK TRAN;
