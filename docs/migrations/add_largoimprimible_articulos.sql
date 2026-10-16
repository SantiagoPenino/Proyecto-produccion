-- =====================================================================
-- COLUMNA largoimprimible EN articulos + MEDIDA FIJA PARA BANDERAS
-- =====================================================================
-- Materiales con largoimprimible > 0 se imprimen a MEDIDA FIJA: el form del
-- portal valida que el archivo mida EXACTAMENTE anchoimprimible x
-- largoimprimible (al cm). Con largoimprimible NULL/0 el comportamiento no
-- cambia (tope clásico: ancho del archivo <= anchoimprimible - 3cm).
-- El endpoint de materiales ya devuelve la columna como "Largo" (va con deploy).
--
-- Idempotente.

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'articulos' AND COLUMN_NAME = 'largoimprimible'
)
    ALTER TABLE dbo.articulos ADD largoimprimible DECIMAL(10,2) NULL;
GO

-- ---------------------------------------------------------------------
-- CARGA DE VALORES: por la pantalla "SINCRO Artículos"
-- (/admin/products-integration), que ahora tiene el campo
-- "Largo Imprimible (medida fija)" junto al Ancho. Cargar ahí el ancho y
-- largo EXACTOS de cada bandera (art. 1558 y 161) — sin SQL.
-- Alternativa por script (mismo efecto):
-- ---------------------------------------------------------------------
-- Tela de bandera (3,10) — art 1558
-- UPDATE dbo.articulos SET anchoimprimible = 3.10, largoimprimible = <LARGO> WHERE LTRIM(RTRIM(CodArticulo)) = '1558';

-- Tela de bandera Mesh (3,17) — art 161
-- UPDATE dbo.articulos SET anchoimprimible = 3.17, largoimprimible = <LARGO> WHERE LTRIM(RTRIM(CodArticulo)) = '161';

-- Verificación
SELECT LTRIM(RTRIM(CodArticulo)) CodArticulo, LTRIM(RTRIM(Descripcion)) Material,
       anchoimprimible, largoimprimible
FROM dbo.articulos
WHERE LTRIM(RTRIM(CodStock)) = '1.1.11.1';
