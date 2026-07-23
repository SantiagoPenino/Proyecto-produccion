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
const { aplicarRecargoUrgenciaRollo } = require('./urgenciaDescuentoRolloService');

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
    MovFecha         = null,
  } = params;

  let resolvedCicloId = CicIdCiclo;
  if (!resolvedCicloId) {
    const activo = await obtenerCicloActivo(CueIdCuenta, transaction);
    if (activo) resolvedCicloId = activo.CicIdCiclo;
  }

  const req = transaction ? new sql.Request(transaction) : pool.request();
  req
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
    .input('CicIdCiclo',        sql.Int,          resolvedCicloId);
  // Fecha del movimiento editable (retrofecha del documento). Solo se envía si viene:
  // así las llamadas existentes y el SP previo (sin @MovFecha) siguen funcionando igual.
  if (MovFecha) {
    req.input('MovFecha', sql.DateTime, new Date(MovFecha));
  }
  const result = await req
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

  // ─────────────────────────────────────────────
  // FECHA DE LA DEUDA = la del DOCUMENTO que la origina, no la de hoy.
  // Antes se estampaba siempre new Date(): una deuda creada hoy por una factura del mes
  // pasado nacía "al día" y el vencimiento se corría con ella, así que la deuda vieja no
  // figuraba vencida y no se reclamaba. La fecha la manda el comprobante.
  let fechaEmisionDeuda = new Date();
  if (DocIdDocumento) {
    const docFechaRes = await mkReq()
      .input('DocIdDoc', sql.Int, DocIdDocumento)
      .query(`SELECT DocFechaEmision FROM dbo.DocumentosContables WHERE DocIdDocumento = @DocIdDoc`);
    const docFecha = docFechaRes.recordset[0]?.DocFechaEmision;
    if (docFecha) fechaEmisionDeuda = new Date(docFecha);
  }

  // ─────────────────────────────────────────────
  // GUARD DE IDEMPOTENCIA — un documento, una sola deuda viva.
  // Nada en la base lo impide (DeudaDocumento no tiene UNIQUE sobre DocIdDocumento), y
  // cualquier camino que llame dos veces con el mismo documento duplicaba la deuda: el
  // cliente aparecía debiendo el doble y el cobro no la mataba nunca (los pagos entran a
  // una fila y la otra sobrevive). Si ya hay una deuda viva para este documento se
  // ACTUALIZA su importe en vez de insertar otra.
  if (DocIdDocumento) {
    const dupRes = await mkReq()
      .input('DocIdDocumento', sql.Int, DocIdDocumento)
      .query(`
        SELECT TOP 1 DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente
        FROM   dbo.DeudaDocumento WITH (UPDLOCK, ROWLOCK)
        WHERE  DocIdDocumento = @DocIdDocumento
          AND  DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
          AND  DDeImportePendiente > 0.01
        ORDER BY DDeIdDocumento
      `);
    if (dupRes.recordset.length) {
      const yaExiste = dupRes.recordset[0];
      // Ya hubo cobros contra esta deuda: reescribir su importe pisaría la imputación.
      // Se deja como está y se avisa; el importe lo ajusta el flujo de edición, no este.
      const tuvoPagos = Number(yaExiste.DDeImportePendiente) < Number(yaExiste.DDeImporteOriginal) - 0.01;
      if (!tuvoPagos && Math.abs(Number(yaExiste.DDeImporteOriginal) - Importe) > 0.01) {
        await mkReq()
          .input('DDeId',    sql.Int,           yaExiste.DDeIdDocumento)
          .input('Original', sql.Decimal(18,4), Importe)
          .input('Pend',     sql.Decimal(18,4), Math.max(0, ImportePendiente))
          .query(`
            UPDATE dbo.DeudaDocumento
            SET DDeImporteOriginal = @Original, DDeImportePendiente = @Pend
            WHERE DDeIdDocumento = @DDeId
          `);
        logger.warn(`[DEUDA] Doc #${DocIdDocumento} ya tenía la deuda #${yaExiste.DDeIdDocumento}: importe actualizado a ${Number(Importe).toFixed(2)} en vez de crear una duplicada.`);
      } else {
        logger.warn(`[DEUDA] Doc #${DocIdDocumento} ya tenía la deuda viva #${yaExiste.DDeIdDocumento}${tuvoPagos ? ' (con pagos imputados)' : ''} — no se crea una duplicada.`);
      }
      return yaExiste.DDeIdDocumento;
    }
  }

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
        .input('DDeFechaEmision',     sql.Date,         fechaEmisionDeuda)
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

      // Sin plan activo — verificar si el cliente es ROLLO POR ADELANTADO.
      // Si lo es, NO generar deuda monetaria; los metros se regularizarán al asignar el próximo plan.
      const rolloCheckReq = transaction ? new sql.Request(transaction) : pool.request();
      const rolloCheckRes = await rolloCheckReq
        .input('CliIdCliente', sql.Int, CliIdCliente)
        .query(`SELECT UPPER(RTRIM(LTRIM(ISNULL(tc.TClDescripcion,'')))) AS TipoDesc
                FROM dbo.Clientes c WITH(NOLOCK)
                LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
                WHERE c.CliIdCliente = @CliIdCliente`);
      const esRolloSinPlan = (rolloCheckRes.recordset[0]?.TipoDesc || '').includes('ROLLO');
      if (esRolloSinPlan) {
        // ROLLO sin plan activo: buscar la cuenta de recursos del último plan (aunque esté cerrado)
        // y registrar el consumo en negativo. Así el "debe metros" queda visible en el estado de
        // cuenta y se compensa cuando llegue el próximo rollo y se cree un nuevo plan.
        if (Cantidad && Cantidad > 0) {
          const ultimoPlanReq = transaction ? new sql.Request(transaction) : pool.request();
          const ultimoPlanRes = await ultimoPlanReq
            .input('CliIdCliente',  sql.Int, CliIdCliente)
            .input('ProIdProducto', sql.Int, ProIdProducto)
            .query(`
              SELECT TOP 1 pm.CueIdCuenta, pm.PlaIdPlan
              FROM   dbo.PlanesMetros pm WITH(NOLOCK)
              WHERE  pm.CliIdCliente = @CliIdCliente
                AND  (
                  pm.ProIdProducto = @ProIdProducto
                  OR EXISTS (
                    SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                    WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = @ProIdProducto
                  )
                )
              ORDER BY pm.PlaFechaAlta DESC
            `);

          if (ultimoPlanRes.recordset.length > 0) {
            const { CueIdCuenta: cueRecurso, PlaIdPlan } = ultimoPlanRes.recordset[0];
            logger.warn(`[HOOK:ORDEN] ROLLO_ADELANTADO sin plan activo — registrando ${Cantidad} mts en negativo sobre cuenta ${cueRecurso} (último plan #${PlaIdPlan}). Orden=${CodigoOrden}`);
            await registrarMovimiento({
              CueIdCuenta:      cueRecurso,
              MovTipo:          'ENTREGA',
              MovConcepto:      `${CodigoOrden}${NombreTrabajo ? ' — ' + NombreTrabajo : ''}`,
              MovImporte:       -Math.abs(Cantidad),
              MovUsuarioAlta:   UsuarioAlta,
              OrdIdOrden,
              MovObservaciones: `Exceso s/ Plan #${PlaIdPlan} (sin plan activo)`,
            }, transaction);
            // Marcar ORDEN monetaria existente como CUBIERTO_NEG para excluirla del billing
            if (OrdIdOrden) {
              const obsNegRollo = `CUBIERTO_NEG_${Math.abs(Cantidad).toFixed(2)}_PLAN_${PlaIdPlan}`;
              const markRolloReq = transaction ? new sql.Request(transaction) : pool.request();
              await markRolloReq
                .input('OrdId', sql.Int, OrdIdOrden)
                .input('CliId', sql.Int, CliIdCliente)
                .input('Obs', sql.NVarChar(500), obsNegRollo)
                .query(`
                  UPDATE m SET m.MovObservaciones = @Obs
                  FROM   dbo.MovimientosCuenta m
                  JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
                  WHERE  m.OrdIdOrden = @OrdId
                    AND  cc.CliIdCliente = @CliId
                    AND  cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
                    AND  m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                    AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                    AND  m.DocIdDocumento IS NULL
                    AND  (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')
                `);
            }
          } else {
            // No hay ningún plan histórico para este producto y cliente.
            // Último recurso: deuda monetaria como placeholder hasta que se asigne un plan.
            logger.warn(`[HOOK:ORDEN] ROLLO_ADELANTADO sin plan histórico para ProId=${ProIdProducto} — generando deuda monetaria como placeholder. Orden=${CodigoOrden}`);
            const CueTipoRollo = MonIdMoneda === 2 ? 'DINERO_USD' : 'DINERO_UYU';
            const CueIdPlaceholder = await obtenerOCrearCuenta(CliIdCliente, CueTipoRollo, { MonIdMoneda, UsuarioAlta }, transaction);
            await registrarMovimiento({
              CueIdCuenta:      CueIdPlaceholder,
              MovTipo:          'ORDEN',
              MovConcepto:      `[ROLLO SIN PLAN] ${CodigoOrden}${NombreTrabajo ? ' — ' + NombreTrabajo : ''}`,
              MovImporte:       -Math.abs(Importe),
              MovUsuarioAlta:   UsuarioAlta,
              OrdIdOrden,
              MovObservaciones: 'ROLLO_SIN_PLAN_HISTORICO — cancelar al asignar plan de metros',
            }, transaction);
            await crearDeudaDocumento({ CueIdCuenta: CueIdPlaceholder, OrdIdOrden, Importe: Math.abs(Importe), ImportePendiente: Math.abs(Importe) }, transaction);
          }
        } else {
          logger.warn(`[HOOK:ORDEN] ROLLO_ADELANTADO sin plan activo y sin Cantidad — no se registra nada. Orden=${CodigoOrden}`);
        }
        return;
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
  const { PagIdPago, CliIdCliente, MontoPago, MonIdMoneda, UsuarioAlta, DocIdDocumento } = params;

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
      // Estampar el documento cobrado (si el llamador lo provee, ej. venta contado)
      // para que el PAGO no quede "Sin referencia" en la vista 360.
      DocIdDocumento: DocIdDocumento || null,
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

    // Detectar si el cliente es "ROLLO POR ADELANTADO"
    // → permite saldo negativo en cuenta de recursos; no genera deuda monetaria por exceso
    const cliTipoRes = await mkReq()
      .input('CliIdCliente', sql.Int, CliIdCliente)
      .query(`SELECT UPPER(RTRIM(LTRIM(ISNULL(tc.TClDescripcion,'')))) AS TipoDesc
              FROM dbo.Clientes c WITH(NOLOCK)
              LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
              WHERE c.CliIdCliente = @CliIdCliente`);
    const esRolloAdelantado = (cliTipoRes.recordset[0]?.TipoDesc || '').includes('ROLLO');
    logger.info(`[HOOK:METROS] CliId=${CliIdCliente} esRolloAdelantado=${esRolloAdelantado}`);

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
      if (esRolloAdelantado) {
        // ROLLO POR ADELANTADO sin plan activo → NO genera deuda monetaria.
        // El cliente paga con rollos físicos; sin plan abierto aún no hay metros para descontar.
        logger.warn(`[HOOK:METROS] ROLLO_ADELANTADO sin plan activo — sin deuda monetaria. CliId=${CliIdCliente} Orden=${CodigoOrden}`);
        await transaction.commit();
        return;
      }
      logger.warn(`[HOOK:METROS] ⚠️ Sin plan activo para CliId=${CliIdCliente} ProId=${ProIdProducto} — Generando deuda monetaria por ${params.Importe}`);
      // Solo para clientes NO-ROLLO: llama a generar deuda por el 100%
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
    const rawTC = cotRes.recordset.length > 0 ? parseFloat(cotRes.recordset[0].CotDolar) : 40.0;
    const TC = (rawTC && rawTC > 0) ? rawTC : 40.0;

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

      // Recargo urgencia s/rollo: solo aplica si la orden es Urgente y el
      // cliente tiene excepción de cobro de urgencia — ver urgenciaDescuentoRolloService.js
      await aplicarRecargoUrgenciaRollo({
        transaction, OrdIdOrden, CliIdCliente, ProIdProducto,
        PlaIdPlan: plan.PlaIdPlan, CueIdCuenta: plan.CueIdCuenta,
        metrosConsumidos: consumir, UsuarioAlta, CodigoOrden,
      });

      cantidadPendiente = Math.round((cantidadPendiente - consumir) * 10000) / 10000;
      const restante = Math.round((total - nuevaUsada) * 10000) / 10000;

      // Calcular el valor financiero de los metros consumidos para restarlo a la deuda final
      const precioTotal = parseFloat(plan.PlaPrecioUnitario) || 0;
      let precioUnitarioPlan = total > 0 ? (precioTotal / total) : 0;
      
      if (plan.MonIdMoneda && params.MonIdMoneda && plan.MonIdMoneda !== params.MonIdMoneda && precioUnitarioPlan > 0) {
         if (plan.MonIdMoneda === 2 && params.MonIdMoneda === 1) { // Plan en USD, Orden en UYU -> multiplicar
             precioUnitarioPlan = precioUnitarioPlan * TC;
         } else if (plan.MonIdMoneda === 1 && params.MonIdMoneda === 2) { // Plan en UYU, Orden en USD -> dividir
             precioUnitarioPlan = TC > 0 ? (precioUnitarioPlan / TC) : 0;
         }
      }
      valorCubiertoPorPlanes += (consumir * precioUnitarioPlan);

      logger.info(`[CONTABILIDAD] Metros descontados: ${consumir}. Plan ${plan.PlaIdPlan} → Restante: ${restante}`);

      if (restante > 0 && total > 0 && restante / total < 0.1) {
        logger.warn(`[CONTABILIDAD] ⚠️ Plan ${plan.PlaIdPlan} de CliId=${CliIdCliente} tiene menos del 10% restante (${restante} uds)`);
      }
    }

    // 3a. Cliente con plan comprado: el exceso va negativo en la cuenta de recursos.
    //     Aplica a ROLLO y SEMANAL con recursos — nunca genera deuda monetaria por exceso de metros.
    const excessoFinal = cantidadPendiente; // capturar antes de zeroing para la obs CUBIERTO
    if (cantidadPendiente > 0 && planRes.recordset.length > 0) {
      const lastPlan = planRes.recordset[planRes.recordset.length - 1];
      logger.info(`[HOOK:METROS] CON_RECURSOS — registrando exceso negativo de ${cantidadPendiente} uds en cuenta ${lastPlan.CueIdCuenta}`);
      await registrarMovimiento({
        CueIdCuenta:     lastPlan.CueIdCuenta,
        MovTipo:         'ENTREGA',
        MovConcepto:     `${CodigoOrden} ${NombreTrabajo || ''}`.trim() || `Exceso`,
        MovImporte:      -Math.abs(cantidadPendiente),
        MovUsuarioAlta:  UsuarioAlta,
        OrdIdOrden,
        MovObservaciones: `Exceso s/ Plan #${lastPlan.PlaIdPlan}`,
      }, transaction);

      await aplicarRecargoUrgenciaRollo({
        transaction, OrdIdOrden, CliIdCliente, ProIdProducto,
        PlaIdPlan: lastPlan.PlaIdPlan, CueIdCuenta: lastPlan.CueIdCuenta,
        metrosConsumidos: excessoFinal, UsuarioAlta, CodigoOrden,
      });

      cantidadPendiente = 0;
    }

    // Marcar la ORDEN monetaria existente como CUBIERTO (si existe y no está ya marcada).
    // Cubre el caso donde la ORDEN fue creada por otra vía (PREPAGO, motor externo) antes de
    // que el plan descuente los metros. Sin esta marca, aparece en "Pendientes de Facturar".
    if (planRes.recordset.length > 0 && OrdIdOrden) {
      const lastPlanMark = planRes.recordset[planRes.recordset.length - 1];
      const obsMarcar = excessoFinal > 0
        ? `CUBIERTO_NEG_${excessoFinal.toFixed(2)}_PLAN_${lastPlanMark.PlaIdPlan}`
        : `CUBIERTO_POR_PLAN_${lastPlanMark.PlaIdPlan}`;
      await mkReq()
        .input('OrdId', sql.Int, OrdIdOrden)
        .input('CliId', sql.Int, CliIdCliente)
        .input('Obs', sql.NVarChar(500), obsMarcar)
        .query(`
          UPDATE m
          SET    m.MovObservaciones = @Obs
          FROM   dbo.MovimientosCuenta m
          JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
          WHERE  m.OrdIdOrden = @OrdId
            AND  cc.CliIdCliente = @CliId
            AND  cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
            AND  m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
            AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
            AND  m.DocIdDocumento IS NULL
            AND  (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')
        `);
    }

    // 3b. Clientes sin plan de recursos: generar cargo monetario por metros no cubiertos
    if (!esRolloAdelantado && planRes.recordset.length === 0 && params.Importe > 0) {
      let deudaACobrar = 0;

      if (cantidadPendiente > 0) {
        if (valorCubiertoPorPlanes > 0) {
          deudaACobrar = params.Importe - valorCubiertoPorPlanes;
          if (deudaACobrar < 0) deudaACobrar = 0;
        } else {
          const porcentajeFaltante = cantidadPendiente / Cantidad;
          deudaACobrar = params.Importe * porcentajeFaltante;
        }
      }

      const deudaRedondeada = Math.round(deudaACobrar * 100) / 100;

      if (deudaRedondeada > 0) {
        logger.info(`[CONTABILIDAD] Planes consumidos. Faltaban ${cantidadPendiente} uds. Deuda: ${params.Importe}, Cubierto: ${valorCubiertoPorPlanes}. Generando cargo monetario: ${deudaRedondeada}.`);
        await hookOrdenCreada({
          OrdIdOrden,
          CliIdCliente,
          Importe:       deudaRedondeada,
          MonIdMoneda:   params.MonIdMoneda,
          CodigoOrden,
          NombreTrabajo: params.NombreTrabajo ? `${params.NombreTrabajo} (Saldo Faltante)` : 'Exceso de Plan (Saldo Faltante)',
          UsuarioAlta,
          ProIdProducto: null,
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
        ISNULL((
          SELECT SUM(MovImporte) 
          FROM dbo.MovimientosCuenta WITH(NOLOCK)
          WHERE CueIdCuenta = cc.CueIdCuenta 
            AND (MovAnulado IS NULL OR MovAnulado = 0)
            AND MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')
        ), 0) AS CueSaldoActual,
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
          SELECT ABS(SUM(MovImporte))
          FROM   dbo.MovimientosCuenta WITH(NOLOCK)
          WHERE  CueIdCuenta = cc.CueIdCuenta
            AND  MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
            AND  DocIdDocumento IS NULL
            AND  (MovAnulado IS NULL OR MovAnulado = 0)
            AND  (MovObservaciones IS NULL OR NOT (MovObservaciones LIKE 'CUBIERTO%'))
        ), 0) AS PendienteFacturar,
        ISNULL((
          SELECT SUM(DDeImportePendiente)
          FROM   dbo.DeudaDocumento WITH(NOLOCK)
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
        AND (
          cc.CueActiva = 1
          -- Incluir cuentas de recursos aunque estén inactivas (tienen historial de metros)
          OR (cc.CueActiva = 0
              AND (cc.ProIdProducto IS NOT NULL
                   OR cc.CueTipo NOT IN (
                     'USD','UYU','ARS','EUR','PYG','BRL',
                     'CORRIENTE','CREDITO','DEBITO','CAJA',
                     'DINERO_USD','DINERO_UYU'
                   )))
        )
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
        AND MovTipo NOT IN ('ORDEN', 'ORDEN_ANTICIPO')
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
      COALESCE(dc.DocCliNombre, dcPago.DocCliNombre, '') AS DocCliNombre,
      COALESCE(dc.DocCliDocumento, dcPago.DocCliDocumento, '') AS DocCliDocumento,
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
      oa.CodigoOrdenStr,
      oa.CodigoOrdenStr AS OrdCodigoOrden,
      oa.NombreTrabajo AS OrdNombreTrabajo,
      (
         SELECT d.ID AS DetalleID, a.CodArticulo, d.Cantidad, d.PrecioUnitario, d.Subtotal, d.LogPrecioAplicado, a.Descripcion, pc.Moneda, a.CodStock, sa.Articulo AS ArticuloNombre
         FROM dbo.PedidosCobranza pc WITH(NOLOCK)
         JOIN dbo.PedidosCobranzaDetalle d WITH(NOLOCK) ON pc.ID = d.PedidoCobranzaID
         LEFT JOIN dbo.Articulos a WITH(NOLOCK) ON a.ProIdProducto = d.ProIdProducto
         LEFT JOIN dbo.StockArt sa WITH(NOLOCK) ON a.CodStock = sa.CodStock
         WHERE LTRIM(RTRIM(pc.NoDocERP)) = oa.CodigoOrdenStr
         FOR JSON PATH
      ) AS DetallesJSON
    FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    LEFT JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagIdPago = m.PagIdPago
    LEFT JOIN dbo.TransaccionesCaja tca WITH(NOLOCK) ON tca.TcaIdTransaccion = p.PagTcaIdTransaccion
    LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento
    LEFT JOIN dbo.DocumentosContables dcPago WITH(NOLOCK) ON dcPago.TcaIdTransaccion = p.PagTcaIdTransaccion
    OUTER APPLY (
      SELECT COALESCE(
        (SELECT TOP 1 CodigoOrden FROM dbo.Ordenes WITH(NOLOCK) WHERE OrdenID = m.OrdIdOrden),
        (SELECT TOP 1 OrdCodigoOrden FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OrdIdOrden = m.OrdIdOrden),
        (SELECT TOP 1 OrdCodigoOrden FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OReIdOrdenRetiro = m.OReIdOrdenRetiro),
        m.MovRefExterna
      ) AS CodigoOrdenStr,
      COALESCE(
        (SELECT TOP 1 DescripcionTrabajo FROM dbo.Ordenes WITH(NOLOCK) WHERE OrdenID = m.OrdIdOrden),
        (SELECT TOP 1 OrdNombreTrabajo FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OrdIdOrden = m.OrdIdOrden)
      ) AS NombreTrabajo
    ) oa
    WHERE m.CueIdCuenta = @CueIdCuenta
      AND (
        -- Excluir \u00f3rdenes anuladas: no aportan valor contable y confunden el historial
        (m.MovAnulado IS NULL OR m.MovAnulado = 0)
        OR m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO','ENTREGA')
      )
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
      importeVirtual = realImporte;
      
      // Si el importe es 0, es un movimiento de sólo lectura / trazabilidad
      // (ej: cierre de ciclo cross-moneda en la cuenta origen). 
      // Ya no forzamos DocTotal aquí para evitar duplicar el consumo visualmente,
      // porque el débito real se registra en el otro movimiento (VTA_CAJA o CIERRE_CICLO con importe < 0).
      if (realImporte === 0) {
        isVisible = false; // Lo ocultamos para no mostrar una fila en 0 duplicada
      }
    } else if (['PAGO', 'VTA_CAJA', 'SALDO_INICIAL', 'SALDO_INICIAL_DEUDOR', 'SALDO_A_FAVOR', 'COBRO', 'ANTICIPO', 'AJUSTE', 'AJUSTE_POS', 'AJUSTE_NEG', 'PAGO_CRUZADO', 'NOTA_DEBITO'].includes(m.MovTipo)) {
      isVisible = true;
      importeVirtual = Number(m.MovImporte);
    } else if (['NOTA_CREDITO', 'REVERSO', 'DEVOLUCION'].includes(m.MovTipo)) {
      isVisible = true;
      importeVirtual = Math.abs(Number(m.MovImporte));
    } else if (m.MovTipo === 'ENTREGA') {
      // ENTREGA: consumo de metros de un plan — siempre visible (es el movimiento principal en cuentas de Recursos)
      isVisible = true;
      importeVirtual = Number(m.MovImporte); // negativo (consumo)
    } else if (['ORDEN', 'ORDEN_ANTICIPO'].includes(m.MovTipo)) {
      // ORDEN/ORDEN_ANTICIPO: en cuentas monetarias son débitos internos consolidados en CIERRE_CICLO
      // Se ocultan de la tabla principal (Historial) para mostrarse en su propia tabla de Pendientes
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
      DATEDIFF(DAY, d.DDeFechaVencimiento, GETDATE()) AS DiasVencido,
      docPrincipal.DocCliNombre,
      docPrincipal.DocCliDocumento
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
        cc.CliIdCliente,
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
        docPrincipal.DocCliNombre,
        docPrincipal.DocCliDocumento,
        LTRIM(RTRIM(docPrincipal.DocSerie)) AS DocSerie,
        LTRIM(RTRIM(CAST(docPrincipal.DocNumero AS VARCHAR(50)))) AS DocNumero,
        LTRIM(RTRIM(docPrincipal.DocTipo)) AS DocTipoReal,
        cli.Nombre AS ClienteNombre,
        (SELECT c.CicSaldoFacturar FROM dbo.DocumentosContables dc WITH(NOLOCK) JOIN dbo.CiclosCredito c WITH(NOLOCK) ON c.CicIdCiclo = dc.CicIdCiclo WHERE dc.DocIdDocumento = d.DocIdDocumento AND dc.DocTipo = 'FACTURA') AS CicSaldoFacturar,
        (SELECT c.CicTotalOrdenes FROM dbo.DocumentosContables dc WITH(NOLOCK) JOIN dbo.CiclosCredito c WITH(NOLOCK) ON c.CicIdCiclo = dc.CicIdCiclo WHERE dc.DocIdDocumento = d.DocIdDocumento AND dc.DocTipo = 'FACTURA') AS CicTotalOrdenes,
        (SELECT c.CicTotalPagos FROM dbo.DocumentosContables dc WITH(NOLOCK) JOIN dbo.CiclosCredito c WITH(NOLOCK) ON c.CicIdCiclo = dc.CicIdCiclo WHERE dc.DocIdDocumento = d.DocIdDocumento AND dc.DocTipo = 'FACTURA') AS CicTotalPagos,
        (SELECT 
            m.OrdIdOrden,
            ISNULL(od.OrdCodigoOrden, erp.CodigoOrden) as CodigoOrden,
            ABS(m.MovImporte) as Importe,
            m.MovConcepto as Concepto
         FROM dbo.MovimientosCuenta m WITH(NOLOCK)
         LEFT JOIN dbo.Ordenes erp WITH(NOLOCK) ON erp.OrdenID = m.OrdIdOrden
         LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdCodigoOrden = erp.CodigoOrden
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
      LEFT JOIN dbo.DocumentosContables docPrincipal WITH(NOLOCK) ON docPrincipal.DocIdDocumento = d.DocIdDocumento
      LEFT JOIN dbo.Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = cc.MonIdMoneda
      LEFT JOIN dbo.Ordenes ordERP WITH(NOLOCK) ON ordERP.OrdenID = d.OrdIdOrden
      LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdCodigoOrden = ordERP.CodigoOrden
      WHERE cc.CliIdCliente = @CliIdCliente
        AND d.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')
        AND d.DDeImportePendiente > 0.01
        -- Neutraliza el bug de DeudaDocumento DUPLICADA (el cierre de ciclo con cambio de precio genera
        -- 2 filas por el mismo documento → el cobro sumaba doble). Criterio del equipo (fix_saldo_por_cliente.sql):
        -- LA FACTURA MANDA → por cada documento dejamos SOLO la fila cuyo importe original coincide con el
        -- DocTotal del comprobante. Las órdenes sin factura (DocIdDocumento NULL) quedan todas.
        AND (
          d.DocIdDocumento IS NULL
          OR d.DDeIdDocumento IN (
            SELECT ranked.DDeIdDocumento FROM (
              SELECT dd.DDeIdDocumento,
                     ROW_NUMBER() OVER (PARTITION BY dd.DocIdDocumento
                       ORDER BY CASE WHEN ABS(dd.DDeImporteOriginal - ISNULL(dcT.DocTotal, dd.DDeImporteOriginal)) <= 2.0 THEN 0 ELSE 1 END,
                                dd.DDeImportePendiente ASC,
                                ABS(dd.DDeImporteOriginal - ISNULL(dcT.DocTotal, dd.DDeImporteOriginal)) ASC,
                                dd.DDeIdDocumento) AS rn
              FROM dbo.DeudaDocumento dd WITH(NOLOCK)
              JOIN dbo.CuentasCliente cc2 WITH(NOLOCK) ON cc2.CueIdCuenta = dd.CueIdCuenta
              LEFT JOIN dbo.DocumentosContables dcT WITH(NOLOCK) ON dcT.DocIdDocumento = dd.DocIdDocumento
              WHERE cc2.CliIdCliente = @CliIdCliente
                AND dd.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')
                AND dd.DDeImportePendiente > 0.01
                AND dd.DocIdDocumento IS NOT NULL
            ) ranked WHERE ranked.rn = 1
          )
        )
      -- Más reciente primero. DDeIdDocumento desempata para que el orden sea estable.
      ORDER BY d.DDeFechaEmision DESC, d.DDeIdDocumento DESC
    `);

  return result.recordset.map(r => ({
    ...r,
    // Documento real del comprobante (PC-1945 / ET-1693 / e-Factura…), cuando la deuda ya está facturada
    Documento: r.DocSerie ? `${r.DocSerie}-${r.DocNumero}` : null,
    SubOrdenes: r.SubOrdenesJSON ? JSON.parse(r.SubOrdenesJSON) : []
  }));
}

/**
 * getResumenDocumentos
 * ──────────────────────────────────────────────────────────────────────────
 * Vista LEGIBLE del estado de cuenta: una fila por documento (no el libro
 * mayor). Devuelve, por cada documento de deuda del cliente, su importe, lo
 * pagado, lo pendiente y un estado claro (PAGADO / PARCIAL / VENCIDO /
 * PENDIENTE / ANULADO), agrupable por moneda. Solo lectura.
 *
 * Notas de datos:
 *  - El pendiente se toma deduplicado de DeudaDocumento (MIN entre filas vivas)
 *    y se acota a [0, DocTotal] para neutralizar el bug de filas duplicadas.
 *  - Los recibos (RC) no son cargos: se usan solo para anotar el "documento de
 *    pago" cuando su importe coincide con lo pagado (best-effort, no hay vínculo
 *    estructural recibo→documento en los datos).
 *
 * @param {number} CliIdCliente
 * @param {string|Date|null} desde  Filtro por DocFechaEmision (opcional)
 * @param {string|Date|null} hasta
 * @returns {Promise<{documentos: Array}>}
 */
async function getResumenDocumentos(CliIdCliente, desde = null, hasta = null) {
  const pool = await getPool();

  const docsRes = await pool.request()
    .input('cli',   sql.Int,  parseInt(CliIdCliente))
    .input('desde', sql.Date, desde || null)
    .input('hasta', sql.Date, hasta || null)
    .query(`
      SELECT
        dc.DocIdDocumento,
        LTRIM(RTRIM(dc.DocSerie)) AS DocSerie,
        LTRIM(RTRIM(CAST(dc.DocNumero AS VARCHAR(50)))) AS DocNumero,
        LTRIM(RTRIM(dc.DocTipo))  AS DocTipo,
        ISNULL(mo.MonSimbolo,'$') AS MonSimbolo,
        dc.MonIdMoneda,
        CAST(dc.DocTotal AS DECIMAL(18,2)) AS DocTotal,
        dc.DocEstado, dc.DocPagado, dc.CfeEstado,
        CONVERT(varchar(10), dc.DocFechaEmision, 23) AS Emision,
        (SELECT TOP 1 dd.DDeImportePendiente FROM dbo.DeudaDocumento dd WITH(NOLOCK)
           WHERE dd.DocIdDocumento = dc.DocIdDocumento
             AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA','PAGADO')
           ORDER BY CASE WHEN ABS(dd.DDeImporteOriginal - dc.DocTotal) <= 2.0 THEN 0 ELSE 1 END,
                    dd.DDeImportePendiente ASC, ABS(dd.DDeImporteOriginal - dc.DocTotal) ASC, dd.DDeIdDocumento) AS PendVivo,
        (SELECT TOP 1 dd.DDeImporteOriginal FROM dbo.DeudaDocumento dd WITH(NOLOCK)
           WHERE dd.DocIdDocumento = dc.DocIdDocumento
             AND dd.DDeEstado NOT IN ('CANCELADA','ANULADA','PAGADO')
           ORDER BY CASE WHEN ABS(dd.DDeImporteOriginal - dc.DocTotal) <= 2.0 THEN 0 ELSE 1 END,
                    dd.DDeImportePendiente ASC, ABS(dd.DDeImporteOriginal - dc.DocTotal) ASC, dd.DDeIdDocumento) AS OrigVivo,
        (SELECT MAX(CASE WHEN dd.DDeEstado='VENCIDO' THEN 1 ELSE 0 END) FROM dbo.DeudaDocumento dd WITH(NOLOCK)
           WHERE dd.DocIdDocumento = dc.DocIdDocumento) AS EsVencido,
        (SELECT TOP 1 LTRIM(RTRIM(m.MovConcepto)) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
           WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovConcepto LIKE '%ET-%'
           ORDER BY m.MovIdMovimiento DESC) AS ConceptoFactura,
        (SELECT COUNT(*) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
           WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
             AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) AS OrdenesCount,
        (SELECT TOP 1 LTRIM(RTRIM(m.MovConcepto)) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
           WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
             AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
           ORDER BY m.MovIdMovimiento) AS OrdenSample
      FROM dbo.DocumentosContables dc WITH(NOLOCK)
      LEFT JOIN dbo.Monedas mo WITH(NOLOCK) ON mo.MonIdMoneda = dc.MonIdMoneda
      WHERE dc.CliIdCliente = @cli
        AND dc.DocTipo NOT LIKE '%ecibo%'
        AND dc.DocTipo NOT LIKE '%greso%'
        AND (@desde IS NULL OR CAST(dc.DocFechaEmision AS DATE) >= @desde)
        AND (@hasta IS NULL OR CAST(dc.DocFechaEmision AS DATE) <= @hasta)
      ORDER BY mo.MonSimbolo DESC, dc.DocFechaEmision DESC, dc.DocIdDocumento DESC
    `);

  const recRes = await pool.request()
    .input('cli', sql.Int, parseInt(CliIdCliente))
    .query(`
      SELECT LTRIM(RTRIM(dc.DocSerie)) AS Serie,
             LTRIM(RTRIM(CAST(dc.DocNumero AS VARCHAR(50)))) AS Numero,
             CAST(dc.DocTotal AS DECIMAL(18,2)) AS Total
      FROM dbo.DocumentosContables dc WITH(NOLOCK)
      WHERE dc.CliIdCliente = @cli
        AND (dc.DocTipo LIKE '%ecibo%' OR dc.DocSerie = 'RC')
        AND dc.DocEstado NOT IN ('ANULADO')
      ORDER BY dc.DocIdDocumento DESC
    `);
  const recibos = recRes.recordset;

  const documentos = docsRes.recordset.map(d => {
    const docTotal = Number(d.DocTotal) || 0;
    // Base = deuda REAL cargada a la cuenta corriente (DDeImporteOriginal de la fila viva),
    // NO el bruto del documento. Evita inventar un "pago" cuando el documento se facturó por
    // más de lo que realmente se debía en cta cte (bug de deuda duplicada / cierre de ciclo).
    const total   = d.OrigVivo != null ? Number(d.OrigVivo) : docTotal;
    const anulado = /ANULAD/i.test(d.DocEstado || '');
    let pendiente;
    if (anulado)                 pendiente = 0;
    else if (d.PendVivo != null) pendiente = Math.min(Math.max(0, Number(d.PendVivo)), total);
    else                         pendiente = d.DocPagado ? 0 : total;
    const pagado = anulado ? 0 : Math.max(0, +(total - pendiente).toFixed(2));

    let estado;
    if (anulado)                estado = 'ANULADO';
    else if (pendiente <= 0.01) estado = 'PAGADO';
    else if (pagado > 0.01)     estado = 'PARCIAL';
    else                        estado = d.EsVencido ? 'VENCIDO' : 'PENDIENTE';

    let factura = null;
    const mEt = (d.ConceptoFactura || '').match(/ET-?\s?(\d+)/i);
    if (mEt) factura = `ET-${mEt[1]}`;

    let reciboPago = null;
    if (pagado > 0.01) {
      const match = recibos.find(r => Math.abs(Number(r.Total) - pagado) < 1.0);
      if (match) reciboPago = `${match.Serie}-${match.Numero}`;
    }

    // Descripción legible: cantidad de órdenes o el nombre del trabajo (si es 1)
    let descripcion = null;
    const ordCount = Number(d.OrdenesCount || 0);
    if (ordCount >= 2)      descripcion = `${ordCount} órdenes`;
    else if (ordCount === 1 && d.OrdenSample) descripcion = d.OrdenSample.replace(/\s+/g, ' ').trim();

    return {
      DocIdDocumento: d.DocIdDocumento,
      documento: `${d.DocSerie}-${d.DocNumero}`,
      tipo: d.DocTipo,
      factura,
      cfeEstado: d.CfeEstado || null,
      descripcion,
      MonSimbolo: d.MonSimbolo,
      MonIdMoneda: d.MonIdMoneda,
      fecha: d.Emision,
      total, pagado, pendiente, estado,
      reciboPago,
    };
  });

  // ── Pagos del cliente (cobros / anticipos / saldo a favor) ────────────────
  const pagosRes = await pool.request()
    .input('cli',   sql.Int,  parseInt(CliIdCliente))
    .input('desde', sql.Date, desde || null)
    .input('hasta', sql.Date, hasta || null)
    .query(`
      SELECT
        CONVERT(varchar(10), m.MovFecha, 23) AS Fecha,
        m.MovTipo,
        ISNULL(mo.MonSimbolo,'$') AS MonSimbolo,
        CAST(ABS(m.MovImporte) AS DECIMAL(18,2)) AS Importe,
        LTRIM(RTRIM(ISNULL(m.MovConcepto,''))) AS Concepto,
        LTRIM(RTRIM(ISNULL(dc.DocSerie,''))) +
          CASE WHEN dc.DocNumero IS NOT NULL
               THEN '-' + LTRIM(RTRIM(CAST(dc.DocNumero AS VARCHAR(50)))) ELSE '' END AS DocRef,
        -- Orden: referencia de respaldo cuando el cobro cancela una deuda de una orden
        -- que todavía no se facturó (no hay documento al que imputar, y es correcto).
        LTRIM(RTRIM(ISNULL(od.OrdCodigoOrden,''))) AS OrdenRef,
        -- Forma(s) de pago del cobro. Preferir el vínculo directo (m.PagIdPago → su
        -- transacción); si el movimiento no lo tiene (cobros viejos), caer al RECIBO que
        -- ese cobro generó (mismo cliente, fecha e importe), cuya transacción sí trae el medio.
        COALESCE(med.Medios,  medRC.Medios)  AS Medios,
        COALESCE(med.Cheques, medRC.Cheques) AS Cheques,
        medRC.Recibo
      FROM dbo.MovimientosCuenta m WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
      LEFT JOIN dbo.Monedas mo WITH(NOLOCK) ON mo.MonIdMoneda = cc.MonIdMoneda
      LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = m.DocIdDocumento
      LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = m.OrdIdOrden
      LEFT JOIN dbo.Pagos pg WITH(NOLOCK) ON pg.PagIdPago = m.PagIdPago
      OUTER APPLY (
        SELECT
          Medios  = STRING_AGG(CAST(LTRIM(RTRIM(mp.MPaDescripcionMetodo)) AS NVARCHAR(MAX)), ' + '),
          Cheques = STRING_AGG(CAST(LTRIM(RTRIM(ch.NumeroCheque)) AS NVARCHAR(MAX)), ', ')
        FROM dbo.Pagos p2 WITH(NOLOCK)
        LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p2.MPaIdMetodoPago
        LEFT JOIN dbo.TesoreriaCheques ch WITH(NOLOCK) ON ch.IdCheque = p2.PagIdCheque
        WHERE pg.PagTcaIdTransaccion IS NOT NULL
          AND p2.PagTcaIdTransaccion = pg.PagTcaIdTransaccion
      ) med
      OUTER APPLY (
        -- Fallback por el recibo: el cobro generó un RC con la misma fecha e importe;
        -- su transacción tiene el medio (y el cheque, si aplica). Best-effort por si el
        -- movimiento viejo no guardó el PagIdPago.
        SELECT TOP 1
          Recibo  = LTRIM(RTRIM(rc.DocSerie)) + '-' + LTRIM(RTRIM(CAST(rc.DocNumero AS VARCHAR(50)))),
          Medios  = (SELECT STRING_AGG(CAST(LTRIM(RTRIM(mp2.MPaDescripcionMetodo)) AS NVARCHAR(MAX)), ' + ')
                     FROM dbo.Pagos p3 WITH(NOLOCK)
                     JOIN dbo.MetodosPagos mp2 WITH(NOLOCK) ON mp2.MPaIdMetodoPago = p3.MPaIdMetodoPago
                     WHERE p3.PagTcaIdTransaccion = rc.TcaIdTransaccion),
          Cheques = (SELECT STRING_AGG(CAST(LTRIM(RTRIM(ch2.NumeroCheque)) AS NVARCHAR(MAX)), ', ')
                     FROM dbo.Pagos p3 WITH(NOLOCK)
                     LEFT JOIN dbo.TesoreriaCheques ch2 WITH(NOLOCK) ON ch2.IdCheque = p3.PagIdCheque
                     WHERE p3.PagTcaIdTransaccion = rc.TcaIdTransaccion AND p3.PagIdCheque IS NOT NULL)
        FROM dbo.DocumentosContables rc WITH(NOLOCK)
        WHERE rc.CliIdCliente = cc.CliIdCliente
          AND rc.DocSerie = 'RC'
          AND rc.TcaIdTransaccion IS NOT NULL
          AND ABS(rc.DocTotal - ABS(m.MovImporte)) <= 0.5
          AND CAST(rc.DocFechaEmision AS DATE) = CAST(m.MovFecha AS DATE)
        -- DESC para tomar el recibo con número "limpio" (RC-90) en vez del padded (RC-000089)
        ORDER BY rc.DocIdDocumento DESC
      ) medRC
      WHERE cc.CliIdCliente = @cli
        AND m.MovTipo IN ('PAGO','ANTICIPO','SALDO_A_FAVOR','COBRO','NOTA_CREDITO')
        AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
        AND (@desde IS NULL OR CAST(m.MovFecha AS DATE) >= @desde)
        AND (@hasta IS NULL OR CAST(m.MovFecha AS DATE) <= @hasta)
      ORDER BY m.MovFecha DESC, m.MovIdMovimiento DESC
    `);

  const TIPO_PAGO_LABEL = {
    PAGO: 'Cobro', COBRO: 'Cobro', ANTICIPO: 'Anticipo',
    SALDO_A_FAVOR: 'Saldo a favor', NOTA_CREDITO: 'Nota de crédito',
  };
  const pagos = pagosRes.recordset.map(p => {
    // Documento al que se aplicó: preferir la referencia real; si no, la orden; y como
    // último recurso extraerlo del concepto (cobros viejos sin el vínculo estampado).
    let aplicadoA = p.DocRef && p.DocRef !== '-' ? p.DocRef : null;
    if (!aplicadoA && p.OrdenRef) aplicadoA = p.OrdenRef;
    if (!aplicadoA) {
      const mPc = (p.Concepto || '').match(/\b(XECOUV|XDTF|XSB|UVDF|ECOUV|SUB|DTF|VEN|EUV|DIR|PC|ET|SB|DF)-?\s?(\d+)/i);
      if (mPc) aplicadoA = `${mPc[1].toUpperCase()}-${mPc[2]}`;
    }
    const esFavor = p.MovTipo === 'ANTICIPO' || p.MovTipo === 'SALDO_A_FAVOR';
    return {
      fecha: p.Fecha,
      tipo: TIPO_PAGO_LABEL[p.MovTipo] || p.MovTipo,
      esFavor,
      MonSimbolo: p.MonSimbolo,
      importe: Number(p.Importe) || 0,
      aplicadoA,
      medioPago: p.Medios || null,   // 'Contado', 'Transferencia + Cheque', …
      cheques:   p.Cheques || null,  // números de cheque, cuando el medio es cheque
      recibo:    p.Recibo || null,   // RC-xx que generó el cobro
    };
  });

  return { documentos, pagos };
}

/**
 * getMovimientosOrdenes
 * ──────────────────────────────────────────────────────────────────────────
 * Todos los MOVIMIENTOS DE ÓRDENES del cliente (una fila por orden), tomados de
 * MovimientosCuenta (MovTipo ORDEN / ORDEN_ANTICIPO). Por cada orden devuelve:
 *   - código de orden + trabajo (de Ordenes ERP / concepto)
 *   - documento en que se facturó (o null si aún no se facturó)
 *   - moneda
 *   - situación de pago (del documento cuando está facturada; SIN_FACTURAR si no)
 * Solo lectura. Filtros por MovFecha (opcionales). Cap de 800 filas.
 */
async function getMovimientosOrdenes(CliIdCliente, desde = null, hasta = null, incluirAnulados = false) {
  const pool = await getPool();
  const res = await pool.request()
    .input('cli',   sql.Int,  parseInt(CliIdCliente))
    .input('desde', sql.Date, desde || null)
    .input('hasta', sql.Date, hasta || null)
    .query(`
      SELECT TOP 800
        m.MovIdMovimiento,
        m.OrdIdOrden,
        m.CueIdCuenta,
        m.DocIdDocumento,
        m.MovAnulado,
        LTRIM(RTRIM(ISNULL(m.MovObservaciones,''))) AS MovObservaciones,
        ordERP.CodigoOrden AS CodigoOrden,
        COALESCE(od.ProIdProducto, ordERP.ProIdProducto) AS ProIdProducto,
        art.Descripcion AS Material,
        LTRIM(RTRIM(ISNULL(m.MovConcepto,''))) AS Concepto,
        CAST(ABS(m.MovImporte) AS DECIMAL(18,2)) AS Importe,
        ISNULL(mo.MonSimbolo,'$') AS MonSimbolo,
        cc.MonIdMoneda,
        LTRIM(RTRIM(ISNULL(doc.DocSerie,''))) AS DocSerie,
        LTRIM(RTRIM(CAST(doc.DocNumero AS VARCHAR(50)))) AS DocNumero,
        LTRIM(RTRIM(ISNULL(doc.DocTipo,''))) AS DocTipo,
        doc.DocEstado, doc.DocPagado,
        (SELECT MIN(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WITH(NOLOCK)
           WHERE dd.DocIdDocumento = m.DocIdDocumento
             AND dd.DDeEstado NOT IN ('ANULADA','CANCELADA','PAGADO')) AS DocPendVivo,
        CONVERT(varchar(10), m.MovFecha, 23) AS Fecha
      FROM dbo.MovimientosCuenta m WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
      LEFT JOIN dbo.Monedas mo WITH(NOLOCK) ON mo.MonIdMoneda = cc.MonIdMoneda
      LEFT JOIN dbo.Ordenes ordERP WITH(NOLOCK) ON ordERP.OrdenID = m.OrdIdOrden
      LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = m.OrdIdOrden
      LEFT JOIN dbo.Articulos art WITH(NOLOCK) ON art.ProIdProducto = COALESCE(od.ProIdProducto, ordERP.ProIdProducto)
      LEFT JOIN dbo.DocumentosContables doc WITH(NOLOCK) ON doc.DocIdDocumento = m.DocIdDocumento
      WHERE cc.CliIdCliente = @cli
        AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
        ${incluirAnulados ? '' : 'AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)'}
        AND (@desde IS NULL OR CAST(m.MovFecha AS DATE) >= @desde)
        AND (@hasta IS NULL OR CAST(m.MovFecha AS DATE) <= @hasta)
      ORDER BY m.MovFecha DESC, m.MovIdMovimiento DESC
    `);

  return res.recordset.map(r => {
    const concepto = (r.Concepto || '').replace(/\s+/g, ' ').trim();
    // código: el de Ordenes ERP; si no, el primer token del concepto (ej. "SUB-6179 ...")
    let orden = (r.CodigoOrden || '').trim();
    if (!orden) {
      const mm = concepto.match(/^([A-Za-z]{2,6}-?\d+(?:\s?\(\d+\/\d+\))?)/);
      orden = mm ? mm[1] : (r.OrdIdOrden ? `#${r.OrdIdOrden}` : '—');
    }
    // trabajo: el concepto sin el código al inicio
    let trabajo = concepto;
    if (orden && concepto.toUpperCase().startsWith(orden.toUpperCase())) {
      trabajo = concepto.slice(orden.length).trim() || null;
    }
    const facturada = !!r.DocIdDocumento;
    const anulado   = !!r.MovAnulado || /ANULAD/i.test(r.DocEstado || '');
    const pendDoc   = r.DocPendVivo != null ? Number(r.DocPendVivo) : null;

    let situacion;
    if (anulado)                                situacion = 'ANULADO';
    else if (!facturada)                        situacion = 'SIN_FACTURAR';
    else if (pendDoc != null && pendDoc > 0.01) situacion = 'PENDIENTE';
    else                                        situacion = 'PAGADO';

    return {
      MovIdMovimiento: r.MovIdMovimiento,
      OrdIdOrden: r.OrdIdOrden,
      CueIdCuenta: r.CueIdCuenta,
      ProIdProducto: r.ProIdProducto,
      material: (r.Material || '').trim() || null,
      MovObservaciones: r.MovObservaciones || null,
      orden,
      trabajo,
      facturada,
      documento: facturada ? `${r.DocSerie}-${r.DocNumero}`.replace(/^-|-$/g, '') : null,
      DocTipo:   facturada ? (r.DocTipo || null) : null,
      MonSimbolo: r.MonSimbolo,
      MonIdMoneda: r.MonIdMoneda,
      importe: Number(r.Importe) || 0,
      situacion,
      fecha: r.Fecha,
    };
  });
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
        RTRIM(LTRIM(cli.IDCliente)) AS ClienteIDCliente,
        RTRIM(LTRIM(cli.CioRuc)) AS ClienteRuc,
        RTRIM(LTRIM(cli.Email)) AS ClienteEmail,
        RTRIM(LTRIM(cli.TelefonoTrabajo)) AS ClienteTelefono,
        docPrincipal.DocCliNombre,
        docPrincipal.DocCliDocumento,
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
      LEFT JOIN dbo.DocumentosContables docPrincipal WITH(NOLOCK) ON docPrincipal.DocIdDocumento = d.DocIdDocumento
      LEFT JOIN dbo.Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = cc.MonIdMoneda
      LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = d.OrdIdOrden
      LEFT JOIN dbo.Ordenes ordERP WITH(NOLOCK) ON ordERP.OrdenID = d.OrdIdOrden
      WHERE d.DDeEstado IN ('PENDIENTE', 'PARCIAL', 'VENCIDO')
        AND d.DDeImportePendiente > 0.01
      -- Más reciente primero (dentro de cada cliente). DDeIdDocumento desempata para que
      -- el orden sea estable: varias deudas del mismo día no se barajan entre recargas.
      ORDER BY cli.Nombre ASC, d.DDeFechaEmision DESC, d.DDeIdDocumento DESC
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
      AND c.CueTipo IN ('DINERO_UYU', 'DINERO_USD', 'CORRIENTE', 'CREDITO')
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
             od.MonIdMoneda AS OrdMonIdMoneda,
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
  const contabilidadCore = require('./contabilidadCore');

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

  // 2. Generar número de factura correlativo — UNIFICADO con la caja.
  //    Primero se resuelve el numerador vía Config_TiposDocumento (el MISMO que usa
  //    venta directa / factura manual), para que no existan dos contadores "ET-"
  //    independientes que eventualmente colisionen en serie+número.
  //    Si el tipo no está mapeado (ej. 'FACTURA' manual), se usa la lógica anterior.
  const seqRes = await pool.request()
    .input('Tipo', sql.VarChar(50), tipoDocumento)
    .query(`
      DECLARE @SecId INT;

      -- 1) Resolver por Config_TiposDocumento (mismo numerador que la caja)
      SELECT TOP 1 @SecId = c.SecIdSecuencia
      FROM dbo.Config_TiposDocumento c
      WHERE UPPER(LTRIM(RTRIM(c.Detalle))) = UPPER(LTRIM(RTRIM(@Tipo)))
        AND c.SecIdSecuencia IS NOT NULL;

      IF @SecId IS NOT NULL
      BEGIN
        UPDATE dbo.SecuenciaDocumentos
        SET    SecUltimoNumero = SecUltimoNumero + 1
        OUTPUT INSERTED.SecUltimoNumero, INSERTED.SecPrefijo, INSERTED.SecSerie
        WHERE  SecIdSecuencia = @SecId;
      END
      ELSE
      BEGIN
        -- 2) Fallback (lógica anterior): buscar la secuencia activa por SecTipoDoc
        DECLARE @SecSerie VARCHAR(10);
        SELECT TOP 1 @SecSerie = SecSerie
        FROM dbo.SecuenciaDocumentos
        WHERE SecTipoDoc = @Tipo AND SecActivo = 1 AND SecSerie <> 'A'
        ORDER BY SecIdSecuencia ASC;

        IF @SecSerie IS NULL
          SET @SecSerie = (SELECT TOP 1 SecSerie FROM dbo.SecuenciaDocumentos WHERE SecTipoDoc = @Tipo AND SecActivo = 1);

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
      END
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
        const targetTipo = targetMonId === 2 ? 'DINERO_USD' : 'DINERO_UYU';
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

      // Refactored to use crearDocumentoContable
      // El frontend ya envía DcdSubtotal en la moneda de factura (hace la
      // conversión usando d.Moneda). El backend solo mapea los valores.
      const mappedLineas = [];
      if (detallesParaPDF && detallesParaPDF.length > 0) {
        for (const d of detallesParaPDF) {
          const bruto = d.DcdSubtotal != null ? Number(d.DcdSubtotal) : 0;
          const ivaRate = d.DcdIvaRate != null ? Number(d.DcdIvaRate) : 22;
          const divisor = 1 + ivaRate / 100;
          let dcdSubtotal  = bruto / divisor;
          let dcdImpuestos = bruto - dcdSubtotal;
          let dcdTotal     = bruto;

          dcdSubtotal  = Math.round(dcdSubtotal  * 10000) / 10000;
          dcdImpuestos = Math.round(dcdImpuestos * 10000) / 10000;
          dcdTotal     = Math.round(dcdTotal     * 10000) / 10000;

          mappedLineas.push({
            nomItem: (d.DcdNomItem || '').substring(0, 255),
            dscItem: (d.DcdDscItem || '').substring(0, 1000),
            cantidad: d.DcdCantidad != null ? Number(d.DcdCantidad) : 1,
            precioUnitario: d.DcdPrecioUnitario != null ? Number(d.DcdPrecioUnitario) : dcdSubtotal,
            subtotal: dcdSubtotal,
            impuestos: dcdImpuestos,
            total: dcdTotal,
            totalDescuentos: d.DcdTotalDescuentos || 0,
            descuentoStr: d.DcdDescuentoStr || null,
            // % exacto tipeado en la pre-factura (no recalculado desde importes redondeados)
            descuentoPct: d.DcdDescuentoPct != null ? Number(d.DcdDescuentoPct) : null
          });
        }
      }

      DocIdDocumento = await contabilidadCore.crearDocumentoContable({
        header: {
          cueIdCuenta: cueIdFactura,
          clienteId: ciclo.CliIdCliente,
          monedaId: targetMonId,
          tipo: tipoDocumento,
          numero: docNumero,
          serie: docSerie,
          subtotal: docSubtotal,
          impuestos: docImpuestos,
          totalDescuentos: docDescuentos,
          total: docTotal,
          estado: 'EMITIDO',
          cfeEstado: 'PENDIENTE',
          usuarioId: UsuarioAlta,
          observaciones: docObservaciones,
          docPagado: tipoDocumento.toUpperCase().includes('CONTADO'),
          cicIdCiclo: CicIdCiclo,
          docFechaDesde: ciclo.CicFechaInicio,
          docFechaHasta: fechaCierreReal,
          docCliNombre: cliDgiNombre,
          docCliDocumento: cliDgiDocumento,
          docCliDireccion: cliDgiDireccion,
          docCliCiudad: cliDgiCiudad
        },
        lineas: mappedLineas
      });

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
      // Registrar el movimiento de débito en la cuenta actual porque las ORDEN ya no restan el CueSaldoActual
      const movTipoCierre = tipoDocumento.toUpperCase().includes('CONTADO') || tipoDocumento.toUpperCase().includes('CAJA') ? 'VTA_CAJA' : 'CIERRE_CICLO';
      await registrarMovimiento({
        CueIdCuenta:   deudaCuentaId,
        MovTipo:       movTipoCierre,
        MovConcepto:   `Facturado (${tipoDocumento} ${docLabel})`,
        MovImporte:    -saldoFacturar, // débito en la misma cuenta
        MovUsuarioAlta: UsuarioAlta,
        DocIdDocumento,
        CicIdCiclo,
      });

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
  // Como las órdenes ya NO debitan la cuenta origen, NO necesitamos compensar nada.
  // El importe de este movimiento de trazabilidad es siempre 0.
  // Solo se necesita si es cross-moneda (para vincular el ciclo origen con la factura en la cuenta destino).
  // Si es misma moneda, el movimiento de la factura ya está en la cuenta origen y es suficiente.
  if (esCrossMoneda) {
    const cierreImporteOrigen = 0;
    const cierreConcepto = `Cierre ciclo → Factura ${docLabel} traspasada a ${targetMonId === 2 ? 'USD' : 'UYU'} (${docTotal.toFixed(2)} @ cot. ${cotDolar})`;

    await registrarMovimiento({
      CueIdCuenta:   ciclo.CueIdCuenta,
      MovTipo:       'CIERRE_CICLO',
      MovConcepto:   cierreConcepto,
      MovImporte:    cierreImporteOrigen,
      MovUsuarioAlta: UsuarioAlta,
      DocIdDocumento,
      CicIdCiclo,
      MovObservaciones: `Cross-moneda: Ordenes ${totalOrdenesFacturadas} ${accountMonId === 2 ? 'USD' : 'UYU'} → Factura ${docTotal.toFixed(2)} ${targetMonId === 2 ? 'USD' : 'UYU'} @ ${cotDolar}`
    });
  }

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
// SECCIÓN CENTRALIZACIÓN: OPERACIONES SOBRE MOVIMIENTOSCUENTA
// ============================================================

/**
 * anularMovimiento
 * Marca un movimiento individual como anulado (MovAnulado = 1) y revierte
 * su impacto en CueSaldoActual de la cuenta.
 *
 * @param {number} movId          MovIdMovimiento a anular
 * @param {string} obs            Observación/motivo del anulamiento
 * @param {object} transaction    Transacción mssql activa (opcional)
 */
async function anularMovimiento(movId, obs, transaction = null) {
  const pool = await getPool();
  const req = transaction ? new sql.Request(transaction) : pool.request();

  // Leer el movimiento antes de anular para revertir el saldo
  const movRes = await req
    .input('MovId', sql.Int, movId)
    .query(`SELECT CueIdCuenta, MovImporte FROM dbo.MovimientosCuenta WHERE MovIdMovimiento = @MovId AND (MovAnulado IS NULL OR MovAnulado = 0)`);

  if (!movRes.recordset.length) {
    logger.warn(`[CONTAB] anularMovimiento: MovId=${movId} no encontrado o ya anulado`);
    return;
  }
  const { CueIdCuenta, MovImporte } = movRes.recordset[0];

  const req2 = transaction ? new sql.Request(transaction) : pool.request();
  await req2
    .input('MovId', sql.Int, movId)
    .input('Obs',   sql.NVarChar(500), obs || 'Anulado por sistema')
    .query(`UPDATE dbo.MovimientosCuenta SET MovAnulado = 1, MovObservaciones = ISNULL(MovObservaciones + ' | ', '') + @Obs WHERE MovIdMovimiento = @MovId`);

  // Revertir el impacto en CueSaldoActual
  const req3 = transaction ? new sql.Request(transaction) : pool.request();
  await req3
    .input('CueId',   sql.Int,          CueIdCuenta)
    .input('Importe', sql.Decimal(18,4), MovImporte)
    .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Importe WHERE CueIdCuenta = @CueId`);

  logger.info(`[CONTAB] anularMovimiento: MovId=${movId} anulado. Saldo revertido en CueId=${CueIdCuenta} por ${MovImporte}`);
}

/**
 * anularMovimientosPorFiltro
 * Anula en lote todos los movimientos activos que coincidan con el filtro.
 * Revierte el saldo de cada uno en CuentasCliente.
 *
 * @param {object} filtros
 *   @param {number}   filtros.docId      Filtrar por DocIdDocumento
 *   @param {number}   filtros.tcaId      Filtrar por PagIdPago IN (pagos de esa transacción)
 *   @param {string[]} filtros.excluirTipos  Tipos de movimiento a NO anular (ej. ['ORDEN','ENTREGA'])
 * @param {object} transaction  Transacción mssql activa (opcional)
 * @returns {number}  Cantidad de movimientos anulados
 */
async function anularMovimientosPorFiltro(filtros, transaction = null) {
  const pool = await getPool();
  const { docId = null, tcaId = null, excluirTipos = [] } = filtros;

  const mkReq = () => transaction ? new sql.Request(transaction) : pool.request();

  // Armar WHERE dinámico
  const whereParts = [`(MovAnulado IS NULL OR MovAnulado = 0)`];
  if (docId)  whereParts.push(`(DocIdDocumento = ${docId}${tcaId ? ` OR PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = ${tcaId})` : ''})`);
  if (excluirTipos.length) whereParts.push(`MovTipo NOT IN (${excluirTipos.map(t => `'${t}'`).join(',')})`);

  const whereSQL = whereParts.join(' AND ');

  // Leer todos los movimientos a anular para revertir saldos
  const movsRes = await mkReq().query(`SELECT MovIdMovimiento, CueIdCuenta, MovImporte FROM dbo.MovimientosCuenta WHERE ${whereSQL}`);

  if (!movsRes.recordset.length) return 0;

  // Anular en bloque
  await mkReq().query(`UPDATE dbo.MovimientosCuenta SET MovAnulado = 1 WHERE ${whereSQL}`);

  // Revertir saldo en CuentasCliente para cada movimiento
  for (const mov of movsRes.recordset) {
    await mkReq()
      .input('CueId',   sql.Int,          mov.CueIdCuenta)
      .input('Importe', sql.Decimal(18,4), mov.MovImporte)
      .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Importe WHERE CueIdCuenta = @CueId`);
  }

  logger.info(`[CONTAB] anularMovimientosPorFiltro: ${movsRes.recordset.length} movimientos anulados (docId=${docId}, tcaId=${tcaId})`);
  return movsRes.recordset.length;
}

/**
 * revertirRecursosPorTransaccion
 * Revierte la COMPRA DE RECURSO (rollo por adelantado) asociada a una transacción
 * de venta directa cuando esa venta se anula.
 *
 * Contexto: procesarVentaDirecta, al vender un ítem tipo RECURSO, crea/recarga un
 * PlanesMetros, suma metros a CuentasCliente.CueSaldoActual y deja un movimiento
 * ENTRADA en MovimientosCuenta etiquetado con MovRefExterna = <TcaId> y
 * MovObservaciones = 'Plan #<PlaIdPlan>'. Ese movimiento NO tiene DocIdDocumento ni
 * PagIdPago, por lo que anularMovimientosPorFiltro nunca lo alcanza. Sin esta función
 * el recurso quedaba vivo aunque la factura se anulara.
 *
 * Por cada ENTRADA etiquetada con la transacción:
 *   - Bloquea la anulación si el recurso ya fue consumido (evita saldo negativo).
 *   - Resta los metros de PlanesMetros.PlaCantidadTotal (desactiva el plan si queda vacío).
 *   - Anula el movimiento (MovAnulado = 1) y revierte CuentasCliente.CueSaldoActual.
 *
 * @param {number} tcaId          TransaccionesCaja.TcaIdTransaccion anulada
 * @param {number} usuarioId
 * @param {object} transaction    Transacción mssql activa (obligatoria)
 * @returns {Promise<number>}     Cantidad de entradas de recurso revertidas
 */
async function revertirRecursosPorTransaccion(tcaId, usuarioId, transaction) {
  if (!tcaId || !transaction) return 0;

  const movsRes = await new sql.Request(transaction)
    .input('TcaId', sql.Int, tcaId)
    .query(`
      SELECT MovIdMovimiento, CueIdCuenta, MovImporte, MovObservaciones
      FROM dbo.MovimientosCuenta WITH(UPDLOCK)
      WHERE MovRefExterna = CAST(@TcaId AS VARCHAR(100))
        AND MovObservaciones LIKE 'Plan #%'
        AND (MovAnulado IS NULL OR MovAnulado = 0)
    `);

  let revertidos = 0;
  for (const mov of movsRes.recordset) {
    const metros = Number(mov.MovImporte) || 0;
    const match  = /Plan #(\d+)/.exec(mov.MovObservaciones || '');
    const plaId  = match ? parseInt(match[1], 10) : null;

    if (plaId) {
      const pRes = await new sql.Request(transaction)
        .input('Pla', sql.Int, plaId)
        .query(`SELECT PlaCantidadTotal, PlaCantidadUsada FROM dbo.PlanesMetros WITH(UPDLOCK) WHERE PlaIdPlan = @Pla`);

      if (pRes.recordset.length) {
        const total = Number(pRes.recordset[0].PlaCantidadTotal) || 0;
        const usada = Number(pRes.recordset[0].PlaCantidadUsada) || 0;

        // Guardia: no permitir anular si el recurso ya fue consumido (parcial o total)
        if (total - metros < usada - 0.0001) {
          throw new Error(
            `No se puede anular: el rollo por adelantado del plan #${plaId} ya fue consumido ` +
            `(usados ${usada} de ${total} metros). Reversá el consumo antes de anular la compra.`
          );
        }

        // Restar los metros comprados; desactivar el plan si queda vacío
        await new sql.Request(transaction)
          .input('Pla', sql.Int, plaId)
          .input('Metros', sql.Decimal(18,4), metros)
          .query(`
            UPDATE dbo.PlanesMetros
            SET PlaCantidadTotal = PlaCantidadTotal - @Metros,
                PlaActivo = CASE WHEN (PlaCantidadTotal - @Metros) <= PlaCantidadUsada THEN 0 ELSE PlaActivo END
            WHERE PlaIdPlan = @Pla
          `);
      }
    }

    // Anular la ENTRADA y revertir el saldo de metros de la cuenta
    await new sql.Request(transaction)
      .input('Mov', sql.Int, mov.MovIdMovimiento)
      .input('Cue', sql.Int, mov.CueIdCuenta)
      .input('Metros', sql.Decimal(18,4), metros)
      .input('Obs', sql.NVarChar(200), `ANULADO por reversión venta #${tcaId}`)
      .query(`
        UPDATE dbo.MovimientosCuenta
        SET MovAnulado = 1,
            MovObservaciones = ISNULL(MovObservaciones + ' | ', '') + @Obs
        WHERE MovIdMovimiento = @Mov;

        UPDATE dbo.CuentasCliente
        SET CueSaldoActual = ISNULL(CueSaldoActual, 0) - @Metros
        WHERE CueIdCuenta = @Cue;
      `);
    revertidos++;
  }

  if (revertidos) {
    logger.info(`[CONTAB] revertirRecursosPorTransaccion: ${revertidos} entrada(s) de recurso revertida(s) para tx #${tcaId} (usuario ${usuarioId}).`);
  }
  return revertidos;
}

