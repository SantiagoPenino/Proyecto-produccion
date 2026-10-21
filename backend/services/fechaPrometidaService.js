// =============================================================================
// Servicio único para poner las DOS fechas de una orden nueva, en este orden
// (pedido explícito del usuario 8-sep-2026):
//
//   1) FechaEstimadaEntrega — el PLAN fijo del área (ej. "DTF = 2 días"),
//      vía sp_CalcularFechaEntrega. No mira carga de trabajo, solo el
//      horario laboral y los feriados (ya corregido para no caer en
//      fin de semana en el caso "mismo día").
//
//   2) FechaCompromiso — la promesa REAL, mirando la agenda/cola de ese
//      área (cuánto trabajo hay adelante, capacidad diaria real). Puede
//      ser más larga que el plan si hay volumen (ej. plan 2 días, pero
//      con la cola llena la agenda da 3 o 4). NUNCA es más corta que el
//      plan, aunque la cola esté vacía — eso es una regla de negocio
//      confirmada por el usuario, no un límite técnico del motor de agenda.
//
// Si el área todavía no tiene la velocidad de sus máquinas cargada en
// Configuración → Equipos (hoy: Impresión Directa, Corte, Costura), el motor
// de agenda no puede proyectar nada — en ese caso FechaCompromiso queda
// igual al plan (FechaEstimadaEntrega), nunca vacía.
//
// Se llama UNA vez por orden, recién creada, desde cualquier punto de alta
// (portal, sync con el ERP, formulario interno, tienda, WMS, prendas...).
// No hace nada si la orden no existe.
//
// [DÍAS DE ENTREGA DEL PRODUCTO] (21-oct-2026) Si el producto del pedido trae sus
// días de entrega (Configurar Productos › Tiempo de entrega), el plan fijo es ESE:
// N días hábiles desde el ingreso. Si no, el plan sale del SP como siempre. El paso
// 2 (agenda) no cambia: puede correr la fecha, nunca adelantarla.
// =============================================================================
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const { calcularFechaCompromiso } = require('../controllers/planificacionController');

// ¿Ya se corrió docs/migrations/configurador_dias_entrega.sql? Sin la columna, todo sigue como antes.
let _tieneDiasEntrega = null;
async function tieneDiasEntrega(poolOrTx) {
    if (_tieneDiasEntrega === null) {
        const r = await new sql.Request(poolOrTx).query(`SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'DiasEntrega') AS c`);
        _tieneDiasEntrega = r.recordset[0].c != null;
    }
    return _tieneDiasEntrega;
}

// Días de entrega del producto del pedido: el de la propia orden o el de otra orden del mismo pedido
// (la madre PRO lleva el producto; Bordado, Estampado, etc. llevan sus propios artículos).
// `propio` = lo trae el producto de ESTA orden (es la que reparte la fecha a las demás del pedido).
async function diasEntregaDelPedido(poolOrTx, ordenId) {
    if (!(await tieneDiasEntrega(poolOrTx))) return null;
    const r = await new sql.Request(poolOrTx).input('OrdenID', sql.Int, ordenId).query(`
        SELECT MAX(vc.DiasEntrega) AS Dias,
               MAX(CASE WHEN o2.OrdenID = o.OrdenID THEN vc.DiasEntrega END) AS DiasPropios,
               MAX(LTRIM(RTRIM(o.NoDocERP))) AS NoDocERP
        FROM dbo.Ordenes o
        JOIN dbo.Ordenes o2 ON o2.OrdenID = o.OrdenID
            OR (LTRIM(RTRIM(ISNULL(o.NoDocERP, ''))) <> '' AND o2.NoDocERP = o.NoDocERP)
        JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = o2.ProIdProducto
        WHERE o.OrdenID = @OrdenID AND vc.DiasEntrega > 0`);
    const f = r.recordset[0];
    return f && f.Dias > 0 ? { dias: f.Dias, propio: f.DiasPropios > 0, noDocERP: f.NoDocERP } : null;
}

