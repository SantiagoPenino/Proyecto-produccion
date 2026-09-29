const sql = require('mssql');

/**
 * Bultos de órdenes canceladas (25/09/2026).
 *
 * Cancelar una orden no tocaba sus bultos: seguían "en stock" en el área y en los remitos sin
 * recibir, se podían despachar y trababan remitos. Caso DTF-21591: cancelada el 08/09, su bulto
 * salió igual ese día en REM-231455 y el 23/09 en REM-998757, y los dos remitos quedaron en
 * recibido parcial esperando un paquete que no viajó.
 *
 *  - Al cancelar: los bultos del producto de la orden (PROD_TERMINADO / EN_PROCESO) que están en
 *    stock o en tránsito pasan a CANCELADO, con un movimiento CANCELACION que guarda el área donde
 *    estaban. Si estaban en un remito sin recibir, salen del remito (se borra la fila, como al
 *    regenerar etiquetas: si quedara, Recepción la mostraría como faltante y "Cerrar faltantes" la
 *    pasaría a PERDIDO) y el remito se recalcula. La tela del cliente no se toca: es suya y hay que
 *    devolvérsela. Las encomiendas tampoco (su OrdenID es un número de retiro).
 *  - Al reactivar (la orden deja de estar cancelada): los bultos que canceló esta regla vuelven a
 *    EN_STOCK en el área donde estaban. Reactivar manda la orden a Pendiente y, como ya tiene
 *    etiquetas, al completarla otra vez no se generan nuevas: sin esto quedaría sin bulto.
 *
 * Lo llama stateManagerService.changeOrderState, así cubre todos los caminos que cancelan o
 * reactivan (cancelar orden o pedido, archivos, cambio de estado a mano, cascadas, jobs).
 */

// Solo el producto de la orden: la tela del cliente (TELA DE CLIENTE, DEV_TELA_CLIENTE) puede
// tener que viajar para devolvérsela aunque la orden se cancele.
const TIPOS_PRODUCTO = `('PROD_TERMINADO', 'EN_PROCESO')`;

