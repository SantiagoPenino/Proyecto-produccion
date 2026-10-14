import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import api from '../../services/apiClient';

/**
 * Pantallas de anticipo (saldo a favor): el anticipo es SOLO plata a favor del cliente,
 * NO paga deudas. Si el cliente debe (en $ o en US$), se avisa siempre que este saldo no
 * las rebaja y que, si el dinero es para pagarlas, va por "Registrar pago" (13-10-2026:
 * se sacó la imputación desde el anticipo para que haya un solo camino para cobrar deudas).
 *
 * Props: clienteId, onIrACobrar() opcional — botón que lleva al cobro de deudas.
 * Lee GET /contabilidad/caja/anticipo/deudas (mismo criterio de "deuda abierta" del backend).
 */
export default function AnticipoDeudasAbiertas({ clienteId, onIrACobrar }) {
  const [estado, setEstado] = useState({ cargando: false, porMoneda: [] });

  useEffect(() => {
    if (!clienteId) { setEstado({ cargando: false, porMoneda: [] }); return; }
    let vivo = true;
    setEstado({ cargando: true, porMoneda: [] });
    const pedir = (monedaId) => api.get(`/contabilidad/caja/anticipo/deudas?${new URLSearchParams({ clienteId: String(clienteId), monedaId: String(monedaId) })}`)
      .then(r => ({ sim: monedaId === 2 ? 'US$' : '$', deudas: r.data?.deudas || [], total: Number(r.data?.total) || 0 }))
      .catch(() => ({ sim: monedaId === 2 ? 'US$' : '$', deudas: [], total: 0 }));
    Promise.all([pedir(1), pedir(2)]).then(res => { if (vivo) setEstado({ cargando: false, porMoneda: res.filter(m => m.deudas.length) }); });
    return () => { vivo = false; };
  }, [clienteId]);

  const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!clienteId) return null;
  if (estado.cargando) {
    return <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Buscando deudas pendientes…</p>;
  }
  if (!estado.porMoneda.length) {
    return <p className="text-[11px] text-slate-500">El cliente no tiene deudas pendientes: el anticipo queda como saldo a favor.</p>;
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
      <p className="text-xs font-bold text-amber-900 flex items-start gap-1.5">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <span>
          El cliente tiene deudas pendientes:{' '}
          {estado.porMoneda.map((m, i) => (
            <span key={m.sim}>
              {i > 0 && ' · '}
              {m.sim} {fmt(m.total)} en {m.deudas.length} {m.deudas.length === 1 ? 'documento' : 'documentos'}
              {' '}({m.deudas.slice(0, 3).map(d => d.documento).join(', ')}{m.deudas.length > 3 ? '…' : ''})
            </span>
          ))}.
        </span>
      </p>
      <p className="text-[11px] text-amber-900">
        <b>Este anticipo NO rebaja esas deudas:</b> queda como saldo a favor en la cuenta del cliente.
        Si el dinero es para pagar deudas, usá <b>Registrar pago</b>.
      </p>
      {onIrACobrar && (
        <button type="button" onClick={() => onIrACobrar()}
          className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white">
          Ir a Registrar pago →
        </button>
      )}
    </div>
  );
}
