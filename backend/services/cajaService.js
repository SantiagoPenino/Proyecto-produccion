'use strict';
/**
 * cajaService.js
 * ─────────────────────────────────────────────────────────────────────────
 * Servicio central del módulo de Caja y Pagos.
 * Procesa una transacción completa de cobro:
 *   - Agrupa múltiples métodos de pago (multimoneda)
 *   - Aplica ajustes y bonificaciones por línea
 *   - Descuenta recursos prepagados (metros, kg, semanales)
 *   - Actualiza estados de OrdenesRetiro / OrdenesDeposito
 *   - Genera el encabezado en TransaccionesCaja
 *   - Llama a los hooks de contabilidad para el libro mayor
 *
 * REGLA: Todo ocurre dentro de UNA transacción SQL.
 *        Si cualquier paso falla → ROLLBACK completo.
 *        El hook de contabilidad se llama DESPUÉS del COMMIT (no crítico).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * PAYLOAD ESPERADO (procesarTransaccion):
 * {
 *   header: {
 *     clienteId      : number,
 *     tipoDocumento  : 'ETICKET' | 'FACTURA' | 'CREDITO' | 'NOTA_CONSUMO' | 'NINGUNO',
 *     serieDoc?      : string,
 *     numeroDoc?     : string,
 *     observaciones? : string,
 *   },
 *   aplicaciones: [{           // órdenes o ventas incluidas en el cobro
 *     tipo           : 'ORDEN_RETIRO' | 'ORDEN_DEPOSITO' | 'VENTA_NUEVA',
 *     referenciaId?  : number, // OReIdOrdenRetiro u OrdIdOrden (null si VENTA_NUEVA)
 *     codigoRef?     : string, // 'RT-42', 'OD-1001'
 *     descripcion?   : string,
 *     montoOriginal  : number,
 *     ajuste?        : number, // negativo = descuento, positivo = recargo
 *     tipoAjuste?    : 'REDONDEO'|'DESCUENTO'|'BONIFICACION'|'SALDO_CERO'|'RECARGO',
 *   }],
 *   pagos: [{                  // métodos de pago aplicados
 *     metodoPagoId   : number, // MPaIdMetodoPago
 *     moneda?        : string, // 'UYU' | 'USD' (default 'UYU')
 *     monedaId?      : number, // MonIdMoneda
 *     montoOriginal  : number, // en la moneda del pago
 *     cotizacion?    : number, // tipo de cambio (null si UYU)
 *     saldoConsumidoId? : number, // ID del plan de recursos
 *   }],
 *   usuarioId: number,
 * }
 *
 * RESPUESTA:
 * {
 *   success          : true,
 *   tcaIdTransaccion : number,
 *   pagosCreados     : [{ pagIdPago, metodoPagoId, monto, moneda }],
 *   totalNeto        : number,
 *   totalCobrado     : number,
 * }
 */

const { getPool, sql } = require('../config/db');
const logger           = require('../utils/logger');
const contabilidadSvc  = require('./contabilidadService');
const contabilidadCore = require('./contabilidadCore'); // ERP + resolverLineasDesdeMotor
const motorContable    = require('./motorContable');     // Motor de Eventos: fuente de verdad


