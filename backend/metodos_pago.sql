USE [SecureAppDB];
GO

-- ============================================================
-- FIX: Activar métodos de pago y restaurar datos correctos
-- La tabla tiene columnas extra: MPaAfectaCaja (bit), MPaTipo (varchar)
-- Todos estaban con MPaActivo = 0
-- ============================================================

-- 1. Verificar estado actual
SELECT MPaIdMetodoPago, MPaDescripcionMetodo, MPaAfectaCaja, MPaTipo, MPaActivo
FROM dbo.MetodosPagos
ORDER BY MPaIdMetodoPago;
GO

-- 2. Activar todos los métodos de pago y establecer valores correctos
UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 1,
    MPaTipo        = 'EFECTIVO'
WHERE MPaIdMetodoPago = 1; -- Efectivo / Contado

UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 1,
    MPaTipo        = 'TRANSFERENCIA'
WHERE MPaIdMetodoPago = 2; -- Transferencia BROU

UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 1,
    MPaTipo        = 'TARJETA'
WHERE MPaIdMetodoPago = 3; -- Tarjeta de Débito

UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 1,
    MPaTipo        = 'TARJETA'
WHERE MPaIdMetodoPago = 4; -- Tarjeta de Crédito

UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 0,
    MPaTipo        = 'DIGITAL'
WHERE MPaIdMetodoPago = 5; -- Mercado pago

UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 1,
    MPaTipo        = 'TRANSFERENCIA'
WHERE MPaIdMetodoPago = 6; -- Take (BROU)

UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 0,
    MPaTipo        = 'CREDITO'
WHERE MPaIdMetodoPago = 7; -- Rollo por adelantado

UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 0,
    MPaTipo        = 'DESCUENTO'
WHERE MPaIdMetodoPago = 8; -- Descuento de sueldo

UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 0,
    MPaTipo        = 'DIGITAL'
WHERE MPaIdMetodoPago = 9; -- Pago en Linea Handy

UPDATE dbo.MetodosPagos SET
    MPaActivo      = 1,
    MPaAfectaCaja  = 0,
    MPaTipo        = 'DIGITAL'
WHERE MPaIdMetodoPago = 10; -- MercadoPago Online

-- 3. Actualizar nombres correctos
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Efectivo'              WHERE MPaIdMetodoPago = 1;
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Transferencia BROU'    WHERE MPaIdMetodoPago = 2;
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Tarjeta de Débito'     WHERE MPaIdMetodoPago = 3;
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Tarjeta de Crédito'    WHERE MPaIdMetodoPago = 4;
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Mercado Pago'          WHERE MPaIdMetodoPago = 5;
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Take (BROU)'           WHERE MPaIdMetodoPago = 6;
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Rollo por adelantado'  WHERE MPaIdMetodoPago = 7;
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Descuento de sueldo'   WHERE MPaIdMetodoPago = 8;
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Pago en Línea Handy'   WHERE MPaIdMetodoPago = 9;
UPDATE dbo.MetodosPagos SET MPaDescripcionMetodo = 'Pago en Línea MercadoPago' WHERE MPaIdMetodoPago = 10;

-- 4. Agregar métodos faltantes si no existen
IF NOT EXISTS (SELECT 1 FROM dbo.MetodosPagos WHERE MPaIdMetodoPago = 11)
    INSERT INTO dbo.MetodosPagos (MPaIdMetodoPago, MPaDescripcionMetodo, MPaAfectaCaja, MPaTipo, MPaActivo)
    VALUES (11, 'Cheques', 1, 'CHEQUE', 1);

IF NOT EXISTS (SELECT 1 FROM dbo.MetodosPagos WHERE MPaIdMetodoPago = 10)
    INSERT INTO dbo.MetodosPagos (MPaIdMetodoPago, MPaDescripcionMetodo, MPaAfectaCaja, MPaTipo, MPaActivo)
    VALUES (10, 'Transferencia Santander', 1, 'TRANSFERENCIA', 1);

-- 5. Verificar resultado final
SELECT MPaIdMetodoPago, MPaDescripcionMetodo, MPaAfectaCaja, MPaTipo, MPaActivo
FROM dbo.MetodosPagos
ORDER BY MPaIdMetodoPago;
GO

PRINT 'Métodos de pago actualizados correctamente.';
GO
