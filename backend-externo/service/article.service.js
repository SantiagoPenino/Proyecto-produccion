// backend-externo/service/article.service.js

const { getPool, sql } = require('../config/db.config'); 

/**
 * Obtiene todos los artículos.
 */
const getAllArticles = async () => {
    try {
        const pool = await getPool();
        // Consulta SQL de prueba (limitada a 100 para evitar sobrecarga)
        const result = await pool.request().query('SELECT TOP 100 * FROM Articulos');
        return result.recordset;
    } catch (error) {
        console.error("Error en service/getAllArticles:", error);
        throw error;
    }
};

/**
 * Obtiene artículos filtrados por Super Familia (SupFlia).
 */
const getArticlesByFamily = async (familia) => {
    try {
        const pool = await getPool();
        // Consulta SQL parametrizada para seguridad
        const result = await pool.request()
            .input('familiaParam', sql.NVarChar, familia)
            .query('SELECT * FROM Articulos WHERE SupFlia = @familiaParam');
            
        return result.recordset;
    } catch (error) {
        console.error("Error en service/getArticlesByFamily:", error);
        throw error;
    }
};

/**
 * Obtiene una lista única de todas las Super Familias (SupFlia)
 */
const getUniqueFamilies = async () => {
    try {
        const pool = await getPool();
        // Consulta para obtener valores únicos de la columna SupFlia
        const result = await pool.request().query('SELECT DISTINCT SupFlia FROM Articulos WHERE SupFlia IS NOT NULL');
        
        // Mapeamos para devolver un array simple de strings
        return result.recordset.map(record => record.SupFlia);
    } catch (error) {
        console.error("Error en service/getUniqueFamilies:", error);
        throw error;
    }
};

module.exports = { 
    getAllArticles,
    getArticlesByFamily,
    getUniqueFamilies
};