-- ============================================================================
-- diag_camilo_donde_estoy.sql        SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- Dice en que punto quedo CAMILO-7008 y QUE FALTA CORRER.
-- Con tantos scripts encima, esto ordena.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Cli INT = 4;

-- ── 1 · Los saldos de hoy ──────────────────────────────────────────────────
SELECT Panel = '1 - SALDOS', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (11, 1534);

-- ── 2 · Que paso y que falta, paso por paso ───────────────────────────────
SELECT Panel = '2 - ESTADO', Paso = 'A · PC-2216 (cobros a 520,17 y 1.019,83)',
       Estado = CASE WHEN (SELECT ISNULL(SUM(m.MovImporte),0) FROM dbo.MovimientosCuenta m
                           WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                             AND m.MovTipo = 'PAGO') BETWEEN 1539 AND 1541
                     THEN 'HECHO' ELSE 'FALTA' END,
       Detalle = 'cobros hoy: ' + CONVERT(VARCHAR(20), CAST((SELECT ISNULL(SUM(m.MovImporte),0) FROM dbo.MovimientosCuenta m
                           WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                             AND m.MovTipo = 'PAGO') AS DECIMAL(18,2))) + ' (esperado 1540)'
UNION ALL
SELECT Panel = '2 - ESTADO', Paso = 'B · PC-2082 (cargo a -340)',
       Estado = CASE WHEN ABS(ISNULL((SELECT m.MovImporte FROM dbo.MovimientosCuenta m WHERE m.MovIdMovimiento = 18532), 0) + 340) <= 0.01
                     THEN 'HECHO' ELSE 'FALTA' END,
       Detalle = 'cargo hoy: ' + CONVERT(VARCHAR(20), CAST(ISNULL((SELECT m.MovImporte FROM dbo.MovimientosCuenta m WHERE m.MovIdMovimiento = 18532), 0) AS DECIMAL(18,2))) + ' (esperado -340)'
UNION ALL
SELECT Panel = '2 - ESTADO', Paso = 'C · PC-2877 (deuda 270 PENDIENTE)',
       Estado = CASE WHEN (SELECT dd.DDeImportePendiente FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = 9018) >= 269.99
                     THEN 'HECHO' ELSE 'FALTA' END,
       Detalle = 'pendiente hoy: ' + CONVERT(VARCHAR(20), CAST(ISNULL((SELECT dd.DDeImportePendiente FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = 9018),0) AS DECIMAL(18,2))) + ' (esperado 270)'
UNION ALL
SELECT Panel = '2 - ESTADO', Paso = 'DEVOLUCION NC-11 (egreso + movimiento)',
       Estado = CASE WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta
                                  WHERE CueIdCuenta = 11 AND (MovAnulado IS NULL OR MovAnulado = 0)
                                    AND MovObservaciones LIKE '%DEVOLUCION_NC11%')
                     THEN 'HECHO' ELSE 'FALTA' END,
       Detalle = ISNULL((SELECT TOP 1 'egreso ' + CONVERT(VARCHAR(20), e.EgrIdEgreso) + ' por ' + CONVERT(VARCHAR(20), CAST(e.EgrMonto AS DECIMAL(18,2))) + ' ' + e.EgrMoneda
                         FROM dbo.EgresosCaja e WHERE e.EgrObservaciones LIKE '%DEVOLUCION_NC11%'
                           AND ISNULL(e.EgrEstado,'') NOT IN ('ANULADO','ANULADA')), 'sin egreso')
UNION ALL
SELECT Panel = '2 - ESTADO', Paso = 'PC-3576 a deuda (+ anular su caja)',
       Estado = CASE WHEN (SELECT dd.DDeImportePendiente FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = 11279) >= 389.90
                     THEN 'HECHO' ELSE 'FALTA' END,
       Detalle = 'pendiente hoy: ' + CONVERT(VARCHAR(20), CAST(ISNULL((SELECT dd.DDeImportePendiente FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = 11279),0) AS DECIMAL(18,2)))
               + ' · caja: ' + ISNULL((SELECT TOP 1 t.TcaEstado FROM dbo.DocumentosContables d
                                       JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = d.TcaIdTransaccion
                                       WHERE d.DocIdDocumento = 9628), 'sin caja');

-- ── 3 · Los tres documentos ───────────────────────────────────────────────
SELECT Panel = '3 - LOS TRES', Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Total = CAST(d.DocTotal AS DECIMAL(18,2)), d.DocPagado,
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)), dd.DDeEstado,
       Caja = ISNULL((SELECT TOP 1 t.TcaEstado FROM dbo.TransaccionesCaja t
                      WHERE t.TcaIdTransaccion = d.TcaIdTransaccion), 'sin caja')
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2877','3576','4026')
ORDER BY d.DocFechaEmision;

-- ── 4 · QUE CORRER AHORA ──────────────────────────────────────────────────
SELECT Panel = '4 - QUE CORRER',
       Siguiente = CASE
         WHEN (SELECT ISNULL(SUM(m.MovImporte),0) FROM dbo.MovimientosCuenta m
               WHERE m.DocIdDocumento = 4303 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo = 'PAGO') NOT BETWEEN 1539 AND 1541
              THEN 'PROD_fix_camilo7008_ABC.sql'
         WHEN (SELECT dd.DDeImportePendiente FROM dbo.DeudaDocumento dd WHERE dd.DDeIdDocumento = 11279) < 389.90
              THEN 'PROD_camilo_pc3576_a_deuda.sql'
         ELSE 'NADA - CAMILO ya esta cerrado' END,
       SaldoUsdHoy = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = 11 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       SaldoUsdEsperadoAlFinal = CAST(-421.72 AS DECIMAL(18,2)),
       SaldoPesosHoy = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.CueIdCuenta = 1534 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS DECIMAL(18,2)),
       SaldoPesosEsperadoAlFinal = CAST(-270.00 AS DECIMAL(18,2));
