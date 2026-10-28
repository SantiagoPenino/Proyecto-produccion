'use strict';
// Monitor del servidor en tiempo real (23/10/2026, después de las caídas por la red de Hostinger en BR-CAM).
// Toma una muestra cada 5 s aunque nadie mire, así la pantalla tiene 2 h de historia al abrirse y los cambios de
// estado quedan como eventos (y en el log). Lo sirve GET /api/sysadmin/monitor; la pantalla es /admin/monitor.
//
// Qué mide (lo de Linux, en el servidor; en Windows de desarrollo esos datos vienen en null):
//   - host: CPU, RAM disponible (MemAvailable), swap, carga, discos de / y /home (con pronóstico de cuándo se llenan);
//   - Node: memoria del proceso, demora del event loop, reinicios de pm2;
//   - SQL: latencia de SELECT 1, sesiones, bloqueadas, transacciones abiertas dormidas, consulta más larga, memoria
//     del motor y el último backup completo (necesita VIEW SERVER STATE y msdb: si no hay permiso, null);
//   - HTTP: pedidos, errores 500 y rechazos 429 por minuto (con las IP que más rechazos se llevan), latencia
//     promedio y p95 (lo alimenta middleware/requestLogger); errores del front por minuto (POST /api/client-error);
//   - versión del front: la deployada (meta build-id de public/index.html) y la que usa cada navegador (header
//     X-Front-Build), para ver quién quedó con una versión vieja después de un deploy;
//   - procesos que más memoria usan (ps), con los python a la vista: fueron los que llenaron la RAM el 21 y 22/10.
//     Nunca se devuelven los argumentos completos (pueden traer contraseñas): solo el nombre y el script;
//   - jobs del jobRegistry, usuarios conectados por socket, certificado SSL e integraciones (saludIntegraciones).
//   - disco y red: espera de disco (iowait), CPU que nos saca el host (steal), MB/s leídos y escritos, % de uso del
//     disco y Mbps de entrada y salida (lo que en la caída del 23/10 no se veía);
//   - sistema: los OOM del kernel de los últimos 7 días, los últimos arranques del servidor (y si se apagó bien) y
//     del backend, y los últimos 3 backups completos;
//   - latido del monitor externo (herramientas/monitor-externo, en una PC de la oficina): si deja de llegar, el que
//     vigila desde afuera no está vigilando;
//   - colas de procesos pesados (colaProcesos): blanco DTF, matriz TPU y quitar fondo;
//   - rutas de la API más lentas y con más errores 500 de los últimos 15 min;
//   - bloqueos de SQL con detalle (quién bloquea a quién, qué consulta, desde cuándo), transacciones abiertas
//     dormidas y las consultas en curso que más CPU consumen;
//   - seguridad: logins fallidos de la app y del portal (por IP), y en Linux los intentos fallidos por SSH, lo que
//     bloquea el firewall (UFW) y fail2ban;
//   - marcas para los gráficos: reinicios del backend, deploys del front (cambio del build-id) y OOM;
//   - servicios del servidor (systemd: nginx y tizadapro; Docker: el contenedor sqlserver): si están arriba, su RAM
//     contra su tope y si se reiniciaron;
//   - errores del backend de la última hora agrupados por mensaje (los que pasan por el logger);
//   - red hacia afuera: ping a internet y a la PC de la oficina, con latencia y pérdida de paquetes.
// Acciones (con confirmación en la pantalla y en la auditoría): terminar un python desbocado y cortar una sesión de
// SQL que bloquea o tiene una transacción colgada. El reinicio del backend es el de siempre (POST /restart).
// Historia en disco: una muestra por minuto en LOGS_PATH/monitor/AAAA-MM-DD.jsonl (8 días), más los eventos; de ahí
// salen los gráficos de 24 h / 7 días, la disponibilidad de 7 días, el pronóstico del disco y el resumen diario.
// Los avisos por mail/WhatsApp de lo grave los manda alertasService. Apagado: MONITOR_ENABLED=0.
const os = require('os');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { execFile } = require('child_process');
const { monitorEventLoopDelay } = require('perf_hooks');
const logger = require('../utils/logger');

const CADA_MS = 5000;
const PUNTOS = 1440;                    // 2 h de historia en memoria, a 5 s
const ES_LINUX = os.platform() === 'linux';
const SSL_HOST = process.env.MONITOR_SSL_HOST || 'user.com.uy';
const MB = 1024 * 1024;
const DIR_LOGS = process.env.LOGS_PATH || path.join(__dirname, '..', 'logs');
const DIR_HISTORIA = path.join(DIR_LOGS, 'monitor');
const DIAS_HISTORIA = 8;
const INDEX_HTML = path.join(__dirname, '..', 'public', 'index.html');

let io = null;
let arrancado = false;
let tick = 0;
let ultimo = null;                       // la última muestra completa
const historia = { ts: [], cpu: [], memPct: [], swapPct: [], dbMs: [], reqMin: [], err5xx: [], lag: [], iowait: [], redEntra: [], redSale: [], pingMs: [], pingPerdida: [] };
const eventos = [];                      // los últimos 60 cambios de estado
const estadoAlertas = new Map();         // clave → nivel ('atencion' | 'mal')

// Fecha de Uruguay (AAAA-MM-DD) para nombrar los archivos de historia
const fechaUY = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// ─── HTTP, 429, errores del front y versión de cada navegador (lo cuenta requestLogger) ─────────────────────────
const acum = { n: 0, e5: 0, e4: 0, r429: 0, ef: 0, ms: 0, duraciones: [] };
const ventanaHttp = [];                  // una entrada por muestra: { n, e5, e4, r429, ef, ms, p95 }
const rechazos429 = [];                  // { t, ip } de los últimos 15 min
const navegadores = new Map();           // usuario o IP → { build, t } (los últimos 10 min)
const bucketsRutas = [];                 // un balde por minuto (15): { minuto, rutas: Map(ruta → { n, ms, e5, durs }) }
const loginsFallidos = [];               // { t, ip, usuario, sistema } de los últimos 15 min
const RUTAS_LOGIN = { '/api/auth/login': 'interno', '/api/web-auth/login': 'portal' };

// /api/ordenes/12345/archivos?x=1 → /api/ordenes/:id/archivos (ids, códigos de orden, uuids y tokens)
const normalizarRuta = (url) => String(url || '').split('?')[0]
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:uuid')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[A-Za-z]{2,5}-\d+[A-Za-z0-9-]*(?=\/|$)/g, '/:codigo')
    .replace(/\/[^/]{28,}(?=\/|$)/g, '/:token')
    .slice(0, 120);

// Subidas de archivos (multipart, 26/10): una ruta que recibió alguna en los 15 min va aparte, con MB/s, y no
// entre las lentas: ahí estaba siempre /api/web-orders/upload-stream, porque tarda lo que pesa el archivo (casi
// todo es la subida a Drive). Los MB/s son del servidor: la subida del cliente no se ve, la recibe nginx antes.
function anotarRuta(url, status, ms, extra = {}) {
    const minuto = Math.floor(Date.now() / 60000);
    let b = bucketsRutas[bucketsRutas.length - 1];
    if (!b || b.minuto !== minuto) {
        b = { minuto, rutas: new Map() };
        bucketsRutas.push(b);
        while (bucketsRutas.length > 15) bucketsRutas.shift();
    }
    const ruta = normalizarRuta(url);
    const r = b.rutas.get(ruta) || { n: 0, ms: 0, e5: 0, durs: [], subidas: 0, bytes: 0, msSubidas: 0 };
    r.n++; r.ms += ms;
    if (status >= 500) r.e5++;
    if (r.durs.length < 200) r.durs.push(ms);
    if (extra.multipart) {
        r.subidas++;
        if (extra.bytes > 0 && status < 400) { r.bytes += extra.bytes; r.msSubidas += ms; }
    }
    b.rutas.set(ruta, r);
}

function rutasTop() {
    const desde = Math.floor(Date.now() / 60000) - 15;
    const total = new Map();
    for (const b of bucketsRutas) {
        if (b.minuto <= desde) continue;
        for (const [ruta, r] of b.rutas) {
            const t = total.get(ruta) || { n: 0, ms: 0, e5: 0, durs: [], subidas: 0, bytes: 0, msSubidas: 0 };
            t.n += r.n; t.ms += r.ms; t.e5 += r.e5; t.durs.push(...r.durs);
            t.subidas += r.subidas; t.bytes += r.bytes; t.msSubidas += r.msSubidas;
            total.set(ruta, t);
        }
    }
    const filas = [...total.entries()].map(([ruta, t]) => {
        const d = t.durs.sort((a, b) => a - b);
        return {
            ruta, n: t.n, e5: t.e5, prom: Math.round(t.ms / t.n), p95: d.length ? d[Math.floor(d.length * 0.95)] : 0,
            subidas: t.subidas, mb: Math.round(t.bytes / MB), mbps: t.msSubidas > 0 ? Math.round(t.bytes / MB / (t.msSubidas / 1000) * 10) / 10 : null,
        };
    });
    return {
        lentas: filas.filter(f => f.n >= 3 && !f.subidas).sort((a, b) => b.p95 - a.p95).slice(0, 12),
        conErrores: filas.filter(f => f.e5 > 0).sort((a, b) => b.e5 - a.e5).slice(0, 12),
        subidas: filas.filter(f => f.subidas).sort((a, b) => b.mb - a.mb || b.subidas - a.subidas).slice(0, 6)
            .map(f => ({ ruta: f.ruta, n: f.subidas, mb: f.mb, mbps: f.mbps, p95: f.p95 })),
    };
}

function resumenLogins() {
    const hace15 = Date.now() - 15 * 60000;
    while (loginsFallidos.length && loginsFallidos[0].t < hace15) loginsFallidos.shift();
    const porIp = new Map();
    for (const l of loginsFallidos) {
        const x = porIp.get(l.ip) || { ip: l.ip, cantidad: 0, usuarios: new Set(), sistemas: new Set() };
        x.cantidad++; if (l.usuario) x.usuarios.add(l.usuario); x.sistemas.add(l.sistema);
        porIp.set(l.ip, x);
    }
    return {
        total: loginsFallidos.length,
        porIp: [...porIp.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 5)
            .map(x => ({ ip: x.ip, cantidad: x.cantidad, usuarios: [...x.usuarios].slice(0, 3), sistemas: [...x.sistemas] })),
    };
}

