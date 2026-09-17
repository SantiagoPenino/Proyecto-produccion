const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { hashear } = require('../utils/password');

exports.getAll = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT IdUsuario, Usuario, Email, IdRol, IdCargo, Activo, FechaCreacion, Nombre, AreaUsuario FROM Usuarios');
        res.json(result.recordset);
    } catch (err) {
        logger.error('Error getting users:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.create = async (req, res) => {
    const { Usuario, Contrasena, Email, IdRol, IdCargo, Activo, Nombre, AreaUsuario } = req.body;
    try {
        const pool = await getPool();
        // La contraseña se guarda hasheada con bcrypt (utils/password.js). El login la
        // verifica con `verificar()`, que además entiende las viejas en texto plano y las
        // migra sola al primer ingreso. Ver el plan del 10/09/2026.

        const result = await pool.request()
            .input('Usuario', sql.NVarChar, Usuario)
            .input('ContrasenaHash', sql.NVarChar, await hashear(Contrasena))
            .input('Email', sql.NVarChar, Email)
            .input('IdRol', sql.Int, IdRol)
            .input('IdCargo', sql.Int, IdCargo || null)
            .input('Activo', sql.Bit, Activo !== undefined ? Activo : true)
            .input('Nombre', sql.NVarChar, Nombre)
            .input('AreaUsuario', sql.NVarChar, AreaUsuario)
            .query(`
                INSERT INTO Usuarios (Usuario, ContrasenaHash, Email, IdRol, IdCargo, Activo, Nombre, AreaUsuario, FechaCreacion)
                OUTPUT INSERTED.IdUsuario
                VALUES (@Usuario, @ContrasenaHash, @Email, @IdRol, @IdCargo, @Activo, @Nombre, @AreaUsuario, GETDATE())
            `);

        res.json({ success: true, message: 'Usuario creado', IdUsuario: result.recordset[0].IdUsuario });
    } catch (err) {
        logger.error('Error creating user:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.update = async (req, res) => {
    const { id } = req.params;
    const { Usuario, Contrasena, Email, IdRol, IdCargo, Activo, Nombre, AreaUsuario } = req.body;
    try {
        const pool = await getPool();
        const request = pool.request()
            .input('IdUsuario', sql.Int, id)
            .input('Usuario', sql.NVarChar, Usuario)
            .input('Email', sql.NVarChar, Email)
            .input('IdRol', sql.Int, IdRol)
            .input('IdCargo', sql.Int, IdCargo || null)
            .input('Activo', sql.Bit, Activo)
            .input('Nombre', sql.NVarChar, Nombre)
            .input('AreaUsuario', sql.NVarChar, AreaUsuario);

        let query = `
            UPDATE Usuarios 
            SET Usuario = @Usuario, Email = @Email, IdRol = @IdRol, IdCargo = @IdCargo, 
                Activo = @Activo, Nombre = @Nombre, AreaUsuario = @AreaUsuario
        `;

        if (Contrasena) {
            request.input('ContrasenaHash', sql.NVarChar, await hashear(Contrasena));
            query += `, ContrasenaHash = @ContrasenaHash`;
        }

        query += ` WHERE IdUsuario = @IdUsuario`;

        await request.query(query);
        res.json({ success: true, message: 'Usuario actualizado' });
    } catch (err) {
        logger.error('Error updating user:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.delete = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('IdUsuario', sql.Int, id)
            .query('DELETE FROM Usuarios WHERE IdUsuario = @IdUsuario');
        res.json({ success: true, message: 'Usuario eliminado' });
    } catch (err) {
        logger.error('Error deleting user:', err);
        res.status(500).json({ error: err.message });
    }
};
