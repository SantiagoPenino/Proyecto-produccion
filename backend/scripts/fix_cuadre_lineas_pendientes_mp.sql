-- ════════════════════════════════════════════════════════════════════════════
-- fix_cuadre_lineas_pendientes_mp.sql
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ HACE: cuadra las líneas (DocumentosContablesDetalle) de los documentos
-- PENDIENTE cuyas líneas no suman el total del documento (los ~195 descuadrados
-- por la cotización de MercadoPago: MP cobra los pedidos USD en pesos con SU
-- cotización —40,41— y las líneas se convirtieron con la cotización del día).
-- Prorratea las líneas existentes al DocTotal: LO COBRADO MANDA. No cambia
-- composición ni textos, solo importes (total/subtotal/IVA/precio unitario).
--
-- QUÉ NO TOCA: DocTotal, deuda, movimientos, asientos, caja. Documentos
-- ACEPTADO_DGI, ANULADO o BORRADOR no se tocan (solo CfeEstado='PENDIENTE').
--
-- CASOS PUNTUALES INCLUIDOS (composición incorrecta, no es prorrateo):
--   ET-2634: se elimina la línea fantasma de DTF-7991 (orden sin cargo que salió
--            con el total del retiro, duplicando el documento).
--   ET-819:  la línea de DTF-3467 salió con el total del retiro (16,76) en vez
--            de su costo real (15,56); se corrige a 15,56.
--   ET-3954: se elimina la línea de DF-224 (35,20): esa orden estaba cubierta y
--            NO se cobró en este documento (se cobró solo DTF-11704 = US$ 22).
--
-- SEGURIDAD:
--   · Respaldo previo de TODAS las líneas a tocar en
--     dbo.DocumentosContablesDetalle_bak_cuadre_mp (si la tabla ya existe, el
--     script ABORTA: señal de que ya se corrió).
--   · Banda de sanidad: solo prorratea si el factor está entre 0,75 y 1,25
--     (los de MP son ~0,99). Lo que quede afuera se lista al final, no se toca.
--   · @APLICAR = 0 simula todo y revierte (ROLLBACK); = 1 aplica (COMMIT).
--
-- IDEMPOTENTE en la práctica: re-corrido, ya no hay docs con dif > 1 y no toca
-- nada (pero la tabla de respaldo lo aborta antes; borrarla para re-correr).
-- ════════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
SET XACT_ABORT ON;   -- cualquier error → rollback total automático

DECLARE @APLICAR BIT = 1;   -- 1 = aplicar (COMMIT) | 0 = simular (ROLLBACK)

IF OBJECT_ID('dbo.DocumentosContablesDetalle_bak_cuadre_mp') IS NOT NULL
BEGIN
    RAISERROR('ABORTADO: dbo.DocumentosContablesDetalle_bak_cuadre_mp ya existe — este script ya se corrió. Si querés re-correrlo a propósito, renombrá/borrá esa tabla primero.', 16, 1);
    RETURN;
END

BEGIN TRAN;

-- ─── 0. Foto previa ─────────────────────────────────────────────────────────
SELECT 'ANTES: pendientes descuadrados (dif > $1)' AS Etapa,
       COUNT(*)                                   AS Docs,
       CAST(SUM(ABS(s.SumaLin - d.DocTotal)) AS DECIMAL(18,2)) AS DifAcumulada
FROM dbo.DocumentosContables d
CROSS APPLY (SELECT CAST(SUM(dd.DcdTotal) AS DECIMAL(18,2)) AS SumaLin
             FROM dbo.DocumentosContablesDetalle dd
             WHERE dd.DocIdDocumento = d.DocIdDocumento) s
WHERE d.CfeEstado = 'PENDIENTE' AND s.SumaLin IS NOT NULL
  AND ABS(s.SumaLin - d.DocTotal) > 1.0;

