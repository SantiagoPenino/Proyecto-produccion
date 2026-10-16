-- =====================================================================
-- ACTIVAR CORTE (TWC) EN EL PORTAL DEL CLIENTE
-- =====================================================================
-- Contexto: la tarjeta "Corte" del portal estaba oculta
-- (ConfigMapeoERP.VisibleWeb = 0 para CodOrden 'COR') y además abría un
-- Google Form externo. El front ahora navega al form interno
-- /portal/order/corte; este script enciende la visibilidad de la tarjeta
-- (mismo patrón que Directa 3.20 y EcoUV: ver activar_directa_portal.sql
-- y activar_ecouv_portal.sql).
--
-- Las órdenes creadas quedan con AreaID = 'TWC' y prefijo COR-
-- (ConfigMapeoERP: AreaID_Interno='TWC' / CodigoERP='1.6' / CodOrden='COR').
-- El form de corte no exige materiales de StockArt (materialMode 'fixed',
-- workflow de corte/tizada propio) ni archivo de arte (mide por unidad).

UPDATE ConfigMapeoERP
SET VisibleWeb = 1
WHERE CodOrden = 'COR';

-- Verificación
SELECT AreaID_Interno, CodigoERP, CodOrden, NombreReferencia, VisibleWeb
FROM ConfigMapeoERP
WHERE CodOrden = 'COR';

-- ---------------------------------------------------------------------
-- OPCIONAL: tiempos de entrega que se muestran junto a la prioridad en el
-- form (hoy no hay fila para TWC ni en local ni habría en prod, y sin fila
-- simplemente no se muestra el texto). Ajustar horas y texto según lo que
-- defina el negocio antes de descomentar.
-- INSERT INTO ConfiguracionTiemposEntrega (AreaID, Prioridad, Horas, Texto)
-- VALUES ('TWC', 'Normal', 72, NULL), ('TWC', 'Urgente', 24, NULL);
