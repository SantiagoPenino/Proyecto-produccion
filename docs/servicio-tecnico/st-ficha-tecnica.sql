-- =============================================================================
-- SERVICIO TÉCNICO — FICHA TÉCNICA DE MÁQUINAS                     08/10/2026
-- Requiere la etapa 1 (st-etapa1.sql). Se puede correr más de una vez.
-- Ver docs/servicio-tecnico/ficha-tecnica-maquinas-plan.md
--
-- Una fila por máquina (ConfigEquipos.EquipoID). Tipo, marca, modelo, serie, año y local van en
-- columnas para poder buscar; el resto de la ficha (dimensiones, eléctrico, cabezales, garantía, ...)
-- va en Datos como JSON, porque cada tipo de máquina tiene campos distintos. La capacidad sigue en
-- ConfigEquipos (la lee Planificación): no se repite acá.
-- Sin este script la página de la máquina funciona igual; la ficha técnica avisa que falta.
-- =============================================================================
USE SecureAppDB;

IF OBJECT_ID('dbo.ST_Solicitudes') IS NULL
BEGIN
    PRINT 'Falta la etapa 1 (st-etapa1.sql) o esta no es la base del sistema: no se hizo nada.';
    RETURN;
END

SET XACT_ABORT ON;
BEGIN TRAN;

IF OBJECT_ID('dbo.ST_FichaEquipo') IS NULL
BEGIN
    CREATE TABLE dbo.ST_FichaEquipo (
        EquipoId      INT            NOT NULL CONSTRAINT PK_ST_FichaEquipo PRIMARY KEY,  -- ConfigEquipos.EquipoID
        Tipo          VARCHAR(20)    NULL,      -- IMPRESORA | CALANDRA | BORDADORA | LASER | CORTE | COSTURA | OTRA
        Marca         NVARCHAR(100)  NULL,
        Modelo        NVARCHAR(100)  NULL,
        Serie         NVARCHAR(100)  NULL,
        Anio          SMALLINT       NULL,
        LocalId       INT            NULL,      -- dbo.Locales (st-locales.sql); sin FK para no depender del orden de los scripts
        LocalOtro     NVARCHAR(150)  NULL,      -- cuando el local es "otro"
        Datos         NVARCHAR(MAX)  NULL CONSTRAINT CK_ST_FichaEquipo_Datos CHECK (Datos IS NULL OR ISJSON(Datos) = 1),
        FechaModif    DATETIME       NOT NULL CONSTRAINT DF_ST_FichaEquipo_FModif DEFAULT GETDATE(),
        UsuarioId     INT            NULL,
        UsuarioNombre NVARCHAR(150)  NULL
    );
    CREATE INDEX IX_ST_FichaEquipo_Serie ON dbo.ST_FichaEquipo (Serie);
    PRINT 'Creada ST_FichaEquipo';
END

-- Parte 2 (08/10): repuestos críticos de cada máquina. Solo dice qué artículos del /stock (Wms_Variantes) son
-- repuestos de qué máquina: el stock y los límites (crítica / alerta) son los del /stock.
IF OBJECT_ID('dbo.ST_EquipoRepuestos') IS NULL
BEGIN
    CREATE TABLE dbo.ST_EquipoRepuestos (
        RepId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ST_EquipoRepuestos PRIMARY KEY,
        EquipoId      INT            NOT NULL,      -- ConfigEquipos.EquipoID
        VarId         INT            NOT NULL,      -- Wms_Variantes.VarId
        Nota          NVARCHAR(300)  NULL,          -- ej. "cabezal de repuesto para el blanco"
        UsuarioId     INT            NULL,
        UsuarioNombre NVARCHAR(150)  NULL,
        FechaAlta     DATETIME       NOT NULL CONSTRAINT DF_ST_EquipoRepuestos_Fecha DEFAULT GETDATE(),
        CONSTRAINT UQ_ST_EquipoRepuestos UNIQUE (EquipoId, VarId)
    );
    PRINT 'Creada ST_EquipoRepuestos';
END

COMMIT;

SELECT 'ST_FichaEquipo' AS Tabla, COUNT(*) AS Filas FROM dbo.ST_FichaEquipo
UNION ALL SELECT 'ST_EquipoRepuestos', COUNT(*) FROM dbo.ST_EquipoRepuestos;
