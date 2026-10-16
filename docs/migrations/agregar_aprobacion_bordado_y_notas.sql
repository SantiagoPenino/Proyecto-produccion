-- [BORDADO] Checklist: agrega el 3er requisito bloqueante "Aprobación del Cliente"
-- (además de PRENDA y MATRIZ que ya existían) — para registrar cuándo y por qué vía
-- aprobó el cliente el bordado (queda en OrdenCumplimientoRequisitos.Observaciones +
-- FechaCumplimiento, mismo mecanismo que PRENDA/MATRIZ).
IF NOT EXISTS (SELECT 1 FROM ConfigRequisitosProduccion WHERE AreaID='EMB' AND CodigoRequisito='APROBACION')
BEGIN
    INSERT INTO ConfigRequisitosProduccion (AreaID, CodigoRequisito, Descripcion, EsBloqueante)
    VALUES ('EMB', 'APROBACION', 'Aprobación del Cliente', 1);
END

-- Notas de producción por orden — ADITIVAS (nunca se pisan, cada nota es una fila
-- nueva), a diferencia de Ordenes.Nota que es un solo campo que se sobreescribe.
-- Equivalente a la hoja "NOTAS" del Apps Script viejo de Bordado.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'OrdenNotasProduccion')
BEGIN
    CREATE TABLE dbo.OrdenNotasProduccion (
        NotaID INT IDENTITY(1,1) PRIMARY KEY,
        OrdenID INT NOT NULL,
        Texto NVARCHAR(MAX) NOT NULL,
        UsuarioID INT NULL,
        UsuarioNombre NVARCHAR(100) NULL,
        FechaCreacion DATETIME NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX IX_OrdenNotasProduccion_OrdenID ON dbo.OrdenNotasProduccion(OrdenID);
END

SELECT RequisitoID, AreaID, CodigoRequisito, Descripcion, EsBloqueante FROM ConfigRequisitosProduccion WHERE AreaID='EMB';
