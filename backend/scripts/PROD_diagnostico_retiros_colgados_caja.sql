/* =====================================================================================
   DIAGNÓSTICO: retiros "colgados" en Caja (02-oct-2026, caso RW-29873 / SUB-26499-R1).
   SOLO LECTURA.

   Caja (GET /apiordenesRetiro/caja → ordenesRetiroController.ordenesRetiroCaja) lista
   todo retiro que cumpla:
       OReEstadoActual <> 6 (cancelado)  Y  OrdenesRetiro.PagIdPago IS NULL
       Y alguna orden con OrdenesDeposito.PagIdPago IS NULL (salvo cubierta por billetera).
   No mira el ESTADO (un retiro Entregado sigue saliendo), ni el COSTO (una orden a $0
   sigue saliendo), ni si la orden se cobró por DOCUMENTO (factura/PC del 360 o del
   cierre semanal: ese circuito paga el documento, nunca estampa PagIdPago en la orden).

   Categorías (por retiro, mirando solo sus órdenes sin PagIdPago):
     1 TODO COSTO 0             → no hay nada que cobrar (reposición -R/-F, cubierta por plan…)
     2 COBRADO POR DOCUMENTO    → todas tienen documento emitido y PAGADO
     3 FACTURADO, DOC. IMPAGO   → tienen documento pero debe (cuenta corriente)
     4 ENTREGADO SIN PAGO       → el retiro está Entregado (5) y no hay pago ni documento
     5 PENDIENTE REAL           → falta cobrar de verdad
   El tipo de cliente se muestra porque Caja por defecto OCULTA a los Semanales (tipo 2).
   ===================================================================================== */
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @Retiro INT = 29873;   -- caso puntual (RW-29873)

/* A. EL CASO --------------------------------------------------------------------------- */
SELECT 'A1. RETIRO' AS Bloque, r.OReIdOrdenRetiro, r.FormaRetiro, r.OReEstadoActual, er.EORNombreEstado,
       r.PagIdPago, r.OReCostoTotalOrden, r.MonIdMoneda, r.OReFechaAlta, r.OReUsuarioAlta, r.CodCliente,
       r.LReIdLugarRetiro, r.AgenciaEnvio
FROM OrdenesRetiro r LEFT JOIN EstadosOrdenesRetiro er ON er.EORIdEstadoOrden = r.OReEstadoActual
WHERE r.OReIdOrdenRetiro = @Retiro;

SELECT 'A2. HISTORIAL RETIRO' AS Bloque, h.EORIdEstadoOrden, er.EORNombreEstado, h.HEOFechaEstado, h.HEOUsuarioAlta
FROM HistoricoEstadosOrdenesRetiro h LEFT JOIN EstadosOrdenesRetiro er ON er.EORIdEstadoOrden = h.EORIdEstadoOrden
WHERE h.OReIdOrdenRetiro = @Retiro ORDER BY h.HEOFechaEstado;

SELECT 'A3. ORDENES DEL RETIRO' AS Bloque, od.OrdIdOrden, od.OrdCodigoOrden, od.OrdCantidad, od.OrdCostoFinal,
       od.MonIdMoneda, od.PagIdPago, od.OrdEstadoActual, od.OrdFechaIngresoOrden,
       o.OrdenID, o.Prioridad, o.CostoTotal AS CostoTotalOrden,
       (SELECT ISNULL(SUM(Subtotal), 0) FROM PedidosCobranzaDetalle WHERE OrdenID = o.OrdenID) AS SubtotalCotizado
FROM OrdenesDeposito od LEFT JOIN Ordenes o ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
WHERE od.OReIdOrdenRetiro = @Retiro;

/* B. TODOS LOS RETIROS QUE CAJA MUESTRA COMO PENDIENTES, CLASIFICADOS ------------------- */
IF OBJECT_ID('tempdb..#Ord') IS NOT NULL DROP TABLE #Ord;

