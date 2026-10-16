/* =============================================================================
   add_desglose_PedidosCobranzaDetalle.sql
   -----------------------------------------------------------------------------
   Congela el DESGLOSE del precio en cada línea de pedido (fase F1 del plan
   docs/motor-precios-transparencia-plan.md): precio de lista, descuento (tipo, %,
   importe, origen) y recargos (suma y detalle).

   HOY la línea solo guarda el neto (PrecioUnitario) y un texto
   (LogPrecioAplicado: "Base: USD 22.00 / Descuento: -USD 8.00 (Desc. 36% ...)").

   Semántica (todo UNITARIO y en la moneda de la línea, columna Moneda):
     PrecioLista − DescuentoImporte + RecargoImporte = PrecioUnitario   (±0,01)
     - PrecioLista: precio de lista después del override técnico (bordado por
       puntadas / estampado por bajadas: el override ES la lista).
     - DescuentoTipo: 'PCT' (regla en %), 'IMPORTE' (regla por importe), 'FIJO'
       (precio fijo pactado: importe = lista − fijo, % derivado), 'MANUAL' (precio
       tipeado a mano). Reposición sin cargo = 'PCT' 100 con origen 'REPOSICION'.
     - DescuentoImporte absorbe el redondeo (lista − neto); el % es el de la regla.
     - RecargoPct / RecargoImporte: SUMA de todos los recargos (urgencia + tinta...).
       Cada recargo se calcula sobre la lista, así que los % se suman (25 + 25 = 50).
       El detalle de cada uno (perfil, %, importe) va en DesgloseJSON y su texto
       legible en RecargoOrigen ("Urgencia 25 % + Tinta UV 25 %").
     - DescuentoOrigen: 'EXCEPCION_CLIENTE', 'PERFIL:13 SUBLIMACION ESCALONADOS (>=100)',
       'BENEFICIO:7', 'REPOSICION', 'MANUAL'. DescuentoPerfilId / DescuentoReglaId
       apuntan a PerfilesPrecios / PerfilesItems (o PreciosEspecialesItems).
     - DesgloseJSON: resultado estructurado del motor (lista, override, descuento
       ganador, reglas candidatas que perdieron y por qué, recargos uno por uno,
       prepago). Es lo que muestra "por qué ganó el escalonado".

   Todas las columnas son NULL: las filas existentes NO cambian y NULL significa
   "sin desglose" (el resto del sistema sigue usando el neto como hoy). Las viejas
   se completan con backfill_desglose_pcd.js (fase F6) parseando el texto.

   Aditivo e idempotente. Correr UNA vez en PRODUCCIÓN (SSMS). Sin transacción a
   propósito: cada ALTER es independiente y repetir el script no hace nada.
   ============================================================================= */
SET NOCOUNT ON;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'PrecioLista') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD PrecioLista DECIMAL(18,4) NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'DescuentoTipo') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD DescuentoTipo VARCHAR(12) NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'DescuentoPct') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD DescuentoPct DECIMAL(9,4) NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'DescuentoImporte') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD DescuentoImporte DECIMAL(18,4) NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'DescuentoOrigen') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD DescuentoOrigen NVARCHAR(150) NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'DescuentoPerfilId') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD DescuentoPerfilId INT NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'DescuentoReglaId') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD DescuentoReglaId INT NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'RecargoPct') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD RecargoPct DECIMAL(9,4) NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'RecargoImporte') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD RecargoImporte DECIMAL(18,4) NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'RecargoOrigen') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD RecargoOrigen NVARCHAR(200) NULL;

IF COL_LENGTH('dbo.PedidosCobranzaDetalle', 'DesgloseJSON') IS NULL
    ALTER TABLE dbo.PedidosCobranzaDetalle ADD DesgloseJSON NVARCHAR(MAX) NULL;
GO

/* Dominio de DescuentoTipo: si el código intenta guardar otro valor, falla acá y
   no queda un tipo inventado en la base. */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_PedidosCobranzaDetalle_DescuentoTipo')
    ALTER TABLE dbo.PedidosCobranzaDetalle WITH CHECK
        ADD CONSTRAINT CK_PedidosCobranzaDetalle_DescuentoTipo
        CHECK (DescuentoTipo IS NULL OR DescuentoTipo IN ('PCT', 'IMPORTE', 'FIJO', 'MANUAL'));
GO

/* Verificación */
SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'PedidosCobranzaDetalle'
  AND COLUMN_NAME IN ('PrecioLista', 'DescuentoTipo', 'DescuentoPct', 'DescuentoImporte', 'DescuentoOrigen',
                      'DescuentoPerfilId', 'DescuentoReglaId', 'RecargoPct', 'RecargoImporte', 'RecargoOrigen', 'DesgloseJSON')
ORDER BY ORDINAL_POSITION;
GO
