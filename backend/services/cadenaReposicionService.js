/**
 * Cadena de reposición (Spec 39, RN-FLT.07): creación de las órdenes de falla a partir de las
 * filas de Reposiciones, encadenadas con LiberaCuandoOrdenID (se libera cuando llega la anterior).
 * Compartido por el reporte desde bandeja (insumo propio) y por las solicitudes de insumo
 * (usa el stock / trae más → la orden de falla nace recién con la decisión del cliente).
 */
const { getPool, sql } = require('../config/db');

/** Código nuevo de una orden de falla: {raíz de la madre}-F{FallaID}, con sufijo -n si colisiona. */
async function codigoFalla(tx, codigoMadre, fallaId) {
    const raiz = String(codigoMadre || '').replace(/(-F\d+(-\d+)?)+$/i, '').trim();
    let cod = `${raiz}-F${fallaId}`;
    const dup = await new sql.Request(tx).input('c', sql.NVarChar, cod).query(`SELECT CodigoOrden FROM Ordenes WHERE CodigoOrden = @c OR CodigoOrden LIKE @c + '-%'`);
    if (dup.recordset.length) {
        const usados = dup.recordset.map(r => { const m = String(r.CodigoOrden).slice(cod.length).match(/^-(\d+)$/); return m ? parseInt(m[1], 10) : 1; });
        cod = `${cod}-${Math.max(...usados) + 1}`;
    }
    return cod;
}

/**
 * Crea UNA orden de falla clonando la madre (mismo molde que el control de impresión, con OUTPUT).
 * Nace Pendiente, sin costo. Magnitud: cantidad donde se cuentan unidades; '0' donde se miden metros
 * (los metros aparecen al imprimir y medir, como hoy).
 */
async function crearOrdenFalla(tx, { madre, codigo, magnitud, proximoServicio, liberaCuandoOrdenId, estadoDependencia, nota, bobinaId, prendaId }) {
    const r = await new sql.Request(tx)
        .input('OldID', sql.Int, madre.OrdenID).input('NewCode', sql.NVarChar, codigo)
        .input('Mag', sql.NVarChar, magnitud).input('Prox', sql.VarChar, proximoServicio || null)
        .input('Libera', sql.Int, liberaCuandoOrdenId || null).input('Dep', sql.NVarChar, estadoDependencia || null)
        .input('Nota', sql.NVarChar(sql.MAX), nota || '').input('Bob', sql.Int, bobinaId || null).input('Pre', sql.Int, prendaId || null)
        .query(`
            INSERT INTO dbo.Ordenes(
                CodigoOrden, Cliente, FechaIngreso, FechaEstimadaEntrega, Material, DescripcionTrabajo, Prioridad,
                Estado, EstadoenArea, EstadoLogistica, AreaID, Magnitud, IdCabezalERP, ProximoServicio, Nota, NoDocERP,
                FechaEntradaSector, ArchivosCount, Variante, UM, IdClienteReact, CliIdCliente, CodCliente,
                IdProductoReact, ProIdProducto, CodArticulo, BobinaTelaID, PrendaClienteID, CostoTotal, OrdenOrigenID,
                LiberaCuandoOrdenID, EstadoDependencia)
            OUTPUT INSERTED.OrdenID
            SELECT @NewCode, Cliente, GETDATE(), FechaEstimadaEntrega, Material, DescripcionTrabajo, 'Falla',
                   'Pendiente', 'Pendiente', 'Canasto Falla', AreaID, @Mag, IdCabezalERP, ISNULL(@Prox, ProximoServicio), @Nota, NoDocERP,
                   GETDATE(), 0, Variante, UM, IdClienteReact, CliIdCliente, CodCliente,
                   IdProductoReact, ProIdProducto, CodArticulo,
                   ISNULL(@Bob, CASE WHEN AreaID IN ('SB','SUB') THEN BobinaTelaID ELSE NULL END),
                   ISNULL(@Pre, PrendaClienteID), 0, OrdenID,
                   @Libera, @Dep
            FROM dbo.Ordenes WHERE OrdenID = @OldID`);
    return r.recordset[0].OrdenID;
}

async function getOrdenBasica(conn, ordenId) {
    const r = await new sql.Request(conn).input('id', sql.Int, ordenId).query(`
        SELECT OrdenID, CodigoOrden, AreaID, NoDocERP, UM, Magnitud, ProximoServicio, BobinaTelaID, PrendaClienteID FROM Ordenes WHERE OrdenID = @id`);
    return r.recordset[0] || null;
}

