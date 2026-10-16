const { sql } = require('../config/db');

/**
 * Valida que las órdenes de falla (-F) y de reposición (-R) de un lote tengan su metraje cargado:
 * cada una con su Magnitud > 0. Las -R entraron el 16/10/2026, cuando sus metros pasaron a
 * editarse en el lote: sin esto, una -R con los metros borrados se finalizaba igual y llegaba a
 * Control con 0 m, donde no se puede procesar.
 *
 * NOTA: antes también se exigía un total de grupo (MetrosGrupoFalla) que se cargaba a mano y
 * podía no coincidir con la suma real. Ese total pasó a ser la SUMA de las órdenes del grupo
 * (calculada, no editable), así que validar los metros de cada orden ya cubre el total.
 * La columna se mantiene por compatibilidad con los datos viejos, pero no se exige ni se usa.
 *
 * Un lote sin órdenes -F pasa siempre. `db` puede ser un pool o una transacción activa,
 * así se puede usar tanto al finalizar (dentro de la transacción del finish) como al
 * asignar/mover un lote a una calandra.
 *
 * Devuelve { falta: boolean, motivo: string|null } — `motivo` describe qué metraje falta.
 */
async function validarMetrosFalla(db, rolloId) {
    const rid = String(rolloId);

    const fRes = await new sql.Request(db)
        .input('RID_F', sql.VarChar(50), rid)
        .query(`
            SELECT CodigoOrden, ISNULL(TRY_CONVERT(DECIMAL(10,2), Magnitud), 0) AS Mag,
                   CASE WHEN CodigoOrden LIKE '%-F%' THEN 1 ELSE 0 END AS EsFalla
            FROM dbo.Ordenes
            WHERE CAST(RolloID AS VARCHAR(50)) = @RID_F
              AND (CodigoOrden LIKE '%-F%' OR CodigoOrden LIKE '%-R[0-9]%')
              AND Estado NOT IN ('Cancelado','Cancelada')
        `);
    const fallaRows = fRes.recordset || [];
    if (fallaRows.length === 0) return { falta: false, motivo: null };

    const sinMetros = fallaRows.filter(r => Number(r.Mag) <= 0);

    if (sinMetros.length > 0) {
        const todasFalla = sinMetros.every(r => r.EsFalla === 1);
        const todasRepo = sinMetros.every(r => r.EsFalla === 0);
        const tipo = todasFalla ? (sinMetros.length === 1 ? 'la orden de falla' : 'las órdenes de falla')
            : todasRepo ? (sinMetros.length === 1 ? 'la reposición' : 'las reposiciones')
            : 'las órdenes de falla/reposición';
        return { falta: true, motivo: `el metraje de ${tipo} ${sinMetros.map(r => r.CodigoOrden).join(', ')}` };
    }
    return { falta: false, motivo: null };
}

module.exports = { validarMetrosFalla };