// ─────────────────────────────────────────────────────────────────────────
// FUNCIÓN VENTAS DIRECTAS (COMPRA DE RECURSOS, FACTURAS A CRÉDITO, ETC)
// ─────────────────────────────────────────────────────────────────────────
async function procesarVentaDirecta(payload) {
  const { header, items, pagos, usuarioId } = payload;
  // Multiempresa: empresa a la que se atribuye la venta (fallback a header/payload; null => DEFAULT en BD)
  const empresaId = payload?.empresaId || header?.empresaId || null;

  if (header?.admin) header.esAdministrativa = true;
  if (!header?.clienteId) throw new Error('clienteId obligatorio');
  if (!items?.length) throw new Error('Debe incluir al menos un ítem');

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  
  // ── Pre-transacción: obtener/crear cuenta monetaria usando la función unificada ──
  // Esto también abre el ciclo automáticamente si el cliente es Semanal y no tiene uno.
  const tDeuda = (header.monedaBase === 'USD' || items[0]?.monedaId === 2) ? 'DINERO_USD' : 'DINERO_UYU';
  const monIdDeuda = tDeuda === 'DINERO_USD' ? 2 : 1;
  logger.info(`[CAJA:VTA] Resolviendo cuenta ${tDeuda} para CliId=${header.clienteId} antes de iniciar transacción`);
  const ctaMonedaId = await contabilidadSvc.obtenerOCrearCuenta(header.clienteId, tDeuda, {
    MonIdMoneda: monIdDeuda,
    UsuarioAlta: usuarioId,
  });
  logger.info(`[CAJA:VTA] Cuenta resuelta: CueId=${ctaMonedaId} (ciclo verificado/abierto si correspondía)`);

  try {
    await transaction.begin();
    
    // 1. Validar Caja Abierta
    let sesionId = null;
    if (!header?.esAdministrativa) {
      const tSesion = new sql.Request(transaction);
      const sRes = await tSesion.query("SELECT TOP 1 StuIdSesion FROM dbo.SesionesTurno WITH (UPDLOCK) WHERE StuEstado = 'ABIERTA'");
      if (sRes.recordset.length === 0) throw new Error('No hay una sesión de caja abierta.');
      sesionId = sRes.recordset[0].StuIdSesion;
    }

    // 2. Cálculos Totales
    const totalBruto = items.reduce((s, i) => s + (parseFloat(i.precioTotal) || 0), 0);
    const totalAjuste = 0;
    const totalNeto = totalBruto;
    
    // Normalizar pagos
    const pagosNorm = (pagos || []).map(p => {
      const isUSD = p.monedaId === 2;
      const cotiz = (isUSD && p.cotizacion) ? parseFloat(p.cotizacion) : 1;
      return {
        ...p,
        moneda: isUSD ? 'USD' : 'UYU',
        monedaId: p.monedaId || 1,
        cotizacion: p.cotizacion || header?.cotizacion || 1,
        montoConvertido: isUSD ? parseFloat((p.montoOriginal * (p.cotizacion || header?.cotizacion || 1)).toFixed(2)) : p.montoOriginal
      };
    });
    const totalCobrado = pagosNorm.reduce((s, p) => s + p.montoConvertido, 0);

    // 3. Crear Header (TransaccionesCaja)
    const tHeader = new sql.Request(transaction);
    tHeader.input('Sesion', sql.Int, sesionId);
    tHeader.input('TcaUsuarioId', sql.Int, usuarioId);
    tHeader.input('Cli', sql.Int, header.clienteId);
    tHeader.input('Fecha', sql.DateTime, new Date());
    tHeader.input('TipoD', sql.VarChar(50), header.tipoDocumento || 'FACTURA');
    tHeader.input('Serie', sql.VarChar(10), header.serieDoc || 'C');
    tHeader.input('Estado', sql.VarChar(50), 'COMPLETADA');
    tHeader.input('Bruto', sql.Decimal(18,2), totalBruto);
    tHeader.input('Ajuste', sql.Decimal(18,2), totalAjuste);
    tHeader.input('Neto', sql.Decimal(18,2), totalNeto);
    tHeader.input('Cobrado', sql.Decimal(18,2), totalCobrado);
    tHeader.input('TcaMonedaBase', sql.VarChar(10), header.moneda || header.monedaBase || 'UYU');
    tHeader.input('Obs', sql.NVarChar(500), header.obs || 'Venta desde mostrador');
    
    // Siguiente num doc
    let numeroDocString = null;
    let serieDocStr = header.serieDoc || 'A'; // Defaults to 'A' for electronic billing
    let docTipoStr = header.tipoDocumento || '01';
    try {
        const seqR = await tHeader.query(`
            UPDATE s
            SET s.SecUltimoNumero = s.SecUltimoNumero + 1
            OUTPUT INSERTED.SecSerie AS Serie, INSERTED.SecUltimoNumero AS UltimoNumero, c.Detalle AS DocTipoStr
            FROM dbo.SecuenciaDocumentos s
            JOIN dbo.Config_TiposDocumento c ON c.SecIdSecuencia = s.SecIdSecuencia
            WHERE c.CodDocumento = @TipoD
        `);
        if (seqR.recordset.length > 0) {
            const r = seqR.recordset[0];
            serieDocStr = r.Serie;
            numeroDocString = String(r.UltimoNumero);
            docTipoStr = String(r.DocTipoStr).trim();
        } else {
            throw new Error(`Secuencia no encontrada para Tipo ${docTipoStr} y Serie ${serieDocStr}`);
        }
    } catch (e) {
        logger.warn(`[CajaService] Fallback de secuencia por: ${e.message}`);
        // Fallback to MAX if missing mapping, though not ideal for concurrency
        const nDocRes = await tHeader.query("SELECT ISNULL(MAX(CAST(TcaNumeroDoc AS INT)), 0) as Ultimo FROM dbo.TransaccionesCaja WITH (UPDLOCK) WHERE TcaTipoDocumento = @TipoD AND ISNUMERIC(TcaNumeroDoc) = 1");
        numeroDocString = String((nDocRes.recordset[0].Ultimo || 0) + 1);
    }

    // Re-bind exact values for insert
    tHeader.parameters.Serie.value = serieDocStr;
    tHeader.input('Num', sql.VarChar(20), numeroDocString);
    tHeader.input('AdminFlag', sql.Bit, header.esAdministrativa ? 1 : 0);

    const rHeader = await tHeader.query(`
      INSERT INTO dbo.TransaccionesCaja (StuIdSesion, TcaUsuarioId, TcaClienteId, TcaFecha, TcaTipoDocumento, TcaSerieDoc, TcaNumeroDoc, TcaEstado, TcaTotalBruto, TcaTotalAjuste, TcaTotalNeto, TcaTotalCobrado, TcaMonedaBase, TcaObservaciones, EsCajaAdmin)
      OUTPUT INSERTED.TcaIdTransaccion
      VALUES (@Sesion, @TcaUsuarioId, @Cli, @Fecha, @TipoD, @Serie, @Num, @Estado, @Bruto, @Ajuste, @Neto, @Cobrado, @TcaMonedaBase, @Obs, @AdminFlag)
    `);
    const tcaId = rHeader.recordset[0].TcaIdTransaccion;

    // 4. Detalle y Lógica de Negocio (PlanesMetros)
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        let referenciaId = null;
        const reqItem = new sql.Request(transaction);
        
        if (item.tipo === 'RECURSO') {
            // Resolvemos el ID interno a partir del código, si no existe usamos 110 por defecto
            const rProd = await reqItem.input('Cod', sql.VarChar, item.codigo.trim()).query(`SELECT ProIdProducto FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = LTRIM(RTRIM(@Cod))`);
            const proId = rProd.recordset.length > 0 ? rProd.recordset[0].ProIdProducto : 110;

            // Normalizar artículos permitidos para esta compra
            const artsPermitidos = Array.isArray(item.articulosPermitidos) && item.articulosPermitidos.length > 0
                ? [...new Set(item.articulosPermitidos)].sort((a, b) => a - b)
                : [proId];

            // Verificar si el cliente TIENE CuentasCliente memo para este artículo
            const rCue = await new sql.Request(transaction).input('Cli', sql.Int, header.clienteId).input('Pro', sql.Int, proId).query(`
               SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli AND ProIdProducto = @Pro AND CueTipo = 'MTS'
            `);
            let cueMemoId = rCue.recordset.length > 0 ? rCue.recordset[0].CueIdCuenta : null;
            
            if (!cueMemoId) {
                // Instanciar cuenta vacía memo
                const rInsertCue = await new sql.Request(transaction).input('Cli', sql.Int, header.clienteId).input('Pro', sql.Int, proId).input('Usr', sql.Int, usuarioId).query(`
                   INSERT INTO dbo.CuentasCliente (CliIdCliente, CueTipo, ProIdProducto, MonIdMoneda, CPaIdCondicion, CueSaldoActual, CueLimiteCredito, CuePuedeNegativo, CueCicloActivo, CueActiva, CueFechaAlta, CueUsuarioAlta)
                   OUTPUT INSERTED.CueIdCuenta
                   VALUES (@Cli, 'MTS', @Pro, NULL, 1, 0, 0, 0, 0, 1, GETDATE(), @Usr)
                `);
                cueMemoId = rInsertCue.recordset[0].CueIdCuenta;
            }

            // ── RECARGA vs PLAN NUEVO ──────────────────────────────────────────────────
            // Buscar plan activo existente para esta cuenta con el MISMO conjunto de artículos permitidos.
            // Si existe → recargar (UPDATE PlaCantidadTotal). Si no → crear plan nuevo (INSERT).
            let planExistenteId = null;
            {
                const rPlanesActivos = await new sql.Request(transaction)
                    .input('Cue', sql.Int, cueMemoId)
                    .input('Cli', sql.Int, header.clienteId)
                    .query(`
                        SELECT pm.PlaIdPlan,
                               (SELECT STRING_AGG(CAST(pap.ProIdProducto AS VARCHAR), ',') 
                                WITHIN GROUP (ORDER BY pap.ProIdProducto)
                                FROM dbo.PlanesMetrosArticulosPermitidos pap
                                WHERE pap.PlaIdPlan = pm.PlaIdPlan) AS ArtsPermitidos
                        FROM dbo.PlanesMetros pm WITH(UPDLOCK, ROWLOCK)
                        WHERE pm.CueIdCuenta  = @Cue
                          AND pm.CliIdCliente = @Cli
                          AND pm.PlaActivo    = 1
                    `);

                // Firma esperada: IDs ordenados separados por coma (ej: "247,255")
                const firmaCompra = artsPermitidos.join(',');

                for (const row of rPlanesActivos.recordset) {
                    const firmaExistente = (row.ArtsPermitidos || '').split(',').map(Number).sort((a,b)=>a-b).join(',');
                    if (firmaExistente === firmaCompra) {
                        planExistenteId = row.PlaIdPlan;
                        break;
                    }
                }
            }

            if (planExistenteId) {
                // ── RECARGA: sumar metros al plan existente ──────────────────────────
                logger.info(`[CAJA:VTA] Recargando plan existente PlaId=${planExistenteId} con ${item.cantidad} metros para CliId=${header.clienteId}`);
                await new sql.Request(transaction)
                    .input('PlaId', sql.Int, planExistenteId)
                    .input('Cant',  sql.Decimal(18,4), item.cantidad)
                    .query(`UPDATE dbo.PlanesMetros SET PlaCantidadTotal = PlaCantidadTotal + @Cant WHERE PlaIdPlan = @PlaId`);
                referenciaId = planExistenteId;
                item.codigo = `PLAN_MTS_${proId}`;
            } else {
                // ── PLAN NUEVO: mismo flujo que antes ───────────────────────────────
                logger.info(`[CAJA:VTA] Creando plan nuevo para CliId=${header.clienteId} artsPermitidos=${artsPermitidos.join(',')}`);
                const reqPlan = new sql.Request(transaction);
                const rPlan = await reqPlan
                    .input('Cue',  sql.Int, cueMemoId)
                    .input('Cli',  sql.Int, header.clienteId)
                    .input('Pro',  sql.Int, proId)
                    .input('Cant', sql.Decimal(18,4), item.cantidad)
                    .input('Usr',  sql.Int, usuarioId)
                    .query(`
                        INSERT INTO dbo.PlanesMetros
                          (CliIdCliente, CueIdCuenta, ProIdProducto,
                           PlaCantidadTotal, PlaCantidadUsada,
                           PlaPrecioUnitario, MonIdMoneda,
                           PlaFechaInicio, PlaFechaVencimiento,
                           PlaDescripcion, PlaObservaciones,
                           PlaActivo, PlaFechaAlta, PlaUsuarioAlta)
                        OUTPUT INSERTED.PlaIdPlan
                        VALUES
                          (@Cli, @Cue, @Pro,
                           @Cant, 0,
                           NULL, NULL,
                           CAST(GETDATE() AS DATE), NULL,
                           'Plan desde Venta Directa Caja', NULL,
                           1, GETDATE(), @Usr)
                    `);
                referenciaId = rPlan.recordset[0].PlaIdPlan;
                item.codigo = `PLAN_MTS_${proId}`;

                // Registrar los artículos permitidos
                for (const artPermId of artsPermitidos) {
                    await new sql.Request(transaction)
                        .input('PlaId', sql.Int, referenciaId)
                        .input('ProId', sql.Int, artPermId)
                        .query(`INSERT INTO dbo.PlanesMetrosArticulosPermitidos (PlaIdPlan, ProIdProducto) VALUES (@PlaId, @ProId)`);
                }
            }

            // ── Movimiento de ENTRADA (siempre, recarga o plan nuevo) ─────────────
            // Queda en el estado de cuenta como trazabilidad de cada compra.
            const evtRecurso = await motorContable.getEvento('ENTRADA').catch(() => null);
            const movTipoEntrada = evtRecurso?.EvtCodigo || 'ENTRADA';
            const conceptoEntrada = planExistenteId
                ? `Recarga plan #${referenciaId} (+${item.cantidad} metros)`
                : `Saldo inicial plan #${referenciaId}`;

            await new sql.Request(transaction)
              .input('Cue', sql.Int, cueMemoId)
              .input('Cant', sql.Decimal(18,4), item.cantidad)
              .input('Usr', sql.Int, usuarioId)
              .input('Concep', sql.NVarChar(500), conceptoEntrada)
              .input('MovTipo', sql.VarChar(30), movTipoEntrada)
              .query(`
                UPDATE dbo.CuentasCliente
                SET CueSaldoActual = ISNULL(CueSaldoActual, 0) + @Cant
                WHERE CueIdCuenta = @Cue;

                INSERT INTO dbo.MovimientosCuenta
                  (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
                   MovFecha, MovUsuarioAlta, MovAnulado)
                VALUES
                  (@Cue, @MovTipo, @Concep, @Cant,
                   (SELECT ISNULL(CueSaldoActual, 0) FROM dbo.CuentasCliente WHERE CueIdCuenta = @Cue),
                   GETDATE(), @Usr, 0);
              `);

        } else if (item.tipo === 'FACT_CREDITO') {
            item.codigo = 'FACT_CRED';
        }

        let safeRefId1 = parseInt(String(referenciaId).replace(/\D/g, ''), 10);
        if (isNaN(safeRefId1)) safeRefId1 = null;

        // Insertar Tde
        await new sql.Request(transaction)
          .input('Tca', sql.Int, tcaId)
          .input('TipoR', sql.VarChar(50), item.tipo)
          .input('RefId', sql.Int, safeRefId1)
          .input('CodR', sql.VarChar(100), item.codigo)
          .input('Orig', sql.Decimal(18,2), item.precioTotal)
          .input('Final', sql.Decimal(18,2), item.precioTotal)
          .query(`
            INSERT INTO dbo.TransaccionDetalle (TcaIdTransaccion, TdeTipoReferencia, TdeReferenciaId, TdeCodigoReferencia, TdeImporteOriginal, TdeAjuste, TdeImporteFinal, TdePagado)
            VALUES (@Tca, @TipoR, @RefId, @CodR, @Orig, 0, @Final, 1)
          `);
    }

    // 5. Pagos ingresados
    // El PagTipoMovimiento viene del Motor (evento PAGO o INGRESO_CAJA)
    const evtPago = await motorContable.getEvento('VTA_CAJA').catch(() => null);
    const movTipoPago = evtPago?.EvtCodigo || 'INGRESO';
    for (const pg of pagosNorm) {
        if (pg.montoConvertido <= 0) continue;
        await new sql.Request(transaction)
          .input('TcaId', sql.Int, tcaId)
          .input('Metodo', sql.Int, pg.metodoPagoId)
          .input('RefNum', sql.VarChar(100), pg.referenciaNumero || '')
          .input('Monto', sql.Decimal(18,2), pg.montoOriginal)
          .input('Cotiz', sql.Decimal(18,4), pg.cotizacion)
          .input('Conv', sql.Decimal(18,2), pg.montoConvertido)
          .input('Moneda', sql.Int, pg.monedaId)
          .input('Usr', sql.Int, usuarioId)
          .input('TipoMov', sql.VarChar(30), movTipoPago)
          .query(`
             INSERT INTO dbo.Pagos (PagTcaIdTransaccion, MPaIdMetodoPago, PagMontoPago, PagCotizacion, PagMontoConvertido, PagIdMonedaPago, PagTipoMovimiento, PagFechaPago, PagUsuarioAlta)
             VALUES (@TcaId, @Metodo, @Monto, @Cotiz, @Conv, @Moneda, @TipoMov, GETDATE(), @Usr)
          `);
    }

    // 6. Submayor: Deuda documentada de la venta
    // tDeuda y ctaMonedaId ya fueron resueltos antes de la transacción via obtenerOCrearCuenta()
    
    // El cobrado convertido a la moneda de la deuda
    const totalAbonadoDeuda = pagosNorm.reduce((sum, p) => {
        if (tDeuda === 'DINERO_USD') return sum + (p.monedaId === 2 ? p.montoOriginal : (p.cotizacion ? p.montoOriginal / p.cotizacion : p.montoOriginal));
        return sum + (p.monedaId === 1 ? p.montoOriginal : p.montoOriginal * (p.cotizacion || 1));
    }, 0);

    // Build dynamic concept from items
    const detallesVenta = items.map(it => `${it.cantidad || 1}x ${it.descripcion || it.codigo || 'Recurso'}`).join(', ');
    const conceptoVenta = `Venta: ${detallesVenta}`.substring(0, 200);
    const conceptoPago  = `Pago: ${detallesVenta}`.substring(0, 200);

    // Obtener tipo de mov para submayor desde Motor (evento VTA_CAJA o ORDEN)
    const evtVenta  = await motorContable.getEvento('VTA_CAJA').catch(() => null);
    const movVenta  = evtVenta?.EvtCodigo || 'CARGO';

    // Desglose de IVA para CFE
    const desgloseCFE = contabilidadCore.desglosarIVA(totalBruto, 22);

    const lineasDocumento = items.map(item => {
      const pTotal = parseFloat(item.precioTotal) || 0;
      const cant   = parseFloat(item.cantidad)   || 1;
      const pUnit  = cant > 0 ? pTotal / cant : pTotal;
      return {
        nomItem: (item.descripcion || item.codigo || 'Servicio').substring(0, 200),
        cantidad: cant,
        precioUnitario: pUnit,
        subtotal: pTotal / 1.22,
        impuestos: pTotal - (pTotal / 1.22),
        total: pTotal
      };
    });

    const cfeEstadoVal = (docTipoStr.toLowerCase().includes('pedido') || docTipoStr === 'PC' || docTipoStr === 'PedidoCaja') ? 'BORRADOR' : 'PENDIENTE';
    const dId = await contabilidadCore.crearDocumentoContable({
      header: {
        cueIdCuenta: ctaMonedaId,
        clienteId: header.clienteId,
        monedaId: tDeuda === 'DINERO_USD' ? 2 : 1,
        tipo: docTipoStr,
        numero: numeroDocString,
        serie: serieDocStr,
        subtotal: desgloseCFE.neto,
        impuestos: desgloseCFE.ivaMonto,
        total: totalBruto,
        estado: totalAbonadoDeuda >= totalBruto ? 'PAGADO' : (totalAbonadoDeuda > 0 ? 'PARCIAL' : 'PENDIENTE'),
        cfeEstado: cfeEstadoVal,
        usuarioId: usuarioId,
        tcaIdTransaccion: tcaId,
        docPagado: totalAbonadoDeuda >= totalBruto,
        empresaId: empresaId
      },
      lineas: lineasDocumento
    }, transaction);

    // Leer el saldo previo para saber si hay Saldo a Favor que consuma la deuda automáticamente
    const prevSaldoRes = await new sql.Request(transaction)
      .input('Cue', sql.Int, ctaMonedaId)
      .query('SELECT ISNULL(CueSaldoActual, 0) as Saldo FROM dbo.CuentasCliente WITH(UPDLOCK) WHERE CueIdCuenta = @Cue');
    const saldoAFavor = Math.max(0, prevSaldoRes.recordset[0].Saldo);

    // --- NUEVO: Registrar también en DeudaDocumento para Visibilidad de Deuda Viva ---
    // Consultar el Motor Contable para ver si el evento configurado genera deuda
    const evtConfig = await motorContable.getEvento(header.tipoDocumento || 'VTA_CAJA');
    const generaDeuda = !!header.esCredito || (evtConfig ? !!evtConfig.EvtGeneraDeuda : true);
    const afectaSaldo = evtConfig ? (evtConfig.EvtAfectaSaldo || 0) : -1;

    // Registrar DeudaDocumento centralizado
    // crearDeudaDocumento ya maneja: cálculo de días de vencimiento,
    // detección de saldo a favor, y auto-consumo via SP_ImputarPagoPEPS
    const importePendiente = Math.max(0, totalBruto - totalAbonadoDeuda);
    if (importePendiente > 0.01 && generaDeuda) {
      await contabilidadSvc.crearDeudaDocumento({
        CueIdCuenta:    ctaMonedaId,
        DocIdDocumento: dId,
        Importe:        totalBruto,
        ImportePendiente: importePendiente,
      }, transaction);
    }

    const cicloActivoObj = await contabilidadSvc.obtenerCicloActivo(ctaMonedaId);
    const cicId = cicloActivoObj ? cicloActivoObj.CicIdCiclo : null;
    logger.info(`[CAJA:VTA] CicIdCiclo para movimiento VTA_CAJA: ${cicId !== null ? cicId : 'NULL (sin ciclo — movimiento quedará FUERA del ciclo)'}. CliId=${header.clienteId} CueId=${ctaMonedaId}`);

    if (afectaSaldo !== 0) {
        // Por convención, una Venta afecta el saldo negativamente (ej. EvtAfectaSaldo = -1)
        // El importeMov aplicará el signo configurado en el motor
        const importeCargo = totalBruto * afectaSaldo; 
        
        const rUpdCta1 = await new sql.Request(transaction).input('C', sql.Int, ctaMonedaId).input('Dif', sql.Decimal(18,4), importeCargo).query(`
            UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Dif OUTPUT INSERTED.CueSaldoActual WHERE CueIdCuenta = @C`);
        const saldoP1 = rUpdCta1.recordset[0].CueSaldoActual;

        await new sql.Request(transaction)
            .input('Cue', sql.Int, ctaMonedaId).input('Imp', sql.Decimal(18,4), importeCargo)
            .input('Sal', sql.Decimal(18,4), saldoP1).input('Usr', sql.Int, usuarioId)
            .input('R', sql.Int, dId).input('MT', sql.VarChar(30), 'VTA_CAJA')
            .input('ConceptoVenta', sql.VarChar(200), conceptoVenta)
            .input('CicId', sql.Int, cicId)
            .query(`INSERT INTO dbo.MovimientosCuenta (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, DocIdDocumento, MovUsuarioAlta, MovFecha, CicIdCiclo, MovAnulado)
                    VALUES (@Cue, @MT, @ConceptoVenta, @Imp, @Sal, @R, @Usr, GETDATE(), @CicId, 0)`);
    }

    if (totalAbonadoDeuda > 0) {
        const rUpdCta2 = await new sql.Request(transaction).input('C', sql.Int, ctaMonedaId).input('Dif', sql.Decimal(18,4), totalAbonadoDeuda).query(`
            UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Dif OUTPUT INSERTED.CueSaldoActual WHERE CueIdCuenta = @C`);
        const saldoP2 = rUpdCta2.recordset[0].CueSaldoActual;
            await new sql.Request(transaction)
                .input('Cue', sql.Int, ctaMonedaId).input('Imp', sql.Decimal(18,4), totalAbonadoDeuda)
                .input('Sal', sql.Decimal(18,4), saldoP2).input('Usr', sql.Int, usuarioId).input('Doc', sql.Int, dId)
                .input('ConceptoPago', sql.VarChar(200), conceptoPago)
                .input('CicId', sql.Int, cicId)
                .query(`INSERT INTO dbo.MovimientosCuenta (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior, DocIdDocumento, MovUsuarioAlta, MovFecha, CicIdCiclo, MovAnulado)
                        VALUES (@Cue, 'PAGO', @ConceptoPago, @Imp, @Sal, @Doc, @Usr, GETDATE(), @CicId, 0)`);
    }

    // 7. Asiento Libro Mayor desde Motor (VTA_CAJA)
    try {
      const isUSD = header.monedaBase === 'USD';
      const monId  = isUSD ? 2 : 1;
      const cotizRef = pagosNorm.find(p => p.cotizacion > 1)?.cotizacion || 1;
      const desglosado = contabilidadCore.desglosarIVA(totalBruto, 22);

      // Intentar desde Motor evento configurado en UI (ej: '07' o 'VTA_CAJA')
      const evtCodigoConfigurado = header.tipoDocumento || 'VTA_CAJA';
      const ctxVenta = {
        moneda: isUSD ? 'USD' : 'UYU', cotizacion: cotizRef,
        clienteId: header.clienteId,
        totalNeto: totalBruto, totalBruto,
        neto: desglosado.neto, iva: desglosado.ivaMonto, descuento: 0,
      };
      let lineasContables = await contabilidadCore.resolverLineasDesdeMotor(evtCodigoConfigurado, ctxVenta);

      if (lineasContables.length < 2) {
        // Fallback manual si Motor no tiene reglas
        logger.warn(`[CAJA-MOTOR] Sin reglas para ${evtCodigoConfigurado} → fallback hardcodeado Venta Directa`);
        const cuentaCli = isUSD ? contabilidadCore.CUENTAS.CLIENTE_USD : contabilidadCore.CUENTAS.CLIENTE_UYU;
        lineasContables = [
          { codigoCuenta: cuentaCli, debeBase: totalBruto, haberBase: 0, monedaId: monId, cotizacion: cotizRef, entidadId: header.clienteId, entidadTipo: 'CLIENTE' },
        ];
        if (desglosado.neto > 0) lineasContables.push({ codigoCuenta: contabilidadCore.CUENTAS.VENTA_PROD, debeBase: 0, haberBase: desglosado.neto, monedaId: monId, cotizacion: cotizRef });
        if (desglosado.ivaMonto > 0) lineasContables.push({ codigoCuenta: contabilidadCore.CUENTAS.IVA_22, debeBase: 0, haberBase: desglosado.ivaMonto, monedaId: monId, cotizacion: cotizRef });
        for (const pago of pagosNorm) {
          const isPagoUSD = pago.moneda === 'USD';
          lineasContables.push({ codigoCuenta: isPagoUSD ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU, debeBase: pago.montoOriginal, haberBase: 0, monedaId: pago.monedaId, cotizacion: pago.cotizacion, entidadId: header.clienteId, entidadTipo: 'CLIENTE' });
        }
        if (totalAbonadoDeuda > 0) lineasContables.push({ codigoCuenta: cuentaCli, debeBase: 0, haberBase: totalAbonadoDeuda, monedaId: monId, cotizacion: cotizRef, entidadId: header.clienteId, entidadTipo: 'CLIENTE' });
      }

      await contabilidadCore.generarAsientoCompleto({
        concepto: conceptoVenta, usuarioId,
        tcaIdTransaccion: tcaId, origen: 'CAJA',
        lineas: lineasContables
      }, transaction);
    } catch (e) {
      logger.error('Error generando asiento contable (Venta Directa):', e.message);
      throw e;
    }

    await transaction.commit();
    logger.info(`[CAJA] VENTA DIRECTA procesada TcaId=${tcaId} Monto=${totalBruto} Cobrado=${totalCobrado}`);
    // NOTA: El submayor (MovimientosCuenta CARGO+PAGO) ya fue registrado dentro de la transacción.
    // Marcamos skipHookPago=true para que _lanzarHooksContables NO duplique el movimiento PAGO.
    if (!header._movimientosPagoRegistrados) header._movimientosPagoRegistrados = true;
    return {
      success: true,
      tcaIdTransaccion: tcaId,
      totalBruto,
      totalCobrado,
      numeroDoc: numeroDocString,
      tipoDocumento: docTipoStr,
      serieDoc: serieDocStr,
      numeroDocFormato: `${serieDocStr}-${numeroDocString.padStart(6,'0')}`,
      docIdDocumento: dId || null
    };

  } catch (err) {
    try { if (transaction) await transaction.rollback(); } catch (e) { logger.warn('Rollback error:', e.message); }
    throw err;
  }
}


