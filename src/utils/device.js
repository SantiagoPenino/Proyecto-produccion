/**
 * Detección de DISPOSITIVO tablet (las tablets de planta, ej. 1200x800).
 *
 * Importa el dispositivo físico (pantalla táctil + tamaño de pantalla típico de
 * tablet), NO el ancho de la ventana: una ventana angosta en una PC de escritorio
 * NO es tablet, y una tablet apaisada de 1200px SÍ lo es (aunque caiga en el
 * breakpoint "lg" de Tailwind).
 *
 * Uso:
 *  - CSS/Tailwind: la clase `is-tablet` se agrega a <html> al bootear (main.jsx)
 *    → variante `tablet:` en cualquier componente (ej. `tablet:grid-cols-2`).
 *  - JS: `import { isTabletDevice } from '../utils/device'` o `useViewport().isTabletDevice`.
 */
export function isTabletDevice() {
    try {
        // Override manual para PRUEBAS: ?tablet=1 / ?tablet=0 en la URL.
        // Vive solo en esta pestaña (sessionStorage): al cerrarla se vuelve a la detección real.
        const qs = new URLSearchParams(window.location.search).get('tablet');
        if (qs === '1' || qs === '0') sessionStorage.setItem('force_tablet', qs);
        localStorage.removeItem('force_tablet'); // migración: una versión anterior lo persistía acá
        const forced = sessionStorage.getItem('force_tablet');
        if (forced === '1') return true;
        if (forced === '0') return false;

        const ua = navigator.userAgent || '';
        // iPad moderno se camufla de Macintosh: se delata por el touch
        const iPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
        // Android tablet: Android SIN el token "Mobile" (los teléfonos lo llevan)
        const androidTablet = /Android/i.test(ua) && !/Mobile/i.test(ua);
        // Genérico: táctil + pantalla de tamaño tablet (cubre las 1200x800 de planta)
        const touch = (navigator.maxTouchPoints || 0) > 1;
        const shortSide = Math.min(window.screen.width, window.screen.height);
        const longSide = Math.max(window.screen.width, window.screen.height);
        const tabletSize = shortSide >= 600 && longSide <= 1400;

        return iPad || androidTablet || (touch && tabletSize);
    } catch {
        return false;
    }
}

/** Estampa la clase `is-tablet` en <html> para habilitar la variante Tailwind `tablet:`. */
export function applyDeviceClass() {
    if (isTabletDevice()) {
        document.documentElement.classList.add('is-tablet');
    }
}

/**
 * Wake Lock: en las tablets de planta la pantalla NO se apaga mientras la app
 * está visible (sin esto dependés de la config de ahorro de energía de cada tablet).
 * El lock se libera solo cuando la pestaña pasa a segundo plano; por eso se
 * re-pide en cada visibilitychange. Si el sistema lo niega (batería baja), no pasa nada.
 */
export function enableTabletWakeLock() {
    if (!isTabletDevice() || !('wakeLock' in navigator)) return;

    const pedir = async () => {
        try {
            await navigator.wakeLock.request('screen');
        } catch { /* denegado por el SO: no es crítico */ }
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') pedir();
    });
    pedir();
}
