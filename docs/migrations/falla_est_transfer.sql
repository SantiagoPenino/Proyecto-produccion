-- =====================================================================
-- Falla en Estampado / PRO: también se pueden reponer el DTF y el TPU (02-oct-2026)
--
-- El código ya trae EST en el default de AREAS_FALLA_PROPIA_REQUIERE_CADENA. Este script solo
-- hace falta si en la base esas claves EXISTEN con otro valor (el valor guardado le gana al
-- default del código). Agrega EST (y PRO) sin borrar lo que ya haya. Se puede correr más de una vez.
--
-- Antes de correrlo en producción, mirar cómo está:
--   SELECT Clave, Valor FROM ConfiguracionGlobal
--   WHERE Clave IN ('AREAS_CADENA_REPOSICION','AREAS_FALLA_PROPIA_REQUIERE_CADENA');
-- =====================================================================
UPDATE ConfiguracionGlobal
SET Valor = LTRIM(RTRIM(Valor)) + CASE WHEN LTRIM(RTRIM(ISNULL(Valor, ''))) = '' THEN 'EST' ELSE ',EST' END
WHERE Clave IN ('AREAS_CADENA_REPOSICION', 'AREAS_FALLA_PROPIA_REQUIERE_CADENA')
  AND ',' + REPLACE(UPPER(ISNULL(Valor, '')), ' ', '') + ',' NOT LIKE '%,EST,%';

UPDATE ConfiguracionGlobal
SET Valor = LTRIM(RTRIM(Valor)) + CASE WHEN LTRIM(RTRIM(ISNULL(Valor, ''))) = '' THEN 'PRO' ELSE ',PRO' END
WHERE Clave IN ('AREAS_CADENA_REPOSICION', 'AREAS_FALLA_PROPIA_REQUIERE_CADENA')
  AND ',' + REPLACE(UPPER(ISNULL(Valor, '')), ' ', '') + ',' NOT LIKE '%,PRO,%';

SELECT Clave, Valor FROM ConfiguracionGlobal
WHERE Clave IN ('AREAS_CADENA_REPOSICION', 'AREAS_FALLA_PROPIA_REQUIERE_CADENA');
