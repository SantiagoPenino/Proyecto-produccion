const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// ISO: 1=Lunes ... 7=Domingo — mismo criterio que usa sp_CalcularFechaEntrega.
// Genera la lista de fechas del rango a partir de strings 'YYYY-MM-DD', sin pasar por
// Date() con valores que vengan de la base (para no pisar el problema de zona horaria de
// src/utils/fechas.js: acá las fechas del calendario las generamos nosotros, no las leemos).
function generarDias(desdeStr, hastaStr) {
    const dias = [];
    let [y, m, d] = desdeStr.split('-').map(Number);
    const [yh, mh, dh] = hastaStr.split('-').map(Number);
    let cursor = Date.UTC(y, m - 1, d);
    const fin = Date.UTC(yh, mh - 1, dh);
    while (cursor <= fin) {
        const fecha = new Date(cursor);
        const yyyy = fecha.getUTCFullYear();
        const mm = String(fecha.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(fecha.getUTCDate()).padStart(2, '0');
        const fechaStr = `${yyyy}-${mm}-${dd}`;
        const diaSemanaISO = ((fecha.getUTCDay() + 6) % 7) + 1; // getUTCDay: 0=Domingo..6=Sábado -> ISO 1=Lunes..7=Domingo
        dias.push({ fecha: fechaStr, diaSemanaISO });
        cursor += 86400000;
    }
    return dias;
}

function addDiasStr(fechaStr, dias) {
    const [y, m, d] = fechaStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + dias);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Horas decimales entre dos 'HH:MM'. Si HoraFin <= HoraInicio se asume que el turno cruza
// medianoche (ej. T2 17:00-02:00).
function horasEntre(horaInicioStr, horaFinStr) {
    const [hi, mi] = horaInicioStr.split(':').map(Number);
    const [hf, mf] = horaFinStr.split(':').map(Number);
    let minutos = (hf * 60 + mf) - (hi * 60 + mi);
    if (minutos <= 0) minutos += 24 * 60;
    return minutos / 60;
}

const NOMBRES_DIA = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes', 6: 'Sábado', 7: 'Domingo' };

// Prioridad de asignación, en este orden:
//   0) en_maquina       — YA iniciada, la máquina está físicamente ocupada con ella ahora mismo
//                         (pedido explícito del usuario 27-ago-2026: "una orden ya iniciada que
//                         no esté en estado pendiente, no puede ser desplazada por ninguna otra")
//   1) urgente_atrasado — Urgente que ingresó ANTES de hoy y sigue sin producir
//   2) urgente_hoy      — Urgente que ingresó HOY antes de las 12 (mismo corte que CORTEURGENTE)
//   3) pendiente        — el resto (Urgente ingresado hoy después de las 12 + todo lo Normal),
//                         por fecha de ingreso
//   (pedido explícito del usuario 13-ago-2026 para los grupos 1-3)
const GRUPOS = ['en_maquina', 'urgente_atrasado', 'urgente_hoy', 'pendiente'];
const GRUPO_LABEL = { en_maquina: 'En máquina', urgente_atrasado: 'Urgente atrasado', urgente_hoy: 'Urgente de hoy', pendiente: 'Pendiente' };

function grupoDe(orden, hoyStr) {
    if (orden.EstadoenArea === 'En Maquina') return 'en_maquina';
    if (orden.Prioridad === 'Urgente' && orden.FechaIngreso < hoyStr) return 'urgente_atrasado';
    if (orden.Prioridad === 'Urgente' && orden.FechaIngreso === hoyStr && orden.HoraIngreso < 12) return 'urgente_hoy';
    return 'pendiente';
}

// Semáforo: compara el día en que la simulación de capacidad dice que se va a producir contra
// la FechaEstimadaEntrega (la promesa fija al cliente, ver sp_CalcularFechaEntrega). No mide si
// la orden en sí está urgente — mide si el plan de producción cumple lo prometido.
function semaforoDe(diaProyectado, fechaPrometida) {
    if (!fechaPrometida) return null;
    if (diaProyectado > fechaPrometida) return 'rojo';    // se produce DESPUÉS de lo prometido
    if (diaProyectado === fechaPrometida) return 'amarillo'; // justo en el límite, sin margen
    return 'verde';                                        // se produce con margen
}
const PESO_SEMAFORO = { rojo: 2, amarillo: 1, verde: 0 };
function peorSemaforo(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return PESO_SEMAFORO[a] >= PESO_SEMAFORO[b] ? a : b;
}

// Agenda de un área: por cada día del rango, si es laborable (según ConfigHorarioLaboral,
// con el mismo fallback Lunes-Viernes que usa sp_CalcularFechaEntrega si el área no tiene
// horario cargado) y qué órdenes tienen FechaEstimadaEntrega ese día.
exports.getAgenda = async (req, res) => {
    const { area } = req.query;
    let { desde, hasta } = req.query;
    if (!area) return res.status(400).json({ error: "Falta el parámetro 'area'." });

    const hoy = new Date();
    if (!desde) desde = hoy.toISOString().slice(0, 10);
    if (!hasta) {
        const h = new Date(desde + 'T00:00:00Z');
        h.setUTCDate(h.getUTCDate() + 13); // 14 días por defecto (incluyendo 'desde')
        hasta = h.toISOString().slice(0, 10);
    }

    try {
        const pool = await getPool();

        const [horarioRes, feriadosRes, ordenesRes] = await Promise.all([
            // HoraInicio/HoraFin son TIME: convertidas acá a 'HH:MM' — si no, el driver las
            // devuelve como Date anclado a 1970-01-01 y el front termina mostrando "1970-".
            pool.request().input('area', sql.VarChar(20), area)
                .query(`SELECT DiaSemana, Turno,
                               CONVERT(VARCHAR(5), HoraInicio, 108) AS HoraInicio,
                               CONVERT(VARCHAR(5), HoraFin, 108) AS HoraFin
                        FROM dbo.ConfigHorarioLaboral WHERE AreaID = @area AND Activo = 1`),
            pool.request().input('desde', sql.Date, desde).input('hasta', sql.Date, hasta)
                .query("SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Fecha, Descripcion FROM dbo.CalendarioFeriados WHERE Fecha BETWEEN @desde AND @hasta"),
            // [CAPACIDAD] Mismo fallback que fetchDatosArea: MagnitudCapacidad/FechaCompromiso
            // (puntadas totales / fecha real, hoy solo EMB) si están cargadas, si no la Magnitud
            // de siempre (piezas/metros) y FechaEstimadaEntrega (fija) — no-op para el resto.
            pool.request().input('area', sql.VarChar(20), area).input('desde', sql.Date, desde).input('hasta', sql.Date, hasta)
                .query(`
                    SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Prioridad,
                           -- El TRY_CAST interno (a Magnitud, antes del ISNULL) es necesario —
                           -- Magnitud es NVARCHAR y áreas viejas (DF real: "1 u", "7 u") tienen
                           -- texto no numérico ahí. Sin él, ISNULL(MagnitudCapacidad, Magnitud)
                           -- por sí solo ya revienta ("Error converting nvarchar to numeric"):
                           -- SQL Server necesita unificar tipos para evaluar el ISNULL, y esa
                           -- conversión implícita ocurre ANTES/fuera del TRY_CAST externo, que
                           -- solo protege la conversión FINAL del resultado ya combinado — bug
                           -- real descubierto 28-ago-2026 al entrar por primera vez a esta
                           -- pantalla con un área que no fuera EMB.
                           TRY_CAST(ISNULL(o.MagnitudCapacidad, TRY_CAST(o.Magnitud AS DECIMAL(18,2))) AS DECIMAL(18,2)) AS Magnitud, o.UM, o.Estado, o.EstadoenArea,
                           CONVERT(VARCHAR(10), ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega), 23) AS FechaDia
                    FROM dbo.Ordenes o
                    WHERE o.AreaID = @area
                      AND ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega) >= @desde AND ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega) < DATEADD(day, 1, @hasta)
                      AND ISNULL(o.Estado, '') <> 'Cancelado'
                      -- [REQUISITOS] Mismo criterio que fetchDatosArea: una orden bloqueada por
                      -- requisitos no tiene una fecha real todavía, no se muestra "prometida" acá.
                      AND NOT EXISTS (
                          SELECT 1 FROM ConfigRequisitosProduccion req
                          WHERE req.AreaID = @area AND req.EsBloqueante = 1
                            AND NOT EXISTS (
                                SELECT 1 FROM OrdenCumplimientoRequisitos cum
                                WHERE cum.OrdenID = o.OrdenID AND cum.RequisitoID = req.RequisitoID AND cum.Estado = 'CUMPLIDO'
                            )
                      )
                    ORDER BY ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega) ASC
                `)
        ]);

        const horarios = horarioRes.recordset;
        const tieneHorario = horarios.length > 0;
        const feriados = new Map(feriadosRes.recordset.map(f => [f.Fecha, f.Descripcion]));
        const ordenesPorDia = new Map();
        for (const o of ordenesRes.recordset) {
            if (!ordenesPorDia.has(o.FechaDia)) ordenesPorDia.set(o.FechaDia, []);
            ordenesPorDia.get(o.FechaDia).push(o);
        }

        const dias = generarDias(desde, hasta).map(({ fecha, diaSemanaISO }) => {
            const esFeriado = feriados.has(fecha);
            const horariosDelDia = horarios.filter(h => h.DiaSemana === diaSemanaISO);
            const laborable = tieneHorario
                ? (horariosDelDia.length > 0 && !esFeriado)
                : (diaSemanaISO <= 5 && !esFeriado); // fallback: Lunes-Viernes, igual que el SP sin horario cargado
            const ordenes = ordenesPorDia.get(fecha) || [];

            return {
                fecha,
                diaSemanaISO,
                diaNombre: NOMBRES_DIA[diaSemanaISO],
                esFeriado,
                feriadoDescripcion: feriados.get(fecha) || null,
                laborable,
                horarios: horariosDelDia.map(h => ({ turno: h.Turno, horaInicio: h.HoraInicio, horaFin: h.HoraFin })),
                totalOrdenes: ordenes.length,
                ordenes
            };
        });

        res.json({ area, desde, hasta, tieneHorarioConfigurado: tieneHorario, dias });
    } catch (err) {
        logger.error("Error getting agenda de planificación:", err);
        res.status(500).json({ error: err.message });
    }
};

// Motor de capacidad vs carga pendiente de un área, proyectado día a día.
// "Terminado" = FechaPronto IS NOT NULL (lo que pasa después en logística no cuenta acá).
// Requiere que al menos una máquina activa del área tenga VelocidadValor cargado, y que esa
// velocidad esté en la MISMA unidad que Ordenes.Magnitud para esa área — si no, el número da
// mal aunque no truene. Por ahora eso vale para DF, EMB, ECOUV, SB y TPU (ver
// project_capacidad_planta.md); DIRECTA y EST quedan sin capacidad cargada a propósito.
// Función pura (sin req/res) para poder reusarla desde el endpoint Y desde el job de snapshot
// diario (capacidadDiaria.job.js).
//
// NO calibra contra el historial de FechaPronto (se probó y se sacó a pedido del usuario,
// 13-ago-2026): usar el Horario Laboral VIGENTE para calcular cuántas horas trabajó la planta
// en el pasado da un número retroactivo poco confiable en cuanto alguien edita el horario. La
// capacidad es siempre la Capacidad Instalada (ficha técnica de ConfigEquipos.VelocidadValor).
// "Esto empieza ahora": si en el futuro se quiere calibrar, calibrar solo con datos capturados
// desde hoy en adelante (HistoricoCapacidadDiaria), nunca reconstruyendo el pasado.
// Partida en 3 piezas (25-ago-2026, para poder calcular Fecha Compromiso en Bordado sin duplicar
// el motor): fetchDatosArea (trae de la BD + capacidad del área), simularCola (el loop día-a-día,
// puro/sin BD) y calcularSituacion (orquesta las dos para la pantalla de Planificación — cero
// cambio de comportamiento respecto a antes del refactor).

// Trae máquinas/horario/feriados/órdenes de un área y calcula su capacidad instalada/operativa.
// `hasta` ya viene resuelto (a diferencia de calcularSituacion, que recibe `dias`) porque
// calcularFechaCompromiso necesita un horizonte propio (180 días), distinto del de la pantalla.
async function fetchDatosArea(pool, area, desde, hasta) {
    const [maquinasRes, horarioRes, feriadosRes, ordenesRes, bloqueadasRes] = await Promise.all([
        pool.request().input('area', sql.VarChar(20), area)
            .query("SELECT EquipoID, Nombre, Estado, Cabezales, CabezalesReal, VelocidadValor, VelocidadValorReal, VelocidadUnidad FROM dbo.ConfigEquipos WHERE AreaID = @area AND Activo = 1 AND VelocidadValor IS NOT NULL"),
        pool.request().input('area', sql.VarChar(20), area)
            .query(`SELECT DiaSemana, CONVERT(VARCHAR(5), HoraInicio, 108) AS HoraInicio, CONVERT(VARCHAR(5), HoraFin, 108) AS HoraFin
                    FROM dbo.ConfigHorarioLaboral WHERE AreaID = @area AND Activo = 1`),
        pool.request().input('desde', sql.Date, desde).input('hasta', sql.Date, hasta)
            .query("SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Fecha FROM dbo.CalendarioFeriados WHERE Fecha BETWEEN @desde AND @hasta"),
        // Orden de asignación: Urgente atrasado (de antes de hoy) primero, después Urgente de
        // hoy ingresado antes de las 12 (mismo corte que CORTEURGENTE), después el resto por
        // fecha de ingreso. Ver GRUPOS/grupoDe más arriba.
        // [CAPACIDAD] Magnitud/FechaPrometida con fallback: MagnitudCapacidad/FechaCompromiso
        // (puntadas totales / fecha congelada, hoy solo EMB) si están cargadas, si no la Magnitud
        // de siempre (piezas/metros) y FechaEstimadaEntrega (fija) — no-op para el resto de áreas.
        pool.request().input('area', sql.VarChar(20), area).input('hoy', sql.Date, desde)
            .query(`SELECT OrdenID, CodigoOrden, Cliente, Prioridad, EstadoenArea,
                           CONVERT(VARCHAR(10), FechaIngreso, 23) AS FechaIngreso,
                           DATEPART(HOUR, FechaIngreso) AS HoraIngreso,
                           CONVERT(VARCHAR(10), ISNULL(FechaCompromiso, FechaEstimadaEntrega), 23) AS FechaPrometida,
                           -- TRY_CAST interno antes del ISNULL — ver el comentario del mismo
                           -- patrón en getAgenda más arriba (bug real con áreas cuya Magnitud
                           -- trae texto no numérico, ej. DF: "1 u").
                           TRY_CAST(ISNULL(MagnitudCapacidad, TRY_CAST(Magnitud AS DECIMAL(18,2))) AS DECIMAL(18,2)) AS Magnitud,
                           -- Piezas reales (Magnitud cruda, sin el fallback a MagnitudCapacidad)
                           -- — para traducir el avance diario (que se simula en la unidad de
                           -- Magnitud, puntadas en EMB) a "bordados" (x de y), que es lo que un
                           -- humano entiende como "cuánto". Sin MagnitudCapacidad cargada (áreas
                           -- que no sean EMB), Piezas == Magnitud — el x/y sale 1:1, no-op.
                           TRY_CAST(Magnitud AS DECIMAL(18,2)) AS Piezas,
                           -- Unidad real de la orden (ej. 'u' en EMB, 'm' en DF/metros) — el x/y
                           -- se etiqueta con esto, no con un texto fijo ("prendas" no tiene
                           -- sentido para un área que factura en metros). UM es CHAR de ancho
                           -- fijo — RTRIM para no arrastrar el padding hasta la pantalla.
                           RTRIM(o.UM) AS UM
                    FROM dbo.Ordenes o
                    WHERE AreaID = @area AND FechaPronto IS NULL AND ISNULL(Estado, '') <> 'Cancelado'
                      -- [REQUISITOS] No cuenta como capacidad consumible una orden bloqueada por
                      -- requisitos (matriz sin listar, prenda del cliente sin llegar, etc. — ver
                      -- ConfigRequisitosProduccion/OrdenCumplimientoRequisitos, mismo criterio que
                      -- ya usa embBoardController.getEmbOrders para la bandeja real). No se sabe
                      -- cuándo se va a desbloquear, así que no se proyecta como si ya pudiera
                      -- producirse desde hoy. Fallback exacto: sin requisitos bloqueantes
                      -- configurados para el área, no excluye nada.
                      AND NOT EXISTS (
                          SELECT 1 FROM ConfigRequisitosProduccion req
                          WHERE req.AreaID = @area AND req.EsBloqueante = 1
                            AND NOT EXISTS (
                                SELECT 1 FROM OrdenCumplimientoRequisitos cum
                                WHERE cum.OrdenID = o.OrdenID AND cum.RequisitoID = req.RequisitoID AND cum.Estado = 'CUMPLIDO'
                            )
                      )
                    ORDER BY
                        CASE
                            -- [EN MÁQUINA] La máquina YA está físicamente ocupada con esta orden
                            -- (operario le dio "Iniciar" en la bandeja, ver embBoardController
                            -- setEstadoTrabajo) — va SIEMPRE primero, antes que Urgente inclusive:
                            -- simular que otra orden "pasa por delante" sería fingir una capacidad
                            -- libre que en este momento no existe. Vuelve a competir normal si se
                            -- pausa o se desinicia (EstadoenArea vuelve a 'Pendiente').
                            WHEN EstadoenArea = 'En Maquina' THEN 0
                            WHEN Prioridad = 'Urgente' AND CAST(FechaIngreso AS DATE) < @hoy THEN 1
                            WHEN Prioridad = 'Urgente' AND CAST(FechaIngreso AS DATE) = @hoy AND DATEPART(HOUR, FechaIngreso) < 12 THEN 2
                            ELSE 3
                        END,
                        FechaIngreso ASC`),
        // [REQUISITOS] Lo que la simulación de arriba dejó afuera — para que la pantalla pueda
        // mostrar "esto existe, está esperando X" en vez de que el trabajo real desaparezca sin
        // explicación. La orden entra a esta lista si tiene AL MENOS UN requisito bloqueante sin
        // cumplir (mismo criterio que antes) — pero, a diferencia de antes, trae TODOS sus
        // requisitos bloqueantes (cumplidos incluidos, vía LEFT JOIN a
        // OrdenCumplimientoRequisitos en vez de excluirlos), para que la card pueda pintar en
        // verde lo que ya se resolvió en vez de que el ícono simplemente desaparezca sin dejar
        // rastro del progreso. Se agrupa por OrdenID abajo.
        pool.request().input('area', sql.VarChar(20), area)
            .query(`SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.NoDocERP, o.Material,
                           CONVERT(VARCHAR(10), o.FechaIngreso, 23) AS FechaIngreso,
                           -- Cantidad a bordar (piezas) — distinto de las puntadas totales que
                           -- usa la simulación: acá es lo que el operario entiende como "cuánto".
                           TRY_CAST(o.Magnitud AS DECIMAL(18,2)) AS Cantidad,
                           TRY_CAST(o.MagnitudCapacidad AS DECIMAL(18,2)) AS MagnitudCapacidad,
                           CONVERT(VARCHAR(10), ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega), 23) AS FechaPrometidaEfectiva,
                           req.CodigoRequisito, req.Descripcion AS RequisitoDescripcion,
                           CASE WHEN cum.CumplimientoID IS NOT NULL THEN 1 ELSE 0 END AS Cumplido,
                           -- La orden que trae la prenda física — dos caminos posibles, ambos
                           -- solo para el requisito PRENDA (NULL para MATRIZ/APROBACION):
                           -- la orden PRO del mismo pedido (combos, ver AUTO-FULFILL por
                           -- NoDocERP en logisticsController.receiveDispatch) o la Recepción de
                           -- mostrador que el cliente ya eligió al cargar el pedido
                           -- (Ordenes.PrendaClienteID, ver AUTO-FULFILL PRENDA DE CLIENTE en el
                           -- mismo archivo). Sin ninguna de las dos (ej. parches), ambas NULL.
                           pro.CodigoOrden AS OrdenPrendaCodigo,
                           rec.Codigo AS RecepcionCodigo
                    FROM dbo.Ordenes o
                    JOIN ConfigRequisitosProduccion req ON req.AreaID = @area AND req.EsBloqueante = 1
                    LEFT JOIN OrdenCumplimientoRequisitos cum ON cum.OrdenID = o.OrdenID
                        AND cum.RequisitoID = req.RequisitoID AND cum.Estado = 'CUMPLIDO'
                    LEFT JOIN dbo.Ordenes pro ON RTRIM(pro.NoDocERP) = RTRIM(o.NoDocERP)
                        AND pro.AreaID = 'PRO' AND pro.OrdenID <> o.OrdenID AND req.CodigoRequisito = 'PRENDA'
                    LEFT JOIN InventarioPrendasCliente pc ON pc.PrendaClienteID = o.PrendaClienteID
                        AND req.CodigoRequisito = 'PRENDA'
                    LEFT JOIN Recepciones rec ON rec.RecepcionID = pc.RecepcionID
                    WHERE o.AreaID = @area AND o.FechaPronto IS NULL AND ISNULL(o.Estado, '') <> 'Cancelado'
                      AND EXISTS (
                          SELECT 1 FROM ConfigRequisitosProduccion req2
                          WHERE req2.AreaID = @area AND req2.EsBloqueante = 1
                            AND NOT EXISTS (
                                SELECT 1 FROM OrdenCumplimientoRequisitos cum2
                                WHERE cum2.OrdenID = o.OrdenID AND cum2.RequisitoID = req2.RequisitoID AND cum2.Estado = 'CUMPLIDO'
                            )
                      )
                    ORDER BY o.FechaIngreso ASC`)
    ]);

    const maquinas = maquinasRes.recordset;
    if (maquinas.length === 0) {
        return {
            tieneCapacidad: false,
            motivo: 'Ninguna máquina de esta área tiene Velocidad cargada (Configuración → Equipos).'
        };
    }

    const unidad = maquinas[0].VelocidadUnidad;
    const horarios = horarioRes.recordset;
    const feriados = new Set(feriadosRes.recordset.map(f => f.Fecha));

    // Velocidad = rendimiento de UN cabezal, no de la máquina completa (confirmado con el
    // usuario, 25-ago-2026, con un ejemplo numérico propio: Gensy 1 a Velocidad=5100 con 6
    // cabezales de diseño hace 5100×6=30600 a pleno, no 5100). La capacidad de una máquina es
    // siempre Velocidad × su cantidad de cabezales.
    const velocidadDe = (m) => m.VelocidadValorReal != null ? Number(m.VelocidadValorReal) : Number(m.VelocidadValor);
    // Sin Cabezales cargado (áreas sin ese concepto: DTF, SB, ECOUV, etc. — ver
    // consolidar_capacidad_planta.sql), se asume 1 — la Velocidad queda tal cual, sin multiplicar
    // por nada (fallback exacto: no cambia el comportamiento de las áreas que no usan cabezales).
    const cabezalesDiseno = (m) => m.Cabezales != null && Number(m.Cabezales) > 0 ? Number(m.Cabezales) : 1;
    // Cuántos cabezales tiene funcionando AHORA. Sin CabezalesReal cargado, se asume que sigue
    // teniendo todos los de diseño (no-op — mismo criterio que el resto de los campos "Real").
    const cabezalesOperativos = (m) => m.CabezalesReal != null ? Number(m.CabezalesReal) : cabezalesDiseno(m);
    // "Fuera de servicio" = Estado='MANTENIMIENTO' (Configuración → Equipos). 'OCUPADO' sigue
    // siendo una máquina funcional (está produciendo algo AHORA, no de baja), así que solo
    // MANTENIMIENTO se excluye de la capacidad operativa — a pedido del usuario, 25-ago-2026:
    // "tengo x cabezales o máquinas fuera de servicio, entonces tengo REALMENTE menos capacidad".
    const enMantenimiento = (m) => String(m.Estado || '').trim().toUpperCase() === 'MANTENIMIENTO';

    // Capacidad instalada TOTAL: ficha técnica de TODO el parque activo a pleno diseño (todos
    // los cabezales de fábrica funcionando) — el máximo teórico si no hubiera ninguna degradada.
    const capacidadTeorica = maquinas.reduce((s, m) => s + velocidadDe(m) * cabezalesDiseno(m), 0);
    const maquinasOperativas = maquinas.filter(m => !enMantenimiento(m));
    const maquinasEnMantenimiento = maquinas.filter(enMantenimiento);
    // Capacidad REAL disponible ahora: excluye las máquinas en mantenimiento total y usa los
    // cabezales REALMENTE funcionando en las demás. Es la que se usa para TODA la simulación de
    // abajo (capacidadHoraria) — si hay máquinas degradadas, la fecha proyectada de cada orden y
    // "se pone al día" ya lo reflejan, no la capacidad ideal.
    const capacidadOperativaAhora = maquinasOperativas.reduce((s, m) => s + velocidadDe(m) * cabezalesOperativos(m), 0);
    const porcentajePlantaOperativa = capacidadTeorica > 0
        ? Math.round((capacidadOperativaAhora / capacidadTeorica) * 10000) / 100
        : null;

    const capacidadHoraria = capacidadOperativaAhora;
    const fuenteCapacidad = 'teorica';

    const maquinasRespuesta = maquinas.map(m => {
        const usaVelocidadReal = m.VelocidadValorReal != null;
        const cabezalesReal = cabezalesOperativos(m);
        const cabezalesEstandar = cabezalesDiseno(m);
        return {
            nombre: m.Nombre,
            velocidad: usaVelocidadReal ? Number(m.VelocidadValorReal) : Number(m.VelocidadValor),
            usaVelocidadReal,
            enMantenimiento: enMantenimiento(m),
            cabezalesReducidos: cabezalesReal < cabezalesEstandar,
            capacidadInstalada: Math.round(velocidadDe(m) * cabezalesEstandar * 100) / 100,
            capacidadEfectiva: enMantenimiento(m) ? 0 : Math.round(velocidadDe(m) * cabezalesReal * 100) / 100
        };
    });

    const ordenes = ordenesRes.recordset
        .filter(o => o.Magnitud != null && o.Magnitud > 0)
        .map(o => ({ ...o, grupo: grupoDe(o, desde) }));

    // Horas laborables de un día "típico" (promedio de los días de la semana que SÍ tienen
    // horario configurado, mismo horasEntre() de la simulación) — sirve para traducir horas de
    // máquina a "días hábiles necesarios" más abajo. Sin horario cargado, 8h de fallback (jornada
    // estándar) para no dividir por cero.
    const diasConHorario = [...new Set(horarios.map(h => h.DiaSemana))];
    const horasLaborablesPromedio = diasConHorario.length
        ? diasConHorario.reduce((s, d) => s + horarios.filter(h => h.DiaSemana === d)
            .reduce((s2, h) => s2 + horasEntre(h.HoraInicio, h.HoraFin), 0), 0) / diasConHorario.length
        : 8;

    // [REQUISITOS] Agrupa las filas (1 por requisito faltante) en 1 tarjeta por orden, con la
    // lista de qué le falta — para que la pantalla pueda mostrar "esperando X" en vez de que la
    // orden simplemente desaparezca de la simulación sin explicación.
    //
    // Semáforo simplificado (estas órdenes no participan de simularCola, no hay diaProyectado
    // real para compararlas — no se sabe cuándo se van a desbloquear): en vez de mirar solo el
    // margen calendario contra la fecha prometida, resta de ese margen los días hábiles que va a
    // consumir la producción en sí (MagnitudCapacidad / capacidadHoraria del área, en horas,
    // llevado a días con horasLaborablesPromedio) — así una orden con margen calendario amplio
    // pero mucho trabajo de máquina por delante (y que ni siquiera arrancó, porque sigue
    // bloqueada) cae antes en amarillo/rojo, no recién el día que la fecha calendario ya está
    // encima. Sin MagnitudCapacidad cargado (cualquier área que no sea EMB hoy) o sin capacidad
    // calculable, el margen neto es el margen calendario tal cual — mismo resultado que antes de
    // este cálculo. rojo = margen neto vencido o cero; amarillo = ≤2 días (mismo colchón que
    // EMB_DIAS_PREPARACION_MATRIZ); verde = con margen de sobra. Es una alerta de "esto se está
    // por complicar", no una promesa de fecha.
    const bloqueadasPorOrden = new Map();
    for (const r of bloqueadasRes.recordset) {
        if (!bloqueadasPorOrden.has(r.OrdenID)) {
            const [dy, dm, dd] = desde.split('-').map(Number);
            let margenDias = null;
            let semaforo = null;
            let horasEstimadas = null;
            let diasProduccionNecesarios = null;
            if (r.MagnitudCapacidad > 0 && capacidadHoraria > 0) {
                horasEstimadas = r.MagnitudCapacidad / capacidadHoraria;
                diasProduccionNecesarios = horasEstimadas / horasLaborablesPromedio;
            }
            if (r.FechaPrometidaEfectiva) {
                const [fy, fm, fd] = r.FechaPrometidaEfectiva.split('-').map(Number);
                margenDias = Math.round((Date.UTC(fy, fm - 1, fd) - Date.UTC(dy, dm - 1, dd)) / 86400000);
                const margenNeto = diasProduccionNecesarios != null ? margenDias - diasProduccionNecesarios : margenDias;
                semaforo = margenNeto <= 0 ? 'rojo' : margenNeto <= 2 ? 'amarillo' : 'verde';
            }
            // Antigüedad: hace cuántos días entró, para responder "de acuerdo al tiempo que
            // lleva" sin tener que restar la fecha a mano. Mismo Date.UTC de margenDias, sin
            // pasar por Date() sobre el string (huso horario).
            const [iy, im, id] = r.FechaIngreso.split('-').map(Number);
            const diasEnEspera = Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(iy, im - 1, id)) / 86400000);
            bloqueadasPorOrden.set(r.OrdenID, {
                OrdenID: r.OrdenID, CodigoOrden: r.CodigoOrden, Cliente: r.Cliente,
                NoDocERP: r.NoDocERP, FechaIngreso: r.FechaIngreso, Material: r.Material,
                Cantidad: r.Cantidad, FechaPrometidaEfectiva: r.FechaPrometidaEfectiva,
                horasEstimadas: horasEstimadas != null ? Math.round(horasEstimadas * 10) / 10 : null,
                margenDias, semaforo, diasEnEspera,
                requisitosFaltantesPorCodigo: new Map() // se aplana a array al final
            });
        }
        const orden = bloqueadasPorOrden.get(r.OrdenID);
        // Un pedido con varias prendas (combo) trae varias órdenes PRO hermanas — el LEFT JOIN
        // repite la fila (orden, PRENDA) una vez por cada una. Se agrupan bajo UN solo requisito
        // PRENDA con todas sus órdenes/recepciones asociadas, en vez de duplicar el ícono.
        if (!orden.requisitosFaltantesPorCodigo.has(r.CodigoRequisito)) {
            orden.requisitosFaltantesPorCodigo.set(r.CodigoRequisito, {
                codigo: r.CodigoRequisito, descripcion: r.RequisitoDescripcion,
                cumplido: !!r.Cumplido,
                ordenesAsociadas: []
            });
        }
        const codigoPro = r.OrdenPrendaCodigo ? r.OrdenPrendaCodigo.trim() : null;
        const codigoPre = r.RecepcionCodigo ? r.RecepcionCodigo.trim() : null;
        const req = orden.requisitosFaltantesPorCodigo.get(r.CodigoRequisito);
        if (codigoPro && !req.ordenesAsociadas.includes(codigoPro)) {
            req.ordenesAsociadas.push(codigoPro);
        }
        if (codigoPre && !req.ordenesAsociadas.includes(codigoPre)) {
            req.ordenesAsociadas.push(codigoPre);
        }
    }
    const ordenesBloqueadas = [...bloqueadasPorOrden.values()].map(o => {
        const { requisitosFaltantesPorCodigo, ...resto } = o;
        return { ...resto, requisitosFaltantes: [...requisitosFaltantesPorCodigo.values()] };
    });

    return {
        tieneCapacidad: true, unidad, horarios, feriados, ordenes, ordenesBloqueadas,
        capacidadHoraria, capacidadTeorica, capacidadOperativaAhora, porcentajePlantaOperativa,
        fuenteCapacidad, maquinasRespuesta,
        maquinasEnMantenimientoNombres: maquinasEnMantenimiento.map(m => m.Nombre)
    };
}

