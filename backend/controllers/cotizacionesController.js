const { getPool, sql } = require('../config/db');

// Obtener cotizaciones de la fecha actual
const getCotizacionesHoy = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 1 CotFecha, CotDolar 
      FROM Cotizaciones WITH(NOLOCK) 
      WHERE datediff(d,CotFecha,getdate()) = 0 
      ORDER BY CotFecha DESC
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'No hay cotizaciones disponibles.' });
    }

    const cotizaciones = result.recordset;

    res.status(200).json({
      message: `Cotizaciones más recientes del ${cotizaciones[0].CotFecha}`,
      cotizaciones,
    });
  } catch (error) {
    console.error('Error al obtener las cotizaciones:', error);
    res.status(500).json({ error: 'Error al obtener las cotizaciones' });
  }
};

// Inserta cotizacion de forma manual
const insertCotizacion = async (req, res) => {
  const { cotizacion } = req.body;

  if (!cotizacion || isNaN(cotizacion)) {
    return res.status(400).json({ error: 'Por favor, proporcione una cotización válida.' });
  }

  try {
    const pool = await getPool();

    const checkCotizacion = await pool.request().query(`
      SELECT COUNT(*) AS count
      FROM Cotizaciones WITH(NOLOCK)
      WHERE CONVERT(DATE, CotFecha) = CONVERT(DATE, GETDATE())
    `);

    if (checkCotizacion.recordset[0].count > 0) {
      return res.status(400).json({ error: 'Ya existe una cotización para el día de hoy.' });
    }

    await pool.request()
      .input('cotizacion', sql.Float, cotizacion)
      .query(`
        INSERT INTO Cotizaciones (CotFecha, CotDolar)
        VALUES (GETDATE(), @cotizacion)
      `);

    res.status(201).json({ message: 'Cotización insertada exitosamente.' });
  } catch (error) {
    console.error('Error al insertar la cotización:', error);
    res.status(500).json({ error: 'Hubo un error al intentar insertar la cotización.' });
  }
};

module.exports = { getCotizacionesHoy, insertCotizacion };
