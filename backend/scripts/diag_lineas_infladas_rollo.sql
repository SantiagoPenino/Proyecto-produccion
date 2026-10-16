-- ============================================================================
-- DIAGNÓSTICO (SOLO LECTURA): líneas de factura infladas por órdenes
-- cubiertas por rollo/plan (bug resolverLineasDetalle → td.TdeImporteFinal)
--
-- Patrón: la orden entró al documento con OrdCostoFinal = 0 (cubierta por el
-- plan de metros) y sin precio propio en PedidosCobranzaDetalle, pero la línea
-- quedó con DcdTotal > 0 (heredó el importe TOTAL de la transacción/retiro).
-- Caso testigo: SABONIS 24/7/2026 — 3 DTF cubiertas por Plan #19 salieron
-- con 57,60 c/u (el importe de la ECOUV-14638).
--
-- Correr en SecureAppDB. No modifica nada.
-- ============================================================================

-- 1) LÍNEAS infladas (una fila por línea sospechosa)
SELECT d.DocIdDocumento,
       LTRIM(RTRIM(d.DocTipo))   AS DocTipo,
       d.DocSerie, d.DocNumero,
       CONVERT(VARCHAR(10), d.DocFechaEmision, 103) AS Fecha,
       LTRIM(RTRIM(c.NombreFantasia)) AS Cliente,
       dd.OrdCodigoOrden,
       dd.DcdCantidad,
       dd.DcdTotal               AS ImporteLineaInflada,
       d.DocTotal,
       d.DocEstado, d.CfeEstado
FROM   dbo.DocumentosContablesDetalle dd WITH(NOLOCK)
JOIN   dbo.DocumentosContables d  WITH(NOLOCK) ON d.DocIdDocumento = dd.DocIdDocumento
JOIN   dbo.OrdenesDeposito od     WITH(NOLOCK) ON od.OrdCodigoOrden = dd.OrdCodigoOrden
LEFT JOIN dbo.Clientes c          WITH(NOLOCK) ON c.CliIdCliente = d.CliIdCliente
LEFT JOIN dbo.PedidosCobranza pc  WITH(NOLOCK) ON LTRIM(RTRIM(CAST(pc.NoDocERP AS VARCHAR(100)))) = od.OrdCodigoOrden
LEFT JOIN dbo.PedidosCobranzaDetalle pcd WITH(NOLOCK) ON pcd.PedidoCobranzaID = pc.ID AND ISNULL(pcd.Subtotal, 0) > 0
WHERE  dd.DcdTotal > 0
  AND  ISNULL(od.OrdCostoFinal, 0) = 0          -- orden cubierta (costo 0)
  AND  pcd.PedidoCobranzaID IS NULL             -- sin precio propio en PC
  AND  d.DocEstado <> 'ANULADO'
  AND  dd.OrdCodigoOrden NOT LIKE '%-R[0-9]%'   -- reposiciones ya excluidas por el resolver
ORDER BY d.DocFechaEmision DESC, d.DocIdDocumento, dd.OrdCodigoOrden;

-- 2) RESUMEN por documento: cuánto quedó de más en las líneas
--    (DocTotal es lo cobrado — correcto; el exceso está solo en el detalle)
SELECT d.DocIdDocumento,
       LTRIM(RTRIM(d.DocTipo)) AS DocTipo,
       d.DocSerie, d.DocNumero,
       CONVERT(VARCHAR(10), d.DocFechaEmision, 103) AS Fecha,
       LTRIM(RTRIM(c.NombreFantasia)) AS Cliente,
       d.DocTotal,
       SUM(dd.DcdTotal)                    AS TotalLineas,
       SUM(dd.DcdTotal) - d.DocTotal       AS ExcesoEnLineas,
       d.CfeEstado
FROM   dbo.DocumentosContables d WITH(NOLOCK)
JOIN   dbo.DocumentosContablesDetalle dd WITH(NOLOCK) ON dd.DocIdDocumento = d.DocIdDocumento
LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = d.CliIdCliente
WHERE  d.DocEstado <> 'ANULADO'
  AND  EXISTS (
         SELECT 1
         FROM dbo.DocumentosContablesDetalle dd2 WITH(NOLOCK)
         JOIN dbo.OrdenesDeposito od2 WITH(NOLOCK) ON od2.OrdCodigoOrden = dd2.OrdCodigoOrden
         WHERE dd2.DocIdDocumento = d.DocIdDocumento
           AND dd2.DcdTotal > 0
           AND ISNULL(od2.OrdCostoFinal, 0) = 0
           AND dd2.OrdCodigoOrden NOT LIKE '%-R[0-9]%'
           AND NOT EXISTS (
                 SELECT 1 FROM dbo.PedidosCobranza pc2 WITH(NOLOCK)
                 JOIN dbo.PedidosCobranzaDetalle pcd2 WITH(NOLOCK) ON pcd2.PedidoCobranzaID = pc2.ID
                 WHERE LTRIM(RTRIM(CAST(pc2.NoDocERP AS VARCHAR(100)))) = od2.OrdCodigoOrden
                   AND ISNULL(pcd2.Subtotal, 0) > 0
           )
  )
GROUP BY d.DocIdDocumento, d.DocTipo, d.DocSerie, d.DocNumero, d.DocFechaEmision,
         c.NombreFantasia, d.DocTotal, d.CfeEstado
ORDER BY d.DocFechaEmision DESC;
