// ─────────────────────────────────────────────────────────────────────────────
// DESARROLLOS — tablas del módulo (docs/desarrollos/plan-integracion.md §4.3).
//
// Se crean solas la primera vez que se usa el módulo (o al correr el importador), como
// TiendaConfecciones: así existen en cualquier base sin depender de un script a mano. Después carga
// lo de fábrica (fabrica.js) en las tablas vacías: tipos de desarrollo, plantillas, estados y tildes
// de muestras y la configuración de la planificación.
//
// Convenciones:
// · Personas por IdUsuario. El "…Texto" de al lado guarda el nombre cuando no es un usuario (datos
//   viejos del prototipo: "Lista de WhatsApp", "Claude").
// · Nada se borra de verdad: proyectos, pedidos, muestras, variantes y adjuntos se marcan Borrado.
// · Sin FK a tablas de otros módulos (Usuarios, Articulos, Clientes, Ordenes): son viejas y no todas
//   tienen clave. Entre tablas Des sí, sin cascadas (se borra a mano en el orden correcto).
// · IdOrigen = id del documento en el prototipo (para rastrear lo importado).
// · Fechas: DATE para "un día" y DATETIME2 (GETDATE(), UTC en prod) para "un momento".
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../../config/db');
const fabrica = require('./fabrica');

