/* ─────────────────────────────────────────────────────────────────────────
   Sincroniza a PRODUCCIÓN las escalas de DTF que se cargaron en LOCAL
   (perfil "Descuentos por Cantidades DTF"), como paso intermedio hasta
   poder publicar el deploy de código (fix del error 500 al guardar).

   Contiene, en orden:
   1) Fix del typo Categoria='Todos' -> 'DTF' en el perfil (por si en esta
      base todavía no se corrió fix_categoria_perfil_dtf.sql — es
      idempotente, no rompe nada si ya está en 'DTF').
   2) Precio Base de los 3 productos DTF (sin cambios, incluido por
      completitud — hoy los 3 están en USD 22).
   3) Escalas de volumen: Min 10 = -10%, Min 25 = -15%, Min 100 = -25%
      (Descuento %, USD) para los 3 productos.

   Valores tomados de la base LOCAL el 13/08/2026 17:14. Resuelve
   ProIdProducto y PerfilID por dato (CodArticulo / Nombre del perfil), no
   por ID fijo, para que sirva igual en cualquier base. Idempotente: se
   puede correr más de una vez sin duplicar.
   ───────────────────────────────────────────────────────────────────────── */

-- 0) Verificación previa
SELECT ID, Nombre, Categoria, Activo, EsGlobal FROM dbo.PerfilesPrecios
WHERE Nombre = 'Descuentos por Cantidades DTF';

SELECT CodArticulo, ProIdProducto, Descripcion FROM dbo.Articulos
WHERE LTRIM(RTRIM(CodArticulo)) IN ('48','49','55');
-- Si no aparecen el perfil o los 3 artículos, PARAR ACÁ y avisar.


-- 1) Fix de Categoria (idempotente)
UPDATE dbo.PerfilesPrecios
SET Categoria = 'DTF'
WHERE Nombre = 'Descuentos por Cantidades DTF'
  AND Categoria <> 'DTF';

DECLARE @PerfilID INT = (SELECT TOP 1 ID FROM dbo.PerfilesPrecios WHERE Nombre = 'Descuentos por Cantidades DTF');

IF @PerfilID IS NULL
BEGIN
    RAISERROR('No se encontró el perfil "Descuentos por Cantidades DTF" en esta base.', 16, 1);
    RETURN;
END

-- 2) Precio Base (USD = MonIdMoneda 2)
;WITH PreciosNuevos AS (
    SELECT '48' AS Cod, CAST(22 AS DECIMAL(18,4)) AS Precio UNION ALL
    SELECT '49',        CAST(22 AS DECIMAL(18,4))          UNION ALL
    SELECT '55',        CAST(22 AS DECIMAL(18,4))
)
MERGE dbo.PreciosBase AS target
USING (
    SELECT A.ProIdProducto, A.CodArticulo, PN.Precio
    FROM PreciosNuevos PN
    INNER JOIN dbo.Articulos A ON LTRIM(RTRIM(A.CodArticulo)) = PN.Cod
) AS source
ON (target.ProIdProducto = source.ProIdProducto AND target.MonIdMoneda = 2)
WHEN MATCHED THEN
    UPDATE SET Precio = source.Precio, UltimaActualizacion = GETDATE()
WHEN NOT MATCHED THEN
    INSERT (ProIdProducto, CodArticulo, Precio, MonIdMoneda, Moneda, UltimaActualizacion)
    VALUES (source.ProIdProducto, source.CodArticulo, source.Precio, 2, 'USD', GETDATE());

-- 3) Escalas de volumen (Descuento %, USD)
;WITH EscalasNuevas AS (
    SELECT '48' AS Cod, 10  AS CantidadMinima, CAST(10 AS DECIMAL(18,4)) AS Valor UNION ALL
    SELECT '48',        25,                    CAST(15 AS DECIMAL(18,4))         UNION ALL
    SELECT '48',        100,                   CAST(25 AS DECIMAL(18,4))         UNION ALL
    SELECT '49',        10,                    CAST(10 AS DECIMAL(18,4))         UNION ALL
    SELECT '49',        25,                    CAST(15 AS DECIMAL(18,4))         UNION ALL
    SELECT '49',        100,                   CAST(25 AS DECIMAL(18,4))         UNION ALL
    SELECT '55',        10,                    CAST(10 AS DECIMAL(18,4))         UNION ALL
    SELECT '55',        25,                    CAST(15 AS DECIMAL(18,4))         UNION ALL
    SELECT '55',        100,                   CAST(25 AS DECIMAL(18,4))
)
MERGE dbo.PerfilesItems AS target
USING (
    SELECT A.ProIdProducto, A.CodArticulo, EN.CantidadMinima, EN.Valor
    FROM EscalasNuevas EN
    INNER JOIN dbo.Articulos A ON LTRIM(RTRIM(A.CodArticulo)) = EN.Cod
) AS source
ON (target.PerfilID = @PerfilID
    AND target.ProIdProducto = source.ProIdProducto
    AND target.CantidadMinima = source.CantidadMinima)
WHEN MATCHED THEN
    UPDATE SET TipoRegla = 'percentage_discount', Valor = source.Valor, MonIdMoneda = 2
WHEN NOT MATCHED THEN
    INSERT (PerfilID, ProIdProducto, CodArticulo, TipoRegla, Valor, MonIdMoneda, CantidadMinima)
    VALUES (@PerfilID, source.ProIdProducto, source.CodArticulo, 'percentage_discount', source.Valor, 2, source.CantidadMinima);

-- Verificación final
SELECT PI.ProIdProducto, PI.CodArticulo, PI.CantidadMinima, PI.TipoRegla, PI.Valor
FROM dbo.PerfilesItems PI
WHERE PI.PerfilID = @PerfilID
ORDER BY PI.ProIdProducto, PI.CantidadMinima;
