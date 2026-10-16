-- ============================================================================
-- diag_cliente_dia.sql          SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- QUE PASO HOY (o el dia que se elija) con un cliente, y si los saldos cierran.
--
-- Poner el nombre y la fecha abajo y correr todo.
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

DECLARE @Nombre VARCHAR(60) = 'CAPA Indumentaria Deportiva';
DECLARE @Dia    DATE        = '2026-09-11';

DECLARE @Cli INT;
SELECT TOP 1 @Cli = cl.CliIdCliente
FROM dbo.Clientes cl
WHERE RTRIM(cl.Nombre) = @Nombre OR RTRIM(cl.IDCliente) = @Nombre
ORDER BY CASE WHEN RTRIM(cl.Nombre) = @Nombre THEN 0 ELSE 1 END;

IF @Cli IS NULL
BEGIN
    SELECT Coincidencias = RTRIM(cl.Nombre), Codigo = RTRIM(cl.IDCliente), cl.CliIdCliente
    FROM dbo.Clientes cl WHERE RTRIM(cl.Nombre) LIKE '%' + @Nombre + '%';
    RAISERROR('No hay cliente exacto con ese nombre. Arriba las coincidencias.', 16, 1);
    RETURN;
END

-- ── 1 · Como estan las cuentas AHORA ──────────────────────────────────────
SELECT Panel = '1 - SALDOS DE HOY', cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoReal = CAST(s.Saldo AS DECIMAL(18,2)),
       Estado = CASE WHEN s.Saldo < -0.01 THEN 'DEBE' WHEN s.Saldo > 0.01 THEN 'a favor' ELSE 'en cero' END,
       ColumnaGuardada = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       Coincide = CASE WHEN ABS(s.Saldo - ISNULL(cc.CueSaldoActual,0)) <= 0.01 THEN 'si' ELSE 'NO — la columna miente' END
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY ABS(s.Saldo) DESC;

