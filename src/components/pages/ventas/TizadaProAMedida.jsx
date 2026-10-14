import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, FileStack, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { BTN_SECUNDARIO, INPUT, SEL_CAMPO, claseSel, errorDe } from './solicitudesComunes';
import Selector from '../../ui/Selector';
import { IconoForma } from '../ConfiguradorAMedida';

/**
 * [A MEDIDA] TIZADA PRO en la solicitud para un producto A MEDIDA (pañuelo, toalla, bandera, banderín): cada diseño
 * (un arte) lleva SU medida, SU tela, SUS tiras y SU cantidad. Se pregunta en el orden de la guía de TIZADA (§5.7):
 * forma → punta → medida → terminación → tela → tiras. Mientras se escribe, TIZADA hace las cuentas (POST
 * /a_medida/calcular, no guarda nada): el total con el margen, si entra en cada tela y dónde van las tiras.
 * La medida es SIEMPRE la del diseño en metros: TIZADA le suma el margen. Reglas: backend/services/tizadaProAMedida.js.
 */
const NOMBRE_LADO = { arriba: 'Arriba', abajo: 'Abajo', izq: 'Izquierda', der: 'Derecha', base: 'Base', laterales: 'Cada lateral', alrededor: 'Alrededor' };
const chip = (sel) => `inline-flex items-center gap-1.5 rounded-lg border-2 px-2 py-1 text-[11px] font-bold transition-colors disabled:opacity-60 ${sel ? 'border-emerald-500 bg-emerald-50/40 text-slate-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`;
const metros = (v) => (v === '' || v == null ? '' : Number(String(v).replace(',', '.')));
const cm = (n) => Number(n).toLocaleString('es-UY', { maximumFractionDigits: 1 });

// [PORTAL] La resolución más baja de las imágenes del arte impresas a la medida total (null = todo vectores). La misma
// cuenta que dpiImpreso de backend/services/tizadaProAMedida.js (que es la que frena al confirmar), para avisar en vivo.
export function dpiImpreso(a, anchoCm, altoCm, ajuste = 'llenar') {
    if (!a?.imagenes?.length || !(a.anchoPt > 0 && a.altoPt > 0 && anchoCm > 0 && altoCm > 0)) return null;
    const pt = 72 / 2.54;
    const k = (ajuste === 'entera' ? Math.min : Math.max)((anchoCm * pt) / a.anchoPt, (altoCm * pt) / a.altoPt);
    const dpis = a.imagenes.filter(i => i.wPt > 0.5 && i.hPt > 0.5).map(i => Math.min(i.px / ((i.wPt * k) / 72), i.py / ((i.hPt * k) / 72)));
    return dpis.length ? Math.round(Math.min(...dpis)) : null;
}

