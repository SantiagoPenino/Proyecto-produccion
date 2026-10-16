-- =============================================
-- SCRIPT: Recrear tabla ConfigEstados
-- Origen: SecureAppDB2206
-- Fecha:  2026-06-22
-- USO:    Ejecutar en base de datos de PRODUCCION
-- =============================================

USE [SecureAppDB];   -- <-- Cambia al nombre de tu BD de produccion si es diferente
GO

-- ---------------------------------------------
-- 1. ELIMINAR TABLA SI EXISTE
-- ---------------------------------------------
IF OBJECT_ID('dbo.ConfigEstados', 'U') IS NOT NULL
    DROP TABLE dbo.ConfigEstados;
GO

-- ---------------------------------------------
-- 2. CREAR TABLA
-- ---------------------------------------------
CREATE TABLE dbo.ConfigEstados (
    EstadoID      INT            NOT NULL,
    AreaID        NVARCHAR(255)  NULL,
    Nombre        NVARCHAR(100)  NOT NULL,
    ColorHex      VARCHAR(20)    NULL,
    Orden         INT            NOT NULL,
    EsFinal       BIT            NULL,
    TipoEstado    NVARCHAR(50)   NULL,
    EstadoPadreID INT            NULL,

    CONSTRAINT PK_ConfigEstados PRIMARY KEY (EstadoID)
);
GO

-- ---------------------------------------------
-- 3. INSERTAR DATOS (23 registros)
-- ---------------------------------------------
SET IDENTITY_INSERT dbo.ConfigEstados OFF;  -- No es identity, insercion directa

INSERT INTO dbo.ConfigEstados (EstadoID, AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado, EstadoPadreID) VALUES
(1,  'ADMIN', 'Produccion',          '#cccccc', 0,  0, 'ESTADO',          NULL),
(2,  'ADMIN', 'Pendiente',           '#cccccc', 1,  0, 'ESTADO',          NULL),
(5,  'ADMIN', 'Cancelado',           '#cccccc', 4,  0, 'ESTADO',          NULL),
(6,  'ADMIN', 'Retenido',            '#cccccc', 0,  0, 'ESTADO',          NULL),
(7,  'ADMIN', 'Cargando',            '#cccccc', 6,  0, 'ESTADO',          NULL),
(8,  'ADMIN', 'Pendiente',           '#fcfcfc', 0,  0, 'ESTADOENAREA',    2),
(9,  'ADMIN', 'En Lote',             '#cccccc', 8,  0, 'ESTADOENAREA',    1),
(12, 'ADMIN', 'Control y Calidad',   '#3fe94b', 11, 0, 'ESTADOENAREA',    1),
(13, 'ADMIN', 'Pronto',              '#cccccc', 12, 0, 'ESTADOENAREA',    1),
(14, 'ADMIN', 'Cancelado',           '#353131', 13, 0, 'ESTADOENAREA',    5),
(16, 'ADMIN', 'Canasto Produccion',  '#cccccc', 15, 0, 'ESTADOLOGISTICA', NULL),
(17, 'ADMIN', 'Canasto Incompletos', '#cccccc', 16, 0, 'ESTADOLOGISTICA', NULL),
(18, 'ADMIN', 'Cancelado',           '#cccccc', 17, 0, 'ESTADOLOGISTICA', NULL),
(26, 'ADMIN', 'Con Falla',           '#f41010', 25, 0, 'ESTADOENAREA',    1),
(28, 'ADMIN', 'En transito',         '#cccccc', 0,  0, 'ESTADOENAREA',    1),
(29, 'ADMIN', 'En Maquina',          '#cccccc', 20, 0, 'ESTADOENAREA',    1),
(30, 'ADMIN', 'Cargando',            '#cccccc', 21, 0, 'ESTADOENAREA',    7),
(31, 'ADMIN', 'Finalizado',          '#cccccc', 20, 0, 'ESTADO',          NULL),
(32, 'ADMIN', 'Finalizado',          '#cccccc', 21, 0, 'ESTADOENAREA',    31),
(33, 'ADMIN', 'Avisado',             '#cccccc', 22, 0, 'ESTADOENAREA',    31),
(34, 'ADMIN', 'Entregado',           '#cccccc', 23, 0, 'ESTADOENAREA',    31),
(35, 'ADMIN', 'Retenido',            '#f59e0b', 26, 0, 'ESTADOENAREA',    1),
(36, 'ADMIN', 'En Cola',             '#cccccc', 27, 0, 'ESTADOENAREA',    1);
GO

-- ---------------------------------------------
-- 4. VERIFICAR
-- ---------------------------------------------
SELECT COUNT(*) AS TotalRegistros FROM dbo.ConfigEstados;
-- Resultado esperado: 23
GO
