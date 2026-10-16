-- "Bobinas" fantasma de 100 m creadas al recibir en el área un PRE de PAQUETE DE PRENDAS
-- (el check-in trataba todo PRE- como tela). Aparecían en Mis Recursos como tela "Bordado"
-- y en el form de Corte como tela del cliente.
-- Antes de borrar: cancelar las órdenes que las usaron (en LOCAL: COR-20951, prueba).

-- 1) Ver
SELECT ib.BobinaID, ib.CodigoEtiqueta, ib.Referencia, r.Tipo, ib.MetrosIniciales, ib.MetrosRestantes, ib.Estado,
       (SELECT STRING_AGG(o.CodigoOrden + ' [' + ISNULL(o.Estado,'') + ']', ', ') FROM Ordenes o WHERE o.BobinaTelaID = ib.BobinaID) AS OrdenesQueLaUsan
FROM InventarioBobinas ib
JOIN Recepciones r ON r.Codigo = ib.Referencia OR ib.Referencia LIKE r.Codigo + '-%'
WHERE r.Tipo = 'PAQUETE DE PRENDAS';

-- 2) Borrar (solo las que ninguna orden viva usa)
BEGIN TRAN;
DECLARE @b TABLE (BobinaID INT);
INSERT INTO @b
SELECT ib.BobinaID
FROM InventarioBobinas ib
JOIN Recepciones r ON r.Codigo = ib.Referencia OR ib.Referencia LIKE r.Codigo + '-%'
WHERE r.Tipo = 'PAQUETE DE PRENDAS'
  AND NOT EXISTS (SELECT 1 FROM Ordenes o WHERE o.BobinaTelaID = ib.BobinaID AND ISNULL(o.Estado,'') <> 'Cancelado');

UPDATE Ordenes SET BobinaTelaID = NULL WHERE BobinaTelaID IN (SELECT BobinaID FROM @b);
DELETE FROM MovimientosInsumos WHERE BobinaID IN (SELECT BobinaID FROM @b);
DELETE FROM InventarioBobinas  WHERE BobinaID IN (SELECT BobinaID FROM @b);
SELECT COUNT(*) AS BobinasBorradas FROM @b;
-- COMMIT;   (o ROLLBACK;)
