const { getPool, sql } = require('../config/db');

// Obtener todas las rutas con sus pasos
exports.getWorkflows = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT r.RutaID, r.Nombre, r.Descripcion, 
                   p.AreaDestinoID, p.Secuencia, a.Nombre as AreaNombre
            FROM dbo.RutasProduccion r
            LEFT JOIN dbo.RutasPasos p ON r.RutaID = p.RutaID
            LEFT JOIN dbo.Areas a ON p.AreaDestinoID = a.AreaID
            ORDER BY r.RutaID, p.Secuencia
        `);

        // Agrupar pasos por ruta
        const workflows = [];
        result.recordset.forEach(row => {
            let flow = workflows.find(w => w.id === row.RutaID);
            if (!flow) {
                flow = { id: row.RutaID, nombre: row.Nombre, descripcion: row.Descripcion, pasos: [] };
                workflows.push(flow);
            }
            if (row.AreaDestinoID) {
                flow.pasos.push({ areaId: row.AreaDestinoID, nombre: row.AreaNombre, orden: row.Secuencia });
            }
        });

        res.json(workflows);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// Crear nueva ruta
exports.createWorkflow = async (req, res) => {
    const { nombre, descripcion, pasos } = req.body; // pasos = ['DTF', 'COSTURA', 'DESPACHO']
    
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();
        
        const reqHead = new sql.Request(transaction);
        const resHead = await reqHead
            .input('Nombre', sql.NVarChar(100), nombre)
            .input('Desc', sql.NVarChar(200), descripcion)
            .query("INSERT INTO dbo.RutasProduccion (Nombre, Descripcion) OUTPUT INSERTED.RutaID VALUES (@Nombre, @Desc)");
        
        const rutaId = resHead.recordset[0].RutaID;

        if (pasos && pasos.length > 0) {
            for (let i = 0; i < pasos.length; i++) {
                await new sql.Request(transaction)
                    .input('RutaID', sql.Int, rutaId)
                    .input('AreaID', sql.VarChar(20), pasos[i])
                    .input('Sec', sql.Int, i + 1)
                    .query("INSERT INTO dbo.RutasPasos (RutaID, AreaDestinoID, Secuencia) VALUES (@RutaID, @AreaID, @Sec)");
            }
        }

        await transaction.commit();
        res.json({ success: true, id: rutaId });
    } catch (err) {
        if (transaction) await transaction.rollback();
        res.status(500).json({ error: err.message });
    }
};