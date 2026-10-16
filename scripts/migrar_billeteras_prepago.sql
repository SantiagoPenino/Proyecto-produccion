-- ============================================================================
-- MIGRACIÓN BILLETERA → PREPAGO FACTURADO + AUTOMÁTICO (31-08-2026)
-- Pedido de administración: toda plata por adelantado en la BILLETERA entra
-- CONTRA FACTURA (Venta de saldo / recarga web facturada) y sus consumos se
-- descuentan orden a orden SIN generar documento (la factura ya existió al cargar).
--   · Modalidad: PREPAGO_FACTURADO
--   · Descuento automático: ON  (comunes: al ingreso a depósito; semanales: el
--     motor las saltea al ingreso y el cierre las consume con precios finales)
--   · Negativo: NO (sin cambios)
--
-- SOLO migra cuentas SIN MOVIMIENTOS: una BILLETERA que ya recibió plata por
-- RECIBO (anticipo) no puede volverse "facturada" sin facturar ese saldo antes.
-- Esas se listan al final para resolverlas a mano (facturar su saldo con
-- "Facturar consumos"/ajuste, o dejarlas como anticipo hasta agotarse).
-- Idempotente. Correr DESPUÉS de crear_billeteras_clientes.sql.
-- ============================================================================
SET NOCOUNT ON;

UPDATE cc
SET cc.CueModalidadFiscal = 'PREPAGO_FACTURADO',
    cc.CueAutoConsumo     = 1
FROM dbo.CuentasCliente cc
WHERE LTRIM(RTRIM(ISNULL(cc.CueNombre,''))) IN ('BILLETERA USD', 'BILLETERA UY')
  AND ISNULL(cc.CueModalidadFiscal,'ANTICIPO_A_FACTURAR') <> 'PREPAGO_FACTURADO'
  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta);
PRINT 'BILLETERAS migradas a prepago+automatico: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- Las que NO se pudieron migrar (tienen movimientos de la etapa "anticipo")
SELECT cc.CueIdCuenta, cc.CliIdCliente, LTRIM(RTRIM(cc.CueNombre)) AS Cuenta,
       ISNULL(cc.CueModalidadFiscal,'ANTICIPO_A_FACTURAR') AS ModalidadActual,
       ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS SaldoReal
FROM dbo.CuentasCliente cc
WHERE LTRIM(RTRIM(ISNULL(cc.CueNombre,''))) IN ('BILLETERA USD', 'BILLETERA UY')
  AND ISNULL(cc.CueModalidadFiscal,'ANTICIPO_A_FACTURAR') <> 'PREPAGO_FACTURADO';

-- Verificación
SELECT LTRIM(RTRIM(CueNombre)) AS Cuenta, ISNULL(CueModalidadFiscal,'?') AS Modalidad,
       CAST(CueAutoConsumo AS INT) AS Auto, COUNT(*) AS Total
FROM dbo.CuentasCliente
WHERE CueNombre IN ('BILLETERA USD', 'BILLETERA UY')
GROUP BY LTRIM(RTRIM(CueNombre)), ISNULL(CueModalidadFiscal,'?'), CAST(CueAutoConsumo AS INT)
ORDER BY 1, 2;
