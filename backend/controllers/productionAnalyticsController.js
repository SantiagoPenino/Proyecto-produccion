const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const safe = async (fn, fallback, label) => {
    try { return await fn(); }
    catch (e) { logger.error(`[PROD-ANALYTICS] ${label}:`, e.message); return fallback; }
};

const TERMINAL = `'Entregado', 'Finalizado', 'Cancelado', 'Anulado', 'Rechazado', 'Pronto'`;

// Activas = todo lo que NO sea un estado terminal (finalizado, cancelado, pronto, etc.)
const ACTIVAS_WHERE = `o.Estado NOT IN ('Entregado', 'Finalizado', 'Cancelado', 'Anulado', 'Rechazado', 'Pronto')`;

// ── Turno WHERE ───────────────────────────────────────────────────────────────
const turnoWhere = (turno, col = 'o.FechaIngreso') => {
    if (String(turno) === '1') return `AND DATEPART(HOUR, ${col}) < 14`;
    if (String(turno) === '2') return `AND DATEPART(HOUR, ${col}) >= 14`;
    return '';
};

// ── Parsear magnitud guardada como NVARCHAR ───────────────────────────────────
const magnitudExpr = (col = 'o.Magnitud') =>
    `ISNULL(TRY_CAST(REPLACE(REPLACE(${col}, ',', '.'), ' ', '') AS FLOAT), 0)`;

