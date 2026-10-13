-- =============================================================================
-- SERVICIO TÉCNICO — ETAPA 3 (mantenimientos)                    28/09/2026
-- Procedimientos (pasos con tiempo estimado), planes periódicos y trabajos del calendario
-- (mantenimientos y tareas, con su lista de tareas). Requiere la etapa 1. Se puede correr más
-- de una vez. Ver docs/servicio-tecnico-plan.md
-- =============================================================================
USE SecureAppDB;

IF OBJECT_ID('dbo.ST_Solicitudes') IS NULL
BEGIN
    PRINT 'Falta la etapa 1 (st-etapa1.sql) o esta no es la base del sistema: no se hizo nada.';
    RETURN;
END

SET XACT_ABORT ON;
BEGIN TRAN;

-- ── Procedimientos: cómo se hace un trabajo, paso a paso ─────────────────────
IF OBJECT_ID('dbo.ST_Procedimientos') IS NULL
BEGIN
    CREATE TABLE dbo.ST_Procedimientos (
        ProcId               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_Procedimientos PRIMARY KEY,
        Titulo               NVARCHAR(200) NOT NULL,
        Descripcion          NVARCHAR(MAX) NULL,
        AreaId               VARCHAR(20)   NULL,      -- para qué área (opcional)
        EquipoId             INT           NULL,      -- o para qué máquina (opcional)
        Activo               BIT           NOT NULL CONSTRAINT DF_ST_Proc_Activo DEFAULT 1,
        CreadoPorId          INT           NULL,
        CreadoPorNombre      NVARCHAR(150) NULL,
        FechaCreacion        DATETIME      NOT NULL CONSTRAINT DF_ST_Proc_FCrea DEFAULT GETDATE(),
        ActualizadoPorNombre NVARCHAR(150) NULL,
        FechaActualizacion   DATETIME      NOT NULL CONSTRAINT DF_ST_Proc_FAct DEFAULT GETDATE()
    );
    PRINT 'Creada ST_Procedimientos';
END

IF OBJECT_ID('dbo.ST_ProcedimientoPasos') IS NULL
BEGIN
    CREATE TABLE dbo.ST_ProcedimientoPasos (
        PasoId           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_ProcedimientoPasos PRIMARY KEY,
        ProcId           INT           NOT NULL,
        Orden            INT           NOT NULL,
        Texto            NVARCHAR(500) NOT NULL,
        Detalle          NVARCHAR(MAX) NULL,
        MinutosEstimados INT           NOT NULL CONSTRAINT DF_ST_Paso_Min DEFAULT 0
    );
    CREATE INDEX IX_ST_Paso_Proc ON dbo.ST_ProcedimientoPasos (ProcId, Orden);
    PRINT 'Creada ST_ProcedimientoPasos';
END

-- ── Planes: mantenimientos que se repiten ────────────────────────────────────
IF OBJECT_ID('dbo.ST_Planes') IS NULL
BEGIN
    CREATE TABLE dbo.ST_Planes (
        PlanId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_Planes PRIMARY KEY,
        Titulo          NVARCHAR(200) NOT NULL,
        Descripcion     NVARCHAR(MAX) NULL,
        EquipoId        INT           NULL,           -- máquina (o NULL: equipo/lugar en texto)
        EquipoTexto     NVARCHAR(150) NULL,
        ProcId          INT           NULL,
        CadaValor       INT           NOT NULL,       -- cada N ...
        CadaUnidad      VARCHAR(10)   NOT NULL,       -- DIA | SEMANA | MES
        TecnicoId       INT           NULL,
        TecnicoNombre   NVARCHAR(150) NULL,
        ProximaFecha    DATE          NOT NULL,
        ParaMaquina     BIT           NOT NULL CONSTRAINT DF_ST_Plan_Para DEFAULT 0, -- hay que parar la máquina
        Activo          BIT           NOT NULL CONSTRAINT DF_ST_Plan_Activo DEFAULT 1,
        CreadoPorId     INT           NULL,
        CreadoPorNombre NVARCHAR(150) NULL,
        FechaCreacion   DATETIME      NOT NULL CONSTRAINT DF_ST_Plan_FCrea DEFAULT GETDATE()
    );
    PRINT 'Creada ST_Planes';
END

