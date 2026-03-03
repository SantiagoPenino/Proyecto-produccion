const express = require('express');
console.log('--- SERVER RESTARTED V32 (NAMING: ARCHIVO X DE Y) AT ' + new Date().toISOString() + ' ---');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

console.log("---------------------------------------------------------");
console.log("🔑 [SERVER STARTUP] Verificando Variables de Entorno:");
console.log("   PORT:", process.env.PORT);
console.log("   GEMINI_KEY:", process.env.GEMINI_API_KEY ? "Cargada ✅ (" + process.env.GEMINI_API_KEY.substring(0, 5) + "...)" : "❌ NO DETECTADA");
console.log("---------------------------------------------------------");

// --- IMPORTACIÓN DEL SCHEDULER ---
const { startAutoSync } = require('./scheduler'); // Asegúrate de crear este archivo

const app = express();
app.set('trust proxy', 1); // Necesario para funcionar detrás de Nginx (proxy reverso)

// --- MIDDLEWARES DE SEGURIDAD ---
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for simplicity in this dev environment to allow iframe and inline scripts for QR
    frameguard: false // Allow framing
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Demasiadas peticiones desde esta IP, por favor intente nuevamente en 15 minutos."
});
app.use(limiter);

app.use(cors());
app.use(express.json({ limit: '200mb' }));

// 🔍 DEBUG: LOG REQUESTS (Silenced to reduce noise)
app.use((req, res, next) => {
    // console.log(`📡 INCOMING: ${req.method} ${req.url}`);
    next();
});

// --- STATIC FILES ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- REGISTRO DE RUTAS ---
app.use('/api/areas', require('./routes/areasRoutes'));
app.use('/api/orders', require('./routes/ordersRoutes'));
app.use('/api/stock', require('./routes/stockRoutes'));
app.use('/api/failures', require('./routes/failuresRoutes'));
app.use('/api/clients', require('./routes/clientsRoutes'));
app.use('/api/workflows', require('./routes/workflowsRoutes'));
app.use('/api/logistics', require('./routes/logisticsRoutes'));
app.use('/api/rolls', require('./routes/rollsRoutes'));
app.use('/api/rest-sync', require('./routes/restSyncRoutes'));
app.use('/api/measurements', require('./routes/measurementRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/menu', require('./routes/menuRoutes'));
app.use('/api/roles', require('./routes/rolesRoutes'));
app.use('/api/users', require('./routes/usersRoutes'));
app.use('/api/audit', require('./routes/auditRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));

const webAuthRoutes = require('./routes/webAuthRoutes');
const webOrdersRoutes = require('./routes/webOrdersRoutes'); // Nueva ruta Pedidos Web
const webRetirosRoutes = require('./routes/webRetirosRoutes');
const nomenclatorsRoutes = require('./routes/nomenclatorsRoutes');

app.use('/api/web-auth', webAuthRoutes); // RUTAS AUTH CLIENTE WEB
app.use('/api/web-orders', webOrdersRoutes); // RUTAS PEDIDOS CLIENTE WEB (DTF, Etc)
app.use('/api/web-retiros', webRetirosRoutes);
app.use('/api/web-content', require('./routes/webContentRoutes')); // RUTAS CONTENIDO WEB (Sidebar/Popup)
app.use('/api/nomenclators', nomenclatorsRoutes);
app.use('/api/routes-config', require('./routes/routesConfigRoutes'));
app.use('/api/delivery-times', require('./routes/deliveryTimesRoutes'));
app.get('/api/debug/reprocess/:id', require('./controllers/debugController').reprocessOrder);
app.use('/api/insumos', require('./routes/insumosRoutes'));
app.use('/api/reception', require('./routes/receptionRoutes'));
app.use('/api/logistics', require('./routes/logisticsRoutes'));
app.use('/api/inventory', require('./routes/inventoryRoutes'));
app.use('/api/configuraciones', require('./routes/configuracionesRoutes'));

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
} catch (e) { console.error("❌ Error loading finishing routes:", e); }

try {
    app.use('/api/products-integration', require('./routes/productsIntegrationRoutes'));
} catch (e) { console.error("❌ Error loading product integration routes:", e); }

try {
    app.use('/api/integration-logs', require('./routes/integrationLogsRoutes'));
} catch (e) { console.error("❌ Error loading log routes:", e); }

try {
    app.use('/api/special-prices', require('./routes/specialPricesRoutes'));
} catch (e) { console.error("❌ Error loading special prices routes:", e); }

try {
    app.use('/api/prices', require('./routes/pricesRoutes'));
} catch (e) { console.error("❌ Error loading base prices routes:", e); }

try {
    app.use('/api/profiles', require('./routes/profilesRoutes'));
} catch (e) { console.error("❌ Error loading profiles routes:", e); }

try {
    app.use('/api/clients', require('./routes/clientsRoutes'));
} catch (e) { console.error("❌ Error loading clients routes:", e); }

app.use('/api/chat', require('./routes/chatRoutes'));
// checkout routes deshabilitado por ahora

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
    // Log nivel silly para no saturar, pero útil para debug inicial
    // console.log('🔌 Socket Connect:', socket.id); 

    socket.on('error', (err) => {
        console.error("❌ Socket Error:", err);
    });

    socket.on('disconnect', (reason) => {
        // console.log('❌ Socket Disconnect:', socket.id, reason);
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
    console.log('📂 Sirviendo archivos estáticos desde:', publicPath);
    app.use(express.static(publicPath));

    // Cualquier ruta que no sea API, devuelve el index.html (SPA)
    app.get('*', (req, res) => {
        if (req.url.startsWith('/api')) return res.status(404).json({ error: 'API route not found' });
        res.sendFile(path.join(publicPath, 'index.html'));
    });
} else {
    console.log('⚠️ No se encontró la carpeta "public". Ejecuta "npm run build" en el frontend y copia el contenido de "dist" a "backend/public".');
}

// ─── GLOBAL ERROR HANDLER ───
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const isProduction = process.env.NODE_ENV === 'production';

    console.error(`💥 [ERROR] ${req.method} ${req.originalUrl}`, {
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
    console.error('⚠️ [Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
    console.error('💀 [Uncaught Exception]', err);
    server.close(() => process.exit(1));
});


// --- INICIO DEL SERVIDOR Y SCHEDULER ---
server.listen(PORT, async () => {
    console.log(`🚀 Servidor backend + Socket.io corriendo en puerto ${PORT}`);

    // Iniciamos la sincronización automática después de que el servidor suba
    try {
        // startAutoSync(io).catch(err => console.error("❌ Scheduler Start Error:", err));
        // console.log(`⏱️ Sistema de sincronización automática activado.`);
        console.log(`ℹ️ [Sync] Sincronización con ERP desactivada (Pedidos vía WEB activos).`);

        // ACTIVAR CRON PLANILLAS
        try {
            require('./cron/planillaSync');
            console.log("⏱️ [CRON] Sincronización de Planillas ACTIVADA");
        } catch (e) {
            console.error("❌ [CRON] Error cargando PlanillaSync:", e.message);
        }

    } catch (error) {
        console.error("❌ Error al iniciar el Scheduler:", error.message);
    }
});
