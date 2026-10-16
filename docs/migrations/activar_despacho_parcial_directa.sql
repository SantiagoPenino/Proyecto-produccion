-- =====================================================================
-- ENTREGAS PARCIALES A OTRA ÁREA — habilitar para IMPRESIÓN DIRECTA
-- =====================================================================
-- Las áreas listadas en ConfiguracionGlobal.AREAS_DESPACHO_PARCIAL pueden
-- despachar un SUBCONJUNTO de bultos a OTRA área (no a DEPOSITO) sin exigir
-- que el pedido salga completo. Sirve para pedidos grandes que se mandan por
-- tandas (ej. DIRECTA → Corte). El código (createRemito) lee esta clave; va
-- con el deploy. Las áreas que NO estén en la lista mantienen el candado de
-- "pedido completo" intacto.
--
-- Valor: lista de AreaID separados por coma (ej. 'DIRECTA' o 'DIRECTA,ECOUV').
-- Idempotente.

IF EXISTS (SELECT 1 FROM ConfiguracionGlobal WHERE Clave = 'AREAS_DESPACHO_PARCIAL')
    UPDATE ConfiguracionGlobal SET Valor = 'DIRECTA' WHERE Clave = 'AREAS_DESPACHO_PARCIAL';
ELSE
    INSERT INTO ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('AREAS_DESPACHO_PARCIAL', '', 'DIRECTA');

-- Verificación
SELECT Clave, Valor FROM ConfiguracionGlobal WHERE Clave = 'AREAS_DESPACHO_PARCIAL';
