import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import api from '../../services/apiClient';

/**
 * Al cargar un anticipo (saldo a favor), muestra las deudas ABIERTAS de la cuenta a la que
 * entra la plata y pregunta si el anticipo las paga o queda entero a favor.
 * Antes el anticipo se aplicaba solo, sin avisar, y además salteaba las deudas VENCIDO:
 * quedaban "deuda viva + saldo a favor" conviviendo (caso Angel Carballo, 09-10-2026).
 *
 * Props: clienteId, monedaId (1 $ / 2 US$), cuentaId (opcional; sin él, la principal),
 *        importe (número), value (true = aplicar a deudas), onChange(bool).
 * El backend usa el MISMO criterio (GET /contabilidad/caja/anticipo/deudas).
 */
export default function AnticipoDeudasAbiertas({ clienteId, monedaId, cuentaId, importe, value, onChange }) {
  const [estado, setEstado] = useState({ cargando: false, deudas: [], total: 0 });

  useEffect(() => {
    if (!clienteId) { setEstado({ cargando: false, deudas: [], total: 0 }); return; }
    let vivo = true;
    setEstado(e => ({ ...e, cargando: true }));
    const qs = new URLSearchParams({ clienteId: String(clienteId), monedaId: String(monedaId || 1) });
    if (cuentaId) qs.append('cuentaId', String(cuentaId));
    api.get(`/contabilidad/caja/anticipo/deudas?${qs}`)
      .then(r => { if (vivo) setEstado({ cargando: false, deudas: r.data?.deudas || [], total: Number(r.data?.total) || 0 }); })
      .catch(() => { if (vivo) setEstado({ cargando: false, deudas: [], total: 0 }); });
    return () => { vivo = false; };
  }, [clienteId, monedaId, cuentaId]);

  const sim = Number(monedaId) === 2 ? 'US$' : '$';
  const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const imp = Math.max(0, Number(importe) || 0);

  if (!clienteId) return null;
  if (estado.cargando) {
    return <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Buscando deudas abiertas…</p>;
  }
  if (!estado.deudas.length) {
    return <p className="text-[11px] text-slate-500">Sin deudas abiertas en esta cuenta: el anticipo queda entero como saldo a favor.</p>;
  }

  const aplica = Math.min(imp, estado.total);
  const quedaAFavor = Math.max(0, imp - aplica);
  const quedaDebiendo = Math.max(0, estado.total - aplica);
  const visibles = estado.deudas.slice(0, 5);

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2.5">
      <p className="text-xs font-bold text-amber-800 flex items-start gap-1.5">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        Este cliente debe {sim} {fmt(estado.total)} en {estado.deudas.length} {estado.deudas.length === 1 ? 'documento' : 'documentos'} de esta cuenta.
        ¿Qué hacemos con el anticipo?
      </p>
      <ul className="text-[11px] text-amber-900 space-y-0.5 pl-5">
        {visibles.map(d => (
          <li key={d.id} className="flex justify-between gap-3">
            <span className="truncate">{d.documento} <span className="text-amber-700/70">· {String(d.estado || '').toLowerCase()}</span></span>
            <span className="font-mono shrink-0">{sim} {fmt(d.pendiente)}</span>
          </li>
        ))}
        {estado.deudas.length > visibles.length && <li className="text-amber-700/70">+ {estado.deudas.length - visibles.length} más</li>}
      </ul>
      <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-800">
        <input type="radio" className="mt-0.5" checked={value !== false} onChange={() => onChange(true)} />
        <span>
          <b>Aplicar el anticipo a estas deudas</b> (las más viejas primero).
          {imp > 0 && <span className="block text-[11px] text-slate-600">
            Paga {sim} {fmt(aplica)}{quedaAFavor > 0.004 ? ` · quedan ${sim} ${fmt(quedaAFavor)} a favor` : ''}{quedaDebiendo > 0.004 ? ` · sigue debiendo ${sim} ${fmt(quedaDebiendo)}` : ''}.
          </span>}
        </span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-800">
        <input type="radio" className="mt-0.5" checked={value === false} onChange={() => onChange(false)} />
        <span>
          <b>Dejar todo como saldo a favor.</b>
          <span className="block text-[11px] text-slate-600">Las deudas siguen pendientes por {sim} {fmt(estado.total)}.</span>
        </span>
      </label>
    </div>
  );
}
