const fs = require('fs');
const path = require('path');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { parsearMolde, validarDespiece } = require('../services/moldeParserService');

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  MOLDES ESCALADOS — backend
 * ══════════════════════════════════════════════════════════════════════════
 *  Ruta /moldes (pantalla MoldesPage). Camino aditivo: cuelga de
 *  /api/configurador y no toca nada de lo que ya existe. Modelo en
 *  docs/migrations/moldes_escalados.sql.
 *
 *  El ciclo es de tres pasos y conviene tenerlo claro:
 *   1) SUBIR   → moldeParserService despieza el PDF y se guardan los nidos
 *                SIN nombre. El molde queda en BORRADOR.
 *   2) ROTULAR → el usuario le pone curva y pieza a cada nido. Cuando no
 *                queda ninguno sin rotular, pasa solo a ROTULADO.
 *   3) EXTRAER → "dame el talle 12 de la curva de niño" es una consulta
 *                contra MoldeNidoTalles, sin volver a abrir el PDF.
 *
 *  Por qué el talle NO se elige al rotular: dentro de un nido los contornos
 *  ya están ordenados por tamaño, así que la posición n es el talle de
 *  Orden n de la curva. Rotulando el nido quedan resueltos los 10 talles de
 *  una. Son 30 rótulos y no 300.
 */

const SENTIDOS_HILO = ['RECTO', 'TRANSVERSAL', 'BIES'];

// ─────────────────────────────────────────────────────────────────────────
//  CATÁLOGO DE CURVAS
// ─────────────────────────────────────────────────────────────────────────

