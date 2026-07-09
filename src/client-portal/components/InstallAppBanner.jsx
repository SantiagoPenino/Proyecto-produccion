import React, { useEffect, useState } from 'react';
import { Smartphone, Share, X, Download } from 'lucide-react';
import { canPromptInstall, onInstallAvailable, promptInstall } from '../../utils/pwa';
import { isTabletDevice } from '../../utils/device';

const DISMISS_KEY = 'pwa_install_dismiss';

// ¿Ya está corriendo como app instalada?
const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// iOS no tiene beforeinstallprompt: se muestran instrucciones manuales (Compartir → Agregar a inicio)
const isIOS = () =>
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1);

/**
 * Banner "Instalá la app" del portal de clientes.
 * - Chrome/Edge/Android: botón que dispara el prompt nativo (capturado en utils/pwa.js).
 * - iOS: instrucciones manuales (Safari no soporta el prompt).
 * - No aparece si: ya está instalada, el usuario lo descartó, o es una tablet de planta.
 */
export const InstallAppBanner = () => {
    const [canInstall, setCanInstall] = useState(canPromptInstall());
    const [dismissed, setDismissed] = useState(() => {
        try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return true; }
    });

    // El beforeinstallprompt puede dispararse DESPUÉS de que este banner monte
    useEffect(() => onInstallAvailable(setCanInstall), []);

    if (dismissed || isStandalone() || isTabletDevice()) return null;
    const ios = isIOS();
    if (!canInstall && !ios) return null; // navegador sin soporte o criterios no cumplidos aún

    const cerrar = () => {
        try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* noop */ }
        setDismissed(true);
    };

    const instalar = async () => {
        const outcome = await promptInstall();
        // Aceptó → appinstalled esconde solo. Rechazó el diálogo nativo → no insistir más.
        if (outcome === 'dismissed') cerrar();
    };

    return (
        <div className="flex items-center gap-4 bg-zinc-900/70 border border-brand-cyan/25 rounded-2xl px-5 py-4">
            <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 border border-brand-cyan/20 flex items-center justify-center text-brand-cyan shrink-0">
                <Smartphone size={19} />
            </div>

            <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-zinc-100">Instalá la app de USER</div>
                {ios ? (
                    <div className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        Tocá <span className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-md px-1.5 py-0.5 text-zinc-200 font-bold"><Share size={11} /> Compartir</span>
                        y elegí <span className="font-bold text-zinc-200">"Agregar a pantalla de inicio"</span>
                    </div>
                ) : (
                    <div className="text-xs text-zinc-400 mt-0.5">
                        Recibí avisos al instante cuando tu pedido esté pronto para retirar.
                    </div>
                )}
            </div>

            {!ios && (
                <button
                    onClick={instalar}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-cyan text-white text-xs font-black uppercase tracking-wide hover:bg-cyan-600 transition-colors shadow-md shadow-brand-cyan/20"
                >
                    <Download size={13} /> Instalar
                </button>
            )}

            <button
                onClick={cerrar}
                title="No mostrar más"
                className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
                <X size={14} />
            </button>
        </div>
    );
};

export default InstallAppBanner;
