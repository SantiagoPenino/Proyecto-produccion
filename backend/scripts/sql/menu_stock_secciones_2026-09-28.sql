-- Stock en cinco páginas del menú (28/09/2026): Panel de Control, Inventario Global, Mi Sector,
-- Compras y Gestión de Sistema, para elegir por rol quién ve cada una.
--
-- Correrlo DESPUÉS de subir el build nuevo: ese build entiende el menú viejo (Stock → /stock, las
-- cinco con pestañas) y el nuevo. El build viejo no entiende las rutas nuevas.
-- Busca el módulo por ruta porque los IdModulo de local y producción no coinciden.
-- Después de correrlo, cada usuario tiene que recargar la página para ver el menú nuevo.

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @Stock INT = (SELECT IdModulo FROM Modulos WHERE LTRIM(RTRIM(Ruta)) = '/stock');
IF @Stock IS NULL THROW 50000, 'No hay un módulo con ruta /stock: el script ya se corrió o el menú es otro.', 1;

-- 1) Stock pasa a ser un grupo sin ruta, como Marketing. Con ruta /stock, quien tuviera el grupo
--    entraría a las cinco secciones (el control de rutas compara por prefijo).
UPDATE Modulos SET Ruta = NULL WHERE IdModulo = @Stock;

-- 2) Las cinco secciones, adentro. El ícono sale del título.
INSERT INTO Modulos (Titulo, Ruta, Icono, IdPadre, IndiceOrden) VALUES
    (N'Panel de Control',   '/stock/panel',      NULL, @Stock, 1),
    (N'Inventario Global',  '/stock/inventario', NULL, @Stock, 2),
    (N'Mi Sector',          '/stock/mi-sector',  NULL, @Stock, 3),
    (N'Compras',            '/stock/compras',    NULL, @Stock, 4),
    (N'Gestión de Sistema', '/stock/sistema',    NULL, @Stock, 5);

-- 3) Quien hoy ve Stock ve las cinco. Después se ajusta por rol desde Roles.
INSERT INTO PermisosRoles (IdRol, IdModulo)
SELECT pr.IdRol, m.IdModulo
FROM PermisosRoles pr
JOIN Modulos m ON m.IdPadre = @Stock
WHERE pr.IdModulo = @Stock;

COMMIT;

-- Resultado: el grupo y sus cinco páginas, con cuántos roles ven cada una
SELECT m.IdModulo, m.Titulo, m.Ruta, m.IdPadre, m.IndiceOrden,
       (SELECT COUNT(*) FROM PermisosRoles pr WHERE pr.IdModulo = m.IdModulo) AS Roles
FROM Modulos m
WHERE m.IdModulo = @Stock OR m.IdPadre = @Stock
ORDER BY m.IdPadre, m.IndiceOrden;