// Simula día a día (desde..hasta) cómo la cola de `ordenes` (ya con `.grupo` asignado, ver
// grupoDe) consume `capacidadHoraria` según `horarios`/`feriados`. Puro — sin acceso a BD — para
// poder correrlo tanto con la cola real (calcularSituacion) como con la cola real + órdenes
// nuevas sintéticas al final (calcularFechaCompromiso).
//
// Una orden puede traer `activaDesde` ('YYYY-MM-DD'): mientras la fecha simulada sea anterior,
// no compite por la capacidad de ese día (se usa para el colchón de días de preparación de
// matriz — es tiempo de diseño en computadora, no bloquea la máquina para las demás órdenes,
// solo retrasa cuándo ESTA orden se suma a la cola). Ninguna orden real trae este campo hoy.
function simularCola({ ordenes, desde, hasta, horarios, feriados, capacidadHoraria }) {
    const cargaPendienteTotal = ordenes.reduce((s, o) => s + o.Magnitud, 0);
    const ordenesUrgentes = ordenes.filter(o => o.Prioridad === 'Urgente');
    const cargaPendienteUrgente = ordenesUrgentes.reduce((s, o) => s + o.Magnitud, 0);
    const cargaPendienteNormal = cargaPendienteTotal - cargaPendienteUrgente;

    let colaIndex = 0;
    let colaRestante = ordenes.length ? ordenes[0].Magnitud : 0;
    let cargaAcumuladaRestante = cargaPendienteTotal;
    const ordenesConProyeccion = [];
    const diasResultado = [];

    const gruposVacios = () => Object.fromEntries(GRUPOS.map(g => [g, {
        metros: 0, cantidad: 0, semaforo: null,
        fechaIngresoMin: null, fechaIngresoMax: null,
        fechaPrometidaMin: null // la promesa más vieja del grupo — la más atrasada
    }]));

    // "Hoy" real (no el día del calendario que se esté simulando) para medir antigüedad —
    // mismo criterio que diasEnEspera en fetchDatosArea/bloqueadasPorOrden: cuánto lleva
    // esperando la orden, contado desde hoy, no relativo al día que se está proyectando.
    const [hoyY, hoyM, hoyD] = desde.split('-').map(Number);
    // Piezas ya contabilizadas de cada orden en días anteriores (persiste a través del loop de
    // días, a diferencia de avanceOrdenesDia que se resetea cada día) — ver armarAvance.
    const piezasAcumuladasPorOrden = new Map();

    for (const { fecha, diaSemanaISO } of generarDias(desde, hasta)) {
        const esFeriado = feriados.has(fecha);
        const horariosDelDia = horarios.filter(h => h.DiaSemana === diaSemanaISO);
        const horasLaborables = horariosDelDia.reduce((s, h) => s + horasEntre(h.HoraInicio, h.HoraFin), 0);
        const laborable = !esFeriado && horasLaborables > 0;
        const capacidadDia = laborable ? horasLaborables * capacidadHoraria : 0;

        let capacidadRestanteDia = capacidadDia;
        const gruposDia = gruposVacios();
        // Avance del día: por cada orden que consume algo de capacidad hoy (se complete o no),
        // cuánto de SU magnitud se hizo hoy — a diferencia de gruposDia (que solo suma la orden
        // completa al grupo el día en que TERMINA), esto también captura los días intermedios en
        // los que una orden grande sigue en curso sin completarse todavía (pedido explícito del
        // usuario 27-ago-2026: "cuánto se prevé hacer de cada orden" día a día, no solo el día
        // en que termina).
        const avanceOrdenesDia = [];
        // Card consolidada por orden (pedido explícito del usuario 27-ago-2026: sacó la lista de
        // "N órdenes" agrupada por fecha prometida fija, y pidió que sus datos —cliente, fecha de
        // ingreso con antigüedad, fecha comprometida con semáforo— vivan en la MISMA tarjeta de
        // avance diario, con el mismo formato ya usado en la lista de "Esperando requisitos").
        //
        // Piezas (x de y "bordados") a partir de la magnitud consumida hoy (puntadas en EMB): en
        // días intermedios, proporcional y redondeada — el redondeo diario acumula un pequeño
        // margen de error. En el día en que la orden SE COMPLETA, en vez de la proporción de ESE
        // día (que puede ser un resto casi nulo si la mayor parte ya se hizo antes, y redondear a
        // 0 — bug real visto 27-ago-2026: una orden de 100 piezas mostraba 5+47+47+0, sin llegar
        // nunca a 100 en ningún día), se usa lo que FALTA contra `piezasAcumuladasPorOrden` — así
        // el total siempre cierra exacto en piezasTotal, sin quedar piezas "flotando" sin
        // asignar a ningún día.
        const armarAvance = (orden, magnitudHoy, completa, semaforo) => {
            let diasEnEspera = null;
            if (orden.FechaIngreso) {
                const [iy, im, id] = orden.FechaIngreso.split('-').map(Number);
                diasEnEspera = Math.round((Date.UTC(hoyY, hoyM - 1, hoyD) - Date.UTC(iy, im - 1, id)) / 86400000);
            }
            let piezasHoy = null;
            if (orden.Piezas > 0 && orden.Magnitud > 0) {
                if (completa) {
                    const yaAcumuladas = piezasAcumuladasPorOrden.get(orden.OrdenID) || 0;
                    piezasHoy = Math.max(0, orden.Piezas - yaAcumuladas);
                } else {
                    piezasHoy = Math.round(magnitudHoy * (orden.Piezas / orden.Magnitud));
                    piezasAcumuladasPorOrden.set(orden.OrdenID, (piezasAcumuladasPorOrden.get(orden.OrdenID) || 0) + piezasHoy);
                }
            }
            return {
                OrdenID: orden.OrdenID, CodigoOrden: orden.CodigoOrden, Cliente: orden.Cliente,
                FechaIngreso: orden.FechaIngreso, diasEnEspera,
                FechaPrometida: orden.FechaPrometida, semaforo,
                piezasHoy, piezasTotal: orden.Piezas > 0 ? orden.Piezas : null, UM: orden.UM || null,
                completa
            };
        };
        while (capacidadRestanteDia > 0 && colaIndex < ordenes.length) {
            const orden = ordenes[colaIndex];
            if (orden.activaDesde && fecha < orden.activaDesde) break; // todavía en preparación de matriz
            if (colaRestante <= capacidadRestanteDia) {
                const magnitudHoy = colaRestante;
                capacidadRestanteDia -= colaRestante;
                cargaAcumuladaRestante -= colaRestante;
                const semaforo = semaforoDe(fecha, orden.FechaPrometida);
                ordenesConProyeccion.push({ ...orden, diaProyectado: fecha, semaforo });
                avanceOrdenesDia.push(armarAvance(orden, magnitudHoy, true, semaforo));
                gruposDia[orden.grupo].metros += colaRestante;
                gruposDia[orden.grupo].cantidad += 1;
                gruposDia[orden.grupo].semaforo = peorSemaforo(gruposDia[orden.grupo].semaforo, semaforo);
                const fMin = gruposDia[orden.grupo].fechaIngresoMin;
                const fMax = gruposDia[orden.grupo].fechaIngresoMax;
                gruposDia[orden.grupo].fechaIngresoMin = (!fMin || orden.FechaIngreso < fMin) ? orden.FechaIngreso : fMin;
                gruposDia[orden.grupo].fechaIngresoMax = (!fMax || orden.FechaIngreso > fMax) ? orden.FechaIngreso : fMax;
                if (orden.FechaPrometida) {
                    const fpMin = gruposDia[orden.grupo].fechaPrometidaMin;
                    gruposDia[orden.grupo].fechaPrometidaMin = (!fpMin || orden.FechaPrometida < fpMin) ? orden.FechaPrometida : fpMin;
                }
                colaIndex++;
                colaRestante = colaIndex < ordenes.length ? ordenes[colaIndex].Magnitud : 0;
            } else {
                const magnitudHoy = capacidadRestanteDia;
                colaRestante -= capacidadRestanteDia;
                cargaAcumuladaRestante -= capacidadRestanteDia;
                avanceOrdenesDia.push(armarAvance(orden, magnitudHoy, false, semaforoDe(fecha, orden.FechaPrometida)));
                capacidadRestanteDia = 0;
            }
        }

        for (const g of GRUPOS) gruposDia[g].metros = Math.round(gruposDia[g].metros * 100) / 100;

        // capacidadNominalDia: cuánto PUEDE producir la planta ese día de la semana según su
        // horario configurado — a diferencia de capacidadDia (arriba), NO se anula en feriados.
        // Un feriado es una decisión de agenda ("hoy no se planifica nada", correcto para la
        // simulación FIFO de más abajo y para el histórico), no un cambio en la capacidad con
        // la que la planta cuenta — son dos cosas distintas, no una misma variable.
        const capacidadNominalDia = horasLaborables * capacidadHoraria;

        diasResultado.push({
            fecha, diaSemanaISO, laborable, esFeriado,
            horasLaborables: Math.round(horasLaborables * 100) / 100,
            capacidadDia: Math.round(capacidadDia * 100) / 100,
            capacidadNominalDia: Math.round(capacidadNominalDia * 100) / 100,
            grupos: gruposDia,
            avanceOrdenes: avanceOrdenesDia,
            ordenesCompletadas: GRUPOS.reduce((s, g) => s + gruposDia[g].cantidad, 0),
            cargaAcumuladaRestante: Math.round(Math.max(0, cargaAcumuladaRestante) * 100) / 100
        });
        // OJO: antes cortaba acá apenas se vaciaba la cola ("no hace falta seguir
        // proyectando") — pero eso dejaba sin `grupos`/capacidadDia a los días siguientes
        // dentro de la ventana visible (agenda de 14 días), y la tarjeta se veía distinta
        // según si el área tenía backlog o no (bug real, visto en EMB: solo HOY mostraba la
        // caja de capacidad). Se sigue calculando todo el rango pedido — es aritmética en
        // memoria, no cuesta nada aunque el backlog ya esté en cero.
    }

    const fechaAgotamiento = diasResultado.find(d => d.cargaAcumuladaRestante <= 0 && cargaPendienteTotal > 0)?.fecha || null;

    return {
        diasResultado, ordenesConProyeccion,
        cargaPendienteTotal, cargaPendienteUrgente, cargaPendienteNormal,
        cantidadOrdenesPendientes: ordenes.length, cantidadOrdenesPendientesUrgente: ordenesUrgentes.length,
        fechaAgotamiento,
        horizonteAgotado: !fechaAgotamiento && cargaPendienteTotal > 0, // el backlog no se absorbe dentro del horizonte proyectado
        // Con la capacidad REAL de ahora (ya reducida por las máquinas en mantenimiento), cuántas
        // de las órdenes proyectadas dentro de este horizonte van a llegar DESPUÉS de su fecha
        // prometida (semaforo='rojo', ver semaforoDe). Solo cuenta lo que la simulación llegó a
        // proyectar — si horizonteAgotado=true, hay además backlog fuera del rango pedido.
        cantidadOrdenesIncumplen: ordenesConProyeccion.filter(o => o.semaforo === 'rojo').length,
        magnitudOrdenesIncumplen: Math.round(ordenesConProyeccion.filter(o => o.semaforo === 'rojo').reduce((s, o) => s + o.Magnitud, 0) * 100) / 100
    };
}

