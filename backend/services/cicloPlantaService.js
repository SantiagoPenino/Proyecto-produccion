// =============================================================================
// Ciclo en planta de cada orden (26/10/2026, plan INF-SIS-2026-04 «Tiempo de
// respuesta de las áreas de producción»).
//
// Ciclo = minutos laborales del área desde que la orden entró hasta que quedó
// pronta, menos los que se esperó al cliente. Se guarda una fila por orden en
// dbo.OrdenesCicloPlanta (backend/scripts/PROD_ordenes_ciclo_planta.sql); la llena
// el job «Ciclo en planta» y la leen el indicador de cada área, la planilla de
// finalizadas y la demora del Panel de Producción Avanzado.
//
//   Inicio   FechaIngreso (la orden se activa con los archivos completos en el mismo
//            minuto: en septiembre, solo 9 de 10.405 se activaron más de 30 min después).
//            TERMINAC: cuando la orden de ECOUV del mismo pedido termina de imprimir
//            (Control y Calidad o Pronto); su «Material Recibido» se registra 1–4 min
//            antes de terminar y no sirve. Orden que espera a otra (LiberaCuandoOrdenID):
//            cuando la otra queda pronta.
//   Fin      Ordenes.FechaPronto (la última vez que pasó a Pronto, o la finalización).
//   Horas    utils/horarioLaboral.js: horario del área, sin feriados, hora de Uruguay.
//   Espera   consultas al cliente abiertas y boceto TPU esperando la aprobación.
//   Entran   las no canceladas, menos las de PRO de venta directa (no se producen).
//   Pasos    (28/10) en qué se fue el ciclo, según las marcas de la orden: ver pasosDe().
// =============================================================================
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const { obtenerCalendario } = require('../utils/horarioLaboral');

// 01/07/2026 00:00 de Uruguay: desde ahí se calcula (todas las áreas tienen historial desde entonces).
const DESDE_INICIAL = new Date(Date.UTC(2026, 6, 1, 3));
const LOTE = 400;            // órdenes por consulta de datos
const FILAS_POR_MERGE = 150; // 11 parámetros por fila: lejos del tope de 2100 de SQL Server

// Mismo mapa de códigos equivalentes que getOrdersByArea (el portal guarda algunas órdenes con otro código).
const EQUIVALENTES = {
    DF: ['DF', 'DTF'], DTF: ['DTF', 'DF'],
    SB: ['SB', 'SUB'], SUB: ['SUB', 'SB'],
    DIRECTA: ['DIRECTA', 'IMD', 'XMD'], IMD: ['IMD', 'XMD', 'DIRECTA'], XMD: ['XMD', 'IMD', 'DIRECTA'],
};
const areasDe = (area) => { const a = String(area || '').trim().toUpperCase(); return EQUIVALENTES[a] || [a]; };

const PRIORIDADES = ['Normal', 'Urgente', 'Falla', 'Reposición'];
function prioridadDe(p) {
    const s = String(p || '').trim().toUpperCase();
    if (['FALLA', 'F'].includes(s)) return 'Falla';
    if (['REPOSICIÓN', 'REPOSICION', 'R'].includes(s)) return 'Reposición';
    if (['URGENTE', 'U'].includes(s)) return 'Urgente';
    return 'Normal';
}

// ¿Se corrió el script de la tabla? Sin ella no se calcula ni se muestra nada (se avisa una vez). La columna Pasos
// (28/10) es aparte: sin ella el ciclo anda igual, sin el detalle por paso.
let _tieneTabla = false;
let _tienePasos = false;
let _tieneConsultas = false;   // dbo.ConsultasCliente se crea sola la primera vez que se usa (consultasClienteService)
let _avisoSinTabla = false;
let _avisoSinPasos = false;
async function tieneTabla(pool) {
    if (_tieneTabla && _tienePasos) return true;
    const r = await pool.request().query(`SELECT OBJECT_ID('dbo.OrdenesCicloPlanta', 'U') AS id, OBJECT_ID('dbo.ConsultasCliente', 'U') AS cons,
                                                 COL_LENGTH('dbo.OrdenesCicloPlanta', 'Pasos') AS pasos`);
    _tieneTabla = r.recordset[0].id != null;
    _tienePasos = r.recordset[0].pasos != null;
    _tieneConsultas = r.recordset[0].cons != null;
    if (!_tieneTabla && !_avisoSinTabla) {
        _avisoSinTabla = true;
        logger.warn('[CICLO-PLANTA] Falta la tabla dbo.OrdenesCicloPlanta: correr backend/scripts/PROD_ordenes_ciclo_planta.sql.');
    } else if (_tieneTabla && !_tienePasos && !_avisoSinPasos) {
        _avisoSinPasos = true;
        logger.warn('[CICLO-PLANTA] Falta la columna Pasos en dbo.OrdenesCicloPlanta: correr backend/scripts/PROD_ordenes_ciclo_planta.sql. Sin ella no hay detalle por paso.');
    }
    return _tieneTabla;
}
/** Después de tieneTabla(): ¿está la columna Pasos? */
const tienePasos = () => _tieneTabla && _tienePasos;