SELECT r.OReIdOrdenRetiro, r.FormaRetiro, r.OReEstadoActual, r.OReFechaAlta, r.CodCliente,
       od.OrdIdOrden, od.OrdCodigoOrden, od.CliIdCliente, od.MonIdMoneda,
       ISNULL(od.OrdCostoFinal, 0) AS Costo,
       CASE WHEN od.OrdCodigoOrden LIKE '%-R[0-9]%' OR od.OrdCodigoOrden LIKE '%-F[0-9]%' THEN 1 ELSE 0 END AS EsRepo,
       D.DocIdDocumento, D.DocSerie, D.DocNumero, D.DocTipo,
       CASE WHEN D.DocIdDocumento IS NULL THEN NULL
            WHEN D.DocPagado = 1 THEN 1
            WHEN EXISTS (SELECT 1 FROM DeudaDocumento dd WHERE dd.DocIdDocumento = D.DocIdDocumento)
             AND NOT EXISTS (SELECT 1 FROM DeudaDocumento dd WHERE dd.DocIdDocumento = D.DocIdDocumento AND dd.DDeImportePendiente > 0.005)
            THEN 1 ELSE 0 END AS DocPagado
INTO #Ord
FROM OrdenesRetiro r
JOIN OrdenesDeposito od ON od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL
OUTER APPLY (
    -- Documento (factura / pedido caja) emitido por la orden: el movimiento ORDEN de la
    -- cuenta del cliente queda con DocIdDocumento. La orden se identifica por su id de
    -- depósito, por el de Ordenes (la vía logística graba ese) o por el código al inicio
    -- del concepto (ver auditDepositoController).
    SELECT TOP 1 dc.DocIdDocumento, dc.DocSerie, dc.DocNumero, dc.DocTipo, dc.DocPagado
    FROM MovimientosCuenta m
    JOIN CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta AND cc.CliIdCliente = od.CliIdCliente
    JOIN DocumentosContables dc ON dc.DocIdDocumento = m.DocIdDocumento AND ISNULL(dc.DocEstado, '') <> 'ANULADO'
    WHERE m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO') AND ISNULL(m.MovAnulado, 0) = 0
      AND (m.OrdIdOrden = od.OrdIdOrden
           OR m.OrdIdOrden IN (SELECT o2.OrdenID FROM Ordenes o2 WHERE o2.CodigoOrden = od.OrdCodigoOrden)
           OR m.MovConcepto LIKE LTRIM(RTRIM(od.OrdCodigoOrden)) + ' %')
    ORDER BY m.MovIdMovimiento DESC
) D
WHERE r.OReEstadoActual <> 6
  AND r.PagIdPago IS NULL
  -- misma excepción que Caja: orden cubierta entera con la billetera
  AND NOT EXISTS (
      SELECT 1 FROM MovimientosCuenta cb
      JOIN CuentasCliente ccb ON ccb.CueIdCuenta = cb.CueIdCuenta AND ccb.CliIdCliente = od.CliIdCliente
      WHERE (cb.OrdIdOrden = od.OrdIdOrden OR cb.OrdIdOrden IN (SELECT o3.OrdenID FROM Ordenes o3 WHERE o3.CodigoOrden = od.OrdCodigoOrden))
        AND cb.MovTipo = 'CONSUMO_CUENTA' AND ISNULL(cb.MovAnulado, 0) = 0
        AND cb.MovObservaciones LIKE 'CUBIERTO[_]CUENTA[_]%');

IF OBJECT_ID('tempdb..#Ret') IS NOT NULL DROP TABLE #Ret;
SELECT x.*,
       CASE WHEN x.NCero = x.N THEN '1 TODO COSTO 0'
            WHEN x.NCero + x.NDocPagado = x.N THEN '2 COBRADO POR DOCUMENTO'
            WHEN x.NCero + x.NConDoc = x.N THEN '3 FACTURADO, DOC. IMPAGO'
            WHEN x.OReEstadoActual = 5 THEN '4 ENTREGADO SIN PAGO'
            ELSE '5 PENDIENTE REAL' END AS Categoria
