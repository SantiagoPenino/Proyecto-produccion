-- ============================================================================
-- diag_camilo7008.sql        SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- Correr ESTO antes que PROD_fix_camilo7008.sql.
--
-- CAMILO-7008 (CliIdCliente 4, Semanal) figura con plata a favor en las dos
-- cuentas. Este diagnostico muestra la evidencia de por que no es suya, y al
-- final proyecta como quedaria si se aplica el fix — sin tocar nada.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Cli INT = 4;
DECLARE @CueUsd INT = 11, @CuePesos INT = 1534;

-- ── 1 · Como estan las cuentas hoy ─────────────────────────────────────────
SELECT Panel = '1 - CUENTAS', cc.CueIdCuenta, cc.CueTipo,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoReal = CAST(s.Saldo AS DECIMAL(18,2)),
       Estado = CASE WHEN s.Saldo < -0.01 THEN 'DEBE' WHEN s.Saldo > 0.01 THEN 'a favor' ELSE 'en cero' END
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY ABS(s.Saldo) DESC;

-- ── 2 · (A) PC-2216: lo que dice la cuenta vs lo que cobro la caja ────────
-- El cargo y la deuda dicen 1.540. Los recibos suman 1.540. Los movimientos
-- de cobro dicen 1.050 + 1.050 = 2.100. Sobran 560.
SELECT Panel = '2A - PC-2216 movimientos', m.MovIdMovimiento, m.MovTipo,
       ImporteEnLaCuenta = CAST(m.MovImporte AS DECIMAL(18,2)),
       m.PagIdPago,
       Recibo = ISNULL(RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc), '(sin recibo)'),
       CobradoPorElRecibo = CAST(t.TcaTotalCobrado AS DECIMAL(18,2)),
       t.TcaMonedaBase, FechaRecibo = t.TcaFecha,
       Diferencia = CAST(m.MovImporte - ISNULL(t.TcaTotalCobrado, m.MovImporte) AS DECIMAL(18,2))
FROM dbo.MovimientosCuenta m
LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY m.MovIdMovimiento;

SELECT Panel = '2A - PC-2216 resumen',
       DocTotalDelCabezal = CAST(d.DocTotal AS DECIMAL(18,2)),
       DeudaOriginal = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       CargoEnLaCuenta = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')), 0) AS DECIMAL(18,2)),
       CobrosEnLaCuenta = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo = 'PAGO'), 0) AS DECIMAL(18,2)),
       SumaDeLosRecibos = CAST(ISNULL((SELECT SUM(t2.TcaTotalCobrado) FROM dbo.TransaccionesCaja t2
              WHERE t2.TcaIdTransaccion IN (5992, 5993)), 0) AS DECIMAL(18,2)),
       CajaDelDocumento = CAST((SELECT t3.TcaTotalCobrado FROM dbo.TransaccionesCaja t3
              WHERE t3.TcaIdTransaccion = d.TcaIdTransaccion) AS DECIMAL(18,2)),
       Sobra = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo = 'PAGO'), 0) - dd.DDeImporteOriginal AS DECIMAL(18,2))
FROM dbo.DocumentosContables d
JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.DocIdDocumento = 4303;

-- ── 3 · (B) PC-2082: el cargo esta en dolares dentro de la cuenta de pesos ─
SELECT Panel = '2B - PC-2082',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       TotalDelDocumento = CAST(d.DocTotal AS DECIMAL(18,2)),
       MonedaDelDocumento = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       m.MovIdMovimiento, m.MovTipo,
       ImporteDelCargo = CAST(m.MovImporte AS DECIMAL(18,2)),
       m.CueIdCuenta,
       MonedaDeLaCuenta = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       CotizacionImplicita = CAST(d.DocTotal / NULLIF(ABS(m.MovImporte), 0) AS DECIMAL(18,2)),
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 55)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE m.MovIdMovimiento = 18532;

-- El e-Ticket que nombra el concepto, ¿existe?
SELECT Panel = '2B - el ET-1993 que nombra el concepto',
       Existe = CASE WHEN EXISTS (SELECT 1 FROM dbo.DocumentosContables
                                  WHERE RTRIM(DocSerie) = 'ET' AND RTRIM(DocNumero) = '1993')
                     THEN 'SI' ELSE 'NO EXISTE' END;

-- ── 4 · (C) PC-2877: con que se pagaron los 61,50 ─────────────────────────
SELECT Panel = '2C - PC-2877', dd.DDeIdDocumento,
       Original = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       dd.DDeEstado,
       ip.ImpImporte, ip.PagIdPago, p.PagTipoMovimiento,
       TieneCaja = CASE WHEN p.PagTcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END,
       Veredicto = CASE WHEN p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL
                        THEN 'Se pago con el saldo a favor de la cuenta, no con plata que entro'
                        ELSE 'cobro con respaldo' END
FROM dbo.DeudaDocumento dd
LEFT JOIN dbo.ImputacionPago ip ON ip.DDeIdDocumento = dd.DDeIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE dd.DDeIdDocumento = 9018;

