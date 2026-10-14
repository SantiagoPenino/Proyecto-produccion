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
const aMedidaSvc = require('./tizadaProAMedida');   // [A MEDIDA] pañuelos, toallas, banderas (13/10)

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
// [A MEDIDA] ¿Ya se corrió docs/migrations/configurador_a_medida.sql?
let _conAMedida = false;
async function conAMedidaCol(cx) {
  if (_conAMedida) return true;
  _conAMedida = (await new sql.Request(cx).query("SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'AMedidaJson') AS c")).recordset[0].c != null;
  return _conAMedida;
}

let _conMesas = false;
async function conMesasCol(cx) {
  if (_conMesas) return true;
  _conMesas = (await new sql.Request(cx).query("SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaMesasModo') AS c")).recordset[0].c != null;
  return _conMesas;
}

async function productoConMolde(cx, solicitudId, productoSolId) {
  const am = await conAMedidaCol(cx);
  const mesas = await conMesasCol(cx);
  const r = await new sql.Request(cx).input('S', sql.Int, solicitudId).input('P', sql.Int, productoSolId).query(`
    SELECT p.ProductoSolID, p.SolicitudID, p.TipoFabricacion, p.ProIdProducto, p.ProductoNombre, p.Cantidad, p.DatosJson, p.PedidoNoDocERP,
           LTRIM(RTRIM(v.TizadaProMoldeRef)) AS MoldeRef${am ? ', v.AMedidaJson' : ''}${mesas ? ', LTRIM(RTRIM(v.TizadaMesasModo)) AS MesasModo' : ''}
    FROM dbo.SolicitudesVendedorProductos p
    LEFT JOIN dbo.ProductoVentaConfig v ON v.ProIdProducto = p.ProIdProducto
    WHERE p.ProductoSolID = @P AND p.SolicitudID = @S AND p.Activo = 1`);
  const p = r.recordset[0];
  if (!p) throw fallo(404, 'Ese producto no pertenece a la solicitud.');
  p.Datos = leer(p.DatosJson, {});
  p.AMedida = p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? leer(p.AMedidaJson, null) : null;   // [A MEDIDA] null = no es a medida
  delete p.AMedidaJson;
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
  const r = await (await tz.poolTz(pool)).request().query(`SELECT valor FROM [${tz.DB}].dbo.config WHERE clave = 'catalogo'`);
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

async function estructuraApi(moldeRef, aMedida) {
  const r = await api.molde(moldeRef);
  const m = r?.molde || r;   // el servidor real contesta { molde: {…}, version }
  const talles = comaLista(m.talles || m.planilla?.talles);
  const cols = m.planilla?.columnas || m.columnas || [];
  const columnas = cols.map(c => normalizarColumna(c, talles, null)).filter(Boolean);
  const colTalle = m.planilla?.columna_talle || columnas.find(c => c.tipo === 'talle')?.id || null;
  // [A MEDIDA] "Una prenda a medida no lleva talle en la fila": sin columnas de talle
  if (aMedida) return { fuente: 'TIZADA_API', plantilla: m.planilla?.nombre || null, columnas: columnas.filter(c => c.tipo !== 'talle'), talles: [], columnaTalle: null, piezas: comaLista(m.piezas), aMedida: true };
  columnas.forEach(c => { if (c.id === colTalle) { c.tipo = 'talle'; c.obligatoria = true; if (!c.opciones.length) c.opciones = talles; } });
  return { fuente: 'TIZADA_API', plantilla: m.planilla?.nombre || null, columnas, talles, columnaTalle: colTalle, piezas: comaLista(m.piezas) };
}

// [A MEDIDA] Sin TIZADA no hay de dónde leer la planilla del molde: la fila de una prenda a medida es solo la cantidad
const estructuraAMedida = (cfg) => ({
  fuente: 'A_MEDIDA', plantilla: null, talles: [], columnaTalle: null, piezas: cfg?.pieza ? [cfg.pieza] : [], aMedida: true,
  columnas: [{ id: 'cantidad', label: 'Cantidad', rol: 'cantidad', tipo: 'numero', opciones: [], obligatoria: false }],
});

async function estructura(pool, moldeRef, aMedida = null) {
  if (!moldeRef) return null;
  if (aMedida) {
    if (api.estadoConfig().ok) {
      try { const e = await estructuraApi(moldeRef, true); if (e.columnas.length) return e; }
      catch (e) { logger.warn(`[TIZADAPRO] estructura a medida de ${moldeRef} por API: ${e.message} — solo cantidad`); }
    }
    return estructuraAMedida(aMedida);
  }
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
// Telas propias de un diseño (portal, 13/10): pieza → tela para las piezas que en ESE arte van distinto de "Piezas y
// telas" (ej. el golero con otra tela en el frente). Sin telas propias, el diseño usa las de todos, como siempre.
const conTelasPropias = (subl, propias) => (!subl || !propias || !Object.keys(propias).length ? subl : {
  ...subl, piezas: (subl.piezas || []).map(x => (!x.fija && propias[x.pieza] ? { ...x, telaProIdProducto: Number(propias[x.pieza]), telaNombre: null } : x)),
});
// [A MEDIDA] Cada diseño lleva SU medida, SU tela y SU cantidad; la variable es la del producto. La lista se arma sola:
// una fila por diseño con su cantidad (la fila de una prenda a medida no lleva talle).
function conAMedida(datos, cfg) {
  const disenos = (datos?.disenos || []).map(d => ({
    ...d, variable: cfg.variable, variableNombre: cfg.variableNombre, telasPorPieza: {},
    tela: d.tela || (cfg.telas?.length === 1 ? cfg.telas[0] : null),
    // la medida con lo que define el producto (forma y terminación por defecto, la medida única si mínimo = máximo)
    medida: aMedidaSvc.normalizarMedida(d.medida, cfg, null).medida,
  }));
  return { ...(datos || {}), disenos, planilla: datos?.planilla || [] };
}
const datosDe = (p, guardado) => (p.AMedida ? conAMedida(guardado || {}, p.AMedida) : conPiezas(guardado || {}, p.Datos.sublimacion));
const columnaCantidad = (est) => (est?.columnas || []).find(c => c.rol === 'cantidad') || (est?.columnas || []).find(c => c.tipo === 'numero') || null;

function conPiezas(datos, subl) {
  const disenos = (datos?.disenos || []).map(d => {
    const b = basePiezas(conTelasPropias(subl, d.telasPropias));
    return b ? { ...d, variable: b.variable, variableNombre: b.variableNombre, tela: b.tela, telasPorPieza: b.telasPorPieza } : d;
  });
  return { ...(datos || {}), disenos, planilla: datos?.planilla || [] };
}

// ─────────────────────────────────────────────────────────────────────
// Validación de diseños + lista de talles (la misma que muestra la pantalla)
// ─────────────────────────────────────────────────────────────────────
function revisar(est, datos, archivos, aMedida = null) {
  const errores = [];
  const disenos = datos?.disenos || [];
  const filas = datos?.planilla || [];
  const nombres = disenos.map(d => sinTilde(d.nombre));
  if (!disenos.length) errores.push({ donde: 'disenos', mensaje: 'Cargá al menos un diseño (por ejemplo JUGADOR).' });
  disenos.forEach((d, i) => {
    const n = `Diseño ${i + 1}${d.nombre ? ` (${d.nombre})` : ''}`;
    if (!txt(d.nombre)) errores.push({ donde: `disenos[${i}].nombre`, mensaje: `${n}: falta el nombre.` });
    else if (nombres.indexOf(sinTilde(d.nombre)) !== i) errores.push({ donde: `disenos[${i}].nombre`, mensaje: `${n}: el nombre está repetido.` });
    if (aMedida) {
      // [A MEDIDA] la medida, la tela y la cantidad son de cada diseño
      aMedidaSvc.normalizarMedida(d.medida, aMedida, null).errores.forEach(m => errores.push({ donde: `disenos[${i}].medida`, mensaje: `${n}: ${m}` }));
      if (!txt(d.tela)) errores.push({ donde: `disenos[${i}].tela`, mensaje: `${n}: falta la tela.` });
      else if (aMedida.telas?.length && !aMedida.telas.includes(String(d.tela))) errores.push({ donde: `disenos[${i}].tela`, mensaje: `${n}: esa tela no la ofrece el producto.` });
      if (!(parseInt(d.cantidad, 10) > 0)) errores.push({ donde: `disenos[${i}].cantidad`, mensaje: `${n}: falta la cantidad.` });
    } else {
    if (!txt(d.variable)) errores.push({ donde: `disenos[${i}].variable`, mensaje: `${n}: falta el modelo (elegilo y guardalo en "2 · Piezas y telas").` });
    if (!txt(d.tela)) errores.push({ donde: `disenos[${i}].tela`, mensaje: `${n}: falta la tela (elegila y guardala en "2 · Piezas y telas").` });
    }
    if (!d.arteArchivoId) errores.push({ donde: `disenos[${i}].arte`, mensaje: `${n}: falta el arte para TIZADA (.ai o .pdf).` });
    else if (archivos && !archivos.some(a => a.ArchivoID === Number(d.arteArchivoId) && a.Vigente)) errores.push({ donde: `disenos[${i}].arte`, mensaje: `${n}: el arte elegido ya no está en la solicitud.` });
  });
  if (!filas.length && !aMedida) errores.push({ donde: 'planilla', mensaje: 'La lista de talles está vacía.' });
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
    // La lista manda: cada variante de la lista necesita su arte (arriba, en "1 · Arte del cliente")
    if (txt(f.diseno) && !nombres.includes(sinTilde(f.diseno))) errores.push({ donde: `planilla[${i}].diseno`, fila, mensaje: `Fila ${fila}: la variante ${txt(f.diseno).toUpperCase()} no tiene arte. Subilo arriba y poné "De ${txt(f.diseno).toUpperCase()}".` });
    else if (!txt(f.diseno) && disenos.length > 1) errores.push({ donde: `planilla[${i}].diseno`, fila, mensaje: `Fila ${fila}: elegí la variante (qué diseño la imprime).` });
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
  try { est = await estructura(pool, p.MoldeRef, p.AMedida); } catch (e) { errorEstructura = e.message; }
  const guardado = p.Datos.tizadaPro || { disenos: [], planilla: [] };
  const archivos = (await pool.request().input('S', sql.Int, solicitudId).input('P', sql.Int, productoSolId).query(`
    SELECT a.ArchivoID, a.NombreOriginal, a.Rol, a.UrlDrive, a.Vigente, a.ProductoSolID, a.ParteID, a.FechaSubida, pa.Tipo AS ParteTipo
    FROM dbo.SolicitudesVendedorArchivos a
    LEFT JOIN dbo.SolicitudesVendedorPartes pa ON pa.ParteID = a.ParteID
    WHERE a.SolicitudID = @S AND a.Vigente = 1 AND a.UrlDrive <> 'Pendiente'
      AND (a.ProductoSolID = @P OR pa.ProductoSolID = @P OR (a.ProductoSolID IS NULL AND a.ParteID IS NULL AND a.EventoID IS NULL))
    ORDER BY a.FechaSubida DESC`)).recordset;
  const artes = archivos.filter(a => /\.(ai|pdf)$/i.test(a.NombreOriginal || '') && a.Rol !== 'COMPROBANTE');
  // Arranque: un diseño JUGADOR con el arte que lo nombra (o el único que haya)
  const arranque = !guardado.disenos?.length;
  if (arranque && p.AMedida) {
    // [A MEDIDA] arranca con un diseño con la medida por defecto del producto (la primera fija, o vacía)
    const fija = p.AMedida.medidas?.modo === 'FIJAS' ? p.AMedida.medidas.fijas[0] : null;
    guardado.disenos = [{ nombre: 'DISEÑO 1', arteArchivoId: artes.length === 1 ? artes[0].ArchivoID : null, cantidad: Number(p.Cantidad) > 0 ? Number(p.Cantidad) : 1,
      medida: aMedidaSvc.normalizarMedida({ fija: fija?.nombre }, p.AMedida, null).medida }];
  } else if (arranque) {
    const arte = artes.find(a => /jugador/i.test(a.NombreOriginal || '')) || (artes.length === 1 ? artes[0] : null);
    guardado.disenos = [{ nombre: 'JUGADOR', arteArchivoId: arte ? arte.ArchivoID : null }];
  }
  const datos = datosDe(p, guardado);
  const aMedida = p.AMedida ? await infoAMedida(pool, p.AMedida, datos) : null;
  return {
    aplica: true, ...general, moldeRef: p.MoldeRef, estructura: est, errorEstructura, datos, sinGuardar: arranque,
    piezas: basePiezas(p.Datos.sublimacion),
    artes: artes.map(a => ({ ArchivoID: a.ArchivoID, nombre: a.NombreOriginal, rol: a.Rol, parteId: a.ParteID || null, url: a.UrlDrive })),
    // [EXTRAS EN LA TABLA] el arte subido aparte para bordado / DTF / TPU (no los editables, que salen del arte del diseño)
    artesExtras: archivos.filter(a => a.Rol === 'ARTE_CLIENTE' && ['BORDADO', 'DTF', 'TPU'].includes(a.ParteTipo) && !/^EDITABLE_/i.test(a.NombreOriginal || ''))
      .map(a => ({ ArchivoID: a.ArchivoID, nombre: a.NombreOriginal, tipo: a.ParteTipo, parteId: a.ParteID, url: a.UrlDrive })),
    errores: est ? revisar(est, datos, archivos, p.AMedida) : [],
    envios: await envios(pool, productoSolId),
    ...(aMedida ? { aMedida } : {}),
  };
}

// [A MEDIDA] Lo que la pantalla necesita para pedir la medida: la configuración del producto, las telas que ofrece
// (con nombre), cómo se llama cada cosa, los lados de las tiras por forma y la plantilla pedida (si es de la medida de hoy).
async function infoAMedida(pool, cfg, datos) {
  let v = null; let motivo = null;
  if (api.estadoConfig().ok) { try { v = await aMedidaSvc.variableAMedida(cfg.variable); } catch (e) { motivo = `TIZADA PRO no contestó: ${e.message}`; } }
  else motivo = api.estadoConfig().motivo;
  let telas = v ? aMedidaSvc.telasOfrecidas(cfg, v) : [];
  if (!v && cfg.telas?.length) {
    // Sin TIZADA: las telas de TIZADA son copias de nuestros artículos (id = ProIdProducto) → nombre de Articulos
    const ids = cfg.telas.map(x => parseInt(x, 10)).filter(Number.isInteger);
    const r = ids.length ? (await pool.request().query(`SELECT ProIdProducto, LTRIM(RTRIM(Descripcion)) AS d FROM dbo.Articulos WHERE ProIdProducto IN (${ids.join(',')})`)).recordset : [];
    telas = cfg.telas.map(id => ({ id, nombre: r.find(x => String(x.ProIdProducto) === id)?.d || `Tela ${id}`, anchoMesaCm: null, entraHastaCm: null }));
  }
  const pl = datos?.plantilla || null;
  const medidasHoy = Object.fromEntries((datos?.disenos || []).map(d => [d.nombre, aMedidaSvc.resumen(d.medida)]));
  const plantillaVieja = pl ? Object.keys(medidasHoy).filter(n => pl.medidas?.[n] !== medidasHoy[n]) : [];
  return {
    config: cfg, telas, enTizada: !!v, motivo, avisos: v ? aMedidaSvc.revisarConfig(cfg, v) : [],
    permitido: v ? aMedidaSvc.permitido(v.aMedida) : null,
    nombres: aMedidaSvc.NOMBRE, lados: aMedidaSvc.LADOS,
    resumenes: medidasHoy,
    plantilla: pl ? { ...pl, deOtraMedida: plantillaVieja } : null,
  };
}

// Vendedor (carga diseños + lista) o diseñador (elige la letra y puede corregir antes de generar)
async function exigirVendedorODisenador(pool, user, base) {
  if (base.esVendedor(user) || await base.esDisenador(pool, user)) return;
  throw fallo(403, 'Esto lo hace el vendedor o un diseñador habilitado.');
}

// [A MEDIDA · PORTAL] El cliente de la Tienda no cambia nada de lo que establece el producto (por ahora): forma, punta,
// medida, terminación y tiras salen del producto; solo elige la tela (y la cantidad). Si el producto tiene varias medidas
// fijas, elige entre ESAS. Lo demás que mande se ignora acá, en el servidor.
const medidaDelCliente = (user, m) => (user?.portal ? { fija: m?.fija || null } : m);

// [EXTRAS EN LA TABLA 14/10] Las filas de un extra en un diseño: los objetos del arte que van en ese proceso y los archivos
// subidos aparte. "Dónde va" = "logo (Frente) · Frente: pecho izquierdo 8 cm".
const PROC_EXTRA = { BORDADO: 'bordado', DTF: 'dtf', TPU: 'tpu' };
const filasExtra = (d, T) => [
  ...(d.editablesDetalle || []).filter(o => ((d.editables || {})[o.objeto] || o.sugerido) === PROC_EXTRA[T]).map(o => `${o.objeto}${o.pieza ? ` (${o.pieza})` : ''}`),
  ...(d.extrasArchivos || []).filter(x => x.tipo === T).map(x => [x.pieza, x.detalle].filter(Boolean).join(': ') || 'sin ubicar'),
];
const dondeVa = (d, T) => filasExtra(d, T).join(' · ').slice(0, 200) || null;

async function guardar(pool, user, base, solicitudId, productoSolId, b) {
  await exigirVendedorODisenador(pool, user, base);
  const sol = await base.cabecera(pool, solicitudId);
  base.exigirAbierta(sol);
  const p = await productoConMolde(pool, solicitudId, productoSolId);
  if (p.PedidoNoDocERP) throw fallo(409, `Este producto ya se convirtió en el pedido ${p.PedidoNoDocERP}.`);
  if (!p.MoldeRef) throw fallo(409, 'Este producto no tiene molde de TIZADA PRO vinculado.');
  const est = await estructura(pool, p.MoldeRef, p.AMedida);
  if (!est?.columnas?.length) throw fallo(503, 'No se pudo leer la planilla del molde (columnas). No se guardó nada para no perder la lista; probá de nuevo en un rato.');
  const ids = new Set((est?.columnas || []).map(c => c.id));
  const disenos = (Array.isArray(b.disenos) ? b.disenos : []).slice(0, 12).map(d => ({
    nombre: txt(d.nombre, 40).toUpperCase(), variable: txt(d.variable, 96), variableNombre: txt(d.variableNombre, 200) || null,
    tela: txt(d.tela, 20) || null, arteArchivoId: parseInt(d.arteArchivoId, 10) || null,
    telasPorPieza: Object.fromEntries(Object.entries(d.telasPorPieza || {}).filter(([k, v]) => txt(k) && txt(v)).map(([k, v]) => [txt(k, 60), txt(v, 20)])),
    // pieza → tela de ESTE diseño cuando va distinto de "Piezas y telas" (solo telas que ofrece el producto: se controla abajo)
    telasPropias: Object.fromEntries(Object.entries(d.telasPropias || {}).filter(([k, v]) => txt(k) && parseInt(v, 10) > 0).map(([k, v]) => [txt(k, 60), String(parseInt(v, 10))])),
    // Extras de ESTE diseño (portal, 13/10): cuáles lleva y dónde van. Cada camiseta (jugador, golero…) puede llevar distintos.
    extras: Object.fromEntries(Object.entries(d.extras || {}).filter(([k]) => ['BORDADO', 'DTF', 'TPU'].includes(k))
      .map(([k, v]) => [k, { activo: !!v?.activo, ubicacion: txt(v?.ubicacion, 200) || null }])),
    // [EXTRAS EN LA TABLA 14/10] lo que va en bordado / DTF / TPU y NO está en el arte: el archivo subido aparte, en qué pieza
    // del molde y un detalle (ej. "pecho izquierdo, 8 cm"). undefined = pantalla vieja: no se toca nada de lo de antes.
    ...(Array.isArray(d.extrasArchivos) ? { extrasArchivos: d.extrasArchivos.slice(0, 30).map(x => ({
      archivoId: parseInt(x.archivoId, 10) || null, tipo: ['BORDADO', 'DTF', 'TPU'].includes(x.tipo) ? x.tipo : null,
      pieza: txt(x.pieza, 60) || null, detalle: txt(x.detalle, 120) || null })).filter(x => x.archivoId && x.tipo) } : {}),
    editables: Object.fromEntries(Object.entries(d.editables || {}).filter(([k, v]) => txt(k) && ['sublimado', 'dtf', 'tpu', 'bordado'].includes(txt(v))).map(([k, v]) => [txt(k, 60), txt(v, 20)])),
    // de qué arte ya se leyeron los editables (para leerlos solos una sola vez, aunque el arte no tenga ninguno)
    editablesLeidoDe: parseInt(d.editablesLeidoDe, 10) || null,
    editablesDetalle: (Array.isArray(d.editablesDetalle) ? d.editablesDetalle : []).slice(0, 20).map(o => ({ objeto: txt(o.objeto, 60), pieza: txt(o.pieza, 60) || null,
      anchoCm: Number(o.anchoCm) || null, altoCm: Number(o.altoCm) || null, posicion: txt(o.posicion, 120) || null, sugerido: txt(o.sugerido, 20) || null,
      vista: esMiniatura(o.vista) ? o.vista : null })).filter(o => o.objeto),
    // [A MEDIDA] la medida y la cantidad de ESTE diseño (se guarda aunque esté incompleta: revisar() frena el envío)
    ...(p.AMedida ? { medida: aMedidaSvc.normalizarMedida(medidaDelCliente(user, d.medida), p.AMedida, null).medida, cantidad: Math.min(Math.max(parseInt(d.cantidad, 10) || 0, 0), 100000) || null,
      // [PORTAL] el .ai / .pdf del cliente con el que el arte para TIZADA se arma solo al confirmar, cómo va (llenar / entera)
      // y de qué archivo, medida y ajuste salió el arte armado (si cambia algo, se vuelve a armar)
      archivoCliente: parseInt(d.archivoCliente, 10) || null, ajuste: d.ajuste === 'entera' ? 'entera' : 'llenar',
      arteAuto: parseInt(d.arteAuto?.origen, 10) > 0 ? { origen: parseInt(d.arteAuto.origen, 10), medida: txt(d.arteAuto.medida, 200), ajuste: d.arteAuto.ajuste === 'entera' ? 'entera' : 'llenar' } : null } : {}),
  }));
  // [EXTRAS EN LA TABLA] Con la tabla nueva (manda extrasArchivos), cada extra del diseño sale de sus filas: lo lleva si
  // tiene alguna (un objeto del arte en ese proceso o un archivo subido aparte) y "dónde va" se arma solo con ellas.
  const vivos = new Set((await pool.request().input('S', sql.Int, solicitudId)
    .query('SELECT ArchivoID FROM dbo.SolicitudesVendedorArchivos WHERE SolicitudID = @S AND Vigente = 1')).recordset.map(x => x.ArchivoID));
  disenos.forEach(d => {
    if (!d.extrasArchivos) return;
    d.extrasArchivos = d.extrasArchivos.filter(x => vivos.has(x.archivoId));
    d.extras = { ...(d.extras || {}), ...Object.fromEntries(['BORDADO', 'DTF', 'TPU'].map(T => [T, { activo: !!filasExtra(d, T).length, ubicacion: dondeVa(d, T) }])) };
  });
  // [A MEDIDA] la lista sale sola: una fila por diseño con su cantidad
  const colCant = columnaCantidad(est);
  const planilla = p.AMedida ? disenos.filter(d => d.cantidad > 0).map(d => ({ diseno: d.nombre, ...(colCant ? { [colCant.id]: String(d.cantidad) } : {}) })) : (Array.isArray(b.planilla) ? b.planilla : []).slice(0, 2000).map(f => {
    // La lista manda: la variante de cada fila queda como está; una fila sin variante, con un solo diseño, es de ese
    const fila = { diseno: txt(f.diseno, 40).toUpperCase() || (disenos.length === 1 ? disenos[0].nombre : '') };
    Object.keys(f || {}).forEach(k => { if (ids.has(k)) { const v = txt(f[k], 80); if (v) fila[k] = v; } });
    return fila;
  }).filter(f => Object.keys(f).some(k => k !== 'diseno'));
  // Telas propias de un diseño: solo telas que ofrece el producto (las mismas de "Piezas y telas"); las demás se descartan
  if (disenos.some(d => Object.keys(d.telasPropias).length)) {
    const info = await require('./solicitudesVendedorSublimacion').moldeDelProducto(pool, user, base, solicitudId, productoSolId);
    const ok = new Set((info.telas || []).map(t => String(t.proIdProducto)));
    disenos.forEach(d => { d.telasPropias = Object.fromEntries(Object.entries(d.telasPropias).filter(([, v]) => ok.has(v))); });
  }
  // La plantilla pedida (a medida) se conserva: ver() avisa si la medida de un diseño cambió después de pedirla
  const datos = { ...p.Datos, tizadaPro: { ...datosDe(p, { disenos, planilla }), ...(p.Datos.tizadaPro?.plantilla ? { plantilla: p.Datos.tizadaPro.plantilla } : {}), fecha: new Date().toISOString() } };
  await pool.request().input('P', sql.Int, productoSolId).input('D', sql.NVarChar(sql.MAX), JSON.stringify(datos))
    .query('UPDATE dbo.SolicitudesVendedorProductos SET DatosJson = @D WHERE ProductoSolID = @P');
  await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'EDICION', texto: p.AMedida
    ? `TIZADA PRO a medida: ${disenos.map(d => `${d.nombre} × ${d.cantidad || 0} (${aMedidaSvc.resumen(d.medida)})`).join(' · ')}.`
    : `TIZADA PRO: ${disenos.length} diseño(s) y ${planilla.length} prenda(s) en la lista de talles guardados.` });
  // Los editables que van en DTF / TPU / Bordado quedan como arte del cliente de ese servicio. Si falla, lo guardado queda igual.
  let avisoEditables = null;
  try { await adjuntarEditables(pool, user, base, solicitudId, productoSolId, disenos); }
  catch (e) { avisoEditables = `Se guardó, pero no se pudo adjuntar el arte de los editables a los servicios: ${e.message}`; logger.warn(`[TIZADAPRO] adjuntarEditables ${solicitudId}/${productoSolId}: ${e.message}`); }
  // [EXTRAS EN LA TABLA] Solicitud del vendedor: "dónde va" de cada servicio = lo de la tabla de todos los diseños (el portal lo
  // pone al confirmar). Solo si la tabla dice algo: si no, queda lo que se escribió en el servicio.
  if (!user?.portal && disenos.some(d => d.extrasArchivos)) {
    for (const T of ['BORDADO', 'DTF', 'TPU']) {
      const u = disenos.filter(d => d.extras?.[T]?.ubicacion).map(d => (disenos.length > 1 ? `${d.nombre}: ${d.extras[T].ubicacion}` : d.extras[T].ubicacion)).join(' · ').slice(0, 300);
      if (u) await pool.request().input('P', sql.Int, productoSolId).input('T', sql.VarChar(12), T).input('U', sql.NVarChar(300), u)
        .query("UPDATE dbo.SolicitudesVendedorPartes SET Ubicacion = @U WHERE ProductoSolID = @P AND Tipo = @T AND Activo = 1 AND ISNULL(Ubicacion, N'') <> @U");
    }
  }
  // Si el vendedor cambia diseños o lista con la producción principal ya en Diseño (o con la tizada hecha), queda
  // "Modificada": Diseño se entera, tiene que aceptar el cambio (y rehacer la tizada) y no se convierte con la vieja.
  if (!(await base.esDisenador(pool, user))) {
    const pa = (await pool.request().input('P', sql.Int, productoSolId).query(
      "SELECT TOP 1 ParteID, Estado FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Tipo = 'PRINCIPAL' AND Activo = 1")).recordset[0];
    if (pa && pa.Estado !== 'INGRESADO') {
      await base.marcarModificada(pool, user, pa.ParteID, `TIZADA PRO: el vendedor cambió los diseños o la lista de talles (${disenos.length} diseño(s), ${planilla.length} prenda(s))${pa.Estado === 'DISENADO' ? ' — hay que rehacer la tizada' : ''}.`);
    }
  }
  const r = await ver(pool, user, base, solicitudId, productoSolId);
  return avisoEditables ? { ...r, avisoEditables } : r;
}

