'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// VENTAS DE SALÓN — reglas (19/10/2026). Tablas: scripts/add_ventas_salon_y_precios_cantidad.sql
// Plan: docs/ventas-salon-y-precios-cantidad.md
//
// Los vendedores de salón cargan a mano las ventas de promos que hacen: fecha, vendedor (usuario
// del sistema), cliente o consumidor final, moneda, monto y observaciones. Con eso se arma la
// pantalla de comisiones, como Ventas por vendedor: total unificado en US$ del mes y franjas.
//
// Quién puede qué (por las entradas del menú del rol, Admin siempre):
//   · '/vendedores/salon'             → carga y ve SUS ventas. Las corrige o anula mientras la venta
//                                       sea del mes en curso (un mes cerrado ya se comisionó).
//   · '/vendedores/salon-comisiones'  → "supervisor": ve y carga las de todos, corrige o anula
//                                       cualquiera, y ve el resumen y los ganadores.
//   · Franjas de comisión             → solo Admin las cambia.
// ─────────────────────────────────────────────────────────────────────────────
const { sql } = require('../config/db');

const RUTA_REGISTRO = '/vendedores/salon';
const RUTA_COMISIONES = '/vendedores/salon-comisiones';
const SQL_SCRIPT = 'scripts/add_ventas_salon_y_precios_cantidad.sql';
// Fichas genéricas de mostrador (como contabilidadReportesController.CLIENTES_GENERICOS): elegirlas
// es lo mismo que «consumidor final».
const CLIENTES_GENERICOS = [2089, 8741];
const MONEDA_ID = { UYU: 1, USD: 2 };
const MONEDA_COD = { 1: 'UYU', 2: 'USD' };
const MONTO_MAXIMO = 10000000;

