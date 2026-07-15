const express = require('express');
const router = express.Router();
const { sql, getPool } = require('../config/db');

// Get All Departments
router.get('/departments', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM Departamentos ORDER BY Nombre");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Localities by Department ID
router.get('/localities/:id', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Id', sql.Int, req.params.id)
            .query("SELECT * FROM Localidades WHERE DepartamentoID = @Id ORDER BY Nombre");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Localities (All - para el abm)
router.get('/localities', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT l.ID, l.Nombre, l.DepartamentoID, d.Nombre as DepartamentoNombre FROM Localidades l JOIN Departamentos d ON l.DepartamentoID = d.ID ORDER BY d.Nombre, l.Nombre");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/localities', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Nombre', sql.NVarChar, req.body.nombre)
            .input('DepId', sql.Int, req.body.departamentoId)
            .query("INSERT INTO Localidades (Nombre, DepartamentoID) VALUES (@Nombre, @DepId); SELECT SCOPE_IDENTITY() AS ID");
        res.json({ success: true, id: r.recordset[0].ID });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/localities/:id', async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('Id', sql.Int, req.params.id)
            .input('Nombre', sql.NVarChar, req.body.nombre)
            .input('DepId', sql.Int, req.body.departamentoId)
            .query("UPDATE Localidades SET Nombre = @Nombre, DepartamentoID = @DepId WHERE ID = @Id");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/localities/:id', async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('Id', sql.Int, req.params.id)
            .query("DELETE FROM Localidades WHERE ID = @Id");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Agencies
router.get('/agencies', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM Agencias ORDER BY Nombre");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ABM Agencias
router.post('/agencies', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Nombre', sql.NVarChar, req.body.nombre)
            .query("INSERT INTO Agencias (Nombre) VALUES (@Nombre); SELECT SCOPE_IDENTITY() AS ID");
        res.json({ success: true, id: r.recordset[0].ID });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/agencies/:id', async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('Id', sql.Int, req.params.id)
            .input('Nombre', sql.NVarChar, req.body.nombre)
            .query("UPDATE Agencias SET Nombre = @Nombre WHERE ID = @Id");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/agencies/:id', async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('Id', sql.Int, req.params.id)
            .query("DELETE FROM Agencias WHERE ID = @Id");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Shipping Methods
router.get('/shipping-methods', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM FormasEnvio ORDER BY Nombre");
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Priorities
router.get('/priorities', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM ConfigPrioridades WHERE Activo = 1 ORDER BY Nivel ASC");

        // Áreas con urgencia activa (misma regla que el motor de precios): el portal
        // la usa para ocultar el botón "Urgente" en los servicios que no la tienen.
        // Si falla, se omite el campo y el front muestra todas las prioridades (fail-open).
        let areasConUrgencia;
        try {
            const { getAreasConUrgencia } = require('../utils/urgenciaAreas');
            areasConUrgencia = [...await getAreasConUrgencia(pool)];
        } catch (_) { areasConUrgencia = undefined; }

        res.json({ success: true, data: r.recordset, areasConUrgencia });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Variants (Sub-Categoría) by AreaID
router.get('/variants/:areaId', async (req, res) => {
    try {
        const { areaId } = req.params;
        const pool = await getPool();

        let r;
        try {
            r = await pool.request()
                .input('AreaID', sql.VarChar, areaId)
                .query(`
                    SELECT DISTINCT LTRIM(RTRIM(dbo.StockArt.Articulo)) AS Variante,
                           ISNULL(dbo.StockArt.TipoStock, 'MATERIAL') AS TipoStock,
                           LTRIM(RTRIM(dbo.StockArt.UM)) AS UM
                    FROM dbo.ConfigMapeoERP
                    INNER JOIN dbo.StockArt ON dbo.ConfigMapeoERP.CodigoERP = dbo.StockArt.Grupo
                    WHERE dbo.ConfigMapeoERP.AreaID_Interno = @AreaID
                      AND ISNULL(dbo.StockArt.mostrar, 1) = 1
                    ORDER BY Variante
                `);
        } catch (eCol) {
            // Base sin la migración ECOUV (columna TipoStock inexistente): fallback legacy
            // para NO romper las variantes de las demás áreas (DTF, SB, EMB...).
            r = await pool.request()
                .input('AreaID', sql.VarChar, areaId)
                .query(`
                    SELECT DISTINCT LTRIM(RTRIM(dbo.StockArt.Articulo)) AS Variante
                    FROM dbo.ConfigMapeoERP
                    INNER JOIN dbo.StockArt ON dbo.ConfigMapeoERP.CodigoERP = dbo.StockArt.Grupo
                    WHERE dbo.ConfigMapeoERP.AreaID_Interno = @AreaID
                      AND ISNULL(dbo.StockArt.mostrar, 1) = 1
                    ORDER BY Variante
                `);
        }

        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Materiales por TIPO de variante (form ECOUV con variantes virtuales):
// ?tipo=MATERIAL|PRODUCTO_TERMINADO  ·  ?conTerminaciones=1 → solo materiales
// con terminaciones asignadas (variante "Productos Personalizados / Armar a Medida")
router.get('/materiales-por-tipo/:areaId', async (req, res) => {
    try {
        const { areaId } = req.params;
        const tipo = ['MATERIAL', 'PRODUCTO_TERMINADO', 'TERMINACION'].includes(req.query.tipo) ? req.query.tipo : 'MATERIAL';
        const soloConTerminaciones = req.query.conTerminaciones === '1';
        const pool = await getPool();

        const r = await pool.request()
            .input('AreaID', sql.VarChar, areaId)
            .input('Tipo', sql.VarChar, tipo)
            .query(`
                SELECT
                    dbo.articulos.CodArticulo,
                    dbo.articulos.CodStock,
                    dbo.articulos.Descripcion AS Material,
                    dbo.articulos.anchoimprimible AS Ancho,
                    -- Clasificación física de StockArt (Lonas/Canvas/Vinilos/Cuadros...):
                    -- el form la usa como filtro "Categoría"
                    (SELECT TOP 1 LTRIM(RTRIM(S2.Articulo)) FROM dbo.StockArt S2
                     WHERE LTRIM(RTRIM(S2.CodStock)) = LTRIM(RTRIM(dbo.articulos.CodStock))) AS Categoria
                FROM dbo.articulos
                WHERE LTRIM(RTRIM(dbo.articulos.CodStock)) IN (
                    SELECT LTRIM(RTRIM(S.CodStock))
                    FROM dbo.StockArt S
                    INNER JOIN dbo.ConfigMapeoERP C ON C.CodigoERP = S.Grupo
                    WHERE C.AreaID_Interno = @AreaID
                      AND ISNULL(S.TipoStock, 'MATERIAL') = @Tipo
                      AND ISNULL(S.mostrar, 1) = 1
                )
                AND ISNULL(dbo.articulos.mostrar, 1) = 1
                ${soloConTerminaciones ? `AND EXISTS (
                    SELECT 1 FROM MaterialTerminaciones MT
                    INNER JOIN Terminaciones T ON T.TerminacionID = MT.TerminacionID AND T.Activo = 1
                    WHERE MT.CodArticulo = LTRIM(RTRIM(dbo.articulos.CodArticulo))
                )` : ''}
                ORDER BY Categoria, dbo.articulos.Descripcion
            `);

        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Terminaciones permitidas para un material de impresión (form ECOUV del portal)
router.get('/terminaciones-material/:codArticulo', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Art', sql.VarChar, req.params.codArticulo)
            .query(`
                SELECT T.TerminacionID, T.Nombre, T.UnidadCobro
                FROM MaterialTerminaciones MT
                INNER JOIN Terminaciones T ON T.TerminacionID = MT.TerminacionID
                WHERE LTRIM(RTRIM(MT.CodArticulo)) = LTRIM(RTRIM(@Art)) AND T.Activo = 1
                ORDER BY T.Nombre
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ficha de producto terminado para el form del portal (dimensiones + material + incluidas)
router.get('/producto-terminado/:codArticulo', async (req, res) => {
    try {
        const pool = await getPool();
        const prod = await pool.request()
            .input('Art', sql.VarChar, req.params.codArticulo)
            .query(`
                SELECT P.ID, P.AnchoM, P.AltoM, LTRIM(RTRIM(P.MaterialCodArticulo)) AS MaterialCodArticulo,
                       LTRIM(RTRIM(P.Tinta)) AS Tinta,
                       M.Descripcion AS MaterialDescripcion
                FROM ProductosTerminados P
                OUTER APPLY (
                    SELECT TOP 1 LTRIM(RTRIM(A.Descripcion)) AS Descripcion
                    FROM articulos A WHERE LTRIM(RTRIM(A.CodArticulo)) = LTRIM(RTRIM(P.MaterialCodArticulo))
                ) M
                WHERE LTRIM(RTRIM(P.CodArticulo)) = LTRIM(RTRIM(@Art)) AND P.Activo = 1
            `);
        if (prod.recordset.length === 0) return res.json({ success: true, data: null });
        const p = prod.recordset[0];
        const terms = await pool.request()
            .input('PID', sql.Int, p.ID)
            .query(`
                SELECT PT.TerminacionID, PT.Cantidad, T.Nombre, T.UnidadCobro
                FROM ProductoTerminadoTerminaciones PT
                INNER JOIN Terminaciones T ON T.TerminacionID = PT.TerminacionID
                WHERE PT.ProductoID = @PID
            `);
        res.json({
            success: true,
            data: {
                anchoM: p.AnchoM, altoM: p.AltoM,
                materialCodArticulo: p.MaterialCodArticulo || null,
                materialDescripcion: p.MaterialDescripcion || null,
                tinta: p.Tinta || null,
                terminacionesIncluidas: terms.recordset
            }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Materials (Soporte) dependent on Area and Selected Variant
router.get('/materials/:areaId/:variante', async (req, res) => {
    try {
        const { areaId, variante } = req.params;
        const pool = await getPool();

        const r = await pool.request()
            .input('AreaID', sql.VarChar, areaId)
            .input('Variante', sql.NVarChar, variante)
            .query(`
                SELECT
                    dbo.articulos.CodArticulo,
                    dbo.articulos.CodStock,
                    dbo.articulos.Descripcion AS Material,
                    dbo.articulos.anchoimprimible AS Ancho,
                    -- Largo imprimible: si está definido (>0), el material se imprime a MEDIDA FIJA
                    -- (banderas): el form valida que el archivo mida exactamente Ancho x Largo.
                    dbo.articulos.largoimprimible AS Largo
                FROM dbo.StockArt
                INNER JOIN dbo.articulos ON dbo.StockArt.CodStock = dbo.articulos.CodStock
                LEFT JOIN dbo.ConfigMapeoERP ON dbo.ConfigMapeoERP.CodigoERP = dbo.StockArt.Grupo
                WHERE 
                  (
                    -- Case 1: Search by Name and Area (Standard)
                    (dbo.ConfigMapeoERP.AreaID_Interno = @AreaID AND LTRIM(RTRIM(dbo.StockArt.Articulo)) = LTRIM(RTRIM(@Variante)))
                    OR
                    -- Case 2: Search by Code (Direct, ignores Area/Group mismatch if Code is specific)
                    (LTRIM(RTRIM(dbo.StockArt.CodStock)) = LTRIM(RTRIM(@Variante)))
                  )
                  AND ISNULL(dbo.StockArt.mostrar, 1) = 1
                  AND ISNULL(dbo.articulos.mostrar, 1) = 1
                ORDER BY dbo.articulos.Descripcion
            `);

        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get All Articles for Combobox
router.get('/all-articles', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT TOP 2000 
                CodArticulo, 
                Descripcion 
            FROM dbo.articulos
            WHERE ISNULL(mostrar, 1) = 1
            ORDER BY Descripcion
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Articles by Area
router.get('/articles-by-area/:areaId', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('AreaID', sql.VarChar, req.params.areaId)
            .query(`
                SELECT 
                    a.CodArticulo, 
                    a.Descripcion 
                FROM dbo.articulos a
                INNER JOIN dbo.ConfigMapeoERP c ON a.Grupo = c.CodigoERP COLLATE Database_Default
                WHERE c.AreaID_Interno = @AreaID
                ORDER BY a.Descripcion
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get Vendedores by Department Zone
router.get('/vendedores-by-department/:departamentoId', async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('DepID', sql.Int, req.params.departamentoId)
            .query(`
                SELECT t.ID, t.Nombre, t.Cedula
                FROM dbo.Trabajadores t
                INNER JOIN dbo.Departamentos d ON t.Zona = d.Zona
                WHERE d.ID = @DepID AND t.[Área] = 'Ventas'
                ORDER BY t.Nombre
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
