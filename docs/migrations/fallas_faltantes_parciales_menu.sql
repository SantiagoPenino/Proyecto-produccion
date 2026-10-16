/* =====================================================================
   FALLAS, FALTANTES Y ENTREGAS PARCIALES — Menú: "Solicitudes de insumo" (Spec 39, fase 5)
   ---------------------------------------------------------------------
   Agrega al menú de Atención al Cliente (IdPadre 29) la bandeja de solicitudes de insumo
   del cliente y le da permiso a Admin (1), Administracion (8), Coordinador (11) y
   Atención al Cliente (12). Idempotente.
   El árbol del menú descarta un hijo si el padre no está en los permisos del rol: por eso
   también se asegura el permiso sobre el padre 29.
   ===================================================================== */
SET NOCOUNT ON;
DECLARE @Ruta VARCHAR(200) = '/atencion-cliente/solicitudes-insumo';
DECLARE @IdModulo INT = (SELECT TOP 1 IdModulo FROM dbo.Modulos WHERE Ruta = @Ruta);
IF @IdModulo IS NULL
BEGIN
    INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES ('Solicitudes de insumo', 29, @Ruta, 'fa-solid fa-scissors', 36);
    SET @IdModulo = SCOPE_IDENTITY();
    PRINT CONCAT('Módulo creado: ', @IdModulo);
END
ELSE PRINT CONCAT('Módulo ya existía: ', @IdModulo);

DECLARE @roles TABLE (IdRol INT);
INSERT INTO @roles VALUES (1), (8), (11), (12);
INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT r.IdRol, m.IdModulo FROM @roles r CROSS JOIN (VALUES (@IdModulo), (29)) m(IdModulo)
WHERE NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles p WHERE p.IdRol = r.IdRol AND p.IdModulo = m.IdModulo);
PRINT CONCAT('Permisos agregados: ', @@ROWCOUNT);

SELECT m.IdModulo, m.Titulo, m.Ruta, m.IdPadre, STRING_AGG(CAST(p.IdRol AS VARCHAR), ',') AS Roles
FROM dbo.Modulos m LEFT JOIN dbo.PermisosRoles p ON p.IdModulo = m.IdModulo
WHERE m.Ruta = @Ruta GROUP BY m.IdModulo, m.Titulo, m.Ruta, m.IdPadre;
