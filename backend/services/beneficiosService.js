'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// BENEFICIOS PACTADOS SOBRE LA BILLETERA — servicio de dominio
// Spec: specs/40-beneficios-pactados.md · Plan: docs/beneficios-billetera-plan.md
//
// Un beneficio son DOS cosas con la misma vida:
//   1. la BOLSA: una cuenta de billetera propia del cliente (restringida, prepago
//      facturada, consumo automático) que nace SOLO con una carga facturada;
//   2. las REGLAS de precio: un PerfilesPrecios marcado EsBeneficio=1 cuyas
//      PerfilesItems el motor de precios aplica solo mientras la bolsa esté
//      ACTIVA, vigente y con saldo.
//
// Regla que ordena todo: APROBADO NO ES HABILITADO. Ningún precio pactado aplica
// hasta que la carga se acredita (activarBeneficio).
//
// Convenciones de las reglas (PerfilesItems de un perfil EsBeneficio=1):
//   · ARTICULO : ProIdProducto y/o CodArticulo del artículo
//   · GRUPO    : CodGrupo = grupo/familia (ej. '1.1'); alcanza al grupo y sus subgrupos
//   · AREA     : CodArticulo = 'TOTAL' y CodGrupo = 'AREA:<AreaID>' (servicio completo)
//   · TipoRegla: 'fixed_price' (precio fijo por unidad) | 'percentage_discount'
//                (% SIEMPRE sobre el precio de LISTA) | 'subtract' (descuento por monto)
// ─────────────────────────────────────────────────────────────────────────────
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { beneficiosActivos } = require('../utils/beneficiosFlag');

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const hoyISO = () => new Date().toISOString().slice(0, 10);

const ESTADOS_PLANTILLA = ['BORRADOR', 'PENDIENTE', 'PUBLICADA', 'PAUSADA'];
const ESTADOS_PACTO = ['PENDIENTE', 'APROBADO', 'ACTIVADO', 'RECHAZADO', 'CANCELADO'];
const ESTADOS_BOLSA = ['ACTIVO', 'PAUSADO', 'AGOTADO', 'VENCIDO', 'CERRADO'];
const ROLES_APRUEBAN = ['admin', 'administracion'];