// ── Cálculo ──────────────────────────────────────────────────────────────────

const ms = (d) => (d ? new Date(d).getTime() : null);

// Ventanas de espera del boceto TPU. Desde el 26/10 «Enviar a aprobación» deja 'Esperando' en el historial y cada
// vuelta (enviado → aprobado/rechazado) se descuenta. Lo anterior no tiene ese registro: se toma desde la subida
// del PDF del boceto hasta la aprobación, solo si aprobó el cliente desde el portal. Si lo confirmó el diseñador
// (pedido cargado por el personal, aprobarInternoTPU) no hubo espera del cliente: ese tiempo es de la planta.
function ventanasBoceto(o, hist, finMs) {
    const out = [];
    let abierta = null;
    for (const h of hist) {
        const t = ms(h.FechaInicio);
        if (h.Estado === 'Esperando') { if (abierta == null) abierta = t; }
        else if (abierta != null) { out.push([abierta, t]); abierta = null; }
    }
    if (abierta != null) out.push([abierta, finMs]);
    const aproboElCliente = hist.some(h => h.Estado === 'Aprobado' && /aprobado por el cliente/i.test(h.Detalle || ''));
    if (!hist.some(h => h.Estado === 'Esperando') && aproboElCliente
        && o.Boceto && o.FechaAprobacionCliente && ms(o.FechaAprobacionCliente) > ms(o.Boceto)) {
        out.push([ms(o.Boceto), ms(o.FechaAprobacionCliente)]);
    }
    return out;
}

// ── Pasos ────────────────────────────────────────────────────────────────────
// (28/10/2026, lo pidió Santiago: «necesito poder ver cuánto demora en cada paso».) Cada marca pone a la orden en un
// paso; los minutos laborales entre una marca y la siguiente, sin la espera del cliente, van al paso en curso. Las
// marcas que no son de la planta (En tránsito, Avisado…) no cambian el paso. Si una orden vuelve atrás (la sacan del
// lote, la desmontan de la máquina), el tiempo vuelve a contar en el paso al que volvió.
// (29/10) Manda la marca de la ORDEN: su tilde «impresa» en el detalle del lote (Ordenes.FechaImpreso). Los botones
// del lote («Iniciar producción», «Fin impresión») muchas veces se aprietan al final: DTF-37461 quedó tildada a las
// 11:48 y su lote se «inició» a las 13:17, un minuto antes de Pronto. Desde el tilde la orden está impresa y los
// botones del lote apretados después no la vuelven a producción (solo cuenta el arranque de la calandra). El tilde
// que pone el sistema al completarla (marcarImpresaAlCompletar, el mismo minuto que Pronto) no es una marca.
//   material       TERMINAC: desde que ECO UV terminó de imprimir hasta «Material Recibido». Ojo: el material se
//                  escanea minutos antes de terminar y las demás marcas van todas juntas, así que el trabajo de
//                  terminaciones queda casi entero en este paso.
//   diseno         TPU: desde que entra hasta que se aprueba el boceto (sin la espera del cliente).
//   lote           Pendiente: activada con los archivos, o retirada de un lote, hasta que la ponen en un lote.
//   espera         En un lote o asignada a la máquina, antes de «Inicio Produccion»; también las pausas.
//   en_lote        Lo mismo, cuando la orden quedó impresa sin que el lote marcara «Inicio Produccion» antes: ese rato
//                  es espera más impresión, y no hay marca para separarlas.
//   produccion     Desde «Inicio Produccion» hasta que la orden queda impresa (en TERMINAC, desde «Material Recibido»).
//   cola_calandra  SUB: desde que quedó impresa o el lote pasó a calandra («Pasa a Calandra», «Sin calandra
//                  disponible») hasta que arranca la calandra.
//   calandra       SUB: el «Inicio Produccion» que viene después del pase a calandra es el de la calandra.
//   control        Desde que quedó impresa (su tilde, «Fin Impresion - Enviado a Control», Control y Calidad) hasta
//                  Pronto. Sin tilde ni «Fin impresión», el rato hasta Pronto queda en producción.
//   falla          Con Falla, hasta que la orden sigue.
const PASOS = ['material', 'diseno', 'lote', 'espera', 'en_lote', 'produccion', 'cola_calandra', 'calandra', 'control', 'falla'];
const ANTES_DE_IMPRIMIR = new Set(['diseno', 'lote', 'espera', 'produccion']);
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const pasaACalandra = (d) => d.startsWith('fin impresion - pasa a calandra') || d.startsWith('fin impresion - sin calandra');

