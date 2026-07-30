const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Obtiene métricas del PEDIDO (Agrupación por NoDocERP).
 * Agrupa todas las sub-órdenes (ej: orden 29 (1/3), 29 (2/3)) para dar una visión global.
 */
const getPedidoMetrics = async (req, res) => {
    try {
        const { noDocErp } = req.params;
        const { areaId } = req.query;

        if (!noDocErp || noDocErp === 'undefined') return res.json({ subOrdenes: 0, progresoGlobal: 0, allFiles: [], ruta: [], ordenes: [] });

        const pool = await getPool();

        // Limpieza básica de referencia
        let baseRef = decodeURIComponent(noDocErp).trim();
        const match = baseRef.match(/^(.+?)\s*\(/);
        if (match) baseRef = match[1].trim();

        // 2. Obtener TODAS las órdenes del proyecto (Global) para Ruta y Progreso
        const globalQuery = `
            SELECT O.OrdenID, O.CodigoOrden, O.NoDocERP, O.Estado, O.AreaID
            FROM Ordenes O WITH (NOLOCK)
            WHERE (O.NoDocERP LIKE @BaseRef + '%') OR (O.CodigoOrden LIKE @BaseRef + '%') OR (CAST(O.OrdenID AS VARCHAR) = @BaseRef)
        `;

        const globalRes = await pool.request()
            .input('BaseRef', sql.NVarChar, baseRef)
            .query(globalQuery);

        const globalOrders = globalRes.recordset;

        if (globalOrders.length === 0) return res.json({ subOrdenes: 0, progresoGlobal: 0, allFiles: [], ruta: [], ordenes: [] });

        // 3. Generar RUTA de la orden (Áreas y sus estados)
        const rutaMap = {};
        globalOrders.forEach(o => {
            const area = o.AreaID || 'General';
            if (!rutaMap[area]) rutaMap[area] = { status: 'PENDIENTE', count: 0 };
            rutaMap[area].count++;

            // Logic de estados ruta
            const upperState = (o.Estado || '').toUpperCase();
            if (['PRONTO SECTOR', 'FINALIZADO', 'EN_LOGISTICA', 'PRONTO', 'ENTREGADO', 'DESPACHADO'].includes(upperState)) rutaMap[area].status = 'FINALIZADO';
            else if (['EN PROCESO', 'PRODUCCION', 'IMPRIMIENDO', 'CONTROL Y CALIDAD'].includes(upperState)) rutaMap[area].status = 'EN PROCESO';
            else if (['RETENIDO', 'ESPERANDO REPOSICION'].includes(upperState)) rutaMap[area].status = 'PROBLEMA'; // Nuevo estado para feedback visual?
        });

        const ruta = Object.keys(rutaMap).map(area => ({ area, estado: rutaMap[area].status }));

        // 3.6 Resumen por orden (para tarjetas de "órdenes hermanas": material, lote, máquina y estado propio)
        let ordenes = [];
        const summaryOrderIds = globalOrders.map(o => o.OrdenID);
        if (summaryOrderIds.length > 0) {
            const resumenQuery = `
                SELECT O.OrdenID, O.CodigoOrden, O.Estado, O.EstadoenArea, O.AreaID, O.Material,
                       ISNULL(O.EstadoLogistica, 'Canasto Produccion') as Canasto,
                       R.RolloID, R.Nombre as NombreRollo, CE.Nombre as NombreMaquina
                FROM Ordenes O WITH (NOLOCK)
                LEFT JOIN Rollos R WITH (NOLOCK) ON O.RolloID = R.RolloID
                LEFT JOIN ConfigEquipos CE WITH (NOLOCK) ON ISNULL(O.MaquinaID, R.MaquinaID) = CE.EquipoID
                WHERE O.OrdenID IN (${summaryOrderIds.join(',')})
            `;
            const resumenRes = await pool.request().query(resumenQuery);
            ordenes = resumenRes.recordset;
        }

        // 4. Obtener Archivos para el STATUS VISUAL
        let targetOrderIds = globalOrders.map(o => o.OrdenID);
        if (areaId && areaId !== 'undefined') {
            targetOrderIds = globalOrders.filter(o => o.AreaID === areaId).map(o => o.OrdenID);
        }

        let allFiles = [];
        if (targetOrderIds.length > 0) {
            const itemsList = targetOrderIds.join(',');
            const filesQuery = `
                SELECT
                    OA.OrdenID, O.Material, O.AreaID, OA.NombreArchivo, OA.EstadoArchivo as Estado,
                    OA.Copias, ISNULL(OA.Controlcopias, 0) as Controlcopias, OA.Metros, OA.RutaAlmacenamiento as link,
                    ISNULL(O.MaquinaID, R.MaquinaID) as MaquinaID, R.Nombre as NombreRollo, 0 as isService
                FROM ArchivosOrden OA WITH (NOLOCK)
                INNER JOIN Ordenes O WITH (NOLOCK) ON OA.OrdenID = O.OrdenID
                LEFT JOIN Rollos R WITH (NOLOCK) ON O.RolloID = R.RolloID
                WHERE OA.OrdenID IN (${itemsList})

                UNION ALL

                SELECT
                    SEO.OrdenID, O.Material, O.AreaID, SEO.Descripcion as NombreArchivo, SEO.Estado as Estado,
                    SEO.Cantidad as Copias, ISNULL(SEO.Controlcopias, 0) as Controlcopias, NULL as Metros, NULL as link,
                    ISNULL(O.MaquinaID, R.MaquinaID) as MaquinaID, R.Nombre as NombreRollo, 1 as isService
                FROM ServiciosExtraOrden SEO WITH (NOLOCK)
                INNER JOIN Ordenes O WITH (NOLOCK) ON SEO.OrdenID = O.OrdenID
                LEFT JOIN Rollos R WITH (NOLOCK) ON O.RolloID = R.RolloID
                WHERE SEO.OrdenID IN (${itemsList})
            `;
            const filesRes = await pool.request().query(filesQuery);
            allFiles = filesRes.recordset.map(f => ({
                ...f,
                urlProxy: (f.link && f.link.includes('drive.google.com'))
                    ? `/api/production-file-control/view-drive-file?url=${encodeURIComponent(f.link)}`
                    : null
            }));
        }

        const ordersCompleted = globalOrders.filter(o => {
            const s = (o.Estado || '').toUpperCase();
            return ['FINALIZADO', 'PRONTO SECTOR', 'PRONTO', 'ENTREGADO', 'DESPACHADO'].includes(s);
        }).length;
        const progresoGlobal = globalOrders.length > 0 ? ((ordersCompleted / globalOrders.length) * 100).toFixed(0) : 0;

        res.json({
            subOrdenes: globalOrders.length,
            progresoGlobal,
            allFiles,
            ruta,
            ordenes
        });

    } catch (err) {
        logger.error("Error en getPedidoMetrics:", err);
        res.status(500).json({ error: 'Error al obtener métricas de pedido', message: err.message });
    }
};

module.exports = {
    getPedidoMetrics
};
