/* =============================================================================
   add_recargos_DocumentosContablesDetalle.sql
   -----------------------------------------------------------------------------
   Completa la línea de factura para que pueda decir "lista − descuento + recargo
   = importe" (fase F3 del plan docs/motor-precios-transparencia-plan.md).

   Convención de la línea (RN-FAC.10, todo CON IVA, en la moneda del documento):
     DcdPrecioUnitario  = precio de LISTA unitario (bruto, antes de descuento)
     DcdTotalDescuentos = descuento de la línea (importe)      DcdDescuentoPct = %
     DcdTotalRecargos   = recargo de la línea (importe, SUMA)  DcdRecargoPct   = % (suma)
     DcdTotal           = DcdCantidad × DcdPrecioUnitario − DcdTotalDescuentos + DcdTotalRecargos
     DcdSubtotal        = DcdTotal / 1,22

   - Varios recargos en la misma línea (urgencia + tinta): cada uno se calcula sobre
     la lista, así que sus % se suman (25 + 25 = 50) y la línea guarda la suma; el
     detalle legible va en DcdRecargoStr ("Urgencia 25 % + Tinta UV 25 %"). El CFE
     también lleva UN recargoPct / recargoMonto por ítem, por eso la suma.
   - DcdDescuentoOrigen: de dónde salió el descuento (excepción del cliente, perfil
     escalonado, beneficio, reposición, manual). Sirve para reportar cuánto se
     descontó por cada vía; en el papel el cliente ve DcdDescuentoStr.
   - DcdDescuentoPct: mismo ALTER que add_DcdDescuentoPct.sql (pendiente en prod);
     se repite acá para que un solo script deje la tabla completa.
   - DcdPrecioUnitario pasa de DECIMAL(18,2) a DECIMAL(18,4): el código ya lo escribe
     con 4 decimales y la lista (PreciosBase) tiene 4. Ensancha sin pérdida.

   Todo NULL: los documentos existentes NO cambian (INV-PRE.02: un documento
   emitido conserva sus precios para siempre). Aditivo e idempotente. Correr UNA
   vez en PRODUCCIÓN (SSMS).
   ============================================================================= */
SET NOCOUNT ON;

IF COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdDescuentoPct') IS NULL
    ALTER TABLE dbo.DocumentosContablesDetalle ADD DcdDescuentoPct DECIMAL(9,4) NULL;

IF COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdDescuentoOrigen') IS NULL
    ALTER TABLE dbo.DocumentosContablesDetalle ADD DcdDescuentoOrigen NVARCHAR(150) NULL;

IF COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdRecargoPct') IS NULL
    ALTER TABLE dbo.DocumentosContablesDetalle ADD DcdRecargoPct DECIMAL(9,4) NULL;

IF COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdTotalRecargos') IS NULL
    ALTER TABLE dbo.DocumentosContablesDetalle ADD DcdTotalRecargos DECIMAL(18,2) NULL;

IF COL_LENGTH('dbo.DocumentosContablesDetalle', 'DcdRecargoStr') IS NULL
    ALTER TABLE dbo.DocumentosContablesDetalle ADD DcdRecargoStr VARCHAR(200) NULL;
GO

/* Precisión del unitario: 2 → 4 decimales. Solo si todavía está en 2. */
IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.DocumentosContablesDetalle')
      AND name = 'DcdPrecioUnitario' AND scale = 2
)
    ALTER TABLE dbo.DocumentosContablesDetalle ALTER COLUMN DcdPrecioUnitario DECIMAL(18,4) NULL;
GO

/* Verificación */
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'DocumentosContablesDetalle'
  AND COLUMN_NAME IN ('DcdPrecioUnitario', 'DcdTotalDescuentos', 'DcdDescuentoPct', 'DcdDescuentoStr',
                      'DcdDescuentoOrigen', 'DcdRecargoPct', 'DcdTotalRecargos', 'DcdRecargoStr')
ORDER BY ORDINAL_POSITION;
GO
