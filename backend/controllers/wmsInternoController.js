/**
 * wmsInternoController.js — API de la sección /stock (gestión del WMS PROPIO).
 * Lee/escribe SOLO las tablas Wms_* (DDL: docs/wms-data/DDL-wms-propio.sql); toda
 * escritura de stock pasa por wmsInternoService (transaccional/idempotente).
 * Montado en /api/wms-interno (server.js). UI: src/components/pages/StockGestionPage.jsx.
 */

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/wmsInternoService');

const uid = (req) => req.user?.id || null;

// ── Adjuntos de compras (facturas, BL, despachos): carpeta por compra en disco ──
// Configurable con STOCK_COMPRAS_PATH (default backend/stock/compras). Igual criterio
// que THUMBNAILS_PATH / FALLAS_PATH: en producción conviene apuntarlo fuera del deploy.
const COMPRAS_PATH = process.env.STOCK_COMPRAS_PATH || path.join(__dirname, '..', 'stock', 'compras');
exports.COMPRAS_PATH = COMPRAS_PATH;

const almacenCompras = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(COMPRAS_PATH, String(parseInt(req.params.id, 10) || 0));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // nombre único, conservando extensión (el original queda en la tabla)
        const ext = path.extname(file.originalname || '').slice(0, 10) || '';
        const base = path.basename(file.originalname || 'archivo', ext)
            .replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        cb(null, `${Date.now()}-${base}${ext}`);
    },
});
exports.uploadCompraArchivo = multer({
    storage: almacenCompras,
    limits: { fileSize: 40 * 1024 * 1024 }, // 40 MB por archivo
    fileFilter: (req, file, cb) => {
        const ok = /pdf|jpeg|jpg|png|webp|xml|zip|msword|officedocument|excel|sheet/i.test(file.mimetype || '');
        cb(ok ? null : new Error('Formato no permitido (PDF, imágenes, Office o ZIP)'), ok);
    },
}).single('archivo');

