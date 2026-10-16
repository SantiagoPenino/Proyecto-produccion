-- ============================================================================
-- PROD_diag_anticipo_no_imputado.sql   (SOLO LECTURA — no cambia nada)
-- ----------------------------------------------------------------------------
-- Síntoma: el cliente tenía plata adelantada, se le hizo la factura, el SALDO de
-- la cuenta y el estado de cuenta están bien, pero la DEUDA de la factura quedó
-- por el total — el adelanto nunca se le imputó. Aparece "debiendo" de más en
-- Pago de Deudas, Antigüedad y Cobranzas.
--
-- Caso que lo origina: ANGEL CARBALLO (ID 72), PC-4969 del 29-09-2026.
--   Saldo antes de la factura: 5.231,00 a favor (en pesos)
--   Factura PC-4969:           6.037,57  → el saldo quedó en -806,57 (bien)
--   Deuda de PC-4969:          6.037,57  (mal: debería ser 806,57)
--
-- CAUSA: el cierre de ciclo facturado en OTRA moneda que la del ciclo (ciclo en
-- dólares, factura en pesos). La deuda iba a la cuenta en pesos por el total, sin
-- mirar el saldo a favor de esa cuenta. Firma en el libro: una marca CIERRE_CICLO en $ 0
-- en la cuenta del ciclo, "Cierre ciclo → Factura XX traspasada a UYU", y el cargo del
-- mismo documento en la otra cuenta.
-- Fix de código: contabilidadService.cerrarCicloCompleto (07-10-2026).
--
-- Bloques:
--   1) Angel Carballo: confirma la causa en su caso.
--   2) CASOS DE ESTA CAUSA: cierres en otra moneda con adelanto sin imputar.
--   3) BARRIDO GENERAL: toda cuenta donde la deuda dice más que el saldo,
--      sea cual sea la causa (para no dejar afuera otras familias).
--   4) Resumen en números.
-- ============================================================================

USE [SecureAppDB];
SET NOCOUNT ON;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) ANGEL CARBALLO — PC-4969
-- ────────────────────────────────────────────────────────────────────────────
DECLARE @CliAngel INT = 72;

-- 1a. El documento, el ciclo del que salió y en qué moneda estaba ese ciclo
SELECT  Documento        = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
        d.DocIdDocumento,
        d.DocFechaEmision,
        d.DocTotal,
        MonedaFactura    = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
        d.CicIdCiclo,
        CuentaDelCiclo   = ci.CueIdCuenta,
        MonedaDelCiclo   = CASE WHEN cci.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
        CuentaDeLaDeuda  = dd.CueIdCuenta,
        dd.DDeIdDocumento,
        dd.DDeImporteOriginal,
        dd.DDeImportePendiente,
        dd.DDeEstado,
        Imputado         = ISNULL((SELECT SUM(ip.ImpImporte) FROM dbo.ImputacionPago ip
                                   WHERE ip.DDeIdDocumento = dd.DDeIdDocumento), 0)
FROM dbo.DocumentosContables d
LEFT JOIN dbo.CiclosCredito  ci  ON ci.CicIdCiclo  = d.CicIdCiclo
LEFT JOIN dbo.CuentasCliente cci ON cci.CueIdCuenta = ci.CueIdCuenta
LEFT JOIN dbo.DeudaDocumento dd  ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @CliAngel
  AND d.DocFechaEmision >= '2026-09-20'
ORDER BY d.DocIdDocumento;

-- 1b. Libro de sus cuentas de dinero desde el 20-09 (sin las líneas ORDEN de detalle),
--     con el saldo corrido: tiene que verse 5.231 a favor justo antes de PC-4969.
SELECT  m.CueIdCuenta,
        m.MovIdMovimiento,
        m.MovFecha,
        m.MovTipo,
        m.MovImporte,
        SaldoCorrido = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta
                                               ORDER BY m.MovIdMovimiento ROWS UNBOUNDED PRECEDING),
        m.DocIdDocumento,
        Concepto = LEFT(m.MovConcepto, 80)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @CliAngel
  AND cc.CueTipo LIKE 'DINERO%'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY m.CueIdCuenta, m.MovIdMovimiento;