function registrarHttp(status, ms, url, extra = {}) {
    if (String(url || '').startsWith('/api/sysadmin/monitor')) return;   // la propia pantalla no cuenta
    const sinQuery = String(url || '').split('?')[0];
    if (sinQuery.startsWith('/api/')) anotarRuta(sinQuery, status, ms, extra);
    if (RUTAS_LOGIN[sinQuery] && (status === 401 || status === 403)) {
        loginsFallidos.push({ t: Date.now(), ip: String(extra.ip || '').replace(/^::ffff:/, '') || '?', usuario: extra.loginUsuario ? String(extra.loginUsuario).trim().slice(0, 60) : null, sistema: RUTAS_LOGIN[sinQuery] });
    }
    acum.n++;
    acum.ms += ms;
    if (status >= 500) acum.e5++;
    else if (status >= 400) acum.e4++;
    if (status === 429) {
        acum.r429++;
        rechazos429.push({ t: Date.now(), ip: String(extra.ip || '').replace(/^::ffff:/, '') || '?' });
    }
    if (acum.duraciones.length < 5000) acum.duraciones.push(ms);
    if (extra.build) navegadores.set(String(extra.usuario || extra.ip || '?'), { build: String(extra.build).slice(0, 40), t: Date.now() });
}
function registrarErrorFront() { acum.ef++; }

// Errores del backend de la última hora, agrupados por mensaje (los números y los códigos de orden no cuentan para
// agrupar). Salen del logger, o sea lo mismo que va a error-*.log, menos los [HTTP] (ya están en las rutas) y los
// [FRONTEND_ERROR] (se cuentan aparte). Al arrancar se lee la última hora del archivo: un reinicio no los borra.
const erroresLog = [];                   // { t, clave } de la última hora (hasta 5000)
const textoErrores = new Map();          // clave → { texto, t }: el último texto completo de cada grupo
const IGNORAR_ERROR = /^\s*\[(HTTP|FRONTEND_ERROR)\]/;
const limpiarError = (t) => String(t ?? '').split('\n')[0].replace(/[A-Za-z0-9_+=-]{40,}/g, '[…]').replace(/\s+/g, ' ').trim().slice(0, 300);
const claveError = (t) => t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '·')
    .replace(/\b[A-Z]{1,6}-\d+(?:-[A-Z0-9]+)*\b/g, '·').replace(/\d+/g, '#').slice(0, 160);
function anotarError(texto, t = Date.now()) {
    const limpio = limpiarError(texto);
    if (!limpio || IGNORAR_ERROR.test(limpio)) return;
    const clave = claveError(limpio);
    erroresLog.push({ t, clave });
    if (erroresLog.length > 5000) erroresLog.splice(0, erroresLog.length - 5000);
    const previo = textoErrores.get(clave);
    if (!previo || previo.t <= t) textoErrores.set(clave, { texto: limpio, t });
}
function erroresTop() {
    const desde = Date.now() - 3600000;
    while (erroresLog.length && erroresLog[0].t < desde) erroresLog.shift();
    const cuenta = new Map();
    for (const e of erroresLog) {
        const x = cuenta.get(e.clave) || { n: 0, ultimo: 0 };
        x.n++;
        if (e.t > x.ultimo) x.ultimo = e.t;
        cuenta.set(e.clave, x);
    }
    for (const k of textoErrores.keys()) if (!cuenta.has(k)) textoErrores.delete(k);
    const lista = [...cuenta].map(([clave, x]) => ({ texto: textoErrores.get(clave)?.texto || clave, n: x.n, ultimo: new Date(x.ultimo).toISOString() }))
        .sort((a, b) => b.n - a.n || Date.parse(b.ultimo) - Date.parse(a.ultimo));
    return { total: erroresLog.length, tipos: lista.length, top: lista.slice(0, 15) };
}
// Lo que se loguea como error de acá en más llega por un transport más del logger
function engancharLogger() {
    try {
        const winston = require('winston');
        const SPLAT = Symbol.for('splat');
        class AlMonitor extends winston.Transport {
            log(info, listo) {
                try {
                    const sueltos = (info[SPLAT] || []).filter(a => a !== null && a !== undefined && typeof a !== 'object');
                    anotarError([info.message, ...sueltos].join(' '));
                } catch (_) { /* que el log nunca falle por el monitor */ }
                listo();
            }
        }
        logger.add(new AlMonitor({ level: 'error' }));
    } catch (e) { logger.warn('[MONITOR] no se pudieron enganchar los errores del log: ' + e.message); }
}
// La última hora que ya está en error-*.log (los 2 archivos más nuevos, los últimos 2 MB de cada uno)
function cargarErroresDelArchivo() {
    try {
        const desde = Date.now() - 3600000;
        const archivos = fs.readdirSync(DIR_LOGS).filter(f => /^error-\d{4}-\d{2}-\d{2}\.log(\.\d+)?$/.test(f))
            .map(f => ({ f, st: fs.statSync(path.join(DIR_LOGS, f)) })).filter(x => x.st.mtimeMs >= desde)
            .sort((a, b) => a.st.mtimeMs - b.st.mtimeMs).slice(-2);
        for (const { f, st } of archivos) {
            const leer = Math.min(st.size, 2 * MB);
            const fd = fs.openSync(path.join(DIR_LOGS, f), 'r');
            const buf = Buffer.alloc(leer);
            try { fs.readSync(fd, buf, 0, leer, st.size - leer); } finally { fs.closeSync(fd); }
            for (const l of buf.toString('utf8').split('\n')) {
                // «26/10/2026 03:00:44 [ERROR] mensaje {json}»: la hora es la local del servidor
                const m = l.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2}) \[ERROR\] (.*)$/);
                if (!m) continue;
                const t = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]).getTime();
                if (t < desde || t > Date.now() + 60000) continue;
                const i = m[7].indexOf(' {"');     // lo que el logger agrega como JSON (stack, código) no es parte del mensaje
                anotarError(i > 0 ? m[7].slice(0, i) : m[7], t);
            }
        }
        erroresLog.sort((a, b) => a.t - b.t);
    } catch (e) { logger.warn('[MONITOR] no se pudo leer la última hora de errores: ' + e.message); }
}

function cerrarVentanaHttp() {
    const d = acum.duraciones.sort((a, b) => a - b);
    ventanaHttp.push({ n: acum.n, e5: acum.e5, e4: acum.e4, r429: acum.r429, ef: acum.ef, ms: acum.ms, p95: d.length ? d[Math.floor(d.length * 0.95)] : 0 });
    if (ventanaHttp.length > 12) ventanaHttp.shift();                    // 12 × 5 s = el último minuto
    Object.assign(acum, { n: 0, e5: 0, e4: 0, r429: 0, ef: 0, ms: 0, duraciones: [] });
    const suma = (k) => ventanaHttp.reduce((s, v) => s + v[k], 0);
    const factor = 60000 / (ventanaHttp.length * CADA_MS);
    const n = suma('n');
    const hace15 = Date.now() - 15 * 60000;
    while (rechazos429.length && rechazos429[0].t < hace15) rechazos429.shift();
    const porIp = {};
    for (const r of rechazos429) porIp[r.ip] = (porIp[r.ip] || 0) + 1;
    return {
        porMin: Math.round(n * factor),
        errores5xxPorMin: Math.round(suma('e5') * factor),
        errores4xxPorMin: Math.round(suma('e4') * factor),
        r429PorMin: Math.round(suma('r429') * factor),
        erroresFrontPorMin: Math.round(suma('ef') * factor),
        msProm: n ? Math.round(suma('ms') / n) : 0,
        msP95: Math.max(0, ...ventanaHttp.map(v => v.p95)),
        top429: Object.entries(porIp).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([ip, cantidad]) => ({ ip, cantidad })),
    };
}

let buildDeployado = null;
const RUTA_DEPLOYS = path.join(DIR_HISTORIA, 'deploys.jsonl');
function leerBuildDeployado() {
    try {
        const html = fs.readFileSync(INDEX_HTML, 'utf8');
        const m = html.match(/<meta name="build-id" content="([^"]+)"/);
        buildDeployado = m ? m[1] : null;
        // Cambió el build: quedó un deploy del front, con la hora en que se subió el index.html
        if (buildDeployado) {
            let ultimoBuild = null;
            try { ultimoBuild = JSON.parse(fs.readFileSync(RUTA_DEPLOYS, 'utf8').trim().split('\n').pop()).build; } catch (_) { /* primera vez */ }
            if (ultimoBuild !== buildDeployado) {
                fs.mkdirSync(DIR_HISTORIA, { recursive: true });
                fs.appendFileSync(RUTA_DEPLOYS, JSON.stringify({ t: fs.statSync(INDEX_HTML).mtimeMs, build: buildDeployado }) + '\n');
                marcasCache = null;
            }
        }
    } catch (_) { buildDeployado = null; }
}

// Marcas para los gráficos (7 días): reinicios del backend, deploys del front y OOM del kernel
let marcasCache = null;
function calcularMarcas() {
    const desde = Date.now() - 7 * 86400000;
    const leer = (archivo) => { try { return fs.readFileSync(path.join(DIR_HISTORIA, archivo), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean); } catch (_) { return []; } };
    marcasCache = [
        ...leer('arranques-backend.jsonl').filter(x => x.t >= desde).map(x => ({ t: x.t, tipo: 'reinicio' })),
        ...leer('deploys.jsonl').filter(x => x.t >= desde).map(x => ({ t: x.t, tipo: 'deploy' })),
        ...((sistemaCache?.oom) || []).map(o => ({ t: Date.parse(o.ts), tipo: 'oom', detalle: `${o.proceso} ${o.rssGB} GB` })),
    ].sort((a, b) => a.t - b.t);
}
function resumenFront() {
    const hace10 = Date.now() - 10 * 60000;
    for (const [k, v] of navegadores) if (v.t < hace10) navegadores.delete(k);
    let alDia = 0, viejos = 0;
    for (const v of navegadores.values()) {
        if (!buildDeployado || v.build === buildDeployado) alDia++;
        else viejos++;
    }
    return { deployado: buildDeployado, navegadoresAlDia: alDia, navegadoresViejos: buildDeployado ? viejos : null };
}

// ─── Host ─────────────────────────────────────────────────────────────────────────────────────────────────────
let cpuAnterior = null;
function cpuPct() {
    const t = os.cpus().reduce((acc, c) => {
        const total = Object.values(c.times).reduce((a, b) => a + b, 0);
        return { total: acc.total + total, idle: acc.idle + c.times.idle };
    }, { total: 0, idle: 0 });
    const prev = cpuAnterior;
    cpuAnterior = t;
    if (!prev || t.total === prev.total) return null;
    return Math.round((1 - (t.idle - prev.idle) / (t.total - prev.total)) * 1000) / 10;
}

