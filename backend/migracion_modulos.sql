USE [SecureAppDB];
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- Migración de tabla Modulos desde SecureAppDB_Vieja → SecureAppDB
-- Usa MERGE: actualiza los existentes, inserta los nuevos.
-- NO elimina módulos que ya existan solo en producción.
-- ─────────────────────────────────────────────────────────────────────────────

SET IDENTITY_INSERT [dbo].[Modulos] ON;

MERGE INTO [SecureAppDB].[dbo].[Modulos] AS DEST
USING (
    SELECT IdModulo, Titulo, IdPadre, Ruta, Icono, IndiceOrden
    FROM [SecureAppDB_Vieja].[dbo].[Modulos]
) AS SRC ON DEST.IdModulo = SRC.IdModulo

WHEN MATCHED THEN
    UPDATE SET
        DEST.Titulo       = SRC.Titulo,
        DEST.IdPadre      = SRC.IdPadre,
        DEST.Ruta         = SRC.Ruta,
        DEST.Icono        = SRC.Icono,
        DEST.IndiceOrden  = SRC.IndiceOrden

WHEN NOT MATCHED BY TARGET THEN
    INSERT (IdModulo, Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES (SRC.IdModulo, SRC.Titulo, SRC.IdPadre, SRC.Ruta, SRC.Icono, SRC.IndiceOrden);

SET IDENTITY_INSERT [dbo].[Modulos] OFF;

PRINT 'Migración de Modulos completada: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' fila(s) afectadas.';
GO
