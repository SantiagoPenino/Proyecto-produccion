/**
 * contabilidadService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Servicio central del módulo de Contabilidad de Clientes.
 * Todas las operaciones contables pasan por aquí.
 *
 * Regla de uso desde otros controladores:
 *   Siempre llamar DESPUÉS del COMMIT de la transacción principal.
 *   Si este servicio falla → log de advertencia, no rollback de la orden.
 *
 * Columnas reales confirmadas desde el código:
 *   Clientes.CliIdCliente, Clientes.Email, Clientes.TelefonoTrabajo
 *   Articulos.ProIdProducto, Articulos.Descripcion, Articulos.MonIdMoneda
 *   OrdenesDeposito.OrdCostoFinal, OrdCantidad, ProIdProducto
 * ──────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { getPool, sql } = require('../config/db');
const logger           = require('../utils/logger');

// ============================================================
// SECCIÓN 1: GESTIÓN DE CUENTAS
// ============================================================

/**
 * obtenerOCrearCuenta
 * Devuelve la CueIdCuenta de un cliente para un tipo dado.
 * Si no existe, la crea con los defaults del tipo.
 *
 * @param {number} CliIdCliente
 * @param {string} CueTipo  'DINERO_UYU' | 'DINERO_USD' | 'METROS' | 'KG'
 * @param {object} opciones
 *   @param {number|null} ProIdProducto  Obligatorio para METROS/KG
 *   @param {number|null} MonIdMoneda    Obligatorio para DINERO_*
 *   @param {number}      CPaIdCondicion Condición de pago (default: 1 = Contado)
 *   @param {number}      UsuarioAlta
 * @returns {Promise<number>} CueIdCuenta
 */
async function obtenerOCrearCuenta(CliIdCliente, CueTipo, opciones = {}, transaction = null) {
  const pool = await getPool();
  const {
    ProIdProducto  = null,
    MonIdMoneda    = null,
    CPaIdCondicion = 1,
    UsuarioAlta    = 1,
  } = opciones;

  const mkReq = () => transaction ? new sql.Request(transaction) : pool.request();

  // ── 1. Buscar cuenta existente o crear una nueva ──────────────────────
  const existe = await mkReq()
    .input('CliIdCliente',  sql.Int,         CliIdCliente)
    .input('CueTipo',       sql.VarChar(20), CueTipo)
    .input('ProIdProducto', sql.Int,         ProIdProducto)
    .query(`
      SELECT CueIdCuenta
      FROM   dbo.CuentasCliente
      WHERE  CliIdCliente  = @CliIdCliente
        AND  CueTipo       = @CueTipo
        AND  (
               (@ProIdProducto IS NULL     AND ProIdProducto IS NULL)
            OR (ProIdProducto = @ProIdProducto)
             )
        AND  CueActiva = 1
    `);

  let cueIdFinal;

  if (existe.recordset.length > 0) {
    cueIdFinal = existe.recordset[0].CueIdCuenta;
    logger.info(`[CUENTA] Cuenta existente: CliId=${CliIdCliente} Tipo=${CueTipo} CueId=${cueIdFinal}`);
  } else {
    const creada = await mkReq()
      .input('CliIdCliente',  sql.Int,         CliIdCliente)
      .input('CueTipo',       sql.VarChar(20), CueTipo)
      .input('ProIdProducto', sql.Int,         ProIdProducto)
      .input('MonIdMoneda',   sql.Int,         MonIdMoneda)
      .input('CPaIdCondicion',sql.Int,         CPaIdCondicion)
      .input('UsuarioAlta',   sql.Int,         UsuarioAlta)
      .query(`
        INSERT INTO dbo.CuentasCliente
          (CliIdCliente, CueTipo, ProIdProducto, MonIdMoneda,
           CPaIdCondicion, CueSaldoActual, CueLimiteCredito,
           CuePuedeNegativo, CueCicloActivo, CueActiva,
           CueFechaAlta, CueUsuarioAlta)
        OUTPUT INSERTED.CueIdCuenta
        VALUES
          (@CliIdCliente, @CueTipo, @ProIdProducto, @MonIdMoneda,
           @CPaIdCondicion, 0, 0,
           0, 0, 1,
           GETDATE(), @UsuarioAlta)
      `);

    cueIdFinal = creada.recordset[0].CueIdCuenta;
    logger.info(`[CUENTA] Cuenta creada: CliId=${CliIdCliente} Tipo=${CueTipo} CueId=${cueIdFinal}`);
  }

  // ── 2. Verificar ciclo activo — aplica a cuenta nueva Y existente ─────
  // Solo aplica a cuentas monetarias (no MTS/KG que son de recursos)
  if (CueTipo !== 'MTS' && CueTipo !== 'KG') {
    const cliRes = await mkReq()
      .input('CliIdCliente', sql.Int, CliIdCliente)
      .query('SELECT TClIdTipoCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CliIdCliente = @CliIdCliente');

    const tipoCliente = cliRes.recordset[0]?.TClIdTipoCliente;

    if (tipoCliente === 2) { // 2 = Semanal
      const cicloExistente = await obtenerCicloActivo(cueIdFinal, transaction);
      if (!cicloExistente) {
        logger.info(`[CICLO] Cliente ${CliIdCliente} es SEMANAL sin ciclo activo → abriendo ciclo para CueId=${cueIdFinal}`);
        await abrirCicloPorCuenta({ CueIdCuenta: cueIdFinal, CliIdCliente, UsuarioAlta }, transaction);
      } else {
        logger.info(`[CICLO] Cliente ${CliIdCliente} SEMANAL — ciclo activo encontrado: CicId=${cicloExistente.CicIdCiclo}`);
      }
    }
  }

  return cueIdFinal;
}

// ============================================================
// SECCIÓN 2: LIBRO MAYOR — REGISTRO DE MOVIMIENTOS
// ============================================================

/**
 * registrarMovimiento
 * Llama al SP_RegistrarMovimiento de forma transaccional.
 * Actualiza CueSaldoActual e inserta en MovimientosCuenta.
 *
 * @param {object} params
 *   @param {number}  CueIdCuenta
 *   @param {string}  MovTipo       'ORDEN' | 'PAGO' | 'ANTICIPO' | 'ENTREGA' | ...
 *   @param {string}  MovConcepto
 *   @param {number}  MovImporte    positivo = crédito / negativo = débito
 *   @param {number}  MovUsuarioAlta
 *   @param {number?} OrdIdOrden
 *   @param {number?} OReIdOrdenRetiro
 *   @param {number?} PagIdPago
 *   @param {number?} DocIdDocumento
 *   @param {string?} MovRefExterna
 *   @param {string?} MovObservaciones
 * @returns {Promise<{MovIdGenerado: number, SaldoResultante: number}>}
 */
async function registrarMovimiento(params, transaction = null) {
  const pool = await getPool();
  const {
    CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovUsuarioAlta,
    OrdIdOrden       = null,
    OReIdOrdenRetiro = null,
    PagIdPago        = null,
    DocIdDocumento   = null,
    MovRefExterna    = null,
    MovObservaciones = null,
    CicIdCiclo       = null,
  } = params;

  let resolvedCicloId = CicIdCiclo;
  if (!resolvedCicloId) {
    const activo = await obtenerCicloActivo(CueIdCuenta, transaction);
    if (activo) resolvedCicloId = activo.CicIdCiclo;
  }

  const req = transaction ? new sql.Request(transaction) : pool.request();
  const result = await req
    .input('CueIdCuenta',       sql.Int,          CueIdCuenta)
    .input('MovTipo',           sql.VarChar(30),  MovTipo)
    .input('MovConcepto',       sql.NVarChar(500), MovConcepto)
    .input('MovImporte',        sql.Decimal(18,4), MovImporte)
    .input('MovUsuarioAlta',    sql.Int,          MovUsuarioAlta)
    .input('OrdIdOrden',        sql.Int,          OrdIdOrden)
    .input('OReIdOrdenRetiro',  sql.Int,          OReIdOrdenRetiro)
    .input('PagIdPago',         sql.Int,          PagIdPago)
    .input('DocIdDocumento',    sql.Int,          DocIdDocumento)
    .input('MovRefExterna',     sql.VarChar(100), MovRefExterna)
    .input('MovObservaciones',  sql.NVarChar(500),MovObservaciones)
    .input('CicIdCiclo',        sql.Int,          resolvedCicloId)
    .output('MovIdGenerado',    sql.Int)
    .output('SaldoResultante',  sql.Decimal(18,4))
    .execute('dbo.SP_RegistrarMovimiento');

  return {
    MovIdGenerado:   result.output.MovIdGenerado,
    SaldoResultante: result.output.SaldoResultante,
  };
}

// ============================================================
// SECCIÓN 3: IMPUTACIÓN DE PAGOS (PEPS)
// ============================================================

/**
 * imputarPago
 * Aplica un pago a las deudas pendientes de una cuenta
 * usando el criterio PEPS (más antiguo primero).
 * El excedente queda como crédito a favor en la cuenta.
 *
 * @param {object} params
 *   @param {number} PagIdPago
 *   @param {number} MontoDisponible
 *   @param {number} CueIdCuenta
 *   @param {number} UsuarioAlta
 * @returns {Promise<{MontoExcedente: number}>}
 */
async function imputarPago(params) {
  const pool = await getPool();
  const { PagIdPago, MontoDisponible, CueIdCuenta, UsuarioAlta } = params;

  const result = await pool.request()
    .input('PagIdPago',       sql.Int,          PagIdPago)
    .input('MontoDisponible', sql.Decimal(18,4), MontoDisponible)
    .input('CueIdCuenta',     sql.Int,          CueIdCuenta)
    .input('UsuarioAlta',     sql.Int,          UsuarioAlta)
    .output('MontoExcedente', sql.Decimal(18,4))
    .execute('dbo.SP_ImputarPagoPEPS');

  return {
    MontoExcedente: result.output.MontoExcedente ?? 0,
  };
}

// ============================================================
// SECCIÓN 4: DOCUMENTOS DE DEUDA
// ============================================================

/**
 * crearDeudaDocumento
 * Registra una deuda pendiente asociada a una orden.
 *
 * @param {object} params
 *   @param {number}  CueIdCuenta
 *   @param {number}  OrdIdOrden
 *   @param {number}  Importe
 *   @param {number}  ImportePendiente
 * @returns {Promise<number>} DDeIdDocumento
 */
async function crearDeudaDocumento(params, transaction = null) {
  const pool = await getPool();
  const mkReq = () => transaction ? new sql.Request(transaction) : pool.request();
  let { CueIdCuenta, OrdIdOrden = null, DocIdDocumento = null, Importe, ImportePendiente = Importe } = params;

  // Auto-consumir Saldo a Favor existente en la cuenta para no crear deuda irreal
  const ctaRes = await mkReq()
    .input('CueIdCuenta', sql.Int, CueIdCuenta)
    .query(`
      SELECT 
        ISNULL(cc.CueSaldoActual, 0) AS SaldoActual,
        ISNULL(cp.CPaDiasVencimiento, 0) AS DiasVencimiento
      FROM   dbo.CuentasCliente cc WITH(UPDLOCK)
      JOIN   dbo.CondicionesPago cp ON cp.CPaIdCondicion = cc.CPaIdCondicion
      WHERE  cc.CueIdCuenta = @CueIdCuenta
    `);

  const diasVenc = ctaRes.recordset[0]?.DiasVencimiento ?? 0;
  const saldoActual = ctaRes.recordset[0]?.SaldoActual ?? 0;
  const monId = ctaRes.recordset[0]?.MonIdMoneda ?? 1;

  // 1. La deuda SIEMPRE nace en su importe real, como lo solicitó el usuario.
  const estado = ImportePendiente <= 0.01 ? 'PAGADO' : 'PENDIENTE';

  if (ImportePendiente > 0.01 || Importe > 0) {
      // Nace con ImportePendiente completo
      const insertRes = await mkReq()
        .input('CueIdCuenta',         sql.Int,          CueIdCuenta)
        .input('OrdIdOrden',          sql.Int,          OrdIdOrden)
        .input('DocIdDocumento',      sql.Int,          DocIdDocumento)
        .input('DDeImporteOriginal',  sql.Decimal(18,4), Importe)
        .input('DDeImportePendiente', sql.Decimal(18,4), Math.max(0, ImportePendiente))
        .input('DDeFechaEmision',     sql.Date,         new Date())
        .input('DiasVencimiento',     sql.Int,          diasVenc)
        .input('Estado',              sql.VarChar(20),  estado)
        .query(`
          INSERT INTO dbo.DeudaDocumento
            (CueIdCuenta, OrdIdOrden, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente,
             DDeFechaEmision, DDeFechaVencimiento, DDeEstado)
          OUTPUT INSERTED.DDeIdDocumento
          VALUES
            (@CueIdCuenta, @OrdIdOrden, @DocIdDocumento, @DDeImporteOriginal, @DDeImportePendiente,
             @DDeFechaEmision,
             DATEADD(DAY, @DiasVencimiento, @DDeFechaEmision),
             @Estado)
        `);
      
      const newDDeId = insertRes.recordset[0].DDeIdDocumento;

      // 2. Si el client tiene un Pago Anticipado (Saldo a Favor) flotante en la cuenta, lo consumimos AHORA explícitamente
      if (saldoActual > 0 && ImportePendiente > 0.01) {
          const montoAAplicar = Math.min(saldoActual, ImportePendiente);
          
          // Crear un pago sintético (recibo interno) que represente la aplicación del anticipo
          const pagRes = await mkReq()
            .input('Metodo', sql.Int, 1) // Efectivo genérico
            .input('Moneda', sql.Int, monId)
            .input('Monto', sql.Decimal(18,4), montoAAplicar)
            .query(`
              INSERT INTO dbo.Pagos
                (MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago, 
                 PagUsuarioAlta, PagCotizacion, PagMontoConvertido, PagTipoMovimiento)
              OUTPUT INSERTED.PagIdPago
              VALUES
                (@Metodo, @Moneda, @Monto, GETDATE(), 
                 1, 1, @Monto, 'ANTICIPO_APLICADO')
            `);
          
          const pagId = pagRes.recordset[0].PagIdPago;

          // Imputar el pago sintético a la deuda usando PEPS
          await mkReq()
            .input('PagIdPago',       sql.Int,          pagId)
            .input('MontoDisponible', sql.Decimal(18,4), montoAAplicar)
            .input('CueIdCuenta',     sql.Int,          CueIdCuenta)
            .input('UsuarioAlta',     sql.Int,          1)
            .output('MontoExcedente', sql.Decimal(18,4))
            .execute('dbo.SP_ImputarPagoPEPS');
          
          logger.info(`[CONTABILIDAD] Anticipo de ${montoAAplicar} consumido explícitamente en DeudaDocumento #${newDDeId}`);
      }

      return newDDeId;
  }
  return null;
}


// ============================================================
// SECCIÓN 5: HOOKS PARA EVENTOS DEL SISTEMA
// ============================================================

/**
 * hookOrdenCreada
 * Llamar DESPUÉS del commit de crearRetiro() / createOrden().
 * Registra el débito en la cuenta de dinero del cliente.
 *
 * @param {object} params
 *   @param {number} OrdIdOrden
 *   @param {number} CliIdCliente
 *   @param {number} Importe       OrdCostoFinal
 *   @param {number} MonIdMoneda   1=UYU, 2=USD
 *   @param {string} CodigoOrden   Para el concepto del movimiento
 *   @param {number} UsuarioAlta
 */
