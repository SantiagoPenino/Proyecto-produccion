import { useEffect, useRef, useState } from 'react';

/**
 * Recarga por avisos del server (socket), con freno y pausa en pestañas ocultas.
 *
 *  - Freno: como máximo UNA recarga por ventana (8 s). El primer aviso sale casi al toque (300 ms) y el
 *    resto de una ráfaga lo cubre una única recarga al cierre de la ventana. El server avisa orden por
 *    orden, así que sin esto mover un lote de 20 órdenes eran 20 recargas por pantalla.
 *  - Pausa: con la pestaña oculta (no es la activa de su ventana, o la ventana está minimizada) no
 *    recarga nada; queda anotado que se desactualizó y recarga UNA vez apenas vuelve a verse. Con varias
 *    pestañas del mismo tablero, trabaja solo la que se está mirando (24/09: operarios con 3 o 4
 *    pestañas multiplicaban los pedidos de la planilla). El polling de React Query ya se pausa solo.
 *
 * Las acciones propias (arrastrar, asignar, guardar) no pasan por acá: siguen recargando en el momento.
 */
export function crearRecargaConFreno(recargar, {
    ventanaMs = 8000,
    primeroMs = 300,
    estaOculta = () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
} = {}) {
    let timer = null;
    let ultima = 0;
    let pendiente = false;

    const ejecutar = () => {
        timer = null;
        if (estaOculta()) { pendiente = true; return; }   // se ocultó mientras esperaba
        pendiente = false;
        ultima = Date.now();
        recargar();
    };

    return {
        avisar() {
            if (estaOculta()) { pendiente = true; return; }
            if (timer) return;                             // ya hay una recarga agendada que cubre este aviso
            const pasado = Date.now() - ultima;
            timer = setTimeout(ejecutar, pasado >= ventanaMs ? primeroMs : ventanaMs - pasado);
        },
        alCambiarVisibilidad() {
            if (pendiente && !timer && !estaOculta()) ejecutar();
        },
        cancelar() {
            clearTimeout(timer);
            timer = null;
        },
    };
}

/** Devuelve `avisar`, estable entre renders: conectarlo a los listeners del socket. */
export default function useRecargaConFreno(recargar, opciones) {
    const recargarRef = useRef(recargar);
    recargarRef.current = recargar;                        // siempre la versión del último render
    const [freno] = useState(() => crearRecargaConFreno(() => recargarRef.current(), opciones));

    useEffect(() => {
        const alCambiar = () => freno.alCambiarVisibilidad();
        document.addEventListener('visibilitychange', alCambiar);
        return () => {
            document.removeEventListener('visibilitychange', alCambiar);
            freno.cancelar();
        };
    }, [freno]);

    return freno.avisar;
}
