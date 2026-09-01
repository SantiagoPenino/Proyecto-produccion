/**
 * PRESUPUESTOS Y HOJAS MEMBRETADAS (/ventas/presupuestos)
 * ──────────────────────────────────────────────────────────────────────────
 * Reemplaza la app HTML suelta del escritorio ("Presupuestoy Membretada.html"):
 * ahí la numeración y el historial vivían en el localStorage de CADA PC — se
 * perdían al limpiar el navegador, no se compartían y dos máquinas podían
 * emitir el mismo número. Acá la numeración es GLOBAL y transaccional, y el
 * historial queda en la base.
 *
 * Decisiones (26/08, Santiago):
 *  - Ítems: texto libre O elegidos del catálogo de precios (PreciosListaPublica),
 *    siempre editables después de elegir.
 *  - Visibilidad: cada vendedor ve SOLO sus presupuestos (rol 1 ve todo).
 *  - Numeración global por año y tipo: 2026-PRES-0001 / 2026-NOTA-0001.
 *  - La hoja membretada también queda registrada (PreTipo = 'MEMBRETE').
 *  - Moneda a elección por documento (UYU/USD).
 *
 * El esquema se auto-crea (mismo patrón que priceListSync / ensureFallaColumn):
 * el deploy no necesita correr SQL a mano.
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// ─── Esquema ──────────────────────────────────────────────────────────────
let tablasOk = false;
async function ensureTablas(pool) {
    if (tablasOk) return;
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Presupuestos')
        BEGIN
            CREATE TABLE dbo.Presupuestos (
                PreId           INT IDENTITY PRIMARY KEY,
                PreNumero       VARCHAR(20)  NOT NULL,
                PreTipo         VARCHAR(12)  NOT NULL DEFAULT 'PRESUPUESTO', -- PRESUPUESTO | MEMBRETE
                UsuarioId       INT          NOT NULL,
                VendedorNombre  NVARCHAR(120) NULL,          -- foto del nombre al emitir
                ClienteNombre   NVARCHAR(200) NULL,
                ClienteContacto NVARCHAR(200) NULL,
                ClienteRut      NVARCHAR(60)  NULL,
                ClienteTel      NVARCHAR(60)  NULL,
                Moneda          VARCHAR(3)   NOT NULL DEFAULT 'UYU',
                Validez         NVARCHAR(60)  NULL,
                Condiciones     NVARCHAR(MAX) NULL,          -- JSON: ["línea", ...]
                Asunto          NVARCHAR(300) NULL,          -- membrete
                Cuerpo          NVARCHAR(MAX) NULL,          -- membrete
                FirmaCargo      NVARCHAR(120) NULL,          -- membrete
                Total           DECIMAL(18,2) NULL,
                Estado          VARCHAR(15)  NOT NULL DEFAULT 'EMITIDO',   -- EMITIDO|APROBADO|RECHAZADO|VENCIDO|ANULADO
                FechaEmision    DATETIME     NOT NULL DEFAULT GETDATE(),
                FechaActualiza  DATETIME     NULL,
                CONSTRAINT UQ_Presupuestos_Numero UNIQUE (PreNumero)
            );
            CREATE INDEX IX_Presupuestos_Usuario ON dbo.Presupuestos(UsuarioId, PreTipo, FechaEmision DESC);
        END;

        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PresupuestosDetalle')
        BEGIN
            CREATE TABLE dbo.PresupuestosDetalle (
                PDeId          INT IDENTITY PRIMARY KEY,
                PreId          INT NOT NULL REFERENCES dbo.Presupuestos(PreId),
                Orden          INT NOT NULL DEFAULT 0,
                Descripcion    NVARCHAR(400) NOT NULL,
                Detalle        NVARCHAR(400) NULL,           -- la línea chica bajo la descripción
                Cantidad       DECIMAL(18,2) NOT NULL DEFAULT 1,
                PrecioUnitario DECIMAL(18,2) NOT NULL DEFAULT 0,
                Subtotal       DECIMAL(18,2) NOT NULL DEFAULT 0
            );
            CREATE INDEX IX_PresupuestosDetalle_Pre ON dbo.PresupuestosDetalle(PreId);
        END;
    `);
    tablasOk = true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const esAdmin = (u) => parseInt(u?.idRol, 10) === 1;

// Los subtotales y el total se recalculan SIEMPRE acá: el front los muestra en
// vivo, pero lo que se guarda no depende de lo que mande el navegador (la app
// vieja dejaba tipear el total a mano — un typo salía impreso y firmado).
function normalizarItems(items) {
    return (Array.isArray(items) ? items : [])
        .map((it, i) => {
            const cantidad = Math.round((parseFloat(it.cantidad) || 0) * 100) / 100;
            const precio   = Math.round((parseFloat(it.precio) || 0) * 100) / 100;
            return {
                orden: i,
                descripcion: String(it.descripcion || '').trim().substring(0, 400),
                detalle: it.detalle ? String(it.detalle).trim().substring(0, 400) : null,
                cantidad, precio,
                subtotal: Math.round(cantidad * precio * 100) / 100,
            };
        })
        .filter(it => it.descripcion);
}

// Numeración global por año y tipo, dentro de la transacción del alta.
// El UPDLOCK+HOLDLOCK serializa dos altas simultáneas: nunca dos iguales.
async function proximoNumero(tx, tipo) {
    const year = new Date().getFullYear();
    const prefijo = `${year}-${tipo === 'MEMBRETE' ? 'NOTA' : 'PRES'}-`;
    const r = await new sql.Request(tx)
        .input('pref', sql.VarChar(20), prefijo + '%')
        .query(`
            SELECT ISNULL(MAX(CAST(RIGHT(PreNumero, 4) AS INT)), 0) AS ultimo
            FROM dbo.Presupuestos WITH (UPDLOCK, HOLDLOCK)
            WHERE PreNumero LIKE @pref
        `);
    const n = (r.recordset[0].ultimo || 0) + 1;
    return prefijo + String(n).padStart(4, '0');
}

async function cargarItems(pool, preIds) {
    if (!preIds.length) return {};
    const r = await pool.request().query(`
        SELECT PreId, PDeId, Orden, Descripcion, Detalle, Cantidad, PrecioUnitario, Subtotal
        FROM dbo.PresupuestosDetalle
        WHERE PreId IN (${preIds.map(Number).filter(Boolean).join(',')})
        ORDER BY PreId, Orden
    `);
    const porPre = {};
    for (const it of r.recordset) {
        (porPre[it.PreId] = porPre[it.PreId] || []).push(it);
    }
    return porPre;
}

// ─── Catálogo de productos con precio ────────────────────────────────────
// La misma fuente que la lista de precios pública. Elegir uno precarga el
// ítem (descripción + precio); todo sigue editable.
exports.getCatalogo = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(`
            SELECT Id, Familia, Producto, Descripcion, Precio, Moneda
            FROM dbo.PreciosListaPublica WITH (NOLOCK)
            WHERE Activo = 1
            ORDER BY Familia, Producto
        `);
        res.json(r.recordset);
    } catch (e) {
        logger.error('[PRESUPUESTOS] getCatalogo:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── Cotización del día ───────────────────────────────────────────────────
// La misma fuente que usa la caja: al cambiar la moneda del presupuesto, el
// front convierte los precios con este valor (antes solo cambiaba el símbolo).
exports.getCotizacion = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query(
            'SELECT TOP 1 CotDolar, CotFecha FROM dbo.Cotizaciones WITH (NOLOCK) ORDER BY CotFecha DESC'
        );
        res.json({ dolar: parseFloat(r.recordset[0]?.CotDolar) || null, fecha: r.recordset[0]?.CotFecha || null });
    } catch (e) {
        logger.error('[PRESUPUESTOS] getCotizacion:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── Listado (historial) ──────────────────────────────────────────────────
exports.list = async (req, res) => {
    try {
        const pool = await getPool();
        await ensureTablas(pool);
        const { tipo, q } = req.query;

        const request = pool.request();
        let where = "WHERE Estado <> 'ANULADO'";
        // Cada vendedor ve SOLO lo suyo; Acceso Total (rol 1) ve todo.
        if (!esAdmin(req.user)) {
            request.input('uid', sql.Int, parseInt(req.user.id, 10) || 0);
            where += ' AND UsuarioId = @uid';
        }
        if (tipo === 'PRESUPUESTO' || tipo === 'MEMBRETE') {
            request.input('tipo', sql.VarChar(12), tipo);
            where += ' AND PreTipo = @tipo';
        }
        if (q && String(q).trim()) {
            request.input('q', sql.NVarChar(200), `%${String(q).trim().substring(0, 100)}%`);
            where += ' AND (PreNumero LIKE @q OR ClienteNombre LIKE @q OR VendedorNombre LIKE @q)';
        }

        const r = await request.query(`
            SELECT TOP 300 PreId, PreNumero, PreTipo, UsuarioId, VendedorNombre,
                   ClienteNombre, Moneda, Total, Estado, FechaEmision, Asunto
            FROM dbo.Presupuestos
            ${where}
            ORDER BY FechaEmision DESC
        `);
        res.json(r.recordset);
    } catch (e) {
        logger.error('[PRESUPUESTOS] list:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── Detalle ──────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
    try {
        const pool = await getPool();
        await ensureTablas(pool);
        const id = parseInt(req.params.id, 10);
        const r = await pool.request().input('id', sql.Int, id)
            .query('SELECT * FROM dbo.Presupuestos WHERE PreId = @id');
        if (!r.recordset.length) return res.status(404).json({ error: 'No existe' });
        const pre = r.recordset[0];
        if (!esAdmin(req.user) && pre.UsuarioId !== (parseInt(req.user.id, 10) || 0)) {
            return res.status(403).json({ error: 'Este presupuesto es de otro vendedor.' });
        }
        const items = await cargarItems(pool, [id]);
        res.json({ ...pre, items: items[id] || [] });
    } catch (e) {
        logger.error('[PRESUPUESTOS] getOne:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── Alta ─────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
    const pool = await getPool();
    await ensureTablas(pool);
    const tx = new sql.Transaction(pool);
    try {
        const b = req.body || {};
        const tipo = b.tipo === 'MEMBRETE' ? 'MEMBRETE' : 'PRESUPUESTO';
        const items = normalizarItems(b.items);
        if (tipo === 'PRESUPUESTO' && !items.length) {
            return res.status(400).json({ error: 'El presupuesto necesita al menos un ítem.' });
        }
        const total = items.reduce((s, it) => s + it.subtotal, 0);

        await tx.begin();
        const numero = await proximoNumero(tx, tipo);

        const ins = await new sql.Request(tx)
            .input('num',   sql.VarChar(20),   numero)
            .input('tipo',  sql.VarChar(12),   tipo)
            .input('uid',   sql.Int,           parseInt(req.user.id, 10) || 0)
            // El nombre visible lo puede editar el emisor (un admin emite a nombre de
            // un vendedor); si no viene, cae al nombre del token.
            .input('vend',  sql.NVarChar(120), String(b.vendedorNombre || req.user.name || req.user.username || '').trim().substring(0, 120))
            .input('cli',   sql.NVarChar(200), b.clienteNombre ? String(b.clienteNombre).substring(0, 200) : null)
            .input('cont',  sql.NVarChar(200), b.clienteContacto ? String(b.clienteContacto).substring(0, 200) : null)
            .input('rut',   sql.NVarChar(60),  b.clienteRut ? String(b.clienteRut).substring(0, 60) : null)
            .input('tel',   sql.NVarChar(60),  b.clienteTel ? String(b.clienteTel).substring(0, 60) : null)
            .input('mon',   sql.VarChar(3),    b.moneda === 'USD' ? 'USD' : 'UYU')
            .input('val',   sql.NVarChar(60),  b.validez ? String(b.validez).substring(0, 60) : null)
            .input('cond',  sql.NVarChar(sql.MAX), Array.isArray(b.condiciones) ? JSON.stringify(b.condiciones) : null)
            .input('asu',   sql.NVarChar(300), b.asunto ? String(b.asunto).substring(0, 300) : null)
            .input('cue',   sql.NVarChar(sql.MAX), b.cuerpo ? String(b.cuerpo) : null)
            .input('firma', sql.NVarChar(120), b.firmaCargo ? String(b.firmaCargo).substring(0, 120) : null)
            .input('tot',   sql.Decimal(18, 2), Math.round(total * 100) / 100)
            .query(`
                INSERT INTO dbo.Presupuestos
                    (PreNumero, PreTipo, UsuarioId, VendedorNombre, ClienteNombre, ClienteContacto,
                     ClienteRut, ClienteTel, Moneda, Validez, Condiciones, Asunto, Cuerpo, FirmaCargo, Total)
                OUTPUT INSERTED.PreId, INSERTED.PreNumero, INSERTED.FechaEmision
                VALUES (@num, @tipo, @uid, @vend, @cli, @cont, @rut, @tel, @mon, @val, @cond, @asu, @cue, @firma, @tot)
            `);

        const preId = ins.recordset[0].PreId;
        for (const it of items) {
            await new sql.Request(tx)
                .input('pre',  sql.Int, preId)
                .input('ord',  sql.Int, it.orden)
                .input('desc', sql.NVarChar(400), it.descripcion)
                .input('det',  sql.NVarChar(400), it.detalle)
                .input('cant', sql.Decimal(18, 2), it.cantidad)
                .input('pu',   sql.Decimal(18, 2), it.precio)
                .input('sub',  sql.Decimal(18, 2), it.subtotal)
                .query(`
                    INSERT INTO dbo.PresupuestosDetalle (PreId, Orden, Descripcion, Detalle, Cantidad, PrecioUnitario, Subtotal)
                    VALUES (@pre, @ord, @desc, @det, @cant, @pu, @sub)
                `);
        }
        await tx.commit();
        logger.info(`[PRESUPUESTOS] ${numero} creado por ${req.user.username || req.user.id} (${items.length} ítems, total ${total.toFixed(2)})`);
        res.json({ PreId: preId, PreNumero: numero, FechaEmision: ins.recordset[0].FechaEmision, Total: total });
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* noop */ }
        logger.error('[PRESUPUESTOS] create:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── Edición (mismo número; pisa cabecera e ítems) ────────────────────────
exports.update = async (req, res) => {
    const pool = await getPool();
    await ensureTablas(pool);
    const tx = new sql.Transaction(pool);
    try {
        const id = parseInt(req.params.id, 10);
        const b = req.body || {};

        const cur = await pool.request().input('id', sql.Int, id)
            .query('SELECT PreId, PreTipo, UsuarioId FROM dbo.Presupuestos WHERE PreId = @id');
        if (!cur.recordset.length) return res.status(404).json({ error: 'No existe' });
        const pre = cur.recordset[0];
        if (!esAdmin(req.user) && pre.UsuarioId !== (parseInt(req.user.id, 10) || 0)) {
            return res.status(403).json({ error: 'Este presupuesto es de otro vendedor.' });
        }

        const items = normalizarItems(b.items);
        if (pre.PreTipo === 'PRESUPUESTO' && !items.length) {
            return res.status(400).json({ error: 'El presupuesto necesita al menos un ítem.' });
        }
        const total = items.reduce((s, it) => s + it.subtotal, 0);

        await tx.begin();
        await new sql.Request(tx)
            .input('id',    sql.Int, id)
            .input('cli',   sql.NVarChar(200), b.clienteNombre ? String(b.clienteNombre).substring(0, 200) : null)
            .input('cont',  sql.NVarChar(200), b.clienteContacto ? String(b.clienteContacto).substring(0, 200) : null)
            .input('rut',   sql.NVarChar(60),  b.clienteRut ? String(b.clienteRut).substring(0, 60) : null)
            .input('tel',   sql.NVarChar(60),  b.clienteTel ? String(b.clienteTel).substring(0, 60) : null)
            .input('mon',   sql.VarChar(3),    b.moneda === 'USD' ? 'USD' : 'UYU')
            .input('val',   sql.NVarChar(60),  b.validez ? String(b.validez).substring(0, 60) : null)
            .input('cond',  sql.NVarChar(sql.MAX), Array.isArray(b.condiciones) ? JSON.stringify(b.condiciones) : null)
            .input('asu',   sql.NVarChar(300), b.asunto ? String(b.asunto).substring(0, 300) : null)
            .input('cue',   sql.NVarChar(sql.MAX), b.cuerpo ? String(b.cuerpo) : null)
            .input('firma', sql.NVarChar(120), b.firmaCargo ? String(b.firmaCargo).substring(0, 120) : null)
            .input('vend',  sql.NVarChar(120), b.vendedorNombre ? String(b.vendedorNombre).trim().substring(0, 120) : null)
            .input('tot',   sql.Decimal(18, 2), Math.round(total * 100) / 100)
            .query(`
                UPDATE dbo.Presupuestos
                SET ClienteNombre = @cli, ClienteContacto = @cont, ClienteRut = @rut, ClienteTel = @tel,
                    Moneda = @mon, Validez = @val, Condiciones = @cond, Asunto = @asu, Cuerpo = @cue,
                    FirmaCargo = @firma, VendedorNombre = ISNULL(@vend, VendedorNombre),
                    Total = @tot, FechaActualiza = GETDATE()
                WHERE PreId = @id
            `);
        await new sql.Request(tx).input('id', sql.Int, id)
            .query('DELETE FROM dbo.PresupuestosDetalle WHERE PreId = @id');
        for (const it of items) {
            await new sql.Request(tx)
                .input('pre',  sql.Int, id)
                .input('ord',  sql.Int, it.orden)
                .input('desc', sql.NVarChar(400), it.descripcion)
                .input('det',  sql.NVarChar(400), it.detalle)
                .input('cant', sql.Decimal(18, 2), it.cantidad)
                .input('pu',   sql.Decimal(18, 2), it.precio)
                .input('sub',  sql.Decimal(18, 2), it.subtotal)
                .query(`
                    INSERT INTO dbo.PresupuestosDetalle (PreId, Orden, Descripcion, Detalle, Cantidad, PrecioUnitario, Subtotal)
                    VALUES (@pre, @ord, @desc, @det, @cant, @pu, @sub)
                `);
        }
        await tx.commit();
        res.json({ ok: true, Total: total });
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* noop */ }
        logger.error('[PRESUPUESTOS] update:', e.message);
        res.status(500).json({ error: e.message });
    }
};

// ─── Estado (aprobado / rechazado / vencido / anulado) ────────────────────
exports.setEstado = async (req, res) => {
    try {
        const pool = await getPool();
        await ensureTablas(pool);
        const id = parseInt(req.params.id, 10);
        const estado = String(req.body?.estado || '').toUpperCase();
        if (!['EMITIDO', 'APROBADO', 'RECHAZADO', 'VENCIDO', 'ANULADO'].includes(estado)) {
            return res.status(400).json({ error: 'Estado inválido' });
        }
        const request = pool.request().input('id', sql.Int, id).input('est', sql.VarChar(15), estado);
        let where = 'PreId = @id';
        if (!esAdmin(req.user)) {
            request.input('uid', sql.Int, parseInt(req.user.id, 10) || 0);
            where += ' AND UsuarioId = @uid';
        }
        const r = await request.query(`UPDATE dbo.Presupuestos SET Estado = @est, FechaActualiza = GETDATE() WHERE ${where}`);
        if (!r.rowsAffected[0]) return res.status(403).json({ error: 'No encontrado o de otro vendedor.' });
        res.json({ ok: true });
    } catch (e) {
        logger.error('[PRESUPUESTOS] setEstado:', e.message);
        res.status(500).json({ error: e.message });
    }
};
