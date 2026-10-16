-- ============================================================================
-- BILLETERA PARA LOS CLIENTES QUE OPERAN (28-08-2026, filtro 01-09-2026)
-- Crea dos cuentas de saldo estandar de la billetera, YA NACIDAS CORRECTAS:
--   - "BILLETERA USD"  (DINERO_USD, moneda 2)
--   - "BILLETERA UY"   (DINERO_UYU, moneda 1)
-- Propiedades: secundarias, LIBRES, modalidad PREPAGO_FACTURADO (la carga entra
-- SIEMPRE contra factura - Venta de saldo en caja o recarga web facturada; los
-- consumos NUNCA se refacturan), DESCUENTO AUTOMATICO ON (comunes: al ingreso a
-- deposito; semanales: el motor las saltea al ingreso y el cierre las consume
-- orden a orden con precios finales) y NUNCA aceptan negativo. Usuario 999.
--
-- FILTRO (decision del usuario 01-09-2026): SOLO clientes con alguna cuenta
-- PRINCIPAL ACTIVA (= clientes que operaron en plata). Los demas no reciben
-- billetera aca: se les crea AUTOMATICAMENTE al prender el switch "Billetera
-- visible en el portal" del 360 (setBilleteraPortal, contabilidadController).
-- El viejo migrar_billeteras_prepago.sql queda OBSOLETO: nacen ya migradas.
--
-- IDEMPOTENTE: si el cliente ya tiene una cuenta con ese nombre (activa o
-- cerrada), no se crea otra. Se puede correr las veces que haga falta.
-- REQUIERE: scripts/add_billetera_cuentas.sql aplicado antes.
-- ============================================================================

SET NOCOUNT ON;

DECLARE @creadasUSD INT, @creadasUYU INT;

INSERT INTO dbo.CuentasCliente
  (CliIdCliente, CueTipo, ProIdProducto, MonIdMoneda, CPaIdCondicion,
   CueSaldoActual, CueLimiteCredito, CuePuedeNegativo, CueCicloActivo,
   CueActiva, CueFechaAlta, CueUsuarioAlta,
   CueNombre, CueEsPrincipal, CueRestringida, CueAutoConsumo, CueModalidadFiscal)
SELECT c.CliIdCliente, 'DINERO_USD', NULL, 2, 1,
       0, 0, 0, 0,
       1, GETDATE(), 999,
       'BILLETERA USD', 0, 0, 1, 'PREPAGO_FACTURADO'
FROM dbo.Clientes c
WHERE EXISTS (
        SELECT 1 FROM dbo.CuentasCliente p
        WHERE p.CliIdCliente = c.CliIdCliente
          AND p.CueEsPrincipal = 1 AND p.CueActiva = 1)
  AND NOT EXISTS (
        SELECT 1 FROM dbo.CuentasCliente cc
        WHERE cc.CliIdCliente = c.CliIdCliente
          AND LTRIM(RTRIM(ISNULL(cc.CueNombre,''))) = 'BILLETERA USD');
SET @creadasUSD = @@ROWCOUNT;

INSERT INTO dbo.CuentasCliente
  (CliIdCliente, CueTipo, ProIdProducto, MonIdMoneda, CPaIdCondicion,
   CueSaldoActual, CueLimiteCredito, CuePuedeNegativo, CueCicloActivo,
   CueActiva, CueFechaAlta, CueUsuarioAlta,
   CueNombre, CueEsPrincipal, CueRestringida, CueAutoConsumo, CueModalidadFiscal)
SELECT c.CliIdCliente, 'DINERO_UYU', NULL, 1, 1,
       0, 0, 0, 0,
       1, GETDATE(), 999,
       'BILLETERA UY', 0, 0, 1, 'PREPAGO_FACTURADO'
FROM dbo.Clientes c
WHERE EXISTS (
        SELECT 1 FROM dbo.CuentasCliente p
        WHERE p.CliIdCliente = c.CliIdCliente
          AND p.CueEsPrincipal = 1 AND p.CueActiva = 1)
  AND NOT EXISTS (
        SELECT 1 FROM dbo.CuentasCliente cc
        WHERE cc.CliIdCliente = c.CliIdCliente
          AND LTRIM(RTRIM(ISNULL(cc.CueNombre,''))) = 'BILLETERA UY');
SET @creadasUYU = @@ROWCOUNT;

PRINT 'BILLETERA USD creadas: ' + CAST(@creadasUSD AS VARCHAR(10));
PRINT 'BILLETERA UY creadas:  ' + CAST(@creadasUYU AS VARCHAR(10));

-- Verificacion: total de billeteras vs clientes que operan (con principal activa)
SELECT LTRIM(RTRIM(CueNombre)) AS Cuenta, COUNT(*) AS Total
FROM dbo.CuentasCliente
WHERE CueNombre IN ('BILLETERA USD', 'BILLETERA UY')
GROUP BY LTRIM(RTRIM(CueNombre));

SELECT 'Clientes con principal activa (referencia)' AS Que, COUNT(DISTINCT CliIdCliente) AS N
FROM dbo.CuentasCliente WHERE CueEsPrincipal = 1 AND CueActiva = 1;
