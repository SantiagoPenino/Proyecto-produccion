import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Printer, Wifi, WifiOff, Volume2, VolumeX, Bell, RotateCcw, Package, AlertTriangle, XCircle, FileText } from 'lucide-react';
import { socket } from '../../services/socketService';
import { Logo } from '../Logo';

// [WMS] Print Station de pedidos de venta WMS — mismo mecanismo que la estación de
// encomiendas: página abierta en la PC de la impresora, escucha el socket 'wms:pedido'
// (emitido al confirmar el pedido en wmsController.createOrder) y manda a imprimir sola
// la hoja A4 del pedido en formato remito (productos, cantidades y ubicación), cargando
// en un iframe oculto la vista del backend /api/wms/pedido/:id/remito-print.
const WmsRemitoPrintStation = () => {
    const [connected, setConnected] = useState(socket.connected);
    const [logs, setLogs] = useState(() => {
        try { const s = localStorage.getItem('wps_logs'); return s ? JSON.parse(s) : []; } catch { return []; }
    });
    const [printCount, setPrintCount] = useState(() => {
        try { return parseInt(localStorage.getItem('wps_printCount')) || 0; } catch { return 0; }
    });
    const [soundEnabled, setSoundEnabled] = useState(() => {
        try { const s = localStorage.getItem('wps_soundEnabled'); return s !== null ? s === 'true' : true; } catch { return true; }
    });
    const [copies, setCopies] = useState(() => {
        try { return parseInt(localStorage.getItem('wps_copies')) || 1; } catch { return 1; }
    });
    const iframeRef = useRef(null);
    const audioRef = useRef(null);
    const printedIdsRef = useRef(() => {
        try { const s = localStorage.getItem('wps_printedIds'); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
    });
    if (typeof printedIdsRef.current === 'function') printedIdsRef.current = printedIdsRef.current();

    // Persist state
    useEffect(() => { try { localStorage.setItem('wps_logs', JSON.stringify(logs)); } catch {} }, [logs]);
    useEffect(() => { try { localStorage.setItem('wps_printCount', String(printCount)); } catch {} }, [printCount]);
    useEffect(() => { try { localStorage.setItem('wps_soundEnabled', String(soundEnabled)); } catch {} }, [soundEnabled]);
    useEffect(() => { try { localStorage.setItem('wps_copies', String(copies)); } catch {} }, [copies]);

    // Sound
    useEffect(() => {
        audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1pq6y0r6KYj5+xtbisl4eEkKW0u7OljYWMnK+4t6yYjI2ZqrW1rZqOjpersbOsnpOPlqexsa6glo+VpbCxr6KYkZWjr7GvoZiSlKOusa+impOUoq+xr6KZk5Sjr7CvopmTlKOvsK+imZOUo6+wr6KZk5Sjr7CvopmTlKOvsK+hmJKToa6vr6GYkpOhr6+voZiSk6GvAA==');
    }, []);

    const addLog = useCallback((message, type = 'info', job = null, icon = null) => {
        const time = new Date().toLocaleTimeString('es-UY', { hour12: false });
        setLogs(prev => [{ time, message, type, job, icon }, ...prev].slice(0, 50));
    }, []);

    // Socket connection
    useEffect(() => {
        const onConnect = () => { setConnected(true); addLog('Conectado al servidor', 'success'); };
        const onDisconnect = () => { setConnected(false); addLog('Desconectado del servidor', 'error'); };
        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        if (socket.connected) addLog('ESPERANDO PEDIDOS WMS...', 'success');
        return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); };
    }, [addLog]);

    // Imprimir: carga la hoja A4 del backend en el iframe y dispara print.
    // El delay post-load le da tiempo al script del QR (CDN) a renderizar.
    const printRemito = useCallback((job) => {
        if (!iframeRef.current || !job?.pedidoId) return Promise.resolve();
        const url = `/api/wms/pedido/${job.pedidoId}/remito-print`;

        return new Promise((resolve) => {
            const iframe = iframeRef.current;
            let done = false;
            const fire = async () => {
                if (done) return; // evita doble disparo (onload + fallback)
                done = true;
                for (let i = 1; i <= copies; i++) {
                    try {
                        iframe.contentWindow.focus();
                        iframe.contentWindow.print();
                        addLog(`Copia ${i} impresa: ${job.codigoVenta}`, 'success');
                    } catch (err) {
                        addLog(`Error imprimiendo copia ${i}: ${err.message}`, 'error');
                    }
                    if (i < copies) await new Promise(r => setTimeout(r, 1000));
                }
                setPrintCount(prev => prev + 1);
                resolve();
            };
            iframe.onload = () => setTimeout(fire, 1200);
            iframe.src = url;
            setTimeout(fire, 5000); // fallback por si onload no llega
        });
    }, [copies, addLog]);

    // Cola: serializa las impresiones para que dos trabajos no pisen el mismo iframe
    const printQueueRef = useRef(Promise.resolve());
    const queuePrint = useCallback((job) => {
        const run = () => printRemito(job);
        printQueueRef.current = printQueueRef.current.then(run, run);
        return printQueueRef.current;
    }, [printRemito]);

    // Escuchar nuevos pedidos WMS (con deduplicación por código de venta)
    useEffect(() => {
        const handleWmsPedido = async (data) => {
            if (data?.type !== 'nuevo_pedido' || !data.pedidoId) return;

            const jobId = data.codigoVenta || String(data.pedidoId);
            if (printedIdsRef.current.has(jobId)) {
                addLog(`Remito ${jobId} ya fue impreso — omitido`, 'info', null, 'package');
                return;
            }
            printedIdsRef.current.add(jobId);

            addLog(`Nuevo pedido WMS detectado: ${jobId}`, 'info', null, 'package');
            if (soundEnabled && audioRef.current) {
                audioRef.current.play().catch(() => {});
            }

            addLog(`Imprimiendo remito ${jobId} (${copies} copias)...`, 'info', data, 'printer');
            await queuePrint(data);

            // Mantener solo los últimos 200 IDs
            if (printedIdsRef.current.size > 200) {
                const arr = [...printedIdsRef.current];
                printedIdsRef.current = new Set(arr.slice(arr.length - 200));
            }
            try { localStorage.setItem('wps_printedIds', JSON.stringify([...printedIdsRef.current])); } catch {}
        };

        socket.on('wms:pedido', handleWmsPedido);
        return () => socket.off('wms:pedido', handleWmsPedido);
    }, [soundEnabled, copies, queuePrint, addLog]);

    return (
        <div style={{
            minHeight: '100vh',
            background: '#0a0a0a',
            color: '#e0e0e0',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 24px',
                background: '#141414',
                borderRadius: '16px',
                border: '1px solid #222'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <FileText size={28} color="#ffd700" />
                    <div>
                        <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#fff', margin: 0, textTransform: 'uppercase', letterSpacing: '2px' }}>Print Station — Remitos WMS</h1>
                        <p style={{ fontSize: '12px', color: '#888', margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>Impresión automática A4 de pedidos de venta</p>
                    </div>
                </div>

                <Logo className="h-16 text-white" style={{ marginBottom: '-12px', marginTop: '4px' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {/* Copies */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase' }}>Copias:</span>
                        <select
                            value={copies}
                            onChange={e => setCopies(Number(e.target.value))}
                            style={{
                                background: '#1a1a1a',
                                border: '1px solid #333',
                                color: '#fff',
                                borderRadius: '8px',
                                padding: '4px 8px',
                                fontSize: '13px'
                            }}
                        >
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                            <option value={3}>3</option>
                        </select>
                    </div>

                    {/* Sound */}
                    <button
                        onClick={() => setSoundEnabled(prev => !prev)}
                        aria-label="Activar o desactivar sonido"
                        style={{
                            background: 'none',
                            border: '1px solid #333',
                            borderRadius: '8px',
                            padding: '6px 10px',
                            cursor: 'pointer',
                            color: soundEnabled ? '#00d4ff' : '#555',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '12px'
                        }}
                    >
                        {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                        {soundEnabled ? 'ON' : 'OFF'}
                    </button>

                    {/* Connection status */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        background: connected ? 'rgba(0, 212, 100, 0.1)' : 'rgba(255, 60, 60, 0.1)',
                        border: `1px solid ${connected ? 'rgba(0, 212, 100, 0.3)' : 'rgba(255, 60, 60, 0.3)'}`,
                    }}>
                        {connected ? <Wifi size={16} color="#00d464" /> : <WifiOff size={16} color="#ff3c3c" />}
                        <span style={{ fontSize: '12px', fontWeight: 600, color: connected ? '#00d464' : '#ff3c3c' }}>
                            {connected ? 'CONECTADO' : 'DESCONECTADO'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ flex: 1, padding: '10px 16px', background: '#141414', borderRadius: '16px', border: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#00d4ff' }}>{printCount}</div>
                    <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Remitos impresos</div>
                </div>
                <div style={{ flex: 1, padding: '10px 16px', background: '#141414', borderRadius: '16px', border: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: connected ? '#00d464' : '#ff3c3c', animation: connected ? 'pulse 2s ease-in-out infinite' : 'none', flexShrink: 0 }}></div>
                    <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
                    <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>
                        {connected ? 'Escuchando' : 'Sin conexión'}
                    </div>
                </div>
                <div style={{ flex: 1, padding: '10px 16px', background: '#141414', borderRadius: '16px', border: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#ffd700' }}>{copies}</div>
                    <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>{copies > 1 ? 'Copias' : 'Copia'} por remito</div>
                </div>
            </div>

            {/* Log */}
            <div style={{
                flex: 1,
                padding: '16px 20px',
                background: '#141414',
                borderRadius: '16px',
                border: '1px solid #222',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <Bell size={16} color="#eb008b" />
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '1px' }}>Actividad</span>
                </div>
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    maxHeight: 'calc(100vh - 350px)'
                }}>
                    {logs.length === 0 ? (
                        <div style={{ color: '#555', fontSize: '13px', padding: '20px', textAlign: 'center' }}>
                            Sin actividad. Los remitos se imprimirán automáticamente cuando entren pedidos de venta WMS.
                        </div>
                    ) : logs.map((log, i) => (
                        <div key={i} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            background: log.type === 'error' ? 'rgba(255,60,60,0.08)' : log.type === 'success' ? 'rgba(0,212,255,0.08)' : 'transparent',
                            fontSize: '13px'
                        }}>
                            <span style={{ color: '#555', fontSize: '11px', fontFamily: 'monospace', flexShrink: 0 }}>{log.time}</span>
                            {log.icon === 'package' && <Package size={14} color="#00d4ff" style={{ flexShrink: 0 }} />}
                            {log.icon === 'printer' && <Printer size={14} color="#aaa" style={{ flexShrink: 0 }} />}
                            {log.icon === 'warning' && <AlertTriangle size={14} color="#ffd700" style={{ flexShrink: 0 }} />}
                            {log.icon === 'error' && <XCircle size={14} color="#ff6b6b" style={{ flexShrink: 0 }} />}
                            <span style={{
                                color: log.type === 'error' ? '#ff6b6b' : log.type === 'success' ? '#00d4ff' : '#fff',
                                flex: 1,
                                textTransform: 'uppercase'
                            }}>{log.message}</span>
                            {log.job && (
                                <button
                                    onClick={() => { addLog(`Reimprimiendo ${log.job.codigoVenta || log.job.pedidoId}...`, 'info', log.job, 'printer'); queuePrint(log.job); }}
                                    style={{
                                        background: 'rgba(255,215,0,0.1)',
                                        border: '1px solid rgba(255,215,0,0.3)',
                                        borderRadius: '6px',
                                        padding: '3px 8px',
                                        cursor: 'pointer',
                                        color: '#ffd700',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        fontSize: '11px',
                                        flexShrink: 0
                                    }}
                                >
                                    <RotateCcw size={12} /> REIMPRIMIR
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Hidden print iframe */}
            <iframe
                ref={iframeRef}
                style={{ display: 'none' }}
                title="wms-remito-print-frame"
            />
        </div>
    );
};

export default WmsRemitoPrintStation;
