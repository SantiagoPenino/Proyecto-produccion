-- Marketing › Piezas (15/10/2026): el compositor de piezas para redes, /marketing/piezas.
-- · Va dentro del grupo Marketing, después de Precios y Productos.
-- · La ven los mismos roles que hoy ven Marketing › Precios. Después se reparte desde Roles.
-- Busca por ruta porque los IdModulo de local y producción no coinciden. Si se corre dos veces,
-- la segunda frena sin tocar nada. Después de correrlo, cada usuario tiene que recargar la página.

USE SecureAppDB;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRAN;

IF EXISTS (SELECT 1 FROM dbo.Modulos WHERE LTRIM(RTRIM(Ruta)) = '/marketing/piezas')
    THROW 50000, 'Ya hay un módulo con ruta /marketing/piezas: el script ya se corrió.', 1;

DECLARE @Precios INT = (SELECT TOP 1 IdModulo FROM dbo.Modulos WHERE LTRIM(RTRIM(Ruta)) = '/marketing/precios');
IF @Precios IS NULL THROW 50000, 'No hay un módulo con ruta /marketing/precios: falta el menú de Marketing.', 1;
DECLARE @Marketing INT = (SELECT IdPadre FROM dbo.Modulos WHERE IdModulo = @Precios);

INSERT INTO dbo.Modulos (Titulo, Ruta, Icono, IdPadre, IndiceOrden)
VALUES (N'Piezas', '/marketing/piezas', NULL,
        @Marketing, (SELECT ISNULL(MAX(IndiceOrden), 0) + 1 FROM dbo.Modulos WHERE IdPadre = @Marketing));
DECLARE @Piezas INT = SCOPE_IDENTITY();

INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT pr.IdRol, @Piezas
FROM dbo.PermisosRoles pr
WHERE pr.IdModulo = @Precios;

COMMIT;

-- Resultado: el grupo Marketing con sus páginas y cuántos roles ven cada una
SELECT m.IdModulo, m.Titulo, m.Ruta, m.IdPadre, m.IndiceOrden,
       (SELECT COUNT(*) FROM dbo.PermisosRoles pr WHERE pr.IdModulo = m.IdModulo) AS Roles
FROM dbo.Modulos m
WHERE m.IdModulo = (SELECT IdPadre FROM dbo.Modulos WHERE LTRIM(RTRIM(Ruta)) = '/marketing/piezas')
   OR m.IdPadre = (SELECT IdPadre FROM dbo.Modulos WHERE LTRIM(RTRIM(Ruta)) = '/marketing/piezas')
ORDER BY m.IdPadre, m.IndiceOrden;
