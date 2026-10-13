-- =============================================================================
-- SERVICIO TÉCNICO — ETAPA 2 (máquinas: historial de cambios)     28/09/2026
-- Requiere la etapa 1 (st-etapa1.sql). Se puede correr más de una vez.
-- Ver docs/servicio-tecnico-plan.md
-- =============================================================================
USE SecureAppDB;

IF OBJECT_ID('dbo.ST_Solicitudes') IS NULL
BEGIN
    PRINT 'Falta la etapa 1 (st-etapa1.sql) o esta no es la base del sistema: no se hizo nada.';
    RETURN;
END

SET XACT_ABORT ON;
BEGIN TRAN;

-- Historial de cambios de cada máquina: qué se cambió, cuándo y por qué.
IF OBJECT_ID('dbo.ST_CambiosEquipo') IS NULL
BEGIN
    CREATE TABLE dbo.ST_CambiosEquipo (
        CamId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_CambiosEquipo PRIMARY KEY,
        EquipoId      INT            NOT NULL,        -- ConfigEquipos.EquipoID
        Fecha         DATE           NOT NULL,        -- día del cambio (puede ser anterior a la carga)
        Tipo          VARCHAR(20)    NOT NULL,        -- REPUESTO | CABEZAL | SOFTWARE | CALIBRACION | CONFIGURACION | REUBICACION | ALTA_BAJA | OTRO
        Descripcion   NVARCHAR(MAX)  NOT NULL,
        Motivo        NVARCHAR(1000) NULL,            -- por qué
        SolId         INT            NULL,            -- solicitud relacionada
        Costo         DECIMAL(18,2)  NULL,
        Moneda        VARCHAR(3)     NULL,            -- UYU | USD
        UsuarioId     INT            NULL,
        UsuarioNombre NVARCHAR(150)  NULL,
        FechaRegistro DATETIME       NOT NULL CONSTRAINT DF_ST_Cam_FReg DEFAULT GETDATE()
    );
    CREATE INDEX IX_ST_Cam_Equipo ON dbo.ST_CambiosEquipo (EquipoId, Fecha DESC);
    PRINT 'Creada ST_CambiosEquipo';
END

COMMIT;

SELECT 'ST_CambiosEquipo' AS Tabla, COUNT(*) AS Filas FROM dbo.ST_CambiosEquipo;