INTO #Ret
FROM (
    SELECT o.OReIdOrdenRetiro, o.FormaRetiro, o.OReEstadoActual, o.OReFechaAlta, o.CodCliente,
           COUNT(*) AS N,
           SUM(CASE WHEN o.Costo <= 0 THEN 1 ELSE 0 END) AS NCero,
           SUM(CASE WHEN o.Costo > 0 AND o.DocIdDocumento IS NOT NULL THEN 1 ELSE 0 END) AS NConDoc,
           SUM(CASE WHEN o.Costo > 0 AND o.DocPagado = 1 THEN 1 ELSE 0 END) AS NDocPagado,
           SUM(o.EsRepo) AS NRepo,
           SUM(CASE WHEN o.MonIdMoneda = 2 THEN 0 ELSE o.Costo END) AS PendienteUYU,
           SUM(CASE WHEN o.MonIdMoneda = 2 THEN o.Costo ELSE 0 END) AS PendienteUSD
    FROM #Ord o
    GROUP BY o.OReIdOrdenRetiro, o.FormaRetiro, o.OReEstadoActual, o.OReFechaAlta, o.CodCliente
) x;

-- B1. Resumen por categoría
SELECT 'B1. RESUMEN' AS Bloque, Categoria, COUNT(*) AS Retiros, SUM(N) AS Ordenes,
       SUM(CASE WHEN OReEstadoActual = 5 THEN 1 ELSE 0 END) AS YaEntregados,
       SUM(PendienteUYU) AS UYU, SUM(PendienteUSD) AS USD,
       MIN(OReFechaAlta) AS MasViejo, MAX(OReFechaAlta) AS MasNuevo
FROM #Ret GROUP BY Categoria ORDER BY Categoria;

-- B2. Por estado del retiro y tipo de cliente (Caja oculta los Semanales por defecto)
SELECT 'B2. ESTADO x TIPO' AS Bloque, r.Categoria, er.EORNombreEstado, ISNULL(tc.TClDescripcion, '(sin tipo)') AS TipoCliente,
       COUNT(*) AS Retiros
FROM #Ret r
LEFT JOIN EstadosOrdenesRetiro er ON er.EORIdEstadoOrden = r.OReEstadoActual
LEFT JOIN Clientes c ON c.CodCliente = r.CodCliente
LEFT JOIN TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
GROUP BY r.Categoria, er.EORNombreEstado, tc.TClDescripcion
ORDER BY r.Categoria, COUNT(*) DESC;

-- B3. Retiros a $0 creados DESPUÉS del arreglo de crearRetiro (commit f08e495, 29-sep):
--     si aparecen, hay otro camino que los deja frenados.
SELECT 'B3. COSTO 0 RECIENTES' AS Bloque, r.OReIdOrdenRetiro, r.FormaRetiro, er.EORNombreEstado, r.OReFechaAlta, r.N, r.NRepo
FROM #Ret r LEFT JOIN EstadosOrdenesRetiro er ON er.EORIdEstadoOrden = r.OReEstadoActual
WHERE r.Categoria = '1 TODO COSTO 0' AND r.OReFechaAlta >= '2026-09-29'
ORDER BY r.OReFechaAlta DESC;

-- B4. Detalle (las 500 más viejas por categoría)
SELECT TOP 500 'B4. DETALLE' AS Bloque, r.Categoria, r.FormaRetiro + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR(20)) AS Retiro,
       er.EORNombreEstado, r.OReFechaAlta, c.IDCliente, ISNULL(tc.TClDescripcion, '') AS TipoCliente,
       r.N, r.NCero, r.NRepo, r.NConDoc, r.NDocPagado, r.PendienteUYU, r.PendienteUSD,
       (SELECT STRING_AGG(o.OrdCodigoOrden + ' ' + CAST(o.Costo AS VARCHAR(20))
                          + ISNULL(' [' + o.DocSerie + '-' + CAST(o.DocNumero AS VARCHAR(20)) + CASE WHEN o.DocPagado = 1 THEN ' pago]' ELSE ' impago]' END, ''), ' | ')
          FROM #Ord o WHERE o.OReIdOrdenRetiro = r.OReIdOrdenRetiro) AS Ordenes
FROM #Ret r
LEFT JOIN EstadosOrdenesRetiro er ON er.EORIdEstadoOrden = r.OReEstadoActual
LEFT JOIN Clientes c ON c.CodCliente = r.CodCliente
LEFT JOIN TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
ORDER BY r.Categoria, r.OReFechaAlta;
