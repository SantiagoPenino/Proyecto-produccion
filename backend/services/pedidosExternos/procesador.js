'use strict';
// Ingreso de pedidos por sistema — procesador.
//
//   pedido (términos de negocio) → validador → traductor → creador de pedidos de SIEMPRE
//                                                          → subida de archivos de SIEMPRE
//
// No crea órdenes por su cuenta: le entrega a prendasOrdersController.createWebOrder el mismo body
// que le manda /ventas/pedido-prenda, y a webOrdersController.uploadOrderFile cada archivo igual
// que lo hace el navegador. Esas dos funciones NO se tocan: acá se las llama "en proceso" con un
// req/res simulado (createWebOrder solo lee req.body / req.user / req.disenadorId).
//
// docs/api-externa-pedidos-prenda-plan.md §0.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sql } = require('../../config/db');
const logger = require('../../utils/logger');
const { validar } = require('./validador');
const { traducir } = require('./traductor');
const { bajar } = require('./descarga');
const { medirArchivo } = require('./medicion');

const ESTADOS_CON_PEDIDO = ['PASANDO_ARCHIVOS', 'CREADO', 'ERROR_ARCHIVOS'];
const json = (o) => JSON.stringify(o ?? null);
const leer = (s, def) => { try { return s ? JSON.parse(s) : def; } catch (_) { return def; } };

// Llama a un handler de Express sin pasar por HTTP y devuelve lo que habría respondido.
function invocar(handler, req) {
  return new Promise((resolve, reject) => {
    let status = 200;
    let resuelto = false;
    const fin = (body) => { if (!resuelto) { resuelto = true; resolve({ status, body }); } };
    const res = {
      status(c) { status = c; return res; },
      json(b) { fin(b); return res; },
      send(b) { fin(b); return res; },
      setHeader() { return res; },
    };
    Promise.resolve(handler(req, res)).then(() => fin(null)).catch(reject);
  });
}

const appDe = (app) => app || { get: () => null };

async function guardar(pool, id, campos) {
  // FechaFin la pone el servidor SQL (GETDATE), igual que el resto de las fechas del sistema.
  const sets = Object.keys(campos).map(k => (k === 'FechaFin' ? 'FechaFin = GETDATE()' : `${k} = @${k}`)).join(', ');
  const rq = pool.request().input('Id', sql.Int, id);
  for (const [k, v] of Object.entries(campos)) {
    if (k === 'FechaFin') continue;
    if (k === 'NoDocERP' || k === 'CodCliente') rq.input(k, sql.Int, v ?? null);
    else rq.input(k, sql.NVarChar(sql.MAX), v ?? null);
  }
  await rq.query(`UPDATE dbo.IntegracionPedidos SET ${sets} WHERE IntegracionID = @Id`);
}

async function filaDe(pool, origen, idExterno) {
  const r = await pool.request().input('O', sql.VarChar(50), origen).input('E', sql.VarChar(100), idExterno)
    .query('SELECT *, DATEDIFF(MINUTE, FechaRecibido, GETDATE()) AS MinutosDesdeRecibido FROM dbo.IntegracionPedidos WHERE Origen = @O AND IdExterno = @E');
  return r.recordset[0] || null;
}

const respuesta = (f) => ({
  integracionId: f.IntegracionID,
  estado: f.Estado,
  noDocERP: f.NoDocERP,
  codigosOrden: f.CodigosOrden ? f.CodigosOrden.split(', ') : [],
  errores: leer(f.ErroresJson, []),
  // PASANDO_ARCHIVOS hace más de 15 minutos = se cortó a mitad de camino: se puede reintentar
  archivosColgados: f.Estado === 'PASANDO_ARCHIVOS' && f.MinutosDesdeRecibido > 15,
  archivos: leer(f.ArchivosJson, []).map(a => ({ nombre: a.originalName, destino: a.finalName, subido: !!a.subido, error: a.error || null })),
});

