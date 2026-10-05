const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Obtener cotizaciones de la fecha actual
const getCotizacionesHoy = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 1 CotFecha, CotDolar 
      FROM Cotizaciones WITH(NOLOCK) 
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
    logger.error('Error al obtener las cotizaciones:', error);
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
        INSERT INTO Cotizaciones (CotIdCotizacion, CotFecha, CotDolar)
        VALUES ((SELECT ISNULL(MAX(CotIdCotizacion),0)+1 FROM Cotizaciones), GETDATE(), @cotizacion)
      `);

    res.status(201).json({ message: 'Cotización insertada exitosamente.' });
  } catch (error) {
    logger.error('Error al insertar la cotización:', error);
    res.status(500).json({ error: 'Hubo un error al intentar insertar la cotización.' });
  }
};

// Buscar cotización en vivo del BCU y guardarla si no existe hoy
const fetchFromBCU = async (req, res) => {
  try {
    const pool = await getPool();

    // 1. ¿Ya existe hoy?
    const check = await pool.request().query(`
      SELECT TOP 1 CotDolar FROM Cotizaciones WITH(NOLOCK)
      WHERE CONVERT(DATE, CotFecha) = CONVERT(DATE, GETDATE())
      ORDER BY CotFecha DESC
    `);
    if (check.recordset.length > 0) {
      return res.json({ cotizacion: check.recordset[0].CotDolar, source: 'db' });
    }

    // 2. Buscar del BCU
    const { fetchCotizacionBCU } = require('../jobs/cotizacionBCU.job');
    const cot = await fetchCotizacionBCU();

    // 3. Guardar venta bancaria en DB
    await pool.request()
      .input('cot', sql.Float, cot.venta)
      .query(`INSERT INTO Cotizaciones (CotIdCotizacion, CotFecha, CotDolar)
              VALUES ((SELECT ISNULL(MAX(CotIdCotizacion),0)+1 FROM Cotizaciones), GETDATE(), @cot)`);

    logger.info(`[COTIZACION] ✅ On-demand: compra=$U ${cot.compra} / venta=$U ${cot.venta}`);
    res.json({ cotizacion: cot.venta, compra: cot.compra, interbancario: cot.interbancario, source: 'bcu' });

  } catch (error) {
    logger.error('[COTIZACION] Error fetching from BCU:', error.message);
    res.status(500).json({ error: 'No se pudo obtener la cotización del BCU. Ingrese manualmente.' });
  }
};

// La última cotización cargada hasta una fecha (inclusive). "Ventas por vendedor" la usa para
// los meses cerrados: con el último día del mes da la última cotización de ese mes.
const getCotizacionHasta = async (req, res) => {
  const fecha = String(req.query.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida: tiene que ser AAAA-MM-DD.' });
  }
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('fecha', sql.VarChar(10), fecha)
      .query(`
        SELECT TOP 1 CotFecha, CotDolar
        FROM Cotizaciones WITH(NOLOCK)
        WHERE CotDolar > 0 AND CotFecha < DATEADD(DAY, 1, CAST(@fecha AS date))
        ORDER BY CotFecha DESC
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: `No hay cotizaciones hasta el ${fecha}.` });
    }

    res.status(200).json({ cotizaciones: result.recordset });
  } catch (error) {
    logger.error('Error al obtener la cotización hasta una fecha:', error);
    res.status(500).json({ error: 'Error al obtener la cotización' });
  }
};

module.exports = { getCotizacionesHoy, insertCotizacion, fetchFromBCU, getCotizacionHasta };
