/**
 * Cadena de reposición (Spec 39, RN-FLT.07): creación de las órdenes de falla a partir de las
 * filas de Reposiciones, encadenadas con LiberaCuandoOrdenID (se libera cuando llega la anterior).
 * Compartido por el reporte desde bandeja (insumo propio) y por las solicitudes de insumo
 * (usa el stock / trae más → la orden de falla nace recién con la decisión del cliente).
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

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
    const nuevaId = r.recordset[0].OrdenID;
    await heredarDeLaMadre(tx, madre.OrdenID, nuevaId);
    return nuevaId;
}

/**
 * [FALLA EST/PRO] Lo que la orden de falla hereda de su madre para no trabarse en lo que ya se
 * resolvió una vez (02-oct-2026):
 *  - TODAS las áreas (9-oct-2026, antes solo EMB/EST): los requisitos ya cumplidos (matriz,
 *    aprobación del cliente, "no aplica" de DTF/TPU/prenda, TELA asignada o "material propio" en
 *    Sublimación). Sin esto la -F nacía con todo pendiente y caía para siempre en "Esperando
 *    requisitos" de Planificación — en SB eran el 100% de esa lista. La espera real de la
 *    prenda/transfer nuevos la maneja EstadoDependencia (ESPERANDO_REPOSICION), no el requisito.
 *  - TPU: la aprobación del boceto y las texturas elegidas. Es la MISMA matriz: no vuelve a pedir
 *    aprobación al cliente ni se cobra matriz (la -F nace con CostoTotal 0 y sin servicios extra).
 * Todo protegido por COL_LENGTH / OBJECT_ID: si una columna o tabla no existe, se saltea.
 */
