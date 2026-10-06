'use strict';
// =====================================================================
// SOLICITUD → TIZADA PRO (API) → vuelve la tizada como "diseño pronto" de la producción principal
// =====================================================================
// Recorrido (guía "Conectar otro sistema con TIZADA PRO", v1.0.48):
//   1. En la solicitud, por producto del catálogo con molde de TIZADA: los DISEÑOS (jugador, golero…:
//      cada uno con su modelo = "variable" v_…, su tela, sus telas por pieza y su arte) y la LISTA DE
//      TALLES, una fila por prenda, con las columnas de la planilla del molde.
//   2. "Generar tizada": se arma pedido.json + artes/ en un .zip → POST /pedidos/validar → POST /pedidos.
//   3. TIZADA avisa (POST firmado a /api/integracion/tizadapro/aviso) o preguntamos (sondeo).
//   4. Cuando está "listo": cada PDF de tizada (uno por tela) queda como DISEÑO PRONTO de la producción
//      principal, con su tela, ancho y metros (consumo); la ficha técnica como REFERENCIA del producto;
//      y la producción principal pasa a DISEÑADO con la marca "diseño automático (TIZADA PRO)".
// Lo que pasa después (convertir en pedido) es lo de siempre: esos archivos son el arte de Sublimación.
//
// Configuración: bloque TIZADAPRO_* del .env (ver tizadaProApi.js). Sin la tabla
// TizadaProEnvios (scripts/add_tizadapro_envios.sql) no se puede mandar. La tabla es genérica por
// Origen: 'SOLICITUD' (hoy: OrigenID = SolicitudID, OrigenItemID = ProductoSolID) y 'PORTAL' (fase 2).
// =====================================================================
const archiver = require('archiver');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const api = require('./tizadaProApi');

const MODO_ENVIO = () => String(process.env.TIZADAPRO_ENVIO_MODO || 'MANUAL').toUpperCase();
const PDF_MODO = () => String(process.env.TIZADAPRO_PDF_MODO || 'copiar').toLowerCase();
const PREFIJO = () => String(process.env.TIZADAPRO_REFERENCIA_PREFIJO || 'SOL').replace(/[^A-Za-z0-9_-]/g, '') || 'SOL';
const AREA_DRIVE = 'SOLICITUDES';
const USUARIO_AUTO = (id) => ({ id: id || 1, name: 'TIZADA PRO (automático)' });

const ORIGEN = 'SOLICITUD';
// Fila de TizadaProEnvios con los nombres de la solicitud (SolicitudID / ProductoSolID) para el resto del código
const deFila = (e) => (e ? { ...e, SolicitudID: e.OrigenID, ProductoSolID: e.OrigenItemID } : e);
const fallo = (status, msg, extra) => Object.assign(new Error(msg), { status, ...(extra || {}) });
const txt = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const json = (v) => (v == null ? null : JSON.stringify(v));
const leer = (v, def) => { try { return v ? JSON.parse(v) : def; } catch (_) { return def; } };
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'x';
const sinTilde = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function tieneTabla(cx) {
  const r = await new sql.Request(cx).query("SELECT OBJECT_ID('dbo.TizadaProEnvios', 'U') AS T");
  return !!r.recordset[0].T;
}

// ─────────────────────────────────────────────────────────────────────
// Producto + molde
// ─────────────────────────────────────────────────────────────────────
async function productoConMolde(cx, solicitudId, productoSolId) {
  const r = await new sql.Request(cx).input('S', sql.Int, solicitudId).input('P', sql.Int, productoSolId).query(`
    SELECT p.ProductoSolID, p.SolicitudID, p.TipoFabricacion, p.ProIdProducto, p.ProductoNombre, p.Cantidad, p.DatosJson, p.PedidoNoDocERP,
           LTRIM(RTRIM(v.TizadaProMoldeRef)) AS MoldeRef
    FROM dbo.SolicitudesVendedorProductos p
    LEFT JOIN dbo.ProductoVentaConfig v ON v.ProIdProducto = p.ProIdProducto
    WHERE p.ProductoSolID = @P AND p.SolicitudID = @S AND p.Activo = 1`);
  const p = r.recordset[0];
  if (!p) throw fallo(404, 'Ese producto no pertenece a la solicitud.');
  p.Datos = leer(p.DatosJson, {});
  return p;
}

// ─────────────────────────────────────────────────────────────────────
// Estructura de la planilla del molde: columnas, talles y opciones.
// Con la API prendida la da TIZADA (GET /moldes/{codigo}); si no, la base de TizadaPro
// (plantillas_planillas del catálogo + talles del molde): la MISMA estructura, para poder probar.
// Columna "diseño" no va: el diseño de cada fila es la "Variante" (uno de los diseños del producto).
// ─────────────────────────────────────────────────────────────────────
const comaLista = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => (typeof x === 'object' ? (x.nombre || x.label || x.valor || x.id) : x)).map(x => String(x || '').trim()).filter(Boolean);

function normalizarColumna(c, talles, reglas) {
  const id = String(c.id || '').trim();
  const rol = String(c.rol || c.role || c.comportamiento || '').toLowerCase();
  if (!id || rol === 'diseno' || id === 'diseno') return null;
  if (c.lee_este_molde === false) return null;   // la planilla la tiene, pero ESTE molde no la usa (ej. TALLE SHOT)
  const regla = (reglas || []).find(r => r.id === c.reglaId) || null;
  let opciones = comaLista(c.opciones);
  if (!opciones.length && regla) opciones = comaLista(regla.opciones);
  let tipo = 'texto';
  if (rol === 'talle') { tipo = 'talle'; opciones = opciones.length ? opciones : talles; }
  else if (rol === 'cantidad' || c.tipo === 'numero') tipo = 'numero';
  else if (opciones.length || ['desplegable', 'toggle', 'lista'].includes(String(c.tipo || regla?.tipo || '').toLowerCase())) tipo = 'lista';
  if (tipo === 'lista' && !opciones.length && rol === 'manga') opciones = ['Corta', 'Larga'];
  return { id, label: String(c.label || c.titulo || c.nombre || id).trim(), rol, tipo, opciones, obligatoria: !!c.obligatoria };
}

async function estructuraLocal(pool, moldeRef) {
  const tz = require('./tizadaProService');
  await tz.exigir(pool);
  const r = await pool.request().query(`SELECT valor FROM [${tz.DB}].dbo.config WHERE clave = 'catalogo'`);
  const cat = leer(r.recordset[0]?.valor, {});
  const prods = Array.isArray(cat.productos) ? cat.productos : Object.values(cat.productos || {});
  const prod = prods.find(x => x.id === moldeRef) || {};
  const plantilla = (cat.plantillas_planillas || []).find(x => x.id === prod.planilla_template_id) || (cat.plantillas_planillas || [])[0] || { columnas: [] };
  const [molde] = await tz.moldes(pool, { ref: moldeRef });
  const talles = (molde?.talles || []).map(t => (typeof t === 'object' ? (t.nombre || t.talle) : t)).filter(Boolean);
  const columnas = (plantilla.columnas || []).map(c => normalizarColumna(c, talles, cat.reglas_planilla)).filter(Boolean);
  const primeraTalle = columnas.find(c => c.tipo === 'talle');
  if (primeraTalle) primeraTalle.obligatoria = true;
  return { fuente: 'BASE_LOCAL', plantilla: plantilla.nombre || null, columnas, talles, columnaTalle: primeraTalle?.id || null, piezas: molde?.piezasGenericas || [] };
}

