-- ============================================================================
-- DIAGNÓSTICO (SOLO LECTURA) — Gerardo Mazzoni, cuenta USD 381, 28-09-2026:
-- cierre de ciclo → PC-4851 (Contado) → anulado → PC-4852 (Crédito).
-- ¿Por qué el estado de cuenta muestra US$ 744,78 a favor en vez de una deuda?
-- Correr en PRODUCCIÓN tal cual (no modifica nada). Devuelve los bloques:
--   DOCS, CUENTAS, MOVS, DEUDAS, IMPUT, TCA, TCA_PAGOS.
-- Copia de scripts/diag_mazzoni_pc3961_saldo_doble.sql con dos documentos.
-- ============================================================================
USE [SecureAppDB];
SET NOCOUNT ON;

DECLARE @Serie VARCHAR(10) = 'PC';
DECLARE @Doc1  INT = (SELECT TOP 1 DocIdDocumento FROM dbo.DocumentosContables WHERE DocSerie = @Serie AND DocNumero = 4851 ORDER BY DocIdDocumento DESC);
DECLARE @Doc2  INT = (SELECT TOP 1 DocIdDocumento FROM dbo.DocumentosContables WHERE DocSerie = @Serie AND DocNumero = 4852 ORDER BY DocIdDocumento DESC);
DECLARE @Cli   INT = (SELECT CliIdCliente FROM dbo.DocumentosContables WHERE DocIdDocumento = @Doc2);

-- 1) Los dos documentos (y el recibo del cobro contado, si quedó)
SELECT 'DOCS' AS Bloque, DocIdDocumento, CliIdCliente, CueIdCuenta, DocTipo, DocSerie, DocNumero,
       DocFechaEmision, DocTotal, MonIdMoneda, DocEstado, CfeEstado, DocPagado, TcaIdTransaccion,
       CicIdCiclo, DocCotizacion, DocUsuarioAlta, DocObservaciones
FROM dbo.DocumentosContables
WHERE DocIdDocumento IN (@Doc1, @Doc2)
   OR (CliIdCliente = @Cli AND DocFechaEmision >= '2026-09-28' AND DocTipo LIKE '%Recibo%')
ORDER BY DocIdDocumento;

-- 2) Cuentas de dinero del cliente: columna cacheada vs libro
SELECT 'CUENTAS' AS Bloque, cc.CueIdCuenta, cc.CueTipo, cc.MonIdMoneda, cc.CueEsPrincipal, cc.CueActiva,
       cc.CueSaldoActual,
       SaldoLibro = (SELECT ISNULL(SUM(m.MovImporte),0) FROM dbo.MovimientosCuenta m
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0) = 0
                       AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
       SaldoLibroConOrdenes = (SELECT ISNULL(SUM(m.MovImporte),0) FROM dbo.MovimientosCuenta m
                     WHERE m.CueIdCuenta = cc.CueIdCuenta AND ISNULL(m.MovAnulado,0) = 0),
       DeudaViva = (SELECT ISNULL(SUM(dd.DDeImportePendiente),0) FROM dbo.DeudaDocumento dd
                     WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DDeImportePendiente > 0.01)
FROM dbo.CuentasCliente cc
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%';

-- 3) TODOS los movimientos del cliente desde el 20/09 (incluye anulados y ORDEN)
SELECT 'MOVS' AS Bloque, m.MovIdMovimiento, m.CueIdCuenta, m.MovFecha, m.MovTipo, m.MovImporte,
       m.MovSaldoPosterior, m.MovConcepto, m.MovObservaciones, m.DocIdDocumento,
       DocRef = d.DocSerie + '-' + CAST(d.DocNumero AS VARCHAR(20)), d.DocTipo,
       m.OrdIdOrden, m.PagIdPago, m.MovAnulado, m.MovIdAnula, m.CicIdCiclo, m.MovUsuarioAlta
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
WHERE cc.CliIdCliente = @Cli AND cc.CueTipo LIKE 'DINERO%' AND m.MovFecha >= '2026-09-20'
ORDER BY m.MovIdMovimiento;

-- 4) Deudas de los dos documentos (cualquier estado)
SELECT 'DEUDAS' AS Bloque, dd.*
FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento IN (@Doc1, @Doc2);

-- 5) Imputaciones y Pagos que tocaron esas deudas
SELECT 'IMPUT' AS Bloque, ip.ImpIdImputacion, ip.DDeIdDocumento, ip.CueIdCuenta, ip.ImpImporte, ip.ImpFecha,
       ip.ImpUsuarioAlta, p.PagIdPago, p.PagTipoMovimiento, p.PagMontoPago, p.PagIdMonedaPago,
       p.PagCotizacion, p.PagMontoConvertido, p.MPaIdMetodoPago, p.PagTcaIdTransaccion, p.PagFechaPago
FROM dbo.ImputacionPago ip
JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
WHERE ip.DDeIdDocumento IN (SELECT DDeIdDocumento FROM dbo.DeudaDocumento WHERE DocIdDocumento IN (@Doc1, @Doc2))
ORDER BY ip.ImpIdImputacion;

-- 6) Transacciones de caja del cliente desde el 20/09 (cobros, recibos)
SELECT 'TCA' AS Bloque, t.TcaIdTransaccion, t.TcaFecha, t.TcaTipoDocumento, t.TcaSerieDoc, t.TcaNumeroDoc,
       t.TcaTotalNeto, t.TcaTotalCobrado, t.TcaMonedaBase, t.TcaEstado, t.TcaObservaciones, t.EsCajaAdmin,
       DocsDeLaTca = (SELECT STRING_AGG(x.DocSerie + '-' + CAST(x.DocNumero AS VARCHAR(20)) + ' (' + ISNULL(x.DocTipo,'') + ')', ' | ')
                      FROM dbo.DocumentosContables x WHERE x.TcaIdTransaccion = t.TcaIdTransaccion),
       Detalle = (SELECT STRING_AGG(ISNULL(td.TdeTipoReferencia,'') + ' ' + ISNULL(td.TdeCodigoReferencia,'') + ' = ' + CAST(td.TdeImporteFinal AS VARCHAR(30)), ' | ')
                  FROM dbo.TransaccionDetalle td WHERE td.TcaIdTransaccion = t.TcaIdTransaccion)
FROM dbo.TransaccionesCaja t
WHERE t.TcaClienteId = @Cli AND t.TcaFecha >= '2026-09-20'
ORDER BY t.TcaIdTransaccion;

-- 7) Pagos (medios) de esas transacciones
SELECT 'TCA_PAGOS' AS Bloque, p.PagIdPago, p.PagTcaIdTransaccion, p.PagTipoMovimiento, p.MPaIdMetodoPago,
       p.PagIdMonedaPago, p.PagMontoPago, p.PagCotizacion, p.PagMontoConvertido, p.PagFechaPago, p.PagSaldoConsumidoId, p.PagIdCheque
FROM dbo.Pagos p
WHERE p.PagTcaIdTransaccion IN (SELECT TcaIdTransaccion FROM dbo.TransaccionesCaja WHERE TcaClienteId = @Cli AND TcaFecha >= '2026-09-20')
   OR p.PagIdPago IN (SELECT PagIdPago FROM dbo.ImputacionPago WHERE DDeIdDocumento IN (SELECT DDeIdDocumento FROM dbo.DeudaDocumento WHERE DocIdDocumento IN (@Doc1, @Doc2)))
ORDER BY p.PagIdPago;
