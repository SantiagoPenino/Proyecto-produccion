/**
 * documentoUY — Validación de documentos uruguayos (RUT y Cédula de Identidad)
 * ─────────────────────────────────────────────────────────────────────────────
 * RUT: 12 dígitos. Dígito verificador módulo 11 con pesos [4,3,2,9,8,7,6,5,4,3,2]
 *      sobre los primeros 11 dígitos; DV = 11 − (suma mod 11); 11 → 0; 10 → inválido.
 *      Verificado contra RUCs reales: 218973270018 ✓, 215939820014 ✓, 210958750017 ✓.
 * CI:  6 a 8 dígitos (el último es el verificador). Cuerpo pad-left a 7 dígitos;
 *      pesos [2,9,8,7,6,3,4]; DV = (10 − (suma mod 10)) mod 10.
 *
 * validarDocumentoUY(valor) → { valido, tipo: 'RUT'|'CI'|null, normalizado, motivo }
 * `motivo` viene redactado para mostrarse directo al usuario.
 * Copia espejo en frontend: src/utils/documentoUY.js — mantener sincronizadas.
 */

const PESOS_RUT = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_CI = [2, 9, 8, 7, 6, 3, 4];

function normalizarDocumento(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

function digitoVerificadorRUT(onceDigitos) {
  let suma = 0;
  for (let i = 0; i < 11; i++) suma += parseInt(onceDigitos[i], 10) * PESOS_RUT[i];
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  return dv; // 10 => no existe RUT con ese verificador
}

function digitoVerificadorCI(sieteDigitos) {
  let suma = 0;
  for (let i = 0; i < 7; i++) suma += parseInt(sieteDigitos[i], 10) * PESOS_CI[i];
  return (10 - (suma % 10)) % 10;
}

function validarDocumentoUY(valor) {
  const normalizado = normalizarDocumento(valor);

  if (!normalizado) {
    return { valido: false, tipo: null, normalizado: '', motivo: 'No se ingresó ningún documento' };
  }
  if (/^0+$/.test(normalizado)) {
    return { valido: false, tipo: null, normalizado, motivo: 'El documento no puede ser todo ceros' };
  }

  // RUT (12 dígitos)
  if (normalizado.length === 12) {
    const dvCalculado = digitoVerificadorRUT(normalizado);
    const dvIngresado = parseInt(normalizado[11], 10);
    if (dvCalculado === 10 || dvCalculado !== dvIngresado) {
      return {
        valido: false, tipo: 'RUT', normalizado,
        motivo: `El RUT ${normalizado} no es válido: el dígito verificador no corresponde (revisá que esté bien escrito, sin puntos ni guiones)`
      };
    }
    return { valido: true, tipo: 'RUT', normalizado, motivo: null };
  }

  // Cédula (6 a 8 dígitos)
  if (normalizado.length >= 6 && normalizado.length <= 8) {
    const cuerpo = normalizado.slice(0, -1).padStart(7, '0');
    const dvIngresado = parseInt(normalizado[normalizado.length - 1], 10);
    const dvCalculado = digitoVerificadorCI(cuerpo);
    if (dvCalculado !== dvIngresado) {
      return {
        valido: false, tipo: 'CI', normalizado,
        motivo: `La Cédula ${normalizado} no es válida: el dígito verificador no corresponde (revisá que esté bien escrita, sin puntos ni guiones)`
      };
    }
    return { valido: true, tipo: 'CI', normalizado, motivo: null };
  }

  return {
    valido: false, tipo: null, normalizado,
    motivo: `El documento tiene ${normalizado.length} dígitos: debe ser una Cédula (6 a 8 dígitos) o un RUT (12 dígitos)`
  };
}

module.exports = { validarDocumentoUY, normalizarDocumento };