/** A qué paso lleva una marca del historial, o null si no cambia el paso. */
function siguientePaso(actual, estado, detalle) {
    const d = sinTildes(detalle);
    const { calandra: cal, impresa: imp = false } = actual;
    if (d.startsWith('fin impresion')) {
        if (pasaACalandra(d)) return { paso: 'cola_calandra', calandra: true, impresa: imp };
        return { paso: 'control', calandra: cal, impresa: imp };
    }
    // Ya impresa: «Iniciar producción» o «Asignado a máquina» apretados después en el lote no la devuelven atrás.
    const tarde = imp && !cal;
    if (d.startsWith('inicio produccion')) return tarde ? null : { paso: cal ? 'calandra' : 'produccion', calandra: cal, impresa: imp };
    switch (sinTildes(estado)) {
        case 'pendiente': case 'aprobado': return { paso: 'lote', calandra: false, impresa: false };
        case 'disenado': case 'esperando': case 'rechazado': return { paso: 'diseno', calandra: false, impresa: false };
        case 'en lote': case 'en maquina': return tarde ? null : { paso: cal ? 'cola_calandra' : 'espera', calandra: cal, impresa: imp };
        case 'material recibido': case 'en terminaciones': return { paso: 'produccion', calandra: cal, impresa: imp };
        case 'control y calidad': return { paso: 'control', calandra: cal, impresa: imp };
        case 'con falla': return { paso: 'falla', calandra: cal, impresa: imp };
        default: return null;
    }
}

/** El tilde «impresa» de la orden: termina su producción. Si ya estaba después (control, calandra, falla), sigue ahí. */
function alImprimirse(actual, vaACalandra) {
    if (!ANTES_DE_IMPRIMIR.has(actual.paso)) return { ...actual, impresa: true };
    return { paso: vaACalandra ? 'cola_calandra' : 'control', calandra: actual.calandra, impresa: true };
}

