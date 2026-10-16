-- PRO-20949 y PRO-20950 (pedidos cobrados POR ÁREA) entraron a Depósito con el importe de las
-- líneas propias de la PRO madre (297 / 0), la cantidad sumada de sus líneas (6) y sin producto.
-- Lo correcto: total del pedido, prendas de la madre y producto PPERS.

-- 1) Ver
SELECT OrdIdOrden, OrdCodigoOrden, OrdCantidad, ProIdProducto, MonIdMoneda, OrdCostoFinal, OrdEstadoActual
FROM OrdenesDeposito WHERE OrdCodigoOrden IN ('PRO-20949', 'PRO-20950');

-- 2) Corregir
BEGIN TRAN;
UPDATE OrdenesDeposito SET OrdCostoFinal = 597,  OrdCantidad = 3,  ProIdProducto = 562 WHERE OrdCodigoOrden = 'PRO-20949' AND MonIdMoneda = 1;
UPDATE OrdenesDeposito SET OrdCostoFinal = 3000, OrdCantidad = 30, ProIdProducto = 562 WHERE OrdCodigoOrden = 'PRO-20950' AND MonIdMoneda = 1;
SELECT OrdIdOrden, OrdCodigoOrden, OrdCantidad, ProIdProducto, OrdCostoFinal
FROM OrdenesDeposito WHERE OrdCodigoOrden IN ('PRO-20949', 'PRO-20950');
-- COMMIT;   (o ROLLBACK;)
