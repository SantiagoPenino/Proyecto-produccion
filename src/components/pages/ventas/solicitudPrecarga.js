import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';

// La lista pide la solicitud al pasar el mouse (o al tocarla) para que el detalle abra ya con sus datos: sin esto el
// detalle arrancaba vacío y se armaba de a partes. Una precarga dura 15 s y se usa una sola vez.
const VIDA_MS = 15000;
const precargas = new Map();   // id -> { p, at, data }

export function precargarSolicitud(id) {
    const k = String(id);
    const c = precargas.get(k);
    if (c && Date.now() - c.at < VIDA_MS) return c.p;
    const entrada = { at: Date.now(), data: null };
    entrada.p = svc.obtener(k);
    entrada.p.then(d => {
        entrada.data = d;
        // El bloque TIZADA PRO del primer producto (la pestaña que abre por defecto) pide lo suyo aparte: se
        // adelanta también, para que no aparezca después que el resto. Misma condición con la que se monta.
        const p0 = d?.Productos?.[0];
        if (p0 && p0.TipoFabricacion === 'PRODUCTO_TERMINADO' && p0.Config?.TizadaProMoldeRef) precargarTizada(k, p0.ProductoSolID).catch(() => { });
    }).catch(() => precargas.delete(k));
    precargas.set(k, entrada);
    return entrada.p;
}

// Lectura para el primer render (NO consume: React puede repetir el render de montaje, p. ej. StrictMode o
// Suspense, y la segunda pasada es la que vale). Devuelve { p, at, data } o null si no hay o venció.
const vigente = (mapa, k) => { const c = mapa.get(k); return c && Date.now() - c.at < VIDA_MS ? c : null; };
export const verPrecarga = (id) => vigente(precargas, String(id));
// Se consume en el efecto de montaje (una sola vez): así una entrada vieja no se reutiliza en otra visita.
export function tomarPrecarga(id) {
    const k = String(id);
    const c = vigente(precargas, k);
    precargas.delete(k);
    return c;
}

const tizadas = new Map();     // `${id}:${productoSolId}` -> { p, at, data: [ver, molde] }
function precargarTizada(id, pid) {
    const k = `${id}:${pid}`;
    const c = tizadas.get(k);
    if (c && Date.now() - c.at < VIDA_MS) return c.p;
    const entrada = { at: Date.now(), data: null };
    entrada.p = Promise.all([svc.tizadaProVer(id, pid), svc.moldeDelProducto(id, pid).catch(() => null)]);
    entrada.p.then(d => { entrada.data = d; }).catch(() => tizadas.delete(k));
    tizadas.set(k, entrada);
    return entrada.p;
}
export const verTizadaPrecargada = (id, pid) => vigente(tizadas, `${id}:${pid}`);
export function tomarTizadaPrecargada(id, pid) {
    const k = `${id}:${pid}`;
    const c = vigente(tizadas, k);
    tizadas.delete(k);
    return c;
}

// Una precarga más vieja que esto se muestra igual (no hay vacío) pero se vuelve a pedir por detrás.
export const REFRESCAR_SI_MAS_DE_MS = 3000;

// El perfil (vendedor / diseñador / admin) no cambia en la sesión: se pide una vez. Sin esto los botones del
// encabezado del detalle aparecían un instante después que el resto.
let perfilPromesa = null;
let perfilListo = null;
export function cargarPerfil() {
    if (!perfilPromesa) {
        perfilPromesa = svc.miPerfil()
            .then(p => { perfilListo = p; return p; })
            .catch(e => { perfilPromesa = null; throw e; });
    }
    return perfilPromesa;
}
export const perfilPrecargado = () => perfilListo;