/** Minutos del ciclo por paso: { lote: 95, espera: 40, … } (solo los pasos con minutos; suman MinutosCiclo). */
function pasosDe(o, cal, hist, ventanas, inicio, fin, minutosCiclo) {
    let actual = { paso: o.AreaID === 'TPU' ? 'diseno' : o.AreaID === 'TERMINAC' ? 'material' : 'lote', calandra: false, impresa: false };
    const tramos = [];   // [paso, desde, hasta]
    let desde = inicio;
    const cerrar = (hasta) => { if (hasta > desde) tramos.push([actual.paso, desde, hasta]); };
    // El tilde entra como una marca más, en su lugar del historial, si cae dentro del ciclo y no es el del Pronto.
    const tilde = ms(o.FechaImpreso);
    const marcas = [...hist];
    if (tilde != null && tilde > inicio && tilde < fin - 60000) {
        const i = marcas.findIndex(h => ms(h.FechaInicio) > tilde);
        marcas.splice(i < 0 ? marcas.length : i, 0, { tilde: true, FechaInicio: tilde });
    }
    const vaACalandra = hist.some(h => pasaACalandra(sinTildes(h.Detalle)));
    let tramosAntesDelTilde = -1;
    for (const h of marcas) {
        const t = ms(h.FechaInicio);
        if (t == null || t >= fin) continue;
        const sig = h.tilde ? alImprimirse(actual, vaACalandra) : siguientePaso(actual, h.Estado, h.Detalle);
        if (!sig) continue;
        // Las marcas de antes del inicio (TERMINAC, liberadas) solo dicen en qué paso arranca.
        if (t > inicio) { cerrar(t); desde = t; }
        if (h.tilde && actual.paso === 'espera') tramosAntesDelTilde = tramos.length;
        actual = sig;
    }
    cerrar(fin);
    // Quedó impresa esperando (sin «Inicio Produccion» del lote, o en pausa): esa espera también fue impresión.
    for (let i = tramosAntesDelTilde - 1; i >= 0 && tramos[i][0] === 'espera'; i--) tramos[i][0] = 'en_lote';

    const acum = {};
    for (const [paso, a, b] of tramos) {
        const lab = cal.minutosLaborales(o.AreaID, a, b);
        const esp = ventanas.length ? cal.minutosEnVentanas(o.AreaID, ventanas, a, b) : 0;
        acum[paso] = (acum[paso] || 0) + Math.max(0, lab - esp);
    }

    const pasos = {};
    for (const k of PASOS) { const v = Math.round(acum[k] || 0); if (v > 0) pasos[k] = v; }
    // El redondeo de cada paso puede dejar un par de minutos de diferencia con el ciclo: van al paso más largo.
    const claves = Object.keys(pasos);
    const dif = minutosCiclo - claves.reduce((t, k) => t + pasos[k], 0);
    if (dif && claves.length) {
        const mayor = claves.reduce((a, b) => (pasos[b] > pasos[a] ? b : a));
        pasos[mayor] = Math.max(0, pasos[mayor] + dif);
    }
    return pasos;
}

const ESTADOS_BOCETO = ['Esperando', 'Aprobado', 'Rechazado'];

function cicloDe(o, cal, hist, consultas) {
    const fin = ms(o.FechaPronto);
    let inicio = ms(o.FechaIngreso) ?? fin;
    let origen = 'INGRESO';
    const euv = ms(o.EuvImpreso);
    if (euv && euv > inicio && euv < fin) { inicio = euv; origen = 'IMPRESION_EUV'; }
    const lib = ms(o.Liberada);
    if (lib && lib > inicio && lib < fin) { inicio = lib; origen = 'LIBERADA'; }
    if (!(inicio <= fin)) inicio = fin;

    const laborales = cal.minutosLaborales(o.AreaID, inicio, fin);
    const ventanas = [
        ...(o.AreaID === 'TPU' ? ventanasBoceto(o, (hist || []).filter(h => ESTADOS_BOCETO.includes(h.Estado)), fin) : []),
        ...(consultas || []).map(c => [ms(c.ConFechaAlta), ms(c.ConFechaRespuesta) ?? fin]),
    ];
    const espera = ventanas.length ? cal.minutosEnVentanas(o.AreaID, ventanas, inicio, fin) : 0;
    const minutosCiclo = Math.max(0, Math.round(laborales - espera));
    return {
        OrdenID: o.OrdenID,
        AreaID: o.AreaID,
        Prioridad: prioridadDe(o.Prioridad),
        Inicio: new Date(inicio),
        OrigenInicio: origen,
        Fin: o.FechaPronto,
        MinutosLaborales: Math.round(laborales),
        MinutosEsperaCliente: Math.round(espera),
        MinutosCiclo: minutosCiclo,
        MinutosCorridos: Math.round((fin - inicio) / 60000),
        Pasos: JSON.stringify(pasosDe(o, cal, hist || [], ventanas, inicio, fin, minutosCiclo)),
    };
}

