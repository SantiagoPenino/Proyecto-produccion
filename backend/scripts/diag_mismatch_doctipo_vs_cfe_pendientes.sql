/*
  diag_mismatch_doctipo_vs_cfe_pendientes.sql   (SOLO LECTURA)
  ---------------------------------------------------------------------------
  Detecta documentos AÚN NO ENVIADOS A DGI (CfeEstado = 'PENDIENTE') donde el
  documento que eligió el operador (DocTipo) NO coincide con el CFE que
  realmente se emitiría según la lógica de sisnetService.resolverTipoCFE:

    VENTA:  el código lo decide el RUT del receptor (12 dígitos = e-Factura 111,
            si no e-Ticket 101).
    NOTA:   la familia (e-Factura/e-Ticket) la decide el documento REFERENCIADO,
            no el RUT.

  Fuente del RUT (igual que el back): DocCliDocumento del propio documento y,
  si está vacío, CioRuc de la ficha del cliente.

  Casos que marca:
    A) e-Ticket con RUT de 12 díg  -> DGI lo eleva a e-FACTURA 111 (el operador
       creyó que emitía ticket).
    B) e-Factura SIN RUT válido    -> DGI la RECHAZA (no emitible como está).
    C) Nota cuya familia (por su DocTipo) NO coincide con la del documento que
       corrige -> DGI la rechaza.
    D) Nota sin documento referenciado.

  NOTA: la familia del documento referenciado se APROXIMA por su RUT (misma
  regla que resolverTipoCFE_LEGACY). Es un diagnóstico para revisar, no una
  acción. No modifica nada.
*/

;WITH Base AS (
    SELECT
        d.DocIdDocumento,
        d.DocTipo,
        d.DocSerie, d.DocNumero,
        d.CfeEstado,
        d.DocTotal, d.MonIdMoneda,
        d.DocFechaEmision,
        d.CliIdCliente,
        d.DocIdDocumentoRef,
        d.DocCliNombre,
        c.Nombre AS FichaNombre,
        UPPER(d.DocTipo) AS T,
        -- RUT del receptor de ESTE documento (doc primero, luego ficha)
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            COALESCE(NULLIF(LTRIM(RTRIM(d.DocCliDocumento)),''), c.CioRuc, '')
        ,'.',''),'-',''),' ',''),CHAR(9),''),CHAR(160),'') AS RutDig,
        -- RUT del documento REFERENCIADO (para notas)
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            COALESCE(NULLIF(LTRIM(RTRIM(rd.DocCliDocumento)),''), rc.CioRuc, '')
        ,'.',''),'-',''),' ',''),CHAR(9),''),CHAR(160),'') AS RutRefDig,
        rd.DocTipo AS RefDocTipo,
        rd.DocSerie AS RefSerie, rd.DocNumero AS RefNumero
    FROM dbo.DocumentosContables d
    LEFT JOIN dbo.Clientes c  ON c.CliIdCliente = d.CliIdCliente
    LEFT JOIN dbo.DocumentosContables rd ON rd.DocIdDocumento = d.DocIdDocumentoRef
    LEFT JOIN dbo.Clientes rc ON rc.CliIdCliente = rd.CliIdCliente
    WHERE d.CfeEstado = 'PENDIENTE'
      AND (UPPER(d.DocTipo) LIKE '%TICKET%' OR UPPER(d.DocTipo) LIKE '%FACTURA%')
),
Clasif AS (
    SELECT *,
        CASE WHEN T LIKE '%NOTA DE CR%' THEN 'NC'
             WHEN T LIKE '%NOTA DE D%'  THEN 'ND'
             ELSE 'VENTA' END AS Clase,
        -- Familia que ELIGIÓ el operador, según el nombre del documento
        CASE WHEN T LIKE '%FACTURA%' THEN 'e-Factura'
             WHEN T LIKE '%TICKET%'  THEN 'e-Ticket'
             ELSE 'otro' END AS FamiliaElegida,
        -- ¿RUT válido (12 díg) en este documento?
        CASE WHEN RutDig NOT LIKE '%[^0-9]%' AND LEN(RutDig) = 12 THEN 1 ELSE 0 END AS TieneRUT,
        -- ¿RUT válido en el documento referenciado?
        CASE WHEN RutRefDig NOT LIKE '%[^0-9]%' AND LEN(RutRefDig) = 12 THEN 1 ELSE 0 END AS RefTieneRUT
    FROM Base
),
Eval AS (
    SELECT *,
        -- Familia REAL que emitiría el back
        CASE
            WHEN Clase = 'VENTA' THEN CASE WHEN TieneRUT = 1 THEN 'e-Factura' ELSE 'e-Ticket' END
            ELSE CASE WHEN RefTieneRUT = 1 THEN 'e-Factura' ELSE 'e-Ticket' END  -- notas: la manda el referenciado
        END AS FamiliaReal
    FROM Clasif
)
SELECT
    DocIdDocumento,
    DocTipo,
    DocSerie + '-' + CAST(DocNumero AS VARCHAR(20)) AS Numero,
    Clase,
    FamiliaElegida,
    FamiliaReal,
    TieneRUT,
    RutDig               AS RutReceptor,
    COALESCE(DocCliNombre, FichaNombre) AS Receptor,
    DocTotal, MonIdMoneda, DocFechaEmision,
    DocIdDocumentoRef,
    CASE WHEN DocIdDocumentoRef IS NOT NULL
         THEN RefDocTipo + ' (' + RefSerie + '-' + CAST(RefNumero AS VARCHAR(20)) + ')' END AS Referencia,
    CASE
        WHEN Clase = 'VENTA' AND FamiliaElegida = 'e-Ticket'  AND TieneRUT = 1
             THEN 'A) e-Ticket con RUT 12 dig -> DGI emite e-FACTURA 111 (no coincide con lo elegido)'
        WHEN Clase = 'VENTA' AND FamiliaElegida = 'e-Factura' AND TieneRUT = 0
             THEN 'B) e-Factura SIN RUT valido -> DGI la RECHAZA (no emitible asi)'
        WHEN Clase IN ('NC','ND') AND DocIdDocumentoRef IS NULL
             THEN 'D) Nota SIN documento referenciado -> no emitible'
        WHEN Clase IN ('NC','ND') AND FamiliaElegida <> FamiliaReal
             THEN 'C) Nota de ' + FamiliaElegida + ' pero corrige un ' + FamiliaReal + ' -> DGI la rechaza'
        ELSE NULL
    END AS Motivo
