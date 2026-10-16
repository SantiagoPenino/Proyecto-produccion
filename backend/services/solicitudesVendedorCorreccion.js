// =====================================================================
// CORREGIR EL DISEÑO DE UN PEDIDO QUE YA ESTÁ EN PRODUCCIÓN (15/10/2026)
// =====================================================================
// Caso: el pedido se creó desde la solicitud y la tizada o el DTF estaban mal. Diseño abre una corrección sobre el
// producto (Datos.correccion, con el motivo), vuelve a trabajar su arte, su lista, su tizada y sus diseños prontos
// (los candados de "ya es pedido" lo dejan pasar mientras la corrección está abierta: solicitudesVendedorService.
// enCorreccion) y después pasa lo nuevo al MISMO pedido (mismo número, misma solicitud).
//
// Qué le pasa a cada orden afectada (sublimación / impresión de la producción principal y DTF), según la planta:
//   - Pendiente o Cargando..., sin lote y sin imprimir  → se le cambia el archivo (como la recuperación).
//   - En un lote (RolloID) y sin imprimir              → la planta la saca del rollo primero ("Sacar del Rollo");
//     cuando vuelve a Pendiente se le cambia el archivo. No se saca sola: el rollo puede estar armado en el RIP.
//   - Ya impresa (Impreso / FechaImpreso)               → la corrección NO la toca (15/10, decisión del usuario): si hay
//     que reimprimirla, se reporta como FALLA en la planta (la reposición sale de ahí, sin cargo) con el archivo corregido.
// Bordado, TPU, corte, costura, armado y estampado no se tocan.
//
// PASO 1: abrir y cancelar la corrección, y el plan orden por orden (solo lectura).
// PASO 2: aplicar el plan ("Pasar al pedido").
// =====================================================================
const { sql } = require('../config/db');
const logger = require('../utils/logger');

const ORIGEN = 'SOLICITUD_VENDEDOR';
const idExternoDe = (solicitudId, productoSolId) => `SOL-${solicitudId}-P${productoSolId}`;
const fallo = (status, message) => Object.assign(new Error(message), { status });
const leer = (txt, def) => { try { return txt ? JSON.parse(txt) : def; } catch (_) { return def; } };
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function exigirDisenador(pool, user, base) {
  if (!(await base.esDisenador(pool, user))) throw fallo(403, 'La corrección del diseño la hace un diseñador (o un Admin).');
}

// El producto, ya convertido en pedido, con su corrección (si hay)
async function productoConvertido(cx, solicitudId, productoSolId) {
  const r = await new sql.Request(cx).input('S', sql.Int, solicitudId).input('P', sql.Int, productoSolId).query(`
    SELECT p.ProductoSolID, p.SolicitudID, p.ProductoNombre, p.PedidoNoDocERP, p.DatosJson, s.Estado AS SolEstado
    FROM dbo.SolicitudesVendedorProductos p
    JOIN dbo.SolicitudesVendedor s ON s.SolicitudID = p.SolicitudID
    WHERE p.ProductoSolID = @P AND p.SolicitudID = @S AND p.Activo = 1`);
  const p = r.recordset[0];
  if (!p) throw fallo(404, 'El producto no existe en esta solicitud.');
  if (p.SolEstado === 'CANCELADA') throw fallo(409, 'La solicitud está cancelada.');
  if (!p.PedidoNoDocERP) throw fallo(409, 'Este producto todavía no es pedido: el diseño se cambia en la misma pantalla, sin abrir una corrección.');
  p.correccion = leer(p.DatosJson, {}).correccion || null;
  return p;
}

async function guardarCorreccion(cx, productoSolId, corr) {
  await new sql.Request(cx).input('P', sql.Int, productoSolId).input('J', sql.NVarChar(sql.MAX), JSON.stringify(corr))
    .query(`UPDATE dbo.SolicitudesVendedorProductos
               SET DatosJson = JSON_MODIFY(CASE WHEN ISJSON(DatosJson) = 1 THEN DatosJson ELSE N'{}' END, '$.correccion', JSON_QUERY(@J))
             WHERE ProductoSolID = @P`);
}

