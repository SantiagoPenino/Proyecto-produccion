'use strict';

/**
 * regularizar-requisitos-historicos.js
 * ---------------------------------------------------------------------------
 * El motor de requisitos bloqueantes (ConfigRequisitosProduccion +
 * OrdenCumplimientoRequisitos) exigía el mismo requisito a TODA orden de un
 * área sin importar si esa orden puntual realmente lo necesitaba. Se corrigió
 * para que las órdenes NUEVAS marquen "no aplica" desde el alta (ver
 * backend/utils/requisitosAutoCumplimiento.js y los controllers que crean
 * órdenes) — este script aplica la MISMA lógica de decisión, retroactivamente,
 * a las órdenes que ya quedaron bloqueadas antes del fix.
 *
 * Reglas (una por área, replican exactamente el criterio del código en vivo):
 *   - SB  (Sublimación): con BobinaTelaID -> ya tiene tela de cliente, se marca
 *                         CUMPLIDO igual (el auto-cumplido en vivo puede haber
 *                         fallado por otro motivo). Sin BobinaTelaID -> "no
 *                         aplica", material propio de la empresa.
 *   - TWC (Corte): con BobinaTelaID -> mismo tratamiento que SB. Sin bobina:
 *                  NO se auto-aplica nada — a diferencia de SB, "sin bobina"
 *                  en Corte no implica de forma confiable "material propio"
 *                  (podría ser un traspaso desde Sublimación roto). Queda
 *                  listada para revisión manual.
 *   - EST (Estampado): busca hermanas por NoDocERP en DF / TPU / EMB-PRO.
 *                       Exactamente UN canal presente -> se marcan "no aplica"
 *                       los otros 2 códigos (PRENDA/DTF/TPU). Cero o más de
 *                       un canal -> ambiguo, queda para revisión manual.
 *
 * Seguridad:
 *   - Dry-run por defecto: solo lista qué tocaría, no escribe nada.
 *   - Solo aplica con la bandera --apply.
 *   - --area SB|TWC|EST filtra a una sola área (default: las 3).
 *   - Todo dentro de una transacción.
 *   - SOLO contra la base configurada en .env — nunca apuntar esto a
 *     producción desde acá; correr primero contra la réplica local para
 *     dimensionar el impacto y decidir con el resto del equipo.
 *
 * Uso:
 *   node backend/scripts/regularizar-requisitos-historicos.js                  # dry-run, las 3 áreas
 *   node backend/scripts/regularizar-requisitos-historicos.js --area SB        # dry-run, solo SB
 *   node backend/scripts/regularizar-requisitos-historicos.js --area SB --apply
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const sql = require('mssql');
const { marcarRequisitoNoAplica } = require('../utils/requisitosAutoCumplimiento');

const APPLY = process.argv.includes('--apply');
const areaIdx = process.argv.indexOf('--area');
const AREA_FILTER = areaIdx !== -1 ? String(process.argv[areaIdx + 1] || '').toUpperCase() : null;

const incluye = (area) => !AREA_FILTER || AREA_FILTER === area;

// Órdenes de un área con algún requisito bloqueante sin CUMPLIR — misma condición
// que ya usan planificacionController.js / embBoardController.js.
const QUERY_BLOQUEADAS = (area, camposExtra = '') => `
    SELECT o.OrdenID, o.CodigoOrden, o.NoDocERP ${camposExtra}
    FROM dbo.Ordenes o
    WHERE o.AreaID = '${area}' AND o.FechaPronto IS NULL AND ISNULL(o.Estado, '') <> 'Cancelado'
      AND EXISTS (
          SELECT 1 FROM ConfigRequisitosProduccion req
          WHERE req.AreaID = '${area}' AND req.EsBloqueante = 1
            AND NOT EXISTS (
                SELECT 1 FROM OrdenCumplimientoRequisitos cum
                WHERE cum.OrdenID = o.OrdenID AND cum.RequisitoID = req.RequisitoID AND cum.Estado = 'CUMPLIDO'
            )
      )
`;

async function main() {
    const pool = await sql.connect({
        server: process.env.DB_SERVER,
        database: process.env.DB_DATABASE,
        user: (process.env.DB_USER || '').trim(),
        password: process.env.DB_PASSWORD,
        options: { encrypt: false, trustServerCertificate: true },
    });

    console.log(`Conectado a ${process.env.DB_SERVER} / ${process.env.DB_DATABASE}`);

    // --- Candidatos, un array de { area, ordenId, codigoOrden, codigoRequisito, exact, observaciones } por acción a aplicar
    const aplicables = [];
    // --- Casos que NO se auto-aplican, solo se listan para revisión manual
    const manuales = [];

    if (incluye('SB')) {
        const r = await pool.request().query(QUERY_BLOQUEADAS('SB', ', o.BobinaTelaID'));
        for (const o of r.recordset) {
            aplicables.push({
                area: 'SB', ordenId: o.OrdenID, codigoOrden: o.CodigoOrden,
                codigoRequisito: 'TELA', exact: false,
                observaciones: o.BobinaTelaID
                    ? 'Tela de cliente ya usada (regularización histórica)'
                    : 'No aplica — material propio (regularización histórica)'
            });
        }
    }

    if (incluye('TWC')) {
        const r = await pool.request().query(QUERY_BLOQUEADAS('TWC', ', o.BobinaTelaID'));
        for (const o of r.recordset) {
            if (o.BobinaTelaID) {
                aplicables.push({
                    area: 'TWC', ordenId: o.OrdenID, codigoOrden: o.CodigoOrden,
                    codigoRequisito: 'TELA', exact: false,
                    observaciones: 'Tela de cliente ya usada (regularización histórica)'
                });
            } else {
                manuales.push({ area: 'TWC', ordenId: o.OrdenID, codigoOrden: o.CodigoOrden, motivo: 'Sin bobina — puede ser traspaso de Sublimación sin resolver, revisar a mano' });
            }
        }
    }

    if (incluye('EST')) {
        const r = await pool.request().query(`
            SELECT o.OrdenID, o.CodigoOrden, o.NoDocERP,
                (SELECT COUNT(*) FROM dbo.Ordenes h WHERE RTRIM(h.NoDocERP) = RTRIM(o.NoDocERP) AND h.AreaID = 'DF' AND h.OrdenID <> o.OrdenID) AS HermanasDF,
                (SELECT COUNT(*) FROM dbo.Ordenes h WHERE RTRIM(h.NoDocERP) = RTRIM(o.NoDocERP) AND h.AreaID = 'TPU' AND h.OrdenID <> o.OrdenID) AS HermanasTPU,
                (SELECT COUNT(*) FROM dbo.Ordenes h WHERE RTRIM(h.NoDocERP) = RTRIM(o.NoDocERP) AND h.AreaID IN ('EMB', 'PRO') AND h.OrdenID <> o.OrdenID) AS HermanasPrenda
            FROM dbo.Ordenes o
            WHERE o.AreaID = 'EST' AND o.FechaPronto IS NULL AND ISNULL(o.Estado, '') <> 'Cancelado'
              AND EXISTS (
                  SELECT 1 FROM ConfigRequisitosProduccion req
                  WHERE req.AreaID = 'EST' AND req.EsBloqueante = 1
                    AND NOT EXISTS (
                        SELECT 1 FROM OrdenCumplimientoRequisitos cum
                        WHERE cum.OrdenID = o.OrdenID AND cum.RequisitoID = req.RequisitoID AND cum.Estado = 'CUMPLIDO'
                    )
              )
        `);
        for (const o of r.recordset) {
            const canales = [];
            if (o.HermanasDF > 0) canales.push('DTF');
            if (o.HermanasTPU > 0) canales.push('TPU');
            if (o.HermanasPrenda > 0) canales.push('PRENDA');
            if (canales.length === 1) {
                const canalReal = canales[0];
                for (const cod of ['PRENDA', 'DTF', 'TPU']) {
                    if (cod === canalReal) continue;
                    aplicables.push({
                        area: 'EST', ordenId: o.OrdenID, codigoOrden: o.CodigoOrden,
                        codigoRequisito: cod, exact: true,
                        observaciones: `No aplica — el canal real de este Estampado es ${canalReal} (regularización histórica)`
                    });
                }
            } else {
                manuales.push({
                    area: 'EST', ordenId: o.OrdenID, codigoOrden: o.CodigoOrden,
                    motivo: canales.length === 0 ? 'Sin ninguna hermana DF/TPU/EMB/PRO reconocible' : `Ambiguo — ${canales.length} canales posibles (${canales.join(', ')})`
                });
            }
        }
    }

    console.log(`\n=== Se marcarían CUMPLIDO (${aplicables.length} filas en OrdenCumplimientoRequisitos) ===`);
    if (aplicables.length) {
        console.table(aplicables.map(a => ({ Area: a.area, OrdenID: a.ordenId, CodigoOrden: a.codigoOrden, Requisito: a.codigoRequisito, Observaciones: a.observaciones })));
    } else {
        console.log('Ninguna.');
    }

    console.log(`\n=== Quedan para revisión MANUAL, no se tocan (${manuales.length}) ===`);
    if (manuales.length) {
        console.table(manuales.map(m => ({ Area: m.area, OrdenID: m.ordenId, CodigoOrden: m.codigoOrden, Motivo: m.motivo })));
    } else {
        console.log('Ninguna.');
    }

    if (!APPLY) {
        console.log('\n*** DRY-RUN: no se escribió nada. Volvé a correr con --apply para aplicar. ***\n');
        await pool.close();
        return;
    }

    if (!aplicables.length) {
        console.log('\nNada para aplicar.\n');
        await pool.close();
        return;
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        let aplicados = 0;
        for (const a of aplicables) {
            const ok = await marcarRequisitoNoAplica(tx, {
                ordenId: a.ordenId, areaId: a.area, codigoRequisito: a.codigoRequisito,
                exact: a.exact, observaciones: a.observaciones
            });
            if (ok) aplicados++;
        }
        await tx.commit();
        console.log(`\n*** APLICADO: ${aplicados} requisito(s) marcado(s) CUMPLIDO. ***\n`);
    } catch (e) {
        await tx.rollback();
        throw e;
    }

    await pool.close();
}

main().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
});
