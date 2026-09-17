'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// BENEFICIOS PACTADOS — endpoints internos (/api/beneficios)
// Spec: specs/40-beneficios-pactados.md
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const svc = require('../services/beneficiosService');
const { beneficiosActivos, invalidarCacheBeneficios, CLAVE_BENEFICIOS } = require('../utils/beneficiosFlag');

const manejar = (res, err, ctx) => {
  const status = err?.status || 500;
  if (status >= 500) logger.error(`[BENEFICIOS] ${ctx}: ${err?.stack || err?.message}`);
  else logger.warn(`[BENEFICIOS] ${ctx}: ${err.message}`);
  res.status(status).json({ success: false, error: err?.message || 'Error inesperado' });
};

// GET /config — interruptor y permisos del usuario (el front esconde o muestra según esto)
exports.getConfig = async (req, res) => {
  try {
    const pool = await getPool();
    res.json({ success: true, activo: await beneficiosActivos(pool), puedeAprobar: await svc.puedeAprobar(pool, req.user), usuarioId: req.user?.id || null, rol: req.user?.role || null });
  } catch (e) { manejar(res, e, 'config'); }
};

// POST /config { activo: true|false } — solo Administración o un aprobador autorizado; prende/apaga el interruptor general
exports.setConfig = async (req, res) => {
  try {
    const pool = await getPool();
    if (!(await svc.puedeAprobar(pool, req.user))) return res.status(403).json({ success: false, error: 'Solo Administración o un aprobador autorizado puede prender o apagar los beneficios.' });
    const v = req.body?.activo ? '1' : '0';
    await pool.request().input('K', sql.VarChar(50), CLAVE_BENEFICIOS).input('V', sql.NVarChar(50), v).query(`
      IF EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = @K) UPDATE dbo.ConfiguracionGlobal SET Valor = @V WHERE Clave = @K
      ELSE INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES (@K, 'ADMIN', @V)`);
    invalidarCacheBeneficios();
    logger.info(`[BENEFICIOS] Interruptor general → ${v} (usuario ${req.user?.id})`);
    res.json({ success: true, activo: v === '1', message: v === '1' ? 'Beneficios ENCENDIDOS: los precios pactados aplican y las bolsas se consumen.' : 'Beneficios APAGADOS: ningún precio pactado aplica y no se activan bolsas.' });
  } catch (e) { manejar(res, e, 'setConfig'); }
};

// ── Aprobadores autorizados (specs/40: además de Admin/Administracion, usuarios puntuales) ──
// Ver/gestionar la lista es en sí una acción de quien ya puede aprobar (por rol o por lista).
exports.listarAprobadores = async (req, res) => {
  try {
    const pool = await getPool();
    if (!(await svc.puedeAprobar(pool, req.user))) return res.status(403).json({ success: false, error: 'Solo Administración o un aprobador autorizado puede ver esta lista.' });
    res.json({ success: true, data: await svc.listarAprobadoresAutorizados(pool), candidatos: await svc.candidatosAprobador(pool) });
  } catch (e) { manejar(res, e, 'listarAprobadores'); }
};
// POST /aprobadores { idUsuario }
exports.agregarAprobador = async (req, res) => {
  try {
    const pool = await getPool();
    if (!(await svc.puedeAprobar(pool, req.user))) return res.status(403).json({ success: false, error: 'Solo Administración o un aprobador autorizado puede agregar aprobadores.' });
    const r = await svc.agregarAprobador(pool, req.body?.idUsuario, req.user?.id);
    res.json({ success: true, data: r, message: `${r.nombre} ya puede aprobar beneficios, prender/apagar el interruptor y pausar/cerrar bolsas.` });
  } catch (e) { manejar(res, e, 'agregarAprobador'); }
};
// POST /aprobadores/:idUsuario/quitar
exports.quitarAprobador = async (req, res) => {
  try {
    const pool = await getPool();
    if (!(await svc.puedeAprobar(pool, req.user))) return res.status(403).json({ success: false, error: 'Solo Administración o un aprobador autorizado puede quitar aprobadores.' });
    await svc.quitarAprobador(pool, req.params.idUsuario);
    res.json({ success: true, message: 'Ya no está en la lista de aprobadores. Si tiene rol Admin o Administracion, igual puede aprobar por su rol.' });
  } catch (e) { manejar(res, e, 'quitarAprobador'); }
};

