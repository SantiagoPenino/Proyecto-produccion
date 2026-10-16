/* ─────────────────────────────────────────────────────────────────────────
   Alta del menú "Configurar Productos" (configurador de productos vendibles)
   Ruta del front: /configurar-productos
   Cuelga del grupo de Configuración/Sys Admin (el padre de /admin/database),
   decisión del 11-ago: "el menú cuelga de Configuración".

   Da permiso a: Admin (1). Más roles: agregarlos a @Roles.
   Es idempotente: si ya existe, no duplica.
   ───────────────────────────────────────────────────────────────────────── */

DECLARE @Ruta   NVARCHAR(255) = '/configurar-productos';
DECLARE @Padre  INT;
DECLARE @IdMod  INT;

-- Padre = el grupo donde vive Admin DB/Configuración (Sys Admin, id 2 hoy),
-- resuelto por ruta para no hardcodear el id.
SELECT @Padre = IdPadre FROM dbo.Modulos WHERE Ruta = '/admin/database';
IF @Padre IS NULL SET @Padre = 2;

SELECT @IdMod = IdModulo FROM dbo.Modulos WHERE Ruta = @Ruta;

IF @IdMod IS NULL
BEGIN
    INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES ('Configurar Productos', @Padre, @Ruta, NULL, 21);

    SET @IdMod = SCOPE_IDENTITY();
END

DECLARE @Roles TABLE (IdRol INT);
INSERT INTO @Roles (IdRol) VALUES (1);   -- Admin

INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT r.IdRol, @IdMod
FROM @Roles r
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.PermisosRoles pr
    WHERE pr.IdRol = r.IdRol AND pr.IdModulo = @IdMod
);

SELECT @IdMod AS IdModuloCreado, @Ruta AS Ruta, @Padre AS IdPadre;
