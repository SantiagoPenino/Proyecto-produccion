/**
 * pagoService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * @deprecated 2026-06-08
 *
 * ESTE SERVICIO ESTÁ REEMPLAZADO POR cajaService.procesarTransaccion
 * que desde la versión actual incluye:
 *   - Auto-descubrimiento de órdenes hijas de un ORDEN_RETIRO
 *   - Cruce exacto de DeudaDocumento por OrdIdOrden (+ fallback PEPS)
 *   - Generación de CFE (E-Ticket Contado)
 *   - Asiento contable (Partida Doble)
 *
 * Los webhooks Handy y MercadoPago ya migrados a cajaService.
 * Este archivo se conserva solo como referencia histórica.
 * NO agregues llamadas nuevas a registrarPagoCompleto.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Servicio original de pago. Replicaba el flujo de
 * procesarPagoDeuda de Caja para pagos online (Handy, MercadoPago) y logística.
 *
 * Operaciones realizadas (igual que Caja):
 *  1. Imputa DeudaDocumento de las órdenes involucradas
 *  2. Crea TransaccionesCaja + Pagos
 *  3. Actualiza OrdenesRetiro (estado + PagIdPago)
 *  4. Actualiza OrdenesDeposito (estado=7 + PagIdPago)
 *  5. Inserta HistoricoEstadosOrdenesRetiro + HistoricoEstadosOrdenes
 *  6. Registra movimiento en submayor (CuentasCliente + MovimientosCuenta)
 *  7. Genera asiento contable (Caja DEBE / Cliente HABER)
 *  8. (Opcional) Actualiza HandyTransactions o MercadoPagoTransactions
 */

const sql             = require('mssql');
const { getPool }     = require('../config/db');
const contabilidadCore= require('./contabilidadCore');
const logger          = require('../utils/logger');
// Importación diferida para evitar dependencias circulares
const getCajaService  = () => require('./cajaService');

/**
 * @param {object}   opts
 * @param {number}   opts.clienteId        CliIdCliente
 * @param {number}  [opts.ordenRetiroId]   OReIdOrdenRetiro (null si no aplica)
 * @param {number[]} opts.ordIds           Array de OrdIdOrden a pagar
 * @param {object[]} opts.pagos            [{metodoPagoId, monedaId, monto, cotizacion}]
 * @param {number}   opts.totalMonto       Monto total del pago
 * @param {string}   opts.moneda           'UYU' | 'USD'
 * @param {number}   opts.monedaId         1=UYU, 2=USD
 * @param {number}   opts.usuarioId        ID del usuario que procesa
 * @param {string}  [opts.observaciones]   Texto libre
 * @param {string}  [opts.handyTxId]       TransactionId de Handy (si viene de Handy)
 * @param {string}  [opts.mpTxId]          TransactionId de MercadoPago
 * @param {string}  [opts.issuerName]      Nombre del medio (ej: 'Visa')
 * @returns {Promise<{success, tcaId, pagoId, totalImputado}>}
 */
