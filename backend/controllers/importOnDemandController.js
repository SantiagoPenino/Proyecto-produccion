const axios = require('axios');
const logger = require('../utils/logger');
const PricingService = require('../services/pricingService');
const { getPool, sql } = require('../config/db');

// NOTA: Esta variable debe apuntar a la URL de tu macro de Apps Script.
const APPS_SCRIPT_URL = process.env.ORDENES_EXTERNAS_SCRIPT_URL || process.env.PLANILLA_SCRIPT_URL;

exports.previewOnDemand = async (req, res) => {
    logger.info("[PreviewOnDemand] Iniciando visualizacion manual desde Google Sheets...");
    const { docNumbers } = req.body;

    if (!docNumbers || !Array.isArray(docNumbers) || docNumbers.length === 0) {
        return res.status(400).json({ error: 'No se entregaron números de documento válidos.' });
    }
    if (!APPS_SCRIPT_URL) return res.status(500).json({ error: 'La URL del Apps Script no está configurada.' });

    try {
        const detectArea = (str) => {
            let s = str.toUpperCase().trim();
            if (s.startsWith('R')) s = s.substring(1);
            if (s.includes('XSB') || s.startsWith('SB')) return 'SB';
            if (s.includes('XTP') || s.startsWith('TP')) return 'TPU';
            if (s.includes('IMD')) return 'XMD';
            if (s.includes('TWC')) return 'TWC';
            return 'DF';
        };

        const codigosStr = docNumbers.map(n => n.trim()).filter(n => n.length > 0).join(",");
        
        logger.info(`[PreviewOnDemand] Pidiendo a Sheets las órdenes EN BATCH: ${codigosStr}`);

        const response = await axios.get(APPS_SCRIPT_URL, {
            params: {
                action: 'importarOrdenesManual',
                ordenes: codigosStr,
                area: detectArea(codigosStr.split(',')[0]),
                apiKey: 'planillas-macrosoft-2026'
            },
            timeout: 60000
        });

        const appScriptData = response.data;
        if (!appScriptData || !appScriptData.ok) {
            const errorMsg = appScriptData?.error || 'No se encontraron las órdenes en Sheets o hubo un error.';
            logger.error(`[PreviewOnDemand] Error desde Apps Script: ${errorMsg}`);
            return res.status(404).json({ error: errorMsg });
        }

        const ordenesEncontradasRaw = appScriptData.data || [];
        if (ordenesEncontradasRaw.length === 0) {
            return res.status(404).json({ error: 'No se procesó con éxito ninguna de las órdenes en Sheets.' });
        }

        const pool = await getPool();
        const resultadosPreview = [];

        // --- ETL MIGRATION: RAW ROW MAPPING ---
        const SheetsRawMappingService = require('../services/sheetsRawMappingService');
        const ordenesEncontradas = ordenesEncontradasRaw.map(orden => {
             // Soportamos el nuevo diseño puro (datosPorHoja) y el legacy (rawRow)
             if (orden && (orden.datosPorHoja || orden.rawRow)) {
                 if (!orden.servicios || orden.servicios.length === 0) {
                      const originalArchivosReferencia = orden.archivosReferencia;
                      const mapped = SheetsRawMappingService.mapToOrderPayload(orden);
                      if (mapped) {
                          // Preservamos y de-duplicamos archivos de referencia
                          if (originalArchivosReferencia && originalArchivosReferencia.length > 0) {
                              if (!mapped.archivosReferencia || mapped.archivosReferencia.length === 0) {
                                  mapped.archivosReferencia = originalArchivosReferencia;
                              } else {
                                  const urls = new Set(mapped.archivosReferencia.map(r => (r.url || '').toLowerCase().trim()));
                                  for (const ref of originalArchivosReferencia) {
                                      if (ref.url && !urls.has(ref.url.toLowerCase().trim())) {
                                          mapped.archivosReferencia.push(ref);
                                      }
                                  }
                              }
                          }
                          if (orden.rowNumber && !mapped.rowNumber) mapped.rowNumber = orden.rowNumber;
                          if (orden.clienteInfo && !mapped.clienteInfo) mapped.clienteInfo = orden.clienteInfo;
                      }
                      return mapped;
                 }
             }
             return orden; 
        }).filter(o => o !== null);
        // ── CORRECCIÓN DE METROS ─────────────────────────────────────────────────
        // importarOrdenesManual puede devolver metrosTotales incorrecto (ej: número
        // de archivos en vez de metros reales). Usamos getDatosDesdeSheets
        // (acción getCantidadMaterial — la misma del scanner QR) para corregirlo.
        const ordenesExternasSvc = require('../services/ordenesExternasService');
        await Promise.all(ordenesEncontradas.map(async (pedido) => {
            if (!pedido) return;
            const codigo = pedido.idExterno || pedido.codigoOrdenReal;
            if (!codigo) return;
            try {
                const datosReales = await ordenesExternasSvc.getDatosDesdeSheets(codigo);
                if (datosReales && datosReales.cantidad > 0) {
                    const cantAnterior = pedido.metrosTotales;
                    pedido.metrosTotales = datosReales.cantidad;
                    pedido.metrosReales  = datosReales.cantidad;
                    if (pedido.servicios && pedido.servicios[0] && pedido.servicios[0].cabecera) {
                        pedido.servicios[0].cabecera.metros = datosReales.cantidad;
                    }
                    logger.info('[PreviewOnDemand] metros corregidos ' + codigo + ': ' + cantAnterior + ' > ' + datosReales.cantidad + ' (' + datosReales.material + ')');
                }
            } catch(e) {
                logger.warn('[PreviewOnDemand] No se pudo corregir metros de ' + codigo + ': ' + e.message + '. Usando ' + pedido.metrosTotales);
            }
        }));


        // Resolver perfil de Reposicion por nombre (aplica a ordenes con codigo que empiece con R)
        let idPerfilReposicion = null;
        try {
            const repRes = await pool.request().query(
                "SELECT TOP 1 ID FROM PerfilesPrecios WHERE Nombre LIKE '%eposici%' AND Activo = 1"
            );
            if (repRes.recordset.length > 0) {
                idPerfilReposicion = repRes.recordset[0].ID;
                logger.info(`[PreviewOnDemand] Perfil Reposicion encontrado: ID=${idPerfilReposicion}`);
            }
        } catch(e) {
            logger.warn('[PreviewOnDemand] No se pudo cargar perfil Reposicion:', e.message);
        }
        for (const pedido of ordenesEncontradas) {
            if (!pedido) continue;
            // 🔍 DEBUG: volcar JSON completo de la orden para revisar estructura
            logger.info(`[DEBUG-PEDIDO-COMPLETO] ${pedido.idExterno || pedido.codigoOrdenReal || '?'}:\n${JSON.stringify(pedido, null, 2)}`);

            // --- DETECTAR SI YA EXISTE EN BD ---
            let yaExisteEnBd = false;
            let codigoExterno = pedido.idExterno || pedido.codigoOrdenReal;
            if (!codigoExterno && pedido.nombreTrabajo) {
                const match = pedido.nombreTrabajo.match(/FILA \d+:\s*([^\s]+)/);
                if (match && match[1]) codigoExterno = match[1];
            }
            if (codigoExterno) {
                try {
                    const exReq = await pool.request().input('ext', sql.VarChar(50), codigoExterno.trim()).query("SELECT TOP 1 OrdenID FROM Ordenes WHERE NoDocERP = @ext OR CodigoOrden = @ext");
                    if (exReq.recordset.length > 0) yaExisteEnBd = true;
                } catch(e) {}
            }

            // Resolver Cliente: prioridad a idReact explícito, sino id texto
            let codClienteERP = null;
            let reqClienteDisplay = pedido.clienteInfo?.id || pedido.codCliente || '?'; // Lo que se muestra en pantalla
            let reqCodClienteStr = pedido.clienteInfo?.id || pedido.codCliente || '';
            let reqIdReact = pedido.clienteInfo?.idReact;

            try {
                if (reqIdReact) {
                    const parsedReact = parseInt(reqIdReact);
                    if (!isNaN(parsedReact)) {
                        let creq = await pool.request()
                            .input('c', sql.Int, parsedReact)
                            .query("SELECT TOP 1 CliIdCliente, IDCliente, Nombre FROM Clientes WHERE IDReact = @c");
                        if (creq.recordset.length > 0) {
                            codClienteERP = creq.recordset[0].CliIdCliente;
                            // Display: preferir IDCliente texto, sino Nombre
                            reqClienteDisplay = (creq.recordset[0].IDCliente && creq.recordset[0].IDCliente.trim()) || creq.recordset[0].Nombre || reqClienteDisplay;
                            logger.info(`[CLIENTE] IDReact explícito=${parsedReact} → CliIdCliente=${codClienteERP} (${reqClienteDisplay})`);
                        }
                    }
                }

                if (!codClienteERP && reqCodClienteStr) {
                    const cleanStr = reqCodClienteStr.toString().trim();
                    const parsedCod = parseInt(reqCodClienteStr);

                    if (!isNaN(parsedCod) && /^\d+$/.test(cleanStr)) {
                        // Es un ID Numérico puro (ej: 40167862). El cliente lo digitó en la celda.
                        // Solo buscamos estrictamente en IDCliente (y opcionalmente CodCliente que es su par en ERP)
                        let creq = await pool.request()
                            .input('cstr', sql.NVarChar, cleanStr)
                            .query("SELECT TOP 1 CliIdCliente, IDCliente, Nombre FROM Clientes WHERE LTRIM(RTRIM(IDCliente)) = @cstr OR LTRIM(RTRIM(CodCliente)) = @cstr");
                        if (creq.recordset.length > 0) {
                            codClienteERP = creq.recordset[0].CliIdCliente;
                            reqClienteDisplay = (creq.recordset[0].IDCliente && creq.recordset[0].IDCliente.trim()) || creq.recordset[0].Nombre || reqClienteDisplay;
                            logger.info(`[CLIENTE] ID Numérico '${cleanStr}' → CliIdCliente=${codClienteERP} (${reqClienteDisplay})`);
                        } else {
                            logger.warn(`[CLIENTE] IDCliente='${cleanStr}' no encontrado de forma estricta.`);
                        }
                    } else {
                        const creq = await pool.request()
                            .input('c', sql.NVarChar, cleanStr)
                            .query("SELECT TOP 1 CliIdCliente, IDCliente, Nombre FROM Clientes WHERE LTRIM(RTRIM(IDCliente)) = @c");
                        if (creq.recordset.length > 0) {
                            codClienteERP = creq.recordset[0].CliIdCliente;
                            reqClienteDisplay = (creq.recordset[0].IDCliente && creq.recordset[0].IDCliente.trim()) || creq.recordset[0].Nombre || cleanStr;
                            logger.info(`[CLIENTE] IDCliente='${cleanStr}' → CliIdCliente=${codClienteERP} (${reqClienteDisplay})`);
                        } else {
                            logger.warn(`[CLIENTE] IDCliente='${cleanStr}' no encontrado`);
                        }
                    }
                }
            } catch(e) {
                logger.error("Error buscando cliente: " + e.message);
            }

            // Mapear Servicios/Items
            if (pedido.servicios && Array.isArray(pedido.servicios)) {
                for (const srv of pedido.servicios) {
                    const cabecera = srv.cabecera || {};
                    let codArticulo = cabecera.codArticulo;
                    const codArticuloOriginal = codArticulo; // guardar antes de normalizar
                    let material = cabecera.material || '';
                    
                    // Heurística: órdenes SB sin material → Sublimación
                    if (!material) {
                        const codigoOrden = (pedido.idExterno || pedido.codigoOrdenReal || '').toUpperCase();
                        if (codigoOrden.startsWith('SB-') || codigoOrden.startsWith('XSB-')) {
                            material = 'Sublimación';
                        } else {
                            material = 'Estándar';
                        }
                    }
                    
                    // Normalización como en IntegrationOrdersController
                    if (codArticulo === 'SERV-CORTE') { codArticulo = '1375'; material = 'Corte Laser por prenda'; cabecera.proIdProducto = 90; }
                    else if (codArticulo === 'SERV-COSTURA') { codArticulo = '115'; material = 'Costura'; cabecera.proIdProducto = 36; }
                    else if (codArticulo === 'SERV-BORDADO') { codArticulo = '1567'; material = 'Bordado'; cabecera.proIdProducto = 434; }

                    // Si el usuario metió filas separadas con TWC/TWT en Sheets, su "Trabajo" suele decir la tela.
                    // Aquí forzamos que el producto sea estrictamente el servicio.
                    const areaUp = (srv.areaId || '').toUpperCase();
                    if (areaUp === 'TWC' || areaUp === 'CORTE') {
                        codArticulo = '1375';
                        material = 'Corte Laser por prenda';
                        cabecera.proIdProducto = 90;
                    } else if (areaUp === 'TWT' || areaUp === 'COSTURA') {
                        codArticulo = '115';
                        material = 'Costura';
                        cabecera.proIdProducto = 36;
                    } else if (areaUp === 'EMB' || areaUp === 'BORDADO' || areaUp === 'BORD') {
                        codArticulo = '1567';
                        material = 'Bordado';
                        cabecera.proIdProducto = 434;
                    }

                    // Heurística de Rescate de codArticulo si viene nulo
                    if (!codArticulo) {
                        try {
                            const pNameClean = (material || pedido.nombreTrabajo || '').trim();
                            if (cabecera.idProductoReact) {
                                let preq = await pool.request().input('id', sql.Int, parseInt(cabecera.idProductoReact)).query("SELECT TOP 1 CodArticulo FROM Articulos WHERE IDProdReact = @id");
                                if (preq.recordset.length > 0) codArticulo = preq.recordset[0].CodArticulo;
                            } 
                            
                            if (!codArticulo && pNameClean) {
                                // Buscar articulo en la TABLA SINCRO, cruzándolo con Articulos reales por PROIDPRODUCTO
                                let preq = await pool.request().input('nom', sql.NVarChar, pNameClean).query(`
                                    SELECT TOP 1 A.CodArticulo, A.ProIdProducto, A.Descripcion
                                    FROM [SINCRO-ARTICULOS] S
                                    INNER JOIN Articulos A ON S.PROIDPRODUCTO = A.ProIdProducto
                                    WHERE LTRIM(RTRIM(S.PRODUCTO)) = LTRIM(RTRIM(@nom)) OR LTRIM(RTRIM(S.Material)) = LTRIM(RTRIM(@nom))
                                    ORDER BY CASE WHEN LTRIM(RTRIM(S.PRODUCTO)) = LTRIM(RTRIM(@nom)) THEN 1 ELSE 2 END
                                `);
                                if (preq.recordset.length > 0) {
                                    const oficial = preq.recordset[0];
                                    codArticulo = oficial.CodArticulo;
                                    cabecera.proIdProducto = oficial.ProIdProducto;
                                    if (oficial.Descripcion) material = oficial.Descripcion;
                                }
                            }
                        } catch (e) {
                            logger.error("Error resolviendo id de producto: " + e.message);
                        }
                    }

                    const items = srv.items || [];

                    // Áreas de servicio manual (bordado, costura, estampado, corte): no heredan los metros de la matriz
                    const AREAS_SERVICIO_MANUAL = ['EMB', 'TWT', 'EST', 'TWC', 'CORTE', 'BORD'];
                    const esAreaManual = 
                        AREAS_SERVICIO_MANUAL.some(a => (srv.areaId || '').toUpperCase().includes(a)) ||
                        ['SERV-BORDADO', 'SERV-COSTURA', 'SERV-CORTE', '1375', '112', '115', '1567', '109'].includes(String(codArticuloOriginal).toUpperCase());

                    let cantidad = esAreaManual ? 0 : 1;
                    if (!esAreaManual) {
                        cantidad = items.reduce((sum, it) => sum + (parseFloat(it.cantidad || it.copies) || 1), 0) || 1;
                        // Si es un extra contable (ej. Matriz), no hereda los metros globales del pedido, siempre es unitario.
                        if (srv.isCobranzaExtra) {
                            cantidad = 1;
                        } else if (pedido.metrosTotales || pedido.metrosReales) {
                            const parsedMetros = parseFloat((pedido.metrosTotales || pedido.metrosReales).toString().replace(',', '.'));
                            if (!isNaN(parsedMetros) && parsedMetros > 0) cantidad = parsedMetros;
                        }
                    }

                    const nodoPrioridad = pedido.prioridad || 'Normal';
                    const isOrderUrgente = nodoPrioridad.toLowerCase().includes('urgent');

                    // 🎯 NUEVO: Buscar ProIdProducto real en BD
                    // Como la planilla ahora manda el IDProdReact o ProIdProducto dentro del campo codArticulo (ej: 47),
                    // intentamos buscar el ProIdProducto correspondiente en la BD priorizando IDProdReact.
                    let finalProId = null;
                    const possibleId = parseInt(cabecera.proIdProducto || cabecera.ProIdProducto || codArticulo);
                    if (!isNaN(possibleId)) {
                        try {
                            const pReq = await pool.request()
                                .input('id', sql.Int, possibleId)
                                .query(`
                                    SELECT TOP 1 ProIdProducto 
                                    FROM Articulos 
                                    WHERE IDProdReact = @id 
                                       OR ProIdProducto = @id 
                                    ORDER BY CASE WHEN IDProdReact = @id THEN 1 ELSE 2 END
                                `);
                            if (pReq.recordset.length > 0) {
                                finalProId = pReq.recordset[0].ProIdProducto;
                            }
                        } catch (e) {
                            logger.error("[Preview] Error buscando ProIdProducto por ID/Cod numérico: " + e.message);
                        }
                    }

                    // Cotizar (solo si tenemos el ID resuelto y el cliente)
                    let cotizacion = null;
                    if (finalProId && codClienteERP) {
                        try {
                            // Detectar si es orden de Reposicion (empieza con R)
                            const codigoOrdenUpper = (pedido.idExterno || pedido.codigoOrdenReal || '').trim().toUpperCase();
                            const esReposicion = idPerfilReposicion && codigoOrdenUpper.startsWith('R');
                            const extraProfiles = esReposicion ? [idPerfilReposicion] : [];
                            if (esReposicion) {
                                logger.info(`[PreviewOnDemand] 🔄 Reposición detectada (${codigoOrdenUpper}), inyectando perfil #${idPerfilReposicion}`);
                            }

                            // Recolectar variables dinámicas inyectadas (ej: puntadas)
                            const variablesExtra = srv.variablesEspeciales || {};
                            
                            cotizacion = await PricingService.calculatePrice(
                                { proIdProducto: finalProId, codArticulo: codArticulo }, 
                                cantidad, 
                                codClienteERP, 
                                extraProfiles, 
                                { _desc: pedido.nombreTrabajo, isUrgente: isOrderUrgente, ...variablesExtra }, 
                                'AUTO', 
                                null, 
                                srv.areaId
                            );
                        } catch(err) {
                            logger.error("Error cotizando: " + err.message);
                        }
                    }

                    let errReason = '';
                    if (!finalProId) errReason += 'Producto no mapeado. ';
                    if (!codClienteERP) errReason += 'Cliente no encontrado. ';

                    resultadosPreview.push({
                        orden: pedido.idExterno || pedido.codigoOrdenReal || pedido.nombreTrabajo,
                        modo: nodoPrioridad,
                        idCliente: reqClienteDisplay,
                        nombreTrabajo: pedido.nombreTrabajo || 'Sin Nombre',
                        material: material,
                        cantidad: cantidad,
                        precioUnitario: cotizacion ? cotizacion.precioUnitario : 0,
                        importe: cotizacion ? cotizacion.precioTotal : 0,
                        moneda: cotizacion ? cotizacion.moneda : (errReason ? '---' : 'UYU'),
                        perfil: (cotizacion && cotizacion.perfilesAplicados && cotizacion.perfilesAplicados.length > 0) ? cotizacion.perfilesAplicados.join(', ') : 'Precio Base',
                        pricingTrace: cotizacion ? cotizacion.txt : `No cotizable en Pre-visualización. ${errReason}`,
                        _raw: pedido,
                        clienteNoEncontrado: !codClienteERP,
                        articuloNoEncontrado: !finalProId,
                        tecnicos: pedido.archivosTecnicos || [],
                        referencias: pedido.archivosReferencia || [],
                        diseno: items.length > 0 ? items[0].fileName : "Sin link",
                        nota: (() => { const n = pedido.notasGenerales || srv.nota || pedido.nota || ''; return (n.includes('http') || n.includes('drive.google')) ? '' : n; })(),
                        yaExiste: yaExisteEnBd
                    });
                }
            } else if (pedido.items || pedido.lineas) {
                const arr = pedido.items || pedido.lineas || [];
                let cantidad = arr.reduce((sum, it) => sum + (parseInt(it.cantidad || it.copies) || 1), 0) || 1;
                if (pedido.metrosTotales || pedido.metrosReales) {
                    const parsedMetros = parseFloat((pedido.metrosTotales || pedido.metrosReales).toString().replace(',', '.'));
                    if (!isNaN(parsedMetros) && parsedMetros > 0) cantidad = parsedMetros;
                }
                const nodoPrioridad = pedido.prioridad || 'Normal';

                resultadosPreview.push({
                    orden: pedido.idExterno || pedido.codigoOrdenReal || pedido.nombreTrabajo,
                    modo: nodoPrioridad,
                    idCliente: reqClienteDisplay,
                    nombreTrabajo: pedido.nombreTrabajo || 'Sin Nombre',
                    material: 'Genérico',
                    cantidad: cantidad,
                    precioUnitario: 0,
                    importe: 0,
                    moneda: 'UYU',
                    perfil: 'N/A',
                    pricingTrace: 'Material genérico, no cotizable mecánicamente.',
                    _raw: pedido,
                    yaExiste: yaExisteEnBd
                });
            } else {
                 resultadosPreview.push({
                    orden: pedido.idExterno || pedido.codigoOrdenReal || pedido.nombreTrabajo,
                    modo: pedido.prioridad || 'Normal',
                    idCliente: reqCodCliente || '?',
                    nombreTrabajo: pedido.nombreTrabajo || 'Sin Nombre',
                    material: 'Ninguno',
                    cantidad: 1,
                    precioUnitario: 0,
                    importe: 0,
                    moneda: 'UYU',
                    perfil: 'N/A',
                    pricingTrace: 'Sin material, sin cotización.',
                    _raw: pedido,
                    yaExiste: yaExisteEnBd
                });
            }
        }

        res.json({
            message: 'Órdenes Procesadas y Cotizadas',
            preview: resultadosPreview,
            rawAppScript: appScriptData
        });

    } catch (e) {
        logger.error(`[PreviewOnDemand] Error: ${e.message}`);
        res.status(500).json({ error: 'Fallo al procesar visualizar: ' + e.message });
    }
};