// [PORTAL] Cómo queda: la forma cortada (total con el margen), el arte encima (llena la mesa o entra entera, como se arma
// para TIZADA), la línea de doblez (la medida del diseño) y las tiras en su lugar, con las mismas cuentas de TIZADA
// (calc = POST /a_medida/calcular: por_lado con cuántas y cada cuánto). Las marcas negras son las que TIZADA imprime
// (con dobladillo, la de la esquina o la punta no se imprime: el corte ya la marca). Sin calc: la forma con la medida.
export function VistaAMedida({ calc, medida, vista, ajuste = 'llenar', ancho = 240 }) {
    const forma = calc?.forma || medida?.forma || 'rectangulo';
    const punta = calc?.orientacion || medida?.orientacion || 'abajo';
    const md = calc?.medida_diseno_cm || (forma === 'circulo'
        ? { ancho: (medida?.diametro_m || 0) * 100, alto: (medida?.diametro_m || 0) * 100 }
        : { ancho: (medida?.ancho_m || 0) * 100, alto: (medida?.alto_m || 0) * 100 });
    const W = calc?.total_cm?.ancho || md.ancho, H = calc?.total_cm?.alto || md.alto;
    if (!(W > 0 && H > 0)) return null;
    const mg = calc?.margen_cm || { arriba: 0, abajo: 0, izq: 0, der: 0 };
    const dobladillo = (calc?.terminacion || medida?.terminacion) === 'dobladillo';
    // la línea de doblez (la medida del diseño) dentro del total
    const gx = forma === 'rectangulo' ? (mg.izq || 0) : (W - md.ancho) / 2, gy = forma === 'rectangulo' ? (mg.arriba || 0) : (H - md.alto) / 2;
    const tri = (x, y, w, h) => ({
        abajo: [[x, y], [x + w, y], [x + w / 2, y + h]], arriba: [[x, y + h], [x + w, y + h], [x + w / 2, y]],
        izq: [[x + w, y], [x + w, y + h], [x, y + h / 2]], der: [[x, y], [x, y + h], [x + w, y + h / 2]],
    }[punta] || [[x, y], [x + w, y], [x + w / 2, y + h]]);
    const corte = forma === 'circulo' ? null : forma === 'triangulo' ? tri(0, 0, W, H) : [[0, 0], [W, 0], [W, H], [0, H]];
    const guia = forma === 'circulo' ? null : forma === 'triangulo' ? tri(gx, gy, md.ancho, md.alto) : [[gx, gy], [gx + md.ancho, gy], [gx + md.ancho, gy + md.alto], [gx, gy + md.alto]];
    // Tiras: cada una con su punto sobre la guía, hacia dónde sale (normal) y si TIZADA imprime su marca
    const tiras = [];
    const cx = W / 2, cy = H / 2;
    const porLado = calc?.tiras?.lleva ? (calc.tiras.por_lado || []) : [];
    const sobre = (P, Q, n, imprimeExtremos) => {
        const nx0 = Q[1] - P[1], ny0 = P[0] - Q[0]; const l = Math.hypot(nx0, ny0) || 1;
        let nx = nx0 / l, ny = ny0 / l;
        const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
        if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 < (mx - cx) ** 2 + (my - cy) ** 2) { nx = -nx; ny = -ny; }   // hacia afuera
        for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0.5 : i / (n - 1);
            const extremo = n > 1 && (i === 0 || i === n - 1);
            tiras.push({ x: P[0] + (Q[0] - P[0]) * t, y: P[1] + (Q[1] - P[1]) * t, nx, ny, marca: imprimeExtremos || !extremo });
        }
    };
    porLado.forEach(l => {
        if (!l.marcas) return;
        if (forma === 'rectangulo') {
            const [a, b, c, d] = guia;
            const lado = { arriba: [a, b], der: [b, c], abajo: [d, c], izq: [a, d] }[l.lado];
            if (lado) sobre(lado[0], lado[1], l.marcas, !dobladillo);
        } else if (forma === 'triangulo') {
            const [a, b, c] = guia;   // a-b = la base, c = la punta
            if (l.lado === 'base') sobre(a, b, l.marcas, !dobladillo);
            if (l.lado === 'laterales') { sobre(a, c, l.marcas, !dobladillo); sobre(b, c, l.marcas, !dobladillo); }
        } else if (l.lado === 'alrededor') {
            const r = md.ancho / 2;
            for (let i = 0; i < l.marcas; i++) { const ang = -Math.PI / 2 + (i * 2 * Math.PI) / l.marcas; tiras.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang), nx: Math.cos(ang), ny: Math.sin(ang), marca: true }); }
        }
    });
    // hasta el borde de corte (donde se cose la tira) y la tira colgando afuera
    const hastaCorte = (t) => {
        if (forma === 'circulo') return W / 2 - md.ancho / 2;
        const cand = [t.nx > 0 ? (W - t.x) / t.nx : t.nx < 0 ? -t.x / t.nx : Infinity, t.ny > 0 ? (H - t.y) / t.ny : t.ny < 0 ? -t.y / t.ny : Infinity];
        return Math.max(0, Math.min(...cand, Math.max(mg.arriba || 0, mg.abajo || 0, mg.izq || 0, mg.der || 0) * 1.6));
    };
    const largoTira = Math.max(W, H) * 0.09, pad = tiras.length ? largoTira + 1 : 1;
    const pts = (ps) => ps.map(p => p.join(',')).join(' ');
    const id = `am${Math.round(W * 10)}x${Math.round(H * 10)}${forma[0]}${punta[0]}`;
    const k = ancho / (W + 2 * pad);
    const linea = Math.max(W, H) / 220;
    return (
        <svg width={ancho} height={Math.min(260, (H + 2 * pad) * k)} viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} className="shrink-0" role="img" aria-label="Cómo queda">
            <defs>
                <clipPath id={`${id}c`}>{forma === 'circulo' ? <circle cx={cx} cy={cy} r={W / 2} /> : <polygon points={pts(corte)} />}</clipPath>
            </defs>
            {/* las tiras, debajo de la tela */}
            {tiras.map((t, i) => {
                const c = hastaCorte(t), x0 = t.x + t.nx * c, y0 = t.y + t.ny * c;
                return <line key={`t${i}`} x1={x0} y1={y0} x2={x0 + t.nx * largoTira} y2={y0 + t.ny * largoTira} stroke="#d4d4d8" strokeWidth={linea * 3.2} strokeLinecap="round" />;
            })}
            <g clipPath={`url(#${id}c)`}>
                <rect x={0} y={0} width={W} height={H} fill="#fff" />
                {vista && <image href={vista} x={0} y={0} width={W} height={H} preserveAspectRatio={ajuste === 'entera' ? 'xMidYMid meet' : 'xMidYMid slice'} />}
            </g>
            {forma === 'circulo' ? <circle cx={cx} cy={cy} r={W / 2} fill="none" stroke="#71717a" strokeWidth={linea} /> : <polygon points={pts(corte)} fill="none" stroke="#71717a" strokeWidth={linea} />}
            {/* la línea de doblez (la medida del diseño) */}
            {/* oscura debajo y punteada blanca encima: se ve sobre cualquier color del arte */}
            {(W > md.ancho + 0.01 || H > md.alto + 0.01) && [['#000', 0.35, linea * 1.8, null], ['#fff', 0.95, linea, `${linea * 4} ${linea * 3}`]].map(([color, op, ancho, guiones]) => (forma === 'circulo'
                ? <circle key={color} cx={cx} cy={cy} r={md.ancho / 2} fill="none" stroke={color} strokeOpacity={op} strokeWidth={ancho} strokeDasharray={guiones || undefined} />
                : <polygon key={color} points={pts(guia)} fill="none" stroke={color} strokeOpacity={op} strokeWidth={ancho} strokeDasharray={guiones || undefined} />))}
            {/* las marcas que imprime TIZADA: negras con contorno blanco */}
            {calc?.tiras?.marcadas_en_tizada !== false && tiras.filter(t => t.marca).map((t, i) => {
                const c = Math.max(hastaCorte(t), linea * 6);
                return (
                    <g key={`m${i}`}>
                        <line x1={t.x} y1={t.y} x2={t.x + t.nx * c} y2={t.y + t.ny * c} stroke="#fff" strokeWidth={linea * 3.4} />
                        <line x1={t.x} y1={t.y} x2={t.x + t.nx * c} y2={t.y + t.ny * c} stroke="#000" strokeWidth={linea * 1.6} />
                    </g>
                );
            })}
        </svg>
    );
}

