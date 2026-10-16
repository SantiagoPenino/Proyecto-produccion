/* ─────────────────────────────────────────────────────────────────────────
   Borra 8 reglas de escala que quedaron mal ubicadas: son de productos de
   BORDADO (CodArticulo '1567' = "Bordado", '1568' = "Matriz de bordado",
   ProIdProducto reales 434 y 435 en Articulos) pero están guardadas dentro
   del perfil de TPU ("TPU PRECIOS ESCALONADOS POR CANTIDAD"), con
   ProIdProducto = NULL en vez del ID real.

   No son huérfanas en el sentido de "artículo borrado" (el artículo existe),
   por eso no las agarra el script genérico de limpieza de huérfanos — hace
   falta este DELETE puntual, apuntado por CodArticulo.

   Decisión: se borran (no se re-vincula el ProIdProducto) porque no
   corresponde tener reglas de Bordado dentro del perfil de TPU.

   Correr primero el SELECT para confirmar que ves exactamente estas 8
   filas antes de borrar.
   ───────────────────────────────────────────────────────────────────────── */

DECLARE @PerfilID INT = (SELECT TOP 1 ID FROM dbo.PerfilesPrecios WHERE Categoria = 'TPU' AND Activo = 1);

-- 1) Verificar
SELECT ID, PerfilID, ProIdProducto, CodArticulo, CantidadMinima, TipoRegla, Valor
FROM dbo.PerfilesItems
WHERE PerfilID = @PerfilID
  AND ProIdProducto IS NULL
  AND LTRIM(RTRIM(CodArticulo)) IN ('1567', '1568')
ORDER BY CantidadMinima, ID;

-- 2) Borrar (descomentar cuando el SELECT de arriba muestre las 8 filas esperadas)
-- DELETE FROM dbo.PerfilesItems
-- WHERE PerfilID = @PerfilID
--   AND ProIdProducto IS NULL
--   AND LTRIM(RTRIM(CodArticulo)) IN ('1567', '1568');
