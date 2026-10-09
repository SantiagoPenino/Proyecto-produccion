/**
 * departamentoUY — Nombre del departamento para los datos DGI del comprobante.
 * ─────────────────────────────────────────────────────────────────────────────
 * DocumentosContables.DocCliCiudad es texto libre, pero el cierre de ciclo
 * (CierreCicloPreviewModal → cerrarCicloCompleto) guardaba ahí el ID de
 * dbo.Departamentos ("10" = Montevideo, "2" = Canelones…): a DGI viajaba
 * "ciudad: 10" y el PDF imprimía "CIUDAD: 10".
 *
 * resolverDepartamento(valor) acepta el ID o el nombre y devuelve el Nombre de
 * dbo.Departamentos, o null si el valor no es un departamento (o vacío). Nunca tira
 * excepción: si la consulta falla devuelve null y el que llama conserva lo que tenía.
 */
const { getPool, sql } = require('../config/db');
const logger = require('./logger');

async function resolverDepartamento(valor) {
    const v = String(valor ?? '').trim();
    if (!v) return null;
    try {
        const pool = await getPool();
        const r = await pool.request()
            .input('Valor', sql.NVarChar(100), v)
            .query(`SELECT TOP 1 Nombre FROM dbo.Departamentos
                    WHERE CAST(ID AS NVARCHAR(20)) = @Valor OR Nombre = @Valor`);
        return r.recordset[0]?.Nombre || null;
    } catch (e) {
        logger.warn(`[departamentoUY] No se pudo resolver el departamento "${v}": ${e.message}`);
        return null;
    }
}

module.exports = { resolverDepartamento };
