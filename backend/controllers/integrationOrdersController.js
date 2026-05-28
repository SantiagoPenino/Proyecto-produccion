const { sql, getPool } = require('../config/db');
const driveService = require('../services/driveService');
const fileProcessingService = require('../services/fileProcessingService');
const axios = require('axios');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const logger = require('../utils/logger');
const ERPSyncService = require('../services/erpSyncService');

// --- CONSTANTES Y MAPEOS ---
const SERVICE_TO_AREA_MAP = {
    'dtf': 'DF',
    'DF': 'DF',
    'XDF': 'DF',
    'RXDF': 'DF',
    'UVDF': 'DF',
    'RUVDF': 'DF',
    'RDF': 'DF',
    'sublimacion': 'SB',
    'SB': 'SB',
    'SUB': 'SB',
    'ecouv': 'ECOUV',
    'directa_320': 'DIRECTA',
    'directa_algodon': 'DIRECTA',
    'bordado': 'EMB',
    'laser': 'TWC',
    'tpu': 'TPU',
    'TPU': 'TPU',
    'TPUT': 'TPU',
    'costura': 'TWT',
    'estampado': 'EST'
};

// --- CONTROLADOR DE INTEGRACIÓN (Planilla) ---
exports.createPlanillaOrder = async (req, res) => {
    logger.info("📥 [IntegrationOrder] Iniciando proceso de creación desde Planilla...");
    // logger.info("Payload recibido:", JSON.stringify(req.body, null, 2));

    // --- DEBUG SOLICITADO POR EL USUARIO ---
    logger.info("=========================================================");
    logger.info("🚨 NUEVO PEDIDO LLEGANDO DESDE GOOGLE SHEETS / WEB:");
    logger.info(JSON.stringify(req.body, null, 2));
    logger.info("=========================================================");

    // --- 1. DATOS BÁSICOS & ADAPTACIÓN DE FORMATO ---
    const {
        idServicio, idServicioBase, // Soporte dual
        nombreTrabajo, prioridad, notasGenerales, configuracion,
        especificacionesCorte, lineas, archivosReferencia, archivosTecnicos, serviciosExtras,
        clienteInfo, // Nuevo objeto de cliente
        rowNumber, // Fila de la planilla
        fechaIngreso // Fecha/hora original de la planilla (opcional)
    } = req.body;

    // Variables de Validación (NUEVOS CAMPOS)
    let esValido = true;
    let observacionesValidacion = [];

    // Mapeo inteligente de ID de Servicio
    let serviceId = idServicio || idServicioBase || req.body.serviceId;
    if (typeof serviceId === 'object') serviceId = serviceId.id || 'GENE';

    // Asegurar que jobName sea string
    const rawJobName = nombreTrabajo || req.body.jobName || 'Trabajo Sin Nombre';
    const jobName = String(rawJobName);

    const urgency = prioridad || req.body.urgency || 'Normal';
    const generalNote = notasGenerales || req.body.generalNote; // SOLO LA NOTA DEL CLIENTE
    const items = lineas || req.body.items || [];
    const selectedComplementary = serviciosExtras || req.body.selectedComplementary || {};

    // --- 2. RESOLUCIÓN DE CLIENTE ---
    const pool = await getPool();
    let codCliente = req.body.codCliente;
    let nombreCliente = req.body.nombreCliente;
    let idClienteReact = null;
    let cliIdClienteDB = null;

    // Lógica de Búsqueda por Nombre/ID String o IDReact numérico
    if (!codCliente && clienteInfo) {
        let searchedByReact = false;

        try {
            // 1. Intentar por IDReact primero si viene explícito
            if (clienteInfo.idReact) {
                const parsedReact = parseInt(clienteInfo.idReact);
                if (!isNaN(parsedReact)) {
                    logger.info(`🔍 Buscando cliente por IDReact explícito: ${parsedReact}...`);
                    const clientSearch = await pool.request()
                        .input('Val', sql.Int, parsedReact)
                        .query(`
                            SELECT TOP 1 CodCliente, Nombre, IDReact, IDCliente, CliIdCliente
                            FROM Clientes 
                            WHERE IDReact = @Val
                        `);

                    if (clientSearch.recordset.length > 0) {
                        const c = clientSearch.recordset[0];
                        codCliente = c.CodCliente;
                        cliIdClienteDB = c.CliIdCliente;
                        nombreCliente = (c.IDCliente && c.IDCliente.trim().length > 0) ? c.IDCliente : c.Nombre;
                        idClienteReact = c.IDReact;
                        logger.info(`✅ Cliente encontrado por IDReact: ${nombreCliente} (Ref DB: ${c.Nombre})`);
                        searchedByReact = true;
                    } else {
                        logger.warn(`⚠️ Cliente con IDReact '${parsedReact}' no encontrado. Procediendo a fallback alfanumérico.`);
                    }
                }
            }

            // 2. Fallback: Buscar por ID Alfanumérico en IDCliente si no se halló por IDReact
            if (!searchedByReact && clienteInfo.id) {
                logger.info(`🔍 Buscando cliente por ID texto (IDCliente): '${clienteInfo.id}'...`);
                const clientSearch = await pool.request()
                    .input('Val', sql.NVarChar, clienteInfo.id.trim())
                    .query(`
                        SELECT TOP 1 CodCliente, Nombre, IDReact, IDCliente, CliIdCliente
                        FROM Clientes 
                        WHERE LTRIM(RTRIM(IDCliente)) = @Val
                    `);

                if (clientSearch.recordset.length > 0) {
                    const c = clientSearch.recordset[0];
                    codCliente = c.CodCliente;
                    cliIdClienteDB = c.CliIdCliente;
                    nombreCliente = (c.IDCliente && c.IDCliente.trim().length > 0) ? c.IDCliente : c.Nombre;
                    idClienteReact = c.IDReact;
                    logger.info(`✅ Cliente encontrado por ID string: ${nombreCliente} (Ref DB: ${c.Nombre})`);

                    if (!idClienteReact) {
                        logger.warn(`⚠️ Cliente '${nombreCliente}' encontrado pero SIN IDReact.`);
                        observacionesValidacion.push(`Cliente existe (Cod: ${codCliente}) pero sin IDReact.`);
                    }
                } else {
                    logger.warn(`⚠️ Cliente '${clienteInfo.id}' no encontrado.`);
                    esValido = false;
                    observacionesValidacion.push(`Cliente '${clienteInfo.id}' no encontrado en BD.`);
                    if (!nombreCliente) nombreCliente = `Cliente ${clienteInfo.id}`;
                    idClienteReact = null;
                }
            } else if (!searchedByReact && !clienteInfo.id) {
                // No hay ni idReact ni id string
                esValido = false;
                observacionesValidacion.push("Falta información del cliente (id o idReact).");
            }
        } catch (errSearch) {
            logger.error("Error buscando cliente:", errSearch);
            esValido = false;
            observacionesValidacion.push("Error interno al buscar cliente.");
            if (!nombreCliente) nombreCliente = `Cliente ${clienteInfo.idReact || clienteInfo.id || 'Desconocido'}`;
            idClienteReact = null;
        }
    }

    if (!codCliente) {
        if (esValido) { // Si no falló la búsqueda anterior pero sigue vacío
            esValido = false;
            observacionesValidacion.push("No se proporcionó CodCliente ni ID válido.");
        }
    }

    if (!nombreCliente) nombreCliente = `Cliente ${codCliente || 'Desconocido'}`;

    // --- VALIDACIÓN DE ITEMS ---
    if ((!items || items.length === 0) && (!req.body.servicios || req.body.servicios.length === 0)) {
        return res.status(400).json({ error: "El pedido no contiene ítems (servicios o lineas vacío)." });
    }

    const referenceFiles = (archivosReferencia || req.body.referenceFiles || []).map(f => ({
        name: f.nombre || f.name || f.url || '',
        type: f.tipo || f.type || 'REFERENCIA',
        url: f.url || f.ubicacionStorage || ''
    }));

    const cuttingSpecs = especificacionesCorte || req.body.cuttingSpecs;

    try {
        // --- 3. GESTIÓN DE NÚMERO DE ORDEN (Híbrido: Planilla vs Web) ---
        let nuevoNroPedido;
        let erpDocNumber;
        let codigoOrdenFinal;

        let codigoExterno = req.body.idExterno || req.body.codigoExterno;

        // Limpiar nota general (remover prefijo "FILA X: CODE")
        let cleanedNote = generalNote || '';
        if (generalNote) {
            // Regex para remover "FILA 1234: DF-82039" al inicio
            cleanedNote = generalNote.replace(/^FILA \d+:\s*[A-Z0-9-]+\s*/i, '').trim();
        }

        if (!codigoExterno && generalNote) {
            // Extraer código externo de la nota original antes de limpiarla, si es necesario
            const match = generalNote.match(/FILA \d+:\s*([^\s]+)/);
            if (match && match[1]) {
                codigoExterno = match[1];
            }
        }

        if (codigoExterno) {
            // logger.info(`ℹ️ [Integration] Usando Código Externo de Planilla: ${codigoExterno}`);
            codigoOrdenFinal = codigoExterno;

            // LÓGICA NoDocERP: "SOLO EL CODIGO" (Pedido explícito del usuario)
            erpDocNumber = codigoExterno;
        } else {
            const reserveRes = await pool.request().query(`
                UPDATE ConfiguracionGlobal 
                SET Valor = CAST(ISNULL(CAST(Valor AS INT), 0) + 1 AS VARCHAR) 
                OUTPUT INSERTED.Valor 
                WHERE Clave = 'ULTIMOPEDIDOWEB'
            `);

            if (reserveRes.recordset.length > 0) {
                nuevoNroPedido = parseInt(reserveRes.recordset[0].Valor);
            } else {
                const maxOrder = await pool.request().query("SELECT MAX(OrdenID) as MaxID FROM Ordenes");
                nuevoNroPedido = (maxOrder.recordset[0].MaxID || 100000) + 1;
            }
            erpDocNumber = `${nuevoNroPedido}`;
            codigoOrdenFinal = `ORD-${erpDocNumber}`;

            if (rowNumber) {
                erpDocNumber = `Fila: ${rowNumber} - Orden: ${nuevoNroPedido}`;
            }
        }

        if (!idClienteReact && codCliente) {
            const parsedCod = parseInt(codCliente);
            if (!isNaN(parsedCod)) {
                const clientRes = await pool.request().input('cod', sql.Int, parsedCod).query("SELECT IDReact, CliIdCliente FROM Clientes WHERE CodCliente = @cod");
                if (clientRes.recordset.length > 0) {
                    idClienteReact = clientRes.recordset[0].IDReact;
                    cliIdClienteDB = clientRes.recordset[0].CliIdCliente;
                }

                if (!idClienteReact) {
                    // NO invalidamos. Permitimos con CodCliente.
                    observacionesValidacion.push(`IDReact no enccontrado para CodCliente ${parsedCod}`);
                }
            } else {
                observacionesValidacion.push(`CodCliente inválido omitido: ${codCliente}`);
                codCliente = null; // Wipe invalid value so it won't crash later
            }
        }

        // --- 4. PREPARACIÓN DE ÁREAS Y RUTAS ---
        const areasRes = await pool.request().query("SELECT AreaID, UM FROM Areas");
        const mapaAreasUM = {};
        areasRes.recordset.forEach(r => {
            if (r.AreaID) mapaAreasUM[r.AreaID.trim().toUpperCase()] = (r.UM || 'u').trim();
        });

        const mainAreaID = (SERVICE_TO_AREA_MAP[serviceId] || 'GENE').toUpperCase();

        // --- 5. ESTRUCTURAR ORDENES ---
        const pendingOrderExecutions = [];

        if (req.body.servicios && Array.isArray(req.body.servicios) && req.body.servicios.length > 0) {
            for (let idxSrv = 0; idxSrv < req.body.servicios.length; idxSrv++) {
                const srv = req.body.servicios[idxSrv];
                const cabecera = srv.cabecera || {};
                let srvArea = srv.areaId || mainAreaID;
                if (SERVICE_TO_AREA_MAP[srvArea]) srvArea = SERVICE_TO_AREA_MAP[srvArea]; // Remapear alias
                const areaID = srvArea.toUpperCase();

                const ordenItems = (srv.items || []).map(it => {
                    let obsTecnicas = it.printSettings?.observation || '';
                    if (it.printSettings?.mode && it.printSettings.mode !== 'normal') {
                        obsTecnicas += (obsTecnicas ? ' | ' : '') + `Modo: ${it.printSettings.mode}`;
                    }

                    let fName = it.fileName || 'SinNombre.dat';

                    return {
                        fileName: fName,
                        originalUrl: it.fileName,
                        copies: it.copias !== undefined ? it.copias : (it.cantidad || 1),
                        metrosReales: it.copias !== undefined ? (it.cantidad || 0) : 0,
                        note: it.nota,
                        width: it.width,
                        height: it.height,
                        observaciones: obsTecnicas
                    };
                });

                // --- INYECCIÓN DE ARCHIVO FANTASMA PARA SINCRO (PLANILLA) ---
                // Si la planilla NO envió archivos, creamos uno virtual SOLO para el principal
                // para mantener el conteo logístico en ArchivosOrden
                if (ordenItems.length === 0 && srv.esPrincipal) {
                    const fallbackQty = cabecera.cantidad || srv.cantidad || req.body.metrosReales || req.body.cantidad || 1;
                    ordenItems.push({
                        fileName: 'SINCRO_SIN_ARCHIVO.pdf',
                        originalUrl: null,
                        copies: fallbackQty, 
                        note: 'Generado desde Planilla Sincro sin archivo físico',
                        width: 0,
                        height: fallbackQty, 
                        observaciones: 'Falta Archivo Digital'
                    });
                }

                let localMaterial = cabecera.material || 'Estándar';
                let localVariante = cabecera.variante || 'N/A';
                let localCodArticulo = cabecera.codArticulo;
                let localCodStock = cabecera.codStock;
                let localProIdProductoDB = cabecera.proIdProducto || cabecera.ProIdProducto || null;

                // --- HARCODEO DE EXTRAS (BORDADO, CORTE LASER, COSTURA) ---
                if (localCodArticulo === 'SERV-CORTE') {
                    localCodArticulo = '1375';
                    localCodStock = '1.1.6.1';
                    localMaterial = 'Corte Laser por prenda';
                    localVariante = 'Corte Laser';
                    localProIdProductoDB = 90;
                } else if (localCodArticulo === 'SERV-COSTURA') {
                    localCodArticulo = '115';
                    localCodStock = '1.1.7.1';
                    localMaterial = 'Costura';
                    localVariante = 'Costura';
                    localProIdProductoDB = 36;
                } else if (localCodArticulo === 'SERV-BORDADO') {
                    localCodArticulo = '1567';
                    localCodStock = '1.1.4.1';
                    localMaterial = 'Bordado';
                    localVariante = 'Bordado';
                    localProIdProductoDB = 434;
                }

                // --- HEURÍSTICA DE RESCATE SI NO HAY CODIGO DE ARTICULO ---
                if (!localCodArticulo) {
                    const pNameClean = (localMaterial || rawJobName || '').trim();
                    try {
                        let preq = await pool.request()
                            .input('nom', sql.NVarChar, pNameClean)
                            .query(`
                                SELECT TOP 1 A.CodArticulo, A.ProIdProducto, A.Descripcion
                                FROM [SINCRO-ARTICULOS] S
                                INNER JOIN Articulos A ON S.PROIDPRODUCTO = A.ProIdProducto
                                WHERE LTRIM(RTRIM(S.PRODUCTO)) = LTRIM(RTRIM(@nom))
                            `);
                            
                        if (preq.recordset.length > 0) {
                            const oficial = preq.recordset[0];
                            localCodArticulo = oficial.CodArticulo;
                            localProIdProductoDB = oficial.ProIdProducto;
                            if (oficial.Descripcion) localMaterial = oficial.Descripcion;
                        }
                    } catch (e) {
                         logger.error("Error consultando SINCRO-ARTICULOS en Integration: " + e.message);
                    }
                }

                // Si el payload origen no define explícitamente "esPrincipal", asumimos que el índice 0 es la principal.
                const isExtraSrv = srv.esPrincipal !== undefined ? !srv.esPrincipal : (idxSrv > 0);

                pendingOrderExecutions.push({
                    areaID: areaID,
                    material: localMaterial,
                    variante: localVariante,
                    codArticulo: localCodArticulo,
                    proIdProductoDB: localProIdProductoDB,
                    codStock: localCodStock,
                    items: ordenItems,
                    isExtra: isExtraSrv,
                    isCobranzaExtra: !!srv.isCobranzaExtra, // PASAR LA BANDERA AL MOTOR
                    notaAdicional: srv.notas || '',
                    archivosReferenciaLocales: srv.archivosReferenciaLocales || []
                });
            }

        } else if (items && items.length > 0) {
            pendingOrderExecutions.push({
                areaID: mainAreaID,
                material: 'Estándar',
                items: items.map(sl => ({
                    fileName: sl.fileName || sl.archivoPrincipal?.name || 'SinNombre.dat',
                    originalUrl: sl.fileName || sl.archivoPrincipal?.name,
                    copies: sl.copies || sl.cantidad || 1,
                    note: sl.nota || '',
                    width: sl.width || 0,
                    height: sl.height || 0,
                    observaciones: sl.printSettings?.observation || (sl.configuracion?.mode && sl.configuracion.mode !== 'normal' ? `Modo: ${sl.configuracion.mode}` : '')
                })),
                isExtra: false
            });
        }

        // Buscamos IDProdReact en la tabla Articulos usando el CodArticulo (ej: 47) o ProIdProducto usando proIdProductoDB
        const proIdCodes = [];
        const codArtCodes = [];
        pendingOrderExecutions.forEach(e => {
            if (e.proIdProductoDB) proIdCodes.push(String(e.proIdProductoDB).trim());
            if (e.codArticulo) codArtCodes.push(String(e.codArticulo).trim());
        });
        const uniqueProIds = [...new Set(proIdCodes)];
        const uniqueCodArts = [...new Set(codArtCodes)];
        
        const mapArtByProId = {};
        const mapArtByIdReact = {};
        const mapArtByCodArt = {};

        if (uniqueProIds.length > 0 || uniqueCodArts.length > 0) {
            logger.info(`🔍 [Integration] Buscando Artículos ProId: ${JSON.stringify(uniqueProIds)}, CodArt: ${JSON.stringify(uniqueCodArts)}`);
            try {
                const request = pool.request();
                const clauses = [];
                
                uniqueProIds.forEach((id, i) => {
                    request.input(`proId${i}`, sql.Int, parseInt(id));
                    clauses.push(`(ProIdProducto = @proId${i})`);
                });
                
                uniqueCodArts.forEach((code, i) => {
                    request.input(`codArt${i}`, sql.VarChar(50), code);
                    clauses.push(`(CodArticulo = @codArt${i} OR IDProdReact = TRY_CAST(@codArt${i} AS INT))`);
                });

                const whereClause = clauses.join(' OR ');
                const queryStr = `SELECT IDProdReact, CodArticulo, ProIdProducto FROM Articulos WHERE ${whereClause}`;
                
                const artRes = await request.query(queryStr);

                logger.info(`🔍 [Integration] Resultados DB Articulos encontrados: ${artRes.recordset.length}`);

                artRes.recordset.forEach(r => {
                    const info = { idReact: r.IDProdReact, proId: r.ProIdProducto, codArt: r.CodArticulo };
                    if (r.ProIdProducto !== null && r.ProIdProducto !== undefined) {
                        mapArtByProId[String(r.ProIdProducto).trim()] = info;
                    }
                    if (r.IDProdReact !== null && r.IDProdReact !== undefined) {
                        mapArtByIdReact[String(r.IDProdReact).trim()] = info;
                    }
                    if (r.CodArticulo !== null && r.CodArticulo !== undefined) {
                        mapArtByCodArt[String(r.CodArticulo).trim()] = info;
                    }
                });

            } catch (errLookup) {
                logger.warn("⚠️ Error buscando artículos en DB:", errLookup.message);
                observacionesValidacion.push("Error DB buscando producto: " + errLookup.message);
            }
        }

        // Asignar y Validar Productos
        pendingOrderExecutions.forEach(exec => {
              let info = null;
              let key = "Desconocido";

              if (exec.proIdProductoDB) {
                  key = String(exec.proIdProductoDB).trim();
                  info = mapArtByProId[key];
              } else if (exec.codArticulo) {
                  key = String(exec.codArticulo).trim();
                  if (/^\d+$/.test(key)) {
                      info = mapArtByIdReact[key] || mapArtByCodArt[key];
                  } else {
                      info = mapArtByCodArt[key] || mapArtByIdReact[key];
                  }
              }

              if (info) {
                  exec.idProductoReact = info.idReact;
                  exec.proIdProductoDB = info.proId;
                  exec.codArticulo = info.codArt;
                  logger.info(`✅ IDProductoReact asignado: ${info.idReact} para identificador proporcionado: ${key} (Asignando CodArticulo real: ${info.codArt})`);
              } else {
                  const searchKey = exec.proIdProductoDB ? `ProIdProducto: ${exec.proIdProductoDB}` : `CodArticulo: ${exec.codArticulo}`;
                  logger.warn(`⚠️ Datos de artículo NO encontrados para identificador. (Buscado como: '${searchKey}')`);
                  esValido = false;
                  observacionesValidacion.push(`Producto '${searchKey}' no se encontró o no tiene vinculaciones.`);
              }
        });

        // --- 6. TRANSACCIÓN DB ---
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const filesToUpload = [];
            const generatedOrders = [];
            const generatedIDs = [];

            // --- NUEVO: REEMPLAZO O PREVENCIÓN DE DUPLICADOS ---
            if (erpDocNumber) {
                const exRows = await new sql.Request(transaction).input('ERP', sql.VarChar(50), erpDocNumber).query("SELECT OrdenID FROM Ordenes WHERE NoDocERP = @ERP OR CodigoOrden = @ERP");
                if (exRows.recordset.length > 0) {
                    if (req.body.OVERWRITE_EXISTING) {
                        const idsToDel = exRows.recordset.map(r => r.OrdenID);
                        logger.info(`[IntegrationOrder] ⚠️ Reemplazando órdenes existentes (${idsToDel.join(',')}) para Doc: ${erpDocNumber}`);
                        for (const oid of idsToDel) {
                            if (typeof oid !== 'number') continue;
                            await new sql.Request(transaction).query(`DELETE FROM ArchivosOrden WHERE OrdenID = ${oid}`);
                            await new sql.Request(transaction).query(`DELETE FROM ArchivosReferencia WHERE OrdenID = ${oid}`);
                            await new sql.Request(transaction).query(`DELETE FROM ServiciosExtraOrden WHERE OrdenID = ${oid}`);
                            await new sql.Request(transaction).query(`DELETE FROM PedidosCobranzaDetalle WHERE OrdenID = ${oid}`);
                            await new sql.Request(transaction).query(`DELETE FROM Ordenes WHERE OrdenID = ${oid}`);
                        }
                        await new sql.Request(transaction).input('ERP', sql.VarChar(50), erpDocNumber).query("DELETE FROM PedidosCobranza WHERE NoDocERP = @ERP");
                    } else {
                        // Impedir duplicados si no se solicita sobrescribir
                        throw new Error(`La orden o documento ${erpDocNumber} ya existe. Operación rechazada para evitar duplicados.`);
                    }
                }
            }

            // SOLO LA NOTA DEL CLIENTE (cleanedNote)
            let finalNote = cleanedNote || '';

            // Si validación falló, agregamos info en ValidacionOBS
            // Unir observaciones únicas
            const uniqueObs = [...new Set(observacionesValidacion)];
            const validacionObsStr = uniqueObs.length > 0 ? uniqueObs.join(' | ') : null;

            const sanitize = (str) => (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();

            const fisicasEjecuciones = pendingOrderExecutions.filter(e => !e.isCobranzaExtra);
            let fisicaIndex = 0;

            for (let idx = 0; idx < pendingOrderExecutions.length; idx++) {
                const exec = pendingOrderExecutions[idx];

                if (exec.isCobranzaExtra) {
                    // EVITAR QUE SEA UNA "ORDEN FÍSICA MÁS" - SE ENVÍA DIRECTO AL DETALLE DE COBRANZA
                    const parentOID = generatedIDs.length > 0 ? generatedIDs[0] : null;
                    if (parentOID) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, parentOID)
                            .input('CArt', sql.VarChar(50), exec.codArticulo || 'EMB-MATRIZ')
                            .input('Nom', sql.NVarChar(200), exec.material || 'Cobranza Extra')
                            .query(`
                                INSERT INTO ServiciosExtraOrden (OrdenID, Descripcion, CodArt, Cantidad, PrecioUnitario, TotalLinea, FechaRegistro)
                                VALUES (@OID, @Nom, @CArt, 1, 0, 0, GETDATE())
                            `);
                        logger.info(`✅ [IntegrationOrder] Anclado ítem de cobranza extra (Matriz/Otro) al Padre OID ${parentOID}: ${exec.codArticulo}`);
                    } else {
                        logger.warn(`⚠️ [IntegrationOrder] No se pudo anclar el ítem extra porque no hay Orden Padre creada.`);
                    }
                    continue; // Saltar la creación de Orden, Lote Kanban y Archivos
                }

                fisicaIndex++;
                let codigoParaEstaOrden;

                // Filtrar solo las ejecuciones físicas del área SB para numerar correctamente
                const fisicasSB = fisicasEjecuciones.filter(e => e.areaID === 'SB');

                if (exec.areaID === 'SB' && fisicasSB.length > 1) {
                    const indexSB = fisicasSB.findIndex(e => e === exec) + 1;
                    codigoParaEstaOrden = `${codigoOrdenFinal} (${indexSB}/${fisicasSB.length})`;
                } else {
                    codigoParaEstaOrden = codigoOrdenFinal;
                }

                const estadoInicial = 'Pendiente';

                exec.codigoOrden = codigoParaEstaOrden;

                let proximoServicio = 'DEPOSITO';
                for (let j = idx + 1; j < pendingOrderExecutions.length; j++) {
                    if (!pendingOrderExecutions[j].isCobranzaExtra) {
                        proximoServicio = pendingOrderExecutions[j].areaID;
                        break;
                    }
                }

                const areaUM = mapaAreasUM[exec.areaID] || 'u';

                const parsedCodValid = codCliente ? parseInt(codCliente) : null;
                const safeCodCliente = isNaN(parsedCodValid) ? null : parsedCodValid;

                // Prevenir texto cayendo en IDs si por algun motivo llegaron sucios
                let safeIdClientReact = null;
                if (idClienteReact) {
                    // Si idClienteReact viene directo del query, lo pasamos a string o lo limpiamos
                    safeIdClientReact = idClienteReact.toString();
                }

                const resOrder = await new sql.Request(transaction)
                    .input('AreaID', sql.VarChar(20), exec.areaID || 'GENE')
                    .input('Cliente', sql.NVarChar(200), nombreCliente)
                    .input('CodCliente', sql.Int, safeCodCliente)
                    .input('IdClienteReact', sql.VarChar(50), safeIdClientReact)
                    .input('Desc', sql.NVarChar(300), jobName)
                    .input('Prio', sql.VarChar(20), urgency)
                    .input('Mat', sql.VarChar(255), exec.material)
                    .input('Var', sql.VarChar(100), exec.variante)
                    .input('Cod', sql.VarChar(50), exec.codigoOrden ? String(exec.codigoOrden) : null)
                    .input('ERP', sql.VarChar(50), erpDocNumber)
                    .input('Nota', sql.NVarChar(sql.MAX), finalNote)
                    .input('Mag', sql.VarChar(50), '0')
                    .input('Prox', sql.VarChar(50), proximoServicio)
                    .input('Estado', sql.VarChar(50), estadoInicial)
                    .input('UM', sql.VarChar(20), areaUM)
                    .input('CArt', sql.VarChar(50), exec.codArticulo ? String(exec.codArticulo) : null)
                    .input('IdProdReact', sql.Int, !isNaN(parseInt(exec.idProductoReact)) ? parseInt(exec.idProductoReact) : null)
                    .input('Val', sql.Bit, esValido)
                    .input('ValObs', sql.NVarChar(sql.MAX), validacionObsStr)
                    .input('CliIdCliente', sql.Int, !isNaN(parseInt(cliIdClienteDB)) ? parseInt(cliIdClienteDB) : null)
                    .input('ProIdProducto', sql.Int, !isNaN(parseInt(exec.proIdProductoDB)) ? parseInt(exec.proIdProductoDB) : null)
                    .input('FechaOrigen', sql.DateTime, (() => {
                        if (fechaIngreso) {
                            const d = new Date(fechaIngreso);
                            if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;
                        }
                        return new Date();
                    })())
                    .query(`
                        INSERT INTO Ordenes (
                            AreaID, Cliente, CodCliente, IdClienteReact, DescripcionTrabajo, Prioridad, 
                            FechaIngreso, FechaEntradaSector, FechaEstimadaEntrega, Material, Variante, 
                            CodigoOrden, NoDocERP, Nota, Magnitud, ProximoServicio, UM, Estado, EstadoenArea,
                            CodArticulo, IdProductoReact, Validacion, ValidacionOBS, CliIdCliente, ProIdProducto
                        )
                        OUTPUT INSERTED.OrdenID
                        VALUES (
                            @AreaID, @Cliente, @CodCliente, @IdClienteReact, @Desc, @Prio, 
                            @FechaOrigen, @FechaOrigen, DATEADD(day, 3, @FechaOrigen), @Mat, @Var, 
                            @Cod, @ERP, @Nota, @Mag, @Prox, @UM, @Estado, @Estado,
                            @CArt, @IdProdReact, @Val, @ValObs, @CliIdCliente, @ProIdProducto
                        )
                    `);

                const newOID = resOrder.recordset[0].OrdenID;
                generatedOrders.push(exec.codigoOrden);
                generatedIDs.push(newOID);

                let totalMagnitud = 0;
                let fileCount = 0;

                // --- NOTA HISTÓRICA: CREACIÓN DE LÍNEA DE SERVICIO EXTRA ELIMINADA ---
                // Se removió el INSERT INTO ServiciosExtraOrden porque la cotización
                // contable ahora gestiona los importes con PedidosCobranzaDetalle,
                // evitando así un doble listado visual en la Confirmación de Cotización.

                for (let i = 0; i < exec.items.length; i++) {
                    const item = exec.items[i];
                    const wM = parseFloat(item.width) || 0;
                    const hM = parseFloat(item.height) || 0;
                    const safeCopies = parseInt(item.copies) || 1; // Parse explicitly to avoid text values

                    let valMetros = 0;
                    if (item.fileName === 'SINCRO_SIN_ARCHIVO.pdf' || item.fileName === 'SINCRO_BOCETO_EXTRA.pdf') {
                        valMetros = hM;
                    } else if (item.metrosReales > 0) {
                        valMetros = item.metrosReales;
                    } else {
                        if (areaUM.toLowerCase() === 'm2') valMetros = (wM * hM);
                        else if (areaUM.toLowerCase() === 'ml' || areaUM.toLowerCase() === 'm') valMetros = hM;
                        else valMetros = 1;

                        // Si la Planilla manda metrosReales absolutos y no tenemos medidas espaciales, lo heredamos.
                        if (valMetros === 0 && req.body.metrosReales) {
                            valMetros = parseFloat(String(req.body.metrosReales).replace(',', '.')) || 0;
                        }
                    }

                    let ext = '.dat';
                    if (item.fileName && item.fileName.includes('.')) {
                        const parts = item.fileName.split('.');
                        if (!item.fileName.startsWith('http')) {
                            ext = `.${parts.pop()}`;
                        }
                    }

                    const finalName = `${exec.codigoOrden.replace(/\//g, '-')}_${sanitize(nombreCliente)}_${sanitize(jobName)}_Archivo ${i + 1} de ${exec.items.length} (x${safeCopies})${ext}`;

                    let obsFile = item.observaciones || '';
                    if (item.originalUrl && typeof item.originalUrl === 'string' && item.originalUrl.startsWith('http')) {
                        obsFile += ` [LINK: ${item.originalUrl}]`;
                    }

                    if (exec.isExtra) {
                        // SI ES EXTRA, ARCHIVO VA A REFERENCIA
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), 'BOCETO_EXTRA')
                            .input('Nom', sql.VarChar(200), finalName)
                            .input('Not', sql.NVarChar(sql.MAX), obsFile)
                            .input('Ubi', sql.NVarChar(sql.MAX), item.originalUrl)
                            .query(`
                                INSERT INTO ArchivosReferencia (
                                    OrdenID, TipoArchivo, NombreOriginal, NotasAdicionales, FechaSubida, UbicacionStorage
                                ) 
                                VALUES (
                                    @OID, @Tipo, @Nom, @Not, GETDATE(), @Ubi
                                )
                            `);

                        totalMagnitud += safeCopies;
                        fileCount++;
                    } else {
                        // SI ES PRINCIPAL, ARCHIVO VA A PRODUCCION
                        const resFile = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Nom', sql.VarChar(200), finalName)
                            .input('Tipo', sql.VarChar(50), 'Impresion')
                            .input('Cop', sql.Int, safeCopies)
                            .input('Met', sql.Decimal(10, 3), valMetros)
                            .input('Ancho', sql.Decimal(10, 2), wM)
                            .input('Alto', sql.Decimal(10, 2), hM)
                            .input('Obs', sql.NVarChar(sql.MAX), obsFile)
                            .input('Ruta', sql.NVarChar(sql.MAX), item.originalUrl)
                            .query(`
                                INSERT INTO ArchivosOrden (
                                    OrdenID, NombreArchivo, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida, 
                                    Ancho, Alto, Observaciones, RutaAlmacenamiento
                                ) 
                                OUTPUT INSERTED.ArchivoID 
                                VALUES (
                                    @OID, @Nom, @Tipo, @Cop, @Met, 'Pendiente', GETDATE(), 
                                    @Ancho, @Alto, @Obs, @Ruta
                                )
                            `);

                        filesToUpload.push({ dbId: resFile.recordset[0].ArchivoID, originalName: item.fileName });

                        if (areaUM === 'u') totalMagnitud += safeCopies;
                        else totalMagnitud += (valMetros * safeCopies);
                        fileCount++;
                    }
                }

                // --- INSERCIÓN DE ARCHIVOS DE REFERENCIA PROPIOS DEL SERVICIO ---
                const insertedUrlsForThisOrder = new Set();

                if (exec.archivosReferenciaLocales && exec.archivosReferenciaLocales.length > 0) {
                    for (let i = 0; i < exec.archivosReferenciaLocales.length; i++) {
                        const refItem = exec.archivosReferenciaLocales[i];
                        const refUrl = (refItem.url || '').trim();
                        if (refUrl) {
                            if (insertedUrlsForThisOrder.has(refUrl.toLowerCase())) continue;
                            insertedUrlsForThisOrder.add(refUrl.toLowerCase());
                        }

                        // Priorizar la nota descriptiva si no es una URL cruda
                        let refName = refItem.nota || refItem.url || refItem.tipo || `Boceto_Corte_${i+1}`;
                        if (refItem.nota && (refItem.nota.startsWith('http') || refItem.nota.includes('drive.google'))) {
                            refName = refItem.tipo || refItem.url || `Boceto_Corte_${i+1}`;
                        }

                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), refItem.tipo || 'BOCETO_CORTE')
                            .input('Nom', sql.VarChar(200), refName)
                            .input('Not', sql.NVarChar(sql.MAX), refItem.nota || '')
                            .input('Ubi', sql.NVarChar(sql.MAX), refItem.url)
                            .query(`
                                INSERT INTO ArchivosReferencia (
                                    OrdenID, TipoArchivo, NombreOriginal, NotasAdicionales, FechaSubida, UbicacionStorage
                                ) 
                                VALUES (
                                    @OID, @Tipo, @Nom, @Not, GETDATE(), @Ubi
                                )
                            `);
                    }
                }

                // --- INSERCIÓN DE ARCHIVOS DE REFERENCIA GENERALES (TOP LEVEL) ---
                if (referenceFiles && referenceFiles.length > 0) {
                    for (let i = 0; i < referenceFiles.length; i++) {
                        const refItem = referenceFiles[i];
                        if (!refItem.url) continue;

                        const refUrl = refItem.url.trim();
                        if (insertedUrlsForThisOrder.has(refUrl.toLowerCase())) continue;
                        insertedUrlsForThisOrder.add(refUrl.toLowerCase());

                        const refName = refItem.name || refItem.url;
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), refItem.type || 'REFERENCIA')
                            .input('Nom', sql.VarChar(200), refName)
                            .input('Not', sql.NVarChar(sql.MAX), '')
                            .input('Ubi', sql.NVarChar(sql.MAX), refItem.url)
                            .query(`
                                INSERT INTO ArchivosReferencia (
                                    OrdenID, TipoArchivo, NombreOriginal, NotasAdicionales, FechaSubida, UbicacionStorage
                                ) 
                                VALUES (
                                    @OID, @Tipo, @Nom, @Not, GETDATE(), @Ubi
                                )
                            `);
                    }
                }

                if (fileCount > 0) {
                    await new sql.Request(transaction).input('OID', sql.Int, newOID).input('C', sql.Int, fileCount).input('Mag', sql.Decimal(10, 2), totalMagnitud).query("UPDATE Ordenes SET ArchivosCount = @C, Magnitud = CAST(@Mag AS VARCHAR) WHERE OrdenID = @OID");
                }
            }

            if (generatedOrders.length === 0) {
                await transaction.rollback();
                return res.status(400).json({ error: "No se generaron órdenes. Verifica el formato del JSON." });
            }

            await transaction.commit();

            logger.info("✅ [IntegrationOrder] Pedido creado:", generatedOrders);

            // Lanzar procesamiento de archivos en segundo plano
            try {
                const io = req.app.get('socketio');
                fileProcessingService.processOrderList(generatedIDs, io);
                logger.info(`⚡ [IntegrationOrder] Procesamiento asíncrono de archivos lanzado para órdenes: ${generatedIDs.join(', ')}`);
            } catch (errProc) {
                logger.error("⚠️ [IntegrationOrder] Error launching file processing:", errProc.message);
            }

            // 🎯 EARLY PRICING & SYNC: Disparar SOLO cotización y PedidosCobranza, NO OrdenesDeposito.
            // OrdenesDeposito se escribe únicamente durante el Check-In del WMS (depósito).
            try {
                await ERPSyncService.syncFinalOrderIntegration(erpDocNumber, 1, 'Auto-Ingreso', null, { skipDeposito: true });
                logger.info(`✅ [IntegrationOrder] Early-Pricing & Sync exitoso para: ${erpDocNumber}`);
            } catch (errSync) {
                logger.error(`⚠️ [IntegrationOrder] Early-Pricing & Sync falló para ${erpDocNumber}. Error: ${errSync.message}`);
                // No abortamos el HTTP 201 ya que la orden se creó correctamente en BD.
            }

            res.status(201).json({
                success: true,
                message: "Orden creada exitosamente (Integra V2 - Early Priced)",
                orderId: generatedIDs[0],
                uuid: generatedOrders[0],
                subOrders: generatedOrders,
                filesToUpload
            });

        } catch (errTrx) {
            logger.error("❌ SQL Transaction Error (Original Cause):", errTrx);
            try {
                await transaction.rollback();
            } catch (rbError) {
                logger.warn("⚠️ Rollback failed (likely already aborted):", rbError.message);
            }
            throw errTrx; // Re-throw original error
        }

    } catch (err) {
        logger.error("❌ IntegrationOrder Error:", err);
        res.status(500).json({ error: "Error al crear pedido de integración: " + err.message });
    }
};
