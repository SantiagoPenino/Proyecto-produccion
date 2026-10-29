// =============================================================================
// Fechas de una orden y de su pedido (29/10/2026) — pestaña «Fechas» del detalle
// de la orden (el ojito). Para ver por dónde va el pedido y si está atrasado.
//
// Solo lee. No guarda nada.
//
//   Ingreso      Ordenes.FechaIngreso
//   Plan         Ordenes.FechaEstimadaEntrega: el plan fijo del área (o los días
//                de entrega del producto) — services/fechaPrometidaService.js
//   Comprometida Ordenes.FechaCompromiso: el plan corrido por la cola del área,
//                nunca antes que el plan. ES CONTRA LA QUE SE MIDE EL ATRASO
//                (si falta, contra el plan).
//   Impresa      Ordenes.FechaImpreso
//   Pronta       Ordenes.FechaPronto. Si la orden quedó Finalizado sin FechaPronto,
//                la primera vez que el historial la marcó Pronto o Finalizado.
//   Cliente      SolicitudesVendedor.FechaEntrega / FechaEntregaHasta: la fecha que
//                necesita el cliente. Solo existe si el pedido salió de una Solicitud;
//                NO se copia a Ordenes, se lee por SolicitudesVendedorProductos.PedidoNoDocERP.
//   Depósito     OrdenesDeposito: llegó, avisado al cliente, estado actual.
//
// Cada orden del pedido calcula sus fechas desde el MISMO ingreso, no una detrás de
// otra. La fecha final del pedido es la comprometida más tarde de sus órdenes; las
// órdenes de falla (-F) se muestran pero no la mueven.
//
// El atraso se cuenta en días hábiles del área (horario laboral + feriados,
// utils/horarioLaboral.js). Las fechas sin hora (plan, comprometida, cliente) se
// pasan como 'AAAA-MM-DD' desde el SQL para que el huso horario no las corra un día;
// los instantes (ingreso, pronta...) viajan como Date y el día se toma en hora de Uruguay.
// =============================================================================
const { sql } = require('../config/db');
const { obtenerCalendario, UY_MS } = require('../utils/horarioLaboral');

const DIA_MS = 24 * 3600000;
const norm = (a) => String(a || '').trim().toUpperCase();
const diaUY = (f) => (f ? new Date(new Date(f).getTime() - UY_MS).toISOString().slice(0, 10) : null);
const sumarDia = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
const inicioDiaUY = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) + UY_MS;
};
const esHabil = (cal, area, iso) => cal.tramos(area, inicioDiaUY(iso), inicioDiaUY(iso) + DIA_MS).length > 0;

// Días hábiles d con desde < d <= hasta (tope de un año, por las dudas).
function diasHabilesEntre(cal, area, desde, hasta) {
    let n = 0;
    for (let d = sumarDia(desde), i = 0; d <= hasta && i < 400; d = sumarDia(d), i++) if (esHabil(cal, area, d)) n++;
    return n;
}
function proximoHabil(cal, area, iso) {
    let d = sumarDia(iso);
    for (let i = 0; !esHabil(cal, area, d) && i < 60; i++) d = sumarDia(d);
    return d;
}

/**
 * Semáforo de una fecha límite.
 * Abierta:   A_TIEMPO (dias = hábiles que faltan) · VENCE_MANANA · VENCE_HOY · ATRASADA (dias = hábiles de atraso;
 *            0 = venció pero desde entonces no hubo día hábil).
 * Terminada: TERMINO_A_TIEMPO · TERMINO_TARDE (dias) · TERMINADA (no se sabe cuándo).
 * Sin límite: SIN_FECHA.
 */
function semaforo(cal, area, { limite, terminada, fin, hoy }) {
    if (!limite) return { estado: 'SIN_FECHA' };
    if (terminada) {
        if (!fin) return { estado: 'TERMINADA' };
        if (fin <= limite) return { estado: 'TERMINO_A_TIEMPO' };
        return { estado: 'TERMINO_TARDE', dias: diasHabilesEntre(cal, area, limite, fin) };
    }
    if (hoy > limite) return { estado: 'ATRASADA', dias: diasHabilesEntre(cal, area, limite, hoy) };
    if (hoy === limite) return { estado: 'VENCE_HOY' };
    if (limite <= proximoHabil(cal, area, hoy)) return { estado: 'VENCE_MANANA' };
    return { estado: 'A_TIEMPO', dias: diasHabilesEntre(cal, area, hoy, limite) };
}