// Plan fijo = ingreso + N días hábiles, con el MISMO calendario que sp_CalcularFechaEntrega: si
// ingresó a la hora de corte (CORTEURGENTE) o después, se cuenta desde el día siguiente; cada día
// sumado salta feriados (CalendarioFeriados) y días sin horario laboral del área (ConfigHorarioLaboral;
// sin horario cargado, lunes a viernes). Las fechas se manejan como 'YYYY-MM-DD' para no depender
// del huso horario. Guarda FechaEstimadaEntrega y la devuelve como la devuelve el SP.
async function planPorDiasHabiles(poolOrTx, ordenId, dias) {
    const r = await new sql.Request(poolOrTx).input('OrdenID', sql.Int, ordenId).query(`
        SELECT o.AreaID,
               CONVERT(CHAR(10), ISNULL(o.FechaIngreso, GETDATE()), 23) AS Dia,
               DATEPART(HOUR, ISNULL(o.FechaIngreso, GETDATE())) AS Hora,
               (SELECT TOP 1 Valor FROM dbo.ConfiguracionGlobal
                 WHERE Clave = 'CORTEURGENTE' AND (AreaID = o.AreaID OR AreaID = 'ADMIN')
                 ORDER BY CASE WHEN AreaID = o.AreaID THEN 1 ELSE 2 END) AS Corte
        FROM dbo.Ordenes o WHERE o.OrdenID = @OrdenID`);
    const o = r.recordset[0];
    if (!o) return null;
    // Una consulta por vez: dentro de una transacción no se pueden correr dos en paralelo
    const cal = await new sql.Request(poolOrTx).input('A', sql.VarChar(20), o.AreaID)
        .query('SELECT DISTINCT DiaSemana FROM dbo.ConfigHorarioLaboral WHERE AreaID = @A AND Activo = 1');
    const fer = await new sql.Request(poolOrTx).input('D', sql.VarChar(10), o.Dia)
        .query('SELECT CONVERT(CHAR(10), Fecha, 23) AS F FROM dbo.CalendarioFeriados WHERE Fecha >= @D AND Fecha < DATEADD(DAY, 800, @D)');
    const diasLaborables = new Set(cal.recordset.map(x => Number(x.DiaSemana)));
    const feriados = new Set(fer.recordset.map(x => x.F));
    const diaIso = (s) => ((new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;   // 1=Lunes..7=Domingo
    const siguiente = (s) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
    const habil = (s) => !feriados.has(s) && (diasLaborables.size ? diasLaborables.has(diaIso(s)) : diaIso(s) <= 5);
    const corte = parseInt(String(o.Corte || '12:00').split(':')[0], 10);
    let fecha = o.Hora >= (Number.isFinite(corte) ? corte : 12) ? siguiente(o.Dia) : o.Dia;
    const saltarNoHabiles = () => { for (let i = 0; !habil(fecha) && i < 60; i++) fecha = siguiente(fecha); };
    for (let n = 0; n < dias; n++) { fecha = siguiente(fecha); saltarNoHabiles(); }
    saltarNoHabiles();   // mismo ajuste final que el SP
    await new sql.Request(poolOrTx).input('OrdenID', sql.Int, ordenId).input('F', sql.VarChar(10), fecha)
        .query('UPDATE dbo.Ordenes SET FechaEstimadaEntrega = CAST(@F AS DATETIME) WHERE OrdenID = @OrdenID');
    return new Date(`${fecha}T00:00:00Z`);
}

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {number} ordenId
 * @param {{ repartir?: boolean }} [opciones] repartir=false: no recalcula las demás órdenes del pedido
 * @returns {Promise<{ fechaEstimadaEntrega: Date|null, fechaCompromiso: Date|null }>}
 */
async function calcularFechasOrden(poolOrTx, ordenId, { repartir = true } = {}) {
    try {
        // 1) Plan fijo — siempre corre primero, para todas las áreas. Con días de entrega en el
        //    producto del pedido, son esos días hábiles; si no, el plan del área (SP).
        let producto = null;
        try { producto = await diasEntregaDelPedido(poolOrTx, ordenId); }
        catch (e) { logger.warn(`[FECHA-PROMETIDA] días de entrega del producto (OrdenID ${ordenId}): ${e.message}`); }
        let fechaEstimadaEntrega;
        if (producto) {
            fechaEstimadaEntrega = await planPorDiasHabiles(poolOrTx, ordenId, producto.dias);
        } else {
            const r1 = await new sql.Request(poolOrTx).input('OrdenID', sql.Int, ordenId).execute('sp_CalcularFechaEntrega');
            fechaEstimadaEntrega = r1.recordset?.[0]?.NuevaFechaEntrega ? new Date(r1.recordset[0].NuevaFechaEntrega) : null;
        }

        // 2) Datos de la orden para poder simular la cola.
        const rOrden = await new sql.Request(poolOrTx).input('OrdenID', sql.Int, ordenId).query(`
            SELECT AreaID, Prioridad, TRY_CAST(Magnitud AS DECIMAL(18,2)) AS Magnitud
            FROM dbo.Ordenes WHERE OrdenID = @OrdenID`);
        const orden = rOrden.recordset[0];
        if (!orden) return { fechaEstimadaEntrega, fechaCompromiso: fechaEstimadaEntrega };

        // Colchón de días antes de empezar a consumir capacidad (hoy solo tiene sentido
        // configurado para Bordado — preparación de matriz; el resto usa 0, ver comentario
        // arriba de calcularFechaCompromiso en planificacionController.js).
        let diasColchon = 0;
        if (orden.AreaID === 'EMB') {
            const conf = await new sql.Request(poolOrTx).query(
                "SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'EMB_DIAS_PREPARACION_MATRIZ'");
            diasColchon = conf.recordset.length ? (parseInt(conf.recordset[0].Valor, 10) || 0) : 0;
        }

        // 3) Motor de agenda: proyección real según la cola actual del área.
        //    calcularFechaCompromiso necesita el pool "de verdad" (hace varias queries propias
        //    en paralelo); si nos pasaron una transacción, usamos su .parent (mismo pool).
        const poolReal = poolOrTx.parent || poolOrTx;
        const [proyectadaStr] = await calcularFechaCompromiso(
            poolReal, orden.AreaID, [{ magnitud: orden.Magnitud || 0, prioridad: orden.Prioridad }], diasColchon);

        // 4) FechaCompromiso = lo que dé la agenda, pero NUNCA antes que el plan (regla de
        //    negocio confirmada 8-sep-2026). Sin proyección posible (área sin capacidad
        //    cargada) → igual al plan.
        let fechaCompromiso = fechaEstimadaEntrega;
        if (proyectadaStr) {
            const proyectada = new Date(proyectadaStr + 'T00:00:00');
            if (!fechaEstimadaEntrega || proyectada > fechaEstimadaEntrega) fechaCompromiso = proyectada;
        }

        await new sql.Request(poolOrTx)
            .input('OrdenID', sql.Int, ordenId)
            .input('Fecha', sql.DateTime, fechaCompromiso)
            .query('UPDATE dbo.Ordenes SET FechaCompromiso = @Fecha WHERE OrdenID = @OrdenID');

        // 5) [DÍAS DE ENTREGA DEL PRODUCTO] La orden que trae el producto reparte el plan a las del
        //    mismo pedido que se crearon antes que ella (el alta las crea en el orden del proceso y la
        //    madre PRO suele ir después): sin esto, esas quedaban con el plan del área. Solo las del
        //    MISMO alta (ingresadas hasta 10 minutos antes): una orden vieja del pedido no se toca.
        //    Las que se creen después la encuentran solas (paso 1).
        if (repartir && producto?.propio && producto.noDocERP) {
            const otras = await new sql.Request(poolOrTx).input('OrdenID', sql.Int, ordenId).query(`
                SELECT o2.OrdenID FROM dbo.Ordenes o
                JOIN dbo.Ordenes o2 ON o2.NoDocERP = o.NoDocERP AND o2.OrdenID <> o.OrdenID
                WHERE o.OrdenID = @OrdenID
                  AND o2.FechaIngreso >= DATEADD(MINUTE, -10, ISNULL(o.FechaIngreso, GETDATE()))`);
            for (const x of otras.recordset) await calcularFechasOrden(poolOrTx, x.OrdenID, { repartir: false });
        }

        return { fechaEstimadaEntrega, fechaCompromiso };
    } catch (err) {
        logger.error(`[FECHA-PROMETIDA] calcularFechasOrden falló para OrdenID ${ordenId}: ${err.message}`);
        return { fechaEstimadaEntrega: null, fechaCompromiso: null };
    }
}

module.exports = { calcularFechasOrden, tieneDiasEntrega };
