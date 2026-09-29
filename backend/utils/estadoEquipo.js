// ─────────────────────────────────────────────────────────────────────────────
// Estado de las máquinas (ConfigEquipos.Estado) — quién puede recibir trabajo.
//
// Los estados se eligen en Configuración → Equipos: DISPONIBLE · MANTENIMIENTO · OCUPADO.
// MANTENIMIENTO = fuera de servicio: la planificación no le cuenta capacidad (pedido del
// 25/08/2026) y NO recibe lotes/órdenes nuevas, aunque sí se le pueden SACAR los que tiene
// (pedido del 28/09/2026). FALLA lo escribía el reporte de fallas viejo (ya no se usa): mientras
// quede alguna máquina con ese valor, se trata igual que MANTENIMIENTO para no recibir trabajo
// (el tablero de Planeación ya la bloqueaba).
// ─────────────────────────────────────────────────────────────────────────────

const ESTADOS_FUERA_DE_SERVICIO = ['MANTENIMIENTO', 'FALLA'];

// Estados que se pueden elegir (los mismos de Configuración → Equipos).
const ESTADOS_EQUIPO = ['DISPONIBLE', 'MANTENIMIENTO', 'OCUPADO'];

const normalizarEstado = (estado) => String(estado || '').trim().toUpperCase();

const fueraDeServicio = (estado) => ESTADOS_FUERA_DE_SERVICIO.includes(normalizarEstado(estado));

// Condición SQL "la máquina puede recibir trabajo", para filtrar en las búsquedas automáticas
// de máquina (calandra de menos cola, magic sort). `alias` = alias de ConfigEquipos en la consulta.
const sqlEquipoEnServicio = (alias = 'e') =>
    `UPPER(LTRIM(RTRIM(ISNULL(${alias}.Estado, '')))) NOT IN (${ESTADOS_FUERA_DE_SERVICIO.map(e => `'${e}'`).join(', ')})`;

const mensajeFueraDeServicio = (nombre, estado) =>
    `La máquina ${String(nombre || '').trim() || ''} está en ${normalizarEstado(estado)}: no puede recibir trabajo nuevo. ` +
    'Se le pueden sacar los lotes que ya tiene.';

module.exports = {
    ESTADOS_FUERA_DE_SERVICIO,
    ESTADOS_EQUIPO,
    normalizarEstado,
    fueraDeServicio,
    sqlEquipoEnServicio,
    mensajeFueraDeServicio,
};
