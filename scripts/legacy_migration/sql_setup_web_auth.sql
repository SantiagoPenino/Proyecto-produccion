-- SCRIPT SQL PARA VINCULAR USUARIOS WEB CON CLIENTES
-- Ejecutar en SQL Server Management Studio conectado a la base 'User-Macrosoft'

-- 1. Crear tabla de Usuarios Web (Separada de Usuarios del Sistema)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'WebUsuarios')
BEGIN
    CREATE TABLE WebUsuarios (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        Email NVARCHAR(200) NOT NULL UNIQUE,
        PasswordHash NVARCHAR(MAX) NOT NULL,
        Nombre NVARCHAR(200),
        Empresa NVARCHAR(200),
        Telefono NVARCHAR(50),
        FechaRegistro DATETIME DEFAULT GETDATE(),
        UltimoLogin DATETIME
    );
    PRINT 'Tabla WebUsuarios creada.';
END

-- 2. Asegurar que existe la columna para vincular con la tabla 'Clientes' (Legacy)
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'WebUsuarios' AND COLUMN_NAME = 'CodCliente')
BEGIN
    ALTER TABLE WebUsuarios ADD CodCliente INT NULL;
    PRINT 'Columna CodCliente agregada a WebUsuarios.';
END
ELSE
BEGIN
    PRINT 'Estructura lista.';
END

-- NOTA: El Backend se encarga de:
-- 1. Al registrarse en Web, inserta en WebUsuarios.
-- 2. Busca o crea el cliente en la tabla Clientes.
-- 3. Actualiza WebUsuarios.CodCliente con el ID de la tabla Clientes.
-- 4. Al crear pedido, usa ese CodCliente para insertarlo en la Orden.
