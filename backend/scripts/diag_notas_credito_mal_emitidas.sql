/* =====================================================================
   DIAGNOSTICO (SOLO LECTURA) - Notas de Credito emitidas a DGI como VENTA
   ---------------------------------------------------------------------
   Causa: DocTipo es varchar(20) y "E-Ticket Nota De Credito" se guardaba
   truncado como "E-Ticket Nota De Cre". sisnetService buscaba 'NC' o
   'NOTA DE CREDITO' en ese texto, no lo encontraba, y pedia CAE de
   e-Factura/e-Ticket de VENTA (111/101) en lugar de NC (112/102).

   Resultado: la NC aceptada por DGI figura como una venta mas (suma IVA
   en vez de restarlo) y el credito al cliente nunca llego a DGI.

   Ejecutar en PRODUCCION para obtener la lista exacta a regularizar.
   ===================================================================== */

SELECT
    d.DocIdDocumento,
    d.DocTipo,
    d.DocSerie + '-' + d.DocNumero          AS NotaCredito,
    d.DocFechaEmision,
    d.CfeEstado,
    d.CfeNumeroOficial                       AS NumeroOficialDGI,
    d.DocTotal,
    CASE d.MonIdMoneda WHEN 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
    cli.Nombre                               AS Cliente,
    cli.CioRuc                               AS ClienteRUT,
    /* documento original que la NC pretende corregir */
    d.DocIdDocumentoRef,
    ori.DocTipo                              AS OrigenTipo,
    ori.DocSerie + '-' + ori.DocNumero       AS OrigenNro,
    ori.CfeNumeroOficial                     AS OrigenNumeroOficialDGI,
    ori.DocTotal                             AS OrigenTotal,
    d.DocMotivoRef                           AS Motivo,
    /* que se le mando realmente a DGI con el codigo viejo */
    CASE
        WHEN LEN(ISNULL(cli.CioRuc,'')) = 12 THEN '111 - e-Factura (VENTA)'
        ELSE '101 - e-Ticket (VENTA)'
    END                                      AS CFE_Emitido_Incorrecto,
    /* lo que corresponde: la NC sigue la familia del documento ORIGINAL */
    CASE
        WHEN UPPER(ISNULL(ori.DocTipo,'')) LIKE '%FACTURA%' THEN '112 - NC de e-Factura'
        ELSE '102 - NC de e-Ticket'
    END                                      AS CFE_Correcto,
    CASE
        WHEN d.CfeEstado = 'ACEPTADO_DGI'
            THEN 'YA ESTA EN DGI COMO VENTA - regularizar con el contador'
        WHEN d.CfeEstado = 'PENDIENTE'
            THEN 'Sin enviar - se reenvia bien despues del deploy'
        ELSE d.CfeEstado
    END                                      AS Accion
FROM dbo.DocumentosContables d
LEFT JOIN dbo.Clientes            cli ON cli.CliIdCliente   = d.CliIdCliente
LEFT JOIN dbo.DocumentosContables ori ON ori.DocIdDocumento = d.DocIdDocumentoRef
WHERE d.DocSerie = 'NC'
   OR UPPER(d.DocTipo) LIKE '%NOTA DE CR%'
ORDER BY d.DocIdDocumento;


/* --- Resumen rapido --- */
SELECT d.CfeEstado, COUNT(*) AS Cant, SUM(d.DocTotal) AS TotalAfectado
FROM dbo.DocumentosContables d
WHERE d.DocSerie = 'NC' OR UPPER(d.DocTipo) LIKE '%NOTA DE CR%'
GROUP BY d.CfeEstado;


/* --- NC sin documento de origen (DGI exige la referencia) --- */
SELECT d.DocIdDocumento, d.DocSerie + '-' + d.DocNumero AS NotaCredito, d.CfeEstado, d.DocTotal
FROM dbo.DocumentosContables d
WHERE (d.DocSerie = 'NC' OR UPPER(d.DocTipo) LIKE '%NOTA DE CR%')
  AND d.DocIdDocumentoRef IS NULL;
