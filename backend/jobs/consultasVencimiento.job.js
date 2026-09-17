/**
 * consultasVencimiento.job.js
 * ────────────────────────────────────────────────────────────────────────────
 * CONSULTA AL CLIENTE — F5: vencimiento y recordatorios.
 *
 * Cada 15 minutos:
 *   1. Recordatorios al CLIENTE a las 4 h y a las 20 h de enviada la consulta.
 *   2. Las que pasaron el plazo (ConFechaVence) se marcan VENCIDA, la orden vuelve
 *      a estar trabajable y se le avisa AL OPERADOR con una nota de producción.
 *
 * VENCER NO CANCELA. Cancelar por silencio destruye ventas: el cliente pudo estar de
 * vacaciones o el aviso pudo caer en spam. La orden vuelve SIN la aprobación escrita y
 * una persona decide qué hacer. Ver docs/consultas-cliente-plan.md §4.
 *
 * El plazo sale de ConfiguracionGlobal.CONSULTA_SLA_HORAS (default 24). Con 0, las
 * consultas se crean sin ConFechaVence y este job no las toca nunca.
 * ────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { getPool } = require('../config/db');
const logger      = require('../utils/logger');
const svc         = require('../services/consultasClienteService');

const CADA_MINUTOS = 15;
const JOB_ID = 'consultas-vencimiento';

// ============================================================
// RECORDATORIOS AL CLIENTE
// ============================================================

async function mandarRecordatorios(pool) {
    const pendientes = await svc.getConsultasParaRecordar(pool);
    if (!pendientes.length) return 0;

    const push = require('../services/pushNotificationService');
    let enviados = 0;

    for (const c of pendientes) {
        try {
            const esUltimo = c.nivel >= svc.RECORDATORIOS_HORAS.length;
            await push.sendToOrderClient(c.OrdIdOrden, {
                title: esUltimo ? 'Tu pedido sigue frenado' : 'Te estamos esperando',
                body : esUltimo
                    ? `Necesitamos tu respuesta sobre ${c.CodigoOrden} para poder seguir. Si no contestamos hoy, el trabajo queda parado.`
                    : `Nos quedó una consulta sin responder sobre ${c.CodigoOrden}. Entrá y decidinos si seguimos.`,
                url  : '/portal/factory',
                // tag por NIVEL: si fuera solo por consulta, el segundo recordatorio
                // reemplazaría al primero en la bandeja en vez de sumarse.
                tag  : `consulta-${c.ConIdConsulta}-r${c.nivel}`,
            });
            // Se marca aunque el push falle: el aviso es best-effort y no se reintenta
            // en loop — si no, un cliente sin suscripción recibiría un intento cada 15 min.
            await svc.marcarRecordatorio(pool, c.ConIdConsulta, c.nivel);
            enviados++;
        } catch (e) {
            logger.warn(`[CONSULTA-VTO] Recordatorio ${c.nivel} de la consulta #${c.ConIdConsulta} falló: ${e.message}`);
            try { await svc.marcarRecordatorio(pool, c.ConIdConsulta, c.nivel); } catch (_) {}
        }
    }
    return enviados;
}

// ============================================================
// VENCIMIENTO
// ============================================================

async function vencerLasQueCorresponda(pool, io) {
    const vencidas = await svc.getConsultasVencidas(pool);
    if (!vencidas.length) return { vencidas: 0, codigos: [] };

    const codigos = [];
    for (const c of vencidas) {
        try {
            const r = await svc.vencerConsulta({ consultaId: c.ConIdConsulta, io });
            if (r.ok) codigos.push(c.CodigoOrden);
        } catch (e) {
            // Una consulta que falla no puede frenar a las demás.
            logger.error(`[CONSULTA-VTO] No se pudo vencer la consulta #${c.ConIdConsulta}: ${e.message}`);
        }
    }
    return { vencidas: codigos.length, codigos };
}

// ============================================================
// CORRIDA
// ============================================================

/** @returns {Promise<string>} resumen para la tarjeta de /admin/cron */
async function run(io = null) {
    const pool = await getPool();

    const recordatorios = await mandarRecordatorios(pool);
    const { vencidas, codigos } = await vencerLasQueCorresponda(pool, io);

    if (!recordatorios && !vencidas) return 'Sin consultas que recordar ni vencer.';

    const partes = [];
    if (recordatorios) partes.push(`${recordatorios} recordatorio(s) al cliente`);
    if (vencidas) partes.push(`${vencidas} vencida(s): ${codigos.join(', ')}`);
    const resumen = partes.join(' · ');
    logger.info(`[CONSULTA-VTO] ${resumen}`);
    return resumen;
}

// ============================================================
// ARRANQUE
// ============================================================

function startConsultasVencimientoJob(io) {
    const cron = require('node-cron');
    const reg  = require('./jobRegistry');

    if (!reg.getAll().some(j => j.id === JOB_ID)) {
        reg.registrar(JOB_ID, {
            nombre:      'Consultas al cliente — vencimiento',
            descripcion: 'Manda los recordatorios de las consultas sin responder (4 h y 20 h) y vence las que pasaron el plazo: la orden vuelve a estar trabajable y le queda una nota al operador. Vencer NO cancela.',
            schedule:    `Cada ${CADA_MINUTOS} minutos`,
        });
    }
    reg.setFn(JOB_ID, () => run(io));

    const ejecutar = async () => {
        reg.marcarInicio(JOB_ID);
        try {
            const resumen = await run(io);
            reg.marcarOk(JOB_ID, resumen);
        } catch (e) {
            reg.marcarError(JOB_ID, e);
            logger.error(`[CONSULTA-VTO] ❌ Error: ${e.message}`);
        }
        reg.setProximaEjecucion(JOB_ID, new Date(Date.now() + CADA_MINUTOS * 60000));
    };

    cron.schedule(`*/${CADA_MINUTOS} * * * *`, ejecutar, { timezone: 'America/Montevideo' });
    reg.setProximaEjecucion(JOB_ID, new Date(Date.now() + CADA_MINUTOS * 60000));
    logger.info(`⏱️ [CRON] Vencimiento de consultas al cliente activado: cada ${CADA_MINUTOS} min.`);
}

module.exports = { run, startConsultasVencimientoJob };
