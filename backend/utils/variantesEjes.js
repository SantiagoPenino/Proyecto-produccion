// [VARIANTES 21/08] Derivación de ejes Talle/Color desde los nombres de variante del WMS.
//
// Largo plazo, la ficha de la tienda lee Talle/Color como DATOS de Articulos_WMS_Variantes
// (columnas nullable: Talle NULL = talle único, Color NULL = sin eje de color). Este módulo
// es el que los llena automáticamente a partir del nombre — al sincronizar variantes nuevas
// y al abrir un producto en /marketing/productos — y marketing corrige a mano lo que no
// parsea. La heurística es la misma que usaba el front (TiendaView), más el caso solo-color:
//
//   · "Short 2XL AZUL FRANCIA"  → Talle '2XL',  Color 'AZUL FRANCIA'  (ancla en el talle)
//   · "Gorro de lana Negro"     → sin talle → se recorta el PREFIJO COMÚN de todas las
//     variantes del producto ("Gorro de lana ") y lo que resta es el color ('NEGRO').
//
// Reglas: se deriva por PRODUCTO (el prefijo común necesita todas las variantes juntas), y
// si una variante no se puede resolver queda NULL/NULL (la ficha cae a la lista plana).

const TALLES_CONOCIDOS = new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL', '5XL', '6XL']);

// Parse individual anclado en talle: talle = primer token del set conocido (o numérico,
// talles de niño tipo 14/16); color = todo lo que sigue.
function parsePorTalle(nombre) {
    const tokens = String(nombre || '').trim().toUpperCase().split(/\s+/);
    const i = tokens.findIndex((t, idx) => {
        if (!(TALLES_CONOCIDOS.has(t) || /^\d{1,3}$/.test(t))) return false;
        // "TOALLA 1,60 m": la M de METROS no es un talle — se ignora la M/L que viene
        // inmediatamente después de una medida decimal.
        if ((t === 'M' || t === 'L') && idx > 0 && /^\d+[.,]\d+$/.test(tokens[idx - 1])) return false;
        return true;
    });
    if (i < 0) return null;
    return { talle: tokens[i], color: tokens.slice(i + 1).join(' ') || null };
}

// Prefijo común (por PALABRAS enteras, case-insensitive) de una lista de nombres.
function prefijoComunPalabras(nombres) {
    const listas = nombres.map(n => String(n || '').trim().split(/\s+/));
    if (!listas.length) return 0;
    let comun = 0;
    for (let i = 0; ; i++) {
        const palabra = listas[0][i];
        if (palabra == null) break;
        if (!listas.every(l => (l[i] || '').toUpperCase() === palabra.toUpperCase())) break;
        comun = i + 1;
    }
    return comun; // cantidad de palabras comunes al inicio
}

/**
 * Deriva Talle/Color para TODAS las variantes de un producto.
 * @param {Array<{id?:number, nombre_variante:string}>} variantes
 * @returns {Array<{id?:number, nombre_variante:string, Talle:string|null, Color:string|null}>}
 */
function derivarEjesProducto(variantes) {
    const lista = (variantes || []).filter(v => v && v.nombre_variante);
    if (!lista.length) return [];

    // 1. Intento por talle: vale solo si TODAS las variantes parsean (misma regla que el front:
    //    un eje a medias confunde más de lo que ayuda).
    const porTalle = lista.map(v => ({ v, p: parsePorTalle(v.nombre_variante) }));
    if (porTalle.every(x => x.p)) {
        return porTalle.map(x => ({ ...x.v, Talle: x.p.talle, Color: x.p.color }));
    }

    // 2. Solo-color por prefijo común: si ninguna variante tiene talle reconocible y hay más
    //    de una, el resto tras el prefijo común es el color. Se exige que el prefijo deje un
    //    resto NO vacío en todas (si una variante ES el prefijo pelado, no hay eje limpio).
    if (lista.length > 1 && porTalle.every(x => !x.p)) {
        const comun = prefijoComunPalabras(lista.map(v => v.nombre_variante));
        if (comun > 0) {
            const restos = lista.map(v =>
                String(v.nombre_variante).trim().split(/\s+/).slice(comun).join(' ').toUpperCase() || null);
            if (restos.every(Boolean)) {
                return lista.map((v, i) => ({ ...v, Talle: null, Color: restos[i] }));
            }
        }
    }

    // 3. Sin resolución automática: queda NULL/NULL (marketing puede cargarlo a mano).
    return lista.map(v => ({ ...v, Talle: null, Color: null }));
}

/**
 * Completa Talle/Color de los productos indicados, SOLO en variantes que aún no tienen
 * ninguno de los dos (NULL/NULL) — una corrección manual nunca se pisa. Best-effort por
 * producto: un fallo (p. ej. columnas aún no creadas) se loguea y no corta el resto.
 * Para usar tras los syncs/imports que insertan variantes nuevas.
 */
async function completarEjesFaltantes(pool, idproids) {
    const { sql } = require('../config/db');
    const logger = require('./logger');
    const ids = [...new Set((idproids || []).filter(Boolean))];
    for (const pid of ids) {
        try {
            const r = await pool.request().input('Id', sql.Int, pid)
                .query('SELECT id, nombre_variante, Talle, Color FROM dbo.Articulos_WMS_Variantes WHERE Idproid = @Id');
            const vars = r.recordset;
            if (!vars.length || !vars.some(v => v.Talle == null && v.Color == null)) continue;
            const derivadas = derivarEjesProducto(vars);
            for (const d of derivadas) {
                const orig = vars.find(v => v.id === d.id);
                if (!orig || orig.Talle != null || orig.Color != null) continue; // manual: no pisar
                if (d.Talle == null && d.Color == null) continue;
                await pool.request()
                    .input('VId', sql.Int, d.id)
                    .input('T', sql.VarChar(20), d.Talle)
                    .input('C', sql.VarChar(80), d.Color)
                    .query('UPDATE dbo.Articulos_WMS_Variantes SET Talle = @T, Color = @C WHERE id = @VId');
            }
        } catch (e) {
            logger.warn(`[VariantesEjes] Producto ${pid}: ${e.message}`);
        }
    }
}

module.exports = { derivarEjesProducto, parsePorTalle, TALLES_CONOCIDOS, completarEjesFaltantes };
