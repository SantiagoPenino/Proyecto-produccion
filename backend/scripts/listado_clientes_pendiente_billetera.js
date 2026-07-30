// SOLO LECTURA — listado de todos los clientes con Pendiente (deuda viva) y
// Billetera (saldo a favor) en ambas monedas, más el tipo de cliente.
//
// Misma lógica de dedup que usa el Panel 360 (getResumenDocumentos/calcPendiente
// en contabilidadService.js) para el pendiente, y la misma fórmula de saldo en
// vivo (getSaldoCliente) para la billetera — NO se usa CueSaldoActual cacheado.
//
// Uso: node scripts/listado_clientes_pendiente_billetera.js
// Salida: scripts/listado_clientes_pendiente_billetera.csv (; delimitado, es-UY)
const fs = require('fs');
const path = require('path');
const { sql, getPool } = require(path.resolve(__dirname, '../config/db.js'));

const money = n => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  try {
    const pool = await getPool();

    // 1) Clientes con cuenta contable + tipo de cliente
    const clientesRes = await pool.request().query(`
      SELECT c.CliIdCliente,
             RTRIM(ISNULL(c.NombreFantasia, c.Nombre)) AS Cliente,
             RTRIM(c.IDCliente) AS IDCliente,
             ISNULL(RTRIM(tc.TClDescripcion), 'Sin tipo') AS Tipo
      FROM dbo.Clientes c
      LEFT JOIN dbo.TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
      WHERE EXISTS (SELECT 1 FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = c.CliIdCliente)
      ORDER BY Cliente
    `);

    // 2) Pendiente por cliente/moneda — mismo dedup que calcPendiente() en contabilidadService.js
    const pendienteRes = await pool.request().query(`
      ;WITH docs AS (
        SELECT dc.CliIdCliente, dc.DocEstado, dc.DocPagado,
               CAST(dc.DocTotal AS DECIMAL(18,2)) AS DocTotal,
               dc.MonIdMoneda, pv.PendVivo, pv.OrigVivo
        FROM dbo.DocumentosContables dc WITH(NOLOCK)
        OUTER APPLY (
          SELECT TOP 1 dd.DDeImportePendiente AS PendVivo, dd.DDeImporteOriginal AS OrigVivo
          FROM dbo.DeudaDocumento dd WITH(NOLOCK)
          WHERE dd.DocIdDocumento = dc.DocIdDocumento
            AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA','PAGADO','CANCELADO','ANULADO')
          ORDER BY CASE WHEN ABS(dd.DDeImporteOriginal - dc.DocTotal) <= 2.0 THEN 0 ELSE 1 END,
                   dd.DDeImportePendiente ASC, ABS(dd.DDeImporteOriginal - dc.DocTotal) ASC, dd.DDeIdDocumento
        ) pv
        WHERE dc.DocTipo NOT LIKE '%ecibo%' AND dc.DocTipo NOT LIKE '%greso%'
      ),
      calc AS (
        SELECT CliIdCliente, MonIdMoneda,
          CASE
            WHEN DocEstado LIKE '%ANULAD%' THEN 0
            WHEN PendVivo IS NOT NULL THEN
              CASE WHEN PendVivo < 0 THEN 0
                   WHEN PendVivo > ISNULL(OrigVivo, DocTotal) THEN ISNULL(OrigVivo, DocTotal)
                   ELSE PendVivo END
            WHEN DocPagado = 1 THEN 0
            ELSE ISNULL(OrigVivo, DocTotal)
          END AS Pendiente
        FROM docs
      )
      SELECT CliIdCliente, MonIdMoneda, SUM(Pendiente) AS PendienteTotal
      FROM calc
      WHERE Pendiente > 0.01
      GROUP BY CliIdCliente, MonIdMoneda
    `);

    // 3) Billetera (saldo a favor) por cliente/moneda — saldo EN VIVO de las cuentas
    // de dinero (misma fórmula que getSaldoCliente/ClienteBilletera, no el campo cacheado)
    const billeteraRes = await pool.request().query(`
      SELECT cc.CliIdCliente, cc.MonIdMoneda,
             SUM(ISNULL(mv.Saldo, 0)) AS Billetera
      FROM dbo.CuentasCliente cc
      OUTER APPLY (
        SELECT SUM(m.MovImporte) AS Saldo
        FROM dbo.MovimientosCuenta m WITH(NOLOCK)
        WHERE m.CueIdCuenta = cc.CueIdCuenta
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
          AND m.MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')
      ) mv
      WHERE cc.CueTipo IN ('DINERO_UYU', 'DINERO_USD')
      GROUP BY cc.CliIdCliente, cc.MonIdMoneda
    `);

    const pendMap = new Map(); // CliIdCliente -> { 1: total, 2: total }
    for (const r of pendienteRes.recordset) {
      const m = pendMap.get(r.CliIdCliente) || {};
      m[r.MonIdMoneda] = Number(r.PendienteTotal) || 0;
      pendMap.set(r.CliIdCliente, m);
    }
    const billMap = new Map();
    for (const r of billeteraRes.recordset) {
      const m = billMap.get(r.CliIdCliente) || {};
      m[r.MonIdMoneda] = Number(r.Billetera) || 0;
      billMap.set(r.CliIdCliente, m);
    }

    const filas = clientesRes.recordset.map(c => {
      const pend = pendMap.get(c.CliIdCliente) || {};
      const bill = billMap.get(c.CliIdCliente) || {};
      return {
        Cliente: c.Cliente,
        IDCliente: c.IDCliente,
        Tipo: c.Tipo,
        'Pendiente $': pend[1] || 0,
        'Pendiente US$': pend[2] || 0,
        'Billetera $': bill[1] || 0,
        'Billetera US$': bill[2] || 0,
      };
    });

    const header = 'Cliente;IDCliente;Tipo;Pendiente $;Pendiente US$;Billetera $;Billetera US$';
    const lines = filas.map(f =>
      [f.Cliente, f.IDCliente, f.Tipo, money(f['Pendiente $']), money(f['Pendiente US$']), money(f['Billetera $']), money(f['Billetera US$'])].join(';')
    );
    const csv = [header, ...lines].join('\n');
    const outPath = path.resolve(__dirname, 'listado_clientes_pendiente_billetera.csv');
    fs.writeFileSync(outPath, csv, 'utf8');

    console.log(`Listado generado: ${filas.length} clientes -> ${outPath}`);
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