// Editor de la medida de UN diseño. onCambiar(patch) junta { medida?, tela?, cantidad? } en el diseño (sin guardar).
// cliente (portal): una sola tela se muestra sin elegir; sin tela, se pone sola la primera donde entra (guía TIZADA §5.7);
// tiras fijas que no van, no se muestran.
// onCalc(calc): las cuentas de TIZADA cada vez que cambian (el portal dibuja con eso la forma con el arte y las tiras).
export function MedidaDiseno({ id, p, d, am, puede, onCambiar, cliente = false, onCalc = null }) {
    const cfg = am.config;
    const N = am.nombres || {};
    const m = d.medida || {};
    const fijas = cfg.medidas?.modo === 'FIJAS';
    const fija = fijas ? (cfg.medidas.fijas || []).find(x => x.nombre === m.fija) : null;
    const forma = fija ? fija.forma : (cfg.formas.includes(m.forma) ? m.forma : cfg.forma);
    const punta = forma === 'triangulo' ? (fija?.orientacion || m.orientacion || cfg.orientacion) : null;
    const terminacion = cfg.terminaciones.includes(m.terminacion) ? m.terminacion : cfg.terminacion;
    const tiras = m.tiras || cfg.tiras;
    const lados = am.lados?.[forma] || [];
    const set = (patch) => onCambiar({ medida: { ...m, forma, orientacion: punta, terminacion, ...patch } });

    // Cuentas de TIZADA en vivo (medio segundo después del último cambio)
    const [calc, setCalc] = useState(null);
    const [calculando, setCalculando] = useState(false);
    const firma = JSON.stringify([d.medida, d.tela]);
    useEffect(() => {
        let vivo = true;
        const t = setTimeout(async () => {
            setCalculando(true);
            try { const r = await svc.tizadaProCalcular(id, p.ProductoSolID, d.medida || {}, d.tela || null); if (vivo) setCalc(r); }
            catch (e) { if (vivo) setCalc({ ok: false, errores: [errorDe(e)] }); }
            finally { if (vivo) setCalculando(false); }
        }, 500);
        return () => { vivo = false; clearTimeout(t); };
    }, [firma, id, p.ProductoSolID]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { onCalc?.(calc); }, [calc]);   // eslint-disable-line react-hooks/exhaustive-deps
    const telaCalc = calc?.ok ? (calc.telas || []).find(t => String(t.id) === String(d.tela)) : null;
    // Portal: sin tela elegida, la primera del producto donde entra la medida
    const primeraQueEntra = cliente && puede && !d.tela && calc?.ok ? (calc.telas || []).find(t => t.entra && (am.telas || []).some(x => String(x.id) === String(t.id))) : null;
    useEffect(() => { if (primeraQueEntra) onCambiar({ tela: String(primeraQueEntra.id) }); }, [primeraQueEntra?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
    const inputM = (valor, onCh, titulo) => (
        <input type="number" step="0.01" min="0" value={valor ?? ''} disabled={!puede} title={titulo} placeholder="0,00"
            onChange={e => onCh(metros(e.target.value))} className={`${INPUT} !w-20 !py-1 font-bold`} />
    );
    // [PORTAL 14/10] El cliente no cambia nada de lo que establece el producto (por ahora): forma, punta, medida,
    // terminación y tiras se muestran como texto; elige la tela, la cantidad y, si el producto tiene varias medidas
    // fijas, cuál de ellas. El servidor hace lo mismo (solicitudesVendedorTizadaPro.medidaDelCliente).
    const textoTiras = (t) => (t?.lleva ? lados.map(l => `${NOMBRE_LADO[l]} ${t.lados?.[l] ?? 0}`).join(' · ') + (t.marcar === false ? ' (solo en la ficha)' : '') : 'No lleva');
    const medidaTexto = forma === 'circulo' ? `Ø ${m.diametro_m ?? fija?.diametro_m ?? '—'} m` : `${m.ancho_m ?? fija?.ancho_m ?? '—'} × ${m.alto_m ?? fija?.alto_m ?? '—'} m`;
    const filaFija = (etiqueta, contenido) => (
        <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-[11px] font-black text-slate-500">{etiqueta}</span>
            <span className="text-[12px] font-bold text-slate-700">{contenido}</span>
        </div>
    );
    return (
        <div className="px-3 py-2 space-y-2 bg-white">
            {cliente ? (<>
                {fijas && (cfg.medidas.fijas || []).length > 1 ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="w-24 text-[11px] font-black text-slate-500">Medida</span>
                        <Selector value={m.fija || ''} disabled={!puede} onChange={e => onCambiar({ medida: { fija: e.target.value } })} claseBoton={claseSel(`${SEL_CAMPO} min-w-[200px] ${m.fija ? '' : '!border-amber-400'}`)} anchoLista={260}>
                            {!m.fija && <option value="">— elegí la medida —</option>}
                            {cfg.medidas.fijas.map(x => <option key={x.nombre} value={x.nombre}>{x.nombre}</option>)}
                        </Selector>
                        {fija && <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><IconoForma forma={fija.forma} punta={fija.orientacion} size={18} />{medidaTexto}</span>}
                    </div>
                ) : filaFija('Medida', <span className="inline-flex items-center gap-1.5"><IconoForma forma={forma} punta={punta || 'abajo'} size={18} />{fija?.nombre ? `${fija.nombre} · ` : ''}{N[forma]}{forma === 'triangulo' ? ` ${String(N[punta] || '').toLowerCase()}` : ''} · {medidaTexto}</span>)}
                {filaFija('Terminación', N[terminacion] || terminacion)}
                {cfg.tiras.lleva && filaFija('Tiras', textoTiras(cfg.tiras))}
            </>) : fijas ? (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="w-24 text-[11px] font-black text-slate-500">Medida</span>
                    <Selector value={m.fija || ''} disabled={!puede} onChange={e => onCambiar({ medida: { ...m, fija: e.target.value } })} claseBoton={claseSel(`${SEL_CAMPO} min-w-[200px] ${m.fija ? '' : '!border-amber-400'}`)} anchoLista={260}>
                        {!m.fija && <option value="">— elegí la medida —</option>}
                        {cfg.medidas.fijas.map(x => <option key={x.nombre} value={x.nombre}>{x.nombre}</option>)}
                    </Selector>
                    {fija && <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><IconoForma forma={fija.forma} punta={fija.orientacion} size={18} />{fija.forma === 'circulo' ? `Ø ${fija.diametro_m} m` : `${fija.ancho_m} × ${fija.alto_m} m`}</span>}
                </div>
            ) : (<>
                {cfg.formas.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="w-24 text-[11px] font-black text-slate-500">Forma</span>
                        {cfg.formas.map(f => <button key={f} type="button" disabled={!puede} aria-pressed={forma === f} onClick={() => set({ forma: f })} className={chip(forma === f)}><IconoForma forma={f} punta={punta || 'abajo'} size={18} />{N[f]}</button>)}
                    </div>
                )}
                {forma === 'triangulo' && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="w-24 text-[11px] font-black text-slate-500">Punta</span>
                        {(am.permitido?.puntas || ['abajo', 'arriba', 'izq', 'der']).map(o => <button key={o} type="button" disabled={!puede} aria-pressed={punta === o} onClick={() => set({ orientacion: o })} className={chip(punta === o)}><IconoForma forma="triangulo" punta={o} size={18} />{N[o]}</button>)}
                    </div>
                )}
                {/* 3 · Medida del diseño (mínimo = máximo: la define el producto, no se escribe) */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className="w-24 text-[11px] font-black text-slate-500">Medida del diseño</span>
                    {cfg.medidas.minimo_m > 0 && cfg.medidas.minimo_m === cfg.medidas.maximo_m
                        ? <span className="text-[12px] font-bold text-slate-700">{forma === 'circulo' ? `Ø ${cfg.medidas.minimo_m} m` : `${cfg.medidas.minimo_m} × ${cfg.medidas.maximo_m} m`} <span className="text-[10px] font-normal text-slate-400">la define el producto</span></span>
                        : forma === 'circulo'
                        ? <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">Diámetro {inputM(m.diametro_m, v => set({ diametro_m: v }), 'El diámetro del diseño, en metros')} m</label>
                        : <>
                            <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">Ancho {inputM(m.ancho_m, v => set({ ancho_m: v }), 'De izquierda a derecha, colgada como se va a ver')} m</label>
                            <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600">Alto {inputM(m.alto_m, v => set({ alto_m: v }), 'De arriba a abajo, colgada como se va a ver')} m</label>
                        </>}
                    {cfg.medidas.minimo_m !== cfg.medidas.maximo_m && <span className="text-[10px] text-slate-400">
                        {forma === 'triangulo' ? 'La caja que encierra el triángulo, colgado como se va a ver. ' : ''}
                        La del diseño (sin margen): de {cfg.medidas.minimo_m} a {cfg.medidas.maximo_m} m.
                    </span>}
                </div>
            </>)}
            {/* 4 · Terminación (portal: va como texto, arriba) */}
            {!cliente && cfg.terminaciones.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="w-24 text-[11px] font-black text-slate-500">Terminación</span>
                    {cfg.terminaciones.map(t => <button key={t} type="button" disabled={!puede} aria-pressed={terminacion === t} onClick={() => set({ terminacion: t })} className={chip(terminacion === t)}>{N[t]}</button>)}
                </div>
            )}
            {/* 5 · Tela y cantidad */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-[11px] font-black text-slate-500">Tela</span>
                {cliente && (am.telas || []).length === 1 && String(d.tela) === String(am.telas[0].id)
                    ? <span className="text-[12px] font-bold text-slate-700 min-w-[220px]">{am.telas[0].nombre}</span>
                    : <Selector value={d.tela ? String(d.tela) : ''} disabled={!puede} onChange={e => onCambiar({ tela: e.target.value })} claseBoton={claseSel(`${SEL_CAMPO} min-w-[220px] ${d.tela ? '' : '!border-amber-400'}`)} anchoLista={300}>
                        {!d.tela && <option value="">— elegí la tela —</option>}
                        {(am.telas || []).map(t => {
                            const c = calc?.ok ? (calc.telas || []).find(x => String(x.id) === String(t.id)) : null;
                            return <option key={t.id} value={String(t.id)}>{t.nombre}{c ? (c.entra ? ' · entra' : ' · NO entra') : ''}</option>;
                        })}
                    </Selector>}
                <span className="text-[11px] font-black text-slate-500 ml-2">Cantidad</span>
                <input type="number" min="1" step="1" value={d.cantidad ?? ''} disabled={!puede} placeholder="0"
                    onChange={e => onCambiar({ cantidad: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                    className={`${INPUT} !w-20 !py-1 font-bold ${Number(d.cantidad) > 0 ? '' : '!border-amber-400'}`} />
            </div>
            {/* 6 · Tiras (portal: van como texto, arriba) */}
            {!cliente && <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-[11px] font-black text-slate-500">Tiras</span>
                {cfg.tiras.fijas ? (
                    <span className="text-[11px] text-slate-600">{cfg.tiras.lleva ? `${lados.map(l => `${NOMBRE_LADO[l]} ${cfg.tiras.lados?.[l] ?? 0}`).join(' · ')}${cfg.tiras.marcar === false ? ' (solo en la ficha)' : ''}` : 'No lleva'} {!cliente && <span className="text-slate-400">(las define el producto)</span>}</span>
                ) : (<>
                    <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600"><input type="checkbox" checked={!!tiras.lleva} disabled={!puede} onChange={e => set({ tiras: { ...tiras, lleva: e.target.checked } })} />Lleva</label>
                    {tiras.lleva && lados.map(l => (
                        <label key={l} className="flex items-center gap-1 text-[11px] font-bold text-slate-600">{NOMBRE_LADO[l]}
                            <input type="number" min="0" max={l === 'alrededor' ? 200 : 50} step="1" disabled={!puede} value={tiras.lados?.[l] ?? cfg.tiras.lados?.[l] ?? 0}
                                onChange={e => set({ tiras: { ...tiras, lados: { ...(tiras.lados || {}), [l]: Math.max(0, parseInt(e.target.value, 10) || 0) } } })} className={`${INPUT} !w-14 !py-1`} />
                        </label>
                    ))}
                    {tiras.lleva && <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600" title="Sin tilde no se imprimen en la tizada: salen en la ficha técnica"><input type="checkbox" checked={tiras.marcar !== false} disabled={!puede} onChange={e => set({ tiras: { ...tiras, marcar: e.target.checked } })} />Marcarlas en la tizada</label>}
                    {tiras.lleva && <span className="text-[10px] text-slate-400">por lado, contando las 2 puntas (5 = una en cada esquina y 3 en el medio · 1 = una en el medio)</span>}
                </>)}
            </div>}

            {/* Lo que dice TIZADA */}
            <div className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${calc?.ok ? (calc.entra_en_alguna === false || (telaCalc && !telaCalc.entra) ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50/60') : 'border-slate-200 bg-slate-50'}`}>
                {calculando && <span className="inline-flex items-center gap-1 text-slate-500"><Loader2 size={11} className="animate-spin" /> TIZADA está haciendo las cuentas…</span>}
                {!calculando && calc?.sinTizada && <span className="text-slate-500">Sin conexión con TIZADA: no se puede calcular el total ({calc.sinTizada}).</span>}
                {!calculando && calc && !calc.ok && !calc.sinTizada && (
                    <ul className="space-y-0.5 text-amber-800">
                        {(calc.errores || []).map((e, k) => <li key={`e${k}`} className="flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{e}</li>)}
                        {(calc.alarmas || []).map((a, k) => <li key={`a${k}`} className="flex items-start gap-1 text-rose-700"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{a.mensaje || a.codigo}</li>)}
                        {calc.error && <li className="text-rose-700">{calc.error}</li>}
                    </ul>
                )}
                {!calculando && calc?.ok && (
                    <div className="space-y-1">
                        <div className="text-slate-700">
                            Diseño <b>{cm(calc.medida_diseno_cm?.ancho)} × {cm(calc.medida_diseno_cm?.alto)} cm</b> → total impreso con el margen <b>{cm(calc.total_cm?.ancho)} × {cm(calc.total_cm?.alto)} cm</b>
                            {calc.terminacion ? <> · {N[calc.terminacion] || calc.terminacion}</> : null}
                        </div>
                        {d.tela && telaCalc && (telaCalc.entra
                            ? <div className="text-emerald-700 font-bold inline-flex items-center gap-1"><CheckCircle2 size={12} />Entra en {telaCalc.nombre}</div>
                            : <div className="text-rose-700 font-bold inline-flex items-center gap-1"><XCircle size={12} />No entra en {telaCalc.nombre}{telaCalc.motivo ? `: ${telaCalc.motivo}` : ''}</div>)}
                        {!d.tela && calc.entra_en_alguna === false && <div className="text-rose-700 font-bold">No entra en ninguna tela del producto: achicá la medida.</div>}
                        {calc.tiras?.lleva && (calc.tiras.por_lado || []).length > 0 && (
                            <div className="text-slate-600">Tiras: {calc.tiras.total_marcas} marca{calc.tiras.total_marcas === 1 ? '' : 's'}{calc.tiras.marcadas_en_tizada === false ? ' (solo en la ficha)' : ''} — {calc.tiras.por_lado.map(x => `${NOMBRE_LADO[x.lado] || x.lado} ${x.marcas}${x.cada_cm ? ` cada ${cm(x.cada_cm)} cm` : x.en_el_medio ? ' en el medio' : ''}`).join(' · ')}</div>
                        )}
                        {(calc.alarmas || []).length > 0 && <div className="text-amber-700">{calc.alarmas.map(a => a.mensaje || a.codigo).join(' · ')}</div>}
                    </div>
                )}
                {!calculando && !calc && <span className="text-slate-400">Escribí la medida para ver el total y si entra en la tela.</span>}
            </div>
        </div>
    );
}

// [PORTAL] La guía .ai (abre en cualquier Illustrator) con la medida de UN diseño, para que el cliente arme su arte encima.
// Si la plantilla ya pedida es de la medida de hoy, se baja esa; si no, se pide a TIZADA y se espera a que esté (≈1 min).
export async function bajarGuiaDe(id, p, d, am) {
    const vigente = am?.plantilla && !(am.plantilla.deOtraMedida || []).includes(d.nombre);
    if (!vigente) await svc.tizadaProPlantillaPedir(id, p.ProductoSolID);
    let est = null;
    for (let i = 0; i < 30; i++) {
        est = await svc.tizadaProPlantillaEstado(id, p.ProductoSolID);
        if (['listo', 'rechazado', 'error'].includes(est?.estado)) break;
        await new Promise(ok => setTimeout(ok, 2000));
    }
    if (est?.estado !== 'listo') throw new Error((est?.alarmas || []).map(a => a.mensaje || a.codigo).join(' ') || 'TIZADA todavía no armó la plantilla: probá de nuevo en un momento.');
    const guias = (est.archivos || []).filter(x => x.tipo === 'guia');
    const a = guias.find(x => String(x.diseno || '').toUpperCase() === d.nombre) || guias[0];
    if (!a) throw new Error('La plantilla no trae la guía .ai.');
    const blob = await svc.tizadaProPlantillaBajar(id, p.ProductoSolID, a.nombre);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = a.nombre; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Plantilla para el diseñador (Illustrator, CorelDRAW y la guía .ai) con la medida de cada diseño. El arte se arma
// sobre ella: TIZADA frena un arte de otra medida (arte-otra-medida).
export function PlantillaAMedida({ id, p, am, puede, sucio, onPedida }) {
    const [estado, setEstado] = useState(null);
    const [ocupado, setOcupado] = useState('');
    const pl = am.plantilla;
    const ver = async () => {
        setOcupado('ver');
        try { setEstado(await svc.tizadaProPlantillaEstado(id, p.ProductoSolID)); }
        catch (e) { toast.error(errorDe(e)); } finally { setOcupado(''); }
    };
    const pedir = async () => {
        setOcupado('pedir');
        try {
            const r = await svc.tizadaProPlantillaPedir(id, p.ProductoSolID);
            toast.success(`Plantilla ${r.referencia} pedida a TIZADA PRO. Se arma en segundos: tocá "Ver archivos".`);
            setEstado(null);
            onPedida?.();   // vuelve a leer: se ve la plantilla nueva con sus medidas
        } catch (e) { toast.error(errorDe(e)); } finally { setOcupado(''); }
    };
    const bajar = async (a) => {
        setOcupado(`bajar-${a.nombre}`);
        try {
            const blob = await svc.tizadaProPlantillaBajar(id, p.ProductoSolID, a.nombre);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a'); link.href = url; link.download = a.nombre; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e) { toast.error(errorDe(e)); } finally { setOcupado(''); }
    };
    const TIPO = { illustrator: 'Illustrator (con el conector)', corel: 'CorelDRAW (con el conector)', guia: 'Guía .ai (abre en cualquier Illustrator)' };
    return (
        <div className="border border-slate-200 rounded-xl p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wide text-slate-400 inline-flex items-center gap-1"><FileStack size={12} /> Plantilla para el diseñador</span>
                <span className="text-[11px] text-slate-500">la base con la medida de cada diseño: el arte se arma sobre ella</span>
                <span className="ml-auto flex items-center gap-2">
                    {pl && <button type="button" onClick={ver} disabled={!!ocupado} className={BTN_SECUNDARIO}>{ocupado === 'ver' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Ver archivos</button>}
                    {puede && <button type="button" onClick={pedir} disabled={!!ocupado || sucio} title={sucio ? 'Guardá primero las medidas' : ''} className={BTN_SECUNDARIO}>{ocupado === 'pedir' ? <Loader2 size={12} className="animate-spin" /> : <FileStack size={12} />} {pl ? 'Pedirla de nuevo' : 'Pedir plantilla con estas medidas'}</button>}
                </span>
            </div>
            {pl && <div className="text-[11px] text-slate-600"><b className="font-mono">{pl.referencia}</b> · {Object.entries(pl.medidas || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>}
            {pl?.deOtraMedida?.length > 0 && (
                <div className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 flex items-start gap-1">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />La medida de {pl.deOtraMedida.join(', ')} cambió después de pedir la plantilla: pedila de nuevo y rehacé el arte (TIZADA frena un arte de otra medida).
                </div>
            )}
            {estado && (
                <div className="space-y-1">
                    <div className="text-[11px] text-slate-600">Estado: <b>{estado.estado || '—'}</b>{estado.etapa ? ` · ${estado.etapa}` : ''}</div>
                    {(estado.alarmas || []).map((a, k) => <div key={k} className="text-[11px] text-amber-700">{a.mensaje || a.codigo}</div>)}
                    {(estado.archivos || []).map(a => (
                        <button key={a.nombre} type="button" onClick={() => bajar(a)} disabled={!!ocupado} className="flex items-center gap-1.5 text-[11px] font-bold text-brand-cyan hover:underline">
                            {ocupado === `bajar-${a.nombre}` ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}{a.nombre}<span className="font-normal text-slate-400">· {TIPO[a.tipo] || a.tipo}{a.parte ? ` · parte ${a.parte}` : ''}</span>
                        </button>
                    ))}
                    {estado.estado && !['listo', 'rechazado', 'error'].includes(estado.estado) && <div className="text-[11px] text-slate-500">TIZADA la está armando: volvé a tocar "Ver archivos" en unos segundos.</div>}
                </div>
            )}
        </div>
    );
}
