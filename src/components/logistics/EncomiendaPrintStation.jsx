import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Printer, Wifi, WifiOff, Volume2, VolumeX, Bell, RotateCcw, Package, AlertTriangle, XCircle, Tag, History, ChevronUp, ChevronDown, RefreshCcw, CheckSquare } from 'lucide-react';
import { socket } from '../../services/socketService';
import api from '../../services/api';
import { Logo } from '../Logo';

const EncomiendaPrintStation = () => {
    const [connected, setConnected] = useState(socket.connected);
    const [logs, setLogs] = useState(() => {
        try { const s = localStorage.getItem('eps_logs'); return s ? JSON.parse(s) : []; } catch { return []; }
    });
    const [printCount, setPrintCount] = useState(() => {
        try { return parseInt(localStorage.getItem('eps_printCount')) || 0; } catch { return 0; }
    });
    const [soundEnabled, setSoundEnabled] = useState(() => {
        try { const s = localStorage.getItem('eps_soundEnabled'); return s !== null ? s === 'true' : true; } catch { return true; }
    });
    const [copies, setCopies] = useState(() => {
        try { return parseInt(localStorage.getItem('eps_copies')) || 1; } catch { return 1; }
    });
    const iframeRef = useRef(null);
    const audioRef = useRef(null);
    const printedIdsRef = useRef(() => {
        try { const s = localStorage.getItem('eps_printedIds'); return s ? new Set(JSON.parse(s)) : new Set(); } catch { return new Set(); }
    });
    if (typeof printedIdsRef.current === 'function') printedIdsRef.current = printedIdsRef.current();

    // Historial state
    const [historialHoy, setHistorialHoy] = useState([]);
    const [loadingHistorial, setLoadingHistorial] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);
    const [selectedHistorial, setSelectedHistorial] = useState(new Set());

    // Persist state
    useEffect(() => { try { localStorage.setItem('eps_logs', JSON.stringify(logs)); } catch {} }, [logs]);
    useEffect(() => { try { localStorage.setItem('eps_printCount', String(printCount)); } catch {} }, [printCount]);
    useEffect(() => { try { localStorage.setItem('eps_soundEnabled', String(soundEnabled)); } catch {} }, [soundEnabled]);
    useEffect(() => { try { localStorage.setItem('eps_copies', String(copies)); } catch {} }, [copies]);

    // Cargar historial al montar (para que el contador no muestre 0)
    useEffect(() => {
        const hoy = new Date().toISOString().split('T')[0];
        setLoadingHistorial(true);
        api.get(`/apiordenesRetiro/estados?estados=5&date=${hoy}`)
            .then(res => setHistorialHoy(res.data || []))
            .catch(() => {})
            .finally(() => setLoadingHistorial(false));
    }, []);

    // Sound
    useEffect(() => {
        audioRef.current = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1pq6y0r6KYj5+xtbisl4eEkKW0u7OljYWMnK+4t6yYjI2ZqrW1rZqOjpersbOsnpOPlqexsa6glo+VpbCxr6KYkZWjr7GvoZiSlKOusa+impOUoq+xr6KZk5Sjr7CvopmTlKOvsK+imZOUo6+wr6KZk5Sjr7CvopmTlKOvsK+hmJKToa6vr6GYkpOhr6+voZiSk6GvAA==');
    }, []);

    const addLog = useCallback((message, type = 'info', retiro = null, icon = null) => {
        const time = new Date().toLocaleTimeString('es-UY', { hour12: false });
        setLogs(prev => [{ time, message, type, retiro, icon }, ...prev].slice(0, 50));
    }, []);

    // Socket connection
    useEffect(() => {
        const onConnect = () => { setConnected(true); addLog('Conectado al servidor', 'success'); };
        const onDisconnect = () => { setConnected(false); addLog('Desconectado del servidor', 'error'); };
        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        if (socket.connected) addLog('ESPERANDO ENCOMIENDAS...', 'success');
        return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); };
    }, [addLog]);

    // Generate 10x15cm shipping label HTML (updated format)
    const generateLabelHTML = useCallback((enc) => {
        const nombre = enc.receptorNombre || enc.CliNombre || enc.CliCodigoCliente || '-';
        const telefono = enc.CliTelefono ? enc.CliTelefono.trim() : '';
        const depto = enc.departamentoEnvio || '';
        const localidad = enc.localidadEnvio || '';
        const direccion = enc.direccionEnvio || '';
        const agencia = enc.agenciaNombre || '';
        const ordenRetiro = enc.ordenDeRetiro || '';

        const labelBody = `<div class="label">
            <div class="header-bar">
                <span class="logo">USER</span>
                <span class="orden-code">${ordenRetiro}</span>
            </div>
            <div class="dest-section">
                <div class="badge-center"><span class="badge">DESTINATARIO</span></div>
                <div class="dest-nombre">${nombre}</div>
                ${telefono ? `<div class="dest-row">&#9742; ${telefono}</div>` : ''}
                <div class="section-sep"></div>
                ${depto ? `<div class="dest-depto">${depto}</div>` : ''}
                ${localidad ? `<div class="dest-localidad">${localidad}</div>` : ''}
                ${direccion ? `<div class="dest-dir">${direccion}</div>` : ''}
                <div class="section-sep"></div>
                ${agencia ? `<div class="agencia-pill">AGENCIA &#8226; ${agencia}</div>` : ''}
            </div>
            <div class="divider-area">
                <div class="divider-line"></div>
            </div>
            <div class="rem-section">
                <div class="badge-center"><span class="badge rem-badge">REMITENTE</span></div>
                <div class="rem-nombre">USER</div>
                <div class="rem-dir">Inca 2228</div>
                <div class="rem-city">Montevideo, Uruguay</div>
                <div class="rem-tel">&#9742; 092284262</div>
            </div>
        </div>`;

        return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Etiqueta ${ordenRetiro}</title>
        <style>
            @page{size:10cm 15cm;margin:0;}*{margin:0;padding:0;box-sizing:border-box;}
            body{font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;background:#fff;}
            .label{width:10cm;height:15cm;background:#fff;border:2px solid #222;display:flex;flex-direction:column;overflow:hidden;}
            .header-bar{background:#fff;color:#111;padding:8px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #222;}
            .logo{font-size:20px;font-weight:900;letter-spacing:3px;text-transform:uppercase;color:#111;}
            .orden-code{font-size:20px;font-weight:900;font-family:'Courier New',monospace;letter-spacing:1px;color:#111;}
            .dest-section{flex:1;padding:0 20px;display:flex;flex-direction:column;justify-content:center;align-items:center;}
            .badge-center{text-align:center;margin-bottom:6px;}
            .badge{display:inline-block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:3px;color:#111;background:#fff;padding:4px 14px;border:1.5px solid #222;border-radius:3px;}
            .dest-nombre{font-size:30px;font-weight:700;text-transform:uppercase;line-height:1.15;margin-bottom:8px;color:#111;text-align:center;width:100%;}
            .dest-depto{font-size:30px;font-weight:700;color:#111;margin-bottom:4px;line-height:1.2;text-align:center;text-transform:uppercase;width:100%;}
            .dest-localidad{font-size:24px;font-weight:600;color:#333;margin-bottom:4px;line-height:1.2;text-align:center;text-transform:uppercase;width:100%;}
            .dest-dir{font-size:20px;font-weight:600;color:#222;margin-bottom:4px;line-height:1.2;text-align:center;text-transform:uppercase;width:100%;}
            .section-sep{width:100%;border-top:3px dashed #333;margin:6px 0;}
            .dest-row{font-size:20px;font-weight:600;color:#333;margin-bottom:4px;line-height:1.2;text-align:center;text-transform:uppercase;width:100%;}
            .agencia-pill{margin:4px 0;font-size:20px;font-weight:800;color:#1a1a1a;background:#f0f0f0;border:1.5px solid #ccc;padding:5px 14px;border-radius:6px;text-align:center;text-transform:uppercase;}
            .divider-area{display:flex;align-items:center;padding:2px 16px;}
            .divider-line{flex:1;border-top:3px dashed #333;}
            .scissors{font-size:16px;color:#aaa;}
            .rem-section{padding:8px 20px 10px;background:#fafafa;border-top:1px solid #eee;text-align:center;text-transform:uppercase;}
            .rem-badge{color:#111;background:#fff;border:1.5px solid #666;}
            .rem-nombre{font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#333;margin-bottom:2px;}
            .rem-dir{font-size:18px;font-weight:700;color:#444;line-height:1.4;}
            .rem-city{font-size:15px;font-weight:600;color:#666;line-height:1.4;}
            .rem-tel{font-size:20px;font-weight:800;color:#333;line-height:1.4;margin-top:2px;}
        </style></head><body>${labelBody}</body></html>`;
    }, []);

    // Print label
    const printLabel = useCallback((retiro) => {
        if (!iframeRef.current) return;
        const html = generateLabelHTML(retiro);

        const printOnce = (copyNum) => {
            return new Promise((resolve) => {
                const iframe = iframeRef.current;
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                doc.open();
                doc.write(html);
                doc.close();
                setTimeout(() => {
                    try {
                        iframe.contentWindow.print();
                        addLog(`Copia ${copyNum} impresa: ${retiro.ordenDeRetiro}`, 'success');
                    } catch (err) {
                        addLog(`Error imprimiendo copia ${copyNum}: ${err.message}`, 'error');
                    }
                    resolve();
                }, 300);
            });
        };

        (async () => {
            for (let i = 1; i <= copies; i++) {
                await printOnce(i);
                if (i < copies) await new Promise(r => setTimeout(r, 1000));
            }
            setPrintCount(prev => prev + 1);
        })();
    }, [copies, generateLabelHTML, addLog]);

    // Listen for new retiros (filter encomiendas only)
    useEffect(() => {
        const handleRetiroUpdate = async (data) => {
            if (data?.type !== 'nuevo_retiro') return;

            try {
                const res = await api.get('/apiordenesRetiro/estados?estados=1,2,3,4');
                const retiros = res.data;
                if (retiros && retiros.length > 0) {
                    const sorted = retiros.sort((a, b) => new Date(b.fechaAlta) - new Date(a.fechaAlta));

                    // Filter: only encomiendas not yet printed (printedIds prevents duplicates)
                    const nuevos = sorted.filter(r => {
                        if (printedIdsRef.current.has(r.ordenDeRetiro)) return false;
                        const lugar = (r.lugarRetiro || '').toLowerCase();
                        const esEncomiendaPorNombre = lugar.includes('encomienda');
                        const esEncomiendaPorId = r.formaEnvioId === 2 || r.LReIdLugarRetiro === 2;
                        return esEncomiendaPorNombre || esEncomiendaPorId;
                    });

                    if (nuevos.length === 0) {
                        return;
                    }

                    // Only log and play sound when we actually have encomiendas
                    addLog(`Nueva encomienda detectada (${nuevos.length})`, 'info', null, 'package');
                    if (soundEnabled && audioRef.current) {
                        audioRef.current.play().catch(() => {});
                    }

                    for (const retiro of nuevos) {
                        const retiroId = retiro.ordenDeRetiro;
                        printedIdsRef.current.add(retiroId);
                        addLog(`Imprimiendo etiqueta ${retiroId} → ${retiro.receptorNombre || retiro.CliNombre || 'N/A'} (${copies} copias)`, 'info', retiro, 'printer');
                        printLabel(retiro);
                        if (nuevos.length > 1) await new Promise(r => setTimeout(r, 1500));
                    }

                    // Keep only last 200 IDs
                    if (printedIdsRef.current.size > 200) {
                        const arr = [...printedIdsRef.current];
                        printedIdsRef.current = new Set(arr.slice(arr.length - 200));
                    }
                    try { localStorage.setItem('eps_printedIds', JSON.stringify([...printedIdsRef.current])); } catch {}

                    // Refrescar historial en tiempo real (para que el contador y la lista se actualicen sin expandir)
                    try {
                        const hoy = new Date().toISOString().split('T')[0];
                        const histRes = await api.get(`/apiordenesRetiro/estados?estados=5&date=${hoy}`);
                        setHistorialHoy(histRes.data || []);
                    } catch { /* silencioso */ }
                } else {
                    addLog('No se encontraron retiros recientes', 'error', null, 'warning');
                }
            } catch (err) {
                addLog(`Error al obtener retiros: ${err.message}`, 'error', null, 'error');
            }
        };

        socket.on('retiros:update', handleRetiroUpdate);
        return () => socket.off('retiros:update', handleRetiroUpdate);
    }, [soundEnabled, copies, printLabel, addLog]);

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
                    <Tag size={28} color="#ffd700" />
                    <div>
                        <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#fff', margin: 0, textTransform: 'uppercase', letterSpacing: '2px' }}>Print Station — Encomiendas</h1>
                        <p style={{ fontSize: '12px', color: '#888', margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>Impresión automática de etiquetas de envío</p>
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
                    <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>Etiquetas impresas</div>
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
                    <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px' }}>{copies > 1 ? 'Copias' : 'Copia'} por etiqueta</div>
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
                            Sin actividad. Las etiquetas se imprimirán automáticamente cuando lleguen encomiendas.
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
                                    onClick={() => { addLog(`Reimprimiendo ${log.retiro.ordenDeRetiro}...`, 'info', log.retiro, 'printer'); printLabel(log.retiro); }}
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
                title="encomienda-print-frame"
            />

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
                            api.get(`/apiordenesRetiro/estados?estados=5&date=${hoy}`)
                                .then(res => setHistorialHoy(res.data || []))
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
                                    else setSelectedHistorial(new Set(historialHoy.map(e => e.ordenDeRetiro)));
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
                                    const sel = historialHoy.filter(e => selectedHistorial.has(e.ordenDeRetiro));
                                    if (sel.length === 0) return;
                                    addLog(`Reimprimiendo ${sel.length} etiquetas...`, 'info', null, 'printer');
                                    (async () => {
                                        for (const enc of sel) {
                                            printLabel(enc);
                                            if (sel.length > 1) await new Promise(r => setTimeout(r, 1500));
                                        }
                                    })();
                                }}
                                disabled={selectedHistorial.size === 0}
                                style={{
                                    background: selectedHistorial.size > 0 ? 'rgba(255,215,0,0.15)' : 'transparent',
                                    border: `1px solid ${selectedHistorial.size > 0 ? 'rgba(255,215,0,0.4)' : '#333'}`,
                                    borderRadius: '8px', padding: '5px 14px', cursor: selectedHistorial.size > 0 ? 'pointer' : 'not-allowed',
                                    color: selectedHistorial.size > 0 ? '#ffd700' : '#555', fontSize: '12px', fontWeight: 700,
                                    display: 'flex', alignItems: 'center', gap: '6px'
                                }}
                            >
                                <Tag size={14} /> Reimprimir ({selectedHistorial.size})
                            </button>
                        </div>

                        {loadingHistorial ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#555' }}>
                                <RefreshCcw size={20} style={{ animation: 'spin 1s linear infinite' }} />
                                <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
                            </div>
                        ) : historialHoy.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: '#555', fontSize: '13px' }}>
                                Sin entregas hoy
                            </div>
                        ) : (
                            <div style={{ maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {historialHoy.map(enc => {
                                    const isSelected = selectedHistorial.has(enc.ordenDeRetiro);
                                    return (
                                        <div
                                            key={enc.ordenDeRetiro}
                                            onClick={() => {
                                                const s = new Set(selectedHistorial);
                                                s.has(enc.ordenDeRetiro) ? s.delete(enc.ordenDeRetiro) : s.add(enc.ordenDeRetiro);
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
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#fff', width: '90px', flexShrink: 0 }}>{enc.ordenDeRetiro}</span>
                                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#00d4ff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {enc.receptorNombre || enc.CliNombre || '-'}
                                            </span>
                                            <span style={{ fontSize: '11px', color: '#666', flexShrink: 0 }}>
                                                {enc.agenciaNombre || enc.lugarRetiro || ''}
                                            </span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); addLog(`Reimprimiendo ${enc.ordenDeRetiro}...`, 'info', enc, 'printer'); printLabel(enc); }}
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
        </div>
    );
};

export default EncomiendaPrintStation;