/**
 * transformarMovimiento
 * Cambia el tipo de movimientos existentes (ej. ORDEN -> VTA_CAJA) y les asigna
 * un documento de respaldo. Usado por pagoService al emitir una factura web.
 *
 * @param {object} params
 *   @param {number[]} params.ordIds     IDs de OrdenDeposito cuyos movimientos se transforman
 *   @param {string}   params.tipoOrigen Tipo actual a buscar (ej. 'ORDEN')
 *   @param {string}   params.tipoDestino Nuevo tipo (ej. 'VTA_CAJA')
 *   @param {number}   params.docId      DocIdDocumento a asignar
 *   @param {string}   params.concepto   Nuevo concepto del movimiento
 * @param {object} transaction  Transacción mssql activa (opcional)
 */
async function transformarMovimiento(params, transaction = null) {
  const pool = await getPool();
  const { ordIds = [], tipoOrigen, tipoDestino, docId, concepto } = params;

  if (!ordIds.length) return;

  const mkReq = () => transaction ? new sql.Request(transaction) : pool.request();

  await mkReq()
    .input('docId',    sql.Int,          docId)
    .input('concepto', sql.NVarChar(500), concepto)
    .input('tipo',     sql.VarChar(30),  tipoDestino)
    .query(`
      UPDATE dbo.MovimientosCuenta
      SET MovTipo        = @tipo,
          DocIdDocumento = @docId,
          MovConcepto    = @concepto,
          MovFecha       = GETDATE()
      WHERE OrdIdOrden IN (${ordIds.join(',')})
        AND MovTipo = '${tipoOrigen}'
        AND (MovAnulado IS NULL OR MovAnulado = 0)
    `);

  logger.info(`[CONTAB] transformarMovimiento: ordIds=[${ordIds}] ${tipoOrigen}->${tipoDestino} docId=${docId}`);
}

