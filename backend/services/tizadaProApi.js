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
//   TIZADAPRO_SOLO_LECTURA=1           solo se LEE de TIZADA (catálogo, estado, cuentas y revisiones que no guardan nada):
//                                      no se manda ningún pedido ni plantilla y no se cancela nada
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

// ── Registro del intercambio (Administración › TIZADA PRO): las últimas 300 llamadas y avisos, en memoria (se
// pierde al reiniciar; los pedidos quedan además en dbo.TizadaProEnvios). Nunca guarda la llave.
const MAX_REGISTRO = 300;
const MAX_TEXTO = 20000;
const _registro = [];
let _sec = 0;
const recortar = (v) => {
  if (v == null) return null;
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t.length > MAX_TEXTO ? `${t.slice(0, MAX_TEXTO)}… (${t.length - MAX_TEXTO} caracteres más)` : t;
};
function registrar(e) {
  _registro.unshift({ id: ++_sec, fecha: new Date().toISOString(), ...e });
  if (_registro.length > MAX_REGISTRO) _registro.length = MAX_REGISTRO;
}
const registro = () => _registro.slice();

class ErrorTizada extends Error {
  constructor(mensaje, status, cuerpo) { super(mensaje); this.status = status; this.cuerpo = cuerpo; this.alarmas = cuerpo?.alarmas || []; }
}

// Con TIZADAPRO_SOLO_LECTURA=1 solo pasan las lecturas y los POST que TIZADA documenta como "no guarda nada"
const SIN_GUARDAR = ['/pedidos/validar', '/a_medida/calcular'];
const soloLectura = () => process.env.TIZADAPRO_SOLO_LECTURA === '1';

async function llamar(metodo, ruta, { json, cuerpo, tipo, crudo } = {}) {
  const c = cfg();
  const est = estadoConfig();
  if (!est.ok) throw new ErrorTizada(est.motivo, 503);
  if (soloLectura() && metodo !== 'GET' && !SIN_GUARDAR.includes(ruta)) {
    registrar({ sentido: 'SALE', metodo, ruta, status: null, ms: 0, enviado: null, respuesta: null, error: 'Frenado: SOLO LECTURA (no salió hacia TIZADA)' });
    throw new ErrorTizada('TIZADA PRO está en SOLO LECTURA (TIZADAPRO_SOLO_LECTURA=1 en el .env): no se manda nada que se guarde allá (pedidos, plantillas, cancelaciones).', 409);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), c.timeoutMs);
  const headers = { 'X-Api-Key': c.llave, Accept: crudo ? '*/*' : 'application/json' };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json; charset=utf-8'; body = JSON.stringify(json); }
  else if (cuerpo !== undefined) { headers['Content-Type'] = tipo || 'application/octet-stream'; body = cuerpo; }
  const t0 = Date.now();
  // Lo que se mandó: el JSON (recortado) o, si es un .zip, su tamaño
  const enviado = json !== undefined ? recortar(json) : (cuerpo !== undefined ? `(${tipo || 'binario'}, ${Buffer.byteLength(cuerpo)} bytes)` : null);
  const anotar = (status, respuesta, error) => registrar({ sentido: 'SALE', metodo, ruta, status, ms: Date.now() - t0, enviado, respuesta, error: error || null });
  try {
    const r = await fetch(`${c.url}${ruta}`, { method: metodo, headers, body, signal: ctrl.signal });
    if (crudo && r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      anotar(r.status, `(${r.headers.get('content-type') || 'archivo'}, ${buf.length} bytes)`);
      return { status: r.status, buffer: buf, tipo: r.headers.get('content-type') };
    }
    const texto = await r.text();
    let data = null;
    try { data = texto ? JSON.parse(texto) : null; } catch (_) { data = { error: texto.slice(0, 300) }; }
    if (!r.ok) {
      const msg = data?.error || data?.mensaje || (r.status === 401 ? 'TIZADA PRO rechazó la llave (X-Api-Key): falta o fue anulada.' : `TIZADA PRO respondió ${r.status}.`);
      anotar(r.status, recortar(data), msg);
      throw new ErrorTizada(msg, r.status, data);
    }
    anotar(r.status, recortar(data));
    return data;
  } catch (e) {
    if (e instanceof ErrorTizada) throw e;
    const msg = e.name === 'AbortError' ? `TIZADA PRO no contestó en ${Math.round(c.timeoutMs / 1000)} s.` : `No se pudo llegar a TIZADA PRO (${c.url}): ${e.message}`;
    anotar(null, null, msg);
    throw new ErrorTizada(msg, 502);
  } finally { clearTimeout(t); }
}

// ── Catálogo ──
const variables = () => llamar('GET', '/variables');
const molde = (codigo) => llamar('GET', `/moldes/${encodeURIComponent(codigo)}`);
/** "Foto" del molde: { img_w, img_h, piezas: [{ idx, path_svg, px, py, pw, ph }] } — el contorno de cada pieza
 *  (idx = pieza_talle.pieza_idx de TizadaPro). */
const fotoMolde = (codigo) => llamar('GET', `/moldes/${encodeURIComponent(codigo)}/foto`);
const telas = () => llamar('GET', '/telas');
const tipografias = () => llamar('GET', '/tipografias');

// ── A medida (pañuelos, toallas, banderas, banderines) ──
/** Las cuentas de una prenda a medida ANTES de mandar (no guarda nada): total con el margen, si entra en cada
 *  tela, las tiras por lado y la ficha. body: { variable, forma?, orientacion?, ancho_m, alto_m | diametro_m,
 *  terminacion?, tela?, tiras? } → 200 { … } · 422 { alarmas } (lanza). */
const aMedidaCalcular = (body) => llamar('POST', '/a_medida/calcular', { json: body });

// ── Plantillas para el diseñador (Illustrator, CorelDRAW y la guía .ai) ──
/** Pide la base: { referencia, disenos: [{ nombre, variables: ["v_…" | { variable, medida }] }], talles, escala } → 202. */
const plantillaPedir = (body) => llamar('POST', '/plantillas', { json: body });
/** Estado y archivos de una plantilla pedida. */
const plantillaEstado = (referencia) => llamar('GET', `/plantillas/${encodeURIComponent(referencia)}`);

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

if (estadoConfig().ok) logger.info(`[TIZADAPRO-API] Integración prendida → ${cfg().url}${soloLectura() ? ' (SOLO LECTURA)' : ''}`);

module.exports = { registrar, registro, soloLectura, estadoConfig, ErrorTizada, variables, molde, fotoMolde, telas, tipografias, aMedidaCalcular, plantillaPedir, plantillaEstado, validar, enviar, estado, bajarArchivo, cancelar, firmaValida, sha256 };
