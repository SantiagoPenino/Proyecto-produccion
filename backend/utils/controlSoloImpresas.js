// Áreas donde en CONTROL solo se pueden controlar las órdenes ya tildadas como impresas
// (Ordenes.Impreso = 1).
//
// En el resto de las áreas un lote aparece en Control apenas arranca en la máquina y todas sus
// órdenes se controlan, impresas o no. En ECOUV (pedido 16/10/2026):
//  - el lote aparece en Control recién cuando tiene alguna orden tildada como impresa en el detalle
//    del lote (Planeación) — rollsController.getRollosActivos;
//  - Control muestra TODAS las órdenes del lote, pero las que todavía no se tildaron van bloqueadas
//    (columna SinImprimir de productionFileController.getOrdenes) y el servidor rechaza controlarlas.
//    Se muestran a propósito: con solo las impresas a la vista, la pantalla creía que el lote estaba
//    completo ("FINALIZAR LOTE COMPLETO", "Lote completado") cuando quedaban órdenes sin imprimir;
//  - al tildar, rollsController avisa por socket para que Control la habilite en el momento.
const { ESTADOS_AREA_FUERA_DE_LOTE } = require('../services/stateManagerService');

const AREAS_CONTROL_SOLO_IMPRESAS = ['ECOUV'];

const controlSoloImpresas = (area) =>
    AREAS_CONTROL_SOLO_IMPRESAS.includes(String(area || '').trim().toUpperCase());

/**
 * Expresión SQL: 1 si la orden (alias `o` de dbo.Ordenes) está en un área de esta lista y todavía no
 * se puede controlar por no estar tildada como impresa. Las que ya pasaron por Control (retenidas por
 * falla, prontas, despachadas) nunca quedan bloqueadas.
 */
const sqlSinImprimir = (o = 'O') => `CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(${o}.AreaID, '')))) IN (${AREAS_CONTROL_SOLO_IMPRESAS.map(a => `'${a}'`).join(',')})
        AND ISNULL(${o}.Impreso, 0) = 0
        AND ISNULL(${o}.EstadoenArea, '') <> 'Retenido'
        AND ISNULL(${o}.EstadoenArea, '') NOT IN ${ESTADOS_AREA_FUERA_DE_LOTE}
    THEN 1 ELSE 0 END`;

module.exports = { AREAS_CONTROL_SOLO_IMPRESAS, controlSoloImpresas, sqlSinImprimir };
