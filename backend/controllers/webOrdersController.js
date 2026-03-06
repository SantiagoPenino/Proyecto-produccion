const { sql, getPool } = require('../config/db');
const driveService = require('../services/driveService');
const axios = require('axios');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')

// --- CONSTANTES Y MAPEOS ---
const SERVICE_TO_AREA_MAP = {
    'dtf': 'DF',
    'DF': 'DF',
    'sublimacion': 'SB',
    'ecouv': 'ECOUV',
    'directa_320': 'DIRECTA',
    'directa_algodon': 'DIRECTA',
    'bordado': 'EMB',
    'laser': 'TWC',
    'tpu': 'TPU',
    'costura': 'TWT',
    'estampado': 'EST'
};

// --- CONTROLADOR PRINCIPAL ---
exports.createWebOrder = async (req, res) => {
    console.log("📥 [WebOrder] Iniciando proceso de creación (MODO STREAMING)...");

    // --- 1. DATOS BÁSICOS ---
    const {
        idServicio, nombreTrabajo, prioridad, notasGenerales, configuracion,
        especificacionesCorte, lineas, archivosReferencia, archivosTecnicos, serviciosExtras
    } = req.body;

    // Mapeo inverso para compatibilidad
    // Soporte para Payroads en Español (Renombrado técnico solicitado por usuario)
    const serviceId = idServicio || req.body.serviceId;
    const jobName = nombreTrabajo || req.body.jobName;
    const urgency = prioridad || req.body.urgency || 'Normal';
    const generalNote = notasGenerales || req.body.generalNote;
    const items = lineas || req.body.items || [];
    const selectedComplementary = serviciosExtras || req.body.selectedComplementary || {};

    // ⚠️ IMPORTANTE: Ahora el frontend NO envía "file.data" (base64), envía solo metadata (nombre, tamaño)
    const referenceFiles = (archivosReferencia || req.body.referenceFiles || []).map(f => ({
        name: f.nombre || f.name,
        type: f.tipo || f.type
    }));
    const specializedFiles = (archivosTecnicos || req.body.specializedFiles || []).map(f => ({
        name: f.nombre || f.name,
        type: f.tipo || f.type
    }));
    const cuttingSpecs = especificacionesCorte || req.body.cuttingSpecs;

    const user = req.user || {};
    // PRIORIDAD INTEGRACIÓN: Si viene en el body, usamos eso. Si no, del token.
    const codCliente = req.body.codCliente || user.codCliente || null;
    const nombreCliente = req.body.nombreCliente || user.name || user.username || 'Cliente Web';
    let idClienteReact = null;

    if ((!items || items.length === 0) && (!req.body.servicios || req.body.servicios.length === 0)) {
        return res.status(400).json({ error: "El pedido no contiene ítems." });
    }

    const pool = await getPool();

    try {
        // --- 2. RESERVAR NRO PEDIDO ---
        const reserveRes = await pool.request().query(`
            UPDATE ConfiguracionGlobal 
            SET Valor = CAST(ISNULL(CAST(Valor AS INT), 0) + 1 AS VARCHAR) 
            OUTPUT INSERTED.Valor 
            WHERE Clave = 'ULTIMOPEDIDOWEB'
        `);
        if (!reserveRes.recordset.length) throw new Error("No se pudo obtener el próximo número de pedido.");
        const nuevoNroPedido = parseInt(reserveRes.recordset[0].Valor);
        const erpDocNumber = `${nuevoNroPedido}`;

        if (codCliente) {
            const clientRes = await pool.request().input('cod', sql.Int, codCliente).query("SELECT IDReact FROM Clientes WHERE CodCliente = @cod");
            if (clientRes.recordset.length > 0) idClienteReact = clientRes.recordset[0].IDReact;
        }

        // --- 3. PREPARACIÓN DE ÁREAS Y RUTAS (Igual que antes) ---
        // --- 3. PREPARACIÓN DE ÁREAS Y RUTAS (Igual que antes) ---
        const mappingRes = await pool.request().query("SELECT AreaID_Interno, Numero FROM ConfigMapeoERP");
        const mapaAreasNumero = {}; // AreaID -> Numero (Priority/Order)
        mappingRes.recordset.forEach(r => mapaAreasNumero[r.AreaID_Interno.trim().toUpperCase()] = r.Numero || 999);
        const rutasRes = await pool.request().query("SELECT AreaOrigen, AreaDestino, Prioridad FROM ConfiguracionRutas");
        const rutasConfig = rutasRes.recordset;

        // NUEVO: Obtener UM de las Áreas
        const areasRes = await pool.request().query("SELECT AreaID, UM FROM Areas");
        const mapaAreasUM = {};
        areasRes.recordset.forEach(r => {
            if (r.AreaID) mapaAreasUM[r.AreaID.trim().toUpperCase()] = (r.UM || 'u').trim();
        });

        const mainAreaID = (SERVICE_TO_AREA_MAP[serviceId] || 'GENE').toUpperCase();

        // ... (Lógica de áreas extras se mantiene igual)
        const EXTRA_ID_TO_AREA = { 'EST': 'EST', 'ESTAMPADO': 'EST', 'COSTURA': 'TWT', 'CORTE': 'TWC', 'TWC': 'TWC', 'TWT': 'TWT', 'LASER': 'TWC', 'BORDADO': 'EMB', 'EMB': 'EMB' };

        // Inicializar conjunto de áreas activas
        const allActiveAreas = new Set([mainAreaID]); // Siempre incluye la principal

        // A) Desde Servicios Nuevos (Payload Nuevo)
        if (req.body.servicios && Array.isArray(req.body.servicios)) {
            req.body.servicios.forEach(s => {
                if (s.areaId) allActiveAreas.add(s.areaId.toUpperCase());
            });
        }

        // B) Legacy (selectedComplementary)
        if (selectedComplementary) {
            Object.entries(selectedComplementary).forEach(([id, val]) => {
                if (val.activo || val.active) {
                    const mapped = EXTRA_ID_TO_AREA[id.toUpperCase()];
                    if (mapped) allActiveAreas.add(mapped);
                }
            });
        }

        // --- 4. PREPARAR NOTA (Igual que antes) ---
        let finalNote = generalNote || '';
        const specs = [];
        if (cuttingSpecs) {
            specs.push(`MOLDE: ${cuttingSpecs.tipoMolde || cuttingSpecs.moldType || 'N/A'}`);
            specs.push(`ORIGEN TELA: ${cuttingSpecs.origenTela || cuttingSpecs.fabricOrigin || 'N/A'}`);
            if ((cuttingSpecs.nombreTelaCliente || cuttingSpecs.clientFabricName) && (cuttingSpecs.origenTela === 'TELA CLIENTE' || cuttingSpecs.fabricOrigin === 'TELA CLIENTE')) {
                specs.push(`TELA CLIENTE: ${cuttingSpecs.nombreTelaCliente || cuttingSpecs.clientFabricName}`);
            }
            if (cuttingSpecs.idOrdenSublimacionVinc || cuttingSpecs.sublimationOrderId) {
                specs.push(`ORDEN ASOCIADA: ${cuttingSpecs.idOrdenSublimacionVinc || cuttingSpecs.sublimationOrderId}`);
            }
        }
        // ... (Más specs de bordado/estampado, igual que antes)
        if (req.body.especificacionesBordado?.cantidadPrendas) specs.push(`BORDADO - CANTIDAD TOTAL DE PRENDAS: ${req.body.especificacionesBordado.cantidadPrendas}`);

        if (specs.length > 0) {
            finalNote = specs.join(' | ') + ' | ' + (generalNote || '');
        } else {
            finalNote = generalNote ? `OBS: ${generalNote}` : '';
        }

        // --- 5. ESTRUCTURAR ORDENES (Igual que antes) ---
        // --- 5. ESTRUCTURAR ORDENES ---
        const pendingOrderExecutions = [];

        // CASO 1: ARRAY UNIFICADO DE SERVICIOS (Nuevo Frontend)
        if (req.body.servicios && Array.isArray(req.body.servicios) && req.body.servicios.length > 0) {
            req.body.servicios.forEach(srv => {
                const cabecera = srv.cabecera || {};
                const areaID = (srv.areaId || mainAreaID).toUpperCase();

                // SEPARAR ARCHIVOS: Producción vs Referencia
                const prodTypes = ['PRODUCCION', 'PRODUCCION_DORSO', 'IMPRESION'];
                const rawFiles = srv.archivos || [];

                // 1. Archivos Producción (Items) - Vinculados por nombre a los items del payload si existen
                // o creados dinámicamente si no hay items explícitos pero hay archivos prod.
                // Mapear Items del Servicio a Items de Orden
                const ordenItems = (srv.items || []).map(it => {
                    let obsTecnicas = it.printSettings?.observation || '';
                    // Enriquecer observación con datos técnicos de impresión si existen
                    if (it.printSettings) {
                        const parts = [];
                        if (it.printSettings.mode && it.printSettings.mode !== 'normal') parts.push(`Modo: ${it.printSettings.mode}`);
                        if (it.printSettings.rapport) parts.push(`Rapport: ${it.printSettings.rapport}`);
                        if (it.printSettings.finalWidthM) parts.push(`AnchoFinal: ${it.printSettings.finalWidthM}m`);
                        if (parts.length > 0) obsTecnicas += (obsTecnicas ? ' | ' : '') + parts.join(', ');
                    }

                    return {
                        fileName: it.fileName,
                        fileBackName: it.fileBackName,
                        copies: it.cantidad || 1,
                        note: it.nota,
                        width: it.width,
                        height: it.height,
                        observaciones: obsTecnicas,
                        widthBack: it.widthBack,
                        heightBack: it.heightBack,
                        observacionesBack: it.observacionesBack
                    };
                });

                // 2. Archivos Referencia (Bocetos, Logos, Extras, Info Pedido)
                // Son todos los que NO son de producción.
                const ordenReferencias = rawFiles.filter(f => !prodTypes.includes(f.tipo));

                // Extracción Robusta de CodArticulo y CodStock (puede venir en raiz de cabecera o dentro de material object)
                let finalCodArt = cabecera.codArticulo || cabecera.codArt;
                let finalCodStock = cabecera.codStock;

                if (!finalCodArt && cabecera.material && typeof cabecera.material === 'object') {
                    finalCodArt = cabecera.material.codArt || cabecera.material.codArticulo;
                    finalCodStock = cabecera.material.codStock;
                }

                // Construir Nota con Metadatos Técnicos
                let serviceNote = srv.notas || '';
                let techInfo = '';

                if (srv.metadata) {
                    const metaParts = [];
                    if (srv.metadata.prendas) metaParts.push(`Prendas: ${srv.metadata.prendas}`);
                    if (srv.metadata.estampadosPorPrenda) metaParts.push(`Bajadas: ${srv.metadata.estampadosPorPrenda}`); // User asked for 'bajadas'
                    if (srv.metadata.origen) metaParts.push(`Origen: ${srv.metadata.origen}`);
                    if (srv.metadata.moldType) metaParts.push(`Molde: ${srv.metadata.moldType}`);
                    if (srv.metadata.fabricOrigin) metaParts.push(`Tela: ${srv.metadata.fabricOrigin}`);

                    if (metaParts.length > 0) {
                        techInfo = metaParts.join(', '); // Format: "Prendas: 45, Bajadas: 3, Origen: Cliente"
                        serviceNote = (serviceNote ? serviceNote + '\n' : '') + `[DATOS TÉCNICOS] ${techInfo}`;
                    }
                }

                pendingOrderExecutions.push({
                    areaID: areaID,
                    material: cabecera.material?.name || cabecera.material || 'Estándar',
                    variante: cabecera.variante || 'N/A',
                    codArticulo: finalCodArt,
                    codStock: finalCodStock,
                    items: ordenItems,
                    referencias: ordenReferencias,
                    isExtra: !srv.esPrincipal,
                    extraOriginId: srv.areaId,
                    magnitudInicial: 0,
                    notaAdicional: serviceNote, // Nota completa para la Orden
                    techInfo: techInfo // Info técnica limpia para ServiciosExtraOrden
                });
            });

            // CASO 2: ESTRUCTURA VIEJA (Lineas / Items Planos)
        } else if (lineas && lineas.length > 0) {
            lineas.forEach(linea => {
                const cabecera = linea.cabecera || {};
                const sublineas = linea.sublineas || [];
                pendingOrderExecutions.push({
                    areaID: mainAreaID,
                    material: cabecera.material,
                    variante: cabecera.variante,
                    codArticulo: cabecera.codArticulo,
                    codStock: cabecera.codStock,
                    idProductoReact: cabecera.idProductoReact || cabecera.material?.id,
                    items: sublineas.map(sl => ({
                        fileName: sl.archivoPrincipal?.name,
                        fileBackName: sl.archivoDorso?.name,
                        copies: sl.cantidad,
                        note: sl.nota,
                        width: sl.width,
                        height: sl.height,
                        widthBack: sl.widthBack,
                        heightBack: sl.heightBack,
                        observaciones: sl.archivoPrincipal?.observaciones || ''
                    })),
                    referencias: [], // Legacy no maneja refs por linea asi
                    isExtra: false,
                    notaAdicional: '',
                    techInfo: ''
                });
            });
        } else {
            // Lógica de compatibilidad items plano (Legacy total)
            const groupsByMat = {};
            for (const item of items) {
                const matObj = item.material || (configuracion?.materialBase) || { name: 'Estándar' };
                const matWeb = matObj.name || matObj;
                const varWeb = (configuracion?.varianteBase) || req.body.subtype || 'Estándar';
                const key = `${matWeb}|${varWeb}`.toUpperCase();
                if (!groupsByMat[key]) {
                    groupsByMat[key] = {
                        areaID: mainAreaID,
                        material: matWeb,
                        variante: varWeb,
                        codArticulo: matObj.codArt,
                        codStock: matObj.codStock,
                        idProductoReact: matObj.id,
                        items: [],
                        isExtra: false,
                        referencias: [],
                        notaAdicional: '',
                        techInfo: ''
                    };
                }
                groupsByMat[key].items.push({
                    fileName: item.file?.name,
                    fileBackName: item.fileBack?.name,
                    copies: item.copies,
                    note: item.note,
                    width: item.width,
                    height: item.height
                });
            }
            Object.values(groupsByMat).forEach(g => pendingOrderExecutions.push(g));
        }

        // --- (Agregar Áreas Extras) ---
        if (selectedComplementary) {
            Object.entries(selectedComplementary).forEach(([extraId, val]) => {
                const activo = val.activo || val.active;
                if (!activo) return;
                const extraArea = EXTRA_ID_TO_AREA[extraId.toUpperCase()] || extraId.toUpperCase();
                const cabecera = val.cabecera || val.header;

                let areaMaterial = cabecera?.material?.name || (configuracion?.materialBase?.name || 'Estándar');
                let areaVariante = cabecera?.variante || 'N/A';

                let extraCodArt = null;
                let extraCodStock = null;
                let extraIdProd = null;
                let magnitudInicial = 0;

                if (extraArea === 'TWT' || extraId.toUpperCase() === 'COSTURA') {
                    areaMaterial = 'Costura';
                    areaVariante = 'Costura';
                    extraCodArt = '115';
                    extraCodStock = '1.1.7.1';
                    magnitudInicial = parseInt(val.cantidad || val.quantity || cabecera?.cantidad || 0);
                }

                let serviceSpec = '';
                if (val.metadata?.prendas) serviceSpec += `Prendas: ${val.metadata.prendas}`;
                if (val.metadata?.material) serviceSpec += (serviceSpec ? ', ' : '') + `Mat: ${val.metadata.material}`;

                const finalExtraNote = [val.notas, serviceSpec].filter(x => x).join(' | ');

                pendingOrderExecutions.push({
                    areaID: extraArea,
                    material: areaMaterial,
                    variante: areaVariante,
                    codArticulo: extraCodArt,
                    codStock: extraCodStock,
                    idProductoReact: extraIdProd,
                    isExtra: true,
                    extraOriginId: extraId,
                    magnitudInicial: magnitudInicial,
                    items: [],
                    referencias: [],
                    notaAdicional: finalExtraNote,
                    techInfo: serviceSpec
                });
            });
        }

        // --- 5B. ORDENAR EJECUCIONES POR PRIORIDAD (Lógica Homogénea con Sync) ---
        // Debug Log
        console.log("--- DEBUG SORTING ---");
        console.log("Mapa Areas Numero:", JSON.stringify(mapaAreasNumero));
        pendingOrderExecutions.forEach(e => {
            console.log(`Area: ${e.areaID} - Prioridad: ${mapaAreasNumero[e.areaID] || 999}`);
        });

        // Esto asegura que la numeración (1/N, 2/N) respete el flujo real del proceso.
        pendingOrderExecutions.sort((a, b) => {
            // Normalizar keys para asegurar match (toUpperCase ya se hizo al crear areaID pero doble check)
            const idA = (a.areaID || '').toUpperCase().trim();
            const idB = (b.areaID || '').toUpperCase().trim();

            // Sync logic usa 'Numero' de ConfigMapeoERP.
            // Asegurar que mapaAreasNumero tenga keys en Upper.
            const pA = mapaAreasNumero[idA] !== undefined ? mapaAreasNumero[idA] : 999;
            const pB = mapaAreasNumero[idB] !== undefined ? mapaAreasNumero[idB] : 999;

            return pA - pB;
        });

        // --- LIMPIEZA DE DATOS (FIX IDPRODUCTOREACT) ---
        // Asegurar que CodArticulo no tenga espacios antes de buscar IDReact
        pendingOrderExecutions.forEach(exec => {
            if (exec.codArticulo) {
                exec.codArticulo = String(exec.codArticulo).trim();
            }
        });

        // --- NUEVO: LOOKUP DE IdProductoReact EN BASE A CodArticulo ---
        // Recolectar todos los códigos de artículo
        const codesToLookup = [...new Set(pendingOrderExecutions.map(e => e.codArticulo).filter(c => c))];

        if (codesToLookup.length > 0) {
            try {
                // Consulta dinámica para obtener IDs
                // Asumimos tabla 'Articulos' y columnas 'CodigoArticulo' / 'Id'
                const request = pool.request();
                // Construir lista de parámetros para la query IN (...)
                const clauses = codesToLookup.map((_, i) => `CodigoArticulo = @cod${i}`).join(' OR ');
                codesToLookup.forEach((c, i) => request.input(`cod${i}`, sql.VarChar(50), c));

                const artRes = await request.query(`SELECT Id, CodigoArticulo FROM Articulos WHERE ${clauses}`);

                const mapArtId = {};
                artRes.recordset.forEach(r => {
                    if (r.CodigoArticulo) mapArtId[r.CodigoArticulo.trim().toUpperCase()] = r.Id; // o 'ID'
                });

                // Asignar IDs a las ejecuciones
                pendingOrderExecutions.forEach(exec => {
                    if (exec.codArticulo && !exec.idProductoReact) {
                        const foundId = mapArtId[exec.codArticulo.trim().toUpperCase()];
                        if (foundId) exec.idProductoReact = foundId;
                    }
                });

            } catch (lookupErr) {
                console.warn("⚠️ No se pudo resolver IdProductoReact desde Articuls:", lookupErr.message);
                // No bloqueamos el flujo, seguimos con lo que tengamos
            }
        }


        // --- 6. TRANSACCIÓN DB ---
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const filesToUpload = [];
            const generatedOrders = [];
            const generatedIDs = [];
            const timestamp = Date.now();
            let totalMagnitud = 0;

            for (let idx = 0; idx < pendingOrderExecutions.length; idx++) {
                const exec = pendingOrderExecutions[idx];
                const globalIndex = idx + 1;
                const docNumber = pendingOrderExecutions.length > 1 ? `${erpDocNumber} (${globalIndex}/${pendingOrderExecutions.length})` : erpDocNumber;
                exec.codigoOrden = `ORD-${docNumber}`;

                // helper sanitize ya está en scope global si lo moví bien, si no lo redefino por seguridad
                const sanitize = (str) => (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();

                // --- CALCULAR PRÓXIMO SERVICIO (Lógica Secuencial Homogénea) ---
                // Al estar ordenado por prioridad, el próximo servicio es simplemente el siguiente en la lista.
                let proximoServicio = 'DEPOSITO';

                // Buscar siguiente servicio distinto al actual
                for (let k = idx + 1; k < pendingOrderExecutions.length; k++) {
                    const nextExec = pendingOrderExecutions[k];
                    if (nextExec.areaID !== exec.areaID) {
                        proximoServicio = nextExec.areaID;
                        break;
                    }
                }

                // Fallback a lógica de rutas si no hay siguiente en lista (ej. ultimo paso que salta a instalación o cliente)
                if (proximoServicio === 'DEPOSITO') {
                    // Lógica legacy de rutas para casos terminales o branches no lineales
                    // ... se mantiene o se simplifica. Por ahora el secuencial cubre el 90% de casos.
                }

                // Determinar UM
                const areaUM = mapaAreasUM[exec.areaID] || 'u';

                // ID del producto (si lo tenemos en exec)
                const idProdReact = exec.idProductoReact || null;

                // Combinar Nota General + Nota Específica del Servicio (Metadatos)
                const combinedNote = [finalNote, exec.notaAdicional].filter(n => n && n.trim()).join(' | ');

                // INSERCIÓN DE ORDEN CON ESTADO 'Cargando...'
                const resOrder = await new sql.Request(transaction)
                    .input('AreaID', sql.VarChar(20), exec.areaID)
                    .input('Cliente', sql.NVarChar(200), nombreCliente)
                    .input('CodCliente', sql.Int, codCliente)
                    .input('IdClienteReact', sql.VarChar(50), idClienteReact ? idClienteReact.toString() : null)
                    .input('Desc', sql.NVarChar(300), jobName)
                    .input('Prio', sql.VarChar(20), urgency)
                    .input('Mat', sql.VarChar(255), exec.material)
                    .input('Var', sql.VarChar(100), exec.variante)
                    .input('Cod', sql.VarChar(50), exec.codigoOrden)
                    .input('ERP', sql.VarChar(50), erpDocNumber)
                    .input('Nota', sql.NVarChar(sql.MAX), combinedNote)
                    .input('Mag', sql.VarChar(50), String(exec.magnitudInicial || '0')) // Magnitud inicial (cero si no hay dato)
                    .input('Prox', sql.VarChar(50), proximoServicio)
                    .input('Estado', sql.VarChar(50), 'Cargando...')
                    .input('UM', sql.VarChar(20), areaUM)
                    .input('CodArt', sql.VarChar(50), exec.codArticulo || null)
                    .input('IdProdReact', sql.Int, idProdReact)
                    .query(`
                        INSERT INTO Ordenes (
                            AreaID, Cliente, CodCliente, IdClienteReact, DescripcionTrabajo, Prioridad, 
                            FechaIngreso, FechaEstimadaEntrega, Material, Variante, 
                            CodigoOrden, NoDocERP, Nota, Magnitud, ProximoServicio, UM, Estado, EstadoenArea,
                            CodArticulo, IdProductoReact
                        )
                        OUTPUT INSERTED.OrdenID
                        VALUES (
                            @AreaID, @Cliente, @CodCliente, @IdClienteReact, @Desc, @Prio, 
                            GETDATE(), DATEADD(day, 3, GETDATE()), @Mat, @Var, 
                            @Cod, @ERP, @Nota, @Mag, @Prox, @UM, @Estado, @Estado,
                            @CodArt, @IdProdReact
                        )
                    `);

                const newOID = resOrder.recordset[0].OrdenID;
                generatedOrders.push(exec.codigoOrden);
                generatedIDs.push(newOID);

                // --- REGISTRAR ARCHIVOS ESPERADOS (PLACEHOLDERS) ---
                let totalMagnitud = 0;
                let fileCount = 0;

                for (let i = 0; i < exec.items.length; i++) {
                    const item = exec.items[i];
                    // sanitize ya está definido arriba

                    // Calcular UM una sola vez por item
                    const umLower = areaUM.toLowerCase();

                    // ARCHIVO PRINCIPAL
                    if (item.fileName) {
                        // FRONTEND ENVÍA METROS AHORA.
                        const wM = parseFloat(item.width) || 0;
                        const hM = parseFloat(item.height) || 0;

                        // CÁLCULO DE METROS SEGÚN UM
                        let valMetros = 0;

                        if (umLower === 'm2') {
                            valMetros = (wM * hM);
                        } else if (umLower === 'm') {
                            valMetros = hM; // Solo ALTO
                        } else {
                            valMetros = 0; // Para unidades, no sumamos "Metros" en el archivo individual, o sí?
                            // Si es unitario, el archivo ocupa "nada" en metros, pero "1" en cantidad.
                        }

                        // Extraer extensión
                        const parts = item.fileName.split('.');
                        const ext = parts.length > 1 ? `.${parts.pop()}` : '';

                        // NUEVO FORMATO: ORD-XX... (xCOPIAS).ext
                        const finalName = `${exec.codigoOrden.replace(/\//g, '-')}_${sanitize(nombreCliente)}_${sanitize(jobName)}_Archivo ${i + 1} de ${exec.items.length} (x${item.copies || 1})${ext}`;

                        const resFile = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Nom', sql.VarChar(200), finalName)
                            .input('Tipo', sql.VarChar(50), 'Impresion')
                            .input('Cop', sql.Int, item.copies || 1)
                            .input('Met', sql.Decimal(10, 3), valMetros)
                            .input('Ancho', sql.Decimal(10, 2), wM)
                            .input('Alto', sql.Decimal(10, 2), hM)
                            .input('Obs', sql.NVarChar(sql.MAX), item.observaciones || '')
                            .input('CodArt', sql.VarChar(50), exec.codArticulo || null)
                            .query(`
                                INSERT INTO ArchivosOrden (
                                    OrdenID, NombreArchivo, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida,
                                    Ancho, Alto, Observaciones, CodigoArticulo
                                ) 
                                OUTPUT INSERTED.ArchivoID 
                                VALUES (
                                    @OID, @Nom, @Tipo, @Cop, @Met, 'Pendiente', GETDATE(),
                                    @Ancho, @Alto, @Obs, @CodArt
                                )
                            `);

                        filesToUpload.push({
                            dbId: resFile.recordset[0].ArchivoID,
                            type: 'ORDEN',
                            originalName: item.fileName, // Para que el front sepa cuál es
                            finalName: finalName,
                            area: exec.areaID
                        });

                        // CÁLCULO DE MAGNITUD TOTAL
                        if (umLower === 'u') {
                            totalMagnitud += (item.copies || 1);
                        } else {
                            totalMagnitud += (valMetros * (item.copies || 1));
                        }

                        fileCount++;
                    }

                    // ARCHIVO DORSO (Back)
                    if (item.fileBackName) {
                        // Calcular Metros Dorso
                        let valMetrosBack = 0;
                        // Extraer dimensiones SIEMPRE, no solo para ml/m2
                        const wMBack = parseFloat(item.widthBack) || 0;
                        const hMBack = parseFloat(item.heightBack) || 0;

                        if (umLower === 'ml' || umLower === 'm2') {
                            if (umLower === 'ml') valMetrosBack = hMBack; // Metros lineales = Alto
                            else valMetrosBack = wMBack * hMBack; // Metros cuadrados
                        } else if (umLower === 'u') {
                            valMetrosBack = 0; // Unitario no ocupa metros para cobro, pero sí tiene dimensiones físicas
                        }

                        const partsBack = item.fileBackName.split('.');
                        const extBack = partsBack.length > 1 ? `.${partsBack.pop()}` : '';
                        const finalNameBack = `${exec.codigoOrden.replace(/\//g, '-')}_${sanitize(nombreCliente)}_${sanitize(jobName)}_DORSO Archivo ${i + 1} de ${exec.items.length} (x${item.copies || 1})${extBack}`;

                        const obsBack = (item.observacionesBack || '') + (item.observacionesBack?.includes('DORSO') ? '' : ' [DORSO]');

                        const resFileBack = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Nom', sql.VarChar(200), finalNameBack)
                            .input('Tipo', sql.VarChar(50), 'Impresion') // FIX: Usar 'Impresion' estándar
                            .input('Cop', sql.Int, item.copies || 1)
                            .input('Met', sql.Decimal(10, 3), valMetrosBack)
                            .input('Ancho', sql.Decimal(10, 2), wMBack)
                            .input('Alto', sql.Decimal(10, 2), hMBack)
                            .input('Obs', sql.NVarChar(sql.MAX), obsBack)
                            .input('CodArt', sql.VarChar(50), exec.codArticulo || null)
                            .query(`
                                INSERT INTO ArchivosOrden (
                                    OrdenID, NombreArchivo, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida,
                                    Ancho, Alto, Observaciones, CodigoArticulo
                                ) 
                                OUTPUT INSERTED.ArchivoID 
                                VALUES (
                                    @OID, @Nom, @Tipo, @Cop, @Met, 'Pendiente', GETDATE(),
                                    @Ancho, @Alto, @Obs, @CodArt
                                )
                            `);

                        filesToUpload.push({
                            dbId: resFileBack.recordset[0].ArchivoID,
                            type: 'ORDEN',
                            originalName: item.fileBackName, // Nombre real para buscar en upload
                            finalName: finalNameBack,
                            area: exec.areaID
                        });

                        // Sumar magnitud dorso si corresponde (generalmente Twinface se cobra por m2 total o u, si es doble cara quizás suma m2)
                        // Si es 'u', ya se sumó por el frente (es el mismo objeto físico).
                        // Si es 'm2' o 'ml', IMPRESIÓN doble cara consume TINTA y MATERIAL DOBLE si es rollo?
                        // Si es Impresion Directa (DTF UV), se cobra por cara?
                        // Asumiremos que si hay archivo dorso, suma metros.
                        if (umLower !== 'u') {
                            totalMagnitud += (valMetrosBack * (item.copies || 1));
                        }
                        fileCount++;
                    }
                }

                if (fileCount > 0) {
                    await new sql.Request(transaction).input('OID', sql.Int, newOID).input('C', sql.Int, fileCount).input('Mag', sql.Decimal(10, 2), totalMagnitud)
                        .query("UPDATE Ordenes SET ArchivosCount = @C, Magnitud = CAST(@Mag AS VARCHAR) WHERE OrdenID = @OID");
                }

                // --- DEPURACIÓN: LOG DE REFERENCIAS ---
                // console.log(`[Order ${exec.codigoOrden}] RefCount: ${exec.referencias?.length || 0}`);

                // --- ARCHIVOS DE REFERENCIA ---

                // 0. REFERENCIAS VINCULADAS AL SERVICIO (Nueva Lógica)
                if (exec.referencias && exec.referencias.length > 0) {
                    for (const ref of exec.referencias) {
                        const fName = `REF-${erpDocNumber}-${sanitize(ref.name)}`;
                        const tipo = ref.tipo || 'REFERENCIA';

                        const resRef = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), tipo)
                            .input('Nom', sql.VarChar(200), fName)
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, @Tipo, @Nom, GETDATE(), 'Pendiente')`);

                        filesToUpload.push({
                            dbId: resRef.recordset[0].RefID,
                            type: 'REF',
                            originalName: ref.name,
                            finalName: fName,
                            area: 'GENERAL'
                        });
                    }
                }

                // *** NUEVO: SOPORTE FACTURACIÓN (ServiciosExtraOrden) ***
                // Si la orden es un servicio extra (no principal) o es explícitamente Estampado/Bordado, guardamos item de facturación
                // El usuario pidió explícitamente replicar lógica de Sync para "que me sirva para la facturacion".
                if (exec.isExtra || ['EST', 'EMB', 'TWT', 'TWC'].includes(exec.areaID)) {
                    // Calcular cantidad total (suma de copias o magnitud inicial)
                    let qtyFact = exec.magnitudInicial || 0;
                    if (qtyFact === 0 && exec.items && exec.items.length > 0) {
                        qtyFact = exec.items.reduce((sum, it) => sum + (parseInt(it.copies) || 1), 0);
                    }
                    if (qtyFact === 0) qtyFact = 1;

                    // Insertar
                    if (exec.codArticulo) {
                        const obsFacturacion = exec.techInfo || 'Generado desde WebOrder';
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Cod', sql.VarChar(50), exec.codArticulo)
                            .input('Stk', sql.VarChar(50), exec.codStock || '')
                            .input('Des', sql.NVarChar(255), `${exec.variante} - ${exec.material}`)
                            .input('Cnt', sql.Decimal(18, 2), qtyFact)
                            .input('Obs', sql.NVarChar(sql.MAX), obsFacturacion)
                            .query(`
                                INSERT INTO ServiciosExtraOrden 
                                (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro) 
                                VALUES (@OID, @Cod, @Stk, @Des, @Cnt, 0, 0, @Obs, GETDATE())
                            `);
                    }
                }

                // 1. GENERALES Y ESPECIALIZADOS (Siempre a la 1ra orden / Principal)
                if (idx === 0) {
                    // Referencias Generales
                    for (const rf of referenceFiles) {
                        const finalNameRef = `REF-${erpDocNumber}-${rf.name}`;
                        const resRef = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), rf.type || 'REFERENCIA')
                            .input('Nom', sql.VarChar(200), finalNameRef)
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, @Tipo, @Nom, GETDATE(), 'Pendiente')`);

                        filesToUpload.push({
                            dbId: resRef.recordset[0].RefID,
                            type: 'REF',
                            originalName: rf.name,
                            finalName: finalNameRef,
                            area: 'GENERAL'
                        });
                    }

                    // Especializados
                    for (const sf of specializedFiles) {
                        const finalNameSpec = `SPEC-${erpDocNumber}-${sf.name}`;
                        const resRef = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), sf.type || 'ESPECIALIZADO')
                            .input('Nom', sql.VarChar(200), finalNameSpec)
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, @Tipo, @Nom, GETDATE(), 'Pendiente')`);

                        filesToUpload.push({
                            dbId: resRef.recordset[0].RefID,
                            type: 'REF',
                            originalName: sf.name,
                            finalName: finalNameSpec,
                            area: 'GENERAL'
                        });
                    }
                }

                // 2. COMPLEMENTARIOS ESPECÍFICOS (Vinculados a su Orden Extra correspondiente)
                // PROTECCION: Solo si NO usamos el nuevo sistema de referencias integradas
                if (exec.isExtra && exec.extraOriginId && selectedComplementary && (!exec.referencias || exec.referencias.length === 0)) {
                    const val = selectedComplementary[exec.extraOriginId];
                    if (val && (val.activo || val.active) && val.archivo && val.archivo.name) {
                        const finalNameComp = `BOCETO-${erpDocNumber}-${exec.extraOriginId}-${val.archivo.name}`;
                        const resRef = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), 'ARCHIVO DE BOCETO')
                            .input('Nom', sql.VarChar(200), finalNameComp)
                            .input('Not', sql.NVarChar(sql.MAX), val.observacion || val.text || '')
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, NotasAdicionales, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, @Tipo, @Nom, @Not, GETDATE(), 'Pendiente')`);

                        filesToUpload.push({
                            dbId: resRef.recordset[0].RefID,
                            type: 'REF',
                            originalName: val.archivo.name,
                            finalName: finalNameComp,
                            area: 'GENERAL'
                        });
                    }
                }

                // 3. BORDADO (Vinculado específicamente a órdenes de tipo 'EMB')
                // Nota: Si hay una orden explícita de bordado, la usamos. Si no, ¿irían a la principal? 
                // Asumimos que si hay specs, hay orden de bordado.
                if (exec.areaID === 'EMB' && req.body.especificacionesBordado) {
                    const bs = req.body.especificacionesBordado;
                    if (bs.boceto && bs.boceto.name) {
                        const fName = `BOCETO-BORDADO-${erpDocNumber}-${bs.boceto.name}`;
                        const resRef = await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Nom', sql.VarChar(200), fName).query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, 'ARCHIVO DE BOCETO', @Nom, GETDATE(), 'Pendiente')`);
                        filesToUpload.push({ dbId: resRef.recordset[0].RefID, type: 'REF', originalName: bs.boceto.name, finalName: fName, area: 'GENERAL' });
                    }
                    if (bs.logos && Array.isArray(bs.logos)) {
                        for (const logo of bs.logos) {
                            if (logo.name) {
                                const lName = `LOGO-BORDADO-${erpDocNumber}-${logo.name}`;
                                const resRef = await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Nom', sql.VarChar(200), lName).query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, 'ARCHIVO DE LOGO', @Nom, GETDATE(), 'Pendiente')`);
                                filesToUpload.push({ dbId: resRef.recordset[0].RefID, type: 'REF', originalName: logo.name, finalName: lName, area: 'GENERAL' });
                            }
                        }
                    }
                }

                // --- SERVICIOS EXTRA (Solo insertar registros, sin archivos) ---
                // (Bloque residual eliminado para limpieza)

            } // Fin loop ejecuciones

            // ACTIVAR AUTOMÁTICAMENTE ORDENES SIN ARCHIVOS PENDIENTES (Ej. Solo Costura)
            for (const oid of generatedIDs) {
                const checkRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, oid)
                    .query(`
                        SELECT 
                            (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND EstadoArchivo != 'Cancelado') as TotalProd,
                            (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND RutaAlmacenamiento IS NULL AND EstadoArchivo != 'Cancelado') as PendProd,
                            (SELECT COUNT(*) FROM ArchivosReferencia WHERE OrdenID = @OID) as TotalRef,
                            (SELECT COUNT(*) FROM ArchivosReferencia WHERE OrdenID = @OID AND UbicacionStorage = 'Pendiente') as PendRef
                    `);

                if (checkRes.recordset.length > 0) {
                    const { PendProd, PendRef } = checkRes.recordset[0];
                    if ((PendProd + PendRef) === 0) {
                        // Si no hay nada pendiente, activar.
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, oid)
                            .query(`UPDATE Ordenes SET Estado = 'Pendiente', EstadoenArea = 'Pendiente' WHERE OrdenID = @OID AND Estado = 'Cargando...'`);
                    }
                }
            }

            await transaction.commit();

            // RESPUESTA AL FRONTEND: "Orden Creada, Ahora Sube los Archivos"
            res.json({
                success: true,
                orderIds: generatedOrders,
                requiresUpload: filesToUpload.length > 0,
                uploadManifest: filesToUpload
            });

        } catch (dbErr) {
            if (transaction) await transaction.rollback();
            throw dbErr;
        }

    } catch (err) {
        console.error("❌ Error creando estructura de pedido:", err);
        res.status(500).json({ error: "Error iniciando pedido: " + err.message });
    }
};

