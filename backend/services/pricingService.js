const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// Etiqueta que ve el cliente por perfil (PerfilesPrecios.EtiquetaFactura). Se lee una vez por
// minuto; si la columna todavía no existe (script add_EtiquetaFactura_PerfilesPrecios.sql sin
// correr) se sigue con el nombre interno del perfil.
let _etiquetasPerfilesCache = { ts: 0, map: {} };

// Redondeo a 4 decimales (precisión de PreciosBase y de las columnas del desglose).
const r4 = n => Math.round((Number(n || 0) + Number.EPSILON) * 10000) / 10000;

// % para textos: entero si es entero, si no con hasta 2 decimales (36.36, no "36").
const fmtPct = v => {
    const n = Number(v || 0);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

// Franjas de bordado del pedido de la usuaria (23/10/2026), si ConfiguracionPrecios no tiene
// BOR_FRANJAS_PUNTADAS: hasta 4.000 puntadas $ 70, hasta 8.000 $ 110, hasta 12.000 $ 160, hasta 18.000 $ 220
const FRANJAS_BORDADO_DEFECTO = '4000:70,8000:110,12000:160,18000:220';

class PricingService {

    static async getEtiquetasPerfiles(pool) {
        if (Date.now() - _etiquetasPerfilesCache.ts < 60000) return _etiquetasPerfilesCache.map;
        const map = {};
        try {
            const res = await pool.request().query("SELECT ID, Nombre, EtiquetaFactura FROM PerfilesPrecios WITH(NOLOCK)");
            res.recordset.forEach(p => {
                map[p.ID] = { nombre: (p.Nombre || '').trim(), etiqueta: (p.EtiquetaFactura || '').trim() || null };
            });
        } catch (e) {
            try {
                const res = await pool.request().query("SELECT ID, Nombre FROM PerfilesPrecios WITH(NOLOCK)");
                res.recordset.forEach(p => { map[p.ID] = { nombre: (p.Nombre || '').trim(), etiqueta: null }; });
            } catch (e2) { /* sin etiquetas */ }
        }
        _etiquetasPerfilesCache = { ts: Date.now(), map };
        return map;
    }

    /**
     * Desglose de una línea cuyo precio se fijó A MANO (override del pedido, edición en la
     * cotización o en caja). Toma la lista del desglose de referencia del motor y expresa la
     * diferencia como descuento MANUAL (si el precio manual es menor) o recargo manual (si es
     * mayor), así la línea sigue cumpliendo lista − descuento + recargo = neto.
     */
    static desgloseManual(desgloseRef, netoManual, texto = 'Precio ajustado manualmente') {
        const lista = desgloseRef && desgloseRef.precioLista > 0 ? r4(desgloseRef.precioLista) : null;
        const neto = r4(netoManual);
        if (lista == null) {
            // Sin lista real (sin catálogo, base 0): el precio tipeado es su propia lista, sin
            // descuento ni recargo (antes quedaba lista 0 + recargo manual por el total).
            return {
                moneda: desgloseRef ? desgloseRef.moneda : null, precioLista: neto > 0 ? neto : null, listaSinOverride: null, override: null,
                candidatos: (desgloseRef && desgloseRef.candidatos) || [], manual: true, listaManual: true, precioNeto: neto, precioNetoConPrepago: neto, prepago: null,
                descuento: null, recargos: [], recargoPct: null, recargoImporte: null, recargoTexto: null
            };
        }
        const diff = r4(lista - neto);
        const base = {
            moneda: desgloseRef.moneda,
            precioLista: lista,
            listaSinOverride: desgloseRef.listaSinOverride,
            override: desgloseRef.override || null,
            candidatos: desgloseRef.candidatos || [],
            manual: true,
            precioNeto: neto,
            precioNetoConPrepago: neto,
            prepago: null
        };
        if (diff >= 0) {
            return {
                ...base,
                descuento: diff > 0 ? { tipo: 'MANUAL', pct: null, importeUnitario: diff, origen: 'MANUAL', perfilId: null, reglaId: null, nombre: texto, etiqueta: 'Ajuste manual', texto } : null,
                recargos: [], recargoPct: null, recargoImporte: null, recargoTexto: null
            };
        }
        return {
            ...base,
            descuento: null,
            recargos: [{ pct: null, importeUnitario: r4(-diff), origen: 'MANUAL', perfilId: null, reglaId: null, nombre: texto, etiqueta: 'Ajuste manual' }],
            recargoPct: null, recargoImporte: r4(-diff), recargoTexto: 'Ajuste manual'
        };
    }

    /**
     * Desglose de una línea SIN CARGO (reposición -R/-F, falla): lista del motor y descuento del
     * 100 % con su origen, para que quede registrado cuánto valía lo que se regaló.
     */
    static desgloseSinCargo(desgloseRef, origen = 'REPOSICION', texto = 'Reposición sin cargo') {
        const lista = desgloseRef && desgloseRef.precioLista != null ? r4(desgloseRef.precioLista) : null;
        if (lista == null) return null;
        return {
            moneda: desgloseRef.moneda,
            precioLista: lista,
            listaSinOverride: desgloseRef.listaSinOverride,
            override: desgloseRef.override || null,
            candidatos: desgloseRef.candidatos || [],
            descuento: { tipo: 'PCT', pct: 100, importeUnitario: lista, origen, perfilId: null, reglaId: null, nombre: texto, etiqueta: texto, texto },
            recargos: [], recargoPct: null, recargoImporte: null, recargoTexto: null,
            precioNeto: 0, precioNetoConPrepago: 0, prepago: null, sinCargo: true
        };
    }

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
        // Bloque base — si esto falla no hay nada que hacer
        let configs = {};
        try {
            const res = await pool.request().query("SELECT Clave, Valor FROM ConfiguracionGlobal");
            res.recordset.forEach(r => { configs[r.Clave] = r.Valor; });
        } catch (e) {
            logger.error("Error al obtener configuracion global:", e.message);
            return {};
        }

        // Bloque de urgencia — aislado: un fallo aquí NO borra los configs base
        try {
            const urgId = parseInt(configs['ID_PERFIL_URGENCIA']) || 2;
            const urgRes = await pool.request()
                .input('urgId', sql.Int, urgId)
                .query("SELECT Categoria FROM PerfilesPrecios WHERE ID = @urgId AND Activo = 1");
            const urgCategoria = urgRes.recordset[0]?.Categoria || 'Todos';
            configs['_URGENCIA_CATEGORIA'] = urgCategoria;

            if (urgCategoria && urgCategoria !== 'Todos') {
                const urgCats = urgCategoria.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                const areasRes = await pool.request().query(`
                    SELECT DISTINCT
                        LTRIM(RTRIM(AreaID_Interno))            AS CodArea,
                        LTRIM(RTRIM(UPPER(NombreReferencia)))   AS AreaNombre
                    FROM dbo.ConfigMapeoERP WITH(NOLOCK)
                    WHERE AreaID_Interno IS NOT NULL AND LTRIM(RTRIM(AreaID_Interno)) <> ''
                `);
                // Acepta CodArea ('SB') o AreaNombre trimmeado ('SUBLIMACION') guardado por el chip
                const codAreas = areasRes.recordset
                    .filter(r => urgCats.includes(r.CodArea) || urgCats.includes(r.AreaNombre))
                    .map(r => r.CodArea);
                configs['_URGENCIA_CODAREA_SET'] = codAreas.join(',');
            } else {
                configs['_URGENCIA_CODAREA_SET'] = '';
            }
        } catch (e) {
            logger.error("Error al resolver CodAreas del perfil de urgencia:", e.message);
            // Fallback: sin filtro por área específica → usa AREAS_SIN_URGENCIA
            configs['_URGENCIA_CODAREA_SET'] = '';
            configs['_URGENCIA_CATEGORIA'] = 'Todos';
        }

        return configs;
    }

    /**
     * Franjas de la tarifa de bordado (23/10/2026), de menor a mayor: [{ hasta, precio }].
     * Clave BOR_FRANJAS_PUNTADAS de ConfiguracionPrecios, "hasta:precio" separados por coma
     * ("4000:70,8000:110,12000:160,18000:220"); si falta o no se entiende, las del pedido de la usuaria.
     */
    static franjasBordado(priceConfigs) {
        const leer = (texto) => String(texto || '').split(',')
            .map(par => par.split(':').map(x => parseFloat(String(x).trim())))
            .filter(([hasta, precio]) => Number.isFinite(hasta) && hasta > 0 && Number.isFinite(precio) && precio >= 0)
            .map(([hasta, precio]) => ({ hasta, precio }))
            .sort((a, b) => a.hasta - b.hasta);
        const guardadas = leer(priceConfigs?.BOR_FRANJAS_PUNTADAS);
        return guardadas.length > 0 ? guardadas : leer(FRANJAS_BORDADO_DEFECTO);
    }

    /**
     * Tarifa de bordado por puntadas, POR BORDADO y en pesos. Desde el 23/10/2026, POR FRANJAS
     * (franjasBordado): el bordado paga el precio de la primera franja que lo contiene ("hasta 4.000
     * puntadas $ 70"). Por encima de la última franja: su precio + BOR_PRECIO_CADA_1000_EXCEDENTE_UYU
     * cada BOR_PUNTADAS_INTERVALO puntadas o fracción de más — PROVISORIO hasta que la usuaria defina ese
     * caso; si falta la clave, sigue la misma suba que la última franja (de 12.000 a 18.000 suben $ 60:
     * $ 10 cada 1.000). Sin puntadas, $ 0 (como antes). Antes (19/10): $ 8 cada 1.000 hasta 10.000 y $ 6
     * cada 1.000 de ahí en más (BOR_PRECIO_CADA_1000_UYU / _TRAMO2_UYU, ya no se usan). La usan el motor
     * (calculatePrice), Precios por cantidad y Precios Estándar (tarifasCobro.js repite la cuenta).
     */
    static tarifaBordado(priceConfigs, puntadas) {
        const num = (clave, def) => { const v = parseFloat(priceConfigs?.[clave]); return Number.isFinite(v) && v >= 0 ? v : def; };
        const intervalo = num('BOR_PUNTADAS_INTERVALO', 1000) || 1000;
        const franjas = PricingService.franjasBordado(priceConfigs);
        const ultima = franjas[franjas.length - 1];
        const anterior = franjas.length > 1 ? franjas[franjas.length - 2] : { hasta: 0, precio: 0 };
        const subaUltima = r4((ultima.precio - anterior.precio) / (ultima.hasta - anterior.hasta) * intervalo);
        const precioExcedente = num('BOR_PRECIO_CADA_1000_EXCEDENTE_UYU', Math.max(0, subaUltima));
        const p = Math.max(0, Number(puntadas) || 0);
        const franja = p > 0 ? franjas.find(f => p <= f.hasta) || null : null;
        const bloquesExcedente = p > ultima.hasta ? Math.ceil((p - ultima.hasta) / intervalo) : 0;
        const precioUYU = p <= 0 ? 0 : franja ? franja.precio : ultima.precio + bloquesExcedente * precioExcedente;
        return { puntadas: p, intervalo, franjas, franja, precioExcedente, bloquesExcedente, precioUYU: r4(precioUYU) };
    }

    /**
     * Tarifa de estampado por bajadas, POR TRABAJO y en pesos: si el trabajo tiene menos de
     * EST_UMBRAL_BAJADAS bajadas en total (bajadas por prenda × prendas) se cobra el cargo fijo
     * EST_CARGO_FIJO_UYU; desde ahí, EST_PRECIO_BAJADA_UYU por bajada. La usan el motor y las tablas
     * de Precios por cantidad y Precios Estándar.
     */
    static tarifaEstampado(priceConfigs, totalBajadas) {
        const umbral = parseFloat(priceConfigs?.EST_UMBRAL_BAJADAS) || 10;
        const cargoFijo = parseFloat(priceConfigs?.EST_CARGO_FIJO_UYU) || 150;
        const precioBajada = parseFloat(priceConfigs?.EST_PRECIO_BAJADA_UYU) || 15;
        const b = Math.max(0, Number(totalBajadas) || 0);
        const conCargoFijo = b < umbral;
        return { umbral, cargoFijo, precioBajada, bajadas: b, conCargoFijo, totalUYU: r4(conCargoFijo ? cargoFijo : b * precioBajada) };
    }

    /**
     * Qué de bordado NO se cobra por puntadas (los cargos, con su precio de lista) y la regla de la
     * matriz sin cargo (guía de Emblemas: "realizando 10 bordados el costo de la matriz va de regalo").
     */
    static configBordado(priceConfigs) {
        const cargos = String(priceConfigs?.BOR_CARGOS_CON_LISTA ?? '1568,1631,1632').split(',').map(s => s.trim()).filter(Boolean);
        const gratis = parseFloat(priceConfigs?.BOR_MATRIZ_GRATIS_DESDE);
        // [23/10/2026] Mínimo de bordados por diseño (guía de Emblemas: 5). 0 = sin mínimo.
        const minimo = parseInt(priceConfigs?.BOR_MINIMO_BORDADOS, 10);
        return {
            cargos: new Set(cargos),
            codMatriz: String(priceConfigs?.BOR_COD_MATRIZ ?? '1568').trim(),
            matrizGratisDesde: Number.isFinite(gratis) ? gratis : 10,
            minimoBordados: Number.isFinite(minimo) && minimo >= 0 ? minimo : 5,
        };
    }

    // Cuántos bordados lleva la orden, para la matriz sin cargo: lo que mande quien llama
    // (variables.cantidadBordados, el sync) o, con variables.ordenId (modal de cotización), las piezas
    // de los diseños de bordado de la orden (ArchivosOrden.Piezas) y, si no hay, su Magnitud.
    static async cantidadBordados(pool, variables) {
        if (variables.cantidadBordados != null && Number.isFinite(Number(variables.cantidadBordados))) return Number(variables.cantidadBordados);
        if (!variables.ordenId) return null;
        try {
            const id = String(variables.ordenId).trim();
            const num = parseInt(id, 10);
            const req = pool.request();
            let cond;
            if (!isNaN(num) && String(num) === id) { req.input('oid', sql.Int, num); cond = 'o.OrdenID = @oid'; }
            else { req.input('cod', sql.VarChar(50), id); cond = 'LTRIM(RTRIM(o.CodigoOrden)) = @cod'; }
            const r = await req.query(`
                SELECT TOP 1
                    (SELECT ISNULL(SUM(ISNULL(a.Piezas, 0)), 0) FROM dbo.ArchivosOrden a WITH(NOLOCK)
                      WHERE a.OrdenID = o.OrdenID AND a.TipoArchivo = 'BORDADO' AND ISNULL(a.EstadoArchivo, '') <> 'CANCELADO') AS Piezas,
                    TRY_CAST(REPLACE(LTRIM(RTRIM(o.Magnitud)), ',', '.') AS DECIMAL(18, 2)) AS Magnitud
                FROM dbo.Ordenes o WITH(NOLOCK) WHERE ${cond}`);
            const f = r.recordset[0];
            if (!f) return null;
            return Number(f.Piezas) > 0 ? Number(f.Piezas) : (Number(f.Magnitud) || null);
        } catch (e) {
            logger.warn('[PricingService] No se pudo leer cuántos bordados lleva la orden ' + variables.ordenId + ': ' + e.message);
            return null;
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
        // Tarifa técnica que REEMPLAZA la lista (bordado por puntadas, estampado por bajadas):
        // para el desglose, esa tarifa ES el precio de lista.
        let overrideTecnico = null;

        // 1. Obtencion AreaID y Grupo si no vienen dados
        let resolvedAreaId = areaId ? areaId.toString().trim().toUpperCase() : null;
        let resolvedGrupo = null;
        let resolvedCodStock = null;
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
                            Grupo, LTRIM(RTRIM(CodStock)) AS CodStock
                        FROM Articulos
                        WHERE ProIdProducto = @ProId
                    `;
                } else {
                    // El CodArticulo NO es único (ej. '28' = Back pet y Rib 1,70). Sin ORDER BY
                    // salía cualquiera y se cotizaba con el precio de otro artículo (EUV-30014).
                    // Se prefiere el activo y visible; si hay más de uno queda avisado en el log
                    // — quien llama debería mandar el ProIdProducto.
                    reqArea.input('CodSearch', sql.VarChar(50), String(cleanCod).trim());
                    queryArea = `
                        SELECT TOP 1 ProIdProducto,
                            (SELECT TOP 1 AreaID FROM Ordenes WHERE ProIdProducto = Articulos.ProIdProducto) as AreaID,
                            Grupo, LTRIM(RTRIM(CodStock)) AS CodStock,
                            (SELECT COUNT(*) FROM Articulos A2 WHERE LTRIM(RTRIM(A2.CodArticulo)) = @CodSearch) AS Candidatos
                        FROM Articulos
                        WHERE LTRIM(RTRIM(CodArticulo)) = @CodSearch
                        ORDER BY CASE WHEN ISNULL(borrar, 0) = 0 THEN 0 ELSE 1 END,
                                 CASE WHEN Mostrar = 1 THEN 0 ELSE 1 END,
                                 ProIdProducto DESC
                    `;
                }
                
                const areaGrupoRes = await reqArea.query(queryArea);
                if (areaGrupoRes.recordset.length > 0) {
                    if (areaGrupoRes.recordset[0].Candidatos > 1) {
                        logger.warn(`[PricingService] CodArticulo '${cleanCod}' lo comparten ${areaGrupoRes.recordset[0].Candidatos} artículos y no vino ProIdProducto: se cotiza con ProIdProducto ${areaGrupoRes.recordset[0].ProIdProducto}.`);
                    }
                    if (!resolvedProId) resolvedProId = areaGrupoRes.recordset[0].ProIdProducto;
                    if (!resolvedAreaId) resolvedAreaId = areaGrupoRes.recordset[0].AreaID?.toString().trim().toUpperCase();
                    resolvedGrupo = areaGrupoRes.recordset[0].Grupo?.toString();
                    resolvedCodStock = areaGrupoRes.recordset[0].CodStock || null;
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

        // --- ESPECIAL: TARIFA BORDADO POR PUNTADAS ---
        // Desde el 23/10/2026 por franjas de puntadas (tarifaBordado: hasta 4.000 $ 70, hasta 8.000 $ 110…).
        // Del 19/10 al 23/10 fue la de la guía de Emblemas: $ 8 cada 1.000 puntadas o fracción hasta 10.000
        // y $ 6 cada 1.000 de ahí en más. Antes: $ 50 hasta 5.000 y $ 10 cada 1.000 más. Los CARGOS del bordado (matriz, relieve 3D, aplicación: BOR_CARGOS_CON_LISTA) no
        // se cobran por puntadas sino por su precio de lista: antes caían acá y salían a la tarifa
        // mínima ($ 50 la matriz, sin puntadas).
        const isBordadoByDesc = variables._desc && variables._desc.toLowerCase().includes('bordado');
        const cfgBordado = PricingService.configBordado(priceConfigs);
        const esCargoBordado = !!cleanCod && cfgBordado.cargos.has(cleanCod);

        if ((areasBordado.includes(resolvedAreaId) || cleanCod === '109' || isBordadoByDesc) && !esCargoBordado) {
            // Usar el datoTecnicoValue si viene, sino fallback a variables.puntadas
            const totalPuntadas = parseFloat(datoTecnicoValue) || variables.puntadas || 0;
            let priceBordadoUYU = PricingService.tarifaBordado(priceConfigs, totalPuntadas).precioUYU;

            // [23/10/2026] MÍNIMO DE BORDADOS POR DISEÑO (configBordado.minimoBordados, 0 = sin mínimo). Cada orden
            // de Bordado es un diseño y `cantidad` son sus bordados: con menos que el mínimo se cobra el mínimo
            // (pedido de la usuaria: "cobra el mínimo", no frena el ingreso). Se reparte en el precio por bordado
            // para que precio × cantidad dé lo mismo en todos los que cotizan (erpSyncService usa precioTotal; el
            // modal de cotización, precio × cantidad): 3 bordados de $ 70 con mínimo 5 = 3 × $ 116,67 = $ 350.
            let notaMinimo = '';
            const bordadosLinea = Number(cantidad) || 0;
            if (priceBordadoUYU > 0 && cfgBordado.minimoBordados > 0 && bordadosLinea > 0 && bordadosLinea < cfgBordado.minimoBordados) {
                notaMinimo = ` · mínimo ${cfgBordado.minimoBordados} bordados por diseño: lleva ${bordadosLinea}, se cobran ${cfgBordado.minimoBordados} ($ ${priceBordadoUYU} c/u)`;
                priceBordadoUYU = r4(priceBordadoUYU * cfgBordado.minimoBordados / bordadosLinea);
            }

            precioBase = toTarget(priceBordadoUYU, 'UYU');
            monedaBaseOriginal = 'UYU';
            breakdown.push({ tipo: 'OVERRIDE', valor: precioBase, desc: `Bordado por Puntadas (${totalPuntadas} p.)${notaMinimo}` });
            overrideTecnico = { valor: precioBase, motivo: `Bordado por puntadas (${totalPuntadas} p.)${notaMinimo}` };
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
            // Dato técnico representa bajadas por prenda: solo dice que la línea se cobra por bajadas.
            // La CANTIDAD de la línea ya son las bajadas EN TOTAL: el sync la arma como prendas × bajadas por
            // prenda + bajadas adicionales (erpSyncService, "Cantidad Efectiva (Bajadas)", y los servicios
            // 110/113) y el modal de cotización recalcula con esa misma cantidad. Hasta el 19/10/2026 se volvía
            // a multiplicar por las bajadas por prenda y el trabajo salía al doble o más (20 prendas con 2
            // bajadas: $ 1.200 en vez de $ 600).
            const bajadasPorPrenda = parseFloat(datoTecnicoValue) || variables.bajadas || 0;
            const totalBajadas = bajadasPorPrenda > 0 ? cantidad : 0;

            if (totalBajadas > 0) {
                // La tarifa (cargo fijo por debajo del umbral, precio por bajada desde ahí) la calcula
                // tarifaEstampado: la misma que muestran Precios por cantidad y Precios Estándar (19/10/2026)
                const te = PricingService.tarifaEstampado(priceConfigs, totalBajadas);
                const precioTotalUYU = te.totalUYU;
                const descRegla = te.conCargoFijo
                    ? `Cargo Fijo Estampado (< ${te.umbral} bajadas)`
                    : `Costo por Bajadas (${totalBajadas} b.)`;

                // El motor devuelve el precio unitario: el total del trabajo entre la cantidad de la línea (las
                // bajadas en total), o sea el precio por bajada
                const unitPriceUYU = precioTotalUYU / cantidad;
                nuevoPrecioBase = toTarget(unitPriceUYU, 'UYU');

                // Sobrescribimos el tipo de regla para que reemplace el base
                breakdown.push({ tipo: 'OVERRIDE', valor: nuevoPrecioBase, desc: descRegla });
                overrideTecnico = { valor: nuevoPrecioBase, motivo: descRegla };
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

        // Recargo por Tinta (ECOUV): mismo criterio que el sync (erpSyncService inyecta el
        // perfil cuando Ordenes.Tinta contiene UV/LATEX). Los llamadores que recalculan una
        // línea suelta (modal de cotización, simulador) no pasan extraProfileIds, así que si
        // viene la referencia de la orden (variables.ordenId) la tinta se lee de la orden acá.
        const idTinta = parseInt(globalConfigs['ID_PERFIL_TINTA']) || 3;
        let injectedTinta = false;
        let tintaOrden = variables.tinta || null;
        if (!tintaOrden && variables.ordenId) {
            try {
                const ordenIdNum = parseInt(variables.ordenId);
                const tReq = pool.request();
                let tQuery;
                if (!isNaN(ordenIdNum) && String(ordenIdNum) === String(variables.ordenId).trim()) {
                    tReq.input('oid', sql.Int, ordenIdNum);
                    tQuery = 'SELECT TOP 1 Tinta FROM Ordenes WITH(NOLOCK) WHERE OrdenID = @oid';
                } else {
                    tReq.input('cod', sql.VarChar(50), String(variables.ordenId).trim());
                    tQuery = 'SELECT TOP 1 Tinta FROM Ordenes WITH(NOLOCK) WHERE LTRIM(RTRIM(CodigoOrden)) = @cod';
                }
                const tRes = await tReq.query(tQuery);
                tintaOrden = tRes.recordset[0]?.Tinta || null;
            } catch (eTinta) {
                logger.warn('[PricingService] No se pudo leer la Tinta de la orden ' + variables.ordenId + ': ' + eTinta.message);
            }
        }
        // El recargo por TINTA es del material IMPRESO: si el artículo que se está
        // cotizando es un SERVICIO/terminación de la orden (ojales, soldadura, bolsillo
        // — figura en ServiciosExtraOrden), NO se inyecta el perfil. El % de UV
        // encarece la impresión en m², no el trabajo manual. (Espeja el filtro que
        // hace erpSyncService al cotizar los servicios del sync.)
        if (tintaOrden && variables.ordenId && cleanCod) {
            try {
                const svcReq = pool.request().input('cart', sql.VarChar(50), cleanCod);
                const ordenIdNum2 = parseInt(variables.ordenId);
                let svcQuery;
                if (!isNaN(ordenIdNum2) && String(ordenIdNum2) === String(variables.ordenId).trim()) {
                    svcReq.input('oid', sql.Int, ordenIdNum2);
                    svcQuery = "SELECT COUNT(*) AS n FROM ServiciosExtraOrden WITH(NOLOCK) WHERE OrdenID = @oid AND LTRIM(RTRIM(CodArt)) = @cart";
                } else {
                    svcReq.input('cod', sql.VarChar(50), String(variables.ordenId).trim());
                    svcQuery = "SELECT COUNT(*) AS n FROM ServiciosExtraOrden WITH(NOLOCK) WHERE OrdenID = (SELECT TOP 1 OrdenID FROM Ordenes WITH(NOLOCK) WHERE LTRIM(RTRIM(CodigoOrden)) = @cod) AND LTRIM(RTRIM(CodArt)) = @cart";
                }
                const svcRes = await svcReq.query(svcQuery);
                if ((svcRes.recordset[0]?.n || 0) > 0) {
                    tintaOrden = null;   // es un servicio de la orden: sin recargo de tinta
                }
            } catch (eSvc) {
                logger.warn('[PricingService] No se pudo verificar si ' + cleanCod + ' es servicio de la orden ' + variables.ordenId + ': ' + eSvc.message);
            }
        }
        if (tintaOrden && (String(tintaOrden).toUpperCase().includes('UV') || String(tintaOrden).toUpperCase().includes('LATEX'))) {
            if (!extraProfileIds.includes(idTinta)) {
                extraProfileIds.push(idTinta);
                injectedTinta = true;
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

        let numericCliId = null;
        for (const cid of possibleClientIds) {
            const num = parseInt(cid);
            if (!isNaN(num) && num > 0) {
                // Verificar si existe en la base de datos
                const checkRes = await pool.request().input('cid', sql.Int, num).query('SELECT TOP 1 CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CliIdCliente = @cid');
                if (checkRes.recordset.length > 0) {
                    numericCliId = checkRes.recordset[0].CliIdCliente;
                    break;
                }
            }
        }
        if (!numericCliId) {
            for (const cid of possibleClientIds) {
                if (typeof cid === 'string' && cid.trim().length > 0) {
                    const checkRes = await pool.request().input('cod', sql.VarChar(50), cid.trim()).query('SELECT TOP 1 CliIdCliente FROM dbo.Clientes WITH(NOLOCK) WHERE CodCliente = @cod');
                    if (checkRes.recordset.length > 0) {
                        numericCliId = checkRes.recordset[0].CliIdCliente;
                        break;
                    }
                }
            }
        }


        let resolvedCategoria = resolvedAreaId;
        if (resolvedAreaId === 'DF') resolvedCategoria = 'DTF';
        if (resolvedAreaId === 'EST') resolvedCategoria = 'Estampados';
        // [23/10/2026] Productos de salón (los del local: Articulos.CodStock 2.2.1.2, configurable en
        // CODSTOCK_PRODUCTOS_SALON): no tienen área ni órdenes, así que se les da la categoría 'SALON' para
        // que les aplique su perfil global de escalas (PerfilesPrecios.Categoria = 'SALON', "SALON
        // ESCALONADOS"). Así un mismo producto puede tener precio por cantidad (x1, x10, x100) en vez de
        // cargarlo como tres productos. Solo cambia a qué perfiles se mira, no el área.
        const codStockSalon = String(globalConfigs['CODSTOCK_PRODUCTOS_SALON'] || '2.2.1.2').split(',').map(x => x.trim()).filter(Boolean);
        if (!resolvedCategoria && resolvedCodStock && codStockSalon.includes(String(resolvedCodStock).trim())) resolvedCategoria = 'SALON';

        // Resolver AreaNombre del área actual para comparar contra perfiles que guardan nombre legible
        // (ej: Categoria = 'Sublimacion' en vez de 'SB')
        let resolvedAreaNombre = resolvedAreaId;
        if (resolvedAreaId) {
            try {
                const areaNameRes = await pool.request()
                    .input('codArea', sql.VarChar(20), resolvedAreaId)
                    .query("SELECT TOP 1 NombreReferencia FROM dbo.ConfigMapeoERP WITH(NOLOCK) WHERE LTRIM(RTRIM(AreaID_Interno)) = @codArea");
                if (areaNameRes.recordset.length > 0 && areaNameRes.recordset[0].NombreReferencia) {
                    resolvedAreaNombre = areaNameRes.recordset[0].NombreReferencia;
                }
            } catch (e) {
                logger.warn("[PricingService] No se pudo resolver AreaNombre para área: " + resolvedAreaId);
            }
        }

        const rulesRes = await pool.request()
            .input('ProId', sql.Int, resolvedProId || -1)
            .input('CleanCod', sql.VarChar, cleanCod || '')
            .input('Qty', sql.Decimal(18, 2), volumeForRules)
            .input('ResolvedGrupo', sql.VarChar, resolvedGrupo)
            .input('ResolvedAreaId', sql.VarChar, resolvedAreaId || '')
            .input('ResolvedCategoria', sql.VarChar, resolvedCategoria || '')
            .input('ResolvedAreaNombre', sql.VarChar, resolvedAreaNombre || '')
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
                -- Perfil ASIGNADO al cliente: también respeta las áreas marcadas en el perfil
                -- (Categoria). Antes solo los perfiles globales las miraban y un perfil asignado
                -- se aplicaba en TODAS las áreas aunque tuviera áreas marcadas — "Descuento
                -- Trabajadores 10%" con SB, DF, ECOUV descontaba también Pet Film y shorts.
                -- Sin áreas marcadas ('Todos' o vacío) se aplica a todo, como siempre. Los
                -- beneficios (EsBeneficio) usan Categoria 'BENEFICIO', que no es un área: no se
                -- filtran. La lista se compara por elemento (admite 'SB, DF, ECOUV').
                WHERE ((PE.CliIdCliente IN (${possibleClientIds.length > 0 ? possibleClientIds.join(',') : '0'})
                        AND (ISNULL(PP.EsBeneficio, 0) = 1
                             OR ISNULL(NULLIF(LTRIM(RTRIM(PP.Categoria)), ''), 'Todos') = 'Todos'
                             OR EXISTS (SELECT 1 FROM STRING_SPLIT(CAST(PP.Categoria AS VARCHAR(500)), ',') cat
                                        WHERE UPPER(LTRIM(RTRIM(cat.value))) IN (UPPER(@ResolvedAreaId), UPPER(@ResolvedCategoria), UPPER(@ResolvedAreaNombre))
                                          AND LTRIM(RTRIM(cat.value)) <> '')))
                       OR (PP.EsGlobal = 1 AND (ISNULL(PP.Categoria, 'Todos') = 'Todos' OR PP.Categoria = '' OR PP.Categoria = @ResolvedAreaId OR PP.Categoria = @ResolvedCategoria OR PP.Categoria = @ResolvedAreaNombre))
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
        traceDecision += `Perfiles Activos: ${(extraProfileIds || []).join(',')} | Area: ${resolvedAreaId} (Nombre: ${resolvedAreaNombre})\n`;
        if (typeof injectedUrgencia !== 'undefined' && injectedUrgencia) {
            traceDecision += `[INFO] Modo URGENTE Activado (Inyectando Perfil ID ${idUrgencia} a la evaluación)\n`;
        }
        if (injectedTinta) {
            traceDecision += `[INFO] Tinta ${tintaOrden} detectada (Inyectando Perfil ID ${idTinta} a la evaluación)\n`;
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
            // Gana el escalón de cantidad más alto que corresponde (CantidadMinima <= Qty ya
            // filtrado en el WHERE); "es la regla propia del producto" solo desempata cuando
            // DOS reglas caen en el MISMO escalón (una general y una específica a la vez).
            // Antes se ordenaba al revés: una regla propia en un escalón bajo (ej. Min 15) le
            // ganaba a la regla General de un escalón más alto que sí correspondía (ej. Min 100
            // para un pedido de 101 u.), y el pedido terminaba cobrando el precio equivocado.
            rules.sort((a, b) => {
                const cantDiff = (b.CantidadMinima || 0) - (a.CantidadMinima || 0);
                if (cantDiff !== 0) return cantDiff;
                const aExact = (a.CodArticulo || '').toString().trim() === cleanCod ? 1 : 0;
                const bExact = (b.CodArticulo || '').toString().trim() === cleanCod ? 1 : 0;
                return bExact - aExact;
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
                desc: `Desc. ${fmtPct(bestDisc.Valor)}${bestDisc.TipoRegla.includes('percentage') ? '%' : ''} [${bestDisc.NombrePerfil}]`,
                profileId: bestDisc.PerfilID
            });
        }

        // ── BENEFICIOS PACTADOS (specs/40 RN-BEN.19/20): si el cliente tiene un beneficio
        // ACTIVO, vigente y con saldo cuya regla alcanza a este artículo, esa regla PISA la
        // competencia de arriba (lista, perfiles y excepciones del cliente) mientras dure.
        // El % es SIEMPRE sobre el precio de LISTA, nunca sobre el especial. Con el
        // interruptor apagado o sin beneficios no hace nada (la consulta actual no cambia).
        let beneficioSel = null;
        if (!variables.skipBeneficios && numericCliId) {
            try {
                const benSvc = require('./beneficiosService');
                beneficioSel = await benSvc.beneficioParaPrecio(pool, { cliId: numericCliId, proId: resolvedProId, codArticulo: cleanCod, grupo: resolvedGrupo, areaId: resolvedAreaId, cantidad });
            } catch (eBen) {
                logger.warn('[PricingService] Beneficios: no se pudo evaluar (' + eBen.message + '); se cotiza sin beneficio.');
                beneficioSel = null;
            }
        }
        if (beneficioSel) {
            const rg = beneficioSel.regla;
            const monRegla = rg.monedaId === 2 ? 'USD' : 'UYU';
            let precioBen;
            if (rg.tipo === 'fixed') precioBen = toTarget(rg.valor, monRegla);
            else if (rg.tipo === 'percentage') precioBen = Math.max(0, nuevoPrecioBase * (1 - rg.valor / 100));
            else precioBen = Math.max(0, nuevoPrecioBase - toTarget(rg.valor, monRegla));
            precioBen = Math.round(precioBen * 10000) / 10000;
            traceDecision += `\n* BENEFICIO PACTADO [${beneficioSel.nombre}] (#${beneficioSel.bclId}, alcance ${rg.alcance}): ${rg.tipo === 'fixed' ? 'precio fijo ' + rg.valor + ' ' + monRegla : rg.tipo === 'percentage' ? rg.valor + '% sobre LISTA (' + nuevoPrecioBase.toFixed(2) + ')' : 'menos ' + rg.valor + ' ' + monRegla} → ${precioBen.toFixed(2)}. Pisa lista/perfiles/especial (${precioFinalBase.toFixed(2)}).\n`;
            for (let i = breakdown.length - 1; i >= 0; i--) if (breakdown[i].tipo === 'OVERRIDE' || breakdown[i].tipo === 'DISCOUNT') breakdown.splice(i, 1);
            breakdown.push({ tipo: 'OVERRIDE', valor: precioBen, desc: `Beneficio: ${beneficioSel.nombre}`, beneficioId: beneficioSel.bclId });
            precioFinalBase = precioBen; discFinalVal = 0; appliedFixed = false; bestDisc = null; bestFixed = null;
        }

        traceDecision += `\n* Fase Recargos (Acumulativos):\n`;
        // 5. Recargos (Acumulativos)
        // REGLA: Si el precio ya quedó en 0 por un descuento total (ej: Reposición 100%),
        // no se aplica ningún recargo. 0 es 0.
        let surchargeRules = reglasFinales.filter(r => r.TipoRegla.includes('surcharge'));
        const urgCodareas = (globalConfigs['_URGENCIA_CODAREA_SET'] || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (urgCodareas.length > 0) {
            // El perfil tiene áreas específicas — urgencia solo aplica a esos CodAreas
            if (!urgCodareas.includes((resolvedAreaId || '').toUpperCase())) {
                surchargeRules = surchargeRules.filter(r => r.PerfilID !== idUrgencia && r.NombrePerfil?.toLowerCase() !== 'urgente');
                traceDecision += `  [URGENCIA] Área ${resolvedAreaId} no está en CodAreas del perfil (${urgCodareas.join(',')}) → sin recargo urgente.\n`;
            }
        } else {
            // Categoría = 'Todos' → comportamiento original: excluir áreas de AREAS_SIN_URGENCIA
            const areasNoUrg = (globalConfigs['AREAS_SIN_URGENCIA'] || 'BOR,EMB,COR,TWC,COS,TWT').split(',').map(s => s.trim().toUpperCase());
            if (areasNoUrg.includes((resolvedAreaId || '').toUpperCase())) {
                surchargeRules = surchargeRules.filter(r => r.PerfilID !== idUrgencia && r.NombrePerfil?.toLowerCase() !== 'urgente');
                traceDecision += `  [URGENCIA] Área ${resolvedAreaId} está en AREAS_SIN_URGENCIA → sin recargo urgente.\n`;
            }
        }

        // Excepción por cliente, cliente+área o cliente+artículo: no aplica recargo urgente
        if (numericCliId && surchargeRules.some(r => r.PerfilID === idUrgencia || r.NombrePerfil?.toLowerCase() === 'urgente')) {
            try {
                const excRes = await pool.request()
                    .input('CliId',   sql.Int,         numericCliId)
                    .input('ProId',   sql.Int,         resolvedProId || -1)
                    .input('CodArea', sql.VarChar(20), resolvedAreaId || '')
                    .query(`
                        SELECT TOP 1 ID FROM dbo.UrgenciaExcepciones
                        WHERE CliIdCliente = @CliId
                          AND Activo = 1
                          AND (
                              (ProIdProducto IS NULL AND CodArea IS NULL)           -- exento total
                              OR ProIdProducto = @ProId                             -- artículo específico
                              OR CodArea = @CodArea                                 -- área/servicio completo
                          )
                    `);
                if (excRes.recordset.length > 0) {
                    surchargeRules = surchargeRules.filter(r => r.PerfilID !== idUrgencia && r.NombrePerfil?.toLowerCase() !== 'urgente');
                    traceDecision += `  [EXCEPCIÓN URGENCIA] Cliente ${numericCliId} exento del recargo urgente (tabla UrgenciaExcepciones).\n`;
                }
            } catch (excErr) {
                logger.warn('[PricingService] No se pudo consultar UrgenciaExcepciones:', excErr.message);
            }
        }

        let totalRecargos = 0;
        const recargosInfo = [];   // uno por recargo aplicado, para el desglose estructurado
        if (precioFinalBase <= 0) {
            traceDecision += `  Recargos omitidos: precio ya es 0 (descuento total aplicado).\n`;
        } else {
            // Cada recargo % se calcula sobre el precio CON el descuento ya aplicado (neto
            // antes de recargos) y se SUMA: lista 10, desc 25 % → 7,50; tinta 25 % → +1,875.
            surchargeRules.forEach(r => {
                let val = r.TipoRegla.includes('percentage') ? precioFinalBase * (parseFloat(r.Valor) / 100) : toTarget(r.Valor, r.Moneda);
                traceDecision += `  - SUMA RECARGO [${r.NombrePerfil}]: +${val.toFixed(2)}\n`;
                totalRecargos += val;
                breakdown.push({ tipo: 'SURCHARGE', valor: val, desc: `Recargo ${r.TipoRegla.includes('percentage') ? r.Valor + '%' : ''} [${r.NombrePerfil}]`, profileId: r.PerfilID });
                recargosInfo.push({ regla: r, pct: r.TipoRegla.includes('percentage') ? r4(r.Valor) : null, importeUnitario: r4(val) });
            });
        }

        const finalPU = precioFinalBase + totalRecargos;
        traceDecision += `\n= PRECIO FINAL CALCULADO: ${finalPU.toFixed(2)}\n`;
        // variables.sinTraza: la vista Precios por cantidad llama al motor una vez por artículo y franja
        // (cientos de veces por pantalla) y no necesita el detalle de cada cálculo en el log.
        if (!variables.sinTraza) logger.info(traceDecision);

        // ---- LÓGICA DE PREPAGO (PlanesMetros) Y RESERVAS ----
        let finalPUWithPrepago = finalPU;
        let pricingProfileName = null;
        let isPrepagoTotal = false;
        let isPrepagoParcial = false;
        let availableMetersEfectivos = 0;
        let totalCommitted = 0;
        let totalAvailableRaw = 0;

        if (!variables.skipPrepago && numericCliId && resolvedProId) {
            try {
                // 1. Buscar planes de metros activos
                const plansRes = await pool.request()
                    .input('CliId', sql.Int, numericCliId)
                    .input('ProId', sql.Int, resolvedProId)
                    .query(`
                        SELECT pm.PlaIdPlan, pm.ProIdProducto,
                               ISNULL(pm.PlaCantidadTotal, 0) - ISNULL(pm.PlaCantidadUsada, 0) AS MetrosDisponibles
                        FROM dbo.PlanesMetros pm WITH(NOLOCK)
                        WHERE pm.CliIdCliente = @CliId
                          AND pm.PlaActivo = 1
                          AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                          AND (
                            pm.ProIdProducto = @ProId
                            OR EXISTS (
                              SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                              WHERE pap.PlaIdPlan = pm.PlaIdPlan
                                AND pap.ProIdProducto = @ProId
                            )
                          )
                    `);

                if (plansRes.recordset.length > 0) {
                    const planIds = plansRes.recordset.map(p => p.PlaIdPlan);
                    totalAvailableRaw = plansRes.recordset.reduce((sum, p) => sum + (parseFloat(p.MetrosDisponibles) || 0), 0);

                    // 2. Sumar metros comprometidos de órdenes activas (excluyendo la actual)
                    const excludeId = parseInt(variables.ordenId || variables.orderId) || null;
                    const committedRes = await pool.request()
                        .input('CliId', sql.Int, numericCliId)
                        .input('ExcludeId', sql.Int, excludeId)
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

                    totalCommitted = committedRes.recordset.reduce((sum, o) => {
                        const magStr = String(o.Magnitud || '0').replace(/[^\d.]/g, '');
                        return sum + (parseFloat(magStr) || 0);
                    }, 0);

                    availableMetersEfectivos = Math.max(0, totalAvailableRaw - totalCommitted);

                    if (availableMetersEfectivos > 0) {
                        if (availableMetersEfectivos >= cantidad) {
                            finalPUWithPrepago = 0;
                            isPrepagoTotal = true;
                            pricingProfileName = 'PREPAGO (ROLLO PRE-COMPRADO)';
                        } else {
                            const excedente = cantidad - availableMetersEfectivos;
                            finalPUWithPrepago = (excedente * finalPU) / cantidad;
                            isPrepagoParcial = true;
                            pricingProfileName = 'PREPAGO PARCIAL (ROLLO PRE-COMPRADO)';
                        }
                    }
                }
            } catch (errPlan) {
                logger.error("[PricingService] Error calculando metros comprometidos prepago: " + errPlan.message);
            }
        }

        // --- MATRIZ DE BORDADO SIN CARGO (guía de Emblemas, 19/10/2026) ---
        // "Realizando 10 bordados el costo de la matriz va de regalo": la matriz (BOR_COD_MATRIZ) de una
        // orden con BOR_MATRIZ_GRATIS_DESDE bordados o más sale en 0, como un descuento del 100 % (así
        // queda registrado cuánto valía). Sin saber cuántos bordados lleva, se cobra.
        let matrizSinCargo = null;
        if (cleanCod && cleanCod === cfgBordado.codMatriz && cfgBordado.matrizGratisDesde > 0) {
            const bordados = await PricingService.cantidadBordados(pool, variables);
            if (bordados != null && bordados >= cfgBordado.matrizGratisDesde) {
                matrizSinCargo = `Matriz sin cargo: ${bordados} bordados (va de regalo desde ${cfgBordado.matrizGratisDesde})`;
                finalPUWithPrepago = 0;
            }
        }

        // --- Generar resumen textual ---
        let txt = `Base: ${cleanCurrency} ${precioBase.toFixed(2)}`;
        breakdown.forEach(b => {
            if (b.tipo === 'OVERRIDE') {
                txt += `\nOverride: ${cleanCurrency} ${b.valor.toFixed(2)} (${b.desc})`;
            } else if (b.tipo === 'DISCOUNT') {
                txt += `\nDescuento: -${cleanCurrency} ${Math.abs(b.valor).toFixed(2)} (${b.desc})`;
            } else if (b.tipo === 'SURCHARGE') {
                txt += `\nRecargo: +${cleanCurrency} ${Math.abs(b.valor).toFixed(2)} (${b.desc})`;
            }
        });
        txt += `\nTotal Unit. Calculado: ${cleanCurrency} ${finalPU.toFixed(2)}`;
        
        if (isPrepagoTotal) {
            txt += `\nPrepago: Cubierto 100% por plan (Sobrante: ${availableMetersEfectivos.toFixed(2)}m de ${totalAvailableRaw.toFixed(2)}m, Comprometido: ${totalCommitted.toFixed(2)}m)`;
            txt += `\nTotal Unit. Prepago: ${cleanCurrency} 0.00`;
        } else if (isPrepagoParcial) {
            txt += `\nPrepago: Cubierto parcial (${availableMetersEfectivos.toFixed(2)}m cubiertos de ${totalAvailableRaw.toFixed(2)}m, Comprometido: ${totalCommitted.toFixed(2)}m, Excedente: ${(cantidad - availableMetersEfectivos).toFixed(2)}m)`;
            txt += `\nTotal Unit. Prepago: ${cleanCurrency} ${finalPUWithPrepago.toFixed(2)}`;
        }

        if (matrizSinCargo) {
            txt += `\nDescuento: -${cleanCurrency} ${finalPU.toFixed(2)} (${matrizSinCargo})\nTotal Unit. Calculado: ${cleanCurrency} 0.00`;
        }

        // --- Recopilar Nombres de Perfiles SÓLO los que aplicaron ---
        const appliedSet = new Set();
        if (pricingProfileName) {
            appliedSet.add(pricingProfileName);
        } else {
            if (appliedFixed && bestFixed) appliedSet.add(bestFixed.NombrePerfil);
            else if (bestDisc) appliedSet.add(bestDisc.NombrePerfil);
            if (beneficioSel) appliedSet.add(`Beneficio: ${beneficioSel.nombre}`);
            surchargeRules.forEach(r => appliedSet.add(r.NombrePerfil));
        }

        // --- Calcular precio en moneda original para trazabilidad ---
        let precioOriginalUnitario = finalPUWithPrepago;
        if (monedaBaseOriginal !== cleanCurrency) {
            if (monedaBaseOriginal === 'UYU' && cleanCurrency === 'USD') precioOriginalUnitario = finalPUWithPrepago * actualExchangeRate;
            if (monedaBaseOriginal === 'USD' && cleanCurrency === 'UYU') precioOriginalUnitario = finalPUWithPrepago / actualExchangeRate;
        }

        let precioOriginalCalculado = finalPU;
        if (monedaBaseOriginal !== cleanCurrency) {
            if (monedaBaseOriginal === 'UYU' && cleanCurrency === 'USD') precioOriginalCalculado = finalPU * actualExchangeRate;
            if (monedaBaseOriginal === 'USD' && cleanCurrency === 'UYU') precioOriginalCalculado = finalPU / actualExchangeRate;
        }

        if (matrizSinCargo) precioOriginalCalculado = 0;

        // ---- DESGLOSE ESTRUCTURADO (specs/09 RN-PRE.12): lo que se congela con la línea ----
        // lista (después del override técnico) − descuento ganador + Σ recargos = neto.
        // Cada recargo se calcula sobre lista − descuento y se SUMA (25 % + 25 % = 50 % de ese
        // neto). El % del descuento es el de la regla (informativo); el importe es el que cierra
        // la cuenta.
        const etiquetas = await PricingService.getEtiquetasPerfiles(pool);
        const origenRegla = (r) => {
            const esExc = r.NombrePerfil === 'Excepción Cliente';
            const info = esExc ? null : etiquetas[r.PerfilID];
            const nombrePerfil = (info && info.nombre) || (r.NombrePerfil || '').trim();
            // Etiqueta que ve el cliente: la del perfil si está cargada; vacía => el nombre del
            // perfil; "-" => sin texto (queda solo el % o el importe).
            const etqCfg = info ? info.etiqueta : null;
            return {
                origen: esExc ? 'EXCEPCION_CLIENTE' : `PERFIL:${r.PerfilID}`,
                perfilId: esExc ? null : r.PerfilID,
                reglaId: r.PerfilItemID || null,
                nombre: esExc ? 'Excepción del cliente' : nombrePerfil,
                etiqueta: esExc ? 'Precio especial' : (etqCfg === '-' ? '' : (etqCfg || nombrePerfil))
            };
        };
        // Texto que ve el cliente: "etiqueta + valor". '-' = sin texto en la factura. Si la
        // etiqueta ya termina con el mismo % ("Descuento Trabajadores 10%"), no se repite.
        const conEtq = (etq, resto) => {
            if (!etq) return '-';
            const e = String(etq).trim();
            const m = String(resto).match(/^([\d.,]+)\s*%$/);
            if (m && e.replace(/\s+/g, '').toLowerCase().endsWith(m[1].replace(/\s+/g, '') + '%')) return e;
            return `${e} ${resto}`;
        };
        let descuentoInfo = null;
        if (beneficioSel) {
            // BENEFICIO PACTADO (specs/40): pisó a la competencia normal, así que el desglose
            // que ve el cliente/factura tiene que decir ESTO, no la regla que perdió. El
            // origen "BENEFICIO" es distinto de "PERFIL:n" para que se distinga en la factura.
            const rg = beneficioSel.regla;
            const etq = `Beneficio: ${beneficioSel.nombre}`;
            const o = { origen: 'BENEFICIO', perfilId: null, reglaId: beneficioSel.bclId || null, nombre: etq, etiqueta: etq };
            const importeUnitario = r4(nuevoPrecioBase - precioFinalBase);
            if (rg.tipo === 'fixed') {
                descuentoInfo = { tipo: 'FIJO', pct: null, importeUnitario, valorRegla: parseFloat(rg.valor), ...o, texto: conEtq(etq, '(precio pactado)') };
            } else if (rg.tipo === 'percentage') {
                descuentoInfo = { tipo: 'PCT', pct: r4(rg.valor), importeUnitario, valorRegla: parseFloat(rg.valor), ...o, texto: conEtq(etq, `${fmtPct(rg.valor)} %`) };
            } else {
                descuentoInfo = { tipo: 'IMPORTE', pct: null, importeUnitario, valorRegla: parseFloat(rg.valor), ...o, texto: conEtq(etq, `${cleanCurrency} ${importeUnitario.toFixed(2)}`) };
            }
        } else if (appliedFixed && bestFixed) {
            const o = origenRegla(bestFixed);
            descuentoInfo = { tipo: 'FIJO', pct: null, importeUnitario: r4(nuevoPrecioBase - precioFinalBase), valorRegla: parseFloat(bestFixed.Valor), ...o, texto: conEtq(o.etiqueta, '(precio pactado)') };
        } else if (bestDisc) {
            const esPct = bestDisc.TipoRegla.includes('percentage');
            const o = origenRegla(bestDisc);
            descuentoInfo = {
                tipo: esPct ? 'PCT' : 'IMPORTE', pct: esPct ? r4(bestDisc.Valor) : null, importeUnitario: r4(discFinalVal),
                valorRegla: parseFloat(bestDisc.Valor), ...o,
                texto: esPct ? conEtq(o.etiqueta, `${fmtPct(bestDisc.Valor)} %`) : conEtq(o.etiqueta, `${cleanCurrency} ${r4(discFinalVal).toFixed(2)}`)
            };
        }
        const recargosDesglose = recargosInfo.map(x => {
            const o = origenRegla(x.regla);
            return { pct: x.pct, importeUnitario: x.importeUnitario, ...o, texto: x.pct != null ? conEtq(o.etiqueta, `${fmtPct(x.pct)} %`) : conEtq(o.etiqueta, `${cleanCurrency} ${x.importeUnitario.toFixed(2)}`) };
        });
        const ganadores = new Set([
            ...(descuentoInfo && descuentoInfo.reglaId ? [descuentoInfo.reglaId] : []),
            ...recargosDesglose.map(x => x.reglaId).filter(Boolean)
        ]);
        const desglose = {
            moneda: cleanCurrency,
            precioLista: r4(nuevoPrecioBase),
            listaSinOverride: r4(precioBase),
            override: overrideTecnico ? { valor: r4(overrideTecnico.valor), motivo: overrideTecnico.motivo } : null,
            descuento: descuentoInfo,
            recargos: recargosDesglose,
            recargoPct: recargosDesglose.length ? r4(recargosDesglose.reduce((a, x) => a + (x.pct || 0), 0)) : null,
            recargoImporte: recargosDesglose.length ? r4(totalRecargos) : null,
            recargoTexto: recargosDesglose.length ? (recargosDesglose.map(x => x.texto).filter(t => t && t !== '-').join(' + ') || '-') : null,
            precioNeto: r4(finalPU),
            prepago: isPrepagoTotal
                ? { tipo: 'TOTAL', metrosCubiertos: r4(availableMetersEfectivos), disponibles: r4(totalAvailableRaw), comprometidos: r4(totalCommitted) }
                : (isPrepagoParcial ? { tipo: 'PARCIAL', metrosCubiertos: r4(availableMetersEfectivos), excedente: r4(cantidad - availableMetersEfectivos), disponibles: r4(totalAvailableRaw), comprometidos: r4(totalCommitted) } : null),
            precioNetoConPrepago: r4(finalPUWithPrepago),
            // Todas las reglas que compitieron, con la marca de cuál ganó: es lo que
            // responde "por qué ganó el escalonado y no la excepción".
            candidatos: todasLasReglas.map(r => ({
                perfil: (r.NombrePerfil || '').trim(), perfilId: r.NombrePerfil === 'Excepción Cliente' ? null : r.PerfilID, reglaId: r.PerfilItemID,
                tipo: r.TipoRegla, valor: parseFloat(r.Valor), minimo: r.CantidadMinima,
                articulo: (r.CodArticulo || '').toString().trim() || null, grupo: r.CodGrupo || null,
                gano: ganadores.has(r.PerfilItemID)
            }))
        };
        if (!(desglose.precioLista > 0)) {
            // Sin lista real (artículo sin precio, base 0): no hay nada que desglosar. Si después
            // se tipea un precio, ese precio es su propia lista (ver desgloseManual).
            Object.assign(desglose, { precioLista: null, listaSinOverride: null, descuento: null, recargos: [], recargoPct: null, recargoImporte: null, recargoTexto: null });
        }

        return {
            codArticulo: cleanCod,
            proIdProducto: resolvedProId || null,
            cantidad,
            precioUnitario: finalPUWithPrepago,
            precioTotal: finalPUWithPrepago * cantidad,
            moneda: cleanCurrency,
            monedaOriginal: monedaBaseOriginal,
            precioUnitarioOriginal: precioOriginalCalculado,
            precioTotalOriginal: precioOriginalCalculado * cantidad,
            breakdown,
            txt,
            perfilesAplicados: [...appliedSet].filter(Boolean),
            // La matriz sin cargo va como descuento del 100 % sobre su lista (como una reposición)
            desglose: matrizSinCargo ? (PricingService.desgloseSinCargo(desglose, 'MATRIZ', 'Matriz sin cargo (desde ' + cfgBordado.matrizGratisDesde + ' bordados)') || desglose) : desglose,
            // Beneficio pactado con el que se cotizó (specs/40): la línea y la orden lo guardan
            // para que el motor contable consuma SU bolsa y para reportar margen resignado.
            beneficioAplicado: beneficioSel ? { bclId: beneficioSel.bclId, benId: beneficioSel.benId, cueId: beneficioSel.cueId, nombre: beneficioSel.nombre } : null,
            _debug: { resolvedAreaId, cleanCod, cleanCurrency }
        };

    }

    // `moneda` acepta las dos formas que circulan en el sistema: el código ('UYU'/'USD') o el id
    // de Monedas (1/2). El controlador mandaba el id y acá se hacía moneda.toUpperCase(), así que
    // POST /prices/base tiraba TypeError y devolvía 500 SIEMPRE (marketing no podía guardar un
    // precio; encontrado el 10/09/2026). Se normaliza una sola vez y se usa el id de ahí en más.
    static async setBasePrice(codArticulo, precio, moneda = 'UYU', proIdProducto = null) {
        const pool = await getPool();
        const monId = (typeof moneda === 'number' || /^\d+$/.test(String(moneda)))
            ? (parseInt(moneda, 10) === 2 ? 2 : 1)
            : (String(moneda).toUpperCase() === 'USD' ? 2 : 1);

        if (proIdProducto) {
            await pool.request()
                .input('Cod', sql.NVarChar, codArticulo ? codArticulo.trim() : '')
                .input('ProId', sql.Int, proIdProducto)
                .input('Pre', sql.Decimal(18, 4), precio)
                .input('MonIdMoneda', sql.Int, monId)
                .query(`
                    MERGE PreciosBase AS target
                    USING (SELECT @ProId AS ProIdProducto, @MonIdMoneda AS MonIdMoneda) AS source
                    ON (target.ProIdProducto = source.ProIdProducto AND target.MonIdMoneda = source.MonIdMoneda)
                    WHEN MATCHED THEN UPDATE SET Precio = @Pre, UltimaActualizacion = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (ProIdProducto, CodArticulo, Precio, MonIdMoneda, Moneda, UltimaActualizacion) VALUES (@ProId, @Cod, @Pre, @MonIdMoneda, CASE WHEN @MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END, GETDATE());
                `);
        } else {
            // Fallback legacy por si se llama sin proIdProducto
            await pool.request()
                .input('Cod', sql.NVarChar, codArticulo.trim())
                .input('Pre', sql.Decimal(18, 4), precio)
                .input('MonIdMoneda', sql.Int, monId)
                .query(`
                    MERGE PreciosBase AS target
                    USING (SELECT @Cod AS CodArticulo, @MonIdMoneda AS MonIdMoneda) AS source
                    ON (target.CodArticulo = source.CodArticulo AND target.MonIdMoneda = source.MonIdMoneda)
                    WHEN MATCHED THEN UPDATE SET Precio = @Pre, UltimaActualizacion = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (CodArticulo, Precio, MonIdMoneda, Moneda, UltimaActualizacion) VALUES (@Cod, @Pre, @MonIdMoneda, CASE WHEN @MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END, GETDATE());
                `);
        }
    }
}

module.exports = PricingService;
