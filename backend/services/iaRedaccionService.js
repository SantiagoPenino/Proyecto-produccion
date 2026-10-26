/**
 * iaRedaccionService.js — "Pasar en limpio" la respuesta de un ticket de soporte (14/10/2026).
 *
 * El operador escribe rápido ("hola buenas como estas me dice q en su diseño le quedo varias lineas")
 * y la IA devuelve EL MISMO mensaje bien escrito: ortografía, tildes, puntuación, mayúsculas y frases
 * claras. No agrega ni saca información: el operador revisa el resultado antes de enviarlo.
 *
 * Usa Gemini por REST (la misma cuenta que el informe de producción: GEMINI_API_KEY). Sin SDK: el
 * paquete @google/generative-ai está deprecado y un fetch alcanza.
 *
 * Modelos (22/10): los dos Flash-Lite (GEMINI_MODEL y el alias que siempre apunta al Flash-Lite
 * vigente) se piden A LA VEZ y gana el primero que contesta bien. Si a los 4 s ninguno contestó, o
 * alguno ya falló, entran las reservas: dos Flash "enteros" (GEMINI_MODEL_RESERVA, separados por coma),
 * más caros pero en otra capacidad de Google. Probado el 22/10 en plena saturación: los Flash-Lite
 * daban 503 o tardaban 17 s y gemini-3.5-flash contestó en 1-2 s. El 26/10 fue al revés: el 3.5-flash
 * daba 503 y el 3-flash-preview contestó en 1,7 s; por eso son dos.
 */
const logger = require('../utils/logger');

const MODELO_DEFAULT = 'gemini-3.1-flash-lite';   // probado 15/10: mejor que el 3.5-lite (saludos y trato) y más barato; el 2.5-lite ya no se habilita a claves nuevas
const MODELO_RESPALDO = 'gemini-flash-lite-latest';
const MODELOS_RESERVA = ['gemini-3.5-flash', 'gemini-3-flash-preview'];   // el 2.5-flash ya no se habilita a claves nuevas (404 el 22/10)
const MAX_CARACTERES = 4000;
// Tiempos (19/10): Google tardó más de 20 s y el operador esperó 20 y 27 s para recibir un error.
// Todo el pedido espera hasta 25 s. Cada modelo espera hasta ese límite y no se corta antes (26/10):
// el corte a los 12 s venía de cuando se probaban de a uno, y en paralelo solo tiraba respuestas
// que llegaban a los 15-19 s (el 26/10 el 3.1-flash-lite contestó a los 19 s y se había descartado).
const TOTAL_MS = 25000;
const MINIMO_PARA_INTENTAR_MS = 4000;
// Un Flash-Lite normal contesta en 1,5-2,5 s (medido 22/10): si a los 4 s no hay nada, está saturado
const RESERVA_TRAS_MS = 4000;
const SATURADO = [429, 500, 503];

const INSTRUCCIONES = `Sos el asistente de redacción del equipo de atención al cliente de USER, una empresa uruguaya de producción textil y gráfica.
Recibís el BORRADOR de un mensaje que escribió un operador. Devolvé ese MISMO mensaje pasado en limpio y con un tono amigable.

Qué hacer:
- Poné las comas, puntos, signos de pregunta, mayúsculas y tildes que falten, y corregí la ortografía.
- Reemplazá abreviaturas de chat ("q" por "que", "xq" por "porque", "ud" por "usted").
- Respetá el saludo del borrador: "buenos días", "buenas tardes" o "buenas noches" se mantienen; solo "hola buenas" (incompleto) pasa a "¡Hola!".
- Dale un tono amigable y cálido, pero prolijo y profesional: cercano, claro y respetuoso, sin muletillas de chat.

Reglas que no se rompen:
- No agregues información, promesas, plazos, montos, disculpas ni despedidas que no estén en el borrador.
- No saques información del borrador.
- Mantené tal cual nombres, números de pedido u orden (por ejemplo SUB-30710), montos, fechas y medidas.
- Mantené el sentido exacto y quién dice cada cosa: si el borrador dice "me dice que", "me comenta que", es lo que contó el cliente; no lo conviertas en una afirmación del operador.
- Trato: si el borrador trata al cliente de usted en ALGUNA parte ("ud", "usted", "su diseño", "le parece", "me dice"), escribí TODO el mensaje de usted, también el saludo ("¿cómo está?", nunca "¿cómo estás?"). Si no, usá "vos", como se habla en Uruguay.
- Español de Uruguay. Sin emojis, sin firma, sin comillas alrededor del texto.
- Respondé SOLO con el mensaje corregido, sin explicaciones.

Ejemplos:
Borrador: hola buenas como estas me dice q en su diseño le quedo varias lineas
Corregido: ¡Hola! ¿Cómo está? Me comenta que en su diseño quedaron varias líneas.
Borrador: hola buenos dias como estas ud me habia pedido el archivo en pdf ya se lo mande
Corregido: Buenos días, ¿cómo está? Usted me había pedido el archivo en PDF: ya se lo mandé.
Borrador: si ya esta pronto el pedido SUB-30710 lo podes pasar a retirar mañana despues de las 14
Corregido: ¡Sí! El pedido SUB-30710 ya está pronto. Podés pasar a retirarlo mañana después de las 14 h.`;

