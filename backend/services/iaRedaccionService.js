/**
 * iaRedaccionService.js — "Pasar en limpio" la respuesta de un ticket de soporte (14/10/2026).
 *
 * El operador escribe rápido ("hola buenas como estas me dice q en su diseño le quedo varias lineas")
 * y la IA devuelve EL MISMO mensaje bien escrito: ortografía, tildes, puntuación, mayúsculas y frases
 * claras. No agrega ni saca información: el operador revisa el resultado antes de enviarlo.
 *
 * Usa Gemini por REST (la misma cuenta que el informe de producción: GEMINI_API_KEY). Sin SDK: el
 * paquete @google/generative-ai está deprecado y un fetch alcanza. Modelo configurable con
 * GEMINI_MODEL; si Google lo retira (404) se prueba el alias que siempre apunta al Flash-Lite vigente.
 */
const logger = require('../utils/logger');

const MODELO_DEFAULT = 'gemini-3.1-flash-lite';   // probado 15/10: mejor que el 3.5-lite (saludos y trato) y más barato; el 2.5-lite ya no se habilita a claves nuevas
const MODELO_RESPALDO = 'gemini-flash-lite-latest';
const MAX_CARACTERES = 4000;
// Tiempos (19/10): Google tardó más de 20 s y el operador esperó 20 y 27 s para recibir un error.
// Ahora cada llamada espera hasta 12 s y todo el pedido hasta 25 s: si el modelo principal no
// contesta a tiempo se prueba el de respaldo (antes se abandonaba en la primera demora).
const TIMEOUT_MS = 12000;
const TOTAL_MS = 25000;
const MINIMO_PARA_INTENTAR_MS = 4000;

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

async function llamarGemini(modelo, texto, esNotaInterna, apiKey, timeoutMs = TIMEOUT_MS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
                // Sin "pensar" en 2.5 (corregir redacción no lo necesita y responde más rápido). Otras
                // familias configuran el razonamiento distinto: a esas no se les manda.
                generationConfig: Object.assign({ temperature: 0.2, maxOutputTokens: 2048 },
                    /^gemini-2\.5/.test(modelo) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            }),
        });
        const data = await resp.json().catch(() => ({}));
        return { status: resp.status, data };
    } finally {
        clearTimeout(timer);
    }
}

/** Devuelve el texto pasado en limpio. Lanza ErrorIA con un mensaje para mostrar al operador. */
async function pasarEnLimpio(texto, { esNotaInterna = false } = {}) {
    const borrador = String(texto || '').trim();
    if (!borrador) throw new ErrorIA('No hay texto para pasar en limpio.', 400);
    if (borrador.length > MAX_CARACTERES) throw new ErrorIA(`El texto es muy largo (máximo ${MAX_CARACTERES} caracteres).`, 400);

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (apiKey.length < 20) throw new ErrorIA('La IA no está configurada en el servidor (falta GEMINI_API_KEY).');

    const modelos = [...new Set([(process.env.GEMINI_MODEL || '').trim() || MODELO_DEFAULT, MODELO_RESPALDO])];
    let ultimo = null;
    const limite = Date.now() + TOTAL_MS;
    const restante = () => limite - Date.now();
    for (const modelo of modelos) {
        const esUltimo = modelo === modelos[modelos.length - 1];
        if (restante() < MINIMO_PARA_INTENTAR_MS) break;
        let r;
        try {
            r = await llamarGemini(modelo, borrador, esNotaInterna, apiKey, Math.min(TIMEOUT_MS, restante()));
            // Google saturado ("high demand", 503/500) o límite momentáneo (429): un reintento corto,
            // si queda tiempo para esperarlo
            if ([429, 500, 503].includes(r.status) && restante() > 1200 + MINIMO_PARA_INTENTAR_MS) {
                logger.warn(`[IA-REDACCION] ${modelo}: ${r.data?.error?.message || r.status} — reintento`);
                await new Promise(ok => setTimeout(ok, 1200));
                r = await llamarGemini(modelo, borrador, esNotaInterna, apiKey, Math.min(TIMEOUT_MS, restante()));
            }
        } catch (e) {
            const tarde = e.name === 'AbortError';
            const msg = tarde ? 'la IA tardó demasiado en responder' : e.message;
            // Demora o red caída en el principal: el respaldo corre en otros servidores de Google
            if (!esUltimo && restante() >= MINIMO_PARA_INTENTAR_MS) {
                logger.warn(`[IA-REDACCION] ${modelo}: ${msg} — pruebo el siguiente`);
                continue;
            }
            logger.warn(`[IA-REDACCION] ${modelo}: ${msg}`);
            throw new ErrorIA(`No se pudo pasar en limpio: ${msg}. Probá de nuevo en un rato o mandalo como está.`);
        }
        if (r.status === 404) { ultimo = r; logger.warn(`[IA-REDACCION] el modelo ${modelo} no existe (404), pruebo el siguiente`); continue; }
        // Sigue saturado: el modelo de respaldo corre en otros servidores de Google
        if ([429, 500, 503].includes(r.status) && modelo !== modelos[modelos.length - 1]) {
            ultimo = r; logger.warn(`[IA-REDACCION] ${modelo} sigue saturado, pruebo el siguiente`); continue;
        }
        if (r.status !== 200) {
            const det = r.data?.error?.message || `HTTP ${r.status}`;
            logger.error(`[IA-REDACCION] ${modelo}: ${det}`);
            if (r.status === 401 || r.status === 403) throw new ErrorIA(`Google rechazó la clave de la IA: ${det}`);
            if ([429, 500, 503].includes(r.status)) throw new ErrorIA('La IA está saturada en este momento. Probá en un minuto.');
            throw new ErrorIA(`No se pudo pasar en limpio: ${det}`);
        }
        const cand = r.data?.candidates?.[0];
        const salida = (cand?.content?.parts || []).map(p => p.text || '').join('').trim();
        if (!salida) {
            logger.warn(`[IA-REDACCION] ${modelo}: respuesta vacía (finishReason ${cand?.finishReason || '?'})`);
            throw new ErrorIA('La IA no devolvió texto. Probá de nuevo o mandalo como está.');
        }
        return { texto: salida.replace(/^["“”«»']+|["“”«»']+$/g, '').trim(), modelo };
    }
    if (restante() < MINIMO_PARA_INTENTAR_MS) {
        logger.warn(`[IA-REDACCION] sin respuesta en ${TOTAL_MS / 1000} s`);
        throw new ErrorIA('La IA está tardando demasiado en este momento. Probá de nuevo en un rato o mandalo como está.');
    }
    logger.error(`[IA-REDACCION] ningún modelo disponible: ${ultimo?.data?.error?.message || ''}`);
    throw new ErrorIA('No hay un modelo de IA disponible. Revisá GEMINI_MODEL en el servidor.');
}

module.exports = { pasarEnLimpio, ErrorIA };
