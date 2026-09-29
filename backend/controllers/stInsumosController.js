// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO TÉCNICO — insumos y repuestos del stock propio (/stock, tablas Wms_*). Etapa 4.
// Plan: docs/servicio-tecnico-plan.md · Tabla: docs/servicio-tecnico/st-etapa4.sql
//
// Cada uso se descuenta del depósito elegido con wmsInternoService.egresarVenta (FIFO entre lotes,
// idempotente por referencia) como 'baja_consumo' con RefTipo 'ST_USO' y RefId = UsoId: en /stock
// aparece como consumo del depósito y suma en el gasto por sector. El costo se calcula en el momento
// con el mismo criterio que /stock (costo del lote o, si no tiene, el de la variante) y queda guardado
// en ST_InsumosUso, así el reporte no cambia si después cambia el costo de la variante.
// Si en el depósito no alcanza, se avisa; con "forzar" se usa igual y el faltante queda como
// discrepancia en /stock (la regla del WMS: nunca trabar la operación).
//
// Depósito de Servicio Técnico: el elegido en la pantalla (ConfiguracionGlobal 'ST_DepositoId'),
// si no la variable de entorno ST_DEPOSITO_ID, si no el "Mi sector" del usuario.
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { egresarVenta } = require('../services/wmsInternoService');
const {
    codigo, esAdmin, texto, bool, idNum, fechaISO, escaparLike, responderError, exigirTecnico, emitirST,
    usuarioActual, historial,
} = require('../services/servicioTecnicoComun');

const numero = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
};
const fmtCant = (n) => Number(n).toLocaleString('es-UY', { maximumFractionDigits: 3 });

async function depositoConfigurado(pool, req) {
    try {
        const r = await pool.request().query(`SELECT TOP 1 Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'ST_DepositoId'`);
        const id = idNum(r.recordset[0]?.Valor);
        if (id) return { id, origen: 'pantalla' };
    } catch (_) { /* sin clave */ }
    if (idNum(process.env.ST_DEPOSITO_ID)) return { id: idNum(process.env.ST_DEPOSITO_ID), origen: 'variable de entorno' };
    try {
        const r = await pool.request().input('U', sql.Int, idNum(req.user?.id) || -1).query('SELECT WmsDepId FROM dbo.Usuarios WHERE IdUsuario = @U');
        const id = idNum(r.recordset[0]?.WmsDepId);
        if (id) return { id, origen: 'mi sector' };
    } catch (_) { /* sin columna */ }
    return null;
}

// GET /insumos/config → depósito de Servicio Técnico + depósitos del stock
exports.config = async (req, res) => {
    try {
        const pool = await getPool();
        const [dep, deps] = await Promise.all([
            depositoConfigurado(pool, req),
            pool.request().query(`SELECT DepId, Nombre, Tipo FROM dbo.Wms_Depositos WHERE ISNULL(Activo, 1) = 1 ORDER BY Nombre`),
        ]);
        const nombre = dep ? deps.recordset.find(d => d.DepId === dep.id)?.Nombre : null;
        res.json({ success: true, data: { deposito: dep ? { ...dep, nombre } : null, depositos: deps.recordset, puedeElegir: esAdmin(req) } });
    } catch (err) { responderError(res, err, 'insumos.config'); }
};

// PUT /insumos/config { depositoId | null } → solo Admin
exports.setDeposito = async (req, res) => {
    if (!esAdmin(req)) return res.status(403).json({ success: false, error: 'Solo un administrador puede elegir el depósito de Servicio Técnico.' });
    const depId = req.body?.depositoId ? idNum(req.body.depositoId) : null;
    if (req.body?.depositoId && !depId) return res.status(400).json({ success: false, error: 'Depósito inválido.' });
    try {
        const pool = await getPool();
        if (depId) {
            const d = await pool.request().input('D', sql.Int, depId).query('SELECT DepId FROM dbo.Wms_Depositos WHERE DepId = @D');
            if (!d.recordset.length) return res.status(400).json({ success: false, error: 'El depósito no existe.' });
        }
        await pool.request().input('V', sql.NVarChar(sql.MAX), depId ? String(depId) : '').query(`
            UPDATE dbo.ConfiguracionGlobal SET Valor = @V WHERE Clave = 'ST_DepositoId';
            IF @@ROWCOUNT = 0 INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('ST_DepositoId', 'SERVICIO', @V);`);
        res.json({ success: true });
    } catch (err) { responderError(res, err, 'insumos.setDeposito'); }
};

