const { sql, getPool } = require('../config/db');
const driveService = require('../services/driveService');
const axios = require('axios');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const contabilidadService = require('../services/contabilidadService');
const ERPSyncService = require('../services/erpSyncService');
const { generateThumbnail } = require('../utils/thumbnailGenerator');
const { construirNombreArchivo, materialParaNombre, usaNombreNuevo } = require('../utils/nombreArchivoOrden');
const { marcarRequisitoNoAplica } = require('../utils/requisitosAutoCumplimiento');

// Ubicación de una terminación en texto legible para la NOTA que lee producción.
// Acepta las canónicas ('PERIMETRO') y las combinaciones libres ('ARRIBA,IZQUIERDA').
const UBI_TEXTO = {
    ARRIBA: 'arriba', ABAJO: 'abajo', ARRIBA_ABAJO: 'arriba y abajo',
    IZQUIERDA: 'izquierda', DERECHA: 'derecha',
    COSTADOS: 'ambos costados', PERIMETRO: 'todo el perímetro',
};
const etiquetaUbicacion = (ubi) => {
    const v = String(ubi || '').trim();
    if (!v) return '';
    if (UBI_TEXTO[v]) return UBI_TEXTO[v];
    return v.split(',').map(p => UBI_TEXTO[p.trim()] || p.trim().toLowerCase()).join(' + ');
};


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
// TOTEM: VERIFICAR AUTORIZACIÓN (SIN AUTH)
// ===================================
// Valida el TOKEN DE DISPOSITIVO, no la IP: el local dejó de tener IP fija. Esta ruta NO lleva
// el middleware totemAuth a propósito — tiene que poder responder { authorized: false } para que
// el tótem muestre la pantalla de bloqueo, en vez de cortar con un 401.
exports.totemVerify = (req, res) => {
    const { totemTokenOk } = require('../middleware/totemAuth');
    const authorized = totemTokenOk(req);
    if (!authorized) logger.warn(`[TOTEM] Verify rechazado (token ausente o inválido) desde ${req.ip}`);
    res.json({ authorized });
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
        especificacionesCorte, lineas, archivosReferencia, archivosTecnicos, serviciosExtras,
        bobinaId,  // TELA CLIENTE: BobinaID seleccionada por el usuario
        magnitud,  // TELA CLIENTE: metros del pedido a descontar de la bobina (top-level en el payload)
        tinta      // ECOUV: tinta de impresión (Ecosolvente/UV) — rutea el lote a la máquina
    } = req.body;

    // Mapeo inverso para compatibilidad
    // Soporte para Payroads en Español (Renombrado técnico solicitado por usuario)
    // `idServicioBase` es la clave que manda el PORTAL (OrderForm/PrendaOrderForm); `idServicio` y
    // `serviceId` vienen de los otros clientes. Faltaba el primero, así que en todo pedido del
    // portal `serviceId` quedaba undefined y las dos ramas que dependen de él morían en silencio:
    // el cargo de matriz TPU (nunca se cobró) y la magnitud inicial (las órdenes salían en 0 U).
    // integrationOrdersController ya contemplaba las tres.
    const serviceId = idServicio || req.body.idServicioBase || req.body.serviceId;
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
    // SEGURIDAD: el cliente sale SIEMPRE del token (o de la impersonación validada de diseñador,
    // que ya viene inyectada en req.user). El body NO puede elegir el cliente — antes se aceptaba
    // req.body.codCliente y cualquier token podía crear pedidos a nombre de otro.
    const codCliente = user.codCliente || null;
    let nombreCliente = user.name || user.username || 'Cliente Web';
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
            const clientRes = await pool.request().input('cod', sql.Int, codCliente).query("SELECT CliIdCliente, IDReact, ESTADO, IDCliente, Nombre FROM Clientes WHERE CodCliente = @cod");
            if (clientRes.recordset.length > 0) {
                const clientData = clientRes.recordset[0];
                idClienteReact = clientData.IDReact;
                cliIdCliente = clientData.CliIdCliente;

                // Cliente del nombre = campo literal IDCliente (igual que las órdenes de ERP/Sheets).
                // Fallback al Nombre solo si IDCliente viene vacío.
                nombreCliente = (clientData.IDCliente && clientData.IDCliente.trim().length > 0)
                    ? clientData.IDCliente.trim()
                    : (clientData.Nombre || nombreCliente);

                // Bloquear creación de pedidos si el cliente está BLOQUEADO
                if (clientData.ESTADO === 'BLOQUEADO') {
                    logger.warn(`⛔ [WebOrder] Cliente CodCliente=${codCliente} está BLOQUEADO. Pedido rechazado.`);
                    return res.status(403).json({
                        error: 'Tu cuenta está bloqueada. No podés crear nuevos pedidos. Contactá con nosotros para regularizar tu situación.',
                        blocked: true
                    });
                }
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

        // URGENCIA POR ÁREA: si el área principal no tiene urgencia activa (misma regla
        // que el motor de precios — perfil urgencia / AREAS_SIN_URGENCIA), se fuerza
        // 'Normal' aunque el payload diga otra cosa. El portal ya oculta el botón;
        // esto cubre payloads viejos/manuales. Fail-open si la config no se puede leer.
        let finalUrgency = urgency;
        if ((urgency || '').trim().toLowerCase() === 'urgente') {
            try {
                const { getAreasConUrgencia } = require('../utils/urgenciaAreas');
                const areasConUrgencia = await getAreasConUrgencia(pool);
                const areaPrincipal = (req.body.servicios?.find(s => s.esPrincipal)?.areaId || mainAreaID || '').toUpperCase();
                if (areaPrincipal && areaPrincipal !== 'GENE' && !areasConUrgencia.has(areaPrincipal)) {
                    finalUrgency = 'Normal';
                    logger.info(`[WebOrder] Área ${areaPrincipal} sin urgencia activa: prioridad forzada a Normal.`);
                }
            } catch (e) {
                logger.warn('[WebOrder] No se pudo evaluar urgencia por área:', e.message);
            }
        }

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
                        // Clave única por archivo (la manda el portal). Con dos archivos de igual
                        // nombre, el match de subida por nombre subía el mismo archivo dos veces.
                        fileKey: it.fileKey || null,
                        fileBackKey: it.fileBackKey || null,
                        copies: it.cantidad || 1,
                        note: it.nota,
                        width: it.width,
                        height: it.height,
                        observaciones: obsTecnicas,
                        widthBack: it.widthBack,
                        heightBack: it.heightBack,
                        observacionesBack: it.observacionesBack,
                        sinDPI: it.sinDPI,
                        sinDPIBack: it.sinDPIBack,
                        // CORTE: medición de la tizada (calculada por el portal al subirla)
                        piezas: it.piezas,
                        metrosCorte: it.metrosCorte,
                        // ECOUV: terminaciones elegidas para ESTE archivo [{terminacionId, cantidad}]
                        terminaciones: Array.isArray(it.terminaciones) ? it.terminaciones : []
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
                    // CORTE: medición de las tizadas (calculada por el portal al subirlas)
                    if (srv.metadata.tela) metaParts.push(`Bobina: ${srv.metadata.tela}`);
                    if (srv.metadata.piezasTotal) metaParts.push(`Piezas: ${srv.metadata.piezasTotal}`);
                    if (srv.metadata.metrosCorteTotal) metaParts.push(`Corte laser: ${srv.metadata.metrosCorteTotal} m`);
                    if (srv.metadata.largoTelaTotal) metaParts.push(`Largo tela: ${srv.metadata.largoTelaTotal} m`);

                    if (metaParts.length > 0) {
                        techInfo = metaParts.join(', '); // Format: "Prendas: 45, Bajadas: 3, Origen: Cliente"
                        serviceNote = (serviceNote ? serviceNote + '\n' : '') + `[DATOS TÉCNICOS] ${techInfo}`;
                    }
                }

                const execBase = {
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
                    // TPU: la Magnitud ES la cantidad pedida (UM='U') y el ítem NO trae archivo (el
                    // arte lo sube producción después) — el recálculo por archivos nunca la fijaba y
                    // la orden quedaba en "0 U" en todos lados, rompiendo además el contador de
                    // impresión parcial (el total es la Magnitud). El resto de los servicios sigue
                    // en 0: su Magnitud real la suman los archivos al procesarse.
                    // Tolerante a las dos formas del payload (cantidad / copies): las órdenes de
                    // prueba llegaban igual con Magnitud '0' — un solo nombre de campo no alcanzó.
                    // CORTE standalone entra igual que TPU: item {cantidad} sin archivo,
                    // Magnitud = total de piezas medidas en las tizadas (UM 'u').
                    magnitudInicial: ((serviceId === 'tpu' || serviceId === 'corte') && srv.esPrincipal)
                        ? (srv.items || []).reduce((s, it) => s + (parseInt(it?.cantidad ?? it?.copies) || 0), 0)
                        : 0,
                    // CORTE: metros lineales de corte del láser medidos en las tizadas. Si el
                    // ARTÍCULO de corte está en UM Metros, esto reemplaza a las piezas como
                    // Magnitud/cantidad a cotizar (ver rama TWC junto a la de DIRECTA).
                    metrosCorteTotal: parseFloat(srv.metadata?.metrosCorteTotal) || 0,
                    // CORTE multi-tela: cada servicio (una orden por bobina) trae SU bobina y
                    // los metros de TELA a descontarle — no usa el bobinaId top-level del pedido.
                    bobinaTelaId: srv.bobinaTelaId ? parseInt(srv.bobinaTelaId) : null,
                    magnitudTela: parseFloat(srv.magnitudTela) || 0,
                    // [REQUISITOS] Origen del material de Corte cuando viaja como extra
                    // (enrichedComplementary['TWC']): 'TELA SUBLIMADA EN USER' → viene de una
                    // orden de Sublimación existente (selectedSubOrderId); 'TELA CLIENTE' →
                    // bobina propia elegida en el picker (selectedBobinaId, comparte el estado
                    // top-level del formulario); 'TELA STOCK USER' → material propio, no
                    // requiere ningún traspaso. Ver bloque de bobina y bloque EST más abajo.
                    fabricOrigin: srv.metadata?.fabricOrigin || null,
                    selectedSubOrderId: srv.metadata?.selectedSubOrderId || null,
                    selectedBobinaIdExtra: srv.metadata?.selectedBobinaId ? parseInt(srv.metadata.selectedBobinaId) : null,
                    notaAdicional: serviceNote, // Nota completa para la Orden
                    techInfo: techInfo // Info técnica limpia para ServiciosExtraOrden
                };

                // [BORDADO] UNA ORDEN POR DISEÑO.
                // Cada logo es un trabajo distinto: va sobre SUS prendas (una línea de
                // InventarioPrendasCliente), en SU cantidad, con SUS medidas y SU
                // secuencia de hilos. Mismo criterio que Corte multi-tela, donde cada
                // tizada genera su orden con su bobina.
                // Sin esto todo el pedido caía en una sola orden con Magnitud 0 y se
                // perdían medidas, prenda de origen y paleta.
                const disenosEmb = (serviceId === 'bordado' && srv.esPrincipal && Array.isArray(srv.metadata?.disenos))
                    ? srv.metadata.disenos.filter(d => d && d.logo)
                    : null;

                if (disenosEmb && disenosEmb.length > 0) {
                    disenosEmb.forEach((d, iDis) => {
                        // Los archivos de ESTE diseño, no los del pedido entero: si no,
                        // cada orden se llevaría los logos de todas las demás.
                        const nombresDelDiseno = [d.logo, d.boceto, d.prediseno].filter(Boolean);

                        // Nota para el taller: todo lo que necesita saber de este bordado
                        // sin abrir nada. El detalle fino (qué hilo con qué puntada) va
                        // aparte, estructurado, en ArchivosOrden.PaletaBordado.
                        const datos = [`Diseño ${iDis + 1} de ${disenosEmb.length}`];
                        if (d.anchoCm && d.altoCm) datos.push(`Tamaño: ${d.anchoCm} x ${d.altoCm} cm`);
                        if (d.cantidad) datos.push(`Prendas: ${d.cantidad}`);
                        if (d.puntadasEstimadas) datos.push(`Puntadas estimadas: ${Number(d.puntadasEstimadas).toLocaleString('es-UY')} c/u`);
                        if (d.hilos) datos.push(`Hilos: ${d.hilos}`);
                        if (d.minutosEstimados) {
                            const m = parseInt(d.minutosEstimados);
                            const txt = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
                            datos.push(`Tiempo de máquina estimado: ${txt}`);
                        }
                        const tafeta = (d.paleta || []).filter(p => p.puntada === 'TAFETA').length;
                        if (tafeta) datos.push(`${tafeta} pieza(s) con TAFETA`);
                        if (d.relieve3D) datos.push('LLEVA RELIEVE 3D');
                        const infoDiseno = datos.join(', ');

                        pendingOrderExecutions.push({
                            ...execBase,
                            magnitudInicial: parseInt(d.cantidad) || 0,
                            // [CAPACIDAD] Puntadas TOTALES del diseño = puntadas de 1 pieza (lo
                            // que ya cotiza el bordado, d.puntadasEstimadas) x cantidad de piezas.
                            // NO reemplaza magnitudInicial/Magnitud (esa sigue siendo piezas, la
                            // usa el pricing) — es un dato aparte, solo para el motor de capacidad.
                            magnitudCapacidadInicial: (parseInt(d.puntadasEstimadas) || 0) * (parseInt(d.cantidad) || 0) || null,
                            referencias: ordenReferencias.filter(f => nombresDelDiseno.includes(f.name)),
                            prendaClienteId: d.prendaClienteId || null,
                            disenoBordado: d,
                            notaAdicional: (execBase.notaAdicional ? execBase.notaAdicional + '\n' : '') + `[BORDADO] ${infoDiseno}`,
                            techInfo: infoDiseno,
                        });
                    });
                } else {
                    pendingOrderExecutions.push(execBase);
                }
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
                    techInfo: serviceSpec,
                    // [REQUISITOS] Paridad con execBase (CASO 1) — este bloque legacy lo siguen
                    // usando integraciones externas (integrationOrdersController.js, etc.).
                    fabricOrigin: val.metadata?.fabricOrigin || null,
                    selectedSubOrderId: val.metadata?.selectedSubOrderId || null,
                    selectedBobinaIdExtra: val.metadata?.selectedBobinaId ? parseInt(val.metadata.selectedBobinaId) : null
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
                // UniIdUnidad: unidad de venta del artículo (1=Cantidades/piezas, 2=Metros). DIRECTA la usa
                // para saber si la orden se cuenta por piezas o por metros (impresión parcial "según el trabajo").
                const queryStr = `SELECT IDProdReact, CodArticulo, ProIdProducto, CodStock, UniIdUnidad FROM Articulos WHERE ${whereClause}`;

                const artRes = await request.query(queryStr);

                artRes.recordset.forEach(r => {
                    const info = { idReact: r.IDProdReact, proId: r.ProIdProducto, codArt: r.CodArticulo ? r.CodArticulo.trim() : null, codStock: r.CodStock ? r.CodStock.trim() : null, uniIdUnidad: r.UniIdUnidad };
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
                        exec.uniIdUnidad = info.uniIdUnidad; // 1=piezas, 2=metros (para UM por artículo en DIRECTA)
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

        // --- GUARD: NO crear órdenes de impresión SIN arte ---
        // Las órdenes que miden por metros (UM ≠ 'u' → sublimación, DTF, ECOUV…) DEBEN traer al menos un
        // archivo de arte; sin él nacen con Magnitud 0 y hay que cancelarlas a mano. Última línea de
        // defensa (por si el form deja pasar o llega un payload directo). Misma regla que la retención del
        // sync ERP. Los servicios por unidad (costura, corte, TPU-boceto) miden en 'u' → quedan exentos.
        // [BORDADO] 'punt' (puntadas) queda exento igual que 'u': el bordado no
        // imprime nada, no mide por metros y su arte no viaja como item de
        // producción sino como archivo de referencia por diseño (LOGO_BORDADO).
        // Sin esta excepción el guard rechazaba TODO pedido de bordado, porque su
        // UM no es 'u' pero tampoco tiene items con arte. Que cada diseño traiga
        // su logo ya lo valida el form antes de enviar.
        const UM_SIN_ARTE = ['u', 'punt'];
        const ordenSinArte = pendingOrderExecutions.find(exec => {
            if (exec.isExtra) return false;
            const um = (mapaAreasUM[exec.areaID] || 'u').toLowerCase().trim();
            if (UM_SIN_ARTE.includes(um)) return false; // por unidad o por puntadas → no requiere arte del cliente
            return !(exec.items || []).some(it => it.fileName || it.fileBackName);
        });
        if (ordenSinArte) {
            logger.warn(`⛔ [WebOrder] Pedido rechazado: servicio de impresión ${ordenSinArte.areaID} sin archivo de arte.`);
            return res.status(400).json({
                error: `El servicio de impresión (${ordenSinArte.areaID}) necesita al menos un archivo de arte. Subí el arte a imprimir antes de confirmar el pedido.`
            });
        }

        // --- 6. TRANSACCIÓN DB ---
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const filesToUpload = [];
            const generatedOrders = [];
            const generatedIDs = [];
            let fechaCompromisoEmb = null; // [CAPACIDAD] fecha real de Bordado, si el pedido lleva diseños EMB
            const timestamp = Date.now();
            let telaDescontada = false; // TELA CLIENTE: garantiza UN solo descuento por pedido

            // FORMA DE ENVÍO elegida por el cliente en el ingreso (mismo nomenclador
            // FormasEnvio que usa el retiro). Se guarda como texto en Ordenes.ModoRetiro
            // de cada orden del pedido (columna que ya muestran los detalles de orden).
            let modoRetiroNombre = null;
            if (req.body.formaEnvioId) {
                try {
                    const feRes = await new sql.Request(transaction)
                        .input('FE', sql.Int, parseInt(req.body.formaEnvioId, 10))
                        .query('SELECT Nombre FROM FormasEnvio WHERE ID = @FE');
                    modoRetiroNombre = (feRes.recordset[0]?.Nombre || '').trim() || null;
                } catch (eFE) {
                    logger.warn('[WebOrder] No se pudo resolver la forma de envío:', eFE.message);
                }
            }

            for (let idx = 0; idx < pendingOrderExecutions.length; idx++) {
                const exec = pendingOrderExecutions[idx];
                // Varias órdenes del pedido en la MISMA área (multitela en Sublimación,
                // multimaterial en EcoUV...) se numeran (1/N), (2/N). Sin esto quedaban
                // dos órdenes distintas con el MISMO CodigoOrden, y ese código es la
                // clave con la que caja, contabilidad, el ERP y el aviso de WhatsApp
                // encuentran la orden: con duplicados, los JOIN devuelven el doble de
                // filas y el importe del retiro se cobra dos veces.
                const hermanasArea = pendingOrderExecutions.filter(e => e.areaID === exec.areaID);
                let docNumber = erpDocNumber;

                if (hermanasArea.length > 1) {
                    const indexArea = hermanasArea.findIndex(e => e === exec) + 1;
                    docNumber = `${erpDocNumber} (${indexArea}/${hermanasArea.length})`;
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

                // Completar ProIdProducto si el front no lo mandó (los endpoints de
                // materiales de ECOUV no lo incluyen): el motor de precios y el detalle
                // de cobranza trabajan por ProIdProducto. Resuelto por código + variante
                // (hay códigos de artículo duplicados entre grupos).
                if (!exec.proIdProducto && exec.codArticulo) {
                    try {
                        const proRes = await new sql.Request(transaction)
                            .input('Art', sql.VarChar, String(exec.codArticulo).trim())
                            .input('Stk', sql.VarChar, String(exec.codStock || '').trim())
                            .query(`
                                SELECT TOP 1 ProIdProducto FROM articulos
                                WHERE LTRIM(RTRIM(CodArticulo)) = @Art
                                ORDER BY CASE WHEN LTRIM(RTRIM(CodStock)) = @Stk THEN 0 ELSE 1 END
                            `);
                        if (proRes.recordset[0]?.ProIdProducto) exec.proIdProducto = proRes.recordset[0].ProIdProducto;
                    } catch (_) { /* sin resolución: la cotización igual traduce por CodArticulo */ }
                }

                // Determinar UM + variante física (desde StockArt del CodStock elegido)
                let areaUM = mapaAreasUM[exec.areaID] || 'u';
                let varianteFinal = exec.variante;
                let materialFinal = exec.material;
                let esArmarAMedida = false;
                let esProductoTerminado = false;
                let notaMaterialImpresion = '';
                let tintaFinal = (exec.areaID === 'ECOUV' && tinta) ? String(tinta).trim() : null;
                if (exec.codStock) {
                    try {
                        const stUm = await new sql.Request(transaction)
                            .input('Stk', sql.VarChar, String(exec.codStock).trim())
                            .query("SELECT TOP 1 ISNULL(TipoStock, 'MATERIAL') AS TipoStock, LTRIM(RTRIM(Articulo)) AS VarianteStock FROM StockArt WHERE LTRIM(RTRIM(CodStock)) = LTRIM(RTRIM(@Stk))");
                        const st = stUm.recordset[0];
                        if (st) {
                            // PRODUCTO TERMINADO o PRODUCTO_LOCAL (12-ago: sale del stock del
                            // local, mismo tratamiento de precio): se cuenta y precia por UNIDAD
                            // aunque el área trabaje en m2 (precio cerrado del artículo).
                            if (st.TipoStock === 'PRODUCTO_TERMINADO' || st.TipoStock === 'PRODUCTO_LOCAL') { areaUM = 'u'; esProductoTerminado = true; }

                            // ECOUV: la Variante de la ORDEN es SIEMPRE la clasificación física
                            // del material QUE SE IMPRIME (Lonas/Canvas/Vinilos...), para que
                            // producción agrupe lotes por material real.
                            if (exec.areaID === 'ECOUV' && st.VarianteStock) {
                                esArmarAMedida = /personalizad|medida/i.test(exec.variante || '');
                                varianteFinal = st.VarianteStock;

                                // Producto terminado: el material que se imprime sale de la FICHA
                                // (ProductosTerminados.MaterialCodArticulo), no del artículo producto.
                                if (st.TipoStock === 'PRODUCTO_TERMINADO' && exec.codArticulo) {
                                    const fichaRes = await new sql.Request(transaction)
                                        .input('Art', sql.VarChar, String(exec.codArticulo).trim())
                                        .query(`
                                            SELECT TOP 1 LTRIM(RTRIM(A.Descripcion)) AS MaterialImpresion,
                                                   LTRIM(RTRIM(S.Articulo)) AS VarianteMaterial,
                                                   LTRIM(RTRIM(P.Tinta)) AS TintaFicha,
                                                   P.AnchoM, P.AltoM, P.BordeCm
                                            FROM ProductosTerminados P
                                            INNER JOIN articulos A ON LTRIM(RTRIM(A.CodArticulo)) = LTRIM(RTRIM(P.MaterialCodArticulo))
                                            LEFT JOIN StockArt S ON LTRIM(RTRIM(S.CodStock)) = LTRIM(RTRIM(A.CodStock))
                                            WHERE LTRIM(RTRIM(P.CodArticulo)) = @Art
                                            ORDER BY CASE WHEN LTRIM(RTRIM(A.CodStock)) LIKE '1.1.3.%' THEN 0 ELSE 1 END
                                        `);
                                    const ficha = fichaRes.recordset[0];
                                    if (ficha) {
                                        if (ficha.VarianteMaterial) varianteFinal = ficha.VarianteMaterial;
                                        // El área de IMPRESIÓN debe ver el SUSTRATO real (como cualquier
                                        // otra orden): Material = material de la ficha, no el producto.
                                        // El producto (con medidas y terminaciones) viaja en la NOTA.
                                        if (ficha.MaterialImpresion) materialFinal = ficha.MaterialImpresion;
                                        // TINTA: manda la que ELIGIÓ el cliente en el portal (arranca en la de
                                        // la ficha y puede cambiarla); la ficha queda como fallback para pedidos
                                        // sin tinta explícita. El recargo % de UV/Latex aplica solo vía perfil.
                                        tintaFinal = tintaFinal || ficha.TintaFicha || null;

                                        // Nota: producto + medidas + terminaciones incluidas
                                        const incNota = await new sql.Request(transaction)
                                            .input('Art', sql.VarChar, String(exec.codArticulo).trim())
                                            .query(`
                                                SELECT T.Nombre, PT.Cantidad, LTRIM(RTRIM(ISNULL(PT.Ubicacion, ''))) AS Ubicacion
                                                FROM ProductoTerminadoTerminaciones PT
                                                INNER JOIN ProductosTerminados P ON P.ID = PT.ProductoID
                                                INNER JOIN Terminaciones T ON T.TerminacionID = PT.TerminacionID
                                                WHERE LTRIM(RTRIM(P.CodArticulo)) = @Art
                                            `);
                                        const medidas = (ficha.AnchoM != null && ficha.AltoM != null)
                                            ? ` | Medidas ${ficha.AnchoM} x ${ficha.AltoM} m${ficha.BordeCm ? ` (+${ficha.BordeCm} cm borde)` : ''}`
                                            : '';
                                        const incTxt = incNota.recordset.length > 0
                                            ? ` | Incluye: ${incNota.recordset.map(i =>
                                                `${(i.Nombre || '').trim()} x${parseFloat(i.Cantidad) || 1}${i.Ubicacion ? ` (${i.Ubicacion.replace('_', ' y ').toLowerCase()})` : ''}`
                                              ).join(', ')}`
                                            : '';
                                        notaMaterialImpresion = `[PRODUCTO: ${String(exec.material || '').trim()}${medidas}${incTxt}]`;
                                    }
                                }
                            }

                            // MATERIAL IMPRESO con terminaciones: mismo criterio que el producto
                            // terminado — el área de impresión ve en la NOTA qué se le va a hacer
                            // después a esa pieza (dónde va cada terminación y con qué medida).
                            if (st.TipoStock !== 'PRODUCTO_TERMINADO') {
                                try {
                                    const idsTerm = [...new Set((exec.items || [])
                                        .flatMap(it => Array.isArray(it.terminaciones) ? it.terminaciones : [])
                                        .map(t => parseInt(t.terminacionId)).filter(n => !isNaN(n)))];
                                    if (idsTerm.length > 0) {
                                        const catRes = await new sql.Request(transaction)
                                            .query(`SELECT TerminacionID, LTRIM(RTRIM(Nombre)) AS Nombre, UnidadCobro, ReglaCantidad
                                                    FROM Terminaciones WHERE TerminacionID IN (${idsTerm.join(',')})`);
                                        const cat = new Map(catRes.recordset.map(t => [t.TerminacionID, t]));
                                        // Se listan sin repetir: la misma terminación en varios archivos
                                        // con la misma ubicación es una sola línea en la nota.
                                        // Reglas físicas del taller (01/08): la soldadura toma 5 cm del
                                        // borde; el ojal (2 cm) se coloca a 2,5 cm — a 7,5 si el lado
                                        // comparte soldadura; el bolsillo consume tamaño×2 (doblez) + 5.
                                        // Estos detalles viajan en la nota para que producción los vea.
                                        const ladosDeUbi = (u) => {
                                            const MAPA = { ARRIBA: ['t'], ABAJO: ['b'], ARRIBA_ABAJO: ['t', 'b'], IZQUIERDA: ['l'], DERECHA: ['r'], COSTADOS: ['l', 'r'], PERIMETRO: ['t', 'r', 'b', 'l'] };
                                            const set = new Set();
                                            String(u || '').split(',').forEach(p => (MAPA[p.trim()] || []).forEach(l => set.add(l)));
                                            return set;
                                        };
                                        const vistas = new Set();
                                        const partes = [];
                                        (exec.items || []).forEach(it => {
                                            // Lados con soldadura EN ESTE archivo (para el margen de los ojales)
                                            const ladosSold = new Set();
                                            (it.terminaciones || []).forEach(t => {
                                                const info = cat.get(parseInt(t.terminacionId));
                                                if (info && /soldadura/i.test(info.Nombre)) {
                                                    ladosDeUbi(t.ubicacion).forEach(l => ladosSold.add(l));
                                                }
                                            });
                                            (it.terminaciones || []).forEach(t => {
                                                const info = cat.get(parseInt(t.terminacionId));
                                                if (!info) return;
                                                const ubi = (t.ubicacion || '').trim();
                                                const clave = `${info.TerminacionID}|${ubi}|${t.param ?? ''}`;
                                                if (vistas.has(clave)) return;
                                                vistas.add(clave);
                                                const donde = ubi ? ` (${etiquetaUbicacion(ubi)})` : '';
                                                let como = '';
                                                if (info.ReglaCantidad === 'CADA_X_CM') {
                                                    const comparte = [...ladosDeUbi(ubi)].some(l => ladosSold.has(l));
                                                    const margen = comparte ? 'a 7,5 cm del borde (soldadura 5 + ojal 2,5)' : 'a 2,5 cm del borde';
                                                    como = `${t.param != null && t.param !== '' ? ` c/${t.param} cm,` : ''} ${margen}`;
                                                } else if (/bolsillo/i.test(info.Nombre)) {
                                                    const tam = parseFloat(t.param) || 5;
                                                    como = ` tamaño ${tam} cm (doblez ${tam}×2 + 5 de soldadura = ${tam * 2 + 5} cm por lado)`;
                                                } else if (/soldadura/i.test(info.Nombre)) {
                                                    como = ' (toma 5 cm del borde)';
                                                } else if (/palo/i.test(info.Nombre)) {
                                                    como = ' (en los extremos superior e inferior)';
                                                } else if (/roll up/i.test(info.Nombre)) {
                                                    como = ' (estuche abajo, varilla arriba)';
                                                }
                                                partes.push(`${info.Nombre}${donde}${como}`);
                                            });
                                        });
                                        if (partes.length > 0) {
                                            notaMaterialImpresion = `[TERMINACIONES: ${partes.join(' | ')}]`;
                                        }
                                    }
                                } catch (eNotaTerm) {
                                    logger.warn('[WebOrder] No se pudo armar la nota de terminaciones:', eNotaTerm.message);
                                }
                            }
                        }
                    } catch (_) { /* sin TipoStock/StockArt: se mantiene UM del área y variante original */ }
                }

                // IMPRESIÓN DIRECTA: la UM de la orden la define el ARTÍCULO (UniIdUnidad 1=Cantidades → 'u',
                // 2=Metros → 'm'), no el área. Así, "según el trabajo", el contador de impresión parcial cuenta
                // piezas (banderas por unidad) o metros (lona). El cálculo de Magnitud más abajo ya se ramifica por UM.
                if (exec.areaID === 'DIRECTA' && exec.uniIdUnidad != null) {
                    areaUM = (Number(exec.uniIdUnidad) === 1) ? 'u' : 'm';
                }

                // CORTE (form standalone): la UM del ARTÍCULO de corte define qué se cotiza
                // (regla 06/08): UniIdUnidad 1=Cantidades → Magnitud = piezas de la tizada;
                // 2=Metros → Magnitud = metros lineales de corte del láser medidos al subirla.
                if (serviceId === 'corte' && !exec.isExtra && exec.areaID === 'TWC' && exec.uniIdUnidad != null) {
                    areaUM = (Number(exec.uniIdUnidad) === 1) ? 'u' : 'm';
                    if (areaUM === 'm' && exec.metrosCorteTotal > 0) {
                        exec.magnitudInicial = exec.metrosCorteTotal;
                    }
                }

                // ID del producto (si lo tenemos en exec)
                const idProdReact = exec.idProductoReact || null;

                // Combinar Nota General + Nota Específica del Servicio (Metadatos)
                const combinedNote = [finalNote, exec.notaAdicional].filter(n => n && n.trim()).join(' | ');
                // La variante comercial "Personalizado (Armar a Medida)" y el material de
                // impresión del producto terminado viajan como marcas en la nota (la Variante
                // de la orden quedó reservada para la clasificación física del material).
                const notaOrden = [
                    esArmarAMedida ? '[ARMAR A MEDIDA]' : null,
                    notaMaterialImpresion || null,
                    combinedNote
                ].filter(Boolean).join(' ');

                const isPrinting = (exec.areaID || "").toUpperCase().match(/IMPRESION|GIG|SUBLIMACION|SB|DF|ECO|UV|DIRECTA/);
                const fechaEntradaSector = isPrinting ? new Date() : null;

                // [REQUISITOS] Corte con material que viene de una Sublimación existente del
                // cliente (selectedSubOrderId, elegido en el portal entre sus órdenes SB
                // activas — mismo universo que getActiveSublimationOrders). Se resuelve a
                // OrdenID acá para encadenar LiberaCuandoOrdenID: el check-in del remito
                // SB→TWC de esa orden puntual es lo que va a cumplir el requisito TELA de
                // esta orden de Corte (ver bloque AUTO-FULFILL en logisticsController.js).
                let liberaCuandoOrdenIdExec = null;
                if (exec.areaID === 'TWC' && exec.selectedSubOrderId) {
                    const subRes = await new sql.Request(transaction)
                        .input('Cod', sql.VarChar(50), String(exec.selectedSubOrderId).trim())
                        .input('CodCliente', sql.Int, codCliente)
                        .query(`
                            SELECT TOP 1 OrdenID FROM Ordenes
                            WHERE CodigoOrden = @Cod AND AreaID IN ('SB', 'SUB') AND CodCliente = @CodCliente
                              AND Estado NOT IN ('Finalizado', 'Cancelado', 'Entregado')
                        `);
                    if (subRes.recordset.length) {
                        liberaCuandoOrdenIdExec = subRes.recordset[0].OrdenID;
                    } else {
                        logger.warn(`[CORTE] selectedSubOrderId '${exec.selectedSubOrderId}' no resolvió a una orden SB activa del cliente ${codCliente} — queda sin encadenar.`);
                    }
                }

                // INSERCIÓN DE ORDEN CON ESTADO 'Cargando...'
                const resOrder = await new sql.Request(transaction)
                    .input('AreaID', sql.VarChar(20), exec.areaID)
                    .input('Cliente', sql.NVarChar(200), nombreCliente)
                    .input('CodCliente', sql.Int, codCliente)
                    .input('IdClienteReact', sql.VarChar(50), idClienteReact ? idClienteReact.toString() : null)
                    .input('Desc', sql.NVarChar(300), jobName)
                    .input('Prio', sql.VarChar(20), finalUrgency)
                    .input('Mat', sql.VarChar(255), materialFinal)
                    .input('Var', sql.VarChar(100), varianteFinal)
                    .input('Cod', sql.VarChar(50), exec.codigoOrden)
                    .input('ERP', sql.VarChar(50), erpDocNumber)
                    .input('Nota', sql.NVarChar(sql.MAX), notaOrden)
                    .input('Mag', sql.VarChar(50), String(exec.magnitudInicial || '0')) // Magnitud inicial (cero si no hay dato)
                    // [CAPACIDAD] Puntadas totales del diseño (solo EMB) — ver
                    // magnitudCapacidadInicial más arriba. NULL en cualquier otra área.
                    .input('MagCap', sql.Decimal(18, 2), exec.magnitudCapacidadInicial ?? null)
                    .input('Prox', sql.VarChar(50), proximoServicio)
                    .input('Estado', sql.VarChar(50), 'Cargando...')
                    .input('UM', sql.VarChar(20), areaUM)
                    .input('CodArt', sql.VarChar(50), exec.codArticulo || null)
                    .input('IdProdReact', sql.Int, idProdReact)
                    .input('ProIdProducto', sql.Int, exec.proIdProducto || null)
                    .input('CliIdCliente', sql.Int, cliIdCliente)
                    .input('F_EntSec', sql.DateTime, fechaEntradaSector)
                    // TELA CLIENTE: solo la orden principal (los extras no consumen tela).
                    // Corte multi-tela: cada orden lleva SU bobina (exec.bobinaTelaId).
                    .input('BobID', sql.Int, exec.bobinaTelaId
                        ? exec.bobinaTelaId
                        : ((bobinaId && !exec.isExtra) ? parseInt(bobinaId) : null))
                    .input('DisenadorID', sql.Int, req.disenadorId || null) // pedido creado por un DISEÑADOR en nombre del cliente
                    .input('Tinta', sql.VarChar(50), tintaFinal) // ECOUV: rutea lote (magic sort agrupa por Tinta); producto terminado la toma de su ficha
                    .input('ModoRet', sql.VarChar(100), modoRetiroNombre) // forma de envío elegida en el ingreso
                    // [BORDADO] Línea de prendas del cliente que consume esta orden.
                    // Análogo exacto de BobinaTelaID en tela de cliente.
                    .input('PrendaCliID', sql.Int, exec.prendaClienteId || null)
                    // [REQUISITOS] Corte cuyo material sale de una Sublimación existente del
                    // cliente — ver resolución de liberaCuandoOrdenIdExec más arriba. Mismo
                    // campo que ya usa prendasOrdersController.js para encadenar Estampado a
                    // su transfer específico; acá lo consume el check-in extendido en
                    // logisticsController.js (bloque AUTO-FULFILL, match por LiberaCuandoOrdenID).
                    .input('LiberaCuando', sql.Int, liberaCuandoOrdenIdExec)
                    .query(`
                        INSERT INTO Ordenes (
                            AreaID, Cliente, CodCliente, IdClienteReact, DescripcionTrabajo, Prioridad,
                            FechaIngreso, FechaEstimadaEntrega, Material, Variante,
                            CodigoOrden, NoDocERP, Nota, Magnitud, MagnitudCapacidad, ProximoServicio, UM, Estado, EstadoenArea,
                            CodArticulo, IdProductoReact, ProIdProducto, CliIdCliente, FechaEntradaSector,
                            BobinaTelaID, DisenadorID, Tinta, ModoRetiro, PrendaClienteID, LiberaCuandoOrdenID
                        )
                        OUTPUT INSERTED.OrdenID
                        VALUES (
                            @AreaID, @Cliente, @CodCliente, @IdClienteReact, @Desc, @Prio,
                            GETDATE(), DATEADD(day, 3, GETDATE()), @Mat, @Var,
                            @Cod, @ERP, @Nota, @Mag, @MagCap, @Prox, @UM, @Estado, @Estado,
                            @CodArt, @IdProdReact, @ProIdProducto, @CliIdCliente, @F_EntSec,
                            @BobID, @DisenadorID, @Tinta, @ModoRet, @PrendaCliID, @LiberaCuando
                        )
                    `);

                const newOID = resOrder.recordset[0].OrdenID;
                exec.newOrdenID = newOID; // [CAPACIDAD] para poder actualizar FechaCompromiso después del loop
                generatedOrders.push(exec.codigoOrden);
                generatedIDs.push(newOID);

                // Fecha de entrega real (área/prioridad/horario/feriados). Si el SP falla,
                // queda el DATEADD(day,3,GETDATE()) del INSERT como respaldo.
                try {
                    await new sql.Request(transaction).input('OrdenID', sql.Int, newOID).execute('sp_CalcularFechaEntrega');
                } catch (fechaErr) {
                    logger.error(`⚠️ sp_CalcularFechaEntrega falló para OrdenID ${newOID}: ${fechaErr.message}`);
                }

                // [BORDADO] El diseño de esta orden: medidas del bordado, prendas que
                // lleva y la secuencia de hilos elegida en el prediseño.
                // Va en ArchivosOrden porque es el mismo lugar donde Corte guarda sus
                // tizadas (Ancho/Alto/Piezas ya existían) y la bandeja de EMB ya lo lee.
                if (exec.disenoBordado) {
                    const d = exec.disenoBordado;
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, newOID)
                        .input('Nom', sql.VarChar(200), d.logo || 'Diseño')
                        .input('Ancho', sql.Decimal(10, 2), d.anchoCm || null)
                        .input('Alto', sql.Decimal(10, 2), d.altoCm || null)
                        .input('Piezas', sql.Int, parseInt(d.cantidad) || null)
                        .input('Paleta', sql.NVarChar(sql.MAX),
                            (d.paleta && d.paleta.length) ? JSON.stringify(d.paleta) : null)
                        // Las puntadas son lo que COTIZA el bordado: sin esto el precio
                        // cae al mínimo con "(0 p.)".
                        .input('Punt', sql.Int, parseInt(d.puntadasEstimadas) || null)
                        .query(`
                            INSERT INTO ArchivosOrden
                                (OrdenID, NombreArchivo, Copias, Ancho, Alto, Piezas, PaletaBordado, PuntadasEstimadas, TipoArchivo, FechaSubida)
                            VALUES (@OID, @Nom, 1, @Ancho, @Alto, @Piezas, @Paleta, @Punt, 'BORDADO', GETDATE())
                        `);

                    // Cargos que se cobran aparte del bordado en sí (ver
                    // docs/migrations/bordado_articulos_y_variantes.sql):
                    //   1568 Matriz de bordado  → una por diseño nuevo
                    //   1631 Recargo 3D relieve → solo si alguna pieza va en relieve
                    const cargos = [
                        { cod: '1568', desc: 'Matriz de bordado', cant: 1 },
                    ];
                    if (d.relieve3D) {
                        cargos.push({ cod: '1631', desc: 'Recargo bordado 3D en relieve', cant: parseInt(d.cantidad) || 1 });
                    }
                    for (const c of cargos) {
                        await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Cod', sql.VarChar(50), c.cod)
                            .input('Des', sql.NVarChar(255), c.desc)
                            .input('Cnt', sql.Decimal(18, 2), c.cant)
                            .query(`
                                INSERT INTO ServiciosExtraOrden
                                    (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro)
                                VALUES (@OID, @Cod, '1.1.4.9', @Des, @Cnt, 0, 0, 'Cargo de bordado (portal)', GETDATE())
                            `);
                    }

                    // [PRENDA] Un parche adhesivo se fabrica de cero — no consume ninguna prenda
                    // que el cliente haya entregado, así que el requisito bloqueante PRENDA nunca
                    // se cumpliría por el camino normal (recibir un remito con la prenda del
                    // cliente) y la orden quedaría esperando para siempre. Nace CUMPLIDO desde el
                    // ingreso. "Bordado sobre la prenda" (el otro tipo) sí la necesita — no se
                    // toca ese caso. Mismo criterio robusto que ya usa el frontend
                    // (BordadoTechnicalUI.jsx) para distinguir un parche: /parche/i sobre la
                    // variante, más tolerante que comparar el string exacto.
                    if (/parche/i.test(varianteFinal || '')) {
                        try {
                            const reqPrenda = await new sql.Request(transaction)
                                .input('Area', sql.VarChar(20), exec.areaID)
                                .query(`SELECT RequisitoID FROM ConfigRequisitosProduccion WHERE AreaID = @Area AND CodigoRequisito = 'PRENDA'`);
                            if (reqPrenda.recordset.length) {
                                await new sql.Request(transaction)
                                    .input('OID', sql.Int, newOID)
                                    .input('Area', sql.VarChar(20), exec.areaID)
                                    .input('RID', sql.Int, reqPrenda.recordset[0].RequisitoID)
                                    .query(`
                                        IF NOT EXISTS (SELECT 1 FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID)
                                            INSERT INTO OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                                            VALUES (@OID, @Area, @RID, 'CUMPLIDO', GETDATE(), 'Parche adhesivo: no consume prenda del cliente')
                                    `);
                            }
                        } catch (reqErr) {
                            logger.warn(`[BORDADO] Orden ${newOID}: no se pudo auto-cumplir el requisito PRENDA (parche): ${reqErr.message}`);
                        }
                    }

                    // [PRENDA] El cliente ya eligió, al cargar el pedido, la línea de
                    // InventarioPrendasCliente que esta orden va a bordar (PrendaClienteID,
                    // guardado arriba en el INSERT de Ordenes) — esa prenda solo existe ahí
                    // porque ya se recibió en mostrador (Recepciones/PRE-xxx). Si el bulto de
                    // esa recepción YA está físicamente en esta área (llegó por remito interno
                    // ANTES de que se creara este pedido), el requisito nace CUMPLIDO con el
                    // detalle — mismo formato "Asignado: ..." que TELA CLIENTE más abajo. Si
                    // todavía no llegó (sigue en Recepción o en tránsito), no hace nada acá: se
                    // cumple más adelante al recibirse el remito (ver AUTO-FULFILL PRENDA DE
                    // CLIENTE en logisticsController.receiveDispatch, caso simétrico a este).
                    if (exec.prendaClienteId) {
                        try {
                            const prendaRes = await new sql.Request(transaction)
                                .input('PID', sql.Int, exec.prendaClienteId)
                                .input('Area', sql.VarChar(20), exec.areaID)
                                .query(`
                                    SELECT p.Descripcion, p.Talle, p.Color, r.Codigo AS CodigoRecepcion
                                    FROM InventarioPrendasCliente p
                                    LEFT JOIN Recepciones r ON r.RecepcionID = p.RecepcionID
                                    LEFT JOIN Logistica_Bultos b ON (b.CodigoEtiqueta = r.Codigo OR b.CodigoEtiqueta LIKE r.Codigo + '-%')
                                    WHERE p.PrendaClienteID = @PID AND b.UbicacionActual = @Area
                                `);
                            if (prendaRes.recordset.length) {
                                const { Descripcion, Talle, Color, CodigoRecepcion } = prendaRes.recordset[0];
                                const reqPrenda2 = await new sql.Request(transaction)
                                    .input('Area', sql.VarChar(20), exec.areaID)
                                    .query(`SELECT RequisitoID FROM ConfigRequisitosProduccion WHERE AreaID = @Area AND CodigoRequisito = 'PRENDA'`);
                                if (reqPrenda2.recordset.length) {
                                    const partes = [Descripcion || 'prenda del cliente'];
                                    if (Talle) partes.push(`talle ${Talle}`);
                                    if (Color) partes.push(Color);
                                    const obsPrenda = `Asignado: ${partes.join(' — ')}${CodigoRecepcion ? ` [${CodigoRecepcion.trim()}]` : ''}`;
                                    await new sql.Request(transaction)
                                        .input('OID', sql.Int, newOID)
                                        .input('Area', sql.VarChar(20), exec.areaID)
                                        .input('RID', sql.Int, reqPrenda2.recordset[0].RequisitoID)
                                        .input('Obs', sql.NVarChar(500), obsPrenda)
                                        .query(`
                                            IF NOT EXISTS (SELECT 1 FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID)
                                                INSERT INTO OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                                                VALUES (@OID, @Area, @RID, 'CUMPLIDO', GETDATE(), @Obs)
                                        `);
                                }
                            }
                        } catch (reqErr) {
                            logger.warn(`[BORDADO] Orden ${newOID}: no se pudo auto-cumplir el requisito PRENDA (prenda de cliente ya recibida): ${reqErr.message}`);
                        }
                    }
                }

                // TPU trabajo nuevo: cobrar la matriz (artículo 156 = US$15) como línea de facturación.
                // El reuso de matriz va por /reuse-matriz y NO pasa por acá, así que ahí no se cobra.
                if (serviceId === 'tpu' && !exec.isExtra && String(exec.areaID || '').toUpperCase() === 'TPU') {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, newOID)
                        .query(`INSERT INTO ServiciosExtraOrden (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro)
                                VALUES (@OID, '156', '1.1.10.1', 'Matriz TPU', 1, 0, 0, 'Cargo de matriz (trabajo nuevo TPU)', GETDATE())`);
                }

                // --- TELA CLIENTE: Descontar metros de la bobina ---
                // Flujo clásico (sublimación tela cliente): UNA bobina top-level por pedido,
                // descontada una sola vez en la orden principal (metros = magnitud top-level).
                // CORTE multi-tela: cada servicio/orden trae SU bobina (exec.bobinaTelaId) y
                // SUS metros de tela (exec.magnitudTela) — se descuenta por orden.
                const usaBobinaPropia = !!exec.bobinaTelaId;
                if (!exec.isExtra && (usaBobinaPropia || (bobinaId && !telaDescontada))) {
                    const bid = usaBobinaPropia ? exec.bobinaTelaId : parseInt(bobinaId);
                    const mag = usaBobinaPropia
                        ? (parseFloat(exec.magnitudTela) || 0)
                        : (parseFloat(magnitud) || parseFloat(exec.magnitudInicial) || 0);

                    if (mag <= 0) {
                        logger.warn(`[TELA-CLIENTE] Orden ${newOID}: bobina ${bid} indicada pero sin metros a descontar (magnitud='${magnitud}').`);
                    } else {
                        const checkBob = await new sql.Request(transaction)
                            .input('BID', sql.Int, bid)
                            .query(`SELECT MetrosRestantes, InsumoID, DescripcionTela, CodigoEtiqueta, Ancho, AnchoReal, Referencia FROM InventarioBobinas WHERE BobinaID = @BID`);

                        if (!checkBob.recordset.length) throw new Error('Bobina de tela no encontrada.');
                        const { MetrosRestantes, InsumoID, DescripcionTela, CodigoEtiqueta, Ancho, AnchoReal, Referencia } = checkBob.recordset[0];
                        if (mag > MetrosRestantes) {
                            throw new Error(`La bobina solo tiene ${MetrosRestantes}m disponibles. El pedido requiere ${mag}m.`);
                        }

                        // Descuento CONDICIONADO (MetrosRestantes >= @Mts): dos pedidos simultáneos
                        // no pueden dejar la bobina en negativo — el segundo no matchea y falla acá.
                        const updRes = await new sql.Request(transaction)
                            .input('BID', sql.Int, bid)
                            .input('Mts', sql.Decimal(10, 2), mag)
                            .query(`
                                UPDATE InventarioBobinas
                                SET MetrosRestantes = MetrosRestantes - @Mts,
                                    Estado = CASE
                                        WHEN (MetrosRestantes - @Mts) <= 0.5 THEN 'Agotado'
                                        ELSE Estado
                                    END
                                WHERE BobinaID = @BID AND MetrosRestantes >= @Mts
                            `);
                        if (!updRes.rowsAffected[0]) {
                            throw new Error('La bobina ya no tiene metros suficientes (consumidos por otro pedido).');
                        }

                        // Registrar movimiento CONSUMO_ORDEN (fuente de verdad para la devolución al cancelar)
                        await new sql.Request(transaction)
                            .input('IID', sql.Int, InsumoID)
                            .input('BID', sql.Int, bid)
                            .input('OID', sql.Int, newOID)
                            .input('Mts', sql.Decimal(10, 2), mag)
                            .input('UID', sql.Int, req.user?.id || 1)
                            .input('Ref', sql.NVarChar(300), `Consumo Orden ${exec.codigoOrden || newOID} - ${jobName}`)
                            .query(`
                                INSERT INTO MovimientosInsumos
                                    (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID, OrdenID, FechaMovimiento)
                                VALUES (@IID, @BID, 'CONSUMO_ORDEN', -@Mts, @Ref, @UID, @OID, GETDATE())
                            `);

                        // El cliente YA eligió la bobina en el portal: si el área tiene requisito
                        // de TELA (bloqueante en TWC), nace CUMPLIDO desde el ingreso con los
                        // datos completos de la bobina — mismo formato "Asignado:" que la
                        // asignación manual de OrderRequirementsList, así nadie tiene que
                        // marcarlo a mano y sin datos.
                        try {
                            const reqTela = await new sql.Request(transaction)
                                .input('Area', sql.VarChar(20), exec.areaID)
                                .query(`SELECT RequisitoID FROM ConfigRequisitosProduccion WHERE AreaID = @Area AND CodigoRequisito LIKE '%TELA%'`);
                            if (reqTela.recordset.length) {
                                const partes = [];
                                if (Referencia) partes.push(String(Referencia).trim());
                                if (DescripcionTela) partes.push(String(DescripcionTela).trim());
                                partes.push(`${mag}m usados (quedan ${(MetrosRestantes - mag).toFixed(2)}m)`);
                                const anchoTela = AnchoReal ?? Ancho;
                                if (anchoTela) partes.push(`ancho ${parseFloat(anchoTela).toFixed(2)}m`);
                                const obsTela = `Asignado: ${partes.join(' — ')} [${(CodigoEtiqueta || `Bobina ${bid}`).trim()}]`;
                                await new sql.Request(transaction)
                                    .input('OID', sql.Int, newOID)
                                    .input('Area', sql.VarChar(20), exec.areaID)
                                    .input('RID', sql.Int, reqTela.recordset[0].RequisitoID)
                                    .input('Obs', sql.NVarChar(500), obsTela)
                                    .query(`
                                        IF NOT EXISTS (SELECT 1 FROM OrdenCumplimientoRequisitos WHERE OrdenID = @OID AND RequisitoID = @RID)
                                            INSERT INTO OrdenCumplimientoRequisitos (OrdenID, AreaID, RequisitoID, Estado, FechaCumplimiento, Observaciones)
                                            VALUES (@OID, @Area, @RID, 'CUMPLIDO', GETDATE(), @Obs)
                                    `);
                            }
                        } catch (reqErr) {
                            // Informativo: si falla, el requisito queda pendiente para marcar a mano como antes.
                            logger.warn(`[TELA-CLIENTE] Orden ${newOID}: no se pudo auto-cumplir el requisito TELA: ${reqErr.message}`);
                        }

                        // El candado "una vez por pedido" es solo del flujo clásico top-level;
                        // con bobina propia cada orden descuenta la suya.
                        if (!usaBobinaPropia) telaDescontada = true;
                        logger.info(`[TELA-CLIENTE] Orden ${newOID}: descontados ${mag}m de bobina ${bid}. Restantes: ${MetrosRestantes - mag}m`);
                    }
                } else if (!exec.isExtra && exec.areaID === 'SB') {
                    // [REQUISITOS] Sublimación sin bobina de cliente: material propio de la
                    // empresa. El requisito TELA nunca se va a cumplir por esta vía — nace
                    // CUMPLIDO ("no aplica") en vez de quedar bloqueado para siempre.
                    await marcarRequisitoNoAplica(transaction, {
                        ordenId: newOID, areaId: exec.areaID, codigoRequisito: 'TELA', exact: false,
                        observaciones: 'No aplica — material propio de la empresa'
                    });
                }

                // [REQUISITOS] Corte (TWC) como EXTRA de otro pedido: el bloque de arriba es
                // solo para el servicio principal (!exec.isExtra), así que acá se resuelve el
                // requisito TELA aparte según lo que el cliente indicó en el portal.
                if (exec.areaID === 'TWC' && exec.isExtra) {
                    if (exec.selectedBobinaIdExtra) {
                        // Bobina propia elegida directamente. No se toca InventarioBobinas acá
                        // (este flujo de extra no mide tizada, no hay magnitud de tela
                        // calculable todavía) — el descuento de metros queda pendiente, igual
                        // que hoy, pero el requisito ya no bloquea la orden indefinidamente.
                        const bobRes = await new sql.Request(transaction)
                            .input('BID', sql.Int, exec.selectedBobinaIdExtra)
                            .query(`SELECT DescripcionTela, CodigoEtiqueta FROM InventarioBobinas WHERE BobinaID = @BID`);
                        const bob = bobRes.recordset[0];
                        const obsBobina = bob
                            ? `Asignado: ${bob.DescripcionTela || 'Tela'} [${(bob.CodigoEtiqueta || `Bobina ${exec.selectedBobinaIdExtra}`).trim()}] — metros pendientes de descuento manual`
                            : `Bobina ${exec.selectedBobinaIdExtra} indicada por el cliente`;
                        await marcarRequisitoNoAplica(transaction, {
                            ordenId: newOID, areaId: exec.areaID, codigoRequisito: 'TELA', exact: false, observaciones: obsBobina
                        });
                    } else if (!exec.selectedSubOrderId) {
                        // Ni bobina propia ni traspaso de una Sublimación existente: material
                        // propio de la empresa, igual que el caso SB de arriba.
                        await marcarRequisitoNoAplica(transaction, {
                            ordenId: newOID, areaId: exec.areaID, codigoRequisito: 'TELA', exact: false,
                            observaciones: 'No aplica — material propio de la empresa'
                        });
                    }
                    // else: selectedSubOrderId sin bobina propia → el requisito TELA queda
                    // genuinamente pendiente. Ya quedó encadenado a la orden SB de origen vía
                    // LiberaCuandoOrdenID (ver resolución antes del INSERT) — lo resuelve el
                    // check-in extendido en logisticsController.js cuando llegue el bulto real.
                }

                // [REQUISITOS] Estampado (EST) exige simultáneamente PRENDA+DTF+TPU en
                // ConfigRequisitosProduccion, pero cada orden real solo sale de UN canal — el
                // que corresponda según qué otras áreas están activas en este mismo pedido
                // (mismo NoDocERP). Los códigos que no correspondan nacen CUMPLIDOS ("no
                // aplica"); el que sí corresponde queda pendiente, resuelto por el auto-cumplido
                // de check-in ya existente (matchea por NoDocERP + Areas.Entrega del origen).
                if (exec.areaID === 'EST') {
                    let canalReal = null;
                    if (allActiveAreas.has('DF') && !allActiveAreas.has('TPU')) canalReal = 'DTF';
                    else if (allActiveAreas.has('TPU') && !allActiveAreas.has('DF')) canalReal = 'TPU';
                    else if (!allActiveAreas.has('DF') && !allActiveAreas.has('TPU') && allActiveAreas.has('EMB')) canalReal = 'PRENDA';

                    if (canalReal) {
                        for (const cod of ['PRENDA', 'DTF', 'TPU']) {
                            if (cod === canalReal) continue;
                            await marcarRequisitoNoAplica(transaction, {
                                ordenId: newOID, areaId: exec.areaID, codigoRequisito: cod,
                                observaciones: `No aplica — el canal real de este Estampado es ${canalReal}`
                            });
                        }
                    } else {
                        logger.warn(`[ESTAMPADO] Orden ${newOID}: canal ambiguo o sin origen reconocido (DF=${allActiveAreas.has('DF')}, TPU=${allActiveAreas.has('TPU')}, EMB=${allActiveAreas.has('EMB')}) — quedan los 3 requisitos pendientes.`);
                    }
                }

                // --- NOMBRE DE LOS ARCHIVOS: MATERIAL AL PRINCIPIO (SOLO SUBLIMACIÓN) ---
                // El resto de las áreas mantiene el nombre de siempre (ORDEN_CLIENTE_TRABAJO_Archivo...).
                const nombreNuevo = await usaNombreNuevo(exec.areaID);
                let materialNombreArchivo = '';
                if (nombreNuevo) {
                    // Tela de cliente: al material se le agrega el PRE de la recepción de esa tela.
                    let preTelaCliente = null;
                    if (bobinaId && !exec.isExtra) {
                        try {
                            const telaRes = await new sql.Request(transaction)
                                .input('BID', sql.Int, parseInt(bobinaId))
                                .query('SELECT Referencia FROM InventarioBobinas WHERE BobinaID = @BID');
                            preTelaCliente = telaRes.recordset[0]?.Referencia || null;
                        } catch (_) { /* sin PRE: el nombre queda solo con el material */ }
                    }
                    materialNombreArchivo = materialParaNombre(materialFinal, preTelaCliente);
                }

                // --- REGISTRAR ARCHIVOS ESPERADOS (PLACEHOLDERS) ---
                let totalMagnitud = 0;
                let fileCount = 0;
                let termCatalogCache = null; // catálogo de Terminaciones (se carga una vez si algún item las trae)

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

                        // SUBLIMACIÓN: {MATERIAL}-{ORDEN}_{CLIENTE}_Arch {i} de {n} (x{copias}).ext
                        // Resto de áreas: formato de siempre.
                        const finalName = nombreNuevo
                            ? construirNombreArchivo({
                                material: materialNombreArchivo,
                                codigoOrden: exec.codigoOrden,
                                cliente: nombreCliente,
                                idx: i + 1,
                                total: exec.items.length,
                                copias: item.copies || 1,
                                ext
                            })
                            : `${exec.codigoOrden.replace(/\//g, '-')}_${sanitize(nombreCliente)}_${sanitize(jobName)}_Archivo ${i + 1} de ${exec.items.length} (x${item.copies || 1})${ext}`;

                        // CORTE: la tizada viaja como archivo de PRODUCCIÓN con su medición
                        // (Piezas + MetrosCorte del láser); Ancho/Alto/Metros llevan la tela.
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
                            .input('Piezas', sql.Int, (item.piezas !== undefined && item.piezas !== null) ? parseInt(item.piezas) : null)
                            .input('MetrosCorte', sql.Decimal(10, 3), (item.metrosCorte !== undefined && item.metrosCorte !== null) ? parseFloat(item.metrosCorte) : null)
                            .query(`
                                INSERT INTO ArchivosOrden (
                                    OrdenID, NombreArchivo, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida,
                                    Ancho, Alto, Observaciones, CodigoArticulo, SinDPI, Piezas, MetrosCorte
                                )
                                OUTPUT INSERTED.ArchivoID
                                VALUES (
                                    @OID, @Nom, @Tipo, @Cop, @Met, 'Pendiente', GETDATE(),
                                    @Ancho, @Alto, @Obs, @CodArt, @SinDPI, @Piezas, @MetrosCorte
                                )
                            `);

                        filesToUpload.push({
                            dbId: resFile.recordset[0].ArchivoID,
                            type: 'ORDEN',
                            originalName: item.fileName, // Para que el front sepa cuál es
                            fileKey: item.fileKey || null, // match exacto en el front; originalName queda de fallback
                            finalName: finalName,
                            area: exec.areaID
                        });

                        // TERMINACIONES POR ARCHIVO (ECOUV): quedan DENTRO de la misma orden,
                        // ligadas al archivo (OrdenTerminaciones) + línea de facturación en
                        // ServiciosExtraOrden. NO se crea una orden aparte.
                        if (Array.isArray(item.terminaciones) && item.terminaciones.length > 0) {
                            if (!termCatalogCache) {
                                const tc = await new sql.Request(transaction)
                                    .query("SELECT TerminacionID, Nombre, CodArticulo, UnidadCobro FROM Terminaciones WHERE Activo = 1");
                                termCatalogCache = new Map(tc.recordset.map(t => [t.TerminacionID, t]));
                            }
                            const archivoId = resFile.recordset[0].ArchivoID;
                            for (const term of item.terminaciones) {
                                const tid = parseInt(term.terminacionId);
                                const tInfo = termCatalogCache.get(tid);
                                if (!tInfo) {
                                    logger.warn(`[WebOrder] Terminación ${term.terminacionId} inexistente/inactiva: ignorada (orden ${newOID})`);
                                    continue;
                                }
                                const cantTerm = parseFloat(term.cantidad) || 1;
                                // ParamCliente: lo que el cliente ajustó en el plano — separación
                                // de los ojales o distancia del bolsillo al borde (en cm).
                                const paramCli = (term.param !== undefined && term.param !== null && term.param !== '')
                                    ? parseFloat(term.param) : null;
                                await new sql.Request(transaction)
                                    .input('OID', sql.Int, newOID)
                                    .input('AID', sql.Int, archivoId)
                                    .input('TID', sql.Int, tid)
                                    .input('Cnt', sql.Decimal(18, 2), cantTerm)
                                    .input('Ubi', sql.VarChar(30), term.ubicacion ? String(term.ubicacion).trim() : null)
                                    .input('Par', sql.Decimal(9, 2), isNaN(paramCli) ? null : paramCli)
                                    .query("INSERT INTO OrdenTerminaciones (OrdenID, ArchivoID, TerminacionID, Cantidad, Ubicacion, ParamCliente) VALUES (@OID, @AID, @TID, @Cnt, @Ubi, @Par)");

                                if (tInfo.CodArticulo) {
                                    await new sql.Request(transaction)
                                        .input('OID', sql.Int, newOID)
                                        .input('Cod', sql.VarChar(50), String(tInfo.CodArticulo).trim())
                                        .input('Des', sql.NVarChar(255), `Terminación: ${tInfo.Nombre}`)
                                        .input('Cnt', sql.Decimal(18, 2), cantTerm)
                                        .query(`
                                            -- Estado OK de entrada: esta línea existe SOLO para facturar.
                                            -- El trabajo se controla en el área de Terminaciones (checklist
                                            -- de OrdenTerminaciones); en el control de IMPRESIÓN no debe
                                            -- aparecer como algo para contar ni frenar la orden.
                                            INSERT INTO ServiciosExtraOrden
                                            (OrdenID, CodArt, CodStock, Descripcion, Cantidad, PrecioUnitario, TotalLinea, Observacion, FechaRegistro, Estado, Controlcopias)
                                            VALUES (@OID, @Cod, '', @Des, @Cnt, 0, 0, 'Terminación por archivo (WebOrder)', GETDATE(), 'OK', @Cnt)
                                        `);
                                }
                            }
                            logger.info(`[WebOrder] ${item.terminaciones.length} terminaciones registradas para archivo ${archivoId} (orden ${newOID})`);
                        }

                        // PRODUCTO TERMINADO: sus terminaciones INCLUIDAS (ficha del producto)
                        // también se registran en OrdenTerminaciones para que control de calidad
                        // derive la orden al armado y la bandeja las muestre como checklist.
                        // SIN línea de facturación: ya están dentro del precio cerrado.
                        if (esProductoTerminado && exec.codArticulo) {
                            try {
                                const incRes = await new sql.Request(transaction)
                                    .input('Art', sql.VarChar, String(exec.codArticulo).trim())
                                    .query(`
                                        SELECT PT.TerminacionID, PT.Cantidad, LTRIM(RTRIM(ISNULL(PT.Ubicacion, ''))) AS Ubicacion
                                        FROM ProductoTerminadoTerminaciones PT
                                        INNER JOIN ProductosTerminados P ON P.ID = PT.ProductoID
                                        INNER JOIN Terminaciones T ON T.TerminacionID = PT.TerminacionID AND T.Activo = 1
                                        WHERE LTRIM(RTRIM(P.CodArticulo)) = @Art
                                    `);
                                const archivoIdPT = resFile.recordset[0].ArchivoID;
                                for (const inc of incRes.recordset) {
                                    const cantInc = (parseFloat(inc.Cantidad) || 1) * (item.copies || 1);
                                    await new sql.Request(transaction)
                                        .input('OID', sql.Int, newOID)
                                        .input('AID', sql.Int, archivoIdPT)
                                        .input('TID', sql.Int, inc.TerminacionID)
                                        .input('Cnt', sql.Decimal(18, 2), cantInc)
                                        .input('Ubi', sql.VarChar(30), inc.Ubicacion || null)
                                        .query("INSERT INTO OrdenTerminaciones (OrdenID, ArchivoID, TerminacionID, Cantidad, Ubicacion) VALUES (@OID, @AID, @TID, @Cnt, @Ubi)");
                                }
                                if (incRes.recordset.length > 0) {
                                    logger.info(`[WebOrder] ${incRes.recordset.length} terminaciones INCLUIDAS del producto ${exec.codArticulo} registradas (orden ${newOID})`);
                                }
                            } catch (ePT) {
                                logger.warn('[WebOrder] No se pudieron registrar terminaciones incluidas del producto terminado:', ePT.message);
                            }
                        }

                        // CÁLCULO DE MAGNITUD TOTAL
                        // CORTE con tizada medida: la Magnitud NO sale de los metros de TELA del
                        // archivo sino de la medición del láser, según la UM del artículo de corte:
                        // 'u' → piezas × copias | 'm' → metros de corte × copias.
                        if (serviceId === 'corte' && !exec.isExtra && item.metrosCorte != null) {
                            totalMagnitud += (umLower === 'u')
                                ? (parseInt(item.piezas) || 0) * (item.copies || 1)
                                : (parseFloat(item.metrosCorte) || 0) * (item.copies || 1);
                        } else if (umLower === 'u') {
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
                        const finalNameBack = nombreNuevo
                            ? construirNombreArchivo({
                                material: materialNombreArchivo,
                                codigoOrden: exec.codigoOrden,
                                cliente: nombreCliente,
                                idx: i + 1,
                                total: exec.items.length,
                                copias: item.copies || 1,
                                ext: extBack,
                                dorso: true
                            })
                            : `${exec.codigoOrden.replace(/\//g, '-')}_${sanitize(nombreCliente)}_${sanitize(jobName)}_DORSO Archivo ${i + 1} de ${exec.items.length} (x${item.copies || 1})${extBack}`;

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
                            fileKey: item.fileBackKey || null,
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
                } else if (String(exec.areaID || '').toUpperCase() === 'TPU' && !exec.isExtra) {
                    // TPU (boceto): el cliente sube un boceto, no arte, así que no hay ArchivosOrden que
                    // lleven la cantidad. La Magnitud (unidades de TPU a producir) sale de los items o
                    // del magnitudInicial ya calculado — tolerante a cantidad/copies, porque con un solo
                    // nombre de campo esto quedaba en 0 y la orden mostraba "0 U" en todos lados.
                    const cantTpu = (exec.items || []).reduce((s, it) => s + (parseInt(it?.cantidad ?? it?.copies) || 0), 0)
                        || parseInt(exec.magnitudInicial) || 0;
                    if (cantTpu > 0) {
                        // Entero y como texto: TPU se mide en UNIDADES. Con Decimal(10,2) el CAST dejaba
                        // "15.00" y la planilla mostraba "15.00 U" — medio parche no existe.
                        await new sql.Request(transaction).input('OID', sql.Int, newOID).input('Mag', sql.VarChar(50), String(Math.round(cantTpu)))
                            .query("UPDATE Ordenes SET Magnitud = @Mag WHERE OrdenID = @OID");
                    } else {
                        logger.warn(`[WebOrder][TPU] Orden ${newOID}: sin cantidad en items ni magnitudInicial — queda Magnitud 0. items=${JSON.stringify((exec.items || []).map(i => ({ c: i?.cantidad, k: i?.copies })))}`);
                    }
                }

                // HERMANA TERMINAC DESDE EL INGRESO (pedido negocio 28/07): si la orden ECOUV
                // quedó con terminaciones, la orden hermana XEUV-{doc} se crea YA (visible en la
                // bandeja y planilla de TERMINAC desde el minuto uno) y la ECOUV queda ruteada
                // con ProximoServicio=TERMINAC. Antes esto pasaba recién al aprobar control.
                if (String(exec.areaID || '').toUpperCase() === 'ECOUV') {
                    try {
                        const { crearHermanaTerminaciones } = require('../utils/hermanaTerminaciones');
                        await crearHermanaTerminaciones(transaction, newOID);
                    } catch (eHer) {
                        logger.warn(`[WebOrder] No se pudo crear la hermana de terminaciones de la orden ${newOID}:`, eHer.message);
                    }
                }

                // --- DEPURACIÓN: LOG DE REFERENCIAS ---
                // logger.info(`[Order ${exec.codigoOrden}] RefCount: ${exec.referencias?.length || 0}`);

                // --- ARCHIVOS DE REFERENCIA ---

                // 0. REFERENCIAS VINCULADAS AL SERVICIO (Nueva Lógica)
                if (exec.referencias && exec.referencias.length > 0) {
                    for (const ref of exec.referencias) {
                        // Si la referencia trae "etiqueta" (ej: boceto Twinface "Boceto Archivo 1 de 3"),
                        // el nombre guardado usa la etiqueta + la extensión real, para identificar a qué
                        // archivo pertenece. El originalName (match de subida) sigue siendo ref.name.
                        let baseName = sanitize(ref.name);
                        if (ref.etiqueta) {
                            const dot = ref.name.lastIndexOf('.');
                            const ext = dot > 0 ? ref.name.substring(dot) : '';
                            baseName = `${sanitize(ref.etiqueta)}${ext}`;
                        }
                        const fName = `REF-${erpDocNumber}-${baseName}`;
                        const tipo = ref.tipo || 'REFERENCIA';

                        // TIZADAS (ARCHIVO_CORTE): el portal las mide al subirlas y manda
                        // piezas + metros de corte del láser; quedan guardados en el archivo.
                        const resRef = await new sql.Request(transaction)
                            .input('OID', sql.Int, newOID)
                            .input('Tipo', sql.VarChar(50), tipo)
                            .input('Nom', sql.VarChar(200), fName)
                            .input('Piezas', sql.Int, (ref.piezas !== undefined && ref.piezas !== null) ? parseInt(ref.piezas) : null)
                            .input('MetrosCorte', sql.Decimal(10, 3), (ref.metrosCorte !== undefined && ref.metrosCorte !== null) ? parseFloat(ref.metrosCorte) : null)
                            .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage, Piezas, MetrosCorte) OUTPUT INSERTED.RefID VALUES (@OID, @Tipo, @Nom, GETDATE(), 'Pendiente', @Piezas, @MetrosCorte)`);

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
                // EXCEPTO el corte standalone PRINCIPAL: esa orden ya carga el artículo 1375 con la
                // magnitud medida y se cotiza por su propia línea — la fila acá la duplicaba.
                // [BORDADO] Mismo caso que el corte: la orden principal de bordado YA
                // lleva su artículo (107/108/109/1630 según tipo y relleno) y se cotiza
                // por su propia línea. La fila de acá le agregaba una SEGUNDA línea con
                // el mismo artículo, así que el pedido salía cobrado dos veces.
                const esPrincipalConArticuloPropio =
                    (serviceId === 'corte' || serviceId === 'bordado') && !exec.isExtra;
                if (!esPrincipalConArticuloPropio && (exec.isExtra || ['EST', 'EMB', 'TWT', 'TWC'].includes(exec.areaID))) {
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

            // [CAPACIDAD] Fecha Compromiso de Bordado: se calcula con la cola real + capacidad
            // real del área (no el fijo de sp_CalcularFechaEntrega) y queda CONGELADA — no se
            // recalcula después aunque cambie la cola. Un pedido con varios diseños EMB recibe
            // UNA sola fecha: la más tardía entre todos. No bloqueante: si falla, el pedido se
            // crea igual, sin FechaCompromiso (el motor cae a FechaEstimadaEntrega fija).
            try {
                const disenosEmbCreados = pendingOrderExecutions.filter(e => e.areaID === 'EMB' && e.magnitudCapacidadInicial > 0 && e.newOrdenID);
                if (disenosEmbCreados.length > 0) {
                    const { calcularFechaCompromiso } = require('./planificacionController');
                    const confRes = await pool.request().query("SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'EMB_DIAS_PREPARACION_MATRIZ'");
                    const diasColchon = confRes.recordset.length > 0 ? (parseInt(confRes.recordset[0].Valor, 10) || 0) : 0;

                    // pool.request() (NO la transacción en curso): tiene que ver la cola SIN las
                    // filas que se acaban de insertar en este mismo pedido (todavía sin commit).
                    const fechas = await calcularFechaCompromiso(
                        pool, 'EMB',
                        disenosEmbCreados.map(e => ({ magnitud: e.magnitudCapacidadInicial, prioridad: finalUrgency })),
                        diasColchon
                    );
                    const fechaMasTardia = fechas.filter(Boolean).sort().pop();

                    if (fechaMasTardia) {
                        const idsCsv = disenosEmbCreados.map(e => e.newOrdenID).join(',');
                        await new sql.Request(transaction)
                            .input('Fecha', sql.Date, fechaMasTardia)
                            .query(`UPDATE Ordenes SET FechaCompromiso = @Fecha WHERE OrdenID IN (${idsCsv})`);
                        // Para devolverla en la respuesta — el cliente ve la fecha real apenas confirma.
                        fechaCompromisoEmb = fechaMasTardia;
                    }
                }
            } catch (fechaCompromisoErr) {
                logger.error(`⚠️ calcularFechaCompromiso falló para el pedido: ${fechaCompromisoErr.message}`);
            }

            await transaction.commit();

            // RESPUESTA AL FRONTEND: "Orden Creada, Ahora Sube los Archivos"
            res.json({
                success: true,
                orderIds: generatedOrders,
                requiresUpload: filesToUpload.length > 0,
                uploadManifest: filesToUpload,
                fechaCompromisoEmb // 'YYYY-MM-DD' o null si el pedido no llevaba Bordado (o no se pudo calcular)
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
// Mide un archivo de arte y devuelve { w, h } en METROS (o null si no se puede medir).
// PDF: MediaBox de la 1ª página, aplicando /UserUnit y /Rotate — así el ancho/alto reflejan cómo
// se VE el trabajo (igual que el medidor del front), y un PDF girado 90° no pasa como si fuera correcto.
// Imagen: px / densidad (DPI). El arte del portal es PNG o PDF; JPEG ya está bloqueado aguas arriba.
const medirArteMetros = async (buf, nombre, mime) => {
    const ptToM = (pt) => (pt * 0.0254) / 72;
    const nom = String(nombre || '').toLowerCase();
    const mm = String(mime || '').toLowerCase();
    const esPdf = mm.includes('pdf') || nom.endsWith('.pdf') || buf.slice(0, 4).toString() === '%PDF';
    if (esPdf) {
        const { PDFDocument, PDFName } = require('pdf-lib');
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
        const page = doc.getPages()[0];
        if (!page) return null;
        let { width, height } = page.getSize();
        // UserUnit: los PDF de más de ~5.08m traen multiplicador; sin esto se miden N veces más chicos.
        let uu = 1;
        try { const u = page.node.get(PDFName.of('UserUnit')); const n = u && u.asNumber ? u.asNumber() : NaN; if (Number.isFinite(n) && n > 0) uu = n; } catch (_) { }
        width *= uu; height *= uu;
        // /Rotate 90|270 → el trabajo se ve girado: intercambiamos ancho/alto (mismo criterio que el front).
        const rot = (((page.getRotation()?.angle || 0) % 360) + 360) % 360;
        if (rot === 90 || rot === 270) { const t = width; width = height; height = t; }
        return { w: ptToM(width), h: ptToM(height) };
    }
    const sharp = require('sharp');
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const dpi = meta.density || 72;
    const pxToM = (px) => (px / dpi) * 0.0254;
    return { w: pxToM(meta.width), h: pxToM(meta.height) };
};

exports.uploadOrderFile = async (req, res) => {
    const { dbId, type, finalName, area, codigoOrden } = req.body;
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

        // ── Validación DURA de páginas: rechazar PDFs de arte multipágina ANTES de subir nada.
        //    Regla: 1 archivo de arte = 1 página. La validación del front (pdf.js) tiene un hueco —
        //    si no puede contar deja pageCount=null y NO bloquea, así entraban PDFs de 2 páginas
        //    (mal medidos, además, porque solo se medía la 1ª). pdf-lib en el server es confiable y
        //    cubre este punto por el que pasan todas las subidas del portal. Solo aplica al arte
        //    (type='ORDEN'); las referencias (REF) pueden ser multipágina.
        const esArtePdf = type === 'ORDEN'
            && ((file.mimetype || '').toLowerCase().includes('pdf') || (finalName || '').toLowerCase().endsWith('.pdf'));
        if (esArtePdf) {
            try {
                const pdfBuf = file.buffer || await require('fs').promises.readFile(file.path);
                const { PDFDocument } = require('pdf-lib');
                const pdfDoc = await PDFDocument.load(pdfBuf, { ignoreEncryption: true, updateMetadata: false });
                const paginas = pdfDoc.getPageCount();
                if (paginas > 1) {
                    logger.warn(`[UploadStream] RECHAZADO ${finalName}: PDF de ${paginas} páginas (solo se permite 1).`);
                    return res.status(400).json({ error: `El archivo tiene ${paginas} páginas. Solo se permite 1 página por archivo.` });
                }
            } catch (ePdf) {
                // pdf-lib no pudo abrirlo (corrupto/encriptado atípico). No se bloquea por NO poder contar:
                // la regla es rechazar multipágina detectada, no trabar archivos ilegibles.
                logger.warn(`[UploadStream] No se pudo contar páginas de ${finalName}: ${ePdf.message}`);
            }
        }

        // ── Validación DURA de MEDIDA FIJA (banderas confeccionadas) ────────────────────────────
        //    El arte debe medir exactamente anchoimprimible x largoimprimible del artículo (±2mm).
        //    Blindaje server-side: el chequeo del portal es solo client-side y no cubre a un cliente
        //    desactualizado ni un payload manual. Solo aplica al arte (type='ORDEN') de materiales con
        //    largoimprimible > 0. Fail-open si no se puede medir (misma filosofía que el conteo de páginas).
        if (type === 'ORDEN') {
            // Paso 1 — averiguar si el material es de medida fija. Si esta consulta falla, fail-open:
            // no sabemos si aplica, y no se puede bloquear una subida por un problema de la consulta.
            let anchoFijo = 0, largoFijo = 0, matNombre = '';
            try {
                const poolMed = await getPool();
                const medRes = await poolMed.request()
                    .input('ID', sql.Int, parseInt(dbId, 10))
                    .query(`
                        SELECT TOP 1 a.anchoimprimible AS Ancho, a.largoimprimible AS Largo, O.Material
                        FROM ArchivosOrden AO
                        JOIN Ordenes O ON O.OrdenID = AO.OrdenID
                        LEFT JOIN dbo.articulos a ON LTRIM(RTRIM(a.Descripcion)) = LTRIM(RTRIM(O.Material))
                        WHERE AO.ArchivoID = @ID
                    `);
                const row = medRes.recordset[0];
                anchoFijo = parseFloat(row?.Ancho) || 0;
                largoFijo = parseFloat(row?.Largo) || 0;
                matNombre = row?.Material || 'Este material';
            } catch (eCfg) {
                logger.warn(`[UploadStream] No se pudo leer la config de medida fija de ${finalName}: ${eCfg.message}`);
            }

            // Paso 2 — si ES de medida fija, la medida es lo único que importa: acá NO hay fail-open.
            // Si el arte no se puede medir, se rechaza (antes se dejaba pasar con un warning y entraban
            // banderas sin el margen de confección, imposibles de detectar después).
            if (anchoFijo > 0 && largoFijo > 0) {
                let dims = null;
                try {
                    const bufMed = file.buffer || await require('fs').promises.readFile(file.path);
                    dims = await medirArteMetros(bufMed, finalName, file.mimetype);
                } catch (eMed) {
                    logger.warn(`[UploadStream] No se pudo medir ${finalName} (medida fija): ${eMed.message}`);
                }

                if (!dims || !(dims.w > 0) || !(dims.h > 0)) {
                    logger.warn(`[UploadStream] RECHAZADO ${finalName}: MEDIDA FIJA ${anchoFijo.toFixed(2)}x${largoFijo.toFixed(2)}m — no se pudo medir el archivo`);
                    return res.status(400).json({
                        error: `"${matNombre}" se imprime a MEDIDA FIJA (${anchoFijo.toFixed(2)}m x ${largoFijo.toFixed(2)}m) y no pudimos leer las medidas de tu archivo, así que no podemos aceptarlo. Volvé a exportarlo como PDF con la medida exacta, o escribinos a Atención al Cliente.`
                    });
                }

                const TOL = 0.002; // 2mm, igual que el front
                const fuera = (real, esp) => Math.abs(real - esp) > TOL + 1e-9;
                if (fuera(dims.w, anchoFijo) || fuera(dims.h, largoFijo)) {
                    logger.warn(`[UploadStream] RECHAZADO ${finalName}: MEDIDA FIJA ${anchoFijo.toFixed(2)}x${largoFijo.toFixed(2)}m, archivo ${dims.w.toFixed(2)}x${dims.h.toFixed(2)}m`);
                    return res.status(400).json({
                        error: `"${matNombre}" se imprime a MEDIDA FIJA: el archivo debe medir exactamente ${anchoFijo.toFixed(2)}m de ancho x ${largoFijo.toFixed(2)}m de largo. Tu archivo mide ${dims.w.toFixed(2)}m x ${dims.h.toFixed(2)}m. Ajustá el archivo a la medida exacta (sin rotar).`
                    });
                }
            }
        }

        const driveUrl = await driveService.uploadToDrive(fileInput, finalName, area || 'GENERAL');

        // Con diskStorage NO hay file.buffer (solo file.path). Leemos el archivo del tmp a un buffer
        // para el thumbnail + perfil ICC. El buffer queda en memoria, independiente del tmp (que se
        // borra en el finally), así que las tareas en background funcionan aunque el tmp ya no exista.
        let procBuffer = file.buffer || null;
        const wantThumb   = !!(codigoOrden && dbId);
        const wantProfile = !!(type === 'ORDEN' && dbId);
        if (!procBuffer && file.path && (wantThumb || wantProfile)) {
            try {
                procBuffer = await require('fs').promises.readFile(file.path);
            } catch (e) {
                logger.warn('[UploadStream] No se pudo leer el tmp para thumbnail/perfil: ' + e.message);
            }
        }

        // Generar thumbnail en background si tenemos el buffer. Quién puede tener miniatura lo
        // decide el generador mirando los primeros bytes: filtrar acá por nombre dejaba sin
        // miniatura a los archivos cuya extensión no delata el tipo (o no la tienen).
        if (procBuffer && wantThumb) {
            generateThumbnail(procBuffer, codigoOrden, dbId, finalName).catch(e =>
                logger.warn('[Thumbnail] Error async generando thumbnail:', e.message)
            );
        }

        // [DTF] Capa de tinta blanca automática (solo arte del área DF — el filtro fino lo hace
        // el propio servicio mirando la orden). Se llama ACÁ, antes del finally que borra el
        // temporal: el servicio copia el archivo de forma sincrónica y procesa en su cola de a
        // uno, sin bloquear la respuesta. Best-effort: jamás afecta la subida.
        if (type === 'ORDEN' && tmpPath) {
            try {
                const { encolarSiCorresponde } = require('../services/dtfBlancoService');
                encolarSiCorresponde({ archivoId: parseInt(dbId, 10), tmpPath, nombreArchivo: finalName, codigoOrden });
            } catch (eDtf) {
                logger.warn('[DTF-Blanco] no se pudo encolar: ' + eDtf.message);
            }
        }

        // Leer y guardar el perfil de color ICC incrustado (solo archivos de producción).
        // Fire-and-forget como el thumbnail: no bloquea la respuesta de subida.
        if (procBuffer && wantProfile) {
            const { extractColorProfile } = require('../utils/colorProfile');
            extractColorProfile(procBuffer, finalName)
                .then(async (perfil) => {
                    if (!perfil) return;
                    const p = await getPool();
                    await p.request()
                        .input('ID', sql.Int, dbId)
                        .input('Perfil', sql.NVarChar(200), perfil)
                        .query('UPDATE ArchivosOrden SET PerfilColor = @Perfil WHERE ArchivoID = @ID');
                    logger.info(`🎨 [ColorProfile] ArchivoID=${dbId}: ${perfil}`);
                })
                .catch(e => logger.warn('[ColorProfile] Error guardando perfil:', e.message));
        }

        // Preflight de arte (motor Python con las reglas de las guías USER): medidas vs
        // material, DPI efectivo, fuentes no embebidas, transparencias, espacios de color.
        // Guarda veredicto + reporte en ArchivosOrden. Fire-and-forget: nunca bloquea la subida.
        // DESACTIVADO por defecto — se enciende con PREFLIGHT_ENABLED=1 en el .env cuando se decida usarlo.
        if (process.env.PREFLIGHT_ENABLED === '1' && procBuffer && type === 'ORDEN' && dbId) {
            const { runPreflight, servicioPorArea, anchoCmDesdeMaterial } = require('../utils/preflight');
            const servicioPre = servicioPorArea(area);
            if (servicioPre) {
                (async () => {
                    try {
                        const p = await getPool();
                        const matRes = await p.request()
                            .input('ID', sql.Int, dbId)
                            .query('SELECT O.Material FROM ArchivosOrden AO JOIN Ordenes O ON O.OrdenID = AO.OrdenID WHERE AO.ArchivoID = @ID');
                        const anchoCm = anchoCmDesdeMaterial(matRes.recordset[0]?.Material);
                        const pre = await runPreflight(procBuffer, finalName, { servicio: servicioPre, anchoTelaCm: anchoCm });
                        if (!pre || !pre.veredicto) return;
                        await p.request()
                            .input('ID', sql.Int, dbId)
                            .input('V', sql.NVarChar(40), pre.veredicto)
                            .input('R', sql.NVarChar(sql.MAX), JSON.stringify({ reporte: pre.reporte, mensaje_cliente: pre.mensajeCliente }))
                            .query('UPDATE ArchivosOrden SET PreflightVeredicto = @V, PreflightReporte = @R WHERE ArchivoID = @ID');
                        logger.info(`🧪 [Preflight] ArchivoID=${dbId} (${servicioPre}): ${pre.veredicto}`);
                    } catch (e) {
                        logger.warn('[Preflight] Error guardando resultado:', e.message);
                    }
                })();
            }
        }

        const pool = await getPool();
        let orderID = null;

        if (type === 'ORDEN') {
            const resUpd = await pool.request()
                .input('ID', sql.Int, dbId)
                .input('Url', sql.VarChar(500), driveUrl)
                .query(`
                    UPDATE ArchivosOrden
                    SET RutaAlmacenamiento = @Url, EstadoArchivo = 'Pendiente', FechaSubida = GETDATE()
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
                    OUTPUT INSERTED.OrdenID, INSERTED.TipoArchivo
                    WHERE RefID = @ID
                `);
            if (resUpd.recordset.length > 0) {
                orderID = resUpd.recordset[0].OrdenID;

                // [BORDADO] La fila del diseño en ArchivosOrden guarda las medidas, las
                // puntadas y la paleta, pero el archivo en sí se sube como referencia.
                // Sin esta copia de la URL, el área abría el diseño desde "Archivos de
                // Impresión" y le salía "no hay archivo válido asociado".
                // Se sube UNA sola vez: acá solo se apunta a lo ya subido.
                if ((resUpd.recordset[0].TipoArchivo || '').toUpperCase() === 'LOGO_BORDADO') {
                    await pool.request()
                        .input('OID', sql.Int, orderID)
                        .input('Url', sql.VarChar(500), driveUrl)
                        .query(`
                            UPDATE ArchivosOrden
                            SET RutaAlmacenamiento = @Url, EstadoArchivo = 'Pendiente'
                            WHERE OrdenID = @OID AND TipoArchivo = 'BORDADO'
                              AND RutaAlmacenamiento IS NULL
                        `);
                }
            }
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
                // F4 — Pedido creado por un DISEÑADOR con el toggle de aprobación del cliente activado:
                // NO se activa. Queda en 'Cargando...' (invisible para producción) con AprobacionPendiente=1
                // hasta que el cliente lo apruebe desde el portal (aprobarPedido).
                const holdRes = await pool.request().input('OID', sql.Int, orderID).query(`
                    SELECT o.DisenadorID, ISNULL(c.AprobarPedidosDisenador, 0) AS Aprobar
                    FROM Ordenes o LEFT JOIN Clientes c ON c.CodCliente = o.CodCliente
                    WHERE o.OrdenID = @OID
                `);
                const hold = holdRes.recordset[0];
                if (hold?.DisenadorID && hold.Aprobar) {
                    await pool.request().input('OID', sql.Int, orderID)
                        .query("UPDATE Ordenes SET AprobacionPendiente = 1 WHERE OrdenID = @OID AND Estado = 'Cargando...'");
                    logger.info(`🎨 [Disenador] Orden ${orderID} completa pero RETENIDA: esperando aprobación del cliente.`);
                    const ioHold = req.app.get('socketio');
                    if (ioHold) ioHold.emit('server:ordersUpdated', { count: 1, source: 'web-upload-hold' });
                    return res.json({ success: true, driveUrl, esperandoAprobacion: true });
                }

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

    // Buscador de Mi Fábrica (?q=): se filtra ACÁ, sobre la lista entera del cliente — código,
    // N° de documento ERP y título — y no en el portal, que solo veía las páginas ya cargadas por
    // el scroll infinito. Substring sin distinguir mayúsculas (LOWER de los dos lados: no depende
    // de la collation). Los contadores de las pestañas también respetan la búsqueda.
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
    const qLike = q ? `%${q.replace(/[!%_\[]/g, '!$&')}%` : null;
    const filtroBusqWeb = qLike ? `AND (LOWER(o.CodigoOrden) LIKE @qLike ESCAPE '!'
                           OR LOWER(ISNULL(o.NoDocERP, '')) LIKE @qLike ESCAPE '!'
                           OR LOWER(ISNULL(o.DescripcionTrabajo, '')) LIKE @qLike ESCAPE '!')` : '';
    const filtroBusqErp = qLike ? `AND (LOWER(o.OrdCodigoOrden) LIKE @qLike ESCAPE '!'
                           OR LOWER(ISNULL(o.OrdNombreTrabajo, '')) LIKE @qLike ESCAPE '!')` : '';

    try {
        const pool = await getPool();
        // El SELECT lee OrdenTexturasTPU (flag TieneTexturas): garantizar el schema TPU primero.
        await exports.ensureColFechaAprobacion(pool);

        // 1. Calcular contadores globales (solo en la página 1 para no repetir trabajo)
        let counts = null;
        if (page === 1) {
            const countsQuery = await pool.request()
                // OJO con el tipo: Ordenes.CodCliente es nchar(10) y Clientes.CodCliente es int.
                // Con un parámetro Int, SQL convierte la COLUMNA de Ordenes (el int tiene más
                // precedencia) y la condición pasa a ser CONVERT(INT, o.CodCliente) = @cod:
                // no puede usar IX_Ordenes_CodCliente y escanea la tabla entera. Como texto,
                // Ordenes hace seek y Clientes convierte el parámetro (un solo valor, gratis).
                .input('cod', sql.NVarChar(10), String(codCliente ?? ''))
                .input('qLike', sql.NVarChar(250), qLike)
                .query(`
                    SELECT ISNULL(o.NoDocERP, o.CodigoOrden) AS DocID, o.Estado, 'WEB' AS Origen
                    FROM Ordenes o WITH(NOLOCK)
                    WHERE o.CodCliente = @cod
                      AND o.CodigoOrden NOT LIKE '%-F%'   -- las fallas (-F) son internas: no cuentan para el cliente
                      AND ISNULL(o.AreaID,'') <> 'TERMINAC'  -- la hermana de terminaciones es interna: el cliente ve su pedido, no el trabajo interno
                      ${filtroBusqWeb}
                    UNION ALL
                    SELECT o.OrdCodigoOrden AS DocID, e.EOrNombreEstado AS Estado, 'ERP' AS Origen
                    FROM OrdenesDeposito o WITH(NOLOCK)
                    INNER JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                    LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                    WHERE c.CodCliente = @cod
                      -- Un pedido web finalizado también vive en OrdenesDeposito (circuito de retiro):
                      -- si ya tiene su orden de producción, no contarlo dos veces.
                      AND NOT EXISTS (
                          SELECT 1 FROM Ordenes o2 WITH(NOLOCK)
                          WHERE o2.CodCliente = @cod
                            AND LTRIM(RTRIM(o2.CodigoOrden)) = LTRIM(RTRIM(o.OrdCodigoOrden))
                      )
                      ${filtroBusqErp}
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
            // Texto, no Int: ver la nota de tipos en getMisPedidosResumen (Ordenes.CodCliente
            // es nchar(10) y un parámetro Int mata el índice).
            .input('cod', sql.NVarChar(10), String(codCliente ?? ''))
            .input('Offset', sql.Int, offset)
            .input('Limit', sql.Int, limit)
            .input('qLike', sql.NVarChar(250), qLike)
            .query(`
                SELECT * FROM (
                    SELECT
                        o.OrdenID       AS OrdenID,
                        o.CodigoOrden   AS CodigoOrden,
                        o.NoDocERP      AS NoDocERP,
                        o.DescripcionTrabajo AS DescripcionTrabajo,
                        o.Material      AS Material,
                        o.FechaIngreso  AS FechaIngreso,
                        o.Estado        AS Estado,
                        COALESCE(ar.Nombre, o.AreaID) AS AreaID,
                        'WEB'           AS Origen,
                        mc.Titulo       AS MotivoCancelacion,
                        o.DetallesCancelacion AS DetallesCancelacion,
                        m.Nombre        AS NombreMaquina,
                        o.Magnitud      AS Magnitud,
                        o.UM            AS UM,
                        -- TPU: el cliente ve el BOCETO DE PRODUCCIÓN (arte con 'boceto' en el nombre);
                        -- fallback al 'cmyk' para órdenes anteriores al cambio (5 capas sin boceto).
                        (SELECT TOP 1 ArchivoID FROM ArchivosOrden WITH(NOLOCK)
                         WHERE OrdenID = o.OrdenID AND RutaAlmacenamiento IS NOT NULL
                           AND (UPPER(LTRIM(RTRIM(o.AreaID))) <> 'TPU' OR LOWER(NombreArchivo) LIKE '%boceto%' OR LOWER(NombreArchivo) LIKE '%cmyk%')
                         ORDER BY CASE WHEN UPPER(LTRIM(RTRIM(o.AreaID))) = 'TPU' AND LOWER(NombreArchivo) LIKE '%boceto%' THEN 0 ELSE 1 END, ArchivoID ASC) AS PrimerArchivoID,
                        (SELECT TOP 1 RutaAlmacenamiento FROM ArchivosOrden WITH(NOLOCK)
                         WHERE OrdenID = o.OrdenID AND RutaAlmacenamiento IS NOT NULL
                           AND (UPPER(LTRIM(RTRIM(o.AreaID))) <> 'TPU' OR LOWER(NombreArchivo) LIKE '%boceto%' OR LOWER(NombreArchivo) LIKE '%cmyk%')
                         ORDER BY CASE WHEN UPPER(LTRIM(RTRIM(o.AreaID))) = 'TPU' AND LOWER(NombreArchivo) LIKE '%boceto%' THEN 0 ELSE 1 END, ArchivoID ASC) AS DriveFileId,
                        ISNULL(o.AprobacionPendiente, 0) AS AprobacionPendiente,
                        -- ¿Ya aprobó? Una vez aprobado, el portal esconde el cancelar (la regla se
                        -- refuerza también en deleteIncompleteOrder/deleteOrderBundle).
                        CASE WHEN o.FechaAprobacionCliente IS NOT NULL THEN 1 ELSE 0 END AS Aprobado,
                        -- TPU: ¿el cliente ya guardó texturas? Distingue las dos vías de aprobación
                        -- (con texturas propias vs "que elija el diseñador") para el texto del ✓.
                        CASE WHEN EXISTS (
                            SELECT 1 FROM dbo.OrdenTexturasTPU t
                            WHERE t.OrdenID = o.OrdenID AND t.ElegidaPor = 'CLIENTE'
                              AND (t.ArchivoTextura IS NOT NULL OR t.Barniz = 1)
                        ) THEN 1 ELSE 0 END AS TieneTexturas,
                        -- El visor 3D arma el parche con el BOCETO DE PRODUCCIÓN (cmyk como fallback
                        -- para pedidos anteriores al cambio de flujo). Sin el flag, el botón "Ver 3D"
                        -- aparecía siempre — también en órdenes sin ninguna capa — y siempre fallaba.
                        -- Tiene que ser PDF: el corte suele venir en .plt y no se puede rasterizar.
                        CASE WHEN EXISTS (
                            SELECT 1 FROM ArchivosOrden x WITH(NOLOCK)
                            WHERE x.OrdenID = o.OrdenID AND x.RutaAlmacenamiento IS NOT NULL
                              AND ISNULL(x.EstadoArchivo,'') <> 'Cancelado'
                              AND LOWER(x.NombreArchivo) LIKE '%.pdf'
                              AND (LOWER(x.NombreArchivo) LIKE '%boceto%' OR LOWER(x.NombreArchivo) LIKE '%cmyk%')
                        ) THEN 1 ELSE 0 END AS TieneArte3D,
                        o.DisenadorID   AS DisenadorID,
                        dis.Nombre      AS DisenadorNombre
                    FROM Ordenes o WITH(NOLOCK)
                    LEFT JOIN MotivosCancelacion mc ON mc.MotivoID = o.MotivoCancelacionID
                    LEFT JOIN Areas ar WITH(NOLOCK) ON ar.AreaID = o.AreaID
                    LEFT JOIN ConfigEquipos m WITH(NOLOCK) ON m.EquipoID = o.MaquinaID
                    LEFT JOIN Disenadores dis WITH(NOLOCK) ON dis.DisenadorID = o.DisenadorID
                    WHERE o.CodCliente = @cod
                      AND o.CodigoOrden NOT LIKE '%-F%'   -- las fallas (-F) son internas: no se muestran al cliente
                      AND ISNULL(o.AreaID,'') <> 'TERMINAC'  -- ídem la hermana XEUV: es el trabajo de terminación, no una pieza más del pedido
                      ${filtroBusqWeb}

                    UNION ALL

                    SELECT
                        o.OrdIdOrden        AS OrdenID,
                        o.OrdCodigoOrden    AS CodigoOrden,
                        o.OrdCodigoOrden    AS NoDocERP,
                        o.OrdNombreTrabajo  AS DescripcionTrabajo,
                        art.Descripcion     AS Material,
                        o.OrdFechaEstadoActual AS FechaIngreso,
                        e.EOrNombreEstado   AS Estado,
                        NULL                AS AreaID,
                        'ERP'               AS Origen,
                        NULL                AS MotivoCancelacion,
                        NULL                AS DetallesCancelacion,
                        NULL                AS NombreMaquina,
                        NULL                AS Magnitud,
                        NULL                AS UM,
                        NULL                AS PrimerArchivoID,
                        NULL                AS DriveFileId,
                        0                   AS AprobacionPendiente,
                        0                   AS Aprobado,
                        0                   AS TieneTexturas,
                        0                   AS TieneArte3D,
                        NULL                AS DisenadorID,
                        NULL                AS DisenadorNombre
                    FROM OrdenesDeposito o WITH(NOLOCK)
                    INNER JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                    LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                    LEFT JOIN Monedas mo WITH(NOLOCK) ON mo.MonIdMoneda = o.MonIdMoneda
                    LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = o.ProIdProducto
                    WHERE c.CodCliente = @cod
                      -- Un pedido web finalizado también vive en OrdenesDeposito (circuito de retiro):
                      -- se muestra solo la orden de producción (tiene archivos, magnitud y estados completos).
                      -- Este ramal queda para pedidos de mostrador que NO existen en Ordenes.
                      AND NOT EXISTS (
                          SELECT 1 FROM Ordenes o2 WITH(NOLOCK)
                          WHERE o2.CodCliente = @cod
                            AND LTRIM(RTRIM(o2.CodigoOrden)) = LTRIM(RTRIM(o.OrdCodigoOrden))
                      )
                      ${filtroBusqErp}
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

// Columnas Ordenes.FechaAprobacionCliente / FechaRechazoCliente (auto-heal, mismo patrón que
// ensureOrderColumns): cuándo aprobó / cuándo rechazó el boceto el cliente. NULL = nunca.
// ALTER de columna nullable = solo metadata, instantáneo.
let _colAprobEnsured = false;
exports.ensureColFechaAprobacion = async (pool) => {
    if (_colAprobEnsured) return;
    await pool.request().query(`
        IF COL_LENGTH('dbo.Ordenes', 'FechaAprobacionCliente') IS NULL
            ALTER TABLE dbo.Ordenes ADD FechaAprobacionCliente DATETIME NULL;
        IF COL_LENGTH('dbo.Ordenes', 'FechaRechazoCliente') IS NULL
            ALTER TABLE dbo.Ordenes ADD FechaRechazoCliente DATETIME NULL;
        IF COL_LENGTH('dbo.Ordenes', 'TexturasElige') IS NULL
            ALTER TABLE dbo.Ordenes ADD TexturasElige VARCHAR(10) NULL; -- se fija AL APROBAR: 'CLIENTE' (eligió texturas) · 'DISENADOR' (aprobó sin elegir → las define el diseñador)
        IF OBJECT_ID('dbo.OrdenTexturasTPU', 'U') IS NULL
            CREATE TABLE dbo.OrdenTexturasTPU (
                OrdenID                INT           NOT NULL,
                ZonaIndice             INT           NOT NULL,
                ArchivoTextura         NVARCHAR(255) NULL,
                Barniz                 BIT           NOT NULL CONSTRAINT DF_OrdTexTPU_Barniz DEFAULT (0),
                ElegidaPor             VARCHAR(10)   NOT NULL CONSTRAINT DF_OrdTexTPU_Por    DEFAULT ('CLIENTE'),
                FechaEleccion          DATETIME      NOT NULL CONSTRAINT DF_OrdTexTPU_Fecha  DEFAULT (GETDATE()),
                ModificadaPorUsuarioID INT           NULL,
                FechaModificacion      DATETIME      NULL,
                CONSTRAINT PK_OrdenTexturasTPU PRIMARY KEY CLUSTERED (OrdenID, ZonaIndice)
            );
        IF COL_LENGTH('dbo.OrdenTexturasTPU', 'Barniz') IS NULL
            ALTER TABLE dbo.OrdenTexturasTPU ADD Barniz BIT NOT NULL CONSTRAINT DF_OrdTexTPU_Barniz DEFAULT (0);
        -- Cómo queda puesta la textura en la zona (lo que el cliente ajusta en el visor 3D).
        -- NULL = nunca se tocó → el visor usa el default del catálogo (texturas.json).
        IF COL_LENGTH('dbo.OrdenTexturasTPU', 'Escala') IS NULL
            ALTER TABLE dbo.OrdenTexturasTPU ADD Escala FLOAT NULL;   -- 1 = tamaño de catálogo; 2 = el doble de grande
        IF COL_LENGTH('dbo.OrdenTexturasTPU', 'Altura') IS NULL
            ALTER TABLE dbo.OrdenTexturasTPU ADD Altura FLOAT NULL;   -- cuánto sobresale el relieve
        IF COL_LENGTH('dbo.OrdenTexturasTPU', 'OffsetX') IS NULL
            ALTER TABLE dbo.OrdenTexturasTPU ADD OffsetX FLOAT NULL;  -- 0..1 dentro de UNA repetición (0.5 = sin correr)
        IF COL_LENGTH('dbo.OrdenTexturasTPU', 'OffsetY') IS NULL
            ALTER TABLE dbo.OrdenTexturasTPU ADD OffsetY FLOAT NULL;
    `);
    _colAprobEnsured = true;
};

// POST /api/web-orders/aprobar-pedido — F4 diseñadores: el CLIENTE aprueba un pedido retenido.
// Solo con token de cliente (la ruta NO pasa por impersonarCliente: un diseñador no puede aprobar).
// Limpia AprobacionPendiente y ejecuta la misma activación que hace uploadOrderFile al completar archivos.
exports.aprobarPedido = async (req, res) => {
    try {
        const codCliente = req.user?.codCliente;
        const ordenId = parseInt(req.body?.ordenId);
        if (!codCliente || req.user?.role !== 'WEB_CLIENT' || req.disenadorId) {
            return res.status(403).json({ error: 'Solo el cliente puede aprobar sus pedidos.' });
        }
        if (!ordenId) return res.status(400).json({ error: 'Falta ordenId.' });

        const pool = await getPool();
        const check = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Cod', sql.Int, codCliente)
            .query(`
                SELECT OrdenID, AreaID FROM Ordenes
                WHERE OrdenID = @OID AND CodCliente = @Cod
                  AND ISNULL(AprobacionPendiente, 0) = 1
            `);
        if (check.recordset.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado o ya aprobado.' });
        }
        const esTPUAprob = String(check.recordset[0].AreaID || '').toUpperCase() === 'TPU';

        // La fecha es la marca PERSISTENTE de que el cliente ya aprobó: AprobacionPendiente vuelve
        // a 0 y el Estado a 'Pendiente', igual que antes de enviar a aprobación — sin esta columna
        // no hay forma de distinguir "todavía no se envió" de "ya está aprobado" (y de eso dependen
        // el uploader por fases de TPU y el bloqueo de re-envío a aprobación).
        await exports.ensureColFechaAprobacion(pool);

        // TPU: las DOS vías del cliente terminan acá y las dos son aprobación. La diferencia queda
        // registrada en TexturasElige: si guardó texturas en el visor 3D, son suyas ('CLIENTE');
        // si aprobó el boceto pelado, las define el DISEÑADOR desde el detalle de la orden.
        let quienTexturas = null;
        if (esTPUAprob) {
            const texRes = await pool.request().input('OID', sql.Int, ordenId).query(`
                SELECT COUNT(*) AS n FROM dbo.OrdenTexturasTPU
                WHERE OrdenID = @OID AND ElegidaPor = 'CLIENTE'
                  AND (ArchivoTextura IS NOT NULL OR Barniz = 1)
            `);
            quienTexturas = (texRes.recordset[0]?.n || 0) > 0 ? 'CLIENTE' : 'DISENADOR';
        }

        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('TE', sql.VarChar(10), quienTexturas)
            .query('UPDATE Ordenes SET AprobacionPendiente = 0, FechaAprobacionCliente = GETDATE(), FechaRechazoCliente = NULL, TexturasElige = @TE WHERE OrdenID = @OID');

        // Activación (idéntica a la de uploadOrderFile cuando no hay retención)
        const { changeOrderState } = require('../services/stateManagerService');
        const txAct = new sql.Transaction(pool);
        await txAct.begin();
        try {
            // TPU: el estado de área pasa a 'Aprobado' (cuelga de Pendiente, así que el general
            // queda igual que en el resto). Es el tramo en que la pelota vuelve a producción: falta
            // subir el arte, y por eso el tablero lo pinta verde PULSANTE hasta completarlo.
            // El guard por 'Cargando...' queda solo para el hold de diseñadores, que sí espera ahí;
            // en TPU la orden aguarda en 'Pendiente' desde que se manda a aprobación.
            await changeOrderState(txAct, {
                target : { type: 'ORDER', id: ordenId },
                estado : esTPUAprob ? 'Aprobado' : 'Pendiente',
                userObj: req.user || 'Sistema',
                detalle: esTPUAprob ? 'Boceto aprobado por el cliente' : 'Pedido de diseñador aprobado por el cliente',
                guard  : esTPUAprob ? null : "Estado = 'Cargando...'",
                io     : req.app.get('socketio'),
            });
            await txAct.commit();
        } catch (e) { await txAct.rollback(); throw e; }

        const orderDataReq = await pool.request().input('OID', sql.Int, ordenId).query(`
            SELECT AreaID, DescripcionTrabajo, Prioridad, CodigoOrden
            FROM Ordenes WHERE OrdenID = @OID
        `);
        const io = req.app.get('socketio');
        if (io) {
            io.emit('server:ordersUpdated', { count: 1, source: 'aprobar-pedido' });
            if (orderDataReq.recordset.length > 0) {
                const row = orderDataReq.recordset[0];
                io.emit('server:new_order', {
                    orders: [{
                        id: ordenId,
                        area: row.AreaID,
                        variante: row.DescripcionTrabajo,
                        prioridad: row.Prioridad || 'Normal',
                        codigo: row.CodigoOrden
                    }]
                });
            }
        }

        logger.info(`🎨 [Disenador] Orden ${ordenId} aprobada por el cliente ${codCliente} y activada.`);
        res.json({ success: true });
    } catch (err) {
        logger.error('❌ Error aprobando pedido de diseñador:', err);
        res.status(500).json({ error: 'No se pudo aprobar el pedido.' });
    }
};

// POST /api/web-orders/rechazar-pedido — el CLIENTE rechaza el boceto de un pedido retenido.
// La orden vuelve a producción (Estado 'Pendiente') con FechaRechazoCliente marcada: el tablero
// del área la pinta en rojo y el operario corrige el boceto y la reenvía a aprobación (ahí se
// limpia la marca). Mismos guards que aprobarPedido: solo el cliente dueño, solo mientras espera.
exports.rechazarPedido = async (req, res) => {
    try {
        const codCliente = req.user?.codCliente;
        const ordenId = parseInt(req.body?.ordenId);
        const motivo = String(req.body?.motivo || '').trim().substring(0, 300);
        if (!codCliente || req.user?.role !== 'WEB_CLIENT' || req.disenadorId) {
            return res.status(403).json({ error: 'Solo el cliente puede rechazar sus pedidos.' });
        }
        if (!ordenId) return res.status(400).json({ error: 'Falta ordenId.' });
        // El motivo es OBLIGATORIO: sin él, producción no sabe qué corregir del boceto.
        if (!motivo) return res.status(400).json({ error: 'Contanos qué hay que corregir del boceto.' });

        const pool = await getPool();
        const check = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Cod', sql.Int, codCliente)
            .query(`
                SELECT OrdenID FROM Ordenes
                WHERE OrdenID = @OID AND CodCliente = @Cod
                  AND ISNULL(AprobacionPendiente, 0) = 1
            `);
        if (check.recordset.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado o ya resuelto.' });
        }

        await exports.ensureColFechaAprobacion(pool);
        await pool.request().input('OID', sql.Int, ordenId)
            .query('UPDATE Ordenes SET AprobacionPendiente = 0, FechaRechazoCliente = GETDATE() WHERE OrdenID = @OID');

        // La elección de texturas era sobre el boceto rechazado: las zonas del boceto nuevo pueden
        // no coincidir, así que se descarta (misma regla que al re-subir el boceto).
        try {
            await pool.request().input('OID', sql.Int, ordenId)
                .query('DELETE FROM dbo.OrdenTexturasTPU WHERE OrdenID = @OID');
        } catch (_) { /* tabla aún no creada: no hay nada que borrar */ }

        // Volver a 'Pendiente' para que el área la vea y la trabaje (el rechazo se lee por la marca).
        const { changeOrderState } = require('../services/stateManagerService');
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            // 'Rechazado' cuelga de Pendiente: el general queda igual que antes y la columna del
            // área dice qué pasó. Sin guard por 'Cargando...' — desde que se manda a aprobación la
            // orden espera en 'Pendiente', no ahí.
            await changeOrderState(tx, {
                target : { type: 'ORDER', id: ordenId },
                estado : 'Rechazado',
                userObj: req.user || 'Cliente',
                detalle: `Boceto RECHAZADO por el cliente${motivo ? `: ${motivo}` : ''}`,
                io     : req.app.get('socketio'),
            });
            await tx.commit();
        } catch (e) { await tx.rollback(); throw e; }

        // El motivo también va a la Nota, que es lo que producción tiene a la vista en el detalle.
        if (motivo) {
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('Mot', sql.NVarChar(400), `\nRECHAZO CLIENTE: ${motivo}`)
                .query('UPDATE Ordenes SET Nota = CONCAT(ISNULL(Nota, \'\'), @Mot) WHERE OrdenID = @OID');
        }

        const io = req.app.get('socketio');
        if (io) io.emit('server:ordersUpdated', { count: 1, source: 'rechazar-pedido' });

        logger.info(`🚫 [TPU] Orden ${ordenId} RECHAZADA por el cliente ${codCliente}${motivo ? ` (motivo: ${motivo})` : ''}.`);
        res.json({ success: true });
    } catch (err) {
        logger.error('❌ Error rechazando pedido:', err);
        res.status(500).json({ error: 'No se pudo rechazar el pedido.' });
    }
};

// GET /api/web-orders/order/:ordenId/files — archivos de una orden del cliente, con COPIAS.
// Scopeado al cliente logueado (solo ve archivos de sus propias órdenes).
// TPU — "Mis matrices": pedidos TPU FINALIZADOS del cliente que tienen arte (CMYK),
// para reusar el diseño sin re-cobrar la matriz. Devuelve el ArchivoID del CMYK para el thumbnail.
exports.getMisMatrices = async (req, res) => {
    const codCliente = req.user?.codCliente;
    if (!codCliente) return res.status(401).json({ error: 'No autenticado.' });
    try {
        const pool = await getPool();
        const result = await pool.request()
            // Texto: Ordenes.CodCliente es nchar(10) (ver nota en getMisPedidosResumen).
            .input('cod', sql.NVarChar(10), String(codCliente ?? ''))
            .query(`
                SELECT o.OrdenID, o.CodigoOrden, o.DescripcionTrabajo, o.Material, o.FechaIngreso,
                       -- Vista previa de la matriz: el BOCETO de producción (el PDF que subió el
                       -- operario y aprobó el cliente). Antes se buscaba por 'cmyk', que dejaba sin
                       -- imagen a toda matriz cuyas capas no llevaran esa palabra en el nombre.
                       (SELECT TOP 1 ao.ArchivoID FROM dbo.ArchivosOrden ao WITH(NOLOCK)
                          WHERE ao.OrdenID = o.OrdenID AND ao.RutaAlmacenamiento IS NOT NULL
                            AND LOWER(ao.NombreArchivo) LIKE '%boceto%'
                          ORDER BY ao.ArchivoID ASC) AS ArteArchivoID,
                       (SELECT TOP 1 ao.NombreArchivo FROM dbo.ArchivosOrden ao WITH(NOLOCK)
                          WHERE ao.OrdenID = o.OrdenID AND LOWER(ao.NombreArchivo) LIKE '%boceto%'
                          ORDER BY ao.ArchivoID ASC) AS ArteNombre
                FROM dbo.Ordenes o WITH(NOLOCK)
                WHERE o.CodCliente = @cod
                  AND UPPER(LTRIM(RTRIM(o.AreaID))) = 'TPU'
                  AND o.Estado IN ('Finalizado','FINALIZADO','Entregado','ENTREGADO','Cerrado','CERRADO')
                ORDER BY o.FechaIngreso DESC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error('Error getMisMatrices:', err);
        res.status(500).json({ error: 'Error al obtener matrices.' });
    }
};

// Espeja CAPAS_ARTE_TPU de ordersController: el arte de un TPU son exactamente estas capas. Acá se
// usa para saber si la matriz tiene arte fabricable o solo el boceto.
const CAPAS_ARTE_TPU = 5;

// Cantidad mínima para REUSAR una matriz (el trabajo nuevo pide 15, ver services.js minCopies).
// Espeja `minCopiesReuso` del portal; acá es la validación que de verdad manda.
const MIN_REUSO_MATRIZ_TPU = 5;

// TPU — Reusar una matriz: crea una orden TPU nueva copiando el arte de una matriz finalizada del
// cliente, entra DIRECTO a producción (sin aprobación) y NO cobra la matriz (156), solo la producción.
exports.reuseMatrizTPU = async (req, res) => {
    const codCliente = req.user?.codCliente;
    const matrizOrdenId = parseInt(req.body?.matrizOrdenId);
    const cantidad = parseInt(req.body?.cantidad) || 0;
    const nombreTrabajo = (req.body?.nombreTrabajo || '').trim();
    // Medida del parche elegida por el cliente. Igual que en un trabajo nuevo va DENTRO de la nota
    // (`[Medida: alto x ancho cm]`): el alto/ancho de un TPU no tiene columna propia en Ordenes.
    const medidaTpu = String(req.body?.medida || '').trim();
    if (!codCliente) return res.status(401).json({ error: 'No autenticado.' });
    if (!matrizOrdenId || cantidad < 1) return res.status(400).json({ error: 'Faltan datos (matriz y cantidad).' });
    // Mínimo del REUSO: 5 unidades (el trabajo nuevo pide 15 — acá la matriz ya está hecha).
    // Se valida también acá y no solo en el form: la regla vivía únicamente en el navegador,
    // así que un pedido armado a mano entraba con 1 unidad. Mismo agujero que material/variante.
    if (cantidad < MIN_REUSO_MATRIZ_TPU) {
        return res.status(400).json({ error: `El mínimo para reusar una matriz es de ${MIN_REUSO_MATRIZ_TPU} unidades.` });
    }

    const pool = await getPool();
    let transaction;
    try {
        // 1. Validar la matriz (del cliente, TPU, con arte)
        const matRes = await pool.request()
            .input('OID', sql.Int, matrizOrdenId)
            .input('cod', sql.Int, codCliente)
            .query(`
                SELECT o.OrdenID, o.CodigoOrden, o.Material, o.Variante, o.CodArticulo, o.ProIdProducto,
                       o.CliIdCliente, o.IdClienteReact, o.Cliente, o.UM, o.Magnitud AS MatMag,
                       (SELECT COUNT(*) FROM ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID AND ISNULL(ao.EstadoArchivo,'')<>'Cancelado') AS nArch,
                       (SELECT COUNT(*) FROM ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID AND ISNULL(ao.EstadoArchivo,'')<>'Cancelado'
                                                                AND LOWER(ao.NombreArchivo) NOT LIKE '%boceto%') AS nCapas
                FROM Ordenes o WITH(NOLOCK)
                WHERE o.OrdenID = @OID AND o.CodCliente = @cod AND UPPER(LTRIM(RTRIM(o.AreaID)))='TPU'`);
        if (!matRes.recordset.length) return res.status(404).json({ error: 'Matriz no encontrada.' });
        const mat = matRes.recordset[0];
        if (!mat.nArch) return res.status(400).json({ error: 'La matriz no tiene arte para reusar.' });

        // ¿Misma cantidad? Las 5 capas del arte se generan CON la cantidad adentro (repeticiones en
        // el layout), así que el arte de la matriz solo sirve para fabricar si la cantidad coincide.
        // Si difiere (o la matriz no tiene magnitud confiable), producción debe REGENERAR las 5 capas
        // — sin aprobación del cliente (el diseño ya está aprobado, solo cambia la cantidad).
        // Segunda condición: las matrices migradas de la planilla vieja sin arte traen SOLO el boceto.
        // Copiarlo como arte dejaría la orden en Diseñado con 1 archivo en vez de 5 — el operario la
        // ve pronta y recién se entera al asignarla a un lote, y encima el boceto le ocupa una de las
        // 5 ranuras al subir. Sin las capas completas, siempre se regenera.
        const matMag = parseInt(String(mat.MatMag || '').trim()) || 0;
        const regenerar = !(matMag > 0 && matMag === cantidad) || (mat.nCapas || 0) < CAPAS_ARTE_TPU;

        // 2. Reservar número de pedido
        const reserveRes = await pool.request().query(`
            UPDATE ConfiguracionGlobal SET Valor = CAST(ISNULL(CAST(Valor AS INT),0)+1 AS VARCHAR)
            OUTPUT INSERTED.Valor WHERE Clave='ULTIMOPEDIDOWEB'`);
        const nuevoNro = parseInt(reserveRes.recordset[0].Valor);
        const erpDocNumber = `${nuevoNro}`;
        const codigoOrden = `TPU-${nuevoNro}`;
        const matCod = (mat.CodigoOrden || '').trim();

        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 3. Crear la orden TPU nueva.
        //  - Misma cantidad  → directo a producción ('Pendiente') con el arte de la matriz copiado.
        //  - Cantidad distinta → 'Cargando...': producción regenera las 5 capas y recién ahí entra a
        //    producción. La marca [REUSO-REGEN] indica que NO requiere aprobación del cliente.
        // El reuso NO pasa por 'Cargando...': ese estado es para un pedido web que todavía está
        // subiendo archivos, acá la orden nace completa. Lo único que cambia es si el arte de la
        // matriz sirve tal cual o hay que rehacerlo:
        //  - arte copiado (misma cantidad) → Produccion / Diseñado: lista para asignar a un lote.
        //  - hay que regenerar las 5 capas → Pendiente / Aprobado: el cliente ya aprobó el diseño en
        //    la matriz, falta que producción suba el arte (con la 5ª capa pasa sola a Diseñado).
        const estadoGenNueva  = regenerar ? 'Pendiente' : 'Produccion';
        const estadoAreaNueva = regenerar ? 'Aprobado'  : 'Diseñado';
        // Sin las capas el motivo NO es la cantidad, y decir "regenerar ... (matriz: 100 u)" cuando el
        // cliente pidió 100 u le queda incoherente al operario. Se nombra el motivo real.
        const sinCapas = (mat.nCapas || 0) < CAPAS_ARTE_TPU;
        const notaNueva = (regenerar
            ? `Reuso de matriz ${matCod} [REUSO-REGEN] · ` + (sinCapas
                ? `la matriz no tiene el arte cargado (solo boceto) — hacer las ${CAPAS_ARTE_TPU} capas para ${cantidad} u`
                : `regenerar ${CAPAS_ARTE_TPU} capas para ${cantidad} u (matriz: ${matMag || '?'} u)`)
            : `Reuso de matriz ${matCod}`)
            + (medidaTpu ? ` [Medida: ${medidaTpu}]` : '');
        const insOrd = await new sql.Request(transaction)
            .input('Cliente', sql.NVarChar(200), mat.Cliente)
            .input('CodCli', sql.Int, codCliente)
            // Ordenes.IdClienteReact es NUMERIC: el driver lo devuelve como number y bindearlo
            // como VarChar sin convertir revienta con "Validation failed ... Invalid string".
            // Mismo patrón que createWebOrder.
            .input('IdCliReact', sql.VarChar(50), mat.IdClienteReact ? mat.IdClienteReact.toString() : null)
            .input('Desc', sql.NVarChar(300), nombreTrabajo || `Reposición ${matCod}`)
            .input('Mat', sql.VarChar(255), mat.Material)
            .input('Var', sql.VarChar(100), mat.Variante || 'TPU')
            .input('Cod', sql.VarChar(50), codigoOrden)
            .input('ERP', sql.VarChar(50), erpDocNumber)
            .input('Nota', sql.NVarChar(sql.MAX), notaNueva)
            .input('Mag', sql.VarChar(50), String(cantidad))
            .input('EstadoGen', sql.VarChar(50), estadoGenNueva)
            .input('EstadoArea', sql.VarChar(50), estadoAreaNueva)
            .input('CodArt', sql.VarChar(50), mat.CodArticulo)
            .input('ProId', sql.Int, mat.ProIdProducto)
            .input('CliId', sql.Int, mat.CliIdCliente)
            .input('UM', sql.VarChar(20), mat.UM || 'u')
            .query(`
                INSERT INTO Ordenes (AreaID, Cliente, CodCliente, IdClienteReact, DescripcionTrabajo, Prioridad,
                    FechaIngreso, FechaEstimadaEntrega, Material, Variante, CodigoOrden, NoDocERP, Nota, Magnitud,
                    ProximoServicio, UM, Estado, EstadoenArea, CodArticulo, ProIdProducto, CliIdCliente, FechaEntradaSector)
                OUTPUT INSERTED.OrdenID
                VALUES ('TPU', @Cliente, @CodCli, @IdCliReact, @Desc, 'Normal',
                    GETDATE(), DATEADD(day,3,GETDATE()), @Mat, @Var, @Cod, @ERP, @Nota, @Mag,
                    'DEPOSITO', @UM, @EstadoGen, @EstadoArea, @CodArt, @ProId, @CliId, GETDATE())`);
        const newOID = insOrd.recordset[0].OrdenID;

        // Fecha de entrega real (área/prioridad/horario/feriados). Si el SP falla,
        // queda el DATEADD(day,3,GETDATE()) del INSERT como respaldo.
        try {
            await new sql.Request(transaction).input('OrdenID', sql.Int, newOID).execute('sp_CalcularFechaEntrega');
        } catch (fechaErr) {
            logger.error(`⚠️ sp_CalcularFechaEntrega falló para OrdenID ${newOID}: ${fechaErr.message}`);
        }

        // 4. Traer el arte de la matriz.
        const arte = await new sql.Request(transaction)
            .input('MOID', sql.Int, matrizOrdenId)
            .query(`SELECT ArchivoID, NombreArchivo, TipoArchivo, Copias, Metros, RutaAlmacenamiento, Ancho, Alto, Observaciones
                    FROM ArchivosOrden WHERE OrdenID=@MOID AND ISNULL(EstadoArchivo,'')<>'Cancelado' ORDER BY ArchivoID ASC`);
        const thumbCopies = [];
        if (!regenerar) {
            // Misma cantidad: copiar como arte de producción (mismas rutas de Drive) → a fabricar.
            for (const a of arte.recordset) {
                const ins = await new sql.Request(transaction)
                    .input('OID', sql.Int, newOID)
                    .input('Nom', sql.NVarChar(255), a.NombreArchivo)
                    .input('Tipo', sql.VarChar(50), a.TipoArchivo || 'Impresion')
                    .input('Cop', sql.Int, a.Copias || 1)
                    .input('Met', sql.Decimal(10, 3), a.Metros || 0)
                    .input('Ruta', sql.NVarChar(sql.MAX), a.RutaAlmacenamiento)
                    .input('An', sql.Decimal(10, 2), a.Ancho || 0)
                    .input('Al', sql.Decimal(10, 2), a.Alto || 0)
                    .input('Obs', sql.NVarChar(sql.MAX), a.Observaciones || '')
                    .query(`INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, TipoArchivo, Copias, Metros, EstadoArchivo, FechaSubida, RutaAlmacenamiento, Ancho, Alto, Observaciones)
                            OUTPUT INSERTED.ArchivoID
                            VALUES (@OID, @Nom, @Tipo, @Cop, @Met, 'Pendiente', GETDATE(), @Ruta, @An, @Al, @Obs)`);
                thumbCopies.push({ origId: a.ArchivoID, newId: ins.recordset[0].ArchivoID });
            }
        } else {
            // Cantidad distinta: el arte viejo NO sirve para fabricar (cantidad incrustada en las capas).
            // Se copia solo como REFERENCIA (base visual de las capas a regenerar); producción sube las
            // 5 capas nuevas como arte de producción.
            for (const a of arte.recordset) {
                await new sql.Request(transaction)
                    .input('OID', sql.Int, newOID)
                    .input('Nom', sql.VarChar(200), `BASE - ${a.NombreArchivo}`.substring(0, 200))
                    .input('Ruta', sql.NVarChar(sql.MAX), a.RutaAlmacenamiento)
                    .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage)
                            VALUES (@OID, 'ARTE BASE (REGENERAR)', @Nom, GETDATE(), @Ruta)`);
            }
        }

        await transaction.commit();

        // 5. Copiar thumbnails en disco (best-effort, para que se vean sin regenerar)
        try {
            const fs = require('fs'); const path = require('path');
            const base = process.env.THUMBNAILS_PATH || path.join(__dirname, '../thumbnails');
            const destDir = path.join(base, codigoOrden);
            for (const t of thumbCopies) {
                const src = path.join(base, matCod, `${t.origId}.jpg`);
                if (fs.existsSync(src)) {
                    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                    fs.copyFileSync(src, path.join(destDir, `${t.newId}.jpg`));
                }
            }
        } catch (e) { logger.warn('[reuseMatriz] thumb copy: ' + e.message); }

        // 6. Auto-cotización (cobra la producción por el CodArticulo; NO hay línea 156 = matriz gratis)
        setImmediate(async () => {
            try {
                await ERPSyncService.syncFinalOrderIntegration(erpDocNumber, req.user?.id || 1, req.user?.name || mat.Cliente, null, { skipDeposito: true });
            } catch (e) { logger.error('[reuseMatriz] cotización: ' + e.message); }
        });

        const io = req.app.get('socketio');
        if (io) io.emit('server:ordersUpdated', { count: 1, source: 'tpu-reuse-matriz' });

        logger.info(`[TPU] Reuso de matriz ${matCod} → ${codigoOrden} (OID ${newOID}), cantidad ${cantidad}${regenerar ? ' · REGENERAR arte (cantidad distinta)' : ' · mismo arte'}.`);
        res.json({ success: true, ordenId: newOID, codigoOrden, regenerar });
    } catch (err) {
        if (transaction) { try { await transaction.rollback(); } catch (_) {} }
        logger.error('[reuseMatrizTPU] ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.getOrderFiles = async (req, res) => {
    const codCliente = req.user?.codCliente;
    const { ordenId } = req.params;
    if (!ordenId) return res.status(400).json({ error: 'ordenId requerido' });
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('OID', sql.Int, Number(ordenId))
            .input('cod', sql.Int, codCliente || 0)
            .query(`
                SELECT ao.ArchivoID,
                       ao.NombreArchivo,
                       ISNULL(ao.Copias, 1) AS Copias,
                       ao.RutaAlmacenamiento,
                       o.CodigoOrden
                FROM dbo.ArchivosOrden ao WITH(NOLOCK)
                INNER JOIN dbo.Ordenes o WITH(NOLOCK) ON ao.OrdenID = o.OrdenID
                WHERE ao.OrdenID = @OID AND o.CodCliente = @cod
                  -- TPU: el cliente solo ve el archivo de aprobación — el BOCETO DE PRODUCCIÓN (arte con
                  -- 'boceto' en el nombre); fallback al 'cmyk' para órdenes viejas sin boceto. Los otros
                  -- PDFs del arte son internos. El resto de los servicios ve todos sus archivos.
                  AND (UPPER(LTRIM(RTRIM(o.AreaID))) <> 'TPU'
                       OR LOWER(ao.NombreArchivo) LIKE '%boceto%'
                       OR (LOWER(ao.NombreArchivo) LIKE '%cmyk%' AND NOT EXISTS (
                             SELECT 1 FROM dbo.ArchivosOrden x WITH(NOLOCK)
                             WHERE x.OrdenID = ao.OrdenID AND LOWER(x.NombreArchivo) LIKE '%boceto%'
                               AND ISNULL(x.EstadoArchivo,'') <> 'Cancelado')))
                ORDER BY ao.ArchivoID ASC
            `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error("Error getOrderFiles:", err);
        res.status(500).json({ error: "Error al obtener archivos de la orden." });
    }
};

// ─── TPU: VISOR 3D DEL PARCHE (portal) ───────────────────────────────────────
// El arte TPU son varias capas (boceto, cmyk, corte, relieve…) — el número exacto lo fija
// CAPAS_ARTE_TPU en ordersController, acá solo importan los roles. El portal solo
// LISTA el boceto (getOrderFiles), pero el visor 3D necesita el CONTENIDO de las capas internas
// para armar el modelo (silueta del corte + arte cmyk + relieve como altura). Estos endpoints
// exponen ese contenido SOLO al dueño del pedido (CodCliente del token) y solo en órdenes TPU.

// Rol de una capa según el nombre del archivo (misma convención de nombres que usa producción).
// Exportado: los endpoints internos del visor (ordersController) usan la misma convención.
const rolCapaTpu = exports.rolCapaTpu = (nombre) => {
    const n = String(nombre || '').toLowerCase();
    if (n.includes('boceto')) return 'boceto';
    if (n.includes('cmyk')) return 'cmyk';
    if (n.includes('corte')) return 'corte';
    if (n.includes('barniz')) return 'barniz';
    if (/relieve\s*2/.test(n)) return 'relieve2';
    if (n.includes('relieve')) return 'relieve';
    return null;
};

// GET /api/web-orders/tpu-model/:ordenId — qué capas (ArchivoID) tiene el arte de la orden.
exports.getTpuModelCapas = async (req, res) => {
    const codCliente = req.user?.codCliente;
    const ordenId = parseInt(req.params.ordenId, 10);
    if (!codCliente || !ordenId) return res.status(400).json({ error: 'Datos inválidos' });
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('cod', sql.Int, codCliente)
            .query(`
                SELECT ao.ArchivoID, ao.NombreArchivo
                FROM dbo.ArchivosOrden ao WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = ao.OrdenID
                WHERE ao.OrdenID = @OID AND o.CodCliente = @cod
                  AND UPPER(LTRIM(RTRIM(o.AreaID))) = 'TPU'
                  AND ISNULL(ao.EstadoArchivo,'') <> 'Cancelado'
                  AND ao.RutaAlmacenamiento IS NOT NULL
            `);
        const capas = {};
        for (const row of r.recordset) {
            const rol = rolCapaTpu(row.NombreArchivo);
            const esPdf = /\.pdf$/i.test(String(row.NombreArchivo || '')); // PLT (corte de plotter) no se puede rasterizar
            if (rol && esPdf && !capas[rol]) capas[rol] = row.ArchivoID;
        }
        res.json({ success: true, capas });
    } catch (err) {
        logger.error(`[TPU-3D] getTpuModelCapas: ${err.message}`);
        res.status(500).json({ error: 'Error al obtener las capas del modelo.' });
    }
};

// GET /api/web-orders/tpu-model/:ordenId/archivo/:archivoId — contenido de UNA capa (proxy Drive).
exports.getTpuModelArchivo = async (req, res) => {
    const codCliente = req.user?.codCliente;
    const ordenId = parseInt(req.params.ordenId, 10);
    const archivoId = parseInt(req.params.archivoId, 10);
    if (!codCliente || !ordenId || !archivoId) return res.status(400).json({ error: 'Datos inválidos' });
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('AID', sql.Int, archivoId)
            .input('cod', sql.Int, codCliente)
            .query(`
                SELECT TOP 1 ao.RutaAlmacenamiento
                FROM dbo.ArchivosOrden ao WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = ao.OrdenID
                WHERE ao.ArchivoID = @AID AND ao.OrdenID = @OID AND o.CodCliente = @cod
                  AND UPPER(LTRIM(RTRIM(o.AreaID))) = 'TPU'
                  AND ISNULL(ao.EstadoArchivo,'') <> 'Cancelado'
            `);
        const ruta = r.recordset[0]?.RutaAlmacenamiento;
        const driveId = ruta ? (String(ruta).match(/(?:id=|\/d\/)([\w-]+)/) || [])[1] : null;
        if (!driveId) return res.status(404).json({ error: 'Capa no encontrada.' });

        const file = await driveService.getFileStream(driveId);
        res.setHeader('Content-Type', file.mimeType || 'application/pdf');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        file.stream.pipe(res);
    } catch (err) {
        logger.error(`[TPU-3D] getTpuModelArchivo: ${err.message}`);
        res.status(500).json({ error: 'Error al leer la capa.' });
    }
};

// ─── TPU: CATÁLOGO DE TEXTURAS ───────────────────────────────────────────────
// La CARPETA es el catálogo: no hay tabla. El nombre visible sale del nombre del archivo y
// el roughness es uno solo para todas (constante en el visor), así que no hay ningún dato por
// textura que persistir. Agregar una textura = soltar el archivo en assets/textures.
//
// ⚠️ No renombrar ni borrar archivos: la elección del cliente se guarda por nombre de archivo
// (OrdenTexturasTPU.ArchivoTextura). Si igual pasa, el front degrada a "textura no encontrada".
const EXT_TEXTURAS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp']);

// Ajuste por textura, opcional, en un `texturas.json` al lado de los archivos:
//   { "textura1.svg": { "repeticiones": 14, "altura": 0.5 } }
// · repeticiones = cuántas veces entra a lo ancho del parche. No se deduce del archivo: los SVG
//   vienen con viewBox pero SIN medida física (width="50mm"), así que no hay tamaño real del que
//   sacarlo — con el viewBox pelado el tile daba ~98 mm y la textura se dibujaba UNA sola vez.
// · altura = cuánto se marca el relieve (0 = plano). Va por textura porque un tejido fino y un
//   cuero grueso no se marcan igual.
const REPETICIONES_DEFAULT = 2;
const ALTURA_DEFAULT = 1;

// En producción las texturas viven en backend/public (salida del build de Vite); en desarrollo
// el front las sirve Vite desde el public/ del repo y el backend corre aparte. Se prueban las dos.
const carpetaTexturas = () => {
    const path = require('path');
    const fs = require('fs');
    const candidatas = [
        path.join(__dirname, '../public/assets/textures'),      // prod (build)
        path.join(__dirname, '../../public/assets/textures'),   // dev (repo)
    ];
    return candidatas.find(c => fs.existsSync(c)) || null;
};

// 'lino-crudo.svg' → 'Lino crudo'
const nombreDeArchivo = (archivo) => {
    const base = archivo.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    return base.charAt(0).toUpperCase() + base.slice(1);
};

// GET /api/web-orders/texturas-tpu
exports.getTexturasTpu = async (req, res) => {
    try {
        const fs = require('fs');
        const path = require('path');
        const dir = carpetaTexturas();
        if (!dir) return res.json({ success: true, data: [] });

        let ajustes = {};
        const cfgPath = path.join(dir, 'texturas.json');
        if (fs.existsSync(cfgPath)) {
            // Un json roto no puede dejar sin texturas al visor: se avisa y se sigue con defaults.
            try { ajustes = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {}; }
            catch (e) { logger.warn('[texturas-tpu] texturas.json inválido, se ignora: ' + e.message); }
        }
        const num = (v, def, min) => (Number.isFinite(Number(v)) && Number(v) >= min ? Number(v) : def);

        const data = fs.readdirSync(dir)
            .filter(f => EXT_TEXTURAS.has(path.extname(f).toLowerCase()))
            .sort((a, b) => a.localeCompare(b, 'es'))
            .map(archivo => ({
                archivo,
                nombre: nombreDeArchivo(archivo),
                url: `/assets/textures/${encodeURIComponent(archivo)}`,
                repeticiones: num(ajustes[archivo]?.repeticiones, REPETICIONES_DEFAULT, 1),
                altura: num(ajustes[archivo]?.altura, ALTURA_DEFAULT, 0),
            }));

        res.json({ success: true, data });
    } catch (err) {
        logger.error('[texturas-tpu] ' + err.message);
        res.status(500).json({ error: 'No se pudo leer el catálogo de texturas.' });
    }
};

// ¿El archivo elegido existe en el catálogo? Evita guardar cualquier string que llegue por body.
exports.texturaValida = (archivo) => {
    if (!archivo) return true; // null = "sin textura", siempre válido
    const fs = require('fs');
    const dir = carpetaTexturas();
    if (!dir) return false;
    try { return fs.readdirSync(dir).includes(String(archivo)); } catch { return false; }
};

// Lee la elección de texturas de una orden. `scopeCliente` la limita al dueño (portal);
// el detalle de orden interno la lee sin scope.
exports.leerTexturasOrden = async (pool, ordenId, codCliente = null) => {
    const r = await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('cod', sql.Int, codCliente || 0)
        .query(`
            SELECT t.ZonaIndice, t.ArchivoTextura, ISNULL(t.Barniz, 0) AS Barniz,
                   t.Escala, t.Altura, t.OffsetX, t.OffsetY,
                   t.ElegidaPor, t.FechaEleccion, t.FechaModificacion
            FROM dbo.OrdenTexturasTPU t WITH(NOLOCK)
            JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = t.OrdenID
            WHERE t.OrdenID = @OID ${codCliente ? 'AND o.CodCliente = @cod' : ''}
            ORDER BY t.ZonaIndice ASC
        `);
    return r.recordset;
};

// Número dentro de un rango, o null si no vino (null = "no lo mandes al UPDATE, dejá lo que había").
const numEnRango = (v, min, max) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
};

// El valor de una zona admite dos formas:
//   'lino.svg' | null            → solo textura (lo que manda el detalle de orden interno)
//   { textura, barniz, escala, altura, dx, dy }
//                                → textura + barniz sectorizado + cómo queda puesta (visor 3D)
// Los ajustes ausentes viajan como null y el UPDATE los conserva: el selector de textura del
// detalle de orden manda solo el nombre del archivo y no tiene por qué borrar la puesta en página
// que eligió el cliente.
const normalizaZona = (valor) => {
    if (valor && typeof valor === 'object') {
        return {
            textura: valor.textura || null,
            barniz: !!valor.barniz,
            escala: numEnRango(valor.escala, 0.1, 10),
            altura: numEnRango(valor.altura, 0, 4),
            dx: numEnRango(valor.dx, 0, 1),
            dy: numEnRango(valor.dy, 0, 1),
        };
    }
    return { textura: valor || null, barniz: false, escala: null, altura: null, dx: null, dy: null };
};

// Valida el valor de una zona venga en la forma que venga.
exports.zonaValida = (valor) => exports.texturaValida(normalizaZona(valor).textura);
exports.texturaDeZona = (valor) => normalizaZona(valor).textura;

// Guarda SOLO las zonas que vienen en el payload (no reescribe las otras): si el operario cambia
// una zona, las que eligió el cliente tienen que conservar su ElegidaPor.
exports.guardarTexturasOrden = async (pool, ordenId, elecciones, elegidaPor, usuarioId = null) => {
    for (const [zonaStr, valor] of Object.entries(elecciones || {})) {
        const zona = parseInt(zonaStr, 10);
        if (!Number.isInteger(zona) || zona < 0) continue;
        const { textura, barniz, escala, altura, dx, dy } = normalizaZona(valor);
        const archivo = textura ? String(textura).substring(0, 255) : null;
        const conAjustes = (req) => req
            .input('E', sql.Float, escala)
            .input('H', sql.Float, altura)
            .input('X', sql.Float, dx)
            .input('Y', sql.Float, dy);
        const upd = await conAjustes(pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Z', sql.Int, zona)
            .input('A', sql.NVarChar(255), archivo)
            .input('B', sql.Bit, barniz ? 1 : 0)
            .input('P', sql.VarChar(10), elegidaPor)
            .input('U', sql.Int, usuarioId || null))
            .query(`
                UPDATE dbo.OrdenTexturasTPU
                SET ArchivoTextura = @A, Barniz = @B, ElegidaPor = @P,
                    Escala = ISNULL(@E, Escala), Altura = ISNULL(@H, Altura),
                    OffsetX = ISNULL(@X, OffsetX), OffsetY = ISNULL(@Y, OffsetY),
                    ModificadaPorUsuarioID = @U, FechaModificacion = GETDATE()
                WHERE OrdenID = @OID AND ZonaIndice = @Z
            `);
        if (upd.rowsAffected[0] === 0) {
            await conAjustes(pool.request()
                .input('OID', sql.Int, ordenId)
                .input('Z', sql.Int, zona)
                .input('A', sql.NVarChar(255), archivo)
                .input('B', sql.Bit, barniz ? 1 : 0)
                .input('P', sql.VarChar(10), elegidaPor))
                .query(`
                    INSERT INTO dbo.OrdenTexturasTPU (OrdenID, ZonaIndice, ArchivoTextura, Barniz, Escala, Altura, OffsetX, OffsetY, ElegidaPor, FechaEleccion)
                    VALUES (@OID, @Z, @A, @B, @E, @H, @X, @Y, @P, GETDATE())
                `);
        }
    }
};

// ─── TPU: BOCETO APROBADO (imagen de archivo) ────────────────────────────────
// Al aprobar, el visor 3D arma un PNG con el parche renderizado + la referencia de qué textura,
// escala y altura le tocó a cada zona, y lo manda acá. Queda como archivo de REFERENCIA de la
// orden: es el documento que mira producción para fabricar.
//
// Va a ArchivosReferencia y no a ArchivosOrden porque no es algo que se imprima: es documentación.
// Se REEMPLAZA en cada guardado (el diseñador puede redefinir las texturas después de la
// aprobación) — una orden tiene un boceto aprobado, no una pila de versiones casi iguales.
const NOMBRE_BOCETO_APROBADO = 'BOCETO APROBADO';
exports.guardarBocetoAprobado = async (pool, ordenId, buffer, codigoOrden, resumen) => {
    const driveService = require('../services/driveService');
    const nombre = `${NOMBRE_BOCETO_APROBADO} - ${String(codigoOrden || ordenId).replace(/\//g, '-')}.png`;
    // Data URL y no el Buffer pelado: con un Buffer, uploadToDrive manda el archivo como
    // application/octet-stream y Drive lo trata como binario — no se previsualiza, se descarga.
    // La rama de data URL saca el mime del prefijo, que es justo lo que hace falta acá.
    const url = await driveService.uploadToDrive(
        'data:image/png;base64,' + buffer.toString('base64'), nombre, 'TPU');

    await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('Pre', sql.VarChar(50), NOMBRE_BOCETO_APROBADO + '%')
        .query('DELETE FROM dbo.ArchivosReferencia WHERE OrdenID = @OID AND NombreOriginal LIKE @Pre');

    await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('Tipo', sql.VarChar(50), 'Boceto aprobado')
        .input('Nom', sql.NVarChar(255), nombre)
        .input('Not', sql.NVarChar(sql.MAX), String(resumen || '').substring(0, 3999))
        .input('Ubi', sql.VarChar(500), url)
        .query(`
            INSERT INTO dbo.ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, NotasAdicionales, FechaSubida, UbicacionStorage)
            VALUES (@OID, @Tipo, @Nom, @Not, GETDATE(), @Ubi)
        `);
    return { nombre, url };
};

// Lee el PNG que dejó multer en disco y limpia el temporal pase lo que pase.
const leerYBorrarTmp = async (file) => {
    const fs = require('fs');
    if (!file?.path) return file?.buffer || null;
    try { return await fs.promises.readFile(file.path); }
    finally { fs.promises.unlink(file.path).catch(() => {}); }
};
exports.leerYBorrarTmp = leerYBorrarTmp;

// POST /api/web-orders/orden/:ordenId/boceto-aprobado — lo manda el visor del cliente al aprobar.
exports.subirBocetoAprobado = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const codCliente = req.user?.codCliente;
    if (!ordenId || !codCliente || !req.file) return res.status(400).json({ error: 'Datos inválidos' });
    try {
        const pool = await getPool();
        const chk = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('cod', sql.Int, codCliente)
            .query('SELECT CodigoOrden FROM dbo.Ordenes WHERE OrdenID = @OID AND CodCliente = @cod');
        if (!chk.recordset.length) return res.status(404).json({ error: 'Orden no encontrada.' });

        const buffer = await leerYBorrarTmp(req.file);
        if (!buffer) return res.status(400).json({ error: 'No llegó la imagen.' });
        const out = await exports.guardarBocetoAprobado(
            pool, ordenId, buffer, chk.recordset[0].CodigoOrden, req.body?.resumen);
        res.json({ success: true, ...out });
    } catch (err) {
        logger.error('[subirBocetoAprobado] ' + err.message);
        res.status(500).json({ error: 'No se pudo archivar el boceto aprobado.' });
    }
};

// GET /api/web-orders/orden/:ordenId/texturas — lo que el cliente ya eligió (para reabrir el visor).
// `eligeCliente` le dice al visor si mostrar la UI de elección: cuando las texturas las define el
// diseñador ('DISENADOR'), el cliente solo mira el 3D y aprueba.
exports.getTexturasOrden = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const codCliente = req.user?.codCliente;
    if (!ordenId || !codCliente) return res.status(400).json({ error: 'Datos inválidos' });
    try {
        const pool = await getPool();
        await exports.ensureColFechaAprobacion(pool);
        const [data, ordRes] = await Promise.all([
            exports.leerTexturasOrden(pool, ordenId, codCliente),
            pool.request().input('OID', sql.Int, ordenId).input('cod', sql.Int, codCliente)
                .query('SELECT TexturasElige, FechaAprobacionCliente FROM dbo.Ordenes WITH(NOLOCK) WHERE OrdenID = @OID AND CodCliente = @cod'),
        ]);
        const o = ordRes.recordset[0] || {};
        const eligeCliente = String(o.TexturasElige || '').toUpperCase() !== 'DISENADOR';
        // `aprobado` apaga la edición del lado cliente: después de aprobar el visor sigue
        // abriéndose (para ver lo elegido, sea propio o del diseñador) pero es solo mirar.
        res.json({ success: true, data, eligeCliente, aprobado: !!o.FechaAprobacionCliente });
    } catch (err) {
        logger.error('[getTexturasOrden] ' + err.message);
        res.status(500).json({ error: 'No se pudieron leer las texturas de la orden.' });
    }
};

// POST /api/web-orders/orden/:ordenId/texturas — el cliente elige. Solo mientras el pedido está
// esperando su aprobación: al aprobar, la elección queda congelada (después la toca producción).
exports.setTexturasOrden = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const codCliente = req.user?.codCliente;
    const elecciones = req.body?.elecciones;
    if (!ordenId || !codCliente || !elecciones || typeof elecciones !== 'object') {
        return res.status(400).json({ error: 'Datos inválidos' });
    }
    for (const valor of Object.values(elecciones)) {
        if (!exports.zonaValida(valor)) return res.status(400).json({ error: `Textura desconocida: ${exports.texturaDeZona(valor)}` });
    }
    try {
        const pool = await getPool();
        await exports.ensureColFechaAprobacion(pool);
        const chk = await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('cod', sql.Int, codCliente)
            .query(`
                SELECT OrdenID, TexturasElige FROM dbo.Ordenes
                WHERE OrdenID = @OID AND CodCliente = @cod
                  AND ISNULL(AprobacionPendiente, 0) = 1
            `);
        if (!chk.recordset.length) {
            return res.status(409).json({ error: 'El pedido ya no está esperando tu aprobación: la elección quedó congelada.' });
        }
        if (String(chk.recordset[0].TexturasElige || '').toUpperCase() === 'DISENADOR') {
            return res.status(403).json({ error: 'Las texturas de este pedido las definió el diseñador.' });
        }
        await exports.guardarTexturasOrden(pool, ordenId, elecciones, 'CLIENTE');
        res.json({ success: true });
    } catch (err) {
        logger.error('[setTexturasOrden] ' + err.message);
        res.status(500).json({ error: 'No se pudo guardar la elección de texturas.' });
    }
};

// GET /api/web-orders/orders-files?ids=1,2,3 — archivos de VARIAS órdenes de un mismo pedido.
// Necesario para multitela: cada tela (hermana 1/2, 2/2) es una orden distinta con su propio
// archivo; el detalle expandido debe traerlos TODOS, no solo los de la primera. Scopeado al cliente.
exports.getOrdersFiles = async (req, res) => {
    const codCliente = req.user?.codCliente;
    const ids = String(req.query.ids || '')
        .split(',').map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0);
    if (!ids.length) return res.json({ success: true, data: [] });
    try {
        const pool = await getPool();
        const request = pool.request().input('cod', sql.Int, codCliente || 0);
        ids.forEach((id, i) => request.input(`id${i}`, sql.Int, id));
        const inClause = ids.map((_, i) => `@id${i}`).join(',');

        const result = await request.query(`
            SELECT ao.ArchivoID,
                   ao.NombreArchivo,
                   ISNULL(ao.Copias, 1) AS Copias,
                   ao.RutaAlmacenamiento,
                   o.OrdenID,
                   o.CodigoOrden,
                   o.Material,          -- la tela de esta hermana
                   o.Estado
            FROM dbo.ArchivosOrden ao WITH(NOLOCK)
            INNER JOIN dbo.Ordenes o WITH(NOLOCK) ON ao.OrdenID = o.OrdenID
            WHERE ao.OrdenID IN (${inClause}) AND o.CodCliente = @cod
            ORDER BY o.CodigoOrden ASC, ao.ArchivoID ASC
        `);
        res.json({ success: true, data: result.recordset });
    } catch (err) {
        logger.error("Error getOrdersFiles:", err);
        res.status(500).json({ error: "Error al obtener archivos del pedido." });
    }
};

// --- ELIMINAR PEDIDO INCOMPLETO (ZOMBIE) ---
exports.deleteIncompleteOrder = async (req, res) => {
    const codCliente = req.user?.codCliente;
    const { id } = req.params;
    const { razon } = req.body || {};

    if (!codCliente || !id) return res.status(400).json({ error: "Datos inválidos" });
    if (!razon || !razon.trim()) return res.status(400).json({ error: "Debe indicar una razón para cancelar el pedido." });

    try {
        const pool = await getPool();

        // Verificar que sea del cliente y esté en 'Cargando...'
        await exports.ensureColFechaAprobacion(pool);
        const check = await pool.request()
            .input('OID', sql.Int, id)
            .input('Cod', sql.Int, codCliente)
            .query("SELECT OrdenID, Estado, ISNULL(AprobacionPendiente, 0) AS AprobacionPendiente, FechaAprobacionCliente FROM Ordenes WHERE OrdenID = @OID AND CodCliente = @Cod");

        if (check.recordset.length === 0) return res.status(404).json({ error: "Pedido no encontrado o no autorizado." });

        // Retenido por APROBACIÓN: está en 'Cargando...' a propósito, no es una subida fallida.
        // Sin esta guarda, el "eliminar error" hard-deleteaba un pedido con el boceto ya diseñado.
        if (check.recordset[0].AprobacionPendiente) {
            return res.status(400).json({ error: 'Este pedido está esperando tu aprobación, no se puede eliminar. Si no lo querés, rechazalo contando el motivo.' });
        }

        // Ya APROBADO: entró a producción — desde el portal no se cancela más.
        if (check.recordset[0].FechaAprobacionCliente) {
            return res.status(400).json({ error: 'Ya aprobaste este pedido y entró a producción: no se puede cancelar desde el portal. Contactanos si necesitás frenarlo.' });
        }

        // Permitir cancelar si está Cargando (fail) o Pendiente (aún no tomado)
        const estado = check.recordset[0].Estado;
        if (!['Cargando...', 'Pendiente'].includes(estado)) {
            return res.status(400).json({ error: `No se puede eliminar el pedido porque ya está en estado: ${estado}` });
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqTx = new sql.Request(transaction);

            // Tela de Cliente: devolver los metros consumidos antes de cancelar/borrar (idempotente, no-op si no consumió)
            const { devolverMetrosTelaCliente } = require('../utils/telaClienteDevolucion');
            await devolverMetrosTelaCliente(transaction, id, `Devolución por eliminación Orden ${id}`, req.user?.id || 1);

            // ECOUV: la hermana de terminaciones (XEUV-*) se crea DESDE EL INGRESO, así que
            // una orden todavía en 'Pendiente'/'Cargando...' ya puede tener la suya viva en el
            // taller. Sin esto quedaba trabajando una terminación cuya impresión ya no existe.
            const { cancelarHermanaTerminaciones, eliminarHermanaTerminaciones } = require('../utils/hermanaTerminaciones');
            const ordenIdNum = parseInt(id, 10);

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
                await cancelarHermanaTerminaciones(transaction, ordenIdNum, {
                    userObj: req.user || 'Sistema',
                    motivo : 'Pedido incompleto cancelado por el cliente',
                    io     : req.app.get('socketio'),
                });
                await transaction.commit();
                return res.json({ success: true, message: "Pedido cancelado correctamente." });
            }

            // Borrado físico: la hermana y su detalle se van con la madre (antes del DELETE de
            // Ordenes, que es de donde salen el código y el área para encontrarla).
            await eliminarHermanaTerminaciones(transaction, ordenIdNum);

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
            SELECT OrdenID, Estado, CodigoOrden,
                   ISNULL(AprobacionPendiente, 0) AS AprobacionPendiente
            FROM Ordenes
            WHERE CodCliente = @Cod
            AND (NoDocERP = @Doc OR CodigoOrden = @Doc)
        `;

        const check = await pool.request()
            .input('Doc', sql.VarChar(50), docId)
            // Texto: Ordenes.CodCliente es nchar(10) (ver nota en getMisPedidosResumen).
            .input('Cod', sql.NVarChar(10), String(codCliente ?? ''))
            .query(findQuery);

        if (check.recordset.length === 0) return res.status(404).json({ error: "Proyecto no encontrado." });

        // Retenido por aprobación: vive en 'Cargando...' a propósito (hay un boceto diseñado
        // adentro) — no es un proyecto fallido y el borrado de zombies no lo puede arrastrar.
        if (check.recordset.some(o => o.AprobacionPendiente)) {
            return res.status(400).json({ error: 'Este pedido está esperando tu aprobación, no se puede eliminar. Si no lo querés, rechazalo contando el motivo.' });
        }

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

        // 3. Cancelar / Borrar
        const razon = req.body?.razon;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const reqTx = new sql.Request(transaction);

            // Tela de Cliente: devolver los metros consumidos por cada orden del bundle (idempotente)
            const { devolverMetrosTelaCliente } = require('../utils/telaClienteDevolucion');
            for (const oid of ids) {
                if (typeof oid !== 'number') continue;
                await devolverMetrosTelaCliente(transaction, oid, `Devolución por eliminación Orden ${oid}`, req.user?.id || 1);
            }

            // La hermana TERMINAC comparte NoDocERP y CodCliente con su madre, así que ya viene
            // dentro de `ids` y cae con el resto del bundle. Lo que falta es su DETALLE:
            // OrdenTerminaciones no lo tocaba nadie ni al cancelar ni al borrar.
            const { marcarTerminacionesCanceladas } = require('../utils/hermanaTerminaciones');

            // Si todas son Pendiente → soft cancel con razón
            const allPendiente = orders.every(o => o.Estado === 'Pendiente');
            if (allPendiente && razon?.trim()) {
                for (const oid of ids) {
                    if (typeof oid !== 'number') continue;
                    await reqTx.query(
                        `UPDATE Ordenes
                         SET Estado = 'Cancelado', EstadoenArea = 'Cancelado', DetallesCancelacion = '${razon.trim().replace(/'/g, "''")}'
                         WHERE OrdenID = ${oid}`
                    );
                    await marcarTerminacionesCanceladas(transaction, oid);
                }
                await transaction.commit();
                return res.json({ success: true, message: `Proyecto ${docId} cancelado (${ids.length} órdenes).` });
            }

            for (const oid of ids) {
                // Safety check
                if (typeof oid !== 'number') continue;
                await reqTx.query(`DELETE FROM ArchivosOrden WHERE OrdenID = ${oid}`);
                await reqTx.query(`DELETE FROM ArchivosReferencia WHERE OrdenID = ${oid}`);
                await reqTx.query(`DELETE FROM ServiciosExtraOrden WHERE OrdenID = ${oid}`);
                await reqTx.query(`DELETE FROM OrdenTerminaciones WHERE OrdenID = ${oid}`);
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
            // Texto: Ordenes.CodCliente es nchar(10) (ver nota en getMisPedidosResumen).
            .input('cod', sql.NVarChar(10), String(codCliente ?? ''))
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
            SELECT DISTINCT CodOrden, AreaID_Interno, NombreReferencia, VisibleWeb, DescripcionWeb, ImagenWeb, ActivosComplementarios
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
                        // El portal referencia los servicios por su área interna (EMB, TWC, TWT...),
                        // no por CodOrden (BOR, COR, COS...). Exponer AreaID_Interno permite re-indexar
                        // la visibilidad por área en el front sin hardcodear el mapeo.
                        area: (row.AreaID_Interno || '').trim(),
                        description: row.DescripcionWeb || '',
                        image: row.ImagenWeb || '',
                        complementarios: row.ActivosComplementarios ? JSON.parse(row.ActivosComplementarios) : null
                    };
                }
            });
        }

        // Config del portal (ConfiguracionGlobal): valores que el form necesita.
        // DIRECTA_MINIMO_METROS = mínimo de metros (Largo Total) para confirmar un pedido de Directa.
        // NULL/0 = sin validación. Editable desde Configuración → Configuración General.
        const portalConfig = { directaMinimoMetros: 0 };
        try {
            const cfgRes = await pool.request().query("SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'DIRECTA_MINIMO_METROS'");
            portalConfig.directaMinimoMetros = parseFloat(cfgRes.recordset[0]?.Valor) || 0;
        } catch (e) {
            logger.warn("[getAreaMapping] No se pudo leer DIRECTA_MINIMO_METROS:", e.message);
        }

        // Return structured data
        res.json({ success: true, data: { names, visibility, portalConfig } });
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
                    o.OrdFechaIngresoOrden AS FechaIngreso,
                    e.EOrNombreEstado AS Estado,
                    c.IDCliente AS IdCliente,
                    c.TelefonoTrabajo AS Celular,
                    tc.TClDescripcion AS TipoCliente,
                    m.MonSimbolo,
                    LTRIM(RTRIM(art.Descripcion)) AS Producto,
                    -- BILLETERA: orden ya descontada ENTERA del saldo prepago (consumo con marca
                    -- CUBIERTO_CUENTA_, no parcial) → está PAGA: el retiro no debe cobrarla de nuevo.
                    CASE WHEN EXISTS (
                        SELECT 1 FROM MovimientosCuenta cx WITH(NOLOCK)
                        JOIN CuentasCliente ccx WITH(NOLOCK) ON ccx.CueIdCuenta = cx.CueIdCuenta
                        WHERE ccx.CliIdCliente = o.CliIdCliente
                          AND cx.MovTipo = 'CONSUMO_CUENTA'
                          AND (cx.MovAnulado IS NULL OR cx.MovAnulado = 0)
                          AND cx.MovObservaciones LIKE 'CUBIERTO[_]CUENTA[_]%'
                          AND (cx.OrdIdOrden = o.OrdIdOrden
                               OR cx.OrdIdOrden IN (SELECT erp.OrdenID FROM Ordenes erp WITH(NOLOCK) WHERE erp.CodigoOrden = o.OrdCodigoOrden))
                    ) THEN 1 ELSE 0 END AS CubiertaBilletera,
                    -- PARCIAL: la billetera cubrió una parte (consumo CUBIERTO_PARCIAL_CUENTA)
                    CASE WHEN EXISTS (
                        SELECT 1 FROM MovimientosCuenta cp WITH(NOLOCK)
                        JOIN CuentasCliente ccp WITH(NOLOCK) ON ccp.CueIdCuenta = cp.CueIdCuenta
                        WHERE ccp.CliIdCliente = o.CliIdCliente
                          AND cp.MovTipo = 'CONSUMO_CUENTA'
                          AND (cp.MovAnulado IS NULL OR cp.MovAnulado = 0)
                          AND cp.MovObservaciones LIKE 'CUBIERTO[_]PARCIAL[_]CUENTA%'
                          AND (cp.OrdIdOrden = o.OrdIdOrden
                               OR cp.OrdIdOrden IN (SELECT erp3.OrdenID FROM Ordenes erp3 WITH(NOLOCK) WHERE erp3.CodigoOrden = o.OrdCodigoOrden))
                    ) THEN 1 ELSE 0 END AS ParcialBilletera,
                    -- Resto REAL a cobrar según cuenta corriente: la ORDEN viva sin marca ni factura
                    -- (tras una cobertura parcial vale SOLO el resto; F3 la mantiene sincronizada)
                    (SELECT TOP 1 ABS(mr.MovImporte)
                     FROM MovimientosCuenta mr WITH(NOLOCK)
                     JOIN CuentasCliente ccr WITH(NOLOCK) ON ccr.CueIdCuenta = mr.CueIdCuenta
                     WHERE ccr.CliIdCliente = o.CliIdCliente
                       AND mr.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                       AND (mr.MovAnulado IS NULL OR mr.MovAnulado = 0)
                       AND mr.DocIdDocumento IS NULL
                       AND (mr.MovObservaciones IS NULL OR mr.MovObservaciones NOT LIKE 'CUBIERTO%')
                       AND (mr.OrdIdOrden = o.OrdIdOrden
                            OR mr.OrdIdOrden IN (SELECT erp4.OrdenID FROM Ordenes erp4 WITH(NOLOCK) WHERE erp4.CodigoOrden = o.OrdCodigoOrden))
                     ORDER BY mr.MovIdMovimiento DESC) AS RestoCtaCte
                FROM OrdenesDeposito o WITH(NOLOCK)
                LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
                LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
                LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = o.MonIdMoneda
                LEFT JOIN Articulos art WITH(NOLOCK) ON art.ProIdProducto = o.ProIdProducto
                WHERE c.IDCliente = @idCliente
                AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar', 'Pronto para entregar')
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
            // Cubierta entera por la billetera ⇒ PAGA: no entra en el total a cobrar y el
            // retiro se confirma sin pasar por la pasarela (nace Abonado por cobertura).
            if (o.CubiertaBilletera === 1) isPaid = true;
            // Cubierta PARCIAL ⇒ a cobrar queda SOLO el resto que vive en la cuenta corriente
            // (cobrar el total original duplicaría la parte que la billetera ya pagó).
            else if (o.ParcialBilletera === 1 && o.RestoCtaCte != null) {
                finalAmount = Math.round(Number(o.RestoCtaCte) * 100) / 100;
            }

            return {
                id: docId,
                rawId: o.IdOrden,
                desc: o.NombreTrabajo || 'Pedido',
                amount: finalAmount,
                // Fecha/hora de INGRESO a depósito (no OrdFechaEstadoActual: esa la pisan los flujos
                // de pago/aviso y hacía "saltar" la fecha a hoy en órdenes viejas re-avisadas)
                date: o.FechaIngreso
                    ? new Date(o.FechaIngreso).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '')
                    : 'N/A',
                fechaIngreso: o.FechaIngreso || null, // OrdFechaIngresoOrden — para la regla de retiro obligatorio de órdenes +15 días
                status: isPaid ? 'PAGADO' : 'LISTO',
                originalStatus: o.Estado,
                isPaid: isPaid,
                cubiertaBilletera: o.CubiertaBilletera === 1,
                // Parcial: la billetera cubrió parte y `amount` ya es SOLO el resto a cobrar
                parcialBilletera: o.ParcialBilletera === 1 && o.RestoCtaCte != null,
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
// Órdenes listas para retirar de un cliente (+ estado de cobranza desde PedidosCobranza).
// Compartido por totemLookup (búsqueda por N° de orden) y totemLookupByClient (escaneo del QR del cliente).
async function getClientePickupOrders(pool, cliIdCliente) {
    const allOrdersRes = await pool.request()
        .input('cliId', sql.Int, cliIdCliente)
        .query(`
            SELECT
                o.OrdIdOrden AS IdOrden,
                o.OrdCodigoOrden AS CodigoOrden,
                o.OrdNombreTrabajo AS NombreTrabajo,
                o.OrdCantidad AS Cantidad,
                o.OrdCostoFinal AS CostoFinal,
                o.OrdFechaEstadoActual AS FechaEstado,
                e.EOrNombreEstado AS Estado,
                m.MonSimbolo,
                -- BILLETERA: cubierta entera por el saldo prepago ⇒ está PAGA (ver getPickupOrders)
                CASE WHEN EXISTS (
                    SELECT 1 FROM MovimientosCuenta cx WITH(NOLOCK)
                    JOIN CuentasCliente ccx WITH(NOLOCK) ON ccx.CueIdCuenta = cx.CueIdCuenta
                    WHERE ccx.CliIdCliente = o.CliIdCliente
                      AND cx.MovTipo = 'CONSUMO_CUENTA'
                      AND (cx.MovAnulado IS NULL OR cx.MovAnulado = 0)
                      AND cx.MovObservaciones LIKE 'CUBIERTO[_]CUENTA[_]%'
                      AND (cx.OrdIdOrden = o.OrdIdOrden
                           OR cx.OrdIdOrden IN (SELECT erp.OrdenID FROM Ordenes erp WITH(NOLOCK) WHERE erp.CodigoOrden = o.OrdCodigoOrden))
                ) THEN 1 ELSE 0 END AS CubiertaBilletera,
                -- PARCIAL + resto real a cobrar (misma lógica que getPickupOrders)
                CASE WHEN EXISTS (
                    SELECT 1 FROM MovimientosCuenta cp WITH(NOLOCK)
                    JOIN CuentasCliente ccp WITH(NOLOCK) ON ccp.CueIdCuenta = cp.CueIdCuenta
                    WHERE ccp.CliIdCliente = o.CliIdCliente
                      AND cp.MovTipo = 'CONSUMO_CUENTA'
                      AND (cp.MovAnulado IS NULL OR cp.MovAnulado = 0)
                      AND cp.MovObservaciones LIKE 'CUBIERTO[_]PARCIAL[_]CUENTA%'
                      AND (cp.OrdIdOrden = o.OrdIdOrden
                           OR cp.OrdIdOrden IN (SELECT erp3.OrdenID FROM Ordenes erp3 WITH(NOLOCK) WHERE erp3.CodigoOrden = o.OrdCodigoOrden))
                ) THEN 1 ELSE 0 END AS ParcialBilletera,
                (SELECT TOP 1 ABS(mr.MovImporte)
                 FROM MovimientosCuenta mr WITH(NOLOCK)
                 JOIN CuentasCliente ccr WITH(NOLOCK) ON ccr.CueIdCuenta = mr.CueIdCuenta
                 WHERE ccr.CliIdCliente = o.CliIdCliente
                   AND mr.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                   AND (mr.MovAnulado IS NULL OR mr.MovAnulado = 0)
                   AND mr.DocIdDocumento IS NULL
                   AND (mr.MovObservaciones IS NULL OR mr.MovObservaciones NOT LIKE 'CUBIERTO%')
                   AND (mr.OrdIdOrden = o.OrdIdOrden
                        OR mr.OrdIdOrden IN (SELECT erp4.OrdenID FROM Ordenes erp4 WITH(NOLOCK) WHERE erp4.CodigoOrden = o.OrdCodigoOrden))
                 ORDER BY mr.MovIdMovimiento DESC) AS RestoCtaCte
            FROM OrdenesDeposito o WITH(NOLOCK)
            LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = o.OrdEstadoActual
            LEFT JOIN Monedas m WITH(NOLOCK) ON m.MonIdMoneda = o.MonIdMoneda
            WHERE o.CliIdCliente = @cliId
            AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar', 'Pronto para entregar')
            AND o.OReIdOrdenRetiro IS NULL
        `);

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

    return allOrdersRes.recordset.map(o => {
        const docId = o.CodigoOrden || `#${o.IdOrden}`;
        const cob = cobranzasMap[docId];
        let amount = cob ? parseFloat(cob.MontoTotal) : (parseFloat(o.CostoFinal) || 0);
        // Cobertura parcial de la billetera: a cobrar queda SOLO el resto de cuenta corriente
        if (o.CubiertaBilletera !== 1 && o.ParcialBilletera === 1 && o.RestoCtaCte != null) {
            amount = Math.round(Number(o.RestoCtaCte) * 100) / 100;
        }
        return {
            id: docId,
            rawId: o.IdOrden,
            desc: o.NombreTrabajo || 'Pedido',
            quantity: o.Cantidad || '',
            amount,
            date: o.FechaEstado ? new Date(o.FechaEstado).toLocaleDateString('es-UY') : 'N/A',
            status: (cob?.EstadoCobro === 'Pagado' || o.CubiertaBilletera === 1) ? 'PAGADO' : 'LISTO',
            originalStatus: o.Estado,
            // Paga en cobranza O cubierta entera por la billetera (el retiro no la cobra de nuevo)
            isPaid: cob?.EstadoCobro === 'Pagado' || o.CubiertaBilletera === 1,
            cubiertaBilletera: o.CubiertaBilletera === 1,
            parcialBilletera: o.CubiertaBilletera !== 1 && o.ParcialBilletera === 1 && o.RestoCtaCte != null,
            currency: cob ? cob.Moneda : (o.MonSimbolo || '$'),
        };
    });
}

