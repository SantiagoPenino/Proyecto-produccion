'use strict';
// Catálogos que usa el ingreso de pedidos por sistema. Son las MISMAS consultas que ya usa
// /ventas/pedido-prenda (routes/nomenclatorsRoutes.js): acá no se define ningún catálogo nuevo.
const { sql } = require('../../config/db');

// Igual que GET /api/nomenclators/materials/:areaId/:variante
async function materialesDe(pool, areaId, variante) {
  const r = await pool.request()
    .input('AreaID', sql.VarChar, areaId)
    .input('Variante', sql.NVarChar, variante)
    .query(`
      SELECT dbo.articulos.CodArticulo, dbo.articulos.CodStock, dbo.articulos.Descripcion AS Material,
             dbo.articulos.anchoimprimible AS Ancho, dbo.articulos.largoimprimible AS Largo
      FROM dbo.StockArt
      INNER JOIN dbo.articulos ON dbo.StockArt.CodStock = dbo.articulos.CodStock
      LEFT JOIN dbo.ConfigMapeoERP ON dbo.ConfigMapeoERP.CodigoERP = dbo.StockArt.Grupo
      WHERE (
              (dbo.ConfigMapeoERP.AreaID_Interno = @AreaID AND LTRIM(RTRIM(dbo.StockArt.Articulo)) = LTRIM(RTRIM(@Variante)))
              OR (LTRIM(RTRIM(dbo.StockArt.CodStock)) = LTRIM(RTRIM(@Variante)))
            )
        AND ISNULL(dbo.StockArt.mostrar, 1) = 1
        AND ISNULL(dbo.articulos.mostrar, 1) = 1
      ORDER BY dbo.articulos.Descripcion`);
  return r.recordset;
}

const limpio = (s) => String(s ?? '').trim();

// Busca el material pedido dentro del catálogo: primero por código, después por nombre exacto.
function buscarMaterial(lista, pedido) {
  if (!pedido) return null;
  const cod = limpio(pedido.codArticulo);
  const nombre = limpio(pedido.nombre).toLowerCase();
  return (cod && lista.find(m => limpio(m.CodArticulo) === cod))
      || (nombre && lista.find(m => limpio(m.Material).toLowerCase() === nombre))
      || null;
}

// Copia de resolveMaterialWidth de src/client-portal/modulos/PrendaOrderForm.jsx:164 —
// ancho imprimible del material: campo Ancho; si no, el número del nombre; si no, 1,83.
function anchoDeMaterial(matObj) {
  if (!matObj) return 1.83;
  if (matObj.Ancho !== undefined && matObj.Ancho !== null) {
    const raw = typeof matObj.Ancho === 'string' ? parseFloat(matObj.Ancho.replace(',', '.')) : parseFloat(matObj.Ancho);
    if (!isNaN(raw) && raw > 0) return raw;
  }
  const nombre = matObj.Material || matObj.Descripcion || '';
  if (nombre) {
    const paren = nombre.match(/\((\d+(?:[.,]\d+)?)(?:\s*m)?/);
    if (paren) { const n = parseFloat(paren[1].replace(',', '.')); if (!isNaN(n) && n > 0) return n; }
    const num = nombre.match(/(\d+(?:[.,]\d+)+)/);
    if (num) { const n = parseFloat(num[1].replace(',', '.')); if (!isNaN(n) && n > 0) return n; }
  }
  return 1.83;
}

// Bobinas de tela que el cliente entregó y todavía tienen metros. Misma consulta que
// inventoryController.getBovinasDisponibles (GET /api/inventory/tela-cliente/disponible).
async function bobinasDe(pool, cliente) {
  const r = await pool.request()
    .input('CID', sql.VarChar(50), String(cliente.CliIdCliente ?? ''))
    .input('CliStr', sql.NVarChar(255), String(cliente.IDCliente || '').trim() || null)
    .query(`
      SELECT ib.BobinaID, ib.CodigoEtiqueta, ib.MetrosRestantes, ib.Ancho, ib.AnchoReal, ib.FechaIngreso, ib.Referencia,
             COALESCE(NULLIF(ib.DescripcionTela, ''), ins.Nombre) AS DescripcionTela
      FROM InventarioBobinas ib
      JOIN Insumos ins ON ins.InsumoID = ib.InsumoID
      WHERE ( TRY_CAST(ib.ClienteID AS INT) = TRY_CAST(@CID AS INT)
              OR (@CliStr IS NOT NULL AND LTRIM(RTRIM(ib.ClienteID)) = @CliStr) )
        AND ib.Estado = 'Disponible'
        AND ib.MetrosRestantes > 0.5
      ORDER BY ib.FechaIngreso ASC`);
  return r.recordset;
}

module.exports = { materialesDe, buscarMaterial, anchoDeMaterial, bobinasDe };
