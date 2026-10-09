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
const num = (v) => String(Number(v)).replace('.', ',');

// [AVÍOS POR TALLE] "S–M 55 cm · L–XL 60 cm": talles seguidos con el mismo valor (y el mismo artículo)
// van juntos. Va en `medida`, que ya muestran la bandeja de Costura, la solicitud y los PDF.
function resumenPorTalle(filas, unidad, nombreLinea) {
  const etiqueta = (x) => [x.articulo && x.articulo !== nombreLinea ? x.articulo : null, x.valor != null ? `${num(x.valor)} ${unidad}` : null].filter(Boolean).join(' ');
  const grupos = [];
  for (const x of filas) {
    const e = etiqueta(x);
    const ult = grupos[grupos.length - 1];
    if (ult && ult.e === e) ult.hasta = x.talle; else grupos.push({ desde: x.talle, hasta: x.talle, e });
  }
  return grupos.map(g => `${g.desde === g.hasta ? g.desde : `${g.desde}–${g.hasta}`} ${g.e}`.trim()).join(' · ');
}

async function fichaProducto(pool, proIdProducto) {
  const pid = parseInt(proIdProducto, 10);
  if (!pid) return null;
  const ex = (await pool.request().query(`SELECT OBJECT_ID('dbo.ProductoFichaDiseno','U') AS f, OBJECT_ID('dbo.ProductoAvios','U') AS a, OBJECT_ID('dbo.ProductoFichaDisenoCosturas','U') AS c,
                                                 OBJECT_ID('dbo.ProductoFichaDisenoExtra','U') AS e, OBJECT_ID('dbo.ProductoFichaDisenoAnotaciones','U') AS n, OBJECT_ID('dbo.CosturasISO','U') AS iso,
                                                 COL_LENGTH('dbo.ProductoFichaDisenoCosturas','MaquinaCosturaID') AS paso,
                                                 COL_LENGTH('dbo.ProductoAvios','VariaPorTalle') AS vt, OBJECT_ID('dbo.ProductoAviosTalle','U') AS at,
                                                 COL_LENGTH('dbo.ProductoFichaDisenoCosturas','AvioID') AS ca, OBJECT_ID('dbo.CatalogoAvios','U') AS cat`)).recordset[0];
  // [PASO A PASO] etapa, máquina, piezas, tiempo, observaciones e imagen (configurador_costuras_paso_a_paso.sql)
  const paso = ex.c && ex.iso && ex.paso != null;
  // [AVÍOS POR TALLE] valor de cada talle y avío de cada paso (configurador_ficha_avios_talle.sql)
  const talle = ex.a && ex.vt != null && ex.at && ex.ca != null && ex.cat;
  const rq = () => pool.request().input('PID', sql.Int, pid);
  const [f, a, c, e, n, at] = await Promise.all([
    ex.f ? rq().query('SELECT Ref, Marca, Material, Tallas, Marcacion, DibujoUrl FROM dbo.ProductoFichaDiseno WHERE ProIdProducto = @PID') : { recordset: [] },
    ex.a ? rq().query(`SELECT Nombre, Cantidad, Unidad, Medida, Nota, Orden${talle ? ', VariaPorTalle' : ''} FROM dbo.ProductoAvios WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ID`) : { recordset: [] },
    ex.c ? rq().query(`SELECT c.UnionNombre, c.CodigoISO${ex.iso ? ', i.Nombre AS CosturaNombre' : ', NULL AS CosturaNombre'}
                       ${paso ? `, c.Etapa, c.Descripcion, c.TiempoMin, c.Observaciones, COALESCE(c.ImagenUrl, i.ImagenUrl) AS ImagenUrl,
                                 m.Nombre AS Maquina` : ''}
                       ${paso && talle ? ', av.Nombre AS AvioNombre' : ''}
                       FROM dbo.ProductoFichaDisenoCosturas c${ex.iso ? ' LEFT JOIN dbo.CosturasISO i ON i.CodigoISO = c.CodigoISO' : ''}
                       ${paso ? 'LEFT JOIN dbo.MaquinasCostura m ON m.MaquinaCosturaID = c.MaquinaCosturaID' : ''}
                       ${paso && talle ? 'LEFT JOIN dbo.CatalogoAvios av ON av.AvioID = c.AvioID' : ''}
                       WHERE c.ProIdProducto = @PID ORDER BY ISNULL(c.Orden, 999), c.ID`) : { recordset: [] },
    ex.e ? rq().query('SELECT Etiqueta, Valor FROM dbo.ProductoFichaDisenoExtra WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), ExtraID') : { recordset: [] },
    ex.n ? rq().query('SELECT Texto FROM dbo.ProductoFichaDisenoAnotaciones WHERE ProIdProducto = @PID ORDER BY ISNULL(Orden, 999), AnotacionID') : { recordset: [] },
    talle ? rq().query(`SELECT x.AvioOrden, x.Talle, x.Valor, ca.Nombre AS Articulo FROM dbo.ProductoAviosTalle x
                        LEFT JOIN dbo.CatalogoAvios ca ON ca.AvioID = x.AvioID
                        WHERE x.ProIdProducto = @PID ORDER BY x.AvioOrden, ISNULL(x.Orden, 999), x.ID`) : { recordset: [] },
  ]);
  const fd = f.recordset[0] || {};
  const out = {
    ref: t(fd.Ref) || null, marca: t(fd.Marca) || null, material: t(fd.Material) || null, tallas: t(fd.Tallas) || null, marcacion: t(fd.Marcacion) || null,
    dibujoUrl: t(fd.DibujoUrl) || null,
    avios: a.recordset.map(x => {
      const unidad = t(x.Unidad) || 'u';
      const porTalle = x.VariaPorTalle
        ? at.recordset.filter(r => r.AvioOrden === x.Orden).map(r => ({ talle: t(r.Talle), valor: r.Valor != null ? Number(r.Valor) : null, articulo: t(r.Articulo) || null }))
        : [];
      return {
        nombre: t(x.Nombre), cantidad: x.Cantidad, unidad,
        medida: porTalle.length ? resumenPorTalle(porTalle, unidad, t(x.Nombre)) : (t(x.Medida) || null),
        nota: t(x.Nota) || null,
        porTalle,   // para la tabla avío × talle del PDF
      };
    }),
    costuras: c.recordset.map(x => ({
      union: t(x.UnionNombre), codigoISO: t(x.CodigoISO), nombre: t(x.CosturaNombre) || null,
      etapa: t(x.Etapa) || null, piezas: t(x.Descripcion) || null, maquina: t(x.Maquina) || null,
      tiempoMin: x.TiempoMin != null ? Number(x.TiempoMin) : null, observaciones: t(x.Observaciones) || null, imagenUrl: t(x.ImagenUrl) || null,
      avio: t(x.AvioNombre) || null,
    })),
    notas: [...e.recordset.map(x => ({ etiqueta: t(x.Etiqueta), valor: t(x.Valor) })), ...n.recordset.map(x => ({ etiqueta: null, valor: t(x.Texto) }))].filter(x => x.valor),
  };
  const vacia = !out.material && !out.tallas && !out.marcacion && !out.dibujoUrl && !out.avios.length && !out.costuras.length && !out.notas.length;
  return vacia ? null : out;
}

// El dibujo como data URI para el PDF (puppeteer arma la página con setContent: no resuelve /uploads).
function dibujoDataUri(dibujoUrl) {
  try {
    if (!dibujoUrl) return null;
    let ruta = null;
    if (dibujoUrl.startsWith('/uploads/')) ruta = require('../utils/rutasUploads').urlUploadsADisco(dibujoUrl); // UPLOADS_PATH
    // [PASO A PASO] esquemas de costura ISO: van con el frontend (build en backend/public; fuente en public/)
    else if (/^\/costuras-iso\/[\w.-]+$/.test(dibujoUrl)) {
      ruta = [path.join(__dirname, '..', 'public', dibujoUrl), path.join(__dirname, '..', '..', 'public', dibujoUrl)].find(r => fs.existsSync(r)) || null;
    }
    if (!ruta || !fs.existsSync(ruta)) return null;
    const ext = path.extname(ruta).slice(1).toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
    return `data:${mime};base64,${fs.readFileSync(ruta).toString('base64')}`;
  } catch (_) { return null; }
}

module.exports = { fichaProducto, dibujoDataUri };
