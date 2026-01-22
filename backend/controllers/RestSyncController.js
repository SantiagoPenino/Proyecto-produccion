const axios = require('axios');
const { sql, getPool } = require('../config/db');
const fileProcessingService = require('../services/fileProcessingService');

// Semáforo para evitar ejecuciones superpuestas del scheduler
let isProcessing = false;

// --- LÓGICA MAESTRA DE SINCRONIZACIÓN (V3 FINAL - APLANADO + LOOKAHEAD AVANZADO) ---
const syncOrdersLogic = async (io) => {
    if (isProcessing) {
        console.log("⏳ [Sync] Proceso ocupado. Saltando ciclo.");
        return { success: false, message: "Busy" };
    }
    isProcessing = true;

    try {
        console.log("🏁 INICIANDO SYNC (V3 FINAL - DEBUG MODE) - " + new Date().toISOString());
        const pool = await getPool();

        // 1. Obtener última factura
        const configRes = await pool.request().query(`
            SELECT (SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'ULTIMAFACTURA') as UltimaFact
        `);
        let ultimaFacturaDB = parseInt(configRes.recordset[0]?.UltimaFact) || 0;
        console.log(`🔄 Última Factura en DB: ${ultimaFacturaDB}`);

        // 2. Traer pedidos NUEVOS
        const API_BASE = process.env.ERP_API_URL || 'http://localhost:6061';
        let rawPedidos = [];
        try {
            const response = await axios.get(`${API_BASE}/api/pedidos/todos?NroFact=${ultimaFacturaDB}`);
            rawPedidos = response.data.data || [];
        } catch (apiErr) {
            console.error(`❌ Error ERP:`, apiErr.message);
            return { success: false, error: "Fallo conexión ERP" };
        }

        const nuevosPedidos = rawPedidos.filter(p => parseInt(p.NroFact) > ultimaFacturaDB);

        if (nuevosPedidos.length === 0) {
            console.log(`✅ Sin pedidos nuevos.`);
            return { success: true, message: 'Up to date' };
        }

        console.log(`📥 Procesando ${nuevosPedidos.length} encabezados...`);

        // 3. Obtener Mapeo de Áreas
        const mappingRes = await pool.request().query("SELECT CodigoERP, AreaID_Interno, Numero FROM ConfigMapeoERP");
        const mapaAreasERP = {};
        mappingRes.recordset.forEach(row => {
            mapaAreasERP[row.CodigoERP.trim()] = {
                area: row.AreaID_Interno.trim(),
                orden: row.Numero || 999
            };
        });

        // 4. AGRUPAMIENTO INICIAL (Por Documento ERP)
        let pedidosAgrupados = {};
        let maxFacturaProcesada = ultimaFacturaDB;

        for (const p of nuevosPedidos) {
            const facturaNum = parseInt(p.NroFact);
            if (facturaNum > maxFacturaProcesada) maxFacturaProcesada = facturaNum;

            let detalle = p;
            try {
                const detRes = await axios.get(`${API_BASE}/api/pedidos/${p.NroFact}/con_sublineas`);
                if (detRes.data?.data) detalle = detRes.data.data;
            } catch (e) {
                console.warn(`⚠️ Error detalle ${p.NroFact}. Usando cabecera.`);
            }

            // Usar NroDoc para agrupar, o NroFact si no hay Doc. Y asegurar TRIM agresivo.
            let nroDoc = detalle.NroDoc ? detalle.NroDoc.toString().trim() : "";
            if (!nroDoc) nroDoc = p.NroFact.toString().trim(); // Fallback a Factura si no hay Doc


            if (!pedidosAgrupados[nroDoc]) {
                const idDesc = (detalle.identificadores || []).find(x => x.CodId === 1)?.Descripcion || (detalle.identificadores || []).find(x => x.CodId === 1)?.Valor || "Sin Nombre";
                const idPrioridad = (detalle.identificadores || []).find(x => x.CodId === 2)?.Descripcion || (detalle.identificadores || []).find(x => x.CodId === 2)?.Valor || "Normal";

                pedidosAgrupados[nroDoc] = {
                    nroFact: p.NroFact,
                    nroDoc: nroDoc,
                    cliente: detalle.Nombre || "Cliente General",
                    fecha: new Date(detalle.Fecha),
                    trabajo: idDesc,
                    prioridad: idPrioridad,
                    notaGeneral: detalle.Observaciones || "",
                    areas: {}
                };
            }

            const docObj = pedidosAgrupados[nroDoc];
            const lineas = detalle.Lineas || [];

            for (const l of lineas) {
                const grp = (l.Grupo || "").trim();
                let mapInfo = mapaAreasERP[grp];
                let areaID = mapInfo?.area;
                let areaOrden = mapInfo?.orden;

                // Fallback CodStock
                if (!areaID) {
                    try {
                        const dbStk = await pool.request()
                            .input('stk', sql.VarChar, l.CodStock)
                            .query("SELECT TOP 1 Articulo FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = LTRIM(RTRIM(@stk))");
                    } catch (e) { }
                }

                if (!areaID) continue;

                if (!docObj.areas[areaID]) {
                    docObj.areas[areaID] = {
                        areaId: areaID,
                        prioridad: areaOrden || 999,
                        tinta: "",
                        retiro: "",
                        gruposMaterial: {}
                    };
                }
                const areaObj = docObj.areas[areaID];
                const codArtKey = (l.CodArt || 'GENERICO').trim();

                if (!areaObj.gruposMaterial[codArtKey]) {
                    areaObj.gruposMaterial[codArtKey] = {
                        codArt: codArtKey,
                        nombreMaterial: l.Descripcion || "Material",
                        variante: "Estándar",
                        itemsProductivos: [],
                        itemsReferencias: [],
                        itemsExtras: []
                    };
                }
                const currentMatGroup = areaObj.gruposMaterial[codArtKey];

                // --- RECUPERAR DATOS ADICIONALES (STOCKART) ---
                try {
                    const varRes = await pool.request()
                        .input('stk', sql.VarChar, l.CodStock)
                        .query("SELECT TOP 1 LTRIM(RTRIM(Articulo)) as Variante, LTRIM(RTRIM(UM)) as UnidadMedida FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = LTRIM(RTRIM(@stk))");

                    if (varRes.recordset[0]) {
                        if (varRes.recordset[0].Variante) currentMatGroup.variante = varRes.recordset[0].Variante;
                        if (varRes.recordset[0].UnidadMedida) currentMatGroup.unidad = varRes.recordset[0].UnidadMedida;
                    }
                } catch (e) { }

                const sublineas = l.Sublineas || [];
                let allNotas = (l.Observaciones || "") + " | " + sublineas.map(sl => sl.Notas || "").join(" | ");

                const matchTinta = allNotas.match(/Tinta:\s*([^|]+)/i);
                if (matchTinta) areaObj.tinta = matchTinta[1].trim();

                const matchRetiro = allNotas.match(/Retiro:\s*([^|]+)/i);
                if (matchRetiro) areaObj.retiro = matchRetiro[1].trim();

                // --- CLASIFICACIÓN DE ITEMS ---
                if (sublineas.length === 0) {
                    if ((Number(l.TotalLinea) || 0) > 0) {
                        currentMatGroup.itemsExtras.push({
                            cod: l.CodArt, stock: l.CodStock, desc: l.Descripcion,
                            cant: l.CantidadHaber, obs: "Sin desglose"
                        });
                    }
                } else {
                    sublineas.forEach(sl => {
                        const link = sl.Archivo || "";
                        const cant = Number(sl.CantCopias) || 0;
                        const notasSL = (sl.Notas || "").toLowerCase();

                        const esRef = notasSL.includes("boceto") || notasSL.includes("logo") ||
                            notasSL.includes("guia") || notasSL.includes("corte") || notasSL.includes("bordado");
                        const esExtra = !link && cant > 0 && !esRef;

                        if (esRef && link) {
                            let tipo = 'REFERENCIA';
                            if (notasSL.includes("boceto")) tipo = 'BOCETO';
                            if (notasSL.includes("logo")) tipo = 'LOGO';
                            if (notasSL.includes("corte")) tipo = 'CORTE';

                            currentMatGroup.itemsReferencias.push({
                                tipo: tipo, link: link, nombre: sl.Notas || "Ref", notas: sl.Notas
                            });
                        } else if (esExtra) {
                            currentMatGroup.itemsExtras.push({
                                cod: l.CodArt, stock: l.CodStock, desc: `${l.Descripcion} (${sl.Notas})`,
                                cant: cant, obs: sl.Notas
                            });
                        } else if (link && cant > 0) {
                            currentMatGroup.itemsProductivos.push({
                                nombre: l.Descripcion, link: link, copias: cant,
                                metros: 0,
                                subId: sl.Sublinea_id, codArt: l.CodArt, tipo: 'Impresion', notas: sl.Notas
                            });
                        }
                    });
                }
            }
        }

        // 5. INSERCIÓN TRANSACCIONAL (ESTRATEGIA PLANA FINAL)
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        let generatedCodes = [];
        let createdOrderIds = [];

        try {
            for (const docId in pedidosAgrupados) {
                const docData = pedidosAgrupados[docId];

                // A. APLANAR TODO EL DOCUMENTO EN UNA LISTA SECUENCIAL
                const sortedAreaIDs = Object.keys(docData.areas).sort((a, b) => docData.areas[a].prioridad - docData.areas[b].prioridad);

                let ordenesAInsertar = [];

                for (const areaID of sortedAreaIDs) {
                    const areaObj = docData.areas[areaID];
                    const matKeys = Object.keys(areaObj.gruposMaterial);

                    for (const matKey of matKeys) {
                        const grp = areaObj.gruposMaterial[matKey];
                        if (grp.itemsProductivos.length > 0 || grp.itemsReferencias.length > 0 || grp.itemsExtras.length > 0) {
                            ordenesAInsertar.push({
                                areaID: areaID,
                                areaObj: areaObj,
                                matGroup: grp
                            });
                        }
                    }
                }

                // B. INSERTAR SECUENCIALMENTE
                const totalDocOrdenes = ordenesAInsertar.length;

                for (let i = 0; i < totalDocOrdenes; i++) {
                    const ordData = ordenesAInsertar[i];
                    const { areaID, areaObj, matGroup } = ordData;

                    // 1. Numeración Global
                    const globalIndex = i + 1;
                    const codigoOrden = `${docData.nroDoc} (${globalIndex}/${totalDocOrdenes})`;
                    generatedCodes.push(codigoOrden);

                    // 2. Próximo Servicio (Lookahead Avanzado - Bloques)
                    let nextService = 'DEPOSITO';
                    let foundDestino = false;

                    // Escanear hacia adelante saltando hermanos del mismo grupo productivo
                    for (let k = i + 1; k < totalDocOrdenes; k++) {
                        const nextOrd = ordenesAInsertar[k];
                        const nextVar = (nextOrd.matGroup.variante || '').toUpperCase();
                        const nextMat = (nextOrd.matGroup.nombreMaterial || '').toUpperCase(); // Chequear nombre material también

                        const isNextExtra = nextVar.includes('EXTRA') || nextVar.includes('SERVICIO') ||
                            nextMat.includes('EXTRA') || nextMat.includes('SERVICIO') || nextMat.includes('MATERIALES');

                        // CONDICIÓN 1: Cambio de Área REAL
                        if (nextOrd.areaID !== areaID) {
                            nextService = nextOrd.areaID;
                            foundDestino = true;
                            break;
                        }

                        // CONDICIÓN 2: Mismo Área pero es EXTRA (Terminación)
                        if (isNextExtra) {
                            nextService = 'TERMINACION';
                            foundDestino = true;
                            break;
                        }
                    }

                    if (!foundDestino) {
                        // Instalación check
                        if (matGroup.itemsExtras.length > 0) {
                            const descExt = matGroup.itemsExtras.map(e => e.desc.toUpperCase()).join(' ');
                            if (descExt.includes('INSTALACION') || descExt.includes('COLOCACION')) nextService = 'INSTALACION';
                        }
                    }

                    // 3. Magnitud
                    let prodMets = matGroup.itemsProductivos.reduce((a, b) => a + ((b.metros || 0) * (b.copias || 1)), 0);
                    let prodCops = matGroup.itemsProductivos.reduce((a, b) => a + (b.copias || 1), 0);
                    let servCops = matGroup.itemsExtras.reduce((a, b) => a + (b.cant || 0), 0);

                    const umReal = matGroup.unidad ? matGroup.unidad.trim() : "u";
                    let magVal = 0;
                    if (umReal.toUpperCase().startsWith('M')) magVal = prodMets;
                    else magVal = prodCops + servCops;

                    const magnitudStr = magVal > 0 ? magVal.toFixed(2) : "0";

                    // 4. INSERTAR
                    const reqO = new sql.Request(transaction);
                    const insertRes = await reqO
                        .input('AreaID', sql.VarChar, areaID)
                        .input('Cliente', sql.NVarChar, docData.cliente)
                        .input('Desc', sql.NVarChar, docData.trabajo)
                        .input('Prio', sql.VarChar, docData.prioridad)
                        .input('F_Ing', sql.DateTime, docData.fecha)
                        .input('F_Ent', sql.DateTime, new Date(docData.fecha.getTime() + 259200000))
                        .input('Mat', sql.VarChar, matGroup.nombreMaterial)
                        .input('Var', sql.VarChar, matGroup.variante || 'Estándar')
                        .input('Cod', sql.VarChar, codigoOrden)
                        .input('ERP', sql.VarChar, docData.nroDoc)
                        .input('Nota', sql.NVarChar, docData.notaGeneral)
                        .input('Tinta', sql.VarChar, areaObj.tinta)
                        .input('Retiro', sql.VarChar, areaObj.retiro || null)
                        .input('Prox', sql.VarChar, nextService)
                        .input('Mag', sql.VarChar, magnitudStr)
                        .input('UM', sql.VarChar, umReal)
                        .query(`
                            INSERT INTO Ordenes (
                                AreaID, Cliente, DescripcionTrabajo, Prioridad, Estado, EstadoenArea,
                                FechaIngreso, FechaEstimadaEntrega, Material, Variante, CodigoOrden,
                                NoDocERP, Nota, Tinta, ModoRetiro, ArchivosCount, Magnitud, ProximoServicio, UM
                            )
                            OUTPUT INSERTED.OrdenID
                            VALUES (
                                @AreaID, @Cliente, @Desc, @Prio, 'Pendiente', 'Pendiente',
                                @F_Ing, @F_Ent, @Mat, @Var, @Cod,
                                @ERP, @Nota, @Tinta, @Retiro, 0, @Mag, @Prox, @UM
                            )
                        `);

                    const newID = insertRes.recordset[0].OrdenID;
                    createdOrderIds.push(newID);

                    // Insert Items
                    for (const item of matGroup.itemsProductivos) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newID)
                            .input('Nom', sql.VarChar, `${codigoOrden} - ${item.nombre}`)
                            .input('Ruta', sql.VarChar, item.link)
                            .input('Cop', sql.Int, item.copias)
                            .input('Met', sql.Decimal(10, 2), item.metros)
                            .input('Sub', sql.Int, item.subId)
                            .input('Cod', sql.VarChar, item.codArt)
                            .input('Tipo', sql.VarChar, item.tipo)
                            .input('Obs', sql.NVarChar, item.notas)
                            .query(`INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, Copias, Metros, IdSubLineaERP, CodigoArticulo, TipoArchivo, Observaciones, FechaSubida, EstadoArchivo) VALUES (@OID, @Nom, @Ruta, @Cop, @Met, @Sub, @Cod, @Tipo, @Obs, GETDATE(), 'Pendiente')`);
                    }

                    for (const ref of matGroup.itemsReferencias) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newID)
                            .input('Tipo', sql.VarChar, ref.tipo)
                            .input('Ubi', sql.VarChar, ref.link)
                            .input('Nom', sql.VarChar, ref.nombre)
                            .input('Not', sql.NVarChar, ref.notas)
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, UbicacionStorage, NombreOriginal, NotasAdicionales, FechaSubida, UsuarioID) VALUES (@OID, @Tipo, @Ubi, @Nom, @Not, GETDATE(), 1)`);
                    }

                    for (const ext of matGroup.itemsExtras) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newID)
                            .input('Cod', sql.VarChar, ext.cod)
                            .input('Stk', sql.VarChar, ext.stock)
                            .input('Des', sql.NVarChar, ext.desc)
                            .input('Cnt', sql.Decimal(18, 2), ext.cant)
                            .input('Obs', sql.NVarChar, ext.obs)
                            .query(`INSERT INTO ServiciosExtraOrden (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro) VALUES (@OID, @Cod, @Stk, @Des, @Cnt, 0, 0, @Obs, GETDATE())`);
                    }

                    if (matGroup.itemsProductivos.length > 0) {
                        await new sql.Request(transaction).input('O', sql.Int, newID).input('C', sql.Int, matGroup.itemsProductivos.length).query("UPDATE Ordenes SET ArchivosCount = @C WHERE OrdenID = @O");
                    }

                    try { await new sql.Request(transaction).input('OrdenID', sql.Int, newID).execute('sp_CalcularFechaEntrega'); } catch (e) { }
                }
            }

            if (maxFacturaProcesada > ultimaFacturaDB) {
                await new sql.Request(transaction)
                    .input('val', sql.VarChar, maxFacturaProcesada.toString())
                    .query("UPDATE ConfiguracionGlobal SET Valor = @val WHERE Clave = 'ULTIMAFACTURA'");
            }

            await transaction.commit();
            console.log(`✅ EXITO SYNC V3. Creadas: ${generatedCodes.length}`);
            if (io && generatedCodes.length) io.emit('server:ordersUpdated', { count: generatedCodes.length });

            // ASYNC
            if (createdOrderIds.length > 0) {
                fileProcessingService.processOrderList(createdOrderIds, io);
            }

            return { success: true, count: generatedCodes.length };

        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

    } catch (e) {
        console.error("❌ CRITICAL SYNC ERROR:", e.message);
        throw e;
    } finally {
        isProcessing = false;
    }
};

exports.syncOrdersLogic = syncOrdersLogic;
exports.syncOrders = async (req, res) => {
    try {
        const r = await syncOrdersLogic(req.app.get('socketio'));
        res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
};
exports.testImportJson = async (req, res) => res.json({ ok: true });