async function calcularSituacion(pool, area, { desde, dias }) {
    const hasta = addDiasStr(desde, dias - 1);
    const datos = await fetchDatosArea(pool, area, desde, hasta);
    if (!datos.tieneCapacidad) return { area, tieneCapacidad: false, motivo: datos.motivo };

    const sim = simularCola({
        ordenes: datos.ordenes, desde, hasta,
        horarios: datos.horarios, feriados: datos.feriados, capacidadHoraria: datos.capacidadHoraria
    });

    return {
        area, tieneCapacidad: true, unidad: datos.unidad,
        grupoLabels: GRUPO_LABEL,
        capacidadHoraria: Math.round(datos.capacidadHoraria * 100) / 100,
        capacidadDiaHoy: sim.diasResultado[0]?.fecha === desde ? sim.diasResultado[0].capacidadDia : null,
        horasProduccionHoy: sim.diasResultado[0]?.fecha === desde ? sim.diasResultado[0].horasLaborables : null,
        capacidadNominalHoy: sim.diasResultado[0]?.fecha === desde ? sim.diasResultado[0].capacidadNominalDia : null,
        esFeriadoHoy: sim.diasResultado[0]?.fecha === desde ? sim.diasResultado[0].esFeriado : false,
        fuenteCapacidad: datos.fuenteCapacidad, // siempre 'teorica' — sin calibración contra historial
        capacidadTeorica: Math.round(datos.capacidadTeorica * 100) / 100,
        capacidadOperativaAhora: Math.round(datos.capacidadOperativaAhora * 100) / 100,
        porcentajePlantaOperativa: datos.porcentajePlantaOperativa,
        maquinasEnMantenimiento: datos.maquinasEnMantenimientoNombres,
        maquinas: datos.maquinasRespuesta,
        // [REQUISITOS] Trabajo real que existe pero no se proyecta (no se sabe cuándo se
        // desbloquea) — para que la pantalla lo muestre aparte en vez de que desaparezca.
        ordenesBloqueadas: datos.ordenesBloqueadas,
        cargaPendienteTotal: Math.round(sim.cargaPendienteTotal * 100) / 100,
        cargaPendienteUrgente: Math.round(sim.cargaPendienteUrgente * 100) / 100,
        cargaPendienteNormal: Math.round(sim.cargaPendienteNormal * 100) / 100,
        cantidadOrdenesPendientes: sim.cantidadOrdenesPendientes,
        cantidadOrdenesPendientesUrgente: sim.cantidadOrdenesPendientesUrgente,
        fechaAgotamiento: sim.fechaAgotamiento,
        horizonteAgotado: sim.horizonteAgotado,
        cantidadOrdenesIncumplen: sim.cantidadOrdenesIncumplen,
        magnitudOrdenesIncumplen: sim.magnitudOrdenesIncumplen,
        dias: sim.diasResultado,
        ordenes: sim.ordenesConProyeccion // uso interno (getDetalleGrupo) — getCapacidad lo saca antes de responder
    };
}