// Orden del recorrido: cada área va después de la que la tiene como ProximoServicio (la más
// larga de las cadenas: DTF corre en paralelo a Sublimación → Corte → Costura y entra antes de PRO).
function ordenarPorRuta(ordenes) {
    const areas = [...new Set(ordenes.map(o => norm(o.AreaID)))];
    const siguiente = ordenes
        .filter(o => !o.esFalla && o.Estado !== 'Cancelado' && norm(o.ProximoServicio))
        .map(o => [norm(o.AreaID), norm(o.ProximoServicio)]);
    const nivel = new Map(areas.map(a => [a, 0]));
    for (let i = 0; i < areas.length; i++) {
        for (const [a, b] of siguiente) {
            if (nivel.has(b) && a !== b && nivel.get(b) < nivel.get(a) + 1) nivel.set(b, Math.min(nivel.get(a) + 1, areas.length));
        }
    }
    return [...ordenes].sort((x, y) =>
        nivel.get(norm(x.AreaID)) - nivel.get(norm(y.AreaID)) || (x.esFalla - y.esFalla) || x.OrdenID - y.OrdenID);
}

const COLUMNAS_ORDEN = `
    o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden, LTRIM(RTRIM(o.AreaID)) AS AreaID, a.Nombre AS AreaNombre,
    o.Estado, o.EstadoenArea, o.Prioridad, LTRIM(RTRIM(ISNULL(o.ProximoServicio, ''))) AS ProximoServicio,
    LTRIM(RTRIM(ISNULL(o.NoDocERP, ''))) AS NoDocERP,
    o.FechaIngreso, o.FechaImpreso, o.FechaPronto, o.FechaAprobacionCliente, o.FechaRechazoCliente,
    CONVERT(char(10), o.FechaEstimadaEntrega, 23) AS FechaPlan,
    CONVERT(char(10), o.FechaCompromiso, 23) AS FechaCompromiso,
    CAST(CASE WHEN o.Prioridad = 'Falla' OR o.CodigoOrden LIKE '%-F%' THEN 1 ELSE 0 END AS bit) AS EsFalla,
    fin.FinHistorial`;
// Finalizada sin FechaPronto (pasa: ~5 % de las finalizadas): el historial dice cuándo.
const JOINS_ORDEN = `
    LEFT JOIN dbo.Areas a ON a.AreaID = o.AreaID
    OUTER APPLY (SELECT MIN(h.FechaInicio) AS FinHistorial FROM dbo.HistorialOrdenes h
                 WHERE h.OrdenID = o.OrdenID AND h.Estado IN ('Pronto', 'Finalizado')
                   AND o.FechaPronto IS NULL AND o.Estado = 'Finalizado') fin`;

function filaOrden(cal, o, hoy) {
    const cancelada = o.Estado === 'Cancelado';
    const terminada = !cancelada && (!!o.FechaPronto || o.Estado === 'Finalizado');
    const pronto = o.FechaPronto || o.FinHistorial || null;
    const limite = o.FechaCompromiso || o.FechaPlan || null;
    return {
        OrdenID: o.OrdenID,
        CodigoOrden: o.CodigoOrden,
        AreaID: o.AreaID,
        AreaNombre: o.AreaNombre || o.AreaID,
        Estado: o.Estado,
        EstadoenArea: o.EstadoenArea,
        Prioridad: o.Prioridad,
        ProximoServicio: o.ProximoServicio,
        esFalla: !!o.EsFalla,
        cancelada,
        terminada,
        ingreso: o.FechaIngreso,
        plan: o.FechaPlan,
        compromiso: o.FechaCompromiso,
        impreso: o.FechaImpreso,
        pronto,
        prontoSegunHistorial: !o.FechaPronto && !!o.FinHistorial,
        aprobacionCliente: o.FechaAprobacionCliente,
        rechazoCliente: o.FechaRechazoCliente,
        limite,
        semaforo: cancelada ? { estado: 'CANCELADA' } : semaforo(cal, o.AreaID, { limite, terminada, fin: diaUY(pronto), hoy }),
    };
}

// Fecha que necesita el cliente, si el pedido salió de una Solicitud del vendedor.
async function fechaDelCliente(pool, noDocERP) {
    const c = await pool.request().query(`SELECT COL_LENGTH('dbo.SolicitudesVendedor', 'FechaEntrega') AS fe,
        COL_LENGTH('dbo.SolicitudesVendedor', 'FechaEntregaHasta') AS feh,
        COL_LENGTH('dbo.SolicitudesVendedorProductos', 'PedidoNoDocERP') AS doc`);
    const col = c.recordset[0];
    if (col.fe == null || col.doc == null) return null;
    const r = await pool.request().input('Doc', sql.VarChar(50), noDocERP).query(`
        SELECT TOP 1 s.SolicitudID, CONVERT(char(10), s.FechaEntrega, 23) AS Desde,
               ${col.feh != null ? 'CONVERT(char(10), s.FechaEntregaHasta, 23)' : 'NULL'} AS Hasta
        FROM dbo.SolicitudesVendedorProductos p
        JOIN dbo.SolicitudesVendedor s ON s.SolicitudID = p.SolicitudID
        WHERE LTRIM(RTRIM(CAST(p.PedidoNoDocERP AS varchar(50)))) = @Doc AND s.FechaEntrega IS NOT NULL
        ORDER BY s.SolicitudID DESC`);
    return r.recordset[0] || null;
}

