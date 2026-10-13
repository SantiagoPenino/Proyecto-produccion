-- Servicio Técnico en ocho páginas del menú (02/10/2026): Solicitudes, Mi semana, Calendario,
-- Máquinas, Planes y procedimientos, Proyectos, Insumos y Reportes. Así se elige por rol quién ve
-- cada una (Roles), como Stock desde el 28/09.
-- · El módulo "Servicio Técnico" (/servicio-tecnico, lo crea st-etapa1.sql) pasa a ser un grupo sin
--   ruta, con las ocho secciones adentro.
-- · Solicitudes: la ven todos los roles que hoy ven Servicio Técnico (ahí cada uno ve sus pedidos).
--   Las otras siete: solo Admin. Después se reparten desde Roles (por ejemplo, al rol de los técnicos).
-- · Lo que se hace adentro (tomar, programar, crear, editar) sigue siendo de los técnicos (área
--   SERVICIO) y Admin: quien vea una sección sin ser técnico la ve sin esos botones.
-- Va DESPUÉS de st-etapa1.sql. Se puede correr antes o después de subir el build: el build nuevo
-- entiende el menú viejo (/servicio-tecnico, con pestañas) y el nuevo. Busca por ruta porque los
-- IdModulo de local y producción no coinciden. Si se corre dos veces, la segunda frena sin tocar nada.
-- Después de correrlo, cada usuario tiene que recargar la página para ver el menú nuevo.

USE SecureAppDB;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRAN;

DECLARE @ST INT = (SELECT IdModulo FROM dbo.Modulos WHERE LTRIM(RTRIM(Ruta)) = '/servicio-tecnico');
IF @ST IS NULL THROW 50000, 'No hay un módulo con ruta /servicio-tecnico: el script ya se corrió, o falta st-etapa1.sql.', 1;

-- 1) Servicio Técnico pasa a ser un grupo sin ruta, como Stock. Con ruta /servicio-tecnico, quien
--    tuviera el grupo entraría a las ocho secciones (el control de rutas compara por prefijo).
UPDATE dbo.Modulos SET Ruta = NULL WHERE IdModulo = @ST;

-- 2) Las ocho secciones, adentro. El ícono sale del título.
INSERT INTO dbo.Modulos (Titulo, Ruta, Icono, IdPadre, IndiceOrden) VALUES
    (N'Solicitudes',             '/servicio-tecnico/solicitudes', NULL, @ST, 1),
    (N'Mi semana',               '/servicio-tecnico/mi-semana',   NULL, @ST, 2),
    (N'Calendario',              '/servicio-tecnico/calendario',  NULL, @ST, 3),
    (N'Máquinas',                '/servicio-tecnico/maquinas',    NULL, @ST, 4),
    (N'Planes y procedimientos', '/servicio-tecnico/planes',      NULL, @ST, 5),
    (N'Proyectos',               '/servicio-tecnico/proyectos',   NULL, @ST, 6),
    (N'Insumos',                 '/servicio-tecnico/insumos',     NULL, @ST, 7),
    (N'Reportes',                '/servicio-tecnico/reportes',    NULL, @ST, 8);

-- 3) Solicitudes: todos los roles que hoy ven Servicio Técnico.
INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT pr.IdRol, m.IdModulo
FROM dbo.PermisosRoles pr
JOIN dbo.Modulos m ON m.IdPadre = @ST AND m.Ruta = '/servicio-tecnico/solicitudes'
WHERE pr.IdModulo = @ST;

-- 4) Las otras siete: solo el rol Admin.
INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT pr.IdRol, m.IdModulo
FROM dbo.PermisosRoles pr
JOIN dbo.Roles r ON r.IdRol = pr.IdRol AND LTRIM(RTRIM(r.NombreRol)) = 'Admin'
JOIN dbo.Modulos m ON m.IdPadre = @ST AND m.Ruta <> '/servicio-tecnico/solicitudes'
WHERE pr.IdModulo = @ST;

COMMIT;

-- Resultado: el grupo y sus ocho páginas, con cuántos roles ven cada una
SELECT m.IdModulo, m.Titulo, m.Ruta, m.IdPadre, m.IndiceOrden,
       (SELECT COUNT(*) FROM dbo.PermisosRoles pr WHERE pr.IdModulo = m.IdModulo) AS Roles
FROM dbo.Modulos m
WHERE m.IdModulo = @ST OR m.IdPadre = @ST
ORDER BY m.IdPadre, m.IndiceOrden;
