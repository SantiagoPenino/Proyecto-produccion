/* ─────────────────────────────────────────────────────────────────────────
   Baja del menú "Enviar a React" (Stock del Depósito → cálculo, envío a
   React/Macrosoft y liberación). Ruta del front: /logistica/stock-deposito
   Cuelga de "Control Logístico".

   Ya no hay integración con Macrosoft: la página, su ruta y los endpoints
   /logistics/deposit-* se borraron del código. Correrlo DESPUÉS de subir el
   build nuevo; con el menú viejo y el build nuevo la opción abre una página
   vacía.

   Busca el módulo por ruta porque los IdModulo de local y producción no
   coinciden. Es idempotente: si ya no existe, no hace nada.
   Después de correrlo, cada usuario tiene que recargar la página.
   ───────────────────────────────────────────────────────────────────────── */

BEGIN TRAN;

DECLARE @Mods TABLE (IdModulo INT);
INSERT INTO @Mods (IdModulo)
SELECT IdModulo FROM dbo.Modulos WHERE LTRIM(RTRIM(Ruta)) = '/logistica/stock-deposito';

IF EXISTS (SELECT 1 FROM dbo.Modulos m JOIN @Mods x ON m.IdPadre = x.IdModulo)
    THROW 50000, 'El módulo /logistica/stock-deposito tiene hijos: revisar antes de borrarlo.', 1;

DELETE pr FROM dbo.PermisosRoles pr JOIN @Mods x ON pr.IdModulo = x.IdModulo;
DELETE m  FROM dbo.Modulos m       JOIN @Mods x ON m.IdModulo  = x.IdModulo;

COMMIT;

-- Resultado: tiene que salir vacío
SELECT IdModulo, Titulo, Ruta FROM dbo.Modulos WHERE LTRIM(RTRIM(Ruta)) = '/logistica/stock-deposito';