-- (el saldo corrido arranca en el primer movimiento de la cuenta; filtrar por fecha a ojo)


-- ────────────────────────────────────────────────────────────────────────────
-- 2) CASOS DE ESTA CAUSA: cierre en otra moneda con adelanto sin imputar
--    SaldoPrevio      = saldo de la cuenta destino justo antes del cargo de la factura
--    ExcesoCuenta     = deuda viva de la cuenta − lo que el saldo dice que debe
--    AplicableAhora   = MIN(pendiente de la deuda, SaldoPrevio, ExcesoCuenta)
--                       → lo que el lote de reparación le imputaría
-- ────────────────────────────────────────────────────────────────────────────
-- Cómo se reconoce un cierre en otra moneda (cualquiera de las dos alcanza):
--   a) el ciclo del documento es de una cuenta de OTRA moneda que la cuenta del cargo
--      (DocumentosContables.CicIdCiclo → CiclosCredito → CuentasCliente.MonIdMoneda). Es la
--      firma más firme: sobrevive a la edición de la factura.
--   b) la marca en $ 0 que el cierre deja en la cuenta del ciclo ("Cierre ciclo → Factura XX
--      traspasada a UYU").
-- El texto del cargo NO sirve: si se edita la factura se reescribe como "Venta Pedidos Caja:
-- PC-NNNN (...)", y a veces la marca (b) no está (caso CAPA PC-4883). El cargo es el débito
-- del documento en la cuenta de la moneda de la factura.
IF OBJECT_ID('tempdb..#Cross') IS NOT NULL DROP TABLE #Cross;

;WITH Cargo AS (
    SELECT  c.DocIdDocumento,
            c.CueIdCuenta,
            MovIdMovimiento = MIN(c.MovIdMovimiento),
            MovFecha        = MIN(c.MovFecha),
            Cargo           = -SUM(c.MovImporte)
    FROM dbo.MovimientosCuenta c
    WHERE c.MovImporte < 0
      AND (c.MovAnulado IS NULL OR c.MovAnulado = 0)
      AND c.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
      AND (
            EXISTS (SELECT 1
                    FROM dbo.DocumentosContables dx
                    JOIN dbo.CiclosCredito  ci  ON ci.CicIdCiclo   = dx.CicIdCiclo
                    JOIN dbo.CuentasCliente cci ON cci.CueIdCuenta = ci.CueIdCuenta
                    JOIN dbo.CuentasCliente ccc ON ccc.CueIdCuenta = c.CueIdCuenta
                    WHERE dx.DocIdDocumento = c.DocIdDocumento
                      AND ISNULL(cci.MonIdMoneda, 1) <> ISNULL(ccc.MonIdMoneda, 1))
         OR EXISTS (SELECT 1 FROM dbo.MovimientosCuenta t
                    WHERE t.DocIdDocumento = c.DocIdDocumento
                      AND t.MovTipo = 'CIERRE_CICLO'
                      AND t.MovConcepto LIKE 'Cierre ciclo%traspasada a %'
                      AND t.CueIdCuenta <> c.CueIdCuenta)
      )
    GROUP BY c.DocIdDocumento, c.CueIdCuenta
)
SELECT  g.MovIdMovimiento,
        g.CueIdCuenta,
        g.DocIdDocumento,
        g.MovFecha,
        g.Cargo,
        SaldoPrevio = ISNULL((SELECT SUM(m2.MovImporte) FROM dbo.MovimientosCuenta m2
                              WHERE m2.CueIdCuenta = g.CueIdCuenta
                                AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
                                AND m2.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                AND m2.MovIdMovimiento < g.MovIdMovimiento), 0)
INTO #Cross
FROM Cargo g;

-- Exceso de cada cuenta destino (misma fórmula que el barrido general del bloque 3):
--   DeudaConCargo  = deudas vivas de documentos cuyo cargo está en el libro de la cuenta
--   DebeSegunSaldo = lo que el libro dice que debe (0 si tiene a favor), sin contar cobros
--                    de órdenes todavía sin facturar (su cargo ORDEN tampoco está en el saldo)
--   DeudaSinCargo  > 0 → el exceso no es confiable en esa cuenta: no se repara en lote
IF OBJECT_ID('tempdb..#CtaExceso') IS NOT NULL DROP TABLE #CtaExceso;

;WITH C AS (
    SELECT  cc.CueIdCuenta,
            SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                 WHERE m.CueIdCuenta = cc.CueIdCuenta
                                   AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                   AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
            CobroOrdenSinFacturar = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                 WHERE m.CueIdCuenta = cc.CueIdCuenta
                                   AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                   AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                   AND m.MovImporte > 0
                                   AND m.OrdIdOrden IS NOT NULL
                                   AND m.DocIdDocumento IS NULL
                                   -- solo si la orden tiene su cargo (ORDEN) todavía SIN factura;
                                   -- si ya se facturó o no tiene cargo, el cobro sí cuenta (CAPA)
                                   AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta o
                                               WHERE o.OrdIdOrden = m.OrdIdOrden
                                                 AND o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                                                 AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
                                                 AND o.DocIdDocumento IS NULL)), 0),
            DeudaConCargo = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                                 WHERE dd.CueIdCuenta = cc.CueIdCuenta
                                   AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                                   AND dd.DDeImportePendiente > 0.01
                                   AND dd.DocIdDocumento IS NOT NULL
                                   AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                                               WHERE m.DocIdDocumento = dd.DocIdDocumento
                                                 AND m.CueIdCuenta = dd.CueIdCuenta
                                                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                                 AND m.MovImporte < 0)), 0),
            DeudaSinCargo = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                                 WHERE dd.CueIdCuenta = cc.CueIdCuenta
                                   AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                                   AND dd.DDeImportePendiente > 0.01
                                   AND dd.DocIdDocumento IS NOT NULL
                                   AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                                               WHERE m.DocIdDocumento = dd.DocIdDocumento
                                                 AND m.CueIdCuenta = dd.CueIdCuenta
                                                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                                 AND m.MovImporte < 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (SELECT CueIdCuenta FROM #Cross)
)
SELECT  C.*,
        ExcesoCuenta = C.DeudaConCargo
                     - CASE WHEN C.SaldoLibro - C.CobroOrdenSinFacturar < 0
                            THEN -(C.SaldoLibro - C.CobroOrdenSinFacturar) ELSE 0 END
