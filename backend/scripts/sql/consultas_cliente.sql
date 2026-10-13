-- =====================================================================
-- CONSULTA AL CLIENTE (SB · DTF · ECOUV) — esquema base
-- =====================================================================
-- Plan: docs/consultas-cliente-plan.md
--
-- El operario hace UNA pregunta sobre un archivo (o sobre la orden entera),
-- con hasta 5 fotos, y el cliente responde UNA vez: aprueba o cancela.
-- NO es un chat: por eso la pregunta es una columna y no una tabla de mensajes.
--
-- Idempotente: se puede correr las veces que haga falta. El backend además
-- lo crea solo la primera vez que se usa (services/consultasClienteService.js),
-- así que correr esto es opcional — sirve para adelantarlo en producción.
-- =====================================================================

-- ── Catálogo de motivos (espejo de MotivosCancelacion: se agregan sin deploy) ──
IF OBJECT_ID('dbo.MotivosConsulta', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MotivosConsulta (
        MotConIdMotivo    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MotivosConsulta PRIMARY KEY,
        MotConTitulo      NVARCHAR(80)   NOT NULL,
        MotConDescDefault NVARCHAR(400)  NULL,   -- texto sugerido que precarga la pregunta
        MotConActivo      BIT            NOT NULL CONSTRAINT DF_MotCon_Activo DEFAULT 1,
        MotConOrden       INT            NOT NULL CONSTRAINT DF_MotCon_Orden  DEFAULT 0
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MotivosConsulta)
BEGIN
    INSERT INTO dbo.MotivosConsulta (MotConTitulo, MotConOrden) VALUES
        (N'Resolución / calidad del archivo', 1),
        (N'Medidas o proporción',             2),
        (N'Color / tonalidad',                3),
        (N'Contenido, texto u ortografía',    4),
        (N'Material o terminación',           5),
        (N'Sangrado / elementos cortados',    6),
        (N'Consulta general del pedido',      7),
        (N'Otro',                            99);
END
GO

-- ── La consulta ───────────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.ConsultasCliente', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ConsultasCliente (
        ConIdConsulta      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ConsultasCliente PRIMARY KEY,
        OrdIdOrden         INT            NOT NULL,   -- Ordenes.OrdenID (producción)
        ArchivoID          INT            NULL,       -- ArchivosOrden.ArchivoID; NULL = toda la orden
        MotConIdMotivo     INT            NOT NULL,
        ConPregunta        NVARCHAR(1500) NOT NULL,   -- LA pregunta: se escribe una vez, no se edita
        ConEstado          VARCHAR(24)    NOT NULL,   -- ENVIADA | RESPONDIDA | RETIRADA | VENCIDA
        ConRespuesta       VARCHAR(12)    NULL,       -- APROBADO | CANCELADO
        ConComentarioCli   NVARCHAR(1000) NULL,       -- opcional; NO abre conversación
        ConBloqueaProd     BIT            NOT NULL CONSTRAINT DF_Con_Bloquea DEFAULT 1,
        -- Estado ANTERIOR de la orden, para liberarla a donde estaba y no a un OK asumido:
        -- pudo estar esperando otra cosa (ESPERANDO_IMPRESION, ESPERANDO_RETIRO_WMS…).
        ConDependenciaPrev VARCHAR(50)    NULL,
        ConEstadoAreaPrev  NVARCHAR(50)   NULL,
        ConUsuarioAlta     INT            NOT NULL,
        ConFechaAlta       DATETIME       NOT NULL CONSTRAINT DF_Con_Alta DEFAULT GETDATE(),
        ConFechaVence      DATETIME       NULL,
        ConFechaRespuesta  DATETIME       NULL
    );
END
GO

-- Una SOLA consulta abierta por orden, impuesto por la base: sin esto, dos
-- operarios en dos pantallas dejan dos consultas pisándose sobre la misma orden.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ConsultasCliente_AbiertaPorOrden')
    CREATE UNIQUE INDEX UX_ConsultasCliente_AbiertaPorOrden
        ON dbo.ConsultasCliente (OrdIdOrden) WHERE ConEstado = 'ENVIADA';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ConsultasCliente_Estado')
    CREATE INDEX IX_ConsultasCliente_Estado ON dbo.ConsultasCliente (ConEstado, ConFechaVence);
GO

-- ── Las fotos de la pregunta (0 a 5, solo las sube el operario) ────────────────
IF OBJECT_ID('dbo.ConsultasClienteFotos', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ConsultasClienteFotos (
        CFoIdFoto      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ConsultasClienteFotos PRIMARY KEY,
        ConIdConsulta  INT           NOT NULL,
        CFoRutaArchivo VARCHAR(500)  NOT NULL,
        CFoNombre      NVARCHAR(200) NULL,
        CFoFecha       DATETIME      NOT NULL CONSTRAINT DF_CFo_Fecha DEFAULT GETDATE()
    );
    CREATE INDEX IX_ConsultasClienteFotos_Consulta ON dbo.ConsultasClienteFotos (ConIdConsulta);
END
GO

-- ── Estado en área para la orden frenada ──────────────────────────────────────
-- changeOrderState deriva el Estado general del PADRE en ConfigEstados; sin esta
-- fila el estado general se perdería. Cuelga de 'Pendiente' (EstadoID 2), igual
-- que el 'Esperando' que ya usa TPU. fetchEstadoPadre matchea por nombre, no por
-- área, así que una sola fila sirve para SB, DF y ECOUV.
-- OJO: EstadoID es la CLAVE PRIMARIA y NO es identity: hay que calcularlo a mano, y
-- bajo lock, para que dos procesos simultáneos no saquen el mismo número.
IF NOT EXISTS (SELECT 1 FROM dbo.ConfigEstados WHERE Nombre = 'Esperando Cliente' AND TipoEstado = 'ESTADOENAREA')
BEGIN
    BEGIN TRANSACTION;
    DECLARE @nuevoEstadoID INT =
        (SELECT ISNULL(MAX(EstadoID), 0) + 1 FROM dbo.ConfigEstados WITH (TABLOCKX, HOLDLOCK));
    IF NOT EXISTS (SELECT 1 FROM dbo.ConfigEstados WHERE Nombre = 'Esperando Cliente' AND TipoEstado = 'ESTADOENAREA')
        INSERT INTO dbo.ConfigEstados (EstadoID, AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado, EstadoPadreID)
        VALUES (@nuevoEstadoID, 'ADMIN', 'Esperando Cliente', '#b45309', 28, 0, 'ESTADOENAREA', 2);
    COMMIT TRANSACTION;
END
GO