// =============================================================================
// GET /api/dashboard/produccion/overview   (estado actual, sin filtros de fecha)
// =============================================================================
exports.getOverview = async (req, res) => {
    try {
        const pool = await getPool();

        // Filtro opcional por área (selector de la Sección 1)
        const area = req.query.area ? String(req.query.area).trim() : null;
        const aF   = area ? `AND o.AreaID = @area` : '';
        const mkR  = () => {
            const r = pool.request();
            if (area) r.input('area', sql.NVarChar(50), area);
            return r;
        };

        const [
            resKPIs,
            resPorArea,
            resPorEstadoArea,
            resPorPrioridad,
            resMetrosMaterial,
            resAntiguedad,
            resCanceladasHoy,
            resProntasHoy,
            resMetrosMaterialProntas,
            resPorMaquina,
            resUltimas,
            resProntasPorHora,
        ] = await Promise.all([

            // 1. KPIs globales de activas
            safe(() => mkR().query(`
                SELECT
                    COUNT(*) as totalActivas,
                    SUM(CASE WHEN UPPER(o.Prioridad) IN ('F','FALLA') OR UPPER(o.Estado) = 'CON FALLA'
                             THEN 1 ELSE 0 END)                                                     as conFalla,
                    SUM(CASE WHEN (UPPER(o.Prioridad) IN ('F','FALLA') OR UPPER(o.Estado)='CON FALLA')
                             THEN ${magnitudExpr()} ELSE 0 END)                                     as metrosFalla,
                    SUM(CASE WHEN UPPER(o.Prioridad) IN ('U','URGENTE')         THEN 1 ELSE 0 END) as urgentes,
                    SUM(CASE WHEN UPPER(o.Prioridad) IN ('U','URGENTE')
                             THEN ${magnitudExpr()} ELSE 0 END)                                     as metrosUrgentes,
                    SUM(CASE WHEN UPPER(o.Prioridad) IN ('R','REPOSICION','REPOSICIÓN')
                             OR UPPER(LEFT(LTRIM(RTRIM(ISNULL(o.CodigoOrden,''))), 1)) = 'R'
                             THEN 1 ELSE 0 END)                                                     as reposiciones,
                    SUM(CASE WHEN UPPER(o.Prioridad) IN ('R','REPOSICION','REPOSICIÓN')
                             OR UPPER(LEFT(LTRIM(RTRIM(ISNULL(o.CodigoOrden,''))), 1)) = 'R'
                             THEN ${magnitudExpr()} ELSE 0 END)                                     as metrosReposiciones,
                    SUM(${magnitudExpr()})                                                           as metrosTotales,
                    SUM(CASE WHEN CAST(o.FechaIngreso AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) as entraronHoy,
                    SUM(CASE WHEN CAST(o.FechaIngreso AS DATE) = CAST(GETDATE() AS DATE)
                             THEN ${magnitudExpr()} ELSE 0 END)                                     as metrosHoy,
                    SUM(CASE WHEN CAST(o.FechaIngreso AS DATE) < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) as entraronAnteriores
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE ${ACTIVAS_WHERE} ${aF}
            `), { recordset: [{ totalActivas:0, conFalla:0, urgentes:0, reposiciones:0, metrosTotales:0, entraronHoy:0, entraronAnteriores:0 }] }, 'kpis'),

            // 2. Carga por área (activas)
            safe(() => mkR().query(`
                SELECT
                    o.AreaID                                             as area,
                    ISNULL(cme.NombreReferencia, o.AreaID)               as nombre,
                    COUNT(*)                                              as total,
                    SUM(CASE WHEN UPPER(o.Prioridad) IN ('F','FALLA') OR UPPER(o.Estado) = 'CON FALLA'
                             THEN 1 ELSE 0 END)                          as fallas,
                    SUM(CASE WHEN UPPER(o.Prioridad) IN ('U','URGENTE') THEN 1 ELSE 0 END) as urgentes,
                    SUM(${magnitudExpr()})                                as metros
                FROM dbo.Ordenes o WITH(NOLOCK)
                LEFT JOIN dbo.ConfigMapeoERP cme WITH(NOLOCK) ON cme.AreaID_Interno = o.AreaID
                WHERE ${ACTIVAS_WHERE} ${aF}
                GROUP BY o.AreaID, cme.NombreReferencia
                ORDER BY total DESC
            `), { recordset: [] }, 'porArea'),

            // 3. Donut por EstadoenArea — con cantidad Y metros por cada estado de área
            safe(() => mkR().query(`
                SELECT
                    ISNULL(LTRIM(RTRIM(o.EstadoenArea)), 'Sin estado en área') as estadoArea,
                    COUNT(*)               as total,
                    SUM(${magnitudExpr()}) as metros
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE ${ACTIVAS_WHERE} ${aF}
                GROUP BY o.EstadoenArea
                ORDER BY total DESC
            `), { recordset: [] }, 'porEstadoArea'),

            // 4. Por prioridad (activas)
            safe(() => mkR().query(`
                SELECT o.Prioridad as prioridad, COUNT(*) as total
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE ${ACTIVAS_WHERE} ${aF}
                GROUP BY o.Prioridad
                ORDER BY total DESC
            `), { recordset: [] }, 'porPrioridad'),

            // 5. Metros por material de las activas
            safe(() => mkR().query(`
                SELECT TOP 10
                    o.Material                as material,
                    COUNT(*)                   as totalOrdenes,
                    SUM(${magnitudExpr()})     as totalMetros
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE ${ACTIVAS_WHERE} ${aF}
                  AND o.Material IS NOT NULL AND LTRIM(RTRIM(o.Material)) != ''
                GROUP BY o.Material
                ORDER BY totalMetros DESC
            `), { recordset: [] }, 'metrosMaterial'),

            // 6. Antigüedad en horas de las activas (hoy vs días anteriores)
            safe(() => mkR().query(`
                SELECT
                    CASE
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) <  4  THEN 'Menos de 4 h'
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) <  8  THEN '4 — 8 h'
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) < 24  THEN '8 — 24 h'
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) < 48  THEN '24 — 48 h'
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) < 72  THEN '48 — 72 h'
                        ELSE 'Más de 72 h'
                    END as bucket,
                    CASE
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) <  4  THEN 1
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) <  8  THEN 2
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) < 24  THEN 3
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) < 48  THEN 4
                        WHEN DATEDIFF(HOUR, o.FechaIngreso, GETDATE()) < 72  THEN 5
                        ELSE 6
                    END as ord,
                    COUNT(*)               as total,
                    SUM(${magnitudExpr()}) as metros
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE ${ACTIVAS_WHERE} ${aF}
                GROUP BY
                    CASE WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<4  THEN 'Menos de 4 h'
                         WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<8  THEN '4 — 8 h'
                         WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<24 THEN '8 — 24 h'
                         WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<48 THEN '24 — 48 h'
                         WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<72 THEN '48 — 72 h'
                         ELSE 'Más de 72 h' END,
                    CASE WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<4  THEN 1
                         WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<8  THEN 2
                         WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<24 THEN 3
                         WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<48 THEN 4
                         WHEN DATEDIFF(HOUR,o.FechaIngreso,GETDATE())<72 THEN 5
                         ELSE 6 END
                ORDER BY ord
            `), { recordset: [] }, 'antiguedad'),

            // 7. Canceladas hoy — HistorialOrdenes.Estado = 'Cancelado', fecha = hoy
            safe(() => mkR().query(`
                SELECT
                    COUNT(DISTINCT h.OrdenID) as canceladasHoy,
                    SUM(${magnitudExpr()})     as metrosCancelados
                FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = h.OrdenID
                WHERE UPPER(LTRIM(RTRIM(h.Estado))) IN ('CANCELADO','CANCELADA','ANULADO','ANULADA')
                  AND CAST(h.FechaInicio AS DATE) = CAST(GETDATE() AS DATE)
                  ${aF}
            `), { recordset: [{ canceladasHoy: 0, metrosCancelados: 0 }] }, 'canceladas'),

            // 8. Prontas del día — HistorialOrdenes.Estado = 'Pronto', fecha = hoy
            safe(() => mkR().query(`
                SELECT COUNT(DISTINCT h.OrdenID) as prontasHoy,
                       SUM(${magnitudExpr()})     as metrosProntas
                FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = h.OrdenID
                WHERE UPPER(LTRIM(RTRIM(h.Estado))) = 'PRONTO'
                  AND CAST(h.FechaInicio AS DATE) = CAST(GETDATE() AS DATE)
                  ${aF}
            `), { recordset: [{ prontasHoy: 0, metrosProntas: 0 }] }, 'prontasKpi'),

            // 9. Metros por material de prontas del día
            safe(() => mkR().query(`
                SELECT TOP 10
                    o.Material                as material,
                    COUNT(DISTINCT h.OrdenID) as totalOrdenes,
                    SUM(${magnitudExpr()})     as totalMetros
                FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = h.OrdenID
                WHERE UPPER(LTRIM(RTRIM(h.Estado))) = 'PRONTO'
                  AND CAST(h.FechaInicio AS DATE) = CAST(GETDATE() AS DATE)
                  AND o.Material IS NOT NULL AND LTRIM(RTRIM(o.Material)) != ''
                  ${aF}
                GROUP BY o.Material
                ORDER BY totalMetros DESC
            `), { recordset: [] }, 'metrosMaterialProntas'),

            // 10. Por máquina — prontas del día, via Ordenes.MaquinaID → ConfigEquipos
            safe(() => mkR().query(`
                SELECT TOP 10
                    ISNULL(ce.Nombre, 'Sin máquina asignada') as maquina,
                    COUNT(DISTINCT h.OrdenID)                 as totalOrdenes,
                    SUM(${magnitudExpr()})                    as totalMetros
                FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                JOIN  dbo.Ordenes o WITH(NOLOCK)       ON o.OrdenID  = h.OrdenID
                LEFT JOIN dbo.ConfigEquipos ce WITH(NOLOCK) ON ce.EquipoID = o.MaquinaID
                WHERE UPPER(LTRIM(RTRIM(h.Estado))) = 'PRONTO'
                  AND CAST(h.FechaInicio AS DATE) = CAST(GETDATE() AS DATE)
                  ${aF}
                GROUP BY ce.Nombre
                ORDER BY totalOrdenes DESC
            `), { recordset: [] }, 'porMaquina'),

            // 11. Prontas por hora del día — para gráfico de línea acumulado
            safe(() => mkR().query(`
                SELECT
                    DATEPART(HOUR, h.FechaInicio) as hora,
                    COUNT(DISTINCT h.OrdenID)     as total
                FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = h.OrdenID
                WHERE UPPER(LTRIM(RTRIM(h.Estado))) = 'PRONTO'
                  AND CAST(h.FechaInicio AS DATE) = CAST(GETDATE() AS DATE)
                  ${aF}
                GROUP BY DATEPART(HOUR, h.FechaInicio)
                ORDER BY hora
            `), { recordset: [] }, 'prontasPorHora'),

            // 12. Últimas 10 órdenes activas ingresadas
            safe(() => mkR().query(`
                SELECT TOP 10
                    o.OrdenID, o.CodigoOrden, o.Cliente, o.AreaID,
                    o.Estado, o.EstadoenArea, o.Prioridad, o.Material,
                    DATEDIFF(MINUTE, o.FechaIngreso, GETDATE()) as minutosDesdeIngreso,
                    CONVERT(VARCHAR(16), o.FechaIngreso, 120)   as fechaIngreso
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE ${ACTIVAS_WHERE} ${aF}
                ORDER BY o.FechaIngreso DESC
            `), { recordset: [] }, 'ultimas'),
        ]);

        const kpi = resKPIs.recordset[0]         || {};
        const can = resCanceladasHoy.recordset[0] || {};
        const pro = resProntasHoy.recordset[0]    || {};

        res.json({
            kpis: {
                totalActivas:       kpi.totalActivas       ?? 0,
                conFalla:           kpi.conFalla            ?? 0,
                metrosFalla:        Math.round((kpi.metrosFalla        ?? 0) * 10) / 10,
                urgentes:           kpi.urgentes            ?? 0,
                metrosUrgentes:     Math.round((kpi.metrosUrgentes     ?? 0) * 10) / 10,
                reposiciones:       kpi.reposiciones        ?? 0,
                metrosReposiciones: Math.round((kpi.metrosReposiciones ?? 0) * 10) / 10,
                metrosTotales:      Math.round((kpi.metrosTotales      ?? 0) * 10) / 10,
                entraronHoy:        kpi.entraronHoy         ?? 0,
                metrosHoy:          Math.round((kpi.metrosHoy          ?? 0) * 10) / 10,
                entraronAnteriores: kpi.entraronAnteriores  ?? 0,
                canceladasHoy:      can.canceladasHoy       ?? 0,
                metrosCancelados:   Math.round((can.metrosCancelados   ?? 0) * 10) / 10,
                prontasHoy:         pro.prontasHoy          ?? 0,
                metrosProntas:      Math.round((pro.metrosProntas      ?? 0) * 10) / 10,
            },
            porArea:                 resPorArea.recordset,
            porEstadoArea:           resPorEstadoArea.recordset,
            porPrioridad:            resPorPrioridad.recordset,
            metrosPorMaterial:       resMetrosMaterial.recordset,
            antiguedad:              resAntiguedad.recordset,
            metrosMaterialProntas:   resMetrosMaterialProntas.recordset,
            porMaquina:              resPorMaquina.recordset,
            ultimas:                 resUltimas.recordset,
            prontasPorHora:          resProntasPorHora.recordset,
        });

    } catch (err) {
        logger.error('[PROD-ANALYTICS] overview error:', err);
        res.status(500).json({ error: err.message });
    }
};

