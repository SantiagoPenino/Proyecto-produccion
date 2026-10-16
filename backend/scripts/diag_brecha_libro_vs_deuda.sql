/* =====================================================================================
   DIAGNÓSTICO — Brecha entre el LIBRO (MovimientosCuenta) y las DEUDAS (DeudaDocumento)
   Arrancado por Gerardo Mazzoni (cliente 250, cuenta 381 DINERO_USD): el panel muestra
   US$ 1.621,32 "a favor" y al mismo tiempo US$ 243,44 de deuda viva.

   Base: SecureAppDB (PRODUCCIÓN). SOLO LECTURA, sin transacción, no bloquea.

   LA IDEA: son dos tablas que se llevan por separado y nada las obliga a cuadrar.
     · El panel 360 calcula el saldo así:  SUM(MovImporte) excluyendo ORDEN/ORDEN_ANTICIPO
     · La deuda viva sale de:              SUM(DDeImportePendiente) PENDIENTE/VENCIDO/PARCIAL
   Si todo está bien, SumaLibro + DeudaPendiente = 0. Lo que dé distinto de 0 es la brecha,
   y las consultas 2 a 5 la parten por documento para ver quién la aporta.

   Para mirar otro cliente/cuenta, cambiá @Cli (y @Cue si no es la de dólares).
   ===================================================================================== */

SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

DECLARE @Cli INT = 250;                       -- Gerardo Mazzoni
DECLARE @Cue INT = (SELECT TOP 1 CueIdCuenta FROM dbo.CuentasCliente
                    WHERE CliIdCliente = @Cli AND CueTipo = 'DINERO_USD');


