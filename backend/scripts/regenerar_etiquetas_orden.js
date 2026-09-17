/**
 * regenerar_etiquetas_orden.js — ESCRIBE EN LA BASE (crea etiquetas y bultos)
 * ---------------------------------------------------------------------------
 * Genera las etiquetas de UNA orden que quedó "Pronta" sin etiqueta. La pantalla de
 * control no las regenera en órdenes ya terminadas (protección a propósito), así que
 * las que se completaron antes del arreglo quedan sin bulto y no se pueden despachar.
 *
 * Caso típico: trabajo interno de un pedido con PRO (DTF/Bordado/Estampado de una prenda
 * comprada o fabricada) completado cuando todavía se exigía cantidad cotizada propia.
 *
 * Usa el mismo LabelGenerationService que la pantalla: mismas validaciones, mismos códigos.
 * Si la orden YA tiene etiquetas no hace nada (para no descalzar códigos de bultos que
 * quizás ya se imprimieron).
 *
 * Uso:   node backend/scripts/regenerar_etiquetas_orden.js 23980
 */
const { getPool, sql } = require('../config/db');
const LabelGenerationService = require('../services/LabelGenerationService');

const ordenId = parseInt(process.argv[2], 10);
if (!ordenId) {
    console.error('Falta el OrdenID. Ej: node backend/scripts/regenerar_etiquetas_orden.js 23980');
    process.exit(1);
}

(async () => {
    const pool = await getPool();
    const o = (await pool.request().input('id', sql.Int, ordenId)
        .query(`SELECT LTRIM(RTRIM(CodigoOrden)) AS Cod, EstadoenArea, ProximoServicio,
                       (SELECT COUNT(*) FROM Etiquetas WHERE OrdenID = @id) AS Etiquetas
                FROM Ordenes WHERE OrdenID = @id`)).recordset[0];
    if (!o) { console.error(`No existe la orden ${ordenId}.`); process.exit(1); }

    console.log(`Orden ${o.Cod} — estado en área: ${o.EstadoenArea}, próximo servicio: ${o.ProximoServicio}`);
    if (o.Etiquetas > 0) {
        console.log(`Ya tiene ${o.Etiquetas} etiqueta(s). No se regenera nada.`);
        process.exit(0);
    }

    const r = await LabelGenerationService.regenerateLabelsForOrder(ordenId, 1, 'Script regenerar_etiquetas_orden');
    if (!r.success) {
        console.error(`No se generaron: ${r.error}`);
        process.exit(1);
    }
    const et = (await pool.request().input('id', sql.Int, ordenId)
        .query(`SELECT CodigoEtiqueta FROM Etiquetas WHERE OrdenID = @id ORDER BY NumeroBulto`)).recordset;
    console.log(`Listo: ${r.totalBultos} bulto(s) → ${et.map(e => e.CodigoEtiqueta).join(', ')}`);
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
