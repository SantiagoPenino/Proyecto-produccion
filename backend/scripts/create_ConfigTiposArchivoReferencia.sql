-- =====================================================================
-- Catálogo de TIPOS DE ARCHIVO DE REFERENCIA (selector en el detalle de
-- orden PRO — Producción/prendas). Consumido por GET /api/orders/referencia-tipos.
-- Si la tabla no existe, el endpoint cae a un fallback fijo (no rompe),
-- pero los tipos solo se pueden administrar con la tabla creada.
-- Idempotente: se puede correr más de una vez.
-- =====================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ConfigTiposArchivoReferencia')
BEGIN
    CREATE TABLE dbo.ConfigTiposArchivoReferencia (
        TipoID  INT IDENTITY(1,1) PRIMARY KEY,
        Codigo  VARCHAR(50)  NOT NULL UNIQUE,   -- se guarda en ArchivosReferencia.TipoArchivo
        Nombre  NVARCHAR(100) NOT NULL,         -- etiqueta visible en el selector
        Activo  BIT NOT NULL DEFAULT 1,
        Orden   INT NOT NULL DEFAULT 0
    );
END;

-- Seed con los tipos ya usados en ArchivosReferencia (no duplica si ya están)
MERGE dbo.ConfigTiposArchivoReferencia AS t
USING (VALUES
    ('BOCETO',         N'Boceto',                 1),
    ('BOCETO_BORDADO', N'Boceto de Bordado',      2),
    ('BOCETO_CORTE',   N'Boceto de Corte',        3),
    ('INFO_CORTE',     N'Información de Corte',   4),
    ('MATRIZ_LOGOS',   N'Matriz de Logos',        5),
    ('REFERENCIA',     N'Referencia General',     6)
) AS s (Codigo, Nombre, Orden)
ON t.Codigo = s.Codigo
WHEN NOT MATCHED THEN
    INSERT (Codigo, Nombre, Activo, Orden) VALUES (s.Codigo, s.Nombre, 1, s.Orden);

SELECT * FROM dbo.ConfigTiposArchivoReferencia ORDER BY Orden;
