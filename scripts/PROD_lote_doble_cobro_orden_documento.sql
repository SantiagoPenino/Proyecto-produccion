/* ============================================================================
   LOTE — COBRO DOBLE: a nivel ORDEN y otra vez a nivel DOCUMENTO
   Correr en PRODUCCIÓN. Modifica dbo.MovimientosCuenta (anula el cobro repetido y
   engancha el cobro por orden al documento), MovSaldoPosterior y
   CuentasCliente.CueSaldoActual. NO toca DeudaDocumento ni Pagos.

   QUÉ PASÓ (05-09-2026): cuando una orden se cubría con saldo a favor o con un
   cruce de monedas, quedaba un PAGO/PAGO_CRUZADO colgado de la ORDEN (sin
   DocIdDocumento). Al emitir después el documento, las rutas de emisión
   estampaban DocIdDocumento SOLO en las ORDEN: el documento nacía "sin cobro" a
   los ojos de todos, la deuda por el total, y la caja lo cobraba otra vez.
   Resultado: la misma plata dos veces en el libro → saldo "a favor" falso.
   Medido en la réplica: 57 documentos, ~45 clientes, $ 25.863 + US$ 497.
   El código ya se corrigió (vincularPagosPorOrdenAlDocumento): esto limpia lo
   acumulado.

   REGLA: el cobro a nivel ORDEN es el real (vino primero, es la cobertura). El
   cobro a nivel DOCUMENTO posterior por el mismo importe es el repetido.

   QUÉ HACE, por documento que cumpla TODOS los candados:
     1. Anula el cobro a nivel documento (MovAnulado = 1, NO borra) con motivo.
     2. Estampa DocIdDocumento en los cobros por orden (el documento pasa a
        mostrar su cobro real — lo mismo que ahora hace el código al emitir).
     3. Recalcula saldo corrido y CueSaldoActual de las cuentas tocadas.

   CANDADOS (si un documento no cumple, se lista y NO se toca):
     · documento PC/ET/FA, no anulado, con sus ORDEN estampadas
     · UN solo movimiento de cobro a nivel documento, vivo
     · ese cobro ≈ total del documento (en la moneda de la cuenta, tolerancia 0,02)
     · los cobros por orden de ESAS órdenes, en la MISMA cuenta, suman ≥ el total
     · los cobros por orden son ANTERIORES al cobro por documento
   Los que cubren solo una parte (cobertura parcial) se listan aparte: ahí el
   cobro por documento puede ser legítimo por el resto y se mira a mano.

   Es idempotente: la 2ª corrida no encuentra candidatos.
   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   Para mirar sin escribir: correr hasta el "FIN DE LA VISTA PREVIA".
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

SELECT Servidor = @@SERVERNAME, Base = DB_NAME(),
       Archivo = (SELECT TOP 1 physical_name FROM sys.database_files WHERE type = 0);

DECLARE @Tol DECIMAL(18,4) = 0.02;

/* ── Candidatos ──────────────────────────────────────────────────────────── */
IF OBJECT_ID('tempdb..#cand') IS NOT NULL DROP TABLE #cand;

;WITH OrdDoc AS (
    SELECT DISTINCT o.OrdIdOrden, o.DocIdDocumento, o.CueIdCuenta
    FROM dbo.MovimientosCuenta o
    WHERE o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND o.DocIdDocumento IS NOT NULL
      AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
), PagoOrden AS (
    SELECT p.OrdIdOrden, p.CueIdCuenta,
           Importe = SUM(p.MovImporte), UltimaFecha = MAX(p.MovFecha)
    FROM dbo.MovimientosCuenta p
    WHERE p.MovTipo IN ('PAGO','PAGO_CRUZADO') AND p.MovImporte > 0
      AND p.DocIdDocumento IS NULL AND p.OrdIdOrden IS NOT NULL
      AND (p.MovAnulado IS NULL OR p.MovAnulado = 0)
    GROUP BY p.OrdIdOrden, p.CueIdCuenta
), PagoDoc AS (
    SELECT d.DocIdDocumento, d.CueIdCuenta,
           Importe = SUM(d.MovImporte), Movs = COUNT(*),
           MovId = MIN(d.MovIdMovimiento), Fecha = MIN(d.MovFecha)
    FROM dbo.MovimientosCuenta d
    WHERE d.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND d.MovImporte > 0
      AND d.DocIdDocumento IS NOT NULL AND (d.MovAnulado IS NULL OR d.MovAnulado = 0)
    GROUP BY d.DocIdDocumento, d.CueIdCuenta
), X AS (
    SELECT od.DocIdDocumento, od.CueIdCuenta,
           PagoOrden = SUM(po.Importe), UltPagoOrden = MAX(po.UltimaFecha),
           PagoDoc = MAX(pd.Importe), MovsDoc = MAX(pd.Movs), MovDoc = MAX(pd.MovId), FechaDoc = MAX(pd.Fecha)
    FROM OrdDoc od
    JOIN PagoOrden po ON po.OrdIdOrden = od.OrdIdOrden AND po.CueIdCuenta = od.CueIdCuenta
    JOIN PagoDoc  pd ON pd.DocIdDocumento = od.DocIdDocumento AND pd.CueIdCuenta = od.CueIdCuenta
    GROUP BY od.DocIdDocumento, od.CueIdCuenta
)
SELECT x.DocIdDocumento, x.CueIdCuenta, x.MovDoc, x.PagoOrden, x.PagoDoc, x.MovsDoc,
       Cliente  = RTRIM(c.Nombre),
       Doc      = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR),
       dc.CfeEstado,
       Moneda   = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       -- total del documento en la moneda de la cuenta
       TotalCta = CASE WHEN dc.MonIdMoneda = cc.MonIdMoneda THEN dc.DocTotal
                       WHEN dc.MonIdMoneda = 1 AND cc.MonIdMoneda = 2 AND ISNULL(dc.DocCotizacion,0) > 0 THEN dc.DocTotal / dc.DocCotizacion
                       WHEN dc.MonIdMoneda = 2 AND cc.MonIdMoneda = 1 AND ISNULL(dc.DocCotizacion,0) > 0 THEN dc.DocTotal * dc.DocCotizacion
                       ELSE NULL END,
       OrdenAntes = CASE WHEN x.UltPagoOrden < x.FechaDoc THEN 1 ELSE 0 END,
       Veredicto = CAST(NULL AS VARCHAR(40))
