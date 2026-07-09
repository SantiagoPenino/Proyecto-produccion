/**
 * PWA: registro del Service Worker + aviso de "nueva versión disponible".
 *
 * Al deployar, el SW nuevo se activa enseguida (skipWaiting) pero la pestaña
 * sigue corriendo los chunks viejos hasta recargar — y los lazy-chunks viejos
 * ya no existen en el server (ChunkLoadError, la vieja pantalla negra).
 * Acá detectamos la actualización y mostramos un banner "Actualizar" que
 * recarga la página. Clave para las tablets de planta, que quedan abiertas días:
 * además del evento updatefound, buscamos updates cada 30 min y al volver
 * la pestaña a estar visible.
 */
export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', async () => {
        try {
            const reg = await navigator.serviceWorker.register('/sw.js');

            // Si ya había un SW nuevo esperando (pestaña abierta hace mucho), avisar ya
            if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();

            reg.addEventListener('updatefound', () => {
                const nuevo = reg.installing;
                if (!nuevo) return;
                nuevo.addEventListener('statechange', () => {
                    // 'installed' + ya existe un SW controlando = ACTUALIZACIÓN (no primera instalación)
                    if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateBanner();
                    }
                });
            });

            // Buscar updates activamente: cada 30 min + cuando la pestaña vuelve a foco
            setInterval(() => { reg.update().catch(() => { /* sin red: reintenta el próximo tick */ }); }, 30 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    reg.update().catch(() => { /* noop */ });
                }
            });
        } catch (err) {
            console.warn('[SW] Registration failed:', err);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTALACIÓN DE LA PWA (banner propio "Instalá la app")
//
// El navegador dispara `beforeinstallprompt` cuando el sitio es instalable.
// Lo capturamos con preventDefault (así Chrome NO muestra su mini-aviso tímido),
// lo guardamos, y el diálogo nativo de instalación se dispara recién cuando el
// usuario toca NUESTRO botón (ver InstallAppBanner en el portal).
// ─────────────────────────────────────────────────────────────────────────────
let deferredInstallPrompt = null;
const installListeners = new Set();

export function initInstallPromptCapture() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        installListeners.forEach(fn => fn(true));
    });
    // Si la instala (por donde sea), avisar para esconder el banner
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        installListeners.forEach(fn => fn(false));
    });
}

/** ¿Hay un prompt de instalación capturado y listo para disparar? */
export function canPromptInstall() {
    return !!deferredInstallPrompt;
}

/** Suscribirse a cambios de disponibilidad (el evento puede llegar DESPUÉS de montar el banner). */
export function onInstallAvailable(fn) {
    installListeners.add(fn);
    return () => installListeners.delete(fn);
}

/** Dispara el diálogo nativo de instalación. Devuelve 'accepted' | 'dismissed' | null. */
export async function promptInstall() {
    if (!deferredInstallPrompt) return null;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null; // el evento se usa UNA sola vez
    installListeners.forEach(fn => fn(false));
    return choice?.outcome || null;
}

/** Banner flotante (vanilla DOM: funciona en cualquier ruta, fuera del árbol React). */
function showUpdateBanner() {
    if (document.getElementById('sw-update-banner')) return; // ya visible

    const banner = document.createElement('div');
    banner.id = 'sw-update-banner';
    banner.style.cssText = [
        'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
        'z-index:100000', 'display:flex', 'align-items:center', 'gap:12px',
        'background:#18181b', 'color:#fff', 'border:1px solid #3f3f46',
        'border-radius:14px', 'padding:10px 14px',
        'font-family:Inter,system-ui,sans-serif', 'font-size:13px', 'font-weight:600',
        'box-shadow:0 8px 30px rgba(0,0,0,.45)', 'max-width:92vw',
    ].join(';');
    banner.innerHTML = `
        <span style="white-space:nowrap">🔄 Hay una nueva versión del sistema</span>
        <button id="sw-update-reload" style="background:#00AEEF;color:#fff;border:none;border-radius:10px;padding:7px 14px;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap">Actualizar</button>
        <button id="sw-update-close" title="Más tarde" style="background:transparent;color:#a1a1aa;border:none;font-size:14px;cursor:pointer;padding:2px 4px;line-height:1">✕</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('sw-update-reload').onclick = () => window.location.reload();
    document.getElementById('sw-update-close').onclick = () => banner.remove();
}
