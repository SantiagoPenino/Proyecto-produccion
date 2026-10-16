/* ============================================================================
   DIAGNOSTICO - MARTINA BERRIEL (IDCliente 'Martina Berriel', CodCliente 204101)
   SOLO LECTURA. No escribe nada. Correr en produccion y devolver las 6 tablas.

   Que se esta verificando (medido en la replica local el 09-09-2026, CliId 896):

     cuenta $   1121 : libro +78.179,01 "a favor"  <- NO EXISTE
     cuenta US$  507 : libro  -2.881,85 "debe"     <- TAMPOCO EXISTE

   Son el mismo trabajo partido entre dos monedas, mas dos flecos.

   OJO: el RUC no sirve para identificarla (el 00000007 lo comparten 3 clientes).
   Se resuelve por IDCliente + CodCliente.
   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   ============================================================================ */

SET NOCOUNT ON;

SELECT Servidor = @@SERVERNAME, Base = DB_NAME();

DECLARE @Cli INT;

SELECT @Cli = MIN(c.CliIdCliente)
FROM dbo.Clientes c
WHERE RTRIM(ISNULL(c.IDCliente,'')) = 'Martina Berriel'
  AND RTRIM(ISNULL(CAST(c.CodCliente AS varchar(30)),'')) = '204101';

IF @Cli IS NULL BEGIN RAISERROR('No se encontro el cliente.',16,1); RETURN; END

SELECT Bloque = '0 - CLIENTE', CliIdCliente = @Cli,
       Nombre = (SELECT RTRIM(Nombre) FROM dbo.Clientes WHERE CliIdCliente = @Cli);

/* -- 1 . Las cuentas: libro vs guardado vs deuda viva --------------------- */
SELECT Bloque = '1 - CUENTAS',
       cc.CueIdCuenta, cc.CueTipo, cc.CueEsPrincipal, cc.CueActiva,
       SaldoLibro = CAST(s.Saldo AS DECIMAL(18,2)),
       Guardado   = CAST(cc.CueSaldoActual AS DECIMAL(18,2)),
       DeudaViva  = CAST(dv.Viva AS DECIMAL(18,2)),
       DebeSegunLibro = CAST(CASE WHEN s.Saldo < 0 THEN -s.Saldo ELSE 0 END AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
               WHERE dd.CueIdCuenta = cc.CueIdCuenta
                 AND dd.DDeEstado NOT IN ('CANCELADA','PAGADO','COBRADO')), 0)) dv
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%'
ORDER BY cc.CueIdCuenta;

/* -- 2 . El libro entero de las cuentas de dinero (sin las lineas ORDEN) -- */
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

/* -- 3 . Documento por documento: cargo vs cobro en el libro --------------
        Un documento sano tiene Cargo + Cobro = 0 EN LA MISMA CUENTA.
        Los que no cierran son el problema.                                  */
SELECT Bloque = '3 - POR DOCUMENTO',
       Doc = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocIdDocumento, Moneda = d.MonIdMoneda,
       DocTotal = CAST(d.DocTotal AS DECIMAL(18,2)), d.DocPagado, d.CicIdCiclo,
       CargoPesos = CAST(x.CargoUYU AS DECIMAL(18,2)),
       CobroPesos = CAST(x.CobroUYU AS DECIMAL(18,2)),
       CargoDolar = CAST(x.CargoUSD AS DECIMAL(18,2)),
       CobroDolar = CAST(x.CobroUSD AS DECIMAL(18,2)),
       NetoPesos  = CAST(x.CargoUYU + x.CobroUYU AS DECIMAL(18,2)),
       NetoDolar  = CAST(x.CargoUSD + x.CobroUSD AS DECIMAL(18,2))
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

/* -- 4 . Deudas: cuantas por documento y contra que total -----------------
        Mas de una fila por documento, u Original <> DocTotal, es el sintoma. */
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

/* -- 5 . Los pagos que mataron esas deudas -------------------------------
        Un ANTICIPO_APLICADO no escribe en el libro, a proposito. Lo que hay
        que mirar es si el saldo a favor que consumio era real.              */
SELECT Bloque = '5 - PAGOS vs LIBRO',
       ip.ImpIdImputacion, ip.PagIdPago, ip.DDeIdDocumento, ip.CueIdCuenta,
       Imputado = CAST(ip.ImpImporte AS DECIMAL(18,2)),
       Fecha    = CONVERT(varchar(16), ip.ImpFecha, 120),
       p.PagTipoMovimiento, p.PagTcaIdTransaccion,
       Monto = CAST(p.PagMontoPago AS DECIMAL(18,2)),
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

/* -- 6 . Los ciclos: cuanto dice cada uno que se facturo ------------------
        En local el ciclo 281 suma el cruce automatico como si fuera una orden:
        TotalOrdenes 210,8077 = 9,46 de orden real + 201,3477 del cruce.      */
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