INTO #cand
FROM X x
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = x.DocIdDocumento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = x.CueIdCuenta
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE RTRIM(dc.DocSerie) IN ('PC','ET','FA')
  AND ISNULL(dc.DocEstado,'') <> 'ANULADO';

UPDATE #cand SET Veredicto = CASE
    WHEN TotalCta IS NULL                          THEN 'x monedas sin cotizacion'
    WHEN MovsDoc <> 1                              THEN 'x mas de un cobro por documento'
    WHEN ABS(PagoDoc - TotalCta) > @Tol            THEN 'x cobro por documento <> total'
    WHEN OrdenAntes = 0                            THEN 'x el cobro por orden es posterior'
    WHEN PagoOrden + @Tol < TotalCta               THEN 'parcial: revisar a mano'
    ELSE 'ANULAR cobro por documento' END;

/* ── VISTA PREVIA ────────────────────────────────────────────────────────── */
SELECT Resumen = 'POR VEREDICTO', Veredicto, Moneda,
       Documentos = COUNT(*), Clientes = COUNT(DISTINCT Cliente),
       CobroDocumento = CAST(SUM(PagoDoc) AS DECIMAL(18,2))
FROM #cand GROUP BY Veredicto, Moneda ORDER BY Veredicto, Moneda;

SELECT Detalle = 'A ANULAR', Cliente, Doc, CfeEstado, Moneda,
       Total = CAST(TotalCta AS DECIMAL(18,2)),
       CobroPorOrden = CAST(PagoOrden AS DECIMAL(18,2)),
       CobroPorDocumento = CAST(PagoDoc AS DECIMAL(18,2)),
       MovAAnular = MovDoc
FROM #cand WHERE Veredicto = 'ANULAR cobro por documento'
ORDER BY PagoDoc DESC;

SELECT Detalle = 'NO SE TOCAN', Cliente, Doc, Moneda, Veredicto,
       Total = CAST(TotalCta AS DECIMAL(18,2)),
       CobroPorOrden = CAST(PagoOrden AS DECIMAL(18,2)),
       CobroPorDocumento = CAST(PagoDoc AS DECIMAL(18,2))
FROM #cand WHERE Veredicto <> 'ANULAR cobro por documento'
ORDER BY Veredicto, PagoDoc DESC;

/* ==================== FIN DE LA VISTA PREVIA ==============================
   Hasta acá no se escribió NADA.
   ========================================================================= */

BEGIN TRANSACTION;

    /* 1 · anular el cobro repetido a nivel documento */
    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' FIX_DOBLE_COBRO_2026-09-05: la(s) orden(es) de este documento ya tenían su cobro a'
            + ' nivel orden por ' + CONVERT(varchar(20), CAST(k.PagoOrden AS decimal(18,2)))
            + ' (cobertura/cruce). Al emitir el documento no se enganchó ese cobro y la caja lo'
            + ' cobró otra vez. Se anula el repetido; el cobro por orden queda enganchado al documento.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN #cand k ON k.MovDoc = m.MovIdMovimiento
    WHERE k.Veredicto = 'ANULAR cobro por documento';
    PRINT CONCAT('1) Cobros repetidos anulados: ', @@ROWCOUNT);

    /* 2 · enganchar los cobros por orden al documento (lo que hoy hace el código) */
    UPDATE p
    SET p.DocIdDocumento = k.DocIdDocumento
    FROM dbo.MovimientosCuenta p
    JOIN dbo.MovimientosCuenta o ON o.OrdIdOrden = p.OrdIdOrden AND o.CueIdCuenta = p.CueIdCuenta
                                AND o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
    JOIN #cand k ON k.DocIdDocumento = o.DocIdDocumento AND k.CueIdCuenta = p.CueIdCuenta
    WHERE k.Veredicto = 'ANULAR cobro por documento'
      AND p.MovTipo IN ('PAGO','PAGO_CRUZADO') AND p.MovImporte > 0
      AND p.DocIdDocumento IS NULL AND (p.MovAnulado IS NULL OR p.MovAnulado = 0);
    PRINT CONCAT('2) Cobros por orden enganchados al documento: ', @@ROWCOUNT);

    /* 3 · saldo corrido y guardado de las cuentas tocadas */
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #cand WHERE Veredicto = 'ANULAR cobro por documento')
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #cand WHERE Veredicto = 'ANULAR cobro por documento');

COMMIT TRANSACTION;

/* ── DESPUÉS: las cuentas tocadas, libro vs deuda documentada ────────────── */
SELECT Momento = 'DESPUES', Cliente = RTRIM(cl.Nombre), cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro  = CAST(s.Saldo AS DECIMAL(18,2)),
       DeudasVivas = CAST(dv.Viva AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
CROSS APPLY (SELECT Viva = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
               WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DocIdDocumento IS NOT NULL
                 AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01), 0)) dv
WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM #cand WHERE Veredicto = 'ANULAR cobro por documento')
ORDER BY Cliente;

DROP TABLE #cand;