async function grabar(pool, filas) {
    const conPasos = tienePasos();
    for (let i = 0; i < filas.length; i += FILAS_POR_MERGE) {
        const parte = filas.slice(i, i + FILAS_POR_MERGE);
        const r = pool.request();
        const valores = parte.map((f, k) => {
            if (conPasos) r.input(`s${k}`, sql.NVarChar(400), f.Pasos);
            r.input(`o${k}`, sql.Int, f.OrdenID);
            r.input(`a${k}`, sql.VarChar(20), f.AreaID);
            r.input(`p${k}`, sql.VarChar(20), f.Prioridad);
            r.input(`i${k}`, sql.DateTime, f.Inicio);
            r.input(`g${k}`, sql.VarChar(20), f.OrigenInicio);
            r.input(`f${k}`, sql.DateTime, f.Fin);
            r.input(`l${k}`, sql.Int, f.MinutosLaborales);
            r.input(`e${k}`, sql.Int, f.MinutosEsperaCliente);
            r.input(`c${k}`, sql.Int, f.MinutosCiclo);
            r.input(`r${k}`, sql.Int, f.MinutosCorridos);
            return `(@o${k}, @a${k}, @p${k}, @i${k}, @g${k}, @f${k}, @l${k}, @e${k}, @c${k}, @r${k}${conPasos ? `, @s${k}` : ''})`;
        });
        await r.query(`
            MERGE dbo.OrdenesCicloPlanta AS t
            USING (VALUES ${valores.join(', ')})
                AS s (OrdenID, AreaID, Prioridad, Inicio, OrigenInicio, Fin, MinutosLaborales, MinutosEsperaCliente, MinutosCiclo, MinutosCorridos${conPasos ? ', Pasos' : ''})
            ON t.OrdenID = s.OrdenID
            WHEN MATCHED THEN UPDATE SET AreaID = s.AreaID, Prioridad = s.Prioridad, Inicio = s.Inicio, OrigenInicio = s.OrigenInicio,
                Fin = s.Fin, MinutosLaborales = s.MinutosLaborales, MinutosEsperaCliente = s.MinutosEsperaCliente,
                MinutosCiclo = s.MinutosCiclo, MinutosCorridos = s.MinutosCorridos${conPasos ? ', Pasos = s.Pasos' : ''}, CalculadoEn = GETDATE()
            WHEN NOT MATCHED THEN INSERT (OrdenID, AreaID, Prioridad, Inicio, OrigenInicio, Fin, MinutosLaborales, MinutosEsperaCliente, MinutosCiclo, MinutosCorridos${conPasos ? ', Pasos' : ''})
                VALUES (s.OrdenID, s.AreaID, s.Prioridad, s.Inicio, s.OrigenInicio, s.Fin, s.MinutosLaborales, s.MinutosEsperaCliente, s.MinutosCiclo, s.MinutosCorridos${conPasos ? ', s.Pasos' : ''});`);
    }
}

/** Calcula y graba el ciclo de estas órdenes (las que no tienen FechaPronto o no corresponden se saltean). */
async function calcular(pool, ids) {
    if (!ids.length) return 0;
    const cal = await obtenerCalendario(pool);
    let grabadas = 0;
    for (let i = 0; i < ids.length; i += LOTE) {
        const lote = JSON.stringify(ids.slice(i, i + LOTE).map(Number));
        const datos = await pool.request().input('ids', sql.NVarChar(sql.MAX), lote).query(`
            SELECT o.OrdenID, LTRIM(RTRIM(o.AreaID)) AS AreaID, o.Prioridad, o.FechaIngreso, o.FechaPronto, o.FechaImpreso,
                   lib.FechaPronto AS Liberada, euv.Impreso AS EuvImpreso, bo.Boceto, o.FechaAprobacionCliente
            FROM dbo.Ordenes o
            LEFT JOIN dbo.Ordenes lib ON lib.OrdenID = o.LiberaCuandoOrdenID AND lib.Estado <> 'Cancelado'
            OUTER APPLY (SELECT MIN(h.FechaInicio) AS Impreso
                         FROM dbo.Ordenes e JOIN dbo.HistorialOrdenes h ON h.OrdenID = e.OrdenID
                         WHERE o.AreaID = 'TERMINAC' AND e.NoDocERP = o.NoDocERP AND e.AreaID = 'ECOUV'
                           AND e.Estado <> 'Cancelado' AND h.Estado IN ('Control y Calidad', 'Pronto')) euv
            OUTER APPLY (SELECT MIN(a.FechaSubida) AS Boceto FROM dbo.ArchivosOrden a
                         WHERE o.AreaID = 'TPU' AND a.OrdenID = o.OrdenID AND a.NombreArchivo LIKE '%boceto%') bo
            WHERE o.OrdenID IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids))
              AND o.FechaPronto IS NOT NULL AND o.Estado <> 'Cancelado'
              AND ISNULL(o.EstadoDependencia, '') <> 'VENTA_DIRECTA'`);
        const ordenes = datos.recordset;
        if (!ordenes.length) continue;

        // Historial entero de las órdenes: los pasos (todas) y las ventanas del boceto (TPU). Las marcas posteriores
        // al Pronto (En tránsito, Avisado, Entregado) no se usan.
        const hist = {};
        const h = await pool.request().input('ids', sql.NVarChar(sql.MAX), JSON.stringify(ordenes.map(o => o.OrdenID))).query(`
            SELECT h.OrdenID, h.Estado, h.FechaInicio, LEFT(h.Detalle, 200) AS Detalle FROM dbo.HistorialOrdenes h
            WHERE h.OrdenID IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids))
              AND h.Estado NOT IN ('En transito', 'Avisado', 'Entregado', 'Ingresado', 'Recibido en Destino')
            ORDER BY h.OrdenID, h.FechaInicio, h.HistorialID`);
        for (const x of h.recordset) (hist[x.OrdenID] = hist[x.OrdenID] || []).push(x);
        const consultas = {};
        if (_tieneConsultas) {
            const c = await pool.request().input('ids', sql.NVarChar(sql.MAX), lote).query(`
                SELECT OrdIdOrden, ConFechaAlta, ConFechaRespuesta FROM dbo.ConsultasCliente
                WHERE OrdIdOrden IN (SELECT CAST(value AS INT) FROM OPENJSON(@ids))`);
            for (const x of c.recordset) (consultas[x.OrdIdOrden] = consultas[x.OrdIdOrden] || []).push(x);
        }

        const filas = ordenes.map(o => cicloDe(o, cal, hist[o.OrdenID], consultas[o.OrdenID]));
        await grabar(pool, filas);
        grabadas += filas.length;
    }
    return grabadas;
}

