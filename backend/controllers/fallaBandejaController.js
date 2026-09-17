/**
 * Reportar falla o faltante desde las áreas de bandeja (EMB, EST, TWC, TWT) — Spec 39, RN-FLT.05 a 07.
 *
 * NO toca la falla del control de impresión (postControlArchivo): esto vive al lado.
 *  1) lo pendiente del pedido (libro) — "¿lo que te falta es esto?"
 *  2) qué falta: tipo, cantidad, archivo de origen, detalle de piezas, motivo, nota, foto
 *  3) reposiciones propuestas: falla propia en la misma área, o cadena hacia atrás (una orden de
 *     falla por área anterior, encadenadas). Del área que reporta en adelante no nace nada.
 * Con tela/prenda del cliente o producto del local NO se crea orden: se abre una Solicitud de insumo.
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { changeOrderState } = require('../services/stateManagerService');
const libro = require('../services/libroEntregasService');
const solicitudes = require('../services/solicitudesInsumoService');
const { saveFallaImage } = require('../utils/thumbnailGenerator');
const { registrarAuditoria } = require('../services/trackingService');

const getArea = (req) => (req.query?.area || req.body?.area || '').toString().trim().toUpperCase();
const err400 = (msg) => { const e = new Error(msg); e.statusCode = 400; return e; };

async function getOrden(conn, ordenId) {
    const r = await new sql.Request(conn).input('id', sql.Int, ordenId).query(`
        SELECT OrdenID, CodigoOrden, AreaID, NoDocERP, Cliente, CliIdCliente, CodCliente, DescripcionTrabajo, Material, Variante,
               Magnitud, UM, ProximoServicio, Estado, EstadoenArea, EstadoLogistica, BobinaTelaID, PrendaClienteID, WmsVarianteId,
               IdCabezalERP, IdClienteReact, IdProductoReact, ProIdProducto, CodArticulo, FechaEstimadaEntrega, EstadoEnvio, OrdenOrigenID,
               CantidadTerminada, CantidadControlada, CantidadAprobadaBultos
        FROM Ordenes WHERE OrdenID = @id`);
    return r.recordset[0] || null;
}

/** GET /:area/orders/:ordenId/falla/pendientes — paso 1: lo que todavía no llegó a esta área del pedido */
exports.getPendientes = async (req, res) => {
    try {
        const area = getArea(req);
        const pool = await getPool();
        const o = await getOrden(pool, parseInt(req.params.ordenId, 10));
        if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
        if (!o.NoDocERP) return res.json({ noDocERP: null, area, anteriores: [], ordenes: [], sinPedido: true });
        // Mirado desde ESTA orden: con varias prendas en el pedido, solo lo que le manda prendas a ella.
        const data = await libro.getPendientesParaOrden(o.OrdenID, String(o.NoDocERP).trim(), area, pool);
        // Archivos de origen (para "de qué archivo viene") de cada orden anterior
        for (const x of data.ordenes) {
            const a = await pool.request().input('id', sql.Int, x.OrdenID).query(`
                SELECT ArchivoID, NombreArchivo, Metros, Copias, Piezas, Ancho, Alto, EstadoArchivo FROM ArchivosOrden
                WHERE OrdenID = @id AND ISNULL(EstadoArchivo,'') NOT IN ('CANCELADO','Cancelado') ORDER BY ArchivoID`);
            x.archivos = a.recordset;
        }
        const [areasCadena, areasUnidades, areasFallaCadena] = await Promise.all([libro.areasConCadena(pool), libro.areasQueCuentanUnidades(pool), libro.areasFallaPropiaRequiereCadena(pool)]);
        // Cuánto se puede reportar como falla PROPIA de esta orden, "de acuerdo al caso": lo que
        // ya está en mano sin haber salido todavía (trabajado − ya aprobado en tandas). Lo que ya
        // se aprobó y salió en un remito no se puede reportar como fallado ahora — ya no está acá.
        // Si el área no cuenta unidades (Sublimación mide metros), no hay tope numérico.
        // NULL (nunca se usó Trabajo para esta orden) no es lo mismo que 0: sin dato no hay
        // con qué calcular el tope, y se deja sin límite antes que bloquear con un 0 falso.
        let maxFallaPropia = null;
        if (areasUnidades.includes(area) && o.CantidadTerminada != null) {
            const trabajado = parseFloat(o.CantidadTerminada) || 0;
            const aprobado = parseFloat(o.CantidadAprobadaBultos) || 0;
            maxFallaPropia = Math.max(trabajado - aprobado, 0);
        }
        res.json({ ...data, orden: { OrdenID: o.OrdenID, CodigoOrden: o.CodigoOrden, UM: String(o.UM || '').trim(), Magnitud: o.Magnitud, maxFallaPropia },
                   cadenaHabilitada: areasCadena.includes(area), areasUnidades,
                   // Spec 39: en estas áreas no hay prenda de repuesto en stock — una falla
                   // PROPIA (no solo un faltante) también arma la cadena completa hacia atrás,
                   // porque si rompió/perdió la prenda física hay que fabricar una nueva.
                   // Además del área, hace falta que ESTE pedido tenga áreas anteriores reales
                   // (mismo criterio que usa `reportar`) — un combo sin tela/corte/costura
                   // detrás no tiene nada que encadenar.
                   fallaPropiaUsaCadena: areasFallaCadena.includes(area) && !!(data.anteriores && data.anteriores.length) });
    } catch (err) { logger.error('[fallaBandeja] getPendientes:', err); res.status(err.statusCode || 500).json({ error: err.message }); }
};

