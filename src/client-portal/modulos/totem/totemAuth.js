// Token de dispositivo del TÓTEM.
//
// El local no tiene IP fija, así que el tótem ya no se autoriza por IP sino por un secreto
// guardado en ESTE equipo. Se activa una sola vez abriendo:  /totem?activar=EL_TOKEN
// (después la clave se borra de la URL para que no quede a la vista ni en el historial).
//
// El token viaja en el header X-Totem-Token en cada llamada al backend.

const KEY = 'totemToken';

export const getTotemToken = () => {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
};

export const setTotemToken = (token) => {
    try { localStorage.setItem(KEY, String(token || '').trim()); } catch { /* modo privado / storage bloqueado */ }
};

// Clave del POS de ESTE tótem (cobro con tarjeta). Es aparte del token: los dos tótems comparten el
// token, pero cada uno tiene su POS y el backend tiene que saber a cuál mandar el importe. Se activa
// una vez con /totem?pos=CLAVE (la genera `node scripts/poslinkProbar.js clave TOTEM1`).
const KEY_POS = 'totemPosKey';

export const getTotemPosKey = () => {
    try { return localStorage.getItem(KEY_POS) || ''; } catch { return ''; }
};

/**
 * Si la URL trae ?activar=TOKEN y/o ?pos=CLAVE, los guarda y limpia la query.
 * Devuelve true si en esta carga se activó algo.
 */
export const activarDesdeURL = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        const token = (params.get('activar') || '').trim();
        const clavePos = (params.get('pos') || '').trim();
        if (!token && !clavePos) return false;
        if (token) setTotemToken(token);
        if (clavePos) { try { localStorage.setItem(KEY_POS, clavePos); } catch { /* storage bloqueado */ } }
        params.delete('activar');
        params.delete('pos');
        const q = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
        return true;
    } catch { return false; }
};

/** Headers para el cobro con tarjeta: el token del tótem y la clave de su POS. */
export const totemPosHeaders = (extra = {}) => {
    const clave = getTotemPosKey();
    const h = totemHeaders(extra);
    return clave ? { ...h, 'X-Totem-Pos': clave } : h;
};

/** Headers con el token (si hay), preservando los que ya se pasen. */
export const totemHeaders = (extra = {}) => {
    const token = getTotemToken();
    return token ? { ...extra, 'X-Totem-Token': token } : { ...extra };
};
