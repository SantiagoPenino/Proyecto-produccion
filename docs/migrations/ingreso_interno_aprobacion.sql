-- =====================================================================
-- Ingreso interno: aprobación del boceto/matriz TPU sin pasar por el portal (02-oct-2026)
--
-- IngresoInternoPor       → usuario interno que cargó el pedido (página /ventas/pedido-prenda o
--                           conversión de una Solicitud). NULL = lo cargó el cliente en el portal.
-- AprobacionInternaPor    → usuario interno que registró la aprobación del cliente.
-- AprobacionInternaCanal  → por qué medio confirmó el cliente (WhatsApp, Teléfono, Presencial, Email, Otro).
--
-- Columnas nullable: solo metadata, no reescribe la tabla. Se puede correr más de una vez.
-- El sistema funciona igual sin este script (el alta del pedido no se rompe); solo que sin él
-- no se marca el ingreso interno y el botón "Aprobar internamente" avisa que falta.
-- =====================================================================
IF COL_LENGTH('dbo.Ordenes', 'IngresoInternoPor') IS NULL
    ALTER TABLE dbo.Ordenes ADD IngresoInternoPor INT NULL;
GO
IF COL_LENGTH('dbo.Ordenes', 'AprobacionInternaPor') IS NULL
    ALTER TABLE dbo.Ordenes ADD AprobacionInternaPor INT NULL;
GO
IF COL_LENGTH('dbo.Ordenes', 'AprobacionInternaCanal') IS NULL
    ALTER TABLE dbo.Ordenes ADD AprobacionInternaCanal NVARCHAR(30) NULL;
GO