/**
 * Lo que hace el job: calcula las órdenes prontas sin ciclo o con otra FechaPronto (volvieron a Pronto) y borra
 * las filas de las que ya no corresponden (canceladas después, o que perdieron la FechaPronto).
 */
async function procesarPendientes(pool) {
    if (!(await tieneTabla(pool))) return { calculadas: 0, borradas: 0, sinTabla: true };
    const borr = await pool.request().query(`
        DELETE c FROM dbo.OrdenesCicloPlanta c
        LEFT JOIN dbo.Ordenes o ON o.OrdenID = c.OrdenID
        WHERE o.OrdenID IS NULL OR o.FechaPronto IS NULL OR o.Estado = 'Cancelado'
           OR ISNULL(o.EstadoDependencia, '') = 'VENTA_DIRECTA'`);
    let calculadas = 0;
    for (let vuelta = 0; vuelta < 50; vuelta++) {
        const r = await pool.request().input('desde', sql.DateTime, DESDE_INICIAL).query(`
            SELECT TOP 5000 o.OrdenID
            FROM dbo.Ordenes o
            LEFT JOIN dbo.OrdenesCicloPlanta c ON c.OrdenID = o.OrdenID
            WHERE o.FechaPronto >= @desde AND o.Estado <> 'Cancelado'
              AND ISNULL(o.EstadoDependencia, '') <> 'VENTA_DIRECTA'
              AND (c.OrdenID IS NULL OR DATEDIFF(SECOND, c.Fin, o.FechaPronto) <> 0${tienePasos() ? ' OR c.Pasos IS NULL' : ''})
            ORDER BY o.FechaPronto`);
        const ids = r.recordset.map(x => x.OrdenID);
        if (!ids.length) break;
        calculadas += await calcular(pool, ids);
        if (ids.length < 5000) break;
    }
    return { calculadas, borradas: borr.rowsAffected[0] || 0 };
}

/**
 * Rehace los ciclos ya guardados (todas las áreas o una), p. ej. al cambiar un horario o un feriado.
 * Corre en segundo plano: quien la llama no la espera.
 */
