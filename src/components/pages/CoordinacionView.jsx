import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { ArrowUp, ArrowDown, ChevronsUp, Lock, Layers, ListOrdered, RefreshCw, ChevronDown, Search, X, Loader2 } from 'lucide-react';
import Selector from '../ui/Selector';
import { rollsService } from '../../services/modules/rollsService';
import { areasService } from '../../services/modules/areasService';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';

// ─── Helpers ────────────────────────────────────────────────────────────────

const PRIORITY_ORDER = { falla: 0, urgente: 1, normal: 2, 'reposición': 3 };


function getPrioGroup(order) {
    const p = (order.priority || 'normal').toLowerCase();
    if (p === 'falla') return 'falla';
    if (p === 'urgente') return 'urgente';
    if (p === 'reposición' || p === 'reposicion') return 'reposición';
    return 'normal';
}

function sortPendingOrders(orders) {
    // Within each group: higher Secuencia = first (top position)
    return [...orders].sort((a, b) => {
        const pa = PRIORITY_ORDER[getPrioGroup(a)] ?? 99;
        const pb = PRIORITY_ORDER[getPrioGroup(b)] ?? 99;
        if (pa !== pb) return pa - pb;
        return (b.sequence ?? 0) - (a.sequence ?? 0);
    });
}

// ─── Piezas comunes ──────────────────────────────────────────────────────────
// Estilo de las pantallas rehechas en claro (Precios, Bandeja de Diseño, Solicitudes; 09/10): paneles blancos
// con encabezado en mayúsculas, filas divididas, íconos Lucide en brand-cyan sin fondo y el color solo en los
// estados (falla, urgente, reposición).

const PRIO_ESTILO = {
    falla:        { label: 'Falla',      punto: 'bg-red-500',   texto: 'text-red-600' },
    urgente:      { label: 'Urgente',    punto: 'bg-[#BD0C7E]', texto: 'text-[#BD0C7E]' },
    'reposición': { label: 'Reposición', punto: 'bg-amber-500', texto: 'text-amber-600' },
    normal:       { label: 'Normal',     punto: 'bg-slate-400', texto: 'text-slate-500' },
};

function Panel({ icono: Icono, titulo, contador, extra, children }) {
    return (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-slate-100">
                <Icono size={16} className="text-brand-cyan shrink-0" />
                <h2 className="text-sm font-black text-slate-700 uppercase tracking-wide flex-1">{titulo}</h2>
                <span className="text-xs font-bold text-slate-400 bg-slate-100 rounded-full px-2.5 py-0.5 tabular-nums">{contador}</span>
            </div>
            {extra}
            {children}
        </section>
    );
}

function Vacio({ icono: Icono, texto }) {
    return (
        <div className="text-center py-14 text-slate-400">
            <Icono size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm">{texto}</p>
        </div>
    );
}

// Al tope / subir / bajar: el mismo grupo de botones en lotes y en órdenes.
function BotonesMover({ item, onMove, isFirst, isLast }) {
    const cls = 'w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-brand-cyan hover:bg-brand-cyan/10 disabled:opacity-25 disabled:pointer-events-none transition-colors';
    return (
        <div className="flex items-center shrink-0">
            <button type="button" disabled={isFirst} onClick={() => onMove(item, 'top')} className={cls} title="Mover al tope"><ChevronsUp size={15} /></button>
            <button type="button" disabled={isFirst} onClick={() => onMove(item, 'up')} className={cls} title="Subir"><ArrowUp size={15} /></button>
            <button type="button" disabled={isLast} onClick={() => onMove(item, 'down')} className={cls} title="Bajar"><ArrowDown size={15} /></button>
        </div>
    );
}

// Mismo ancho que los 3 botones, para que las filas bloqueadas queden alineadas con las otras.
const Bloqueado = ({ title }) => (
    <div className="w-[84px] flex justify-center shrink-0 text-slate-300" title={title}><Lock size={14} /></div>
);

// ─── OrderRow ────────────────────────────────────────────────────────────────