// Fecha en que se proyecta terminar cada una de `nuevasOrdenes` ([{magnitud, prioridad}]) si se
// agregan AL FINAL de la cola actual del área, después de `diasColchon` días de preparación de
// matriz (no consume capacidad de máquina — ver `activaDesde` en simularCola). Se usa al VENDER
// un pedido de Bordado, para congelar `Ordenes.FechaCompromiso`; no persiste nada, el caller
// decide qué hacer con las fechas. Devuelve un array paralelo a `nuevasOrdenes` ('YYYY-MM-DD' o
// `null` si esa orden no llegó a proyectarse dentro del horizonte de 180 días).
async function calcularFechaCompromiso(pool, area, nuevasOrdenes, diasColchon = 0) {
    const desde = new Date().toISOString().slice(0, 10);
    const hasta = addDiasStr(desde, 179); // horizonte amplio: 180 días, para backlogs grandes
    const datos = await fetchDatosArea(pool, area, desde, hasta);
    if (!datos.tieneCapacidad) return nuevasOrdenes.map(() => null);

    const activaDesde = addDiasStr(desde, diasColchon);
    const sinteticas = nuevasOrdenes.map((n, i) => {
        const base = { Prioridad: n.prioridad || 'Normal', FechaIngreso: desde, HoraIngreso: 12 };
        return {
            ...base,
            OrdenID: `sintetica-${i}`,
            FechaPrometida: null,
            Magnitud: n.magnitud,
            grupo: grupoDe(base, desde),
            activaDesde
        };
    });

    const sim = simularCola({
        ordenes: [...datos.ordenes, ...sinteticas], desde, hasta,
        horarios: datos.horarios, feriados: datos.feriados, capacidadHoraria: datos.capacidadHoraria
    });

    return sinteticas.map(s => sim.ordenesConProyeccion.find(o => o.OrdenID === s.OrdenID)?.diaProyectado ?? null);
}

