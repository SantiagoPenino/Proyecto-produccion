/* =====================================================================================
   DIAGNÓSTICO — Cheques de PODIUM (ELISA RAMOS) contra la factura FA-247
   Base: SecureAppDB (PRODUCCIÓN).  SOLO LECTURA — no modifica nada.
   Correr las 6 consultas y pasarme los resultados.
   ===================================================================================== */

-- 1) El cliente. En el local es CliIdCliente = 1041 (ELISA RAMOS, fantasía PODIUM2024,
--    RUT 218978560014). Confirmar que en prod es el mismo Id.
SELECT CliIdCliente, CodCliente, Nombre, NombreFantasia, CioRuc
FROM   dbo.Clientes WITH(NOLOCK)
WHERE  CioRuc LIKE '218978560014%' OR Nombre LIKE '%PODIUM%' OR NombreFantasia LIKE '%PODIUM%';


-- 2) Los 3 cheques cargados a mano en Tesorería.
--    OJO: IdMoneda va a venir 1 (pesos) en los tres — el alta lo escribe fijo.
SELECT c.IdCheque, c.NumeroCheque, b.NombreBanco, c.Monto, c.IdMoneda,
       c.Estado, c.Tipo, c.IdClienteOrigen, c.FechaEmision, c.FechaVencimiento,
       c.FechaRegistro, c.Notas
FROM   dbo.TesoreriaCheques c WITH(NOLOCK)
JOIN   dbo.TesoreriaBancos  b WITH(NOLOCK) ON b.IdBanco = c.IdBanco
WHERE  c.NumeroCheque IN ('249726','249727','249728')
ORDER  BY c.IdCheque;


-- 3) La factura FA-247 (en el local es DocIdDocumento = 5048, USD 1.676,37, ciclo 65).
SELECT DocIdDocumento, DocTipo, DocSerie, DocNumero, DocFechaEmision, DocTotal,
       MonIdMoneda, DocEstado, DocPagado, CfeEstado, CfeNumeroOficial,
       TcaIdTransaccion, CicIdCiclo, AsiIdAsiento, CliIdCliente
FROM   dbo.DocumentosContables WITH(NOLOCK)
WHERE  DocSerie = 'FA' AND DocNumero = '247';


-- 4) ¿La factura quedó como deuda viva o como cobrada?
SELECT d.DDeIdDocumento, d.DocIdDocumento, d.CueIdCuenta, d.DDeImporteOriginal,
       d.DDeImportePendiente, d.DDeEstado, d.DDeFechaEmision, d.DDeFechaCobro
FROM   dbo.DeudaDocumento d WITH(NOLOCK)
JOIN   dbo.DocumentosContables doc WITH(NOLOCK) ON doc.DocIdDocumento = d.DocIdDocumento
WHERE  doc.DocSerie = 'FA' AND doc.DocNumero = '247';


-- 5) ¿Hay algún cobro registrado (Pagos) para esa factura? ¿Con qué método y con qué cheque?
--    Método 11 = 'Cheque'. PagIdCheque es el amarre cheque↔cobro que hoy está en NULL.
SELECT p.PagIdPago, p.PagTcaIdTransaccion, m.MPaDescripcionMetodo, p.PagIdMonedaPago,
       p.PagMontoPago, p.PagCotizacion, p.PagMontoConvertido, p.PagFechaPago,
       p.PagTipoMovimiento, p.PagIdCheque
FROM   dbo.Pagos p WITH(NOLOCK)
LEFT   JOIN dbo.MetodosPagos m WITH(NOLOCK) ON m.MPaIdMetodoPago = p.MPaIdMetodoPago
WHERE  p.PagTcaIdTransaccion IN (
         SELECT TcaIdTransaccion FROM dbo.DocumentosContables WITH(NOLOCK)
         WHERE DocSerie = 'FA' AND DocNumero = '247' AND TcaIdTransaccion IS NOT NULL)
ORDER  BY p.PagIdPago;


-- 6) Cobros del cliente en la ventana de los cheques (23/07 en adelante), por si el cobro
--    se registró contra otra transacción y no contra la factura.
SELECT t.TcaIdTransaccion, t.TcaFecha, t.TcaTipoDocumento, t.TcaSerieDoc, t.TcaNumeroDoc,
       t.TcaTotalNeto, t.TcaMonedaBase, t.TcaEstado, t.EsCajaAdmin, t.StuIdSesion,
       p.PagIdPago, m.MPaDescripcionMetodo, p.PagMontoPago, p.PagIdMonedaPago, p.PagIdCheque
FROM   dbo.TransaccionesCaja t WITH(NOLOCK)
LEFT   JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
LEFT   JOIN dbo.MetodosPagos m WITH(NOLOCK) ON m.MPaIdMetodoPago = p.MPaIdMetodoPago
WHERE  t.TcaClienteId = (SELECT TOP 1 CliIdCliente FROM dbo.Clientes WITH(NOLOCK)
                         WHERE CioRuc LIKE '218978560014%')
  AND  t.TcaFecha >= '2026-07-20'
ORDER  BY t.TcaIdTransaccion DESC;