// ── Plantillas ───────────────────────────────────────────────────────────────
exports.listarPlantillas = async (req, res) => {
  try { const pool = await getPool(); res.json({ success: true, data: await svc.listarPlantillas(pool, { estado: req.query.estado || null }) }); }
  catch (e) { manejar(res, e, 'listarPlantillas'); }
};
exports.obtener = async (req, res) => {
  try {
    const pool = await getPool();
    const b = await svc.obtenerBeneficio(pool, parseInt(req.params.id));
    if (!b) return res.status(404).json({ success: false, error: 'Beneficio inexistente.' });
    res.json({ success: true, data: b });
  } catch (e) { manejar(res, e, 'obtener'); }
};
exports.crearPlantilla = async (req, res) => {
  try {
    const pool = await getPool();
    const b = await svc.crearPlantilla(pool, req.body || {}, req.user);
    res.status(201).json({ success: true, data: b, message: b.estado === 'PUBLICADA' ? `✅ Plantilla "${b.nombre}" publicada.` : `✅ Plantilla "${b.nombre}" guardada y enviada a aprobación. Hasta que Administración la apruebe, nadie la puede activar.` });
  } catch (e) { manejar(res, e, 'crearPlantilla'); }
};
exports.editarPlantilla = async (req, res) => {
  try {
    const pool = await getPool();
    const b = await svc.editarPlantilla(pool, parseInt(req.params.id), req.body || {}, req.user);
    res.json({ success: true, data: b, message: b.estado === 'PENDIENTE' ? `Cambios guardados: la plantilla vuelve a aprobación.` : `Cambios guardados en "${b.nombre}".` });
  } catch (e) { manejar(res, e, 'editarPlantilla'); }
};
exports.accionPlantilla = async (req, res) => {
  try {
    const pool = await getPool();
    const b = await svc.cambiarEstadoPlantilla(pool, parseInt(req.params.id), req.params.accion, req.user, { nota: req.body?.nota, motivo: req.body?.motivo });
    res.json({ success: true, data: b, message: `Plantilla "${b.nombre}": ${b.estado}.` });
  } catch (e) { manejar(res, e, 'accionPlantilla'); }
};

// ── Pactos ───────────────────────────────────────────────────────────────────
exports.evaluar = async (req, res) => {
  try {
    const pool = await getPool();
    const { cliId, reglas, monedaId } = req.body || {};
    const filas = svc.normalizarReglas(reglas || [], monedaId);
    res.json({ success: true, data: await svc.evaluarReglas(pool, { cliId: parseInt(cliId) || null, reglas: filas, monedaId }) });
  } catch (e) { manejar(res, e, 'evaluar'); }
};
exports.proponerPacto = async (req, res) => {
  try {
    const pool = await getPool();
    const b = await svc.proponerPacto(pool, req.body || {}, req.user);
    const peores = b.evaluacion?.peores || 0;
    res.status(201).json({ success: true, data: b, message: `✅ Pacto "${b.nombre}" enviado a aprobación${peores ? ` con ${peores} precio(s) peor(es) que los actuales del cliente, marcados para quien aprueba` : ''}. No cambia ningún precio hasta que se apruebe y el cliente cargue el saldo.` });
  } catch (e) { manejar(res, e, 'proponerPacto'); }
};
// PUT /pactos/:id — corrige un pacto RECHAZADO y lo reenvía a aprobación
exports.editarPacto = async (req, res) => {
  try {
    const pool = await getPool();
    const b = await svc.editarPacto(pool, parseInt(req.params.id), req.body || {}, req.user);
    const peores = b.evaluacion?.peores || 0;
    res.json({ success: true, data: b, message: `✅ Pacto "${b.nombre}" corregido y reenviado a aprobación${peores ? ` (${peores} precio(s) peor(es) marcados de nuevo)` : ''}.` });
  } catch (e) { manejar(res, e, 'editarPacto'); }
};
exports.listarPactos = async (req, res) => {
  try {
    const pool = await getPool();
    const q = req.query || {};
    const esAprobador = await svc.puedeAprobar(pool, req.user);
    // El vendedor ve los suyos; quien aprueba ve todos (o filtra por vendedor)
    const vendedorId = esAprobador ? (parseInt(q.vendedorId) || null) : (req.user?.id || -1);
    const data = await svc.listarPactos(pool, { estado: q.estado || null, cliId: parseInt(q.cliId) || null, vendedorId, desde: q.desde || null, hasta: q.hasta || null, incluirPlantillas: esAprobador && !q.cliId });
    const resumen = esAprobador ? await svc.resumenPactos(pool) : null;
    res.json({ success: true, data, resumen, puedeAprobar: esAprobador });
  } catch (e) { manejar(res, e, 'listarPactos'); }
};
exports.decidirPacto = async (req, res) => {
  try {
    const pool = await getPool();
    const b = await svc.decidirPacto(pool, parseInt(req.params.id), req.params.accion, req.user, { nota: req.body?.nota, motivo: req.body?.motivo });
    const msg = b.estado === 'APROBADO' ? `✅ Pacto "${b.nombre}" aprobado. Queda disponible para que el cliente lo active cargando ${b.monedaId === 2 ? 'US$' : '$'} ${b.carga.toFixed(2)}. Ningún precio cambia hasta esa carga.`
      : b.estado === 'RECHAZADO' ? `Pacto "${b.nombre}" rechazado.` : b.estado === 'CANCELADO' ? `Pacto "${b.nombre}" cancelado.` : `Pacto "${b.nombre}": ${b.estado}.`;
    res.json({ success: true, data: b, message: msg });
  } catch (e) { manejar(res, e, 'decidirPacto'); }
};

