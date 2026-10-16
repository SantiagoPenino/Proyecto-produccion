/* ============================================================================
   DIAGNÓSTICO (SOLO LECTURA) — por qué una factura sale como e-Ticket
   ----------------------------------------------------------------------------
   Muestra qué documento del receptor tiene la factura y CUÁL decide el tipo de
   CFE. La regla: manda DocCliDocumento (el del TERCERO); si está vacío, cae a la
   ficha del cliente interno (Clientes.CioRuc).
     - Documento de 12 dígitos = RUT -> e-Factura (111)
     - Documento de 6 a 8 dígitos = Cédula -> e-Ticket (101)
   ============================================================================ */

SET NOCOUNT ON;

DECLARE @Serie VARCHAR(10) = 'FA';    -- serie del documento
DECLARE @Numero VARCHAR(50) = '297';  -- número (o parte)

SELECT
    d.DocIdDocumento,
    d.DocSerie + '-' + d.DocNumero                       AS Doc,
    d.DocTipo,
    d.CfeEstado,
    /* --- lo que decide el tipo --- */
    d.DocCliDocumento                                    AS TerceroDoc,      -- documento del TERCERO (receptor real)
    c.CioRuc                                             AS FichaCliente,    -- documento de la ficha del cliente interno
    LEN(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(d.DocCliDocumento,''), c.CioRuc),'.',''),'-',''),' ','')) AS DigitosQueDeciden,
    CASE
      WHEN LEN(REPLACE(REPLACE(REPLACE(ISNULL(NULLIF(d.DocCliDocumento,''), c.CioRuc),'.',''),'-',''),' ','')) = 12
      THEN '111 e-Factura' ELSE '101 e-Ticket'
    END                                                  AS SeEmitiraComo,
    /* --- datos del tercero para contexto --- */
    d.DocCliNombre                                       AS TerceroNombre,
    d.DocCliNombreFantasia                               AS TerceroFantasia,
    c.Nombre                                             AS FichaNombre
FROM dbo.DocumentosContables d
LEFT JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
WHERE d.DocSerie = @Serie AND d.DocNumero LIKE '%' + @Numero + '%'
ORDER BY d.DocIdDocumento DESC;

/* CÓMO LEERLO
   - Si "TerceroDoc" está VACÍO -> el RUT del tercero NO se guardó. Por eso cae a la
     ficha (Cédula) y sale e-Ticket. Hay que cargar el RUT del tercero y GUARDAR.
   - Si "TerceroDoc" tiene 8 dígitos -> cargaste una Cédula, no un RUT.
   - Si "TerceroDoc" tiene 12 dígitos pero igual dice e-Ticket -> avisame, es otra cosa.
*/
