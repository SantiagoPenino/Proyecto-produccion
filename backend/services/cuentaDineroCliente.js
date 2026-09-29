'use strict';
/**
 * cuentaDineroCliente.js
 * ─────────────────────────────────────────────────────────────────────────────
 * La cuenta de DINERO del cliente para una moneda (DINERO_USD / DINERO_UYU): la
 * principal activa; si no tiene, la crea (misma alta que hace el pago de deudas).
 *
 * Reemplaza el `MonIdMoneda === 2 ? 119 : 118` que estaba repetido en la creación y
 * edición de documentos: 119 y 118 son cuentas reales de OTROS clientes (417 y 2889),
 * así que cada documento nacía con la cuenta ajena en el encabezado (28-09-2026:
 * 12.842 documentos desde abril). Ningún reporte leía esa columna, pero es una mina.
 */
const { sql, getPool } = require('../config/db');

/**
 * @param {object} p
 * @param {number} p.clienteId   CliIdCliente (obligatorio)
 * @param {number} p.monedaId    1 = UYU, 2 = USD
 * @param {object} [p.transaction]  transacción abierta (si no, usa el pool)
 * @param {number} [p.usuarioId]    sello de alta si hay que crear la cuenta
 * @returns {Promise<number>} CueIdCuenta
 */
async function resolverCuentaDineroCliente({ clienteId, monedaId, transaction = null, usuarioId = 1 }) {
    const cli = parseInt(clienteId, 10);
    if (!cli) throw new Error('resolverCuentaDineroCliente: falta el cliente.');
    const monId = Number(monedaId) === 2 ? 2 : 1;
    const tipo = monId === 2 ? 'DINERO_USD' : 'DINERO_UYU';
    const req = () => (transaction ? new sql.Request(transaction) : null);
    const mk = async () => req() || (await getPool()).request();

    const r = await (await mk())
        .input('Cli',  sql.Int,         cli)
        .input('Tipo', sql.VarChar(20), tipo)
        .query(`SELECT TOP 1 CueIdCuenta FROM dbo.CuentasCliente
                WHERE CliIdCliente = @Cli AND CueTipo = @Tipo AND CueActiva = 1
                ORDER BY CueEsPrincipal DESC, CueIdCuenta ASC`);
    if (r.recordset.length) return r.recordset[0].CueIdCuenta;

    const nueva = await (await mk())
        .input('Cli',   sql.Int,         cli)
        .input('Tipo',  sql.VarChar(20), tipo)
        .input('MonId', sql.Int,         monId)
        .input('Usr',   sql.Int,         usuarioId || 1)
        .query(`INSERT INTO dbo.CuentasCliente
                  (CliIdCliente, CPaIdCondicion, CueTipo, MonIdMoneda, CueSaldoActual,
                   CueLimiteCredito, CuePuedeNegativo, CueCicloActivo, CueActiva, CueFechaAlta, CueUsuarioAlta, CueEsPrincipal)
                OUTPUT INSERTED.CueIdCuenta
                VALUES (@Cli, 1, @Tipo, @MonId, 0, 0, 0, 0, 1, GETDATE(), @Usr, 1)`);
    return nueva.recordset[0].CueIdCuenta;
}

module.exports = { resolverCuentaDineroCliente };
