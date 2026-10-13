-- =============================================================================
-- SERVICIO TÉCNICO — ETAPA 1 (solicitudes + avisos)            28/09/2026
-- Crea las tablas nuevas, copia los tickets viejos de TicketsMantenimiento y agrega
-- la pantalla /servicio-tecnico al menú (visible para todos los roles).
-- Se puede correr más de una vez: lo que ya existe no se toca.
-- Ver docs/servicio-tecnico-plan.md
-- =============================================================================
USE SecureAppDB;

IF OBJECT_ID('dbo.ConfigEquipos') IS NULL OR OBJECT_ID('dbo.Modulos') IS NULL
BEGIN
    PRINT 'Esta base no es la del sistema (faltan ConfigEquipos / Modulos): no se hizo nada.';
    RETURN;
END

SET XACT_ABORT ON;
BEGIN TRAN;

-- ── 1. Solicitudes ───────────────────────────────────────────────────────────
IF OBJECT_ID('dbo.ST_Solicitudes') IS NULL
BEGIN
    CREATE TABLE dbo.ST_Solicitudes (
        SolId               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_Solicitudes PRIMARY KEY,
        Categoria           VARCHAR(20)    NOT NULL,  -- MAQUINA | PC | RED | SOFTWARE | INSTALACIONES | OTRO
        EquipoId            INT            NULL,      -- ConfigEquipos.EquipoID (categoría MAQUINA)
        EquipoTexto         NVARCHAR(150)  NULL,      -- PC / lugar cuando no es una máquina de producción
        AreaId              VARCHAR(20)    NULL,
        Titulo              NVARCHAR(200)  NOT NULL,
        Descripcion         NVARCHAR(MAX)  NULL,
        Prioridad           VARCHAR(10)    NOT NULL CONSTRAINT DF_ST_Sol_Prioridad DEFAULT 'MEDIA', -- BAJA | MEDIA | ALTA | CRITICA
        MaquinaNoTrabaja    BIT            NOT NULL CONSTRAINT DF_ST_Sol_NoTrabaja DEFAULT 0,
        EstadoEquipoPrevio  NVARCHAR(100)  NULL,      -- estado que tenía la máquina antes de pasarla a MANTENIMIENTO
        Estado              VARCHAR(20)    NOT NULL CONSTRAINT DF_ST_Sol_Estado DEFAULT 'PENDIENTE', -- PENDIENTE | EN_CURSO | EN_ESPERA | DERIVADA | FINALIZADA
        EsperaMotivo        NVARCHAR(300)  NULL,
        Resultado           VARCHAR(20)    NULL,      -- RESUELTA | PARCIAL | NO_RESUELTA | CANCELADA
        FechaSolicitud      DATETIME       NOT NULL CONSTRAINT DF_ST_Sol_Fecha DEFAULT GETDATE(),
        SolicitanteId       INT            NULL,      -- quién reporta (puede no ser el usuario logueado)
        SolicitanteNombre   NVARCHAR(150)  NULL,
        CargadoPorId        INT            NULL,      -- usuario logueado que la cargó
        CargadoPorNombre    NVARCHAR(150)  NULL,
        TecnicoId           INT            NULL,
        TecnicoNombre       NVARCHAR(150)  NULL,
        FechaTomada         DATETIME       NULL,
        DerivadaExterno     NVARCHAR(200)  NULL,      -- servicio externo cuando se deriva afuera
        FechaFin            DATETIME       NULL,
        FinalizadaPorId     INT            NULL,
        FinalizadaPorNombre NVARCHAR(150)  NULL,
        TrabajoRealizado    NVARCHAR(MAX)  NULL,
        RequiereSeguimiento BIT            NOT NULL CONSTRAINT DF_ST_Sol_Seguimiento DEFAULT 0,
        FechaSeguimiento    DATE           NULL,
        SeguimientoNota     NVARCHAR(500)  NULL,
        NecesitaRepuestos   BIT            NOT NULL CONSTRAINT DF_ST_Sol_Repuestos DEFAULT 0,
        RepuestosDetalle    NVARCHAR(1000) NULL,
        MinutosParada       INT            NULL,
        LegacyTicketId      VARCHAR(20)    NULL,      -- número del ticket viejo (TicketsMantenimiento)
        FechaActualizacion  DATETIME       NOT NULL CONSTRAINT DF_ST_Sol_FAct DEFAULT GETDATE()
    );
    CREATE INDEX IX_ST_Sol_Estado  ON dbo.ST_Solicitudes (Estado, FechaSolicitud DESC);
    CREATE INDEX IX_ST_Sol_Equipo  ON dbo.ST_Solicitudes (EquipoId, FechaSolicitud DESC);
    CREATE INDEX IX_ST_Sol_Tecnico ON dbo.ST_Solicitudes (TecnicoId, Estado);
    CREATE UNIQUE INDEX UX_ST_Sol_Legacy ON dbo.ST_Solicitudes (LegacyTicketId) WHERE LegacyTicketId IS NOT NULL;
    PRINT 'Creada ST_Solicitudes';
