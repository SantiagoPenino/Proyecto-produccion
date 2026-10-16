/* =====================================================================
   Nueva columna: DocumentosContables.CfeFechaDgi
   ---------------------------------------------------------------------
   Guarda la FECHA con la que el CFE quedó emitido ante DGI, que puede no
   coincidir con DocFechaEmision: los documentos quedan en la bandeja CFE
   y se emiten días después (en julio 2026, ~1.700 de ~1.940 aceptados se
   emitieron con fecha distinta a la contable).

   Hasta ahora esa fecha no se guardaba en ninguna columna, pero sí viaja
   dentro de la URL del QR de DGI (CfeUrlImpresion), campo 6:
     ...consultaQR/cfe?RUC,tipo,serie,numero,monto,AAAAMMDD,hash

   Este script:
     1. Agrega la columna (DATE NULL, aditiva).
     2. Backfill: la llena parseando la URL del QR de todos los documentos
        ya aceptados. Los que no tengan URL parseable quedan NULL.

   Las emisiones NUEVAS la estampan solas (actualizarFirmaCFE en
   backend/services/contabilidadCore.js).

   Ejecutar en PRODUCCIÓN antes (o junto con) el deploy.
   ===================================================================== */

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME   = 'DocumentosContables'
      AND COLUMN_NAME  = 'CfeFechaDgi'
)
BEGIN
    ALTER TABLE dbo.DocumentosContables ADD CfeFechaDgi DATE NULL;
    PRINT 'Columna CfeFechaDgi agregada.';
END
ELSE
BEGIN
    PRINT 'La columna CfeFechaDgi ya existe, no se hace nada.';
END
GO

/* ── Backfill desde la URL del QR ──────────────────────────────────────
   Toma el 6º campo separado por comas después del '?' y lo convierte a
   DATE (formato 112 = AAAAMMDD). Solo toca filas ACEPTADO_DGI que aún
   no tienen la fecha cargada, así el script es re-ejecutable. */

UPDATE d
SET d.CfeFechaDgi = TRY_CONVERT(date, f.Fecha8, 112)
FROM dbo.DocumentosContables d
CROSS APPLY (SELECT SUBSTRING(d.CfeUrlImpresion, CHARINDEX('?', d.CfeUrlImpresion) + 1, 4000) AS q) a
CROSS APPLY (SELECT CHARINDEX(',', a.q)            AS p1) b
CROSS APPLY (SELECT CHARINDEX(',', a.q, b.p1 + 1)  AS p2) c
CROSS APPLY (SELECT CHARINDEX(',', a.q, c.p2 + 1)  AS p3) e
CROSS APPLY (SELECT CHARINDEX(',', a.q, e.p3 + 1)  AS p4) g
CROSS APPLY (SELECT CHARINDEX(',', a.q, g.p4 + 1)  AS p5) h
CROSS APPLY (SELECT CHARINDEX(',', a.q, h.p5 + 1)  AS p6) i
CROSS APPLY (SELECT CASE WHEN h.p5 > 0 AND i.p6 > h.p5
                         THEN SUBSTRING(a.q, h.p5 + 1, i.p6 - h.p5 - 1)
                    END AS Fecha8) f
WHERE d.CfeEstado = 'ACEPTADO_DGI'
  AND d.CfeUrlImpresion IS NOT NULL
  AND CHARINDEX('?', d.CfeUrlImpresion) > 0
  AND d.CfeFechaDgi IS NULL
  AND f.Fecha8 IS NOT NULL
  AND LEN(f.Fecha8) = 8
  AND f.Fecha8 NOT LIKE '%[^0-9]%';

PRINT CONCAT('Backfill: ', @@ROWCOUNT, ' documentos actualizados.');
GO

/* ── Verificación ───────────────────────────────────────────────────── */
SELECT
    COUNT(*)                                                        AS AceptadosDGI,
    SUM(CASE WHEN CfeFechaDgi IS NOT NULL THEN 1 ELSE 0 END)        AS ConFechaDgi,
    SUM(CASE WHEN CfeFechaDgi IS NULL THEN 1 ELSE 0 END)            AS SinFechaDgi,
    SUM(CASE WHEN CfeFechaDgi <> CAST(DocFechaEmision AS DATE)
             THEN 1 ELSE 0 END)                                     AS FechaDistintaALaContable
FROM dbo.DocumentosContables WITH(NOLOCK)
WHERE CfeEstado = 'ACEPTADO_DGI';