/* ── 1) EL TAMAÑO DE LA BRECHA ──────────────────────────────────────────────── */
SELECT '1. RESUMEN' AS Bloque,
       @Cue AS Cuenta,
       (SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0
          AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'))                       AS SumaLibro,
       (SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento
        WHERE CueIdCuenta = @Cue AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')) AS DeudaPendiente,
       (SELECT ISNULL(SUM(MovImporte),0) FROM dbo.MovimientosCuenta
        WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0) = 0
          AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO'))
     + (SELECT ISNULL(SUM(DDeImportePendiente),0) FROM dbo.DeudaDocumento
        WHERE CueIdCuenta = @Cue AND DDeEstado IN ('PENDIENTE','VENCIDO','PARCIAL')) AS BRECHA,
       (SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue)      AS ColumnaGuardada;
--  BRECHA = 0 → cuadra.  Distinto de 0 → lo reparten las consultas que siguen.
--  ColumnaGuardada es el campo CueSaldoActual, que el panel NO usa (arrastra el bug del SP).


/* ── 2) DOCUMENTO POR DOCUMENTO — quién aporta la brecha ─────────────────────
   Por cada documento: lo que el LIBRO dice que quedó debiendo (el neto de sus
   movimientos, en negativo) contra lo que la DEUDA dice que queda pendiente.
   Si el libro y la deuda cuentan lo mismo, DescuadreDoc = 0.                        */
;WITH mov AS (
    SELECT m.DocIdDocumento,
           SUM(CASE WHEN m.MovImporte < 0 THEN m.MovImporte ELSE 0 END) AS MovCargos,
           SUM(CASE WHEN m.MovImporte > 0 THEN m.MovImporte ELSE 0 END) AS MovAbonos,
           SUM(m.MovImporte)                                            AS MovNeto,
           COUNT(*)                                                     AS MovCant
    FROM   dbo.MovimientosCuenta m
    WHERE  m.CueIdCuenta = @Cue AND ISNULL(m.MovAnulado,0) = 0
      AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
      AND  m.DocIdDocumento IS NOT NULL
    GROUP  BY m.DocIdDocumento
), deu AS (
    SELECT d.DocIdDocumento,
           SUM(d.DDeImporteOriginal)   AS DeudaOriginal,
           SUM(d.DDeImportePendiente)  AS DeudaPendiente,
           COUNT(*)                    AS DeudaFilas
    FROM   dbo.DeudaDocumento d
    WHERE  d.CueIdCuenta = @Cue AND d.DocIdDocumento IS NOT NULL
    GROUP  BY d.DocIdDocumento
)
SELECT '2. POR DOCUMENTO' AS Bloque,
       ISNULL(mov.DocIdDocumento, deu.DocIdDocumento)                      AS DocId,
       doc.DocTipo, doc.DocSerie + '-' + doc.DocNumero                     AS Doc,
       doc.DocFechaEmision, doc.DocTotal, doc.MonIdMoneda, doc.DocEstado, doc.DocPagado,
       ISNULL(deu.DeudaOriginal,0)                                         AS DeudaOriginal,
       ISNULL(deu.DeudaPendiente,0)                                        AS DeudaPendiente,
       ISNULL(mov.MovCargos,0)                                             AS MovCargos,
       ISNULL(mov.MovAbonos,0)                                             AS MovAbonos,
       ISNULL(mov.MovNeto,0)                                               AS MovNeto,
       ISNULL(mov.MovNeto,0) + ISNULL(deu.DeudaPendiente,0)                AS DescuadreDoc,
       ISNULL(mov.MovCant,0)                                               AS MovCant,
       ISNULL(deu.DeudaFilas,0)                                            AS DeudaFilas,
       CASE
         WHEN deu.DocIdDocumento IS NULL THEN 'Movimientos sin deuda asociada'
         WHEN mov.DocIdDocumento IS NULL THEN 'Deuda sin ningun movimiento'
         WHEN ABS(ISNULL(mov.MovNeto,0) + ISNULL(deu.DeudaPendiente,0)) < 0.01 THEN 'OK'
         ELSE 'DESCUADRA'
       END                                                                 AS Veredicto
FROM   mov
FULL   OUTER JOIN deu ON deu.DocIdDocumento = mov.DocIdDocumento
LEFT   JOIN dbo.DocumentosContables doc
       ON doc.DocIdDocumento = ISNULL(mov.DocIdDocumento, deu.DocIdDocumento)
ORDER  BY ABS(ISNULL(mov.MovNeto,0) + ISNULL(deu.DeudaPendiente,0)) DESC;


/* ── 3) MOVIMIENTOS SIN DOCUMENTO ────────────────────────────────────────────
   Entran al saldo pero no se pueden atribuir a ninguna deuda. Suelen ser la mitad
   de la brecha: ajustes manuales, saldos iniciales, anticipos sueltos.               */
SELECT '3. MOV SIN DOCUMENTO' AS Bloque,
       m.MovIdMovimiento, m.MovTipo, m.MovImporte, m.MovFecha,
       LEFT(m.MovConcepto, 80) AS Concepto, m.PagIdPago, m.CicIdCiclo,
       LEFT(m.MovObservaciones, 80) AS Observaciones
FROM   dbo.MovimientosCuenta m
WHERE  m.CueIdCuenta = @Cue AND ISNULL(m.MovAnulado,0) = 0
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
  AND  m.DocIdDocumento IS NULL
ORDER  BY m.MovFecha;

SELECT '3b. SUBTOTAL MOV SIN DOCUMENTO' AS Bloque, ISNULL(SUM(m.MovImporte),0) AS Subtotal
FROM   dbo.MovimientosCuenta m
WHERE  m.CueIdCuenta = @Cue AND ISNULL(m.MovAnulado,0) = 0
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND m.DocIdDocumento IS NULL;


/* ── 4a) DEUDAS CON DOCUMENTO PERO SIN MOVIMIENTO QUE LAS RESPALDE ──────────
   El documento generó deuda pero nunca dejó su cargo en el libro (o al revés,
   se cobró en la deuda sin movimiento). Es el patrón de AUDITORIA_COBROS_SIN_MOVIMIENTO. */
SELECT '4a. DEUDAS SIN MOVIMIENTO' AS Bloque,
       d.DDeIdDocumento, d.DocIdDocumento, doc.DocTipo,
       doc.DocSerie + '-' + doc.DocNumero AS Doc, doc.DocFechaEmision,
       d.DDeImporteOriginal, d.DDeImportePendiente, d.DDeEstado
FROM   dbo.DeudaDocumento d
LEFT   JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = d.DocIdDocumento
WHERE  d.CueIdCuenta = @Cue
  AND  d.DocIdDocumento IS NOT NULL
  AND  NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m
                   WHERE m.CueIdCuenta = @Cue AND ISNULL(m.MovAnulado,0) = 0
                     AND m.DocIdDocumento = d.DocIdDocumento)
ORDER  BY doc.DocFechaEmision;

/* ── 4b) DEUDAS COLGADAS DE UNA ORDEN, SIN DOCUMENTO ────────────────────────
   No son un error en sí (nacen de una orden antes de facturarse), pero por no tener
   DocIdDocumento no aparecen en el cruce por documento del bloque 2.                 */
SELECT '4b. DEUDAS SIN DOCUMENTO' AS Bloque,
       d.DDeIdDocumento, d.OrdIdOrden, d.OReIdOrdenRetiro,
       d.DDeImporteOriginal, d.DDeImportePendiente, d.DDeEstado, d.DDeFechaEmision
FROM   dbo.DeudaDocumento d
WHERE  d.CueIdCuenta = @Cue AND d.DocIdDocumento IS NULL
ORDER  BY d.DDeFechaEmision;

/* ── 4c) DOCUMENTOS CON MÁS DE UNA FILA DE DEUDA (deuda duplicada) ──────────
   Un documento tiene que tener UNA deuda. Dos filas = la deuda vale el doble de lo que
   dice el documento, los pagos van a una y la otra sobrevive. No hay UNIQUE que lo frene.
   Comparar SumaDeuda contra DocTotal: si SumaDeuda ≈ 2 × DocTotal, está duplicada.      */
SELECT '4c. DEUDA DUPLICADA' AS Bloque,
       d.DocIdDocumento, doc.DocSerie + '-' + doc.DocNumero AS Doc, doc.DocTipo,
       doc.DocFechaEmision, doc.DocTotal,
       COUNT(*)                        AS FilasDeuda,
       SUM(d.DDeImporteOriginal)       AS SumaDeudaOriginal,
       SUM(d.DDeImportePendiente)      AS SumaPendiente,
       SUM(d.DDeImporteOriginal) - doc.DocTotal AS DeMas
FROM   dbo.DeudaDocumento d
JOIN   dbo.DocumentosContables doc ON doc.DocIdDocumento = d.DocIdDocumento
WHERE  d.CueIdCuenta = @Cue
GROUP  BY d.DocIdDocumento, doc.DocSerie, doc.DocNumero, doc.DocTipo, doc.DocFechaEmision, doc.DocTotal
HAVING COUNT(*) > 1 OR ABS(SUM(d.DDeImporteOriginal) - doc.DocTotal) > 0.01
ORDER  BY ABS(SUM(d.DDeImporteOriginal) - doc.DocTotal) DESC;


/* ── 5) EL LIBRO COMPLETO DE LA CUENTA ──────────────────────────────────────
   Para leer a ojo la historia y ubicar el momento en que se abrió la brecha.
   Incluye la columna de saldo acumulado recalculado (no el MovSaldoPosterior, que
   queda viejo cuando se toca un movimiento anterior).                                */
SELECT '5. LIBRO' AS Bloque,
       m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte,
       SUM(m.MovImporte) OVER (ORDER BY m.MovFecha, m.MovIdMovimiento
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS SaldoAcumulado,
       m.MovSaldoPosterior AS SaldoGuardado,
       m.DocIdDocumento, doc.DocSerie + '-' + doc.DocNumero AS Doc,
       LEFT(m.MovConcepto, 70) AS Concepto, m.PagIdPago
FROM   dbo.MovimientosCuenta m
LEFT   JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = m.DocIdDocumento
WHERE  m.CueIdCuenta = @Cue AND ISNULL(m.MovAnulado,0) = 0
  AND  m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
ORDER  BY m.MovFecha, m.MovIdMovimiento;


/* ── 6a) DETALLE DE LOS DOCUMENTOS QUE MÁS DESCUADRAN ────────────────────────
   Todos los movimientos y toda la deuda de cada documento con |Descuadre| > 1, uno
   al lado del otro. Sirve para ver a mano si hay un pago que bajó la deuda sin dejar
   movimiento (el patrón de AUDITORIA_COBROS_SIN_MOVIMIENTO), o al revés.             */
-- Tabla temporal (no un CTE): un CTE solo vale para la sentencia que lo sigue, y acá
-- se necesita en 3 SELECT separados (6a, 6b, 6c).
IF OBJECT_ID('tempdb..#Candidatos') IS NOT NULL DROP TABLE #Candidatos;
SELECT ISNULL(mov.DocIdDocumento, deu.DocIdDocumento) AS DocId
INTO   #Candidatos
FROM  (SELECT DocIdDocumento, SUM(MovImporte) AS MovNeto
       FROM dbo.MovimientosCuenta
       WHERE CueIdCuenta = @Cue AND ISNULL(MovAnulado,0)=0
         AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND DocIdDocumento IS NOT NULL
       GROUP BY DocIdDocumento) mov
FULL OUTER JOIN
      (SELECT DocIdDocumento, SUM(DDeImportePendiente) AS DeudaPendiente
       FROM dbo.DeudaDocumento
       WHERE CueIdCuenta = @Cue AND DocIdDocumento IS NOT NULL
       GROUP BY DocIdDocumento) deu
ON deu.DocIdDocumento = mov.DocIdDocumento
WHERE ABS(ISNULL(mov.MovNeto,0) + ISNULL(deu.DeudaPendiente,0)) > 1;

SELECT '6a. MOVIMIENTOS DE LOS DOCS QUE DESCUADRAN' AS Bloque,
       m.DocIdDocumento, m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte,
       m.PagIdPago, LEFT(m.MovConcepto,60) AS Concepto, LEFT(m.MovObservaciones,60) AS Observaciones
FROM   dbo.MovimientosCuenta m
WHERE  m.CueIdCuenta = @Cue AND ISNULL(m.MovAnulado,0) = 0
  AND  m.DocIdDocumento IN (SELECT DocId FROM #Candidatos)
ORDER  BY m.DocIdDocumento, m.MovFecha;

SELECT '6b. DEUDA DE LOS DOCS QUE DESCUADRAN' AS Bloque,
       d.DocIdDocumento, d.DDeIdDocumento, d.DDeImporteOriginal, d.DDeImportePendiente,
       d.DDeEstado, d.DDeFechaEmision, d.DDeFechaCobro
FROM   dbo.DeudaDocumento d
WHERE  d.CueIdCuenta = @Cue
  AND  d.DocIdDocumento IN (SELECT DocId FROM #Candidatos)
ORDER  BY d.DocIdDocumento;

/* ── 6c) PAGOS DE ESOS DOCUMENTOS QUE FIGURAN EN OTRA TRANSACCIÓN ───────────
   Si la deuda bajó pero el movimiento no quedó estampado a ESTE documento, buscar
   el pago por transacción de caja del propio documento (TcaIdTransaccion) — puede
   que el movimiento exista pero con DocIdDocumento NULL o apuntando a otro doc.      */
SELECT '6c. TRANSACCION Y PAGOS DEL DOC' AS Bloque,
       doc.DocIdDocumento, doc.TcaIdTransaccion, doc.DocPagado,
       p.PagIdPago, p.PagMontoPago, p.PagIdMonedaPago, p.PagFechaPago, p.PagTipoMovimiento
FROM   dbo.DocumentosContables doc
LEFT   JOIN dbo.Pagos p ON p.PagTcaIdTransaccion = doc.TcaIdTransaccion
WHERE  doc.DocIdDocumento IN (SELECT DocId FROM #Candidatos)
ORDER  BY doc.DocIdDocumento;

DROP TABLE #Candidatos;


/* ── 6) LO QUE LA CONSULTA 5 DEJA AFUERA ────────────────────────────────────
   Órdenes (no entran al saldo del panel) y movimientos anulados. Se listan para que
   no queden como sorpresa: si algo acá está mal clasificado, también mueve la brecha. */
SELECT '6. EXCLUIDOS' AS Bloque,
       m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte, m.MovAnulado,
       m.DocIdDocumento, LEFT(m.MovConcepto, 70) AS Concepto,
       LEFT(m.MovObservaciones, 60) AS Observaciones
FROM   dbo.MovimientosCuenta m
WHERE  m.CueIdCuenta = @Cue
  AND  (m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') OR ISNULL(m.MovAnulado,0) = 1)
ORDER  BY m.MovFecha, m.MovIdMovimiento;
