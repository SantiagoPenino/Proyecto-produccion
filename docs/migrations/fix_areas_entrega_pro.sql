-- =====================================================================
-- Areas.Entrega para 'PRO'
-- =====================================================================
-- Contexto: en "Comprar y Personalizar", la orden PRO es la que carga
-- físicamente la prenda comprada y la despacha a la primera área de
-- decoración (EMB/EST/etc.) cuando no hay Corte/Costura de por medio.
-- El auto-cumplimiento de requisitos al recibir un bulto (receiveDispatch,
-- logisticsController.js) resuelve QUÉ requisito satisface la entrega
-- leyendo Areas.Entrega del área de ORIGEN del remito — pero para 'PRO'
-- esta columna nunca se cargó (quedó NULL). Resultado: cuando PRO
-- despacha la prenda directo a Estampado, el requisito bloqueante
-- "PRENDA" (Prendas a Estampar) NUNCA se marca cumplido, aunque el
-- bulto ya esté físicamente recibido — la orden queda trabada para
-- siempre en la Bandeja.

UPDATE dbo.Areas SET Entrega = 'PRENDAS' WHERE AreaID = 'PRO';

-- Verificación
SELECT AreaID, Entrega FROM dbo.Areas WHERE AreaID = 'PRO';
