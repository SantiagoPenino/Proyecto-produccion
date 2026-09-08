// =====================================================================
// rollbackSeguro — cerrar una transacción SIN dejarla huérfana ni en silencio
// =====================================================================
// Nació del incidente del 07/09/2026: `anularFactura` declaraba la transacción
// DENTRO del try y hacía el rollback en el catch, donde esa variable ya no
// existe (const es de bloque). El `transaction.rollback()` tiraba
// ReferenceError, un `catch {}` vacío se lo comía, y la conexión volvía al pool
// con la transacción ABIERTA reteniendo UPDLOCK sobre PlanesMetros /
// CuentasCliente / MovimientosCuenta. En 4 minutos se agotaron las conexiones
// del pool y se cayó todo el sistema, incluido /api/health.
//
// Reglas que impone este helper:
//   1. Nunca lanza: se puede llamar desde cualquier catch sin envolverlo.
//   2. Nunca queda mudo: si el rollback falla de verdad, lo grita en el log con
//      el contexto, porque eso significa una transacción huérfana en producción.
//   3. Último recurso: si el objeto Transaction está roto pero la conexión vive,
//      manda un ROLLBACK crudo por SQL sobre esa misma conexión.
//
// Cómo cazar una transacción huérfana si aparece este error en el log:
//   SELECT s.session_id, s.status, s.program_name,
//          DATEDIFF(SECOND, at.transaction_begin_time, GETDATE()) AS SegAbierta
//   FROM sys.dm_tran_session_transactions st
//   JOIN sys.dm_tran_active_transactions at ON at.transaction_id = st.transaction_id
//   JOIN sys.dm_exec_sessions s ON s.session_id = st.session_id
//   ORDER BY SegAbierta DESC;   -- y KILL <session_id> a la más vieja
// =====================================================================
const { sql } = require('../config/db');
const logger = require('./logger');

// Mensajes que significan "ya estaba cerrada": no son un problema.
const YA_CERRADA = /not begun|no transaction|already (been )?(rolled|committed|closed)|aborted/i;

/**
 * Revierte una transacción sin lanzar nunca.
 *
 * @param {object|null} transaction  Transacción de mssql (puede venir null/undefined).
 * @param {string} contexto          Dónde estamos, para el log (ej. `anularFactura doc 11008`).
 * @returns {Promise<boolean>}       true si la transacción quedó cerrada; false si pudo quedar huérfana.
 */
async function rollbackSeguro(transaction, contexto = 'sin contexto') {
    if (!transaction) return true;   // nunca se llegó a abrir: nada que revertir

    try {
        await transaction.rollback();
        return true;
    } catch (err) {
        const msg = String(err?.message || err);

        if (YA_CERRADA.test(msg)) {
            logger.warn(`[ROLLBACK] ${contexto}: la transacción ya estaba cerrada (${msg}).`);
            return true;
        }

        logger.error(
            `🚨 [ROLLBACK FALLIDO] ${contexto}: ${msg} — la conexión puede volver al pool con la ` +
            `transacción ABIERTA (bloquea a todos). Intentando ROLLBACK crudo…`
        );

        // Último recurso: el objeto Transaction puede estar en mal estado pero la
        // conexión seguir viva. Un ROLLBACK por SQL la limpia igual.
        try {
            await new sql.Request(transaction).query('IF @@TRANCOUNT > 0 ROLLBACK TRAN');
            logger.warn(`[ROLLBACK] ${contexto}: recuperado con ROLLBACK crudo.`);
            return true;
        } catch (err2) {
            logger.error(
                `🚨 [TRANSACCIÓN HUÉRFANA] ${contexto}: no se pudo revertir (${String(err2?.message || err2)}). ` +
                `Revisar sys.dm_tran_active_transactions y matar la sesión antes de que bloquee la planta.`
            );
            return false;
        }
    }
}

module.exports = { rollbackSeguro };