function memoria() {
    if (ES_LINUX) {
        try {
            const m = {};
            for (const l of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
                const x = l.match(/^(\w+):\s+(\d+)/);
                if (x) m[x[1]] = Number(x[2]) * 1024;
            }
            return {
                mem: { totalMB: Math.round(m.MemTotal / MB), disponibleMB: Math.round(m.MemAvailable / MB) },
                swap: m.SwapTotal ? { totalMB: Math.round(m.SwapTotal / MB), usadaMB: Math.round((m.SwapTotal - m.SwapFree) / MB) } : null,
            };
        } catch (_) { /* cae a lo de os */ }
    }
    return { mem: { totalMB: Math.round(os.totalmem() / MB), disponibleMB: Math.round(os.freemem() / MB) }, swap: null };
}

// Disco y red (Linux). /proc/stat: iowait y steal (CPU que el host de Hostinger le saca a la máquina). /proc/diskstats:
// el disco con más actividad, sin particiones ni loops. /proc/net/dev: la interfaz con más tráfico, sin lo ni docker.
let ioPrevio = null;
// Steal del último minuto (26/10): el aviso usa este y no la muestra de 5 s. Al reiniciar pm2, o mientras corren las
// miniaturas, la máquina pide mucha CPU de golpe y el steal sube unos segundos: con una sola muestra el cartel iba y venía.
const ventanaCpu = [];
const esParticion = (n) => /^(sd|vd|xvd|hd)[a-z]+\d+$/.test(n) || /^(nvme\d+n\d+|mmcblk\d+)p\d+$/.test(n);
function leerIoRed() {
    if (!ES_LINUX) return { io: null, red: null };
    try {
        const cpu = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
        const cpuTotal = cpu.slice(0, 8).reduce((a, b) => a + b, 0);
        const disco = fs.readFileSync('/proc/diskstats', 'utf8').split('\n').map(l => l.trim().split(/\s+/))
            .filter(c => c.length > 13 && !/^(loop|ram|sr|dm-|zram)/.test(c[2]) && !esParticion(c[2]))
            .map(c => ({ nombre: c[2], leidos: Number(c[5]), escritos: Number(c[9]), ticks: Number(c[12]) }))
            .sort((a, b) => (b.leidos + b.escritos) - (a.leidos + a.escritos))[0];
        const iface = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2).map(l => l.trim()).filter(Boolean)
            .map(l => { const [n, resto] = l.split(':'); const v = resto.trim().split(/\s+/).map(Number); return { nombre: n.trim(), rx: v[0], tx: v[8] }; })
            .filter(i => !/^(lo|docker|veth|br-|virbr)/.test(i.nombre))
            .sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx))[0];
        const ahora = { t: Date.now(), cpu, cpuTotal, disco, iface };
        ventanaCpu.push({ t: ahora.t, steal: cpu[7] || 0, total: cpuTotal });
        while (ahora.t - ventanaCpu[0].t > 65000) ventanaCpu.shift();
        const base = ventanaCpu[0];
        const prev = ioPrevio;
        ioPrevio = ahora;
        if (!prev) return { io: null, red: null };
        const dt = (ahora.t - prev.t) / 1000;
        const dCpu = ahora.cpuTotal - prev.cpuTotal || 1;
        const io = {
            iowaitPct: Math.round((cpu[4] - prev.cpu[4]) / dCpu * 1000) / 10,
            stealPct: Math.round(((cpu[7] || 0) - (prev.cpu[7] || 0)) / dCpu * 1000) / 10,
            // null hasta tener un minuto de muestras (recién arrancado)
            stealMinutoPct: ahora.t - base.t >= 55000 && cpuTotal > base.total
                ? Math.round(((cpu[7] || 0) - base.steal) / (cpuTotal - base.total) * 1000) / 10 : null,
            dispositivo: disco?.nombre || null,
            leeMBs: disco && prev.disco ? Math.round((disco.leidos - prev.disco.leidos) * 512 / MB / dt * 10) / 10 : null,
            escribeMBs: disco && prev.disco ? Math.round((disco.escritos - prev.disco.escritos) * 512 / MB / dt * 10) / 10 : null,
            utilPct: disco && prev.disco ? Math.min(100, Math.round((disco.ticks - prev.disco.ticks) / (dt * 1000) * 100)) : null,
        };
        const red = iface && prev.iface ? {
            interfaz: iface.nombre,
            entraMbps: Math.round((iface.rx - prev.iface.rx) * 8 / 1e6 / dt * 100) / 100,
            saleMbps: Math.round((iface.tx - prev.iface.tx) * 8 / 1e6 / dt * 100) / 100,
        } : null;
        return { io, red };
    } catch (_) { return { io: null, red: null }; }
}

async function discos() {
    const rutas = ES_LINUX ? ['/', '/home'] : [path.parse(process.cwd()).root];
    const vistos = new Set();
    const salida = [];
    for (const ruta of rutas) {
        try {
            const st = await fs.promises.statfs(ruta);
            const firma = `${st.blocks}-${st.bsize}`;
            if (vistos.has(firma)) continue;                               // /home en el mismo disco que /
            vistos.add(firma);
            const total = st.blocks * st.bsize;
            const libre = st.bavail * st.bsize;
            salida.push({ ruta, totalGB: +(total / 1024 / MB).toFixed(1), libreGB: +(libre / 1024 / MB).toFixed(1), usadoPct: Math.round((1 - libre / total) * 100) });
        } catch (_) { /* ruta que no existe */ }
    }
    return salida;
}

const lagHist = monitorEventLoopDelay({ resolution: 20 });
lagHist.enable();

const ejecutar = (cmd, args, ms = 4000) => new Promise((ok) => {
    execFile(cmd, args, { timeout: ms, maxBuffer: 2 * MB, windowsHide: true }, (err, stdout) => ok(err ? null : stdout));
});
// Igual, pero si falla devuelve el motivo, para anotarlo en el log en vez de perderlo (26/10: el contenedor de SQL
// salía «sin dato» y no había forma de saber por qué). No se usa en los comandos que fallan como parte normal
// (grep o journalctl --grep sin coincidencias, el ping a un destino que no contesta).
const ejecutarConMotivo = (cmd, args, ms = 4000) => new Promise((ok) => {
    execFile(cmd, args, { timeout: ms, maxBuffer: 2 * MB, windowsHide: true }, (err, stdout, stderr) => ok(err
        ? { out: null, motivo: err.killed ? `no terminó en ${ms / 1000} s` : String(stderr || err.message).trim().split('\n')[0].slice(0, 200) }
        : { out: stdout, motivo: null }));
});
const yaAnotados = new Set();
const anotarUnaVez = (clave, texto) => { if (!yaAnotados.has(clave)) { yaAnotados.add(clave); logger.warn(texto); } };

// Procesos que más memoria usan. Solo nombre y script: los argumentos pueden traer contraseñas (el backup).
let procesosCache = null;
async function procesos() {
    if (!ES_LINUX) return null;
    const out = await ejecutar('ps', ['-eo', 'pid=,rss=,pcpu=,etimes=,comm=,args=', '--sort=-rss']);
    if (!out) return null;
    return out.trim().split('\n').slice(0, 12).map((l) => {
        const c = l.trim().split(/\s+/);
        const [pid, rss, pcpu, etimes, comm] = c;
        const args = c.slice(5);
        let detalle = '';
        if (/^python/.test(comm)) detalle = path.basename(args.find(a => /\.py$/.test(a)) || '');
        else if (/^node/.test(comm) || comm === 'PM2') detalle = path.basename(args.find(a => /\.(c?js|mjs)$/.test(a)) || '');
        const nombre = comm === 'sqlservr' ? 'SQL Server' : comm;
        return { pid: Number(pid), nombre, detalle, rssMB: Math.round(Number(rss) / 1024), cpu: Number(pcpu), segundos: Number(etimes), python: /^python/.test(comm) };
    });
}

let pm2Cache = null;
async function pm2() {
    const out = await ejecutar('pm2', ['jlist'], 8000);
    if (!out) return null;
    try {
        const lista = JSON.parse(out.slice(out.indexOf('[')));
        return lista.map(p => ({ nombre: p.name, estado: p.pm2_env?.status, reinicios: p.pm2_env?.restart_time || 0, memMB: Math.round((p.monit?.memory || 0) / MB) }));
    } catch (_) { return null; }
}

let sslCache = null;
function ssl() {
    return new Promise((ok) => {
        const s = tls.connect({ host: SSL_HOST, port: 443, servername: SSL_HOST, timeout: 8000 }, () => {
            const cert = s.getPeerCertificate();
            s.end();
            if (!cert?.valid_to) return ok(null);
            const vence = new Date(cert.valid_to);
            ok({ host: SSL_HOST, vence: vence.toISOString(), dias: Math.floor((vence - Date.now()) / 86400000) });
        });
        s.on('error', () => ok(null));
        s.on('timeout', () => { s.destroy(); ok(null); });
    });
}

const gbTexto = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const nombresEnv = (v) => String(v || '').split(',').map(s => s.trim()).filter(s => /^[\w@.-]+$/.test(s) && !s.startsWith('-'));

// Servicios del servidor (Linux, cada 1 min): los de systemd (MONITOR_SERVICIOS, por defecto nginx y tizadapro) y los
// contenedores de Docker (MONITOR_CONTENEDORES, por defecto sqlserver): si están arriba, su RAM contra su tope y si se
// reiniciaron. TizadaPro fue el que llenó la RAM el 14/09 y se llevó puesto al SQL; desde entonces tiene MemoryMax.
const SERVICIOS = nombresEnv(process.env.MONITOR_SERVICIOS ?? 'nginx,tizadapro');
const CONTENEDORES = nombresEnv(process.env.MONITOR_CONTENEDORES ?? 'sqlserver');
const numeroSystemd = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(v) : null);   // «infinity» o «[not set]» → null
let serviciosCache = null;
const serviciosPrevios = new Map();      // nombre → { desde, reinicios } de la lectura anterior