async function hookOrdenCreada(params, transaction = null) {
  const { OrdIdOrden, CliIdCliente, Importe, MonIdMoneda, CodigoOrden, NombreTrabajo, UsuarioAlta, ProIdProducto, Cantidad } = params;
  const contabilidadCore = require('./contabilidadCore'); // Import CORE for Asientos

  logger.info(`[HOOK:ORDEN] Iniciando hookOrdenCreada — Orden=${CodigoOrden} CliId=${CliIdCliente} ProIdProducto=${ProIdProducto} Cantidad=${Cantidad} Importe=${Importe} MonIdMoneda=${MonIdMoneda}`);

  try {
    const pool = await getPool();
    const req = transaction ? new sql.Request(transaction) : pool.request();

    // ── Si el cliente tiene plan de recursos para este artículo → descontar metros al INGRESO
    if (ProIdProducto) {
      const planCheck = await req
        .input('CliIdCliente',  sql.Int, CliIdCliente)
        .input('ProIdProducto', sql.Int, ProIdProducto)
        .query(`
          SELECT TOP 1 pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaActivo
          FROM   dbo.PlanesMetros pm WITH(NOLOCK)
          WHERE  pm.CliIdCliente  = @CliIdCliente
            AND  pm.PlaActivo     = 1
            AND  (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
            AND  (
              pm.ProIdProducto = @ProIdProducto
              OR EXISTS (
                SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                WHERE pap.PlaIdPlan = pm.PlaIdPlan
                  AND pap.ProIdProducto = @ProIdProducto
              )
            )
        `);
      logger.info(`[HOOK:ORDEN] Plan check para CliId=${CliIdCliente} ProId=${ProIdProducto}: encontrados=${planCheck.recordset.length} planes. Detalle=${JSON.stringify(planCheck.recordset[0] || null)}`);
      if (planCheck.recordset.length > 0) {
        const cantidadParaDescontar = Cantidad && Cantidad > 0 ? Cantidad : null;
        if (cantidadParaDescontar) {
          logger.info(`[HOOK:ORDEN] Orden ${CodigoOrden} cubierta por plan #${planCheck.recordset[0].PlaIdPlan} — descontando ${cantidadParaDescontar} metros AL INGRESO.`);
          // Descuento inmediato al ingresar la orden (el producto ya está fabricado)
          await hookEntregaMetros({
            OrdIdOrden, CliIdCliente, ProIdProducto,
            Cantidad: cantidadParaDescontar,
            Importe, MonIdMoneda,
            CodigoOrden, NombreTrabajo, UsuarioAlta,
          });
        } else {
          logger.warn(`[HOOK:ORDEN] Orden ${CodigoOrden} cubierta por plan pero sin Cantidad informada — no se descuentan metros (llamada desde excedente).`);
        }
        return; // Sin deuda monetaria
      }
    } else {
      logger.info(`[HOOK:ORDEN] Orden ${CodigoOrden} sin ProIdProducto — NO se verifica plan. Se generará deuda monetaria directamente.`);
    }

    const CueTipo = MonIdMoneda === 2 ? 'DINERO_USD' : 'DINERO_UYU';

    // 1. Obtener o crear la cuenta del cliente
    const CueIdCuenta = await obtenerOCrearCuenta(CliIdCliente, CueTipo, {
      MonIdMoneda,
      UsuarioAlta,
    }, transaction);

    // Buscar si hay ciclo activo para asignarlo al movimiento
    const cicloActivo = await obtenerCicloActivo(CueIdCuenta, transaction);

    // 2. Registrar débito en libro mayor
    const { SaldoResultante } = await registrarMovimiento({
      CueIdCuenta,
      MovTipo:      'ORDEN',
      MovConcepto:  `Orden ${CodigoOrden}${NombreTrabajo ? ' — ' + NombreTrabajo : ''}`,
      MovObservaciones: NombreTrabajo || null,
      MovImporte:   -Math.abs(Importe),
      MovUsuarioAlta: UsuarioAlta,
      OrdIdOrden,
      CicIdCiclo: cicloActivo ? cicloActivo.CicIdCiclo : null,
    }, transaction);

    let deudaAislada = Math.min(Math.abs(Importe), Math.max(0, -SaldoResultante));
    let idOtraMoneda = MonIdMoneda === 2 ? 1 : 2; 

    // Si todavía hay deuda (el saldo de esta cuenta bajó de 0, o estaba en 0)
    if (deudaAislada > 0.01) {
      // Intentar cruzar desde otra cuenta si tiene dinero (Ej: Debe USD, pero tiene UYU a favor)
      const tipoOtra = MonIdMoneda === 2 ? 'DINERO_UYU' : 'DINERO_USD';
      const reqOtra = transaction ? new sql.Request(transaction) : pool.request();
      const ctaOtraRes = await reqOtra
         .input('Cli', sql.Int, CliIdCliente)
         .input('Tipo', sql.VarChar(20), tipoOtra)
         .query(`SELECT CueIdCuenta, CueSaldoActual FROM dbo.CuentasCliente WITH (UPDLOCK, ROWLOCK) WHERE CliIdCliente=@Cli AND CueTipo=@Tipo AND CueActiva=1 AND CueSaldoActual > 0`);
      
      if (ctaOtraRes.recordset.length > 0) {
        const ctaOtra = ctaOtraRes.recordset[0];
        
        let coti = 1;
        const reqCoti = transaction ? new sql.Request(transaction) : pool.request();
        const cotiRes = await reqCoti.query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC');
        if (cotiRes.recordset.length > 0) coti = parseFloat(cotiRes.recordset[0].CotDolar) || 1;

        // Si la orden es en USD(2) y la otra es UYU(1) -> La otra cuenta vale su saldo / coti en USD
        // Si la orden es en UYU(1) y la otra es USD(2) -> La otra cuenta vale su saldo * coti en UYU
        let tasaConvertirAOrden = MonIdMoneda === 2 ? (1 / coti) : coti;
        let saldoOtraConvertido = ctaOtra.CueSaldoActual * tasaConvertirAOrden;

        let aDescontarOrden = Math.min(deudaAislada, saldoOtraConvertido);
        
        if (aDescontarOrden > 0.01) {
           let aDescontarCtaOtra = aDescontarOrden / tasaConvertirAOrden;
           
           // Extraer plata de la bolsa positiva (otra cuenta)
           await registrarMovimiento({
             CueIdCuenta: ctaOtra.CueIdCuenta,
             MovTipo: 'PAGO_CRUZADO',
             MovConcepto: `Cruce automático -> Orden ${CodigoOrden} (${MonIdMoneda===2?'USD':'UYU'})`,
             MovImporte: -Math.abs(aDescontarCtaOtra),
             MovUsuarioAlta: UsuarioAlta,
             OrdIdOrden,
           }, transaction);

           // Ingresar la plata convertida a la cuenta endeudada
           await registrarMovimiento({
             CueIdCuenta: CueIdCuenta,
             MovTipo: 'PAGO_CRUZADO',
             MovConcepto: `Cobertura desde ${tipoOtra} -> Orden ${CodigoOrden}`,
             MovImporte: Math.abs(aDescontarOrden),
             MovUsuarioAlta: UsuarioAlta,
             OrdIdOrden,
           }, transaction);

           deudaAislada -= aDescontarOrden;
        }
      }
    }

    // 3. Si la cuenta tiene ciclo activo → acumular en él (cliente semanal)
    if (cicloActivo) {
      await acumularEnCiclo(cicloActivo.CicIdCiclo, 'ORDEN', Math.abs(Importe), transaction);
      logger.info(`[CICLO] Orden ${CodigoOrden} acumulada en CicIdCiclo=${cicloActivo.CicIdCiclo}`);
    } else {
      // Sin ciclo activo → crear deuda documento individual con el remanente Real de deuda (0 si quedó pagada por fondos)
      await crearDeudaDocumento({ 
        CueIdCuenta, 
        OrdIdOrden, 
        Importe: Math.abs(Importe),
        ImportePendiente: Math.max(0, deudaAislada)
      }, transaction);
    }

    logger.info(`[CONTABILIDAD] Orden ${CodigoOrden} registrada. Saldo cliente ${CliIdCliente}: ${SaldoResultante}`);

    // 4. Registrar ASIENTO DIARIO EN LIBRO MAYOR (GLOBAL)
    const importeAbsRounded = Math.round(Math.abs(Importe) * 100) / 100;
    const { neto, ivaMonto } = contabilidadCore.desglosarIVA(importeAbsRounded, 22);
    const cuentaCliente = MonIdMoneda === 2 ? contabilidadCore.CUENTAS.CLIENTE_USD : contabilidadCore.CUENTAS.CLIENTE_UYU; // Deudores USD / UYU

    let cotizacion = 1;
    if (MonIdMoneda === 2) {
      const reqCotiGlobal = transaction ? new sql.Request(transaction) : pool.request();
      const cotiRes = await reqCotiGlobal.query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC');
      cotizacion = cotiRes.recordset.length > 0 ? parseFloat(cotiRes.recordset[0].CotDolar) || 1 : 1;
    }

    let useTransaction = transaction;
    let localTran = null;
    if (!useTransaction) {
      localTran = pool.transaction();
      await localTran.begin();
      useTransaction = localTran;
    }

    try {
      await contabilidadCore.generarAsientoCompleto({
        fecha: new Date(),
        concepto: `Venta s/ Orden ${CodigoOrden}${NombreTrabajo ? ' - ' + NombreTrabajo : ''}`,
        usuarioId: UsuarioAlta,
        tcaIdTransaccion: null,
        origen: 'VENTA_ACREDITO',
        lineas: [
          { codigoCuenta: cuentaCliente,                       debeBase: importeAbsRounded, haberBase: 0,        monedaId: MonIdMoneda, cotizacion },
          { codigoCuenta: contabilidadCore.CUENTAS.VENTA_SERV, debeBase: 0,                 haberBase: neto,     monedaId: MonIdMoneda, cotizacion },
          { codigoCuenta: contabilidadCore.CUENTAS.IVA_22,     debeBase: 0,                 haberBase: ivaMonto, monedaId: MonIdMoneda, cotizacion }
        ]
      }, useTransaction);

      if (localTran) {
        await localTran.commit();
      }
    } catch (errAsiento) {
      if (localTran) {
        await localTran.rollback();
      }
      logger.warn(`[CONTABILIDAD] Fallo al crear asiento para orden ${CodigoOrden}: ${errAsiento.message}`);
      if (!localTran) {
        throw errAsiento;
      }
    }
  } catch (err) {
    logger.warn(`[CONTABILIDAD] hookOrdenCreada falló (no afecta la orden): ${err.message}`);
    if (transaction) {
      throw err;
    }
  }
}

/**
 * hookReposicion
 * Llamar cuando la orden es una REPOSICIÓN (CodigoOrden empieza con 'R').
 * NO afecta el saldo ni descuenta recursos.
 * Solo deja trazabilidad en MovimientosCuenta con importe = 0
 * para que quede en el historial del cliente.
 *
 * @param {object} params
 *   @param {number} OrdIdOrden
 *   @param {number} CliIdCliente
 *   @param {number} MonIdMoneda   1=UYU, 2=USD
 *   @param {string} CodigoOrden
 *   @param {number} UsuarioAlta
 */
async function hookReposicion(params) {
  const { OrdIdOrden, CliIdCliente, MonIdMoneda, CodigoOrden, NombreTrabajo, UsuarioAlta } = params;

  try {
    const CueTipo = MonIdMoneda === 2 ? 'DINERO_USD' : 'DINERO_UYU';

    // Obtener o crear la cuenta del cliente (sin modificar saldo)
    const CueIdCuenta = await obtenerOCrearCuenta(CliIdCliente, CueTipo, {
      MonIdMoneda,
      UsuarioAlta,
    });

    // Registrar movimiento con importe 0 — solo para el historial
    await registrarMovimiento({
      CueIdCuenta,
      MovTipo:        'REPOSICION',
      MovConcepto:    `Reposición ${CodigoOrden}${NombreTrabajo ? ' — ' + NombreTrabajo : ''}`,
      MovObservaciones: NombreTrabajo ? `Reposición sin cargo — ${NombreTrabajo}` : 'Orden de reposición',
      MovImporte:     0,
      MovUsuarioAlta: UsuarioAlta,
      OrdIdOrden,

    });

    logger.info(`[CONTABILIDAD] Reposición registrada en historial: ${CodigoOrden} (CliId=${CliIdCliente}, importe=$0)`);
  } catch (err) {
    logger.warn(`[CONTABILIDAD] hookReposicion falló (no afecta la orden): ${err.message}`);
  }
}

/**
 * hookPagoRegistrado
 * Llamar DESPUÉS del commit de registrarPago().
 * Acredita el pago en la cuenta y aplica imputación PEPS.
 * Si sobra dinero → genera Nota de Crédito automáticamente.
 *
 * @param {object} params
 *   @param {number} PagIdPago
 *   @param {number} CliIdCliente
 *   @param {number} MontoPago
 *   @param {number} MonIdMoneda
 *   @param {number} UsuarioAlta
 */
async function hookPagoRegistrado(params) {
  const { PagIdPago, CliIdCliente, MontoPago, MonIdMoneda, UsuarioAlta } = params;

  try {
    const CueTipo = MonIdMoneda === 2 ? 'DINERO_USD' : 'DINERO_UYU';

    const CueIdCuenta = await obtenerOCrearCuenta(CliIdCliente, CueTipo, {
      MonIdMoneda,
      UsuarioAlta,
    });

    let conceptoText = `Pago recibido (PagIdPago: ${PagIdPago})`;
    try {
      const { getPool, sql } = require('../config/db');
      const pool = await getPool();
      const detRes = await pool.request()
        .input('pid', sql.Int, PagIdPago)
        .query(`SELECT OrdCodigoOrden, OrdNombreTrabajo FROM OrdenesDeposito WITH(NOLOCK) WHERE PagIdPago = @pid`);
      if (detRes.recordset.length > 0) {
        const parts = detRes.recordset.map(r => {
          let str = r.OrdCodigoOrden;
          if (r.OrdNombreTrabajo && r.OrdNombreTrabajo.trim() !== 'S/N' && r.OrdNombreTrabajo.trim() !== '') str += ` (${r.OrdNombreTrabajo})`;
          return str;
        });
        conceptoText = `Pago: ${parts.join(', ')}`;
        if (conceptoText.length > 250) conceptoText = conceptoText.substring(0, 247) + '...';
      }
    } catch (e) { /* ignore */ }

    // Buscar ciclo activo
    const cicloActivo = await obtenerCicloActivo(CueIdCuenta);

    // 1. Imputar PRIMERO a deudas pendientes (PEPS)
    // Así sabemos cuánto cubre deudas previas vs. cuánto es excedente real del ciclo
    const { MontoExcedente } = await imputarPago({
      PagIdPago,
      MontoDisponible: Math.abs(MontoPago),
      CueIdCuenta,
      UsuarioAlta,
    });

    const montoCubreDeudaPrevias = Math.abs(MontoPago) - MontoExcedente;
    const hayExcedente = MontoExcedente > 0.01;

    // 2. Registrar en libro mayor
    // CicIdCiclo: solo si hay excedente genuino para el ciclo actual.
    // Si el pago íntegramente cancela deudas anteriores → no se asocia al ciclo
    // (no contamina el modal de cierre ni los totales del ciclo activo)
    await registrarMovimiento({
      CueIdCuenta,
      MovTipo:      'PAGO',
      MovConcepto:  conceptoText,
      MovImporte:   Math.abs(MontoPago),
      MovUsuarioAlta: UsuarioAlta,
      PagIdPago,
      CicIdCiclo: (cicloActivo && hayExcedente) ? cicloActivo.CicIdCiclo : null,
    });

    // 3. Acumular en el ciclo activo SOLO el excedente real
    if (cicloActivo && hayExcedente) {
      await acumularEnCiclo(cicloActivo.CicIdCiclo, 'PAGO', MontoExcedente);
      logger.info(`[CICLO] Pago ${PagIdPago}: $${Math.abs(MontoPago)} recibido. Cubre deudas previas: $${montoCubreDeudaPrevias.toFixed(2)}. Excedente acumulado en CicId=${cicloActivo.CicIdCiclo}: $${MontoExcedente}`);
    } else if (cicloActivo) {
      logger.info(`[CICLO] Pago ${PagIdPago}: $${Math.abs(MontoPago)} aplicado íntegramente a deudas de ciclos anteriores. El ciclo activo ${cicloActivo.CicIdCiclo} NO se ve afectado.`);
    }

    logger.info(`[CONTABILIDAD] Pago ${PagIdPago} imputado. Excedente en cuenta (Saldo a favor): ${MontoExcedente}`);
  } catch (err) {
    logger.warn(`[CONTABILIDAD] hookPagoRegistrado falló (no afecta el pago): ${err.message}`);
  }
}



/**
 * hookEntregaMetros
 * Llamar DESPUÉS del commit de marcarPronto() para clientes
 * cuya cuenta es de tipo METROS o KG.
 * Descuenta la cantidad del PlanMetros activo para ese artículo.
 *
 * @param {object} params
 *   @param {number} OrdIdOrden
 *   @param {number} CliIdCliente
 *   @param {number} ProIdProducto   Artículo de la orden
 *   @param {number} Cantidad        OrdCantidad
 *   @param {string} CodigoOrden
 *   @param {number} UsuarioAlta
 */
