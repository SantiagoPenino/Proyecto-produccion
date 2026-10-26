// Resumen diario del servidor por mail (23/10/2026): a las 08:00, cómo anduvo ayer. Cuánto tiempo hubo muestras
// del monitor (los huecos son caídas del backend o del servidor), los picos de CPU, RAM y swap, los pedidos y
// errores, los eventos, y el estado de hoy de backups, disco, certificado, jobs e integraciones.
// Sale de la historia en disco de monitorService. Va a ALERTAS_EMAIL (si no hay, no manda nada).
// Mismo patrón que solicitudesInsumo.job.js (setTimeout auto-reprogramado + jobRegistry).
const logger = require('../utils/logger');
const HORA = Number(process.env.MONITOR_RESUMEN_HORA) || 8, MINUTO = 0;
const ID = 'resumen-diario-servidor';

const esc = (t) => String(t ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const hora = (iso) => new Date(iso).toLocaleTimeString('es-UY', { timeZone: 'America/Montevideo', hour: '2-digit', minute: '2-digit' });

function armarHtml(r, m) {
    const fila = (k, v, alerta = false) => `<tr><td style="padding:4px 14px 4px 0;color:#71717a">${esc(k)}</td><td style="padding:4px 0;font-weight:bold;${alerta ? 'color:#BD0C7E' : ''}">${esc(v)}</td></tr>`;
    const filas = [
        fila('Monitor con muestras', `${r.cobertura} % del día`, r.cobertura < 99),
        fila('Caídas (huecos de más de 3 min)', r.huecos.length ? r.huecos.map(h => `${hora(h.desde)}–${hora(h.hasta)} (${h.minutos} min)`).join(', ') : 'ninguna', r.huecos.length > 0),
        fila('Pico de RAM en uso', r.maxMem != null ? `${r.maxMem} %` : '—', r.maxMem >= 90),
        fila('Pico de swap', r.maxSwap != null ? `${r.maxSwap} %` : '—', r.maxSwap >= 85),
        fila('Pico de CPU', r.maxCpu != null ? `${r.maxCpu} %` : '—'),
        fila('Red hacia internet', r.maxPerdida != null ? `pérdida máx. ${r.maxPerdida} % · latencia máx. ${r.maxPingMs ?? '—'} ms` : '—', r.maxPerdida >= 20),
        fila('Pedidos atendidos (aprox.)', r.pedidos.toLocaleString('es-UY')),
        fila('Errores 500', r.errores5xx.toLocaleString('es-UY'), r.errores5xx > 50),
        fila('Rechazos por límite (429)', r.rechazos429.toLocaleString('es-UY'), r.rechazos429 > 0),
        fila('Errores del front', r.erroresFront.toLocaleString('es-UY')),
    ];
    if (m) {
        filas.push(fila('Último backup', m.db.backupHaceMin != null ? `hace ${Math.round(m.db.backupHaceMin / 60)} h` : '—', m.db.backupHaceMin > 26 * 60));
        for (const d of m.discos) filas.push(fila(`Disco ${d.ruta}`, `${d.usadoPct} % · ${d.libreGB} GB libres${d.pronostico?.dias != null ? ` · se llena en ~${d.pronostico.dias} días` : ''}`, d.usadoPct >= 80));
        if (m.ssl) filas.push(fila(`Certificado ${m.ssl.host}`, `vence en ${m.ssl.dias} días`, m.ssl.dias < 15));
        const jobsMal = m.jobs.filter(j => j.estado === 'ERROR');
        filas.push(fila('Jobs con error', jobsMal.length ? jobsMal.map(j => j.nombre).join(', ') : 'ninguno', jobsMal.length > 0));
        const integMal = m.integraciones.filter(i => i.nivel === 'mal' || i.nivel === 'atencion');
        filas.push(fila('Integraciones con fallas', integMal.length ? integMal.map(i => i.nombre).join(', ') : 'ninguna', integMal.length > 0));
    }
    const evs = r.eventos.filter(e => e.nivel !== 'ok').slice(-15);
    return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#27272a">
        <h2 style="margin:0 0 10px;font-size:18px">Cómo anduvo el servidor el ${esc(r.fecha.split('-').reverse().join('/'))}</h2>
        <table style="border-collapse:collapse;font-size:13px">${filas.join('')}</table>
        ${evs.length ? `<h3 style="margin:16px 0 6px;font-size:14px">Eventos</h3><ul style="margin:0;padding-left:18px;font-size:13px">${evs.map(e => `<li>${esc(hora(e.ts))} · ${esc(e.texto)}</li>`).join('')}</ul>` : ''}
        <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa">Monitor: https://user.com.uy/admin/monitor</p>
    </div>`;
}

async function run() {
    const monitor = require('../services/monitorService');
    const avisos = require('../services/alertasService');
    if (!avisos.destinos().mails.length) return 'Sin ALERTAS_EMAIL: no se mandó';
    const ayer = monitor.fechaUY(new Date(Date.now() - 86400000));
    const r = monitor.resumenDia(ayer);
    if (!r.muestras) return `Sin muestras del ${ayer}: no se mandó`;
    const snap = monitor.snapshot();
    const html = armarHtml(r, snap.listo ? snap : null);
    const problemas = r.huecos.length + r.eventos.filter(e => e.nivel === 'mal').length;
    const asunto = `[RESUMEN] Servidor el ${ayer.split('-').reverse().join('/')}: ${problemas ? `${r.huecos.length} caída(s), ${r.eventos.filter(e => e.nivel === 'mal').length} problema(s)` : 'sin problemas'}`;
    await require('../services/emailService').sendMail(avisos.destinos().mails, asunto, html);
    const msg = `Resumen del ${ayer} enviado a ${avisos.destinos().mails.length} destinatario(s)`;
    logger.info(`[${ID}] ${msg}`);
    return msg;
}

function startResumenDiarioServidorJob() {
    const reg = require('./jobRegistry');
    if (!reg.getAll().some(j => j.id === ID)) {
        reg.registrar(ID, {
            nombre: 'Resumen diario del servidor',
            descripcion: 'Manda por mail (ALERTAS_EMAIL) cómo anduvo el servidor ayer: caídas, picos de RAM/CPU/swap, errores, backups, disco, certificado, jobs e integraciones.',
            schedule: `${String(HORA).padStart(2, '0')}:${String(MINUTO).padStart(2, '0')} hs diarios`,
        });
    }
    reg.setFn(ID, run);
    const ejecutar = async () => {
        reg.marcarInicio(ID);
        try { reg.marcarOk(ID, await run()); }
        catch (e) { reg.marcarError(ID, e); logger.error(`[${ID}] ❌ Error:`, e.message); }
    };
    function programar() {
        const ahora = new Date();
        const proxima = new Date(ahora);
        proxima.setHours(HORA, MINUTO, 0, 0);
        if (proxima <= ahora) proxima.setDate(proxima.getDate() + 1);
        const ms = proxima - ahora;
        reg.setProximaEjecucion(ID, proxima);
        logger.info(`⏱️ [${ID}] Próxima corrida ${proxima.toLocaleString('es-UY')} (en ${Math.round(ms / 60000)} min).`);
        setTimeout(async () => { await ejecutar(); programar(); }, ms);
    }
    programar();
}

module.exports = { run, startResumenDiarioServidorJob, armarHtml };
