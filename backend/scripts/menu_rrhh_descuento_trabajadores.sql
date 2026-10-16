/* ─────────────────────────────────────────────────────────────────────────
   Menú "Recursos Humanos" → "Descuento Trabajadores"
   Ruta del front: /rrhh/descuento-trabajadores  → src/components/pages/rrhh/DescuentoTrabajadoresPage.jsx
   API           : /api/rrhh/descuento-trabajadores (backend/controllers/rrhhController.js)

   1. Crea el grupo "Recursos Humanos" (raíz, sin ruta, como Servicio Técnico) y la opción
      "Descuento Trabajadores" colgando de él.
   2. Da permiso a Admin (1) y Administracion (8) sobre los DOS: el árbol del menú
      (MainAppContent.jsx) descarta un hijo si el padre no está en los permisos del rol.
      Para sumar roles, agregalos a @Roles. El backend también exige que el rol tenga esta
      ruta en el menú (Admin siempre entra).
   3. Guarda en ConfiguracionGlobal el ID del perfil de precios "Descuento Trabajadores 10%"
      (clave RRHH_PERFIL_DESCUENTO_TRABAJADORES), buscándolo por nombre: los ID de local y
      producción no coinciden. Si la clave ya tiene un perfil activo, no se toca.
   4. Crea la tabla TrabajadoresClientes: vínculo a mano entre un trabajador de la planilla
      (Trabajadores.Cedula) y su cuenta de cliente (Clientes.CliIdCliente), para cuando la cuenta
      no tiene su cédula en CI/RUT (o tiene otro documento, como el RUT de su empresa).

   Idempotente: se puede correr más de una vez sin duplicar nada. Si ya lo corriste antes de
   que existiera el punto 4, correlo de nuevo: solo agrega la tabla.
   ───────────────────────────────────────────────────────────────────────── */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @TituloPadre NVARCHAR(100) = N'Recursos Humanos';
DECLARE @TituloHijo  NVARCHAR(100) = N'Descuento Trabajadores';
DECLARE @Ruta        NVARCHAR(200) = N'/rrhh/descuento-trabajadores';
DECLARE @IdPadre INT, @IdHijo INT;

-- 1a. Grupo raíz
SELECT TOP 1 @IdPadre = IdModulo FROM dbo.Modulos WHERE Titulo = @TituloPadre AND IdPadre IS NULL;
IF @IdPadre IS NULL
BEGIN
    INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES (@TituloPadre, NULL, NULL, 'fa-solid fa-people-group', 95);
    SET @IdPadre = SCOPE_IDENTITY();
    PRINT CONCAT('Grupo creado: ', @IdPadre);
END
ELSE PRINT CONCAT('Grupo ya existía: ', @IdPadre);

-- 1b. Opción
SELECT TOP 1 @IdHijo = IdModulo FROM dbo.Modulos WHERE LTRIM(RTRIM(Ruta)) = @Ruta;
IF @IdHijo IS NULL
BEGIN
    INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES (@TituloHijo, @IdPadre, @Ruta, 'fa-solid fa-percent', 1);
    SET @IdHijo = SCOPE_IDENTITY();
    PRINT CONCAT('Opción creada: ', @IdHijo);
END
ELSE
BEGIN
    UPDATE dbo.Modulos SET IdPadre = @IdPadre WHERE IdModulo = @IdHijo AND ISNULL(IdPadre, -1) <> @IdPadre;
    PRINT CONCAT('Opción ya existía: ', @IdHijo);
END

-- 2. Permisos
DECLARE @Roles TABLE (IdRol INT);
INSERT INTO @Roles (IdRol) VALUES (1), (8);   -- Admin, Administracion

INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT r.IdRol, m.IdModulo
FROM @Roles r CROSS JOIN (VALUES (@IdPadre), (@IdHijo)) m(IdModulo)
WHERE NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles p WHERE p.IdRol = r.IdRol AND p.IdModulo = m.IdModulo);
PRINT CONCAT('Permisos agregados: ', @@ROWCOUNT);

-- 3. Perfil de precios de trabajadores
DECLARE @Clave VARCHAR(100) = 'RRHH_PERFIL_DESCUENTO_TRABAJADORES';
DECLARE @IdPerfil INT = (
    SELECT TOP 1 ID FROM dbo.PerfilesPrecios
    WHERE Activo = 1 AND LTRIM(Nombre) LIKE 'Descuento Trabajadores%'
    ORDER BY ID);

IF EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal cg
           JOIN dbo.PerfilesPrecios pp ON pp.ID = TRY_CAST(cg.Valor AS INT) AND pp.Activo = 1
           WHERE cg.Clave = @Clave)
    PRINT 'La clave del perfil ya apunta a un perfil activo: no se toca.';
ELSE IF @IdPerfil IS NULL
    PRINT 'ATENCIÓN: no hay un perfil activo llamado "Descuento Trabajadores...". La pantalla lo va a avisar; cargá la clave a mano con el ID correcto.';
ELSE IF EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = @Clave)
BEGIN
    UPDATE dbo.ConfiguracionGlobal SET Valor = CAST(@IdPerfil AS NVARCHAR(20)) WHERE Clave = @Clave;
    PRINT CONCAT('Clave del perfil actualizada: ', @IdPerfil);
END
ELSE
BEGIN
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES (@Clave, 'ADMIN', CAST(@IdPerfil AS NVARCHAR(20)));
    PRINT CONCAT('Clave del perfil creada: ', @IdPerfil);
END

-- 4. Vínculos trabajador ↔ cuenta de cliente
IF OBJECT_ID('dbo.TrabajadoresClientes') IS NULL
BEGIN
    CREATE TABLE dbo.TrabajadoresClientes (
        Cedula       INT      NOT NULL,   -- Trabajadores.Cedula
        CliIdCliente INT      NOT NULL,   -- Clientes.CliIdCliente
        FechaAlta    DATETIME NOT NULL CONSTRAINT DF_TrabajadoresClientes_FechaAlta DEFAULT GETDATE(),
        IdUsuario    INT      NULL,       -- quién lo vinculó
        CONSTRAINT PK_TrabajadoresClientes PRIMARY KEY (Cedula, CliIdCliente),
        INDEX IX_TrabajadoresClientes_Cliente NONCLUSTERED (CliIdCliente)
    );
    PRINT 'Tabla TrabajadoresClientes creada.';
END
ELSE PRINT 'Tabla TrabajadoresClientes ya existía.';

COMMIT TRANSACTION;

-- Verificación
SELECT m.IdModulo, m.Titulo, m.IdPadre, m.Ruta, m.IndiceOrden,
       STRING_AGG(CAST(p.IdRol AS VARCHAR(10)), ',') AS Roles
FROM dbo.Modulos m
LEFT JOIN dbo.PermisosRoles p ON p.IdModulo = m.IdModulo
WHERE m.IdModulo IN (@IdPadre, @IdHijo)
GROUP BY m.IdModulo, m.Titulo, m.IdPadre, m.Ruta, m.IndiceOrden;

SELECT cg.Clave, cg.Valor, pp.Nombre AS Perfil, pp.Activo
FROM dbo.ConfiguracionGlobal cg
LEFT JOIN dbo.PerfilesPrecios pp ON pp.ID = TRY_CAST(cg.Valor AS INT)
WHERE cg.Clave = @Clave;