async function leerServicio(nombre) {
    const out = await ejecutar('systemctl', ['show', nombre, '--no-pager', '--property=LoadState,ActiveState,SubState,MemoryCurrent,MemoryMax,NRestarts,ActiveEnterTimestamp'], 5000);
    if (out == null) return { tipo: 'servicio', nombre, error: 'sin dato' };
    const p = Object.fromEntries(out.trim().split('\n').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    if (p.LoadState === 'not-found') return { tipo: 'servicio', nombre, noExiste: true };
    const mem = numeroSystemd(p.MemoryCurrent);
    const tope = numeroSystemd(p.MemoryMax);
    return {
        tipo: 'servicio', nombre, activo: p.ActiveState === 'active', estado: p.SubState || p.ActiveState || '?',
        memMB: mem == null ? null : Math.round(mem / MB), topeMB: tope == null ? null : Math.round(tope / MB),
        reinicios: numeroSystemd(p.NRestarts), desde: fechaJournal(p.ActiveEnterTimestamp)?.toISOString() || null,
    };
}

// RAM del contenedor desde su cgroup, como la da `docker stats` (uso menos la caché inactiva), sin llamar a docker
// stats, que tarda un par de segundos. Prueba las rutas de cgroup v2 y v1, con systemd o cgroupfs.
function memoriaContenedor(id) {
    if (!/^[0-9a-f]{64}$/.test(id || '')) return null;
    const candidatos = [
        [`/sys/fs/cgroup/system.slice/docker-${id}.scope`, 'memory.current', 'inactive_file'],
        [`/sys/fs/cgroup/docker/${id}`, 'memory.current', 'inactive_file'],
        [`/sys/fs/cgroup/memory/system.slice/docker-${id}.scope`, 'memory.usage_in_bytes', 'total_inactive_file'],
        [`/sys/fs/cgroup/memory/docker/${id}`, 'memory.usage_in_bytes', 'total_inactive_file'],
    ];
    for (const [dir, archivo, clave] of candidatos) {
        try {
            const uso = Number(fs.readFileSync(path.join(dir, archivo), 'utf8'));
            const stat = fs.readFileSync(path.join(dir, 'memory.stat'), 'utf8');
            const inactiva = Number((stat.match(new RegExp(`^${clave} (\\d+)`, 'm')) || [])[1] || 0);
            return Math.round((uso - inactiva) / MB);
        } catch (_) { /* probar la siguiente */ }
    }
    return null;
}

async function leerContenedor(nombre) {
    // El JSON entero y no un --format (26/10): sin healthcheck configurado, docker no trae State.Health y el
    // template con {{if .State.Health}} fallaba («map has no entry for key "Health"»), así que el contenedor
    // de SQL salía siempre «sin dato».
    const { out, motivo } = await ejecutarConMotivo('docker', ['inspect', nombre], 8000);
    let c = null;
    try { c = out ? JSON.parse(out)[0] || null : null; } catch (e) { c = null; }
    if (!c) {
        anotarUnaVez(`docker:${nombre}`, `[MONITOR] No se pudo leer el contenedor ${nombre}: ${motivo || 'docker inspect no devolvió un JSON con el contenedor'}`);
        return { tipo: 'contenedor', nombre, error: 'sin dato' };
    }
    const inicio = c.State?.StartedAt;
    const topeBytes = Number(c.HostConfig?.Memory);
    return {
        tipo: 'contenedor', nombre, activo: c.State?.Status === 'running', estado: c.State?.Status || '?', salud: c.State?.Health?.Status || null,
        memMB: memoriaContenedor(c.Id), topeMB: topeBytes > 0 ? Math.round(topeBytes / MB) : null,
        reinicios: Number(c.RestartCount) || 0, desde: inicio && !inicio.startsWith('0001') ? new Date(inicio).toISOString() : null,
    };
}

async function servicios() {
    if (!ES_LINUX) return null;
    const lista = [...await Promise.all(SERVICIOS.map(leerServicio)), ...await Promise.all(CONTENEDORES.map(leerContenedor))].filter(s => !s.noExiste);
    // Se reinició entre dos lecturas (más reinicios automáticos, o arrancó a otra hora): evento, y mail si es un
    // contenedor (el de SQL se lleva la base con él)
    for (const s of lista) {
        if (s.error) continue;
        const previo = serviciosPrevios.get(s.nombre);
        serviciosPrevios.set(s.nombre, { desde: s.desde, reinicios: s.reinicios });
        if (!previo) continue;
        const masReinicios = s.reinicios != null && previo.reinicios != null && s.reinicios > previo.reinicios;
        const otraHora = s.activo && s.desde && previo.desde && s.desde !== previo.desde;
        if (!masReinicios && !otraHora) continue;
        const texto = `${s.tipo === 'contenedor' ? 'El contenedor' : 'El servicio'} ${s.nombre} se reinició`;
        eventos.unshift({ ts: new Date().toISOString(), nivel: 'atencion', texto });
        anotarLinea({ ev: 1, t: Date.now(), nivel: 'atencion', texto });
        logger.warn(`[MONITOR] ${texto}`);
        if (s.tipo === 'contenedor') {
            require('./alertasService').mandar(`[ATENCIÓN] ${texto}`, `${texto} a las ${new Date().toLocaleTimeString('es-UY', { timeZone: 'America/Montevideo' })}.`, ultimo).catch(() => { });
        }
    }
    return lista;
}

// Red hacia afuera (cada 1 min): ping desde el servidor a internet (MONITOR_PING_DESTINOS, por defecto 1.1.1.1 y
// 8.8.8.8; se puede poner «Nombre=host») y a la PC de la oficina, con la IP de la que llega el latido del monitor
// externo. La caída del 23/10 fue la red de Hostinger: una pérdida de paquetes parcial se ve antes del corte total.
const NOMBRES_PING = { '1.1.1.1': 'Cloudflare', '8.8.8.8': 'Google', '9.9.9.9': 'Quad9' };
const hostValido = (h) => /^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(h || '');
const esIpPrivada = (ip) => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:|f[cd])/i.test(ip);
const DESTINOS_PING = String(process.env.MONITOR_PING_DESTINOS ?? '1.1.1.1,8.8.8.8').split(',').map(s => s.trim()).filter(Boolean)
    .map(s => { const [n, h] = s.includes('=') ? s.split('=').map(x => x.trim()) : [null, s]; return { nombre: n || NOMBRES_PING[h] || h, host: h }; })
    .filter(d => hostValido(d.host));

// 10 pings en ~2 s (en Windows de desarrollo, 4). Devuelve { ms, perdida } o null si no hay ping.
function ping(host) {
    const args = ES_LINUX ? ['-n', '-q', '-c', '10', '-i', '0.2', '-W', '2', host] : ['-n', '4', '-w', '2000', host];
    return new Promise((ok) => {
        execFile('ping', args, { timeout: 20000, windowsHide: true }, (err, stdout) => {
            if (err && (err.code === 'ENOENT' || err.killed)) return ok(null);    // sin ping, o se colgó
            const t = String(stdout || '');                                         // con pérdida total sale con código 1: igual trae el resumen
            const perdida = t.match(/(\d+(?:[.,]\d+)?)%\s*(?:packet loss|perdidos|loss)/i);
            if (!perdida) return ok(null);
            const ms = t.match(/= [\d.]+\/([\d.]+)\//) || t.match(/(?:Media|Average|Promedio)\s*=\s*(\d+)\s*ms/i);
            ok({ perdida: Math.round(Number(perdida[1].replace(',', '.'))), ms: ms ? Math.round(Number(ms[1]) * 10) / 10 : null });
        });
    });
}

let redCache = null;
let midiendoRed = false;
let perdidaSeguida = 0;                  // mediciones seguidas con pérdida ≥ 20 % hacia internet
const contestaronAlgunaVez = new Set();  // un destino que nunca contestó puede tener el ping bloqueado: no cuenta
async function medirRed() {
    if (midiendoRed) return;
    midiendoRed = true;
    try {
        const destinos = [...DESTINOS_PING];
        const ipOficina = latidoExterno?.ip;
        if (ipOficina && hostValido(ipOficina) && !esIpPrivada(ipOficina) && !destinos.some(d => d.host === ipOficina)) destinos.push({ nombre: 'Oficina', host: ipOficina, oficina: true });
        const res = await Promise.all(destinos.map(async d => ({ ...d, r: await ping(d.host) })));
        if (res.every(x => !x.r)) { redCache = { sinPing: true, destinos: [] }; return; }
        for (const x of res) if (x.r && x.r.perdida < 100) contestaronAlgunaVez.add(x.host);
        // La oficina se muestra solo si contestó alguna vez (26/10): casi ningún router contesta ping desde internet, y
        // la casilla «no contesta ping» no decía nada. Que la oficina llega al servidor ya lo muestra su latido.
        const lista = res.filter(x => !x.oficina || contestaronAlgunaVez.has(x.host)).map(x => ({
            nombre: x.nombre, host: x.oficina ? null : x.host, oficina: !!x.oficina,
            ms: x.r?.ms ?? null, perdida: x.r?.perdida ?? null, contesto: contestaronAlgunaVez.has(x.host),
        }));
        // Hacia internet cuenta lo mejor de los destinos de afuera que alguna vez contestaron: si uno anda bien, el
        // problema es del otro, no nuestro
        const afuera = res.filter(x => !x.oficina && x.r && contestaronAlgunaVez.has(x.host)).map(x => x.r);
        const perdida = afuera.length ? Math.min(...afuera.map(r => r.perdida)) : null;
        const tiempos = afuera.map(r => r.ms).filter(v => v != null);
        perdidaSeguida = perdida != null && perdida >= 20 ? perdidaSeguida + 1 : 0;
        redCache = { ts: new Date().toISOString(), destinos: lista, perdida, ms: tiempos.length ? Math.min(...tiempos) : null, perdidaSeguida };
    } catch (e) {
        logger.warn('[MONITOR] no se pudo medir la red: ' + e.message);
    } finally { midiendoRed = false; }
}

// ─── SQL ──────────────────────────────────────────────────────────────────────────────────────────────────────
const conTope = (promesa, ms, msg) => Promise.race([promesa, new Promise((_, mal) => setTimeout(() => mal(new Error(msg)), ms))]);

async function dbPing() {
    const t0 = Date.now();
    try {
        const { getPool } = require('../config/db');
        const pool = await conTope(getPool(), 4000, 'sin conexión en 4 s');
        await conTope(pool.request().query('SELECT 1'), 4000, 'SELECT 1 tardó más de 4 s');
        return { ok: true, ms: Date.now() - t0 };
    } catch (e) {
        return { ok: false, ms: null, error: e.message };
    }
}

let sqlCache = null;
async function sqlDetalle() {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const r = await conTope(pool.request().query(`
            SELECT
              (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS sesiones,
              (SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id <> 0) AS bloqueadas,
              (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1 AND status = 'sleeping' AND open_transaction_count > 0) AS txAbiertasDormidas,
              (SELECT MAX(DATEDIFF(SECOND, r.start_time, GETDATE()))
                 FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
                 WHERE s.is_user_process = 1 AND r.session_id <> @@SPID) AS consultaMasLargaSeg,
              (SELECT physical_memory_in_use_kb / 1024 FROM sys.dm_os_process_memory) AS sqlMemMB,
              (SELECT CAST(value_in_use AS INT) FROM sys.configurations WHERE name = 'max server memory (MB)') AS sqlTopeMB`), 5000, 'el detalle de SQL tardó más de 5 s');
        const x = r.recordset[0];
        // bigint / int de los DMV pueden llegar como texto. El tope por defecto (2147483647) es «sin tope».
        return { sesiones: Number(x.sesiones), bloqueadas: Number(x.bloqueadas), txAbiertasDormidas: Number(x.txAbiertasDormidas),
                 consultaMasLargaSeg: x.consultaMasLargaSeg == null ? null : Number(x.consultaMasLargaSeg),
                 sqlMemMB: x.sqlMemMB == null ? null : Number(x.sqlMemMB),
                 sqlTopeMB: x.sqlTopeMB == null || Number(x.sqlTopeMB) >= 2147483647 ? null : Number(x.sqlTopeMB), error: null };
    } catch (e) {
        return { error: /permission|VIEW SERVER STATE/i.test(e.message) ? 'sin permiso para ver el estado del motor' : e.message };
    }
}