/** Abre la corrección: desde acá Diseño puede volver a cambiar el arte, la lista, la tizada y los diseños prontos. b: { motivo } */
async function abrir(pool, user, base, solicitudId, productoSolId, b = {}) {
  await exigirDisenador(pool, user, base);
  const motivo = String(b.motivo || '').trim().slice(0, 500);
  if (!motivo) throw fallo(400, 'Escribí qué estaba mal: queda en el historial de la solicitud y de las órdenes.');
  const p = await productoConvertido(pool, solicitudId, productoSolId);
  if (p.correccion?.activa) throw fallo(409, `Ya hay una corrección abierta (la abrió ${p.correccion.por || 'otro diseñador'}).`);
  const corr = { activa: true, motivo, porId: user.id, por: user.name || user.username || null, fecha: new Date().toISOString(), pedido: p.PedidoNoDocERP };
  await guardarCorreccion(pool, productoSolId, corr);
  await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'EDICION', texto: `Corrección del diseño abierta sobre el pedido ${p.PedidoNoDocERP}: ${motivo}` });
  return { ok: true, correccion: corr };
}

/** Cancela la corrección sin pasar nada al pedido (el pedido sigue como estaba). */
async function cancelar(pool, user, base, solicitudId, productoSolId) {
  await exigirDisenador(pool, user, base);
  const p = await productoConvertido(pool, solicitudId, productoSolId);
  if (!p.correccion?.activa) return { ok: true };
  await guardarCorreccion(pool, productoSolId, { ...p.correccion, activa: false, cierre: 'CANCELADA', cerroPor: user.name || user.username || null, fechaCierre: new Date().toISOString() });
  await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'EDICION',
    texto: `Corrección del diseño cancelada: el pedido ${p.PedidoNoDocERP} sigue como estaba. Si se cambiaron diseños prontos en la solicitud, quedan ahí sin pasar al pedido.` });
  return { ok: true };
}

/**
 * El plan, orden por orden (solo lectura). Archivos nuevos = los diseños prontos vigentes de la producción principal y
 * del DTF que el pedido todavía no tiene (no están en su manifiesto de archivos). Cada orden de sublimación / impresión /
 * DTF del pedido recibe los nuevos de SU tela o film.
 */
