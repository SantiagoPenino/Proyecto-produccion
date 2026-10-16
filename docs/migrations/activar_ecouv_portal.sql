-- =====================================================================
-- ACTIVAR ECOUV (IMPRESIÓN GRAN FORMATO) EN EL PORTAL DEL CLIENTE
-- =====================================================================
-- Contexto: la tarjeta "EcoUV" del portal abría un Google Form externo.
-- El front ahora navega al form interno /portal/order/ecouv; este script
-- enciende la visibilidad de la tarjeta (mismo patrón que Directa 3.20:
-- ver activar_directa_portal.sql).
--
-- Las órdenes creadas quedan con AreaID = 'ECOUV' y prefijo EUV-
-- (ConfigMapeoERP: AreaID_Interno='ECOUV' / CodigoERP='1.3' / CodOrden='EUV').
-- Materiales del form: StockArt '1.1.3.1' (Impresion Gran Formato, ~66
-- artículos: lonas, vinilos, canvas...) y '1.1.3.2' (Materiales Extra Gran
-- Formato, terminaciones: ojales, roll up, soldadura...) — ya existen.

UPDATE ConfigMapeoERP
SET VisibleWeb = 1
WHERE CodOrden = 'EUV';

-- Verificación
SELECT AreaID_Interno, CodigoERP, CodOrden, NombreReferencia, VisibleWeb
FROM ConfigMapeoERP
WHERE CodOrden = 'EUV';

-- ---------------------------------------------------------------------
-- Verificar tiempos de entrega (en local ya existen: Normal 12h / Urgente
-- 12h). Si en producción no hay filas, descomentar el INSERT y ajustar.
SELECT * FROM ConfiguracionTiemposEntrega WHERE AreaID = 'ECOUV';
-- INSERT INTO ConfiguracionTiemposEntrega (AreaID, Prioridad, Horas, Texto)
-- VALUES ('ECOUV', 'Normal', 12, NULL), ('ECOUV', 'Urgente', 12, NULL);

-- ---------------------------------------------------------------------
-- Verificar materiales del form (deben devolver filas con mostrar=1):
SELECT CodStock, Articulo FROM StockArt WHERE CodStock IN ('1.1.3.1','1.1.3.2');
SELECT COUNT(*) AS MaterialesPrincipales FROM articulos WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.1' AND ISNULL(mostrar,1) = 1;
SELECT COUNT(*) AS MaterialesExtra FROM articulos WHERE LTRIM(RTRIM(CodStock)) = '1.1.3.2' AND ISNULL(mostrar,1) = 1;
