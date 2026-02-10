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
        const result = await pool.request()
            .input('Username', sql.NVarChar, username)
            // .input('Password', sql.NVarChar, password) // Si el SP valida password internamente
            .execute('sp_AutenticarUsuario');

        if (result.recordset.length > 0) {
            const user = result.recordset[0];

            // Validación manual de contraseña si el SP retorna el hash (como vimos antes)
            if (user.PasswordHash && password !== user.PasswordHash) {
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
            } catch (logErr) {
                console.warn("Error logging login action:", logErr.message);
            }

            // GENERATE REAL JWT
            const token = jwt.sign(
                {
                    id: user.UserID,
                    username: user.Username,
                    role: user.RoleName,
                    idRol: user.IdRol,
                    areaKey: user.AreaUsuario || user.AreaID
                },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                user: {
                    userId: user.UserID,
                    username: user.Username,
                    role: user.RoleName,
                    idRol: user.IdRol,
                    area: user.AreaUsuario,
                    avatar: user.Avatar || null // Agregamos avatar si existe
                },
                token: token
            });
        } else {
            res.status(401).json({ success: false, message: 'Credenciales inválidas o usuario inactivo.' });
        }
    } catch (err) {
        console.error('[LOGIN ERROR] SQL Error:', err);
        res.status(500).send({ message: err.message });
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
            .query("SELECT UserID, Username, Nombre, IdRol FROM Usuarios WHERE UserID = @ID");

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
                role: req.user.role, // Del token
                idRol: user.IdRol
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