const conStatus = (status, mensaje) => { const e = new Error(mensaje); e.status = status; return e; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const esAdmin = (u) => Number(u?.idRol) === 1 || String(u?.role || '').trim().toLowerCase() === 'admin';
const pad = (n) => String(n).padStart(2, '0');
const hoyTexto = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const mesDe = (fecha) => String(fecha).slice(0, 7);   // 'AAAA-MM'
const finDeMes = (anio, mes) => `${anio}-${pad(mes)}-${pad(new Date(anio, mes, 0).getDate())}`;

// Las tablas las crea el script SQL. Una vez que existen no se vuelve a mirar.
let hayTablas = false;
const exigirTablas = async (pool) => {
  if (hayTablas) return;
  const r = await pool.request().query("SELECT OBJECT_ID('dbo.VentasSalon') AS V, OBJECT_ID('dbo.VentasSalonFranjas') AS F");
  if (r.recordset[0].V == null || r.recordset[0].F == null) throw conStatus(503, `Faltan las tablas de Ventas de salón: hay que correr ${SQL_SCRIPT}.`);
  hayTablas = true;
};

// Qué puede el usuario, por las entradas del menú de su rol ACTUAL (Usuarios → PermisosRoles →
// Modulos, como arma el menú menuController.getByUser). Por Ruta: los IdModulo de local y
// producción no coinciden.
const contexto = async (pool, user) => {
  await exigirTablas(pool);
  const idUsuario = Number(user?.id);
  if (!Number.isInteger(idUsuario) || user?.userType !== 'INTERNAL') throw conStatus(403, 'Esta pantalla es del sistema interno.');
  let registro = esAdmin(user);
  let supervisor = esAdmin(user);
  if (!supervisor) {
    const r = await pool.request()
      .input('UID', sql.Int, idUsuario)
      .input('R1', sql.NVarChar(200), RUTA_REGISTRO)
      .input('R2', sql.NVarChar(200), RUTA_COMISIONES)
      .query(`SELECT DISTINCT LTRIM(RTRIM(m.Ruta)) AS Ruta
              FROM dbo.Usuarios us
              JOIN dbo.PermisosRoles pr ON pr.IdRol = us.IdRol
              JOIN dbo.Modulos m ON m.IdModulo = pr.IdModulo
              WHERE us.IdUsuario = @UID AND LTRIM(RTRIM(m.Ruta)) IN (@R1, @R2)`);
    const rutas = new Set(r.recordset.map(x => x.Ruta));
    supervisor = rutas.has(RUTA_COMISIONES);
    registro = supervisor || rutas.has(RUTA_REGISTRO);
  }
  // 403 y no 401: el 401 hace que el front cierre la sesión (apiClient.js).
  if (!registro) throw conStatus(403, 'Tu rol no tiene acceso a Ventas de salón.');
  return { idUsuario, supervisor, editaFranjas: esAdmin(user) };
};

const exigirSupervisor = (ctx) => {
  if (!ctx.supervisor) throw conStatus(403, 'Solo quien tiene «Comisiones de salón» en su menú puede ver esto.');
};

// ── Lectura ──────────────────────────────────────────────────────────────────
const COLUMNAS_VENTA = `
  v.VsaIdVenta, CONVERT(VARCHAR(10), v.VsaFecha, 23) AS Fecha, v.VsaIdUsuario,
  LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(uv.Nombre)), ''), uv.Usuario))) AS Vendedor,
  v.VsaConsumidorFinal, v.CliIdCliente, c.CodCliente, LTRIM(RTRIM(c.IDCliente)) AS CodigoCliente,
  LTRIM(RTRIM(c.Nombre)) AS Cliente, v.MonIdMoneda, v.VsaMonto, v.VsaObservaciones,
  v.VsaAnulada, v.VsaMotivoAnulacion, CONVERT(VARCHAR(19), v.VsaFechaAnulacion, 126) AS FechaAnulacion,
  LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(ua.Nombre)), ''), ua.Usuario))) AS UsuarioAnulacion,
  LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(ul.Nombre)), ''), ul.Usuario))) AS UsuarioAlta,
  CONVERT(VARCHAR(19), v.VsaFechaAlta, 126) AS FechaAlta`;
const JOINS_VENTA = `
  FROM dbo.VentasSalon v
  LEFT JOIN dbo.Usuarios uv ON uv.IdUsuario = v.VsaIdUsuario
  LEFT JOIN dbo.Usuarios ul ON ul.IdUsuario = v.VsaUsuarioAlta
  LEFT JOIN dbo.Usuarios ua ON ua.IdUsuario = v.VsaUsuarioAnulacion
  LEFT JOIN dbo.Clientes c  ON c.CliIdCliente = v.CliIdCliente`;

// Se puede corregir o anular: el supervisor siempre; el vendedor, la suya y del mes en curso
const puedeTocar = (ctx, fila) => !fila.VsaAnulada
  && (ctx.supervisor || (fila.VsaIdUsuario === ctx.idUsuario && mesDe(fila.Fecha) === mesDe(hoyTexto())));

const aVenta = (ctx) => (f) => ({
  id: f.VsaIdVenta,
  fecha: f.Fecha,
  idUsuario: f.VsaIdUsuario,
  vendedor: f.Vendedor || `Usuario ${f.VsaIdUsuario}`,
  consumidorFinal: !!f.VsaConsumidorFinal,
  cliIdCliente: f.CliIdCliente,
  codCliente: f.CodCliente,
  codigoCliente: f.CodigoCliente || null,
  cliente: f.VsaConsumidorFinal ? 'Consumidor final' : (f.Cliente || `Cliente ${f.CliIdCliente}`),
  moneda: MONEDA_COD[f.MonIdMoneda],
  monto: Number(f.VsaMonto),
  observaciones: f.VsaObservaciones || '',
  anulada: !!f.VsaAnulada,
  motivoAnulacion: f.VsaMotivoAnulacion || null,
  fechaAnulacion: f.FechaAnulacion || null,
  usuarioAnulacion: f.UsuarioAnulacion || null,
  usuarioAlta: f.UsuarioAlta || null,
  fechaAlta: f.FechaAlta,
  editable: puedeTocar(ctx, f),
});

const leerVenta = async (pool, id) => {
  const r = await pool.request().input('Id', sql.Int, id).query(`SELECT ${COLUMNAS_VENTA} ${JOINS_VENTA} WHERE v.VsaIdVenta = @Id`);
  if (r.recordset.length === 0) throw conStatus(404, `No existe la venta ${id}.`);
  return r.recordset[0];
};

const leerMes = (q) => {
  const hoy = new Date();
  const anio = parseInt(q.anio, 10) || hoy.getFullYear();
  const mes = parseInt(q.mes, 10) || hoy.getMonth() + 1;
  if (mes < 1 || mes > 12 || anio < 2000 || anio > 2100) throw conStatus(400, 'Mes inválido.');
  return { anio, mes, desde: `${anio}-${pad(mes)}-01`, hasta: finDeMes(anio, mes) };
};

async function miPerfil(pool, user) {
  const ctx = await contexto(pool, user);
  return { idUsuario: ctx.idUsuario, supervisor: ctx.supervisor, editaFranjas: ctx.editaFranjas };
}

// Ventas de un mes. El vendedor ve solo las suyas; el supervisor, todas o las de ?idUsuario.
async function listar(pool, user, q) {
  const ctx = await contexto(pool, user);
  const { desde, hasta } = leerMes(q);
  const filtroUsuario = ctx.supervisor ? (parseInt(q.idUsuario, 10) || null) : ctx.idUsuario;
  const req = pool.request().input('Desde', sql.Date, desde).input('Hasta', sql.Date, hasta);
  if (filtroUsuario) req.input('UID', sql.Int, filtroUsuario);
  const r = await req.query(`SELECT ${COLUMNAS_VENTA} ${JOINS_VENTA}
    WHERE v.VsaFecha BETWEEN @Desde AND @Hasta ${filtroUsuario ? 'AND v.VsaIdUsuario = @UID' : ''}
    ORDER BY v.VsaFecha DESC, v.VsaIdVenta DESC`);
  return r.recordset.map(aVenta(ctx));
}

// Para el selector de vendedor del supervisor: los usuarios activos cuyo rol tiene «Ventas de salón»
async function listarVendedores(pool, user) {
  const ctx = await contexto(pool, user);
  exigirSupervisor(ctx);
  const r = await pool.request().input('Ruta', sql.NVarChar(200), RUTA_REGISTRO).query(`
    SELECT DISTINCT us.IdUsuario, LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(us.Nombre)), ''), us.Usuario))) AS Nombre
    FROM dbo.Usuarios us
    JOIN dbo.PermisosRoles pr ON pr.IdRol = us.IdRol
    JOIN dbo.Modulos m ON m.IdModulo = pr.IdModulo
    WHERE us.Activo = 1 AND LTRIM(RTRIM(m.Ruta)) = @Ruta
    ORDER BY Nombre`);
  return r.recordset.map(x => ({ idUsuario: x.IdUsuario, nombre: x.Nombre }));
}

// ── Alta, corrección y anulación ─────────────────────────────────────────────
// Valida y normaliza lo que manda la pantalla. Devuelve los valores listos para guardar.
const validar = async (pool, ctx, body) => {
  const fecha = String(body.fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) throw conStatus(400, 'La fecha no es válida.');
  const hoy = hoyTexto();
  if (fecha > hoy) throw conStatus(400, 'La fecha no puede ser posterior a hoy.');
  if (!ctx.supervisor && mesDe(fecha) !== mesDe(hoy)) throw conStatus(400, 'Solo se pueden cargar ventas del mes en curso.');

  let idUsuario = ctx.idUsuario;
  if (ctx.supervisor && body.idUsuario != null && body.idUsuario !== '') {
    idUsuario = parseInt(body.idUsuario, 10);
    const u = await pool.request().input('UID', sql.Int, idUsuario).query('SELECT 1 AS Si FROM dbo.Usuarios WHERE IdUsuario = @UID AND Activo = 1');
    if (!Number.isInteger(idUsuario) || u.recordset.length === 0) throw conStatus(400, 'El vendedor elegido no es un usuario activo.');
  }

  let consumidorFinal = body.consumidorFinal === true || body.consumidorFinal === 1 || body.consumidorFinal === '1';
  let cliIdCliente = null;
  if (!consumidorFinal) {
    cliIdCliente = parseInt(body.cliIdCliente, 10);
    if (!Number.isInteger(cliIdCliente) || cliIdCliente <= 0) throw conStatus(400, 'Elegí el cliente o marcá «Consumidor final».');
    if (CLIENTES_GENERICOS.includes(cliIdCliente)) { consumidorFinal = true; cliIdCliente = null; }
    else {
      const c = await pool.request().input('Cli', sql.Int, cliIdCliente).query('SELECT 1 AS Si FROM dbo.Clientes WHERE CliIdCliente = @Cli');
      if (c.recordset.length === 0) throw conStatus(400, `No existe el cliente ${cliIdCliente}.`);
    }
  }

  const monIdMoneda = MONEDA_ID[String(body.moneda || '').toUpperCase()] || (Number(body.moneda) === 1 || Number(body.moneda) === 2 ? Number(body.moneda) : null);
  if (!monIdMoneda) throw conStatus(400, 'Elegí la moneda ($ o US$).');

  const monto = Number(String(body.monto ?? '').replace(',', '.'));
  if (!(monto > 0)) throw conStatus(400, 'El monto tiene que ser mayor que cero.');
  if (monto >= MONTO_MAXIMO) throw conStatus(400, 'El monto es demasiado grande: revisalo.');
  if (Math.abs(r2(monto) - monto) > 1e-9) throw conStatus(400, 'El monto puede tener hasta 2 decimales.');

  const observaciones = String(body.observaciones ?? '').trim();
  if (observaciones.length > 500) throw conStatus(400, 'Las observaciones pueden tener hasta 500 letras.');

  return { fecha, idUsuario, consumidorFinal, cliIdCliente, monIdMoneda, monto: r2(monto), observaciones: observaciones || null };
};

const conValores = (req, v) => req
  .input('Fecha', sql.Date, v.fecha)
  .input('UID', sql.Int, v.idUsuario)
  .input('CF', sql.Bit, v.consumidorFinal ? 1 : 0)
  .input('Cli', sql.Int, v.cliIdCliente)
  .input('Mon', sql.Int, v.monIdMoneda)
  .input('Monto', sql.Decimal(18, 2), v.monto)
  .input('Obs', sql.NVarChar(500), v.observaciones);

async function crear(pool, user, body) {
  const ctx = await contexto(pool, user);
  const v = await validar(pool, ctx, body);
  const r = await conValores(pool.request(), v)
    .input('Alta', sql.Int, ctx.idUsuario)
    .query(`INSERT INTO dbo.VentasSalon (VsaFecha, VsaIdUsuario, VsaConsumidorFinal, CliIdCliente, MonIdMoneda, VsaMonto, VsaObservaciones, VsaUsuarioAlta)
            OUTPUT INSERTED.VsaIdVenta
            VALUES (@Fecha, @UID, @CF, @Cli, @Mon, @Monto, @Obs, @Alta)`);
  return aVenta(ctx)(await leerVenta(pool, r.recordset[0].VsaIdVenta));
}

async function actualizar(pool, user, id, body) {
  const ctx = await contexto(pool, user);
  const actual = await leerVenta(pool, id);
  if (!puedeTocar(ctx, actual)) {
    throw conStatus(403, actual.VsaAnulada ? 'La venta está anulada.' : 'Solo podés corregir tus ventas del mes en curso.');
  }
  // El vendedor no se cambia a sí mismo de vendedor: queda el de la venta
  const v = await validar(pool, ctx, { ...body, idUsuario: ctx.supervisor ? (body.idUsuario ?? actual.VsaIdUsuario) : undefined });
  if (!ctx.supervisor) v.idUsuario = actual.VsaIdUsuario;
  // Condicional: si otro la anuló mientras tanto, no se pisa
  const r = await conValores(pool.request(), v)
    .input('Id', sql.Int, id)
    .input('Modif', sql.Int, ctx.idUsuario)
    .query(`UPDATE dbo.VentasSalon
            SET VsaFecha = @Fecha, VsaIdUsuario = @UID, VsaConsumidorFinal = @CF, CliIdCliente = @Cli, MonIdMoneda = @Mon,
                VsaMonto = @Monto, VsaObservaciones = @Obs, VsaUsuarioModif = @Modif, VsaFechaModif = GETDATE()
            WHERE VsaIdVenta = @Id AND VsaAnulada = 0`);
  if (r.rowsAffected[0] === 0) throw conStatus(409, 'La venta se anuló mientras la estabas corrigiendo.');
  return aVenta(ctx)(await leerVenta(pool, id));
}

async function anular(pool, user, id, body) {
  const ctx = await contexto(pool, user);
  const actual = await leerVenta(pool, id);
  if (!puedeTocar(ctx, actual)) {
    throw conStatus(403, actual.VsaAnulada ? 'La venta ya está anulada.' : 'Solo podés anular tus ventas del mes en curso.');
  }
  const motivo = String(body.motivo || '').trim();
  if (motivo.length < 3) throw conStatus(400, 'Escribí por qué se anula.');
  if (motivo.length > 300) throw conStatus(400, 'El motivo puede tener hasta 300 letras.');
  const r = await pool.request()
    .input('Id', sql.Int, id)
    .input('Motivo', sql.NVarChar(300), motivo)
    .input('UID', sql.Int, ctx.idUsuario)
    .query(`UPDATE dbo.VentasSalon
            SET VsaAnulada = 1, VsaMotivoAnulacion = @Motivo, VsaUsuarioAnulacion = @UID, VsaFechaAnulacion = GETDATE()
            WHERE VsaIdVenta = @Id AND VsaAnulada = 0`);
  if (r.rowsAffected[0] === 0) throw conStatus(409, 'La venta ya estaba anulada.');
  return aVenta(ctx)(await leerVenta(pool, id));
}

// ── Comisiones ───────────────────────────────────────────────────────────────
async function franjas(pool, user) {
  await contexto(pool, user);
  const r = await pool.request().query('SELECT VsfDesde, VsfPct FROM dbo.VentasSalonFranjas ORDER BY VsfDesde');
  return r.recordset.map(f => ({ desde: Number(f.VsfDesde), pct: Number(f.VsfPct) }));
}

// Reemplaza todas las franjas (la pantalla manda la lista completa). Solo Admin.
async function guardarFranjas(pool, user, body) {
  const ctx = await contexto(pool, user);
  if (!ctx.editaFranjas) throw conStatus(403, 'Solo un administrador puede cambiar las franjas de comisión.');
  const lista = Array.isArray(body.franjas) ? body.franjas : null;
  if (!lista) throw conStatus(400, 'Falta la lista de franjas.');
  const limpias = lista.map(f => ({ desde: r2(f.desde), pct: Math.round(Number(f.pct) * 10000) / 10000 }));
  limpias.forEach(f => {
    if (!(f.desde >= 0)) throw conStatus(400, 'Cada franja necesita el monto «desde» (cero o más).');
    if (!(f.pct > 0 && f.pct <= 100)) throw conStatus(400, 'El % de cada franja tiene que estar entre 0 y 100.');
  });
  if (new Set(limpias.map(f => f.desde)).size !== limpias.length) throw conStatus(400, 'Hay dos franjas con el mismo monto «desde».');
  limpias.sort((a, b) => a.desde - b.desde);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).query('DELETE FROM dbo.VentasSalonFranjas');
    for (const f of limpias) {
      await new sql.Request(tx)
        .input('Desde', sql.Decimal(18, 2), f.desde)
        .input('Pct', sql.Decimal(9, 4), f.pct)
        .input('UID', sql.Int, ctx.idUsuario)
        .query('INSERT INTO dbo.VentasSalonFranjas (VsfDesde, VsfPct, VsfUsuarioAlta) VALUES (@Desde, @Pct, @UID)');
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return franjas(pool, user);
}

// Lo vendido en el mes por vendedor y moneda (sin las anuladas). Solo supervisor.
async function resumen(pool, user, q) {
  const ctx = await contexto(pool, user);
  exigirSupervisor(ctx);
  const { desde, hasta } = leerMes(q);
  const r = await pool.request().input('Desde', sql.Date, desde).input('Hasta', sql.Date, hasta).query(`
    SELECT v.VsaIdUsuario, MAX(LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(u.Nombre)), ''), u.Usuario)))) AS Nombre,
           MAX(CAST(u.Cedula AS NVARCHAR(50))) AS Cedula, v.MonIdMoneda, SUM(v.VsaMonto) AS Vendido, COUNT(*) AS Ventas
    FROM dbo.VentasSalon v
    LEFT JOIN dbo.Usuarios u ON u.IdUsuario = v.VsaIdUsuario
    WHERE v.VsaAnulada = 0 AND v.VsaFecha BETWEEN @Desde AND @Hasta
    GROUP BY v.VsaIdUsuario, v.MonIdMoneda`);
  const porVendedor = new Map();
  r.recordset.forEach(f => {
    const v = porVendedor.get(f.VsaIdUsuario) || {
      idUsuario: f.VsaIdUsuario, nombre: f.Nombre || `Usuario ${f.VsaIdUsuario}`,
      cedula: f.Cedula ? String(f.Cedula).trim() : null, esMio: f.VsaIdUsuario === ctx.idUsuario,
      ventas: 0, monedas: { UYU: { vendido: 0 }, USD: { vendido: 0 } },
    };
    v.monedas[MONEDA_COD[f.MonIdMoneda]].vendido = r2(v.monedas[MONEDA_COD[f.MonIdMoneda]].vendido + Number(f.Vendido));
    v.ventas += Number(f.Ventas);
    porVendedor.set(f.VsaIdUsuario, v);
  });
  return [...porVendedor.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// El primero y el segundo de cada mes por total unificado, desde el primer mes con ventas de salón
// hasta el mes en curso. La cotización de cada mes es la última cargada hasta su último día (en el
// mes en curso, la del día): la misma regla que vendedorVistaController.getGanadores.
async function ganadores(pool, user) {
  const ctx = await contexto(pool, user);
  exigirSupervisor(ctx);
  const primera = await pool.request().query('SELECT CONVERT(VARCHAR(10), MIN(VsaFecha), 23) AS Desde FROM dbo.VentasSalon WHERE VsaAnulada = 0');
  const hoy = new Date();
  const inicio = primera.recordset[0].Desde
    ? { anio: Number(primera.recordset[0].Desde.slice(0, 4)), mes: Number(primera.recordset[0].Desde.slice(5, 7)) }
    : { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };
  const meses = [];
  for (let a = inicio.anio, m = inicio.mes; a < hoy.getFullYear() || (a === hoy.getFullYear() && m <= hoy.getMonth() + 1);) {
    meses.push({ anio: a, mes: m });
    if (m === 12) { a += 1; m = 1; } else { m += 1; }
  }
  if (meses.length === 0) return [];

  const ultimo = meses[meses.length - 1];
  const filas = (await pool.request()
    .input('Desde', sql.Date, `${meses[0].anio}-${pad(meses[0].mes)}-01`)
    .input('Hasta', sql.Date, finDeMes(ultimo.anio, ultimo.mes))
    .query(`
      SELECT YEAR(v.VsaFecha) * 100 + MONTH(v.VsaFecha) AS Mes, v.VsaIdUsuario, v.MonIdMoneda, SUM(v.VsaMonto) AS Vendido,
             MAX(LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(u.Nombre)), ''), u.Usuario)))) AS Nombre, MAX(CAST(u.Cedula AS NVARCHAR(50))) AS Cedula
      FROM dbo.VentasSalon v
      LEFT JOIN dbo.Usuarios u ON u.IdUsuario = v.VsaIdUsuario
      WHERE v.VsaAnulada = 0 AND v.VsaFecha BETWEEN @Desde AND @Hasta
      GROUP BY YEAR(v.VsaFecha) * 100 + MONTH(v.VsaFecha), v.VsaIdUsuario, v.MonIdMoneda`)).recordset;

  // Los valores de la lista salen de los meses armados acá, no de nada que mande el usuario
  const lista = meses.map(x => `(${x.anio * 100 + x.mes}, '${finDeMes(x.anio, x.mes)}')`).join(', ');
  const cotRes = await pool.request().query(`
    SELECT v.Mes, c.CotDolar, CONVERT(VARCHAR(10), c.CotFecha, 23) AS CotFecha
    FROM (VALUES ${lista}) v(Mes, Hasta)
    OUTER APPLY (
      SELECT TOP 1 CotDolar, CotFecha
      FROM dbo.Cotizaciones WITH(NOLOCK)
      WHERE CotDolar > 0 AND CotFecha < DATEADD(DAY, 1, CAST(v.Hasta AS date))
      ORDER BY CotFecha DESC
    ) c`);
  const cotizacionDe = new Map(cotRes.recordset.map(c => [Number(c.Mes),
    Number(c.CotDolar) > 0 ? { valor: Number(c.CotDolar), fecha: c.CotFecha } : null]));

  return meses.map(({ anio, mes }) => {
    const clave = anio * 100 + mes;
    const cotizacion = cotizacionDe.get(clave) || null;
    const enCurso = anio === hoy.getFullYear() && mes === hoy.getMonth() + 1;
    const base = { anio, mes, enCurso, cotizacion, ganador: null, segundo: null };
    if (!cotizacion) return base;
    const porVendedor = new Map();
    filas.filter(f => Number(f.Mes) === clave).forEach(f => {
      const p = porVendedor.get(f.VsaIdUsuario) || { nombre: f.Nombre, cedula: f.Cedula ? String(f.Cedula).trim() : null, UYU: 0, USD: 0 };
      p[MONEDA_COD[f.MonIdMoneda]] += Number(f.Vendido) || 0;
      porVendedor.set(f.VsaIdUsuario, p);
    });
    const ranking = [...porVendedor.entries()]
      // clave: con qué compara la pantalla para unir los meses seguidos (en vendedores es la cédula;
      // acá muchos usuarios no la tienen cargada)
      .map(([idUsuario, p]) => ({ idUsuario, clave: `U${idUsuario}`, cedula: p.cedula, nombre: p.nombre || `Usuario ${idUsuario}`, total: r2(r2(p.USD) + r2(p.UYU) / cotizacion.valor) }))
      .filter(x => x.total > 0)
      .sort((x, y) => y.total - x.total);
    return { ...base, ganador: ranking[0] || null, segundo: ranking[1] || null };
  });
}

module.exports = {
  miPerfil, listar, listarVendedores, crear, actualizar, anular,
  franjas, guardarFranjas, resumen, ganadores,
};
