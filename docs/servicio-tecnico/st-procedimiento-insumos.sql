-- Insumos necesarios de cada procedimiento de Servicio Técnico (30/09).
-- Cada insumo puede ser un artículo del /stock (VarId) o algo que no está en el stock, escrito a
-- mano (por ejemplo, algo que se compra en la ferretería para un arreglo puntual): VarId vacío.
-- Cantidad opcional. Foto opcional: AdjId apunta a ST_Adjuntos (Entidad 'PROCEDIMIENTO', EntidadId =
-- ProcId), que es donde el módulo guarda todos sus adjuntos.
-- Va DESPUÉS de st-etapa3.sql, que crea ST_Procedimientos. Se puede correr más de una vez.
-- Sin este script los procedimientos funcionan igual; lo que no se puede es cargarles insumos.

USE SecureAppDB;
GO

IF OBJECT_ID('dbo.ST_Procedimientos') IS NULL
    THROW 50001, 'Falta ST_Procedimientos: correr antes docs/servicio-tecnico/st-etapa3.sql.', 1;
GO

IF OBJECT_ID('dbo.ST_ProcedimientoInsumos') IS NULL
BEGIN
    CREATE TABLE dbo.ST_ProcedimientoInsumos (
        PinId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_ProcedimientoInsumos PRIMARY KEY,
        ProcId   INT            NOT NULL,
        Orden    INT            NOT NULL,
        VarId    INT            NULL,          -- Wms_Variantes.VarId; vacío = no está en el stock
        Nombre   NVARCHAR(300)  NOT NULL,      -- lo escrito, o producto · variante del stock al cargarlo
        Unidad   NVARCHAR(30)   NULL,
        Cantidad DECIMAL(18,4)  NULL,          -- cuánto hace falta cada vez; vacío = sin cantidad
        AdjId    INT            NULL           -- foto: ST_Adjuntos.AdjId
    );
    CREATE INDEX IX_ST_ProcIns_Proc ON dbo.ST_ProcedimientoInsumos (ProcId, Orden);
    PRINT 'Creada ST_ProcedimientoInsumos';
END
GO

SELECT COUNT(*) AS Filas FROM dbo.ST_ProcedimientoInsumos;
GO
