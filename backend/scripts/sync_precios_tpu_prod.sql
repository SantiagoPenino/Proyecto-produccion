/* ─────────────────────────────────────────────────────────────────────────
   Sincroniza a PRODUCCIÓN los precios de TPU (parches 152/153/154/155) que
   quedaron configurados en LOCAL, como paso intermedio hasta que se pueda
   publicar el deploy de código (los fixes de BasePrices/pricesController/
   pricingService).

   Contiene, en orden:
   1) Limpieza de las 16 filas huérfanas del perfil TPU (mismo alcance que
      borrar_perfilesitems_huerfanos_tpu.sql — está repetido acá para que
      este script sea autocontenido).
   2) Precio Base de los 4 productos (PreciosBase, USD).
   3) Escalas de volumen de los 4 productos (PerfilesItems, Precio Fijo USD).

   Los valores están tomados de la base LOCAL el 13/08/2026 14:31. Si seguís
   editando precios en local después de esta fecha, este script queda
   desactualizado — avisame y te regenero uno nuevo con los valores actuales.

   Resuelve ProIdProducto por CodArticulo en la PROPIA base de destino (no
   asume que los ID numéricos coincidan entre local y prod). Es idempotente:
   se puede correr más de una vez sin duplicar ni romper nada.

   Correr el SELECT de verificación (paso 0) antes que nada.
   ───────────────────────────────────────────────────────────────────────── */

-- 0) Verificación previa: confirmar que existen los 4 artículos y el perfil TPU
SELECT CodArticulo, ProIdProducto, Descripcion FROM dbo.Articulos
WHERE LTRIM(RTRIM(CodArticulo)) IN ('152','153','154','155');

SELECT ID, Nombre, Categoria, Activo FROM dbo.PerfilesPrecios WHERE Categoria = 'TPU';
-- Si no aparecen las 4 filas de Articulos, o el perfil TPU no existe/no está
-- Activo=1, PARAR ACÁ y avisar — el script de abajo asume que sí existen.


DECLARE @PerfilID INT = (SELECT TOP 1 ID FROM dbo.PerfilesPrecios WHERE Categoria = 'TPU' AND Activo = 1);

IF @PerfilID IS NULL
BEGIN
    RAISERROR('No se encontró el perfil TPU activo en esta base — no se aplica nada.', 16, 1);
    RETURN;
END

-- 1) Limpieza de reglas huérfanas (artículos borrados que ya no existen en
-- Articulos; los códigos concretos pueden ser distintos a los de local, por
-- eso se detectan por dato en vez de hardcodear 1567/1568/1569/1571)
DELETE PI
FROM dbo.PerfilesItems PI
WHERE PI.PerfilID = @PerfilID
  AND PI.ProIdProducto IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM dbo.Articulos A
      WHERE LTRIM(RTRIM(A.CodArticulo)) = LTRIM(RTRIM(PI.CodArticulo))
  );

-- 2) Precio Base (USD = MonIdMoneda 2)
;WITH PreciosNuevos AS (
    SELECT '152' AS Cod, CAST(2.5  AS DECIMAL(18,4)) AS Precio UNION ALL
    SELECT '153',        CAST(1.5  AS DECIMAL(18,4))          UNION ALL
    SELECT '154',        CAST(3.0  AS DECIMAL(18,4))          UNION ALL
    SELECT '155',        CAST(1.75 AS DECIMAL(18,4))
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

-- 3) Escalas de volumen (Precio Fijo, USD)
;WITH EscalasNuevas AS (
    SELECT '152' AS Cod, 15   AS CantidadMinima, CAST(2.5  AS DECIMAL(18,4)) AS Valor UNION ALL
    SELECT '152',        100,                    CAST(2.25 AS DECIMAL(18,4))          UNION ALL
    SELECT '152',        1000,                   CAST(2.0  AS DECIMAL(18,4))          UNION ALL
    SELECT '153',        15,                     CAST(1.5  AS DECIMAL(18,4))          UNION ALL
    SELECT '153',        100,                    CAST(1.25 AS DECIMAL(18,4))          UNION ALL
    SELECT '154',        15,                     CAST(3.0  AS DECIMAL(18,4))          UNION ALL
    SELECT '154',        1000,                   CAST(2.5  AS DECIMAL(18,4))          UNION ALL
    SELECT '155',        15,                     CAST(1.75 AS DECIMAL(18,4))          UNION ALL
    SELECT '155',        100,                    CAST(1.5  AS DECIMAL(18,4))          UNION ALL
    SELECT '155',        1000,                   CAST(1.25 AS DECIMAL(18,4))
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
    UPDATE SET TipoRegla = 'fixed_price', Valor = source.Valor, MonIdMoneda = 2
WHEN NOT MATCHED THEN
    INSERT (PerfilID, ProIdProducto, CodArticulo, TipoRegla, Valor, MonIdMoneda, CantidadMinima)
    VALUES (@PerfilID, source.ProIdProducto, source.CodArticulo, 'fixed_price', source.Valor, 2, source.CantidadMinima);

-- Verificación final
SELECT PB.ProIdProducto, PB.CodArticulo, PB.Precio, PB.MonIdMoneda
FROM dbo.PreciosBase PB
WHERE PB.ProIdProducto IN (SELECT ProIdProducto FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) IN ('152','153','154','155'));

SELECT PI.ProIdProducto, PI.CodArticulo, PI.CantidadMinima, PI.TipoRegla, PI.Valor
FROM dbo.PerfilesItems PI
WHERE PI.PerfilID = @PerfilID
ORDER BY PI.ProIdProducto, PI.CantidadMinima;
