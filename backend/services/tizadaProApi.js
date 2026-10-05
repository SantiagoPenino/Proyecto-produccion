'use strict';
// =====================================================================
// TIZADA PRO — cliente de su API externa (/api/externo/v1, formato tizadapro.pedido/1)
// Guía: "Conectar otro sistema con TIZADA PRO" (versión 1.0.48, 02-oct-2026).
// =====================================================================
// Todo se configura en el .env (ver bloque TIZADAPRO_* en backend/.env):
//   TIZADAPRO_API_ACTIVA=1             prende la integración (0 = apagada: nada sale hacia TIZADA)
//   TIZADAPRO_API_URL=https://…/api/externo/v1
//   TIZADAPRO_API_LLAVE=tzp_…          la llave que crea TIZADA (Integraciones › Llaves del otro sistema)
//   TIZADAPRO_API_TIMEOUT_MS=60000
// La llave solo vive en el servidor: nunca se manda al navegador.
// =====================================================================
const crypto = require('crypto');
const logger = require('../utils/logger');

const cfg = () => ({
  activa: process.env.TIZADAPRO_API_ACTIVA === '1',
  url: String(process.env.TIZADAPRO_API_URL || '').replace(/\/+$/, ''),
  llave: String(process.env.TIZADAPRO_API_LLAVE || ''),
  timeoutMs: parseInt(process.env.TIZADAPRO_API_TIMEOUT_MS, 10) || 60000,
});

/** ¿Está todo para hablar con TIZADA? Devuelve { ok, motivo }. */
function estadoConfig() {
  const c = cfg();
  if (!c.activa) return { ok: false, motivo: 'La integración con TIZADA PRO está apagada (TIZADAPRO_API_ACTIVA=0 en el .env).' };
  if (!c.url) return { ok: false, motivo: 'Falta la dirección de TIZADA PRO (TIZADAPRO_API_URL en el .env).' };
  if (!c.llave.startsWith('tzp_')) return { ok: false, motivo: 'Falta la llave de TIZADA PRO (TIZADAPRO_API_LLAVE en el .env, empieza con tzp_).' };
  return { ok: true, motivo: null };
}

class ErrorTizada extends Error {
  constructor(mensaje, status, cuerpo) { super(mensaje); this.status = status; this.cuerpo = cuerpo; this.alarmas = cuerpo?.alarmas || []; }
}

async function llamar(metodo, ruta, { json, cuerpo, tipo, crudo } = {}) {
  const c = cfg();
  const est = estadoConfig();
  if (!est.ok) throw new ErrorTizada(est.motivo, 503);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), c.timeoutMs);
  const headers = { 'X-Api-Key': c.llave, Accept: crudo ? '*/*' : 'application/json' };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json; charset=utf-8'; body = JSON.stringify(json); }
  else if (cuerpo !== undefined) { headers['Content-Type'] = tipo || 'application/octet-stream'; body = cuerpo; }
  try {
    const r = await fetch(`${c.url}${ruta}`, { method: metodo, headers, body, signal: ctrl.signal });
    if (crudo && r.ok) return { status: r.status, buffer: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') };
    const texto = await r.text();
    let data = null;
    try { data = texto ? JSON.parse(texto) : null; } catch (_) { data = { error: texto.slice(0, 300) }; }
    if (!r.ok) {
      const msg = data?.error || data?.mensaje || (r.status === 401 ? 'TIZADA PRO rechazó la llave (X-Api-Key): falta o fue anulada.' : `TIZADA PRO respondió ${r.status}.`);
      throw new ErrorTizada(msg, r.status, data);
    }
    return data;
  } catch (e) {
    if (e instanceof ErrorTizada) throw e;
    const msg = e.name === 'AbortError' ? `TIZADA PRO no contestó en ${Math.round(c.timeoutMs / 1000)} s.` : `No se pudo llegar a TIZADA PRO (${c.url}): ${e.message}`;
    throw new ErrorTizada(msg, 502);
  } finally { clearTimeout(t); }
}

// ── Catálogo ──
const variables = () => llamar('GET', '/variables');
const molde = (codigo) => llamar('GET', `/moldes/${encodeURIComponent(codigo)}`);
const telas = () => llamar('GET', '/telas');
const tipografias = () => llamar('GET', '/tipografias');

// ── Pedidos ──
/** Revisa sin guardar. zipBuffer: el .zip completo (o null para mandar solo el JSON). → 200 { … } · 422 con alarmas (lanza). */
const validar = (pedidoJson, zipBuffer) => (zipBuffer
  ? llamar('POST', '/pedidos/validar', { cuerpo: zipBuffer, tipo: 'application/zip' })
  : llamar('POST', '/pedidos/validar', { json: pedidoJson }));
/** Manda el pedido (.zip). → 202 { referencia, estado: 'en_cola' } · 422 rechazado (lanza). */
const enviar = (zipBuffer) => llamar('POST', '/pedidos', { cuerpo: zipBuffer, tipo: 'application/zip' });
/** Estado y resultado del pedido. */
const estado = (referencia) => llamar('GET', `/pedidos/${encodeURIComponent(referencia)}`);
/** Baja un PDF del resultado (archivos[].descarga) → { buffer, tipo }. */
const bajarArchivo = (descarga) => {
  const ruta = String(descarga || '').replace(/^.*\/api\/externo\/v1/, '');
  return llamar('GET', ruta, { crudo: true });
};
const cancelar = (referencia) => llamar('DELETE', `/pedidos/${encodeURIComponent(referencia)}`);

/**
 * Firma del aviso (webhook): HMAC-SHA256 con clave = sha256_hex(llave) sobre el cuerpo CRUDO, en hex.
 * Comparación en tiempo constante. Si no hay llave configurada, siempre false.
 */
function firmaValida(cuerpoCrudo, firma) {
  const { llave } = cfg();
  if (!llave || !firma || !cuerpoCrudo) return false;
  const clave = crypto.createHash('sha256').update(llave, 'utf8').digest('hex');
  const esperada = crypto.createHmac('sha256', clave).update(cuerpoCrudo).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(String(firma).trim().toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

if (estadoConfig().ok) logger.info(`[TIZADAPRO-API] Integración prendida → ${cfg().url}`);

module.exports = { estadoConfig, ErrorTizada, variables, molde, telas, tipografias, validar, enviar, estado, bajarArchivo, cancelar, firmaValida, sha256 };
