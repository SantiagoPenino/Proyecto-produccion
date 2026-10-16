-- =====================================================================
-- ECOUV — Parámetro que el cliente define por terminación (30/07/2026)
--
-- Cada terminación puede llevar un dato que el cliente ajusta en el pedido
-- y que el taller necesita para trabajar:
--   · Bolsillo → a qué distancia del borde va la costura (cm)
--   · Ojales   → cada cuántos cm se reparten
--
-- Se guarda por ARCHIVO (OrdenTerminaciones) porque puede variar entre
-- piezas del mismo pedido. El valor por defecto sigue saliendo de
-- Terminaciones.ParamCantidad; esta columna es lo que el cliente eligió.
--
-- Idempotente.
-- =====================================================================

IF COL_LENGTH('dbo.OrdenTerminaciones', 'ParamCliente') IS NULL
BEGIN
    ALTER TABLE OrdenTerminaciones ADD ParamCliente DECIMAL(9,2) NULL;
    PRINT 'Columna OrdenTerminaciones.ParamCliente creada';
END
ELSE PRINT 'Columna OrdenTerminaciones.ParamCliente ya existe';
GO

-- Mismo dato en la ficha del producto terminado (ej. un pasacalle que
-- siempre lleva el bolsillo a 8 cm) para que se copie al crear la orden.
IF COL_LENGTH('dbo.ProductoTerminadoTerminaciones', 'ParamCliente') IS NULL
BEGIN
    ALTER TABLE ProductoTerminadoTerminaciones ADD ParamCliente DECIMAL(9,2) NULL;
    PRINT 'Columna ProductoTerminadoTerminaciones.ParamCliente creada';
END
ELSE PRINT 'Columna ProductoTerminadoTerminaciones.ParamCliente ya existe';
GO

-- Valor por defecto del BOLSILLO: tamaño 5 cm (definición negocio 01/08).
-- Se guarda en el catálogo para que el portal lo proponga; el cliente lo ajusta.
UPDATE Terminaciones
SET ParamCantidad = 5
WHERE LTRIM(RTRIM(Nombre)) = N'Bolsillo'
  AND (ParamCantidad IS NULL OR ParamCantidad = 8);   -- 8 fue el default de una versión anterior
PRINT CONCAT('Bolsillo con tamaño por defecto (5 cm): ', @@ROWCOUNT);
GO

-- Verificación
SELECT LTRIM(RTRIM(Nombre)) AS Terminacion, UnidadCobro, ReglaCantidad, ParamCantidad, Ubicaciones
FROM Terminaciones WHERE Activo = 1 ORDER BY Nombre;
GO
