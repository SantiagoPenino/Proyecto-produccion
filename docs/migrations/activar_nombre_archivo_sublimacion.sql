-- =====================================================================
-- NOMBRE NUEVO DE LOS ARCHIVOS DE IMPRESIÓN — habilitar para SUBLIMACIÓN
-- =====================================================================
-- Las áreas listadas en ConfiguracionGlobal.AREAS_NOMBRE_ARCHIVO_NUEVO generan
-- los archivos de impresión con el formato:
--     {MATERIAL}-{ORDEN}_{CLIENTE}_Arch {i} de {n} (x{copias}).ext
--     ej: Bandera (1,60)-SUB-9408_PROP851uy_Arch 1 de 1 (x1).pdf
-- En tela de cliente al material se le agrega el PRE de la recepción:
--     ej: Tela Cliente (Minimo 5mts) PRE-5-1-SUB-9410_PROP851uy_Arch 2 de 3 (x5).pdf
--
-- Las áreas que NO estén en la lista siguen con el nombre de siempre
-- ({ORDEN}_{CLIENTE}_{TRABAJO}_Archivo {i} de {n}), intacto.
-- El código lee esta clave (backend/utils/nombreArchivoOrden.js); va con el deploy.
--
-- Valor: lista de AreaID separados por coma (ej. 'SB' o 'SB,DF').
-- Valor vacío ('') = APAGADO, todo vuelve al nombre de siempre.
-- El backend relee la clave sola cada 1 minuto (no hace falta reiniciar).
-- Idempotente.

IF EXISTS (SELECT 1 FROM ConfiguracionGlobal WHERE Clave = 'AREAS_NOMBRE_ARCHIVO_NUEVO')
    UPDATE ConfiguracionGlobal SET Valor = 'SB' WHERE Clave = 'AREAS_NOMBRE_ARCHIVO_NUEVO';
ELSE
    INSERT INTO ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AREAS_NOMBRE_ARCHIVO_NUEVO', 'ADMIN', 'SB');

-- Verificación
SELECT Clave, Valor FROM ConfiguracionGlobal WHERE Clave = 'AREAS_NOMBRE_ARCHIVO_NUEVO';

-- Para APAGARLO más adelante (sin borrar la fila):
-- UPDATE ConfiguracionGlobal SET Valor = '' WHERE Clave = 'AREAS_NOMBRE_ARCHIVO_NUEVO';
