/**
 * pagosTransaccionService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Deja los Pagos de una transacción de caja como los pide la edición de un documento
 * contado (cfeController.editarFactura) SIN perder el id de los Pagos que siguen siendo
 * los mismos.
 *
 * Por qué existe: editarFactura hacía DELETE FROM dbo.Pagos WHERE PagTcaIdTransaccion + INSERT.
 * El Pago nuevo nacía con otro PagIdPago y las imputaciones (ImputacionPago) y el libro
 * (MovimientosCuenta, tipo PAGO) seguían apuntando al id borrado: 3.694 documentos / 991
 * clientes entre el 24/06 y el 07/10/2026 (ver scripts/PROD_diag_pagos_recreados_por_edicion.sql).
 * Además el Pago nuevo no traía PagRutaComprobante / PagIdCheque / PagTipoMovimiento originales.
 *
 * Qué hace ahora, en la misma transacción del llamador:
 *   1. Empareja cada Pago nuevo con uno existente: primero idénticos (mismo medio, moneda y
 *      monto), después mismo medio y moneda con otro monto.
 *   2. Los emparejados se ACTUALIZAN en el lugar (mismo PagIdPago): nada que re-vincular, y
 *      conservan comprobante, cheque, tipo y usuario original.
 *   3. Lo que no empareja se reemplaza: se inserta el Pago nuevo, se re-vinculan al nuevo las
 *      cuatro tablas que guardan PagIdPago (ImputacionPago, MovimientosCuenta, OrdenesRetiro,
 *      OrdenesDeposito) y recién ahí se borra el viejo. Si sobran Pagos viejos, sus vínculos
 *      pasan al de menor id que queda.
 *   Los Pagos 'ANULADO' de la transacción no se tocan.
 */
'use strict';

// ../config/db se carga recién al ejecutar: así planificarSincronizacion (pura) se prueba sin base ni logger.
let _sql = null;
const getSql = () => (_sql || (_sql = require('../config/db').sql));

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Función pura: decide qué hacer con cada Pago. No toca la base.
 * @param {Array<{PagIdPago:number, MPaIdMetodoPago:number, PagIdMonedaPago:number, PagMontoPago:number}>} viejos
 *        Pagos vigentes de la transacción, en orden de id.
 * @param {Array<{metodoPagoId:number, monedaId:number, monto:number}>} nuevos  lo que debe quedar.
 * @returns {{pares:Array<{viejo:object,n:number,cambiaMonto:boolean}>,
 *            reemplazos:Array<{viejo:object,n:number}>, insertar:number[], absorber:object[]}}
 */
function planificarSincronizacion(viejos, nuevos) {
  const usadoV = new Set();
  const usadoN = new Set();
  const pares = [];
  const mismoMedio = (v, n) =>
    Number(v.MPaIdMetodoPago) === Number(n.metodoPagoId) && Number(v.PagIdMonedaPago) === Number(n.monedaId);

  // 1) idénticos
  nuevos.forEach((n, i) => {
    const j = viejos.findIndex((v, k) => !usadoV.has(k) && mismoMedio(v, n) && r2(v.PagMontoPago) === r2(n.monto));
    if (j >= 0) { usadoV.add(j); usadoN.add(i); pares.push({ viejo: viejos[j], n: i, cambiaMonto: false }); }
  });
  // 2) mismo medio y moneda, otro monto
  nuevos.forEach((n, i) => {
    if (usadoN.has(i)) return;
    const j = viejos.findIndex((v, k) => !usadoV.has(k) && mismoMedio(v, n));
    if (j >= 0) { usadoV.add(j); usadoN.add(i); pares.push({ viejo: viejos[j], n: i, cambiaMonto: true }); }
  });

  const sobranV = viejos.filter((_, k) => !usadoV.has(k));
  const sobranN = nuevos.map((_, i) => i).filter(i => !usadoN.has(i));
  const m = Math.min(sobranV.length, sobranN.length);
  const reemplazos = [];
  for (let i = 0; i < m; i++) reemplazos.push({ viejo: sobranV[i], n: sobranN[i] });
  return { pares, reemplazos, insertar: sobranN.slice(m), absorber: sobranV.slice(m) };
}

/**
 * @param {sql.Transaction} transaction  transacción abierta del llamador
 * @param {number} tcaId
 * @param {Array<{metodoPagoId:number, monedaId:number, monto:number, cotizacion:number, convertido:number}>} nuevos
 * @param {{fecha?:Date|null, usuarioId?:number|null}} [opts]
 *        fecha: fecha del documento (los Pagos nuevos/cambiados de día la siguen). usuarioId: alta de los insertados.
 * @returns {Promise<{sinCambios:number, actualizados:number, reemplazados:number, insertados:number, absorbidos:number, mapa:Array<{viejo:number,nuevo:number}>}>}
 */