END

-- ── 2. Historial común (solicitudes, máquinas y, en etapas siguientes, mantenimientos y proyectos)
IF OBJECT_ID('dbo.ST_Historial') IS NULL
BEGIN
    CREATE TABLE dbo.ST_Historial (
        HisId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_Historial PRIMARY KEY,
        Entidad        VARCHAR(20)   NOT NULL,        -- SOLICITUD | EQUIPO | ...
        EntidadId      INT           NOT NULL,
        Fecha          DATETIME      NOT NULL CONSTRAINT DF_ST_His_Fecha DEFAULT GETDATE(),
        UsuarioId      INT           NULL,
        UsuarioNombre  NVARCHAR(150) NULL,
        Accion         VARCHAR(30)   NOT NULL,        -- CREADA | TOMADA | ESTADO | DERIVADA | COMENTARIO | ADJUNTO | FINALIZADA | ...
        Detalle        NVARCHAR(MAX) NULL,
        Motivo         NVARCHAR(500) NULL,
        AUsuarioId     INT           NULL,            -- a quién se derivó / asignó
        AUsuarioNombre NVARCHAR(150) NULL
    );
    CREATE INDEX IX_ST_His_Entidad ON dbo.ST_Historial (Entidad, EntidadId, Fecha);
    CREATE INDEX IX_ST_His_Accion  ON dbo.ST_Historial (Accion, Fecha);
    PRINT 'Creada ST_Historial';
END

-- ── 3. Adjuntos (fotos, capturas, PDF) ───────────────────────────────────────
IF OBJECT_ID('dbo.ST_Adjuntos') IS NULL
BEGIN
    CREATE TABLE dbo.ST_Adjuntos (
        AdjId          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_Adjuntos PRIMARY KEY,
        Entidad        VARCHAR(20)   NOT NULL,
        EntidadId      INT           NOT NULL,
        Archivo        NVARCHAR(260) NOT NULL,        -- nombre en disco
        NombreOriginal NVARCHAR(260) NULL,
        Mime           VARCHAR(100)  NULL,
        Bytes          INT           NULL,
        UsuarioId      INT           NULL,
        UsuarioNombre  NVARCHAR(150) NULL,
        Fecha          DATETIME      NOT NULL CONSTRAINT DF_ST_Adj_Fecha DEFAULT GETDATE()
    );
    CREATE INDEX IX_ST_Adj_Entidad ON dbo.ST_Adjuntos (Entidad, EntidadId);
    PRINT 'Creada ST_Adjuntos';
END

-- ── 4. Sugerencias de título por categoría ───────────────────────────────────
IF OBJECT_ID('dbo.ST_TiposFalla') IS NULL
BEGIN
    CREATE TABLE dbo.ST_TiposFalla (
        TipoId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_TiposFalla PRIMARY KEY,
        Categoria VARCHAR(20)   NOT NULL,
        Titulo    NVARCHAR(200) NOT NULL,
        Usos      INT           NOT NULL CONSTRAINT DF_ST_Tip_Usos DEFAULT 0,
        Activo    BIT           NOT NULL CONSTRAINT DF_ST_Tip_Activo DEFAULT 1
    );
    CREATE UNIQUE INDEX UX_ST_TiposFalla ON dbo.ST_TiposFalla (Categoria, Titulo);
    PRINT 'Creada ST_TiposFalla';
