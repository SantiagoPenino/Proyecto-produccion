-- ============================================================================
-- diag_composicion_saldo_afavor.sql   (SOLO LECTURA — no cambia nada)
-- ----------------------------------------------------------------------------
-- Abre el "saldo a favor" de UN cliente y muestra de dónde salió cada peso.
-- Pensado para el caso SABONIS - ARTEIDEA (RUC 213866340011), que muestra
-- US$ 11.488,77 a favor con un plan de 3.026,12 mts de DTF TEXTIL COMUN.
--
-- La pregunta que contesta: ¿esa plata es un adelanto real que el cliente todavía
-- no consumió, o es un cobro al que le falta su cargo (par roto)?
--
-- En el flujo de rollo adelantado cada compra deja DOS movimientos que se anulan
-- entre sí: el COBRO (+) y el cargo del comprobante (−). Si uno de los dos falta,
-- está anulado, o el consumo se descontó del PLAN DE METROS en vez de la cuenta,
-- la cuenta de dinero queda mostrando plata a favor que ya se entregó en metros.
--
-- Correr los bloques en orden y guardar el output.
-- ============================================================================

DECLARE @Ruc VARCHAR(20) = '213866340011';   -- ← RUC/CI del cliente a mirar

DECLARE @Cli INT;
SELECT TOP 1 @Cli = CliIdCliente FROM dbo.Clientes WHERE RTRIM(ISNULL(CioRuc,'')) = @Ruc;
IF @Cli IS NULL BEGIN RAISERROR('No hay cliente con RUC/CI %s.', 16, 1, @Ruc); RETURN; END

-- ── 1) Las cuentas: saldo guardado vs saldo real del libro vs deudas ────────
--    CueSaldoActual NO es confiable (arrastra las ORDEN). El que manda es SaldoLibro.
SELECT cc.CueIdCuenta,
       cc.CueTipo,
       ISNULL(cc.CueNombre,'PRINCIPAL')                     AS Cuenta,
       cc.CueEsPrincipal,
       CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' WHEN cc.MonIdMoneda = 1 THEN '$' ELSE '—' END AS Moneda,
       cc.CueSaldoActual                                    AS SaldoGuardado_NoConfiable,
       SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
       DeudaViva  = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                            WHERE dd.CueIdCuenta = cc.CueIdCuenta
                              AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')), 0),
       OrdenesSinFacturar = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                              AND m.DocIdDocumento IS NULL), 0)
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli
ORDER BY cc.CueTipo, cc.CueEsPrincipal DESC, cc.CueIdCuenta;

-- ── 2) De qué está hecho el saldo: total por tipo de movimiento ─────────────
--    Si PAGO/COBRO/ANTICIPO suma mucho más que los cargos (VTA_CAJA/CIERRE_CICLO),
--    la diferencia ES el saldo a favor. Acá se ve si el desbalance es de un tipo.
SELECT m.CueIdCuenta,
       m.MovTipo,
       Movs   = COUNT(*),
       Total  = SUM(m.MovImporte),
       Desde  = MIN(m.MovFecha),
       Hasta  = MAX(m.MovFecha)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli
  AND cc.CueTipo LIKE 'DINERO%'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
GROUP BY m.CueIdCuenta, m.MovTipo
ORDER BY m.CueIdCuenta, Total DESC;

-- ── 3) Los cobros grandes y si tienen su cargo del otro lado ────────────────
--    ParDelDocumento = el cargo (negativo) que tiene el MISMO documento en la
--    misma cuenta. Si viene 0 o NULL en un cobro grande, ahí está la plata suelta.
SELECT TOP 40
       m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte, m.MovFecha,
       m.DocIdDocumento,
       Documento = ISNULL(RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), '(sin documento)'),
       DocTipo   = RTRIM(ISNULL(d.DocTipo,'')),
       DocTotal  = d.DocTotal,
       -- El cargo del comprobante. Las ORDEN quedan fuera a propósito: son el detalle
       -- de cada trabajo, no el cargo de la factura (contarlas duplicaría el importe).
       ParDelDocumento = ISNULL((SELECT SUM(m2.MovImporte) FROM dbo.MovimientosCuenta m2
                                 WHERE m2.DocIdDocumento = m.DocIdDocumento
                                   AND m2.CueIdCuenta = m.CueIdCuenta
                                   AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)
                                   AND m2.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                                   AND m2.MovImporte < 0), 0),
       Imputado = ISNULL((SELECT SUM(ip.ImpImporte) FROM dbo.ImputacionPago ip
                          WHERE ip.PagIdPago = m.PagIdPago), 0),
       Concepto = LEFT(m.MovConcepto, 70)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE cc.CliIdCliente = @Cli
  AND cc.CueTipo LIKE 'DINERO%'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovImporte > 0
ORDER BY m.MovImporte DESC;

-- ── 4) Pares rotos: documentos con cobro pero sin cargo (o al revés) ────────
--    Cada fila con Neto <> 0 es un documento que dejó saldo. La suma de los Neto
--    positivos tiene que explicar el saldo a favor.
SELECT m.CueIdCuenta,
       m.DocIdDocumento,
       Documento = ISNULL(RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), '(sin documento)'),
       DocTipo   = RTRIM(ISNULL(d.DocTipo,'')),
       DocTotal  = d.DocTotal,
       DocAnulado = CASE WHEN d.DocEstado = 'ANULADO' THEN 'SI' ELSE '' END,
       Cargos    = SUM(CASE WHEN m.MovImporte < 0 THEN m.MovImporte ELSE 0 END),
       Cobros    = SUM(CASE WHEN m.MovImporte > 0 THEN m.MovImporte ELSE 0 END),
       Neto      = SUM(m.MovImporte)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE cc.CliIdCliente = @Cli
  AND cc.CueTipo LIKE 'DINERO%'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
GROUP BY m.CueIdCuenta, m.DocIdDocumento, d.DocSerie, d.DocNumero, d.DocTipo, d.DocTotal, d.DocEstado
HAVING ABS(SUM(m.MovImporte)) > 0.01
ORDER BY SUM(m.MovImporte) DESC;

-- ── 5) Movimientos ANULADOS: el clásico "quedó vivo el cobro, se anuló el cargo" ──
SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte, m.MovFecha,
       m.DocIdDocumento, Concepto = LEFT(m.MovConcepto, 70),
       HermanoVivo = ISNULL((SELECT SUM(m2.MovImporte) FROM dbo.MovimientosCuenta m2
                             WHERE m2.DocIdDocumento = m.DocIdDocumento
                               AND m2.CueIdCuenta = m.CueIdCuenta
                               AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)), 0)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli
  AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovAnulado = 1
ORDER BY m.MovIdMovimiento DESC;

-- ── 6) El otro lado del rollo adelantado: los metros ────────────────────────
--    Si la plata a favor ya se entregó en metros, el plan lo muestra: se pagó una
--    vez (dinero) y se consume del plan, no de la cuenta de dinero.
SELECT pm.*
FROM dbo.PlanesMetros pm
WHERE pm.CliIdCliente = @Cli
ORDER BY pm.PlaIdPlan DESC;

-- ── 7) Cuenta de METROS (MTS): su libro, por si el consumo va por acá ───────
SELECT TOP 40 m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte, m.MovFecha,
       m.DocIdDocumento, m.MovAnulado, Concepto = LEFT(m.MovConcepto, 70)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
WHERE cc.CliIdCliente = @Cli
  AND cc.CueTipo IN ('MTS','KG')
ORDER BY m.MovIdMovimiento DESC;