// Bloqueos de SQL con detalle (cada 15 s): las bloqueadas, las que bloquean (pueden estar durmiendo con una
// transacción abierta: por eso salen de sessions + connections), las transacciones dormidas de más de 60 s y las
// consultas en curso que más CPU llevan. El texto de la consulta se recorta a 300 caracteres.
let bloqueosCache = null;
const limpiarSql = (t) => (t == null ? null : String(t).replace(/\s+/g, ' ').trim().slice(0, 300));
async function sqlBloqueos() {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const r = await conTope(pool.request().query(`
            SELECT TOP 10 r.session_id AS sesion, r.blocking_session_id AS bloqueadaPor, DATEDIFF(SECOND, r.start_time, GETDATE()) AS seg,
                   r.wait_type AS espera, s.login_name AS login, s.host_name AS host, s.program_name AS programa, t.text AS consulta
            FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
            OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
            WHERE r.blocking_session_id <> 0
            ORDER BY seg DESC;

            SELECT s.session_id AS sesion, s.status AS estado, s.login_name AS login, s.host_name AS host, s.program_name AS programa,
                   s.open_transaction_count AS transacciones, DATEDIFF(SECOND, s.last_request_end_time, GETDATE()) AS quietaSeg,
                   (SELECT COUNT(*) FROM sys.dm_exec_requests b WHERE b.blocking_session_id = s.session_id) AS bloqueaA, t.text AS consulta
            FROM sys.dm_exec_sessions s
            LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
            OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) t
            WHERE s.session_id IN (SELECT blocking_session_id FROM sys.dm_exec_requests WHERE blocking_session_id <> 0)
              AND s.session_id NOT IN (SELECT session_id FROM sys.dm_exec_requests WHERE blocking_session_id <> 0);

            SELECT TOP 10 s.session_id AS sesion, s.login_name AS login, s.host_name AS host, s.program_name AS programa,
                   s.open_transaction_count AS transacciones, DATEDIFF(SECOND, s.last_request_end_time, GETDATE()) AS quietaSeg, t.text AS consulta
            FROM sys.dm_exec_sessions s
            LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
            OUTER APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle) t
            WHERE s.is_user_process = 1 AND s.status = 'sleeping' AND s.open_transaction_count > 0
              AND DATEDIFF(SECOND, s.last_request_end_time, GETDATE()) > 60
            ORDER BY quietaSeg DESC;

            SELECT TOP 5 r.session_id AS sesion, r.cpu_time AS cpuMs, r.logical_reads AS lecturas, DATEDIFF(SECOND, r.start_time, GETDATE()) AS seg,
                   s.login_name AS login, s.program_name AS programa, t.text AS consulta
            FROM sys.dm_exec_requests r JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
            OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
            WHERE s.is_user_process = 1 AND r.session_id <> @@SPID
            ORDER BY r.cpu_time DESC;`), 5000, 'los bloqueos de SQL tardaron más de 5 s');
        const limpiar = (filas) => filas.map(f => ({ ...f, consulta: limpiarSql(f.consulta), programa: f.programa ? String(f.programa).trim().slice(0, 60) : null }));
        return { bloqueadas: limpiar(r.recordsets[0]), cabezas: limpiar(r.recordsets[1]), dormidas: limpiar(r.recordsets[2]), pesadas: limpiar(r.recordsets[3]), error: null };
    } catch (e) {
        return { error: /permission|VIEW SERVER STATE/i.test(e.message) ? 'sin permiso para ver el estado del motor' : e.message };
    }
}

let backupCache = null;
async function ultimoBackup() {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const r = await conTope(pool.request().query(`
            SELECT TOP 1 DATEDIFF(MINUTE, backup_finish_date, GETDATE()) AS haceMin
            FROM msdb.dbo.backupset WHERE database_name = DB_NAME() AND type = 'D'
            ORDER BY backup_finish_date DESC`), 5000, 'msdb tardó más de 5 s');
        return { haceMin: r.recordset[0]?.haceMin ?? null };
    } catch (_) { return null; }
}

// Sistema (Linux, cada 10 min): OOM del kernel de 7 días, arranques del servidor y si se apagó bien, arranques del
// backend y últimos 3 backups. Un OOM nuevo queda como evento y se avisa por mail.
let sistemaCache = null;
let oomVistos = null;                    // ts de los OOM ya conocidos (en el primer barrido no se avisan los viejos)
// Fechas de `journalctl --list-boots`: «Fri 2026-10-16 19:34:12 -03» (o «UTC» si el servidor está en UTC)
const FECHA_BOOT = String.raw`\w{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (?:UTC|[+-]\d{2,4})`;
const fechaJournal = (t) => {
    const m = String(t).match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{2})(\d{2})?/);
    if (!m) return null;
    return new Date(`${m[1]}T${m[2]}${m[3] === 'UTC' ? 'Z' : `${m[3]}:${m[4] || '00'}`}`);
};
async function sistema() {
    const salida = { oom: null, arranquesServidor: null, arranquesBackend: [] };
    if (ES_LINUX) {
        // Del journal; si este journalctl no tiene --grep, de /var/log/kern.log (rsyslog, también con hora ISO)
        let oomTxt = await ejecutar('journalctl', ['-k', '--since', '7 days ago', '-o', 'short-iso', '--no-pager', '--grep', 'Killed process'], 15000);
        if (oomTxt == null) oomTxt = await ejecutar('grep', ['-h', 'Killed process', '/var/log/kern.log.1', '/var/log/kern.log'], 10000);
        if (oomTxt != null) {
            const hace7 = Date.now() - 7 * 86400000;
            salida.oom = oomTxt.split('\n').map(l => {
                const m = l.match(/^(\S+)\s.*Killed process (\d+) \(([^)]+)\).*anon-rss:(\d+)kB/);
                return m ? { ts: new Date(m[1].replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toISOString(), pid: Number(m[2]), proceso: m[3], rssGB: Math.round(Number(m[4]) / 1024 / 1024 * 10) / 10 } : null;
            }).filter(o => o && Date.parse(o.ts) >= hace7).reverse();
        }
        const boots = await ejecutar('journalctl', ['--list-boots', '--no-pager'], 10000);
        const apagados = (await ejecutar('last', ['-x', '-F', 'shutdown'], 5000) || '').split('\n')
            .map(l => l.match(/^shutdown\s+system down\s+\S+\s+(\w{3} \w{3}\s+\d+ \d{2}:\d{2}:\d{2} \d{4})/)).filter(Boolean)
            .map(m => new Date(m[1]).getTime()).filter(t => !Number.isNaN(t));
        if (boots != null) {
            const filas = boots.split('\n').map(l => l.match(new RegExp(`(${FECHA_BOOT})\\s+(${FECHA_BOOT})`))).filter(Boolean);
            salida.arranquesServidor = filas.slice(-5).reverse().map((m, i) => {
                const inicio = fechaJournal(m[1]);
                const fin = fechaJournal(m[2]);
                const actual = i === 0;
                // Se apagó bien si hay un «shutdown» de `last` a menos de 5 min del último registro de ese arranque
                const limpio = actual ? null : apagados.some(t => fin && Math.abs(t - fin.getTime()) < 5 * 60000);
                return { inicio: inicio?.toISOString() || null, fin: actual ? null : fin?.toISOString() || null, actual, limpio };
            });
        }
    }
    try {
        salida.arranquesBackend = fs.readFileSync(path.join(DIR_HISTORIA, 'arranques-backend.jsonl'), 'utf8').split('\n').filter(Boolean)
            .slice(-5).reverse().map(l => { try { return JSON.parse(l).t; } catch (_) { return null; } }).filter(Boolean).map(t => new Date(t).toISOString());
    } catch (_) { /* primera vez */ }

    // OOM nuevos: evento y aviso (en el primer barrido solo se toman como nuevos los de los últimos 15 min)
    if (salida.oom) {
        const nuevos = salida.oom.filter(o => (oomVistos ? !oomVistos.has(o.ts) : Date.now() - Date.parse(o.ts) < 15 * 60000));
        oomVistos = new Set(salida.oom.map(o => o.ts));
        for (const o of nuevos) {
            const texto = `El kernel mató ${o.proceso} (${o.rssGB} GB) por falta de memoria`;
            eventos.unshift({ ts: o.ts, nivel: 'mal', texto });
            anotarLinea({ ev: 1, t: Date.parse(o.ts), nivel: 'mal', texto });
            logger.warn(`[MONITOR] ${texto}`);
            require('./alertasService').mandar(`[ALERTA] ${texto}`, `${texto} a las ${new Date(o.ts).toLocaleTimeString('es-UY', { timeZone: 'America/Montevideo' })}.`, ultimo).catch(() => { });
        }
    }
    return salida;
}

// Seguridad del sistema (Linux, cada 2 min): SSH fallidos y bloqueos del firewall de los últimos 15 min, y fail2ban.
// Los escaneos de afuera son ruido constante de internet: se muestran, no se avisan.
let seguridadCache = null;
async function seguridadSistema() {
    if (!ES_LINUX) return null;
    const contarIps = (texto, rx) => {
        const cuenta = new Map();
        let total = 0;
        for (const l of String(texto || '').split('\n')) {
            const m = l.match(rx);
            if (!m) continue;
            total++;
            const x = cuenta.get(m[1]) || { ip: m[1], cantidad: 0, puertos: new Set() };
            x.cantidad++; if (m[2]) x.puertos.add(m[2]);
            cuenta.set(m[1], x);
        }
        return { total, top: [...cuenta.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, 5).map(x => ({ ip: x.ip, cantidad: x.cantidad, puertos: [...x.puertos].slice(0, 4) })) };
    };
    const ssh = await ejecutar('journalctl', ['_COMM=sshd', '--since', '15 minutes ago', '-o', 'cat', '--no-pager', '--grep', 'Failed password|Invalid user|authentication failure'], 10000);
    const ufw = await ejecutar('journalctl', ['-k', '--since', '15 minutes ago', '-o', 'cat', '--no-pager', '--grep', 'UFW BLOCK'], 10000);
    const f2b = await ejecutar('fail2ban-client', ['status', 'sshd'], 5000);
    return {
        ssh: ssh == null ? null : contarIps(ssh, /from (\d{1,3}(?:\.\d{1,3}){3})/),
        firewall: ufw == null ? null : contarIps(ufw, /SRC=(\S+).*?DPT=(\d+)/),
        fail2ban: f2b == null ? null : { baneadas: Number((f2b.match(/Currently banned:\s+(\d+)/) || [])[1] || 0), total: Number((f2b.match(/Total banned:\s+(\d+)/) || [])[1] || 0) },
    };
}

