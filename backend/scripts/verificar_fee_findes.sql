-- =============================================================================
-- Verificación: órdenes ingresadas desde el jueves pasado a la fecha cuya
-- FECHA PROMETIDA (FechaEstimadaEntrega) cae en sábado o domingo.
-- Solo LECTURA (SELECT). No modifica nada. Correr tal cual en la base.
-- =============================================================================
SET NOCOUNT ON;

DECLARE @Hoy DATE = CAST(GETDATE() AS DATE);
-- Día ISO de hoy: 1=Lunes ... 7=Domingo (mismo cálculo que usa sp_CalcularFechaEntrega,
-- así no depende de la configuración regional del servidor).
DECLARE @DiaISO INT = ((DATEPART(WEEKDAY, @Hoy) + @@DATEFIRST - 2) % 7) + 1;
-- Jueves más reciente (si hoy es jueves, toma hoy).
DECLARE @JuevesPasado DATE = DATEADD(DAY, -((@DiaISO - 4 + 7) % 7), @Hoy);

PRINT 'Hoy: ' + CONVERT(VARCHAR(10), @Hoy, 103) + '   Jueves tomado como inicio: ' + CONVERT(VARCHAR(10), @JuevesPasado, 103);

-- ── Resumen ──────────────────────────────────────────────────────────────────
SELECT
    COUNT(*)                                                                          AS OrdenesIngresadas,
    SUM(CASE WHEN FechaEstimadaEntrega IS NOT NULL THEN 1 ELSE 0 END)                  AS ConFechaPrometida,
    SUM(CASE WHEN ((DATEPART(WEEKDAY, FechaEstimadaEntrega) + @@DATEFIRST - 2) % 7) + 1
              IN (6, 7) THEN 1 ELSE 0 END)                                             AS PrometidasEnFinde,
    CAST(100.0 * SUM(CASE WHEN ((DATEPART(WEEKDAY, FechaEstimadaEntrega) + @@DATEFIRST - 2) % 7) + 1
              IN (6, 7) THEN 1 ELSE 0 END)
         / NULLIF(SUM(CASE WHEN FechaEstimadaEntrega IS NOT NULL THEN 1 ELSE 0 END), 0)
         AS DECIMAL(5,1))                                                              AS PctEnFinde
FROM dbo.Ordenes
WHERE FechaIngreso >= @JuevesPasado;

-- ── Detalle: cada orden cuya fecha prometida cae en sábado o domingo ─────────
SELECT
    o.OrdenID, o.CodigoOrden, o.AreaID, o.Cliente, o.Prioridad,
    o.FechaIngreso, o.FechaEstimadaEntrega,
    CASE ((DATEPART(WEEKDAY, o.FechaEstimadaEntrega) + @@DATEFIRST - 2) % 7) + 1
        WHEN 6 THEN 'Sábado' WHEN 7 THEN 'Domingo' END                                 AS DiaPrometido,
    o.Estado, o.EstadoenArea,
    CASE WHEN o.Estado NOT IN ('Entregado','Finalizado','Cancelado','Anulado','Rechazado')
              AND GETDATE() > o.FechaEstimadaEntrega THEN 'SÍ' ELSE 'no' END            AS YaVencidaSinTerminar
FROM dbo.Ordenes o
WHERE o.FechaIngreso >= @JuevesPasado
  AND o.FechaEstimadaEntrega IS NOT NULL
  AND ((DATEPART(WEEKDAY, o.FechaEstimadaEntrega) + @@DATEFIRST - 2) % 7) + 1 IN (6, 7)
ORDER BY o.FechaEstimadaEntrega, o.AreaID;
