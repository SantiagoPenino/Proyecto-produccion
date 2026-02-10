const { sql, getPool } = require('../config/db');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-macrosoft-production';

// ===================================
// AUTHENTICATION LOGIC (UNIFIED IN Clientes TABLE)
// ===================================
exports.login = async (req, res) => {
    // identifier es el IDCliente (Varchar)
    const { identifier, password } = req.body;

    // Check if identifier is provided
    if (!identifier) {
        return res.status(400).json({ success: false, message: 'ID Cliente requerido' });
    }

    try {
        const pool = await getPool();

        // Busqueda estricta por IDCliente (Varchar)
        const result = await pool.request()
            .input('Val', sql.NVarChar, identifier)
            .query(`
                SELECT * FROM Clientes
                WHERE IDCliente = @Val
            `);

        if (result.recordset.length === 0) {
            return res.status(401).json({ success: false, message: 'Usuario incorrecto: No se encontró el cliente.' });
        }

        const client = result.recordset[0];
        let isValid = false;
        let isFirstTime = false;

        // Lógica de Contraseña
        // Si no tiene hash (NULL o vacio), es primera vez -> Auto Set
        if (!client.WebPasswordHash || client.WebPasswordHash === '') {
            if (password && password.length > 0) {
                isFirstTime = true;
                isValid = true;
            } else {
                return res.status(401).json({ success: false, message: 'Debe ingresar una contraseña.' });
            }
        }
        else if (client.WebPasswordHash === password) {
            isValid = true;
        }

        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Contraseña incorrecta.' });
        }

        // Si es la primera vez, guardamos la contraseña
        if (isFirstTime) {
            await pool.request()
                .input('ID', sql.Int, client.CodCliente)
                .input('Pass', sql.NVarChar, password)
                .query("UPDATE Clientes SET WebPasswordHash = @Pass, WebResetPassword = 0, WebActive = 1 WHERE CodCliente = @ID");

            // Actualizamos en memoria
            client.WebResetPassword = false;
        }

        const token = jwt.sign(
            {
                id: client.CodCliente,
                email: client.Email,
                name: client.Nombre,
                role: 'WEB_CLIENT',
                codCliente: client.CodCliente,
                requireReset: client.WebResetPassword
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        await pool.request()
            .input('ID', sql.Int, client.CodCliente)
            .query("UPDATE Clientes SET WebLastLogin = GETDATE() WHERE CodCliente = @ID");

        res.json({
            success: true,
            user: {
                id: client.CodCliente,
                email: client.Email,
                name: client.Nombre,
                company: client.NombreFantasia,
                role: 'WEB_CLIENT',
                codCliente: client.CodCliente,
                requireReset: client.WebResetPassword
            },
            token
        });

    } catch (err) {
        console.error("Login Error:", err);
        res.status(500).json({ error: "Error en servidor: " + err.message });
    }
};

exports.register = async (req, res) => {
    // Registro usando IDCliente (alfanumérico) como identificador principal
    const {
        idcliente,
        name, email, password, company, phone,
        address, ruc, localidad, agencia, fantasyName
    } = req.body;

    if (!idcliente || !password) {
        return res.status(400).json({ error: "Faltan datos obligatorios (ID Cliente, Contraseña)" });
    }

    try {
        const pool = await getPool();

        // 1. Verificar si existe por IDCliente
        const check = await pool.request()
            .input('Val', sql.NVarChar, idcliente)
            .query("SELECT * FROM Clientes WHERE IDCliente = @Val");

        let codClienteInterno;
        let createdOrUpdatedClient;

        if (check.recordset.length > 0) {
            // Cliente Exists -> Update / Claim
            const existing = check.recordset[0];
            codClienteInterno = existing.CodCliente;

            await pool.request()
                .input('ID', sql.Int, codClienteInterno)
                .input('Pass', sql.NVarChar(255), password)
                .input('Email', sql.NVarChar(200), email || existing.Email)
                .input('Tel', sql.NVarChar(50), phone || existing.TelefonoTrabajo)
                .input('Dir', sql.NVarChar(500), address || existing.CliDireccion)
                .input('Loc', sql.NVarChar(200), localidad || existing.Localidad)
                .input('Age', sql.NVarChar(200), agencia || existing.Agencia)
                .query(`
                    UPDATE Clientes 
                    SET WebPasswordHash = @Pass, 
                        WebActive = 1, 
                        WebResetPassword = 0,
                        Email = @Email,
                        TelefonoTrabajo = @Tel,
                        CliDireccion = @Dir,
                        Localidad = @Loc,
                        Agencia = @Age
                    WHERE CodCliente = @ID
                `);

            createdOrUpdatedClient = { ...existing, Nombre: existing.Nombre };
        } else {
            // Cliente NO existe -> Crear Nuevo

            // Generar CodCliente si no es Identity (asumimos lógica anterior de MAX+1)
            const idQuery = await pool.request().query("SELECT ISNULL(MAX(CodCliente), 0) + 1 as NextID FROM Clientes");
            codClienteInterno = idQuery.recordset[0].NextID;

            await pool.request()
                .input('CC', sql.Int, codClienteInterno)
                .input('IDC', sql.NVarChar(50), idcliente) // Guardamos el ID alfanumérico
                .input('Nom', sql.NVarChar(200), company || name || 'Nuevo Cliente')
                .input('Fant', sql.NVarChar(200), fantasyName || name || '')
                .input('Email', sql.NVarChar(200), email)
                .input('Tel', sql.NVarChar(50), phone || '')
                .input('Dir', sql.NVarChar(500), address || '')
                .input('Ruc', sql.NVarChar(50), ruc || '')
                .input('Loc', sql.NVarChar(200), localidad || '')
                .input('Age', sql.NVarChar(200), agencia || '')
                .input('Pass', sql.NVarChar(255), password)
                .query(`
                    INSERT INTO Clientes (
                        CodCliente, IDCliente, Nombre, NombreFantasia, Email, TelefonoTrabajo, CliDireccion, CioRuc, 
                        Localidad, Agencia, FechaAlta, WebPasswordHash, WebActive, WebResetPassword
                    )
                    VALUES (
                        @CC, @IDC, @Nom, @Fant, @Email, @Tel, @Dir, @Ruc, 
                        @Loc, @Age, GETDATE(), @Pass, 1, 0
                    )
                `);

            createdOrUpdatedClient = { Nombre: company || name, Email: email };
        }

        // Generate Token
        const token = jwt.sign(
            {
                id: codClienteInterno,
                email: email || createdOrUpdatedClient.Email,
                name: createdOrUpdatedClient.Nombre,
                role: 'WEB_CLIENT',
                codCliente: codClienteInterno
            },
            JWT_SECRET, { expiresIn: '30d' }
        );

        res.json({
            success: true,
            user: {
                id: codClienteInterno,
                email: email || createdOrUpdatedClient.Email,
                name: createdOrUpdatedClient.Nombre,
                role: 'WEB_CLIENT',
                codCliente: codClienteInterno
            },
            token
        });

    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.me = async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "No autorizado" });

    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('ID', sql.Int, req.user.codCliente)
            .query("SELECT * FROM Clientes WHERE CodCliente = @ID");

        if (r.recordset.length > 0) {
            const u = r.recordset[0];
            res.json({
                success: true,
                user: {
                    id: u.CodCliente,
                    email: u.Email,
                    name: u.Nombre,
                    company: u.NombreFantasia,
                    phone: u.TelefonoTrabajo,
                    address: u.CliDireccion,
                    ruc: u.CioRuc,
                    localidad: u.Localidad,
                    agencia: u.Agencia,
                    role: 'WEB_CLIENT',
                    codCliente: u.CodCliente,
                    requireReset: u.WebResetPassword || (u.WebPasswordHash == null) || (u.WebPasswordHash === '')
                }
            });
        } else {
            res.status(404).json({ error: "Cliente no encontrado" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// ===================================
// UPDATE PASSWORD (FORCE RESET)
// ===================================
exports.updatePassword = async (req, res) => {
    // User must be authenticated (even with the temp/reset token)
    const userId = req.user.codCliente; // Using CodCliente as ID
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: "La contraseña es muy corta" });
    }

    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, userId)
            .input('Pass', sql.NVarChar, newPassword)
            .query("UPDATE Clientes SET WebPasswordHash = @Pass, WebResetPassword = 0 WHERE CodCliente = @ID");

        res.json({ success: true, message: "Contraseña actualizada correctamente" });
    } catch (err) {
        console.error("Update Pass Error:", err);
        res.status(500).json({ error: err.message });
    }
};
