const { getPool, sql } = require('../config/db');

async function check() {
    try {
        const pool = await getPool();

        console.log("--- Checking User 'Df' ---");
        const userResult = await pool.request()
            .input('Usuario', sql.NVarChar, 'Df')
            .query("SELECT IdUsuario, Usuario, IdRol FROM Usuarios WHERE Usuario = @Usuario");

        if (userResult.recordset.length === 0) {
            console.log("User 'Df' not found.");
            return;
        }

        const user = userResult.recordset[0];
        console.log("User found:", user);

        console.log("\n--- Checking Role ---");
        const roleResult = await pool.request()
            .input('IdRol', sql.Int, user.IdRol)
            .query("SELECT * FROM Roles WHERE IdRol = @IdRol");
        console.log("Role:", roleResult.recordset[0]);

        console.log("\n--- Checking Permissions (PermisosRoles) ---");
        const permsResult = await pool.request()
            .input('IdRol', sql.Int, user.IdRol)
            .query("SELECT * FROM PermisosRoles WHERE IdRol = @IdRol");
        console.log("Permissions count:", permsResult.recordset.length);
        console.log("Permission Module IDs:", permsResult.recordset.map(p => p.IdModulo));

        console.log("\n--- Checking All Modules ---");
        const modulesResult = await pool.request().query("SELECT IdModulo, Titulo, IdPadre FROM Modulos ORDER BY IdModulo");
        console.log("Total Modules:", modulesResult.recordset.length);
        // console.table(modulesResult.recordset);

        console.log("\n--- Simulating Logic from menuController ---");
        const query = `
            SELECT DISTINCT
                m.IdModulo, 
                m.Titulo, 
                m.Ruta, 
                m.Icono, 
                m.IdPadre, 
                m.IndiceOrden
            FROM Modulos m
            INNER JOIN PermisosRoles pr ON m.IdModulo = pr.IdModulo
            INNER JOIN Usuarios u ON u.IdRol = pr.IdRol
            WHERE u.IdUsuario = @IdUsuario
            ORDER BY m.IndiceOrden ASC
        `;
        const menuResult = await pool.request()
            .input('IdUsuario', sql.Int, user.IdUsuario)
            .query(query);

        console.log("Menu Items returned by query:", menuResult.recordset.length);
        console.table(menuResult.recordset);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        process.exit();
    }
}

check();
