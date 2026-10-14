'use strict';
// =====================================================================
// Administración › TIZADA PRO: el registro del intercambio con TIZADA
// =====================================================================
//   GET /api/admin/tizadapro/registro      → cómo está conectado + las últimas llamadas y avisos (en memoria)
//                                            + los últimos pedidos mandados (dbo.TizadaProEnvios)
//   GET /api/admin/tizadapro/envios/:id    → un pedido entero: el pedido.json que se mandó, lo que volvió,
//                                            las alarmas y los archivos
// Solo lectura. La llave nunca sale (ni el pedido la lleva).
// =====================================================================
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const api = require('../services/tizadaProApi');

const leer = (v, def) => { try { return v ? JSON.parse(v) : def; } catch (_) { return def; } };
async function tieneTabla(pool) {
    return !!(await pool.request().query("SELECT OBJECT_ID('dbo.TizadaProEnvios', 'U') AS T")).recordset[0].T;
}

exports.getRegistro = async (req, res) => {
    try {
        const pool = await getPool();
        const est = api.estadoConfig();
        const config = {
            activa: est.ok, motivo: est.motivo,
            url: String(process.env.TIZADAPRO_API_URL || ''),
            soloLectura: api.soloLectura(),
            modoEnvio: String(process.env.TIZADAPRO_ENVIO_MODO || 'MANUAL'),
            prefijo: String(process.env.TIZADAPRO_REFERENCIA_PREFIJO || 'SOL'),
            avisoUrl: String(process.env.TIZADAPRO_AVISO_URL || '') || null,
            avisoActivo: process.env.TIZADAPRO_AVISO_ACTIVO !== '0',
            sondeoSegundos: parseInt(process.env.TIZADAPRO_SONDEO_SEGUNDOS, 10) || null,
            mesasModo: String(process.env.TIZADAPRO_MESAS_MODO || 'normal'),
            baseTizada: process.env.TIZADAPRO_DB_SERVER ? `${process.env.TIZADAPRO_DB_SERVER}${process.env.TIZADAPRO_DB_PORT ? ',' + process.env.TIZADAPRO_DB_PORT : ''} · ${process.env.TIZADAPRO_DB || 'TizadaPro'}` : `mismo servidor · ${process.env.TIZADAPRO_DB || 'TizadaPro'}`,
        };
        let envios = [];
        if (await tieneTabla(pool)) {
            const r = await pool.request().query(`
                SELECT TOP 100 e.EnvioID, e.Origen, e.OrigenID, e.OrigenItemID, e.Referencia, e.Intento, e.Estado, e.Etapa, e.SoloRevision,
                       e.AlarmasJson, e.ArchivosJson, e.ErrorTexto, e.FechaEnvio, e.FechaActualizado, e.FechaFin,
                       LEN(e.PedidoJson) AS PedidoLargo, LEN(e.ResultadoJson) AS ResultadoLargo, u.Nombre AS Usuario
                FROM dbo.TizadaProEnvios e
                LEFT JOIN dbo.Usuarios u ON u.IdUsuario = e.UsuarioID
                ORDER BY e.EnvioID DESC`).catch(() => pool.request().query(`
                SELECT TOP 100 EnvioID, Origen, OrigenID, OrigenItemID, Referencia, Intento, Estado, Etapa, SoloRevision,
                       AlarmasJson, ArchivosJson, ErrorTexto, FechaEnvio, FechaActualizado, FechaFin,
                       LEN(PedidoJson) AS PedidoLargo, LEN(ResultadoJson) AS ResultadoLargo, CAST(NULL AS NVARCHAR(100)) AS Usuario
                FROM dbo.TizadaProEnvios ORDER BY EnvioID DESC`));
            envios = r.recordset.map(e => {
                const al = leer(e.AlarmasJson, []);
                return {
                    ...e, AlarmasJson: undefined, ArchivosJson: undefined,
                    Frenan: al.filter(a => a.frena).length, Avisos: al.filter(a => !a.frena).length,
                    Archivos: leer(e.ArchivosJson, []).length,
                };
            });
        }
        res.json({ success: true, data: { config, llamadas: api.registro(), envios } });
    } catch (e) {
        logger.error('[TIZADAPRO] registro:', e);
        res.status(500).json({ error: e.message });
    }
};

exports.getEnvio = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Envío inválido.' });
    try {
        const pool = await getPool();
        const r = await pool.request().input('E', sql.Int, id).query('SELECT * FROM dbo.TizadaProEnvios WHERE EnvioID = @E');
        const e = r.recordset[0];
        if (!e) return res.status(404).json({ error: 'Ese envío no existe.' });
        res.json({ success: true, data: {
            ...e, Pedido: leer(e.PedidoJson, null), Resultado: leer(e.ResultadoJson, null), Alarmas: leer(e.AlarmasJson, []), Archivos: leer(e.ArchivosJson, []),
            PedidoJson: undefined, ResultadoJson: undefined, AlarmasJson: undefined, ArchivosJson: undefined,
        } });
    } catch (e) {
        logger.error('[TIZADAPRO] envío del registro:', e);
        res.status(500).json({ error: e.message });
    }
};
