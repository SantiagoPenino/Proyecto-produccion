import { useEffect, useState } from 'react';
import api from '../../services/apiClient';

const mlin = v => Number(v || 0).toLocaleString('es-UY', { maximumFractionDigits: 1 });
const pct  = (a, b) => b > 0 ? ((a / b) * 100).toFixed(0) + '%' : '—';

// Barra SVG apilada T1/T2
function BarraApilada({ t1, t2, maxVal, height = 90 }) {
    const total = t1 + t2;
    if (total === 0) return <div style={{ height }} className="flex items-end justify-center"><div className="w-full bg-slate-100 rounded-t" style={{ height: 4 }} /></div>;
    const h1 = Math.round((t1 / maxVal) * height);
    const h2 = Math.round((t2 / maxVal) * height);
    return (
        <div className="flex flex-col items-center justify-end w-full" style={{ height }}>
            <div className="w-full rounded-t-sm bg-blue-400" style={{ height: h2 }} title={`T2: ${mlin(t2)}`} />
            <div className="w-full bg-amber-400" style={{ height: h1 }} title={`T1: ${mlin(t1)}`} />
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
        .catch(() => {})
        .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 animate-pulse h-56" />
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <p className="font-bold text-slate-800 text-sm">Producción por Turno</p>
                    <p className="text-[11px] text-slate-400">Últimos 30 días · Control de Calidad</p>
                </div>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-medium">
                    {[['ordenes','Órdenes'],['metros','Metros']].map(([v,l]) => (
                        <button key={v} onClick={() => setTab(v)}
                            className={`px-3 py-1.5 transition-all ${tab === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                            {l}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPIs rápidos */}
            <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                    { label:'T1 Órd.', value: totT1Ord, sub: pct(totT1Ord, totOrd), cls:'text-amber-600' },
                    { label:'T2 Órd.', value: totT2Ord, sub: pct(totT2Ord, totOrd), cls:'text-blue-600'  },
                    { label:'T1 m lin.', value: mlin(totT1Met), sub: pct(totT1Met, totMet), cls:'text-amber-600' },
                    { label:'T2 m lin.', value: mlin(totT2Met), sub: pct(totT2Met, totMet), cls:'text-blue-600'  },
                ].map(k => (
                    <div key={k.label} className="bg-slate-50 rounded-xl px-3 py-2.5">
                        <p className="text-[10px] text-slate-400 font-medium">{k.label}</p>
                        <p className={`text-base font-bold ${k.cls}`}>{k.value}</p>
                        <p className="text-[10px] text-slate-400">{k.sub} del total</p>
                    </div>
                ))}
            </div>

            {/* Gráfico de barras apiladas */}
            <div className="flex items-end gap-1 px-1 pt-2 border-t border-slate-100">
                {display.map((r, i) => {
                    const t1 = tab === 'ordenes' ? Number(r.T1_Ordenes||0) : Number(r.T1_Metros||0);
                    const t2 = tab === 'ordenes' ? Number(r.T2_Ordenes||0) : Number(r.T2_Metros||0);
                    return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                            <BarraApilada t1={t1} t2={t2} maxVal={maxVal} height={80} />
                            <span className="text-[8px] text-slate-400 truncate w-full text-center">
                                {r.Dia?.slice(0,5)}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Leyenda */}
            <div className="flex items-center justify-center gap-5 mt-3 text-[10px] text-slate-500">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" />T1 · 00-14 h</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-400 inline-block" />T2 · 14-24 h</span>
            </div>
        </div>
    );
}
