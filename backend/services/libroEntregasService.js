/**
 * Libro de entregas por orden (Spec 39, RN-FLT.04).
 *
 * Por orden: sus envíos (líneas del remito), la marca "completa la orden" y las reposiciones
 * abiertas con el estado real de cada una. "Incompleta" es un motivo, no un número:
 * una orden con envío parcial sin cerrar o con una reposición abierta.
 *
 * La cantidad se declara solo cuando se conoce (obligatoria donde se cuentan prendas o unidades).
 */
const { getPool, sql } = require('../config/db');

const ESTADOS_REPO_ABIERTOS = "('ESPERANDO_INSUMO','BLOQUEADA','PENDIENTE','EN_PRODUCCION','ENVIADA')";

// ── Configuración ────────────────────────────────────────────────────────
async function getConfigLista(clave, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('c', sql.VarChar, clave)
        .query(`SELECT TOP 1 Valor FROM ConfiguracionGlobal WHERE Clave = @c`);
    const v = r.recordset[0] ? String(r.recordset[0].Valor || '') : '';
    return v.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
}
async function getConfigValor(clave, def, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('c', sql.VarChar, clave)
        .query(`SELECT TOP 1 Valor FROM ConfiguracionGlobal WHERE Clave = @c`);
    return r.recordset[0] && r.recordset[0].Valor != null && String(r.recordset[0].Valor).trim() !== '' ? String(r.recordset[0].Valor).trim() : def;
}
/** Áreas con envío parcial habilitado (ConfiguracionGlobal.AREAS_DESPACHO_PARCIAL). */
async function areasConParcial(conn) { return getConfigLista('AREAS_DESPACHO_PARCIAL', conn); }
/** Áreas con cadena de reposición habilitada (AREAS_CADENA_REPOSICION; vacío = apagado). */
async function areasConCadena(conn) { return getConfigLista('AREAS_CADENA_REPOSICION', conn); }
/** Áreas que cuentan prendas/unidades: la cantidad del envío es obligatoria y no supera lo esperado. */
async function areasQueCuentanUnidades(conn) {
    const l = await getConfigLista('AREAS_CUENTAN_UNIDADES', conn);
    return l.length ? l : ['TWC', 'TWT', 'EMB', 'EST', 'TERMINAC', 'TPU'];
}
/**
 * Áreas donde una falla PROPIA (no faltante) igual arma la cadena completa hacia atrás
 * (Sublimación→Corte→Costura...), en vez de una orden nueva en la misma área — porque en
 * estas áreas no hay prenda de repuesto en stock: si la falla rompe/pierde la prenda física
 * (ej. la aguja rasga la tela en Bordado), hay que fabricar una nueva desde cero, igual que
 * un faltante (ConfiguracionGlobal.AREAS_FALLA_PROPIA_REQUIERE_CADENA; vacío = default).
 */
async function areasFallaPropiaRequiereCadena(conn) {
    const l = await getConfigLista('AREAS_FALLA_PROPIA_REQUIERE_CADENA', conn);
    return l.length ? l : ['EMB', 'TWC', 'TWT', 'PRO'];
}

