/**
 * envioEmailLog.js
 * ────────────────────────────────────────────────────────────────────────────
 * Historial único de correos enviados por el sistema (tabla dbo.EnvioEmail).
 *
 * Cualquier módulo que mande un mail registra acá, identificándose con:
 *     modulo → 'CFE' | 'ESTADO_CUENTA' | 'RECIBO' | ...
 *     refId  → el id dentro de ese módulo (DocIdDocumento, ColIdCola, ...)
 *
 * Así se puede contestar tanto "¿ya le mandé esta factura?" como "¿qué le
 * mandamos a este cliente?" desde un solo lugar.
 *
 * Ninguna función de acá tira una excepción hacia afuera: si el registro falla,
 * o si todavía no se corrió add_EnvioEmail.sql, el correo YA SALIÓ y no tiene
 * sentido que el pedido termine en error por no haber podido anotarlo.
 * ────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Módulos conocidos. No es una restricción de la base (la columna acepta
// cualquier texto): es la lista de los que existen hoy, para que se vean juntos.
const MODULOS = {
    CFE: 'CFE',                       // PDF de comprobante desde la Bandeja CFE
    ESTADO_CUENTA: 'ESTADO_CUENTA',   // estados de cuenta (cola de contabilidad)
};

/**
 * La tabla es nueva (backend/scripts/add_EnvioEmail.sql). Se consulta una sola vez
 * y se cachea, para que todo funcione igual antes y después de la migración.
 */
let _cacheTabla = null;
async function tablaExiste(pool) {
    if (_cacheTabla !== null) return _cacheTabla;
    try {
        const r = await pool.request().query(`
            SELECT 1 AS x FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'EnvioEmail'`);
        _cacheTabla = r.recordset.length > 0;
    } catch (e) {
        _cacheTabla = false;
    }
    return _cacheTabla;
}

/**
 * Registra un envío (o su intento fallido).
 *
 * @param {object}  p
 * @param {string}  p.modulo        MODULOS.CFE, MODULOS.ESTADO_CUENTA, ...
 * @param {number} [p.refId]        Id del registro dentro del módulo
 * @param {string} [p.refTexto]     Referencia legible ("E-Factura Serie A N° 27614")
 * @param {number} [p.cliIdCliente] Cliente, para poder listar por cliente
 * @param {string}  p.destinatario  Dirección REAL a la que se mandó
 * @param {string} [p.asunto]
 * @param {string} [p.adjunto]      Nombre del archivo adjunto
 * @param {string}  p.estado        'ENVIADO' | 'SIMULADO' | 'ERROR'
 * @param {string} [p.proveedor]    'resend' | 'brevo'
 * @param {string} [p.error]        Mensaje de error si estado = 'ERROR'
 * @param {number} [p.usuarioId]
 * @returns {Promise<boolean>} true si quedó registrado
 */
async function registrarEnvio(p) {
    try {
        const pool = await getPool();
        if (!await tablaExiste(pool)) return false;

        await pool.request()
            .input('modulo',  sql.VarChar(30),    String(p.modulo || 'OTRO').substring(0, 30))
            .input('refId',   sql.Int,            p.refId ?? null)
            .input('refTexto', sql.NVarChar(120), p.refTexto ? String(p.refTexto).substring(0, 120) : null)
            .input('cliente', sql.Int,            p.cliIdCliente ?? null)
            .input('dest',    sql.NVarChar(200),  String(p.destinatario || '').substring(0, 200))
            .input('asunto',  sql.NVarChar(300),  p.asunto ? String(p.asunto).substring(0, 300) : null)
            .input('adjunto', sql.NVarChar(200),  p.adjunto ? String(p.adjunto).substring(0, 200) : null)
            .input('estado',  sql.VarChar(20),    String(p.estado || 'ENVIADO').substring(0, 20))
            .input('prov',    sql.VarChar(20),    p.proveedor ? String(p.proveedor).substring(0, 20) : null)
            .input('error',   sql.NVarChar(500),  p.error ? String(p.error).substring(0, 500) : null)
            .input('usuario', sql.Int,            p.usuarioId ?? null)
            .query(`
                INSERT INTO dbo.EnvioEmail
                    (EEmModulo, EEmRefId, EEmRefTexto, EEmCliIdCliente, EEmDestinatario,
                     EEmAsunto, EEmAdjunto, EEmEstado, EEmProveedor, EEmError, EEmUsuarioAlta)
                VALUES (@modulo, @refId, @refTexto, @cliente, @dest,
                        @asunto, @adjunto, @estado, @prov, @error, @usuario)`);
        return true;

    } catch (e) {
        // El correo ya salió: que falle el registro no puede tumbar la operación.
        logger.error(`[ENVIO-EMAIL] No se pudo registrar el envío (${p?.modulo}/${p?.refId}): ${e.message}`);
        return false;
    }
}