/**
 * Materializa una cadena registrada en Reposiciones (filas sin OrdenFallaID) creando las órdenes
 * de falla en orden: la primera nace PENDIENTE (con la bobina/prenda indicada si corresponde), las
 * siguientes BLOQUEADA con LiberaCuandoOrdenID a la anterior. Devuelve las creadas.
 * @param {sql.Transaction} tx
 * @param {number} primeraReposicionId  fila inicial de la cadena (la que estaba ESPERANDO_INSUMO)
 */
async function materializarCadena(tx, primeraReposicionId, { bobinaId = null, prendaId = null, areasUnidades = [], motivoExtra = '' } = {}) {
    const creadas = [];
    let repId = primeraReposicionId;
    let anteriorOrdenFallaId = null;
    let i = 0;
    while (repId) {
        const rr = await new sql.Request(tx).input('id', sql.Int, repId).query(`SELECT * FROM Reposiciones WHERE ReposicionID = @id`);
        const rep = rr.recordset[0];
        if (!rep) break;
        const next = (await new sql.Request(tx).input('id', sql.Int, repId).query(`SELECT TOP 1 ReposicionID, AreaProduce FROM Reposiciones WHERE ReposicionAnteriorID = @id AND Estado NOT IN ('CERRADA','CANCELADA') ORDER BY ReposicionID`)).recordset[0] || null;
        if (!rep.OrdenFallaID) {
            const madre = await getOrdenBasica(tx, rep.OrdenMadreID);
            const reporta = await getOrdenBasica(tx, rep.OrdenReportaID);
            const areaE = String(madre.AreaID).trim().toUpperCase();
            const cuenta = areasUnidades.includes(areaE);
            const magnitud = cuenta && rep.Cantidad != null ? String(Number(rep.Cantidad)) : '0';
            const mismaArea = areaE === String(rep.AreaReporta).trim().toUpperCase() && !next && Number(rep.OrdenMadreID) === Number(rep.OrdenReportaID);
            const prox = next ? String(next.AreaProduce).trim().toUpperCase() : (mismaArea ? (madre.ProximoServicio || null) : String(rep.AreaReporta).trim().toUpperCase());
            const codigo = await codigoFalla(tx, madre.CodigoOrden, rep.FallaID || rep.ReposicionID);
            const nota = `FALLA (${rep.Tipo === 'FALTANTE' ? 'faltante' : 'falla propia'}) reportada desde ${rep.AreaReporta} por ${String(reporta?.CodigoOrden || '').trim()}: ${rep.Motivo || ''}.` +
                (rep.Nota ? ` Nota: ${rep.Nota}.` : '') + (motivoExtra ? ` ${motivoExtra}` : '') +
                (!cuenta ? ' Sin metros hasta imprimir y medir. Subir el archivo de reimpresión desde el detalle de la orden.' : '') +
                (anteriorOrdenFallaId ? ' Se libera cuando llegue la reposición del área anterior.' : '');
            const nuevaId = await crearOrdenFalla(tx, {
                madre, codigo, magnitud, proximoServicio: prox,
                liberaCuandoOrdenId: anteriorOrdenFallaId, estadoDependencia: anteriorOrdenFallaId ? 'ESPERANDO_REPOSICION' : null,
                nota, bobinaId: i === 0 ? bobinaId : null, prendaId: i === 0 ? prendaId : null,
            });
            await new sql.Request(tx).input('id', sql.Int, repId).input('f', sql.Int, nuevaId)
                .input('e', sql.VarChar(20), anteriorOrdenFallaId ? 'BLOQUEADA' : 'PENDIENTE')
                .input('bob', sql.Int, i === 0 ? bobinaId : null)
                .query(`UPDATE Reposiciones SET OrdenFallaID = @f, Estado = @e, BobinaNuevaID = ISNULL(@bob, BobinaNuevaID) WHERE ReposicionID = @id`);
            creadas.push({ reposicionId: repId, ordenFallaId: nuevaId, codigo, area: areaE, cantidad: cuenta ? rep.Cantidad : null, sinMetros: !cuenta, estado: anteriorOrdenFallaId ? 'BLOQUEADA' : 'PENDIENTE' });
            anteriorOrdenFallaId = nuevaId;
        } else {
            anteriorOrdenFallaId = rep.OrdenFallaID;
        }
        repId = next ? next.ReposicionID : null;
        i++;
    }
    return creadas;
}

module.exports = { codigoFalla, crearOrdenFalla, materializarCadena, getOrdenBasica };
