const { getPool, sql } = require('../config/db');

// ¡IMPORTANTE!: Debe decir 'exports.getDynamicData'
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
        console.error("Error en reporte dinámico:", err);
        res.status(500).json({ error: err.message });
    }
};