async function getProductosVenta() {
  const pool = await getPool();
  const res = await pool.request().query(`
      SELECT p.ProIdProducto as ProIdProducto,
             LTRIM(RTRIM(p.CodArticulo)) as CodArticulo, 
             LTRIM(RTRIM(p.Descripcion)) as Descripcion, 
             ISNULL(c.NombreReferencia, 
                CASE WHEN LTRIM(RTRIM(p.CodStock)) = '2.2.1.1' THEN 'Insumos' 
                     WHEN LTRIM(RTRIM(p.CodStock)) = '2.2.1.2' THEN 'Productos en el local' 
                     ELSE 'Otros' END
             ) as GrupoNombre,
             LTRIM(RTRIM(p.CodStock)) as CodStock,
             ISNULL(pl.Precio, pb.Precio) as PrecioBase,
             -- La moneda autoritativa de PreciosBase es MonIdMoneda (2=USD, 1=UYU).
             -- La columna de texto pb.Moneda puede quedar desactualizada al editar precios,
             -- por eso se deriva desde MonIdMoneda. Para lista pública se usa pl.Moneda (texto).
             ISNULL(
                pl.Moneda,
                CASE WHEN pb.MonIdMoneda = 2 THEN 'USD'
                     WHEN pb.MonIdMoneda = 1 THEN 'UYU'
                     ELSE pb.Moneda END
             ) as MonedaBase
      FROM dbo.Articulos p WITH(NOLOCK)
      LEFT JOIN dbo.ConfigMapeoERP c WITH(NOLOCK) ON LTRIM(RTRIM(p.Grupo)) = LTRIM(RTRIM(c.CodigoERP)) COLLATE Database_Default
      LEFT JOIN dbo.PreciosListaPublica pl WITH(NOLOCK) ON p.ProIdProducto = pl.ProIdProducto AND (pl.Activo = 1 OR p.CodStock IN ('2.2.1.1', '2.2.1.2'))
      LEFT JOIN dbo.PreciosBase pb WITH(NOLOCK) ON p.ProIdProducto = pb.ProIdProducto
      WHERE p.Mostrar = 1 AND (p.IDProdReact IS NOT NULL OR p.Grupo = '2.1')
      ORDER BY GrupoNombre, p.Descripcion
  `);
  return res.recordset;
}

// ─────────────────────────────────────────────────────────────────────────
// FUNCIÓN PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────

/**
 * procesarTransaccion
 * Orquesta el cobro completo dentro de una única transacción SQL.
 */
