'use strict';
// =====================================================================
// Solicitudes de vendedores — conversión a pedido de producción (spec 41 §9)
// =====================================================================
// La Solicitud NO crea órdenes: arma el pedido en términos de negocio y se lo entrega al
// ingreso de pedidos por sistema (services/pedidosExternos), que lo valida, lo traduce al
// mismo body de /ventas/pedido-prenda y llama al creador de pedidos de siempre.
// Un pedido por producto (RN-SOL.26); convertir dos veces el mismo producto es imposible:
// la clave es SOL-{SolicitudID}-P{ProductoSolID}.
//
// También vive acá lo que la conversión necesita y la Solicitud no tenía: el material (tela)
// y las copias de CADA archivo de diseño pronto de la producción principal. Los carga el
// diseñador. El archivo es siempre normal: sin escala ni raport.
// =====================================================================
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { materialesDe, materialesDeArea, buscarMaterial, bobinasDe } = require('./pedidosExternos/catalogo');
const { VARIANTE_SUBLIMACION, VARIANTE_DTF, errorMedidaDtf } = require('./pedidosExternos/validador');
const procesador = require('./pedidosExternos/procesador');

const ORIGEN = 'SOLICITUD_VENDEDOR';
const idExternoDe = (solicitudId, productoSolId) => `SOL-${solicitudId}-P${productoSolId}`;
const fallo = (status, mensaje) => { const e = new Error(mensaje); e.status = status; return e; };
const MONEDA = { 1: 'UYU', 2: 'USD' };

// Telas de sublimación que puede elegir el diseñador: el mismo catálogo de /ventas/pedido-prenda.
// (CodArticulo / Descripcion son columnas de ancho fijo: llegan con espacios al final, se limpian acá.)
const materialesPrincipal = async (pool, areaId) => {
  // F1: la producción principal puede ser otra área (Impresión Directa, gran formato…): sus materiales
  // son todos los del área, sin variante fija. Sublimación sigue con su catálogo de siempre.
  const area = String(areaId || 'SB').trim().toUpperCase();
  const lista = area === 'SB' ? await materialesDe(pool, 'SB', VARIANTE_SUBLIMACION) : await materialesDeArea(pool, area);
  return lista.map(m => ({ ...m, CodArticulo: String(m.CodArticulo ?? '').trim(), CodStock: String(m.CodStock ?? '').trim(), Material: String(m.Material ?? '').trim() }));
};
// Servicio principal (id de services.js / SERVICE_TO_AREA_MAP) por área de producción
const SERVICIO_DE_AREA = { SB: 'sublimacion', DIRECTA: 'directa_320', ECOUV: 'ecouv', DF: 'dtf' };
// Área de la producción principal de un producto de la solicitud (ProductoVentaConfig.TecnicaPrincipal; SB si no hay)
async function areaPrincipalDeProducto(pool, productoSolId) {
  const r = await pool.request().input('P', sql.Int, productoSolId).query(`
    SELECT CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicaPrincipal') IS NULL THEN NULL
                ELSE (SELECT vc.TecnicaPrincipal FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS Area
    FROM dbo.SolicitudesVendedorProductos p WHERE p.ProductoSolID = @P`);
  return String(r.recordset[0]?.Area || 'SB').trim().toUpperCase();
}
// Medida fija del producto del catálogo (AnchoM × AltoM) cuando NO tiene molde de TizadaPro; null si no aplica
async function medidaFijaDeProducto(pool, productoSolId) {
  const r = await pool.request().input('P', sql.Int, productoSolId).query(`
    SELECT CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'AnchoM') IS NULL THEN NULL ELSE (SELECT vc.AnchoM FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS AnchoM,
           CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'AltoM') IS NULL THEN NULL ELSE (SELECT vc.AltoM FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS AltoM,
           CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL THEN NULL ELSE (SELECT vc.TizadaProMoldeRef FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = p.ProIdProducto) END AS MoldeRef
           , p.Cantidad
    FROM dbo.SolicitudesVendedorProductos p WHERE p.ProductoSolID = @P AND p.TipoFabricacion = 'PRODUCTO_TERMINADO'`);
  const x = r.recordset[0];
  if (!x || x.MoldeRef || !(Number(x.AnchoM) > 0 && Number(x.AltoM) > 0)) return null;
  return { anchoM: Number(x.AnchoM), altoM: Number(x.AltoM), cantidad: parseInt(x.Cantidad, 10) || 0 };
}
// ¿El archivo mide lo que el producto exige? Tolerancia 2 cm, se admite girado. Devuelve el mensaje de error o null.
function errorMedidaFija(nombre, anchoM, altoM, mf) {
  if (!mf) return null;
  const cm = (v) => Math.round(Number(v) * 100);
  const ok = (a, b) => Math.abs(cm(a) - cm(b)) <= 2;
  if ((ok(anchoM, mf.anchoM) && ok(altoM, mf.altoM)) || (ok(anchoM, mf.altoM) && ok(altoM, mf.anchoM))) return null;
  return `"${nombre}" mide ${Number(anchoM).toFixed(2)} × ${Number(altoM).toFixed(2)} m y este producto se imprime a MEDIDA FIJA: el archivo tiene que medir ${mf.anchoM.toFixed(2)} × ${mf.altoM.toFixed(2)} m (tolerancia 2 cm).`;
}
async function areaPrincipalDeParte(pool, parteId) {
  const r = await pool.request().input('P', sql.Int, parteId).query('SELECT ProductoSolID FROM dbo.SolicitudesVendedorPartes WHERE ParteID = @P');
  return r.recordset[0] ? areaPrincipalDeProducto(pool, r.recordset[0].ProductoSolID) : 'SB';
}