// ============================================================
// EXPORTS
// ============================================================

// ============================================================
// SECCIÓN CENTRALIZACIÓN: OPERACIONES SOBRE DEUDADOCUMENTO
// ============================================================

/**
 * cancelarDeuda
 * Marca como CANCELADA una o varias deudas: DDeEstado='CANCELADA', DDeImportePendiente=0.
 * Filtrado por docId, ddeId o ambos.
 *
 * @param {object} filtros
 *   @param {number}  filtros.docId   DocIdDocumento (cancela todas las deudas del doc)
 *   @param {number}  filtros.ddeId   DDeIdDocumento (cancela una fila específica)
 * @param {object} transaction
 */
async function cancelarDeuda(filtros, transaction = null) {
  const pool = await getPool();
  const mkReq = () => transaction ? new sql.Request(transaction) : pool.request();
  const { docId = null, ddeId = null, ordId = null, cueId = null } = filtros;

  if (!docId && !ddeId && !ordId) throw new Error('[cancelarDeuda] Se requiere docId, ddeId u ordId');

  let where;
  if (ddeId)        where = `DDeIdDocumento = ${ddeId}`;
  else if (docId)   where = `DocIdDocumento = ${docId}`;
  else if (ordId)   where = `OrdIdOrden = ${ordId}${cueId ? ` AND CueIdCuenta = ${cueId}` : ''} AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')`;

  await mkReq().query(`
    UPDATE dbo.DeudaDocumento
    SET DDeEstado = 'CANCELADA', DDeImportePendiente = 0
    WHERE ${where}
  `);
  logger.info(`[CONTAB] cancelarDeuda: ${where}`);
}