/**
 * Crea el pedido. Idempotente por (origen, idExterno): si ya se creó, devuelve el que existe.
 * @param {object} p.pedido          pedido en términos de negocio (ver traductor.js / plan §2.3)
 * @param {object} p.usuarioInterno  req.user del usuario interno que lo dispara
 * @param {object} p.app             app de Express (para los sockets); opcional
 * @returns {Promise<{estado, noDocERP, codigosOrden, errores, archivos}>}
 *   Si el pedido se creó, vuelve en estado PASANDO_ARCHIVOS: los archivos siguen en segundo plano.
 */
async function crearPedido(pool, p) {
  const reg = await registrar(pool, p);
  return reg.yaExiste ? reg.respuesta : procesar(pool, reg.id, p);
}

/**
 * Puerta de un sistema externo: anota el pedido y contesta enseguida; la validación, la medición
 * de archivos y la creación siguen en segundo plano. El externo consulta el estado con estadoDe().
 */
async function recibir(pool, p) {
  const reg = await registrar(pool, p);
  if (reg.yaExiste) return reg.respuesta;
  setImmediate(() => procesar(pool, reg.id, p).catch(e => logger.error(`[PEDIDOS-SISTEMA] ${p.origen} ${p.idExterno}: ${e.message}`)));
  return respuesta(await filaDe(pool, p.origen, p.idExterno));
}

// Anota el pedido (o encuentra el que ya existe). Idempotencia: UNIQUE (Origen, IdExterno).
async function registrar(pool, { origen, idExterno, pedido, usuarioInterno }) {
  let fila = await filaDe(pool, origen, idExterno);
  if (fila && ESTADOS_CON_PEDIDO.includes(fila.Estado)) return { yaExiste: true, respuesta: respuesta(fila) };   // ya existe: no se crea otro
  if (fila && fila.Estado === 'PROCESANDO') {
    const e = new Error('Este pedido ya se está creando. Esperá unos segundos y actualizá.'); e.status = 409; throw e;
  }

  if (!fila) {
    try {
      await pool.request().input('O', sql.VarChar(50), origen).input('E', sql.VarChar(100), idExterno)
        .input('U', sql.Int, usuarioInterno?.id || null).input('P', sql.NVarChar(sql.MAX), json(pedido))
        .query(`INSERT INTO dbo.IntegracionPedidos (Origen, IdExterno, Estado, UsuarioID, PedidoJson) VALUES (@O, @E, 'PROCESANDO', @U, @P)`);
    } catch (e) {
      if (e.number === 2627 || e.number === 2601) { const err = new Error('Este pedido ya se está creando. Esperá unos segundos y actualizá.'); err.status = 409; throw err; }
      throw e;
    }
    fila = await filaDe(pool, origen, idExterno);
  } else {
    // RECHAZADO o ERROR: nunca llegó a crearse nada → se puede volver a intentar con el pedido corregido.
    // El UPDATE condicionado evita que dos reintentos simultáneos creen dos pedidos.
    const r = await pool.request().input('Id', sql.Int, fila.IntegracionID).input('P', sql.NVarChar(sql.MAX), json(pedido)).input('U', sql.Int, usuarioInterno?.id || null)
      .query(`UPDATE dbo.IntegracionPedidos SET Estado = 'PROCESANDO', PedidoJson = @P, ErroresJson = NULL, UsuarioID = @U, FechaFin = NULL
              WHERE IntegracionID = @Id AND Estado IN ('RECHAZADO', 'ERROR')`);
    if (!r.rowsAffected[0]) { const err = new Error('Este pedido ya se está creando. Esperá unos segundos y actualizá.'); err.status = 409; throw err; }
  }
  return { yaExiste: false, id: fila.IntegracionID };
}

