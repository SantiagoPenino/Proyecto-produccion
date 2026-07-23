/**
 * urgenciaDescuentoRolloService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Recargo de metros de "rollo por adelantado" (PlanesMetros) para órdenes
 * marcadas Urgente cuyo recargo de urgencia NO se cobró en dinero (el
 * cliente tiene una fila matching en UrgenciaExcepciones).
 *
 * Regla de negocio: si no se cobra la urgencia en $, el cliente igual paga
 * ese costo — pero en metros: la orden consume los metros normales MÁS un
 * % adicional (recargo) del rollo por adelantado. NO es una bonificación:
 * el cliente termina consumiendo MÁS metros, nunca menos.
 *
 * Se registra como un movimiento SEPARADO (MovTipo='RECARGO_URGENCIA') en
 * vez de sumarlo al ENTREGA original, para que quede visible en el estado
 * de cuenta con su propia explicación, ligado a la orden.
 *
 * Modo de rollout (ConfiguracionGlobal.URGENCIA_DESCUENTO_ROLLO_MODO):
 *   PILOTO (default) — lista blanca: el recargo SOLO aplica a los clientes
 *                       que estén en UrgenciaDescuentoRolloExcepciones (Activo=1).
 *   TODOS             — lista negra: aplica a todos los clientes MENOS los
 *                       que estén en esa misma tabla.
 * Es la misma tabla en los dos modos — solo cambia cómo se la interpreta.
 *
 * Debe llamarse DENTRO de la misma transacción donde se descontó el plan
 * (hookEntregaMetros / consumirRecursoAdelantado). Nunca debe romper el
 * flujo principal de la orden: cualquier error acá solo se loguea.
 * ──────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { sql } = require('../config/db');
const logger  = require('../utils/logger');

const PCT_FALLBACK = 25;

/**
 * @param {object} params
 *   @param {object} transaction        Transacción sql activa (obligatoria)
 *   @param {number} OrdIdOrden
 *   @param {number} CliIdCliente
 *   @param {number} ProIdProducto
 *   @param {number} PlaIdPlan          Plan de metros que se está descontando
 *   @param {number} CueIdCuenta        Cuenta MTS asociada al plan
 *   @param {number} metrosConsumidos   Metros recién debitados del plan en esta operación (base sobre la que se calcula el recargo)
 *   @param {number} UsuarioAlta
 *   @param {string} CodigoOrden
 * @returns {Promise<{recargo:number, MovIdGenerado:number}|null>}
 */