// GET /insumos/stock?dep=&q= → lo que hay en un depósito
exports.stock = async (req, res) => {
    const dep = idNum(req.query.dep);
    if (!dep) return res.status(400).json({ success: false, error: 'Elegí el depósito.' });
    try {
        const pool = await getPool();
        const r = pool.request().input('D', sql.Int, dep);
        let filtro = '';
        const q = texto(req.query.q, 100);
        if (q) {
            filtro = 'AND (pm.Nombre LIKE @Q OR v.NombreVariante LIKE @Q OR v.CodigoVariante LIKE @Q OR pm.Sku LIKE @Q)';
            r.input('Q', sql.NVarChar(120), `%${escaparLike(q)}%`);
        }
        const result = await r.query(`
            SELECT v.VarId, LTRIM(RTRIM(pm.Nombre)) AS Producto, v.NombreVariante, v.CodigoVariante, pm.UnidadBase AS Unidad,
                   SUM(e.CantidadActual) AS Stock, v.Costo, ISNULL(v.Moneda, 'UYU') AS Moneda
            FROM dbo.Wms_Etiquetas e
            JOIN dbo.Wms_Variantes v ON v.VarId = e.VarId
            JOIN dbo.Wms_ProductosMaestros pm ON pm.PmaId = v.PmaId
            WHERE e.DepId = @D AND e.Estado = 'activo' AND e.CantidadActual > 0 ${filtro}
            GROUP BY v.VarId, pm.Nombre, v.NombreVariante, v.CodigoVariante, pm.UnidadBase, v.Costo, v.Moneda
            ORDER BY pm.Nombre, v.NombreVariante`);
        res.json({ success: true, data: result.recordset });
    } catch (err) { responderError(res, err, 'insumos.stock'); }
};

