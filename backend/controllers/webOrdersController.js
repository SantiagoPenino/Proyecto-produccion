const { sql, getPool } = require('../config/db');
const driveService = require('../services/driveService');
const axios = require('axios');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const contabilidadService = require('../services/contabilidadService');
const ERPSyncService = require('../services/erpSyncService');


// ──────────────────────────────────────────────────
// HELPER: Generar comprobante PDF y guardarlo en disco
// ──────────────────────────────────────────────────
async function generateHandyReceipt({ transactionId, ordenRetiro, orders, totalAmount, currency, currencySymbol, convertedTotalAmount, convertedCurrency, convertedCurrencySymbol, paymentMethod, paidAt, codCliente }) {
    try {
        const doc = await PDFDocument.create();
        const page = doc.addPage([595.28, 841.89]); // A4
        const { width } = page.getSize();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

        const drawCentered = (text, y, size, f) => {
            const tw = f.widthOfTextAtSize(text, size);
            page.drawText(text, { x: (width - tw) / 2, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
        };
        const drawLeft = (text, x, y, size, f, color) => {
            page.drawText(text, { x, y, size, font: f, color: color || rgb(0.1, 0.1, 0.1) });
        };
        const drawRight = (text, x, y, size, f, color) => {
            const tw = f.widthOfTextAtSize(text, size);
            page.drawText(text, { x: x - tw, y, size, font: f, color: color || rgb(0.1, 0.1, 0.1) });
        };

        let y = 780;

        // Helper: buscar imagen en múltiples rutas posibles
        const findImage = (filename) => {
            const paths = [
                path.join(__dirname, '..', '..', 'public', 'assets', 'images', filename),
                path.join(__dirname, '..', '..', 'src', 'assets', 'images', filename),
                path.join(process.cwd(), 'public', 'assets', 'images', filename),
                path.join(process.cwd(), 'src', 'assets', 'images', filename),
            ];
            return paths.find(p => fs.existsSync(p)) || null;
        };

        // Logo (arriba a la izquierda)
        try {
            const logoPath = findImage('pasarelas/u.png');
            if (logoPath) {
                const logoBytes = fs.readFileSync(logoPath);
                const logoImage = await doc.embedPng(logoBytes);
                const logoHeight = 40;
                const logoWidth = logoHeight * (logoImage.width / logoImage.height);
                page.drawImage(logoImage, {
                    x: 50,
                    y: y - 12,
                    width: logoWidth,
                    height: logoHeight,
                });
            }
        } catch (logoErr) {
            logger.warn('[RECEIPT] No se pudo agregar logo:', logoErr.message);
        }

        // Título
        drawCentered('COMPROBANTE DE PAGO', y, 18, fontBold);
        y -= 30;

        // Transaction ID
        drawRight(transactionId || '', width - 50, y, 9, font, rgb(0.55, 0.55, 0.55));
        y -= 10;

        // Separador
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: rgb(0.78, 0.78, 0.78) });
        y -= 25;

        // Fecha
        const fechaStr = paidAt ? new Date(paidAt).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : new Date().toLocaleDateString('es-UY');
        drawRight(fechaStr, width - 50, y, 9, font, rgb(0.47, 0.47, 0.47));

        // Código de retiro: solo aceptamos códigos con prefijo RW- (retiros web reales).
        // Si viene otro prefijo (DF-, SB-, etc.) significa que es un código de orden
        // individual usado como fallback — en ese caso mostramos '-' para evitar
        // imprimir un número de retiro inexistente (ej: RW-91468 cuando el retiro era RW-4594).
        const rwMatch = String(ordenRetiro || '').match(/^RW-(\d+)$/i);
        const retiroCode = rwMatch ? `RW-${rwMatch[1]}` : '-';
        drawLeft('CÓDIGO DE RETIRO', 50, y, 9, fontBold);
        y -= 16;
        drawLeft(retiroCode, 50, y, 14, fontBold);
        y -= 22;

        drawLeft('CÓDIGO DE CLIENTE', 50, y, 9, fontBold);
        y -= 16;
        drawLeft(String(codCliente || '-'), 50, y, 14, fontBold);
        y -= 28;

        // Medio de pago: texto simple "PAGADO EN MERCADOPAGO / HANDY"
        const method = String(paymentMethod || '').toLowerCase();
        const gatewayLabel = method.includes('mercadopago') || method.includes('mp')
            ? 'MERCADOPAGO'
            : method.includes('handy') ? 'HANDY' : String(paymentMethod || '').toUpperCase();
        drawLeft('PAGADO CON', 50, y, 9, font, rgb(0.47, 0.47, 0.47));
        drawLeft(gatewayLabel, 50 + font.widthOfTextAtSize('PAGADO CON ', 9), y, 9, fontBold, rgb(0.02, 0.59, 0.41));
        y -= 25;

        // Detalle de pedidos
        if (orders && orders.length > 0) {
            // Header
            page.drawRectangle({ x: 50, y: y - 5, width: width - 100, height: 18, color: rgb(0.1, 0.1, 0.1) });
            drawLeft('PEDIDO', 54, y, 8, fontBold, rgb(1, 1, 1));
            drawRight('IMPORTE', width - 54, y, 8, fontBold, rgb(1, 1, 1));
            y -= 22;

            orders.forEach((o, i) => {
                if (i % 2 === 0) {
                    page.drawRectangle({ x: 50, y: y - 5, width: width - 100, height: 18, color: rgb(0.96, 0.96, 0.96) });
                } else {
                    page.drawRectangle({ x: 50, y: y - 5, width: width - 100, height: 18, color: rgb(0.83, 0.83, 0.85) });
                }
                drawLeft(String(o.id || o.desc || ''), 54, y, 10, font);
                drawRight(`${currencySymbol || '$'} ${Number(o.amount || 0).toFixed(2)}`, width - 54, y, 10, fontBold);
                y -= 18;
            });
            y -= 10;
        }

        // Total original
        page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: rgb(0.78, 0.78, 0.78) });
        y -= 20;
        drawRight('TOTAL ORIGINAL:', width - 130, y, 12, fontBold);
        drawRight(`${currencySymbol || '$'} ${Number(totalAmount).toFixed(2)}`, width - 50, y, 12, fontBold, rgb(0.02, 0.59, 0.41));
        y -= 14;
        drawRight(currency === 840 ? 'USD' : 'UYU', width - 50, y, 10, font);

        // Conversión cobrada si existe diferencia entre monedas
        if (convertedTotalAmount && convertedCurrency !== currency) {
            y -= 18;
            drawRight(`Cobrado final:`, width - 130, y, 10, font);
            const eqStr = `= ${convertedCurrencySymbol || '$'} ${Number(convertedTotalAmount).toFixed(2)}`;
            drawRight(eqStr, width - 50, y, 10, fontBold, rgb(0.5, 0.5, 0.5));
            y -= 12;
            drawRight(convertedCurrency === 840 ? 'USD' : 'UYU', width - 50, y, 8, font, rgb(0.5, 0.5, 0.5));
        }

        // PAGADO en texto verde
        y -= 25;
        drawLeft('PAGADO', 50, y, 18, fontBold, rgb(0.02, 0.59, 0.41));

        // Footer
        drawCentered('ESTE COMPROBANTE FUE GENERADO AUTOMATICAMENTE.', 40, 8, font);

        // Guardar en disco (redirigido a comprobantesPagos para unificar localizaciones)
        const baseDir = process.env.COMPROBANTES_PATH || path.join(__dirname, '..', 'comprobantesPagos');
        const dir = baseDir; // Sin subcarpeta handy, para que concuerde con el frontend
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const safeCode = (retiroCode && retiroCode !== '-') ? retiroCode : (transactionId || 'suelto-' + Date.now());
        const fileName = `Comprobante-${safeCode}.pdf`;
        const filePath = path.join(dir, fileName);
        const pdfBytes = await doc.save();
        fs.writeFileSync(filePath, pdfBytes);

        logger.info(`[HANDY RECEIPT] Comprobante guardado: ${filePath}`);
        return filePath;
    } catch (err) {
        logger.error('[HANDY RECEIPT] Error generando comprobante:', err.message);
        return null;
    }
}