async function hookEntregaMetros(params) {
  const { OrdIdOrden, CliIdCliente, ProIdProducto, Cantidad, CodigoOrden, UsuarioAlta, NombreTrabajo } = params;

  logger.info(`[HOOK:METROS] Iniciando hookEntregaMetros — Orden=${CodigoOrden} CliId=${CliIdCliente} ProId=${ProIdProducto} Cantidad=${Cantidad} Importe=${params.Importe}`);

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const mkReq = () => new sql.Request(transaction);

    // 1. Verificar si el cliente tiene alguna cuenta de metros con planes activos que permitan el artículo
    const cuentaRes = await mkReq()
      .input('CliIdCliente',  sql.Int, CliIdCliente)
      .input('ProIdProducto', sql.Int, ProIdProducto)
      .query(`
        SELECT DISTINCT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual
        FROM dbo.CuentasCliente cc WITH(UPDLOCK, ROWLOCK)
        WHERE cc.CliIdCliente = @CliIdCliente
          AND cc.CueTipo NOT IN ('USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU')
          AND cc.CueActiva = 1
          AND EXISTS (
            SELECT 1 FROM dbo.PlanesMetros pm WITH(UPDLOCK, ROWLOCK)
            WHERE pm.CueIdCuenta = cc.CueIdCuenta
              AND pm.PlaActivo = 1
              AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
              AND (
                pm.ProIdProducto = @ProIdProducto
                OR EXISTS (
                  SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                  WHERE pap.PlaIdPlan = pm.PlaIdPlan
                    AND pap.ProIdProducto = @ProIdProducto
                )
              )
          )
      `);

    logger.info(`[HOOK:METROS] Cuentas de recursos encontradas para CliId=${CliIdCliente} ProId=${ProIdProducto}: ${cuentaRes.recordset.length}. Detalle=${JSON.stringify(cuentaRes.recordset)}`);

    if (cuentaRes.recordset.length === 0) {
      logger.warn(`[HOOK:METROS] ⚠️ Sin cuenta de recursos para CliId=${CliIdCliente} ProId=${ProIdProducto}. No se descuentan metros.`);
      await transaction.commit();
      return;
    }

    // 2. Descontar en cascada de los planes activos (FIFO)
    const planRes = await mkReq()
      .input('CliIdCliente',  sql.Int, CliIdCliente)
      .input('ProIdProducto', sql.Int, ProIdProducto)
      .query(`
        SELECT pm.PlaIdPlan, pm.PlaCantidadTotal, pm.PlaCantidadUsada, pm.PlaPrecioUnitario, pm.MonIdMoneda, pm.PlaActivo, pm.PlaFechaVencimiento, pm.CueIdCuenta
        FROM   dbo.PlanesMetros pm WITH (UPDLOCK, ROWLOCK)
        WHERE  pm.CliIdCliente   = @CliIdCliente
          AND  pm.PlaActivo     = 1
          AND  (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
          AND  (
            pm.ProIdProducto = @ProIdProducto
            OR EXISTS (
              SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
              WHERE pap.PlaIdPlan = pm.PlaIdPlan
                AND pap.ProIdProducto = @ProIdProducto
            )
          )
        ORDER  BY pm.PlaFechaAlta ASC
      `);

    logger.info(`[HOOK:METROS] Planes activos para CliId=${CliIdCliente} ProId=${ProIdProducto}: ${planRes.recordset.length}. Detalle=${JSON.stringify(planRes.recordset)}`);

    if (planRes.recordset.length === 0) {
      logger.warn(`[HOOK:METROS] ⚠️ Sin plan activo para CliId=${CliIdCliente} ProId=${ProIdProducto} — Generando deuda monetaria por ${params.Importe}`);
      // Llama a generar deuda por el 100%
      if (params.Importe > 0) {
        await hookOrdenCreada({
          OrdIdOrden, CliIdCliente, Importe: params.Importe, MonIdMoneda: params.MonIdMoneda,
          CodigoOrden, NombreTrabajo: params.NombreTrabajo, UsuarioAlta, ProIdProducto: null
        }, transaction);
      }
      await transaction.commit();
      return;
    }

    let cantidadPendiente = Cantidad;
    let valorCubiertoPorPlanes = 0;

    // Obtener cotización si hay cruce de monedas
    const cotRes = await mkReq().query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC');
    const TC = cotRes.recordset.length > 0 ? parseFloat(cotRes.recordset[0].CotDolar) || 40.0 : 40.0;

    for (const plan of planRes.recordset) {
      if (cantidadPendiente <= 0) break;

      const total = parseFloat(plan.PlaCantidadTotal) || 0;
      const usada = parseFloat(plan.PlaCantidadUsada) || 0;
      const disponible = Math.round((total - usada) * 10000) / 10000;

      if (disponible <= 0) {
         const updateReqZero = new sql.Request(transaction);
         await updateReqZero.query(`UPDATE dbo.PlanesMetros SET PlaActivo = 0 WHERE PlaIdPlan = ${plan.PlaIdPlan}`);
         continue;
      }

      const consumir = Math.round(Math.min(cantidadPendiente, disponible) * 10000) / 10000;
      const nuevaUsada = Math.round((usada + consumir) * 10000) / 10000;
      const activo = nuevaUsada >= total ? 0 : 1;

      const updateReq = new sql.Request(transaction);
      await updateReq
        .input('P', sql.Int, plan.PlaIdPlan)
        .input('U', sql.Decimal(18,4), nuevaUsada)
        .input('A', sql.Bit, activo)
        .query(`UPDATE dbo.PlanesMetros SET PlaCantidadUsada = @U, PlaActivo = @A WHERE PlaIdPlan = @P`);

      await registrarMovimiento({
        CueIdCuenta: plan.CueIdCuenta,
        MovTipo:     'ENTREGA',
        MovConcepto: `${CodigoOrden} ${NombreTrabajo || ''}`.trim() || `Entrega Plan #${plan.PlaIdPlan}`,
        MovImporte:  -Math.abs(consumir),
        MovUsuarioAlta: UsuarioAlta,
        OrdIdOrden,
        MovObservaciones: `Plan #${plan.PlaIdPlan}`,
      }, transaction);

      cantidadPendiente = Math.round((cantidadPendiente - consumir) * 10000) / 10000;
      const restante = Math.round((total - nuevaUsada) * 10000) / 10000;

      // Calcular el valor financiero de los metros consumidos para restarlo a la deuda final
      const precioTotal = parseFloat(plan.PlaPrecioUnitario) || 0;
      let precioUnitarioPlan = total > 0 ? (precioTotal / total) : 0;
      
      if (plan.MonIdMoneda && params.MonIdMoneda && plan.MonIdMoneda !== params.MonIdMoneda && precioUnitarioPlan > 0) {
         if (plan.MonIdMoneda === 2 && params.MonIdMoneda === 1) { // Plan en USD, Orden en UYU -> multiplicar
             precioUnitarioPlan = precioUnitarioPlan * TC;
         } else if (plan.MonIdMoneda === 1 && params.MonIdMoneda === 2) { // Plan en UYU, Orden en USD -> dividir
             precioUnitarioPlan = precioUnitarioPlan / TC;
         }
      }
      valorCubiertoPorPlanes += (consumir * precioUnitarioPlan);

      logger.info(`[CONTABILIDAD] Metros descontados: ${consumir}. Plan ${plan.PlaIdPlan} → Restante: ${restante}`);

      if (restante > 0 && total > 0 && restante / total < 0.1) {
        logger.warn(`[CONTABILIDAD] ⚠️ Plan ${plan.PlaIdPlan} de CliId=${CliIdCliente} tiene menos del 10% restante (${restante} uds)`);
      }
    }

    // 3. Generar cargo monetario si no se cubrió todo con planes o si corresponde
    if (params.Importe > 0) {
      let deudaACobrar = params.Importe;

      if (cantidadPendiente > 0) {
        if (valorCubiertoPorPlanes > 0) {
           deudaACobrar = params.Importe - valorCubiertoPorPlanes;
           if (deudaACobrar < 0) deudaACobrar = 0; 
        } else {
           const porcentajeFaltante = cantidadPendiente / Cantidad;
           deudaACobrar = params.Importe * porcentajeFaltante;
        }
      } else {
         deudaACobrar = 0;
      }

      const deudaRedondeada = Math.round(deudaACobrar * 100) / 100;

      if (deudaRedondeada > 0) {
        logger.info(`[CONTABILIDAD] Planes consumidos. Faltaban ${cantidadPendiente} uds. Deuda original: ${params.Importe}, Valor cubierto: ${valorCubiertoPorPlanes}. Generando deuda por ${deudaRedondeada}.`);

        await hookOrdenCreada({
          OrdIdOrden,
          CliIdCliente,
          Importe: deudaRedondeada,
          MonIdMoneda: params.MonIdMoneda,
          CodigoOrden,
          NombreTrabajo: params.NombreTrabajo ? `${params.NombreTrabajo} (Saldo Faltante)` : 'Exceso de Plan (Saldo Faltante)',
          UsuarioAlta,
          ProIdProducto: null // evitamos loops
        }, transaction);
      }
    }

    await transaction.commit();
  } catch (err) {
    logger.error(`[HOOK:METROS] Falló hookEntregaMetros: ${err.message}`, err);
    try {
      await transaction.rollback();
    } catch (rollbackErr) {
      logger.error(`[HOOK:METROS] Error al hacer rollback: ${rollbackErr.message}`, rollbackErr);
    }
  }
}

// ============================================================
// SECCIÓN 6: CONSULTAS DE SALDO Y ESTADO
// ============================================================

/**
 * getSaldoCliente
 * Devuelve el saldo actual de todas las cuentas de un cliente.
 *
 * @param {number} CliIdCliente
 * @returns {Promise<Array>}
 */
async function getSaldoCliente(CliIdCliente) {
  const pool = await getPool();

  const result = await pool.request()
    .input('CliIdCliente', sql.Int, CliIdCliente)
    .query(`
      SELECT
        cc.CueIdCuenta,
        cc.CueTipo,
        cc.ProIdProducto,
        cc.CueSaldoActual,
        cc.CueLimiteCredito,
        cc.CuePuedeNegativo,
        cc.CueDiasCiclo,
        cc.CueCicloActivo,
        RTRIM(art.Descripcion)          AS NombreArticulo,
        u.UniDescripcionUnidad          AS UniNombreCompleto,
        u.[UniNotación]                 AS UniSimbolo,
        ISNULL(u.UniDescripcionUnidad, cc.CueTipo) AS UnidadLabel,
        CASE WHEN cc.ProIdProducto IS NOT NULL OR cc.CueTipo NOT IN ('USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU')
             THEN ISNULL(u.[UniNotación], 'mts') 
             ELSE ISNULL(mon.MonSimbolo, '$') END AS MonSimbolo,
        cp.CPaNombre    AS CondicionPago,
        ISNULL((
          SELECT SUM(DDeImportePendiente)
          FROM   dbo.DeudaDocumento
          WHERE  CueIdCuenta = cc.CueIdCuenta
            AND  DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL')
        ), 0) AS DeudaPendienteTotal,
        ISNULL((
          SELECT COUNT(*)
          FROM   dbo.DeudaDocumento
          WHERE  CueIdCuenta = cc.CueIdCuenta
            AND  DDeEstado = 'VENCIDO'
        ), 0) AS DocumentosVencidos
      FROM      dbo.CuentasCliente cc
      LEFT JOIN dbo.Articulos       art ON art.ProIdProducto = cc.ProIdProducto
      LEFT JOIN dbo.Unidades        u   ON u.UniIdUnidad     = art.UniIdUnidad
      LEFT JOIN dbo.Monedas         mon ON mon.MonIdMoneda   = cc.MonIdMoneda
      LEFT JOIN dbo.CondicionesPago cp  ON cp.CPaIdCondicion = cc.CPaIdCondicion
      WHERE cc.CliIdCliente = @CliIdCliente
        AND cc.CueActiva    = 1
      ORDER BY cc.CueTipo, art.Descripcion
    `);

  return result.recordset;
}

/**
 * getMovimientos
 * Devuelve el libro mayor de una cuenta con filtros de fecha.
 *
 * @param {number}  CueIdCuenta
 * @param {Date?}   FechaDesde
 * @param {Date?}   FechaHasta
 * @param {number?} Top         Límite de registros (default: 100)
 * @returns {Promise<{recordset: Array, saldoArrastre: number}>}
 */
async function getMovimientos(CueIdCuenta, FechaDesde = null, FechaHasta = null, Top = 100) {
  const pool = await getPool();

  const request = pool.request()
    .input('CueIdCuenta', sql.Int, CueIdCuenta)
    .input('Top', sql.Int, Top);

  let filtroFecha = '';
  if (FechaDesde) {
    request.input('FechaDesde', sql.Date, FechaDesde);
    filtroFecha += ' AND CAST(m.MovFecha AS DATE) >= @FechaDesde';
  }
  if (FechaHasta) {
    request.input('FechaHasta', sql.Date, FechaHasta);
    filtroFecha += ' AND CAST(m.MovFecha AS DATE) <= @FechaHasta';
  }

  // ── Saldo de arrastre ────────────────────────────────────────────────────
  // Si hay FechaDesde, calculamos el saldo acumulado de todos los movimientos
  // anteriores a esa fecha (NO anulados). Este es el "Saldo Inicial del período".
  // Si no hay filtro de fecha, el arrastre es 0 (historial completo desde el origen).
  let saldoArrastre = 0;
  if (FechaDesde) {
    const arrastreReq = pool.request()
      .input('CueIdCuentaA', sql.Int, CueIdCuenta)
      .input('FechaDesdeA', sql.Date, FechaDesde);

    const arrastreRes = await arrastreReq.query(`
      SELECT ISNULL(SUM(MovImporte), 0) AS SaldoArrastre
      FROM dbo.MovimientosCuenta WITH(NOLOCK)
      WHERE CueIdCuenta = @CueIdCuentaA
        AND CAST(MovFecha AS DATE) < @FechaDesdeA
        AND (MovAnulado IS NULL OR MovAnulado = 0)
    `);
    saldoArrastre = Number(arrastreRes.recordset[0]?.SaldoArrastre ?? 0);
  }

  const result = await request.query(`
    SELECT TOP (@Top)
      m.MovIdMovimiento,
      m.MovTipo,
      CASE 
        WHEN m.MovTipo = 'PAGO' AND m.PagIdPago IS NOT NULL THEN
          COALESCE(
            (SELECT 'Pago (' + ISNULL(mp.MPaDescripcionMetodo, 'Varios') + '): ' + STRING_AGG(CAST(
                 od.OrdCodigoOrden + 
                 CASE WHEN od.OrdNombreTrabajo IS NOT NULL AND od.OrdNombreTrabajo != 'S/N' AND LEN(RTRIM(od.OrdNombreTrabajo)) > 0 
                      THEN ' (' + RTRIM(od.OrdNombreTrabajo) + ')' 
                      ELSE '' 
                 END AS VARCHAR(MAX)), ', ')
             FROM dbo.Pagos p WITH(NOLOCK)
             LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON p.MPaIdMetodoPago = mp.MPaIdMetodoPago
             JOIN dbo.TransaccionDetalle td WITH(NOLOCK) ON td.TcaIdTransaccion = p.PagTcaIdTransaccion
             JOIN dbo.OrdenesRetiro ordRet WITH(NOLOCK) ON ordRet.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
             JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OReIdOrdenRetiro = ordRet.OReIdOrdenRetiro
             WHERE p.PagIdPago = m.PagIdPago
             GROUP BY mp.MPaDescripcionMetodo),
            (SELECT 'Pago (' + ISNULL(mp.MPaDescripcionMetodo, 'Varios') + '): ' + STRING_AGG(CAST(
                 od.OrdCodigoOrden + 
                 CASE WHEN od.OrdNombreTrabajo IS NOT NULL AND od.OrdNombreTrabajo != 'S/N' AND LEN(RTRIM(od.OrdNombreTrabajo)) > 0 
                      THEN ' (' + RTRIM(od.OrdNombreTrabajo) + ')' 
                      ELSE '' 
                 END AS VARCHAR(MAX)), ', ')
             FROM dbo.Pagos p WITH(NOLOCK)
             LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON p.MPaIdMetodoPago = mp.MPaIdMetodoPago
             JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.PagIdPago = m.PagIdPago
             WHERE p.PagIdPago = m.PagIdPago
             GROUP BY mp.MPaDescripcionMetodo),
            (SELECT 'Pago (' + ISNULL(mp.MPaDescripcionMetodo, 'Varios') + ')' 
             FROM dbo.Pagos p WITH(NOLOCK)
             LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON p.MPaIdMetodoPago = mp.MPaIdMetodoPago
             WHERE p.PagIdPago = m.PagIdPago),
            m.MovConcepto
          )
        ELSE m.MovConcepto
      END AS MovConcepto,
      m.MovImporte,
      m.MovSaldoPosterior,
      m.MovFecha,
      m.MovAnulado,
      m.OrdIdOrden,
      m.OReIdOrdenRetiro,
      m.PagIdPago,
      m.MovRefExterna,
      m.MovObservaciones,
      m.CicIdCiclo,
      COALESCE(dc.DocTipo, dcPago.DocTipo, tca.TcaTipoDocumento, '') AS DocTipo,
      COALESCE(dc.DocSerie, dcPago.DocSerie, tca.TcaSerieDoc, '') AS DocSerie,
      COALESCE(CAST(dc.DocNumero AS VARCHAR(50)), CAST(dcPago.DocNumero AS VARCHAR(50)), tca.TcaNumeroDoc, '') AS DocNumero,
      COALESCE(dc.CfeEstado, dcPago.CfeEstado) AS CfeEstado,
      COALESCE(dc.DocIdDocumento, dcPago.DocIdDocumento) AS DocIdDocumento,
      COALESCE(dc.DocPagado, dcPago.DocPagado, 0) AS DocPagado,
      COALESCE(dc.DocEstado, dcPago.DocEstado) AS DocEstado,
      COALESCE(dc.DocTotal, dcPago.DocTotal) AS DocTotal,
      COALESCE(dc.DocSubtotal, dcPago.DocSubtotal) AS DocSubtotal,
      CAST(
        CASE WHEN EXISTS (
          SELECT 1 
          FROM dbo.DeudaDocumento dd WITH(NOLOCK) 
          WHERE (
              (dd.OrdIdOrden = m.OrdIdOrden AND m.OrdIdOrden IS NOT NULL)
              OR 
              (dd.DocIdDocumento = m.DocIdDocumento AND m.DocIdDocumento IS NOT NULL)
            )
            AND dd.DDeImportePendiente > 0.01
        ) THEN 1 ELSE 0 END AS BIT
      ) AS EsPendientePago,
      COALESCE(
        (SELECT TOP 1 OrdCodigoOrden FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OrdIdOrden = m.OrdIdOrden),
        (SELECT TOP 1 OrdCodigoOrden FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OReIdOrdenRetiro = m.OReIdOrdenRetiro),
        m.MovRefExterna
      ) AS CodigoOrdenStr
    FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    LEFT JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagIdPago = m.PagIdPago
    LEFT JOIN dbo.TransaccionesCaja tca WITH(NOLOCK) ON tca.TcaIdTransaccion = p.PagTcaIdTransaccion
    LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento
    LEFT JOIN dbo.DocumentosContables dcPago WITH(NOLOCK) ON dcPago.TcaIdTransaccion = p.PagTcaIdTransaccion
    WHERE m.CueIdCuenta = @CueIdCuenta
      ${filtroFecha}
    ORDER BY m.MovFecha DESC, m.MovIdMovimiento DESC
  `);

  const records = result.recordset;

  // ─────────────────────────────────────────────────────────────────────────────
  // ── INYECCIÓN DE LÓGICA CONTABLE VISUAL (ESTADO DE CUENTA) DESDE EL BACKEND ──
  // ─────────────────────────────────────────────────────────────────────────────
  // El frontend ya no necesita calcular saldos iniciales ni finales.
  // Generamos una traza cronológica (ASC) desde el saldo de arrastre.
  const reversed = [...records].reverse();
  let runningSaldo = saldoArrastre;

  for (const m of reversed) {
    let isVisible = false;
    let importeVirtual = 0;

    if (m.MovAnulado) {
      isVisible = true;
      importeVirtual = 0;
    } else if (m.MovTipo === 'CIERRE_CICLO') {
      isVisible = true;
      const realImporte = Number(m.MovImporte);
      if (realImporte !== 0) {
        importeVirtual = realImporte;
      } else {
        // En CIERRE_CICLO, la deuda real se generó en las ORDENes previas.
        // Visualmente, agrupamos el total usando DocTotal (en negativo por ser cargo)
        importeVirtual = -(Math.abs(Number(m.DocTotal || 0)));
      }
    } else if (['PAGO', 'VTA_CAJA', 'SALDO_INICIAL', 'SALDO_A_FAVOR', 'COBRO', 'ANTICIPO', 'AJUSTE', 'AJUSTE_POS', 'AJUSTE_NEG', 'PAGO_CRUZADO'].includes(m.MovTipo)) {
      isVisible = true;
      importeVirtual = Number(m.MovImporte);
    } else if (['NOTA_CREDITO', 'REVERSO', 'DEVOLUCION'].includes(m.MovTipo)) {
      isVisible = true;
      importeVirtual = Math.abs(Number(m.MovImporte));
    } else if (['ORDEN', 'ENTREGA'].includes(m.MovTipo)) {
      isVisible = false;
      importeVirtual = 0;
    } else {
      // Fallback genérico para tipos desconocidos que impacten el saldo
      if (Number(m.MovImporte) !== 0) {
          isVisible = true;
          importeVirtual = Number(m.MovImporte);
      }
    }

    if (isVisible) {
      m.visualSaldoAntes = runningSaldo;
      runningSaldo += importeVirtual;
      m.visualSaldoDespues = runningSaldo;
    } else {
      m.visualSaldoAntes = runningSaldo;
      m.visualSaldoDespues = runningSaldo;
    }

    m.visualIsVisible = isVisible;
    m.visualImporte = importeVirtual;
  }

  // Restaurar el orden original DESC
  const finalData = reversed.reverse();

  return { data: finalData, saldoArrastre };
}

