/* =====================================================================================
   DIAGNÓSTICO — Yesusport (cliente 347), cuentas 613 (DINERO_UYU) y 34 (DINERO_USD)
   Panel muestra: UYU $ -74.492,61 (deuda enorme) / USD +935,25 (a favor) / 1 deuda viva
   en $ (PC-2461, $933,50, VENCIDA 9 días) — el $933,50 vencido es una gota en el balde
   de -74.492,61: hay que ver qué más está aportando esa brecha.

   Base: SecureAppDB (PRODUCCIÓN). SOLO LECTURA, sin transacción, no bloquea.
   ===================================================================================== */

SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

DECLARE @CueUYU INT = 613, @CueUSD INT = 34;

/* ── 1) RESUMEN por moneda ────────────────────────────────────────────────────── */
SELECT '1. RESUMEN' AS Bloque, 'UYU' AS Moneda, @CueUYU AS Cuenta,
       (SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = @CueUYU AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')) AS SumaLibro,
       (SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento
        WHERE CueIdCuenta = @CueUYU AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')) AS DeudaPendiente,
       (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueUYU) AS ColumnaGuardada
UNION ALL
SELECT '1. RESUMEN', 'USD', @CueUSD,
       (SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = @CueUSD AND ISNULL(MovAnulado,0) = 0 AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')),
       (SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento
        WHERE CueIdCuenta = @CueUSD AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')),
       (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueUSD);


/* ── 2) DOCUMENTO POR DOCUMENTO — cuenta UYU (donde está el problema grande) ──── */
;WITH mov AS (
    SELECT m.DocIdDocumento,
           SUM(m.MovImporte) AS MovNeto, COUNT(*) AS MovCant
    FROM   dbo.MovimientosCuenta m
    WHERE  m.CueIdCuenta = @CueUYU AND ISNULL(m.MovAnulado,0) = 0
      AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND m.DocIdDocumento IS NOT NULL
    GROUP  BY m.DocIdDocumento
), deu AS (
    SELECT d.DocIdDocumento,
           SUM(d.DDeImporteOriginal)  AS DeudaOriginal,
           SUM(d.DDeImportePendiente) AS DeudaPendiente,
           COUNT(*) AS DeudaFilas
    FROM   dbo.DeudaDocumento d
    WHERE  d.CueIdCuenta = @CueUYU AND d.DocIdDocumento IS NOT NULL
    GROUP  BY d.DocIdDocumento
)
SELECT '2. UYU POR DOCUMENTO' AS Bloque,
       ISNULL(mov.DocIdDocumento, deu.DocIdDocumento) AS DocId,
       doc.DocTipo, doc.DocSerie + '-' + doc.DocNumero AS Doc,
       doc.DocFechaEmision, doc.DocTotal, doc.DocEstado, doc.DocPagado,
       ISNULL(deu.DeudaOriginal,0)  AS DeudaOriginal,
       ISNULL(deu.DeudaPendiente,0) AS DeudaPendiente,
       ISNULL(mov.MovNeto,0)        AS MovNeto,
       ISNULL(mov.MovNeto,0) + ISNULL(deu.DeudaPendiente,0) AS DescuadreDoc,
       ISNULL(mov.MovCant,0) AS MovCant, ISNULL(deu.DeudaFilas,0) AS DeudaFilas,
       CASE
         WHEN deu.DocIdDocumento IS NULL THEN 'Movimientos sin deuda asociada'
         WHEN mov.DocIdDocumento IS NULL THEN 'Deuda sin ningun movimiento'
         WHEN ABS(ISNULL(mov.MovNeto,0) + ISNULL(deu.DeudaPendiente,0)) < 0.01 THEN 'OK'
         ELSE 'DESCUADRA'
       END AS Veredicto
FROM   mov
FULL   OUTER JOIN deu ON deu.DocIdDocumento = mov.DocIdDocumento
LEFT   JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = ISNULL(mov.DocIdDocumento, deu.DocIdDocumento)
ORDER  BY ABS(ISNULL(mov.MovNeto,0) + ISNULL(deu.DeudaPendiente,0)) DESC;


/* ── 3) MOVIMIENTOS SIN DOCUMENTO — cuenta UYU ──────────────────────────────── */
SELECT '3. UYU MOV SIN DOCUMENTO' AS Bloque,
       m.MovIdMovimiento, m.MovTipo, m.MovImporte, m.MovFecha,
       LEFT(m.MovConcepto, 80) AS Concepto, m.PagIdPago, m.CicIdCiclo,
       LEFT(m.MovObservaciones, 80) AS Observaciones
FROM   dbo.MovimientosCuenta m
WHERE  m.CueIdCuenta = @CueUYU AND ISNULL(m.MovAnulado,0) = 0
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND m.DocIdDocumento IS NULL
ORDER  BY m.MovFecha;

SELECT '3b. SUBTOTAL' AS Bloque, ISNULL(SUM(m.MovImporte),0) AS Subtotal
FROM   dbo.MovimientosCuenta m
WHERE  m.CueIdCuenta = @CueUYU AND ISNULL(m.MovAnulado,0) = 0
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND m.DocIdDocumento IS NULL;


/* ── 4) DEUDAS DUPLICADAS — mismo chequeo que hicimos con Mazzoni ───────────── */
SELECT '4. POSIBLES DUPLICADAS UYU' AS Bloque,
       DDeIdDocumento, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente,
       DDeEstado, DDeFechaEmision, DDeFechaCobro, DDeObservaciones
FROM   dbo.DeudaDocumento
WHERE  CueIdCuenta = @CueUYU
  AND  DocIdDocumento IN (
        SELECT DocIdDocumento FROM dbo.DeudaDocumento
        WHERE CueIdCuenta = @CueUYU AND DocIdDocumento IS NOT NULL
        GROUP BY DocIdDocumento HAVING COUNT(*) > 1)
ORDER  BY DocIdDocumento, DDeIdDocumento;


/* ── 5) EL LIBRO COMPLETO — cuenta UYU, para leer a ojo la historia ─────────── */
SELECT '5. LIBRO UYU' AS Bloque,
       m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte,
       SUM(m.MovImporte) OVER (ORDER BY m.MovFecha, m.MovIdMovimiento
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS SaldoAcumulado,
       m.DocIdDocumento, doc.DocSerie + '-' + doc.DocNumero AS Doc,
       LEFT(m.MovConcepto, 70) AS Concepto, m.PagIdPago
FROM   dbo.MovimientosCuenta m
LEFT   JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = m.DocIdDocumento
WHERE  m.CueIdCuenta = @CueUYU AND ISNULL(m.MovAnulado,0) = 0
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER  BY m.MovFecha, m.MovIdMovimiento;