exports.totemLookup = async (req, res) => {
    try {
        const { orderCode } = req.body;
        if (!orderCode) return res.status(400).json({ success: false, message: 'Código de orden requerido' });

        const pool = await getPool();
        const code = orderCode.trim();

        // 1. Buscar la orden y al cliente.
        // Multitela: el cliente tipea el código base (SUB-5936) y las órdenes reales llevan
        // sufijo (SUB-5936 (1/2)). Se matchea exacto O base + ' (n/m)' — el LIKE exige " ("
        // a continuación, así SUB-5936 no agarra SUB-59360. Prioriza una orden sin retiro.
        const orderRes = await pool.request()
            .input('code', sql.VarChar(50), code)
            .query(`
                SELECT TOP 1 o.CliIdCliente, o.OReIdOrdenRetiro, c.IDCliente, c.Nombre, c.NombreFantasia
                FROM OrdenesDeposito o WITH(NOLOCK)
                LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                WHERE o.OrdCodigoOrden = @code
                   OR o.OrdCodigoOrden LIKE @code + ' (%'
                ORDER BY CASE WHEN o.OReIdOrdenRetiro IS NULL THEN 0 ELSE 1 END
            `);

        if (!orderRes.recordset.length) {
            return res.json({ success: false, message: 'Orden no encontrada' });
        }
        if (orderRes.recordset[0].OReIdOrdenRetiro) {
            return res.json({ success: false, message: 'Esta orden ya tiene un retiro asociado' });
        }

        const client = orderRes.recordset[0];

        // 2-4. Órdenes listas para retirar del cliente (+ cobranza) — helper compartido.
        const orders = await getClientePickupOrders(pool, client.CliIdCliente);

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
// TOTEM: LOOKUP POR QR DEL CLIENTE (SIN AUTH)
// El QR codifica `${IDCliente}totem` (generado en el portal del cliente). Resolvemos el
// cliente por su IDCliente y devolvemos el MISMO shape que totemLookup → la pantalla de
// resultados del tótem se muestra igual, sin tener que tipear un número de orden.
// ===================================
exports.totemLookupByClient = async (req, res) => {
    try {
        const { qr } = req.body;
        // El QR codifica `totem-${IDCliente}+${CliIdCliente}` (generado en el portal del cliente).
        // Validamos que AMBOS campos correspondan al MISMO cliente (más difícil de falsificar que
        // un solo número). CliIdCliente es el FK que usan las órdenes; el sufijo son sus dígitos.
        const m = String(qr || '').trim().match(/^totem-(.+)\+(\d+)$/i);
        if (!m) return res.json({ success: false, message: 'QR inválido' });
        const idCliente = m[1].trim();
        const cliIdCliente = parseInt(m[2], 10);

        const pool = await getPool();
        const cliRes = await pool.request()
            .input('idcli', sql.VarChar(50), idCliente)
            .input('cliid', sql.Int, cliIdCliente)
            .query(`
                SELECT TOP 1 CliIdCliente, IDCliente, Nombre, NombreFantasia
                FROM Clientes WITH(NOLOCK)
                WHERE LTRIM(RTRIM(IDCliente)) = @idcli AND CliIdCliente = @cliid
            `);

        if (!cliRes.recordset.length) {
            return res.json({ success: false, message: 'Cliente no encontrado' });
        }
        const client = cliRes.recordset[0];

        const orders = await getClientePickupOrders(pool, client.CliIdCliente);

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
        logger.error("Error totem lookup by client:", error);
        res.status(500).json({ success: false, message: "Error al buscar cliente." });
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

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const pool = await getPool();

            // 1. Buscar CodCliente a partir del IDCliente
            const clientRes = await pool.request()
                .input('idCliente', sql.VarChar, clientId)
                .query("SELECT CodCliente, CliIdCliente, FormaEnvioID, ESTADO FROM Clientes WHERE IDCliente = @idCliente");

            if (!clientRes.recordset.length) {
                return res.status(404).json({ success: false, error: "Cliente no encontrado." });
            }
            // Bloquear creación de retiro si el cliente está BLOQUEADO (mismo criterio que los pedidos web).
            if (clientRes.recordset[0].ESTADO === 'BLOQUEADO') {
                logger.warn(`⛔ [Totem Retiro] Cliente IDCliente=${clientId} está BLOQUEADO. Retiro rechazado.`);
                return res.status(403).json({ success: false, error: 'Cuenta bloqueada. No podés crear retiros. Contactá con USER.' });
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

                return res.json({ success: true, data: { OReIdOrdenRetiro }, ordIdGenerada: ordIdRetiro });

            } catch (txErr) {
                try { await transaction.rollback(); } catch (e) { }
                throw txErr;
            }

        } catch (error) {
            // Deadlock (error 1205): reintentar
            if (error.number === 1205 && attempt < MAX_RETRIES) {
                logger.warn(`[Totem] Deadlock en intento ${attempt}/${MAX_RETRIES}, reintentando en ${attempt * 300}ms...`);
                await new Promise(r => setTimeout(r, attempt * 300));
                continue;
            }
            logger.error("Error totem create pickup:", error);
            return res.status(500).json({ success: false, error: "Error al crear retiro: " + error.message });
        }
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

        // Bloquear creación de retiro si el cliente está BLOQUEADO (mismo criterio que los pedidos web).
        try {
            const estRes = await pool.request()
                .input('cod', sql.Int, parseInt(codCliente, 10) || 0)
                .query("SELECT ESTADO FROM Clientes WHERE CodCliente = @cod");
            if (estRes.recordset[0]?.ESTADO === 'BLOQUEADO') {
                logger.warn(`⛔ [Retiro] Cliente CodCliente=${codCliente} está BLOQUEADO. Retiro rechazado.`);
                return res.status(403).json({ error: 'Tu cuenta está bloqueada. No podés crear retiros. Contactá con USER.' });
            }
        } catch (e) { logger.warn('[Retiro] No se pudo verificar estado del cliente:', e.message); }

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
                    AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar', 'Pronto para entregar')
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

        // [RETIRO OBLIGATORIO 21/08] Refuerzo backend de la regla del portal: los pedidos con
        // más de 5 días (por fecha de ingreso) se retiran sí o sí — no se puede armar un retiro
        // dejando afuera una orden vieja retirable DE LA MISMA MONEDA que las seleccionadas.
        // El front ya lo impone; esto cierra la vía directa a la API (o un front cacheado).
        try {
            const DIAS_RETIRO_OBLIGATORIO = 5;
            const idsParam = rawOrderIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n)).join(',');
            if (idsParam) {
                const viejasRes = await pool.request()
                    .input('dias', sql.Int, DIAS_RETIRO_OBLIGATORIO)
                    .query(`
                        SELECT vieja.OrdCodigoOrden
                        FROM OrdenesDeposito vieja WITH(NOLOCK)
                        LEFT JOIN EstadosOrdenes e WITH(NOLOCK) ON e.EOrIdEstadoOrden = vieja.OrdEstadoActual
                        WHERE vieja.CliIdCliente IN (SELECT DISTINCT sel.CliIdCliente FROM OrdenesDeposito sel WHERE sel.OrdIdOrden IN (${idsParam}))
                          AND vieja.MonIdMoneda IN (SELECT DISTINCT sel.MonIdMoneda FROM OrdenesDeposito sel WHERE sel.OrdIdOrden IN (${idsParam}))
                          AND e.EOrNombreEstado IN ('Avisado', 'Ingresado', 'Para avisar', 'Pronto para entregar')
                          AND vieja.OReIdOrdenRetiro IS NULL
                          AND vieja.OrdFechaIngresoOrden < DATEADD(day, -@dias, GETDATE())
                          AND vieja.OrdIdOrden NOT IN (${idsParam})
                    `);
                if (viejasRes.recordset.length > 0) {
                    const codigos = viejasRes.recordset.map(r => (r.OrdCodigoOrden || '').trim()).filter(Boolean).join(', ');
                    logger.warn(`⛔ [Retiro] Cliente ${codCliente} intentó retirar dejando afuera pedidos de +${DIAS_RETIRO_OBLIGATORIO} días: ${codigos}`);
                    return res.status(400).json({
                        error: `Los pedidos con más de ${DIAS_RETIRO_OBLIGATORIO} días tenés que retirarlos sí o sí. Agregá al retiro: ${codigos}.`
                    });
                }
            }
        } catch (eViejas) {
            // Best-effort: si el chequeo falla por algo ajeno, no bloquea el retiro (el front ya lo impone).
            logger.warn('[Retiro] No se pudo verificar retiro obligatorio de pedidos viejos:', eViejas.message);
        }

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

// ── BILLETERA EN EL PORTAL ───────────────────────────────────────────────────
// GET /web-orders/mi-billetera — cuentas con las que el cliente puede pagar desde
// el portal: SECUNDARIAS LIBRES de ANTICIPO (la principal va por sus flujos
// automáticos; las restringidas/prepago pagan consumiendo órdenes). Saldo REAL.
// ── Candado de VISIBILIDAD de la billetera en el portal ─────────────────────
// Clientes.CliBilleteraPortal (0 default): la sección "Mi billetera" y todas sus
// acciones (recargar, movimientos, PDF, cubrir/pagar con saldo) solo existen para
// los clientes que administración habilitó desde el 360 (gestor "Cuentas").
// Es SOLO visibilidad web: el descuento automático del motor no se toca.
const MSG_BILLETERA_PORTAL_OFF = 'Tu billetera no está habilitada en el portal. Hablá con administración para activarla.';
const _billeteraPortalHabilitada = async (pool, codCliente) => {
    const r = await pool.request().input('Cod', sql.Int, codCliente)
        .query('SELECT ISNULL(CliBilleteraPortal, 0) AS H FROM dbo.Clientes WITH(NOLOCK) WHERE CodCliente = @Cod');
    return !!(r.recordset[0] && r.recordset[0].H);
};

exports.getMiBilletera = async (req, res) => {
    try {
        const pool = await getPool();
        const codCliente = req.user?.codCliente;
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        if (!(await _billeteraPortalHabilitada(pool, codCliente)))
            return res.json({ success: true, habilitada: false, data: [], prepago: [] });
        const cli = (await pool.request().input('Cod', sql.Int, codCliente)
            .query('SELECT CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CodCliente = @Cod')).recordset[0];
        if (!cli) return res.json({ success: true, data: [] });
        const r = await pool.request().input('Cli', sql.Int, cli.CliIdCliente).query(`
            SELECT cc.CueIdCuenta, cc.CueNombre, cc.CueTipo,
                   ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                           WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                             AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo
            FROM dbo.CuentasCliente cc WITH(NOLOCK)
            WHERE cc.CliIdCliente = @Cli AND cc.CueActiva = 1 AND cc.CueTipo LIKE 'DINERO%'
              AND cc.CueEsPrincipal = 0 AND cc.CueRestringida = 0
              AND ISNULL(cc.CueModalidadFiscal, 'ANTICIPO_A_FACTURAR') <> 'PREPAGO_FACTURADO'`);
        // Cotización del día: el portal la usa para saber si el saldo cross-moneda alcanza
        const cot = parseFloat((await pool.request()
            .query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC')).recordset[0]?.CotDolar) || 40;
        // F5: cuentas PREPAGO libres — no son medio de pago (su plata ya tiene factura):
        // cubren pedidos pendientes por CONSUMO, sin documento ("Cubrir con mi billetera").
        const rp = await pool.request().input('Cli', sql.Int, cli.CliIdCliente).query(`
            SELECT cc.CueIdCuenta, cc.CueNombre, cc.CueTipo,
                   ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                           WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                             AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo
            FROM dbo.CuentasCliente cc WITH(NOLOCK)
            WHERE cc.CliIdCliente = @Cli AND cc.CueActiva = 1 AND cc.CueTipo LIKE 'DINERO%'
              AND cc.CueEsPrincipal = 0 AND cc.CueRestringida = 0
              AND ISNULL(cc.CueModalidadFiscal, 'ANTICIPO_A_FACTURAR') = 'PREPAGO_FACTURADO'`);
        res.json({ success: true, cotizacion: cot, data: r.recordset.map(c => ({
            CueIdCuenta: c.CueIdCuenta,
            nombre: c.CueNombre || `Cuenta #${c.CueIdCuenta}`,
            moneda: c.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU',
            saldo: Math.round(Number(c.Saldo) * 100) / 100,
        })), prepago: rp.recordset.map(c => ({
            CueIdCuenta: c.CueIdCuenta,
            nombre: c.CueNombre || `Cuenta #${c.CueIdCuenta}`,
            moneda: c.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU',
            saldo: Math.round(Number(c.Saldo) * 100) / 100,
        })) });
    } catch (err) {
        logger.error('[BILLETERA PORTAL] mi-billetera:', err.message);
        res.status(500).json({ error: 'Error al leer la billetera.' });
    }
};

// ── AUTOSERVICIO DE CUENTAS (Mis Recursos) ───────────────────────────────────
// El cliente crea su cuenta de saldo, la recarga SOLO por medios electrónicos
// (Handy / MercadoPago) y ve su estado de cuenta. Reglas de nacimiento desde el
// portal: modalidad ANTICIPO (se factura después), LIBRE, NUNCA acepta negativo
// (eso lo decide solo la administración desde el 360).

// GET /web-orders/mis-cuentas — todas las cuentas de saldo NO principales del cliente
exports.getMisCuentas = async (req, res) => {
    try {
        const pool = await getPool();
        const codCliente = req.user?.codCliente;
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        // Billetera no habilitada en el portal → el front oculta la sección entera
        if (!(await _billeteraPortalHabilitada(pool, codCliente)))
            return res.json({ success: true, habilitada: false, data: [] });
        const cli = (await pool.request().input('Cod', sql.Int, codCliente)
            .query('SELECT CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CodCliente = @Cod')).recordset[0];
        if (!cli) return res.json({ success: true, data: [] });
        // ?incluirCerradas=1 → también las cuentas cerradas (van al final, solo lectura)
        const incluirCerradas = req.query?.incluirCerradas === '1';
        const r = await pool.request().input('Cli', sql.Int, cli.CliIdCliente).input('Inc', sql.Bit, incluirCerradas ? 1 : 0).query(`
            SELECT cc.CueIdCuenta, cc.CueNombre, cc.CueTipo, cc.CueAutoConsumo, cc.CueRestringida, cc.CueActiva, cc.CueUsuarioAlta,
                   ISNULL(cc.CueModalidadFiscal,'ANTICIPO_A_FACTURAR') AS Modalidad, cc.CueFechaAlta,
                   ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                           WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                             AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo
            FROM dbo.CuentasCliente cc WITH(NOLOCK)
            WHERE cc.CliIdCliente = @Cli AND (cc.CueActiva = 1 OR @Inc = 1) AND cc.CueTipo LIKE 'DINERO%' AND cc.CueEsPrincipal = 0
            ORDER BY cc.CueActiva DESC, cc.CueIdCuenta`);
        // Umbral DGI del e-Ticket (10.000 UI): por encima hay que identificar al receptor.
        // El valor de la UI se puede pisar desde ConfiguracionGlobal (clave VALOR_UI).
        const umbral = await _umbralEticketUI(pool);
        res.json({ success: true, umbralCedula: umbral.porMoneda, valorUI: umbral.valorUI, data: r.recordset.map(c => ({
            CueIdCuenta: c.CueIdCuenta,
            nombre: c.CueNombre || `Cuenta #${c.CueIdCuenta}`,
            moneda: c.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU',
            saldo: Math.round(Number(c.Saldo) * 100) / 100,
            automatico: !!c.CueAutoConsumo,
            restringida: !!c.CueRestringida,
            activa: !!c.CueActiva,
            // F4: las prepago también se recargan desde el portal — la recarga emite
            // su factura automática (e-Ticket / e-Factura) al acreditarse el pago.
            permiteRecarga: !!c.CueActiva,
            modalidad: c.Modalidad,
            // Creada desde el portal (usuario 999): solo esas se pueden reabrir desde acá
            creadaPortal: Number(c.CueUsuarioAlta) === 999,
            fechaAlta: c.CueFechaAlta,
        })) });
    } catch (err) {
        logger.error('[BILLETERA PORTAL] mis-cuentas:', err.message);
        res.status(500).json({ error: 'Error al leer tus cuentas.' });
    }
};

// GET /web-orders/mis-cuentas/:CueIdCuenta/movimientos — estado de cuenta (candado pertenencia)
exports.getMisCuentaMovs = async (req, res) => {
    try {
        const pool = await getPool();
        const codCliente = req.user?.codCliente;
        const cueId = parseInt(req.params.CueIdCuenta);
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        if (!(await _billeteraPortalHabilitada(pool, codCliente))) return res.status(403).json({ error: MSG_BILLETERA_PORTAL_OFF });
        const ok = (await pool.request().input('C', sql.Int, cueId).input('Cod', sql.Int, codCliente).query(`
            SELECT 1 AS ok FROM dbo.CuentasCliente cc JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
            WHERE cc.CueIdCuenta = @C AND c.CodCliente = @Cod AND cc.CueEsPrincipal = 0`)).recordset.length;
        if (!ok) return res.status(403).json({ error: 'Esa cuenta no es tuya.' });
        // Cronológico ASC para calcular el saldo corrido (como el libro del rollo);
        // documento = DocSerie-DocNumero del comprobante o el código de la orden consumida.
        const r = await pool.request().input('C', sql.Int, cueId).query(`
            SELECT m.MovIdMovimiento, m.MovTipo, m.MovConcepto, m.MovImporte, m.MovFecha, m.MovAnulado, m.DocIdDocumento,
                   LTRIM(RTRIM(COALESCE(dc.DocSerie, dcPago.DocSerie, ''))) AS DocSerie,
                   COALESCE(CAST(dc.DocNumero AS VARCHAR(50)), CAST(dcPago.DocNumero AS VARCHAR(50)), '') AS DocNumero,
                   oa.CodigoOrdenStr
            FROM dbo.MovimientosCuenta m WITH(NOLOCK)
            LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento
            LEFT JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagIdPago = m.PagIdPago
            -- Fallback (mismo criterio que el libro de gestión): si el movimiento no tiene
            -- documento propio, se toma el del cobro al que pertenece (Pagos → Transacción).
            -- Así un "Pago con saldo" del retiro web muestra su ET-x en la columna Documento.
            OUTER APPLY (
              SELECT TOP 1 dcp.DocSerie, dcp.DocNumero
              FROM dbo.DocumentosContables dcp WITH(NOLOCK)
              WHERE dcp.TcaIdTransaccion = p.PagTcaIdTransaccion AND m.DocIdDocumento IS NULL
              ORDER BY dcp.DocIdDocumento
            ) dcPago
            OUTER APPLY (
              SELECT COALESCE(
                (SELECT TOP 1 OrdCodigoOrden FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OrdIdOrden = m.OrdIdOrden),
                (SELECT TOP 1 CodigoOrden FROM dbo.Ordenes WITH(NOLOCK) WHERE OrdenID = m.OrdIdOrden)
              ) AS CodigoOrdenStr
            ) oa
            WHERE m.CueIdCuenta = @C AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
            ORDER BY m.MovFecha ASC, m.MovIdMovimiento ASC`);
        const LBL = { ANTICIPO: 'Recarga / Anticipo', CONSUMO_CUENTA: 'Consumo de orden', TRANSFERENCIA_ENTRADA: 'Transferencia recibida',
                      TRANSFERENCIA_SALIDA: 'Pago / Transferencia enviada', PAGO_SALDO: 'Pago con saldo', CARGA_PREPAGO: 'Carga facturada', PAGO: 'Pago', AJUSTE_POS: 'Ajuste', AJUSTE_NEG: 'Ajuste' };
        // Una transferencia cuyo concepto empieza con "Pago" ES un pago con el saldo de la cuenta
        const lblDe = (m) => (/^pago\b/i.test(m.MovConcepto || '') && m.MovTipo === 'TRANSFERENCIA_SALIDA') ? 'Pago con saldo'
            : (/^pago\b/i.test(m.MovConcepto || '') && m.MovTipo === 'TRANSFERENCIA_ENTRADA') ? 'Pago recibido de otra cuenta'
            : (LBL[m.MovTipo] || m.MovTipo);
        // Saldo corrido: los anulados se muestran pero no mueven el saldo.
        let saldo = 0;
        const data = r.recordset.map(m => {
            const importe = Number(m.MovImporte);
            const saldoIn = saldo;
            if (!m.MovAnulado) saldo = Math.round((saldo + importe) * 10000) / 10000;
            return {
                id: m.MovIdMovimiento, fecha: m.MovFecha, tipo: lblDe(m), tipoRaw: m.MovTipo,
                concepto: m.MovConcepto, importe, anulado: !!m.MovAnulado,
                documento: m.DocSerie ? `${m.DocSerie}-${m.DocNumero}` : (m.CodigoOrdenStr || null),
                // F4: comprobante descargable — solo cargas facturadas con doc propio
                docId: (m.MovTipo === 'CARGA_PREPAGO' && m.DocIdDocumento) ? m.DocIdDocumento : null,
                saldoIn, saldoFn: saldo,
                debe: (!m.MovAnulado && importe < 0) ? Math.abs(importe) : 0,
                haber: (!m.MovAnulado && importe > 0) ? importe : 0,
            };
        });
        // Más reciente arriba; tope 300 filas para el portal
        res.json({ success: true, data: data.reverse().slice(0, 300), saldoFinal: saldo });
    } catch (err) {
        logger.error('[BILLETERA PORTAL] movimientos:', err.message);
        res.status(500).json({ error: 'Error al leer los movimientos.' });
    }
};

// POST /web-orders/mis-cuentas — crear cuenta desde el portal
// { nombre, moneda: 'UYU'|'USD', automatico: bool }
exports.crearMiCuenta = async (req, res) => {
    try {
        const pool = await getPool();
        const codCliente = req.user?.codCliente;
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        if (!(await _billeteraPortalHabilitada(pool, codCliente))) return res.status(403).json({ error: MSG_BILLETERA_PORTAL_OFF });
        const nombre = String(req.body?.nombre || '').trim();
        const moneda = req.body?.moneda === 'USD' ? 'USD' : 'UYU';
        const automatico = !!req.body?.automatico;
        if (nombre.length < 3 || nombre.length > 80) return res.status(400).json({ error: 'Poné un nombre de 3 a 80 caracteres (ej: "Mi saldo adelantado").' });
        const cli = (await pool.request().input('Cod', sql.Int, codCliente)
            .query('SELECT CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CodCliente = @Cod')).recordset[0];
        if (!cli) return res.status(400).json({ error: 'Cliente no encontrado.' });
        const cant = (await pool.request().input('Cli', sql.Int, cli.CliIdCliente)
            .query(`SELECT COUNT(*) n FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueActiva = 1 AND CueEsPrincipal = 0 AND CueTipo LIKE 'DINERO%'`)).recordset[0].n;
        if (cant >= 5) return res.status(400).json({ error: 'Ya tenés 5 cuentas de saldo. Si necesitás otra, hablá con administración.' });
        const ins = await pool.request()
            .input('Cli', sql.Int, cli.CliIdCliente)
            .input('Tipo', sql.VarChar(20), moneda === 'USD' ? 'DINERO_USD' : 'DINERO_UYU')
            .input('Mon', sql.Int, moneda === 'USD' ? 2 : 1)
            .input('Nombre', sql.NVarChar(100), nombre)
            .input('Auto', sql.Bit, automatico ? 1 : 0)
            .query(`
                INSERT INTO dbo.CuentasCliente
                  (CliIdCliente, CueTipo, ProIdProducto, MonIdMoneda, CPaIdCondicion,
                   CueSaldoActual, CueLimiteCredito, CuePuedeNegativo, CueCicloActivo,
                   CueActiva, CueFechaAlta, CueUsuarioAlta,
                   CueNombre, CueEsPrincipal, CueRestringida, CueAutoConsumo, CueModalidadFiscal)
                OUTPUT INSERTED.CueIdCuenta
                VALUES (@Cli, @Tipo, NULL, @Mon, 1,
                        0, 0, 0, 0,             -- NUNCA nace aceptando negativo (decisión de administración)
                        1, GETDATE(), 999,
                        @Nombre, 0, 0, @Auto, 'ANTICIPO_A_FACTURAR')`);
        const CueIdCuenta = ins.recordset[0].CueIdCuenta;
        logger.info(`[BILLETERA PORTAL] Cliente ${cli.CliIdCliente} creó su cuenta "${nombre}" (${moneda}, auto=${automatico}) #${CueIdCuenta}`);
        res.status(201).json({ success: true, data: { CueIdCuenta } });
    } catch (err) {
        logger.error('[BILLETERA PORTAL] crear cuenta:', err.message);
        res.status(500).json({ error: 'No se pudo crear la cuenta.' });
    }
};

// POST /web-orders/mis-cuentas/:CueIdCuenta/cerrar — el cliente cierra SU cuenta,
// solo si está en cero (mismo criterio que el cierre de administración). Los
// movimientos quedan visibles con el switch "Solo activas" apagado; reabrirla
// es cosa de administración.
exports.cerrarMiCuenta = async (req, res) => {
    try {
        const pool = await getPool();
        const codCliente = req.user?.codCliente;
        const cueId = parseInt(req.params.CueIdCuenta);
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        if (!(await _billeteraPortalHabilitada(pool, codCliente))) return res.status(403).json({ error: MSG_BILLETERA_PORTAL_OFF });
        const cta = (await pool.request().input('C', sql.Int, cueId).input('Cod', sql.Int, codCliente).query(`
            SELECT cc.CueIdCuenta, cc.CueNombre, cc.CueActiva, cc.CueEsPrincipal,
                   ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                           WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                             AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo
            FROM dbo.CuentasCliente cc WITH(NOLOCK)
            JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
            WHERE cc.CueIdCuenta = @C AND c.CodCliente = @Cod AND cc.CueTipo LIKE 'DINERO%'`)).recordset[0];
        if (!cta) return res.status(403).json({ error: 'Esa cuenta no es tuya.' });
        if (cta.CueEsPrincipal) return res.status(400).json({ error: 'La cuenta principal no se puede cerrar.' });
        if (!cta.CueActiva) return res.status(400).json({ error: 'Esa cuenta ya está cerrada.' });
        if (Math.abs(Number(cta.Saldo)) > 0.009) {
            return res.status(400).json({ error: `Para cerrarla la cuenta tiene que estar en cero (hoy tiene ${Number(cta.Saldo).toFixed(2)} de saldo). Usá el saldo o pedile a administración que lo transfiera.` });
        }
        await pool.request().input('C', sql.Int, cueId)
            .query('UPDATE dbo.CuentasCliente SET CueActiva = 0, CueAutoConsumo = 0 WHERE CueIdCuenta = @C');
        logger.info(`[BILLETERA PORTAL] Cliente ${codCliente} cerró su cuenta "${cta.CueNombre || cueId}" #${cueId}`);
        res.json({ success: true, message: `Cuenta "${cta.CueNombre || `#${cueId}`}" cerrada.` });
    } catch (err) {
        logger.error('[BILLETERA PORTAL] cerrar cuenta:', err.message);
        res.status(500).json({ error: 'No se pudo cerrar la cuenta.' });
    }
};

// POST /web-orders/mis-cuentas/:CueIdCuenta/reabrir — el cliente reabre una cuenta
// cerrada SOLO si la creó él desde el portal (CueUsuarioAlta = 999). Las creadas o
// gestionadas por administración se reabren solo desde el gestor de Cuentas.
// Reabre sin descuento automático (el cierre lo apaga y acá no se re-enciende solo).
exports.reabrirMiCuenta = async (req, res) => {
    try {
        const pool = await getPool();
        const codCliente = req.user?.codCliente;
        const cueId = parseInt(req.params.CueIdCuenta);
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        if (!(await _billeteraPortalHabilitada(pool, codCliente))) return res.status(403).json({ error: MSG_BILLETERA_PORTAL_OFF });
        const cta = (await pool.request().input('C', sql.Int, cueId).input('Cod', sql.Int, codCliente).query(`
            SELECT cc.CueIdCuenta, cc.CueNombre, cc.CueActiva, cc.CueEsPrincipal, cc.CueUsuarioAlta, cc.CliIdCliente
            FROM dbo.CuentasCliente cc WITH(NOLOCK)
            JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
            WHERE cc.CueIdCuenta = @C AND c.CodCliente = @Cod AND cc.CueTipo LIKE 'DINERO%'`)).recordset[0];
        if (!cta) return res.status(403).json({ error: 'Esa cuenta no es tuya.' });
        if (cta.CueActiva) return res.status(400).json({ error: 'Esa cuenta ya está abierta.' });
        if (Number(cta.CueUsuarioAlta) !== 999) {
            return res.status(400).json({ error: 'Esa cuenta la creó administración: solo ellos pueden reabrirla.' });
        }
        // Mismo tope que al crear: máximo 5 cuentas de saldo abiertas
        const cant = (await pool.request().input('Cli', sql.Int, cta.CliIdCliente)
            .query(`SELECT COUNT(*) n FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND CueActiva = 1 AND CueEsPrincipal = 0 AND CueTipo LIKE 'DINERO%'`)).recordset[0].n;
        if (cant >= 5) return res.status(400).json({ error: 'Ya tenés 5 cuentas de saldo abiertas: cerrá una antes de reabrir esta.' });
        await pool.request().input('C', sql.Int, cueId)
            .query('UPDATE dbo.CuentasCliente SET CueActiva = 1 WHERE CueIdCuenta = @C');
        logger.info(`[BILLETERA PORTAL] Cliente ${codCliente} reabrió su cuenta "${cta.CueNombre || cueId}" #${cueId}`);
        res.json({ success: true, message: `Cuenta "${cta.CueNombre || `#${cueId}`}" reabierta (sin descuento automático).` });
    } catch (err) {
        logger.error('[BILLETERA PORTAL] reabrir cuenta:', err.message);
        res.status(500).json({ error: 'No se pudo reabrir la cuenta.' });
    }
};

// Umbral DGI del e-Ticket: sobre 10.000 UI el receptor debe identificarse (CI).
// UI configurable en ConfiguracionGlobal clave 'VALOR_UI'; fallback 6.5 pesos.
const _umbralEticketUI = async (pool) => {
    let valorUI = 6.5;
    try {
        const r = await pool.request().query("SELECT Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = 'VALOR_UI'");
        const v = parseFloat(String(r.recordset[0]?.Valor || '').replace(',', '.'));
        if (v > 0) valorUI = v;
    } catch (_) { /* tabla o clave ausente: se usa el default */ }
    const umbralUYU = Math.round(10000 * valorUI);
    let cot = 40;
    try {
        const c = await pool.request().query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC');
        cot = parseFloat(c.recordset[0]?.CotDolar) || 40;
    } catch (_) { /* sin cotización: default */ }
    return { valorUI, porMoneda: { UYU: umbralUYU, USD: Math.round((umbralUYU / cot) * 100) / 100 } };
};

// POST /web-orders/mis-cuentas/:CueIdCuenta/recargar — inicia la recarga electrónica
// { importe, gateway: 'handy' | 'mercadopago',
//   comprobante?: 'e-ticket'|'e-factura', documentoFiscal?, nombreFiscal? }  → { url, transactionId }
// Cuentas PREPAGO (F4): la recarga emite su factura automática al acreditarse el pago,
// por eso acá se pide y valida el comprobante (e-Factura exige RUT válido; e-Ticket
// exige cédula si el importe supera el umbral DGI de 10.000 UI).
exports.iniciarRecargaCuenta = async (req, res) => {
    try {
        const pool = await getPool();
        const codCliente = req.user?.codCliente;
        const cueId = parseInt(req.params.CueIdCuenta);
        const importe = Math.round(Number(req.body?.importe) * 100) / 100;
        const gateway = req.body?.gateway === 'mercadopago' ? 'mercadopago' : 'handy';
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        if (!(await _billeteraPortalHabilitada(pool, codCliente))) return res.status(403).json({ error: MSG_BILLETERA_PORTAL_OFF });
        if (!(importe > 0)) return res.status(400).json({ error: 'El importe debe ser mayor a 0.' });
        const cta = (await pool.request().input('C', sql.Int, cueId).input('Cod', sql.Int, codCliente).query(`
            SELECT cc.CueIdCuenta, cc.CueNombre, cc.CueTipo, cc.CueActiva, cc.CueEsPrincipal,
                   ISNULL(cc.CueModalidadFiscal,'ANTICIPO_A_FACTURAR') AS Modalidad
            FROM dbo.CuentasCliente cc JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
            WHERE cc.CueIdCuenta = @C AND c.CodCliente = @Cod`)).recordset[0];
        if (!cta || !cta.CueActiva || cta.CueEsPrincipal) return res.status(400).json({ error: 'Esa cuenta no admite recargas desde el portal.' });
        const moneda = cta.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU';
        const nombreCuenta = cta.CueNombre || `Cuenta #${cueId}`;
        const ordersData = { type: 'wallet-topup', cueIdCuenta: cueId, importe, moneda, nombreCuenta };

        if (cta.Modalidad === 'PREPAGO_FACTURADO') {
            const { validarDocumentoUY, normalizarDocumento } = require('../utils/documentoUY');
            const comprobante = req.body?.comprobante === 'e-factura' ? 'e-factura'
                : (req.body?.comprobante === 'e-ticket' ? 'e-ticket' : null);
            if (!comprobante) return res.status(400).json({ error: 'Elegí qué comprobante querés para esta recarga: e-Ticket o e-Factura.' });
            const docFiscal = normalizarDocumento(req.body?.documentoFiscal);
            const nombreFiscal = String(req.body?.nombreFiscal || '').trim();
            if (comprobante === 'e-factura') {
                const v = validarDocumentoUY(docFiscal);
                if (!v.valido || v.tipo !== 'RUT') {
                    return res.status(400).json({ error: v.tipo === 'RUT' ? v.motivo : 'La e-Factura necesita un RUT válido de 12 dígitos (sin puntos ni guiones).' });
                }
                if (nombreFiscal.length < 3) return res.status(400).json({ error: 'Poné la razón social que va en la e-Factura.' });
            } else {
                const umbral = await _umbralEticketUI(pool);
                const tope = umbral.porMoneda[moneda] || umbral.porMoneda.UYU;
                if (importe >= tope && !docFiscal) {
                    return res.status(400).json({ error: `Para recargas de ${moneda === 'USD' ? 'US$' : '$'} ${tope} o más, DGI exige identificar al receptor del e-Ticket: poné tu cédula (o elegí e-Factura con RUT).` });
                }
                if (docFiscal) {
                    const v = validarDocumentoUY(docFiscal);
                    if (!v.valido) return res.status(400).json({ error: v.motivo });
                }
            }
            // La factura la emite el webhook al confirmarse el pago (F4)
            ordersData.prepago = true;
            ordersData.docTipo = comprobante === 'e-factura' ? '01' : '07';
            ordersData.docReceptor = { documento: docFiscal || '', nombre: nombreFiscal || '' };
        }
        const itemDesc = `Recarga de saldo — ${nombreCuenta}`;
        if (gateway === 'handy') {
            const { createPaymentLink } = require('../services/handyService');
            const result = await createPaymentLink({
                products: [{ Name: itemDesc.substring(0, 50), Quantity: 1, Amount: importe, TaxedAmount: Number((importe / 1.22).toFixed(2)) }],
                totalAmount: importe,
                currencyCode: moneda === 'USD' ? 840 : 858,
                commerceName: 'USER',
                ordersData,
                codCliente,
                logPrefix: '[HANDY TOPUP]'
            });
            if (!result.success) return res.status(500).json({ error: result.error });
            return res.json({ success: true, url: result.url, transactionId: result.transactionId });
        }
        const { createPreference } = require('../services/mercadoPagoService');
        const result = await createPreference({
            items: [{ id: String(cueId), title: itemDesc.substring(0, 256), quantity: 1, unit_price: importe, currency_id: moneda }],
            totalAmount: importe,
            currency: moneda,
            commerceName: 'USER',
            ordersData,
            codCliente,
            logPrefix: '[MP TOPUP]'
        });
        if (!result.success) return res.status(500).json({ error: result.error });
        return res.json({ success: true, url: result.url || result.initPoint, transactionId: result.transactionId });
    } catch (err) {
        logger.error('[BILLETERA PORTAL] recargar:', err.message);
        res.status(500).json({ error: 'No se pudo iniciar la recarga.' });
    }
};

// GET /web-orders/mis-cuentas/:CueIdCuenta/comprobantes/:DocIdDocumento — F4
// Datos completos de la factura de una recarga (para dibujar el MISMO PDF que la
// bandeja con generarPdfFacturaDGI). Candado: la cuenta es del cliente del token,
// el documento es suyo y está atado a esa cuenta por un movimiento (CARGA_PREPAGO).
exports.getMiComprobante = async (req, res) => {
    try {
        const pool = await getPool();
        const codCliente = req.user?.codCliente;
        const cueId = parseInt(req.params.CueIdCuenta);
        const docId = parseInt(req.params.DocIdDocumento);
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        if (!(await _billeteraPortalHabilitada(pool, codCliente))) return res.status(403).json({ error: MSG_BILLETERA_PORTAL_OFF });
        if (!cueId || !docId) return res.status(400).json({ error: 'Faltan datos del comprobante.' });
        const ok = (await pool.request().input('C', sql.Int, cueId).input('Cod', sql.Int, codCliente).input('D', sql.Int, docId).query(`
            SELECT TOP 1 1 AS ok
            FROM dbo.CuentasCliente cc
            JOIN dbo.Clientes c  ON c.CliIdCliente = cc.CliIdCliente
            JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = @D AND dc.CliIdCliente = cc.CliIdCliente
            WHERE cc.CueIdCuenta = @C AND c.CodCliente = @Cod AND cc.CueEsPrincipal = 0
              AND EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                          WHERE m.CueIdCuenta = @C AND m.DocIdDocumento = @D
                            AND (m.MovAnulado IS NULL OR m.MovAnulado = 0))`)).recordset.length;
        if (!ok) return res.status(403).json({ error: 'Ese comprobante no es de tu cuenta.' });
        // Mismo payload { doc, detalles } que usa la bandeja para dibujar el PDF
        return require('./cfeController').getDetalleFactura({ params: { id: docId } }, res);
    } catch (err) {
        logger.error('[BILLETERA PORTAL] comprobante:', err.message);
        res.status(500).json({ error: 'No se pudo leer el comprobante.' });
    }
};

// Acreditar una recarga confirmada por el gateway (llamado desde los webhooks).
// · Cuenta ANTICIPO (legacy): reusa registrarPagoAnticipo de caja — TCA ANTICIPO admin
//   + Pago (método del gateway) + recibo RA + movimiento ANTICIPO + asiento Caja/2.3.1.
// · Cuenta PREPAGO (F4): la recarga ES una Venta de saldo automática — se emite la
//   factura (e-Ticket '07' / e-Factura '01' según eligió el cliente, línea "Crédito
//   prepago de servicios", IVA 22 incluido, paga con el medio del gateway; el CFE
//   queda PENDIENTE en la bandeja y el asiento Ventas+IVA+Caja lo hace el motor de
//   crearFacturaManual) y después se registra la CARGA_PREPAGO atada a esa factura.
const _acreditarRecargaBilletera = async (pool, { storedData, codCliente, txId, metodoPagoId, monedaId, monto, req }) => {
    const cli = (await pool.request().input('Cod', sql.Int, codCliente)
        .query('SELECT CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CodCliente = @Cod')).recordset[0];
    if (!cli) throw new Error(`Cliente CodCliente=${codCliente} no encontrado para la recarga`);

    // Modalidad REAL de la cuenta al momento de acreditar (no la del momento del link)
    const ctaAcred = (await pool.request().input('C', sql.Int, parseInt(storedData.cueIdCuenta)).query(`
        SELECT CueIdCuenta, CliIdCliente, CueNombre, MonIdMoneda, CueActiva,
               ISNULL(CueModalidadFiscal,'ANTICIPO_A_FACTURAR') AS Modalidad
        FROM dbo.CuentasCliente WITH(NOLOCK) WHERE CueIdCuenta = @C`)).recordset[0];
    if (!ctaAcred) throw new Error(`Cuenta #${storedData.cueIdCuenta} inexistente para la recarga Tx ${txId}`);
    if (ctaAcred.CliIdCliente !== cli.CliIdCliente) throw new Error(`La cuenta #${storedData.cueIdCuenta} no es del cliente ${codCliente} (Tx ${txId})`);

    if (ctaAcred.Modalidad === 'PREPAGO_FACTURADO') {
        // ── PREPAGO: factura automática + CARGA_PREPAGO ─────────────────────────
        const nombreCta = ctaAcred.CueNombre || storedData.nombreCuenta || `cuenta #${storedData.cueIdCuenta}`;
        // Guard anti-duplicado: la carga de esta Tx ya existe
        const dupP = await pool.request().input('T', sql.NVarChar(200), `%(Tx: ${txId})%`)
            .query(`SELECT TOP 1 MovIdMovimiento FROM dbo.MovimientosCuenta WITH(NOLOCK) WHERE MovTipo = 'CARGA_PREPAGO' AND MovObservaciones LIKE @T`);
        if (dupP.recordset.length) { logger.info(`[BILLETERA PORTAL] Recarga prepago Tx ${txId} ya acreditada — webhook duplicado ignorado.`); return { duplicated: true }; }
        const monCta = Number(ctaAcred.MonIdMoneda) === 2 ? 2 : 1;
        if (monCta !== monedaId) throw new Error(`La recarga Tx ${txId} llegó en ${monedaId === 2 ? 'US$' : '$'} pero la cuenta #${storedData.cueIdCuenta} es en ${monCta === 2 ? 'US$' : '$'}: acreditar a mano.`);
        const r2 = (n) => Math.round(n * 100) / 100;
        const neto = r2(monto / 1.22);

        // 1. Emitir la factura con el motor interno (misma semántica que "Venta de saldo")
        const cfeCtrl = require('./cfeController');
        const outFact = await new Promise((resolve) => {
            const fakeRes = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, ...o }); } };
            cfeCtrl.crearFacturaManual({ user: { id: 999 }, body: {
                DocTipo: storedData.docTipo === '01' ? '01' : '07',
                MonIdMoneda: monedaId,
                CliIdCliente: cli.CliIdCliente,
                Lineas: [{ concepto: `Crédito prepago de servicios — carga de saldo "${nombreCta}"`, cantidad: 1, precioUnitario: monto, iva: 22 }],
                Totales: { subtotal: neto, iva: r2(monto - neto), total: monto },
                DocPagado: true,
                Pagos: [{ metodoPagoId, monedaId, monto }],
                DocCliNombre: storedData.docReceptor?.nombre || '',
                DocCliDocumento: storedData.docReceptor?.documento || '',
            } }, fakeRes);
        });
        if (outFact.code >= 400 || !outFact.docId) throw new Error(`No se pudo emitir la factura de la recarga Tx ${txId}: ${outFact.error || 'sin docId'}`);

        // 2. Cargar el saldo atado a esa factura (mismo movimiento que carga-prepago origen CAJA)
        try {
            const docRow = (await pool.request().input('D', sql.Int, outFact.docId)
                .query('SELECT DocSerie, DocNumero FROM dbo.DocumentosContables WITH(NOLOCK) WHERE DocIdDocumento = @D')).recordset[0] || {};
            const refDoc = `${String(docRow.DocSerie || 'M').trim()}-${docRow.DocNumero || outFact.docId}`;
            await contabilidadService.registrarMovimiento({
                CueIdCuenta: parseInt(storedData.cueIdCuenta),
                MovTipo: 'CARGA_PREPAGO',
                MovConcepto: `Recarga web — Venta de saldo ${refDoc}`,
                MovImporte: monto,
                MovUsuarioAlta: 999,
                DocIdDocumento: outFact.docId,
                MovRefExterna: `VS-${outFact.docId}`,
                MovObservaciones: `Recarga de billetera desde el portal — "${nombreCta}" (Tx: ${txId})`,
            });
            logger.info(`[BILLETERA PORTAL] ✅ Recarga PREPAGO acreditada: ${monedaId === 2 ? 'US$' : '$'} ${monto} en "${nombreCta}" (#${storedData.cueIdCuenta}) con factura ${refDoc} (doc ${outFact.docId}, Tx ${txId})`);
        } catch (eCarga) {
            // La factura YA existe: NO reintentar la emisión. Recuperación manual:
            // libro de la cuenta prepago → "Vincular factura emitida".
            logger.error(`[BILLETERA PORTAL] 🚨 CRÍTICO Tx ${txId}: la factura doc ${outFact.docId} se emitió pero la CARGA_PREPAGO falló (${eCarga.message}). Cargar a mano con "Vincular factura emitida" en el libro de la cuenta #${storedData.cueIdCuenta}.`);
            throw eCarga;
        }
        const ioP = req?.app?.get ? req.app.get('socketio') : null;
        if (ioP) ioP.emit('actualizado', { type: 'actualizacion' });
        return { code: 200, docId: outFact.docId };
    }

    // ── ANTICIPO (legacy): recibo interno, se factura después ───────────────────
    const dup = await pool.request().input('T', sql.NVarChar(200), `%${txId}%`)
        .query(`SELECT TOP 1 TcaIdTransaccion FROM dbo.TransaccionesCaja WITH(NOLOCK) WHERE TcaTipoDocumento = 'ANTICIPO' AND TcaObservaciones LIKE @T`);
    if (dup.recordset.length) { logger.info(`[BILLETERA PORTAL] Recarga Tx ${txId} ya acreditada — webhook duplicado ignorado.`); return { duplicated: true }; }
    let cot = 1;
    if (monedaId === 2) {
        const c = await pool.request().query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC');
        cot = parseFloat(c.recordset[0]?.CotDolar) || 1;
    }
    const cajaCtrl = require('./cajaController');
    const out = await new Promise((resolve) => {
        const fakeRes = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, ...o }); } };
        cajaCtrl.registrarPagoAnticipo({ user: { id: 999 }, body: {
            admin: true,
            clienteId: cli.CliIdCliente,
            cuentaId: storedData.cueIdCuenta,
            importe: monto,
            metodoPagoId,
            monedaId,
            cotizacion: cot,
            concepto: `Recarga de billetera desde el portal — ${storedData.nombreCuenta || ('cuenta #' + storedData.cueIdCuenta)} (Tx: ${txId})`,
        } }, fakeRes);
    });
    if (out.code >= 400 || out.error) throw new Error(out.error || `Recarga rechazada (HTTP ${out.code})`);
    logger.info(`[BILLETERA PORTAL] ✅ Recarga acreditada: ${monto} (${monedaId === 2 ? 'US$' : '$'}) en cuenta #${storedData.cueIdCuenta} vía Tx ${txId}`);
    const ioT = req?.app?.get ? req.app.get('socketio') : null;
    if (ioT) ioT.emit('actualizado', { type: 'actualizacion' });
    return out;
};