// Guarda (o actualiza) la foto del día para un área en HistoricoCapacidadDiaria. Se llama desde
// el job diario (capacidadDiaria.job.js) y, oportunistamente, desde getCapacidad — así el
// histórico empieza a llenarse desde ya sin depender de que el server se reinicie para que el
// cron arranque a correr.
async function upsertSnapshotDiario(pool, area, fecha, situacion) {
    if (!situacion.tieneCapacidad) return;
    await pool.request()
        .input('AreaID', sql.VarChar(20), area)
        .input('Fecha', sql.Date, fecha)
        .input('CapacidadDia', sql.Decimal(18, 2), situacion.capacidadDiaHoy)
        .input('Unidad', sql.VarChar(30), situacion.unidad)
        .input('FuenteCapacidad', sql.VarChar(20), situacion.fuenteCapacidad)
        .input('MetrosPendientesTotal', sql.Decimal(18, 2), situacion.cargaPendienteTotal)
        .input('MetrosPendientesUrgente', sql.Decimal(18, 2), situacion.cargaPendienteUrgente)
        .input('MetrosPendientesNormal', sql.Decimal(18, 2), situacion.cargaPendienteNormal)
        .input('CantidadOrdenesPendientes', sql.Int, situacion.cantidadOrdenesPendientes)
        .input('CantidadOrdenesPendientesUrgente', sql.Int, situacion.cantidadOrdenesPendientesUrgente)
        .query(`
            MERGE dbo.HistoricoCapacidadDiaria AS target
            USING (SELECT @AreaID AS AreaID, @Fecha AS Fecha) AS src
            ON target.AreaID = src.AreaID AND target.Fecha = src.Fecha
            WHEN MATCHED THEN UPDATE SET
                CapacidadDia = @CapacidadDia, Unidad = @Unidad, FuenteCapacidad = @FuenteCapacidad,
                MetrosPendientesTotal = @MetrosPendientesTotal, MetrosPendientesUrgente = @MetrosPendientesUrgente,
                MetrosPendientesNormal = @MetrosPendientesNormal, CantidadOrdenesPendientes = @CantidadOrdenesPendientes,
                CantidadOrdenesPendientesUrgente = @CantidadOrdenesPendientesUrgente, RegistradoEn = GETDATE()
            WHEN NOT MATCHED THEN INSERT
                (AreaID, Fecha, CapacidadDia, Unidad, FuenteCapacidad, MetrosPendientesTotal, MetrosPendientesUrgente,
                 MetrosPendientesNormal, CantidadOrdenesPendientes, CantidadOrdenesPendientesUrgente, RegistradoEn)
                VALUES (@AreaID, @Fecha, @CapacidadDia, @Unidad, @FuenteCapacidad, @MetrosPendientesTotal, @MetrosPendientesUrgente,
                        @MetrosPendientesNormal, @CantidadOrdenesPendientes, @CantidadOrdenesPendientesUrgente, GETDATE());
        `);
}

