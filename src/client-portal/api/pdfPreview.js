// Rasterizado de la 1ª página de un PDF, con caché COMPARTIDO por archivo.
//
// Por qué existe: el mismo PDF se rasterizaba dos veces por pantalla — una en FileUploadZone
// (miniatura de la tarjeta) y otra en OrderForm (miniatura del croquis del plano). Con los artes
// de sublimación (tiras de hasta 22 m con decenas de imágenes de alta resolución adentro), medido
// con el profiler de Chrome, `drawImage` dentro de pdf.js se llevaba ~1.240 ms del hilo principal,
// y la mitad de eso era el MISMO trabajo hecho dos veces.
//
// Acá se hace una sola vez por archivo y los dos consumidores comparten el resultado.

const cache = new Map(); // clave -> Promise<string|null> (objectURL del PNG)

// Clave por identidad del archivo, no por referencia del objeto: el formulario recrea los objetos
// en cada cambio de estado, pero el File de adentro sigue siendo el mismo.
const claveDe = (file, ladoMayorPx) =>
    `${file.name}|${file.size}|${file.lastModified || 0}|${ladoMayorPx}`;

/**
 * Rasteriza la 1ª página del PDF a `ladoMayorPx` y devuelve un objectURL (o null si falla).
 * Si ya se rasterizó ese mismo archivo a esa medida, devuelve el que ya existe sin volver a abrirlo.
 */
export const rasterizarPdf = (file, ladoMayorPx = 600) => {
    const clave = claveDe(file, ladoMayorPx);
    const enCurso = cache.get(clave);
    if (enCurso) return enCurso;

    const tarea = (async () => {
        let pdf = null, page = null, canvas = null;
        try {
            const pdfjsLib = await import('pdfjs-dist');
            // Guard: si nadie configuró el worker todavía, pdf.js muere con
            // 'No "GlobalWorkerOptions.workerSrc" specified'. Normalmente lo deja seteado
            // fileService al importarse, pero no hay que depender de ese orden de carga.
            if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
                const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
                pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;
            }
            const buf = await file.arrayBuffer();
            pdf = await pdfjsLib.getDocument({ data: buf }).promise;
            page = await pdf.getPage(1);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: ladoMayorPx / Math.max(base.width, base.height) });
            canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            // background transparente: pdf.js RELLENA de BLANCO por defecto y eso tapaba la
            // transparencia real del arte (en DTF el diseño va sobre film transparente).
            await page.render({
                canvasContext: canvas.getContext('2d'),
                viewport,
                background: 'rgba(0,0,0,0)',
            }).promise;
            // toBlob y no toDataURL: codificar a base64 es sincrónico y bloquea el hilo principal.
            const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
            return blob ? URL.createObjectURL(blob) : null;
        } catch (e) {
            console.warn('[pdfPreview] No se pudo rasterizar el PDF:', e);
            cache.delete(clave); // que un fallo puntual no quede cacheado para siempre
            return null;
        } finally {
            // Soltar el documento y su buffer: sin esto cada archivo queda parseado dentro del
            // worker de pdf.js hasta recargar la página.
            try { page?.cleanup?.(); } catch { /* noop */ }
            try { await pdf?.destroy?.(); } catch { /* noop */ }
            if (canvas) { canvas.width = 0; canvas.height = 0; }
        }
    })();

    cache.set(clave, tarea);
    return tarea;
};

/** Revoca todos los objectURL y vacía el caché. Se llama al salir del formulario. */
export const liberarPdfPreviews = async () => {
    const tareas = [...cache.values()];
    cache.clear();
    for (const t of tareas) {
        try { const url = await t; if (url) URL.revokeObjectURL(url); } catch { /* noop */ }
    }
};