-- ── 2 · Documentos emitidos ESE DIA ───────────────────────────────────────
SELECT Panel = '2 - DOCUMENTOS DEL DIA',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocIdDocumento, Hora = CONVERT(VARCHAR(8), d.DocFechaEmision, 108),
       d.DocTipo, Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocPagado, d.DocEstado, d.CfeEstado,
       TieneCaja = CASE WHEN d.TcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END,
       Cargo = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.DocIdDocumento = d.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')), 0) AS DECIMAL(18,2)),
       Cobro = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              WHERE m.DocIdDocumento = d.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO')), 0) AS DECIMAL(18,2)),
       DeudaViva = CAST(ISNULL((SELECT SUM(x.DDeImportePendiente) FROM dbo.DeudaDocumento x
              WHERE x.DocIdDocumento = d.DocIdDocumento
                AND x.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')), 0) AS DECIMAL(18,2)),
       Veredicto = CASE
         WHEN ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                      WHERE m.DocIdDocumento = d.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                        AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')), 0) = 0
              THEN 'SIN CARGO en la cuenta corriente'
         WHEN ABS(ABS(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                      WHERE m.DocIdDocumento = d.DocIdDocumento AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                        AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')), 0)) - d.DocTotal) > 0.05
              THEN 'REVISAR - el cargo no es el total del documento'
         ELSE 'ok' END
FROM dbo.DocumentosContables d
WHERE d.CliIdCliente = @Cli AND CAST(d.DocFechaEmision AS DATE) = @Dia
  AND ISNULL(d.DocEstado,'') <> 'ANULADO'
ORDER BY d.DocFechaEmision;

-- ── 3 · Todo lo que se movio en la cuenta ESE DIA ─────────────────────────
SELECT Panel = '3 - MOVIMIENTOS DEL DIA', m.MovIdMovimiento,
       Hora = CONVERT(VARCHAR(8), m.MovFecha, 108),
       m.CueIdCuenta, Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       Doc = ISNULL(RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), '(sin documento)'),
       Recibo = ISNULL(RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc), '(sin recibo)'),
       CobradoEnCaja = CAST(t.TcaTotalCobrado AS DECIMAL(18,2)),
       Anulado = ISNULL(m.MovAnulado, 0),
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 45)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE cc.CliIdCliente = @Cli AND CAST(m.MovFecha AS DATE) = @Dia
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY m.MovFecha, m.MovIdMovimiento;

-- ── 4 · Cajas del cliente ESE DIA ─────────────────────────────────────────
SELECT Panel = '4 - CAJAS DEL DIA', t.TcaIdTransaccion,
       Hora = CONVERT(VARCHAR(8), t.TcaFecha, 108),
       Recibo = RTRIM(t.TcaSerieDoc) + '-' + RTRIM(t.TcaNumeroDoc),
       t.TcaTipoDocumento,
       Neto = CAST(t.TcaTotalNeto AS DECIMAL(18,2)),
       Cobrado = CAST(t.TcaTotalCobrado AS DECIMAL(18,2)),
       t.TcaMonedaBase, t.TcaEstado, t.EsCajaAdmin,
       AplicadoALaCuenta = CAST(ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
              JOIN dbo.Pagos p2 ON p2.PagIdPago = m.PagIdPago
              WHERE p2.PagTcaIdTransaccion = t.TcaIdTransaccion
                AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0) AS DECIMAL(18,2)),
       Alerta = CASE WHEN ABS(t.TcaTotalCobrado) <= 0.01 THEN 'recibo por CERO' ELSE '' END
FROM dbo.TransaccionesCaja t
WHERE t.TcaClienteId = @Cli AND CAST(t.TcaFecha AS DATE) = @Dia
ORDER BY t.TcaFecha;

-- ── 5 · VERIFICACION: el saldo tiene que salir de los documentos ──────────
-- Suma el neto (cargo + cobro) de TODOS los documentos del cliente, mas lo que
-- se movio sin documento. El total tiene que dar el saldo de cada cuenta.
;WITH PorCuenta AS (
    SELECT m.CueIdCuenta,
           ConDocumento = SUM(CASE WHEN m.DocIdDocumento IS NOT NULL THEN m.MovImporte ELSE 0 END),
           SinDocumento = SUM(CASE WHEN m.DocIdDocumento IS NULL     THEN m.MovImporte ELSE 0 END),
           Total = SUM(m.MovImporte)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND cc.CueTipo LIKE 'DINERO%'
    GROUP BY m.CueIdCuenta
)
SELECT Panel = '5 - DE QUE ESTA HECHO EL SALDO', q.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       PorDocumentos = CAST(q.ConDocumento AS DECIMAL(18,2)),
       SinDocumento  = CAST(q.SinDocumento AS DECIMAL(18,2)),
       SaldoTotal    = CAST(q.Total AS DECIMAL(18,2)),
       Aviso = CASE WHEN ABS(q.SinDocumento) > 0.01
                    THEN 'hay ' + CONVERT(VARCHAR(30), CAST(q.SinDocumento AS DECIMAL(18,2)))
                         + ' que no cuelga de ningun documento — ver panel 6'
                    ELSE 'todo el saldo sale de documentos' END
FROM PorCuenta q
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = q.CueIdCuenta
ORDER BY ABS(q.Total) DESC;

-- ── 6 · Lo que NO cuelga de un documento (ajustes, cruces, cobros sueltos) ─
SELECT Panel = '6 - SIN DOCUMENTO', m.MovIdMovimiento,
       Fecha = CONVERT(VARCHAR(10), m.MovFecha, 120),
       m.CueIdCuenta, Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       TieneRecibo = CASE WHEN p.PagTcaIdTransaccion IS NOT NULL THEN 'SI' ELSE 'no' END,
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 50),
       Observaciones = LEFT(ISNULL(m.MovObservaciones,''), 40)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.Pagos p ON p.PagIdPago = m.PagIdPago
WHERE cc.CliIdCliente = @Cli AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.DocIdDocumento IS NULL AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER BY m.MovFecha DESC;

-- ── 7 · Lo que el cliente DEBE hoy ────────────────────────────────────────
SELECT Panel = '7 - DEUDA VIVA',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Fecha = CONVERT(VARCHAR(10), d.DocFechaEmision, 120),
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       dd.DDeEstado
FROM dbo.DeudaDocumento dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
WHERE cc.CliIdCliente = @Cli
  AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01
ORDER BY d.DocFechaEmision;