exports.getCapacidad = async (req, res) => {
    const { area } = req.query;
    if (!area) return res.status(400).json({ error: "Falta el parámetro 'area'." });

    let { desde } = req.query;
    const hoyStr = new Date().toISOString().slice(0, 10);
    const esHoy = !desde || desde === hoyStr;
    if (!desde) desde = hoyStr;
    const dias = Math.min(parseInt(req.query.dias) || 60, 120);

    try {
        const pool = await getPool();
        const situacion = await calcularSituacion(pool, area, { desde, dias });

        if (esHoy && situacion.tieneCapacidad) {
            // No bloquea la respuesta si falla — es un registro histórico, no algo crítico del pedido.
            upsertSnapshotDiario(pool, area, hoyStr, situacion).catch(e => logger.error('Error guardando snapshot diario:', e.message));
        }

        // El detalle orden-por-orden puede ser miles de filas (todo el backlog) — no viaja acá,
        // se pide bajo demanda por (fecha, grupo) con getDetalleGrupo. Sí viaja un mapa liviano
        // OrdenID->diaProyectado: la Agenda (getAgenda) agrupa por FechaCompromiso, la promesa
        // FIJA al cliente — pero una orden que ya cumplió sus requisitos y quedó como la única
        // (o la primera) compitiendo por capacidad puede completarse ANTES de esa promesa vieja
        // (calculada cuando todavía competía contra trabajo hoy bloqueado). El front la reubica
        // en su día real usando este mapa, sin tocar FechaCompromiso (sigue siendo la promesa).
        const { ordenes, ...situacionSinDetalle } = situacion;
        if (ordenes) {
            situacionSinDetalle.diaProyectadoPorOrden = Object.fromEntries(
                ordenes.map(o => [o.OrdenID, o.diaProyectado])
            );
        }
        res.json(situacionSinDetalle);
    } catch (err) {
        logger.error("Error calculando capacidad de planificación:", err);
        res.status(500).json({ error: err.message });
    }
};