// ── Cantidad esperada ────────────────────────────────────────────────────
function magnitudNumerica(mag) {
    if (mag == null) return null;
    const n = parseFloat(String(mag).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
}
/** Cantidad esperada de una orden (fila de Ordenes): la columna explícita o la Magnitud numérica. */
function cantidadEsperada(orden) {
    if (orden.CantidadEsperada != null && Number(orden.CantidadEsperada) > 0) return Number(orden.CantidadEsperada);
    return magnitudNumerica(orden.Magnitud);
}

// ── Secuencia de áreas del pedido ────────────────────────────────────────
/**
 * Órdenes hermanas de un pedido (mismo NoDocERP), sin reposiciones ni canceladas ni PRO.
 * Devuelve [{OrdenID, CodigoOrden, AreaID, Estado, EstadoenArea, EstadoLogistica, ProximoServicio, Magnitud, UM, CantidadEsperada, EstadoEnvio, Numero}]
 */
async function getHermanas(noDocERP, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('doc', sql.NChar, String(noDocERP).trim()).query(`
        SELECT o.OrdenID, o.CodigoOrden, o.AreaID, o.Estado, o.EstadoenArea, o.EstadoLogistica, o.ProximoServicio,
               o.Magnitud, o.UM, o.CantidadEsperada, o.EstadoEnvio, o.Cliente, o.DescripcionTrabajo, o.NoDocERP,
               (SELECT MIN(m.Numero) FROM ConfigMapeoERP m WHERE m.AreaID_Interno = o.AreaID) AS Numero
        FROM Ordenes o
        WHERE RTRIM(o.NoDocERP) = RTRIM(@doc)
          AND o.AreaID <> 'PRO'
          AND ISNULL(o.Estado,'') NOT IN ('Cancelado','CANCELADO')
          AND o.CodigoOrden NOT LIKE '%-[FR][0-9]%'
        ORDER BY ISNULL((SELECT MIN(m.Numero) FROM ConfigMapeoERP m WHERE m.AreaID_Interno = o.AreaID), 99), o.OrdenID`);
    return r.recordset;
}

/**
 * Secuencia de áreas del pedido, reconstruida por el "próximo servicio" de las hermanas.
 * Si la cadena no cierra, cae al orden de ConfigMapeoERP.Numero.
 * Devuelve la lista de AreaID en orden (sin DEPOSITO).
 */
function secuenciaAreas(hermanas) {
    const areas = [...new Set(hermanas.map(h => String(h.AreaID).trim()))];
    const next = {};
    hermanas.forEach(h => { const a = String(h.AreaID).trim(); const p = (h.ProximoServicio || '').trim().toUpperCase(); if (p && p !== 'DEPOSITO' && p !== 'LOGISTICA' && areas.includes(p)) next[a] = p; });
    const porNumero = [...new Set([...hermanas].sort((x, y) => (x.Numero ?? 99) - (y.Numero ?? 99)).map(h => String(h.AreaID).trim()))];
    if (Object.keys(next).length === 0) return porNumero; // sin cadena explícita: orden de ConfigMapeoERP (TERMINAC sin Numero va al final)
    const apuntadas = new Set(Object.values(next));
    const inicios = porNumero.filter(a => !apuntadas.has(a));
    const seq = [];
    const visit = (a) => { if (!a || seq.includes(a)) return; seq.push(a); visit(next[a]); };
    inicios.forEach(visit);
    porNumero.forEach(visit); // lo que quedó suelto
    return seq.length === areas.length ? seq : porNumero;
}

/** Áreas anteriores a `areaId` dentro del pedido, de la primera a la inmediata anterior. */
async function areasAnteriores(noDocERP, areaId, conn) {
    const hermanas = await getHermanas(noDocERP, conn);
    const seq = secuenciaAreas(hermanas);
    const i = seq.indexOf(String(areaId).trim().toUpperCase());
    const previas = i > 0 ? seq.slice(0, i) : [];
    return previas.map(a => ({ AreaID: a, ordenes: hermanas.filter(h => String(h.AreaID).trim() === a) }));
}

/**
 * Áreas anteriores a PRO — caso especial: `getHermanas()` excluye a PRO a propósito (es el
 * "pilar" que agrupa el pedido, no un paso más de la secuencia), así que PRO nunca aparece en
 * `seq` y `areasAnteriores(noDocERP, 'PRO')` siempre daría vacío. Para una falla propia en PRO
 * (la prenda ya armada se rompió, no hay repuesto), "anteriores" es la secuencia de producción
 * COMPLETA del pedido — todo lo demás es, por definición, anterior a Producción.
 */
async function areasAnterioresAPro(noDocERP, conn) {
    const hermanas = await getHermanas(noDocERP, conn);
    const seq = secuenciaAreas(hermanas);
    return seq.map(a => ({ AreaID: a, ordenes: hermanas.filter(h => String(h.AreaID).trim() === a) }));
}

// ── Libro por orden ──────────────────────────────────────────────────────
async function getEnviosOrden(ordenId, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('id', sql.Int, ordenId).query(`
        SELECT eo.EnvioOrdenID, eo.EnvioID, e.CodigoRemito, e.AreaOrigenID, e.AreaDestinoID, e.Estado AS EstadoRemito,
               e.FechaSalida, e.FechaLlegada, eo.EsComplemento, eo.CompletaOrden, eo.Cantidad, eo.Unidad,
               eo.MotivoPendiente, eo.Bultos, eo.ReposicionID, eo.OrdenOrigenID, eo.Fecha,
               f.CodigoOrden AS CodigoOrigen
        FROM Logistica_EnvioOrdenes eo
        JOIN Logistica_Envios e ON e.EnvioID = eo.EnvioID
        LEFT JOIN Ordenes f ON f.OrdenID = eo.OrdenOrigenID
        WHERE eo.OrdenID = @id
        ORDER BY eo.Fecha, eo.EnvioOrdenID`);
    return r.recordset;
}

/** Predicado SQL: orden de falla (-F) todavía abierta (no finalizada ni cancelada ni en el canasto de reposiciones). */
const SQL_FALLA_ABIERTA = (alias) => `(ISNULL(${alias}.Estado,'') NOT IN ('Finalizado','Cancelado','CANCELADO')
        AND ISNULL(${alias}.EstadoenArea,'') NOT IN ('Finalizado','Cancelado')
        AND ISNULL(${alias}.EstadoLogistica,'') <> 'Canasto Reposiciones')`;

/**
 * Reposiciones de una orden madre con el estado real de su orden de falla.
 * Incluye las EXPLÍCITAS (tabla Reposiciones) y, si `incluirImplicitas`, las órdenes de falla
 * -F del linaje que no tienen registro (las que crea hoy el control de impresión): así el área
 * siguiente ve "reposición en proceso" también para las fallas de siempre.
 */
async function getReposicionesOrden(ordenId, soloAbiertas, conn, { incluirImplicitas = true } = {}) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('id', sql.Int, ordenId).query(`
        SELECT r.*, f.CodigoOrden AS CodigoFalla, f.Estado AS EstadoFalla, f.EstadoenArea AS EstadoEnAreaFalla,
               f.EstadoLogistica AS EstadoLogisticaFalla, f.Magnitud AS MagnitudFalla, f.UM AS UMFalla, f.AreaID AS AreaFalla,
               f.ArchivosCount AS ArchivosFalla, CAST(0 AS BIT) AS Implicita,
               s.SolicitudID, s.Estado AS EstadoSolicitud, s.Decision, s.Tipo AS TipoSolicitud
        FROM Reposiciones r
        LEFT JOIN Ordenes f ON f.OrdenID = r.OrdenFallaID
        LEFT JOIN SolicitudesInsumo s ON s.ReposicionID = r.ReposicionID
        WHERE r.OrdenMadreID = @id ${soloAbiertas ? `AND r.Estado IN ${ESTADOS_REPO_ABIERTOS}` : ''}
        ORDER BY r.ReposicionID`);
    const explicitas = r.recordset.map(x => ({ ...x, DetallePiezas: parseJson(x.DetallePiezas) }));
    if (!incluirImplicitas) return explicitas;
    const imp = await new sql.Request(pool).input('id', sql.Int, ordenId).query(`
        SELECT h.OrdenID AS OrdenFallaID, h.CodigoOrden AS CodigoFalla, h.Estado AS EstadoFalla, h.EstadoenArea AS EstadoEnAreaFalla,
               h.EstadoLogistica AS EstadoLogisticaFalla, h.Magnitud AS MagnitudFalla, h.UM AS UMFalla, h.AreaID AS AreaFalla,
               h.ArchivosCount AS ArchivosFalla, h.FechaIngreso AS FechaCreacion, h.NoDocERP,
               CASE WHEN ${SQL_FALLA_ABIERTA('h')} THEN 1 ELSE 0 END AS Abierta
        FROM Ordenes m
        JOIN Ordenes h ON (h.OrdenOrigenID = m.OrdenID OR (h.OrdenOrigenID IS NULL AND h.CodigoOrden LIKE m.CodigoOrden + '-F[0-9]%'))
        WHERE m.OrdenID = @id AND h.CodigoOrden LIKE '%-F[0-9]%'
          AND NOT EXISTS (SELECT 1 FROM Reposiciones r2 WHERE r2.OrdenFallaID = h.OrdenID)
        ORDER BY h.OrdenID`);
    const implicitas = imp.recordset
        .filter(x => !soloAbiertas || x.Abierta)
        .map(x => ({
            ReposicionID: null, OrdenMadreID: ordenId, OrdenFallaID: x.OrdenFallaID, OrdenReportaID: ordenId,
            AreaProduce: String(x.AreaFalla || '').trim(), AreaReporta: String(x.AreaFalla || '').trim(),
            Tipo: 'FALLA_PROPIA', OrigenInsumo: 'PROPIO', Estado: x.Abierta ? 'EN_PRODUCCION' : 'CERRADA',
            Cantidad: null, Unidad: x.UMFalla, Motivo: null, Nota: null, ImagenPath: null, ArchivoOrigenID: null, DetallePiezas: null,
            ReposicionAnteriorID: null, FallaID: null, BobinaNuevaID: null, VenOrdenID: null, NoDocERP: x.NoDocERP,
            FechaCreacion: x.FechaCreacion, FechaCierre: null, Implicita: true,
            CodigoFalla: x.CodigoFalla, EstadoFalla: x.EstadoFalla, EstadoEnAreaFalla: x.EstadoEnAreaFalla, EstadoLogisticaFalla: x.EstadoLogisticaFalla,
            MagnitudFalla: x.MagnitudFalla, UMFalla: x.UMFalla, AreaFalla: x.AreaFalla, ArchivosFalla: x.ArchivosFalla,
            SolicitudID: null, EstadoSolicitud: null, Decision: null, TipoSolicitud: null,
        }));
    return [...explicitas, ...implicitas];
}
function parseJson(s) { if (!s) return null; try { return JSON.parse(s); } catch { return null; } }

