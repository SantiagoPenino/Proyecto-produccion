// Achica fotos antes de subirlas (las del celular pesan 3-6 MB y el servidor tiene poco disco).
// Lado mayor 1920 px, JPEG 82 %. Si algo falla (ej. HEIC en Chrome) o no achica, sube el original.
export async function comprimirImagen(file, { maxLado = 1920, calidad = 0.82, minBytes = 700 * 1024 } = {}) {
    if (!file?.type?.startsWith('image/') || file.type === 'image/gif' || file.size < minBytes) return file;
    try {
        const bitmap = await createImageBitmap(file); // respeta la orientación EXIF
        const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
        const w = Math.round(bitmap.width * escala);
        const h = Math.round(bitmap.height * escala);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
        if (bitmap.close) bitmap.close();
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', calidad));
        if (!blob || blob.size >= file.size) return file;
        const nombre = `${(file.name || 'foto').replace(/\.[^.]+$/, '')}.jpg`;
        return new File([blob], nombre, { type: 'image/jpeg', lastModified: Date.now() });
    } catch (_) {
        return file;
    }
}