// Detalle orden-por-orden de un (fecha, grupo) puntual — para el click "mostrame qué órdenes
// componen esto" en cada tarjeta de día. Recalcula la simulación completa (misma que
// getCapacidad) y filtra; no cachea, pero es liviano (unas pocas queries + un loop en memoria).
exports.getDetalleGrupo = async (req, res) => {
    const { area, fecha, grupo } = req.query;
    if (!area || !fecha || !grupo) return res.status(400).json({ error: "Faltan parámetros: area, fecha, grupo." });
    if (!GRUPOS.includes(grupo)) return res.status(400).json({ error: `grupo inválido, debe ser uno de: ${GRUPOS.join(', ')}` });

    try {
        const pool = await getPool();
        const hoyStr = new Date().toISOString().slice(0, 10);
        // Necesita cubrir desde hoy hasta la fecha pedida para que la simulación llegue ahí.
        const [y, m, d] = fecha.split('-').map(Number);
        const [yh, mh, dh] = hoyStr.split('-').map(Number);
        const diasNecesarios = Math.max(1, Math.round((Date.UTC(y, m - 1, d) - Date.UTC(yh, mh - 1, dh)) / 86400000) + 1);

        const situacion = await calcularSituacion(pool, area, { desde: hoyStr, dias: Math.min(diasNecesarios, 120) });
        if (!situacion.tieneCapacidad) return res.json({ area, fecha, grupo, ordenes: [] });

        const ordenes = situacion.ordenes.filter(o => o.diaProyectado === fecha && o.grupo === grupo);
        res.json({ area, fecha, grupo, unidad: situacion.unidad, ordenes });
    } catch (err) {
        logger.error("Error obteniendo detalle de grupo:", err);
        res.status(500).json({ error: err.message });
    }
};

