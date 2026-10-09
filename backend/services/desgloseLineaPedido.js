'use strict';
/**
 * desgloseLineaPedido.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cómo queda el DESGLOSE (lista / descuento / recargo) de una línea de pedido
 * (PedidosCobranzaDetalle) cuando alguien le cambia el precio A MANO: pre-factura del
 * cierre, "guardar precios" del Panel 360, caja. La lista se conserva; la diferencia
 * contra el nuevo neto queda como descuento o recargo MANUAL, así la línea sigue
 * cumpliendo INV-PRE.03: lista − descuento + recargo = PrecioUnitario (a 2 decimales).
 *
 * Si la pantalla mandó explícitamente descuento/recargo editados (descUnit / recUnit /
 * descPct / recPct), se respetan; el importe del descuento igual absorbe el redondeo.
 * Sin lista guardada (pedido anterior al desglose) no se toca nada.
 */
const r4 = n => Math.round((Number(n || 0) + Number.EPSILON) * 10000) / 10000;
const r2 = n => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

// Regla del recargo (specs/09 INV-PRE.03): el descuento va sobre la lista y cada recargo %
// sobre lo que queda después del descuento (lista − descuento); los recargos se suman.
// Lista 10, descuento 25 % → 7,50; recargo 25 % → +1,875. ESPEJO en src/utils/desglosePrecio.js.
const baseRecargo = (lista, descImp) => Math.max(0, (Number(lista) || 0) - (Number(descImp) || 0));
const recargoDesdePct = (lista, descImp, recPct) => baseRecargo(lista, descImp) * (Number(recPct) || 0) / 100;
const pctRecargoDesdeImporte = (lista, descImp, recImp) => {
  const b = baseRecargo(lista, descImp);
  return b > 0 ? (Number(recImp) || 0) / b * 100 : 0;
};

/**
 * @param {object} actual  fila actual: { PrecioLista, DescuentoTipo, DescuentoPct, DescuentoImporte, DescuentoOrigen, RecargoPct, RecargoImporte, RecargoOrigen }
 * @param {number} nuevoNeto  PrecioUnitario nuevo (unitario, moneda de la línea)
 * @param {object} edit  opcional: { descUnit, recUnit, descPct, recPct, descTexto, recTexto }
 *                       descTexto / recTexto: texto que ve el cliente, si la pantalla lo editó
 *                       ('-' = sin texto; vacío = automático)
 * @param {string} origenTexto  ej. 'Ajuste manual en la pre-factura'
 * @returns {object|null}  columnas a escribir, o null si la línea no tiene lista
 */
