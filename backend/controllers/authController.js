const { sql, getPool } = require('../config/db');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { audit } = require('../utils/auditLogger');
const { trackLogin } = require('../utils/sessionTracker');
const { hashear, verificar } = require('../utils/password');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not defined in environment variables');

// =====================================================================
// 1. LOGIN
// =====================================================================
exports.login = async (req, res) => {
    const { username, password } = req.body;
    logger.info(`[LOGIN ATTEMPT] Username: ${username}, Password provided: ${password ? 'YES' : 'NO'}`);

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

            // Validación manual (si aplica).
            // OJO: `user.PasswordHash` es el alias que devuelve sp_AutenticarUsuario para
            // `Usuarios.ContrasenaHash` — la columna PasswordHash no existe.
            const chk = await verificar(password, user.PasswordHash);
            if (user.PasswordHash && !chk.ok) {
                // Contraseña incorrecta para usuario existente -> Fallar aquí (no probar cliente)
                // O probar cliente SOLO si el username coincide con un IDCliente
                // Por seguridad, si existe el usuario interno, asumimos que es ese
                return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
            }

            // Entró con la contraseña vieja en texto plano: se migra a bcrypt acá mismo.
            // Best-effort: si falla, el login igual es válido y se reintenta al siguiente.
            if (chk.rehash) {
                try {
                    await pool.request()
                        .input('ID', sql.Int, user.UserID)
                        .input('Hash', sql.NVarChar(255), chk.rehash)
                        .query('UPDATE dbo.Usuarios SET ContrasenaHash = @Hash WHERE IdUsuario = @ID');
                    logger.info(`[PASSWORD] Usuario ${user.Username} migrado a bcrypt.`);
                } catch (e) {
                    logger.warn(`[PASSWORD] No se pudo migrar a ${user.Username}: ${e.message}`);
                }
            }

            // Audit & session tracking
            audit('LOGIN', { user: user.Username, userId: user.UserID, ip: req.ip, type: 'INTERNAL', result: 'OK' });
            trackLogin(user.UserID, user.Username, req.ip, 'INTERNAL', true);

            // Log successful login
            try {
                await pool.request()
                    .input('UserID', sql.Int, user.UserID)
                    .input('Action', sql.NVarChar, 'LOGIN')
                    .input('Details', sql.NVarChar, 'Success')
                    .input('IPAddress', sql.NVarChar, req.ip)
                    .execute('sp_RegistrarAccion');
            } catch (logErr) { logger.warn("Error logging login:", logErr.message); }

            // GENERATE TOKEN (ADMIN)
            const token = jwt.sign(
                {
                    id: user.UserID,
                    username: user.Username,
                    name: user.Nombre,
                    role: user.RoleName,
                    idRol: user.IdRol,
                    areaKey: user.AreaUsuario || user.AreaID,
                    userType: 'INTERNAL' // Flag para distinguir
                },
                JWT_SECRET,
                { expiresIn: '30d' }
            );

            return res.json({
                success: true,
                userType: 'INTERNAL',
                redirectUrl: '/', // Admin Dashboard
                user: {
                    userId: user.UserID,
                    username: user.Username,
                    name: user.Nombre,
                    role: user.RoleName,
                    idRol: user.IdRol,
                    area: (user.AreaUsuario || '').trim(),
                    areaKey: (user.AreaUsuario || '').trim(),
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
            let rehash = null;

            // Lógica Password Cliente
            if (!client.WebPasswordHash || client.WebPasswordHash === '') {
                if (password && password.length > 0) {
                    isFirstTime = true;
                    isValid = true;
                } else {
                    return res.status(401).json({ success: false, message: 'Debe ingresar una contraseña.' });
                }
            } else {
                const chk = await verificar(password, client.WebPasswordHash);
                isValid = chk.ok;
                rehash = chk.rehash || null;
            }

            if (!isValid) {
                return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
            }

            // Verificar si el cliente está activo (después de validar contraseña).
            // WebActive = 0 NO es "esperando que alguien apruebe": es que el cliente todavía no
            // abrió el enlace del mail de registro. Decirle que contacte al administrador generaba
            // llamados por algo que resuelve solo.
            if (!client.WebActive) {
                return res.status(403).json({
                    success: false,
                    accountInactive: true,
                    message: 'Tu cuenta todavía no está activada. Buscá en tu correo el mail de activación (mirá también en spam) y abrí el enlace. Si no te llegó o venció, escribinos y te lo reenviamos.'
                });
            }

            // Update Password if first time
            if (isFirstTime) {
                await pool.request()
                    .input('ID', sql.Int, client.CodCliente)
                    .input('Pass', sql.NVarChar, await hashear(password))
                    .query("UPDATE Clientes SET WebPasswordHash = @Pass, WebResetPassword = 0 WHERE CodCliente = @ID");
                client.WebResetPassword = false;
            } else if (rehash) {
                // Entró con la contraseña vieja en texto plano: se migra a bcrypt (best-effort).
                try {
                    await pool.request()
                        .input('ID', sql.Int, client.CodCliente)
                        .input('Hash', sql.NVarChar(255), rehash)
                        .query('UPDATE dbo.Clientes SET WebPasswordHash = @Hash WHERE CodCliente = @ID');
                } catch (e) {
                    logger.warn(`[PASSWORD] No se pudo migrar al cliente ${client.CodCliente}: ${e.message}`);
                }
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

            audit('LOGIN', { user: client.IDCliente || username, userId: client.CodCliente, ip: req.ip, type: 'WEB_CLIENT', result: 'OK' });
            trackLogin(client.CodCliente, client.IDCliente || username, req.ip, 'WEB_CLIENT', true);

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
        // No match
        audit('LOGIN', { user: username, ip: req.ip, type: 'UNKNOWN', result: 'FAIL' });
        trackLogin(null, username, req.ip, 'UNKNOWN', false, 'Usuario inexistente');
        res.status(401).json({ success: false, message: 'Credenciales inválidas o usuario inexistente.' });

    } catch (err) {
        logger.error('[LOGIN ERROR] SQL Error:', err);
        audit('LOGIN', { user: username, ip: req.ip, result: 'ERROR', error: err.message });
        trackLogin(null, username, req.ip, 'ERROR', false, err.message);
        res.status(500).send({ message: err.message });
    }
};

// =====================================================================
// 1b. GOOGLE LOGIN
// =====================================================================
exports.googleLogin = async (req, res) => {
    const { credential } = req.body;

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

        logger.info(`[GOOGLE LOGIN] Email: ${googleEmail}`);

        const pool = await getPool();

        const clientResult = await pool.request()
            .input('Email', sql.NVarChar, googleEmail)
            .query(`
                SELECT CodCliente, IDCliente, Nombre, Email, NombreFantasia, WebPasswordHash, WebResetPassword, WebActive
                FROM Clientes
                WHERE LTRIM(RTRIM(Email)) = @Email
            `);

        if (clientResult.recordset.length > 0) {
            const cl = clientResult.recordset[0];

            if (!cl.WebActive) {
                return res.status(403).json({
                    success: false,
                    accountInactive: true,
                    message: 'Tu cuenta todavía no está activada. Buscá en tu correo el mail de activación (mirá también en spam) y abrí el enlace. Si no te llegó o venció, escribinos y te lo reenviamos.'
                });
            }

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
                .query("UPDATE Clientes SET WebLastLogin = GETDATE() WHERE CodCliente = @ID");

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

        res.status(401).json({
            success: false,
            notFound: true,
            email: googleEmail,
            message: `No se encontró un cliente registrado con el email ${googleEmail}. Redirigiendo a registro...`
        });

    } catch (err) {
        logger.error('[GOOGLE LOGIN ERROR]', err);
        res.status(500).json({ success: false, message: 'Error al verificar cuenta de Google.' });
    }
};

// =====================================================================
// 2. (BORRADO 10/09/2026) exports.register + POST /api/auth/register
//
// Creaba un USUARIO INTERNO (IdRol 2) desde un endpoint público sin
// autenticación, y encima nunca funcionó: insertaba en `PasswordHash` y
// devolvía `OUTPUT INSERTED.UserID`, dos columnas que no existen — las
// reales son `ContrasenaHash` e `IdUsuario`. Siempre respondía 500.
//
// El registro de clientes que SÍ se usa es webAuthController.register
// (POST /api/web-auth/register), que escribe en la tabla Clientes.
// El alta de usuarios internos es usersController.create (/admin/users).
// =====================================================================

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
