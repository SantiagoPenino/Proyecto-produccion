/* ─────────────────────────────────────────────────────────────────────────
   Carga directa de 2 valores de escala en TPU que no se pueden guardar
   desde la pantalla en producción porque el código de ahí todavía tiene el
   bug de INSERT con CodArticulo NULL (ya arreglado en el repo, pendiente
   de deploy). Hace a mano lo mismo que haría el botón "Guardar Todo" una
   vez deployado el fix.

   - Producto 154 "Parche con un maximo de 4 estrellas": Min 100 = 2.75 (fijo, USD)
   - Producto 153 "Parche (Hasta 4x4)": Min 1000 = 1 (fijo, USD)

   Idempotente (MERGE): se puede correr más de una vez sin duplicar.
   ───────────────────────────────────────────────────────────────────────── */

DECLARE @PerfilID INT = (SELECT TOP 1 ID FROM dbo.PerfilesPrecios WHERE Categoria = 'TPU' AND Activo = 1);

IF @PerfilID IS NULL
BEGIN
    RAISERROR('No se encontró el perfil TPU activo en esta base.', 16, 1);
    RETURN;
END

;WITH Valores AS (
    SELECT '154' AS Cod, 100  AS CantidadMinima, CAST(2.75 AS DECIMAL(18,4)) AS Valor UNION ALL
    SELECT '153',        1000,                   CAST(1.00 AS DECIMAL(18,4))
)
MERGE dbo.PerfilesItems AS target
USING (
    SELECT A.ProIdProducto, A.CodArticulo, V.CantidadMinima, V.Valor
    FROM Valores V
    INNER JOIN dbo.Articulos A ON LTRIM(RTRIM(A.CodArticulo)) = V.Cod
) AS source
ON (target.PerfilID = @PerfilID
    AND target.ProIdProducto = source.ProIdProducto
    AND target.CantidadMinima = source.CantidadMinima)
WHEN MATCHED THEN
    UPDATE SET TipoRegla = 'fixed_price', Valor = source.Valor, MonIdMoneda = 2
WHEN NOT MATCHED THEN
    INSERT (PerfilID, ProIdProducto, CodArticulo, TipoRegla, Valor, MonIdMoneda, CantidadMinima)
    VALUES (@PerfilID, source.ProIdProducto, source.CodArticulo, 'fixed_price', source.Valor, 2, source.CantidadMinima);

-- Verificación
SELECT PI.ProIdProducto, PI.CodArticulo, PI.CantidadMinima, PI.TipoRegla, PI.Valor
FROM dbo.PerfilesItems PI
WHERE PI.PerfilID = @PerfilID AND PI.ProIdProducto IN (
    SELECT ProIdProducto FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) IN ('153','154')
)
ORDER BY PI.ProIdProducto, PI.CantidadMinima;
