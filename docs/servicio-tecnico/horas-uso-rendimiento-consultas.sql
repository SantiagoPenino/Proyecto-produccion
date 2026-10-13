-- ============================================================================================
-- Horas de uso y rendimiento de las máquinas: ¿alcanza la bitácora de producción? (08/10/2026)
-- Consultas SOLO DE LECTURA para correr en producción. Explicación y propuesta:
-- docs/servicio-tecnico/horas-uso-y-rendimiento.md
--
-- La bitácora (dbo.BitacoraProduccion) tiene un tramo por cada vez que un lote corre en una
-- máquina: se abre con ▶ (productionController, action 'start') y se cierra al pausar, al
-- finalizar (cualquier destino) o cuando el lote queda vacío después de arrancar
-- (utils/salidaDeLote). NO se cierra si el lote en marcha se arrastra a otra máquina o a la mesa
-- (productionKanbanController.assignRoll / unassignRoll): ese tramo queda abierto hasta que el
-- lote se pause o finalice en otro lado, y entonces se cierra con esa hora. Q2 y Q3 miden eso.
-- DuracionMinutos no la escribe nadie: la duración sale de FechaFin - FechaInicio.
-- ============================================================================================


-- Q1. Por máquina: cuántos tramos hay, cuántos quedaron abiertos y cuántos son raros.
-- Mirar: AbiertosViejos (abiertos hace más de un día: lotes movidos en marcha o perdidos),
-- TramosMas12h (casi seguro un lote que quedó corriendo), y desde cuándo hay datos.
SELECT LTRIM(RTRIM(e.AreaID)) AS Area, LTRIM(RTRIM(e.Nombre)) AS Maquina,
       COUNT(*) AS Tramos,
       SUM(CASE WHEN b.FechaFin IS NULL THEN 1 ELSE 0 END) AS Abiertos,
       SUM(CASE WHEN b.FechaFin IS NULL AND b.FechaInicio < DATEADD(DAY, -1, GETDATE()) THEN 1 ELSE 0 END) AS AbiertosViejos,
       SUM(CASE WHEN DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin) > 12 * 60 THEN 1 ELSE 0 END) AS TramosMas12h,
       SUM(CASE WHEN DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin) < 1 THEN 1 ELSE 0 END) AS TramosMenos1min,
       CAST(SUM(CASE WHEN DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin) BETWEEN 1 AND 12 * 60
                     THEN DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin) END) / 60.0 AS DECIMAL(10, 1)) AS HorasNormales,
       CAST(MIN(b.FechaInicio) AS DATE) AS Desde, CAST(MAX(b.FechaInicio) AS DATE) AS Hasta
FROM dbo.BitacoraProduccion b
JOIN dbo.ConfigEquipos e ON e.EquipoID = b.MaquinaID
GROUP BY e.AreaID, e.Nombre
ORDER BY Area, Maquina;


-- Q2. Tramos CERRADOS que se pisan en la MISMA máquina (dos lotes "corriendo" a la vez). En la
-- pantalla no se puede arrancar un segundo lote con otro en marcha, así que esto sale de tramos que
-- quedaron abiertos y se cerraron tarde. Mirar: HorasPisadas (lo que se contaría dos veces).
-- (Los tramos que siguen abiertos se cuentan en Q1: estirados hasta hoy darían números sin sentido.)
SELECT LTRIM(RTRIM(e.Nombre)) AS Maquina, COUNT(*) AS Pares,
       CAST(SUM(DATEDIFF(MINUTE,
            CASE WHEN a.FechaInicio > b.FechaInicio THEN a.FechaInicio ELSE b.FechaInicio END,
            CASE WHEN a.FechaFin < b.FechaFin THEN a.FechaFin ELSE b.FechaFin END)) / 60.0 AS DECIMAL(10, 1)) AS HorasPisadas
FROM dbo.BitacoraProduccion a
JOIN dbo.BitacoraProduccion b
  ON b.MaquinaID = a.MaquinaID AND b.BitacoraID > a.BitacoraID
 AND b.FechaInicio < a.FechaFin AND a.FechaInicio < b.FechaFin
JOIN dbo.ConfigEquipos e ON e.EquipoID = a.MaquinaID
WHERE a.FechaFin IS NOT NULL AND b.FechaFin IS NOT NULL
GROUP BY e.Nombre
ORDER BY HorasPisadas DESC;


