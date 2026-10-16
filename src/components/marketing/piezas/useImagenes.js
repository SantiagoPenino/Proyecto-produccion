import { useEffect, useRef, useState } from 'react';

// Carga las fotos de las capas de imagen. Devuelve { [src]: HTMLImageElement | null }:
// sin la clave, se está cargando; null, no se pudo cargar.
//
// Para poder bajar el PNG, el canvas no puede tener fotos de otro sitio sin permiso (CORS).
// Las de la vitrina vienen de /uploads del mismo servidor y las de la PC son locales; si alguna
// llega de afuera, se pide con crossOrigin y, si el sitio no lo permite, queda como no cargada.
const mismoOrigen = (src) => {
    if (src.startsWith('blob:') || src.startsWith('data:') || src.startsWith('/')) return true;
    try { return new URL(src, window.location.href).origin === window.location.origin; } catch { return false; }
};

export const useImagenes = (capas) => {
    const [mapa, setMapa] = useState({});
    const pedidas = useRef(new Set());

    useEffect(() => {
        capas.forEach((c) => {
            if (c.tipo !== 'imagen' || !c.src || pedidas.current.has(c.src)) return;
            const src = c.src;
            pedidas.current.add(src);
            const img = new window.Image();
            if (!mismoOrigen(src)) img.crossOrigin = 'anonymous';
            img.onload = () => setMapa(m => ({ ...m, [src]: img }));
            img.onerror = () => setMapa(m => ({ ...m, [src]: null }));
            img.src = src;
        });
    }, [capas]);

    return mapa;
};

// Abre un archivo de imagen de la PC y devuelve { src, img, nombre }. La foto queda en memoria
// del navegador (no se sube al servidor).
export const abrirArchivoImagen = (file) => new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new Error('El archivo no es una imagen.')); return; }
    const src = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => resolve({ src, img, nombre: file.name });
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('No se pudo abrir esa imagen. Probá con JPG o PNG.')); };
    img.src = src;
});
