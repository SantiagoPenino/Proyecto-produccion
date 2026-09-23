/**
 * wmsRellenoTelas.js — completa la ficha de las telas del WMS (ancho, gramaje, composición) leyendo lo
 * que ya está escrito en el nombre de cada variante, y limpia los colores que son restos del nombre.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Por qué: al 22/09 ninguna de las 80 variantes de la familia TELAS tenía ancho ni gramaje en sus
 * campos (estaban solo en el nombre), así que /stock no podía pasar kilos a metros en ninguna.
 *
 *   node scripts/wmsRellenoTelas.js                    → SOLO MUESTRA lo que propondría (no escribe)
 *   node scripts/wmsRellenoTelas.js --csv=ruta.csv     → además deja la propuesta en un CSV para revisar
 *   node scripts/wmsRellenoTelas.js --aplicar          → guarda
 *
 * Reglas: completa SOLO campos vacíos (nunca pisa algo cargado a mano), así se puede correr cuantas
 * veces haga falta. El color sospechoso se deja en '' y no en NULL: el import rellena los NULL desde
 * el catálogo de la tienda y lo volvería a traer. El import no toca ancho, gramaje ni composición.
 * En producción las tablas Wms_* están vacías hasta el cutover: correrlo DESPUÉS de la carga final.
 */
const fs = require('fs');
const { getPool, sql } = require('../config/db');
const { asegurarColumnasTela } = require('../services/wmsInternoService');
const { leerDatosTela, colorSospechoso } = require('../utils/datosTela');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
}));

const fmt = (n) => (n == null ? '' : String(n).replace('.', ','));

async function main() {
    const pool = await getPool();
    await asegurarColumnasTela(pool);
    const filas = (await pool.request().query(`
        SELECT v.VarId, LTRIM(RTRIM(pm.Nombre)) AS Producto, LTRIM(RTRIM(v.NombreVariante)) AS Variante,
               pm.UnidadBase, v.AnchoMetros, v.GramajeGsm, v.Composicion, v.Color
        FROM dbo.Wms_Variantes v
        JOIN dbo.Wms_ProductosMaestros pm ON pm.PmaId = v.PmaId
        JOIN dbo.Wms_Categorias c ON c.CatId = pm.CatId
        WHERE c.Nombre LIKE 'TELA%'
        ORDER BY pm.Nombre, v.VarId`)).recordset;

    const propuestas = filas.map(f => {
        const d = leerDatosTela(f.Variante);
        const p = {
            ...f,
            ancho: f.AnchoMetros == null ? d.ancho : null,
            gramaje: f.GramajeGsm == null ? d.gramaje : null,
            composicion: f.Composicion == null ? d.composicion : null,
            limpiarColor: colorSospechoso(f.Color),
            notas: [],
        };
        if (d.sumaComposicion != null && d.sumaComposicion !== 100) p.notas.push(`la composición suma ${d.sumaComposicion} %`);
        if (f.UnidadBase === 'kg' && (f.AnchoMetros ?? p.ancho) != null && (f.GramajeGsm ?? p.gramaje) == null) {
            p.notas.push('sin gramaje: no alcanza para pasar kilos a metros');
        }
        if ((f.AnchoMetros ?? p.ancho) == null) p.notas.push('no se encontró el ancho en el nombre');
        return p;
    });

    const cambia = (p) => p.ancho != null || p.gramaje != null || p.composicion != null || p.limpiarColor;
    const conCambios = propuestas.filter(cambia);
    const cuenta = (k) => propuestas.filter(p => (k === 'limpiarColor' ? p.limpiarColor : p[k] != null)).length;

    console.log(`\nVariantes de tela: ${filas.length} | con algo para completar: ${conCambios.length}`);
    console.log(`  ancho: ${cuenta('ancho')} · gramaje: ${cuenta('gramaje')} · composición: ${cuenta('composicion')} · colores a limpiar: ${cuenta('limpiarColor')}`);
    const kgConMetros = propuestas.filter(p => p.UnidadBase === 'kg'
        && (p.AnchoMetros ?? p.ancho) != null && (p.GramajeGsm ?? p.gramaje) != null).length;
    const kg = propuestas.filter(p => p.UnidadBase === 'kg').length;
    console.log(`  telas por kilo que quedarían con conversión a metros: ${kgConMetros} de ${kg}\n`);

    for (const p of propuestas) {
        const partes = [];
        if (p.ancho != null) partes.push(`ancho ${fmt(p.ancho)} m`);
        if (p.gramaje != null) partes.push(`${p.gramaje} g/m²`);
        if (p.composicion != null) partes.push(p.composicion);
        if (p.limpiarColor) partes.push(`color "${p.Color}" → vacío`);
        const nota = p.notas.length ? `   ⚠ ${p.notas.join('; ')}` : '';
        console.log(`${String(p.VarId).padStart(4)}  ${p.Producto.slice(0, 22).padEnd(22)} ${p.Variante.slice(0, 44).padEnd(44)} → ${partes.join(' · ') || '(nada)'}${nota}`);
    }

    if (args.csv) {
        const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lineas = [['VarId', 'Producto', 'Variante', 'Unidad', 'Ancho (m)', 'Gramaje (g/m²)', 'Composición', 'Color actual', 'Color propuesto', 'Notas'].map(q).join(';')];
        for (const p of propuestas) {
            lineas.push([p.VarId, p.Producto, p.Variante, p.UnidadBase,
                fmt(p.AnchoMetros ?? p.ancho), p.GramajeGsm ?? p.gramaje ?? '', p.Composicion ?? p.composicion ?? '',
                p.Color ?? '', p.limpiarColor ? '(vacío)' : (p.Color ?? ''), p.notas.join('; ')].map(q).join(';'));
        }
        fs.writeFileSync(String(args.csv), '﻿' + lineas.join('\r\n'), 'utf8');
        console.log(`\nPropuesta guardada en ${args.csv}`);
    }

    if (!args.aplicar) {
        console.log('\nNo se escribió nada. Para guardar: --aplicar');
        process.exit(0);
    }

    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        for (const p of conCambios) {
            await new sql.Request(tran)
                .input('V', sql.Int, p.VarId)
                .input('A', sql.Decimal(6, 3), p.ancho)
                .input('G', sql.Decimal(8, 2), p.gramaje)
                .input('Comp', sql.NVarChar(200), p.composicion)
                .input('L', sql.Bit, p.limpiarColor ? 1 : 0)
                // COALESCE sobre la columna: aunque alguien la haya cargado entre la vista previa y esto,
                // un valor existente nunca se pisa.
                .query(`UPDATE dbo.Wms_Variantes SET
                            AnchoMetros = COALESCE(AnchoMetros, @A),
                            GramajeGsm  = COALESCE(GramajeGsm, @G),
                            Composicion = COALESCE(Composicion, @Comp),
                            Color = CASE WHEN @L = 1 THEN '' ELSE Color END
                        WHERE VarId = @V`);
        }
        await tran.commit();
        console.log(`\nGuardado: ${conCambios.length} variantes actualizadas.`);
        process.exit(0);
    } catch (e) {
        try { await tran.rollback(); } catch (_) { /* ya revertida */ }
        throw e;
    }
}

main().catch(e => { console.error('ERROR (no se guardó nada):', e.message); process.exit(1); });
