const { sql, getPool } = require('../config/db');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-macrosoft-production';

// =====================================================================
// 1. LOGIN
// =====================================================================
exports.login = async (req, res) => {
    const { username, password } = req.body;
    console.log(`[LOGIN ATTEMPT] Username: ${username}, Password provided: ${password ? 'YES' : 'NO'}`);

    try {
        const pool = await getPool();

        // -----------------------------------------------------------------
        // 1. INTENTO DE LOGIN COMO ADMIN / USUARIO INTERNO
        // -----------------------------------------------------------------
        const result = await pool.request()
            .input('Username', sql.NVarChar, username)
            .execute('sp_AutenticarUsuario');

        if (result.recordset.length > 0) {
            const user = result.recordset[0];

            // Validación manual (si aplica)
            if (user.PasswordHash && password !== user.PasswordHash) {
                // Contraseña incorrecta para usuario existente -> Fallar aquí (no probar cliente)
                // O probar cliente SOLO si el username coincide con un IDCliente
                // Por seguridad, si existe el usuario interno, asumimos que es ese
                return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
            }

            // Log successful login
            try {
                await pool.request()
                    .input('UserID', sql.Int, user.UserID)
                    .input('Action', sql.NVarChar, 'LOGIN')
                    .input('Details', sql.NVarChar, 'Success')
                    .input('IPAddress', sql.NVarChar, req.ip)
                    .execute('sp_RegistrarAccion');
            } catch (logErr) { console.warn("Error logging login:", logErr.message); }

            // GENERATE TOKEN (ADMIN)
            const token = jwt.sign(
                {
                    id: user.UserID,
                    username: user.Username,
                    role: user.RoleName,
                    idRol: user.IdRol,
                    areaKey: user.AreaUsuario || user.AreaID,
                    userType: 'INTERNAL' // Flag para distinguir
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            return res.json({
                success: true,
                userType: 'INTERNAL',
                redirectUrl: '/', // Admin Dashboard
                user: {
                    userId: user.UserID,
                    username: user.Username,
                    role: user.RoleName,
                    idRol: user.IdRol,
                    area: user.AreaUsuario,
                    areaKey: user.AreaUsuario,
                    avatar: user.Avatar || null,
                    token: token // Enviamos token dentro de user por compatibilidad
                },
                token: token
            });
        }

        // -----------------------------------------------------------------
        // 2. SI NO ES ADMIN, INTENTO COMO CLIENTE (WEB PORTAL)
        // -----------------------------------------------------------------
        const clientResult = await pool.request()
            .input('Val', sql.NVarChar, username.trim()) // Username input es el IDCliente
            .query(`
                SELECT CodCliente, IDCliente, Nombre, WebPasswordHash, WebActive, Email, NombreFantasia, WebResetPassword 
                FROM Clientes
                WHERE LTRIM(RTRIM(IDCliente)) = @Val
            `);

        if (clientResult.recordset.length > 0) {
            const client = clientResult.recordset[0];
            let isValid = false;
            let isFirstTime = false;

            // Lógica Password Cliente
            if (!client.WebPasswordHash || client.WebPasswordHash === '') {
                if (password && password.length > 0) {
                    isFirstTime = true;
                    isValid = true;
                } else {
                    return res.status(401).json({ success: false, message: 'Debe ingresar una contraseña.' });
                }
            } else if (client.WebPasswordHash === password) {
                isValid = true;
            }

            if (!isValid) {
                return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
            }

            // Update Password if first time
            if (isFirstTime) {
                await pool.request()
                    .input('ID', sql.Int, client.CodCliente)
                    .input('Pass', sql.NVarChar, password)
                    .query("UPDATE Clientes SET WebPasswordHash = @Pass, WebResetPassword = 0, WebActive = 1 WHERE CodCliente = @ID");
                client.WebResetPassword = false;
            }

            // GENERATE TOKEN (CLIENT)
            const token = jwt.sign(
                {
                    id: client.CodCliente,
                    email: client.Email,
                    name: client.Nombre,
                    role: 'WEB_CLIENT',
                    codCliente: client.CodCliente,
                    requireReset: client.WebResetPassword,
                    userType: 'CLIENT'
                },
                JWT_SECRET,
                { expiresIn: '30d' }
            );

            // Log Client Access
            await pool.request()
                .input('ID', sql.Int, client.CodCliente)
                .query("UPDATE Clientes SET WebLastLogin = GETDATE() WHERE CodCliente = @ID");

            return res.json({
                success: true,
                userType: 'CLIENT',
                redirectUrl: '/portal', // Client Portal
                user: {
                    id: client.CodCliente,
                    userId: client.CodCliente, // Polyfill for Admin context compatibility if needed
                    email: client.Email,
                    name: client.Nombre,
                    company: client.NombreFantasia,
                    role: 'WEB_CLIENT',
                    idRol: 99, // Dummy ID for client role
                    codCliente: client.CodCliente,
                    requireReset: client.WebResetPassword,
                    token: token
                },
                token: token
            });
        }

        // -----------------------------------------------------------------
        // 3. NO ENCONTRADO EN NINGUNO
        // -----------------------------------------------------------------
        res.status(401).json({ success: false, message: 'Credenciales inválidas o usuario inexistente.' });

    } catch (err) {
        console.error('[LOGIN ERROR] SQL Error:', err);
        res.status(500).send({ message: err.message });
    }
};

// =====================================================================
// 1b. GOOGLE LOGIN
// =====================================================================
exports.googleLogin = async (req, res) => {
    const { credential } = req.body; // Google ID token from frontend

    if (!credential) {
        return res.status(400).json({ success: false, message: 'Token de Google no proporcionado.' });
    }

    try {
        const { OAuth2Client } = require('google-auth-library');
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const googleEmail = payload.email;

        console.log(`[GOOGLE LOGIN] Email: ${googleEmail}`);

        const pool = await getPool();

        // Buscar en Clientes por email
        const clientResult = await pool.request()
            .input('Email', sql.NVarChar, googleEmail)
            .query(`
                SELECT CodCliente, IDCliente, Nombre, Email, NombreFantasia, WebPasswordHash, WebResetPassword
                FROM Clientes
                WHERE LTRIM(RTRIM(Email)) = @Email
            `);

        if (clientResult.recordset.length > 0) {
            const cl = clientResult.recordset[0];

            const token = jwt.sign(
                {
                    id: cl.CodCliente,
                    email: cl.Email,
                    name: cl.Nombre,
                    role: 'WEB_CLIENT',
                    codCliente: cl.CodCliente,
                    userType: 'CLIENT'
                },
                JWT_SECRET,
                { expiresIn: '30d' }
            );

            await pool.request()
                .input('ID', sql.Int, cl.CodCliente)
                .query("UPDATE Clientes SET WebLastLogin = GETDATE(), WebActive = 1 WHERE CodCliente = @ID");

            return res.json({
                success: true,
                userType: 'CLIENT',
                redirectUrl: '/portal',
                user: {
                    id: cl.CodCliente,
                    userId: cl.CodCliente,
                    email: cl.Email,
                    name: cl.Nombre,
                    company: cl.NombreFantasia,
                    role: 'WEB_CLIENT',
                    idRol: 99,
                    codCliente: cl.CodCliente,
                    token: token
                },
                token: token
            });
        }

        // No encontrado
        res.status(401).json({
            success: false,
            message: `No se encontró un cliente registrado con el email ${googleEmail}`
        });

    } catch (err) {
        console.error('[GOOGLE LOGIN ERROR]', err);
        res.status(500).json({ success: false, message: 'Error al verificar cuenta de Google.' });
    }
};

// =====================================================================
// 2. REGISTER (NUEVO)
// =====================================================================
exports.register = async (req, res) => {
    const { name, email, password } = req.body;

    // Validación básica
    if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios.' });
    }

    try {
        const pool = await getPool();

        // 1. Verificar si el usuario ya existe
        const check = await pool.request()
            .input('Email', sql.NVarChar, email)
            .query("SELECT COUNT(*) as count FROM Usuarios WHERE Usuario = @Email"); // Asumimos Usuario = Email para clientes

        if (check.recordset[0].count > 0) {
            return res.status(400).json({ success: false, message: 'El correo electrónico ya está registrado.' });
        }

        // 2. Insertar Usuario
        // NOTA: Ajusta los campos según tu tabla de Usuarios real. 
        // Asumimos estructura estándar o procedure si existiera.
        // Usamos una consulta directa por ahora para asegurar funcionamiento básico.

        const result = await pool.request()
            .input('Nombre', sql.NVarChar, name)
            .input('Username', sql.NVarChar, email) // Username es el Email
            .input('PasswordHash', sql.NVarChar, password) // ¡EN PRODUCCION USAR BCRYPT! Aquí guardamos texto plano por compatibilidad con tu login actual
            .input('Role', sql.Int, 2) // Asumimos ID 2 = Cliente (Ajustar según tabla Roles)
            .query(`
                INSERT INTO Usuarios (Nombre, Usuario, PasswordHash, IdRol, Activo, FechaCreacion)
                OUTPUT INSERTED.UserID
                VALUES (@Nombre, @Username, @PasswordHash, @Role, 1, GETDATE())
            `);

        const newUserId = result.recordset[0].UserID;

        // 3. Auto-Login (Generar Token)
        const token = jwt.sign(
            {
                id: newUserId,
                username: email,
                role: 'Cliente', // Hardcoded por ahora
                idRol: 2
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            user: {
                userId: newUserId,
                username: email,
                role: 'Cliente',
                name: name
            },
            token: token
        });

    } catch (err) {
        console.error('[REGISTER ERROR]', err);
        res.status(500).json({ success: false, message: 'Error al registrar usuario.', error: err.message });
    }
};

// =====================================================================
// 3. ME (Session Check)
// =====================================================================
exports.me = async (req, res) => {
    // El middleware 'verifyToken' ya decodificó el token en req.user
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'No autorizado' });
    }

    try {
        // Opcional: Refrescar datos desde DB para asegurar que sigue activo
        const pool = await getPool();
        const result = await pool.request()
            .input('ID', sql.Int, req.user.id)
            .query("SELECT UserID, Username, Nombre, IdRol, AreaUsuario FROM Usuarios WHERE UserID = @ID"); // Added AreaUsuario

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
        }

        const user = result.recordset[0];

        res.json({
            success: true,
            user: {
                userId: user.UserID,
                username: user.Username,
                name: user.Nombre,
                role: req.user.role, // Del token, o recalcular si IdRol cambio? Mejor dejar token por ahora.
                idRol: user.IdRol,
                area: user.AreaUsuario,
                areaKey: user.AreaUsuario
            }
        });
    } catch (err) {
        // Fallback si falla DB pero token es válido (usar datos del token)
        res.json({
            success: true,
            user: {
                userId: req.user.id,
                username: req.user.username,
                role: req.user.role
            }
        });
    }
};