-- ============================================================================
-- diag_cliente.sql          SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- Radiografia completa de un cliente: sus cuentas, de que esta hecho cada saldo,
-- que documentos deben de verdad y que ruido hay encima.
--
-- Poner el nombre (o el codigo) abajo y correr todo.
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Nombre VARCHAR(60) = 'elea';    -- nombre o codigo del cliente
DECLARE @Cli INT;

SELECT TOP 1 @Cli = cl.CliIdCliente
FROM dbo.Clientes cl
WHERE RTRIM(cl.Nombre) = @Nombre OR RTRIM(cl.IDCliente) = @Nombre
ORDER BY CASE WHEN RTRIM(cl.Nombre) = @Nombre THEN 0 ELSE 1 END;

IF @Cli IS NULL
BEGIN
    SELECT Coincidencias = RTRIM(cl.Nombre), Codigo = RTRIM(cl.IDCliente), cl.CliIdCliente
    FROM dbo.Clientes cl WHERE RTRIM(cl.Nombre) LIKE '%' + @Nombre + '%';
    RAISERROR('No hay un cliente exacto con ese nombre/codigo. Arriba estan las coincidencias.', 16, 1);
    RETURN;
END

-- ── 1 · Quien es y como estan sus cuentas ──────────────────────────────────
SELECT Panel = '1 - CLIENTE', cl.CliIdCliente, Nombre = RTRIM(cl.Nombre), Codigo = RTRIM(cl.IDCliente),
       Tipo = CASE cl.TClIdTipoCliente WHEN 1 THEN 'Comun' WHEN 2 THEN 'Semanal'
                   WHEN 3 THEN 'Rollo adelantado' WHEN 4 THEN 'Deudor' ELSE 'sin tipo' END
FROM dbo.Clientes cl WHERE cl.CliIdCliente = @Cli;

SELECT Panel = '1 - CUENTAS', cc.CueIdCuenta, cc.CueTipo,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoReal = CAST(s.Saldo AS DECIMAL(18,2)),
       Estado = CASE WHEN s.Saldo < -0.01 THEN 'DEBE' WHEN s.Saldo > 0.01 THEN 'a favor' ELSE 'en cero' END,
       ColumnaGuardada = CAST(cc.CueSaldoActual AS DECIMAL(18,2))   -- suele estar mal, es informativa
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY ABS(s.Saldo) DESC;

-- ── 2 · Documento por documento, con veredicto ─────────────────────────────
;WITH PorCuenta AS (
    SELECT m.DocIdDocumento, m.CueIdCuenta,
           Cargo = ABS(SUM(CASE WHEN m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m.MovImporte < 0 THEN m.MovImporte ELSE 0 END)),
           Cobro = SUM(CASE WHEN m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND m.MovImporte > 0 THEN m.MovImporte ELSE 0 END)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.DocIdDocumento IS NOT NULL AND cc.CueTipo LIKE 'DINERO%'
      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
    GROUP BY m.DocIdDocumento, m.CueIdCuenta
), Res AS (
    SELECT d.DocIdDocumento, d.DocSerie, d.DocNumero, d.DocTipo, d.DocFechaEmision,
           d.DocTotal, d.MonIdMoneda, d.DocPagado, d.CfeEstado,
           CtaCargo  = MIN(CASE WHEN p.Cargo > 0.01 THEN p.CueIdCuenta END),
           CtaCobro  = MIN(CASE WHEN p.Cobro > 0.01 THEN p.CueIdCuenta END),
           Cargo     = SUM(p.Cargo),
           Cobro     = SUM(p.Cobro),
           Partido   = CASE WHEN MIN(CASE WHEN p.Cargo > 0.01 THEN p.CueIdCuenta END)
                               <> MIN(CASE WHEN p.Cobro > 0.01 THEN p.CueIdCuenta END) THEN 1 ELSE 0 END,
           DeudaViva = ISNULL((SELECT SUM(x.DDeImportePendiente) FROM dbo.DeudaDocumento x
                               WHERE x.DocIdDocumento = d.DocIdDocumento
                                 AND x.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')), 0),
           Anticipo  = ISNULL((SELECT SUM(ip.ImpImporte) FROM dbo.ImputacionPago ip
                               JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
                               JOIN dbo.Pagos pg ON pg.PagIdPago = ip.PagIdPago
                               WHERE dd.DocIdDocumento = d.DocIdDocumento
                                 AND pg.PagTipoMovimiento = 'ANTICIPO_APLICADO'
                                 AND pg.PagTcaIdTransaccion IS NULL), 0)
    FROM dbo.DocumentosContables d
    LEFT JOIN PorCuenta p ON p.DocIdDocumento = d.DocIdDocumento
    WHERE d.CliIdCliente = @Cli AND ISNULL(d.DocEstado,'') <> 'ANULADO'
    GROUP BY d.DocIdDocumento, d.DocSerie, d.DocNumero, d.DocTipo, d.DocFechaEmision,
             d.DocTotal, d.MonIdMoneda, d.DocPagado, d.CfeEstado
)
SELECT Panel = '2 - DOCUMENTOS',
       Documento = RTRIM(r.DocSerie) + '-' + RTRIM(r.DocNumero),
       Fecha = CAST(r.DocFechaEmision AS DATE),
       Moneda = CASE WHEN r.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Total = CAST(r.DocTotal AS DECIMAL(18,2)),
       Cargo = CAST(ISNULL(r.Cargo,0) AS DECIMAL(18,2)),
       Cobro = CAST(ISNULL(r.Cobro,0) AS DECIMAL(18,2)),
       r.CtaCargo, r.CtaCobro,
       DeudaViva = CAST(r.DeudaViva AS DECIMAL(18,2)),
       PagadoConSaldoAFavor = CAST(r.Anticipo AS DECIMAL(18,2)),
       Veredicto = CASE
         WHEN r.Partido = 1
              THEN 'PARTIDO - cargo y cobro en cuentas de distinta moneda'
         WHEN ISNULL(r.Cargo,0) <= 0.01 AND r.DeudaViva > 0.01
              THEN 'SIN CARGO - hay deuda pero el cargo no esta en ninguna cuenta'
         WHEN ISNULL(r.Cargo,0) <= 0.01
              THEN 'SIN CARGO en la cuenta corriente'
         WHEN ABS(ISNULL(r.Cargo,0) - r.DocTotal) > 0.05
              THEN 'CARGO <> TOTAL del documento'
         WHEN r.DeudaViva > 0.01 THEN 'DEBE ' + CONVERT(VARCHAR(30), CAST(r.DeudaViva AS DECIMAL(18,2)))
         WHEN r.Anticipo > 0.01 THEN 'ok - lo pago el saldo a favor de la cuenta'
         WHEN ISNULL(r.Cobro,0) >= ISNULL(r.Cargo,0) - 0.05 THEN 'ok - cobrado'
         ELSE 'ok' END
FROM Res r
ORDER BY r.DocFechaEmision DESC;

-- ── 3 · Movimientos SIN documento: cruces de moneda y cobros sueltos ───────
-- Aca aparecen las "coberturas" que dejan plata a favor de la nada.
SELECT Panel = '3 - SIN DOCUMENTO', m.MovIdMovimiento, m.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)), Fecha = m.MovFecha,
       TieneRecibo = CASE WHEN p.PagTcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END,
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 55),
       Observaciones = LEFT(ISNULL(m.MovObservaciones,''), 45)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