// =============================================================================
// GET /api/dashboard/produccion/analytics   (análisis filtrado)
// =============================================================================
exports.getAnalytics = async (req, res) => {
    try {
        const pool = await getPool();
        const { area, fechaDesde, fechaHasta, material, idCliente, turno } = req.query;

        const desde = fechaDesde
            ? new Date(fechaDesde + 'T00:00:00')
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const hasta = fechaHasta
            ? new Date(fechaHasta + 'T23:59:59')
            : new Date();

        // Filtros dinámicos para Ordenes
        const areaF      = area       ? `AND o.AreaID = @area`            : '';
        const materialF  = material
            ? `AND EXISTS (
                SELECT 1 FROM dbo.Articulos a2 WITH(NOLOCK)
                WHERE a2.ProIdProducto = o.ProIdProducto
                  AND LTRIM(RTRIM(a2.Descripcion)) = @material
              )` : '';
        const clienteF   = idCliente  ? `AND (o.Cliente LIKE @cliQ OR o.CodCliente LIKE @cliQ)` : '';
        const turnoFo    = turnoWhere(turno, 'o.FechaIngreso');
        const turnoFh    = turnoWhere(turno, 'h.FechaInicio');

        // Helper: nuevo request con parámetros base
        const base = () => {
            const r = pool.request()
                .input('desde', sql.DateTime, desde)
                .input('hasta', sql.DateTime, hasta);
            if (area)      r.input('area',     sql.VarChar(20),    area);
            if (material)  r.input('material', sql.NVarChar(100),  material);
            if (idCliente) r.input('cliQ',     sql.NVarChar(100),  `%${idCliente}%`);
            return r;
        };

        const [
            resInsertadas,
            resCompletadas,
            resPorEstado,
            resTopOps,
            resTrendIns,
            resTrendComp,
            resTurno,
            resHora,
            resTopMat,
            resTopCli,
            resFallaRep,
            resDemora,
        ] = await Promise.all([

            // 1. KPIs insertadas + metros
            safe(() => base().query(`
                SELECT
                    COUNT(*)                  as insertadas,
                    SUM(${magnitudExpr()})    as metros
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.FechaIngreso >= @desde AND o.FechaIngreso <= @hasta
                ${areaF} ${materialF} ${clienteF} ${turnoFo}
            `), { recordset: [{ insertadas: 0, metros: 0 }] }, 'insertadas'),

            // 2. KPIs completadas (via HistorialOrdenes)
            safe(() => {
                const r = base();
                return r.query(`
                    SELECT COUNT(DISTINCT h.OrdenID) as completadas
                    FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                    JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = h.OrdenID
                    WHERE h.FechaInicio >= @desde AND h.FechaInicio <= @hasta
                      AND UPPER(h.Estado) IN ('FINALIZADO','ENTREGADO','PRONTO','TERMINADO','LISTO PARA RETIRO','LISTO')
                    ${areaF} ${materialF} ${clienteF} ${turnoFh}
                `);
            }, { recordset: [{ completadas: 0 }] }, 'completadas'),

            // 3. Distribución por estado en periodo
            safe(() => base().query(`
                SELECT o.Estado as estado, COUNT(*) as total
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.FechaIngreso >= @desde AND o.FechaIngreso <= @hasta
                ${areaF} ${materialF} ${clienteF} ${turnoFo}
                GROUP BY o.Estado
                ORDER BY total DESC
            `), { recordset: [] }, 'porEstado'),

            // 4. Top operadores — desglose por Preparación / Impresión / Controlado
            safe(() => {
                const r = base();
                return r.query(`
                    SELECT TOP 15
                        COALESCE(u.Nombre, sub.Usuario)  AS Usuario,
                        SUM(sub.preparacion)             AS preparacion,
                        SUM(sub.impresion)               AS impresion,
                        SUM(sub.controlado)              AS controlado,
                        COUNT(DISTINCT sub.OrdenID)      AS totalOrdenes,
                        SUM(sub.Metros)                  AS totalMetros
                    FROM (
                        SELECT
                            h.Usuario,
                            h.OrdenID,
                            ${magnitudExpr()} AS Metros,
                            CASE WHEN LTRIM(RTRIM(h.Estado)) = 'PREPARACION'      THEN 1 ELSE 0 END AS preparacion,
                            CASE WHEN LTRIM(RTRIM(h.Estado)) = 'Control y Calidad' THEN 1 ELSE 0 END AS impresion,
                            CASE WHEN LTRIM(RTRIM(h.Estado)) = 'Pronto'            THEN 1 ELSE 0 END AS controlado
                        FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                        JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = h.OrdenID
                        WHERE h.FechaInicio >= @desde AND h.FechaInicio <= @hasta
                          AND LTRIM(RTRIM(h.Estado)) IN ('PREPARACION','Control y Calidad','Pronto')
                          AND h.Usuario IS NOT NULL
                          AND LTRIM(RTRIM(h.Usuario)) != ''
                          AND LTRIM(RTRIM(h.Usuario)) NOT LIKE '%[0-9]%'
                          AND LTRIM(RTRIM(h.Usuario)) NOT IN ('Sistema','-')
                        ${areaF} ${materialF} ${turnoFh}
                    ) sub
                    LEFT JOIN dbo.Usuarios u
                        ON TRY_CAST(sub.Usuario AS INT) = u.IdUsuario
                    GROUP BY COALESCE(u.Nombre, sub.Usuario)
                    HAVING COUNT(DISTINCT sub.OrdenID) > 0
                    ORDER BY totalOrdenes DESC
                `);
            }, { recordset: [] }, 'topOps'),

            // 5. Tendencia diaria - insertadas
            safe(() => base().query(`
                SELECT CAST(o.FechaIngreso AS DATE) as fecha, COUNT(*) as insertadas
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.FechaIngreso >= @desde AND o.FechaIngreso <= @hasta
                ${areaF} ${materialF} ${clienteF} ${turnoFo}
                GROUP BY CAST(o.FechaIngreso AS DATE)
                ORDER BY fecha
            `), { recordset: [] }, 'trendIns'),

            // 6. Tendencia diaria - completadas
            safe(() => {
                const r = base();
                return r.query(`
                    SELECT CAST(h.FechaInicio AS DATE) as fecha, COUNT(DISTINCT h.OrdenID) as completadas
                    FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                    JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = h.OrdenID
                    WHERE h.FechaInicio >= @desde AND h.FechaInicio <= @hasta
                      AND UPPER(h.Estado) IN ('FINALIZADO','ENTREGADO','PRONTO','TERMINADO','LISTO PARA RETIRO','LISTO')
                    ${areaF} ${materialF} ${clienteF} ${turnoFh}
                    GROUP BY CAST(h.FechaInicio AS DATE)
                    ORDER BY fecha
                `);
            }, { recordset: [] }, 'trendComp'),

            // 7. Distribución por turno
            safe(() => base().query(`
                SELECT
                    CASE WHEN DATEPART(HOUR, o.FechaIngreso) < 14
                         THEN 'Turno 1  00-14 h' ELSE 'Turno 2  14-24 h' END as turno,
                    CASE WHEN DATEPART(HOUR, o.FechaIngreso) < 14 THEN 1 ELSE 2 END as turnoNum,
                    COUNT(*)               as totalOrdenes,
                    SUM(${magnitudExpr()}) as totalMetros
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.FechaIngreso >= @desde AND o.FechaIngreso <= @hasta
                ${areaF} ${materialF} ${clienteF}
                GROUP BY
                    CASE WHEN DATEPART(HOUR, o.FechaIngreso) < 14 THEN 'Turno 1  00-14 h' ELSE 'Turno 2  14-24 h' END,
                    CASE WHEN DATEPART(HOUR, o.FechaIngreso) < 14 THEN 1 ELSE 2 END
                ORDER BY turnoNum
            `), { recordset: [] }, 'turno'),

            // 8. Distribución por hora (heatmap)
            safe(() => base().query(`
                SELECT DATEPART(HOUR, o.FechaIngreso) as hora, COUNT(*) as total
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.FechaIngreso >= @desde AND o.FechaIngreso <= @hasta
                ${areaF} ${materialF} ${clienteF}
                GROUP BY DATEPART(HOUR, o.FechaIngreso)
                ORDER BY hora
            `), { recordset: [] }, 'hora'),

            // 9. Top materiales — agrupado por ProIdProducto para unificar variantes del mismo artículo
            safe(() => base().query(`
                SELECT TOP 10
                    LTRIM(RTRIM(ISNULL(a.Descripcion, o.Material))) as material,
                    COUNT(*)               as totalOrdenes,
                    SUM(${magnitudExpr()}) as totalMetros
                FROM dbo.Ordenes o WITH(NOLOCK)
                LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = o.ProIdProducto
                WHERE o.FechaIngreso >= @desde AND o.FechaIngreso <= @hasta
                  AND o.Material IS NOT NULL AND LTRIM(RTRIM(o.Material)) != ''
                ${areaF} ${clienteF} ${turnoFo}
                GROUP BY LTRIM(RTRIM(ISNULL(a.Descripcion, o.Material)))
                ORDER BY totalOrdenes DESC
            `), { recordset: [] }, 'topMat'),

            // 10. Top clientes
            safe(() => {
                const r = base();
                return r.query(`
                    SELECT TOP 10
                        o.Cliente              as cliente,
                        COUNT(*)               as totalOrdenes,
                        SUM(${magnitudExpr()}) as totalMetros
                    FROM dbo.Ordenes o WITH(NOLOCK)
                    WHERE o.FechaIngreso >= @desde AND o.FechaIngreso <= @hasta
                      AND o.Cliente IS NOT NULL AND o.Cliente != ''
                    ${areaF} ${materialF} ${turnoFo}
                    GROUP BY o.Cliente
                    ORDER BY totalOrdenes DESC
                `);
            }, { recordset: [] }, 'topCli'),

            // 11. Metros de Falla + Reposición en el período
            safe(() => base().query(`
                SELECT
                    COUNT(*)               AS ordenes,
                    SUM(${magnitudExpr()}) AS metros
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.FechaIngreso >= @desde AND o.FechaIngreso <= @hasta
                  AND LTRIM(RTRIM(o.Prioridad)) IN (N'Falla', N'Reposición', N'F', N'R', N'FALLA', N'REPOSICION')
                ${areaF} ${materialF} ${clienteF} ${turnoFo}
            `), { recordset: [{ ordenes: 0, metros: 0 }] }, 'fallaRep'),

            // 12. Demora promedio por prioridad (FechaIngreso → primer Pronto/Finalizado)
            safe(() => base().query(`
                SELECT
                    prio                        AS prioridad,
                    COUNT(*)                    AS totalOrdenes,
                    AVG(minutos)  / 60.0        AS promedioHoras,
                    MAX(mediana)  / 60.0        AS medianaHoras,
                    MIN(minutos)  / 60.0        AS minHoras,
                    MAX(minutos)  / 60.0        AS maxHoras
                FROM (
                    SELECT prio, minutos,
                        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutos)
                            OVER (PARTITION BY prio) AS mediana
                    FROM (
                        SELECT
                            CASE
                                WHEN LTRIM(RTRIM(o.Prioridad)) IN (N'Falla',  N'F', N'FALLA')                           THEN 'Falla'
                                WHEN LTRIM(RTRIM(o.Prioridad)) IN (N'Urgente', N'U', N'URGENTE')                        THEN 'Urgente'
                                WHEN LTRIM(RTRIM(o.Prioridad)) IN (N'Reposición', N'Reposicion', N'R', N'REPOSICION')   THEN 'Reposición'
                                ELSE 'Normal'
                            END AS prio,
                            IIF(
                                DATEDIFF(MINUTE, o.FechaIngreso, h_fin.FechaFin)
                                    - DATEDIFF(DAY, CAST(o.FechaIngreso AS DATE), CAST(h_fin.FechaFin AS DATE)) * 720 > 0,
                                DATEDIFF(MINUTE, o.FechaIngreso, h_fin.FechaFin)
                                    - DATEDIFF(DAY, CAST(o.FechaIngreso AS DATE), CAST(h_fin.FechaFin AS DATE)) * 720,
                                1
                            ) AS minutos
                        FROM dbo.Ordenes o WITH(NOLOCK)
                        JOIN (
                            SELECT OrdenID, MIN(FechaInicio) AS FechaFin
                            FROM dbo.HistorialOrdenes WITH(NOLOCK)
                            WHERE LTRIM(RTRIM(UPPER(Estado))) IN ('PRONTO','FINALIZADO')
                            GROUP BY OrdenID
                        ) h_fin ON h_fin.OrdenID = o.OrdenID
                        WHERE h_fin.FechaFin >= @desde AND h_fin.FechaFin <= @hasta
                          AND DATEDIFF(MINUTE, o.FechaIngreso, h_fin.FechaFin) > 0
                        ${areaF} ${materialF} ${turnoFo}
                    ) inner_sub
                ) sub
                GROUP BY prio
                ORDER BY promedioHoras ASC
            `), { recordset: [] }, 'demora'),
        ]);

        // Merge tendencia
        const tMap = {};
        for (const r of resTrendIns.recordset) {
            const k = r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : String(r.fecha).slice(0, 10);
            tMap[k] = { fecha: k, insertadas: r.insertadas, completadas: 0 };
        }
        for (const r of resTrendComp.recordset) {
            const k = r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : String(r.fecha).slice(0, 10);
            if (tMap[k]) tMap[k].completadas = r.completadas;
            else tMap[k] = { fecha: k, insertadas: 0, completadas: r.completadas };
        }
        const tendencia = Object.values(tMap).sort((a, b) => a.fecha.localeCompare(b.fecha));

        const ins  = resInsertadas.recordset[0] || {};
        const comp = resCompletadas.recordset[0] || {};
        const insertadas  = ins.insertadas  ?? 0;
        const completadas = comp.completadas ?? 0;

        res.json({
            kpis: {
                insertadas,
                completadas,
                metros:     Math.round((ins.metros ?? 0) * 10) / 10,
                eficiencia: insertadas > 0 ? Math.round((completadas / insertadas) * 100) : 0,
            },
            porEstado:       resPorEstado.recordset,
            topOperadores:   resTopOps.recordset,
            tendencia,
            distribucionTurno: resTurno.recordset,
            distribucionHora:  resHora.recordset,
            topMateriales:      resTopMat.recordset,
            topClientes:        resTopCli.recordset,
            demoraPorPrioridad: resDemora.recordset,
            fallaReposicion: {
                ordenes: resFallaRep.recordset[0]?.ordenes ?? 0,
                metros:  Math.round((resFallaRep.recordset[0]?.metros ?? 0) * 10) / 10,
            },
        });

    } catch (err) {
        logger.error('[PROD-ANALYTICS] analytics error:', err);
        res.status(500).json({ error: err.message });
    }
};