// Resuelve material + copias que llegan con un archivo (o al corregirlo). Copias: 1 por defecto.
async function resolverProduccion(pool, b, heredar, areaId) {
  const copias = b.Copias === undefined || b.Copias === null || b.Copias === '' ? (heredar?.Copias || 1) : parseInt(b.Copias, 10);
  if (!(copias >= 1)) throw fallo(400, 'Las copias deben ser 1 o más.');
  let mat = null;
  if (b.CodArticulo || b.Material) {
    mat = buscarMaterial(await materialesPrincipal(pool, areaId), { codArticulo: b.CodArticulo, nombre: b.Material });
    if (!mat) throw fallo(400, `La tela "${b.Material || b.CodArticulo}" no está en el catálogo de ${areaId && areaId !== 'SB' ? areaId : 'Sublimación'}.`);
  }
  return {
    Material: mat ? String(mat.Material).trim() : (heredar?.Material || null),
    CodArticulo: mat ? String(mat.CodArticulo ?? '').trim() : (heredar?.CodArticulo || null),
    CodStock: mat ? String(mat.CodStock ?? '').trim() : (heredar?.CodStock || null),
    Copias: copias,
  };
}

// Diseño pronto de DTF: se mide contra el film / material que el vendedor cargó en la solicitud.
// Si el material todavía no está cargado, se controla solo el alto; el ancho se controla al convertir.
async function exigirMedidaDtf(pool, pa, b, nombre) {
  const d = (() => { try { return pa.DatosJson ? JSON.parse(pa.DatosJson) : {}; } catch (_) { return {}; } })();
  const mat = d.material ? buscarMaterial(await materialesDe(pool, 'DF', VARIANTE_DTF), { nombre: d.material }) : null;
  const e = errorMedidaDtf(nombre, Number(b.AnchoM), Number(b.AltoM), mat);
  if (e) throw fallo(400, e.mensaje);
}

async function guardarProduccion(cx, archivoId, p) {
  await new sql.Request(cx).input('A', sql.Int, archivoId)
    .input('M', sql.NVarChar(200), p.Material).input('CA', sql.VarChar(50), p.CodArticulo).input('CS', sql.VarChar(50), p.CodStock).input('C', sql.Int, p.Copias)
    .query('UPDATE dbo.SolicitudesVendedorArchivos SET Material = @M, CodArticulo = @CA, CodStock = @CS, Copias = @C WHERE ArchivoID = @A');
}