let backupsCache = null;
async function ultimosBackups() {
    try {
        const { getPool } = require('../config/db');
        const pool = await getPool();
        const r = await conTope(pool.request().query(`
            SELECT TOP 3 DATEDIFF(MINUTE, backup_finish_date, GETDATE()) AS haceMin,
                   DATEDIFF(SECOND, backup_start_date, backup_finish_date) AS segundos,
                   CAST(backup_size / 1048576.0 AS DECIMAL(12,1)) AS tamanoMB,
                   CAST(compressed_backup_size / 1048576.0 AS DECIMAL(12,1)) AS comprimidoMB
            FROM msdb.dbo.backupset WHERE database_name = DB_NAME() AND type = 'D'
            ORDER BY backup_finish_date DESC`), 5000, 'msdb tardó más de 5 s');
        const lista = r.recordset.map(b => ({ terminado: new Date(Date.now() - b.haceMin * 60000).toISOString(), haceMin: b.haceMin, segundos: b.segundos, tamanoMB: Number(b.tamanoMB), comprimidoMB: Number(b.comprimidoMB) }));
        // La copia que queda en el servidor (/home/backups/sql): los 3 archivos más nuevos
        let archivos = null;
        if (ES_LINUX) {
            try {
                const dir = process.env.BACKUPS_DIR || '/home/backups/sql';
                archivos = fs.readdirSync(dir).map(f => { const st = fs.statSync(path.join(dir, f)); return { nombre: f, tamanoMB: Math.round(st.size / MB), fecha: st.mtime.toISOString() }; })
                    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha)).slice(0, 3);
            } catch (_) { archivos = null; }
        }
        return { lista, archivos };
    } catch (e) { return { lista: null, error: /permission/i.test(e.message) ? 'sin permiso para leer msdb' : e.message }; }
}

// Latido del monitor externo: lo manda cada minuto la PC de la oficina (POST /api/sysadmin/monitor/latido-externo)
const RUTA_LATIDO = path.join(DIR_HISTORIA, 'latido-externo.json');
let latidoExterno = null;
try { latidoExterno = JSON.parse(fs.readFileSync(RUTA_LATIDO, 'utf8')); } catch (_) { /* nunca llegó */ }
function registrarLatidoExterno({ pc, ip, version }) {
    const anterior = latidoExterno;
    latidoExterno = { pc: String(pc || '?').slice(0, 60), ip: String(ip || '').replace(/^::ffff:/, ''), version: String(version || '').slice(0, 20), ts: new Date().toISOString() };
    // A disco como mucho una vez por minuto: así un reinicio no lo pierde
    if (!anterior || Date.now() - Date.parse(anterior.guardado || 0) > 55000) {
        latidoExterno.guardado = latidoExterno.ts;
        try { fs.mkdirSync(DIR_HISTORIA, { recursive: true }); fs.writeFileSync(RUTA_LATIDO, JSON.stringify(latidoExterno)); } catch (_) { /* sin disco */ }
    } else latidoExterno.guardado = anterior.guardado;
}
function estadoExterno() {
    if (!latidoExterno) return { configurado: !!process.env.MONITOR_EXTERNO_TOKEN, ultimo: null };
    const seg = Math.round((Date.now() - Date.parse(latidoExterno.ts)) / 1000);
    return { configurado: true, pc: latidoExterno.pc, ip: latidoExterno.ip, ultimo: latidoExterno.ts, haceSeg: seg };
}

// Disponibilidad de los últimos 7 días: el tiempo con muestras del monitor, descontando los huecos de más de 3 min
// (backend o servidor caído). Antes de la primera muestra que existe no cuenta (no se sabe). Cada 10 min.
let disponibilidadCache = null;
function calcularDisponibilidad() {
    let primera = null;
    try {
        const archivos = fs.readdirSync(DIR_HISTORIA).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
        if (archivos.length) primera = leerDia(archivos[0].slice(0, 10)).find(l => !l.ev)?.t ?? null;
    } catch (_) { /* sin historia */ }
    const dias = [];
    for (let k = 6; k >= 0; k--) {
        const fecha = fechaUY(new Date(Date.now() - k * 86400000));
        const inicioDia = new Date(`${fecha}T00:00:00-03:00`).getTime();
        const finDia = Math.min(inicioDia + 86400000, Date.now());
        const desde = primera == null ? null : Math.max(inicioDia, primera);
        if (desde == null || desde >= finDia) { dias.push({ fecha, sinDatos: true }); continue; }
        const muestras = leerDia(fecha).filter(l => !l.ev).sort((a, b) => a.t - b.t);
        const caidas = huecos(muestras, desde, finDia);
        const minutosCaido = caidas.reduce((s, c) => s + c.minutos, 0);
        const minutos = (finDia - desde) / 60000;
        dias.push({ fecha, pct: Math.max(0, Math.round((1 - minutosCaido / minutos) * 1000) / 10), minutosCaido, caidas: caidas.slice(0, 6) });
    }
    disponibilidadCache = dias;
}


// ─── Historia en disco ────────────────────────────────────────────────────────────────────────────────────────
function anotarLinea(obj) {
    try {
        fs.mkdirSync(DIR_HISTORIA, { recursive: true });
        fs.appendFile(path.join(DIR_HISTORIA, `${fechaUY()}.jsonl`), JSON.stringify(obj) + '\n', () => { });
    } catch (_) { /* sin disco: la pantalla igual anda */ }
}

function guardarMuestraEnDisco(m) {
    anotarLinea({
        t: Date.parse(m.ts),
        cpu: m.host.cpu.pct,
        mem: Math.round((1 - m.host.mem.disponibleMB / m.host.mem.totalMB) * 1000) / 10,
        swap: m.host.swap ? Math.round(m.host.swap.usadaMB / m.host.swap.totalMB * 1000) / 10 : null,
        db: m.db.ms,
        req: m.http.porMin, e5: m.http.errores5xxPorMin, r429: m.http.r429PorMin, ef: m.http.erroresFrontPorMin,
        lag: m.node.lagMs, rss: m.node.rssMB, sock: m.sockets,
        io: m.host.io?.iowaitPct ?? null, st: m.host.io?.stealPct ?? null, rin: m.host.red?.entraMbps ?? null, rout: m.host.red?.saleMbps ?? null,
        pm: m.red?.ms ?? null, pp: m.red?.perdida ?? null,
        d: m.discos.map(d => [d.ruta, d.usadoPct, d.libreGB]),
    });
}

let ultimaLimpieza = null;
function limpiarHistoriaVieja() {
    const hoy = fechaUY();
    if (ultimaLimpieza === hoy) return;
    ultimaLimpieza = hoy;
    try {
        const limite = fechaUY(new Date(Date.now() - DIAS_HISTORIA * 86400000));
        for (const f of fs.readdirSync(DIR_HISTORIA)) {
            const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
            if (m && m[1] < limite) fs.unlinkSync(path.join(DIR_HISTORIA, f));
        }
    } catch (_) { /* nada que limpiar */ }
}

function leerDia(fecha) {
    try {
        return fs.readFileSync(path.join(DIR_HISTORIA, `${fecha}.jsonl`), 'utf8').split('\n').filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    } catch (_) { return []; }
}

// Huecos: más de 3 min entre dos muestras seguidas = el backend (o el servidor entero) no estuvo
function huecos(muestras, desde = null, hasta = null) {
    const salida = [];
    let previo = desde;
    for (const s of muestras) {
        if (previo != null && s.t - previo > 3 * 60000) salida.push({ desde: new Date(previo).toISOString(), hasta: new Date(s.t).toISOString(), minutos: Math.round((s.t - previo) / 60000) });
        previo = s.t;
    }
    if (hasta != null && previo != null && hasta - previo > 3 * 60000) salida.push({ desde: new Date(previo).toISOString(), hasta: new Date(hasta).toISOString(), minutos: Math.round((hasta - previo) / 60000) });
    return salida;
}

/** Series de las últimas `horas` horas (24 o 168), en hasta 720 puntos, con los huecos y los eventos del período. */
function leerHistoria(horas) {
    const h = Math.min(Math.max(Number(horas) || 24, 1), DIAS_HISTORIA * 24);
    const hasta = Date.now();
    const desde = hasta - h * 3600000;
    const lineas = [];
    for (let d = new Date(desde - 86400000); d.getTime() <= hasta + 86400000; d = new Date(d.getTime() + 86400000)) {
        lineas.push(...leerDia(fechaUY(d)));
    }
    const vistos = new Set();
    const muestras = lineas.filter(l => !l.ev && l.t >= desde && l.t <= hasta && !vistos.has(l.t) && vistos.add(l.t)).sort((a, b) => a.t - b.t);
    const evs = lineas.filter(l => l.ev && l.t >= desde).sort((a, b) => b.t - a.t).slice(0, 60);
    const balde = Math.max(60000, Math.ceil((hasta - desde) / 720));
    const n = Math.ceil((hasta - desde) / balde);
    const series = { ts: [], cpu: [], memPct: [], swapPct: [], dbMs: [], reqMin: [], err5xx: [], lag: [], iowait: [], redEntra: [], redSale: [], pingMs: [], pingPerdida: [] };
    const campos = [['cpu', 'cpu', 'prom'], ['memPct', 'mem', 'max'], ['swapPct', 'swap', 'max'], ['dbMs', 'db', 'prom'], ['reqMin', 'req', 'prom'], ['err5xx', 'e5', 'max'], ['lag', 'lag', 'max'], ['iowait', 'io', 'max'], ['redEntra', 'rin', 'prom'], ['redSale', 'rout', 'prom'], ['pingMs', 'pm', 'prom'], ['pingPerdida', 'pp', 'max']];
    let i = 0;
    for (let b = 0; b < n; b++) {
        const ini = desde + b * balde;
        const fin = ini + balde;
        const grupo = [];
        while (i < muestras.length && muestras[i].t < fin) { if (muestras[i].t >= ini) grupo.push(muestras[i]); i++; }
        series.ts.push(ini);
        for (const [serie, campo, modo] of campos) {
            const vals = grupo.map(g => g[campo]).filter(v => v != null);
            series[serie].push(!vals.length ? null : modo === 'max' ? Math.max(...vals) : Math.round(vals.reduce((a, c) => a + c, 0) / vals.length * 10) / 10);
        }
    }
    return { horas: h, desde: new Date(desde).toISOString(), historia: series, huecos: huecos(muestras, null, hasta), eventos: evs.map(e => ({ ts: new Date(e.t).toISOString(), nivel: e.nivel, texto: e.texto })) };
}