async function procesarTransaccion(payload) {
  const { header, aplicaciones, pagos, usuarioId } = payload;
  // Multiempresa: empresa a la que se atribuye el cobro (fallback a header/payload; null => DEFAULT en BD)
  const empresaId = payload?.empresaId || header?.empresaId || null;

  // ── Validaciones básicas ──────────────────────────────────────────────
  if (header?.admin) header.esAdministrativa = true;
  if (!header?.clienteId)        throw new Error('clienteId es obligatorio.');
  if (!header?.tipoDocumento)    throw new Error('tipoDocumento es obligatorio.');
  if (!aplicaciones?.length)     throw new Error('Debe incluir al menos una orden o ítem.');

  // ── Calcular totales ──────────────────────────────────────────────────
  const totalBruto  = aplicaciones.reduce((s, a) => s + (a.montoOriginal || 0), 0);
  const totalAjuste = aplicaciones.reduce((s, a) => s + (a.ajuste || 0), 0);
  const totalNeto   = totalBruto + totalAjuste;

  // Normalizar montos convertidos (cotización × monto original)
  const pagosNorm = pagos.map(p => {
    const monedaStr = p.moneda || 'UYU';
    const esUSD = monedaStr === 'USD';
    return {
      ...p,
      moneda:          monedaStr,
      monedaId:        esUSD ? 2 : 1,
      cotizacion:      p.cotizacion || null,
      montoConvertido: p.cotizacion
        ? parseFloat((p.montoOriginal * p.cotizacion).toFixed(2))
        : p.montoOriginal,
    };
  });

  const totalCobrado = pagosNorm.reduce((s, p) => s + p.montoConvertido, 0);

  // ── Ajuste de COBRO (independiente del valor de las órdenes/factura) ──
  // El cajero puede fijar un "importe a cobrar" distinto del total real (redondeo/pago cerrado).
  // La factura se emite por el valor real (totalNeto); la diferencia se contabiliza como
  // Descuento (5.2.03) o Recargo (4.2.2), sin tocar las órdenes ni la factura.
  //   ajusteCobro < 0  → se cobró de menos → Descuento concedido
  //   ajusteCobro > 0  → se cobró de más   → Recargo / recupero
  const ajusteCobro = (header.importeACobrar != null && !isNaN(parseFloat(header.importeACobrar)))
    ? parseFloat((parseFloat(header.importeACobrar) - totalNeto).toFixed(2))
    : 0;
  const CTA_DESCUENTO_AJUSTE = '5.2.03'; // Descuentos y Bonificaciones Concedidos (PERDIDA)
  const CTA_RECARGO_AJUSTE   = '4.2.2';  // Recargos y Recuperos (GANANCIA)

  // ── Inicio de transacción SQL ─────────────────────────────────────────
  const pool        = await getPool();
  
  // Obtener Sesión Activa
  let stuIdSesion = null;
  if (!header?.admin) {
    const sesRes = await pool.request().query("SELECT TOP 1 StuIdSesion FROM dbo.SesionesTurno WITH(NOLOCK) WHERE StuEstado = 'ABIERTA'");
    if (sesRes.recordset.length > 0) stuIdSesion = sesRes.recordset[0].StuIdSesion;
  }

  const transaction = pool.transaction();
  await transaction.begin();

  let tcaIdTransaccion = null;
  const pagosCreados   = [];

  try {

    // ── PASO 0: Generar correlativo si no viene el número ────────────────
    if (header.tipoDocumento && header.tipoDocumento !== 'NINGUNO' && !header.numeroDoc) {
      try {
        const seqR = await new sql.Request(transaction)
          .input('CodDoc', sql.VarChar(20), header.tipoDocumento)
          .query(`
            UPDATE s
            SET s.SecUltimoNumero = s.SecUltimoNumero + 1
            OUTPUT INSERTED.SecSerie AS Serie, INSERTED.SecUltimoNumero AS UltimoNumero, INSERTED.SecPrefijo AS Prefijo, INSERTED.SecDigitos AS Digitos
            FROM dbo.SecuenciaDocumentos s
            JOIN dbo.Config_TiposDocumento c ON c.SecIdSecuencia = s.SecIdSecuencia
            WHERE c.CodDocumento = @CodDoc
          `);
        if (seqR.recordset.length > 0) {
          const r = seqR.recordset[0];
          header.serieDoc  = r.Serie;
          header.numeroDoc = String(r.UltimoNumero).padStart(r.Digitos || 6, '0');
        }
      } catch (eSeq) {
        logger.warn(`[CAJA] No se pudo generar secuencia para ${header.tipoDocumento}:`, eSeq.message);
      }
    }

    // ── PASO 1: Crear encabezado en TransaccionesCaja ──────────────────
    const tcaRes = await new sql.Request(transaction)
      .input('StuIdSesion',      sql.Int,           stuIdSesion)
      .input('TcaUsuarioId',     sql.Int,           usuarioId)
      .input('TcaClienteId',     sql.Int,           header.clienteId)
      .input('TcaTipoDocumento', sql.VarChar(20),   header.tipoDocumento)
      .input('TcaSerieDoc',      sql.VarChar(5),    header.serieDoc    || null)
      .input('TcaNumeroDoc',     sql.VarChar(20),   header.numeroDoc   || null)
      .input('TcaTotalBruto',    sql.Decimal(18,2), totalBruto)
      .input('TcaTotalAjuste',   sql.Decimal(18,2), totalAjuste)
      .input('TcaTotalNeto',     sql.Decimal(18,2), totalNeto)
      .input('TcaTotalCobrado',  sql.Decimal(18,2), totalCobrado)
      .input('TcaMonedaBase',    sql.VarChar(10),   header.moneda || header.monedaBase || 'UYU')
      .input('TcaObservaciones', sql.NVarChar(500), header.observaciones || null)
      .input('AdminFlag', sql.Bit, (header.admin || header.esAdministrativa) ? 1 : 0)
      .query(`
        INSERT INTO dbo.TransaccionesCaja
          (StuIdSesion, TcaFecha, TcaUsuarioId, TcaClienteId, TcaTipoDocumento,
           TcaSerieDoc, TcaNumeroDoc,
           TcaTotalBruto, TcaTotalAjuste, TcaTotalNeto, TcaTotalCobrado,
           TcaMonedaBase, TcaEstado, TcaObservaciones, EsCajaAdmin)
        OUTPUT INSERTED.TcaIdTransaccion
        VALUES
          (@StuIdSesion, GETDATE(), @TcaUsuarioId, @TcaClienteId, @TcaTipoDocumento,
           @TcaSerieDoc, @TcaNumeroDoc,
           @TcaTotalBruto, @TcaTotalAjuste, @TcaTotalNeto, @TcaTotalCobrado,
           @TcaMonedaBase, 'COMPLETADO', @TcaObservaciones, @AdminFlag)
      `);

    tcaIdTransaccion = tcaRes.recordset[0].TcaIdTransaccion;
    logger.info(`[CAJA] TransaccionCaja creada: TcaId=${tcaIdTransaccion}`);


    // ── PASO 2: Insertar detalle (una fila por orden/ítem) ─────────────
    for (const ap of aplicaciones) {
      const importeFinal = (ap.montoOriginal || 0) + (ap.ajuste || 0);

      let safeRefId2 = parseInt(String(ap.referenciaId).replace(/\D/g, ''), 10);
      if (isNaN(safeRefId2)) safeRefId2 = null;

      await new sql.Request(transaction)
        .input('TcaId',       sql.Int,           tcaIdTransaccion)
        .input('Tipo',        sql.VarChar(20),   ap.tipo)
        .input('RefId',       sql.Int,           safeRefId2)
        .input('CodRef',      sql.VarChar(30),   ap.codigoRef      || null)
        .input('Desc',        sql.NVarChar(200), ap.descripcion    || null)
        .input('Original',    sql.Decimal(18,2), ap.montoOriginal  || 0)
        .input('Ajuste',      sql.Decimal(18,2), ap.ajuste         || 0)
        .input('Final',       sql.Decimal(18,2), importeFinal)
        .input('TipoAjuste',  sql.VarChar(20),   ap.tipoAjuste     || null)
        .query(`
          INSERT INTO dbo.TransaccionDetalle
            (TcaIdTransaccion, TdeTipoReferencia, TdeReferenciaId, TdeCodigoReferencia,
             TdeDescripcion, TdeImporteOriginal, TdeAjuste, TdeImporteFinal, TdeTipoAjuste, TdePagado)
          VALUES
            (@TcaId, @Tipo, @RefId, @CodRef,
             @Desc, @Original, @Ajuste, @Final, @TipoAjuste, 1)
        `);
    }


    // ── PASO 3: Insertar un registro en Pagos por cada método ──────────
    let primerPagIdPago = null;   // se linkea como FK principal en OrdenesRetiro

    for (const pago of pagosNorm) {
      const pagoRes = await new sql.Request(transaction)
        .input('MetodoId',       sql.Int,           pago.metodoPagoId)
        .input('MonedaId',       sql.Int,           pago.monedaId)
        .input('Monto',          sql.Decimal(18,4), pago.montoOriginal)
        .input('UsuarioId',      sql.Int,           usuarioId)
        .input('TcaId',          sql.Int,           tcaIdTransaccion)
        .input('Cotizacion',     sql.Decimal(18,4), pago.cotizacion)
        .input('Convertido',     sql.Decimal(18,4), pago.montoConvertido)
        .input('TipoMovimiento', sql.VarChar(20),   _tipoMovimientoPago(pago.metodoPagoId, pagosNorm))
        .input('SaldoConsId',    sql.Int,           pago.saldoConsumidoId || null)
        .query(`
          INSERT INTO dbo.Pagos
            (MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago, PagUsuarioAlta,
             PagTcaIdTransaccion, PagCotizacion, PagMontoConvertido, PagTipoMovimiento, PagSaldoConsumidoId)
          OUTPUT INSERTED.PagIdPago
          VALUES
            (@MetodoId, @MonedaId, @Monto, GETDATE(), @UsuarioId,
             @TcaId, @Cotizacion, @Convertido, @TipoMovimiento, @SaldoConsId)
        `);

      const pagIdPago = pagoRes.recordset[0].PagIdPago;

      if (!primerPagIdPago) primerPagIdPago = pagIdPago;  // primer pago real = FK principal

      pagosCreados.push({
        pagIdPago,
        metodoPagoId:    pago.metodoPagoId,
        monto:           pago.montoOriginal,
        montoConvertido: pago.montoConvertido,
        moneda:          pago.moneda,
      });

      logger.info(`[CAJA] Pago insertado: PagId=${pagIdPago} Metodo=${pago.metodoPagoId} Monto=${pago.montoOriginal} ${pago.moneda}`);
    }


    // ── PASO 3.5: Cruce Exacto de DeudaDocumento ────────────────────────
    // Replicamos la lógica precisa de pagoService.registrarPagoCompleto:
    //  1º Buscar deudas PENDIENTE/PARCIAL filtrando por los OrdIdOrden exactos
    //  2º Fallback PEPS por CueIdCuenta si no hubo match exacto (órdenes muy viejas)
    // Esto reemplaza la dependencia al SP_ImputarPagoPEPS ciego que usaba caja antes.
    {
      // Recolectar TODOS los OrdIdOrden involucrados en este pago:
      // - Las que vienen explícitas como ORDEN_DEPOSITO
      // - Las hijas de cada ORDEN_RETIRO (via ap.orderNumbers o descubriéndolas en BD)
      const allOrdIdsParaDeuda = [];

      for (const ap of aplicaciones) {
        if (ap.tipo === 'ORDEN_DEPOSITO' && ap.referenciaId) {
          const refId = parseInt(String(ap.referenciaId).replace(/\D/g, ''), 10);
          if (!isNaN(refId)) allOrdIdsParaDeuda.push(refId);
        }
        if (ap.tipo === 'ORDEN_RETIRO' && ap.referenciaId) {
          const refId = parseInt(String(ap.referenciaId).replace(/\D/g, ''), 10);
          if (!isNaN(refId)) {
            if (ap.orderNumbers && ap.orderNumbers.length > 0) {
              // El Frontend ya resolvió los hijos
              ap.orderNumbers.forEach(id => allOrdIdsParaDeuda.push(id));
            } else {
              // Auto-descubrimiento: buscar hijos en BD
              const hijasRes = await new sql.Request(transaction)
                .input('RID', sql.Int, refId)
                .query('SELECT OrdIdOrden FROM dbo.OrdenesDeposito WHERE OReIdOrdenRetiro = @RID');
              const hijasIds = hijasRes.recordset.map(x => x.OrdIdOrden);
              // Guardar en ap.orderNumbers para que PASO 4 los use al actualizar estados
              ap.orderNumbers = hijasIds;
              hijasIds.forEach(id => allOrdIdsParaDeuda.push(id));
            }
          }
        }
      }

      const isOrdenUSD_deuda = (header.moneda === 'USD');
      const cueTipoDeuda     = isOrdenUSD_deuda ? 'DINERO_USD' : 'DINERO_UYU';
      let pagoRestanteDeuda  = totalNeto;
      let totalImputadoDeuda = 0;

      // 1º – Cruce exacto por OrdIdOrden
      if (allOrdIdsParaDeuda.length > 0) {
        const inListDeuda = allOrdIdsParaDeuda.join(',');
        const ddRes = await new sql.Request(transaction).query(`
          SELECT dd.DDeIdDocumento, dd.DDeImportePendiente, dd.DDeEstado, dd.CueIdCuenta
          FROM   dbo.DeudaDocumento dd WITH (UPDLOCK, ROWLOCK)
          WHERE  dd.OrdIdOrden IN (${inListDeuda})
            AND  dd.DDeEstado IN ('PENDIENTE','PARCIAL')
          ORDER  BY dd.DDeFechaEmision ASC
        `);

        for (const dd of ddRes.recordset) {
          if (pagoRestanteDeuda <= 0) break;
          const pendiente      = Number(dd.DDeImportePendiente);
          const aplicar        = Math.min(pagoRestanteDeuda, pendiente);
          const nuevoPendiente = Math.max(0, pendiente - aplicar);
          const nuevoEstado    = nuevoPendiente < 0.01 ? 'COBRADO' : 'PARCIAL';
          pagoRestanteDeuda   -= aplicar;
          totalImputadoDeuda  += aplicar;

          await new sql.Request(transaction)
            .input('ID',     sql.Int,           dd.DDeIdDocumento)
            .input('pend',   sql.Decimal(18,4),  nuevoPendiente)
            .input('estado', sql.VarChar(20),    nuevoEstado)
            .query(`
              UPDATE dbo.DeudaDocumento
              SET    DDeImportePendiente = @pend,
                     DDeEstado           = @estado,
                     DDeFechaCobro       = CASE WHEN @estado = 'COBRADO' THEN GETDATE() ELSE DDeFechaCobro END
              WHERE  DDeIdDocumento = @ID
            `);

          logger.info(`[CAJA-DEUDA] DeudaDoc #${dd.DDeIdDocumento}: aplicado=${aplicar.toFixed(2)} nuevo_estado=${nuevoEstado}`);
        }
      }

      // 2º – Fallback PEPS: aplicar el saldo restante (si queda) contra las deudas del cliente
      //    por CueIdCuenta (orden cronológico – PEPS).
      //    Esto cubre:
      //      a) Órdenes sin OrdIdOrden registrado en DeudaDocumento (datos históricos)
      //      b) El remanente cuando el match exacto cubrió solo PARTE del pago
      if (pagoRestanteDeuda > 0.01 && header.clienteId) {
        const cueFallback = await new sql.Request(transaction)
          .input('Cli', sql.Int,         header.clienteId)
          .input('T',   sql.VarChar(20), cueTipoDeuda)
          .query('SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente=@Cli AND CueTipo=@T AND CueActiva=1');

        if (cueFallback.recordset.length) {
          const cueIdFb = cueFallback.recordset[0].CueIdCuenta;
          logger.info(`[CAJA-DEUDA] Fallback PEPS: buscando deudas por CueIdCuenta=${cueIdFb} (OrdIdOrden no matcheó)`);

          const ddFb = await new sql.Request(transaction)
            .input('CueId', sql.Int, cueIdFb)
            .query(`
              SELECT dd.DDeIdDocumento, dd.DDeImportePendiente, dd.DDeEstado, dd.CueIdCuenta
              FROM   dbo.DeudaDocumento dd WITH (UPDLOCK, ROWLOCK)
              WHERE  dd.CueIdCuenta = @CueId
                AND  dd.DDeEstado IN ('PENDIENTE','PARCIAL')
              ORDER  BY dd.DDeFechaEmision ASC
            `);

          for (const dd of ddFb.recordset) {
            if (pagoRestanteDeuda <= 0) break;
            const pendiente      = Number(dd.DDeImportePendiente);
            const aplicar        = Math.min(pagoRestanteDeuda, pendiente);
            const nuevoPendiente = Math.max(0, pendiente - aplicar);
            const nuevoEstado    = nuevoPendiente < 0.01 ? 'COBRADO' : 'PARCIAL';
            pagoRestanteDeuda   -= aplicar;
            totalImputadoDeuda  += aplicar;

            await new sql.Request(transaction)
              .input('ID',     sql.Int,           dd.DDeIdDocumento)
              .input('pend',   sql.Decimal(18,4),  nuevoPendiente)
              .input('estado', sql.VarChar(20),    nuevoEstado)
              .query(`
                UPDATE dbo.DeudaDocumento
                SET    DDeImportePendiente = @pend,
                       DDeEstado           = @estado,
                       DDeFechaCobro       = CASE WHEN @estado = 'COBRADO' THEN GETDATE() ELSE DDeFechaCobro END
                WHERE  DDeIdDocumento = @ID
              `);

            logger.info(`[CAJA-DEUDA] Fallback CueId DeudaDoc #${dd.DDeIdDocumento}: aplicado=${aplicar.toFixed(2)} estado=${nuevoEstado}`);
          }
        }
      }

      // Propagamos si imputamos algo, para que _lanzarHooksContables no duplique el débito
      header._imputadoDeuda = totalImputadoDeuda;
    }


    // ── PASO 4: Actualizar órdenes (estado + FKs) ──────────────────────
    const ordenesRetiro  = aplicaciones.filter(a => a.tipo === 'ORDEN_RETIRO'   && a.referenciaId);
    const ordenesDeposito = aplicaciones.filter(a => a.tipo === 'ORDEN_DEPOSITO' && a.referenciaId);

    // OrdenesRetiro → determinar nuevo estado según estado actual
    for (const ap of ordenesRetiro) {
      const refStr = String(ap.referenciaId || '').trim();
      const realRefId = parseInt(refStr.replace(/\D/g, ''), 10);
      const isVirtual = isNaN(realRefId) || refStr.toUpperCase().startsWith('RL');

      // 1. Marcar siempre como pagas las OrdenesDeposito hijas
      //    ap.orderNumbers ya fue poblado en PASO 3.5 si estaba vacío (auto-descubrimiento)
      if (ap.orderNumbers && ap.orderNumbers.length > 0) {
          const reqOd = new sql.Request(transaction).input('PagId', sql.Int, primerPagIdPago).input('TcaId', sql.Int, tcaIdTransaccion);
          ap.orderNumbers.forEach((id, i) => reqOd.input(`id${i}`, sql.Int, id));
          const inClauseOd = ap.orderNumbers.map((_, i) => `@id${i}`).join(',');

          await reqOd.query(`
            UPDATE dbo.OrdenesDeposito
            SET PagIdPago        = @PagId,
                OrdEstadoActual  = 7,
                OrdFechaEstadoActual = GETDATE()
            WHERE OrdIdOrden IN (${inClauseOd});
          `);

          const histReqOd = new sql.Request(transaction).input('UsuarioId', sql.Int, usuarioId);
          ap.orderNumbers.forEach((id, i) => histReqOd.input(`id${i}`, sql.Int, id));
          const histValsOd = ap.orderNumbers.map((_, i) => `(@id${i}, 7, GETDATE(), @UsuarioId)`).join(',');

          await histReqOd.query(`
            INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            VALUES ${histValsOd};
          `);
      }

      if (isVirtual) {
          // Si es un retiro virtual (ej: 'RL-2'), no existe tabla OrdenesRetiro. Continuamos al siguiente.
          continue;
      }

      const estadoRes = await new sql.Request(transaction)
        .input('Id', sql.Int, realRefId)
        .query(`SELECT OReEstadoActual FROM dbo.OrdenesRetiro WITH(UPDLOCK) WHERE OReIdOrdenRetiro = @Id`);

      if (estadoRes.recordset.length === 0) {
        throw new Error(`OrdenRetiro ${realRefId} no encontrada.`);
      }

      const estadoActual   = estadoRes.recordset[0].OReEstadoActual;
      // Estado 1(Pendiente)→3(Abonado)  | Estado 5(Listo)→8(Listo y abonado) | otros→sin cambio de estado
      const nuevoEstado = estadoActual === 1 ? 3 : estadoActual;

      await new sql.Request(transaction)
        .input('PagId',    sql.Int, primerPagIdPago)
        .input('TcaId',    sql.Int, tcaIdTransaccion)
        .input('Estado',   sql.Int, nuevoEstado)
        .input('UsuarioId',sql.Int, usuarioId)
        .input('Id',       sql.Int, realRefId)
        .query(`
          UPDATE dbo.OrdenesRetiro
          SET PagIdPago            = @PagId,
              OReEstadoActual      = @Estado,
              OReFechaEstadoActual = GETDATE(),
              ORePasarPorCaja      = 0
          WHERE OReIdOrdenRetiro = @Id;

          INSERT INTO dbo.HistoricoEstadosOrdenesRetiro
            (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          VALUES (@Id, @Estado, GETDATE(), @UsuarioId);
        `);

      // Actualizar OcupacionEstantes si aplica
      await new sql.Request(transaction)
        .input('Id', sql.Int, realRefId)
        .query(`
          UPDATE dbo.OcupacionEstantes SET Pagado = 1
          WHERE OrdenRetiro IN (
            SELECT COALESCE(FormaRetiro,'R') + '-' + CAST(OReIdOrdenRetiro AS VARCHAR)
            FROM dbo.OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @Id
          )
        `);
    }

    // OrdenesDeposito → estado 7 = Pagada
    if (ordenesDeposito.length > 0) {
      const ids = ordenesDeposito.map(a => a.referenciaId);
      const req = new sql.Request(transaction).input('PagId', sql.Int, primerPagIdPago).input('TcaId', sql.Int, tcaIdTransaccion);
      ids.forEach((id, i) => req.input(`id${i}`, sql.Int, id));
      const inClause = ids.map((_, i) => `@id${i}`).join(',');

      await req.query(`
        UPDATE dbo.OrdenesDeposito
        SET PagIdPago        = @PagId,
            OrdEstadoActual  = 7,
            OrdFechaEstadoActual = GETDATE()
        WHERE OrdIdOrden IN (${inClause});
      `);

      const histReq = new sql.Request(transaction).input('UsuarioId', sql.Int, usuarioId);
      ids.forEach((id, i) => histReq.input(`id${i}`, sql.Int, id));
      const histVals = ids.map((_, i) => `(@id${i}, 7, GETDATE(), @UsuarioId)`).join(',');

      await histReq.query(`
        INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
        VALUES ${histVals};
      `);
    }


    // ── PASO 5: AUTO-CIERRE de retiro si todas sus órdenes están pagas ─
    for (const ap of ordenesRetiro) {
      const realRefId = parseInt(String(ap.referenciaId).replace(/\D/g, ''), 10);
      if (isNaN(realRefId) || String(ap.referenciaId).trim().toUpperCase().startsWith('RL')) continue; // Los retiros virtuales no se cierran porque no existen en tabla

      const checkRes = await new sql.Request(transaction)
        .input('Id', sql.Int, realRefId)
        .query(`
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN od.PagIdPago IS NOT NULL THEN 1 ELSE 0 END) AS pagas
          FROM dbo.OrdenesDeposito od WITH(NOLOCK)
          WHERE od.OReIdOrdenRetiro = @Id
            AND od.OrdEstadoActual NOT IN (6, 9)
        `);

      const { total, pagas } = checkRes.recordset[0];

      if (total > 0 && total === pagas) {
        await new sql.Request(transaction)
          .input('PagId',  sql.Int, primerPagIdPago)
          .input('TcaId',  sql.Int, tcaIdTransaccion)
          .input('Usr',    sql.Int, usuarioId)
          .input('Id',     sql.Int, realRefId)
          .query(`
            UPDATE dbo.OrdenesRetiro
            SET PagIdPago            = @PagId,
                OReEstadoActual      = CASE WHEN OReEstadoActual = 5 THEN 5 ELSE 4 END,
                OReFechaEstadoActual = GETDATE(),
                ORePasarPorCaja      = 0
            WHERE OReIdOrdenRetiro = @Id
              AND (PagIdPago IS NULL OR PagIdPago = 0);

            INSERT INTO dbo.HistoricoEstadosOrdenesRetiro
              (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            VALUES (@Id, 4, GETDATE(), @Usr);
          `);

        logger.info(`[CAJA] Auto-cierre: OrdenRetiro ${realRefId} marcada como Abonada.`);
      }
    }


    // ── PASO 5.5: MOTOR CONTABLE ERP (Partida Doble Automática) ────────
    // Lee las reglas de asiento del evento 'PAGO' en Cont_ReglasAsiento.
    // Si el Motor tiene reglas configuradas → las usa. Si no → fallback hardcodeado.
    try {
      const isOrdenUSD = header.moneda === 'USD';
      const cotizRef   = pagosNorm.find(p => p.cotizacion > 1)?.cotizacion
                      || (header.cotizacion && header.cotizacion > 1 ? header.cotizacion : null)
                      || 1;
      const monedaId   = isOrdenUSD ? 2 : 1;

      // ─ Intentar construir asiento desde el Motor ─────────────────────
      // El evento 'PAGO' debe tener reglas: META_CAJA (DEBE) y META_CLIENTE (HABER)
      const totalNetoMoneda = totalNeto;
      const totalBrutoMoneda = totalBruto;
      const desglose = contabilidadCore.desglosarIVA(totalNetoMoneda, 0); // sin IVA por defecto en cobros

      // Construir contexto para resolverLineasDesdeMotor
      const ctxMotor = {
        moneda:     isOrdenUSD ? 'USD' : 'UYU',
        cotizacion: cotizRef,
        clienteId:  header.clienteId,
        totalNeto:  totalNetoMoneda,
        totalBruto: totalBrutoMoneda,
        neto:       desglose.neto,
        iva:        desglose.ivaMonto,
        descuento:  Math.abs(totalAjuste),
      };

      // Para pagos multimoneda, resolvemos UNA línea por pago real
      let lineasContables = [];

      // Intentar con el Motor para el evento PAGO
      // (WMS Checkout ya registró los ingresos en Check-In, por lo que aquí solo va el asiento de caja)
      const evtCodigoConfigurado = 'PAGO';
      const lineasMotor = await contabilidadCore.resolverLineasDesdeMotor(evtCodigoConfigurado, ctxMotor);

      if (lineasMotor.length >= 2) {
        // Motor tiene reglas → combinar con los pagos reales por moneda
        // En cobros multimoneda, REEMPLAZAMOS las líneas META_CAJA con los pagos reales
        const lineasConMeta = lineasMotor.filter(l => l._esMeta !== true);

        // Crédito de deuda del cliente (siempre en 1 línea)
        const lineaCliente = lineasMotor.find(l => l.haberBase > 0);
        if (lineaCliente) lineasContables.push({ ...lineaCliente, haberBase: totalNeto });

        // Débito por cada pago recibido (multimoneda)
        for (const pago of pagosNorm) {
          const isUSD = pago.moneda === 'USD';
          const cuentaCaja = isUSD ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU;
          // Buscar si el Motor definió una cuenta explícita para CAJA
          const lineaCaja = lineasMotor.find(l => l.debeBase > 0);
          let codigoCajaReal = lineaCaja?.codigoCuenta || cuentaCaja;
          
          // Si el motor resolvió a una caja por defecto, sobreescribimos con la caja específica de la moneda del pago
          if (codigoCajaReal === contabilidadCore.CUENTAS.CAJA_UYU || codigoCajaReal === contabilidadCore.CUENTAS.CAJA_USD) {
             codigoCajaReal = cuentaCaja;
          }

          lineasContables.push({
            codigoCuenta: codigoCajaReal,
            debeBase:     pago.montoOriginal,
            haberBase:    0,
            monedaId:     pago.monedaId,
            cotizacion:   pago.cotizacion || 1,
            entidadId:    header.clienteId,
            entidadTipo:  'CLIENTE',
          });
        }
        logger.info(`[CAJA-MOTOR] Asiento PAGO desde Motor. Reglas usadas: ${lineasMotor.length}`);
      } else {
        // Sin reglas en Motor → fallback hardcodeado (legacy)
        logger.warn(`[CAJA-MOTOR] Evento ${evtCodigoConfigurado} sin reglas configuradas → fallback cuentas hardcodeadas`);
        for (const pago of pagosNorm) {
          const isUSD = pago.moneda === 'USD';
          lineasContables.push({
            codigoCuenta: isUSD ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU,
            debeBase:  pago.montoOriginal,
            haberBase: 0,
            monedaId:  pago.monedaId,
            cotizacion: pago.cotizacion,
            entidadId:  header.clienteId,
            entidadTipo: 'CLIENTE',
          });
        }
        lineasContables.push({
          codigoCuenta: isOrdenUSD ? contabilidadCore.CUENTAS.CLIENTE_USD : contabilidadCore.CUENTAS.CLIENTE_UYU,
          debeBase:  0,
          haberBase: totalNeto,
          monedaId,
          cotizacion: cotizRef,
          entidadId:  header.clienteId,
          entidadTipo: 'CLIENTE',
        });
      }

      // ── Línea de AJUSTE MONETARIO ──────────────────────────────────────
      // Calcula el desbalance REAL del asiento (en UYU, base contable), que engloba:
      //   • el "importe a cobrar" fijado por el cajero (redondeo / pago cerrado), y
      //   • el redondeo por conversión de moneda (ej: pagar en UYU una venta en USD).
      // Así el asiento SIEMPRE cuadra y la diferencia queda tipificada:
      //   desbalance > 0 (Debe excede → se cobró de más)  → Recargo  (HABER 4.2.2)
      //   desbalance < 0 (Haber excede → se cobró de menos) → Descuento (DEBE 5.2.03)
      const _aUYU = (l) => {
        const isUSD = l.monedaId === 2;
        const cot = (isUSD && l.cotizacion) ? parseFloat(l.cotizacion) : 1;
        return {
          d: (parseFloat(l.debeBase)  || 0) * cot,
          h: (parseFloat(l.haberBase) || 0) * cot,
        };
      };
      let _sumD = 0, _sumH = 0;
      for (const l of lineasContables) { const { d, h } = _aUYU(l); _sumD += d; _sumH += h; }
      const desbalanceUYU = parseFloat((_sumD - _sumH).toFixed(2));

      if (Math.abs(desbalanceUYU) > 0.005) {
        if (desbalanceUYU > 0) {
          lineasContables.push({ codigoCuenta: CTA_RECARGO_AJUSTE,   debeBase: 0, haberBase: desbalanceUYU,      monedaId: 1, cotizacion: 1 });
        } else {
          lineasContables.push({ codigoCuenta: CTA_DESCUENTO_AJUSTE, debeBase: Math.abs(desbalanceUYU), haberBase: 0, monedaId: 1, cotizacion: 1 });
        }
        logger.info(`[CAJA-AJUSTE] Ajuste monetario: ${desbalanceUYU > 0 ? 'Recargo' : 'Descuento'} $${Math.abs(desbalanceUYU).toFixed(2)} UYU → cuenta ${desbalanceUYU > 0 ? CTA_RECARGO_AJUSTE : CTA_DESCUENTO_AJUSTE}`);
      }

      const strDoc = (header.tipoDocumento && header.tipoDocumento !== 'NINGUNO')
        ? `${header.tipoDocumento} ${header.serieDoc || ''}-${header.numeroDoc || ''}`.trim() : 'Recibo Interno';

      const strRef = aplicaciones.map(a => a.codigoRef || a.referenciaId).filter(Boolean).join(', ') || tcaIdTransaccion;
      const conceptoAsiento = `Cobro s/ ${strRef} - ${strDoc}`;

      const asiId = await contabilidadCore.generarAsientoCompleto({
        concepto: conceptoAsiento,
        usuarioId,
        tcaIdTransaccion,
        origen: 'CAJA_COBROS',
        lineas: lineasContables
      }, transaction);

      logger.info(`[CAJA-ERP] Asiento Contable generado para TcaId=${tcaIdTransaccion}`);

      // ── PASO 5.6: GENERACIÓN CFE (FACTURACIÓN ELECTRÓNICA) ─────────────
      if (header.tipoDocumento && header.tipoDocumento !== 'NINGUNO') {
        const resConfig = await new sql.Request(transaction)
          .input('codDoc', sql.VarChar(10), header.tipoDocumento)
          .query(`
            SELECT c.EvtCodigo, c.Detalle, c.AfectaCtaCte, c.Codigo_Efact,
                   30 AS DiasVencimiento,
                   s.SecSerie, s.SecUltimoNumero, s.SecIdSecuencia 
            FROM dbo.Config_TiposDocumento c WITH(NOLOCK)
            LEFT JOIN dbo.SecuenciaDocumentos s WITH(UPDLOCK) ON c.SecIdSecuencia = s.SecIdSecuencia
            WHERE c.CodDocumento = @codDoc
          `);

        if (resConfig.recordset.length > 0) {
          const config = resConfig.recordset[0];
          
          if (config.SecIdSecuencia) {
             let numeroCFE;
             let serieCFE;
             if (header.numeroDoc) {
               numeroCFE = parseInt(header.numeroDoc, 10);
               serieCFE = header.serieDoc || config.SecSerie || 'A';
             } else {
               const resSeq = await new sql.Request(transaction)
                 .input('secId', sql.Int, config.SecIdSecuencia)
                 .query(`
                   UPDATE dbo.SecuenciaDocumentos 
                   SET SecUltimoNumero = SecUltimoNumero + 1 
                   OUTPUT INSERTED.SecUltimoNumero 
                   WHERE SecIdSecuencia = @secId
                 `);
               numeroCFE = resSeq.recordset[0].SecUltimoNumero;
               serieCFE = config.SecSerie || 'A';
               header.numeroDoc = String(numeroCFE);
               header.serieDoc = serieCFE;
             }
             
             const desgloseCFE   = contabilidadCore.desglosarIVA(totalNetoMoneda, 22);
             const tipoDocVal    = (header.tipoDocumento === 'PC' ? 'PedidoCaja' : (config.Detalle || header.tipoDocumento));
             const cfeEstadoVal  = (tipoDocVal.toLowerCase().includes('pedido') || tipoDocVal === 'PC' || tipoDocVal === 'PedidoCaja')
               ? 'BORRADOR'
               : ((config.Codigo_Efact === null || config.Codigo_Efact === 0) ? null : 'PENDIENTE');

             // Resolver líneas de detalle según tipo de documento
             const esPedidoCaja = header.tipoDocumento === 'PC' || (config.Detalle || '').toLowerCase().includes('pedido caja');

             let lineasDocCFE = [];
             if (!esPedidoCaja) {
               // Documentos de producción: resolver órdenes asociadas a la transacción.
               // Fallback legacy: si la OrdenRetiro no tiene RelOrdenesRetiroOrdenes,
               // busca los materiales directamente en OrdenesDeposito via OReIdOrdenRetiro.
               lineasDocCFE = await contabilidadCore.resolverLineasDetalle(
                 { tcaIdTransaccion, monedaFactura: monedaId === 1 ? 'UYU' : 'USD' },
                 transaction
               );
             }

             const docIdDocumento = await contabilidadCore.crearDocumentoContable({
               header: {
                 cueIdCuenta: isOrdenUSD ? 119 : 118,
                 clienteId: header.clienteId || 1,
                 monedaId: monedaId,
                 tipo: tipoDocVal,
                 numero: String(numeroCFE),
                 serie: serieCFE,
                 subtotal: desgloseCFE.neto,
                 impuestos: desgloseCFE.ivaMonto,
                 total: totalNetoMoneda,
                 estado: 1,
                 cfeEstado: cfeEstadoVal,
                 usuarioId: usuarioId || 1,
                 tcaIdTransaccion: tcaIdTransaccion || null,
                 asiIdAsiento: asiId || null,
                 docPagado: (totalCobrado - ajusteCobro) >= totalNeto - 0.01,
                 empresaId: empresaId
               },
               lineas: lineasDocCFE
             }, transaction);

             header.docIdDocumento = docIdDocumento;

             // ── RECIBO de caja automatico (correlativo RC-) DESACTIVADO ──
             // Se desactiva porque generaba duplicados en el Estado de Cuentas,
             // y los E-Tickets/Facturas ya funcionan como comprobante de pago directo.
             /*
             if (docIdDocumento && totalCobrado > 0) {
               try {
                 const recSeq = await new sql.Request(transaction)
                   .query(\`UPDATE dbo.SecuenciaDocumentos SET SecUltimoNumero = SecUltimoNumero + 1
                           OUTPUT INSERTED.SecUltimoNumero
                           WHERE SecTipoDoc = 'RECIBO' AND SecSerie = 'RC'\`);
                 const numRecibo = recSeq.recordset[0]?.SecUltimoNumero;
                 if (numRecibo) {
                   const cueCajaCode = isOrdenUSD ? '1.1.2' : '1.1.1';
                   const cueCajaRes  = await new sql.Request(transaction)
                     .input('Cod', sql.VarChar(20), cueCajaCode)
                     .query('SELECT CueId FROM dbo.Cont_PlanCuentas WHERE CueCodigo = @Cod');
                   const cueCajaId = cueCajaRes.recordset[0]?.CueId || (isOrdenUSD ? 119 : 118);
                   const reciboId = await contabilidadCore.crearDocumentoContable({
                     header: {
                       cueIdCuenta:       cueCajaId,
                       clienteId:         header.clienteId || 1,
                       monedaId:          monedaId,
                       tipo:              'RECIBO',
                       numero:            String(numRecibo),
                       serie:             'RC',
                       subtotal:          totalCobrado,
                       impuestos:         0,
                       total:             totalCobrado,
                       estado:            'COBRADO',
                       cfeEstado:         null,
                       usuarioId:         usuarioId || 1,
                       tcaIdTransaccion:  tcaIdTransaccion || null,
                       observaciones:     ('Recibo de cobro - ' + tipoDocVal + ' ' + serieCFE + '-' + String(numeroCFE)).substring(0, 200),
                       docPagado:         true,
                       docIdDocumentoRef: docIdDocumento
                     },
                     lineas: [{
                       nomItem:        'Cobro en efectivo',
                       dscItem:        ('Corresponde a: ' + tipoDocVal + ' ' + serieCFE + '-' + String(numeroCFE)).substring(0, 500),
                       cantidad:       1,
                       precioUnitario: totalCobrado,
                       subtotal:       totalCobrado,
                       impuestos:      0,
                       total:          totalCobrado
                     }]
                   }, transaction);
                   logger.info(\`[CAJA-CFE] Recibo RC-\${String(numRecibo).padStart(6,'0')} (ID=\${reciboId}) generado para Doc #\${docIdDocumento}\`);
                 }
               } catch (eRecibo) {
                 logger.warn(\`[CAJA-CFE] Recibo no generado (no critico): \${eRecibo.message}\`);
               }
             }
             */
             // ──────────────────────────────────────────────────────────────


             // Para PedidoCaja: insertar los items desde TransaccionDetalle (son servicios libres, no órdenes)
             if (esPedidoCaja) {
               await new sql.Request(transaction)
                 .input('docId', sql.Int, docIdDocumento)
                 .input('tcaId', sql.Int, tcaIdTransaccion)
                 .query(`
                   INSERT INTO dbo.DocumentosContablesDetalle 
                     (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal)
                   SELECT 
                       @docId,
                       LEFT(ISNULL(td.TdeDescripcion, 'Servicio'), 200),
                       td.TdeDescripcion,
                       ISNULL(td.TdeCantidad, 1),
                       ROUND(td.TdeImporteFinal / NULLIF(ISNULL(td.TdeCantidad, 1), 0), 4),
                       ROUND(td.TdeImporteFinal / 1.22, 2),
                       ROUND(td.TdeImporteFinal - td.TdeImporteFinal / 1.22, 2),
                       td.TdeImporteFinal
                   FROM dbo.TransaccionDetalle td
                   WHERE td.TcaIdTransaccion = @tcaId
                 `);
             }


             // --- Link ORDEN movements to the new CFE ---
             const allOdIds = [];
             const allOrIds = [];
             for (const a of ordenesDeposito) {
               const id = parseInt(String(a.referenciaId).replace(/\D/g, ''), 10);
               if (!isNaN(id)) allOdIds.push(id);
             }
             for (const ap of ordenesRetiro) {
               const id = parseInt(String(ap.referenciaId).replace(/\D/g, ''), 10);
               if (!isNaN(id)) allOrIds.push(id);
               if (ap.orderNumbers && Array.isArray(ap.orderNumbers)) {
                 for (const subId of ap.orderNumbers) {
                   const numSubId = parseInt(subId, 10);
                   if (!isNaN(numSubId)) allOdIds.push(numSubId);
                 }
               }
             }

                           if (allOdIds.length > 0) {
                try {
                  const mapRes = await new sql.Request(transaction)
                    .query(`
                      SELECT e.OrdenID
                      FROM dbo.Ordenes e
                      JOIN dbo.OrdenesDeposito od ON e.CodigoOrden = od.OrdCodigoOrden
                      WHERE od.OrdIdOrden IN (${allOdIds.join(',')})
                    `);
                  const erpIds = mapRes.recordset.map(r => r.OrdenID);
                  for (const erpId of erpIds) {
                    if (!allOdIds.includes(erpId)) {
                      allOdIds.push(erpId);
                    }
                  }
                } catch (errMap) {
                  logger.warn(`[CAJA-CFE] Error mapping IDs: ${errMap.message}`);
                }
              }

              if (allOdIds.length > 0 || allOrIds.length > 0) {
                const updateMcReq = new sql.Request(transaction).input('docId', sql.Int, docIdDocumento);
                let updateMcQuery = `
                  UPDATE dbo.MovimientosCuenta
                  SET DocIdDocumento = @docId
                  WHERE MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
                    AND DocIdDocumento IS NULL
                `;
                const mcConditions = [];
                if (allOdIds.length > 0) {
                  allOdIds.forEach((id, idx) => updateMcReq.input(`odId_${idx}`, sql.Int, id));
                  mcConditions.push(`OrdIdOrden IN (${allOdIds.map((_, idx) => `@odId_${idx}`).join(',')})`);
                }
                if (allOrIds.length > 0) {
                  allOrIds.forEach((id, idx) => updateMcReq.input(`orId_${idx}`, sql.Int, id));
                  mcConditions.push(`OReIdOrdenRetiro IN (${allOrIds.map((_, idx) => `@orId_${idx}`).join(',')})`);
                }
                updateMcQuery += ` AND (${mcConditions.join(' OR ')})`;
                await updateMcReq.query(updateMcQuery);
                logger.info(`[CAJA-CFE] Linked ORDEN/ORDEN_ANTICIPO movements to DocIdDocumento=${docIdDocumento}`);
              }

             // ── DeudaDocumento: consultamos al Motor Contable ────
             const evtConfig = await motorContable.getEvento(header.tipoDocumento || 'F_ORDEN');
             // header.esCredito = true cuando el operador eligió modo Crédito explícitamente
             // (ej. PEDIDO CAJA CRÉDITO), aunque el tipo de documento no tenga AfectaCtaCte.
             const generaDeuda = !!header.esCredito || (evtConfig ? !!evtConfig.EvtGeneraDeuda : !!config.AfectaCtaCte);

             let totalCobradoMoneda = isOrdenUSD ? (totalCobrado / cotizRef) : totalCobrado;
             let importePendienteMoneda = parseFloat((totalNeto - totalCobradoMoneda).toFixed(2));
             
             header._creoDeuda = false;
             if (importePendienteMoneda > 0.01 && generaDeuda) {
               header._creoDeuda = true;
               const cuentaDeudaRes = await new sql.Request(transaction)
                 .input('cli', sql.Int, header.clienteId)
                 .query(`
                   SELECT TOP 1 CueIdCuenta, ISNULL(CueSaldoActual, 0) as Saldo
                   FROM dbo.CuentasCliente WITH(UPDLOCK)
                   WHERE CliIdCliente = @cli 
                     AND CueTipo IN ('DINERO_UYU', 'DINERO_USD') 
                     AND CueActiva = 1 
                   ORDER BY CASE CueTipo WHEN 'DINERO_UYU' THEN 1 ELSE 2 END
                 `);
               if (cuentaDeudaRes.recordset.length > 0) {
                 const cueDeudaId = cuentaDeudaRes.recordset[0].CueIdCuenta;
                 const saldoAFavor = Math.max(0, cuentaDeudaRes.recordset[0].Saldo);
                 
                 // Nace en el importe real pendiente
                 const diasVenc = config.DiasVencimiento || 30;
                  const insertRes = await new sql.Request(transaction)
                    .input('cue',  sql.Int,          cueDeudaId)
                    .input('doc',  sql.Int,          docIdDocumento)
                    .input('orig', sql.Decimal(18,4), totalNeto)
                    .input('pend', sql.Decimal(18,4), importePendienteMoneda)
                    .input('dias', sql.Int,          diasVenc)
                    .input('ord',  sql.Int,          allOdIds.length === 1 ? allOdIds[0] : null)
                    .query(`
                      INSERT INTO dbo.DeudaDocumento
                        (CueIdCuenta, DocIdDocumento, OrdIdOrden, DDeImporteOriginal, DDeImportePendiente,
                         DDeFechaEmision, DDeFechaVencimiento, DDeEstado)
                      OUTPUT INSERTED.DDeIdDocumento
                      VALUES
                        (@cue, @doc, @ord, @orig, @pend,
                         GETDATE(), DATEADD(DAY, @dias, GETDATE()), 'PENDIENTE')
                    `);
                 logger.info(`[CAJA-CFE] DeudaDocumento creada: Cli=${header.clienteId} Monto=${importePendienteMoneda} TipoDoc=${header.tipoDocumento} Venc=${diasVenc}d`);

                 const newDDeId = insertRes.recordset[0].DDeIdDocumento;

                 // Auto-consumir saldo a favor existente EXPLÍCITAMENTE
                 if (saldoAFavor > 0) {
                     const montoAAplicar = Math.min(saldoAFavor, importePendienteMoneda);
                     
                     // Pago sintético de aplicación
                     const pagRes = await new sql.Request(transaction)
                           .input('Metodo', sql.Int, 1)
                           .input('Moneda', sql.Int, isOrdenUSD ? 2 : 1)
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

                         await new sql.Request(transaction)
                           .input('PagIdPago',       sql.Int,          pagId)
                           .input('MontoDisponible', sql.Decimal(18,4), montoAAplicar)
                           .input('CueIdCuenta',     sql.Int,          cueDeudaId)
                           .input('UsuarioAlta',     sql.Int,          usuarioId)
                           .output('MontoExcedente', sql.Decimal(18,4))
                           .execute('dbo.SP_ImputarPagoPEPS');
                     }
                     


               } else {
                 logger.warn(`[CAJA-CFE] Sin cuenta DINERO para CliId=${header.clienteId} — DeudaDocumento no creada`);
               }
             }
              
              logger.info(`[CAJA-CFE] CFE Creado (Pendiente DGI): ${serieCFE}-${numeroCFE} para TcaId=${tcaIdTransaccion}`);
           }
         }
       }

    } catch (errContabilidad) {
      logger.error(`[CAJA-ERP] ❌ Error Contable, abortando cobro: ${errContabilidad.message}`);
      throw errContabilidad;
    }

    // ── COMMIT ────────────────────────────────────────────────────────
    await transaction.commit();
    logger.info(`[CAJA] ✅ Transaccion ${tcaIdTransaccion} completada. Pagos: ${pagosCreados.length}`);


    // ── PASO 6: HOOKS CONTABLES (post-commit, no críticos) ─────────────
    _lanzarHooksContables({ aplicaciones, pagosNorm, pagosCreados, header, usuarioId, totalNeto }).catch(err =>
      logger.warn(`[CAJA] Hook contable falló (no afecta el pago): ${err.message}`)
    );


    // ── Resultado ───────────────────────────────────────────────────────
    return {
      success:          true,
      tcaIdTransaccion,
      pagosCreados,
      totalBruto,
      totalAjuste,
      totalNeto,
      totalCobrado,
      docIdDocumento:   header.docIdDocumento || null,
      numeroDoc:        header.numeroDoc || null,
      serieDoc:         header.serieDoc || null,
    };

  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    logger.error(`[CAJA] ❌ Error procesarTransaccion: ${err.message}`, err);
    throw err;
  }
}


