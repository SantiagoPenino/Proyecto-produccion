/* ============================================================================
   CONVERTIR UNA sola NC mal emitida -> VENTA, buscándola por su CAE
   ----------------------------------------------------------------------------
   Para arreglar de a UNA, en la base que sea (PRODUCCIÓN). No usa DocId (que
   cambia entre bases): ubica el documento por el número de CAE de DGI, que es único.

   QUÉ HACE (y qué NO)
   - Toma la NC identificada por @CaeBusca y la pasa a la VENTA que DGI realmente
     tiene: DocTipo -> 'E-Factura Contado' (111) o 'E-Ticket Contado' (101), según
     @TipoCFE. Limpia la referencia (DocIdDocumentoRef/DocMotivoRef).
   - Guarda el tipo real en CfeTipoCFE (si la columna existe).
   - NO toca DGI: el comprobante ya existe con su CAE. Esto solo alinea el local.
   - NO toca la cuenta corriente: si esta NC dejó un movimiento NOTA_CREDITO, lo
     LISTA al final para tratarlo con el contador, pero no lo modifica.

   La transacción queda ABIERTA: revisás ANTES/DESPUÉS y hacés COMMIT o ROLLBACK.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* ---- COMPLETAR estos dos valores ---- */
DECLARE @CaeBusca VARCHAR(80) = 'CAE 90262053670 Serie A 27505';  -- texto único del CAE (como figura en NRO OFICIAL)
DECLARE @TipoCFE  INT          = 111;                              -- 111 = e-Factura,  101 = e-Ticket

/* ---- Ubicar el documento ---- */
DECLARE @DocId INT, @Serie VARCHAR(10), @Numero VARCHAR(50), @Tipo VARCHAR(20), @Estado VARCHAR(50), @Cnt INT;

SELECT @Cnt = COUNT(*)
FROM dbo.DocumentosContables
WHERE DocSerie='NC' AND CfeEstado='ACEPTADO_DGI' AND CfeNumeroOficial LIKE '%' + @CaeBusca + '%';

IF @Cnt = 0 BEGIN RAISERROR('No se encontró ninguna NC aceptada con ese CAE. Revisá @CaeBusca.', 16, 1); RETURN; END
IF @Cnt > 1 BEGIN RAISERROR('El CAE coincide con más de un documento. Afiná @CaeBusca para que sea único.', 16, 1); RETURN; END
IF @TipoCFE NOT IN (111,101) BEGIN RAISERROR('@TipoCFE debe ser 111 o 101.', 16, 1); RETURN; END

SELECT @DocId = DocIdDocumento
FROM dbo.DocumentosContables
WHERE DocSerie='NC' AND CfeEstado='ACEPTADO_DGI' AND CfeNumeroOficial LIKE '%' + @CaeBusca + '%';

/* ---- ANTES: confirmá que es el documento correcto ---- */
SELECT 'ANTES' AS Momento, d.DocIdDocumento, d.DocSerie + '-' + d.DocNumero AS DocLocal,
       d.DocTipo, d.DocTotal, d.CfeNumeroOficial AS CAE_en_DGI, c.Nombre AS Cliente, c.CioRuc AS ClienteDoc,
       @TipoCFE AS TipoCFE_destino,
       CASE @TipoCFE WHEN 111 THEN 'E-Factura Contado' ELSE 'E-Ticket Contado' END AS QuedariaComo
FROM dbo.DocumentosContables d LEFT JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
WHERE d.DocIdDocumento = @DocId;

BEGIN TRANSACTION;

    UPDATE dbo.DocumentosContables
       SET DocTipo           = CASE @TipoCFE WHEN 111 THEN 'E-Factura Contado' ELSE 'E-Ticket Contado' END,
           DocIdDocumentoRef  = NULL,
           DocMotivoRef       = NULL
    WHERE DocIdDocumento = @DocId;

    PRINT CONCAT('Documento ', @DocId, ' convertido a venta.');

    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='DocumentosContables' AND COLUMN_NAME='CfeTipoCFE')
    BEGIN
        DECLARE @sql NVARCHAR(400) = N'UPDATE dbo.DocumentosContables SET CfeTipoCFE = @t WHERE DocIdDocumento = @d';
        EXEC sp_executesql @sql, N'@t INT, @d INT', @t=@TipoCFE, @d=@DocId;
        PRINT 'CfeTipoCFE actualizado.';
    END

/* ---- DESPUÉS: confirmá que quedó como venta ---- */
SELECT 'DESPUES' AS Momento, DocIdDocumento, DocSerie + '-' + DocNumero AS DocLocal,
       DocTipo, CfeNumeroOficial AS CAE_en_DGI, DocIdDocumentoRef
FROM dbo.DocumentosContables WHERE DocIdDocumento = @DocId;

-- Si está OK:  COMMIT TRANSACTION;   si no:  ROLLBACK TRANSACTION;
-- (queda ABIERTA a propósito)


/* ---- APARTE: movimiento contable a revisar con el contador (no se toca) ---- */
SELECT mv.MovIdMovimiento, mv.DocIdDocumento, mv.MovTipo, mv.MovImporte,
       mv.CueIdCuenta, mv.MovConcepto, mv.MovFecha
FROM dbo.MovimientosCuenta mv
WHERE mv.DocIdDocumento = @DocId AND mv.MovTipo = 'NOTA_CREDITO' AND ISNULL(mv.MovAnulado,0) = 0;