// --- SUBIDA DE ARCHIVOS POR STREAMING (UNO A UNO) ---
exports.uploadOrderFile = async (req, res) => {
    const { dbId, type, finalName, area } = req.body;
    const file = req.file;

    if (!file || !dbId || !type || !finalName) {
        return res.status(400).json({ error: "Faltan datos (archivo, dbId, type, finalName)" });
    }

    console.log(`🚀 [UploadStream] Recibiendo archivo: ${finalName} (${file.size} bytes)`);

    try {
        const driveUrl = await driveService.uploadToDrive(file.buffer, finalName, area || 'GENERAL');

        const pool = await getPool();
        let orderID = null;

        if (type === 'ORDEN') {
            const resUpd = await pool.request()
                .input('ID', sql.Int, dbId)
                .input('Url', sql.VarChar(500), driveUrl)
                .query(`
                    UPDATE ArchivosOrden 
                    SET RutaAlmacenamiento = @Url, EstadoArchivo = 'Pendiente'
                    OUTPUT INSERTED.OrdenID
                    WHERE ArchivoID = @ID
                `);
            if (resUpd.recordset.length > 0) orderID = resUpd.recordset[0].OrdenID;

        } else if (type === 'REF') {
            const resUpd = await pool.request()
                .input('ID', sql.Int, dbId)
                .input('Url', sql.VarChar(500), driveUrl)
                .query(`
                    UPDATE ArchivosReferencia 
                    SET UbicacionStorage = @Url
                    OUTPUT INSERTED.OrdenID
                    WHERE RefID = @ID
                `);
            if (resUpd.recordset.length > 0) orderID = resUpd.recordset[0].OrdenID;
        }

        // 3. Verificar si el PEDIDO COMPLETO está listo
        if (orderID) {
            // Contamos archivos pendientes de esa orden (tanto de producción como referencias)
            const checkQuery = `
                SELECT 
                    (SELECT COUNT(*) FROM ArchivosOrden WHERE OrdenID = @OID AND RutaAlmacenamiento IS NULL) as PendientesProd,
                    (SELECT COUNT(*) FROM ArchivosReferencia WHERE OrdenID = @OID AND UbicacionStorage = 'Pendiente') as PendientesRef
            `;
            const checkRes = await pool.request().input('OID', sql.Int, orderID).query(checkQuery);

            const pendientes = checkRes.recordset[0].PendientesProd + checkRes.recordset[0].PendientesRef;

            if (pendientes === 0) {
                console.log(`✅ [Pedido Completo] Orden ${orderID} tiene todos sus archivos. Activando...`);
                // Cambiar estado de 'Cargando...' a 'Pendiente'
                // TAMBIEN EstadoenArea = 'Pendiente'
                await pool.request().input('OID', sql.Int, orderID).query(`UPDATE Ordenes SET Estado = 'Pendiente', EstadoenArea = 'Pendiente' WHERE OrdenID = @OID AND Estado = 'Cargando...'`);

                // Notificar sockets
                const io = req.app.get('socketio');
                if (io) io.emit('server:ordersUpdated', { count: 1, source: 'web-upload' });
            }
        }

        res.json({ success: true, driveUrl });

    } catch (error) {
        console.error("❌ Error en subida streaming:", error);
        res.status(500).json({ error: "Fallo subida a Drive: " + error.message });
    }
};
// --- OBTENER ESTADO EN FÁBRICA ---
exports.getClientOrders = async (req, res) => {
    const codCliente = req.user?.codCliente;
    if (!codCliente) return res.status(401).json({ error: "Usuario no identificado como cliente." });

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('cod', sql.Int, codCliente)
            .query(`
                SELECT TOP 100
                    OrdenID,
                    CodigoOrden,
                    NoDocERP,
                    AreaID,
                    DescripcionTrabajo,
                    Material,
                    Variante,
                    Prioridad,
                    FechaIngreso,
                    Estado,
                    EstadoenArea,
                    ProximoServicio
                FROM Ordenes
                WHERE CodCliente = @cod
                ORDER BY FechaIngreso DESC
            `);

        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error("❌ Error al obtener órdenes del cliente:", err);
        res.status(500).json({ error: "Error al consultar la base de datos." });
    }
};

