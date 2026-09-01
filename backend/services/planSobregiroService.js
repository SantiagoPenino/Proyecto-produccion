/**
 * planSobregiroService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Traspaso del SOBREGIRO de metros al plan que se acaba de cargar.
 *
 * El problema que resuelve: cuando una orden consume más metros de los que le
 * quedan al plan, el movimiento se registra completo en la CUENTA (que puede
 * ir a negativo) pero `PlanesMetros.PlaCantidadUsada` no puede pasar de
 * `PlaCantidadTotal` — el plan se cierra diciendo "restante 0" y esos metros
 * de más quedan viviendo solo en la cuenta. Si el plan siguiente arranca de
 * cero, la barra del plan muestra más metros de los que el cliente realmente
 * tiene, y el motor de cobertura —que decide sobre el plan, no sobre la
 * cuenta— se los vuelve a entregar.
 *
 * CÓMO SE MIDE EL SOBREGIRO
 * Por diferencia entre los dos números que las pantallas comparan:
 *
 *     sobregiro = (restante de los planes ACTIVOS) − (saldo de la cuenta)
 *
 * No por el texto de las observaciones. Se intentó primero buscando los
 * movimientos 'Exceso s/ Plan #N' y 'Negativo retroactivo … Plan #N', pero los
 * datos de producción (28-ago-2026) mostraron que no alcanza: la cuenta de
 * Dry Microporoso de Támara flores difería en 54,64 mts y solo 53,75 estaban
 * etiquetados, y su cuenta de NeoStretch difería en 2,385 sin un solo
 * movimiento etiquetado. Cualquier camino nuevo que descuadre plan y cuenta
 * quedaría afuera del criterio por texto; la resta los toma a todos.
 *
 * Efecto secundario bueno: es auto-idempotente. Al absorber, el restante del
 * plan baja hasta igualar el saldo de la cuenta, así que la diferencia queda
 * en 0 y una segunda pasada no absorbe nada. No hace falta marcar movimientos.
 *
 * Cuándo NO hace nada: si la diferencia es negativa (la cuenta tiene MÁS que
 * los planes) no se toca nada. Ese es el otro descuadre —saldo de cuenta sin
 * movimientos que lo respalden, secuela del tacho sobre la ENTRADA— y se
 * repara caso por caso, nunca inflando el plan.
 *
 * Lo usan las TRES puertas por las que se cargan metros: crearPlan y
 * recargarPlan (contabilidadController) y la venta de rollo desde caja
 * (cajaService). Antes solo crearPlan heredaba el sobregiro.
 *
 * IMPORTANTE para quien lo llame: la resta solo da bien cuando el plan y la
 * cuenta están los dos actualizados. Llamar DESPUÉS de haber sumado los metros
 * al plan Y registrado el movimiento de ENTRADA (o antes de las dos cosas, como
 * hace crearPlan) — nunca en el medio.
 *
 * Nunca debe romper el flujo principal: cualquier error acá se loguea y se
 * devuelve absorbido = 0.
 * ──────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Sobregiro pendiente de una cuenta de recursos.
 *
 * @param {number} CueIdCuenta
 * @param {function} makeReq  Fábrica de sql.Request (con o sin transacción)
 * @returns {Promise<{sobregiro:number, saldoCuenta:number, restantePlanes:number}>}
 *          sobregiro > 0 → metros que los planes muestran de más
 *          sobregiro = 0 → plan y cuenta coinciden, o la cuenta tiene de más
 */
async function calcularSobregiro(CueIdCuenta, makeReq) {
  const res = await makeReq()
    .input('Cue', sql.Int, parseInt(CueIdCuenta))
    .query(`
      SELECT
        ISNULL(cc.CueSaldoActual, 0) AS SaldoCuenta,
        ISNULL((
          SELECT SUM(p.PlaCantidadTotal - p.PlaCantidadUsada)
          FROM dbo.PlanesMetros p WITH(UPDLOCK, ROWLOCK)
          WHERE p.CueIdCuenta = cc.CueIdCuenta AND p.PlaActivo = 1
        ), 0) AS RestantePlanes
      FROM dbo.CuentasCliente cc WITH(UPDLOCK, ROWLOCK)
      WHERE cc.CueIdCuenta = @Cue
    `);

  const row = res.recordset[0];
  if (!row) return { sobregiro: 0, saldoCuenta: 0, restantePlanes: 0 };

  const saldoCuenta    = Math.round(Number(row.SaldoCuenta) * 10000) / 10000;
  const restantePlanes = Math.round(Number(row.RestantePlanes) * 10000) / 10000;
  const dif            = Math.round((restantePlanes - saldoCuenta) * 10000) / 10000;

  return { sobregiro: dif > 0 ? dif : 0, saldoCuenta, restantePlanes };
}

