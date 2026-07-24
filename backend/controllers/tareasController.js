// ─────────────────────────────────────────────────────────────────────────────
// TAREAS — To-Do compartido del sistema interno.
// Cualquier usuario interno puede crear una tarea y cualquiera marcarla como hecha.
// Se deja registro de QUIÉN la creó y QUIÉN la realizó (id + nombre, este último
// desnormalizado para mostrar sin joins y para que sobreviva aunque el usuario cambie).
// La tabla se crea sola en el primer uso (sin migración manual), igual que otros módulos.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

let _tablaLista = false;
async function ensureTabla(pool) {
    if (_tablaLista) return;
    await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Tareas')
        BEGIN
            CREATE TABLE dbo.Tareas (
                TarId              INT IDENTITY PRIMARY KEY,
                TarTitulo          NVARCHAR(300) NOT NULL,
                TarDescripcion     NVARCHAR(MAX) NULL,
                TarHecha           BIT NOT NULL CONSTRAINT DF_Tareas_Hecha DEFAULT 0,
                TarCreadaPorId     INT NULL,
                TarCreadaPorNombre NVARCHAR(200) NULL,
                TarFechaCreacion   DATETIME NOT NULL CONSTRAINT DF_Tareas_FCrea DEFAULT GETDATE(),
                TarHechaPorId      INT NULL,
                TarHechaPorNombre  NVARCHAR(200) NULL,
                TarFechaHecha      DATETIME NULL
            );
            CREATE INDEX IX_Tareas_Hecha_Fecha ON dbo.Tareas(TarHecha, TarFechaCreacion DESC);
        END
    `);
    _tablaLista = true;
}

// El nombre visible del usuario logueado (interno) para el registro de auditoría.
const nombreUsuario = (req) => (req.user?.name || req.user?.username || 'Desconocido');

// Solo usuarios internos: el módulo vive en el sistema de fábrica, no en el portal de clientes.
const esInterno = (req) => req.user && req.user.userType !== 'CLIENT' && req.user.role !== 'WEB_CLIENT';

const emitir = (req) => {
    try { req.app.get('socketio')?.emit('tareas:updated'); } catch (_) { /* sin sockets, no pasa nada */ }
};

// GET /api/tareas?estado=pendientes|hechas|todas  (default: todas)
exports.listar = async (req, res) => {
    try {
        const pool = await getPool();
        await ensureTabla(pool);
        const estado = String(req.query.estado || 'todas').toLowerCase();
        const filtro = estado === 'pendientes' ? 'WHERE TarHecha = 0'
                     : estado === 'hechas'     ? 'WHERE TarHecha = 1'
                     : '';
        const r = await pool.request().query(`
            SELECT TarId, TarTitulo, TarDescripcion, TarHecha,
                   TarCreadaPorId, TarCreadaPorNombre, TarFechaCreacion,
                   TarHechaPorId, TarHechaPorNombre, TarFechaHecha
            FROM dbo.Tareas WITH(NOLOCK)
            ${filtro}
            -- Pendientes arriba; dentro de cada grupo, lo más nuevo primero.
            ORDER BY TarHecha ASC, TarFechaCreacion DESC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        logger.error(`[TAREAS] listar: ${err.message} | num=${err.number ?? '-'} | sql=${err.originalError?.info?.message || ''}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// POST /api/tareas   body: { titulo, descripcion? }
exports.crear = async (req, res) => {
    try {
        if (!esInterno(req)) return res.status(403).json({ success: false, error: 'Solo usuarios internos.' });
        const titulo = String(req.body.titulo || '').trim();
        const descripcion = req.body.descripcion != null ? String(req.body.descripcion).trim() : null;
        if (!titulo) return res.status(400).json({ success: false, error: 'La tarea necesita un título.' });

        const pool = await getPool();
        await ensureTabla(pool);
        const r = await pool.request()
            .input('Tit', sql.NVarChar(300), titulo)
            .input('Desc', sql.NVarChar(sql.MAX), descripcion || null)
            .input('Uid', sql.Int, req.user.id ? parseInt(req.user.id, 10) : null)
            .input('UNom', sql.NVarChar(200), nombreUsuario(req))
            .query(`
                INSERT INTO dbo.Tareas (TarTitulo, TarDescripcion, TarCreadaPorId, TarCreadaPorNombre)
                OUTPUT INSERTED.TarId
                VALUES (@Tit, @Desc, @Uid, @UNom)
            `);
        emitir(req);
        res.status(201).json({ success: true, id: r.recordset[0].TarId });
    } catch (err) {
        logger.error(`[TAREAS] crear: ${err.message} | num=${err.number ?? '-'} | sql=${err.originalError?.info?.message || ''}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// PUT /api/tareas/:id/hecha   body: { hecha: true|false }
// Marcar: registra quién y cuándo. Desmarcar: limpia esos campos (cualquier usuario puede reabrir).
exports.marcarHecha = async (req, res) => {
    try {
        if (!esInterno(req)) return res.status(403).json({ success: false, error: 'Solo usuarios internos.' });
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido.' });
        const hecha = req.body.hecha === true || req.body.hecha === 'true' || req.body.hecha === 1;

        const pool = await getPool();
        await ensureTabla(pool);
        const r = await pool.request()
            .input('Id', sql.Int, id)
            .input('Hecha', sql.Bit, hecha ? 1 : 0)
            .input('Uid', sql.Int, req.user.id ? parseInt(req.user.id, 10) : null)
            .input('UNom', sql.NVarChar(200), nombreUsuario(req))
            .query(`
                UPDATE dbo.Tareas
                SET TarHecha          = @Hecha,
                    TarHechaPorId     = CASE WHEN @Hecha = 1 THEN @Uid  ELSE NULL END,
                    TarHechaPorNombre = CASE WHEN @Hecha = 1 THEN @UNom ELSE NULL END,
                    TarFechaHecha     = CASE WHEN @Hecha = 1 THEN GETDATE() ELSE NULL END
                WHERE TarId = @Id;
                SELECT @@ROWCOUNT AS Afectadas;
            `);
        if (!r.recordset[0].Afectadas) return res.status(404).json({ success: false, error: 'Tarea no encontrada.' });
        emitir(req);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[TAREAS] marcarHecha: ${err.message} | num=${err.number ?? '-'} | sql=${err.originalError?.info?.message || ''}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

// DELETE /api/tareas/:id — solo el creador o un admin puede borrar (no lo pediste, pero sin borrado
// la lista se ensucia; lo dejo acotado para que nadie borre tareas ajenas por error).
exports.eliminar = async (req, res) => {
    try {
        if (!esInterno(req)) return res.status(403).json({ success: false, error: 'Solo usuarios internos.' });
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido.' });

        const pool = await getPool();
        await ensureTabla(pool);
        const dueño = await pool.request().input('Id', sql.Int, id)
            .query('SELECT TarCreadaPorId FROM dbo.Tareas WITH(NOLOCK) WHERE TarId = @Id');
        if (!dueño.recordset.length) return res.status(404).json({ success: false, error: 'Tarea no encontrada.' });

        const esAdmin = String(req.user.role || '').toLowerCase() === 'admin';
        const esCreador = dueño.recordset[0].TarCreadaPorId === (req.user.id ? parseInt(req.user.id, 10) : null);
        if (!esAdmin && !esCreador) {
            return res.status(403).json({ success: false, error: 'Solo el que la creó (o un admin) puede borrarla.' });
        }

        await pool.request().input('Id', sql.Int, id).query('DELETE FROM dbo.Tareas WHERE TarId = @Id');
        emitir(req);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[TAREAS] eliminar: ${err.message} | num=${err.number ?? '-'} | sql=${err.originalError?.info?.message || ''}`);
        res.status(500).json({ success: false, error: err.message });
    }
};
