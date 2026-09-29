'use strict';
// =====================================================================
// ¿Se llega a la fecha que pide el cliente? — estimación de plazo de una Solicitud
// =====================================================================
// Recorre los sectores por los que va a pasar cada producto, EN EL ORDEN REAL de la cadena, y le
// pregunta al motor de capacidad (el mismo de Planificación → calcularFechaCompromiso) cuándo
// terminaría cada uno si el trabajo entrara HOY al final de su cola:
//
//   Sublimación ─► Corte ─► Costura ─► Bordado ─► Estampado
//   DTF / TPU (en paralelo, es el transfer) ──────────┘
//
// Cada sector arranca cuando terminó el anterior (colchón de días = distancia hasta esa fecha).
// Con la última fecha se compara contra la fecha de entrega: SI / RIESGO / NO.
// No crea ni toca nada: solo lee la cola actual de cada área. Si un área no tiene cargada la
// velocidad de sus máquinas (Configuración → Equipos) el motor no puede proyectarla y se avisa.
// =====================================================================
const { getPool } = require('../config/db');
const logger = require('../utils/logger');
const planif = require('../controllers/planificacionController');

const NOMBRE_AREA = { SB: 'Sublimación', TWC: 'Corte', TWT: 'Costura', EMB: 'Bordado', DF: 'DTF', TPU: 'TPU', EST: 'Estampado' };
const MARGEN_RIESGO_DIAS = 2;   // si la estimación cae a menos de esto de la fecha pedida → "en riesgo"

const hoyStr = () => new Date().toISOString().slice(0, 10);
const dias = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
const max = (...f) => f.filter(Boolean).sort().pop() || null;


// Cuánto trabajo le entra a cada sector por este producto (en la unidad con que ese sector mide su capacidad).
function cargasDe(sol, p, archivos) {
  const d = p.Datos || {};
  const prendas = Number(p.Cantidad) || 0;
  const vig = (archivos || []).filter(a => a.Vigente);
  const principal = (p.Partes || []).find(x => x.Tipo === 'PRINCIPAL');
  const parte = (t) => (p.Partes || []).find(x => x.Tipo === t);
  const metrosDe = (parteId) => vig.filter(a => a.ParteID === parteId && a.Rol === 'DISENO_PRONTO').reduce((s, a) => s + (Number(a.AltoM) || 0) * (a.Copias || 1), 0);
  const cargas = [];
  // Sublimación: metros de las tizadas (alto × copias). Sin archivos todavía → estimación gruesa: 1 m por prenda.
  const mSB = principal ? metrosDe(principal.ParteID) : 0;
  cargas.push({ area: 'SB', magnitud: mSB > 0 ? mSB : prendas, estimada: !(mSB > 0), nota: mSB > 0 ? `${mSB.toFixed(2)} m de tela (tizadas)` : `sin tizadas todavía: se estimó 1 m por prenda` });
  if (d.corte?.activo) cargas.push({ area: 'TWC', magnitud: prendas, nota: `${prendas} prendas` });
  if (d.costura?.activo) cargas.push({ area: 'TWT', magnitud: prendas, nota: `${prendas} prendas` });
  const emb = parte('BORDADO');
  if (emb) cargas.push({ area: 'EMB', magnitud: (emb.CantidadTotal || prendas) * (emb.PorPrenda || 1), estimada: true, nota: `${(emb.CantidadTotal || prendas) * (emb.PorPrenda || 1)} bordados (sin puntadas todavía: estimación gruesa)` });
  const df = parte('DTF');
  if (df) { const m = metrosDe(df.ParteID); cargas.push({ area: 'DF', magnitud: m > 0 ? m : (df.CantidadTotal || prendas) * 0.3, estimada: !(m > 0), nota: m > 0 ? `${m.toFixed(2)} m de film` : 'sin archivos todavía: se estimó 0,30 m por estampado' }); }
  const tpu = parte('TPU');
  if (tpu) cargas.push({ area: 'TPU', magnitud: (tpu.CantidadTotal || prendas) * (tpu.PorPrenda || 1), nota: `${(tpu.CantidadTotal || prendas) * (tpu.PorPrenda || 1)} parches` });
  if (df || tpu) cargas.push({ area: 'EST', magnitud: (df ? (df.CantidadTotal || prendas) * (df.PorPrenda || 1) : 0) + (tpu ? (tpu.CantidadTotal || prendas) * (tpu.PorPrenda || 1) : 0), nota: 'bajadas de estampado' });
  return cargas;
}

