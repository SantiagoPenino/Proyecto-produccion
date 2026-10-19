import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { Ban, Pencil, Store, UserRound, X } from 'lucide-react';
import api from '../../../services/apiClient';
import { BuscadorCliente, Campo, INPUT, BTN_PRIMARIO, BTN_SECUNDARIO, BTN_PELIGRO, errorDe } from './solicitudesComunes';
import {
    MESES, SIMBOLO, ESTILOS, money, r2, comisionDe, textoFranja, escalaDe,
    BarraFranjas, PastillaFranja, FaltaParaFranja, useCotizacionMes, CotizacionMes, SelectorMes,
} from './comisionesComunes';

/* ══════════════════════════════════════════════════════════════════════
   VENTAS DE SALÓN  (/vendedores/salon) — 19/10/2026

   Los vendedores de salón cargan acá las ventas de promos que hacen:
   fecha, vendedor, cliente o consumidor final, moneda, monto y
   observaciones (tabla VentasSalon, backend services/ventasSalonService.js).
     · Cada vendedor ve y carga SUS ventas. Las corrige o anula mientras
       sean del mes en curso: un mes cerrado ya se comisionó.
     · Quien tiene «Comisiones de salón» en su menú (supervisor) ve las de
       todos, carga a nombre de otro, con cualquier fecha, y corrige o anula
       cualquiera.
     · Arriba, lo vendido en el mes, el total unificado en US$ (misma
       cotización que Ventas por vendedor) y, si se mira a un solo vendedor,
       su franja y la comisión que lleva.
   ══════════════════════════════════════════════════════════════════════ */

const pad = (n) => String(n).padStart(2, '0');
const hoyTexto = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fechaCorta = (f) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
// Hasta cuántos meses para atrás se puede mirar
const MESES_ATRAS = 12;

const formVacio = () => ({ fecha: hoyTexto(), idUsuario: '', consumidorFinal: false, cliente: null, moneda: 'UYU', monto: '', observaciones: '' });

