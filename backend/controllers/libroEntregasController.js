/**
 * Libro de entregas (Spec 39): endpoints de consulta para Crear Remito, las bandejas y Depósito.
 * Montado en /api/logistics/libro/* (logisticsRoutes.js).
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const libro = require('../services/libroEntregasService');
const linaje = require('../services/linajeOrdenesService');

/** GET /logistics/libro/config → áreas con parcial / cadena habilitados */
exports.getConfig = async (req, res) => {
    try {
        const [areasParcial, areasCadena, areasUnidades] = await Promise.all([libro.areasConParcial(), libro.areasConCadena(), libro.areasQueCuentanUnidades()]);
        res.json({ areasParcial, areasCadena, areasUnidades });
    } catch (err) { logger.error('[libro] getConfig:', err); res.status(500).json({ error: err.message }); }
};

/** GET /logistics/libro/orden/:id */
exports.getLibroOrden = async (req, res) => {
    try {
        const data = await libro.getLibroOrden(parseInt(req.params.id, 10));
        if (!data) return res.status(404).json({ error: 'Orden no encontrada' });
        res.json(data);
    } catch (err) { logger.error('[libro] getLibroOrden:', err); res.status(500).json({ error: err.message }); }
};

/** GET /logistics/libro/pedido/:noDoc */
exports.getLibroPedido = async (req, res) => {
    try {
        res.json(await libro.getLibroPedido(String(req.params.noDoc).trim()));
    } catch (err) { logger.error('[libro] getLibroPedido:', err); res.status(500).json({ error: err.message }); }
};

/** GET /logistics/libro/pendientes?noDoc=&area=  → "lo que falta de este pedido" para un área */
exports.getPendientesArea = async (req, res) => {
    try {
        const { noDoc, area } = req.query;
        if (!noDoc || !area) return res.status(400).json({ error: 'Faltan noDoc y area' });
        res.json(await libro.getPendientesParaArea(String(noDoc).trim(), String(area).trim()));
    } catch (err) { logger.error('[libro] getPendientesArea:', err); res.status(500).json({ error: err.message }); }
};

/**
 * POST /logistics/libro/envio-info { ordenIds: [], areaOrigen, areaDestino }
 * Lo que Crear Remito necesita por orden para armar el bloque "Envío por orden":
 * si el área permite parcial, si la orden puede marcarse completa, sus reposiciones abiertas,
 * si cuenta unidades y cuánto se espera / ya salió.
 */