/** Descripción corta y honesta de dónde está una reposición ("En Rollo · metros a definir"). */
function describirReposicion(rep) {
    if (!rep) return '';
    if (rep.Estado === 'ESPERANDO_INSUMO') return `Esperando insumo del cliente${rep.EstadoSolicitud ? ' · ' + rep.EstadoSolicitud.toLowerCase().replace('_', ' ') : ''}`;
    if (rep.Estado === 'BLOQUEADA') return 'Bloqueada: espera la reposición del área anterior';
    if (rep.Estado === 'CERRADA') return 'Cerrada';
    if (rep.Estado === 'CANCELADA') return 'Cancelada';
    const estado = rep.EstadoEnAreaFalla || rep.EstadoFalla || 'Pendiente';
    const mag = magnitudNumerica(rep.MagnitudFalla);
    const cant = rep.Cantidad != null ? `${Number(rep.Cantidad)} ${String(rep.Unidad || '').trim()}` : (mag ? `${mag} ${String(rep.UMFalla || '').trim()}` : 'cantidad a definir al imprimir y medir');
    return `${rep.AreaProduce} · ${estado} · ${cant}`;
}

/** Libro completo de una orden. */
async function getLibroOrden(ordenId, conn) {
    const pool = conn || await getPool();
    const o = (await new sql.Request(pool).input('id', sql.Int, ordenId).query(`
        SELECT OrdenID, CodigoOrden, NoDocERP, AreaID, Estado, EstadoenArea, EstadoLogistica, ProximoServicio, Magnitud, UM,
               CantidadEsperada, EstadoEnvio, Cliente, DescripcionTrabajo, OrdenOrigenID
        FROM Ordenes WHERE OrdenID = @id`)).recordset[0];
    if (!o) return null;
    const [envios, reposiciones] = await Promise.all([getEnviosOrden(ordenId, conn), getReposicionesOrden(ordenId, false, conn)]);
    const abiertas = reposiciones.filter(r => ['ESPERANDO_INSUMO', 'BLOQUEADA', 'PENDIENTE', 'EN_PRODUCCION', 'ENVIADA'].includes(r.Estado));
    const solicitudesAbiertas = reposiciones.filter(r => r.SolicitudID && r.EstadoSolicitud !== 'RESUELTA');
    const estadoEnvio = o.EstadoEnvio || 'SIN_ENVIAR';
    const ultimoMarcado = envios.some(e => e.CompletaOrden);
    const enviada = envios.reduce((s, e) => s + (e.Cantidad != null ? Number(e.Cantidad) : 0), 0);
    const esperada = cantidadEsperada(o);
    const motivos = [];
    if (estadoEnvio === 'PARCIAL') motivos.push('Envío parcial sin cerrar');
    abiertas.forEach(r => motivos.push(`Reposición ${r.CodigoFalla || '(sin orden todavía)'}: ${describirReposicion(r)}`));
    return {
        orden: o, estadoEnvio, envios, reposiciones, reposicionesAbiertas: abiertas, solicitudesAbiertas,
        ultimoEnvioMarcado: ultimoMarcado, cantidadEsperada: esperada, cantidadEnviada: envios.some(e => e.Cantidad != null) ? enviada : null,
        incompleta: estadoEnvio === 'PARCIAL' || abiertas.length > 0 || solicitudesAbiertas.length > 0,
        motivos,
    };
}