// ─────────────────────────────────────────────────────────────────────────
// ANULACIÓN DE TRANSACCIÓN
// ─────────────────────────────────────────────────────────────────────────

/**
 * anularTransaccion
 * Marca la transacción como ANULADA y revierte el estado de las órdenes.
 * No borra registros — solo actualiza estados para mantener auditoría.
 */
async function anularTransaccion({ tcaIdTransaccion, usuarioId, motivo }) {
  if (!tcaIdTransaccion) throw new Error('tcaIdTransaccion es obligatorio.');

  const pool = await getPool();
  const transaction = pool.transaction();
  await transaction.begin();

  try {
    // Verificar que existe y no está ya anulada
    const tcaRes = await new sql.Request(transaction)
      .input('TcaId', sql.Int, tcaIdTransaccion)
      .query(`SELECT TcaEstado FROM dbo.TransaccionesCaja WITH(UPDLOCK) WHERE TcaIdTransaccion = @TcaId`);

    if (!tcaRes.recordset.length)          throw new Error(`Transacción ${tcaIdTransaccion} no encontrada.`);
    if (tcaRes.recordset[0].TcaEstado === 'ANULADO') throw new Error('La transacción ya está anulada.');

    // Verificar que la transacción no esté asociada a un documento fiscal ya firmado
    const docsRes = await new sql.Request(transaction)
      .input('TcaId', sql.Int, tcaIdTransaccion)
      .query(`
          SELECT dc.CfeEstado 
          FROM DocumentosContables dc WITH(NOLOCK)
          WHERE dc.DocNumero = CAST(@TcaId AS VARCHAR(50))
            AND dc.CfeEstado = 'ACEPTADO_DGI'
      `);
      
    if (docsRes.recordset.length > 0) {
        throw new Error('No se puede anular la transacción. Existe un documento fiscal asociado que ya fue emitido y aceptado por DGI. Se requiere emitir Nota de Crédito.');
    }

    // Marcar TransaccionesCaja como ANULADO
    await new sql.Request(transaction)
      .input('TcaId',   sql.Int,           tcaIdTransaccion)
      .input('UsuarioId',sql.Int,          usuarioId)
      .input('Motivo',  sql.NVarChar(500), motivo || null)
      .query(`
        UPDATE dbo.TransaccionesCaja
        SET TcaEstado         = 'ANULADO',
            TcaFechaAnulacion = GETDATE(),
            TcaUsuarioAnula   = @UsuarioId,
            TcaObservaciones  = ISNULL(TcaObservaciones, '') + ' | ANULADO: ' + ISNULL(@Motivo,'')
        WHERE TcaIdTransaccion = @TcaId
      `);

    // Revertir los Pagos relacionados (marcar TipoMovimiento = 'ANULADO')
    await new sql.Request(transaction)
      .input('TcaId', sql.Int, tcaIdTransaccion)
      .query(`
        UPDATE dbo.Pagos
        SET PagTipoMovimiento = 'ANULADO'
        WHERE PagTcaIdTransaccion = @TcaId
      `);

    // Revertir OrdenesRetiro (quitar PagIdPago, volver a estado anterior)
    await new sql.Request(transaction)
      .input('TcaId',    sql.Int, tcaIdTransaccion)
      .input('UsuarioId',sql.Int, usuarioId)
      .query(`
        -- 1. Insertar en el histórico de estados
        INSERT INTO dbo.HistoricoEstadosOrdenesRetiro
          (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
        SELECT OReIdOrdenRetiro, 
          CASE
            WHEN OReEstadoActual IN (3,4) THEN 1   -- Abonado → Pendiente
            WHEN OReEstadoActual = 8      THEN 5    -- Empaquetado y abonado → Entregado
            ELSE OReEstadoActual
          END, GETDATE(), @UsuarioId
        FROM dbo.OrdenesRetiro WITH(NOLOCK)
        WHERE PagIdPago IN (
            SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @TcaId
        );

        -- 2. Desvincular pagos y revertir estados
        UPDATE dbo.OrdenesRetiro
        SET PagIdPago        = NULL,
            OReEstadoActual  = CASE
              WHEN OReEstadoActual IN (3,4) THEN 1   -- Abonado → Pendiente
              WHEN OReEstadoActual = 8      THEN 5    -- Empaquetado y abonado → Entregado
              ELSE OReEstadoActual
            END,
            OReFechaEstadoActual = GETDATE(),
            ORePasarPorCaja      = 1
        WHERE PagIdPago IN (
            SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @TcaId
        );
      `);

    // Revertir OrdenesDeposito
    await new sql.Request(transaction)
      .input('TcaId',    sql.Int, tcaIdTransaccion)
      .input('UsuarioId',sql.Int, usuarioId)
      .query(`
        UPDATE dbo.OrdenesDeposito
        SET PagIdPago           = NULL,
            TcaIdTransaccion    = NULL,
            OrdEstadoActual     = 6,       -- Cancelado/Pendiente Pago
            OrdFechaEstadoActual = GETDATE()
        WHERE TcaIdTransaccion = @TcaId;
      `);

    await transaction.commit();
    logger.info(`[CAJA] 🔄 Transaccion ${tcaIdTransaccion} anulada por usuario ${usuarioId}.`);

    return { success: true, mensaje: `Transacción ${tcaIdTransaccion} anulada correctamente.` };

  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    logger.error(`[CAJA] ❌ Error anularTransaccion: ${err.message}`);
    throw err;
  }
}


