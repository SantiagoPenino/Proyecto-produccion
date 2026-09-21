/**
 * telaClienteExcedente.job.js
 * ────────────────────────────────────────────────────────────────────────────
 * TELA DE CLIENTE — detección de excedente para avisar al cliente.
 *
 * Una vez al día busca bobinas Disponibles con MENOS metros que el umbral
 * configurado (ConfiguracionGlobal.TELA_CLIENTE_UMBRAL_AVISO_METROS) y sin
 * decisión de excedente tomada, y les crea un AVISO_EXCEDENTE en la bandeja
 * (TelaClienteEventos). Es un retazo chico (por debajo del umbral) que ya no
 * rinde para otra orden — momento de preguntarle al cliente qué hacer. Un
 * remanente grande NO entra: se asume que todavía sirve para más pedidos.
 *
 * Corre una sola vez por día. Antes de buscar candidatas nuevas, refresca las
 * PENDIENTE que ya existen: si la bobina dejó de calificar (se consumió,
 * "Queda para otra orden", o volvió a tener un remanente grande) el aviso se
 * cierra solo — así no se acumulan avisos viejos que ya no aplican. Las que
 * siguen calificando se actualizan con el remanente actual. Lo ya
 * aprobado/enviado/resuelto nunca se toca — es historial.
 *
 * Este job NO manda el WhatsApp — deja la candidata en la bandeja para que
 * alguien la revise y avise a mano (todavía no hay plantilla de Callbell
 * aprobada para este mensaje).
 *
 * Además, cada corrida insiste: mientras un AVISO_EXCEDENTE siga PENDIENTE
 * manda un push de recordatorio cada TELA_CLIENTE_RECORDATORIO_DIAS (sin
 * límite de tiempo), y a los TELA_CLIENTE_ESCALADO_DIAS lo marca "Escalado"
 * para que atención al cliente lo llame — nunca se auto-decide nada en
 * nombre del cliente.
 * ────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { getPool } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/telaClienteDevolucionFisicaService');

const HORA_CORRIDA = '0 8 * * *'; // 08:00 todos los días
const JOB_ID = 'tela-cliente-excedente';

async function run() {
    const pool = await getPool();
    const { cerrados, actualizados } = await svc.refrescarAvisosPendientes(pool);
    const { candidatas, creados } = await svc.detectarCandidatosExcedente(pool);
    const { escalados, recordados } = await svc.procesarRecordatoriosYEscalado(pool);

    const partes = [];
    if (creados) partes.push(`${creados} aviso(s) nuevo(s)`);
    if (actualizados) partes.push(`${actualizados} actualizado(s)`);
    if (cerrados) partes.push(`${cerrados} cerrado(s) por no calificar más`);
    if (recordados) partes.push(`${recordados} recordatorio(s)`);
    if (escalados) partes.push(`${escalados} escalado(s) a atención al cliente`);
    if (!partes.length) return 'Sin novedades.';
    const resumen = partes.join(', ') + ` (de ${candidatas} candidata(s) revisada(s)).`;
    logger.info(`[TELA-CLIENTE-EXCEDENTE] ${resumen}`);
    return resumen;
}

function proximaCorridaA(hora, minuto) {
    const ahora = new Date();
    const prox = new Date(ahora);
    prox.setHours(hora, minuto, 0, 0);
    if (prox <= ahora) prox.setDate(prox.getDate() + 1);
    return prox;
}

function startTelaClienteExcedenteJob() {
    const cron = require('node-cron');
    const reg = require('./jobRegistry');

    if (!reg.getAll().some(j => j.id === JOB_ID)) {
        reg.registrar(JOB_ID, {
            nombre: 'Tela de cliente — excedente',
            descripcion: 'Una vez al día detecta bobinas de tela de cliente con un remanente chico (por debajo del umbral configurado) y las deja en la bandeja para avisarle al cliente.',
            schedule: 'Todos los días a las 08:00',
        });
    }
    reg.setFn(JOB_ID, run);

    const ejecutar = async () => {
        reg.marcarInicio(JOB_ID);
        try {
            const resumen = await run();
            reg.marcarOk(JOB_ID, resumen);
        } catch (e) {
            reg.marcarError(JOB_ID, e);
            logger.error(`[TELA-CLIENTE-EXCEDENTE] ❌ Error: ${e.message}`);
        }
        reg.setProximaEjecucion(JOB_ID, proximaCorridaA(8, 0));
    };

    cron.schedule(HORA_CORRIDA, ejecutar, { timezone: 'America/Montevideo' });
    reg.setProximaEjecucion(JOB_ID, proximaCorridaA(8, 0));
    logger.info('⏱️ [CRON] Tela de cliente — excedente activado: todos los días a las 08:00.');
}

module.exports = { run, startTelaClienteExcedenteJob };
