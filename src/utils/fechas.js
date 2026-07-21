/**
 * Formateo de fechas que vienen del backend (SQL Server).
 *
 * EL PROBLEMA QUE RESUELVE
 * node-mssql devuelve las fechas de SQL marcadas como UTC, porque en la base no hay
 * huso horario: son fechas de negocio. Formatearlas con toLocaleDateString() las
 * convierte a la hora local (Uruguay, UTC−3) y las RETROCEDE:
 *
 *   DATE     '2026-07-09'          → 2026-07-09T00:00:00Z → toLocaleDateString → 8/7/2026  ✗
 *   DATETIME '2026-07-07 16:52'    → 2026-07-07T16:52:42Z → toLocaleDateString → 7/7/2026  ✓ (de casualidad)
 *
 * Las columnas DATE (DDeFechaEmision, DDeFechaVencimiento…) salen SIEMPRE un día
 * antes. Las DATETIME zafan solo porque su hora las aleja de la medianoche: una
 * emitida entre 00:00 y 03:00 también se corre.
 *
 * LA REGLA: se lee la fecha en UTC, tal como está guardada. Nunca se convierte a
 * hora local — el 9 de julio en la base es el 9 de julio en pantalla, siempre.
 */

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

/** Normaliza a Date lo que venga: Date, ISO del backend, o 'YYYY-MM-DD' suelto. */
function aFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v);
  // 'YYYY-MM-DD' sin hora: JS ya lo parsea como UTC, que es lo que queremos.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : s);
  return isNaN(d.getTime()) ? null : d;
}

/** dd/mm/aaaa — la fecha tal cual está en la base. */
export function fmtFecha(v, fallback = '—') {
  const d = aFecha(v);
  if (!d) return fallback;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** dd mmm — para listados apretados. */
export function fmtFechaCorta(v, fallback = '—') {
  const d = aFecha(v);
  if (!d) return fallback;
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MESES[d.getUTCMonth()]}`;
}

/** dd/mm/aaaa hh:mm — solo para columnas DATETIME (una DATE mostraría 00:00). */
export function fmtFechaHora(v, fallback = '—') {
  const d = aFecha(v);
  if (!d) return fallback;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Clave numérica para ordenar por fecha (más nueva = más grande).
 * Las filas sin fecha van al fondo, nunca arriba disfrazadas de recientes.
 */
export function fechaOrden(v) {
  const d = aFecha(v);
  return d ? d.getTime() : -Infinity;
}

/** Comparador listo para .sort(): más reciente primero. */
export function porFechaDesc(getter = (x) => x) {
  return (a, b) => fechaOrden(getter(b)) - fechaOrden(getter(a));
}

/**
 * 'YYYY-MM-DD' para un <input type="date">, leyendo la fecha en UTC.
 * Sin esto, una DATE del backend (medianoche UTC) daría el día anterior en el input.
 */
export function toInputDate(v) {
  const d = aFecha(v);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