END

-- ── 5. Avisos por usuario (sirven para cualquier módulo) ─────────────────────
IF OBJECT_ID('dbo.NotificacionesUsuario') IS NULL
BEGIN
    CREATE TABLE dbo.NotificacionesUsuario (
        NotId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_NotificacionesUsuario PRIMARY KEY,
        UsuarioId  INT           NOT NULL,
        Modulo     VARCHAR(30)   NOT NULL,            -- SERVICIO_TECNICO, ...
        Titulo     NVARCHAR(200) NOT NULL,
        Texto      NVARCHAR(500) NULL,
        Url        NVARCHAR(300) NULL,
        Leida      BIT           NOT NULL CONSTRAINT DF_NotUsr_Leida DEFAULT 0,
        Fecha      DATETIME      NOT NULL CONSTRAINT DF_NotUsr_Fecha DEFAULT GETDATE(),
        FechaLeida DATETIME      NULL
    );
    CREATE INDEX IX_NotUsr_Usuario ON dbo.NotificacionesUsuario (UsuarioId, Leida, Fecha DESC);
    PRINT 'Creada NotificacionesUsuario';
END

-- Suscripciones push de usuarios INTERNOS (las del portal siguen en PushSubscriptions).
IF OBJECT_ID('dbo.PushSuscripcionesInternas') IS NULL
BEGIN
    CREATE TABLE dbo.PushSuscripcionesInternas (
        Id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PushSuscripcionesInternas PRIMARY KEY,
        UsuarioId   INT           NOT NULL,
        Endpoint    NVARCHAR(500) NOT NULL,
        KeysP256dh  NVARCHAR(200) NULL,
        KeysAuth    NVARCHAR(100) NULL,
        Dispositivo NVARCHAR(200) NULL,
        Fecha       DATETIME      NOT NULL CONSTRAINT DF_PushInt_Fecha DEFAULT GETDATE(),
        CONSTRAINT UQ_PushInt_Endpoint UNIQUE (Endpoint)
    );
    CREATE INDEX IX_PushInt_Usuario ON dbo.PushSuscripcionesInternas (UsuarioId);
    PRINT 'Creada PushSuscripcionesInternas';
END

-- ── 6. Copia de los tickets viejos (TicketsMantenimiento) ────────────────────
-- Quedan PENDIENTES con su número viejo como referencia. No se sabe si la máquina estaba
-- parada: se copian sin marcarla (el estado de las máquinas no se toca acá).
IF OBJECT_ID('dbo.TicketsMantenimiento') IS NOT NULL
BEGIN
    INSERT INTO dbo.ST_Solicitudes (Categoria, EquipoId, AreaId, Titulo, Descripcion, Prioridad, Estado,
                                    FechaSolicitud, SolicitanteNombre, CargadoPorNombre, LegacyTicketId, FechaActualizacion)
    SELECT 'MAQUINA', t.MaquinaID, e.AreaID, LEFT(t.Titulo, 200), t.Descripcion,
           CASE WHEN t.Prioridad LIKE 'Cr%tica' OR t.Prioridad = 'Urgente' THEN 'CRITICA'
                WHEN t.Prioridad = 'Alta' THEN 'ALTA'
                WHEN t.Prioridad = 'Baja' THEN 'BAJA'
                ELSE 'MEDIA' END,
           CASE WHEN t.FechaCierre IS NULL THEN 'PENDIENTE' ELSE 'FINALIZADA' END,
           ISNULL(t.FechaReporte, GETDATE()), t.ReportadoPor, t.ReportadoPor, t.TicketID, GETDATE()
    FROM dbo.TicketsMantenimiento t
    LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = t.MaquinaID
    WHERE NOT EXISTS (SELECT 1 FROM dbo.ST_Solicitudes s WHERE s.LegacyTicketId = t.TicketID);
    PRINT CONCAT(@@ROWCOUNT, ' tickets viejos copiados a ST_Solicitudes');

    INSERT INTO dbo.ST_Historial (Entidad, EntidadId, Fecha, UsuarioNombre, Accion, Detalle)
    SELECT 'SOLICITUD', s.SolId, s.FechaSolicitud, s.SolicitanteNombre, 'CREADA',
           CONCAT('Copiada del sistema anterior (ticket ', s.LegacyTicketId, ')')
    FROM dbo.ST_Solicitudes s
    WHERE s.LegacyTicketId IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.ST_Historial h WHERE h.Entidad = 'SOLICITUD' AND h.EntidadId = s.SolId);

    INSERT INTO dbo.ST_TiposFalla (Categoria, Titulo, Usos)
    SELECT 'MAQUINA', LEFT(LTRIM(RTRIM(t.Titulo)), 200), COUNT(*)
    FROM dbo.TicketsMantenimiento t
    WHERE LTRIM(RTRIM(ISNULL(t.Titulo, ''))) <> ''
      AND NOT EXISTS (SELECT 1 FROM dbo.ST_TiposFalla f WHERE f.Categoria = 'MAQUINA' AND f.Titulo = LEFT(LTRIM(RTRIM(t.Titulo)), 200))
    GROUP BY LEFT(LTRIM(RTRIM(t.Titulo)), 200);
