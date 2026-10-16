/* ============================================================================
   FIX PUNTUAL — SOLO ET-899 (DocIdDocumento = 2647, Retiro RW-16826)
   Fecha: 2026-07-08
   ----------------------------------------------------------------------------
   Confirmado:
     - DocTotal = 35 (cobro real del retiro, correcto — NO se toca).
     - Linea 7895 SB-66466 = 14  -> correcta, NO se toca.
     - Linea 7896 SB-63888 = 35  -> MAL (tomó el retiro entero). Debe ser 21.
   Valores nuevos para SB-63888 (IVA 22%, cantidad 2.1):
     Total = 21.00 | Subtotal = 21/1.22 = 17.21 | Impuestos = 3.79 | PrecioUnit = 21/2.1 = 10.00
   ============================================================================ */

-- 1) ANTES
SELECT dcd.DcdIdDetalle, dcd.OrdCodigoOrden, dcd.DcdCantidad,
       dcd.DcdSubtotal, dcd.DcdImpuestos, dcd.DcdTotal
FROM dbo.DocumentosContablesDetalle dcd
WHERE dcd.DocIdDocumento = 2647
ORDER BY dcd.DcdIdDetalle;


BEGIN TRANSACTION;

-- 2) Corregir SOLO la línea de SB-63888 de este documento
UPDATE dbo.DocumentosContablesDetalle
SET DcdTotal          = 21.00,
    DcdSubtotal       = 17.21,
    DcdImpuestos      = 3.79,
    DcdPrecioUnitario = 10.0000
WHERE DocIdDocumento = 2647
  AND LTRIM(RTRIM(OrdCodigoOrden)) = 'SB-63888';

-- Seguridad: debe haber afectado exactamente 1 fila
IF @@ROWCOUNT <> 1
BEGIN
    PRINT 'ABORTADO: se esperaba 1 fila afectada. Revisar.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    -- 3) VERIFICACIÓN: la suma de líneas debe quedar = DocTotal (35)
    DECLARE @DocTotal   DECIMAL(18,2) = (SELECT DocTotal FROM dbo.DocumentosContables WHERE DocIdDocumento = 2647);
    DECLARE @SumaLineas DECIMAL(18,2) = (SELECT SUM(DcdTotal) FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = 2647);

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

-- 4) DESPUÉS (corré esto tras el COMMIT para confirmar el resultado final)
-- SELECT DcdIdDetalle, OrdCodigoOrden, DcdCantidad, DcdSubtotal, DcdImpuestos, DcdTotal
-- FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = 2647 ORDER BY DcdIdDetalle;
