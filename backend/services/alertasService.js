'use strict';
// Avisos por mail y WhatsApp de lo grave que detecta el monitor del servidor (23/10/2026). Lo llama monitorService
// cuando una alerta aparece o empeora, y cuando se normaliza una que se avisó.
//
// Qué se avisa: todo lo «mal» (base caída, RAM < 10 %, disco ≥ 90 %, un python de más de 8 GB…) y, de lo que es
// «atención», solo lo que no se arregla solo: jobs que fallan, backup viejo, certificado por vencer, disco ≥ 80 %,
// swap llena, ráfagas de errores 500 o de 429, integraciones que dejaron de andar, el monitor externo sin latido,
// posible fuerza bruta en el login, un servicio cerca de su tope de RAM y pérdida de paquetes hacia internet.
// Lo demás queda en la pantalla. Los OOM del kernel y los reinicios de un contenedor (el de SQL) los manda directo
// monitorService (mandar), uno por cada uno.
//
// Destinatarios en el .env: ALERTAS_EMAIL (mails separados por coma) y ALERTAS_WHATSAPP (números con código de
// país, separados por coma; necesita CALLBELL_ALERTA_TEMPLATE_UUID: una plantilla de Callbell con UNA variable).
// Sin destinatarios no se manda nada. No repite el mismo aviso: 30 min para lo «mal», 6 h para lo de «atención»;
// lo último enviado queda en LOGS_PATH/monitor/alertas-enviadas.json, así un reinicio no vuelve a mandar todo.
// Este aviso sale del propio servidor: si el servidor se cae entero, el que avisa es el monitor externo
// (herramientas/monitor-externo, en una PC de la oficina).
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

const PUSH_ATENCION = /^(job:|backup$|ssl$|disco:|swap$|http5xx$|r429$|integ:|externo$|fuerza:|servicio:|red$)/;
const ESPERA_MS = { mal: 30 * 60 * 1000, atencion: 6 * 3600 * 1000 };
const RUTA = path.join(process.env.LOGS_PATH || path.join(__dirname, '..', 'logs'), 'monitor', 'alertas-enviadas.json');

let enviadas = {};             // clave → { ts, nivel, normalizado }
try { enviadas = JSON.parse(fs.readFileSync(RUTA, 'utf8')); } catch (_) { /* primera vez */ }
const guardar = () => {
    try { fs.mkdirSync(path.dirname(RUTA), { recursive: true }); fs.writeFileSync(RUTA, JSON.stringify(enviadas)); } catch (_) { /* sin disco */ }
};

const lista = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
const destinos = () => ({ mails: lista(process.env.ALERTAS_EMAIL), numeros: lista(process.env.ALERTAS_WHATSAPP) });

function correspondeAvisar(alerta) {
    return alerta.nivel === 'mal' || (alerta.nivel === 'atencion' && PUSH_ATENCION.test(alerta.clave));
}

const esc = (t) => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function cuerpoHtml(titulo, texto, m) {
    const filas = [];
    if (m) {
        const h = m.host;
        filas.push(['RAM', `${Math.round((1 - h.mem.disponibleMB / h.mem.totalMB) * 100)} % en uso (${(h.mem.disponibleMB / 1024).toFixed(1)} GB libres)`]);
        filas.push(['CPU', h.cpu.pct != null ? `${Math.round(h.cpu.pct)} %` : '—']);
        if (h.swap) filas.push(['Swap', `${Math.round(h.swap.usadaMB / h.swap.totalMB * 100)} %`]);
        filas.push(['Base de datos', m.db.ok ? `responde en ${m.db.ms} ms` : `NO RESPONDE: ${m.db.error}`]);
        for (const p of (m.procesos || []).slice(0, 3)) filas.push([`Proceso ${p.nombre}${p.detalle ? ` · ${p.detalle}` : ''}`, `${(p.rssMB / 1024).toFixed(1)} GB`]);
    }
    return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#27272a">
        <h2 style="margin:0 0 8px;font-size:18px">${esc(titulo)}</h2>
        <p style="margin:0 0 12px">${esc(texto)}</p>
        ${filas.length ? `<table style="border-collapse:collapse;font-size:13px">${filas.map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#71717a">${esc(k)}</td><td style="padding:3px 0;font-weight:bold">${esc(v)}</td></tr>`).join('')}</table>` : ''}
        <p style="margin:14px 0 0;font-size:12px;color:#a1a1aa">Monitor: https://user.com.uy/admin/monitor · ${esc(new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' }))}</p>
    </div>`;
}

async function enviarWhatsApp(numeros, texto) {
    const { CALLBELL_API_KEY, CALLBELL_CHANNEL_UUID, CALLBELL_ALERTA_TEMPLATE_UUID } = process.env;
    if (!numeros.length || !CALLBELL_API_KEY || !CALLBELL_CHANNEL_UUID || !CALLBELL_ALERTA_TEMPLATE_UUID) return;
    for (const to of numeros) {
        await axios.post('https://api.callbell.eu/v1/messages/send', {
            to, from: 'whatsapp', type: 'text', channel_uuid: CALLBELL_CHANNEL_UUID, content: { text: texto },
            template_uuid: CALLBELL_ALERTA_TEMPLATE_UUID, template_values: [texto], optin_contact: true,
        }, { headers: { Authorization: `Bearer ${CALLBELL_API_KEY}` }, timeout: 15000 });
    }
}

async function mandar(titulo, texto, m) {
    const { mails, numeros } = destinos();
    if (!mails.length && !numeros.length) return false;
    try {
        if (mails.length) await require('./emailService').sendMail(mails, titulo, cuerpoHtml(titulo, texto, m));
    } catch (e) { logger.warn(`[ALERTAS] no se pudo mandar el mail: ${e.message}`); }
    try {
        await enviarWhatsApp(numeros, `${titulo}. ${texto}`.slice(0, 900));
    } catch (e) { logger.warn(`[ALERTAS] no se pudo mandar el WhatsApp: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`); }
    logger.info(`[ALERTAS] ${titulo}`);
    return true;
}

/** Una alerta nueva o que empeoró. m = la muestra del monitor (para el detalle del mail). */
async function alerta(a, m) {
    if (!correspondeAvisar(a)) return;
    const previa = enviadas[a.clave];
    if (previa && !previa.normalizado && previa.nivel === a.nivel && Date.now() - previa.ts < ESPERA_MS[a.nivel]) return;
    const titulo = `[${a.nivel === 'mal' ? 'ALERTA' : 'ATENCIÓN'}] ${a.texto}`;
    if (await mandar(titulo, `${a.texto}.`, m)) {
        enviadas[a.clave] = { ts: Date.now(), nivel: a.nivel, normalizado: false };
        guardar();
    }
}

/** Se normalizó algo: solo se avisa si se había avisado que estaba mal. */
async function normalizado(clave, texto, m) {
    const previa = enviadas[clave];
    if (!previa || previa.normalizado) return;
    if (await mandar(`[NORMAL] ${texto}`, `Se normalizó: ${texto}.`, m)) {
        enviadas[clave] = { ...previa, normalizado: true, tsNormal: Date.now() };
        guardar();
    }
}

module.exports = { alerta, normalizado, mandar, destinos };
