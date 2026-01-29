const { getPool, sql } = require('../config/db');

// ==========================================
// 1. GUARDAR RECEPCIÓN
// ==========================================

exports.createReception = async (req, res) => {
    const { clienteId, tipo, servicios, telaCliente, bultos, referencias, usuario, observaciones,
        insumoId, metros, loteProv, areaDestino } = req.body;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Detalle
            let detalle = tipo === 'PAQUETE DE PRENDAS' ? (servicios || []).join('/') : `TELA: ${telaCliente}`;

            // Handle Cantidad Prendas appending to Observaciones (Legacy compatibility)
            let finalObs = observaciones || '';
            if (req.body.cantidadPrendas) {
                finalObs = `[Total Prendas: ${req.body.cantidadPrendas}] ` + finalObs;
            }

            // Determine Next Service / Area (MOVED UP)
            // Determine Next Service / Area (MOVED UP)
            let nextSrv = areaDestino;
            if (!nextSrv && servicios && servicios.length > 0) {
                const srvName = servicios[0];
                // Resolve Area ID from Name (e.g. 'Bordado' -> 'EMB')
                const areaRes = await new sql.Request(transaction)
                    .input('N', sql.VarChar(100), srvName)
                    .query("SELECT Top 1 AreaID FROM Areas WHERE Nombre = @N OR AreaID = @N");

                if (areaRes.recordset.length > 0) {
                    nextSrv = areaRes.recordset[0].AreaID;
                } else {
                    nextSrv = srvName;
                }
            }

            // Cabecera
            const result = await new sql.Request(transaction)
                .input('Cliente', sql.VarChar(255), clienteId)
                .input('Tipo', sql.VarChar(50), tipo)
                .input('Detalle', sql.NVarChar(sql.MAX), detalle)
                .input('Bultos', sql.Int, bultos || 1)
                .input('Ref', sql.NVarChar(sql.MAX), [...(referencias || []), metros ? `Mts:${metros}` : ''].filter(Boolean).join(' | '))
                .input('Obs', sql.NVarChar(sql.MAX), finalObs)
                .input('UID', sql.Int, usuario ? usuario.id : 1) // Default to 1
                .input('Ubi', sql.VarChar(50), 'Recepcion') // Default
                .input('Next', sql.VarChar(50), nextSrv || null)
                .query(`
                    INSERT INTO Recepciones (Cliente, Tipo, Detalle, CantidadBultos, Referencias, Observaciones, UsuarioID, Estado, UbicacionActual, ProximoServicio)
                    OUTPUT INSERTED.RecepcionID
                    VALUES (@Cliente, @Tipo, @Detalle, @Bultos, @Ref, @Obs, @UID, 'Ingresado', @Ubi, @Next);
                `);

            const newId = result.recordset[0].RecepcionID;
            const codigoBase = `PRE-${newId}`;

            await new sql.Request(transaction)
                .input('ID', sql.Int, newId)
                .input('Cod', sql.VarChar(50), codigoBase)
                .query("UPDATE Recepciones SET Codigo = @Cod WHERE RecepcionID = @ID");

            // Loop Bultos
            const qty = parseInt(bultos) || 1;
            const isTelaInventory = (tipo === 'TELA DE CLIENTE' && insumoId && metros);

            for (let i = 0; i < qty; i++) {
                const uniqueCode = qty > 1 ? `${codigoBase}-${i + 1}` : codigoBase;

                // 1. Logistica (SIN ProximoServicio, que falló)
                await new sql.Request(transaction)
                    .input('Cod', sql.VarChar, uniqueCode)
                    .input('Det', sql.NVarChar, detalle)
                    .input('Tipo', sql.VarChar, tipo) // Use actual type
                    .input('UID', sql.Int, usuario ? usuario.id : 1)
                    .input('RID', sql.Int, newId) // Link to Recepcion Table
                    .query(`
                        INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, RecepcionID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                        VALUES (@Cod, @Tipo, NULL, @RID, @Det, 'RECEPCION', 'EN_STOCK', @UID);
                    `);

                // 2. Inventario (Si aplica)
                if (isTelaInventory) {
                    // Generar código de bobina estilo BOB (Timestamp) para consistencia si se prefiere, 
                    // pero para mantener simpleza ahora usaremos PRE como base o lo que el sistema permita.
                    // El usuario mostró BOB-... en las filas buenas. Vamos a intentar emular eso o dejar PRE pero con datos correctos.
                    // Si el usuario quiere BOB, deberiamos cambiar uniqueCode. 
                    // PERO, lo crítico es AREA y CLIENTE.

                    // Generar código BOB real (Timestamp + Random)
                    const bobinaCode = `BOB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                    const areaFinal = areaDestino || 'RECEPCION';

                    const invRes = await new sql.Request(transaction)
                        .input('IID', sql.Int, insumoId)
                        .input('Area', sql.VarChar(50), areaFinal)
                        .input('Met', sql.Decimal(10, 2), metros)
                        .input('Lote', sql.NVarChar(100), loteProv || 'S/L')
                        .input('Code', sql.NVarChar(100), bobinaCode) // BOB-XXX
                        .input('Ref', sql.NVarChar(100), uniqueCode)  // REFERENCIA: PRE-XXX
                        .input('Cli', sql.VarChar(255), clienteId)    // ClienteID
                        .query(`
                            INSERT INTO InventarioBobinas (InsumoID, AreaID, MetrosIniciales, MetrosRestantes, Estado, LoteProveedor, CodigoEtiqueta, Referencia, ClienteID)
                            OUTPUT INSERTED.BobinaID
                            VALUES (@IID, @Area, @Met, @Met, 'Disponible', @Lote, @Code, @Ref, @Cli);
                        `);

                    const bobinaId = invRes.recordset[0].BobinaID;

                    // Registro Movimiento
                    await new sql.Request(transaction)
                        .input('IID', sql.Int, insumoId)
                        .input('BID', sql.Int, bobinaId)
                        .input('Cant', sql.Decimal(10, 2), metros)
                        .input('Ref', sql.NVarChar(200), `Ingreso T.Cliente ${uniqueCode}`)
                        .input('UID', sql.Int, usuario ? usuario.id : null)
                        .query(`
                            INSERT INTO MovimientosInsumos (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID)
                            VALUES (@IID, @BID, 'INGRESO', @Cant, @Ref, @UID)
                        `);
                }
            }

            // ... (Loop Bultos Logic) ...

            // ===============================================
            // AUTO-FULFILL REQUIREMENTS IF ORDER LINKED
            // ===============================================
            if (referencias && referencias.length > 0) {
                for (const ref of referencias) {
                    // Try to match ref to Order ID/Code
                    // Assuming ref is the Order Code directly from the UI Select
                    if (!ref || ref === 'OTRA') continue;

                    const ordRes = await new sql.Request(transaction)
                        .input('Code', sql.VarChar(50), ref)
                        .query("SELECT OrdenID FROM Ordenes WHERE CodigoOrden = @Code OR CAST(OrdenID as VarChar) = @Code");

                    if (ordRes.recordset.length > 0) {
                        const linkedOrdenId = ordRes.recordset[0].OrdenID;
                        let reqSearch = '';
                        if (tipo === 'TELA DE CLIENTE') reqSearch = '%TELA%';
                        if (tipo === 'PAQUETE DE PRENDAS') reqSearch = '%PRENDA%';

                        if (reqSearch) {
                            // SOLO VINCULAR MATERIAL A LA ORDEN (No marcar requisito aun)

                            // 1. Vincular Logistica_Bultos (SIEMPRE, sea Tela o Paquete)
                            await new sql.Request(transaction)
                                .input('OID', sql.Int, linkedOrdenId)
                                .input('RecCode', sql.VarChar(50), codigoBase + '%')
                                .query(`
                                    UPDATE Logistica_Bultos
                                    SET OrdenID = @OID 
                                    WHERE CodigoEtiqueta LIKE @RecCode
                                `);

                            // 2. Si es TELA, vincular InventarioBobinas
                            // IMPORTANTE: Buscar por REFERENCIA (que contiene el PRE-Code), ya que CodigoEtiqueta es BOB-...
                            if (tipo === 'TELA DE CLIENTE' && insumoId && metros) {
                                await new sql.Request(transaction)
                                    .input('OID', sql.Int, linkedOrdenId)
                                    .input('RecCode', sql.VarChar(50), codigoBase + '%')
                                    .query(`
                                        UPDATE InventarioBobinas 
                                        SET OrdenID = @OID 
                                        WHERE Referencia LIKE @RecCode
                                    `);
                            }
                        }
                    }
                }
            }

            await transaction.commit();
            res.json({ success: true, ordenAsignada: codigoBase, message: `Orden ${codigoBase} guardada correctamente.` });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        console.error("Error createReception:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 2. DATOS DE INICIALIZACIÓN
// ==========================================
exports.getInitData = async (req, res) => {
    try {
        const pool = await getPool();

        // Clientes: De Ordenes y Recepciones
        const clientesRes = await pool.request().query(`
            SELECT DISTINCT Cliente FROM Ordenes WHERE Cliente IS NOT NULL
            UNION
            SELECT DISTINCT Cliente FROM Recepciones WHERE Cliente IS NOT NULL
            ORDER BY Cliente
        `);
        const clientes = clientesRes.recordset.map(r => r.Cliente);

        // Servicios: DESDE TABLA AREAS (Corregido 'Nombre')
        const areasRes = await pool.request().query("SELECT AreaID, Nombre FROM Areas ORDER BY Nombre");
        const servicios = areasRes.recordset.map(r => r.Nombre);
        const areas = areasRes.recordset; // Full objects for ID

        // Insumos (Solo telas o general? Traemos todo por ahora o filtramos)
        // User wants "como si fuera a ingresar una bobina".
        const insumosRes = await pool.request().query("SELECT InsumoID, Nombre, CodigoReferencia FROM Insumos ORDER BY Nombre");
        const insumos = insumosRes.recordset;

        // Tipos
        const tipos = ['PAQUETE DE PRENDAS', 'TELA DE CLIENTE'];

        // Proximo ID (Estimado)
        const identRes = await pool.request().query("SELECT IDENT_CURRENT('Recepciones') + 1 as NextID");
        const nextId = identRes.recordset[0].NextID || 1;

        res.json({
            clientes,
            servicios,
            areas,
            insumos,
            tipos,
            prefix: 'PRE',
            nextCode: `PRE-${nextId}`
        });

    } catch (err) {
        console.error("Error getInitData:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 3. HISTORIAL
// ==========================================
exports.getHistory = async (req, res) => {
    const { cliente, orden, fechaDesde, fechaHasta, page = 1, pageSize = 50 } = req.query;
    const offset = (page - 1) * pageSize;

    try {
        const pool = await getPool();
        const request = pool.request();

        let query = `
            SELECT * FROM Recepciones WHERE 1=1
        `;

        if (cliente) {
            request.input('Cli', sql.VarChar(255), `%${cliente}%`);
            query += " AND Cliente LIKE @Cli";
        }
        if (orden) {
            request.input('Ord', sql.VarChar(50), `%${orden}%`);
            query += " AND Codigo LIKE @Ord";
        }
        if (fechaDesde) {
            request.input('FD', sql.DateTime, fechaDesde);
            query += " AND FechaRecepcion >= @FD";
        }
        if (fechaHasta) {
            request.input('FH', sql.DateTime, new Date(fechaHasta + 'T23:59:59'));
            query += " AND FechaRecepcion <= @FH";
        }

        // Count Total
        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as Total');
        const countRes = await request.query(countQuery);
        const total = countRes.recordset[0].Total;

        // Paging
        query += ` ORDER BY RecepcionID DESC OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;

        const result = await request.query(query);

        res.json({
            rows: result.recordset,
            total,
            page: parseInt(page),
            pageSize: parseInt(pageSize)
        });

    } catch (err) {
        console.error("Error getHistory:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 4. ORDENES POR CLIENTE
// ==========================================
exports.getOrdersByClient = async (req, res) => {
    const { cliente } = req.query;
    try {
        const pool = await getPool();
        const request = pool.request();

        let query = `
            SELECT TOP 50 CodigoOrden 
            FROM Ordenes 
            WHERE Cliente = @Cli
            ORDER BY OrdenID DESC
        `;

        const result = await request.input('Cli', sql.VarChar(255), cliente).query(query);

        res.json(result.recordset.map(r => r.CodigoOrden));
    } catch (err) {
        console.error("Error getOrdersByClient:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 5. STOCK ACTUAL EN RECEPCION (PARA DESPACHAR)
// ==========================================
exports.getStock = async (req, res) => {
    try {
        const pool = await getPool();
        const request = pool.request();

        // Obtener bultos en Ubicacion 'RECEPCION'
        // Join con Recepciones para tener info del cliente
        const query = `
            SELECT 
                lb.BultoID, 
                lb.CodigoEtiqueta, 
                lb.Estado, 
                lb.UbicacionActual,
                r.Cliente,
                r.Tipo,
                r.Detalle,
                r.Referencias,
                r.FechaRecepcion,
                r.ProximoServicio,
                r.CantidadBultos as TotalBultosOrden
            FROM Logistica_Bultos lb
            LEFT JOIN Recepciones r ON (lb.CodigoEtiqueta = r.Codigo OR lb.CodigoEtiqueta LIKE r.Codigo + '-%')
            LEFT JOIN Logistica_EnvioItems lei ON lb.BultoID = lei.BultoID AND lei.EstadoRecepcion = 'PENDIENTE'
            LEFT JOIN Logistica_Envios le ON lei.EnvioID = le.EnvioID
            WHERE 
                (lb.UbicacionActual = 'RECEPCION' AND lb.Estado = 'EN_STOCK')
                OR 
                (lb.Estado = 'EN_TRANSITO' AND le.AreaOrigenID = 'RECEPCION')
            ORDER BY r.FechaRecepcion DESC
        `;

        const result = await request.query(query);
        res.json(result.recordset);

    } catch (err) {
        console.error("Error getStock:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 6. OBTENER ORDENES PARA TELA CLIENTE
// ==========================================
exports.getPotentialOrdersForFabric = async (req, res) => {
    const { cliente, area } = req.query;
    if (!cliente) return res.json([]);

    try {
        const pool = await getPool();
        const request = pool.request();

        let sqlQry = `
            SELECT TOP 50 OrdenID, CodigoOrden, DescripcionTrabajo, Material, AreaID, Estado
            FROM Ordenes
            WHERE Cliente = @Cli
            AND Estado NOT IN ('Finalizado', 'Entregado', 'Cancelado')
        `;

        if (area) {
            sqlQry += ` AND AreaID = @Area`;
            request.input('Area', sql.VarChar, area);
        }

        // Filtro Especifico segun Tipo
        if (req.query.type === 'TELA') {
            sqlQry += ` AND (Material LIKE '%TELA CLIENTE%' OR Material LIKE '%TELA DE CLIENTE%' OR DescripcionTrabajo LIKE '%TELA CLIENTE%')`;
        }

        sqlQry += ` ORDER BY OrdenID DESC`;

        request.input('Cli', sql.NVarChar, cliente);

        const result = await request.query(sqlQry);
        res.json(result.recordset);

    } catch (err) {
        console.error("Error getPotentialOrdersForFabric:", err);
        res.status(500).json({ error: err.message });
    }
};
