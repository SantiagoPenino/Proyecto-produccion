const sql = require('mssql');
const fs = require('fs');
const path = require('path');

const config = {
    user: 'sa', 
    password: '2441', 
    server: 'localhost', 
    database: 'SecureAppDB_Vieja',
    options: { encrypt: false, trustServerCertificate: true }
};

function formatValue(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? '1' : '0';  // BIT columns
    if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
    if (val instanceof Date) return `'${val.toISOString()}'`;
    return val;
}

async function generateScript() {
    try {
        const pool = await new sql.ConnectionPool(config).connect();
        let out = `USE [SecureAppDB];\nGO\n\n`;
        out += `EXEC sp_msforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL';\n\n`;
        
        out += `-- ==========================================\n`;
        out += `-- PARCHE: AGREGAR VALOR POR DEFECTO A CAJA\n`;
        out += `-- ==========================================\n`;
        out += `IF NOT EXISTS (SELECT * FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID('SesionesTurno') AND parent_column_id = COLUMNPROPERTY(OBJECT_ID('SesionesTurno'), 'StuFechaApertura', 'ColumnId'))\n`;
        out += `BEGIN\n`;
        out += `    ALTER TABLE [dbo].[SesionesTurno] ADD CONSTRAINT DF_SesionesTurno_FechaApertura DEFAULT (GETDATE()) FOR [StuFechaApertura];\n`;
        out += `END\n\n`;

        out += `-- ==========================================\n`;
        out += `-- LIMPIAR TABLAS\n`;
        out += `-- ==========================================\n`;
        out += `DELETE FROM [PreciosEspecialesItems];\n`;
        out += `DELETE FROM [PreciosEspeciales];\n`;
        out += `DELETE FROM [PerfilesPrecios];\n`;
        out += `DELETE FROM [PreciosBase];\n`;
        out += `DELETE FROM [Articulos];\n`;
        out += `DELETE FROM [MetodosPagos];\n\n`;

        // 1. ARTICULOS
        console.log('Generando Articulos...');
        const art = await pool.request().query("SELECT ProIdProducto, LTRIM(RTRIM(CodArticulo)) as CodArticulo, IDProdReact, SupFlia, Grupo, CodStock, Descripcion, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda, ProCodigoOdooProducto, UniIdUnidad, borrar FROM Articulos WHERE LTRIM(RTRIM(CodArticulo)) <> ''");
        if(art.recordset.length > 0) {
            out += `SET IDENTITY_INSERT [Articulos] ON;\n`;
            for(let r of art.recordset) {
                out += `INSERT INTO [Articulos] (ProIdProducto, CodArticulo, IDProdReact, SupFlia, Grupo, CodStock, Descripcion, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda, ProCodigoOdooProducto, UniIdUnidad, borrar) VALUES (${formatValue(r.ProIdProducto)}, ${formatValue(r.CodArticulo)}, ${formatValue(r.IDProdReact)}, ${formatValue(r.SupFlia)}, ${formatValue(r.Grupo)}, ${formatValue(r.CodStock)}, ${formatValue(r.Descripcion)}, ${formatValue(r.Mostrar)}, ${formatValue(r.anchoimprimible)}, ${formatValue(r.LLEVAPAPEL)}, ${formatValue(r.MonIdMoneda)}, ${formatValue(r.ProCodigoOdooProducto)}, ${formatValue(r.UniIdUnidad)}, ${formatValue(r.borrar)});\n`;
            }
            out += `SET IDENTITY_INSERT [Articulos] OFF;\n\n`;
        }

        // 2. PRECIOS BASE
        console.log('Generando PreciosBase...');
        const pb = await pool.request().query(`
            SELECT pb.ProIdProducto, LTRIM(RTRIM(a.CodArticulo)) as CodArticulo, pb.Precio, 
            CASE WHEN ISNULL(pb.MonIdMoneda, 2) = 1 THEN 'UYU' ELSE 'USD' END as Moneda, 
            ISNULL(pb.MonIdMoneda, 2) as MonIdMoneda, pb.UltimaActualizacion
            FROM PreciosBase pb
            INNER JOIN Articulos a ON pb.ProIdProducto = a.ProIdProducto
        `);
        if(pb.recordset.length > 0) {
            for(let r of pb.recordset) {
                out += `INSERT INTO [PreciosBase] (ProIdProducto, CodArticulo, Precio, Moneda, MonIdMoneda, UltimaActualizacion) VALUES (${formatValue(r.ProIdProducto)}, ${formatValue(r.CodArticulo)}, ${formatValue(r.Precio)}, ${formatValue(r.Moneda)}, ${formatValue(r.MonIdMoneda)}, ${formatValue(r.UltimaActualizacion)});\n`;
            }
            out += `\n`;
        }

        // 3. PERFILES PRECIOS
        console.log('Generando PerfilesPrecios...');
        const perf = await pool.request().query("SELECT ID, Nombre, Descripcion, Activo, EsGlobal, Categoria FROM PerfilesPrecios");
        if(perf.recordset.length > 0) {
            out += `SET IDENTITY_INSERT [PerfilesPrecios] ON;\n`;
            for(let r of perf.recordset) {
                out += `INSERT INTO [PerfilesPrecios] (ID, Nombre, Descripcion, Activo, EsGlobal, Categoria) VALUES (${formatValue(r.ID)}, ${formatValue(r.Nombre)}, ${formatValue(r.Descripcion)}, ${formatValue(r.Activo)}, ${formatValue(r.EsGlobal)}, ${formatValue(r.Categoria)});\n`;
            }
            out += `SET IDENTITY_INSERT [PerfilesPrecios] OFF;\n\n`;
        }

        // 4. PRECIOS ESPECIALES
        console.log('Generando PreciosEspeciales...');
        const pe = await pool.request().query("SELECT ID, FechaCreacion, UltimaActualizacion, PerfilID, PerfilesIDs, CliIdCliente, ISNULL(CliIdCliente, 0) as ClienteID FROM PreciosEspeciales");
        if(pe.recordset.length > 0) {
            out += `SET IDENTITY_INSERT [PreciosEspeciales] ON;\n`;
            for(let r of pe.recordset) {
                out += `INSERT INTO [PreciosEspeciales] (ID, FechaCreacion, UltimaActualizacion, PerfilID, PerfilesIDs, CliIdCliente, ClienteID) VALUES (${formatValue(r.ID)}, ${formatValue(r.FechaCreacion)}, ${formatValue(r.UltimaActualizacion)}, ${formatValue(r.PerfilID)}, ${formatValue(r.PerfilesIDs)}, ${formatValue(r.CliIdCliente)}, ${formatValue(r.ClienteID)});\n`;
            }
            out += `SET IDENTITY_INSERT [PreciosEspeciales] OFF;\n\n`;
        }

        // 5. PRECIOS ESPECIALES ITEMS
        console.log('Generando PreciosEspecialesItems...');
        const pei = await pool.request().query(`
            SELECT pi.ItemID, pi.TipoRegla, pi.Valor, pi.MonIdMoneda, pi.MinCantidad, pi.ProIdProducto, pi.CliIdCliente, pi.CodGrupo,
            ISNULL(pi.CliIdCliente, 0) as ClienteID, ISNULL(LTRIM(RTRIM(a.CodArticulo)), 'GENERAL') as CodArticulo
            FROM PreciosEspecialesItems pi
            LEFT JOIN Articulos a ON pi.ProIdProducto = a.ProIdProducto
        `);
        if(pei.recordset.length > 0) {
            out += `SET IDENTITY_INSERT [PreciosEspecialesItems] ON;\n`;
            for(let r of pei.recordset) {
                out += `INSERT INTO [PreciosEspecialesItems] (ItemID, TipoRegla, Valor, MonIdMoneda, MinCantidad, ProIdProducto, CliIdCliente, CodGrupo, ClienteID, CodArticulo) VALUES (${formatValue(r.ItemID)}, ${formatValue(r.TipoRegla)}, ${formatValue(r.Valor)}, ${formatValue(r.MonIdMoneda)}, ${formatValue(r.MinCantidad)}, ${formatValue(r.ProIdProducto)}, ${formatValue(r.CliIdCliente)}, ${formatValue(r.CodGrupo)}, ${formatValue(r.ClienteID)}, ${formatValue(r.CodArticulo)});\n`;
            }
            out += `SET IDENTITY_INSERT [PreciosEspecialesItems] OFF;\n\n`;
        }

        // 6. METODOS DE PAGO
        console.log('Generando MetodosPagos...');
        const mp = await pool.request().query(`SELECT MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo FROM MetodosPagos`);
        if(mp.recordset.length > 0) {
            out += `-- ==========================================\n`;
            out += `-- METODOS DE PAGO\n`;
            out += `-- ==========================================\n`;
            out += `SET IDENTITY_INSERT [MetodosPagos] ON;\n`;
            for(let r of mp.recordset) {
                out += `INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (${formatValue(r.MPaIdMetodoPago)}, ${formatValue(r.MPaDescripcionMetodo)}, ${formatValue(r.MPaActivo)});\n`;
            }
            out += `SET IDENTITY_INSERT [MetodosPagos] OFF;\n\n`;
        }

        out += `EXEC sp_msforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL';\nGO\n`;

        fs.writeFileSync(path.join(__dirname, 'migracion_produccion.sql'), out, 'utf8');
        console.log('SCRIPT GENERADO CORRECTAMENTE: migracion_produccion.sql');
        
        await pool.close();
    } catch(err) {
        console.error('Error:', err);
    }
}

run();
function run() { generateScript(); }