async function estructuraApi(moldeRef) {
  const r = await api.molde(moldeRef);
  const m = r?.molde || r;   // el servidor real contesta { molde: {…}, version }
  const talles = comaLista(m.talles || m.planilla?.talles);
  const cols = m.planilla?.columnas || m.columnas || [];
  const columnas = cols.map(c => normalizarColumna(c, talles, null)).filter(Boolean);
  const colTalle = m.planilla?.columna_talle || columnas.find(c => c.tipo === 'talle')?.id || null;
  columnas.forEach(c => { if (c.id === colTalle) { c.tipo = 'talle'; c.obligatoria = true; if (!c.opciones.length) c.opciones = talles; } });
  return { fuente: 'TIZADA_API', plantilla: m.planilla?.nombre || null, columnas, talles, columnaTalle: colTalle, piezas: comaLista(m.piezas) };
}

async function estructura(pool, moldeRef) {
  if (!moldeRef) return null;
  if (api.estadoConfig().ok) {
    try {
      const e = await estructuraApi(moldeRef);
      if (e.columnas.length) return e;
      logger.warn(`[TIZADAPRO] estructura de ${moldeRef} por API vino sin columnas — uso la base local`);
    }
    catch (e) { logger.warn(`[TIZADAPRO] estructura de ${moldeRef} por API: ${e.message} — uso la base local`); }
  }
  return estructuraLocal(pool, moldeRef);
}

// ─────────────────────────────────────────────────────────────────────
// Modelo y telas: se eligen UNA vez en "2 · Piezas y telas" (DatosJson.sublimacion) y valen para todos
// los diseños. Cada diseño solo pone su nombre y su arte. Sin Piezas y telas guardado, queda lo que
// tenga el diseño (compatibilidad con lo cargado antes).
// ─────────────────────────────────────────────────────────────────────
function basePiezas(subl) {
  if (!subl || !subl.modeloClave) return null;
  const telasPorPieza = {}; let tela = null; let telaNombre = null; const porPieza = [];
  (subl.piezas || []).forEach(x => {
    if (!x.telaProIdProducto) return;
    const id = String(x.telaProIdProducto);
    if (!tela) { tela = id; telaNombre = x.telaNombre || null; }
    if (id !== tela) { telasPorPieza[x.generico || x.pieza] = id; porPieza.push({ pieza: x.generico || x.pieza, tela: x.telaNombre || id }); }
  });
  return { variable: subl.modeloClave, variableNombre: subl.modeloNombre || null, tela, telaNombre, telasPorPieza, porPieza, completo: !!subl.completo };
}
function conPiezas(datos, subl) {
  const b = basePiezas(subl);
  const disenos = (datos?.disenos || []).map(d => (b ? { ...d, variable: b.variable, variableNombre: b.variableNombre, tela: b.tela, telasPorPieza: b.telasPorPieza } : d));
  return { ...(datos || {}), disenos, planilla: datos?.planilla || [] };
}

// ─────────────────────────────────────────────────────────────────────
// Validación de diseños + lista de talles (la misma que muestra la pantalla)
// ─────────────────────────────────────────────────────────────────────
function revisar(est, datos, archivos) {
  const errores = [];
  const disenos = datos?.disenos || [];
  const filas = datos?.planilla || [];
  const nombres = disenos.map(d => sinTilde(d.nombre));
  if (!disenos.length) errores.push({ donde: 'disenos', mensaje: 'Cargá al menos un diseño (por ejemplo JUGADOR).' });
  disenos.forEach((d, i) => {
    const n = `Diseño ${i + 1}${d.nombre ? ` (${d.nombre})` : ''}`;
    if (!txt(d.nombre)) errores.push({ donde: `disenos[${i}].nombre`, mensaje: `${n}: falta el nombre.` });
    else if (nombres.indexOf(sinTilde(d.nombre)) !== i) errores.push({ donde: `disenos[${i}].nombre`, mensaje: `${n}: el nombre está repetido.` });
    if (!txt(d.variable)) errores.push({ donde: `disenos[${i}].variable`, mensaje: `${n}: falta el modelo (elegilo y guardalo en "2 · Piezas y telas").` });
    if (!txt(d.tela)) errores.push({ donde: `disenos[${i}].tela`, mensaje: `${n}: falta la tela (elegila y guardala en "2 · Piezas y telas").` });
    if (!d.arteArchivoId) errores.push({ donde: `disenos[${i}].arte`, mensaje: `${n}: falta el arte para TIZADA (.ai o .pdf).` });
    else if (archivos && !archivos.some(a => a.ArchivoID === Number(d.arteArchivoId) && a.Vigente)) errores.push({ donde: `disenos[${i}].arte`, mensaje: `${n}: el arte elegido ya no está en la solicitud.` });
  });
  if (!filas.length) errores.push({ donde: 'planilla', mensaje: 'La lista de talles está vacía.' });
  filas.forEach((f, i) => {
    const fila = i + 1;
    (est?.columnas || []).forEach(c => {
      const v = txt(f[c.id]);
      if (c.obligatoria && !v) errores.push({ donde: `planilla[${i}].${c.id}`, fila, mensaje: `Fila ${fila}: falta ${c.label.toLowerCase()}.` });
      else if (v && (c.tipo === 'talle' || c.tipo === 'lista') && c.opciones.length && !c.opciones.some(o => sinTilde(o) === sinTilde(v)) && !(c.tipo === 'lista' && v.includes('+'))) {
        errores.push({ donde: `planilla[${i}].${c.id}`, fila, mensaje: `Fila ${fila}: "${v}" no es un ${c.label.toLowerCase()} de este molde.` });
      }
      if (v && c.tipo === 'numero' && !(Number(v) > 0)) errores.push({ donde: `planilla[${i}].${c.id}`, fila, mensaje: `Fila ${fila}: ${c.label.toLowerCase()} tiene que ser un número mayor a 0.` });
    });
    if (disenos.length > 1 && !nombres.includes(sinTilde(f.diseno))) errores.push({ donde: `planilla[${i}].diseno`, fila, mensaje: `Fila ${fila}: elegí la variante (qué diseño la imprime).` });
  });
  return errores;
}