async function recalcular(pool, { area = null } = {}) {
    if (!(await tieneTabla(pool))) return 0;
    const r = pool.request();
    let filtro = '';
    if (area) {
        const lista = areasDe(area);
        lista.forEach((a, i) => r.input(`a${i}`, sql.VarChar(20), a));
        filtro = `WHERE AreaID IN (${lista.map((_, i) => `@a${i}`).join(', ')})`;
    }
    const ids = (await r.query(`SELECT OrdenID FROM dbo.OrdenesCicloPlanta ${filtro}`)).recordset.map(x => x.OrdenID);
    const n = await calcular(pool, ids);
    logger.info(`[CICLO-PLANTA] Recalculadas ${n} órdenes${area ? ` de ${area}` : ''}.`);
    return n;
}

let recalculoEnCurso = Promise.resolve();
/** Para los controladores de horario y feriados: encola el recálculo y no lo espera. */
function recalcularEnSegundoPlano(pool, opciones) {
    require('../utils/horarioLaboral').invalidarCalendario();
    recalculoEnCurso = recalculoEnCurso
        .then(() => recalcular(pool, opciones))
        .catch(e => logger.error(`[CICLO-PLANTA] No se pudo recalcular: ${e.message}`));
}

// ── Lectura: indicador del área ──────────────────────────────────────────────

const promedio = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);
function mediana(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const redondo = (x) => (x == null ? null : Math.round(x));
let _avisoPasosIlegibles = false;
function leerPasos(txt) {
    if (!txt) return null;
    try { return JSON.parse(txt); } catch (e) {
        if (!_avisoPasosIlegibles) { _avisoPasosIlegibles = true; logger.warn(`[CICLO-PLANTA] Pasos ilegibles («${String(txt).slice(0, 60)}»): ${e.message}`); }
        return null;
    }
}
// Lunes (hora de Uruguay) de la semana del instante, como 'AAAA-MM-DD'
function lunesDe(fecha) {
    const d = new Date(new Date(fecha).getTime() - 3 * 3600000);
    const dia = (d.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia)).toISOString().slice(0, 10);
}
// 'AAAA-MM-DD' de Uruguay → instante de su 00:00
const inicioDiaUY = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 3)); };

/**
 * Indicador de un área: promedio y mediana del ciclo de las órdenes de clientes (Normal y Urgente) que quedaron
 * prontas en el período, el detalle por prioridad, las últimas 8 semanas y las 10 más lentas.
 * @param {{ area: string, dias?: number, desde?: string, hasta?: string }} p desde/hasta 'AAAA-MM-DD' de Uruguay (hasta inclusive)
 */
