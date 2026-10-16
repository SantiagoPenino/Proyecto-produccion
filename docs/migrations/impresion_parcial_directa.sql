-- =====================================================================
-- IMPRESIÓN PARCIAL EN DIRECTA — columna + unidad por artículo
-- =====================================================================
-- Habilita el contador de avance por orden en el lote para Impresión Directa,
-- contando PIEZAS o METROS según el artículo. El código (rollsController,
-- webOrdersController, productionController) va con el deploy.
--
-- 1) Columna Ordenes.CantidadImpresa: debe ser DECIMAL(10,2) (soporta metros con
--    decimales además de unidades de TPU). ensureOrderColumns la auto-crea/auto-repara
--    en el deploy, pero se deja el ALTER explícito por si se corre a mano. Idempotente.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'CantidadImpresa' AND Object_ID = Object_ID('dbo.Ordenes'))
    ALTER TABLE dbo.Ordenes ADD CantidadImpresa DECIMAL(10,2) NOT NULL CONSTRAINT DF_Ordenes_CantidadImpresa DEFAULT 0;
GO
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.system_type_id = t.system_type_id
           WHERE c.Name = 'CantidadImpresa' AND c.Object_ID = Object_ID('dbo.Ordenes') AND t.name = 'int')
    ALTER TABLE dbo.Ordenes ALTER COLUMN CantidadImpresa DECIMAL(10,2) NOT NULL;
GO

-- 2) UNIDAD POR ARTÍCULO (dato de negocio): la orden Directa hereda articulos.UniIdUnidad
--    (1=Cantidades/piezas, 2=Metros). Para contar un trabajo por PIEZAS (ej. banderas por unidad),
--    el artículo debe quedar en 1; para METROS (lona), en 2. Se puede cargar por la pantalla
--    SINCRO Artículos o por SQL. *** DEFINIR según negocio ***
-- Ejemplos (descomentar y ajustar):
-- UPDATE dbo.articulos SET UniIdUnidad = 1 WHERE LTRIM(RTRIM(CodArticulo)) = '1558'; -- Tela de bandera → piezas
-- UPDATE dbo.articulos SET UniIdUnidad = 1 WHERE LTRIM(RTRIM(CodArticulo)) = '161';  -- Bandera Mesh → piezas
-- UPDATE dbo.articulos SET UniIdUnidad = 2 WHERE LTRIM(RTRIM(CodArticulo)) = '1560'; -- Blackout (lona) → metros

-- Verificación
SELECT LTRIM(RTRIM(CodArticulo)) CodArticulo, LTRIM(RTRIM(Descripcion)) Material, UniIdUnidad
FROM dbo.articulos WHERE LTRIM(RTRIM(CodStock)) = '1.1.11.1';