-- ─── 1. Respaldo de todas las líneas de los docs a tocar ────────────────────
SELECT CAST(GETDATE() AS DATETIME) AS BakFecha, dd.*
INTO dbo.DocumentosContablesDetalle_bak_cuadre_mp
FROM dbo.DocumentosContablesDetalle dd
WHERE dd.DocIdDocumento IN (
    SELECT d.DocIdDocumento
    FROM dbo.DocumentosContables d
    CROSS APPLY (SELECT SUM(x.DcdTotal) AS SumaLin
                 FROM dbo.DocumentosContablesDetalle x
                 WHERE x.DocIdDocumento = d.DocIdDocumento) s
    WHERE d.CfeEstado = 'PENDIENTE' AND s.SumaLin IS NOT NULL
      AND ABS(s.SumaLin - d.DocTotal) > 1.0
);
SELECT 'Respaldo creado (DocumentosContablesDetalle_bak_cuadre_mp)' AS Etapa,
       @@ROWCOUNT AS LineasRespaldadas;

-- ─── 2. Caso puntual ET-2634: eliminar línea fantasma DTF-7991 ──────────────
-- La orden DTF-7991 (sin cargo, costo 0) salió con el TOTAL del retiro (3,73)
-- duplicando la línea real de ECOUV-14613. Guardas: solo si el doc sigue
-- PENDIENTE, con 2 líneas, y la fantasma vale exactamente 3,73.
DELETE dd
FROM dbo.DocumentosContablesDetalle dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE RTRIM(d.DocSerie) = 'ET' AND LTRIM(RTRIM(d.DocNumero)) = '2634'
  AND d.CfeEstado = 'PENDIENTE' AND d.DocTotal = 3.73
  AND dd.OrdCodigoOrden = 'DTF-7991' AND dd.DcdTotal = 3.73
  AND (SELECT COUNT(*) FROM dbo.DocumentosContablesDetalle x
       WHERE x.DocIdDocumento = d.DocIdDocumento) = 2;
SELECT 'ET-2634: línea fantasma DTF-7991 eliminada' AS Etapa, @@ROWCOUNT AS Filas;

-- ─── 3. Caso puntual ET-819: línea DTF-3467 de 16,76 → 15,56 ────────────────
-- (su costo real; 15,56/1,22 = 12,75 de neto + 2,81 de IVA)
UPDATE dd SET
    DcdTotal          = 15.56,
    DcdSubtotal       = 12.75,
    DcdImpuestos      = 2.81,
    DcdPrecioUnitario = ROUND(15.56 / NULLIF(dd.DcdCantidad, 0), 4)
FROM dbo.DocumentosContablesDetalle dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE RTRIM(d.DocSerie) = 'ET' AND LTRIM(RTRIM(d.DocNumero)) = '819'
  AND d.CfeEstado = 'PENDIENTE' AND d.DocTotal = 16.76
  AND dd.OrdCodigoOrden = 'DTF-3467' AND dd.DcdTotal = 16.76;
SELECT 'ET-819: línea DTF-3467 corregida a 15,56' AS Etapa, @@ROWCOUNT AS Filas;

-- ─── 3.b Caso puntual ET-3954: eliminar línea de DF-224 (no se cobró acá) ───
-- El retiro RT-21375 tenía 2 órdenes pero DF-224 (35,20) estaba cubierta por
-- otra vía y la caja cobró solo DTF-11704 (US$ 22 = el DocTotal). La línea de
-- DF-224 no corresponde a este documento.
DELETE dd
FROM dbo.DocumentosContablesDetalle dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE RTRIM(d.DocSerie) = 'ET' AND LTRIM(RTRIM(d.DocNumero)) = '3954'
  AND d.CfeEstado = 'PENDIENTE' AND d.DocTotal = 22.00
  AND dd.OrdCodigoOrden = 'DF-224' AND dd.DcdTotal = 35.20
  AND (SELECT COUNT(*) FROM dbo.DocumentosContablesDetalle x
       WHERE x.DocIdDocumento = d.DocIdDocumento) = 2;
