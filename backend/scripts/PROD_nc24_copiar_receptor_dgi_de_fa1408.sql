/* =====================================================================
   PROD (SecureAppDB) — destrabar la emisión de la NC-24.

   Problema: la NC-24 (doc 11624) nació sin los datos DGI de la factura
   que acredita. Su receptor quedó "CONSUMIDOR FINAL" sin RUT, y una
   Nota de Crédito de e-Factura (CFE 112) exige el RUT válido del
   comprador -> sisnetService.js bloquea el envío antes de tocar SISNET.

   Esto copia el receptor EXACTO de la FA-1408 (doc 11613) a la NC.
   No toca importes, ni cuenta corriente, ni nada más.

   OJO: no alcanza con abrir "Editar" y elegir "El cliente": el cliente
   interno de la factura es la ficha 2089 (Consumidor Final), que no
   tiene RUC. Habría que usar "Un tercero" y tipear el RUT a mano.
   ===================================================================== */

/* ---------- 1) CONTROL: ver el antes ---------- */
SELECT 'NC (antes)' AS Que, DocIdDocumento, DocSerie, DocNumero, CfeEstado,
       DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad, DocIdDocumentoRef
FROM dbo.DocumentosContables WHERE DocIdDocumento = 11624
UNION ALL
SELECT 'Factura origen', DocIdDocumento, DocSerie, DocNumero, CfeEstado,
       DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad, DocIdDocumentoRef
FROM dbo.DocumentosContables WHERE DocIdDocumento = 11613;

/* ---------- 2) UPDATE (descomentar para aplicar) ----------
BEGIN TRAN;

UPDATE nc
SET nc.DocCliNombre    = fa.DocCliNombre,
    nc.DocCliDocumento = fa.DocCliDocumento,
    nc.DocCliDireccion = fa.DocCliDireccion,
    nc.DocCliCiudad    = fa.DocCliCiudad
FROM dbo.DocumentosContables nc
JOIN dbo.DocumentosContables fa ON fa.DocIdDocumento = nc.DocIdDocumentoRef
WHERE nc.DocIdDocumento    = 11624      -- NC-24
  AND nc.DocIdDocumentoRef = 11613      -- FA-1408
  AND nc.CfeEstado <> 'ACEPTADO_DGI';   -- candado: nunca tocar un CFE ya aceptado

-- Verificá que diga 1 fila y que el SELECT de abajo muestre el RUT 211971280019
SELECT @@ROWCOUNT AS FilasActualizadas;
SELECT DocIdDocumento, DocSerie, DocNumero, CfeEstado,
       DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad
FROM dbo.DocumentosContables WHERE DocIdDocumento = 11624;

-- Si está bien:  COMMIT;
-- Si algo no cierra:  ROLLBACK;
------------------------------------------------------------ */
