/* ============================================================================
   FIX LÍNEAS — MAESTRO (cross-moneda + rework + over-count, en un solo script)
   ----------------------------------------------------------------------------
   Deja la suma de líneas (DocumentosContablesDetalle) = DocTotal (la factura manda),
   reconstruyendo cada línea desde el COSTO REAL de su orden (OrdenesDeposito.OrdCostoFinal),
   convertido a la moneda del documento. Reemplaza a los 3 scripts parciales.

   MECANISMO por línea:
     · Valor correcto = OrdCostoFinal de la orden (via OrdCodigoOrden), convertido a
       la moneda del doc con la cotización (pesos->USD ÷cot, USD->pesos ×cot).
     · Reposición sin cargo (código -R# y OrdCostoFinal=0) -> se BORRA la línea
       (es re-trabajo gratis; no puede ir en 0 porque DGI lo rechaza).
     · Escalado proporcional final: cada línea × (DocTotal / SumaReconstruida) para
       que cierre EXACTO (absorbe centavos por deriva de cotización).

   BLINDAJES (elegible solo si):
     · Doc no anulado y SIN CAE (CfeCAE IS NULL) -> no toca nada aceptado por DGI.
     · No es recibo (serie RC).
     · La suma reconstruida cae en [0,995 , 1,005] × DocTotal -> el costo real EXPLICA
       el DocTotal. Deja afuera anomalías (facturado parcial, ratio ~2×+) y el ruido
       de redondeo IVA ~1%, que NO se tocan (van a revisión manual).

   NO toca DocTotal, MovimientosCuenta, DeudaDocumento ni el saldo.
   Por defecto ROLLBACK. Revisá CONTROL + VERIFICACIÓN y cambiá a COMMIT.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @cot float = (SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC);
SET @cot = ISNULL(@cot, 40);
PRINT 'Cotizacion usada: US$1 = $' + CAST(@cot AS varchar(20));

/* Opcional: probar un solo doc. NULL = todos los elegibles. */
DECLARE @FiltroDoc VARCHAR(30) = NULL;   -- ej: 'PC-1274'

/* ---- 1) Valor correcto de cada línea (costo real convertido) ---- */
IF OBJECT_ID('tempdb..#lin') IS NOT NULL DROP TABLE #lin;
SELECT
    d.DcdIdDetalle, d.DocIdDocumento, d.DcdCantidad,
    dc.DocTotal, dc.MonIdMoneda AS DocMon,
    od.MonIdMoneda AS OrdMon, od.OrdCostoFinal,
    CASE WHEN d.OrdCodigoOrden LIKE '%-R[0-9]%' AND ISNULL(od.OrdCostoFinal,0) = 0
         THEN 1 ELSE 0 END AS EsRepoGratis,
    CAST(CASE
        WHEN od.MonIdMoneda IS NULL           THEN d.DcdTotal                              -- sin orden: dejar
        WHEN od.MonIdMoneda = dc.MonIdMoneda   THEN ISNULL(od.OrdCostoFinal, d.DcdTotal)     -- misma moneda
        WHEN dc.MonIdMoneda = 2 AND od.MonIdMoneda = 1 THEN ISNULL(od.OrdCostoFinal,d.DcdTotal) / @cot  -- pesos->USD
        WHEN dc.MonIdMoneda = 1 AND od.MonIdMoneda = 2 THEN ISNULL(od.OrdCostoFinal,d.DcdTotal) * @cot  -- USD->pesos
        ELSE ISNULL(od.OrdCostoFinal, d.DcdTotal)
    END AS decimal(18,4)) AS ValorCorrecto
INTO #lin
FROM dbo.DocumentosContables dc
JOIN dbo.DocumentosContablesDetalle d ON d.DocIdDocumento = dc.DocIdDocumento
OUTER APPLY (SELECT TOP 1 o.MonIdMoneda, o.OrdCostoFinal
             FROM dbo.OrdenesDeposito o WHERE o.OrdCodigoOrden = d.OrdCodigoOrden) od
WHERE dc.CfeCAE IS NULL
  AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
  AND RTRIM(dc.DocSerie) <> 'RC'
  AND (@FiltroDoc IS NULL OR RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) = @FiltroDoc)
  AND ABS(dc.DocTotal - (SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x
                          WHERE x.DocIdDocumento = dc.DocIdDocumento)) > 2.0;

/* ---- 2) Por doc: suma reconstruida (sin las repo gratis) + factor de escala ---- */
IF OBJECT_ID('tempdb..#doc') IS NOT NULL DROP TABLE #doc;
SELECT
    l.DocIdDocumento, MAX(l.DocTotal) AS DocTotal,
    CAST(SUM(CASE WHEN l.EsRepoGratis = 1 THEN 0 ELSE l.ValorCorrecto END) AS decimal(18,4)) AS SumaRecon
INTO #doc
FROM #lin l
GROUP BY l.DocIdDocumento;

