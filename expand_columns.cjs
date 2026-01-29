const { getPool } = require('./backend/config/db');

async function runMigration() {
    try {
        console.log("🌊 Conectando a Base de Datos...");
        const pool = await getPool();

        console.log("🔨 Ejecutando ALTER TABLE para ampliar columnas...");

        // Ampliar CodigoReact a NVarChar(50)
        await pool.request().query("ALTER TABLE dbo.Clientes ALTER COLUMN CodigoReact NVARCHAR(50)");
        console.log("✅ Columna 'CodigoReact' ampliada a NVARCHAR(50)");

        // Ampliar IDReact a NVarChar(50)
        await pool.request().query("ALTER TABLE dbo.Clientes ALTER COLUMN IDReact NVARCHAR(50)");
        console.log("✅ Columna 'IDReact' ampliada a NVARCHAR(50)");

        console.log("✨ Migración completada con éxito.");
    } catch (error) {
        console.error("❌ Error durante la migración:", error.message);
        if (error.originalError) {
            console.error("Detalle SQL:", error.originalError.message);
        }
    } finally {
        process.exit();
    }
}

runMigration();