async function sincronizarPagosDeTransaccion(transaction, tcaId, nuevos, { fecha = null, usuarioId = null } = {}) {
  const sql = getSql();
  if (!Array.isArray(nuevos) || nuevos.length === 0) {
    throw new Error('sincronizarPagosDeTransaccion: no hay Pagos nuevos; no se toca nada.');
  }

  const viejosRes = await transaction.request()
    .input('tca', sql.Int, tcaId)
    .query(`SELECT PagIdPago, MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago
            FROM dbo.Pagos
            WHERE PagTcaIdTransaccion = @tca AND ISNULL(PagTipoMovimiento, '') <> 'ANULADO'
            ORDER BY PagIdPago`);
  const plan = planificarSincronizacion(viejosRes.recordset, nuevos);

  const resumen = { sinCambios: 0, actualizados: 0, reemplazados: 0, insertados: 0, absorbidos: 0, mapa: [] };
  const idsFinales = [];

  // La fecha del Pago solo se mueve si cambió el DÍA (la hora real de cobro se conserva).
  const SET_FECHA = `PagFechaPago = CASE WHEN @fecha IS NULL OR CAST(PagFechaPago AS date) = CAST(@fecha AS date)
                                          THEN PagFechaPago ELSE @fecha END`;

  for (const p of plan.pares) {
    const n = nuevos[p.n];
    idsFinales.push(p.viejo.PagIdPago);
    const rq = transaction.request()
      .input('id', sql.Int, p.viejo.PagIdPago)
      .input('fecha', sql.DateTime, fecha);
    if (p.cambiaMonto) {
      await rq
        .input('monto', sql.Decimal(18, 4), n.monto)
        .input('cot', sql.Decimal(18, 4), n.cotizacion)
        .input('conv', sql.Decimal(18, 4), n.convertido)
        .query(`UPDATE dbo.Pagos
                SET PagMontoPago = @monto, PagCotizacion = @cot, PagMontoConvertido = @conv, ${SET_FECHA}
                WHERE PagIdPago = @id`);
      resumen.actualizados++;
    } else {
      const r = await rq.query(`UPDATE dbo.Pagos SET ${SET_FECHA} WHERE PagIdPago = @id`);
      if ((r.rowsAffected?.[0] || 0) > 0) resumen.sinCambios++;
    }
  }

  const insertarPago = async (n) => {
    const r = await transaction.request()
      .input('tcaId', sql.Int, tcaId)
      .input('metodo', sql.Int, n.metodoPagoId)
      .input('moneda', sql.Int, n.monedaId)
      .input('monto', sql.Decimal(18, 4), n.monto)
      .input('cot', sql.Decimal(18, 4), n.cotizacion)
      .input('conv', sql.Decimal(18, 4), n.convertido)
      .input('usuario', sql.Int, usuarioId)
      .input('fecha', sql.DateTime, fecha)
      .query(`INSERT INTO dbo.Pagos
                (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago,
                 PagUsuarioAlta, PagCotizacion, PagMontoConvertido, PagTipoMovimiento)
              OUTPUT INSERTED.PagIdPago
              VALUES (@tcaId, @metodo, @moneda, @monto, ISNULL(@fecha, GETDATE()), @usuario, @cot, @conv, 'COBRO')`);
    const id = r.recordset[0].PagIdPago;
    idsFinales.push(id);
    return id;
  };

  const aBorrar = [];
  for (const rp of plan.reemplazos) {
    const nuevoId = await insertarPago(nuevos[rp.n]);
    resumen.mapa.push({ viejo: rp.viejo.PagIdPago, nuevo: nuevoId });
    aBorrar.push(rp.viejo.PagIdPago);
    resumen.reemplazados++;
  }
  for (const i of plan.insertar) {
    await insertarPago(nuevos[i]);
    resumen.insertados++;
  }
  if (plan.absorber.length) {
    const destino = Math.min(...idsFinales);
    for (const v of plan.absorber) {
      resumen.mapa.push({ viejo: v.PagIdPago, nuevo: destino });
      aBorrar.push(v.PagIdPago);
      resumen.absorbidos++;
    }
  }

  // Re-vincular ANTES de borrar: lo que apuntaba al Pago viejo pasa al que lo reemplaza.
  for (const { viejo, nuevo } of resumen.mapa) {
    await transaction.request()
      .input('viejo', sql.Int, viejo)
      .input('nuevo', sql.Int, nuevo)
      .query(`UPDATE dbo.ImputacionPago  SET PagIdPago = @nuevo WHERE PagIdPago = @viejo;
              UPDATE dbo.MovimientosCuenta SET PagIdPago = @nuevo WHERE PagIdPago = @viejo;
              UPDATE dbo.OrdenesRetiro    SET PagIdPago = @nuevo WHERE PagIdPago = @viejo;
              UPDATE dbo.OrdenesDeposito  SET PagIdPago = @nuevo WHERE PagIdPago = @viejo;`);
  }
  for (const id of aBorrar) {
    await transaction.request().input('id', sql.Int, id).query('DELETE FROM dbo.Pagos WHERE PagIdPago = @id');
  }

  return resumen;
}

module.exports = { sincronizarPagosDeTransaccion, planificarSincronizacion };