const normalizaRol = (r) => String(r || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const esRolAprobador = (user) => ROLES_APRUEBAN.includes(normalizaRol(user?.role));

// ── Aprobadores autorizados a mano (specs/40: "no siempre es la Administración quien
// aprueba"): además de los roles Admin/Administracion, cualquier usuario puntual que esté
// en dbo.BeneficiosAprobadores puede aprobar/rechazar, pausar/reanudar/cerrar y prender o
// apagar el interruptor general. Si el script SQL todavía no corrió, se ignora sin romper
// nada (fail-closed): solo quedan los roles de siempre.
let _benAprobTablaCache = null;
async function tablaAprobadoresExiste(pool) {
  if (_benAprobTablaCache !== null) return _benAprobTablaCache;
  try {
    const r = await pool.request().query("SELECT OBJECT_ID('dbo.BeneficiosAprobadores', 'U') AS id");
    _benAprobTablaCache = !!r.recordset[0]?.id;
  } catch (e) { _benAprobTablaCache = false; }
  return _benAprobTablaCache;
}
/** true si el usuario puede aprobar: por rol (Admin/Administracion) o por estar en la lista puntual. */
async function puedeAprobar(pool, user) {
  if (esRolAprobador(user)) return true;
  if (!user?.id || !(await tablaAprobadoresExiste(pool))) return false;
  const r = await pool.request().input('U', sql.Int, user.id).query('SELECT 1 AS ok FROM dbo.BeneficiosAprobadores WHERE IdUsuario = @U');
  return r.recordset.length > 0;
}
/** Lista de aprobadores autorizados a mano, con su nombre/usuario/rol actual (para mostrar y gestionar). */
async function listarAprobadoresAutorizados(pool) {
  if (!(await tablaAprobadoresExiste(pool))) return [];
  const r = await pool.request().query(`
    SELECT ba.IdUsuario, ba.BapFechaAlta, u.Nombre, u.Usuario, r2.NombreRol
    FROM dbo.BeneficiosAprobadores ba
    JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = ba.IdUsuario
    LEFT JOIN dbo.Roles r2 WITH(NOLOCK) ON r2.IdRol = u.IdRol
    ORDER BY u.Nombre, u.Usuario`);
  return r.recordset.map(x => ({ idUsuario: x.IdUsuario, nombre: String(x.Nombre || x.Usuario || `usuario ${x.IdUsuario}`).trim(), usuario: x.Usuario, rol: x.NombreRol || null, fechaAlta: x.BapFechaAlta }));
}
/** Candidatos para el selector: usuarios internos activos que todavía NO son Admin/Administracion ni ya están en la lista. */
async function candidatosAprobador(pool) {
  const r = await pool.request().query(`
    SELECT u.IdUsuario, u.Nombre, u.Usuario, r2.NombreRol
    FROM dbo.Usuarios u WITH(NOLOCK) LEFT JOIN dbo.Roles r2 WITH(NOLOCK) ON r2.IdRol = u.IdRol
    WHERE ISNULL(u.Activo, 1) = 1
      AND (r2.NombreRol IS NULL OR LOWER(r2.NombreRol) NOT IN ('admin', 'administracion'))
      AND (${(await tablaAprobadoresExiste(pool)) ? 'NOT EXISTS (SELECT 1 FROM dbo.BeneficiosAprobadores ba WHERE ba.IdUsuario = u.IdUsuario)' : '1=1'})
    ORDER BY u.Nombre, u.Usuario`);
  return r.recordset.map(x => ({ idUsuario: x.IdUsuario, nombre: String(x.Nombre || x.Usuario || `usuario ${x.IdUsuario}`).trim(), usuario: x.Usuario, rol: x.NombreRol || null }));
}
async function agregarAprobador(pool, idUsuario, usuarioAltaId) {
  if (!(await tablaAprobadoresExiste(pool))) throw new BeneficioError('Falta correr scripts/add_beneficios.sql (la tabla de aprobadores no existe).', 500);
  const uid = parseInt(idUsuario);
  if (!uid) throw new BeneficioError('Falta el usuario.');
  const u = (await pool.request().input('U', sql.Int, uid).query('SELECT IdUsuario, Nombre, Usuario FROM dbo.Usuarios WITH(NOLOCK) WHERE IdUsuario = @U')).recordset[0];
  if (!u) throw new BeneficioError('Usuario inexistente.', 404);
  await pool.request().input('U', sql.Int, uid).input('Alta', sql.Int, usuarioAltaId || null).query(`
    IF NOT EXISTS (SELECT 1 FROM dbo.BeneficiosAprobadores WHERE IdUsuario = @U)
      INSERT INTO dbo.BeneficiosAprobadores (IdUsuario, BapUsuarioAlta) VALUES (@U, @Alta)`);
  logger.info(`[BENEFICIOS] ${String(u.Nombre || u.Usuario).trim()} (#${uid}) agregado a la lista de aprobadores autorizados por usuario ${usuarioAltaId}`);
  return { idUsuario: uid, nombre: String(u.Nombre || u.Usuario || '').trim() };
}
async function quitarAprobador(pool, idUsuario) {
  if (!(await tablaAprobadoresExiste(pool))) return;
  await pool.request().input('U', sql.Int, parseInt(idUsuario)).query('DELETE FROM dbo.BeneficiosAprobadores WHERE IdUsuario = @U');
}

class BeneficioError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

// ── Saldo real de una cuenta (fórmula canónica: suma de movimientos, sin ORDEN) ──
async function saldoRealCuenta(pool, cueId, transaction = null) {
  const req = transaction ? new sql.Request(transaction) : pool.request();
  const r = await req.input('Cue', sql.Int, cueId).query(`
    SELECT ISNULL(SUM(m.MovImporte), 0) AS SaldoReal
    FROM dbo.MovimientosCuenta m
    WHERE m.CueIdCuenta = @Cue AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')`);
  return parseFloat(r.recordset[0]?.SaldoReal) || 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. REGLAS
// ═════════════════════════════════════════════════════════════════════════════

/** Valida y normaliza las reglas que llegan del formulario → filas de PerfilesItems. */
function normalizarReglas(reglas, monedaId) {
  if (!Array.isArray(reglas) || reglas.length === 0) throw new BeneficioError('El beneficio necesita al menos una regla de precio.');
  const mon = Number(monedaId) === 2 ? 2 : 1;
  return reglas.map((rg, i) => {
    const alcance = String(rg.alcance || '').toUpperCase();
    const tipoIn = String(rg.tipo || '').toLowerCase();
    const tipo = tipoIn.includes('percent') ? 'percentage_discount'
      : (tipoIn === 'subtract' || tipoIn.includes('monto') || tipoIn.includes('amount')) ? 'subtract'
      : 'fixed_price';
    const valor = Number(rg.valor);
    if (!(valor >= 0) || Number.isNaN(valor)) throw new BeneficioError(`Regla ${i + 1}: el valor no es válido.`);
    if (tipo === 'percentage_discount' && (valor <= 0 || valor > 100)) throw new BeneficioError(`Regla ${i + 1}: el descuento debe estar entre 1 y 100 %.`);
    if (tipo !== 'percentage_discount' && valor <= 0) throw new BeneficioError(`Regla ${i + 1}: el precio o el monto debe ser mayor a 0.`);
    const fila = {
      ProIdProducto: null, CodArticulo: 'TOTAL', CodGrupo: null,
      TipoRegla: tipo, Valor: r2(valor), MonIdMoneda: mon, Moneda: mon === 2 ? 'USD' : 'UYU',
      CantidadMinima: Math.max(1, parseInt(rg.cantidadMinima) || 1),
      alcance, descripcion: String(rg.descripcion || '').trim().slice(0, 200),
    };
    if (alcance === 'ARTICULO') {
      fila.ProIdProducto = parseInt(rg.proIdProducto) || null;
      fila.CodArticulo = String(rg.codArticulo || '').trim();
      if (!fila.ProIdProducto && !fila.CodArticulo) throw new BeneficioError(`Regla ${i + 1}: falta el artículo.`);
      if (!fila.CodArticulo) fila.CodArticulo = String(fila.ProIdProducto);
    } else if (alcance === 'GRUPO') {
      fila.CodGrupo = String(rg.codGrupo || '').trim();
      if (!fila.CodGrupo) throw new BeneficioError(`Regla ${i + 1}: falta el grupo.`);
    } else if (alcance === 'AREA') {
      const area = String(rg.areaId || '').trim().toUpperCase();
      if (!area) throw new BeneficioError(`Regla ${i + 1}: falta el servicio (área).`);
      fila.CodGrupo = `AREA:${area}`;
    } else {
      throw new BeneficioError(`Regla ${i + 1}: alcance desconocido (${rg.alcance}). Usá ARTICULO, GRUPO o AREA.`);
    }
    return fila;
  });
}

/** Lee las reglas de un perfil de beneficio en el formato del formulario. */
async function reglasDePerfil(pool, perfilId) {
  const r = await pool.request().input('P', sql.Int, perfilId).query(`
    SELECT pi.ID, pi.ProIdProducto, pi.CodArticulo, pi.CodGrupo, pi.TipoRegla, pi.Valor, pi.MonIdMoneda, pi.Moneda, pi.CantidadMinima,
           a.Descripcion AS ArticuloDescripcion, a.Grupo AS ArticuloGrupo
    FROM dbo.PerfilesItems pi
    LEFT JOIN dbo.Articulos a ON a.ProIdProducto = pi.ProIdProducto
    WHERE pi.PerfilID = @P ORDER BY pi.ID`);
  return r.recordset.map(reglaDesdeFila);
}

function reglaDesdeFila(pi) {
  const cod = String(pi.CodArticulo || '').trim();
  const grupo = String(pi.CodGrupo || '').trim();
  let alcance = 'ARTICULO', areaId = null, codGrupo = null;
  if (grupo.startsWith('AREA:')) { alcance = 'AREA'; areaId = grupo.slice(5); }
  else if (grupo) { alcance = 'GRUPO'; codGrupo = grupo; }
  else if (cod === 'TOTAL' && !pi.ProIdProducto) { alcance = 'TODO'; }
  const tipoRaw = String(pi.TipoRegla || '');
  const tipo = tipoRaw.includes('percent') ? 'percentage' : tipoRaw === 'subtract' ? 'subtract' : 'fixed';
  return {
    id: pi.ID, alcance, proIdProducto: pi.ProIdProducto || null, codArticulo: alcance === 'ARTICULO' ? cod : null,
    codGrupo, areaId, tipo, valor: Number(pi.Valor) || 0, monedaId: Number(pi.MonIdMoneda) === 2 ? 2 : 1,
    cantidadMinima: Number(pi.CantidadMinima) || 1,
    descripcion: alcance === 'ARTICULO' ? String(pi.ArticuloDescripcion || '').trim() : null,
    grupoArticulo: pi.ArticuloGrupo ? String(pi.ArticuloGrupo).trim() : null,
  };
}

/** Texto corto de una regla para listas ("Telas 1.1: $ 180 fijo/u", "Sublimación: −8 % sobre lista"). */
function textoRegla(rg) {
  const sym = rg.monedaId === 2 ? 'US$' : '$';
  const que = rg.alcance === 'ARTICULO' ? (rg.descripcion || rg.codArticulo || `art. ${rg.proIdProducto}`)
    : rg.alcance === 'GRUPO' ? `grupo ${rg.codGrupo}`
    : rg.alcance === 'AREA' ? `todo ${rg.areaId}` : 'todo';
  const como = rg.tipo === 'percentage' ? `−${rg.valor} % sobre lista`
    : rg.tipo === 'subtract' ? `−${sym} ${rg.valor} por unidad` : `${sym} ${rg.valor} fijo por unidad`;
  return `${que}: ${como}`;
}

/** Crea o reemplaza el PerfilesPrecios + PerfilesItems de un beneficio. Devuelve PerfilID. */
async function guardarPerfilBeneficio(transaction, { perfilId = null, nombre, reglas }) {
  const req = () => new sql.Request(transaction);
  const nombrePerfil = `BENEFICIO · ${String(nombre).trim()}`.slice(0, 100);
  let id = perfilId;
  if (id) {
    await req().input('Id', sql.Int, id).input('N', sql.NVarChar(100), nombrePerfil)
      .query(`UPDATE dbo.PerfilesPrecios SET Nombre = @N, Activo = 1, EsGlobal = 0, EsBeneficio = 1, Categoria = 'BENEFICIO' WHERE ID = @Id`);
    await req().input('Id', sql.Int, id).query('DELETE FROM dbo.PerfilesItems WHERE PerfilID = @Id');
  } else {
    const ins = await req().input('N', sql.NVarChar(100), nombrePerfil).input('D', sql.NVarChar(255), 'Reglas de precio de un beneficio pactado (no asignable a mano)')
      .query(`INSERT INTO dbo.PerfilesPrecios (Nombre, Descripcion, Activo, EsGlobal, Categoria, EsBeneficio)
              OUTPUT INSERTED.ID VALUES (@N, @D, 1, 0, 'BENEFICIO', 1)`);
    id = ins.recordset[0].ID;
  }
  for (const f of reglas) {
    await req()
      .input('P', sql.Int, id).input('Pro', sql.Int, f.ProIdProducto).input('Cod', sql.NVarChar(50), f.CodArticulo)
      .input('Gru', sql.VarChar(100), f.CodGrupo).input('Tipo', sql.NVarChar(20), f.TipoRegla).input('Val', sql.Decimal(18, 4), f.Valor)
      .input('Mon', sql.NVarChar(5), f.Moneda).input('MonId', sql.Int, f.MonIdMoneda).input('Min', sql.Int, f.CantidadMinima)
      .query(`INSERT INTO dbo.PerfilesItems (PerfilID, ProIdProducto, CodArticulo, CodGrupo, TipoRegla, Valor, Moneda, MonIdMoneda, CantidadMinima)
              VALUES (@P, @Pro, @Cod, @Gru, @Tipo, @Val, @Mon, @MonId, @Min)`);
  }
  return id;
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. ARTÍCULOS: resolución y alcance
// ═════════════════════════════════════════════════════════════════════════════

/** Datos de un artículo para evaluar alcance y precio. */
async function resolverArticulo(pool, { proId = null, cod = null }) {
  const req = pool.request();
  let q;
  if (proId) { req.input('P', sql.Int, proId); q = 'a.ProIdProducto = @P'; }
  else if (cod) { req.input('C', sql.VarChar(50), String(cod).trim()); q = 'LTRIM(RTRIM(a.CodArticulo)) = @C'; }
  else return null;
  const r = await req.query(`
    SELECT TOP 1 a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Grupo)) AS Grupo, LTRIM(RTRIM(a.Descripcion)) AS Descripcion,
           (SELECT TOP 1 LTRIM(RTRIM(o.AreaID)) FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.ProIdProducto = a.ProIdProducto ORDER BY o.OrdenID DESC) AS AreaID
    FROM dbo.Articulos a WITH(NOLOCK) WHERE ${q}`);
  const a = r.recordset[0];
  if (!a) return null;
  return { proId: a.ProIdProducto, cod: a.CodArticulo, grupo: a.Grupo || '', areaId: String(a.AreaID || '').toUpperCase(), descripcion: a.Descripcion || '' };
}

/** ¿La regla alcanza al artículo? Devuelve el rango de especificidad (3 artículo > 2 grupo > 1 área > 0 todo) o -1. */
function rangoAlcance(rg, art, cantidad = 1) {
  if (!rg || !art) return -1;
  if ((Number(rg.cantidadMinima) || 1) > (Number(cantidad) || 1) && (Number(rg.cantidadMinima) || 1) !== 1) return -1;
  if (rg.alcance === 'ARTICULO') {
    if (rg.proIdProducto && Number(rg.proIdProducto) === Number(art.proId)) return 3;
    if (rg.codArticulo && art.cod && String(rg.codArticulo).trim() === String(art.cod).trim()) return 3;
    return -1;
  }
  if (rg.alcance === 'GRUPO') {
    const g = String(rg.codGrupo || '').trim(), ag = String(art.grupo || '').trim();
    if (!g || !ag) return -1;
    return (ag === g || ag.startsWith(g + '.')) ? 2 : -1;
  }
  if (rg.alcance === 'AREA') return (rg.areaId && art.areaId && String(rg.areaId).toUpperCase() === String(art.areaId).toUpperCase()) ? 1 : -1;
  if (rg.alcance === 'TODO') return 0;
  return -1;
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. BENEFICIOS ACTIVOS DEL CLIENTE (bolsas) y selección para el motor de precios
// ═════════════════════════════════════════════════════════════════════════════

/** Bolsas del cliente con su saldo real. estados: lista de BclEstado (default todas). */
async function bolsasDelCliente(pool, cliId, { estados = null } = {}) {
  const r = await pool.request().input('Cli', sql.Int, cliId).query(`
    SELECT bc.BclIdBeneficioCliente, bc.BenIdBeneficio, bc.CueIdCuenta, bc.DocIdDocumento, bc.BclImporteCarga,
           bc.BclFechaActivacion, bc.BclFechaVencimiento, bc.BclEstado, bc.BclOrigen, bc.BclPausadoPor, bc.BclFechaPausa,
           bc.BclCerradoPor, bc.BclFechaCierre, bc.MovIdTransferenciaCierre,
           b.BenNombre, b.BenTipo, b.PerfilID, b.MonIdMoneda, b.BenVendedorId, b.BenAprobadorId,
           cc.CueNombre, cc.CueActiva, cc.CueAutoConsumo, cc.CueTipo,
           ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                   WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                     AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo,
           (SELECT COUNT(*) FROM dbo.MovimientosCuenta m2 WITH(NOLOCK) WHERE m2.CueIdCuenta = cc.CueIdCuenta AND m2.MovTipo = 'CONSUMO_CUENTA' AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)) AS Consumos,
           dc.DocSerie, dc.DocNumero
    FROM dbo.BeneficiosCliente bc WITH(NOLOCK)
    JOIN dbo.Beneficios b WITH(NOLOCK) ON b.BenIdBeneficio = bc.BenIdBeneficio
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = bc.CueIdCuenta
    LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = bc.DocIdDocumento
    WHERE bc.CliIdCliente = @Cli
    ORDER BY bc.BclFechaActivacion DESC`);
  let rows = r.recordset.map(x => ({ ...x, Saldo: r2(x.Saldo), vigente: !x.BclFechaVencimiento || String(x.BclFechaVencimiento).slice(0, 10) >= hoyISO() }));
  if (estados) rows = rows.filter(x => estados.includes(x.BclEstado));
  return rows;
}

/**
 * Beneficio que aplica a un artículo para el motor de precios, o null.
 * Solo bolsas ACTIVAS, vigentes y con saldo > 0; gana el alcance más específico,
 * a igual alcance el que vence primero, luego el activado antes.
 * NO consulta nada si el interruptor general está apagado.
 */
async function beneficioParaPrecio(pool, { cliId, proId = null, codArticulo = null, grupo = null, areaId = null, cantidad = 1 }) {
  if (!cliId) return null;
  if (!(await beneficiosActivos(pool))) return null;
  const bolsas = (await bolsasDelCliente(pool, cliId, { estados: ['ACTIVO'] })).filter(b => b.vigente && b.CueActiva && b.Saldo > 0.009);
  if (!bolsas.length) return null;
  const art = { proId: proId || null, cod: codArticulo ? String(codArticulo).trim() : null, grupo: grupo ? String(grupo).trim() : '', areaId: String(areaId || '').toUpperCase() };
  // Grupo/área del artículo si el motor no los trajo
  if ((!art.grupo || !art.areaId) && (art.proId || art.cod)) {
    const res = await resolverArticulo(pool, { proId: art.proId, cod: art.cod }).catch(() => null);
    if (res) { art.proId = art.proId || res.proId; art.cod = art.cod || res.cod; art.grupo = art.grupo || res.grupo; art.areaId = art.areaId || res.areaId; }
  }
  let mejor = null;
  for (const b of bolsas) {
    const reglas = await reglasDePerfil(pool, b.PerfilID);
    for (const rg of reglas) {
      const rango = rangoAlcance(rg, art, cantidad);
      if (rango < 0) continue;
      const cand = { rango, vence: b.BclFechaVencimiento ? String(b.BclFechaVencimiento).slice(0, 10) : '9999-12-31', activacion: b.BclFechaActivacion, bolsa: b, regla: rg };
      if (!mejor || cand.rango > mejor.rango
          || (cand.rango === mejor.rango && cand.vence < mejor.vence)
          || (cand.rango === mejor.rango && cand.vence === mejor.vence && new Date(cand.activacion) < new Date(mejor.activacion))
          || (cand.rango === mejor.rango && cand.vence === mejor.vence && String(cand.activacion) === String(mejor.activacion) && (cand.regla.cantidadMinima || 1) > (mejor.regla.cantidadMinima || 1))) {
        mejor = cand;
      }
    }
  }
  if (!mejor) return null;
  return {
    bclId: mejor.bolsa.BclIdBeneficioCliente, benId: mejor.bolsa.BenIdBeneficio, cueId: mejor.bolsa.CueIdCuenta,
    nombre: String(mejor.bolsa.BenNombre || '').trim(), monedaId: Number(mejor.bolsa.MonIdMoneda) === 2 ? 2 : 1,
    saldo: mejor.bolsa.Saldo, vence: mejor.bolsa.BclFechaVencimiento, regla: mejor.regla, rango: mejor.rango,
  };
}

/** Beneficio con el que se cotizó una orden (marca Ordenes.BclIdBeneficioCliente), por código o por id. */
async function bolsaDeOrden(pool, { OrdIdOrden = null, CodigoOrden = null }) {
  const codigo = (String(CodigoOrden || '').trim().match(/^[A-Z]{2,8}-\d+/) || [])[0] || null;
  let bcl = null;
  if (codigo) {
    const r = await pool.request().input('Cod', sql.VarChar(100), codigo)
      .query('SELECT TOP 1 BclIdBeneficioCliente FROM dbo.Ordenes WITH(NOLOCK) WHERE LTRIM(RTRIM(CodigoOrden)) = @Cod AND BclIdBeneficioCliente IS NOT NULL ORDER BY OrdenID DESC');
    bcl = r.recordset[0]?.BclIdBeneficioCliente || null;
  }
  if (!bcl && OrdIdOrden) {
    const r = await pool.request().input('O', sql.Int, OrdIdOrden)
      .query('SELECT TOP 1 BclIdBeneficioCliente FROM dbo.Ordenes WITH(NOLOCK) WHERE OrdenID = @O');
    bcl = r.recordset[0]?.BclIdBeneficioCliente || null;
  }
  if (!bcl) return null;
  const b = await pool.request().input('B', sql.Int, bcl).query(`
    SELECT bc.BclIdBeneficioCliente, bc.BclEstado, bc.BclFechaVencimiento, bc.CliIdCliente, bc.CueIdCuenta,
           cc.CueNombre, cc.MonIdMoneda, cc.CueTipo, cc.CueActiva, cc.CueRestringida, cc.CuePuedeNegativo, cc.CueModalidadFiscal,
           be.BenNombre
    FROM dbo.BeneficiosCliente bc WITH(NOLOCK)
    JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = bc.CueIdCuenta
    JOIN dbo.Beneficios be WITH(NOLOCK) ON be.BenIdBeneficio = bc.BenIdBeneficio
    WHERE bc.BclIdBeneficioCliente = @B`);
  return b.recordset[0] || null;
}

/** ¿La cuenta es la bolsa de un beneficio? Devuelve la fila de BeneficiosCliente o null. */
async function bolsaPorCuenta(pool, cueId, transaction = null) {
  const req = transaction ? new sql.Request(transaction) : pool.request();
  const r = await req.input('C', sql.Int, cueId).query(`
    SELECT TOP 1 bc.BclIdBeneficioCliente, bc.BclEstado, bc.BenIdBeneficio, b.BenNombre
    FROM dbo.BeneficiosCliente bc WITH(NOLOCK) JOIN dbo.Beneficios b WITH(NOLOCK) ON b.BenIdBeneficio = bc.BenIdBeneficio
    WHERE bc.CueIdCuenta = @C`);
  return r.recordset[0] || null;
}

/** Tras un consumo: bolsa en 0 → AGOTADO y cuenta cerrada; vencida → VENCIDO. Devuelve el estado. */
async function refrescarEstadoBolsa(pool, bclId) {
  const r = await pool.request().input('B', sql.Int, bclId).query(`
    SELECT bc.BclEstado, bc.CueIdCuenta, bc.BclFechaVencimiento, b.BenNombre
    FROM dbo.BeneficiosCliente bc JOIN dbo.Beneficios b ON b.BenIdBeneficio = bc.BenIdBeneficio WHERE bc.BclIdBeneficioCliente = @B`);
  const bc = r.recordset[0];
  if (!bc) return null;
  if (bc.BclEstado !== 'ACTIVO' && bc.BclEstado !== 'PAUSADO') return bc.BclEstado;
  const saldo = await saldoRealCuenta(pool, bc.CueIdCuenta);
  if (saldo <= 0.009) {
    await pool.request().input('B', sql.Int, bclId).input('C', sql.Int, bc.CueIdCuenta).query(`
      UPDATE dbo.BeneficiosCliente SET BclEstado = 'AGOTADO', BclFechaCierre = GETDATE() WHERE BclIdBeneficioCliente = @B;
      UPDATE dbo.CuentasCliente SET CueActiva = 0, CueAutoConsumo = 0 WHERE CueIdCuenta = @C;`);
    logger.info(`[BENEFICIOS] Bolsa #${bclId} "${String(bc.BenNombre).trim()}" AGOTADA (saldo ${saldo.toFixed(2)}): el cliente vuelve a su tarifa.`);
    return 'AGOTADO';
  }
  if (bc.BclEstado === 'ACTIVO' && bc.BclFechaVencimiento && String(bc.BclFechaVencimiento).slice(0, 10) < hoyISO()) {
    await pool.request().input('B', sql.Int, bclId).input('C', sql.Int, bc.CueIdCuenta).query(`
      UPDATE dbo.BeneficiosCliente SET BclEstado = 'VENCIDO' WHERE BclIdBeneficioCliente = @B;
      UPDATE dbo.CuentasCliente SET CueAutoConsumo = 0 WHERE CueIdCuenta = @C;`);
    logger.info(`[BENEFICIOS] Bolsa #${bclId} VENCIDA con saldo ${saldo.toFixed(2)}: administración la cierra pasando el saldo a la billetera común.`);
    return 'VENCIDO';
  }
  return bc.BclEstado;
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. PRECIOS: comparación lista / especial / activos / pactado y ALERTAS de precio peor
// ═════════════════════════════════════════════════════════════════════════════

/** Precio unitario por el motor. sinCliente = lista; con cliente y skipBeneficios = lo que paga hoy. */
async function precioMotor({ proId, cod, cliId = null, monedaId = 1, areaId = null }) {
  const PricingService = require('./pricingService');
  const res = await PricingService.calculatePrice(
    { codArticulo: cod || '', proIdProducto: proId || null }, 1,
    cliId ? { cliIdCliente: cliId, clienteLegacy: cliId } : null,
    [], { skipPrepago: true, skipBeneficios: true, skipUrgencia: true }, monedaId === 2 ? 'USD' : 'UYU', null, areaId || null);
  return r2(res?.precioUnitario || 0);
}

function precioPactadoSobre(rg, lista) {
  if (rg.tipo === 'fixed') return r2(rg.valor);
  if (rg.tipo === 'percentage') return r2(Math.max(0, lista * (1 - rg.valor / 100)));
  return r2(Math.max(0, lista - rg.valor));
}

/** Reglas de precio especial del cliente (excepciones directas), ya resueltas a artículo. */
async function especialesDelCliente(pool, cliId) {
  const r = await pool.request().input('Cli', sql.Int, cliId).query(`
    SELECT pei.ProIdProducto, LTRIM(RTRIM(pei.CodArticulo)) AS CodArticulo, pei.CodGrupo, pei.TipoRegla, pei.Valor, pei.MonIdMoneda
    FROM dbo.PreciosEspecialesItems pei WITH(NOLOCK)
    JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = @Cli
    WHERE pei.CliIdCliente = @Cli OR pei.ClienteID = c.CodCliente`);
  return r.recordset;
}

/**
 * Evalúa las reglas de un pacto para un cliente: por regla, lista / especial / beneficios
 * activos que ya alcanzan / pactado / diferencia, y la alerta de precio peor.
 * Para reglas de GRUPO/AREA se evalúan los artículos donde el cliente ya tiene
 * precio especial (ahí es donde un % sobre lista puede salir peor).
 */
async function evaluarReglas(pool, { cliId, reglas, monedaId }) {
  const mon = Number(monedaId) === 2 ? 2 : 1;
  const reglasN = reglas.map(f => reglaDesdeFila({ ...f, ID: null, MonIdMoneda: f.MonIdMoneda }));
  const activos = cliId ? (await bolsasDelCliente(pool, cliId, { estados: ['ACTIVO', 'PAUSADO'] })).filter(b => b.vigente) : [];
  const reglasActivos = [];
  for (const b of activos) for (const rg of await reglasDePerfil(pool, b.PerfilID)) reglasActivos.push({ bolsa: b, rg });
  const especiales = cliId ? await especialesDelCliente(pool, cliId) : [];
  const salida = [];
  let peores = 0;
  for (const rg of reglasN) {
    const item = { ...rg, texto: textoRegla(rg), lista: null, actual: null, pactado: null, difPct: null, peor: false, detalle: [], activosQueAlcanzan: [] };
    const artsAEvaluar = [];
    if (rg.alcance === 'ARTICULO') {
      const art = await resolverArticulo(pool, { proId: rg.proIdProducto, cod: rg.codArticulo });
      if (art) { artsAEvaluar.push(art); item.descripcion = art.descripcion; item.proIdProducto = art.proId; item.codArticulo = art.cod; }
    } else {
      // artículos con precio especial del cliente que caen dentro del alcance
      for (const e of especiales.slice(0, 60)) {
        if (!e.ProIdProducto && !e.CodArticulo) continue;
        const art = await resolverArticulo(pool, { proId: e.ProIdProducto, cod: e.CodArticulo });
        if (art && rangoAlcance(rg, art) >= 0 && !artsAEvaluar.some(a => a.proId === art.proId)) artsAEvaluar.push(art);
      }
    }
    for (const art of artsAEvaluar.slice(0, 40)) {
      let lista = 0, actual = 0;
      try { lista = await precioMotor({ proId: art.proId, cod: art.cod, monedaId: mon, areaId: art.areaId }); } catch (e) { logger.warn(`[BENEFICIOS] lista ${art.cod}: ${e.message}`); }
      try { actual = cliId ? await precioMotor({ proId: art.proId, cod: art.cod, cliId, monedaId: mon, areaId: art.areaId }) : lista; } catch (e) { actual = lista; }
      const pactado = precioPactadoSobre(rg, lista);
      const peor = actual > 0 && pactado > actual + 0.005;
      const d = { proId: art.proId, cod: art.cod, descripcion: art.descripcion, lista, actual, pactado, peor, difPct: lista > 0 ? r2((pactado - lista) / lista * 100) : null };
      item.detalle.push(d);
      if (rg.alcance === 'ARTICULO') { item.lista = lista; item.actual = actual; item.pactado = pactado; item.difPct = d.difPct; }
      if (peor) { item.peor = true; peores += 1; }
    }
    for (const { bolsa, rg: ra } of reglasActivos) {
      const solapa = rg.alcance === 'ARTICULO'
        ? artsAEvaluar.some(a => rangoAlcance(ra, a) >= 0)
        : (ra.alcance === rg.alcance && ((rg.alcance === 'GRUPO' && ra.codGrupo === rg.codGrupo) || (rg.alcance === 'AREA' && ra.areaId === rg.areaId)))
          || artsAEvaluar.some(a => rangoAlcance(ra, a) >= 0);
      if (solapa && !item.activosQueAlcanzan.some(x => x.bclId === bolsa.BclIdBeneficioCliente)) {
        item.activosQueAlcanzan.push({ bclId: bolsa.BclIdBeneficioCliente, nombre: String(bolsa.BenNombre).trim(), vence: bolsa.BclFechaVencimiento, masEspecifico: rg.alcance !== 'ARTICULO' && ra.alcance === 'ARTICULO' });
      }
    }
    salida.push(item);
  }
  return { reglas: salida, peores };
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. PLANTILLAS
// ═════════════════════════════════════════════════════════════════════════════

const SELECT_BEN = `
  SELECT b.*, c.Nombre AS ClienteNombre, c.CodCliente, c.IDCliente,
         uv.Nombre AS VendedorNombre, uv.Usuario AS VendedorUsuario, ua.Nombre AS AprobadorNombre,
         pb.BenNombre AS PlantillaBaseNombre
  FROM dbo.Beneficios b WITH(NOLOCK)
  LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = b.CliIdCliente
  LEFT JOIN dbo.Usuarios uv WITH(NOLOCK) ON uv.IdUsuario = b.BenVendedorId
  LEFT JOIN dbo.Usuarios ua WITH(NOLOCK) ON ua.IdUsuario = b.BenAprobadorId
  LEFT JOIN dbo.Beneficios pb WITH(NOLOCK) ON pb.BenIdBeneficio = b.BenIdPlantillaBase`;

function mapBeneficio(b) {
  return {
    BenIdBeneficio: b.BenIdBeneficio, tipo: b.BenTipo, nombre: String(b.BenNombre || '').trim(), descripcion: b.BenDescripcion || '',
    perfilId: b.PerfilID, monedaId: Number(b.MonIdMoneda) === 2 ? 2 : 1, carga: r2(b.BenCargaImporte), cargaEsMinimo: !!b.BenCargaEsMinimo,
    vigenciaDias: b.BenVigenciaDias, vigenciaHasta: b.BenVigenciaHasta ? String(b.BenVigenciaHasta).slice(0, 10) : null,
    publico: !!b.BenPublico, estado: b.BenEstado, cliId: b.CliIdCliente, clienteNombre: b.ClienteNombre ? String(b.ClienteNombre).trim() : null,
    codCliente: b.CodCliente, idCliente: b.IDCliente, plantillaBaseId: b.BenIdPlantillaBase, plantillaBaseNombre: b.PlantillaBaseNombre ? String(b.PlantillaBaseNombre).trim() : null,
    vendedorId: b.BenVendedorId, vendedorNombre: b.VendedorNombre || b.VendedorUsuario || null, nota: b.BenNota || '',
    alertas: (() => { try { return b.BenAlertas ? JSON.parse(b.BenAlertas) : null; } catch { return null; } })(),
    aprobadorId: b.BenAprobadorId, aprobadorNombre: b.AprobadorNombre || null, fechaAprobacion: b.BenFechaAprobacion, notaAprobador: b.BenNotaAprobador || '',
    motivoRechazo: b.BenMotivoRechazo || '', fechaAlta: b.BenFechaAlta, usuarioAlta: b.BenUsuarioAlta, fechaModif: b.BenFechaModif,
  };
}

async function obtenerBeneficio(pool, benId, { conReglas = true } = {}) {
  const r = await pool.request().input('Id', sql.Int, benId).query(`${SELECT_BEN} WHERE b.BenIdBeneficio = @Id`);
  if (!r.recordset.length) return null;
  const b = mapBeneficio(r.recordset[0]);
  if (conReglas) { b.reglas = await reglasDePerfil(pool, b.perfilId); b.reglasTexto = b.reglas.map(textoRegla); }
  return b;
}

async function listarPlantillas(pool, { estado = null, soloPublicadas = false } = {}) {
  const req = pool.request();
  let where = "b.BenTipo = 'PLANTILLA'";
  if (estado) { req.input('E', sql.VarChar(20), estado); where += ' AND b.BenEstado = @E'; }
  if (soloPublicadas) where += " AND b.BenEstado = 'PUBLICADA'";
  const r = await req.query(`${SELECT_BEN} WHERE ${where} ORDER BY b.BenEstado, b.BenNombre`);
  const lista = [];
  for (const row of r.recordset) {
    const b = mapBeneficio(row);
    b.reglas = await reglasDePerfil(pool, b.perfilId);
    b.reglasTexto = b.reglas.map(textoRegla);
    const act = await pool.request().input('B', sql.Int, b.BenIdBeneficio).query(`
      SELECT COUNT(*) AS n, SUM(CASE WHEN BclEstado IN ('ACTIVO','PAUSADO') THEN 1 ELSE 0 END) AS vivos
      FROM dbo.BeneficiosCliente WITH(NOLOCK) WHERE BenIdBeneficio = @B OR BenIdBeneficio IN (SELECT BenIdBeneficio FROM dbo.Beneficios WHERE BenIdPlantillaBase = @B)`);
    b.activaciones = Number(act.recordset[0]?.n || 0); b.activacionesVivas = Number(act.recordset[0]?.vivos || 0);
    lista.push(b);
  }
  return lista;
}

function validarDefinicion(data) {
  const nombre = String(data.nombre || '').trim();
  if (nombre.length < 3) throw new BeneficioError('El nombre del beneficio necesita al menos 3 caracteres.');
  const monedaId = Number(data.monedaId) === 2 ? 2 : 1;
  const carga = r2(data.carga);
  if (!(carga > 0)) throw new BeneficioError('La carga que activa el beneficio debe ser mayor a 0.');
  const vigenciaDias = data.vigenciaDias != null && data.vigenciaDias !== '' ? parseInt(data.vigenciaDias) : null;
  const vigenciaHasta = data.vigenciaHasta ? String(data.vigenciaHasta).slice(0, 10) : null;
  if (vigenciaDias != null && !(vigenciaDias > 0)) throw new BeneficioError('Los días de vigencia deben ser un número mayor a 0.');
  if (vigenciaHasta && vigenciaHasta < hoyISO()) throw new BeneficioError('La fecha de vigencia ya pasó.');
  const reglas = normalizarReglas(data.reglas, monedaId);
  return { nombre: nombre.slice(0, 120), descripcion: String(data.descripcion || '').trim().slice(0, 500), monedaId, carga, cargaEsMinimo: !!data.cargaEsMinimo, vigenciaDias, vigenciaHasta, reglas };
}

async function crearPlantilla(pool, data, user) {
  const d = validarDefinicion(data);
  const publico = !!data.publico;
  // Una plantilla nueva pasa UNA vez por aprobación antes de publicarse; quien puede
  // aprobar la publica directo.
  const estado = (await puedeAprobar(pool, user)) ? 'PUBLICADA' : 'PENDIENTE';
  const tx = pool.transaction(); await tx.begin();
  try {
    const perfilId = await guardarPerfilBeneficio(tx, { nombre: d.nombre, reglas: d.reglas });
    const ins = await new sql.Request(tx)
      .input('N', sql.NVarChar(120), d.nombre).input('D', sql.NVarChar(500), d.descripcion).input('P', sql.Int, perfilId)
      .input('Mon', sql.Int, d.monedaId).input('Carga', sql.Decimal(18, 2), d.carga).input('Min', sql.Bit, d.cargaEsMinimo ? 1 : 0)
      .input('VD', sql.Int, d.vigenciaDias).input('VH', sql.Date, d.vigenciaHasta).input('Pub', sql.Bit, publico ? 1 : 0)
      .input('E', sql.VarChar(20), estado).input('U', sql.Int, user?.id || null)
      .input('Apr', sql.Int, estado === 'PUBLICADA' ? (user?.id || null) : null)
      .query(`INSERT INTO dbo.Beneficios (BenTipo, BenNombre, BenDescripcion, PerfilID, MonIdMoneda, BenCargaImporte, BenCargaEsMinimo,
                BenVigenciaDias, BenVigenciaHasta, BenPublico, BenEstado, BenVendedorId, BenUsuarioAlta, BenAprobadorId, BenFechaAprobacion)
              OUTPUT INSERTED.BenIdBeneficio
              VALUES ('PLANTILLA', @N, @D, @P, @Mon, @Carga, @Min, @VD, @VH, @Pub, @E, @U, @U, @Apr, CASE WHEN @Apr IS NULL THEN NULL ELSE GETDATE() END)`);
    await tx.commit();
    const id = ins.recordset[0].BenIdBeneficio;
    logger.info(`[BENEFICIOS] Plantilla #${id} "${d.nombre}" creada (${estado}) por usuario ${user?.id}`);
    return obtenerBeneficio(pool, id);
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
}

async function editarPlantilla(pool, benId, data, user) {
  const actual = await obtenerBeneficio(pool, benId, { conReglas: false });
  if (!actual || actual.tipo !== 'PLANTILLA') throw new BeneficioError('Plantilla inexistente.', 404);
  const d = validarDefinicion(data);
  const publico = data.publico == null ? actual.publico : !!data.publico;
  // Editar una plantilla la vuelve a pasar por aprobación (salvo que edite quien aprueba). Las
  // activaciones ya hechas conservan su propio perfil? NO: comparten el perfil. Para no cambiar
  // precios ya pactados, si la plantilla tiene bolsas vivas se crea un perfil NUEVO.
  const vivas = await pool.request().input('B', sql.Int, benId).query(`SELECT COUNT(*) n FROM dbo.BeneficiosCliente WHERE BenIdBeneficio = @B AND BclEstado IN ('ACTIVO','PAUSADO')`);
  const tieneVivas = Number(vivas.recordset[0]?.n || 0) > 0;
  const estado = (await puedeAprobar(pool, user)) ? (actual.estado === 'PAUSADA' ? 'PAUSADA' : 'PUBLICADA') : 'PENDIENTE';
  const tx = pool.transaction(); await tx.begin();
  try {
    const perfilId = await guardarPerfilBeneficio(tx, { perfilId: tieneVivas ? null : actual.perfilId, nombre: d.nombre, reglas: d.reglas });
    await new sql.Request(tx)
      .input('Id', sql.Int, benId).input('N', sql.NVarChar(120), d.nombre).input('D', sql.NVarChar(500), d.descripcion).input('P', sql.Int, perfilId)
      .input('Mon', sql.Int, d.monedaId).input('Carga', sql.Decimal(18, 2), d.carga).input('Min', sql.Bit, d.cargaEsMinimo ? 1 : 0)
      .input('VD', sql.Int, d.vigenciaDias).input('VH', sql.Date, d.vigenciaHasta).input('Pub', sql.Bit, publico ? 1 : 0)
      .input('E', sql.VarChar(20), estado).input('U', sql.Int, user?.id || null)
      .query(`UPDATE dbo.Beneficios SET BenNombre=@N, BenDescripcion=@D, PerfilID=@P, MonIdMoneda=@Mon, BenCargaImporte=@Carga, BenCargaEsMinimo=@Min,
                BenVigenciaDias=@VD, BenVigenciaHasta=@VH, BenPublico=@Pub, BenEstado=@E, BenFechaModif=GETDATE(), BenUsuarioModif=@U
              WHERE BenIdBeneficio=@Id`);
    await tx.commit();
    return obtenerBeneficio(pool, benId);
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
}

async function cambiarEstadoPlantilla(pool, benId, accion, user, { nota = '', motivo = '' } = {}) {
  const b = await obtenerBeneficio(pool, benId, { conReglas: false });
  if (!b || b.tipo !== 'PLANTILLA') throw new BeneficioError('Plantilla inexistente.', 404);
  let nuevo, extra = '';
  const req = pool.request().input('Id', sql.Int, benId).input('U', sql.Int, user?.id || null)
    .input('Nota', sql.NVarChar(1000), String(nota || '').slice(0, 1000)).input('Mot', sql.NVarChar(1000), String(motivo || '').slice(0, 1000));
  switch (accion) {
    case 'aprobar':
      if (!(await puedeAprobar(pool, user))) throw new BeneficioError('Solo Administración puede aprobar plantillas.', 403);
      if (b.estado !== 'PENDIENTE') throw new BeneficioError(`La plantilla está ${b.estado}, no pendiente de aprobación.`);
      nuevo = 'PUBLICADA'; extra = ', BenAprobadorId = @U, BenFechaAprobacion = GETDATE(), BenNotaAprobador = @Nota'; break;
    case 'rechazar':
      if (!(await puedeAprobar(pool, user))) throw new BeneficioError('Solo Administración puede rechazar plantillas.', 403);
      if (b.estado !== 'PENDIENTE') throw new BeneficioError(`La plantilla está ${b.estado}, no pendiente de aprobación.`);
      if (!String(motivo || '').trim()) throw new BeneficioError('El motivo del rechazo es obligatorio.');
      nuevo = 'BORRADOR'; extra = ', BenMotivoRechazo = @Mot'; break;
    case 'pausar':
      if (b.estado !== 'PUBLICADA') throw new BeneficioError('Solo se pausa una plantilla publicada.');
      nuevo = 'PAUSADA'; break;
    case 'reanudar':
      if (b.estado !== 'PAUSADA') throw new BeneficioError('La plantilla no está pausada.');
      nuevo = 'PUBLICADA'; break;
    case 'enviar':
      if (b.estado !== 'BORRADOR') throw new BeneficioError('Solo un borrador se envía a aprobación.');
      nuevo = 'PENDIENTE'; break;
    default: throw new BeneficioError(`Acción desconocida: ${accion}`);
  }
  await req.input('E', sql.VarChar(20), nuevo).query(`UPDATE dbo.Beneficios SET BenEstado = @E, BenFechaModif = GETDATE(), BenUsuarioModif = @U ${extra} WHERE BenIdBeneficio = @Id`);
  logger.info(`[BENEFICIOS] Plantilla #${benId} ${accion} → ${nuevo} (usuario ${user?.id})`);
  return obtenerBeneficio(pool, benId);
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. PACTOS (vendedor ↔ cliente)
// ═════════════════════════════════════════════════════════════════════════════

async function proponerPacto(pool, data, user) {
  const cliId = parseInt(data.cliId);
  if (!cliId) throw new BeneficioError('Falta el cliente.');
  const cli = (await pool.request().input('C', sql.Int, cliId).query('SELECT CliIdCliente, Nombre FROM dbo.Clientes WITH(NOLOCK) WHERE CliIdCliente = @C')).recordset[0];
  if (!cli) throw new BeneficioError('Cliente inexistente.', 404);
  const d = validarDefinicion(data);
  const plantillaBaseId = parseInt(data.plantillaBaseId) || null;
  if (plantillaBaseId) {
    const pb = await obtenerBeneficio(pool, plantillaBaseId, { conReglas: false });
    if (!pb || pb.tipo !== 'PLANTILLA') throw new BeneficioError('La plantilla base no existe.');
  }
  // Alertas de precio peor, calculadas al proponer (quedan en el pacto)
  const evaluacion = await evaluarReglas(pool, { cliId, reglas: d.reglas, monedaId: d.monedaId });
  const tx = pool.transaction(); await tx.begin();
  try {
    const perfilId = await guardarPerfilBeneficio(tx, { nombre: `${d.nombre} · ${String(cli.Nombre).trim().slice(0, 40)}`, reglas: d.reglas });
    const ins = await new sql.Request(tx)
      .input('N', sql.NVarChar(120), d.nombre).input('D', sql.NVarChar(500), d.descripcion).input('P', sql.Int, perfilId)
      .input('Mon', sql.Int, d.monedaId).input('Carga', sql.Decimal(18, 2), d.carga).input('Min', sql.Bit, d.cargaEsMinimo ? 1 : 0)
      .input('VD', sql.Int, d.vigenciaDias).input('VH', sql.Date, d.vigenciaHasta).input('Cli', sql.Int, cliId)
      .input('PB', sql.Int, plantillaBaseId).input('U', sql.Int, user?.id || null).input('Nota', sql.NVarChar(1000), String(data.nota || '').slice(0, 1000))
      .input('Al', sql.NVarChar(sql.MAX), JSON.stringify({ peores: evaluacion.peores, reglas: evaluacion.reglas.map(x => ({ texto: x.texto, alcance: x.alcance, lista: x.lista, actual: x.actual, pactado: x.pactado, difPct: x.difPct, peor: x.peor, detalle: x.detalle, activosQueAlcanzan: x.activosQueAlcanzan })) }))
      .query(`INSERT INTO dbo.Beneficios (BenTipo, BenNombre, BenDescripcion, PerfilID, MonIdMoneda, BenCargaImporte, BenCargaEsMinimo,
                BenVigenciaDias, BenVigenciaHasta, BenPublico, BenEstado, CliIdCliente, BenIdPlantillaBase, BenVendedorId, BenNota, BenAlertas, BenUsuarioAlta)
              OUTPUT INSERTED.BenIdBeneficio
              VALUES ('PACTO', @N, @D, @P, @Mon, @Carga, @Min, @VD, @VH, 0, 'PENDIENTE', @Cli, @PB, @U, @Nota, @Al, @U)`);
    await tx.commit();
    const id = ins.recordset[0].BenIdBeneficio;
    logger.info(`[BENEFICIOS] Pacto #${id} "${d.nombre}" propuesto para cliente ${cliId} por usuario ${user?.id} (${evaluacion.peores} precio(s) peor(es))`);
    return { ...(await obtenerBeneficio(pool, id)), evaluacion };
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
}

/**
 * Corrige un pacto RECHAZADO y lo reenvía a aprobación (specs/40: "que yo lo pueda
 * rectificar"). Solo el vendedor que lo propuso o quien aprueba pueden editarlo. El
 * perfil se reescribe en el lugar (un rechazado nunca se activó: no hay bolsas viviendo
 * de sus reglas viejas). Limpia la decisión anterior (motivo, aprobador, fecha).
 */
async function editarPacto(pool, benId, data, user) {
  const actual = await obtenerBeneficio(pool, benId, { conReglas: false });
  if (!actual || actual.tipo !== 'PACTO') throw new BeneficioError('Pacto inexistente.', 404);
  if (actual.estado !== 'RECHAZADO') throw new BeneficioError(`Solo se puede editar un pacto RECHAZADO (está ${actual.estado}).`);
  if (!(await puedeAprobar(pool, user)) && Number(actual.vendedorId) !== Number(user?.id))
    throw new BeneficioError('Solo el vendedor que lo propuso o Administración pueden editarlo.', 403);
  const d = validarDefinicion(data);
  const cli = (await pool.request().input('C', sql.Int, actual.cliId).query('SELECT Nombre FROM dbo.Clientes WITH(NOLOCK) WHERE CliIdCliente = @C')).recordset[0];
  const evaluacion = await evaluarReglas(pool, { cliId: actual.cliId, reglas: d.reglas, monedaId: d.monedaId });
  const tx = pool.transaction(); await tx.begin();
  try {
    await guardarPerfilBeneficio(tx, { perfilId: actual.perfilId, nombre: `${d.nombre} · ${String(cli?.Nombre || '').trim().slice(0, 40)}`, reglas: d.reglas });
    await new sql.Request(tx)
      .input('Id', sql.Int, benId)
      .input('N', sql.NVarChar(120), d.nombre).input('D', sql.NVarChar(500), d.descripcion)
      .input('Mon', sql.Int, d.monedaId).input('Carga', sql.Decimal(18, 2), d.carga).input('Min', sql.Bit, d.cargaEsMinimo ? 1 : 0)
      .input('VD', sql.Int, d.vigenciaDias).input('VH', sql.Date, d.vigenciaHasta)
      .input('U', sql.Int, user?.id || null).input('Nota', sql.NVarChar(1000), String(data.nota || '').slice(0, 1000))
      .input('Al', sql.NVarChar(sql.MAX), JSON.stringify({ peores: evaluacion.peores, reglas: evaluacion.reglas.map(x => ({ texto: x.texto, alcance: x.alcance, lista: x.lista, actual: x.actual, pactado: x.pactado, difPct: x.difPct, peor: x.peor, detalle: x.detalle, activosQueAlcanzan: x.activosQueAlcanzan })) }))
      .query(`UPDATE dbo.Beneficios SET
                BenNombre = @N, BenDescripcion = @D, MonIdMoneda = @Mon, BenCargaImporte = @Carga, BenCargaEsMinimo = @Min,
                BenVigenciaDias = @VD, BenVigenciaHasta = @VH, BenNota = @Nota, BenAlertas = @Al,
                BenEstado = 'PENDIENTE', BenMotivoRechazo = NULL, BenAprobadorId = NULL, BenFechaAprobacion = NULL, BenNotaAprobador = NULL,
                BenFechaModif = GETDATE(), BenUsuarioModif = @U
              WHERE BenIdBeneficio = @Id`);
    await tx.commit();
    logger.info(`[BENEFICIOS] Pacto #${benId} "${d.nombre}" corregido y reenviado a aprobación por usuario ${user?.id} (${evaluacion.peores} precio(s) peor(es))`);
    return { ...(await obtenerBeneficio(pool, benId)), evaluacion };
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
}

async function listarPactos(pool, { estado = null, cliId = null, vendedorId = null, desde = null, hasta = null, incluirPlantillas = true } = {}) {
  const req = pool.request();
  const cond = [];
  if (incluirPlantillas) cond.push("(b.BenTipo = 'PACTO' OR (b.BenTipo = 'PLANTILLA' AND b.BenEstado = 'PENDIENTE'))");
  else cond.push("b.BenTipo = 'PACTO'");
  if (estado) { req.input('E', sql.VarChar(20), estado); cond.push('b.BenEstado = @E'); }
  if (cliId) { req.input('Cli', sql.Int, cliId); cond.push('b.CliIdCliente = @Cli'); }
  if (vendedorId) { req.input('V', sql.Int, vendedorId); cond.push('b.BenVendedorId = @V'); }
  if (desde) { req.input('Fd', sql.Date, desde); cond.push('CAST(b.BenFechaAlta AS date) >= @Fd'); }
  if (hasta) { req.input('Fh', sql.Date, hasta); cond.push('CAST(b.BenFechaAlta AS date) <= @Fh'); }
  const r = await req.query(`${SELECT_BEN} WHERE ${cond.join(' AND ')} ORDER BY b.BenFechaAlta DESC`);
  const out = [];
  for (const row of r.recordset) {
    const b = mapBeneficio(row);
    b.reglas = await reglasDePerfil(pool, b.perfilId);
    b.reglasTexto = b.reglas.map(textoRegla);
    if (b.tipo === 'PACTO') {
      const act = await pool.request().input('B', sql.Int, b.BenIdBeneficio).query(`
        SELECT TOP 1 bc.BclIdBeneficioCliente, bc.CueIdCuenta, bc.BclEstado, bc.BclFechaActivacion, bc.BclFechaVencimiento, bc.BclImporteCarga, bc.BclOrigen,
               ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK) WHERE m.CueIdCuenta = bc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo,
               (SELECT COUNT(*) FROM dbo.MovimientosCuenta m2 WITH(NOLOCK) WHERE m2.CueIdCuenta = bc.CueIdCuenta AND m2.MovTipo = 'CONSUMO_CUENTA' AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)) AS Consumos
        FROM dbo.BeneficiosCliente bc WITH(NOLOCK) WHERE bc.BenIdBeneficio = @B ORDER BY bc.BclFechaActivacion DESC`);
      b.activacion = act.recordset[0] ? { ...act.recordset[0], Saldo: r2(act.recordset[0].Saldo) } : null;
    }
    out.push(b);
  }
  return out;
}

async function resumenPactos(pool) {
  const r = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.Beneficios WHERE BenEstado = 'PENDIENTE') AS pendientes,
      (SELECT COUNT(*) FROM dbo.Beneficios WHERE BenTipo = 'PACTO' AND BenEstado = 'APROBADO') AS aprobadosSinActivar,
      (SELECT COUNT(*) FROM dbo.BeneficiosCliente WHERE BclEstado IN ('ACTIVO','PAUSADO')) AS activos,
      (SELECT COUNT(*) FROM dbo.BeneficiosCliente WHERE BclEstado IN ('AGOTADO','VENCIDO','CERRADO')) + (SELECT COUNT(*) FROM dbo.Beneficios WHERE BenEstado IN ('RECHAZADO','CANCELADO')) AS historial`);
  // OJO: SQL Server no admite un SUM(...) cuyo argumento sea una subconsulta que a su vez
  // trae otro SUM (error "Cannot perform an aggregate function on an expression containing
  // an aggregate or a subquery"). Se resuelve el saldo por cuenta en una tabla derivada
  // primero, y recién ahí se agrupa/suma sobre esa columna ya plana.
  const saldo = await pool.request().query(`
    SELECT x.MonIdMoneda, SUM(x.Saldo) AS Saldo
    FROM (
      SELECT cc.MonIdMoneda, cc.CueIdCuenta,
        ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK) WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0) AS Saldo
      FROM dbo.BeneficiosCliente bc WITH(NOLOCK) JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = bc.CueIdCuenta
      WHERE bc.BclEstado IN ('ACTIVO','PAUSADO')
    ) x
    GROUP BY x.MonIdMoneda`);
  const out = { ...r.recordset[0], saldoVivoUYU: 0, saldoVivoUSD: 0 };
  for (const s of saldo.recordset) { if (Number(s.MonIdMoneda) === 2) out.saldoVivoUSD = r2(s.Saldo); else out.saldoVivoUYU = r2(s.Saldo); }
  return out;
}

async function decidirPacto(pool, benId, accion, user, { nota = '', motivo = '' } = {}) {
  const b = await obtenerBeneficio(pool, benId, { conReglas: false });
  if (!b) throw new BeneficioError('Pacto inexistente.', 404);
  if (b.tipo === 'PLANTILLA') return cambiarEstadoPlantilla(pool, benId, accion, user, { nota, motivo });
  const req = pool.request().input('Id', sql.Int, benId).input('U', sql.Int, user?.id || null)
    .input('Nota', sql.NVarChar(1000), String(nota || '').slice(0, 1000)).input('Mot', sql.NVarChar(1000), String(motivo || '').slice(0, 1000));
  let nuevo, extra = '';
  if (accion === 'aprobar') {
    if (!(await puedeAprobar(pool, user))) throw new BeneficioError('Solo Administración puede aprobar pactos.', 403);
    if (b.estado !== 'PENDIENTE') throw new BeneficioError(`El pacto está ${b.estado}, no pendiente.`);
    if (b.vendedorId && user?.id && Number(b.vendedorId) === Number(user.id)) throw new BeneficioError('Un vendedor no puede aprobar su propio pacto.', 403);
    if ((b.alertas?.peores || 0) > 0 && !String(nota || '').trim()) throw new BeneficioError(`Este pacto tiene ${b.alertas.peores} precio(s) peor(es) que los actuales del cliente: la nota es obligatoria para aprobarlo igual.`);
    nuevo = 'APROBADO'; extra = ', BenAprobadorId = @U, BenFechaAprobacion = GETDATE(), BenNotaAprobador = @Nota';
  } else if (accion === 'rechazar') {
    if (!(await puedeAprobar(pool, user))) throw new BeneficioError('Solo Administración puede rechazar pactos.', 403);
    if (b.estado !== 'PENDIENTE') throw new BeneficioError(`El pacto está ${b.estado}, no pendiente.`);
    if (!String(motivo || '').trim()) throw new BeneficioError('El motivo del rechazo es obligatorio.');
    nuevo = 'RECHAZADO'; extra = ', BenAprobadorId = @U, BenFechaAprobacion = GETDATE(), BenMotivoRechazo = @Mot';
  } else if (accion === 'cancelar') {
    if (!['PENDIENTE', 'APROBADO'].includes(b.estado)) throw new BeneficioError(`Solo se cancela un pacto pendiente o aprobado sin activar (está ${b.estado}).`);
    if (!(await puedeAprobar(pool, user)) && Number(b.vendedorId) !== Number(user?.id)) throw new BeneficioError('Solo el vendedor que lo propuso o Administración pueden cancelarlo.', 403);
    nuevo = 'CANCELADO'; extra = ', BenMotivoRechazo = @Mot';
  } else throw new BeneficioError(`Acción desconocida: ${accion}`);
  await req.input('E', sql.VarChar(20), nuevo).query(`UPDATE dbo.Beneficios SET BenEstado = @E, BenFechaModif = GETDATE(), BenUsuarioModif = @U ${extra} WHERE BenIdBeneficio = @Id`);
  logger.info(`[BENEFICIOS] Pacto #${benId} ${accion} → ${nuevo} (usuario ${user?.id})`);
  return obtenerBeneficio(pool, benId);
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. ACTIVACIÓN = carga facturada → nace la bolsa
// ═════════════════════════════════════════════════════════════════════════════

/** Beneficios que un cliente puede activar hoy: sus pactos APROBADOS + plantillas PUBLICADAS (públicas o, en caja, todas). */
async function disponiblesParaCliente(pool, cliId, { incluirNoPublicas = false } = {}) {
  const r = await pool.request().input('Cli', sql.Int, cliId).input('Inc', sql.Bit, incluirNoPublicas ? 1 : 0).query(`${SELECT_BEN}
    WHERE (b.BenTipo = 'PACTO' AND b.BenEstado = 'APROBADO' AND b.CliIdCliente = @Cli)
       OR (b.BenTipo = 'PLANTILLA' AND b.BenEstado = 'PUBLICADA' AND (b.BenPublico = 1 OR @Inc = 1))
    ORDER BY b.BenTipo DESC, b.BenNombre`);
  const out = [];
  for (const row of r.recordset) { const b = mapBeneficio(row); b.reglas = await reglasDePerfil(pool, b.perfilId); b.reglasTexto = b.reglas.map(textoRegla); out.push(b); }
  return out;
}

async function materializarAlcance(transaction, cueId, reglas) {
  const req = () => new sql.Request(transaction);
  const ids = new Set();
  for (const rg of reglas) {
    if (rg.alcance === 'ARTICULO') {
      if (rg.proIdProducto) ids.add(rg.proIdProducto);
      else if (rg.codArticulo) {
        const r = await req().input('C', sql.VarChar(50), rg.codArticulo).query('SELECT TOP 1 ProIdProducto FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = @C');
        if (r.recordset[0]) ids.add(r.recordset[0].ProIdProducto);
      }
    } else if (rg.alcance === 'GRUPO') {
      const r = await req().input('G', sql.VarChar(50), rg.codGrupo).input('G2', sql.VarChar(52), rg.codGrupo + '.%')
        .query('SELECT TOP 300 ProIdProducto FROM dbo.Articulos WHERE LTRIM(RTRIM(Grupo)) = @G OR LTRIM(RTRIM(Grupo)) LIKE @G2');
      r.recordset.forEach(x => ids.add(x.ProIdProducto));
    } else if (rg.alcance === 'AREA') {
      const r = await req().input('A', sql.VarChar(20), rg.areaId)
        .query('SELECT DISTINCT TOP 300 ProIdProducto FROM dbo.Ordenes WITH(NOLOCK) WHERE UPPER(LTRIM(RTRIM(AreaID))) = @A AND ProIdProducto IS NOT NULL');
      r.recordset.forEach(x => ids.add(x.ProIdProducto));
    }
  }
  for (const id of ids) {
    await req().input('C', sql.Int, cueId).input('P', sql.Int, id)
      .query('IF NOT EXISTS (SELECT 1 FROM dbo.CuentasClienteArticulosPermitidos WHERE CueIdCuenta = @C AND ProIdProducto = @P) INSERT INTO dbo.CuentasClienteArticulosPermitidos (CueIdCuenta, ProIdProducto, FechaAlta) VALUES (@C, @P, GETDATE())');
  }
  return ids.size;
}

/**
 * Activa un beneficio: crea la bolsa, materializa su alcance, carga la plata contra
 * la factura y deja el beneficio ACTIVO. Transaccional. Devuelve { bclId, cueId, vence }.
 * @param docId   factura ya emitida (DocumentosContables) de esa carga — obligatoria
 * @param importe importe cargado (= pactado, o ≥ mínimo)
 * @param origen  'CAJA' | 'PORTAL'
 */
async function activarBeneficio(pool, { benId, cliId, docId, importe, monedaId, usuarioId = 999, origen = 'CAJA', txId = null, transaction = null }) {
  if (!(await beneficiosActivos(pool))) throw new BeneficioError('Los beneficios están apagados en la configuración general (BENEFICIOS_ACTIVOS): no se puede activar ninguno todavía.', 409);
  const b = await obtenerBeneficio(pool, benId);
  if (!b) throw new BeneficioError('Beneficio inexistente.', 404);
  if (b.tipo === 'PACTO') {
    if (b.estado !== 'APROBADO') throw new BeneficioError(`El pacto está ${b.estado}: solo se activa un pacto APROBADO sin activar.`);
    if (Number(b.cliId) !== Number(cliId)) throw new BeneficioError('El pacto es de otro cliente.');
  } else {
    if (b.estado !== 'PUBLICADA') throw new BeneficioError(`La plantilla está ${b.estado}: solo se activa una plantilla publicada.`);
    if (origen === 'PORTAL' && !b.publico) throw new BeneficioError('Esta plantilla no está disponible para activar desde el portal.');
  }
  const mon = Number(monedaId) === 2 ? 2 : 1;
  if (mon !== b.monedaId) throw new BeneficioError(`El beneficio es en ${b.monedaId === 2 ? 'US$' : '$'} y la carga viene en ${mon === 2 ? 'US$' : '$'}.`);
  const imp = r2(importe);
  if (b.cargaEsMinimo ? imp + 0.01 < b.carga : Math.abs(imp - b.carga) > 0.01)
    throw new BeneficioError(b.cargaEsMinimo ? `La carga mínima de este beneficio es ${b.carga.toFixed(2)}.` : `La carga de este beneficio es exactamente ${b.carga.toFixed(2)} (se cargó ${imp.toFixed(2)}).`);
  if (!docId) throw new BeneficioError('Falta la factura de la carga: un beneficio solo se activa con una carga facturada.');

  const own = !transaction;
  const tx = transaction || pool.transaction();
  if (own) await tx.begin();
  const req = () => new sql.Request(tx);
  try {
    const doc = (await req().input('D', sql.Int, docId).query('SELECT DocIdDocumento, CliIdCliente, DocTotal, MonIdMoneda, DocEstado, DocSerie, DocNumero FROM dbo.DocumentosContables WHERE DocIdDocumento = @D')).recordset[0];
    if (!doc) throw new BeneficioError('La factura de la carga no existe.', 404);
    if (Number(doc.CliIdCliente) !== Number(cliId)) throw new BeneficioError('La factura no es de este cliente.');
    if (String(doc.DocEstado || '').toUpperCase() === 'ANULADO') throw new BeneficioError('La factura está anulada.');
    if ((Number(doc.MonIdMoneda) === 2 ? 2 : 1) !== mon) throw new BeneficioError('La factura está en otra moneda que el beneficio.');
    if (Math.abs(Number(doc.DocTotal) - imp) > 0.01) throw new BeneficioError(`La factura es por ${Number(doc.DocTotal).toFixed(2)} y la carga por ${imp.toFixed(2)}.`);
    const usada = await req().input('D', sql.Int, docId).query(`
      SELECT TOP 1 1 AS x FROM dbo.MovimientosCuenta WHERE DocIdDocumento = @D AND MovTipo = 'CARGA_PREPAGO' AND (MovAnulado IS NULL OR MovAnulado = 0)
      UNION ALL SELECT TOP 1 1 FROM dbo.BeneficiosCliente WHERE DocIdDocumento = @D`);
    if (usada.recordset.length) throw new BeneficioError(`La factura ${doc.DocSerie}-${doc.DocNumero} ya cargó saldo: no se usa dos veces.`);

    // 1) la bolsa
    const nombreCta = `Beneficio: ${b.nombre}`.slice(0, 100);
    const ins = await req()
      .input('Cli', sql.Int, cliId).input('Tipo', sql.VarChar(20), mon === 2 ? 'DINERO_USD' : 'DINERO_UYU').input('Mon', sql.Int, mon)
      .input('Nombre', sql.NVarChar(100), nombreCta).input('Usr', sql.Int, usuarioId)
      .query(`INSERT INTO dbo.CuentasCliente
                (CliIdCliente, CueTipo, ProIdProducto, MonIdMoneda, CPaIdCondicion, CueSaldoActual, CueLimiteCredito, CuePuedeNegativo, CueCicloActivo,
                 CueActiva, CueFechaAlta, CueUsuarioAlta, CueNombre, CueEsPrincipal, CueRestringida, CueAutoConsumo, CueModalidadFiscal)
              OUTPUT INSERTED.CueIdCuenta
              VALUES (@Cli, @Tipo, NULL, @Mon, 1, 0, 0, 0, 0, 1, GETDATE(), @Usr, @Nombre, 0, 1, 1, 'PREPAGO_FACTURADO')`);
    const cueId = ins.recordset[0].CueIdCuenta;
    const nArt = await materializarAlcance(tx, cueId, b.reglas);

    // 2) vencimiento
    let vence = null;
    if (b.vigenciaHasta) vence = b.vigenciaHasta;
    else if (b.vigenciaDias) { const dt = new Date(); dt.setDate(dt.getDate() + b.vigenciaDias); vence = dt.toISOString().slice(0, 10); }

    // 3) la activación (antes de la carga para poder marcar el movimiento)
    const insB = await req()
      .input('Ben', sql.Int, benId).input('Cli', sql.Int, cliId).input('Cue', sql.Int, cueId).input('Doc', sql.Int, docId)
      .input('Imp', sql.Decimal(18, 2), imp).input('Vence', sql.Date, vence).input('Ori', sql.VarChar(20), origen).input('Usr', sql.Int, usuarioId)
      .query(`INSERT INTO dbo.BeneficiosCliente (BenIdBeneficio, CliIdCliente, CueIdCuenta, DocIdDocumento, BclImporteCarga, BclFechaVencimiento, BclEstado, BclOrigen, BclUsuarioAlta)
              OUTPUT INSERTED.BclIdBeneficioCliente VALUES (@Ben, @Cli, @Cue, @Doc, @Imp, @Vence, 'ACTIVO', @Ori, @Usr)`);
    const bclId = insB.recordset[0].BclIdBeneficioCliente;

    // 4) la carga facturada (mismo movimiento que "Venta de saldo")
    const contabilidadService = require('./contabilidadService');
    const refDoc = `${String(doc.DocSerie || '').trim()}-${doc.DocNumero}`;
    await contabilidadService.registrarMovimiento({
      CueIdCuenta: cueId, MovTipo: 'CARGA_PREPAGO',
      MovConcepto: `Venta de saldo ${refDoc} — Beneficio «${b.nombre}»`.slice(0, 500),
      MovImporte: imp, MovUsuarioAlta: usuarioId, DocIdDocumento: docId, MovRefExterna: `VS-${docId}`,
      MovObservaciones: `BENEFICIO_${bclId} activado desde ${origen}${txId ? ` (Tx: ${txId})` : ''}`.slice(0, 500),
    }, tx);

    // 5) el pacto queda ACTIVADO (las plantillas siguen PUBLICADAS)
    if (b.tipo === 'PACTO') await req().input('Id', sql.Int, benId).query("UPDATE dbo.Beneficios SET BenEstado = 'ACTIVADO', BenFechaModif = GETDATE() WHERE BenIdBeneficio = @Id");

    if (own) await tx.commit();
    logger.info(`[BENEFICIOS] ✅ Beneficio #${benId} "${b.nombre}" ACTIVADO para cliente ${cliId}: bolsa #${cueId} "${nombreCta}" +${imp} (${mon === 2 ? 'US$' : '$'}) con ${refDoc}, ${nArt} artículo(s) en alcance, vence ${vence || 'al agotarse'} (${origen})`);
    return { bclId, cueId, vence, nombreCuenta: nombreCta, refDoc, importe: imp };
  } catch (e) {
    if (own) await tx.rollback().catch(() => {});
    throw e;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. PAUSA, REANUDACIÓN Y CIERRE (Administración)
// ═════════════════════════════════════════════════════════════════════════════

async function pausarReanudar(pool, bclId, accion, user) {
  if (!(await puedeAprobar(pool, user))) throw new BeneficioError('Solo Administración puede pausar o reanudar un beneficio.', 403);
  const bc = (await pool.request().input('B', sql.Int, bclId).query('SELECT BclEstado, CueIdCuenta FROM dbo.BeneficiosCliente WHERE BclIdBeneficioCliente = @B')).recordset[0];
  if (!bc) throw new BeneficioError('Beneficio activado inexistente.', 404);
  if (accion === 'pausar') {
    if (bc.BclEstado !== 'ACTIVO') throw new BeneficioError(`Solo se pausa un beneficio ACTIVO (está ${bc.BclEstado}).`);
    await pool.request().input('B', sql.Int, bclId).input('C', sql.Int, bc.CueIdCuenta).input('U', sql.Int, user.id).query(`
      UPDATE dbo.BeneficiosCliente SET BclEstado = 'PAUSADO', BclPausadoPor = @U, BclFechaPausa = GETDATE() WHERE BclIdBeneficioCliente = @B;
      UPDATE dbo.CuentasCliente SET CueAutoConsumo = 0 WHERE CueIdCuenta = @C;`);
    return 'PAUSADO';
  }
  if (accion === 'reanudar') {
    if (bc.BclEstado !== 'PAUSADO') throw new BeneficioError(`Solo se reanuda un beneficio en PAUSA (está ${bc.BclEstado}).`);
    await pool.request().input('B', sql.Int, bclId).input('C', sql.Int, bc.CueIdCuenta).query(`
      UPDATE dbo.BeneficiosCliente SET BclEstado = 'ACTIVO', BclPausadoPor = NULL, BclFechaPausa = NULL WHERE BclIdBeneficioCliente = @B;
      UPDATE dbo.CuentasCliente SET CueAutoConsumo = 1, CueActiva = 1 WHERE CueIdCuenta = @C;`);
    // por si se agotó o venció mientras estaba en pausa
    return refrescarEstadoBolsa(pool, bclId);
  }
  throw new BeneficioError(`Acción desconocida: ${accion}`);
}

/** Billetera común PREPAGO del cliente en la moneda (la crea si no existe), para el cierre. */
async function billeteraComun(pool, cliId, mon, usuarioId) {
  const r = await pool.request().input('Cli', sql.Int, cliId).input('T', sql.VarChar(20), mon === 2 ? 'DINERO_USD' : 'DINERO_UYU').query(`
    SELECT TOP 1 cc.CueIdCuenta, cc.CueNombre FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @Cli AND cc.CueTipo = @T AND cc.CueActiva = 1 AND cc.CueEsPrincipal = 0 AND cc.CueRestringida = 0
      AND ISNULL(cc.CueModalidadFiscal,'') = 'PREPAGO_FACTURADO'
      AND NOT EXISTS (SELECT 1 FROM dbo.BeneficiosCliente bx WHERE bx.CueIdCuenta = cc.CueIdCuenta)
    ORDER BY CASE WHEN cc.CueNombre LIKE 'BILLETERA%' THEN 0 ELSE 1 END, cc.CueIdCuenta`);
  if (r.recordset[0]) return r.recordset[0];
  const nombre = mon === 2 ? 'BILLETERA USD' : 'BILLETERA UY';
  const ins = await pool.request().input('Cli', sql.Int, cliId).input('T', sql.VarChar(20), mon === 2 ? 'DINERO_USD' : 'DINERO_UYU').input('Mon', sql.Int, mon)
    .input('N', sql.NVarChar(100), nombre).input('U', sql.Int, usuarioId).query(`
    INSERT INTO dbo.CuentasCliente (CliIdCliente, CueTipo, ProIdProducto, MonIdMoneda, CPaIdCondicion, CueSaldoActual, CueLimiteCredito, CuePuedeNegativo, CueCicloActivo,
      CueActiva, CueFechaAlta, CueUsuarioAlta, CueNombre, CueEsPrincipal, CueRestringida, CueAutoConsumo, CueModalidadFiscal)
    OUTPUT INSERTED.CueIdCuenta VALUES (@Cli, @T, NULL, @Mon, 1, 0, 0, 0, 0, 1, GETDATE(), @U, @N, 0, 0, 1, 'PREPAGO_FACTURADO')`);
  return { CueIdCuenta: ins.recordset[0].CueIdCuenta, CueNombre: nombre };
}

/** Cierra la bolsa: el saldo remanente pasa por transferencia a la billetera común; nunca sirve para activar otro beneficio. */
async function cerrarBolsa(pool, bclId, user) {
  if (!(await puedeAprobar(pool, user))) throw new BeneficioError('Solo Administración puede cerrar un beneficio.', 403);
  const bc = (await pool.request().input('B', sql.Int, bclId).query(`
    SELECT bc.BclEstado, bc.CueIdCuenta, bc.CliIdCliente, cc.MonIdMoneda, cc.CueNombre, b.BenNombre
    FROM dbo.BeneficiosCliente bc JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = bc.CueIdCuenta JOIN dbo.Beneficios b ON b.BenIdBeneficio = bc.BenIdBeneficio
    WHERE bc.BclIdBeneficioCliente = @B`)).recordset[0];
  if (!bc) throw new BeneficioError('Beneficio activado inexistente.', 404);
  if (bc.BclEstado === 'CERRADO') throw new BeneficioError('El beneficio ya está cerrado.');
  const mon = Number(bc.MonIdMoneda) === 2 ? 2 : 1;
  const saldo = await saldoRealCuenta(pool, bc.CueIdCuenta);
  let movId = null, destino = null;
  if (saldo > 0.009) {
    destino = await billeteraComun(pool, bc.CliIdCliente, mon, user.id);
    const contabilidadService = require('./contabilidadService');
    const trf = await contabilidadService.transferirEntreCuentas({
      CueOrigen: bc.CueIdCuenta, CueDestino: destino.CueIdCuenta, Importe: r2(saldo), UsuarioAlta: user.id,
      Observaciones: `Cierre del beneficio «${String(bc.BenNombre).trim()}» (#${bclId}): el saldo remanente pasa a la billetera común`,
      ConceptoOrigen: `Cierre beneficio → ${destino.CueNombre}`, ConceptoDestino: `Saldo remanente del beneficio «${String(bc.BenNombre).trim()}»`,
      cierreBeneficio: true,
    });
    movId = trf?.MovIdSalida || trf?.movSalida || null;
  } else if (saldo < -0.009) {
    throw new BeneficioError(`La bolsa está en negativo (${saldo.toFixed(2)}): regularizala antes de cerrar.`);
  }
  await pool.request().input('B', sql.Int, bclId).input('C', sql.Int, bc.CueIdCuenta).input('U', sql.Int, user.id).input('M', sql.Int, movId).query(`
    UPDATE dbo.BeneficiosCliente SET BclEstado = 'CERRADO', BclCerradoPor = @U, BclFechaCierre = GETDATE(), MovIdTransferenciaCierre = @M WHERE BclIdBeneficioCliente = @B;
    UPDATE dbo.CuentasCliente SET CueActiva = 0, CueAutoConsumo = 0 WHERE CueIdCuenta = @C;`);
  logger.info(`[BENEFICIOS] Bolsa #${bclId} CERRADA por usuario ${user.id}: ${saldo > 0.009 ? `${saldo.toFixed(2)} transferidos a "${destino.CueNombre}" (#${destino.CueIdCuenta})` : 'sin saldo'}`);
  return { estado: 'CERRADO', transferido: saldo > 0.009 ? r2(saldo) : 0, destino };
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. VISTA DEL CLIENTE (pestaña del 360 de vendedores y portal)
// ═════════════════════════════════════════════════════════════════════════════

async function vistaCliente(pool, cliId, { paraPortal = false } = {}) {
  const activos = await bolsasDelCliente(pool, cliId);
  for (const b of activos) {
    b.reglas = await reglasDePerfil(pool, b.PerfilID); b.reglasTexto = b.reglas.map(textoRegla);
    // "te quedan ≈ N unidades": con la primera regla de precio fijo del beneficio
    const fija = b.reglas.find(r => r.tipo === 'fixed' && r.valor > 0);
    b.aproxUnidades = fija ? Math.floor(b.Saldo / fija.valor) : null;
  }
  const pactos = paraPortal ? [] : await listarPactos(pool, { cliId, incluirPlantillas: false });
  const disponibles = await disponiblesParaCliente(pool, cliId, { incluirNoPublicas: !paraPortal });
  for (const d of disponibles) {
    try { d.evaluacion = await evaluarReglas(pool, { cliId, reglas: d.reglas.map(reglaAFila), monedaId: d.monedaId }); }
    catch (e) { logger.warn(`[BENEFICIOS] evaluación de "${d.nombre}" para cliente ${cliId}: ${e.message}`); d.evaluacion = null; }
  }
  return { activos, pactos, disponibles };
}

// regla (formato formulario) → fila estilo PerfilesItems, para reutilizar evaluarReglas
function reglaAFila(rg) {
  return {
    ProIdProducto: rg.proIdProducto || null,
    CodArticulo: rg.alcance === 'ARTICULO' ? (rg.codArticulo || String(rg.proIdProducto || '')) : 'TOTAL',
    CodGrupo: rg.alcance === 'GRUPO' ? rg.codGrupo : rg.alcance === 'AREA' ? `AREA:${rg.areaId}` : null,
    TipoRegla: rg.tipo === 'percentage' ? 'percentage_discount' : rg.tipo === 'subtract' ? 'subtract' : 'fixed_price',
    Valor: rg.valor, MonIdMoneda: rg.monedaId, Moneda: rg.monedaId === 2 ? 'USD' : 'UYU', CantidadMinima: rg.cantidadMinima || 1,
  };
}

module.exports = {
  BeneficioError, puedeAprobar, esRolAprobador, normalizaRol, ROLES_APRUEBAN,
  listarAprobadoresAutorizados, candidatosAprobador, agregarAprobador, quitarAprobador,
  normalizarReglas, reglasDePerfil, textoRegla, reglaAFila, rangoAlcance, resolverArticulo,
  bolsasDelCliente, beneficioParaPrecio, bolsaDeOrden, bolsaPorCuenta, refrescarEstadoBolsa, saldoRealCuenta,
  evaluarReglas, precioMotor,
  obtenerBeneficio, listarPlantillas, crearPlantilla, editarPlantilla, cambiarEstadoPlantilla,
  proponerPacto, editarPacto, listarPactos, resumenPactos, decidirPacto,
  disponiblesParaCliente, activarBeneficio, pausarReanudar, cerrarBolsa, billeteraComun, vistaCliente,
};