// ── Cliente (pestaña Beneficios del 360 de vendedores / gestor de cuentas) ──
exports.vistaCliente = async (req, res) => {
  try {
    const pool = await getPool();
    res.json({ success: true, data: await svc.vistaCliente(pool, parseInt(req.params.cliId)), activo: await beneficiosActivos(pool), puedeAprobar: await svc.puedeAprobar(pool, req.user) });
  } catch (e) { manejar(res, e, 'vistaCliente'); }
};

// ── Activación desde CAJA / 360: la factura ya se emitió por /cfe/manual ──
// POST /activar { BenIdBeneficio, CliIdCliente, DocIdDocumento }
exports.activarDesdeCaja = async (req, res) => {
  try {
    const pool = await getPool();
    // Lo normal es que el cliente lo active solo desde el portal (autogestión). Cargarlo
    // "a mano" desde caja es una excepción que solo puede hacer Administración (o quien
    // esté en la lista de aprobadores autorizados), nunca un vendedor.
    if (!(await svc.puedeAprobar(pool, req.user))) return res.status(403).json({ success: false, error: 'Solo Administración o un aprobador autorizado puede cargar un beneficio desde caja. Lo normal es que el cliente lo active solo, desde su portal.' });
    const benId = parseInt(req.body?.BenIdBeneficio), cliId = parseInt(req.body?.CliIdCliente), docId = parseInt(req.body?.DocIdDocumento);
    if (!benId || !cliId || !docId) return res.status(400).json({ success: false, error: 'BenIdBeneficio, CliIdCliente y DocIdDocumento son obligatorios.' });
    const doc = (await pool.request().input('D', sql.Int, docId).query('SELECT DocTotal, MonIdMoneda FROM dbo.DocumentosContables WHERE DocIdDocumento = @D')).recordset[0];
    if (!doc) return res.status(404).json({ success: false, error: 'Factura inexistente.' });
    const r = await svc.activarBeneficio(pool, { benId, cliId, docId, importe: Number(doc.DocTotal), monedaId: Number(doc.MonIdMoneda) === 2 ? 2 : 1, usuarioId: req.user?.id || 1, origen: 'CAJA' });
    const sym = Number(doc.MonIdMoneda) === 2 ? 'US$' : '$';
    res.json({ success: true, data: r, message: `✅ Beneficio ACTIVADO: ${sym} ${r.importe.toFixed(2)} cargados en la cuenta "${r.nombreCuenta}" con la factura ${r.refDoc}. Vence ${r.vence ? `el ${r.vence.split('-').reverse().join('/')}` : 'al agotarse el saldo'}. Desde ahora los pedidos de su alcance salen al precio pactado.` });
  } catch (e) { manejar(res, e, 'activarDesdeCaja'); }
};

