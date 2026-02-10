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

// 🔍 DEBUG: LOG REQUESTS
app.use((req, res, next) => {
    console.log(`📡 INCOMING: ${req.method} ${req.url}`);
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
const nomenclatorsRoutes = require('./routes/nomenclatorsRoutes');

app.use('/api/web-auth', webAuthRoutes); // RUTAS AUTH CLIENTE WEB
app.use('/api/web-orders', webOrdersRoutes); // RUTAS PEDIDOS CLIENTE WEB (DTF, Etc)
app.use('/api/nomenclators', nomenclatorsRoutes);
app.use('/api/routes-config', require('./routes/routesConfigRoutes'));
app.use('/api/delivery-times', require('./routes/deliveryTimesRoutes'));
app.get('/api/debug/reprocess/:id', require('./controllers/debugController').reprocessOrder);
app.use('/api/insumos', require('./routes/insumosRoutes'));
app.use('/api/reception', require('./routes/receptionRoutes'));
app.use('/api/logistics', require('./routes/logisticsRoutes'));
app.use('/api/inventory', require('./routes/inventoryRoutes'));

// SECCIÓN DE PRODUCCIÓN
app.use('/api/production-kanban', require('./routes/productionKanbanRoutes'));
app.use('/api/production-file-control', require('./routes/productionFileRoutes'));
app.use('/api/production', require('./routes/productionRoutes'));
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

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.set('socketio', io);

io.on('connection', (socket) => {
    console.log('🔌 Nuevo cliente conectado:', socket.id);
    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 5000;

// FORCED RESTART TRIGGER: 2026-01-01 22:38

// --- INICIO DEL SERVIDOR Y SCHEDULER ---
server.listen(PORT, async () => {
    console.log(`🚀 Servidor backend + Socket.io corriendo en puerto ${PORT}`);

    // Iniciamos la sincronización automática después de que el servidor suba
    try {
        // startAutoSync(io).catch(err => console.error("❌ Scheduler Start Error:", err));
        // console.log(`⏱️ Sistema de sincronización automática activado.`);
        console.log(`ℹ️ [Sync] Sincronización con ERP desactivada (Pedidos vía WEB activos).`);
    } catch (error) {
        console.error("❌ Error al iniciar el Scheduler:", error.message);
    }
});