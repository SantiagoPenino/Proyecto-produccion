/* ============================================================================
   FIX LÍNEAS SOBRE-CONTADAS + CROSS-MONEDA — casos híbridos (PC-1373, PC-1559)
   ----------------------------------------------------------------------------
   QUÉ ARREGLA
     Dos Pedido Caja BORRADOR donde UNA línea es a la vez:
       (a) sobre-contada: su importe = el DocTotal completo del pedido, y
       (b) cross-moneda: la orden está en otra moneda que el documento.
     El resto de las líneas son correctas. El HEADER (DocTotal) manda y está bien.

     Verificado contra la fuente (OrdenesDeposito.OrdCostoFinal):
       · PC-1373  VEN-2109 = 297,00 UYU  → en doc US$ = 297/cot ≈ 7,28  US$
                  (línea vieja decía 71,18 = DocTotal). Resto: SB-65716 = 63,90.
       · PC-1559  DTF-3431 = 2,48 US$   → en doc UYU = 2,48*cot ≈ 101,13 UYU
                  (línea vieja decía 10.496,13 = DocTotal). Resto: 495 + 9.900 = 10.395.
     En ambos, el valor real coincide EXACTO con el residual (DocTotal − suma del resto).

   QUÉ HACE
     A la línea sobre-contada le pone el residual = DocTotal − (suma de las demás
     líneas). Así la suma de líneas cierra EXACTO contra el DocTotal (la factura manda).
     Solo toca esa fila de dbo.DocumentosContablesDetalle. NO toca DocTotal, ledger,
     deuda ni saldo.

   BLINDAJES
     · Solo los 2 docs de la lista, no anulados y sin CAE (CfeCAE IS NULL).
     · Exige que exista UNA sola línea con importe ≈ DocTotal (la sobre-contada) y
       que el residual sea positivo y menor que el importe viejo. Si no, no toca.

   Por defecto ROLLBACK. Revisá CONTROL + VERIFICACIÓN y cambiá a COMMIT.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

/* ---- 1) Docs objetivo ---- */
IF OBJECT_ID('tempdb..#t') IS NOT NULL DROP TABLE #t;
SELECT dc.DocIdDocumento, dc.DocTotal
INTO #t
FROM dbo.DocumentosContables dc
WHERE RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) IN ('PC-1373', 'PC-1559')
  AND dc.CfeCAE IS NULL
  AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%');

/* ---- 2) Localizar la línea sobre-contada (única con importe ≈ DocTotal) y el residual ---- */
IF OBJECT_ID('tempdb..#fix') IS NOT NULL DROP TABLE #fix;
SELECT
    t.DocIdDocumento,
    t.DocTotal,
    oc.DcdIdDetalle,
    oc.DcdTotal        AS TotalViejo,
    oc.DcdCantidad,
    CAST(t.DocTotal - ISNULL(otros.SumaOtros, 0) AS DECIMAL(18,4)) AS NuevoTotal,
    nOver.N            AS LineasOvercount
INTO #fix
FROM #t t
CROSS APPLY (
    SELECT TOP 1 d.DcdIdDetalle, d.DcdTotal, d.DcdCantidad
    FROM dbo.DocumentosContablesDetalle d
    WHERE d.DocIdDocumento = t.DocIdDocumento
      AND ABS(d.DcdTotal - t.DocTotal) < 2.0
    ORDER BY d.DcdTotal DESC
) oc
OUTER APPLY (
    SELECT SUM(d2.DcdTotal) AS SumaOtros
    FROM dbo.DocumentosContablesDetalle d2
    WHERE d2.DocIdDocumento = t.DocIdDocumento AND d2.DcdIdDetalle <> oc.DcdIdDetalle
) otros
CROSS APPLY (
    SELECT COUNT(*) AS N
    FROM dbo.DocumentosContablesDetalle d3
    WHERE d3.DocIdDocumento = t.DocIdDocumento AND ABS(d3.DcdTotal - t.DocTotal) < 2.0
) nOver
WHERE nOver.N = 1                                        -- una sola línea sobre-contada
  AND (t.DocTotal - ISNULL(otros.SumaOtros, 0)) > 0.01   -- residual positivo
  AND (t.DocTotal - ISNULL(otros.SumaOtros, 0)) < oc.DcdTotal;  -- baja (no sube)

/* ---- 3) CONTROL ---- */
SELECT
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    RTRIM(d.OrdCodigoOrden) AS OrdenCorregida,
    CAST(f.DocTotal    AS DECIMAL(18,2)) AS DocTotal,
    CAST(f.TotalViejo  AS DECIMAL(18,2)) AS LineaVieja,
    CAST(f.NuevoTotal  AS DECIMAL(18,2)) AS LineaNueva,
    CAST(f.DocTotal - f.NuevoTotal AS DECIMAL(18,2)) AS SumaOtrasLineas
FROM #fix f
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = f.DocIdDocumento
JOIN dbo.DocumentosContablesDetalle d ON d.DcdIdDetalle = f.DcdIdDetalle
ORDER BY Comprobante;

DECLARE @n INT = (SELECT COUNT(*) FROM #fix);
PRINT CONCAT('Líneas a corregir: ', @n, ' (esperado 2: PC-1373, PC-1559)');

/* ---- 4) CORREGIR la línea sobre-contada al residual ---- */
UPDATE d
SET d.DcdTotal          = f.NuevoTotal,
    d.DcdSubtotal       = ROUND(f.NuevoTotal / 1.22, 4),
    d.DcdImpuestos      = ROUND(f.NuevoTotal - f.NuevoTotal / 1.22, 4),
    d.DcdPrecioUnitario = ROUND(f.NuevoTotal / NULLIF(f.DcdCantidad, 0), 4)
FROM dbo.DocumentosContablesDetalle d
JOIN #fix f ON f.DcdIdDetalle = d.DcdIdDetalle;

/* ---- 5) VERIFICACIÓN ---- */
SELECT
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    CAST(f.DocTotal AS DECIMAL(18,2)) AS DocTotal,
    CAST((SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x
          WHERE x.DocIdDocumento = f.DocIdDocumento) AS DECIMAL(18,2)) AS SumaLineas_Ahora,
    CAST(ABS(f.DocTotal - (SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x
          WHERE x.DocIdDocumento = f.DocIdDocumento)) AS DECIMAL(18,2)) AS Diferencia
FROM #fix f
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = f.DocIdDocumento
ORDER BY Comprobante;

DROP TABLE #t; DROP TABLE #fix;

/* Revisá CONTROL + VERIFICACIÓN (Diferencia ~0). Si está OK, cambiá abajo a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