SELECT 'ET-3954: línea de DF-224 (cubierta, no cobrada acá) eliminada' AS Etapa, @@ROWCOUNT AS Filas;

-- ─── 4. Universo a prorratear (después de los puntuales) ────────────────────
IF OBJECT_ID('tempdb..#afectados') IS NOT NULL DROP TABLE #afectados;
SELECT d.DocIdDocumento,
       RTRIM(d.DocSerie) + '-' + LTRIM(RTRIM(d.DocNumero)) AS Doc,
       CAST(d.DocTotal AS DECIMAL(18,2))  AS DocTotal,
       s.SumaLin,
       CAST(d.DocTotal / s.SumaLin AS DECIMAL(28,12)) AS Factor
INTO #afectados
FROM dbo.DocumentosContables d
CROSS APPLY (SELECT CAST(SUM(dd.DcdTotal) AS DECIMAL(18,2)) AS SumaLin
             FROM dbo.DocumentosContablesDetalle dd
             WHERE dd.DocIdDocumento = d.DocIdDocumento) s
WHERE d.CfeEstado = 'PENDIENTE'
  AND d.DocTotal > 0 AND s.SumaLin > 0
  AND ABS(s.SumaLin - d.DocTotal) > 1.0
  AND d.DocTotal / s.SumaLin BETWEEN 0.75 AND 1.25;   -- banda de sanidad (MP ≈ 0,99)

SELECT 'Docs a prorratear' AS Etapa, COUNT(*) AS Docs FROM #afectados;

-- ─── 5. Prorrateo: cada línea × factor (lo cobrado manda) ───────────────────
-- Exentas (DcdImpuestos = 0): subtotal = total. Gravadas: neto = total/1,22.
-- (DcdImpuestos NULL se trata como gravada, igual que la emisión a DGI.)
UPDATE dd SET
    DcdTotal          = ROUND(dd.DcdTotal * a.Factor, 2),
    DcdSubtotal       = CASE WHEN dd.DcdImpuestos = 0
                             THEN ROUND(dd.DcdTotal * a.Factor, 2)
                             ELSE ROUND(ROUND(dd.DcdTotal * a.Factor, 2) / 1.22, 2) END,
    DcdImpuestos      = CASE WHEN dd.DcdImpuestos = 0
                             THEN 0
                             ELSE ROUND(dd.DcdTotal * a.Factor, 2)
                                  - ROUND(ROUND(dd.DcdTotal * a.Factor, 2) / 1.22, 2) END,
    DcdPrecioUnitario = CASE WHEN ISNULL(dd.DcdCantidad, 0) = 0
                             THEN dd.DcdPrecioUnitario
                             ELSE ROUND(ROUND(dd.DcdTotal * a.Factor, 2) / dd.DcdCantidad, 4) END
FROM dbo.DocumentosContablesDetalle dd
JOIN #afectados a ON a.DocIdDocumento = dd.DocIdDocumento;
SELECT 'Líneas prorrateadas' AS Etapa, @@ROWCOUNT AS Filas;

-- ─── 6. Ajuste de redondeo: la línea mayor absorbe los centésimos ───────────
;WITH sumas AS (
    SELECT a.DocIdDocumento,
           CAST(a.DocTotal - SUM(dd.DcdTotal) AS DECIMAL(18,2)) AS Resto
    FROM #afectados a
    JOIN dbo.DocumentosContablesDetalle dd ON dd.DocIdDocumento = a.DocIdDocumento
    GROUP BY a.DocIdDocumento, a.DocTotal
    HAVING ABS(a.DocTotal - SUM(dd.DcdTotal)) >= 0.01
),
pick AS (
    SELECT dd.DcdIdDetalle, dd.DcdCantidad, dd.DcdImpuestos, dd.DcdTotal,
           dd.DcdSubtotal, dd.DcdPrecioUnitario, s.Resto,
           ROW_NUMBER() OVER (PARTITION BY dd.DocIdDocumento
                              ORDER BY dd.DcdTotal DESC, dd.DcdIdDetalle) AS rn
    FROM dbo.DocumentosContablesDetalle dd
    JOIN sumas s ON s.DocIdDocumento = dd.DocIdDocumento
)
UPDATE pick SET
    DcdTotal          = DcdTotal + Resto,
    DcdSubtotal       = CASE WHEN DcdImpuestos = 0
                             THEN DcdTotal + Resto
                             ELSE ROUND((DcdTotal + Resto) / 1.22, 2) END,
    DcdImpuestos      = CASE WHEN DcdImpuestos = 0
                             THEN 0
                             ELSE (DcdTotal + Resto) - ROUND((DcdTotal + Resto) / 1.22, 2) END,
    DcdPrecioUnitario = CASE WHEN ISNULL(DcdCantidad, 0) = 0
                             THEN DcdPrecioUnitario
                             ELSE ROUND((DcdTotal + Resto) / DcdCantidad, 4) END
