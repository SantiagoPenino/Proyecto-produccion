const axios = require('axios');
const { sql, getPool } = require('../config/db');
const PricingService = require('./pricingService');

class ERPSyncService {

    /**
     * Sincroniza la "cotización" y el envío a los sistemas ERP y REACT.
     * Este es el nuevo "punto logístico" robusto solicitado.
     */
    static async syncFinalOrderIntegration(noDocERP, userId = 1, userName = 'Sistema', bultoCode = null, options = {}) {
        const { onlyCalculate = false, userNotes = '', priceOverride = null, quantityOverride = null, profileOverride = null, syncTarget = null, forcedReactPayload = null, forcedErpPayload = null } = options;
        if (!noDocERP) throw new Error("NoDocERP es requerido para la sincronización.");

        const pool = await getPool();
        console.log(`[ERPSync] Iniciando integración final para NoDocERP: ${noDocERP}${bultoCode ? ' (Bulto: ' + bultoCode + ')' : ''}`);

        // 1. Obtener todas las órdenes del documento
        const orderRes = await pool.request()
            .input('Doc', sql.NVarChar, noDocERP.toString())
            .query(`
                SELECT O.*, PB.Moneda as MonedaBase, A.Descripcion as NombreArticulo, A.IDProdReact as ArtIdReact
                FROM Ordenes O
                LEFT JOIN PreciosBase PB ON LTRIM(RTRIM(O.CodArticulo)) = LTRIM(RTRIM(PB.CodArticulo))
                LEFT JOIN Articulos A ON LTRIM(RTRIM(O.CodArticulo)) = LTRIM(RTRIM(A.CodArticulo))
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

        // 3. Cálculo de Precios (Lógica movida desde LabelGenerationService)
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
                let internalClientId = sib.CodCliente || null;

                // Perfiles Extra (Urgencia, Tinta)
                const extraProfiles = profileOverride ? [parseInt(profileOverride)] : [];
                if (extraProfiles.length === 0) {
                    if (sib.Prioridad && sib.Prioridad.toString().trim().toLowerCase().includes('urgente')) extraProfiles.push(2);
                    if (sib.Tinta && (sib.Tinta.toUpperCase().includes('UV') || sib.Tinta.toUpperCase().includes('LATEX'))) extraProfiles.push(3);
                }

                // Variables Técnicas
                const vars = {
                    puntadas: sib.Puntadas || 0,
                    bajadas: sib.Bajadas || 0,
                    bajadasAdicionales: sib.BajadasAdicionales || 0
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

                if (priceOverride !== null && !isNaN(parseFloat(priceOverride))) {
                    costoCalculado = parseFloat(priceOverride);
                    precioUnitario = effectiveQty > 0 ? costoCalculado / effectiveQty : costoCalculado;
                    textLog = "Precio Ajustado Manualmente";
                    console.log(`[ERPSync] Aplicando Precio Override: ${costoCalculado}`);
                } else {
                    const priceResult = await PricingService.calculatePrice(
                        sib.CodArticulo || '',
                        effectiveQty || 1,
                        internalClientId,
                        extraProfiles,
                        vars,
                        targetCurrency,
                        null,
                        sib.AreaID
                    );
                    costoCalculado = priceResult.precioTotal || 0;
                    precioUnitario = priceResult.precioUnitario || 0;
                    textLog = priceResult.txt;
                }

                // Actualizar Costo y Observaciones en Orden
                await pool.request()
                    .input('Cost', sql.Decimal(18, 2), costoCalculado)
                    .input('Obs', sql.NVarChar(sql.MAX), userNotes)
                    .input('OID', sql.Int, sib.OrdenID)
                    .query("UPDATE Ordenes SET CostoTotal = @Cost, Observaciones = CASE WHEN @Obs <> '' THEN @Obs ELSE Observaciones END WHERE OrdenID = @OID");

                totalPriceSum += costoCalculado;

                detallesCobranza.push({
                    OrdenID: sib.OrdenID,
                    CodArticulo: sib.CodArticulo,
                    Cantidad: effectiveQty,
                    PrecioUnitario: precioUnitario,
                    Subtotal: costoCalculado,
                    LogPrecioAplicado: textLog
                });

                // --- SERVICIOS EXTRA ---
                const srvRes = await pool.request()
                    .input('OID', sql.Int, sib.OrdenID)
                    .query("SELECT * FROM ServiciosExtraOrden WHERE OrdenID = @OID");

                for (const srv of srvRes.recordset) {
                    const srvVars = { puntadas: srv.Puntadas || 0, bajadas: srv.Bajadas || 0, bajadasAdicionales: srv.BajadasAdicionales || 0 };
                    let srvQty = srv.Cantidad || 1;
                    if (['110', '113'].includes(srv.CodArt?.trim())) {
                        srvQty = (srv.Cantidad || 1) * (srv.Bajadas || 1) + (srv.BajadasAdicionales || 0);
                    }

                    const srvPriceRes = await PricingService.calculatePrice(srv.CodArt || '', srvQty, internalClientId, extraProfiles, srvVars, targetCurrency, null, sib.AreaID);
                    const srvCostoTotal = srvPriceRes.precioTotal || 0;
                    totalPriceSum += srvCostoTotal;

                    detallesCobranza.push({
                        OrdenID: sib.OrdenID,
                        CodArticulo: srv.CodArt,
                        Cantidad: srvQty,
                        PrecioUnitario: srvPriceRes.precioUnitario || 0,
                        Subtotal: srvCostoTotal,
                        LogPrecioAplicado: srvPriceRes.txt
                    });

                    // Update Servicio en DB
                    await pool.request()
                        .input('PU', sql.Decimal(18, 2), srvPriceRes.precioUnitario || 0)
                        .input('TL', sql.Decimal(18, 2), srvCostoTotal)
                        .input('SID', sql.Int, srv.ServicioID)
                        .query("UPDATE ServiciosExtraOrden SET PrecioUnitario = @PU, TotalLinea = @TL WHERE ServicioID = @SID");
                }

            } catch (errCalc) {
                console.error(`[ERPSync] Error calculando precio para Orden ${sib.OrdenID}:`, errCalc.message);
            }
        }

        // 4. Actualizar PedidosCobranza (Local)
        await this.updatePedidosCobranza(pool, noDocERP, siblings[0].CodCliente, totalPriceSum, targetCurrency, detallesCobranza, userNotes);

        // 5. Preparar Envío a REACT (Formato QR Exacto con $*)
        // $[Bulto/Pedido]$*Cliente$*Trabajo$*Urgencia$*Producto$*Cantidad$*Importe
        const first = siblings[0];
        const rawCode = bultoCode || (first.CodigoOrden?.split('(')[0]?.trim() || first.CodigoOrden);
        const qrPedido = `$${rawCode}`; // Código con signo de pesos prefijado
        const qrCliente = first.IdClienteReact || '0';
        const qrTrabajo = (first.DescripcionTrabajo || '').trim();
        const qrUrgencia = (first.Prioridad && (first.Prioridad.toLowerCase().includes('urgente') || first.Prioridad.toLowerCase().includes('alta'))) ? '2' : '1';

        // CORRECCIÓN: Usar IDProdReact del artículo si existe, sino fallback a genérico
        const qrProducto = first.ArtIdReact || first.IdProductoReact || (targetCurrency === 'USD' ? '150' : '82');

        const qrCantidad = totalMagnitudeSum || '1';
        const qrImporte = totalPriceSum.toFixed(2);

        const SEP = '$*';
        const reactCode = `${qrPedido}${SEP}${qrCliente}${SEP}${qrTrabajo}${SEP}${qrUrgencia}${SEP}${qrProducto}${SEP}${qrCantidad}${SEP}${qrImporte}`;

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

        console.log(`\n======================================================\n[ERPSync] DESGLOSE DE PRECIOS CALCULADOS PARA ${noDocERP}\n${textBreakdown}\n======================================================\n`);

        await pool.request()
            .input('Break', sql.NVarChar(sql.MAX), textBreakdown)
            .input('OID', sql.Int, siblings[0].OrdenID)
            .query("UPDATE Etiquetas SET DetalleCostos = @Break WHERE OrdenID = @OID");

        console.log(`[ERPSync] React Code ($*): ${reactCode}`);

        // 6. Escribir en OrdenesDeposito directamente (migrado de API React)
        let reactSuccess = false;
        if (!syncTarget || syncTarget === 'REACT') {
            if (options.isReactEnabledGlobal === false) {
                console.log(`[ERPSync] BYPASS REACT por configuración global (Desactivado).`);
                reactSuccess = true;
                await pool.request()
                    .input('N', sql.VarChar, noDocERP.toString())
                    .input('D', sql.NVarChar(sql.MAX), JSON.stringify({ bypassed: true }))
                    .query("UPDATE PedidosCobranza SET EstadoSyncReact = 'Enviado_OK', ObsReact = @D WHERE NoDocERP = @N");
            } else {
                // Resolver el string QR para parsear
                let ordenString = forcedReactPayload;
                if (typeof forcedReactPayload === 'object' && forcedReactPayload?.ordenString) {
                    ordenString = forcedReactPayload.ordenString;
                } else if (!forcedReactPayload) {
                    ordenString = reactCode;
                }

                console.log(`[ERPSync] --> INSERTANDO EN OrdenesDeposito directamente...`, ordenString);

                try {
                    // Parsear el string QR: $CodigoOrden$*CodigoCliente$*NombreTrabajo$*IdModo$*IdProducto$*Cantidad$*CostoFinal
                    const parts = ordenString.split('$*');
                    const CodigoOrden = parts[0] || '';
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
                            console.log(`[ERPSync] Orden existente actualizada: ${CodigoOrden}`);
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

                                console.log(`[ERPSync] Orden re-ingresada: ${CodigoOrden}`);
                            } else {
                                console.log(`[ERPSync] Orden ${CodigoOrden} ya existe con retiro activo, omitiendo.`);
                            }
                        }
                    } else {
                        // Orden nueva: INSERT
                        // Resolver MonIdMoneda del producto
                        const prodRes = await pool.request()
                            .input('PID', sql.Int, IdProducto)
                            .query('SELECT MonIdMoneda FROM Productos WITH(NOLOCK) WHERE ProIdProducto = @PID');
                        const monedaId = prodRes.recordset[0]?.MonIdMoneda || 1;

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
                            .query(`
                                INSERT INTO OrdenesDeposito (
                                    OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo,
                                    MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal,
                                    OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual
                                )
                                OUTPUT INSERTED.OrdIdOrden
                                VALUES (
                                    @Cod, @Cant, @Cli, @Trab, @Modo, @Prod, @Mon, @Costo,
                                    GETDATE(), @Usr, 1, GETDATE()
                                )
                            `);

                        const newOrderId = insertResult.recordset[0]?.OrdIdOrden;
                        if (newOrderId) {
                            await pool.request()
                                .input('OID', sql.Int, newOrderId)
                                .input('Usr', sql.Int, userId)
                                .query(`INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) VALUES (@OID, 1, GETDATE(), @Usr)`);
                        }
                        console.log(`[ERPSync] Orden nueva creada: ${CodigoOrden} (ID: ${newOrderId})`);
                    }

                    reactSuccess = true;
                    await pool.request()
                        .input('Doc', sql.NVarChar, noDocERP)
                        .input('P', sql.NVarChar(sql.MAX), JSON.stringify({ ordenString, direct: true }))
                        .query("UPDATE PedidosCobranza SET EstadoSyncReact = 'Enviado_OK', ObsReact = @P WHERE NoDocERP = @Doc");

                } catch (eReact) {
                    console.error(`[ERPSync] Error al insertar en OrdenesDeposito:`, eReact.message);
                    await pool.request()
                        .input('Doc', sql.NVarChar, noDocERP)
                        .input('E', sql.NVarChar(sql.MAX), JSON.stringify({ error: eReact.message }))
                        .query("UPDATE PedidosCobranza SET EstadoSyncReact = 'Error', ObsReact = @E WHERE NoDocERP = @Doc");
                }
            }
        } else {
            console.log(`[ERPSync] Omite REACT por filtro de target: ${syncTarget}`);
            const current = await pool.request().input('Doc', sql.NVarChar, noDocERP).query("SELECT EstadoSyncReact FROM PedidosCobranza WHERE NoDocERP = @Doc");
            if (current.recordset[0]?.EstadoSyncReact === 'Enviado_OK') reactSuccess = true;
        }

        // 7. Enviar a ERP (Dev Macrosoft)
        let erpSuccess = false;
        let erpPayload = forcedErpPayload || null;

        if (!syncTarget || syncTarget === 'ERP') {
            if (options.isErpEnabledGlobal === false) {
                console.log(`[ERPSync] BYPASS ERP por configuración global (Desactivado).`);
                erpSuccess = true;
                const pool = await getPool();
                await pool.request()
                    .input('N', sql.VarChar, noDocERP.toString())
                    .input('D', sql.NVarChar(sql.MAX), JSON.stringify({ bypassed: true }))
                    .query("UPDATE PedidosCobranza SET EstadoSyncERP = 'Enviado_OK', ObsERP = @D WHERE NoDocERP = @N");
            } else {
                console.log(`[ERPSync] Iniciando envío selectivo a ERP para ${noDocERP}${forcedErpPayload ? ' (USANDO PAYLOAD FORZADO)' : ''}`);
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

                        console.log(`[ERPSync] <-- RESPUESTA ERP Macrosoft: Status ${erpRes.status}`, erpRes.data);

                        if ((erpRes.status === 200 || erpRes.status === 201) && erpRes.data?.success !== false && !erpRes.data?.error) {
                            erpSuccess = true;
                            console.log(`[ERPSync] OK ERP Macrosoft para ${noDocERP}`);
                            await pool.request()
                                .input('Doc', sql.NVarChar, noDocERP)
                                .input('P', sql.NVarChar(sql.MAX), JSON.stringify(erpPayload))
                                .query("UPDATE PedidosCobranza SET EstadoSyncERP = 'Enviado_OK', ObsERP = @P WHERE NoDocERP = @Doc");
                        } else {
                            throw new Error(erpRes.data?.error || erpRes.data?.message || JSON.stringify(erpRes.data));
                        }
                    }
                } catch (eErp) {
                    const errLog = eErp.response?.data || { error: eErp.message };
                    console.error(`[ERPSync] Error al enviar a ERP Macrosoft:`, eErp.message);
                    await pool.request()
                        .input('Doc', sql.NVarChar, noDocERP)
                        .input('E', sql.NVarChar(sql.MAX), JSON.stringify(errLog))
                        .query("UPDATE PedidosCobranza SET EstadoSyncERP = 'Error', ObsERP = @E WHERE NoDocERP = @Doc");
                }
            } // Fin if/else desactivado global
        } else {
            console.log(`[ERPSync] Omite ERP por filtro de target: ${syncTarget}`);
            const current = await pool.request().input('Doc', sql.NVarChar, noDocERP).query("SELECT EstadoSyncERP FROM PedidosCobranza WHERE NoDocERP = @Doc");
            if (current.recordset[0]?.EstadoSyncERP === 'Enviado_OK') erpSuccess = true;
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

    static async updatePedidosCobranza(pool, noDocERP, codCliente, totalGeneral, targetCurrency, detalles, userNotes = '') {
        const chk = await pool.request().input('Doc', sql.NVarChar, noDocERP.trim()).query("SELECT ID FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = @Doc");
        let id;
        const obsFinal = userNotes ? `LOGISTICA: ${userNotes}` : 'GENERADO DESDE WMS';

        if (chk.recordset.length > 0) {
            id = chk.recordset[0].ID;
            await pool.request()
                .input('ID', sql.Int, id)
                .input('M', sql.Decimal(18, 2), totalGeneral)
                .input('Mon', sql.VarChar, targetCurrency)
                .input('Obs', sql.NVarChar, obsFinal)
                .query("UPDATE PedidosCobranza SET MontoTotal = @M, Moneda = @Mon, FechaGeneracion = GETDATE(), ObsERP = @Obs WHERE ID = @ID");
            await pool.request().input('PID', sql.Int, id).query("DELETE FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID");
        } else {
            const ins = await pool.request()
                .input('Doc', sql.NVarChar, noDocERP.trim())
                .input('Cli', sql.Int, codCliente || 0)
                .input('M', sql.Decimal(18, 2), totalGeneral)
                .input('Mon', sql.VarChar, targetCurrency)
                .input('Obs', sql.NVarChar, obsFinal)
                .query("INSERT INTO PedidosCobranza (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, ObsERP) OUTPUT INSERTED.ID VALUES (@Doc, @Cli, @M, @Mon, GETDATE(), @Obs)");
            id = ins.recordset[0].ID;
        }

        for (const d of detalles) {
            await pool.request().input('Pid', sql.Int, id).input('OID', sql.Int, d.OrdenID).input('Cod', sql.NVarChar, d.CodArticulo).input('Cant', sql.Decimal(18, 2), d.Cantidad).input('PU', sql.Decimal(18, 2), d.PrecioUnitario).input('ST', sql.Decimal(18, 2), d.Subtotal).input('Log', sql.NVarChar, d.LogPrecioAplicado).query("INSERT INTO PedidosCobranzaDetalle (PedidoCobranzaID, OrdenID, CodArticulo, Cantidad, PrecioUnitario, Subtotal, LogPrecioAplicado) VALUES (@Pid, @OID, @Cod, @Cant, @PU, @ST, @Log)");
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
