'use strict';
// =====================================================================
// RECUPERAR LOS ARCHIVOS DE UN PEDIDO QUE VINO DE UNA SOLICITUD
// =====================================================================
// Caso: el pedido se creó, pero un archivo de la producción principal no pasó a producción (ej. la tizada de
// TIZADA PRO venía en un PDF de 2 páginas) y su orden quedó en "Cargando..." — o la canceló la limpieza
// automática (jobs/zombieOrdersCleanup.job.js: "No se completó la subida").
//   1. Se rehace la tizada en la solicitud (TIZADA PRO deja los diseños prontos nuevos; ver puedeRecuperar).
//   2. recuperar(): pone esos archivos en las órdenes que los esperaban y los pasa a producción:
//      - reactiva la orden SOLO si la canceló la limpieza automática (nunca una cancelada por una persona);
//      - un lugar por archivo: si la tela vino en varias mesas, agrega los lugares que falten (y quita los que
//        sobren, si nunca tuvieron archivo); los metros de la orden pasan a ser la suma de los archivos nuevos;
//      - antes de tocar nada controla que cada PDF tenga 1 página (producción no acepta más).
//   3. El pase lo hace el mismo procesador de siempre (reintentarArchivos → pasarArchivos): cuando la orden
//      tiene todos sus archivos pasa de "Cargando..." a "Pendiente".
// Todo queda en el historial de la orden y de la solicitud.
// =====================================================================
const { sql } = require('../config/db');
const logger = require('../utils/logger');

const ORIGEN = 'SOLICITUD_VENDEDOR';
const idExternoDe = (solicitudId, productoSolId) => `SOL-${solicitudId}-P${productoSolId}`;
const CANCELADA_POR_LIMPIEZA = 'No se completó la subida';   // DetallesCancelacion que deja el job de limpieza
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const leer = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function filaIntegracion(cx, solicitudId, productoSolId) {
  const r = await new sql.Request(cx).input('O', sql.VarChar(40), ORIGEN).input('E', sql.VarChar(80), idExternoDe(solicitudId, productoSolId))
    .query('SELECT * FROM dbo.IntegracionPedidos WHERE Origen = @O AND IdExterno = @E');
  return r.recordset[0] || null;
}

/** ¿El pedido de este producto tiene archivos que no pasaron a producción? (habilita rehacer la tizada aunque esté convertido) */
async function puedeRecuperar(pool, solicitudId, productoSolId) {
  const f = await filaIntegracion(pool, solicitudId, productoSolId).catch(() => null);
  if (!f) return false;
  return f.Estado === 'ERROR_ARCHIVOS' || leer(f.ArchivosJson, []).some(m => !m.subido && m.type === 'ORDEN');
}

async function paginasDe(url) {
  const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{10,})|[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (!m) return null;
  const { stream } = await require('./driveService').getFileStream(m[1] || m[2]);
  const partes = []; for await (const ch of stream) partes.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
  try { const { PDFDocument } = require('pdf-lib'); return (await PDFDocument.load(Buffer.concat(partes), { ignoreEncryption: true, updateMetadata: false })).getPageCount(); }
  catch (_) { return null; }   // no es PDF o no se puede contar: lo decide la subida
}

