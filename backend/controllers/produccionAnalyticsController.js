const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const mag = (col = 'o.Magnitud') =>
    `ISNULL(TRY_CAST(REPLACE(REPLACE(${col}, ',', '.'), ' ', '') AS FLOAT), 0)`;

const parseParams = (q) => ({
    area:          q.area,
    fechaDesde:    q.fechaDesde,
    fechaHasta:    q.fechaHasta,
    material:      q.material,
    clienteNombre: q.clienteSearch || q.clienteNombre || null,
});

const bindAll = (r, { area, fechaDesde, fechaHasta, material, clienteNombre }) => {
    if (area && area !== 'Todas') r.input('area',          sql.NVarChar(50),  area);
    if (fechaDesde)               r.input('fechaDesde',    sql.DateTime,      new Date(fechaDesde));
    if (fechaHasta) {
        const d = new Date(fechaHasta);
        d.setHours(23, 59, 59, 999);
        r.input('fechaHasta', sql.DateTime, d);
    }
    if (material)      r.input('material',      sql.NVarChar(100), material);
    if (clienteNombre) r.input('clienteNombre', sql.NVarChar(150), `%${clienteNombre}%`);
};

const buildWhere = ({ area, fechaDesde, fechaHasta, material, clienteNombre }, dateCol = 'o.FechaIngreso', extra = []) => {
    const c = [...extra];
    if (area && area !== 'Todas') c.push('o.AreaID = @area');
    if (fechaDesde) c.push(`${dateCol} >= @fechaDesde`);
    if (fechaHasta) c.push(`${dateCol} <= @fechaHasta`);
    if (material)   c.push('o.Material = @material');
    if (clienteNombre) c.push('o.Cliente LIKE @clienteNombre');
    return c.length ? `WHERE ${c.join(' AND ')}` : 'WHERE 1=1';
};

