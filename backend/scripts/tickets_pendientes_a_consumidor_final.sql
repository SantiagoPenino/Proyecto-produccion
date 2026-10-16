/*
  tickets_pendientes_a_consumidor_final.sql
  ---------------------------------------------------------------------------
  Deja en CONSUMIDOR FINAL los e-Tickets PENDIENTES (aún no enviados a DGI) que
  nacieron con el RUT del cliente guardado en el documento. Al vaciar el receptor
  del snapshot, al emitir salen como 101 e-Ticket SIN receptor (consumidor final).

  NO toca:
    - e-Facturas (necesitan el RUT).
    - Notas de Crédito/Débito.
    - Documentos ya enviados a DGI (CfeEstado <> 'PENDIENTE').
    - La ficha del cliente (Clientes) — solo el snapshot del documento.

  Es una decisión de negocio: si algún ticket de estos SÍ debía ir identificado
  (empresa que pidió factura / sobre el umbral DGI), NO lo incluyas — revisalo
  a mano en su lugar. Por eso primero está el SELECT de control.

  Reversible en la práctica: si hace falta identificar uno, se reabre en el modal
  y se elige "El cliente".
*/

-- 1) CONTROL: ver exactamente qué se va a tocar ANTES de actualizar.
SELECT
    d.DocIdDocumento,
    d.DocSerie + '-' + CAST(d.DocNumero AS VARCHAR(20)) AS Numero,
    d.DocTipo,
    d.DocCliDocumento AS RutQueSeVaAVaciar,
    d.DocCliNombre    AS NombreQueSeVaAVaciar,
    d.DocTotal, d.MonIdMoneda, d.DocFechaEmision,
    c.Nombre AS ClienteInterno
FROM dbo.DocumentosContables d
LEFT JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
WHERE d.CfeEstado = 'PENDIENTE'
  AND UPPER(d.DocTipo) LIKE '%TICKET%'
  AND UPPER(d.DocTipo) NOT LIKE '%NOTA%'
  AND LTRIM(RTRIM(ISNULL(d.DocCliDocumento, ''))) <> ''
ORDER BY d.DocFechaEmision DESC;

/* --------------------------------------------------------------------------
   2) APLICAR: descomentá el UPDATE cuando el SELECT de arriba sea el correcto.
      (Podés acotar a documentos puntuales agregando: AND d.DocIdDocumento IN (...))
--------------------------------------------------------------------------- */
-- BEGIN TRAN;  -- opcional, para revisar @@ROWCOUNT antes de COMMIT
--
-- UPDATE d
--    SET d.DocCliDocumento = NULL,
--        d.DocCliNombre    = NULL,
--        d.DocCliDireccion = NULL,
--        d.DocCliCiudad    = NULL
--   FROM dbo.DocumentosContables d
--  WHERE d.CfeEstado = 'PENDIENTE'
--    AND UPPER(d.DocTipo) LIKE '%TICKET%'
--    AND UPPER(d.DocTipo) NOT LIKE '%NOTA%'
--    AND LTRIM(RTRIM(ISNULL(d.DocCliDocumento, ''))) <> '';
--
-- PRINT 'Tickets pasados a consumidor final: ' + CAST(@@ROWCOUNT AS VARCHAR(10));
-- COMMIT;  -- o ROLLBACK si algo no cuadra