// Exportado para poder probarlo/recuperarlo sin pasar por el webhook real
exports._acreditarRecargaBilletera = _acreditarRecargaBilletera;

// POST /web-orders/pickup-orders/cubrir-con-billetera — F5
// "Cubrir con mi billetera": el cliente cubre sus pedidos pendientes con el saldo
// PREPAGO (semántica CONSUMO, igual que el descuento automático del motor: sin
// documento — la factura de esa plata existió al cargarla). Reglas:
//   · Solo cuentas PREPAGO_FACTURADO activas; NUNCA quedan en negativo.
//   · Órdenes ENTERAS: cada orden sale entera de UNA cuenta (no se parte).
//   · Prioridad del motor por orden: restringida que permita el artículo →
//     libre de la misma moneda → libre de la otra moneda (a cotización del día).
//   · Se cubren TODAS las órdenes elegidas o no se hace nada (claridad).
// Ejecuta cada cobertura con el MISMO motor que usa administración
// (consumirDesdeSaldo: consumo + marca CUBIERTO + deuda cancelada + contra-asiento
// + orden pronta) y recién después crea el retiro, que nace Abonado por cobertura.
// Body: { orders: [{OrdIdOrden}], lugarRetiro, direccion, departamento, localidad,
//         agenciaId, customAgencia, receptorNombre, preview }
exports.cubrirConBilletera = async (req, res) => {
    try {
        const pool = await getPool();
        const { orders, lugarRetiro, direccion, departamento, localidad,
                agenciaId, customAgencia, receptorNombre, preview } = req.body;
        const codCliente = req.user?.codCliente;
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        if (!(await _billeteraPortalHabilitada(pool, codCliente))) return res.status(403).json({ error: MSG_BILLETERA_PORTAL_OFF });
        if (!orders?.length) return res.status(400).json({ error: 'No hay pedidos para cubrir.' });
        const cli = (await pool.request().input('Cod', sql.Int, codCliente)
            .query('SELECT CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CodCliente = @Cod')).recordset[0];
        if (!cli) return res.status(400).json({ error: 'Cliente no encontrado.' });

        const r2 = (n) => Math.round(n * 100) / 100;
        const cot = parseFloat((await pool.request()
            .query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC')).recordset[0]?.CotDolar) || 40;

        // 1) Las órdenes elegidas, con su movimiento ORDEN pendiente de facturar
        const ordIds = orders.map(o => parseInt(o.OrdIdOrden)).filter(Boolean);
        if (!ordIds.length) return res.status(400).json({ error: 'No hay pedidos válidos para cubrir.' });
        const reqOrd = pool.request().input('Cli', sql.Int, cli.CliIdCliente);
        ordIds.forEach((id, i) => reqOrd.input(`o${i}`, sql.Int, id));
        const filas = (await reqOrd.query(`
            SELECT od.OrdIdOrden, od.OrdCodigoOrden, od.OrdNombreTrabajo, od.MonIdMoneda, od.ProIdProducto, od.PagIdPago,
                   od.OrdCostoFinal, od.OReIdOrdenRetiro,
                   mv.MovIdMovimiento, mv.MovImporte, mv.MovObservaciones, mv.DocIdDocumento,
                   -- Solo cobertura ENTERA cuenta como "ya cubierta": un consumo PARCIAL dejó
                   -- un resto vivo en la principal que ESTA acción debe poder cubrir.
                   CASE WHEN EXISTS (SELECT 1 FROM dbo.MovimientosCuenta cx WITH(NOLOCK)
                                     JOIN dbo.CuentasCliente ccx WITH(NOLOCK) ON ccx.CueIdCuenta = cx.CueIdCuenta
                                     WHERE ccx.CliIdCliente = od.CliIdCliente AND cx.MovTipo = 'CONSUMO_CUENTA'
                                       AND (cx.MovAnulado IS NULL OR cx.MovAnulado = 0)
                                       AND cx.MovObservaciones LIKE 'CUBIERTO[_]CUENTA[_]%'
                                       AND (cx.OrdIdOrden = od.OrdIdOrden OR cx.OrdIdOrden = erp.OrdenID)) THEN 1 ELSE 0 END AS YaConsumida
            FROM dbo.OrdenesDeposito od WITH(NOLOCK)
            OUTER APPLY (SELECT TOP 1 o.OrdenID FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.CodigoOrden = od.OrdCodigoOrden) erp
            OUTER APPLY (
                SELECT TOP 1 m.MovIdMovimiento, m.MovImporte, m.MovObservaciones, m.DocIdDocumento
                FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
                WHERE cc.CliIdCliente = od.CliIdCliente AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.DocIdDocumento IS NULL
                  AND (m.MovObservaciones IS NULL OR (m.MovObservaciones NOT LIKE 'CUBIERTO%' AND m.MovObservaciones NOT LIKE 'MATERIAL_CUBIERTO%'))
                  AND (m.OrdIdOrden = od.OrdIdOrden OR m.OrdIdOrden = erp.OrdenID)
                ORDER BY m.MovIdMovimiento DESC
            ) mv
            WHERE od.CliIdCliente = @Cli AND od.OrdIdOrden IN (${ordIds.map((_, i) => `@o${i}`).join(',')})`)).recordset;
        if (filas.length !== ordIds.length) return res.status(400).json({ error: 'Alguno de los pedidos no es tuyo o no existe.' });
        // Nunca crear un SEGUNDO retiro para una orden que ya tiene el suyo
        const conRetiro = filas.filter(f => f.OReIdOrdenRetiro);
        if (conRetiro.length) {
            return res.status(400).json({ error: `${conRetiro.map(f => (f.OrdCodigoOrden || '').trim()).join(', ')} ya ${conRetiro.length > 1 ? 'tienen' : 'tiene'} un retiro creado (RW-${conRetiro[0].OReIdOrdenRetiro}). Actualizá la página.` });
        }

        // 2) Cuentas PREPAGO del cliente (con saldo real y artículos permitidos)
        const ctas = (await pool.request().input('Cli', sql.Int, cli.CliIdCliente).query(`
            SELECT cc.CueIdCuenta, cc.CueNombre, cc.MonIdMoneda, cc.CueRestringida,
                   ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                           WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                             AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo
            FROM dbo.CuentasCliente cc WITH(NOLOCK)
            WHERE cc.CliIdCliente = @Cli AND cc.CueActiva = 1 AND cc.CueTipo LIKE 'DINERO%'
              AND cc.CueEsPrincipal = 0
              AND ISNULL(cc.CueModalidadFiscal,'ANTICIPO_A_FACTURAR') = 'PREPAGO_FACTURADO'
            ORDER BY cc.CueIdCuenta`)).recordset
            .map(c => ({ id: c.CueIdCuenta, nombre: (c.CueNombre || `cuenta #${c.CueIdCuenta}`).trim(),
                         mon: Number(c.MonIdMoneda) === 2 ? 2 : 1, restringida: !!c.CueRestringida,
                         disp: r2(Number(c.Saldo)) }))
            .filter(c => c.disp > 0.009);
        const permitidos = new Map();
        const restr = ctas.filter(c => c.restringida);
        if (restr.length) {
            const ap = await pool.request().query(`
                SELECT CueIdCuenta, ProIdProducto FROM dbo.CuentasClienteArticulosPermitidos WITH(NOLOCK)
                WHERE CueIdCuenta IN (${restr.map(c => c.id).join(',')})`);
            for (const row of ap.recordset) {
                if (!permitidos.has(row.CueIdCuenta)) permitidos.set(row.CueIdCuenta, new Set());
                permitidos.get(row.CueIdCuenta).add(row.ProIdProducto);
            }
        }

        // 3) Plan: cada orden ENTERA en una cuenta, prioridad del motor, sin negativo
        const plan = [], yaCubiertas = [], sinCubrir = [];
        for (const f of filas) {
            const codigo = (f.OrdCodigoOrden || `#${f.OrdIdOrden}`).trim();
            if (f.PagIdPago || f.YaConsumida || (!f.MovIdMovimiento && f.YaConsumida)) { yaCubiertas.push(codigo); continue; }
            if (!f.MovIdMovimiento) { sinCubrir.push(`${codigo} (no está pendiente de facturar: cubrila por caja)`); continue; }
            const monOrden = Number(f.MonIdMoneda) === 2 ? 2 : 1;
            const importe = r2(Math.abs(Number(f.MovImporte)));
            const candidatas = [
                ...ctas.filter(c => c.restringida && f.ProIdProducto != null && permitidos.get(c.id)?.has(f.ProIdProducto)),
                ...ctas.filter(c => !c.restringida && c.mon === monOrden),
                ...ctas.filter(c => !c.restringida && c.mon !== monOrden),
            ];
            let elegida = null, importeCta = 0, cruzada = false, partes = null;
            for (const c of candidatas) {
                cruzada = c.mon !== monOrden;
                importeCta = cruzada ? (monOrden === 2 ? r2(importe * cot) : r2(importe / cot)) : importe;
                if (c.disp + 0.001 >= importeCta) { elegida = c; break; }
            }
            if (!elegida) {
                // PARTES 2/9/2026 (regla usuario, sin traspasos): ninguna billetera sola
                // alcanza — el pedido se consume REPARTIDO: primero la de la MISMA moneda
                // hasta dejarla en 0, y el remanente @ cot. desde la(s) otra(s). Un CONSUMO
                // por cuenta, todos con la marca sobre la misma orden.
                const fuentes = ctas.filter(c => !c.restringida)
                    .map(c => ({ id: c.id, nombre: c.nombre, mon: c.mon, disp: c.disp }));
                const planP = contabilidadService.planPartesConsumoBilletera({ fuentes, monOrden, importe, cot });
                if (planP && planP.length) {
                    for (const p of planP) {
                        const fu = ctas.find(c => c.id === p.cueIdCuenta);
                        fu.disp = r2(fu.disp - p.importeCta);
                    }
                    partes = planP;
                }
            }
            if (!elegida && !partes) { sinCubrir.push(`${codigo} (${monOrden === 2 ? 'US$' : '$'} ${importe.toFixed(2)}: no alcanza ni repartiendo entre tus billeteras)`); continue; }
            if (elegida) elegida.disp = r2(elegida.disp - importeCta);
            plan.push(elegida
                ? { ordId: f.OrdIdOrden, movId: f.MovIdMovimiento, codigo, importe,
                    moneda: monOrden === 2 ? 'USD' : 'UYU', cueIdCuenta: elegida.id, cuenta: elegida.nombre,
                    monedaCuenta: elegida.mon === 2 ? 'USD' : 'UYU', importeCta, cruzada, partes: null }
                : { ordId: f.OrdIdOrden, movId: f.MovIdMovimiento, codigo, importe,
                    moneda: monOrden === 2 ? 'USD' : 'UYU', cueIdCuenta: partes[0].cueIdCuenta,
                    cuenta: partes.map(p => p.cuenta).join(' + '), monedaCuenta: monOrden === 2 ? 'USD' : 'UYU',
                    importeCta: importe, cruzada: false, partes });
        }
        if (sinCubrir.length) {
            const disp = ctas.map(c => `${c.nombre}: ${c.mon === 2 ? 'US$' : '$'} ${c.disp.toFixed(2)}`).join(' · ') || 'sin saldo en la billetera';
            return res.status(400).json({ error: `Tu billetera no puede cubrir: ${sinCubrir.join('; ')}. Disponible: ${disp}. Recargá la billetera o pagá con tarjeta.` });
        }
        if (!plan.length && !yaCubiertas.length) return res.status(400).json({ error: 'No hay pedidos para cubrir.' });

        if (preview) return res.json({ success: true, preview: true, plan, yaCubiertas, cotizacion: cot });

        // 4) Cubrir cada orden con el motor de administración (consumo + marca + deuda + asiento)
        const ctrlConta = require('./contabilidadController');
        const cubiertas = [];
        for (const p of plan) {
            // Repartida entre billeteras → consumos en partes (transaccional, todo-o-nada);
            // una sola cuenta → el motor de siempre.
            const out = p.partes
                ? await ctrlConta.consumirOrdenDesdeSaldoEnPartes({ movId: p.movId, partes: p.partes, cot, UsuarioAlta: 999 })
                : await new Promise((resolve) => {
                    const fakeRes = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, ...o }); } };
                    ctrlConta.consumirDesdeSaldo({ params: { MovIdMovimiento: String(p.movId) },
                        body: { CueIdCuenta: p.cueIdCuenta }, query: {}, user: { id: 999 } }, fakeRes);
                });
            if (out.code >= 400 || out.success === false) {
                const hechas = cubiertas.map(c => c.codigo).join(', ');
                logger.error(`[BILLETERA PORTAL] Cubrir con billetera: falló ${p.codigo} (${out.error}). Cubiertas antes de fallar: ${hechas || 'ninguna'}.`);
                return res.status(500).json({ error: `${p.codigo} no se pudo cubrir: ${out.error || 'error interno'}.${hechas ? ` Estas SÍ quedaron cubiertas: ${hechas} — volvé a intentar para terminar y crear el retiro.` : ''}` });
            }
            cubiertas.push(p);
            logger.info(`[BILLETERA PORTAL] 🔋 ${p.codigo} cubierta con "${p.cuenta}" (−${p.monedaCuenta === 'USD' ? 'US$' : '$'} ${p.importeCta.toFixed(2)}${p.cruzada ? ` @ ${cot}` : ''}) por el portal.`);
        }

        // 5) Crear el retiro: nace Abonado porque todas las órdenes están cubiertas
        const { crearRetiro } = require('../services/retiroService');
        const retiroTransaction = new sql.Transaction(pool);
        await retiroTransaction.begin();
        let OReIdOrdenRetiro;
        try {
            OReIdOrdenRetiro = await crearRetiro(retiroTransaction, {
                ordIds:       ordIds,
                // Total del RETIRO = valor de las órdenes (no solo lo consumido ahora:
                // con órdenes ya cubiertas el plan puede ser menor y el retiro quedaba en 0)
                totalCost:    r2(filas.reduce((s, f) => s + (parseFloat(f.OrdCostoFinal) || 0), 0)),
                lugarRetiro:  lugarRetiro || 1,
                usuarioAlta:  70,
                formaRetiro:  'RW',
                codCliente:   codCliente,
                moneda:       (filas[0] && Number(filas[0].MonIdMoneda) === 2) ? 'USD' : 'UYU',
                direccion:    direccion || null,
                departamento: departamento || null,
                localidad:    localidad || null,
                agenciaId:    agenciaId || null,
            });
            await retiroTransaction.commit();
        } catch (eRet) {
            await retiroTransaction.rollback().catch(() => {});
            logger.error(`[BILLETERA PORTAL] Órdenes cubiertas pero el retiro no se creó: ${eRet.message}. El cliente puede reintentar (las cubiertas se saltean).`);
            return res.status(500).json({ error: `Tus pedidos quedaron cubiertos con la billetera, pero el retiro no se pudo crear: ${eRet.message}. Volvé a intentar.` });
        }
        if (customAgencia) await pool.request().input('OReId', sql.Int, OReIdOrdenRetiro).input('A', sql.NVarChar(200), customAgencia)
            .query('UPDATE OrdenesRetiro SET AgenciaOtra = @A WHERE OReIdOrdenRetiro = @OReId');
        if (receptorNombre) await pool.request().input('OReId', sql.Int, OReIdOrdenRetiro).input('R', sql.NVarChar(200), receptorNombre)
            .query('UPDATE OrdenesRetiro SET ReceptorNombre = @R WHERE OReIdOrdenRetiro = @OReId');

        const io5 = req?.app?.get ? req.app.get('socketio') : null;
        if (io5) io5.emit('actualizado', { type: 'actualizacion' });
        logger.info(`[BILLETERA PORTAL] 🔋 Retiro RW-${OReIdOrdenRetiro} creado con ${plan.length} orden(es) cubiertas por billetera${yaCubiertas.length ? ` (+${yaCubiertas.length} ya cubiertas)` : ''}.`);
        return res.json({ success: true, retiro: `RW-${OReIdOrdenRetiro}`, OReIdOrdenRetiro, plan, yaCubiertas });
    } catch (err) {
        logger.error('[BILLETERA PORTAL] cubrir-con-billetera:', err.message);
        res.status(500).json({ error: 'No se pudo cubrir con la billetera.' });
    }
};

