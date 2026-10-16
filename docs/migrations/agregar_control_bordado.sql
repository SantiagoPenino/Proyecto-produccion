-- Control de Bordado (EMB): contador de prendas controladas, separado del contador de
-- prendas bordadas (Ordenes.CantidadTerminada). El flujo pasa a tener dos fases reales:
--   Bandeja (trabajo)  -> "Finalizar" mueve la orden a 'Control y Calidad' (sin generar etiqueta).
--   Control            -> cuenta CantidadControlada y, al aprobar, genera N bultos/etiquetas
--                          (cantidad elegida por quien controla) y pasa la orden a 'Pronto'.
ALTER TABLE dbo.Ordenes ADD CantidadControlada FLOAT NULL;
