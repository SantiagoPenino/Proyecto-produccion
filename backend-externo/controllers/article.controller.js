// backend-externo/controllers/article.controller.js

const articleService = require('../service/article.service'); 

/**
 * @route GET /api/articulos
 */
const getAllArticulos = async (req, res) => {
    try {
        // Usa el filtro por query parameter 'familia'
        const familia = req.query.familia; 

        let articulos;

        if (familia) {
            articulos = await articleService.getArticlesByFamily(familia);
        } else {
            articulos = await articleService.getAllArticles();
        }

        if (!articulos || articulos.length === 0) {
            return res.status(404).json({ message: "No se encontraron artículos." });
        }

        res.status(200).json(articulos);
    } catch (error) {
        console.error("❌ Error en el controlador getAllArticulos:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
};

/**
 * @route GET /api/articulos/familias
 */
const getSuperFamilias = async (req, res) => {
    try {
        const familias = await articleService.getUniqueFamilies();
        
        if (!familias || familias.length === 0) {
            return res.status(404).json({ message: "No se encontraron Super Familias." });
        }

        // Devolvemos la lista de strings (códigos de familia)
        res.status(200).json(familias);
    } catch (error) {
        console.error("❌ Error en el controlador getSuperFamilias:", error);
        res.status(500).json({ message: "Error interno del servidor." });
    }
};

// Exportamos las funciones como propiedades de un objeto
module.exports = { 
    getAllArticulos,
    getSuperFamilias 
};