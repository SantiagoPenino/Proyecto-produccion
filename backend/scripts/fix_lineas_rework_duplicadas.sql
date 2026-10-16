/* ============================================================================
   FIX LÍNEAS REWORK DUPLICADAS — Pedido Caja (variante "sobre-conteo rework")
   ----------------------------------------------------------------------------
   QUÉ ARREGLA
     Documentos donde una orden de RE-TRABAJO (código con sufijo -R1/-R2/-R3…)
     metió una línea EXTRA cuyo importe es el TOTAL COMPLETO del pedido (no su
     propio precio). Resultado: la suma de líneas queda en ~2× el DocTotal.
     El HEADER (DocTotal), el LEDGER y el saldo están BIEN — sobra la línea.

   QUÉ HACE
     Detecta docs donde las líneas NO-rework ya suman EXACTO el DocTotal y además
     hay líneas rework que son puro exceso, y BORRA esas líneas rework. Tras el
     borrado la suma de líneas cierra contra el DocTotal (la factura manda).

     Solo toca dbo.DocumentosContablesDetalle (borra filas rework sobrantes).
     NO toca DocTotal, NI MovimientosCuenta, NI DeudaDocumento, NI el saldo.

   BLINDAJES
     · Solo docs NO anulados y SIN CAE (CfeCAE IS NULL) → no aceptados por DGI.
       (Los 9 detectados hoy son todos BORRADOR / Pedido Caja interno.)
     · Exige que las líneas NO-rework ya sumen el DocTotal (± 0,05). Si no cierran,
       NO se toca (la línea rework podría ser un cargo real → revisión manual).
     · Exige que la suma total esté desfasada (> 2) y que el rework sea > 0,05.
     · Solo borra líneas cuyo OrdCodigoOrden matchea el patrón rework '%-R[0-9]%'.

   Por defecto ROLLBACK. Revisá CONTROL + VERIFICACIÓN y cambiá a COMMIT.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

/* Opcional: probar UN solo doc primero. NULL = todos los elegibles. */
DECLARE @FiltroDoc VARCHAR(30) = NULL;   -- ej: 'PC-1068'

/* ---- 1) Clasificar líneas (rework vs no) de los docs candidatos ---- */
IF OBJECT_ID('tempdb..#l') IS NOT NULL DROP TABLE #l;

SELECT
    d.DcdIdDetalle,
    d.DocIdDocumento,
    RTRIM(ISNULL(d.OrdCodigoOrden, '')) AS OrdCod,
    RTRIM(d.DcdNomItem) AS Item,
    d.DcdTotal,
    dc.DocTotal,
    CASE WHEN d.OrdCodigoOrden LIKE '%-R[0-9]%' THEN 1 ELSE 0 END AS EsRework
INTO #l
FROM dbo.DocumentosContables dc
JOIN dbo.DocumentosContablesDetalle d ON d.DocIdDocumento = dc.DocIdDocumento
WHERE (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
  AND dc.CfeCAE IS NULL
  AND (@FiltroDoc IS NULL OR RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) = @FiltroDoc);

/* ---- 2) Docs elegibles: NO-rework ya cierra con DocTotal, y sobra rework ---- */
IF OBJECT_ID('tempdb..#elig') IS NOT NULL DROP TABLE #elig;

SELECT
    g.DocIdDocumento, g.DocTotal, g.SumaNoRework, g.SumaRework, g.SumaTotal, g.NRework, g.NLineas
INTO #elig
FROM (
    SELECT
        DocIdDocumento,
        MAX(DocTotal) AS DocTotal,
        SUM(CASE WHEN EsRework = 0 THEN DcdTotal ELSE 0 END) AS SumaNoRework,
        SUM(CASE WHEN EsRework = 1 THEN DcdTotal ELSE 0 END) AS SumaRework,
        SUM(DcdTotal) AS SumaTotal,
        SUM(EsRework) AS NRework,
        COUNT(*)      AS NLineas
    FROM #l
    GROUP BY DocIdDocumento
) g
WHERE g.NRework >= 1
  AND ABS(g.SumaTotal   - g.DocTotal) > 2.0     -- está desfasado
  AND ABS(g.SumaNoRework - g.DocTotal) <= 0.05  -- lo NO-rework ya cierra exacto
  AND g.SumaRework > 0.05;                       -- el rework es puro exceso

/* ---- 3) CONTROL — documentos afectados ---- */
SELECT
    RTRIM(cli.NombreFantasia) AS Cliente,
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    RTRIM(ISNULL(doc.CfeEstado,'-')) AS CfeEstado,
    CAST(e.DocTotal     AS DECIMAL(18,2)) AS DocTotal,
    CAST(e.SumaNoRework AS DECIMAL(18,2)) AS LineasReales,
    CAST(e.SumaRework   AS DECIMAL(18,2)) AS ReworkQueSeBorra,
    e.NRework AS LineasBorradas,
    e.NLineas AS LineasTotales
FROM #elig e
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = e.DocIdDocumento
LEFT JOIN dbo.Clientes cli ON cli.CliIdCliente = doc.CliIdCliente
ORDER BY Cliente, Comprobante;

/* ---- 3b) Detalle exacto de las líneas que se van a BORRAR ---- */
SELECT
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    l.DcdIdDetalle, l.OrdCod, l.Item,
    CAST(l.DcdTotal AS DECIMAL(18,2)) AS TotalLinea
FROM #l l
JOIN #elig e  ON e.DocIdDocumento = l.DocIdDocumento
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = l.DocIdDocumento
WHERE l.EsRework = 1
ORDER BY Comprobante, l.DcdIdDetalle;

DECLARE @nDoc INT = (SELECT COUNT(*) FROM #elig);
DECLARE @nLin INT = (SELECT COUNT(*) FROM #l l JOIN #elig e ON e.DocIdDocumento = l.DocIdDocumento WHERE l.EsRework = 1);
PRINT CONCAT('Documentos afectados: ', @nDoc, ' | Líneas rework a borrar: ', @nLin);

/* ---- 4) BORRAR las líneas rework sobrantes de los docs elegibles ---- */
DELETE d
FROM dbo.DocumentosContablesDetalle d
JOIN #l    l ON l.DcdIdDetalle   = d.DcdIdDetalle
JOIN #elig e ON e.DocIdDocumento = d.DocIdDocumento
WHERE l.EsRework = 1;

/* ---- 5) VERIFICACIÓN — suma de líneas (después) vs DocTotal por doc ---- */
SELECT
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    CAST(e.DocTotal AS DECIMAL(18,2)) AS DocTotal,
    CAST((SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x
          WHERE x.DocIdDocumento = e.DocIdDocumento) AS DECIMAL(18,2)) AS SumaLineas_Ahora,
    CAST(ABS(e.DocTotal - ISNULL((SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x
          WHERE x.DocIdDocumento = e.DocIdDocumento),0)) AS DECIMAL(18,2)) AS Diferencia
FROM #elig e
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = e.DocIdDocumento
ORDER BY Diferencia DESC, Comprobante;

DROP TABLE #l; DROP TABLE #elig;

/* Revisá CONTROL + VERIFICACIÓN (Diferencia ~0). Si está OK, cambiá abajo a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