// ─── GET /api/produccion-analytics/filtros ────────────────────────────────────
exports.getFiltros = async (req, res) => {
    try {
        const pool = await getPool();
        const [areas, mats, clientes] = await Promise.all([
            pool.request().query(`
                SELECT DISTINCT AreaID AS id, AreaID AS nombre
                FROM dbo.Ordenes WITH(NOLOCK)
                WHERE AreaID IS NOT NULL AND AreaID != ''
                ORDER BY AreaID
            `),
            pool.request().query(`
                SELECT DISTINCT Material AS id, Material AS nombre
                FROM dbo.Ordenes WITH(NOLOCK)
                WHERE Material IS NOT NULL AND Material != ''
                ORDER BY Material
            `),
            pool.request().query(`
                SELECT TOP 100 o.Cliente AS id, o.Cliente AS nombre
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.Cliente IS NOT NULL AND LTRIM(RTRIM(o.Cliente)) != ''
                GROUP BY o.Cliente
                ORDER BY COUNT(*) DESC
            `),
        ]);
        res.json({ areas: areas.recordset, materiales: mats.recordset, clientes: clientes.recordset });
    } catch (e) {
        logger.error('[PRODUCCION-ANALYTICS] getFiltros:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/produccion-analytics/dashboard ──────────────────────────────────
exports.getDashboard = async (req, res) => {
    try {
        const pool   = await getPool();
        const params = parseParams(req.query);
        const where  = buildWhere(params);
        const fallaWhere  = buildWhere(params, 'o.FechaIngreso', [`UPPER(LTRIM(RTRIM(o.Prioridad))) IN ('F','FALLA')`]);
        const cancelWhere = buildWhere(params, 'o.FechaIngreso', [`o.Estado IN ('Cancelado','Anulado','Rechazado')`]);

        const mkR = () => { const r = pool.request(); bindAll(r, params); return r; };

        const [kpiRes, fallaRes, cancelRes, clientesRes, materialRes, tendenciaRes] = await Promise.all([
            mkR().query(`
                SELECT
                    COUNT(*) AS totalOrdenes,
                    CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS totalMetros,
                    SUM(CASE WHEN o.Estado IN ('Entregado','Finalizado','Pronto') THEN 1 ELSE 0 END) AS completadas,
                    SUM(CASE WHEN o.Estado NOT IN ('Entregado','Finalizado','Cancelado','Anulado','Rechazado','Pronto') THEN 1 ELSE 0 END) AS activas
                FROM dbo.Ordenes o WITH(NOLOCK) ${where}
            `),
            mkR().query(`
                SELECT
                    COUNT(*) AS totalFallas,
                    CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS metrosFalla
                FROM dbo.Ordenes o WITH(NOLOCK) ${fallaWhere}
            `),
            mkR().query(`
                SELECT
                    COUNT(*) AS totalCancelaciones,
                    CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS metrosCancelaciones
                FROM dbo.Ordenes o WITH(NOLOCK) ${cancelWhere}
            `),
            mkR().query(`
                SELECT TOP 10
                    ISNULL(o.Cliente, 'Sin cliente') AS Cliente,
                    COUNT(*) AS Ordenes,
                    CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS TotalMetros,
                    SUM(CASE WHEN o.Estado IN ('Entregado','Finalizado','Pronto') THEN 1 ELSE 0 END) AS Completadas
                FROM dbo.Ordenes o WITH(NOLOCK) ${where}
                GROUP BY o.Cliente
                ORDER BY TotalMetros DESC
            `),
            mkR().query(`
                SELECT
                    ISNULL(o.Material, 'Sin material') AS Material,
                    COUNT(*) AS Ordenes,
                    CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS TotalMetros
                FROM dbo.Ordenes o WITH(NOLOCK) ${where}
                GROUP BY o.Material
                ORDER BY TotalMetros DESC
            `),
            mkR().query(`
                SELECT
                    CAST(o.FechaIngreso AS DATE) AS Dia,
                    COUNT(*) AS Ordenes,
                    CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS Metros
                FROM dbo.Ordenes o WITH(NOLOCK) ${where}
                GROUP BY CAST(o.FechaIngreso AS DATE)
                ORDER BY Dia ASC
            `),
        ]);

        const kpi       = kpiRes.recordset[0]   || {};
        const fallaKpi  = fallaRes.recordset[0]  || {};
        const cancelKpi = cancelRes.recordset[0] || {};

        res.json({
            kpis: {
                totalOrdenes:        Number(kpi.totalOrdenes        || 0),
                totalMetros:         Number(kpi.totalMetros         || 0),
                completadas:         Number(kpi.completadas         || 0),
                activas:             Number(kpi.activas             || 0),
                totalFallas:         Number(fallaKpi.totalFallas         || 0),
                metrosFalla:         Number(fallaKpi.metrosFalla         || 0),
                totalCancelaciones:  Number(cancelKpi.totalCancelaciones  || 0),
                metrosCancelaciones: Number(cancelKpi.metrosCancelaciones || 0),
                tasaFalla: Number(kpi.totalOrdenes) > 0
                    ? ((Number(fallaKpi.totalFallas || 0) / Number(kpi.totalOrdenes)) * 100).toFixed(1)
                    : '0.0',
            },
            topClientes: clientesRes.recordset,
            porMaterial:  materialRes.recordset,
            tendencia:    tendenciaRes.recordset,
        });
    } catch (e) {
        logger.error('[PRODUCCION-ANALYTICS] getDashboard:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/produccion-analytics/reporte/ordenes ───────────────────────────
exports.getReporteOrdenes = async (req, res) => {
    try {
        const pool   = await getPool();
        const params = parseParams(req.query);
        const extra  = params.material ? ['o.Material = @material'] : [];
        const where  = buildWhere(params, 'o.FechaIngreso', extra);

        const rData = pool.request(); bindAll(rData, params);
        const rTot  = pool.request(); bindAll(rTot,  params);

        const [data, totales] = await Promise.all([
            rData.query(`
                SELECT o.CodigoOrden,
                    FORMAT(o.FechaIngreso,'dd/MM/yyyy HH:mm') AS FechaIngreso,
                    o.Estado, ISNULL(o.AreaID,'') AS Area,
                    ISNULL(o.Material,'') AS Material, ISNULL(o.Prioridad,'') AS Prioridad,
                    CAST(ROUND(${mag()},2) AS DECIMAL(10,2)) AS Metros,
                    ISNULL(o.Cliente,'') AS Cliente, ISNULL(o.Observaciones,'') AS Observaciones
                FROM dbo.Ordenes o WITH(NOLOCK) ${where}
                ORDER BY o.FechaIngreso DESC
                OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY
            `),
            rTot.query(`
                SELECT COUNT(*) AS total,
                    CAST(ROUND(SUM(${mag()}),2) AS DECIMAL(10,2)) AS totalMetros,
                    SUM(CASE WHEN o.Estado NOT IN ('Entregado','Finalizado','Cancelado','Anulado','Rechazado','Pronto') THEN 1 ELSE 0 END) AS activas,
                    SUM(CASE WHEN o.Estado IN ('Entregado','Finalizado','Pronto') THEN 1 ELSE 0 END) AS completadas
                FROM dbo.Ordenes o WITH(NOLOCK) ${where}
            `),
        ]);

        res.json({ data: data.recordset, totales: totales.recordset[0] || {} });
    } catch (e) {
        logger.error('[PRODUCCION-ANALYTICS] getReporteOrdenes:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/produccion-analytics/reporte/metros-material ───────────────────
exports.getReporteMetrosMaterial = async (req, res) => {
    try {
        const pool   = await getPool();
        const params = parseParams(req.query);
        const extra  = params.material ? ['o.Material = @material'] : [];
        const where  = buildWhere(params, 'o.FechaIngreso', extra);
        const r = pool.request(); bindAll(r, params);

        const result = await r.query(`
            SELECT ISNULL(o.Material,'Sin Material') AS Material,
                COUNT(*) AS Ordenes,
                CAST(ROUND(SUM(${mag()}),2) AS DECIMAL(10,2)) AS TotalMetros,
                SUM(CASE WHEN o.Estado NOT IN ('Entregado','Finalizado','Cancelado','Anulado','Rechazado','Pronto') THEN 1 ELSE 0 END) AS Activas,
                SUM(CASE WHEN o.Estado IN ('Entregado','Finalizado','Pronto') THEN 1 ELSE 0 END) AS Completadas,
                CAST(ROUND(AVG(${mag()}),2) AS DECIMAL(10,2)) AS PromedioMetros
            FROM dbo.Ordenes o WITH(NOLOCK) ${where}
            GROUP BY o.Material ORDER BY TotalMetros DESC
        `);

        res.json({ data: result.recordset });
    } catch (e) {
        logger.error('[PRODUCCION-ANALYTICS] getReporteMetrosMaterial:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/produccion-analytics/reporte/clientes ──────────────────────────
exports.getReporteClientes = async (req, res) => {
    try {
        const pool   = await getPool();
        const params = parseParams(req.query);
        const where  = buildWhere(params);
        const r = pool.request(); bindAll(r, params);

        const result = await r.query(`
            SELECT ISNULL(o.Cliente,'Sin cliente') AS Cliente,
                COUNT(*) AS Ordenes,
                CAST(ROUND(SUM(${mag()}),2) AS DECIMAL(10,2)) AS TotalMetros,
                SUM(CASE WHEN o.Estado NOT IN ('Entregado','Finalizado','Cancelado','Anulado','Rechazado','Pronto') THEN 1 ELSE 0 END) AS Activas,
                SUM(CASE WHEN o.Estado IN ('Entregado','Finalizado','Pronto') THEN 1 ELSE 0 END) AS Completadas,
                FORMAT(MAX(o.FechaIngreso),'dd/MM/yyyy') AS UltimaOrden
            FROM dbo.Ordenes o WITH(NOLOCK) ${where}
            GROUP BY o.Cliente ORDER BY TotalMetros DESC
        `);

        res.json({ data: result.recordset });
    } catch (e) {
        logger.error('[PRODUCCION-ANALYTICS] getReporteClientes:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/produccion-analytics/reporte/fallas-reposiciones ───────────────
exports.getReporteFallasReposiciones = async (req, res) => {
    try {
        const pool   = await getPool();
        const params = parseParams(req.query);
        const { area, fechaDesde, fechaHasta, material, clienteNombre } = params;

        const mkR = () => {
            const r = pool.request();
            if (area && area !== 'Todas') r.input('area', sql.NVarChar(50), area);
            if (fechaDesde) r.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
            if (fechaHasta) { const d = new Date(fechaHasta); d.setHours(23,59,59,999); r.input('fechaHasta', sql.DateTime, d); }
            if (material)      r.input('material',      sql.NVarChar(100), material);
            if (clienteNombre) r.input('clienteNombre', sql.NVarChar(150), `%${clienteNombre}%`);
            return r;
        };

        const bW = (extraCond) => {
            const c = [extraCond];
            if (area && area !== 'Todas') c.push('o.AreaID = @area');
            if (fechaDesde) c.push('o.FechaIngreso >= @fechaDesde');
            if (fechaHasta) c.push('o.FechaIngreso <= @fechaHasta');
            if (material)   c.push('o.Material = @material');
            if (clienteNombre) c.push('o.Cliente LIKE @clienteNombre');
            return `WHERE ${c.join(' AND ')}`;
        };

        const COLS = `
            o.CodigoOrden,
            FORMAT(o.FechaIngreso,'dd/MM/yyyy HH:mm') AS Fecha,
            ISNULL(o.Cliente,'') AS Cliente,
            CAST(ROUND(${mag()},2) AS DECIMAL(10,2)) AS Metros,
            ISNULL(o.Material,'') AS Material,
            ISNULL(o.Nota, ISNULL(o.Observaciones,'')) AS Causa,
            ISNULL(o.Estado,'') AS Estado
        `;

        const [fallaRes, reposRes] = await Promise.all([
            mkR().query(`SELECT ${COLS} FROM dbo.Ordenes o WITH(NOLOCK) ${bW(`UPPER(LTRIM(RTRIM(o.Prioridad))) IN ('F','FALLA')`)} ORDER BY o.FechaIngreso DESC`),
            mkR().query(`SELECT ${COLS} FROM dbo.Ordenes o WITH(NOLOCK) ${bW(`(UPPER(LTRIM(RTRIM(o.Prioridad))) IN ('R','REPOSICION','REPOSICIÓN') OR UPPER(LEFT(LTRIM(RTRIM(ISNULL(o.CodigoOrden,''))),1))='R')`)} ORDER BY o.FechaIngreso DESC`),
        ]);

        res.json({
            fallas: fallaRes.recordset,
            reposiciones: reposRes.recordset,
            totales: {
                totalFallas:       fallaRes.recordset.length,
                totalReposiciones: reposRes.recordset.length,
                metrosFalla:       fallaRes.recordset.reduce((s,r) => s + Number(r.Metros||0), 0).toFixed(2),
                metrosReposicion:  reposRes.recordset.reduce((s,r) => s + Number(r.Metros||0), 0).toFixed(2),
            },
        });
    } catch (e) {
        logger.error('[PRODUCCION-ANALYTICS] getReporteFallasReposiciones:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/produccion-analytics/reporte/cancelaciones ─────────────────────
exports.getReporteCancelaciones = async (req, res) => {
    try {
        const pool   = await getPool();
        const params = parseParams(req.query);
        const { area, fechaDesde, fechaHasta, material, clienteNombre } = params;

        const conds = [`o.Estado IN ('Cancelado','Anulado','Rechazado')`];
        if (area && area !== 'Todas') conds.push('o.AreaID = @area');
        if (fechaDesde) conds.push('o.FechaIngreso >= @fechaDesde');
        if (fechaHasta) conds.push('o.FechaIngreso <= @fechaHasta');
        if (material)   conds.push('o.Material = @material');
        if (clienteNombre) conds.push('o.Cliente LIKE @clienteNombre');
        const where = `WHERE ${conds.join(' AND ')}`;

        const rData = pool.request(); bindAll(rData, params);
        const rTot  = pool.request(); bindAll(rTot,  params);

        const [data, totales] = await Promise.all([
            rData.query(`
                SELECT o.CodigoOrden,
                    FORMAT(o.FechaIngreso,'dd/MM/yyyy HH:mm') AS FechaIngreso,
                    (SELECT TOP 1 FORMAT(h.FechaInicio,'dd/MM/yyyy HH:mm')
                     FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                     WHERE h.OrdenID=o.OrdenID AND UPPER(LTRIM(RTRIM(h.Estado))) IN ('CANCELADO','CANCELADA','ANULADO','ANULADA','RECHAZADO','RECHAZADA')
                     ORDER BY h.FechaInicio DESC) AS FechaCancelacion,
                    (SELECT TOP 1 h.Usuario FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                     WHERE h.OrdenID=o.OrdenID AND UPPER(LTRIM(RTRIM(h.Estado))) IN ('CANCELADO','CANCELADA','ANULADO','ANULADA','RECHAZADO','RECHAZADA')
                     ORDER BY h.FechaInicio DESC) AS CanceladoPor,
                    o.Estado, ISNULL(o.AreaID,'') AS Area, ISNULL(o.Material,'') AS Material,
                    CAST(ROUND(${mag()},2) AS DECIMAL(10,2)) AS Metros,
                    ISNULL(mc.Titulo,'') AS MotivoCancelacion,
                    ISNULL(o.DetallesCancelacion,'') AS DetallesCancelacion,
                    ISNULL(o.Cliente,'') AS Cliente
                FROM dbo.Ordenes o WITH(NOLOCK)
                LEFT JOIN dbo.MotivosCancelacion mc WITH(NOLOCK) ON mc.MotivoID=o.MotivoCancelacionID
                ${where}
                ORDER BY o.FechaIngreso DESC
                OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY
            `),
            rTot.query(`
                SELECT COUNT(*) AS total,
                    CAST(ROUND(SUM(${mag()}),2) AS DECIMAL(10,2)) AS totalMetros,
                    SUM(CASE WHEN mc.Titulo IS NOT NULL THEN 1 ELSE 0 END) AS conMotivo,
                    SUM(CASE WHEN mc.Titulo IS NULL THEN 1 ELSE 0 END) AS sinMotivo
                FROM dbo.Ordenes o WITH(NOLOCK)
                LEFT JOIN dbo.MotivosCancelacion mc WITH(NOLOCK) ON mc.MotivoID=o.MotivoCancelacionID
                ${where}
            `),
        ]);

        res.json({ data: data.recordset, totales: totales.recordset[0] || {} });
    } catch (e) {
        logger.error('[PRODUCCION-ANALYTICS] getReporteCancelaciones:', e.message);
        res.status(500).json({ error: e.message });
    }
};