const DDL = `
IF OBJECT_ID('dbo.DesEquipo', 'U') IS NULL
CREATE TABLE dbo.DesEquipo (
    UsuarioID   INT          NOT NULL CONSTRAINT PK_DesEquipo PRIMARY KEY,
    Nivel       VARCHAR(12)  NOT NULL CONSTRAINT CK_DesEquipo_Nivel CHECK (Nivel IN ('EDITOR', 'COLABORADOR')),
    Lineas      VARCHAR(100) NULL,            -- AreaID separados por coma (SB,DIRECTA,ECOUV)
    Activo      BIT          NOT NULL CONSTRAINT DF_DesEquipo_Activo DEFAULT 1,
    FechaAlta   DATETIME2    NOT NULL CONSTRAINT DF_DesEquipo_Alta DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.DesTiposDesarrollo', 'U') IS NULL
CREATE TABLE dbo.DesTiposDesarrollo (
    TipoID      INT IDENTITY(1,1) CONSTRAINT PK_DesTiposDesarrollo PRIMARY KEY,
    Clave       VARCHAR(40)  NOT NULL CONSTRAINT UQ_DesTiposDesarrollo_Clave UNIQUE,
    Nombre      NVARCHAR(60) NOT NULL,
    EsProducto  BIT          NOT NULL CONSTRAINT DF_DesTipos_EsProducto DEFAULT 0,
    Orden       INT          NOT NULL CONSTRAINT DF_DesTipos_Orden DEFAULT 0,
    Activo      BIT          NOT NULL CONSTRAINT DF_DesTipos_Activo DEFAULT 1
);

IF OBJECT_ID('dbo.DesPlantillas', 'U') IS NULL
CREATE TABLE dbo.DesPlantillas (
    PlantillaID INT IDENTITY(1,1) CONSTRAINT PK_DesPlantillas PRIMARY KEY,
    Clave       VARCHAR(40)   NULL,           -- las de fábrica: prenda, correccion, variante…
    Nombre      NVARCHAR(60)  NOT NULL,
    Para        VARCHAR(12)   NOT NULL CONSTRAINT CK_DesPlantillas_Para CHECK (Para IN ('PRODUCTO', 'CORRECCION', 'VARIANTE')),
    TipoID      INT           NULL CONSTRAINT FK_DesPlantillas_Tipo REFERENCES dbo.DesTiposDesarrollo (TipoID),
    Descripcion NVARCHAR(200) NULL,
    Fija        BIT           NOT NULL CONSTRAINT DF_DesPlantillas_Fija DEFAULT 0,
    Orden       INT           NOT NULL CONSTRAINT DF_DesPlantillas_Orden DEFAULT 0,
    Activo      BIT           NOT NULL CONSTRAINT DF_DesPlantillas_Activo DEFAULT 1,
    FechaAlta   DATETIME2     NOT NULL CONSTRAINT DF_DesPlantillas_Alta DEFAULT GETDATE(),
    FechaActualizado DATETIME2 NOT NULL CONSTRAINT DF_DesPlantillas_Act DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_DesPlantillas_Clave' AND object_id = OBJECT_ID('dbo.DesPlantillas'))
    CREATE UNIQUE INDEX UQ_DesPlantillas_Clave ON dbo.DesPlantillas (Clave) WHERE Clave IS NOT NULL;

IF OBJECT_ID('dbo.DesPlantillaEtapas', 'U') IS NULL
CREATE TABLE dbo.DesPlantillaEtapas (
    EtapaID     INT IDENTITY(1,1) CONSTRAINT PK_DesPlantillaEtapas PRIMARY KEY,
    PlantillaID INT          NOT NULL CONSTRAINT FK_DesPlantillaEtapas_Plantilla REFERENCES dbo.DesPlantillas (PlantillaID),
    Clave       VARCHAR(40)  NULL,            -- definicion, desarrollo… en las cinco de siempre; NULL en las propias
    Nombre      NVARCHAR(40) NOT NULL,
    Color       VARCHAR(7)   NOT NULL,
    Orden       INT          NOT NULL
);

IF OBJECT_ID('dbo.DesPlantillaTareas', 'U') IS NULL
CREATE TABLE dbo.DesPlantillaTareas (
    PlantillaTareaID INT IDENTITY(1,1) CONSTRAINT PK_DesPlantillaTareas PRIMARY KEY,
    PlantillaID INT           NOT NULL CONSTRAINT FK_DesPlantillaTareas_Plantilla REFERENCES dbo.DesPlantillas (PlantillaID),
    EtapaID     INT           NOT NULL CONSTRAINT FK_DesPlantillaTareas_Etapa REFERENCES dbo.DesPlantillaEtapas (EtapaID),
    Nombre      NVARCHAR(120) NOT NULL,
    DiasHabiles INT           NOT NULL CONSTRAINT DF_DesPlantillaTareas_Dias DEFAULT 1,
    Entregable  NVARCHAR(80)  NULL,
    PideRef     BIT           NOT NULL CONSTRAINT DF_DesPlantillaTareas_Ref DEFAULT 0,
    MarcaErp    BIT           NOT NULL CONSTRAINT DF_DesPlantillaTareas_Erp DEFAULT 0,
    Orden       INT           NOT NULL
);

IF OBJECT_ID('dbo.DesProyectos', 'U') IS NULL
CREATE TABLE dbo.DesProyectos (
    ProyectoID     INT IDENTITY(1,1) CONSTRAINT PK_DesProyectos PRIMARY KEY,
    Codigo         VARCHAR(20)   NOT NULL,    -- PD-53, CO-01 (y los viejos PS-NN)
    Nombre         NVARCHAR(120) NOT NULL,
    Tipo           VARCHAR(12)   NOT NULL CONSTRAINT CK_DesProyectos_Tipo CHECK (Tipo IN ('NUEVO', 'CORRECCION')),
    TipoOrigen     VARCHAR(20)   NULL,        -- tipo del pedido de origen, 'equipo', 'catalogo'
    Origen         VARCHAR(20)   NULL,        -- solicitud, manual, erp, sistema, lista
    TipoID         INT           NOT NULL CONSTRAINT FK_DesProyectos_Tipo REFERENCES dbo.DesTiposDesarrollo (TipoID),
    PlantillaID    INT           NULL,
    PlantillaNombre NVARCHAR(60) NULL,
    Estado         VARCHAR(10)   NOT NULL CONSTRAINT CK_DesProyectos_Estado CHECK (Estado IN ('ACTIVO', 'PAUSADO', 'CANCELADO')),
    LiderUsuarioID INT           NULL,
    LiderTexto     NVARCHAR(120) NULL,
    LineaAreaID    VARCHAR(20)   NULL,
    FechaInicio    DATE          NULL,
    FechaLimite    DATE          NULL,
    ProIdProducto  INT           NULL,        -- artículo del maestro (Articulos)
    RefErpTexto    NVARCHAR(40)  NULL,        -- REF viejo que no está en el maestro
    Familia        NVARCHAR(60)  NULL,        -- solo si no tiene artículo (si no, sale del artículo)
    EtiquetaID     INT           NULL,        -- ProductoEtiqueta
    Notas          NVARCHAR(MAX) NULL,
    Proveedor      NVARCHAR(80)  NULL,
    CostoEstimado  NVARCHAR(40)  NULL,
    Estrategico    TINYINT NULL, Comercial TINYINT NULL, Complejidad TINYINT NULL, Recursos TINYINT NULL,
    SolicitudID    INT           NULL,
    CorrigeProyectoID INT        NULL,
    FechaTerminado DATETIME2     NULL,        -- cuando se hizo la última tarea pendiente
    FechaCancelado DATETIME2     NULL,
    DatosOrigenJson NVARCHAR(MAX) NULL,       -- campos viejos del prototipo que no tienen columna
    IdOrigen       VARCHAR(40)   NULL,
    Borrado        BIT           NOT NULL CONSTRAINT DF_DesProyectos_Borrado DEFAULT 0,
    FechaBorrado   DATETIME2     NULL,
    FechaAlta      DATETIME2     NOT NULL CONSTRAINT DF_DesProyectos_Alta DEFAULT GETDATE(),
    FechaActualizado DATETIME2   NOT NULL CONSTRAINT DF_DesProyectos_Act DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_DesProyectos_Codigo' AND object_id = OBJECT_ID('dbo.DesProyectos'))
    CREATE UNIQUE INDEX UQ_DesProyectos_Codigo ON dbo.DesProyectos (Codigo) WHERE Borrado = 0;

IF OBJECT_ID('dbo.DesProyectoEtapas', 'U') IS NULL
CREATE TABLE dbo.DesProyectoEtapas (
    EtapaID     INT IDENTITY(1,1) CONSTRAINT PK_DesProyectoEtapas PRIMARY KEY,
    ProyectoID  INT          NOT NULL CONSTRAINT FK_DesProyectoEtapas_Proyecto REFERENCES dbo.DesProyectos (ProyectoID),
    Clave       VARCHAR(40)  NULL,
    Nombre      NVARCHAR(40) NOT NULL,
    Color       VARCHAR(7)   NOT NULL,
    Orden       INT          NOT NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesProyectoEtapas_Proyecto' AND object_id = OBJECT_ID('dbo.DesProyectoEtapas'))
    CREATE INDEX IX_DesProyectoEtapas_Proyecto ON dbo.DesProyectoEtapas (ProyectoID, Orden);

IF OBJECT_ID('dbo.DesTareas', 'U') IS NULL
CREATE TABLE dbo.DesTareas (
    TareaID     INT IDENTITY(1,1) CONSTRAINT PK_DesTareas PRIMARY KEY,
    ProyectoID  INT           NOT NULL CONSTRAINT FK_DesTareas_Proyecto REFERENCES dbo.DesProyectos (ProyectoID),
    EtapaID     INT           NOT NULL CONSTRAINT FK_DesTareas_Etapa REFERENCES dbo.DesProyectoEtapas (EtapaID),
    Nombre      NVARCHAR(120) NOT NULL,
    Orden       INT           NOT NULL,       -- posición dentro de la etapa
    Estado      VARCHAR(10)   NOT NULL CONSTRAINT CK_DesTareas_Estado CHECK (Estado IN ('PENDIENTE', 'EN_CURSO', 'EN_ESPERA', 'HECHO', 'NO_APLICA')),
    ResponsableUsuarioID INT  NULL,
    ResponsableTexto NVARCHAR(120) NULL,
    Fecha       DATE          NULL,           -- fecha confirmada (si no, se muestra la sugerida)
    HechoEl     DATETIME2     NULL,
    DiasHabiles INT           NOT NULL CONSTRAINT DF_DesTareas_Dias DEFAULT 1,
    Entregable  NVARCHAR(80)  NULL,
    Nota        NVARCHAR(300) NULL,
    PideRef     BIT           NOT NULL CONSTRAINT DF_DesTareas_Ref DEFAULT 0,
    MarcaErp    BIT           NOT NULL CONSTRAINT DF_DesTareas_Erp DEFAULT 0,
    IdOrigen    VARCHAR(40)   NULL,
    FechaAlta   DATETIME2     NOT NULL CONSTRAINT DF_DesTareas_Alta DEFAULT GETDATE(),
    FechaActualizado DATETIME2 NOT NULL CONSTRAINT DF_DesTareas_Act DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesTareas_Proyecto' AND object_id = OBJECT_ID('dbo.DesTareas'))
    CREATE INDEX IX_DesTareas_Proyecto ON dbo.DesTareas (ProyectoID, EtapaID, Orden);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesTareas_Responsable' AND object_id = OBJECT_ID('dbo.DesTareas'))
    CREATE INDEX IX_DesTareas_Responsable ON dbo.DesTareas (ResponsableUsuarioID, Estado);

IF OBJECT_ID('dbo.DesTareaDependencias', 'U') IS NULL
CREATE TABLE dbo.DesTareaDependencias (
    TareaID          INT NOT NULL CONSTRAINT FK_DesTareaDep_Tarea REFERENCES dbo.DesTareas (TareaID),
    DependeDeTareaID INT NOT NULL CONSTRAINT FK_DesTareaDep_Depende REFERENCES dbo.DesTareas (TareaID),
    CONSTRAINT PK_DesTareaDependencias PRIMARY KEY (TareaID, DependeDeTareaID),
    CONSTRAINT CK_DesTareaDep_NoSiMisma CHECK (TareaID <> DependeDeTareaID)
);

IF OBJECT_ID('dbo.DesHistorialEtapas', 'U') IS NULL
CREATE TABLE dbo.DesHistorialEtapas (
    HistorialID INT IDENTITY(1,1) CONSTRAINT PK_DesHistorialEtapas PRIMARY KEY,
    ProyectoID  INT          NOT NULL CONSTRAINT FK_DesHistorial_Proyecto REFERENCES dbo.DesProyectos (ProyectoID),
    EtapaID     INT          NULL,            -- NULL = terminado o cancelado
    Etapa       NVARCHAR(40) NOT NULL,        -- nombre de la etapa, 'Terminado' o 'Cancelado'
    Fecha       DATETIME2    NOT NULL CONSTRAINT DF_DesHistorial_Fecha DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesHistorial_Proyecto' AND object_id = OBJECT_ID('dbo.DesHistorialEtapas'))
    CREATE INDEX IX_DesHistorial_Proyecto ON dbo.DesHistorialEtapas (ProyectoID, Fecha);

IF OBJECT_ID('dbo.DesSolicitudes', 'U') IS NULL
CREATE TABLE dbo.DesSolicitudes (
    SolicitudID    INT IDENTITY(1,1) CONSTRAINT PK_DesSolicitudes PRIMARY KEY,
    Numero         INT            NOT NULL CONSTRAINT UQ_DesSolicitudes_Numero UNIQUE,   -- DES-NN
    Tipo           VARCHAR(12)    NOT NULL CONSTRAINT CK_DesSolicitudes_Tipo CHECK (Tipo IN ('SOLICITUD', 'IDEA', 'ORDEN', 'CORRECCION', 'VARIANTE')),
    TipoID         INT            NOT NULL CONSTRAINT FK_DesSolicitudes_Tipo REFERENCES dbo.DesTiposDesarrollo (TipoID),
    Estado         VARCHAR(14)    NOT NULL CONSTRAINT CK_DesSolicitudes_Estado CHECK (Estado IN ('NUEVA', 'EN_EVALUACION', 'POSPUESTA', 'APROBADA', 'RECHAZADA')),
    Titulo         NVARCHAR(120)  NOT NULL,
    Descripcion    NVARCHAR(4000) NULL,
    CliIdCliente   INT            NULL,
    ClienteTexto   NVARCHAR(120)  NULL,
    Cantidad       NVARCHAR(60)   NULL,
    FechaLimite    DATE           NULL,
    PedidoPorUsuarioID INT        NULL,
    PedidoPorTexto NVARCHAR(120)  NULL,
    AutorUsuarioID INT            NULL,
    AutorEquipo    BIT            NOT NULL CONSTRAINT DF_DesSolicitudes_AutorEquipo DEFAULT 1,
    CorrigeProyectoID INT         NULL,
    Familia        NVARCHAR(60)   NULL,
    EtiquetaID     INT            NULL,
    LineaAreaID    VARCHAR(20)    NULL,
    RefErpTexto    NVARCHAR(40)   NULL,
    Estrategico    TINYINT NOT NULL CONSTRAINT DF_DesSol_E DEFAULT 3,
    Comercial      TINYINT NOT NULL CONSTRAINT DF_DesSol_C DEFAULT 3,
    Complejidad    TINYINT NOT NULL CONSTRAINT DF_DesSol_X DEFAULT 3,
    Recursos       TINYINT NOT NULL CONSTRAINT DF_DesSol_R DEFAULT 3,
    Evaluacion     NVARCHAR(2000) NULL,       -- nota interna del equipo (el vendedor no la ve)
    Motivo         NVARCHAR(2000) NULL,       -- motivo de posponer o descartar (lo ve quien lo pidió)
    FechaRevision  DATE           NULL,
    FechaDecision  DATETIME2      NULL,
    DecididoPorUsuarioID INT      NULL,
    ProyectoCreadoID INT          NULL,
    VarianteCreadaID INT          NULL,
    Links          NVARCHAR(1000) NULL,
    DatosOrigenJson NVARCHAR(MAX) NULL,
    IdOrigen       VARCHAR(40)    NULL,
    Borrado        BIT            NOT NULL CONSTRAINT DF_DesSolicitudes_Borrado DEFAULT 0,
    FechaBorrado   DATETIME2      NULL,
    FechaAlta      DATETIME2      NOT NULL CONSTRAINT DF_DesSolicitudes_Alta DEFAULT GETDATE(),
    FechaActualizado DATETIME2    NOT NULL CONSTRAINT DF_DesSolicitudes_Act DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesSolicitudes_PedidoPor' AND object_id = OBJECT_ID('dbo.DesSolicitudes'))
    CREATE INDEX IX_DesSolicitudes_PedidoPor ON dbo.DesSolicitudes (PedidoPorUsuarioID, FechaAlta);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesSolicitudes_Estado' AND object_id = OBJECT_ID('dbo.DesSolicitudes'))
    CREATE INDEX IX_DesSolicitudes_Estado ON dbo.DesSolicitudes (Estado, Borrado);

IF OBJECT_ID('dbo.DesVariantes', 'U') IS NULL
CREATE TABLE dbo.DesVariantes (
    VarianteID  INT IDENTITY(1,1) CONSTRAINT PK_DesVariantes PRIMARY KEY,
    ProyectoID  INT            NOT NULL CONSTRAINT FK_DesVariantes_Proyecto REFERENCES dbo.DesProyectos (ProyectoID),
    Nombre      NVARCHAR(120)  NOT NULL,
    CombinacionJson NVARCHAR(2000) NULL,      -- { slot: codigo de opción }
    Libre       NVARCHAR(200)  NULL,
    Origen      VARCHAR(12)    NULL,          -- equipo, solicitud, sistema
    SolicitudID INT            NULL,
    Estado      VARCHAR(14)    NOT NULL CONSTRAINT CK_DesVariantes_Estado CHECK (Estado IN ('PROPUESTA', 'EN_DESARROLLO', 'MUESTRA', 'LISTA', 'DESCARTADA')),
    Moldes      VARCHAR(10)    NOT NULL CONSTRAINT CK_DesVariantes_Moldes CHECK (Moldes IN ('NO', 'GENERADA', 'DE_ALTA')),
    Tizada      VARCHAR(14)    NOT NULL CONSTRAINT CK_DesVariantes_Tizada CHECK (Tizada IN ('SIN_VERIFICAR', 'NO', 'CARGADA')),
    TizadaNombre NVARCHAR(80)  NULL,
    Erp         VARCHAR(14)    NOT NULL CONSTRAINT CK_DesVariantes_Erp CHECK (Erp IN ('SIN_VERIFICAR', 'NO', 'HABILITADA')),
    ResponsableUsuarioID INT   NULL,
    ResponsableTexto NVARCHAR(120) NULL,
    Fecha       DATE           NULL,
    Nota        NVARCHAR(300)  NULL,
    Orden       INT            NOT NULL CONSTRAINT DF_DesVariantes_Orden DEFAULT 0,
    IdOrigen    VARCHAR(40)    NULL,
    Borrado     BIT            NOT NULL CONSTRAINT DF_DesVariantes_Borrado DEFAULT 0,
    FechaAlta   DATETIME2      NOT NULL CONSTRAINT DF_DesVariantes_Alta DEFAULT GETDATE(),
    FechaActualizado DATETIME2 NOT NULL CONSTRAINT DF_DesVariantes_Act DEFAULT GETDATE()
);

-- Tareas de una variante: lista simple (✓, responsable, fecha). No entran en Tareas ni en Planificación.
IF OBJECT_ID('dbo.DesVarianteTareas', 'U') IS NULL
CREATE TABLE dbo.DesVarianteTareas (
    VarTareaID  INT IDENTITY(1,1) CONSTRAINT PK_DesVarianteTareas PRIMARY KEY,
    VarianteID  INT           NOT NULL CONSTRAINT FK_DesVarTareas_Variante REFERENCES dbo.DesVariantes (VarianteID),
    EtapaClave  VARCHAR(40)   NULL,
    Nombre      NVARCHAR(120) NOT NULL,
    Orden       INT           NOT NULL,
    Estado      VARCHAR(10)   NOT NULL CONSTRAINT CK_DesVarTareas_Estado CHECK (Estado IN ('PENDIENTE', 'EN_CURSO', 'EN_ESPERA', 'HECHO', 'NO_APLICA')),
    ResponsableUsuarioID INT  NULL,
    ResponsableTexto NVARCHAR(120) NULL,
    Fecha       DATE          NULL,
    HechoEl     DATETIME2     NULL,
    DiasHabiles INT           NOT NULL CONSTRAINT DF_DesVarTareas_Dias DEFAULT 1,
    Entregable  NVARCHAR(80)  NULL
);

IF OBJECT_ID('dbo.DesOpcionesSlot', 'U') IS NULL
CREATE TABLE dbo.DesOpcionesSlot (
    OpcionID    INT IDENTITY(1,1) CONSTRAINT PK_DesOpcionesSlot PRIMARY KEY,
    Clave       VARCHAR(100)  NOT NULL CONSTRAINT UQ_DesOpcionesSlot_Clave UNIQUE,   -- camiseta_basica__COS-ANC
    Molde       VARCHAR(60)   NOT NULL,
    MoldeNombre NVARCHAR(100) NULL,
    Slot        VARCHAR(60)   NOT NULL,
    SlotNombre  NVARCHAR(80)  NULL,
    Codigo      VARCHAR(30)   NOT NULL,
    CodigoCasa  VARCHAR(30)   NULL,
    Nombre      NVARCHAR(120) NULL,
    Estado      VARCHAR(10)   NOT NULL CONSTRAINT CK_DesOpciones_Estado CHECK (Estado IN ('RECETA', 'MOLDE', 'FALTA')),
    Habilitada  BIT           NOT NULL CONSTRAINT DF_DesOpciones_Hab DEFAULT 0,
    PorDefecto  BIT           NOT NULL CONSTRAINT DF_DesOpciones_Def DEFAULT 0,
    Nota        NVARCHAR(200) NULL,
    FechaActualizado DATETIME2 NOT NULL CONSTRAINT DF_DesOpciones_Act DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.DesOpcionProyectos', 'U') IS NULL
CREATE TABLE dbo.DesOpcionProyectos (
    OpcionID    INT NOT NULL CONSTRAINT FK_DesOpcionProy_Opcion REFERENCES dbo.DesOpcionesSlot (OpcionID),
    ProyectoID  INT NOT NULL CONSTRAINT FK_DesOpcionProy_Proyecto REFERENCES dbo.DesProyectos (ProyectoID),
    CONSTRAINT PK_DesOpcionProyectos PRIMARY KEY (OpcionID, ProyectoID)
);

IF OBJECT_ID('dbo.DesCapacidades', 'U') IS NULL
CREATE TABLE dbo.DesCapacidades (
    CapacidadID INT IDENTITY(1,1) CONSTRAINT PK_DesCapacidades PRIMARY KEY,
    Clave       VARCHAR(100)  NOT NULL CONSTRAINT UQ_DesCapacidades_Clave UNIQUE,    -- abertura_lateral
    Nombre      NVARCHAR(80)  NOT NULL,
    Familia     NVARCHAR(60)  NULL,
    Ambito      VARCHAR(10)   NOT NULL CONSTRAINT CK_DesCapacidades_Ambito CHECK (Ambito IN ('PRENDA', 'PLANO')),
    Nota        NVARCHAR(200) NULL,
    Resuelta    BIT           NOT NULL CONSTRAINT DF_DesCapacidades_Resuelta DEFAULT 0,
    Borrado     BIT           NOT NULL CONSTRAINT DF_DesCapacidades_Borrado DEFAULT 0,
    FechaActualizado DATETIME2 NOT NULL CONSTRAINT DF_DesCapacidades_Act DEFAULT GETDATE()
);
-- Agregada en la fase 4 (las copias que ya tenían la tabla)
IF COL_LENGTH('dbo.DesCapacidades', 'Borrado') IS NULL
    ALTER TABLE dbo.DesCapacidades ADD Borrado BIT NOT NULL CONSTRAINT DF_DesCapacidades_Borrado DEFAULT 0;

-- Qué capacidades necesita (REQUIERE) o resuelve (RESUELVE) un proyecto o un pedido
IF OBJECT_ID('dbo.DesCapacidadUso', 'U') IS NULL
CREATE TABLE dbo.DesCapacidadUso (
    CapacidadID INT         NOT NULL CONSTRAINT FK_DesCapUso_Capacidad REFERENCES dbo.DesCapacidades (CapacidadID),
    Entidad     VARCHAR(10) NOT NULL CONSTRAINT CK_DesCapUso_Entidad CHECK (Entidad IN ('PROYECTO', 'SOLICITUD')),
    EntidadID   INT         NOT NULL,
    Relacion    VARCHAR(10) NOT NULL CONSTRAINT CK_DesCapUso_Relacion CHECK (Relacion IN ('REQUIERE', 'RESUELVE')),
    CONSTRAINT PK_DesCapacidadUso PRIMARY KEY (CapacidadID, Entidad, EntidadID, Relacion)
);

IF OBJECT_ID('dbo.DesTandas', 'U') IS NULL
CREATE TABLE dbo.DesTandas (
    TandaID     INT IDENTITY(1,1) CONSTRAINT PK_DesTandas PRIMARY KEY,
    Nombre      NVARCHAR(60)  NOT NULL,
    Inicio      DATE          NOT NULL,
    Fin         DATE          NOT NULL,
    Objetivo    NVARCHAR(200) NULL,
    Estado      VARCHAR(8)    NOT NULL CONSTRAINT CK_DesTandas_Estado CHECK (Estado IN ('ABIERTA', 'CERRADA')),
    CerradaEl   DATETIME2     NULL,
    Resumen     NVARCHAR(100) NULL,
    IdOrigen    VARCHAR(40)   NULL,
    FechaAlta   DATETIME2     NOT NULL CONSTRAINT DF_DesTandas_Alta DEFAULT GETDATE(),
    FechaActualizado DATETIME2 NOT NULL CONSTRAINT DF_DesTandas_Act DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.DesTandaGrupos', 'U') IS NULL
CREATE TABLE dbo.DesTandaGrupos (
    GrupoID     INT IDENTITY(1,1) CONSTRAINT PK_DesTandaGrupos PRIMARY KEY,
    TandaID     INT          NOT NULL CONSTRAINT FK_DesTandaGrupos_Tanda REFERENCES dbo.DesTandas (TandaID),
    Nombre      NVARCHAR(60) NOT NULL,
    Orden       INT          NOT NULL
);

IF OBJECT_ID('dbo.DesTandaProyectos', 'U') IS NULL
CREATE TABLE dbo.DesTandaProyectos (
    TandaID     INT NOT NULL CONSTRAINT FK_DesTandaProy_Tanda REFERENCES dbo.DesTandas (TandaID),
    ProyectoID  INT NOT NULL CONSTRAINT FK_DesTandaProy_Proyecto REFERENCES dbo.DesProyectos (ProyectoID),
    GrupoID     INT NULL CONSTRAINT FK_DesTandaProy_Grupo REFERENCES dbo.DesTandaGrupos (GrupoID),
    CONSTRAINT PK_DesTandaProyectos PRIMARY KEY (TandaID, ProyectoID)
);

-- "Una tarea, una tanda abierta": Abierta copia el estado de la tanda (se apaga al cerrarla) y el
-- índice único filtrado no deja la misma tarea en dos tandas abiertas.
IF OBJECT_ID('dbo.DesTandaTareas', 'U') IS NULL
CREATE TABLE dbo.DesTandaTareas (
    TandaID     INT NOT NULL CONSTRAINT FK_DesTandaTareas_Tanda REFERENCES dbo.DesTandas (TandaID),
    TareaID     INT NOT NULL CONSTRAINT FK_DesTandaTareas_Tarea REFERENCES dbo.DesTareas (TareaID),
    Abierta     BIT NOT NULL CONSTRAINT DF_DesTandaTareas_Abierta DEFAULT 1,
    PendienteAlCerrar BIT NULL,
    CONSTRAINT PK_DesTandaTareas PRIMARY KEY (TandaID, TareaID)
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_DesTandaTareas_UnaAbierta' AND object_id = OBJECT_ID('dbo.DesTandaTareas'))
    CREATE UNIQUE INDEX UQ_DesTandaTareas_UnaAbierta ON dbo.DesTandaTareas (TareaID) WHERE Abierta = 1;

-- Orden manual de la "lista de desarrollo" (Planificación)
IF OBJECT_ID('dbo.DesOrdenLista', 'U') IS NULL
CREATE TABLE dbo.DesOrdenLista (
    ProyectoID  INT NOT NULL CONSTRAINT PK_DesOrdenLista PRIMARY KEY CONSTRAINT FK_DesOrdenLista_Proyecto REFERENCES dbo.DesProyectos (ProyectoID),
    Posicion    INT NOT NULL
);

IF OBJECT_ID('dbo.DesMuestraEstados', 'U') IS NULL
CREATE TABLE dbo.DesMuestraEstados (
    EstadoID    INT IDENTITY(1,1) CONSTRAINT PK_DesMuestraEstados PRIMARY KEY,
    Clave       VARCHAR(40)  NOT NULL CONSTRAINT UQ_DesMuestraEstados_Clave UNIQUE,
    Nombre      NVARCHAR(60) NOT NULL,
    Tono        VARCHAR(8)   NOT NULL CONSTRAINT CK_DesMuestraEstados_Tono CHECK (Tono IN ('gris', 'azul', 'ambar', 'verde', 'rojo')),
    Orden       INT          NOT NULL,
    Activo      BIT          NOT NULL CONSTRAINT DF_DesMuestraEstados_Activo DEFAULT 1
);

IF OBJECT_ID('dbo.DesMuestraTildes', 'U') IS NULL
CREATE TABLE dbo.DesMuestraTildes (
    TildeID     INT IDENTITY(1,1) CONSTRAINT PK_DesMuestraTildes PRIMARY KEY,
    Clave       VARCHAR(40)  NOT NULL CONSTRAINT UQ_DesMuestraTildes_Clave UNIQUE,
    Nombre      NVARCHAR(40) NOT NULL,
    Orden       INT          NOT NULL,
    Activo      BIT          NOT NULL CONSTRAINT DF_DesMuestraTildes_Activo DEFAULT 1
);

IF OBJECT_ID('dbo.DesMuestras', 'U') IS NULL
CREATE TABLE dbo.DesMuestras (
    MuestraID   INT IDENTITY(1,1) CONSTRAINT PK_DesMuestras PRIMARY KEY,
    EstadoID    INT            NULL CONSTRAINT FK_DesMuestras_Estado REFERENCES dbo.DesMuestraEstados (EstadoID),
    FechaEnvio  DATE           NULL,
    Ronda       INT            NULL,
    Comentario  NVARCHAR(2000) NULL,
    AutorUsuarioID INT         NULL,
    AutorTexto  NVARCHAR(120)  NULL,
    IdOrigen    VARCHAR(40)    NULL,
    Borrado     BIT            NOT NULL CONSTRAINT DF_DesMuestras_Borrado DEFAULT 0,
    FechaAlta   DATETIME2      NOT NULL CONSTRAINT DF_DesMuestras_Alta DEFAULT GETDATE(),
    FechaActualizado DATETIME2 NOT NULL CONSTRAINT DF_DesMuestras_Act DEFAULT GETDATE()
);

IF OBJECT_ID('dbo.DesMuestraOrdenes', 'U') IS NULL
CREATE TABLE dbo.DesMuestraOrdenes (
    MuestraOrdenID INT IDENTITY(1,1) CONSTRAINT PK_DesMuestraOrdenes PRIMARY KEY,
    MuestraID   INT           NOT NULL CONSTRAINT FK_DesMuestraOrdenes_Muestra REFERENCES dbo.DesMuestras (MuestraID),
    OrdenID     INT           NULL,           -- Ordenes.OrdenID si el número existe
    Numero      VARCHAR(40)   NULL,           -- SUB-31561
    Nombre      NVARCHAR(120) NULL,
    Orden       INT           NOT NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesMuestraOrdenes_Muestra' AND object_id = OBJECT_ID('dbo.DesMuestraOrdenes'))
    CREATE INDEX IX_DesMuestraOrdenes_Muestra ON dbo.DesMuestraOrdenes (MuestraID, Orden);

IF OBJECT_ID('dbo.DesMuestraProyectos', 'U') IS NULL
CREATE TABLE dbo.DesMuestraProyectos (
    MuestraID   INT NOT NULL CONSTRAINT FK_DesMuestraProy_Muestra REFERENCES dbo.DesMuestras (MuestraID),
    ProyectoID  INT NOT NULL CONSTRAINT FK_DesMuestraProy_Proyecto REFERENCES dbo.DesProyectos (ProyectoID),
    Orden       INT NOT NULL CONSTRAINT DF_DesMuestraProy_Orden DEFAULT 0,
    CONSTRAINT PK_DesMuestraProyectos PRIMARY KEY (MuestraID, ProyectoID)
);

IF OBJECT_ID('dbo.DesMuestraTildesMarcadas', 'U') IS NULL
CREATE TABLE dbo.DesMuestraTildesMarcadas (
    MuestraID   INT NOT NULL CONSTRAINT FK_DesMuestraTM_Muestra REFERENCES dbo.DesMuestras (MuestraID),
    TildeID     INT NOT NULL CONSTRAINT FK_DesMuestraTM_Tilde REFERENCES dbo.DesMuestraTildes (TildeID),
    CONSTRAINT PK_DesMuestraTildesMarcadas PRIMARY KEY (MuestraID, TildeID)
);

-- Comunes: comentarios, historial de cambios (bitácora), adjuntos y "Esto me trabó"
IF OBJECT_ID('dbo.DesComentarios', 'U') IS NULL
CREATE TABLE dbo.DesComentarios (
    ComentarioID INT IDENTITY(1,1) CONSTRAINT PK_DesComentarios PRIMARY KEY,
    Entidad     VARCHAR(10)    NOT NULL,      -- SOLICITUD, PROYECTO
    EntidadID   INT            NOT NULL,
    Texto       NVARCHAR(2000) NOT NULL,
    UsuarioID   INT            NULL,
    UsuarioNombre NVARCHAR(150) NULL,
    Fecha       DATETIME2      NOT NULL CONSTRAINT DF_DesComentarios_Fecha DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesComentarios_Entidad' AND object_id = OBJECT_ID('dbo.DesComentarios'))
    CREATE INDEX IX_DesComentarios_Entidad ON dbo.DesComentarios (Entidad, EntidadID, Fecha);

IF OBJECT_ID('dbo.DesBitacora', 'U') IS NULL
CREATE TABLE dbo.DesBitacora (
    BitacoraID  BIGINT IDENTITY(1,1) CONSTRAINT PK_DesBitacora PRIMARY KEY,
    Entidad     VARCHAR(10)    NOT NULL,      -- SOLICITUD, PROYECTO, TANDA, MUESTRA
    EntidadID   INT            NOT NULL,
    Accion      NVARCHAR(60)   NOT NULL,
    Detalle     NVARCHAR(1000) NULL,
    UsuarioID   INT            NULL,
    UsuarioNombre NVARCHAR(150) NULL,
    Fecha       DATETIME2      NOT NULL CONSTRAINT DF_DesBitacora_Fecha DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesBitacora_Entidad' AND object_id = OBJECT_ID('dbo.DesBitacora'))
    CREATE INDEX IX_DesBitacora_Entidad ON dbo.DesBitacora (Entidad, EntidadID, Fecha);

IF OBJECT_ID('dbo.DesAdjuntos', 'U') IS NULL
CREATE TABLE dbo.DesAdjuntos (
    AdjuntoID   INT IDENTITY(1,1) CONSTRAINT PK_DesAdjuntos PRIMARY KEY,
    Entidad     VARCHAR(10)   NOT NULL,       -- SOLICITUD, PROYECTO, MUESTRA
    EntidadID   INT           NOT NULL,
    Archivo     NVARCHAR(260) NOT NULL,       -- nombre en disco (lo arma el servidor)
    NombreOriginal NVARCHAR(260) NULL,
    Mime        VARCHAR(100)  NULL,
    Bytes       INT           NULL,
    UsuarioID   INT           NULL,
    UsuarioNombre NVARCHAR(150) NULL,
    Borrado     BIT           NOT NULL CONSTRAINT DF_DesAdjuntos_Borrado DEFAULT 0,
    Fecha       DATETIME2     NOT NULL CONSTRAINT DF_DesAdjuntos_Fecha DEFAULT GETDATE()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DesAdjuntos_Entidad' AND object_id = OBJECT_ID('dbo.DesAdjuntos'))
    CREATE INDEX IX_DesAdjuntos_Entidad ON dbo.DesAdjuntos (Entidad, EntidadID);

IF OBJECT_ID('dbo.DesFeedback', 'U') IS NULL
CREATE TABLE dbo.DesFeedback (
    FeedbackID  INT IDENTITY(1,1) CONSTRAINT PK_DesFeedback PRIMARY KEY,
    Texto       NVARCHAR(1500) NOT NULL,
    Vista       VARCHAR(30)    NULL,
    ProyectoID  INT            NULL,
    UsuarioID   INT            NULL,
    UsuarioNombre NVARCHAR(150) NULL,
    Fecha       DATETIME2      NOT NULL CONSTRAINT DF_DesFeedback_Fecha DEFAULT GETDATE()
);

-- Configuración suelta: plan_horizonte, plan_tanda, fuentes (JSON), orden_quien…
IF OBJECT_ID('dbo.DesConfig', 'U') IS NULL
CREATE TABLE dbo.DesConfig (
    Clave       VARCHAR(40)   NOT NULL CONSTRAINT PK_DesConfig PRIMARY KEY,
    Valor       NVARCHAR(MAX) NULL,
    FechaActualizado DATETIME2 NOT NULL CONSTRAINT DF_DesConfig_Act DEFAULT GETDATE()
);
`;