class ErrorIA extends Error {
    constructor(mensaje, status = 503) { super(mensaje); this.status = status; }
}

// Corregir redacción no necesita "pensar" y sin eso responde más rápido. Cada familia lo apaga distinto
// y no todas aceptan lo mismo (el 3.8-flash y el flash-latest rechazan 'minimal' con 400): a las que no
// están acá no se les manda nada. Los Flash-Lite 3.x ya vienen sin razonar.
function configRazonamiento(modelo) {
    if (/^gemini-2\.5/.test(modelo)) return { thinkingBudget: 0 };
    if (/^gemini-3(\.5)?-flash(-preview)?$/.test(modelo)) return { thinkingLevel: 'minimal' };   // probado 22/10: 3.5-flash y 3-flash-preview
    return null;
}

async function llamarGemini(modelo, texto, esNotaInterna, apiKey, timeoutMs, cancelar) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // Otro modelo ya contestó: se corta este pedido
    const alCancelar = () => ctrl.abort();
    cancelar?.addEventListener('abort', alCancelar);
    const razonamiento = configRazonamiento(modelo);
    try {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: ctrl.signal,
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: INSTRUCCIONES }] },
                contents: [{
                    role: 'user',
                    parts: [{ text: (esNotaInterna ? 'Es una NOTA INTERNA para el equipo (no la lee el cliente).\n\n' : 'Es una respuesta para el CLIENTE.\n\n') + 'Borrador:\n' + texto }],
                }],
                generationConfig: Object.assign({ temperature: 0.2, maxOutputTokens: 2048 },
                    razonamiento ? { thinkingConfig: razonamiento } : {}),
            }),
        });
        const data = await resp.json().catch(() => ({}));
        return { status: resp.status, data };
    } finally {
        clearTimeout(timer);
        cancelar?.removeEventListener('abort', alCancelar);
    }
}

/**
 * Un modelo hasta tener el texto, con un reintento corto si Google está saturado ("high demand",
 * 503/500) o en un límite momentáneo (429). Devuelve { texto, modelo } o lanza un Error con .status
 * (respuesta HTTP de Google), .tarde (no contestó a tiempo) o .vacia (contestó sin texto).
 */
