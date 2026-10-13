-- ─────────────────────────────────────────────────────────────────────────────
-- Ítem de menú del WMS propio (/stock). IDEMPOTENTE — correr en SSMS contra prod.
--
-- Pre-cutover: queda visible SOLO para el rol 1 (admin), igual que en local, para
-- poder verificar la sección en prod sin que el resto la vea. El día del cambio
-- se agregan los permisos de los demás roles (INSERT en PermisosRoles por rol).
--
-- IdModulo es IDENTITY: el id lo asigna la base (no se fuerza el 2102 de local);
-- el permiso lo toma con SELECT por la ruta.
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta = '/stock')
    INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES ('Stock', NULL, '/stock', 'package', 45);

DECLARE @Mod INT = (SELECT TOP 1 IdModulo FROM dbo.Modulos WHERE Ruta = '/stock');
IF NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles WHERE IdRol = 1 AND IdModulo = @Mod)
    INSERT INTO dbo.PermisosRoles (IdRol, IdModulo) VALUES (1, @Mod);

-- Verificación
SELECT m.IdModulo, m.Titulo, m.Ruta, m.IndiceOrden,
       (SELECT COUNT(*) FROM dbo.PermisosRoles pr WHERE pr.IdModulo = m.IdModulo) AS RolesConAcceso
FROM dbo.Modulos m WHERE m.Ruta = '/stock';
