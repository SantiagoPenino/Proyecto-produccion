/* ============================================================================================
   add_auditoria_deposito.sql — Auditoría de Depósito: sesión + fotografía + registro de casos
   ----------------------------------------------------------------------------------------------
   PRODUCCIÓN (SecureAppDB): correr UNA vez, ANTES de desplegar el backend.
   Idempotente: se puede volver a correr; no duplica nada.
   NO toca OrdenesDeposito, ni AuditoriaScansTemp, ni la tabla Auditoria (log de usuarios).

   Crea:
     dbo.AuditoriaDeposito            -> la sesión (evento): alcance, operador, apertura/cierre, resumen
     dbo.AuditoriaDepositoSnapshot    -> LA FOTOGRAFÍA: copia de las órdenes activas al abrir (no referencia)
     dbo.AuditoriaDepositoEscaneo     -> cada lectura de la pistola dentro de la sesión
     dbo.AuditoriaDepositoCaso        -> registro permanente de casos (1 vivo por orden+tipo, garantizado en la base)
     dbo.AuditoriaDepositoCasoEvento  -> historia del caso: detecciones, acciones, cambios de estado
   y 4 claves en ConfiguracionGlobal (solo si no existen).
   ============================================================================================ */
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

/* ─── 1. SESIÓN DE AUDITORÍA ──────────────────────────────────────────────────────────────── */
IF OBJECT_ID('dbo.AuditoriaDeposito', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditoriaDeposito (
        AudId                    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditoriaDeposito PRIMARY KEY,
        AudCodigo                VARCHAR(30)   NOT NULL,                          -- AUD-2026-0905-01
        AudEstado                VARCHAR(10)   NOT NULL CONSTRAINT DF_AudDep_Estado DEFAULT ('ABIERTA'),
        AudAlcanceTipo           VARCHAR(10)   NOT NULL CONSTRAINT DF_AudDep_AlcanceTipo DEFAULT ('TOTAL'), -- TOTAL | PREFIJO
        AudAlcanceValor          VARCHAR(200)  NULL,                              -- 'SUB,DTF' cuando es PREFIJO
        AudTiposActivos          VARCHAR(200)  NOT NULL,                          -- tipos de caso que ESTA auditoría puede generar y cerrar
        AudEsLineaBase           BIT           NOT NULL CONSTRAINT DF_AudDep_LineaBase DEFAULT (0),
        AudFechaApertura         DATETIME      NOT NULL CONSTRAINT DF_AudDep_FechaApertura DEFAULT (GETDATE()),
        AudUsuarioApertura       INT           NULL,
        AudUsuarioAperturaNombre VARCHAR(100)  NULL,
        AudFechaCierre           DATETIME      NULL,
        AudUsuarioCierre         INT           NULL,
        AudUsuarioCierreNombre   VARCHAR(100)  NULL,
        AudCotizacionDolar       DECIMAL(18,4) NULL,                              -- cotización usada para valorizar la fotografía
        AudDiasMaxDeposito       INT           NULL,                              -- DIAS_MAX_DEPOSITO vigente al abrir
        AudSnapshotCant          INT           NULL,
        AudEscaneosCant          INT           NULL,
        AudEscaneosDuplicados    INT           NULL,
        AudNuevos                INT           NULL,
        AudExistentes            INT           NULL,
        AudReincidentes          INT           NULL,
        AudResueltos             INT           NULL,
        AudAbiertosTotal         INT           NULL,
        AudMovidas               INT           NULL,                              -- órdenes que se movieron durante la auditoría (no generan caso)
        AudResumenJson           NVARCHAR(MAX) NULL,                              -- detalle del cierre (hallazgos por tipo, movidas, duplicados)
        AudObservaciones         NVARCHAR(500) NULL,
        CONSTRAINT UQ_AuditoriaDeposito_Codigo  UNIQUE (AudCodigo),
        CONSTRAINT CK_AuditoriaDeposito_Estado  CHECK (AudEstado IN ('ABIERTA','CERRADA','ANULADA')),
        CONSTRAINT CK_AuditoriaDeposito_Alcance CHECK (AudAlcanceTipo IN ('TOTAL','PREFIJO'))
    );
    PRINT 'Creada dbo.AuditoriaDeposito';
END

-- Solo puede haber UNA auditoría abierta a la vez (índice único filtrado)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AuditoriaDeposito_Abierta' AND object_id = OBJECT_ID('dbo.AuditoriaDeposito'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_AuditoriaDeposito_Abierta
        ON dbo.AuditoriaDeposito (AudEstado)
        WHERE AudEstado = 'ABIERTA';
    PRINT 'Creado UX_AuditoriaDeposito_Abierta';
END

/* ─── 2. FOTOGRAFÍA (snapshot) ────────────────────────────────────────────────────────────── */
IF OBJECT_ID('dbo.AuditoriaDepositoSnapshot', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditoriaDepositoSnapshot (
        AudId                 INT           NOT NULL,
        OrdIdOrden            INT           NOT NULL,                             -- PK de OrdenesDeposito: la identidad
        OrdCodigoOrden        VARCHAR(20)   NULL,
        Prefijo               VARCHAR(10)   NULL,                                 -- SUB / DTF / EUV... (alcance)
        ClaveCodigo           VARCHAR(20)   NULL,                                 -- código sin prefijo: empareja con la etiqueta física 9471/B11575
        CliIdCliente          INT           NULL,
        ClienteNombre         NVARCHAR(200) NULL,
        ClienteTipo           NVARCHAR(100) NULL,
        ClienteTelefono       NVARCHAR(50)  NULL,
        ClienteEmail          NVARCHAR(200) NULL,
        OrdNombreTrabajo      NVARCHAR(200) NULL,
        OrdEstadoActual       INT           NULL,
        OrdFechaIngresoOrden  DATETIME      NULL,
        OrdFechaEstadoActual  DATETIME      NULL,
        OrdAvisoWsp           BIT           NULL,
        OrdFechaAvisoWsp      DATETIME      NULL,
        OrdCostoFinal         FLOAT         NULL,
        MonIdMoneda           INT           NULL,
        ValorPesos            DECIMAL(18,2) NULL,                                 -- costo final pasado a pesos con AudCotizacionDolar
        PagIdPago             INT           NULL,
        PagoEstado            VARCHAR(80)   NULL,                                 -- misma lógica que la pestaña (pago vía documento incluido)
        SaldadaPorDoc         BIT           NULL,
        OReIdOrdenRetiro      INT           NULL,
        FormaRetiro           NVARCHAR(20)  NULL,
        BultosEsperados       INT           NULL,
        BultosRecibidos       INT           NULL,
        Estante               VARCHAR(40)   NULL,                                 -- OcupacionEstantes: ESTANTE-SECCION-POSICION si tiene
        DiasEnDeposito        INT           NULL,
        CONSTRAINT PK_AuditoriaDepositoSnapshot PRIMARY KEY (AudId, OrdIdOrden),
        CONSTRAINT FK_AudDepSnapshot_Aud FOREIGN KEY (AudId) REFERENCES dbo.AuditoriaDeposito (AudId)
    );
    CREATE NONCLUSTERED INDEX IX_AudDepSnapshot_Clave  ON dbo.AuditoriaDepositoSnapshot (AudId, ClaveCodigo);
    CREATE NONCLUSTERED INDEX IX_AudDepSnapshot_Codigo ON dbo.AuditoriaDepositoSnapshot (AudId, OrdCodigoOrden);
    PRINT 'Creada dbo.AuditoriaDepositoSnapshot';
END

/* ─── 3. ESCANEOS DE LA SESIÓN ────────────────────────────────────────────────────────────── */
IF OBJECT_ID('dbo.AuditoriaDepositoEscaneo', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditoriaDepositoEscaneo (
        EscId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditoriaDepositoEscaneo PRIMARY KEY,
        AudId         INT          NOT NULL,
        Codigo        VARCHAR(100) NOT NULL,                                       -- tal cual lo leyó la pistola
        ClaveCodigo   VARCHAR(50)  NULL,                                           -- normalizado: sin /B..., sin prefijo de área
        OrdIdOrden    INT          NULL,                                           -- OrdenesDeposito resuelta (fotografía o viva)
        OrdenProdId   INT          NULL,                                           -- Ordenes.OrdenID cuando la etiqueta es de producción
        Resultado     VARCHAR(20)  NOT NULL,                                       -- OK | ENTREGADA | FUERA_ALCANCE | INGRESO_POSTERIOR | SIN_INGRESO | DESCONOCIDO
        Duplicado     BIT          NOT NULL CONSTRAINT DF_AudDepEsc_Dup DEFAULT (0), -- misma etiqueta leída otra vez: se registra, no suma
        Fecha         DATETIME     NOT NULL CONSTRAINT DF_AudDepEsc_Fecha DEFAULT (GETDATE()),
        UsuarioId     INT          NULL,
        UsuarioNombre VARCHAR(100) NULL,
        CONSTRAINT FK_AudDepEsc_Aud FOREIGN KEY (AudId) REFERENCES dbo.AuditoriaDeposito (AudId),
        CONSTRAINT CK_AudDepEsc_Resultado CHECK (Resultado IN ('OK','ENTREGADA','FUERA_ALCANCE','INGRESO_POSTERIOR','SIN_INGRESO','DESCONOCIDO'))
    );
    CREATE NONCLUSTERED INDEX IX_AudDepEsc_AudCodigo ON dbo.AuditoriaDepositoEscaneo (AudId, Codigo);
    CREATE NONCLUSTERED INDEX IX_AudDepEsc_AudOrden  ON dbo.AuditoriaDepositoEscaneo (AudId, OrdIdOrden);
    PRINT 'Creada dbo.AuditoriaDepositoEscaneo';
END

/* ─── 4. REGISTRO PERMANENTE DE CASOS ─────────────────────────────────────────────────────── */
IF OBJECT_ID('dbo.AuditoriaDepositoCaso', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditoriaDepositoCaso (
        CasoId            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditoriaDepositoCaso PRIMARY KEY,
        CasoCodigo        AS ('CASO-' + RIGHT('000000' + CAST(CasoId AS VARCHAR(10)), 6)) PERSISTED,
        OrdIdOrden        INT           NULL,                                     -- IDENTIDAD del caso. NULL solo para SIN_INGRESO / NO_REGISTRADA
        OrdCodigoOrden    VARCHAR(100)  NULL,                                     -- código de la orden, o el código escaneado si no hay orden en depósito
        OrdenProdId       INT           NULL,                                     -- Ordenes.OrdenID (SIN_INGRESO)
        Prefijo           VARCHAR(10)   NULL,
        CliIdCliente      INT           NULL,
        ClienteNombre     NVARCHAR(200) NULL,
        Tipo              VARCHAR(20)   NOT NULL,
        Estado            VARCHAR(10)   NOT NULL CONSTRAINT DF_AudDepCaso_Estado DEFAULT ('ABIERTO'),
        Severidad         VARCHAR(5)    NOT NULL CONSTRAINT DF_AudDepCaso_Sev DEFAULT ('BAJA'),   -- derivada, se recalcula en cada fusión
        ValorPesos        DECIMAL(18,2) NULL,
        DiasEnDeposito    INT           NULL,
        PrimeraAudId      INT           NULL,
        PrimeraDeteccion  DATETIME      NOT NULL CONSTRAINT DF_AudDepCaso_Primera DEFAULT (GETDATE()),
        UltimaAudId       INT           NULL,
        UltimaDeteccion   DATETIME      NOT NULL CONSTRAINT DF_AudDepCaso_Ultima DEFAULT (GETDATE()),
        VecesDetectado    INT           NOT NULL CONSTRAINT DF_AudDepCaso_Veces DEFAULT (1),
        Reincidente       BIT           NOT NULL CONSTRAINT DF_AudDepCaso_Rein DEFAULT (0),
        ResponsableId     INT           NULL,
        ResponsableNombre VARCHAR(100)  NULL,
        FechaLimite       DATE          NULL,
        MotivoCierre      NVARCHAR(300) NULL,
        CerradoEn         DATETIME      NULL,
        CerradoPor        INT           NULL,
        CerradoPorNombre  VARCHAR(100)  NULL,
        ActualizadoEn     DATETIME      NOT NULL CONSTRAINT DF_AudDepCaso_Act DEFAULT (GETDATE()),
        CONSTRAINT CK_AudDepCaso_Tipo      CHECK (Tipo IN ('FALTANTE','SOBRANTE','SIN_INGRESO','NO_REGISTRADA','SIN_AVISO','PERMANENCIA')),
        CONSTRAINT CK_AudDepCaso_Estado    CHECK (Estado IN ('ABIERTO','EN_CURSO','ESPERANDO','RESUELTO','ASUMIDO')),
        CONSTRAINT CK_AudDepCaso_Sev       CHECK (Severidad IN ('ALTA','MEDIA','BAJA')),
        CONSTRAINT CK_AudDepCaso_Identidad CHECK (OrdIdOrden IS NOT NULL OR OrdCodigoOrden IS NOT NULL),
        -- INVARIANTE 5: ningún caso queda ASUMIDO sin motivo y sin responsable
        CONSTRAINT CK_AudDepCaso_Asumido   CHECK (Estado <> 'ASUMIDO' OR (MotivoCierre IS NOT NULL AND ResponsableId IS NOT NULL))
    );
    CREATE NONCLUSTERED INDEX IX_AudDepCaso_Estado ON dbo.AuditoriaDepositoCaso (Estado, Severidad) INCLUDE (Tipo, OrdIdOrden);
    PRINT 'Creada dbo.AuditoriaDepositoCaso';
END

-- INVARIANTE 1: un solo caso VIVO por (orden, tipo). Índice único filtrado: si la app falla, la base lo impide igual.
-- (SQL Server no admite NOT IN en el filtro; se enumeran los estados vivos, que el CHECK de arriba deja cerrados.)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AudDepCaso_VivoOrden' AND object_id = OBJECT_ID('dbo.AuditoriaDepositoCaso'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_AudDepCaso_VivoOrden
        ON dbo.AuditoriaDepositoCaso (OrdIdOrden, Tipo)
        WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND OrdIdOrden IS NOT NULL;
    PRINT 'Creado UX_AudDepCaso_VivoOrden';
END
-- Misma garantía para los casos sin orden en depósito (identidad = código escaneado)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_AudDepCaso_VivoCodigo' AND object_id = OBJECT_ID('dbo.AuditoriaDepositoCaso'))
BEGIN
    CREATE UNIQUE NONCLUSTERED INDEX UX_AudDepCaso_VivoCodigo
        ON dbo.AuditoriaDepositoCaso (OrdCodigoOrden, Tipo)
        WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND OrdIdOrden IS NULL;
    PRINT 'Creado UX_AudDepCaso_VivoCodigo';
END

/* ─── 5. HISTORIA DEL CASO ────────────────────────────────────────────────────────────────── */
IF OBJECT_ID('dbo.AuditoriaDepositoCasoEvento', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AuditoriaDepositoCasoEvento (
        EvtId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditoriaDepositoCasoEvento PRIMARY KEY,
        CasoId        INT           NOT NULL,
        Fecha         DATETIME      NOT NULL CONSTRAINT DF_AudDepEvt_Fecha DEFAULT (GETDATE()),
        Tipo          VARCHAR(20)   NOT NULL,                                     -- DETECCION | ACCION | CAMBIO_ESTADO | COMENTARIO
        AudId         INT           NULL,                                         -- si vino de una auditoría
        UsuarioId     INT           NULL,
        UsuarioNombre VARCHAR(100)  NULL,
        EstadoNuevo   VARCHAR(10)   NULL,
        Detalle       NVARCHAR(500) NULL,
        CONSTRAINT FK_AudDepEvt_Caso FOREIGN KEY (CasoId) REFERENCES dbo.AuditoriaDepositoCaso (CasoId),
        CONSTRAINT CK_AudDepEvt_Tipo CHECK (Tipo IN ('DETECCION','ACCION','CAMBIO_ESTADO','COMENTARIO'))
    );
    CREATE NONCLUSTERED INDEX IX_AudDepEvt_Caso ON dbo.AuditoriaDepositoCasoEvento (CasoId, Fecha);
    PRINT 'Creada dbo.AuditoriaDepositoCasoEvento';
END

/* ─── 6. CONFIGURACIÓN (solo si la clave no existe) ───────────────────────────────────────── */
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'DIAS_MAX_DEPOSITO')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('DIAS_MAX_DEPOSITO', 'ADMIN', '15');            -- plazo de permanencia (Caducadas / PERMANENCIA)
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AUDIT_DEP_UMBRAL_VALOR_ALTA')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AUDIT_DEP_UMBRAL_VALOR_ALTA', 'ADMIN', '5000'); -- $ pesos: FALTANTE con valor mayor = severidad ALTA
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AUDIT_DEP_DIAS_SIN_AVISO')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AUDIT_DEP_DIAS_SIN_AVISO', 'ADMIN', '3');      -- días en depósito sin aviso WSP para abrir caso SIN_AVISO
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AUDIT_DEP_TIPOS_ACTIVOS')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AUDIT_DEP_TIPOS_ACTIVOS', 'ADMIN', 'FALTANTE,SOBRANTE,SIN_INGRESO,NO_REGISTRADA,SIN_AVISO,PERMANENCIA');
    -- La PRIMERA auditoría (línea base) ignora SIN_AVISO y PERMANENCIA aunque estén acá: solo diferencias físicas.

-- Conteo cíclico (Fase 5): cada cuántos días auditar un área según su clase ABC por valor en depósito
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AUDIT_DEP_CICLICO_DIAS_A')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AUDIT_DEP_CICLICO_DIAS_A', 'ADMIN', '7');
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AUDIT_DEP_CICLICO_DIAS_B')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AUDIT_DEP_CICLICO_DIAS_B', 'ADMIN', '14');
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AUDIT_DEP_CICLICO_DIAS_C')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AUDIT_DEP_CICLICO_DIAS_C', 'ADMIN', '30');
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AUDIT_DEP_ABC_CORTES')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AUDIT_DEP_ABC_CORTES', 'ADMIN', '80,95');       -- % acumulado del valor: hasta 80 = A, hasta 95 = B, resto = C

PRINT 'add_auditoria_deposito.sql: OK';