// =============================================================================
// GET /api/dashboard/produccion/filtros   (opciones para los selectores)
// =============================================================================
exports.getFiltros = async (req, res) => {
    try {
        const pool = await getPool();

        const [resAreas, resMateriales, resClientes] = await Promise.all([

            safe(() => pool.request().query(`
                SELECT DISTINCT
                    o.AreaID                                       as area,
                    ISNULL(cme.NombreReferencia, o.AreaID)         as nombre
                FROM dbo.Ordenes o WITH(NOLOCK)
                LEFT JOIN dbo.ConfigMapeoERP cme WITH(NOLOCK) ON cme.AreaID_Interno = o.AreaID
                WHERE o.FechaIngreso > DATEADD(DAY, -90, GETDATE())
                  AND o.AreaID IS NOT NULL AND o.AreaID != ''
                ORDER BY o.AreaID
            `), { recordset: [] }, 'areas'),

            safe(() => pool.request().query(`
                SELECT TOP 40
                    LTRIM(RTRIM(ISNULL(a.Descripcion, o.Material))) as material,
                    COUNT(*) as total
                FROM dbo.Ordenes o WITH(NOLOCK)
                LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = o.ProIdProducto
                WHERE o.FechaIngreso > DATEADD(DAY, -90, GETDATE())
                  AND o.Material IS NOT NULL AND LTRIM(RTRIM(o.Material)) != ''
                GROUP BY LTRIM(RTRIM(ISNULL(a.Descripcion, o.Material)))
                ORDER BY total DESC
            `), { recordset: [] }, 'materiales'),

            safe(() => pool.request().query(`
                SELECT TOP 60
                    o.Cliente     as nombre,
                    o.CodCliente  as codCliente,
                    COUNT(*)      as total
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.FechaIngreso > DATEADD(DAY, -90, GETDATE())
                  AND o.Cliente IS NOT NULL AND o.Cliente != ''
                GROUP BY o.Cliente, o.CodCliente
                ORDER BY total DESC
            `), { recordset: [] }, 'clientes'),
        ]);

        res.json({
            areas:      resAreas.recordset,
            materiales: resMateriales.recordset,
            clientes:   resClientes.recordset,
        });

    } catch (err) {
        logger.error('[PROD-ANALYTICS] filtros error:', err);
        res.status(500).json({ error: err.message });
    }
};
