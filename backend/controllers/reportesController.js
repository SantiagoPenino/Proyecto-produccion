const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Magnitud numérica desde NVARCHAR
const mag = (col = 'o.Magnitud') =>
    `ISNULL(TRY_CAST(REPLACE(REPLACE(${col}, ',', '.'), ' ', '') AS FLOAT), 0)`;

const turnoWhere = (turno, col = 'o.FechaIngreso') => {
    if (String(turno) === '1') return `AND DATEPART(HOUR, ${col}) < 14`;
    if (String(turno) === '2') return `AND DATEPART(HOUR, ${col}) >= 14`;
    return '';
};

// WHERE estándar sobre tabla Ordenes (alias o)
// Nota: en Ordenes el cliente es o.Cliente (texto) — NO existe ClienteID
const buildWhereStr = ({ area, fechaDesde, fechaHasta, turno, clienteNombre }, dateCol = 'o.FechaIngreso', extraConds = []) => {
    const conds = [...extraConds];
    if (area && area !== 'Todas') conds.push('o.AreaID = @area');
    if (fechaDesde) conds.push(`${dateCol} >= @fechaDesde`);
    if (fechaHasta) conds.push(`${dateCol} <= @fechaHasta`);
    if (clienteNombre) conds.push(`o.Cliente LIKE @clienteNombre`);
    const tw = turnoWhere(turno, dateCol);
    const base = conds.length ? `WHERE ${conds.join(' AND ')}` : `WHERE 1=1`;
    return tw ? `${base} ${tw}` : base;
};

const bindParams = (r, { area, fechaDesde, fechaHasta, material, clienteNombre }) => {
    if (area && area !== 'Todas') r.input('area', sql.NVarChar(50), area);
    if (fechaDesde) r.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
    if (fechaHasta) {
        const d = new Date(fechaHasta);
        d.setHours(23, 59, 59, 999);
        r.input('fechaHasta', sql.DateTime, d);
    }
    if (material) r.input('material', sql.NVarChar(100), material);
    if (clienteNombre) r.input('clienteNombre', sql.NVarChar(150), `%${clienteNombre}%`);
};

// Construye params desde query-string (compatibiliza clienteSearch / idCliente legacy)
const extractParams = (q) => ({
    area:           q.area,
    fechaDesde:     q.fechaDesde,
    fechaHasta:     q.fechaHasta,
    turno:          q.turno,
    material:       q.material,
    // el frontend envía clienteSearch como texto libre
    clienteNombre:  q.clienteSearch || q.clienteNombre || null,
});

