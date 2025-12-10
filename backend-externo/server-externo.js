// server-externo.js

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config(); 

// 1. Importar la configuración de la DB
const { getPool } = require('./config/db.config');
// 2. Importar las rutas de artículos
const articleRoutes = require('./routes/article.routes'); 

const app = express();

// Middleware
app.use(cors()); 
app.use(bodyParser.json()); 
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// 🔑 Conectar las rutas de la API
app.use('/api/articulos', articleRoutes); 

// Ruta de prueba simple (Health Check)
app.get('/', (req, res) => {
    res.json({ message: 'Bienvenido a la API RESTful de Artículos.' });
});

// Inicialización del Servidor y la DB
const initializeServer = async () => {
    await getPool(); // Conecta a la base de datos
    
    app.listen(PORT, () => {
        console.log(`🚀 Servidor Express escuchando en http://localhost:${PORT}`);
    });
};

initializeServer();