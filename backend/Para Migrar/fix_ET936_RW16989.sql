/* ============================================================================
   FIX PUNTUAL — SOLO ET-936 (DocIdDocumento = 2761, Retiro RW-16989)
   Fecha: 2026-07-08
   ----------------------------------------------------------------------------
   OJO: este caso NO es "doblado" como ET-877. Es el bug de MONEDA:
     - Documento en UYU. DocTotal = 1600.24 (= 39.6 USD x 40.41, correcto — NO se toca).
     - Retiro de UNA sola orden: DTF-3977 = 39.6 USD.
     - La línea quedó en USD crudo (DcdTotal = 39.60) sin convertir a UYU.
   Como es una sola orden, la línea debe valer el DocTotal completo:
     DTF-3977 (cant 1.8): Total 1600.24 | Subtotal 1311.67 | Imp 288.57 | PUnit 889.0222
     (Subtotal = 1600.24/1.22 ; PUnit = 1600.24/1.8)
   ============================================================================ */

-- 1) ANTES
SELECT dcd.DcdIdDetalle, dcd.OrdCodigoOrden, dcd.DcdCantidad,
       dcd.DcdSubtotal, dcd.DcdImpuestos, dcd.DcdTotal
FROM dbo.DocumentosContablesDetalle dcd
WHERE dcd.DocIdDocumento = 2761
ORDER BY dcd.DcdIdDetalle;


BEGIN TRANSACTION;

-- 2) Convertir la única línea a UYU (= DocTotal)
UPDATE dbo.DocumentosContablesDetalle
SET DcdTotal          = 1600.24,
    DcdSubtotal       = 1311.67,
    DcdImpuestos      = 288.57,
    DcdPrecioUnitario = 889.0222
WHERE DocIdDocumento = 2761
  AND LTRIM(RTRIM(OrdCodigoOrden)) = 'DTF-3977';

-- Seguridad: debe ser exactamente 1 fila
IF @@ROWCOUNT <> 1
BEGIN
    PRINT 'ABORTADO: se esperaba 1 fila afectada. ROLLBACK.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    -- 3) VERIFICACIÓN: la suma de líneas debe quedar = DocTotal (1600.24)
    DECLARE @DocTotal   DECIMAL(18,2) = (SELECT DocTotal FROM dbo.DocumentosContables WHERE DocIdDocumento = 2761);
    DECLARE @SumaLineas DECIMAL(18,2) = (SELECT SUM(DcdTotal) FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = 2761);

    SELECT @DocTotal AS DocTotal, @SumaLineas AS SumaLineas,
           ABS(@DocTotal - @SumaLineas) AS Diferencia;

    IF ABS(@DocTotal - @SumaLineas) <= 0.01
    BEGIN
        COMMIT TRANSACTION;
        PRINT 'OK: corregido y confirmado (COMMIT). Línea cuadra con DocTotal.';
    END
    ELSE
    BEGIN
        ROLLBACK TRANSACTION;
        PRINT 'DESCUADRE inesperado. Se hizo ROLLBACK, no se cambió nada.';
    END
END

-- 4) DESPUÉS (opcional, tras el COMMIT)
-- SELECT DcdIdDetalle, OrdCodigoOrden, DcdCantidad, DcdSubtotal, DcdImpuestos, DcdTotal
-- FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = 2761 ORDER BY DcdIdDetalle;