/**
 * getDeudas
 * Devuelve los documentos de deuda pendientes de una cuenta.
 *
 * @param {number}   CueIdCuenta
 * @param {string?}  SoloEstado  'PENDIENTE' | 'VENCIDO' | 'PARCIAL' | null (todos)
 * @returns {Promise<Array>}
 */
async function getDeudas(CueIdCuenta, SoloEstado = null) {
  const pool = await getPool();

  const request = pool.request().input('CueIdCuenta', sql.Int, CueIdCuenta);
  let filtroEstado = '';

  if (SoloEstado) {
    request.input('Estado', sql.VarChar(20), SoloEstado);
    filtroEstado = "AND DDeEstado = @Estado";
  } else {
    filtroEstado = "AND DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL')";
  }

  const result = await request.query(`
    SELECT
      d.DDeIdDocumento,
      d.OrdIdOrden,
      COALESCE(
        od.OrdCodigoOrden, 
        ordERP.CodigoOrden,
        (SELECT TOP 1 ISNULL(od2.OrdCodigoOrden, td.TdeCodigoReferencia)
         FROM dbo.TransaccionDetalle td WITH(NOLOCK)
         JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.TcaIdTransaccion = td.TcaIdTransaccion
         LEFT JOIN dbo.OrdenesRetiro ordRet WITH(NOLOCK) ON ordRet.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
         LEFT JOIN dbo.OrdenesDeposito od2 WITH(NOLOCK) ON od2.OReIdOrdenRetiro = ordRet.OReIdOrdenRetiro
         WHERE doc.DocIdDocumento = d.DocIdDocumento),
        CASE WHEN docPrincipal.DocTipo IS NOT NULL THEN CONCAT(docPrincipal.DocTipo, ' ', docPrincipal.DocSerie, '-', docPrincipal.DocNumero) ELSE NULL END,
        'VTA-DIR'
      ) AS CodigoOrden,
      COALESCE(
        od.OrdNombreTrabajo, 
        ordERP.DescripcionTrabajo,
        (SELECT TOP 1 od2.OrdNombreTrabajo
         FROM dbo.TransaccionDetalle td WITH(NOLOCK)
         JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.TcaIdTransaccion = td.TcaIdTransaccion
         LEFT JOIN dbo.OrdenesRetiro ordRet WITH(NOLOCK) ON ordRet.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
         LEFT JOIN dbo.OrdenesDeposito od2 WITH(NOLOCK) ON od2.OReIdOrdenRetiro = ordRet.OReIdOrdenRetiro
         WHERE doc.DocIdDocumento = d.DocIdDocumento
         AND od2.OrdNombreTrabajo IS NOT NULL AND od2.OrdNombreTrabajo != 'S/N'
        ),
        docPrincipal.DocTipo,
        'Venta Directa'
      ) AS NombreTrabajo,
      d.DDeImporteOriginal,
      d.DDeImportePendiente,
      d.DDeFechaEmision,
      d.DDeFechaVencimiento,
      d.DDeCuotaNumero,
      d.DDeCuotaTotal,
      d.DDeEstado,
      DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE()) AS DiasVencido
    FROM dbo.DeudaDocumento d WITH(NOLOCK)
    LEFT JOIN dbo.DocumentosContables docPrincipal WITH(NOLOCK) ON docPrincipal.DocIdDocumento = d.DocIdDocumento
    LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = d.OrdIdOrden
    LEFT JOIN dbo.Ordenes ordERP WITH(NOLOCK) ON ordERP.OrdenID = d.OrdIdOrden
    WHERE d.CueIdCuenta = @CueIdCuenta
      ${filtroEstado}
    ORDER BY d.DDeFechaVencimiento ASC
  `);

  return result.recordset;
}

/**
 * getDeudasPorCliente
 * Devuelve todos los documentos de deuda pendientes de un cliente.
 */
async function getDeudasPorCliente(CliIdCliente, modo = 'TODO') {
  const pool = await getPool();

  let filtroCondicion = '';
  if (modo === 'OFICIAL') {
    filtroCondicion = 'AND d.DocIdDocumento IS NOT NULL';
  } else if (modo === 'WIP') {
    filtroCondicion = 'AND d.DocIdDocumento IS NULL AND d.OrdIdOrden IS NOT NULL';
  }

  const result = await pool.request()
    .input('CliIdCliente', sql.Int, parseInt(CliIdCliente))
    .query(`
      SELECT
        d.DDeIdDocumento,
        d.OrdIdOrden,
        d.DocIdDocumento,
        COALESCE(
          (SELECT doc.DocNumero FROM dbo.DocumentosContables doc WITH(NOLOCK) WHERE doc.DocIdDocumento = d.DocIdDocumento AND doc.DocTipo = 'FACTURA'),
          od.OrdCodigoOrden, 
          ordERP.CodigoOrden,
          -- Buscar ordenes asociadas a la transacción del documento
          (SELECT TOP 1 ISNULL(od2.OrdCodigoOrden, td.TdeCodigoReferencia)
           FROM dbo.TransaccionDetalle td WITH(NOLOCK)
           JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.TcaIdTransaccion = td.TcaIdTransaccion
           LEFT JOIN dbo.OrdenesRetiro ordRet WITH(NOLOCK) ON ordRet.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
           LEFT JOIN dbo.OrdenesDeposito od2 WITH(NOLOCK) ON od2.OReIdOrdenRetiro = ordRet.OReIdOrdenRetiro
           WHERE doc.DocIdDocumento = d.DocIdDocumento),
          'VTA-DIR'
        ) AS CodigoOrden,
        COALESCE(
          (SELECT 'Ciclo Semanal ' + FORMAT(doc.DocFechaDesde, 'dd/MM/yyyy HH:mm') + ' al ' + FORMAT(doc.DocFechaHasta, 'dd/MM/yyyy HH:mm') FROM dbo.DocumentosContables doc WITH(NOLOCK) WHERE doc.DocIdDocumento = d.DocIdDocumento AND doc.DocTipo = 'FACTURA'),
          od.OrdNombreTrabajo, 
          ordERP.DescripcionTrabajo,
          -- Buscar nombre de trabajo asociado a la transacción del documento
          (SELECT TOP 1 od2.OrdNombreTrabajo
           FROM dbo.TransaccionDetalle td WITH(NOLOCK)
           JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.TcaIdTransaccion = td.TcaIdTransaccion
           LEFT JOIN dbo.OrdenesRetiro ordRet WITH(NOLOCK) ON ordRet.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
           LEFT JOIN dbo.OrdenesDeposito od2 WITH(NOLOCK) ON od2.OReIdOrdenRetiro = ordRet.OReIdOrdenRetiro
           WHERE doc.DocIdDocumento = d.DocIdDocumento
           AND od2.OrdNombreTrabajo IS NOT NULL AND od2.OrdNombreTrabajo != 'S/N'
          ),
          'Venta Directa'
        ) AS NombreTrabajo,
        d.DDeImporteOriginal,
        d.DDeImportePendiente,
        d.DDeFechaEmision,
        d.DDeFechaVencimiento,
        d.DDeEstado,
        cc.CueTipo,
        ISNULL(mon.MonSimbolo, '$U') AS MonSimbolo,
        DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE()) AS DiasVencido,
        (SELECT c.CicSaldoFacturar FROM dbo.DocumentosContables dc WITH(NOLOCK) JOIN dbo.CiclosCredito c WITH(NOLOCK) ON c.CicIdCiclo = dc.CicIdCiclo WHERE dc.DocIdDocumento = d.DocIdDocumento AND dc.DocTipo = 'FACTURA') AS CicSaldoFacturar,
        (SELECT c.CicTotalOrdenes FROM dbo.DocumentosContables dc WITH(NOLOCK) JOIN dbo.CiclosCredito c WITH(NOLOCK) ON c.CicIdCiclo = dc.CicIdCiclo WHERE dc.DocIdDocumento = d.DocIdDocumento AND dc.DocTipo = 'FACTURA') AS CicTotalOrdenes,
        (SELECT c.CicTotalPagos FROM dbo.DocumentosContables dc WITH(NOLOCK) JOIN dbo.CiclosCredito c WITH(NOLOCK) ON c.CicIdCiclo = dc.CicIdCiclo WHERE dc.DocIdDocumento = d.DocIdDocumento AND dc.DocTipo = 'FACTURA') AS CicTotalPagos,
        (SELECT 
            m.OrdIdOrden,
            ISNULL(od.OrdCodigoOrden, erp.CodigoOrden) as CodigoOrden,
            ABS(m.MovImporte) as Importe,
            m.MovConcepto as Concepto
         FROM dbo.MovimientosCuenta m WITH(NOLOCK)
         LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = m.OrdIdOrden
         LEFT JOIN dbo.Ordenes erp WITH(NOLOCK) ON erp.OrdenID = m.OrdIdOrden
         WHERE (
            (d.DocIdDocumento IS NOT NULL AND m.CicIdCiclo = (SELECT CicIdCiclo FROM dbo.DocumentosContables dc WITH(NOLOCK) WHERE dc.DocIdDocumento = d.DocIdDocumento))
            OR
            (d.DocIdDocumento IS NULL AND m.OrdIdOrden = d.OrdIdOrden)
         )
           AND m.MovTipo = 'ORDEN' AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
         FOR JSON PATH) AS SubOrdenesJSON
      FROM dbo.DeudaDocumento d WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = d.CueIdCuenta
      LEFT JOIN dbo.Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = cc.MonIdMoneda
      LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = d.OrdIdOrden
      LEFT JOIN dbo.Ordenes ordERP WITH(NOLOCK) ON ordERP.OrdenID = d.OrdIdOrden
      WHERE cc.CliIdCliente = @CliIdCliente
        AND d.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')
        AND d.DDeImportePendiente > 0.01
      ORDER BY d.DDeFechaVencimiento ASC
    `);

  return result.recordset.map(r => ({
    ...r,
    SubOrdenes: r.SubOrdenesJSON ? JSON.parse(r.SubOrdenesJSON) : []
  }));
}

/**
 * getTodasLasDeudasVivas
 * Devuelve todos los documentos de deuda pendientes de TODOS los clientes.
 */