async function recuperar(pool, user, base, solicitudId, productoSolId, app) {
  if (!base.esVendedor(user) && !(await base.esDisenador(pool, user))) throw fallo(403, 'Esto lo hace el diseñador o el vendedor.');
  const fila = await filaIntegracion(pool, solicitudId, productoSolId);
  if (!fila || !fila.NoDocERP) throw fallo(404, 'Este producto no tiene un pedido creado.');
  if (fila.Estado === 'PASANDO_ARCHIVOS') throw fallo(409, 'El pedido está pasando archivos a producción en este momento. Esperá a que termine.');
  const manifiesto = leer(fila.ArchivosJson, []);
  const pendientes = manifiesto.filter(m => !m.subido && m.type === 'ORDEN');
  if (!pendientes.length) throw fallo(409, `El pedido ${fila.NoDocERP} no tiene archivos de producción pendientes.`);

  // Los diseños prontos vigentes de la producción principal (la tizada rehecha)
  const pa = (await pool.request().input('P', sql.Int, productoSolId).query(
    "SELECT TOP 1 ParteID FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Tipo = 'PRINCIPAL' AND Activo = 1")).recordset[0];
  if (!pa) throw fallo(409, 'El producto no tiene producción principal.');
  const nuevos = (await pool.request().input('Pa', sql.Int, pa.ParteID).query(`
    SELECT ArchivoID, NombreOriginal, UrlDrive, Material, AnchoM, AltoM, ISNULL(Copias, 1) AS Copias
    FROM dbo.SolicitudesVendedorArchivos WHERE ParteID = @Pa AND Rol = 'DISENO_PRONTO' AND Vigente = 1 ORDER BY NombreOriginal`)).recordset;
  if (!nuevos.length) throw fallo(409, 'La producción principal no tiene archivos de diseño pronto. Rehacé la tizada primero.');

  // Los lugares pendientes, agrupados por orden
  const porOrden = new Map();
  for (const m of pendientes) {
    const d = (await pool.request().input('ID', sql.Int, parseInt(m.dbId, 10) || 0).query(`
      SELECT ao.ArchivoID, ao.OrdenID, ao.NombreArchivo, ao.TipoArchivo, ao.RutaAlmacenamiento, o.Estado, o.EstadoenArea, o.DetallesCancelacion,
             LTRIM(RTRIM(o.Material)) AS Material, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden, o.Magnitud
      FROM dbo.ArchivosOrden ao JOIN dbo.Ordenes o ON o.OrdenID = ao.OrdenID WHERE ao.ArchivoID = @ID`)).recordset[0];
    if (!d) continue;
    const g = porOrden.get(d.OrdenID) || { orden: d, lugares: [], items: [] };
    g.lugares.push(d); g.items.push(m); porOrden.set(d.OrdenID, g);
  }
  if (!porOrden.size) throw fallo(409, 'Los lugares de archivo del pedido ya no existen.');

  // Plan por orden (sin tocar nada todavía): archivos nuevos de su tela + qué hacer con la orden
  const plan = [];
  for (const g of porOrden.values()) {
    const o = g.orden;
    const deLaTela = nuevos.filter(a => norm(a.Material) === norm(o.Material));
    const estado = String(o.Estado || '').trim();
    const reactivar = estado === 'Cancelado' && String(o.DetallesCancelacion || '').trim() === CANCELADA_POR_LIMPIEZA;
    if (!deLaTela.length) throw fallo(409, `La tizada no trae ningún archivo de "${o.Material}" para la orden ${o.CodigoOrden}. Revisá la tela de las piezas y rehacé la tizada.`);
    if (estado !== 'Cargando...' && !reactivar) {
      throw fallo(409, estado === 'Cancelado'
        ? `La orden ${o.CodigoOrden} la canceló una persona ("${o.DetallesCancelacion || 'sin motivo'}"): no se reactiva sola. Hablalo con producción.`
        : `La orden ${o.CodigoOrden} está "${estado}": solo se recuperan órdenes en "Cargando..." o canceladas por la limpieza automática.`);
    }
    plan.push({ ...g, deLaTela, reactivar });
  }

  // Cada PDF nuevo, de 1 página (producción no acepta más): se controla ANTES de tocar las órdenes
  for (const a of plan.flatMap(x => x.deLaTela)) {
    const n = await paginasDe(a.UrlDrive).catch(e => { throw fallo(502, `No se pudo leer "${a.NombreOriginal}" de Drive: ${e.message}`); });
    if (n != null && n > 1) throw fallo(409, `"${a.NombreOriginal}" tiene ${n} páginas y producción acepta 1 por archivo. TIZADA PRO tiene que devolver un PDF por mesa: no se tocó ninguna orden.`);
  }

  // Aplicar: órdenes, lugares y manifiesto
  const { changeOrderState } = require('./stateManagerService');
  const io = app?.get ? app.get('socketio') : null;
  const resumen = [];
  let nuevoManifiesto = manifiesto.slice();
  for (const x of plan) {
    const o = x.orden;
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      if (x.reactivar) {
        await changeOrderState(tx, {
          target: { type: 'ORDER', id: o.OrdenID }, estado: 'Cargando...', userObj: user, io,
          guard: "Estado = 'Cancelado'", extraSet: { Estado: 'Cargando...', DetallesCancelacion: null },
          detalle: `Reactivada para recuperar sus archivos (Solicitud #${solicitudId}): la había cancelado la limpieza automática porque el archivo no había pasado a producción.`,
        });
      }
      // Un lugar por archivo nuevo: se reusan los pendientes, se agregan los que falten, se quitan los que sobren (sin archivo)
      const prefijo = (String(x.lugares[0].NombreArchivo || '').split('_Arch ')[0]) || `${o.Material}-${o.CodigoOrden.replace(/\//g, '-')}`;
      const ext = (a) => (String(a.NombreOriginal).split('.').pop() || 'pdf').toLowerCase();
      const items = [];
      for (const [k, a] of x.deLaTela.entries()) {
        const finalName = `${prefijo}_Arch ${k + 1} de ${x.deLaTela.length} (x${a.Copias}).${ext(a)}`.slice(0, 200);
        const metros = Number(a.AltoM) || null; const ancho = Number(a.AnchoM) || null;
        let dbId;
        if (k < x.lugares.length) {
          dbId = x.lugares[k].ArchivoID;
          await new sql.Request(tx).input('ID', sql.Int, dbId).input('N', sql.VarChar(200), finalName).input('C', sql.Int, a.Copias)
            .input('M', sql.Decimal(10, 2), metros).input('A', sql.Decimal(10, 2), ancho)
            .query(`UPDATE dbo.ArchivosOrden SET NombreArchivo = @N, Copias = @C, Metros = @M, Alto = @M, Ancho = @A, EstadoArchivo = 'Pendiente',
                      RutaAlmacenamiento = NULL, Observaciones = CONCAT(ISNULL(Observaciones, ''), ' [recuperado desde la solicitud #${Number(solicitudId)}]')
                    WHERE ArchivoID = @ID`);
        } else {
          const r = await new sql.Request(tx).input('O', sql.Int, o.OrdenID).input('N', sql.VarChar(200), finalName).input('T', sql.VarChar(10), x.lugares[0].TipoArchivo || 'Impresion')
            .input('C', sql.Int, a.Copias).input('M', sql.Decimal(10, 2), metros).input('A', sql.Decimal(10, 2), ancho)
            .query(`INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, TipoArchivo, Copias, EstadoArchivo, Metros, Alto, Ancho, FechaSubida, Observaciones)
                    OUTPUT INSERTED.ArchivoID VALUES (@O, @N, @T, @C, 'Pendiente', @M, @M, @A, GETDATE(), '[recuperado desde la solicitud #${Number(solicitudId)}]')`);
          dbId = r.recordset[0].ArchivoID;
        }
        items.push({ dbId, type: 'ORDEN', originalName: a.NombreOriginal, fileKey: `SOLARCH-${a.ArchivoID}`, finalName, area: x.items[0].area, url: a.UrlDrive, subido: false, error: null });
      }
      for (const l of x.lugares.slice(x.deLaTela.length)) {
        await new sql.Request(tx).input('ID', sql.Int, l.ArchivoID).query('DELETE FROM dbo.ArchivosOrden WHERE ArchivoID = @ID AND RutaAlmacenamiento IS NULL');
      }
      // Metros de la orden = suma de los archivos nuevos (lo que se va a imprimir)
      const total = Math.round(x.deLaTela.reduce((s, a) => s + (Number(a.AltoM) || 0) * (Number(a.Copias) || 1), 0) * 100) / 100;
      if (total > 0 && Math.abs(total - (parseFloat(o.Magnitud) || 0)) >= 0.01) {
        await new sql.Request(tx).input('O', sql.Int, o.OrdenID).input('M', sql.NVarChar(200), String(total)).query('UPDATE dbo.Ordenes SET Magnitud = @M WHERE OrdenID = @O');
      }
      await tx.commit();
      const viejos = new Set(x.items.map(m => String(m.dbId)));
      nuevoManifiesto = [...nuevoManifiesto.filter(m => !viejos.has(String(m.dbId))), ...items];
      resumen.push({ codigo: o.CodigoOrden, reactivada: x.reactivar, archivos: items.length, lugaresAntes: x.lugares.length, metrosAntes: parseFloat(o.Magnitud) || null, metrosAhora: total });
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* nada */ }
      throw e;
    }
  }

  // El pase: el mismo procesador de siempre, con el manifiesto nuevo
  await pool.request().input('Id', sql.Int, fila.IntegracionID).input('J', sql.NVarChar(sql.MAX), JSON.stringify(nuevoManifiesto))
    .query("UPDATE dbo.IntegracionPedidos SET ArchivosJson = @J, Estado = 'ERROR_ARCHIVOS' WHERE IntegracionID = @Id");
  const procesador = require('./pedidosExternos/procesador');
  const estado = await procesador.reintentarArchivos(pool, { origen: ORIGEN, idExterno: idExternoDe(solicitudId, productoSolId), usuarioInterno: user, app });

  const texto = resumen.map(r => `${r.codigo}${r.reactivada ? ' (reactivada: la había cancelado la limpieza automática)' : ''}: ${r.archivos} archivo(s)${r.archivos !== r.lugaresAntes ? ` en lugar de ${r.lugaresAntes}` : ''}${r.metrosAntes !== r.metrosAhora ? `, ${r.metrosAntes ?? '—'} m → ${r.metrosAhora} m` : ''}`).join(' · ');
  await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'CONVERSION', texto: `Recuperación de archivos del pedido ${fila.NoDocERP}: ${texto}. Pasando a producción.` });
  logger.info(`[RECUPERAR] SOL-${solicitudId}-P${productoSolId} → pedido ${fila.NoDocERP}: ${texto}`);
  return { ok: true, pedido: fila.NoDocERP, ordenes: resumen, estado };
}

module.exports = { puedeRecuperar, recuperar, CANCELADA_POR_LIMPIEZA };
