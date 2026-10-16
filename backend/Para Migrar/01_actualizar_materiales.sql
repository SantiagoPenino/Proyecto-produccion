-- ==============================================================================
-- Script de Migración de IDs de Artículos Rotos en Órdenes de Depósito
-- ==============================================================================

BEGIN TRAN;

-- 298: Frontlight 3,20 Brillo (reverso blanco) -> 360: Frontlight Brillo hasta 3.17
UPDATE OrdenesDeposito SET ProIdProducto = 360 WHERE ProIdProducto = 298;

-- 421: Tela TwoFace – Tela Doble Cara (2,9) -> 32: Tela Blackout – Tela Doble Cara (2,9)
UPDATE OrdenesDeposito SET ProIdProducto = 32 WHERE ProIdProducto = 421;

-- 342: Sintra Blanco (Impreso 1 Lado) 3 mm -> NO ASIGNADO
-- FALTA ID PARA SINTRA BLANCO: UPDATE OrdenesDeposito SET ProIdProducto = ??? WHERE ProIdProducto = 342;

-- 271: Tela Dry Microporoso Elite (Lado liso) -> 277: Dry Microporoso 1.83 (lado liso)
UPDATE OrdenesDeposito SET ProIdProducto = 277 WHERE ProIdProducto = 271;

-- 266: Tela Dry Microporoso 1.83 (lado poroso) -> 266: Dry Microporoso 1.83 (lado poroso)
UPDATE OrdenesDeposito SET ProIdProducto = 266 WHERE ProIdProducto = 266;

-- 379: Tela Cliente -> 1: Tela Cliente (Minimo 5mts)
UPDATE OrdenesDeposito SET ProIdProducto = 1 WHERE ProIdProducto = 379;

-- 419: Tela de bandera (3,10) -> 9: Tela de bandera (3,10)
UPDATE OrdenesDeposito SET ProIdProducto = 9 WHERE ProIdProducto = 419;

-- 314: Canvas 1,52 -> 347: Canvas Mate 1,52
UPDATE OrdenesDeposito SET ProIdProducto = 347 WHERE ProIdProducto = 314;

-- 380: Dry Poroso -> 217: Dry Poroso (1,50)
UPDATE OrdenesDeposito SET ProIdProducto = 217 WHERE ProIdProducto = 380;

-- 31: Corte Laser personalizado -> 90: Corte Laser por prenda
UPDATE OrdenesDeposito SET ProIdProducto = 90 WHERE ProIdProducto = 31;

-- 60: Tela Panama (1,50) -> 240: Panama (1,60)
UPDATE OrdenesDeposito SET ProIdProducto = 240 WHERE ProIdProducto = 60;

-- 306: Vinilo brillo 1,52 (Adhesivo Gris) -> 309: Vinilo brillo 1,37 (Adhesivo Gris)
UPDATE OrdenesDeposito SET ProIdProducto = 309 WHERE ProIdProducto = 306;

-- 392: DTF Dorado Brillante -> 248: DTF textil DORADO
UPDATE OrdenesDeposito SET ProIdProducto = 248 WHERE ProIdProducto = 392;

-- 243: Tela Hexagonal (1,80) -> 258: Hexagonal (1,83)
UPDATE OrdenesDeposito SET ProIdProducto = 258 WHERE ProIdProducto = 243;

-- 360: Cuadro canvas 1,40 x 1,00 -> 354: Cuadro canvas 1,20 x 1,20
UPDATE OrdenesDeposito SET ProIdProducto = 354 WHERE ProIdProducto = 360;

-- Quita el comentario a la siguiente linea si estas seguro de aplicar los cambios
-- COMMIT TRAN;

-- Si algo sale mal o quieres revertir antes del commit, ejecuta:
-- ROLLBACK TRAN;