async function procesar(pool, id, { origen, idExterno, pedido, usuarioInterno, app }) {
  try {
    // 0. Archivos que llegaron sin medida (sistema externo): se bajan y se miden acá.
    const sinMedida = await completarMedidas(pedido);
    if (sinMedida.length) {
      await guardar(pool, id, { Estado: 'RECHAZADO', ErroresJson: json(sinMedida), FechaFin: new Date() });
      return respuesta(await filaDe(pool, origen, idExterno));
    }

    // 1. Validador intermedio. Nada se crea (ni se gasta número de pedido) si hay un solo error.
    const { errores, cliente } = await validar(pool, pedido);
    if (errores.length) {
      await guardar(pool, id, { Estado: 'RECHAZADO', ErroresJson: json(errores), FechaFin: new Date() });
      return respuesta(await filaDe(pool, origen, idExterno));
    }

    // 2. Traductor → mismo body que /ventas/pedido-prenda
    const { payload, archivos } = traducir(pedido);
    await guardar(pool, id, { CodCliente: cliente.CodCliente, PayloadJson: json(payload) });

    // 3. Creador de pedidos de siempre. req.user = el mismo que arma impersonarClienteInterno.
    const { createWebOrder } = require('../../controllers/prendasOrdersController');
    const out = await invocar(createWebOrder, {
      body: payload, headers: {}, app: appDe(app),
      user: {
        ...usuarioInterno, id: cliente.CodCliente, codCliente: cliente.CodCliente, cliIdCliente: cliente.CliIdCliente,
        idCliente: cliente.IDCliente, name: cliente.Nombre, email: cliente.Email || usuarioInterno?.email,
        role: 'WEB_CLIENT', impersonadoPorInterno: usuarioInterno?.id,
      },
    });
    if (!out.body?.success) {
      const mensaje = out.body?.error || out.body?.message || `El creador de pedidos respondió ${out.status}.`;
      await guardar(pool, id, { Estado: 'ERROR', ErroresJson: json([{ codigo: 'CREADOR_DE_PEDIDOS', campo: null, mensaje }]), FechaFin: new Date() });
      return respuesta(await filaDe(pool, origen, idExterno));
    }

    // 4. Pedido creado. Las órdenes están en "Cargando..." hasta que lleguen sus archivos.
    const codigos = out.body.orderIds || [];
    const noDoc = parseInt((String(codigos[0] || '').match(/-(\d+)/) || [])[1], 10) || null;
    const manifiesto = (out.body.uploadManifest || []).map(m => {
      const origenArchivo = archivos.find(a => a.fileKey === m.fileKey) || archivos.find(a => a.name === m.originalName);
      return { ...m, url: origenArchivo?.url || null, subido: false };
    });
    await guardar(pool, id, { Estado: 'PASANDO_ARCHIVOS', NoDocERP: noDoc, CodigosOrden: codigos.join(', '), ArchivosJson: json(manifiesto) });
    logger.info(`[PEDIDOS-SISTEMA] ${origen} ${idExterno}: pedido ${noDoc} creado (${codigos.join(', ')}). Pasando ${manifiesto.length} archivo(s).`);
    await ponerCantidades(pool, noDoc, pedido, usuarioInterno, cliente);

    setImmediate(() => pasarArchivos(pool, id, usuarioInterno, app)
      .catch(e => logger.error(`[PEDIDOS-SISTEMA] pasarArchivos ${id}: ${e.message}`)));

    return respuesta(await filaDe(pool, origen, idExterno));
  } catch (e) {
    logger.error(`[PEDIDOS-SISTEMA] ${origen} ${idExterno}: ${e.stack || e.message}`);
    await guardar(pool, id, { Estado: 'ERROR', ErroresJson: json([{ codigo: 'ERROR_INTERNO', campo: null, mensaje: e.message }]), FechaFin: new Date() }).catch(() => {});
    throw e;
  }
}