/**
 * reducirDeuda
 * Reduce DDeImportePendiente de una deuda y ajusta DDeEstado según el resultado.
 * Si queda en 0 o menos → 'COBRADO'. Si queda parcial → DDeEstado sin cambio.
 *
 * @param {object} params
 *   @param {number} params.ddeId     DDeIdDocumento a reducir
 *   @param {number} params.monto     Monto a restar de DDeImportePendiente
 *   @param {number} params.docId     (Opcional) DocIdDocumento para la búsqueda alternativa
 * @param {object} transaction
 */
async function reducirDeuda(params, transaction = null) {
  const pool = await getPool();
  const mkReq = () => transaction ? new sql.Request(transaction) : pool.request();
  const { ddeId = null, docId = null, monto } = params;

  if (!ddeId && !docId) throw new Error('[reducirDeuda] Se requiere ddeId o docId');
  const where = ddeId ? `DDeIdDocumento = ${ddeId}` : `DocIdDocumento = ${docId}`;

  await mkReq()
    .input('Monto', sql.Decimal(18,4), monto)
    .query(`
      UPDATE dbo.DeudaDocumento
      SET DDeImportePendiente = CASE WHEN DDeImportePendiente - @Monto < 0 THEN 0
                                     ELSE DDeImportePendiente - @Monto END,
          DDeEstado           = CASE WHEN DDeImportePendiente - @Monto <= 0 THEN 'COBRADO'
                                     ELSE DDeEstado END,
          DDeFechaCobro       = CASE WHEN DDeImportePendiente - @Monto <= 0 THEN GETDATE()
                                     ELSE DDeFechaCobro END
      WHERE ${where} AND DDeEstado NOT IN ('CANCELADA','COBRADO')
    `);
  logger.info(`[CONTAB] reducirDeuda: ${where} monto=${monto}`);
}