WHERE cc.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.DocIdDocumento IS NULL AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY m.MovFecha DESC;

-- ── 4 · Recibos de caja del cliente vs su rastro en la cuenta ──────────────
-- Un recibo COBRADO sin movimiento en la cuenta = plata cobrada que el libro no
-- registro. Un recibo por 0 = recibo emitido al pedo.
SELECT Panel = '4 - RECIBOS DE CAJA',
       Recibo = RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc),
       t.TcaIdTransaccion, Fecha = t.TcaFecha, t.TcaEstado,
       Cobrado = CAST(t.TcaTotalCobrado AS DECIMAL(18,2)), t.TcaMonedaBase,
       PagosDelRecibo = ISNULL((SELECT SUM(p.PagMontoPago) FROM dbo.Pagos p
                                WHERE p.PagTcaIdTransaccion = t.TcaIdTransaccion), 0),
       EnLaCuenta = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            JOIN dbo.Pagos p2 ON p2.PagIdPago = m.PagIdPago
                            WHERE p2.PagTcaIdTransaccion = t.TcaIdTransaccion
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0),
       -- OJO: muchos cobros viejos se asentaron SIN PagIdPago, asi que "no tiene
       -- vinculo" no significa que falte la plata. Por eso se busca ademas un
       -- movimiento del mismo importe en +-2 dias antes de gritar.
       MovParecido = ISNULL((SELECT TOP 1 CAST(m.MovImporte AS DECIMAL(18,2))
                             FROM dbo.MovimientosCuenta m
                             JOIN dbo.CuentasCliente c2 ON c2.CueIdCuenta = m.CueIdCuenta
                             WHERE c2.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                               AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
                               AND ABS(m.MovImporte - t.TcaTotalCobrado) <= 0.05
                               AND ABS(DATEDIFF(DAY, m.MovFecha, t.TcaFecha)) <= 2), 0),
       Alerta = CASE
         WHEN ABS(t.TcaTotalCobrado) <= 0.01 THEN 'recibo por CERO'
         WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                      JOIN dbo.Pagos p3 ON p3.PagIdPago = m.PagIdPago
                      WHERE p3.PagTcaIdTransaccion = t.TcaIdTransaccion
                        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) THEN ''
         WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                      JOIN dbo.CuentasCliente c3 ON c3.CueIdCuenta = m.CueIdCuenta
                      WHERE c3.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                        AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
                        AND ABS(m.MovImporte - t.TcaTotalCobrado) <= 0.05
                        AND ABS(DATEDIFF(DAY, m.MovFecha, t.TcaFecha)) <= 2)
              THEN 'sin vinculo al recibo, pero el cobro esta (ver MovParecido)'
         ELSE 'COBRADO Y NO APARECE EN LA CUENTA' END
FROM dbo.TransaccionesCaja t
WHERE t.TcaClienteId = @Cli
  AND RTRIM(t.TcaSerieDoc) LIKE 'RC%'
  AND ISNULL(t.TcaEstado,'') NOT IN ('ANULADO','ANULADA')
ORDER BY t.TcaFecha DESC;