// ─────────────────────────────────────────────────────────────────────
// Leer / guardar (en SolicitudesVendedorProductos.DatosJson.tizadaPro)
// ─────────────────────────────────────────────────────────────────────
async function envios(cx, productoSolId) {
  if (!(await tieneTabla(cx))) return [];
  const r = await new sql.Request(cx).input('P', sql.Int, productoSolId).query(`
    SELECT TOP 10 EnvioID, Referencia, Intento, Estado, Etapa, SoloRevision, AlarmasJson, ArchivosJson, ErrorTexto, FechaEnvio, FechaActualizado, FechaFin
    FROM dbo.TizadaProEnvios WHERE Origen = 'SOLICITUD' AND OrigenItemID = @P ORDER BY EnvioID DESC`);
  return r.recordset.map(e => ({ ...e, Alarmas: leer(e.AlarmasJson, []), Archivos: leer(e.ArchivosJson, []), AlarmasJson: undefined, ArchivosJson: undefined }));
}

async function ver(pool, user, base, solicitudId, productoSolId) {
  const p = await productoConMolde(pool, solicitudId, productoSolId);
  const conf = api.estadoConfig();
  const general = { apiActiva: conf.ok, motivo: conf.motivo, modoEnvio: MODO_ENVIO(), tabla: await tieneTabla(pool) };
  if (!p.MoldeRef) return { aplica: false, motivo: 'Este producto no tiene molde de TIZADA PRO vinculado (Configurar productos › Molde).', ...general };
  let est = null; let errorEstructura = null;
  try { est = await estructura(pool, p.MoldeRef); } catch (e) { errorEstructura = e.message; }
  const guardado = p.Datos.tizadaPro || { disenos: [], planilla: [] };
  const archivos = (await pool.request().input('S', sql.Int, solicitudId).input('P', sql.Int, productoSolId).query(`
    SELECT a.ArchivoID, a.NombreOriginal, a.Rol, a.UrlDrive, a.Vigente, a.ProductoSolID, a.ParteID, a.FechaSubida
    FROM dbo.SolicitudesVendedorArchivos a
    LEFT JOIN dbo.SolicitudesVendedorPartes pa ON pa.ParteID = a.ParteID
    WHERE a.SolicitudID = @S AND a.Vigente = 1 AND a.UrlDrive <> 'Pendiente'
      AND (a.ProductoSolID = @P OR pa.ProductoSolID = @P OR (a.ProductoSolID IS NULL AND a.ParteID IS NULL AND a.EventoID IS NULL))
    ORDER BY a.FechaSubida DESC`)).recordset;
  const artes = archivos.filter(a => /\.(ai|pdf)$/i.test(a.NombreOriginal || '') && a.Rol !== 'COMPROBANTE');
  // Arranque: un diseño JUGADOR con el arte que lo nombra (o el único que haya)
  const arranque = !guardado.disenos?.length;
  if (arranque) {
    const arte = artes.find(a => /jugador/i.test(a.NombreOriginal || '')) || (artes.length === 1 ? artes[0] : null);
    guardado.disenos = [{ nombre: 'JUGADOR', arteArchivoId: arte ? arte.ArchivoID : null }];
  }
  const datos = conPiezas(guardado, p.Datos.sublimacion);
  return {
    aplica: true, ...general, moldeRef: p.MoldeRef, estructura: est, errorEstructura, datos, sinGuardar: arranque,
    piezas: basePiezas(p.Datos.sublimacion),
    artes: artes.map(a => ({ ArchivoID: a.ArchivoID, nombre: a.NombreOriginal, rol: a.Rol })),
    errores: est ? revisar(est, datos, archivos) : [],
    envios: await envios(pool, productoSolId),
  };
}

// Vendedor (carga diseños + lista) o diseñador (elige la letra y puede corregir antes de generar)
async function exigirVendedorODisenador(pool, user, base) {
  if (base.esVendedor(user) || await base.esDisenador(pool, user)) return;
  throw fallo(403, 'Esto lo hace el vendedor o un diseñador habilitado.');
}

async function guardar(pool, user, base, solicitudId, productoSolId, b) {
  await exigirVendedorODisenador(pool, user, base);
  const sol = await base.cabecera(pool, solicitudId);
  base.exigirAbierta(sol);
  const p = await productoConMolde(pool, solicitudId, productoSolId);
  if (p.PedidoNoDocERP) throw fallo(409, `Este producto ya se convirtió en el pedido ${p.PedidoNoDocERP}.`);
  if (!p.MoldeRef) throw fallo(409, 'Este producto no tiene molde de TIZADA PRO vinculado.');
  const est = await estructura(pool, p.MoldeRef);
  if (!est?.columnas?.length) throw fallo(503, 'No se pudo leer la planilla del molde (columnas). No se guardó nada para no perder la lista; probá de nuevo en un rato.');
  const ids = new Set((est?.columnas || []).map(c => c.id));
  const disenos = (Array.isArray(b.disenos) ? b.disenos : []).slice(0, 12).map(d => ({
    nombre: txt(d.nombre, 40).toUpperCase(), variable: txt(d.variable, 96), variableNombre: txt(d.variableNombre, 200) || null,
    tela: txt(d.tela, 20) || null, arteArchivoId: parseInt(d.arteArchivoId, 10) || null,
    telasPorPieza: Object.fromEntries(Object.entries(d.telasPorPieza || {}).filter(([k, v]) => txt(k) && txt(v)).map(([k, v]) => [txt(k, 60), txt(v, 20)])),
    editables: Object.fromEntries(Object.entries(d.editables || {}).filter(([k, v]) => txt(k) && txt(v)).map(([k, v]) => [txt(k, 60), txt(v, 20)])),
  }));
  const planilla = (Array.isArray(b.planilla) ? b.planilla : []).slice(0, 2000).map(f => {
    const fila = { diseno: txt(f.diseno, 40).toUpperCase() || (disenos.length === 1 ? disenos[0].nombre : '') };
    Object.keys(f || {}).forEach(k => { if (ids.has(k)) { const v = txt(f[k], 80); if (v) fila[k] = v; } });
    return fila;
  }).filter(f => Object.keys(f).some(k => k !== 'diseno'));
  const datos = { ...p.Datos, tizadaPro: { ...conPiezas({ disenos, planilla }, p.Datos.sublimacion), fecha: new Date().toISOString() } };
  await pool.request().input('P', sql.Int, productoSolId).input('D', sql.NVarChar(sql.MAX), JSON.stringify(datos))
    .query('UPDATE dbo.SolicitudesVendedorProductos SET DatosJson = @D WHERE ProductoSolID = @P');
  await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'EDICION', texto: `TIZADA PRO: ${disenos.length} diseño(s) y ${planilla.length} prenda(s) en la lista de talles guardados.` });
  // Si el vendedor cambia diseños o lista con la producción principal ya en Diseño (o con la tizada hecha), queda
  // "Modificada": Diseño se entera, tiene que aceptar el cambio (y rehacer la tizada) y no se convierte con la vieja.
  if (!(await base.esDisenador(pool, user))) {
    const pa = (await pool.request().input('P', sql.Int, productoSolId).query(
      "SELECT TOP 1 ParteID, Estado FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Tipo = 'PRINCIPAL' AND Activo = 1")).recordset[0];
    if (pa && pa.Estado !== 'INGRESADO') {
      await base.marcarModificada(pool, user, pa.ParteID, `TIZADA PRO: el vendedor cambió los diseños o la lista de talles (${disenos.length} diseño(s), ${planilla.length} prenda(s))${pa.Estado === 'DISENADO' ? ' — hay que rehacer la tizada' : ''}.`);
    }
  }
  return ver(pool, user, base, solicitudId, productoSolId);
}