async function correrModelo(modelo, borrador, esNotaInterna, apiKey, restante, cancelar) {
    const llamar = async () => {
        try {
            return await llamarGemini(modelo, borrador, esNotaInterna, apiKey, restante(), cancelar);
        } catch (e) {
            if (e.name !== 'AbortError' || cancelar.aborted) throw e;
            throw Object.assign(new Error('la IA tardó demasiado en responder'), { tarde: true });
        }
    };
    let r = await llamar();
    if (SATURADO.includes(r.status) && restante() > 1200 + MINIMO_PARA_INTENTAR_MS && !cancelar.aborted) {
        logger.warn(`[IA-REDACCION] ${modelo}: ${r.data?.error?.message || r.status} — reintento`);
        await new Promise(ok => setTimeout(ok, 1200));
        if (cancelar.aborted) throw new Error('cancelado');
        r = await llamar();
    }
    if (r.status !== 200) throw Object.assign(new Error(r.data?.error?.message || `HTTP ${r.status}`), { status: r.status });
    const cand = r.data?.candidates?.[0];
    const salida = (cand?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!salida) throw Object.assign(new Error(`respuesta vacía (finishReason ${cand?.finishReason || '?'})`), { vacia: true });
    return { texto: salida.replace(/^["“”«»']+|["“”«»']+$/g, '').trim(), modelo };
}

/** El mensaje para el operador cuando ningún modelo contestó: la causa más útil primero. */
function errorFinal(fallas) {
    const clave = fallas.find(f => f.error.status === 401 || f.error.status === 403);
    if (clave) return new ErrorIA(`Google rechazó la clave de la IA: ${clave.error.message}`);
    if (fallas.every(f => f.error.status === 404)) return new ErrorIA('No hay un modelo de IA disponible. Revisá GEMINI_MODEL y GEMINI_MODEL_RESERVA en el servidor.');
    if (fallas.some(f => SATURADO.includes(f.error.status))) return new ErrorIA('La IA está saturada en este momento. Probá en un minuto o mandalo como está.');
    if (fallas.some(f => f.error.tarde)) return new ErrorIA('La IA está tardando demasiado en este momento. Probá de nuevo en un rato o mandalo como está.');
    if (fallas.some(f => f.error.vacia)) return new ErrorIA('La IA no devolvió texto. Probá de nuevo o mandalo como está.');
    return new ErrorIA(`No se pudo pasar en limpio: ${fallas[fallas.length - 1]?.error.message || 'error desconocido'}. Probá de nuevo en un rato o mandalo como está.`);
}

/** Devuelve el texto pasado en limpio. Lanza ErrorIA con un mensaje para mostrar al operador. */
async function pasarEnLimpio(texto, { esNotaInterna = false } = {}) {
    const borrador = String(texto || '').trim();
    if (!borrador) throw new ErrorIA('No hay texto para pasar en limpio.', 400);
    if (borrador.length > MAX_CARACTERES) throw new ErrorIA(`El texto es muy largo (máximo ${MAX_CARACTERES} caracteres).`, 400);

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (apiKey.length < 20) throw new ErrorIA('La IA no está configurada en el servidor (falta GEMINI_API_KEY).');

    const principales = [...new Set([(process.env.GEMINI_MODEL || '').trim() || MODELO_DEFAULT, MODELO_RESPALDO])];
    const configReserva = (process.env.GEMINI_MODEL_RESERVA || '').split(',').map(m => m.trim()).filter(Boolean);
    const reservas = [...new Set(configReserva.length ? configReserva : MODELOS_RESERVA)].filter(m => !principales.includes(m));
    const limite = Date.now() + TOTAL_MS;
    const restante = () => limite - Date.now();
    const cancelar = new AbortController();
    const fallas = [];

    return new Promise((resolver, rechazar) => {
        let pendientes = 0;
        let reservaLanzada = reservas.length === 0;
        let terminado = false;
        const terminar = () => { terminado = true; clearTimeout(timerReserva); cancelar.abort(); };
        const cerrarSiNoQuedaNada = () => {
            if (pendientes > 0 || !reservaLanzada || terminado) return;
            terminar();
            logger.error(`[IA-REDACCION] ningún modelo respondió: ${fallas.map(f => `${f.modelo}: ${f.error.message}`).join(' | ')}`);
            rechazar(errorFinal(fallas));
        };
        const lanzar = (modelo) => {
            pendientes++;
            correrModelo(modelo, borrador, esNotaInterna, apiKey, restante, cancelar.signal).then(res => {
                if (terminado) return;
                terminar();
                if (reservas.includes(modelo)) logger.info(`[IA-REDACCION] contestó la reserva ${modelo} (los Flash-Lite no respondieron)`);
                resolver(res);
            }, error => {
                if (terminado) return;
                pendientes--;
                fallas.push({ modelo, error });
                logger.warn(`[IA-REDACCION] ${modelo}: ${error.message}`);
                // Un Flash-Lite falló del todo: la reserva entra ya, sin esperar los 4 s (cuando uno se
                // satura el otro suele estar igual: el 22/10 el alias tardaba 6-17 s mientras el 3.1 daba 503)
                if (!reservaLanzada) lanzarReserva();
                cerrarSiNoQuedaNada();
            });
        };
        const lanzarReserva = () => {
            if (reservaLanzada || terminado) return;
            reservaLanzada = true;
            if (restante() >= MINIMO_PARA_INTENTAR_MS) {
                logger.warn(`[IA-REDACCION] los Flash-Lite no contestaron: pido a la reserva ${reservas.join(' y ')}`);
                reservas.forEach(lanzar);
            }
            cerrarSiNoQuedaNada();
        };
        const timerReserva = setTimeout(lanzarReserva, RESERVA_TRAS_MS);
        principales.forEach(lanzar);
    });
}

// Monitor (/admin/monitor): éxito o falla de cada pedido a Gemini. Los rechazos por el texto (400) no son de Gemini.
async function pasarEnLimpioMedido(texto, opciones) {
    const salud = require('./saludIntegraciones');
    try {
        const r = await pasarEnLimpio(texto, opciones);
        salud.ok('gemini');
        return r;
    } catch (e) {
        if (e?.status !== 400) salud.falla('gemini', e);
        throw e;
    }
}

module.exports = { pasarEnLimpio: pasarEnLimpioMedido, ErrorIA };