async function registrarPagoCompleto(opts) {
  const {
    clienteId, ordenRetiroId = null, ordIds: _ordIds = [],
    pagos, totalMonto, moneda, monedaId, usuarioId,
    observaciones = '', handyTxId = null, mpTxId = null, issuerName = '',
  } = opts;

  const pool = await getPool();
  const transaction = pool.transaction();
  await transaction.begin();

  try {
    let ordIds = [..._ordIds];

    // ── 0. Resolver ordIds desde ordenRetiroId si no vinieron explícitos ─────
    if (!ordIds.length && ordenRetiroId) {
      const r = await transaction.request()
        .input('RID', sql.Int, ordenRetiroId)
        .query('SELECT OrdIdOrden FROM dbo.OrdenesDeposito WHERE OReIdOrdenRetiro = @RID');
      ordIds = r.recordset.map(x => x.OrdIdOrden);
    }

    // ── 1. Imputar DeudaDocumento ─────────────────────────────────────────────
    let totalImputado = 0;
    let pagoRestante  = totalMonto;
    let primerCueId   = null;

    if (ordIds.length) {
      const ddRes = await transaction.request().query(`
        SELECT dd.DDeIdDocumento, dd.DDeImportePendiente, dd.DDeEstado, dd.CueIdCuenta
        FROM   dbo.DeudaDocumento dd WITH (UPDLOCK, ROWLOCK)
        WHERE  dd.OrdIdOrden IN (${ordIds.join(',')})
          AND  dd.DDeEstado IN ('PENDIENTE','PARCIAL')
        ORDER  BY dd.DDeFechaEmision ASC
      `);

      for (const dd of ddRes.recordset) {
        if (pagoRestante <= 0) break;
        if (!primerCueId) primerCueId = dd.CueIdCuenta;

        const pendiente      = Number(dd.DDeImportePendiente);
        const aplicar        = Math.min(pagoRestante, pendiente);
        const nuevoPendiente = Math.max(0, pendiente - aplicar);
        const nuevoEstado    = nuevoPendiente < 0.01 ? 'COBRADO' : 'PARCIAL';
        pagoRestante   -= aplicar;
        totalImputado  += aplicar;

        await transaction.request()
          .input('ID',     sql.Int,          dd.DDeIdDocumento)
          .input('pend',   sql.Decimal(18,4), nuevoPendiente)
          .input('estado', sql.VarChar(20),  nuevoEstado)
          .query(`
            UPDATE dbo.DeudaDocumento
            SET    DDeImportePendiente = @pend,
                   DDeEstado           = @estado,
                   DDeFechaCobro       = CASE WHEN @estado = 'COBRADO' THEN GETDATE() ELSE DDeFechaCobro END
            WHERE  DDeIdDocumento = @ID
          `);

        logger.info(`[PAGO-SVC] DeudaDoc #${dd.DDeIdDocumento}: aplicado=${aplicar.toFixed(2)} estado=${nuevoEstado}`);
      }
    }

    // ── 1b. Fallback: si OrdIdOrden no matcheó deudas, buscar por CueIdCuenta (PEPS) ──
    //   Esto cubre el caso donde DeudaDocumento.OrdIdOrden fue guardado con un ID
    //   distinto al de OrdenesDeposito (ej: hookOrdenCreada pasó un ID diferente).
    if (totalImputado === 0 && pagoRestante > 0 && clienteId) {
      const cueTipo = monedaId === 2 ? 'DINERO_USD' : 'DINERO_UYU';
      const cueFallback = await transaction.request()
        .input('Cli', sql.Int,         clienteId)
        .input('T',   sql.VarChar(20), cueTipo)
        .query('SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente=@Cli AND CueTipo=@T AND CueActiva=1');

      if (cueFallback.recordset.length) {
        const cueIdFb = cueFallback.recordset[0].CueIdCuenta;
        if (!primerCueId) primerCueId = cueIdFb;

        logger.info(`[PAGO-SVC] Fallback: buscando deudas por CueIdCuenta=${cueIdFb} (OrdIdOrden no matcheó)`);

        const ddFb = await transaction.request()
          .input('CueId', sql.Int, cueIdFb)
          .query(`
            SELECT dd.DDeIdDocumento, dd.DDeImportePendiente, dd.DDeEstado, dd.CueIdCuenta
            FROM   dbo.DeudaDocumento dd WITH (UPDLOCK, ROWLOCK)
            WHERE  dd.CueIdCuenta = @CueId
              AND  dd.DDeEstado IN ('PENDIENTE','PARCIAL')
            ORDER  BY dd.DDeFechaEmision ASC
          `);

        for (const dd of ddFb.recordset) {
          if (pagoRestante <= 0) break;
          const pendiente      = Number(dd.DDeImportePendiente);
          const aplicar        = Math.min(pagoRestante, pendiente);
          const nuevoPendiente = Math.max(0, pendiente - aplicar);
          const nuevoEstado    = nuevoPendiente < 0.01 ? 'COBRADO' : 'PARCIAL';
          pagoRestante   -= aplicar;
          totalImputado  += aplicar;

          await transaction.request()
            .input('ID',     sql.Int,          dd.DDeIdDocumento)
            .input('pend',   sql.Decimal(18,4), nuevoPendiente)
            .input('estado', sql.VarChar(20),  nuevoEstado)
            .query(`
              UPDATE dbo.DeudaDocumento
              SET    DDeImportePendiente = @pend,
                     DDeEstado           = @estado,
                     DDeFechaCobro       = CASE WHEN @estado = 'COBRADO' THEN GETDATE() ELSE DDeFechaCobro END
              WHERE  DDeIdDocumento = @ID
            `);

          logger.info(`[PAGO-SVC] Fallback CueId: DeudaDoc #${dd.DDeIdDocumento}: aplicado=${aplicar.toFixed(2)} estado=${nuevoEstado}`);
        }
      }
    }

    // ── 2. TransaccionesCaja ──────────────────────────────────────────────────
    // Se fuerza a NULL la sesión para que actúe como Caja Administrativa y no ensucie 
    // el turno del cajero de mostrador (que sí usa StuIdSesion abierta).
    const sesionId = null;

    const nDocRes = await transaction.request()
      .query(`SELECT ISNULL(MAX(TcaNumeroDoc),0)+1 AS N FROM dbo.TransaccionesCaja WHERE TcaTipoDocumento='COBRO_WEB'`);
    const numDoc = nDocRes.recordset[0].N;

    const concepto = [observaciones, issuerName].filter(Boolean).join(' — ') || 'Cobro Online';

    const tcaRes = await transaction.request()
      .input('Ses',    sql.Int,           sesionId)
      .input('Usr',    sql.Int,           usuarioId)
      .input('Cli',    sql.Int,           clienteId)
      .input('Monto',  sql.Decimal(18,4), totalMonto)
      .input('Moneda', sql.VarChar(10),   moneda)
      .input('Num',    sql.VarChar(20),   String(numDoc))
      .input('Obs',    sql.NVarChar(500), concepto)
      .query(`
        INSERT INTO dbo.TransaccionesCaja
          (StuIdSesion, TcaUsuarioId, TcaClienteId, TcaFecha,
           TcaTipoDocumento, TcaSerieDoc, TcaNumeroDoc, TcaEstado,
           TcaTotalBruto, TcaTotalAjuste, TcaTotalNeto, TcaTotalCobrado,
           TcaMonedaBase, TcaObservaciones)
        OUTPUT INSERTED.TcaIdTransaccion
        VALUES
          (@Ses, @Usr, @Cli, GETDATE(),
           'COBRO_WEB', 'W', @Num, 'COBRADO',
           @Monto, 0, @Monto, @Monto, @Moneda, @Obs)
      `);
    const tcaId = tcaRes.recordset[0].TcaIdTransaccion;

    // ── 2.5 Insertar TransaccionDetalle ──────────────────────────────────────
    if (ordenRetiroId) {
      await transaction.request()
        .input('TcaId', sql.Int, tcaId)
        .input('RetId', sql.Int, ordenRetiroId)
        .input('Monto', sql.Decimal(18,4), totalMonto)
        .query(`
          INSERT INTO dbo.TransaccionDetalle
            (TcaIdTransaccion, TdeTipoReferencia, TdeReferenciaId, TdeImporteOriginal, TdeAjuste, TdeImporteFinal, TdePagado)
          VALUES
            (@TcaId, 'ORDEN_RETIRO', @RetId, @Monto, 0, @Monto, 1)
        `);
    } else if (ordIds.length > 0) {
      const q = await transaction.request().query(`SELECT OrdIdOrden, OrdCostoFinal, OrdCodigoOrden FROM dbo.OrdenesDeposito WHERE OrdIdOrden IN (${ordIds.join(',')})`);
      for (const row of q.recordset) {
        await transaction.request()
          .input('TcaId', sql.Int, tcaId)
          .input('OrdId', sql.Int, row.OrdIdOrden)
          .input('Cod', sql.VarChar(100), row.OrdCodigoOrden || null)
          .input('Costo', sql.Decimal(18,4), row.OrdCostoFinal || 0)
          .query(`
            INSERT INTO dbo.TransaccionDetalle
              (TcaIdTransaccion, TdeTipoReferencia, TdeReferenciaId, TdeCodigoReferencia, TdeImporteOriginal, TdeAjuste, TdeImporteFinal, TdePagado)
            VALUES
              (@TcaId, 'ORDEN_DEPOSITO', @OrdId, @Cod, @Costo, 0, @Costo, 1)
          `);
      }
    }

    // ── 3. Pagos ──────────────────────────────────────────────────────────────
    let pagoId = null;
    for (const p of pagos) {
      const cotNum  = Number(p.cotizacion) || 1;
      const monPago = Number(p.monto);
      const pRes = await transaction.request()
        .input('tcaId',   sql.Int,           tcaId)
        .input('metodo',  sql.Int,           parseInt(p.metodoPagoId, 10))
        .input('monedaP', sql.Int,           parseInt(p.monedaId,    10) || monedaId)
        .input('monto',   sql.Decimal(18,4), monPago)
        .input('cot',     sql.Decimal(18,4), cotNum)
        .input('usr',     sql.Int,           usuarioId)
        .query(`
          INSERT INTO dbo.Pagos
            (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
             PagMontoPago, PagFechaPago, PagUsuarioAlta,
             PagCotizacion, PagMontoConvertido, PagTipoMovimiento)
          OUTPUT INSERTED.PagIdPago
          VALUES (@tcaId, @metodo, @monedaP, @monto, GETDATE(), @usr, @cot, @monto, 'COBRO')
        `);
      if (!pagoId) pagoId = pRes.recordset[0].PagIdPago;
    }

    // ── 4. OrdenesRetiro ──────────────────────────────────────────────────────
    if (ordenRetiroId) {
      const retRes = await transaction.request()
        .input('RID', sql.Int, ordenRetiroId)
        .query('SELECT OReEstadoActual FROM dbo.OrdenesRetiro WHERE OReIdOrdenRetiro = @RID');

      if (retRes.recordset.length) {
        const nuevoEst = retRes.recordset[0].OReEstadoActual === 1 ? 3 : 8;
        await transaction.request()
          .input('RID',     sql.Int, ordenRetiroId)
          .input('PagoId',  sql.Int, pagoId)
          .input('Estado',  sql.Int, nuevoEst)
          .query(`
            UPDATE dbo.OrdenesRetiro
            SET PagIdPago = @PagoId, OReEstadoActual = @Estado,
                OReFechaEstadoActual = GETDATE(), ORePasarPorCaja = 0
            WHERE OReIdOrdenRetiro = @RID;

            INSERT INTO dbo.HistoricoEstadosOrdenesRetiro
              (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            VALUES (@RID, @Estado, GETDATE(), ${usuarioId});
          `);
      }
    }

    // ── 5. OrdenesDeposito ────────────────────────────────────────────────────
    if (ordIds.length) {
      await transaction.request()
        .input('PagoId', sql.Int, pagoId)
        .query(`
          UPDATE dbo.OrdenesDeposito
          SET PagIdPago = @PagoId, OrdEstadoActual = 7, OrdFechaEstadoActual = GETDATE()
          WHERE OrdIdOrden IN (${ordIds.join(',')});

          INSERT INTO dbo.HistoricoEstadosOrdenes
            (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT OrdIdOrden, 7, GETDATE(), ${usuarioId}
          FROM   dbo.OrdenesDeposito
          WHERE  OrdIdOrden IN (${ordIds.join(',')});
        `);
    }

    // ── 6. MovimientosCuenta + CuentasCliente (submayor) ─────────────────────
    const cueRes = await transaction.request()
      .input('Cli', sql.Int,      clienteId)
      .input('T',   sql.VarChar(20), monedaId === 2 ? 'DINERO_USD' : 'DINERO_UYU')
      .query('SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente=@Cli AND CueTipo=@T AND CueActiva=1');

    if (cueRes.recordset.length) {
      const cueId = cueRes.recordset[0].CueIdCuenta;
      await transaction.request()
        .input('CueId',   sql.Int,           cueId)
        .input('Tipo',    sql.VarChar(30),   'PAGO')
        .input('Concepto',sql.NVarChar(500), concepto)
        .input('Importe', sql.Decimal(18,4), totalMonto)
        .input('Usr',     sql.Int,           usuarioId)
        .input('PagId',   sql.Int,           pagoId)
        .query(`
          UPDATE dbo.CuentasCliente
          SET CueSaldoActual = CueSaldoActual + @Importe
          WHERE CueIdCuenta = @CueId;

          DECLARE @NS DECIMAL(18,4);
          SELECT  @NS = CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueId;

          INSERT INTO dbo.MovimientosCuenta
            (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
             PagIdPago, MovFecha, MovUsuarioAlta)
          VALUES (@CueId, @Tipo, @Concepto, @Importe, @NS, @PagId, GETDATE(), @Usr);
        `);
    }

    // ── 7. Asiento contable ───────────────────────────────────────────────────
    try {
      await contabilidadCore.generarAsientoCompleto({
        concepto,
        usuarioId,
        tcaIdTransaccion: tcaId,
        origen: 'COBRO_WEB',
        lineas: [
          {
            codigoCuenta: moneda === 'USD' ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU,
            debeBase: totalMonto, haberBase: 0, monedaId, cotizacion: 1,
          },
          {
            codigoCuenta: moneda === 'USD' ? contabilidadCore.CUENTAS.CLIENTE_USD : contabilidadCore.CUENTAS.CLIENTE_UYU,
            debeBase: 0, haberBase: totalMonto, monedaId, cotizacion: 1,
            entidadId: clienteId, entidadTipo: 'CLIENTE',
          },
        ],
      }, transaction);
    } catch (eA) {
      logger.warn(`[PAGO-SVC] Asiento no generado: ${eA.message}`);
    }


    await transaction.commit();
    logger.info(`[PAGO-SVC] ✅ Pago completo: TcaId=${tcaId} PagId=${pagoId} Imputado=${totalImputado.toFixed(2)} Retiro=${ordenRetiroId}`);

    // ── 9. GENERAR CFE (E-Ticket) ─ igual que Caja, post-commit (fire-and-forget) ──
    // Se genera para Handy, MercadoPago y cualquier canal que use registrarPagoCompleto.
    // La función es idempotente: verifica si ya existía un CFE para estas órdenes.
    if (ordIds.length && clienteId) {
      getCajaService().generarCFEDesdeOrdenesDirectas({
        orderIds:  ordIds,
        clienteId,
        monto:     totalMonto,
        monedaId,
        pagoId,
        usuarioId
      }).then(async (cfe) => {
          // Usamos el helper centralizado para convertir ORDEN -> VTA_CAJA
          const contabilidadSvc = require('./contabilidadService');
          await contabilidadSvc.transformarMovimiento({
            ordIds,
            tipoOrigen:  'ORDEN',
            tipoDestino: 'VTA_CAJA',
            docId:       cfe.docId,
            concepto:    `Factura Web ${cfe.serie}-${cfe.numero}`,
          });
          // Ligamos el PAGO al documento de la factura
          await contabilidadSvc.transformarMovimiento({
            ordIds:      [],   // filtramos por PagIdPago directamente
            tipoOrigen:  'PAGO',
            tipoDestino: 'PAGO',
            docId:       cfe.docId,
            concepto:    `Pago Factura Web ${cfe.serie}-${cfe.numero}`,
          });
        }
      }).catch(e => logger.error(`[PAGO-SVC] Error generando CFE tras pago ${pagoId}: ${e.message}`));
    }
    // ─────────────────────────────────────────────────────────────────────────
    return { success: true, tcaId, pagoId, totalImputado, ordIds };

  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    logger.error(`[PAGO-SVC] ❌ Error: ${err.message}`);
    throw err;
  }
}

module.exports = { registrarPagoCompleto };
