const { getPool, sql } = require('../config/db');

async function fixPermissions() {
    try {
        const pool = await getPool();

        // 1. Get User Df's Role
        const userRes = await pool.request().query("SELECT IdRol FROM Usuarios WHERE Usuario = 'Df'");
        if (userRes.recordset.length === 0) {
            console.log("User Df not found.");
            return;
        }
        const roleId = userRes.recordset[0].IdRol;
        console.log(`Fixing permissions for Role ID: ${roleId}`);

        // 2. Get Current Permissions
        const permsRes = await pool.request()
            .input('IdRol', sql.Int, roleId)
            .query("SELECT IdModulo FROM PermisosRoles WHERE IdRol = @IdRol");

        const currentModuleIds = new Set(permsRes.recordset.map(p => p.IdModulo));
        console.log("Current Module IDs:", Array.from(currentModuleIds));

        // 3. Get All Modules to check Parents
        const modulesRes = await pool.request().query("SELECT IdModulo, IdPadre, Titulo FROM Modulos");
        const allModules = modulesRes.recordset;

        const missingParents = new Set();

        currentModuleIds.forEach(modId => {
            const module = allModules.find(m => m.IdModulo === modId);
            if (module && module.IdPadre) {
                // Check if parent is permitted
                if (!currentModuleIds.has(module.IdPadre)) {
                    console.log(`Module '${module.Titulo}' (${modId}) is missing parent ${module.IdPadre}`);
                    missingParents.add(module.IdPadre);
                }
            }
        });

        // 4. Insert Missing Parents
        const parentsToAdd = Array.from(missingParents);
        if (parentsToAdd.length > 0) {
            console.log("Adding missing parents:", parentsToAdd);

            for (const parentId of parentsToAdd) {
                try {
                    await pool.request()
                        .input('IdRol', sql.Int, roleId)
                        .input('IdModulo', sql.Int, parentId)
                        .query("INSERT INTO PermisosRoles (IdRol, IdModulo) VALUES (@IdRol, @IdModulo)");
                    console.log(`Added Parent ID ${parentId}`);
                } catch (err) {
                    console.error(`Error adding parent ${parentId}:`, err.message);
                }
            }
            console.log("Fix applied successfully.");
        } else {
            console.log("No missing parents found.");
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        process.exit();
    }
}

fixPermissions();