async function getTodasLasDeudasVivas() {
  const pool = await getPool();
  const result = await pool.request()
    .query(`
      SELECT
        d.DDeIdDocumento,
        d.OrdIdOrden,
        d.DocIdDocumento,
        COALESCE(
          (SELECT CONCAT(doc.DocTipo, ' ', doc.DocSerie, '-', doc.DocNumero) FROM dbo.DocumentosContables doc WITH(NOLOCK) WHERE doc.DocIdDocumento = d.DocIdDocumento),
          od.OrdCodigoOrden, ordERP.CodigoOrden, (SELECT TOP 1 ISNULL(od2.OrdCodigoOrden, td.TdeCodigoReferencia)
           FROM dbo.TransaccionDetalle td
           JOIN dbo.DocumentosContables doc ON doc.TcaIdTransaccion = td.TcaIdTransaccion
           LEFT JOIN dbo.OrdenesRetiro ordRet ON ordRet.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
           LEFT JOIN dbo.OrdenesDeposito od2 ON od2.OReIdOrdenRetiro = ordRet.OReIdOrdenRetiro
           WHERE doc.DocIdDocumento = d.DocIdDocumento), 'VTA-DIR') AS CodigoOrden,
        COALESCE(
          (SELECT 'Ciclo Semanal ' + FORMAT(doc.DocFechaDesde, 'dd/MM/yyyy HH:mm') + ' al ' + FORMAT(doc.DocFechaHasta, 'dd/MM/yyyy HH:mm') FROM dbo.DocumentosContables doc WITH(NOLOCK) WHERE doc.DocIdDocumento = d.DocIdDocumento AND doc.DocTipo IN ('FACTURA', 'E-TICKET CREDITO', 'E-TICKET CONTADO')),
          (SELECT doc.DocTipo FROM dbo.DocumentosContables doc WITH(NOLOCK) WHERE doc.DocIdDocumento = d.DocIdDocumento),
          od.OrdNombreTrabajo, 
          ordERP.DescripcionTrabajo,
          (SELECT TOP 1 ISNULL(od2.OrdNombreTrabajo, td.TdeDescripcion)
           FROM dbo.TransaccionDetalle td
           JOIN dbo.DocumentosContables doc ON doc.TcaIdTransaccion = td.TcaIdTransaccion
           LEFT JOIN dbo.OrdenesRetiro ordRet ON ordRet.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
           LEFT JOIN dbo.OrdenesDeposito od2 ON od2.OReIdOrdenRetiro = ordRet.OReIdOrdenRetiro
           WHERE doc.DocIdDocumento = d.DocIdDocumento),
          'Venta Directa'
        ) AS NombreTrabajo,
        d.DDeImporteOriginal,
        d.DDeImportePendiente,
        d.DDeFechaEmision,
        d.DDeFechaVencimiento,
        d.DDeEstado,
        cc.CueTipo,
        ISNULL(mon.MonSimbolo, '$U') AS MonSimbolo,
        DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE()) AS DiasVencido,
        cli.CliIdCliente,
        cli.Nombre AS ClienteNombre,
        cli.CodCliente AS ClienteCodigo,
        (SELECT 
            m.OrdIdOrden,
            ISNULL(od.OrdCodigoOrden, erp.CodigoOrden) as CodigoOrden,
            ABS(m.MovImporte) as Importe,
            m.MovConcepto as Concepto
         FROM dbo.MovimientosCuenta m WITH(NOLOCK)
         LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = m.OrdIdOrden
         LEFT JOIN dbo.Ordenes erp WITH(NOLOCK) ON erp.OrdenID = m.OrdIdOrden
         WHERE (
            (d.DocIdDocumento IS NOT NULL AND m.CicIdCiclo = (SELECT CicIdCiclo FROM dbo.DocumentosContables dc WITH(NOLOCK) WHERE dc.DocIdDocumento = d.DocIdDocumento))
            OR
            (d.DocIdDocumento IS NULL AND m.OrdIdOrden = d.OrdIdOrden)
         )
           AND m.MovTipo = 'ORDEN' AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
         FOR JSON PATH) AS SubOrdenesJSON
      FROM dbo.DeudaDocumento d WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = d.CueIdCuenta
      JOIN dbo.Clientes cli WITH(NOLOCK) ON cli.CliIdCliente = cc.CliIdCliente
      LEFT JOIN dbo.Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = cc.MonIdMoneda
      LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = d.OrdIdOrden
      LEFT JOIN dbo.Ordenes ordERP WITH(NOLOCK) ON ordERP.OrdenID = d.OrdIdOrden
      WHERE d.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')
        AND d.DDeImportePendiente > 0.01
      ORDER BY cli.Nombre ASC, d.DDeFechaVencimiento ASC
    `);

  return result.recordset.map(r => ({
    ...r,
    SubOrdenes: r.SubOrdenesJSON ? JSON.parse(r.SubOrdenesJSON) : []
  }));
}


/**
 * getAntiguedadDeuda
 * Tabla de antigüedad de deuda para todos los clientes activos.
 * Agrupa en tramos: Al día / 1-30 / 31-60 / 61-90 / +90 días.
 *
 * @returns {Promise<Array>}
 */
async function getAntiguedadDeuda(modo = 'TODO') {
  const pool = await getPool();

  let filtroCondicion = '';
  if (modo === 'OFICIAL') {
    filtroCondicion = 'AND d.DocIdDocumento IS NOT NULL';
  } else if (modo === 'WIP') {
    filtroCondicion = 'AND d.DocIdDocumento IS NULL AND d.OrdIdOrden IS NOT NULL';
  }

  const result = await pool.request().query(`
    SELECT
      c.CliIdCliente,
      cli.Nombre                                    AS NombreCliente,
      c.CueTipo,
      ISNULL(mon.MonSimbolo, '$U')                  AS MonSimbolo,
      c.CueTipo                                     AS Moneda,
      -- Al día (no vencido o sin vencer)
      ISNULL(SUM(CASE WHEN DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE()) <= 0
                      THEN d.DDeImportePendiente ELSE 0 END), 0) AS AlDia,
      -- 1 a 30 días vencido
      ISNULL(SUM(CASE WHEN DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE()) BETWEEN 1  AND 30
                      THEN d.DDeImportePendiente ELSE 0 END), 0) AS Dias1_30,
      -- 31 a 60 días vencido
      ISNULL(SUM(CASE WHEN DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE()) BETWEEN 31 AND 60
                      THEN d.DDeImportePendiente ELSE 0 END), 0) AS Dias31_60,
      -- 61 a 90 días vencido
      ISNULL(SUM(CASE WHEN DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE()) BETWEEN 61 AND 90
                      THEN d.DDeImportePendiente ELSE 0 END), 0) AS Dias61_90,
      -- Más de 90 días vencido
      ISNULL(SUM(CASE WHEN DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE()) > 90
                      THEN d.DDeImportePendiente ELSE 0 END), 0) AS Mas90,
      -- Total pendiente
      ISNULL(SUM(d.DDeImportePendiente), 0)         AS TotalDeuda
    FROM      dbo.CuentasCliente c
    JOIN      dbo.Clientes       cli ON cli.CliIdCliente = c.CliIdCliente
    LEFT JOIN dbo.Monedas        mon ON mon.MonIdMoneda  = c.MonIdMoneda
    JOIN      dbo.DeudaDocumento d   ON d.CueIdCuenta   = c.CueIdCuenta
                                    AND d.DDeEstado IN ('PENDIENTE', 'VENCIDO', 'PARCIAL')
                                    ${filtroCondicion}
    WHERE c.CueActiva = 1
      AND c.CueTipo IN ('DINERO_UYU', 'DINERO_USD', 'CORRIENTE')
    GROUP BY c.CliIdCliente, cli.Nombre, c.CueTipo, mon.MonSimbolo
    HAVING SUM(d.DDeImportePendiente) > 0
    ORDER BY TotalDeuda DESC
  `);

  return result.recordset;
}


// ============================================================
// SECCIÓN 7: CICLOS DE CRÉDITO (CLIENTES SEMANALES)
// ============================================================

/**
 * obtenerCicloActivo
 * Devuelve el ciclo ABIERTO de una cuenta, si existe.
 * @param {number} CueIdCuenta
 * @returns {Promise<object|null>}
 */
async function obtenerCicloActivo(CueIdCuenta, transaction = null) {
  const pool = await getPool();
  const req = transaction ? new sql.Request(transaction) : pool.request();
  const res  = await req
    .input('CueIdCuenta', sql.Int, CueIdCuenta)
    .query(`
      SELECT TOP 1
        CicIdCiclo, CueIdCuenta, CliIdCliente,
        CicFechaInicio, CicFechaCierre, CicDiasAprobados,
        CicTotalOrdenes, CicTotalPagos, CicSaldoFacturar, CicEstado
      FROM dbo.CiclosCredito WITH(NOLOCK)
      WHERE CueIdCuenta = @CueIdCuenta
        AND CicEstado = 'ABIERTO'
      ORDER BY CicFechaInicio DESC
    `);
  return res.recordset[0] || null;
}

/**
 * getCicloMovimientos
 * Devuelve todos los movimientos de ordenes asociados a un ciclo.
 */
async function getCicloMovimientos(CicIdCiclo) {
  const pool = await getPool();
  const res = await pool.request()
    .input('CicIdCiclo', sql.Int, CicIdCiclo)
    .query(`
      SELECT m.MovIdMovimiento, m.MovTipo, m.MovConcepto, m.MovImporte, m.MovFecha,
             m.OrdIdOrden, m.OReIdOrdenRetiro, m.PagIdPago, m.MovObservaciones, m.DocIdDocumento,
             COALESCE(od.OrdCodigoOrden, erp.CodigoOrden) AS OrdCodigoOrden,
             COALESCE(od.OrdNombreTrabajo, erp.DescripcionTrabajo) AS OrdNombreTrabajo,
             ISNULL(od.OrdCantidad, 1) AS OrdCantidad,
             ISNULL(od.OrdDescuentoAplicado, 0) AS OrdDescuentoAplicado,
             od.OrdMaterialPlanilla,
             p.Descripcion AS ProNombre,
             s.Articulo AS ProSubFamilia,
             s.CodStock AS ProCodStock,
              (
                 SELECT d.ID AS DetalleID, a.CodArticulo, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.LogPrecioAplicado, a.Descripcion, pc.Moneda, a.CodStock, sa.Articulo AS ArticuloNombre
                 FROM dbo.PedidosCobranza pc WITH(NOLOCK)
                 JOIN dbo.PedidosCobranzaDetalle d WITH(NOLOCK) ON pc.ID = d.PedidoCobranzaID
                 LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = d.ProIdProducto
                 LEFT JOIN dbo.StockArt sa WITH(NOLOCK) ON a.CodStock = sa.CodStock
                 WHERE LTRIM(RTRIM(pc.NoDocERP)) = COALESCE(od.OrdCodigoOrden, erp.CodigoOrden)
                 FOR JSON PATH
              ) AS DetallesJSON
      FROM dbo.MovimientosCuenta m WITH(NOLOCK)
      LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON m.OrdIdOrden = od.OrdIdOrden
      LEFT JOIN dbo.Ordenes erp WITH(NOLOCK) ON erp.OrdenID = m.OrdIdOrden
      LEFT JOIN dbo.Articulos p WITH(NOLOCK) ON od.ProIdProducto = p.ProIdProducto
      LEFT JOIN dbo.StockArt s WITH(NOLOCK) ON p.CodStock = s.CodStock
      WHERE m.CicIdCiclo = @CicIdCiclo
        AND m.MovTipo IN ('ORDEN', 'PAGO', 'ANTICIPO')
        AND m.DocIdDocumento IS NULL        -- excluir ya facturados individualmente (VTA_CAJA y su pago)
        AND ABS(m.MovImporte) > 0           -- excluir órdenes cubiertas por plan ($0 sin deuda monetaria)
      ORDER BY m.MovFecha DESC
    `);
  return res.recordset;
}

/**
 * abrirCicloPorCuenta
 * Abre un nuevo ciclo de crédito para una cuenta.
 * Calcula la fecha de cierre basándose en CueDiasCiclo.
 * Si ya tiene uno abierto, lo devuelve sin crear uno nuevo.
 *
 * @param {object} params
 *   @param {number} CueIdCuenta
 *   @param {number} CliIdCliente
 *   @param {number} UsuarioAlta
 *   @param {Date?}  FechaInicio    default = hoy
 * @returns {Promise<{CicIdCiclo, esNuevo}>}
 */
async function abrirCicloPorCuenta({ CueIdCuenta, CliIdCliente, UsuarioAlta, FechaInicio = null }, transaction = null) {
  const pool = await getPool();
  const mkReq = () => transaction ? new sql.Request(transaction) : pool.request();

  // Verificar si ya tiene uno abierto
  const existente = await obtenerCicloActivo(CueIdCuenta, transaction);
  if (existente) {
    logger.info(`[CICLO] CueIdCuenta=${CueIdCuenta} ya tiene ciclo abierto CicIdCiclo=${existente.CicIdCiclo}`);
    return { CicIdCiclo: existente.CicIdCiclo, esNuevo: false };
  }

  // Obtener CueDiasCiclo de la cuenta
  const cuentaRes = await mkReq()
    .input('CueIdCuenta', sql.Int, CueIdCuenta)
    .query(`SELECT ISNULL(CueDiasCiclo, 7) AS Dias FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueIdCuenta`);

  const dias = cuentaRes.recordset[0]?.Dias ?? 7;
  const fechaIni = FechaInicio ? new Date(FechaInicio) : new Date();

  const insertRes = await mkReq()
    .input('CueIdCuenta',      sql.Int,  CueIdCuenta)
    .input('CliIdCliente',     sql.Int,  CliIdCliente)
    .input('CicFechaInicio',   sql.DateTime, fechaIni)
    .input('CicFechaCierre',   sql.DateTime, null)
    .input('CicDiasAprobados', sql.Int,  dias)
    .input('UsuarioAlta',      sql.Int,  UsuarioAlta)
    .query(`
      INSERT INTO dbo.CiclosCredito
        (CueIdCuenta, CliIdCliente, CicFechaInicio, CicFechaCierre,
         CicDiasAprobados, CicTotalOrdenes, CicTotalPagos,
         CicEstado, CicUsuarioApertura)
      OUTPUT INSERTED.CicIdCiclo
      VALUES
        (@CueIdCuenta, @CliIdCliente, @CicFechaInicio, @CicFechaCierre,
         @CicDiasAprobados, 0, 0,
         'ABIERTO', @UsuarioAlta)
    `);

  const CicIdCiclo = insertRes.recordset[0].CicIdCiclo;

  // Absolver movimientos anteriores que no tengan ciclo asignado y sean facturables (de la semana o recientes)
  await mkReq()
    .input('CicIdCiclo', sql.Int, CicIdCiclo)
    .input('CueIdCuenta', sql.Int, CueIdCuenta)
    .query(`
      UPDATE dbo.MovimientosCuenta
      SET CicIdCiclo = @CicIdCiclo
      WHERE CueIdCuenta = @CueIdCuenta
        AND CicIdCiclo IS NULL
        AND MovTipo IN ('ORDEN', 'ENTREGA', 'ORDEN_ANTICIPO', 'PAGO', 'PAGO_CRUZADO', 'ANTICIPO', 'COBRO', 'SALDO_A_FAVOR')
        AND MovFecha >= DATEADD(month, -1, GETDATE())
    `);
    
  // Recalcular CicTotalOrdenes y CicTotalPagos para el ciclo recién creado por si absorbió movimientos
  await mkReq()
    .input('CicIdCiclo', sql.Int, CicIdCiclo)
    .query(`
      UPDATE c
      SET 
        c.CicTotalOrdenes = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta WHERE CicIdCiclo = c.CicIdCiclo AND MovTipo IN ('ORDEN', 'ENTREGA', 'ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado = 0)), 0),
        c.CicTotalPagos   = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta WHERE CicIdCiclo = c.CicIdCiclo AND MovTipo IN ('PAGO', 'PAGO_CRUZADO', 'ANTICIPO', 'COBRO', 'SALDO_A_FAVOR') AND (MovAnulado IS NULL OR MovAnulado = 0)), 0)
      FROM dbo.CiclosCredito c
      WHERE c.CicIdCiclo = @CicIdCiclo
    `);

  logger.info(`[CICLO] Ciclo ABIERTO: CicIdCiclo=${CicIdCiclo} CueIdCuenta=${CueIdCuenta} (Sin fecha de cierre fija)`);
  return { CicIdCiclo, esNuevo: true };
}

/**
 * acumularEnCiclo
 * Acumula un importe en el campo especificado del ciclo activo.
 * @param {number} CicIdCiclo
 * @param {'ORDEN'|'PAGO'|'PAGO_CRUZADO'|'ANTICIPO'|'COBRO'|'SALDO_A_FAVOR'} tipo
 * @param {number} importe   (siempre positivo)
 */
async function acumularEnCiclo(CicIdCiclo, tipo, importe, transaction = null) {
  const pool  = await getPool();
  const req = transaction ? new sql.Request(transaction) : pool.request();
  const campo = ['PAGO', 'PAGO_CRUZADO', 'ANTICIPO', 'COBRO', 'SALDO_A_FAVOR'].includes(tipo) ? 'CicTotalPagos' : 'CicTotalOrdenes';

  await req
    .input('CicIdCiclo', sql.Int,          CicIdCiclo)
    .input('Importe',    sql.Decimal(18,4), Math.abs(importe))
    .query(`UPDATE dbo.CiclosCredito SET ${campo} = ${campo} + @Importe WHERE CicIdCiclo = @CicIdCiclo`);
}

/**
 * cerrarCicloCompleto
 * Cierra un ciclo de crédito:
 *   1. Extrae los movimientos excluidos (si los hay) y los mueve al próximo ciclo
 *   2. Recalcula CicSaldoFacturar = TotalOrdenes - TotalPagos (restando excluidos)
 *   3. Genera un DocumentoContable tipo FACTURA
 *   4. Crea un DeudaDocumento por el saldo a cobrar
 *   5. Registra movimiento de cierre en el libro mayor
 *   6. Abre automáticamente el ciclo siguiente
 *
 * @param {object} params
 *   @param {number} CicIdCiclo
 *   @param {number} UsuarioAlta
 *   @param {number[]} excluidos Array de MovIdMovimiento que no se van a facturar en este ciclo
 * @returns {Promise<{DocIdDocumento, SaldoFacturar, nuevoCiclo}>}
 */
