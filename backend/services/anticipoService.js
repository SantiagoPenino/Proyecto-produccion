/**
 * anticipoService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Lógica de negocio para:
 *   1. calcularSaldoEfectivo   — saldo real del cliente descontando órdenes ya
 *                                comprometidas (aprobadas por anticipo pero
 *                                todavía sin facturar).
 *   2. aplicarAnticipoAOrden   — imputa el anticipo a una OrdenRetiro concreta:
 *                                crea el Pago, debita CuentasCliente, registra
 *                                el movimiento en el libro mayor.
 */

'use strict';

const { sql } = require('../config/db');
const logger  = require('../utils/logger');

// ── Método de pago interno para anticipos (sin caja física) ──────────────────
// Buscamos el método "Anticipo" o "Cuenta Corriente" para no requerir efectivo.
async function resolverMetodoPagoAnticipo(pool) {
  const res = await pool.request().query(`
    SELECT TOP 1 MPaIdMetodoPago
    FROM   dbo.MetodosPagos WITH(NOLOCK)
    WHERE  MPaDescripcionMetodo LIKE '%anticipo%'
        OR MPaDescripcionMetodo LIKE '%cuenta corriente%'
        OR MPaDescripcionMetodo LIKE '%cta%'
    ORDER BY MPaIdMetodoPago ASC
  `);
  if (res.recordset.length > 0) return res.recordset[0].MPaIdMetodoPago;

  // Fallback: primer método disponible
  const fb = await pool.request().query('SELECT TOP 1 MPaIdMetodoPago FROM dbo.MetodosPagos WITH(NOLOCK) ORDER BY MPaIdMetodoPago ASC');
  return fb.recordset[0]?.MPaIdMetodoPago || 1;
}

