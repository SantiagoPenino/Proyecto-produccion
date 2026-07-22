/**
 * backfill_ordcodigoorden_detalle.js
 *
 * Recupera DocumentosContablesDetalle.OrdCodigoOrden cuando está NULL/vacío,
 * parseando el código de orden desde el texto libre de DcdDscItem/DcdNomItem
 * (ej. 'Orden: DTF-4761 (javier)...' o 'DF-102059 - LOBAS').
 *
 * Verificado contra la base local: recupera el 95.9% de los casos vacíos (3379
 * de 3522 líneas de Factura/Ticket/Pedidos Caja no anuladas).
 *
 * Por defecto corre en modo DRY-RUN (solo muestra qué actualizaría, no escribe
 * nada). Pasar --apply para ejecutar el UPDATE de verdad.
 *
 * Uso:
 *   node backend/scripts/backfill_ordcodigoorden_detalle.js            (preview)
 *   node backend/scripts/backfill_ordcodigoorden_detalle.js --apply    (ejecuta)
 */
'use strict';

const { getPool, sql } = require('../config/db');

const APPLY = process.argv.includes('--apply');

// Mismo patrón de prefijo que contabilidadReportesController.js: letras + guión + dígitos.
// Case-insensitive: hay códigos reales guardados en minúscula (ej. 'sb-66284').
const RE_ORDEN = /\b([A-Za-z]{2,7}-\d{2,7})\b/;

(async () => {
    const pool = await getPool();

    const result = await pool.request().query(`
        SELECT dcd.DcdIdDetalle, dcd.DcdNomItem, dcd.DcdDscItem
        FROM dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
        JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = dcd.DocIdDocumento
        WHERE (dcd.OrdCodigoOrden IS NULL OR LTRIM(RTRIM(dcd.OrdCodigoOrden)) = '')
          AND (
            (dc.DocTipo LIKE '%Factura%' OR dc.DocTipo LIKE '%Ticket%') AND dc.DocTipo NOT LIKE '%Nota%'
            OR RTRIM(dc.DocTipo) = 'Pedidos Caja'
          )
          AND dc.DocEstado <> 'ANULADO'
    `);

    const candidatos = [];
    for (const row of result.recordset) {
        const texto = `${row.DcdDscItem || ''} ${row.DcdNomItem || ''}`;
        const m = texto.match(RE_ORDEN);
        if (m) candidatos.push({ DcdIdDetalle: row.DcdIdDetalle, codigo: m[1] });
    }

    console.log(`Total líneas sin OrdCodigoOrden: ${result.recordset.length}`);
    console.log(`Recuperables por texto: ${candidatos.length} (${(candidatos.length / result.recordset.length * 100).toFixed(1)}%)`);

    if (!APPLY) {
        console.log('\n[DRY-RUN] Nada se escribió. Primeros 20 ejemplos de lo que se actualizaría:');
        console.table(candidatos.slice(0, 20));
        console.log('\nCorré con --apply para ejecutar el UPDATE.');
        process.exit(0);
    }

    console.log('\n[APLICANDO] Actualizando en lotes...');
    let actualizados = 0;
    for (const c of candidatos) {
        await pool.request()
            .input('id', sql.Int, c.DcdIdDetalle)
            .input('codigo', sql.VarChar(50), c.codigo)
            .query(`UPDATE dbo.DocumentosContablesDetalle
                     SET OrdCodigoOrden = @codigo
                     WHERE DcdIdDetalle = @id
                       AND (OrdCodigoOrden IS NULL OR LTRIM(RTRIM(OrdCodigoOrden)) = '')`);
        actualizados++;
        if (actualizados % 500 === 0) console.log(`  ${actualizados}/${candidatos.length}...`);
    }
    console.log(`Listo. ${actualizados} líneas actualizadas.`);
    process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