/**
 * @returns {Promise<null | { hoy, orden, pedido }>} null si la orden no existe.
 *   pedido (solo con NoDocERP): { noDocERP, fechaFinal, areaFinal, terminado, semaforo, ordenes[], deposito[], cliente }
 */
async function fechasDeOrden(pool, ordenId) {
    const cal = await obtenerCalendario(pool);
    const hoy = diaUY(Date.now());

    const r = await pool.request().input('ID', sql.Int, ordenId).query(`
        SELECT ${COLUMNAS_ORDEN} FROM dbo.Ordenes o ${JOINS_ORDEN} WHERE o.OrdenID = @ID`);
    const actual = r.recordset[0];
    if (!actual) return null;
    const orden = filaOrden(cal, actual, hoy);
    if (!actual.NoDocERP) return { hoy, orden, pedido: null };

    const rp = await pool.request().input('Doc', sql.VarChar(50), actual.NoDocERP).query(`
        SELECT ${COLUMNAS_ORDEN} FROM dbo.Ordenes o ${JOINS_ORDEN}
        WHERE LTRIM(RTRIM(o.NoDocERP)) = @Doc`);
    const ordenes = ordenarPorRuta(rp.recordset.map(o => ({ ...o, esFalla: !!o.EsFalla })))
        .map(o => filaOrden(cal, o, hoy));

    // Las que cuentan para el pedido: ni canceladas ni de falla.
    const base = ordenes.filter(o => !o.cancelada && !o.esFalla);
    const conLimite = base.filter(o => o.limite);
    const ultima = conLimite.reduce((m, o) => (!m || o.limite >= m.limite ? o : m), null);
    const terminado = base.length > 0 && base.every(o => o.terminada);
    const finPedido = terminado ? base.map(o => diaUY(o.pronto)).filter(Boolean).sort().pop() || null : null;

    const codigos = ordenes.map(o => o.CodigoOrden).filter(Boolean);
    let deposito = [];
    if (codigos.length) {
        const rd = pool.request();
        codigos.forEach((c, i) => rd.input(`c${i}`, sql.VarChar(60), c));
        deposito = (await rd.query(`
            SELECT LTRIM(RTRIM(od.OrdCodigoOrden)) AS CodigoOrden, od.OrdFechaIngresoOrden AS Llego,
                   od.OrdFechaAvisoWsp AS Avisado, od.OrdFechaEstadoActual AS FechaEstado,
                   COALESCE(LTRIM(RTRIM(eo.EOrNombreEstado)), CAST(od.OrdEstadoActual AS varchar(20))) AS Estado
            FROM dbo.OrdenesDeposito od
            LEFT JOIN dbo.EstadosOrdenes eo ON eo.EOrIdEstadoOrden = od.OrdEstadoActual
            WHERE LTRIM(RTRIM(od.OrdCodigoOrden)) IN (${codigos.map((_, i) => `@c${i}`).join(',')})
            ORDER BY od.OrdFechaIngresoOrden`)).recordset;
    }

    const cliente = await fechaDelCliente(pool, actual.NoDocERP);
    const limiteCliente = cliente ? (cliente.Hasta || cliente.Desde) : null;
    const areaFinal = ultima ? ultima.AreaID : actual.AreaID;

    return {
        hoy,
        orden,
        pedido: {
            noDocERP: actual.NoDocERP,
            fechaFinal: ultima ? ultima.limite : null,
            areaFinal,
            terminado,
            fin: finPedido,
            semaforo: semaforo(cal, areaFinal, { limite: ultima ? ultima.limite : null, terminada: terminado, fin: finPedido, hoy }),
            ordenes,
            deposito,
            cliente: cliente ? {
                ...cliente,
                // Hábiles que la fecha final queda DESPUÉS de lo que pidió el cliente (0 = llega).
                diasDespues: ultima && limiteCliente && ultima.limite > limiteCliente
                    ? Math.max(1, diasHabilesEntre(cal, areaFinal, limiteCliente, ultima.limite)) : 0,
            } : null,
        },
    };
}

module.exports = { fechasDeOrden, semaforo, ordenarPorRuta, diasHabilesEntre };