// Confirmación para anular: pide el motivo y explica qué pasa
function ModalAnular({ venta, onCancelar, onConfirmar }) {
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const confirmar = async () => {
        setEnviando(true);
        try { await onConfirmar(motivo.trim()); } finally { setEnviando(false); }
    };
    return (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onCancelar}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 mb-3">
                    <h2 className="text-base font-black text-slate-800">Anular la venta</h2>
                    <button onClick={onCancelar} className="text-slate-400 hover:text-slate-600" title="Volver sin anular"><X size={18} /></button>
                </div>
                <p className="text-sm text-slate-600 mb-3">
                    {fechaCorta(venta.fecha)} · {venta.cliente} · <b>{SIMBOLO[venta.moneda]} {money(venta.monto)}</b>.
                    {' '}Deja de contar para la comisión de {venta.vendedor}. Queda en la lista, tachada y con el motivo.
                </p>
                <Campo label="Por qué se anula">
                    <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} maxLength={300} autoFocus
                        placeholder="Ej.: se cargó dos veces" className={INPUT} />
                </Campo>
                <div className="mt-4 flex justify-end gap-2">
                    <button onClick={onCancelar} className={BTN_SECUNDARIO}>Volver</button>
                    <button onClick={confirmar} disabled={enviando || motivo.trim().length < 3} className={BTN_PELIGRO}
                        title={motivo.trim().length < 3 ? 'Escribí el motivo' : 'La venta deja de contar para la comisión'}>
                        <Ban size={13} /> Sí, anular
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function VentasSalonPage() {
    const hoy = new Date();
    const [anio, setAnio] = useState(hoy.getFullYear());
    const [mes, setMes] = useState(hoy.getMonth() + 1);
    const [direccion, setDireccion] = useState(0);
    const [perfil, setPerfil] = useState(null);            // { idUsuario, supervisor, editaFranjas }
    const [vendedores, setVendedores] = useState([]);      // solo supervisor: para cargar a nombre de otro
    const [filtroVendedor, setFiltroVendedor] = useState('');   // solo supervisor: '' = todos
    const [ventas, setVentas] = useState([]);
    const [franjas, setFranjas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState(formVacio);
    const [editando, setEditando] = useState(null);        // la venta que se está corrigiendo
    const [guardando, setGuardando] = useState(false);
    const [anulando, setAnulando] = useState(null);        // la venta que se va a anular
    const { cotizacion, cotFecha, esMesActual, cargandoCot, refrescarCotizacion } = useCotizacionMes(anio, mes);
    const supervisor = !!perfil?.supervisor;

    useEffect(() => {
        api.get('/ventas-salon/mi-perfil')
            .then(r => {
                setPerfil(r.data.data);
                if (r.data.data.supervisor) {
                    api.get('/ventas-salon/vendedores').then(v => setVendedores(v.data.data || [])).catch(() => {});
                }
            })
            .catch(e => toast.error(errorDe(e)));
        api.get('/ventas-salon/franjas')
            .then(r => setFranjas((r.data.data || []).map(f => ({ ...f, texto: textoFranja(f.pct) }))))
            .catch(() => {});
    }, []);

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/ventas-salon', { params: { anio, mes, idUsuario: filtroVendedor || undefined } });
            setVentas(r.data.data || []);
        } catch (e) {
            toast.error(errorDe(e));
            setVentas([]);
        } finally { setLoading(false); }
    }, [anio, mes, filtroVendedor]);

    useEffect(() => { if (perfil) cargar(); }, [perfil, cargar]);

    const mover = (delta) => {
        let m = mes + delta, a = anio;
        if (m < 1) { m = 12; a -= 1; }
        if (m > 12) { m = 1; a += 1; }
        setDireccion(Math.sign(delta));
        setMes(m); setAnio(a);
    };
    const indiceMes = anio * 12 + mes;
    const indiceHoy = hoy.getFullYear() * 12 + hoy.getMonth() + 1;

    // Lo que suma el mes (sin las anuladas) y, si se mira a un solo vendedor, su franja
    const activas = useMemo(() => ventas.filter(v => !v.anulada), [ventas]);
    const totales = useMemo(() => ({
        UYU: r2(activas.filter(v => v.moneda === 'UYU').reduce((s, v) => s + v.monto, 0)),
        USD: r2(activas.filter(v => v.moneda === 'USD').reduce((s, v) => s + v.monto, 0)),
    }), [activas]);
    const unificado = cotizacion > 0 ? r2(totales.USD + totales.UYU / cotizacion) : null;
    const unSoloVendedor = !supervisor || !!filtroVendedor;
    const nombreVendedor = !supervisor ? 'Tu mes'
        : filtroVendedor ? `Mes de ${vendedores.find(v => String(v.idUsuario) === String(filtroVendedor))?.nombre || 'el vendedor'}` : 'Todos los vendedores';

    // ── Formulario ──
    const set = (campo) => (e) => setForm(f => ({ ...f, [campo]: e?.target ? e.target.value : e }));
    const empezarCorreccion = (v) => {
        setEditando(v);
        setForm({
            // '' = «Yo» en el selector del supervisor
            fecha: v.fecha, idUsuario: v.idUsuario === perfil?.idUsuario ? '' : String(v.idUsuario), consumidorFinal: v.consumidorFinal,
            cliente: v.consumidorFinal ? null : { CliIdCliente: v.cliIdCliente, Nombre: v.cliente, Codigo: v.codigoCliente || '' },
            moneda: v.moneda, monto: String(v.monto).replace('.', ','), observaciones: v.observaciones || '',
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const cancelarCorreccion = () => { setEditando(null); setForm(formVacio()); };

    const guardar = async (e) => {
        e.preventDefault();
        if (!form.consumidorFinal && !form.cliente?.CliIdCliente) { toast.error('Elegí el cliente o marcá «Consumidor final».'); return; }
        setGuardando(true);
        const cuerpo = {
            fecha: form.fecha,
            // El supervisor siempre manda el vendedor («Yo» = él); el vendedor no: el servidor usa el suyo
            idUsuario: supervisor ? Number(form.idUsuario || perfil.idUsuario) : undefined,
            consumidorFinal: form.consumidorFinal,
            cliIdCliente: form.consumidorFinal ? null : form.cliente.CliIdCliente,
            moneda: form.moneda,
            monto: form.monto,
            observaciones: form.observaciones,
        };
        try {
            const r = editando
                ? await api.put(`/ventas-salon/${editando.id}`, cuerpo)
                : await api.post('/ventas-salon', cuerpo);
            const v = r.data.data;
            toast.success(`${editando ? 'Venta corregida' : 'Venta guardada'}: ${SIMBOLO[v.moneda]} ${money(v.monto)} a ${v.cliente}, de ${v.vendedor}`);
            setEditando(null);
            setForm(formVacio());
            cargar();
        } catch (err) {
            toast.error(errorDe(err));
        } finally { setGuardando(false); }
    };

    const anular = async (motivo) => {
        try {
            await api.post(`/ventas-salon/${anulando.id}/anular`, { motivo });
            toast.success(`Venta anulada: ya no cuenta para la comisión de ${anulando.vendedor}`);
            if (editando?.id === anulando.id) cancelarCorreccion();
            setAnulando(null);
            cargar();
        } catch (err) {
            toast.error(errorDe(err));
        }
    };

    // Fechas que se pueden elegir: el vendedor, solo el mes en curso; el supervisor, cualquiera hasta hoy
    const fechaMin = supervisor ? undefined : `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-01`;
    const nombreMes = MESES[mes - 1].toLowerCase();
    const columnas = supervisor && !filtroVendedor ? 7 : 6;

    return (
        <div className="px-4 pt-3 pb-4 md:px-6 md:pt-0 md:pb-6 w-full font-sans text-slate-800">
            <style>{ESTILOS}</style>
            {/* Encabezado */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center">
                        <Store size={20} />
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight text-slate-800">Ventas de salón</h1>
                        <p className="text-xs text-slate-500">Las ventas de promos hechas en el salón. Cuentan para la comisión del mes.</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <CotizacionMes cotizacion={cotizacion} cotFecha={cotFecha} esMesActual={esMesActual} nombreMes={nombreMes}
                        cargandoCot={cargandoCot} onRefrescar={refrescarCotizacion} />
                    <SelectorMes anio={anio} mes={mes} direccion={direccion} loading={loading}
                        puedeAtras={indiceMes > indiceHoy - MESES_ATRAS} puedeAdelante={indiceMes < indiceHoy}
                        onMover={mover} onActualizar={() => { setDireccion(0); cargar(); }} />
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr] items-start">
                {/* Formulario de carga / corrección */}
                <form onSubmit={guardar} className={`bg-white border rounded-xl shadow-sm p-4 space-y-3 ${editando ? 'border-amber-300' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-black text-slate-700">{editando ? `Corregir la venta del ${fechaCorta(editando.fecha)}` : 'Cargar una venta'}</h2>
                        {editando && <button type="button" onClick={cancelarCorreccion} className="text-xs font-bold text-slate-500 hover:underline">Cancelar corrección</button>}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Campo label="Fecha">
                            <input type="date" value={form.fecha} onChange={set('fecha')} min={fechaMin} max={hoyTexto()} required className={INPUT} />
                        </Campo>
                        {supervisor ? (
                            <Campo label="Vendedor">
                                <select value={form.idUsuario} onChange={set('idUsuario')} className={INPUT}>
                                    <option value="">Yo</option>
                                    {vendedores.filter(v => v.idUsuario !== perfil?.idUsuario).map(v => <option key={v.idUsuario} value={v.idUsuario}>{v.nombre}</option>)}
                                </select>
                            </Campo>
                        ) : (
                            <Campo label="Vendedor"><div className="py-1.5 text-sm text-slate-600 flex items-center gap-1"><UserRound size={14} /> Vos</div></Campo>
                        )}
                    </div>

                    <Campo label="Cliente">
                        <div className="flex gap-1 mb-2">
                            {[{ v: false, t: 'Cliente con ficha' }, { v: true, t: 'Consumidor final' }].map(o => (
                                <button key={o.t} type="button" onClick={() => setForm(f => ({ ...f, consumidorFinal: o.v }))}
                                    className={`flex-1 px-2 py-1.5 rounded-lg border text-xs font-bold ${form.consumidorFinal === o.v ? 'bg-brand-cyan border-brand-cyan text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                    {o.t}
                                </button>
                            ))}
                        </div>
                        {!form.consumidorFinal && <BuscadorCliente cliente={form.cliente} onPick={c => setForm(f => ({ ...f, cliente: c }))} />}
                    </Campo>

                    <div className="grid grid-cols-[auto_1fr] gap-3">
                        <Campo label="Moneda">
                            <div className="flex gap-1">
                                {['UYU', 'USD'].map(m => (
                                    <button key={m} type="button" onClick={() => setForm(f => ({ ...f, moneda: m }))}
                                        className={`px-3 py-1.5 rounded-lg border text-xs font-black ${form.moneda === m ? 'bg-brand-cyan border-brand-cyan text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                        {SIMBOLO[m]}
                                    </button>
                                ))}
                            </div>
                        </Campo>
                        <Campo label={`Monto en ${form.moneda === 'USD' ? 'dólares' : 'pesos'}`}>
                            <input type="text" inputMode="decimal" value={form.monto} onChange={set('monto')} required placeholder="0,00" className={`${INPUT} tabular-nums`} />
                        </Campo>
                    </div>

                    <Campo label="Observaciones" ayuda="Qué promo fue, número de ticket o factura, lo que sirva para controlarla.">
                        <textarea value={form.observaciones} onChange={set('observaciones')} rows={2} maxLength={500} className={INPUT} />
                    </Campo>

                    <div className="flex justify-end gap-2 pt-1">
                        {editando && <button type="button" onClick={cancelarCorreccion} className={BTN_SECUNDARIO}>Cancelar</button>}
                        <button type="submit" disabled={guardando || !perfil} className={BTN_PRIMARIO}>
                            {editando ? 'Guardar cambios' : 'Guardar venta'}
                        </button>
                    </div>
                </form>

                <div className="space-y-4 min-w-0">
                    {/* Resumen del mes */}
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <h2 className="text-sm font-black text-slate-700">{nombreVendedor} · {MESES[mes - 1]} {anio}</h2>
                            {supervisor && (
                                <select value={filtroVendedor} onChange={e => setFiltroVendedor(e.target.value)} className={`${INPUT} !w-auto`}>
                                    <option value="">Todos los vendedores</option>
                                    {vendedores.map(v => <option key={v.idUsuario} value={v.idUsuario}>{v.nombre}</option>)}
                                </select>
                            )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">$ vendido</div><div className="font-bold tabular-nums">{money(totales.UYU)}</div></div>
                            <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">US$ vendido</div><div className="font-bold tabular-nums">{money(totales.USD)}</div></div>
                            <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Total unificado US$</div><div className="font-black tabular-nums">{unificado != null ? money(unificado) : '—'}</div></div>
                            <div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Ventas</div><div className="font-bold tabular-nums">{activas.length}</div></div>
                        </div>
                        {unSoloVendedor && unificado != null && (
                            <div className="mt-4 space-y-1.5">
                                <div className="flex items-center gap-2 text-xs">
                                    <PastillaFranja valor={unificado} franjas={franjas} />
                                    <span className={comisionDe(unificado, franjas) > 0 ? 'font-bold text-sky-700' : 'text-slate-400'}>
                                        {comisionDe(unificado, franjas) > 0 ? `Comisión US$ ${money(comisionDe(unificado, franjas))}` : 'Sin comisión'}
                                    </span>
                                </div>
                                <BarraFranjas valor={unificado} escala={escalaDe(franjas, unificado)} franjas={franjas} />
                                <div className="text-[11px] text-slate-400"><FaltaParaFranja total={unificado} franjas={franjas} /></div>
                            </div>
                        )}
                    </div>

                    {/* Ventas del mes */}
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                                        <th className="text-left font-bold px-4 py-3">Fecha</th>
                                        {supervisor && !filtroVendedor && <th className="text-left font-bold px-3 py-3">Vendedor</th>}
                                        <th className="text-left font-bold px-3 py-3">Cliente</th>
                                        <th className="text-right font-bold px-3 py-3">Monto</th>
                                        <th className="text-left font-bold px-3 py-3">Observaciones</th>
                                        <th className="text-left font-bold px-3 py-3 whitespace-nowrap">Cargada por</th>
                                        <th className="px-3 py-3" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading && <tr><td colSpan={columnas} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>}
                                    {!loading && ventas.length === 0 && (
                                        <tr><td colSpan={columnas} className="px-4 py-8 text-center text-slate-400">Sin ventas cargadas en {nombreMes}.</td></tr>
                                    )}
                                    {!loading && ventas.map(v => (
                                        <tr key={v.id} className={`border-b border-slate-100 last:border-0 ${v.anulada ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'} ${editando?.id === v.id ? 'bg-amber-50' : ''}`}>
                                            <td className="px-4 py-2 whitespace-nowrap tabular-nums">{fechaCorta(v.fecha)}</td>
                                            {supervisor && !filtroVendedor && <td className="px-3 py-2 whitespace-nowrap">{v.vendedor}</td>}
                                            <td className="px-3 py-2">
                                                <span className={v.anulada ? 'line-through' : ''}>{v.cliente}</span>
                                                {v.codigoCliente && <span className="text-[11px] text-slate-400 font-mono"> · {v.codigoCliente}</span>}
                                            </td>
                                            <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums font-bold ${v.anulada ? 'line-through' : 'text-slate-800'}`}>
                                                {SIMBOLO[v.moneda]} {money(v.monto)}
                                            </td>
                                            <td className="px-3 py-2 text-xs">
                                                {v.observaciones}
                                                {v.anulada && (
                                                    <div className="mt-0.5 text-red-500 font-bold" title={v.fechaAnulacion ? `Anulada el ${fechaCorta(v.fechaAnulacion)}` : ''}>
                                                        Anulada por {v.usuarioAnulacion || '—'}: {v.motivoAnulacion}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-xs whitespace-nowrap">{v.usuarioAlta}</td>
                                            <td className="px-3 py-2 whitespace-nowrap text-right">
                                                {v.editable && (
                                                    <span className="inline-flex gap-1">
                                                        <button onClick={() => empezarCorreccion(v)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Corregir esta venta (sube al formulario)">
                                                            <Pencil size={14} />
                                                        </button>
                                                        <button onClick={() => setAnulando(v)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Anular: deja de contar para la comisión">
                                                            <Ban size={14} />
                                                        </button>
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            {/* Pie: qué se cuenta */}
            <div className="mt-4 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <b>Total unificado en US$</b>: lo vendido en dólares más lo vendido en pesos pasado a dólares con
                {esMesActual ? ' la cotización del día' : ` la última cotización de ${nombreMes}`}.
                {' '}<b>Comisión</b>: el % de la franja alcanzada sobre todo el total
                {franjas.length > 0 ? ` (${franjas.map(f => `desde US$ ${f.desde.toLocaleString('es-UY')}, ${f.texto}`).join('; ')})` : ' (todavía no hay franjas cargadas)'}.
                {' '}Las ventas anuladas no cuentan. {supervisor
                    ? 'Como tenés «Comisiones de salón», ves las ventas de todos y podés corregir o anular cualquiera.'
                    : 'Podés corregir o anular tus ventas mientras sean del mes en curso.'}
            </div>

            {anulando && <ModalAnular venta={anulando} onCancelar={() => setAnulando(null)} onConfirmar={anular} />}
        </div>
    );
}
