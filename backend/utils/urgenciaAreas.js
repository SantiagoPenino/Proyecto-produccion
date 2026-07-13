'use strict';

/**
 * Áreas que tienen URGENCIA activa — la MISMA regla que usa el motor de precios
 * (pricingService) para decidir si cobra el recargo:
 *   - Si el perfil de urgencia (ConfiguracionGlobal.ID_PERFIL_URGENCIA) tiene una
 *     Categoria específica (ej: "DTF, Sublimacion, ECOUV") → solo esas áreas.
 *   - Si la Categoria es 'Todos' → todas las áreas menos AREAS_SIN_URGENCIA.
 * La categoría puede nombrar el área por CodArea (AreaID_Interno) o por su
 * NombreReferencia; se matchea contra ambos, en mayúscula.
 *
 * Devuelve un Set de CodArea (AreaID_Interno en MAYÚSCULA). El portal la usa para
 * ocultar el botón "Urgente" y createWebOrder para forzar 'Normal' — así el form,
 * el alta y el cobro responden a UNA sola configuración (editable desde Perfiles
 * de Precios, sin deploy).
 */
const getAreasConUrgencia = async (pool) => {
    const areasRes = await pool.request().query(`
        SELECT DISTINCT
            LTRIM(RTRIM(AreaID_Interno))            AS CodArea,
            LTRIM(RTRIM(ISNULL(NombreReferencia,''))) AS AreaNombre
        FROM dbo.ConfigMapeoERP WITH(NOLOCK)
        WHERE AreaID_Interno IS NOT NULL AND LTRIM(RTRIM(AreaID_Interno)) <> ''
    `);

    const cfgRes = await pool.request().query(`
        SELECT
            (SELECT TOP 1 Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'AREAS_SIN_URGENCIA') AS sinUrgencia,
            (SELECT TOP 1 Categoria FROM dbo.PerfilesPrecios
             WHERE ID = (SELECT TOP 1 CAST(Valor AS INT) FROM dbo.ConfiguracionGlobal WHERE Clave = 'ID_PERFIL_URGENCIA')
               AND Activo = 1) AS urgCategoria
    `);

    const urgCategoria = (cfgRes.recordset[0]?.urgCategoria || 'Todos').trim();

    let list;
    if (urgCategoria && urgCategoria.toLowerCase() !== 'todos') {
        const cats = urgCategoria.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        list = areasRes.recordset.filter(a =>
            cats.includes(a.CodArea.toUpperCase()) || cats.includes(a.AreaNombre.toUpperCase())
        );
    } else {
        const sinUrg = (cfgRes.recordset[0]?.sinUrgencia || 'BOR,EMB,COR,TWC,COS,TWT')
            .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        list = areasRes.recordset.filter(a => !sinUrg.includes(a.CodArea.toUpperCase()));
    }

    return new Set(list.map(a => a.CodArea.toUpperCase()));
};

module.exports = { getAreasConUrgencia };
