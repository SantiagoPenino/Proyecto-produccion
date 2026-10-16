/* ─────────────────────────────────────────────────────────────────────────
   Alta del menú "Planificación" (agenda de capacidad por área)
   Ruta del front: /produccion/planificacion
   Cuelga de "Producción" (IdModulo 3).

   Da permiso a: Admin (1), User (2), DTF (3), Administracion (8),
   Coordinador (11), Atención al Cliente (12) — mismo criterio que
   "Dashboard Producción" (IdModulo 2084).

   Es idempotente: si ya existe, no duplica.
   ───────────────────────────────────────────────────────────────────────── */

DECLARE @Ruta   NVARCHAR(255) = '/produccion/planificacion';
DECLARE @Padre  INT           = 3;   -- Producción
DECLARE @IdMod  INT;

SELECT @IdMod = IdModulo FROM dbo.Modulos WHERE Ruta = @Ruta;

IF @IdMod IS NULL
BEGIN
    INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES ('Planificación', @Padre, @Ruta, NULL, 50);

    SET @IdMod = SCOPE_IDENTITY();
END

-- Permisos por rol
DECLARE @Roles TABLE (IdRol INT);
INSERT INTO @Roles (IdRol) VALUES (1), (2), (3), (8), (11), (12);

INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT r.IdRol, @IdMod
FROM @Roles r
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.PermisosRoles pr
    WHERE pr.IdRol = r.IdRol AND pr.IdModulo = @IdMod
);

SELECT @IdMod AS IdModuloCreado, @Ruta AS Ruta;
