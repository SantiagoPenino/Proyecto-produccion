import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../api/apiClient';

const DISMISSED_KEY = 'push_prompt_dismissed';
const DISMISSED_EXPIRY_DAYS = 3; // Vuelve a preguntar cada 3 días

export function usePushNotifications() {
    const [permission, setPermission] = useState('default');
    const [isSupported, setIsSupported] = useState(false);
    const [showBanner, setShowBanner] = useState(false);
    const subscribed = useRef(false);

    useEffect(() => {
        const supported = 'serviceWorker' in navigator && 'PushManager' in window;
        setIsSupported(supported);
        if (!supported) return;

        const perm = Notification.permission;
        setPermission(perm);

        if (perm === 'granted') {
            // Ya tiene permiso → suscribir silenciosamente
            subscribe();
        } else if (perm === 'default') {
            // No ha decidido → mostrar banner custom (si no lo cerró recientemente)
            const dismissed = localStorage.getItem(DISMISSED_KEY);
            if (dismissed) {
                const ts = parseInt(dismissed, 10);
                const daysSince = (Date.now() - ts) / (1000 * 60 * 60 * 24);
                if (daysSince < DISMISSED_EXPIRY_DAYS) return; // Respetar
            }
            // Mostrar con delay para no interrumpir la carga
            const timer = setTimeout(() => setShowBanner(true), 3000);
            return () => clearTimeout(timer);
        }
        // Si perm === 'denied' → no mostrar nada, el usuario ya bloqueó
    }, []);

    const subscribe = async () => {
        if (!isSupported || subscribed.current) return;

        try {
            const perm = await Notification.requestPermission();
            setPermission(perm);
            if (perm !== 'granted') return;

            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;

            const { publicKey } = await apiClient.get('/push/vapid-key');
            if (!publicKey) return;

            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            });

            await apiClient.post('/push/subscribe', { subscription });
            subscribed.current = true;
        } catch (err) {
            console.error('[Push] Error al suscribir:', err);
        }
    };

    const unsubscribe = async () => {
        try {
            const registration = await navigator.serviceWorker.getRegistration();
            if (!registration) return;

            const subscription = await registration.pushManager.getSubscription();
            if (!subscription) return;

            await apiClient.delete('/push/unsubscribe', { endpoint: subscription.endpoint });
            await subscription.unsubscribe();
            subscribed.current = false;
        } catch (err) {
            console.error('[Push] Error al desuscribir:', err);
        }
    };

    // Usuario acepta en nuestro banner custom → disparar permiso nativo
    const acceptPush = useCallback(async () => {
        setShowBanner(false);
        localStorage.removeItem(DISMISSED_KEY);
        await subscribe();
    }, [isSupported]);

    // Usuario rechaza en nuestro banner → guardar dismiss y no molestar
    const dismissPush = useCallback(() => {
        setShowBanner(false);
        localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    }, []);

    return { isSupported, permission, showBanner, acceptPush, dismissPush, subscribe, unsubscribe };
}

// Helper: convertir VAPID key base64 a Uint8Array
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}