async function plan(pool, user, base, solicitudId, productoSolId) {
  await exigirDisenador(pool, user, base);
  const p = await productoConvertido(pool, solicitudId, productoSolId);
  const pedido = String(p.PedidoNoDocERP);

  // Área de la producción principal (la misma cuenta que solicitudesVendedorConversion.areaPrincipalDeProducto, que no se
  // requiere acá porque al cargarse arrastra el procesador de pedidos)
  const areaPrincipal = String((await pool.request().input('P', sql.Int, productoSolId).query(`
    SELECT CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicaPrincipal') IS NULL THEN NULL
                ELSE (SELECT vc.TecnicaPrincipal FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS Area
    FROM dbo.SolicitudesVendedorProductos p WHERE p.ProductoSolID = @P`)).recordset[0]?.Area || 'SB').trim().toUpperCase();
  const partes = (await pool.request().input('P', sql.Int, productoSolId).query(
    "SELECT ParteID, Tipo, DatosJson FROM dbo.SolicitudesVendedorPartes WHERE ProductoSolID = @P AND Activo = 1 AND Tipo IN ('PRINCIPAL', 'DTF')")).recordset;
  const principal = partes.find(x => x.Tipo === 'PRINCIPAL') || null;
  const dtf = partes.find(x => x.Tipo === 'DTF') || null;
  // DTF: un pliego sin film es del film del servicio (la misma regla que al crear el pedido)
  const filmServicio = dtf ? (leer(dtf.DatosJson, {}).material || null) : null;
  const materialDe = (a) => a.Material || (dtf && a.ParteID === dtf.ParteID ? filmServicio : null);
  const areas = [...new Set([principal && areaPrincipal, dtf && 'DF'].filter(Boolean))];
  if (!areas.length) return { pedido, correccion: p.correccion, ordenes: [], sinOrden: [], nuevos: 0, listo: false };

  // Los diseños prontos vigentes y los que el pedido ya tiene (manifiesto de la integración)
  const ids = partes.map(x => x.ParteID);
  const prontos = (await pool.request().query(`
    SELECT ArchivoID, ParteID, NombreOriginal, LTRIM(RTRIM(Material)) AS Material, AnchoM, AltoM, ISNULL(Copias, 1) AS Copias
    FROM dbo.SolicitudesVendedorArchivos WHERE ParteID IN (${ids.join(',')}) AND Rol = 'DISENO_PRONTO' AND Vigente = 1`)).recordset;
  const fila = (await pool.request().input('O', sql.VarChar(40), ORIGEN).input('E', sql.VarChar(80), idExternoDe(solicitudId, productoSolId))
    .query('SELECT ArchivosJson FROM dbo.IntegracionPedidos WHERE Origen = @O AND IdExterno = @E')).recordset[0];
  const manifiesto = leer(fila?.ArchivosJson, []);
  const enElPedido = new Set(manifiesto.map(m => String(m.fileKey || '')));
  const vigentes = new Set(prontos.map(a => `SOLARCH-${a.ArchivoID}`));
  const nuevos = prontos.filter(a => !enElPedido.has(`SOLARCH-${a.ArchivoID}`));
  // De qué orden es cada lugar de archivo del manifiesto (ArchivosOrden.OrdenID), sin los cancelados
  const dbIds = manifiesto.filter(m => m.type === 'ORDEN').map(m => parseInt(m.dbId, 10)).filter(Boolean);
  const ordenDelLugar = new Map();
  if (dbIds.length) {
    (await pool.request().query(`SELECT ArchivoID, OrdenID FROM dbo.ArchivosOrden WHERE ArchivoID IN (${dbIds.join(',')}) AND UPPER(ISNULL(EstadoArchivo, '')) <> 'CANCELADO'`))
      .recordset.forEach(x => ordenDelLugar.set(x.ArchivoID, x.OrdenID));
  }

  const ordenes = (await pool.request().input('N', sql.VarChar(50), pedido).query(`
    SELECT o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS Codigo, LTRIM(RTRIM(o.AreaID)) AS Area, LTRIM(RTRIM(o.Material)) AS Material,
           LTRIM(RTRIM(o.Estado)) AS Estado, LTRIM(RTRIM(o.EstadoenArea)) AS EstadoenArea, o.RolloID, r.Nombre AS Rollo,
           CAST(CASE WHEN o.Impreso = 1 OR o.FechaImpreso IS NOT NULL THEN 1 ELSE 0 END AS bit) AS Impreso
    FROM dbo.Ordenes o
    LEFT JOIN dbo.Rollos r ON r.RolloID = o.RolloID
    WHERE LTRIM(RTRIM(CAST(o.NoDocERP AS varchar(50)))) = @N AND LTRIM(RTRIM(o.AreaID)) IN (${areas.map(a => `'${a}'`).join(',')})
      AND ISNULL(o.Estado, '') <> 'Cancelado'
    ORDER BY o.OrdenID`)).recordset;

  // Cada orden queda con el JUEGO COMPLETO vigente de su tela: los archivos que no cambiaron quedan como están, los nuevos
  // ocupan el lugar de los que ya no están en el diseño (sustituidos o quitados), y si sobran lugares se cancelan.
  const usados = new Set();
  const filas = ordenes.map(o => {
    // DF con DTF en el producto (y la principal en otra área): sus archivos son los del DTF; si no, los de la principal
    const parte = o.Area === 'DF' && dtf && areaPrincipal !== 'DF' ? dtf : principal;
    const deLaTela = prontos.filter(a => parte && a.ParteID === parte.ParteID && norm(materialDe(a)) === norm(o.Material))
      .sort((a, b) => String(a.NombreOriginal).localeCompare(String(b.NombreOriginal)) || a.ArchivoID - b.ArchivoID);
    const nuevosDeLaOrden = deLaTela.filter(a => !enElPedido.has(`SOLARCH-${a.ArchivoID}`));
    nuevosDeLaOrden.forEach(a => usados.add(a.ArchivoID));
    const lugares = manifiesto.filter(m => m.type === 'ORDEN' && ordenDelLugar.get(parseInt(m.dbId, 10)) === o.OrdenID);
    const salen = lugares.filter(m => !vigentes.has(String(m.fileKey || '')));   // ya no están en el diseño
    const archivos = nuevosDeLaOrden.map(a => ({ ArchivoID: a.ArchivoID, nombre: a.NombreOriginal, metros: a.AltoM != null ? Number(a.AltoM) : null, copias: a.Copias, n: deLaTela.indexOf(a) + 1 }));
    const juego = { total: deLaTela.length, metros: Math.round(deLaTela.reduce((t, a) => t + (Number(a.AltoM) || 0) * (Number(a.Copias) || 1), 0) * 100) / 100 };
    const queda = lugares.length - salen.length;
    const cambio = [archivos.length && `${archivos.length} archivo(s) nuevo(s)`, salen.length && `sale(n) ${salen.length}`, queda > 0 && `quedan ${queda} sin cambios`].filter(Boolean).join(', ');
    let accion; let texto;
    if (!archivos.length && !salen.length) { accion = 'SIN_CAMBIOS'; texto = 'No cambió ningún archivo de esta tela: queda como está.'; }
    // Nunca una orden sin archivos: salen los suyos y no entra ninguno de su tela (el nuevo se subió con otra tela o film)
    else if (!archivos.length && queda <= 0) { accion = 'REVISAR'; texto = `Se quedaría sin ningún archivo: no hay un archivo nuevo de "${o.Material}". Revisá la tela o el film del archivo corregido.`; }
    else if (o.Impreso) { accion = 'IMPRESA'; texto = 'Ya se imprimió: la corrección no la toca. Si hay que volver a imprimirla, se reporta como falla en la planta (la reposición sale de ahí, sin cargo) con el archivo corregido de la solicitud.'; }
    else if (o.RolloID) { accion = 'SACAR_DEL_ROLLO'; texto = `Está en el lote "${o.Rollo || o.RolloID}" sin imprimir: la planta la tiene que sacar del rollo. Cuando vuelva a Pendiente se pasa (${cambio}).`; }
    else if (['Pendiente', 'Cargando...'].includes(o.Estado)) { accion = 'REEMPLAZAR'; texto = `Todavía no empezó: se cambia en la misma orden (${cambio}).`; }
    else { accion = 'REVISAR'; texto = `Está "${o.EstadoenArea || o.Estado}" sin lote y sin imprimir: hablalo con la planta antes de pasarlo.`; }
    return {
      OrdenID: o.OrdenID, Codigo: o.Codigo, Area: o.Area, Material: o.Material, Estado: o.Estado, EstadoenArea: o.EstadoenArea, Rollo: o.Rollo || null, Impreso: !!o.Impreso,
      accion, texto, archivos, salen: salen.map(m => ({ dbId: m.dbId, nombre: m.originalName })), juego,
    };
  });
  // Archivos nuevos de una tela o film que el pedido no tiene: no hay a qué orden ponerlos
  const sinOrden = nuevos.filter(a => !usados.has(a.ArchivoID)).map(a => ({
    ArchivoID: a.ArchivoID, nombre: a.NombreOriginal, Material: materialDe(a),
    texto: `"${a.NombreOriginal}" es de "${materialDe(a) || 'sin tela'}" y el pedido no tiene una orden de esa tela o film: elegí la tela del archivo (o rehacé la tizada con las telas del pedido).`,
  }));
  const aPasar = filas.filter(f => f.accion === 'REEMPLAZAR').length;
  return {
    pedido, correccion: p.correccion, ordenes: filas, sinOrden, nuevos: nuevos.length,
    // se puede pasar si hay algo para pasar, ningún archivo sin orden y nada para revisar con la planta
    listo: aPasar > 0 && !sinOrden.length && !filas.some(f => f.accion === 'REVISAR'),
  };
}

