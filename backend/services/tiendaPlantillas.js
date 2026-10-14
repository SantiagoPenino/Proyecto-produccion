'use strict';
// =====================================================================
// Tienda del portal: la PLANTILLA de TIZADA PRO para que el cliente arme su arte
// =====================================================================
// El producto tiene un molde de TIZADA (ProductoVentaConfig.TizadaProMoldeRef) y UN modelo de ese molde (la
// variable v_… de TIZADA: ProductoVentaConfig.ModeloClave en una variante, o el único de ProductoModelos). Con eso
// se le pide a TIZADA la base (POST /plantillas, un diseño para todos los talles, tamaño real) y se le da al cliente
// la GUÍA .ai, la que abre cualquier Illustrator sin instalar nada (API.md §6.b).
//
// - Una plantilla por producto+modelo, con referencia fija TIENDA-<producto>-<modelo>: la primera vez se pide y
//   se espera (segundos); después se reusa la que ya tiene TIZADA. Si TIZADA la borró, se pide de nuevo sola.
// - La descarga pasa por nuestro servidor: la llave de TIZADA nunca va al navegador.
// - Productos a medida: no (sin la medida del cliente no hay plantilla; se pide en el pedido, con su medida).
// - Con TIZADAPRO_SOLO_LECTURA=1 se sirven las que ya existen, pero no se pide ninguna nueva.
// =====================================================================
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const api = require('./tizadaProApi');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const limpiar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 40) || 'PRODUCTO';
const espera = (ms) => new Promise(r => setTimeout(r, ms));

async function columnas(pool) {
  const r = await pool.request().query("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProductoVentaConfig')");
  return new Set(r.recordset.map(x => x.name));
}

// Molde + modelo del producto (o por qué no tiene plantilla)
async function datosProducto(pool, proId) {
  const cols = await columnas(pool);
  if (!cols.has('TizadaProMoldeRef')) return { motivo: 'Falta la configuración de TIZADA PRO en esta base.' };
  const r = await pool.request().input('P', sql.Int, proId).query(`
    SELECT TOP 1 a.ProIdProducto, LTRIM(RTRIM(a.Descripcion)) AS Descripcion, LTRIM(RTRIM(tp.TituloVenta)) AS TituloVenta,
           LTRIM(RTRIM(vc.TizadaProMoldeRef)) AS MoldeRef,
           ${cols.has('ModeloClave') ? 'LTRIM(RTRIM(vc.ModeloClave))' : 'CAST(NULL AS NVARCHAR(96))'} AS ModeloClave,
           ${cols.has('AMedidaJson') ? 'CASE WHEN vc.AMedidaJson IS NULL THEN 0 ELSE 1 END' : '0'} AS AMedida
    FROM dbo.Articulos a
    JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = a.ProIdProducto
    LEFT JOIN dbo.TiendaProductos tp ON tp.ProIdProducto = a.ProIdProducto
    WHERE a.ProIdProducto = @P AND ISNULL(a.borrar, 0) = 0`);
  const p = r.recordset[0];
  if (!p || !p.MoldeRef) return { motivo: 'Este producto no tiene molde de TIZADA PRO.' };
  if (p.AMedida) return { motivo: 'Producto a medida: la plantilla sale con la medida de tu pedido (en "Armar mi pedido").' };
  let modelo = p.ModeloClave || null;
  if (!modelo) {
    // Producto con su modelo en ProductoModelos: tiene que ser UNO (o el marcado como principal)
    const m = (await pool.request().input('P', sql.Int, proId).query(
      'SELECT ModeloClave, EsDefault FROM dbo.ProductoModelos WHERE ProIdProducto = @P ORDER BY ISNULL(EsDefault, 0) DESC, ISNULL(Orden, 999)')).recordset;
    if (m.length === 1 || (m.length > 1 && m[0].EsDefault)) modelo = String(m[0].ModeloClave).trim();
    else if (m.length > 1) return { motivo: 'El producto tiene varios modelos y ninguno marcado como principal.' };
  }
  if (!modelo) return { motivo: 'El producto no tiene el modelo del molde elegido.' };
  const nombre = (p.TituloVenta || p.Descripcion || '').split(' · ').pop().trim() || p.Descripcion;
  return { proId: p.ProIdProducto, moldeRef: p.MoldeRef, modelo, nombre, referencia: `TIENDA-${p.ProIdProducto}-${modelo}`.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) };
}

