const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

class PricingService {

    static async getExchangeRate(pool) {
        try {
            const res = await pool.request().query("SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'TIPO_CAMBIO_USD'");
            if (res.recordset.length > 0) return parseFloat(res.recordset[0].Valor) || 40.0;
        } catch (e) {
            logger.error("Error al obtener TIPO_CAMBIO_USD:", e.message);
        }
        return 40.0; // Fallback
    }

    static async getGlobalConfigs(pool) {
        try {
            const res = await pool.request().query("SELECT Clave, Valor FROM ConfiguracionGlobal");
            const configs = {};
            res.recordset.forEach(r => { configs[r.Clave] = r.Valor; });
            return configs;
        } catch (e) {
            logger.error("Error al obtener configuracion global:", e.message);
            return {};
        }
    }

    static async getPriceConfigs(pool) {
        try {
            const res = await pool.request().query("SELECT Clave, Valor FROM ConfiguracionPrecios");
            const configs = {};
            res.recordset.forEach(r => { configs[r.Clave] = r.Valor; });
            return configs;
        } catch (e) {
            logger.error("Error al obtener configuracion de precios:", e.message);
            return {};
        }
    }

    /**
     * Calcula el precio final de un artículo para un cliente dado.
     */
    static async calculatePrice(prodDescriptor, cantidad = 1, clientDescriptor = null, extraProfileIds = [], variables = {}, targetCurrency = 'UYU', exchangeRate = null, areaId = null, datoTecnicoValue = null) {
        const pool = await getPool();
        const globalConfigs = await PricingService.getGlobalConfigs(pool);
        const priceConfigs = await PricingService.getPriceConfigs(pool);

        let targetReq = targetCurrency ? targetCurrency.trim().toUpperCase() : 'UYU';
        let actualExchangeRate = exchangeRate || parseFloat(globalConfigs['TIPO_CAMBIO_USD']) || 40.0;
        
        // Destructurar Descriptores (Soporte mixto)
        const proIdProducto = typeof prodDescriptor === 'object' ? prodDescriptor.proIdProducto : null;
        const rawCodArt = typeof prodDescriptor === 'object' ? prodDescriptor.codArticulo : prodDescriptor;
        const cleanCod = rawCodArt ? String(rawCodArt).trim() : null;

        const cliIdCliente = typeof clientDescriptor === 'object' && clientDescriptor !== null ? clientDescriptor.cliIdCliente : null;
        const rawClientLegacy = typeof clientDescriptor === 'object' && clientDescriptor !== null ? clientDescriptor.clienteLegacy : clientDescriptor;

        const breakdown = [];

        // 1. Obtencion AreaID y Grupo si no vienen dados
        let resolvedAreaId = areaId ? areaId.toString().trim().toUpperCase() : null;
        let resolvedGrupo = null;
        let resolvedProId = proIdProducto;
        
        if ((resolvedProId && resolvedProId > 0) || cleanCod) {
            try {
                const reqArea = pool.request();
                let queryArea = '';

                if (resolvedProId && resolvedProId > 0) {
                    reqArea.input('ProId', sql.Int, resolvedProId);
                    queryArea = `
                        SELECT TOP 1 ProIdProducto,
                            (SELECT TOP 1 AreaID FROM Ordenes WHERE ProIdProducto = @ProId) as AreaID,
                            Grupo
                        FROM Articulos 
                        WHERE ProIdProducto = @ProId
                    `;
                } else {
                    reqArea.input('CodSearch', sql.VarChar(50), String(cleanCod).trim());
                    queryArea = `
                        SELECT TOP 1 ProIdProducto,
                            (SELECT TOP 1 AreaID FROM Ordenes WHERE ProIdProducto = Articulos.ProIdProducto) as AreaID,
                            Grupo
                        FROM Articulos 
                        WHERE LTRIM(RTRIM(CodArticulo)) = @CodSearch
                    `;
                }
                
                const areaGrupoRes = await reqArea.query(queryArea);
                if (areaGrupoRes.recordset.length > 0) {
                    if (!resolvedProId) resolvedProId = areaGrupoRes.recordset[0].ProIdProducto;
                    if (!resolvedAreaId) resolvedAreaId = areaGrupoRes.recordset[0].AreaID?.toString().trim().toUpperCase();
                    resolvedGrupo = areaGrupoRes.recordset[0].Grupo?.toString();
                }
            } catch (e) {
                logger.warn("[PricingService] Error fetching AreaID/Grupo for " + (resolvedProId || cleanCod));
            }
        }

        // --- DETERMINAR VOLUMEN PARA REGLAS (Puntadas/Bajadas vs Cantidad) ---
        const areasBordado = (globalConfigs['AREAS_BORDADO_PUNTADAS'] || 'BOR,EMB').split(',').map(s => s.trim().toUpperCase());
        const areasEstampado = (globalConfigs['AREAS_CALCULO_BAJADAS'] || 'EST,ESTAMPADO').split(',').map(s => s.trim().toUpperCase());
        
        const isTechnicalArea = areasBordado.includes(resolvedAreaId) || areasEstampado.includes(resolvedAreaId);
        // Si es área técnica y tenemos dato técnico, ese manda para la escala de precios
        const volumeForRules = (isTechnicalArea && parseFloat(datoTecnicoValue) > 0) ? parseFloat(datoTecnicoValue) : cantidad;

        // 2. Obtener Precio Base de la DB (Priorizando ProIdProducto ya resuelto)
        const baseRes = await pool.request()
            .input('ProId', sql.Int, resolvedProId || -1)
            .input('Currency', sql.NVarChar, targetReq)
            .query(`
                SELECT Precio, CASE WHEN MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END as Moneda 
                FROM PreciosBase 
                WHERE (ProIdProducto = @ProId AND @ProId > 0)
                ORDER BY CASE WHEN (CASE WHEN MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END) = @Currency THEN 1 WHEN MonIdMoneda = 2 THEN 2 ELSE 3 END
            `);

        let precioBase = 0;
        let monedaBaseOriginal = 'UYU';

        if (baseRes.recordset.length > 0) {
            monedaBaseOriginal = baseRes.recordset[0].Moneda || 'UYU';
            precioBase = baseRes.recordset[0].Precio;
        }

        // Determinar moneda limpia final (Si es AUTO usa la original de la base de datos)
        const cleanCurrency = targetReq === 'AUTO' ? monedaBaseOriginal.toUpperCase() : targetReq;

        // Helper para homogenizar monedas
        const toTarget = (amount, fromCurrency) => {
            const cFrom = (fromCurrency || 'UYU').toString().trim().toUpperCase();
            const cTo = cleanCurrency;
            if (cFrom === cTo) return parseFloat(amount);
            if (cFrom === 'USD' && cTo === 'UYU') return parseFloat(amount) * actualExchangeRate;
            if (cFrom === 'UYU' && cTo === 'USD') return parseFloat(amount) / actualExchangeRate;
            return parseFloat(amount);
        };

        // --- ESPECIAL: TARIFA BORDADO POR PUNTADAS (Hardcoded Logic) ---
        const isBordadoByDesc = variables._desc && variables._desc.toLowerCase().includes('bordado');

        if (areasBordado.includes(resolvedAreaId) || cleanCod === '109' || isBordadoByDesc) {
            const baseStitches = parseFloat(priceConfigs['BOR_PUNTADAS_BASE']) || 5000;
            const basePriceStitchesUYU = parseFloat(priceConfigs['BOR_PRECIO_BASE_UYU']) || 50;
            const stepStitches = parseFloat(priceConfigs['BOR_PUNTADAS_INTERVALO']) || 1000;
            const stepPriceUYU = parseFloat(priceConfigs['BOR_PRECIO_INTERVALO_UYU']) || 10;
            
            // Usar el datoTecnicoValue si viene, sino fallback a variables.puntadas
            const totalPuntadas = parseFloat(datoTecnicoValue) || variables.puntadas || 0;

            let priceBordadoUYU = basePriceStitchesUYU;
            if (totalPuntadas > baseStitches) {
                const extra = totalPuntadas - baseStitches;
                const steps = Math.ceil(extra / stepStitches);
                priceBordadoUYU += steps * stepPriceUYU;
            }

            precioBase = toTarget(priceBordadoUYU, 'UYU');
            monedaBaseOriginal = 'UYU';
            breakdown.push({ tipo: 'OVERRIDE', valor: precioBase, desc: `Bordado por Puntadas (${totalPuntadas} p.)` });
        }
        else if (baseRes.recordset.length > 0) {
            monedaBaseOriginal = baseRes.recordset[0].Moneda || 'UYU';
            const precioRaw = baseRes.recordset[0].Precio;
            precioBase = toTarget(precioRaw, monedaBaseOriginal);
            breakdown.push({ tipo: 'BASE', valor: precioBase, originalVal: precioRaw, orgCur: monedaBaseOriginal, desc: 'Precio de Lista' });
        } else {
            breakdown.push({ tipo: 'WARN', valor: 0, desc: 'Producto sin precio base definido' });
        }

        let nuevoPrecioBase = precioBase;

        // --- ESPECIAL: CÁLCULO DINÁMICO ESTAMPADO POR BAJADAS ---
        const areasCalculoBajadas = (globalConfigs['AREAS_CALCULO_BAJADAS'] || 'EST,COR,DF').split(',').map(s => s.trim().toUpperCase());
        const isEstampadoByDesc = variables._desc && variables._desc.toLowerCase().includes('estampado');

        if (areasCalculoBajadas.includes(resolvedAreaId) || ['110', '113'].includes(cleanCod) || isEstampadoByDesc) {
            const umbralBajadas = parseFloat(priceConfigs['EST_UMBRAL_BAJADAS']) || 10;
            const cargoFijoUYU = parseFloat(priceConfigs['EST_CARGO_FIJO_UYU']) || 150;
            const precioBajadaUYU = parseFloat(priceConfigs['EST_PRECIO_BAJADA_UYU']) || 15;
            
            // Dato técnico representa bajadas por prenda
            const bajadasPorPrenda = parseFloat(datoTecnicoValue) || variables.bajadas || 0;
            const totalBajadas = bajadasPorPrenda * cantidad;

            if (totalBajadas > 0) {
                let precioTotalUYU = 0;
                let descRegla = '';

                if (totalBajadas < umbralBajadas) {
                    precioTotalUYU = cargoFijoUYU;
                    descRegla = `Cargo Fijo Estampado (< ${umbralBajadas} bajadas)`;
                } else {
                    precioTotalUYU = totalBajadas * precioBajadaUYU;
                    descRegla = `Costo por Bajadas (${totalBajadas} b.)`;
                }

                // El motor espera el precio unitario, así que dividimos el total calculado entre la cantidad de prendas
                const unitPriceUYU = precioTotalUYU / cantidad;
                nuevoPrecioBase = toTarget(unitPriceUYU, 'UYU');
                
                // Sobrescribimos el tipo de regla para que reemplace el base
                breakdown.push({ tipo: 'OVERRIDE', valor: nuevoPrecioBase, desc: descRegla });
            }
        }

        // 3. Obtener Reglas Aplicables
        const idUrgencia = parseInt(globalConfigs['ID_PERFIL_URGENCIA']) || 2;
        let injectedUrgencia = false;
        if (variables.isUrgente) {
             if (!extraProfileIds.includes(idUrgencia)) {
                  extraProfileIds.push(idUrgencia);
                  injectedUrgencia = true;
             }
        }
        const cleanedProfiles = extraProfileIds.map(Number).filter(n => !isNaN(n));

        // Recuperar IDs de Clientes (Mix Legacy/New)
        const validPidLegacy = parseInt(rawClientLegacy) || 0;
        let possibleClientIds = [];
        
        if (cliIdCliente) {
            possibleClientIds.push(cliIdCliente);
        }
        if (validPidLegacy > 0) {
            possibleClientIds.push(validPidLegacy);
            try {
                const idRes = await pool.request().input('c', sql.Int, validPidLegacy).query('SELECT CodCliente, CliIdCliente FROM Clientes WHERE CliIdCliente = @c OR CodCliente = @c');
                if (idRes.recordset.length > 0) {
                    possibleClientIds.push(idRes.recordset[0].CodCliente);
                    possibleClientIds.push(idRes.recordset[0].CliIdCliente);
                }
            } catch (e) {
                logger.warn("[PricingService] Error fetching dual Client IDs: " + e.message);
            }
        }
        possibleClientIds = [...new Set(possibleClientIds.filter(Boolean))];

        let resolvedCategoria = resolvedAreaId;
        if (resolvedAreaId === 'DF') resolvedCategoria = 'DTF';
        if (resolvedAreaId === 'EST') resolvedCategoria = 'Estampados';

        const rulesRes = await pool.request()
            .input('ProId', sql.Int, resolvedProId || -1)
            .input('CleanCod', sql.VarChar, cleanCod || '')
            .input('Qty', sql.Decimal(18, 2), volumeForRules) // <--- USAMOS EL VOLUMEN TÉCNICO SI APLICA
            .input('ResolvedGrupo', sql.VarChar, resolvedGrupo)
            .input('ResolvedAreaId', sql.VarChar, resolvedAreaId || '')
            .input('ResolvedCategoria', sql.VarChar, resolvedCategoria || '')
            .query(`
                -- Reglas por Perfil (Cliente, Globales y Extras)
                SELECT DISTINCT PI.ID as PerfilItemID, PI.PerfilID, PI.ProIdProducto, PI.CodGrupo, PI.CodArticulo, PI.Valor, CASE WHEN PI.MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END AS Moneda, PI.TipoRegla, PI.CantidadMinima, 
                       PP.Nombre as NombrePerfil, CASE WHEN PI.CodGrupo IS NOT NULL THEN 1 ELSE 0 END as PrioridadPerfil
                FROM PerfilesItems PI
                INNER JOIN PerfilesPrecios PP ON PI.PerfilID = PP.ID
                LEFT JOIN PreciosEspeciales PE ON (
                    PP.ID = PE.PerfilID OR 
                    EXISTS (SELECT 1 FROM STRING_SPLIT(CAST(PE.PerfilesIDs AS VARCHAR(MAX)), ',') WHERE value = CAST(PP.ID AS VARCHAR(10)))
                )
                WHERE (PE.CliIdCliente IN (${possibleClientIds.length > 0 ? possibleClientIds.join(',') : '0'})
                       OR (PP.EsGlobal = 1 AND (ISNULL(PP.Categoria, 'Todos') = 'Todos' OR PP.Categoria = '' OR PP.Categoria = @ResolvedAreaId OR PP.Categoria = @ResolvedCategoria))
                       OR PP.ID IN (${cleanedProfiles.length > 0 ? cleanedProfiles.join(',') : '0'}))
                -- Filtro de volumen
                  AND (PI.CantidadMinima <= @Qty OR PI.CantidadMinima = 1)
                  AND (
                       (PI.ProIdProducto = @ProId AND @ProId > 0)
                       OR (LTRIM(RTRIM(PI.CodArticulo)) = @CleanCod AND @CleanCod <> '')
                       OR (PI.CodGrupo = @ResolvedGrupo AND @ResolvedGrupo IS NOT NULL)
                       OR (ISNULL(PI.ProIdProducto, 0) = 0 AND (NULLIF(LTRIM(RTRIM(PI.CodArticulo)), '') IS NULL OR LTRIM(RTRIM(PI.CodArticulo)) = 'TOTAL') AND NULLIF(LTRIM(RTRIM(PI.CodGrupo)), '') IS NULL)
                  )
                
                UNION ALL

                -- Reglas Directas (Excepciones) por Cliente
                SELECT ItemID as PerfilItemID, PEI.CliIdCliente as PerfilID, PEI.ProIdProducto, PEI.CodGrupo, PEI.CodArticulo, PEI.Valor, CASE WHEN PEI.MonIdMoneda = 1 THEN 'UYU' ELSE 'USD' END AS Moneda, PEI.TipoRegla, PEI.MinCantidad as CantidadMinima, 
                       'Excepción Cliente' as NombrePerfil, CASE WHEN PEI.CodGrupo IS NOT NULL THEN 998 ELSE 999 END as PrioridadPerfil
                FROM PreciosEspecialesItems PEI
                WHERE (PEI.CliIdCliente IN (${possibleClientIds.length > 0 ? possibleClientIds.join(',') : '0'}))
                  AND (PEI.MinCantidad <= @Qty OR PEI.MinCantidad = 1)
                  AND (
                       (PEI.ProIdProducto = @ProId AND @ProId > 0)
                       OR (LTRIM(RTRIM(PEI.CodArticulo)) = @CleanCod AND @CleanCod <> '')
                       OR (PEI.CodGrupo = @ResolvedGrupo AND @ResolvedGrupo IS NOT NULL)
                       OR (ISNULL(PEI.ProIdProducto, 0) = 0 AND (NULLIF(LTRIM(RTRIM(PEI.CodArticulo)), '') IS NULL OR LTRIM(RTRIM(PEI.CodArticulo)) = 'TOTAL') AND NULLIF(LTRIM(RTRIM(PEI.CodGrupo)), '') IS NULL)
                  )
                
                ORDER BY PrioridadPerfil DESC, CantidadMinima DESC
            `);

        // Filtro: Mejor regla por PerfilID
        const todasLasReglas = rulesRes.recordset;
        let traceDecision = `\n--- ANALISIS DE PRECIOS PARA ${cleanCod} (Cant: ${cantidad}) ---\n`;
        traceDecision += `Perfiles Activos: ${(extraProfileIds || []).join(',')} | Area: ${resolvedAreaId}\n`;
        if (typeof injectedUrgencia !== 'undefined' && injectedUrgencia) {
            traceDecision += `[INFO] Modo URGENTE Activado (Inyectando Perfil ID ${idUrgencia} a la evaluación)\n`;
        }
        traceDecision += `Reglas encontradas en BD: ${todasLasReglas.length}\n`;
        todasLasReglas.forEach(r => {
            traceDecision += `  - Encontrada: [${r.NombrePerfil}] Tipo: ${r.TipoRegla} | Art: ${r.CodArticulo} | Val: ${r.Valor} | MinQty: ${r.CantidadMinima}\n`;
        });

        const reglasFinales = [];
        const grouped = {};
        todasLasReglas.forEach(r => {
            if (!grouped[r.PerfilID]) grouped[r.PerfilID] = [];
            grouped[r.PerfilID].push(r);
        });
        Object.values(grouped).forEach(rules => {
            rules.sort((a, b) => {
                const aExact = (a.CodArticulo || '').toString().trim() === cleanCod ? 1 : 0;
                const bExact = (b.CodArticulo || '').toString().trim() === cleanCod ? 1 : 0;
                if (aExact !== bExact) return bExact - aExact;
                return (b.CantidadMinima || 0) - (a.CantidadMinima || 0);
            });
            reglasFinales.push(rules[0]);
            traceDecision += `  > GANADORA para Perfil ${rules[0].NombrePerfil}: Art=${rules[0].CodArticulo} [Min=${rules[0].CantidadMinima}] (Se descartan las demás del mismo perfil si las hubiera)\n`;
        });
        traceDecision += `\n* Fase Competencia (Desc vs Precio Fijo):\n`;

        // 4. Competencia: Descuento vs Precio Fijo
        const discountRules = reglasFinales.filter(r => r.TipoRegla.includes('discount') || r.TipoRegla === 'percentage' || r.TipoRegla === 'subtract');
        let optionA_Price = nuevoPrecioBase;
        let optionA_DiscVal = 0;
        let bestDisc = null;

        discountRules.forEach(r => {
            let val = 0;
            if (r.TipoRegla.includes('percentage') || r.TipoRegla === 'percentage') val = nuevoPrecioBase * (parseFloat(r.Valor) / 100);
            else val = toTarget(r.Valor, r.Moneda);
            traceDecision += `  - Opción Desc Evaluada [${r.NombrePerfil}]: Ahorro de ${val.toFixed(2)}\n`;
            if (val > optionA_DiscVal) { optionA_DiscVal = val; bestDisc = r; }
        });
        if (bestDisc) traceDecision += `  -> MEJOR DESCUENTO: [${bestDisc.NombrePerfil}] Ahorra ${optionA_DiscVal.toFixed(2)}\n`;
        optionA_Price = Math.max(0, nuevoPrecioBase - optionA_DiscVal);

        const fixedRules = reglasFinales.filter(r => r.TipoRegla === 'fixed' || r.TipoRegla === 'fixed_price');
        let optionB_Price = Infinity;
        let bestFixed = null;
        fixedRules.forEach(r => {
            let val = toTarget(r.Valor, r.Moneda);
            traceDecision += `  - Opción Fija Evaluada [${r.NombrePerfil}]: Queda en ${val.toFixed(2)}\n`;
            if (val < optionB_Price) { optionB_Price = val; bestFixed = r; }
        });
        if (bestFixed) traceDecision += `  -> MEJOR PRECIO FIJO: [${bestFixed.NombrePerfil}] Queda en ${optionB_Price.toFixed(2)}\n`;

        let precioFinalBase = optionA_Price;
        let discFinalVal = optionA_DiscVal;
        let appliedFixed = false;

        // Guardia: un precio fijo de 0 solo aplica si es una Excepción Cliente explícita.
        // Reglas de perfiles globales con Valor=0 son plantillas vacías, no deben ganar.
        const fixedIsValid = bestFixed && (optionB_Price > 0 || bestFixed.NombrePerfil === 'Excepción Cliente');

        if (fixedIsValid && optionB_Price < optionA_Price) {
            traceDecision += `  => RESULTADO COMPETENCIA: GANA PRECIO FIJO porque (${optionB_Price.toFixed(2)}) es mejor (más bajo) que aplicar dto (${optionA_Price.toFixed(2)})\n`;
            precioFinalBase = optionB_Price;
            discFinalVal = 0;
            appliedFixed = true;
            breakdown.push({ tipo: 'OVERRIDE', valor: precioFinalBase, desc: `Precio Fijo [${bestFixed.NombrePerfil}]`, profileId: bestFixed.PerfilID });
        } else if (bestDisc) {
            traceDecision += `  => RESULTADO COMPETENCIA: GANA DESCUENTO porque (${optionA_Price.toFixed(2)}) es mejor o igual a precio fijo.\n`;
            breakdown.push({
                tipo: 'DISCOUNT',
                valor: -discFinalVal,
                desc: `Desc. ${Math.round(parseFloat(bestDisc.Valor))}${bestDisc.TipoRegla.includes('percentage') ? '%' : ''} [${bestDisc.NombrePerfil}]`,
                profileId: bestDisc.PerfilID
            });
        }

        traceDecision += `\n* Fase Recargos (Acumulativos):\n`;
        // 5. Recargos (Acumulativos)
        // REGLA: Si el precio ya quedó en 0 por un descuento total (ej: Reposición 100%),
        // no se aplica ningún recargo. 0 es 0.
        let surchargeRules = reglasFinales.filter(r => r.TipoRegla.includes('surcharge'));
        const areasNoUrg = (globalConfigs['AREAS_SIN_URGENCIA'] || 'BOR,EMB,COR,TWC,COS,TWT').split(',').map(s => s.trim().toUpperCase());
        if (areasNoUrg.includes(resolvedAreaId)) {
            surchargeRules = surchargeRules.filter(r => r.PerfilID !== idUrgencia && r.NombrePerfil?.toLowerCase() !== 'urgente');
        }

        let totalRecargos = 0;
        if (precioFinalBase <= 0) {
            traceDecision += `  Recargos omitidos: precio ya es 0 (descuento total aplicado).\n`;
        } else {
            surchargeRules.forEach(r => {
                let val = r.TipoRegla.includes('percentage') ? nuevoPrecioBase * (parseFloat(r.Valor) / 100) : toTarget(r.Valor, r.Moneda);
                traceDecision += `  - SUMA RECARGO [${r.NombrePerfil}]: +${val.toFixed(2)}\n`;
                totalRecargos += val;
                breakdown.push({ tipo: 'SURCHARGE', valor: val, desc: `Recargo ${r.TipoRegla.includes('percentage') ? r.Valor + '%' : ''} [${r.NombrePerfil}]`, profileId: r.PerfilID });
            });
        }

        const finalPU = precioFinalBase + totalRecargos;
        traceDecision += `\n= PRECIO FINAL CALCULADO: ${finalPU.toFixed(2)}\n`;
        logger.info(traceDecision);

        // --- Generar resumen textual ---
        let txt = `Base: ${cleanCurrency} ${precioBase.toFixed(2)}`;
        breakdown.forEach(b => {
            // Si el breakdown es un override, informamos que la base cambió
            if (b.tipo === 'OVERRIDE') {
                txt += `\nOverride: ${cleanCurrency} ${b.valor.toFixed(2)} (${b.desc})`;
            } else if (b.tipo === 'DISCOUNT') {
                txt += `\nDescuento: -${cleanCurrency} ${Math.abs(b.valor).toFixed(2)} (${b.desc})`;
            } else if (b.tipo === 'SURCHARGE') {
                txt += `\nRecargo: +${cleanCurrency} ${Math.abs(b.valor).toFixed(2)} (${b.desc})`;
            }
        });
        txt += `\nTotal Unit.: ${cleanCurrency} ${finalPU.toFixed(2)}`;

        // --- Recopilar Nombres de Perfiles SÓLO los que aplicaron ---
        const appliedSet = new Set();
        if (appliedFixed && bestFixed) appliedSet.add(bestFixed.NombrePerfil);
        else if (bestDisc) appliedSet.add(bestDisc.NombrePerfil);

        surchargeRules.forEach(r => appliedSet.add(r.NombrePerfil));

        // --- Calcular precio en moneda original para trazabilidad ---
        let precioOriginalUnitario = finalPU;
        if (monedaBaseOriginal !== cleanCurrency) {
            if (monedaBaseOriginal === 'UYU' && cleanCurrency === 'USD') precioOriginalUnitario = finalPU * actualExchangeRate;
            if (monedaBaseOriginal === 'USD' && cleanCurrency === 'UYU') precioOriginalUnitario = finalPU / actualExchangeRate;
        }

        return {
            codArticulo: cleanCod,
            proIdProducto: resolvedProId || null,
            cantidad,
            precioUnitario: finalPU,
            precioTotal: finalPU * cantidad,
            moneda: cleanCurrency,
            monedaOriginal: monedaBaseOriginal,
            precioUnitarioOriginal: precioOriginalUnitario,
            precioTotalOriginal: precioOriginalUnitario * cantidad,
            breakdown,
            txt,
            perfilesAplicados: [...appliedSet].filter(Boolean),
            _debug: { resolvedAreaId, cleanCod, cleanCurrency }
        };
    }

    static async setBasePrice(codArticulo, precio, moneda = 'UYU') {
        const pool = await getPool();
        await pool.request()
            .input('Cod', sql.NVarChar, codArticulo.trim())
            .input('Pre', sql.Decimal(18, 4), precio)
            .input('MonIdMoneda', sql.Int, moneda.toUpperCase() === 'USD' ? 2 : 1)
            .query(`
                MERGE PreciosBase AS target
                USING (SELECT @Cod AS CodArticulo, @MonIdMoneda AS MonIdMoneda) AS source
                ON (target.CodArticulo = source.CodArticulo AND target.MonIdMoneda = source.MonIdMoneda)
                WHEN MATCHED THEN UPDATE SET Precio = @Pre, UltimaActualizacion = GETDATE()
                WHEN NOT MATCHED THEN INSERT (CodArticulo, Precio, MonIdMoneda, UltimaActualizacion) VALUES (@Cod, @Pre, @MonIdMoneda, GETDATE());
            `);
    }
}

module.exports = PricingService;
