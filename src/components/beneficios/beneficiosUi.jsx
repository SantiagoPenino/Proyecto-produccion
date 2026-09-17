// ─────────────────────────────────────────────────────────────────────────────
// Beneficios pactados (specs/40) — piezas de UI compartidas por las pantallas
// internas: formato de montos, etiquetas de estado, badge y texto de vigencia.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { fetchAPI } from '../pages/ContabilidadCuentasView';

export const benApi = {
  get: (url) => fetchAPI(`/api/beneficios${url}`),
  post: (url, body) => fetchAPI(`/api/beneficios${url}`, { method: 'POST', body: JSON.stringify(body || {}) }),
  put: (url, body) => fetchAPI(`/api/beneficios${url}`, { method: 'PUT', body: JSON.stringify(body || {}) }),
};

export const sym = (monedaId) => (Number(monedaId) === 2 ? 'US$' : '$');
export const fmtN = (n, dec = 2) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(n ?? 0));
export const fmtMon = (n, monedaId) => `${sym(monedaId)} ${fmtN(n)}`;
export const fmtFecha = (f) => (f ? String(f).slice(0, 10).split('-').reverse().join('/') : '—');

export const vigenciaTexto = (b) => b?.vigenciaHasta ? `hasta el ${fmtFecha(b.vigenciaHasta)}`
  : b?.vigenciaDias ? `${b.vigenciaDias} días desde la activación` : 'hasta agotar el saldo';

// Estado de un beneficio (pacto/plantilla) o de una bolsa → etiqueta y colores.
const ESTADOS = {
  BORRADOR:   { label: 'Borrador',                 cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  PENDIENTE:  { label: 'Pendiente de aprobación',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  PUBLICADA:  { label: 'Publicada',                cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PAUSADA:    { label: 'Pausada',                  cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  APROBADO:   { label: 'Aprobado · sin activar',   cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  ACTIVADO:   { label: 'Activado',                 cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  RECHAZADO:  { label: 'Rechazado',                cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  CANCELADO:  { label: 'Cancelado',                cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  ACTIVO:     { label: 'Activo',                   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PAUSADO:    { label: 'En pausa',                 cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  AGOTADO:    { label: 'Agotado',                  cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  VENCIDO:    { label: 'Vencido',                  cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  CERRADO:    { label: 'Cerrado',                  cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};
export const EstadoBadge = ({ estado, extra = '' }) => {
  const e = ESTADOS[estado] || { label: estado || '—', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border whitespace-nowrap ${e.cls} ${extra}`}>{e.label}</span>;
};

export const TIPOS_REGLA = [
  { v: 'fixed',      l: 'Precio fijo por unidad' },
  { v: 'percentage', l: 'Descuento % sobre lista' },
  { v: 'subtract',   l: 'Descuento por monto' },
];
export const ALCANCES = [
  { v: 'ARTICULO', l: 'Un artículo' },
  { v: 'GRUPO',    l: 'Un grupo / familia' },
  { v: 'AREA',     l: 'Un servicio completo' },
];

export const Cargando = ({ texto = 'Cargando…' }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
    <span className="animate-spin h-5 w-5 border-2 border-cyan-600 border-t-transparent rounded-full" />{texto}
  </div>
);