// ─────────────────────────────────────────────────────────────────────────
// CONSULTAS
// ─────────────────────────────────────────────────────────────────────────

/**
 * getTransaccion
 * Devuelve el encabezado + detalle + pagos de una transacción.
 */
async function getTransaccion(tcaIdTransaccion) {
  const pool = await getPool();

  const [tcaRes, detRes, pagRes] = await Promise.all([
    // Encabezado
    pool.request()
      .input('TcaId', sql.Int, tcaIdTransaccion)
      .query(`
        SELECT t.*, c.Nombre AS NombreCliente
        FROM dbo.TransaccionesCaja t WITH(NOLOCK)
        LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = t.TcaClienteId
        WHERE t.TcaIdTransaccion = @TcaId
      `),
    // Detalle
    pool.request()
      .input('TcaId', sql.Int, tcaIdTransaccion)
      .query(`
        SELECT td.*, 
               u.MonSimbolo AS RefMonedaSimbolo,
               ISNULL(r.OReCostoTotalOrden, d.OrdCostoFinal) AS RefMontoOriginalNativo
        FROM dbo.TransaccionDetalle td WITH(NOLOCK)
        LEFT JOIN dbo.OrdenesRetiro r WITH(NOLOCK) ON r.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
        LEFT JOIN dbo.OrdenesDeposito d WITH(NOLOCK) ON d.OrdIdOrden = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_DEPOSITO'
        OUTER APPLY (
           SELECT TOP 1 subD.MonIdMoneda 
           FROM dbo.OrdenesDeposito subD WITH(NOLOCK)
           WHERE (td.TdeTipoReferencia = 'ORDEN_RETIRO' AND subD.OReIdOrdenRetiro = td.TdeReferenciaId)
              OR (td.TdeTipoReferencia = 'ORDEN_DEPOSITO' AND subD.OrdIdOrden = td.TdeReferenciaId)
        ) topMoneda
        LEFT JOIN dbo.Monedas u WITH(NOLOCK) ON u.MonIdMoneda = topMoneda.MonIdMoneda
        WHERE td.TcaIdTransaccion = @TcaId 
        ORDER BY td.TdeIdDetalle
      `),
    // Pagos
    pool.request()
      .input('TcaId', sql.Int, tcaIdTransaccion)
      .query(`
        SELECT p.*, mp.MPaDescripcionMetodo, mp.MPaCodigo,
               mon.MonSimbolo
        FROM dbo.Pagos p WITH(NOLOCK)
        JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
        LEFT JOIN dbo.Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = p.PagIdMonedaPago
        WHERE p.PagTcaIdTransaccion = @TcaId
        ORDER BY p.PagIdPago
      `),
  ]);

  if (!tcaRes.recordset.length) return null;

  return {
    ...tcaRes.recordset[0],
    detalle: detRes.recordset,
    pagos:   pagRes.recordset,
  };
}

