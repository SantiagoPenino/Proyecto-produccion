const express = require('express');
const router = express.Router();
const prendasOrdersController = require('../controllers/prendasOrdersController');
const { verifyToken } = require('../middleware/authMiddleware');
const { impersonarClienteInterno } = require('../middleware/impersonarClienteInterno');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  RUTA NUEVA — PRODUCTOS TERMINADOS / PRENDAS (alta interna)
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  Camino PARALELO y AISLADO. No comparte código con /api/web-orders.
 *  Nada de lo que se toque acá puede afectar a DTF, Sublimación,
 *  Impresión Directa, TPU ni ECOUV: esos siguen entrando por
 *  POST /api/web-orders/create → webOrdersController.createWebOrder,
 *  que queda intacto.
 *
 *  Diferencias con el camino del portal:
 *    - Entra por el menú interno, no por el portal del cliente.
 *    - El cliente lo elige el vendedor (header X-Cliente-CodCliente),
 *      validado por impersonarClienteInterno (userType === 'INTERNAL').
 *    - El orden de los pasos lo arma el vendedor; no sale de
 *      ConfigMapeoERP.Numero.
 *
 *  Estado: copia fiel de webOrdersController al 16-07-2026. Todavía sin
 *  modificar — se va podando y adaptando de a poco.
 */

// POST /api/prendas-orders/create
router.post('/create', verifyToken, impersonarClienteInterno, prendasOrdersController.createWebOrder);

// GET /api/prendas-orders/productos-terminados
// Los artículos de Articulos cuyo CodStock cae en una variante de StockArt marcada
// TipoStock = 'PRODUCTO_TERMINADO'. Sin filtro de área a propósito: las prendas no
// pertenecen a un área de impresión (a diferencia de /nomenclators/materiales-por-tipo,
// que filtra por StockArt.Grupo -> ConfigMapeoERP.AreaID_Interno).
//
// Si TipoStock todavía no existe en la base, cae al fallback y devuelve lista vacía
// en vez de romper (lección del incidente del 13/07).
router.get('/productos-terminados', verifyToken, async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT
                a.ProIdProducto,
                LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo,
                LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
                LTRIM(RTRIM(a.CodStock))    AS CodStock,
                LTRIM(RTRIM(sa.Articulo))   AS Categoria,
                a.MonIdMoneda,
                pb.Precio,
                ISNULL(vc.CantidadVariantes, 0) AS CantidadVariantes
            FROM dbo.Articulos a
            INNER JOIN dbo.StockArt sa
                ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
            LEFT JOIN dbo.PreciosBase pb ON pb.ProIdProducto = a.ProIdProducto
            LEFT JOIN (
                SELECT Idproid, COUNT(*) AS CantidadVariantes
                FROM dbo.Articulos_WMS_Variantes GROUP BY Idproid
            ) vc ON vc.Idproid = a.ProIdProducto
            WHERE ISNULL(sa.TipoStock, 'MATERIAL') = 'PRODUCTO_TERMINADO'
              AND ISNULL(a.borrar, 0) = 0
              AND ISNULL(a.Mostrar, 1) = 1
            ORDER BY Categoria, Descripcion
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.warn(`[Prendas] productos-terminados: ${e.message}`);
        res.json({ success: true, data: [], warning: e.message });
    }
});

// GET /api/prendas-orders/ping — smoke test: confirma que la ruta está montada y aislada.
router.get('/ping', (req, res) => res.json({
    ok: true,
    ruta: 'prendas-orders',
    nota: 'camino aislado; no afecta /api/web-orders'
}));

module.exports = router;
