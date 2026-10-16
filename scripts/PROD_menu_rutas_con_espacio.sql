/* ============================================================================
   MENÚ — rutas guardadas con espacio adelante/atrás en dbo.Modulos
   ----------------------------------------------------------------------------
   Síntoma (05-09-2026): el ítem "Jobs/Cron" llevaba a
   /admin/menu/%20/admin/cron/%20/admin/cron/... — cada clic APILABA la ruta.
   Causa: Modulos.Ruta = ' /admin/cron' (espacio adelante). Para el router del
   front una ruta que no empieza con '/' es RELATIVA, así que la pega a la URL
   actual en vez de reemplazarla. Mismo caso en "Reconciliación".

   El código ya normaliza (trim) al leer y al guardar; esto limpia lo que ya
   está guardado. Idempotente.
   ============================================================================ */
SET NOCOUNT ON;

SELECT Antes = 'ANTES', IdModulo, Titulo, Ruta = '[' + Ruta + ']'
FROM dbo.Modulos
WHERE Ruta <> LTRIM(RTRIM(Ruta)) OR Ruta LIKE '%' + CHAR(9) + '%';

UPDATE dbo.Modulos
SET Ruta = LTRIM(RTRIM(REPLACE(Ruta, CHAR(9), '')))
WHERE Ruta <> LTRIM(RTRIM(Ruta)) OR Ruta LIKE '%' + CHAR(9) + '%';
PRINT CONCAT('Rutas normalizadas: ', @@ROWCOUNT);

SELECT Despues = 'DESPUES', IdModulo, Titulo, Ruta = '[' + Ruta + ']'
FROM dbo.Modulos
WHERE Ruta LIKE '%admin/cron%' OR Ruta LIKE '%reconciliacion%';