exports.importOnDemand = async (req, res) => {
    logger.info("[ImportOnDemand] Iniciando importado manual (Modo Acelerado)...");
    const { docNumbers, payloads } = req.body;

    if (!docNumbers || !Array.isArray(docNumbers) || docNumbers.length === 0) {
        return res.status(400).json({ error: 'No se entregaron números de documento válidos.' });
    }

    try {
        let ordenesEncontradasRaw = payloads;

        // Si no nos pasan los payloads cacheados del Frontend, hacemos fallback a Sheets
        if (!ordenesEncontradasRaw || ordenesEncontradasRaw.length === 0) {
            if (!APPS_SCRIPT_URL) return res.status(500).json({ error: 'La URL del Apps Script no está configurada.' });

            const detectArea = (str) => {
                let s = str.toUpperCase().trim();
                //... (fallback basico omitido en acelerado, usamos lo directo)
                return 'DF';
            };

            const codigosStr = docNumbers.map(n => n.trim()).filter(n => n.length > 0).join(",");
            logger.info(`[ImportOnDemand] Fallback: Pidiendo a Sheets EN BATCH: ${codigosStr}`);

            const response = await axios.get(APPS_SCRIPT_URL, {
                params: {
                    action: 'importarOrdenesManual',
                    ordenes: codigosStr,
                    area: 'DF',
                    apiKey: 'planillas-macrosoft-2026'
                },
                timeout: 60000
            });

            const appScriptData = response.data;
            if (!appScriptData || !appScriptData.ok) {
                return res.status(404).json({ error: 'Error del script: ' + (appScriptData?.error || 'Desconocido') });
            }
            ordenesEncontradasRaw = appScriptData.data || [];
        }

        if (ordenesEncontradasRaw.length === 0) {
            return res.status(404).json({ error: 'No se procesó con éxito ninguna de las órdenes. Errores: ' + (appScriptData?.error || 'N/A') });
        }

        const SheetsRawMappingService = require('../services/sheetsRawMappingService');
        const ordenesEncontradas = ordenesEncontradasRaw.map(orden => {
             if (orden && (orden.datosPorHoja || orden.rawRow)) {
                  if (!orden.servicios || orden.servicios.length === 0) {
                       const originalArchivosReferencia = orden.archivosReferencia;
                       const mapped = SheetsRawMappingService.mapToOrderPayload(orden);
                       if (mapped) {
                           // Preservamos y de-duplicamos archivos de referencia
                           if (originalArchivosReferencia && originalArchivosReferencia.length > 0) {
                               if (!mapped.archivosReferencia || mapped.archivosReferencia.length === 0) {
                                   mapped.archivosReferencia = originalArchivosReferencia;
                               } else {
                                   const urls = new Set(mapped.archivosReferencia.map(r => (r.url || '').toLowerCase().trim()));
                                   for (const ref of originalArchivosReferencia) {
                                       if (ref.url && !urls.has(ref.url.toLowerCase().trim())) {
                                           mapped.archivosReferencia.push(ref);
                                       }
                                   }
                               }
                           }
                           if (orden.rowNumber && !mapped.rowNumber) mapped.rowNumber = orden.rowNumber;
                           if (orden.clienteInfo && !mapped.clienteInfo) mapped.clienteInfo = orden.clienteInfo;
                       }
                       return mapped;
                  }
             }
             return orden; 
        }).filter(o => o !== null);
        // ── CORRECCIÓN DE METROS ─────────────────────────────────────────────────
        // importarOrdenesManual puede devolver metrosTotales incorrecto (ej: número
        // de archivos en vez de metros reales). Usamos getDatosDesdeSheets
        // (acción getCantidadMaterial — la misma del scanner QR) para corregirlo.
        const ordenesExternasSvc = require('../services/ordenesExternasService');
        await Promise.all(ordenesEncontradas.map(async (pedido) => {
            if (!pedido) return;
            const codigo = pedido.idExterno || pedido.codigoOrdenReal;
            if (!codigo) return;
            try {
                const datosReales = await ordenesExternasSvc.getDatosDesdeSheets(codigo);
                if (datosReales && datosReales.cantidad > 0) {
                    const cantAnterior = pedido.metrosTotales;
                    pedido.metrosTotales = datosReales.cantidad;
                    pedido.metrosReales  = datosReales.cantidad;
                    if (pedido.servicios && pedido.servicios[0] && pedido.servicios[0].cabecera) {
                        pedido.servicios[0].cabecera.metros = datosReales.cantidad;
                    }
                    logger.info('[PreviewOnDemand] metros corregidos ' + codigo + ': ' + cantAnterior + ' > ' + datosReales.cantidad + ' (' + datosReales.material + ')');
                }
            } catch(e) {
                logger.warn('[PreviewOnDemand] No se pudo corregir metros de ' + codigo + ': ' + e.message + '. Usando ' + pedido.metrosTotales);
            }
        }));


        const resultadosNuevos = [];
        const port = process.env.PORT || 5000;

        // 2. ENVIAR CADA ORDEN GENERADA DE VUELTA A NUESTRO SISTEMA DE INTEGRACIÓN (IGUAL QUE EL CRON)
        for (const pedido of ordenesEncontradas) {
            if (!pedido) continue;
            try {
                 logger.info(`[ImportOnDemand] Inyectando JSON complejo de orden: ${pedido?.idExterno || pedido?.codigoOrdenReal || 'Desc'}`);
                 
                 await axios.post(`http://localhost:${port}/api/web-orders/integration/create`, pedido, {
                     headers: {
                         'x-api-key': process.env.INTEGRATION_API_KEY || 'macrosoft-secret-key'
                     },
                     timeout: 30000
                 });

                 resultadosNuevos.push({
                     CodigoOrden: pedido.idExterno || pedido.codigoOrdenReal || pedido.nombreTrabajo,
                     Area: pedido.idServicioBase,
                     Nota: 'Procesada con éxito e inyectada'
                 });

            } catch(e) {
                 logger.error(`[ImportOnDemand] Falla al inyectar orden localmente: ${e.message}`);
                 // Continuamos con las demas
            }
        }

        res.json({
            message: 'Importación Manual Exitosa (Modo Completo)',
            nuevosPedidos: resultadosNuevos
        });

    } catch (e) {
        logger.error(`[ImportOnDemand] Error general: ${e.message}`);
        res.status(500).json({ error: 'Fallo al procesar o llamar servidor backend. ' + e.message });
    }
};
