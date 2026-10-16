-- Corrección puntual: la cadena de ProximoServicio del pedido de prueba NoDocERP=10994
-- quedó mal (PRO en el medio de la cadena en vez de primero) porque se creó con una
-- versión del frontend anterior al fix del orden de servicios. Solo afecta datos de
-- prueba de este pedido puntual — no es una migración de esquema.
-- Correr contra LOCAL solamente.

BEGIN TRAN;

UPDATE Ordenes SET ProximoServicio = 'EMB'      WHERE OrdenID = 11432; -- PRO-10994  -> primera personalización
UPDATE Ordenes SET ProximoServicio = 'DF'       WHERE OrdenID = 11431; -- BOR-10994  -> DTF
UPDATE Ordenes SET ProximoServicio = 'EST'      WHERE OrdenID = 11430; -- TPU-10994  -> Estampado
UPDATE Ordenes SET ProximoServicio = 'DEPOSITO' WHERE OrdenID = 11433; -- EST-10994  -> Depósito (ya estaba, se reafirma)
-- DTF-10994 (OrdenID 11429) ya tenía ProximoServicio='TPU', correcto, no se toca.

SELECT OrdenID, CodigoOrden, AreaID, ProximoServicio FROM Ordenes WHERE NoDocERP = '10994' ORDER BY OrdenID ASC;

COMMIT TRAN;