-- ── Trabajos del calendario: mantenimientos (de un plan o sueltos) y tareas puntuales ──
IF OBJECT_ID('dbo.ST_Trabajos') IS NULL
BEGIN
    CREATE TABLE dbo.ST_Trabajos (
        TrabId             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_Trabajos PRIMARY KEY,
        Tipo               VARCHAR(15)   NOT NULL,    -- MANTENIMIENTO | TAREA
        PlanId             INT           NULL,
        ProcId             INT           NULL,
        EquipoId           INT           NULL,
        EquipoTexto        NVARCHAR(150) NULL,
        Titulo             NVARCHAR(200) NOT NULL,
        Descripcion        NVARCHAR(MAX) NULL,
        FechaProgramada    DATE          NOT NULL,
        FechaOriginal      DATE          NOT NULL,    -- la de antes de posponer
        TecnicoId          INT           NULL,
        TecnicoNombre      NVARCHAR(150) NULL,
        Estado             VARCHAR(15)   NOT NULL CONSTRAINT DF_ST_Trab_Estado DEFAULT 'PENDIENTE', -- PENDIENTE | EN_CURSO | REALIZADO | NO_REALIZADO | CANCELADO
        VecesPospuesto     INT           NOT NULL CONSTRAINT DF_ST_Trab_Posp DEFAULT 0,
        MinutosEstimados   INT           NOT NULL CONSTRAINT DF_ST_Trab_MinEst DEFAULT 0,
        MinutosReales      INT           NULL,
        FechaInicio        DATETIME      NULL,
        FechaFin           DATETIME      NULL,
        Observaciones      NVARCHAR(MAX) NULL,
        Motivo             NVARCHAR(500) NULL,        -- por qué no se realizó / se canceló
        ParaMaquina        BIT           NOT NULL CONSTRAINT DF_ST_Trab_Para DEFAULT 0,
        EstadoEquipoPrevio NVARCHAR(100) NULL,
        CreadoPorId        INT           NULL,
        CreadoPorNombre    NVARCHAR(150) NULL,
        FechaCreacion      DATETIME      NOT NULL CONSTRAINT DF_ST_Trab_FCrea DEFAULT GETDATE(),
        FechaActualizacion DATETIME      NOT NULL CONSTRAINT DF_ST_Trab_FAct DEFAULT GETDATE()
    );
    CREATE INDEX IX_ST_Trab_Fecha ON dbo.ST_Trabajos (FechaProgramada, Estado);
    CREATE INDEX IX_ST_Trab_Plan  ON dbo.ST_Trabajos (PlanId, Estado);
    CREATE INDEX IX_ST_Trab_Tec   ON dbo.ST_Trabajos (TecnicoId, Estado, FechaProgramada);
    PRINT 'Creada ST_Trabajos';
END

IF OBJECT_ID('dbo.ST_TrabajoTareas') IS NULL
BEGIN
    CREATE TABLE dbo.ST_TrabajoTareas (
        TareaId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_TrabajoTareas PRIMARY KEY,
        TrabId           INT           NOT NULL,
        Orden            INT           NOT NULL,
        Texto            NVARCHAR(500) NOT NULL,
        Detalle          NVARCHAR(MAX) NULL,
        MinutosEstimados INT           NOT NULL CONSTRAINT DF_ST_TT_Min DEFAULT 0,
        Hecha            BIT           NOT NULL CONSTRAINT DF_ST_TT_Hecha DEFAULT 0,
        HechaPorId       INT           NULL,
        HechaPorNombre   NVARCHAR(150) NULL,
        FechaHecha       DATETIME      NULL,
        Nota             NVARCHAR(500) NULL
    );
    CREATE INDEX IX_ST_TT_Trab ON dbo.ST_TrabajoTareas (TrabId, Orden);
    PRINT 'Creada ST_TrabajoTareas';
END

-- ── Seguimiento de solicitudes: marcar cuándo se hizo (el calendario muestra los que faltan) ──
IF COL_LENGTH('dbo.ST_Solicitudes', 'SeguimientoHechoFecha') IS NULL
BEGIN
    ALTER TABLE dbo.ST_Solicitudes ADD
        SeguimientoHechoFecha DATETIME      NULL,
        SeguimientoHechoPor   NVARCHAR(150) NULL,
        SeguimientoResultado  NVARCHAR(500) NULL;
    PRINT 'ST_Solicitudes: columnas de seguimiento hecho';
END

COMMIT;

SELECT 'ST_Procedimientos' AS Tabla, COUNT(*) AS Filas FROM dbo.ST_Procedimientos
UNION ALL SELECT 'ST_Planes', COUNT(*) FROM dbo.ST_Planes
UNION ALL SELECT 'ST_Trabajos', COUNT(*) FROM dbo.ST_Trabajos;