async function resumenArea(pool, { area, dias = 30, desde = null, hasta = null }) {
    const cal = await obtenerCalendario(pool);
    const base = {
        area, tieneHorario: cal.tieneHorario(area), minutosJornada: Math.round(cal.minutosJornada(area)),
    };
    if (!(await tieneTabla(pool))) return { ...base, sinTabla: true };

    const fin = hasta ? new Date(inicioDiaUY(hasta).getTime() + 86400000) : new Date();
    const ini = desde ? inicioDiaUY(desde) : new Date(fin.getTime() - Math.max(1, Number(dias) || 30) * 86400000);
    // Las semanas siempre muestran las últimas 8, aunque el período sea más corto.
    const lunesHace7 = inicioDiaUY(lunesDe(new Date(fin.getTime() - 7 * 7 * 86400000)));
    const leerDesde = ini < lunesHace7 ? ini : lunesHace7;

    const r = pool.request().input('desde', sql.DateTime, leerDesde).input('hasta', sql.DateTime, fin);
    const lista = areasDe(area);
    lista.forEach((a, i) => r.input(`a${i}`, sql.VarChar(20), a));
    const conPasos = tienePasos();
    const filas = (await r.query(`
        SELECT c.OrdenID, c.Prioridad, c.Inicio, c.Fin, c.OrigenInicio, c.MinutosCiclo, c.MinutosLaborales,
               c.MinutosEsperaCliente, c.MinutosCorridos, o.CodigoOrden, o.Cliente${conPasos ? ', c.Pasos' : ''}
        FROM dbo.OrdenesCicloPlanta c
        JOIN dbo.Ordenes o ON o.OrdenID = c.OrdenID
        WHERE c.AreaID IN (${lista.map((_, i) => `@a${i}`).join(', ')})
          AND c.Fin >= @desde AND c.Fin < @hasta`)).recordset;
    for (const f of filas) f.pasos = conPasos ? leerPasos(f.Pasos) : null;

    const clientes = (f) => f.Prioridad === 'Normal' || f.Prioridad === 'Urgente';
    const enPeriodo = filas.filter(f => new Date(f.Fin) >= ini);
    const principal = enPeriodo.filter(clientes);
    const mins = principal.map(f => f.MinutosCiclo);

    // Por paso: promedio por orden contando las que no pasaron por el paso como 0 (así los pasos suman el promedio
    // del ciclo) y, aparte, el promedio de las que sí pasaron. Solo sobre las órdenes que ya tienen los pasos
    // calculados (mientras el job los completa, pasosOrdenes < ordenes).
    const conDetalle = principal.filter(f => f.pasos);
    const pasos = !conPasos ? null : PASOS.map(k => {
        const v = conDetalle.map(f => f.pasos[k] || 0);
        const con = v.filter(x => x > 0);
        return { paso: k, ordenes: con.length, promedio: redondo(promedio(v)), promedioConPaso: redondo(promedio(con)) };
    }).filter(p => p.ordenes > 0);

    const semanas = {};
    for (const f of filas.filter(clientes)) (semanas[lunesDe(f.Fin)] = semanas[lunesDe(f.Fin)] || []).push(f.MinutosCiclo);
    const listaSemanas = [];
    for (let s = lunesDe(lunesHace7), k = 0; k < 8; k++) {
        const v = semanas[s] || [];
        listaSemanas.push({ semana: s, ordenes: v.length, promedio: redondo(promedio(v)), mediana: redondo(mediana(v)) });
        const [y, m, d] = s.split('-').map(Number);
        s = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
    }

    return {
        ...base,
        desde: new Date(ini.getTime() - 3 * 3600000).toISOString().slice(0, 10),
        hasta: new Date(fin.getTime() - 3 * 3600000 - 1).toISOString().slice(0, 10),
        ordenes: principal.length,
        promedio: redondo(promedio(mins)),
        mediana: redondo(mediana(mins)),
        esperaClientePromedio: redondo(promedio(principal.map(f => f.MinutosEsperaCliente))),
        corridosPromedio: redondo(promedio(principal.map(f => f.MinutosCorridos))),
        porPrioridad: PRIORIDADES.map(p => {
            const v = enPeriodo.filter(f => f.Prioridad === p).map(f => f.MinutosCiclo);
            return { prioridad: p, ordenes: v.length, promedio: redondo(promedio(v)), mediana: redondo(mediana(v)) };
        }),
        pasos,
        pasosOrdenes: conDetalle.length,
        semanas: listaSemanas,
        lentas: [...principal].sort((a, b) => b.MinutosCiclo - a.MinutosCiclo).slice(0, 10).map(f => ({
            ordenId: f.OrdenID, codigo: f.CodigoOrden, cliente: f.Cliente, prioridad: f.Prioridad,
            inicio: f.Inicio, fin: f.Fin, origenInicio: f.OrigenInicio,
            minutosCiclo: f.MinutosCiclo, minutosEsperaCliente: f.MinutosEsperaCliente, minutosCorridos: f.MinutosCorridos,
            pasos: f.pasos,
        })),
    };
}

/** Ciclo guardado de una orden (detalle de la orden), o null. */
async function cicloDeOrden(pool, ordenId) {
    if (!(await tieneTabla(pool))) return null;
    const conPasos = tienePasos();
    const r = await pool.request().input('id', sql.Int, ordenId).query(`
        SELECT OrdenID, AreaID, Prioridad, Inicio, OrigenInicio, Fin, MinutosLaborales, MinutosEsperaCliente, MinutosCiclo, MinutosCorridos${conPasos ? ', Pasos' : ''}
        FROM dbo.OrdenesCicloPlanta WHERE OrdenID = @id`);
    const c = r.recordset[0];
    if (!c) return null;
    const cal = await obtenerCalendario(pool);
    const { Pasos, ...resto } = c;
    return { ...resto, pasos: conPasos ? leerPasos(Pasos) : null, minutosJornada: Math.round(cal.minutosJornada(c.AreaID)), tieneHorario: cal.tieneHorario(c.AreaID) };
}

module.exports = {
    procesarPendientes, recalcular, recalcularEnSegundoPlano, calcular, resumenArea, cicloDeOrden, tieneTabla, tienePasos,
    leerPasos, prioridadDe, DESDE_INICIAL, PASOS, pasosDe,
};
