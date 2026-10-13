-- [WMS PROPIO — F3] Ítem de menú de la sección /stock (gestión del stock propio).
-- Correr una vez por base (local para probar; prod en el deploy del cutover).
-- Da permiso automático al rol 1 (admin); el resto de los roles se tildan en /admin/roles.
IF NOT EXISTS (SELECT 1 FROM Modulos WHERE Ruta = '/stock')
BEGIN
    INSERT INTO Modulos (Titulo, Ruta, Icono, IdPadre, IndiceOrden)
    VALUES ('Stock', '/stock', 'package', NULL, 45);

    DECLARE @Mod INT = SCOPE_IDENTITY();
    IF NOT EXISTS (SELECT 1 FROM PermisosRoles WHERE IdRol = 1 AND IdModulo = @Mod)
        INSERT INTO PermisosRoles (IdRol, IdModulo) VALUES (1, @Mod);
END
