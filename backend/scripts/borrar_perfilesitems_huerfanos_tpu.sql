/* ─────────────────────────────────────────────────────────────────────────
   Limpieza de reglas huérfanas en el perfil "TPU PRECIOS ESCALONADOS POR
   CANTIDAD".

   Qué son: filas de PerfilesItems con ProIdProducto = NULL cuyo CodArticulo
   no corresponde a ningún artículo real de dbo.Articulos (artículos
   borrados/renumerados con el tiempo). El editor de precios las etiqueta
   como 'TOTAL' (fila "Aplica a TODOS / General") solo porque no encuentra
   el artículo real al hacer el JOIN, no porque sean una regla general
   intencional. En LOCAL eran 16 filas con los códigos 1567/1568/1569/1571;
   en otra base los códigos huérfanos pueden ser distintos, por eso esta
   versión los detecta por dato (NOT EXISTS contra Articulos) en vez de
   hardcodear esos 4 códigos.

   Impacto real: ninguno en pedidos — pricingService.calculatePrice() filtra
   por ProIdProducto o CodArticulo exacto, así que estas filas nunca
   matchean un pedido real. Solo ensucian la pantalla mostrando valores
   heredados "(Gen)" que en la práctica no se cobran a nadie.

   IMPORTANTE: el PerfilID de "TPU" puede NO ser el mismo número en LOCAL
   y en PROD (son IDs autoincrementales, cada base tiene su propio
   historial de altas). Por eso se resuelve por Categoria = 'TPU', nunca
   por ID fijo.

   Antes de borrar, corré el SELECT del paso 1 y confirmá qué te muestra.
   Si te da vacío, es buena noticia: no hay huérfanos que limpiar en esa
   base — no hace falta el DELETE.
   ───────────────────────────────────────────────────────────────────────── */

DECLARE @PerfilID INT = (SELECT TOP 1 ID FROM dbo.PerfilesPrecios WHERE Categoria = 'TPU' AND Activo = 1);

-- 0) Confirmar que se encontró el perfil
SELECT @PerfilID AS PerfilID_TPU_Resuelto;

-- 1) Verificar qué se va a borrar (correr primero)
SELECT PI.ID, PI.PerfilID, PI.ProIdProducto, PI.CodArticulo, PI.CodGrupo, PI.CantidadMinima, PI.TipoRegla, PI.Valor
FROM dbo.PerfilesItems PI
WHERE PI.PerfilID = @PerfilID
  AND PI.ProIdProducto IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM dbo.Articulos A
      WHERE LTRIM(RTRIM(A.CodArticulo)) = LTRIM(RTRIM(PI.CodArticulo))
  )
ORDER BY PI.CantidadMinima, PI.ID;

-- 2) Borrar (descomentar cuando el SELECT de arriba muestre lo esperado)
-- DELETE PI
-- FROM dbo.PerfilesItems PI
-- WHERE PI.PerfilID = @PerfilID
--   AND PI.ProIdProducto IS NULL
--   AND NOT EXISTS (
--       SELECT 1 FROM dbo.Articulos A
--       WHERE LTRIM(RTRIM(A.CodArticulo)) = LTRIM(RTRIM(PI.CodArticulo))
--   );
