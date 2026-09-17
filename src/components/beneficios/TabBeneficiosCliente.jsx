// ─────────────────────────────────────────────────────────────────────────────
// Pestaña "Beneficios" de la Vista 360 de vendedores (specs/40 RN-BEN.31).
// Única pestaña que PROPONE en una vista de consulta: pactar es una propuesta y no
// cambia precios. Muestra los beneficios del cliente (bolsas y pactos), los
// predefinidos disponibles (solo consulta) y los accesos a las páginas de beneficios.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import ModalPactarBeneficio from './ModalPactarBeneficio';
import { benApi, sym, fmtN, fmtFecha, vigenciaTexto, EstadoBadge, Cargando } from './beneficiosUi';

export default function TabBeneficiosCliente({ cliente }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState({ activo: false, puedeAprobar: false });
  const [loading, setLoading] = useState(true);
  const [pactar, setPactar] = useState(null); // { plantillaBaseId }

  const cargar = useCallback(async () => {
    if (!cliente?.CliIdCliente) return;
    setLoading(true);
    try { const r = await benApi.get(`/cliente/${cliente.CliIdCliente}`); setData(r.data); setMeta({ activo: !!r.activo, puedeAprobar: !!r.puedeAprobar }); }
    catch (e) { toast.error(e.message); setData({ activos: [], pactos: [], disponibles: [] }); }
    finally { setLoading(false); }
  }, [cliente?.CliIdCliente]);
  useEffect(() => { cargar(); }, [cargar]);

  if (loading && !data) return <Cargando texto="Leyendo los beneficios del cliente…" />;
  const activos = data?.activos || [], pactos = data?.pactos || [], disponibles = (data?.disponibles || []).filter(d => d.tipo === 'PLANTILLA');
  const vivos = activos.filter(a => ['ACTIVO', 'PAUSADO'].includes(a.BclEstado)).length;
  const pendientes = pactos.filter(p => p.estado === 'PENDIENTE').length;

  return (
    <div>
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-full">Beneficios de este cliente</span>
        <span className="text-[11px] text-slate-500">{vivos} activo{vivos !== 1 ? 's' : ''} · {pendientes} pendiente{pendientes !== 1 ? 's' : ''} de aprobación · {activos.length - vivos} terminado{activos.length - vivos !== 1 ? 's' : ''}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => setPactar({ plantillaBaseId: null })} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-cyan-700 hover:bg-cyan-800 text-white text-[11px] font-bold rounded-lg shadow-sm"><Plus size={12} /> Pactar beneficio con {String(cliente?.Nombre || 'el cliente').trim().split(' ').slice(0, 2).join(' ')}</button>
          <button type="button" onClick={() => navigate('/beneficios/predefinidos')} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg">Beneficios predefinidos <ExternalLink size={11} /></button>
          <button type="button" onClick={() => navigate('/beneficios/pactos')} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 text-[11px] font-bold rounded-lg">Mis pactos <ExternalLink size={11} /></button>
          <button type="button" onClick={cargar} title="Volver a leer" className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-lg"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>
      {!meta.activo && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-800 font-semibold">Los beneficios están apagados en la configuración general: se pueden pactar y aprobar, pero ninguno se activa ni cambia precios hasta que Administración los encienda.</div>
      )}

      <table className="w-full text-sm">
        <thead><tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">
          <th className="px-4 py-2 text-left">Beneficio</th><th className="px-4 py-2 text-left">Alcance y precio pactado</th><th className="px-4 py-2 text-right">Saldo</th><th className="px-4 py-2 text-left">Vigencia</th><th className="px-4 py-2 text-left">Estado</th><th className="px-4 py-2 text-center">Acciones</th>
        </tr></thead>
        <tbody>
          {activos.map(b => (
            <tr key={`b${b.BclIdBeneficioCliente}`} className={`border-b border-slate-100 ${b.BclEstado === 'ACTIVO' ? '' : 'text-slate-500'}`}>
              <td className="px-4 py-3 align-top"><span className="font-bold text-slate-800">{String(b.BenNombre).trim()}</span><span className="block text-[11px] text-slate-400">{b.BenTipo === 'PACTO' ? 'Pactado' : 'Predefinido'} · activado el {fmtFecha(b.BclFechaActivacion)} desde {b.BclOrigen === 'PORTAL' ? 'el portal' : 'caja'} · cuenta #{b.CueIdCuenta}{b.DocSerie ? ` · ${String(b.DocSerie).trim()}-${b.DocNumero}` : ''}</span></td>
              <td className="px-4 py-3 align-top text-xs text-slate-600">{(b.reglasTexto || []).map((t, i) => <span key={i} className="block">{t}</span>)}</td>
              <td className="px-4 py-3 align-top text-right whitespace-nowrap"><span className={`font-mono font-black ${b.Saldo > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{sym(b.MonIdMoneda)} {fmtN(b.Saldo)}</span><span className="block text-[10px] text-slate-400">de {sym(b.MonIdMoneda)} {fmtN(b.BclImporteCarga)}{b.aproxUnidades != null ? ` · ≈ ${b.aproxUnidades} u.` : ''}</span></td>
              <td className="px-4 py-3 align-top text-xs text-slate-600">{b.BclFechaVencimiento ? `Vence ${fmtFecha(b.BclFechaVencimiento)}` : 'Hasta agotar el saldo'}</td>
              <td className="px-4 py-3 align-top"><EstadoBadge estado={b.BclEstado} />{b.BclEstado === 'PAUSADO' && <span className="block text-[10px] text-amber-700 mt-1">En pausa por administración: pedidos a tarifa normal.</span>}</td>
              <td className="px-4 py-3 align-top text-center text-slate-300">—</td>
            </tr>
          ))}
          {pactos.filter(p => p.estado !== 'ACTIVADO').map(p => (
            <tr key={`p${p.BenIdBeneficio}`} className={`border-b border-slate-100 ${p.estado === 'PENDIENTE' ? 'bg-amber-50/50' : ''}`}>
              <td className="px-4 py-3 align-top"><span className="font-bold text-slate-800">{p.nombre}</span><span className="block text-[11px] text-slate-400">Pactado por {p.vendedorNombre || 'vendedor'} el {fmtFecha(p.fechaAlta)}{p.plantillaBaseNombre ? ` · base «${p.plantillaBaseNombre}»` : ' · a medida'}</span>{p.motivoRechazo && <span className="block text-[11px] text-rose-600">Motivo: {p.motivoRechazo}</span>}</td>
              <td className="px-4 py-3 align-top text-xs text-slate-600">{(p.reglasTexto || []).map((t, i) => <span key={i} className="block">{t}</span>)}{(p.alertas?.peores || 0) > 0 && <span className="flex items-center gap-1 text-[11px] text-rose-700 font-bold mt-1"><AlertTriangle size={11} /> {p.alertas.peores} precio{p.alertas.peores > 1 ? 's' : ''} peor{p.alertas.peores > 1 ? 'es' : ''} que los de hoy: marcado{p.alertas.peores > 1 ? 's' : ''} para quien aprueba</span>}</td>
              <td className="px-4 py-3 align-top text-right text-slate-300">--</td>
              <td className="px-4 py-3 align-top text-xs text-slate-600">{vigenciaTexto(p)}{p.estado !== 'RECHAZADO' && p.estado !== 'CANCELADO' ? ` · se activa cargando ${sym(p.monedaId)} ${fmtN(p.carga)}${p.cargaEsMinimo ? ' (mínimo)' : ''}` : ''}</td>
              <td className="px-4 py-3 align-top"><EstadoBadge estado={p.estado} />{p.estado === 'APROBADO' && <span className="block text-[10px] text-amber-700 mt-1">No habilitado: el cliente todavía no cargó el saldo.</span>}{p.estado === 'PENDIENTE' && <span className="block text-[10px] text-slate-500 mt-1">Sin cambio de precios hasta aprobar y cargar.</span>}</td>
              <td className="px-4 py-3 align-top text-center">
                {p.estado === 'RECHAZADO' && (
                  <button type="button" onClick={() => setPactar({ pactoExistente: p })} title="Corregir este pacto y reenviarlo a aprobación" className="px-2.5 py-1 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg whitespace-nowrap">Editar y reenviar</button>
                )}
              </td>
            </tr>
          ))}
          {activos.length === 0 && pactos.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">Este cliente no tiene beneficios pactados ni activados.</td></tr>}
        </tbody>
      </table>

      <div className="px-4 py-3 bg-slate-50 border-y border-slate-200 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded-full">Predefinidos disponibles para este cliente</span>
        <span className="text-[11px] text-slate-500">Solo se muestran. Se crean y editan en la página Beneficios predefinidos, no desde el cliente.</span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {disponibles.map(d => {
            const peores = d.evaluacion?.peores || 0;
            return (
              <tr key={d.BenIdBeneficio} className="border-b border-slate-100">
                <td className="px-4 py-3 align-top"><span className="font-bold text-slate-800">{d.nombre}</span><span title={d.publico ? undefined : 'El cliente no lo activa solo desde el portal. Caja/Administración sí puede activarlo directo, sin pactarlo antes.'} className={`block text-[11px] text-slate-400 ${d.publico ? '' : 'cursor-help underline decoration-dotted'}`}>{d.publico ? 'Público en el portal' : 'Solo por pacto'}</span></td>
                <td className="px-4 py-3 align-top text-xs text-slate-600">{(d.reglasTexto || []).map((t, i) => <span key={i} className="block">{t}</span>)}</td>
                <td className="px-4 py-3 align-top text-xs text-slate-600">Carga {sym(d.monedaId)} {fmtN(d.carga)}{d.cargaEsMinimo ? ' mínima' : ' fija'} · {vigenciaTexto(d)}</td>
                <td className="px-4 py-3 align-top text-xs">{peores > 0 ? <span className="text-rose-700 font-bold flex items-center gap-1"><AlertTriangle size={11} /> Hoy paga menos en {peores} artículo{peores > 1 ? 's' : ''}: le sale peor</span> : d.evaluacion ? <span className="text-emerald-700 font-semibold">Mejor que su precio de hoy</span> : null}</td>
                <td className="px-4 py-3 align-top text-right"><button type="button" onClick={() => setPactar({ plantillaBaseId: d.BenIdBeneficio })} className="text-[11px] font-bold text-cyan-700 underline">Usar de base para pactar</button></td>
              </tr>
            );
          })}
          {disponibles.length === 0 && <tr><td className="px-4 py-6 text-center text-slate-400 text-sm">No hay beneficios predefinidos publicados.</td></tr>}
        </tbody>
      </table>
      <div className="px-4 py-2.5 border-t border-slate-100 text-[11px] text-slate-500">Desde acá el vendedor propone, sigue y consulta. Aprobar, cargar en caja, pausar o cerrar un beneficio es de Administración, desde su 360.</div>

      {pactar && <ModalPactarBeneficio cliente={cliente} plantillaBaseId={pactar.plantillaBaseId} pactoExistente={pactar.pactoExistente} onClose={() => setPactar(null)} onSuccess={cargar} />}
    </div>
  );
}
