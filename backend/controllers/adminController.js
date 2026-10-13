const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// ¡IMPORTANTE!: Debe decir 'exports.getDynamicData'
// SIN USO (13/10): getDynamicData: su único caller es src/components/pages/AdminDashboard.jsx, que tampoco se usa. Depende de sp_Admin_GetOrdenes/Rollos/Equipos. Confirmar con Yoania si se usa o se borra. Ver docs/auditoria-limpieza-2026-10-09.md.
exports.getDynamicData = async (req, res) => {
    const { reportType } = req.query; 
    
    try {
        const pool = await getPool();
        let spName = '';

        switch (reportType) {
            case 'orders': spName = 'sp_Admin_GetOrdenes'; break;
            case 'rolls':  spName = 'sp_Admin_GetRollos';  break;
            case 'machines': spName = 'sp_Admin_GetEquipos'; break;
            default: return res.status(400).json({ error: 'Reporte desconocido' });
        }

        const result = await pool.request().execute(spName);
        res.json(result.recordset);

    } catch (err) {
        logger.error("Error en reporte dinámico:", err);
        res.status(500).json({ error: err.message });
    }
};