// --- ELIMINAR PEDIDO INCOMPLETO (ZOMBIE) ---
exports.deleteIncompleteOrder = async (req, res) => {
    const codCliente = req.user?.codCliente;
    const { id } = req.params;

    if (!codCliente || !id) return res.status(400).json({ error: "Datos inválidos" });

    try {
        const pool = await getPool();

        // Verificar que sea del cliente y esté en 'Cargando...'
        const check = await pool.request()
            .input('OID', sql.Int, id)
            .input('Cod', sql.Int, codCliente)
            .query("SELECT OrdenID, Estado FROM Ordenes WHERE OrdenID = @OID AND CodCliente = @Cod");

        if (check.recordset.length === 0) return res.status(404).json({ error: "Pedido no encontrado o no autorizado." });

        // Permitir cancelar si está Cargando (fail) o Pendiente (aún no tomado)
        const estado = check.recordset[0].Estado;
        if (!['Cargando...', 'Pendiente'].includes(estado)) {
            return res.status(400).json({ error: `No se puede eliminar el pedido porque ya está en estado: ${estado}` });
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqTx = new sql.Request(transaction);

            if (estado === 'Pendiente') {
                // SOFT DELETE (Cancelar) - Queda en historial
                await reqTx.input('OID_C', sql.Int, id).query("UPDATE Ordenes SET Estado = 'Cancelado' WHERE OrdenID = @OID_C");
                await transaction.commit();
                return res.json({ success: true, message: "Pedido cancelado correctamente." });
            }

            await reqTx.input('OID', sql.Int, id).query("DELETE FROM ArchivosOrden WHERE OrdenID = @OID");
            await reqTx.input('OID2', sql.Int, id).query("DELETE FROM ArchivosReferencia WHERE OrdenID = @OID2");
            // Servicios extra si los hubiera
            await reqTx.input('OID3', sql.Int, id).query("DELETE FROM ServiciosExtraOrden WHERE OrdenID = @OID3");

            await reqTx.input('OID4', sql.Int, id).query("DELETE FROM Ordenes WHERE OrdenID = @OID4");

            await transaction.commit();
            res.json({ success: true, message: "Pedido incompleto eliminado." });
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

    } catch (err) {
        console.error("❌ Error eliminando pedido incompleto:", err);
        res.status(500).json({ error: "Error eliminando el pedido." });
    }
};

// --- ELIMINAR PROYECTO COMPLETO (BUNDLE) ---
exports.deleteOrderBundle = async (req, res) => {
    const codCliente = req.user?.codCliente;
    const { docId } = req.params; // NoDocERP or CodigoOrden base

    if (!codCliente || !docId) return res.status(400).json({ error: "Datos inválidos" });

    try {
        const pool = await getPool();

        // 1. Identificar todas las órdenes del bundle
        const findQuery = `
            SELECT OrdenID, Estado, CodigoOrden 
            FROM Ordenes 
            WHERE CodCliente = @Cod 
            AND (NoDocERP = @Doc OR CodigoOrden = @Doc)
        `;

        const check = await pool.request()
            .input('Doc', sql.VarChar(50), docId)
            .input('Cod', sql.Int, codCliente)
            .query(findQuery);

        if (check.recordset.length === 0) return res.status(404).json({ error: "Proyecto no encontrado." });

        const orders = check.recordset;
        const ids = orders.map(o => o.OrdenID);

        // 2. Validar Estados
        const safeStates = ['Cargando...', 'Pendiente'];
        const unsafe = orders.filter(o => !safeStates.includes(o.Estado));

        if (unsafe.length > 0) {
            return res.status(400).json({
                error: `No se puede cancelar todo el proyecto. La orden ${unsafe[0].CodigoOrden} ya está en proceso (${unsafe[0].Estado}). Contacta a fábrica.`
            });
        }

        // 3. Borrar Todo
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqTx = new sql.Request(transaction);

            for (const oid of ids) {
                // Safety check
                if (typeof oid !== 'number') continue;
                await reqTx.query(`DELETE FROM ArchivosOrden WHERE OrdenID = ${oid}`);
                await reqTx.query(`DELETE FROM ArchivosReferencia WHERE OrdenID = ${oid}`);
                await reqTx.query(`DELETE FROM ServiciosExtraOrden WHERE OrdenID = ${oid}`);
                await reqTx.query(`DELETE FROM Ordenes WHERE OrdenID = ${oid}`);
            }

            await transaction.commit();
            res.json({ success: true, message: `Proyecto ${docId} eliminado (${ids.length} órdenes canceladas).` });

        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

    } catch (err) {
        console.error("❌ Error eliminando bundle:", err);
        res.status(500).json({ error: "Error eliminando el proyecto." });
    }
};

// --- OBTENER ÓRDENES DE SUBLIMACIÓN ACTIVAS ---
exports.getActiveSublimationOrders = async (req, res) => {
    const codCliente = req.user?.codCliente;
    if (!codCliente) return res.status(401).json({ error: "Usuario no identificado." });

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('cod', sql.Int, codCliente)
            .query(`
                SELECT 
                    OrdenID,
                    CodigoOrden,
                    DescripcionTrabajo,
                    NoDocERP
                FROM Ordenes
                WHERE CodCliente = @cod
                  AND AreaID IN ('SB', 'SUB')
                  AND Estado NOT IN ('Finalizado', 'Cancelado', 'Entregado')
                ORDER BY FechaIngreso DESC
            `);

        res.json({ success: true, data: result.recordset });
    } catch (err) {
        console.error("❌ Error al obtener órdenes de sublimación:", err);
        res.status(500).json({ error: "Error al consultar la base de datos." });
    }
};

