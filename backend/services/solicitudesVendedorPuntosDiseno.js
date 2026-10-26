// =====================================================================
// TIEMPOS DE DISEÑO Y FALLAS POR DISEÑO — PUNTOS DE LA BONIFICACIÓN (23/10/2026)
// =====================================================================
// Pedido de la usuaria: a los diseñadores se les bonifica, pero cada diseño que tarda más de 2 días hábiles desde
// que lo TOMAN hasta que lo SUBEN resta 1 punto, y cada falla del pedido por culpa del diseñador resta 1 punto más.
//
//   · Cada diseño = un servicio de la solicitud (SolicitudesVendedorPartes: Principal, Bordado, DTF, TPU), tomado por
//     un diseñador (DisenadorID). Tomado = FechaInicioDiseno; subido = cuando el diseño queda en producción: el
//     diseño pronto en la solicitud (FechaDisenado, pasa a "Diseñado") o, con el pedido ya en planta, la matriz de
//     Bordado / el arte de TPU que se sube en la orden (respuesta de la usuaria, 23/10: "cuando sube el diseño a
//     producción"). La conversión en pedido no cuenta: puede esperar la seña o el pago. Los que hizo TIZADA PRO sola
//     o el vendedor (sin diseñador) no cuentan.
//   · Plazo: vence a los PLAZO_DIAS_HABILES días hábiles de tomado, a la misma hora. Hábil = lunes a viernes que no
//     sea feriado (CalendarioFeriados). Si se toma un sábado, domingo o feriado, el plazo arranca el próximo día
//     hábil a las 0:00. Horas de Uruguay (UTC-3).
//   · Un diseño atrasado resta su punto en el mes en que se SUBE. Los que todavía no se subieron y ya vencieron se
//     muestran como aviso (todavía no restan: restan cuando se suban, sin contarlos dos veces).
//   · Falla de diseño: se marca sobre el servicio de la solicitud, con el motivo. Queda en el historial de la
//     solicitud (SolicitudesVendedorEventos, Tipo FALLA_DISENO; INV-SOL.02: solo se inserta) y resta 1 punto al
//     diseñador del servicio en el mes en que se marca. Si se marcó por error se anula con otro evento
//     (FALLA_DISENO_ANULADA, Texto "#<EventoID> motivo"): la marca original queda en el historial.
//   · Quién: marcan fallas el Admin y los vendedores (rol VENTAS, el jefe de ventas incluido), desde la solicitud
//     (pestaña del producto) o desde esta pestaña de la Bandeja; anula un Admin o quien la marcó. En la Bandeja
//     el Admin ve a todos y un diseñador solo lo suyo.
//   · No calcula la plata de la bonificación: da los puntos que pierde cada uno y por qué.
// =====================================================================
const { sql } = require('../config/db');

const PLAZO_DIAS_HABILES = 2;
const OFFSET_UY_MS = -3 * 3600 * 1000;   // Uruguay: UTC-3 todo el año
const TIPO_FALLA = 'FALLA_DISENO';
const TIPO_FALLA_ANULADA = 'FALLA_DISENO_ANULADA';
const fallo = (status, message) => Object.assign(new Error(message), { status });
const txt = (v, max) => String(v ?? '').trim().slice(0, max);

// Fechas con el reloj de Uruguay: se corre el instante 3 horas y se leen los campos UTC
const aUy = (d) => new Date(d.getTime() + OFFSET_UY_MS);
const deUy = (u) => new Date(u.getTime() - OFFSET_UY_MS);
const diaUy = (u) => u.toISOString().slice(0, 10);

// Cuándo vence un diseño tomado en `tomado` (Date): PLAZO_DIAS_HABILES días hábiles después, a la misma hora
function vencimiento(tomado, feriados) {
    const habil = (u) => { const d = u.getUTCDay(); return d !== 0 && d !== 6 && !feriados.has(diaUy(u)); };
    let u = aUy(tomado);
    if (!habil(u)) {
        do { u = new Date(Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate() + 1)); } while (!habil(u));
    }
    for (let n = 0; n < PLAZO_DIAS_HABILES;) {
        u = new Date(u.getTime() + 86400000);
        if (habil(u)) n += 1;
    }
    return deUy(u);
}

