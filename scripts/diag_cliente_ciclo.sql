/* ============================================================================
   DIAGNOSTICO DE UN CLIENTE CON CICLO - SOLO LECTURA. No escribe nada.

   Generalizacion del que se uso con Martina Berriel. Se cambia el cliente en las
   dos variables de abajo y listo. Devuelve 7 bloques; el 7 es nuevo.

   COMO SE LEE:
     Bloque 1 - las dos verdades tienen que decir lo mismo. SaldoLibro negativo =
                lo que debe. DeudaViva = lo que el sistema le va a cobrar. Si no
                coinciden, la diferencia esta en el bloque 3.
     Bloque 3 - un documento sano netea CERO en su moneda: el cargo y el cobro se
                cancelan. Los que no netean son los tres casos posibles: factura
                impaga (cargo sin cobro, correcto), cargo en una moneda y cobro en
                la otra, o cargo distinto del total del documento.
     Bloque 4 - mas de una deuda por documento, o Original distinto de DocTotal,
                es sintoma.
     Bloque 5 - un ANTICIPO_APLICADO no escribe en el libro, a proposito. Si la
                columna de cobros del libro da 0, ese pago no existio: la deuda se
                mato consumiendo un saldo a favor. Hay que ver si era real.
     Bloque 6 - CicTotalOrdenes contra las ordenes reales del ciclo. Si el ciclo
                dice mas, conto como orden algo que no lo es (tipico: un cruce).
     Bloque 7 - EL QUE MAS DUELE. Ordenes sin facturar cuya cuenta esta en una
                moneda distinta a la del ciclo que las va a facturar. El cierre
                junta las ordenes SOLO por CicIdCiclo, sin mirar cuenta ni moneda
                (contabilidadService ~4451), asi que esos importes se facturan
                como si fueran de la moneda del ciclo. Caso CR SPORT EMB-4353.

   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   ============================================================================ */

SET NOCOUNT ON;

/* ---- EL CLIENTE VA ACA ---------------------------------------------------
   Se usan los dos juntos porque ni el nombre ni el RUC alcanzan: hay clientes
   repetidos y RUC compartidos entre fichas distintas.                        */
DECLARE @IDCliente  VARCHAR(60) = 'ELEA';
DECLARE @CodCliente VARCHAR(30) = '126101';
/* ------------------------------------------------------------------------- */

SELECT Servidor = @@SERVERNAME, Base = DB_NAME();

DECLARE @Cli INT, @N INT;

SELECT @N = COUNT(*), @Cli = MIN(c.CliIdCliente)
FROM dbo.Clientes c
WHERE RTRIM(ISNULL(c.IDCliente,'')) = @IDCliente
  AND RTRIM(ISNULL(CAST(c.CodCliente AS varchar(30)),'')) = @CodCliente;

IF @N <> 1
BEGIN
    SELECT Coincidencias = RTRIM(c.Nombre), IDCliente = RTRIM(ISNULL(c.IDCliente,'')),
           CodCliente = RTRIM(ISNULL(CAST(c.CodCliente AS varchar(30)),'')), c.CliIdCliente
    FROM dbo.Clientes c WHERE RTRIM(ISNULL(c.IDCliente,'')) = @IDCliente;
    RAISERROR('Se esperaba UN cliente con IDCliente %s y CodCliente %s, y hay %d.', 16, 1, @IDCliente, @CodCliente, @N);
    RETURN;
END

SELECT Bloque = '0 - CLIENTE', CliIdCliente = @Cli,
       Nombre = (SELECT RTRIM(Nombre) FROM dbo.Clientes WHERE CliIdCliente = @Cli),
       Tipo   = (SELECT TClIdTipoCliente FROM dbo.Clientes WHERE CliIdCliente = @Cli);

