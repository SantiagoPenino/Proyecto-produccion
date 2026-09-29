// Avisos push para usuarios INTERNOS (servicio técnico y los módulos que vengan).
// El portal de clientes tiene su propio hook (client-portal/hooks/usePushNotifications.js) y
// otra tabla en el backend; acá se guarda la suscripción con el IdUsuario del que la activa.
import { notificacionesService } from '../services/api';

const soportado = () =>
    typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '');

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
}

const dispositivo = () => {
    const ua = navigator.userAgent || '';
    const so = /android/i.test(ua) ? 'Android' : esIOS() ? 'iPhone/iPad' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : 'Otro';
    const nav = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Navegador';
    return `${nav} · ${so}`;
};

async function registro() {
    return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.register('/sw.js');
}

// 'no-soportado' | 'bloqueado' | 'activo' | 'inactivo'
export async function estadoPush() {
    if (!soportado()) return 'no-soportado';
    if (Notification.permission === 'denied') return 'bloqueado';
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        return sub && Notification.permission === 'granted' ? 'activo' : 'inactivo';
    } catch (_) {
        return 'inactivo';
    }
}

export async function activarPush() {
    if (!soportado()) {
        throw new Error(esIOS()
            ? 'En iPhone los avisos funcionan solo con el sistema instalado en la pantalla de inicio (Compartir → Agregar a inicio).'
            : 'Este navegador no permite avisos push.');
    }
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
        throw new Error(permiso === 'denied'
            ? 'Los avisos están bloqueados para este sitio: habilitalos en la configuración del navegador.'
            : 'No se dio permiso para los avisos.');
    }
    const reg = await registro();
    await navigator.serviceWorker.ready;
    const clave = await notificacionesService.clavePush();
    if (!clave) throw new Error('El servidor no tiene configurados los avisos push.');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(clave) });
    await notificacionesService.suscribirPush(sub.toJSON(), dispositivo());
}

export async function desactivarPush() {
    if (!soportado()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    try { await notificacionesService.desuscribirPush(sub.endpoint); } catch (_) { /* igual se da de baja acá */ }
    await sub.unsubscribe();
}

// Al entrar: si este dispositivo ya tiene los avisos activos, re-asocia la suscripción al usuario
// logueado (en una tablet compartida puede haber cambiado de usuario). No pide permisos.
export async function refrescarPushSiActivo() {
    try {
        if ((await estadoPush()) !== 'activo') return;
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (sub) await notificacionesService.suscribirPush(sub.toJSON(), dispositivo());
    } catch (_) { /* sin push no pasa nada */ }
}
