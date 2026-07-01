const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const pdfService = require('../services/pdfService');
const fs   = require('fs');
const path = require('path');

// ==========================================
// 1. GUARDAR RECEPCIÓN
// ==========================================

exports.createReception = async (req, res) => {
    const { clienteId, tipo, servicios, telaCliente, bultos, referencias, observaciones,
        insumoId, metros, loteProv, areaDestino, sumaTelaExistente,
        // Para TELA DE CLIENTE: array de bobinas con medidas individuales
        bobinas } = req.body;

    // Para TELA DE CLIENTE usamos el array; para otros tipos el campo metros/bultos clásico
    const esTela = tipo === 'TELA DE CLIENTE';
    const bobinasList = esTela && Array.isArray(bobinas) && bobinas.length > 0
        ? bobinas
        : null;
    // Total metros para referencias y comprobante (suma de largos si es tela con array)
    const metrosTotal = bobinasList
        ? bobinasList.reduce((s, b) => s + (parseFloat(b.largo) || 0), 0)
        : (parseFloat(metros) || 0);
    const cantBultos  = bobinasList ? bobinasList.length : (parseInt(bultos) || 1);

    // Operario desde el JWT — el token lleva: { id, username, name (=Nombre), role, ... }
    const operarioNombre = req.user?.name || req.user?.username || 'Operario';
    const operarioId     = req.user?.id || 1;

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
                .input('Bultos', sql.Int, cantBultos)
                .input('Ref', sql.NVarChar(sql.MAX), [...(referencias || []), metrosTotal ? `Mts:${metrosTotal.toFixed(2)}` : ''].filter(Boolean).join(' | '))
                .input('Obs', sql.NVarChar(sql.MAX), finalObs)
                .input('UID', sql.Int, operarioId)
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

            // ── Loop Bultos / Bobinas ──────────────────────────────────────
            const qty = cantBultos;
            const isTelaInventory = (esTela && insumoId && (bobinasList || metros));

            for (let i = 0; i < qty; i++) {
                const uniqueCode = qty > 1 ? `${codigoBase}-${i + 1}` : codigoBase;

                // Medidas de esta bobina (array o campos clásicos)
                const bDatos = bobinasList ? bobinasList[i] : null;
                const bLargo = bDatos ? (parseFloat(bDatos.largo) || 0) : (parseFloat(metros) || 0);
                const bAncho = bDatos ? (parseFloat(bDatos.ancho) || null) : null;
                const bPeso  = bDatos ? (parseFloat(bDatos.peso)  || null) : null;

                // 1. Logistica
                await new sql.Request(transaction)
                    .input('Cod', sql.VarChar, uniqueCode)
                    .input('Det', sql.NVarChar, detalle)
                    .input('Tipo', sql.VarChar, tipo)
                    .input('UID', sql.Int, operarioId)
                    .input('RID', sql.Int, newId)
                    .query(`
                        INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, RecepcionID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                        VALUES (@Cod, @Tipo, NULL, @RID, @Det, 'RECEPCION', 'EN_STOCK', @UID);
                    `);

                // 2. Inventario (Tela de Cliente)
                if (isTelaInventory) {
                    const areaFinal  = areaDestino || 'RECEPCION';

                    const req2 = new sql.Request(transaction)
                        .input('IID',   sql.Int,            insumoId)
                        .input('Area',  sql.VarChar(50),    areaFinal)
                        .input('Met',   sql.Decimal(10,2),  bLargo)
                        .input('Lote',  sql.NVarChar(100),  loteProv || 'S/L')
                        .input('Code',  sql.NVarChar(100),  'BOB-TEMP')   // se actualiza tras conocer BobinaID
                        .input('Ref',   sql.NVarChar(100),  uniqueCode)
                        .input('Cli',   sql.VarChar(255),   clienteId)
                        .input('Desc',  sql.NVarChar(200),  telaCliente || null);  // Nombre de la tela

                    if (bAncho !== null) req2.input('Ancho', sql.Decimal(10,2), bAncho);
                    if (bPeso  !== null) req2.input('Peso',  sql.Decimal(10,2), bPeso);

                    const invRes = await req2.query(`
                        INSERT INTO InventarioBobinas
                            (InsumoID, AreaID, MetrosIniciales, MetrosRestantes, Estado, LoteProveedor,
                             CodigoEtiqueta, Referencia, ClienteID, DescripcionTela
                             ${bAncho !== null ? ', Ancho' : ''}
                             ${bPeso  !== null ? ', Peso'  : ''})
                        OUTPUT INSERTED.BobinaID
                        VALUES (@IID, @Area, @Met, @Met, 'Pendiente', @Lote, @Code, @Ref, @Cli, @Desc
                            ${bAncho !== null ? ', @Ancho' : ''}
                            ${bPeso  !== null ? ', @Peso'  : ''});
                    `);

                    const bobinaId  = invRes.recordset[0].BobinaID;
                    const shortCode = `BOB-${bobinaId}`;

                    // Actualizar CodigoEtiqueta con el código corto definitivo
                    await new sql.Request(transaction)
                        .input('BID',  sql.Int,          bobinaId)
                        .input('Code', sql.NVarChar(100), shortCode)
                        .query('UPDATE InventarioBobinas SET CodigoEtiqueta = @Code WHERE BobinaID = @BID');

                    // Descripción del movimiento incluyendo dimensiones
                    const dimStr = [bAncho !== null ? `A:${bAncho.toFixed(2)}m` : '', bPeso !== null ? `P:${bPeso.toFixed(2)}kg` : '']
                        .filter(Boolean).join(' ');
                    const refStr = `Ingreso T.Cliente ${uniqueCode}${dimStr ? ` [${dimStr}]` : ''}`;

                    await new sql.Request(transaction)
                        .input('IID',  sql.Int,           insumoId)
                        .input('BID',  sql.Int,           bobinaId)
                        .input('Cant', sql.Decimal(10,2), bLargo)
                        .input('Ref',  sql.NVarChar(200), refStr)
                        .input('UID',  sql.Int,           operarioId)
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

            // ============================================================
            // GENERAR Y GUARDAR COMPROBANTE PDF (para TELA DE CLIENTE)
            // ============================================================
            let comprobantePath = null;
            if (tipo === 'TELA DE CLIENTE') {
                try {
                    comprobantePath = await generarComprobanteRecepcion({
                        codigo:              codigoBase,
                        clienteId,
                        tipo,
                        telaCliente,
                        metros:              metrosTotal,
                        bultos:              qty,
                        bobinas:             bobinasList,
                        areaDestino,
                        loteProv,
                        observaciones:       finalObs,
                        operario:            operarioNombre,
                        fecha:               new Date(),
                        sumaTelaExistente:   sumaTelaExistente || null,
                    });
                } catch (pdfErr) {
                    logger.warn('[RECEPCION] Error generando comprobante PDF (no bloquea):', pdfErr.message);
                }
            }

            res.json({
                success:         true,
                ordenAsignada:   codigoBase,
                comprobantePath: comprobantePath || null,
                operario:        operarioNombre,
                message:         `Orden ${codigoBase} guardada correctamente.`
            });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        logger.error("Error createReception:", err);
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
        logger.error("Error getInitData:", err);
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

        let whereClauses = ['1=1'];

        if (cliente) {
            request.input('Cli', sql.VarChar(255), `%${cliente}%`);
            whereClauses.push("(r.Cliente LIKE @Cli OR c.Nombre LIKE @Cli OR c.NombreFantasia LIKE @Cli)");
        }
        if (orden) {
            request.input('Ord', sql.VarChar(50), `%${orden}%`);
            whereClauses.push("r.Codigo LIKE @Ord");
        }
        if (fechaDesde) {
            request.input('FD', sql.DateTime, fechaDesde);
            whereClauses.push("r.FechaRecepcion >= @FD");
        }
        if (fechaHasta) {
            request.input('FH', sql.DateTime, new Date(fechaHasta + 'T23:59:59'));
            whereClauses.push("r.FechaRecepcion <= @FH");
        }

        const where = whereClauses.join(' AND ');

        const baseQuery = `
            FROM Recepciones r
            LEFT JOIN dbo.Clientes c WITH(NOLOCK)
                ON TRY_CAST(r.Cliente AS INT) = c.CliIdCliente
            WHERE ${where}
        `;

        // Count Total
        const countRes = await request.query(`SELECT COUNT(*) as Total ${baseQuery}`);
        const total = countRes.recordset[0].Total;

        // Paging
        const result = await request.query(`
            SELECT
                r.*,
                RTRIM(LTRIM(COALESCE(NULLIF(c.NombreFantasia,''), c.Nombre, r.Cliente))) AS ClienteNombre,
                RTRIM(LTRIM(c.IDCliente)) AS IDCliente
            ${baseQuery}
            ORDER BY r.RecepcionID DESC
            OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
        `);

        res.json({
            rows: result.recordset,
            total,
            page: parseInt(page),
            pageSize: parseInt(pageSize)
        });

    } catch (err) {
        logger.error("Error getHistory:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 3b. BOBINAS POR ORDEN (para reimpresion desde historial)
// ==========================================
exports.getBobinasByOrden = async (req, res) => {
    const { orden } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('Ref', sql.VarChar(50), orden)
            .query(`
                SELECT
                    ib.BobinaID,
                    ib.Referencia,
                    ib.MetrosIniciales  AS largo,
                    ib.Ancho            AS ancho,
                    ib.Peso             AS peso,
                    ib.DescripcionTela  AS tela
                FROM InventarioBobinas ib
                WHERE ib.Referencia LIKE @Ref + '%'
                ORDER BY ib.BobinaID
            `);
        res.json({ bobinas: result.recordset });
    } catch (err) {
        logger.error('Error getBobinasByOrden:', err.message);
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
        logger.error("Error getOrdersByClient:", err);
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
        logger.error("Error getStock:", err);
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
        logger.error("Error getPotentialOrdersForFabric:", err);
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// HELPER: Generar comprobante PDF estilo Macrosoft
// ============================================================
const generarComprobanteRecepcion = async ({ codigo, clienteId, tipo, telaCliente, metros, bultos,
    bobinas, areaDestino, loteProv, observaciones, operario, fecha, sumaTelaExistente }) => {

    const doc      = await PDFDocument.create();
    // ~80mm x 160mm en puntos  (1mm ≈ 2.835 pt)
    const page     = doc.addPage([226.77, 453.54]);
    const { width, height } = page.getSize();
    const font     = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    // ── CABECERA OSCURA (idéntica a pdfService) ────────────────────────
    page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: rgb(0.08, 0.08, 0.12) });
    page.drawText('USER', { x: 10, y: height - 28, size: 18, font: fontBold, color: rgb(1, 1, 1) });
    page.drawText('Atención al Cliente', { x: 10, y: height - 44, size: 7.5, font, color: rgb(0.65, 0.65, 0.75) });
    page.drawText('Recepción de Tela', { x: 10, y: height - 56, size: 7, font, color: rgb(0.5, 0.7, 1) });

    // Código en la cabecera (alineado a la derecha)
    const codLen   = codigo.length * 6.5;
    const codeX    = Math.max(width - 12 - codLen, 80);
    page.drawText(codigo, { x: codeX, y: height - 44, size: 12, font: fontBold, color: rgb(1, 0.4, 0.4) });

    // ── FILAS DE DATOS ─────────────────────────────────────────────────
    const fmtDate = (d) => {
        try {
            return new Date(d).toLocaleString('es-UY', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
        } catch { return String(d); }
    };

    // Filas de detalle por bobina (si se enviaron con medidas individuales)
    const bobinaRows = Array.isArray(bobinas) && bobinas.length > 0
        ? bobinas.map((b, idx) => {
            const partes = [`${parseFloat(b.largo||0).toFixed(2)}m`];
            if (b.ancho) partes.push(`A:${parseFloat(b.ancho).toFixed(2)}m`);
            if (b.peso)  partes.push(`P:${parseFloat(b.peso).toFixed(2)}kg`);
            return [`Bob.${idx+1}`, partes.join(' · ')];
          })
        : [];

    const filas = [
        ['Fecha',              fmtDate(fecha)],
        ['Cliente',            clienteId],
        ['Recibido por',       operario],
        ['Tipo de Tela',       telaCliente || '-'],
        ...(sumaTelaExistente ? [['Suma a tela',      sumaTelaExistente]] : []),
        ['Mts Total / Bultos', `${metros ? parseFloat(metros).toFixed(2) + ' m' : '-'} / ${bultos}`],
        ...bobinaRows,
        ['Area Destino',       areaDestino || '-'],
        ...(loteProv         ? [['Lote Proveedor',  loteProv]] : []),
        ...(observaciones    ? [['Observaciones',   observaciones.substring(0, 45)]] : []),
    ];

    let y = height - 84;
    filas.forEach(([label, value], i) => {
        if (i % 2 === 0) {
            page.drawRectangle({ x: 0, y: y - 4, width, height: 16, color: rgb(0.96, 0.96, 0.96) });
        }
        page.drawText(`${label}:`, { x: 8,            y, size: 7.5, font,     color: rgb(0.4, 0.4, 0.4) });
        const val = (value || '—').substring(0, 30);
        page.drawText(val,          { x: width / 2 - 5, y, size: 8,   font: fontBold, color: rgb(0.08, 0.08, 0.08) });
        y -= 18;
    });

    // ── PIE ────────────────────────────────────────────────────────────
    page.drawLine({ start: { x: 8, y: 30 }, end: { x: width - 8, y: 30 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    page.drawText('Conserve este comprobante · USER ERP', { x: 10, y: 18, size: 6.5, font, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(`Generado: ${fmtDate(new Date())}`,     { x: 10, y: 8,  size: 5.5, font, color: rgb(0.7, 0.7, 0.7) });

    const pdfBytes = await doc.save();

    // Guardar en comprobantesPagos/recepciones/
    const baseDir  = process.env.COMPROBANTES_PATH || path.join(__dirname, '..', 'comprobantesPagos');
    const dir      = path.join(baseDir, 'recepciones');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const fileName = `${codigo.replace(/[<>:"/\\|?*]/g, '_')}.pdf`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, Buffer.from(pdfBytes));
    logger.info(`[RECEPCION-PDF] Comprobante guardado: ${filePath}`);

    return `/recepciones/${fileName}`; // ruta relativa para servir desde el backend
};

// ==========================================
// 7. GUARDAR COMPROBANTE (base64 → disco)
//    Mismo mecanismo que /contabilidad/caja/guardar-comprobante
// ==========================================
exports.guardarComprobante = async (req, res) => {
    const { nombreDocumento, pdfBase64 } = req.body;
    if (!nombreDocumento || !pdfBase64) {
        return res.status(400).json({ error: 'Faltan parámetros nombreDocumento o pdfBase64' });
    }
    try {
        const filePath = pdfService.guardarDesdeBase64(nombreDocumento, pdfBase64, 'recepciones');
        logger.info('[RECEPCION-COMPROBANTE] Guardado: ' + filePath);
        return res.json({ success: true, path: filePath });
    } catch (err) {
        logger.error('[RECEPCION-COMPROBANTE] Error al guardar: ' + err.message);
        return res.status(500).json({ error: err.message });
    }
};
