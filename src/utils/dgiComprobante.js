/**
 * dgiComprobante — Requisitos de DGI para el documento del RECEPTOR según el tipo de CFE.
 *
 * Única fuente de verdad de estas reglas (antes vivían sueltas dentro de FacturacionManualModal).
 * La usan la Facturación Manual y la Venta de Rollo por Adelantado, para que las dos validen igual.
 *
 * Reglas:
 *   · e-Factura (111): el receptor DEBE tener RUT válido (12 dígitos). Sin RUT no se puede emitir.
 *   · e-Ticket (101): si el total supera el umbral DGI (X UI) hay que identificar al comprador
 *                     con CI o RUT válido. Por debajo del umbral, el documento es opcional, pero
 *                     si se carga uno tiene que ser válido.
 *   · Pedido Caja / sin documento: no va a DGI, no se valida.
 */

import { validarDocumentoUY } from './documentoUY';

/** ¿El código o etiqueta corresponde a una e-Factura de venta (no NC/ND)? */
export function esEFactura(tipo) {
  const t = String(tipo || '').toUpperCase();
  // Códigos: 01 contado, 02 crédito. Etiqueta: "E-FACTURA ..." sin "NOTA".
  return (t === '01' || t === '02' || (t.includes('FACTURA') && !t.includes('NOTA')));
}

/** ¿El código o etiqueta corresponde a un e-Ticket de venta (no NC/ND)? */
export function esETicket(tipo) {
  const t = String(tipo || '').toUpperCase();
  // Códigos: 07 contado, 08 crédito. Etiqueta: "E-TICKET ..." sin "NOTA".
  return (t === '07' || t === '08' || (t.includes('TICKET') && !t.includes('NOTA')));
}

/**
 * Evalúa si el documento del receptor cumple con DGI para el tipo elegido.
 *
 * @param {Object} p
 *   @param {string} p.tipoDoc     código ('01','07',...) o etiqueta del comprobante
 *   @param {string} p.documento   RUT/CI del receptor (lo que hay en la ficha del cliente)
 *   @param {number} p.totalUYU    total del comprobante convertido a pesos
 *   @param {number} p.umbralUYU   umbral en pesos a partir del cual el e-Ticket exige identificar
 * @returns {{ nivel:'ok'|'error'|'aviso', ok:boolean, mensaje:string }}
 *   nivel 'error' = no se puede emitir; 'aviso' = se puede pero conviene mirar; 'ok' = todo bien.
 */
export function evaluarDocumentoDGI({ tipoDoc, documento, totalUYU = 0, umbralUYU = 0 }) {
  const factura = esEFactura(tipoDoc);
  const ticket = esETicket(tipoDoc);

  // No es un CFE fiscal (Pedido Caja, sin documento): nada que validar.
  if (!factura && !ticket) return { nivel: 'ok', ok: true, mensaje: '' };

  const docStr = String(documento || '').trim();
  const v = validarDocumentoUY(docStr);

  if (factura) {
    if (!docStr) {
      return { nivel: 'error', ok: false, mensaje: 'La e-Factura requiere el RUT del cliente (12 dígitos). Cargalo en la ficha o elegí e-Ticket.' };
    }
    if (!v.valido) {
      return { nivel: 'error', ok: false, mensaje: `Documento inválido: ${v.motivo}. La e-Factura requiere un RUT válido.` };
    }
    if (v.tipo !== 'RUT') {
      return { nivel: 'error', ok: false, mensaje: 'El cliente tiene cargada una Cédula, pero la e-Factura requiere un RUT (12 dígitos). Cargá el RUT o emití un e-Ticket.' };
    }
    return { nivel: 'ok', ok: true, mensaje: 'RUT válido — la e-Factura puede emitirse.' };
  }

  // e-Ticket
  if (!docStr) {
    if (totalUYU > umbralUYU && umbralUYU > 0) {
      return { nivel: 'error', ok: false, mensaje: `Supera el umbral DGI ($ ${umbralUYU.toLocaleString('es-UY', { minimumFractionDigits: 2 })}): a este monto DGI exige identificar al comprador con CI o RUT. Cargalo en la ficha.` };
    }
    return { nivel: 'ok', ok: true, mensaje: 'e-Ticket a consumidor final (sin identificar).' };
  }
  if (!v.valido) {
    return { nivel: 'error', ok: false, mensaje: `Documento inválido: ${v.motivo}. Corregilo en la ficha o dejalo vacío si es consumidor final.` };
  }
  return { nivel: 'ok', ok: true, mensaje: `${v.tipo === 'RUT' ? 'RUT' : 'Cédula'} válida.` };
}