/** POST /:area/orders/:ordenId/falla/es-lo-pendiente — el operario miró lo pendiente y decidió no reportar */
exports.esLoPendiente = async (req, res) => {
    try {
        const pool = await getPool();
        await registrarAuditoria(pool, req.user?.id, 'FALTANTE_ES_LO_PENDIENTE', `Orden ${req.params.ordenId} · ${getArea(req)}: el operario confirmó que lo que falta es lo pendiente del libro; no se creó ninguna reposición.`, req.ip);
        res.json({ success: true, message: 'No se creó ninguna reposición. Lo que falta ya está en camino o en producción.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

/**
 * Cadena propuesta para un faltante reportado desde `area`: una orden de falla por área anterior,
 * desde la primera que produce el insumo hasta la inmediata anterior.
 */
async function proponerCadena(pool, orden, area, cantidad) {
    // [PRENDAS] PRO es un caso especial: `getHermanas()` la excluye a propósito de la
    // secuencia (es el "pilar" del pedido, no un paso más), así que nunca aparece en `seq` y
    // `areasAnteriores` normal siempre daría vacío para ella. "Anteriores a PRO" es la
    // secuencia de producción COMPLETA del pedido.
    let anteriores = area === 'PRO'
        ? await libro.areasAnterioresAPro(String(orden.NoDocERP).trim(), pool)
        : await libro.areasAnteriores(String(orden.NoDocERP).trim(), area, pool);

    // [VENTA/COMBO] Si la orden es de una prenda puntual del pedido (ComboItemID: combo o
    // "Comprar y personalizar"), la cadena hacia atrás sale del recorrido de ESA prenda: las
    // órdenes de la misma prenda que le mandan trabajo a esta área, y las que les mandan a
    // ellas. La secuencia del pedido entero mezclaba prendas y hasta invertía el orden
    // (proponía rehacer DTF y Estampado de otra prenda ante una falla en Bordado). Una prenda
    // del local que llega directo de su venta de retiro no tiene nada antes: la cadena queda
    // vacía y la falla va por la detección de producto del local (solicitud, no orden -F).
    if (area !== 'PRO' && orden.OrdenID) {
        const g = (await new sql.Request(pool).input('id', sql.Int, orden.OrdenID)
            .query(`SELECT ComboItemID FROM Ordenes WHERE OrdenID = @id`)).recordset[0];
        if (g?.ComboItemID) {
            const hermanas = await libro.getHermanas(String(orden.NoDocERP).trim(), pool);
            const ids = hermanas.map(h => parseInt(h.OrdenID, 10)).filter(Number.isFinite);
            const det = ids.length
                ? (await new sql.Request(pool).query(`SELECT OrdenID, ComboItemID, UPPER(LTRIM(RTRIM(ProximoServicio))) AS Prox FROM Ordenes WHERE OrdenID IN (${ids.join(',')})`)).recordset
                : [];
            const porId = new Map(det.map(d => [d.OrdenID, d]));
            const delGrupo = hermanas.filter(h => porId.get(h.OrdenID)?.ComboItemID === g.ComboItemID && h.OrdenID !== orden.OrdenID);
            const incluidas = new Set();
            let frontera = [String(area).trim().toUpperCase()];
            while (frontera.length) {
                const siguiente = [];
                for (const destino of frontera) {
                    for (const h of delGrupo) {
                        if (incluidas.has(h.OrdenID) || porId.get(h.OrdenID)?.Prox !== destino) continue;
                        incluidas.add(h.OrdenID);
                        siguiente.push(String(h.AreaID).trim().toUpperCase());
                    }
                }
                frontera = siguiente;
            }
            const seq = libro.secuenciaAreas(hermanas);
            const posicion = (a) => { const i = seq.indexOf(a); return i < 0 ? 999 : i; };
            const areas = [...new Set(delGrupo.filter(h => incluidas.has(h.OrdenID)).map(h => String(h.AreaID).trim().toUpperCase()))]
                .sort((x, y) => posicion(x) - posicion(y));
            anteriores = areas.map(a => ({ AreaID: a, ordenes: delGrupo.filter(h => incluidas.has(h.OrdenID) && String(h.AreaID).trim().toUpperCase() === a) }));
        }
    }
    const areasUnidades = await libro.areasQueCuentanUnidades(pool);
    const eslabones = [];
    for (const a of anteriores) {
        const madre = a.ordenes[0]; // una orden por área en el pedido (si hay varias, la primera)
        if (!madre) continue;
        const cuenta = areasUnidades.includes(String(a.AreaID).trim().toUpperCase());
        eslabones.push({
            area: a.AreaID, ordenMadreId: madre.OrdenID, codigoMadre: String(madre.CodigoOrden).trim(), um: String(madre.UM || '').trim(),
            cuentaUnidades: cuenta, cantidad: cuenta ? cantidad : null,
            nota: cuenta ? `Nace Pendiente con ${cantidad} ${String(madre.UM || '').trim()}` : 'Nace Pendiente sin metros: los metros aparecen al imprimir y medir. El archivo de reimpresión se sube después desde la orden.',
        });
    }
    return eslabones;
}

/** POST /:area/orders/:ordenId/falla/proponer { tipo, cantidad } */
exports.proponer = async (req, res) => {
    try {
        const area = getArea(req);
        const { tipo = 'FALLA_PROPIA', cantidad } = req.body || {};
        const pool = await getPool();
        const o = await getOrden(pool, parseInt(req.params.ordenId, 10));
        if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
        const cant = cantidad != null && cantidad !== '' ? Number(cantidad) : null;
        let eslabones;
        if (tipo === 'FALTANTE') {
            if (!o.NoDocERP) throw err400('Esta orden no pertenece a un pedido: no hay áreas anteriores donde reponer.');
            const areasCadena = await libro.areasConCadena(pool);
            if (!areasCadena.includes(area)) throw err400(`La cadena de reposición hacia atrás no está habilitada para ${area}. Reportá la falla como propia o pedí habilitarla (AREAS_CADENA_REPOSICION).`);
            eslabones = await proponerCadena(pool, o, area, cant);
            if (!eslabones.length) throw err400('No hay áreas anteriores en este pedido: el insumo no vino de otra área.');
        } else {
            // Falla PROPIA en un área sin prenda de repuesto en stock (Bordado/Corte/Costura):
            // si rompió/perdió la prenda física hace falta fabricar una nueva desde cero —
            // misma cadena hacia atrás que un faltante, no una orden nueva en esta área. Pero
            // solo cuando ESTE pedido realmente tiene áreas anteriores con tela/corte/costura
            // (un combo "Comprar y personalizar" puede llegar directo a Bordado desde un
            // producto ya armado: ahí no hay nada que reponer río arriba, se queda como
            // siempre — una orden nueva acá, o la detección de insumo del cliente/local).
            const areasFallaCadena = await libro.areasFallaPropiaRequiereCadena(pool);
            let cadena = [];
            if (areasFallaCadena.includes(area) && o.NoDocERP && (await libro.areasConCadena(pool)).includes(area)) {
                cadena = await proponerCadena(pool, o, area, cant);
            }
            if (cadena.length) {
                eslabones = cadena;
            } else {
                const areasUnidades = await libro.areasQueCuentanUnidades(pool);
                const cuenta = areasUnidades.includes(area);
                eslabones = [{ area, ordenMadreId: o.OrdenID, codigoMadre: String(o.CodigoOrden).trim(), um: String(o.UM || '').trim(), cuentaUnidades: cuenta, cantidad: cuenta ? cant : null, nota: 'Orden de falla en esta misma área' }];
            }
        }
        // Origen del insumo: el de la primera orden de la cadena (o la propia)
        const primera = await getOrden(pool, eslabones[0].ordenMadreId);
        const origen = await solicitudes.detectarOrigenInsumo(primera, pool);
        const stock = origen !== 'PROPIO' ? await solicitudes.buscarStock(origen, primera, pool) : null;
        res.json({ tipo, area, eslabones, origenInsumo: origen, stock, ordenReporta: { OrdenID: o.OrdenID, CodigoOrden: o.CodigoOrden } });
    } catch (err) { logger.error('[fallaBandeja] proponer:', err); res.status(err.statusCode || 500).json({ error: err.message }); }
};

// Creación de órdenes de falla: compartida con las solicitudes de insumo (cadenaReposicionService)
const { codigoFalla, crearOrdenFalla } = require('../services/cadenaReposicionService');

/**
 * POST /:area/orders/:ordenId/falla
 * body: { tipo: 'FALLA_PROPIA'|'FALTANTE', cantidad, motivoId, motivoTexto, nota, imagenBase64,
 *         archivoOrigenId, detallePiezas:[{cantidad, parte, talle}], eslabones:[{area, ordenMadreId, cantidad}] }
 */
exports.reportar = async (req, res) => {
    const area = getArea(req);
    const ordenId = parseInt(req.params.ordenId, 10);
    const { tipo = 'FALLA_PROPIA', cantidad, motivoId, motivoTexto, nota, imagenBase64, archivoOrigenId, detallePiezas, eslabones: eslabonesBody } = req.body || {};
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido' });
    const usuarioId = req.user?.id || null;
    const userObj = req.user || 'Sistema';
    const io = req.app.get('socketio');
    let tx;
    try {
        const pool = await getPool();
        const o = await getOrden(pool, ordenId);
        if (!o) return res.status(404).json({ error: 'Orden no encontrada' });
        if (String(o.AreaID).trim().toUpperCase() !== area) throw err400(`La orden ${o.CodigoOrden} no es de ${area}.`);
        const cant = cantidad != null && cantidad !== '' ? Number(cantidad) : null;
        if (cant != null && !(cant > 0)) throw err400('La cantidad que falta tiene que ser mayor que cero.');
        // No se puede reportar como falla PROPIA más de lo que hay en mano (lo trabajado que
        // todavía no se aprobó/despachó en una tanda) — mismo tope que ve el operario en el paso 2.
        if (tipo === 'FALLA_PROPIA' && cant != null && o.CantidadTerminada != null) {
            const areasUnidades = await libro.areasQueCuentanUnidades(pool);
            if (areasUnidades.includes(area)) {
                const trabajado = parseFloat(o.CantidadTerminada) || 0;
                const aprobado = parseFloat(o.CantidadAprobadaBultos) || 0;
                const maxFallaPropia = Math.max(trabajado - aprobado, 0);
                if (cant > maxFallaPropia) throw err400(`No podés reportar más de ${maxFallaPropia} prenda(s): es lo que tenés en mano sin despachar todavía (trabajaste ${trabajado}, ya salieron ${aprobado}).`);
            }
        }

        // Motivo: catálogo TiposFallas o texto libre
        let motivo = (motivoTexto || '').trim();
        let tipoFallaId = motivoId ? parseInt(motivoId, 10) : null;
        if (tipoFallaId) {
            const t = await pool.request().input('id', sql.Int, tipoFallaId).query('SELECT Titulo FROM TiposFallas WHERE FallaID = @id');
            if (t.recordset[0]) motivo = motivo || t.recordset[0].Titulo;
        }
        if (!motivo) throw err400('Indicá el motivo de la falla.');

        // Eslabones: los que mandó el operario (editables) o los propuestos
        let eslabones = Array.isArray(eslabonesBody) && eslabonesBody.length ? eslabonesBody : null;
        if (!eslabones) {
            if (tipo === 'FALTANTE') {
                const areasCadena = await libro.areasConCadena(pool);
                if (!areasCadena.includes(area)) throw err400(`La cadena de reposición hacia atrás no está habilitada para ${area}.`);
                eslabones = await proponerCadena(pool, o, area, cant);
                if (!eslabones.length) throw err400('No hay áreas anteriores en este pedido.');
            } else {
                // Falla PROPIA en un área sin prenda de repuesto (Bordado/Corte/Costura): misma
                // cadena hacia atrás que un faltante, no una orden nueva en esta área — pero
                // solo si este pedido realmente tiene áreas anteriores con tela/corte/costura
                // (un combo "Comprar y personalizar" puede llegar directo desde un producto ya
                // armado: ahí no hay nada río arriba, se queda como siempre).
                const areasFallaCadena = await libro.areasFallaPropiaRequiereCadena(pool);
                let cadena = [];
                if (areasFallaCadena.includes(area) && o.NoDocERP && (await libro.areasConCadena(pool)).includes(area)) {
                    cadena = await proponerCadena(pool, o, area, cant);
                }
                eslabones = cadena.length ? cadena : [{ area, ordenMadreId: o.OrdenID, cantidad: cant }];
            }
        }
        const areasUnidades = await libro.areasQueCuentanUnidades(pool);
        const piezasTxt = Array.isArray(detallePiezas) && detallePiezas.length
            ? detallePiezas.map(p => `${p.cantidad} × ${p.parte || ''}${p.talle ? ' · talle ' + p.talle : ''}`.trim()).join(', ')
            : '';

        tx = new sql.Transaction(pool);
        await tx.begin();

        const primeraMadre = await getOrden(tx, eslabones[0].ordenMadreId);
        if (!primeraMadre) throw err400('No se encontró la orden madre del primer eslabón.');
        const origen = await solicitudes.detectarOrigenInsumo(primeraMadre, tx);
        const imgPath = imagenBase64 ? await saveFallaImage(imagenBase64, String(o.CodigoOrden).trim(), `falta-${Date.now()}`) : null;

        // Registro de la falla (tabla histórica) sobre la orden madre del primer eslabón
        const fallaIns = await new sql.Request(tx)
            .input('OID', sql.Int, primeraMadre.OrdenID).input('Arch', sql.Int, archivoOrigenId ? parseInt(archivoOrigenId, 10) : null)
            .input('Area', sql.NVarChar, area).input('Tipo', sql.Int, tipoFallaId)
            .input('Cant', sql.Decimal(10, 2), (cant != null && /^m/i.test(String(o.UM || '').trim())) ? cant : null)
            .input('Obs', sql.NVarChar(sql.MAX), `[${tipo}] ${motivo}${piezasTxt ? ' · ' + piezasTxt : ''}${nota ? ' · ' + nota : ''} (reportado desde ${area} por ${String(o.CodigoOrden).trim()})`)
            .input('Img', sql.NVarChar(300), imgPath)
            .query(`INSERT INTO FallasProduccion (OrdenID, ArchivoID, AreaID, FechaFalla, TipoFalla, CantidadFalla, EquipoID, Observaciones, ImagenFalla)
                    OUTPUT INSERTED.FallaID VALUES (@OID, @Arch, @Area, GETDATE(), @Tipo, @Cant, NULL, @Obs, @Img)`);
        const fallaId = fallaIns.recordset[0].FallaID;

        const creadas = [];
        let solicitudId = null;

        if (origen !== 'PROPIO') {
            // Insumo del cliente / producto del local: NO nace ninguna orden. Se registra la cadena
            // completa en Reposiciones (primer eslabón ESPERANDO_INSUMO, los demás BLOQUEADA) y la
            // solicitud para Atención al Cliente / Administración. Las órdenes -F se crean recién con
            // la decisión (materializarCadena).
            const stock = await solicitudes.buscarStock(origen, primeraMadre, tx);
            let anteriorRepId = null, primeraRepId = null;
            for (let i = 0; i < eslabones.length; i++) {
                const e = eslabones[i];
                const madre = i === 0 ? primeraMadre : await getOrden(tx, e.ordenMadreId);
                if (!madre) throw err400(`No se encontró la orden madre del eslabón ${e.area}.`);
                const areaE = String(madre.AreaID).trim().toUpperCase();
                const cuenta = areasUnidades.includes(areaE);
                const cantE = e.cantidad != null && e.cantidad !== '' ? Number(e.cantidad) : (cuenta ? cant : (i === 0 ? cant : null));
                const repIns = await new sql.Request(tx)
                    .input('madre', sql.Int, madre.OrdenID).input('rep', sql.Int, o.OrdenID)
                    .input('ap', sql.VarChar(20), areaE).input('ar', sql.VarChar(20), area)
                    .input('tipo', sql.VarChar(20), tipo).input('origen', sql.VarChar(20), origen)
                    .input('estado', sql.VarChar(20), i === 0 ? 'ESPERANDO_INSUMO' : 'BLOQUEADA')
                    .input('cant', sql.Decimal(12, 2), cantE).input('um', sql.NChar(10), String(i === 0 ? (o.UM || madre.UM) : madre.UM || '').trim() || null)
                    .input('motivo', sql.NVarChar(200), motivo.slice(0, 200)).input('nota', sql.NVarChar(sql.MAX), nota || null)
                    .input('img', sql.NVarChar(300), imgPath).input('arch', sql.Int, i === 0 && archivoOrigenId ? parseInt(archivoOrigenId, 10) : null)
                    .input('piezas', sql.NVarChar(sql.MAX), Array.isArray(detallePiezas) && detallePiezas.length ? JSON.stringify(detallePiezas) : null)
                    .input('ant', sql.Int, anteriorRepId).input('falla', sql.Int, fallaId)
                    .input('doc', sql.NChar, o.NoDocERP ? String(o.NoDocERP).trim() : null).input('u', sql.Int, usuarioId)
                    .query(`INSERT INTO Reposiciones (OrdenMadreID, OrdenFallaID, OrdenReportaID, AreaProduce, AreaReporta, Tipo, OrigenInsumo, Estado, Cantidad, Unidad, Motivo, Nota, ImagenPath, ArchivoOrigenID, DetallePiezas, ReposicionAnteriorID, FallaID, NoDocERP, UsuarioID)
                            OUTPUT INSERTED.ReposicionID
                            VALUES (@madre, NULL, @rep, @ap, @ar, @tipo, @origen, @estado, @cant, @um, @motivo, @nota, @img, @arch, @piezas, @ant, @falla, @doc, @u)`);
                anteriorRepId = repIns.recordset[0].ReposicionID;
                if (i === 0) primeraRepId = anteriorRepId;
            }
            solicitudId = await solicitudes.crearSolicitud(tx, { reposicionId: primeraRepId, tipo: origen, stock, usuarioId });
            creadas.push({ reposicionId: primeraRepId, solicitudId, origen, stock: stock?.resumen, eslabones: eslabones.length });
        } else {
            // Cadena de reposición: una orden de falla por eslabón, encadenadas
            let anteriorRepId = null, anteriorOrdenFallaId = null;
            for (let i = 0; i < eslabones.length; i++) {
                const e = eslabones[i];
                const madre = i === 0 ? primeraMadre : await getOrden(tx, e.ordenMadreId);
                if (!madre) throw err400(`No se encontró la orden madre del eslabón ${e.area}.`);
                const areaE = String(madre.AreaID).trim().toUpperCase();
                const cuenta = areasUnidades.includes(areaE);
                const cantE = e.cantidad != null && e.cantidad !== '' ? Number(e.cantidad) : (cuenta ? cant : null);
                const magnitud = cuenta && cantE != null ? String(cantE) : '0';
                const ultimo = i === eslabones.length - 1;
                const siguiente = ultimo ? null : String(eslabones[i + 1].area).trim().toUpperCase();
                const mismaArea = areaE === area && eslabones.length === 1 && madre.OrdenID === o.OrdenID;
                // A dónde va el material de esta reposición: al siguiente eslabón, o al área que reportó;
                // si produce y reporta la misma área, sigue el camino de la madre.
                const prox = siguiente || (mismaArea ? (madre.ProximoServicio || null) : area);
                const codigo = await codigoFalla(tx, madre.CodigoOrden, fallaId);
                const notaF = `FALLA (${tipo === 'FALTANTE' ? 'faltante' : 'falla propia'}) reportada desde ${area} por ${String(o.CodigoOrden).trim()}: ${motivo}.` +
                    (piezasTxt ? ` Piezas: ${piezasTxt}.` : '') + (nota ? ` Nota: ${nota}.` : '') +
                    (!cuenta ? ' Sin metros hasta imprimir y medir. Subir el archivo de reimpresión desde el detalle de la orden.' : '') +
                    (anteriorOrdenFallaId ? ` Se libera cuando llegue la reposición del área anterior.` : '');
                const nuevaId = await crearOrdenFalla(tx, {
                    madre, codigo, magnitud, proximoServicio: prox,
                    liberaCuandoOrdenId: anteriorOrdenFallaId, estadoDependencia: anteriorOrdenFallaId ? 'ESPERANDO_REPOSICION' : null,
                    nota: notaF,
                });
                const repIns = await new sql.Request(tx)
                    .input('madre', sql.Int, madre.OrdenID).input('falla', sql.Int, nuevaId).input('rep', sql.Int, o.OrdenID)
                    .input('ap', sql.VarChar(20), areaE).input('ar', sql.VarChar(20), area)
                    .input('tipo', sql.VarChar(20), tipo).input('estado', sql.VarChar(20), anteriorRepId ? 'BLOQUEADA' : 'PENDIENTE')
                    .input('cant', sql.Decimal(12, 2), cuenta ? cantE : null).input('um', sql.NChar(10), String(madre.UM || '').trim() || null)
                    .input('motivo', sql.NVarChar(200), motivo.slice(0, 200)).input('nota', sql.NVarChar(sql.MAX), nota || null)
                    .input('img', sql.NVarChar(300), imgPath).input('arch', sql.Int, i === 0 && archivoOrigenId ? parseInt(archivoOrigenId, 10) : null)
                    .input('piezas', sql.NVarChar(sql.MAX), Array.isArray(detallePiezas) && detallePiezas.length ? JSON.stringify(detallePiezas) : null)
                    .input('ant', sql.Int, anteriorRepId).input('fid', sql.Int, fallaId)
                    .input('doc', sql.NChar, o.NoDocERP ? String(o.NoDocERP).trim() : null).input('u', sql.Int, usuarioId)
                    .query(`INSERT INTO Reposiciones (OrdenMadreID, OrdenFallaID, OrdenReportaID, AreaProduce, AreaReporta, Tipo, OrigenInsumo, Estado, Cantidad, Unidad, Motivo, Nota, ImagenPath, ArchivoOrigenID, DetallePiezas, ReposicionAnteriorID, FallaID, NoDocERP, UsuarioID)
                            OUTPUT INSERTED.ReposicionID
                            VALUES (@madre, @falla, @rep, @ap, @ar, @tipo, 'PROPIO', @estado, @cant, @um, @motivo, @nota, @img, @arch, @piezas, @ant, @fid, @doc, @u)`);
                anteriorRepId = repIns.recordset[0].ReposicionID;
                anteriorOrdenFallaId = nuevaId;
                creadas.push({ reposicionId: anteriorRepId, ordenFallaId: nuevaId, codigo, area: areaE, cantidad: cuenta ? cantE : null, sinMetros: !cuenta, estado: anteriorRepId && i > 0 ? 'BLOQUEADA' : 'PENDIENTE' });
            }
        }

        // La orden que reportó queda retenida y sigue con lo que tiene (Spec 39, RN-FLT.07)
        // [CONTROL] Si la falla se reporta DESDE Control, la orden NO sale de Control: pasarla a
        // "Retenido" la sacaba de la lista (Control solo muestra 'Control y Calidad') y con 500
        // prendas controladas y 1 rota no había forma de aprobar por tandas las 499 sanas. Se marca
        // solo "Esperando Reposición"; lo que no se puede es aprobar el TOTAL mientras la reposición
        // siga abierta (candado en embBoardController.aprobarControl). Desde Trabajo, como siempre.
        const enControl = String(o.EstadoenArea || '').trim() === 'Control y Calidad';
        if (enControl) {
            await new sql.Request(tx).input('id', sql.Int, o.OrdenID)
                .query(`UPDATE Ordenes SET EstadoLogistica = 'Esperando Reposición' WHERE OrdenID = @id`);
        } else {
            await changeOrderState(tx, {
                target: { type: 'ORDER', id: o.OrdenID }, estado: 'Retenido', userObj,
                detalle: `${tipo === 'FALTANTE' ? 'Faltante' : 'Falla'} reportado: ${motivo}. La orden sigue operable con lo que tiene.`,
                extraSet: { EstadoLogistica: 'Esperando Reposición' }, io,
            });
        }
        await registrarAuditoria(tx, usuarioId, 'FALLA_BANDEJA', `${area} ${String(o.CodigoOrden).trim()} [${tipo}] ${motivo} · origen ${origen} · ${creadas.map(c => c.codigo || ('solicitud #' + c.solicitudId)).join(', ')}`, req.ip);
        await tx.commit();

        const message = origen === 'PRODUCTO_LOCAL'
            ? `No se creó ninguna orden todavía: es un producto del local. Se abrió la solicitud #${solicitudId} para que Atención al Cliente apruebe la reposición del stock (VEN interna). Al cliente no se le avisa.`
            : origen !== 'PROPIO'
            ? `No se creó ninguna orden: el insumo es del cliente o del local. Se abrió la solicitud #${solicitudId} para Atención al Cliente y Administración. ${creadas[0].stock || ''} La orden ${String(o.CodigoOrden).trim()} queda retenida hasta la decisión del cliente.`
            : `Se crearon ${creadas.map(c => `${c.codigo} (${c.sinMetros ? 'sin metros hasta imprimir' : c.cantidad + ' ' + String(o.UM || '').trim()})`).join(' y ')}. ${String(o.CodigoOrden).trim()} queda retenida hasta recibir la reposición. Podés seguir trabajando con lo que tenés.`;
        res.json({ success: true, origenInsumo: origen, creadas, solicitudId, fallaId, message });
    } catch (err) {
        if (tx) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } }
        logger.error('[fallaBandeja] reportar:', err);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
};

/** GET /:area/orders/:ordenId/reposiciones — reposiciones de esta orden (como reporta o como madre) */
exports.getReposicionesOrden = async (req, res) => {
    try {
        const ordenId = parseInt(req.params.ordenId, 10);
        const pool = await getPool();
        const r = await pool.request().input('id', sql.Int, ordenId).query(`
            SELECT r.*, f.CodigoOrden AS CodigoFalla, f.Estado AS EstadoFalla, f.EstadoenArea AS EstadoEnAreaFalla, f.Magnitud AS MagnitudFalla,
                   m.CodigoOrden AS CodigoMadre, s.SolicitudID, s.Estado AS EstadoSolicitud, s.Decision,
                   ao.NombreArchivo AS ArchivoOrigenNombre, ao.Copias AS ArchivoOrigenCopias, ao.Metros AS ArchivoOrigenMetros,
                   ao.RutaAlmacenamiento AS ArchivoOrigenRuta
            FROM Reposiciones r
            LEFT JOIN Ordenes f ON f.OrdenID = r.OrdenFallaID
            LEFT JOIN Ordenes m ON m.OrdenID = r.OrdenMadreID
            LEFT JOIN SolicitudesInsumo s ON s.ReposicionID = r.ReposicionID
            -- Spec 39: el archivo PUNTUAL de la madre que hay que reponer (no "todos los de
            -- la madre") — evita contaminar cualquier descarga por lote con archivos ajenos.
            LEFT JOIN ArchivosOrden ao ON ao.ArchivoID = r.ArchivoOrigenID
            WHERE r.OrdenReportaID = @id OR r.OrdenMadreID = @id OR r.OrdenFallaID = @id
            ORDER BY r.ReposicionID`);
        res.json(r.recordset.map(x => ({ ...x, descripcion: libro.describirReposicion(x) })));
    } catch (err) { res.status(500).json({ error: err.message }); }
};