// POST /insumos/usos { varId, depId, cantidad, solId, trabId, proyId, equipoId, nota, forzar }
exports.registrarUso = async (req, res) => {
    if (!exigirTecnico(req, res, 'registrar insumos usados')) return;
    const b = req.body || {};
    const varId = idNum(b.varId);
    const depId = idNum(b.depId);
    const cantidad = numero(b.cantidad);
    if (!varId) return res.status(400).json({ success: false, error: 'Elegí el insumo.' });
    if (!depId) return res.status(400).json({ success: false, error: 'Elegí de qué depósito sale.' });
    if (!(cantidad > 0)) return res.status(400).json({ success: false, error: 'La cantidad tiene que ser mayor que 0.' });
    const solId = idNum(b.solId), trabId = idNum(b.trabId), proyId = idNum(b.proyId);
    let tx = null;
    try {
        const pool = await getPool();
        const v = await pool.request().input('V', sql.Int, varId).input('D', sql.Int, depId).query(`
            SELECT v.VarId, LTRIM(RTRIM(pm.Nombre)) AS Producto, v.NombreVariante, pm.UnidadBase AS Unidad, ISNULL(v.Moneda, 'UYU') AS Moneda,
                   (SELECT Nombre FROM dbo.Wms_Depositos WHERE DepId = @D) AS Deposito,
                   (SELECT ISNULL(SUM(e.CantidadActual), 0) FROM dbo.Wms_Etiquetas e WHERE e.VarId = v.VarId AND e.DepId = @D AND e.Estado = 'activo') AS Disponible
            FROM dbo.Wms_Variantes v JOIN dbo.Wms_ProductosMaestros pm ON pm.PmaId = v.PmaId
            WHERE v.VarId = @V`);
        const it = v.recordset[0];
        if (!it) return res.status(404).json({ success: false, error: 'No existe el insumo.' });
        if (!it.Deposito) return res.status(400).json({ success: false, error: 'El depósito no existe.' });
        if (String(it.Unidad || '').toLowerCase() === 'uni' && !Number.isInteger(cantidad)) {
            return res.status(400).json({ success: false, error: 'Este insumo se cuenta por unidad: la cantidad tiene que ser entera.' });
        }
        const disponible = Number(it.Disponible) || 0;
        if (cantidad > disponible + 0.0001 && !bool(b.forzar)) {
            return res.status(409).json({
                success: false, faltaStock: true, disponible,
                error: `En ${it.Deposito} hay ${fmtCant(disponible)} ${it.Unidad || ''} de ${it.Producto}. Si igual se usó, confirmá: lo que falte queda como diferencia en /stock.`,
            });
        }

        // Máquina: la indicada o la de la solicitud / trabajo.
        let equipoId = idNum(b.equipoId);
        if (!equipoId && (solId || trabId)) {
            const r = await pool.request().input('S', sql.Int, solId).input('T', sql.Int, trabId).query(`
                SELECT COALESCE((SELECT EquipoId FROM dbo.ST_Solicitudes WHERE SolId = @S), (SELECT EquipoId FROM dbo.ST_Trabajos WHERE TrabId = @T)) AS EquipoId`);
            equipoId = r.recordset[0]?.EquipoId || null;
        }
        const usuario = await usuarioActual(pool, req);
        const nombre = `${it.Producto}${it.NombreVariante && it.NombreVariante !== it.Producto ? ` · ${it.NombreVariante}` : ''}`.slice(0, 300);

        tx = new sql.Transaction(pool);
        await tx.begin();
        const ins = await tx.request()
            .input('V', sql.Int, varId).input('D', sql.Int, depId).input('N', sql.NVarChar(300), nombre)
            .input('Unid', sql.VarChar(20), it.Unidad ? String(it.Unidad).slice(0, 20) : null).input('C', sql.Decimal(18, 4), cantidad)
            .input('S', sql.Int, solId).input('T', sql.Int, trabId).input('P', sql.Int, proyId).input('E', sql.Int, equipoId)
            .input('Nota', sql.NVarChar(500), texto(b.nota, 500))
            .input('U', sql.Int, usuario.id).input('UN', sql.NVarChar(150), usuario.nombre)
            .query(`INSERT INTO dbo.ST_InsumosUso (VarId, DepId, Nombre, Unidad, Cantidad, SolId, TrabId, ProyId, EquipoId, Nota, UsuarioId, UsuarioNombre)
                    OUTPUT INSERTED.UsoId
                    VALUES (@V, @D, @N, @Unid, @C, @S, @T, @P, @E, @Nota, @U, @UN)`);
        const usoId = ins.recordset[0].UsoId;

        const { errores } = await egresarVenta({
            items: [{ varId, cantidad }], refTipo: 'ST_USO', refId: usoId, tipo: 'baja_consumo', depId, usuarioId: usuario.id, transaction: tx,
        });
        // Costo de lo descontado, con el criterio de /stock (lote → variante).
        const c = await tx.request().input('R', sql.Int, usoId).query(`
            SELECT SUM(ABS(m.Cantidad)) AS Descontado,
                   SUM(ABS(m.Cantidad) * COALESCE(NULLIF(e.CostoUnitarioReal, 0), v.Costo, 0)) AS Costo
            FROM dbo.Wms_Movimientos m
            JOIN dbo.Wms_Etiquetas e ON e.EtiId = m.EtiId
            JOIN dbo.Wms_Variantes v ON v.VarId = e.VarId
            WHERE m.RefTipo = 'ST_USO' AND m.RefId = @R`);
        const descontado = Number(c.recordset[0]?.Descontado) || 0;
        const costoDescontado = Number(c.recordset[0]?.Costo) || 0;
        const faltante = Math.max(0, cantidad - descontado);
        // Lo que faltó se valoriza al costo promedio de lo descontado (o al de la variante si no se descontó nada).
        let costoUnit = descontado > 0 ? costoDescontado / descontado : null;
        if (costoUnit == null) {
            const cv = await tx.request().input('V', sql.Int, varId).query('SELECT Costo FROM dbo.Wms_Variantes WHERE VarId = @V');
            costoUnit = cv.recordset[0]?.Costo != null ? Number(cv.recordset[0].Costo) : null;
        }
        const costoTotal = costoUnit != null ? Math.round(costoUnit * cantidad * 100) / 100 : null;
        await tx.request().input('Id', sql.Int, usoId).input('CU', sql.Decimal(18, 4), costoUnit).input('M', sql.VarChar(20), it.Moneda)
            .input('CT', sql.Decimal(18, 2), costoTotal).input('F', sql.Decimal(18, 4), faltante > 0.0001 ? faltante : null)
            .query('UPDATE dbo.ST_InsumosUso SET CostoUnit = @CU, Moneda = @M, CostoTotal = @CT, Faltante = @F WHERE UsoId = @Id');

        const detalle = `Usó ${fmtCant(cantidad)} ${it.Unidad || ''} de ${nombre} (de ${it.Deposito})`;
        if (solId) await historial(tx, { entidad: 'SOLICITUD', entidadId: solId, usuario, accion: 'INSUMO', detalle });
        if (trabId) await historial(tx, { entidad: 'TRABAJO', entidadId: trabId, usuario, accion: 'INSUMO', detalle });
        if (proyId) await historial(tx, { entidad: 'PROYECTO', entidadId: proyId, usuario, accion: 'INSUMO', detalle });
        await tx.commit();
        tx = null;
        if (errores.length) logger.warn(`[ServicioTecnico] Uso ${usoId}: ${errores.join(' | ')}`);
        emitirST(req, { usoId, solId: solId || undefined, trabId: trabId || undefined, proyId: proyId || undefined, equipoId: equipoId || undefined });
        res.json({ success: true, data: { UsoId: usoId, CostoTotal: costoTotal, Moneda: it.Moneda, Faltante: faltante > 0.0001 ? faltante : null } });
    } catch (err) {
        await rollbackSeguro(tx, 'ST uso de insumo');
        responderError(res, err, 'insumos.registrarUso');
    }
};