/** Libro de todas las órdenes hermanas de un pedido. */
async function getLibroPedido(noDocERP, conn) {
    const hermanas = await getHermanas(noDocERP, conn);
    const libros = await Promise.all(hermanas.map(h => getLibroOrden(h.OrdenID, conn)));
    return { noDocERP, secuencia: secuenciaAreas(hermanas), ordenes: libros.filter(Boolean) };
}

/**
 * ¿Se puede marcar "este envío completa la orden"? Solo sin reposiciones ni solicitudes abiertas.
 */
async function puedeCompletar(ordenId, conn, { incluirImplicitas = true } = {}) {
    const abiertas = await getReposicionesOrden(ordenId, true, conn, { incluirImplicitas });
    const solicitudes = abiertas.filter(r => r.SolicitudID && r.EstadoSolicitud !== 'RESUELTA');
    return { ok: abiertas.length === 0, reposicionesAbiertas: abiertas, solicitudesAbiertas: solicitudes };
}

/**
 * Lo que le falta a un área de un pedido: por cada orden hermana de un área anterior,
 * qué llegó, si está completa y qué reposiciones siguen abiertas.
 */
// Una fila de "lo que falta": qué se esperaba de la orden h (área areaFila) y qué llegó ya a
// `area`. Extraída de getPendientesParaArea para que getPendientesParaOrden arme las filas
// EXACTAMENTE igual.
async function filaPendiente(h, areaFila, area, conn) {
    const libro = await getLibroOrden(h.OrdenID, conn);
    const recibidos = libro.envios.filter(e => String(e.AreaDestinoID).trim().toUpperCase() === area && /RECIBIDO/i.test(e.EstadoRemito || ''));
    const enCamino = libro.envios.filter(e => String(e.AreaDestinoID).trim().toUpperCase() === area && !/RECIBIDO/i.test(e.EstadoRemito || ''));
    return {
        OrdenID: h.OrdenID, CodigoOrden: h.CodigoOrden, AreaID: areaFila, Estado: h.Estado, EstadoenArea: h.EstadoenArea,
        // A dónde va esta orden: la pantalla lo usa para no mostrar en PRO órdenes que nunca llegan a PRO.
        ProximoServicio: String(h.ProximoServicio || '').trim().toUpperCase() || null,
        DescripcionTrabajo: h.DescripcionTrabajo, UM: h.UM, cantidadEsperada: libro.cantidadEsperada,
        estadoEnvio: libro.estadoEnvio, incompleta: libro.incompleta, motivos: libro.motivos,
        recibido: { envios: recibidos.length, bultos: recibidos.reduce((s, e) => s + (e.Bultos || 0), 0), cantidad: recibidos.some(e => e.Cantidad != null) ? recibidos.reduce((s, e) => s + Number(e.Cantidad || 0), 0) : null, ultimo: recibidos.length ? recibidos[recibidos.length - 1].Fecha : null },
        enCamino: enCamino.map(e => ({ remito: e.CodigoRemito, bultos: e.Bultos, cantidad: e.Cantidad, fecha: e.FechaSalida })),
        reposicionesAbiertas: libro.reposicionesAbiertas.map(r => ({
            ReposicionID: r.ReposicionID, CodigoFalla: r.CodigoFalla, OrdenFallaID: r.OrdenFallaID, AreaProduce: r.AreaProduce, AreaReporta: r.AreaReporta,
            Estado: r.Estado, descripcion: describirReposicion(r), Cantidad: r.Cantidad, Unidad: r.Unidad, MagnitudFalla: r.MagnitudFalla,
            EstadoEnAreaFalla: r.EstadoEnAreaFalla, FechaCreacion: r.FechaCreacion, Motivo: r.Motivo, Tipo: r.Tipo,
        })),
    };
}

