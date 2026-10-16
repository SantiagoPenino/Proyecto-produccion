/* =====================================================================================
   PASO 1 de 2 — VERIFICACIÓN del anticipo RA-18 (Gerardo Mazzoni, cliente 250)
   Base: SecureAppDB (PRODUCCIÓN).

   SOLO LECTURA. No abre transacción, no bloquea nada, no hay COMMIT ni ROLLBACK.
   Corré esto, mirá los resultados, y si está todo como dice la columna "Esperado",
   corré ra18_2_aplicar.sql — ese sí escribe y hace COMMIT solo, sin frenarse a esperarte.
   ===================================================================================== */

SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

DECLARE @TC DECIMAL(18,4) = (SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WHERE CotFecha = '2026-07-30');
PRINT CONCAT('TC del 30/07/2026 = ', ISNULL(CONVERT(varchar(20), @TC), 'NO CARGADO'),
             '   →   US$ 3.000 = $ ', ISNULL(CONVERT(varchar(20), ROUND(3000 * @TC, 2)), '?'));


/* ── A) ¿Los cheques generaron asiento propio? ────────────────────────────────
   Si devuelve filas: los cheques se cargaron desde Tesorería y ya se contabilizaron
   aparte del anticipo → la plata está contada DOS veces. PARÁ y avisame.            */
SELECT 'A. ASIENTOS DE LOS CHEQUES (esperado: 0 filas)' AS Chequeo,
       a.AsiId, a.AsiFecha, a.AsiConcepto, pc.CueCodigo, d.DetDebeUYU, d.DetHaberUYU, d.DetCotizacion
FROM   dbo.Cont_AsientosCabecera a
JOIN   dbo.Cont_AsientosDetalle  d  ON d.AsiId = a.AsiId
JOIN   dbo.Cont_PlanCuentas      pc ON pc.CueId = d.CueId
WHERE  a.SysOrigen = 'TESORERIA'
  AND (a.AsiConcepto LIKE '%177807%' OR a.AsiConcepto LIKE '%177808%' OR a.AsiConcepto LIKE '%177809%');


/* ── B) Sesión de caja 30 ─────────────────────────────────────────────────────
   El anticipo va a salir de esta sesión (pasa a Caja Administrativa). Si está CERRADA,
   su arqueo contaba estos $ 3.000 y después de aplicar deja de contarlos.            */
SELECT 'B. SESION 30' AS Chequeo, * FROM dbo.SesionesTurno WHERE StuIdSesion = 30;


/* ── C) Estado actual de las 6 tablas ─────────────────────────────────────────── */
SELECT 'C1. DOCUMENTO (esperado hoy: MonIdMoneda = 1)' AS Chequeo,
       DocIdDocumento, DocSerie + '-' + DocNumero AS Doc, DocTotal, MonIdMoneda,
       DocEstado, DocPagado, TcaIdTransaccion, AsiIdAsiento
FROM   dbo.DocumentosContables WHERE DocIdDocumento = 6090;

SELECT 'C2. TRANSACCION (hoy: UYU / EsCajaAdmin 0 / sesión 30)' AS Chequeo,
       TcaIdTransaccion, TcaTotalNeto, TcaMonedaBase, EsCajaAdmin, StuIdSesion, TcaEstado
FROM   dbo.TransaccionesCaja WHERE TcaIdTransaccion = 5771;

SELECT 'C3. PAGOS (hoy: 1 pago de 3.000 en moneda 1, sin cheque)' AS Chequeo,
       p.PagIdPago, p.PagMontoPago, p.PagIdMonedaPago, p.PagCotizacion,
       p.PagMontoConvertido, p.PagIdCheque
FROM   dbo.Pagos p WHERE p.PagTcaIdTransaccion = 5771;

SELECT 'C4. MOVIMIENTO (hoy: cuenta 2204 DINERO_UYU)' AS Chequeo,
       mv.MovIdMovimiento, mv.CueIdCuenta, cc.CueTipo, mv.MovImporte, mv.MovAnulado, mv.DocIdDocumento
FROM   dbo.MovimientosCuenta mv
JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = mv.CueIdCuenta
WHERE  mv.MovIdMovimiento = 26840;

SELECT 'C5. CUENTAS DEL CLIENTE' AS Chequeo,
       CueIdCuenta, CueTipo, MonIdMoneda, CueSaldoActual,
       CASE CueIdCuenta WHEN 2204 THEN CueSaldoActual - 3000 WHEN 381 THEN CueSaldoActual + 3000 END AS SaldoDespues
FROM   dbo.CuentasCliente WHERE CueIdCuenta IN (2204, 381);
--  Esperado después: 2204 = 0,00   |   381 = -13.362,64

SELECT 'C6. ASIENTO 19300 (hoy: 1.1.1 Caja pesos)' AS Chequeo,
       a.AsiId, a.AsiConcepto, pc.CueCodigo, pc.CueNombre, d.DetDebeUYU, d.DetHaberUYU,
       d.DetCotizacion, d.DetMonedaId
FROM   dbo.Cont_AsientosCabecera a
JOIN   dbo.Cont_AsientosDetalle  d  ON d.AsiId = a.AsiId
JOIN   dbo.Cont_PlanCuentas      pc ON pc.CueId = d.CueId
WHERE  a.AsiId = 19300;

SELECT 'C7. CHEQUES (esperado: 3, US$ 1.000 c/u, EN_CARTERA)' AS Chequeo,
       IdCheque, NumeroCheque, Monto, IdMoneda, Estado, IdClienteOrigen
FROM   dbo.TesoreriaCheques WHERE NumeroCheque IN ('177807','177808','177809');


/* ── D) Cuentas del plan que necesita el asiento nuevo ───────────────────────── */
SELECT 'D. PLAN DE CUENTAS (esperado: las 2 filas)' AS Chequeo, CueId, CueCodigo, CueNombre
FROM   dbo.Cont_PlanCuentas WHERE CueCodigo IN ('1.1.2', '2.3.1');


/* ── E) Deudas en US$ del cliente — NO se tocan ──────────────────────────────
   El script de aplicación deja el anticipo entero como saldo a favor y no cancela
   estas deudas. Si querés que las impute, avisame antes de aplicar.                 */
SELECT 'E. DEUDAS VIVAS EN US$ (no se tocan)' AS Chequeo,
       DDeIdDocumento, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeEstado, DDeFechaEmision
FROM   dbo.DeudaDocumento
WHERE  CueIdCuenta = 381 AND DDeImportePendiente > 0
ORDER  BY DDeFechaEmision;