INTO #CtaExceso
FROM C;

SELECT  Cliente        = RTRIM(cl.Nombre),
        d.CliIdCliente,
        Documento      = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
        Fecha          = CONVERT(date, x.MovFecha),
        Moneda         = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
        x.Cargo,
        SaldoPrevio    = CAST(x.SaldoPrevio AS DECIMAL(18,2)),
        DeudaPendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
        dd.DDeEstado,
        ExcesoCuenta   = CAST(e.ExcesoCuenta AS DECIMAL(18,2)),
        AplicableAhora = CAST((SELECT MIN(v) FROM (VALUES (dd.DDeImportePendiente),
                                                          (x.SaldoPrevio),
                                                          (e.ExcesoCuenta)) t(v)) AS DECIMAL(18,2)),
        SeReparaEnLote = CASE WHEN e.DeudaSinCargo > 0.01
                              THEN 'NO — la cuenta tiene deudas sin cargo en el libro (a mano)'
                              ELSE 'SI' END
FROM #Cross x
JOIN #CtaExceso e             ON e.CueIdCuenta = x.CueIdCuenta
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = x.DocIdDocumento
JOIN dbo.Clientes cl           ON cl.CliIdCliente = d.CliIdCliente
JOIN dbo.CuentasCliente cc     ON cc.CueIdCuenta = x.CueIdCuenta
JOIN dbo.DeudaDocumento dd     ON dd.DocIdDocumento = x.DocIdDocumento
                              AND dd.CueIdCuenta = x.CueIdCuenta
                              AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                              AND dd.DDeImportePendiente > 0.01