-- Q3. Lotes que arrancaron en OTRA máquina con el tramo de la primera todavía abierto (el lote se
-- movió en marcha). La primera máquina se queda con horas que no trabajó. Los 50 más recientes, sin
-- los cruces de menos de un minuto (el pase normal de la impresora a la calandra o al samurai).
SELECT TOP 50 a.RolloID,
       LTRIM(RTRIM(ea.Nombre)) AS PrimeraMaquina, a.FechaInicio AS InicioPrimera, a.FechaFin AS FinPrimera,
       LTRIM(RTRIM(eb.Nombre)) AS SegundaMaquina, b.FechaInicio AS InicioSegunda,
       DATEDIFF(MINUTE, b.FechaInicio, ISNULL(a.FechaFin, GETDATE())) AS MinutosDeMasEnLaPrimera
FROM dbo.BitacoraProduccion a
JOIN dbo.BitacoraProduccion b
  ON b.RolloID = a.RolloID AND b.MaquinaID <> a.MaquinaID AND b.BitacoraID > a.BitacoraID
 AND b.FechaInicio < ISNULL(a.FechaFin, GETDATE())
JOIN dbo.ConfigEquipos ea ON ea.EquipoID = a.MaquinaID
JOIN dbo.ConfigEquipos eb ON eb.EquipoID = b.MaquinaID
WHERE DATEDIFF(MINUTE, b.FechaInicio, ISNULL(a.FechaFin, GETDATE())) >= 1
ORDER BY a.FechaInicio DESC;


-- Q4. Días imposibles: una máquina con más de 16 h de tramos en un mismo día (últimas 8 semanas).
-- Cada tramo cuenta en el día en que arrancó. Si aparecen muchos, las horas de la bitácora no sirven
-- tal cual: habría que recortarlas al horario del área.
SELECT LTRIM(RTRIM(e.Nombre)) AS Maquina, CAST(b.FechaInicio AS DATE) AS Dia, COUNT(*) AS Tramos,
       CAST(SUM(DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin)) / 60.0 AS DECIMAL(6, 1)) AS Horas
FROM dbo.BitacoraProduccion b
JOIN dbo.ConfigEquipos e ON e.EquipoID = b.MaquinaID
WHERE b.FechaFin IS NOT NULL AND b.FechaInicio >= DATEADD(DAY, -56, CAST(GETDATE() AS DATE))
GROUP BY e.Nombre, CAST(b.FechaInicio AS DATE)
HAVING SUM(DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin)) > 16 * 60
ORDER BY Horas DESC;


-- Q5. Horas de uso por máquina y por mes (tramos cerrados de 1 min a 12 h). Sirve para ver el ritmo:
-- con ~N horas por mes, un mantenimiento "cada 500 horas" cae cada 500/N meses.
SELECT LTRIM(RTRIM(e.AreaID)) AS Area, LTRIM(RTRIM(e.Nombre)) AS Maquina,
       FORMAT(b.FechaInicio, 'yyyy-MM') AS Mes, COUNT(*) AS Tramos,
       CAST(SUM(DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin)) / 60.0 AS DECIMAL(8, 1)) AS Horas
FROM dbo.BitacoraProduccion b
JOIN dbo.ConfigEquipos e ON e.EquipoID = b.MaquinaID
WHERE b.FechaFin IS NOT NULL AND DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin) BETWEEN 1 AND 12 * 60
GROUP BY e.AreaID, e.Nombre, FORMAT(b.FechaInicio, 'yyyy-MM')
ORDER BY Area, Maquina, Mes;


