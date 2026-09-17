/**
 * Cómo se explica en pantalla y en el PDF de dónde sale el importe de un movimiento
 * de una cuenta de cliente (libro de la billetera / estado de cuenta).
 *
 * El backend (contabilidadService.adjuntarDetalleDePagos) manda en cada movimiento:
 *   ConceptoDetalle  texto corto que reemplaza al concepto guardado cuando es ilegible
 *   DetallePago      [{ codigo, trabajo, cantidad, unidad, precioUnitario, importe,
 *                       imputado, chips:[{texto,tipo}], precioBase }]
 *
 * El PRECIO que se muestra es el APLICADO por unidad (importe ÷ cantidad), no el de
 * lista: es el que multiplica la cantidad y da la columna Debe. El precio de lista y
 * los perfiles que lo movieron van en los chips ("Urgencia 25 %").
 */

const fmtN = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "(30,32 mts × US$ 6,50 c/u)" — vacío si la línea no tiene cantidad y precio. */
export function textoCalculo(d, sim = '$') {
  if (!d || !d.cantidad || !d.precioUnitario) return '';
  return `(${fmtN(d.cantidad)}${d.unidad ? ` ${d.unidad}` : ''} × ${sim} ${fmtN(d.precioUnitario)} c/u)`;
}

/** ["Precio especial 35 %", "Recargo por Urgencias 25 %"] — vacío si el precio salió liso. */
export function perfilesDeLinea(d) {
  const chips = d?.chips?.length ? d.chips.map(c => c.texto) : (d?.perfiles || []);
  return chips.filter(Boolean);
}

/** Los perfiles en una sola línea (para un renglón suelto). */
export function textoPerfiles(d) {
  return perfilesDeLinea(d).join(' · ');
}

/** Qué dice el tooltip del cálculo: precio aplicado, lista y ajustes. */
export function tituloCalculo(d, sim = '$') {
  const partes = ['Precio aplicado por unidad (importe ÷ cantidad)'];
  if (d?.precioBase) partes.push(`precio de lista ${sim} ${fmtN(d.precioBase)}`);
  if (d?.ajusteDetalle) partes.push(d.ajusteDetalle);
  return partes.join(' · ');
}

/**
 * Las líneas de la celda "Concepto" del PDF: lo mismo que se ve en pantalla.
 * @param {object} m       movimiento tal como lo devuelve el backend
 * @param {string} sim     símbolo de la moneda de la cuenta
 * @param {number} maxOrd  cuántas órdenes listar antes de resumir el resto
 */
export function lineasConceptoPdf(m, sim = '$', maxOrd = 6) {
  const det = Array.isArray(m?.DetallePago) ? m.DetallePago : null;
  // Mismo criterio que el libro: el código de orden ya va en la columna Documento.
  const base = (m?.ConceptoDetalle
    || String(m?.MovConcepto || '').replace(/^([A-Z]{2,8}-\d+)\s*[—-]?\s*/, '')
    || m?.MovConcepto
    || '—').trim();
  if (!det || !det.length) return [base];

  // Cada perfil en su propio renglón: en fila se leían como un solo texto largo.
  if (det.length === 1) {
    return [base, textoCalculo(det[0], sim), ...perfilesDeLinea(det[0])].filter(Boolean);
  }

  // Varias órdenes: NUNCA se listan (una factura o un pedido de caja llegan a 150
  // líneas). Se dice cuántas hay de cada área y cuánto suma cada una; si son todas de
  // la misma área, eso ya viene dicho en el propio concepto.
  if (Array.isArray(m.ResumenDetalle) && m.ResumenDetalle.length) {
    return [base, ...m.ResumenDetalle.map(g =>
      `· ${g.tipo}: ${g.ordenes} ${g.ordenes === 1 ? 'orden' : 'órdenes'} · ${sim} ${fmtN(g.importe)}`)];
  }
  return [base];
}

export default { textoCalculo, textoPerfiles, perfilesDeLinea, tituloCalculo, lineasConceptoPdf };