/**
 * reemplazarDeuda
 * Elimina las deudas existentes de un documento y crea una nueva.
 * Reemplaza el DELETE+INSERT crudo por una operación atómica rastreable.
 * Ojo: el DELETE solo se permite para documentos en estado PENDIENTE/BORRADOR
 * que aún no pasaron por DGI. Para documentos ACEPTADOS_DGI se debe usar NC.
 *
 * @param {object} params
 *   @param {number} params.docId          DocIdDocumento a reemplazar
 *   @param {number} params.cueIdCuenta    CueIdCuenta de la cuenta corriente del cliente
 *   @param {number} params.importe        Nuevo importe original
 *   @param {number} [params.diasVenc]     Días de vencimiento (default: 7)
 * @param {object} transaction
 * @returns {number} DDeIdDocumento nuevo
 */
async function reemplazarDeuda(params, transaction = null) {
  const pool = await getPool();
  const mkReq = () => transaction ? new sql.Request(transaction) : pool.request();
  const { docId, cueIdCuenta, importe, diasVenc = 7 } = params;

  // 1. Eliminar deudas anteriores del documento (solo PENDIENTE/PARCIAL)
  await mkReq()
    .input('DocId', sql.Int, docId)
    .query(`DELETE FROM dbo.DeudaDocumento WHERE DocIdDocumento = @DocId`);

  // 2. Crear la nueva deuda (si hay importe)
  if (importe > 0) {
    const insertRes = await mkReq()
      .input('CueId',   sql.Int,           cueIdCuenta)
      .input('DocId',   sql.Int,           docId)
      .input('Orig',    sql.Decimal(18,4), importe)
      .input('Pend',    sql.Decimal(18,4), importe)
      .input('Dias',    sql.Int,           diasVenc)
      .query(`
        INSERT INTO dbo.DeudaDocumento
          (CueIdCuenta, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente,
           DDeFechaEmision, DDeFechaVencimiento, DDeEstado)
        OUTPUT INSERTED.DDeIdDocumento
        VALUES
          (@CueId, @DocId, @Orig, @Pend,
           GETDATE(), DATEADD(DAY, @Dias, GETDATE()), 'PENDIENTE')
      `);
    const newId = insertRes.recordset[0].DDeIdDocumento;
    logger.info(`[CONTAB] reemplazarDeuda: docId=${docId} → DDeId=${newId} importe=${importe}`);
    return newId;
  }

  logger.info(`[CONTAB] reemplazarDeuda: docId=${docId} eliminada (importe=0, doc pagado)`);
  return null;
}

