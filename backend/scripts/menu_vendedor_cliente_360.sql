/* ─────────────────────────────────────────────────────────────────────────
   Alta del menú "Vista 360 Cliente" para VENDEDORES  (solo lectura)
   Ruta del front: /vendedores/cliente-360
   Cuelga de "Ventas" (IdModulo 2089).

   Da permiso a: Admin (1), VENTAS (7).
   Si querés sumar más roles, agregalos a la lista @Roles de abajo.

   Es idempotente: si ya existe, no duplica.
   ───────────────────────────────────────────────────────────────────────── */

DECLARE @Ruta   NVARCHAR(255) = '/vendedores/cliente-360';
DECLARE @Padre  INT           = 2089;   -- Ventas
DECLARE @IdMod  INT;

SELECT @IdMod = IdModulo FROM dbo.Modulos WHERE Ruta = @Ruta;

IF @IdMod IS NULL
BEGIN
    INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES ('Vista 360 Cliente', @Padre, @Ruta, NULL, 10);

    SET @IdMod = SCOPE_IDENTITY();
END

-- Permisos por rol
DECLARE @Roles TABLE (IdRol INT);
INSERT INTO @Roles (IdRol) VALUES (1), (7);   -- Admin, VENTAS

INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT r.IdRol, @IdMod
FROM @Roles r
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.PermisosRoles pr
    WHERE pr.IdRol = r.IdRol AND pr.IdModulo = @IdMod
);

SELECT @IdMod AS IdModuloCreado, @Ruta AS Ruta;