// ── Bolsas (Administración) ──────────────────────────────────────────────────
exports.accionBolsa = async (req, res) => {
  try {
    const pool = await getPool();
    const bclId = parseInt(req.params.bclId);
    const accion = req.params.accion;
    if (accion === 'cerrar') {
      const r = await svc.cerrarBolsa(pool, bclId, req.user);
      return res.json({ success: true, data: r, message: r.transferido > 0 ? `Beneficio cerrado: ${r.transferido.toFixed(2)} pasaron a "${r.destino.CueNombre}" (billetera común, a tarifa normal).` : 'Beneficio cerrado sin saldo remanente.' });
    }
    const estado = await svc.pausarReanudar(pool, bclId, accion, req.user);
    res.json({ success: true, data: { estado }, message: estado === 'PAUSADO' ? 'Beneficio en pausa: los pedidos salen a la tarifa normal y el saldo queda guardado.' : `Beneficio ${estado === 'ACTIVO' ? 'reanudado: los precios pactados vuelven a aplicar' : estado.toLowerCase()}.` });
  } catch (e) { manejar(res, e, 'accionBolsa'); }
};
exports.refrescarBolsa = async (req, res) => {
  try { const pool = await getPool(); res.json({ success: true, estado: await svc.refrescarEstadoBolsa(pool, parseInt(req.params.bclId)) }); }
  catch (e) { manejar(res, e, 'refrescarBolsa'); }
};

// ── Catálogo para el editor de reglas: artículos, grupos y áreas ────────────
exports.catalogo = async (req, res) => {
  try {
    const pool = await getPool();
    const q = String(req.query.q || '').trim();
    // Filtro por grupo/familia (specs/40): además del texto libre, para acotar la búsqueda
    // cuando el texto solo no alcanza (grupos grandes, nombres poco descriptivos).
    const grupoFiltro = String(req.query.grupo || '').trim();
    const req1 = pool.request()
      .input('Q', sql.NVarChar(100), `%${q}%`)
      .input('G', sql.VarChar(50), grupoFiltro)
      .input('G2', sql.VarChar(52), grupoFiltro + '.%');
    const arts = await req1.query(`
      SELECT TOP 60 a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Descripcion)) AS Descripcion, LTRIM(RTRIM(a.Grupo)) AS Grupo,
             (SELECT TOP 1 pb.Precio FROM dbo.PreciosBase pb WHERE pb.ProIdProducto = a.ProIdProducto ORDER BY pb.MonIdMoneda) AS PrecioLista,
             (SELECT TOP 1 pb.MonIdMoneda FROM dbo.PreciosBase pb WHERE pb.ProIdProducto = a.ProIdProducto ORDER BY pb.MonIdMoneda) AS MonLista
      FROM dbo.Articulos a WITH(NOLOCK)
      WHERE ISNULL(a.EnListaPrecios, 1) = 1 AND (@Q = '%%' OR a.Descripcion LIKE @Q OR a.CodArticulo LIKE @Q OR a.Grupo LIKE @Q)
        AND (@G = '' OR a.Grupo = @G OR a.Grupo LIKE @G2)
      ORDER BY a.Descripcion`);
    const grupos = await pool.request().query(`
      SELECT LTRIM(RTRIM(s.Grupo)) AS Grupo, MAX(LTRIM(RTRIM(s.Articulo))) AS Nombre, COUNT(*) AS N
      FROM dbo.StockArt s WITH(NOLOCK) WHERE s.Grupo IS NOT NULL AND LTRIM(RTRIM(s.Grupo)) <> '' GROUP BY LTRIM(RTRIM(s.Grupo)) ORDER BY 1`);
    const areas = await pool.request().query(`SELECT LTRIM(RTRIM(AreaID)) AS AreaID, Nombre FROM dbo.Areas WHERE Categoria IN ('Impresión','Procesos') ORDER BY Nombre`);
    res.json({ success: true, articulos: arts.recordset, grupos: grupos.recordset, areas: areas.recordset });
  } catch (e) { manejar(res, e, 'catalogo'); }
};