async function estimarProducto(pool, sol, p, archivos, colchonEmb) {
  const hoy = hoyStr();
  const cargas = cargasDe(sol, p, archivos);
  const fin = {};          // area → fecha estimada (o null)
  const sectores = [];

  const correr = async (c, empiezaDespuesDe) => {
    const arranque = max(...empiezaDespuesDe.map(a => fin[a]));
    const colchon = (arranque ? Math.max(0, dias(hoy, arranque)) : 0) + (c.area === 'EMB' ? colchonEmb : 0);
    let fecha = null, tieneCapacidad = true, carga = null;
    try {
      [fecha] = await planif.calcularFechaCompromiso(pool, c.area, [{ magnitud: c.magnitud, prioridad: 'Normal' }], colchon);
      // calcularSituacion SOLO lee (getCapacidad, en cambio, guarda la foto diaria en HistoricoCapacidadDiaria).
      const sit = await planif.calcularSituacion(pool, c.area, { desde: hoy, dias: 30 });
      tieneCapacidad = sit.tieneCapacidad !== false;
      carga = tieneCapacidad ? { pendiente: sit.cargaPendienteTotal, ordenes: sit.cantidadOrdenesPendientes, capacidadDia: sit.capacidadDiaHoy, unidad: sit.unidad, agotamiento: sit.fechaAgotamiento } : null;
    } catch (e) { logger.warn(`[SOLICITUDES] plazo ${c.area}: ${e.message}`); }
    if (fecha === null && tieneCapacidad === true) tieneCapacidad = false;   // el motor no pudo proyectar
    // Sector sin capacidad cargada: no suma días (no se sabe cuántos), pero PASA la fecha del anterior hacia
    // adelante — si no, los sectores que vienen después arrancarían "hoy" y la estimación saldría optimista.
    fin[c.area] = fecha || arranque || null;
    sectores.push({ area: c.area, nombre: NOMBRE_AREA[c.area], magnitud: Math.round(c.magnitud * 100) / 100, nota: c.nota, estimada: !!c.estimada,
      empiezaDespuesDe: empiezaDespuesDe.filter(a => fin[a]).map(a => NOMBRE_AREA[a]), colchonDias: colchon, fechaEstimada: fecha, tieneCapacidad, carga });
  };

  const tiene = (a) => cargas.some(c => c.area === a);
  const c = (a) => cargas.find(x => x.area === a);
  await correr(c('SB'), []);
  if (tiene('TWC')) await correr(c('TWC'), ['SB']);
  if (tiene('TWT')) await correr(c('TWT'), ['TWC']);
  if (tiene('DF')) await correr(c('DF'), []);
  if (tiene('TPU')) await correr(c('TPU'), []);
  const prendaLista = tiene('TWT') ? 'TWT' : tiene('TWC') ? 'TWC' : 'SB';
  if (tiene('EMB')) await correr(c('EMB'), [prendaLista]);
  if (tiene('EST')) await correr(c('EST'), [tiene('EMB') ? 'EMB' : prendaLista, 'DF', 'TPU'].filter(tiene));

  const fechaFin = max(...sectores.map(s => s.fechaEstimada));
  const sinProyeccion = sectores.filter(s => !s.tieneCapacidad).map(s => s.nombre);
  return { productoSolId: p.ProductoSolID, nombre: p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || 'Producto terminado') : 'Producto personalizado', prendas: Number(p.Cantidad) || 0, sectores, fechaEstimadaFin: fechaFin, sinProyeccion };
}

/**
 * @returns {{ fechaEntrega, fechaEstimadaFin, veredicto: 'SI'|'RIESGO'|'NO'|'SIN_FECHA'|'SIN_DATOS', margenDias, productos: [...] }}
 */
async function estimarPlazo(sol) {
  const pool = await getPool();
  const conf = await pool.request().query("SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'EMB_DIAS_PREPARACION_MATRIZ'");
  const colchonEmb = conf.recordset.length ? (parseInt(conf.recordset[0].Valor, 10) || 0) : 0;
  const productos = [];
  for (const p of sol.Productos.filter(x => !x.PedidoNoDocERP)) productos.push(await estimarProducto(pool, sol, p, sol.Archivos, colchonEmb));

  const fechaEntrega = sol.FechaEntrega ? new Date(sol.FechaEntrega).toISOString().slice(0, 10) : null;
  const fechaFin = max(...productos.map(x => x.fechaEstimadaFin));
  const sinProyeccion = [...new Set(productos.flatMap(x => x.sinProyeccion))];
  let veredicto = 'SIN_DATOS', margenDias = null;
  if (fechaFin && fechaEntrega) {
    margenDias = dias(fechaFin, fechaEntrega);
    veredicto = margenDias < 0 ? 'NO' : margenDias < MARGEN_RIESGO_DIAS ? 'RIESGO' : 'SI';
  } else if (fechaFin && !fechaEntrega) veredicto = 'SIN_FECHA';

  return { generadoEn: new Date().toISOString(), hoy: hoyStr(), fechaEntrega, fechaEstimadaFin: fechaFin, veredicto, margenDias, margenRiesgoDias: MARGEN_RIESGO_DIAS, sinProyeccion, productos };
}

module.exports = { estimarPlazo, cargasDe };