async function getPendientesParaArea(noDocERP, areaId, conn) {
    const area = String(areaId).trim().toUpperCase();
    // PRO: ver areasAnterioresAPro — excluida a propósito de la secuencia normal, así que
    // "anteriores" para PRO es la secuencia de producción completa, no un tramo de ella.
    const anteriores = area === 'PRO' ? await areasAnterioresAPro(noDocERP, conn) : await areasAnteriores(noDocERP, area, conn);
    const resultado = [];
    for (const a of anteriores) {
        for (const h of a.ordenes) {
            resultado.push(await filaPendiente(h, a.AreaID, area, conn));
        }
    }
    return { noDocERP, area, anteriores: anteriores.map(a => a.AreaID), ordenes: resultado };
}

/**
 * Órdenes incompletas de un pedido (para el candado de Depósito): envío parcial sin cerrar,
 * reposiciones abiertas o solicitudes abiertas. Excluye PRO, canceladas y las propias -F/-R.
 */
async function ordenesIncompletasPedido(noDocERP, conn) {
    const pool = conn || await getPool();
    const r = await new sql.Request(pool).input('doc', sql.NChar, String(noDocERP).trim()).query(`
        SELECT v.OrdenID, v.CodigoOrden, v.AreaID, v.EstadoEnvio, v.ReposicionesAbiertas, v.SolicitudesAbiertas, v.UltimoEnvioMarcado
        FROM vw_LibroEntregas v
        JOIN Ordenes o ON o.OrdenID = v.OrdenID
        WHERE RTRIM(v.NoDocERP) = RTRIM(@doc)
          AND v.AreaID <> 'PRO'
          AND ISNULL(o.Estado,'') NOT IN ('Cancelado','CANCELADO')
          AND v.CodigoOrden NOT LIKE '%-[FR][0-9]%'
          AND (v.Incompleta = 1 OR v.SolicitudesAbiertas > 0)`);
    const detalle = [];
    for (const row of r.recordset) {
        const libro = await getLibroOrden(row.OrdenID, conn);
        detalle.push({ ...row, motivos: libro.motivos, reposicionesAbiertas: libro.reposicionesAbiertas.map(x => ({ CodigoFalla: x.CodigoFalla, AreaProduce: x.AreaProduce, descripcion: describirReposicion(x) })) });
    }
    return detalle;
}