// Corregir la tela / las copias de un diseño pronto ya subido. Lo hace el diseñador que tiene el trabajo (o un Admin).
async function definirProduccionArchivo(pool, user, base, solicitudId, archivoId, b) {
  const sol = await base.cabecera(pool, solicitudId);
  base.exigirAbierta(sol);
  const r = await pool.request().input('A', sql.Int, archivoId).input('Sol', sql.Int, solicitudId).query(`
    SELECT a.*, pa.Tipo, pa.DisenadorID, p.PedidoNoDocERP
    FROM dbo.SolicitudesVendedorArchivos a
    JOIN dbo.SolicitudesVendedorPartes pa ON pa.ParteID = a.ParteID
    JOIN dbo.SolicitudesVendedorProductos p ON p.ProductoSolID = pa.ProductoSolID
    WHERE a.ArchivoID = @A AND a.SolicitudID = @Sol AND a.Vigente = 1`);
  const a = r.recordset[0];
  if (!a) throw fallo(404, 'El archivo no existe o ya fue sustituido.');
  if (a.Rol !== 'DISENO_PRONTO' || !['PRINCIPAL', 'DTF'].includes(a.Tipo)) throw fallo(400, 'Las copias se cargan solo en los archivos de diseño pronto de la producción principal y de DTF.');
  if (a.Tipo === 'DTF') b = { Copias: b.Copias };   // DTF: solo copias (el film es el del servicio)
  if (a.PedidoNoDocERP) throw fallo(409, 'Este producto ya se convirtió en pedido: el archivo ya no se puede cambiar.');
  // Las carga el diseñador que tiene el trabajo; en un DTF con arte listo del cliente (sin diseñador), el vendedor.
  const vendedorDirecto = a.Tipo === 'DTF' && !a.DisenadorID && base.esVendedor(user);
  if (!base.esAdmin(user) && a.DisenadorID !== user.id && !vendedorDirecto) throw fallo(403, 'La tela y las copias las carga el diseñador que tiene el trabajo.');

  const p = await resolverProduccion(pool, b, a, await areaPrincipalDeProducto(pool, a.ProductoSolID));
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await guardarProduccion(transaction, archivoId, p);
    await base.registrarEvento(transaction, user, {
      solicitudId, productoSolId: a.ProductoSolID, parteId: a.ParteID, tipo: 'ARCHIVO',
      texto: a.Tipo === 'DTF'
        ? `Estampado DTF: "${a.NombreOriginal}" → ${p.Copias} ${p.Copias === 1 ? 'copia' : 'copias'}.`
        : `Producción principal: "${a.NombreOriginal}" → tela ${p.Material || '(sin elegir)'}, ${p.Copias} ${p.Copias === 1 ? 'copia' : 'copias'}.`,
    });
    await transaction.commit();
  } catch (err) {
    await rollbackSeguro(transaction, `solicitudesVendedor.definirProduccionArchivo ${archivoId}`);
    throw err;
  }
  return { ArchivoID: archivoId, ...p };
}

