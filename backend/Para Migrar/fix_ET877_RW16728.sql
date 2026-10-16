/* ============================================================================
   FIX PUNTUAL — SOLO ET-877 (DocIdDocumento = 2572, Retiro RW-16728)
   Fecha: 2026-07-08
   ----------------------------------------------------------------------------
   Confirmado:
     - Documento en UYU. DocTotal = 1333.53 (= 33 USD x 40.41, correcto — NO se toca).
     - Órdenes del retiro (USD):  DTF-3739 = 22 | DTF-3764 = 11  (suman 33).
     - Líneas actuales (doblado completo): cada una = 1333.53 -> suman 2667.06. MAL.
   Reparto por costo real (factor = 1333.53 / 33 = 40.41):
     DTF-3739 (cant 1.0): Total 889.02 | Subtotal 728.70 | Imp 160.32 | PUnit 889.02
     DTF-3764 (cant 0.5): Total 444.51 | Subtotal 364.35 | Imp  80.16 | PUnit 889.02
     (PUnit igual en ambas: 22 USD/unidad x 40.41 = 889.02)
     Suma nueva = 1333.53 = DocTotal.
   ============================================================================ */

-- 1) ANTES
SELECT dcd.DcdIdDetalle, dcd.OrdCodigoOrden, dcd.DcdCantidad,
       dcd.DcdSubtotal, dcd.DcdImpuestos, dcd.DcdTotal
FROM dbo.DocumentosContablesDetalle dcd
WHERE dcd.DocIdDocumento = 2572
ORDER BY dcd.DcdIdDetalle;


BEGIN TRANSACTION;

-- 2) Corregir las DOS líneas del retiro en este documento
UPDATE dbo.DocumentosContablesDetalle
SET DcdTotal = CASE LTRIM(RTRIM(OrdCodigoOrden))
                    WHEN 'DTF-3739' THEN 889.02
                    WHEN 'DTF-3764' THEN 444.51 END,
    DcdSubtotal = CASE LTRIM(RTRIM(OrdCodigoOrden))
                    WHEN 'DTF-3739' THEN 728.70
                    WHEN 'DTF-3764' THEN 364.35 END,
    DcdImpuestos = CASE LTRIM(RTRIM(OrdCodigoOrden))
                    WHEN 'DTF-3739' THEN 160.32
                    WHEN 'DTF-3764' THEN 80.16 END,
    DcdPrecioUnitario = 889.02
WHERE DocIdDocumento = 2572
  AND LTRIM(RTRIM(OrdCodigoOrden)) IN ('DTF-3739', 'DTF-3764');

-- Seguridad: deben ser exactamente 2 filas
IF @@ROWCOUNT <> 2
BEGIN
    PRINT 'ABORTADO: se esperaban 2 filas afectadas. ROLLBACK.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    -- 3) VERIFICACIÓN: la suma de líneas debe quedar = DocTotal (1333.53)
    DECLARE @DocTotal   DECIMAL(18,2) = (SELECT DocTotal FROM dbo.DocumentosContables WHERE DocIdDocumento = 2572);
    DECLARE @SumaLineas DECIMAL(18,2) = (SELECT SUM(DcdTotal) FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = 2572);

    SELECT @DocTotal AS DocTotal, @SumaLineas AS SumaLineas,
           ABS(@DocTotal - @SumaLineas) AS Diferencia;

    IF ABS(@DocTotal - @SumaLineas) <= 0.01
    BEGIN
        COMMIT TRANSACTION;
        PRINT 'OK: corregido y confirmado (COMMIT). Líneas cuadran con DocTotal.';
    END
    ELSE
    BEGIN
        ROLLBACK TRANSACTION;
        PRINT 'DESCUADRE inesperado. Se hizo ROLLBACK, no se cambió nada.';
    END
END

-- 4) DESPUÉS (opcional, tras el COMMIT)
-- SELECT DcdIdDetalle, OrdCodigoOrden, DcdCantidad, DcdSubtotal, DcdImpuestos, DcdTotal
-- FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = 2572 ORDER BY DcdIdDetalle;