// ─────────────────────────────────────────────────────────────────────
// Armar y mandar
// ─────────────────────────────────────────────────────────────────────
// Cómo arma TIZADA las mesas (FORMATO_PEDIDO.md › mesas): normal | una_por_fila (una mesa por fila; la cantidad pasa a
// ser COPIAS de esa mesa: vuelve UN PDF con archivos[].copias) | por_talles. Los productos a medida (banderas…) pueden
// ir con su propio modo (TIZADAPRO_MESAS_MODO_A_MEDIDA); las prendas con talles, con TIZADAPRO_MESAS_MODO.
const MODOS_MESAS = ['normal', 'una_por_fila', 'por_talles'];
// El producto lo puede fijar (configurador › Molde: "Archivos de impresión" = ProductoVentaConfig.TizadaMesasModo).
function modoMesas(datos, p) {
  const aMedida = (datos?.disenos || []).some(d => d.medida);
  const m = String(p?.MesasModo || (aMedida && process.env.TIZADAPRO_MESAS_MODO_A_MEDIDA) || process.env.TIZADAPRO_MESAS_MODO || 'normal').trim();
  return MODOS_MESAS.includes(m) ? m : 'normal';
}

function armarPedidoJson(sol, p, datos, est, referencia, rutasArte, editablesPorDiseno = {}) {
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
    mesas: { modo: modoMesas(datos, p) },
    disenos: datos.disenos.map(d => {
      const editablesRaw = { ...(d.editables || {}), ...(editablesPorDiseno[d.nombre] || {}) };
      const editables = {};
      const cruzPorDefecto = process.env.TIZADAPRO_EDITABLES_CRUZ === '1';
      for (const [k, v] of Object.entries(editablesRaw)) {
        if (!k || !v) continue;
        const claveObj = String(k).trim();
        let proc = '';
        let cruz = cruzPorDefecto;
        if (typeof v === 'string') {
          proc = v.trim().toLowerCase();
        } else if (typeof v === 'object' && v.proceso) {
          proc = String(v.proceso).trim().toLowerCase();
          if (v.cruz != null) cruz = !!v.cruz;
        }
        if (proc === 'sublimado') {
          editables[claveObj] = 'sublimado';
        } else if (proc) {
          editables[claveObj] = { proceso: proc, cruz };
        }
      }
      return {
        nombre: d.nombre,
        moldes: [{
          variable: d.variable,
          arte: rutasArte[d.arteArchivoId],
          tela: String(d.tela),
          ...(Object.keys(d.telasPorPieza || {}).length ? { telas_por_pieza: d.telasPorPieza } : {}),
          ...(Object.keys(editables).length ? { editables } : {}),
          ...(d.medida ? aMedidaSvc.paraPedido(d.medida) : {}),   // [A MEDIDA]
        }],
      };
    }),
    planilla: datos.planilla.map(f => {
      const fila = {};
      // La variante de la fila (una fila sin variante, con un solo diseño, es de ese). Si no tiene arte, revisar() frena antes.
      fila.diseno = f.diseno || (datos.disenos.length === 1 ? datos.disenos[0].nombre : f.diseno);
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

// ─────────────────────────────────────────────────────────────────────
// EDITABLES del arte (services/tizadaProEditables.js). Al mandar la tizada:
//   1. prepararEditables: se extraen las capas "Editable …" de cada arte, se decide el proceso de cada objeto y se
//      ponen en el pedido (`editables`). DTF → se arma el pliego (objeto × prendas del diseño); TPU / Bordado → el
//      arte del objeto. Nada se sube todavía.
//   2. editablesEnEspera (solo si TIZADA recibió el pedido): se suben a Drive y quedan en DatosJson.editablesTizada
//      de cada servicio, atados a la referencia, esperando la tizada.
//   3. cargarEditables (en aplicarResultado, cuando vuelve la tizada): DTF → diseño pronto del Estampado DTF, que pasa
//      a Diseñado; TPU / Bordado → archivo de REFERENCIA del servicio (como si lo hubieran subido a mano; no cambia
//      de estado). Si TIZADA rechaza, lo que quedó en espera no se carga nunca (lo pisa el envío siguiente).
// Se apaga con TIZADAPRO_EDITABLES=0.
// ─────────────────────────────────────────────────────────────────────
async function prepararEditables(pool, productoSolId, datos, artes, rutasArte, est) {
  const alarmas = []; const aviso = (codigo, mensaje) => alarmas.push({ codigo, frena: false, etapa: 'editables (USER)', mensaje });
  const partes = (await pool.request().input('P', sql.Int, productoSolId).query(
    "SELECT ParteID, Tipo, DatosJson FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Activo = 1 AND Tipo IN ('DTF', 'TPU', 'BORDADO')")).recordset;
  const ed = require('./tizadaProEditables');
  let porArte;
  try { porArte = await ed.extraer(artes.map(a => ({ clave: a.ruta, buffer: a.buffer }))); }
  catch (e) { aviso('editables-no-leidos', `No se pudieron leer los editables del arte (${e.message}): se manda sin editables y no se arma el pliego de DTF.`); return { alarmas, preparado: null }; }
  const colCant = (est?.columnas || []).find(c => c.rol === 'cantidad');
  const prendasDe = (nombre) => (datos.planilla || []).filter(f => datos.disenos.length === 1 || sinTilde(f.diseno) === sinTilde(nombre))
    .reduce((t, f) => t + (colCant && Number(f[colCant.id]) > 0 ? Number(f[colCant.id]) : 1), 0);
  const objetos = [];
  const editablesPorDiseno = {};
  for (const d of datos.disenos) {
    const lista = porArte[rutasArte[d.arteArchivoId]] || [];
    const cantidad = prendasDe(d.nombre);
    const editables = {};
    for (const o of lista) {
      const elegido = (d.editables || {})[o.objeto];
      const proceso = ['sublimado', 'dtf', 'tpu', 'bordado'].includes(elegido) ? elegido : ed.procesoDe(o.objeto, partes.map(x => x.Tipo));
      editables[o.objeto] = proceso;
      objetos.push({ ...o, diseno: d.nombre, proceso, cantidad });
      aviso('editable', `${d.nombre} · "${o.objeto}" → ${proceso.toUpperCase()} · ${o.pieza} · ${o.anchoCm} × ${o.altoCm} cm · ${o.posicion} · ${cantidad} prenda(s)`);
    }
    editablesPorDiseno[d.nombre] = editables;
  }
  const preparado = {};
  const deTipo = (t) => partes.find(x => x.Tipo === t);
  const dtf = objetos.filter(o => o.proceso === 'dtf');
  if (dtf.length) {
    if (!deTipo('DTF')) aviso('editable-sin-servicio', `${dtf.map(o => `"${o.objeto}"`).join(', ')} va en DTF pero el producto no tiene Estampado DTF: no se arma el pliego.`);
    else {
      const pliego = await ed.armarPliego(dtf);
      if (pliego) { preparado.DTF = { parte: deTipo('DTF'), pliego, objetos: dtf }; aviso('pliego-dtf', `Pliego de DTF: ${dtf.map(o => `${o.cantidad} × ${o.diseno} "${o.objeto}"`).join(' + ')} → ${pliego.anchoCm} × ${pliego.largoCm} cm (${pliego.transfers} transfers). Se carga en el Estampado DTF cuando vuelva la tizada.`); }
    }
  }
  for (const t of ['TPU', 'BORDADO']) {
    const objs = objetos.filter(o => o.proceso === t.toLowerCase());
    if (!objs.length) continue;
    if (!deTipo(t)) { aviso('editable-sin-servicio', `${objs.map(o => `"${o.objeto}"`).join(', ')} va en ${t} pero el producto no tiene ese servicio: no se carga en ningún lado.`); continue; }
    // TPU / Bordado: el arte ya quedó en la solicitud como "Arte del cliente" del servicio al guardar (adjuntarEditables)
    aviso(`arte-${t.toLowerCase()}`, `${t}: ${objs.map(o => `${o.diseno} "${o.objeto}" (${o.anchoCm} × ${o.altoCm} cm)`).join(', ')} → ya está en la solicitud como arte del cliente del servicio.`);
  }
  return { alarmas, preparado: Object.keys(preparado).length ? preparado : null, editablesPorDiseno };
}

async function editablesEnEspera(pool, referencia, preparado) {
  if (!preparado) return;
  const drive = require('./driveService');
  for (const [tipo, x] of Object.entries(preparado)) {
    const archivos = [];
    if (tipo === 'DTF') {
      const n = `${referencia}_DTF_pliego_${x.pliego.transfers}transfers_${(x.pliego.largoCm / 100).toFixed(2)}m.pdf`;
      archivos.push({ rol: 'DISENO_PRONTO', nombre: n, url: await drive.uploadToDrive(x.pliego.buffer, n, AREA_DRIVE), bytes: x.pliego.buffer.length,
        anchoM: x.pliego.anchoCm / 100, altoM: x.pliego.largoCm / 100, material: leer(x.parte.DatosJson, {}).material || null, copias: 1 });
    } else {
      for (const o of x.objetos) {
        const n = `${referencia}_${tipo}_${slug(o.diseno)}_${slug(o.objeto)}_${o.anchoCm}x${o.altoCm}cm.png`;
        archivos.push({ rol: 'REFERENCIA', nombre: n, url: await drive.uploadToDrive(o.png, n, AREA_DRIVE), bytes: o.png.length, anchoM: o.anchoCm / 100, altoM: o.altoCm / 100,
          nota: `${o.diseno} · ${o.objeto} · ${o.pieza} · ${o.posicion} · ${o.cantidad} prenda(s)` });
      }
    }
    const datosPa = leer((await pool.request().input('Pa', sql.Int, x.parte.ParteID).query('SELECT DatosJson FROM dbo.SolicitudesVendedorPartes WHERE ParteID = @Pa')).recordset[0]?.DatosJson, {});
    datosPa.editablesTizada = { referencia, fecha: new Date().toISOString(), archivos };
    await pool.request().input('Pa', sql.Int, x.parte.ParteID).input('D', sql.NVarChar(sql.MAX), JSON.stringify(datosPa))
      .query('UPDATE dbo.SolicitudesVendedorPartes SET DatosJson = @D WHERE ParteID = @Pa');
  }
}

// Dentro de la transacción de aplicarResultado: lo que quedó esperando esta tizada pasa a los servicios
async function cargarEditables(tx, env, user, base) {
  const creados = [];
  const partes = (await new sql.Request(tx).input('P', sql.Int, env.ProductoSolID).query(
    "SELECT * FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Activo = 1 AND Tipo IN ('DTF', 'TPU', 'BORDADO')")).recordset;
  for (const pa of partes) {
    const datosPa = leer(pa.DatosJson, {});
    const esp = datosPa.editablesTizada;
    if (!esp || esp.referencia !== env.Referencia) continue;
    if (pa.Tipo === 'DTF') {
      await new sql.Request(tx).input('Pa', sql.Int, pa.ParteID)
        .query("UPDATE dbo.SolicitudesVendedorArchivos SET Vigente = 0 WHERE ParteID = @Pa AND Rol = 'DISENO_PRONTO' AND Vigente = 1");
    }
    for (const a of esp.archivos || []) {
      const r = await new sql.Request(tx)
        .input('S', sql.Int, env.SolicitudID).input('P', sql.Int, env.ProductoSolID).input('Pa', sql.Int, pa.ParteID).input('R', sql.VarChar(30), a.rol)
        .input('N', sql.NVarChar(260), a.nombre).input('U', sql.NVarChar(sql.MAX), a.url).input('B', sql.BigInt, a.bytes || null)
        .input('An', sql.Decimal(10, 4), a.anchoM || null).input('Al', sql.Decimal(10, 4), a.altoM || null).input('M', sql.NVarChar(200), a.material || null)
        .input('C', sql.Int, a.rol === 'DISENO_PRONTO' ? (a.copias || 1) : null).input('Us', sql.Int, user.id)
        .query(`INSERT INTO dbo.SolicitudesVendedorArchivos (SolicitudID, ProductoSolID, ParteID, Rol, NombreOriginal, UrlDrive, TamanoBytes, AnchoM, AltoM, Vigente, UsuarioSube, Material, Copias)
                OUTPUT INSERTED.ArchivoID VALUES (@S, @P, @Pa, @R, @N, @U, @B, @An, @Al, 1, @Us, @M, @C)`);
      creados.push({ ArchivoID: r.recordset[0].ArchivoID, nombre: a.nombre, tipo: pa.Tipo === 'DTF' ? 'pliego DTF' : `referencia ${pa.Tipo}`, url: a.url });
    }
    delete datosPa.editablesTizada;
    if (pa.Tipo === 'DTF') datosPa.disenoAutomatico = { sistema: 'TIZADA PRO', referencia: env.Referencia, detalle: 'pliego armado con los editables del arte', fecha: new Date().toISOString() };
    await new sql.Request(tx).input('Pa', sql.Int, pa.ParteID).input('D', sql.NVarChar(sql.MAX), JSON.stringify(datosPa))
      .query('UPDATE dbo.SolicitudesVendedorPartes SET DatosJson = @D WHERE ParteID = @Pa');
    const lista = (esp.archivos || []).map(a => a.nombre).join(', ');
    if (pa.Tipo === 'DTF' && pa.Estado !== 'DISENADO') {
      await base.cambiarEstadoParte(tx, user, pa, 'DISENADO', 'FechaDisenado = GETDATE(), UsuarioDisenado = @U', `diseño automático: pliego de DTF armado con los editables del arte (${env.Referencia}): ${lista}`);
    } else {
      await base.registrarEvento(tx, user, { solicitudId: env.SolicitudID, productoSolId: env.ProductoSolID, parteId: pa.ParteID, tipo: 'ARCHIVO',
        texto: pa.Tipo === 'DTF' ? `Pliego de DTF (editables del arte, ${env.Referencia}) reemplazó al diseño pronto: ${lista}` : `Arte de los editables (${env.Referencia}) cargado como referencia: ${lista}` });
    }
  }
  return creados;
}

// Al guardar: cada editable que va en DTF, TPU o Bordado queda en la solicitud como "Arte del cliente" de ese
// servicio (un PNG por objeto, como si lo hubieran subido a mano). Nombre: EDITABLE_<diseño>_<objeto>_<SERVICIO>_A<arte>.png
// Si se cambia el proceso o el arte, el viejo deja de estar vigente y se sube el nuevo. No se le manda nada a TIZADA.
async function adjuntarEditables(pool, user, base, solicitudId, productoSolId, disenos) {
  if (process.env.TIZADAPRO_EDITABLES === '0') return [];
  const partes = (await pool.request().input('P', sql.Int, productoSolId).query(
    "SELECT ParteID, Tipo FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Activo = 1 AND Tipo IN ('DTF', 'TPU', 'BORDADO')")).recordset;
  // con la pieza: el mismo objeto puede estar en dos piezas (logo en el frente y en la espalda)
  const nombreDe = (d, o, tipo) => `EDITABLE_${slug(d.nombre)}_${slug(o.objeto)}${o.pieza ? `_${slug(o.pieza)}` : ''}_${tipo}_A${d.arteArchivoId}.png`;
  const quiero = [];   // { d, o, parte, nombre }
  for (const d of disenos) {
    if (!d.arteArchivoId) continue;
    for (const o of d.editablesDetalle || []) {
      const proc = d.editables[o.objeto] || o.sugerido || 'sublimado';
      const parte = partes.find(x => x.Tipo === String(proc).toUpperCase());
      if (parte) quiero.push({ d, o, parte, nombre: nombreDe(d, o, parte.Tipo) });
    }
  }
  const hay = (await pool.request().input('P', sql.Int, productoSolId).query(
    "SELECT ArchivoID, ParteID, NombreOriginal FROM dbo.SolicitudesVendedorArchivos WHERE ProductoSolID = @P AND Rol = 'ARTE_CLIENTE' AND Vigente = 1 AND NombreOriginal LIKE 'EDITABLE[_]%'")).recordset;
  const sobran = hay.filter(h => !quiero.some(q => q.nombre === h.NombreOriginal && q.parte.ParteID === h.ParteID));
  const faltan = quiero.filter(q => !hay.some(h => h.NombreOriginal === q.nombre && h.ParteID === q.parte.ParteID));
  const hechos = [];
  for (const h of sobran) {
    await pool.request().input('A', sql.Int, h.ArchivoID).query('UPDATE dbo.SolicitudesVendedorArchivos SET Vigente = 0 WHERE ArchivoID = @A');
    hechos.push(`saqué ${h.NombreOriginal}`);
  }
  if (faltan.length) {
    // Se lee cada arte una sola vez (a resolución completa, no la miniatura)
    const artesIds = [...new Set(faltan.map(q => q.d.arteArchivoId))];
    const artes = (await pool.request().input('S', sql.Int, solicitudId).query(
      `SELECT ArchivoID, NombreOriginal, UrlDrive FROM dbo.SolicitudesVendedorArchivos WHERE SolicitudID = @S AND Vigente = 1 AND ArchivoID IN (${artesIds.map(Number).join(',')})`)).recordset;
    const ed = require('./tizadaProEditables');
    const porArte = await ed.extraer(await Promise.all(artes.map(async a => ({ clave: String(a.ArchivoID), buffer: await bajarDeDrive(a.UrlDrive) }))));
    const drive = require('./driveService');
    for (const q of faltan) {
      const o = (porArte[String(q.d.arteArchivoId)] || []).find(x => x.objeto === q.o.objeto && (x.pieza || '') === (q.o.pieza || ''));
      if (!o) { hechos.push(`"${q.o.objeto}" (${q.d.nombre}) ya no está en el arte: no se adjuntó`); continue; }
      const url = await drive.uploadToDrive(o.png, q.nombre, AREA_DRIVE);
      await pool.request().input('S', sql.Int, solicitudId).input('P', sql.Int, productoSolId).input('Pa', sql.Int, q.parte.ParteID)
        .input('N', sql.NVarChar(260), q.nombre).input('U', sql.NVarChar(sql.MAX), url).input('B', sql.BigInt, o.png.length)
        .input('An', sql.Decimal(10, 4), o.anchoCm / 100).input('Al', sql.Decimal(10, 4), o.altoCm / 100).input('Us', sql.Int, user.id)
        .query(`INSERT INTO dbo.SolicitudesVendedorArchivos (SolicitudID, ProductoSolID, ParteID, Rol, NombreOriginal, UrlDrive, TamanoBytes, AnchoM, AltoM, Vigente, UsuarioSube)
                VALUES (@S, @P, @Pa, 'ARTE_CLIENTE', @N, @U, @B, @An, @Al, 1, @Us)`);
      hechos.push(`${q.parte.Tipo}: ${q.d.nombre} "${o.objeto}" (${o.anchoCm} × ${o.altoCm} cm, ${o.pieza})`);
    }
  }
  if (hechos.length) {
    await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'ARCHIVO', texto: `Editables del arte como arte del cliente de cada servicio: ${hechos.join(' · ')}` });
  }
  return hechos;
}

// Miniatura de un editable (la achica el navegador a ~100 px): solo PNG/JPEG en base64 y chica, para no inflar DatosJson.
const esMiniatura = (v) => typeof v === 'string' && v.length <= 40000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v);

