'use strict';
// =====================================================================
// Ficha del pedido en PDF, armada DESDE EL PEDIDO CREADO (por NoDocERP)
// =====================================================================
// Sirve para cualquier vía de ingreso (pedido-prenda, solicitud de vendedor, portal, tienda):
// junta todo lo que ya quedó en la base — órdenes del pedido con sus archivos, cobranza, y la
// configuración del producto del catálogo (producción principal, técnicas, ficha técnica con
// avíos/costuras, accesorios) — y la pega a la orden madre PRO como referencia FICHA_PEDIDO.
// Mismo formato y estilos que la ficha de la solicitud (solicitudesVendedorFichaPdf.js).
// =====================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const base = require('./solicitudesVendedorFichaPdf');
const { esc, F, H2, H3, fecha, fechaHora, plata, ahoraLocal, miniaturas, fichaTecnica, CSS } = base;

const NOMBRE_AREA = { SB: 'Sublimación', DIRECTA: 'Impresión directa', ECOUV: 'Gran formato', DF: 'Estampado DTF', TPU: 'Estampado TPU', EMB: 'Bordado', EST: 'Estampado', TWC: 'Corte', TWT: 'Costura', PRO: 'Producto (orden madre)', TERMINAC: 'Terminaciones' };
// Para las ÓRDENES del pedido: las órdenes DF/TPU imprimen el transfer; el estampado es la orden EST.
// (NOMBRE_AREA se sigue usando para las técnicas del PRODUCTO, donde "Estampado DTF/TPU" es el servicio completo.)
const NOMBRE_AREA_ORDEN = { ...NOMBRE_AREA, DF: 'Impresión DTF', TPU: 'Impresión TPU' };
const t = (v) => String(v == null ? '' : v).trim();
const mon = (m) => (String(m || '').toUpperCase() === 'USD' || Number(m) === 2 ? 2 : 1);