// ─── GET /api/reportes/filtros ────────────────────────────────────────────────
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
            // Clientes: nombre directo desde o.Cliente (no necesita join)
            pool.request().query(`
                SELECT TOP 100
                    o.Cliente AS id,
                    o.Cliente AS nombre
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.Cliente IS NOT NULL AND LTRIM(RTRIM(o.Cliente)) != ''
                GROUP BY o.Cliente
                ORDER BY COUNT(*) DESC
            `)
        ]);
        res.json({
            areas:     areas.recordset,
            materiales: mats.recordset,
            clientes:  clientes.recordset,
        });
    } catch (e) {
        logger.error('[REPORTES] getFiltros:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/reportes/fallas-reposiciones ────────────────────────────────────
// Fallas      → Ordenes con Prioridad='Falla'  (órdenes -F, creadas al registrar una falla)
// Reposiciones→ Ordenes con Prioridad Reposición / código que comienza en R
// Respuesta separada: { fallas: [...], reposiciones: [...], totales: {...} }
exports.getReporteFallasReposiciones = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { area, fechaDesde, fechaHasta, turno, material, clienteNombre } = params;

        // Crea un request con todos los parámetros de filtro ya enlazados
        const mkR = () => {
            const r = pool.request();
            if (area && area !== 'Todas') r.input('area', sql.NVarChar(50), area);
            if (fechaDesde) r.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
            if (fechaHasta) { const d = new Date(fechaHasta); d.setHours(23,59,59,999); r.input('fechaHasta', sql.DateTime, d); }
            if (material) r.input('material', sql.NVarChar(100), material);
            if (clienteNombre) r.input('clienteNombre', sql.NVarChar(150), `%${clienteNombre}%`);
            return r;
        };

        // Construye WHERE para Ordenes con condición base extra
        const buildW = (extraCond) => {
            const conds = [extraCond];
            if (area && area !== 'Todas') conds.push('o.AreaID = @area');
            if (fechaDesde) conds.push('o.FechaIngreso >= @fechaDesde');
            if (fechaHasta) conds.push('o.FechaIngreso <= @fechaHasta');
            if (material) conds.push('o.Material = @material');
            if (clienteNombre) conds.push('o.Cliente LIKE @clienteNombre');
            const tw = turnoWhere(turno, 'o.FechaIngreso');
            return `WHERE ${conds.join(' AND ')}` + (tw ? ` ${tw}` : '');
        };

        // Columnas iguales en ambas secciones
        const COLS = `
            o.CodigoOrden,
            FORMAT(o.FechaIngreso, 'dd/MM/yyyy HH:mm') AS Fecha,
            ISNULL(o.Cliente, '')  AS Cliente,
            CAST(ROUND(${mag()}, 2) AS DECIMAL(10,2)) AS Metros,
            ISNULL(o.Material, '') AS Material,
            ISNULL(o.Nota, ISNULL(o.Observaciones, '')) AS Causa,
            ISNULL(o.Estado, '')   AS Estado
        `;

        const fallaWhere = buildW(`UPPER(LTRIM(RTRIM(o.Prioridad))) IN ('F','FALLA')`);
        const reposWhere = buildW(`(UPPER(LTRIM(RTRIM(o.Prioridad))) IN ('R','REPOSICION','REPOSICIÓN') OR UPPER(LEFT(LTRIM(RTRIM(ISNULL(o.CodigoOrden,''))), 1)) = 'R')`);

        const [fallaRes, reposRes] = await Promise.all([
            mkR().query(`SELECT ${COLS} FROM dbo.Ordenes o WITH(NOLOCK) ${fallaWhere} ORDER BY o.FechaIngreso DESC`),
            mkR().query(`SELECT ${COLS} FROM dbo.Ordenes o WITH(NOLOCK) ${reposWhere} ORDER BY o.FechaIngreso DESC`),
        ]);

        const totales = {
            totalFallas:       fallaRes.recordset.length,
            totalReposiciones: reposRes.recordset.length,
            metrosFalla:       fallaRes.recordset.reduce((s, r) => s + Number(r.Metros || 0), 0).toFixed(2),
            metrosReposicion:  reposRes.recordset.reduce((s, r) => s + Number(r.Metros || 0), 0).toFixed(2),
        };

        res.json({ fallas: fallaRes.recordset, reposiciones: reposRes.recordset, totales });
    } catch (e) {
        logger.error('[REPORTES] getReporteFallasReposiciones:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/reportes/cancelaciones ─────────────────────────────────────────
exports.getReporteCancelaciones = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { area, fechaDesde, fechaHasta, turno, material, clienteNombre } = params;

        const conds = [`o.Estado IN ('Cancelado','Anulado','Rechazado')`];
        if (area && area !== 'Todas') conds.push('o.AreaID = @area');
        if (fechaDesde) conds.push('o.FechaIngreso >= @fechaDesde');
        if (fechaHasta) conds.push('o.FechaIngreso <= @fechaHasta');
        if (material) conds.push('o.Material = @material');
        if (clienteNombre) conds.push('o.Cliente LIKE @clienteNombre');
        const tw = turnoWhere(turno, 'o.FechaIngreso');
        const where = `WHERE ${conds.join(' AND ')}` + (tw ? ` ${tw}` : '');

        const rData = pool.request();
        bindParams(rData, params);

        const rTot = pool.request();
        bindParams(rTot, params);

        const [data, totales] = await Promise.all([
            rData.query(`
                SELECT
                    o.CodigoOrden,
                    FORMAT(o.FechaIngreso, 'dd/MM/yyyy HH:mm') AS FechaIngreso,
                    (
                        SELECT TOP 1 FORMAT(h.FechaInicio, 'dd/MM/yyyy HH:mm')
                        FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                        WHERE h.OrdenID = o.OrdenID
                          AND UPPER(LTRIM(RTRIM(h.Estado))) IN ('CANCELADO','CANCELADA','ANULADO','ANULADA','RECHAZADO','RECHAZADA')
                        ORDER BY h.FechaInicio DESC
                    ) AS FechaCancelacion,
                    (
                        SELECT TOP 1 h.Usuario
                        FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                        WHERE h.OrdenID = o.OrdenID
                          AND UPPER(LTRIM(RTRIM(h.Estado))) IN ('CANCELADO','CANCELADA','ANULADO','ANULADA','RECHAZADO','RECHAZADA')
                        ORDER BY h.FechaInicio DESC
                    ) AS CanceladoPor,
                    o.Estado,
                    ISNULL(o.AreaID, '')   AS Area,
                    ISNULL(o.Material, '') AS Material,
                    CAST(ROUND(${mag()}, 2) AS DECIMAL(10,2)) AS Metros,
                    ISNULL(mc.Titulo, '')  AS MotivoCancelacion,
                    ISNULL(o.DetallesCancelacion, '') AS DetallesCancelacion,
                    ISNULL(o.Cliente, '')  AS Cliente
                FROM dbo.Ordenes o WITH(NOLOCK)
                LEFT JOIN dbo.MotivosCancelacion mc WITH(NOLOCK) ON mc.MotivoID = o.MotivoCancelacionID
                ${where}
                ORDER BY o.FechaIngreso DESC
                OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY
            `),
            rTot.query(`
                SELECT
                    COUNT(*) AS total,
                    CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS totalMetros,
                    SUM(CASE WHEN mc.Titulo IS NOT NULL THEN 1 ELSE 0 END) AS conMotivo,
                    SUM(CASE WHEN mc.Titulo IS NULL     THEN 1 ELSE 0 END) AS sinMotivo
                FROM dbo.Ordenes o WITH(NOLOCK)
                LEFT JOIN dbo.MotivosCancelacion mc WITH(NOLOCK) ON mc.MotivoID = o.MotivoCancelacionID
                ${where}
            `)
        ]);

        res.json({ data: data.recordset, totales: totales.recordset[0] || {} });
    } catch (e) {
        logger.error('[REPORTES] getReporteCancelaciones:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/reportes/ordenes-por-dia ───────────────────────────────────────
// Órdenes finalizadas (Estado=Finalizado ó En Produccion+EstadoEnArea=Pronto)
// Fecha usada = última vez que pasó por Control de Calidad en HistorialOrdenes
exports.getReporteOrdenesPorDia = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { area, fechaDesde, fechaHasta, material, clienteNombre } = params;

        const orConds = [];
        if (area && area !== 'Todas') orConds.push('o.AreaID = @area');
        if (material) orConds.push('o.Material = @material');
        if (clienteNombre) orConds.push('o.Cliente LIKE @clienteNombre');
        const extraWhere = orConds.length ? `AND ${orConds.join(' AND ')}` : '';

        const fechaConds = [];
        if (fechaDesde) fechaConds.push('h.FechaInicio >= @fechaDesde');
        if (fechaHasta) fechaConds.push('h.FechaInicio <= @fechaHasta');
        const fechaWhere = fechaConds.length ? `AND ${fechaConds.join(' AND ')}` : '';

        const r = pool.request();
        if (area && area !== 'Todas') r.input('area', sql.NVarChar(50), area);
        if (fechaDesde) r.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
        if (fechaHasta) { const d = new Date(fechaHasta); d.setHours(23,59,59,999); r.input('fechaHasta', sql.DateTime, d); }
        if (material) r.input('material', sql.NVarChar(100), material);
        if (clienteNombre) r.input('clienteNombre', sql.NVarChar(150), `%${clienteNombre}%`);

        const result = await r.query(`
            WITH OrdenesFinalizadas AS (
                SELECT o.OrdenID, ${mag()} AS _mag
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE (o.Estado = 'Finalizado'
                    OR (o.Estado = 'En Produccion' AND o.EstadoEnArea = 'Pronto'))
                ${extraWhere}
            ),
            UltimoCalidad AS (
                SELECT h.OrdenID, h.FechaInicio,
                    ROW_NUMBER() OVER (PARTITION BY h.OrdenID ORDER BY h.FechaInicio DESC) AS rn
                FROM dbo.HistorialOrdenes h WITH(NOLOCK)
                INNER JOIN OrdenesFinalizadas f ON f.OrdenID = h.OrdenID
                WHERE UPPER(LTRIM(RTRIM(h.Estado))) LIKE '%CALIDAD%'
                ${fechaWhere}
            )
            SELECT
                FORMAT(CAST(uc.FechaInicio AS DATE), 'dd/MM/yyyy') AS Dia,
                CAST(uc.FechaInicio AS DATE) AS _sortDate,
                SUM(CASE WHEN DATEPART(HOUR, uc.FechaInicio) < 14  THEN 1    ELSE 0 END) AS T1_Ordenes,
                CAST(ROUND(SUM(CASE WHEN DATEPART(HOUR, uc.FechaInicio) < 14  THEN f._mag ELSE 0 END), 2) AS DECIMAL(10,2)) AS T1_Metros,
                SUM(CASE WHEN DATEPART(HOUR, uc.FechaInicio) >= 14 THEN 1    ELSE 0 END) AS T2_Ordenes,
                CAST(ROUND(SUM(CASE WHEN DATEPART(HOUR, uc.FechaInicio) >= 14 THEN f._mag ELSE 0 END), 2) AS DECIMAL(10,2)) AS T2_Metros,
                COUNT(*) AS Total_Ordenes,
                CAST(ROUND(SUM(f._mag), 2) AS DECIMAL(10,2)) AS Total_Metros
            FROM UltimoCalidad uc
            INNER JOIN OrdenesFinalizadas f ON f.OrdenID = uc.OrdenID
            WHERE uc.rn = 1
            GROUP BY CAST(uc.FechaInicio AS DATE)
            ORDER BY CAST(uc.FechaInicio AS DATE) DESC
        `);

        const data = result.recordset.map(({ _sortDate, ...row }) => row);
        res.json({ data });
    } catch (e) {
        logger.error('[REPORTES] getReporteOrdenesPorDia:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/reportes/ordenes ────────────────────────────────────────────────
exports.getReporteOrdenes = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { material } = params;
        const { page = 1, pageSize = 500 } = req.query;

        const extraConds = [];
        if (material) extraConds.push('o.Material = @material');
        const where = buildWhereStr(params, 'o.FechaIngreso', extraConds);

        const rData = pool.request();
        bindParams(rData, params);
        rData.input('offset',   sql.Int, (parseInt(page) - 1) * parseInt(pageSize));
        rData.input('pageSize', sql.Int, parseInt(pageSize));

        const rTot = pool.request();
        bindParams(rTot, params);

        const [data, totales] = await Promise.all([
            rData.query(`
                SELECT
                    o.CodigoOrden,
                    FORMAT(o.FechaIngreso, 'dd/MM/yyyy HH:mm') AS FechaIngreso,
                    o.Estado,
                    ISNULL(o.AreaID, '')       AS Area,
                    ISNULL(o.Material, '')     AS Material,
                    ISNULL(o.Prioridad, '')    AS Prioridad,
                    CAST(ROUND(${mag()}, 2) AS DECIMAL(10,2)) AS Metros,
                    ISNULL(o.Cliente, '')      AS Cliente,
                    ISNULL(o.Observaciones, '') AS Observaciones
                FROM dbo.Ordenes o WITH(NOLOCK)
                ${where}
                ORDER BY o.FechaIngreso DESC
                OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
            `),
            rTot.query(`
                SELECT
                    COUNT(*) AS total,
                    CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS totalMetros,
                    SUM(CASE WHEN o.Estado NOT IN ('Entregado','Finalizado','Cancelado','Anulado','Rechazado','Pronto') THEN 1 ELSE 0 END) AS activas,
                    SUM(CASE WHEN o.Estado IN ('Entregado','Finalizado','Pronto') THEN 1 ELSE 0 END) AS completadas
                FROM dbo.Ordenes o WITH(NOLOCK)
                ${where}
            `)
        ]);

        res.json({ data: data.recordset, totales: totales.recordset[0] || {}, page: parseInt(page), pageSize: parseInt(pageSize) });
    } catch (e) {
        logger.error('[REPORTES] getReporteOrdenes:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/reportes/metros-material ───────────────────────────────────────
exports.getReporteMetrosMaterial = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { material } = params;

        const extraConds = [];
        if (material) extraConds.push('o.Material = @material');
        const where = buildWhereStr(params, 'o.FechaIngreso', extraConds);

        const r = pool.request();
        bindParams(r, params);

        const result = await r.query(`
            SELECT
                ISNULL(o.Material, 'Sin Material') AS Material,
                COUNT(*) AS Ordenes,
                CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS TotalMetros,
                SUM(CASE WHEN o.Estado NOT IN ('Entregado','Finalizado','Cancelado','Anulado','Rechazado','Pronto') THEN 1 ELSE 0 END) AS Activas,
                SUM(CASE WHEN o.Estado IN ('Entregado','Finalizado','Pronto') THEN 1 ELSE 0 END) AS Completadas,
                CAST(ROUND(AVG(${mag()}), 2) AS DECIMAL(10,2)) AS PromedioMetros
            FROM dbo.Ordenes o WITH(NOLOCK)
            ${where}
            GROUP BY o.Material
            ORDER BY TotalMetros DESC
        `);

        res.json({ data: result.recordset });
    } catch (e) {
        logger.error('[REPORTES] getReporteMetrosMaterial:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/reportes/operadores ────────────────────────────────────────────
// HistorialOrdenes cols: OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle
exports.getReporteOperadores = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { area, fechaDesde, fechaHasta, turno, material, clienteNombre } = params;

        const conds = [];
        if (area && area !== 'Todas') conds.push('o.AreaID = @area');
        if (fechaDesde) conds.push('h.FechaInicio >= @fechaDesde');
        if (fechaHasta) conds.push('h.FechaInicio <= @fechaHasta');
        if (material) conds.push('o.Material = @material');
        if (clienteNombre) conds.push('o.Cliente LIKE @clienteNombre');
        const tw = turnoWhere(turno, 'h.FechaInicio');
        const base = conds.length ? `WHERE ${conds.join(' AND ')}` : `WHERE 1=1`;
        const where = tw ? `${base} ${tw}` : base;

        const r = pool.request();
        if (area && area !== 'Todas') r.input('area', sql.NVarChar(50), area);
        if (fechaDesde) r.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
        if (fechaHasta) { const d = new Date(fechaHasta); d.setHours(23,59,59,999); r.input('fechaHasta', sql.DateTime, d); }
        if (material) r.input('material', sql.NVarChar(100), material);
        if (clienteNombre) r.input('clienteNombre', sql.NVarChar(150), `%${clienteNombre}%`);

        const result = await r.query(`
            SELECT
                ISNULL(h.Usuario, 'Sin asignar') AS Operador,
                COUNT(DISTINCT h.OrdenID) AS Ordenes,
                CAST(ROUND(SUM(${mag('o.Magnitud')}), 2) AS DECIMAL(10,2)) AS TotalMetros,
                CAST(ROUND(AVG(${mag('o.Magnitud')}), 2) AS DECIMAL(10,2)) AS PromedioMetros,
                SUM(CASE WHEN UPPER(LTRIM(RTRIM(h.Estado))) IN ('ENTREGADO','FINALIZADO','PRONTO') THEN 1 ELSE 0 END) AS Completadas
            FROM dbo.HistorialOrdenes h WITH(NOLOCK)
            JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = h.OrdenID
            ${where}
            GROUP BY h.Usuario
            ORDER BY TotalMetros DESC
        `);

        res.json({ data: result.recordset });
    } catch (e) {
        logger.error('[REPORTES] getReporteOperadores:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── GET /api/reportes/clientes ───────────────────────────────────────────────
exports.getReporteClientes = async (req, res) => {
    try {
        const pool = await getPool();
        const params = extractParams(req.query);
        const { material } = params;

        const extraConds = [];
        if (material) extraConds.push('o.Material = @material');
        const where = buildWhereStr(params, 'o.FechaIngreso', extraConds);

        const r = pool.request();
        bindParams(r, params);

        const result = await r.query(`
            SELECT
                ISNULL(o.Cliente, 'Sin Cliente') AS Cliente,
                COUNT(*) AS Ordenes,
                CAST(ROUND(SUM(${mag()}), 2) AS DECIMAL(10,2)) AS TotalMetros,
                SUM(CASE WHEN o.Estado NOT IN ('Entregado','Finalizado','Cancelado','Anulado','Rechazado','Pronto') THEN 1 ELSE 0 END) AS Activas,
                SUM(CASE WHEN o.Estado IN ('Entregado','Finalizado','Pronto') THEN 1 ELSE 0 END) AS Completadas,
                MAX(FORMAT(o.FechaIngreso, 'dd/MM/yyyy')) AS UltimaOrden
            FROM dbo.Ordenes o WITH(NOLOCK)
            ${where}
            GROUP BY o.Cliente
            ORDER BY TotalMetros DESC
        `);

        res.json({ data: result.recordset });
    } catch (e) {
        logger.error('[REPORTES] getReporteClientes:', e.message);
        res.status(500).json({ error: e.message });
    }
};
