/**
 * datosTela.js — lee ancho, gramaje y composición del NOMBRE de una variante de tela, como están escritos
 * hoy en el WMS: "Panamá 1,60 m - 140 gsm - 100% Polyester", "Dry Voley MSO64 1,83 - 180 gsm -
 * 96% Polyester 4% Spandex", "Oxford 300D 1.60x200 m 135grs", "1,83". Solo PROPONE: el relleno muestra
 * lo que saldría antes de guardar (scripts/wmsRellenoTelas.js).
 */

// Ancho del rollo en metros: el primer número con decimales entre 0,5 y 5 ("1,60", "1.83", "1.60x200").
// Los códigos de modelo (MS089, TS079, 300D) no llevan coma decimal y no matchean. Una medida en cm
// ("150x85 cm") es de un producto terminado, no un ancho de rollo: se ignora el nombre entero.
function leerAncho(texto) {
    const t = String(texto || '');
    if (/\d+\s*x\s*\d+\s*cm/i.test(t)) return null;
    for (const m of t.matchAll(/(?<![\d.,])(\d)[.,](\d{1,2})(?!\d)/g)) {
        const n = Number(`${m[1]}.${m[2]}`);
        if (n >= 0.5 && n <= 5) return n;
    }
    return null;
}

// Gramaje en g/m²: número seguido de gsm, grs, gr o g/m2 ("140 gsm", "135 GSM", "135grs").
function leerGramaje(texto) {
    const m = String(texto || '').match(/(\d{2,4})\s*(?:gsm|grs?\b|g\/m2|g\/m²)/i);
    return m ? Number(m[1]) : null;
}

// Composición: "96% Polyester 4% Spandex" → "96% Polyester, 4% Spandex" (material con mayúscula
// inicial, sin traducir). `suma` permite marcar las que no llegan a 100 %.
function leerComposicion(texto) {
    const partes = [...String(texto || '').matchAll(/(\d{1,3})\s*%\s*([A-Za-zÁÉÍÓÚÜáéíóúüÑñ]+)/g)];
    if (!partes.length) return { composicion: null, suma: null };
    return {
        composicion: partes.map(m => `${m[1]}% ${m[2].charAt(0).toUpperCase()}${m[2].slice(1).toLowerCase()}`).join(', '),
        suma: partes.reduce((a, m) => a + Number(m[1]), 0),
    };
}

function leerDatosTela(nombre) {
    const { composicion, suma } = leerComposicion(nombre);
    return { ancho: leerAncho(nombre), gramaje: leerGramaje(nombre), composicion, sumaComposicion: suma };
}

// Color que en realidad es un resto del nombre: lleva números, porcentaje o "gsm" ("1,60 M",
// "PRO 1,83", "GSM - 100% POLYESTER"). Lo dejó la deducción automática de ejes de la tienda.
const colorSospechoso = (color) => !!color && /\d|%|gsm/i.test(String(color));

module.exports = { leerDatosTela, leerAncho, leerGramaje, leerComposicion, colorSospechoso };