/** Resumen de un día (AAAA-MM-DD) para el mail de las mañanas. */
function resumenDia(fecha) {
    const lineas = leerDia(fecha);
    const muestras = lineas.filter(l => !l.ev).sort((a, b) => a.t - b.t);
    const evs = lineas.filter(l => l.ev);
    const max = (k) => { const v = muestras.map(m => m[k]).filter(x => x != null); return v.length ? Math.max(...v) : null; };
    const suma = (k) => muestras.reduce((s, m) => s + (m[k] || 0), 0);
    const inicioDia = new Date(`${fecha}T00:00:00-03:00`).getTime();
    const finDia = Math.min(inicioDia + 86400000, Date.now());
    return {
        fecha,
        muestras: muestras.length,
        cobertura: Math.round(muestras.length / ((finDia - inicioDia) / 60000) * 1000) / 10,
        huecos: huecos(muestras, inicioDia, finDia),
        maxCpu: max('cpu'), maxMem: max('mem'), maxSwap: max('swap'), maxDbMs: max('db'), maxLag: max('lag'), maxPerdida: max('pp'), maxPingMs: max('pm'),
        pedidos: suma('req'), errores5xx: suma('e5'), rechazos429: suma('r429'), erroresFront: suma('ef'),
        eventos: evs.map(e => ({ ts: new Date(e.t).toISOString(), nivel: e.nivel, texto: e.texto })),
    };
}

// Pronóstico del disco: cuánto baja el espacio libre por día (regresión sobre la primera muestra de cada día de los
// últimos 7) y en cuántos días se llena a ese ritmo. Se recalcula una vez por hora.
let pronosticoCache = {};
function calcularPronostico() {
    const porRuta = {};
    for (let k = 7; k >= 0; k--) {
        const dia = leerDia(fechaUY(new Date(Date.now() - k * 86400000))).find(l => !l.ev && l.d);
        if (!dia) continue;
        for (const [ruta, , libreGB] of dia.d) (porRuta[ruta] = porRuta[ruta] || []).push([dia.t / 86400000, libreGB]);
    }
    const salida = {};
    for (const [ruta, pts] of Object.entries(porRuta)) {
        if (pts.length < 2 || pts[pts.length - 1][0] - pts[0][0] < 1) continue;
        const n = pts.length;
        const mx = pts.reduce((s, p) => s + p[0], 0) / n;
        const my = pts.reduce((s, p) => s + p[1], 0) / n;
        const pendiente = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
        salida[ruta] = { gbPorDia: Math.round(-pendiente * 100) / 100, dias: pendiente < -0.05 ? Math.round(pts[n - 1][1] / -pendiente) : null };
    }
    pronosticoCache = salida;
}

// ─── Alertas y eventos ────────────────────────────────────────────────────────────────────────────────────────
function evaluar(m) {
    const a = [];
    const add = (clave, nivel, texto) => a.push({ clave, nivel, texto });
    if (!m.db.ok) add('db', 'mal', `La base no responde: ${m.db.error}`);
    else if (m.db.ms > 500) add('db', 'atencion', `La base tarda ${m.db.ms} ms en responder`);
    const libre = m.host.mem.disponibleMB / m.host.mem.totalMB;
    if (libre < 0.1) add('ram', 'mal', `Queda ${m.host.mem.disponibleMB} MB de RAM disponible`);
    else if (libre < 0.2) add('ram', 'atencion', `Queda ${Math.round(libre * 100)} % de RAM disponible`);
    if (m.host.swap && m.host.swap.usadaMB / m.host.swap.totalMB > 0.85) add('swap', 'atencion', `Swap al ${Math.round(m.host.swap.usadaMB / m.host.swap.totalMB * 100)} %`);
    for (const d of m.discos) {
        if (d.usadoPct >= 90) add(`disco:${d.ruta}`, 'mal', `Disco ${d.ruta} al ${d.usadoPct} %`);
        else if (d.usadoPct >= 80) add(`disco:${d.ruta}`, 'atencion', `Disco ${d.ruta} al ${d.usadoPct} %`);
        else if (d.pronostico?.dias != null && d.pronostico.dias < 14) add(`disco:${d.ruta}`, 'atencion', `El disco ${d.ruta} se llena en ${d.pronostico.dias} días a este ritmo`);
    }
    if (m.node.lagMs > 500) add('lag', 'atencion', `El backend está trabado: el event loop demora ${m.node.lagMs} ms`);
    if (m.host.io?.iowaitPct >= 25) add('io', 'atencion', `El disco está trabado: ${m.host.io.iowaitPct} % de la CPU esperando al disco`);
    if (m.host.io?.stealMinutoPct >= 20) add('steal', 'atencion', `El host de Hostinger nos está sacando CPU (${m.host.io.stealMinutoPct} % steal en el último minuto)`);
    if (m.externo?.configurado && m.externo.ultimo && m.externo.haceSeg > 5 * 60) add('externo', 'atencion', `El monitor externo (${m.externo.pc}) no manda latido hace ${Math.round(m.externo.haceSeg / 60)} min`);
    if (m.http.errores5xxPorMin >= 10) add('http5xx', 'atencion', `${m.http.errores5xxPorMin} errores 500 por minuto`);
    if (m.http.r429PorMin >= 20) add('r429', 'atencion', `El límite de pedidos está rechazando ${m.http.r429PorMin} por minuto${m.http.top429[0] ? ` (sobre todo a ${m.http.top429[0].ip})` : ''}`);
    if (m.http.erroresFrontPorMin >= 20) add('front', 'atencion', `${m.http.erroresFrontPorMin} errores del front por minuto`);
    if (m.db.bloqueadas > 0) add('bloqueos', 'atencion', `${m.db.bloqueadas} consulta(s) bloqueada(s) en SQL`);
    for (const x of m.seguridad?.logins?.porIp || []) {
        if (x.cantidad >= 15) add(`fuerza:${x.ip}`, 'atencion', `${x.cantidad} logins fallidos en 15 min desde ${x.ip}${x.usuarios.length ? ` (${x.usuarios.join(', ')})` : ''}`);
    }
    if (m.db.consultaMasLargaSeg > 120) add('consultaLarga', 'atencion', `Una consulta lleva ${m.db.consultaMasLargaSeg} s corriendo`);
    for (const s of m.servicios || []) {
        if (s.error) continue;
        const quien = `${s.tipo === 'contenedor' ? 'El contenedor' : 'El servicio'} ${s.nombre}`;
        if (!s.activo) add(`servicio:${s.nombre}`, 'mal', `${quien} está parado (${s.estado})`);
        else if (s.salud === 'unhealthy') add(`servicio:${s.nombre}`, 'atencion', `${quien} no pasa su chequeo de salud`);
        else if (s.topeMB && s.memMB != null && s.memMB / s.topeMB >= 0.9) add(`servicio:${s.nombre}`, 'atencion', `${s.nombre} usa ${gbTexto(s.memMB)} de su tope de ${gbTexto(s.topeMB)}`);
    }
    // Red: dos mediciones seguidas (2 min) con pérdida, así un ping suelto perdido no avisa
    if (m.red?.perdidaSeguida >= 2) add('red', m.red.perdida >= 100 ? 'mal' : 'atencion', m.red.perdida >= 100 ? 'El servidor no llega a internet: no contesta ningún destino' : `Se pierde el ${m.red.perdida} % de los paquetes hacia internet`);
    else if (m.red?.ms >= 150) add('red', 'atencion', `La red hacia afuera está lenta: ${m.red.ms} ms hasta internet`);
    for (const p of m.procesos || []) {
        if (p.python && p.rssMB > 8192) add(`py:${p.pid}`, 'mal', `${p.detalle || 'python'} usa ${(p.rssMB / 1024).toFixed(1)} GB de RAM`);
        else if (p.python && p.rssMB > 4096) add(`py:${p.pid}`, 'atencion', `${p.detalle || 'python'} usa ${(p.rssMB / 1024).toFixed(1)} GB de RAM`);
    }
    for (const j of m.jobs) if (j.estado === 'ERROR') add(`job:${j.id}`, 'atencion', `El job «${j.nombre}» falló: ${j.error || 'sin detalle'}`);
    for (const i of m.integraciones) if (i.nivel === 'mal') add(`integ:${i.clave}`, 'atencion', `${i.nombre} no anda: ${i.ultimoError || 'sin detalle'}`);
    if (m.db.backupHaceMin != null && m.db.backupHaceMin > 26 * 60) add('backup', 'atencion', `El último backup es de hace ${Math.round(m.db.backupHaceMin / 60)} h`);
    if (m.ssl && m.ssl.dias < 5) add('ssl', 'mal', `El certificado de ${m.ssl.host} vence en ${m.ssl.dias} días`);
    else if (m.ssl && m.ssl.dias < 15) add('ssl', 'atencion', `El certificado de ${m.ssl.host} vence en ${m.ssl.dias} días`);
    return a;
}

const nombreClave = (clave) => clave.replace(/^py:\d+$/, 'proceso python').replace(/^job:/, 'job ').replace(/^disco:/, 'disco ').replace(/^integ:/, '')
    .replace(/^servicio:/, '').replace(/^red$/, 'red hacia afuera');

function registrarEventos(alertas, m) {
    const ahora = Date.now();
    const vigentes = new Map(alertas.map(x => [x.clave, x]));
    const avisos = require('./alertasService');
    for (const x of alertas) {
        if (estadoAlertas.get(x.clave) !== x.nivel) {
            eventos.unshift({ ts: new Date(ahora).toISOString(), nivel: x.nivel, texto: x.texto });
            anotarLinea({ ev: 1, t: ahora, nivel: x.nivel, texto: x.texto });
            logger.warn(`[MONITOR] ${x.texto}`);
            estadoAlertas.set(x.clave, x.nivel);
            avisos.alerta(x, m).catch(e => logger.warn('[MONITOR] aviso: ' + e.message));
        }
    }
    for (const clave of [...estadoAlertas.keys()]) {
        if (!vigentes.has(clave)) {
            const texto = `Normalizado: ${nombreClave(clave)}`;
            eventos.unshift({ ts: new Date(ahora).toISOString(), nivel: 'ok', texto });
            anotarLinea({ ev: 1, t: ahora, nivel: 'ok', texto });
            estadoAlertas.delete(clave);
            avisos.normalizado(clave, nombreClave(clave), m).catch(e => logger.warn('[MONITOR] aviso: ' + e.message));
        }
    }
    if (eventos.length > 60) eventos.length = 60;
}