/**
 * getTransaccionesByCliente
 * Historial de transacciones de un cliente con paginación.
 */
async function getTransaccionesByCliente({ clienteId, desde, hasta, limit = 50 }) {
  const pool = await getPool();
  const req  = pool.request()
    .input('ClienteId', sql.Int, clienteId)
    .input('Limit',     sql.Int, limit);

  let filtroFecha = '';
  if (desde) { req.input('Desde', sql.Date, desde); filtroFecha += ' AND CAST(t.TcaFecha AS DATE) >= @Desde'; }
  if (hasta) { req.input('Hasta', sql.Date, hasta); filtroFecha += ' AND CAST(t.TcaFecha AS DATE) <= @Hasta'; }

  const result = await req.query(`
    SELECT TOP (@Limit)
      t.TcaIdTransaccion, t.TcaFecha, t.TcaTipoDocumento,
      t.TcaSerieDoc, t.TcaNumeroDoc,
      t.TcaTotalBruto, t.TcaTotalAjuste, t.TcaTotalNeto, t.TcaTotalCobrado,
      t.TcaEstado,
      (SELECT COUNT(*)             FROM dbo.TransaccionDetalle WITH(NOLOCK) WHERE TcaIdTransaccion = t.TcaIdTransaccion) AS CantOrdenes,
      (SELECT COUNT(*)             FROM dbo.Pagos               WITH(NOLOCK) WHERE PagTcaIdTransaccion = t.TcaIdTransaccion) AS CantMetodosPago,
      (SELECT STRING_AGG(mp.MPaDescripcionMetodo, ' + ')
       FROM dbo.Pagos p WITH(NOLOCK)
       JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
       WHERE p.PagTcaIdTransaccion = t.TcaIdTransaccion
         AND p.PagTipoMovimiento != 'ANULADO') AS MetodosPagoDesc
    FROM dbo.TransaccionesCaja t WITH(NOLOCK)
    WHERE t.TcaClienteId = @ClienteId
      ${filtroFecha}
    ORDER BY t.TcaFecha DESC
  `);

  return result.recordset;
}


// ─────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────

/**
 * _tipoMovimientoPago
 * Determina el PagTipoMovimiento según el código del método.
 * Si el método viene del catálogo viejo (sin MPaCodigo), usa 'PAGO' por defecto.
 */
function _tipoMovimientoPago(metodoPagoId, todosLosPagos) {
  // El cajaController puede enriquecer el payload con MPaCodigo si lo necesita;
  // aquí usamos una heurística simple basada en IDs conocidos.
  // Se sobreescribirá cuando el catálogo tenga MPaCodigo actualizado.
  return 'PAGO'; // El controlador puede pasar tipoMovimiento directamente
}

/**
 * _lanzarHooksContables
 * Llama a los hooks de contabilidad DESPUÉS del commit.
 * Errores aquí NO revierten el pago — solo se loggean como warnings.
 */