// Corte y Costura trabajan por PRENDA, pero el creador de pedidos las deja con Magnitud 0 (no llevan
// archivo de producción ni ítems). Acá, sin tocar el creador, se les pone la cantidad de prendas del
// pedido, y se vuelve a pedir la cotización para que salga con esa cantidad (la misma llamada que hace
// el creador; correrla dos veces es lo mismo que el "sincronizar" manual).
// TPU: la orden nace sin archivo de producción (el arte se hace en el área), así que tampoco trae cantidad:
// se le ponen los parches a fabricar = prendas × estampados por prenda.
async function ponerCantidades(pool, noDoc, pedido, usuarioInterno, cliente) {
  const prendas = parseInt(pedido.producto?.cantidad, 10);
  const tpu = (pedido.servicios || []).find(s => s.tipo === 'TPU');
  const parches = tpu ? (parseInt(tpu.estampado?.prendas, 10) || 0) * (parseInt(tpu.estampado?.estampadosPorPrenda, 10) || 1) : 0;
  if (!noDoc) return;
  try {
    const poner = async (areas, cantidad) => {
      if (!(cantidad > 0)) return 0;
      const r = await pool.request().input('N', sql.VarChar(50), String(noDoc)).input('Mag', sql.VarChar(50), String(cantidad))
        .query(`UPDATE dbo.Ordenes SET Magnitud = @Mag
                WHERE LTRIM(RTRIM(CAST(NoDocERP AS varchar(50)))) = @N AND AreaID IN (${areas})
                  AND ISNULL(TRY_CAST(Magnitud AS float), 0) = 0`);
      return r.rowsAffected[0];
    };
    const tocadas = (pedido.corte || pedido.costura ? await poner("'TWC', 'TWT'", prendas) : 0) + await poner("'TPU'", parches);
    if (!tocadas) return;
    logger.info(`[PEDIDOS-SISTEMA] pedido ${noDoc}: Corte / Costura con ${prendas} prenda(s)${parches ? `, TPU con ${parches} parche(s)` : ''}.`);
    setImmediate(async () => {
      try {
        const ERPSyncService = require('../erpSyncService');
        await ERPSyncService.syncFinalOrderIntegration(noDoc, usuarioInterno?.id || 1, usuarioInterno?.name || cliente?.Nombre, null, { skipDeposito: true });
      } catch (e) { logger.warn(`[PEDIDOS-SISTEMA] pedido ${noDoc}: no se pudo recotizar con la cantidad de prendas: ${e.message}`); }
    });
  } catch (e) {
    logger.warn(`[PEDIDOS-SISTEMA] pedido ${noDoc}: no se pudieron poner las cantidades de Corte / Costura / TPU: ${e.message}`);
  }
}

// El arte de la producción principal y el de DTF tienen que llegar con su medida. Si el origen no la
// mandó, se mide acá. (Bordado y TPU no llevan medida.)
async function completarMedidas(pedido) {
  const errores = [];
  const pendientes = [];
  (pedido.impresion?.items || []).forEach((it, i) => { if (it.archivo && !(Number(it.archivo.anchoM) > 0 && Number(it.archivo.altoM) > 0)) pendientes.push({ a: it.archivo, campo: `impresion.items[${i}].archivo` }); });
  (pedido.servicios || []).forEach((sv, i) => { if (sv.tipo === 'DTF') (sv.archivos || []).forEach((a, k) => { if (a && !(Number(a.anchoM) > 0 && Number(a.altoM) > 0)) pendientes.push({ a, campo: `servicios[${i}].archivos[${k}]` }); }); });
  if (!pendientes.length) return errores;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pedido-sistema-medir-'));
  try {
    for (let i = 0; i < pendientes.length; i++) {
      const { a, campo } = pendientes[i];
      try {
        if (!String(a.url || '').toLowerCase().startsWith('http')) continue;   // sin enlace: lo informa el validador
        const ruta = path.join(dir, `m-${i}`);
        const { mime } = await bajar(a.url, ruta);
        const m = await medirArchivo(ruta, a.nombre, mime);
        a.anchoM = Math.round(m.anchoM * 10000) / 10000;
        a.altoM = Math.round(m.altoM * 10000) / 10000;
      } catch (e) {
        errores.push({ codigo: 'ARCHIVO_NO_SE_PUDO_MEDIR', campo, mensaje: `"${a.nombre || a.url}": ${e.message}` });
      }
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* nada */ }
  }
  return errores;
}

/**
 * Pasa a producción los archivos que falten del pedido. Cada uno entra por la MISMA función que
 * usa el navegador (upload-stream): nombre de producción, carpeta del área, miniatura, perfil de
 * color, preflight, y al llegar el último la orden pasa de "Cargando..." a "Pendiente".
 * Se puede volver a llamar: solo procesa los que no están subidos.
 */
