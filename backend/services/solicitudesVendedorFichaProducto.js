'use strict';
// =====================================================================
// Ficha técnica del producto del catálogo, para la solicitud (solo lectura)
// =====================================================================
// Lo que se cargó en Configurar productos → Ficha de diseño: avíos, costuras (ISO 4915),
// material/tallas/marcación, notas sueltas y el dibujo. Viaja con cada producto de la
// solicitud (obtener → p.FichaProducto) para que el diseñador lo tenga a la vista y salga
// en la ficha PDF del pedido. Nunca tumba el detalle: si falta una tabla, devuelve null.
// =====================================================================
const fs = require('fs');
const path = require('path');
const { sql } = require('../config/db');

const t = (v) => String(v == null ? '' : v).trim();

async function fichaProducto(pool, proIdProducto) {
  const pid = parseInt(proIdProducto, 10);
  if (!pid) return null;
  const ex = (await pool.request().query(`SELECT OBJECT_ID('dbo.ProductoFichaDiseno','U') AS f, OBJECT_ID('dbo.ProductoAvios','U') AS a, OBJECT_ID('dbo.ProductoFichaDisenoCosturas','U') AS c,
                                                 OBJECT_ID('dbo.ProductoFichaDisenoExtra','U') AS e, OBJECT_ID('dbo.ProductoFichaDisenoAnotaciones','U') AS n, OBJECT_ID('dbo.CosturasISO','U') AS iso`)).recordset[0];
  const rq = () => pool.request().input('PID', sql.Int, pid);
  const [f, a, c, e, n] = await Promise.all([
    ex.f ? rq().query('SELECT Ref, Marca, Material, Tallas, Marcacion, DibujoUrl FROM dbo.ProductoFichaDiseno WHERE ProIdProducto = @PID') : { recordset: [] },
    ex.a ? rq().query('SELECT Nombre, Cantidad, Unidad, Medida, Nota FROM dbo.ProductoAvios WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ID') : { recordset: [] },
    ex.c ? rq().query(`SELECT c.UnionNombre, c.CodigoISO${ex.iso ? ', i.Nombre AS CosturaNombre' : ', NULL AS CosturaNombre'}
                       FROM dbo.ProductoFichaDisenoCosturas c${ex.iso ? ' LEFT JOIN dbo.CosturasISO i ON i.CodigoISO = c.CodigoISO' : ''}
                       WHERE c.ProIdProducto = @PID ORDER BY ISNULL(c.Orden, 999), c.ID`) : { recordset: [] },
    ex.e ? rq().query('SELECT Etiqueta, Valor FROM dbo.ProductoFichaDisenoExtra WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ExtraID') : { recordset: [] },
    ex.n ? rq().query('SELECT Texto FROM dbo.ProductoFichaDisenoAnotaciones WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), AnotacionID') : { recordset: [] },
  ]);
  const fd = f.recordset[0] || {};
  const out = {
    ref: t(fd.Ref) || null, marca: t(fd.Marca) || null, material: t(fd.Material) || null, tallas: t(fd.Tallas) || null, marcacion: t(fd.Marcacion) || null,
    dibujoUrl: t(fd.DibujoUrl) || null,
    avios: a.recordset.map(x => ({ nombre: t(x.Nombre), cantidad: x.Cantidad, unidad: t(x.Unidad) || 'u', medida: t(x.Medida) || null, nota: t(x.Nota) || null })),
    costuras: c.recordset.map(x => ({ union: t(x.UnionNombre), codigoISO: t(x.CodigoISO), nombre: t(x.CosturaNombre) || null })),
    notas: [...e.recordset.map(x => ({ etiqueta: t(x.Etiqueta), valor: t(x.Valor) })), ...n.recordset.map(x => ({ etiqueta: null, valor: t(x.Texto) }))].filter(x => x.valor),
  };
  const vacia = !out.material && !out.tallas && !out.marcacion && !out.dibujoUrl && !out.avios.length && !out.costuras.length && !out.notas.length;
  return vacia ? null : out;
}

// El dibujo como data URI para el PDF (puppeteer arma la página con setContent: no resuelve /uploads).
function dibujoDataUri(dibujoUrl) {
  try {
    if (!dibujoUrl || !dibujoUrl.startsWith('/uploads/')) return null;
    const ruta = path.join(__dirname, '..', dibujoUrl.replace(/^\//, ''));
    if (!fs.existsSync(ruta)) return null;
    const ext = path.extname(ruta).slice(1).toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
    return `data:${mime};base64,${fs.readFileSync(ruta).toString('base64')}`;
  } catch (_) { return null; }
}

module.exports = { fichaProducto, dibujoDataUri };