// GET /api/configurador/curvas-talle
exports.getCurvas = async (req, res) => {
    try {
        const pool = await getPool();
        const all = req.query.all === '1';
        const [curvas, talles] = await Promise.all([
            pool.request().query(`
                SELECT CurvaID, Codigo, Nombre, Activo, Orden
                FROM dbo.CurvasTalle
                ${all ? '' : 'WHERE Activo = 1'}
                ORDER BY ISNULL(Orden, 999), Codigo`),
            pool.request().query(`
                SELECT ItemID, CurvaID, Talle, Orden, EsBase
                FROM dbo.CurvaTalleItems ORDER BY CurvaID, Orden`)
        ]);
        const data = curvas.recordset.map(c => ({
            ...c,
            talles: talles.recordset.filter(t => t.CurvaID === c.CurvaID)
        }));
        res.json({ success: true, data });
    } catch (e) {
        logger.error('[Moldes] getCurvas:', e);
        res.status(500).json({ error: e.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────
//  MOLDES
// ─────────────────────────────────────────────────────────────────────────

// GET /api/configurador/moldes
exports.getMoldes = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT m.MoldeID, m.Codigo, m.Nombre, m.Version, m.ArchivoNombre, m.Estado,
                   m.AnchoHojaCm, m.AltoHojaCm, m.TrazosTotales, m.NidosDetectados,
                   m.Activo, m.FechaAlta, m.Notas,
                   SUM(CASE WHEN p.PiezaID IS NOT NULL THEN 1 ELSE 0 END) AS Rotuladas,
                   COUNT(p.MoldePiezaID) AS Nidos
            FROM dbo.Moldes m
            LEFT JOIN dbo.MoldePiezas p ON p.MoldeID = m.MoldeID
            WHERE m.Activo = 1
            GROUP BY m.MoldeID, m.Codigo, m.Nombre, m.Version, m.ArchivoNombre, m.Estado,
                     m.AnchoHojaCm, m.AltoHojaCm, m.TrazosTotales, m.NidosDetectados,
                     m.Activo, m.FechaAlta, m.Notas
            ORDER BY m.FechaAlta DESC`);
        res.json({ success: true, data: r.recordset });
    } catch (e) {
        logger.error('[Moldes] getMoldes:', e);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/configurador/moldes/:id — molde + nidos + medidas de cada talle
exports.getMolde = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'MoldeID inválido.' });
    try {
        const pool = await getPool();
        const rq = () => pool.request().input('MID', sql.Int, id);
        const [molde, piezas, talles] = await Promise.all([
            rq().query(`SELECT * FROM dbo.Moldes WHERE MoldeID = @MID`),
            rq().query(`
                SELECT p.MoldePiezaID, p.NidoIndice, p.Bloque, p.CurvaID, p.PiezaID,
                       p.Cantidad, p.Espejada, p.SentidoHilo, p.SvgPath,
                       pz.Codigo AS PiezaCodigo, pz.Nombre AS PiezaNombre,
                       c.Codigo AS CurvaCodigo, c.Nombre AS CurvaNombre
                FROM dbo.MoldePiezas p
                LEFT JOIN dbo.PiezasPrenda pz ON pz.PiezaID = p.PiezaID
                LEFT JOIN dbo.CurvasTalle c ON c.CurvaID = p.CurvaID
                WHERE p.MoldeID = @MID
                ORDER BY p.NidoIndice`),
            rq().query(`
                SELECT t.MoldePiezaID, t.Orden, t.AnchoCm, t.AltoCm, t.AreaCm2
                FROM dbo.MoldeNidoTalles t
                INNER JOIN dbo.MoldePiezas p ON p.MoldePiezaID = t.MoldePiezaID
                WHERE p.MoldeID = @MID
                ORDER BY t.MoldePiezaID, t.Orden`)
        ]);
        if (!molde.recordset.length) return res.status(404).json({ error: 'Molde no encontrado.' });

        res.json({
            success: true,
            data: {
                ...molde.recordset[0],
                piezas: piezas.recordset.map(p => ({
                    ...p,
                    talles: talles.recordset.filter(t => t.MoldePiezaID === p.MoldePiezaID)
                }))
            }
        });
    } catch (e) {
        logger.error('[Moldes] getMolde:', e);
        res.status(500).json({ error: e.message });
    }
};

// POST /api/configurador/moldes — sube el PDF, lo despieza y lo guarda en BORRADOR
exports.subirMolde = async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo.' });

    const rutaFisica = req.file.path;
    const borrarArchivo = () => { try { fs.unlinkSync(rutaFisica); } catch (e) { /* ya no está */ } };

    const nombre = (req.body?.nombre || '').trim() || path.parse(req.file.originalname).name;
    const codigo = (req.body?.codigo || '').trim().toUpperCase();
    const notas = (req.body?.notas || '').trim() || null;
    if (!codigo) { borrarArchivo(); return res.status(400).json({ error: 'El código del molde es obligatorio (ej. MOL-CAMISETA-COSTADILLO).' }); }

    let despiece;
    try {
        despiece = await parsearMolde(rutaFisica);
    } catch (e) {
        borrarArchivo();
        logger.error('[Moldes] parsearMolde:', e);
        return res.status(422).json({ error: 'No se pudo leer el PDF: ' + e.message });
    }

    // Se valida ANTES de escribir nada: un molde escaneado no entra a la base.
    const problema = validarDespiece(despiece);
    if (problema) { borrarArchivo(); return res.status(422).json({ error: problema }); }

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();

        // La versión se calcula sola: subir de nuevo el mismo código es una
        // revisión nueva, no un error. El molde viejo queda con sus rótulos.
        const ver = await new sql.Request(transaction)
            .input('Cod', sql.VarChar(30), codigo)
            .query(`SELECT ISNULL(MAX(Version), 0) + 1 AS Siguiente FROM dbo.Moldes WHERE Codigo = @Cod`);
        const version = ver.recordset[0].Siguiente;

        const ins = await new sql.Request(transaction)
            .input('Cod', sql.VarChar(30), codigo)
            .input('Nom', sql.NVarChar(200), nombre)
            .input('Ver', sql.Int, version)
            .input('Url', sql.VarChar(500), `/uploads/moldes/${req.file.filename}`)
            .input('ArcNom', sql.NVarChar(260), req.file.originalname)
            .input('Ancho', sql.Decimal(9, 2), despiece.anchoHojaCm)
            .input('Alto', sql.Decimal(9, 2), despiece.altoHojaCm)
            .input('Trazos', sql.Int, despiece.trazosTotales)
            .input('Nidos', sql.Int, despiece.nidosDetectados)
            .input('Notas', sql.NVarChar(500), notas)
            .query(`
                INSERT INTO dbo.Moldes (Codigo, Nombre, Version, ArchivoUrl, ArchivoNombre,
                                        AnchoHojaCm, AltoHojaCm, TrazosTotales, NidosDetectados, Notas)
                OUTPUT INSERTED.MoldeID
                VALUES (@Cod, @Nom, @Ver, @Url, @ArcNom, @Ancho, @Alto, @Trazos, @Nidos, @Notas)`);
        const moldeId = ins.recordset[0].MoldeID;

        for (const p of despiece.piezas) {
            const rp = await new sql.Request(transaction)
                .input('MID', sql.Int, moldeId)
                .input('Nido', sql.Int, p.nidoIndice)
                .input('Blo', sql.Int, p.bloque)
                .input('Svg', sql.NVarChar(sql.MAX), p.svgPath)
                .input('Ord', sql.Int, p.nidoIndice)
                .query(`
                    INSERT INTO dbo.MoldePiezas (MoldeID, NidoIndice, Bloque, SvgPath, Orden)
                    OUTPUT INSERTED.MoldePiezaID
                    VALUES (@MID, @Nido, @Blo, @Svg, @Ord)`);
            const piezaId = rp.recordset[0].MoldePiezaID;

            for (const t of p.talles) {
                await new sql.Request(transaction)
                    .input('PID', sql.Int, piezaId)
                    .input('Ord', sql.Int, t.orden)
                    .input('A', sql.Decimal(9, 2), t.anchoCm)
                    .input('H', sql.Decimal(9, 2), t.altoCm)
                    .input('Ar', sql.Decimal(12, 2), t.areaCm2)
                    .query(`INSERT INTO dbo.MoldeNidoTalles (MoldePiezaID, Orden, AnchoCm, AltoCm, AreaCm2)
                            VALUES (@PID, @Ord, @A, @H, @Ar)`);
            }
        }

        await transaction.commit();
        logger.info(`[Moldes] ${codigo} v${version}: ${despiece.nidosDetectados} nidos en ${despiece.bandas} banda(s), por ${req.user?.username || 'N/A'}`);
        res.json({ success: true, moldeId, version, despiece: { ...despiece, piezas: undefined } });
    } catch (e) {
        try { await transaction.rollback(); } catch (re) { /* ya cerrada */ }
        borrarArchivo();
        if (/UQ_Moldes/.test(e.message)) return res.status(409).json({ error: 'Ya existe un molde con ese código y esa versión.' });
        logger.error('[Moldes] subirMolde:', e);
        res.status(500).json({ error: e.message });
    }
};

// PUT /api/configurador/moldes/:id/piezas — rotula uno o varios nidos de una.
// Body: { rotulos: [{ nidoIndice, curvaId, piezaId, cantidad, espejada, sentidoHilo }] }
// Un piezaId en null borra el rótulo (vuelve el nido a "sin rotular").
exports.rotularPiezas = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'MoldeID inválido.' });
    const rotulos = Array.isArray(req.body?.rotulos) ? req.body.rotulos : [];
    if (!rotulos.length) return res.status(400).json({ error: 'No vino ningún rótulo.' });

    for (const r of rotulos) {
        if (!Number.isInteger(Number(r.nidoIndice))) return res.status(400).json({ error: 'Hay un rótulo sin nidoIndice.' });
        if (r.sentidoHilo && !SENTIDOS_HILO.includes(r.sentidoHilo)) {
            return res.status(400).json({ error: `Sentido de hilo inválido (${SENTIDOS_HILO.join(' | ')}).` });
        }
    }

    const pool = await getPool();

    // Los nidos se validan ANTES de abrir la transacción: pedir un nido que no
    // existe es un error del que llama, no una falla del servidor, y tiene que
    // contestar 404 con el detalle en vez de un 500 genérico.
    const existentes = await pool.request()
        .input('MID', sql.Int, id)
        .query(`SELECT NidoIndice FROM dbo.MoldePiezas WHERE MoldeID = @MID`);
    const validos = new Set(existentes.recordset.map(x => x.NidoIndice));
    const faltantes = rotulos.map(r => Number(r.nidoIndice)).filter(n => !validos.has(n));
    if (faltantes.length) {
        return res.status(404).json({ error: `Este molde no tiene el nido ${[...new Set(faltantes)].join(', ')}.` });
    }

    const transaction = new sql.Transaction(pool);
    try {
        await transaction.begin();
        for (const r of rotulos) {
            const upd = await new sql.Request(transaction)
                .input('MID', sql.Int, id)
                .input('Nido', sql.Int, Number(r.nidoIndice))
                .input('Curva', sql.Int, r.curvaId ? Number(r.curvaId) : null)
                .input('Pieza', sql.Int, r.piezaId ? Number(r.piezaId) : null)
                .input('Cant', sql.Int, Number.isInteger(Number(r.cantidad)) && Number(r.cantidad) > 0 ? Number(r.cantidad) : 1)
                .input('Esp', sql.Bit, r.espejada ? 1 : 0)
                .input('Hilo', sql.VarChar(15), r.sentidoHilo || 'RECTO')
                .query(`
                    UPDATE dbo.MoldePiezas
                    SET CurvaID = @Curva, PiezaID = @Pieza, Cantidad = @Cant,
                        Espejada = @Esp, SentidoHilo = @Hilo
                    WHERE MoldeID = @MID AND NidoIndice = @Nido`);
            // Red de seguridad: ya se validó arriba, así que llegar acá sólo
            // puede pasar si alguien borró el nido entre medio. Aborta el lote.
            if (!upd.rowsAffected[0]) {
                throw new Error(`El nido ${r.nidoIndice} desapareció mientras se guardaba.`);
            }
        }

        // El estado lo maneja el sistema, no el usuario: ROTULADO cuando no
        // queda ningún nido sin pieza o sin curva.
        await new sql.Request(transaction)
            .input('MID', sql.Int, id)
            .query(`
                UPDATE dbo.Moldes
                SET Estado = CASE WHEN EXISTS (
                        SELECT 1 FROM dbo.MoldePiezas
                        WHERE MoldeID = @MID AND (PiezaID IS NULL OR CurvaID IS NULL)
                    ) THEN 'BORRADOR' ELSE 'ROTULADO' END,
                    FechaModif = GETDATE()
                WHERE MoldeID = @MID`);

        await transaction.commit();
        res.json({ success: true });
    } catch (e) {
        try { await transaction.rollback(); } catch (re) { /* ya cerrada */ }
        logger.error('[Moldes] rotularPiezas:', e);
        res.status(500).json({ error: e.message });
    }
};

// GET /api/configurador/moldes/:id/extraer?curvaId=&talle=
// Las piezas de UN talle de UNA curva, con su medida real. Sin tocar el PDF.
exports.extraerTalle = async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const curvaId = parseInt(req.query.curvaId, 10);
    const talle = (req.query.talle || '').trim();
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'MoldeID inválido.' });
    if (!Number.isInteger(curvaId)) return res.status(400).json({ error: 'Falta la curva.' });
    if (!talle) return res.status(400).json({ error: 'Falta el talle.' });

    try {
        const pool = await getPool();

        // Primero el talle → su Orden dentro de la curva. Ese Orden es la
        // posición del contorno dentro del nido: ahí está todo el truco.
        const ord = await pool.request()
            .input('CID', sql.Int, curvaId)
            .input('Talle', sql.VarChar(20), talle)
            .query(`SELECT Orden FROM dbo.CurvaTalleItems WHERE CurvaID = @CID AND Talle = @Talle`);
        if (!ord.recordset.length) {
            return res.status(404).json({ error: `El talle "${talle}" no existe en esa curva.` });
        }

        const r = await pool.request()
            .input('MID', sql.Int, id)
            .input('CID', sql.Int, curvaId)
            .input('Orden', sql.Int, ord.recordset[0].Orden)
            .query(`
                SELECT p.MoldePiezaID, p.NidoIndice, p.Cantidad, p.Espejada, p.SentidoHilo, p.SvgPath,
                       pz.Codigo AS PiezaCodigo, pz.Nombre AS PiezaNombre,
                       t.AnchoCm, t.AltoCm, t.AreaCm2,
                       t.AreaCm2 * p.Cantidad AS AreaTotalCm2
                FROM dbo.MoldePiezas p
                INNER JOIN dbo.PiezasPrenda pz ON pz.PiezaID = p.PiezaID
                INNER JOIN dbo.MoldeNidoTalles t
                        ON t.MoldePiezaID = p.MoldePiezaID AND t.Orden = @Orden
                WHERE p.MoldeID = @MID AND p.CurvaID = @CID
                ORDER BY p.NidoIndice`);

        if (!r.recordset.length) {
            return res.status(404).json({ error: 'No hay ninguna pieza rotulada con esa curva en este molde.' });
        }
        const totalCm2 = r.recordset.reduce((a, p) => a + Number(p.AreaTotalCm2 || 0), 0);
        res.json({ success: true, data: { talle, piezas: r.recordset, totalCm2: Math.round(totalCm2) } });
    } catch (e) {
        logger.error('[Moldes] extraerTalle:', e);
        res.status(500).json({ error: e.message });
    }
};
