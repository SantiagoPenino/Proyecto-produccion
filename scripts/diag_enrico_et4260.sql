-- ============================================================================
-- diag_enrico_et4260.sql            SOLO LECTURA - no escribe nada
-- ----------------------------------------------------------------------------
-- Enrico Pelaggio / DAB PUBLICIDAD (PLOTEO SRL), cuenta CTA-USD-2385.
--
-- En el Panel 360 se ve esto en la cuenta en dolares:
--
--   06/08 12:17  E-Ticket Contado ET-4260  CARGO   US$ 468,00  ->    468,00
--   06/08 12:17  Cobro            ET-4260  ABONO   US$ 468,00  ->      0,00
--   06/08 19:40  Cobro            ET-4260  ABONO   US$ 468,00  ->    468,00 a favor
--   14/09 17:33  Nota de Credito  NC-25    ABONO   US$ 468,00  ->    936,00 a favor
--
-- Una sola venta de US$ 468, cargada UNA vez y abonada TRES veces. Los dos
-- cobros dicen "pagado $ 19.113,12" cada uno, con siete horas de diferencia.
-- Y encima le hicieron nota de credito a una factura que ya figuraba cobrada.
--
-- Si el cliente pago UNA sola vez, lo que realmente le debemos es US$ 468 por
-- la nota de credito, no US$ 936. Los otros 468 son un cobro fantasma.
--
-- OJO con los numeros de la pantalla: el documento es ET-4260. El "N 49711"
-- que se ve al lado es el numero oficial de DGI, no el numero del documento.
--
-- ----------------------------------------------------------------------------
-- NOTA DE RENDIMIENTO
--   La version anterior cortaba la conexion. TransaccionesCaja no tiene ningun
--   indice salvo la clave primaria, asi que buscar recibos gemelos con un
--   EXISTS correlacionado la recorria ENTERA una vez por cada caja del cliente.
--   Ahora se levanta una sola vez a una tabla temporal y los gemelos salen con
--   una funcion de ventana. Lo mismo los saldos: una sola pasada agrupada en
--   vez de un subquery por cuenta.
--   Corre en READ UNCOMMITTED para no trabar a nadie en produccion.
-- ----------------------------------------------------------------------------
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

DECLARE @Cuenta INT = 2385;
DECLARE @Cli    INT = (SELECT CliIdCliente FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cuenta);
DECLARE @Doc    INT = (SELECT TOP 1 DocIdDocumento FROM dbo.DocumentosContables
                       WHERE CliIdCliente = @Cli AND RTRIM(DocSerie) = 'ET' AND RTRIM(DocNumero) = '4260');

-- ---------------------------------------------------------------------------
-- Se levanta todo una sola vez a temporales. De aca en mas los paneles solo
-- leen estas tablas chicas, no vuelven a tocar las grandes.
-- ---------------------------------------------------------------------------

-- Las cuentas del cliente
CREATE TABLE #Ctas (CueIdCuenta INT PRIMARY KEY, CueTipo VARCHAR(50), MonIdMoneda INT,
                    CueEsPrincipal BIT, ColumnaGuardada DECIMAL(18,4));
INSERT INTO #Ctas
SELECT cc.CueIdCuenta, cc.CueTipo, cc.MonIdMoneda, cc.CueEsPrincipal, cc.CueSaldoActual
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli;

-- Saldo del libro de TODAS sus cuentas, en una sola pasada agrupada
-- (usa IX_MovimientosCuenta_CueIdCuenta)
CREATE TABLE #Lib (CueIdCuenta INT PRIMARY KEY, Saldo DECIMAL(18,4));
INSERT INTO #Lib
SELECT m.CueIdCuenta, SUM(m.MovImporte)
FROM dbo.MovimientosCuenta m
JOIN #Ctas c ON c.CueIdCuenta = m.CueIdCuenta
WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
GROUP BY m.CueIdCuenta;

