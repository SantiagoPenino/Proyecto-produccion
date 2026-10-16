/* ───────────────────────────────────────────────────────────────────────────────────────
   EUV-19358 (pedido 19358, Rolymajenski) — ojales en PESOS dentro de un pedido en DÓLARES

   La pre-factura (versión anterior al fix de "moneda por línea") muestra los ojales
   32 × $U 30 = $U 960 como US$ 960 y la factura no se puede emitir (no cuadra con el cargo).

   Este script pasa ESA línea a dólares AL TIPO DE CAMBIO:
       Subtotal en USD = $U 960 ÷ cotización          (con 40,84 → US$ 23,51)
       Precio unitario = $U 30  ÷ cotización          (con 40,84 → US$ 0,73)
   No cambia el total del pedido, ni el cargo en la cuenta, ni depósito. El precio original
   en pesos queda guardado en MonedaOriginal / PrecioUnitarioOriginal / SubtotalOriginal.

   SOLO hace falta si producción todavía NO tiene el fix. Con el fix subido no hay que correrlo.

   CÓMO SE USA
   1) Correrlo tal cual. Así como está es un ENSAYO: hace el cambio, muestra cómo queda
      ("DESPUES") y lo DESHACE (la última línea dice ROLLBACK = deshacer).
   2) Si "DESPUES" muestra los ojales en USD con el importe esperado, cambiar la última
      palabra ROLLBACK por COMMIT (= dejarlo grabado) y correrlo de nuevo.
   ─────────────────────────────────────────────────────────────────────────────────────── */
SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Tipo de cambio a usar. NULL = la última cotización cargada en el sistema.
-- Para usar otra, escribirla acá (ejemplo: 40.84).
DECLARE @Cot DECIMAL(18, 4) = NULL;
IF @Cot IS NULL SET @Cot = (SELECT TOP 1 CotDolar FROM dbo.Cotizaciones ORDER BY CotFecha DESC);

BEGIN TRAN;

DECLARE @PID INT = (SELECT TOP 1 ID FROM dbo.PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = '19358' ORDER BY ID DESC);

SELECT 'ANTES' AS Momento, @Cot AS TipoDeCambio, pc.MontoTotal, pc.Moneda AS MonedaPedido, d.ID, LTRIM(RTRIM(d.CodArticulo)) AS Articulo,
       d.Cantidad, d.PrecioLista, d.PrecioUnitario, d.Subtotal, d.Moneda, d.MonedaOriginal, d.PrecioUnitarioOriginal, d.SubtotalOriginal
FROM dbo.PedidosCobranza pc JOIN dbo.PedidosCobranzaDetalle d ON d.PedidoCobranzaID = pc.ID
WHERE pc.ID = @PID;

UPDATE d
SET    d.Subtotal       = ROUND(d.Subtotal / @Cot, 2),
       d.PrecioUnitario = ROUND(d.PrecioUnitario / @Cot, 2),      -- es lo que la pre-factura muestra como P. Lista y P. Unitario
       -- si la línea tuviera lista / descuento / recargo guardados, también pasan a dólares
       d.PrecioLista      = CASE WHEN d.PrecioLista      IS NULL THEN NULL ELSE ROUND(d.PrecioLista      / @Cot, 4) END,
       d.DescuentoImporte = CASE WHEN d.DescuentoImporte IS NULL THEN NULL ELSE ROUND(d.DescuentoImporte / @Cot, 4) END,
       d.RecargoImporte   = CASE WHEN d.RecargoImporte   IS NULL THEN NULL ELSE ROUND(d.RecargoImporte   / @Cot, 4) END,
       d.Moneda         = 'USD'
FROM   dbo.PedidosCobranzaDetalle d
JOIN   dbo.PedidosCobranza pc ON pc.ID = d.PedidoCobranzaID
WHERE  pc.ID = @PID
  AND  pc.Moneda = 'USD'
  AND  d.Moneda  = 'UYU'                      -- solo la línea que sigue en pesos
  AND  ISNULL(d.EsFacturable, 1) = 1
  AND  @Cot BETWEEN 30 AND 55                 -- candado: cotización razonable
  -- candados: una sola línea en pesos y el pedido todavía sin facturar
  AND  1 = (SELECT COUNT(*) FROM dbo.PedidosCobranzaDetalle y
             WHERE y.PedidoCobranzaID = pc.ID AND y.Moneda = 'UYU' AND ISNULL(y.EsFacturable, 1) = 1)
  AND  NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                    WHERE m.OrdIdOrden = d.OrdenID AND m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
                      AND ISNULL(m.MovAnulado, 0) = 0 AND m.DocIdDocumento IS NOT NULL);

SELECT @@ROWCOUNT AS LineasCambiadas;   -- tiene que dar 1

-- SumaLineas puede diferir del MontoTotal en 1 o 2 centavos (el total del pedido se calculó con
-- la cotización del día en que se cotizó). No traba la factura: se tolera hasta 1,00.
SELECT 'DESPUES' AS Momento, @Cot AS TipoDeCambio, pc.MontoTotal, pc.Moneda AS MonedaPedido, d.ID, LTRIM(RTRIM(d.CodArticulo)) AS Articulo,
       d.Cantidad, d.PrecioLista, d.PrecioUnitario, d.Subtotal, d.Moneda, d.MonedaOriginal, d.PrecioUnitarioOriginal, d.SubtotalOriginal,
       (SELECT SUM(x.Subtotal) FROM dbo.PedidosCobranzaDetalle x WHERE x.PedidoCobranzaID = pc.ID) AS SumaLineas
FROM dbo.PedidosCobranza pc JOIN dbo.PedidosCobranzaDetalle d ON d.PedidoCobranzaID = pc.ID
WHERE pc.ID = @PID;

ROLLBACK;   -- ← ENSAYO: deshace el cambio. Para dejarlo grabado, reemplazar ROLLBACK por COMMIT y volver a correr.
