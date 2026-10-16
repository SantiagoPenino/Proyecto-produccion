-- Estampado (EST) ya tenía "Prendas a Estampar" (PRENDA, alimentado desde Bordado) y
-- "DTF a Estampar" (DTF, alimentado desde DTF) pero faltaba el equivalente para TPU
-- (Areas.Entrega='TPU' → coincide directo con CodigoRequisito LIKE '%TPU%', sin necesitar
-- normalización especial como la que tiene 'DTF'->'DISENO').
INSERT INTO dbo.ConfigRequisitosProduccion (AreaID, CodigoRequisito, Descripcion, EsBloqueante)
VALUES ('EST', 'TPU', 'TPU a Estampar', 1);