-- ── 5 · COMO QUEDARIA si se aplica el fix (proyeccion, no toca nada) ──────
SELECT Panel = '3 - PROYECCION', Cuenta = @CueUsd, Moneda = 'US$',
       SaldoHoy = CAST(s.Saldo AS DECIMAL(18,2)),
       Ajuste = CAST(-560.00 AS DECIMAL(18,2)),
       Motivo = 'los cobros del PC-2216 pasan de 2.100 a 1.540 (lo que cobraron los recibos)',
       SaldoDespues = CAST(s.Saldo - 560.00 AS DECIMAL(18,2))
FROM (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                             WHERE m.CueIdCuenta = @CueUsd AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                               AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
UNION ALL
SELECT Panel = '3 - PROYECCION', Cuenta = @CuePesos, Moneda = '$',
       SaldoHoy = CAST(s.Saldo AS DECIMAL(18,2)),
       Ajuste = CAST(-331.50 AS DECIMAL(18,2)),
       Motivo = 'el cargo del PC-2082 pasa de 8,50 a 340 (su importe real en pesos)',
       SaldoDespues = CAST(s.Saldo - 331.50 AS DECIMAL(18,2))
FROM (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                             WHERE m.CueIdCuenta = @CuePesos AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                               AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s;

SELECT Panel = '3 - PROYECCION deuda', Documento = 'PC-2877',
       PendienteHoy = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       PendienteDespues = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       Motivo = 'los 61,50 salian del saldo a favor que dejaba el PC-2082 mal cargado'
FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = 9018;

-- ── 6 · AUDITORIA COMPLETA: documento por documento, con su respaldo ──────
-- Reconstruye el saldo de las dos cuentas desde cero. La suma de la columna
-- Neto de cada cuenta TIENE que dar el saldo del panel 1.
SELECT Panel = '4 - AUDITORIA',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Fecha = CONVERT(VARCHAR(10), d.DocFechaEmision, 120),
       Cuenta = q.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       TotalDoc = CAST(d.DocTotal AS DECIMAL(18,2)),
       Cargo = CAST(q.Cargo AS DECIMAL(18,2)),
       Cobro = CAST(q.Cobro AS DECIMAL(18,2)),
       Neto  = CAST(q.Cargo + q.Cobro AS DECIMAL(18,2)),
       CobroDeCaja = CAST(ISNULL(q.CajaRecibos, 0) AS DECIMAL(18,2)),
       PagadoConSaldoAFavor = CAST(ISNULL(q.Anticipo, 0) AS DECIMAL(18,2)),
       DeudaViva = CAST(ISNULL(q.DeudaViva, 0) AS DECIMAL(18,2)),
       Veredicto = CASE
         -- Una nota de credito no lleva cargo: es credito puro. Va PRIMERO, si no
         -- cae en "el cargo no es el total" y parece un error cuando esta bien.
         WHEN RTRIM(d.DocSerie) = 'NC'
              THEN 'OK - nota de credito: queda a favor del cliente'
         WHEN ABS(q.Cargo + q.Cobro) <= 0.01 THEN 'OK - netea en cero'
         WHEN ABS(ABS(q.Cargo) - d.DocTotal) > 0.01
              THEN 'REVISAR - el cargo (' + CONVERT(VARCHAR(20), CAST(ABS(q.Cargo) AS DECIMAL(18,2)))
                   + ') no es el total del documento (' + CONVERT(VARCHAR(20), CAST(d.DocTotal AS DECIMAL(18,2))) + ')'
         WHEN q.Cobro > ABS(q.Cargo) + 0.01
              THEN 'REVISAR - cobrado de mas'
         -- Cargo sin cobro en la cuenta: puede estar pagado con saldo a favor
         -- (la deuda queda COBRADA y no se crea movimiento) o estar impago.
         WHEN q.Cargo < -0.01 AND q.Cobro <= 0.01
              THEN CASE WHEN EXISTS (
                     SELECT 1 FROM dbo.DeudaDocumento dd2
                     JOIN dbo.ImputacionPago ip2 ON ip2.DDeIdDocumento = dd2.DDeIdDocumento
                     JOIN dbo.Pagos p2 ON p2.PagIdPago = ip2.PagIdPago
                     WHERE dd2.DocIdDocumento = d.DocIdDocumento
                       AND p2.PagTipoMovimiento = 'ANTICIPO_APLICADO'
                       AND p2.PagTcaIdTransaccion IS NULL)
                   THEN 'OK - lo pago el saldo a favor de la cuenta'
                   ELSE 'DEBE ' + CONVERT(VARCHAR(20), CAST(ABS(q.Cargo) AS DECIMAL(18,2))) END
         ELSE 'revisar a mano' END
FROM (
    SELECT m.DocIdDocumento, m.CueIdCuenta,
           Cargo = SUM(CASE WHEN m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN m.MovImporte ELSE 0 END),
           Cobro = SUM(CASE WHEN m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO','NOTA_CREDITO') THEN m.MovImporte ELSE 0 END),
           CajaRecibos = SUM(DISTINCT 0),
           Anticipo = 0, DeudaViva = 0
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc2 ON cc2.CueIdCuenta = m.CueIdCuenta
    WHERE cc2.CliIdCliente = 4 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.DocIdDocumento IS NOT NULL AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
    GROUP BY m.DocIdDocumento, m.CueIdCuenta
) q
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = q.DocIdDocumento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = q.CueIdCuenta
ORDER BY cc.MonIdMoneda DESC, d.DocFechaEmision;
