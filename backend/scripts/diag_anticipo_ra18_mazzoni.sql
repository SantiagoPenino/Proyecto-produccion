/* =====================================================================================
   DIAGNÓSTICO — Anticipo RA-18 (Gerardo Mazzoni) cobrado con 3 cheques en US$
   pero registrado en PESOS.
   Base: SecureAppDB (PRODUCCIÓN).  SOLO LECTURA.
   El anticipo toca 6 tablas; hay que ver las 6 antes de decidir cómo se revierte.
   ===================================================================================== */

-- 0) El cliente (en la pantalla figura ID #250).
SELECT CliIdCliente, CodCliente, IDCliente, Nombre, NombreFantasia, CioRuc
FROM   dbo.Clientes WITH(NOLOCK)
WHERE  Nombre LIKE '%MAZZONI%' OR NombreFantasia LIKE '%MAZZONI%';


-- 1) El recibo RA-18. Si MonIdMoneda = 1, el recibo quedó emitido en pesos.
SELECT DocIdDocumento, DocTipo, DocSerie, DocNumero, DocFechaEmision, DocTotal,
       MonIdMoneda, DocEstado, DocPagado, TcaIdTransaccion, AsiIdAsiento,
       CueIdCuenta, CliIdCliente, DocObservaciones, EmpIdEmpresa
FROM   dbo.DocumentosContables WITH(NOLOCK)
WHERE  DocSerie = 'RA' AND DocNumero = '18';


-- 2) La transacción de caja del anticipo (TcaMonedaBase debería decir USD).
SELECT t.TcaIdTransaccion, t.TcaFecha, t.TcaTipoDocumento, t.TcaSerieDoc, t.TcaNumeroDoc,
       t.TcaTotalNeto, t.TcaTotalCobrado, t.TcaMonedaBase, t.TcaEstado,
       t.EsCajaAdmin, t.StuIdSesion, t.TcaObservaciones
FROM   dbo.TransaccionesCaja t WITH(NOLOCK)
WHERE  t.TcaIdTransaccion = (SELECT TcaIdTransaccion FROM dbo.DocumentosContables WITH(NOLOCK)
                             WHERE DocSerie = 'RA' AND DocNumero = '18');


-- 3) El pago. PagIdMonedaPago = 1 confirma que entró como pesos.
--    PagCotizacion = 1 y PagMontoConvertido = 3000 confirman que nunca se convirtió.
--    PagIdCheque en NULL = los 3 cheques no quedaron amarrados a este cobro.
SELECT p.PagIdPago, p.PagTcaIdTransaccion, m.MPaDescripcionMetodo, p.PagIdMonedaPago,
       p.PagMontoPago, p.PagCotizacion, p.PagMontoConvertido, p.PagFechaPago,
       p.PagTipoMovimiento, p.PagIdCheque
FROM   dbo.Pagos p WITH(NOLOCK)
LEFT   JOIN dbo.MetodosPagos m WITH(NOLOCK) ON m.MPaIdMetodoPago = p.MPaIdMetodoPago
WHERE  p.PagTcaIdTransaccion = (SELECT TcaIdTransaccion FROM dbo.DocumentosContables WITH(NOLOCK)
                                WHERE DocSerie = 'RA' AND DocNumero = '18');


-- 4) EL PUNTO CLAVE: ¿a qué cuenta del cliente fue el saldo?
--    Si CueTipo = 'DINERO_UYU', los US$ 3.000 quedaron como $ 3.000 a favor en la
--    cuenta de PESOS. Eso NO se arregla cambiando una columna: hay que revertir el
--    movimiento y volver a registrarlo en la cuenta DINERO_USD.
SELECT mv.MovIdMovimiento, mv.CueIdCuenta, cc.CueTipo, cc.MonIdMoneda AS MonedaCuenta,
       mv.MovTipo, mv.MovConcepto, mv.MovImporte, mv.MovFecha, mv.MovAnulado,
       mv.DocIdDocumento
FROM   dbo.MovimientosCuenta mv WITH(NOLOCK)
JOIN   dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = mv.CueIdCuenta
WHERE  mv.DocIdDocumento = (SELECT DocIdDocumento FROM dbo.DocumentosContables WITH(NOLOCK)
                            WHERE DocSerie = 'RA' AND DocNumero = '18');

-- 4b) Las dos cuentas del cliente y su saldo actual.
SELECT cc.CueIdCuenta, cc.CueTipo, cc.MonIdMoneda, cc.CueSaldoActual, cc.CueActiva
FROM   dbo.CuentasCliente cc WITH(NOLOCK)
JOIN   dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE  c.Nombre LIKE '%MAZZONI%';


-- 5) ¿El anticipo se imputó contra deudas? Si imputó, revertirlo es más delicado:
--    hay deudas que quedaron canceladas con plata mal convertida.
SELECT d.DDeIdDocumento, d.CueIdCuenta, d.DocIdDocumento, d.DDeImporteOriginal,
       d.DDeImportePendiente, d.DDeEstado, d.DDeFechaEmision, d.DDeFechaCobro
FROM   dbo.DeudaDocumento d WITH(NOLOCK)
JOIN   dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = d.CueIdCuenta
JOIN   dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
WHERE  c.Nombre LIKE '%MAZZONI%'
ORDER  BY d.DDeFechaEmision DESC;


-- 6) El asiento contable. Si la cuenta del DEBE es la Caja en PESOS (1.1.1) en vez de
--    la Caja en dólares, y DetCotizacion = 1, el Libro Mayor tiene $ 3.000 donde
--    deberían estar ~$ 120.000.
SELECT a.AsiId, a.AsiFecha, a.AsiConcepto, a.SysOrigen, a.AsiEstado,
       pc.CueCodigo, pc.CueNombre, det.DetDebeUYU, det.DetHaberUYU,
       det.DetImporteOriginal, det.DetCotizacion, det.DetMonedaId
FROM   dbo.Cont_AsientosCabecera a WITH(NOLOCK)
JOIN   dbo.Cont_AsientosDetalle  det WITH(NOLOCK) ON det.AsiId = a.AsiId
JOIN   dbo.Cont_PlanCuentas      pc  WITH(NOLOCK) ON pc.CueId = det.CueId
WHERE  a.TcaIdTransaccion = (SELECT TcaIdTransaccion FROM dbo.DocumentosContables WITH(NOLOCK)
                             WHERE DocSerie = 'RA' AND DocNumero = '18')
ORDER  BY det.DetDebeUYU DESC;


-- 7) Los 3 cheques de Banco Itaú que pagaron este anticipo (para amarrarlos después).
SELECT ch.IdCheque, ch.NumeroCheque, b.NombreBanco, ch.Monto, ch.IdMoneda, ch.Estado,
       ch.IdClienteOrigen, ch.FechaEmision, ch.FechaVencimiento, ch.FechaRegistro
FROM   dbo.TesoreriaCheques ch WITH(NOLOCK)
JOIN   dbo.TesoreriaBancos  b  WITH(NOLOCK) ON b.IdBanco = ch.IdBanco
WHERE  ch.NumeroCheque IN ('177807','177808','177809');
