-- Desarrollos en el menú (14/10/2026, docs/desarrollos/plan-integracion.md §4.1).
-- · Grupo "Desarrollos" sin ruta, con una entrada por pantalla (como Servicio Técnico), para elegir
--   por rol quién ve cada una desde Roles.
-- · Admin ve todas. VENTAS ve solo "Pedidos" (lo único que ve un vendedor en el prototipo).
-- · Lo que se hace adentro lo decide el equipo de desarrollo (pantalla Equipo): editor o
--   colaborador. Los Admin son editores sin cargarlos.
-- Las tablas del módulo se crean solas (backend/services/desarrollos/esquema.js); este script solo
-- arma el menú. Busca por ruta porque los IdModulo de local y producción no coinciden. Si se corre
-- dos veces, la segunda frena sin tocar nada. Después, cada usuario tiene que recargar la página.

USE SecureAppDB;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRAN;

IF EXISTS (SELECT 1 FROM dbo.Modulos WHERE LTRIM(RTRIM(Ruta)) LIKE '/desarrollos/%')
    THROW 50000, 'Ya hay entradas /desarrollos/ en el menú: el script ya se corrió.', 1;

DECLARE @Admin INT = (SELECT IdRol FROM dbo.Roles WHERE LTRIM(RTRIM(NombreRol)) = 'Admin');
DECLARE @Ventas INT = (SELECT IdRol FROM dbo.Roles WHERE LTRIM(RTRIM(NombreRol)) = 'VENTAS');
IF @Admin IS NULL THROW 50000, 'No existe el rol Admin.', 1;

-- 1) El grupo, después de Servicio Técnico. El ícono sale del título.
DECLARE @G INT;
INSERT INTO dbo.Modulos (Titulo, Ruta, Icono, IdPadre, IndiceOrden) VALUES (N'Desarrollos', NULL, NULL, NULL, 97);
SET @G = SCOPE_IDENTITY();

-- 2) Las pantallas, en el orden del prototipo
INSERT INTO dbo.Modulos (Titulo, Ruta, Icono, IdPadre, IndiceOrden) VALUES
    (N'Inicio',              '/desarrollos/inicio',       NULL, @G, 1),
    (N'Bandeja',             '/desarrollos/bandeja',      NULL, @G, 2),
    (N'Proyectos',           '/desarrollos/proyectos',    NULL, @G, 3),
    (N'Planificación',       '/desarrollos/planificacion', NULL, @G, 4),
    (N'Tareas',              '/desarrollos/tareas',       NULL, @G, 5),
    (N'Muestras',            '/desarrollos/muestras',     NULL, @G, 6),
    (N'Pedidos',             '/desarrollos/pedidos',      NULL, @G, 7),
    (N'Catálogo técnico',    '/desarrollos/catalogo',     NULL, @G, 8),
    (N'Archivo',             '/desarrollos/archivo',      NULL, @G, 9),
    (N'Reportes',            '/desarrollos/reportes',     NULL, @G, 10),
    (N'Plantillas',          '/desarrollos/plantillas',   NULL, @G, 11),
    (N'Equipo de desarrollo', '/desarrollos/equipo',      NULL, @G, 12);

-- 3) Admin: el grupo y todas las pantallas
INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT @Admin, m.IdModulo FROM dbo.Modulos m WHERE m.IdModulo = @G OR m.IdPadre = @G;

-- 4) VENTAS: el grupo y Pedidos
IF @Ventas IS NOT NULL
    INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
    SELECT @Ventas, m.IdModulo FROM dbo.Modulos m
    WHERE m.IdModulo = @G OR (m.IdPadre = @G AND m.Ruta = '/desarrollos/pedidos');

COMMIT;

-- Resultado: el grupo y sus pantallas, con qué roles ven cada una
SELECT m.IdModulo, m.Titulo, m.Ruta, m.IdPadre, m.IndiceOrden,
       STUFF((SELECT ', ' + LTRIM(RTRIM(r.NombreRol)) FROM dbo.PermisosRoles pr JOIN dbo.Roles r ON r.IdRol = pr.IdRol
              WHERE pr.IdModulo = m.IdModulo FOR XML PATH('')), 1, 2, '') AS Roles
FROM dbo.Modulos m
WHERE m.IdModulo = @G OR m.IdPadre = @G
ORDER BY m.IdPadre, m.IndiceOrden;
