const axios = require('axios');
const { sql, getPool } = require('../config/db');

// --- HELPER TOKEN ---
async function getExternalToken() {
    try {
        const tokenRes = await axios.post('https://administracionuser.uy/api/apilogin/generate-token', {
            apiKey: "api_key_google_123sadas12513_user"
        });
        return tokenRes.data.token || tokenRes.data.accessToken || tokenRes.data;
    } catch (e) {
        console.error("[SyncClient] Error Token:", e.message);
        return null;
    }
}

// --- EXPORTAR A REACT ---
// Retorna { success: true, reactId: '...', reactCode: '...' } o { success: false }
exports.exportClientToReact = async (clientData) => {
    // clientData debe tener: Nombre, CodCliente, TelefonoTrabajo, Email, NombreFantasia, CioRuc, Direccion
    try {
        console.log("[SyncClient] Exportando a React:", clientData.Nombre);
        const token = await getExternalToken();
        if (!token) throw new Error("No se pudo obtener token");

        const payload = {
            CliCodigoCliente: clientData.Nombre,                   // SWAP: Nombre Local -> Código React
            CliNombreApellido: String(clientData.CodCliente),      // SWAP: Código Local -> Nombre React
            CliCelular: clientData.TelefonoTrabajo ? String(clientData.TelefonoTrabajo) : null,
            CliMail: clientData.Email || null,
            CliNombreEmpresa: clientData.NombreFantasia || null,
            CliDocumento: clientData.CioRuc || null,
            CliLocalidad: clientData.Ciudad || "Montevideo",
            CliDireccion: clientData.Direccion || null,
            TClIdTipoCliente: 1
        };

        const response = await axios.post('https://administracionuser.uy/api/apicliente/create', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        // PARSEO RESPUESTA
        let created = response.data;
        if (created && created.data && !created.IdCliente) created = created.data;
        if (created && created.cliente) created = created.cliente;

        const nuevoCodigoReact = created.CodigoCliente || created.CliCodigoCliente || created.codigoCliente || created.CodCliente;
        const nuevoIdReact = created.CliIdCliente || created.IdCliente || created.CliId || created.idCliente;

        console.log(`[SyncClient] Creado en React. ID: ${nuevoIdReact}`);
        return { success: true, reactCode: nuevoCodigoReact, reactId: nuevoIdReact, fullRes: created };

    } catch (error) {
        console.error("[SyncClient] Export Error:", error.message);
        if (error.response) console.error("API Error Detail:", error.response.data);
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