exports.getEnvioInfo = async (req, res) => {
    try {
        const { ordenIds = [], areaOrigen, areaDestino } = req.body || {};
        const ids = [...new Set((ordenIds || []).map(Number).filter(n => !isNaN(n) && n > 0))];
        const [areasParcial, areasUnidades] = await Promise.all([libro.areasConParcial(), libro.areasQueCuentanUnidades()]);
        const origen = String(areaOrigen || '').trim().toUpperCase();
        const permiteParcial = !!origen && areasParcial.includes(origen) && String(areaDestino || '').trim().toUpperCase() !== 'DEPOSITO';
        if (!ids.length) return res.json({ permiteParcial, areasParcial, ordenes: [] });
        const pool = await getPool();
        const info = await pool.request().query(`
            SELECT OrdenID, CodigoOrden, AreaID, UM, NoDocERP, EstadoEnvio, Magnitud, CantidadEsperada, DescripcionTrabajo, Cliente, EstadoenArea, CantidadAprobadaBultos
            FROM Ordenes WHERE OrdenID IN (${ids.join(',')})`);
        const ordenes = [];
        for (const o of info.recordset) {
            const rep = await linaje.getReposicionDeFalla(o.OrdenID);
            const madreId = rep ? Number(rep.OrdenMadreID) : Number(o.OrdenID);
            let madre = o;
            if (rep) {
                const m = await pool.request().input('id', sql.Int, madreId).query(`SELECT OrdenID, CodigoOrden, AreaID, UM, NoDocERP, EstadoEnvio, Magnitud, CantidadEsperada, DescripcionTrabajo, Cliente, EstadoenArea, CantidadAprobadaBultos FROM Ordenes WHERE OrdenID = @id`);
                madre = m.recordset[0] || o;
            }
            // Spec 39 (extensión "aprobar por tandas"): si la orden madre ya aprobó tandas
            // parciales de Control pero todavía no llegó a la magnitud total, sigue en
            // producción — este bulto NO puede completarla, sea cual sea el estado del libro.
            // Magnitud EFECTIVA (no la columna cruda): en Corte, por ejemplo, Ordenes.Magnitud
            // suele quedar en '0' y las piezas reales viven en ArchivosOrden/ArchivosReferencia
            // (misma cuenta que usa la bandeja al aprobar — embBoardController.getMagnitudEfectiva).
            const aprobadoBultos = madre.CantidadAprobadaBultos != null ? parseFloat(madre.CantidadAprobadaBultos) : null;
            const cuentaUnidades = areasUnidades.includes(String(madre.AreaID || '').trim().toUpperCase());
            let siguEnProduccion = false, magnitudMadre = parseFloat(madre.Magnitud) || 0;
            if (cuentaUnidades) {
                try {
                    const { getMagnitudEfectiva } = require('./embBoardController');
                    magnitudMadre = (await getMagnitudEfectiva(pool, madreId)) || magnitudMadre;
                } catch (eMag) { logger.warn('[libro] getEnvioInfo magnitudEfectiva:', eMag.message); }
            }
            if (aprobadoBultos != null) {
                siguEnProduccion = magnitudMadre > 0 && aprobadoBultos < magnitudMadre && String(madre.EstadoenArea || '').trim().toUpperCase() !== 'PRONTO';
            }
            const puede = await libro.puedeCompletar(madreId, null, { incluirImplicitas: true });
            const abiertas = puede.reposicionesAbiertas
                .filter(r => !(rep && Number(r.ReposicionID) === Number(rep.ReposicionID)))
                .map(r => ({ reposicionId: r.ReposicionID, codigo: r.CodigoFalla, estado: r.Estado, descripcion: libro.describirReposicion(r), area: r.AreaProduce, implicita: !!r.Implicita }));
            const envios = await libro.getEnviosOrden(madreId);
            const enviada = envios.some(e => e.Cantidad != null) ? envios.reduce((s, e) => s + Number(e.Cantidad || 0), 0) : null;
            // Spec 39 (extensión "aprobar por tandas"): sugerir la cantidad de ESTE envío.
            // Un COMPLEMENTO (bulto de una orden de falla) es una entidad propia: su cantidad
            // sale de LA PROPIA -F (cuánto se aprobó de ELLA), no de la madre — la madre puede
            // estar completa hace rato (30 de 30 ya enviados) mientras la reposición recién
            // ahora está lista para viajar; usar los números de la madre daba 0 siempre.
            let cantidadSugerida;
            if (rep) {
                const aprobadoFalla = o.CantidadAprobadaBultos != null ? parseFloat(o.CantidadAprobadaBultos)
                    : (rep.Cantidad != null ? Number(rep.Cantidad) : null);
                const yaDeclaradoRep = (await pool.request().input('rid', sql.Int, rep.ReposicionID)
                    .query(`SELECT ISNULL(SUM(Cantidad), 0) AS s FROM Logistica_EnvioOrdenes WHERE ReposicionID = @rid`)).recordset[0].s;
                cantidadSugerida = aprobadoFalla != null ? Math.max(aprobadoFalla - yaDeclaradoRep, 0) : null;
            } else {
                // Precarga el campo (editable) en vez de dejarlo en blanco cuando el dato es
                // exacto: lo ya aprobado en Control menos lo ya declarado en remitos anteriores.
                cantidadSugerida = aprobadoBultos != null ? Math.max(aprobadoBultos - (enviada || 0), 0) : null;
            }
            ordenes.push({
                ordenId: o.OrdenID, codigo: String(o.CodigoOrden || '').trim(), areaId: String(o.AreaID || '').trim(), um: String(madre.UM || '').trim(),
                esComplemento: !!rep, reposicionId: rep ? rep.ReposicionID : null,
                madreId, codigoMadre: String(madre.CodigoOrden || '').trim(), noDocERP: madre.NoDocERP ? String(madre.NoDocERP).trim() : null,
                estadoEnvio: madre.EstadoEnvio || 'SIN_ENVIAR', enviosPrevios: envios.length,
                cuentaUnidades, cantidadEsperada: libro.cantidadEsperada(madre) || (cuentaUnidades ? magnitudMadre || null : null), cantidadEnviada: enviada,
                puedeCompletar: abiertas.length === 0 && !siguEnProduccion, reposicionesAbiertas: abiertas,
                siguEnProduccion, aprobadoBultos, magnitudMadre, cantidadSugerida,
            });
        }
        res.json({ permiteParcial, areasParcial, ordenes });
    } catch (err) { logger.error('[libro] getEnvioInfo:', err); res.status(500).json({ error: err.message }); }
};
