const { getPool } = require('./config/db');

async function run() {
  try {
    const pool = await getPool();

    // Primero obtenemos el ProIdProducto del articulo Frontlight Brillo hasta 3.17
    const artQ = await pool.request().query(`
      SELECT ProIdProducto, CodArticulo, Descripcion
      FROM Articulos WITH(NOLOCK)
      WHERE Descripcion LIKE '%Frontlight%Brillo%3.17%'
    `);
    if (artQ.recordset.length === 0) {
      console.log('No se encontro el articulo Frontlight Brillo hasta 3.17');
      process.exit(1);
    }
    const art = artQ.recordset[0];
    const proId = art.ProIdProducto;
    console.log(`\nArticulo encontrado: [${art.CodArticulo}] ${art.Descripcion} — ProIdProducto: ${proId}\n`);

    // ────────────────────────────────────────────────────────────
    // BLOQUE 1 — OrdenesDeposito (Frontlight) con retiro, 48hs
    // ────────────────────────────────────────────────────────────
    console.log('=== BLOQUE 1: OrdenesDeposito de Frontlight con Retiro — ultimas 48hs ===\n');

    const r1 = await pool.request()
      .input('ProId', proId)
      .query(`
        SELECT
          r.OReIdOrdenRetiro                              AS RetiroID,
          r.MonIdMoneda                                   AS MonedaRetiro,
          CAST(r.OReCostoTotalOrden AS DECIMAL(18,2))     AS CostoTotalRetiro,
          r.OReEstadoActual                               AS EstadoRetiro,
          CONVERT(VARCHAR(16), r.OReFechaAlta, 120)       AS FechaRetiro,
          od.OrdCodigoOrden                               AS CodigoOrden,
          LTRIM(RTRIM(od.OrdNombreTrabajo))               AS NombreTrabajo,
          CASE WHEN od.MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END AS MonedaOrden,
          CAST(od.OrdCostoFinal AS DECIMAL(18,2))         AS CostoOrden,
          CONVERT(VARCHAR(10), od.OrdFechaIngresoOrden, 103) AS FechaIngreso,
          LTRIM(RTRIM(ISNULL(c.Nombre,'')))               AS Cliente
        FROM OrdenesDeposito od WITH(NOLOCK)
        INNER JOIN OrdenesRetiro r WITH(NOLOCK) ON r.OReIdOrdenRetiro = od.OReIdOrdenRetiro
        LEFT JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = od.CliIdCliente
        WHERE
          od.ProIdProducto = @ProId
          AND od.MonIdMoneda = 1
          AND od.OrdFechaIngresoOrden >= CAST(DATEADD(day, -2, GETDATE()) AS DATE)
        ORDER BY r.OReFechaAlta DESC
      `);

    if (r1.recordset.length === 0) {
      console.log('OK — Sin ordenes de Frontlight en UYU con retiro.\n');
    } else {
      console.log('ATENCION: ' + r1.recordset.length + ' fila(s):\n');
      console.table(r1.recordset);
    }

    // ────────────────────────────────────────────────────────────
    // BLOQUE 2 — PedidosCobranzaDetalle (Frontlight) con retiro
    // ────────────────────────────────────────────────────────────
    console.log('=== BLOQUE 2: PedidosCobranzaDetalle de Frontlight en UYU con Retiro ===\n');

    const r2 = await pool.request()
      .input('ProId', proId)
      .query(`
        SELECT
          pc.NoDocERP                                     AS NroCotizacion,
          pc.Moneda                                       AS MonedaCabecera,
          CONVERT(VARCHAR(16), pc.FechaGeneracion, 120)   AS FechaCotizacion,
          pcd.ID                                          AS LineaID,
          pcd.Moneda                                      AS MonedaLinea,
          pcd.MonedaOriginal                              AS MonedaOriginal,
          CAST(pcd.PrecioUnitario AS DECIMAL(18,2))       AS PrecioUnit,
          CAST(pcd.Subtotal AS DECIMAL(18,2))             AS Subtotal,
          o.CodigoOrden                                   AS CodigoOrden,
          LTRIM(RTRIM(ISNULL(cli.Nombre,'')))             AS Cliente,
          r.OReIdOrdenRetiro                              AS RetiroID,
          r.OReEstadoActual                               AS EstadoRetiro,
          r.MonIdMoneda                                   AS MonedaRetiro,
          CAST(r.OReCostoTotalOrden AS DECIMAL(18,2))     AS CostoTotalRetiro
        FROM PedidosCobranzaDetalle pcd WITH(NOLOCK)
        INNER JOIN PedidosCobranza pc WITH(NOLOCK) ON pc.ID = pcd.PedidoCobranzaID
        LEFT JOIN Ordenes o WITH(NOLOCK) ON o.OrdenID = pcd.OrdenID
        LEFT JOIN Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = pc.ClienteID
        INNER JOIN OrdenesDeposito od WITH(NOLOCK)
          ON LTRIM(RTRIM(od.OrdCodigoOrden)) = LTRIM(RTRIM(o.CodigoOrden))
        INNER JOIN OrdenesRetiro r WITH(NOLOCK) ON r.OReIdOrdenRetiro = od.OReIdOrdenRetiro
        WHERE
          pcd.ProIdProducto = @ProId
          AND (pcd.Moneda = 'UYU' OR pcd.MonedaOriginal = 'UYU')
          AND pc.FechaGeneracion >= CAST(DATEADD(day, -2, GETDATE()) AS DATE)
        ORDER BY pc.FechaGeneracion DESC, pcd.ID
      `);

    if (r2.recordset.length === 0) {
      console.log('OK — Sin lineas de Frontlight en UYU con retiro.\n');
    } else {
      console.log('ATENCION: ' + r2.recordset.length + ' linea(s):\n');
      console.table(r2.recordset);
    }

    // ────────────────────────────────────────────────────────────
    // BLOQUE 3 — PedidosCobranzaDetalle (Frontlight) SIN retiro
    // ────────────────────────────────────────────────────────────
    console.log('=== BLOQUE 3: PedidosCobranzaDetalle de Frontlight en UYU SIN Retiro ===\n');

    const r3 = await pool.request()
      .input('ProId', proId)
      .query(`
        SELECT
          pc.NoDocERP                                     AS NroCotizacion,
          pc.Moneda                                       AS MonedaCabecera,
          CONVERT(VARCHAR(16), pc.FechaGeneracion, 120)   AS FechaCotizacion,
          pcd.ID                                          AS LineaID,
          pcd.Moneda                                      AS MonedaLinea,
          CAST(pcd.PrecioUnitario AS DECIMAL(18,2))       AS PrecioUnit,
          CAST(pcd.Subtotal AS DECIMAL(18,2))             AS Subtotal,
          o.CodigoOrden                                   AS CodigoOrden,
          LTRIM(RTRIM(ISNULL(cli.Nombre,'')))             AS Cliente
        FROM PedidosCobranzaDetalle pcd WITH(NOLOCK)
        INNER JOIN PedidosCobranza pc WITH(NOLOCK) ON pc.ID = pcd.PedidoCobranzaID
        LEFT JOIN Ordenes o WITH(NOLOCK) ON o.OrdenID = pcd.OrdenID
        LEFT JOIN Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = pc.ClienteID
        LEFT JOIN OrdenesDeposito od WITH(NOLOCK)
          ON LTRIM(RTRIM(od.OrdCodigoOrden)) = LTRIM(RTRIM(o.CodigoOrden))
        WHERE
          pcd.ProIdProducto = @ProId
          AND (pcd.Moneda = 'UYU' OR pcd.MonedaOriginal = 'UYU')
          AND pc.FechaGeneracion >= CAST(DATEADD(day, -2, GETDATE()) AS DATE)
          AND od.OrdIdOrden IS NULL
        ORDER BY pc.FechaGeneracion DESC, pcd.ID
      `);

    if (r3.recordset.length === 0) {
      console.log('OK — Sin lineas de Frontlight en UYU sin retiro.\n');
    } else {
      console.log('INFO: ' + r3.recordset.length + ' linea(s) sin retiro:\n');
      console.table(r3.recordset);
    }

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

run();