-- Q6. Rendimiento real contra la ficha, por máquina, últimos 60 días.
-- Producción de cada lote = sus órdenes de HOY (Magnitud, o MagnitudCapacidad si está, como
-- Planificación: puntadas en Bordado), una vez por lote aunque haya corrido en varios tramos. Tiempo =
-- la suma de sus tramos cerrados de 1 min a 12 h en esa máquina. Ficha = VelocidadValor × Cabezales
-- (velocidad por cabezal, como Planificación; sin cabezales, × 1).
-- Solo lotes SIN tramos abiertos: si no, se compararía la producción entera del lote con una parte
-- de su tiempo.
-- Ojo: solo tiene sentido donde la unidad de la ficha es la de Magnitud (DF, SB y ECOUV en metros,
-- EMB en puntadas, TPU en unidades). Las órdenes que salieron del lote (impresión parcial, sacadas a
-- mano) no cuentan, y una calandra cuenta los metros del lote que pasó por ella.
WITH tramos AS (
    SELECT b.MaquinaID, TRY_CONVERT(INT, b.RolloID) AS RolloID, SUM(DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin)) AS Minutos
    FROM dbo.BitacoraProduccion b
    WHERE b.FechaFin IS NOT NULL AND b.FechaInicio >= DATEADD(DAY, -60, GETDATE())
      AND DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin) BETWEEN 1 AND 12 * 60
      AND NOT EXISTS (SELECT 1 FROM dbo.BitacoraProduccion x WHERE x.RolloID = b.RolloID AND x.FechaFin IS NULL)
    GROUP BY b.MaquinaID, TRY_CONVERT(INT, b.RolloID)
), lotes AS (
    SELECT t.MaquinaID, t.RolloID, t.Minutos,
           (SELECT SUM(ISNULL(o.MagnitudCapacidad, TRY_CAST(o.Magnitud AS DECIMAL(18, 2))))
            FROM dbo.Ordenes o
            WHERE o.RolloID = t.RolloID AND o.Estado NOT IN ('Cancelado', 'CANCELADO')) AS Produccion
    FROM tramos t
)
SELECT LTRIM(RTRIM(e.AreaID)) AS Area, LTRIM(RTRIM(e.Nombre)) AS Maquina, COUNT(*) AS Lotes,
       CAST(SUM(l.Minutos) / 60.0 AS DECIMAL(10, 1)) AS Horas,
       CAST(SUM(l.Produccion) AS DECIMAL(14, 1)) AS Produccion, RTRIM(e.VelocidadUnidad) AS UnidadFicha,
       CAST(SUM(l.Produccion) / NULLIF(SUM(l.Minutos) / 60.0, 0) AS DECIMAL(12, 1)) AS RealPorHora,
       CAST(e.VelocidadValor * ISNULL(NULLIF(e.Cabezales, 0), 1) AS DECIMAL(12, 1)) AS FichaPorHora,
       CAST(100.0 * SUM(l.Produccion) / NULLIF(SUM(l.Minutos) / 60.0, 0)
            / NULLIF(e.VelocidadValor * ISNULL(NULLIF(e.Cabezales, 0), 1), 0) AS DECIMAL(7, 1)) AS PorcentajeDeLaFicha
FROM lotes l
JOIN dbo.ConfigEquipos e ON e.EquipoID = l.MaquinaID
GROUP BY e.AreaID, e.Nombre, e.VelocidadUnidad, e.VelocidadValor, e.Cabezales
ORDER BY Area, Maquina;


-- ============================================================================================
-- Revisión de las fichas (decisión 5, 08/10): ¿cuánto produce de verdad cada máquina por hora?
-- ============================================================================================