IF OBJECT_ID('tempdb..#elig') IS NOT NULL DROP TABLE #elig;
SELECT *,
    CAST(DocTotal / NULLIF(SumaRecon,0) AS decimal(18,8)) AS Escala
INTO #elig
FROM #doc
WHERE SumaRecon > 0
  AND (SumaRecon / DocTotal) BETWEEN 0.995 AND 1.005;   -- el costo real explica el DocTotal

/* ---- 3) CONTROL — qué se corrige ---- */
SELECT
    RTRIM(cli.NombreFantasia) AS Cliente,
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    CASE WHEN doc.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
    RTRIM(ISNULL(doc.CfeEstado,'-')) AS Cfe,
    CAST(e.DocTotal AS decimal(18,2)) AS DocTotal,
    CAST((SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x WHERE x.DocIdDocumento=e.DocIdDocumento) AS decimal(18,2)) AS SumaAntes,
    CAST(e.SumaRecon AS decimal(18,2)) AS SumaReconstruida,
    (SELECT COUNT(*) FROM #lin l WHERE l.DocIdDocumento=e.DocIdDocumento AND l.EsRepoGratis=1) AS LineasRepoBorradas
FROM #elig e
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = e.DocIdDocumento
LEFT JOIN dbo.Clientes cli ON cli.CliIdCliente = doc.CliIdCliente
ORDER BY Cliente, Comprobante;

DECLARE @nDoc INT = (SELECT COUNT(*) FROM #elig);
PRINT CONCAT('Documentos a corregir: ', @nDoc);

/* ---- 4a) BORRAR las líneas de reposición sin cargo ---- */
DELETE d
FROM dbo.DocumentosContablesDetalle d
JOIN #lin  l ON l.DcdIdDetalle   = d.DcdIdDetalle
JOIN #elig e ON e.DocIdDocumento = d.DocIdDocumento
WHERE l.EsRepoGratis = 1;

/* ---- 4b) REESCRIBIR las líneas restantes = ValorCorrecto × Escala (cierra exacto) ---- */
UPDATE d
SET d.DcdTotal          = ROUND(l.ValorCorrecto * e.Escala, 4),
    d.DcdSubtotal       = ROUND(l.ValorCorrecto * e.Escala / 1.22, 4),
    d.DcdImpuestos      = ROUND(l.ValorCorrecto * e.Escala - l.ValorCorrecto * e.Escala / 1.22, 4),
    d.DcdPrecioUnitario = ROUND(l.ValorCorrecto * e.Escala / NULLIF(l.DcdCantidad,0), 4)
FROM dbo.DocumentosContablesDetalle d
JOIN #lin  l ON l.DcdIdDetalle   = d.DcdIdDetalle
JOIN #elig e ON e.DocIdDocumento = d.DocIdDocumento
WHERE l.EsRepoGratis = 0;

/* ---- 4c) Ajuste de centavo: el residuo de redondeo va a la línea de mayor total ---- */
;WITH resid AS (
    SELECT e.DocIdDocumento, e.DocTotal,
           (SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x WHERE x.DocIdDocumento = e.DocIdDocumento) AS SumaAhora
    FROM #elig e
),
target AS (
    SELECT r.DocIdDocumento,
           CAST(r.DocTotal - r.SumaAhora AS decimal(18,4)) AS Delta,
           (SELECT TOP 1 d.DcdIdDetalle FROM dbo.DocumentosContablesDetalle d
            WHERE d.DocIdDocumento = r.DocIdDocumento ORDER BY d.DcdTotal DESC) AS DcdId
    FROM resid r
    WHERE ABS(r.DocTotal - r.SumaAhora) > 0.001
)
UPDATE d
SET d.DcdTotal     = d.DcdTotal + t.Delta,
    d.DcdSubtotal  = ROUND((d.DcdTotal + t.Delta) / 1.22, 4),
    d.DcdImpuestos = ROUND((d.DcdTotal + t.Delta) - (d.DcdTotal + t.Delta) / 1.22, 4)
FROM dbo.DocumentosContablesDetalle d
JOIN target t ON t.DcdId = d.DcdIdDetalle;

/* ---- 5) VERIFICACIÓN — suma de líneas (después) vs DocTotal ---- */
SELECT
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    CAST(e.DocTotal AS decimal(18,2)) AS DocTotal,
    CAST((SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x WHERE x.DocIdDocumento=e.DocIdDocumento) AS decimal(18,2)) AS SumaLineas_Ahora,
    CAST(ABS(e.DocTotal - ISNULL((SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x WHERE x.DocIdDocumento=e.DocIdDocumento),0)) AS decimal(18,2)) AS Diferencia
FROM #elig e
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = e.DocIdDocumento
ORDER BY Diferencia DESC, Comprobante;

DROP TABLE #lin; DROP TABLE #doc; DROP TABLE #elig;

/* Revisá CONTROL + VERIFICACIÓN (Diferencia debe ser 0). Si está OK, cambiá abajo a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
