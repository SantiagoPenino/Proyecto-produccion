/**
 * Regla de cálculo de una línea con descuento y recargo (specs/09 INV-PRE.03).
 *
 * El descuento se calcula sobre la LISTA; cada recargo % (urgencia, tinta, manual) se
 * calcula sobre lo que queda después del descuento (lista − descuento) y los recargos se
 * suman entre sí:
 *   lista 10, descuento 25 % → 7,50; recargo 25 % → +1,875; unitario 9,375.
 * Los importes siguen cumpliendo lista − descuento + recargo = unitario.
 *
 * Tiene un ESPEJO en backend/services/desgloseLineaPedido.js (recargoDesdePct /
 * pctRecargoDesdeImporte): si se cambia uno, cambiar el otro.
 */

// Base sobre la que se calcula el recargo: lista − descuento (nunca negativa).
export const baseRecargo = (lista, descImp) => Math.max(0, (Number(lista) || 0) - (Number(descImp) || 0));

// Importe del recargo a partir del %.
export const recargoDesdePct = (lista, descImp, recPct) => baseRecargo(lista, descImp) * (Number(recPct) || 0) / 100;

// % del recargo a partir del importe (0 si no hay base).
export const pctRecargoDesdeImporte = (lista, descImp, recImp) => {
  const b = baseRecargo(lista, descImp);
  return b > 0 ? (Number(recImp) || 0) / b * 100 : 0;
};

// Redondeo a centavos, mitad hacia arriba. toFixed(2) a secas redondea mal los ,xx5 que
// salen de multiplicar (45,20 × 0,75 × 0,25 = 8,475 da 8,47 porque en binario es 8,4749…).
export const redondear2 = n => Math.round(Number(((Number(n) || 0) * 100).toFixed(6))) / 100;

// Factor que lleva la lista al unitario final cuando descuento y recargo vienen en %.
export const factorDescRec = (descPct, recPct) => (1 - (Number(descPct) || 0) / 100) * (1 + (Number(recPct) || 0) / 100);
