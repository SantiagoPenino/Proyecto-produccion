const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const crypto = require('../services/cryptoService');

// Todas las columnas EXCEPTO EmpSisnetPass (nunca se devuelve)
const COLUMNAS_PUBLICAS = `
    EmpIdEmpresa, EmpRuc, EmpRazonSocial, EmpNombreFantasia, EmpSlogan,
    EmpDireccion, EmpCiudad, EmpDepartamento, EmpPais, EmpTelefono, EmpEmail,
    EmpWeb, EmpLogoUrl, EmpColorPrimario, EmpSisnetWsdlUrl, EmpSisnetUser,
    EmpSisnetCaja, EmpSisnetTasaBasica, EmpSisnetTasaMinima, EmpActiva,
    EmpPorDefecto, EmpFechaAlta
`;

exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        const soloActivas = req.query.soloActivas === '1' || req.query.soloActivas === 'true';

        let query = `SELECT ${COLUMNAS_PUBLICAS} FROM dbo.Empresas`;
        if (soloActivas) {
            query += ' WHERE EmpActiva = 1';
        }
        query += ' ORDER BY EmpIdEmpresa';

        const result = await pool.request().query(query);
        res.json(result.recordset);
    } catch (error) {
        logger.error("Error listando empresas:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.obtener = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: "Se requiere el id de la empresa." });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('Id', sql.Int, id)
            .query(`SELECT ${COLUMNAS_PUBLICAS} FROM dbo.Empresas WHERE EmpIdEmpresa = @Id`);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: "Empresa no encontrada." });
        }

        res.json(result.recordset[0]);
    } catch (error) {
        logger.error("Error obteniendo empresa:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.crear = async (req, res) => {
    try {
        const {
            EmpRuc, EmpRazonSocial, EmpNombreFantasia, EmpSlogan, EmpDireccion,
            EmpCiudad, EmpDepartamento, EmpPais, EmpTelefono, EmpEmail, EmpWeb,
            EmpLogoUrl, EmpColorPrimario, EmpSisnetWsdlUrl, EmpSisnetUser,
            EmpSisnetPass, EmpSisnetCaja, EmpSisnetTasaBasica, EmpSisnetTasaMinima,
            EmpActiva, EmpPorDefecto
        } = req.body;

        if (!EmpRuc || !EmpRazonSocial) {
            return res.status(400).json({ error: "Faltan datos. Se requiere EmpRuc y EmpRazonSocial." });
        }

        // Encriptar la clave solo si viene un string no vacío; caso contrario NULL
        const passEncriptada = (typeof EmpSisnetPass === 'string' && EmpSisnetPass.trim() !== '')
            ? crypto.encrypt(EmpSisnetPass)
            : null;

        const pool = await getPool();
        const result = await pool.request()
            .input('EmpRuc', sql.VarChar, EmpRuc)
            .input('EmpRazonSocial', sql.NVarChar, EmpRazonSocial)
            .input('EmpNombreFantasia', sql.NVarChar, EmpNombreFantasia || null)
            .input('EmpSlogan', sql.NVarChar, EmpSlogan || null)
            .input('EmpDireccion', sql.NVarChar, EmpDireccion || null)
            .input('EmpCiudad', sql.NVarChar, EmpCiudad || null)
            .input('EmpDepartamento', sql.NVarChar, EmpDepartamento || null)
            .input('EmpPais', sql.NVarChar, EmpPais || null)
            .input('EmpTelefono', sql.VarChar, EmpTelefono || null)
            .input('EmpEmail', sql.VarChar, EmpEmail || null)
            .input('EmpWeb', sql.VarChar, EmpWeb || null)
            .input('EmpLogoUrl', sql.VarChar, EmpLogoUrl || null)
            .input('EmpColorPrimario', sql.VarChar, EmpColorPrimario || null)
            .input('EmpSisnetWsdlUrl', sql.VarChar, EmpSisnetWsdlUrl || null)
            .input('EmpSisnetUser', sql.VarChar, EmpSisnetUser || null)
            .input('EmpSisnetPass', sql.VarChar, passEncriptada)
            .input('EmpSisnetCaja', sql.VarChar, EmpSisnetCaja || null)
            .input('EmpSisnetTasaBasica', sql.VarChar, EmpSisnetTasaBasica || null)
            .input('EmpSisnetTasaMinima', sql.VarChar, EmpSisnetTasaMinima || null)
            .input('EmpActiva', sql.Bit, typeof EmpActiva === 'boolean' ? (EmpActiva ? 1 : 0) : 1)
            .input('EmpPorDefecto', sql.Bit, EmpPorDefecto ? 1 : 0)
            .query(`
                INSERT INTO dbo.Empresas (
                    EmpRuc, EmpRazonSocial, EmpNombreFantasia, EmpSlogan, EmpDireccion,
                    EmpCiudad, EmpDepartamento, EmpPais, EmpTelefono, EmpEmail, EmpWeb,
                    EmpLogoUrl, EmpColorPrimario, EmpSisnetWsdlUrl, EmpSisnetUser,
                    EmpSisnetPass, EmpSisnetCaja, EmpSisnetTasaBasica, EmpSisnetTasaMinima,
                    EmpActiva, EmpPorDefecto, EmpFechaAlta
                )
                OUTPUT INSERTED.EmpIdEmpresa
                VALUES (
                    @EmpRuc, @EmpRazonSocial, @EmpNombreFantasia, @EmpSlogan, @EmpDireccion,
                    @EmpCiudad, @EmpDepartamento, @EmpPais, @EmpTelefono, @EmpEmail, @EmpWeb,
                    @EmpLogoUrl, @EmpColorPrimario, @EmpSisnetWsdlUrl, @EmpSisnetUser,
                    @EmpSisnetPass, @EmpSisnetCaja, @EmpSisnetTasaBasica, @EmpSisnetTasaMinima,
                    @EmpActiva, @EmpPorDefecto, GETDATE()
                )
            `);

        const nuevoId = result.recordset[0].EmpIdEmpresa;
        res.status(201).json({ success: true, EmpIdEmpresa: nuevoId });
    } catch (error) {
        logger.error("Error creando empresa:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.actualizar = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: "Se requiere el id de la empresa." });
        }

        const {
            EmpRuc, EmpRazonSocial, EmpNombreFantasia, EmpSlogan, EmpDireccion,
            EmpCiudad, EmpDepartamento, EmpPais, EmpTelefono, EmpEmail, EmpWeb,
            EmpLogoUrl, EmpColorPrimario, EmpSisnetWsdlUrl, EmpSisnetUser,
            EmpSisnetPass, EmpSisnetCaja, EmpSisnetTasaBasica, EmpSisnetTasaMinima,
            EmpActiva, EmpPorDefecto
        } = req.body;

        if (!EmpRuc || !EmpRazonSocial) {
            return res.status(400).json({ error: "Faltan datos. Se requiere EmpRuc y EmpRazonSocial." });
        }

        // Re-encriptar la clave SOLO si viene un string no vacío; si no, no se toca la existente
        const actualizarPass = (typeof EmpSisnetPass === 'string' && EmpSisnetPass.trim() !== '');

        const pool = await getPool();
        const request = pool.request()
            .input('Id', sql.Int, id)
            .input('EmpRuc', sql.VarChar, EmpRuc)
            .input('EmpRazonSocial', sql.NVarChar, EmpRazonSocial)
            .input('EmpNombreFantasia', sql.NVarChar, EmpNombreFantasia || null)
            .input('EmpSlogan', sql.NVarChar, EmpSlogan || null)
            .input('EmpDireccion', sql.NVarChar, EmpDireccion || null)
            .input('EmpCiudad', sql.NVarChar, EmpCiudad || null)
            .input('EmpDepartamento', sql.NVarChar, EmpDepartamento || null)
            .input('EmpPais', sql.NVarChar, EmpPais || null)
            .input('EmpTelefono', sql.VarChar, EmpTelefono || null)
            .input('EmpEmail', sql.VarChar, EmpEmail || null)
            .input('EmpWeb', sql.VarChar, EmpWeb || null)
            .input('EmpLogoUrl', sql.VarChar, EmpLogoUrl || null)
            .input('EmpColorPrimario', sql.VarChar, EmpColorPrimario || null)
            .input('EmpSisnetWsdlUrl', sql.VarChar, EmpSisnetWsdlUrl || null)
            .input('EmpSisnetUser', sql.VarChar, EmpSisnetUser || null)
            .input('EmpSisnetCaja', sql.VarChar, EmpSisnetCaja || null)
            .input('EmpSisnetTasaBasica', sql.VarChar, EmpSisnetTasaBasica || null)
            .input('EmpSisnetTasaMinima', sql.VarChar, EmpSisnetTasaMinima || null)
            .input('EmpActiva', sql.Bit, typeof EmpActiva === 'boolean' ? (EmpActiva ? 1 : 0) : 1)
            .input('EmpPorDefecto', sql.Bit, EmpPorDefecto ? 1 : 0);

        let setPass = '';
        if (actualizarPass) {
            request.input('EmpSisnetPass', sql.VarChar, crypto.encrypt(EmpSisnetPass));
            setPass = 'EmpSisnetPass = @EmpSisnetPass,';
        }

        const result = await request.query(`
            UPDATE dbo.Empresas SET
                EmpRuc = @EmpRuc,
                EmpRazonSocial = @EmpRazonSocial,
                EmpNombreFantasia = @EmpNombreFantasia,
                EmpSlogan = @EmpSlogan,
                EmpDireccion = @EmpDireccion,
                EmpCiudad = @EmpCiudad,
                EmpDepartamento = @EmpDepartamento,
                EmpPais = @EmpPais,
                EmpTelefono = @EmpTelefono,
                EmpEmail = @EmpEmail,
                EmpWeb = @EmpWeb,
                EmpLogoUrl = @EmpLogoUrl,
                EmpColorPrimario = @EmpColorPrimario,
                EmpSisnetWsdlUrl = @EmpSisnetWsdlUrl,
                EmpSisnetUser = @EmpSisnetUser,
                ${setPass}
                EmpSisnetCaja = @EmpSisnetCaja,
                EmpSisnetTasaBasica = @EmpSisnetTasaBasica,
                EmpSisnetTasaMinima = @EmpSisnetTasaMinima,
                EmpActiva = @EmpActiva,
                EmpPorDefecto = @EmpPorDefecto
            WHERE EmpIdEmpresa = @Id
        `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Empresa no encontrada." });
        }

        res.json({ success: true, message: `Empresa ${id} actualizada correctamente.` });
    } catch (error) {
        logger.error("Error actualizando empresa:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.setPorDefecto = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: "Se requiere el id de la empresa." });
        }

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Primero quitar el flag por defecto actual, luego asignarlo (respeta el índice único filtrado)
            await new sql.Request(transaction)
                .query('UPDATE dbo.Empresas SET EmpPorDefecto = 0 WHERE EmpPorDefecto = 1;');

            const result = await new sql.Request(transaction)
                .input('Id', sql.Int, id)
                .query('UPDATE dbo.Empresas SET EmpPorDefecto = 1 WHERE EmpIdEmpresa = @Id;');

            if (result.rowsAffected[0] === 0) {
                await transaction.rollback();
                return res.status(404).json({ error: "Empresa no encontrada." });
            }

            await transaction.commit();
            res.json({ success: true, message: `Empresa ${id} marcada como predeterminada.` });
        } catch (txErr) {
            await transaction.rollback();
            throw txErr;
        }
    } catch (error) {
        logger.error("Error asignando empresa por defecto:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.toggleActiva = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: "Se requiere el id de la empresa." });
        }

        const pool = await getPool();
        const result = await pool.request()
            .input('Id', sql.Int, id)
            .query('UPDATE dbo.Empresas SET EmpActiva = CASE WHEN EmpActiva = 1 THEN 0 ELSE 1 END WHERE EmpIdEmpresa = @Id;');

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ error: "Empresa no encontrada." });
        }

        res.json({ success: true, message: `Estado de la empresa ${id} actualizado.` });
    } catch (error) {
        logger.error("Error cambiando estado de empresa:", error);
        res.status(500).json({ error: error.message });
    }
};