/**
 * buscarDeudaVivaDeDocumento
 * ¿Este documento ya tiene una deuda viva? Devuelve la fila o null.
 *
 * Existe porque el guard de idempotencia vive dentro de crearDeudaDocumento, pero hay
 * caminos que insertan en DeudaDocumento con SQL crudo y se lo saltean: el documento
 * termina con DOS deudas idénticas, el cobro imputa a una y la otra sobrevive PENDIENTE
 * (la deuda ya cobrada reaparece en "Documentos con deuda"). Estos caminos llaman a este
 * helper antes de insertar para hacer el mismo chequeo sin duplicar la lógica.
 *
 * @param {number} DocIdDocumento
 * @param {object} [transaction]
 * @returns {Promise<{DDeIdDocumento:number, DDeImporteOriginal:number, DDeImportePendiente:number}|null>}
 */
async function buscarDeudaVivaDeDocumento(DocIdDocumento, transaction = null) {
  if (!DocIdDocumento) return null;
  const pool = await getPool();
  const req = transaction ? new sql.Request(transaction) : pool.request();
  const res = await req
    .input('DocIdDocumento', sql.Int, DocIdDocumento)
    .query(`
      SELECT TOP 1 DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente
      FROM   dbo.DeudaDocumento WITH (UPDLOCK, ROWLOCK)
      WHERE  DocIdDocumento = @DocIdDocumento
        AND  DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
        AND  DDeImportePendiente > 0.01
      ORDER BY DDeIdDocumento
    `);
  return res.recordset.length ? res.recordset[0] : null;
}

