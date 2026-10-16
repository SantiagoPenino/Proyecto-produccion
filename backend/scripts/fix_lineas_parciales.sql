/* ============================================================================
   FIX LÍNEAS — CASOS PARCIALES / SIN LÍNEAS (los 4 que no entran al MAESTRO)
   ----------------------------------------------------------------------------
   Docs donde el costo real de las órdenes NO explica el DocTotal:
     · PC-1058, ET-1518, ET-1752 : pedido multi-servicio facturado PARCIAL
       (la orden se cobró menos que su detalle completo; no se puede deducir el
        subgrupo facturado).
     · ET-1192 : líneas suman MENOS que el DocTotal (falta detalle).
     · ET-1971 : línea huérfana sin orden ("Sublimacion Tela - Delta") 16,20 vs DocTotal 13,50.
     · ET-1 : documento con DocTotal>0 y SIN líneas.

   NOTA: es idempotente — re-correr sobre docs ya colapsados da el mismo resultado.
   Solución pragmática: COLAPSAR a UNA sola línea = DocTotal (queda consistente
   y DGI la acepta porque es > 0). Son BORRADOR/PENDIENTE — editables en la app.

   Solo docs SIN CAE. NO toca DocTotal, ledger, deuda ni saldo.
   Por defecto ROLLBACK. Revisá VERIFICACIÓN y cambiá a COMMIT.
   ============================================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('tempdb..#objetivo') IS NOT NULL DROP TABLE #objetivo;

SELECT
    dc.DocIdDocumento,
    RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) AS Doc,
    CAST(dc.DocTotal AS decimal(18,4)) AS DocTotal,
    -- descripción a conservar (primera línea existente; si no hay, genérica)
    LEFT(ISNULL((SELECT TOP 1 d.DcdNomItem FROM dbo.DocumentosContablesDetalle d
                 WHERE d.DocIdDocumento = dc.DocIdDocumento AND NULLIF(LTRIM(RTRIM(d.DcdNomItem)),'') IS NOT NULL
                 ORDER BY d.DcdIdDetalle), 'Servicios de produccion'), 200) AS Descripcion
INTO #objetivo
FROM dbo.DocumentosContables dc
WHERE RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) IN ('PC-1058','ET-1518','ET-1752','ET-1192','ET-1971','ET-1')
  AND dc.CfeCAE IS NULL
  AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%');

/* ---- CONTROL ---- */
SELECT o.Doc, o.DocTotal, o.Descripcion,
       (SELECT COUNT(*) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = o.DocIdDocumento) AS LineasActuales
FROM #objetivo o ORDER BY o.Doc;

/* ---- 1) Borrar las líneas actuales ---- */
DELETE d
FROM dbo.DocumentosContablesDetalle d
JOIN #objetivo o ON o.DocIdDocumento = d.DocIdDocumento;

/* ---- 2) Insertar UNA línea = DocTotal (IVA 22% incluido) ---- */
INSERT INTO dbo.DocumentosContablesDetalle
    (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal)
SELECT
    o.DocIdDocumento, o.Descripcion, o.Descripcion, 1,
    o.DocTotal,
    ROUND(o.DocTotal / 1.22, 4),
    ROUND(o.DocTotal - o.DocTotal / 1.22, 4),
    o.DocTotal
FROM #objetivo o;

/* ---- VERIFICACIÓN ---- */
SELECT o.Doc, CAST(o.DocTotal AS decimal(18,2)) AS DocTotal,
       CAST((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = o.DocIdDocumento) AS decimal(18,2)) AS SumaLineas_Ahora,
       CAST(ABS(o.DocTotal - ISNULL((SELECT SUM(d.DcdTotal) FROM dbo.DocumentosContablesDetalle d WHERE d.DocIdDocumento = o.DocIdDocumento),0)) AS decimal(18,2)) AS Diferencia
FROM #objetivo o ORDER BY o.Doc;

DROP TABLE #objetivo;

/* Revisá VERIFICACIÓN (Diferencia 0). Si está OK, cambiá abajo a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