function OrderRow({ order, onMove, groupOrders, fullGroupOrders }) {
    const isFalla = getPrioGroup(order) === 'falla';
    // Position within FULL (unfiltered) group — so buttons aren't wrongly disabled when searching
    const posGroup = fullGroupOrders || groupOrders;
    const idx = posGroup.findIndex(o => o.id === order.id);
    const isFirst = idx === 0;
    const isLast = idx === posGroup.length - 1;

    return (
        <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/60 transition-colors">
            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{order.code}</p>
                <p className="text-xs text-slate-500 truncate">{order.client} · {order.material}</p>
            </div>
            <span className="text-xs font-bold text-slate-500 tabular-nums shrink-0">{order.magnitude?.toFixed(2)} m</span>
            {order.sequence != null && (
                <span className="text-[10px] font-black text-slate-400 bg-slate-100 rounded-full px-2 py-0.5 tabular-nums shrink-0" title="Secuencia">
                    #{order.sequence}
                </span>
            )}
            {isFalla
                ? <Bloqueado title="Las fallas no se reordenan" />
                : <BotonesMover item={order} onMove={onMove} isFirst={isFirst} isLast={isLast} />}
        </div>
    );
}

// ─── RollCard ─────────────────────────────────────────────────────────────────

const MOVABLE_STATES = ['abierto', 'en cola'];