/** "Leer los editables del arte": objetos de las capas "Editable …" de un arte de la solicitud, con el proceso sugerido. */
async function leerEditables(pool, user, base, solicitudId, productoSolId, arteArchivoId) {
  if (!base.esVendedor(user) && !(await base.esDisenador(pool, user))) throw fallo(403, 'Esto lo hace el vendedor o un diseñador habilitado.');
  const a = (await pool.request().input('A', sql.Int, Number(arteArchivoId) || 0).input('S', sql.Int, solicitudId)
    .query('SELECT ArchivoID, NombreOriginal, UrlDrive FROM dbo.SolicitudesVendedorArchivos WHERE ArchivoID = @A AND SolicitudID = @S AND Vigente = 1')).recordset[0];
  if (!a) throw fallo(404, 'Ese arte no está en la solicitud.');
  let buffer;
  try { buffer = await bajarDeDrive(a.UrlDrive); } catch (e) { throw fallo(502, `No se pudo leer el arte "${a.NombreOriginal}" de Drive: ${e.message}`); }
  // Un .ai de Illustrator actual es un PDF por dentro ("Crear archivo compatible con PDF"). Uno viejo (PostScript/EPS)
  // o guardado sin esa opción no se puede leer acá ni en TIZADA: se dice claro qué hacer.
  const pdfEn = buffer.indexOf('%PDF');
  if (pdfEn < 0 || pdfEn > 1024) {
    const cab = buffer.slice(0, 40).toString('latin1');
    throw fallo(422, `"${a.NombreOriginal}" no se puede leer: ${/^%!PS/.test(cab) ? 'es un .ai en formato viejo (PostScript/EPS)' : 'no es un PDF ni un .ai compatible con PDF'}. Abrilo en Illustrator y guardalo de nuevo como .ai con "Crear archivo compatible con PDF" tildado (o exportalo como PDF), y subilo otra vez. TIZADA tampoco lo podría usar así.`);
  }
  const tipos = (await pool.request().input('P', sql.Int, productoSolId).query(
    "SELECT Tipo FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Activo = 1 AND Tipo IN ('DTF', 'TPU', 'BORDADO')")).recordset.map(x => x.Tipo);
  const ed = require('./tizadaProEditables');
  let lista;
  try { lista = (await ed.extraer([{ clave: 'a', buffer }])).a || []; }
  catch (e) { throw fallo(422, `No se pudieron leer las capas del arte "${a.NombreOriginal}": ${e.message}`); }
  return {
    arte: a.NombreOriginal, servicios: tipos,
    objetos: lista.map(o => ({ objeto: o.objeto, pieza: o.pieza, anchoCm: o.anchoCm, altoCm: o.altoCm, posicion: o.posicion,
      sugerido: ed.procesoDe(o.objeto, tipos), vista: 'data:image/png;base64,' + o.png.toString('base64') })),
  };
}