// --- FUNCTION TO GET AREA MAPPINGS ---
exports.getAreaMapping = async (req, res) => {
    try {
        const pool = await getPool(); // Fix internal function usage
        // Usamos CodOrden porque es el código que el frontend conoce (DF, EMB, SB, etc.)
        const result = await pool.request().query(`
            SELECT DISTINCT CodOrden, NombreReferencia, VisibleWeb, DescripcionWeb, ImagenWeb, ActivosComplementarios
            FROM ConfigMapeoERP 
            WHERE NombreReferencia IS NOT NULL AND CodOrden IS NOT NULL
        `);

        const names = {};
        const visibility = {};

        if (result.recordset) {
            result.recordset.forEach(row => {
                if (row.CodOrden) {
                    const code = row.CodOrden.trim();
                    if (row.NombreReferencia) {
                        names[code] = row.NombreReferencia.trim();
                    }
                    // Si VisibleWeb es false o 0, ocultar. Sino mostrar.
                    // Ahora guardamos un OBJETO con más info, no solo true/false.
                    // Para mantener compatibilidad con Dashboard (que espera boolean true/false):
                    // No podemos romper Dashboard.jsx: `visibleConfig[erpCode] === false`
                    // Asi que visibility[code] debe seguir siendo BOOLEAN si queremos compatibilidad 100% inmediata sin tocar Dashboard.
                    // PERO OrderForm necesita el texto.
                    // SOLUCIÓN: visibility[code] = { visible: boolean, desc: string, img: string }
                    // Y arreglar Dashboard.jsx para leer .visible

                    visibility[code] = {
                        visible: (row.VisibleWeb === false || row.VisibleWeb === 0) ? false : true,
                        description: row.DescripcionWeb || '',
                        image: row.ImagenWeb || '',
                        complementarios: row.ActivosComplementarios ? JSON.parse(row.ActivosComplementarios) : null
                    };
                }
            });
        }

        // Return structured data
        res.json({ success: true, data: { names, visibility } });
    } catch (error) {
        console.error("❌ Error fetching area mapping:", error);
        res.status(500).json({ success: false, error: "Error retrieving area mappings." });
    }
};