// ── Escritura ────────────────────────────────────────────────────────────
/**
 * Registra las líneas por orden de un remito y actualiza Ordenes.EstadoEnvio.
 * @param {sql.Transaction} tx
 * @param {number} envioId
 * @param {Array<{ordenId:number, ordenOrigenId?:number, reposicionId?:number, esComplemento?:boolean, completaOrden?:boolean, cantidad?:number, unidad?:string, motivoPendiente?:string, bultos?:number}>} lineas
 * @param {number} usuarioId
 */
async function registrarLineasEnvio(tx, envioId, lineas, usuarioId) {
    for (const l of lineas) {
        await new sql.Request(tx)
            .input('EnvioID', sql.Int, envioId)
            .input('OrdenID', sql.Int, l.ordenId)
            .input('OrdenOrigenID', sql.Int, l.ordenOrigenId || null)
            .input('ReposicionID', sql.Int, l.reposicionId || null)
            .input('EsComplemento', sql.Bit, l.esComplemento ? 1 : 0)
            .input('CompletaOrden', sql.Bit, l.completaOrden ? 1 : 0)
            .input('Cantidad', sql.Decimal(12, 2), l.cantidad != null && l.cantidad !== '' ? Number(l.cantidad) : null)
            .input('Unidad', sql.NChar(10), l.unidad || null)
            .input('MotivoPendiente', sql.VarChar(30), l.completaOrden ? null : (l.motivoPendiente || null))
            .input('Bultos', sql.Int, l.bultos != null ? Number(l.bultos) : null)
            .input('UsuarioID', sql.Int, usuarioId || null)
            .query(`INSERT INTO Logistica_EnvioOrdenes (EnvioID, OrdenID, OrdenOrigenID, ReposicionID, EsComplemento, CompletaOrden, Cantidad, Unidad, MotivoPendiente, Bultos, UsuarioID)
                    VALUES (@EnvioID, @OrdenID, @OrdenOrigenID, @ReposicionID, @EsComplemento, @CompletaOrden, @Cantidad, @Unidad, @MotivoPendiente, @Bultos, @UsuarioID)`);
        await new sql.Request(tx).input('id', sql.Int, l.ordenId).input('e', sql.VarChar(20), l.completaOrden ? 'COMPLETO' : 'PARCIAL')
            .query(`UPDATE Ordenes SET EstadoEnvio = @e WHERE OrdenID = @id`);
        if (l.reposicionId) {
            await new sql.Request(tx).input('r', sql.Int, l.reposicionId)
                .query(`UPDATE Reposiciones SET Estado = 'ENVIADA' WHERE ReposicionID = @r AND Estado IN ('PENDIENTE','EN_PRODUCCION')`);
        }
    }
}

