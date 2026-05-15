USE [PRODUCCION ACTUAL];
GO
IF OBJECT_ID('dbo.Cont_ReglasAsiento', 'U') IS NOT NULL DROP TABLE dbo.Cont_ReglasAsiento;
IF OBJECT_ID('dbo.Cont_EventosContables', 'U') IS NOT NULL DROP TABLE dbo.Cont_EventosContables;
IF OBJECT_ID('dbo.Cont_PlanCuentas_VIEJA', 'U') IS NOT NULL DROP TABLE dbo.Cont_PlanCuentas_VIEJA;
EXEC sp_rename 'dbo.Cont_PlanCuentas', 'Cont_PlanCuentas_VIEJA';
GO
CREATE TABLE [dbo].[Cont_PlanCuentas](
	[CueId] [int] IDENTITY(1,1) NOT NULL,
	[CueCodigo] [varchar](30) NOT NULL,
	[CueNombre] [nvarchar](200) NOT NULL,
	[CueNivel] [int] NOT NULL,
	[CueTipoBase] [varchar](50) NOT NULL,
	[CueMoneda] [varchar](10) NOT NULL,
	[CueImputable] [bit] NOT NULL,
	[CueActiva] [bit] NOT NULL
);
GO
CREATE TABLE [dbo].[Cont_EventosContables](
	[EvtCodigo] [varchar](30) NOT NULL,
	[EvtNombre] [nvarchar](200) NOT NULL,
	[EvtDescripcion] [nvarchar](1000) NULL,
	[EvtPrefijo] [varchar](5) NULL,
	[EvtSubtipo] [varchar](30) NULL,
	[EvtAfectaSaldo] [smallint] NOT NULL,
	[EvtGeneraDeuda] [bit] NOT NULL,
	[EvtAplicaRecurso] [bit] NOT NULL,
	[EvtUsaEntidad] [bit] NOT NULL,
	[EvtRequiereDoc] [bit] NOT NULL,
	[EvtActivo] [bit] NOT NULL,
	[EvtOrden] [int] NOT NULL,
	[EvtFechaAlta] [datetime] NOT NULL
);
GO
CREATE TABLE [dbo].[Cont_ReglasAsiento](
	[RasId] [int] IDENTITY(1,1) NOT NULL,
	[EvtCodigo] [varchar](30) NOT NULL,
	[CueCodigo] [varchar](30) NOT NULL,
	[RasNaturaleza] [varchar](10) NOT NULL,
	[RasFormula] [varchar](50) NOT NULL,
	[RasOrden] [int] NOT NULL
);
GO