exports.updateAreaVisibility = async (req, res) => {
    const { codOrden } = req.params;
    const { visible, description, image, complementarios } = req.body;

    try {
        const pool = await getPool();
        // Solo actualizamos lo que viene definido
        // Pero para simplificar, asumimos que el frontend manda todo el estado actual.

        let query = `UPDATE ConfigMapeoERP SET `;
        const updates = [];

        if (visible !== undefined) {
            updates.push(`VisibleWeb = @vis`);
        }
        if (description !== undefined) {
            updates.push(`DescripcionWeb = @desc`);
        }
        if (image !== undefined) {
            updates.push(`ImagenWeb = @img`);
        }
        if (complementarios !== undefined) {
            updates.push(`ActivosComplementarios = @comps`);
        }

        if (updates.length === 0) return res.json({ success: true, message: "Nada que actualizar" });

        query += updates.join(', ') + ` WHERE CodOrden = @cod`;

        const reqSql = pool.request()
            .input('cod', sql.VarChar, codOrden);

        if (visible !== undefined) reqSql.input('vis', sql.Bit, visible === true ? 1 : 0);
        if (description !== undefined) reqSql.input('desc', sql.NVarChar, description);
        if (image !== undefined) reqSql.input('img', sql.NVarChar, image);
        if (complementarios !== undefined) reqSql.input('comps', sql.NVarChar, JSON.stringify(complementarios));

        await reqSql.query(query);

        res.json({ success: true, message: "Configuración actualizada" });
    } catch (error) {
        console.error("❌ Error updating visibility:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

// getExternalToken removido - ya no se usa, los pagos se registran directamente en DB

// --- OBTENER ÓRDENES PARA RETIRO (QUERY DIRECTA A DB) ---
exports.getPickupOrders = async (req, res) => {
    try {
        const user = req.user;
        const codCliente = user ? user.codCliente : null;
        if (!codCliente) return res.status(401).json({ error: "Usuario no identificado." });

        const pool = await getPool();

        // 1. Obtener IDCliente String (ej: 'GOAT')
        const clientRes = await pool.request()
            .input('cod', sql.Int, codCliente)
            .query("SELECT IDCliente FROM Clientes WHERE CodCliente = @cod");

        if (!clientRes.recordset.length) return res.status(404).json({ error: "Cliente no encontrado" });

        const idClienteString = clientRes.recordset[0].IDCliente;

        // 2. Query directa a OrdenesDeposito (reemplaza legacy API)
        const ordersResult = await pool.request()
            .input('idCliente', sql.VarChar, idClienteString)
            .query(`
                SELECT 
                    o.OrdIdOrden AS IdOrden,
                    o.OrdCodigoOrden AS CodigoOrden,
                    o.OrdNombreTrabajo AS NombreTrabajo,
                    o.OrdCantidad AS Cantidad,
                    o.OrdCostoFinal AS CostoFinal,
                    o.OrdFechaEstadoActual AS FechaEstado,
                    e.EOrNombreEstado AS Estado,
                    c.IDCliente AS IdCliente,
                    c.TelefonoTrabajo AS Celular,
                    c.Tipo AS TipoCliente,
                    m.MonSimbolo
                FROM OrdenesDeposito o WITH(NOLOCK)
                LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = o.MonIdMoneda
                WHERE c.IDCliente = @idCliente
                AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar')
            `);

        const externalOrders = ordersResult.recordset;

        if (!externalOrders || externalOrders.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // 3. Cruzar con precios congelados y estado de pago en PedidosCobranza
        const codigosList = externalOrders.map(o => o.CodigoOrden).filter(Boolean);
        let cobranzasMap = {};
        if (codigosList.length > 0) {
            try {
                const request = pool.request();
                const params = codigosList.map((c, i) => {
                    request.input(`doc_${i}`, sql.VarChar(50), c);
                    return `@doc_${i}`;
                }).join(',');

                const cobRes = await request.query(`SELECT NoDocERP, MontoTotal, Moneda, EstadoCobro FROM PedidosCobranza WHERE NoDocERP IN (${params})`);
                cobRes.recordset.forEach(row => {
                    cobranzasMap[row.NoDocERP] = row;
                });
            } catch (sqle) {
                console.error("Error consultando PedidosCobranza en getPickupOrders:", sqle.message);
            }
        }

        // Helper para quantity
        const parseQuantity = (qtyStr) => {
            if (!qtyStr) return 1;
            if (typeof qtyStr === 'number') return qtyStr;
            const match = qtyStr.toString().match(/([\d\.]+)/);
            return match ? parseFloat(match[1]) : 1;
        };

        // 4. Mapear respuesta al formato frontend
        const pickupOrders = externalOrders.map(o => {
            const docId = o.CodigoOrden || `#${o.IdOrden}`;
            const cob = cobranzasMap[docId];

            let finalAmount = cob ? parseFloat(cob.MontoTotal) : (parseFloat(o.CostoFinal) || 0);
            let isPaid = cob ? cob.EstadoCobro === 'Pagado' : false;

            return {
                id: docId,
                rawId: o.IdOrden,
                desc: o.NombreTrabajo || 'Pedido',
                amount: finalAmount,
                date: o.FechaEstado ? new Date(o.FechaEstado).toLocaleDateString('es-UY') : 'N/A',
                status: isPaid ? 'PAGADO' : 'LISTO',
                originalStatus: o.Estado,
                isPaid: isPaid,
                currency: cob ? cob.Moneda : (o.MonSimbolo || '$'),
                quantity: parseQuantity(o.Cantidad),
                quantityStr: o.Cantidad ? String(o.Cantidad) : '1',
                clientId: o.IdCliente || 'N/A',
                contact: o.Celular ? o.Celular.trim() : '',
                clientType: o.TipoCliente ? o.TipoCliente.trim() : 'Comun'
            };
        });

        // Eliminar duplicados por ID de orden
        const seen = new Set();
        const uniqueOrders = pickupOrders.filter(o => {
            if (seen.has(o.id)) return false;
            seen.add(o.id);
            return true;
        });

        res.json({ success: true, data: uniqueOrders });

    } catch (error) {
        console.error("Error fetching pickup orders:", error);
        res.status(500).json({ error: "Error al obtener órdenes de retiro." });
    }
};

// --- API HELPERS ---
const parseAmount = (amt) => {
    if (typeof amt === 'number') return amt;
    if (!amt) return 0;
    const match = amt.toString().match(/([\d\.]+)/);
    return match ? parseFloat(match[1]) : 0;
};

// --- CREAR ORDEN DE RETIRO (QUERY DIRECTA A DB) ---
exports.createPickupOrder = async (req, res) => {
    const { selectedOrderIds, orders, totalCost, clientName, moneda } = req.body;

    if ((!selectedOrderIds || !selectedOrderIds.length) && (!orders || !orders.length)) {
        return res.status(400).json({ error: "No hay órdenes seleccionadas." });
    }

    try {
        const user = req.user;
        const codCliente = clientName || (user ? user.codCliente : null);
        if (!codCliente) return res.status(401).json({ error: "Usuario no identificado." });

        const pool = await getPool();
        const UsuarioAlta = user?.id || 70;
        const lugarRetiro = req.body.lugarRetiro || 5;

        // Determinar las órdenes a incluir
        let orderNumbers = [];
        let rawOrderIds = [];
        if (orders && Array.isArray(orders) && orders.length > 0) {
            orderNumbers = orders.map(o => o.orderNumber);
            rawOrderIds = orders.map(o => parseInt(o.OrdIdOrden, 10)).filter(id => !isNaN(id));
        } else if (selectedOrderIds && selectedOrderIds.length > 0) {
            // Buscar en OrdenesDeposito por los IDs seleccionados
            const clientRes = await pool.request()
                .input('cod', sql.Int, user ? user.codCliente : 0)
                .query("SELECT IDCliente FROM Clientes WHERE CodCliente = @cod");
            if (!clientRes.recordset.length) return res.status(404).json({ error: "Cliente no encontrado" });
            const idClienteString = clientRes.recordset[0].IDCliente;

            const ordersResult = await pool.request()
                .input('idCliente', sql.VarChar, idClienteString)
                .query(`
                    SELECT o.OrdIdOrden, o.OrdCodigoOrden, o.OrdCostoFinal, m.MonSimbolo
                    FROM OrdenesDeposito o WITH(NOLOCK)
                    LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                    LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                    LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = o.MonIdMoneda
                    WHERE c.IDCliente = @idCliente
                    AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar')
                `);

            for (const o of ordersResult.recordset) {
                const docId = o.OrdCodigoOrden || `#${o.OrdIdOrden}`;
                if (selectedOrderIds.includes(docId) || selectedOrderIds.includes(o.OrdCodigoOrden) || selectedOrderIds.includes(o.OrdIdOrden)) {
                    orderNumbers.push(String(o.OrdIdOrden));
                    rawOrderIds.push(o.OrdIdOrden);
                }
            }
        }

        if (orderNumbers.length === 0) return res.status(400).json({ error: "Órdenes no encontradas." });

        // Validar orden y obtener tipo de cliente (usar ID numérico)
        const firstRawId = rawOrderIds.length > 0 ? rawOrderIds[0] : parseInt(orderNumbers[0], 10);
        const clientResult = await pool.request()
            .input('OrderId', sql.Int, firstRawId)
            .query(`
                SELECT o.CliIdCliente, c.Tipo 
                FROM OrdenesDeposito o WITH(NOLOCK)
                JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                WHERE o.OrdIdOrden = @OrderId
            `);

        if (clientResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Orden o cliente no encontrado.' });
        }

        const clienteTipo = (clientResult.recordset[0].Tipo || '').trim();
        // Tipo C=Comun, E=Especial, S=Semanal
        let estadoOrdenRetiro = (clienteTipo === 'E' || clienteTipo === 'S') ? 4 : 1;

        // Crear la orden de retiro en una transacción
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // OReIdOrdenRetiro no es IDENTITY, generar manualmente
            const maxIdRes = await transaction.request().query('SELECT ISNULL(MAX(OReIdOrdenRetiro), 0) + 1 AS NextId FROM OrdenesRetiro');
            const OReIdOrdenRetiro = maxIdRes.recordset[0].NextId;

            await transaction.request()
                .input('OReId', sql.Int, OReIdOrdenRetiro)
                .input('CostoTotal', sql.Float, totalCost || 0)
                .input('LugarRetiro', sql.Int, lugarRetiro)
                .input('FechaAlta', sql.DateTime, new Date())
                .input('UsuarioAlta', sql.Int, UsuarioAlta)
                .input('Estado', sql.Int, estadoOrdenRetiro)
                .query(`
                    INSERT INTO OrdenesRetiro (OReIdOrdenRetiro, OReCostoTotalOrden, LReIdLugarRetiro, OReFechaAlta, OReUsuarioAlta, OReEstadoActual, OReFechaEstadoActual)
                    VALUES (@OReId, @CostoTotal, @LugarRetiro, @FechaAlta, @UsuarioAlta, @Estado, GETDATE());
                `);

            // Insertar histórico de estado
            await transaction.request()
                .input('OReId', sql.Int, OReIdOrdenRetiro)
                .input('Estado', sql.Int, estadoOrdenRetiro)
                .input('Fecha', sql.DateTime, new Date())
                .input('Usuario', sql.Int, UsuarioAlta)
                .query(`
                    INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                    VALUES (@OReId, @Estado, @Fecha, @Usuario);
                `);

            // Buscar IDs de las órdenes (usar rawOrderIds numéricos)
            const idsToLink = rawOrderIds.length > 0 ? rawOrderIds : orderNumbers.map(n => parseInt(n, 10)).filter(id => !isNaN(id));
            const orderIdParams = idsToLink.map((n, i) => `@oid${i}`).join(',');
            const orderIdReq = transaction.request();
            idsToLink.forEach((n, i) => orderIdReq.input(`oid${i}`, sql.Int, n));
            const orderIdResults = await orderIdReq.query(`
                SELECT OrdIdOrden FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdIdOrden IN (${orderIdParams})
            `);

            // Insertar relaciones (RORIdOrdenRetiroOrden no es IDENTITY)
            if (orderIdResults.recordset.length > 0) {
                const maxRelRes = await transaction.request().query('SELECT ISNULL(MAX(RORIdOrdenRetiroOrden), 0) AS maxId FROM RelOrdenesRetiroOrdenes');
                let nextRelId = maxRelRes.recordset[0].maxId + 1;
                const relValues = orderIdResults.recordset.map(r => `(${nextRelId++}, ${OReIdOrdenRetiro}, ${r.OrdIdOrden})`).join(',');
                await transaction.request().query(`INSERT INTO RelOrdenesRetiroOrdenes (RORIdOrdenRetiroOrden, OReIdOrdenRetiro, OrdIdOrden) VALUES ${relValues}`);

                // Actualizar estado de las órdenes
                const ordIds = orderIdResults.recordset.map(r => r.OrdIdOrden).join(',');
                await transaction.request()
                    .input('LugarRetiro', sql.Int, lugarRetiro)
                    .input('OReId', sql.Int, OReIdOrdenRetiro)
                    .query(`
                        UPDATE OrdenesDeposito SET LReIdLugarRetiro = @LugarRetiro, OReIdOrdenRetiro = @OReId, OrdEstadoActual = 4, OrdFechaEstadoActual = GETDATE()
                        WHERE OrdIdOrden IN (${ordIds});

                        INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                        SELECT OrdIdOrden, 4, GETDATE(), ${UsuarioAlta} FROM OrdenesDeposito WHERE OrdIdOrden IN (${ordIds});
                    `);
            }

            await transaction.commit();

            const ordIdRetiro = `R-${OReIdOrdenRetiro}`;

            // Insertar en RetirosWeb (replica local)
            try {
                let targetCurrency = moneda || "UYU";
                if (!moneda && orders && orders.length > 0) {
                    const firstCost = orders[0].costWithCurrency || '';
                    if (firstCost.includes('USD') || firstCost.includes('U$S')) targetCurrency = 'USD';
                }

                await pool.request()
                    .input('Ord', sql.NVarChar, ordIdRetiro)
                    .input('Monto', sql.Decimal(18, 2), totalCost || 0)
                    .input('Moneda', sql.NVarChar, targetCurrency)
                    .input('Ref', sql.NVarChar, null)
                    .input('Est', sql.Int, 1)
                    .input('CodCliente', sql.VarChar, String(codCliente))
                    .input('BultosJSON', sql.NVarChar, JSON.stringify(orders || []))
                    .query(`INSERT INTO RetirosWeb (OrdIdRetiro, Monto, Moneda, ReferenciaPago, Estado, CodCliente, BultosJSON) VALUES (@Ord, @Monto, @Moneda, @Ref, @Est, @CodCliente, @BultosJSON)`);
            } catch (dbErr) {
                console.error("Advertencia: No se pudo replicar en RetirosWeb:", dbErr.message);
            }

            // Emitir socket
            const io = req.app.get('socketio');
            if (io) io.emit('actualizado', { type: 'actualizacion' });

            res.json({ success: true, data: { OReIdOrdenRetiro }, ordIdGenerada: ordIdRetiro });

        } catch (txErr) {
            try { await transaction.rollback(); } catch (e) { }
            throw txErr;
        }

    } catch (error) {
        console.error("Error creating pickup order:", error);
        res.status(500).json({ error: "Error al generar la orden de retiro. Detalle: " + error.message });
    }
};

// --- NUEVO: GENERAR COMPROBANTE PDF ---
exports.generatePickupReceipt = async (req, res) => {
    try {
        const { receiptId, orders, clientName, total } = req.body;

        const doc = await PDFDocument.create();
        const page = doc.addPage([595.28, 841.89]); // A4
        const { width, height } = page.getSize();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        const drawCenteredText = (text, y, size, fontToUse) => {
            const textWidth = fontToUse.widthOfTextAtSize(text, size);
            page.drawText(text, { x: (width - textWidth) / 2, y, size, font: fontToUse });
        };

        let y = height - 50;

        drawCenteredText('COMPROBANTE DE RETIRO', y, 18, fontBold);
        y -= 30;

        page.drawText(`Nro Retiro: #${receiptId}`, { x: 50, y, size: 12, font: fontBold });
        y -= 20;
        page.drawText(`Fecha: ${new Date().toLocaleDateString()}`, { x: 50, y, size: 12, font });
        y -= 20;
        page.drawText(`Cliente: ${clientName || 'Consumidor Final'}`, { x: 50, y, size: 12, font });
        y -= 40;

        page.drawText('DETALLE DE ÓRDENES:', { x: 50, y, size: 12, font: fontBold });
        y -= 25;

        // Table Header
        page.drawText('Orden', { x: 50, y, size: 10, font: fontBold });
        page.drawText('Descripción', { x: 150, y, size: 10, font: fontBold });
        page.drawText('Monto', { x: 450, y, size: 10, font: fontBold });
        y -= 5;
        page.drawLine({ start: { x: 50, y }, end: { x: 550, y }, thickness: 1, color: rgb(0, 0, 0) });
        y -= 20;

        if (Array.isArray(orders)) {
            orders.forEach(order => {
                const desc = (order.desc || '').substring(0, 45);
                page.drawText(order.id || '', { x: 50, y, size: 10, font });
                page.drawText(desc, { x: 150, y, size: 10, font });
                page.drawText(`$${order.amount}`, { x: 450, y, size: 10, font });
                y -= 20;
            });
        }

        y -= 10;
        page.drawLine({ start: { x: 50, y }, end: { x: 550, y }, thickness: 2, color: rgb(0, 0, 0) });
        y -= 25;

        page.drawText(`TOTAL:    $${total}`, { x: 350, y, size: 14, font: fontBold });

        // Footer
        drawCenteredText('Gracias por su preferencia', 50, 10, font);

        const pdfBytes = await doc.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=retiro-${receiptId}.pdf`);
        res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error("PDF Generate Error:", error);
        res.status(500).json({ error: "Error generando PDF" });
    }
};

// --- HANDY PAYMENT ---
exports.createHandyPaymentLink = async (req, res) => {
    try {
        const { orders, totalAmount, activeCurrency, ordenRetiro, orderNumbers: reactOrderNumbers } = req.body;

        if (!orders || orders.length === 0) {
            return res.status(400).json({ error: "No orders provided for payment." });
        }

        const currencyCode = activeCurrency === 'USD' ? 840 : 858;

        // Construir productos para Handy
        const products = orders.map(o => {
            const amt = Number(Number(o.amount || 0).toFixed(2));
            return {
                Name: o.desc ? o.desc.substring(0, 50) : o.id,
                Quantity: 1,
                Amount: amt,
                TaxedAmount: Number((amt / 1.22).toFixed(2))
            };
        });

        const { createPaymentLink } = require('../services/handyService');
        const result = await createPaymentLink({
            products,
            totalAmount,
            currencyCode,
            commerceName: 'USER',
            ordersData: {
                orders: orders.map(o => ({ id: o.id, rawId: o.rawId, desc: o.desc, amount: o.amount })),
                ordenRetiro: ordenRetiro || null,
                reactOrderNumbers: reactOrderNumbers || []
            },
            codCliente: req.user?.codCliente || 0,
            logPrefix: '[HANDY]'
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({ success: true, url: result.url, transactionId: result.transactionId });

    } catch (error) {
        console.error("[HANDY ERROR] Fallo al crear link de pago:", error.message);
        if (error.response) {
            console.error("[HANDY DATA]", error.response.data);
            return res.status(500).json({ error: "Error desde Handy", details: error.response.data });
        }
        res.status(500).json({ error: "Error interno al intentar generar pago." });
    }
};

// --- HANDY WEBHOOK ---
// Recibe notificaciones automáticas de Handy cuando un cobro cambia de estado
// Docs V2.0: PurchaseData.Status → 0=Iniciado, 1=Exitoso, 2=Fallido, 3=Pendiente
exports.handyWebhook = async (req, res) => {
    const payload = req.body;

    console.log("------------------------------------------");
    console.log("🔔 [HANDY WEBHOOK] Evento recibido:");
    console.log(JSON.stringify(payload, null, 2));
    console.log("------------------------------------------");

    // Responder 200 inmediatamente (best practice para webhooks)
    res.status(200).send("OK");

    try {
        const transactionId = payload.TransactionExternalId;
        const status = payload.PurchaseData?.Status;
        const totalAmount = payload.PurchaseData?.TotalAmount;
        const currency = payload.PurchaseData?.Currency;
        const issuerName = payload.InstrumentData?.IssuerName || 'N/A';

        if (!transactionId) {
            console.warn("[HANDY WEBHOOK] Evento sin TransactionExternalId, ignorado.");
            return;
        }

        console.log(`[HANDY WEBHOOK] TxID: ${transactionId}, Status: ${status}, Monto: ${totalAmount}, Moneda: ${currency}, Medio: ${issuerName}`);

        const pool = await getPool();

        const statusMap = { 0: 'Iniciado', 1: 'Pagado', 2: 'Fallido', 3: 'Pendiente' };
        const statusLabel = statusMap[status] || `Desconocido(${status})`;

        const result = await pool.request()
            .input('txId', sql.VarChar(100), transactionId)
            .input('status', sql.VarChar(20), statusLabel)
            .input('issuer', sql.VarChar(100), issuerName)
            .query(`
                UPDATE HandyTransactions
                SET Status = @status,
                    IssuerName = @issuer,
                    PaidAt = CASE WHEN @status = 'Pagado' THEN GETDATE() ELSE PaidAt END,
                    WebhookReceivedAt = GETDATE()
                WHERE TransactionId = @txId
            `);

        const emoji = { 0: '🔄', 1: '✅', 2: '❌', 3: '⏳' };
        console.log(`[HANDY WEBHOOK] ${emoji[status] || '❓'} ${statusLabel} — ${result.rowsAffected[0]} fila(s) actualizadas.`);

        // --- NOTIFICAR A API REACT CUANDO EL PAGO ES EXITOSO ---
        if (status === 1) {
            try {
                // Obtener datos de la transacción para saber qué órdenes se pagaron
                const txData = await pool.request()
                    .input('txId2', sql.VarChar(100), transactionId)
                    .query('SELECT OrdersJson, CodCliente, TotalAmount, Currency FROM HandyTransactions WHERE TransactionId = @txId2');

                if (txData.recordset.length > 0) {
                    const tx = txData.recordset[0];
                    const storedData = JSON.parse(tx.OrdersJson || '{}');

                    // Extraer datos: formato nuevo (con ordenRetiro) o legacy (array plano)
                    const storedOrdenRetiro = storedData.ordenRetiro;
                    const orders = storedData.orders || (Array.isArray(storedData) ? storedData : []);

                    // Moneda: 858 = UYU (monedaId 1), 840 = USD (monedaId 2)
                    const monedaId = tx.Currency === 840 ? 2 : 1;

                    // orderNumbers: si hay retiro → número del retiro, si no → IDs de órdenes
                    let orderNumbers = [];
                    if (storedOrdenRetiro) {
                        const retiroNum = Number(String(storedOrdenRetiro).replace(/\D/g, ''));
                        if (retiroNum) orderNumbers = [retiroNum];
                    } else {
                        orderNumbers = orders.map(o => o.rawId || o.id).filter(Boolean);
                    }

                    const payloadPago = {
                        metodoPagoId: 9,
                        monedaId: monedaId,
                        monto: tx.TotalAmount,
                        ordenRetiro: storedOrdenRetiro ? String(storedOrdenRetiro) : (orders[0]?.id || transactionId),
                        orderNumbers: orderNumbers
                    };

                    console.log('[HANDY WEBHOOK] Registrando pago directamente en DB...', JSON.stringify(payloadPago));

                    // --- MIGRACIÓN: Escribir directamente en DB en vez de llamar a API React ---
                    const ordenRetiroId = parseInt(String(payloadPago.ordenRetiro).replace(/^R-0*/, ''), 10);
                    if (!isNaN(ordenRetiroId)) {
                        // Determinar nuevo estado de la orden de retiro
                        const retiroState = await pool.request()
                            .input('RID', sql.Int, ordenRetiroId)
                            .query('SELECT OReEstadoActual FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @RID');

                        const estadoActual = retiroState.recordset[0]?.OReEstadoActual || 1;
                        const nuevoEstado = estadoActual === 1 ? 3 : 8; // 1→3 (Ingresado→Abonado), otro→8 (Abonado de antemano)
                        const usuarioId = 70; // PRODUCCION user

                        // 1. INSERT Pago
                        const pagoResult = await pool.request()
                            .input('MetodoPago', sql.Int, payloadPago.metodoPagoId)
                            .input('Moneda', sql.Int, payloadPago.monedaId)
                            .input('Monto', sql.Float, payloadPago.monto)
                            .input('Usr', sql.Int, usuarioId)
                            .query(`
                                INSERT INTO Pagos (MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago, PagUsuarioAlta)
                                OUTPUT INSERTED.PagIdPago
                                VALUES (@MetodoPago, @Moneda, @Monto, GETDATE(), @Usr)
                            `);
                        const pagoId = pagoResult.recordset[0].PagIdPago;

                        // 2. UPDATE OrdenesRetiro
                        await pool.request()
                            .input('RID', sql.Int, ordenRetiroId)
                            .input('Estado', sql.Int, nuevoEstado)
                            .input('PagoId', sql.Int, pagoId)
                            .query(`
                                UPDATE OrdenesRetiro SET PagIdPago = @PagoId, OReEstadoActual = @Estado, OReFechaEstadoActual = GETDATE(), ORePasarPorCaja = 0
                                WHERE OReIdOrdenRetiro = @RID
                            `);

                        // 3. INSERT Historico Retiro
                        await pool.request()
                            .input('RID', sql.Int, ordenRetiroId)
                            .input('Estado', sql.Int, nuevoEstado)
                            .input('Usr', sql.Int, usuarioId)
                            .query(`INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@RID, @Estado, GETDATE(), @Usr)`);

                        // 4. UPDATE Ordenes + Historico
                        if (payloadPago.orderNumbers && payloadPago.orderNumbers.length > 0) {
                            const safeIds = payloadPago.orderNumbers.filter(n => Number.isInteger(n) && n > 0);
                            if (safeIds.length > 0) {
                                await pool.request()
                                    .input('PagoId', sql.Int, pagoId)
                                    .query(`UPDATE OrdenesDeposito SET PagIdPago = @PagoId, OrdEstadoActual = 7, OrdFechaEstadoActual = GETDATE() WHERE OrdIdOrden IN (${safeIds.join(',')})`);

                                const histValues = safeIds.map(id => `(${id}, 7, GETDATE(), ${usuarioId})`).join(', ');
                                await pool.request().query(`INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES ${histValues}`);
                            }
                        }

                        console.log(`[HANDY WEBHOOK] ✅ Pago registrado en DB: PagoId=${pagoId}, OrdenRetiro=${ordenRetiroId}`);
                    } else {
                        console.warn('[HANDY WEBHOOK] No se pudo parsear ordenRetiroId:', payloadPago.ordenRetiro);
                    }

                } else {
                    console.warn(`[HANDY WEBHOOK] No se encontró transacción ${transactionId} en HandyTransactions`);
                }
            } catch (reactErr) {
                console.error('[HANDY WEBHOOK] Error notificando a API React:', reactErr.response?.data || reactErr.message);
            }
        }

    } catch (e) {
        console.error("[HANDY WEBHOOK] Error procesando evento:", e.message);
    }
};

// --- PAYMENT STATUS ---
// Consultar el estado de un pago por TransactionId (para la página de resultado)
exports.getPaymentStatus = async (req, res) => {
    try {
        const { transactionId } = req.params;
        if (!transactionId) return res.status(400).json({ error: 'TransactionId requerido' });

        const pool = await getPool();
        const result = await pool.request()
            .input('txId', sql.VarChar(100), transactionId)
            .query('SELECT TransactionId, TotalAmount, Currency, OrdersJson, Status, IssuerName, CreatedAt, PaidAt FROM HandyTransactions WHERE TransactionId = @txId');

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }

        const tx = result.recordset[0];
        const storedData = JSON.parse(tx.OrdersJson || '{}');
        const orders = storedData.orders || (Array.isArray(storedData) ? storedData : []);

        res.json({
            transactionId: tx.TransactionId,
            status: tx.Status,
            totalAmount: tx.TotalAmount,
            currency: tx.Currency === 840 ? 'USD' : 'UYU',
            currencySymbol: tx.Currency === 840 ? 'US$' : '$',
            ordenRetiro: storedData.ordenRetiro || null,
            orders: orders.map(o => ({
                id: o.id,
                desc: o.desc,
                amount: o.amount
            })),
            paymentMethod: tx.IssuerName || null,
            createdAt: tx.CreatedAt,
            paidAt: tx.PaidAt
        });
    } catch (e) {
        console.error('[PAYMENT STATUS] Error:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// --- HANDY REFUND ---
// Solicita una devolución a Handy usando DELETE con el TransactionExternalId original
// Restricciones: Solo tarjetas, 1 devolución por transacción, max $10,000 UYU / $250 USD
exports.createHandyRefund = async (req, res) => {
    try {
        const { transactionId } = req.body;

        if (!transactionId) {
            return res.status(400).json({ error: "Se requiere el transactionId de la transacción original." });
        }

        const pool = await getPool();

        // Verificar que la transacción existe y está pagada
        const txResult = await pool.request()
            .input('txId', sql.VarChar(100), transactionId)
            .query(`SELECT * FROM HandyTransactions WHERE TransactionId = @txId`);

        if (txResult.recordset.length === 0) {
            return res.status(404).json({ error: "Transacción no encontrada." });
        }

        const tx = txResult.recordset[0];
        if (tx.Status !== 'Pagado') {
            return res.status(400).json({ error: `No se puede devolver una transacción con estado "${tx.Status}". Solo se pueden devolver transacciones pagadas.` });
        }

        if (tx.RefundStatus === 'Devuelto') {
            return res.status(400).json({ error: "Esta transacción ya fue devuelta anteriormente." });
        }

        // URLs dinámicas según entorno
        const isProduction = process.env.HANDY_ENVIRONMENT === 'production';
        const handySecret = process.env.HANDY_MERCHANT_SECRET;
        const handyUrl = isProduction
            ? 'https://api.payments.handy.uy/api/v2/payments'
            : 'https://api.payments.arriba.uy/api/v2/payments';
        const siteUrl = process.env.SITE_URL || 'https://user.com.uy';
        const callbackUrl = `${siteUrl}/api/web-orders/handy-refund-webhook`;

        const refundPayload = {
            TransactionExternalId: transactionId,
            CallbackUrl: callbackUrl
        };

        console.log(`[HANDY REFUND] Solicitando devolución (${isProduction ? 'PRODUCCIÓN' : 'TESTING'})...`);
        console.log("[HANDY REFUND] Payload:", JSON.stringify(refundPayload));

        const response = await axios.delete(handyUrl, {
            headers: {
                'merchant-secret-key': handySecret,
                'Content-Type': 'application/json'
            },
            data: refundPayload
        });

        console.log("[HANDY REFUND] Respuesta:", JSON.stringify(response.data));

        // Marcar en BD como devolución solicitada
        await pool.request()
            .input('txId', sql.VarChar(100), transactionId)
            .query(`
                UPDATE HandyTransactions
                SET RefundStatus = 'Solicitado', RefundRequestedAt = GETDATE()
                WHERE TransactionId = @txId
            `);

        res.json({ success: true, message: "Devolución solicitada. Recibirás la confirmación por webhook.", data: response.data });

    } catch (error) {
        console.error("[HANDY REFUND ERROR]", error.message);
        if (error.response) {
            console.error("[HANDY REFUND DATA]", error.response.data);
            return res.status(500).json({ error: "Error desde Handy al solicitar devolución", details: error.response.data });
        }
        res.status(500).json({ error: "Error interno al solicitar devolución." });
    }
};

// --- HANDY REFUND WEBHOOK ---
// Recibe notificaciones de Handy sobre el resultado de una devolución
// Status 4 = Devolución exitosa, Status 5 = Devolución fallida
exports.handyRefundWebhook = async (req, res) => {
    const payload = req.body;

    console.log("------------------------------------------");
    console.log("🔔 [HANDY REFUND WEBHOOK] Evento recibido:");
    console.log(JSON.stringify(payload, null, 2));
    console.log("------------------------------------------");

    // Responder 200 inmediatamente
    res.status(200).send("OK");

    try {
        const transactionId = payload.TransactionExternalId;

        if (!transactionId) {
            console.warn("[HANDY REFUND WEBHOOK] Evento sin TransactionExternalId, ignorado.");
            return;
        }

        // Handy envía { Success: true/false, Message: "...", TransactionExternalId: "..." }
        // O podría enviar PurchaseData.Status (4=devuelto, 5=fallido) según documentación
        let statusLabel;
        if (payload.Success === true) {
            statusLabel = 'Devuelto';
        } else if (payload.Success === false) {
            statusLabel = 'DevolucionFallida';
        } else {
            const status = payload.PurchaseData?.Status;
            const refundStatusMap = { 4: 'Devuelto', 5: 'Fallida' };
            statusLabel = refundStatusMap[status] || 'Desconocido';
        }

        const pool = await getPool();

        const result = await pool.request()
            .input('txId', sql.VarChar(100), transactionId)
            .input('refundStatus', sql.VarChar(20), statusLabel)
            .query(`
                UPDATE HandyTransactions
                SET RefundStatus = @refundStatus,
                    RefundCompletedAt = CASE WHEN @refundStatus = 'Devuelto' THEN GETDATE() ELSE RefundCompletedAt END
                WHERE TransactionId = @txId
            `);

        const emoji = statusLabel === 'Devuelto' ? '✅' : '❌';
        console.log(`[HANDY REFUND WEBHOOK] ${emoji} ${statusLabel} — ${result.rowsAffected[0]} fila(s) actualizadas.`);

    } catch (e) {
        console.error("[HANDY REFUND WEBHOOK] Error procesando evento:", e.message);
    }
};

// --- SHIPPING DATA (para página de confirmación de retiro) ---
exports.getShippingData = async (req, res) => {
    try {
        const user = req.user;
        const codCliente = user ? user.codCliente : null;
        if (!codCliente) return res.status(401).json({ error: "Usuario no identificado." });

        const pool = await getPool();

        // 1. Datos del cliente (dirección default, forma envío, agencia)
        const clientRes = await pool.request()
            .input('cod', sql.Int, codCliente)
            .query(`
                SELECT CliIdCliente, CliDireccion, FormaEnvioID, AgenciaID, Nombre
                FROM Clientes WHERE CodCliente = @cod
            `);

        if (!clientRes.recordset.length) return res.status(404).json({ error: "Cliente no encontrado" });
        const cliente = clientRes.recordset[0];

        // 2. Formas de envío
        const formasRes = await pool.request().query('SELECT ID, Nombre FROM FormasEnvio WHERE ID IN (1, 2) ORDER BY ID');

        // 3. Agencias
        const agenciasRes = await pool.request().query('SELECT ID, Nombre FROM Agencias ORDER BY Nombre');

        // 4. Direcciones guardadas del cliente (max 3)
        const direccionesRes = await pool.request()
            .input('cliId', sql.Int, cliente.CliIdCliente)
            .query('SELECT ID, Alias, Direccion, AgenciaID, Ciudad, Localidad FROM DireccionesEnvioCliente WHERE CliIdCliente = @cliId ORDER BY FechaCreacion');

        // 5. Departamentos y Localidades
        const deptosRes = await pool.request().query('SELECT ID, Nombre FROM Departamentos ORDER BY Nombre');
        const localidadesRes = await pool.request().query('SELECT ID, DepartamentoID, Nombre FROM Localidades ORDER BY Nombre');

        res.json({
            success: true,
            data: {
                formasEnvio: formasRes.recordset,
                agencias: agenciasRes.recordset,
                defaultFormaEnvioID: cliente.FormaEnvioID,
                defaultAgenciaID: cliente.AgenciaID,
                defaultDireccion: (cliente.CliDireccion || '').trim(),
                direccionesGuardadas: direccionesRes.recordset,
                departamentos: deptosRes.recordset,
                localidades: localidadesRes.recordset
            }
        });
    } catch (err) {
        console.error("Error en getShippingData:", err.message);
        res.status(500).json({ error: "Error al obtener datos de envío." });
    }
};

// --- GUARDAR DIRECCIÓN ---
exports.saveAddress = async (req, res) => {
    try {
        const user = req.user;
        const codCliente = user ? user.codCliente : null;
        if (!codCliente) return res.status(401).json({ error: "Usuario no identificado." });

        const { alias, direccion, agenciaID, ciudad, localidad } = req.body;
        if (!direccion || !direccion.trim()) return res.status(400).json({ error: "La dirección es obligatoria." });

        const pool = await getPool();

        // Obtener CliIdCliente
        const clientRes = await pool.request()
            .input('cod', sql.Int, codCliente)
            .query('SELECT CliIdCliente FROM Clientes WHERE CodCliente = @cod');
        if (!clientRes.recordset.length) return res.status(404).json({ error: "Cliente no encontrado" });
        const cliId = clientRes.recordset[0].CliIdCliente;

        // Verificar que no tenga más de 3
        const countRes = await pool.request()
            .input('cliId', sql.Int, cliId)
            .query('SELECT COUNT(*) AS total FROM DireccionesEnvioCliente WHERE CliIdCliente = @cliId');

        if (countRes.recordset[0].total >= 3) {
            return res.status(400).json({ error: "Ya tienes el máximo de 3 direcciones guardadas." });
        }

        // Insertar
        const insertRes = await pool.request()
            .input('cliId', sql.Int, cliId)
            .input('alias', sql.NVarChar(50), (alias || '').trim().substring(0, 50))
            .input('direccion', sql.NVarChar(200), direccion.trim().substring(0, 200))
            .input('agenciaID', sql.Int, agenciaID || null)
            .input('ciudad', sql.NVarChar(100), (ciudad || '').trim().substring(0, 100))
            .input('localidad', sql.NVarChar(100), (localidad || '').trim().substring(0, 100))
            .query(`
                INSERT INTO DireccionesEnvioCliente (CliIdCliente, Alias, Direccion, AgenciaID, Ciudad, Localidad)
                OUTPUT INSERTED.ID, INSERTED.Alias, INSERTED.Direccion, INSERTED.AgenciaID, INSERTED.Ciudad, INSERTED.Localidad
                VALUES (@cliId, @alias, @direccion, @agenciaID, @ciudad, @localidad)
            `);

        res.json({ success: true, data: insertRes.recordset[0] });
    } catch (err) {
        console.error("Error en saveAddress:", err.message);
        res.status(500).json({ error: "Error al guardar dirección." });
    }
};

// --- ELIMINAR DIRECCIÓN ---
exports.deleteAddress = async (req, res) => {
    try {
        const user = req.user;
        const codCliente = user ? user.codCliente : null;
        if (!codCliente) return res.status(401).json({ error: "Usuario no identificado." });

        const addressId = parseInt(req.params.id, 10);
        if (!addressId) return res.status(400).json({ error: "ID de dirección inválido." });

        const pool = await getPool();

        // Obtener CliIdCliente
        const clientRes = await pool.request()
            .input('cod', sql.Int, codCliente)
            .query('SELECT CliIdCliente FROM Clientes WHERE CodCliente = @cod');
        if (!clientRes.recordset.length) return res.status(404).json({ error: "Cliente no encontrado" });
        const cliId = clientRes.recordset[0].CliIdCliente;

        // Eliminar (solo si pertenece al cliente)
        const delRes = await pool.request()
            .input('id', sql.Int, addressId)
            .input('cliId', sql.Int, cliId)
            .query('DELETE FROM DireccionesEnvioCliente WHERE ID = @id AND CliIdCliente = @cliId');

        if (delRes.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Dirección no encontrada." });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Error en deleteAddress:", err.message);
        res.status(500).json({ error: "Error al eliminar dirección." });
    }
};