async function aplicarRecargoUrgenciaRollo({
  transaction, OrdIdOrden, CliIdCliente, ProIdProducto,
  PlaIdPlan, CueIdCuenta, metrosConsumidos, UsuarioAlta, CodigoOrden,
}) {
  if (!transaction || !OrdIdOrden || !CliIdCliente || !PlaIdPlan || !CueIdCuenta) return null;
  if (!metrosConsumidos || metrosConsumidos <= 0) return null;

  const req = () => new sql.Request(transaction);

  try {
    // 1. Flag general + porcentaje + modo configurados
    const cfgRes = await req().query(`
      SELECT Clave, Valor FROM dbo.ConfiguracionGlobal
      WHERE Clave IN ('URGENCIA_DESCUENTO_ROLLO_ACTIVO','URGENCIA_DESCUENTO_ROLLO_PORCENTAJE','URGENCIA_DESCUENTO_ROLLO_MODO')
    `);
    const cfg = {};
    cfgRes.recordset.forEach(r => { cfg[r.Clave] = r.Valor; });
    if (cfg['URGENCIA_DESCUENTO_ROLLO_ACTIVO'] !== '1') return null;

    const pct = parseFloat(cfg['URGENCIA_DESCUENTO_ROLLO_PORCENTAJE']);
    const pctFinal = (pct > 0 && pct <= 100) ? pct : PCT_FALLBACK;
    const modoPiloto = (cfg['URGENCIA_DESCUENTO_ROLLO_MODO'] || 'TODOS') === 'PILOTO';

    // 2. La orden debe ser Urgente
    const ordRes = await req()
      .input('OrdId', sql.Int, OrdIdOrden)
      .query(`SELECT TOP 1 Prioridad, AreaID FROM dbo.Ordenes WITH(NOLOCK) WHERE OrdenID = @OrdId`);
    const orden = ordRes.recordset[0];
    if (!orden || orden.Prioridad !== 'Urgente') return null;

    // 3. Excepción de urgencia — misma consulta que pricingService.js para decidir
    //    si el recargo de urgencia no se cobró en $ (exención total, por artículo o por área)
    const excRes = await req()
      .input('CliId',   sql.Int,         CliIdCliente)
      .input('ProId',   sql.Int,         ProIdProducto || -1)
      .input('CodArea', sql.VarChar(20), (orden.AreaID || '').trim())
      .query(`
        SELECT TOP 1 ID FROM dbo.UrgenciaExcepciones
        WHERE CliIdCliente = @CliId AND Activo = 1
          AND (
            (ProIdProducto IS NULL AND CodArea IS NULL)
            OR ProIdProducto = @ProId
            OR CodArea = @CodArea
          )
      `);
    if (excRes.recordset.length === 0) return null;

    // 4. Tabla de clientes — su significado depende del modo:
    //    PILOTO = lista blanca (solo aplica si el cliente ESTÁ en la tabla)
    //    TODOS  = lista negra (aplica salvo que el cliente ESTÉ en la tabla)
    const listaRes = await req()
      .input('CliId', sql.Int, CliIdCliente)
      .query(`SELECT TOP 1 ID FROM dbo.UrgenciaDescuentoRolloExcepciones WHERE CliIdCliente = @CliId AND Activo = 1`);
    const clienteEnLista = listaRes.recordset.length > 0;

    if (modoPiloto && !clienteEnLista) {
      logger.info(`[RECARGO_URGENCIA_ROLLO] Modo PILOTO: cliente ${CliIdCliente} no está en la lista — no paga recargo.`);
      return null;
    }
    if (!modoPiloto && clienteEnLista) {
      logger.info(`[RECARGO_URGENCIA_ROLLO] Modo TODOS: cliente ${CliIdCliente} está excluido — no paga recargo.`);
      return null;
    }

    // 5. Aplicar recargo: consumir metros ADICIONALES del plan + movimiento visible en el estado de cuenta
    const recargo = Math.round(metrosConsumidos * (pctFinal / 100) * 10000) / 10000;
    if (recargo <= 0) return null;

    const planRes = await req()
      .input('PlaId', sql.Int, PlaIdPlan)
      .query(`SELECT PlaCantidadTotal, PlaCantidadUsada FROM dbo.PlanesMetros WHERE PlaIdPlan = @PlaId`);
    const planRow = planRes.recordset[0];
    const nuevaUsada = (Number(planRow?.PlaCantidadUsada) || 0) + recargo;
    const nuevoActivo = (planRow && nuevaUsada >= Number(planRow.PlaCantidadTotal)) ? 0 : 1;

    await req()
      .input('Usada', sql.Decimal(18, 4), nuevaUsada)
      .input('Activo', sql.Bit, nuevoActivo)
      .input('PlaId', sql.Int, PlaIdPlan)
      .query(`
        UPDATE dbo.PlanesMetros
        SET PlaCantidadUsada = @Usada,
            PlaActivo = @Activo
        WHERE PlaIdPlan = @PlaId
      `);

    // Requiere registrarMovimiento en tiempo de llamada (no al cargar el módulo) para
    // evitar dependencia circular con contabilidadService.js, que a su vez puede
    // requerir este archivo.
    const { registrarMovimiento } = require('./contabilidadService');

    const codigoLabel = CodigoOrden || ('Orden #' + OrdIdOrden);
    const { MovIdGenerado } = await registrarMovimiento({
      CueIdCuenta,
      MovTipo:          'RECARGO_URGENCIA',
      MovConcepto:      `Recargo urgencia ${pctFinal}% — ${codigoLabel}`,
      MovImporte:       -recargo,
      MovUsuarioAlta:   UsuarioAlta,
      OrdIdOrden,
      MovObservaciones: `Recargo de ${pctFinal}% en metros por urgencia no cobrada en $ (Plan #${PlaIdPlan}) — ${codigoLabel}`,
    }, transaction);

    logger.info(`[RECARGO_URGENCIA_ROLLO] Recargados ${recargo} mts a CliId=${CliIdCliente} Orden=${codigoLabel} Plan=${PlaIdPlan} Mov=${MovIdGenerado}`);
    return { recargo, MovIdGenerado };
  } catch (err) {
    logger.error('[RECARGO_URGENCIA_ROLLO] Error aplicando recargo (no interrumpe la orden):', err.message);
    return null;
  }
}

module.exports = { aplicarRecargoUrgenciaRollo };
