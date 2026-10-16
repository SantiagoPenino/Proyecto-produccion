-- =====================================================================
-- ConfigEstados: nuevo EstadoenArea 'Recibido en Destino'
-- =====================================================================
-- Contexto: cuando una orden sale de un área (createRemito la deja
-- EstadoenArea='En transito') y su bulto se recibe físicamente en la
-- SIGUIENTE área (receiveDispatch), la orden de ORIGEN se quedaba
-- 'En transito' PARA SIEMPRE — nada la marcaba como terminada en esa
-- área. Eso hacía que la Hoja de Ruta mostrara "PRODUCCION" en todos los
-- pasos ya entregados. Ahora receiveDispatch avanza la orden de origen a
-- este nuevo estado apenas confirma la llegada del bulto (ver
-- logisticsController.js, exports.receiveDispatch).
--
-- EstadoPadreID=1 ('Produccion'): mismo padre que 'Pronto'/'En transito'
-- — el Estado GENERAL del pedido sigue en Producción (el pedido sigue
-- su curso en otras áreas), solo cambia el EstadoenArea específico.

-- EstadoID NO es autoincremental en esta tabla — hay que darle el próximo valor a mano.
INSERT INTO dbo.ConfigEstados (EstadoID, AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado, EstadoPadreID)
VALUES ((SELECT MAX(EstadoID) + 1 FROM dbo.ConfigEstados), 'ADMIN', 'Recibido en Destino', '#22c55e', 13, 0, 'ESTADOENAREA', 1);

-- Verificación
SELECT * FROM dbo.ConfigEstados WHERE Nombre = 'Recibido en Destino';