async function cerrarCicloCompleto({ 
  CicIdCiclo, 
  UsuarioAlta, 
  excluidos = [],
  monedaFactura,
  cotDolar = 40,
  descuentoTipo,
  descuentoValorBase = 0,
  montoDescuentoCalculado = 0,
  detallesEditados = [],
  detallesParaPDF = [],
  tipoDocumento = 'E-TICKET CREDITO',
  observaciones = '',
  cliDgiNombre = null,
  cliDgiDocumento = null,
  cliDgiDireccion = null,
  cliDgiCiudad = null,
  actualizarCliente = false
}) {
  const pool = await getPool();

  // 0. Procesar ediciones manuales de detalles
  if (detallesEditados && detallesEditados.length > 0) {
    for (const d of detallesEditados) {
      // 1. Obtener el PedidoCobranzaID y los valores actuales
      const detRes = await pool.request().input('ID', sql.Int, d.DetalleID).query(`
        SELECT PedidoCobranzaID, PrecioUnitarioOriginal, SubtotalOriginal, LogPrecioAplicado
        FROM dbo.PedidosCobranzaDetalle WHERE ID = @ID
      `);
      if (detRes.recordset.length > 0) {
        const { PedidoCobranzaID, LogPrecioAplicado } = detRes.recordset[0];
        
        // Agregar etiqueta al log
        const logTag = '[Ajuste manual Cierre Ciclo]';
        let nuevoLog = LogPrecioAplicado ? LogPrecioAplicado : '';
        if (!nuevoLog.includes(logTag)) {
          nuevoLog += ` ${logTag}`;
        }
        
        // 2. Actualizar detalle
        await pool.request()
          .input('ID', sql.Int, d.DetalleID)
          .input('Precio', sql.Decimal(18,4), d.PrecioUnitario)
          .input('Subtotal', sql.Decimal(18,4), d.Subtotal)
          .input('Log', sql.NVarChar(sql.MAX), nuevoLog)
          .query(`
            UPDATE dbo.PedidosCobranzaDetalle
            SET PrecioUnitario = @Precio, Subtotal = @Subtotal, LogPrecioAplicado = @Log
            WHERE ID = @ID
          `);
          
        // 3. Recalcular MontoTotal de PedidosCobranza
        await pool.request().input('PID', sql.Int, PedidoCobranzaID).query(`
          UPDATE dbo.PedidosCobranza
          SET MontoTotal = (SELECT ISNULL(SUM(Subtotal),0) FROM dbo.PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID)
          WHERE ID = @PID
        `);
        
        // 4. Actualizar el MovImporte en MovimientosCuenta asociado a esta Orden
        await pool.request().input('PID', sql.Int, PedidoCobranzaID).input('CicIdCiclo', sql.Int, CicIdCiclo).query(`
          UPDATE m
          SET m.MovImporte = - (SELECT MontoTotal FROM dbo.PedidosCobranza WHERE ID = @PID)
          FROM dbo.MovimientosCuenta m
          JOIN dbo.Ordenes erp ON erp.OrdenID = m.OrdIdOrden
          JOIN dbo.PedidosCobranza pc ON LTRIM(RTRIM(pc.NoDocERP)) = erp.CodigoOrden
          WHERE pc.ID = @PID AND m.MovTipo = 'ORDEN' AND m.CicIdCiclo = @CicIdCiclo
        `);
      }
    }
  }

  // 1. Leer el ciclo
  const cicloRes = await pool.request()
    .input('CicIdCiclo', sql.Int, CicIdCiclo)
    .query(`
      SELECT c.*, cc.CueDiasCiclo, cc.MonIdMoneda
      FROM dbo.CiclosCredito c
      JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = c.CueIdCuenta
      WHERE c.CicIdCiclo = @CicIdCiclo
    `);

  if (!cicloRes.recordset.length)
    throw new Error(`Ciclo ${CicIdCiclo} no encontrado.`);

  const ciclo = cicloRes.recordset[0];
  if (ciclo.CicEstado !== 'ABIERTO' && ciclo.CicEstado !== 'VENCIDO')
    throw new Error(`Ciclo ${CicIdCiclo} está en estado ${ciclo.CicEstado}, no se puede cerrar.`);

  if (actualizarCliente) {
    await pool.request()
      .input('CliIdCliente', sql.Int, ciclo.CliIdCliente)
      .input('CioRuc', sql.VarChar, cliDgiDocumento || '')
      .input('Direccion', sql.VarChar, cliDgiDireccion || '')
      .input('Ciudad', sql.Int, Number(cliDgiCiudad) || 10)
      .input('Nombre', sql.VarChar, cliDgiNombre || '')
      .query(`
        UPDATE dbo.Clientes
        SET CioRuc = @CioRuc,
            DireccionTrabajo = @Direccion,
            DepartamentoID = @Ciudad,
            Nombre = @Nombre,
            NombreFantasia = @Nombre
        WHERE CliIdCliente = @CliIdCliente
      `);
  }

  // Procesar Excluidos ANTES de cerrar y calcular totales en vivo
  let sumExcluidosOrdenes = 0;
  let sumExcluidosPagos = 0;
  let totalOrdenesCiclo = 0;
  let totalPagosCiclo = 0;

  const resMovs = await pool.request().input('CicIdCiclo', sql.Int, CicIdCiclo).query(`
    SELECT MovIdMovimiento, MovImporte, MovTipo, DocIdDocumento
    FROM   dbo.MovimientosCuenta
    WHERE  CicIdCiclo = @CicIdCiclo
      AND  (MovAnulado IS NULL OR MovAnulado = 0)
      AND  MovTipo    != 'CIERRE_CICLO'
      AND  MovImporte  < 0              -- SOLO órdenes/débitos. Los pagos son operaciones separadas.
      AND  DocIdDocumento IS NULL       -- excluir órdenes ya facturadas individualmente
  `);
  
  const excluidosSet = new Set(excluidos || []);
  for (const m of resMovs.recordset) {
    totalOrdenesCiclo += Math.abs(m.MovImporte);
    if (excluidosSet.has(m.MovIdMovimiento)) sumExcluidosOrdenes += Math.abs(m.MovImporte);
  }

  // El total a facturar es siempre el bruto de órdenes.
  // Los pagos recibidos (anticipos, pagos de ciclos anteriores) son operaciones independientes
  // que afectan DeudaDocumento.ImportePendiente via imputarPago, no la factura.
  const totalOrdenesFacturadas = totalOrdenesCiclo - sumExcluidosOrdenes;
  const saldoFacturar          = Math.max(0, totalOrdenesFacturadas - montoDescuentoCalculado); // la factura neta

  // ── GUARD: No generar documento si el importe es cero ──────────────────
  if (saldoFacturar <= 0) {
    logger.info(`[CICLO] Ciclo ${CicIdCiclo}: saldoFacturar=0 (sin órdenes pendientes). No se genera documento.`);
    
    // Cerrar el ciclo sin factura
    await pool.request()
      .input('CicIdCiclo', sql.Int, CicIdCiclo)
      .query(`
        UPDATE dbo.CiclosCredito
        SET CicEstado = 'CERRADO', CicSaldoFacturar = 0
        WHERE CicIdCiclo = @CicIdCiclo
      `);

    // Abrir el siguiente ciclo automáticamente
    let nuevoCiclo = null;
    if (ciclo.CueDiasCiclo > 0) {
      nuevoCiclo = await abrirCicloPorCuenta({
        CueIdCuenta: ciclo.CueIdCuenta,
        CliIdCliente: ciclo.CliIdCliente,
        UsuarioAlta,
      });
    }

    logger.info(`[CICLO] Ciclo ${CicIdCiclo} → CERRADO SIN FACTURA (sin órdenes).`);
    return { DocIdDocumento: null, SaldoFacturar: 0, docNumero: null, nuevoCiclo };
  }
  // ───────────────────────────────────────────────────────────────────────

  // Consultar saldo actual de la cuenta.
  // El saldo YA incorpora todos los movimientos del ciclo: órdenes (débitos negativos) y pagos (créditos positivos).
  // Si saldo < 0: el cliente aún debe → ImportePendiente = |saldo| (capeado por la factura bruta)
  // Si saldo >= 0: el cliente tiene a favor → ImportePendiente = 0 (o la diferencia si el saldo a favor no alcanza)
  const saldoCuentaRes = await pool.request()
    .input('CueIdCuenta', sql.Int, ciclo.CueIdCuenta)
    .query(`SELECT CueSaldoActual FROM dbo.CuentasCliente WHERE CueIdCuenta = @CueIdCuenta`);
  const saldoCuentaActual = saldoCuentaRes.recordset[0]?.CueSaldoActual || 0;

  // El ImportePendiente es lo que realmente queda por cobrar de la factura que se genera.
  // REGLA:
  //   saldoCuentaActual >= 0 → el cliente pagó todo (o de más) → pendiente = 0
  //   saldoCuentaActual < 0  → el cliente aún debe → pendiente = |saldo| (capeado por la factura)
  //
  // Ejemplo A: factura 50.98, pago parcial 15 → saldo -35.98 → pendiente = 35.98
  // Ejemplo B: factura 9.53,  pago 15         → saldo +5.47  → pendiente = 0 (ya cubierta)
  const importePendiente = saldoCuentaActual >= 0
    ? 0
    : Math.min(Math.abs(saldoCuentaActual), saldoFacturar);

  // Para log legacy
  const saldoAFavorPrevio = Math.max(0, saldoCuentaActual);

  // 2. Generar número de factura correlativo (usando la secuencia oficial)
  const seqRes = await pool.request()
    .input('Tipo', sql.VarChar(50), tipoDocumento)
    .query(`
      -- Buscar la secuencia activa para este tipo de documento (la que NO sea 'A' fallback)
      DECLARE @SecSerie VARCHAR(10);
      SELECT TOP 1 @SecSerie = SecSerie 
      FROM dbo.SecuenciaDocumentos 
      WHERE SecTipoDoc = @Tipo AND SecActivo = 1 AND SecSerie <> 'A'
      ORDER BY SecIdSecuencia ASC;

      -- Si no encontró ninguna distinta de 'A', usar 'A' como fallback
      IF @SecSerie IS NULL
        SET @SecSerie = (SELECT TOP 1 SecSerie FROM dbo.SecuenciaDocumentos WHERE SecTipoDoc = @Tipo AND SecActivo = 1);

      -- Si aún no existe, crear una por defecto
      IF @SecSerie IS NULL
      BEGIN
        SET @SecSerie = 'A';
        INSERT INTO dbo.SecuenciaDocumentos (SecTipoDoc, SecSerie, SecPrefijo, SecDigitos, SecUltimoNumero, SecActivo) 
        VALUES (@Tipo, 'A', 'A-', 5, 0, 1);
      END

      UPDATE dbo.SecuenciaDocumentos
      SET    SecUltimoNumero = SecUltimoNumero + 1
      OUTPUT INSERTED.SecUltimoNumero, INSERTED.SecPrefijo, INSERTED.SecSerie
      WHERE  SecTipoDoc = @Tipo AND SecSerie = @SecSerie;
    `);
  const numero    = seqRes.recordset[0].SecUltimoNumero;
  const prefijo   = seqRes.recordset[0].SecPrefijo || 'A-';
  const docSerie  = seqRes.recordset[0].SecSerie || 'A';
  const docNumero = String(numero);
  const docLabel  = `${prefijo}${numero}`;

  // 3. Insertar DocumentoContable
  let DocIdDocumento = null;
      
      const fInicio = new Date(ciclo.CicFechaInicio).toLocaleDateString('es-UY');
      const fechaCierreReal = ciclo.CicFechaCierre ? new Date(ciclo.CicFechaCierre) : new Date();
      const fCierre = fechaCierreReal.toLocaleDateString('es-UY');
      let docObservaciones = `Cierre de ciclo de facturación desde ${fInicio} hasta ${fCierre}.`;
      
      if (montoDescuentoCalculado > 0) {
        docObservaciones += ` Descuento global aplicado: ${descuentoTipo === '%' ? descuentoValorBase + '%' : '$' + descuentoValorBase} (Equivalente a ${montoDescuentoCalculado}).`;
      }
      
      if (observaciones && observaciones.trim().length > 0) {
        docObservaciones += ` Observaciones adicionales: ${observaciones.trim()}`;
      }

      const accountMonId = ciclo.MonIdMoneda || 1;
      const targetMonId = monedaFactura === 'USD' ? 2 : (monedaFactura === 'UYU' ? 1 : accountMonId);
      const esCrossMoneda = targetMonId !== accountMonId;
      
      // Si la moneda de factura difiere de la cuenta, buscar/crear la cuenta en la moneda destino
      let cueIdFactura = ciclo.CueIdCuenta;  // por defecto la misma cuenta
      if (esCrossMoneda) {
        const targetTipo = targetMonId === 2 ? 'USD' : 'UYU';
        cueIdFactura = await obtenerOCrearCuenta(ciclo.CliIdCliente, targetTipo, {
          MonIdMoneda: targetMonId,
          CPaIdCondicion: 1,
          UsuarioAlta: UsuarioAlta,
        });
        logger.info(`[CICLO] Factura cruzada: ciclo en cuenta ${ciclo.CueIdCuenta} (Mon=${accountMonId}) → factura en cuenta ${cueIdFactura} (Mon=${targetMonId})`);
      }

      let docTotal = saldoFacturar; // Precio final neto con IVA incluido
      let docSubtotal = docTotal / 1.22;
      let docDescuentos = montoDescuentoCalculado / 1.22;
      let docImpuestos = docTotal - docSubtotal;

      if (targetMonId === 1 && accountMonId === 2) {
        docSubtotal *= cotDolar;
        docDescuentos *= cotDolar;
        docTotal *= cotDolar;
        docImpuestos *= cotDolar;
      } else if (targetMonId === 2 && accountMonId === 1) {
        docSubtotal /= cotDolar;
        docDescuentos /= cotDolar;
        docTotal /= cotDolar;
        docImpuestos /= cotDolar;
      }

      const docRes = await pool.request()
        .input('CueIdCuenta',   sql.Int,          cueIdFactura)
        .input('CliIdCliente',  sql.Int,          ciclo.CliIdCliente)
        .input('DocTipo',       sql.VarChar(50),  tipoDocumento)
        .input('DocNumero',     sql.VarChar(50),  docNumero)
        .input('DocSerie',      sql.VarChar(10),  docSerie)
        .input('DocSubtotal',   sql.Decimal(18,4), docSubtotal)
        .input('DocImpuestos',  sql.Decimal(18,4), docImpuestos)
        .input('DocTotalDescuentos', sql.Decimal(18,4), docDescuentos)
        .input('DocTotal',      sql.Decimal(18,4), docTotal) 
        .input('MonIdMoneda',   sql.Int,          targetMonId)
        .input('CicIdCiclo',    sql.Int,          CicIdCiclo)
        .input('FechaDesde',    sql.DateTime,     new Date(ciclo.CicFechaInicio))
        .input('FechaHasta',    sql.DateTime,     fechaCierreReal)
        .input('UsuarioAlta',   sql.Int,          UsuarioAlta)
        .input('DocObservaciones', sql.NVarChar(sql.MAX), docObservaciones)
        .input('DocCliNombre', sql.NVarChar(255), cliDgiNombre)
        .input('DocCliDocumento', sql.NVarChar(50), cliDgiDocumento)
        .input('DocCliDireccion', sql.NVarChar(255), cliDgiDireccion)
        .input('DocCliCiudad', sql.NVarChar(100), cliDgiCiudad)
        .input('DocPagado', sql.TinyInt, tipoDocumento.toUpperCase().includes('CONTADO') ? 1 : 0)
        .query(`
          INSERT INTO dbo.DocumentosContables
            (CueIdCuenta, CliIdCliente, DocTipo, DocNumero, DocSerie,
             DocFechaDesde, DocFechaHasta, DocSubtotal, DocImpuestos, DocTotal,
             MonIdMoneda, CicIdCiclo, DocEstado, CfeEstado,
             DocFechaEmision, DocUsuarioAlta, DocTotalDescuentos, DocTotalRecargos, DocObservaciones,
             DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad, DocPagado)
          OUTPUT INSERTED.DocIdDocumento
          VALUES
            (@CueIdCuenta, @CliIdCliente, @DocTipo, @DocNumero, @DocSerie,
             @FechaDesde, @FechaHasta, @DocSubtotal, @DocImpuestos, @DocTotal,
             @MonIdMoneda, @CicIdCiclo, 'EMITIDO', 'PENDIENTE',
             GETDATE(), @UsuarioAlta, @DocTotalDescuentos, 0, @DocObservaciones,
             @DocCliNombre, @DocCliDocumento, @DocCliDireccion, @DocCliCiudad, @DocPagado)
        `);
    DocIdDocumento = docRes.recordset[0].DocIdDocumento;

    // Vincular el documento generado a los movimientos del ciclo facturado para que dejen de estar pendientes
    const linkReq = pool.request()
      .input('DocId', sql.Int, DocIdDocumento)
      .input('CicIdCiclo', sql.Int, CicIdCiclo);
    
    let linkQueryAdd = '';
    if (excluidos && excluidos.length > 0) {
      const inClause = excluidos.map((id, i) => {
        linkReq.input(`ex${i}`, sql.Int, id);
        return `@ex${i}`;
      }).join(',');
      linkQueryAdd = `AND MovIdMovimiento NOT IN (${inClause})`;
    }

    await linkReq.query(`
      UPDATE dbo.MovimientosCuenta
      SET DocIdDocumento = @DocId
      WHERE CicIdCiclo = @CicIdCiclo
        AND (MovAnulado IS NULL OR MovAnulado = 0)
        AND DocIdDocumento IS NULL
        ${linkQueryAdd}
    `);


  // 4. Insertar detalles para el PDF
  if (detallesParaPDF && detallesParaPDF.length > 0) {
    for (const [index, d] of detallesParaPDF.entries()) {
      let dcdSubtotal = d.DcdSubtotal != null ? Number(d.DcdSubtotal) : 0;
      let dcdTotal = d.DcdSubtotal != null ? Number(d.DcdSubtotal) : 0;
      let dcdImpuestos = d.DcdSubtotal != null ? 0 : 0; // Se calcula globalmente o asumimos IVA en subtotal
      
      let nomItem = d.DcdNomItem || '';
      let dscItem = d.DcdDscItem || '';
      let cant = d.DcdCantidad != null ? Number(d.DcdCantidad) : 1;  // DEFAULT 1 — columna NOT NULL
      let punit = d.DcdPrecioUnitario != null ? Number(d.DcdPrecioUnitario) : dcdSubtotal;
      let totDesc = d.DcdTotalDescuentos || 0;
      let descStr = d.DcdDescuentoStr || null;

      await pool.request()
        .input('DocId', sql.Int, DocIdDocumento)
        .input('NomItem', sql.VarChar(255), nomItem.substring(0, 255))
        .input('DscItem', sql.VarChar(1000), dscItem.substring(0, 1000))
        .input('Cantidad', sql.Decimal(18,4), cant)
        .input('PrecioUnitario', sql.Decimal(18,4), punit)
        .input('TotalDescuentos', sql.Decimal(18,4), totDesc)
        .input('DescuentoStr', sql.VarChar(100), descStr)
        .input('Subtotal', sql.Decimal(18,4), dcdSubtotal)
        .input('Impuestos', sql.Decimal(18,4), dcdImpuestos)
        .input('Total', sql.Decimal(18,4), dcdTotal)
        .query(`
          INSERT INTO dbo.DocumentosContablesDetalle
          (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr)
          VALUES
          (@DocId, @NomItem, @DscItem, @Cantidad, @PrecioUnitario, @Subtotal, @Impuestos, @Total, @TotalDescuentos, @DescuentoStr)
        `);
    }
  }

  // 5. Crear DeudaDocumento — va en la cuenta de la moneda de la factura
  if (saldoFacturar > 0 && DocIdDocumento) {
    // Si es cross-moneda, la deuda va en la cuenta destino con el monto convertido
    const deudaCuentaId = esCrossMoneda ? cueIdFactura : ciclo.CueIdCuenta;
    const deudaImporte = esCrossMoneda ? docTotal : saldoFacturar;
    const deudaPendiente = esCrossMoneda ? docTotal : importePendiente;

    await crearDeudaDocumento({
      CueIdCuenta: deudaCuentaId,
      OrdIdOrden: null,
      DocIdDocumento,
      Importe: deudaImporte,
      ImportePendiente: deudaPendiente,
    });

    if (esCrossMoneda) {
      // Registrar movimiento en la cuenta destino para reflejar la deuda
      const monedaDestLabel = targetMonId === 2 ? 'USD' : 'UYU';
      await registrarMovimiento({
        CueIdCuenta:   deudaCuentaId,
        MovTipo:       'CIERRE_CICLO',
        MovConcepto:   `Factura ${docLabel} (ciclo #${CicIdCiclo} → ${monedaDestLabel})`,
        MovImporte:    -docTotal,  // débito en la cuenta destino
        MovUsuarioAlta: UsuarioAlta,
        DocIdDocumento,
        CicIdCiclo,
        MovObservaciones: `Conversión desde ciclo ${accountMonId === 2 ? 'USD' : 'UYU'} a ${monedaDestLabel} @ ${cotDolar}`,
      });
      logger.info(`[CICLO] Deuda cruzada: ${deudaImporte.toFixed(2)} ${monedaDestLabel} en cuenta ${deudaCuentaId}`);
    } else {
      if (importePendiente !== saldoFacturar) {
        logger.info(`[CICLO] Ciclo ${CicIdCiclo}: Factura ${saldoFacturar}. Saldo cuenta (${saldoCuentaActual}) → Pendiente real: ${importePendiente}`);
      }
    }
  }

  // 4b. Absorber DeudaDocumentos individuales de órdenes dentro del ciclo
  // Las órdenes del ciclo ya están consolidadas en la factura A-X.
  // Cualquier DeudaDocumento individual que haya quedado de esas órdenes
  // se marca como PAGADO para evitar doble contabilización en Antigüedad.
  const absReq = pool.request()
    .input('CicIdCiclo',    sql.Int, CicIdCiclo)
    .input('CueIdCuenta',   sql.Int, ciclo.CueIdCuenta);

  let absQueryAdd = '';
  if (excluidos && excluidos.length > 0) {
    const inClause = excluidos.map((id, i) => {
      absReq.input(`exabs${i}`, sql.Int, id);
      return `@exabs${i}`;
    }).join(',');
    absQueryAdd = `AND m.MovIdMovimiento NOT IN (${inClause})`;
  }

  await absReq.query(`
    UPDATE dd
    SET    dd.DDeEstado          = 'PAGADO',
           dd.DDeImportePendiente = 0
    FROM   dbo.DeudaDocumento dd
    WHERE  dd.CueIdCuenta = @CueIdCuenta
      AND  dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')
      AND  dd.OrdIdOrden IS NOT NULL          -- solo deudas individuales de órdenes
      AND  dd.DocIdDocumento IS NULL          -- sin documento propio (son las generadas por hookOrdenCreada)
      AND  dd.OrdIdOrden IN (
             SELECT DISTINCT m.OrdIdOrden
             FROM   dbo.MovimientosCuenta m
             WHERE  m.CicIdCiclo = @CicIdCiclo
               AND  m.OrdIdOrden IS NOT NULL
               AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               ${absQueryAdd}
           )
  `);

  const absCountReq = pool.request()
    .input('CicIdCiclo', sql.Int, CicIdCiclo)
    .input('CueIdCuenta', sql.Int, ciclo.CueIdCuenta);

  let absCountQueryAdd = '';
  if (excluidos && excluidos.length > 0) {
    const inClause = excluidos.map((id, i) => {
      absCountReq.input(`exabscnt${i}`, sql.Int, id);
      return `@exabscnt${i}`;
    }).join(',');
    absCountQueryAdd = `AND m.MovIdMovimiento NOT IN (${inClause})`;
  }

  const absorbidas = await absCountReq.query(`
    SELECT COUNT(*) AS total FROM dbo.DeudaDocumento dd
    WHERE  dd.CueIdCuenta = @CueIdCuenta AND dd.DDeEstado = 'PAGADO'
      AND  dd.OrdIdOrden IN (
             SELECT DISTINCT m.OrdIdOrden FROM dbo.MovimientosCuenta m
             WHERE m.CicIdCiclo = @CicIdCiclo AND m.OrdIdOrden IS NOT NULL AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
             ${absCountQueryAdd}
           )
  `);
  logger.info(`[CICLO] ${absorbidas.recordset[0].total} DeudaDocumento(s) individuales absorbidas por el cierre del ciclo ${CicIdCiclo}`);


  // 5. Registrar movimiento de cierre en libro mayor (cuenta de ORIGEN del ciclo)
  // Si es cross-moneda: el movimiento COMPENSA las órdenes en la cuenta original
  //   → las órdenes debitaron -22 en USD, el cierre acredita +22 para dejar la cuenta en 0
  //   → la deuda real queda en la cuenta UYU (registrada en paso anterior)
  // Si es misma moneda: el movimiento es neutro (0), la deuda queda en DeudaDocumento
  const cierreImporteOrigen = esCrossMoneda ? saldoFacturar : 0;
  const cierreConcepto = esCrossMoneda
    ? `Cierre ciclo → Factura ${docLabel} traspasada a ${targetMonId === 2 ? 'USD' : 'UYU'} (${docTotal.toFixed(2)} @ cot. ${cotDolar})`
    : `Cierre ciclo ${ciclo.CicFechaInicio ? new Date(ciclo.CicFechaInicio).toLocaleDateString('es-UY') : ''} → ${fCierre} | ${docLabel}`;

  await registrarMovimiento({
    CueIdCuenta:   ciclo.CueIdCuenta,
    MovTipo:       'CIERRE_CICLO',
    MovConcepto:   cierreConcepto,
    MovImporte:    cierreImporteOrigen,
    MovUsuarioAlta: UsuarioAlta,
    DocIdDocumento,
    CicIdCiclo,
    MovObservaciones: esCrossMoneda
      ? `Cross-moneda: Ordenes ${totalOrdenesFacturadas} ${accountMonId === 2 ? 'USD' : 'UYU'} → Factura ${docTotal.toFixed(2)} ${targetMonId === 2 ? 'USD' : 'UYU'} @ ${cotDolar}`
      : `Ordenes: ${totalOrdenesFacturadas} | Pagos: 0 (gestionados via DeudaDocumento) | Saldo: ${importePendiente}`,
  });

  // 6. Cerrar el ciclo actual (actualizando con los montos ajustados)
  const pagosCicloRes = await pool.request()
    .input('CicIdCiclo', sql.Int, CicIdCiclo)
    .query(`
      SELECT ISNULL(SUM(ABS(MovImporte)), 0) AS total
      FROM   dbo.MovimientosCuenta
      WHERE  CicIdCiclo = @CicIdCiclo
        AND  (MovAnulado IS NULL OR MovAnulado = 0)
        AND  MovTipo IN ('PAGO', 'PAGO_CRUZADO', 'ANTICIPO', 'COBRO', 'SALDO_A_FAVOR')
    `);
  const totalPagosCicloReal = pagosCicloRes.recordset[0]?.total || 0;

  await pool.request()
    .input('CicIdCiclo',     sql.Int,          CicIdCiclo)
    .input('SaldoFacturar',  sql.Decimal(18,4), saldoFacturar)
    .input('TotalOrdenes',   sql.Decimal(18,4), totalOrdenesFacturadas)
    .input('TotalPagos',     sql.Decimal(18,4), totalPagosCicloReal)
    .input('NumeroFactura',  sql.VarChar(100),  docLabel)
    .input('UsuarioCierre',  sql.Int,          UsuarioAlta)
    .query(`
      UPDATE dbo.CiclosCredito
      SET CicEstado        = 'CERRADO',
          CicSaldoFacturar  = @SaldoFacturar,
          CicTotalOrdenes   = @TotalOrdenes,
          CicTotalPagos     = @TotalPagos,
          CicNumeroFactura  = @NumeroFactura,
          CicFechaFactura   = GETDATE(),
          CicFechaCierre    = GETDATE(),
          CicUsuarioCierre  = @UsuarioCierre
      WHERE CicIdCiclo = @CicIdCiclo
    `);

  logger.info(`[CICLO] Ciclo ${CicIdCiclo} → CERRADO. Saldo ${saldoFacturar}, Factura ${docLabel}`);

  // 7. Abrir ciclo siguiente automáticamente
  const nuevoCicloFechaInicio = ciclo.CicFechaCierre ? new Date(ciclo.CicFechaCierre) : new Date();
  const nuevoCiclo = await abrirCicloPorCuenta({
    CueIdCuenta:  ciclo.CueIdCuenta,
    CliIdCliente: ciclo.CliIdCliente,
    UsuarioAlta,
    FechaInicio:  nuevoCicloFechaInicio,
  });

  // 8. Mover excluidos al nuevo ciclo
  if (excluidos && excluidos.length > 0) {
    const updReq = pool.request();
    const inClause = excluidos.map((id, i) => { updReq.input(`m${i}`, sql.Int, id); return `@m${i}`; }).join(',');
    await updReq.query(`UPDATE dbo.MovimientosCuenta SET CicIdCiclo = ${nuevoCiclo.CicIdCiclo} WHERE MovIdMovimiento IN (${inClause})`);
    
    // Acumular los excluidos en el nuevo ciclo
    if (sumExcluidosOrdenes > 0) await acumularEnCiclo(nuevoCiclo.CicIdCiclo, 'ORDEN', sumExcluidosOrdenes);
    if (sumExcluidosPagos > 0)   await acumularEnCiclo(nuevoCiclo.CicIdCiclo, 'PAGO', sumExcluidosPagos);
  }

  // 9. TRASPASO DE SALDO A FAVOR (Si pagó de más, le pasamos el vuelto al ciclo nuevo)
  if (saldoFacturar < 0) {
    const saldoAFavor = Math.abs(saldoFacturar);
    await pool.request()
      .input('CueIdCuenta', sql.Int, ciclo.CueIdCuenta)
      .input('CicIdCiclo', sql.Int, nuevoCiclo.CicIdCiclo)
      .input('MovTipo', sql.VarChar(20), 'SALDO_A_FAVOR')
      .input('MovConcepto', sql.VarChar(255), `Saldo a favor arrastrado del ciclo anterior (#${CicIdCiclo})`)
      .input('MovImporte', sql.Decimal(18,4), saldoAFavor)
      .input('MovUsuarioAlta', sql.Int, UsuarioAlta)
      .query(`
        INSERT INTO dbo.MovimientosCuenta (CueIdCuenta, CicIdCiclo, MovTipo, MovConcepto, MovImporte, MovFecha, MovUsuarioAlta, MovAnulado)
        VALUES (@CueIdCuenta, @CicIdCiclo, @MovTipo, @MovConcepto, @MovImporte, GETDATE(), @MovUsuarioAlta, 0)
      `);
      
    await acumularEnCiclo(nuevoCiclo.CicIdCiclo, 'PAGO', saldoAFavor); 
  }

  return { DocIdDocumento, SaldoFacturar: saldoFacturar, docNumero: docLabel, nuevoCiclo };
}