// Vista de cada pieza de un arte (una mesa por pieza, el nombre en "guias"): para mostrar el arte del cliente y la
// silueta de cada pieza con su diseño. Tarda unos segundos (Chrome), así que queda guardada en disco por archivo.
async function piezasDelArte(pool, user, base, solicitudId, archivoId) {
  if (!base.esVendedor(user) && !(await base.esDisenador(pool, user))) throw fallo(403, 'Esto lo ve el vendedor o un diseñador habilitado.');
  const a = (await pool.request().input('A', sql.Int, Number(archivoId) || 0).input('S', sql.Int, solicitudId)
    .query('SELECT ArchivoID, NombreOriginal, UrlDrive FROM dbo.SolicitudesVendedorArchivos WHERE ArchivoID = @A AND SolicitudID = @S AND Vigente = 1')).recordset[0];
  if (!a) throw fallo(404, 'Ese arte no está en la solicitud.');
  if (!/\.(ai|pdf)$/i.test(a.NombreOriginal || '')) return { piezas: [] };
  const fs = require('fs');
  const dir = require('path').join(require('../utils/rutasUploads').rutaUploads('cache'), 'vistas-arte');
  const archivo = require('path').join(dir, `${a.ArchivoID}.json`);
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch (_) { /* no está todavía */ }
  let buffer;
  try { buffer = await bajarDeDrive(a.UrlDrive); } catch (e) { throw fallo(502, `No se pudo leer el arte "${a.NombreOriginal}" de Drive: ${e.message}`); }
  const pdfEn = buffer.indexOf('%PDF');
  if (pdfEn < 0 || pdfEn > 1024) return { piezas: [] };   // .ai viejo: leerEditables ya dice qué hacer
  let piezas;
  try { piezas = await require('./tizadaProEditables').vistasPiezas(buffer); }
  catch (e) { throw fallo(422, `No se pudo dibujar el arte "${a.NombreOriginal}": ${e.message}`); }
  const r = { piezas };
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(archivo, JSON.stringify(r)); } catch (e) { logger.warn(`[TIZADAPRO] vista del arte ${a.ArchivoID}: no se guardó en disco (${e.message})`); }
  return r;
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

  const est = await estructura(pool, p.MoldeRef, p.AMedida);
  if (!est?.columnas?.length) throw fallo(503, 'No se pudo leer la planilla del molde (columnas): no se manda nada a TIZADA.');
  const datos = datosDe(p, p.Datos.tizadaPro);
  const errores = revisar(est, datos, sol.Archivos, p.AMedida);
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
  // Editables: se analizan para armar el pedido.json de TIZADA y preparar DTF / TPU / Bordado
  const edits = (process.env.TIZADAPRO_EDITABLES !== '0') ? await prepararEditables(pool, productoSolId, datos, artes, rutasArte, est) : { alarmas: [], preparado: null, editablesPorDiseno: {} };
  const pedido = armarPedidoJson(sol, p, datos, est, referencia, rutasArte, edits?.editablesPorDiseno);
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

  let envioId = null;
  try {
    {   // siempre: primero TIZADA revisa los datos; recién si los acepta se manda
      const v = await api.validar(null, zip);
      if (soloRevisar) {
        const id = await guardarEnvio(pool, { ...reg, Estado: 'REVISADO', Etapa: 'TIZADA lo aceptaría', Alarmas: v?.alarmas || [] });
        return { EnvioID: id, Referencia: referencia, Estado: 'REVISADO', Alarmas: v?.alarmas || [] };
      }
    }
    // Guardamos el envío ANTES de llamar a TIZADA y de subir a Drive para que si TIZADA
    // rechaza o avisa en milisegundos, el webhook encuentre la referencia en la base.
    envioId = await guardarEnvio(pool, { ...reg, Estado: 'EN_COLA', Etapa: 'esperando al robot de TIZADA', Alarmas: edits.alarmas });

    const r = await api.enviar(zip);
    // TIZADA lo recibió: lo de los editables queda esperando la tizada (si falla, el pedido sigue: queda en el aviso)
    try { await editablesEnEspera(pool, referencia, edits.preparado); }
    catch (e) { edits.alarmas.push({ codigo: 'editables-sin-guardar', frena: false, etapa: 'editables (USER)', mensaje: `No se pudo dejar preparado el pliego / las referencias: ${e.message}` }); logger.warn(`[TIZADAPRO] ${referencia} editables: ${e.message}`); }

    // Actualizamos etapa y alarmas solo si el webhook de TIZADA no cambió ya el estado (ej. a RECHAZADO o PROCESANDO)
    await pool.request()
      .input('E', sql.Int, envioId)
      .input('Et', sql.NVarChar(300), txt(r?.etapa, 300) || 'esperando al robot de TIZADA')
      .input('Al', sql.NVarChar(sql.MAX), json([...(r?.alarmas || []), ...edits.alarmas]))
      .query(`UPDATE dbo.TizadaProEnvios
              SET Etapa = ISNULL(@Et, Etapa),
                  AlarmasJson = CASE WHEN Estado = 'EN_COLA' THEN @Al ELSE AlarmasJson END,
                  FechaActualizado = GETDATE()
              WHERE EnvioID = @E AND Estado = 'EN_COLA'`);

    await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'EDICION', texto: `Pedido mandado a TIZADA PRO para generar la tizada (referencia ${referencia}).` });
    return { EnvioID: envioId, Referencia: referencia, Estado: 'EN_COLA' };
  } catch (e) {
    if (e instanceof api.ErrorTizada && (e.status === 422 || e.status === 415)) {
      if (envioId) {
        await pool.request().input('E', sql.Int, envioId).input('Al', sql.NVarChar(sql.MAX), json(e.alarmas || []))
          .input('Err', sql.NVarChar(1000), txt(e.message, 1000) || null)
          .query(`UPDATE dbo.TizadaProEnvios
                  SET Estado = 'RECHAZADO', Etapa = 'TIZADA no lo acepta', AlarmasJson = @Al, ErrorTexto = @Err, FechaFin = GETDATE(), FechaActualizado = GETDATE()
                  WHERE EnvioID = @E`);
      } else {
        envioId = await guardarEnvio(pool, { ...reg, Estado: 'RECHAZADO', Etapa: 'TIZADA no lo acepta', Alarmas: e.alarmas, ErrorTexto: e.message });
      }
      return { EnvioID: envioId, Referencia: referencia, Estado: 'RECHAZADO', Alarmas: e.alarmas, mensaje: e.message };
    }
    if (envioId) {
      await pool.request().input('E', sql.Int, envioId).input('Err', sql.NVarChar(1000), txt(e.message, 1000) || null)
        .query(`UPDATE dbo.TizadaProEnvios
                SET Estado = 'ERROR', Etapa = 'Error al mandar a TIZADA', ErrorTexto = @Err, FechaFin = GETDATE(), FechaActualizado = GETDATE()
                WHERE EnvioID = @E AND Estado = 'EN_COLA'`);
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
  let env = await envioPorReferencia(pool, ref);
  if (!env) {
    // Si el aviso llegó casi simultáneo al envío, esperamos 1.5 s y reintentamos buscar la referencia
    await new Promise(r => setTimeout(r, 1500));
    env = await envioPorReferencia(pool, ref);
  }
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
      const metros = (Number(a.consumo_cm) || 0) / 100;   // el largo de UNA mesa (el pedido multiplica por las copias)
      const copias = parseInt(a.copias, 10) >= 1 ? parseInt(a.copias, 10) : 1;
      // Nombre: <referencia>_<tela sin el ancho>[_fila<N>]_<metros>m[_x<copias>].pdf  (ej. SOL-12-P34-1_Dry_Fit_3.21m.pdf,
      // LOCAL-20-P20-1_Bandera_fila1_1.04m_x12.pdf). La fila distingue los PDF de una mesa por fila.
      const nombre = `${env.Referencia}_${slug(String(tela.material || a.tela || '').replace(/\(\d+[.,]\d+\)\s*$/, ''))}${a.fila != null ? `_fila${slug(String(a.fila))}` : ''}_${metros.toFixed(2)}m${copias > 1 ? `_x${copias}` : ''}.pdf`;
      const t = await traerPdf(a, nombre);
      listos.push({ nombre, url: t.url, bytes: t.bytes || a.bytes || null, como: t.como, tela, metros, copias, mesas: a.mesas || null, aprovechamiento: a.aprovechamiento ?? null, original: a.nombre });
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
          .input('M', sql.NVarChar(200), x.tela.material).input('C', sql.VarChar(50), x.tela.codArticulo).input('Us', sql.Int, user.id).input('Cop', sql.Int, x.copias)
          .query(`INSERT INTO dbo.SolicitudesVendedorArchivos (SolicitudID, ProductoSolID, ParteID, Rol, NombreOriginal, UrlDrive, TamanoBytes, AnchoM, AltoM, Vigente, UsuarioSube, Material, CodArticulo, Copias)
                  OUTPUT INSERTED.ArchivoID VALUES (@S, @P, @Pa, 'DISENO_PRONTO', @N, @U, @B, @An, @Al, 1, @Us, @M, @C, @Cop)`);
        creados.push({ ArchivoID: r.recordset[0].ArchivoID, nombre: x.nombre, tipo: 'tizada', url: x.url, tela: x.tela.material, metros: x.metros, copias: x.copias, como: x.como });
      }
      if (fichaLista) {
        const r = await new sql.Request(transaction)
          .input('S', sql.Int, env.SolicitudID).input('P', sql.Int, env.ProductoSolID)
          .input('N', sql.NVarChar(260), fichaLista.nombre).input('U', sql.NVarChar(sql.MAX), fichaLista.url).input('B', sql.BigInt, fichaLista.bytes).input('Us', sql.Int, user.id)
          .query(`INSERT INTO dbo.SolicitudesVendedorArchivos (SolicitudID, ProductoSolID, Rol, NombreOriginal, UrlDrive, TamanoBytes, Vigente, UsuarioSube)
                  OUTPUT INSERTED.ArchivoID VALUES (@S, @P, 'REFERENCIA', @N, @U, @B, 1, @Us)`);
        creados.push({ ArchivoID: r.recordset[0].ArchivoID, nombre: fichaLista.nombre, tipo: 'ficha', url: fichaLista.url });
      }
      // Editables que esperaban esta tizada: pliego DTF / referencias TPU y Bordado
      creados.push(...await cargarEditables(transaction, env, user, base));
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
      api.registrar({ sentido: 'ENTRA', metodo: 'POST', ruta: '/aviso', status: 401, ms: 0, enviado: null, respuesta: null, referencia: req.headers['x-tizada-referencia'] || null, error: 'Aviso con firma inválida: ignorado' });
      logger.warn(`[TIZADAPRO] aviso con firma inválida (referencia ${req.headers['x-tizada-referencia'] || '?'}) — ignorado`);
      return res.status(401).json({ ok: false, error: 'firma inválida' });
    }
    const data = JSON.parse(crudo.toString('utf8'));
    res.json({ ok: true });
    const pool = await getPool();
    if (!(await tieneTabla(pool))) return;
    const r = await procesarEstado(pool, data);
    api.registrar({ sentido: 'ENTRA', metodo: 'POST', ruta: '/aviso', status: 200, ms: 0, enviado: crudo.length > 20000 ? `${crudo.toString('utf8').slice(0, 20000)}…` : crudo.toString('utf8'), respuesta: null, referencia: data.referencia || null, error: r.ok === false ? r.motivo : null });
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