/* -- 1 . Las cuentas: libro vs guardado vs deuda viva --------------------- */
SELECT Bloque = '1 - CUENTAS',
       cc.CueIdCuenta, cc.CueTipo, cc.CueEsPrincipal, cc.CueActiva,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       Guardado   = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       DeudaViva  = CAST(dv.Viva AS DECIMAL(18,2)),
       DebeSegunLibro = CAST(CASE WHEN s.Saldo < 0 THEN -s.Saldo ELSE 0 END AS DECIMAL(18,2)),
       Diferencia = CAST(dv.Viva - CASE WHEN s.Saldo < 0 THEN -s.Saldo ELSE 0 END AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
               WHERE dd.CueIdCuenta = cc.CueIdCuenta
                 AND dd.DDeEstado NOT IN ('CANCELADA','CANCELADO','PAGADO','COBRADO')), 0)) dv
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

/* -- 2 . El libro de las cuentas de dinero (sin las lineas ORDEN) --------- */
SELECT Bloque = '2 - LIBRO',
       m.MovIdMovimiento, m.CueIdCuenta, cc.CueTipo, m.MovTipo,
       Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       Fecha   = CONVERT(varchar(16), m.MovFecha, 120),
       Doc     = RTRIM(ISNULL(d.DocSerie,'')) + '-' + RTRIM(ISNULL(d.DocNumero,'')),
       m.DocIdDocumento, m.CicIdCiclo,
       Concepto = LEFT(RTRIM(ISNULL(m.MovConcepto,'')), 70),
       Obs      = LEFT(RTRIM(ISNULL(m.MovObservaciones,'')), 60)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY m.CueIdCuenta, m.MovFecha, m.MovIdMovimiento;

/* -- 3 . Documento por documento: cargo vs cobro -------------------------- */
SELECT Bloque = '3 - POR DOCUMENTO',
       Doc = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocIdDocumento, Moneda = d.MonIdMoneda,
       DocTotal = CAST(d.DocTotal AS DECIMAL(18,2)), d.DocPagado, d.DocEstado, d.CicIdCiclo,
       Fecha = CONVERT(varchar(10), d.DocFechaEmision, 103),
       CargoPesos = CAST(x.CargoUYU AS DECIMAL(18,2)),
       CobroPesos = CAST(x.CobroUYU AS DECIMAL(18,2)),
       CargoDolar = CAST(x.CargoUSD AS DECIMAL(18,2)),
       CobroDolar = CAST(x.CobroUSD AS DECIMAL(18,2)),
       NetoPesos  = CAST(x.CargoUYU + x.CobroUYU AS DECIMAL(18,2)),
       NetoDolar  = CAST(x.CargoUSD + x.CobroUSD AS DECIMAL(18,2)),
       /* El cargo del libro tendria que ser el total del documento. En blanco para
          los ANULADO, que no tienen cargo vivo a proposito y no son un problema. */
       CargoVsDocTotal = CASE WHEN RTRIM(ISNULL(d.DocEstado,'')) = 'ANULADO' THEN NULL
                              ELSE CAST(ABS(x.CargoUYU + x.CargoUSD) - d.DocTotal AS DECIMAL(18,2)) END
FROM dbo.DocumentosContables d
CROSS APPLY (
    SELECT CargoUYU = ISNULL(SUM(CASE WHEN cc.CueTipo='DINERO_UYU' AND m.MovImporte<0 THEN m.MovImporte END),0),
           CobroUYU = ISNULL(SUM(CASE WHEN cc.CueTipo='DINERO_UYU' AND m.MovImporte>0 THEN m.MovImporte END),0),
           CargoUSD = ISNULL(SUM(CASE WHEN cc.CueTipo='DINERO_USD' AND m.MovImporte<0 THEN m.MovImporte END),0),
           CobroUSD = ISNULL(SUM(CASE WHEN cc.CueTipo='DINERO_USD' AND m.MovImporte>0 THEN m.MovImporte END),0)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE m.DocIdDocumento = d.DocIdDocumento AND cc.CliIdCliente = @Cli
      AND cc.CueTipo LIKE 'DINERO%' AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) x
