const { sql, getPool } = require('./config/db');

(async () => {
    try {
        const pool = await getPool();

        // Primero verificamos qué hay en ProIdProducto=478 y en CodArticulo=312
        const check = await pool.request().query(`
            SELECT ProIdProducto, CodArticulo, IDProdReact, Descripcion, MonIdMoneda, borrar
            FROM Articulos
            WHERE ProIdProducto = 478 OR LTRIM(RTRIM(CodArticulo)) = '312'
        `);
        console.log('Registros existentes:', JSON.stringify(check.recordset, null, 2));

        // Actualizamos el que tiene ProIdProducto=478 con los valores correctos
        await pool.request()
            .input('Cod',      sql.VarChar(50),   '312')
            .input('React',    sql.Int,            312)
            .input('Sup',      sql.VarChar(10),    '1')
            .input('Grp',      sql.VarChar(50),    '1.10')
            .input('Stock',    sql.VarChar(50),    '1.1.10.1')
            .input('Desc',     sql.VarChar(200),   'Gorros de lana  con parches TPU')
            .input('Mostrar',  sql.Bit,            1)
            .input('Ancho',    sql.Decimal(10,2),  0)
            .input('Papel',    sql.Bit,            0)
            .input('MonId',    sql.Int,            2)
            .input('ProId',    sql.Int,            478)
            .query(`
                UPDATE Articulos SET
                    CodArticulo     = @Cod,
                    IDProdReact     = @React,
                    SupFlia         = @Sup,
                    Grupo           = @Grp,
                    CodStock        = @Stock,
                    Descripcion     = @Desc,
                    Mostrar         = @Mostrar,
                    anchoimprimible = @Ancho,
                    LLEVAPAPEL      = @Papel,
                    MonIdMoneda     = @MonId,
                    ProCodigoOdooProducto = NULL,
                    UniIdUnidad     = NULL,
                    borrar          = 0
                WHERE ProIdProducto = @ProId
            `);

        console.log('✅ Artículo ProIdProducto=478 actualizado correctamente con IDProdReact=312 y datos de "Gorros de lana con parches TPU"');

        // Verificación final
        const final = await pool.request().query(`
            SELECT ProIdProducto, LTRIM(RTRIM(CodArticulo)) AS CodArticulo, IDProdReact, Descripcion, MonIdMoneda
            FROM Articulos WHERE ProIdProducto = 478
        `);
        console.log('Resultado final:', JSON.stringify(final.recordset, null, 2));

        process.exit(0);
    } catch (e) {
        console.error('❌ Error:', e.message);
        process.exit(1);
    }
})();
