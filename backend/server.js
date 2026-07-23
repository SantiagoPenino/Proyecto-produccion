const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const logger = require('./utils/logger');
const express = require('express');
logger.info('--- SERVER RESTARTED V32 (NAMING: ARCHIVO X DE Y) AT ' + new Date().toISOString() + ' ---');
const SERVER_START_TIME = Date.now(); // Timestamp único de este arranque — usado para forzar reload en clientes
const cors = require('cors');

logger.info("---------------------------------------------------------");
logger.info("🔑 [SERVER STARTUP] Verificando Variables de Entorno:");
logger.info("   PORT:", process.env.PORT);
logger.info("   GEMINI_KEY:", process.env.GEMINI_API_KEY ? "Cargada ✅ (" + process.env.GEMINI_API_KEY.substring(0, 5) + "...)" : "❌ NO DETECTADA");
logger.info("---------------------------------------------------------");

// --- IMPORTACIÓN DEL SCHEDULER ---
const { startAutoSync } = require('./scheduler'); // Asegúrate de crear este archivo

const app = express();
app.set('trust proxy', 1); // Necesario para funcionar detrás de Nginx (proxy reverso)

// --- REDIRECCIÓN DE DOMINIO (user.uy -> user.com.uy) ---
app.use((req, res, next) => {
    if (req.hostname === 'user.uy' || req.hostname === 'www.user.uy') {
        // Redirige preservando la ruta (ej: /portal/pickup) y el código 301 (Permanente)
        return res.redirect(301, 'https://user.com.uy' + req.originalUrl);
    }
    next();
});

// --- MIDDLEWARES DE SEGURIDAD ---
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for simplicity in this dev environment to allow iframe and inline scripts for QR
    frameguard: false, // Allow framing
    hsts: false // Disable HSTS to prevent Chrome from forcing HTTPS on localhost
}));

const WHITELISTED_IPS = (process.env.RATE_LIMIT_WHITELIST || '').split(',').map(ip => ip.trim()).filter(Boolean);

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Demasiadas peticiones desde esta IP, por favor intente nuevamente en 15 minutos.",
    skip: (req) => {
        const clientIp = (req.ip || '').replace(/^::ffff:/, '');
        return WHITELISTED_IPS.includes(clientIp);
    }
});
app.use('/api', limiter);

app.use(cors());
app.use(express.json({ limit: '200mb' }));

// 🔍 REQUEST LOGGER: Loguea cada HTTP request
const requestLogger = require('./middleware/requestLogger');
app.use(requestLogger);

// --- STATIC FILES ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Thumbnails generados localmente de PDFs/archivos de pedidos.
// Ruta en disco configurable por THUMBNAILS_PATH (debe coincidir con thumbnailGenerator.js).
app.use('/thumbnails', express.static(process.env.THUMBNAILS_PATH || path.join(__dirname, 'thumbnails')));
// Imágenes de fallas anotadas (recuadro dibujado en Control). Configurable por FALLAS_PATH.
app.use('/fallas', express.static(process.env.FALLAS_PATH || path.join(__dirname, 'fallas')));
// Comprobantes de entrega de encomiendas (logística transporte)
const encomiendasFolder = process.env.COMPROBANTES_ENCOMIENDAS_PATH || path.join(__dirname, 'comprobantesEncomiendas');
app.use('/comprobantesEncomiendas', express.static(encomiendasFolder));

