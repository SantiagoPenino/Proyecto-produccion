const axios = require('axios');
const { sql, getPool } = require('../config/db');

// Semáforo para evitar ejecuciones superpuestas del scheduler
let isProcessing = false;

// --- LÓGICA MAESTRA DE SINCRONIZACIÓN ---
const syncOrdersLogic = async (io) => {
    if (isProcessing) {
        console.log("⏳ [Sync] Proceso ocupado. Saltando ciclo.");
        return { success: false, message: "Busy" };
    }
    isProcessing = true;

    try {
        console.log("🏁 INICIANDO SYNC (Lógica Estricta Regex)...");
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
            console.error(`❌ Error ERP Detallado:`, {
                message: apiErr.message,
                code: apiErr.code,
                status: apiErr.response?.status,
                url: apiErr.config?.url
            });
            return { success: false, error: "Fallo conexión ERP" };
        }

        // Filtrado estricto
        const nuevosPedidos = rawPedidos.filter(p => parseInt(p.NroFact) > ultimaFacturaDB);

        if (nuevosPedidos.length === 0) {
            console.log(`✅ Sin pedidos nuevos.`);
            return { success: true, message: 'Up to date' };
        }

        console.log(`📥 Procesando ${nuevosPedidos.length} encabezados de factura...`);

        // 3. Obtener Mapeo de Áreas
        const mappingRes = await pool.request().query("SELECT CodigoERP, AreaID_Interno, Numero FROM ConfigMapeoERP");
        const mapaAreasERP = {};
        mappingRes.recordset.forEach(row => {
            mapaAreasERP[row.CodigoERP.trim()] = {
                area: row.AreaID_Interno.trim(),
                orden: row.Numero || 999
            };
        });

        // 4. AGRUPAMIENTO Y CLASIFICACIÓN
        let pedidosAgrupados = {};
        let maxFacturaProcesada = ultimaFacturaDB;

        for (const p of nuevosPedidos) {
            const facturaNum = parseInt(p.NroFact);
            if (facturaNum > maxFacturaProcesada) maxFacturaProcesada = facturaNum;

            let detalle = p;
            try {
                const detRes = await axios.get(`${API_BASE}/api/pedidos/${p.NroFact}/con_sublineas`);
                if (detRes.data?.data) detalle = detRes.data.data;
            } catch (e) { console.warn(`⚠️ Error detalle ${p.NroFact}.`); }

            const nroDoc = detalle.NroDoc ? detalle.NroDoc.toString().trim() : "";
            if (!nroDoc) continue;

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
                        // Aquí deberíamos tener un mapeo de fallback real, pero por ahora solo logueamos
                    } catch (e) { }
                }

                if (!areaID) continue;

                if (!docObj.areas[areaID]) {
                    docObj.areas[areaID] = {
                        areaId: areaID,
                        prioridad: areaOrden || 999,
                        tinta: "",
                        retiro: "",
                        itemsProductivos: [],
                        itemsReferencias: [],
                        itemsExtras: [],
                        materialNames: new Set()
                    };
                }
                const areaObj = docObj.areas[areaID];
                areaObj.materialNames.add(l.Descripcion);

                const sublineas = l.Sublineas || [];

                // --- 1. CLASIFICACIÓN TINTA/RETIRO (ESTRICTA REGEX) ---
                // Concatenamos notas de la línea principal Y de las sublíneas para no perder info (ej. Tinta en la línea madre)
                let allNotas = (l.Observaciones || "") + " | " + sublineas.map(sl => sl.Notas || "").join(" | ");

                // Regex Estricta: Busca 'Tinta:' seguido de cualquier cosa que NO sea un pipe '|'
                const matchTinta = allNotas.match(/Tinta:\s*([^|]+)/i);
                if (matchTinta) {
                    areaObj.tinta = matchTinta[1].trim();
                } else {
                    // Fallback
                    const matchTipo = allNotas.match(/Tipo de impresi[óo]n:\s*([^|]+)/i);
                    if (matchTipo) areaObj.tinta = matchTipo[1].trim();
                }

                // Regex Estricta: Busca 'Retiro:' seguido de cualquier cosa que NO sea un pipe '|'
                const matchRetiro = allNotas.match(/Retiro:\s*([^|]+)/i);
                if (matchRetiro) {
                    areaObj.retiro = matchRetiro[1].trim();
                }

                // --- 2. CLASIFICACIÓN ITEMS ---
                if (sublineas.length === 0) {
                    if ((Number(l.TotalLinea) || 0) > 0) {
                        areaObj.itemsExtras.push({
                            cod: l.CodArt, stock: l.CodStock, desc: l.Descripcion,
                            cant: l.CantidadHaber, precio: l.Precio, total: l.TotalLinea,
                            obs: "Sin desglose"
                        });
                    }
                } else {
                    sublineas.forEach(sl => {
                        const link = sl.Archivo || "";
                        const cant = Number(sl.CantCopias) || 0;
                        const notasSL = (sl.Notas || "").toLowerCase();

                        const esRef = notasSL.includes("boceto") || notasSL.includes("logo") ||
                            notasSL.includes("guia") || notasSL.includes("corte") || notasSL.includes("bordado");
                        const esExtra = !link && cant > 0;

                        if (esRef && link) {
                            let tipo = 'REFERENCIA';
                            if (notasSL.includes("boceto")) tipo = 'BOCETO';
                            if (notasSL.includes("logo")) tipo = 'LOGO';
                            if (notasSL.includes("corte")) tipo = 'CORTE';

                            areaObj.itemsReferencias.push({
                                tipo: tipo, link: link, nombre: sl.Notas || "Ref", notas: sl.Notas
                            });
                        } else if (esExtra) {
                            areaObj.itemsExtras.push({
                                cod: l.CodArt, stock: l.CodStock, desc: `${l.Descripcion} (${sl.Notas})`,
                                cant: cant, precio: 0, total: 0, obs: sl.Notas
                            });
                        } else if (link && cant > 0) {
                            areaObj.itemsProductivos.push({
                                nombre: l.Descripcion, link: link, copias: cant,
                                metros: (Number(l.CantidadHaber) || 0) / (sublineas.length || 1),
                                subId: sl.Sublinea_id, codArt: l.CodArt, tipo: 'Impresion', notas: sl.Notas
                            });
                        }
                    });
                }
            } // Fin loop lineas
        } // Fin loop pedidos

        // 5. INSERCIÓN TRANSACCIONAL
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        let generatedCodes = [];

        try {
            for (const docId in pedidosAgrupados) {
                const docData = pedidosAgrupados[docId];

                const validAreaIDs = Object.keys(docData.areas).filter(aid => {
                    const a = docData.areas[aid];
                    return (a.itemsProductivos.length > 0 || a.itemsReferencias.length > 0 || a.itemsExtras.length > 0);
                });

                validAreaIDs.sort((a, b) => docData.areas[a].prioridad - docData.areas[b].prioridad);

                const totalOrdenes = validAreaIDs.length;

                for (let i = 0; i < totalOrdenes; i++) {
                    const areaID = validAreaIDs[i];
                    const areaObj = docData.areas[areaID];
                    const codigoOrden = `${docData.nroDoc} (${i + 1}/${totalOrdenes})`;
                    generatedCodes.push(codigoOrden);

                    const materialTxt = Array.from(areaObj.materialNames).join(', ').substring(0, 200);
                    let varianteTxt = "Estándar";
                    if (areaObj.itemsExtras.length > 0 && areaObj.itemsProductivos.length === 0) varianteTxt = "Solo Servicios";

                    const reqO = new sql.Request(transaction);
                    const insertRes = await reqO
                        .input('AreaID', sql.VarChar, areaID)
                        .input('Cliente', sql.NVarChar, docData.cliente)
                        .input('Desc', sql.NVarChar, docData.trabajo)
                        .input('Prio', sql.VarChar, docData.prioridad)
                        .input('F_Ing', sql.DateTime, docData.fecha)
                        .input('F_Ent', sql.DateTime, new Date(docData.fecha.getTime() + 259200000))
                        .input('Mat', sql.VarChar, materialTxt)
                        .input('Var', sql.VarChar, varianteTxt)
                        .input('Cod', sql.VarChar, codigoOrden)
                        .input('ERP', sql.VarChar, docData.nroDoc)
                        .input('Nota', sql.NVarChar, docData.notaGeneral)
                        .input('Tinta', sql.VarChar, areaObj.tinta)
                        .input('Retiro', sql.VarChar, areaObj.retiro || null)
                        .query(`
                            INSERT INTO Ordenes (
                                AreaID, Cliente, DescripcionTrabajo, Prioridad, Estado, EstadoenArea,
                                FechaIngreso, FechaEstimadaEntrega, Material, Variante, CodigoOrden,
                                NoDocERP, Nota, Tinta, ModoRetiro, ArchivosCount, Magnitud
                            )
                            OUTPUT INSERTED.OrdenID
                            VALUES (
                                @AreaID, @Cliente, @Desc, @Prio, 'Pendiente', 'Pendiente',
                                @F_Ing, @F_Ent, @Mat, @Var, @Cod,
                                @ERP, @Nota, @Tinta, @Retiro, 0, 0
                            )
                        `);

                    const newID = insertRes.recordset[0].OrdenID;

                    for (const item of areaObj.itemsProductivos) {
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
                            .query(`
                                INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, Copias, Metros, IdSubLineaERP, CodigoArticulo, TipoArchivo, Observaciones, FechaSubida, EstadoArchivo)
                                VALUES (@OID, @Nom, @Ruta, @Cop, @Met, @Sub, @Cod, @Tipo, @Obs, GETDATE(), 'Pendiente')
                            `);
                    }
                    if (areaObj.itemsProductivos.length > 0) {
                        await new sql.Request(transaction).input('O', sql.Int, newID).input('C', sql.Int, areaObj.itemsProductivos.length).query("UPDATE Ordenes SET ArchivosCount = @C WHERE OrdenID = @O");
                    }

                    for (const ref of areaObj.itemsReferencias) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newID)
                            .input('Tipo', sql.VarChar, ref.tipo)
                            .input('Ubi', sql.VarChar, ref.link)
                            .input('Nom', sql.VarChar, ref.nombre)
                            .input('Not', sql.NVarChar, ref.notas)
                            .query(`
                                INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, UbicacionStorage, NombreOriginal, NotasAdicionales, FechaSubida, UsuarioID)
                                VALUES (@OID, @Tipo, @Ubi, @Nom, @Not, GETDATE(), 1) 
                            `);
                    }

                    for (const ext of areaObj.itemsExtras) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newID)
                            .input('Cod', sql.VarChar, ext.cod)
                            .input('Stk', sql.VarChar, ext.stock)
                            .input('Des', sql.NVarChar, ext.desc)
                            .input('Cnt', sql.Decimal(18, 2), ext.cant)
                            .input('Pre', sql.Decimal(18, 2), ext.precio)
                            .input('Tot', sql.Decimal(18, 2), ext.total)
                            .input('Obs', sql.NVarChar, ext.obs)
                            .query(`
                                INSERT INTO ServiciosExtraOrden (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro)
                                VALUES (@OID, @Cod, @Stk, @Des, @Cnt, @Pre, @Tot, @Obs, GETDATE())
                            `);
                    }

                    try {
                        await new sql.Request(transaction).input('OrdenID', sql.Int, newID).execute('sp_PredecirProximoServicio');
                        await new sql.Request(transaction).input('OrdenID', sql.Int, newID).execute('sp_CalcularFechaEntrega');
                    } catch (e) { }
                }
            }

            if (maxFacturaProcesada > ultimaFacturaDB) {
                await new sql.Request(transaction)
                    .input('val', sql.VarChar, maxFacturaProcesada.toString())
                    .query("UPDATE ConfiguracionGlobal SET Valor = @val WHERE Clave = 'ULTIMAFACTURA'");
            }

            await transaction.commit();
            console.log(`✅ EXITO. Ordenes Creadas: ${generatedCodes.join(', ')}`);
            if (io && generatedCodes.length) io.emit('server:ordersUpdated', { count: generatedCodes.length });

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