const { sql, getPool } = require('../config/db');

// --- EXPORTAR/CREAR CLIENTE EN DB LOCAL ---
// Retorna { success: true, reactId: '...', reactCode: '...' } o { success: false }
exports.exportClientToReact = async (clientData) => {
    // clientData debe tener: Nombre, CodCliente, TelefonoTrabajo, Email, NombreFantasia, CioRuc, Direccion
    try {
        console.log("[SyncClient] Creando cliente en DB local:", clientData.Nombre);
        const pool = await getPool();

        // Verificar si ya existe
        const check = await pool.request()
            .input('Nom', sql.NVarChar(200), clientData.Nombre)
            .query("SELECT CodCliente, CodigoReact, IDReact FROM dbo.Clientes WHERE Nombre = @Nom");

        if (check.recordset.length > 0) {
            const existing = check.recordset[0];
            console.log(`[SyncClient] Cliente ya existe: CodCliente=${existing.CodCliente}`);
            return { success: true, reactCode: existing.CodigoReact || String(existing.CodCliente), reactId: existing.IDReact || String(existing.CodCliente), fullRes: existing };
        }

        // Insertar nuevo
        const safeStr = (val) => (val !== undefined && val !== null && val !== '') ? String(val) : null;
        const result = await pool.request()
            .input('Nom', sql.NVarChar(200), safeStr(clientData.Nombre))
            .input('Fan', sql.NVarChar(200), safeStr(clientData.NombreFantasia))
            .input('Tel', sql.NVarChar(50), safeStr(clientData.TelefonoTrabajo))
            .input('Mail', sql.NVarChar(200), safeStr(clientData.Email))
            .input('Ruc', sql.NVarChar(50), safeStr(clientData.CioRuc))
            .input('Dir', sql.NVarChar(500), safeStr(clientData.Direccion || clientData.CliDireccion))
            .query(`
                INSERT INTO dbo.Clientes (Nombre, NombreFantasia, TelefonoTrabajo, Email, CioRuc, CliDireccion)
                OUTPUT INSERTED.*
                VALUES (@Nom, @Fan, @Tel, @Mail, @Ruc, @Dir)
            `);

        const created = result.recordset[0];
        console.log(`[SyncClient] Creado en DB local. CodCliente: ${created.CodCliente}`);
        return { success: true, reactCode: String(created.CodCliente), reactId: String(created.CodCliente), fullRes: created };

    } catch (error) {
        console.error("[SyncClient] Export Error:", error.message);
        return { success: false, error: error.message };
    }
};

// --- ACTUALIZAR VINCULO LOCAL (dbo.Clientes) ---
exports.updateLocalLink = async (codCliente, reactCode, reactId) => {
    if (!reactCode) return false;
    try {
        const pool = await getPool();
        await pool.request()
            .input('CC', sql.Int, codCliente)
            .input('CR', sql.NVarChar(50), String(reactCode).trim())
            .input('IR', sql.NVarChar(50), reactId ? String(reactId).trim() : null)
            .query(`UPDATE dbo.Clientes SET CodigoReact = @CR, IDReact = @IR WHERE CodCliente = @CC`);
        return true;
    } catch (e) {
        console.error("[SyncClient] Link Error:", e.message);
        return false;
    }
};

// --- BUSCAR LOCAL ---
exports.findLocalClient = async (codCliente) => {
    try {
        const pool = await getPool();
        const res = await pool.request()
            .input('C', sql.VarChar, String(codCliente))
            .query("SELECT * FROM dbo.Clientes WHERE CodCliente = @C OR CAST(CodCliente as VarChar) = @C");
        return res.recordset[0];
    } catch (e) {
        return null;
    }
};

// --- CREAR LOCAL (Simple) ---
exports.createLocalClientSimple = async (erpClientData) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('C', sql.Int, parseInt(erpClientData.CodCliente))
            .input('N', sql.NVarChar(200), erpClientData.Nombre)
            .query(`INSERT INTO dbo.Clientes (CodCliente, Nombre) VALUES (@C, @N)`);

        console.log(`[SyncClient] Cliente local creado: ${erpClientData.CodCliente}`);
        return { CodCliente: erpClientData.CodCliente, Nombre: erpClientData.Nombre };
    } catch (e) {
        console.error("[SyncClient] Create Local Error:", e.message);
        return null;
    }
};