// forzar = lo pidió el vendedor al enviar a Diseño (tilde "Generar la tizada en TIZADA PRO"): sale aunque el .env esté
// en MANUAL, y devuelve cómo salió (o por qué no) para mostrarlo. Sin forzar: solo con TIZADAPRO_ENVIO_MODO=AL_ENVIAR_A_DISENO.
async function envioAutomatico(pool, user, base, solicitudId, productoSolId, forzar = false) {
  try {
    const conf = api.estadoConfig();
    if (!forzar && (MODO_ENVIO() !== 'AL_ENVIAR_A_DISENO' || !conf.ok)) return null;
    if (!conf.ok) return { Estado: 'ERROR', mensaje: conf.motivo };
    const p = await productoConMolde(pool, solicitudId, productoSolId);
    if (!p.MoldeRef) return forzar ? { Estado: 'ERROR', mensaje: 'El producto no tiene molde de TIZADA PRO.' } : null;
    if (!p.Datos.tizadaPro?.disenos?.length) return forzar ? { Estado: 'ERROR', mensaje: 'Falta el arte y la lista de jugadores.' } : null;
    const r = await enviar(pool, user, base, solicitudId, productoSolId, {}, true);
    logger.info(`[TIZADAPRO] envío ${forzar ? 'a pedido' : 'automático'} SOL-${solicitudId}/P${productoSolId}: ${r.Estado} (${r.Referencia})`);
    return r;
  } catch (e) {
    logger.warn(`[TIZADAPRO] envío ${forzar ? 'a pedido' : 'automático'} SOL-${solicitudId}/P${productoSolId} no salió: ${e.message}`);
    return forzar ? { Estado: 'ERROR', mensaje: e.message } : null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// [A MEDIDA] Las cuentas de TIZADA para la medida de un diseño, en vivo mientras se escribe (no guarda nada):
// total con el margen, si entra en cada tela, las tiras por lado y la ficha. body: { medida, tela }
// ─────────────────────────────────────────────────────────────────────
async function calcularMedida(pool, user, base, solicitudId, productoSolId, b = {}) {
  await exigirVendedorODisenador(pool, user, base);
  const p = await productoConMolde(pool, solicitudId, productoSolId);
  if (!p.AMedida) throw fallo(409, 'Este producto no es a medida.');
  const { medida, errores } = aMedidaSvc.normalizarMedida(medidaDelCliente(user, b.medida), p.AMedida, null);
  if (errores.length) return { ok: false, errores, medida };
  const conf = api.estadoConfig();
  if (!conf.ok) return { ok: false, errores: [], medida, sinTizada: conf.motivo };
  const r = await aMedidaSvc.calcular(p.AMedida.variable, medida, b.tela ? String(b.tela) : null);
  // Las telas que no ofrece el producto no se muestran
  if (r.ok && Array.isArray(r.telas) && p.AMedida.telas?.length) r.telas = r.telas.filter(t => p.AMedida.telas.includes(String(t.id)));
  return { ...r, medida, resumen: aMedidaSvc.resumen(medida) };
}

// [A MEDIDA] La plantilla para el diseñador (Illustrator, CorelDRAW y la guía .ai) con la medida de cada diseño:
// un archivo por diseño. El arte se arma sobre ella; un arte de otra medida TIZADA lo frena (arte-otra-medida).
async function pedirPlantilla(pool, user, base, solicitudId, productoSolId) {
  await exigirVendedorODisenador(pool, user, base);
  const p = await productoConMolde(pool, solicitudId, productoSolId);
  if (!p.AMedida) throw fallo(409, 'Este producto no es a medida.');
  const conf = api.estadoConfig();
  if (!conf.ok) throw fallo(503, conf.motivo);
  const datos = datosDe(p, p.Datos.tizadaPro);
  const malos = [];
  datos.disenos.forEach(d => { const e = aMedidaSvc.normalizarMedida(d.medida, p.AMedida, null).errores; if (e.length) malos.push(`${d.nombre}: ${e.join(' ')}`); });
  if (!datos.disenos.length) throw fallo(400, 'Primero cargá al menos un diseño con su medida y guardá.');
  if (malos.length) throw fallo(400, `Antes de pedir la plantilla, completá la medida:\n• ${malos.join('\n• ')}`);
  const n = ((p.Datos.tizadaPro?.plantilla?.n) || 0) + 1;
  const referencia = `${PREFIJO()}-${solicitudId}-P${productoSolId}-PL${n}`;
  const cuerpo = {
    referencia,
    disenos: datos.disenos.map(d => ({ nombre: d.nombre, variables: [aMedidaSvc.paraPlantilla(p.AMedida.variable, d.medida)] })),
    talles: { modo: 'todos' }, escala: 100,
  };
  let r;
  try { r = await api.plantillaPedir(cuerpo); }
  catch (e) {
    const al = (e.alarmas || []).map(a => a.mensaje || a.codigo);
    throw fallo(e.status === 422 ? 400 : (e.status || 502), al.length ? `TIZADA PRO no armó la plantilla:\n• ${al.join('\n• ')}` : `TIZADA PRO no armó la plantilla: ${e.message}`);
  }
  const plantilla = { referencia, n, fecha: new Date().toISOString(), estado: r?.estado || 'en_cola', medidas: Object.fromEntries(datos.disenos.map(d => [d.nombre, aMedidaSvc.resumen(d.medida)])) };
  const nuevos = { ...p.Datos, tizadaPro: { ...(p.Datos.tizadaPro || {}), plantilla } };
  await pool.request().input('P', sql.Int, productoSolId).input('D', sql.NVarChar(sql.MAX), JSON.stringify(nuevos))
    .query('UPDATE dbo.SolicitudesVendedorProductos SET DatosJson = @D WHERE ProductoSolID = @P');
  await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'EDICION', texto: `TIZADA PRO: plantilla ${referencia} pedida (${Object.entries(plantilla.medidas).map(([k, v]) => `${k}: ${v}`).join(' · ')}).` });
  return plantilla;
}

