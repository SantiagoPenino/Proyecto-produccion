-- Completa la configuración del área PRO (orden madre de "comprar y personalizar")
-- para que el check-in del remito (receiveDispatch, bloque "AUTO-FULFILL REQUIREMENT
-- ON CHECK-IN") cumpla solo el requisito bloqueante "PRENDA" de Bordado/Estampado
-- cuando el bulto llega físicamente a esa área — mismo mecanismo que ya usan
-- EMB, EST y TWT (todas con Entrega='PRENDAS').
-- Cambio puramente aditivo/de configuración, sin riesgo — PRO es un área nueva sin
-- uso previo.

UPDATE Areas SET Entrega = 'PRENDAS' WHERE AreaID = 'PRO';

SELECT AreaID, Entrega FROM Areas WHERE AreaID IN ('PRO', 'EMB', 'EST', 'TWT');
