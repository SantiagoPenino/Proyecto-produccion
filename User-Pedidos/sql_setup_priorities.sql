-- Tabla de Prioridades (Normal, Urgente, Express, etc.)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ConfigPrioridades]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ConfigPrioridades](
        [IdPrioridad] [int] IDENTITY(1,1) NOT NULL,
        [Nombre] [nvarchar](50) NOT NULL,
        [Nivel] [int] NOT NULL, -- 0: Normal, 1: Baja, 2: Alta, etc. Orden lógico
        [Color] [nvarchar](20) NULL, -- Código Hex o nombre CSS
        [Activo] [bit] NOT NULL DEFAULT ((1)),
        [DiasEntregaExtra] [int] DEFAULT ((0)),
     CONSTRAINT [PK_ConfigPrioridades] PRIMARY KEY CLUSTERED 
    (
        [IdPrioridad] ASC
    )
    )

    -- Insertar valores iniciales
    INSERT INTO [dbo].[ConfigPrioridades] (Nombre, Nivel, Color, DiasEntregaExtra)
    VALUES 
    ('Normal', 1, '#ffffff', 3),
    ('Urgente', 2, '#fbbf24', 1) -- Amber
END
GO