// ---------------------------------------------------------------------
// Solicitud + producto → pedido en términos de negocio (el contrato del plan §2.3)
// ---------------------------------------------------------------------
function armarPedido(sol, p, bobinaId) {
  // F1: producción principal según el producto del catálogo (SB si no dice otra cosa)
  const areaPrincipal = String(p.Config?.TecnicaPrincipal || 'SB').trim().toUpperCase();
  const vigentes = sol.Archivos.filter(a => a.Vigente);
  const arch = (a) => ({ copias: a.Copias || 1, id: `SOLARCH-${a.ArchivoID}`, url: a.UrlDrive, nombre: a.NombreOriginal, anchoM: a.AnchoM != null ? Number(a.AnchoM) : null, altoM: a.AltoM != null ? Number(a.AltoM) : null });
  const deParte = (pa, rol) => vigentes.filter(a => a.ParteID === pa.ParteID && a.Rol === rol).map(arch);
  const delProducto = (rol) => vigentes.filter(a => a.ProductoSolID === p.ProductoSolID && !a.ParteID && !a.EventoID && a.Rol === rol).map(arch);
  const generales = (rol) => vigentes.filter(a => !a.ProductoSolID && !a.ParteID && !a.EventoID && a.Rol === rol).map(arch);

  const principal = p.Partes.find(pa => pa.Tipo === 'PRINCIPAL');
  const corte = p.Datos?.corte?.activo ? p.Datos.corte : null;
  const costura = p.Datos?.costura?.activo ? p.Datos.costura : null;

  const servicios = p.Partes.filter(pa => pa.Tipo !== 'PRINCIPAL').map(pa => {
    const d = pa.Datos || {};
    const s = {
      tipo: pa.Tipo, variante: d.variante || null, material: d.material ? { nombre: d.material } : null,
      ubicacion: pa.Ubicacion || '', nota: pa.Observaciones || '',
      archivos: deParte(pa, 'DISENO_PRONTO'), bocetos: deParte(pa, 'BOCETO'), referencias: deParte(pa, 'REFERENCIA'),
    };
    if (pa.Tipo === 'BORDADO') s.prendas = pa.CantidadTotal || p.Cantidad;
    else s.estampado = { prendas: pa.CantidadTotal, estampadosPorPrenda: pa.PorPrenda, origen: d.origenPrendas || 'Stock User' };
    return s;
  });

  return {
    cliente: { codCliente: sol.CodCliente },
    nombreTrabajo: sol.NombreTrabajo,
    notas: [sol.Observaciones, p.Observaciones].filter(Boolean).join('\n'),
    modo: 'FABRICAR',
    servicioPrincipal: SERVICIO_DE_AREA[areaPrincipal] || 'sublimacion',
    areaPrincipal,
    producto: p.TipoFabricacion === 'PRODUCTO_TERMINADO'
      ? { tipoFabricacion: 'TERMINADO', proIdProducto: p.ProIdProducto, nombre: p.ProductoNombre, cantidad: p.Cantidad,
          // Lo pactado en "Pago y seña" manda también para el producto del catálogo: precio establecido
          // (un total, todo incluido) o facturar por cada área.
          precio: sol.ModoCobro === 'PRECIO_ESTABLECIDO'
            ? { modo: 'ESTABLECIDO', monto: Number(sol.PrecioPactado), moneda: MONEDA[sol.MonIdMoneda] || 'UYU' }
            : { modo: 'POR_AREA' },
          // F1: sin molde, el producto se imprime a medida fija (el validador la controla archivo por archivo)
          medidaFija: p.Config && !p.Config.TizadaProMoldeRef && Number(p.Config.AnchoM) > 0 && Number(p.Config.AltoM) > 0 ? { anchoM: Number(p.Config.AnchoM), altoM: Number(p.Config.AltoM) } : null,
          // [ACCESORIOS] artículos de stock que salen con el producto (configurador › Accesorios y estructura),
          // con lo que el vendedor eligió en la solicitud: cuáles van (los opcionales) y qué variante.
          accesorios: (Array.isArray(p.Datos?.accesorios) ? p.Datos.accesorios : []).filter(a => a && a.incluir !== false && a.itemProIdProducto).map(a => ({
            id: a.id || null, itemProIdProducto: Number(a.itemProIdProducto), nombre: a.nombre || `Artículo ${a.itemProIdProducto}`,
            wmsVarianteId: a.wmsVarianteId ? Number(a.wmsVarianteId) : null, varianteNombre: a.varianteNombre || '',
            cantidadPorUnidad: Number(a.cantidadPorUnidad) || 1,
            cantidad: (Number(a.cantidadPorUnidad) || 1) * (Number(p.Cantidad) || 0),
            cobro: a.cobro === 'APARTE' ? 'APARTE' : 'INCLUIDO', obligatorio: !!a.obligatorio,
            wmsDepositoId: parseInt(a.wmsDepositoId, 10) > 0 ? parseInt(a.wmsDepositoId, 10) : null,
          })) }
      : {
        tipoFabricacion: 'PERSONALIZADO', cantidad: p.Cantidad,
        precio: sol.ModoCobro === 'PRECIO_ESTABLECIDO'
          ? { modo: 'ESTABLECIDO', monto: Number(sol.PrecioPactado), moneda: MONEDA[sol.MonIdMoneda] || 'UYU' }
          : { modo: 'POR_AREA' },
      },
    impresion: {
      areaId: areaPrincipal,
      items: vigentes.filter(a => principal && a.ParteID === principal.ParteID && a.Rol === 'DISENO_PRONTO').map(a => ({
        archivo: arch(a),
        material: a.Material ? { nombre: a.Material, codArticulo: a.CodArticulo } : null,
        copias: a.Copias || 1,
      })),
    },
    corte: corte ? { tipoMolde: corte.tipoMolde, origenTela: corte.origenTela, bobinaId: corte.origenTela === 'TELA CLIENTE' ? (bobinaId || null) : null, tizadas: delProducto('TIZADA') } : null,
    costura: costura ? { instrucciones: costura.instrucciones || '' } : null,
    servicios,
    bocetos: principal ? deParte(principal, 'BOCETO') : [],
    planillas: [...delProducto('PLANILLA'), ...generales('PLANILLA')],
    // La ficha técnica de TIZADA PRO ("FICHA TECNICA SOL-…pdf") no va suelta: va adentro de la Ficha del pedido
    // (solicitudesVendedorFichaPdf.generarPdf la pone primero, tal cual llegó), que se adjunta a la orden PRO.
    archivosReferencia: [...(principal ? deParte(principal, 'REFERENCIA') : []), ...delProducto('REFERENCIA'), ...generales('REFERENCIA')]
      .filter(x => !/^FICHA TECNICA [A-Z]+-\d+-P\d+-\d+\.pdf$/i.test(String(x.nombre || ''))),
  };
}

