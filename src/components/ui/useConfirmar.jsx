import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, HelpCircle } from 'lucide-react';

// Confirmación con el estilo del sistema, en vez de window.confirm (la ventana gris del navegador). Uso:
//
//   const [confirmar, ventanaConfirmar] = useConfirmar();
//   if (!(await confirmar({ titulo: '¿Limpiar todo?', texto: 'Se borran los códigos escaneados.', confirmar: 'Limpiar', peligro: true }))) return;
//   …y poner {ventanaConfirmar} en el JSX.
//
// Devuelve true / false. Enter confirma y Escape cancela. Mientras está abierta se queda con el teclado (escucha en
// captura y corta la propagación): así ninguna pantalla que lleve el foco a su escáner con cualquier tecla se lo roba.
// Va en portal y en z-[6100], arriba de la barra de arriba (5010) y de los paneles (6000).
export default function useConfirmar() {
    const [pedido, setPedido] = useState(null); // { titulo, texto, confirmar, cancelar, peligro, resolver }
    const botonRef = useRef(null);

    const confirmar = useCallback((opciones = {}) => new Promise((resolver) => {
        setPedido({ confirmar: 'Confirmar', cancelar: 'Cancelar', ...opciones, resolver });
    }), []);

    const responder = useCallback((valor) => {
        setPedido((p) => { p?.resolver(valor); return null; });
    }, []);

    useEffect(() => {
        if (!pedido) return undefined;
        botonRef.current?.focus();
        const teclas = (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); responder(true); }
            else if (e.key === 'Escape') { e.preventDefault(); responder(false); }
        };
        window.addEventListener('keydown', teclas, true);
        return () => window.removeEventListener('keydown', teclas, true);
    }, [pedido, responder]);

    const ventana = pedido ? createPortal(
        <div className="fixed inset-0 z-[6100] flex items-center justify-center p-4 bg-black/40" role="alertdialog" aria-modal="true" aria-labelledby="confirmar-titulo">
            <div className="w-full max-w-sm bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden font-sans">
                <div className="px-5 pt-5 pb-4 flex items-start gap-3">
                    {pedido.peligro
                        ? <AlertTriangle size={22} className="shrink-0 text-rose-500 mt-0.5" />
                        : <HelpCircle size={22} className="shrink-0 text-brand-cyan mt-0.5" />}
                    <div className="min-w-0">
                        <h3 id="confirmar-titulo" className="text-base font-black text-zinc-800 leading-snug">{pedido.titulo}</h3>
                        {pedido.texto && <p className="text-sm text-zinc-500 mt-1">{pedido.texto}</p>}
                    </div>
                </div>
                <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-2">
                    <button type="button" onClick={() => responder(false)}
                        className="px-4 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-100 transition-colors">
                        {pedido.cancelar}
                    </button>
                    <button type="button" ref={botonRef} onClick={() => responder(true)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors ${pedido.peligro ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-cyan hover:bg-brand-cyan/90'}`}>
                        {pedido.confirmar}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    ) : null;

    return [confirmar, ventana];
}
