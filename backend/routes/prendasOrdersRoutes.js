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

// [PRENDAS] "Comprar y personalizar" — retiro WMS pendiente (equivalente de
// getPendingOrders/confirmPreparation de logisticaWmsController, pero sobre Ordenes).
router.get('/retiros-wms-pendientes', verifyToken, prendasOrdersController.getRetirosWmsPendientes);
router.put('/:ordenId/iniciar-preparacion-retiro', verifyToken, prendasOrdersController.iniciarPreparacionRetiroWms);
router.put('/:ordenId/actualizar-cantidad-retiro', verifyToken, prendasOrdersController.actualizarCantidadRetiroWms);
router.put('/:ordenId/confirmar-retiro-wms', verifyToken, prendasOrdersController.confirmarRetiroWms);

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
        // [PRENDAS] Filtro opcional por categoría (StockArt.Articulo) — sin esto se ven TODOS
        // los producto-terminado (incluidos los de ECOUV: Cuadros Canvas, Roll Up, etc.), que
        // no aplican a "Fabricar a Medida". El selector de Producto a Fabricar pasa
        // ?categoria=Prendas Confeccionadas para traer solo lo suyo.
        const categoria = (req.query.categoria || '').trim();
        const request = pool.request();
        if (categoria) request.input('Cat', require('mssql').VarChar, categoria);
        const r = await request.query(`
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
              ${categoria ? 'AND LTRIM(RTRIM(sa.Articulo)) = @Cat' : ''}
            ORDER BY Categoria, Descripcion
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.warn(`[Prendas] productos-terminados: ${e.message}`);
        res.json({ success: true, data: [], warning: e.message });
    }
});

// GET /api/prendas-orders/productos-terminados/:proIdProducto/servicios
// [PRENDAS] Servicios de decoración (Bordado/DTF/TPU) incluidos por defecto en el producto —
// ver ProductoTerminadoServicios. Al elegir el producto en "Fabricar a Medida", el front
// activa estos solos y los bloquea (Obligatorio=1 = no se pueden apagar).
//
// [COMBOS] Si el producto es un combo (tiene filas en ProductoComboItems, las carga el
// Configurador), la respuesta suma esCombo:true + componentes[]: cada componente lleva sus
// PROPIOS servicios (ProductoComboItemServicios) — ej. el Gorro borda, el Short estampa.
// Toda fila de ProductoComboItemServicios se pide igual que un Obligatorio=1 (el bit
// "Incluido" es de PRECIO — si se cobra aparte o no — no decide si hace falta pedirlo).
// Mismas queries que usa configuradorController.getProductoFicha para armar comboItems +
// servicios. Sin combo, "data" sale exactamente como antes — no cambia nada para el caso simple.
router.get('/productos-terminados/:proIdProducto/servicios', verifyToken, async (req, res) => {
    try {
        const pool = await getPool();
        const proId = parseInt(req.params.proIdProducto, 10);
        const r = await pool.request()
            .input('PID', sql.Int, proId)
            .query(`SELECT AreaID, Obligatorio FROM dbo.ProductoTerminadoServicios WHERE ProIdProducto = @PID`);

        const comboItems = await pool.request()
            .input('PID', sql.Int, proId)
            .query(`
                SELECT ci.ID, ci.ItemProIdProducto, ci.WmsVarianteId, ci.Cantidad,
                       LTRIM(RTRIM(a.Descripcion)) AS ItemDescripcion
                FROM dbo.ProductoComboItems ci
                LEFT JOIN dbo.Articulos a ON a.ProIdProducto = ci.ItemProIdProducto
                WHERE ci.ProIdProducto = @PID ORDER BY ISNULL(ci.Orden, 999), ci.ID
            `);
        if (!comboItems.recordset.length) {
            return res.json({ success: true, data: r.recordset });
        }

        const comboSrv = await pool.request()
            .input('PID', sql.Int, proId)
            .query(`
                SELECT s.ComboItemID, s.AreaID, s.TecnicaOpcionID, s.Incluido,
                       LTRIM(RTRIM(t.Nombre)) AS TecnicaOpcionNombre,
                       LTRIM(RTRIM(t.CodArticulo)) AS TecnicaOpcionCodArticulo
                FROM dbo.ProductoComboItemServicios s
                INNER JOIN dbo.ProductoComboItems ci ON ci.ID = s.ComboItemID
                LEFT JOIN dbo.TecnicaOpciones t ON t.TecnicaOpcionID = s.TecnicaOpcionID
                WHERE ci.ProIdProducto = @PID
            `);

        const componentes = comboItems.recordset.map(ci => ({
            comboItemId: ci.ID,
            itemProIdProducto: ci.ItemProIdProducto,
            descripcion: ci.ItemDescripcion || `Producto ${ci.ItemProIdProducto}`,
            wmsVarianteId: ci.WmsVarianteId,
            cantidad: ci.Cantidad,
            // tecnicaOpcionId NULL = "opción libre" (el cliente/vendedor elige en el pedido);
            // con valor = técnica FIJA por el combo (se muestra como dato, no como selector).
            servicios: comboSrv.recordset
                .filter(s => s.ComboItemID === ci.ID)
                .map(s => ({ areaId: s.AreaID, tecnicaOpcionId: s.TecnicaOpcionID, tecnicaOpcionNombre: s.TecnicaOpcionNombre, tecnicaOpcionCodArticulo: s.TecnicaOpcionCodArticulo, incluido: !!s.Incluido }))
        }));

        res.json({ success: true, data: r.recordset, esCombo: true, componentes });
    } catch (e) {
        logger.warn(`[Prendas] productos-terminados/servicios: ${e.message}`);
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