// ===================================
// TOTEM: VERIFICAR IP (SIN AUTH)
// ===================================
exports.totemVerify = (req, res) => {
    const allowedIp = process.env.TOTEM_ALLOWED_IP;
    if (!allowedIp) {
        return res.json({ authorized: true }); // Si no hay IP configurada, permitir (dev mode)
    }
    // req.ip puede ser IPv6-mapped (::ffff:192.168.1.1) o IPv4 directo
    const clientIp = (req.ip || '').replace(/^::ffff:/, '');
    const authorized = clientIp === allowedIp;
    logger.info(`[TOTEM] IP check: ${clientIp} vs ${allowedIp} → ${authorized ? '✅' : '❌'}`);
    res.json({ authorized, ip: clientIp });
};

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
    logger.info("📥 [WebOrder] Iniciando proceso de creación (MODO STREAMING)...");

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
    let cliIdCliente = null;

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
            const clientRes = await pool.request().input('cod', sql.Int, codCliente).query("SELECT CliIdCliente, IDReact FROM Clientes WHERE CodCliente = @cod");
            if (clientRes.recordset.length > 0) {
                idClienteReact = clientRes.recordset[0].IDReact;
                cliIdCliente = clientRes.recordset[0].CliIdCliente;
            }
        }

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
                        observacionesBack: it.observacionesBack,
                        sinDPI: it.sinDPI,
                        sinDPIBack: it.sinDPIBack
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

                // Extracción robusta de ID de producto
                let finalProIdProducto = cabecera.proIdProducto || cabecera.ProIdProducto;
                let finalIdProductoReact = cabecera.idProductoReact || cabecera.idProducto;

                if (cabecera.material && typeof cabecera.material === 'object') {
                    if (!finalProIdProducto) finalProIdProducto = cabecera.material.proIdProducto || cabecera.material.ProIdProducto || cabecera.material.id;
                    if (!finalIdProductoReact) finalIdProductoReact = cabecera.material.idProductoReact || cabecera.material.idProducto || cabecera.material.id;
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
                    proIdProducto: finalProIdProducto,
                    idProductoReact: finalIdProductoReact,
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

                let finalProIdProducto = cabecera.proIdProducto || cabecera.ProIdProducto;
                if (cabecera.material && typeof cabecera.material === 'object') {
                    if (!finalProIdProducto) finalProIdProducto = cabecera.material.proIdProducto || cabecera.material.ProIdProducto || cabecera.material.id;
                }

                pendingOrderExecutions.push({
                    areaID: mainAreaID,
                    material: cabecera.material,
                    variante: cabecera.variante,
                    codArticulo: cabecera.codArticulo,
                    codStock: cabecera.codStock,
                    proIdProducto: finalProIdProducto,
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
                        observaciones: sl.archivoPrincipal?.observaciones || '',
                        observacionesBack: sl.archivoDorso?.observaciones || '',
                        sinDPI: sl.archivoPrincipal?.sinDPI,
                        sinDPIBack: sl.archivoDorso?.sinDPI
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
                        proIdProducto: matObj.proIdProducto || matObj.id,
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
                let extraProIdProd = null;
                let magnitudInicial = 0;

                if (extraArea === 'TWT' || extraId.toUpperCase() === 'COSTURA') {
                    areaMaterial = 'Costura';
                    areaVariante = 'Costura';
                    extraCodArt = '115';
                    extraCodStock = '1.1.7.1';
                    extraProIdProd = 36;
                    extraIdProd = 219;
                    magnitudInicial = parseInt(val.cantidad || val.quantity || cabecera?.cantidad || 0);
                } else if (extraArea === 'TWC' || extraId.toUpperCase() === 'LASER' || extraId.toUpperCase() === 'CORTE') {
                    areaMaterial = 'Corte Laser por prenda';
                    areaVariante = 'Corte Laser';
                    extraCodArt = '1375';
                    extraCodStock = '1.1.6.1';
                    extraProIdProd = 90;
                    extraIdProd = 253;
                    magnitudInicial = parseInt(val.cantidad || val.quantity || cabecera?.cantidad || 0);
                } else if (extraArea === 'EMB' || extraId.toUpperCase() === 'BORDADO') {
                    areaMaterial = 'Bordado';
                    areaVariante = 'Bordado';
                    extraCodArt = '1567';
                    extraCodStock = '1.1.9.1';
                    extraProIdProd = 434;
                    extraIdProd = 65;
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
                    proIdProducto: extraProIdProd,
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
        logger.info("--- DEBUG SORTING ---");
        logger.info("Mapa Areas Numero:", JSON.stringify(mapaAreasNumero));
        pendingOrderExecutions.forEach(e => {
            logger.info(`Area: ${e.areaID} - Prioridad: ${mapaAreasNumero[e.areaID] || 999}`);
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

        // Buscamos IDProdReact y ProIdProducto en la tabla Articulos usando ProIdProducto, IDProdReact o CodArticulo
        const proIdCodes = [];
        const idReactCodes = [];
        const codArtCodes = [];
        pendingOrderExecutions.forEach(e => {
            if (e.proIdProducto) proIdCodes.push(String(e.proIdProducto).trim());
            if (e.idProductoReact) idReactCodes.push(String(e.idProductoReact).trim());
            if (e.codArticulo) codArtCodes.push(String(e.codArticulo).trim());
        });
        const uniqueProIds = [...new Set(proIdCodes)].filter(Boolean);
        const uniqueIdReacts = [...new Set(idReactCodes)].filter(Boolean);
        const uniqueCodArts = [...new Set(codArtCodes)].filter(Boolean);

        const mapArtByProId = {};
        const mapArtByIdReact = {};
        const mapArtByCodArt = {};

        if (uniqueProIds.length > 0 || uniqueIdReacts.length > 0 || uniqueCodArts.length > 0) {
            try {
                const request = pool.request();
                const clauses = [];

                uniqueProIds.forEach((id, i) => {
                    request.input(`proId${i}`, sql.Int, parseInt(id));
                    clauses.push(`(ProIdProducto = @proId${i})`);
                });

                uniqueIdReacts.forEach((id, i) => {
                    request.input(`idReact${i}`, sql.Int, parseInt(id));
                    clauses.push(`(IDProdReact = @idReact${i})`);
                });

                uniqueCodArts.forEach((code, i) => {
                    request.input(`codArt${i}`, sql.VarChar(50), code);
                    clauses.push(`(LTRIM(RTRIM(CodArticulo)) = @codArt${i})`);
                });

                const whereClause = clauses.join(' OR ');
                const queryStr = `SELECT IDProdReact, CodArticulo, ProIdProducto, CodStock FROM Articulos WHERE ${whereClause}`;

                const artRes = await request.query(queryStr);

                artRes.recordset.forEach(r => {
                    const info = { idReact: r.IDProdReact, proId: r.ProIdProducto, codArt: r.CodArticulo ? r.CodArticulo.trim() : null, codStock: r.CodStock ? r.CodStock.trim() : null };
                    if (r.ProIdProducto !== null && r.ProIdProducto !== undefined) {
                        mapArtByProId[String(r.ProIdProducto).trim()] = info;
                    }
                    if (r.IDProdReact !== null && r.IDProdReact !== undefined) {
                        mapArtByIdReact[String(r.IDProdReact).trim()] = info;
                    }
                    if (r.CodArticulo !== null && r.CodArticulo !== undefined) {
                        mapArtByCodArt[r.CodArticulo.trim().toUpperCase()] = info;
                    }
                });

                // Asignar IDs a las ejecuciones
                pendingOrderExecutions.forEach(exec => {
                    let info = null;
                    if (exec.proIdProducto) {
                        info = mapArtByProId[String(exec.proIdProducto).trim()];
                    }
                    if (!info && exec.idProductoReact) {
                        info = mapArtByIdReact[String(exec.idProductoReact).trim()];
                    }
                    if (!info && exec.codArticulo) {
                        info = mapArtByCodArt[String(exec.codArticulo).trim().toUpperCase()];
                    }

                    if (info) {
                        exec.idProductoReact = info.idReact || exec.idProductoReact;
                        exec.proIdProducto = info.proId || exec.proIdProducto;
                        exec.codArticulo = info.codArt || exec.codArticulo;
                        if (info.codStock && !exec.codStock) {
                            exec.codStock = info.codStock;
                        }
                    }
                });

            } catch (lookupErr) {
                logger.warn("⚠️ No se pudo resolver IdProductoReact/ProIdProducto desde Articulos:", lookupErr.message);
            }
        }

        // --- CARGAR MAPEO DE PREFIJOS ---
        const configRes = await pool.request().query("SELECT AreaID_Interno, CodOrden FROM ConfigMapeoERP");
        const areaPrefixMap = {};
        configRes.recordset.forEach(r => {
            if (r.AreaID_Interno && r.CodOrden) {
                areaPrefixMap[r.AreaID_Interno.trim().toUpperCase()] = r.CodOrden.trim().toUpperCase();
            }
        });

        // --- 6. TRANSACCIÓN DB ---
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const filesToUpload = [];
            const generatedOrders = [];
            const generatedIDs = [];
            const timestamp = Date.now();


            for (let idx = 0; idx < pendingOrderExecutions.length; idx++) {
                const exec = pendingOrderExecutions[idx];
                const fisicasSB = pendingOrderExecutions.filter(e => e.areaID === 'SB');
                let docNumber = erpDocNumber;
                
                if (exec.areaID === 'SB' && fisicasSB.length > 1) {
                    const indexSB = fisicasSB.findIndex(e => e === exec) + 1;
                    docNumber = `${erpDocNumber} (${indexSB}/${fisicasSB.length})`;
                }

                const areaPrefix = areaPrefixMap[exec.areaID.toUpperCase()] || 'ORD';
                exec.codigoOrden = `${areaPrefix}-${docNumber}`;

                // helper sanitize ya está en scope global si lo moví bien, si no lo redefino por seguridad
                const sanitize = (str) => (str || '').replace(/[<>:"/\\|?*]/g, '_').trim();
                // Quita todos los puntos del nombre de archivo excepto el de la extensión
                // Ej: "imagen.pedido.pdf" → "imagenpedido.pdf"
                const sanitizeFileName = (name) => {
                    if (!name) return name;
                    const lastDot = name.lastIndexOf('.');
                    if (lastDot <= 0) return name; // sin extensión o empieza con punto
                    const base = name.substring(0, lastDot).replace(/\./g, '');
                    const ext = name.substring(lastDot);
                    return base + ext;
                };

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

                const isPrinting = (exec.areaID || "").toUpperCase().match(/IMPRESION|GIG|SUBLIMACION|SB|DF|ECO|UV/);
                const fechaEntradaSector = isPrinting ? new Date() : null;

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
                    .input('ProIdProducto', sql.Int, exec.proIdProducto || null)
                    .input('CliIdCliente', sql.Int, cliIdCliente)
                    .input('F_EntSec', sql.DateTime, fechaEntradaSector)
                    .query(`
                        INSERT INTO Ordenes (
                            AreaID, Cliente, CodCliente, IdClienteReact, DescripcionTrabajo, Prioridad, 
                            FechaIngreso, FechaEstimadaEntrega, Material, Variante, 
                            CodigoOrden, NoDocERP, Nota, Magnitud, ProximoServicio, UM, Estado, EstadoenArea,
                            CodArticulo, IdProductoReact, ProIdProducto, CliIdCliente, FechaEntradaSector
                        )
                        OUTPUT INSERTED.OrdenID
                        VALUES (
                            @AreaID, @Cliente, @CodCliente, @IdClienteReact, @Desc, @Prio, 
                            GETDATE(), DATEADD(day, 3, GETDATE()), @Mat, @Var, 
                            @Cod, @ERP, @Nota, @Mag, @Prox, @UM, @Estado, @Estado,
                            @CodArt, @IdProdReact, @ProIdProducto, @CliIdCliente, @F_EntSec
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
                        const safeItemName = sanitizeFileName(item.fileName);
                        const parts = safeItemName.split('.');
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
                            .input('SinDPI', sql.Bit, item.sinDPI || null)
                            .query(`
                                INSERT INTO ArchivosOrden (
                                    OrdenID, NombreArchivo, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida,
                                    Ancho, Alto, Observaciones, CodigoArticulo, SinDPI
                                ) 
                                OUTPUT INSERTED.ArchivoID 
                                VALUES (
                                    @OID, @Nom, @Tipo, @Cop, @Met, 'Pendiente', GETDATE(),
                                    @Ancho, @Alto, @Obs, @CodArt, @SinDPI
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

                        const safeBackName = sanitizeFileName(item.fileBackName);
                        const partsBack = safeBackName.split('.');
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
                            .input('SinDPI', sql.Bit, item.sinDPIBack || null)
                            .query(`
                                INSERT INTO ArchivosOrden (
                                    OrdenID, NombreArchivo, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida,
                                    Ancho, Alto, Observaciones, CodigoArticulo, SinDPI
                                ) 
                                OUTPUT INSERTED.ArchivoID 
                                VALUES (
                                    @OID, @Nom, @Tipo, @Cop, @Met, 'Pendiente', GETDATE(),
                                    @Ancho, @Alto, @Obs, @CodArt, @SinDPI
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
                // logger.info(`[Order ${exec.codigoOrden}] RefCount: ${exec.referencias?.length || 0}`);

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
                        const finalNameRef = `REF-${erpDocNumber}-${sanitizeFileName(rf.name)}`;
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
                        const finalNameSpec = `SPEC-${erpDocNumber}-${sanitizeFileName(sf.name)}`;
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
                        const finalNameComp = `BOCETO-${erpDocNumber}-${exec.extraOriginId}-${sanitizeFileName(val.archivo.name)}`;
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
                        const fName = `BOCETO-BORDADO-${erpDocNumber}-${sanitizeFileName(bs.boceto.name)}`;
                        const resRef = await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Nom', sql.VarChar(200), fName).query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage) OUTPUT INSERTED.RefID VALUES (@OID, 'ARCHIVO DE BOCETO', @Nom, GETDATE(), 'Pendiente')`);
                        filesToUpload.push({ dbId: resRef.recordset[0].RefID, type: 'REF', originalName: bs.boceto.name, finalName: fName, area: 'GENERAL' });
                    }
                    if (bs.logos && Array.isArray(bs.logos)) {
                        for (const logo of bs.logos) {
                            if (logo.name) {
                                const lName = `LOGO-BORDADO-${erpDocNumber}-${sanitizeFileName(logo.name)}`;
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
                        // Si no hay nada pendiente, activar (solo si sigue en 'Cargando...', preserva el guard original).
                        const { changeOrderState } = require('../services/stateManagerService');
                        const estadoActual = await new sql.Request(transaction)
                            .input('OID', sql.Int, oid)
                            .query(`SELECT Estado FROM Ordenes WHERE OrdenID = @OID`);
                        if (estadoActual.recordset[0]?.Estado === 'Cargando...') {
                            await changeOrderState(transaction, {
                                target : { type: 'ORDER', id: oid },
                                estado : 'Pendiente',
                                userObj: req.user || 'Sistema',
                                detalle: 'Archivos completos, orden activada',
                                io     : req.app.get('socketio'),
                            });
                        }
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

            // --- AUTO-COTIZACIÓN ASÍNCRONA ---
            // Disparar el cálculo de precios en segundo plano para que la orden
            // aparezca cotizada en Caja sin requerir un sync manual del ERP.
            // skipDeposito=true → NO escribe en OrdenesDeposito, solo calcula y
            // guarda en PedidosCobranza para que sea visible en el panel de Caja.
            setImmediate(async () => {
                try {
                    logger.info(`[WebOrder] 🔢 Iniciando auto-cotización para NoDocERP=${erpDocNumber}...`);
                    await ERPSyncService.syncFinalOrderIntegration(
                        erpDocNumber,
                        req.user?.id || 1,
                        req.user?.name || nombreCliente,
                        null,
                        { skipDeposito: true }
                    );
                    logger.info(`[WebOrder] ✅ Auto-cotización completada para NoDocERP=${erpDocNumber}.`);
                } catch (syncErr) {
                    logger.warn(`[WebOrder] ⚠️ Auto-cotización falló para ${erpDocNumber} (no crítico): ${syncErr.message}`);
                }
            });

        } catch (dbErr) {
            if (transaction) await transaction.rollback();
            throw dbErr;
        }

    } catch (err) {
        logger.error("❌ Error creando estructura de pedido:", err);
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

    logger.info(`🚀 [UploadStream] Recibiendo archivo: ${finalName} (${file.size} bytes)`);

    let tmpPath = null;
    try {
        // Soporta tanto diskStorage (file.path) como memoryStorage (file.buffer)
        let fileInput;
        if (file.path) {
            tmpPath = file.path;
            fileInput = require('fs').createReadStream(file.path);
        } else {
            fileInput = file.buffer;
        }

        const driveUrl = await driveService.uploadToDrive(fileInput, finalName, area || 'GENERAL');

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
                logger.info(`✅ [Pedido Completo] Orden ${orderID} tiene todos sus archivos. Activando...`);
                // Cambiar estado de 'Cargando...' a 'Pendiente' (vía servicio central, con guarda y transacción)
                const { changeOrderState } = require('../services/stateManagerService');
                const txAct = new sql.Transaction(pool);
                await txAct.begin();
                try {
                    await changeOrderState(txAct, {
                        target : { type: 'ORDER', id: orderID },
                        estado : 'Pendiente',
                        userObj: req.user || 'Sistema',
                        detalle: 'Archivos completos, orden activada',
                        guard  : "Estado = 'Cargando...'",
                        io     : req.app.get('socketio'),
                    });
                    await txAct.commit();
                } catch (e) { await txAct.rollback(); throw e; }

                // Obtener datos de la orden para el Toast
                const orderDataReq = await pool.request().input('OID', sql.Int, orderID).query(`
                    SELECT AreaID, DescripcionTrabajo, Prioridad, CodigoOrden
                    FROM Ordenes 
                    WHERE OrdenID = @OID
                `);

                // Notificar sockets
                const io = req.app.get('socketio');
                if (io) {
                    io.emit('server:ordersUpdated', { count: 1, source: 'web-upload' });
                    
                    if (orderDataReq.recordset.length > 0) {
                        const row = orderDataReq.recordset[0];
                        io.emit('server:new_order', { 
                            orders: [{
                                id: orderID,
                                area: row.AreaID,
                                variante: row.DescripcionTrabajo,
                                prioridad: row.Prioridad || 'Normal',
                                codigo: row.CodigoOrden
                            }] 
                        });
                    }
                }
            }
        }

        res.json({ success: true, driveUrl });

    } catch (error) {
        logger.error("❌ Error en subida streaming:", error);
        res.status(500).json({ error: "Fallo subida a Drive: " + error.message });
    } finally {
        // Borrar archivo temporal del disco
        if (tmpPath) {
            try { require('fs').unlinkSync(tmpPath); } catch (_) {}
        }
    }
};
// --- OBTENER ESTADO EN FÁBRICA ---
exports.getClientOrders = async (req, res) => {
    const codCliente = req.user?.codCliente;
    if (!codCliente) {
        // If the user is an internal admin testing the portal, don't throw 401 to avoid breaking the UI.
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    try {
        const pool = await getPool();

        // 1. Calcular contadores globales (solo en la página 1 para no repetir trabajo)
        let counts = null;
        if (page === 1) {
            const countsQuery = await pool.request()
                .input('cod', sql.Int, codCliente)
                .query(`
                    SELECT ISNULL(o.NoDocERP, o.CodigoOrden) AS DocID, o.Estado
                    FROM Ordenes o WITH(NOLOCK)
                    WHERE o.CodCliente = @cod
                    UNION ALL
                    SELECT o.OrdCodigoOrden AS DocID, e.EOrNombreEstado AS Estado
                    FROM OrdenesDeposito o WITH(NOLOCK)
                    INNER JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                    LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                    WHERE c.CodCliente = @cod
                `);
            
            const docs = {};
            countsQuery.recordset.forEach(r => {
                const docId = r.DocID || 'SIN_DOC';
                if (!docs[docId]) docs[docId] = [];
                docs[docId].push(r);
            });

            const getStatusKey = (status) => {
                const s = (status || '').toUpperCase();
                if (s.includes('CARGANDO')) return 'zombie';
                if (s.includes('PENDIENTE')) return 'pendiente';
                if (s.includes('CANCELADO')) return 'cancelado';
                if (s.includes('ENTREGADO')) return 'entregado';
                if (s.includes('AVISADO') || s.includes('PARA AVISAR')) return 'avisado';
                if (s.includes('FINALIZADO') || s.includes('PRONTO') || s.includes('INGRESADO')) return 'finalizado';
                return 'activo';
            };

            const getProjectStatus = (subOrders) => {
                const statuses = subOrders.map(so => getStatusKey(so.Estado));
                if (statuses.every(s => s === 'cancelado')) return 'cancelado';
                if (statuses.every(s => s === 'entregado')) return 'entregado';
                if (statuses.every(s => s === 'avisado')) return 'avisado';
                if (statuses.every(s => ['finalizado', 'entregado', 'avisado'].includes(s))) return 'finalizado';
                if (statuses.every(s => s === 'pendiente' || s === 'zombie')) return 'pendiente';
                if (statuses.some(s => s === 'zombie')) return 'zombie';
                if (statuses.some(s => s === 'activo')) return 'activo';
                return 'pendiente';
            };

            const acc = { ALL: 0, ACTIVE: 0, PENDING: 0, DONE: 0, CANCELLED: 0 };
            Object.values(docs).forEach(subOrders => {
                const s = getProjectStatus(subOrders);
                if (s === 'activo') acc.ACTIVE++;
                else if (s === 'pendiente' || s === 'zombie') acc.PENDING++;
                else if (['finalizado', 'entregado', 'avisado'].includes(s)) acc.DONE++;
                else if (s === 'cancelado') acc.CANCELLED++;
                acc.ALL++;
            });
            counts = acc;
        }

        const result = await pool.request()
            .input('cod', sql.Int, codCliente)
            .input('Offset', sql.Int, offset)
            .input('Limit', sql.Int, limit)
            .query(`
                SELECT * FROM (
                    -- Órdenes web (tabla interna Ordenes)
                    SELECT
                        o.OrdenID       AS OrdenID,
                        o.CodigoOrden   AS CodigoOrden,
                        o.NoDocERP      AS NoDocERP,
                        o.DescripcionTrabajo AS DescripcionTrabajo,
                        o.Material      AS Material,
                        o.FechaIngreso  AS FechaIngreso,
                        o.Estado        AS Estado,
                        COALESCE(ar.Nombre, o.AreaID) AS AreaID,
                        NULL            AS Total,
                        NULL            AS Moneda,
                        'WEB'           AS Origen,
                        mc.Titulo       AS MotivoCancelacion,
                        o.DetallesCancelacion AS DetallesCancelacion
                    FROM Ordenes o WITH(NOLOCK)
                    LEFT JOIN MotivosCancelacion mc ON mc.MotivoID = o.MotivoCancelacionID
                    LEFT JOIN Areas ar WITH(NOLOCK) ON ar.AreaID = o.AreaID
                    WHERE o.CodCliente = @cod

                    UNION ALL

                    -- Órdenes ERP (tabla OrdenesDeposito)
                    SELECT
                        o.OrdIdOrden        AS OrdenID,
                        o.OrdCodigoOrden    AS CodigoOrden,
                        o.OrdCodigoOrden    AS NoDocERP,
                        o.OrdNombreTrabajo  AS DescripcionTrabajo,
                        art.Descripcion     AS Material,
                        o.OrdFechaEstadoActual AS FechaIngreso,
                        e.EOrNombreEstado   AS Estado,
                        NULL                AS AreaID,
                        o.OrdCostoFinal     AS Total,
                        m.MonSimbolo        AS Moneda,
                        'ERP'               AS Origen,
                        NULL                AS MotivoCancelacion,
                        NULL                AS DetallesCancelacion
                    FROM OrdenesDeposito o WITH(NOLOCK)
                    INNER JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                    LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                    LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = o.MonIdMoneda
                    LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = o.ProIdProducto
                    WHERE c.CodCliente = @cod
                ) combined
                ORDER BY combined.FechaIngreso DESC, combined.OrdenID DESC
                OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY
            `);

        res.json({ success: true, data: result.recordset, counts });
    } catch (err) {
        logger.error("❌ Error al obtener órdenes del cliente:", err);
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
                // SOFT DELETE (Cancelar) - Queda en historial, vía servicio central
                const { changeOrderState } = require('../services/stateManagerService');
                await changeOrderState(transaction, {
                    target : { type: 'ORDER', id },
                    estado : 'Cancelado',
                    userObj: req.user || 'Sistema',
                    detalle: 'Pedido incompleto cancelado',
                    io     : req.app.get('socketio'),
                });
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
        logger.error("❌ Error eliminando pedido incompleto:", err);
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
                await reqTx.query(`DELETE FROM PedidosCobranzaDetalle WHERE OrdenID = ${oid}`);
                await reqTx.query(`DELETE FROM Ordenes WHERE OrdenID = ${oid}`);
            }

            // Purgar cabecera contable atada a este proyecto
            await reqTx.input('DocERP', sql.VarChar(50), docId).query(`DELETE FROM PedidosCobranza WHERE NoDocERP = @DocERP`);

            await transaction.commit();
            res.json({ success: true, message: `Proyecto ${docId} eliminado (${ids.length} órdenes canceladas).` });

        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }

    } catch (err) {
        logger.error("❌ Error eliminando bundle:", err);
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
        logger.error("❌ Error al obtener órdenes de sublimación:", err);
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
        logger.error("❌ Error fetching area mapping:", error);
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
        logger.error("❌ Error updating visibility:", error);
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
                    tc.TClDescripcion AS TipoCliente,
                    m.MonSimbolo,
                    LTRIM(RTRIM(art.Descripcion)) AS Producto
                FROM OrdenesDeposito o WITH(NOLOCK)
                LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
                LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = o.MonIdMoneda
                LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = o.ProIdProducto
                WHERE c.IDCliente = @idCliente
                AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar')
                AND o.OReIdOrdenRetiro IS NULL
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
                logger.error("Error consultando PedidosCobranza en getPickupOrders:", sqle.message);
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
                currency: cob ? cob.Moneda : (o.MonSimbolo && o.MonSimbolo.toUpperCase().includes('U') ? 'USD' : '$'),
                quantity: parseQuantity(o.Cantidad),
                quantityStr: o.Cantidad ? String(o.Cantidad) : '1',
                clientId: o.IdCliente || 'N/A',
                contact: o.Celular ? o.Celular.trim() : '',
                clientType: o.TipoCliente ? String(o.TipoCliente).trim() : 'Comun',
                article: o.Producto || null
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
        logger.error("Error fetching pickup orders:", error);
        res.status(500).json({ error: "Error al obtener órdenes de retiro." });
    }
};

// ===================================
// TOTEM: BUSCAR ÓRDENES POR CÓDIGO (SIN AUTH)
// ===================================
exports.totemLookup = async (req, res) => {
    try {
        const { orderCode } = req.body;
        if (!orderCode) return res.status(400).json({ success: false, message: 'Código de orden requerido' });

        const pool = await getPool();
        const code = orderCode.trim();

        // 1. Buscar la orden y al cliente
        const orderRes = await pool.request()
            .input('code', sql.VarChar(50), code)
            .query(`
                SELECT TOP 1 o.CliIdCliente, o.OReIdOrdenRetiro, c.IDCliente, c.Nombre, c.NombreFantasia
                FROM OrdenesDeposito o WITH(NOLOCK)
                LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                WHERE o.OrdCodigoOrden = @code
            `);

        if (!orderRes.recordset.length) {
            return res.json({ success: false, message: 'Orden no encontrada' });
        }
        if (orderRes.recordset[0].OReIdOrdenRetiro) {
            return res.json({ success: false, message: 'Esta orden ya tiene un retiro asociado' });
        }

        const client = orderRes.recordset[0];

        // 2. Traer todas las órdenes listas para retirar del mismo cliente
        const allOrdersRes = await pool.request()
            .input('cliId', sql.Int, client.CliIdCliente)
            .query(`
                SELECT
                    o.OrdIdOrden AS IdOrden,
                    o.OrdCodigoOrden AS CodigoOrden,
                    o.OrdNombreTrabajo AS NombreTrabajo,
                    o.OrdCantidad AS Cantidad,
                    o.OrdCostoFinal AS CostoFinal,
                    o.OrdFechaEstadoActual AS FechaEstado,
                    e.EOrNombreEstado AS Estado,
                    m.MonSimbolo
                FROM OrdenesDeposito o WITH(NOLOCK)
                LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = o.MonIdMoneda
                WHERE o.CliIdCliente = @cliId
                AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar', 'Pronto para entregar')
                AND o.OReIdOrdenRetiro IS NULL
            `);

        // 3. Cruzar con PedidosCobranza para estado de pago
        const codigosList = allOrdersRes.recordset.map(o => o.CodigoOrden).filter(Boolean);
        let cobranzasMap = {};
        if (codigosList.length > 0) {
            try {
                const request = pool.request();
                const params = codigosList.map((c, i) => {
                    request.input(`doc_${i}`, sql.VarChar(50), c);
                    return `@doc_${i}`;
                }).join(',');
                const cobRes = await request.query(`SELECT NoDocERP, MontoTotal, Moneda, EstadoCobro FROM PedidosCobranza WHERE NoDocERP IN (${params})`);
                cobRes.recordset.forEach(row => { cobranzasMap[row.NoDocERP] = row; });
            } catch (e) {
                logger.error("Error PedidosCobranza totem:", e.message);
            }
        }

        // 4. Mapear
        const orders = allOrdersRes.recordset.map(o => {
            const docId = o.CodigoOrden || `#${o.IdOrden}`;
            const cob = cobranzasMap[docId];
            return {
                id: docId,
                rawId: o.IdOrden,
                desc: o.NombreTrabajo || 'Pedido',
                quantity: o.Cantidad || '',
                amount: cob ? parseFloat(cob.MontoTotal) : (parseFloat(o.CostoFinal) || 0),
                date: o.FechaEstado ? new Date(o.FechaEstado).toLocaleDateString('es-UY') : 'N/A',
                status: cob?.EstadoCobro === 'Pagado' ? 'PAGADO' : 'LISTO',
                originalStatus: o.Estado,
                isPaid: cob?.EstadoCobro === 'Pagado' || false,
                currency: cob ? cob.Moneda : (o.MonSimbolo || '$'),
            };
        });

        res.json({
            success: true,
            client: {
                name: client.Nombre,
                company: client.NombreFantasia,
                idCliente: client.IDCliente
            },
            orders
        });

    } catch (error) {
        logger.error("Error totem lookup:", error);
        res.status(500).json({ success: false, message: "Error al buscar orden." });
    }
};

// ===================================
// TOTEM: CREAR RETIRO (SIN AUTH)
// ===================================
exports.totemCreatePickup = async (req, res) => {
    const { orders: selectedOrderIds, totalCost, lugarRetiro, formaRetiro, clientId } = req.body;

    if (!selectedOrderIds || !selectedOrderIds.length) {
        return res.status(400).json({ success: false, error: "No hay órdenes seleccionadas." });
    }
    if (!clientId) {
        return res.status(400).json({ success: false, error: "Cliente no identificado." });
    }

    try {
        const pool = await getPool();

        // 1. Buscar CodCliente a partir del IDCliente
        const clientRes = await pool.request()
            .input('idCliente', sql.VarChar, clientId)
            .query("SELECT CodCliente, CliIdCliente, FormaEnvioID FROM Clientes WHERE IDCliente = @idCliente");

        if (!clientRes.recordset.length) {
            return res.status(404).json({ success: false, error: "Cliente no encontrado." });
        }
        const codCliente = clientRes.recordset[0].CodCliente;
        const clientFormaEnvio = clientRes.recordset[0].FormaEnvioID || 5;
        const lugarRetiroFinal = lugarRetiro ? parseInt(lugarRetiro, 10) : clientFormaEnvio;

        // 2. Resolver IDs de OrdenesDeposito seleccionadas
        const depositoResult = await pool.request()
            .input('idCli', sql.VarChar, clientId)
            .query(`
                SELECT o.OrdIdOrden, o.OrdCodigoOrden
                FROM OrdenesDeposito o WITH(NOLOCK)
                LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                WHERE c.IDCliente = @idCli
                AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar', 'Pronto para entregar')
                AND o.OReIdOrdenRetiro IS NULL
            `);

        const rawIds = [];
        for (const o of depositoResult.recordset) {
            const docId = o.OrdCodigoOrden || `#${o.OrdIdOrden}`;
            if (selectedOrderIds.includes(docId) || selectedOrderIds.includes(o.OrdCodigoOrden)) {
                rawIds.push(o.OrdIdOrden);
            }
        }

        if (rawIds.length === 0) {
            return res.status(400).json({ success: false, error: "Órdenes no encontradas." });
        }

        // 3. Crear retiro
        const { crearRetiro } = require('../services/retiroService');
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const OReIdOrdenRetiro = await crearRetiro(transaction, {
                ordIds: rawIds,
                totalCost: totalCost || 0,
                lugarRetiro: lugarRetiroFinal,
                usuarioAlta: 70,
                formaRetiro: formaRetiro || 'RT',
                codCliente: parseInt(codCliente, 10) || null,
                moneda: 'UYU'
            });

            await transaction.commit();

            const ordIdRetiro = `RT-${OReIdOrdenRetiro}`;

            // Emitir socket
            const io = req.app.get('socketio');
            if (io) {
                io.emit('actualizado', { type: 'actualizacion' });
                io.emit('retiros:update', { type: 'nuevo_retiro', ordenId: OReIdOrdenRetiro, formaRetiro: 'RT' });
            }

            res.json({ success: true, data: { OReIdOrdenRetiro }, ordIdGenerada: ordIdRetiro });

        } catch (txErr) {
            try { await transaction.rollback(); } catch (e) { }
            throw txErr;
        }

    } catch (error) {
        logger.error("Error totem create pickup:", error);
        res.status(500).json({ success: false, error: "Error al crear retiro: " + error.message });
    }
};

// ===================================
// TOTEM: ANUNCIARSE CON ORDEN DE RETIRO (SIN AUTH)
// ===================================
exports.totemAnnounce = async (req, res) => {
    const { ordenRetiroNum } = req.body;

    if (!ordenRetiroNum) {
        return res.status(400).json({ success: false, message: 'Ingrese el número de orden de retiro.' });
    }

    try {
        const pool = await getPool();
        // Limpiar: aceptar "RT-123", "RW-123", "123", etc.
        const numericId = parseInt(String(ordenRetiroNum).replace(/^[A-Za-z\-]+/, '').trim(), 10);

        if (isNaN(numericId)) {
            return res.json({ success: false, message: 'Número de retiro inválido.' });
        }

        // Buscar la orden de retiro y el cliente
        const result = await pool.request()
            .input('retiroId', sql.Int, numericId)
            .query(`
                SELECT TOP 1
                    r.OReIdOrdenRetiro,
                    r.OReEstadoActual,
                    eor.EORNombreEstado AS EstadoNombre,
                    c.Nombre AS ClienteNombre,
                    c.NombreFantasia,
                    c.IDCliente,
                    c.TelefonoTrabajo
                FROM OrdenesRetiro r WITH(NOLOCK)
                LEFT JOIN EstadosOrdenesRetiro eor WITH(NOLOCK) ON eor.EORIdEstadoOrden = r.OReEstadoActual
                LEFT JOIN RelOrdenesRetiroOrdenes rel WITH(NOLOCK) ON rel.OReIdOrdenRetiro = r.OReIdOrdenRetiro
                LEFT JOIN OrdenesDeposito o WITH(NOLOCK) ON o.OrdIdOrden = rel.OrdIdOrden
                LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                WHERE r.OReIdOrdenRetiro = @retiroId
            `);

        if (!result.recordset.length) {
            return res.json({ success: false, message: 'Orden de retiro no encontrada.' });
        }

        const row = result.recordset[0];
        const clientName = row.NombreFantasia || row.ClienteNombre || 'Cliente';

        // Si la orden está asignada a un estante, sacarla para que aparezca en la columna de empaque
        const shelfCheck = await pool.request()
            .input('numId', sql.Int, numericId)
            .query(`
                SELECT TOP 1 OrdenRetiro, EstanteID, Seccion, Posicion
                FROM OcupacionEstantes WITH(NOLOCK)
                WHERE OrdenRetiro LIKE '%' + CAST(@numId AS VARCHAR)
            `);

        let removedFromShelf = false;
        if (shelfCheck.recordset.length > 0) {
            const shelfRow = shelfCheck.recordset[0];
            // Eliminar de OcupacionEstantes
            await pool.request()
                .input('ord', sql.VarChar(50), shelfRow.OrdenRetiro)
                .query('DELETE FROM OcupacionEstantes WHERE OrdenRetiro = @ord');
            removedFromShelf = true;
            logger.info(`[TOTEM] 📦 Orden ${shelfRow.OrdenRetiro} removida del estante ${shelfRow.EstanteID}-${shelfRow.Seccion}-${shelfRow.Posicion} por anuncio`);
        }

        // Emitir socket para notificar al panel de administración
        const io = req.app.get('socketio');
        if (io) {
            io.emit('totem:cliente-anunciado', {
                ordenRetiro: numericId,
                cliente: clientName,
                idCliente: row.IDCliente,
                telefono: row.TelefonoTrabajo,
                estado: row.EstadoNombre,
                removedFromShelf,
                timestamp: new Date().toISOString()
            });
            // Forzar refresco del panel de retiros para que la orden aparezca en las columnas
            if (removedFromShelf) {
                io.emit('retiros:update', { type: 'totem_anuncio', ordenRetiro: numericId });
            }
        }

        logger.info(`[TOTEM] 📢 Cliente anunciado: ${clientName} (Retiro #${numericId})`);

        res.json({
            success: true,
            client: clientName,
            ordenRetiro: numericId,
            estado: row.EstadoNombre
        });

    } catch (error) {
        logger.error("Error totem announce:", error);
        res.status(500).json({ success: false, message: "Error al anunciarse." });
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
    const { selectedOrderIds, orders, totalCost, clientName, moneda, direccion, departamento, localidad, agenciaId, customAgencia, receptorNombre } = req.body;

    if ((!selectedOrderIds || !selectedOrderIds.length) && (!orders || !orders.length)) {
        return res.status(400).json({ error: "No hay órdenes seleccionadas." });
    }

    try {
        const user = req.user;
        const codCliente = clientName || (user ? user.codCliente : null);
        if (!codCliente) return res.status(401).json({ error: "Usuario no identificado." });

        const pool = await getPool();
        const UsuarioAlta = user?.id || 70;
        // Resolver lugarRetiro: del body o del FormaEnvioID del cliente
        let lugarRetiro;
        if (req.body.lugarRetiro) {
            lugarRetiro = parseInt(req.body.lugarRetiro, 10);
        } else {
            try {
                const lugarRes = await pool.request()
                    .input('cod', sql.Int, parseInt(codCliente, 10) || 0)
                    .query('SELECT FormaEnvioID FROM Clientes WHERE CodCliente = @cod');
                lugarRetiro = lugarRes.recordset[0]?.FormaEnvioID || 5;
            } catch {
                lugarRetiro = 5;
            }
        }

        // Determinar las órdenes a incluir
        let rawOrderIds = [];
        if (orders && Array.isArray(orders) && orders.length > 0) {
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
                    SELECT o.OrdIdOrden, o.OrdCodigoOrden
                    FROM OrdenesDeposito o WITH(NOLOCK)
                    LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                    LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                    WHERE c.IDCliente = @idCliente
                    AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar')
                    AND o.OReIdOrdenRetiro IS NULL
                `);

            for (const o of ordersResult.recordset) {
                const docId = o.OrdCodigoOrden || `#${o.OrdIdOrden}`;
                if (selectedOrderIds.includes(docId) || selectedOrderIds.includes(o.OrdCodigoOrden) || selectedOrderIds.includes(o.OrdIdOrden)) {
                    rawOrderIds.push(o.OrdIdOrden);
                }
            }
        }

        if (rawOrderIds.length === 0) return res.status(400).json({ error: "Órdenes no encontradas." });

        // Crear retiro usando servicio unificado (el service determina el estado por tipo de cliente)
        const { crearRetiro } = require('../services/retiroService');
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        // Determinar moneda
        let targetCurrency = moneda || "UYU";
        if (!moneda && orders && orders.length > 0) {
            const firstCost = orders[0].costWithCurrency || '';
            if (firstCost.includes('USD') || firstCost.includes('U$S')) targetCurrency = 'USD';
        }

        try {
            const OReIdOrdenRetiro = await crearRetiro(transaction, {
                ordIds: rawOrderIds,
                totalCost: totalCost || 0,
                lugarRetiro,
                usuarioAlta: UsuarioAlta,
                formaRetiro: 'RW',
                codCliente: parseInt(codCliente, 10) || null,
                moneda: targetCurrency,
                direccion: direccion || null,
                departamento: departamento || null,
                localidad: localidad || null,
                agenciaId: agenciaId || null
            });

            await transaction.commit();

            // Si se eligió agencia "Otra", guardar el nombre custom
            if (customAgencia) {
                await pool.request()
                    .input('OReId', sql.Int, OReIdOrdenRetiro)
                    .input('AgenciaOtra', sql.NVarChar(200), customAgencia)
                    .query('UPDATE OrdenesRetiro SET AgenciaOtra = @AgenciaOtra WHERE OReIdOrdenRetiro = @OReId');
            }

            // Guardar nombre del receptor si es encomienda
            if (receptorNombre) {
                await pool.request()
                    .input('OReId', sql.Int, OReIdOrdenRetiro)
                    .input('Receptor', sql.NVarChar(200), receptorNombre)
                    .query('UPDATE OrdenesRetiro SET ReceptorNombre = @Receptor WHERE OReIdOrdenRetiro = @OReId');
            }

            const ordIdRetiro = `RW-${OReIdOrdenRetiro}`;

            // Emitir socket
            const io = req.app.get('socketio');
            if (io) {
                io.emit('actualizado', { type: 'actualizacion' });
                io.emit('retiros:update', { type: 'nuevo_retiro', ordenId: OReIdOrdenRetiro, formaRetiro: 'RW' });
            }

            res.json({ success: true, data: { OReIdOrdenRetiro }, ordIdGenerada: ordIdRetiro });

        } catch (txErr) {
            try { await transaction.rollback(); } catch (e) { }
            throw txErr;
        }

    } catch (error) {
        logger.error("Error creating pickup order:", error);
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
        logger.error("PDF Generate Error:", error);
        res.status(500).json({ error: "Error generando PDF" });
    }
};


// --- INIT HANDY PAYMENT (nuevo flujo: retiro se crea solo si el pago es exitoso) ---
exports.initHandyPayment = async (req, res) => {
    try {
        const {
            orders,          // [{ OrdIdOrden, orderNumber, desc, amount, currency }]
            totalAmount,
            activeCurrency,
            lugarRetiro,
            direccion,
            departamento,
            localidad,
            agenciaId,
            customAgencia,
            receptorNombre
        } = req.body;

        if (!orders || orders.length === 0) {
            return res.status(400).json({ error: 'No hay órdenes para pagar.' });
        }

        const currencyCode = activeCurrency === 'USD' ? 840 : 858;

        // Productos para Handy
        const products = orders.map(o => {
            const amt = Number(Number(o.amount || 0).toFixed(2));
            return {
                Name: (o.desc || o.orderNumber || 'Pedido').substring(0, 50),
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
                type: 'pickup-deferred',       // marca el nuevo flujo
                orders: orders.map(o => ({
                    id: o.orderNumber,
                    desc: o.desc || o.orderNumber || 'Pedido',
                    amount: o.amount,
                    rawId: o.OrdIdOrden        // necesario para crear el retiro
                })),
                ordIds: orders.map(o => o.OrdIdOrden).filter(Boolean),
                totalCost: totalAmount,
                lugarRetiro: lugarRetiro || 1,
                direccion: direccion || null,
                departamento: departamento || null,
                localidad: localidad || null,
                agenciaId: agenciaId || null,
                customAgencia: customAgencia || null,
                receptorNombre: receptorNombre || null,
                moneda: activeCurrency === 'USD' ? 'USD' : 'UYU'
            },
            codCliente: req.user?.codCliente || 0,
            logPrefix: '[HANDY INIT]'
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({ success: true, url: result.url, transactionId: result.transactionId });

    } catch (error) {
        const logger = require('../utils/logger');
        logger.error('[HANDY INIT] Error:', error.message);
        res.status(500).json({ error: 'Error al iniciar el pago.' });
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
        logger.error("[HANDY ERROR] Fallo al crear link de pago:", error.message);
        if (error.response) {
            logger.error("[HANDY DATA]", error.response.data);
            return res.status(500).json({ error: "Error desde Handy", details: error.response.data });
        }
        res.status(500).json({ error: "Error interno al intentar generar pago." });
    }
};

// --- ROLLBACK DE COBROS FALLIDOS ASÍNCRONOS ---
// Desvincula las órdenes, anula el pago con valor $0 y crea Ticket de HelpDesk
const performCheckoutRollback = async (pool, transactionId, ordenRetiroId, gatewayName, codCliente = null) => {
    try {
        const logger = require('../utils/logger');
        logger.info(`[ROLLBACK] Iniciando desvinculación para TX ${transactionId} (Retiro: ${ordenRetiroId}) desde ${gatewayName}`);

        // 1. Obtener la orden de retiro y su PagId
        const sql = require('mssql');
        const retiroRes = await pool.request()
            .input('RID', sql.Int, ordenRetiroId)
            .query('SELECT OReIdOrdenRetiro, PagIdPago FROM OrdenesRetiro WHERE OReIdOrdenRetiro = @RID');
        
        if (retiroRes.recordset.length === 0) {
            logger.warn(`[ROLLBACK] OrdenRetiro ${ordenRetiroId} no existe. Ignorando.`);
            return;
        }

        const retiro = retiroRes.recordset[0];
        const pagoId = retiro.PagIdPago;
        const realCodCliente = codCliente;

        if (!pagoId) {
            logger.warn(`[ROLLBACK] OrdenRetiro ${ordenRetiroId} no tiene PagIdPago asignado. Nada que revertir.`);
            return;
        }

        // Verificar que el pago a revertir es efectivamente de la pasarela que dispara el rollback.
        // Si el PagIdPago fue heredado de otro canal (ej: débito de caja), no lo tocamos.
        const pagMetodRes = await pool.request()
            .input('PagoIdChk', sql.Int, pagoId)
            .query('SELECT MPaIdMetodoPago FROM Pagos WITH(NOLOCK) WHERE PagIdPago = @PagoIdChk');
        const metodoDelPago = pagMetodRes.recordset[0]?.MPaIdMetodoPago;
        const esHandy = gatewayName === 'Handy' && metodoDelPago === 9;
        const esMercadoPago = gatewayName === 'MercadoPago' && metodoDelPago === 8;
        if (!esHandy && !esMercadoPago) {
            logger.warn(`[ROLLBACK] El PagIdPago ${pagoId} (método ${metodoDelPago}) no corresponde a ${gatewayName}. Rollback abortado para evitar anular un pago de otro canal.`);
            return;
        }

        const rollbackT = new sql.Transaction(pool);
        await rollbackT.begin();

        try {
            // A. Desvincular OrdenesHijas (OrdenesDeposito)
            const hijasResult = await rollbackT.request()
                .input('PagoId', sql.Int, pagoId)
                .query('SELECT OrdIdOrden FROM OrdenesDeposito WHERE PagIdPago = @PagoId');
            
            const hijasIds = hijasResult.recordset.map(r => r.OrdIdOrden);

            if (hijasIds.length > 0) {
                await rollbackT.request()
                    .input('PagoId', sql.Int, pagoId)
                    .query(`UPDATE OrdenesDeposito SET PagIdPago = NULL, OrdEstadoActual = 1, OrdFechaEstadoActual = GETDATE() WHERE OrdIdOrden IN (${hijasIds.join(',')})`);
                
                const histValues = hijasIds.map(id => `(${id}, 1, GETDATE(), 70)`).join(', ');
                await rollbackT.request().query(`INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES ${histValues}`);
            }

            // B. Desvincular Retiro
            await rollbackT.request()
                .input('RID', sql.Int, ordenRetiroId)
                .query(`UPDATE OrdenesRetiro SET PagIdPago = NULL, OReEstadoActual = 1, OReFechaEstadoActual = GETDATE() WHERE OReIdOrdenRetiro = @RID`);
            
            await rollbackT.request()
                .input('RID', sql.Int, ordenRetiroId)
                .query(`INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@RID, 1, GETDATE(), 70)`);

            // C. Anular Pago (Monto = 0) e identificar el recibo como nulo
            await rollbackT.request()
                .input('PagoId', sql.Int, pagoId)
                .query(`UPDATE Pagos SET PagMontoPago = 0, PagRutaComprobante = ISNULL(PagRutaComprobante, '') + ' - ANULADO-${gatewayName.toUpperCase()}' WHERE PagIdPago = @PagoId`);

            // D. Emitir Ticket de Alerta (HelpDesk)
            try {
                // Cabecera (DepId 2 = Finanzas/Contaduría)
                const asunto = `ALERTA FINANCIERA: Contracargo en Retiro RW-${ordenRetiroId}`;
                const tResult = await rollbackT.request()
                    .input('CliId', sql.Int, realCodCliente || null)
                    .input('DepId', sql.Int, 2)
                    .input('OrdId', sql.Int, ordenRetiroId)
                    .input('Asunto', sql.NVarChar(200), asunto)
                    .query(`
                        INSERT INTO Tickets (CliIdCliente, UsrIdCreador, DepIdDepartamento, OrdIdOrden, TicAsunto, TicPrioridad, TicEstado, TicFechaAlta, TicFechaActualizacion)
                        OUTPUT INSERTED.TicIdTicket
                        VALUES (@CliId, 70, @DepId, @OrdId, @Asunto, 1, 1, GETDATE(), GETDATE())
                    `);
                
                const ticketId = tResult.recordset[0].TicIdTicket;
                
                // Mensaje Oculto (Nota Interna)
                const txt = `El sistema detectó un contracargo o rechazo tardío de la pasarela de pagos ${gatewayName} para la transacción:\n${transactionId}\n\nSe han desvinculado los pagos de las órdenes y han vuelto al estado "A Ingresar / Adeudado".\nPor favor, verifique si el cliente retiró ya las órdenes e inicie una gestión de cobro manual.`;
                await rollbackT.request()
                    .input('TicId', sql.Int, ticketId)
                    .input('Txt', sql.NVarChar(sql.MAX), txt)
                    .query(`
                        INSERT INTO Tickets_Mensajes (TicIdTicket, UsrIdAutor, TMenEsNotaInterna, TMenTexto, TMenFecha)
                        VALUES (@TicId, 70, 1, @Txt, GETDATE())
                    `);
            } catch (ticketErr) {
                logger.error(`[ROLLBACK] Error creando ticket interno: ${ticketErr.message}`);
                // Si falla el ticket, igual committeamos el rollback contable
            }

            await rollbackT.commit();
            logger.info(`[ROLLBACK] ✅ Reversión contable completada. Se liberó y adeudó la orden RW-${ordenRetiroId}`);

        } catch (dbErr) {
            await rollbackT.rollback();
            logger.error(`[ROLLBACK] ❌ Error estructurado: ${dbErr.message}`);
        }
    } catch (e) {
        const logger = require('../utils/logger');
        logger.error(`[ROLLBACK] ❌ Error fatal: ${e.message}`);
    }
};

// --- HANDY WEBHOOK ---
// Recibe notificaciones automáticas de Handy cuando un cobro cambia de estado
// Docs V2.0: PurchaseData.Status → 0=Iniciado, 1=Exitoso, 2=Fallido, 3=Pendiente
exports.handyWebhook = async (req, res) => {
    const payload = req.body;

    logger.info("------------------------------------------");
    logger.info("🔔 [HANDY WEBHOOK] Evento recibido:");
    logger.info(JSON.stringify(payload, null, 2));
    logger.info("------------------------------------------");

    // Responder 200 inmediatamente (best practice para webhooks)
    res.status(200).send("OK");

    try {
        const transactionId = payload.TransactionExternalId;
        const status = payload.PurchaseData?.Status;
        const totalAmount = payload.PurchaseData?.TotalAmount;
        const currency = payload.PurchaseData?.Currency;
        const issuerName = payload.InstrumentData?.IssuerName || 'N/A';

        if (!transactionId) {
            logger.warn("[HANDY WEBHOOK] Evento sin TransactionExternalId, ignorado.");
            return;
        }

        logger.info(`[HANDY WEBHOOK] TxID: ${transactionId}, Status: ${status}, Monto: ${totalAmount}, Moneda: ${currency}, Medio: ${issuerName}`);

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
        logger.info(`[HANDY WEBHOOK] ${emoji[status] || '❓'} ${statusLabel} — ${result.rowsAffected[0]} fila(s) actualizadas.`);

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

                    logger.info('[HANDY WEBHOOK] Registrando pago directamente en DB...', JSON.stringify(payloadPago));

                    // NUEVO FLUJO: crear el retiro ahora si aún no existía
                    if (storedData.type === 'pickup-deferred' && !storedOrdenRetiro && storedData.ordIds?.length > 0) {
                        try {
                            logger.info('[HANDY WEBHOOK] Creando retiro diferido...');
                            const { crearRetiro } = require('../services/retiroService');
                            const retiroTransaction = new sql.Transaction(pool);
                            await retiroTransaction.begin();
                            const OReIdOrdenRetiro = await crearRetiro(retiroTransaction, {
                                ordIds:        storedData.ordIds,
                                totalCost:     storedData.totalCost || tx.TotalAmount,
                                lugarRetiro:   storedData.lugarRetiro || 1,
                                usuarioAlta:   70,
                                formaRetiro:   'RW',
                                codCliente:    tx.CodCliente || null,
                                moneda:        storedData.moneda || 'UYU',
                                direccion:     storedData.direccion || null,
                                departamento:  storedData.departamento || null,
                                localidad:     storedData.localidad || null,
                                agenciaId:     storedData.agenciaId || null
                            });
                            await retiroTransaction.commit();

                            const codigoRetiro = `RW-${OReIdOrdenRetiro}`;
                            logger.info(`[HANDY WEBHOOK] ✅ Retiro diferido creado: ${codigoRetiro}`);

                            // Guardar customAgencia si aplica
                            if (storedData.customAgencia) {
                                await pool.request()
                                    .input('OReId', sql.Int, OReIdOrdenRetiro)
                                    .input('AgenciaOtra', sql.NVarChar(200), storedData.customAgencia)
                                    .query('UPDATE OrdenesRetiro SET AgenciaOtra = @AgenciaOtra WHERE OReIdOrdenRetiro = @OReId');
                            }
                            if (storedData.receptorNombre) {
                                await pool.request()
                                    .input('OReId', sql.Int, OReIdOrdenRetiro)
                                    .input('Receptor', sql.NVarChar(200), storedData.receptorNombre)
                                    .query('UPDATE OrdenesRetiro SET ReceptorNombre = @Receptor WHERE OReIdOrdenRetiro = @OReId');
                            }

                            // Usar el nuevo retiro en el resto del flujo de pago
                            payloadPago.ordenRetiro = codigoRetiro;
                            orderNumbers = [OReIdOrdenRetiro];

                            // Notificar a PrintStation para que imprima automáticamente
                            const ioInst = req.app?.get('socketio');
                            if (ioInst) {
                                ioInst.emit('actualizado', { type: 'actualizacion' });
                                ioInst.emit('retiros:update', { type: 'nuevo_retiro', ordenId: OReIdOrdenRetiro, formaRetiro: 'RW' });
                                logger.info(`[HANDY WEBHOOK] 📡 Socket emitido para retiro diferido RW-${OReIdOrdenRetiro}`);
                            }

                            // Guardar código en HandyTransactions dentro del OrdersJson para que el polling lo encuentre
                            const updatedOrdersJson = JSON.stringify({
                                ...storedData,
                                ordenRetiro: codigoRetiro
                            });

                            await pool.request()
                                .input('txId3', sql.VarChar(100), transactionId)
                                .input('jsonStr', sql.NVarChar(sql.MAX), updatedOrdersJson)
                                .input('codigoRetiro', sql.VarChar(20), codigoRetiro)
                                .query('UPDATE HandyTransactions SET OrdersJson = @jsonStr, OrdenRetiroCreada = @codigoRetiro WHERE TransactionId = @txId3');
                        } catch (retiroErr) {
                            if (retiroTransaction) {
                                try { await retiroTransaction.rollback(); } catch (e) { /* ignore */ }
                            }
                            logger.error('[HANDY WEBHOOK] Error creando retiro diferido — se aborta el flujo de pago para evitar registrar un pago sin retiro confirmado:', retiroErr.message);
                            return res.status(200).json({ received: true, warning: 'retiro_deferred_failed' });
                        }
                    }

                    // --- FLUJO DE PAGO UNIFICADO (igual que Caja) ---
                    const ordenRetiroId = parseInt(String(payloadPago.ordenRetiro).replace(/^[A-Za-z]+-0*/, ''), 10);
                    if (!isNaN(ordenRetiroId)) {
                        const retiroState = await pool.request()
                            .input('RID', sql.Int, ordenRetiroId)
                            .query('SELECT OReEstadoActual, PagIdPago FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @RID');

                        if (retiroState.recordset.length > 0 && retiroState.recordset[0].PagIdPago) {
                            const existingPagId = retiroState.recordset[0].PagIdPago;
                            const pagMetodRes = await pool.request()
                                .input('PagId', sql.Int, existingPagId)
                                .query('SELECT MPaIdMetodoPago FROM Pagos WITH(NOLOCK) WHERE PagIdPago = @PagId');
                            const metodoExistente = pagMetodRes.recordset[0]?.MPaIdMetodoPago;
                            if (metodoExistente === 9) {
                                logger.info(`[HANDY WEBHOOK] La orden de retiro ${ordenRetiroId} ya tiene un pago Handy asignado (PagIdPago: ${existingPagId}). Ignorando webhook duplicado de pago exitoso.`);
                                return;
                            }
                            logger.warn(`[HANDY WEBHOOK] La orden de retiro ${ordenRetiroId} tiene PagIdPago ${existingPagId} de método ${metodoExistente} (no Handy). Se registra el pago Handy de todas formas.`);
                        }

                        const usuarioId = 70;
                        const monedaId  = tx.Currency === 840 ? 2 : 1;
                        const moneda    = monedaId === 2 ? 'USD' : 'UYU';

                        // Resolver CliIdCliente desde CodCliente
                        const cliRes = await pool.request()
                            .input('CodCli', sql.Int, tx.CodCliente)
                            .query('SELECT CliIdCliente FROM Clientes WITH(NOLOCK) WHERE CodCliente = @CodCli');
                        const CliIdCliente = cliRes.recordset[0]?.CliIdCliente;

                        // ── Pago unificado a través de cajaService (Caja Administrativa online) ──
                        // usuarioId=999 identifica pagos online automáticos;
                        // esAdministrativa=true fuerza StuIdSesion=NULL (sin sesión de cajero).
                        // cajaService resuelve solo las órdenes hijas y cruza DeudaDocumento exacto.
                        const { procesarTransaccion } = require('../services/cajaService');
                        const result = await procesarTransaccion({
                            usuarioId: 999,
                            header: {
                                clienteId:        CliIdCliente,
                                esAdministrativa:  true,
                                tipoDocumento:     '07',   // E-Ticket Contado
                                moneda,
                                observaciones:     `Cobro Handy (Tx: ${transactionId})`,
                            },
                            aplicaciones: [{
                                tipo:           'ORDEN_RETIRO',
                                referenciaId:   ordenRetiroId,
                                montoOriginal:  tx.TotalAmount,
                                descripcion:    `Retiro diferido RW-${ordenRetiroId}`,
                                // orderNumbers vacío → cajaService los descubre solo en BD
                            }],
                            pagos: [{
                                metodoPagoId:  9,   // Handy
                                monedaId,
                                moneda,
                                montoOriginal: tx.TotalAmount,
                                cotizacion:    1,
                            }],
                        });

                        const pagoId = result.pagosCreados[0]?.pagIdPago;
                        logger.info(`[HANDY WEBHOOK] ✅ Pago procesado vía Caja: PagoId=${pagoId} TcaId=${result.tcaIdTransaccion} Retiro=${ordenRetiroId}`);



                        // Generar comprobante PDF y guardarlo en disco
                        generateHandyReceipt({
                            transactionId,
                            ordenRetiro: payloadPago.ordenRetiro, // código final: ya incluye el RW- del retiro diferido si aplica
                            orders,
                            totalAmount: tx.TotalAmount,
                            currency: tx.Currency,
                            currencySymbol: tx.Currency === 840 ? 'US$' : '$',
                            paymentMethod: issuerName,
                            paidAt: new Date(),
                            codCliente: tx.CodCliente
                        }).then(async (filePath) => {
                            if (filePath) {
                                // Vincular la ruta en Pagos usando solo el nombre del archivo para que el frontend lo levante
                                const fileNameToSave = path.basename(filePath);
                                await pool.request()
                                    .input('PagoId', sql.Int, pagoId)
                                    .input('Ruta', sql.VarChar, fileNameToSave)
                                    .query(`UPDATE Pagos SET PagRutaComprobante = @Ruta WHERE PagIdPago = @PagoId`);
                                logger.info(`[HANDY WEBHOOK] Comprobante guardado en BD: ${fileNameToSave}`);
                            }
                        }).catch(e => logger.error('[HANDY WEBHOOK] Error guardando comprobante:', e.message));
                    } else {
                        logger.warn('[HANDY WEBHOOK] No se pudo parsear ordenRetiroId:', payloadPago.ordenRetiro);
                    }

                } else {
                    logger.warn(`[HANDY WEBHOOK] No se encontró transacción ${transactionId} en HandyTransactions`);
                }
            } catch (reactErr) {
                logger.error('[HANDY WEBHOOK] Error notificando a API React:', reactErr.response?.data || reactErr.message);
            }
        } else if (status === 2 || status === 5) {
            // --- ROLLBACK DE OPERACIONES: ESTADO CAYÓ A FALLIDO (CONTRACARGO O RECHAZO TARDÍO) ---
            try {
                const txData = await pool.request()
                    .input('txIdRb', sql.VarChar(100), transactionId)
                    .query('SELECT OrdersJson, CodCliente, PaidAt FROM HandyTransactions WHERE TransactionId = @txIdRb');
                
                if (txData.recordset.length > 0) {
                    const tx = txData.recordset[0];
                    // Si PaidAt NO es nulo, significa que ANTES fue pagado. (Gatilla el rollback)
                    if (tx.PaidAt) {
                        const storedData = JSON.parse(tx.OrdersJson || '{}');
                        const storedOrdenRetiro = storedData.ordenRetiro;
                        const ordenRetiroId = parseInt(String(storedOrdenRetiro || '').replace(/^[A-Za-z]+-0*/, ''), 10);
                        if (!isNaN(ordenRetiroId)) {
                            await performCheckoutRollback(pool, transactionId, ordenRetiroId, 'Handy', tx.CodCliente);
                        }
                    }
                }
            } catch(e) {
                logger.error('[HANDY WEBHOOK ROLLBACK ERROR]', e.message);
            }
        }

    } catch (e) {
        logger.error("[HANDY WEBHOOK] Error procesando evento:", e.message);
    }
};

// --- PAYMENT STATUS ---
// Consultar el estado de un pago por TransactionId (para la página de resultado)
// Busca en HandyTransactions primero, luego en MercadoPagoTransactions
exports.getPaymentStatus = async (req, res) => {
    try {
        const { transactionId } = req.params;
        if (!transactionId) return res.status(400).json({ error: 'TransactionId requerido' });

        const pool = await getPool();

        // --- Buscar en Handy primero ---
        const handyResult = await pool.request()
            .input('txId', sql.VarChar(100), transactionId)
            .query('SELECT TransactionId, TotalAmount, Currency, OrdersJson, Status, IssuerName, CreatedAt, PaidAt FROM HandyTransactions WHERE TransactionId = @txId');

        if (handyResult.recordset.length > 0) {
            const tx = handyResult.recordset[0];
            const storedData = JSON.parse(tx.OrdersJson || '{}');
            const orders = storedData.orders || (Array.isArray(storedData) ? storedData : []);
            return res.json({
                transactionId: tx.TransactionId,
                status: tx.Status,
                totalAmount: tx.TotalAmount,
                currency: tx.Currency === 840 ? 'USD' : 'UYU',
                currencySymbol: tx.Currency === 840 ? 'US$' : '$',
                ordenRetiro: storedData.ordenRetiro || null,
                orders: orders.map(o => ({ id: o.id, desc: o.desc, amount: o.amount })),
                paymentMethod: tx.IssuerName || 'Handy',
                gateway: 'handy',
                createdAt: tx.CreatedAt,
                paidAt: tx.PaidAt
            });
        }

        // --- Buscar en MercadoPago ---
        const mpResult = await pool.request()
            .input('txId2', sql.VarChar(100), transactionId)
            .query('SELECT TransactionId, OrdersJson, Status, CreatedAt, PaidAt FROM MercadoPagoTransactions WHERE TransactionId = @txId2');

        if (mpResult.recordset.length > 0) {
            const tx = mpResult.recordset[0];
            const storedData = JSON.parse(tx.OrdersJson || '{}');
            const orders = storedData.orders || [];

            // Normalizar estados de MP al formato de la UI
            const mpStatusMap = {
                'approved':   'Pagado',
                'pending':    'Pendiente',
                'in_process': 'Pendiente',
                'rejected':   'Fallido',
                'cancelled':  'Fallido'
            };
            const uiStatus = mpStatusMap[tx.Status] || 'Creado';

            // Moneda: vienen del payload original
            const currency = storedData.moneda || 'UYU';

            return res.json({
                transactionId: tx.TransactionId,
                status: uiStatus,
                totalAmount: storedData.totalCost || 0,
                currency: currency,
                currencySymbol: currency === 'USD' ? 'US$' : '$',
                ordenRetiro: storedData.ordenRetiro || null,
                orders: orders.map(o => ({ id: o.id, desc: o.desc, amount: o.amount })),
                paymentMethod: 'MercadoPago',
                gateway: 'mp',
                createdAt: tx.CreatedAt,
                paidAt: tx.PaidAt
            });
        }

        return res.status(404).json({ error: 'Transacción no encontrada' });

    } catch (e) {
        logger.error('[PAYMENT STATUS] Error:', e.message);
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

        logger.info(`[HANDY REFUND] Solicitando devolución (${isProduction ? 'PRODUCCIÓN' : 'TESTING'})...`);
        logger.info("[HANDY REFUND] Payload:", JSON.stringify(refundPayload));

        const response = await axios.delete(handyUrl, {
            headers: {
                'merchant-secret-key': handySecret,
                'Content-Type': 'application/json'
            },
            data: refundPayload
        });

        logger.info("[HANDY REFUND] Respuesta:", JSON.stringify(response.data));

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
        logger.error("[HANDY REFUND ERROR]", error.message);
        if (error.response) {
            logger.error("[HANDY REFUND DATA]", error.response.data);
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

    logger.info("------------------------------------------");
    logger.info("🔔 [HANDY REFUND WEBHOOK] Evento recibido:");
    logger.info(JSON.stringify(payload, null, 2));
    logger.info("------------------------------------------");

    // Responder 200 inmediatamente
    res.status(200).send("OK");

    try {
        const transactionId = payload.TransactionExternalId;

        if (!transactionId) {
            logger.warn("[HANDY REFUND WEBHOOK] Evento sin TransactionExternalId, ignorado.");
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
        logger.info(`[HANDY REFUND WEBHOOK] ${emoji} ${statusLabel} — ${result.rowsAffected[0]} fila(s) actualizadas.`);

    } catch (e) {
        logger.error("[HANDY REFUND WEBHOOK] Error procesando evento:", e.message);
    }
};

// ══════════════════════════════════════════════════════════════
// ─── MERCADOPAGO ───────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

// --- MP INIT PAYMENT ---
// Genera una preferencia de MercadoPago y devuelve el init_point para redirigir al cliente
exports.initMpPayment = async (req, res) => {
    try {
        const {
            orders,
            totalAmount,
            activeCurrency,
            lugarRetiro,
            direccion,
            departamento,
            localidad,
            agenciaId,
            customAgencia,
            receptorNombre
        } = req.body;

        if (!orders || orders.length === 0) {
            return res.status(400).json({ error: 'No hay órdenes para pagar.' });
        }

        const currency = activeCurrency === 'USD' ? 'USD' : 'UYU';

        const items = orders.map(o => ({
            id: String(o.OrdIdOrden || o.id || ''),
            title: (o.desc || o.orderNumber || 'Pedido').substring(0, 256),
            quantity: 1,
            unit_price: Number(Number(o.amount || 0).toFixed(2)),
            currency_id: currency
        }));

        const { createPreference } = require('../services/mercadoPagoService');
        const result = await createPreference({
            items,
            totalAmount,
            currency,
            commerceName: 'USER',
            ordersData: {
                type: 'pickup-deferred',
                orders: orders.map(o => ({
                    id: o.orderNumber,
                    desc: o.desc || o.orderNumber || 'Pedido',
                    amount: o.amount,
                    rawId: o.OrdIdOrden
                })),
                ordIds: orders.map(o => o.OrdIdOrden).filter(Boolean),
                totalCost: totalAmount,
                lugarRetiro: lugarRetiro || 1,
                direccion: direccion || null,
                departamento: departamento || null,
                localidad: localidad || null,
                agenciaId: agenciaId || null,
                customAgencia: customAgencia || null,
                receptorNombre: receptorNombre || null,
                moneda: currency
            },
            codCliente: req.user?.codCliente || 0,
            logPrefix: '[MP INIT]'
        });

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({ success: true, url: result.url, transactionId: result.transactionId });

    } catch (error) {
        logger.error('[MP INIT] Error:', error.message);
        res.status(500).json({ error: 'Error al iniciar el pago con MercadoPago.' });
    }
};

// --- MP WEBHOOK ---
// Recibe notificaciones de MercadoPago sobre cambios de estado de pago
// MP envía: { action: "payment.created" | "payment.updated", data: { id: "payment_id" } }
exports.mpWebhook = async (req, res) => {
    const body = req.body;

    // ── Validación de firma HMAC-SHA256 ──────────────────────────────
    const crypto = require('crypto');
    const xSignature  = req.headers['x-signature']  || '';
    const xRequestId  = req.headers['x-request-id'] || '';
    const webhookSecret = process.env.MP_WEBHOOK_SECRET;

    // Diferenciar IPN antiguo vs Webhook moderno
    const isIPN = !!req.query.topic;

    if (isIPN) {
        logger.info(`[MP WEBHOOK] Recibida notificación IPN (topic: ${req.query.topic}). Saltando validación de firma para consultar la API directamente.`);
    } else if (webhookSecret) {
        if (!xSignature) {
            logger.warn('[MP WEBHOOK] ⚠️ Falta el header x-signature en Webhook. Request rechazado.');
            return res.status(403).send('Missing signature');
        }

        try {
            const parts = xSignature.split(',').map(p => p.trim());
            const ts  = parts.find(p => p.startsWith('ts='))?.slice(3) || '';
            const v1  = parts.find(p => p.startsWith('v1='))?.slice(3) || '';
            const dataId = String(req.query['data.id'] || req.query.id || body?.data?.id || body?.id || '');
            const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
            const computed = crypto.createHmac('sha256', webhookSecret.trim()).update(manifest).digest('hex');

            const valid = v1.length === 64 && computed.length === 64 && crypto.timingSafeEqual(
                Buffer.from(v1, 'hex'),
                Buffer.from(computed, 'hex')
            );

            if (!valid) {
                logger.warn('[MP WEBHOOK] ⚠️  Firma inválida — request rechazado.');
                logger.info(`[MP DEBUG] ts="${ts}" v1="${v1.substring(0,8)}..." computed="${computed.substring(0,8)}..." manifest="${manifest}"`);
                return res.status(403).send('Invalid signature');
            }
        } catch (sigErr) {
            logger.warn('[MP WEBHOOK] Error validando firma:', sigErr.message);
            return res.status(403).send('Signature validation error');
        }
    } else {
        logger.warn('[MP WEBHOOK] MP_WEBHOOK_SECRET no configurado — saltando validación de firma.');
    }
    // ────────────────────────────────────────────────────────────────

    // Responder 200 inmediatamente (requisito de MP — tiene timeout de 22s)
    res.status(200).send('OK');

    logger.info('------------------------------------------');
    logger.info('🔔 [MP WEBHOOK] Evento recibido:');
    logger.info(JSON.stringify(body, null, 2));
    logger.info('------------------------------------------');

    try {
        const action = body.action || req.query.topic;
        
        // En webhooks modernos viene en body.data.id, en IPN viene en req.query.id
        const paymentId = body.data?.id || req.query['data.id'] || req.query.id;

        // Solo nos interesan los eventos de pago. Los merchant_order los ignoramos limpiamente.
        if (req.query.topic === 'merchant_order' || action === 'merchant_order') {
            logger.info('[MP WEBHOOK] Ignorando evento merchant_order (solo procesamos pagos).');
            return;
        }

        if (!paymentId) {
            logger.warn('[MP WEBHOOK] Evento sin paymentId (ni data.id ni query.id), ignorado.');
            return;
        }


        // Consultar el estado real del pago a la API de MP (no confiar ciegamente en el webhook)
        const accessToken = process.env.MP_ACCESS_TOKEN;
        const { default: axios } = require('axios');
        let paymentData;
        try {
            const mpResponse = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            paymentData = mpResponse.data;
        } catch (mpErr) {
            logger.error(`[MP WEBHOOK] Error consultando pago ${paymentId}:`, mpErr.message);
            return;
        }

        const mpStatus = paymentData.status; // "approved", "rejected", "pending", "in_process"
        const externalRef = paymentData.external_reference; // nuestro transactionId

        logger.info(`[MP WEBHOOK] PaymentId: ${paymentId}, Status: ${mpStatus}, ExternalRef: ${externalRef}`);

        if (!externalRef) {
            logger.warn('[MP WEBHOOK] external_reference vacío, no se puede reconciliar.');
            return;
        }

        const pool = await getPool();

        // Actualizar estado en MercadoPagoTransactions.
        // OUTPUT DELETED.PaidAt permite detectar atómicamente si este webhook es el PRIMERO
        // en procesar este pago. Si DELETED.PaidAt ya tenía valor → otro webhook ya lo procesó → abort.
        // Esto resuelve la race condition entre IPN y Webhook moderno de MP que llegan simultáneos.
        const updateResult = await pool.request()
            .input('txId',   sql.VarChar(100), externalRef)
            .input('status', sql.VarChar(50),  mpStatus)
            .input('mpId',   sql.VarChar(100), String(paymentId))
            .query(`
                UPDATE MercadoPagoTransactions
                SET Status = @status, PaymentId = @mpId,
                    PaidAt = CASE WHEN @status = 'approved' THEN GETDATE() ELSE PaidAt END,
                    WebhookReceivedAt = GETDATE()
                OUTPUT DELETED.PaidAt AS OldPaidAt
                WHERE TransactionId = @txId
            `);

        const oldPaidAt = updateResult.recordset[0]?.OldPaidAt ?? null;

        // Si ya tenía PaidAt → este es un webhook duplicado (IPN + Webhook moderno del mismo pago)
        if (mpStatus === 'approved' && oldPaidAt !== null) {
            logger.warn(`[MP WEBHOOK] ⚠️ Pago ${externalRef} ya fue procesado anteriormente (PaidAt: ${oldPaidAt}). Webhook duplicado ignorado.`);
            return;
        }

        logger.info(`[MP WEBHOOK] Estado actualizado a "${mpStatus}" para TX ${externalRef}`);

        // Solo asentar el pago en el sistema si está aprobado
        if (mpStatus !== 'approved') {
            logger.info(`[MP WEBHOOK] Estado "${mpStatus}" no requiere acción de pago.`);
            
            // --- ROLLBACK SI SE RECHAZÓ O CONTRACARGÓ POST-PAGO ---
            if (mpStatus === 'rejected' || mpStatus === 'refunded' || mpStatus === 'cancelled' || mpStatus === 'charged_back') {
                try {
                    const txData = await pool.request()
                        .input('txIdRb', sql.VarChar(100), externalRef)
                        .query('SELECT OrdersJson, CodCliente, PaidAt FROM MercadoPagoTransactions WHERE TransactionId = @txIdRb');
                    
                    if (txData.recordset.length > 0) {
                        const tx = txData.recordset[0];
                        if (tx.PaidAt) {
                            const storedData = JSON.parse(tx.OrdersJson || '{}');
                            const storedOrdenRetiro = storedData.ordenRetiro;
                            const ordenRetiroId = parseInt(String(storedOrdenRetiro || '').replace(/^[A-Za-z]+-0*/, ''), 10);
                            if (!isNaN(ordenRetiroId)) {
                                await performCheckoutRollback(pool, externalRef, ordenRetiroId, 'MercadoPago', tx.CodCliente);
                            }
                        }
                    }
                } catch(e) {
                    logger.error('[MP WEBHOOK ROLLBACK ERROR]', e.message);
                }
            }
            return;
        }

        // Obtener datos de la transacción para saber qué órdenes se pagaron
        const txData = await pool.request()
            .input('txId2', sql.VarChar(100), externalRef)
            .query('SELECT OrdersJson, CodCliente FROM MercadoPagoTransactions WHERE TransactionId = @txId2');

        if (txData.recordset.length === 0) {
            logger.warn(`[MP WEBHOOK] TransactionId ${externalRef} no encontrado en MercadoPagoTransactions`);
            return;
        }

        const tx = txData.recordset[0];
        const storedData = JSON.parse(tx.OrdersJson || '{}');

        const totalAmountPaid = paymentData.transaction_amount;
        // Moneda: UYU=1, USD=2
        const currencyCode = (paymentData.currency_id === 'USD') ? 2 : 1;
        const orders = storedData.orders || [];
        let storedOrdenRetiro = storedData.ordenRetiro;

        // Crear el retiro diferido si aún no existe (mismo flujo que Handy)
        if (storedData.type === 'pickup-deferred' && !storedOrdenRetiro && storedData.ordIds?.length > 0) {
            try {
                logger.info('[MP WEBHOOK] Creando retiro diferido...');
                const { crearRetiro } = require('../services/retiroService');
                const retiroTransaction = new sql.Transaction(pool);
                await retiroTransaction.begin();
                const OReIdOrdenRetiro = await crearRetiro(retiroTransaction, {
                    ordIds:       storedData.ordIds,
                    totalCost:    storedData.totalCost || totalAmountPaid,
                    lugarRetiro:  storedData.lugarRetiro || 1,
                    usuarioAlta:  70,
                    formaRetiro:  'RW',
                    codCliente:   tx.CodCliente || null,
                    moneda:       storedData.moneda || 'UYU',
                    direccion:    storedData.direccion || null,
                    departamento: storedData.departamento || null,
                    localidad:    storedData.localidad || null,
                    agenciaId:    storedData.agenciaId || null
                });
                await retiroTransaction.commit();

                storedOrdenRetiro = `RW-${OReIdOrdenRetiro}`;
                logger.info(`[MP WEBHOOK] ✅ Retiro diferido creado: ${storedOrdenRetiro}`);

                if (storedData.customAgencia) {
                    await pool.request()
                        .input('OReId', sql.Int, OReIdOrdenRetiro)
                        .input('AgenciaOtra', sql.NVarChar(200), storedData.customAgencia)
                        .query('UPDATE OrdenesRetiro SET AgenciaOtra = @AgenciaOtra WHERE OReIdOrdenRetiro = @OReId');
                }
                if (storedData.receptorNombre) {
                    await pool.request()
                        .input('OReId', sql.Int, OReIdOrdenRetiro)
                        .input('Receptor', sql.NVarChar(200), storedData.receptorNombre)
                        .query('UPDATE OrdenesRetiro SET ReceptorNombre = @Receptor WHERE OReIdOrdenRetiro = @OReId');
                }

                // Guardar la referencia al retiro en la tabla de MP
                await pool.request()
                    .input('txId3', sql.VarChar(100), externalRef)
                    .input('jsonStr', sql.NVarChar(sql.MAX), JSON.stringify({ ...storedData, ordenRetiro: storedOrdenRetiro }))
                    .query('UPDATE MercadoPagoTransactions SET OrdersJson = @jsonStr WHERE TransactionId = @txId3');

                // Notificar a PrintStation
                const ioInst = req.app?.get('socketio');
                if (ioInst) {
                    ioInst.emit('actualizado', { type: 'actualizacion' });
                    ioInst.emit('retiros:update', { type: 'nuevo_retiro', ordenId: OReIdOrdenRetiro, formaRetiro: 'RW' });
                }
            } catch (retiroErr) {
                logger.error('[MP WEBHOOK] Error creando retiro diferido:', retiroErr.message);
                return;
            }
        }

        // ── FLUJO DE PAGO UNIFICADO (igual que Caja) ──────────────────────────
        const ordenRetiroId = parseInt(String(storedOrdenRetiro || '').replace(/^[A-Za-z]+-0*/,''), 10);
        if (isNaN(ordenRetiroId)) {
            logger.warn('[MP WEBHOOK] No se pudo parsear ordenRetiroId:', storedOrdenRetiro);
            return;
        }

        // Guard de idempotencia
        const retiroState = await pool.request()
            .input('RID', sql.Int, ordenRetiroId)
            .query('SELECT OReEstadoActual, PagIdPago FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @RID');
        if (retiroState.recordset[0]?.PagIdPago) {
            logger.warn(`[MP WEBHOOK] Retiro ${ordenRetiroId} ya pagado. Ignorando duplicado.`);
            return;
        }

        const usuarioId = 70;
        const moneda    = paymentData.currency_id === 'USD' ? 'USD' : 'UYU';
        const monedaId  = moneda === 'USD' ? 2 : 1;

        // Resolver CliIdCliente
        const cliRes2 = await pool.request()
            .input('CodCli', sql.Int, tx.CodCliente)
            .query('SELECT CliIdCliente FROM Clientes WITH(NOLOCK) WHERE CodCliente = @CodCli');
        const CliIdCliente = cliRes2.recordset[0]?.CliIdCliente;

        // ── Pago unificado a través de cajaService (Caja Administrativa online) ──
        const { procesarTransaccion } = require('../services/cajaService');
        const mpResult = await procesarTransaccion({
            usuarioId: 999,
            header: {
                clienteId:        CliIdCliente,
                esAdministrativa:  true,
                tipoDocumento:     '07',   // E-Ticket Contado
                moneda,
                observaciones:     `Cobro MercadoPago (Tx: ${externalRef})`,
            },
            aplicaciones: [{
                tipo:           'ORDEN_RETIRO',
                referenciaId:   ordenRetiroId,
                montoOriginal:  totalAmountPaid,
                descripcion:    `Retiro diferido RW-${ordenRetiroId}`,
                // orderNumbers vacío → cajaService los descubre solo en BD
            }],
            pagos: [{
                metodoPagoId:  10,  // MercadoPago
                monedaId,
                moneda,
                montoOriginal: totalAmountPaid,
                cotizacion:    1,
            }],
        });

        const pagoId = mpResult.pagosCreados[0]?.pagIdPago;
        logger.info(`[MP WEBHOOK] ✅ Pago procesado vía Caja: PagoId=${pagoId} TcaId=${mpResult.tcaIdTransaccion} Retiro=${ordenRetiroId}`);

        // Guardar también ReferenciaPagoOnline en OrdenesRetiro
        await pool.request()
            .input('RID', sql.Int, ordenRetiroId)
            .input('Ref', sql.VarChar(200), externalRef)
            .query(`UPDATE OrdenesRetiro SET ReferenciaPagoOnline = @Ref WHERE OReIdOrdenRetiro = @RID`);



        // Generar comprobante PDF (igual que Handy)
        const originalCurrCode = storedData.moneda === 'USD' ? 840 : 858;
        const mpCurrCode = paymentData.currency_id === 'USD' ? 840 : 858;

        generateHandyReceipt({
            transactionId: externalRef,
            ordenRetiro:   `RW-${ordenRetiroId}`,
            orders:        orders.map(o => ({ id: o.id, desc: o.desc, amount: o.amount })),
            totalAmount:   storedData.totalCost || totalAmountPaid,
            currency:      originalCurrCode,
            currencySymbol: storedData.moneda === 'USD' ? 'US$' : '$',
            convertedTotalAmount: totalAmountPaid,
            convertedCurrency: mpCurrCode,
            convertedCurrencySymbol: paymentData.currency_id === 'USD' ? 'US$' : '$',
            paymentMethod: 'MercadoPago',
            paidAt:        new Date(),
            codCliente:    tx.CodCliente || 0
        }).then(async (filePath) => {
            if (filePath) {
                const fileNameToSave = path.basename(filePath);
                await pool.request()
                    .input('PagoId', sql.Int, pagoId)
                    .input('Ruta',   sql.VarChar, fileNameToSave)
                    .query('UPDATE Pagos SET PagRutaComprobante = @Ruta WHERE PagIdPago = @PagoId');
                logger.info(`[MP WEBHOOK] Comprobante guardado: ${fileNameToSave}`);
            }
        }).catch(e => logger.error('[MP WEBHOOK] Error generando comprobante:', e.message));

    } catch (e) {
        logger.error('[MP WEBHOOK] Error procesando evento:', e.message);
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
                SELECT CliIdCliente, FormaEnvioID, AgenciaID, Nombre,
                       ISNULL(DireccionTrabajo, '') AS CliDireccion
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
        logger.error("Error en getShippingData:", err.message);
        res.status(500).json({ error: "Error al obtener datos de envío." });
    }
};

// --- ACTUALIZAR DATOS DE ENVÍO DE UN RETIRO ---
exports.updatePickupShipping = async (req, res) => {
    try {
        const OReId = parseInt(req.params.id, 10);
        if (isNaN(OReId)) return res.status(400).json({ error: "ID de retiro inválido." });

        const { lugarRetiro, agenciaId, customAgencia, direccion, departamento, localidad } = req.body;

        const pool = await getPool();
        await pool.request()
            .input('OReId', sql.Int, OReId)
            .input('Lugar', sql.Int, lugarRetiro || 5)
            .input('Dir', sql.NVarChar(500), direccion || null)
            .input('Depto', sql.NVarChar(200), departamento || null)
            .input('Loc', sql.NVarChar(200), localidad || null)
            .input('Agencia', sql.Int, agenciaId || null)
            .input('AgenciaOtra', sql.NVarChar(200), customAgencia || null)
            .query(`
                UPDATE OrdenesRetiro SET 
                    LReIdLugarRetiro = @Lugar,
                    DireccionEnvio = @Dir,
                    DepartamentoEnvio = @Depto,
                    LocalidadEnvio = @Loc,
                    AgenciaEnvio = @Agencia,
                    AgenciaOtra = @AgenciaOtra
                WHERE OReIdOrdenRetiro = @OReId
            `);

        res.json({ success: true, message: 'Datos de envío actualizados.' });
    } catch (err) {
        logger.error("Error en updatePickupShipping:", err.message);
        res.status(500).json({ error: "Error al actualizar datos de envío." });
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
        logger.error("Error en saveAddress:", err.message);
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
        logger.error("Error en deleteAddress:", err.message);
        res.status(500).json({ error: "Error al eliminar dirección." });
    }
};
