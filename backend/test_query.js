require('dotenv').config();
const mssql = require('mssql');

async function run() {
  await mssql.connect({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: { encrypt: false, trustServerCertificate: true }
  });

  const m = await mssql.query(`
      SELECT m.MovIdMovimiento, m.MovTipo, m.MovConcepto, m.MovImporte, m.MovFecha,
             m.OrdIdOrden, m.OReIdOrdenRetiro, m.PagIdPago, m.MovObservaciones, m.DocIdDocumento,
             COALESCE(od.OrdCodigoOrden, erp.CodigoOrden) AS OrdCodigoOrden,
             COALESCE(od.OrdNombreTrabajo, erp.DescripcionTrabajo) AS OrdNombreTrabajo,
             ISNULL(od.OrdCantidad, 1) AS OrdCantidad,
             ISNULL(od.OrdDescuentoAplicado, 0) AS OrdDescuentoAplicado,
             od.OrdMaterialPlanilla,
             p.Descripcion AS ProNombre,
             s.Articulo AS ProSubFamilia,
             s.CodStock AS ProCodStock,
              (
                 SELECT d.ID AS DetalleID, a.CodArticulo, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.LogPrecioAplicado, a.Descripcion, pc.Moneda, a.CodStock, sa.Articulo AS ArticuloNombre
                 FROM SecureAppDB.dbo.PedidosCobranza pc WITH(NOLOCK)
                 JOIN SecureAppDB.dbo.PedidosCobranzaDetalle d WITH(NOLOCK) ON pc.ID = d.PedidoCobranzaID
                 LEFT JOIN SecureAppDB.dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = d.ProIdProducto
                 LEFT JOIN SecureAppDB.dbo.StockArt sa WITH(NOLOCK) ON a.CodStock = sa.CodStock
                 WHERE LTRIM(RTRIM(pc.NoDocERP)) = COALESCE(od.OrdCodigoOrden, erp.CodigoOrden)
                 FOR JSON PATH
              ) AS DetallesJSON
      FROM SecureAppDB.dbo.MovimientosCuenta m WITH(NOLOCK)
      LEFT JOIN SecureAppDB.dbo.OrdenesDeposito od WITH(NOLOCK) ON m.OrdIdOrden = od.OrdIdOrden
      LEFT JOIN SecureAppDB.dbo.Ordenes erp WITH(NOLOCK) ON erp.OrdenID = m.OrdIdOrden
      LEFT JOIN SecureAppDB.dbo.Articulos p WITH(NOLOCK) ON od.ProIdProducto = p.ProIdProducto
      LEFT JOIN SecureAppDB.dbo.StockArt s WITH(NOLOCK) ON p.CodStock = s.CodStock
      WHERE m.CueIdCuenta = 64
        AND m.MovTipo = 'ORDEN'
        AND m.DocIdDocumento IS NULL
  `);
  console.log("MOVS:", JSON.stringify(m.recordset, null, 2));

  mssql.close();
}
run();