// GET /depositos — para el selector (default del front: 5, el local)
exports.getDepositos = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT DepId, Nombre, Tipo, Ubicacion FROM dbo.Wms_Depositos WHERE Activo = 1 ORDER BY DepId
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /inventario?dep=5&q=&conStock=1 — filas variante con su stock en el depósito.
// El front agrupa por producto. q busca en producto/variante/sku/talle/color.
exports.getInventario = async (req, res) => {
    try {
        const pool = await getPool();
        // dep=0 → USO GLOBAL (todos los depósitos), igual que el filtro del sistema anterior
        const depRaw = req.query.dep;
        const dep = depRaw === '0' || depRaw === 0 ? 0 : (parseInt(depRaw, 10) || 5);
        const q = String(req.query.q || '').trim();
        const soloConStock = String(req.query.conStock || '1') === '1';
        const r = await pool.request()
            .input('D', sql.Int, dep)
            .input('Q', sql.NVarChar(100), q ? `%${q}%` : null)
            .query(`
                SELECT p.PmaId, p.Nombre AS Producto, p.UnidadBase, c.Nombre AS Categoria,
                       v.VarId, v.NombreVariante, v.CodigoVariante, v.Talle, v.Color,
                       ISNULL(s.Stock, 0) AS Stock, ISNULL(s.Etiquetas, 0) AS Etiquetas,
                       ISNULL(s.ValorConCosto, 0) + ISNULL(s.CantSinCosto, 0) * ISNULL(v.Costo, 0) AS Patrimonio,
                       ISNULL(v.Moneda, 'UYU') AS Moneda
                FROM dbo.Wms_Variantes v
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                LEFT JOIN dbo.Wms_Categorias c ON c.CatId = p.CatId
                -- El costo de la variante (referencia externa) NO puede entrar en el SUM
                -- (error 8124): se agregan por separado y se combinan afuera.
                OUTER APPLY (
                    SELECT SUM(e.CantidadActual) AS Stock, COUNT(*) AS Etiquetas,
                           SUM(e.CantidadActual * ISNULL(NULLIF(e.CostoUnitarioReal, 0), 0)) AS ValorConCosto,
                           SUM(CASE WHEN ISNULL(NULLIF(e.CostoUnitarioReal, 0), 0) = 0 THEN e.CantidadActual ELSE 0 END) AS CantSinCosto
                    FROM dbo.Wms_Etiquetas e
                    -- Se cuentan TODAS las etiquetas activas (mismo criterio de 'lotes' del
                    -- sistema anterior): un lote vacío sin marcar consumido sigue siendo un lote.
                    WHERE e.VarId = v.VarId AND (@D = 0 OR e.DepId = @D) AND e.Estado = 'activo'
                ) s
                WHERE v.Activa = 1
                  AND (@Q IS NULL OR p.Nombre LIKE @Q OR v.NombreVariante LIKE @Q
                       OR v.CodigoVariante LIKE @Q OR v.Talle LIKE @Q OR v.Color LIKE @Q)
                  ${soloConStock ? 'AND ISNULL(s.Stock, 0) > 0' : ''}
                ORDER BY p.Nombre, v.NombreVariante
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /variantes?q= — autocomplete para ingreso/remitos (todas, tengan stock o no)
exports.buscarVariantes = async (req, res) => {
    try {
        const pool = await getPool();
        const q = String(req.query.q || '').trim();
        if (q.length < 2) return res.json({ success: true, data: [] });
        const r = await pool.request()
            .input('Q', sql.NVarChar(100), `%${q}%`)
            .query(`
                SELECT TOP 30 v.VarId, v.NombreVariante, v.CodigoVariante, v.Talle, v.Color,
                       p.Nombre AS Producto, p.UnidadBase
                FROM dbo.Wms_Variantes v
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                WHERE v.Activa = 1 AND (p.Nombre LIKE @Q OR v.NombreVariante LIKE @Q OR v.CodigoVariante LIKE @Q)
                ORDER BY p.Nombre, v.NombreVariante
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /variantes/:id/etiquetas?dep=&todas=0 — etiquetas de la variante en el depósito
exports.getEtiquetasVariante = async (req, res) => {
    try {
        const pool = await getPool();
        const dep = parseInt(req.query.dep, 10) || 5;
        const todas = String(req.query.todas || '0') === '1';
        const r = await pool.request()
            .input('V', sql.Int, parseInt(req.params.id, 10))
            .input('D', sql.Int, dep)
            .query(`
                SELECT TOP 200 EtiId, CantidadInicial, CantidadActual, MedidaSecundaria, Peso,
                       CostoUnitarioReal, CodigoBarras, Estado, FechaIngreso, UltimaActualizacion
                FROM dbo.Wms_Etiquetas
                WHERE VarId = @V AND DepId = @D ${todas ? '' : "AND Estado = 'activo' AND CantidadActual > 0"}
                ORDER BY EtiId DESC
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /etiquetas/buscar?codigo= — lookup por escaneo: EtiId numérico o CodigoBarras
exports.buscarEtiqueta = async (req, res) => {
    try {
        const pool = await getPool();
        const codigo = String(req.query.codigo || '').trim();
        if (!codigo) return res.status(400).json({ error: 'Falta el código' });
        const num = /^\d+$/.test(codigo) ? parseInt(codigo, 10) : null;
        const r = await pool.request()
            .input('C', sql.VarChar(255), codigo)
            .input('N', sql.Int, num)
            .query(`
                SELECT TOP 1 e.EtiId, e.VarId, e.DepId, e.CantidadActual, e.CantidadInicial,
                       e.MedidaSecundaria, e.Peso, e.CodigoBarras, e.Estado,
                       v.NombreVariante, v.Talle, v.Color, v.GramajeGsm, v.AnchoMetros,
                       p.Nombre AS Producto, p.UnidadBase,
                       d.Nombre AS Deposito
                FROM dbo.Wms_Etiquetas e
                JOIN dbo.Wms_Variantes v ON v.VarId = e.VarId
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                LEFT JOIN dbo.Wms_Depositos d ON d.DepId = e.DepId
                WHERE (@N IS NOT NULL AND e.EtiId = @N) OR e.CodigoBarras = @C
                ORDER BY CASE WHEN e.EtiId = @N THEN 0 ELSE 1 END
            `);
        if (!r.recordset.length) return res.status(404).json({ error: 'Etiqueta no encontrada' });
        res.json({ success: true, data: r.recordset[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /ingresos — alta de etiqueta física (el front imprime la etiqueta con el EtiId)
exports.crearIngreso = async (req, res) => {
    try {
        const { varId, depId, cantidad, medidaSecundaria, peso, costoUnitario, codigoBarras } = req.body || {};
        if (!parseInt(varId, 10) || !(parseFloat(cantidad) > 0))
            return res.status(400).json({ error: 'Faltan variante o cantidad' });
        const r = await svc.ingresarEtiqueta({
            varId: parseInt(varId, 10),
            depId: parseInt(depId, 10) || null,
            cantidad: parseFloat(cantidad),
            medidaSecundaria: medidaSecundaria != null && medidaSecundaria !== '' ? parseFloat(medidaSecundaria) : null,
            peso: peso != null && peso !== '' ? parseFloat(peso) : null,
            costoUnitario: parseFloat(costoUnitario) || 0,
            codigoBarras: (codigoBarras || '').trim() || null,
            usuarioId: uid(req),
        });
        logger.info(`[WMS-INT] Ingreso: etiqueta ${r.etiId} (var ${varId}) por usuario ${uid(req)}`);
        res.json({ success: true, etiId: r.etiId });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /etiquetas/:id/ajuste { cantidadContada } — conteo físico
exports.ajustarEtiqueta = async (req, res) => {
    try {
        const cantidadContada = parseFloat(req.body?.cantidadContada);
        if (!(cantidadContada >= 0)) return res.status(400).json({ error: 'Cantidad contada inválida' });
        const r = await svc.ajustarConteo({ etiId: parseInt(req.params.id, 10), cantidadContada, usuarioId: uid(req) });
        res.json({ success: true, diferencia: r.diferencia });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /panel — bloques del panel gerencial (F4): valorización, volumen, top consumo,
// anomalías de consumo (hoy vs promedio 30 días) y stock crítico global vs límites.
// Todo GLOBAL (todos los depósitos), como el panel del sistema viejo. El consumo une
// nuestro ledger con Wms_HistoricoExterno para tener promedio desde el día uno.
exports.getPanel = async (req, res) => {
    try {
        const pool = await getPool();

        const [valorizacion, volumen, topConsumo, anomalias, criticos, porDeposito, porCategoria, salud, quiebres] = await Promise.all([
            // Valorización por moneda de la variante; costo = el real de la etiqueta o el de la variante
            pool.request().query(`
                SELECT ISNULL(v.Moneda, 'UYU') AS Moneda,
                       SUM(e.CantidadActual * COALESCE(NULLIF(e.CostoUnitarioReal, 0), v.Costo, 0)) AS Total
                FROM dbo.Wms_Etiquetas e
                JOIN dbo.Wms_Variantes v ON v.VarId = e.VarId
                WHERE e.Estado = 'activo' AND e.CantidadActual > 0
                GROUP BY ISNULL(v.Moneda, 'UYU')
            `),
            pool.request().query(`
                SELECT SUM(CantidadActual) AS Unidades, COUNT(DISTINCT VarId) AS Variantes
                FROM dbo.Wms_Etiquetas WHERE Estado = 'activo' AND CantidadActual > 0
            `),
            // Más consumido este mes (egresos + bajas; traslados NO son consumo)
            pool.request().query(`
                WITH consumo AS (
                    SELECT m.EtiId, ABS(m.Cantidad) AS Cant, m.Fecha
                    FROM dbo.Wms_Movimientos m
                    WHERE m.Cantidad < 0 AND m.Tipo IN ('egreso_venta_web','baja_consumo','egreso_final','egreso_auto')
                      AND m.Fecha >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
                    UNION ALL
                    SELECT h.EtiquetaId, ABS(h.Cantidad), h.Fecha
                    FROM dbo.Wms_HistoricoExterno h
                    WHERE h.Cantidad IS NOT NULL AND h.Tipo IN ('egreso_venta_web','baja_consumo','egreso_final','egreso_auto')
                      AND h.Fecha >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
                )
                SELECT TOP 10 p.Nombre AS Producto, v.NombreVariante, SUM(c.Cant) AS Unidades
                FROM consumo c
                JOIN dbo.Wms_Etiquetas e ON e.EtiId = c.EtiId
                JOIN dbo.Wms_Variantes v ON v.VarId = e.VarId
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                GROUP BY p.Nombre, v.NombreVariante
                ORDER BY SUM(c.Cant) DESC
            `),
            // Anomalías: variantes con salidas HOY muy por encima de su promedio diario (30 días)
            pool.request().query(`
                WITH salidas AS (
                    SELECT e.VarId, m.Fecha
                    FROM dbo.Wms_Movimientos m
                    JOIN dbo.Wms_Etiquetas e ON e.EtiId = m.EtiId
                    WHERE m.Cantidad < 0 AND m.Tipo IN ('egreso_venta_web','baja_consumo','egreso_final','egreso_auto')
                      AND m.Fecha >= DATEADD(DAY, -30, GETDATE())
                    UNION ALL
                    SELECT e.VarId, h.Fecha
                    FROM dbo.Wms_HistoricoExterno h
                    JOIN dbo.Wms_Etiquetas e ON e.EtiId = h.EtiquetaId
                    WHERE h.Cantidad IS NOT NULL AND h.Tipo IN ('egreso_venta_web','baja_consumo','egreso_final','egreso_auto')
                      AND h.Fecha >= DATEADD(DAY, -30, GETDATE())
                )
                SELECT TOP 5 p.Nombre AS Producto, v.NombreVariante,
                       SUM(CASE WHEN CAST(s.Fecha AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS Hoy,
                       CAST(COUNT(*) / 30.0 AS DECIMAL(10,1)) AS PromedioDia
                FROM salidas s
                JOIN dbo.Wms_Variantes v ON v.VarId = s.VarId
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                GROUP BY p.Nombre, v.NombreVariante
                HAVING SUM(CASE WHEN CAST(s.Fecha AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) >= 3
                   AND SUM(CASE WHEN CAST(s.Fecha AS DATE) = CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) > 3 * (COUNT(*) / 30.0)
                ORDER BY Hoy DESC
            `),
            // Stock crítico global vs límites de la variante (C: crítica / A: alerta)
            pool.request().query(`
                SELECT TOP 50 p.Nombre AS Producto, c.Nombre AS Familia, v.NombreVariante,
                       v.CantidadCritica, v.CantidadAlerta, v.CantidadIdeal,
                       ISNULL(s.Stock, 0) AS StockGlobal,
                       CASE WHEN ISNULL(s.Stock, 0) <= v.CantidadCritica THEN 'CRITICO' ELSE 'ALERTA' END AS Estado
                FROM dbo.Wms_Variantes v
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                LEFT JOIN dbo.Wms_Categorias c ON c.CatId = p.CatId
                OUTER APPLY (SELECT SUM(e.CantidadActual) AS Stock FROM dbo.Wms_Etiquetas e
                             WHERE e.VarId = v.VarId AND e.Estado = 'activo') s
                WHERE v.Activa = 1 AND (v.CantidadCritica > 0 OR v.CantidadAlerta > 0)
                  AND ISNULL(s.Stock, 0) <= CASE WHEN v.CantidadAlerta > 0 THEN v.CantidadAlerta ELSE v.CantidadCritica END
                ORDER BY CASE WHEN ISNULL(s.Stock, 0) <= v.CantidadCritica THEN 0 ELSE 1 END, ISNULL(s.Stock, 0) ASC
            `),
            // Distribución por depósito: unidades y capital en cada moneda + total en USD
            // (convertido con la cotización del sistema — nunca con un TC inventado)
            pool.request().query(`
                DECLARE @TC DECIMAL(18,4) = ISNULL((SELECT TOP 1 CotDolar FROM dbo.Cotizaciones ORDER BY CotFecha DESC), 40.0);
                SELECT d.DepId, d.Nombre AS Deposito,
                       SUM(e.CantidadActual) AS Unidades,
                       SUM(CASE WHEN ISNULL(v.Moneda,'UYU') = 'USD' THEN e.CantidadActual * COALESCE(NULLIF(e.CostoUnitarioReal,0), v.Costo, 0)
                                ELSE e.CantidadActual * COALESCE(NULLIF(e.CostoUnitarioReal,0), v.Costo, 0) / @TC END) AS CapitalTotalUSD,
                       SUM(CASE WHEN ISNULL(v.Moneda,'UYU') = 'USD' THEN e.CantidadActual * COALESCE(NULLIF(e.CostoUnitarioReal,0), v.Costo, 0) ELSE 0 END) AS CapitalUSD,
                       SUM(CASE WHEN ISNULL(v.Moneda,'UYU') <> 'USD' THEN e.CantidadActual * COALESCE(NULLIF(e.CostoUnitarioReal,0), v.Costo, 0) ELSE 0 END) AS CapitalUYU
                FROM dbo.Wms_Etiquetas e
                JOIN dbo.Wms_Variantes v ON v.VarId = e.VarId
                LEFT JOIN dbo.Wms_Depositos d ON d.DepId = e.DepId
                WHERE e.Estado = 'activo' AND e.CantidadActual > 0
                GROUP BY d.DepId, d.Nombre
                ORDER BY SUM(e.CantidadActual) DESC
            `),
            // Distribución por familia/categoría
            pool.request().query(`
                SELECT TOP 8 ISNULL(c.Nombre, 'Sin familia') AS Familia,
                       SUM(e.CantidadActual) AS Unidades,
                       COUNT(DISTINCT v.VarId) AS Variantes
                FROM dbo.Wms_Etiquetas e
                JOIN dbo.Wms_Variantes v ON v.VarId = e.VarId
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                LEFT JOIN dbo.Wms_Categorias c ON c.CatId = p.CatId
                WHERE e.Estado = 'activo' AND e.CantidadActual > 0
                GROUP BY ISNULL(c.Nombre, 'Sin familia')
                ORDER BY SUM(e.CantidadActual) DESC
            `),
            // Salud global: variantes con límite configurado, en riesgo vs sanas
            pool.request().query(`
                SELECT
                    SUM(CASE WHEN ISNULL(s.Stock, 0) <= CASE WHEN v.CantidadAlerta > 0 THEN v.CantidadAlerta ELSE v.CantidadCritica END THEN 1 ELSE 0 END) AS EnRiesgo,
                    COUNT(*) AS ConLimite
                FROM dbo.Wms_Variantes v
                OUTER APPLY (SELECT SUM(e.CantidadActual) AS Stock FROM dbo.Wms_Etiquetas e
                             WHERE e.VarId = v.VarId AND e.Estado = 'activo') s
                WHERE v.Activa = 1 AND (v.CantidadCritica > 0 OR v.CantidadAlerta > 0)
            `),
            // Quiebres críticos por almacén: SOLO donde hay un mínimo configurado PARA ESE
            // depósito (Wms_AlertasDepositos). Usar el límite global de la variante por
            // depósito inflaba el conteo — una tela que vive en el Centro figuraba "en quiebre"
            // en todas las demás áreas. Sin umbrales locales cargados, no hay quiebres locales.
            pool.request().query(`
                IF OBJECT_ID('dbo.Wms_AlertasDepositos') IS NULL
                    SELECT CAST(NULL AS VARCHAR(100)) AS Deposito, 0 AS Quiebres WHERE 1 = 0;
                ELSE
                    SELECT d.Nombre AS Deposito, COUNT(*) AS Quiebres
                    FROM dbo.Wms_AlertasDepositos a
                    JOIN dbo.Wms_Variantes v ON v.VarId = a.VarId AND v.Activa = 1
                    JOIN dbo.Wms_Depositos d ON d.DepId = a.DepId AND d.Activo = 1
                    OUTER APPLY (SELECT SUM(e.CantidadActual) AS Stock FROM dbo.Wms_Etiquetas e
                                 WHERE e.VarId = a.VarId AND e.DepId = a.DepId AND e.Estado = 'activo') s
                    WHERE a.CantidadCritica > 0 AND ISNULL(s.Stock, 0) <= a.CantidadCritica
                    GROUP BY d.Nombre
                    ORDER BY COUNT(*) DESC;
            `),
        ]);

        res.json({
            success: true,
            data: {
                valorizacion: valorizacion.recordset,
                volumen: volumen.recordset[0] || { Unidades: 0, Variantes: 0 },
                topConsumo: topConsumo.recordset,
                anomalias: anomalias.recordset,
                criticos: criticos.recordset,
                porDeposito: porDeposito.recordset,
                porCategoria: porCategoria.recordset,
                salud: salud.recordset[0] || { EnRiesgo: 0, ConLimite: 0 },
                quiebres: quiebres.recordset,
            }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /historial?grupo=&q=&fecha=&pagina= — trazabilidad completa: ledger nuevo (Wms_Movimientos)
// + histórico del sistema viejo (Wms_HistoricoExterno) en UNA línea de tiempo.
// grupo: TRASLADOS | INGRESOS | EGRESOS | AJUSTES | (vacío = todos)
const GRUPOS_HISTORIAL = {
    TRASLADOS: ['traslado_salida', 'traslado_entrada', 'recepcion_confirmada'],
    INGRESOS: ['ingreso', 'ingreso_compra', 'apertura_migracion', 'ingreso_auditoria_libre', 'fraccionamiento_ingreso'],
    EGRESOS: ['egreso_venta_web', 'baja_consumo', 'egreso_final', 'egreso_auto', 'fraccionamiento_salida'],
    AJUSTES: ['ajuste_conteo', 'anulacion'],
};
exports.getHistorial = async (req, res) => {
    try {
        const pool = await getPool();
        const grupo = String(req.query.grupo || '').toUpperCase();
        const tipos = GRUPOS_HISTORIAL[grupo] || null;
        const q = String(req.query.q || '').trim();
        const fecha = String(req.query.fecha || '').trim();      // YYYY-MM-DD
        const pagina = Math.max(0, parseInt(req.query.pagina, 10) || 0);
        const PAGE = 60;

        // Sin grupo elegido, las aperturas de migración se ocultan: son 3.200 asientos
        // sintéticos de la foto inicial y entierran la actividad real. Siguen visibles
        // eligiendo el chip "Ingresos".
        const filtroTipos = tipos
            ? `AND u.Tipo IN (${tipos.map(t => `'${t}'`).join(',')})`
            : `AND u.Tipo <> 'apertura_migracion'`;
        const r = await pool.request()
            .input('Q', sql.NVarChar(100), q ? `%${q}%` : null)
            .input('F', sql.Date, fecha || null)
            .input('Skip', sql.Int, pagina * PAGE)
            .input('Take', sql.Int, PAGE)
            .query(`
                WITH u AS (
                    SELECT m.Fecha, m.Tipo, m.Cantidad, m.EtiId, e.VarId,
                           m.DepOrigenId, m.DepDestinoId, m.RefTipo, m.RefId,
                           CAST(NULL AS VARCHAR(50)) AS UsuarioTexto, 'ACTUAL' AS Fuente
                    FROM dbo.Wms_Movimientos m
                    JOIN dbo.Wms_Etiquetas e ON e.EtiId = m.EtiId
                    UNION ALL
                    -- El sistema anterior NO guarda el remito en las recepciones
                    -- ('recepcion_confirmada' viene siempre con remito_id NULL), así que
                    -- se deriva por la etiqueta que el propio remito generó al recibirse.
                    -- TOP 1 porque una etiqueta puede haber viajado en más de un remito:
                    -- se toma el último remito anterior al movimiento.
                    SELECT h.Fecha, h.Tipo, h.Cantidad, h.EtiquetaId, h.VarianteId,
                           h.DepOrigenId, h.DepDestinoId,
                           CASE WHEN COALESCE(h.RemitoId, d.RemId) IS NOT NULL THEN 'REMITO'
                                WHEN h.CompraGuid IS NOT NULL THEN 'COMPRA' END,
                           COALESCE(h.RemitoId, d.RemId), h.Usuario, 'HISTORICO'
                    FROM dbo.Wms_HistoricoExterno h
                    OUTER APPLY (
                        SELECT TOP 1 i.RemId
                        FROM dbo.Wms_RemitosInternosItems i
                        JOIN dbo.Wms_RemitosInternos rr ON rr.RemId = i.RemId
                        WHERE h.RemitoId IS NULL AND i.EtiGeneradaId = h.EtiquetaId
                          AND rr.FechaCreacion <= h.Fecha
                        ORDER BY rr.FechaCreacion DESC
                    ) d
                    WHERE h.Fecha IS NOT NULL
                )
                SELECT u.Fecha, u.Tipo, u.Cantidad, u.EtiId, u.RefTipo, u.RefId, u.UsuarioTexto, u.Fuente,
                       v.NombreVariante, v.Talle, v.Color, p.Nombre AS Producto, p.UnidadBase,
                       dor.Nombre AS DepOrigen, dde.Nombre AS DepDestino,
                       rem.Numeracion AS RefNumero
                FROM u
                LEFT JOIN dbo.Wms_Variantes v ON v.VarId = u.VarId
                LEFT JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                LEFT JOIN dbo.Wms_Depositos dor ON dor.DepId = u.DepOrigenId
                LEFT JOIN dbo.Wms_Depositos dde ON dde.DepId = u.DepDestinoId
                LEFT JOIN dbo.Wms_RemitosInternos rem ON u.RefTipo = 'REMITO' AND rem.RemId = u.RefId
                WHERE 1 = 1
                  ${filtroTipos}
                  AND (@F IS NULL OR CAST(u.Fecha AS DATE) = @F)
                  AND (@Q IS NULL OR p.Nombre LIKE @Q OR v.NombreVariante LIKE @Q
                       OR rem.Numeracion LIKE @Q
                       OR CAST(u.EtiId AS VARCHAR) = REPLACE(@Q, '%', ''))
                ORDER BY u.Fecha DESC
                OFFSET @Skip ROWS FETCH NEXT @Take ROWS ONLY
            `);
        res.json({ success: true, data: r.recordset, pagina, pageSize: PAGE });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /remitos?estado=&destino=&origen= — lista con resumen de items
exports.getRemitos = async (req, res) => {
    try {
        const pool = await getPool();
        const estado = String(req.query.estado || '').trim().toUpperCase();
        const destino = parseInt(req.query.destino, 10) || null;
        const origen = parseInt(req.query.origen, 10) || null;
        const q = String(req.query.q || '').trim();
        const r = await pool.request()
            .input('E', sql.VarChar(50), estado || null)
            .input('Dd', sql.Int, destino)
            .input('Do', sql.Int, origen)
            .input('Q', sql.NVarChar(120), q ? `%${q}%` : null)
            .input('F', sql.VarChar(10), fechaSola(req.query.fecha))
            .query(`
                SELECT TOP 200 r.RemId, r.Numeracion, r.Estado, r.Observaciones, r.FechaCreacion,
                       r.DepOrigenId, dor.Nombre AS DepOrigen, r.DepDestinoId, dde.Nombre AS DepDestino,
                       -- El responsable es texto del sistema anterior; si no hay, el usuario que lo creó acá
                       COALESCE(NULLIF(LTRIM(RTRIM(r.Responsable)), ''), u.Nombre) AS Responsable,
                       (SELECT COUNT(*) FROM dbo.Wms_RemitosInternosItems i WHERE i.RemId = r.RemId) AS Items,
                       (SELECT COUNT(*) FROM dbo.Wms_RemitosInternosItems i WHERE i.RemId = r.RemId AND i.Estado = 'PENDIENTE') AS Pendientes,
                       ISNULL((SELECT SUM(i.CantidadEnviada) FROM dbo.Wms_RemitosInternosItems i WHERE i.RemId = r.RemId), 0) AS Unidades
                FROM dbo.Wms_RemitosInternos r
                LEFT JOIN dbo.Wms_Depositos dor ON dor.DepId = r.DepOrigenId
                LEFT JOIN dbo.Wms_Depositos dde ON dde.DepId = r.DepDestinoId
                LEFT JOIN dbo.Usuarios u ON u.IdUsuario = r.CreadoPor
                WHERE (@E IS NULL OR r.Estado = @E)
                  AND (@Dd IS NULL OR r.DepDestinoId = @Dd)
                  AND (@Do IS NULL OR r.DepOrigenId = @Do)
                  AND (@Q IS NULL OR r.Numeracion LIKE @Q OR dor.Nombre LIKE @Q OR dde.Nombre LIKE @Q)
                  AND (@F IS NULL OR CAST(r.FechaCreacion AS DATE) = @F)
                ORDER BY r.RemId DESC
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /remitos/:id — detalle con items
exports.getRemitoDetalle = async (req, res) => {
    try {
        const pool = await getPool();
        const id = parseInt(req.params.id, 10);
        // `data` sigue siendo el array de items (hay consumidores que lo esperan así);
        // la cabecera va aparte, para la hoja de remito imprimible.
        const [items, cab] = await Promise.all([
            pool.request().input('R', sql.Int, id).query(`
                SELECT i.RemItId, i.VarId, i.CantidadEnviada, i.CantidadRecibida, i.Estado, i.EtiGeneradaId,
                       v.NombreVariante, v.Talle, v.Color, v.CodigoVariante, p.Nombre AS Producto, p.UnidadBase
                FROM dbo.Wms_RemitosInternosItems i
                JOIN dbo.Wms_Variantes v ON v.VarId = i.VarId
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                WHERE i.RemId = @R
                ORDER BY p.Nombre, v.NombreVariante
            `),
            pool.request().input('R', sql.Int, id).query(`
                SELECT r.RemId, r.Numeracion, r.Estado, r.Observaciones, r.FechaCreacion,
                       dor.Nombre AS DepOrigen, dde.Nombre AS DepDestino,
                       COALESCE(NULLIF(LTRIM(RTRIM(r.Responsable)), ''), u.Nombre) AS Responsable
                FROM dbo.Wms_RemitosInternos r
                LEFT JOIN dbo.Wms_Depositos dor ON dor.DepId = r.DepOrigenId
                LEFT JOIN dbo.Wms_Depositos dde ON dde.DepId = r.DepDestinoId
                LEFT JOIN dbo.Usuarios u ON u.IdUsuario = r.CreadoPor
                WHERE r.RemId = @R
            `),
        ]);
        res.json({ success: true, data: items.recordset, cabecera: cab.recordset[0] || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /remitos/:id/cancelar { motivo } — anula un remito en tránsito y devuelve el stock
exports.cancelarRemito = async (req, res) => {
    try {
        const r = await svc.cancelarRemito({
            remId: parseInt(req.params.id, 10),
            motivo: req.body?.motivo, usuarioId: uid(req),
        });
        res.json({ success: true, ...r });
    } catch (e) { res.status(400).json({ error: e.message }); }
};

// POST /remitos { depOrigenId, depDestinoId, items:[{varId, cantidad}], obs }
exports.crearRemito = async (req, res) => {
    try {
        const { depOrigenId, depDestinoId, items, obs } = req.body || {};
        const r = await svc.crearRemito({
            depOrigenId: parseInt(depOrigenId, 10), depDestinoId: parseInt(depDestinoId, 10),
            items: items || [], obs: (obs || '').trim() || null, usuarioId: uid(req),
        });
        res.json({ success: true, ...r });
    } catch (e) { res.status(400).json({ error: e.message }); }
};

// POST /remitos/items/:id/recibir { cantidadRecibida } — el último item cierra el remito solo
exports.recibirRemitoItem = async (req, res) => {
    try {
        const r = await svc.recibirRemitoItem({
            remItId: parseInt(req.params.id, 10),
            cantidadRecibida: req.body?.cantidadRecibida != null && req.body.cantidadRecibida !== '' ? parseFloat(req.body.cantidadRecibida) : null,
            usuarioId: uid(req),
        });
        res.json({ success: true, ...r });
    } catch (e) { res.status(400).json({ error: e.message }); }
};

/* ── MI SECTOR (vista del operario sobre SU depósito) ────────────────────── */

// El sector del operario vive en Usuarios.WmsDepId (se auto-crea la columna). Si el
// usuario todavía no tiene sector, la pantalla deja elegirlo y lo guarda ahí mismo.
let colSectorLista = false;
async function ensureColSector(pool) {
    if (colSectorLista) return;
    await pool.request().query(`
        IF COL_LENGTH('dbo.Usuarios', 'WmsDepId') IS NULL
            ALTER TABLE dbo.Usuarios ADD WmsDepId INT NULL;
    `);
    colSectorLista = true;
}

// GET /mi-sector — depósito asignado al usuario logueado
exports.getMiSector = async (req, res) => {
    try {
        const pool = await getPool();
        await ensureColSector(pool);
        const r = await pool.request()
            .input('U', sql.Int, uid(req))
            .query(`SELECT u.WmsDepId, d.Nombre AS Deposito
                    FROM dbo.Usuarios u LEFT JOIN dbo.Wms_Depositos d ON d.DepId = u.WmsDepId
                    WHERE u.IdUsuario = @U`);
        res.json({ success: true, data: r.recordset[0] || { WmsDepId: null, Deposito: null } });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /mi-sector { depId } — asignar/cambiar el sector propio
exports.setMiSector = async (req, res) => {
    try {
        const pool = await getPool();
        await ensureColSector(pool);
        await pool.request()
            .input('U', sql.Int, uid(req))
            .input('D', sql.Int, parseInt(req.body?.depId, 10) || null)
            .query(`UPDATE dbo.Usuarios SET WmsDepId = @D WHERE IdUsuario = @U`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /solicitudes?dep=&estado= — pedidos de insumos (los del sector o todos)
exports.getSolicitudes = async (req, res) => {
    try {
        const pool = await getPool();
        const dep = parseInt(req.query.dep, 10) || null;
        const estado = String(req.query.estado || '').toUpperCase() || null;
        const r = await pool.request()
            .input('D', sql.Int, dep).input('E', sql.VarChar(50), estado)
            .query(`
                SELECT TOP 100 s.SolId, s.Numeracion, s.Estado, s.FechaCreacion, s.DepSolicitanteId,
                       d.Nombre AS Deposito,
                       (SELECT COUNT(*) FROM dbo.Wms_SolicitudesItems i WHERE i.SolId = s.SolId) AS Items
                FROM dbo.Wms_Solicitudes s
                LEFT JOIN dbo.Wms_Depositos d ON d.DepId = s.DepSolicitanteId
                WHERE (@D IS NULL OR s.DepSolicitanteId = @D) AND (@E IS NULL OR s.Estado = @E)
                ORDER BY s.SolId DESC
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /solicitudes/:id — items del pedido
exports.getSolicitudDetalle = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('S', sql.Int, parseInt(req.params.id, 10))
            .query(`
                SELECT i.SolItId, i.VarId, i.CantidadSolicitada,
                       v.NombreVariante, v.Talle, v.Color, p.Nombre AS Producto, p.UnidadBase
                FROM dbo.Wms_SolicitudesItems i
                LEFT JOIN dbo.Wms_Variantes v ON v.VarId = i.VarId
                LEFT JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                WHERE i.SolId = @S ORDER BY p.Nombre
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /solicitudes { depSolicitanteId, items:[{varId, cantidad}] }
exports.crearSolicitud = async (req, res) => {
    const { depSolicitanteId, items } = req.body || {};
    if (!parseInt(depSolicitanteId, 10)) return res.status(400).json({ error: 'Falta el depósito solicitante' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'El pedido no tiene items' });
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        const rS = await new sql.Request(tran)
            .input('D', sql.Int, parseInt(depSolicitanteId, 10))
            .input('U', sql.Int, uid(req))
            .query(`INSERT INTO dbo.Wms_Solicitudes (Numeracion, DepSolicitanteId, Estado, CreadoPor)
                    OUTPUT INSERTED.SolId VALUES ('', @D, 'PENDIENTE', @U)`);
        const solId = rS.recordset[0].SolId;
        await new sql.Request(tran).input('S', sql.Int, solId)
            .query(`UPDATE dbo.Wms_Solicitudes SET Numeracion = 'SOL-' + CAST(@S AS VARCHAR) WHERE SolId = @S`);
        for (const it of items) {
            if (!parseInt(it.varId, 10) || !(parseFloat(it.cantidad) > 0)) continue;
            await new sql.Request(tran)
                .input('S', sql.Int, solId).input('V', sql.Int, parseInt(it.varId, 10))
                .input('C', sql.Decimal(18, 4), parseFloat(it.cantidad))
                .query(`INSERT INTO dbo.Wms_SolicitudesItems (SolId, VarId, CantidadSolicitada) VALUES (@S, @V, @C)`);
        }
        await tran.commit();
        res.json({ success: true, solId, numeracion: 'SOL-' + solId });
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        res.status(500).json({ error: e.message });
    }
};

// POST /solicitudes/:id/estado { estado } — PENDIENTE / ATENDIDA / CANCELADA
exports.setEstadoSolicitud = async (req, res) => {
    try {
        const pool = await getPool();
        const estado = String(req.body?.estado || '').toUpperCase();
        if (!['PENDIENTE', 'ATENDIDA', 'CANCELADA'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
        await pool.request()
            .input('S', sql.Int, parseInt(req.params.id, 10))
            .input('E', sql.VarChar(50), estado)
            .query(`UPDATE dbo.Wms_Solicitudes SET Estado = @E WHERE SolId = @S`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

/* ── COMPRAS (F4) ────────────────────────────────────────────────────────── */

// GET /compras?estado=activas|historial — con proveedor, plantilla, progreso y pagado
exports.getCompras = async (req, res) => {
    try {
        const pool = await getPool();
        const filtro = String(req.query.estado || 'activas').toLowerCase();
        const where = filtro === 'historial'
            ? `c.Progreso = 'recibido'`
            : filtro === 'todas' ? '1 = 1' : `ISNULL(c.Progreso, '') <> 'recibido'`;
        const r = await pool.request().query(`
            SELECT c.CompId, c.ReferenciaFactura, c.Estado, c.Progreso, c.TotalCompra, c.GastosExtras,
                   c.AutorizadoRecepcion, c.FechaCreacion, c.PlaId, c.MonedaId, c.DepRecepcionId,
                   c.FechaEstimadaArribo, c.VolumenM3, c.PesoKg, c.Incoterm,
                   p.Nombre AS Proveedor, m.Codigo AS Moneda, m.Simbolo AS MonedaSimbolo,
                   pl.Nombre AS Plantilla,
                   pas.Etiqueta AS ProgresoEtiqueta, pas.Orden AS ProgresoOrden,
                   (SELECT COUNT(*) FROM dbo.Wms_ComprasDetalle d WHERE d.CompId = c.CompId) AS Lineas,
                   (SELECT COUNT(*) FROM dbo.Wms_ComprasDetalle d WHERE d.CompId = c.CompId AND d.CantidadRecibida < d.Cantidad - 0.0001) AS LineasPendientes,
                   ISNULL((SELECT SUM(pg.Monto) FROM dbo.Wms_Pagos pg WHERE pg.CompId = c.CompId), 0) AS Pagado
            FROM dbo.Wms_Compras c
            LEFT JOIN dbo.Wms_Proveedores p ON p.PrvId = c.PrvId
            LEFT JOIN dbo.Wms_Monedas m ON m.MonId = c.MonedaId
            LEFT JOIN dbo.Wms_PlantillasProgreso pl ON pl.PlaId = c.PlaId
            LEFT JOIN dbo.Wms_PlantillasProgresoPasos pas ON pas.PlaId = c.PlaId AND pas.Clave = c.Progreso
            WHERE ${where}
            ORDER BY c.FechaCreacion DESC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /compras/:id — detalle: líneas (con lo ya recibido), pagos y pasos de su plantilla
exports.getCompraDetalle = async (req, res) => {
    try {
        const pool = await getPool();
        const id = parseInt(req.params.id, 10);
        const [lineas, pagos, pasos, costos] = await Promise.all([
            pool.request().input('C', sql.Int, id).query(`
                SELECT d.CDetId, d.VarId, d.Cantidad, d.CantidadRecibida, d.PrecioUnitario, d.CostoPuestoLocal,
                       ISNULL(d.Bultos, 1) AS Bultos,
                       v.NombreVariante, v.Talle, v.Color, v.GramajeGsm, v.AnchoMetros,
                       p.Nombre AS Producto, p.UnidadBase
                FROM dbo.Wms_ComprasDetalle d
                LEFT JOIN dbo.Wms_Variantes v ON v.VarId = d.VarId
                LEFT JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                WHERE d.CompId = @C ORDER BY p.Nombre, v.NombreVariante
            `),
            pool.request().input('C', sql.Int, id).query(`
                SELECT PagId, Monto, TipoPago, Motivo, Fecha FROM dbo.Wms_Pagos WHERE CompId = @C ORDER BY Fecha
            `),
            pool.request().input('C', sql.Int, id).query(`
                SELECT pas.Clave, pas.Etiqueta, pas.Icono, pas.Orden
                FROM dbo.Wms_PlantillasProgresoPasos pas
                JOIN dbo.Wms_Compras c ON c.PlaId = pas.PlaId
                WHERE c.CompId = @C ORDER BY pas.Orden
            `),
            pool.request().input('C', sql.Int, id).query(`
                SELECT CceId, Descripcion, Monto FROM dbo.Wms_ComprasCostosExtra WHERE CompId = @C ORDER BY CceId
            `),
        ]);
        res.json({ success: true, data: { lineas: lineas.recordset, pagos: pagos.recordset, pasos: pasos.recordset, costos: costos.recordset } });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// Incoterms 2020: se valida contra la lista para que no entre cualquier cosa.
const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const inco = (v) => {
    const c = String(v || '').trim().toUpperCase();
    return INCOTERMS.includes(c) ? c : null;
};
// Número opcional: '' y basura entran como NULL, no como 0
const num = (v) => {
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    return isNaN(n) ? null : n;
};
// Fecha "sin hora": se manda como texto y la castea SQL Server. Con sql.Date el
// driver parsea 'YYYY-MM-DD' en UTC y al restar el offset (-03) se corre un día.
const fechaSola = (v) => {
    const d = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

/* ── GESTIÓN DE SISTEMA ────────────────────────────────────────────────────
 * ABM de los maestros que el sistema anterior administraba en
 * /stock/configuracion-maestros. Sin esto, tras el cutover no se podría dar de
 * alta un proveedor ni cambiar un límite de stock sin volver al sistema viejo.
 *
 * OJO con los ids: Wms_Proveedores y Wms_AlertasDepositos son IDENTITY, pero
 * Depositos, PlantillasProgreso y sus Pasos conservan los ids del origen y NO
 * lo son — ahí el id se asigna a mano (MAX+1 con UPDLOCK). Es una operación de
 * administración, de a una y muy de vez en cuando: el lock no molesta.
 */

// GET /gestion/proveedores
exports.getProveedores = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT p.PrvId, p.Nombre, p.RazonSocial, p.Documento, p.Contacto, p.Ciudad,
                   (SELECT COUNT(*) FROM dbo.Wms_Compras c WHERE c.PrvId = p.PrvId) AS Compras
            FROM dbo.Wms_Proveedores p ORDER BY p.Nombre
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /gestion/proveedores · PUT /gestion/proveedores/:id
exports.guardarProveedor = async (req, res) => {
    try {
        const { nombre, razonSocial, documento, contacto, ciudad } = req.body || {};
        if (!String(nombre || '').trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
        const pool = await getPool();
        const id = parseInt(req.params.id, 10) || 0;
        const rq = pool.request()
            .input('N', sql.NVarChar(200), String(nombre).trim())
            .input('R', sql.NVarChar(200), String(razonSocial || '').trim() || null)
            .input('D', sql.VarChar(50), String(documento || '').trim() || null)
            .input('C', sql.NVarChar(200), String(contacto || '').trim() || null)
            .input('Ci', sql.NVarChar(120), String(ciudad || '').trim() || null);
        if (id) {
            await rq.input('I', sql.Int, id).query(`UPDATE dbo.Wms_Proveedores
                SET Nombre=@N, RazonSocial=@R, Documento=@D, Contacto=@C, Ciudad=@Ci WHERE PrvId=@I`);
            return res.json({ success: true, prvId: id });
        }
        const r = await rq.query(`INSERT INTO dbo.Wms_Proveedores (Nombre, RazonSocial, Documento, Contacto, Ciudad)
                                  OUTPUT INSERTED.PrvId VALUES (@N, @R, @D, @C, @Ci)`);
        res.json({ success: true, prvId: r.recordset[0].PrvId });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// DELETE /gestion/proveedores/:id — solo si no tiene compras
exports.borrarProveedor = async (req, res) => {
    try {
        const pool = await getPool();
        const id = parseInt(req.params.id, 10);
        const usa = await pool.request().input('I', sql.Int, id)
            .query('SELECT COUNT(*) AS N FROM dbo.Wms_Compras WHERE PrvId = @I');
        if (usa.recordset[0].N > 0)
            return res.status(400).json({ error: `No se puede borrar: tiene ${usa.recordset[0].N} compra(s) asociadas` });
        await pool.request().input('I', sql.Int, id).query('DELETE FROM dbo.Wms_Proveedores WHERE PrvId = @I');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /gestion/depositos — con lo que tiene adentro, para saber si se puede tocar
exports.getDepositosGestion = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT d.DepId, d.Nombre, d.Tipo, d.Ubicacion, d.Activo,
                   (SELECT COUNT(*) FROM dbo.Wms_Etiquetas e WHERE e.DepId = d.DepId AND e.Estado = 'activo') AS Etiquetas,
                   (SELECT COUNT(*) FROM dbo.Usuarios u WHERE u.WmsDepId = d.DepId) AS Usuarios
            FROM dbo.Wms_Depositos d ORDER BY d.DepId
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// Nombre y ubicación se GUARDAN en Capital ('arenal grande' → 'Arenal Grande'):
// el casing venía inconsistente del origen y se seguía ensuciando en cada alta.
const capitalizarTexto = (v) => String(v || '').trim().toLowerCase()
    .replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));

// POST /gestion/depositos · PUT /gestion/depositos/:id
exports.guardarDeposito = async (req, res) => {
    try {
        const { nombre, tipo, ubicacion, activo } = req.body || {};
        if (!String(nombre || '').trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
        const pool = await getPool();
        const id = parseInt(req.params.id, 10) || 0;
        const rq = pool.request()
            .input('N', sql.VarChar(100), capitalizarTexto(nombre))
            .input('T', sql.VarChar(50), String(tipo || '').trim() || null)
            .input('U', sql.VarChar(255), capitalizarTexto(ubicacion) || null)
            .input('A', sql.Bit, activo === false ? 0 : 1);
        if (id) {
            await rq.input('I', sql.Int, id)
                .query('UPDATE dbo.Wms_Depositos SET Nombre=@N, Tipo=@T, Ubicacion=@U, Activo=@A WHERE DepId=@I');
            return res.json({ success: true, depId: id });
        }
        // DepId conserva los ids del origen: no es IDENTITY
        const r = await rq.query(`
            DECLARE @Id INT = (SELECT ISNULL(MAX(DepId), 0) + 1 FROM dbo.Wms_Depositos WITH (UPDLOCK, HOLDLOCK));
            INSERT INTO dbo.Wms_Depositos (DepId, Nombre, Tipo, Ubicacion, Activo) VALUES (@Id, @N, @T, @U, @A);
            SELECT @Id AS DepId;`);
        res.json({ success: true, depId: r.recordset[0].DepId });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /gestion/plantillas — plantillas con sus pasos ordenados
exports.getPlantillas = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT PlaId, Nombre, Descripcion FROM dbo.Wms_PlantillasProgreso ORDER BY PlaId;
            SELECT PasId, PlaId, Clave, Etiqueta, Icono, Orden FROM dbo.Wms_PlantillasProgresoPasos ORDER BY PlaId, Orden;
            SELECT PlaId, COUNT(*) AS Compras FROM dbo.Wms_Compras WHERE PlaId IS NOT NULL GROUP BY PlaId;
        `);
        const [plantillas, pasos, uso] = r.recordsets;
        res.json({ success: true, data: plantillas.map(p => ({
            ...p,
            Compras: uso.find(u => u.PlaId === p.PlaId)?.Compras || 0,
            pasos: pasos.filter(x => x.PlaId === p.PlaId),
        })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /gestion/plantillas · PUT /gestion/plantillas/:id { nombre, descripcion, pasos:[{clave,etiqueta,icono}] }
// Los pasos se reemplazan enteros: es un flujo, no una lista de filas sueltas.
exports.guardarPlantilla = async (req, res) => {
    const { nombre, descripcion, pasos } = req.body || {};
    if (!String(nombre || '').trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!Array.isArray(pasos) || !pasos.length) return res.status(400).json({ error: 'La plantilla necesita al menos un paso' });
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        let plaId = parseInt(req.params.id, 10) || 0;
        if (plaId) {
            await new sql.Request(tran).input('I', sql.Int, plaId)
                .input('N', sql.NVarChar(150), String(nombre).trim())
                .input('D', sql.NVarChar(500), String(descripcion || '').trim() || null)
                .query('UPDATE dbo.Wms_PlantillasProgreso SET Nombre=@N, Descripcion=@D WHERE PlaId=@I');
            await new sql.Request(tran).input('I', sql.Int, plaId)
                .query('DELETE FROM dbo.Wms_PlantillasProgresoPasos WHERE PlaId=@I');
        } else {
            const r = await new sql.Request(tran)
                .input('N', sql.NVarChar(150), String(nombre).trim())
                .input('D', sql.NVarChar(500), String(descripcion || '').trim() || null)
                .query(`DECLARE @Id INT = (SELECT ISNULL(MAX(PlaId), 0) + 1 FROM dbo.Wms_PlantillasProgreso WITH (UPDLOCK, HOLDLOCK));
                        INSERT INTO dbo.Wms_PlantillasProgreso (PlaId, Nombre, Descripcion) VALUES (@Id, @N, @D);
                        SELECT @Id AS PlaId;`);
            plaId = r.recordset[0].PlaId;
        }
        let orden = 0;
        for (const paso of pasos) {
            const etiqueta = String(paso.etiqueta || '').trim();
            if (!etiqueta) continue;
            // La clave es lo que queda guardado en Compras.Progreso: si no la mandan,
            // se deriva de la etiqueta (sin espacios ni acentos) para que sea estable.
            const clave = String(paso.clave || '').trim()
                || etiqueta.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 50);
            orden++;
            await new sql.Request(tran)
                .input('P', sql.Int, plaId).input('C', sql.VarChar(50), clave)
                .input('E', sql.NVarChar(150), etiqueta)
                .input('I', sql.VarChar(50), String(paso.icono || '').trim() || null)
                .input('O', sql.Int, orden)
                .query(`DECLARE @Id INT = (SELECT ISNULL(MAX(PasId), 0) + 1 FROM dbo.Wms_PlantillasProgresoPasos WITH (UPDLOCK, HOLDLOCK));
                        INSERT INTO dbo.Wms_PlantillasProgresoPasos (PasId, PlaId, Clave, Etiqueta, Icono, Orden)
                        VALUES (@Id, @P, @C, @E, @I, @O);`);
        }
        if (!orden) throw new Error('Ningún paso tenía etiqueta');
        await tran.commit();
        res.json({ success: true, plaId, pasos: orden });
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        res.status(400).json({ error: e.message });
    }
};

// GET /gestion/limites?q= — variantes con sus umbrales (los que alimentan el panel de alertas)
exports.getLimites = async (req, res) => {
    try {
        const pool = await getPool();
        const q = String(req.query.q || '').trim();
        const soloConLimite = String(req.query.conLimite || '0') === '1';
        // dep = 0/vacío → umbrales GLOBALES (los de la variante). dep = N → los de ese
        // almacén, que viven aparte: sin fila en Wms_AlertasDepositos, ese depósito no
        // tiene mínimo propio y no se le inventan quiebres.
        const dep = parseInt(req.query.dep, 10) || 0;
        // Filtro por combinación exacta: lo usa la vista agrupada al abrir una tarjeta.
        const cA = req.query.alerta != null && req.query.alerta !== '' ? parseFloat(req.query.alerta) : null;
        const cC = req.query.critica != null && req.query.critica !== '' ? parseFloat(req.query.critica) : null;
        const porCombo = cA != null && cC != null;
        const campoA = dep ? 'ad.CantidadAlerta' : 'v.CantidadAlerta';
        const campoC = dep ? 'ad.CantidadCritica' : 'v.CantidadCritica';
        const r = await pool.request()
            .input('Q', sql.NVarChar(120), q ? `%${q}%` : null)
            .input('D', sql.Int, dep)
            .input('CA', sql.Decimal(18, 4), cA)
            .input('CC', sql.Decimal(18, 4), cC)
            .query(`
            SELECT TOP 200 v.VarId, v.NombreVariante, v.Talle, v.Color, p.Nombre AS Producto, p.UnidadBase,
                   v.GramajeGsm, v.AnchoMetros,
                   ${dep ? `ISNULL(ad.CantidadCritica, 0) AS CantidadCritica,
                            ISNULL(ad.CantidadAlerta, 0) AS CantidadAlerta,
                            ISNULL(ad.CantidadIdeal, 0) AS CantidadIdeal,`
                         : `ISNULL(v.CantidadCritica, 0) AS CantidadCritica,
                            ISNULL(v.CantidadAlerta, 0) AS CantidadAlerta,
                            ISNULL(v.CantidadIdeal, 0) AS CantidadIdeal,`}
                   ISNULL((SELECT SUM(e.CantidadActual) FROM dbo.Wms_Etiquetas e
                           WHERE e.VarId = v.VarId AND e.Estado = 'activo'
                             AND (@D = 0 OR e.DepId = @D)), 0) AS StockGlobal
            FROM dbo.Wms_Variantes v
            JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
            ${dep ? 'LEFT JOIN dbo.Wms_AlertasDepositos ad ON ad.VarId = v.VarId AND ad.DepId = @D' : ''}
            WHERE v.Activa = 1
              AND (@Q IS NULL OR p.Nombre LIKE @Q OR v.NombreVariante LIKE @Q OR v.CodigoVariante LIKE @Q)
              ${soloConLimite ? (dep ? 'AND (ad.CantidadCritica > 0 OR ad.CantidadAlerta > 0)'
                                     : 'AND (v.CantidadCritica > 0 OR v.CantidadAlerta > 0)') : ''}
              ${porCombo ? `AND ${campoA} = @CA AND ${campoC} = @CC` : ''}
            ORDER BY p.Nombre, v.NombreVariante
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

const numLimite = (v) => { const x = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(x) || x < 0 ? 0 : x; };

/**
 * Aplica umbrales a una o muchas variantes, global o en UN almacén.
 * depId vacío → los globales de la variante. depId = N → Wms_AlertasDepositos.
 * Poner los dos en 0 con un almacén elegido BORRA la fila: un depósito sin fila
 * no tiene mínimo propio, y así no se cuentan quiebres locales inventados.
 */
async function aplicarLimites(pool, { varIds, depId, critica, alerta, ideal }) {
    const c = numLimite(critica), a = numLimite(alerta), i = numLimite(ideal);
    // El nivel de alerta tiene que estar por encima del crítico: si no, una variante
    // nunca podría estar "en alerta" — pasaría de sana a crítica de un salto.
    if (a > 0 && c > 0 && a < c) throw new Error('El límite de alerta debe ser mayor o igual al crítico');
    for (const varId of varIds) {
        const rq = pool.request().input('V', sql.Int, varId)
            .input('C', sql.Decimal(18, 4), c).input('A', sql.Decimal(18, 4), a).input('I', sql.Decimal(18, 4), i);
        if (!depId) {
            await rq.query('UPDATE dbo.Wms_Variantes SET CantidadCritica=@C, CantidadAlerta=@A, CantidadIdeal=@I WHERE VarId=@V');
        } else if (c === 0 && a === 0 && i === 0) {
            await rq.input('D', sql.Int, depId)
                .query('DELETE FROM dbo.Wms_AlertasDepositos WHERE VarId=@V AND DepId=@D');
        } else {
            await rq.input('D', sql.Int, depId).query(`
                UPDATE dbo.Wms_AlertasDepositos SET CantidadCritica=@C, CantidadAlerta=@A, CantidadIdeal=@I
                WHERE VarId=@V AND DepId=@D;
                IF @@ROWCOUNT = 0
                    INSERT INTO dbo.Wms_AlertasDepositos (VarId, DepId, CantidadCritica, CantidadAlerta, CantidadIdeal)
                    VALUES (@V, @D, @C, @A, @I);`);
        }
    }
    return varIds.length;
}

/**
 * GET /gestion/catalogo — el catálogo en tres niveles, para elegir artículos sin
 * saberse el nombre de memoria:
 *   sin params  → familias (categorías) con cuántos maestros tiene cada una
 *   ?cat=N      → los maestros de esa familia, con cuántas variantes
 *   ?pma=N      → las variantes de ese maestro (lo que finalmente se elige)
 * Solo cuenta variantes activas: una familia llena de variantes dadas de baja
 * mostraría un número que después no aparece al entrar.
 */
exports.getCatalogo = async (req, res) => {
    try {
        const pool = await getPool();
        const cat = parseInt(req.query.cat, 10) || 0;
        const pma = parseInt(req.query.pma, 10) || 0;

        if (pma) {
            const r = await pool.request().input('P', sql.Int, pma).query(`
                SELECT v.VarId, v.NombreVariante, v.Talle, v.Color, v.CodigoVariante,
                       p.Nombre AS Producto, p.UnidadBase,
                       ISNULL(v.CantidadCritica, 0) AS CantidadCritica,
                       ISNULL(v.CantidadAlerta, 0) AS CantidadAlerta
                FROM dbo.Wms_Variantes v
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                WHERE v.PmaId = @P AND v.Activa = 1
                ORDER BY v.NombreVariante`);
            return res.json({ success: true, nivel: 'variantes', data: r.recordset });
        }
        if (cat) {
            const r = await pool.request().input('C', sql.Int, cat).query(`
                SELECT p.PmaId, p.Nombre, p.UnidadBase,
                       (SELECT COUNT(*) FROM dbo.Wms_Variantes v WHERE v.PmaId = p.PmaId AND v.Activa = 1) AS Variantes
                FROM dbo.Wms_ProductosMaestros p
                WHERE p.CatId = @C ORDER BY p.Nombre`);
            return res.json({ success: true, nivel: 'maestros', data: r.recordset });
        }
        const r = await pool.request().query(`
            SELECT c.CatId, c.Nombre,
                   (SELECT COUNT(*) FROM dbo.Wms_ProductosMaestros p WHERE p.CatId = c.CatId) AS Maestros
            FROM dbo.Wms_Categorias c ORDER BY c.Nombre`);
        res.json({ success: true, nivel: 'familias', data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

/**
 * GET /gestion/limites-agrupados?dep= — las COMBINACIONES de umbrales en uso y
 * cuántos artículos usa cada una. Es la vista de "políticas" del sistema anterior:
 * once combinaciones para treinta artículos dice más que treinta filas sueltas,
 * y las que tienen un solo artículo suelen ser valores puestos a dedo.
 * Se agrupa en SQL, no en el navegador: así el conteo no depende de cuántas filas
 * se hayan traído a la pantalla.
 */
exports.getLimitesAgrupados = async (req, res) => {
    try {
        const pool = await getPool();
        const dep = parseInt(req.query.dep, 10) || 0;
        const r = await pool.request().input('D', sql.Int, dep).query(dep ? `
            SELECT CantidadAlerta AS Alerta, CantidadCritica AS Critica, COUNT(*) AS Articulos
            FROM dbo.Wms_AlertasDepositos WHERE DepId = @D AND (CantidadCritica > 0 OR CantidadAlerta > 0)
            GROUP BY CantidadAlerta, CantidadCritica
            ORDER BY CantidadAlerta, CantidadCritica
        ` : `
            SELECT v.CantidadAlerta AS Alerta, v.CantidadCritica AS Critica, COUNT(*) AS Articulos
            FROM dbo.Wms_Variantes v
            WHERE v.Activa = 1 AND (v.CantidadCritica > 0 OR v.CantidadAlerta > 0)
            GROUP BY v.CantidadAlerta, v.CantidadCritica
            ORDER BY v.CantidadAlerta, v.CantidadCritica
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// PUT /gestion/limites/:varId { critica, alerta, ideal, depId }
exports.guardarLimites = async (req, res) => {
    try {
        const pool = await getPool();
        await aplicarLimites(pool, {
            varIds: [parseInt(req.params.varId, 10)],
            depId: parseInt(req.body?.depId, 10) || 0,
            ...req.body,
        });
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
};

// PUT /gestion/limites-lote { varIds:[], depId, critica, alerta, ideal } — varios de una
exports.guardarLimitesLote = async (req, res) => {
    try {
        const varIds = (req.body?.varIds || []).map(v => parseInt(v, 10)).filter(Boolean);
        if (!varIds.length) return res.status(400).json({ error: 'No hay artículos seleccionados' });
        const pool = await getPool();
        const n = await aplicarLimites(pool, { varIds, depId: parseInt(req.body?.depId, 10) || 0, ...req.body });
        res.json({ success: true, aplicados: n });
    } catch (e) { res.status(400).json({ error: e.message }); }
};

// GET /gestion/articulos — el catálogo completo (variantes activas) con su costo de
// referencia y el stock que valoriza. SinValorizar = unidades activas cuya etiqueta no
// trae costo propio: son las que caen al costo de la variante en el Patrimonio, y las
// que valen $0 si la variante tampoco tiene. Son ~400 filas: se devuelve todo y el
// buscador/filtro "sin costo" viven en el front.
exports.getArticulosGestion = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT p.PmaId, p.Nombre AS Producto, p.UnidadBase, c.Nombre AS Categoria,
                   v.VarId, v.NombreVariante, v.CodigoVariante, v.Talle, v.Color,
                   ISNULL(v.Costo, 0) AS Costo, ISNULL(v.Moneda, 'UYU') AS Moneda,
                   v.GramajeGsm, v.AnchoMetros,
                   ISNULL(s.Stock, 0) AS Stock, ISNULL(s.SinValorizar, 0) AS SinValorizar
            FROM dbo.Wms_Variantes v
            JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
            LEFT JOIN dbo.Wms_Categorias c ON c.CatId = p.CatId
            OUTER APPLY (
                SELECT SUM(e.CantidadActual) AS Stock,
                       SUM(CASE WHEN ISNULL(NULLIF(e.CostoUnitarioReal, 0), 0) = 0 THEN e.CantidadActual ELSE 0 END) AS SinValorizar
                FROM dbo.Wms_Etiquetas e
                WHERE e.VarId = v.VarId AND e.Estado = 'activo'
            ) s
            WHERE v.Activa = 1
            ORDER BY p.Nombre, v.NombreVariante
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// PUT /gestion/articulos/:varId/costo — la ficha editable de la variante: costo de
// referencia (0 = "sin costo", mismo significado que traía la migración) y, para telas,
// gramaje g/m² + ancho del rollo en metros (juntos dan la conversión kg <-> metros).
exports.guardarCostoVariante = async (req, res) => {
    try {
        const varId = parseInt(req.params.varId, 10);
        if (!varId) return res.status(400).json({ error: 'Artículo inválido' });
        const costo = Number(req.body?.costo);
        if (isNaN(costo) || costo < 0) return res.status(400).json({ error: 'El costo debe ser un número positivo' });
        const moneda = String(req.body?.moneda || '').toUpperCase();
        if (!['USD', 'UYU'].includes(moneda)) return res.status(400).json({ error: 'Moneda inválida' });
        // Gramaje/ancho: opcionales — vacío o 0 los deja en NULL (artículo que no es tela).
        const medida = (v, max) => {
            if (v == null || v === '') return null;
            const n = Number(v);
            if (isNaN(n) || n < 0 || n > max) throw new Error('Gramaje o ancho inválido');
            return n || null;
        };
        let gramaje, ancho;
        try { gramaje = medida(req.body?.gramaje, 2000); ancho = medida(req.body?.ancho, 10); }
        catch (e) { return res.status(400).json({ error: e.message }); }
        const pool = await getPool();
        const r = await pool.request()
            .input('V', sql.Int, varId)
            .input('C', sql.Decimal(18, 2), costo)
            .input('M', sql.VarChar(10), moneda)
            .input('G', sql.Decimal(8, 2), gramaje)
            .input('A', sql.Decimal(6, 3), ancho)
            .query(`UPDATE dbo.Wms_Variantes
                    SET Costo = @C, Moneda = @M, GramajeGsm = @G, AnchoMetros = @A
                    WHERE VarId = @V AND Activa = 1`);
        if (!r.rowsAffected[0]) return res.status(404).json({ error: 'Artículo no encontrado' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /compras-catalogos — proveedores, monedas, plantillas y motivos de pago (para los forms)
exports.getComprasCatalogos = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT PrvId, Nombre FROM dbo.Wms_Proveedores ORDER BY Nombre;
            SELECT MonId, Codigo, Simbolo FROM dbo.Wms_Monedas ORDER BY MonId;
            SELECT PlaId, Nombre FROM dbo.Wms_PlantillasProgreso ORDER BY PlaId;
            SELECT PmoId, Nombre FROM dbo.Wms_PagosMotivos WHERE Activo = 1 ORDER BY PmoId;
            SELECT TfaId, Nombre FROM dbo.Wms_TiposFactura ORDER BY TfaId;
        `);
        const [proveedores, monedas, plantillas, motivos, tiposFactura] = r.recordsets;
        res.json({ success: true, data: { proveedores, monedas, plantillas, motivos, tiposFactura } });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /compras/ref-libre?prv=&ref= — ¿ese proveedor ya tiene esa referencia?
// El sistema anterior avisaba al salir del campo ("Referencia ya emitida").
exports.chequearReferencia = async (req, res) => {
    try {
        const prv = parseInt(req.query.prv, 10);
        const ref = String(req.query.ref || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (!prv || !ref) return res.json({ success: true, libre: true });
        const pool = await getPool();
        const r = await pool.request()
            .input('P', sql.Int, prv).input('R', sql.NVarChar(200), ref)
            .input('X', sql.Int, parseInt(req.query.excluir, 10) || 0)
            .query(`SELECT TOP 1 CompId FROM dbo.Wms_Compras
                    WHERE PrvId = @P AND CompId <> @X
                      AND UPPER(REPLACE(REPLACE(REPLACE(ISNULL(ReferenciaFactura,''), ' ', ''), '-', ''), '/', '')) = @R`);
        res.json({ success: true, libre: !r.recordset.length, compId: r.recordset[0]?.CompId || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /pagos-motivos — alta de un motivo de pago desde el form (el "+" del original)
exports.crearMotivoPago = async (req, res) => {
    try {
        const nombre = String(req.body?.nombre || '').trim();
        if (!nombre) return res.status(400).json({ error: 'Falta el nombre del motivo' });
        const pool = await getPool();
        // PmoId no es IDENTITY (la migración conserva los ids del sistema anterior):
        // se asigna a mano, igual que en el resto de las tablas migradas.
        const r = await pool.request().input('N', sql.NVarChar(100), nombre).query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.Wms_PagosMotivos WHERE Nombre = @N)
            BEGIN
                DECLARE @Id INT = (SELECT ISNULL(MAX(PmoId), 0) + 1 FROM dbo.Wms_PagosMotivos WITH (UPDLOCK, HOLDLOCK));
                INSERT INTO dbo.Wms_PagosMotivos (PmoId, Nombre, Activo) VALUES (@Id, @N, 1);
            END
            ELSE
                UPDATE dbo.Wms_PagosMotivos SET Activo = 1 WHERE Nombre = @N;
            SELECT PmoId, Nombre FROM dbo.Wms_PagosMotivos WHERE Nombre = @N;
        `);
        res.json({ success: true, data: r.recordset[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /compras — alta.
// { prvId, monedaId, plaId, tfaId, referenciaFactura, depRecepcionId, gastosExtras, borrador,
//   items:[{varId,cantidad,precioUnitario,bultos}], pagos:[{monto,tipoPago,motivo}] }
exports.crearCompra = async (req, res) => {
    const { prvId, monedaId, plaId, tfaId, referenciaFactura, depRecepcionId, items,
            gastosExtras, borrador, pagos,
            fechaEstimadaArribo, volumenM3, pesoKg, incoterm } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'La compra no tiene items' });
    // Abajo se saltean las líneas sin varId/cantidad; si no queda ninguna la compra
    // nacería vacía y en $0. Mejor rechazarla acá.
    if (!items.some(i => parseInt(i.varId, 10) && parseFloat(i.cantidad) > 0))
        return res.status(400).json({ error: 'Ningún artículo tiene cantidad válida' });
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        const total = items.reduce((s, i) => s + (parseFloat(i.cantidad) || 0) * (parseFloat(i.precioUnitario) || 0), 0);
        const extras = parseFloat(gastosExtras) || 0;
        // Borrador = 'pre-compra' (la "precompra" del sistema anterior); firme = 'pendiente'
        const estado = borrador ? 'pre-compra' : 'pendiente';
        // Progreso inicial = primer paso de la plantilla elegida
        const rIni = await new sql.Request(tran).input('P', sql.Int, parseInt(plaId, 10) || null)
            .query(`SELECT TOP 1 Clave FROM dbo.Wms_PlantillasProgresoPasos WHERE PlaId = @P ORDER BY Orden`);
        const progreso = rIni.recordset[0]?.Clave || '1';
        const rC = await new sql.Request(tran)
            .input('Prv', sql.Int, parseInt(prvId, 10) || null)
            .input('Mon', sql.Int, parseInt(monedaId, 10) || null)
            .input('Pla', sql.Int, parseInt(plaId, 10) || null)
            .input('Tfa', sql.Int, parseInt(tfaId, 10) || null)
            .input('Ref', sql.NVarChar(200), (referenciaFactura || '').trim() || null)
            .input('Dep', sql.Int, parseInt(depRecepcionId, 10) || null)
            .input('Tot', sql.Decimal(18, 2), total)
            .input('Gas', sql.Decimal(18, 2), extras)
            .input('Est', sql.NVarChar(50), estado)
            .input('Pro', sql.VarChar(50), progreso)
            .input('Eta', sql.VarChar(10), fechaSola(fechaEstimadaArribo))
            .input('Vol', sql.Decimal(18, 3), num(volumenM3))
            .input('Peso', sql.Decimal(18, 3), num(pesoKg))
            .input('Inc', sql.VarChar(10), inco(incoterm))
            .input('Usr', sql.Int, uid(req))
            .query(`INSERT INTO dbo.Wms_Compras (PrvId, MonedaId, PlaId, TfaId, ReferenciaFactura, DepRecepcionId, TotalCompra, GastosExtras, Estado, Progreso, FechaEstimadaArribo, VolumenM3, PesoKg, Incoterm, CreadoPor)
                    OUTPUT INSERTED.CompId
                    VALUES (@Prv, @Mon, @Pla, @Tfa, @Ref, @Dep, @Tot, @Gas, @Est, @Pro, @Eta, @Vol, @Peso, @Inc, @Usr)`);
        const compId = rC.recordset[0].CompId;
        for (const it of items) {
            if (!parseInt(it.varId, 10) || !(parseFloat(it.cantidad) > 0)) continue;
            await new sql.Request(tran)
                .input('C', sql.Int, compId).input('V', sql.Int, parseInt(it.varId, 10))
                .input('Cant', sql.Decimal(18, 4), parseFloat(it.cantidad))
                .input('Pre', sql.Decimal(18, 2), parseFloat(it.precioUnitario) || 0)
                .input('Bul', sql.Int, Math.max(1, parseInt(it.bultos, 10) || 1))
                .query(`INSERT INTO dbo.Wms_ComprasDetalle (CompId, VarId, Cantidad, PrecioUnitario, CostoPuestoLocal, Bultos)
                        VALUES (@C, @V, @Cant, @Pre, @Pre, @Bul)`);
        }
        // El gasto declarado en la cabecera entra como costo extra, igual que el original,
        // así lo levanta el prorrateo sin tratarlo como un caso aparte.
        if (extras > 0) {
            await new sql.Request(tran).input('C', sql.Int, compId).input('M', sql.Decimal(18, 2), extras)
                .query(`INSERT INTO dbo.Wms_ComprasCostosExtra (CompId, Descripcion, Monto)
                        VALUES (@C, 'Gasto inicial declarado', @M)`);
        }
        for (const p of pagos || []) {
            const monto = parseFloat(p.monto);
            if (!(monto > 0)) continue;
            await new sql.Request(tran)
                .input('C', sql.Int, compId).input('M', sql.Decimal(18, 2), monto)
                .input('T', sql.NVarChar(100), String(p.tipoPago || '').trim() || null)
                .input('Mo', sql.NVarChar(255), String(p.motivo || '').trim() || null)
                .input('U', sql.Int, uid(req))
                .query(`INSERT INTO dbo.Wms_Pagos (CompId, Monto, TipoPago, Motivo, UsuarioId)
                        VALUES (@C, @M, @T, @Mo, @U)`);
        }
        await tran.commit();
        res.json({ success: true, compId });
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        res.status(500).json({ error: e.message });
    }
};

// PUT /compras/:id — editar la cabecera { prvId, monedaId, tfaId, referenciaFactura, depRecepcionId }
// Las líneas no se tocan acá (se reciben/prorratean por su propio camino).
exports.editarCompra = async (req, res) => {
    try {
        const { prvId, monedaId, tfaId, referenciaFactura, depRecepcionId,
                fechaEstimadaArribo, volumenM3, pesoKg, incoterm } = req.body || {};
        const pool = await getPool();
        await pool.request()
            .input('C', sql.Int, parseInt(req.params.id, 10))
            .input('Prv', sql.Int, parseInt(prvId, 10) || null)
            .input('Mon', sql.Int, parseInt(monedaId, 10) || null)
            .input('Tfa', sql.Int, parseInt(tfaId, 10) || null)
            .input('Ref', sql.NVarChar(200), (referenciaFactura || '').trim() || null)
            .input('Dep', sql.Int, parseInt(depRecepcionId, 10) || null)
            .input('Eta', sql.VarChar(10), fechaSola(fechaEstimadaArribo))
            .input('Vol', sql.Decimal(18, 3), num(volumenM3))
            .input('Peso', sql.Decimal(18, 3), num(pesoKg))
            .input('Inc', sql.VarChar(10), inco(incoterm))
            .query(`
                UPDATE dbo.Wms_Compras
                SET PrvId = @Prv, MonedaId = @Mon, TfaId = @Tfa,
                    ReferenciaFactura = @Ref, DepRecepcionId = @Dep,
                    FechaEstimadaArribo = @Eta, VolumenM3 = @Vol, PesoKg = @Peso, Incoterm = @Inc
                WHERE CompId = @C
            `);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /compras/:id/progreso { clave } — avanzar/retroceder el workflow
exports.setProgresoCompra = async (req, res) => {
    try {
        const pool = await getPool();
        const clave = String(req.body?.clave || '').trim();
        if (!clave) return res.status(400).json({ error: 'Falta el paso' });
        await pool.request()
            .input('C', sql.Int, parseInt(req.params.id, 10))
            .input('P', sql.VarChar(50), clave)
            .query(`UPDATE dbo.Wms_Compras SET Progreso = @P WHERE CompId = @C`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /compras/:id/autorizar { autorizado } — gate de recepción
exports.autorizarCompra = async (req, res) => {
    try {
        const pool = await getPool();
        await pool.request()
            .input('C', sql.Int, parseInt(req.params.id, 10))
            .input('A', sql.Bit, req.body?.autorizado === false ? 0 : 1)
            .query(`UPDATE dbo.Wms_Compras SET AutorizadoRecepcion = @A WHERE CompId = @C`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /compras/:id/pagos { monto, tipoPago, motivo }
exports.registrarPagoCompra = async (req, res) => {
    try {
        const monto = parseFloat(req.body?.monto);
        if (!(monto > 0)) return res.status(400).json({ error: 'Monto inválido' });
        const pool = await getPool();
        await pool.request()
            .input('C', sql.Int, parseInt(req.params.id, 10))
            .input('M', sql.Decimal(18, 2), monto)
            .input('T', sql.NVarChar(100), (req.body?.tipoPago || '').trim() || null)
            .input('Mo', sql.NVarChar(300), (req.body?.motivo || '').trim() || null)
            .input('U', sql.Int, uid(req))
            .query(`INSERT INTO dbo.Wms_Pagos (CompId, Monto, TipoPago, Motivo, UsuarioId) VALUES (@C, @M, @T, @Mo, @U)`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /compras/:id/costos { descripcion, monto } — costo extra (aduana, flete, despachante…)
// Al agregarlo se recalcula GastosExtras y se prorratea el costo puesto local de cada línea
// en proporción a su valor: así la etiqueta que nace al recibir ya lleva el costo real.
exports.agregarCostoExtra = async (req, res) => {
    const compId = parseInt(req.params.id, 10);
    const monto = parseFloat(req.body?.monto);
    const descripcion = (req.body?.descripcion || '').trim();
    if (!(monto > 0) || !descripcion) return res.status(400).json({ error: 'Falta descripción o monto' });
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        await new sql.Request(tran)
            .input('C', sql.Int, compId).input('D', sql.NVarChar(300), descripcion.substring(0, 300))
            .input('M', sql.Decimal(18, 2), monto)
            .query(`INSERT INTO dbo.Wms_ComprasCostosExtra (CompId, Descripcion, Monto) VALUES (@C, @D, @M)`);
        await new sql.Request(tran).input('C', sql.Int, compId).query(`
            DECLARE @Extra DECIMAL(18,2) = ISNULL((SELECT SUM(Monto) FROM dbo.Wms_ComprasCostosExtra WHERE CompId = @C), 0);
            DECLARE @Base  DECIMAL(18,2) = ISNULL((SELECT SUM(Cantidad * PrecioUnitario) FROM dbo.Wms_ComprasDetalle WHERE CompId = @C), 0);
            UPDATE dbo.Wms_Compras SET GastosExtras = @Extra, TotalCompra = @Base + @Extra WHERE CompId = @C;
            -- Prorrateo: cada línea absorbe los extras en proporción a lo que pesa en la compra
            IF @Base > 0
                UPDATE dbo.Wms_ComprasDetalle
                SET CostoPuestoLocal = PrecioUnitario * (1 + @Extra / @Base)
                WHERE CompId = @C;
        `);
        await tran.commit();
        res.json({ success: true });
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        res.status(500).json({ error: e.message });
    }
};

// DELETE /compras/costos/:cceId — quita un costo extra y rehace el prorrateo
exports.borrarCostoExtra = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().input('X', sql.Int, parseInt(req.params.cceId, 10))
            .query(`SELECT CompId FROM dbo.Wms_ComprasCostosExtra WHERE CceId = @X`);
        if (!r.recordset.length) return res.status(404).json({ error: 'No encontrado' });
        const compId = r.recordset[0].CompId;
        await pool.request().input('X', sql.Int, parseInt(req.params.cceId, 10))
            .query(`DELETE FROM dbo.Wms_ComprasCostosExtra WHERE CceId = @X`);
        await pool.request().input('C', sql.Int, compId).query(`
            DECLARE @Extra DECIMAL(18,2) = ISNULL((SELECT SUM(Monto) FROM dbo.Wms_ComprasCostosExtra WHERE CompId = @C), 0);
            DECLARE @Base  DECIMAL(18,2) = ISNULL((SELECT SUM(Cantidad * PrecioUnitario) FROM dbo.Wms_ComprasDetalle WHERE CompId = @C), 0);
            UPDATE dbo.Wms_Compras SET GastosExtras = @Extra, TotalCompra = @Base + @Extra WHERE CompId = @C;
            IF @Base > 0
                UPDATE dbo.Wms_ComprasDetalle SET CostoPuestoLocal = PrecioUnitario * (1 + @Extra / @Base) WHERE CompId = @C;
        `);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /compras/:id/plantilla { plaId } — cambiar el tipo de seguimiento (Importaciones / Plaza)
exports.setPlantillaCompra = async (req, res) => {
    try {
        const pool = await getPool();
        const plaId = parseInt(req.body?.plaId, 10);
        if (!plaId) return res.status(400).json({ error: 'Falta la plantilla' });
        await pool.request()
            .input('C', sql.Int, parseInt(req.params.id, 10))
            .input('P', sql.Int, plaId)
            .query(`
                UPDATE dbo.Wms_Compras SET PlaId = @P WHERE CompId = @C;
                -- si el progreso actual no existe en la plantilla nueva, arranca en su primer paso
                UPDATE c SET c.Progreso = (SELECT TOP 1 Clave FROM dbo.Wms_PlantillasProgresoPasos WHERE PlaId = @P ORDER BY Orden)
                FROM dbo.Wms_Compras c
                WHERE c.CompId = @C
                  AND NOT EXISTS (SELECT 1 FROM dbo.Wms_PlantillasProgresoPasos p WHERE p.PlaId = @P AND p.Clave = c.Progreso);
            `);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /etiquetas/:id/peso { peso, medidaSecundaria } — registro de peso del lote
exports.registrarPeso = async (req, res) => {
    try {
        const peso = req.body?.peso != null && req.body.peso !== '' ? parseFloat(req.body.peso) : null;
        const medida = req.body?.medidaSecundaria != null && req.body.medidaSecundaria !== '' ? parseFloat(req.body.medidaSecundaria) : null;
        if (peso == null && medida == null) return res.status(400).json({ error: 'Nada para registrar' });
        const pool = await getPool();
        const r = await pool.request()
            .input('E', sql.Int, parseInt(req.params.id, 10))
            .input('P', sql.Decimal(18, 3), peso)
            .input('M', sql.Decimal(10, 2), medida)
            .query(`UPDATE dbo.Wms_Etiquetas
                    SET Peso = ISNULL(@P, Peso), MedidaSecundaria = ISNULL(@M, MedidaSecundaria),
                        UltimaActualizacion = GETDATE()
                    WHERE EtiId = @E;
                    SELECT @@ROWCOUNT AS n;`);
        if (!r.recordset[0].n) return res.status(404).json({ error: 'Etiqueta no encontrada' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /etiquetas/:id/baja { cantidad, motivo, nota } — consumo, merma, rotura o venta libre
exports.bajaEtiqueta = async (req, res) => {
    try {
        const cantidad = parseFloat(req.body?.cantidad);
        if (!(cantidad > 0)) return res.status(400).json({ error: 'Cantidad inválida' });
        const motivos = ['baja_consumo', 'egreso_final', 'baja_merma'];
        const motivo = motivos.includes(req.body?.motivo) ? req.body.motivo : 'baja_consumo';
        const r = await svc.bajaManual({
            etiId: parseInt(req.params.id, 10), cantidad, motivo,
            nota: req.body?.nota || null, usuarioId: uid(req),
        });
        logger.info();
        res.json({ success: true, ...r });
    } catch (e) { res.status(400).json({ error: e.message }); }
};

/* ── IMPORTACIONES (expedientes que agrupan compras) ─────────────────────── */

// GET /importaciones — lista con las compras que contiene y su avance
exports.getImportaciones = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT i.ImpId, i.Origen, i.EmpresaImportadora, i.ContactoImportadora,
                   i.EmpresaTransporteLocal, i.ContactoTransporteLocal, i.Estado, i.Progreso,
                   i.PlaId, i.FechaCreacion,
                   pl.Nombre AS Plantilla,
                   pas.Etiqueta AS ProgresoEtiqueta, pas.Orden AS ProgresoOrden,
                   (SELECT COUNT(*) FROM dbo.Wms_PlantillasProgresoPasos p2 WHERE p2.PlaId = i.PlaId) AS TotalPasos,
                   (SELECT COUNT(*) FROM dbo.Wms_Compras c WHERE c.ImportacionId = i.ImpId) AS Compras,
                   ISNULL((SELECT SUM(c.TotalCompra) FROM dbo.Wms_Compras c WHERE c.ImportacionId = i.ImpId), 0) AS TotalCompras,
                   ISNULL((SELECT SUM(pg.Monto) FROM dbo.Wms_Pagos pg WHERE pg.ImpId = i.ImpId), 0) AS Pagado
            FROM dbo.Wms_Importaciones i
            LEFT JOIN dbo.Wms_PlantillasProgreso pl ON pl.PlaId = i.PlaId
            LEFT JOIN dbo.Wms_PlantillasProgresoPasos pas ON pas.PlaId = i.PlaId AND pas.Clave = i.Progreso
            ORDER BY i.ImpId DESC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /importaciones/:id — compras contenidas, pagos y pasos
exports.getImportacionDetalle = async (req, res) => {
    try {
        const pool = await getPool();
        const id = parseInt(req.params.id, 10);
        const [compras, pagos, pasos] = await Promise.all([
            pool.request().input('I', sql.Int, id).query(`
                SELECT c.CompId, c.ReferenciaFactura, c.TotalCompra, c.Progreso, c.Estado,
                       p.Nombre AS Proveedor, m.Codigo AS Moneda, m.Simbolo AS MonedaSimbolo,
                       c.FechaEstimadaArribo, c.VolumenM3, c.PesoKg, c.Incoterm,
                       pas.Etiqueta AS ProgresoEtiqueta
                FROM dbo.Wms_Compras c
                LEFT JOIN dbo.Wms_Proveedores p ON p.PrvId = c.PrvId
                LEFT JOIN dbo.Wms_Monedas m ON m.MonId = c.MonedaId
                LEFT JOIN dbo.Wms_PlantillasProgresoPasos pas ON pas.PlaId = c.PlaId AND pas.Clave = c.Progreso
                WHERE c.ImportacionId = @I ORDER BY c.CompId
            `),
            pool.request().input('I', sql.Int, id).query(`
                SELECT PagId, Monto, TipoPago, Motivo, Fecha FROM dbo.Wms_Pagos WHERE ImpId = @I ORDER BY Fecha
            `),
            pool.request().input('I', sql.Int, id).query(`
                SELECT pas.Clave, pas.Etiqueta, pas.Icono, pas.Orden
                FROM dbo.Wms_PlantillasProgresoPasos pas
                JOIN dbo.Wms_Importaciones i ON i.PlaId = pas.PlaId
                WHERE i.ImpId = @I ORDER BY pas.Orden
            `),
        ]);
        res.json({ success: true, data: { compras: compras.recordset, pagos: pagos.recordset, pasos: pasos.recordset } });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /importaciones — alta del expediente
exports.crearImportacion = async (req, res) => {
    try {
        const { origen, empresaImportadora, contactoImportadora, empresaTransporteLocal, contactoTransporteLocal, plaId } = req.body || {};
        if (!(origen || '').trim()) return res.status(400).json({ error: 'Falta el origen' });
        const pool = await getPool();
        const rIni = await pool.request().input('P', sql.Int, parseInt(plaId, 10) || null)
            .query(`SELECT TOP 1 Clave FROM dbo.Wms_PlantillasProgresoPasos WHERE PlaId = @P ORDER BY Orden`);
        const r = await pool.request()
            .input('O', sql.NVarChar(200), origen.trim())
            .input('EI', sql.NVarChar(200), (empresaImportadora || '').trim() || null)
            .input('CI', sql.NVarChar(200), (contactoImportadora || '').trim() || null)
            .input('ET', sql.NVarChar(200), (empresaTransporteLocal || '').trim() || null)
            .input('CT', sql.NVarChar(200), (contactoTransporteLocal || '').trim() || null)
            .input('P', sql.Int, parseInt(plaId, 10) || null)
            .input('Pro', sql.VarChar(50), rIni.recordset[0]?.Clave || '1')
            .input('U', sql.Int, uid(req))
            .query(`INSERT INTO dbo.Wms_Importaciones
                        (Origen, EmpresaImportadora, ContactoImportadora, EmpresaTransporteLocal, ContactoTransporteLocal, PlaId, Estado, Progreso, CreadoPor)
                    OUTPUT INSERTED.ImpId
                    VALUES (@O, @EI, @CI, @ET, @CT, @P, 'en_transito', @Pro, @U)`);
        res.json({ success: true, impId: r.recordset[0].ImpId });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /importaciones/:id/progreso { clave }
exports.setProgresoImportacion = async (req, res) => {
    try {
        const pool = await getPool();
        const clave = String(req.body?.clave || '').trim();
        if (!clave) return res.status(400).json({ error: 'Falta el paso' });
        await pool.request()
            .input('I', sql.Int, parseInt(req.params.id, 10))
            .input('P', sql.VarChar(50), clave)
            .query(`UPDATE dbo.Wms_Importaciones SET Progreso = @P WHERE ImpId = @I`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /importaciones/:id/compras { compId, quitar } — meter o sacar una compra del expediente
exports.vincularCompraImportacion = async (req, res) => {
    try {
        const pool = await getPool();
        const compId = parseInt(req.body?.compId, 10);
        if (!compId) return res.status(400).json({ error: 'Falta la compra' });
        await pool.request()
            .input('C', sql.Int, compId)
            .input('I', sql.Int, req.body?.quitar ? null : parseInt(req.params.id, 10))
            .query(`UPDATE dbo.Wms_Compras SET ImportacionId = @I WHERE CompId = @C`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// GET /compras/:id/archivos — adjuntos de la compra
exports.getCompraArchivos = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('C', sql.Int, parseInt(req.params.id, 10))
            .query(`SELECT CarId, CompId, NombreOriginal, Archivo, MimeType, Tamano, Descripcion, FechaSubida
                    FROM dbo.Wms_ComprasArchivos WHERE CompId = @C ORDER BY CarId DESC`);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /compras/:id/archivos (multipart: archivo, descripcion) — sube y registra
exports.subirCompraArchivo = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo' });
        const compId = parseInt(req.params.id, 10);
        const pool = await getPool();
        const r = await pool.request()
            .input('C', sql.Int, compId)
            .input('N', sql.NVarChar(255), (req.file.originalname || '').substring(0, 255))
            .input('A', sql.NVarChar(255), req.file.filename)
            .input('M', sql.VarChar(100), req.file.mimetype || null)
            .input('T', sql.Int, req.file.size || null)
            .input('D', sql.NVarChar(200), (req.body?.descripcion || '').trim().substring(0, 200) || null)
            .input('U', sql.Int, uid(req))
            .query(`INSERT INTO dbo.Wms_ComprasArchivos (CompId, NombreOriginal, Archivo, MimeType, Tamano, Descripcion, UsuarioId)
                    OUTPUT INSERTED.CarId VALUES (@C, @N, @A, @M, @T, @D, @U)`);
        logger.info(`[WMS-INT] Adjunto compra ${compId}: ${req.file.originalname} (${req.file.size} bytes)`);
        res.json({ success: true, carId: r.recordset[0].CarId });
    } catch (e) {
        logger.error('Error subirCompraArchivo:', e);
        res.status(500).json({ error: e.message });
    }
};

// DELETE /compras/archivos/:carId — borra el registro y el archivo de disco
exports.borrarCompraArchivo = async (req, res) => {
    try {
        const pool = await getPool();
        const carId = parseInt(req.params.carId, 10);
        const r = await pool.request().input('A', sql.Int, carId)
            .query(`SELECT CompId, Archivo FROM dbo.Wms_ComprasArchivos WHERE CarId = @A`);
        if (!r.recordset.length) return res.status(404).json({ error: 'Archivo no encontrado' });
        const { CompId, Archivo } = r.recordset[0];
        await pool.request().input('A', sql.Int, carId).query(`DELETE FROM dbo.Wms_ComprasArchivos WHERE CarId = @A`);
        try { fs.unlinkSync(path.join(COMPRAS_PATH, String(CompId), Archivo)); } catch (e) { /* ya no estaba */ }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /compras/:id/recibir { depId, lineas:[{cDetId, cantidad}] } — genera etiquetas
exports.recibirCompra = async (req, res) => {
    try {
        const r = await svc.recibirCompra({
            compId: parseInt(req.params.id, 10),
            depId: req.body?.depId,
            lineas: req.body?.lineas || [],
            usuarioId: uid(req),
        });
        logger.info(`[WMS-INT] Recepción compra ${req.params.id}: ${r.etiquetas.length} etiqueta(s)`);
        res.json({ success: true, ...r });
    } catch (e) { res.status(400).json({ error: e.message }); }
};

// GET /discrepancias?estado=PENDIENTE
exports.getDiscrepancias = async (req, res) => {
    try {
        const pool = await getPool();
        const estado = String(req.query.estado || 'PENDIENTE').toUpperCase();
        const r = await pool.request()
            .input('E', sql.VarChar(20), estado)
            .query(`
                SELECT TOP 300 d.DisId, d.VarId, d.DepId, d.Faltante, d.RefTipo, d.RefId, d.Estado,
                       d.Resolucion, d.Fecha, d.FechaResolucion,
                       v.NombreVariante, v.Talle, v.Color, p.Nombre AS Producto, dep.Nombre AS Deposito
                FROM dbo.Wms_Discrepancias d
                JOIN dbo.Wms_Variantes v ON v.VarId = d.VarId
                JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
                LEFT JOIN dbo.Wms_Depositos dep ON dep.DepId = d.DepId
                WHERE d.Estado = @E
                ORDER BY d.DisId DESC
            `);
        res.json({ success: true, data: r.recordset });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// POST /discrepancias/:id/resolver { resolucion }
exports.resolverDiscrepancia = async (req, res) => {
    try {
        const pool = await getPool();
        const resolucion = (req.body?.resolucion || '').trim();
        if (!resolucion) return res.status(400).json({ error: 'Falta la resolución (qué se hizo / qué se encontró)' });
        await pool.request()
            .input('Id', sql.Int, parseInt(req.params.id, 10))
            .input('R', sql.NVarChar(300), resolucion.substring(0, 300))
            .input('U', sql.Int, uid(req))
            .query(`
                UPDATE dbo.Wms_Discrepancias
                SET Estado = 'RESUELTA', Resolucion = @R, FechaResolucion = GETDATE(), UsuarioResolucion = @U
                WHERE DisId = @Id AND Estado = 'PENDIENTE'
            `);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
