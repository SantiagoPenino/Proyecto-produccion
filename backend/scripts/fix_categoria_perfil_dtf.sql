/* ─────────────────────────────────────────────────────────────────────────
   El perfil "Descuentos por Cantidades DTF" quedó cargado con
   Categoria = 'Todos' en vez de 'DTF' (typo de carga). Por eso el editor
   de precios nunca lo encuentra para la pestaña DTF (busca coincidencia
   exacta con 'DTF') y no se puede agregar/editar escalas ahí.

   Todos los demás perfiles "escalonados" por categoría (SB, ECOUV, IMD,
   TPU) siguen el mismo patrón: EsGlobal=1 y Categoria = código exacto de
   la categoría. Este UPDATE alinea el de DTF con ese mismo patrón.

   El perfil no tiene reglas cargadas todavía (0 filas en PerfilesItems),
   así que este cambio no afecta ningún precio ya aplicado — solo destraba
   poder cargar escalas de DTF desde la pantalla.
   ───────────────────────────────────────────────────────────────────────── */

-- Verificar antes
SELECT ID, Nombre, Categoria, Activo, EsGlobal
FROM dbo.PerfilesPrecios
WHERE Nombre = 'Descuentos por Cantidades DTF';

UPDATE dbo.PerfilesPrecios
SET Categoria = 'DTF'
WHERE Nombre = 'Descuentos por Cantidades DTF'
  AND Categoria = 'Todos';

-- Verificar después
SELECT ID, Nombre, Categoria, Activo, EsGlobal
FROM dbo.PerfilesPrecios
WHERE Nombre = 'Descuentos por Cantidades DTF';
