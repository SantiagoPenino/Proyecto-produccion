const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// ====================================================================
// MÓDULO: Tela Cliente — Gestión centralizada de metros por cliente
// Análogo a la "Billetera" pero para metros de tela física
// ====================================================================

// ─────────────────────────────────────────────────────────────────────
// 1. SALDO DE METROS POR TIPO DE TELA
//    GET /api/tela-cliente/:clienteId/saldo
// ─────────────────────────────────────────────────────────────────────
exports.getSaldo = async (req, res) => {
    const { clienteId } = req.params;
    if (!clienteId) return res.status(400).json({ error: 'clienteId requerido' });

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('ClienteID', sql.NVarChar(255), clienteId)
            .query(`
                SELECT
                    ib.InsumoID,
                    ins.Nombre                                                        AS InsumoNombre,
                    -- Descripcion real del tipo de tela (ej: "Seda Americana")
                    -- Se saca del Detalle de la Recepcion vinculada via Referencia
                    COALESCE(
                        NULLIF(
                            -- Quitar prefijo "TELA: " si existe
                            CASE WHEN r.Detalle LIKE 'TELA:%'
                                 THEN LTRIM(SUBSTRING(r.Detalle, 7, 500))
                                 ELSE r.Detalle
                            END,
                        ''),
                        lb.Descripcion,
                        ins.Nombre
                    )                                                                 AS TipoTela,
                    COUNT(DISTINCT ib.BobinaID)                                       AS CantidadBultos,
                    SUM(ib.MetrosIniciales)                                           AS MetrosIngresados,
                    SUM(ib.MetrosRestantes)                                           AS MetrosDisponibles,
                    SUM(ib.MetrosIniciales - ib.MetrosRestantes)                      AS MetrosConsumidos,
                    CAST(
                        100.0 * SUM(ib.MetrosIniciales - ib.MetrosRestantes)
                        / NULLIF(SUM(ib.MetrosIniciales), 0)
                    AS DECIMAL(5,2))                                                  AS PorcentajeConsumido,
                    SUM(CASE WHEN ib.Estado = 'En Uso'
                            THEN ib.MetrosRestantes ELSE 0 END)                      AS MetrosEnProceso,
                    SUM(CASE WHEN ib.Estado = 'Disponible'
                            THEN ib.MetrosRestantes ELSE 0 END)                      AS MetrosLibres,
                    MAX(ib.FechaIngreso)                                              AS UltimoIngreso
                FROM InventarioBobinas ib
                JOIN Insumos ins
                    ON ib.InsumoID = ins.InsumoID
                -- Traer descripcion del bulto logistico (tiene "TELA: Seda Americana")
                LEFT JOIN Logistica_Bultos lb
                    ON lb.CodigoEtiqueta = ib.Referencia
                    OR lb.RecepcionID   = (
                        SELECT TOP 1 RecepcionID FROM Recepciones
                        WHERE Codigo = ib.Referencia OR Codigo + '-1' = ib.Referencia
                    )
                -- Traer la recepcion vinculada para el Detalle
                LEFT JOIN Recepciones r
                    ON r.Codigo = ib.Referencia
                    OR r.Codigo = LEFT(ib.Referencia, LEN(ib.Referencia) - 2)  -- PRE-5 <- PRE-5-1
                WHERE ib.ClienteID = @ClienteID
                  AND ib.Estado IN ('Disponible', 'En Uso')
                GROUP BY
                    ib.InsumoID,
                    ins.Nombre,
                    COALESCE(
                        NULLIF(
                            CASE WHEN r.Detalle LIKE 'TELA:%'
                                 THEN LTRIM(SUBSTRING(r.Detalle, 7, 500))
                                 ELSE r.Detalle
                            END,
                        ''),
                        lb.Descripcion,
                        ins.Nombre
                    )
                ORDER BY UltimoIngreso DESC
            `);

        res.json({ success: true, saldos: result.recordset, data: result.recordset });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error getSaldo:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────
// 2. ESTADO DE CUENTA COMPLETO (extracto tipo bancario)
//    GET /api/tela-cliente/:clienteId/estado-cuenta
//    Query: ?desde=YYYY-MM-DD &hasta=YYYY-MM-DD &insumoId=N &tipo=INGRESO
// ─────────────────────────────────────────────────────────────────────
exports.getEstadoCuenta = async (req, res) => {
    const { clienteId } = req.params;
    const { desde, hasta, insumoId, tipo } = req.query;

    try {
        const pool = await getPool();
        const request = pool.request()
            .input('ClienteID', sql.NVarChar(255), clienteId);

        let filtros = '';
        if (desde) { request.input('Desde', sql.DateTime, new Date(desde)); filtros += ' AND mi.FechaMovimiento >= @Desde'; }
        if (hasta) { request.input('Hasta', sql.DateTime, new Date(hasta + 'T23:59:59')); filtros += ' AND mi.FechaMovimiento <= @Hasta'; }
        if (insumoId) { request.input('InsumoID', sql.Int, parseInt(insumoId)); filtros += ' AND mi.InsumoID = @InsumoID'; }
        if (tipo) { request.input('Tipo', sql.VarChar(50), tipo); filtros += ' AND mi.TipoMovimiento = @Tipo'; }

        const { tela } = req.query;
        if (tela) { request.input('Tela', sql.NVarChar(200), `%${tela}%`); filtros += ' AND (ib.DescripcionTela LIKE @Tela OR ins.Nombre LIKE @Tela)'; }

        const result = await request.query(`
            SELECT
                mi.MovimientoID,
                mi.FechaMovimiento,
                mi.TipoMovimiento,
                mi.Cantidad,
                mi.Referencia,
                ib.BobinaID,
                ib.CodigoEtiqueta                                           AS Bulto,
                ib.MetrosIniciales                                          AS MetrosIniciales,
                ib.Ancho                                                    AS Ancho,
                ib.Peso                                                     AS Peso,
                ib.MetrosRestantes                                          AS SaldoBulto,
                ib.Estado                                                   AS EstadoBulto,
                COALESCE(NULLIF(ib.DescripcionTela,''), ins.Nombre)         AS TipoTela,
                ib.Referencia                                               AS ReferenciaOrden,
                ins.InsumoID,
                r.Codigo                                                    AS CodigoRecepcion,
                r.FechaRecepcion                                            AS FechaRecepcion,
                u.Nombre                                                    AS Operario
            FROM MovimientosInsumos mi
            JOIN InventarioBobinas ib   ON mi.BobinaID  = ib.BobinaID
            JOIN Insumos ins            ON mi.InsumoID  = ins.InsumoID
            LEFT JOIN Recepciones r     ON ib.Referencia LIKE r.Codigo + '%'
            LEFT JOIN Usuarios u        ON mi.UsuarioID = u.IdUsuario
            WHERE ib.ClienteID = @ClienteID
            ${filtros}
            ORDER BY mi.FechaMovimiento DESC
        `);


        // Calcular saldo acumulado (running balance) por bobina.
        // OJO: antes se acumulaba por InsumoID, pero varias bobinas del cliente
        // comparten insumo genérico y el saldo de una contaminaba a la otra
        // (ej: BOB-97 mostraba 67.55 en vez de 67.45 por los 0.10 de BOB-93).
        const rows = result.recordset;
        const saldoAcum = {};
        // Recorremos de más antiguo a más reciente para acumular
        [...rows].reverse().forEach(r => {
            const key = r.BobinaID;
            if (!saldoAcum[key]) saldoAcum[key] = 0;
            if (r.TipoMovimiento === 'INGRESO') saldoAcum[key] += parseFloat(r.Cantidad || 0);
            else saldoAcum[key] -= Math.abs(parseFloat(r.Cantidad || 0));
            r.SaldoAcumulado = parseFloat(saldoAcum[key].toFixed(2));
        });

        res.json({ success: true, data: rows, total: rows.length });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error getEstadoCuenta:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────
// 3. BULTOS FÍSICOS ACTIVOS DEL CLIENTE
//    GET /api/tela-cliente/:clienteId/bultos
// ─────────────────────────────────────────────────────────────────────
exports.getBultos = async (req, res) => {
    const { clienteId } = req.params;

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('ClienteID', sql.NVarChar(255), clienteId)
            .query(`
                SELECT
                    ib.BobinaID,
                    ib.CodigoEtiqueta,
                    ib.MetrosIniciales,
                    ib.MetrosRestantes,
                    CAST(100.0 * (ib.MetrosIniciales - ib.MetrosRestantes)
                         / NULLIF(ib.MetrosIniciales, 0) AS DECIMAL(5,2))  AS PorcentajeUsado,
                    ib.Estado,
                    ib.LoteProveedor,
                    ib.AreaID,
                    ib.OrdenID,
                    ib.Referencia                                           AS CodigoRecepcion,
                    ib.FechaIngreso,
                    ins.Nombre                                              AS TipoTela,
                    ins.InsumoID,
                    a.Nombre                                                AS AreaNombre,
                    o.CodigoOrden                                          AS OrdenCodigo
                FROM InventarioBobinas ib
                JOIN Insumos ins     ON ib.InsumoID = ins.InsumoID
                LEFT JOIN Areas a    ON ib.AreaID   = a.AreaID
                LEFT JOIN Ordenes o  ON ib.OrdenID  = o.OrdenID
                WHERE ib.ClienteID = @ClienteID
                  AND ib.Estado IN ('Disponible', 'En Uso')
                ORDER BY ib.FechaIngreso DESC
            `);

        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error getBultos:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────
// 4. RESERVAR METROS (consumo por adelantado al asignar orden)
//    POST /api/tela-cliente/:clienteId/reservar
//    Body: { bobinaId, metrosReserva, ordenId, motivo? }
//
//    Cambia InventarioBobinas.Estado a 'En Uso' y loguea en MovimientosInsumos
// ─────────────────────────────────────────────────────────────────────
exports.reservarMetros = async (req, res) => {
    const { clienteId } = req.params;
    const { bobinaId, metrosReserva, ordenId, motivo } = req.body;
    const operarioId = req.user?.id || 1;

    if (!bobinaId || !metrosReserva) {
        return res.status(400).json({ error: 'Se requieren bobinaId y metrosReserva' });
    }

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Verificar que el bulto pertenece al cliente y tiene metros suficientes
            const check = await new sql.Request(transaction)
                .input('BID', sql.Int, bobinaId)
                .input('CLI', sql.NVarChar(255), clienteId)
                .query(`
                    SELECT BobinaID, MetrosRestantes, InsumoID, CodigoEtiqueta, Estado
                    FROM InventarioBobinas
                    WHERE BobinaID = @BID AND ClienteID = @CLI
                `);

            if (check.recordset.length === 0) {
                throw new Error('Bulto no encontrado o no pertenece a este cliente');
            }

            const bulto = check.recordset[0];
            if (bulto.MetrosRestantes < parseFloat(metrosReserva)) {
                throw new Error(`Sin metros suficientes. Disponibles: ${bulto.MetrosRestantes}m, solicitados: ${metrosReserva}m`);
            }

            // Marcar como En Uso + vincular orden si viene
            await new sql.Request(transaction)
                .input('BID', sql.Int, bobinaId)
                .input('OID', sql.Int, ordenId || null)
                .query(`
                    UPDATE InventarioBobinas
                    SET Estado  = 'En Uso',
                        OrdenID = COALESCE(@OID, OrdenID)
                    WHERE BobinaID = @BID
                `);

            // Registrar movimiento de reserva
            const ref = motivo
                ? `Reserva Orden ${ordenId || '?'}: ${motivo}`
                : `Reserva para Orden ${ordenId || '?'} (${bulto.CodigoEtiqueta})`;

            await new sql.Request(transaction)
                .input('IID',  sql.Int,          bulto.InsumoID)
                .input('BID',  sql.Int,          bobinaId)
                .input('Cant', sql.Decimal(10,2), parseFloat(metrosReserva))
                .input('Ref',  sql.NVarChar(200), ref)
                .input('UID',  sql.Int,           operarioId)
                .query(`
                    INSERT INTO MovimientosInsumos
                        (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID)
                    VALUES (@IID, @BID, 'RESERVA_ORDEN', @Cant, @Ref, @UID)
                `);

            await transaction.commit();
            res.json({
                success: true,
                message: `${metrosReserva}m reservados del bulto ${bulto.CodigoEtiqueta}`,
                bulto: { ...bulto, Estado: 'En Uso' }
            });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error reservarMetros:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─────────────────────────────────────────────────────────────────────
// 5. LIBERAR RESERVA (si se cancela la orden)
//    POST /api/tela-cliente/:clienteId/liberar
//    Body: { bobinaId, motivo? }
// ─────────────────────────────────────────────────────────────────────
exports.liberarReserva = async (req, res) => {
    const { clienteId } = req.params;
    const { bobinaId, motivo } = req.body;
    const operarioId = req.user?.id || 1;

    if (!bobinaId) return res.status(400).json({ error: 'bobinaId requerido' });

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const check = await new sql.Request(transaction)
                .input('BID', sql.Int, bobinaId)
                .input('CLI', sql.NVarChar(255), clienteId)
                .query(`
                    SELECT BobinaID, InsumoID, CodigoEtiqueta
                    FROM InventarioBobinas
                    WHERE BobinaID = @BID AND ClienteID = @CLI AND Estado = 'En Uso'
                `);

            if (check.recordset.length === 0) {
                throw new Error('Bulto no encontrado, no pertenece a este cliente, o no está En Uso');
            }

            const bulto = check.recordset[0];

            // Devolver a Disponible
            await new sql.Request(transaction)
                .input('BID', sql.Int, bobinaId)
                .query(`UPDATE InventarioBobinas SET Estado = 'Disponible', OrdenID = NULL WHERE BobinaID = @BID`);

            // Log liberación
            await new sql.Request(transaction)
                .input('IID',  sql.Int,          bulto.InsumoID)
                .input('BID',  sql.Int,          bobinaId)
                .input('Ref',  sql.NVarChar(200), motivo ? `Liberación: ${motivo}` : `Reserva liberada (${bulto.CodigoEtiqueta})`)
                .input('UID',  sql.Int,           operarioId)
                .query(`
                    INSERT INTO MovimientosInsumos
                        (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID)
                    VALUES (@IID, @BID, 'LIBERACION_RESERVA', 0, @Ref, @UID)
                `);

            await transaction.commit();
            res.json({ success: true, message: `Reserva liberada para bulto ${bulto.CodigoEtiqueta}` });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error('[TELA-CLIENTE] Error liberarReserva:', err);
        res.status(500).json({ error: err.message });
    }
};