END

-- ── 7. Menú: /servicio-tecnico para todos los roles ──────────────────────────
-- Cualquier usuario interno carga solicitudes; los técnicos (área SERVICIO) y Admin ven todo.
-- Se puede sacar de algún rol después desde Administración → Roles.
IF NOT EXISTS (SELECT 1 FROM dbo.Modulos WHERE Ruta = '/servicio-tecnico')
    INSERT INTO dbo.Modulos (Titulo, IdPadre, Ruta, Icono, IndiceOrden)
    VALUES (N'Servicio Técnico', NULL, '/servicio-tecnico', 'fa-screwdriver-wrench', 96);

DECLARE @Mod INT = (SELECT TOP 1 IdModulo FROM dbo.Modulos WHERE Ruta = '/servicio-tecnico');
INSERT INTO dbo.PermisosRoles (IdRol, IdModulo)
SELECT r.IdRol, @Mod
FROM dbo.Roles r
WHERE NOT EXISTS (SELECT 1 FROM dbo.PermisosRoles pr WHERE pr.IdRol = r.IdRol AND pr.IdModulo = @Mod);
PRINT CONCAT(@@ROWCOUNT, ' roles con acceso nuevo a Servicio Técnico');

COMMIT;

-- ── Verificación ─────────────────────────────────────────────────────────────
SELECT 'ST_Solicitudes' AS Tabla, COUNT(*) AS Filas FROM dbo.ST_Solicitudes
UNION ALL SELECT 'ST_TiposFalla', COUNT(*) FROM dbo.ST_TiposFalla
UNION ALL SELECT 'Roles con el menú', COUNT(*) FROM dbo.PermisosRoles pr JOIN dbo.Modulos m ON m.IdModulo = pr.IdModulo WHERE m.Ruta = '/servicio-tecnico';

-- Entradas de menú que ya apuntaban a servicio técnico (para revisar a mano si hay alguna vieja):
SELECT IdModulo, Titulo, Ruta, IdPadre FROM dbo.Modulos
WHERE Ruta LIKE '%servicio%' OR Titulo LIKE N'%servicio t%';

-- Máquinas que hoy están en FALLA (lo escribía el reporte viejo; ya no se usa).
-- Planificación las cuenta como disponibles y el tablero de Planeación no les deja soltar lotes.
-- Decidir a mano: las que funcionan → DISPONIBLE; las que están paradas → MANTENIMIENTO.
SELECT e.EquipoID, e.AreaID, e.Nombre, e.Estado,
       (SELECT TOP 1 CONCAT(t.TicketID, ' · ', t.Titulo, ' · ', CONVERT(VARCHAR(16), t.FechaReporte, 120))
        FROM dbo.TicketsMantenimiento t WHERE t.MaquinaID = e.EquipoID ORDER BY t.FechaReporte DESC) AS UltimoTicket
FROM dbo.ConfigEquipos e
WHERE UPPER(LTRIM(RTRIM(ISNULL(e.Estado, '')))) = 'FALLA';
