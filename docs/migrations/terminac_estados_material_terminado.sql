-- =====================================================================
-- TERMINAC: estados del ciclo de la orden hermana XEUV (29/07/2026)
--   Pendiente -> (check-in del material impreso) -> Material Recibido
--   -> (se marca la 1ra terminación) -> En Terminaciones (estado ya existente)
--   -> (Finalizar Tarea) -> Control y Calidad (estado ya existente)
--   -> (control aprueba) -> Pronto + Canasto Produccion
-- Solo se necesita crear 'Material Recibido'; el resto ya existe.
-- Idempotente: se puede correr varias veces.
-- ConfigEstados.EstadoID NO es IDENTITY: se inserta con MAX+1.
-- =====================================================================

IF NOT EXISTS (SELECT 1 FROM ConfigEstados WHERE Nombre = N'Material Recibido' AND TipoEstado = 'ESTADOENAREA')
BEGIN
    INSERT INTO ConfigEstados (EstadoID, AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado, EstadoPadreID)
    SELECT MAX(EstadoID) + 1, 'ADMIN', N'Material Recibido', '#0ea5e9', 91, 0, 'ESTADOENAREA', 1
    FROM ConfigEstados;
    PRINT 'Estado Material Recibido creado';
END
ELSE PRINT 'Estado Material Recibido ya existe';
GO

-- Limpieza: el estado 'Terminado' se creó en una versión anterior de este script y
-- quedó sin uso (se usa 'Control y Calidad'). Borrarlo solo si ninguna orden lo tiene.
IF EXISTS (SELECT 1 FROM ConfigEstados WHERE Nombre = N'Terminado' AND TipoEstado = 'ESTADOENAREA')
   AND NOT EXISTS (SELECT 1 FROM Ordenes WHERE EstadoenArea = N'Terminado')
BEGIN
    DELETE FROM ConfigEstados WHERE Nombre = N'Terminado' AND TipoEstado = 'ESTADOENAREA';
    PRINT 'Estado Terminado (sin uso) eliminado';
END
GO

-- Conteo de copias en el control de terminaciones, POR ARCHIVO (como el control de
-- lotes): cuántas unidades de cada arte se controlaron (ej. 3 del arte A y 5 del B).
-- No se usa ArchivosOrden.Controlcopias porque ese es el conteo del control de
-- impresión (ECOUV) y ya viene completo.
IF COL_LENGTH('ArchivosOrden', 'ControlTerminacCopias') IS NULL
BEGIN
    ALTER TABLE ArchivosOrden ADD ControlTerminacCopias INT NULL;
    PRINT 'Columna ArchivosOrden.ControlTerminacCopias creada';
END
ELSE PRINT 'Columna ArchivosOrden.ControlTerminacCopias ya existe';
GO

-- Limpieza: Ordenes.ControlCantidad fue el primer intento (conteo global por orden),
-- reemplazado por el conteo por archivo. Borrarla si quedó de una versión anterior.
IF COL_LENGTH('Ordenes', 'ControlCantidad') IS NOT NULL
BEGIN
    ALTER TABLE Ordenes DROP COLUMN ControlCantidad;
    PRINT 'Columna Ordenes.ControlCantidad (sin uso) eliminada';
END
GO

-- Verificación
SELECT EstadoID, Nombre, ColorHex, Orden, TipoEstado FROM ConfigEstados
WHERE Nombre IN (N'Material Recibido', N'En Terminaciones', N'Control y Calidad', N'Terminado');
GO
