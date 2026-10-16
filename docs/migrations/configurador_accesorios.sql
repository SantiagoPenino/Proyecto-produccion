-- =====================================================================================
-- Configurador · ACCESORIOS Y ESTRUCTURA de un producto fabricado (30-sep-2026)
-- Un producto fabricado (ej. windflag) puede llevar artículos de STOCK del WMS que salen
-- con él (mástil, base, funda…). Se cargan en el configurador, paso "Accesorios y estructura".
-- Tabla propia, separada de ProductoComboItems, para que un producto con accesorios NO se
-- trate como combo (explotarCombos, tienda, composición).
--   Obligatorio: 1 = siempre va · 0 = opcional, lo elige quien carga el pedido.
--   Cobro: INCLUIDO = dentro del precio del producto · APARTE = se cobra a precio de lista.
--   Cantidad: unidades del accesorio POR UNIDAD del producto (2 unidades de windflag × 1 = 2 mástiles).
-- Idempotente. Solo agrega; no toca nada existente.
-- =====================================================================================
SET NOCOUNT ON;

IF OBJECT_ID('dbo.ProductoAccesorios', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProductoAccesorios (
        ID                INT IDENTITY(1,1) PRIMARY KEY,
        ProIdProducto     INT NOT NULL,                       -- el producto fabricado (Articulos.ProIdProducto)
        ItemProIdProducto INT NOT NULL,                       -- el artículo de stock
        WmsVarianteId     INT NULL,                           -- variante fija; NULL = se elige al cargar el pedido
        Cantidad          INT NOT NULL DEFAULT 1,             -- por unidad del producto
        Obligatorio       BIT NOT NULL DEFAULT 1,
        Cobro             VARCHAR(10) NOT NULL DEFAULT 'INCLUIDO',
        Orden             INT NULL,
        CONSTRAINT CK_ProductoAccesorios_Cobro CHECK (Cobro IN ('INCLUIDO', 'APARTE')),
        INDEX IX_ProductoAccesorios_Prod (ProIdProducto)
    );
    PRINT 'ProductoAccesorios creada.';
END
ELSE
    PRINT 'ProductoAccesorios ya existía. Sin cambios.';

-- ── Depósito del WMS de donde se retira cada accesorio ──────────────────────────────────
-- NULL = depósito de ventas (WMS_DEPOSITO_LOCAL_ID, hoy 5). Un mástil puede vivir en el Centro
-- de stock general (1) o en ECOUV (3): el configurador lo dice y la venta VEN- lo respeta.
IF COL_LENGTH('dbo.ProductoAccesorios', 'WmsDepositoId') IS NULL
    ALTER TABLE dbo.ProductoAccesorios ADD WmsDepositoId INT NULL;
-- La línea de la venta guarda de qué depósito sale, para que el descuento de stock (confirmar
-- retiro en Logística WMS) pegue en ese depósito y no siempre en el de ventas.
IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'WmsDepositoId') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD WmsDepositoId INT NULL;
PRINT 'Columnas WmsDepositoId listas.';
