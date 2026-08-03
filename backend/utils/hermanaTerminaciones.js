// Hermana contenedora de terminaciones (área TERMINAC).
// La orden ECOUV imprime; sus terminaciones viven en una orden hermana XEUV-{doc}
// que se trabaja en el área TERMINAC (bandeja + planilla). Se crea DESDE EL INGRESO
// del pedido web (pedido negocio 28/07 — antes se creaba al aprobar control; ese
// llamado sigue vivo como red de seguridad para órdenes anteriores al cambio).
const { sql } = require('../config/db');
const logger = require('./logger');

/**
 * Crea (si no existe) la orden hermana TERMINAC de una orden ECOUV y repunta
 * las OrdenTerminaciones hacia ella. Idempotente: si la orden no tiene
 * terminaciones o ya hay hermana viva, no hace nada y devuelve null.
 * @param {object} transaction transacción sql activa
 * @param {number} ecouvId OrdenID de la orden ECOUV
 * @returns {Promise<{hermanaId:number, codigo:string, cantTerm:number}|null>}
 */
async function crearHermanaTerminaciones(transaction, ecouvId) {
    const src = await new sql.Request(transaction)
        .input('OID', sql.Int, ecouvId)
        .query('SELECT TOP 1 * FROM Ordenes WHERE OrdenID = @OID');
    const o = src.recordset[0];
    if (!o) return null;

    // Sin terminaciones no hay hermana
    const cnt = await new sql.Request(transaction)
        .input('OID', sql.Int, ecouvId)
        .query('SELECT COUNT(*) AS C FROM OrdenTerminaciones WHERE OrdenID = @OID');
    const cantTerm = cnt.recordset[0]?.C || 0;
    if (cantTerm === 0) return null;

    // Guard anti-duplicado (reproceso): si ya existe hermana viva de esta orden, no crear otra.
    // OJO: los corchetes del marcador son clase de caracteres en LIKE — van escapados,
    // si no el guard matchea la hermana de CUALQUIER otro pedido y no crea la propia.
    const ya = await new sql.Request(transaction)
        .input('Nota', sql.NVarChar(200), `%![TERMINACIONES DE ${String(o.CodigoOrden || '').trim()}!]%`)
        .query("SELECT TOP 1 OrdenID FROM Ordenes WHERE AreaID = 'TERMINAC' AND Estado NOT IN ('Cancelado') AND Nota LIKE @Nota ESCAPE '!'");
    if (ya.recordset.length > 0) return null;

    // El código de la hermana espeja al de la madre: EUV-10987 (1/2) → XEUV-10987 (1/2).
    // Así se ve de un vistazo a qué orden de impresión pertenece, incluso cuando el
    // pedido tiene varias (multimaterial).
    const codMadre = String(o.CodigoOrden || '').trim();
    const docTrim = String(o.NoDocERP || ecouvId).trim();
    const baseCod = codMadre ? `X${codMadre}` : `XEUV-${docTrim}`;
    const dupCod = await new sql.Request(transaction)
        .input('Cod', sql.VarChar(60), baseCod)
        .query('SELECT COUNT(*) AS C FROM Ordenes WHERE LTRIM(RTRIM(CodigoOrden)) = @Cod');
    const codigoHermana = dupCod.recordset[0].C > 0 ? `${baseCod}(${dupCod.recordset[0].C + 1})` : baseCod;

    const insH = await new sql.Request(transaction)
        .input('Cliente', sql.NVarChar(200), o.Cliente)
        .input('CodCliente', sql.Int, o.CodCliente)
        .input('IdCliR', sql.VarChar(50), o.IdClienteReact != null ? String(o.IdClienteReact) : null)
        .input('Desc', sql.NVarChar(300), o.DescripcionTrabajo)
        .input('Prio', sql.VarChar(20), o.Prioridad || 'Normal')
        .input('FEE', sql.DateTime, o.FechaEstimadaEntrega)
        .input('Mat', sql.VarChar(255), o.Material)
        .input('Var', sql.VarChar(100), o.Variante)
        .input('Cod', sql.VarChar(50), codigoHermana)
        .input('Doc', sql.VarChar(50), o.NoDocERP)
        .input('Nota', sql.NVarChar(sql.MAX), `[TERMINACIONES DE ${String(o.CodigoOrden || '').trim()}]${o.Nota ? ' ' + o.Nota : ''}`)
        .input('Mag', sql.VarChar(50), String(cantTerm))
        .input('CliId', sql.Int, o.CliIdCliente)
        // Forma de envío del pedido: el taller de terminaciones también necesita saber
        // si el trabajo se retira, va por encomienda o a domicilio.
        .input('ModoRet', sql.VarChar(100), o.ModoRetiro || null)
        .query(`
            INSERT INTO Ordenes (
                AreaID, Cliente, CodCliente, IdClienteReact, DescripcionTrabajo, Prioridad,
                FechaIngreso, FechaEstimadaEntrega, Material, Variante,
                CodigoOrden, NoDocERP, Nota, Magnitud, ProximoServicio, UM,
                Estado, EstadoenArea, CliIdCliente, ModoRetiro
            )
            OUTPUT INSERTED.OrdenID
            VALUES (
                'TERMINAC', @Cliente, @CodCliente, @IdCliR, @Desc, @Prio,
                GETDATE(), @FEE, @Mat, @Var,
                @Cod, @Doc, @Nota, @Mag, 'DEPOSITO', 'u',
                'Pendiente', 'Pendiente', @CliId, @ModoRet
            )
        `);
    const hermanaId = insH.recordset[0].OrdenID;

    // Repuntar el detalle de terminaciones a la hermana (ArchivoID sigue
    // apuntando a los archivos de la ECOUV: sirve de referencia visual)
    await new sql.Request(transaction)
        .input('HID', sql.Int, hermanaId)
        .input('OID', sql.Int, ecouvId)
        .query('UPDATE OrdenTerminaciones SET OrdenID = @HID WHERE OrdenID = @OID');

    // La ECOUV viaja al local de terminaciones vía despacho normal
    await new sql.Request(transaction)
        .input('OID', sql.Int, ecouvId)
        .query("UPDATE Ordenes SET ProximoServicio = 'TERMINAC' WHERE OrdenID = @OID");

    logger.info(`[Terminaciones] Hermana ${codigoHermana} (${hermanaId}) creada desde orden ${ecouvId} (${cantTerm} terminaciones)`);
    return { hermanaId, codigo: codigoHermana, cantTerm };
}

module.exports = { crearHermanaTerminaciones };
