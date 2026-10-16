-- ============================================================================
-- Tela de Cliente — Devolución física del excedente
-- Idempotente (se puede correr más de una vez sin romper nada). El backend
-- también la aplica sola al arrancar (ensureSchema en
-- telaClienteDevolucionFisicaService.js) — este script es para dejarla
-- aplicada de antemano en prod antes del deploy.
-- ============================================================================

IF OBJECT_ID('dbo.TelaClienteEventos', 'U') IS NULL
    CREATE TABLE dbo.TelaClienteEventos (
        TevID              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TelaClienteEventos PRIMARY KEY,
        BobinaID           INT            NOT NULL,
        ClienteID          NVARCHAR(200)  NOT NULL,
        Tipo               VARCHAR(20)    NOT NULL,   -- AVISO_EXCEDENTE | SOLICITUD_CLIENTE
        Accion             VARCHAR(12)    NULL,       -- DEVOLVER | DESCARTAR (solo SOLICITUD_CLIENTE)
        Canal              VARCHAR(12)    NULL,       -- RETIRO | ENCOMIENDA (solo Accion=DEVOLVER)
        Estado             VARCHAR(16)    NOT NULL CONSTRAINT DF_Tev_Estado DEFAULT 'PENDIENTE',
        MetrosInvolucrados DECIMAL(10,2)  NULL,
        Origen             VARCHAR(12)    NOT NULL,   -- PORTAL | INTERNO | JOB
        Observaciones      NVARCHAR(500)  NULL,
        OrdenGeneradaID    INT            NULL,
        UsuarioSolicita    INT            NULL,
        UsuarioResuelve    INT            NULL,
        FechaCreacion      DATETIME NOT NULL CONSTRAINT DF_Tev_Alta DEFAULT GETDATE(),
        FechaResolucion    DATETIME       NULL
    );
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TelaClienteEventos_Estado')
    CREATE INDEX IX_TelaClienteEventos_Estado ON dbo.TelaClienteEventos (Estado, Tipo);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TelaClienteEventos_Bobina')
    CREATE INDEX IX_TelaClienteEventos_Bobina ON dbo.TelaClienteEventos (BobinaID);
GO

-- Candado, UNO POR TIPO: no puede haber dos SOLICITUD_CLIENTE abiertas, ni dos
-- AVISO_EXCEDENTE abiertos, para la misma bobina — pero un aviso pendiente NO debe
-- trabar una solicitud real del cliente. (Índice viejo bloqueaba cualquier
-- combinación — bug real encontrado en BOB-74, 17-sep-2026.)
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_TelaClienteEventos_AbiertoPorBobina')
    DROP INDEX UX_TelaClienteEventos_AbiertoPorBobina ON dbo.TelaClienteEventos;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_TelaClienteEventos_SolicitudAbierta')
    CREATE UNIQUE INDEX UX_TelaClienteEventos_SolicitudAbierta
        ON dbo.TelaClienteEventos (BobinaID) WHERE Tipo = 'SOLICITUD_CLIENTE' AND Estado IN ('PENDIENTE', 'APROBADA');
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_TelaClienteEventos_AvisoAbierto')
    CREATE UNIQUE INDEX UX_TelaClienteEventos_AvisoAbierto
        ON dbo.TelaClienteEventos (BobinaID) WHERE Tipo = 'AVISO_EXCEDENTE' AND Estado = 'PENDIENTE';
GO

IF COL_LENGTH('dbo.InventarioBobinas', 'DecisionExcedente') IS NULL
    ALTER TABLE dbo.InventarioBobinas ADD DecisionExcedente NVARCHAR(20) NULL;
GO

-- Datos de envío (solo Accion=DEVOLVER + Canal=ENCOMIENDA) — permiten armar el
-- retiro/encomienda real al Empaquetar sin volver a preguntarle nada al cliente.
IF COL_LENGTH('dbo.TelaClienteEventos', 'Direccion') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD Direccion NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.TelaClienteEventos', 'Departamento') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD Departamento NVARCHAR(50) NULL;
GO
IF COL_LENGTH('dbo.TelaClienteEventos', 'Localidad') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD Localidad NVARCHAR(50) NULL;
GO
IF COL_LENGTH('dbo.TelaClienteEventos', 'AgenciaID') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD AgenciaID INT NULL;
GO
IF COL_LENGTH('dbo.TelaClienteEventos', 'AgenciaOtra') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD AgenciaOtra NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.TelaClienteEventos', 'OReIdOrdenRetiro') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD OReIdOrdenRetiro INT NULL;
GO
IF COL_LENGTH('dbo.TelaClienteEventos', 'ReceptorNombre') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD ReceptorNombre NVARCHAR(200) NULL;
GO

-- Recordatorios + escalamiento del AVISO_EXCEDENTE sin respuesta.
IF COL_LENGTH('dbo.TelaClienteEventos', 'FechaUltimoRecordatorio') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD FechaUltimoRecordatorio DATETIME NULL;
GO
IF COL_LENGTH('dbo.TelaClienteEventos', 'Escalado') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD Escalado BIT NOT NULL CONSTRAINT DF_Tev_Escalado DEFAULT 0;
GO
IF COL_LENGTH('dbo.TelaClienteEventos', 'FechaEscalado') IS NULL
    ALTER TABLE dbo.TelaClienteEventos ADD FechaEscalado DATETIME NULL;
GO

-- Umbral de metros: avisa cuando lo que queda es MENOS que este valor (retazo
-- chico que ya no rinde para otra orden). Configurable sin deploy:
-- UPDATE dbo.ConfiguracionGlobal SET Valor = 'X' WHERE Clave = 'TELA_CLIENTE_UMBRAL_AVISO_METROS' AND AreaID = 'ADMIN';
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'TELA_CLIENTE_UMBRAL_AVISO_METROS' AND AreaID = 'ADMIN')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('TELA_CLIENTE_UMBRAL_AVISO_METROS', 'ADMIN', '5');
GO

-- Cada cuántos días se reitera el push mientras el aviso siga sin respuesta,
-- y a los cuántos días se marca "Escalado" (para que un humano llame).
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'TELA_CLIENTE_RECORDATORIO_DIAS' AND AreaID = 'ADMIN')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('TELA_CLIENTE_RECORDATORIO_DIAS', 'ADMIN', '3');
GO
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'TELA_CLIENTE_ESCALADO_DIAS' AND AreaID = 'ADMIN')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('TELA_CLIENTE_ESCALADO_DIAS', 'ADMIN', '7');
GO