function RollCard({ roll, onMove, isFirst, isLast }) {
    const isLocked = !MOVABLE_STATES.includes((roll.status || '').toLowerCase());
    const [expanded, setExpanded] = useState(false);
    const ordenes = roll.orders || [];

    return (
        <div className={isLocked ? 'bg-slate-50/60' : ''}>
            <div className="flex items-center gap-3 px-4 py-3">
                {isLocked
                    ? <Bloqueado title="En máquina: no se puede mover" />
                    : <BotonesMover item={roll} onMove={onMove} isFirst={isFirst} isLast={isLast} />}

                <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold truncate ${isLocked ? 'text-slate-500' : 'text-slate-800'}`}>{roll.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5 tabular-nums">
                        {ordenes.length} órdenes · {(roll.currentUsage || 0).toFixed(2)} m
                    </p>
                </div>

                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0 ${isLocked ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20'}`}>
                    {roll.status}
                </span>

                <button type="button" onClick={() => setExpanded(e => !e)} title={expanded ? 'Ocultar órdenes' : 'Ver órdenes'}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0">
                    <ChevronDown size={15} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* Orders list (collapsed by default) */}
            {expanded && (
                <div className="mx-4 mb-3 rounded-xl border border-slate-100 bg-slate-50/80 divide-y divide-slate-100">
                    {ordenes.length === 0 ? (
                        <p className="text-xs text-slate-400 italic px-3 py-2">Sin órdenes asignadas</p>
                    ) : ordenes.map(o => (
                        <div key={o.id} className="flex items-center gap-2 text-xs px-3 py-1.5">
                            <span className="font-bold text-slate-700">{o.code}</span>
                            <span className="text-slate-400 truncate flex-1">{o.client}</span>
                            <span className="text-slate-500 tabular-nums">{o.magnitude?.toFixed(2)} m</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CoordinacionView() {
    const [areas, setAreas] = useState([]);
    const [selectedArea, setSelectedArea] = useState(null);
    const [pendingOrders, setPendingOrders] = useState([]);
    const [rolls, setRolls] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [prioFilter, setPrioFilter] = useState('todas');

    // Load areas on mount
    useEffect(() => {
        areasService.getAll().then(data => {
            // Solo áreas productivas (las que usan el sistema de lotes)
            const productionAreas = data.filter(a => a.code && a.name && a.Productiva);
            setAreas(productionAreas);
            if (productionAreas.length > 0) setSelectedArea(productionAreas[0]);
        });
    }, []);

    // Load board data when area changes
    const loadData = useCallback(async () => {
        if (!selectedArea) return;
        setLoading(true);
        try {
            const data = await rollsService.getBoard(selectedArea.code);
            const sorted = sortPendingOrders(data.pendingOrders || []);
            setPendingOrders(sorted);

            // Separate movable vs locked rolls
            const movable = (data.rolls || []).filter(r => MOVABLE_STATES.includes((r.status || '').toLowerCase()));
            const locked  = (data.rolls || []).filter(r => !MOVABLE_STATES.includes((r.status || '').toLowerCase()));
            setRolls([...movable, ...locked]);
        } catch (err) {
            toast.error('Error cargando datos');
        } finally {
            setLoading(false);
        }
    }, [selectedArea]);

    useEffect(() => { loadData(); }, [loadData]);

    // ─── Socket Listener ───────────────────────────────────────────────────
    // Recargaba el kanban entero con CADA server:order_updated, que el server emite orden por orden
    // (mover un lote de 20 órdenes eran 20 recargas por cada Coordinación abierta; el kanban llegó a
    // 139 llamadas por minuto, 24/09). Freno de 8 s y pausa con la pestaña oculta, ver
    // hooks/useRecargaConFreno. Las acciones propias siguen llamando a loadData() directo.
    const avisarRecarga = useRecargaConFreno(() => {
        // Recargar datos sin mostrar el loader gigante (para no molestar al usuario)
        if (selectedArea) {
            rollsService.getBoard(selectedArea.code).then(data => {
                const sorted = sortPendingOrders(data.pendingOrders || []);
                setPendingOrders(sorted);
                const movable = (data.rolls || []).filter(r => MOVABLE_STATES.includes((r.status || '').toLowerCase()));
                const locked  = (data.rolls || []).filter(r => !MOVABLE_STATES.includes((r.status || '').toLowerCase()));
                setRolls([...movable, ...locked]);
            }).catch(e => console.error("Error en socket reload:", e));
        }
    });

    useEffect(() => {
        socket.on('server:order_updated', avisarRecarga);
        socket.on('server:new_order', avisarRecarga);

        return () => {
            socket.off('server:order_updated', avisarRecarga);
            socket.off('server:new_order', avisarRecarga);
        };
    }, [avisarRecarga]);

    // ── Order movement ─────────────────────────────────────────────────────

    const moveOrder = useCallback(async (order, direction) => {
        const group = getPrioGroup(order);
        const groupOrders = pendingOrders.filter(o => getPrioGroup(o) === group);
        const otherOrders = pendingOrders.filter(o => getPrioGroup(o) !== group);
        const idx = groupOrders.findIndex(o => o.id === order.id);
        if (idx === -1) return;

        const newGroup = [...groupOrders];
        if (direction === 'up' && idx > 0) {
            [newGroup[idx - 1], newGroup[idx]] = [newGroup[idx], newGroup[idx - 1]];
        } else if (direction === 'down' && idx < newGroup.length - 1) {
            [newGroup[idx + 1], newGroup[idx]] = [newGroup[idx], newGroup[idx + 1]];
        } else if (direction === 'top' && idx > 0) {
            newGroup.splice(idx, 1);
            newGroup.unshift(order);
        } else return;

        // Update sequence locally to match what backend will do: n - i
        const n = newGroup.length;
        newGroup.forEach((o, i) => {
            o.sequence = n - i;
        });

        // Rebuild full sorted list
        const newPending = sortPendingOrders([...otherOrders, ...newGroup]);
        setPendingOrders(newPending);

        // Persist — send only this group's IDs in new order
        setSaving(true);
        try {
            await rollsService.reorderPendingOrders(selectedArea.code, newGroup.map(o => o.id), order.id);
        } catch {
            toast.error('Error guardando orden');
            loadData(); // revert
        } finally {
            setSaving(false);
        }
    }, [pendingOrders, selectedArea, loadData]);

    // ── Roll movement ──────────────────────────────────────────────────────

    const moveRoll = useCallback(async (roll, direction) => {
        const movable = rolls.filter(r => MOVABLE_STATES.includes((r.status || '').toLowerCase()));
        const locked  = rolls.filter(r => !MOVABLE_STATES.includes((r.status || '').toLowerCase()));
        const idx = movable.findIndex(r => r.id === roll.id);
        if (idx === -1) return;

        const newMovable = [...movable];
        if (direction === 'up' && idx > 0) {
            [newMovable[idx - 1], newMovable[idx]] = [newMovable[idx], newMovable[idx - 1]];
        } else if (direction === 'down' && idx < newMovable.length - 1) {
            [newMovable[idx + 1], newMovable[idx]] = [newMovable[idx], newMovable[idx + 1]];
        } else if (direction === 'top' && idx > 0) {
            newMovable.splice(idx, 1);
            newMovable.unshift(roll);
        } else return;

        setRolls([...newMovable, ...locked]);

        setSaving(true);
        try {
            await rollsService.reorderRolls(selectedArea.code, newMovable.map(r => r.id), roll.id);
        } catch {
            toast.error('Error guardando orden de lotes');
            loadData();
        } finally {
            setSaving(false);
        }
    }, [rolls, selectedArea, loadData]);

    // ─── Filter pending orders ─────────────────────────────────────────────

    const filteredOrders = pendingOrders.filter(o => {
        const q = search.toLowerCase();
        const matchSearch = !q || [
            o.code, o.client, o.material, o.desc
        ].some(v => (v || '').toLowerCase().includes(q));
        const matchPrio = prioFilter === 'todas' || getPrioGroup(o) === prioFilter;
        return matchSearch && matchPrio;
    });

    // Helper: Gets the NON-FILTERED group (for accurate index calculation in buttons)
    const getFullGroup = (prio) => pendingOrders.filter(o => getPrioGroup(o) === prio);

    const fallas      = filteredOrders.filter(o => getPrioGroup(o) === 'falla');
    const urgentes    = filteredOrders.filter(o => getPrioGroup(o) === 'urgente');
    const reposiciones = filteredOrders.filter(o => getPrioGroup(o) === 'reposición');
    const normales    = filteredOrders.filter(o => getPrioGroup(o) === 'normal');

    const movableRolls = rolls.filter(r => MOVABLE_STATES.includes((r.status || '').toLowerCase()));
    const lockedRolls  = rolls.filter(r => !MOVABLE_STATES.includes((r.status || '').toLowerCase()));

    // ─── Render ────────────────────────────────────────────────────────────

    const prioFiltros = [
        { key: 'todas', label: 'Todas', n: pendingOrders.length },
        ...['urgente', 'normal', 'reposición', 'falla'].map(k => ({
            key: k, label: PRIO_ESTILO[k].label, punto: PRIO_ESTILO[k].punto,
            n: pendingOrders.filter(o => getPrioGroup(o) === k).length,
        })),
    ];

    return (
        <div className="pb-6">
            <div className="mb-5">
                <h1 className="text-2xl font-black text-slate-800">Coordinación de Producción</h1>
                <p className="text-sm text-slate-500 mt-1">Reordenar lotes y órdenes pendientes por área.</p>
            </div>

            {/* Áreas: pestañas como en Bandeja de Diseño y Solicitudes (en el celular, un desplegable).
                A la derecha, el aviso de guardado y recargar. */}
            <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 min-w-0">
                    <div className="sm:hidden">
                        <Selector value={selectedArea?.code || ''} aria-label="Área" anchoLista={260}
                            onChange={e => setSelectedArea(areas.find(a => a.code === e.target.value) || null)}>
                            {areas.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}
                        </Selector>
                    </div>
                    <div className="hidden sm:flex items-center overflow-x-auto no-scrollbar shadow-[inset_0_-1px_0_0_#e2e8f0]">
                        {areas.map(a => {
                            const on = selectedArea?.code === a.code;
                            return (
                                <button key={a.code} type="button" onClick={() => setSelectedArea(a)} aria-current={on ? 'page' : undefined}
                                    className={`shrink-0 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${on ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>
                                    {a.name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {saving && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-cyan shrink-0">
                        <Loader2 size={14} className="animate-spin" /> Guardando…
                    </span>
                )}
                <button type="button" onClick={loadData} disabled={loading} title="Recargar"
                    className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-brand-cyan hover:border-brand-cyan/40 disabled:opacity-50 transition-colors shrink-0">
                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center">
                    <Loader2 size={18} className="animate-spin" /> Cargando…
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">

                    {/* ── Cola de Lotes ── */}
                    <Panel icono={Layers} titulo="Cola de lotes" contador={`${movableRolls.length} activos`}>
                        {movableRolls.length === 0 && lockedRolls.length === 0 ? (
                            <Vacio icono={Layers} texto={`No hay lotes para ${selectedArea?.name}`} />
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {movableRolls.map((roll, idx) => (
                                    <RollCard
                                        key={roll.id}
                                        roll={roll}
                                        isFirst={idx === 0}
                                        isLast={idx === movableRolls.length - 1}
                                        onMove={moveRoll}
                                    />
                                ))}

                                {lockedRolls.length > 0 && (
                                    <>
                                        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50">
                                            <Lock size={12} className="text-slate-400" />
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">En máquina (bloqueados)</span>
                                        </div>
                                        {lockedRolls.map(roll => (
                                            <RollCard key={roll.id} roll={roll} isFirst={true} isLast={true} onMove={() => {}} />
                                        ))}
                                    </>
                                )}
                            </div>
                        )}
                    </Panel>

                    {/* ── Órdenes Pendientes ── */}
                    <Panel icono={ListOrdered} titulo="Órdenes pendientes" contador={`${filteredOrders.length} / ${pendingOrders.length}`}
                        extra={(
                            <div className="px-4 py-3 border-b border-slate-100 space-y-2.5">
                                <div className="relative">
                                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        placeholder="Buscar por orden, cliente, material..."
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                                    />
                                    {search && (
                                        <button type="button" onClick={() => setSearch('')} title="Borrar búsqueda"
                                            className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                                <div className="flex gap-1.5 flex-wrap">
                                    {prioFiltros.map(p => {
                                        const on = prioFilter === p.key;
                                        return (
                                            <button key={p.key} type="button" onClick={() => setPrioFilter(p.key)}
                                                className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-bold border transition-colors ${on ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/30' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                                                {p.punto && <span className={`w-1.5 h-1.5 rounded-full ${p.punto}`} />}
                                                {p.label}
                                                <span className={`text-[11px] font-black tabular-nums ${on ? 'text-brand-cyan' : p.n ? 'text-slate-600' : 'text-slate-300'}`}>{p.n}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}>
                        {filteredOrders.length === 0 ? (
                            <Vacio icono={ListOrdered} texto={pendingOrders.length === 0
                                ? `No hay órdenes pendientes para ${selectedArea?.name}`
                                : 'Ninguna orden coincide con los filtros'} />
                        ) : (
                            <div className="lg:max-h-[calc(100vh-20rem)] overflow-y-auto">
                                {fallas.length > 0 && (
                                    <GroupSection prio="falla" orders={fallas} allOrders={getFullGroup('falla')} onMove={moveOrder} />
                                )}
                                {urgentes.length > 0 && (
                                    <GroupSection prio="urgente" orders={urgentes} allOrders={getFullGroup('urgente')} onMove={moveOrder} />
                                )}
                                {reposiciones.length > 0 && (
                                    <GroupSection prio="reposición" orders={reposiciones} allOrders={getFullGroup('reposición')} onMove={moveOrder} />
                                )}
                                {normales.length > 0 && (
                                    <GroupSection prio="normal" orders={normales} allOrders={getFullGroup('normal')} onMove={moveOrder} />
                                )}
                            </div>
                        )}
                    </Panel>
                </div>
            )}
        </div>
    );
}


const INITIAL_SIZE = 10;
const LOAD_MORE    = 20;

function GroupSection({ prio, orders, allOrders, onMove }) {
    const [visible, setVisible] = useState(INITIAL_SIZE);

    // Reset when orders list changes (area change, filter change)
    useEffect(() => setVisible(INITIAL_SIZE), [orders.length]);

    const shown = orders.slice(0, visible);
    const hasMore = visible < orders.length;
    const est = PRIO_ESTILO[prio] || PRIO_ESTILO.normal;

    return (
        <div className="border-t border-slate-100 first:border-t-0">
            {/* Encabezado del grupo: queda fijo arriba mientras se recorre la lista */}
            <div className="sticky top-0 z-[1] flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100">
                <span className={`w-1.5 h-1.5 rounded-full ${est.punto}`} />
                <span className={`text-[10px] font-black uppercase tracking-wider ${est.texto}`}>{est.label}</span>
                <span className="text-[10px] font-black text-slate-400 tabular-nums">{orders.length}</span>
            </div>
            <div className="divide-y divide-slate-100">
                {shown.map(order => (
                    <OrderRow
                        key={order.id}
                        order={order}
                        groupOrders={orders}
                        fullGroupOrders={allOrders}
                        onMove={onMove}
                    />
                ))}
            </div>
            {hasMore && (
                <button type="button" onClick={() => setVisible(v => v + LOAD_MORE)}
                    className="w-full py-2.5 text-xs font-bold text-slate-500 hover:text-brand-cyan hover:bg-slate-50 border-t border-slate-100 transition-colors">
                    Ver {Math.min(LOAD_MORE, orders.length - visible)} más de {orders.length - visible} restantes
                </button>
            )}
        </div>
    );
}
