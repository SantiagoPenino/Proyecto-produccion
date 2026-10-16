/* =====================================================================
   SOLO LECTURA — no modifica nada. Correr en PRODUCCIÓN (SecureAppDB).
   Objetivo: (1) a qué RUC salió realmente la FA-1408 / Serie A 29250
             (2) por qué la NC-24 no se puede emitir a DGI
   ===================================================================== */

/* 1) La factura: receptor que VIAJÓ a DGI (DocCli*) vs ficha interna (Cli*) */
SELECT
    d.DocIdDocumento,
    d.DocTipo, d.DocSerie, d.DocNumero,
    d.DocEstado, d.CfeEstado, d.CfeTipoCFE, d.CfeNumeroOficial,
    d.DocTotal, d.MonIdMoneda, d.DocPagado, d.DocFechaEmision,
    -- Receptor REAL del CFE (lo que se le mandó a la DGI):
    d.DocCliNombre        AS DGI_RazonSocial,
    d.DocCliDocumento     AS DGI_RUT,
    d.DocCliDireccion     AS DGI_Direccion,
    d.DocCliCiudad        AS DGI_Ciudad,
    d.DocCliNombreFantasia,
    -- Cliente INTERNO (cuenta corriente):
    d.CliIdCliente,
    c.IDCliente           AS FichaCodigo,
    c.Nombre              AS FichaNombre,
    c.CioRuc              AS FichaRUC
FROM dbo.DocumentosContables d
LEFT JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
WHERE d.DocNumero IN ('1408','01408') AND d.DocTipo LIKE 'E-Factura%';

/* 2) La nota de crédito NC-24: mismo cruce + a qué documento referencia */
SELECT
    n.DocIdDocumento,
    n.DocTipo, n.DocSerie, n.DocNumero, n.CfeEstado, n.CfeTipoCFE,
    n.DocTotal, n.MonIdMoneda, n.DocMotivoRef,
    n.DocCliNombre     AS NC_DGI_RazonSocial,
    n.DocCliDocumento  AS NC_DGI_RUT,        -- <<< si viene NULL/vacío, ahí está el bloqueo
    n.CliIdCliente,
    c.IDCliente        AS NC_FichaCodigo,
    c.CioRuc           AS NC_FichaRUC,
    n.DocIdDocumentoRef,
    r.DocTipo          AS Ref_DocTipo,
    r.DocSerie         AS Ref_Serie,
    r.DocNumero        AS Ref_Numero,
    r.CfeTipoCFE       AS Ref_CfeTipoCFE,
    r.CfeNumeroOficial AS Ref_NumeroOficial
FROM dbo.DocumentosContables n
LEFT JOIN dbo.Clientes c ON c.CliIdCliente = n.CliIdCliente
LEFT JOIN dbo.DocumentosContables r ON r.DocIdDocumento = n.DocIdDocumentoRef
WHERE n.DocNumero IN ('24','024','0024') AND n.DocTipo LIKE '%Nota De Cr%';

/* 3) ¿La ficha 2089 sigue siendo el Consumidor Final genérico? */
SELECT CliIdCliente, IDCliente, Nombre, NombreFantasia, CioRuc
FROM dbo.Clientes WHERE CliIdCliente = 2089;

/* 4) ¿La venta a crédito de la FA-1408 quedó registrada como deuda?
      (con CliIdCliente = 2089 el sistema NO abre cuenta corriente) */
SELECT dd.*
FROM dbo.DeudaDocumento dd
WHERE dd.DocIdDocumento IN (
    SELECT DocIdDocumento FROM dbo.DocumentosContables
    WHERE DocNumero IN ('1408','01408') AND DocTipo LIKE 'E-Factura%');
