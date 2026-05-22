USE [SecureAppDB];
GO

-- ============================================================================
-- 1. CREACIÓN DE TABLAS FALTANTES
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Config_CFE')
BEGIN
    CREATE TABLE dbo.[Config_CFE] (
        [CfeCfgId] int IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [CfeCfgClave] varchar(50) NOT NULL,
        [CfeCfgValor] varchar(500) NULL,
        [CfeCfgDescripcion] varchar(200) NULL,
        [CfeCfgActivo] bit NOT NULL DEFAULT 1
    );

    SET IDENTITY_INSERT dbo.[Config_CFE] ON;
    INSERT INTO dbo.[Config_CFE] ([CfeCfgId], [CfeCfgClave], [CfeCfgValor], [CfeCfgDescripcion], [CfeCfgActivo]) VALUES
    (1, 'URL_VERIFICACION', 'https://www.efactura.dgi.gub.uy/principal/verificacioncfe', 'URL publica de verificacion de comprobantes DGI', 1),
    (2, 'TEXTO_IVA_AL_DIA', 'Iva al dia', 'Texto de certificacion fiscal requerido por DGI', 1),
    (3, 'RUC_EMPRESA', '218973270018', 'RUC de la empresa emisora', 1),
    (4, 'NOMBRE_EMPRESA', 'user - Centro de Impresion Digital', 'Razon social de la empresa', 1);
    SET IDENTITY_INSERT dbo.[Config_CFE] OFF;
    PRINT 'Tabla Config_CFE creada e inicializada.';
END
ELSE
BEGIN
    PRINT 'Tabla Config_CFE ya existe.';
END
GO

-- ============================================================================
-- 2. COLUMNAS FALTANTES EN DocumentosContables
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='DocCaeNumero')
BEGIN
    ALTER TABLE dbo.[DocumentosContables] ADD [DocCaeNumero] varchar(50) NULL;
    PRINT 'Columna DocCaeNumero agregada a DocumentosContables.';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='DocCodSeguridad')
BEGIN
    ALTER TABLE dbo.[DocumentosContables] ADD [DocCodSeguridad] varchar(20) NULL;
    PRINT 'Columna DocCodSeguridad agregada a DocumentosContables.';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='DocDiasVencimiento')
BEGIN
    ALTER TABLE dbo.[DocumentosContables] ADD [DocDiasVencimiento] int NULL;
    PRINT 'Columna DocDiasVencimiento agregada a DocumentosContables.';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='DocVendedorId')
BEGIN
    ALTER TABLE dbo.[DocumentosContables] ADD [DocVendedorId] int NULL;
    PRINT 'Columna DocVendedorId agregada a DocumentosContables.';
END
GO

-- ============================================================================
-- 3. COLUMNAS FALTANTES EN SecuenciaDocumentos
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='SecuenciaDocumentos' AND COLUMN_NAME='SecFechaVencimientoCAE')
BEGIN
    ALTER TABLE dbo.[SecuenciaDocumentos] ADD [SecFechaVencimientoCAE] date NULL;
    PRINT 'Columna SecFechaVencimientoCAE agregada a SecuenciaDocumentos.';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='SecuenciaDocumentos' AND COLUMN_NAME='SecNroResolucion')
BEGIN
    ALTER TABLE dbo.[SecuenciaDocumentos] ADD [SecNroResolucion] varchar(20) NULL;
    PRINT 'Columna SecNroResolucion agregada a SecuenciaDocumentos.';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='SecuenciaDocumentos' AND COLUMN_NAME='SecRangoDesde')
BEGIN
    ALTER TABLE dbo.[SecuenciaDocumentos] ADD [SecRangoDesde] int NULL;
    PRINT 'Columna SecRangoDesde agregada a SecuenciaDocumentos.';
END

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='SecuenciaDocumentos' AND COLUMN_NAME='SecRangoHasta')
BEGIN
    ALTER TABLE dbo.[SecuenciaDocumentos] ADD [SecRangoHasta] int NULL;
    PRINT 'Columna SecRangoHasta agregada a SecuenciaDocumentos.';
END
GO

-- ============================================================================
-- 4. AJUSTES DE PERMISIBILIDAD DE NULOS (NULLABILITY)
-- ============================================================================

-- DocumentosContables: permitir NULL en campos financieros para evitar errores al insertar borradores
ALTER TABLE dbo.[DocumentosContables] ALTER COLUMN [DocSubtotal] decimal(18,2) NULL;
ALTER TABLE dbo.[DocumentosContables] ALTER COLUMN [DocTotal] decimal(18,2) NULL;
ALTER TABLE dbo.[DocumentosContables] ALTER COLUMN [DocTotalDescuentos] decimal(18,2) NULL;
ALTER TABLE dbo.[DocumentosContables] ALTER COLUMN [DocTotalRecargos] decimal(18,2) NULL;
ALTER TABLE dbo.[DocumentosContables] ALTER COLUMN [DocImpuestos] decimal(18,2) NULL;
PRINT 'Campos financieros de DocumentosContables actualizados a permitir NULL.';

-- MovimientosCuenta: permitir NULL en MovSaldoPosterior
ALTER TABLE dbo.[MovimientosCuenta] ALTER COLUMN [MovSaldoPosterior] decimal(18,4) NULL;
PRINT 'Columna MovSaldoPosterior de MovimientosCuenta actualizada a permitir NULL.';
GO

PRINT '=========================================================';
PRINT '== SCRIPT DE CORRECCIONES ADICIONALES COMPLETADO       ==';
PRINT '=========================================================';
GO
