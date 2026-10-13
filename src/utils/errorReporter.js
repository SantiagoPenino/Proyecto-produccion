/**
 * Global frontend error reporter.
 * Captures unhandled errors and sends them to /api/client-error.
 * Import once in main.jsx or App.jsx.
 */

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Errores que no son de la app y no se mandan (13/10/2026). Misma regla que esRuidoAjeno en
// backend/controllers/sysadminController.js (que además los descarta si llegan de un front viejo):
//  · todos los pasos del stack son de una extensión del navegador (chrome-/moz-/safari-extension://);
//  · "__firefox__": código que Firefox para iPhone inyecta en la página.
const RX_URL_STACK = /(?:[a-z][a-z0-9+.-]*:\/\/[^\s)'"]+|webpack-internal:[^\s)'"]+)/gi;
const RX_EXTENSION = /^(chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;
function esRuidoAjeno({ message, stack, source }) {
    if (/__firefox__/.test(String(message || ''))) return true;
    const urls = `${stack || ''}\n${source || ''}`.match(RX_URL_STACK) || [];
    return urls.length > 0 && urls.every(u => RX_EXTENSION.test(u));
}

function reportError(data) {
    try {
        if (esRuidoAjeno(data)) return;
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        navigator.sendBeacon?.(`${API_BASE}/client-error`, new Blob([JSON.stringify({
            ...data,
            userId: user?.userId || user?.id || null,
            userAgent: navigator.userAgent,
            url: window.location.href,
            timestamp: new Date().toISOString(),
        })], { type: 'application/json' }));
    } catch (e) { /* silently fail */ }
}

// Capture unhandled JS errors
window.addEventListener('error', (event) => {
    reportError({
        message: event.message,
        stack: event.error?.stack || '',
        source: `${event.filename}:${event.lineno}:${event.colno}`,
    });
});

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
    reportError({
        message: `Unhandled Promise: ${event.reason?.message || String(event.reason)}`,
        stack: event.reason?.stack || '',
    });
});

export default reportError;