// POST /web-orders/pickup-orders/pagar-con-saldo — el cliente paga su retiro con el
// saldo de su cuenta (sin pasarela): crea el retiro (flujo diferido, igual que el
// webhook de Handy) y registra el cobro por el motor de caja con el medio "Saldo de
// cuenta", que debita la cuenta. En el portal NO se admite quedar en negativo.
exports.pagarConSaldoBilletera = async (req, res) => {
    try {
        const pool = await getPool();
        const { orders, totalAmount, activeCurrency, lugarRetiro, direccion, departamento,
                localidad, agenciaId, customAgencia, receptorNombre, cueIdCuenta, preview } = req.body;
        const codCliente = req.user?.codCliente;
        if (!codCliente) return res.status(401).json({ error: 'Sesión inválida.' });
        if (!(await _billeteraPortalHabilitada(pool, codCliente))) return res.status(403).json({ error: MSG_BILLETERA_PORTAL_OFF });
        if (!orders?.length) return res.status(400).json({ error: 'No hay órdenes para pagar.' });
        const total = Math.round(Number(totalAmount) * 100) / 100;
        if (!(total > 0)) return res.status(400).json({ error: 'Importe inválido.' });
        const moneda = activeCurrency === 'USD' ? 'USD' : 'UYU';

        const cli = (await pool.request().input('Cod', sql.Int, codCliente)
            .query('SELECT CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CodCliente = @Cod')).recordset[0];
        if (!cli) return res.status(400).json({ error: 'Cliente no encontrado.' });

        // ── Asignación automática sobre las cuentas de la billetera ─────────────
        // Elegibles: anticipo-libres activas con saldo (sin principal/restringida/prepago,
        // NUNCA en negativo). Prioridad: misma moneda del retiro (mayor saldo primero),
        // después la otra moneda convertida a la COTIZACIÓN DEL DÍA (el cliente no elige
        // TC). En cross, los centavos se redondean HACIA ARRIBA (los cubre el cliente y
        // el detalle se le muestra antes de confirmar).
        const r2 = (n) => Math.round(n * 100) / 100;
        const cot = parseFloat((await pool.request()
            .query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC')).recordset[0]?.CotDolar) || 40;
        let elegibles = (await pool.request().input('Cli', sql.Int, cli.CliIdCliente).query(`
            SELECT cc.CueIdCuenta, cc.CueNombre, cc.CueTipo,
                   ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                           WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                             AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo
            FROM dbo.CuentasCliente cc WITH(NOLOCK)
            WHERE cc.CliIdCliente = @Cli AND cc.CueActiva = 1 AND cc.CueTipo LIKE 'DINERO%'
              AND cc.CueEsPrincipal = 0 AND cc.CueRestringida = 0
              AND ISNULL(cc.CueModalidadFiscal,'ANTICIPO_A_FACTURAR') <> 'PREPAGO_FACTURADO'`)).recordset
            .map(c => ({ CueIdCuenta: c.CueIdCuenta, nombre: c.CueNombre || `Cuenta #${c.CueIdCuenta}`,
                         moneda: c.CueTipo === 'DINERO_USD' ? 'USD' : 'UYU', saldo: r2(Number(c.Saldo)) }))
            .filter(c => c.saldo > 0.009);
        // Compatibilidad: si el llamador fija una cuenta, la asignación usa SOLO esa
        if (cueIdCuenta) elegibles = elegibles.filter(c => c.CueIdCuenta === parseInt(cueIdCuenta));
        elegibles.sort((a, b) => (a.moneda === moneda ? 0 : 1) - (b.moneda === moneda ? 0 : 1) || b.saldo - a.saldo);

        let falta = total;
        const plan = [];
        for (const c of elegibles) {
            if (falta <= 0.009) break;
            let montoCta;
            if (c.moneda === moneda) {
                montoCta = Math.min(c.saldo, r2(falta));
            } else {
                const necesario = c.moneda === 'USD' ? falta / cot : falta * cot;
                montoCta = Math.min(c.saldo, Math.ceil(necesario * 100) / 100);
            }
            if (montoCta <= 0.009) continue;
            const aporte = c.moneda === moneda ? montoCta : (c.moneda === 'USD' ? r2(montoCta * cot) : r2(montoCta / cot));
            plan.push({ cueIdCuenta: c.CueIdCuenta, nombre: c.nombre, moneda: c.moneda, monto: montoCta, aporte, cruzada: c.moneda !== moneda });
            falta = r2(falta - aporte);
        }
        if (falta > 0.009) {
            const disp = elegibles.map(c => `${c.nombre}: ${c.moneda === 'USD' ? 'US$' : '$'} ${c.saldo.toFixed(2)}`).join(' · ') || 'sin cuentas con saldo';
            return res.status(400).json({ error: `El saldo de tu billetera no alcanza: faltan ${moneda === 'USD' ? 'US$' : '$'} ${falta.toFixed(2)} (${disp}).` });
        }

        // Vista previa: devolver el plan sin tocar nada (el portal lo muestra antes de confirmar)
        if (preview) return res.json({ success: true, preview: true, plan, cotizacion: cot, total, moneda });

        const metodoSaldo = (await pool.request()
            .query(`SELECT TOP 1 MPaIdMetodoPago FROM dbo.MetodosPagos WHERE MPaDescripcionMetodo = 'Saldo de cuenta'`)).recordset[0]?.MPaIdMetodoPago;
        if (!metodoSaldo) return res.status(500).json({ error: 'Falta el medio de pago "Saldo de cuenta" (configuración).' });

        // 1. Crear el retiro (mismos parámetros que el flujo diferido de Handy)
        const { crearRetiro } = require('../services/retiroService');
        const retiroTransaction = new sql.Transaction(pool);
        await retiroTransaction.begin();
        let OReIdOrdenRetiro;
        try {
            OReIdOrdenRetiro = await crearRetiro(retiroTransaction, {
                ordIds:       orders.map(o => o.OrdIdOrden).filter(Boolean),
                totalCost:    total,
                lugarRetiro:  lugarRetiro || 1,
                usuarioAlta:  70,
                formaRetiro:  'RW',
                codCliente:   codCliente,
                moneda,
                direccion:    direccion || null,
                departamento: departamento || null,
                localidad:    localidad || null,
                agenciaId:    agenciaId || null,
            });
            await retiroTransaction.commit();
        } catch (eRet) {
            await retiroTransaction.rollback().catch(() => {});
            throw eRet;
        }
        if (customAgencia) await pool.request().input('OReId', sql.Int, OReIdOrdenRetiro).input('A', sql.NVarChar(200), customAgencia)
            .query('UPDATE OrdenesRetiro SET AgenciaOtra = @A WHERE OReIdOrdenRetiro = @OReId');
        if (receptorNombre) await pool.request().input('OReId', sql.Int, OReIdOrdenRetiro).input('R', sql.NVarChar(200), receptorNombre)
            .query('UPDATE OrdenesRetiro SET ReceptorNombre = @R WHERE OReIdOrdenRetiro = @OReId');

        // 2. Cobro por el motor de caja (Caja Administrativa online) con "Saldo de cuenta":
        //    el motor valida de nuevo la cuenta y registra el débito atado al pago.
        const { procesarTransaccion } = require('../services/cajaService');
        const nombresUsados = plan.map(p => `${p.nombre} (${p.moneda === 'USD' ? 'US$' : '$'} ${p.monto.toFixed(2)}${p.cruzada ? ` @ ${cot}` : ''})`).join(' + ');
        const result = await procesarTransaccion({
            usuarioId: 999,
            header: {
                clienteId:        cli.CliIdCliente,
                esAdministrativa: true,
                tipoDocumento:    '07',   // E-Ticket Contado
                moneda,
                cotizacion:       cot,
                observaciones:    `Pago con saldo de billetera (portal) — ${nombresUsados}`.slice(0, 480),
            },
            aplicaciones: [{
                tipo:          'ORDEN_RETIRO',
                referenciaId:  OReIdOrdenRetiro,
                montoOriginal: total,
                descripcion:   `Retiro RW-${OReIdOrdenRetiro}`,
            }],
            // Una línea de pago por cuenta usada, cada una EN LA MONEDA DE SU CUENTA
            // (el débito PAGO_SALDO valida moneda línea = moneda cuenta); cross lleva
            // la cotización del día para las conversiones del motor.
            pagos: plan.map(p => ({
                metodoPagoId: metodoSaldo,
                monedaId: p.moneda === 'USD' ? 2 : 1,
                moneda: p.moneda,
                montoOriginal: p.monto,
                cotizacion: p.cruzada ? cot : 1,
                cueIdCuenta: p.cueIdCuenta,
            })),
        });

        logger.info(`[BILLETERA PORTAL] Cliente ${cli.CliIdCliente} pagó RW-${OReIdOrdenRetiro} (${moneda} ${total}) con ${nombresUsados}.`);
        // Notificar impresión como el pago online
        const ioInst = req.app?.get('socketio');
        if (ioInst) ioInst.emit('actualizado', { type: 'actualizacion' });
        res.json({ success: true, retiro: `RW-${OReIdOrdenRetiro}`, plan, cotizacion: cot, cuenta: plan.map(p => p.nombre).join(' + ') });
    } catch (err) {
        logger.error('[BILLETERA PORTAL] pagar-con-saldo:', err.message);
        res.status(500).json({ error: err.message || 'No se pudo pagar con el saldo.' });
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

// Ticket interno a Finanzas (DepId 2) para anomalías de cobros online.
// Best-effort: nunca corta el flujo que lo invoca.
const crearTicketFinanzas = async (pool, codCliente, asunto, texto) => {
    try {
        const tRes = await pool.request()
            .input('CliId', sql.Int, codCliente || null)
            .input('Asunto', sql.NVarChar(200), asunto.substring(0, 200))
            .query(`
                INSERT INTO Tickets (CliIdCliente, UsrIdCreador, DepIdDepartamento, TicAsunto, TicPrioridad, TicEstado, TicFechaAlta, TicFechaActualizacion)
                OUTPUT INSERTED.TicIdTicket
                VALUES (@CliId, 70, 2, @Asunto, 1, 1, GETDATE(), GETDATE())
            `);
        await pool.request()
            .input('TicId', sql.Int, tRes.recordset[0].TicIdTicket)
            .input('Txt', sql.NVarChar(sql.MAX), texto)
            .query(`
                INSERT INTO Tickets_Mensajes (TicIdTicket, UsrIdAutor, TMenEsNotaInterna, TMenTexto, TMenFecha)
                VALUES (@TicId, 70, 1, @Txt, GETDATE())
            `);
        logger.info(`[HANDY ALERTA] Ticket a Finanzas creado: ${asunto}`);
    } catch (e) {
        logger.error('[HANDY ALERTA] No se pudo crear el ticket de alerta:', e.message);
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
        // Retiro sobre el que se está registrando el cobro: si el registro falla,
        // el ticket de alerta a Finanzas lo referencia para ubicar el caso.
        let retiroEnCurso = null;

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

                    // [TIENDA 21/08] Pago de una compra de la tienda con RETIRO EN EL LOCAL
                    // (paga-primero): la venta no existía todavía — se crea acá, ya pagada.
                    // No sigue el flujo de retiros de más abajo.
                    if (storedData.type === 'tienda-checkout') {
                        try {
                            const tiendaCtrl = require('./tiendaController');
                            if (storedData.ventaCreada) {
                                logger.info(`[HANDY WEBHOOK] Venta de tienda ya creada (${storedData.ventaCreada}) — webhook repetido, sin acción.`);
                            } else {
                                const venta = await tiendaCtrl.crearVentaTiendaPagada(pool, storedData, {
                                    ref: transactionId, metodo: 'HANDY', io: req.app?.get('socketio')
                                });
                                // Idempotencia ante reintentos del webhook: se persiste el código creado.
                                await pool.request()
                                    .input('txId4', sql.VarChar(100), transactionId)
                                    .input('json4', sql.NVarChar(sql.MAX), JSON.stringify({ ...storedData, ventaCreada: venta.codigoVenta }))
                                    .query('UPDATE HandyTransactions SET OrdersJson = @json4 WHERE TransactionId = @txId4');
                            }
                        } catch (eTienda) {
                            logger.error('[HANDY WEBHOOK] Error procesando pago de tienda: ' + eTienda.message);
                            return; // la respuesta 200 ya salió al principio del webhook
                        }
                        return; // pago de tienda procesado — no seguir con el flujo de retiros
                    }

                    // ── RECARGA DE BILLETERA (portal): acreditar la cuenta y terminar ──
                    if (storedData.type === 'wallet-topup') {
                        try {
                            await _acreditarRecargaBilletera(pool, {
                                storedData, codCliente: tx.CodCliente, txId: transactionId,
                                metodoPagoId: 9, monedaId: tx.Currency === 840 ? 2 : 1, monto: tx.TotalAmount, req,
                            });
                        } catch (eTopup) {
                            logger.error(`[HANDY WEBHOOK] Recarga de billetera falló (Tx ${transactionId}): ${eTopup.message}`);
                        }
                        // La respuesta 200 ya salió al inicio del webhook: return pelado
                        // (responder de nuevo acá tiraba ERR_HTTP_HEADERS_SENT).
                        return;
                    }

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
                        let retiroTransaction = null;
                        try {
                            logger.info('[HANDY WEBHOOK] Creando retiro diferido...');
                            const { crearRetiro } = require('../services/retiroService');
                            retiroTransaction = new sql.Transaction(pool);
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
                            await crearTicketFinanzas(pool, tx.CodCliente,
                                `ALERTA: pago Handy cobrado SIN retiro creado (Tx ${transactionId})`,
                                `Handy capturó ${tx.TotalAmount} (${tx.Currency === 840 ? 'USD' : 'UYU'}) del cliente ${tx.CodCliente} pero falló la creación del retiro diferido:\n${retiroErr.message}\n\nTransactionId: ${transactionId}\nÓrdenes: ${(storedData.ordIds || []).join(', ')}\n\nEl cliente YA pagó con tarjeta. NO cobrar estas órdenes de nuevo: crear el retiro y registrar el pago a mano, o devolver la transacción en Handy.`);
                            return; // la respuesta 200 ya salió al inicio del webhook
                        }
                    }

                    // --- FLUJO DE PAGO UNIFICADO (igual que Caja) ---
                    const ordenRetiroId = parseInt(String(payloadPago.ordenRetiro).replace(/^[A-Za-z]+-0*/, ''), 10);
                    if (!isNaN(ordenRetiroId)) {
                        retiroEnCurso = ordenRetiroId;
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
                                // ¿Reintento del mismo webhook o un SEGUNDO cobro real (el
                                // cliente pagó dos links distintos)? El pago existente guarda
                                // su TransactionId en las observaciones de la transacción de
                                // caja: si es OTRO id, la tarjeta se cobró dos veces.
                                let esOtroCobro = false;
                                try {
                                    const obsRes = await pool.request()
                                        .input('PagObs', sql.Int, existingPagId)
                                        .query(`
                                            SELECT TC.TcaObservaciones
                                            FROM Pagos P WITH(NOLOCK)
                                            JOIN TransaccionesCaja TC WITH(NOLOCK) ON TC.TcaIdTransaccion = P.PagTcaIdTransaccion
                                            WHERE P.PagIdPago = @PagObs
                                        `);
                                    const obs = obsRes.recordset[0]?.TcaObservaciones || '';
                                    esOtroCobro = obs.includes('Tx:') && !obs.includes(transactionId);
                                } catch (eObs) { /* sin dato → se trata como webhook duplicado */ }

                                if (esOtroCobro) {
                                    await crearTicketFinanzas(pool, tx.CodCliente,
                                        `ALERTA: posible DOBLE COBRO Handy en retiro RW-${ordenRetiroId}`,
                                        `El retiro RW-${ordenRetiroId} ya estaba pagado con Handy (PagIdPago ${existingPagId}) y llegó OTRO pago exitoso por un link distinto.\n\nTransacción nueva: ${transactionId}\nMonto: ${tx.TotalAmount} (${tx.Currency === 840 ? 'USD' : 'UYU'})\nCliente: ${tx.CodCliente}\n\nEl cliente pagó dos veces con tarjeta: corresponde DEVOLVER esta transacción en el panel de Handy.`);
                                }
                                logger.info(`[HANDY WEBHOOK] La orden de retiro ${ordenRetiroId} ya tiene un pago Handy asignado (PagIdPago: ${existingPagId}). ${esOtroCobro ? 'SEGUNDO COBRO detectado — ticket a Finanzas creado.' : 'Ignorando webhook duplicado de pago exitoso.'}`);
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
                        // Retry con backoff para resistir deadlocks con operaciones concurrentes.
                        const { procesarTransaccion } = require('../services/cajaService');
                        const MAX_RETRIES = 3;
                        let result = null;
                        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                            try {
                                result = await procesarTransaccion({
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
                                break; // Éxito → salir del loop
                            } catch (retryErr) {
                                const isDeadlock = retryErr.number === 1205 || (retryErr.message && retryErr.message.includes('deadlock'));
                                if (isDeadlock && attempt < MAX_RETRIES) {
                                    const waitMs = attempt * 2000; // 2s, 4s
                                    logger.warn(`[HANDY WEBHOOK] ⚠️ Deadlock en intento ${attempt}/${MAX_RETRIES}. Reintentando en ${waitMs}ms...`);
                                    await new Promise(r => setTimeout(r, waitMs));
                                } else {
                                    throw retryErr; // No es deadlock o se agotaron reintentos
                                }
                            }
                        }

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
                // La tarjeta YA se cobró pero el registro interno falló: sin esta
                // alerta el retiro figura impago y caja lo vuelve a cobrar al
                // entregar (doble cobro real, o factura del ciclo si es cta. cte.).
                await crearTicketFinanzas(pool, null,
                    `ALERTA: pago Handy cobrado SIN registrar (Tx ${transactionId})`,
                    `Handy capturó ${totalAmount} (${currency === 840 ? 'USD' : 'UYU'}) pero el registro del pago falló:\n${reactErr.message}\n\nTransactionId: ${transactionId}${retiroEnCurso ? `\nRetiro: RW-${retiroEnCurso}` : ''}\n\nEl cliente YA pagó con tarjeta. NO volver a cobrar este retiro en caja: registrar el pago a mano o devolver la transacción en el panel de Handy.`);
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
                paidAt: tx.PaidAt,
                // [TIENDA 21/08] Para que la página de estado limpie el carrito y muestre el VEN creado
                tienda: String(storedData.type || '').startsWith('tienda'),
                codigoVenta: storedData.ventaCreada || storedData.codigoVenta || null
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

    // Contexto para el ticket de alerta si el registro falla con el cobro ya
    // capturado (se setean recién cuando el pago está aprobado y por registrarse).
    let mpTxRef = null, mpRetiroEnCurso = null, mpCodCliente = null, mpMonto = null;

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

        // ── RECARGA DE BILLETERA (portal): acreditar la cuenta y terminar ──
        if (storedData.type === 'wallet-topup') {
            try {
                await _acreditarRecargaBilletera(pool, {
                    storedData, codCliente: tx.CodCliente, txId: String(externalRef),
                    metodoPagoId: 10, monedaId: (paymentData.currency_id === 'USD') ? 2 : 1,
                    monto: paymentData.transaction_amount, req,
                });
            } catch (eTopup) {
                logger.error(`[MP WEBHOOK] Recarga de billetera falló (Tx ${externalRef}): ${eTopup.message}`);
            }
            return;
        }

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
                await crearTicketFinanzas(pool, tx.CodCliente,
                    `ALERTA: pago MercadoPago cobrado SIN retiro creado (Tx ${externalRef})`,
                    `MercadoPago aprobó el pago del cliente ${tx.CodCliente} pero falló la creación del retiro diferido:\n${retiroErr.message}\n\nTransactionId: ${externalRef}\nÓrdenes: ${(storedData.ordIds || []).join(', ')}\n\nEl cliente YA pagó. NO cobrar estas órdenes de nuevo: crear el retiro y registrar el pago a mano, o devolver el pago en MercadoPago.`);
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
            // ¿Reintento del mismo pago o un SEGUNDO cobro real por otra vía/link?
            const pagExistenteMp = retiroState.recordset[0].PagIdPago;
            let esOtroCobroMp = false;
            try {
                const obsRes = await pool.request()
                    .input('PagObs', sql.Int, pagExistenteMp)
                    .query(`
                        SELECT TC.TcaObservaciones
                        FROM Pagos P WITH(NOLOCK)
                        JOIN TransaccionesCaja TC WITH(NOLOCK) ON TC.TcaIdTransaccion = P.PagTcaIdTransaccion
                        WHERE P.PagIdPago = @PagObs
                    `);
                const obs = obsRes.recordset[0]?.TcaObservaciones || '';
                esOtroCobroMp = obs.includes('Tx:') && !obs.includes(externalRef);
            } catch (eObs) { /* sin dato → se trata como duplicado */ }
            if (esOtroCobroMp) {
                await crearTicketFinanzas(pool, tx.CodCliente,
                    `ALERTA: posible DOBLE COBRO MercadoPago en retiro RW-${ordenRetiroId}`,
                    `El retiro RW-${ordenRetiroId} ya estaba pagado (PagIdPago ${pagExistenteMp}, de otra transacción) y llegó OTRO pago aprobado de MercadoPago.\n\nTransacción nueva: ${externalRef}\nCliente: ${tx.CodCliente}\n\nEl cliente pagó dos veces: corresponde DEVOLVER este pago en MercadoPago.`);
            }
            logger.warn(`[MP WEBHOOK] Retiro ${ordenRetiroId} ya pagado. ${esOtroCobroMp ? 'SEGUNDO COBRO detectado — ticket a Finanzas creado.' : 'Ignorando duplicado.'}`);
            return;
        }
        mpTxRef = externalRef;
        mpRetiroEnCurso = ordenRetiroId;
        mpCodCliente = tx.CodCliente;

        const usuarioId = 70;
        const moneda    = paymentData.currency_id === 'USD' ? 'USD' : 'UYU';
        const monedaId  = moneda === 'USD' ? 2 : 1;

        // Resolver CliIdCliente
        const cliRes2 = await pool.request()
            .input('CodCli', sql.Int, tx.CodCliente)
            .query('SELECT CliIdCliente FROM Clientes WITH(NOLOCK) WHERE CodCliente = @CodCli');
        const CliIdCliente = cliRes2.recordset[0]?.CliIdCliente;

        // ── Pago unificado a través de cajaService (Caja Administrativa online) ──
        mpMonto = totalAmountPaid;
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
        // mpTxRef solo se setea con el pago aprobado y a punto de registrarse:
        // si llegamos acá con él seteado, hay plata cobrada sin registrar.
        if (mpTxRef) {
            try {
                const poolAlerta = await getPool();
                await crearTicketFinanzas(poolAlerta, mpCodCliente,
                    `ALERTA: pago MercadoPago cobrado SIN registrar (Tx ${mpTxRef})`,
                    `MercadoPago aprobó el cobro${mpMonto ? ` de ${mpMonto}` : ''} pero el registro del pago falló:\n${e.message}\n\nTransactionId: ${mpTxRef}${mpRetiroEnCurso ? `\nRetiro: RW-${mpRetiroEnCurso}` : ''}\n\nEl cliente YA pagó. NO volver a cobrar este retiro en caja: registrar el pago a mano o devolver el pago en MercadoPago.`);
            } catch (e2) {
                logger.error('[MP WEBHOOK] No se pudo crear ticket de alerta:', e2.message);
            }
        }
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
