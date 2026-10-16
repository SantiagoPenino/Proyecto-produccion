-- ============================================================================
-- diag_documento_nacio_pagado.sql        SOLO LECTURA - no toca nada
-- ----------------------------------------------------------------------------
-- Un documento de cierre que aparece con CARGO, sin ABONO y con el sello
-- "Pagado" puede ser dos cosas MUY distintas:
--
--   (A) BIEN. El cliente ya tenia plata a favor en la cuenta y el cargo se la
--       comio. El cierre marca DocPagado=1 y salda la deuda con un pago de tipo
--       ANTICIPO_APLICADO (tablas Pagos + ImputacionPago). A proposito NO crea
--       un movimiento de abono: el credito ya estaba asentado antes, meterlo de
--       nuevo duplicaria la plata. El "abono" que falta esta mas arriba en el
--       libro, no en la fila del documento.
--
--   (B) MAL. Se marco pagado sin que hubiera plata a favor suficiente. Ahi el
--       cargo queda solo, la cuenta se va a deuda y nadie lo va a cobrar porque
--       el documento dice "Pagado".
--
-- Lo que separa A de B es el saldo que la cuenta tenia ANTES de este cargo.
-- Esta consulta lo calcula y da el veredicto.
--
-- PONER LA SERIE Y EL NUMERO ABAJO Y CORRER TODO.
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Serie  VARCHAR(10) = 'PC';
DECLARE @Numero VARCHAR(20) = '3853';

DECLARE @Doc INT;
SELECT @Doc = d.DocIdDocumento
FROM dbo.DocumentosContables d
WHERE RTRIM(d.DocSerie) = @Serie AND RTRIM(d.DocNumero) = @Numero
  AND ISNULL(d.DocEstado,'') <> 'ANULADO';

IF @Doc IS NULL
BEGIN
    RAISERROR('No existe un documento vivo con esa serie y numero.', 16, 1);
    RETURN;
END

-- ── 1 · El documento ───────────────────────────────────────────────────────
SELECT Panel = '1 - DOCUMENTO',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Cliente   = RTRIM(cl.Nombre),
       TipoCliente = CASE cl.TClIdTipoCliente WHEN 1 THEN 'Comun' WHEN 2 THEN 'Semanal'
                          WHEN 3 THEN 'Rollo adelantado' WHEN 4 THEN 'Deudor' ELSE 'sin tipo' END,
       d.DocTipo, d.DocFechaEmision, d.DocTotal,
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocCotizacion, d.DocPagado, d.DocEstado, d.CfeEstado,
       Ciclo = d.CicIdCiclo,
       CajaAsociada = d.TcaIdTransaccion,
       CuentaDelDoc = d.CueIdCuenta
FROM dbo.DocumentosContables d
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
WHERE d.DocIdDocumento = @Doc;

-- ── 2 · La deuda ───────────────────────────────────────────────────────────
SELECT Panel = '2 - DEUDA', dd.DDeIdDocumento, dd.CueIdCuenta,
       dd.DDeImporteOriginal, dd.DDeImportePendiente, dd.DDeEstado, dd.DDeFechaCobro
FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = @Doc;

-- ── 3 · Que salda esa deuda (imputaciones) ─────────────────────────────────
-- ANTICIPO_APLICADO = "lo pago la plata que ya tenia a favor" (caso A).
SELECT Panel = '3 - IMPUTACIONES', ip.ImpIdImputacion, ip.PagIdPago, ip.ImpImporte, ip.ImpFecha,
       p.PagTipoMovimiento, p.PagMontoPago, CajaDelPago = p.PagTcaIdTransaccion,
       Recibo = CASE WHEN t.TcaIdTransaccion IS NULL THEN '(sin recibo de caja)'
                     ELSE RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc) + ' ' + RTRIM(t.TcaEstado) END
FROM dbo.ImputacionPago ip
JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE dd.DocIdDocumento = @Doc;

-- ── 4 · Los movimientos del documento en la cuenta corriente ───────────────
SELECT Panel = '4 - MOVIMIENTOS', m.MovIdMovimiento, m.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       m.MovTipo, m.MovImporte, m.MovFecha, m.MovAnulado,
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 60),
       Observaciones = LEFT(ISNULL(m.MovObservaciones,''), 60)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE m.DocIdDocumento = @Doc AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY m.MovIdMovimiento;

