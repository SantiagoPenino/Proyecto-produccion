const { getPool } = require('../config/db');

async function run() {
    const pool = await getPool();

    // Buscar todas las columnas NOT NULL sin DEFAULT en tablas clave que el backend inserta
    const tablasImportantes = [
        'MovimientosCuenta', 'PedidosCobranzaDetalle', 'PedidosCobranza',
        'CuentasCliente', 'CiclosCuenta', 'DeudaDocumento', 'Pagos',
        'OrdenesDeposito', 'Ordenes', 'PlanesMetros', 'PerfilesItems'
    ];

    console.log('\n=== COLUMNAS NOT NULL SIN DEFAULT en tablas clave ===');
    for (const tabla of tablasImportantes) {
        const cols = await pool.request().query(`
            SELECT '${tabla}' as Tabla, c.name AS Columna, t.name AS Tipo
            FROM sys.columns c
            INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
            LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
            WHERE c.object_id = OBJECT_ID('${tabla}')
              AND c.is_nullable = 0
              AND c.is_identity = 0       -- excluir PKs autoincrementales
              AND dc.definition IS NULL    -- sin default
              AND c.name NOT IN ('ID', 'MovIdMovimiento', 'OrdIdOrden', 'PedidoCobranzaID') -- excluir PKs obvias
            ORDER BY c.column_id
        `);
        if (cols.recordset.length > 0) {
            cols.recordset.forEach(r => console.log(`  ⚠️  ${r.Tabla}.${r.Columna} (${r.Tipo}) — NOT NULL sin DEFAULT`));
        }
    }

    console.log('\nDone.');
    process.exit(0);
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
