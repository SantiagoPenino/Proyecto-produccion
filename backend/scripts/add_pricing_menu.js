const { getPool, sql } = require('../config/db');

(async () => {
    try {
        const pool = await getPool();
        console.log("🔌 Conectando a Base de Datos...");

        // 1. Crear Módulo Padre "Gestión de Precios"
        let parentId;
        const parentRes = await pool.request()
            .input('Titulo', sql.NVarChar, 'Gestión de Precios')
            .query("SELECT IdModulo FROM Modulos WHERE Titulo = @Titulo");

        if (parentRes.recordset.length > 0) {
            parentId = parentRes.recordset[0].IdModulo;
            console.log(`✅ Menú Padre ya existe (ID: ${parentId})`);
        } else {
            const insertParent = await pool.request()
                .input('Titulo', sql.NVarChar, 'Gestión de Precios')
                .input('Icono', sql.VarChar, 'fa-tags')
                .input('Ruta', sql.VarChar, '/admin/prices')
                .input('Orden', sql.Int, 90)
                .query(`
                    INSERT INTO Modulos (Titulo, Icono, Ruta, IndiceOrden)
                    OUTPUT INSERTED.IdModulo
                    VALUES (@Titulo, @Icono, @Ruta, @Orden)
                `);
            parentId = insertParent.recordset[0].IdModulo;
            console.log(`✨ Menú Padre creado (ID: ${parentId})`);
        }

        // 2. Crear Submenú "Precios Estándar"
        await pool.request()
            .input('Padre', sql.Int, parentId)
            .input('Titulo', sql.NVarChar, 'Precios Estándar')
            // Importante: La ruta debe coincidir con la definida en React
            .input('Ruta', sql.VarChar, '/admin/base-prices')
            .input('Icono', sql.VarChar, 'fa-barcode')
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Modulos WHERE Ruta = @Ruta)
                BEGIN
                    INSERT INTO Modulos (Titulo, Icono, Ruta, IdPadre, IndiceOrden)
                    VALUES (@Titulo, @Icono, @Ruta, @Padre, 1);
                    PRINT '✅ Submenú Precios Estándar creado.';
                END
            `);

        // 3. Crear Submenú "Precios Especiales"
        await pool.request()
            .input('Padre', sql.Int, parentId)
            .input('Titulo', sql.NVarChar, 'Precios Especiales')
            .input('Ruta', sql.VarChar, '/admin/special-prices')
            .input('Icono', sql.VarChar, 'fa-user-tag')
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Modulos WHERE Ruta = @Ruta)
                BEGIN
                    INSERT INTO Modulos (Titulo, Icono, Ruta, IdPadre, IndiceOrden)
                    VALUES (@Titulo, @Icono, @Ruta, @Padre, 2);
                    PRINT '✅ Submenú Precios Especiales creado.';
                END
            `);

        // 4. Asignar Permisos al Admin (Usuario 1 o Rol 1)
        // Revisando menuController, usa sp_ObtenerMenuUsuario.
        // Asumimos que si Admin tiene acceso a todo, quizás no necesitamos insertar en tabla intermedia manual.
        // Pero si hay tabla Permisos, deberíamos hacerlo.
        // Como no sé la tabla de permisos, lo dejo aquí. Si no aparece, el usuario tendrá que asignarlo en su panel de Roles.

        process.exit(0);
    } catch (e) {
        console.error("❌ Error actualizando menú:", e);
        process.exit(1);
    }
})();