// ---------------------------------------------------------------------
// Datos del pedido
// ---------------------------------------------------------------------
async function datosPedido(pool, noDocERP) {
  const doc = t(noDocERP);
  const ordenes = (await pool.request().input('N', sql.VarChar(60), doc).query(`
    SELECT o.OrdenID, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden, LTRIM(RTRIM(o.AreaID)) AS AreaID, LTRIM(RTRIM(o.Variante)) AS Variante,
           LTRIM(RTRIM(o.Material)) AS Material, LTRIM(RTRIM(o.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(o.UM)) AS UM, o.Magnitud,
           o.Nota, o.Observaciones, o.DescripcionTrabajo, o.Cliente, o.CodCliente, o.CliIdCliente, o.ProIdProducto, o.FechaIngreso, o.Prioridad,
           o.Estado, o.ProximoServicio, o.EstadoDependencia, o.WmsVarianteId, o.ComboItemID, o.Tinta, o.ModoRetiro, o.FechaEstimadaEntrega, o.FechaCompromiso
    FROM dbo.Ordenes o WHERE LTRIM(RTRIM(o.NoDocERP)) = @N ORDER BY o.OrdenID`)).recordset;
  if (!ordenes.length) return null;
  const ids = ordenes.map(o => o.OrdenID).join(',');
  const [archivos, referencias, cobranza, detalle] = await Promise.all([
    pool.request().query(`SELECT OrdenID, NombreArchivo, Copias, Ancho, Alto, Metros, RutaAlmacenamiento, TipoArchivo, EstadoArchivo, FechaSubida FROM dbo.ArchivosOrden WHERE OrdenID IN (${ids}) AND ISNULL(EstadoArchivo, '') <> 'CANCELADO' ORDER BY OrdenID, ArchivoID`),
    pool.request().query(`SELECT RefID, OrdenID, TipoArchivo, UbicacionStorage, NombreOriginal, NotasAdicionales, FechaSubida FROM dbo.ArchivosReferencia WHERE OrdenID IN (${ids}) ORDER BY RefID`),
    pool.request().input('N', sql.VarChar(60), doc).query(`SELECT TOP 1 ID, MontoTotal, Moneda, EstadoCobro, ModoRetiro, FechaGeneracion FROM dbo.PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = @N ORDER BY ID DESC`),
    pool.request().input('N', sql.VarChar(60), doc).query(`SELECT d.OrdenID, LTRIM(RTRIM(d.CodArticulo)) AS CodArticulo, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.Moneda FROM dbo.PedidosCobranzaDetalle d JOIN dbo.PedidosCobranza c ON c.ID = d.PedidoCobranzaID WHERE LTRIM(RTRIM(c.NoDocERP)) = @N`),
  ]);

  // Producto del catálogo (orden madre PRO con artículo)
  const pro = ordenes.find(o => o.AreaID === 'PRO' && !o.ComboItemID) || ordenes.find(o => o.AreaID === 'PRO') || null;
  let producto = null;
  if (pro && pro.ProIdProducto) {
    const conF1 = (await pool.request().query(`SELECT COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicaPrincipal') AS c, COL_LENGTH('dbo.ProductoVentaConfig', 'EtiquetaID') AS e`)).recordset[0];
    const p = (await pool.request().input('PID', sql.Int, pro.ProIdProducto).query(`
      SELECT a.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) AS CodArticulo, LTRIM(RTRIM(a.Descripcion)) AS Descripcion, LTRIM(RTRIM(sa.Articulo)) AS Familia,
             vc.Estado, vc.OrigenTipo, vc.CantidadMinima, vc.CantidadFija
             ${conF1.c != null ? ', vc.TecnicaPrincipal, vc.Molde, vc.UM AS UMProducto, vc.AnchoM, vc.AltoM, vc.BordeCm, vc.TizadaProMoldeRef' : ''}
             ${conF1.e != null ? ', etq.Nombre AS Etiqueta' : ''}
      FROM dbo.Articulos a
      LEFT JOIN dbo.StockArt sa ON LTRIM(RTRIM(sa.CodStock)) = LTRIM(RTRIM(a.CodStock))
      LEFT JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
      ${conF1.e != null ? 'LEFT JOIN dbo.ProductoEtiqueta etq ON etq.EtiquetaID = vc.EtiquetaID' : ''}
      WHERE a.ProIdProducto = @PID`)).recordset[0];
    if (p) {
      const tecnicas = (await pool.request().input('PID', sql.Int, pro.ProIdProducto).query('SELECT AreaID, Obligatorio, Modo, Cobro FROM dbo.ProductoTerminadoServicios WHERE ProIdProducto = @PID ORDER BY AreaID')).recordset;
      let ficha = null;
      try { ficha = await require('./solicitudesVendedorFichaProducto').fichaProducto(pool, pro.ProIdProducto); } catch (e) { logger.warn(`[FICHA-PEDIDO] ficha del producto ${pro.ProIdProducto}: ${e.message}`); }
      producto = { ...p, tecnicas, FichaProducto: ficha };
    }
  }

  // Modo de cobro (marcadores en la nota de la PRO, igual que el motor de precios)
  const notaPro = t(pro?.Nota);
  const mEst = notaPro.match(/\[PRECIO ESTABLECIDO:\s*([\d.,]+)\s*([A-Z]{3})\]/i);
  const modoCobro = mEst ? `Precio establecido: ${plata(parseFloat(mEst[1].replace(',', '.')), mon(mEst[2]))} (todo incluido)` : (/\[FACTURA POR AREA\]/i.test(notaPro) ? 'Facturar por cada área' : (pro ? 'Precio del producto + personalizaciones' : ''));

  return {
    noDocERP: doc, ordenes, archivos: archivos.recordset, referencias: referencias.recordset, cobranza: cobranza.recordset[0] || null, detalle: detalle.recordset,
    pro, producto, modoCobro,
    principal: ordenes.filter(o => ['SB', 'DIRECTA', 'ECOUV', 'DF'].includes(o.AreaID) && !o.WmsVarianteId),
    retiros: ordenes.filter(o => o.WmsVarianteId),
  };
}

