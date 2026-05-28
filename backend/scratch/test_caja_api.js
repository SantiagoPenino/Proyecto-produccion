require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mssql = require('mssql');

async function run() {
  try {
    const dbName = process.env.DB_DATABASE || 'SecureAppDB';
    await mssql.connect({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: dbName,
      options: { encrypt: false, trustServerCertificate: true }
    });

    console.log("Connected successfully to DB:", dbName);

    // 1. Get open sessions
    const sR = await mssql.query(`SELECT StuIdSesion, StuFechaApertura FROM dbo.SesionesTurno WITH(NOLOCK) WHERE StuEstado = 'ABIERTA' ORDER BY StuFechaApertura DESC`);
    console.log("Open sessions count:", sR.recordset.length);
    console.log("Open sessions:", sR.recordset);

    if (sR.recordset.length > 0) {
      const sid = sR.recordset[0].StuIdSesion;
      console.log(`Using StuIdSesion = ${sid} to fetch movements...`);

      // 2. Query movements
      const movs = await mssql.query(`
        SELECT 
          'INGRESO' as TipoOperacion,
          t.TcaFecha as Fecha,
          ISNULL(ct1.Detalle, t.TcaTipoDocumento) as TipoComprobante,
          ISNULL(t.TcaSerieDoc,'') + '-' + ISNULL(t.TcaNumeroDoc,'Pendiente') as Comprobante,
          ISNULL(NULLIF(t.TcaObservaciones, ''), 'Cobro Mostrador') + 
          CASE WHEN c.Nombre IS NOT NULL THEN ' (' + RTRIM(c.Nombre) + ')' ELSE '' END +
          COALESCE(' [' + (
            SELECT STRING_AGG(RTRIM(td.TdeCodigoReferencia), ', ') 
            FROM dbo.TransaccionDetalle td WITH(NOLOCK) 
            WHERE td.TcaIdTransaccion = t.TcaIdTransaccion AND td.TdeCodigoReferencia IS NOT NULL AND td.TdeCodigoReferencia <> ''
          ) + ']', '') as Concepto,
          mp.MPaDescripcionMetodo as MedioDePago,
          CASE WHEN p.PagIdMonedaPago = 2 THEN 'USD' ELSE 'UYU' END as Moneda,
          p.PagMontoPago as Entrada,
          0 as Salida,
          COALESCE(u.Nombre, u.Usuario, 'Sistema') as Usuario
        FROM dbo.TransaccionesCaja t WITH(NOLOCK)
        JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
        LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
        LEFT JOIN dbo.Config_TiposDocumento ct1 WITH(NOLOCK) ON ct1.CodDocumento = t.TcaTipoDocumento
        LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = t.TcaClienteId
        LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = t.TcaUsuarioId
        WHERE t.StuIdSesion = ${sid} AND t.TcaEstado IN ('COMPLETADO', 'COMPLETADA', 'COBRADO') AND p.PagTipoMovimiento != 'ANULADO'
        UNION ALL
        SELECT 
          'EGRESO' as TipoOperacion,
          e.EgrFecha as Fecha,
          ISNULL(ct2.Detalle, e.EgrTipoDocumento) as TipoComprobante,
          ISNULL(e.EgrSerieDoc,'') + '-' + ISNULL(e.EgrNumeroDoc,'Pendiente') as Comprobante,
          e.EgrConcepto + CASE WHEN e.EgrProveedor IS NOT NULL AND e.EgrProveedor != '' THEN ' (' + e.EgrProveedor + ')' ELSE '' END as Concepto,
          mp.MPaDescripcionMetodo as MedioDePago,
          e.EgrMoneda as Moneda,
          0 as Entrada,
          e.EgrMonto as Salida,
          COALESCE(u.Nombre, u.Usuario, 'Sistema') as Usuario
        FROM dbo.EgresosCaja e WITH(NOLOCK)
        LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = e.MPaIdMetodoPago
        LEFT JOIN dbo.Config_TiposDocumento ct2 WITH(NOLOCK) ON ct2.CodDocumento = e.EgrTipoDocumento
        LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = e.EgrUsuarioId
        WHERE e.StuIdSesion = ${sid} AND e.EgrEstado = 'REGISTRADO'
        ORDER BY Fecha ASC
      `);

      console.log(`Found ${movs.recordset.length} movements.`);
      console.log("Movements sample:", movs.recordset);
    } else {
      console.log("No active sessions found. Trying query with fallback...");
      const userSample = await mssql.query(`SELECT TOP 1 * FROM dbo.Usuarios`);
      console.log("User sample columns:", Object.keys(userSample.recordset[0] || {}));
    }

    // 3. Test sequence query for RECIBO_ANTICIPO fallback
    const seqResult = await mssql.query(`
      SELECT
        s.SecUltimoNumero + 1  AS NumeroEntero,
        ISNULL(s.SecPrefijo,'') +
          RIGHT(REPLICATE('0', s.SecDigitos) + CAST(s.SecUltimoNumero+1 AS VARCHAR(10)), s.SecDigitos)
                             AS NumeroFormato,
        s.SecTipoDoc AS TipoDoc,
        s.SecSerie   AS Serie,
        ISNULL(s.SecPrefijo,'') AS Prefijo
      FROM dbo.SecuenciaDocumentos s WITH(NOLOCK)
      WHERE s.SecTipoDoc = 'RECIBO_ANTICIPO' AND s.SecActivo = 1
    `);
    console.log("RECIBO_ANTICIPO Sequence Query Fallback result:", seqResult.recordset);

  } catch (err) {
    console.error("Error running script:", err);
  } finally {
    mssql.close();
  }
}

run();