-- Sus cajas: UN solo recorrido de TransaccionesCaja (no tiene indice util)
CREATE TABLE #Cajas (TcaIdTransaccion INT PRIMARY KEY, TcaFecha DATETIME, Dia DATE,
                     Recibo VARCHAR(60), Neto DECIMAL(18,2), Cobrado DECIMAL(18,2),
                     Moneda VARCHAR(10), Estado VARCHAR(30), UsuarioAnula INT, Obs VARCHAR(200));
INSERT INTO #Cajas
SELECT t.TcaIdTransaccion, t.TcaFecha, CAST(t.TcaFecha AS DATE),
       RTRIM(ISNULL(t.TcaSerieDoc,'')) + '-' + RTRIM(ISNULL(t.TcaNumeroDoc,'')),
       CAST(t.TcaTotalNeto AS DECIMAL(18,2)), CAST(t.TcaTotalCobrado AS DECIMAL(18,2)),
       t.TcaMonedaBase, t.TcaEstado, t.TcaUsuarioAnula, LEFT(ISNULL(t.TcaObservaciones,''), 200)
FROM dbo.TransaccionesCaja t
WHERE t.TcaClienteId = @Cli;

-- ── 0 · Quien es ──────────────────────────────────────────────────────────
SELECT Panel = '0 - QUIEN ES', CliIdCliente = @Cli, DocDelCaso = @Doc,
       Nombre = c.Nombre, Fantasia = c.NombreFantasia,
       Codigo = c.CodCliente, Rut = c.CioRuc
FROM dbo.Clientes c WHERE c.CliIdCliente = @Cli;

-- ── 1 · Sus cuentas: libro contra columna guardada ────────────────────────
SELECT Panel = '1 - SALDOS', c.CueIdCuenta, c.CueTipo, c.CueEsPrincipal,
       Moneda = CASE WHEN c.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoDelLibro = CAST(ISNULL(l.Saldo, 0) AS DECIMAL(18,2)),
       ColumnaGuardada = CAST(c.ColumnaGuardada AS DECIMAL(18,2)),
       Coincide = CASE WHEN ABS(ISNULL(l.Saldo,0) - ISNULL(c.ColumnaGuardada,0)) <= 0.01
                       THEN 'si' ELSE 'NO - la columna miente' END
FROM #Ctas c
LEFT JOIN #Lib l ON l.CueIdCuenta = c.CueIdCuenta
ORDER BY c.CueTipo, c.CueIdCuenta;

-- ── 2 · Libro de la cuenta, con saldo corrido ─────────────────────────────
SELECT Panel = '2 - LIBRO DE LA CUENTA', m.MovIdMovimiento,
       Fecha = CONVERT(VARCHAR(19), m.MovFecha, 120),
       m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)),
       SaldoCorrido = CAST(SUM(CASE WHEN m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') THEN 0
                                    ELSE m.MovImporte END)
                           OVER (ORDER BY m.MovFecha, m.MovIdMovimiento
                                 ROWS UNBOUNDED PRECEDING) AS DECIMAL(18,2)),
       Documento = ISNULL(RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), '(sin documento)'),
       m.DocIdDocumento, m.PagIdPago, Anulado = ISNULL(m.MovAnulado, 0),
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 60)
FROM dbo.MovimientosCuenta m
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE m.CueIdCuenta = @Cuenta
ORDER BY m.MovFecha, m.MovIdMovimiento;