function desgloseTrasEdicionManual(actual, nuevoNeto, edit = {}, origenTexto = 'Ajuste manual') {
  if (!actual) return null;
  const neto = r2(nuevoNeto);
  const vino = k => edit && edit[k] != null && edit[k] !== '' && !isNaN(Number(edit[k]));
  let lista = Number(actual.PrecioLista) > 0 ? r4(actual.PrecioLista) : null;
  if (lista == null) {
    // Sin lista guardada (pedido anterior al desglose o línea sin catálogo): si la pantalla
    // editó descuento/recargo, la lista es el precio que tenía la línea, o sea
    // neto + descuento − recargo (lista − descuento + recargo = neto). Sin edición, nada.
    if (!(vino('descUnit') || vino('recUnit') || vino('descPct') || vino('recPct'))) return null;
    const dU = vino('descUnit') ? r4(edit.descUnit) : 0;
    const rU = vino('recUnit') ? r4(edit.recUnit) : 0;
    lista = r4(neto + dU - rU);
    if (!(lista > 0)) return null;
    actual = { ...actual, PrecioLista: lista, DescuentoTipo: null, DescuentoPct: null, DescuentoImporte: null, DescuentoOrigen: null, RecargoPct: null, RecargoImporte: null, RecargoOrigen: null };
  }
  let dTipo = actual.DescuentoTipo || null;
  let dPct = actual.DescuentoPct != null ? r4(actual.DescuentoPct) : null;
  let dImp = actual.DescuentoImporte != null ? r4(actual.DescuentoImporte) : null;
  let dOrig = actual.DescuentoOrigen || null;
  let rPct = actual.RecargoPct != null ? r4(actual.RecargoPct) : null;
  let rImp = actual.RecargoImporte != null ? r4(actual.RecargoImporte) : null;
  let rOrig = actual.RecargoOrigen || null;

  if (vino('descUnit') || vino('recUnit') || vino('descPct') || vino('recPct')) {
    // La pantalla mandó el desglose editado. Un recargo en % se calcula sobre lista − descuento
    // (el descuento editado si vino, si no el que ya tenía la línea).
    const descBase = vino('descUnit') ? r4(edit.descUnit) : (vino('descPct') ? r4(lista * Number(edit.descPct) / 100) : (dImp || 0));
    const nuevoRec = vino('recUnit') ? r4(edit.recUnit) : (vino('recPct') ? r4(recargoDesdePct(lista, descBase, edit.recPct)) : (rImp || 0));
    const cambioRec = Math.abs(nuevoRec - (rImp || 0)) > 0.00005;
    rImp = nuevoRec > 0 ? nuevoRec : null;
    rPct = rImp ? (vino('recPct') ? r4(edit.recPct) : (cambioRec ? null : rPct)) : null;
    rOrig = rImp ? (cambioRec ? origenTexto : rOrig) : null;
    const nuevoDesc = r4(lista + (rImp || 0) - neto);      // absorbe el redondeo
    // Cambio = el descuento pedido difiere del que había; lo que absorbe el redondeo del neto
    // (medio centavo) no cuenta, así no se pierde el origen ("Precio especial" → "Ajuste manual").
    const cambioDesc = Math.abs(descBase - (dImp || 0)) > 0.00005 || (vino('descPct') && dPct != null && Math.abs(r4(edit.descPct) - dPct) > 0.00005)
      || Math.abs(nuevoDesc - descBase) > 0.0051;
    if (nuevoDesc > 0) {
      dImp = nuevoDesc;
      dPct = vino('descPct') ? r4(edit.descPct) : (cambioDesc ? null : dPct);
      dTipo = cambioDesc ? (dPct != null ? 'PCT' : 'MANUAL') : (dTipo || 'MANUAL');
      dOrig = cambioDesc ? origenTexto : dOrig;
    } else {
      dImp = null; dPct = null; dTipo = null; dOrig = null;
    }
  } else {
    // Solo cambió el neto: se conserva lo que había si sigue cerrando; si no, la
    // diferencia contra la lista queda como ajuste manual.
    const diff = r4(lista + (rImp || 0) - neto);
    if (diff >= 0) {
      if (diff > 0) {
        const mismo = dImp != null && Math.abs(dImp - diff) < 0.00005;
        dImp = diff;
        dTipo = mismo && dTipo ? dTipo : 'MANUAL';
        dPct = mismo ? dPct : null;
        dOrig = mismo ? dOrig : origenTexto;
      } else {
        dImp = null; dPct = null; dTipo = null; dOrig = null;
      }
    } else {
      dImp = null; dPct = null; dTipo = null; dOrig = null;
      rImp = r4((rImp || 0) - diff); rPct = null; rOrig = origenTexto;
    }
  }
  // Texto que ve el cliente en la factura, si la pantalla lo editó ('-' = sin texto)
  const txt = (k, max) => { const v = edit && edit[k] != null ? String(edit[k]).trim() : ''; return v ? v.substring(0, max) : ''; };
  if (dImp > 0 && txt('descTexto', 150)) dOrig = txt('descTexto', 150);
  if (rImp > 0 && txt('recTexto', 200)) rOrig = txt('recTexto', 200);
  const manual = dTipo === 'MANUAL' || dTipo === null;
  return {
    PrecioLista: lista,
    DescuentoTipo: dTipo, DescuentoPct: dPct, DescuentoImporte: dImp, DescuentoOrigen: dOrig,
    // el perfil/regla solo tienen sentido si el descuento sigue siendo el del motor
    limpiarRegla: manual,
    RecargoPct: rPct, RecargoImporte: rImp, RecargoOrigen: rOrig
  };
}

module.exports = { desgloseTrasEdicionManual, baseRecargo, recargoDesdePct, pctRecargoDesdeImporte, r2, r4 };