/**
 * PASO 2 · "Pasar al pedido". Vuelve a armar el plan (no se confía en el de la pantalla) y, orden por orden:
 *  - REEMPLAZAR: la orden vuelve a "Cargando..." SOLO si sigue Pendiente, sin lote y sin imprimir (si la planta la movió
 *    mientras tanto, no se toca y se avisa). Sus lugares de archivo que vinieron de la solicitud pasan a los archivos
 *    nuevos (los que sobran se cancelan) y los metros son la suma de los nuevos. El pase lo hace el procesador de siempre:
 *    cuando llega el último archivo la orden vuelve sola a "Pendiente". Igual que la recuperación (solicitudesVendedorRecuperar).
 *  - IMPRESA: no se toca (si hay que reimprimirla, va por falla en la planta).
 *  - SACAR_DEL_ROLLO: no se toca. La corrección queda abierta: cuando la planta la saque del rollo, se vuelve a pasar.
 * Antes de tocar nada: cada PDF nuevo de 1 página (producción no acepta más). Todo queda en el historial.
 */
async function aplicar(pool, user, base, solicitudId, productoSolId, app) {
  const pl = await plan(pool, user, base, solicitudId, productoSolId);
  if (!pl.correccion?.activa) throw fallo(409, 'No hay una corrección abierta en este producto.');
  if (!pl.listo) {
    throw fallo(409, pl.sinOrden.length ? pl.sinOrden[0].texto
      : pl.ordenes.some(o => o.accion === 'REVISAR') ? 'Hay órdenes para hablar con la planta antes de pasar la corrección (mirá "Qué va a pasar").'
        : 'No hay nada para pasar al pedido: rehacé la tizada o subí el archivo corregido.');
  }
  const fila = (await pool.request().input('O', sql.VarChar(40), ORIGEN).input('E', sql.VarChar(80), idExternoDe(solicitudId, productoSolId))
    .query('SELECT * FROM dbo.IntegracionPedidos WHERE Origen = @O AND IdExterno = @E')).recordset[0];
  if (!fila) throw fallo(409, 'No se encontró el registro del pedido de este producto: no se puede pasar la corrección.');
  if (fila.Estado === 'PASANDO_ARCHIVOS') throw fallo(409, 'El pedido está pasando archivos a producción en este momento. Esperá a que termine.');

  const aHacer = pl.ordenes.filter(o => o.accion === 'REEMPLAZAR');
  const ids = [...new Set(aHacer.flatMap(o => o.archivos.map(a => Number(a.ArchivoID))))];
  const nuevos = new Map(!ids.length ? [] : (await pool.request().query(`
    SELECT ArchivoID, NombreOriginal, UrlDrive, AnchoM, AltoM, ISNULL(Copias, 1) AS Copias
    FROM dbo.SolicitudesVendedorArchivos WHERE ArchivoID IN (${ids.join(',')}) AND Vigente = 1`)).recordset.map(a => [a.ArchivoID, a]));
  // Cada PDF nuevo, de 1 página: se controla ANTES de tocar las órdenes
  const { paginasDe } = require('./solicitudesVendedorRecuperar');
  for (const a of nuevos.values()) {
    const n = await paginasDe(a.UrlDrive).catch(e => { throw fallo(502, `No se pudo leer "${a.NombreOriginal}" de Drive: ${e.message}`); });
    if (n != null && n > 1) throw fallo(409, `"${a.NombreOriginal}" tiene ${n} páginas y producción acepta 1 por archivo: no se tocó ninguna orden.`);
  }

  const { changeOrderState } = require('./stateManagerService');
  const io = app?.get ? app.get('socketio') : null;
  const motivo = pl.correccion.motivo;
  const marca = `[corrección del diseño, solicitud #${Number(solicitudId)}]`;
  const ext = (a) => (String(a.NombreOriginal).split('.').pop() || 'pdf').toLowerCase();
  let manifiesto = leer(fila.ArchivosJson, []);
  const hechas = []; const noSe = [];

  for (const o of aHacer) {
    const archivos = o.archivos.map(x => ({ ...nuevos.get(Number(x.ArchivoID)), n: x.n })).filter(a => a.ArchivoID);
    if (archivos.length !== o.archivos.length) { noSe.push({ codigo: o.Codigo, motivo: 'Algún archivo nuevo ya no está vigente: volvé a mirar el plan.' }); continue; }
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const ord = (await new sql.Request(tx).input('O', sql.Int, o.OrdenID).query(`
        SELECT OrdenID, LTRIM(RTRIM(CodigoOrden)) AS CodigoOrden, LTRIM(RTRIM(AreaID)) AS AreaID, LTRIM(RTRIM(Material)) AS Material, Magnitud
        FROM dbo.Ordenes WITH (UPDLOCK) WHERE OrdenID = @O`)).recordset[0];
      // Los lugares de archivo de la orden que vinieron de la solicitud (manifiesto); si no hay, los de la orden
      const lugaresBD = (await new sql.Request(tx).input('O', sql.Int, o.OrdenID).query(`
        SELECT ArchivoID, NombreArchivo, TipoArchivo FROM dbo.ArchivosOrden
        WHERE OrdenID = @O AND UPPER(ISNULL(EstadoArchivo, '')) <> 'CANCELADO' ORDER BY ArchivoID`)).recordset;
      const delPedido = lugaresBD.filter(l => manifiesto.some(m => m.type === 'ORDEN' && String(m.dbId) === String(l.ArchivoID)));
      const lugares = delPedido.length ? delPedido : lugaresBD;
      // "…_Arch 1 de 2 (x1).pdf" (sublimación) o "…_Archivo 1 de 1 (x1).pdf" (DTF): el prefijo es lo de antes
      const prefijoOriginal = String(lugares[0]?.NombreArchivo || '').replace(/_Arch(?:ivo)? \d+ de \d+.*$/i, '').trim() || `${ord.Material}-${ord.CodigoOrden}`;
      const items = [];

      if (o.accion === 'REEMPLAZAR') {
        // Los lugares que se liberan: los de los archivos que ya no están en el diseño. Los que no cambiaron, no se tocan.
        const libres = lugares.filter(l => o.salen.some(x => String(x.dbId) === String(l.ArchivoID)));
        // Guarda: solo si la planta no la movió (sigue Pendiente / Cargando..., sin lote y sin imprimir). Si no hay archivos
        // para subir (solo se quitaron), no pasa por "Cargando...": no habría subida que la vuelva a "Pendiente".
        const guarda = "Estado IN ('Pendiente', 'Cargando...') AND RolloID IS NULL AND ISNULL(Impreso, 0) = 0 AND FechaImpreso IS NULL";
        if (archivos.length) {
          const r = await changeOrderState(tx, {
            target: { type: 'ORDER', id: o.OrdenID }, estado: 'Cargando...', userObj: user, io, guard: guarda, extraSet: { Estado: 'Cargando...' },
            detalle: `Corrección del diseño (Solicitud #${solicitudId}): se cambia(n) ${archivos.length} archivo(s) por el corregido. Motivo: ${motivo}`,
          });
          if (!r.ordenesAfectadas.length) throw fallo(409, 'la planta la movió mientras tanto (ya no está Pendiente sin lote): no se tocó.');
        } else {
          const r = (await new sql.Request(tx).input('O', sql.Int, o.OrdenID).query(`SELECT OrdenID FROM dbo.Ordenes WHERE OrdenID = @O AND ${guarda}`)).recordset;
          if (!r.length) throw fallo(409, 'la planta la movió mientras tanto (ya no está Pendiente sin lote): no se tocó.');
        }
        for (const [k, a] of archivos.entries()) {
          const finalName = `${prefijoOriginal}_Arch ${a.n || k + 1} de ${o.juego.total} (x${a.Copias}).${ext(a)}`.slice(0, 200);
          const metros = Number(a.AltoM) || null; const ancho = Number(a.AnchoM) || null;
          let dbId;
          if (k < libres.length) {
            dbId = libres[k].ArchivoID;
            await new sql.Request(tx).input('ID', sql.Int, dbId).input('N', sql.VarChar(200), finalName).input('C', sql.Int, a.Copias)
              .input('M', sql.Decimal(10, 2), metros).input('A', sql.Decimal(10, 2), ancho).input('Obs', sql.NVarChar(400), ` ${marca}`)
              .query(`UPDATE dbo.ArchivosOrden SET NombreArchivo = @N, Copias = @C, Metros = @M, Alto = @M, Ancho = @A, EstadoArchivo = 'Pendiente',
                        RutaAlmacenamiento = NULL, Observaciones = CONCAT(ISNULL(Observaciones, ''), @Obs) WHERE ArchivoID = @ID`);
          } else {
            const ins = await new sql.Request(tx).input('O', sql.Int, o.OrdenID).input('N', sql.VarChar(200), finalName).input('T', sql.VarChar(10), lugares[0]?.TipoArchivo || 'Impresion')
              .input('C', sql.Int, a.Copias).input('M', sql.Decimal(10, 2), metros).input('A', sql.Decimal(10, 2), ancho).input('Obs', sql.NVarChar(400), marca)
              .query(`INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, TipoArchivo, Copias, EstadoArchivo, Metros, Alto, Ancho, FechaSubida, Observaciones)
                      OUTPUT INSERTED.ArchivoID VALUES (@O, @N, @T, @C, 'Pendiente', @M, @M, @A, GETDATE(), @Obs)`);
            dbId = ins.recordset[0].ArchivoID;
          }
          items.push({ dbId, type: 'ORDEN', originalName: a.NombreOriginal, fileKey: `SOLARCH-${a.ArchivoID}`, finalName, area: ord.AreaID, url: a.UrlDrive, subido: false, error: null });
        }
        // Los lugares libres que sobran (el diseño nuevo trae menos archivos): se cancelan, no se borran (tienen su archivo viejo)
        const sobran = libres.slice(archivos.length);
        for (const l of sobran) {
          await new sql.Request(tx).input('ID', sql.Int, l.ArchivoID).input('D', sql.NVarChar(400), `Reemplazado por la corrección del diseño (Solicitud #${solicitudId}).`)
            .query("UPDATE dbo.ArchivosOrden SET EstadoArchivo = 'CANCELADO', DetallesCancelacion = @D WHERE ArchivoID = @ID");
        }
        // Metros de la orden = el juego completo de su tela (los que no cambiaron + los nuevos)
        if (o.juego.metros > 0) await new sql.Request(tx).input('O', sql.Int, o.OrdenID).input('M', sql.NVarChar(200), String(o.juego.metros)).query('UPDATE dbo.Ordenes SET Magnitud = @M WHERE OrdenID = @O');
        await tx.commit();
        const liberados = new Set(libres.map(l => String(l.ArchivoID)));
        manifiesto = [...manifiesto.filter(m => !(m.type === 'ORDEN' && liberados.has(String(m.dbId)))), ...items];
        hechas.push({ codigo: o.Codigo, accion: o.accion, archivos: items.length, salen: sobran.length, metrosAntes: parseFloat(ord.Magnitud) || null, metros: o.juego.metros });
      }
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ya cerrada */ }
      noSe.push({ codigo: o.Codigo, motivo: e.message });
      logger.warn(`[CORRECCION] SOL-${solicitudId}-P${productoSolId} ${o.Codigo}: ${e.message}`);
    }
  }
  if (!hechas.length) throw fallo(409, `No se pasó nada al pedido: ${noSe.map(x => `${x.codigo}: ${x.motivo}`).join(' · ')}`);

  // El pase: el mismo procesador de siempre, con el manifiesto nuevo (solo sube lo que falta)
  await pool.request().input('Id', sql.Int, fila.IntegracionID).input('J', sql.NVarChar(sql.MAX), JSON.stringify(manifiesto))
    .query("UPDATE dbo.IntegracionPedidos SET ArchivosJson = @J, Estado = 'ERROR_ARCHIVOS' WHERE IntegracionID = @Id");
  const procesador = require('./pedidosExternos/procesador');
  const estado = await procesador.reintentarArchivos(pool, { origen: ORIGEN, idExterno: idExternoDe(solicitudId, productoSolId), usuarioInterno: user, app });

  // Cierre: si no quedan órdenes en un rollo ni nada que falló, la corrección se cierra; si no, sigue abierta para volver a pasar
  const quedanEnRollo = pl.ordenes.filter(o => o.accion === 'SACAR_DEL_ROLLO').map(o => o.Codigo);
  const impresas = pl.ordenes.filter(o => o.accion === 'IMPRESA').map(o => o.Codigo);
  const texto = hechas.map(h => `${h.codigo}: ${h.archivos} archivo(s) cambiado(s)${h.salen ? `, ${h.salen} quitado(s)` : ''}${h.metrosAntes !== h.metros ? `, ${h.metrosAntes ?? '—'} m → ${h.metros} m` : ''}`).join(' · ')
    + (quedanEnRollo.length ? `. Quedan en un rollo (la planta las saca y se vuelve a pasar): ${quedanEnRollo.join(', ')}` : '')
    + (impresas.length ? `. Ya impresas, no se tocaron (si hay que reimprimirlas, va por falla): ${impresas.join(', ')}` : '')
    + (noSe.length ? `. No se pudo: ${noSe.map(x => `${x.codigo} (${x.motivo})`).join(', ')}` : '');
  const cerrada = !quedanEnRollo.length && !noSe.length;
  const corr = { ...pl.correccion, ultimoPase: { fecha: new Date().toISOString(), por: user.name || user.username || null, texto } };
  await guardarCorreccion(pool, productoSolId, cerrada ? { ...corr, activa: false, cierre: 'APLICADA', cerroPor: user.name || user.username || null, fechaCierre: new Date().toISOString() } : corr);
  await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'CONVERSION',
    texto: `Corrección del diseño pasada al pedido ${pl.pedido} (${motivo}): ${texto}.${cerrada ? ' Corrección cerrada.' : ' La corrección sigue abierta.'}` });
  logger.info(`[CORRECCION] SOL-${solicitudId}-P${productoSolId} → pedido ${pl.pedido}: ${texto}`);
  return { ok: true, pedido: pl.pedido, hechas, noSe, quedanEnRollo, impresas, cerrada, estado };
}

module.exports = { abrir, cancelar, plan, aplicar };
