-- ============================================================================
-- diag_camilo_tres_pendientes.sql        SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- Administracion dice que estos TRES tienen que quedar PENDIENTES:
--       PC-2877  ($   270,00)
--       PC-3576  (US$ 389,91)
--       PC-4026  (US$  31,81)
--
-- Esta consulta muestra como esta cada uno hoy: su cargo, su cobro, su deuda y
-- CON QUE se pago (si es que figura pagado). Con eso se arma el fix exacto.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Cli INT = 4;

-- ── 1 · Los tres documentos ────────────────────────────────────────────────
SELECT Panel = '1 - DOCUMENTOS',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocIdDocumento,
       Fecha = CONVERT(VARCHAR(10), d.DocFechaEmision, 120),
       Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocPagado, d.DocEstado, d.CfeEstado,
       TieneCaja = CASE WHEN d.TcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END,
       CargoEnLaCuenta = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.DocIdDocumento = d.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')), 0) AS DECIMAL(18,2)),
       CobroEnLaCuenta = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.DocIdDocumento = d.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')), 0) AS DECIMAL(18,2))
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli
  AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- ── 2 · La deuda de cada uno y CON QUE se pago ─────────────────────────────
SELECT Panel = '2 - DEUDAS',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       dd.DDeIdDocumento, dd.CueIdCuenta,
       Original = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       dd.DDeEstado,
       Imputacion = ip.ImpIdImputacion,
       ImputadoPor = CAST(ip.ImpImporte AS DECIMAL(18,2)),
       ip.PagIdPago,
       TipoDePago = ISNULL(p.PagTipoMovimiento, '(sin imputacion)'),
       TieneCaja = CASE WHEN p.PagTcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END,
       Recibo = ISNULL(RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc), ''),
       QueEs = CASE
         WHEN ip.ImpIdImputacion IS NULL THEN 'sin imputacion — la deuda esta como esta'
         WHEN p.PagTipoMovimiento = 'ANTICIPO_APLICADO' AND p.PagTcaIdTransaccion IS NULL
              THEN 'SE PAGO CON EL SALDO A FAVOR (no entro plata) — sacar si debe quedar pendiente'
         ELSE 'cobro con respaldo de caja — ESTE NO SE TOCA' END
FROM dbo.DocumentosContables d
JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
LEFT JOIN dbo.ImputacionPago ip ON ip.DDeIdDocumento = dd.DDeIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE d.CliIdCliente = @Cli
  AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- ── 3 · Los movimientos de cobro de esos documentos, con su respaldo ──────
-- Un cobro sin PagIdPago y sin caja, hecho en el mismo segundo que el cargo,
-- es el "pago espejo" que arma el sistema cuando el documento nace CONTADO.
SELECT Panel = '3 - COBROS EN LA CUENTA',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       m.MovIdMovimiento, m.MovTipo,
       Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       m.MovFecha, m.PagIdPago,
       Recibo = ISNULL(RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc), '(sin recibo)'),
       MismoSegundoQueElCargo = CASE WHEN EXISTS (
              SELECT 1 FROM dbo.MovimientosCuenta c
              WHERE c.DocIdDocumento = m.DocIdDocumento
                AND c.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                AND (c.MovAnulado IS NULL OR c.MovAnulado = 0)
                AND ABS(DATEDIFF(SECOND, c.MovFecha, m.MovFecha)) <= 1)
           THEN 'SI — es pago espejo' ELSE 'no' END
FROM dbo.MovimientosCuenta m
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE d.CliIdCliente = @Cli
  AND RTRIM(d.DocSerie) = 'PC' AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
ORDER BY d.DocFechaEmision, m.MovIdMovimiento;

-- ── 4 · Como quedaria el cliente con los tres pendientes ──────────────────
SELECT Panel = '4 - PROYECCION',
       SaldoUsdHoy = CAST(su.Saldo AS DECIMAL(18,2)),
       NotaDeCredito = CAST(541.27 AS DECIMAL(18,2)),
       DeudaUsdSiQuedanPendientes = CAST(389.91 + 31.81 AS DECIMAL(18,2)),
       SaldoUsdNeto = CAST(541.27 - 389.91 - 31.81 AS DECIMAL(18,2)),
       SaldoPesosHoy = CAST(sp.Saldo AS DECIMAL(18,2)),
       DeudaPesos = CAST(270.00 AS DECIMAL(18,2))
FROM (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                             WHERE m.CueIdCuenta = 11 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                               AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) su,
     (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                             WHERE m.CueIdCuenta = 1534 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                               AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) sp;