// [A MEDIDA] Estado y archivos de la plantilla pedida (las descargas pasan por nuestro servidor: la llave no sale)
async function estadoPlantilla(pool, user, base, solicitudId, productoSolId) {
  await exigirVendedorODisenador(pool, user, base);
  const p = await productoConMolde(pool, solicitudId, productoSolId);
  const pl = p.Datos.tizadaPro?.plantilla;
  if (!pl) throw fallo(404, 'Todavía no se pidió la plantilla.');
  const r = await api.plantillaEstado(pl.referencia);
  return {
    referencia: pl.referencia, estado: r?.estado || null, etapa: r?.etapa || null, alarmas: r?.alarmas || [], medidas: pl.medidas,
    archivos: (r?.archivos || []).map(a => ({ diseno: a.diseno, tipo: a.tipo, nombre: a.nombre, bytes: a.bytes, parte: a.parte || null })),
  };
}
async function bajarPlantilla(pool, user, base, solicitudId, productoSolId, nombre) {
  await exigirVendedorODisenador(pool, user, base);
  const p = await productoConMolde(pool, solicitudId, productoSolId);
  const pl = p.Datos.tizadaPro?.plantilla;
  if (!pl) throw fallo(404, 'Todavía no se pidió la plantilla.');
  const r = await api.plantillaEstado(pl.referencia);
  const a = (r?.archivos || []).find(x => x.nombre === String(nombre || ''));
  if (!a) throw fallo(404, 'Ese archivo no está en la plantilla.');
  const b = await api.bajarArchivo(a.descarga);
  if (a.sha256 && api.sha256(b.buffer) !== a.sha256) throw fallo(502, 'El archivo de la plantilla llegó cortado (no coincide su sha256): probá de nuevo.');
  return { buffer: b.buffer, tipo: b.tipo || 'application/octet-stream', nombre: a.nombre };
}

module.exports = { calcularMedida, pedirPlantilla, estadoPlantilla, bajarPlantilla, validarParaDiseno, leerEditables, piezasDelArte, ver, guardar, enviar, actualizar, reintentarAplicar, procesarEstado, aplicarResultado, recibirAviso, iniciarSondeo, sondear, envioAutomatico, estructura, revisar, armarPedidoJson, MODO_ENVIO,
  // Para la tienda del portal (services/tiendaConfeccionService.js): revisa un pedido de confección antes de que exista la solicitud
  conPiezas, bajarDeDrive, zipEnMemoria };
// Configuración actualizada: TIZADAPRO_SI_PIEZAS_EN_BLANCO=seguir
