/* ============================================================================
   ARREGLAR el receptor de FA-297 en PRODUCCIÓN (sin deploy)
   ----------------------------------------------------------------------------
   PROBLEMA: prod todavía NO tiene el fix "facturar a tercero", así que arma el
   receptor con la FICHA del cliente interno (Federica, CI 51120297) e ignora el
   RUT del tercero que está en DocCliDocumento (Pedeciba, 214894070013). Por eso
   sale e-Ticket 101 en vez de e-Factura 111.

   SOLUCIÓN sin deploy: apuntar el documento al cliente que TIENE el RUT en su
   ficha (Pedeciba), para que la ficha que lee el código viejo ya sea el RUT.

   OJO: esto también atribuye la CUENTA/cobro a ese cliente. Si necesitás que la
   cuenta quede en Federica y el CFE en Pedeciba, eso SOLO se logra deployando el
   fix — en la base no se pueden separar con el código viejo.

   Corré primero los SELECT (solo lectura). El UPDATE está comentado al final.
   ============================================================================ */

SET NOCOUNT ON;

DECLARE @DocId INT = 5293;   -- FA-297 en prod (del diagnóstico que corriste)

/* ---- 1) Estado actual del documento ---- */
SELECT 'DOCUMENTO' AS Info, d.DocIdDocumento, d.DocSerie + '-' + d.DocNumero AS Doc, d.DocTipo, d.CfeEstado,
       d.CliIdCliente AS ClienteInternoActual, c.Nombre AS FichaNombre, c.CioRuc AS FichaDoc,
       d.DocCliNombre AS TerceroNombre, d.DocCliDocumento AS TerceroDoc
FROM dbo.DocumentosContables d LEFT JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
WHERE d.DocIdDocumento = @DocId;

/* ---- 2) ¿Qué cliente tiene el RUT 214894070013 en su ficha? ---- */
SELECT 'CLIENTES CON ESE RUT' AS Info, CliIdCliente, Nombre, CioRuc, IDCliente
FROM dbo.Clientes
WHERE REPLACE(REPLACE(REPLACE(ISNULL(CioRuc,''),'.',''),'-',''),' ','') = '214894070013'
   OR Nombre LIKE '%Pedeciba%';

/* ============================================================================
   3) UPDATE — descomentar SOLO cuando el SELECT (2) te confirme el CliIdCliente
      del cliente que tiene el RUT 214894070013. Poné ese id en @ClientePedeciba.
   ============================================================================ */
/*
DECLARE @ClientePedeciba INT = 8723;   -- <-- confirmar con el SELECT (2)

-- Verificación dura: ese cliente DEBE tener el RUT de 12 dígitos, si no, aborta
IF NOT EXISTS (SELECT 1 FROM dbo.Clientes
               WHERE CliIdCliente = @ClientePedeciba
                 AND REPLACE(REPLACE(REPLACE(ISNULL(CioRuc,''),'.',''),'-',''),' ','') = '214894070013')
BEGIN
    RAISERROR('El cliente indicado no tiene el RUT 214894070013. Revisá el id.', 16, 1);
    RETURN;
END

BEGIN TRANSACTION;
    UPDATE dbo.DocumentosContables
       SET CliIdCliente = @ClientePedeciba
     WHERE DocIdDocumento = @DocId;

    -- Verás cómo queda; si está OK -> COMMIT, si no -> ROLLBACK
    SELECT 'DESPUES' AS Info, d.DocIdDocumento, d.CliIdCliente, c.Nombre AS FichaNombre, c.CioRuc AS FichaDoc
    FROM dbo.DocumentosContables d JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
    WHERE d.DocIdDocumento = @DocId;
-- COMMIT TRANSACTION;
-- ROLLBACK TRANSACTION;
*/
