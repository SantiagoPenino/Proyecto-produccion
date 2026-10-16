import { useReducer, useEffect, useRef, useState, useCallback } from 'react';
import { piezaVacia, capasDePlantilla, normalizar } from './capas';

// Estado del editor: la pieza con deshacer/rehacer (50 pasos) y un borrador en el navegador por
// usuario, como el de Reposiciones: si la página se recarga (por ejemplo, en un deploy), la pieza
// sigue donde estaba. Las fotos subidas desde la PC no entran en el borrador (el navegador no da
// tanto lugar): al volver, su capa pide subirla de nuevo. Las de la vitrina sí vuelven.

const MAX_PASOS = 50;
const AGRUPAR_MS = 800;

const claveBorrador = (uid) => `pieza-marketing-borrador:${uid ?? 'anon'}`;

const leerBorrador = (uid) => {
    try {
        const b = JSON.parse(localStorage.getItem(claveBorrador(uid)) || 'null');
        if (b?.v === 1 && Array.isArray(b.pieza?.capas)) return b.pieza;
    } catch { /* borrador roto o sin storage: se arranca de cero */ }
    return null;
};

const guardarBorrador = (uid, pieza) => {
    const capas = pieza.capas.map(c => (c.tipo === 'imagen' && c.origen === 'local')
        ? { ...c, src: null, origen: null, faltaImagen: c.nombreArchivo || 'la foto' }
        : c);
    try { localStorage.setItem(claveBorrador(uid), JSON.stringify({ v: 1, ts: Date.now(), pieza: { ...pieza, capas } })); } catch { /* sin storage: sigue sin borrador */ }
};

const inicial = ({ uid }) => {
    const borrador = leerBorrador(uid);
    if (borrador) return { pasado: [], presente: normalizar(borrador), futuro: [], grupo: null, ts: 0, recuperado: true };
    const base = piezaVacia();
    return { pasado: [], presente: { ...base, capas: capasDePlantilla('precio-foto', base) }, futuro: [], grupo: null, ts: 0, recuperado: false };
};

const reducer = (estado, accion) => {
    switch (accion.tipo) {
        case 'cambiar': {
            const nuevo = normalizar(accion.fn(estado.presente));
            if (nuevo === estado.presente) return estado;
            const ahora = Date.now();
            // Cambios seguidos del mismo grupo (tipear en un campo, mover con las flechas) son un solo paso.
            if (accion.grupo && accion.grupo === estado.grupo && ahora - estado.ts < AGRUPAR_MS) {
                return { ...estado, presente: nuevo, futuro: [], ts: ahora };
            }
            return {
                ...estado,
                pasado: [...estado.pasado, estado.presente].slice(-MAX_PASOS),
                presente: nuevo,
                futuro: [],
                grupo: accion.grupo || null,
                ts: ahora,
            };
        }
        case 'deshacer': {
            if (!estado.pasado.length) return estado;
            const anterior = estado.pasado[estado.pasado.length - 1];
            return { ...estado, pasado: estado.pasado.slice(0, -1), presente: anterior, futuro: [estado.presente, ...estado.futuro], grupo: null };
        }
        case 'rehacer': {
            if (!estado.futuro.length) return estado;
            const [siguiente, ...resto] = estado.futuro;
            return { ...estado, pasado: [...estado.pasado, estado.presente], presente: siguiente, futuro: resto, grupo: null };
        }
        default:
            return estado;
    }
};

export const useEditorPieza = (uid) => {
    const [estado, despachar] = useReducer(reducer, { uid }, inicial);
    const [recuperado] = useState(estado.recuperado);

    // `fn` recibe la pieza actual y devuelve la nueva. `grupo` junta cambios seguidos en un paso.
    const cambiar = useCallback((fn, grupo) => despachar({ tipo: 'cambiar', fn, grupo }), []);
    const deshacer = useCallback(() => despachar({ tipo: 'deshacer' }), []);
    const rehacer = useCallback(() => despachar({ tipo: 'rehacer' }), []);

    // Borrador: se guarda un momento después de cada cambio.
    const timer = useRef(null);
    useEffect(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => guardarBorrador(uid, estado.presente), 400);
        return () => clearTimeout(timer.current);
    }, [uid, estado.presente]);

    return {
        pieza: estado.presente,
        cambiar,
        deshacer,
        rehacer,
        puedeDeshacer: estado.pasado.length > 0,
        puedeRehacer: estado.futuro.length > 0,
        recuperado,
    };
};