-- ── 5 · EL VEREDICTO ───────────────────────────────────────────────────────
-- SaldoAntes  = como estaba la cuenta sin los movimientos de este documento.
-- SaldoAhora  = como esta hoy.
;WITH Base AS (
    SELECT d.DocIdDocumento, d.DocTotal, d.DocPagado,
           Cue = ISNULL((SELECT TOP 1 m.CueIdCuenta FROM dbo.MovimientosCuenta m
                         WHERE m.DocIdDocumento = d.DocIdDocumento
                           AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                           AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                           AND m.MovImporte < 0
                         ORDER BY ABS(m.MovImporte) DESC), d.CueIdCuenta)
    FROM dbo.DocumentosContables d WHERE d.DocIdDocumento = @Doc
), Num AS (
    SELECT b.*,
           Cargo = ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                    WHERE m.DocIdDocumento = b.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')), 0)),
           -- OJO: el abono se cuenta SOLO si esta en la MISMA cuenta que el cargo.
           -- Un cobro en la otra moneda no paga nada aca (caso Palmero PC-3551).
           Cobro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                    WHERE m.DocIdDocumento = b.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
                      AND m.CueIdCuenta = b.Cue), 0),
           CobroEnOtraCuenta = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                    WHERE m.DocIdDocumento = b.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')
                      AND m.CueIdCuenta <> b.Cue), 0),
           DeudaViva = ISNULL((SELECT SUM(x.DDeImportePendiente) FROM dbo.DeudaDocumento x
                    WHERE x.DocIdDocumento = b.DocIdDocumento
                      AND x.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')), 0),
           Anticipo = ISNULL((SELECT SUM(ip.ImpImporte) FROM dbo.ImputacionPago ip
                    JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
                    JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
                    WHERE dd.DocIdDocumento = b.DocIdDocumento AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO'), 0),
           SaldoAhora = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                    WHERE m.CueIdCuenta = b.Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
           SaldoAntes = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                    WHERE m.CueIdCuenta = b.Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                      AND ISNULL(m.DocIdDocumento, -1) <> b.DocIdDocumento), 0)
    FROM Base b
)
SELECT Panel = '5 - VEREDICTO', Cuenta = n.Cue,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       n.DocTotal, n.DocPagado, Cargo = n.Cargo, AbonoEnLaCuenta = n.Cobro,
       AbonoEnOtraCuenta = n.CobroEnOtraCuenta,
       AnticipoAplicado = n.Anticipo, n.DeudaViva,
       SaldoAFavorAntes = CAST(n.SaldoAntes AS DECIMAL(18,2)),
       SaldoAhora       = CAST(n.SaldoAhora AS DECIMAL(18,2)),
       Veredicto = CASE
         WHEN n.CobroEnOtraCuenta > 0.01
              THEN 'MAL - DOCUMENTO PARTIDO: el cargo esta en esta cuenta y el abono (' +
                   CONVERT(VARCHAR(30), CAST(n.CobroEnOtraCuenta AS DECIMAL(18,2))) +
                   ') en la cuenta de la otra moneda. Cada cuenta muestra media verdad.'
         WHEN ABS(n.Cargo - n.DocTotal) > 0.02
              THEN 'MAL - el cargo (' + CONVERT(VARCHAR(30), CAST(n.Cargo AS DECIMAL(18,2))) +
                   ') no coincide con el total del documento (' +
                   CONVERT(VARCHAR(30), CAST(n.DocTotal AS DECIMAL(18,2))) + ').'
         WHEN n.DeudaViva > 0.01 AND n.DocPagado = 1
              THEN 'MAL - dice Pagado pero la deuda sigue VIVA. Hay que destildar el pagado o cobrarlo.'
         WHEN n.Cobro >= n.Cargo - 0.02
              THEN 'BIEN - contado: el cierre puso el cargo y su abono espejo.'
         WHEN n.Cobro <= 0.01 AND n.SaldoAntes >= n.Cargo - 0.02
              THEN 'BIEN - lo comio la plata que el cliente YA tenia a favor (' +
                   CONVERT(VARCHAR(30), CAST(n.SaldoAntes AS DECIMAL(18,2))) +
                   '). Por eso no hay abono en la fila: el credito estaba asentado antes.'
         WHEN n.Cobro <= 0.01 AND n.SaldoAntes > 0
              THEN 'MAL - la plata a favor (' + CONVERT(VARCHAR(30), CAST(n.SaldoAntes AS DECIMAL(18,2))) +
                   ') NO alcanzaba para el cargo (' + CONVERT(VARCHAR(30), CAST(n.Cargo AS DECIMAL(18,2))) +
                   '). Nacio pagado de mas y la cuenta queda debiendo la diferencia.'
         WHEN n.Cobro <= 0.01
              THEN 'MAL - nacio Pagado sin ninguna plata a favor y sin abono. Cargo suelto.'
         ELSE 'REVISAR A MANO - cobro parcial.'
       END
FROM Num n JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = n.Cue;

-- ── 6 · El libro de la cuenta, ultimos 25 movimientos ──────────────────────
-- Para ver de donde salia la plata a favor (o confirmar que no habia).
SELECT TOP 25 Panel = '6 - LIBRO', m.MovIdMovimiento, m.MovFecha, m.MovTipo,
       m.MovImporte, m.MovSaldoPosterior,
       Doc = ISNULL(RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), '(sin documento)'),
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 50)
FROM dbo.MovimientosCuenta m
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE m.CueIdCuenta = (SELECT TOP 1 x.CueIdCuenta FROM dbo.MovimientosCuenta x
                       WHERE x.DocIdDocumento = @Doc AND (x.MovAnulado IS NULL OR x.MovAnulado = 0)
                         AND x.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND x.MovImporte < 0
                       ORDER BY ABS(x.MovImporte) DESC)
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY m.MovFecha DESC, m.MovIdMovimiento DESC;