WHERE ISNULL(d.DocEstado, '') <> 'ANULADO'
  AND x.SaldoPrevio > 0.01
  AND e.ExcesoCuenta > 0.01
ORDER BY x.MovFecha;


-- ────────────────────────────────────────────────────────────────────────────
-- 3) BARRIDO GENERAL — toda cuenta donde la deuda dice más que el saldo
--    DebeSegunSaldo = lo que el libro dice que el cliente debe (0 si tiene a favor).
--      Se descuentan los cobros de órdenes TODAVÍA sin facturar: su cargo (ORDEN) no
--      está en el saldo, así que su cobro tampoco tiene que contar.
--    DeudaLista     = deudas vivas de documentos cuyo cargo SÍ está en el libro.
--    DeMas          = DeudaLista − DebeSegunSaldo  → plata del cliente sin imputar.
--    DeudaSinCargo  = deudas de documentos sin cargo en el libro: es OTRO problema y
--                     hace que DeMas no sea confiable en esa cuenta (revisar a mano).
--    CausaProbable  = pista para ordenar el trabajo, no un diagnóstico cerrado.
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('tempdb..#Gral') IS NOT NULL DROP TABLE #Gral;

;WITH Cta AS (
    SELECT cc.CueIdCuenta, cc.CliIdCliente, cc.MonIdMoneda,
           SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                WHERE m.CueIdCuenta = cc.CueIdCuenta
                                  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
           CobroOrdenSinFacturar = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                WHERE m.CueIdCuenta = cc.CueIdCuenta
                                  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                  AND m.MovImporte > 0
                                  AND m.OrdIdOrden IS NOT NULL
                                  AND m.DocIdDocumento IS NULL
                                  -- solo si la orden tiene su cargo (ORDEN) todavía SIN factura
                                  AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta o
                                              WHERE o.OrdIdOrden = m.OrdIdOrden
                                                AND o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                                                AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
                                                AND o.DocIdDocumento IS NULL)), 0),
           DeudaLista = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                                WHERE dd.CueIdCuenta = cc.CueIdCuenta
                                  AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                                  AND dd.DDeImportePendiente > 0.01
                                  AND dd.DocIdDocumento IS NOT NULL
                                  AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                                              WHERE m.DocIdDocumento = dd.DocIdDocumento
                                                AND m.CueIdCuenta = dd.CueIdCuenta
                                                AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                                AND m.MovImporte < 0)), 0),
           DeudaSinCargo = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                                WHERE dd.CueIdCuenta = cc.CueIdCuenta
                                  AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                                  AND dd.DDeImportePendiente > 0.01
                                  AND dd.DocIdDocumento IS NOT NULL
                                  AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                                              WHERE m.DocIdDocumento = dd.DocIdDocumento
                                                AND m.CueIdCuenta = dd.CueIdCuenta
                                                AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                                AND m.MovImporte < 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueTipo LIKE 'DINERO%'
)
SELECT  c.*,
        DebeSegunSaldo = CASE WHEN c.SaldoLibro - c.CobroOrdenSinFacturar < 0
                              THEN -(c.SaldoLibro - c.CobroOrdenSinFacturar) ELSE 0 END
INTO #Gral
FROM Cta c;