/**
 * Fragmento SQL para traer el último envío de cada fila de un listado.
 * Se usa como OUTER APPLY: una sola búsqueda por fila contra IX_EnvioEmail_Ref.
 *
 * @param {string} modulo   Módulo a filtrar ('CFE', ...)
 * @param {string} columnaId Expresión con el id a comparar (ej: 'd.DocIdDocumento')
 * @param {string} alias    Alias del APPLY (por defecto 'env')
 * @returns {Promise<{select: string, apply: string}>}
 *          Si la tabla todavía no existe, `select` devuelve NULLs y `apply` es vacío.
 */
async function sqlUltimoEnvio(modulo, columnaId, alias = 'env') {
    const pool = await getPool();
    if (!await tablaExiste(pool)) {
        return {
            select: `CAST(NULL AS DATETIME) AS UltimoEnvioFecha,
                     CAST(NULL AS NVARCHAR(200)) AS UltimoEnvioDestinatario,
                     CAST(NULL AS VARCHAR(20)) AS UltimoEnvioEstado`,
            apply: '',
        };
    }
    const mod = String(modulo).replace(/'/g, "''");
    return {
        select: `${alias}.EEmFecha AS UltimoEnvioFecha,
                 ${alias}.EEmDestinatario AS UltimoEnvioDestinatario,
                 ${alias}.EEmEstado AS UltimoEnvioEstado`,
        apply: `OUTER APPLY (SELECT TOP 1 e2.EEmFecha, e2.EEmDestinatario, e2.EEmEstado
                               FROM dbo.EnvioEmail e2 WITH(NOLOCK)
                              WHERE e2.EEmModulo = '${mod}' AND e2.EEmRefId = ${columnaId}
                              ORDER BY e2.EEmFecha DESC, e2.EEmIdEnvio DESC) ${alias}`,
    };
}

/**
 * Historial de envíos de un registro puntual (para una pantalla de detalle).
 */
async function historialDe(modulo, refId) {
    try {
        const pool = await getPool();
        if (!await tablaExiste(pool)) return [];
        const r = await pool.request()
            .input('modulo', sql.VarChar(30), modulo)
            .input('refId',  sql.Int,         refId)
            .query(`
                SELECT EEmIdEnvio, EEmDestinatario, EEmAsunto, EEmAdjunto, EEmEstado,
                       EEmProveedor, EEmError, EEmFecha, EEmUsuarioAlta
                FROM dbo.EnvioEmail WITH(NOLOCK)
                WHERE EEmModulo = @modulo AND EEmRefId = @refId
                ORDER BY EEmFecha DESC, EEmIdEnvio DESC`);
        return r.recordset;
    } catch (e) {
        logger.error(`[ENVIO-EMAIL] No se pudo leer el historial (${modulo}/${refId}): ${e.message}`);
        return [];
    }
}

module.exports = { MODULOS, registrarEnvio, sqlUltimoEnvio, historialDe };