// Estado de la conversión de cada producto (para mostrarlo en el detalle). Tolerante: si la
// tabla todavía no existe (falta correr add_conversion_solicitud_pedido.sql) no rompe el detalle.
async function estadosConversion(pool, sol) {
  const out = {};
  for (const p of sol.Productos) {
    try { out[p.ProductoSolID] = await procesador.estadoDe(pool, ORIGEN, idExternoDe(sol.SolicitudID, p.ProductoSolID)); }
    catch (e) { logger.warn(`[SOLICITUDES] estado de conversión no disponible: ${e.message}`); out[p.ProductoSolID] = null; }
  }
  return out;
}

// Bobinas de tela que el cliente de la solicitud tiene disponibles hoy (para elegir al convertir).
async function bobinasDelCliente(pool, user, base, solicitudId) {
  if (!base.esVendedor(user) && !(await base.esDisenador(pool, user))) throw fallo(403, 'El pedido lo crea el diseñador que tiene el trabajo (o el vendedor).');
  const sol = await base.cabecera(pool, solicitudId);
  const c = (await pool.request().input('Cod', sql.Int, sol.CodCliente)
    .query('SELECT CodCliente, CliIdCliente, RTRIM(LTRIM(IDCliente)) AS IDCliente FROM dbo.Clientes WHERE CodCliente = @Cod')).recordset[0];
  return c ? bobinasDe(pool, c) : [];
}

// ---------------------------------------------------------------------
// Cola del diseñador en PRODUCCIÓN (solo lectura): órdenes de Bordado y de TPU que ya están en
// planta y todavía esperan su diseño. No inventa estados: lee los que producción ya usa —
//   · Bordado: requisitos bloqueantes MATRIZ y APROBACION sin cumplir (OrdenCumplimientoRequisitos)
//   · TPU:     Ordenes.EstadoenArea (Pendiente → Esperando → Aprobado / Rechazado → Diseñado)
// y los traduce a una misma etapa para las dos áreas. El trabajo se hace desde la ficha de la orden.
// ---------------------------------------------------------------------
// Etapa de diseño de una orden de Bordado / TPU que ya está en producción. UNA sola definición para todo el
// módulo (cola del diseñador, lista de solicitudes, detalle). NULL = ya no espera diseño.
const ETAPA_APPLY = `
    CROSS APPLY (
      SELECT CASE
        WHEN o.AreaID = 'EMB' AND EXISTS (SELECT 1 FROM dbo.ConfigRequisitosProduccion req
                                          WHERE req.AreaID = 'EMB' AND req.CodigoRequisito = 'MATRIZ' AND req.EsBloqueante = 1
                                            AND NOT EXISTS (SELECT 1 FROM dbo.OrdenCumplimientoRequisitos c WHERE c.OrdenID = o.OrdenID AND c.RequisitoID = req.RequisitoID AND c.Estado = 'CUMPLIDO'))
          THEN 'FALTA_DISENO'
        WHEN o.AreaID = 'EMB' AND EXISTS (SELECT 1 FROM dbo.ConfigRequisitosProduccion req
                                          WHERE req.AreaID = 'EMB' AND req.CodigoRequisito = 'APROBACION' AND req.EsBloqueante = 1
                                            AND NOT EXISTS (SELECT 1 FROM dbo.OrdenCumplimientoRequisitos c WHERE c.OrdenID = o.OrdenID AND c.RequisitoID = req.RequisitoID AND c.Estado = 'CUMPLIDO'))
          THEN 'ESPERANDO_APROBACION'
        WHEN o.AreaID = 'TPU' AND o.EstadoenArea = 'Pendiente' THEN 'FALTA_DISENO'
        WHEN o.AreaID = 'TPU' AND o.EstadoenArea = 'Esperando' THEN 'ESPERANDO_APROBACION'
        WHEN o.AreaID = 'TPU' AND o.EstadoenArea = 'Rechazado' THEN 'RECHAZADO'
        WHEN o.AreaID = 'TPU' AND o.EstadoenArea = 'Aprobado'  THEN 'APROBADO_FALTA_ARTE'
      END AS Etapa
    ) x`;