async function heredarDeLaMadre(tx, madreId, nuevaId) {
    await new sql.Request(tx).input('Old', sql.Int, madreId).input('New', sql.Int, nuevaId).query(`
        DECLARE @Area VARCHAR(20) = (SELECT UPPER(LTRIM(RTRIM(AreaID))) FROM dbo.Ordenes WHERE OrdenID = @Old);
        DECLARE @Cod NVARCHAR(100) = (SELECT LTRIM(RTRIM(CodigoOrden)) FROM dbo.Ordenes WHERE OrdenID = @Old);

        IF OBJECT_ID('dbo.OrdenCumplimientoRequisitos', 'U') IS NOT NULL
            INSERT INTO dbo.OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
            SELECT @New, c.AreaID, c.RequisitoID, 'CUMPLIDO', GETDATE(), LEFT(N'Heredado de ' + ISNULL(@Cod, '') + N' (orden de falla)', 300)
            FROM dbo.OrdenCumplimientoRequisitos c
            WHERE c.OrdenID = @Old AND c.Estado = 'CUMPLIDO'
              AND NOT EXISTS (SELECT 1 FROM dbo.OrdenCumplimientoRequisitos x WHERE x.OrdenID = @New AND x.RequisitoID = c.RequisitoID);

        IF @Area = 'TPU' AND COL_LENGTH('dbo.Ordenes', 'FechaAprobacionCliente') IS NOT NULL AND COL_LENGTH('dbo.Ordenes', 'TexturasElige') IS NOT NULL
            EXEC sp_executesql N'UPDATE n SET n.FechaAprobacionCliente = m.FechaAprobacionCliente, n.TexturasElige = m.TexturasElige
                                 FROM dbo.Ordenes n JOIN dbo.Ordenes m ON m.OrdenID = @Old WHERE n.OrdenID = @New',
                               N'@Old INT, @New INT', @Old = @Old, @New = @New;

        IF @Area = 'TPU' AND OBJECT_ID('dbo.OrdenTexturasTPU', 'U') IS NOT NULL
        BEGIN
            DECLARE @cols NVARCHAR(MAX) = STUFF((
                SELECT ',' + QUOTENAME(name) FROM sys.columns
                WHERE object_id = OBJECT_ID('dbo.OrdenTexturasTPU') AND name <> 'OrdenID' AND is_identity = 0 AND is_computed = 0
                FOR XML PATH('')), 1, 1, '');
            IF @cols IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.OrdenTexturasTPU WHERE OrdenID = @New)
            BEGIN
                DECLARE @q NVARCHAR(MAX) = N'INSERT INTO dbo.OrdenTexturasTPU (OrdenID,' + @cols + N') SELECT @New,' + @cols + N' FROM dbo.OrdenTexturasTPU WHERE OrdenID = @Old';
                EXEC sp_executesql @q, N'@Old INT, @New INT', @Old = @Old, @New = @New;
            END
        END`);
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
            // [23/10/2026] El archivo de impresión que se eligió al reportar (si es de esta madre)
            if (rep.ArchivoOrigenID) await copiarArchivoImpresion(tx, { nuevaId, madreId: madre.OrdenID, archivoId: rep.ArchivoOrigenID });
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

// ─── FALLAS REPORTADAS DESDE OTRA ÁREA: el archivo de impresión (23/10/2026) ───────────────────
// Caso SUB-31896-F2623: Corte reportó una falla de la tela, la -F de Sublimación nació SIN archivo
// ("subir el archivo de reimpresión desde el detalle"), igual pasó por lote e impresión y en Control
// se canceló de oficio por no tener archivos: no hubo etiqueta. Esto vale SOLO para las -F que
// nacieron de una reposición (fila en Reposiciones con OrdenFallaID): las fallas que se reportan en
// el propio Control (productionFileController.postControlArchivo) no escriben en Reposiciones y ya
// nacen con su archivo copiado. Solo archivos de IMPRESIÓN y solo áreas que imprimen por lote: los
// archivos de bordado / matriz no se copian, y TPU (arte en capas) sigue como hoy.
const AREAS_IMPRIMEN_POR_LOTE = ['SB', 'SUB', 'DF', 'DTF', 'ECOUV', 'DIRECTA', 'DIRECTA-ALGODON'];
const SQL_AREAS_IMPRIMEN = AREAS_IMPRIMEN_POR_LOTE.map(a => `'${a}'`).join(', ');

/**
 * Copia a la orden de falla el archivo de impresión que se eligió al reportar ("De qué archivo
 * viene"), si es de la madre de ese eslabón, es de impresión y el área imprime por lote. Lo mismo que
 * hace el control de impresión con su -F: mismas copias, en Sublimación con 0 m (los metros salen al
 * imprimir y medir), la nota de reposición anexada, la miniatura y, en DTF, la plancha de tinta
 * blanca. Devuelve el nombre del archivo copiado, o null si no correspondía copiar nada.
 */
async function copiarArchivoImpresion(tx, { nuevaId, madreId, archivoId }) {
    if (!nuevaId || !madreId || !archivoId) return null;
    const r = await new sql.Request(tx).input('A', sql.Int, archivoId).input('M', sql.Int, madreId).query(`
        SELECT a.ArchivoID, a.NombreArchivo, UPPER(LTRIM(RTRIM(o.AreaID))) AS Area, LTRIM(RTRIM(o.CodigoOrden)) AS CodMadre
        FROM dbo.ArchivosOrden a JOIN dbo.Ordenes o ON o.OrdenID = a.OrdenID
        WHERE a.ArchivoID = @A AND a.OrdenID = @M
          AND ISNULL(a.EstadoArchivo, '') <> 'CANCELADO'
          AND UPPER(LTRIM(RTRIM(ISNULL(a.TipoArchivo, '')))) = 'IMPRESION'`);
    const f = r.recordset[0];
    if (!f || !AREAS_IMPRIMEN_POR_LOTE.includes(f.Area)) return null;
    const esSB = f.Area === 'SB' || f.Area === 'SUB';
    const ins = await new sql.Request(tx).input('N', sql.Int, nuevaId).input('A', sql.Int, archivoId).query(`
        INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, Metros, Copias, Ancho, Alto, Observaciones, TipoArchivo, FechaSubida, EstadoArchivo)
        OUTPUT INSERTED.ArchivoID
        SELECT @N, NombreArchivo, RutaAlmacenamiento, ${esSB ? '0' : 'Metros'}, Copias, Ancho, Alto,
               CASE WHEN ISNULL(Observaciones, '') LIKE '%Reposición por Falla%' THEN Observaciones
                    ELSE LTRIM(RTRIM(ISNULL(Observaciones, ''))) + ' [Reposición por Falla]' END,
               TipoArchivo, GETDATE(), 'Pendiente'
        FROM dbo.ArchivosOrden WHERE ArchivoID = @A;
        UPDATE dbo.Ordenes SET ArchivosCount = (SELECT COUNT(*) FROM dbo.ArchivosOrden WHERE OrdenID = @N) WHERE OrdenID = @N;`);
    const nuevoArchivoId = ins.recordset[0]?.ArchivoID;
    // La nota de la -F decía que había que subir el archivo: ahora ya lo tiene
    await new sql.Request(tx).input('N', sql.Int, nuevaId).input('Nom', sql.NVarChar(400), String(f.NombreArchivo || '').trim()).query(`
        UPDATE dbo.Ordenes
        SET Nota = REPLACE(ISNULL(Nota, ''), ' Subir el archivo de reimpresión desde el detalle de la orden.',
                   ' Se reimprime con el archivo elegido al reportar (' + @Nom + '): si hay que cambiarlo o reimprimir menos copias, desde el detalle de la orden.')
        WHERE OrdenID = @N`);
    if (f.Area === 'DF' || f.Area === 'DTF') {
        try { await require('./dtfBlancoService').copiarTintaBlanca(tx, nuevaId, [archivoId]); }
        catch (e) { logger.warn(`[cadenaReposicion] No se pudo copiar la tinta blanca del archivo ${archivoId}: ${e.message}`); }
    }
    if (nuevoArchivoId) {
        try {
            const cod = await new sql.Request(tx).input('N', sql.Int, nuevaId).query('SELECT LTRIM(RTRIM(CodigoOrden)) AS C FROM dbo.Ordenes WHERE OrdenID = @N');
            require('../utils/thumbnailGenerator').copyThumbnail(f.CodMadre, archivoId, cod.recordset[0]?.C, nuevoArchivoId);
        } catch (e) { logger.warn(`[cadenaReposicion] No se pudo copiar la miniatura a la orden de falla: ${e.message}`); }
    }
    return String(f.NombreArchivo || '').trim();
}

/**
 * De estas órdenes, las de falla de una reposición (otra área) en un área que imprime por lote que
 * NO tienen ningún archivo de impresión vivo: no pueden ir a un lote (se imprimiría "nada") ni
 * cerrarse en Control. [{ OrdenID, CodigoOrden }]
 */
async function fallasSinArchivoDeImpresion(conn, ordenIds) {
    const ids = (ordenIds || []).map(Number).filter(Number.isInteger);
    if (!ids.length) return [];
    const r = await new sql.Request(conn).query(`
        SELECT o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden
        FROM dbo.Ordenes o
        WHERE o.OrdenID IN (${ids.join(',')})
          AND UPPER(LTRIM(RTRIM(o.AreaID))) IN (${SQL_AREAS_IMPRIMEN})
          AND EXISTS (SELECT 1 FROM dbo.Reposiciones r WHERE r.OrdenFallaID = o.OrdenID)
          AND NOT EXISTS (SELECT 1 FROM dbo.ArchivosOrden a
                          WHERE a.OrdenID = o.OrdenID AND ISNULL(a.EstadoArchivo, '') <> 'CANCELADO'
                            AND UPPER(LTRIM(RTRIM(ISNULL(a.TipoArchivo, '')))) = 'IMPRESION')`);
    return r.recordset;
}

/** Texto del aviso para las -F sin archivo de impresión (lote y Control dicen lo mismo). */
const avisoFallaSinArchivo = (codigos) =>
    `${codigos.length === 1 ? 'La orden de falla' : 'Las órdenes de falla'} ${codigos.join(', ')} no ${codigos.length === 1 ? 'tiene' : 'tienen'} archivo de impresión: ` +
    'subí el archivo de reimpresión desde el detalle de la orden y después volvé a intentar.';

module.exports = {
    codigoFalla, crearOrdenFalla, materializarCadena, getOrdenBasica,
    AREAS_IMPRIMEN_POR_LOTE, copiarArchivoImpresion, fallasSinArchivoDeImpresion, avisoFallaSinArchivo,
};
