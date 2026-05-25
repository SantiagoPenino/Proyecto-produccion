const axios = require('axios');
const { sql, getPool } = require('../config/db');
const PricingService = require('./pricingService');
const logger = require('../utils/logger');
const contabilidadSvc = require('./contabilidadService');

class ERPSyncService {

    /**
     * Sincroniza la "cotización" y el envío a los sistemas ERP y REACT.
     * Este es el nuevo "punto logístico" robusto solicitado.
     */
    static async syncFinalOrderIntegration(noDocERP, userId = 1, userName = 'Sistema', bultoCode = null, options = {}) {
        const { onlyCalculate = false, userNotes = '', priceOverride = null, quantityOverride = null, profileOverride = null, syncTarget = null, forcedReactPayload = null, forcedErpPayload = null, skipDeposito = false } = options;
        if (!noDocERP) throw new Error("NoDocERP es requerido para la sincronización.");

        const pool = await getPool();
        logger.info(`[ERPSync] Iniciando integración final para NoDocERP: ${noDocERP}${bultoCode ? ' (Bulto: ' + bultoCode + ')' : ''}`);

        // 1. Obtener todas las órdenes del documento
        const orderRes = await pool.request()
            .input('Doc', sql.NVarChar, noDocERP.toString())
            .query(`
                SELECT O.*, 
                       CASE WHEN PB.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END as MonedaBase, 
                       A.Descripcion as NombreArticulo, 
                       A.IDProdReact as ArtIdReact, 
                       C.CliIdCliente as Cli_CliIdCliente,
                       C.IDReact as Cli_IDReact
                FROM Ordenes O
                LEFT JOIN PreciosBase PB ON O.ProIdProducto = PB.ProIdProducto
                OUTER APPLY (
                    SELECT TOP 1 Descripcion, IDProdReact 
                    FROM Articulos WITH(NOLOCK) 
                    WHERE ProIdProducto = O.ProIdProducto 
                       OR (O.CodArticulo IS NOT NULL AND LTRIM(RTRIM(CodArticulo)) = LTRIM(RTRIM(O.CodArticulo)))
                ) A
                LEFT JOIN Clientes C ON (O.CliIdCliente = C.CliIdCliente OR (O.CodCliente IS NOT NULL AND LTRIM(RTRIM(O.CodCliente)) = LTRIM(RTRIM(C.CodCliente))))
                WHERE LTRIM(RTRIM(O.NoDocERP)) = LTRIM(RTRIM(@Doc)) 
                   OR LTRIM(RTRIM(O.NoDocERP)) = LTRIM(RTRIM(REPLACE(@Doc, 'ORD-', '')))
            `);

        const siblings = orderRes.recordset;
        if (siblings.length === 0) throw new Error(`No se encontraron órdenes para el documento ${noDocERP}`);

        // 2. Determinar Moneda (USD si hay al menos un artículo en USD)
        const hasUSD = siblings.some(s => (s.MonedaBase || '').toUpperCase() === 'USD');
        const targetCurrency = hasUSD ? 'USD' : 'UYU';

        let totalPriceSum = 0;
        let totalMagnitudeSum = 0;
        const detallesCobranza = [];

        // 2b. Leer perfiles especiales por nombre desde PerfilesPrecios
        // No requiere configuración manual — se busca por nombre automáticamente
        let idReposicion = null;
        try {
            const repRes = await pool.request().query(
                "SELECT TOP 1 ID FROM PerfilesPrecios WHERE Nombre LIKE '%eposici%' AND Activo = 1"
            );
            if (repRes.recordset.length > 0) {
                idReposicion = repRes.recordset[0].ID;
                logger.info(`[ERPSync] Perfil Reposicion cargado: ID=${idReposicion}`);
            }
        } catch(eCfg) {
            logger.warn('[ERPSync] No se pudo cargar perfil Reposicion:', eCfg.message);
        }

        for (const sib of siblings) {
            try {
                // Resolver Magnitud
                const magStr = sib.Magnitud || '';
                let magVal = 0;
                if (typeof magStr === 'number') magVal = magStr;
                else {
                    const m = magStr.toString().match(/[\d\.]+/);
                    if (m) magVal = parseFloat(m[0]);
                }

                // APLICAR OVERRIDE DE CANTIDAD SI EXISTE
                if (quantityOverride !== null && !isNaN(parseFloat(quantityOverride))) {
                    magVal = parseFloat(quantityOverride);
                }
                totalMagnitudeSum += magVal;

                // Resolver ID Cliente
                // Se usa CliIdCliente en lugar de CodCliente porque PreciosEspeciales ahora relaciona a través de CliIdCliente
                let internalClientId = sib.Cli_CliIdCliente || sib.CliIdCliente || null;

                // Perfiles Extra (Urgencia, Tinta, Reposición)
                const extraProfiles = profileOverride ? [parseInt(profileOverride)] : [];
                if (extraProfiles.length === 0) {
                    if (sib.Prioridad && sib.Prioridad.toString().trim().toLowerCase().includes('urgente')) extraProfiles.push(2);
                    if (sib.Tinta && (sib.Tinta.toUpperCase().includes('UV') || sib.Tinta.toUpperCase().includes('LATEX'))) extraProfiles.push(3);
                    // Reposición: aplicar si el código de orden comienza con R (ej: R-12345, REPO-xxx)
                    const codigoOrdenCheck = (sib.CodigoOrden || sib.NoDocERP || '').trim().toUpperCase();
                    if (idReposicion && codigoOrdenCheck.startsWith('R')) {
                        extraProfiles.push(idReposicion);
                        logger.info(`[ERPSync] 🔄 Orden de Reposición detectada (${codigoOrdenCheck}), inyectando Perfil #${idReposicion}`);
                    }
                }

                // Variables Técnicas
                const vars = {
                    puntadas: sib.Puntadas || 0,
                    bajadas: sib.Bajadas || 0,
                    bajadasAdicionales: sib.BajadasAdicionales || 0,
                    skipPrepago: true
                };

                // --- Lógica Especial de Cantidad Efectiva (Bajadas) ---
                const isBajadasArea = ['EST', 'COR', 'DF', 'TWT', 'TWC'].includes(sib.AreaID?.trim().toUpperCase());

                let effectiveQty = magVal;
                if (isBajadasArea || ['110', '113'].includes(sib.CodArticulo?.trim())) {
                    effectiveQty = (magVal * (sib.Bajadas || 1)) + (sib.BajadasAdicionales || 0);
                    if (effectiveQty === 0 && magVal > 0) effectiveQty = magVal; // Fallback
                }

                // Calcular Precio Orden
                let costoCalculado = 0;
                let precioUnitario = 0;
                let textLog = "Precio Calculado";
                let perfilAplicado = "Precio Base";
                let PUOriginal = 0;
                let SubtotalOriginal = 0;
                let MonedaOriginal = targetCurrency;

                if (priceOverride !== null && !isNaN(parseFloat(priceOverride))) {
                    costoCalculado = parseFloat(priceOverride);
                    precioUnitario = effectiveQty > 0 ? costoCalculado / effectiveQty : costoCalculado;
                    textLog = "Precio Ajustado Manualmente";
                    perfilAplicado = "Manual/Override";
                    PUOriginal = precioUnitario;
                    SubtotalOriginal = costoCalculado;
                    MonedaOriginal = targetCurrency;
                    logger.info(`[ERPSync] Aplicando Precio Override: ${costoCalculado}`);
                } else {
                    const priceResult = await PricingService.calculatePrice(
                        { codArticulo: sib.CodArticulo || '', proIdProducto: sib.ProIdProducto || null },
                        effectiveQty || 1,
                        { cliIdCliente: internalClientId, clienteLegacy: sib.CodCliente || internalClientId },
                        extraProfiles,
                        vars,
                        targetCurrency,
                        null,
                        sib.AreaID
                    );
                    costoCalculado = priceResult.precioTotal || 0;
                    precioUnitario = priceResult.precioUnitario || 0;
                    textLog = priceResult.txt;
                    perfilAplicado = (priceResult.perfilesAplicados && priceResult.perfilesAplicados.length > 0) ? priceResult.perfilesAplicados.join(', ') : 'Precio Base';
                    PUOriginal = priceResult.precioUnitarioOriginal || precioUnitario;
                    SubtotalOriginal = priceResult.precioTotalOriginal || costoCalculado;
                    MonedaOriginal = priceResult.monedaOriginal || targetCurrency;
                }

                // ---- LÓGICA DE PREPAGO (PlanesMetros) ----
                // Verificar si el cliente tiene un plan activo para este producto
                let metrosDisponibles = 0;
                let planIdActivo = null;
                if (internalClientId && sib.ProIdProducto) {
                    try {
                        const planRes = await pool.request()
                            .input('Cli', sql.Int, internalClientId)
                            .input('Pro', sql.Int, sib.ProIdProducto)
                            .query(`SELECT pm.PlaIdPlan,
                                         ISNULL(pm.PlaCantidadTotal, 0) - ISNULL(pm.PlaCantidadUsada, 0) AS MetrosDisponibles
                                     FROM dbo.PlanesMetros pm WITH(NOLOCK)
                                     WHERE pm.CliIdCliente = @Cli
                                       AND pm.PlaActivo = 1
                                       AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                                       AND (
                                         pm.ProIdProducto = @Pro
                                         OR EXISTS (
                                           SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                                           WHERE pap.PlaIdPlan = pm.PlaIdPlan
                                             AND pap.ProIdProducto = @Pro
                                         )
                                       )
                                     ORDER BY pm.PlaFechaVencimiento ASC`);
                        if (planRes.recordset.length > 0) {
                            const planIds = planRes.recordset.map(p => p.PlaIdPlan);
                            planIdActivo = planRes.recordset[0].PlaIdPlan;
                            const totalAvailableRaw = planRes.recordset.reduce((sum, p) => sum + (parseFloat(p.MetrosDisponibles) || 0), 0);

                            // Sumar metros comprometidos de otras órdenes activas (excluyendo sib.OrdenID)
                            const committedRes = await pool.request()
                                .input('CliId', sql.Int, internalClientId)
                                .input('ExcludeId', sql.Int, sib.OrdenID)
                                .query(`
                                    SELECT o.OrdenID, o.Magnitud
                                    FROM dbo.Ordenes o WITH(NOLOCK)
                                    WHERE o.CliIdCliente = @CliId
                                      AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Anulado', 'RECHAZADO')
                                      AND (@ExcludeId IS NULL OR o.OrdenID <> @ExcludeId)
                                      AND (
                                          o.ProIdProducto IN (
                                              SELECT ProIdProducto FROM dbo.PlanesMetros WHERE PlaIdPlan IN (${planIds.join(',')}) AND ProIdProducto IS NOT NULL
                                          )
                                          OR o.ProIdProducto IN (
                                              SELECT ProIdProducto FROM dbo.PlanesMetrosArticulosPermitidos WHERE PlaIdPlan IN (${planIds.join(',')})
                                          )
                                      )
                                `);

                            const totalCommitted = committedRes.recordset.reduce((sum, o) => {
                                const magStr = String(o.Magnitud || '0').replace(/[^\d.]/g, '');
                                return sum + (parseFloat(magStr) || 0);
                            }, 0);

                            metrosDisponibles = Math.max(0, totalAvailableRaw - totalCommitted);
                        }
                    } catch (ePlan) {
                        logger.warn(`[ERPSync] No se pudo verificar PlanesMetros para Orden ${sib.OrdenID}:`, ePlan.message);
                    }
                }

                // Determinar si aplica cobertura de prepago
                const metrosPedido = effectiveQty;
                const hayPlan = planIdActivo !== null && metrosDisponibles > 0;
                const coberturaTotal = hayPlan && metrosDisponibles >= metrosPedido;
                const coberturaParcial = hayPlan && !coberturaTotal;

                if (coberturaTotal) {
                    // ► CASO 1: El plan cubre todo — 1 línea a $0
                    logger.info(`[ERPSync] 🎟️  Prepago TOTAL para Orden ${sib.OrdenID}: ${metrosPedido}m cubiertos por Plan #${planIdActivo} (disponibles: ${metrosDisponibles}m)`);
                    costoCalculado = 0;
                    precioUnitario = 0;
                    perfilAplicado = 'Prepago (Rollo Pre-Comprado)';
                    textLog = `Cubierto 100% por Plan #${planIdActivo} (${metrosDisponibles}m disponibles)`;

                    await pool.request()
                        .input('Cost', sql.Decimal(18, 2), 0)
                        .input('Obs', sql.NVarChar(sql.MAX), userNotes)
                        .input('OID', sql.Int, sib.OrdenID)
                        .query("UPDATE Ordenes SET CostoTotal = @Cost, Observaciones = CASE WHEN @Obs <> '' THEN @Obs ELSE Observaciones END WHERE OrdenID = @OID");

                    // totalPriceSum += 0 → no suma nada
                    detallesCobranza.push({
                        OrdenID: sib.OrdenID,
                        CodArticulo: sib.CodArticulo,
                        ProIdProducto: sib.ProIdProducto,
                        Cantidad: metrosPedido,
                        PrecioUnitario: 0,
                        Subtotal: 0,
                        PrecioUnitarioOriginal: PUOriginal,
                        SubtotalOriginal: SubtotalOriginal,
                        Moneda: MonedaOriginal,
                        MonedaOriginal: MonedaOriginal,
                        LogPrecioAplicado: textLog,
                        Perfiles: perfilAplicado
                    });

                } else if (coberturaParcial) {
                    // ► CASO 2: El plan cubre PARCIALMENTE — 2 líneas
                    const metrosRestantes = metrosPedido - metrosDisponibles;
                    const proporcion = metrosPedido > 0 ? metrosRestantes / metrosPedido : 1;
                    const costoExcedente = parseFloat((costoCalculado * proporcion).toFixed(2));
                    const puExcedente = metrosRestantes > 0 ? costoExcedente / metrosRestantes : precioUnitario;

                    logger.info(`[ERPSync] 🎟️  Prepago PARCIAL para Orden ${sib.OrdenID}: ${metrosDisponibles}m a $0 + ${metrosRestantes}m a $${costoExcedente} (Plan #${planIdActivo})`);

                    // Actualizar Ordenes con el costo del excedente solamente
                    await pool.request()
                        .input('Cost', sql.Decimal(18, 2), costoExcedente)
                        .input('Obs', sql.NVarChar(sql.MAX), userNotes)
                        .input('OID', sql.Int, sib.OrdenID)
                        .query("UPDATE Ordenes SET CostoTotal = @Cost, Observaciones = CASE WHEN @Obs <> '' THEN @Obs ELSE Observaciones END WHERE OrdenID = @OID");

                    totalPriceSum += costoExcedente;

                    // Línea 1: metros cubiertos → $0
                    detallesCobranza.push({
                        OrdenID: sib.OrdenID,
                        CodArticulo: sib.CodArticulo,
                        ProIdProducto: sib.ProIdProducto,
                        Cantidad: metrosDisponibles,
                        PrecioUnitario: 0,
                        Subtotal: 0,
                        PrecioUnitarioOriginal: PUOriginal,
                        SubtotalOriginal: 0,
                        Moneda: MonedaOriginal,
                        MonedaOriginal: MonedaOriginal,
                        LogPrecioAplicado: `Prepago Parcial — ${metrosDisponibles}m cubiertos por Plan #${planIdActivo}`,
                        Perfiles: 'Prepago Parcial (Rollo Pre-Comprado)'
                    });

                    // Línea 2: metros restantes → precio proporcional
                    detallesCobranza.push({
                        OrdenID: sib.OrdenID,
                        CodArticulo: sib.CodArticulo,
                        ProIdProducto: sib.ProIdProducto,
                        Cantidad: metrosRestantes,
                        PrecioUnitario: PUOriginal,
                        Subtotal: SubtotalOriginal,
                        PrecioUnitarioOriginal: PUOriginal,
                        SubtotalOriginal: SubtotalOriginal,
                        Moneda: MonedaOriginal,
                        MonedaOriginal: MonedaOriginal,
                        LogPrecioAplicado: `Excedente de prepago — ${metrosRestantes}m a precio normal`,
                        Perfiles: 'Precio Base (Excedente de Rollo)'
                    });

                } else {
                    // ► CASO 3: Sin plan activo — precio normal sin cambios
                    await pool.request()
                        .input('Cost', sql.Decimal(18, 2), costoCalculado)
                        .input('Obs', sql.NVarChar(sql.MAX), userNotes)
                        .input('OID', sql.Int, sib.OrdenID)
                        .query("UPDATE Ordenes SET CostoTotal = @Cost, Observaciones = CASE WHEN @Obs <> '' THEN @Obs ELSE Observaciones END WHERE OrdenID = @OID");

                    totalPriceSum += costoCalculado;

                    detallesCobranza.push({
                        OrdenID: sib.OrdenID,
                        CodArticulo: sib.CodArticulo,
                        ProIdProducto: sib.ProIdProducto,
                        Cantidad: effectiveQty,
                        PrecioUnitario: PUOriginal,
                        Subtotal: SubtotalOriginal,
                        PrecioUnitarioOriginal: PUOriginal,
                        SubtotalOriginal: SubtotalOriginal,
                        Moneda: MonedaOriginal,
                        MonedaOriginal: MonedaOriginal,
                        LogPrecioAplicado: textLog,
                        Perfiles: perfilAplicado
                    });
                }

                // --- NUEVO: INYECTAR SERVICIOS EXTERNOS (Corte, Costura) DE SHEETS ---
                const { esOrdenExterna, getDatosDesdeSheets } = require('./ordenesExternasService');
                if (esOrdenExterna(sib.NoDocERP)) {
                    try {
                        const extData = await getDatosDesdeSheets(sib.NoDocERP);
                        if (extData && (extData.importeCorte || extData.importeCostura || extData.importeBordado)) {
                            // Obtener cotización
                            const cotRes = await pool.request().query(`SELECT TOP 1 CotDolar FROM dbo.Cotizaciones ORDER BY CotIdCotizacion DESC`);
                            const cotizacion = cotRes.recordset[0]?.CotDolar || 40;
                            
                            const addServiceLine = (nombre, importeUYU) => {
                                if (!importeUYU || importeUYU <= 0) return;
                                const srvUSD = Math.round((importeUYU / cotizacion) * 100) / 100;
                                totalPriceSum += srvUSD;
                                detallesCobranza.push({
                                    OrdenID: sib.OrdenID,
                                    CodArticulo: `SRV-${nombre.toUpperCase()}`,
                                    ProIdProducto: null,
                                    Cantidad: 1,
                                    PrecioUnitario: srvUSD,
                                    Subtotal: srvUSD,
                                    PrecioUnitarioOriginal: importeUYU,
                                    SubtotalOriginal: importeUYU,
                                    Moneda: 'USD',
                                    MonedaOriginal: 'UYU',
                                    LogPrecioAplicado: `Servicio de ${nombre} (Desde Sheets)`,
                                    Perfiles: 'Servicio Adicional'
                                });
                            };

                            addServiceLine('Corte', extData.importeCorte);
                            addServiceLine('Costura', extData.importeCostura);
                            addServiceLine('Bordado', extData.importeBordado);
                        }
                    } catch (errExt) {
                        logger.warn(`[ERPSync] No se pudo obtener servicios externos para ${sib.NoDocERP} al generar detalle: ${errExt.message}`);
                    }
                }

                // --- SERVICIOS EXTRA ---
                const srvRes = await pool.request()
                    .input('OID', sql.Int, sib.OrdenID)
                    .query("SELECT * FROM ServiciosExtraOrden WHERE OrdenID = @OID");

                for (const srv of srvRes.recordset) {
                    const srvVars = { puntadas: srv.Puntadas || 0, bajadas: srv.Bajadas || 0, bajadasAdicionales: srv.BajadasAdicionales || 0, skipPrepago: true };
                    let srvQty = srv.Cantidad || 1;
                    if (['110', '113'].includes(srv.CodArt?.trim())) {
                        srvQty = (srv.Cantidad || 1) * (srv.Bajadas || 1) + (srv.BajadasAdicionales || 0);
                    }

                    const srvPriceRes = await PricingService.calculatePrice(srv.CodArt || '', srvQty, internalClientId, extraProfiles, srvVars, targetCurrency, null, sib.AreaID);
                    const srvCostoTotal = srvPriceRes.precioTotal || 0;
                    totalPriceSum += srvCostoTotal;

                    const srvPerfil = (srvPriceRes.perfilesAplicados && srvPriceRes.perfilesAplicados.length > 0) ? srvPriceRes.perfilesAplicados.join(', ') : 'Precio Base';

                    const srvPUOrig = srvPriceRes.precioUnitarioOriginal || (srvPriceRes.precioUnitario || 0);
                    const srvSubOrig = srvPriceRes.precioTotalOriginal || srvCostoTotal;
                    const srvMonOrig = srvPriceRes.monedaOriginal || targetCurrency;

                    detallesCobranza.push({
                        OrdenID: sib.OrdenID,
                        CodArticulo: srv.CodArt,
                        ProIdProducto: srvPriceRes.proIdProducto || null,
                        Cantidad: srvQty,
                        PrecioUnitario: srvPUOrig,
                        Subtotal: srvSubOrig,
                        PrecioUnitarioOriginal: srvPUOrig,
                        SubtotalOriginal: srvSubOrig,
                        Moneda: srvMonOrig,
                        MonedaOriginal: srvMonOrig,
                        LogPrecioAplicado: srvPriceRes.txt,
                        Perfiles: srvPerfil
                    });

                    // Update Servicio en DB
                    await pool.request()
                        .input('PU', sql.Decimal(18, 2), srvPriceRes.precioUnitario || 0)
                        .input('TL', sql.Decimal(18, 2), srvCostoTotal)
                        .input('SID', sql.Int, srv.ServicioID)
                        .query("UPDATE ServiciosExtraOrden SET PrecioUnitario = @PU, TotalLinea = @TL WHERE ServicioID = @SID");
                }

            } catch (errCalc) {
                logger.error(`[ERPSync] Error calculando precio para Orden ${sib.OrdenID}:`, errCalc.message);
            }
        }

        // 4. Preparar Envío a REACT (Formato QR Exacto con $*)
        // [Bulto/Pedido]$*Cliente$*Trabajo$*Urgencia$*Producto$*Cantidad$*Importe
        const first = siblings[0];
        const rawCode = bultoCode || (first.CodigoOrden?.split('(')[0]?.trim() || first.CodigoOrden);
        const qrPedido = `${rawCode}`;
        // Usar el IDReact del cliente (columna aliaseada para evitar conflicto con O.*)
        const qrCliente = (first.Cli_IDReact || '0').toString();
        const qrTrabajo = (first.DescripcionTrabajo || '').trim();
        const qrUrgencia = (first.Prioridad && (first.Prioridad.toLowerCase().includes('urgente') || first.Prioridad.toLowerCase().includes('alta'))) ? '2' : '1';
        const qrProducto = (first.ArtIdReact || first.IdProductoReact || (targetCurrency === 'USD' ? '150' : '82')).toString();
        const qrCantidad = (totalMagnitudeSum || '1').toString();
        const qrImporte = totalPriceSum.toFixed(2);

        const SEP = '$*';
        const reactCode = `${qrPedido}${SEP}${qrCliente}${SEP}${qrTrabajo}${SEP}${qrUrgencia}${SEP}${qrProducto}${SEP}${qrCantidad}${SEP}${qrImporte}`;

        const qrData = {
             qrPedido, qrCliente, qrTrabajo, qrUrgencia, qrProducto, qrCantidad, qrImporte, qrString: reactCode
        };

        // 5. Actualizar PedidosCobranza y PedidosCobranzaDetalle (siempre, independiente del destino)
        try {
            await this.updatePedidosCobranza(pool, noDocERP, first.Cli_CliIdCliente || null, totalPriceSum, targetCurrency, detallesCobranza, userNotes, qrData);
            logger.info(`[ERPSync] ✅ PedidosCobranza actualizado para ${noDocERP}`);

            // ASEGURAR APERTURA DE CICLO PARA CLIENTES SEMANALES AL CARGAR ORDEN
            if (first.Cli_CliIdCliente) {
                const tipoCuenta = targetCurrency === 'USD' ? 'DINERO_USD' : 'DINERO_UYU';
                const monId = targetCurrency === 'USD' ? 2 : 1;
                await contabilidadSvc.obtenerOCrearCuenta(first.Cli_CliIdCliente, tipoCuenta, {
                    MonIdMoneda: monId,
                    CPaIdCondicion: 1,
                    UsuarioAlta: userId
                });
                logger.info(`[ERPSync] Verificación de Cuenta/Ciclo Contable ejecutada para Cliente ${first.Cli_CliIdCliente} en ${targetCurrency}.`);
            }
        } catch (ePed) {
            logger.error(`[ERPSync] ❌ Error al procesar PedidosCobranza o Ciclo Contable para ${noDocERP}: ${ePed?.message || JSON.stringify(ePed)}`);
            logger.error(`[ERPSync] Stack: ${ePed?.stack || '(sin stack)'}`);
            logger.error(`[ERPSync] DetallesCobranza al momento del error:`, JSON.stringify(detallesCobranza.map(d => ({ OID: d.OrdenID, CodArt: d.CodArticulo, PU: d.PrecioUnitario, ST: d.Subtotal, Mon: d.Moneda, MonOrig: d.MonedaOriginal }))));
        }

        if (onlyCalculate) {
            // Reconstruct ERP Payload for preview
            const lineasAgrupadas = {};
            detallesCobranza.forEach(d => {
                const cod = (d.CodArticulo || 'VAR').toString().trim();
                lineasAgrupadas[cod] = (lineasAgrupadas[cod] || 0) + parseFloat(d.Cantidad);
            });
            const erpPayload = {
                CodCliente: first.CodCliente ? first.CodCliente.toString() : "100101",
                Documento: "11",
                Lineas: Object.entries(lineasAgrupadas).map(([cod, qty]) => ({ CodArticulo: cod, Cantidad: qty.toString() }))
            };

            return {
                success: true,
                totalPriceSum,
                detallesCobranza,
                targetCurrency,
                reactPayload: { ordenString: reactCode, estado: "Ingresado" },
                erpPayload: erpPayload
            };
        }

        // 5.5 Guardar Detalle para Etiquetas (Validación visual de costos)
        const textBreakdown = detallesCobranza.map(d => `- ${d.CodArticulo}: ${d.Cantidad} x ${d.PrecioUnitario} = ${d.Subtotal} (${d.LogPrecioAplicado})`).join('\n');

        logger.info(`\n======================================================\n[ERPSync] DESGLOSE DE PRECIOS CALCULADOS PARA ${noDocERP}\n${textBreakdown}\n======================================================\n`);

        logger.info(`[ERPSync] React Code ($*): ${reactCode}`);

        // 6. Escribir en OrdenesDeposito directamente (migrado de API React)
        // IMPORTANTE: skipDeposito=true cuando se llama desde el ingreso de órdenes (no desde el depósito)
        // OrdenesDeposito solo debe ser escrito durante el Check-In del WMS.
        let reactSuccess = false;
        if (skipDeposito) {
            logger.info(`[ERPSync] SKIP OrdenesDeposito (skipDeposito=true — solo se escribe en PedidosCobranza).`);
            reactSuccess = true;
        } else if (!syncTarget || syncTarget === 'REACT') {
            if (options.isReactEnabledGlobal === false) {
                logger.info(`[ERPSync] BYPASS REACT por configuración global (Desactivado).`);
                reactSuccess = true;
            } else {
                // Resolver el string QR para parsear
                let ordenString = forcedReactPayload;
                if (typeof forcedReactPayload === 'object' && forcedReactPayload?.ordenString) {
                    ordenString = forcedReactPayload.ordenString;
                } else if (!forcedReactPayload) {
                    ordenString = reactCode;
                }

                logger.info(`[ERPSync] --> INSERTANDO EN OrdenesDeposito directamente...`, ordenString);

                try {
                    // Parsear el string QR: $CodigoOrden$*CodigoCliente$*NombreTrabajo$*IdModo$*IdProducto$*Cantidad$*CostoFinal
                    const parts = ordenString.split('$*');
                    let CodigoOrden = (parts[0] || '').trim();
                    // IMPORTANTE: Remover el $ del inicio para guardar en OrdenesDeposito
                    if(CodigoOrden.startsWith('$')) CodigoOrden = CodigoOrden.substring(1);

                    const CodigoCliente = parseInt(parts[1]) || 0;
                    const NombreTrabajo = parts[2] || '';
                    const IdModo = parseInt(parts[3]) || 1;
                    const IdProducto = parseInt(parts[4]) || 0;
                    const cantidadDecimal = parseFloat((parts[5] || '0').toString().replace(',', '.'));
                    const costoFinalDecimal = parseFloat((parts[6] || '0').toString().replace(',', '.'));

                    // Verificar si la orden ya existe
                    const existCheck = await pool.request()
                        .input('Cod', sql.VarChar(100), CodigoOrden)
                        .query('SELECT OrdIdOrden, OrdEstadoActual, OReIdOrdenRetiro FROM OrdenesDeposito WITH(NOLOCK) WHERE OrdCodigoOrden = @Cod');

                    if (existCheck.recordset.length > 0) {
                        const existing = existCheck.recordset[0];

                        // Si NO tiene orden de retiro, actualizar datos
                        if (!existing.OReIdOrdenRetiro) {
                            await pool.request()
                                .input('Cod', sql.VarChar(100), CodigoOrden)
                                .input('Cli', sql.Int, CodigoCliente)
                                .input('Trab', sql.VarChar(255), NombreTrabajo)
                                .input('Modo', sql.Int, IdModo)
                                .input('Prod', sql.Int, IdProducto)
                                .input('Cant', sql.Float, cantidadDecimal)
                                .input('Costo', sql.Float, costoFinalDecimal)
                                .input('Usr', sql.Int, userId)
                                .query(`
                                    UPDATE OrdenesDeposito SET
                                        CliIdCliente = @Cli, OrdNombreTrabajo = @Trab, MOrIdModoOrden = @Modo,
                                        ProIdProducto = @Prod, OrdCantidad = @Cant, OrdCostoFinal = @Costo,
                                        OrdFechaEstadoActual = GETDATE(), OrdUsuarioAlta = @Usr
                                    WHERE OrdCodigoOrden = @Cod
                                `);
                            logger.info(`[ERPSync] Orden existente actualizada: ${CodigoOrden}`);
                        } else {
                            // Tiene orden de retiro, verificar si fue entregada para re-ingresar
                            const retiroCheck = await pool.request()
                                .input('RID', sql.Int, existing.OReIdOrdenRetiro)
                                .query('SELECT OReEstadoActual, OReFechaEstadoActual FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @RID');

                            if (retiroCheck.recordset.length > 0 && retiroCheck.recordset[0].OReEstadoActual === 5) {
                                // Re-ingresar la orden
                                await pool.request()
                                    .input('Cod', sql.VarChar(100), CodigoOrden)
                                    .query('UPDATE OrdenesDeposito SET OrdEstadoActual = 1, OrdFechaEstadoActual = GETDATE() WHERE OrdCodigoOrden = @Cod');

                                await pool.request()
                                    .input('OID', sql.Int, existing.OrdIdOrden)
                                    .input('Usr', sql.Int, userId)
                                    .query(`INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@OID, 1, GETDATE(), @Usr)`);

                                logger.info(`[ERPSync] Orden re-ingresada: ${CodigoOrden}`);
                            } else {
                                logger.info(`[ERPSync] Orden ${CodigoOrden} ya existe con retiro activo, omitiendo.`);
                            }
                        }
                    } else {
                        // Orden nueva: INSERT
                        // Resolver MonIdMoneda del producto
                        const prodRes = await pool.request()
                            .input('PID', sql.Int, IdProducto)
                            .query('SELECT ISNULL(MonIdMoneda, 1) as MonIdMoneda FROM Articulos WITH(NOLOCK) WHERE IDProdReact = @PID OR ProIdProducto = @PID');
                        const monedaId = prodRes.recordset[0]?.MonIdMoneda || 1;

                        // Resolver LugarRetiro del cliente
                        const cliRes = await pool.request()
                            .input('CID', sql.Int, CodigoCliente)
                            .query('SELECT FormaEnvioID FROM Clientes WITH(NOLOCK) WHERE CliIdCliente = @CID');
                        const lugarRetiro = cliRes.recordset[0]?.FormaEnvioID ? parseInt(cliRes.recordset[0].FormaEnvioID) : null;

                        const insertResult = await pool.request()
                            .input('Cod', sql.VarChar(100), CodigoOrden)
                            .input('Cant', sql.Float, cantidadDecimal)
                            .input('Cli', sql.Int, CodigoCliente)
                            .input('Trab', sql.VarChar(255), NombreTrabajo)
                            .input('Modo', sql.Int, IdModo)
                            .input('Prod', sql.Int, IdProducto)
                            .input('Mon', sql.Int, monedaId)
                            .input('Costo', sql.Float, costoFinalDecimal)
                            .input('Usr', sql.Int, userId)
                            .input('Lugar', sql.Int, lugarRetiro)
                            .query(`
                                INSERT INTO OrdenesDeposito (
                                    OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo,
                                    MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal,
                                    OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual, LReIdLugarRetiro
                                )
                                OUTPUT INSERTED.OrdIdOrden
                                VALUES (
                                    @Cod, @Cant, @Cli, @Trab, @Modo, @Prod, @Mon, @Costo,
                                    GETDATE(), @Usr, 1, GETDATE(), @Lugar
                                )
                            `);

                        const newOrderId = insertResult.recordset[0]?.OrdIdOrden;
                        if (newOrderId) {
                            await pool.request()
                                .input('OID', sql.Int, newOrderId)
                                .input('Usr', sql.Int, userId)
                                .query(`INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@OID, 1, GETDATE(), @Usr)`);
                        }
                        logger.info(`[ERPSync] Orden nueva creada: ${CodigoOrden} (ID: ${newOrderId})`);
                    }

                    reactSuccess = true;
                } catch (eReact) {
                    logger.error(`[ERPSync] Error al insertar en OrdenesDeposito:`, eReact.message);
                }
            }
        } else {
            logger.info(`[ERPSync] Omite REACT por filtro de target: ${syncTarget}`);
        }

        // 7. Enviar a ERP (Dev Macrosoft)
        let erpSuccess = false;
        let erpPayload = forcedErpPayload || null;

        if (!syncTarget || syncTarget === 'ERP') {
            if (options.isErpEnabledGlobal === false) {
                logger.info(`[ERPSync] BYPASS ERP por configuración global (Desactivado).`);
                erpSuccess = true;
            } else {
                logger.info(`[ERPSync] Iniciando envío selectivo a ERP para ${noDocERP}${forcedErpPayload ? ' (USANDO PAYLOAD FORZADO)' : ''}`);
                try {
                    const erpToken = await this.getMacrosoftToken();
                    if (erpToken) {
                        if (!erpPayload) {
                            // Agrupar por CodArticulo
                            const lineasAgrupadas = {};
                            detallesCobranza.forEach(d => {
                                const cod = (d.CodArticulo || 'VAR').toString().trim();
                                lineasAgrupadas[cod] = (lineasAgrupadas[cod] || 0) + parseFloat(d.Cantidad);
                            });

                            erpPayload = {
                                CodCliente: first.CodCliente ? first.CodCliente.toString() : "100101",
                                Documento: "11",
                                Lineas: Object.entries(lineasAgrupadas).map(([cod, qty]) => ({ CodArticulo: cod, Cantidad: qty.toString() }))
                            };
                        }

                        const erpRes = await axios.post('https://api-user.devmacrosoft.com/pedido', erpPayload, {
                            headers: { 'Authorization': `Bearer ${erpToken}`, 'Content-Type': 'application/json' }
                        });

                        logger.info(`[ERPSync] <-- RESPUESTA ERP Macrosoft: Status ${erpRes.status}`, erpRes.data);

                        if ((erpRes.status === 200 || erpRes.status === 201) && erpRes.data?.success !== false && !erpRes.data?.error) {
                            erpSuccess = true;
                            logger.info(`[ERPSync] OK ERP Macrosoft para ${noDocERP}`);
                        } else {
                            throw new Error(erpRes.data?.error || erpRes.data?.message || JSON.stringify(erpRes.data));
                        }
                    }
                } catch (eErp) {
                    logger.error(`[ERPSync] Error al enviar a ERP Macrosoft:`, eErp.message);
                }
            } // Fin if/else desactivado global
        } else {
            logger.info(`[ERPSync] Omite ERP por filtro de target: ${syncTarget}`);
        }

        // 8. Marcar Órdenes como Sincronizadas
        // Ya no se actualizan columnas obsoletas en Ordenes, el estado "Enviado_OK" de PedidosCobranza es la fuente de verdad.

        return {
            success: (syncTarget === 'REACT' ? reactSuccess : (syncTarget === 'ERP' ? erpSuccess : (reactSuccess && erpSuccess))),
            totalPriceSum,
            reactSuccess,
            erpSuccess,
            reactCode
        };
    }

