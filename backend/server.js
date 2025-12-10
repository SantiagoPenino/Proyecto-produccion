const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// --- REGISTRO DE RUTAS (Verifica que estén TODAS) ---
app.use('/api/areas', require('./routes/areasRoutes'));
app.use('/api/orders', require('./routes/ordersRoutes'));
app.use('/api/stock', require('./routes/stockRoutes'));
app.use('/api/failures', require('./routes/failuresRoutes'));
app.use('/api/clients', require('./routes/clientsRoutes'));
app.use('/api/workflows', require('./routes/workflowsRoutes'));
app.use('/api/logistics', require('./routes/logisticsRoutes'));
app.use('/api/rolls', require('./routes/rollsRoutes'));
app.use('/api/production', require('./routes/productionRoutes'));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Servidor backend corriendo en puerto ${PORT}`));