async function _lanzarHooksContables({ aplicaciones, pagosNorm, pagosCreados, header, usuarioId, totalNeto }) {
  // Registrar UN SOLO pago consolidado hacia la Deuda del Cliente (Submayor)
  // Utilizamos la moneda original de la orden (header.moneda) y el monto total cobrado en ESA moneda
  // El PagIdPago lo asociamos al primer pago real como referencia.
  //
  // IMPORTANTE: Si la función que originó el cobro (ej. procesarVentaDirecta) ya registró
  // los movimientos de CARGO y PAGO en MovimientosCuenta internamente dentro de la TX,
  // NO se debe volver a llamar a hookPagoRegistrado — evita el doble movimiento que duplicaba el saldo.
  if (header._movimientosPagoRegistrados) {
    logger.info(`[CAJA-HOOK] Movimientos de submayor ya registrados internamente — hookPagoRegistrado OMITIDO para CliId=${header.clienteId}`);
    // Sí seguimos procesando ajustes al final del bloque
  } else if (pagosCreados.length > 0) {
    const pagId = pagosCreados[0].pagIdPago;
    
    // Si la transacción NO generó deuda en la tabla DeudaDocumento (ej. porque se pagó al contado 100%),
    // registramos explícitamente el CARGO de la factura/venta para que el PAGO no quede flotando.
    // EXCEPCIÓN: si las aplicaciones referencian órdenes existentes (OrdIdOrden), esas órdenes
    // ya fueron debitadas por hookOrdenCreada con MovTipo='ORDEN'. Registrar VTA_CAJA de nuevo
    // sería un doble débito que deja el saldo negativo aunque el pago se haya recibido.
    // El importe a debitar vía VTA_CAJA será siempre el totalNeto de la orden,
    // ya que el movimiento previo ORDEN no debita el CueSaldoActual (se cambió para que no afecte saldo).
    let importeADebitarVtaCaja = totalNeto;

    if (!header._creoDeuda && importeADebitarVtaCaja > 0.01) {

       let detailDesc = '';
       if (aplicaciones && aplicaciones.length > 0) {
         detailDesc = aplicaciones.map(ap => {
           const code = ap.codigoRef || '';
           const desc = ap.descripcion || '';
           if (code && desc) return `${code} (${desc})`;
           return code || desc;
         }).filter(Boolean).join(', ');
       }
       let conceptoContado = `Venta Contado: ${header.serieDoc || ''}-${header.numeroDoc || ''}`.trim() || 'Venta Contado';
       if (detailDesc) {
         conceptoContado += ` (${detailDesc})`;
       }
       if (conceptoContado.length > 195) {
         conceptoContado = conceptoContado.substring(0, 192) + '...';
       }

       if (header.deudaPuraUSD > 0) {
          const cueIdUsd = await contabilidadSvc.obtenerOCrearCuenta(header.clienteId, 'DINERO_USD', { UsuarioAlta: usuarioId });
          await contabilidadSvc.registrarMovimiento({
             CueIdCuenta: cueIdUsd, MovTipo: 'VTA_CAJA', MovConcepto: conceptoContado,
             MovImporte: -(header.deudaPuraUSD), MovUsuarioAlta: usuarioId || 1, DocIdDocumento: header.docIdDocumento || null
          });
       }
       
       if (header.deudaPuraUYU > 0) {
          const cueIdUyu = await contabilidadSvc.obtenerOCrearCuenta(header.clienteId, 'DINERO_UYU', { UsuarioAlta: usuarioId });
          await contabilidadSvc.registrarMovimiento({
             CueIdCuenta: cueIdUyu, MovTipo: 'VTA_CAJA', MovConcepto: conceptoContado,
             MovImporte: -(header.deudaPuraUYU), MovUsuarioAlta: usuarioId || 1, DocIdDocumento: header.docIdDocumento || null
          });
       }
       
       if (!(header.deudaPuraUSD > 0 || header.deudaPuraUYU > 0)) {
          const isOrdenUSD = (header.moneda === 'USD' || header.monedaBase === 'USD');
          const cueId = await contabilidadSvc.obtenerOCrearCuenta(header.clienteId, isOrdenUSD ? 'DINERO_USD' : 'DINERO_UYU', { UsuarioAlta: usuarioId });
          await contabilidadSvc.registrarMovimiento({
             CueIdCuenta: cueId, MovTipo: 'VTA_CAJA', MovConcepto: conceptoContado,
             MovImporte: -(importeADebitarVtaCaja), MovUsuarioAlta: usuarioId || 1, DocIdDocumento: header.docIdDocumento || null
          });
       }
    }

    // Si pasaron la deuda pura desde el Frontend (para cobros de órdenes exactas)
    if ((header.deudaPuraUSD > 0 || header.deudaPuraUYU > 0)) {
      if (header.deudaPuraUSD > 0) {
        await contabilidadSvc.hookPagoRegistrado({
          PagIdPago:   pagId,
          CliIdCliente: header.clienteId,
          MontoPago:   header.deudaPuraUSD,
          MonIdMoneda: 2, // USD
          UsuarioAlta: usuarioId,
        });
      }
      if (header.deudaPuraUYU > 0) {
        await contabilidadSvc.hookPagoRegistrado({
          PagIdPago:   pagId,
          CliIdCliente: header.clienteId,
          MontoPago:   header.deudaPuraUYU,
          MonIdMoneda: 1, // UYU
          UsuarioAlta: usuarioId,
        });
      }
    } else if (totalNeto > 0) {
      const isOrdenUSD = (header.moneda === 'USD' || header.monedaBase === 'USD');
      logger.info(`[TRAZA-CONTADO] Llamando a hookPagoRegistrado por importe ${totalNeto}`);
      // Fallback a lógica genérica (procesarTransaccion — retiros, cobros WMS, etc.)
      await contabilidadSvc.hookPagoRegistrado({
        PagIdPago:   pagId,
        CliIdCliente: header.clienteId,
        MontoPago:   totalNeto,
        MonIdMoneda: isOrdenUSD ? 2 : 1,
        UsuarioAlta: usuarioId,
      });
    }
  }

  // Registrar ajustes como movimientos de BONIFICACION / AJUSTE
  for (const ap of aplicaciones) {
    if ((ap.ajuste || 0) !== 0 && ap.tipoAjuste) {
      const MovTipo = ap.tipoAjuste === 'BONIFICACION' ? 'BONIFICACION'
                    : ap.tipoAjuste === 'SALDO_CERO'   ? 'SALDO_CERO'
                    : 'AJUSTE';

      const CueTipo = 'DINERO_UYU';
      try {
        const cueId = await contabilidadSvc.obtenerOCrearCuenta(header.clienteId, CueTipo, { UsuarioAlta: usuarioId });
        await contabilidadSvc.registrarMovimiento({
          CueIdCuenta:     cueId,
          MovTipo,
          MovConcepto:     `${MovTipo} en ${ap.codigoRef || ap.descripcion || 'orden'} (TcaId=${ap.tcaId})`,
          MovImporte:      ap.ajuste,
          MovUsuarioAlta:  usuarioId,
          OrdIdOrden:      ap.tipo === 'ORDEN_DEPOSITO' ? ap.referenciaId : null,
          OReIdOrdenRetiro: ap.tipo === 'ORDEN_RETIRO'  ? ap.referenciaId : null,
        });
      } catch (e) {
        logger.warn(`[CAJA] Hook ajuste contable falló (${ap.codigoRef}): ${e.message}`);
      }
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────
/**
 * generarCFEDesdeOrdenesDirectas
 * ──────────────────────────────────────────────────────────────────────────
 * Equivalente al Paso 5.6 de procesarTransaccion, pero para pagos realizados
 * desde Entregas/Mostrador sin pasar por Caja (sin TcaIdTransaccion).
 *
 * Genera:
 *  - DocumentosContables (E-Ticket Contado, DocPagado=1, CfeEstado=PENDIENTE)
 *  - DocumentosContablesDetalle clonado de OrdenesDeposito / PedidosCobranzaDetalle
 *  - Marca DeudaDocumento previas como PAGADO si existían
 *
 * @param {number[]} orderIds       Array de OrdIdOrden
 * @param {number}   clienteId
 * @param {number}   monto          Total ya en la moneda de pago
 * @param {number}   monedaId       1=UYU, 2=USD
 * @param {number}   pagoId         PagIdPago recién insertado
 * @param {number}   usuarioId
 */
async function generarCFEDesdeOrdenesDirectas({ orderIds, clienteId, monto, monedaId, pagoId, usuarioId }) {
  if (!orderIds || orderIds.length === 0) return null;
  const pool = await getPool();
  const contabilidadCore = require('./contabilidadCore');

  const idList = orderIds.map(Number).join(',');

  // 1. ¿Ya hay un CFE para alguna de estas órdenes?
  const yaFacturado = await pool.request().query(`
    SELECT TOP 1 dcd.DocIdDocumento
    FROM dbo.DocumentosContablesDetalle dcd
    WHERE dcd.OrdCodigoOrden IN (
      SELECT OrdCodigoOrden FROM dbo.OrdenesDeposito WHERE OrdIdOrden IN (${idList})
    )
  `);
  if (yaFacturado.recordset.length > 0) {
    logger.info(`[CFE-MOSTRADOR] Órdenes ya tienen CFE (DocId=${yaFacturado.recordset[0].DocIdDocumento}). Omitido.`);
    return null;
  }

  // 2. Config del tipo de documento (Pedido Caja = CodDocumento '40', NO fiscal → se revisa/convierte antes de emitir el CFE)
  const resConfig = await pool.request()
    .input('codDoc', sql.VarChar(10), '40')
    .query(`
      SELECT c.Detalle, c.AfectaCtaCte,
             s.SecSerie, s.SecIdSecuencia
      FROM dbo.Config_TiposDocumento c WITH(NOLOCK)
      LEFT JOIN dbo.SecuenciaDocumentos s WITH(UPDLOCK) ON c.SecIdSecuencia = s.SecIdSecuencia
      WHERE c.CodDocumento = @codDoc
    `);

  if (!resConfig.recordset.length || !resConfig.recordset[0].SecIdSecuencia) {
    logger.warn('[CFE-MOSTRADOR] Sin config de Pedido Caja (CodDocumento=40). Documento omitido.');
    return null;
  }
  const config = resConfig.recordset[0];

  // 3. Avanzar secuencia
  const resSeq = await pool.request()
    .input('secId', sql.Int, config.SecIdSecuencia)
    .query(`
      UPDATE dbo.SecuenciaDocumentos
      SET SecUltimoNumero = SecUltimoNumero + 1
      OUTPUT INSERTED.SecUltimoNumero
      WHERE SecIdSecuencia = @secId
    `);
  const numeroCFE = resSeq.recordset[0].SecUltimoNumero;
  const serieCFE  = config.SecSerie || 'A';

  // 4. Desglose IVA
  const desglose = contabilidadCore.desglosarIVA(monto, 22);

  // 5. Buscar la cuenta real del cliente (no hardcodear 118/119)
  //    Para Estado de Cuentas, DocumentosContables debe apuntar a la cuenta del cliente.
  const cueTipo = monedaId === 2 ? 'DINERO_USD' : 'DINERO_UYU';
  const cueRes = await pool.request()
    .input('cli', sql.Int, clienteId)
    .input('tipo', sql.VarChar(20), cueTipo)
    .query(`
      SELECT TOP 1 CueIdCuenta
      FROM dbo.CuentasCliente WITH(NOLOCK)
      WHERE CliIdCliente = @cli AND CueTipo = @tipo AND CueActiva = 1
    `);
  // Fallback a cuentas genéricas si el cliente aún no tiene cuenta propia
  const cueIdCuenta = cueRes.recordset.length > 0
    ? cueRes.recordset[0].CueIdCuenta
    : (monedaId === 2 ? 119 : 118);

  // 6 + 7. Resolver líneas de detalle fiscal desde OrdenesDeposito e insertar DocumentosContables
  const lineasCFEDirectas = await contabilidadCore.resolverLineasDetalle({
    orderIds,
    monedaFactura: monedaId === 1 ? 'UYU' : 'USD',
  });

  const docId = await contabilidadCore.crearDocumentoContable({
    header: {
      cueIdCuenta: cueIdCuenta,
      clienteId: clienteId,
      monedaId: monedaId,
      tipo: config.Detalle || 'Pedido Caja',
      numero: String(numeroCFE),
      serie: serieCFE,
      subtotal: desglose.neto,
      impuestos: desglose.ivaMonto,
      total: monto,
      estado: 1,
      cfeEstado: 'BORRADOR',
      usuarioId: usuarioId || 1,
      docPagado: true
    },
    lineas: lineasCFEDirectas
  });

  // Map OrdenesDeposito OrdIdOrden to ERP OrdenID
  let allMcOrdIds = [...orderIds];
  try {
    const mapRes = await pool.request().query(`
      SELECT e.OrdenID
      FROM dbo.Ordenes e
      JOIN dbo.OrdenesDeposito od ON e.CodigoOrden = od.OrdCodigoOrden
      WHERE od.OrdIdOrden IN (${idList})
    `);
    const erpIds = mapRes.recordset.map(r => r.OrdenID);
    for (const erpId of erpIds) {
      if (!allMcOrdIds.includes(erpId)) {
        allMcOrdIds.push(erpId);
      }
    }
  } catch (errMap) {
    logger.warn(`[CFE-MOSTRADOR] Error mapping IDs: ${errMap.message}`);
  }
  const mcIdList = allMcOrdIds.map(Number).join(',');

  // Update MovimientosCuenta setting DocIdDocumento = docId
  await pool.request()
    .input('docId', sql.Int, docId)
    .query(`
      UPDATE dbo.MovimientosCuenta
      SET DocIdDocumento = @docId
      WHERE MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
        AND DocIdDocumento IS NULL
        AND OrdIdOrden IN (${mcIdList})
    `);
  logger.info(`[CFE-MOSTRADOR] Linked ORDEN/ORDEN_ANTICIPO movements to DocIdDocumento=${docId} for orders ${mcIdList}`);

  // Query order details for the descriptive concept
  let orderDetails = [];
  try {
    const ordDetailsRes = await pool.request().query(`
      SELECT OrdCodigoOrden, OrdNombreTrabajo 
      FROM dbo.OrdenesDeposito 
      WHERE OrdIdOrden IN (${idList})
    `);
    orderDetails = ordDetailsRes.recordset;
  } catch (errDet) {
    logger.warn(`[CFE-MOSTRADOR] No se pudieron obtener detalles de órdenes para concepto: ${errDet.message}`);
  }

  let detailDescDirect = '';
  if (orderDetails.length > 0) {
    detailDescDirect = orderDetails.map(od => {
      const code = od.OrdCodigoOrden || '';
      const desc = od.OrdNombreTrabajo || '';
      if (code && desc) return `${code} (${desc})`;
      return code || desc;
    }).filter(Boolean).join(', ');
  }

  let conceptoContadoDirect = `Factura ${serieCFE}-${numeroCFE} (CFE Mostrador)`;
  if (detailDescDirect) {
    conceptoContadoDirect += ` (${detailDescDirect})`;
  }
  if (conceptoContadoDirect.length > 195) {
    conceptoContadoDirect = conceptoContadoDirect.substring(0, 192) + '...';
  }

  // 8. DeudaDocumento: actualizar existentes O crear nueva (PAGADO, pend=0)
  //    Necesario para que aparezca en el Estado de Cuentas del cliente.
  const ddExist = await pool.request()
    .input('docId', sql.Int, docId)
    .query(`
      UPDATE dd SET
        dd.DDeEstado           = 'PAGADO',
        dd.DDeImportePendiente = 0,
        dd.DocIdDocumento      = @docId
      OUTPUT INSERTED.DDeIdDocumento
      FROM dbo.DeudaDocumento dd
      WHERE dd.OrdIdOrden IN (${idList})
        AND dd.DDeEstado NOT IN ('PAGADO', 'ANULADO')
    `);

  // Si no había DeudaDocumento previa, la creamos como PAGADO
  // para que el estado de cuentas registre la factura cobrada.
  if (ddExist.recordset.length === 0) {
    await pool.request()
      .input('cue',  sql.Int,           cueIdCuenta)
      .input('doc',  sql.Int,           docId)
      .input('orig', sql.Decimal(18,4), monto)
      .query(`
        INSERT INTO dbo.DeudaDocumento
          (CueIdCuenta, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente,
           DDeFechaEmision, DDeFechaVencimiento, DDeEstado)
        VALUES
          (@cue, @doc, @orig, 0,
           GETDATE(), GETDATE(), 'PAGADO')
      `);
    logger.info(`[CFE-MOSTRADOR] DeudaDocumento (PAGADO) creada para DocId=${docId} Cli=${clienteId}`);

      let importeCFEVtaCaja = monto;

      if (importeCFEVtaCaja > 0.01) {
        try {
          await contabilidadSvc.registrarMovimiento({
            CueIdCuenta:    cueIdCuenta,
            MovTipo:        'VTA_CAJA',
            MovConcepto:    conceptoContadoDirect,
            MovImporte:     -importeCFEVtaCaja,
            MovUsuarioAlta: usuarioId || 1,
            DocIdDocumento: docId,
          });
          logger.info(`[CFE-MOSTRADOR] VTA_CAJA (-${importeCFEVtaCaja}) registrado para balancear PAGO en Cli=${clienteId}`);
        } catch (movErr) {
          logger.warn(`[CFE-MOSTRADOR] No se pudo registrar movimiento VTA_CAJA: ${movErr.message}`);
        }
      }
    // ─────────────────────────────────────────────────────────────────────────
  }

  logger.info(`[CFE-MOSTRADOR] ✅ CFE ${serieCFE}-${numeroCFE} (DocId=${docId}) generado para Cli=${clienteId} | órdenes: ${idList}`);
  return { docId, serie: serieCFE, numero: numeroCFE };
}


// ─────────────────────────────────────────────────────────────────────────
/**
 * anularReciboInterno
 * Anula un recibo / ingreso interno (sin CFE) de la Bandeja de Documentos Internos.
 * Revierte, dentro de UNA transacción SQL:
 *   - TransaccionesCaja  → TcaEstado = 'ANULADO'
 *   - Pagos              → PagTipoMovimiento = 'ANULADO'
 *   - Submayor: MovimientosCuenta (MovAnulado=1) + saldo en CuentasCliente,
 *     acotado SÓLO a los movimientos ligados a los pagos/documentos de ESTA transacción
 *     (para los ingresos genéricos "Consumidor Final" no hay ninguno → no-op).
 *   - Asiento contable   → Cont_AsientosCabecera.AsiEstado = 0 (excluye el de egresos).
 */
async function anularReciboInterno({ tcaId, usuarioId, motivo }) {
  if (!tcaId) throw new Error('tcaId es obligatorio.');

  const pool = await getPool();
  const transaction = pool.transaction();
  await transaction.begin();

  try {
    // 1. Validar existencia y que no esté ya anulado
    const tcaRes = await new sql.Request(transaction)
      .input('TcaId', sql.Int, tcaId)
      .query(`SELECT TcaEstado FROM dbo.TransaccionesCaja WITH(UPDLOCK) WHERE TcaIdTransaccion = @TcaId`);
    if (!tcaRes.recordset.length) throw new Error(`Recibo ${tcaId} no encontrado.`);
    if (tcaRes.recordset[0].TcaEstado === 'ANULADO') throw new Error('El recibo ya está anulado.');

    // 2. Bloquear si existe un CFE aceptado por DGI vinculado
    const docsRes = await new sql.Request(transaction)
      .input('TcaId', sql.Int, tcaId)
      .query(`
        SELECT 1 FROM dbo.DocumentosContables WITH(NOLOCK)
        WHERE TcaIdTransaccion = @TcaId AND CfeEstado = 'ACEPTADO_DGI'`);
    if (docsRes.recordset.length) {
      throw new Error('No se puede anular: existe un CFE aceptado por DGI. Se requiere emitir Nota de Crédito.');
    }

    // 3. Marcar la transacción como ANULADO
    await new sql.Request(transaction)
      .input('TcaId',     sql.Int,           tcaId)
      .input('UsuarioId', sql.Int,           usuarioId)
      .input('Motivo',    sql.NVarChar(500), motivo || null)
      .query(`
        UPDATE dbo.TransaccionesCaja
        SET TcaEstado         = 'ANULADO',
            TcaFechaAnulacion = GETDATE(),
            TcaUsuarioAnula   = @UsuarioId,
            TcaObservaciones  = ISNULL(TcaObservaciones, '') + ' | ANULADO: ' + ISNULL(@Motivo,'')
        WHERE TcaIdTransaccion = @TcaId`);

    // 4. Anular los pagos de la transacción
    await new sql.Request(transaction)
      .input('TcaId', sql.Int, tcaId)
      .query(`UPDATE dbo.Pagos SET PagTipoMovimiento = 'ANULADO' WHERE PagTcaIdTransaccion = @TcaId`);

    // 5. Revertir submayor (movimientos + saldo) acotado a ESTA transacción
    const movsRes = await new sql.Request(transaction)
      .input('TcaId', sql.Int, tcaId)
      .query(`
        SELECT MovIdMovimiento, CueIdCuenta, MovImporte
        FROM dbo.MovimientosCuenta
        WHERE (MovAnulado IS NULL OR MovAnulado = 0)
          AND ( PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @TcaId)
             OR DocIdDocumento IN (SELECT DocIdDocumento FROM dbo.DocumentosContables WHERE TcaIdTransaccion = @TcaId) )`);
    for (const mov of movsRes.recordset) {
      await new sql.Request(transaction)
        .input('Mid', sql.Int, mov.MovIdMovimiento)
        .query(`UPDATE dbo.MovimientosCuenta SET MovAnulado = 1 WHERE MovIdMovimiento = @Mid`);
      await new sql.Request(transaction)
        .input('CueId',   sql.Int,           mov.CueIdCuenta)
        .input('Importe', sql.Decimal(18,4), mov.MovImporte)
        .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Importe WHERE CueIdCuenta = @CueId`);
    }

    // 6. Anular el asiento contable del ingreso (excluye el asiento de egresos por seguridad)
    await new sql.Request(transaction)
      .input('TcaId', sql.Int, tcaId)
      .query(`
        UPDATE dbo.Cont_AsientosCabecera SET AsiEstado = 0
        WHERE TcaIdTransaccion = @TcaId AND ISNULL(SysOrigen,'') <> 'CAJA_EGRESOS'`);

    await transaction.commit();
    logger.info(`[CAJA] 🔄 Recibo interno ${tcaId} anulado por usuario ${usuarioId} (${movsRes.recordset.length} movs revertidos).`);
    return { success: true, mensaje: `Recibo ${tcaId} anulado correctamente.` };

  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    logger.error(`[CAJA] ❌ anularReciboInterno: ${err.message}`);
    throw err;
  }
}

/**
 * anularEgreso
 * Anula un egreso de caja (EgresosCaja) de la Bandeja de Documentos Internos.
 * Revierte, dentro de UNA transacción SQL:
 *   - EgresosCaja        → EgrEstado = 'ANULADO' (+ nota en EgrObservaciones)
 *   - DocumentosContables→ DocEstado / CfeEstado = 'ANULADO' (el respaldo del egreso)
 *   - Submayor ligado al documento (si lo hubiera)
 *   - Asiento contable   → Cont_AsientosCabecera.AsiEstado = 0 (SysOrigen = 'CAJA_EGRESOS')
 */
async function anularEgreso({ egrId, usuarioId, motivo }) {
  if (!egrId) throw new Error('egrId es obligatorio.');

  const pool = await getPool();
  const transaction = pool.transaction();
  await transaction.begin();

  try {
    const egrRes = await new sql.Request(transaction)
      .input('EgrId', sql.Int, egrId)
      .query(`SELECT EgrEstado, DocIdDocumento FROM dbo.EgresosCaja WITH(UPDLOCK) WHERE EgrIdEgreso = @EgrId`);
    if (!egrRes.recordset.length) throw new Error(`Egreso ${egrId} no encontrado.`);
    if (egrRes.recordset[0].EgrEstado === 'ANULADO') throw new Error('El egreso ya está anulado.');
    const docId = egrRes.recordset[0].DocIdDocumento || null;

    // 1. Marcar el egreso como ANULADO
    await new sql.Request(transaction)
      .input('EgrId',  sql.Int,           egrId)
      .input('Motivo', sql.NVarChar(300), motivo || null)
      .query(`
        UPDATE dbo.EgresosCaja
        SET EgrEstado        = 'ANULADO',
            EgrObservaciones = ISNULL(EgrObservaciones, '') + ' | ANULADO: ' + ISNULL(@Motivo,'')
        WHERE EgrIdEgreso = @EgrId`);

    // 2. Anular el documento contable de respaldo (EGRESO_CAJA)
    if (docId) {
      await new sql.Request(transaction)
        .input('Id', sql.Int, docId)
        .query(`UPDATE dbo.DocumentosContables SET DocEstado = 'ANULADO', CfeEstado = 'ANULADO' WHERE DocIdDocumento = @Id`);

      // 3. Revertir submayor ligado al documento (si lo hubiera)
      const movsRes = await new sql.Request(transaction)
        .input('Doc', sql.Int, docId)
        .query(`
          SELECT MovIdMovimiento, CueIdCuenta, MovImporte FROM dbo.MovimientosCuenta
          WHERE (MovAnulado IS NULL OR MovAnulado = 0) AND DocIdDocumento = @Doc`);
      for (const mov of movsRes.recordset) {
        await new sql.Request(transaction)
          .input('Mid', sql.Int, mov.MovIdMovimiento)
          .query(`UPDATE dbo.MovimientosCuenta SET MovAnulado = 1 WHERE MovIdMovimiento = @Mid`);
        await new sql.Request(transaction)
          .input('CueId',   sql.Int,           mov.CueIdCuenta)
          .input('Importe', sql.Decimal(18,4), mov.MovImporte)
          .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @Importe WHERE CueIdCuenta = @CueId`);
      }
    }

    // 4. Anular el asiento contable del egreso
    await new sql.Request(transaction)
      .input('EgrId', sql.Int, egrId)
      .query(`
        UPDATE dbo.Cont_AsientosCabecera SET AsiEstado = 0
        WHERE TcaIdTransaccion = @EgrId AND SysOrigen = 'CAJA_EGRESOS'`);

    await transaction.commit();
    logger.info(`[CAJA] 🔄 Egreso ${egrId} anulado por usuario ${usuarioId}.`);
    return { success: true, mensaje: `Egreso ${egrId} anulado correctamente.` };

  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    logger.error(`[CAJA] ❌ anularEgreso: ${err.message}`);
    throw err;
  }
}

module.exports = {
  procesarTransaccion,
  procesarVentaDirecta,
  getProductosVenta,
  anularTransaccion,
  anularReciboInterno,
  anularEgreso,
  getTransaccion,
  getTransaccionesByCliente,
  generarCFEDesdeOrdenesDirectas,
};