    static async updatePedidosCobranza(pool, noDocERP, codCliente, totalGeneral, targetCurrency, detalles, userNotes = '', qrData = null) {
        const textBreakdown = detalles.map(d => `- ${d.CodArticulo}: ${d.Cantidad} x ${d.PrecioUnitario} = ${d.Subtotal} (${d.LogPrecioAplicado})`).join('\n');
        const perfilesUnicos = [...new Set(detalles.map(d => d.Perfiles).filter(p => p && p !== 'Precio Base'))].join(', ') || null;

        const chk = await pool.request().input('Doc', sql.NVarChar, noDocERP.trim()).query("SELECT ID FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = @Doc");
        let id;

        if (chk.recordset.length > 0) {
            id = chk.recordset[0].ID;
            await pool.request()
                .input('ID', sql.Int, id)
                .input('M', sql.Decimal(18, 2), totalGeneral)
                .input('Mon', sql.VarChar, targetCurrency)
                .input('QRP', sql.NVarChar, qrData ? qrData.qrPedido : null)
                .input('QRC', sql.NVarChar, qrData ? qrData.qrCliente : null)
                .input('QRT', sql.NVarChar, qrData ? qrData.qrTrabajo : null)
                .input('QRU', sql.NVarChar, qrData ? qrData.qrUrgencia : null)
                .input('QRPr', sql.NVarChar, qrData ? qrData.qrProducto : null)
                .input('QRCa', sql.NVarChar, qrData && qrData.qrCantidad != null ? String(qrData.qrCantidad) : null)
                .input('QRI', sql.NVarChar, qrData && qrData.qrImporte != null ? String(qrData.qrImporte) : null)
                .input('QRS', sql.NVarChar(sql.MAX), qrData ? qrData.qrString : null)
                .input('DC', sql.NVarChar(sql.MAX), textBreakdown)
                .input('PP', sql.NVarChar(sql.MAX), perfilesUnicos)
                .query(`UPDATE PedidosCobranza SET 
                    MontoTotal = @M, Moneda = @Mon, FechaGeneracion = GETDATE(),
                    QR_Pedido = @QRP, QR_Cliente = @QRC, QR_Trabajo = @QRT, 
                    QR_Urgencia = @QRU, QR_Producto = @QRPr, QR_Cantidad = @QRCa, 
                    QR_Importe = @QRI, QR_String = @QRS, DetalleCostos = @DC, PerfilesPrecio = @PP
                    WHERE ID = @ID`);
            await pool.request().input('PID', sql.Int, id).query("DELETE FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID");
        } else {
            const ins = await pool.request()
                .input('Doc', sql.NVarChar, noDocERP.trim())
                .input('Cli', sql.Int, codCliente || 0)
                .input('M', sql.Decimal(18, 2), totalGeneral)
                .input('Mon', sql.VarChar, targetCurrency)
                .input('QRP', sql.NVarChar, qrData ? qrData.qrPedido : null)
                .input('QRC', sql.NVarChar, qrData ? qrData.qrCliente : null)
                .input('QRT', sql.NVarChar, qrData ? qrData.qrTrabajo : null)
                .input('QRU', sql.NVarChar, qrData ? qrData.qrUrgencia : null)
                .input('QRPr', sql.NVarChar, qrData ? qrData.qrProducto : null)
                .input('QRCa', sql.NVarChar, qrData && qrData.qrCantidad != null ? String(qrData.qrCantidad) : null)
                .input('QRI', sql.NVarChar, qrData && qrData.qrImporte != null ? String(qrData.qrImporte) : null)
                .input('QRS', sql.NVarChar(sql.MAX), qrData ? qrData.qrString : null)
                                .input('DC', sql.NVarChar(sql.MAX), textBreakdown)
                                .input('PP', sql.NVarChar(sql.MAX), perfilesUnicos)
                                .query(`INSERT INTO PedidosCobranza 
                    (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, QR_Pedido, QR_Cliente, QR_Trabajo, QR_Urgencia, QR_Producto, QR_Cantidad, QR_Importe, QR_String, DetalleCostos, PerfilesPrecio) 
                    OUTPUT INSERTED.ID 
                    VALUES (@Doc, @Cli, @M, @Mon, GETDATE(), @QRP, @QRC, @QRT, @QRU, @QRPr, @QRCa, @QRI, @QRS, @DC, @PP)`);
            id = ins.recordset[0].ID;
        }

        for (const d of detalles) {
            try {
                // Sanitizar valores que pueden venir undefined/null y romper el tipo de dato SQL
                const monOrig = (d.MonedaOriginal || targetCurrency || 'UYU').toString().substring(0, 10);
                const puOrig  = parseFloat(d.PrecioUnitarioOriginal) || 0;
                const stOrig  = parseFloat(d.SubtotalOriginal)       || 0;
                const logStr  = (d.LogPrecioAplicado || 'Sin detalle').toString();
                const codArt  = (d.CodArticulo || '').toString().trim(); // NOT NULL en DB
                const prodId  = d.ProIdProducto ? parseInt(d.ProIdProducto) : null;
                const cant    = parseFloat(d.Cantidad)      || 0;
                const pu      = parseFloat(d.PrecioUnitario) || 0;
                const st      = parseFloat(d.Subtotal)       || 0;

                await pool.request()
                    .input('Pid',    sql.Int,              id)
                    .input('OID',    sql.Int,              d.OrdenID)
                    .input('CodArt', sql.NVarChar(50),     codArt)
                    .input('ProdID', sql.Int,              prodId)
                    .input('Cant',   sql.Decimal(18, 2),   cant)
                    .input('PU',     sql.Decimal(18, 2),   pu)
                    .input('ST',     sql.Decimal(18, 2),   st)
                    .input('Log',    sql.NVarChar(sql.MAX), logStr)
                    .input('Mon',    sql.VarChar(10),       targetCurrency)
                    .input('Perfil', sql.NVarChar(sql.MAX), d.Perfiles || null)
                    .input('Trace',  sql.NVarChar(sql.MAX), logStr)
                    .input('MonOrig',sql.VarChar(10),       monOrig)
                    .input('PUOrig', sql.Decimal(18, 4),    puOrig)
                    .input('STOrig', sql.Decimal(18, 4),    stOrig)
                    .query("INSERT INTO PedidosCobranzaDetalle (PedidoCobranzaID, OrdenID, CodArticulo, ProIdProducto, Cantidad, PrecioUnitario, Subtotal, LogPrecioAplicado, Moneda, PerfilAplicado, PricingTrace, MonedaOriginal, PrecioUnitarioOriginal, SubtotalOriginal) VALUES (@Pid, @OID, @CodArt, @ProdID, @Cant, @PU, @ST, @Log, @Mon, @Perfil, @Trace, @MonOrig, @PUOrig, @STOrig)");
            } catch (eRow) {
                logger.error(`[ERPSync] ❌ Error insertando detalle cobranza para OrdenID=${d.OrdenID}: ${eRow?.message || eRow}`);
            }
        }

    }

    // getExternalToken removido - ya no se necesita, se escribe directo en DB

    static async getMacrosoftToken() {
        try {
            const res = await axios.post('https://api-user.devmacrosoft.com/authenticate', { username: "user", password: "1234" });
            return res.data?.token || res.data?.accessToken;
        } catch (e) { return null; }
    }

    /**
     * Legacy: Sincroniza magnitudes solamente.
     */
    static async syncOrderToERP(noDocERP) {
        // Redirigir al nuevo flujo robusto si se desea una sync completa
        return this.syncFinalOrderIntegration(noDocERP);
    }
}

module.exports = ERPSyncService;