FROM Eval
WHERE
    (Clase = 'VENTA' AND FamiliaElegida <> FamiliaReal)
    OR (Clase IN ('NC','ND') AND (DocIdDocumentoRef IS NULL OR FamiliaElegida <> FamiliaReal))
ORDER BY DocFechaEmision DESC, DocIdDocumento DESC;

/* ---- Resumen por tipo de problema ---- */
;WITH Base AS (
    SELECT d.DocIdDocumento, d.DocIdDocumentoRef, UPPER(d.DocTipo) AS T,
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            COALESCE(NULLIF(LTRIM(RTRIM(d.DocCliDocumento)),''), c.CioRuc, '')
        ,'.',''),'-',''),' ',''),CHAR(9),''),CHAR(160),'') AS RutDig,
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            COALESCE(NULLIF(LTRIM(RTRIM(rd.DocCliDocumento)),''), rc.CioRuc, '')
        ,'.',''),'-',''),' ',''),CHAR(9),''),CHAR(160),'') AS RutRefDig
    FROM dbo.DocumentosContables d
    LEFT JOIN dbo.Clientes c  ON c.CliIdCliente = d.CliIdCliente
    LEFT JOIN dbo.DocumentosContables rd ON rd.DocIdDocumento = d.DocIdDocumentoRef
    LEFT JOIN dbo.Clientes rc ON rc.CliIdCliente = rd.CliIdCliente
    WHERE d.CfeEstado = 'PENDIENTE'
      AND (UPPER(d.DocTipo) LIKE '%TICKET%' OR UPPER(d.DocTipo) LIKE '%FACTURA%')
),
Clasif AS (
    SELECT *,
        CASE WHEN T LIKE '%NOTA DE CR%' THEN 'NC' WHEN T LIKE '%NOTA DE D%' THEN 'ND' ELSE 'VENTA' END AS Clase,
        CASE WHEN T LIKE '%FACTURA%' THEN 'e-Factura' WHEN T LIKE '%TICKET%' THEN 'e-Ticket' ELSE 'otro' END AS FamiliaElegida,
        CASE WHEN RutDig NOT LIKE '%[^0-9]%' AND LEN(RutDig)=12 THEN 1 ELSE 0 END AS TieneRUT,
        CASE WHEN RutRefDig NOT LIKE '%[^0-9]%' AND LEN(RutRefDig)=12 THEN 1 ELSE 0 END AS RefTieneRUT
    FROM Base
),
Eval AS (
    SELECT *, CASE WHEN Clase='VENTA' THEN CASE WHEN TieneRUT=1 THEN 'e-Factura' ELSE 'e-Ticket' END
                   ELSE CASE WHEN RefTieneRUT=1 THEN 'e-Factura' ELSE 'e-Ticket' END END AS FamiliaReal
    FROM Clasif
)
SELECT
    CASE
        WHEN Clase='VENTA' AND FamiliaElegida='e-Ticket'  AND TieneRUT=1 THEN 'A) Ticket con RUT -> emite Factura'
        WHEN Clase='VENTA' AND FamiliaElegida='e-Factura' AND TieneRUT=0 THEN 'B) Factura sin RUT -> rechazo'
        WHEN Clase IN ('NC','ND') AND DocIdDocumentoRef IS NULL          THEN 'D) Nota sin referencia'
        WHEN Clase IN ('NC','ND') AND FamiliaElegida <> FamiliaReal      THEN 'C) Nota familia distinta al referenciado'
    END AS Problema,
    COUNT(*) AS Cantidad
FROM Eval
WHERE (Clase='VENTA' AND FamiliaElegida <> FamiliaReal)
   OR (Clase IN ('NC','ND') AND (DocIdDocumentoRef IS NULL OR FamiliaElegida <> FamiliaReal))
GROUP BY
    CASE
        WHEN Clase='VENTA' AND FamiliaElegida='e-Ticket'  AND TieneRUT=1 THEN 'A) Ticket con RUT -> emite Factura'
        WHEN Clase='VENTA' AND FamiliaElegida='e-Factura' AND TieneRUT=0 THEN 'B) Factura sin RUT -> rechazo'
        WHEN Clase IN ('NC','ND') AND DocIdDocumentoRef IS NULL          THEN 'D) Nota sin referencia'
        WHEN Clase IN ('NC','ND') AND FamiliaElegida <> FamiliaReal      THEN 'C) Nota familia distinta al referenciado'
    END
ORDER BY Cantidad DESC;