async function feriados(pool) {
    try {
        const r = await pool.request().query('SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Dia FROM dbo.CalendarioFeriados');
        return new Set(r.recordset.map(x => x.Dia));
    } catch (_) {
        return new Set();   // sin la tabla: solo sábados y domingos
    }
}

const mesDe = (q) => {
    const hoy = aUy(new Date());
    const anio = parseInt(q.anio, 10) || hoy.getUTCFullYear();
    const mes = parseInt(q.mes, 10) || hoy.getUTCMonth() + 1;
    if (mes < 1 || mes > 12 || anio < 2020 || anio > 2100) throw fallo(400, 'Elegí un mes válido.');
    const pad = (n) => String(n).padStart(2, '0');
    const desde = `${anio}-${pad(mes)}-01`;
    const hasta = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${pad(mes + 1)}-01`;
    return { anio, mes, desde, hasta, enCurso: anio === hoy.getUTCFullYear() && mes === hoy.getUTCMonth() + 1 };
};

const SELECT_SERVICIO = `
    pa.ParteID, pa.SolicitudID, pa.ProductoSolID, pa.Tipo, pa.Estado, pa.DisenadorID,
    LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(ud.Nombre)), ''), ud.Usuario))) AS Disenador,
    s.NombreTrabajo, LTRIM(RTRIM(c.Nombre)) AS Cliente, p.ProductoNombre, p.PedidoNoDocERP`;
const JOIN_SERVICIO = `
    JOIN dbo.SolicitudesVendedor s          ON s.SolicitudID = pa.SolicitudID
    JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID
    LEFT JOIN dbo.Clientes c  ON c.CodCliente = s.CodCliente
    LEFT JOIN dbo.Usuarios ud ON ud.IdUsuario = pa.DisenadorID`;

// GET /bandeja-diseno/puntos?anio=&mes= — los diseños subidos en el mes (y los que siguen abiertos, en el mes en
// curso), cada uno con su plazo, y las fallas marcadas en el mes; por diseñador, los puntos que pierde.
async function puntos(pool, user, base, q = {}) {
    if (!(await base.esDisenador(pool, user))) throw fallo(403, 'Los tiempos de Diseño los ven los diseñadores y el Admin.');
    const admin = base.esAdmin(user);
    const m = mesDe(q);
    const fer = await feriados(pool);
    const rq = () => {
        const r = pool.request().input('De', sql.Date, m.desde).input('Ha', sql.Date, m.hasta).input('EnCurso', sql.Bit, m.enCurso ? 1 : 0);
        if (!admin) r.input('Yo', sql.Int, user.id);
        return r;
    };
    const soloYo = admin ? '' : 'AND pa.DisenadorID = @Yo';

    // Cuándo quedó el diseño en producción (Subido): el diseño pronto subido en la solicitud (pasa a Diseñado) o, si el
    // pedido ya estaba en planta, el que se sube en la orden: Bordado cuando se sube la matriz (requisito MATRIZ
    // cumplido, ordersController.uploadProductionFile) y TPU cuando la orden pasa a "Diseñado" (HistorialOrdenes).
    const disenos = (await rq().query(`
        ;WITH Planta AS (
            SELECT 'BORDADO' AS Tipo, LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) AS Pedido, MIN(c.FechaCumplimiento) AS Fin
            FROM dbo.Ordenes o
            JOIN dbo.ConfigRequisitosProduccion req ON req.AreaID = 'EMB' AND req.CodigoRequisito = 'MATRIZ'
            JOIN dbo.OrdenCumplimientoRequisitos c ON c.OrdenID = o.OrdenID AND c.RequisitoID = req.RequisitoID AND c.Estado = 'CUMPLIDO'
            WHERE o.AreaID = 'EMB' AND o.NoDocERP IS NOT NULL
            GROUP BY LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
            UNION ALL
            SELECT 'TPU', LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))), MIN(h.FechaInicio)
            FROM dbo.Ordenes o
            JOIN dbo.HistorialOrdenes h ON h.OrdenID = o.OrdenID AND h.Estado = 'Diseñado'
            WHERE o.AreaID = 'TPU' AND o.NoDocERP IS NOT NULL
            GROUP BY LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
        ), D AS (
            SELECT ${SELECT_SERVICIO}, pa.FechaInicioDiseno,
                   CASE WHEN pa.Estado = 'DISENADO' AND pa.FechaDisenado IS NOT NULL THEN pa.FechaDisenado ELSE pl.Fin END AS Subido,
                   CASE WHEN pa.Estado = 'DISENADO' AND pa.FechaDisenado IS NOT NULL THEN 'SOLICITUD' WHEN pl.Fin IS NOT NULL THEN 'ORDEN' END AS SubidoEn
            FROM dbo.SolicitudesVendedorPartes pa
            ${JOIN_SERVICIO}
            LEFT JOIN Planta pl ON pl.Tipo = pa.Tipo AND p.PedidoNoDocERP IS NOT NULL AND pl.Pedido = LTRIM(RTRIM(CAST(p.PedidoNoDocERP AS VARCHAR(50))))
            WHERE pa.Activo = 1 AND p.Activo = 1 AND s.Estado <> 'CANCELADA'
              AND pa.DisenadorID IS NOT NULL AND pa.FechaInicioDiseno IS NOT NULL
              ${soloYo}
        )
        SELECT * FROM D
        WHERE (Subido >= @De AND Subido < @Ha)
           OR (@EnCurso = 1 AND Subido IS NULL AND Estado = 'DISENO_INICIADO')
        ORDER BY FechaInicioDiseno DESC`)).recordset;

    const fallas = (await rq().query(`
        SELECT e.EventoID, e.Texto AS Motivo, e.UsuarioNombre AS MarcadaPor, e.UsuarioID AS MarcadaPorID, e.Fecha, ${SELECT_SERVICIO}
        FROM dbo.SolicitudesVendedorEventos e
        JOIN dbo.SolicitudesVendedorPartes pa ON pa.ParteID = e.ParteID
        ${JOIN_SERVICIO}
        WHERE e.Tipo = '${TIPO_FALLA}' AND e.Fecha >= @De AND e.Fecha < @Ha
          AND NOT EXISTS (SELECT 1 FROM dbo.SolicitudesVendedorEventos a
                          WHERE a.Tipo = '${TIPO_FALLA_ANULADA}' AND a.ParteID = e.ParteID
                            AND a.Texto LIKE '#' + CAST(e.EventoID AS VARCHAR(12)) + ' %')
          ${soloYo}
        ORDER BY e.Fecha DESC`)).recordset;

    const ahora = new Date();
    const filas = disenos.map(x => {
        const vence = vencimiento(new Date(x.FechaInicioDiseno), fer);
        const subido = x.Subido ? new Date(x.Subido) : null;
        const atrasado = subido ? subido > vence : false;
        return {
            parteId: x.ParteID, solicitudId: x.SolicitudID, productoSolId: x.ProductoSolID, servicio: x.Tipo,
            disenadorId: x.DisenadorID, disenador: x.Disenador || `Usuario ${x.DisenadorID}`,
            trabajo: x.NombreTrabajo, cliente: x.Cliente, producto: x.ProductoNombre, pedido: x.PedidoNoDocERP || null,
            tomado: new Date(x.FechaInicioDiseno).toISOString(), vence: vence.toISOString(), subido: subido ? subido.toISOString() : null,
            subidoEn: x.SubidoEn || null,   // 'SOLICITUD' (diseño pronto) | 'ORDEN' (matriz de Bordado / arte de TPU en planta)
            atrasado, vencidoSinSubir: !subido && ahora > vence, puntosMenos: atrasado ? 1 : 0,
        };
    });
    const listaFallas = fallas.map(f => ({
        eventoId: f.EventoID, parteId: f.ParteID, solicitudId: f.SolicitudID, servicio: f.Tipo,
        disenadorId: f.DisenadorID, disenador: f.Disenador || (f.DisenadorID ? `Usuario ${f.DisenadorID}` : 'Sin diseñador'),
        trabajo: f.NombreTrabajo, cliente: f.Cliente, producto: f.ProductoNombre, pedido: f.PedidoNoDocERP || null,
        motivo: f.Motivo, marcadaPor: f.MarcadaPor, marcadaPorId: f.MarcadaPorID, fecha: new Date(f.Fecha).toISOString(), puntosMenos: 1,
    }));

    const porDisenador = new Map();
    const de = (id, nombre) => {
        if (!porDisenador.has(id)) porDisenador.set(id, { disenadorId: id, disenador: nombre, subidos: 0, aTiempo: 0, atrasados: 0, abiertos: 0, vencidosSinSubir: 0, fallas: 0, puntosMenos: 0 });
        return porDisenador.get(id);
    };
    filas.forEach(f => {
        const d = de(f.disenadorId, f.disenador);
        if (f.subido) { d.subidos += 1; if (f.atrasado) d.atrasados += 1; else d.aTiempo += 1; }
        else { d.abiertos += 1; if (f.vencidoSinSubir) d.vencidosSinSubir += 1; }
        d.puntosMenos += f.puntosMenos;
    });
    listaFallas.filter(f => f.disenadorId).forEach(f => { const d = de(f.disenadorId, f.disenador); d.fallas += 1; d.puntosMenos += 1; });

    return {
        anio: m.anio, mes: m.mes, enCurso: m.enCurso, plazoDiasHabiles: PLAZO_DIAS_HABILES, puedeMarcar: base.esVendedor(user), esAdmin: admin, yo: user.id,
        disenadores: [...porDisenador.values()].sort((a, b) => b.puntosMenos - a.puntosMenos || a.disenador.localeCompare(b.disenador, 'es')),
        disenos: filas, fallas: listaFallas,
    };
}

// POST /partes/:parteId/falla-diseno { motivo } — Admin y vendedores (el jefe de ventas incluido: rol VENTAS)
async function marcarFalla(pool, user, base, parteId, b = {}) {
    if (!base.esVendedor(user)) throw fallo(403, 'Las fallas de diseño las marcan los vendedores y los administradores.');
    const motivo = txt(b.motivo, 500);
    if (motivo.length < 5) throw fallo(400, 'Escribí el motivo de la falla (qué salió mal por el diseño).');
    const pa = (await pool.request().input('P', sql.Int, parteId).query(`
        SELECT pa.ParteID, pa.SolicitudID, pa.ProductoSolID, pa.DisenadorID, pa.Activo FROM dbo.SolicitudesVendedorPartes pa WHERE pa.ParteID = @P`)).recordset[0];
    if (!pa || !pa.Activo) throw fallo(404, 'Ese servicio de la solicitud no existe.');
    if (!pa.DisenadorID) throw fallo(409, 'Ese servicio no lo tomó ningún diseñador: la falla no se le puede atribuir a nadie.');
    const eventoId = await base.registrarEvento(pool, user, { solicitudId: pa.SolicitudID, productoSolId: pa.ProductoSolID, parteId: pa.ParteID, tipo: TIPO_FALLA, texto: motivo });
    return { eventoId };
}

// POST /fallas-diseno/:eventoId/anular { motivo } — un Admin o quien la marcó. La marca queda en el historial; se agrega
// la anulación.
async function anularFalla(pool, user, base, eventoId, b = {}) {
    const motivo = txt(b.motivo, 400);
    if (motivo.length < 3) throw fallo(400, 'Escribí por qué se anula la falla.');
    const ev = (await pool.request().input('E', sql.Int, eventoId).query(`
        SELECT e.EventoID, e.SolicitudID, e.ProductoSolID, e.ParteID, e.UsuarioID,
               (SELECT COUNT(*) FROM dbo.SolicitudesVendedorEventos a
                WHERE a.Tipo = '${TIPO_FALLA_ANULADA}' AND a.ParteID = e.ParteID AND a.Texto LIKE '#' + CAST(e.EventoID AS VARCHAR(12)) + ' %') AS Anulada
        FROM dbo.SolicitudesVendedorEventos e WHERE e.EventoID = @E AND e.Tipo = '${TIPO_FALLA}'`)).recordset[0];
    if (!ev) throw fallo(404, 'Esa falla de diseño no existe.');
    if (!base.esAdmin(user) && Number(ev.UsuarioID) !== Number(user.id)) throw fallo(403, 'La anula un administrador o quien la marcó.');
    if (ev.Anulada) throw fallo(409, 'Esa falla ya estaba anulada.');
    await base.registrarEvento(pool, user, { solicitudId: ev.SolicitudID, productoSolId: ev.ProductoSolID, parteId: ev.ParteID, tipo: TIPO_FALLA_ANULADA, texto: `#${ev.EventoID} ${motivo}` });
    return { eventoId: ev.EventoID, anulada: true };
}

module.exports = { puntos, marcarFalla, anularFalla, _vencimiento: vencimiento };
