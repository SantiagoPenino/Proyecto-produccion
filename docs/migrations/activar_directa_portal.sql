-- =====================================================================
-- ACTIVAR IMPRESIÓN DIRECTA 3.20 EN EL PORTAL DEL CLIENTE
-- =====================================================================
-- Contexto: la tarjeta "Directa 3.20m" del portal estaba oculta
-- (ConfigMapeoERP.VisibleWeb = 0 para CodOrden 'DIR') y además abría un
-- Google Form externo. El front ahora navega al form interno
-- /portal/order/directa_320; este script enciende la visibilidad.
--
-- Las órdenes creadas quedan con AreaID = 'DIRECTA' y prefijo DIR-
-- (ambos ya configurados: Areas.AreaID='DIRECTA' UM='M',
--  ConfigMapeoERP AreaID_Interno='DIRECTA' / CodigoERP='1.11' / CodOrden='DIR').
-- Materiales del form: StockArt CodStock '1.1.11.1' (Blackout doble cara 1560,
-- Tela de bandera 1558, Bandera Mesh 161) — ya existen.

UPDATE ConfigMapeoERP
SET VisibleWeb = 1
WHERE CodOrden = 'DIR';

-- Verificación
SELECT AreaID_Interno, CodigoERP, CodOrden, NombreReferencia, VisibleWeb
FROM ConfigMapeoERP
WHERE CodOrden = 'DIR';

-- ---------------------------------------------------------------------
-- OPCIONAL: tiempos de entrega que se muestran junto a la prioridad en el
-- form (hoy no hay fila para DIRECTA y no se muestra nada). Ajustar horas
-- y texto según lo que defina el negocio antes de descomentar.
-- INSERT INTO ConfiguracionTiemposEntrega (AreaID, Prioridad, Horas, Texto)
-- VALUES ('DIRECTA', 'normal', 72, NULL), ('DIRECTA', 'urgente', 24, NULL);
