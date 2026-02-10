const { sql, getPool } = require('../config/db');
const driveService = require('../services/driveService');
const fileProcessingService = require('../services/fileProcessingService');

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
    console.log("📥 [WebOrder] Iniciando proceso de creación...");
    // --- LOG RESTRINGIDO PARA DEBUG (Evitar dump de Base64 gigante) ---
    const getSafeDebugBody = (data) => {
        if (!data) return data;
        const clone = { ...data };

        if (clone.items) {
            clone.items = clone.items.map(item => ({
                ...item,
                file: item.file ? { ...item.file, data: item.file.data ? `${item.file.data.substring(0, 30)}... (len: ${item.file.data.length})` : null } : null,
                fileBack: item.fileBack ? { ...item.fileBack, data: item.fileBack.data ? `${item.fileBack.data.substring(0, 30)}... (len: ${item.fileBack.data.length})` : null } : null
            }));
        }

        if (clone.lineas) {
            clone.lineas = clone.lineas.map(linea => ({
                ...linea,
                sublineas: linea.sublineas ? linea.sublineas.map(sl => ({
                    ...sl,
                    archivoPrincipal: sl.archivoPrincipal ? { ...sl.archivoPrincipal, data: sl.archivoPrincipal.data ? `${sl.archivoPrincipal.data.substring(0, 30)}... (len: ${sl.archivoPrincipal.data.length})` : null } : null,
                    archivoDorso: sl.archivoDorso ? { ...sl.archivoDorso, data: sl.archivoDorso.data ? `${sl.archivoDorso.data.substring(0, 30)}... (len: ${sl.archivoDorso.data.length})` : null } : null
                })) : []
            }));
        }

        if (clone.archivosReferencia) {
            clone.archivosReferencia = clone.archivosReferencia.map(rf => ({
                ...rf,
                archivo: rf.archivo ? { ...rf.archivo, data: rf.archivo.data ? `${rf.archivo.data.substring(0, 30)}... (len: ${rf.archivo.data.length})` : null } : null
            }));
        }

        if (clone.serviciosExtras) {
            clone.serviciosExtras = { ...clone.serviciosExtras };
            Object.keys(clone.serviciosExtras).forEach(key => {
                const srv = clone.serviciosExtras[key];
                if (srv?.archivo?.data) srv.archivo.data = `${srv.archivo.data.substring(0, 30)}... (len: ${srv.archivo.data.length})`;
                if (srv?.file?.data) srv.file.data = `${srv.file.data.substring(0, 30)}... (len: ${srv.file.data.length})`;
            });
        }

        return clone;
    };

    console.log("📦 Payload recibido (resumen):", JSON.stringify(getSafeDebugBody(req.body), null, 2));

    // Soporte para Payroads en Español (Renombrado técnico solicitado por usuario)
    const {
        idServicio,
        nombreTrabajo,
        prioridad,
        notasGenerales,
        configuracion,
        especificacionesCorte,
        lineas,
        archivosReferencia,
        archivosTecnicos,
        serviciosExtras
    } = req.body;

    // Mapeo inverso para mantener compatibilidad con lógica interna si es necesario
    const serviceId = idServicio || req.body.serviceId;
    const jobName = nombreTrabajo || req.body.jobName;
    const urgency = prioridad || req.body.urgency || 'Normal';
    const generalNote = notasGenerales || req.body.generalNote;
    const items = lineas || req.body.items || [];
    const selectedComplementary = serviciosExtras || req.body.selectedComplementary || {};
    const referenceFiles = (archivosReferencia || req.body.referenceFiles || []).map(f => ({
        name: f.nombre || f.name,
        type: f.tipo || f.type,
        fileData: f.archivo || f.fileData
    }));
    const specializedFiles = (archivosTecnicos || req.body.specializedFiles || []).map(f => ({
        name: f.nombre || f.name,
        type: f.tipo || f.type,
        fileData: f.archivo || f.fileData
    }));
    const cuttingSpecs = especificacionesCorte || req.body.cuttingSpecs;

    const user = req.user || {};
    const codCliente = user.codCliente || null;
    const nombreCliente = user.name || user.username || 'Cliente Web';

    if (!items || items.length === 0) {
        return res.status(400).json({ error: "El pedido no contiene ítems." });
    }

    const pool = await getPool();

    try {
        // --- 1. RESERVAR NRO PEDIDO (ESTILO ERP) ---
        const reserveRes = await pool.request().query(`
            UPDATE ConfiguracionGlobal 
            SET Valor = CAST(ISNULL(CAST(Valor AS INT), 0) + 1 AS VARCHAR) 
            OUTPUT INSERTED.Valor 
            WHERE Clave = 'ULTIMOPEDIDOWEB'
        `);
        if (!reserveRes.recordset.length) throw new Error("No se pudo obtener el próximo número de pedido.");
        const nuevoNroPedido = parseInt(reserveRes.recordset[0].Valor);
        const erpDocNumber = `${nuevoNroPedido}`; // Sin prefijo 'W'

        // --- 2. OBTENER DATOS DEL CLIENTE ---
        let idClienteReact = null;
        if (codCliente) {
            const clientRes = await pool.request()
                .input('cod', sql.Int, codCliente)
                .query("SELECT IDReact FROM Clientes WHERE CodCliente = @cod");
            if (clientRes.recordset.length > 0) {
                idClienteReact = clientRes.recordset[0].IDReact;
            }
        }

        // --- 3. OBTENER CONFIGURACIONES DE FLUJO (Rutas y Mapeos) ---
        const mappingRes = await pool.request().query("SELECT AreaID_Interno, Numero FROM ConfigMapeoERP");
        const mapaAreasNumero = {}; // AreaID -> Numero (Priority/Order)
        mappingRes.recordset.forEach(r => mapaAreasNumero[r.AreaID_Interno.trim().toUpperCase()] = r.Numero || 999);

        const rutasRes = await pool.request().query("SELECT AreaOrigen, AreaDestino, Prioridad FROM ConfiguracionRutas");
        const rutasConfig = rutasRes.recordset; // List of {AreaOrigen, AreaDestino, Prioridad}

        // --- 3. IDENTIFICAR ÁREAS ACTIVAS ---
        const mainAreaID = (SERVICE_TO_AREA_MAP[serviceId] || 'GENE').toUpperCase();
        const activeExtraAreas = new Set();

        const EXTRA_ID_TO_AREA = {
            'EST': 'EST',
            'ESTAMPADO': 'EST',
            'COSTURA': 'TWT',
            'CORTE': 'TWC',
            'TWC': 'TWC',
            'TWT': 'TWT',
            'LASER': 'TWC',
            'BORDADO': 'EMB',
            'EMB': 'EMB'
        };

        if (selectedComplementary) {
            Object.entries(selectedComplementary).forEach(([id, val]) => {
                const activo = val.activo || val.active;
                if (activo) {
                    const mappedArea = EXTRA_ID_TO_AREA[id.toUpperCase()];
                    if (mappedArea) activeExtraAreas.add(mappedArea);
                }
            });
        }

        const allActiveAreas = new Set([mainAreaID, ...activeExtraAreas]);

        // --- 4. PREPARAR NOTA ENRIQUECIDA (Metadata de Procesos) ---
        let finalNote = generalNote || '';
        const specs = [];

        // Especificaciones de Corte
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

        // Especificaciones de Bordado
        if (req.body.especificacionesBordado) {
            const b = req.body.especificacionesBordado;
            if (b.cantidadPrendas) {
                specs.push(`BORDADO - CANTIDAD TOTAL DE PRENDAS: ${b.cantidadPrendas}`);
            }
        }

        // Especificaciones de Estampado (Servicio Extra)
        const estService = (serviciosExtras || req.body.selectedComplementary)?.EST || (serviciosExtras || req.body.selectedComplementary)?.estampado || (serviciosExtras || req.body.selectedComplementary)?.ESTAMPADO;
        if (estService && (estService.activo || estService.active)) {
            const c = estService.campos || estService.fields;
            if (c) {
                if (c.cantidadPrendas) specs.push(`ESTAMPADO - CANTIDAD PRENDAS: ${c.cantidadPrendas}`);
                if (c.cantidadEstampados) specs.push(`ESTAMPADO - ESTAMPADOS POR PRENDA: ${c.cantidadEstampados}`);
                if (c.origenPrendas) specs.push(`ESTAMPADO - ORIGEN PRENDAS: ${c.origenPrendas}`);
            }
        }

        if (specs.length > 0) {
            finalNote = specs.join('\r\n') + '\r\n---------------------------------\r\n' + (generalNote || 'Sin observaciones adicionales');
        } else {
            finalNote = generalNote ? `OBSERVACIONES : ${generalNote}` : '';
        }

        // --- 5. PROCESAR LINEAS Y SUBLINEAS (Jerarquía de Grabación) ---
        const pendingOrderExecutions = []; // Objetos que describen cada Orden a crear

        // Procesar las "Lineas" recibidas (YA AGRUPADAS POR EL FRONTEND EN ESPAÑOL)
        if (lineas && lineas.length > 0) {
            lineas.forEach(linea => {
                const cabecera = linea.cabecera || {};
                const sublineas = linea.sublineas || [];

                pendingOrderExecutions.push({
                    areaID: mainAreaID,
                    material: cabecera.material,
                    variante: cabecera.variante,
                    codArticulo: cabecera.codArticulo,
                    codStock: cabecera.codStock,
                    items: sublineas.map(sl => ({
                        file: sl.archivoPrincipal,
                        fileBack: sl.archivoDorso,
                        copies: sl.cantidad,
                        note: sl.nota,
                        width: sl.width,
                        height: sl.height,
                        widthBack: sl.widthBack,
                        heightBack: sl.heightBack
                    })),
                    isExtra: false
                });
            });
        } else {
            // Lógica de compatibilidad si viene el formato anterior (items plano)
            const groupsByMat = {};
            for (const item of items) {
                const matObj = item.material || (configuracion?.materialBase) || { name: 'Estándar' };
                const matWeb = matObj.name || matObj; // Soportar string o objeto
                const varWeb = (configuracion?.varianteBase) || req.body.subtype || 'Estándar';

                const key = `${matWeb}|${varWeb}`.toUpperCase();
                if (!groupsByMat[key]) {
                    groupsByMat[key] = {
                        areaID: mainAreaID,
                        material: matWeb,
                        variante: varWeb,
                        codArticulo: matObj.codArt,
                        codStock: matObj.codStock,
                        items: [],
                        isExtra: false
                    };
                }
                groupsByMat[key].items.push(item);
            }
            Object.values(groupsByMat).forEach(g => pendingOrderExecutions.push(g));
        }

        // Agregar las órdenes para las Áreas Extras (si existen)
        if (selectedComplementary) {
            Object.entries(selectedComplementary).forEach(([extraId, val]) => {
                const activo = val.activo || val.active;
                if (!activo) return;
                const extraArea = EXTRA_ID_TO_AREA[extraId.toUpperCase()] || extraId.toUpperCase();

                const cabecera = val.cabecera || val.header;
                let areaMaterial = cabecera?.material?.name || (cabecera?.material) || (configuracion?.materialBase?.name || configuracion?.materialBase || 'Estándar');
                let areaVariante = cabecera?.variante || (configuracion?.varianteBase || 'N/A');
                let codArticulo = cabecera?.material?.codArt;
                let codStock = cabecera?.material?.codStock;

                // Fallback manual si no viene header (para compatibilidad)
                if (!codArticulo) {
                    if (['EST', 'ESTAMPADO'].includes(extraArea)) { codArticulo = '111'; codStock = '1.1.5.1'; }
                    if (['TWC', 'CORTE'].includes(extraArea)) { codArticulo = '110'; codStock = '1.1.6.1'; areaMaterial = '110'; }
                }

                let extraItems = [];
                if (extraArea === 'EMB' && bordadoSpecs?.logos && Array.isArray(bordadoSpecs.logos)) {
                    extraItems = bordadoSpecs.logos.map((logo, idx) => ({
                        file: logo.fileData || logo, // Soportar ambos formatos de envío
                        copies: bordadoSpecs.cantidadPrendas || 1,
                        note: `Logo ${idx + 1} - Bordado Complementario`
                    }));
                }

                pendingOrderExecutions.push({
                    areaID: extraArea,
                    material: areaMaterial,
                    variante: areaVariante,
                    codArticulo,
                    codStock,
                    isExtra: true,
                    isEst: extraArea === 'EST',
                    items: extraItems
                });
            });
        }

        // --- 6. ENRIQUECER CON METADATA DE ARTICULOS Y DRIVE ---
        console.log("☁️ [Drive] Procesando archivos...");
        for (let idx = 0; idx < pendingOrderExecutions.length; idx++) {
            const exec = pendingOrderExecutions[idx];
            const globalIndex = idx + 1;
            const docNumber = pendingOrderExecutions.length > 1 ? `${erpDocNumber} (${globalIndex}/${pendingOrderExecutions.length})` : erpDocNumber;
            exec.codigoOrden = `ORD-${docNumber}`;

            // Si el frontend ya mandó los códigos, los respetamos. Sino, buscamos.
            if (!exec.codArticulo) {
                const searchTerm = (exec.material || "").trim();
                if (searchTerm && searchTerm.length > 2) {
                    const searchRes = await pool.request()
                        .input('Q', sql.VarChar, `%${searchTerm}%`)
                        .query(`SELECT TOP 1 CodArticulo, IDProdReact FROM Articulos WHERE Descripcion LIKE @Q`);
                    if (searchRes.recordset.length > 0) {
                        exec.codArticulo = searchRes.recordset[0].CodArticulo;
                        exec.idProductoReact = searchRes.recordset[0].IDProdReact;
                    }
                }
            } else {
                // Si ya tiene CodArticulo, intentar buscar el IDProdReact
                const searchRes = await pool.request()
                    .input('C', sql.VarChar, exec.codArticulo)
                    .query(`SELECT TOP 1 IDProdReact FROM Articulos WHERE CodArticulo = @C`);
                if (searchRes.recordset.length > 0) exec.idProductoReact = searchRes.recordset[0].IDProdReact;
            }
            console.log(`🔍 [Metadata] Orden ${exec.codigoOrden} (${exec.areaID}) -> Material: ${exec.material}, CodArt: ${exec.codArticulo}, IDReact: ${exec.idProductoReact}`);

            // Subir archivos a Drive (En paralelo para velocidad)
            const uploadPromises = exec.items.map(async (item, itemIdx) => {
                const fileNum = itemIdx + 1;
                const totalFiles = exec.items.length;

                const sanitize = (str) => (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
                const pCliente = sanitize(nombreCliente);
                const pTrabajo = sanitize(jobName).substring(0, 30);
                const pFileMeta = totalFiles > 1 ? ` (Arch ${fileNum} de ${totalFiles})` : '';

                if (item.file?.data) {
                    const ext = item.file.name.substring(item.file.name.lastIndexOf('.'));
                    // UNIFIED FORMAT: ORDEN_CLIENTE_TRABAJO Archivo X de Y (xN COPIAS)
                    // Sanitize path separators for filename only
                    const safeCode = exec.codigoOrden.replace(/\//g, '-');
                    const renamed = `${safeCode}_${pCliente}_${pTrabajo} Archivo ${fileNum} de ${totalFiles} (x${item.copies || 1} COPIAS)${ext}`;

                    item.file.driveUrl = await driveService.uploadToDrive(item.file.data, renamed, exec.areaID);
                    item.file.finalName = renamed;
                }
                if (item.fileBack?.data) {
                    const ext = item.fileBack.name.substring(item.fileBack.name.lastIndexOf('.'));
                    const safeCode = exec.codigoOrden.replace(/\//g, '-');
                    const renamedBack = `${safeCode}_${pCliente}_${pTrabajo} DORSO Archivo ${fileNum} de ${totalFiles} (x${item.copies || 1} COPIAS)${ext}`;

                    item.fileBack.driveUrl = await driveService.uploadToDrive(item.fileBack.data, renamedBack, exec.areaID);
                    item.fileBack.finalName = renamedBack;
                }
            });
            await Promise.all(uploadPromises);
        }

        // Subir Referencias y Bocetos (Archivos de Referencia)
        const uploadedReferences = []; // Referencias generales (Bocetos del cliente, logos)
        const uploadedSpecialized = []; // Archivos específicos del flujo (Excel, Tizada, Mockup Final)

        if (referenceFiles && referenceFiles.length > 0) {
            for (const rf of referenceFiles) {
                if (rf.fileData?.data) {
                    const renamedRef = `REF-${erpDocNumber}-${rf.name || rf.fileData.name}`;
                    const driveUrl = await driveService.uploadToDrive(rf.fileData.data, renamedRef, 'GENERAL');
                    uploadedReferences.push({ type: rf.type || 'REFERENCIA', url: driveUrl, name: renamedRef });
                }
            }
        }

        // Archivos Técnicos / Especializados (Paso Único Sublimación / Corte)
        if (specializedFiles && specializedFiles.length > 0) {
            for (const sf of specializedFiles) {
                if (sf.fileData?.data) {
                    const prefix = sf.type?.includes('EXCEL') ? 'PEDIDO' : (sf.type?.includes('TIZADA') ? 'TIZADA' : 'MOCKUP');
                    const renamedSpec = `${prefix}-${erpDocNumber}-${sf.name || sf.fileData.name}`;
                    const driveUrl = await driveService.uploadToDrive(sf.fileData.data, renamedSpec, 'GENERAL');
                    uploadedSpecialized.push({ type: sf.type || 'ESPECIALIZADO', url: driveUrl, name: renamedSpec });
                }
            }
        }

        if (selectedComplementary) {
            for (const [key, val] of Object.entries(selectedComplementary)) {
                const activo = val.activo || val.active;
                const archivo = val.archivo || val.file;
                const observacion = val.observacion || val.text;

                if (activo && archivo?.data) {
                    const renamedBoceto = `BOCETO-${erpDocNumber}-${key}-${archivo.name}`;
                    const driveUrl = await driveService.uploadToDrive(archivo.data, renamedBoceto, 'GENERAL');
                    uploadedReferences.push({ type: 'ARCHIVO DE BOCETO', url: driveUrl, name: renamedBoceto, notes: observacion, extraId: key.toUpperCase() });
                }
            }
        }

        // Archivos Específicos de Bordado (Logos y Boceto)
        const bordadoSpecs = req.body.especificacionesBordado;
        if (bordadoSpecs) {
            if (bordadoSpecs.boceto && (bordadoSpecs.boceto.data || bordadoSpecs.boceto.fileData?.data)) {
                const bocData = bordadoSpecs.boceto.data || bordadoSpecs.boceto.fileData.data;
                const bocName = bordadoSpecs.boceto.name || bordadoSpecs.boceto.fileData.name;
                const renamedBoceto = `BOCETO-BORDADO-${erpDocNumber}-${bocName}`;
                const driveUrl = await driveService.uploadToDrive(bocData, renamedBoceto, 'GENERAL');
                uploadedReferences.push({ type: 'ARCHIVO DE BOCETO', url: driveUrl, name: renamedBoceto });
            }
            if (bordadoSpecs.logos && Array.isArray(bordadoSpecs.logos)) {
                for (const logo of bordadoSpecs.logos) {
                    const lData = logo.data || logo.fileData?.data;
                    const lName = logo.name || logo.fileData?.name;
                    if (lData) {
                        const renamedLogo = `LOGO-BORDADO-${erpDocNumber}-${lName}`;
                        const driveUrl = await driveService.uploadToDrive(lData, renamedLogo, 'GENERAL');
                        uploadedReferences.push({ type: 'ARCHIVO DE LOGO', url: driveUrl, name: renamedLogo });
                    }
                }
            }
        }

        // --- 6. TRANSACCIÓN SQL ---
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        const generatedOrders = [];

        try {
            for (const exec of pendingOrderExecutions) {
                // --- CALCULAR PRÓXIMO SERVICIO (Usando ConfiguracionRutas) ---
                let proximoServicio = 'DEPOSITO';
                const posibilities = rutasConfig
                    .filter(r => r.AreaOrigen.trim().toUpperCase() === exec.areaID)
                    .sort((a, b) => a.Prioridad - b.Prioridad);

                for (const p of posibilities) {
                    const dest = p.AreaDestino.trim().toUpperCase();
                    if (allActiveAreas.has(dest) || dest === 'DEPOSITO') {
                        proximoServicio = dest;
                        break;
                    }
                }

                // --- CALCULAR FECHA ENTRADA SECTOR (Solo Impresión) ---
                const isPrinting = (exec.areaID || "").toUpperCase().match(/IMPRESION|GIG|SUBLIMACION|SB|DF|ECO|UV/);
                const fechaEntradaSector = isPrinting ? new Date() : null;

                const resOrder = await new sql.Request(transaction)
                    .input('AreaID', sql.VarChar(20), exec.areaID)
                    .input('Cliente', sql.NVarChar(200), nombreCliente)
                    .input('CodCliente', sql.Int, codCliente)
                    .input('IdClienteReact', sql.VarChar(50), idClienteReact ? idClienteReact.toString() : null)
                    .input('Desc', sql.NVarChar(300), jobName)
                    .input('Prio', sql.VarChar(20), urgency || 'Normal')
                    .input('Mat', sql.VarChar(255), exec.material)
                    .input('Var', sql.VarChar(100), exec.variante)
                    .input('Cod', sql.VarChar(50), exec.codigoOrden)
                    .input('ERP', sql.VarChar(50), erpDocNumber)
                    .input('Nota', sql.NVarChar(sql.MAX), finalNote)
                    .input('Prox', sql.VarChar(50), proximoServicio)
                    .input('F_EntSec', sql.DateTime, fechaEntradaSector)
                    .input('CodArt', sql.VarChar(50), exec.codArticulo || null)
                    .input('IdReact', sql.Int, exec.idProductoReact || null)
                    .query(`
                        INSERT INTO Ordenes (
                            AreaID, Cliente, CodCliente, IdClienteReact, DescripcionTrabajo, Prioridad, 
                            FechaIngreso, FechaEstimadaEntrega, FechaEntradaSector, Material, Variante, 
                            CodigoOrden, NoDocERP, Nota, Magnitud, ProximoServicio, UM, 
                            CodArticulo, IdProductoReact, Estado, EstadoenArea
                        )
                        OUTPUT INSERTED.OrdenID
                        VALUES (
                            @AreaID, @Cliente, @CodCliente, @IdClienteReact, @Desc, @Prio, 
                            GETDATE(), DATEADD(day, 3, GETDATE()), @F_EntSec, @Mat, @Var, 
                            @Cod, @ERP, @Nota, '0', @Prox, 'u', 
                            @CodArt, @IdReact, 'Pendiente', 'Pendiente'
                        )
                    `);

                const newOID = resOrder.recordset[0].OrdenID;
                generatedOrders.push(exec.codigoOrden);

                // A. Archivos de Producción (Solo si tiene items)
                let fileCount = 0;
                for (const item of exec.items) {
                    if (item.file?.driveUrl) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Nom', sql.VarChar(200), item.file.finalName)
                            .input('Ruta', sql.VarChar(500), item.file.driveUrl)
                            .input('Tipo', sql.VarChar(50), 'Impresion')
                            .input('Cop', sql.Int, item.copies || 1)
                            .input('Obs', sql.NVarChar(sql.MAX), item.note || '')
                            .input('W', sql.Decimal(10, 3), item.width ? (item.width / 300 * 0.0254) : null)
                            .input('H', sql.Decimal(10, 3), item.height ? (item.height / 300 * 0.0254) : null)
                            .query(`INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, Ancho, Alto, FechaSubida, EstadoArchivo, Observaciones) VALUES (@OID, @Nom, @Ruta, @Tipo, @Cop, 0, @W, @H, GETDATE(), 'Pendiente', @Obs)`);
                        fileCount++;
                    }
                    if (item.fileBack?.driveUrl) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Nom', sql.VarChar(200), item.fileBack.finalName)
                            .input('Ruta', sql.VarChar(500), item.fileBack.driveUrl)
                            .input('Cop', sql.Int, item.copies || 1)
                            .input('Obs', sql.NVarChar(sql.MAX), item.note || '')
                            .input('W', sql.Decimal(10, 3), item.widthBack ? (item.widthBack / 300 * 0.0254) : null)
                            .input('H', sql.Decimal(10, 3), item.heightBack ? (item.heightBack / 300 * 0.0254) : null)
                            .query(`INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, Ancho, Alto, FechaSubida, EstadoArchivo, Observaciones) VALUES (@OID, @Nom, @Ruta, 'Back', @Cop, 0, @W, @H, GETDATE(), 'Pendiente', @Obs)`);
                        fileCount++;
                    }
                }
                if (fileCount > 0) {
                    await new sql.Request(transaction).input('OID', sql.Int, newOID).input('C', sql.Int, fileCount).query("UPDATE Ordenes SET ArchivosCount = @C WHERE OrdenID = @OID");
                }

                // B. Archivos de Referencia y Especializados
                // Enganchamos referencias generales a la orden principal Y a Bordado si aplica
                const isBordadoArea = exec.areaID === 'EMB';
                if ((!exec.isExtra || isBordadoArea) && uploadedReferences.length > 0) {
                    for (const rf of uploadedReferences) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), rf.type)
                            .input('Ubi', sql.VarChar(500), rf.url)
                            .input('Nom', sql.VarChar(200), rf.name)
                            .input('Not', sql.NVarChar(sql.MAX), rf.notes || '')
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, UbicacionStorage, NombreOriginal, NotasAdicionales, FechaSubida, UsuarioID) VALUES (@OID, @Tipo, @Ubi, @Nom, @Not, GETDATE(), 1)`);
                    }
                }

                // Archivos especializados (Excel, Tizada) se enganchan a la principal y a Corte/Costura
                const needsSpecialized = !exec.isExtra || ['TWC', 'TWT'].includes(exec.areaID);
                if (needsSpecialized && uploadedSpecialized.length > 0) {
                    for (const sf of uploadedSpecialized) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), sf.type)
                            .input('Ubi', sql.VarChar(500), sf.url)
                            .input('Nom', sql.VarChar(200), sf.name)
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, UbicacionStorage, NombreOriginal, FechaSubida, UsuarioID) VALUES (@OID, @Tipo, @Ubi, @Nom, GETDATE(), 1)`);
                    }
                }

                // C. Servicios Extra (Uso de códigos desde el frontend)
                if (selectedComplementary) {
                    for (const [key, val] of Object.entries(selectedComplementary)) {
                        const activo = val.activo || val.active;
                        const compKey = key.toUpperCase();

                        // Si el extra coincide con el área O si es el servicio principal (Bordado/Estampado/Sublimacion) que queremos registrar como línea de servicio
                        const isMainServiceMatch =
                            (compKey === 'BORDADO' && serviceId === 'bordado') ||
                            (compKey === 'ESTAMPADO' && serviceId === 'estampado') ||
                            ((compKey === 'SB' || compKey === 'SUBLIMACION') && serviceId === 'sublimacion');

                        if ((activo || isMainServiceMatch) && (compKey === exec.areaID || (compKey === 'ESTAMPADO' && exec.areaID === 'EST') || ((compKey === 'SB' || compKey === 'SUBLIMACION') && exec.areaID === 'SB'))) {
                            const cabecera = val.cabecera || val.header;
                            let cArt = cabecera?.material?.codArt;
                            let cStock = cabecera?.material?.codStock;
                            let cDesc = cabecera?.material?.name;

                            if (!cArt) {
                                if (compKey === 'EST' || compKey === 'ESTAMPADO') {
                                    cArt = 'Estampado';
                                    cStock = '1.1.5.1';
                                    cDesc = 'Estampado 110 por bajada';
                                } else if (compKey === 'TWC' || compKey === 'LASER' || compKey === 'CORTE') {
                                    cArt = '110';
                                    cStock = '1.1.6.1';
                                    cDesc = 'Servicio de Corte';
                                } else if (compKey === 'TWT' || compKey === 'COSTURA') {
                                    cArt = 'TWT';
                                    cStock = 'TWT';
                                    cDesc = 'Servicio de Costura / Confección';
                                } else if (compKey === 'EMB' || compKey === 'BORDADO') {
                                    cArt = 'EMB';
                                    cStock = 'EMB';
                                    cDesc = 'Servicio de Bordado';
                                } else if (compKey === 'SB' || compKey === 'SUBLIMACION') {
                                    cArt = 'SB';
                                    cStock = 'SB';
                                    cDesc = 'Servicio de Sublimación';
                                } else {
                                    cArt = compKey;
                                    cStock = compKey;
                                    cDesc = val.observacion || val.text ? `${key} (${val.observacion || val.text})` : key;
                                }
                            }

                            await new sql.Request(transaction)
                                .input('OID', sql.Int, newOID) // OrdenID interna (INT)
                                .input('K', sql.VarChar(50), cArt)
                                .input('S', sql.VarChar(50), cStock)
                                .input('D', sql.NVarChar(200), cDesc)
                                .query(`INSERT INTO ServiciosExtraOrden (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro) VALUES (@OID, @K, @S, @D, 1, 0, 0, 'Web', GETDATE())`);
                        }
                    }
                }

                // CASO ESPECIAL: Si es Bordado, Estampado o Sublimacion como servicio principal y no estaba en selectedComplementary, lo forzamos
                const isBordadoMain = serviceId === 'bordado' && exec.areaID === 'EMB';
                const isEstampadoMain = serviceId === 'estampado' && exec.areaID === 'EST';
                const isSublimacionMain = serviceId === 'sublimacion' && exec.areaID === 'SB';

                if (isBordadoMain || isEstampadoMain || isSublimacionMain) {
                    const alreadyRecorded = selectedComplementary && Object.keys(selectedComplementary).some(k => {
                        const uk = k.toUpperCase();
                        if (isBordadoMain) return uk === 'BORDADO' || uk === 'EMB';
                        if (isEstampadoMain) return uk === 'ESTAMPADO' || uk === 'EST';
                        if (isSublimacionMain) return uk === 'SUBLIMACION' || uk === 'SB';
                        return false;
                    });

                    if (!alreadyRecorded) {
                        let cArt = isBordadoMain ? 'EMB' : (isEstampadoMain ? 'Estampado' : 'SB');
                        let cStock = isBordadoMain ? 'EMB' : (isEstampadoMain ? '1.1.5.1' : 'SB');
                        let cDesc = isBordadoMain ? 'Servicio de Bordado' : (isEstampadoMain ? 'Estampado 110 por bajada' : 'Servicio de Sublimación');

                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('K', sql.VarChar(50), cArt)
                            .input('S', sql.VarChar(50), cStock)
                            .input('D', sql.NVarChar(200), cDesc)
                            .query(`INSERT INTO ServiciosExtraOrden (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro) VALUES (@OID, @K, @S, @D, 1, 0, 0, 'Web - Principal', GETDATE())`);
                    }
                }
            }
            await transaction.commit();
        } catch (dbErr) {
            if (transaction) await transaction.rollback();
            throw dbErr;
        }

        // --- 7. LANZAR PROCESAMIENTO ASÍNCRONO (Solo Impresión) ---
        if (generatedOrders.length > 0) {
            const io = req.app.get('socketio');
            if (io) io.emit('server:ordersUpdated', { count: generatedOrders.length, source: 'web' });

            // Solo mandamos a medir las órdenes que tengan archivos de producción
            const ordersToProcess = pendingOrderExecutions
                .filter(e => e.items.length > 0)
                .map((e, idx) => generatedOrders[idx]);

            fileProcessingService.processOrderList(ordersToProcess, io).catch(console.error);
        }

        res.json({ success: true, orderIds: generatedOrders });

    } catch (err) {
        console.error("❌ Error creando pedido web:", err);
        res.status(500).json({ error: "Error interno: " + err.message });
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
