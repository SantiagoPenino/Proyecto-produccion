USE [importa];
GO

-- ============================================================================
-- COLUMNAS FALTANTES (COMPLEMENTO A 02-COLUMNAS_NUEVAS.sql)
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='MotivoCancelacionID')
ALTER TABLE [dbo].[Ordenes] ADD [MotivoCancelacionID] int NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='DetallesCancelacion')
ALTER TABLE [dbo].[Ordenes] ADD [DetallesCancelacion] nvarchar(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosOrden' AND COLUMN_NAME='MotivoCancelacionID')
ALTER TABLE [dbo].[ArchivosOrden] ADD [MotivoCancelacionID] int NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosOrden' AND COLUMN_NAME='DetallesCancelacion')
ALTER TABLE [dbo].[ArchivosOrden] ADD [DetallesCancelacion] nvarchar(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ServiciosExtraOrden' AND COLUMN_NAME='MotivoCancelacionID')
ALTER TABLE [dbo].[ServiciosExtraOrden] ADD [MotivoCancelacionID] int NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ServiciosExtraOrden' AND COLUMN_NAME='DetallesCancelacion')
ALTER TABLE [dbo].[ServiciosExtraOrden] ADD [DetallesCancelacion] nvarchar(MAX) NULL;
GO

