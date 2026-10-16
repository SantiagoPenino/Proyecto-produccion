-- =====================================================================
-- MÍNIMO DE METROS PARA CONFIRMAR UN PEDIDO DE IMPRESIÓN DIRECTA
-- =====================================================================
-- El form del portal valida, al confirmar un pedido de Directa, que el LARGO TOTAL
-- (suma de alto × copias; raport no multiplica) sea >= este mínimo. Si el valor es
-- 0 o vacío, NO valida nada. Editable desde Configuración → Configuración General.
-- El backend lo expone en /web-orders/area-mapping (portalConfig.directaMinimoMetros).
--
-- Idempotente. Ajustá el Valor al mínimo deseado (el negocio pidió 20).

IF EXISTS (SELECT 1 FROM ConfiguracionGlobal WHERE Clave = 'DIRECTA_MINIMO_METROS')
    UPDATE ConfiguracionGlobal SET Valor = '20' WHERE Clave = 'DIRECTA_MINIMO_METROS';
ELSE
    INSERT INTO ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('DIRECTA_MINIMO_METROS', 'ADMIN', '20');

-- Verificación
SELECT Clave, Valor FROM ConfiguracionGlobal WHERE Clave = 'DIRECTA_MINIMO_METROS';