/**
 * [VENTA/COMBO] Lo mismo que getPendientesParaArea, pero mirado desde UNA orden: deja solo las
 * órdenes que de verdad le mandan prendas a ella.
 *
 * getPendientesParaArea ordena las áreas del PEDIDO entero. En un pedido con varias prendas que
 * siguen caminos distintos (combo, o "Comprar y personalizar": el Short va a Bordado; el Gorro
 * va a Bordado → Estampado y su DTF a Estampado) eso mezcla prendas: al Bordado del Short le
 * aparecían el DTF y el Estampado del Gorro como "lo que falta", y encima como áreas ANTERIORES
 * cuando son posteriores (caso BOR-20947).
 *
 * Si la orden pertenece a una prenda (ComboItemID), quedan solo las órdenes de ESA prenda cuyo
 * próximo paso es el área de esta orden. Sin ComboItemID (pedido común) el resultado es
 * idéntico al de getPendientesParaArea.
 */
async function getPendientesParaOrden(ordenId, noDocERP, areaId, conn) {
    const pool = conn || await getPool();
    const o = await new sql.Request(pool).input('id', sql.Int, ordenId)
        .query(`SELECT ComboItemID, UPPER(LTRIM(RTRIM(AreaID))) AS AreaID FROM Ordenes WHERE OrdenID = @id`);
    const orden = o.recordset[0];
    // Pedido común (la orden no pertenece a una prenda separada): igual que siempre.
    if (!orden?.ComboItemID) return getPendientesParaArea(noDocERP, areaId, conn);

    const area = String(areaId).trim().toUpperCase();
    const hermanas = await getHermanas(noDocERP, conn);
    const ids = hermanas.map(h => parseInt(h.OrdenID, 10)).filter(Number.isFinite);
    if (!ids.length) return { noDocERP, area, anteriores: [], ordenes: [] };
    const det = await new sql.Request(pool).query(`
        SELECT OrdenID, ComboItemID, UPPER(LTRIM(RTRIM(ProximoServicio))) AS Prox
        FROM Ordenes WHERE OrdenID IN (${ids.join(',')})
    `);
    const porId = new Map(det.recordset.map(r => [r.OrdenID, r]));
    // Las que le mandan prendas a esta orden: misma prenda y su próximo paso es esta área. No
    // depende del orden general de áreas del pedido (que puede poner Bordado DESPUÉS de
    // Estampado aunque para esta prenda vaya antes).
    const alimentan = hermanas.filter(h => {
        const d = porId.get(h.OrdenID);
        return h.OrdenID !== ordenId && d && d.ComboItemID === orden.ComboItemID && d.Prox === area;
    });
    const seq = secuenciaAreas(hermanas);
    const posicion = (a) => { const i = seq.indexOf(a); return i < 0 ? 999 : i; };
    const areas = [...new Set(alimentan.map(h => String(h.AreaID).trim().toUpperCase()))]
        .sort((x, y) => posicion(x) - posicion(y));
    const ordenes = [];
    for (const a of areas) {
        for (const h of alimentan.filter(x => String(x.AreaID).trim().toUpperCase() === a)) {
            ordenes.push(await filaPendiente(h, a, area, conn));
        }
    }
    return { noDocERP, area, anteriores: areas, ordenes };
}

module.exports = {
    getPendientesParaOrden,
    getConfigLista, getConfigValor, areasConParcial, areasConCadena, areasQueCuentanUnidades, areasFallaPropiaRequiereCadena,
    magnitudNumerica, cantidadEsperada,
    getHermanas, secuenciaAreas, areasAnteriores, areasAnterioresAPro,
    getEnviosOrden, getReposicionesOrden, describirReposicion, getLibroOrden, getLibroPedido,
    puedeCompletar, getPendientesParaArea, ordenesIncompletasPedido,
    registrarLineasEnvio,
};