// --- REGISTRO DE RUTAS ---
app.use('/api/areas', require('./routes/areasRoutes'));
app.use('/api/orders', require('./routes/ordersRoutes'));
app.use('/api/stock', require('./routes/stockRoutes'));
app.use('/api/failures', require('./routes/failuresRoutes'));
app.use('/api/clients', require('./routes/clientsRoutes'));
app.use('/api/workflows', require('./routes/workflowsRoutes'));
app.use('/api/logistics', require('./routes/logisticsRoutes'));
app.use('/api/canastos', require('./routes/canastosRoutes'));
app.use('/api/rolls', require('./routes/rollsRoutes'));
app.use('/api/rest-sync', require('./routes/restSyncRoutes'));
app.use('/api/measurements', require('./routes/measurementRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/menu', require('./routes/menuRoutes'));
app.use('/api/roles', require('./routes/rolesRoutes'));
app.use('/api/users', require('./routes/usersRoutes'));
app.use('/api/audit', require('./routes/auditRoutes'));
app.use('/api/audit-deposito', require('./routes/auditDepositoRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/reportes',              require('./routes/reportesRoutes'));
app.use('/api/google', require('./routes/googleAuthRoutes'));


const webAuthRoutes = require('./routes/webAuthRoutes');
const webOrdersRoutes = require('./routes/webOrdersRoutes'); // Nueva ruta Pedidos Web
const webRetirosRoutes = require('./routes/webRetirosRoutes');
const nomenclatorsRoutes = require('./routes/nomenclatorsRoutes');

app.use('/api/web-auth', webAuthRoutes); // RUTAS AUTH CLIENTE WEB
app.use('/api/web-designer', require('./routes/webDesignerRoutes')); // DISEÑADORES (suben pedidos en nombre de clientes)
app.use('/api/web-orders', webOrdersRoutes); // RUTAS PEDIDOS CLIENTE WEB (DTF, Etc)
app.use('/api/prendas-orders', require('./routes/prendasOrdersRoutes')); // ALTA INTERNA PRENDAS / PRODUCTOS TERMINADOS (fork aislado, no afecta a web-orders)
app.use('/api/web-retiros', webRetirosRoutes);
app.use('/api/web-content', require('./routes/webContentRoutes')); // RUTAS CONTENIDO WEB (Sidebar/Popup)
app.use('/api/tickets', require('./routes/ticketsRoutes'));        // MÓDULO HELPDESK TICKETING
app.use('/api/push', require('./routes/pushRoutes'));              // PUSH NOTIFICATIONS
app.use('/api/nomenclators', nomenclatorsRoutes);
app.use('/api/routes-config', require('./routes/routesConfigRoutes'));
app.use('/api/delivery-times', require('./routes/deliveryTimesRoutes'));
app.get('/api/debug/reprocess/:id', require('./controllers/debugController').reprocessOrder);
app.use('/api/insumos', require('./routes/insumosRoutes'));
app.use('/api/reception', require('./routes/receptionRoutes'));
app.use('/api/tela-cliente', require('./routes/telaClienteRoutes')); // Módulo Tela de Cliente
app.use('/api/inventory', require('./routes/inventoryRoutes'));
app.use('/api/configuraciones', require('./routes/configuracionesRoutes'));
app.use('/api/empresas', require('./routes/empresasRoutes'));         // MÓDULO MULTIEMPRESA (emisor de factura)
app.use('/api/sincro', require('./routes/sincroRoutes'));
app.use('/api/stockart', require('./routes/stockArtRoutes'));         // EDITOR StockArt (SysAdmin)
app.use('/api/quotation', require('./routes/quotationRoutes'));
app.use('/api/sisnet', require('./routes/sisnetRoutes'));

try {
    app.use('/api/contabilidad', require('./routes/contabilidadRoutes'));
    app.use('/api/tesoreria', require('./routes/tesoreriaRoutes'));
    logger.info('✅ [MÓDULO] Contabilidad de Clientes activado en /api/contabilidad');
} catch (e) { logger.error('❌ Error loading contabilidad routes:', e.message); }

// --- RUTAS INTEGRADAS DEL SISTEMA REACT ---
app.use('/api/apicotizaciones', require('./routes/getwayCotizaciones'));
app.use('/api/apilugaresRetiro', require('./routes/getwayLugaresRetiro'));
app.use('/api/apiordenes', require('./routes/getwayOrdenes'));
app.use('/api/apiordenesRetiro', require('./routes/getwayOrdenesRetiro'));
app.use('/api/apipagos', require('./routes/getwayPagos'));
app.use('/api/sysadmin', require('./routes/sysadminRoutes'));

// Frontend error reporting (no auth, #14)
app.post('/api/client-error', require('./controllers/sysadminController').reportClientError);

// HEALTH CHECK (lightweight, no auth)
app.get('/api/health', async (req, res) => {
    try {
        const { getPool } = require('./config/db');
        const pool = await getPool();
        await pool.request().query('SELECT 1');
        res.json({ status: 'ok' });
    } catch {
        res.status(500).json({ status: 'error' });
    }
});

// SECCIÓN DE PRODUCCIÓN
app.use('/api/production-kanban', require('./routes/productionKanbanRoutes'));
app.use('/api/production-file-control', require('./routes/productionFileRoutes'));
app.use('/api/production', require('./routes/productionRoutes'));
app.use('/api/machine-control', require('./routes/machineControlRoutes')); // CONTROL PANEL INSUMOS
try {
    app.use('/api/finishing', require('./routes/ecoUvFinishingRoutes'));
} catch (e) { logger.error("❌ Error loading finishing routes:", e); }

try {
    app.use('/api/color', require('./routes/colorRoutes'));
    logger.info('✅ [MÓDULO] Igualador de Color activado en /api/color');
} catch (e) { logger.error('❌ Error loading color routes:', e.message); }

try {
    app.use('/api/products-integration', require('./routes/productsIntegrationRoutes'));
} catch (e) { logger.error("❌ Error loading product integration routes:", e); }

try {
    app.use('/api/integration-logs', require('./routes/integrationLogsRoutes'));
    app.use('/api/external', require('./routes/externalRoutes'));
} catch (e) { logger.error("❌ Error loading log routes:", e); }

try {
    app.use('/api/special-prices', require('./routes/specialPricesRoutes'));
} catch (e) { logger.error("❌ Error loading special prices routes:", e); }

try {
    app.use('/api/prices', require('./routes/pricesRoutes'));
} catch (e) { logger.error("❌ Error loading base prices routes:", e); }

try {
    app.use('/api/profiles', require('./routes/profilesRoutes'));
} catch (e) { logger.error("❌ Error loading profiles routes:", e); }

try {
    // Vista 360 del Vendedor (solo lectura)
    app.use('/api/vendedor-360', require('./routes/vendedorVistaRoutes'));
} catch (e) { logger.error("❌ Error loading vendedor 360 routes:", e); }

try {
    app.use('/api/reports', require('./routes/reportsRoutes'));
} catch (e) { logger.error("❌ Error loading reports routes:", e); }

try {
    app.use('/api/clients', require('./routes/clientsRoutes'));
} catch (e) { logger.error("❌ Error loading clients routes:", e); }

app.use('/api/chat', require('./routes/chatRoutes'));
// checkout routes deshabilitado por ahora

try {
    app.use('/api/analytics', require('./routes/analyticsRoutes'));
} catch (e) { logger.error("❌ Error loading analytics routes:", e.message); }

// INTEGRACIÓN WMS (Inventario Externo + Logística Pedidos)
try {
    app.use('/api/wms', require('./routes/wmsRoutes'));
    app.use('/api/wms-logistica', require('./routes/logisticaWmsRoutes'));
    logger.info('✅ [MÓDULO] Integración WMS activada en /api/wms y /api/wms-logistica');
} catch (e) { logger.error('❌ Error loading WMS routes:', e.message); }

// --- CRON: Sincronización de lista de precios desde Google Sheets ---
if (process.env.NODE_ENV !== 'test') {
    require('./cron/priceListSync');
}

// --- API: Lista de precios pública ---
app.get('/api/precios-publicos', async (req, res) => {
    try {
        const { getPool } = require('./config/db');
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT Familia, Producto, Descripcion, Moneda, Precio, FiltroLanding 
            FROM PreciosListaPublica 
            WHERE Activo = 1 
            ORDER BY Familia, Producto
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: Stats públicas para landing page ---
app.get('/api/stats/public', async (req, res) => {
    try {
        const { getPool } = require('./config/db');
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT
                (SELECT COUNT(*) FROM OrdenesDeposito WITH(NOLOCK)) AS totalOrdenes,
                (SELECT COUNT(*) FROM Clientes WITH(NOLOCK)) AS totalClientes
        `);
        res.json(result.recordset[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- API: Sync manual de precios (admin) ---
app.post('/api/admin/sync-precios', async (req, res) => {
    try {
        const { syncPriceList } = require('./cron/priceListSync');
        const result = await syncPriceList();
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // En producción, restringir al dominio real
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    },
    transports: ['websocket', 'polling'], // Forzar ambos transportes para compatibilidad
    allowEIO3: true // Compatibilidad con versiones anteriores de clientes si fuera necesario
});

app.set('socketio', io);

io.on('connection', (socket) => {
    // Informar a cada cliente qué timestamp tiene este arranque del servidor.
    // Si el cliente ya conocía otro timestamp → detecta restart y hace hard-reload.
    socket.emit('server:started', { startTime: SERVER_START_TIME });

    // Si hay un aviso de mantenimiento activo, mandárselo al recién conectado.
    // (El broadcast original es one-shot; esto cubre a quien abre la app DESPUÉS del aviso.)
    try {
        const maintenanceState = require('./utils/maintenanceState');
        const aviso = maintenanceState.getActive();
        if (aviso) socket.emit('server:maintenance', aviso);
    } catch (_) {}

    // --- HELPDESK ROOMS ---
    socket.on('join:helpdesk_admin', () => {
        socket.join('helpdesk:admin');
    });

    socket.on('leave:helpdesk_admin', () => {
        socket.leave('helpdesk:admin');
    });

    socket.on('join:ticket', ({ ticketId }) => {
        if (ticketId) socket.join(`ticket:${ticketId}`);
    });

    socket.on('leave:ticket', ({ ticketId }) => {
        if (ticketId) socket.leave(`ticket:${ticketId}`);
    });

    socket.on('error', (err) => {
        logger.error("[SOCKET] ERROR:", err);
    });
});

const PORT = process.env.PORT || 5000;

// FORCED RESTART TRIGGER: 2026-01-01 22:38

// --- RUTAS TEMPORALES: Re-autorización de Google Drive ---
// BORRAR DESPUÉS DE USARLAS
const driveService = require('./services/driveService');
app.get('/api/drive-reauth', (req, res) => {
    const url = driveService.getAuthUrl();
    if (!url) return res.status(500).send('Error generando URL de auth');
    res.redirect(url);
});
app.get('/api/drive-callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('Falta código');
    const ok = await driveService.saveToken(code);
    if (ok) res.send('✅ Token guardado exitosamente. Ya podés subir archivos. Reiniciá PM2: pm2 restart sistema-produccion');
    else res.status(500).send('❌ Error guardando token');
});
// --- FIN RUTAS TEMPORALES ---

// --- SERVIR FRONTEND EN PRODUCCIÓN ---
const publicPath = path.join(__dirname, 'public');
if (require('fs').existsSync(publicPath)) {
    logger.info('📂 Sirviendo archivos estáticos desde:', publicPath);
    app.use(express.static(publicPath, {
        etag: false,
        lastModified: false,
        setHeaders: (res) => {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }));

    // Cualquier ruta que no sea API, devuelve el index.html (SPA)
    app.get('*', (req, res) => {
        if (req.url.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
        res.sendFile(path.join(publicPath, 'index.html'));
    });
} else {
    logger.info('⚠️ No se encontró la carpeta "public". Ejecuta "npm run build" en el frontend y copia el contenido de "dist" a "backend/public".');
}

// ─── GLOBAL ERROR HANDLER ───
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const isProduction = process.env.NODE_ENV === 'production';

    logger.error(`💥 [ERROR] ${req.method} ${req.originalUrl}`, {
        status,
        message: err.message,
        ...(isProduction ? {} : { stack: err.stack })
    });

    res.status(status).json({
        success: false,
        error: isProduction ? 'Error interno del servidor' : err.message
    });
});

// ─── PROCESS-LEVEL ERROR HANDLERS ───
process.on('unhandledRejection', (reason, promise) => {
    logger.error('⚠️ [Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
    logger.error('💀 [Uncaught Exception]', err);
    server.close(() => process.exit(1));
});


// --- INICIO DEL SERVIDOR Y SCHEDULER ---
if (process.env.NODE_ENV !== 'test') {
    server.listen(PORT, async () => {
        logger.info(`🚀 Servidor backend + Socket.io corriendo en puerto ${PORT}`);

        try {
            logger.info(`ℹ️ [Sync] Sincronización con ERP desactivada (Pedidos vía WEB activos).`);

            try {
                require('./cron/planillaSync');
                logger.info("⏱️ [CRON] Sincronización de Planillas ACTIVADA");
            } catch (e) {
                logger.error("❌ [CRON] Error cargando PlanillaSync:", e.message);
            }

            try {
                const { startWspJob } = require('./jobs/wspAvisos.job');
                startWspJob(io);
            } catch (e) {
                logger.error("❌ [CRON] Error cargando WspAvisos:", e.message);
            }

            // LIMPIEZA DE ÓRDENES ZOMBIE ('Cargando...' > 30 min sin actividad)
            try {
                const { startZombieCleanupJob } = require('./jobs/zombieOrdersCleanup.job');
                startZombieCleanupJob(io);
            } catch (e) {
                logger.error("❌ [CRON] Error cargando ZombieCleanup:", e.message);
            }

            // ACTIVAR CRON ESTADOS DE CUENTA (Módulo Contabilidad)
            try {
                const { startEstadosCuentaJob } = require('./jobs/estadosCuenta.job');
                startEstadosCuentaJob();
            } catch (e) {
                logger.error('❌ [CRON] Error cargando EstadosCuenta:', e.message);
            }

            // ACTIVAR CRON CICLOS DE CRÉDITO (Cierre automático de ciclos semanales)
            try {
                const { iniciarCronCiclos } = require('./jobs/ciclosCredito.job');
                iniciarCronCiclos();
            } catch (e) {
                logger.error('❌ [CRON] Error cargando CiclosCredito:', e.message);
            }

            // ACTIVAR CRON COTIZACIÓN BCU
            try {
                const { startCotizacionJob } = require('./jobs/cotizacionBCU.job');
                startCotizacionJob();
            } catch (e) {
                logger.error("❌ [CRON] Error cargando CotizacionBCU:", e.message);
            }

        } catch (error) {
            logger.error("❌ Error al iniciar el Scheduler:", error.message);
        }
    });
}

module.exports = { app, server };
