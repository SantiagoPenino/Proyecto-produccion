import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Printer, Wifi, WifiOff, Volume2, VolumeX, Bell, RotateCcw, Package, AlertTriangle, XCircle, History, ChevronUp, ChevronDown, RefreshCcw, CheckSquare } from 'lucide-react';
import { socket } from '../../services/socketService';
import api from '../../services/api';
import { Logo } from '../Logo';
import { generateTicketHTML } from './webPrintHelper';

const PrintStationPage = () => {
    const [connected, setConnected] = useState(socket.connected);
    const [logs, setLogs] = useState(() => {
        try { const s = localStorage.getItem('ps_logs'); return s ? JSON.parse(s) : []; } catch { return []; }
    });
    const [printCount, setPrintCount] = useState(() => {
        try { return parseInt(localStorage.getItem('ps_printCount')) || 0; } catch { return 0; }
    });
    const [soundEnabled, setSoundEnabled] = useState(() => {
        try { const s = localStorage.getItem('ps_soundEnabled'); return s !== null ? s === 'true' : true; } catch { return true; }
    });
    const [copies, setCopies] = useState(() => {
        try { return parseInt(localStorage.getItem('ps_copies')) || 1; } catch { return 1; }
    });

    // Historial
    const [historialHoy, setHistorialHoy] = useState([]);
    const [loadingHistorial, setLoadingHistorial] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);
    const [selectedHistorial, setSelectedHistorial] = useState(new Set());
    const iframeRef = useRef(null);
    const printedIdsRef = useRef(() => {
        try { const s = localStorage.getItem('ps_printedIds'); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
    });
    // Lazy-init the Set (ref initializer returns a function, evaluate it once)
    if (typeof printedIdsRef.current === 'function') printedIdsRef.current = printedIdsRef.current();

    // Persist state to localStorage
    useEffect(() => { try { localStorage.setItem('ps_logs', JSON.stringify(logs)); } catch { } }, [logs]);
    useEffect(() => { try { localStorage.setItem('ps_printCount', String(printCount)); } catch { } }, [printCount]);
    useEffect(() => { try { localStorage.setItem('ps_soundEnabled', String(soundEnabled)); } catch { } }, [soundEnabled]);
    useEffect(() => { try { localStorage.setItem('ps_copies', String(copies)); } catch { } }, [copies]);

    // Cargar historial al montar — filtra por fechaAlta (creación) client-side para que nada desaparezca al cambiar estado
    useEffect(() => {
        const hoy = new Date().toISOString().split('T')[0];
        setLoadingHistorial(true);
        api.get('/apiordenesRetiro/estados?estados=1,2,3,4,5,9')
            .then(res => {
                const data = (res.data || [])
                    .filter(r => r.fechaAlta && new Date(r.fechaAlta).toISOString().split('T')[0] === hoy)
                    .sort((a, b) => new Date(b.fechaAlta) - new Date(a.fechaAlta));
                setHistorialHoy(data);
            })
            .catch(() => { })
            .finally(() => setLoadingHistorial(false));
    }, []);

    // Síntesis de voz
    const speak = useCallback((retiro) => {
        if (!soundEnabled) return;
        const isEncomienda = (retiro.lugarRetiro || '').toLowerCase().includes('encomienda');
        const numStr = (retiro.ordenDeRetiro || '').replace(/^[A-Za-z]+-?/, '');
        const texto = isEncomienda ? `Encomienda ${numStr}` : `Retiro ${numStr}`;
        window.speechSynthesis.cancel(); // cancelar cualquier voz anterior
        const utt = new SpeechSynthesisUtterance(texto);
        utt.lang = 'es-UY';
        utt.rate = 0.9;
        utt.pitch = 1;
        utt.volume = 1;
        window.speechSynthesis.speak(utt);
    }, [soundEnabled]);

    const addLog = useCallback((message, type = 'info', retiro = null, icon = null) => {
        const time = new Date().toLocaleTimeString('es-UY', { hour12: false });
        setLogs(prev => [{ time, message, type, retiro, icon }, ...prev].slice(0, 50));
    }, []);

    // Socket.io connection status
    useEffect(() => {
        const onConnect = () => { setConnected(true); addLog('Conectado al servidor', 'success'); };
        const onDisconnect = () => { setConnected(false); addLog('Desconectado del servidor', 'error'); };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);

        if (socket.connected) addLog('ESPERANDO RETIROS...', 'success');

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
        };
    }, [addLog]);

    // Generar HTML importado desde webPrintHelper

    // Imprimir ticket — resuelve la Promise recién cuando terminó de imprimir todas las copias
    const printTicket = useCallback((retiro) => {
        if (!iframeRef.current) return Promise.resolve();
        const html = generateTicketHTML(retiro);

        const printOnce = (copyNum) => {
            return new Promise((resolve) => {
                const iframe = iframeRef.current;
                let done = false;
                const fire = () => {
                    if (done) return; // evita doble disparo (onload + fallback)
                    done = true;
                    try {
                        iframe.contentWindow.focus();
                        iframe.contentWindow.print();
                        addLog(`Copia ${copyNum} impresa: ${retiro.ordenDeRetiro}`, 'success');
                    } catch (err) {
                        addLog(`Error imprimiendo copia ${copyNum}: ${err.message}`, 'error');
                    }
                    resolve();
                };
                // Disparar al terminar de renderizar el iframe; fallback por si onload no llega
                iframe.onload = () => setTimeout(fire, 50);
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                doc.open();
                doc.write(html);
                doc.close();
                setTimeout(fire, 1500); // fallback: algunos navegadores no emiten load tras document.write
            });
        };

        // Imprimir copias secuencialmente; devolver la Promise para que el caller pueda await
        return (async () => {
            for (let i = 1; i <= copies; i++) {
                await printOnce(i);
                if (i < copies) await new Promise(r => setTimeout(r, 1000)); // delay entre copias
            }
            setPrintCount(prev => prev + 1);
        })();
    }, [copies, generateTicketHTML, addLog]);

    // Cola global: serializa TODAS las impresiones (automáticas y manuales) para que
    // nunca dos trabajos escriban en el mismo iframe a la vez.
    const printQueueRef = useRef(Promise.resolve());
    const queuePrint = useCallback((retiro) => {
        const run = () => printTicket(retiro);
        printQueueRef.current = printQueueRef.current.then(run, run); // sigue aunque uno falle
        return printQueueRef.current;
    }, [printTicket]);

    // [WMS] Remitos A4 de pedidos de venta WMS — esta MISMA estación (la PC de retiros)
    // también los imprime: escucha 'wms:pedido' (emitido al confirmar la venta en
    // wmsController.createOrder) y carga la hoja A4 del backend en un iframe propio,
    // encolada en la misma cola para no pisarse con los tickets de retiro. Aditivo:
    // no toca en nada el flujo de retiros de arriba. También existe /wms-remito-station
    // como estación dedicada, por si algún día el A4 sale por otra impresora.
    const wmsIframeRef = useRef(null);
    const printRemitoWms = useCallback((job) => {
        if (!wmsIframeRef.current || !job?.pedidoId) return Promise.resolve();
        return new Promise((resolve) => {
            const iframe = wmsIframeRef.current;
            let done = false;
            const fire = () => {
                if (done) return; // evita doble disparo (onload + fallback)
                done = true;
                try {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                    addLog(`Remito WMS impreso: ${job.codigoVenta || job.pedidoId}`, 'success');
                    setPrintCount(prev => prev + 1);
                } catch (err) {
                    addLog(`Error imprimiendo remito WMS: ${err.message}`, 'error');
                }
                resolve();
            };
            iframe.onload = () => setTimeout(fire, 1200); // deja renderizar el QR (CDN)
            iframe.src = `/api/wms/pedido/${job.pedidoId}/remito-print`;
            setTimeout(fire, 5000); // fallback por si onload no llega
        });
    }, [addLog]);

    useEffect(() => {
        const handleWmsPedido = (data) => {
            if (data?.type !== 'nuevo_pedido' || !data.pedidoId) return;
            const jobId = data.codigoVenta || String(data.pedidoId);
            if (printedIdsRef.current.has(jobId)) {
                addLog(`Remito WMS ${jobId} ya fue impreso — omitido`, 'info', null, 'package');
                return;
            }
            printedIdsRef.current.add(jobId);
            try { localStorage.setItem('ps_printedIds', JSON.stringify([...printedIdsRef.current])); } catch { }

            addLog(`Nuevo pedido WMS: ${jobId} — imprimiendo remito A4...`, 'info', null, 'printer');
            if (soundEnabled) {
                window.speechSynthesis.cancel();
                const utt = new SpeechSynthesisUtterance(`Pedido ${jobId.replace(/^[A-Za-z]+-?/, '')}`);
                utt.lang = 'es-UY';
                utt.rate = 0.9;
                window.speechSynthesis.speak(utt);
            }
            const run = () => printRemitoWms(data);
            printQueueRef.current = printQueueRef.current.then(run, run);
        };
        socket.on('wms:pedido', handleWmsPedido);
        return () => socket.off('wms:pedido', handleWmsPedido);
    }, [soundEnabled, printRemitoWms, addLog]);
    // Escuchar eventos de nuevo retiro (con deduplicación)
    useEffect(() => {
        const handleRetiroUpdate = async (data) => {
            if (data?.type !== 'nuevo_retiro') return;

            addLog('Nuevo retiro detectado — cargando datos...', 'info', null, 'package');


            try {
                const res = await api.get('/apiordenesRetiro/estados?estados=1,2,3,4,9');
                const retiros = res.data;
                if (retiros && retiros.length > 0) {
                    const sorted = retiros.sort((a, b) => new Date(b.fechaAlta) - new Date(a.fechaAlta));

                    let nuevos;
                    if (data.ordenId && data.formaRetiro) {
                        // El backend nos dice exactamente qué retiro imprimir
                        const targetId = `${data.formaRetiro}-${data.ordenId}`;
                        const target = sorted.find(r => r.ordenDeRetiro === targetId);
                        if (target) {
                            // Encontrado: imprimir solo si no se imprimió antes
                            if (printedIdsRef.current.has(targetId)) {
                                addLog(`Retiro ${targetId} ya fue impreso — omitido`, 'info', null, 'package');
                                return;
                            }
                            nuevos = [target];
                        } else {
                            // No encontrado (FormaRetiro legado o demora de la BD): fallback al más nuevo no impreso
                            addLog(`Retiro ${targetId} no está en la lista — usando fallback`, 'info', null, 'warning');
                            nuevos = sorted.filter(r => !printedIdsRef.current.has(r.ordenDeRetiro));
                        }
                    } else {
                        // Sin datos específicos: imprimir el más nuevo no registrado
                        nuevos = sorted.filter(r => !printedIdsRef.current.has(r.ordenDeRetiro));
                    }

                    if (nuevos.length === 0) {
                        addLog('Todos los retiros recientes ya fueron impresos — omitidos', 'info', null, 'package');
                        return;
                    }

                    // Anunciar por voz el primer retiro nuevo
                    speak(nuevos[0]);

                    for (const retiro of nuevos) {
                        const retiroId = retiro.ordenDeRetiro;
                        printedIdsRef.current.add(retiroId);
                        addLog(`Imprimiendo retiro ${retiroId} (${copies} copias)...`, 'info', retiro, 'printer');
                        await queuePrint(retiro); // serializado: espera a que termine antes del siguiente
                    }

                    // Mantener solo los últimos 200 IDs para no crecer indefinidamente
                    if (printedIdsRef.current.size > 200) {
                        const arr = [...printedIdsRef.current];
                        printedIdsRef.current = new Set(arr.slice(arr.length - 200));
                    }
                    try { localStorage.setItem('ps_printedIds', JSON.stringify([...printedIdsRef.current])); } catch { }

                    // Refrescar historial en tiempo real (filtrando por fechaAlta = hoy)
                    try {
                        const hoy = new Date().toISOString().split('T')[0];
                        const histRes = await api.get('/apiordenesRetiro/estados?estados=1,2,3,4,5,9');
                        const data = (histRes.data || [])
                            .filter(r => r.fechaAlta && new Date(r.fechaAlta).toISOString().split('T')[0] === hoy)
                            .sort((a, b) => new Date(b.fechaAlta) - new Date(a.fechaAlta));
                        setHistorialHoy(data);
                    } catch { /* silencioso */ }
                } else {
                    addLog('No se encontraron retiros recientes para imprimir', 'error', null, 'warning');
                }
            } catch (err) {
                addLog(`Error al obtener retiro: ${err.message}`, 'error', null, 'error');
            }
        };

        socket.on('retiros:update', handleRetiroUpdate);
        return () => socket.off('retiros:update', handleRetiroUpdate);
    }, [soundEnabled, copies, queuePrint, addLog]);

    return (
        <div style={{
            height: '100vh',
            overflowY: 'auto',
            background: '#0a0a0a',
            color: '#e0e0e0',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            boxSizing: 'border-box',
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
                    <Printer size={28} color="#ffd700" />
                    <div>
                        <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#fff', margin: 0, textTransform: 'uppercase', letterSpacing: '2px' }}>Print Station — Retiros</h1>
                        <p style={{ fontSize: '12px', color: '#888', margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>Impresión automática de tickets de retiro</p>
                    </div>
                </div>

                {/* Logo centrado */}
                <Logo className="h-16 text-white" style={{ marginBottom: '-12px', marginTop: '4px' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {/* Copias */}
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

                    {/* Sonido toggle */}
                    <button
                        onClick={() => setSoundEnabled(prev => !prev)}
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

                    {/* Estado conexión */}
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
                    <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Hojas impresas</div>
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
                    <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>{copies > 1 ? 'Copias' : 'Copia'} por ticket</div>
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
                            Sin actividad. Los eventos aparecerán aquí cuando lleguen retiros nuevos.
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
                            {log.retiro && (
                                <button
                                    onClick={() => { addLog(`Reimprimiendo ${log.retiro.ordenDeRetiro}...`, 'info', log.retiro, 'printer'); queuePrint(log.retiro); }}
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

            {/* ── HISTORIAL DEL DÍA ── */}
            <div style={{
                padding: '16px 20px',
                background: '#141414',
                borderRadius: '16px',
                border: '1px solid #222',
                overflow: 'hidden'
            }}>
                <button
                    onClick={() => {
                        const opening = !showHistorial;
                        setShowHistorial(opening);
                        if (opening && historialHoy.length === 0) {
                            setLoadingHistorial(true);
                            const hoy = new Date().toISOString().split('T')[0];
                            api.get('/apiordenesRetiro/estados?estados=1,2,3,4,5,9')
                                .then(res => {
                                    const data = (res.data || [])
                                        .filter(r => r.fechaAlta && new Date(r.fechaAlta).toISOString().split('T')[0] === hoy)
                                        .sort((a, b) => new Date(b.fechaAlta) - new Date(a.fechaAlta));
                                    setHistorialHoy(data);
                                })
                                .catch(err => addLog(`Error historial: ${err.message}`, 'error'))
                                .finally(() => setLoadingHistorial(false));
                        }
                    }}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: '#e0e0e0',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: 0
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <History size={18} color="#ffd700" />
                        <span style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>Historial del día</span>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#888', background: '#1a1a1a', padding: '2px 8px', borderRadius: '10px' }}>{historialHoy.length}</span>
                    </div>
                    {showHistorial ? <ChevronUp size={16} color="#888" /> : <ChevronDown size={16} color="#888" />}
                </button>

                {showHistorial && (
                    <div style={{ marginTop: '12px', borderTop: '1px solid #222', paddingTop: '12px' }}>
                        {/* Bulk reprint bar */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <button
                                onClick={() => {
                                    if (selectedHistorial.size === historialHoy.length) setSelectedHistorial(new Set());
                                    else setSelectedHistorial(new Set(historialHoy.map(r => r.ordenDeRetiro)));
                                }}
                                style={{
                                    background: 'none', border: '1px solid #333', borderRadius: '6px',
                                    padding: '4px 10px', cursor: 'pointer', color: '#aaa', fontSize: '11px',
                                    display: 'flex', alignItems: 'center', gap: '6px'
                                }}
                            >
                                <CheckSquare size={13} /> {selectedHistorial.size === historialHoy.length ? 'Deseleccionar' : 'Seleccionar'} todo
                            </button>
                            <button
                                onClick={() => {
                                    const sel = historialHoy.filter(r => selectedHistorial.has(r.ordenDeRetiro));
                                    if (sel.length === 0) return;
                                    addLog(`Reimprimiendo ${sel.length} hojas...`, 'info', null, 'printer');
                                    (async () => {
                                        for (const retiro of sel) {
                                            await queuePrint(retiro);
                                        }
                                    })();
                                }}
                                disabled={selectedHistorial.size === 0}
                                style={{
                                    background: selectedHistorial.size > 0 ? 'rgba(255,215,0,0.15)' : 'transparent',
                                    border: `1px solid ${selectedHistorial.size > 0 ? 'rgba(255,215,0,0.4)' : '#333'}`,
                                    borderRadius: '8px', padding: '5px 14px',
                                    cursor: selectedHistorial.size > 0 ? 'pointer' : 'not-allowed',
                                    color: selectedHistorial.size > 0 ? '#ffd700' : '#555',
                                    fontSize: '12px', fontWeight: 700,
                                    display: 'flex', alignItems: 'center', gap: '6px'
                                }}
                            >
                                <Printer size={14} /> Reimprimir ({selectedHistorial.size})
                            </button>
                        </div>

                        {loadingHistorial ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#555' }}>
                                <RefreshCcw size={20} style={{ animation: 'spin 1s linear infinite' }} />
                                <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
                            </div>
                        ) : historialHoy.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#555', fontSize: '13px' }}>
                                Sin retiros hoy
                            </div>
                        ) : (
                            <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {historialHoy.map(retiro => {
                                    const isSelected = selectedHistorial.has(retiro.ordenDeRetiro);
                                    const isEnc = (retiro.lugarRetiro || '').toLowerCase().includes('encomienda');
                                    return (
                                        <div
                                            key={retiro.ordenDeRetiro}
                                            onClick={() => {
                                                const s = new Set(selectedHistorial);
                                                s.has(retiro.ordenDeRetiro) ? s.delete(retiro.ordenDeRetiro) : s.add(retiro.ordenDeRetiro);
                                                setSelectedHistorial(s);
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '12px',
                                                padding: '8px 12px', borderRadius: '8px', cursor: 'pointer',
                                                background: isSelected ? 'rgba(255,215,0,0.08)' : 'transparent',
                                                border: `1px solid ${isSelected ? 'rgba(255,215,0,0.2)' : 'transparent'}`,
                                                transition: 'all 0.15s'
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                readOnly
                                                style={{ accentColor: '#ffd700', width: '16px', height: '16px', cursor: 'pointer' }}
                                            />
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#fff', width: '90px', flexShrink: 0 }}>{retiro.ordenDeRetiro}</span>
                                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#00d4ff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {retiro.CliNombre || retiro.CliCodigoCliente || '-'}
                                            </span>
                                            <span style={{ fontSize: '11px', color: isEnc ? '#ffd700' : '#666', flexShrink: 0, fontWeight: isEnc ? 700 : 400 }}>
                                                {retiro.lugarRetiro || ''}
                                            </span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); addLog(`Reimprimiendo ${retiro.ordenDeRetiro}...`, 'info', retiro, 'printer'); queuePrint(retiro); }}
                                                style={{
                                                    background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.3)',
                                                    borderRadius: '6px', padding: '3px 8px', cursor: 'pointer',
                                                    color: '#ffd700', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', flexShrink: 0
                                                }}
                                            >
                                                <RotateCcw size={12} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Iframe oculto para impresión */}
            <iframe
                ref={iframeRef}
                style={{ display: 'none' }}
                title="print-frame"
            />

            {/* [WMS] Iframe propio para los remitos A4 de pedidos WMS (no comparte el de
                tickets: acá se carga una URL del backend, no HTML escrito a mano) */}
            <iframe
                ref={wmsIframeRef}
                style={{ display: 'none' }}
                title="wms-remito-frame"
            />
        </div>
    );
};

export default PrintStationPage;
