/* ============================================================================
   fix_ven_usd_articulo_tela.sql
   ----------------------------------------------------------------------------
   PROBLEMA
   Las ventas de la tienda/WMS en DÓLARES entraban a Depósito con
   ProIdProducto = 411, que NO es un artículo genérico: es la tela real
   "Dry Pro New (1,83)" (Grupo 1.1, ancho imprimible 1,83), la misma que
   consumen las órdenes SUB-. Las ventas en pesos, en cambio, entraban con el
   genérico 386 ("Articulos User"), que es lo correcto.

   Consecuencias (además de que el buscador de órdenes mostraba "Dry Pro New"
   como producto de la venta):
     · hookOrdenCreada busca plan de metros por (cliente, artículo). Un cliente
       con rollo adelantado de Dry Pro New que compre en USD se lleva la venta
       descontada de sus METROS, sin deuda monetaria.
     · Cliente tipo ROLLO/SEMANAL sin plan activo: se le anota -1 metro en la
       cuenta de recursos en lugar del cargo en dólares.
     · Los reportes por artículo suman las ventas al consumo de esa tela.

   El fix de código (logisticaWmsController.receivePreparedOrder) ya deja
   SIEMPRE el genérico 386. Este script corrige lo que ya quedó grabado.

   Ejecutar por bloques, mirando el resultado de cada uno.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   1) DIAGNÓSTICO — cuántas órdenes VEN- quedaron con la tela
   --------------------------------------------------------------------------- */
SELECT COUNT(*) AS VentasConTela,
       MIN(OrdFechaIngresoOrden) AS Desde,
       MAX(OrdFechaIngresoOrden) AS Hasta
FROM   dbo.OrdenesDeposito WITH(NOLOCK)
WHERE  OrdCodigoOrden LIKE 'VEN-%'
  AND  ProIdProducto = 411;

/* ---------------------------------------------------------------------------
   2) CONTROL ANTES DE TOCAR NADA — ¿alguna de esas ventas llegó a descontar
      metros o a anotarse en una cuenta de recursos?
      Si esta consulta devuelve filas, NO corras el UPDATE: esas órdenes hay
      que revisarlas una por una (el cliente tenía rollo del artículo 411 y la
      venta se le cobró en metros en vez de en dólares).
   --------------------------------------------------------------------------- */
SELECT od.OrdIdOrden, od.OrdCodigoOrden, od.CliIdCliente, cl.Nombre AS Cliente,
       od.OrdCostoFinal, m.MovTipo, m.MovImporte, cc.CueTipo, m.MovObservaciones
FROM   dbo.OrdenesDeposito od WITH(NOLOCK)
JOIN   dbo.MovimientosCuenta m WITH(NOLOCK) ON m.OrdIdOrden = od.OrdIdOrden
JOIN   dbo.CuentasCliente cc WITH(NOLOCK)   ON cc.CueIdCuenta = m.CueIdCuenta
LEFT   JOIN dbo.Clientes cl WITH(NOLOCK)    ON cl.CliIdCliente = od.CliIdCliente
WHERE  od.OrdCodigoOrden LIKE 'VEN-%'
  AND  od.ProIdProducto = 411
  AND  cc.CueTipo NOT IN ('DINERO_USD','DINERO_UYU')   -- cuenta de recursos/metros
ORDER  BY od.OrdIdOrden DESC;

/* ---------------------------------------------------------------------------
   3) CLIENTES EN RIESGO HOY — los que tienen plan de metros vivo sobre el 411.
      Si alguno compra en USD por la tienda ANTES del deploy, la venta se le va
      a descontar de los metros.
   --------------------------------------------------------------------------- */
SELECT pm.PlaIdPlan, pm.CliIdCliente, cl.Nombre AS Cliente,
       pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaFechaVencimiento
FROM   dbo.PlanesMetros pm WITH(NOLOCK)
LEFT   JOIN dbo.Clientes cl WITH(NOLOCK) ON cl.CliIdCliente = pm.CliIdCliente
WHERE  pm.PlaActivo = 1
  AND  (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
  AND  (pm.ProIdProducto = 411
        OR EXISTS (SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                   WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = 411));

/* ---------------------------------------------------------------------------
   4) REPARACIÓN — dejar el artículo genérico en las ventas ya grabadas.
      Solo cambia la etiqueta del artículo: NO toca importes, ni moneda, ni
      cuentas, ni deudas. Corré esto SOLO si el bloque 2 no devolvió filas.
   --------------------------------------------------------------------------- */
BEGIN TRAN;

UPDATE dbo.OrdenesDeposito
SET    ProIdProducto = 386          -- "Articulos User" (genérico de venta)
WHERE  OrdCodigoOrden LIKE 'VEN-%'
  AND  ProIdProducto = 411;

SELECT @@ROWCOUNT AS FilasCorregidas;

-- Revisar el número y recién ahí:
-- COMMIT TRAN;
-- ROLLBACK TRAN;

/* ---------------------------------------------------------------------------
   5) VERIFICACIÓN POSTERIOR — no debe quedar ninguna
   --------------------------------------------------------------------------- */
SELECT ProIdProducto, COUNT(*) AS Cantidad
FROM   dbo.OrdenesDeposito WITH(NOLOCK)
WHERE  OrdCodigoOrden LIKE 'VEN-%'
GROUP  BY ProIdProducto;