WHERE d.CliIdCliente = @Cli AND RTRIM(d.DocSerie) <> 'RC'
ORDER BY d.DocFechaEmision;

/* -- 4 . Deudas ----------------------------------------------------------- */
SELECT Bloque = '4 - DEUDAS',
       dd.DDeIdDocumento, dd.CueIdCuenta, dd.DocIdDocumento,
       Doc = RTRIM(ISNULL(d.DocSerie,'')) + '-' + RTRIM(ISNULL(d.DocNumero,'')),
       DocTotal  = CAST(d.DocTotal AS DECIMAL(18,2)),
       Original  = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       dd.DDeEstado,
       Emision = CONVERT(varchar(16), dd.DDeFechaEmision, 120),
       Cobro   = CONVERT(varchar(16), dd.DDeFechaCobro, 120)
FROM dbo.DeudaDocumento dd
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE cc.CliIdCliente = @Cli
ORDER BY dd.DDeIdDocumento;

/* -- 5 . Los pagos que mataron esas deudas -------------------------------- */
SELECT Bloque = '5 - PAGOS vs LIBRO',
       ip.ImpIdImputacion, ip.PagIdPago, ip.DDeIdDocumento, ip.CueIdCuenta,
       Imputado = CAST(ip.ImpImporte AS DECIMAL(18,2)),
       Fecha    = CONVERT(varchar(16), ip.ImpFecha, 120),
       p.PagTipoMovimiento, p.PagTcaIdTransaccion,
       DocDeLaDeuda = RTRIM(ISNULL(d.DocSerie,'')) + '-' + RTRIM(ISNULL(d.DocNumero,'')),
       CobrosEnElLibroDeEseDoc =
           (SELECT COUNT(*) FROM dbo.MovimientosCuenta m
            WHERE m.DocIdDocumento = dd.DocIdDocumento AND m.CueIdCuenta = ip.CueIdCuenta
              AND m.MovImporte > 0 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'))
FROM dbo.ImputacionPago ip
JOIN dbo.DeudaDocumento dd ON dd.DDeIdDocumento = ip.DDeIdDocumento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE cc.CliIdCliente = @Cli
ORDER BY ip.ImpIdImputacion;

/* -- 6 . Los ciclos ------------------------------------------------------- */
SELECT Bloque = '6 - CICLOS',
       c.CicIdCiclo, c.CueIdCuenta, cc.CueTipo, c.CicEstado,
       Inicio = CONVERT(varchar(16), c.CicFechaInicio, 120),
       Cierre = CONVERT(varchar(16), c.CicFechaCierre, 120),
       TotalOrdenes  = CAST(c.CicTotalOrdenes AS DECIMAL(18,4)),
       TotalPagos    = CAST(c.CicTotalPagos AS DECIMAL(18,4)),
       SaldoFacturar = CAST(c.CicSaldoFacturar AS DECIMAL(18,4)),
       c.CicNumeroFactura,
       OrdenesRealesDelCiclo = CAST(o.Reales AS DECIMAL(18,4)),
       OrdenesSinFacturar    = CAST(o.SinDoc AS DECIMAL(18,4))
FROM dbo.CiclosCredito c
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = c.CueIdCuenta
CROSS APPLY (SELECT Reales = ISNULL(SUM(ABS(m.MovImporte)),0),
                    SinDoc = ISNULL(SUM(CASE WHEN m.DocIdDocumento IS NULL THEN ABS(m.MovImporte) END),0)
             FROM dbo.MovimientosCuenta m
             WHERE m.CicIdCiclo = c.CicIdCiclo AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
               AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) o
WHERE c.CliIdCliente = @Cli
ORDER BY c.CicIdCiclo;

/* -- 7 . ORDENES SIN FACTURAR, Y EN QUE MONEDA ESTA CADA UNA --------------
        La columna Alerta marca las que estan en una cuenta de moneda distinta a
        la del ciclo que las va a facturar. Esas se van a facturar con su numero
        crudo, como si fueran de la moneda del ciclo.                          */
SELECT Bloque = '7 - ORDENES SIN FACTURAR',
       Alerta = CASE WHEN ctaMov.MonIdMoneda <> ctaCic.MonIdMoneda
                     THEN '>>> MONEDA DISTINTA A LA DEL CICLO <<<' ELSE '' END,
       m.MovIdMovimiento,
       Ciclo = m.CicIdCiclo, EstadoCiclo = c.CicEstado,
       MonedaDelCiclo  = CASE WHEN ctaCic.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       CuentaDeLaOrden = m.CueIdCuenta,
       MonedaDeLaOrden = CASE WHEN ctaMov.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Importe = CAST(ABS(m.MovImporte) AS DECIMAL(18,2)),
       Fecha   = CONVERT(varchar(16), m.MovFecha, 120),
       Concepto = LEFT(RTRIM(ISNULL(m.MovConcepto,'')), 60)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente ctaMov ON ctaMov.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.CiclosCredito c ON c.CicIdCiclo = m.CicIdCiclo
LEFT JOIN dbo.CuentasCliente ctaCic ON ctaCic.CueIdCuenta = c.CueIdCuenta
WHERE ctaMov.CliIdCliente = @Cli
  AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
  AND m.DocIdDocumento IS NULL
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
ORDER BY CASE WHEN ctaMov.MonIdMoneda <> ctaCic.MonIdMoneda THEN 0 ELSE 1 END,
         m.MovFecha;

/* -- 7b . El resumen del bloque 7: que se va a facturar y que deberia ------ */
SELECT Bloque = '7b - QUE VA A FACTURAR CADA CICLO ABIERTO',
       t.CicIdCiclo, t.CicEstado,
       MonedaDelCiclo = CASE WHEN t.MonCiclo = 2 THEN 'US$' ELSE '$' END,
       VaAFacturar        = CAST(t.Todo AS DECIMAL(18,2)),
       DeLaMonedaDelCiclo = CAST(t.Propias AS DECIMAL(18,2)),
       DeOtraMoneda       = CAST(t.Ajenas AS DECIMAL(18,2)),
       Aviso = CASE WHEN t.Ajenas > 0.01
                    THEN 'Va a facturar ' + CONVERT(varchar(20), CAST(t.Ajenas AS DECIMAL(18,2)))
                       + ' de otra moneda como si fueran de la del ciclo'
                    ELSE 'OK' END
FROM (
    SELECT c.CicIdCiclo, c.CicEstado, MonCiclo = ctaCic.MonIdMoneda,
           Todo    = ISNULL(SUM(ABS(m.MovImporte)), 0),
           Propias = ISNULL(SUM(CASE WHEN ctaMov.MonIdMoneda = ctaCic.MonIdMoneda THEN ABS(m.MovImporte) END), 0),
           Ajenas  = ISNULL(SUM(CASE WHEN ctaMov.MonIdMoneda <> ctaCic.MonIdMoneda THEN ABS(m.MovImporte) END), 0)
    FROM dbo.CiclosCredito c
    JOIN dbo.CuentasCliente ctaCic ON ctaCic.CueIdCuenta = c.CueIdCuenta
    LEFT JOIN dbo.MovimientosCuenta m
           ON m.CicIdCiclo = c.CicIdCiclo AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
          AND m.DocIdDocumento IS NULL AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    LEFT JOIN dbo.CuentasCliente ctaMov ON ctaMov.CueIdCuenta = m.CueIdCuenta
    WHERE c.CliIdCliente = @Cli AND c.CicEstado = 'ABIERTO'
    GROUP BY c.CicIdCiclo, c.CicEstado, ctaCic.MonIdMoneda
) t
ORDER BY t.CicIdCiclo;
