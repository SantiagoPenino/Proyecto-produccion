const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Obtener Horario Laboral (todas las áreas, o filtrado por ?area=)
exports.getAll = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();
        const request = pool.request();
        // HoraInicio/HoraFin son TIME: el driver los devuelve como Date anclado a 1970-01-01,
        // que al serializar a JSON se vuelve un ISO string y confunde al front. Se convierten
        // acá a 'HH:MM' de una vez.
        let query = `SELECT HorarioID, AreaID, DiaSemana, Turno,
                             CONVERT(VARCHAR(5), HoraInicio, 108) AS HoraInicio,
                             CONVERT(VARCHAR(5), HoraFin, 108) AS HoraFin,
                             Activo
                      FROM dbo.ConfigHorarioLaboral`;
        if (area) {
            request.input('AreaID', sql.VarChar(20), area);
            query += " WHERE AreaID = @AreaID";
        }
        query += " ORDER BY AreaID ASC, DiaSemana ASC, HoraInicio ASC";
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (err) {
        logger.error("Error getting horario laboral:", err);
        res.status(500).json({ error: err.message });
    }
};

// Crear fila de Horario Laboral
// DiaSemana es ISO: 1=Lunes ... 7=Domingo (igual que usa sp_CalcularFechaEntrega).
exports.create = async (req, res) => {
    const { areaID, diaSemana, turno, horaInicio, horaFin } = req.body;
    try {
        if (!areaID || !diaSemana || !horaInicio || !horaFin) {
            return res.status(400).json({ error: "Área, Día, Hora Inicio y Hora Fin son obligatorios." });
        }

        const pool = await getPool();
        await pool.request()
            .input('AreaID', sql.VarChar(20), areaID)
            .input('DiaSemana', sql.TinyInt, diaSemana)
            .input('Turno', sql.VarChar(20), (turno && turno.trim()) ? turno.trim() : null)
            .input('HoraInicio', sql.VarChar(10), horaInicio)
            .input('HoraFin', sql.VarChar(10), horaFin)
            .query(`INSERT INTO dbo.ConfigHorarioLaboral (AreaID, DiaSemana, Turno, HoraInicio, HoraFin, Activo)
                    VALUES (@AreaID, @DiaSemana, @Turno, @HoraInicio, @HoraFin, 1)`);

        res.json({ success: true, message: 'Horario creado' });
    } catch (err) {
        logger.error("Error creating horario laboral:", err);
        res.status(500).json({ error: err.message });
    }
};

// Actualizar fila de Horario Laboral
exports.update = async (req, res) => {
    const { id } = req.params;
    const { areaID, diaSemana, turno, horaInicio, horaFin, activo } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, id)
            .input('AreaID', sql.VarChar(20), areaID)
            .input('DiaSemana', sql.TinyInt, diaSemana)
            .input('Turno', sql.VarChar(20), (turno && turno.trim()) ? turno.trim() : null)
            .input('HoraInicio', sql.VarChar(10), horaInicio)
            .input('HoraFin', sql.VarChar(10), horaFin)
            .input('Activo', sql.Bit, activo === undefined ? 1 : (activo ? 1 : 0))
            .query(`UPDATE dbo.ConfigHorarioLaboral
                    SET AreaID = @AreaID, DiaSemana = @DiaSemana, Turno = @Turno,
                        HoraInicio = @HoraInicio, HoraFin = @HoraFin, Activo = @Activo
                    WHERE HorarioID = @ID`);

        res.json({ success: true, message: 'Horario actualizado' });
    } catch (err) {
        logger.error("Error updating horario laboral:", err);
        res.status(500).json({ error: err.message });
    }
};

// Eliminar fila de Horario Laboral
exports.remove = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, id)
            .query("DELETE FROM dbo.ConfigHorarioLaboral WHERE HorarioID = @ID");

        res.json({ success: true, message: 'Horario eliminado' });
    } catch (err) {
        logger.error("Error deleting horario laboral:", err);
        res.status(500).json({ error: err.message });
    }
};
