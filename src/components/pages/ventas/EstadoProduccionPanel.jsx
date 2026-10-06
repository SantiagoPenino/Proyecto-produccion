import React from 'react';
import { Check, X } from 'lucide-react';
import { BLOQUE_DEL_REQUISITO } from './checklistSolicitud';

/**
 * Qué le falta a un producto para entrar a producción, agrupado igual que el panel "Estado del pedido"
 * del formulario de la solicitud. Junta en un solo lugar las dos fuentes de bloqueos:
 *   - la ficha de ingreso (evaluarProducto: nombre, fecha, talles, boceto, muestra…)
 *   - lo técnico de la conversión (faltantesConversion: precio, seña, datos de cada servicio, diseño pronto…)
 * Solo muestra: no decide nada (el backend ya mandó `ch` con todo).
 */
const GRUPOS = [
    { k: 'ident', t: 'Identificación' },
    { k: 'producto', t: 'Producto' },
    { k: 'talles', t: 'Lista de talles' },
    { k: 'extras', t: 'Servicios y extras' },
    { k: 'pago', t: 'Pago y seña' },
    { k: 'diseno', t: 'Diseño y archivos' },
];
const DISENO = ['Boceto, ficha técnica o muestra de referencia', 'Archivo de diseño entregado y verificado', 'Diseño aprobado por escrito por el cliente'];
const TALLES = ['Lista de talles', 'Lista de nombres y números completa y cerrada', 'Medidas exactas en cm y cantidad por medida', 'Tipo de terminación o costura', 'Medidas de la prenda'];

export function grupoDe(txt) {
    if (DISENO.includes(txt)) return 'diseno';
    if (TALLES.includes(txt)) return 'talles';
    if (/todavía no está diseñado|diseño pronto|Diseño todavía no aceptó|falta elegir la tela/i.test(txt)) return 'diseno';
    if (/seña|precio|cobra/i.test(txt)) return 'pago';
    if (/^(Corte|Costura|Bordado|Estampado)\b/i.test(txt)) return 'extras';
    const b = BLOQUE_DEL_REQUISITO[txt];
    if (b === 1) return 'ident';
    if (b === 7) return 'extras';
    return 'producto';
}

export default function EstadoProduccionPanel({ ch, titulo = 'Estado para producción' }) {
    if (!ch) return null;
    const porGrupo = Object.fromEntries(GRUPOS.map(g => [g.k, []]));
    (ch.faltan || []).forEach(x => { const g = grupoDe(x); if (!porGrupo[g].includes(x)) porGrupo[g].push(x); });
    const listos = GRUPOS.filter(g => !porGrupo[g.k].length).length;
    const listo = !(ch.faltan || []).length;
    const n = (ch.faltan || []).length;
    // Tema claro (06/10), con clases de Tailwind en vez de las de fichaPedido.css (fp-panel, fp-meter, fp-checks…):
    // tarjeta blanca como las zonas del detalle; el sello torcido ("FALTA INFO") pasa a la pastilla de la lista de
    // solicitudes ("Faltan 5 cosas" / "Lista para ingresar"); la barra de avance en brand-cyan (antes amarilla); los
    // pasos cumplidos con un tilde verde y los pendientes con su número; lo que falta, en rojo con una cruz.
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-base font-black text-slate-800">{titulo}</h3>
                    <p className="text-xs text-slate-500">{listo ? 'Tiene todo para entrar a producción' : `${listos} de ${GRUPOS.length} listos`}</p>
                </div>
                {listo
                    ? <span className="shrink-0 whitespace-nowrap rounded-xl bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Lista para ingresar</span>
                    : <span className="shrink-0 whitespace-nowrap rounded-xl bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">Falta{n === 1 ? '' : 'n'} {n} cosa{n === 1 ? '' : 's'}</span>}
            </div>
            <div className="mt-3 mb-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={GRUPOS.length} aria-valuenow={listos} aria-label="Grupos listos">
                <div className="h-full rounded-full bg-brand-cyan transition-[width] duration-300" style={{ width: `${(listos / GRUPOS.length) * 100}%` }} />
            </div>
            <ul className="space-y-2.5">
                {GRUPOS.map((g, i) => {
                    const f = porGrupo[g.k];
                    return (
                        <li key={g.k} className="flex items-start gap-2.5">
                            {f.length
                                ? <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 text-[11px] font-black text-slate-500">{i + 1}</span>
                                : <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={12} strokeWidth={3} aria-hidden="true" /></span>}
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-800">{g.t}</div>
                                {f.length
                                    ? <ul className="mt-0.5 space-y-0.5">{f.map(x => <li key={x} className="flex items-start gap-1 text-xs text-rose-600"><X size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{x}</li>)}</ul>
                                    : <div className="text-xs text-emerald-600">Listo</div>}
                            </div>
                        </li>
                    );
                })}
            </ul>
            {(ch.ok || []).length > 0 && <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check size={13} aria-hidden="true" /> {ch.ok.length} requisito{ch.ok.length === 1 ? '' : 's'} cumplido{ch.ok.length === 1 ? '' : 's'}</div>}
            {(ch.luego || []).length > 0 && <div className="mt-3 border-t border-dashed border-slate-200 pt-3 text-xs text-amber-700">Se puede completar después, no frena: {ch.luego.join(' · ')}</div>}
        </div>
    );
}
