-- =============================================================================
-- SERVICIO TÉCNICO — ETAPA 4 (proyectos e insumos del stock)     28/09/2026
-- Requiere la etapa 1. Se puede correr más de una vez. Ver docs/servicio-tecnico-plan.md
-- Los insumos salen del stock propio (/stock, tablas Wms_*): cada uso descuenta como consumo del
-- depósito elegido (en /stock aparece en el gasto por sector) y acá queda con fecha, costo y a qué
-- solicitud / trabajo / proyecto / máquina fue.
-- =============================================================================
USE SecureAppDB;

IF OBJECT_ID('dbo.ST_Solicitudes') IS NULL
BEGIN
    PRINT 'Falta la etapa 1 (st-etapa1.sql) o esta no es la base del sistema: no se hizo nada.';
    RETURN;
END

SET XACT_ABORT ON;
BEGIN TRAN;

-- ── Proyectos (con historial de avances en ST_Historial) ─────────────────────
IF OBJECT_ID('dbo.ST_Proyectos') IS NULL
BEGIN
    CREATE TABLE dbo.ST_Proyectos (
        ProyId             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_Proyectos PRIMARY KEY,
        Titulo             NVARCHAR(200) NOT NULL,
        Descripcion        NVARCHAR(MAX) NULL,
        ResponsableId      INT           NULL,
        ResponsableNombre  NVARCHAR(150) NULL,
        Estado             VARCHAR(15)   NOT NULL CONSTRAINT DF_ST_Proy_Estado DEFAULT 'PLANIFICADO', -- PLANIFICADO | EN_CURSO | EN_PAUSA | TERMINADO | CANCELADO
        Progreso           TINYINT       NOT NULL CONSTRAINT DF_ST_Proy_Prog DEFAULT 0,
        Prioridad          VARCHAR(10)   NOT NULL CONSTRAINT DF_ST_Proy_Prio DEFAULT 'MEDIA',
        FechaInicio        DATE          NULL,
        FechaEstimadaFin   DATE          NULL,
        FechaFin           DATETIME      NULL,
        EquipoId           INT           NULL,
        EquipoTexto        NVARCHAR(150) NULL,
        CreadoPorId        INT           NULL,
        CreadoPorNombre    NVARCHAR(150) NULL,
        FechaCreacion      DATETIME      NOT NULL CONSTRAINT DF_ST_Proy_FCrea DEFAULT GETDATE(),
        FechaActualizacion DATETIME      NOT NULL CONSTRAINT DF_ST_Proy_FAct DEFAULT GETDATE()
    );
    CREATE INDEX IX_ST_Proy_Estado ON dbo.ST_Proyectos (Estado, FechaActualizacion DESC);
    PRINT 'Creada ST_Proyectos';
END

-- ── Insumos usados (descontados del stock /stock) ────────────────────────────
IF OBJECT_ID('dbo.ST_InsumosUso') IS NULL
BEGIN
    CREATE TABLE dbo.ST_InsumosUso (
        UsoId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_InsumosUso PRIMARY KEY,
        Fecha         DATETIME       NOT NULL CONSTRAINT DF_ST_Uso_Fecha DEFAULT GETDATE(),
        VarId         INT            NOT NULL,      -- Wms_Variantes.VarId
        DepId         INT            NOT NULL,      -- Wms_Depositos.DepId de donde salió
        Nombre        NVARCHAR(300)  NOT NULL,      -- producto · variante, como se llamaba al usarlo
        Unidad        VARCHAR(20)    NULL,
        Cantidad      DECIMAL(18,4)  NOT NULL,
        CostoUnit     DECIMAL(18,4)  NULL,          -- promedio de lo que se descontó
        Moneda        VARCHAR(20)    NULL,
        CostoTotal    DECIMAL(18,2)  NULL,
        Faltante      DECIMAL(18,4)  NULL,          -- lo que no estaba en el depósito (discrepancia en /stock)
        SolId         INT            NULL,
        TrabId        INT            NULL,
        ProyId        INT            NULL,
        EquipoId      INT            NULL,
        Nota          NVARCHAR(500)  NULL,
        UsuarioId     INT            NULL,
        UsuarioNombre NVARCHAR(150)  NULL
    );
    CREATE INDEX IX_ST_Uso_Fecha  ON dbo.ST_InsumosUso (Fecha DESC);
    CREATE INDEX IX_ST_Uso_Equipo ON dbo.ST_InsumosUso (EquipoId, Fecha DESC);
    PRINT 'Creada ST_InsumosUso';
END

COMMIT;

SELECT 'ST_Proyectos' AS Tabla, COUNT(*) AS Filas FROM dbo.ST_Proyectos
UNION ALL SELECT 'ST_InsumosUso', COUNT(*) FROM dbo.ST_InsumosUso;

-- Depósitos del stock: el de Servicio Técnico se crea en /stock → Gestión → Almacenes y sectores
-- (tipo Sector) y después se elige en Servicio Técnico → Insumos.
IF OBJECT_ID('dbo.Wms_Depositos') IS NOT NULL
    SELECT DepId, Nombre, Tipo, Activo FROM dbo.Wms_Depositos ORDER BY DepId;
