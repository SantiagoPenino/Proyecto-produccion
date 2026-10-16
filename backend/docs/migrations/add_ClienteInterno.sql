/* ============================================================================
   add_ClienteInterno.sql
   ----------------------------------------------------------------------------
   Agrega dbo.Clientes.ClienteInterno (booleano) para marcar los clientes
   internos de la empresa.

   0 = cliente normal (externo)  -- valor por defecto para TODOS los existentes
   1 = cliente interno

   Se crea NOT NULL con DEFAULT 0 para que no queden NULLs y el código pueda
   leer la bandera sin coalesce.

   Idempotente: se puede correr más de una vez sin efecto.

   Verificación posterior sugerida:
     SELECT ClienteInterno, COUNT(*) AS Cant
     FROM dbo.Clientes WITH(NOLOCK)
     GROUP BY ClienteInterno;
   ============================================================================ */

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Clientes') AND name = 'ClienteInterno'
)
BEGIN
    ALTER TABLE dbo.Clientes
        ADD ClienteInterno BIT NOT NULL
        CONSTRAINT DF_Clientes_ClienteInterno DEFAULT (0);
    PRINT '[OK] dbo.Clientes.ClienteInterno agregada (BIT NOT NULL DEFAULT 0).';
END
ELSE
    PRINT '[SKIP] dbo.Clientes.ClienteInterno ya existe.';
GO

-- Índice filtrado: los internos son una minoría; las consultas que los buscan
-- (o los excluyen) no deben barrer toda la tabla de clientes.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Clientes_ClienteInterno' AND object_id = OBJECT_ID('dbo.Clientes')
)
BEGIN
    CREATE NONCLUSTERED INDEX IX_Clientes_ClienteInterno
        ON dbo.Clientes (ClienteInterno)
        INCLUDE (CliIdCliente)
        WHERE ClienteInterno = 1;
    PRINT '[OK] IX_Clientes_ClienteInterno creado.';
END
ELSE
    PRINT '[SKIP] IX_Clientes_ClienteInterno ya existe.';
GO