// ---------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------
function htmlFichaPedido(d) {
  const cab = d.pro || d.ordenes[0];
  const cliente = t(cab.Cliente);
  const trabajo = t(cab.DescripcionTrabajo) || `Pedido ${d.noDocERP}`;
  const p = d.producto;
  const arch = (o) => d.archivos.filter(a => a.OrdenID === o.OrdenID).map(a => ({
    UrlDrive: a.RutaAlmacenamiento, NombreOriginal: a.NombreArchivo, Rol: a.TipoArchivo || 'Producción',
    AnchoM: a.Ancho, AltoM: a.Alto, Material: o.Material, Copias: a.Copias, FechaSubida: a.FechaSubida,
  }));
  const refs = d.referencias.filter(r => t(r.TipoArchivo) !== 'FICHA_PEDIDO').map(r => ({ UrlDrive: r.UbicacionStorage, NombreOriginal: r.NombreOriginal, Rol: r.TipoArchivo, FechaSubida: r.FechaSubida }));
  const cant = (o) => `${Number(o.Magnitud) || 0} ${t(o.UM) || ''}`.trim();
  const total = d.cobranza ? plata(d.cobranza.MontoTotal, mon(d.cobranza.Moneda)) : '';

  const seccionProducto = p ? `
    ${H2(`Producto: ${p.Descripcion}`, `${Number(d.pro.Magnitud) || 0} unidades`)}
    <div class="grid">
      ${F('Familia', p.Familia)}${F('Para qué es', p.Etiqueta)}${F('Código', p.CodArticulo)}
      ${F('Producción principal', NOMBRE_AREA[t(p.TecnicaPrincipal || 'SB')] || p.TecnicaPrincipal)}
      ${F('Molde de TizadaPro', p.TizadaProMoldeRef ? `vinculado (${p.TizadaProMoldeRef})` : (p.Molde === 'NO' ? 'No lleva' : p.Molde === 'OPCIONAL' ? 'Opcional (sin vincular)' : ''))}
      ${F('Medida fija', Number(p.AnchoM) > 0 && Number(p.AltoM) > 0 ? `${Number(p.AnchoM).toFixed(2)} × ${Number(p.AltoM).toFixed(2)} m${Number(p.BordeCm) > 0 ? ` · borde ${Number(p.BordeCm)} cm` : ''}` : '')}
      ${F('Se cuenta por', p.UMProducto === 'm2' ? 'm²' : p.UMProducto === 'm' ? 'metro' : 'unidad')}
      ${F('Técnicas', (p.tecnicas || []).map(x => `${NOMBRE_AREA[t(x.AreaID)] || x.AreaID}${x.Obligatorio ? '' : ' (opcional)'}${t(x.Cobro) === 'INCLUIDA' ? ' · incluida' : ' · se cobra aparte'}`).join(' · '))}
    </div>
    ${fichaTecnica(p)}` : `${H2('Producto', 'personalizado del cliente')}${F('Trabajo', trabajo)}`;

  const tablaOrdenes = `<table><thead><tr><th>Orden</th><th>Área</th><th>Material / variante</th><th>Cantidad</th><th>Estado</th><th>Sigue a</th></tr></thead><tbody>
    ${d.ordenes.map(o => `<tr><td><b>${esc(o.CodigoOrden)}</b></td><td>${esc(NOMBRE_AREA_ORDEN[o.AreaID] || o.AreaID)}</td><td>${esc([o.Material, o.Variante].filter(Boolean).join(' · '))}${o.Tinta ? `<br><small>tinta ${esc(o.Tinta)}</small>` : ''}</td><td>${esc(cant(o))}</td><td>${esc(o.Estado || '')}${o.EstadoDependencia ? `<br><small>${esc(o.EstadoDependencia)}</small>` : ''}</td><td>${esc(o.ProximoServicio || '')}</td></tr>`).join('')}
  </tbody></table>`;

  const seccionArchivos = d.ordenes.map(o => {
    const lista = arch(o);
    return lista.length ? `${H3(`${o.CodigoOrden} · ${NOMBRE_AREA_ORDEN[o.AreaID] || o.AreaID}`, [o.Material, o.Variante].filter(Boolean).join(' · '))}${miniaturas(lista, true)}` : '';
  }).join('');

  const seccionRetiros = d.retiros.length ? `${H3('Accesorios y artículos de stock', 'retiros del WMS que se unen al pedido')}<table><thead><tr><th>Orden</th><th>Artículo</th><th>Cantidad</th><th>Estado</th><th>Va a</th></tr></thead><tbody>
    ${d.retiros.map(o => `<tr><td>${esc(o.CodigoOrden)}</td><td>${esc(o.Material || o.DescripcionTrabajo || '')}</td><td>${esc(cant(o))}</td><td>${esc(o.EstadoDependencia || o.Estado || '')}</td><td>${esc(o.ProximoServicio || '')}</td></tr>`).join('')}</tbody></table>` : '';

  const notas = [...new Set(d.ordenes.map(o => t(o.Observaciones)).filter(Boolean))];
  const notaLimpia = notaPro => t(notaPro).replace(/\[[^\]]*\]/g, '').trim();
  const notasPro = notaLimpia(cab.Nota);

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha del pedido ${esc(d.noDocERP)}</title>
<style>${CSS}</style></head><body>
  <div class="top">
    <div>
      <div class="kicker">Ficha del pedido · Pedido ${esc(d.noDocERP)} · ingresado el ${fechaHora(cab.FechaIngreso)}${cab.Prioridad ? ` · prioridad ${esc(cab.Prioridad)}` : ''}</div>
      <h1>${esc(trabajo)}</h1>
      <div>${esc(cliente)}${cab.CodCliente ? ` · cliente ${esc(cab.CodCliente)}` : ''}</div>
    </div>
    <div class="der">
      <div class="ped">Pedido ${esc(d.noDocERP)}</div>
      ${total ? `<div>Total: <b>${esc(total)}</b>${d.cobranza?.EstadoCobro ? ` · ${esc(d.cobranza.EstadoCobro)}` : ''}</div>` : ''}
      ${cab.FechaCompromiso || cab.FechaEstimadaEntrega ? `<div>Entrega: <b>${fecha(cab.FechaCompromiso || cab.FechaEstimadaEntrega)}</b></div>` : ''}
    </div>
  </div>

  <div class="banda">El pedido</div>
  <div class="grid">
    ${F('Cliente', cliente)}${F('Nombre del trabajo', trabajo)}
    ${F('Cómo se cobra', d.modoCobro)}${F('Total cotizado', total)}
    ${F('Retiro / envío', d.cobranza?.ModoRetiro || cab.ModoRetiro)}${F('Órdenes', d.ordenes.map(o => o.CodigoOrden).join(' · '))}
  </div>
  ${notasPro ? F('Notas del pedido', notasPro) : ''}
  ${notas.length ? F('Observaciones', notas.join('\n')) : ''}

  <div class="banda">Producto y configuración</div>
  ${seccionProducto}

  <div class="banda">Órdenes de producción</div>
  ${tablaOrdenes}
  ${seccionRetiros}
  ${seccionArchivos ? `${H2('Archivos de producción', 'lo que va a cada área')}${seccionArchivos}` : ''}
  ${refs.length ? `${H2('Archivos de referencia', 'bocetos, planillas, artes del cliente')}${miniaturas(refs, false)}` : ''}

  <div class="pie">Generado el ${ahoraLocal()} · Ficha del pedido ${esc(d.noDocERP)}</div>