WHERE rn = 1;
SELECT 'Ajuste de centésimos aplicado' AS Etapa, @@ROWCOUNT AS Filas;

-- ─── 7. Verificación final ──────────────────────────────────────────────────
-- 7a. Los prorrateados tienen que sumar EXACTO su DocTotal
SELECT '7a. Prorrateados que NO cierran exacto (esperado: 0 filas)' AS Etapa,
       a.Doc, a.DocTotal, CAST(SUM(dd.DcdTotal) AS DECIMAL(18,2)) AS SumaNueva
FROM #afectados a
JOIN dbo.DocumentosContablesDetalle dd ON dd.DocIdDocumento = a.DocIdDocumento
GROUP BY a.Doc, a.DocTotal
HAVING ABS(a.DocTotal - SUM(dd.DcdTotal)) >= 0.01;

-- 7b. Pendientes que siguen descuadrados > $1 (esperado: 0 filas)
SELECT '7b. PENDIENTE aún descuadrados (esperado: 0 filas)' AS Etapa,
       RTRIM(d.DocSerie) + '-' + LTRIM(RTRIM(d.DocNumero)) AS Doc,
       d.DocTotal, s.SumaLin,
       CAST(s.SumaLin - d.DocTotal AS DECIMAL(18,2)) AS Dif
FROM dbo.DocumentosContables d
CROSS APPLY (SELECT CAST(SUM(dd.DcdTotal) AS DECIMAL(18,2)) AS SumaLin
             FROM dbo.DocumentosContablesDetalle dd
             WHERE dd.DocIdDocumento = d.DocIdDocumento) s
WHERE d.CfeEstado = 'PENDIENTE' AND s.SumaLin IS NOT NULL
  AND ABS(s.SumaLin - d.DocTotal) > 1.0;

-- 7c. Muestra de control (los 2 puntuales + el caso testigo ET-4034)
SELECT '7c. Muestra' AS Etapa,
       RTRIM(d.DocSerie) + '-' + LTRIM(RTRIM(d.DocNumero)) AS Doc,
       d.DocTotal,
       (SELECT CAST(SUM(dd.DcdTotal) AS DECIMAL(18,2))
        FROM dbo.DocumentosContablesDetalle dd
        WHERE dd.DocIdDocumento = d.DocIdDocumento) AS SumaLineas
FROM dbo.DocumentosContables d
WHERE RTRIM(d.DocSerie) = 'ET' AND LTRIM(RTRIM(d.DocNumero)) IN ('2634','819','4034','3730');

-- ─── 8. Cierre ──────────────────────────────────────────────────────────────
IF @APLICAR = 1
BEGIN
    COMMIT;
    SELECT 'RESULTADO' AS Etapa, 'APLICADO (COMMIT). Respaldo en dbo.DocumentosContablesDetalle_bak_cuadre_mp' AS Detalle;
END
ELSE
BEGIN
    ROLLBACK;
    SELECT 'RESULTADO' AS Etapa, 'SIMULACIÓN (ROLLBACK): no se cambió nada. Poné @APLICAR = 1 para aplicar.' AS Detalle;
END
