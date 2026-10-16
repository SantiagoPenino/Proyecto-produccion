/* ============================================================================
   diag_crossmoneda_cliente.sql   —   SOLO LECTURA
   ----------------------------------------------------------------------------
   Mapa del desfasaje de moneda de UN cliente (default: Palmero).

   QUÉ MUESTRA, por cada documento del cliente:
     · la moneda e importe del DOCUMENTO,
     · la moneda y suma de sus ÓRDENES (el valor REAL del trabajo),
     · la moneda, cuenta e importe de sus PAGOS,
     · y marca CRUCE cuando la moneda del documento/pago no coincide con la de las órdenes.

   EL BUG (cross-moneda del cierre de ciclo): un ciclo en US$ se facturó en $ (o al
   revés) y el importe quedó convertido pero mal etiquetado. Ejemplo real (Palmero):
   PC-1451 → orden US$ 517,20, pero el documento y el pago quedaron en 12.159,89
   (US$517 convertido a pesos, etiquetado como US$). El importe está inflado ~23×.

   Esto NO se arregla con un UPDATE ciego: es una reconstrucción contable. Este script
   solo te MUESTRA cuánto dice cada cosa vs cuánto debería, para revisar con el contador.

   Cambiá @Cliente por el nombre (o dejá 'Palmero').
   ============================================================================ */

SET NOCOUNT ON;

DECLARE @Cliente VARCHAR(100) = 'Palmero';
DECLARE @Cli INT = (SELECT TOP 1 CliIdCliente FROM dbo.Clientes WHERE LTRIM(RTRIM(Nombre)) LIKE @Cliente + '%');
PRINT 'Cliente: ' + @Cliente + '  (CliId ' + CAST(@Cli AS VARCHAR(10)) + ')';

-- ── 1. Por documento: moneda del doc vs moneda de las órdenes vs moneda del pago ──
SELECT
    Doc          = RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero),
    dc.DocIdDocumento,
    DocMoneda    = moDoc.MonSimbolo,
    DocTotal     = CAST(dc.DocTotal AS DECIMAL(18,2)),
    -- Valor REAL del trabajo (suma de las órdenes del documento/ciclo) y su moneda
    OrdMoneda    = (SELECT TOP 1 moO.MonSimbolo
                    FROM dbo.MovimientosCuenta m
                    JOIN dbo.CuentasCliente ccO ON ccO.CueIdCuenta = m.CueIdCuenta
                    JOIN dbo.Monedas moO ON moO.MonIdMoneda = ccO.MonIdMoneda
                    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')),
    OrdSuma      = (SELECT CAST(SUM(ABS(m.MovImporte)) AS DECIMAL(18,2))
                    FROM dbo.MovimientosCuenta m
                    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)),
    -- Pago(s): moneda de la cuenta donde entró + importe
    PagoMoneda   = (SELECT TOP 1 moP.MonSimbolo
                    FROM dbo.MovimientosCuenta m
                    JOIN dbo.CuentasCliente ccP ON ccP.CueIdCuenta = m.CueIdCuenta
                    JOIN dbo.Monedas moP ON moP.MonIdMoneda = ccP.MonIdMoneda
                    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('PAGO','COBRO')),
    PagoImporte  = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2))
                    FROM dbo.MovimientosCuenta m
                    WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('PAGO','COBRO')
                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)),
    -- Deuda viva y su cuenta
    DeudaMoneda  = (SELECT TOP 1 moD.MonSimbolo
                    FROM dbo.DeudaDocumento dd
                    JOIN dbo.CuentasCliente ccD ON ccD.CueIdCuenta = dd.CueIdCuenta
                    JOIN dbo.Monedas moD ON moD.MonIdMoneda = ccD.MonIdMoneda
                    WHERE dd.DocIdDocumento = dc.DocIdDocumento AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA')),
    -- Órdenes en otra moneda que el doc = conversión NORMAL del cierre (US$ → factura $).
    -- La ANOMALÍA es cuando el PAGO quedó en otra moneda que el documento (ej PC-1451):
    -- ahí el pago cayó en la cuenta equivocada y descuadra el saldo.
    ANOMALIA_PAGO = CASE WHEN EXISTS (
                   SELECT 1 FROM dbo.MovimientosCuenta m
                   JOIN dbo.CuentasCliente ccX ON ccX.CueIdCuenta = m.CueIdCuenta
                   WHERE m.DocIdDocumento = dc.DocIdDocumento
                     AND m.MovTipo IN ('PAGO','COBRO')
                     AND ccX.MonIdMoneda <> dc.MonIdMoneda)
                 THEN '⚠️ PAGO EN MONEDA DISTINTA' ELSE '' END
FROM dbo.DocumentosContables dc
LEFT JOIN dbo.Monedas moDoc ON moDoc.MonIdMoneda = dc.MonIdMoneda
WHERE dc.CliIdCliente = @Cli AND dc.DocEstado <> 'ANULADO'
ORDER BY CASE WHEN EXISTS (   -- las anomalías de pago primero
                   SELECT 1 FROM dbo.MovimientosCuenta m
                   JOIN dbo.CuentasCliente ccX ON ccX.CueIdCuenta = m.CueIdCuenta
                   WHERE m.DocIdDocumento = dc.DocIdDocumento
                     AND m.MovTipo IN ('PAGO','COBRO')
                     AND ccX.MonIdMoneda <> dc.MonIdMoneda) THEN 0 ELSE 1 END,
         dc.DocIdDocumento DESC;

-- ── 2. Impacto en el saldo de las cuentas del cliente ────────────────────────
-- Guardado (tabla) vs recalculado. Si difieren, el saldo cacheado está desfasado
-- (aparte del cross-moneda). NO recomputar hasta corregir el cross-moneda, o se
-- recomputa sobre importes corrompidos.
SELECT
    cc.CueTipo,
    Guardado    = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
    RecalcTodo  = (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2))
                   FROM dbo.MovimientosCuenta m
                   WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)),
    RecalcDinero= (SELECT CAST(SUM(m.MovImporte) AS DECIMAL(18,2))
                   FROM dbo.MovimientosCuenta m
                   WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                     AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'))
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');
