const { sql, getPool } = require('../config/db');

// Obtener Lista de Clientes Especiales
const getClients = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query("SELECT ClienteID, NombreCliente FROM PreciosEspeciales ORDER BY ClienteID");
        res.json(result.recordset);
    } catch (e) {
        console.error("Error getting special clients:", e);
        res.status(500).json({ error: e.message });
    }
};

// Obtener Reglas de un Cliente
const getClientRules = async (req, res) => {
    const { clientId } = req.params;
    try {
        const pool = await getPool();
        // 1. Verificar si existe el cliente
        const clientRes = await pool.request()
            .input('CID', sql.Int, clientId)
            .query("SELECT * FROM PreciosEspeciales WHERE ClienteID = @CID");

        if (clientRes.recordset.length === 0) {
            return res.status(404).json({ error: "Cliente no encontrado" });
        }

        // 2. Obtener Items
        const itemsRes = await pool.request()
            .input('CID', sql.Int, clientId)
            .query("SELECT CodArticulo, TipoRegla, Valor, Moneda, MinCantidad FROM PreciosEspecialesItems WHERE ClienteID = @CID");

        res.json({
            client: clientRes.recordset[0],
            rules: itemsRes.recordset
        });
    } catch (e) {
        console.error("Error getting client rules:", e);
        res.status(500).json({ error: e.message });
    }
};

// Guardar/Actualizar Perfil de Cliente
const saveClientProfile = async (req, res) => {
    const { clientId, nombre, rules } = req.body; // rules: [{ CodArticulo, TipoRegla, Valor, Moneda, MinCantidad }]

    if (!clientId) return res.status(400).json({ error: "Falta ClientID" });

    const transaction = new sql.Transaction(await getPool());
    try {
        await transaction.begin();

        // 1. Upsert Cabecera
        const headerReq = new sql.Request(transaction);
        await headerReq
            .input('CID', sql.Int, clientId)
            .input('Nom', sql.NVarChar, nombre || `Cliente ${clientId}`)
            .query(`
                IF NOT EXISTS (SELECT 1 FROM PreciosEspeciales WHERE ClienteID = @CID)
                BEGIN
                    INSERT INTO PreciosEspeciales (ClienteID, NombreCliente) VALUES (@CID, @Nom)
                END
                ELSE
                BEGIN
                    UPDATE PreciosEspeciales SET UltimaActualizacion = GETDATE() WHERE ClienteID = @CID
                END
            `);

        // 2. Limpiar Items Anteriores (Estrategia simple: Borrar y Recrear para evitar diff complejo)
        // Ojo: Si hay muchos items esto es un delete grande, pero para perfiles de precios es aceptable.
        const delReq = new sql.Request(transaction);
        await delReq.input('CID', sql.Int, clientId).query("DELETE FROM PreciosEspecialesItems WHERE ClienteID = @CID");

        // 3. Insertar Nuevos Items
        if (rules && rules.length > 0) {
            for (const rule of rules) {
                const itemReq = new sql.Request(transaction);
                await itemReq
                    .input('CID', sql.Int, clientId)
                    .input('Cod', sql.NVarChar, rule.CodArticulo || 'TOTAL')
                    .input('Tipo', sql.NVarChar, rule.TipoRegla || 'fixed')
                    .input('Val', sql.Decimal(18, 4), rule.Valor || 0)
                    .input('Mon', sql.NVarChar, rule.Moneda || 'UYU')
                    .input('Min', sql.Decimal(18, 2), rule.MinCantidad || 0)
                    .query(`
                        INSERT INTO PreciosEspecialesItems (ClienteID, CodArticulo, TipoRegla, Valor, Moneda, MinCantidad)
                        VALUES (@CID, @Cod, @Tipo, @Val, @Mon, @Min)
                    `);
            }
        }

        await transaction.commit();
        res.json({ success: true, message: "Perfil guardado correctamente" });

    } catch (e) {
        if (transaction._begun) await transaction.rollback();
        console.error("Error saving client profile:", e);
        res.status(500).json({ error: e.message });
    }
};

// Eliminar Cliente
const deleteClient = async (req, res) => {
    const { clientId } = req.params;

    const transaction = new sql.Transaction(await getPool());
    try {
        await transaction.begin();

        await new sql.Request(transaction).input('CID', sql.Int, clientId).query("DELETE FROM PreciosEspecialesItems WHERE ClienteID = @CID");
        await new sql.Request(transaction).input('CID', sql.Int, clientId).query("DELETE FROM PreciosEspeciales WHERE ClienteID = @CID");

        await transaction.commit();
        res.json({ success: true });
    } catch (e) {
        if (transaction._begun) await transaction.rollback();
        res.status(500).json({ error: e.message });
    }
};

module.exports = {
    getClients,
    getClientRules,
    saveClientProfile,
    deleteClient
};
