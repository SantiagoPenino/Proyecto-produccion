-- FIX pre-factura Rolymajenski - 3/9/2026 (version 2: incluye EUV-14116 con lineas mezcladas)
-- Abrir en SSMS con File -> Open (no copiar/pegar del chat) y ejecutar contra SecureAppDB.
-- Deja los registros IGUALES a lo que muestra la pantalla (US$ 866,39) para emitir
-- la factura en UNA sola pasada SIN tocar ningun precio.

SET XACT_ABORT ON;
BEGIN TRAN;

-- 1) EUV-14116 LONARESIDENCIAL (pedido congelado 22735): las lineas de soldadura y
--    ojales estan marcadas 'UYU' pero ya guardan los valores en dolares (3.67 y 0.73);
--    el recalculo las divide por el TC y deja el total en 16.79. Se fijan tal cual la
--    pantalla, en USD.
UPDATE dbo.PedidosCobranzaDetalle
SET    Moneda = 'USD', PrecioUnitario = 3.67, Subtotal = 12.48
WHERE  ID = 24338 AND PedidoCobranzaID = 22735;

UPDATE dbo.PedidosCobranzaDetalle
SET    Moneda = 'USD', PrecioUnitario = 0.73, Subtotal = 11.68
WHERE  ID = 24339 AND PedidoCobranzaID = 22735;

UPDATE dbo.PedidosCobranza
SET    MontoTotal = 40.36, Moneda = 'USD'      -- 16.20 + 12.48 + 11.68
WHERE  ID = 22735;

UPDATE dbo.MovimientosCuenta
SET    MovImporte = -40.36
WHERE  MovIdMovimiento = 35279
  AND  CueIdCuenta = 81
  AND  DocIdDocumento IS NULL;

-- Espejo del saldo denormalizado (misma convencion que el traslado multimoneda):
-- la orden pasa de deber 16.79 a deber 40.36 -> 23.57 mas.
UPDATE dbo.CuentasCliente
SET    CueSaldoActual = ISNULL(CueSaldoActual, 0) - 23.57
WHERE  CueIdCuenta = 81;

-- 2) Las 4 banderas: montos congelados ya en dolares pero marcados 'UYU'.
--    Se marcan USD para que la emision los tome tal cual (idempotente).
UPDATE dbo.PedidosCobranza
SET    Moneda = 'USD'
WHERE  ID IN (20135, 25136, 24031, 25730)   -- SUB-11590, SUB-16489, SUB-15391, SUB-17079
  AND  Moneda = 'UYU';

COMMIT;

-- 3) VERIFICACION: con la misma seleccion del borrador tiene que dar 866.39
SELECT SUM(ABS(MovImporte)) AS TotalMovsSeleccion   -- esperado: 866.39
FROM dbo.MovimientosCuenta
WHERE CicIdCiclo = 439
  AND MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND DocIdDocumento IS NULL
  AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND MovIdMovimiento NOT IN (43899, 44010, 44080, 44637); -- EUV-19358, SUB-19028, EUV-19365, DTF-19788 (destildadas)

SELECT ID, MontoTotal, Moneda FROM dbo.PedidosCobranza WHERE ID IN (22735, 20135, 25136, 24031, 25730); -- todos USD, 22735 = 40.36
SELECT ID, Moneda, PrecioUnitario, Subtotal FROM dbo.PedidosCobranzaDetalle WHERE PedidoCobranzaID = 22735; -- 3 lineas USD
