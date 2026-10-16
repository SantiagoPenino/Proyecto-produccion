/* ============================================================================
   DIAGNÓSTICO (SOLO LECTURA) — cómo tiene la contabilidad interna UNA NC
   ----------------------------------------------------------------------------
   No modifica NADA. Ubica el documento por su CAE (único) y muestra sus 3 patas:
     1) MOVIMIENTO en cuenta corriente  -> ¿la trata como NC (acredita) o como venta?
     2) ASIENTO contable                -> ¿existe? ¿con forma de NC o de venta?
     3) DEUDA del documento             -> ¿generó/afectó deuda?

   Cómo leer "NC vs venta":
     - Movimiento MovTipo='NOTA_CREDITO'  -> internamente está como NC (acreditó al cliente).
     - Asiento con la cuenta del CLIENTE (1.2.x) en el HABER -> forma de NC.
       con la cuenta del CLIENTE en el DEBE  -> forma de venta.
   ============================================================================ */

SET NOCOUNT ON;

DECLARE @CaeBusca VARCHAR(80) = 'CAE 90262053670 Serie A 27505';   -- <-- poné el CAE de la NC a revisar

DECLARE @DocId INT, @Serie VARCHAR(10), @Numero VARCHAR(50), @Asi INT;
SELECT TOP 1 @DocId = DocIdDocumento, @Serie = DocSerie, @Numero = DocNumero, @Asi = AsiIdAsiento
FROM dbo.DocumentosContables
WHERE DocSerie='NC' AND CfeEstado='ACEPTADO_DGI' AND CfeNumeroOficial LIKE '%' + @CaeBusca + '%';

IF @DocId IS NULL BEGIN RAISERROR('No se encontró NC aceptada con ese CAE. Revisá @CaeBusca.', 16, 1); RETURN; END

/* ---- 0) El documento ---- */
SELECT 'DOCUMENTO' AS Pata, d.DocIdDocumento, d.DocSerie + '-' + d.DocNumero AS DocLocal,
       d.DocTipo, d.DocTotal, CASE d.MonIdMoneda WHEN 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
       d.CfeNumeroOficial AS CAE_en_DGI, c.Nombre AS Cliente, c.CioRuc AS ClienteDoc,
       d.AsiIdAsiento
FROM dbo.DocumentosContables d LEFT JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
WHERE d.DocIdDocumento = @DocId;

/* ---- 1) Movimiento en cuenta corriente ---- */
SELECT '1) MOVIMIENTO CUENTA' AS Pata, mv.MovTipo, mv.MovImporte, mv.CueIdCuenta, mv.MovConcepto,
       CASE WHEN mv.MovTipo = 'NOTA_CREDITO' THEN 'Tratada como NC (acreditó al cliente)'
            ELSE 'Otro tipo — revisar' END AS Interpretacion
FROM dbo.MovimientosCuenta mv
WHERE mv.DocIdDocumento = @DocId AND ISNULL(mv.MovAnulado,0) = 0;

/* ---- 2) Asiento contable (match por AsiIdAsiento o por concepto exacto de la NC) ---- */
SELECT '2) ASIENTO' AS Pata, a.AsiId, a.SysOrigen, a.AsiEstado,
       pc.CueCodigo, pc.CueNombre, de.DetDebeUYU, de.DetHaberUYU,
       CASE WHEN pc.CueCodigo LIKE '1.2.%' AND de.DetHaberUYU > 0 THEN '<- CLIENTE en HABER = forma de NC'
            WHEN pc.CueCodigo LIKE '1.2.%' AND de.DetDebeUYU  > 0 THEN '<- CLIENTE en DEBE = forma de VENTA'
            ELSE '' END AS Forma
FROM dbo.Cont_AsientosCabecera a
JOIN dbo.Cont_AsientosDetalle de ON de.AsiId = a.AsiId
LEFT JOIN dbo.Cont_PlanCuentas pc ON pc.CueId = de.CueId
WHERE (@Asi IS NOT NULL AND a.AsiId = @Asi)
   OR a.AsiConcepto LIKE 'Nota de Cr%' + @Serie + '-' + @Numero + '%'
ORDER BY a.AsiId, de.DetId;

/* ---- 3) Deuda del documento ---- */
SELECT '3) DEUDA' AS Pata, dd.DDeIdDocumento, dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd
WHERE dd.DocIdDocumento = @DocId;

/* ---- Resumen en una línea ---- */
SELECT 'RESUMEN' AS Pata,
       CASE WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE DocIdDocumento=@DocId AND MovTipo='NOTA_CREDITO' AND ISNULL(MovAnulado,0)=0)
            THEN 'CUENTA CORRIENTE: tratada como NC' ELSE 'CUENTA CORRIENTE: sin movimiento NOTA_CREDITO' END AS EnCuenta,
       CASE WHEN @Asi IS NOT NULL OR EXISTS (SELECT 1 FROM dbo.Cont_AsientosCabecera WHERE AsiConcepto LIKE 'Nota de Cr%' + @Serie + '-' + @Numero + '%')
            THEN 'ASIENTO: existe' ELSE 'ASIENTO: NO tiene' END AS EnLibroDiario;
