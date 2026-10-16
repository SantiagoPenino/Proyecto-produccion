import api from '../../../services/api';

// Datos del sistema para las piezas: la lista de precios (la misma de /marketing/precios), la
// vitrina de la tienda y las fotos por color. Se guardan un rato para no pedirlos en cada ventana.

const VIGENCIA_MS = 2 * 60 * 1000;
const cache = {};

const conCache = async (clave, pedir) => {
    const c = cache[clave];
    if (c && Date.now() - c.ts < VIGENCIA_MS) return c.datos;
    const datos = await pedir();
    cache[clave] = { ts: Date.now(), datos };
    return datos;
};

// Una fila por artículo con su precio en cada moneda, como la pantalla de Precios.
export const cargarPrecios = () => conCache('precios', async () => {
    const res = await api.get('/prices/base');
    const porProducto = {};
    (Array.isArray(res.data) ? res.data : [])
        .filter(r => r.Mostrar !== 0 && r.Mostrar !== false)
        .forEach((r) => {
            const id = r.ProIdProducto;
            if (!porProducto[id]) {
                porProducto[id] = {
                    ProIdProducto: id,
                    CodArticulo: (r.CodArticulo || '').trim(),
                    Descripcion: (r.Descripcion || '').trim(),
                    descripcionLista: (r.DescripcionLista || '').trim(),
                    grupo: (r.NombreReferenciaGrupo || r.GrupoNombre || '').trim(),
                    borrado: r.Borrado === 1 || r.Borrado === true,
                    precioUYU: null,
                    precioUSD: null,
                };
            }
            if (r.Precio != null) {
                if (r.MonIdMoneda === 1) porProducto[id].precioUYU = Number(r.Precio);
                else porProducto[id].precioUSD = Number(r.Precio);
            }
        });
    return Object.values(porProducto).sort((a, b) => a.Descripcion.localeCompare(b.Descripcion));
});

export const cargarVitrina = () => conCache('vitrina', async () => {
    const res = await api.get('/products-integration/vitrina');
    return res.data?.data || [];
});

// Fotos de un producto de la vitrina: la principal y las de cada color.
export const cargarFotos = (producto) => conCache(`fotos-${producto.ProIdProducto}`, async () => {
    const lista = [];
    if (producto.Portada) lista.push({ src: producto.Portada, nombre: 'Foto principal' });
    try {
        const res = await api.get(`/products-integration/article-images/${producto.ProIdProducto}`);
        (res.data?.data || []).forEach((f) => {
            if (f.url_imagen && !lista.some(x => x.src === f.url_imagen)) {
                lista.push({ src: f.url_imagen, nombre: f.color ? String(f.color).trim() : 'Foto' });
            }
        });
    } catch { /* sin fotos por color: queda la principal */ }
    return lista;
});

export const fmtPrecio = (v) => (v == null ? null : Number(v).toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