/**
 * cerrarCiclosVencidos
 * Busca ciclos ABIERTOS cuya fecha de cierre ya pasó y los marca como VENCIDO.
 * Luego los cierra automáticamente. Llamado por el CRON nocturno.
 *
 * @returns {Promise<{procesados: number, errores: number}>}
 */
async function cerrarCiclosVencidos() {
  const pool = await getPool();
  let procesados = 0, errores = 0;

  // Marcar como VENCIDO los que pasaron su fecha
  await pool.request().query(`
    UPDATE dbo.CiclosCredito
    SET    CicEstado = 'VENCIDO'
    WHERE  CicEstado = 'ABIERTO'
      AND  CicFechaCierre < CAST(GETDATE() AS DATE)
  `);

  // Cerrar todos los VENCIDOS
  const vencidos = await pool.request().query(`
    SELECT CicIdCiclo FROM dbo.CiclosCredito WHERE CicEstado = 'VENCIDO'
  `);

  for (const c of vencidos.recordset) {
    try {
      await cerrarCicloCompleto({ CicIdCiclo: c.CicIdCiclo, UsuarioAlta: 1 });
      procesados++;
    } catch (e) {
      logger.error(`[CICLO] Error cerrando CicIdCiclo=${c.CicIdCiclo}: ${e.message}`);
      errores++;
    }
  }

  logger.info(`[CICLO] cerrarCiclosVencidos → procesados: ${procesados}, errores: ${errores}`);
  return { procesados, errores };
}

/**
 * forzarCierreTodosCiclosAbiertos
 * Busca TODOS los ciclos ABIERTOS (sin importar si vencieron) y los cierra.
 * Utilizado por el CRON de estados de cuenta.
 */
async function forzarCierreTodosCiclosAbiertos() {
  const pool = await getPool();
  let procesados = 0, errores = 0;

  // Seleccionar todos los ABIERTOS
  const abiertos = await pool.request().query(`
    SELECT CicIdCiclo FROM dbo.CiclosCredito WHERE CicEstado = 'ABIERTO'
  `);

  for (const c of abiertos.recordset) {
    try {
      await cerrarCicloCompleto({ CicIdCiclo: c.CicIdCiclo, UsuarioAlta: 1 });
      procesados++;
    } catch (e) {
      logger.error(`[CICLO] Error forzando cierre CicIdCiclo=${c.CicIdCiclo}: ${e.message}`);
      errores++;
    }
  }

  logger.info(`[CICLO] forzarCierreTodosCiclosAbiertos → procesados: ${procesados}, errores: ${errores}`);
  return { procesados, errores };
}


