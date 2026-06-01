import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import Lottie from 'lottie-react';
import loadingAnim from '../../assets/animations/Loading-CMYK.json';
import { ArrowUp, ArrowDown, ChevronsUp, Lock, Layers, ListOrdered, RefreshCw, ChevronDown } from 'lucide-react';
import { rollsService } from '../../services/modules/rollsService';
import { areasService } from '../../services/modules/areasService';

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

// ─── OrderRow ────────────────────────────────────────────────────────────────

function OrderRow({ order, onMove, groupOrders, fullGroupOrders }) {
    const isFalla = getPrioGroup(order) === 'falla';
    // Position within FULL (unfiltered) group — so buttons aren't wrongly disabled when searching
    const posGroup = fullGroupOrders || groupOrders;
    const idx = posGroup.findIndex(o => o.id === order.id);
    const isFirst = idx === 0;
    const isLast = idx === posGroup.length - 1;

    const prioColors = {
        falla: 'bg-red-50 border-red-200 text-red-700',
        urgente: 'bg-pink-50 border-pink-200 text-[#BD0C7E]',
        'reposición': 'bg-yellow-50 border-yellow-200 text-yellow-700',
        normal: 'bg-zinc-50 border-zinc-200 text-zinc-600',
    };

    const group = getPrioGroup(order);

    return (
        <div className={`flex items-center gap-3 px-4 py-2.5 border rounded-lg mb-1.5 transition-all ${prioColors[group] || prioColors.normal}`}>
            {/* Priority badge */}
            <span className="text-[10px] font-black uppercase tracking-wider w-16 shrink-0 opacity-70">
                {order.priority || 'Normal'}
            </span>

            {/* Order info */}
            <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{order.code}</div>
                <div className="text-xs opacity-60 truncate">{order.client} · {order.material}</div>
            </div>

            <div className="text-xs font-mono opacity-50 shrink-0">
                {order.magnitude?.toFixed(2)}m
            </div>

            {/* Seq badge */}
            {order.sequence != null && (
                <span className="text-[10px] font-mono bg-white/60 border border-current/20 rounded px-1.5 py-0.5 shrink-0">
                    #{order.sequence}
                </span>
            )}

            {/* Move buttons */}
            {isFalla ? (
                <div className="flex items-center gap-1 opacity-30 shrink-0">
                    <Lock size={14} />
                </div>
            ) : (
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        disabled={isFirst}
                        onClick={() => onMove(order, 'top')}
                        className="p-1 rounded hover:bg-white/60 disabled:opacity-20 transition-all"
                        title="Mover al tope"
                    >
                        <ChevronsUp size={14} />
                    </button>
                    <button
                        disabled={isFirst}
                        onClick={() => onMove(order, 'up')}
                        className="p-1 rounded hover:bg-white/60 disabled:opacity-20 transition-all"
                        title="Subir"
                    >
                        <ArrowUp size={14} />
                    </button>
                    <button
                        disabled={isLast}
                        onClick={() => onMove(order, 'down')}
                        className="p-1 rounded hover:bg-white/60 disabled:opacity-20 transition-all"
                        title="Bajar"
                    >
                        <ArrowDown size={14} />
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── RollCard ─────────────────────────────────────────────────────────────────

const MOVABLE_STATES = ['abierto', 'en cola'];

function RollCard({ roll, onMove, isFirst, isLast }) {
    const isLocked = !MOVABLE_STATES.includes((roll.status || '').toLowerCase());
    const [expanded, setExpanded] = useState(false);

    return (
        <div className={`border rounded-xl mb-2 overflow-hidden transition-all ${isLocked ? 'border-zinc-200 bg-zinc-50 opacity-70' : 'border-brand-cyan/30 bg-white shadow-sm'}`}>
            <div className="flex items-center gap-3 px-4 py-3">
                {/* Lock icon or move buttons */}
                {isLocked ? (
                    <Lock size={16} className="text-zinc-400 shrink-0" />
                ) : (
                    <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <button
                            disabled={isFirst}
                            onClick={() => onMove(roll, 'top')}
                            className="p-0.5 rounded hover:bg-brand-cyan/10 disabled:opacity-20 text-brand-cyan transition-all"
                            title="Mover al tope"
                        >
                            <ChevronsUp size={13} />
                        </button>
                        <button
                            disabled={isFirst}
                            onClick={() => onMove(roll, 'up')}
                            className="p-0.5 rounded hover:bg-brand-cyan/10 disabled:opacity-20 text-brand-cyan transition-all"
                            title="Subir"
                        >
                            <ArrowUp size={13} />
                        </button>
                        <button
                            disabled={isLast}
                            onClick={() => onMove(roll, 'down')}
                            className="p-0.5 rounded hover:bg-brand-cyan/10 disabled:opacity-20 text-brand-cyan transition-all"
                            title="Bajar"
                        >
                            <ArrowDown size={13} />
                        </button>
                    </div>
                )}

                {/* Roll info */}
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-zinc-800 text-sm truncate">{roll.name}</div>
                    <div className="text-xs text-zinc-400 mt-0.5">
                        {roll.orders?.length || 0} órdenes · {(roll.currentUsage || 0).toFixed(2)}m
                    </div>
                </div>

                {/* Status badge */}
                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${isLocked ? 'bg-zinc-200 text-zinc-500' : 'bg-brand-cyan/10 text-brand-cyan'}`}>
                    {roll.status}
                </span>

                {/* Expand toggle */}
                <button
                    onClick={() => setExpanded(e => !e)}
                    className="p-1 rounded hover:bg-zinc-100 text-zinc-400 transition-all shrink-0"
                >
                    <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
            </div>

            {/* Orders list (collapsed by default) */}
            {expanded && (
                <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-2 space-y-1">
                    {(roll.orders || []).length === 0 ? (
                        <p className="text-xs text-zinc-400 italic py-1">Sin órdenes asignadas</p>
                    ) : (roll.orders || []).map(o => (
                        <div key={o.id} className="flex items-center gap-2 text-xs py-1 border-b border-zinc-100 last:border-0">
                            <span className="font-bold text-zinc-700">{o.code}</span>
                            <span className="text-zinc-400 truncate flex-1">{o.client}</span>
                            <span className="text-zinc-400">{o.magnitude?.toFixed(2)}m</span>
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

        // Only update the sequence badge for the order that was actually moved
        const maxSeq = Math.max(0, ...pendingOrders.map(o => o.sequence ?? 0));
        const movedObj = newGroup.find(o => o.id === order.id);
        if (movedObj) movedObj.sequence = maxSeq + 1;

        // Rebuild full sorted list
        const newPending = sortPendingOrders([...otherOrders, ...newGroup]);
        setPendingOrders(newPending);

        // Persist — send only this group's IDs in new order
        setSaving(true);
        try {
            await rollsService.reorderPendingOrders(selectedArea.code, newGroup.map(o => o.id));
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
            await rollsService.reorderRolls(selectedArea.code, newMovable.map(r => r.id));
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

    return (
        <div className="min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-black text-zinc-800 flex items-center gap-2">
                        <ListOrdered size={22} className="text-brand-cyan" />
                        Coordinación de Producción
                    </h1>
                    <p className="text-sm text-zinc-400 mt-0.5">
                        Reordenar lotes y órdenes pendientes por área
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {/* Area selector */}
                    <div className="flex flex-wrap gap-2">
                        {areas.map(a => (
                            <button
                                key={a.code}
                                onClick={() => setSelectedArea(a)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all border ${
                                    selectedArea?.code === a.code
                                        ? 'bg-brand-cyan text-white border-brand-cyan shadow-md shadow-brand-cyan/20'
                                        : 'bg-white text-zinc-600 border-zinc-200 hover:border-brand-cyan/50'
                                }`}
                            >
                                {a.name}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="p-2 rounded-lg bg-white border border-zinc-200 hover:border-brand-cyan/50 text-zinc-400 hover:text-brand-cyan transition-all"
                        title="Recargar"
                    >
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {saving && (
                <div className="fixed top-4 right-4 z-50 bg-brand-cyan text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg animate-pulse">
                    Guardando...
                </div>
            )}

            <div className="pb-6">
            {loading ? (
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="w-80 h-80">
                        <Lottie animationData={loadingAnim} loop={true} />
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

                    {/* ── Cola de Lotes ── */}
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Layers size={16} className="text-brand-cyan" />
                            <h2 className="font-black text-zinc-700 text-sm uppercase tracking-wider">
                                Cola de Lotes
                            </h2>
                            <span className="ml-auto text-xs text-zinc-400">{movableRolls.length} activos</span>
                        </div>

                        {movableRolls.length === 0 && lockedRolls.length === 0 ? (
                            <div className="text-center py-12 text-zinc-400 bg-white border border-zinc-200 rounded-xl">
                                <Layers size={32} className="mx-auto mb-2 opacity-30" />
                                <p className="text-sm">No hay lotes para {selectedArea?.name}</p>
                            </div>
                        ) : (
                            <>
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
                                        <div className="flex items-center gap-2 my-3">
                                            <Lock size={12} className="text-zinc-400" />
                                            <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">En máquina (bloqueados)</span>
                                        </div>
                                        {lockedRolls.map((roll, idx) => (
                                            <RollCard
                                                key={roll.id}
                                                roll={roll}
                                                isFirst={true}
                                                isLast={true}
                                                onMove={() => {}}
                                            />
                                        ))}
                                    </>
                                )}
                            </>
                        )}
                    </div>

                    {/* ── Órdenes Pendientes ── */}
                    <div className="h-full flex flex-col overflow-hidden">
                        {/* Header row */}
                        <div className="flex items-center gap-2 mb-3">
                            <ListOrdered size={16} className="text-brand-cyan" />
                            <h2 className="font-black text-zinc-700 text-sm uppercase tracking-wider">
                                Órdenes Pendientes
                            </h2>
                            <span className="ml-auto text-xs text-zinc-400">
                                {filteredOrders.length} / {pendingOrders.length}
                            </span>
                        </div>

                        {/* Search + priority filters */}
                        <div className="mb-3 space-y-2 px-2">
                            <div className="relative">
                                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                                <input
                                    type="text"
                                    placeholder="Buscar por orden, cliente, material..."
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    className="w-full pl-8 pr-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:border-brand-cyan transition-colors"
                                />
                                {search && (
                                    <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                                        ✕
                                    </button>
                                )}
                            </div>
                            <div className="flex gap-1.5 flex-wrap items-center">
                                <button
                                    onClick={() => setPrioFilter('todas')}
                                    className={`inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-bold border transition-all ring-2 ring-offset-1 ${
                                        prioFilter === 'todas'
                                            ? 'bg-zinc-100 text-zinc-600 border-zinc-200 ring-brand-cyan/40 shadow-sm'
                                            : 'bg-white text-zinc-400 border-zinc-200 ring-transparent hover:border-zinc-300'
                                    }`}
                                >
                                    Todas
                                </button>

                                {[
                                    { key: 'urgente',    label: 'Urgente',    color: 'bg-pink-50 text-[#BD0C7E] border-pink-200' },
                                    { key: 'normal',     label: 'Normal',     color: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
                                    { key: 'reposición', label: 'Reposición', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
                                    { key: 'falla',      label: 'Falla',      color: 'bg-red-50 text-red-600 border-red-200' },
                                ].map(p => (
                                    <button
                                        key={p.key}
                                        onClick={() => setPrioFilter(p.key)}
                                        className={`inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-bold border transition-all ring-2 ring-offset-1 ${
                                            prioFilter === p.key
                                                ? p.color + ' ring-brand-cyan/40 shadow-sm'
                                                : 'bg-white text-zinc-400 border-zinc-200 ring-transparent hover:border-zinc-300'
                                        }`}
                                    >
                                        {p.label}
                                        <span className="ml-1 opacity-60">
                                            ({pendingOrders.filter(o => getPrioGroup(o) === p.key).length})
                                        </span>
                                    </button>
                                ))}
                            </div>

                        </div>

                        {filteredOrders.length === 0 ? (
                            <div className="text-center py-12 text-zinc-400 bg-white border border-zinc-200 rounded-xl">
                                <ListOrdered size={32} className="mx-auto mb-2 opacity-30" />
                                <p className="text-sm">
                                    {pendingOrders.length === 0
                                        ? `No hay órdenes pendientes para ${selectedArea?.name}`
                                        : 'Ninguna orden coincide con los filtros'}
                                </p>
                            </div>
                        ) : (
                            <div className="bg-white border border-zinc-200 rounded-xl p-3 max-h-screen overflow-y-auto">
                                {fallas.length > 0 && (
                                    <GroupSection label="Fallas" color="text-red-500" orders={fallas} allOrders={getFullGroup('falla')} onMove={moveOrder} />
                                )}
                                {urgentes.length > 0 && (
                                    <GroupSection label="Urgente" color="text-[#BD0C7E]" orders={urgentes} allOrders={getFullGroup('urgente')} onMove={moveOrder} />
                                )}
                                {reposiciones.length > 0 && (
                                    <GroupSection label="Reposición" color="text-yellow-600" orders={reposiciones} allOrders={getFullGroup('reposición')} onMove={moveOrder} />
                                )}
                                {normales.length > 0 && (
                                    <GroupSection label="Normal" color="text-zinc-500" orders={normales} allOrders={getFullGroup('normal')} onMove={moveOrder} />
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
            </div>
        </div>
    );
}


const INITIAL_SIZE = 10;
const LOAD_MORE    = 20;

function GroupSection({ label, color, orders, allOrders, onMove }) {
    const [visible, setVisible] = useState(INITIAL_SIZE);

    // Reset when orders list changes (area change, filter change)
    useEffect(() => setVisible(INITIAL_SIZE), [orders.length]);

    const shown = orders.slice(0, visible);
    const hasMore = visible < orders.length;

    return (
        <div className="mb-4 last:mb-0">
            <div className={`text-[10px] font-black uppercase tracking-widest mb-2 ${color} flex items-center gap-1`}>
                <span className="flex-1 border-t border-current opacity-20 ml-1" />
                {label} ({orders.length})
                <span className="flex-1 border-t border-current opacity-20 mr-1" />
            </div>
            {shown.map(order => (
                <OrderRow
                    key={order.id}
                    order={order}
                    groupOrders={orders}
                    fullGroupOrders={allOrders}
                    onMove={onMove}
                />
            ))}
            {hasMore && (
                <button
                    onClick={() => setVisible(v => v + LOAD_MORE)}
                    className={`w-full mt-1 py-1.5 text-[11px] font-bold rounded-lg border border-dashed transition-all opacity-60 hover:opacity-100 ${color} border-current`}
                >
                    Ver {Math.min(LOAD_MORE, orders.length - visible)} más de {orders.length - visible} restantes
                </button>
            )}
        </div>
    );
}