SELECT  Cliente        = RTRIM(cl.Nombre),
        g.CliIdCliente,
        g.CueIdCuenta,
        Moneda         = CASE WHEN g.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
        SaldoLibro     = CAST(g.SaldoLibro AS DECIMAL(18,2)),
        DebeSegunSaldo = CAST(g.DebeSegunSaldo AS DECIMAL(18,2)),
        DeudaLista     = CAST(g.DeudaLista AS DECIMAL(18,2)),
        DeMas          = CAST(g.DeudaLista - g.DebeSegunSaldo AS DECIMAL(18,2)),
        DeudaSinCargo  = CAST(g.DeudaSinCargo AS DECIMAL(18,2)),
        CausaProbable  = CASE
            WHEN g.DeudaSinCargo > 0.01 THEN 'REVISAR A MANO (hay deudas sin cargo en el libro)'
            -- Solo si ESE cierre sigue con deuda viva (un cierre cruzado viejo ya resuelto no cuenta)
            WHEN EXISTS (SELECT 1 FROM #Cross x
                         JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = x.DocIdDocumento
                                                   AND dd.CueIdCuenta = x.CueIdCuenta
                                                   AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                                                   AND dd.DDeImportePendiente > 0.01
                         WHERE x.CueIdCuenta = g.CueIdCuenta AND x.SaldoPrevio > 0.01)
                 THEN 'CIERRE EN OTRA MONEDA con adelanto (esta causa)'
            -- Pagos asentados en esta cuenta de documentos cuyo cargo está en OTRA cuenta (ej. pago
            -- en pesos de una factura cargada en la cuenta en dólares): no es plata a favor
            WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta p
                         WHERE p.CueIdCuenta = g.CueIdCuenta
                           AND (p.MovAnulado IS NULL OR p.MovAnulado = 0)
                           AND p.MovTipo IN ('PAGO','PAGO_CRUZADO')
                           AND p.MovImporte > 0
                           AND p.DocIdDocumento IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta c
                                           WHERE c.DocIdDocumento = p.DocIdDocumento
                                             AND c.CueIdCuenta = p.CueIdCuenta
                                             AND (c.MovAnulado IS NULL OR c.MovAnulado = 0)
                                             AND c.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                             AND c.MovImporte < 0))
                 THEN 'PAGO DE FACTURA CARGADA EN OTRA CUENTA (no es plata a favor, a mano)'
            WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                         WHERE m.CueIdCuenta = g.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                           AND m.MovTipo IN ('AJUSTE_POS','AJUSTE_NEG','TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA'))
                 THEN 'Ajustes / transferencias manuales en la cuenta'
            ELSE 'Adelanto o pago sin imputar (otra vía)'
        END
FROM #Gral g
JOIN dbo.Clientes cl ON cl.CliIdCliente = g.CliIdCliente
WHERE g.DeudaLista - g.DebeSegunSaldo > 1
ORDER BY g.DeudaLista - g.DebeSegunSaldo DESC;


-- ────────────────────────────────────────────────────────────────────────────
-- 4) RESUMEN
-- ────────────────────────────────────────────────────────────────────────────
SELECT  Que = 'Cierres en otra moneda (desde siempre)',
        Total                      = COUNT(*),
        ConAdelantoEnCuentaDestino = SUM(CASE WHEN f.SaldoPrevio > 0.01 THEN 1 ELSE 0 END),
        TodaviaSinImputar          = SUM(CASE WHEN f.SaldoPrevio > 0.01 AND f.DeudaViva = 1 AND f.ExcesoCuenta > 0.01
                                              THEN 1 ELSE 0 END)
FROM (
    SELECT  x.SaldoPrevio,
            DeudaViva = CASE WHEN EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd
                                          WHERE dd.DocIdDocumento = x.DocIdDocumento
                                            AND dd.CueIdCuenta = x.CueIdCuenta
                                            AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                                            AND dd.DDeImportePendiente > 0.01) THEN 1 ELSE 0 END,
            e.ExcesoCuenta
    FROM #Cross x
    JOIN #CtaExceso e ON e.CueIdCuenta = x.CueIdCuenta
) f;

SELECT  Que     = 'Barrido general: cuentas con deuda de más (> 1)',
        Moneda  = CASE WHEN g.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
        Cuentas = COUNT(*),
        Clientes = COUNT(DISTINCT g.CliIdCliente),
        DeMasTotal = CAST(SUM(g.DeudaLista - g.DebeSegunSaldo) AS DECIMAL(18,2)),
        CuentasConfiables = SUM(CASE WHEN g.DeudaSinCargo <= 0.01 THEN 1 ELSE 0 END)
FROM #Gral g
WHERE g.DeudaLista - g.DebeSegunSaldo > 1
GROUP BY g.MonIdMoneda;

DROP TABLE #Cross;
DROP TABLE #CtaExceso;
DROP TABLE #Gral;