// ── Crear TransaccionCaja fantasma para anticipo (sin sesión de caja real) ────
async function crearTransaccionAnticipo(pool, { cliId, monto, monedaId, usuarioId, concepto }) {
  // Buscar sesión de caja abierta del usuario — si no hay, usamos NULL
  const sesRes = await pool.request()
    .input('Usr', sql.Int, usuarioId)
    .query(`SELECT TOP 1 SesIdSesion FROM dbo.SesionesCaja WITH(NOLOCK)
            WHERE SesUsuarioAlta = @Usr AND SesEstado = 'ABIERTA'
            ORDER BY SesFechaApertura DESC`);
  const sesionId = sesRes.recordset[0]?.SesIdSesion || null;

  const tcaRes = await pool.request()
    .input('Ses',  sql.Int,          sesionId)
    .input('Usr',  sql.Int,          usuarioId)
    .input('Cli',  sql.Int,          cliId)
    .input('Mon',  sql.Int,          monedaId)
    .input('Mnt',  sql.Decimal(18,4), monto)
    .input('Obs',  sql.NVarChar(500), concepto || 'Imputación anticipo')
    .query(`
      INSERT INTO dbo.TransaccionesCaja
        (SesIdSesion, TcaUsuarioAlta, CliIdCliente, TcaFecha,
         TcaTipoDocumento, TcaSerie, TcaNumeroDoc,
         TcaEstado, TcaTotal, TcaTotalDescuentos, TcaNetoTotal,
         TcaMontoPagado, MonIdMoneda, TcaObservaciones)
      OUTPUT INSERTED.TcaIdTransaccion
      VALUES
        (@Ses, @Usr, @Cli, GETDATE(),
         'ANTICIPO', 'A',
         (SELECT ISNULL(MAX(TcaNumeroDoc),0)+1 FROM dbo.TransaccionesCaja WHERE TcaTipoDocumento='ANTICIPO'),
         'COBRADO', @Mnt, 0, @Mnt, @Mnt, @Mon, @Obs)
    `);
  return tcaRes.recordset[0].TcaIdTransaccion;
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * calcularSaldoEfectivo
 * ─────────────────────────────────────────────────────────────────────────────
 * Saldo disponible real = CueSaldoActual
 *                       - SUM(monto de órdenes ya aprobadas por anticipo pero
 *                             todavía sin facturar)
 *
 * @param {number} cliId
 * @param {number} monedaId  1=UYU, 2=USD
 * @param {object} pool      conexión mssql
 * @returns {{ cuentaId, saldoBruto, comprometido, saldoEfectivo }}
 */
async function calcularSaldoEfectivo(cliId, monedaId, pool) {
  const tipoCuenta = monedaId === 2 ? 'DINERO_USD' : 'DINERO_UYU';

  // Saldo bruto en cuenta
  const cueRes = await pool.request()
    .input('Cli',  sql.Int,        cliId)
    .input('Tipo', sql.VarChar(20), tipoCuenta)
    .query(`SELECT CueIdCuenta, CueSaldoActual
            FROM   dbo.CuentasCliente WITH(NOLOCK)
            WHERE  CliIdCliente = @Cli AND CueTipo = @Tipo`);

  if (cueRes.recordset.length === 0) {
    return { cuentaId: null, saldoBruto: 0, comprometido: 0, saldoEfectivo: 0 };
  }

  const { CueIdCuenta, CueSaldoActual } = cueRes.recordset[0];
  const saldoBruto = parseFloat(CueSaldoActual) || 0;

  // Órdenes ya aprobadas por anticipo y sin facturar (ReferenciaPagoOnline='ANTICIPO' y sin DocIdDocumento)
  const compRes = await pool.request()
    .input('Cli', sql.Int, cliId)
    .query(`
      SELECT ISNULL(SUM(r.OReCostoTotalOrden), 0) AS Comprometido
      FROM   dbo.OrdenesRetiro r WITH(NOLOCK)
      INNER JOIN dbo.OrdenesDeposito od WITH(NOLOCK)
             ON  od.OReIdOrdenRetiro = r.OReIdOrdenRetiro
      WHERE  od.CliIdCliente = @Cli
        AND  r.ReferenciaPagoOnline = 'ANTICIPO'
        AND  r.OReEstadoActual NOT IN (5, 6, 9)   -- excluir ya entregadas/canceladas
        AND  NOT EXISTS (
               SELECT 1 FROM dbo.DeudaDocumento dd WITH(NOLOCK)
               WHERE  dd.CueIdCuenta = ${CueIdCuenta}
                 AND  dd.DDeEstado   = 'PAGADO'
                 AND  dd.OrdIdOrden  = od.OrdIdOrden
             )
    `);

  const comprometido = parseFloat(compRes.recordset[0]?.Comprometido) || 0;
  const saldoEfectivo = Math.max(0, saldoBruto - comprometido);

  logger.info(`[ANTICIPO-SVC] Cli=${cliId} saldoBruto=${saldoBruto} comprometido=${comprometido} efectivo=${saldoEfectivo}`);
  return { cuentaId: CueIdCuenta, saldoBruto, comprometido, saldoEfectivo };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * aplicarAnticipoAOrden
 * ─────────────────────────────────────────────────────────────────────────────
 * Imputa el anticipo disponible a una OrdenRetiro.
 *
 * Pasos:
 *   1. Crear TransaccionCaja tipo ANTICIPO (fantasma)
 *   2. Crear Pago en dbo.Pagos con PagTipoMovimiento='ANTICIPO_APLICADO'
 *   3. Actualizar OrdenesRetiro → PagIdPago, estado 8, ORePasarPorCaja=0, OReAprobadoPorAnticipo=1
 *   4. Actualizar OrdenesDeposito hijas → PagIdPago
 *   5. Debitar CuentasCliente (CueSaldoActual -= monto)
 *   6. Registrar MovimientosCuenta (MovTipo='ORDEN_ANTICIPO')
 *
 * @param {object} opts
 * @param {number} opts.oReId       OReIdOrdenRetiro
 * @param {number} opts.cliId
 * @param {number} opts.cuentaId    CueIdCuenta
 * @param {number} opts.monto       OReCostoTotalOrden
 * @param {number} opts.monedaId
 * @param {number} opts.usuarioId
 * @param {object} opts.pool
 * @param {object} opts.tran        Transacción mssql activa (usa la del caller)
 * @returns {{ pagIdPago, tcaIdTransaccion }}
 */
async function aplicarAnticipoAOrden({ oReId, cliId, cuentaId, monto, monedaId, usuarioId, tran }) {
  const req = () => tran.request();

  // 1. Crear transacción de caja fantasma
  const concepto = `Anticipo aplicado a Retiro R-${oReId}`;
  const sesRes = await req()
    .input('Usr', sql.Int, usuarioId)
    .query(`SELECT TOP 1 SesIdSesion FROM dbo.SesionesCaja WITH(NOLOCK)
            WHERE SesUsuarioAlta = @Usr AND SesEstado = 'ABIERTA'
            ORDER BY SesFechaApertura DESC`);
  const sesionId = sesRes.recordset[0]?.SesIdSesion || null;

  const tcaRes = await req()
    .input('Ses',  sql.Int,           sesionId)
    .input('Usr',  sql.Int,           usuarioId)
    .input('Cli',  sql.Int,           cliId)
    .input('Mon',  sql.Int,           monedaId)
    .input('Mnt',  sql.Decimal(18,4), monto)
    .input('Obs',  sql.NVarChar(500),  concepto)
    .query(`
      INSERT INTO dbo.TransaccionesCaja
        (SesIdSesion, TcaUsuarioAlta, CliIdCliente, TcaFecha,
         TcaTipoDocumento, TcaSerie, TcaNumeroDoc,
         TcaEstado, TcaTotal, TcaTotalDescuentos, TcaNetoTotal,
         TcaMontoPagado, MonIdMoneda, TcaObservaciones)
      OUTPUT INSERTED.TcaIdTransaccion
      SELECT @Ses, @Usr, @Cli, GETDATE(),
             'ANTICIPO', 'A',
             ISNULL((SELECT MAX(TcaNumeroDoc) FROM dbo.TransaccionesCaja WHERE TcaTipoDocumento='ANTICIPO'),0)+1,
             'COBRADO', @Mnt, 0, @Mnt, @Mnt, @Mon, @Obs
    `);
  const tcaId = tcaRes.recordset[0].TcaIdTransaccion;

  // 2. Método de pago — buscar "anticipo" o primer método disponible
  const mpRes = await req().query(`
    SELECT TOP 1 MPaIdMetodoPago FROM dbo.MetodosPagos WITH(NOLOCK)
    WHERE MPaDescripcionMetodo LIKE '%anticipo%' OR MPaDescripcionMetodo LIKE '%cuenta%'
    ORDER BY MPaIdMetodoPago ASC
  `);
  const mpId = mpRes.recordset[0]?.MPaIdMetodoPago
    || (await req().query('SELECT TOP 1 MPaIdMetodoPago FROM dbo.MetodosPagos WITH(NOLOCK) ORDER BY MPaIdMetodoPago')).recordset[0]?.MPaIdMetodoPago
    || 1;

  // 3. Crear Pago
  const pagRes = await req()
    .input('TcaId',   sql.Int,           tcaId)
    .input('MpaId',   sql.Int,           mpId)
    .input('MonId',   sql.Int,           monedaId)
    .input('Monto',   sql.Decimal(18,4), monto)
    .input('Usr',     sql.Int,           usuarioId)
    .query(`
      INSERT INTO dbo.Pagos
        (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
         PagMontoPago, PagFechaPago, PagUsuarioAlta,
         PagCotizacion, PagMontoConvertido, PagTipoMovimiento)
      OUTPUT INSERTED.PagIdPago
      VALUES
        (@TcaId, @MpaId, @MonId,
         @Monto, GETDATE(), @Usr,
         1, @Monto, 'ANTICIPO_APLICADO')
    `);
  const pagIdPago = pagRes.recordset[0].PagIdPago;

  // 4. Actualizar OrdenesRetiro
  await req()
    .input('PagId', sql.Int, pagIdPago)
    .input('TcaId', sql.Int, tcaId)
    .input('OReId', sql.Int, oReId)
    .query(`
      UPDATE dbo.OrdenesRetiro
      SET  PagIdPago              = @PagId,
           TcaIdTransaccion       = @TcaId,
           OReEstadoActual        = 8,          -- Empaquetado y Abonado
           OReFechaEstadoActual   = GETDATE(),
           ORePasarPorCaja        = 0,
           ReferenciaPagoOnline   = 'ANTICIPO'
      WHERE OReIdOrdenRetiro = @OReId;

      INSERT INTO dbo.HistoricoEstadosOrdenesRetiro
        (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      VALUES (@OReId, 8, GETDATE(), ${usuarioId});
    `);

  // 5. Actualizar OrdenesDeposito hijas
  await req()
    .input('PagId', sql.Int, pagIdPago)
    .input('OReId', sql.Int, oReId)
    .query(`
      UPDATE dbo.OrdenesDeposito
      SET  PagIdPago            = @PagId,
           OrdEstadoActual      = 7,           -- Pronto / Pagado
           OrdFechaEstadoActual = GETDATE()
      WHERE OReIdOrdenRetiro = @OReId;

      INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
      SELECT OrdIdOrden, 7, GETDATE(), ${usuarioId}
      FROM   dbo.OrdenesDeposito WHERE OReIdOrdenRetiro = @OReId;
    `);

  // 6. Debitar CuentasCliente
  await req()
    .input('Monto', sql.Decimal(18,4), monto)
    .input('Cue',   sql.Int,           cuentaId)
    .query(`
      UPDATE dbo.CuentasCliente
      SET    CueSaldoActual = CueSaldoActual - @Monto
      WHERE  CueIdCuenta = @Cue
    `);

  // 7. Registrar movimiento en libro mayor
  await req()
    .input('Cue',     sql.Int,           cuentaId)
    .input('Monto',   sql.Decimal(18,4), monto)
    .input('Usr',     sql.Int,           usuarioId)
    .input('Obs',     sql.NVarChar(500),  concepto)
    .input('TcaId',   sql.Int,           tcaId)
    .query(`
      DECLARE @NuevoSaldo DECIMAL(18,4);
      SELECT  @NuevoSaldo = CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue;

      INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovImporte, MovConcepto,
         MovSaldoPosterior, MovFecha, MovUsuarioAlta, MovAnulado)
      VALUES
        (@Cue, 'ORDEN_ANTICIPO', -@Monto, @Obs,
         @NuevoSaldo, GETDATE(), @Usr, 0)
    `);

  logger.info(`[ANTICIPO-SVC] Anticipo aplicado: OReId=${oReId} PagId=${pagIdPago} Monto=${monto}`);
  return { pagIdPago, tcaIdTransaccion: tcaId };
}

module.exports = { calcularSaldoEfectivo, aplicarAnticipoAOrden };
