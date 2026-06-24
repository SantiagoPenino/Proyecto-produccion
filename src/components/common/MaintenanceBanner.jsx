import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../services/socketService';

// Banner global de aviso de mantenimiento/deploy. Escucha 'server:maintenance' (emitido
// desde el panel admin → POST /sysadmin/maintenance) y muestra una franja fija con cuenta
// regresiva. Slide simple de entrada/salida desde el borde. En mobile va abajo (para no
// tapar el menú hamburguesa); en desktop, arriba. El reinicio real lo hace el deploy; cuando
// el server vuelve, socketService detecta el nuevo server:started y recarga el front solo.
export default function MaintenanceBanner() {
    const [data, setData] = useState(null);        // { mensaje, restante } | null
    const [visible, setVisible] = useState(false); // controla el slide (true = en pantalla)
    const timerRef = useRef(null);
    const hideRef = useRef(null);
    const showRef = useRef(null);

    useEffect(() => {
        const onMaintenance = (d) => {
            clearInterval(timerRef.current);
            clearTimeout(hideRef.current);
            clearTimeout(showRef.current);

            // Cancelar / sin datos → animar la salida y recién después desmontar
            if (!d || d.cancel) {
                setVisible(false);
                hideRef.current = setTimeout(() => setData(null), 350);
                return;
            }

            let restante = Math.max(1, Math.floor(Number(d.segundos) || 120));
            setData({ mensaje: d.mensaje, restante });
            // Montar fuera de pantalla y en el próximo frame animar la entrada
            setVisible(false);
            showRef.current = setTimeout(() => setVisible(true), 20);

            timerRef.current = setInterval(() => {
                restante -= 1;
                setData(prev => (prev ? { ...prev, restante: Math.max(0, restante) } : null));
                if (restante <= 0) clearInterval(timerRef.current);
            }, 1000);
        };

        socket.on('server:maintenance', onMaintenance);
        return () => {
            socket.off('server:maintenance', onMaintenance);
            clearInterval(timerRef.current);
            clearTimeout(hideRef.current);
            clearTimeout(showRef.current);
        };
    }, []);

    if (!data) return null;

    const mm = Math.floor(data.restante / 60);
    const ss = String(data.restante % 60).padStart(2, '0');

    return (
        <div className={`fixed bottom-0 left-0 right-0 md:top-0 md:bottom-auto z-[100000] bg-amber-500 text-black px-4 py-2.5 flex items-center justify-center gap-3 shadow-lg text-sm font-semibold transition-transform duration-300 ease-out ${visible ? 'translate-y-0' : 'translate-y-full md:-translate-y-full'}`}>
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span>{data.mensaje}</span>
            <span className="font-black tabular-nums bg-black/15 px-2.5 py-0.5 rounded-md whitespace-nowrap">
                {data.restante > 0 ? `${mm}:${ss}` : 'Reiniciando…'}
            </span>
        </div>
    );
}