const idsValidos = (ids) => [...new Set((ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];

// Corre el lote dentro de un punto de guardado: si algo falla se deshace SOLO esto y el cambio de
// estado de la orden sigue (quien llama anota el aviso en el log). Algunos llamadores pasan el pool
// en vez de una transacción: ahí el lote abre la suya.
const enPuntoDeGuardado = (cuerpo) => `
    SET NOCOUNT ON;
    DECLARE @propia BIT = CASE WHEN @@TRANCOUNT = 0 THEN 1 ELSE 0 END;
    IF @propia = 1 BEGIN BEGIN TRAN; END ELSE BEGIN SAVE TRANSACTION bultosOrden; END
    BEGIN TRY
        ${cuerpo}
        IF @propia = 1 COMMIT;
    END TRY
    BEGIN CATCH
        IF @propia = 1 BEGIN IF @@TRANCOUNT > 0 ROLLBACK; END
        ELSE IF XACT_STATE() = 1 ROLLBACK TRANSACTION bultosOrden;
        THROW;
    END CATCH`;

/**
 * Saca del stock y de los remitos sin recibir los bultos del producto de órdenes canceladas.
 * Idempotente: solo toca bultos EN_STOCK / EN_TRANSITO.
 * @param db  transacción (o pool) activa
 * @param {number[]} ordenIds
 * @param {{usuarioId?: number}} [opts]
 * @returns {Promise<{bultos:number, remitos:number}>}
 */
async function sacarBultosDeCanceladas(db, ordenIds, { usuarioId = null } = {}) {
    const ids = idsValidos(ordenIds);
    if (!ids.length) return { bultos: 0, remitos: 0 };

    const r = await new sql.Request(db)
        .input('Usr', sql.Int, Number.isInteger(usuarioId) && usuarioId > 0 ? usuarioId : null)
        .query(enPuntoDeGuardado(`
        DECLARE @b TABLE (BultoID INT PRIMARY KEY, CodigoEtiqueta NVARCHAR(50) COLLATE DATABASE_DEFAULT,
                          EstadoAnt NVARCHAR(20) COLLATE DATABASE_DEFAULT, Area NVARCHAR(50) COLLATE DATABASE_DEFAULT,
                          CodigoOrden NVARCHAR(60) COLLATE DATABASE_DEFAULT);
        INSERT INTO @b (BultoID, CodigoEtiqueta, EstadoAnt, Area, CodigoOrden)
        SELECT b.BultoID, b.CodigoEtiqueta, b.Estado, b.UbicacionActual,
               ISNULL(LTRIM(RTRIM(o.CodigoOrden)), CAST(o.OrdenID AS NVARCHAR(20)))
        FROM Logistica_Bultos b
        JOIN Ordenes o ON o.OrdenID = b.OrdenID
        WHERE b.OrdenID IN (${ids.join(',')})
          AND b.Tipocontenido IN ${TIPOS_PRODUCTO}
          AND b.Estado IN ('EN_STOCK', 'EN_TRANSITO');

        -- Filas de remito sin recibir de esos bultos
        DECLARE @it TABLE (ItemID INT PRIMARY KEY, EnvioID INT, BultoID INT);
        INSERT INTO @it (ItemID, EnvioID, BultoID)
        SELECT i.ItemID, i.EnvioID, i.BultoID
        FROM Logistica_EnvioItems i
        JOIN @b x ON x.BultoID = i.BultoID
        WHERE i.EstadoRecepcion = 'PENDIENTE';

        -- En tránsito, UbicacionActual dice TRANSITO: el área que cuenta es la de origen del remito
        UPDATE x SET x.Area = e.AreaOrigenID
        FROM @b x
        JOIN @it t ON t.BultoID = x.BultoID
        JOIN Logistica_Envios e ON e.EnvioID = t.EnvioID
        WHERE x.EstadoAnt = 'EN_TRANSITO';

        DELETE i FROM Logistica_EnvioItems i JOIN @it t ON t.ItemID = i.ItemID;

        -- Cada remito afectado se recalcula: sin bultos, CANCELADO; recibido parcial sin nada
        -- pendiente, RECIBIDO_TOTAL. Y anota qué salió y por qué.
        UPDATE e SET
            e.Estado = CASE
                WHEN NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems i WHERE i.EnvioID = e.EnvioID) THEN 'CANCELADO'
                WHEN e.Estado = 'RECIBIDO_PARCIAL'
                     AND NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems i WHERE i.EnvioID = e.EnvioID AND i.EstadoRecepcion = 'PENDIENTE')
                    THEN 'RECIBIDO_TOTAL'
                ELSE e.Estado END,
            e.Observaciones = ISNULL(e.Observaciones, '') + ' | Sale del remito por orden cancelada: ' + q.Bultos
                + CASE WHEN NOT EXISTS (SELECT 1 FROM Logistica_EnvioItems i WHERE i.EnvioID = e.EnvioID)
                       THEN ' (el remito quedó sin bultos)' ELSE '' END
        FROM Logistica_Envios e
        JOIN (SELECT t.EnvioID, STRING_AGG(CAST(x.CodigoEtiqueta + ' (' + x.CodigoOrden + ')' AS NVARCHAR(MAX)), ', ') AS Bultos
              FROM @it t JOIN @b x ON x.BultoID = t.BultoID
              GROUP BY t.EnvioID) q ON q.EnvioID = e.EnvioID;

        UPDATE b SET b.Estado = 'CANCELADO', b.UbicacionActual = 'CANCELADO'
        FROM Logistica_Bultos b JOIN @b x ON x.BultoID = b.BultoID;

        -- AreaID = dónde estaba: de ahí lo saca y ahí lo devuelve si la orden se reactiva
        INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
        SELECT x.CodigoEtiqueta, 'CANCELACION', ISNULL(x.Area, 'TRANSITO'), @Usr, GETDATE(),
               'Orden ' + x.CodigoOrden + ' cancelada' + ISNULL(': sale del remito ' + rm.Remitos, ''),
               x.EstadoAnt, 'CANCELADO', 0
        FROM @b x
        OUTER APPLY (SELECT STRING_AGG(CAST(e.CodigoRemito AS NVARCHAR(MAX)), ', ') AS Remitos
                     FROM @it t JOIN Logistica_Envios e ON e.EnvioID = t.EnvioID
                     WHERE t.BultoID = x.BultoID) rm;

        SELECT (SELECT COUNT(*) FROM @b) AS Bultos, (SELECT COUNT(DISTINCT EnvioID) FROM @it) AS Remitos;
    `));
    const fila = r.recordset?.[0] || {};
    return { bultos: fila.Bultos || 0, remitos: fila.Remitos || 0 };
}

/**
 * Devuelve al stock los bultos que canceló sacarBultosDeCanceladas, cuando su orden se reactiva.
 * Solo los que tienen como último movimiento la CANCELACION: si después pasó otra cosa, no se tocan.
 * @param db  transacción (o pool) activa
 * @param {number[]} ordenIds
 * @param {{usuarioId?: number}} [opts]
 * @returns {Promise<{bultos:number}>}
 */
async function devolverBultosDeReactivadas(db, ordenIds, { usuarioId = null } = {}) {
    const ids = idsValidos(ordenIds);
    if (!ids.length) return { bultos: 0 };

    const r = await new sql.Request(db)
        .input('Usr', sql.Int, Number.isInteger(usuarioId) && usuarioId > 0 ? usuarioId : null)
        .query(enPuntoDeGuardado(`
        DECLARE @v TABLE (BultoID INT PRIMARY KEY, CodigoEtiqueta NVARCHAR(50) COLLATE DATABASE_DEFAULT,
                          Area NVARCHAR(50) COLLATE DATABASE_DEFAULT, CodigoOrden NVARCHAR(60) COLLATE DATABASE_DEFAULT);
        INSERT INTO @v (BultoID, CodigoEtiqueta, Area, CodigoOrden)
        SELECT b.BultoID, b.CodigoEtiqueta,
               -- Sin área conocida (cancelados a mano en tránsito): el área de la orden
               COALESCE(CASE WHEN m.AreaID IN ('TRANSITO', 'CANCELADO') THEN NULL ELSE m.AreaID END,
                        NULLIF(LTRIM(RTRIM(o.AreaID)), ''), 'PRODUCCION'),
               ISNULL(LTRIM(RTRIM(o.CodigoOrden)), CAST(o.OrdenID AS NVARCHAR(20)))
        FROM Logistica_Bultos b
        JOIN Ordenes o ON o.OrdenID = b.OrdenID
        CROSS APPLY (SELECT TOP 1 mm.TipoMovimiento, mm.AreaID
                     FROM MovimientosLogistica mm
                     WHERE mm.CodigoBulto = CAST(b.CodigoEtiqueta AS VARCHAR(50))
                     ORDER BY mm.MovimientoID DESC) m
        WHERE b.OrdenID IN (${ids.join(',')})
          AND b.Tipocontenido IN ${TIPOS_PRODUCTO}
          AND b.Estado = 'CANCELADO'
          AND m.TipoMovimiento = 'CANCELACION';

        UPDATE b SET b.Estado = 'EN_STOCK', b.UbicacionActual = v.Area
        FROM Logistica_Bultos b JOIN @v v ON v.BultoID = b.BultoID;

        INSERT INTO MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, FechaHora, Observaciones, EstadoAnterior, EstadoNuevo, EsRecepcion)
        SELECT v.CodigoEtiqueta, 'REACTIVACION', v.Area, @Usr, GETDATE(),
               'Orden ' + v.CodigoOrden + ' reactivada: el bulto vuelve al stock de ' + v.Area, 'CANCELADO', 'EN_STOCK', 0
        FROM @v v;

        SELECT COUNT(*) AS Bultos FROM @v;
    `));
    return { bultos: r.recordset?.[0]?.Bultos || 0 };
}

module.exports = { sacarBultosDeCanceladas, devolverBultosDeReactivadas, TIPOS_PRODUCTO };