async function pasarArchivos(pool, integracionId, usuarioInterno, app) {
  const r = await pool.request().input('Id', sql.Int, integracionId).query('SELECT * FROM dbo.IntegracionPedidos WHERE IntegracionID = @Id');
  const fila = r.recordset[0];
  if (!fila || !['PASANDO_ARCHIVOS', 'ERROR_ARCHIVOS'].includes(fila.Estado)) return;
  const manifiesto = leer(fila.ArchivosJson, []);
  const { uploadOrderFile } = require('../../controllers/webOrdersController');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pedido-sistema-${integracionId}-`));
  const bajados = {};   // url → { ruta, mime }: un archivo que va a dos lugares se baja una sola vez

  try {
    for (let i = 0; i < manifiesto.length; i++) {
      const m = manifiesto[i];
      if (m.subido) continue;
      try {
        if (!m.url) throw new Error('No se encontró de dónde sale este archivo.');
        if (!bajados[m.url]) {
          const ruta = path.join(dir, `origen-${Object.keys(bajados).length}`);
          bajados[m.url] = { ruta, mime: (await bajar(m.url, ruta)).mime };
        }
        // uploadOrderFile borra su temporal al terminar: se le da una copia.
        const copia = path.join(dir, `subida-${i}`);
        fs.copyFileSync(bajados[m.url].ruta, copia);
        const out = await invocar(uploadOrderFile, {
          body: { dbId: m.dbId, type: m.type, finalName: m.finalName, area: m.area, codigoOrden: (String(m.finalName).match(/^([A-Z]+-\d+)/i) || [])[1] },
          file: { path: copia, originalname: m.originalName, mimetype: bajados[m.url].mime || '', size: fs.statSync(copia).size },
          user: usuarioInterno, headers: {}, app: appDe(app),
        });
        if (!out.body?.success) throw new Error(out.body?.error || `La subida respondió ${out.status}.`);
        m.subido = true; m.error = null;
      } catch (e) {
        m.error = e.message;
        logger.warn(`[PEDIDOS-SISTEMA] ${integracionId}: "${m.originalName}" no pasó a producción: ${e.message}`);
      }
      await guardar(pool, integracionId, { ArchivosJson: json(manifiesto) });
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* nada */ }
  }

  const fallaron = manifiesto.filter(m => !m.subido);
  await guardar(pool, integracionId, {
    Estado: fallaron.length ? 'ERROR_ARCHIVOS' : 'CREADO',
    ErroresJson: fallaron.length ? json(fallaron.map(m => ({ codigo: 'ARCHIVO_NO_PASO', campo: m.originalName, mensaje: `"${m.originalName}": ${m.error}` }))) : null,
    FechaFin: new Date(),
  });
}

async function estadoDe(pool, origen, idExterno) {
  const f = await filaDe(pool, origen, idExterno);
  return f ? respuesta(f) : null;
}

async function reintentarArchivos(pool, { origen, idExterno, usuarioInterno, app }) {
  const f = await filaDe(pool, origen, idExterno);
  if (!f) { const e = new Error('Ese pedido no existe.'); e.status = 404; throw e; }
  // PASANDO_ARCHIVOS de hace más de 15 minutos = el servidor se reinició a mitad de camino.
  const colgado = f.Estado === 'PASANDO_ARCHIVOS' && f.MinutosDesdeRecibido > 15;
  if (f.Estado !== 'ERROR_ARCHIVOS' && !colgado) { const e = new Error('Este pedido no tiene archivos pendientes de pasar a producción.'); e.status = 409; throw e; }
  await guardar(pool, f.IntegracionID, { Estado: 'PASANDO_ARCHIVOS' });
  setImmediate(() => pasarArchivos(pool, f.IntegracionID, usuarioInterno, app)
    .catch(e => logger.error(`[PEDIDOS-SISTEMA] pasarArchivos ${f.IntegracionID}: ${e.message}`)));
  return respuesta(await filaDe(pool, origen, idExterno));
}

module.exports = { crearPedido, recibir, estadoDe, reintentarArchivos };
