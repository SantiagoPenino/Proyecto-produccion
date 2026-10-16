/* =====================================================================
   PedidosCobranzaDetalle.EsFacturable — línea facturable o no (10-sep-2026)
   ---------------------------------------------------------------------
   Motivo: en pedidos "comprar y personalizar" facturados "por área"
   ([FACTURA POR AREA] en la Nota de la orden madre PRO), o simplemente cuando
   un área no tiene precio configurado para ese producto, quedan líneas en
   PedidosCobranzaDetalle con Subtotal = 0 (Corte, Costura, la línea base de
   Producción, etc.). Esas líneas sirven para trazabilidad interna (qué área
   trabajó qué), pero no deben ensuciar la factura/CFE real del cliente con
   renglones en $0.

   EsFacturable = 1 (default) para no romper lo existente; erpSyncService.js
   la calcula y la guarda como 0 cuando la línea es hermana consolidada
   (EsHermanaConsolidada=1, ya está sumada en otra línea) o su Subtotal es 0.
   Es aditivo: no borra ni cambia ninguna fila existente más que el default.
   ===================================================================== */
SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.PedidosCobranzaDetalle') AND name = 'EsFacturable'
)
BEGIN
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD EsFacturable BIT NOT NULL DEFAULT 1;
    PRINT 'Columna EsFacturable agregada a PedidosCobranzaDetalle.';
END
ELSE
    PRINT 'La columna EsFacturable ya existía — nada que hacer.';
GO
-- (GO obligatorio: sin él SQL Server compila el archivo entero como un solo lote,
--  antes de correr el ALTER, y las consultas de abajo fallan con
--  "Invalid column name 'EsFacturable'". Pasó en prod el 17-sep-2026.)

-- Backfill informativo (opcional, no rompe nada si no se corre): marca en 0 las
-- filas YA EXISTENTES que hoy son hermana-consolidada o $0, para que la próxima
-- factura que las use ya las filtre sin esperar a un resync de esos pedidos.
-- UPDATE dbo.PedidosCobranzaDetalle
-- SET EsFacturable = 0
-- WHERE ISNULL(EsHermanaConsolidada, 0) = 1 OR ABS(ISNULL(Subtotal, 0)) < 0.005;

-- Verificación
SELECT TOP 20 ID, PedidoCobranzaID, OrdenID, CodArticulo, Subtotal, EsHermanaConsolidada, EsFacturable
FROM dbo.PedidosCobranzaDetalle ORDER BY ID DESC;