// ─────────────────────────────────────────────────────────────────────
// Armar y mandar
// ─────────────────────────────────────────────────────────────────────
function armarPedidoJson(sol, p, datos, est, referencia, rutasArte) {
  const ids = (est?.columnas || []).map(c => c.id);
  return {
    formato: 'tizadapro.pedido/1',
    referencia,
    // pedido_externo es libre y vuelve TAL CUAL en el resultado y el aviso
    pedido_externo: {
      sistema: 'USER', numero: `${PREFIJO()}-${sol.SolicitudID}`, solicitud_id: sol.SolicitudID, producto_sol_id: p.ProductoSolID,
      trabajo: sol.NombreTrabajo || null, vendedor: sol.VendedorNombre || null,
      entrega: sol.FechaEntrega ? new Date(sol.FechaEntrega).toISOString().slice(0, 10) : null,
    },
    // Dónde nos avisa TIZADA cuando termina (va en cada pedido: no hace falta cargarlo en TIZADA)
    ...(process.env.TIZADAPRO_AVISO_URL && process.env.TIZADAPRO_AVISO_ACTIVO !== '0' ? { aviso_url: String(process.env.TIZADAPRO_AVISO_URL) } : {}),
    cliente: sol.ClienteNombre || null,
    opciones: {
      si_piezas_en_blanco: String(process.env.TIZADAPRO_SI_PIEZAS_EN_BLANCO || 'rechazar'),
      si_texto_no_entra: String(process.env.TIZADAPRO_SI_TEXTO_NO_ENTRA || 'achicar'),
      si_falta_tipografia: String(process.env.TIZADAPRO_SI_FALTA_TIPOGRAFIA || 'rechazar'),
      carpeta: `${PREFIJO()}-${sol.SolicitudID}/${referencia}`,
    },
    mesas: { modo: String(process.env.TIZADAPRO_MESAS_MODO || 'normal') },
    disenos: datos.disenos.map(d => ({
      nombre: d.nombre,
      moldes: [{
        variable: d.variable,
        arte: rutasArte[d.arteArchivoId],
        tela: String(d.tela),
        ...(Object.keys(d.telasPorPieza || {}).length ? { telas_por_pieza: d.telasPorPieza } : {}),
        ...(Object.keys(d.editables || {}).length ? { editables: d.editables } : {}),
      }],
    })),
    planilla: datos.planilla.map(f => {
      const fila = {};
      if (datos.disenos.length > 1 || f.diseno) fila.diseno = f.diseno || datos.disenos[0].nombre;
      ids.forEach(k => { if (f[k] != null && f[k] !== '') fila[k] = (est.columnas.find(c => c.id === k)?.tipo === 'numero') ? Number(f[k]) : f[k]; });
      return fila;
    }),
  };
}

async function bajarDeDrive(url) {
  const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{10,})|[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (!m) throw new Error('no se reconoce el enlace de Drive');
  const { stream } = await require('./driveService').getFileStream(m[1] || m[2]);
  const partes = [];
  for await (const ch of stream) partes.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
  return Buffer.concat(partes);
}

function zipEnMemoria(pedidoJson, artes) {
  return new Promise((resolve, reject) => {
    const zip = archiver('zip', { zlib: { level: 6 } });
    const partes = [];
    zip.on('data', (c) => partes.push(c));
    zip.on('end', () => resolve(Buffer.concat(partes)));
    zip.on('error', reject);
    zip.append(JSON.stringify(pedidoJson, null, 2), { name: 'pedido.json' });
    artes.forEach(a => zip.append(a.buffer, { name: a.ruta }));
    zip.finalize();
  });
}

async function guardarEnvio(pool, e) {
  const r = await pool.request()
    .input('S', sql.Int, e.SolicitudID).input('P', sql.Int, e.ProductoSolID).input('R', sql.VarChar(80), e.Referencia).input('I', sql.Int, e.Intento)
    .input('E', sql.VarChar(20), e.Estado).input('Et', sql.NVarChar(300), txt(e.Etapa, 300) || null).input('Rev', sql.Bit, e.SoloRevision ? 1 : 0)
    .input('Ped', sql.NVarChar(sql.MAX), json(e.Pedido)).input('Al', sql.NVarChar(sql.MAX), json(e.Alarmas || []))
    .input('Err', sql.NVarChar(1000), txt(e.ErrorTexto, 1000) || null).input('U', sql.Int, e.UsuarioID || null)
    .query(`INSERT INTO dbo.TizadaProEnvios (Origen, OrigenID, OrigenItemID, Referencia, Intento, Estado, Etapa, SoloRevision, PedidoJson, AlarmasJson, ErrorTexto, UsuarioID, FechaActualizado, FechaFin)
            OUTPUT INSERTED.EnvioID
            VALUES ('SOLICITUD', @S, @P, @R, @I, @E, @Et, @Rev, @Ped, @Al, @Err, @U, GETDATE(), CASE WHEN @E IN ('REVISADO','RECHAZADO','ERROR') THEN GETDATE() END)`);
  return r.recordset[0].EnvioID;
}