function guardarHistoria(m) {
    const push = (k, v) => { historia[k].push(v); if (historia[k].length > PUNTOS) historia[k].shift(); };
    push('ts', Date.parse(m.ts));
    push('cpu', m.host.cpu.pct);
    push('memPct', Math.round((1 - m.host.mem.disponibleMB / m.host.mem.totalMB) * 1000) / 10);
    push('swapPct', m.host.swap ? Math.round(m.host.swap.usadaMB / m.host.swap.totalMB * 1000) / 10 : null);
    push('dbMs', m.db.ms);
    push('reqMin', m.http.porMin);
    push('err5xx', m.http.errores5xxPorMin);
    push('lag', m.node.lagMs);
    push('iowait', m.host.io?.iowaitPct ?? null);
    push('redEntra', m.host.red?.entraMbps ?? null);
    push('redSale', m.host.red?.saleMbps ?? null);
    push('pingMs', m.red?.ms ?? null);
    push('pingPerdida', m.red?.perdida ?? null);
}

// ─── Muestra ──────────────────────────────────────────────────────────────────────────────────────────────────
async function muestrear() {
    tick++;
    const [db, discosAhora] = await Promise.all([dbPing(), discos()]);
    if (tick % 2 === 1) procesosCache = await procesos();
    if (tick % 3 === 1 && db.ok) { sqlCache = await sqlDetalle(); bloqueosCache = await sqlBloqueos(); }
    if (tick % 24 === 1) seguridadCache = await seguridadSistema();     // cada 2 min
    if (tick % 12 === 7) medirRed();                                     // cada 1 min, sin esperarlo (tarda ~2 s)
    if (tick % 12 === 1) {
        pm2Cache = await pm2();
        serviciosCache = await servicios();
        leerBuildDeployado();
        if (db.ok) await require('./saludIntegraciones').medirDgi();
    }
    if (tick % 60 === 1 && db.ok) backupCache = await ultimoBackup();
    if (tick % 120 === 1) {                                              // cada 10 min
        sistemaCache = await sistema();
        if (db.ok) backupsCache = await ultimosBackups();
        calcularDisponibilidad();
        calcularMarcas();
    }
    if (tick % 720 === 1) { calcularPronostico(); limpiarHistoriaVieja(); }   // cada hora
    if (tick % 4320 === 1) sslCache = await ssl();                       // cada 6 h

    const { mem, swap } = memoria();
    const { io: ioDisco, red } = leerIoRed();   // ojo: `io` a secas es el socket.io del módulo
    const lagMs = Math.round(lagHist.percentile(99) / 1e6);
    lagHist.reset();
    const yo = (pm2Cache || []).find(p => p.nombre === (process.env.name || 'sistema-produccion'));
    const registro = require('../jobs/jobRegistry');

    const m = {
        ts: new Date().toISOString(),
        host: {
            hostname: os.hostname(),
            linux: ES_LINUX,
            uptimeSeg: Math.round(os.uptime()),
            cpu: { pct: cpuPct(), nucleos: os.cpus().length },
            carga: ES_LINUX ? os.loadavg().map(x => +x.toFixed(2)) : null,
            mem,
            swap,
            io: ioDisco,
            red,
        },
        discos: discosAhora.map(d => ({ ...d, pronostico: pronosticoCache[d.ruta] || null })),
        node: {
            version: process.version,
            uptimeSeg: Math.round(process.uptime()),
            rssMB: Math.round(process.memoryUsage().rss / MB),
            heapMB: Math.round(process.memoryUsage().heapUsed / MB),
            lagMs,
            reinicios: yo ? yo.reinicios : null,
        },
        pm2: pm2Cache,
        db: {
            ...db,
            ...(sqlCache || {}),
            error: db.ok ? (sqlCache?.error || null) : db.error,
            backupHaceMin: backupCache?.haceMin ?? null,
        },
        http: cerrarVentanaHttp(),
        front: resumenFront(),
        sockets: io?.engine?.clientsCount ?? null,
        procesos: procesosCache,
        jobs: registro.getEjecutables().map(j => ({
            id: j.id, nombre: j.nombre, estado: j.estado, schedule: j.schedule,
            ultimaEjecucion: j.ultimaEjecucion, proximaEjecucion: j.proximaEjecucion,
            error: j.ultimoError ? (j.ultimoError.message || String(j.ultimoError)) : null,
        })),
        integraciones: require('./saludIntegraciones').snapshot(),
        colas: require('./colaProcesos').snapshot(),
        rutas: rutasTop(),
        bloqueos: bloqueosCache,
        servicios: serviciosCache,
        errores: erroresTop(),
        red: redCache,
        seguridad: { logins: resumenLogins(), sistema: seguridadCache },
        marcas: marcasCache || (calcularMarcas(), marcasCache),
        sistema: sistemaCache,
        backups: backupsCache,
        disponibilidad: disponibilidadCache,
        externo: estadoExterno(),
        ssl: sslCache,
        alertasPush: require('./alertasService').destinos(),
    };
    m.alertas = evaluar(m);
    registrarEventos(m.alertas, m);
    guardarHistoria(m);
    if (tick % 12 === 0) guardarMuestraEnDisco(m);                      // una por minuto
    ultimo = m;
}

// ─── Acciones (solo admin, con confirmación en la pantalla) ────────────────────────────────────────────────────
const errorAccion = (msg, status = 400) => Object.assign(new Error(msg), { status });
async function auditar(usuario, ip, detalle) {
    logger.warn(`[MONITOR] ${detalle} (por ${usuario?.username || usuario?.id || '?'})`);
    try { require('../utils/auditLogger').audit('MONITOR_ACCION', { detalle, user: usuario?.username, userId: usuario?.id, ip }); } catch (_) { /* sin log de auditoría */ }
    try {
        const { getPool } = require('../config/db');
        await require('./trackingService').registrarAuditoria(await getPool(), usuario?.id, 'MONITOR_ACCION', detalle, ip);
    } catch (_) { /* la acción ya se hizo: que no falle por la auditoría */ }
    const ts = new Date().toISOString();
    eventos.unshift({ ts, nivel: 'atencion', texto: detalle });
    anotarLinea({ ev: 1, t: Date.parse(ts), nivel: 'atencion', texto: detalle });
}

/** Termina un python de la lista de procesos (SIGTERM y, si a los 5 s sigue, SIGKILL). */
async function terminarProceso(pid, usuario, ip) {
    if (!ES_LINUX) throw errorAccion('Se puede solo en el servidor (Linux).');
    const p = (procesosCache || []).find(x => x.pid === Number(pid));
    if (!p) throw errorAccion('Ese proceso ya no está en la lista: esperá la próxima muestra.');
    if (!p.python) throw errorAccion('Desde acá solo se pueden terminar procesos python.');
    try { process.kill(p.pid, 'SIGTERM'); }
    catch (e) { throw errorAccion(`No se pudo terminar: ${e.message}`); }
    setTimeout(() => { try { process.kill(p.pid, 0); process.kill(p.pid, 'SIGKILL'); } catch (_) { /* ya terminó */ } }, 5000).unref();
    const detalle = `Proceso terminado a mano: ${p.detalle || p.nombre} (pid ${p.pid}, ${(p.rssMB / 1024).toFixed(1)} GB)`;
    await auditar(usuario, ip, detalle);
    return detalle;
}

/** Corta una sesión de SQL que bloquea a otras o tiene una transacción abierta dormida (KILL: deshace su transacción). */
async function cortarSesionSql(sesion, usuario, ip) {
    const sid = Number(sesion);
    if (!Number.isInteger(sid) || sid <= 50) throw errorAccion('Sesión inválida.');
    const b = await sqlBloqueos();
    const candidata = [...(b.cabezas || []), ...(b.dormidas || [])].find(x => x.sesion === sid);
    if (!candidata) throw errorAccion('Esa sesión ya no bloquea ni tiene una transacción dormida: no se cortó.');
    const { getPool } = require('../config/db');
    const pool = await getPool();
    await pool.request().query(`KILL ${sid}`);   // sid validado: entero y entre los candidatos de recién
    bloqueosCache = await sqlBloqueos();
    const detalle = `Sesión de SQL cortada a mano: ${sid} (${candidata.programa || candidata.login || 'sin programa'}${candidata.transacciones ? `, ${candidata.transacciones} transacción(es) abierta(s)` : ''})`;
    await auditar(usuario, ip, detalle);
    return detalle;
}

// Cada arranque del backend queda en monitor/arranques-backend.jsonl (los últimos se ven en la pantalla)
function anotarArranque() {
    try {
        fs.mkdirSync(DIR_HISTORIA, { recursive: true });
        fs.appendFileSync(path.join(DIR_HISTORIA, 'arranques-backend.jsonl'), JSON.stringify({ t: Date.now() }) + '\n');
    } catch (_) { /* sin disco */ }
}

function iniciar(socketIo) {
    io = socketIo || io;
    if (arrancado || process.env.MONITOR_ENABLED === '0') return;
    arrancado = true;
    cpuPct();                                                            // primera lectura de referencia
    anotarArranque();
    cargarErroresDelArchivo();
    engancharLogger();
    const vuelta = async () => {
        try { await muestrear(); }
        catch (e) { logger.warn('[MONITOR] no se pudo tomar la muestra: ' + e.message); }
        setTimeout(vuelta, CADA_MS).unref();
    };
    setTimeout(vuelta, 1000).unref();
    logger.info('📈 [MONITOR] Monitor del servidor activo (muestra cada 5 s, 2 h de historia, 8 días en disco).');
}

/** Lo que devuelve GET /api/sysadmin/monitor. Con conHistoria, también las series de las últimas 2 h. */
function snapshot({ conHistoria = false } = {}) {
    if (!ultimo) return { listo: false, cadaMs: CADA_MS };
    const { alertasPush, ...resto } = ultimo;
    // De los destinatarios de los avisos solo se dice cuántos hay, no cuáles
    return { listo: true, cadaMs: CADA_MS, ...resto, avisos: { mails: alertasPush.mails.length, whatsapp: alertasPush.numeros.length }, eventos, ...(conHistoria ? { historia } : {}) };
}

module.exports = { iniciar, snapshot, registrarHttp, registrarErrorFront, registrarLatidoExterno, terminarProceso, cortarSesionSql, leerHistoria, resumenDia, fechaUY, _leerContenedor: leerContenedor, _pruebas: { leerIoRed, evaluar, medirRed, red: () => redCache, rutasTop } };