// Lo de fábrica, solo en tablas vacías (si alguien ya lo cambió, no se toca).
async function cargarFabrica(tx) {
    const vacia = async (tabla) => (await tx.request().query(`SELECT COUNT(*) AS n FROM dbo.${tabla}`)).recordset[0].n === 0;

    if (await vacia('DesTiposDesarrollo')) {
        for (const [i, tp] of fabrica.TIPOS.entries()) {
            await tx.request()
                .input('C', sql.VarChar(40), tp.clave).input('N', sql.NVarChar(60), tp.nombre)
                .input('P', sql.Bit, tp.esProducto).input('O', sql.Int, i + 1)
                .query('INSERT INTO dbo.DesTiposDesarrollo (Clave, Nombre, EsProducto, Orden) VALUES (@C, @N, @P, @O)');
        }
    }

    if (await vacia('DesPlantillas')) {
        const tipos = (await tx.request().query('SELECT TipoID, Clave FROM dbo.DesTiposDesarrollo')).recordset;
        const tipoId = (clave) => tipos.find(x => x.Clave === clave)?.TipoID || null;
        for (const [i, p] of fabrica.PLANTILLAS.entries()) {
            const r = await tx.request()
                .input('C', sql.VarChar(40), p.clave).input('N', sql.NVarChar(60), p.nombre)
                .input('Para', sql.VarChar(12), p.para).input('T', sql.Int, tipoId(p.tipo))
                .input('D', sql.NVarChar(200), p.descripcion).input('F', sql.Bit, p.fija).input('O', sql.Int, i + 1)
                .query(`INSERT INTO dbo.DesPlantillas (Clave, Nombre, Para, TipoID, Descripcion, Fija, Orden)
                        OUTPUT INSERTED.PlantillaID VALUES (@C, @N, @Para, @T, @D, @F, @O)`);
            const plantillaId = r.recordset[0].PlantillaID;
            const etapas = p.etapas || fabrica.ETAPAS;
            const idEtapa = {};
            for (const [j, e] of etapas.entries()) {
                const re = await tx.request()
                    .input('P', sql.Int, plantillaId).input('C', sql.VarChar(40), e.clave)
                    .input('N', sql.NVarChar(40), e.nombre).input('Col', sql.VarChar(7), e.color).input('O', sql.Int, j + 1)
                    .query(`INSERT INTO dbo.DesPlantillaEtapas (PlantillaID, Clave, Nombre, Color, Orden)
                            OUTPUT INSERTED.EtapaID VALUES (@P, @C, @N, @Col, @O)`);
                idEtapa[e.clave || e.nombre] = re.recordset[0].EtapaID;
            }
            const orden = {};
            for (const tarea of p.tareas) {
                const etapaId = idEtapa[tarea.etapa];
                if (!etapaId) throw new Error(`Plantilla ${p.clave}: la tarea "${tarea.nombre}" apunta a la etapa "${tarea.etapa}", que no existe`);
                orden[etapaId] = (orden[etapaId] || 0) + 1;
                await tx.request()
                    .input('P', sql.Int, plantillaId).input('E', sql.Int, etapaId)
                    .input('N', sql.NVarChar(120), tarea.nombre).input('D', sql.Int, tarea.dias)
                    .input('Ent', sql.NVarChar(80), tarea.entregable || null)
                    .input('R', sql.Bit, tarea.ref).input('Erp', sql.Bit, tarea.erp).input('O', sql.Int, orden[etapaId])
                    .query(`INSERT INTO dbo.DesPlantillaTareas (PlantillaID, EtapaID, Nombre, DiasHabiles, Entregable, PideRef, MarcaErp, Orden)
                            VALUES (@P, @E, @N, @D, @Ent, @R, @Erp, @O)`);
            }
        }
    }

    if (await vacia('DesMuestraEstados')) {
        for (const [i, e] of fabrica.MUESTRA_ESTADOS.entries()) {
            await tx.request()
                .input('C', sql.VarChar(40), e.clave).input('N', sql.NVarChar(60), e.nombre)
                .input('T', sql.VarChar(8), e.tono).input('O', sql.Int, i + 1)
                .query('INSERT INTO dbo.DesMuestraEstados (Clave, Nombre, Tono, Orden) VALUES (@C, @N, @T, @O)');
        }
    }
    if (await vacia('DesMuestraTildes')) {
        for (const [i, e] of fabrica.MUESTRA_TILDES.entries()) {
            await tx.request()
                .input('C', sql.VarChar(40), e.clave).input('N', sql.NVarChar(40), e.nombre).input('O', sql.Int, i + 1)
                .query('INSERT INTO dbo.DesMuestraTildes (Clave, Nombre, Orden) VALUES (@C, @N, @O)');
        }
    }

    for (const [clave, valor] of [['plan_horizonte', fabrica.PLAN.horizonte], ['plan_tanda', fabrica.PLAN.tanda]]) {
        await tx.request().input('C', sql.VarChar(40), clave).input('V', sql.NVarChar(sql.MAX), String(valor))
            .query('IF NOT EXISTS (SELECT 1 FROM dbo.DesConfig WHERE Clave = @C) INSERT INTO dbo.DesConfig (Clave, Valor) VALUES (@C, @V)');
    }
}

// Una sola vez por proceso. Si falla, el próximo pedido lo vuelve a intentar.
let listo = null;
function asegurarEsquema(pool) {
    if (!listo) {
        listo = (async () => {
            await pool.request().batch(DDL);
            const tx = new sql.Transaction(pool);
            await tx.begin();
            try {
                await cargarFabrica(tx);
                await tx.commit();
            } catch (err) {
                await tx.rollback().catch(() => {});
                throw err;
            }
        })().catch((err) => { listo = null; throw err; });
    }
    return listo;
}

module.exports = { asegurarEsquema };