// Histórico de snapshots diarios de un área — para ver la tendencia (¿el backlog crece o baja?).
exports.getHistorico = async (req, res) => {
    const { area } = req.query;
    if (!area) return res.status(400).json({ error: "Falta el parámetro 'area'." });
    const dias = Math.min(parseInt(req.query.dias) || 30, 180);

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('area', sql.VarChar(20), area)
            .input('desde', sql.Date, addDiasStr(new Date().toISOString().slice(0, 10), -dias))
            .query(`SELECT CONVERT(VARCHAR(10), Fecha, 23) AS Fecha, CapacidadDia, Unidad, FuenteCapacidad,
                           MetrosPendientesTotal, MetrosPendientesUrgente, MetrosPendientesNormal,
                           CantidadOrdenesPendientes, CantidadOrdenesPendientesUrgente
                    FROM dbo.HistoricoCapacidadDiaria
                    WHERE AreaID = @area AND Fecha >= @desde
                    ORDER BY Fecha ASC`);
        res.json({ area, dias: result.recordset });
    } catch (err) {
        logger.error("Error obteniendo histórico de capacidad:", err);
        res.status(500).json({ error: err.message });
    }
};

// [BORDADO] Preview de fecha estimada mientras el cliente/vendedor todavía está diseñando el
// bordado en el portal — NO crea ni toca ninguna orden. Reusa el mismo motor que
// createWebOrder usa al confirmar la venta (calcularFechaCompromiso); la fecha real puede
// diferir un poco si la prioridad final del pedido no es 'Normal', o si la cola cambia entre
// que se previsualiza y se confirma la compra.
exports.estimarFechaBordado = async (req, res) => {
    const magnitud = parseFloat(req.query.magnitud);
    if (!magnitud || magnitud <= 0) return res.status(400).json({ error: "Falta o es inválido el parámetro 'magnitud' (puntadas totales)." });
    const prioridad = req.query.prioridad === 'Urgente' ? 'Urgente' : 'Normal';

    try {
        const pool = await getPool();
        const confRes = await pool.request().query("SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'EMB_DIAS_PREPARACION_MATRIZ'");
        const diasColchon = confRes.recordset.length > 0 ? (parseInt(confRes.recordset[0].Valor, 10) || 0) : 0;

        const [fecha] = await calcularFechaCompromiso(pool, 'EMB', [{ magnitud, prioridad }], diasColchon);
        res.json({ fecha });
    } catch (err) {
        logger.error("Error estimando fecha de bordado:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.calcularSituacion = calcularSituacion;
exports.calcularFechaCompromiso = calcularFechaCompromiso;
exports.upsertSnapshotDiario = upsertSnapshotDiario;
