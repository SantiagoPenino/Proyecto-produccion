const { sql, getPool } = require('../config/db');

// Login
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-macrosoft-production';

exports.login = async (req, res) => {
    const { username, password } = req.body;
    console.log(`[LOGIN ATTEMPT] Username: ${username}, Password provided: ${password ? 'YES' : 'NO'}`);

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('Username', sql.NVarChar, username)
            .execute('sp_AutenticarUsuario');

        if (result.recordset.length > 0) {
            const user = result.recordset[0];

            if (password !== user.PasswordHash) {
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
                    area: user.AreaUsuario
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