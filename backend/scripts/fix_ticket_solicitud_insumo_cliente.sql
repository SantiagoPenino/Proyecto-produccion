-- Tickets de "Solicitudes de insumo" creados con Clientes.CliIdCliente en vez del CodCliente
-- (el portal filtra Tickets.CliIdCliente = CodCliente del usuario web): el cliente no los veía.
-- Se corrigen pasando al CodCliente de la orden madre.

-- 1) Ver qué se va a tocar
SELECT t.TicIdTicket, t.TicAsunto, t.CliIdCliente AS CliActual, c.CodCliente AS CliCorrecto, c.Nombre
FROM Tickets t
JOIN Ordenes o ON o.OrdenID = t.OrdIdOrden
JOIN Clientes c ON c.CliIdCliente = o.CliIdCliente
WHERE t.TicAsunto LIKE 'Insumo dañado en %: necesitamos tu decisión'
  AND t.CliIdCliente = o.CliIdCliente
  AND TRY_CAST(LTRIM(RTRIM(c.CodCliente)) AS INT) IS NOT NULL
  AND t.CliIdCliente <> TRY_CAST(LTRIM(RTRIM(c.CodCliente)) AS INT);

-- 2) Corregir
BEGIN TRAN;
UPDATE t SET t.CliIdCliente = TRY_CAST(LTRIM(RTRIM(c.CodCliente)) AS INT)
FROM Tickets t
JOIN Ordenes o ON o.OrdenID = t.OrdIdOrden
JOIN Clientes c ON c.CliIdCliente = o.CliIdCliente
WHERE t.TicAsunto LIKE 'Insumo dañado en %: necesitamos tu decisión'
  AND t.CliIdCliente = o.CliIdCliente
  AND TRY_CAST(LTRIM(RTRIM(c.CodCliente)) AS INT) IS NOT NULL
  AND t.CliIdCliente <> TRY_CAST(LTRIM(RTRIM(c.CodCliente)) AS INT);
-- Revisar filas afectadas y después:
-- COMMIT;   (o ROLLBACK;)
