// ─────────────────────────────────────────────────────────────────────────────
// Avisos a usuarios INTERNOS (la campanita del menú superior).
//
// notificar() hace tres cosas: guarda el aviso en NotificacionesUsuario (queda en la campanita
// aunque la persona no tenga el sistema abierto), lo manda al momento por socket a la sala
// `usuario:<id>` (aviso emergente) y como push a los celulares donde activó los avisos.
// Nunca tira: un aviso que falla no debe romper la operación que lo originó. Llamarlo DESPUÉS
// del commit de la transacción del negocio.
// Tablas: docs/servicio-tecnico/st-etapa1.sql.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const push = require('./pushNotificationService');
const { emitirAUsuarios } = require('../utils/salasUsuario');

async function notificar({ usuarioIds, modulo, titulo, texto = null, url = null, io = null, tag = null }) {
    const ids = [...new Set((usuarioIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (!ids.length || !titulo) return;
    const tit = String(titulo).slice(0, 200);
    const txt = texto ? String(texto).slice(0, 500) : null;

    try {
        const pool = await getPool();
        for (const id of ids) {
            const r = await pool.request()
                .input('U', sql.Int, id)
                .input('M', sql.VarChar(30), modulo)
                .input('T', sql.NVarChar(200), tit)
                .input('X', sql.NVarChar(500), txt)
                .input('Url', sql.NVarChar(300), url)
                .query(`INSERT INTO dbo.NotificacionesUsuario (UsuarioId, Modulo, Titulo, Texto, Url)
                        OUTPUT INSERTED.NotId, INSERTED.Fecha
                        VALUES (@U, @M, @T, @X, @Url)`);
            const fila = r.recordset[0] || {};
            emitirAUsuarios(io, [id], 'notificacion:nueva', {
                NotId: fila.NotId, Modulo: modulo, Titulo: tit, Texto: txt, Url: url, Leida: false, Fecha: fila.Fecha,
            });
        }
    } catch (err) {
        logger.error(`[Notificaciones] No se pudo guardar el aviso "${tit}": ${err.message}`);
    }

    push.sendToUsuariosInternos(ids, { title: tit, body: txt || '', url: url || '/', tag })
        .catch(err => logger.error(`[Notificaciones] push: ${err.message}`));
}

module.exports = { notificar };
