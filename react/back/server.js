const express = require('express');// -ok
const cors = require('cors');// -ok
require('dotenv').config();
const path = require('path');// -ok
const http = require('http');
const { init } = require('./socket'); // Importar la configuración de WebSocket
const { loadCache } = require('./cacheLoader'); // Importa la función de carga de caché
const cache = require('./cache'); // Importa la instancia desde cache.js

// Importar los gateways de las diferentes APIs
const getwayClientes = require('./routes/getwayClientes');
const getwayOrdenes = require('./routes/getwayOrdenes');
const getwayOrdenesRetiro = require('./routes/getwayOrdenesRetiro');
const getwayProductos = require('./routes/getwayProductos');
const getwayLugaresRetiro = require('./routes/getwayLugaresRetiro');
const getwayPagos = require('./routes/getwayPagos');
const getwayCotizaciones = require('./routes/getwayCotizaciones');

// Importar la ruta de autenticación
const getwayAuth = require('./routes/getwayAuth');

const getwayServer = require('./routes/getwayServer');

// Importar el scraping de cotizaciones
const scrapeAndSaveCotizaciones = require('./cotizaciones');

const app = express();
const port = 5000;
const server = http.createServer(app);

// Inicializar WebSocket
init(server);

// Configurar middleware
app.use(cors({
  origin: 'http://administracionuser.uy',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  console.log(`Solicitud: ${req.method} ${req.url}`);
  next();
});

// Exponer carpeta pública para comprobantes
app.use('/comprobantesPagos', express.static(path.join(__dirname, 'comprobantesPagos')));

// Registrar las rutas de las APIs
app.use('/apipagos', getwayPagos);
app.use('/apicliente', getwayClientes);
app.use('/apiproducto', getwayProductos);
app.use('/apiordenes', getwayOrdenes);
app.use('/apiordenesRetiro', getwayOrdenesRetiro);
app.use('/apilugaresRetiro', getwayLugaresRetiro);
app.use('/apicotizaciones', getwayCotizaciones);

// Registrar la ruta de autenticación
app.use('/apilogin', getwayAuth);

app.use('/apiserver', getwayServer);

// Ejecutar la función de scraping al iniciar el servidor
/*
(async () => {
  console.log('Iniciando scraping de cotizaciones...');
  await scrapeAndSaveCotizaciones();
  console.log('Scraping completado.');
})();
*/

// Manejo de excepciones no capturadas
process.on('uncaughtException', (err) => {
  console.error('Excepción no capturada:', err.message);
  console.error(err.stack);
});

// Manejo de promesas rechazadas no manejadas
process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesa rechazada no manejada:', reason);
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error('Error capturado:', err.message);
  res.status(500).json({ error: 'Ocurrió un error interno en el servidor.' });
});

// Iniciar el servidor
server.listen(port, async () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
  await loadCache(); // Carga la caché con datos iniciales
});

// Enviar mensajes wsp
const { procesarAvisosWsp } = require("./jobs/wspAvisos.job");

setInterval(() => {
  procesarAvisosWsp().catch(console.error);
}, 1 * 60 * 1000);