// GET /insumos/usos?desde=&hasta=&q=&equipo=&solId=&trabId=&proyId=
exports.listarUsos = async (req, res) => {
    try {
        const pool = await getPool();
        const r = pool.request();
        const where = [];
        const desde = fechaISO(req.query.desde);
        if (desde) { where.push('u.Fecha >= CAST(@Desde AS DATE)'); r.input('Desde', sql.VarChar(10), desde); }
        const hasta = fechaISO(req.query.hasta);
        if (hasta) { where.push('u.Fecha < DATEADD(DAY, 1, CAST(@Hasta AS DATE))'); r.input('Hasta', sql.VarChar(10), hasta); }
        for (const [param, col] of [['equipo', 'EquipoId'], ['solId', 'SolId'], ['trabId', 'TrabId'], ['proyId', 'ProyId']]) {
            const v = idNum(req.query[param]);
            if (v) { where.push(`u.${col} = @${col}`); r.input(col, sql.Int, v); }
        }
        const q = texto(req.query.q, 100);
        if (q) { where.push('(u.Nombre LIKE @Q OR u.Nota LIKE @Q OR u.UsuarioNombre LIKE @Q)'); r.input('Q', sql.NVarChar(120), `%${escaparLike(q)}%`); }
        const result = await r.query(`
            SELECT TOP 500 u.UsoId, u.Fecha, u.VarId, u.DepId, d.Nombre AS Deposito, u.Nombre, u.Unidad, u.Cantidad, u.CostoUnit, u.Moneda,
                   u.CostoTotal, u.Faltante, u.SolId, u.TrabId, u.ProyId, u.EquipoId, e.Nombre AS EquipoNombre, u.Nota, u.UsuarioNombre,
                   s.Titulo AS SolTitulo, t.Titulo AS TrabTitulo, p.Titulo AS ProyTitulo
            FROM dbo.ST_InsumosUso u
            LEFT JOIN dbo.Wms_Depositos d ON d.DepId = u.DepId
            LEFT JOIN dbo.ConfigEquipos e ON e.EquipoID = u.EquipoId
            LEFT JOIN dbo.ST_Solicitudes s ON s.SolId = u.SolId
            LEFT JOIN dbo.ST_Trabajos t ON t.TrabId = u.TrabId
            LEFT JOIN dbo.ST_Proyectos p ON p.ProyId = u.ProyId
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY u.Fecha DESC, u.UsoId DESC`);
        res.json({ success: true, data: result.recordset.map(u => ({ ...u, SolCodigo: u.SolId ? codigo(u.SolId) : null })) });
    } catch (err) { responderError(res, err, 'insumos.listarUsos'); }
};