/**
 * Absorbe el sobregiro en un plan que YA EXISTE (recarga o alta), sumándolo a
 * PlaCantidadUsada. No toca CueSaldoActual: la cuenta ya tiene la verdad.
 *
 * @param {object} params
 *   @param {number}  params.PlaIdPlan
 *   @param {number?} params.CueIdCuenta  Si no viene, se toma la del plan
 *   @param {number?} params.Capacidad    Tope a absorber (lo recién cargado). Si no
 *                                        viene, se usa lo que le queda libre al plan.
 * @param {object?} transaction  Transacción activa; si no viene, va contra el pool.
 * @returns {Promise<{absorbido:number, sobrante:number, saldoCuenta:number}>}
 */
async function absorberSobregiroEnPlan({ PlaIdPlan, CueIdCuenta = null, Capacidad = null }, transaction = null) {
  const vacio = { absorbido: 0, sobrante: 0, saldoCuenta: 0 };
  if (!PlaIdPlan) return vacio;

  try {
    const pool = transaction ? null : await getPool();
    const makeReq = () => (transaction ? new sql.Request(transaction) : pool.request());

    const planRes = await makeReq()
      .input('PlaId', sql.Int, parseInt(PlaIdPlan))
      .query(`
        SELECT PlaIdPlan, CueIdCuenta, PlaCantidadTotal, PlaCantidadUsada
        FROM dbo.PlanesMetros WITH(UPDLOCK, ROWLOCK)
        WHERE PlaIdPlan = @PlaId
      `);
    const plan = planRes.recordset[0];
    if (!plan) return vacio;

    const cueId = CueIdCuenta ?? plan.CueIdCuenta;
    const total = parseFloat(plan.PlaCantidadTotal) || 0;
    const usada = parseFloat(plan.PlaCantidadUsada) || 0;
    const libre = Math.round((total - usada) * 10000) / 10000;

    const cap = Capacidad !== null && Capacidad !== undefined
      ? Math.min(parseFloat(Capacidad), libre)
      : libre;
    if (cap <= 0) return vacio;

    const { sobregiro, saldoCuenta, restantePlanes } = await calcularSobregiro(cueId, makeReq);
    if (sobregiro <= 0) return { ...vacio, saldoCuenta };

    const absorbido = Math.min(sobregiro, cap);
    const sobrante  = Math.round((sobregiro - absorbido) * 10000) / 10000;

    const nuevaUsada  = Math.round((usada + absorbido) * 10000) / 10000;
    const nuevoActivo = nuevaUsada >= total ? 0 : 1;

    await makeReq()
      .input('PlaId',  sql.Int,           parseInt(PlaIdPlan))
      .input('Usada',  sql.Decimal(18,4), nuevaUsada)
      .input('Activo', sql.Bit,           nuevoActivo)
      .query('UPDATE dbo.PlanesMetros SET PlaCantidadUsada = @Usada, PlaActivo = @Activo WHERE PlaIdPlan = @PlaId');

    logger.info(`[SOBREGIRO] Plan #${PlaIdPlan} (cuenta ${cueId}): planes activos mostraban ${restantePlanes} contra ${saldoCuenta} en la cuenta. ` +
      `Absorbidos ${absorbido} — usada ${usada} → ${nuevaUsada}.` +
      (sobrante > 0 ? ` Quedan ${sobrante} sin absorber para la próxima carga de metros.` : ''));

    return { absorbido, sobrante, saldoCuenta };
  } catch (err) {
    logger.error(`[SOBREGIRO] Error absorbiendo sobregiro en el plan #${PlaIdPlan} (no interrumpe la carga de metros): ${err.message}`);
    return vacio;
  }
}

module.exports = {
  calcularSobregiro,
  absorberSobregiroEnPlan,
};