/** Arma el .zip y lo manda (o solo lo revisa). Devuelve el envío. */
// interno = true solo desde envioAutomatico (TIZADAPRO_ENVIO_MODO=AL_ENVIAR_A_DISENO), nunca desde una ruta.
async function enviar(pool, user, base, solicitudId, productoSolId, b = {}, interno = false) {
  // Revisar: vendedor o diseñador. Generar: diseñador (o el envío automático), y solo después de "Enviar a Diseño".
  if (b.soloRevisar) await exigirVendedorODisenador(pool, user, base);
  else if (!interno && !(await base.esDisenador(pool, user))) throw fallo(403, 'La tizada la genera Diseño: se manda desde la pantalla de Diseño de la solicitud.');
  if (!b.soloRevisar) {
    const pa = (await pool.request().input('P', sql.Int, productoSolId).query(
      "SELECT TOP 1 Estado FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Tipo = 'PRINCIPAL' AND Activo = 1")).recordset[0];
    if (pa && pa.Estado === 'INGRESADO') throw fallo(409, 'Primero el vendedor tiene que tocar "Enviar a Diseño" en la solicitud; después la tizada se genera desde la pantalla de Diseño.');
  }
  const conf = api.estadoConfig();
  if (!conf.ok) throw fallo(503, conf.motivo);
  if (!(await tieneTabla(pool))) throw fallo(503, 'Falta correr scripts/add_tizadapro_envios.sql en la base (tabla TizadaProEnvios).');
  const sol = await base.obtener(pool, user, solicitudId);
  const p = await productoConMolde(pool, solicitudId, productoSolId);
  // Convertido: solo si su pedido tiene archivos que no pasaron a producción (recuperación: solicitudesVendedorRecuperar.js).
  // En recuperación la solicitud ya está "Pedido solicitado": no se exige que esté abierta (sí que no esté cancelada).
  const recuperando = !!p.PedidoNoDocERP && await require('./solicitudesVendedorRecuperar').puedeRecuperar(pool, solicitudId, productoSolId);
  if (!recuperando || sol.Estado === 'CANCELADA') base.exigirAbierta(sol);
  if (p.PedidoNoDocERP && !recuperando) throw fallo(409, `Este producto ya se convirtió en el pedido ${p.PedidoNoDocERP}.`);
  if (!p.MoldeRef) throw fallo(409, 'Este producto no tiene molde de TIZADA PRO vinculado.');
  const soloRevisar = !!b.soloRevisar;
  // No mandar dos veces el mismo producto mientras uno sigue en curso
  const enCurso = (await pool.request().input('P', sql.Int, productoSolId).query(`
    SELECT TOP 1 Referencia FROM dbo.TizadaProEnvios WHERE Origen = 'SOLICITUD' AND OrigenItemID = @P AND Estado IN ('EN_COLA','PROCESANDO','LISTO','APLICANDO') ORDER BY EnvioID DESC`)).recordset[0];
  if (enCurso && !soloRevisar) throw fallo(409, `Ya hay un pedido en TIZADA PRO para este producto (${enCurso.Referencia}). Esperá a que termine.`);

  const est = await estructura(pool, p.MoldeRef);
  if (!est?.columnas?.length) throw fallo(503, 'No se pudo leer la planilla del molde (columnas): no se manda nada a TIZADA.');
  const datos = conPiezas(p.Datos.tizadaPro || {}, p.Datos.sublimacion);
  const errores = revisar(est, datos, sol.Archivos);
  if (errores.length) throw fallo(400, `Antes de mandar a TIZADA PRO falta:\n• ${errores.slice(0, 12).map(e => e.mensaje).join('\n• ')}`, { errores });

  // Artes: se bajan de nuestro Drive y van en artes/ del .zip
  const rutasArte = {}; const artes = [];
  for (const [i, d] of datos.disenos.entries()) {
    if (rutasArte[d.arteArchivoId]) continue;
    const a = sol.Archivos.find(x => x.ArchivoID === Number(d.arteArchivoId));
    const ruta = `artes/${slug(d.nombre)}_${slug(String(a.NombreOriginal).replace(/\.[^.]+$/, ''))}.${(String(a.NombreOriginal).split('.').pop() || 'pdf').toLowerCase()}`;
    try { artes.push({ ruta, buffer: await bajarDeDrive(a.UrlDrive), nombre: a.NombreOriginal, campo: `disenos[${i}].arte` }); }
    catch (e) { throw fallo(502, `No se pudo leer el arte "${a.NombreOriginal}" de Drive: ${e.message}`); }
    rutasArte[d.arteArchivoId] = ruta;
  }

  const intento = ((await pool.request().input('P', sql.Int, productoSolId).query("SELECT ISNULL(MAX(Intento), 0) AS N FROM dbo.TizadaProEnvios WHERE Origen = 'SOLICITUD' AND OrigenItemID = @P")).recordset[0].N) + 1;
  const referencia = `${PREFIJO()}-${solicitudId}-P${productoSolId}-${intento}`;
  const pedido = armarPedidoJson(sol, p, datos, est, referencia, rutasArte);
  const zip = await zipEnMemoria(pedido, artes);
  const reg = { SolicitudID: solicitudId, ProductoSolID: productoSolId, Referencia: referencia, Intento: intento, Pedido: pedido, UsuarioID: user.id, SoloRevision: soloRevisar };

  // La letra VIENE EN EL ARTE y se revisa acá: el /pedidos/validar de TIZADA "sólo revisa los DATOS; el arte y las
  // tipografías se revisan al procesar". Si el arte usa una letra que TIZADA no tiene, no se manda.
  let tipografias;
  try { const t = await api.tipografias(); tipografias = (Array.isArray(t) ? t : t?.tipografias) || []; }
  catch (e) { throw fallo(e.status || 502, `No se pudo leer la lista de letras de TIZADA PRO: ${e.message}`); }
  const alarmasArte = await require('./tizadaProArte').revisarArtes(artes, tipografias, est?.piezas || []);
  if (alarmasArte.length) {
    const id = await guardarEnvio(pool, { ...reg, Estado: 'RECHAZADO', Etapa: 'El arte no pasa la revisión (letras)', Alarmas: alarmasArte, ErrorTexto: alarmasArte.map(a => a.mensaje).join(' · ') });
    return { EnvioID: id, Referencia: referencia, Estado: 'RECHAZADO', Alarmas: alarmasArte, mensaje: alarmasArte[0].mensaje };
  }

  try {
    {   // siempre: primero TIZADA revisa los datos; recién si los acepta se manda
      const v = await api.validar(null, zip);
      if (soloRevisar) {
        const id = await guardarEnvio(pool, { ...reg, Estado: 'REVISADO', Etapa: 'TIZADA lo aceptaría', Alarmas: v?.alarmas || [] });
        return { EnvioID: id, Referencia: referencia, Estado: 'REVISADO', Alarmas: v?.alarmas || [] };
      }
    }
    const r = await api.enviar(zip);
    const id = await guardarEnvio(pool, { ...reg, Estado: 'EN_COLA', Etapa: r?.etapa || 'esperando al robot de TIZADA', Alarmas: r?.alarmas || [] });
    await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'EDICION', texto: `Pedido mandado a TIZADA PRO para generar la tizada (referencia ${referencia}).` });
    return { EnvioID: id, Referencia: referencia, Estado: 'EN_COLA' };
  } catch (e) {
    if (e instanceof api.ErrorTizada && (e.status === 422 || e.status === 415)) {
      const id = await guardarEnvio(pool, { ...reg, Estado: 'RECHAZADO', Etapa: 'TIZADA no lo acepta', Alarmas: e.alarmas, ErrorTexto: e.message });
      return { EnvioID: id, Referencia: referencia, Estado: 'RECHAZADO', Alarmas: e.alarmas, mensaje: e.message };
    }
    throw fallo(e.status || 502, e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Vuelta: estado → resultado → archivos en la solicitud
// ─────────────────────────────────────────────────────────────────────
const ESTADO_DE = { en_cola: 'EN_COLA', procesando: 'PROCESANDO', listo: 'LISTO', rechazado: 'RECHAZADO', error: 'ERROR', cancelado: 'CANCELADO' };

async function envioPorReferencia(pool, referencia) {
  const r = await pool.request().input('R', sql.VarChar(80), referencia).query('SELECT * FROM dbo.TizadaProEnvios WHERE Referencia = @R');
  return deFila(r.recordset[0]) || null;
}

/** Recibe el JSON de estado (de GET /pedidos/{ref} o del aviso) y lo guarda; si está listo, aplica el resultado. */
async function procesarEstado(pool, data) {
  const ref = data?.referencia;
  if (!ref) return { ok: false, motivo: 'sin referencia' };
  const env = await envioPorReferencia(pool, ref);
  if (!env) return { ok: false, motivo: `referencia ${ref} desconocida` };
  if (['APLICADO', 'APLICANDO'].includes(env.Estado)) return { ok: true, estado: env.Estado };
  const estado = ESTADO_DE[String(data.estado || '').toLowerCase()] || env.Estado;
  await pool.request().input('E', sql.Int, env.EnvioID).input('Es', sql.VarChar(20), estado)
    .input('Et', sql.NVarChar(300), txt(data.etapa, 300) || null)
    .input('Al', sql.NVarChar(sql.MAX), json(data.alarmas || data.resultado?.alarmas || leer(env.AlarmasJson, [])))
    .input('Res', sql.NVarChar(sql.MAX), json(data.resultado || null))
    .query(`UPDATE dbo.TizadaProEnvios SET Estado = @Es, Etapa = ISNULL(@Et, Etapa), AlarmasJson = @Al,
              ResultadoJson = ISNULL(@Res, ResultadoJson), FechaActualizado = GETDATE(),
              FechaFin = CASE WHEN @Es IN ('RECHAZADO','ERROR','CANCELADO') THEN GETDATE() ELSE FechaFin END
            WHERE EnvioID = @E AND Estado NOT IN ('APLICADO','APLICANDO')`);
  if (estado === 'LISTO' && data.resultado) return aplicarResultado(pool, env.EnvioID, data.resultado);
  return { ok: true, estado };
}

/** Pregunta a TIZADA por un envío (botón "Actualizar" y sondeo). */
async function actualizar(pool, envioId) {
  const r = await pool.request().input('E', sql.Int, envioId).query('SELECT * FROM dbo.TizadaProEnvios WHERE EnvioID = @E');
  const env = deFila(r.recordset[0]);
  if (!env) throw fallo(404, 'Ese envío a TIZADA PRO no existe.');
  if (env.Estado === 'LISTO' && env.ResultadoJson) return aplicarResultado(pool, env.EnvioID, leer(env.ResultadoJson, {}));
  if (!['EN_COLA', 'PROCESANDO'].includes(env.Estado)) return { ok: true, estado: env.Estado };
  return procesarEstado(pool, await api.estado(env.Referencia));
}

// Tela de TIZADA ("Jacquard Charrúa (1,83)") → nuestro artículo (nombre, código, ancho)
async function telaDe(pool, nombre) {
  let ancho = null;
  const m = String(nombre || '').match(/\((\d+[.,]\d+)\)\s*$/);
  if (m) ancho = Number(m[1].replace(',', '.'));
  try {
    const tz = require('./tizadaProService');
    const { porNombre } = await tz.telas(pool);
    const limpio = sinTilde(String(nombre || '').replace(/\(\d+[.,]\d+\)\s*$/, ''));
    for (const [k, t] of porNombre) {
      if (sinTilde(k) === sinTilde(nombre) || sinTilde(k) === limpio) return { material: t.nombre, codArticulo: t.codArticulo || null, anchoM: t.anchoCm ? t.anchoCm / 100 : ancho };
    }
  } catch (_) { /* sin base de TizadaPro: queda el nombre que mandó TIZADA */ }
  return { material: String(nombre || '').trim() || null, codArticulo: null, anchoM: ancho };
}

// Trae el PDF a NUESTRO Drive según TIZADAPRO_PDF_MODO: copiar (Drive→Drive) | enlace (el de TIZADA) | bajar (API → nuestro Drive)
async function traerPdf(arch, nombreNuevo) {
  const drive = require('./driveService');
  const modo = PDF_MODO();
  if (modo === 'enlace' && arch.enlace) return { url: arch.enlace, como: 'enlace de TIZADA' };
  if (modo !== 'bajar' && arch.drive_id) {
    try { const c = await drive.copyFile(arch.drive_id, nombreNuevo, AREA_DRIVE); return { url: c.url, bytes: c.bytes, como: 'copiado en Drive' }; }
    catch (e) { logger.warn(`[TIZADAPRO] no se pudo copiar ${arch.nombre} en Drive (${e.message}); lo bajo de TIZADA`); }
  }
  if (!arch.descarga) throw new Error(`"${arch.nombre}" no trae ni drive_id ni descarga`);
  const { buffer } = await api.bajarArchivo(arch.descarga);
  if (arch.sha256 && api.sha256(buffer) !== String(arch.sha256).toLowerCase()) throw new Error(`"${arch.nombre}" llegó incompleto (sha256 distinto)`);
  const url = await drive.uploadToDrive(buffer, nombreNuevo, AREA_DRIVE);
  return { url, bytes: buffer.length, como: 'bajado de TIZADA' };
}

async function aplicarResultado(pool, envioId, resultado) {
  // Candado: un solo proceso aplica cada envío (aviso y sondeo pueden llegar juntos)
  const lock = await pool.request().input('E', sql.Int, envioId)
    .query(`UPDATE dbo.TizadaProEnvios SET Estado = 'APLICANDO', FechaActualizado = GETDATE()
            OUTPUT INSERTED.* WHERE EnvioID = @E AND Estado NOT IN ('APLICADO','APLICANDO')`);
  const env = deFila(lock.recordset[0]);
  if (!env) return { ok: true, estado: 'APLICADO' };
  if (env.Origen !== ORIGEN) {   // fase 2 (PORTAL): todavía no se carga el resultado de este lado
    await pool.request().input('E', sql.Int, envioId).query("UPDATE dbo.TizadaProEnvios SET Estado = 'LISTO' WHERE EnvioID = @E");
    return { ok: false, estado: 'LISTO', mensaje: `Origen ${env.Origen}: falta implementar dónde se carga la tizada.` };
  }
  const base = require('./solicitudesVendedorService')._baseTizadaPro();
  const user = USUARIO_AUTO(env.UsuarioID);
  try {
    const archivos = (resultado?.archivos || []);
    const tizadas = archivos.filter(a => String(a.tipo).toLowerCase() === 'tizada');
    const ficha = archivos.find(a => String(a.tipo).toLowerCase() === 'ficha');
    if (!tizadas.length) throw new Error('TIZADA terminó pero el resultado no trae ninguna tizada.');

    // 1. Los PDF a nuestro Drive (fuera de la transacción: es lento)
    const listos = [];
    for (const a of tizadas) {
      const tela = await telaDe(pool, a.tela);
      if (Number(a.ancho_cm) > 0) tela.anchoM = Number(a.ancho_cm) / 100;   // el ancho real de la mesa lo manda TIZADA
      const metros = (Number(a.consumo_cm) || 0) / 100;
      // Nombre: <referencia>_<tela sin el ancho>_<metros>m.pdf  (ej. SOL-12-P34-1_Dry_Fit_3.21m.pdf)
      const nombre = `${env.Referencia}_${slug(String(tela.material || a.tela || '').replace(/\(\d+[.,]\d+\)\s*$/, ''))}_${metros.toFixed(2)}m.pdf`;
      const t = await traerPdf(a, nombre);
      listos.push({ nombre, url: t.url, bytes: t.bytes || a.bytes || null, como: t.como, tela, metros, mesas: a.mesas || null, aprovechamiento: a.aprovechamiento ?? null, original: a.nombre });
    }
    let fichaLista = null;
    if (ficha) {
      const nombre = `FICHA TECNICA ${env.Referencia}.pdf`;
      try { const t = await traerPdf(ficha, nombre); fichaLista = { nombre, url: t.url, bytes: t.bytes || ficha.bytes || null }; }
      catch (e) { logger.warn(`[TIZADAPRO] ${env.Referencia}: la ficha técnica no se pudo traer: ${e.message}`); }
    }

    // 2. Todo lo de la base en una transacción
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    const creados = [];
    try {
      const pa = (await new sql.Request(transaction).input('P', sql.Int, env.ProductoSolID).query(
        "SELECT TOP 1 * FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Tipo = 'PRINCIPAL' AND Activo = 1")).recordset[0];
      if (!pa) throw new Error('El producto ya no tiene producción principal.');
      // Los diseños prontos anteriores de la producción principal quedan reemplazados por la tizada
      await new sql.Request(transaction).input('Pa', sql.Int, pa.ParteID)
        .query("UPDATE dbo.SolicitudesVendedorArchivos SET Vigente = 0 WHERE ParteID = @Pa AND Rol = 'DISENO_PRONTO' AND Vigente = 1");
      for (const x of listos) {
        const r = await new sql.Request(transaction)
          .input('S', sql.Int, env.SolicitudID).input('P', sql.Int, env.ProductoSolID).input('Pa', sql.Int, pa.ParteID)
          .input('N', sql.NVarChar(260), x.nombre).input('U', sql.NVarChar(sql.MAX), x.url).input('B', sql.BigInt, x.bytes)
          .input('An', sql.Decimal(10, 4), x.tela.anchoM).input('Al', sql.Decimal(10, 4), x.metros)
          .input('M', sql.NVarChar(200), x.tela.material).input('C', sql.VarChar(50), x.tela.codArticulo).input('Us', sql.Int, user.id)
          .query(`INSERT INTO dbo.SolicitudesVendedorArchivos (SolicitudID, ProductoSolID, ParteID, Rol, NombreOriginal, UrlDrive, TamanoBytes, AnchoM, AltoM, Vigente, UsuarioSube, Material, CodArticulo, Copias)
                  OUTPUT INSERTED.ArchivoID VALUES (@S, @P, @Pa, 'DISENO_PRONTO', @N, @U, @B, @An, @Al, 1, @Us, @M, @C, 1)`);
        creados.push({ ArchivoID: r.recordset[0].ArchivoID, nombre: x.nombre, tipo: 'tizada', url: x.url, tela: x.tela.material, metros: x.metros, como: x.como });
      }
      if (fichaLista) {
        const r = await new sql.Request(transaction)
          .input('S', sql.Int, env.SolicitudID).input('P', sql.Int, env.ProductoSolID)
          .input('N', sql.NVarChar(260), fichaLista.nombre).input('U', sql.NVarChar(sql.MAX), fichaLista.url).input('B', sql.BigInt, fichaLista.bytes).input('Us', sql.Int, user.id)
          .query(`INSERT INTO dbo.SolicitudesVendedorArchivos (SolicitudID, ProductoSolID, Rol, NombreOriginal, UrlDrive, TamanoBytes, Vigente, UsuarioSube)
                  OUTPUT INSERTED.ArchivoID VALUES (@S, @P, 'REFERENCIA', @N, @U, @B, 1, @Us)`);
        creados.push({ ArchivoID: r.recordset[0].ArchivoID, nombre: fichaLista.nombre, tipo: 'ficha', url: fichaLista.url });
      }
      // Marca de diseño automático en la parte + estado DISEÑADO
      const datosPa = leer(pa.DatosJson, {});
      datosPa.disenoAutomatico = { sistema: 'TIZADA PRO', referencia: env.Referencia, tizadaId: resultado.tizada_id || null, fecha: new Date().toISOString(), hojas: creados.filter(c => c.tipo === 'tizada').length };
      await new sql.Request(transaction).input('Pa', sql.Int, pa.ParteID).input('D', sql.NVarChar(sql.MAX), JSON.stringify(datosPa))
        .query('UPDATE dbo.SolicitudesVendedorPartes SET DatosJson = @D WHERE ParteID = @Pa');
      const textoHojas = listos.map(x => `${x.tela.material || x.original}: ${x.metros.toFixed(2)} m`).join(' · ');
      if (pa.Estado === 'DISENADO') {
        await base.registrarEvento(transaction, user, { solicitudId: env.SolicitudID, productoSolId: env.ProductoSolID, parteId: pa.ParteID, tipo: 'ARCHIVO', texto: `Diseño automático (TIZADA PRO, ${env.Referencia}): la tizada reemplazó al diseño pronto. ${textoHojas}` });
      } else {
        await base.cambiarEstadoParte(transaction, user, pa, 'DISENADO', 'FechaDisenado = GETDATE(), UsuarioDisenado = @U', `diseño automático: lo hizo TIZADA PRO (${env.Referencia}). ${textoHojas}`);
      }
      await new sql.Request(transaction).input('E', sql.Int, envioId).input('A', sql.NVarChar(sql.MAX), json(creados)).input('Res', sql.NVarChar(sql.MAX), json(resultado))
        .query(`UPDATE dbo.TizadaProEnvios SET Estado = 'APLICADO', ArchivosJson = @A, ResultadoJson = @Res, Etapa = N'Tizada cargada en la solicitud', FechaActualizado = GETDATE(), FechaFin = GETDATE() WHERE EnvioID = @E`);
      await transaction.commit();
    } catch (e) {
      try { await transaction.rollback(); } catch (_) { /* ya cerrada */ }
      throw e;
    }
    logger.info(`[TIZADAPRO] ${env.Referencia}: ${creados.length} archivo(s) cargados en la solicitud ${env.SolicitudID}.`);
    return { ok: true, estado: 'APLICADO', archivos: creados };
  } catch (e) {
    logger.error(`[TIZADAPRO] ${env.Referencia}: no se pudo cargar el resultado: ${e.message}`);
    await pool.request().input('E', sql.Int, envioId).input('Err', sql.NVarChar(1000), txt(e.message, 1000))
      .query("UPDATE dbo.TizadaProEnvios SET Estado = 'ERROR_APLICAR', ErrorTexto = @Err, FechaActualizado = GETDATE() WHERE EnvioID = @E");
    return { ok: false, estado: 'ERROR_APLICAR', mensaje: e.message };
  }
}

/** Reintenta cargar un resultado que falló al aplicarse (ERROR_APLICAR) — botón en la pantalla. */
async function reintentarAplicar(pool, envioId) {
  await pool.request().input('E', sql.Int, envioId).query("UPDATE dbo.TizadaProEnvios SET Estado = 'LISTO' WHERE EnvioID = @E AND Estado = 'ERROR_APLICAR'");
  return actualizar(pool, envioId);
}

// ─────────────────────────────────────────────────────────────────────
// Aviso (webhook) y sondeo
// ─────────────────────────────────────────────────────────────────────
/** POST /api/integracion/tizadapro/aviso — cuerpo CRUDO (Buffer). Contesta rápido; aplica después. */
async function recibirAviso(req, res) {
  try {
    if (process.env.TIZADAPRO_AVISO_ACTIVO === '0') return res.status(503).json({ ok: false, error: 'El aviso de TIZADA PRO está apagado (TIZADAPRO_AVISO_ACTIVO=0).' });
    const crudo = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
    if (!api.firmaValida(crudo, req.headers['x-tizada-firma'])) {
      logger.warn(`[TIZADAPRO] aviso con firma inválida (referencia ${req.headers['x-tizada-referencia'] || '?'}) — ignorado`);
      return res.status(401).json({ ok: false, error: 'firma inválida' });
    }
    const data = JSON.parse(crudo.toString('utf8'));
    res.json({ ok: true });
    const pool = await getPool();
    if (!(await tieneTabla(pool))) return;
    const r = await procesarEstado(pool, data);
    logger.info(`[TIZADAPRO] aviso ${data.referencia}: ${r.estado || r.motivo}`);
  } catch (e) {
    logger.error(`[TIZADAPRO] aviso: ${e.message}`);
    if (!res.headersSent) res.status(400).json({ ok: false, error: e.message });
  }
}

let sondeando = false;
async function sondear() {
  if (sondeando || !api.estadoConfig().ok) return;
  sondeando = true;
  try {
    const pool = await getPool();
    if (!(await tieneTabla(pool))) return;
    const r = await pool.request().query(`
      SELECT EnvioID FROM dbo.TizadaProEnvios
      WHERE Estado IN ('EN_COLA','PROCESANDO','LISTO') AND FechaEnvio > DATEADD(day, -7, GETDATE())`);
    for (const { EnvioID } of r.recordset) {
      try { await actualizar(pool, EnvioID); } catch (e) { logger.warn(`[TIZADAPRO] sondeo envío ${EnvioID}: ${e.message}`); }
    }
  } catch (e) { logger.warn(`[TIZADAPRO] sondeo: ${e.message}`); }
  finally { sondeando = false; }
}
let timer = null;
function iniciarSondeo() {
  const seg = parseInt(process.env.TIZADAPRO_SONDEO_SEGUNDOS, 10);
  if (timer || !(seg > 0) || !api.estadoConfig().ok) return;
  timer = setInterval(sondear, Math.max(15, seg) * 1000);
  if (timer.unref) timer.unref();
  logger.info(`[TIZADAPRO] sondeo cada ${Math.max(15, seg)} s de los pedidos en curso`);
}

// ─────────────────────────────────────────────────────────────────────
// Envío automático (TIZADAPRO_ENVIO_MODO=AL_ENVIAR_A_DISENO)
// ─────────────────────────────────────────────────────────────────────
/** Lo llama enviarADiseno después de mandar la producción principal a Diseño. Nunca lanza. */
/**
 * Antes de "Enviar a Diseño" la producción principal con molde de TIZADA PRO: TIZADA tiene que aceptar los datos
 * y el arte tiene que pasar la revisión de letras. Si no, no sale a Diseño (409 con lo que falta).
 * Con TIZADAPRO_API_ACTIVA=0 (integración apagada a propósito) no se valida y sigue el circuito manual.
 */
async function validarParaDiseno(pool, user, base, parteId) {
  const pa = (await pool.request().input('Pa', sql.Int, parteId).query(
    'SELECT ParteID, Tipo, Estado, SolicitudID, ProductoSolID FROM dbo.SolicitudesVendedorPartes WHERE ParteID = @Pa')).recordset[0];
  if (!pa || pa.Tipo !== 'PRINCIPAL' || pa.Estado !== 'INGRESADO') return null;
  const p = await productoConMolde(pool, pa.SolicitudID, pa.ProductoSolID);
  if (!p.MoldeRef || p.TipoFabricacion !== 'PRODUCTO_TERMINADO') return null;
  if (process.env.TIZADAPRO_API_ACTIVA === '0') return null;
  const conf = api.estadoConfig();
  if (!conf.ok) throw fallo(503, `No se puede enviar a Diseño: antes TIZADA PRO tiene que aceptar el pedido y la conexión no está lista (${conf.motivo}).`);
  let r;
  try { r = await enviar(pool, user, base, pa.SolicitudID, pa.ProductoSolID, { soloRevisar: true }, true); }
  catch (e) { throw fallo(e.status || 502, `No se puede enviar a Diseño todavía. ${e.message}`); }
  if (r.Estado === 'RECHAZADO') {
    const lista = (r.Alarmas || []).filter(a => a.frena !== false).map(a => a.mensaje || a.codigo);
    throw fallo(409, `TIZADA PRO no lo acepta, así que no se envía a Diseño:\n• ${(lista.length ? lista : [r.mensaje || 'mirá las alarmas en el bloque de TIZADA PRO']).slice(0, 12).join('\n• ')}`);
  }
  return r;
}

async function envioAutomatico(pool, user, base, solicitudId, productoSolId) {
  try {
    if (MODO_ENVIO() !== 'AL_ENVIAR_A_DISENO' || !api.estadoConfig().ok) return null;
    const p = await productoConMolde(pool, solicitudId, productoSolId);
    if (!p.MoldeRef || !p.Datos.tizadaPro?.disenos?.length) return null;
    const r = await enviar(pool, user, base, solicitudId, productoSolId, {}, true);
    logger.info(`[TIZADAPRO] envío automático SOL-${solicitudId}/P${productoSolId}: ${r.Estado} (${r.Referencia})`);
    return r;
  } catch (e) {
    logger.warn(`[TIZADAPRO] envío automático SOL-${solicitudId}/P${productoSolId} no salió: ${e.message}`);
    return null;
  }
}

module.exports = { validarParaDiseno, ver, guardar, enviar, actualizar, reintentarAplicar, procesarEstado, aplicarResultado, recibirAviso, iniciarSondeo, sondear, envioAutomatico, estructura, revisar, armarPedidoJson, MODO_ENVIO };