// ============================================================
// SECCIÓN X: HOOK — RETIRO AUTORIZADO SIN PAGO (FIADO)
// ============================================================

async function hookRetiroSinPago({ OReIdOrdenRetiro, CliIdCliente, OrdIds = [], Monto = 0, UsuarioAlta = 1, Observacion = '' }) {
  try {
    const pool = await getPool();

    const cueRes = await pool.request()
      .input('CliIdCliente', sql.Int, CliIdCliente)
      .query(`
        SELECT TOP 1 CueIdCuenta
        FROM   dbo.CuentasCliente
        WHERE  CliIdCliente = @CliIdCliente
          AND  CueTipo IN ('DINERO_UYU', 'DINERO_USD')
          AND  CueActiva = 1
        ORDER BY CASE CueTipo WHEN 'DINERO_UYU' THEN 1 ELSE 2 END
      `);

    if (cueRes.recordset.length > 0) {
      const { CueIdCuenta } = cueRes.recordset[0];
      await registrarMovimiento({
        CueIdCuenta,
        MovTipo:          'FIADO',
        MovConcepto:      `Retiro R-${OReIdOrdenRetiro} entregado sin cobro`,
        MovImporte:       0,
        MovUsuarioAlta:   UsuarioAlta,
        OReIdOrdenRetiro: OReIdOrdenRetiro,
        MovObservaciones: `Monto: ${Number(Monto).toFixed(2)}${Observacion ? ' | ' + Observacion : ''}`,
      });
    } else {
      logger.warn(`[FIADO] Sin cuenta DINERO para CliId=${CliIdCliente}`);
    }

    if (OrdIds.length > 0) {
      const placeholders = OrdIds.map((_, i) => `@ord${i}`).join(',');
      const req2 = pool.request();
      OrdIds.forEach((id, i) => req2.input(`ord${i}`, sql.Int, id));
      const updated = await req2.query(`
        UPDATE dbo.DeudaDocumento
        SET    DDeEstado = 'EN_GESTION'
        WHERE  OrdIdOrden IN (${placeholders})
          AND  DDeEstado = 'PENDIENTE'
      `);
      logger.info(`[FIADO] R-${OReIdOrdenRetiro}: ${updated.rowsAffected[0]} deuda(s) -> EN_GESTION`);
    }

    logger.info(`[FIADO] OK: R-${OReIdOrdenRetiro}, Cli=${CliIdCliente}, Monto=${Monto}`);
  } catch (err) {
    logger.warn('[FIADO] hookRetiroSinPago fallo (no afecta la entrega):', err.message);
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  // Cuentas
  obtenerOCrearCuenta,

  // Libro mayor
  registrarMovimiento,
  getMovimientos,

  // Pagos
  imputarPago,

  // Deuda
  crearDeudaDocumento,
  getDeudas,

  // Ciclos de crédito
  obtenerCicloActivo,
  abrirCicloPorCuenta,
  acumularEnCiclo,
  cerrarCicloCompleto,
  cerrarCiclosVencidos,
  forzarCierreTodosCiclosAbiertos,
  getCicloMovimientos,

  // Hooks — llamar post-commit desde otros controladores
  hookOrdenCreada,
  hookReposicion,
  hookPagoRegistrado,
  hookEntregaMetros,
  hookRetiroSinPago,

  // Consultas
  getSaldoCliente,
  getAntiguedadDeuda,

  // --- MOTOR UNIFICADO ---
  procesarEventoContable,

  // Consultas extra
  getDeudasPorCliente,
  getTodasLasDeudasVivas,
};

/**
 * procesarEventoContable (MOTOR UNIFICADO)
 * ──────────────────────────────────────────────────────────────────────────
 * Orquestador central que consulta el motor de reglas y aplica todas las
 * tareas contables (Submayor, Deuda, Recursos, Asientos).
 *
 * @param {string} evtCodigo   Código del evento (ej: 'VTA_CAJA', 'PAGO')
 * @param {object} data        Datos de la operación { CliIdCliente, Importe, ... }
 */
async function procesarEventoContable(evtCodigo, data) {
  const motor = require('./motorContable');
  const contabilidadCore = require('./contabilidadCore');
  const evt = await motor.getEvento(evtCodigo);

  if (!evt) {
    logger.warn(`[MOTOR] Evento ${evtCodigo} omitido (no configurado en Cont_EventosContables).`);
    return null;
  }

  const {
    CliIdCliente, Importe = 0, MonIdMoneda = 1, UsuarioAlta = 70,
    OrdIdOrden = null, CodigoOrden = '', NombreTrabajo = '', 
    ProIdProducto = null, Cantidad = 0,
    OReIdOrdenRetiro = null, PagIdPago = null
  } = data;

  try {
    let resSubmayor = null;
    const pool = await getPool();

    // 1. LÓGICA DE SUBMAYOR (CUENTAS CORRIENTES / SALDO CLIENTE)
    if (evt.EvtAfectaSaldo !== 0 && CliIdCliente) {
      let saltarDinero = false;
      
      // Si el evento aplica recursos, verificamos si existe un plan activo para evitar doble cobro
      if (evt.EvtAplicaRecurso && ProIdProducto) {
         const pCheck = await pool.request()
            .input('C', sql.Int, CliIdCliente)
            .input('P', sql.Int, ProIdProducto)
            .query(`
              SELECT TOP 1 pm.PlaIdPlan 
              FROM dbo.PlanesMetros pm WITH(NOLOCK)
              WHERE pm.CliIdCliente=@C 
                AND pm.PlaActivo=1 
                AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                AND (
                  pm.ProIdProducto=@P
                  OR EXISTS (
                    SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                    WHERE pap.PlaIdPlan = pm.PlaIdPlan
                      AND pap.ProIdProducto = @P
                  )
                )
            `);
         if (pCheck.recordset.length > 0) {
            saltarDinero = true;
            logger.info(`[MOTOR] ${evtCodigo}: Cliente ${CliIdCliente} tiene plan para Producto ${ProIdProducto}. Se omite cobro en dinero.`);
         }
      }

      let cueId = null; // declarado aquí para ser visible en la imputación de pago (paso 4)
      if (!saltarDinero) {
        const cueTipo = MonIdMoneda === 2 ? 'DINERO_USD' : 'DINERO_UYU';
        cueId = await obtenerOCrearCuenta(CliIdCliente, cueTipo, { MonIdMoneda, UsuarioAlta });
        
        // Registrar en historial de movimientos
        // Buscar ciclo activo ANTES de registrar el movimiento
        const cicloActivoEvt = await obtenerCicloActivo(cueId);
        if (cicloActivoEvt) {
          logger.info(`[MOTOR] ${evtCodigo}: Cliente ${CliIdCliente} tiene ciclo activo CicId=${cicloActivoEvt.CicIdCiclo}. Movimiento se asocia al ciclo.`);
        }

        resSubmayor = await registrarMovimiento({
          CueIdCuenta: cueId,
          MovTipo: evtCodigo,
          MovConcepto: `${CodigoOrden} ${NombreTrabajo}`.trim() || evtCodigo,
          MovImporte: Math.abs(Importe) * (evt.EvtAfectaSaldo || 1), // Efecto natural directo: 1 = Suma/Haber a favor (+), -1 = Resta/Debe deuda (-)
          MovUsuarioAlta: UsuarioAlta,
          OrdIdOrden, OReIdOrdenRetiro, PagIdPago,
          CicIdCiclo: cicloActivoEvt ? cicloActivoEvt.CicIdCiclo : null,
        });

        // 2. GENERACIÓN DE DEUDA VIVA (DOCUMENTOS PENDIENTES) Y CRUCES DE MONEDA
        // Si el saldo resultante bajó de 0 (hay deuda generada)
        if (evt.EvtGeneraDeuda && resSubmayor.SaldoResultante < 0) {
           let deudaReal = Math.min(Math.abs(Importe), Math.max(0, -resSubmayor.SaldoResultante));
           
           if (deudaReal > 0.01) {
              // Intentar cruce de monedas (si tiene saldo a favor en la otra)
              const tipoOtra = MonIdMoneda === 2 ? 'DINERO_UYU' : 'DINERO_USD';
              const ctaOtraRes = await pool.request()
                 .input('CliCruce', sql.Int, CliIdCliente)
                 .input('TipoCruce', sql.VarChar(20), tipoOtra)
                 .query(`SELECT CueIdCuenta, CueSaldoActual FROM CuentasCliente WHERE CliIdCliente=@CliCruce AND CueTipo=@TipoCruce AND CueActiva=1 AND CueSaldoActual > 0.01`);
              
              if (ctaOtraRes.recordset.length > 0) {
                 const ctaOtra = ctaOtraRes.recordset[0];
                 let coti = 1;
                 const cotiRes = await pool.request().query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC');
                 if (cotiRes.recordset.length > 0) coti = parseFloat(cotiRes.recordset[0].CotDolar) || 1;

                 // Tasa para convertir de la "otra" moneda a la "actual"
                 let tasaConvertirAOrden = MonIdMoneda === 2 ? (1 / coti) : coti;
                 let saldoOtraConvertido = ctaOtra.CueSaldoActual * tasaConvertirAOrden;

                 let aDescontarOrden = Math.min(deudaReal, saldoOtraConvertido);
                 
                 if (aDescontarOrden > 0.01) {
                    let aDescontarCtaOtra = aDescontarOrden / tasaConvertirAOrden;
                    
                    // Extraer de la bolsa positiva (otra cuenta)
                    await registrarMovimiento({
                      CueIdCuenta: ctaOtra.CueIdCuenta,
                      MovTipo: 'PAGO_CRUZADO',
                      MovConcepto: `Cruce automático -> Orden ${CodigoOrden}`,
                      MovImporte: -Math.abs(aDescontarCtaOtra),
                      MovUsuarioAlta: UsuarioAlta,
                      OrdIdOrden, OReIdOrdenRetiro,
                    });

                    // Ingresar la plata convertida a la cuenta endeudada
                    await registrarMovimiento({
                      CueIdCuenta: cueId,
                      MovTipo: 'PAGO_CRUZADO',
                      MovConcepto: `Cobertura desde ${tipoOtra}`,
                      MovImporte: Math.abs(aDescontarOrden),
                      MovUsuarioAlta: UsuarioAlta,
                      OrdIdOrden, OReIdOrdenRetiro,
                    });

                    deudaReal -= aDescontarOrden;
                 }
              }

              // Si hay ciclo activo → acumular en ciclo (cliente SEMANAL), NO crear DeudaDocumento
              if (cicloActivoEvt) {
                await acumularEnCiclo(cicloActivoEvt.CicIdCiclo, 'ORDEN', Math.abs(Importe));
                logger.info(`[CICLO] ${evtCodigo}: Orden ${CodigoOrden} acumulada en ciclo CicId=${cicloActivoEvt.CicIdCiclo}. NO se crea DeudaDocumento.`);
              } else if (deudaReal > 0.01) {
                // Sin ciclo activo → crear deuda documento individual
                await crearDeudaDocumento({ 
                   CueIdCuenta: cueId, OrdIdOrden, 
                   Importe: Math.abs(Importe), 
                   ImportePendiente: deudaReal 
                });
              } else {
                 // Deuda cubierta completamente por cruce
                 resSubmayor.cubiertoPorSaldo = true;
              }
           }
        } else if (cicloActivoEvt && evt.EvtGeneraDeuda) {
          // SaldoResultante >= 0: el saldo a favor cubrió la orden completamente.
          // El saldo a favor funciona igual que los metros prepagados: ya fue pagado,
          // no se vuelve a acumular en el ciclo para no facturar dos veces.
          resSubmayor.cubiertoPorSaldo = true;
          logger.info(`[CICLO] ${evtCodigo}: Orden ${CodigoOrden} cubierta por saldo a favor (cliente semanal). NO se acumula en ciclo CicId=${cicloActivoEvt.CicIdCiclo}.`);
        } else if (evt.EvtGeneraDeuda) {
           // Si el evento genera deuda pero SaldoResultante >= 0 y sin ciclo: cubierto por saldo
           resSubmayor.cubiertoPorSaldo = true;
        }

        // 2.5. AUTO-MARCAR ORDEN COMO PAGADA SI FUE CUBIERTA 100% POR SALDO
        if (evt.EvtGeneraDeuda && resSubmayor?.cubiertoPorSaldo === true && OrdIdOrden) {
           logger.info(`[MOTOR] Orden ${CodigoOrden} cubierta totalmente por Saldo a Favor. Auto-marcando como paga.`);
           await pool.request().input('Id', sql.Int, OrdIdOrden).query(`
             UPDATE dbo.OrdenesDeposito SET OrdEstadoActual = CASE WHEN OrdEstadoActual = 1 THEN 7 ELSE OrdEstadoActual END WHERE OrdIdOrden = @Id;
           `);
           // Chequear si la orden de retiro padre también debe pasar a abonada
           await pool.request().input('Id', sql.Int, OrdIdOrden).query(`
             UPDATE r SET OReEstadoActual = CASE WHEN OReEstadoActual = 1 THEN 3 WHEN OReEstadoActual = 5 THEN 8 ELSE OReEstadoActual END
             FROM dbo.OrdenesRetiro r
             INNER JOIN dbo.OrdenesDeposito d ON d.OReIdOrdenRetiro = r.OReIdOrdenRetiro
             WHERE d.OrdIdOrden = @Id AND NOT EXISTS (
                SELECT 1 FROM dbo.OrdenesDeposito od2 
                LEFT JOIN dbo.DeudaDocumento dd ON dd.OrdIdOrden = od2.OrdIdOrden
                WHERE od2.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od2.OrdIdOrden != @Id
                  AND (od2.PagIdPago IS NULL AND (dd.DDeImportePendiente > 0.01 OR dd.DDeImportePendiente IS NULL))
             )
           `);
        }
      }
    }

    // 3. LÓGICA DE RECURSOS (PLANES METROS/KG)
    if (evt.EvtAplicaRecurso && ProIdProducto && Cantidad > 0) {
      await hookEntregaMetros({ 
        OrdIdOrden, CliIdCliente, ProIdProducto, Cantidad, 
        CodigoOrden, UsuarioAlta, Importe, MonIdMoneda, NombreTrabajo 
      });
    }

    // 4. LÓGICA DE IMPUTACIÓN (SOLO PARA PAGOS)
    if (PagIdPago && cueId) {
       await imputarPago({
          PagIdPago,
          MontoDisponible: Math.abs(Importe),
          CueIdCuenta: cueId,
          UsuarioAlta
       });
       logger.info(`[MOTOR] Pago ${PagIdPago} imputado automáticamente.`);
    }

    // 5. LÓGICA DE ASIENTO CONTABLE (LIBRO MAYOR)
    const reglas = await motor.getReglasAsiento(evtCodigo);
    if (reglas && reglas.length >= 2) {
      let cotiz = 1;
      if (MonIdMoneda === 2) {
        const cRes = await pool.request().query('SELECT TOP 1 CotDolar FROM Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC');
        cotiz = cRes.recordset.length > 0 ? parseFloat(cRes.recordset[0].CotDolar) || 1 : 1;
      }

      const importeAbsRounded = Math.round(Math.abs(Importe) * 100) / 100;
      const { neto, ivaMonto } = contabilidadCore.desglosarIVA(importeAbsRounded, 22);
      const lineas = await contabilidadCore.resolverLineasDesdeMotor(evtCodigo, {
        moneda: MonIdMoneda === 2 ? 'USD' : 'UYU',
        cotizacion: cotiz,
        totalNeto: importeAbsRounded,
        neto, ivaMonto,
        clienteId: CliIdCliente,
        monedaId: MonIdMoneda
      });

      if (lineas.length >= 2) {
        const tran = pool.transaction();
        await tran.begin();
        try {
          await contabilidadCore.generarAsientoCompleto({
            fecha: new Date(),
            concepto: `${CodigoOrden} ${NombreTrabajo}`.trim() || evtCodigo,
            usuarioId: UsuarioAlta,
            origen: 'MOTOR',
            lineas
          }, tran);
          await tran.commit();
        } catch (errAsi) {
          await tran.rollback();
          logger.error(`[MOTOR] Falló Asiento ${evtCodigo}: ${errAsi.message}`);
        }
      }
    }

    return { success: true, saldoActual: resSubmayor?.SaldoResultante };
  } catch (err) {
    logger.error(`[MOTOR] Error crítico en procesarEventoContable (${evtCodigo}): ${err.message}`);
    // No lanzamos error para no romper el proceso de negocio principal (fire-and-forget logic)
    return { success: false, error: err.message };
  }
}

