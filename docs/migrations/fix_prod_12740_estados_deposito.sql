-- ============================================================================
-- DIAGNOSTICO + FIX PROD: pedido 12740 — al llegar a deposito no actualiza estados
--
-- HIPOTESIS (mismo mal que 12044): el codigo viejo de prod ya les creo la fila
-- de OrdenesDeposito y les puso Ingresado/Avisado ANTES de tiempo (ingreso
-- fantasma). Cuando el producto REAL llega a deposito, el guard anti-duplicado
-- ve la fila existente y saltea todo: ni estado, ni aviso. Por eso "no se
-- actualiza": ya estaba "hecho" para el sistema.
-- ============================================================================

-- ---------- 1) DIAGNOSTICO (solo lectura) ----------
SELECT OrdenID, CodigoOrden, AreaID, Estado, EstadoenArea, EstadoLogistica,
       ProximoServicio
FROM Ordenes
WHERE CodigoOrden IN ('EUV-12740','XEUV-12740');

-- Historial: buscar el "Ingresado"/"Avisado" con fecha ANTERIOR al remito real
SELECT h.OrdenID, o.CodigoOrden, h.Estado, h.FechaInicio, LEFT(h.Detalle, 80) AS Detalle
FROM HistorialOrdenes h
JOIN Ordenes o ON o.OrdenID = h.OrdenID
WHERE o.CodigoOrden IN ('EUV-12740','XEUV-12740')
ORDER BY h.FechaInicio DESC;

-- Filas de deposito (la fantasma de la XEUV y la prematura de la EUV)
SELECT OrdIdOrden, OrdCodigoOrden, OrdCantidad, OrdCostoFinal, OrdEstadoActual,
       OReIdOrdenRetiro, OrdFechaIngresoOrden
FROM OrdenesDeposito
WHERE OrdCodigoOrden IN ('EUV-12740','XEUV-12740');

-- Bultos reales del pedido y donde estan parados
SELECT b.BultoID, b.CodigoEtiqueta, b.Tipocontenido, b.OrdenID, b.Estado, b.UbicacionActual
FROM Logistica_Bultos b
JOIN Ordenes o ON o.OrdenID = b.OrdenID AND ISNULL(b.Tipocontenido,'') <> 'ENCOMIENDA'
WHERE o.CodigoOrden IN ('EUV-12740','XEUV-12740');

-- ---------- 2) FIX ----------
BEGIN TRAN;

-- a) La hermana XEUV cierra Finalizada (su unico rol era el trabajo de terminacion;
--    'Ingresado' le quedo del ingreso fantasma). Sin fila propia en deposito.
UPDATE Ordenes
SET Estado = 'Finalizado', EstadoenArea = 'Finalizado', EstadoLogistica = NULL
WHERE CodigoOrden = 'XEUV-12740' AND AreaID = 'TERMINAC'
  AND Estado NOT IN ('Cancelado','CANCELADO');

INSERT INTO dbo.HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
SELECT OrdenID, 'Finalizado', GETDATE(), GETDATE(), 'Sistema',
       'Cierre de la orden de terminaciones (ajuste: Ingresado provenia del ingreso fantasma a deposito)'
FROM Ordenes WHERE CodigoOrden = 'XEUV-12740';

-- b) Borrar la fila fantasma de la XEUV en deposito (si no tiene retiro asignado)
DELETE FROM OrdenesDeposito
WHERE OrdCodigoOrden = 'XEUV-12740' AND OReIdOrdenRetiro IS NULL;

-- c) La EUV madre: 'Avisado' es el estado final correcto si el producto ya esta en
--    deposito y el cliente ya fue avisado. NO se toca — solo verificar en el paso 1
--    que su fila de OrdenesDeposito tenga cantidad/costo correctos (si la cantidad
--    esta inflada, la corrige el paso 3 de fix_prod_xeuv_en_deposito.sql).

COMMIT;

-- ---------- 3) VERIFICACION ----------
SELECT CodigoOrden, Estado, EstadoenArea, EstadoLogistica FROM Ordenes
WHERE CodigoOrden IN ('EUV-12740','XEUV-12740');
SELECT OrdCodigoOrden, OrdCantidad, OrdEstadoActual, OReIdOrdenRetiro FROM OrdenesDeposito
WHERE OrdCodigoOrden IN ('EUV-12740','XEUV-12740');
