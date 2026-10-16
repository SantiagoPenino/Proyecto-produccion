-- =====================================================================
-- ConfiguracionGlobal — CREAR LAS 2 CLAVES QUE FALTAN
-- =====================================================================
-- Verificado el 28-07-2026 contra la salva reciente: NINGUNA de las dos
-- existe en la tabla (26 claves, ninguna es estas).
--
-- Correr IGUAL en PRODUCCIÓN y en LOCAL. Idempotente: si la clave ya está,
-- no la pisa (solo la crea si falta), así no se pierde un valor ya seteado.
--
-- Tabla: Clave varchar(50) NOT NULL | AreaID nchar(10) NOT NULL | Valor nvarchar(MAX)
-- AreaID = 'ADMIN' porque es la convención de las claves globales de esta tabla.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) AREAS_DESPACHO_PARCIAL  →  'DIRECTA'
-- ---------------------------------------------------------------------
-- Las áreas de esta lista pueden despachar un SUBCONJUNTO de bultos a OTRA área
-- (no a DEPOSITO) sin exigir que el pedido salga completo. Hoy, al no existir la
-- clave, el candado de "pedido completo" aplica a TODAS las áreas — o sea que la
-- entrega parcial de DIRECTA nunca se habilitó. Lo lee createRemito (logisticsController).
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AREAS_DESPACHO_PARCIAL')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor)
    VALUES ('AREAS_DESPACHO_PARCIAL', 'ADMIN', 'DIRECTA');

-- ---------------------------------------------------------------------
-- 2) AREAS_NOMBRE_ARCHIVO_NUEVO  →  '' (SE CREA APAGADA)
-- ---------------------------------------------------------------------
-- Formato nuevo del nombre de los archivos de impresión:
--     {MATERIAL}-{ORDEN}_{CLIENTE}_Arch {i} de {n} (x{copias}).ext
--     ej: Bandera (1,60)-SUB-9408_PROP851uy_Arch 1 de 1 (x1).pdf
-- En tela de cliente al material se le agrega el PRE de la recepción:
--     ej: Tela Cliente (Minimo 5mts) PRE-5-1-SUB-9410_PROP851uy_Arch 2 de 3 (x5).pdf
--
-- Se crea VACÍA a propósito = APAGADO: todas las áreas siguen con el nombre de
-- siempre ({ORDEN}_{CLIENTE}_{TRABAJO}_Archivo {i} de {n}). La fila existe solo
-- para poder prenderla después desde Configuración → Configuración General.
IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'AREAS_NOMBRE_ARCHIVO_NUEVO')
    INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor)
    VALUES ('AREAS_NOMBRE_ARCHIVO_NUEVO', 'ADMIN', '');

-- ---------------------------------------------------------------------
-- Verificación
-- ---------------------------------------------------------------------
SELECT Clave, LTRIM(RTRIM(AreaID)) AS AreaID, Valor
FROM dbo.ConfiguracionGlobal
WHERE Clave IN ('AREAS_DESPACHO_PARCIAL', 'AREAS_NOMBRE_ARCHIVO_NUEVO')
ORDER BY Clave;

-- =====================================================================
-- CUANDO QUIERAS PRENDER EL NOMBRE NUEVO EN SUBLIMACIÓN (no antes del deploy):
--   UPDATE dbo.ConfiguracionGlobal SET Valor = 'SB'
--   WHERE Clave = 'AREAS_NOMBRE_ARCHIVO_NUEVO';
--
-- Y para apagarlo de nuevo:
--   UPDATE dbo.ConfiguracionGlobal SET Valor = ''
--   WHERE Clave = 'AREAS_NOMBRE_ARCHIVO_NUEVO';
--
-- El backend relee la clave solo cada 1 minuto: no hay que reiniciar.
-- =====================================================================
