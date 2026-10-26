import { useEffect, useState } from 'react';
import { ChartColumn } from 'lucide-react';
import api from '../../services/apiClient';

const mlin = v => Number(v || 0).toLocaleString('es-UY', { maximumFractionDigits: 1 });
const pct  = (a, b) => b > 0 ? ((a / b) * 100).toFixed(0) + '%' : '—';

// Colores de los dos turnos (22/10/2026, estética nueva): T1 brand-cyan, T2 cian claro.
const COLOR_T1 = 'bg-brand-cyan';
const COLOR_T2 = 'bg-cyan-300';

// Barra apilada T1/T2 (alto en % del contenedor: el máximo del período llena la columna)
function BarraApilada({ t1, t2, maxVal, unidad }) {
    const total = t1 + t2;
    if (total === 0) return <div className="flex items-end w-full h-full"><div className="w-full bg-zinc-100 rounded-sm" style={{ height: 3 }} /></div>;
    const h1 = (t1 / maxVal) * 100;
    const h2 = (t2 / maxVal) * 100;
    return (
        <div className="flex flex-col items-center justify-end w-full h-full" title={`T1: ${mlin(t1)} · T2: ${mlin(t2)} ${unidad}`}>
            <div className={`w-full rounded-t-sm ${COLOR_T2}`} style={{ height: `${h2}%` }} />
            <div className={`w-full ${COLOR_T1} ${h2 ? '' : 'rounded-t-sm'}`} style={{ height: `${h1}%` }} />
        </div>
    );
}

export default function ProduccionDiariaChart() {
    const [rows, setRows]     = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab]       = useState('ordenes'); // 'ordenes' | 'metros'

    useEffect(() => {
        const desde = new Date();
        desde.setDate(desde.getDate() - 29);
        const fmtDate = d => d.toISOString().slice(0, 10);
        api.get('/reportes/ordenes-por-dia', {
            params: { fechaDesde: fmtDate(desde), fechaHasta: fmtDate(new Date()) }
        })
        .then(r => setRows((r.data.data || []).slice().reverse())) // cronológico
        .catch((e) => console.warn('[Panel de Control] producción por turno:', e?.message))
        .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="bg-white rounded-2xl border border-zinc-200 p-4 md:p-5 animate-pulse h-56" />
    );
    if (!rows.length) return null;

    const display = rows.slice(-14); // últimos 14 días en pantalla
    const maxOrd  = Math.max(...display.map(r => Number(r.Total_Ordenes || 0)), 1);
    const maxMet  = Math.max(...display.map(r => Number(r.Total_Metros  || 0)), 1);
    const maxVal  = tab === 'ordenes' ? maxOrd : maxMet;

    const totT1Ord = rows.reduce((s, r) => s + Number(r.T1_Ordenes || 0), 0);
    const totT2Ord = rows.reduce((s, r) => s + Number(r.T2_Ordenes || 0), 0);
    const totT1Met = rows.reduce((s, r) => s + Number(r.T1_Metros  || 0), 0);
    const totT2Met = rows.reduce((s, r) => s + Number(r.T2_Metros  || 0), 0);
    const totOrd   = totT1Ord + totT2Ord;
    const totMet   = totT1Met + totT2Met;

    return (
        <div className="bg-white rounded-2xl border border-zinc-200 p-4 md:p-5">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2 min-w-0">
                    <ChartColumn size={20} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <p className="font-black text-zinc-800 text-base leading-tight">Producción por turno</p>
                        <p className="text-xs text-zinc-400">Últimos 30 días · Control de Calidad</p>
                    </div>
                </div>
                <div className="flex gap-1 p-1 rounded-xl bg-zinc-100 text-xs font-bold" role="tablist">
                    {[['ordenes', 'Órdenes'], ['metros', 'Metros']].map(([v, l]) => (
                        <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
                            className={`px-3 py-1.5 rounded-lg transition-colors ${tab === v ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`}>
                            {l}
                        </button>
                    ))}
                </div>
            </div>

            {/* Totales del período */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3 mb-4">
                {[
                    { label: 'T1 · órdenes', value: totT1Ord.toLocaleString('es-UY'), sub: pct(totT1Ord, totOrd), color: COLOR_T1 },
                    { label: 'T2 · órdenes', value: totT2Ord.toLocaleString('es-UY'), sub: pct(totT2Ord, totOrd), color: COLOR_T2 },
                    { label: 'T1 · m lineales', value: mlin(totT1Met), sub: pct(totT1Met, totMet), color: COLOR_T1 },
                    { label: 'T2 · m lineales', value: mlin(totT2Met), sub: pct(totT2Met, totMet), color: COLOR_T2 },
                ].map(k => (
                    <div key={k.label} className="rounded-xl border border-zinc-200 px-3 py-2.5">
                        <p className="flex items-center gap-1.5 text-[10px] font-black text-zinc-400 uppercase tracking-wide">
                            <span className={`w-2 h-2 rounded-sm ${k.color}`} aria-hidden="true" /> {k.label}
                        </p>
                        <p className="mt-0.5 text-xl font-black text-zinc-800 tabular-nums leading-tight">{k.value}</p>
                        <p className="text-[11px] text-zinc-400">{k.sub} del total</p>
                    </div>
                ))}
            </div>

            {/* Barras apiladas: últimos 14 días */}
            <div className="flex items-end gap-1 md:gap-1.5 pt-3 border-t border-zinc-100">
                {display.map((r, i) => {
                    const t1 = tab === 'ordenes' ? Number(r.T1_Ordenes || 0) : Number(r.T1_Metros || 0);
                    const t2 = tab === 'ordenes' ? Number(r.T2_Ordenes || 0) : Number(r.T2_Metros || 0);
                    return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                            <div className="w-full h-24 md:h-32 flex items-end">
                                <BarraApilada t1={t1} t2={t2} maxVal={maxVal} unidad={tab === 'ordenes' ? 'órdenes' : 'm'} />
                            </div>
                            {/* En el celular no entra dd/mm debajo de cada barra: solo el día */}
                            <span className="text-[10px] text-zinc-400 truncate w-full text-center tabular-nums">
                                <span className="md:hidden">{r.Dia?.slice(0, 2)}</span>
                                <span className="hidden md:inline">{r.Dia?.slice(0, 5)}</span>
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Leyenda */}
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 mt-3 text-[11px] text-zinc-500">
                <span className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-sm inline-block ${COLOR_T1}`} />T1 · 00 a 14 h</span>
                <span className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-sm inline-block ${COLOR_T2}`} />T2 · 14 a 24 h</span>
            </div>
        </div>
    );
}