// ============================================================
// SECCIÓN CENTRALIZACIÓN: ENSAMBLADO DE ESTADO DE CUENTA
// ============================================================

/**
 * getEstadoCuentaCompleto
 * Fuente única de verdad para armar el estado de cuenta de un cliente.
 * Usada por:
 *   - contabilidadController.getEstadoCuentaCliente (reporte web/PDF)
 *   - estadosCuenta.job (snapshot para email)
 *   - cualquier consumer futuro
 *
 * @param {number}  clienteId
 * @param {Date|null} desde       Inicio del período (null = desde el origen)
 * @param {Date|null} hasta       Fin del período   (null = hasta hoy)
 * @param {object}  opts
 *   @param {number}  opts.top          Límite de movimientos por cuenta (default: 500)
 *   @param {boolean} opts.soloActivas  Si true, filtra cuentas con saldo=0 y sin deudas (default: false)
 * @returns {Promise<{cliente, cuentas, periodoDesde, periodoHasta, generadoEn}>}
 */
async function getEstadoCuentaCompleto(clienteId, desde = null, hasta = null, opts = {}) {
  const pool = await getPool();
  const { top = 500, soloActivas = false } = opts;

  // 1. Datos del cliente
  const cliRes = await pool.request()
    .input('CliIdCliente', sql.Int, parseInt(clienteId))
    .query(`
      SELECT CliIdCliente, Nombre, NombreFantasia, Email, TelefonoTrabajo, CioRuc
      FROM   dbo.Clientes WITH(NOLOCK)
      WHERE  CliIdCliente = @CliIdCliente
    `);

  if (!cliRes.recordset.length) {
    throw new Error(`Cliente ${clienteId} no encontrado`);
  }
  const cliente = cliRes.recordset[0];

  // 2. Cuentas con saldo
  const cuentas = await getSaldoCliente(parseInt(clienteId));

  if (!cuentas.length) {
    return {
      cliente,
      cuentas:      [],
      periodoDesde: desde  ? desde.toISOString()  : null,
      periodoHasta: hasta  ? hasta.toISOString()  : null,
      generadoEn:   new Date().toISOString(),
    };
  }

  // 3. Para cada cuenta: movimientos + deudas en paralelo
  const cuentasDetalle = await Promise.all(
    cuentas.map(async (cuenta) => {
      const [movimientos, deudas] = await Promise.all([
        getMovimientos(cuenta.CueIdCuenta, desde, hasta, top),
        getDeudas(cuenta.CueIdCuenta),
      ]);
      return { ...cuenta, movimientos, deudas };
    })
  );

  // 4. Si soloActivas=true, filtrar cuentas sin movimiento ni deuda (para el email)
  const cuentasFinal = soloActivas
    ? cuentasDetalle.filter(c => Number(c.CueSaldoActual) !== 0 || c.deudas.length > 0)
    : cuentasDetalle;

  return {
    cliente,
    cuentas:      cuentasFinal,
    periodoDesde: desde ? desde.toISOString() : null,
    periodoHasta: hasta ? hasta.toISOString() : null,
    generadoEn:   new Date().toISOString(),
  };
}

module.exports = {
  // Cuentas
  obtenerOCrearCuenta,

  // Libro mayor
  registrarMovimiento,
  getMovimientos,
  getEstadoCuentaCompleto,

  // Pagos
  imputarPago,

  // Deuda
  crearDeudaDocumento,
  buscarDeudaVivaDeDocumento,
  cancelarDeuda,
  reducirDeuda,
  reemplazarDeuda,
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
  getResumenDocumentos,
  getMovimientosOrdenes,
  getTodasLasDeudasVivas,

  // Centralización: escritura segura en MovimientosCuenta
  anularMovimiento,
  anularMovimientosPorFiltro,
  revertirRecursosPorTransaccion,
  transformarMovimiento,
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