const SQL_ORDEN_VIVA = `o.AreaID IN ('EMB', 'TPU')
      AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Pronto', 'Cerrado', 'Cargando...')
      AND ISNULL(o.EstadoenArea, '') NOT IN ('Pronto', 'Recibido en Destino', 'En transito')`;

async function disenosEnProduccion(pool, user, base) {
  if (!base.esVendedor(user) && !(await base.esDisenador(pool, user))) throw fallo(403, 'Esta lista es para diseñadores y vendedores.');
  const r = await pool.request().query(`
    SELECT TOP 300 o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden, LTRIM(RTRIM(o.AreaID)) AS AreaID, LTRIM(RTRIM(CAST(o.NoDocERP AS varchar(50)))) AS NoDocERP,
           LTRIM(RTRIM(o.Cliente)) AS Cliente, o.DescripcionTrabajo, LTRIM(RTRIM(o.Material)) AS Material, o.Magnitud, o.FechaIngreso, x.Etapa,
           sv.SolicitudID, sv.DisenadorSolicitud
    FROM dbo.Ordenes o
    -- Si el pedido nació de una Solicitud: cuál, y quién tenía tomado ese servicio ahí (para que el trabajo no se pierda de vista)
    OUTER APPLY (
      SELECT TOP 1 p.SolicitudID, ud.Nombre AS DisenadorSolicitud
      FROM dbo.SolicitudesVendedorProductos p
      LEFT JOIN dbo.SolicitudesVendedorPartes pa ON pa.ProductoSolID = p.ProductoSolID AND pa.Activo = 1
                                               AND pa.Tipo = CASE o.AreaID WHEN 'EMB' THEN 'BORDADO' ELSE 'TPU' END
      LEFT JOIN dbo.Usuarios ud ON ud.IdUsuario = pa.DisenadorID
      WHERE p.Activo = 1 AND CAST(p.PedidoNoDocERP AS varchar(50)) = LTRIM(RTRIM(CAST(o.NoDocERP AS varchar(50))))
    ) sv
    ${ETAPA_APPLY}
    WHERE ${SQL_ORDEN_VIVA}
      AND x.Etapa IS NOT NULL
    ORDER BY CASE x.Etapa WHEN 'RECHAZADO' THEN 0 WHEN 'FALTA_DISENO' THEN 1 WHEN 'APROBADO_FALTA_ARTE' THEN 2 ELSE 3 END, o.FechaIngreso`);
  return r.recordset;
}

// Cómo va en PRODUCCIÓN el diseño de Bordado / TPU de un pedido ya convertido (para el detalle de la solicitud).
// Etapa NULL = esa orden ya no espera diseño.
async function disenoProduccionDePedido(pool, noDocERP) {
  if (!noDocERP) return [];
  const r = await pool.request().input('N', sql.VarChar(50), String(noDocERP)).query(`
    SELECT o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden, LTRIM(RTRIM(o.AreaID)) AS AreaID, LTRIM(RTRIM(o.Cliente)) AS Cliente,
           o.Estado, o.EstadoenArea, CASE WHEN ${SQL_ORDEN_VIVA} THEN x.Etapa ELSE NULL END AS Etapa
    FROM dbo.Ordenes o
    ${ETAPA_APPLY}
    WHERE LTRIM(RTRIM(CAST(o.NoDocERP AS varchar(50)))) = @N AND o.AreaID IN ('EMB', 'TPU')
    ORDER BY o.OrdenID`);
  return r.recordset;
}

