// Identidad de un archivo elegido en el formulario, por OBJETO y no por nombre + tamaño: el mismo
// archivo subido dos veces son dos entradas distintas, cada una con sus copias y sus prendas.
// Con nombre + tamaño las dos compartían la clave y cambiar las copias de una cambiaba la otra.
const ids = new WeakMap();
let ultimo = 0;

export const idArchivo = (f) => {
    if (!f || typeof f !== 'object') return '';
    if (!ids.has(f)) ids.set(f, `arch-${++ultimo}`);
    return ids.get(f);
};