-- ── 3 · El ET-4260 y todo lo que lo referencia (la NC) ───────────────────
SELECT Panel = '3 - DOCUMENTOS', d.DocIdDocumento,
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Fecha = CONVERT(VARCHAR(19), d.DocFechaEmision, 120),
       Tipo = RTRIM(d.DocTipo), Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocPagado, d.DocEstado, d.CfeEstado, NumeroDgi = d.CfeNumeroOficial,
       d.TcaIdTransaccion, d.CueIdCuenta,
       ReferenciaA = ISNULL(RTRIM(r.DocSerie) + '-' + RTRIM(r.DocNumero), '(ninguna)'),
       Motivo = LEFT(ISNULL(d.DocMotivoRef,''), 60)
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DocumentosContables r ON r.DocIdDocumento = d.DocIdDocumentoRef
WHERE d.DocIdDocumento = @Doc
   OR d.DocIdDocumentoRef = @Doc
   OR d.CueIdCuenta IN (SELECT CueIdCuenta FROM #Ctas)
ORDER BY d.DocFechaEmision;

-- ── 4 · La deuda del ET-4260 y CADA cosa que la toco ─────────────────────
SELECT Panel = '4 - QUIEN PAGO QUE',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       dd.DDeIdDocumento,
       Original = CAST(dd.DDeImporteOriginal AS DECIMAL(18,2)),
       Pendiente = CAST(dd.DDeImportePendiente AS DECIMAL(18,2)),
       dd.DDeEstado, dd.DDeFechaCobro,
       Imputado = CAST(ip.ImpImporte AS DECIMAL(18,2)),
       p.PagIdPago, PagoMonto = CAST(p.PagMontoPago AS DECIMAL(18,2)),
       PagoMoneda = CASE WHEN p.PagIdMonedaPago = 2 THEN 'US$' ELSE '$' END,
       TipoPago = ISNULL(p.PagTipoMovimiento, '(sin imputacion)'),
       PagoFecha = CONVERT(VARCHAR(19), p.PagFechaPago, 120),
       p.PagTcaIdTransaccion,
       CajaEstado = ISNULL(ca.Estado, '(sin caja)')
FROM dbo.DocumentosContables d
LEFT JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
LEFT JOIN dbo.ImputacionPago ip ON ip.DDeIdDocumento = dd.DDeIdDocumento
LEFT JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
LEFT JOIN #Cajas ca ON ca.TcaIdTransaccion = p.PagTcaIdTransaccion
WHERE d.DocIdDocumento = @Doc OR d.DocIdDocumentoRef = @Doc
ORDER BY p.PagFechaPago;

-- ── 5 · Sus cajas, marcando los recibos gemelos ──────────────────────────
-- Gemelo = mismo dia, mismo importe cobrado, misma moneda. Es la huella del
-- doble submit: el operador aprieta dos veces y quedan dos recibos iguales.
SELECT Panel = '5 - CAJAS DEL CLIENTE', c.TcaIdTransaccion,
       Fecha = CONVERT(VARCHAR(19), c.TcaFecha, 120),
       c.Recibo, c.Neto, c.Cobrado, c.Moneda, c.Estado, c.UsuarioAnula,
       Gemela = CASE WHEN COUNT(*) OVER (PARTITION BY c.Dia, c.Cobrado, ISNULL(c.Moneda,'')) > 1
                     THEN 'SI - hay otra igual el mismo dia' ELSE 'no' END,
       Obs = LEFT(c.Obs, 80)
FROM #Cajas c
ORDER BY c.TcaFecha DESC;

-- ── 6 · Veredicto ─────────────────────────────────────────────────────────
SELECT Panel = '6 - VEREDICTO',
       SaldoFinal = CAST(ISNULL(l.Saldo, 0) AS DECIMAL(18,2)),
       Lectura = CASE WHEN ISNULL(l.Saldo,0) > 0.01
                      THEN 'A FAVOR ' + CONVERT(VARCHAR(20), CAST(l.Saldo AS DECIMAL(18,2)))
                           + ' - revisar cuanto de ese abono es real'
                      WHEN ISNULL(l.Saldo,0) < -0.01
                      THEN 'DEBE ' + CONVERT(VARCHAR(20), CAST(-l.Saldo AS DECIMAL(18,2)))
                      ELSE 'EN CERO' END
FROM #Lib l WHERE l.CueIdCuenta = @Cuenta;

DROP TABLE #Ctas; DROP TABLE #Lib; DROP TABLE #Cajas;