// Productos de la tienda que tienen plantilla (para mostrar el link en su foto)
async function conPlantilla(pool) {
  const cols = await columnas(pool);
  if (!cols.has('TizadaProMoldeRef') || !api.estadoConfig().ok) return [];
  const r = await pool.request().query(`
    SELECT tp.ProIdProducto,
           ${cols.has('ModeloClave') ? 'LTRIM(RTRIM(ISNULL(vc.ModeloClave, \'\')))' : "''"} AS ModeloClave,
           (SELECT COUNT(*) FROM dbo.ProductoModelos m WHERE m.ProIdProducto = tp.ProIdProducto) AS Modelos,
           (SELECT COUNT(*) FROM dbo.ProductoModelos m WHERE m.ProIdProducto = tp.ProIdProducto AND m.EsDefault = 1) AS Principales
    FROM dbo.TiendaProductos tp
    JOIN dbo.ProductoVentaConfig vc ON vc.ProIdProducto = tp.ProIdProducto
    WHERE tp.Publicado = 1 AND LTRIM(RTRIM(ISNULL(vc.TizadaProMoldeRef, ''))) <> ''
      ${cols.has('AMedidaJson') ? 'AND vc.AMedidaJson IS NULL' : ''}`);
  return r.recordset.filter(x => x.ModeloClave || x.Modelos === 1 || (x.Modelos > 1 && x.Principales >= 1)).map(x => x.ProIdProducto);
}

// La guía .ai de la plantilla de TIZADA (la que ya tiene, o la pide y espera). Una sola a la vez por referencia.
const enCurso = new Map();
async function guiaDe(d) {
  if (enCurso.has(d.referencia)) return enCurso.get(d.referencia);
  const p = (async () => {
    let est = null;
    try { est = await api.plantillaEstado(d.referencia); }
    catch (e) { if (e.status !== 404) throw e; }
    const guia = (x) => (x?.archivos || []).find(a => a.tipo === 'guia');
    if (!(est?.estado === 'listo' && guia(est))) {
      if (!est || ['rechazado', 'error'].includes(est.estado) || (est.estado === 'listo' && !guia(est))) {
        if (api.soloLectura()) throw fallo(409, 'La plantilla de este producto todavía no está armada en TIZADA PRO (la integración está en solo lectura).');
        await api.plantillaPedir({ referencia: d.referencia, disenos: [{ nombre: limpiar(d.nombre), variables: [d.modelo] }], talles: { modo: 'todos' }, escala: 100 });
        logger.info(`[TIENDA-PLANTILLA] ${d.referencia}: pedida a TIZADA PRO`);
      }
      const hasta = Date.now() + 60000;   // el robot la arma en segundos
      do {
        await espera(1500);
        est = await api.plantillaEstado(d.referencia);
      } while (!['listo', 'rechazado', 'error'].includes(est?.estado) && Date.now() < hasta);
    }
    if (est?.estado !== 'listo') {
      const al = (est?.alarmas || []).map(a => a.mensaje || a.codigo).join(' · ');
      throw fallo(est?.estado ? 502 : 504, est?.estado ? `TIZADA PRO no pudo armar la plantilla${al ? `: ${al}` : '.'}` : 'TIZADA PRO está tardando en armar la plantilla: probá de nuevo en un minuto.');
    }
    const g = guia(est);
    if (!g) throw fallo(502, 'TIZADA PRO armó la plantilla pero sin la guía .ai.');
    return g;
  })();
  enCurso.set(d.referencia, p);
  try { return await p; } finally { enCurso.delete(d.referencia); }
}

// Paso 1 (JSON): deja lista la plantilla y dice cómo se llama. Paso 2: el archivo.
async function preparar(pool, proId) {
  const d = await datosProducto(pool, parseInt(proId, 10));
  if (!d.referencia) throw fallo(404, d.motivo);
  if (!api.estadoConfig().ok) throw fallo(503, 'La conexión con TIZADA PRO no está disponible.');
  const g = await guiaDe(d);
  return { nombre: `Plantilla ${d.nombre}.ai`, bytes: g.bytes || null };
}
async function archivo(pool, proId) {
  const d = await datosProducto(pool, parseInt(proId, 10));
  if (!d.referencia) throw fallo(404, d.motivo);
  const g = await guiaDe(d);
  const b = await api.bajarArchivo(g.descarga);
  if (g.sha256 && api.sha256(b.buffer) !== g.sha256) throw fallo(502, 'La plantilla llegó cortada: probá de nuevo.');
  return { buffer: b.buffer, nombre: `Plantilla ${d.nombre}.ai` };
}

module.exports = { datosProducto, conPlantilla, preparar, archivo };
