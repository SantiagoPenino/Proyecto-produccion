const { getPool, sql } = require('../config/db');

// 1. OBTENER ÓRDENES DISPONIBLES PARA EL CARRITO
exports.getOrdersForCart = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();
        
        // NOTA: Me pediste "Todas las órdenes" por ahora. 
        // Luego agregaremos: AND Estado = 'Finalizado'
        const query = `
            SELECT 
                OrdenID as id, 
                Cliente as client, 
                DescripcionTrabajo as description,
                Estado as status,
                Cantidad = 1 -- O magnitud
            FROM dbo.Ordenes 
            WHERE AreaID = @AreaID
            AND Estado != 'Entregado' -- Solo excluimos lo que ya se fue
            ORDER BY FechaIngreso DESC
        `;

        const result = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(query);

        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. GENERAR DESPACHO (El "Checkout")
exports.createDispatch = async (req, res) => {
    const { areaId, ordenesIds, cadete } = req.body; // ordenesIds es un array [1001, 1002]

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        // A. Generar Código
        const codigo = `DSP-${Date.now().toString().slice(-6)}`;

        // B. Crear Cabecera
        const reqHead = new sql.Request(transaction);
        const resHead = await reqHead
            .input('Codigo', sql.VarChar(20), codigo)
            .input('Area', sql.VarChar(20), areaId)
            .input('Cadete', sql.VarChar(100), cadete || 'Cadete General')
            .input('Cant', sql.Int, ordenesIds.length)
            .query("INSERT INTO dbo.Despachos (CodigoSeguimiento, AreaOrigen, CadeteNombre, CantidadOrdenes) OUTPUT INSERTED.DespachoID VALUES (@Codigo, @Area, @Cadete, @Cant)");
        
        const despachoId = resHead.recordset[0].DespachoID;

        // C. Insertar Items y Actualizar Órdenes
        for (const id of ordenesIds) {
            // 1. Ligar al despacho
            await new sql.Request(transaction)
                .input('DespachoID', sql.Int, despachoId)
                .input('OrdenID', sql.Int, id)
                .query("INSERT INTO dbo.DespachoItems (DespachoID, OrdenID) VALUES (@DespachoID, @OrdenID)");

            // 2. Actualizar Estado de Orden a 'Entregado' (o 'En Tránsito')
            await new sql.Request(transaction)
                .input('OrdenID', sql.Int, id)
                .query("UPDATE dbo.Ordenes SET Estado = 'Entregado' WHERE OrdenID = @OrdenID");
        }

        await transaction.commit();
        res.json({ success: true, codigo, message: `Despacho ${codigo} generado con éxito.` });

    } catch (err) {
        if (transaction) await transaction.rollback();
        res.status(500).json({ error: err.message });
    }
};