// 28-sep: el pedido lo crea el DISEÑADOR desde su pantalla de Diseño (con la tizada y los archivos ya cargados); el vendedor también puede.
async function convertir(pool, user, base, solicitudId, productoSolId, b, app) {
  if (!base.esVendedor(user) && !(await base.esDisenador(pool, user))) throw fallo(403, 'El pedido lo crea el diseñador que tiene el trabajo (o el vendedor).');
  const sol = await base.obtener(pool, user, solicitudId);
  base.exigirAbierta(sol);
  const p = sol.Productos.find(x => x.ProductoSolID === productoSolId);
  if (!p) throw fallo(404, 'Ese producto no pertenece a la solicitud.');
  if (p.PedidoNoDocERP) throw fallo(409, `Este producto ya se convirtió en el pedido ${p.PedidoNoDocERP}.`);
  const faltantes = sol.Conversion.find(c => c.ProductoSolID === productoSolId)?.faltantes || [];
  if (faltantes.length) throw fallo(409, `Todavía no se puede convertir. Falta:\n• ${faltantes.join('\n• ')}`);

  const resultado = await procesador.crearPedido(pool, {
    origen: ORIGEN, idExterno: idExternoDe(solicitudId, productoSolId),
    pedido: armarPedido(sol, p, parseInt(b?.bobinaId, 10) || null), usuarioInterno: user, app,
  });

  if (resultado.noDocERP && !p.PedidoNoDocERP) {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await new sql.Request(transaction).input('P', sql.Int, productoSolId).input('N', sql.Int, resultado.noDocERP).input('U', sql.Int, user.id)
        .query('UPDATE dbo.SolicitudesVendedorProductos SET PedidoNoDocERP = @N, FechaConversion = GETDATE(), UsuarioConversion = @U WHERE ProductoSolID = @P AND PedidoNoDocERP IS NULL');
      await base.registrarEvento(transaction, user, {
        solicitudId, productoSolId, tipo: 'CONVERSION',
        texto: `Producto convertido en el pedido ${resultado.noDocERP} (${resultado.codigosOrden.join(', ')}).`,
      });
      await base.recalcularEstado(transaction, user, solicitudId);
      await transaction.commit();
    } catch (err) {
      await rollbackSeguro(transaction, `solicitudesVendedor.convertir ${solicitudId}/${productoSolId}`);
      throw err;
    }
    // Ficha del pedido (PDF con todo lo de la solicitud) → referencia "FICHA_PEDIDO" de la orden PRO.
    // Después de responder: tarda (arma el PDF y lo sube a Drive) y si falla la conversión ya quedó hecha.
    setImmediate(async () => {
      const ficha = require('./solicitudesVendedorFichaPdf');
      const r = await ficha.adjuntarAlPedido(pool, () => base.obtener(pool, user, solicitudId), solicitudId, resultado.noDocERP, user, app);
      if (r) {
        await base.registrarEvento(pool, user, { solicitudId, productoSolId, tipo: 'CONVERSION', texto: `Ficha del pedido (PDF) adjuntada a ${r.codigoOrden} como referencia.` })
          .catch(e => require('../utils/logger').warn(`[FICHA-PDF] evento SOL-${solicitudId}: ${e.message}`));
      }
    });
  }
  return resultado;
}

const reintentarArchivos = async (pool, user, base, solicitudId, productoSolId, app) => {
  if (!base.esVendedor(user) && !(await base.esDisenador(pool, user))) throw fallo(403, 'El pedido lo crea el diseñador que tiene el trabajo (o el vendedor).');
  return procesador.reintentarArchivos(pool, { origen: ORIGEN, idExterno: idExternoDe(solicitudId, productoSolId), usuarioInterno: user, app });
};

module.exports = { areaPrincipalDeProducto, areaPrincipalDeParte, medidaFijaDeProducto, errorMedidaFija, SERVICIO_DE_AREA, disenoProduccionDePedido, ETAPA_APPLY_PARA_LISTA: () => ETAPA_APPLY, SQL_ORDEN_VIVA, disenosEnProduccion, exigirMedidaDtf, bobinasDelCliente, materialesPrincipal, resolverProduccion, guardarProduccion, definirProduccionArchivo, armarPedido, estadosConversion, convertir, reintentarArchivos };
