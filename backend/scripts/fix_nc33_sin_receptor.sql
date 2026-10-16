/*
  NC 33 (DocId 15539) rechazada por DGI: "WsReceptor.getTipoDocRecep()=> Dato invalido
  para comprobante (Nota de Crédito de e-Ticket)".

  Causa: la NC tiene DocCliDocumento = 'RUT - 217506750016' y el sistema (código actual en
  prod) lo manda como comprador. DGI no acepta RUT en una NC de e-Ticket.

  Arreglo puntual, SIN esperar el deploy: se reemplaza por '-' en DocCliDocumento de la NC.
  El código actual usa (DocCliDocumento || RUT de la ficha): con '-' tampoco mira la ficha,
  '-' no tiene dígitos → la NC viaja SIN comprador, igual que el e-Ticket ET 9609 original.
  El tipo sigue siendo 102 (NC de e-Ticket) y la referencia a Serie A N° 53426 no cambia.

  Solo toca la NC 15539, y solo si sigue sin CAE y sin documento cargado.
*/

-- 1) VER ANTES
SELECT d.DocIdDocumento, d.DocTipo, d.DocSerie, d.DocNumero, d.DocTotal, d.CfeEstado,
       d.DocCliDocumento, d.DocIdDocumentoRef, c.CioRuc AS RutFicha,
       r.DocTipo AS RefTipo, r.CfeNumeroOficial AS RefNumeroOficial, r.DocCliDocumento AS RefCliDocumento
FROM dbo.DocumentosContables d
LEFT JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
LEFT JOIN dbo.DocumentosContables r ON r.DocIdDocumento = d.DocIdDocumentoRef
WHERE d.DocIdDocumento = 15539;
-- Esperado: NC, 18000, CfeEstado <> 'ACEPTADO_DGI', DocCliDocumento NULL/vacío,
--           DocIdDocumentoRef = 15526, RefCliDocumento NULL/vacío.

-- 2) APLICAR
BEGIN TRAN;

UPDATE dbo.DocumentosContables
SET DocCliDocumento = '-'
WHERE DocIdDocumento = 15539
  AND DocIdDocumentoRef = 15526
  AND ISNULL(CfeEstado, '') <> 'ACEPTADO_DGI'
  AND DocCliDocumento LIKE '%217506750016%';   -- valor actual: 'RUT - 217506750016  '

SELECT @@ROWCOUNT AS FilasActualizadas;   -- tiene que dar 1

-- Si dio 1: COMMIT.  Si dio otra cosa: ROLLBACK y avisar.
-- COMMIT;
-- ROLLBACK;

/*
  3) DESPUÉS: en la bandeja CFE abrir la VISTA PREVIA de la NC 33 y confirmar que NO
     aparece receptor/RUT y que dice NC de e-Ticket (102). Recién ahí reenviar.

  Para volver atrás (solo si no se envió):
  UPDATE dbo.DocumentosContables SET DocCliDocumento = 'RUT - 217506750016  ' WHERE DocIdDocumento = 15539;
*/