-- Q7. Velocidad real por LOTE, con la mediana: la mitad de los lotes va más rápido y la otra mitad
-- más lento, así no la deforman los tramos raros. Solo lotes limpios de los últimos 90 días: sin
-- tramos abiertos y con 5 min a 8 h en total en esa máquina. Dos medidas de producción:
--  - Magnitud de las órdenes (puntadas en Bordado, como Planificación);
--  - metros de los archivos (ArchivosOrden.Metros × Copias): los "metros reales de impresión" que usa
--    la cotización. En ECOUV la Magnitud puede venir contaminada con ojales y soldaduras.
-- P75 = la velocidad que supera solo una cuarta parte de los lotes: está más cerca de "a pleno".
WITH tramos AS (
    SELECT b.MaquinaID, TRY_CONVERT(INT, b.RolloID) AS RolloID, SUM(DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin)) AS Minutos
    FROM dbo.BitacoraProduccion b
    WHERE b.FechaFin IS NOT NULL AND b.FechaInicio >= DATEADD(DAY, -90, GETDATE())
      AND NOT EXISTS (SELECT 1 FROM dbo.BitacoraProduccion x WHERE x.RolloID = b.RolloID AND x.FechaFin IS NULL)
    GROUP BY b.MaquinaID, TRY_CONVERT(INT, b.RolloID)
    HAVING SUM(DATEDIFF(MINUTE, b.FechaInicio, b.FechaFin)) BETWEEN 5 AND 8 * 60
), lotes AS (
    SELECT t.MaquinaID, t.Minutos,
           (SELECT SUM(ISNULL(o.MagnitudCapacidad, TRY_CAST(o.Magnitud AS DECIMAL(18, 2))))
            FROM dbo.Ordenes o
            WHERE o.RolloID = t.RolloID AND o.Estado NOT IN ('Cancelado', 'CANCELADO')) AS Magnitud,
           (SELECT SUM(ISNULL(a.Metros, 0) * ISNULL(a.Copias, 1))
            FROM dbo.Ordenes o JOIN dbo.ArchivosOrden a ON a.OrdenID = o.OrdenID
            WHERE o.RolloID = t.RolloID AND o.Estado NOT IN ('Cancelado', 'CANCELADO')
              AND ISNULL(a.EstadoArchivo, '') <> 'CANCELADO') AS MetrosArchivos
    FROM tramos t
), vel AS (
    SELECT MaquinaID, Magnitud * 60.0 / Minutos AS VelMagnitud, ISNULL(MetrosArchivos, 0) * 60.0 / Minutos AS VelArchivos
    FROM lotes WHERE Magnitud > 0
)
SELECT DISTINCT LTRIM(RTRIM(e.AreaID)) AS Area, LTRIM(RTRIM(e.Nombre)) AS Maquina,
       COUNT(*) OVER (PARTITION BY v.MaquinaID) AS Lotes,
       CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.VelMagnitud) OVER (PARTITION BY v.MaquinaID) AS DECIMAL(10, 1)) AS MedianaMagnitudPorHora,
       CAST(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY v.VelMagnitud) OVER (PARTITION BY v.MaquinaID) AS DECIMAL(10, 1)) AS P75MagnitudPorHora,
       CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.VelArchivos) OVER (PARTITION BY v.MaquinaID) AS DECIMAL(10, 1)) AS MedianaArchivosPorHora,
       CAST(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY v.VelArchivos) OVER (PARTITION BY v.MaquinaID) AS DECIMAL(10, 1)) AS P75ArchivosPorHora,
       CAST(e.VelocidadValor * ISNULL(NULLIF(e.Cabezales, 0), 1) AS DECIMAL(10, 1)) AS FichaPorHora,
       CAST(e.VelocidadValorReal AS DECIMAL(10, 1)) AS FichaRealPorCabezal, RTRIM(e.VelocidadUnidad) AS Unidad
FROM vel v
JOIN dbo.ConfigEquipos e ON e.EquipoID = v.MaquinaID
ORDER BY Area, Maquina;


-- Q8. Órdenes de ECOUV de los últimos 60 días: ¿la Magnitud son los m² de impresión?
-- Compara la Magnitud con los metros de sus archivos. "SinMetrosEnArchivos": órdenes sin archivos con
-- metros (en esas la Magnitud puede ser la cantidad de servicios: ojales, soldaduras).
SELECT RTRIM(o.UM) AS UM, COUNT(*) AS Ordenes,
       SUM(CASE WHEN ISNULL(arch.Metros, 0) = 0 THEN 1 ELSE 0 END) AS SinMetrosEnArchivos,
       SUM(CASE WHEN arch.Metros > 0 AND ABS(TRY_CAST(o.Magnitud AS DECIMAL(18, 2)) - arch.Metros) <= 0.05 THEN 1 ELSE 0 END) AS MagnitudIgualAMetros,
       SUM(CASE WHEN arch.Metros > 0 AND TRY_CAST(o.Magnitud AS DECIMAL(18, 2)) > arch.Metros + 0.05 THEN 1 ELSE 0 END) AS MagnitudMayor,
       SUM(CASE WHEN arch.Metros > 0 AND TRY_CAST(o.Magnitud AS DECIMAL(18, 2)) < arch.Metros - 0.05 THEN 1 ELSE 0 END) AS MagnitudMenor,
       CAST(SUM(TRY_CAST(o.Magnitud AS DECIMAL(18, 2))) AS DECIMAL(12, 1)) AS TotalMagnitud,
       CAST(SUM(arch.Metros) AS DECIMAL(12, 1)) AS TotalMetrosArchivos
FROM dbo.Ordenes o
OUTER APPLY (SELECT SUM(ISNULL(a.Metros, 0) * ISNULL(a.Copias, 1)) AS Metros
             FROM dbo.ArchivosOrden a
             WHERE a.OrdenID = o.OrdenID AND ISNULL(a.EstadoArchivo, '') <> 'CANCELADO') arch
WHERE LTRIM(RTRIM(o.AreaID)) = 'ECOUV' AND o.FechaIngreso >= DATEADD(DAY, -60, GETDATE())
  AND o.Estado NOT IN ('Cancelado', 'CANCELADO')
GROUP BY RTRIM(o.UM)
ORDER BY Ordenes DESC;