</body></html>`;
}

const nombreArchivo = (noDocERP) => `Ficha pedido ${t(noDocERP)}.pdf`;

async function generarPdfPedido(pool, noDocERP) {
  const d = await datosPedido(pool, noDocERP);
  if (!d) { const e = new Error(`El pedido ${noDocERP} no tiene órdenes.`); e.status = 404; throw e; }
  return { pdf: await base.pdfDesdeHtml(htmlFichaPedido(d)), datos: d };
}

/**
 * Genera la ficha del pedido y la pega a la orden madre PRO como referencia FICHA_PEDIDO.
 * Sin PRO no hay dónde pegarla (devuelve null). Si ya tiene ficha y no se fuerza, no duplica.
 * Nunca lanza: queda en el log y el pedido sigue.
 */
async function adjuntarAlPedido(noDocERP, user, app, { forzar = false } = {}) {
  let tmp = null;
  try {
    const pool = await getPool();
    const orden = (await pool.request().input('N', sql.VarChar(60), t(noDocERP)).query(`
      SELECT TOP 1 OrdenID, CodigoOrden FROM dbo.Ordenes WHERE LTRIM(RTRIM(NoDocERP)) = @N AND LTRIM(RTRIM(AreaID)) = 'PRO' AND ComboItemID IS NULL ORDER BY OrdenID`)).recordset[0];
    if (!orden) { logger.info(`[FICHA-PEDIDO] ${noDocERP}: sin orden madre PRO, no se adjunta ficha.`); return null; }
    const ya = (await pool.request().input('O', sql.Int, orden.OrdenID).query(`SELECT RefID FROM dbo.ArchivosReferencia WHERE OrdenID = @O AND LTRIM(RTRIM(TipoArchivo)) = 'FICHA_PEDIDO'`)).recordset;
    if (ya.length && !forzar) { logger.info(`[FICHA-PEDIDO] ${noDocERP}: ${orden.CodigoOrden} ya tiene ficha (${ya.length}); no se duplica.`); return { ordenId: orden.OrdenID, codigoOrden: orden.CodigoOrden, yaExistia: true }; }
    const { pdf } = await generarPdfPedido(pool, noDocERP);
    tmp = path.join(os.tmpdir(), `ficha-pedido-${t(noDocERP)}-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, pdf);
    const { uploadReferenceFile } = require('../controllers/ordersController');
    const out = await base.invocar(uploadReferenceFile, {
      params: { ordenId: String(orden.OrdenID) },
      body: { tipo: 'FICHA_PEDIDO', nota: `Ficha del pedido ${t(noDocERP)} generada al crearlo${forzar ? ' (regenerada)' : ''}` },
      file: { path: tmp, originalname: nombreArchivo(noDocERP), mimetype: 'application/pdf', size: pdf.length },
      user: user || { id: 0, usuario: 'Sistema' }, headers: {}, app,
    });
    if (!out.body?.success) throw new Error(out.body?.error || `la subida respondió ${out.status}`);
    logger.info(`[FICHA-PEDIDO] ${noDocERP}: ficha adjuntada a ${orden.CodigoOrden}.`);
    return { ordenId: orden.OrdenID, codigoOrden: orden.CodigoOrden, url: out.body.url };
  } catch (e) {
    logger.warn(`[FICHA-PEDIDO] ${noDocERP}: no se pudo adjuntar la ficha: ${e.message}`);
    return null;
  } finally {
    if (tmp) { try { fs.unlinkSync(tmp); } catch (_) { /* ya la borró la subida */ } }
  }
}

module.exports = { datosPedido, htmlFichaPedido, generarPdfPedido, adjuntarAlPedido, nombreArchivo };
