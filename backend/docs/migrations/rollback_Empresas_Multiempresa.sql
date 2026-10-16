/* =====================================================================
   ROLLBACK MULTIEMPRESA  —  rollback_Empresas_Multiempresa.sql
   ---------------------------------------------------------------------
   Revierte add_Empresas_Multiempresa.sql.
   ⚠️ Borra la tabla Empresas y la columna EmpIdEmpresa de
      DocumentosContables (se pierde la atribución de empresa de las
      facturas existentes). HACER BACKUP.
   ===================================================================== */
SET XACT_ABORT ON;
GO

/* ---------- FK (si se había activado) ------------------------------- */
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_Doc_Emp')
   ALTER TABLE dbo.DocumentosContables DROP CONSTRAINT FK_Doc_Emp;
GO

/* ---------- DEFAULT constraint -------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.default_constraints WHERE name='DF_Doc_Emp')
   ALTER TABLE dbo.DocumentosContables DROP CONSTRAINT DF_Doc_Emp;
GO

/* ---------- Índice -------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Doc_Emp')
   DROP INDEX IX_Doc_Emp ON dbo.DocumentosContables;
GO

/* ---------- Columna EmpIdEmpresa ------------------------------------ */
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='EmpIdEmpresa')
   ALTER TABLE dbo.DocumentosContables DROP COLUMN EmpIdEmpresa;
GO

/* ---------- Tabla Empresas (incluye UQ_Empresa_PorDefecto) ---------- */
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='Empresas')
   DROP TABLE dbo.Empresas;
GO

PRINT '===== Rollback multiempresa COMPLETADO =====';
GO
