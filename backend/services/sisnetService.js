const soap = require('soap');
const logger = require('../utils/logger');
const { getPool, sql } = require('../config/db');

// La URL de WSDL y las credenciales vienen del .env
const WSDL_URL = process.env.SISNET_WSDL_URL || 'http://test.sisnet.com.uy:8062/EfacturaWeb/wsService?wsdl';
const USER = process.env.SISNET_USER || '001099';
const PASS = process.env.SISNET_PASS || '001099';
const CAJA = process.env.SISNET_CAJA || '1/TEST';
const TASA_BASICA = process.env.SISNET_TASA_BASICA || 'tasa_basica';
const TASA_MINIMA = process.env.SISNET_TASA_MINIMA || 'tasa_Minima';

/**
 * Emite un CFE real a SISNET usando la factura y sus detalles.
 * @param {Object} doc - El objeto de la cabecera de la factura (con datos del cliente).
 * @param {Array} lineas - Array de DocumentosContablesDetalle.
 * @param {Number} cotDolar - Cotización del dólar actual.
 * @returns {Promise<Object>} - Devuelve un objeto con CAE, URL, Serie, etc.
 */
exports.emitirCFE = async (doc, lineas, cotDolar = 40.0) => {
    // 1. Cargar referencias si existen (Requerido por DGI para Notas de Crédito y Débito)
    let listaWsReferencias = [];
    if (doc.DocIdDocumentoRef) {
        try {
            logger.info(`[SISNET-Service] Buscando documento referenciado con ID: ${doc.DocIdDocumentoRef}`);
            const pool = await getPool();
            const refRes = await pool.request()
                .input('RefId', sql.Int, doc.DocIdDocumentoRef)
                .query(`SELECT DocTipo, DocSerie, DocNumero, DocFechaEmision, DocTotal, MonIdMoneda, CfeNumeroOficial
                        FROM dbo.DocumentosContables WHERE DocIdDocumento = @RefId`);
            
            if (refRes.recordset.length > 0) {
                const refDoc = refRes.recordset[0];
                // Para e-Tickets (B2C) NO se envía wsReceptor → no necesitamos el RUT aquí
                // Solo para e-Facturas (B2B) leemos el RUT del comprador
                const rutReceptorRef = (doc.CliRUT || doc.DocCliDocumento || '').replace(/\D/g, '').trim();
                const esRUT = (rutReceptorRef.length === 12);
                
                const refTipoUpper = (refDoc.DocTipo || '').toUpperCase();
                let tpoDocRef = 'e_Ticket';
                
                if (refTipoUpper.includes('TICKET')) {
                    if (refTipoUpper.includes('CREDITO') || refTipoUpper.includes('CRE')) {
                        tpoDocRef = 'nc_e_Ticket';
                    } else if (refTipoUpper.includes('DEBITO') || refTipoUpper.includes('DEB')) {
                        tpoDocRef = 'nd_e_Ticket';
                    } else {
                        tpoDocRef = 'e_Ticket';
                    }
                } else if (refTipoUpper.includes('FACTURA')) {
                    if (refTipoUpper.includes('CREDITO') || refTipoUpper.includes('CRE')) {
                        tpoDocRef = 'nc_e_Factura';
                    } else if (refTipoUpper.includes('DEBITO') || refTipoUpper.includes('DEB')) {
                        tpoDocRef = 'nd_e_Factura';
                    } else {
                        tpoDocRef = 'e_Factura';
                    }
                } else {
                    tpoDocRef = esRUT ? 'e_Factura' : 'e_Ticket';
                }
                
                let refSerie = refDoc.DocSerie || 'B';
                let refNumero = parseInt(refDoc.DocNumero, 10) || 1;
                
                if (refDoc.CfeNumeroOficial) {
                    const text = refDoc.CfeNumeroOficial;
                    const match = text.match(/Serie\s+([A-Za-z]+)\s+(\d+)/i) || text.match(/Serie\s+([A-Za-z]+)-(\d+)/i) || text.match(/([A-Za-z]+)-(\d+)/i);
                    if (match) {
                        refSerie = match[1];
                        refNumero = parseInt(match[2], 10);
                    }
                }
                
                const fechaRef = new Date(refDoc.DocFechaEmision).toLocaleDateString('en-GB'); // DD/MM/YYYY
                
                listaWsReferencias.push({
                    nroLinRef: 1,
                    indicadorReferenciaGlobal: 0,
                    tpoDocRef: tpoDocRef,
                    serie: refSerie,
                    nroCFERef: refNumero,
                    fechaCFEref: fechaRef,
                    razonReferencia: (doc.DocMotivoRef || 'Reverso').substring(0, 90),
                    mntCFEref: Number(Number(refDoc.DocTotal || 0).toFixed(2))
                });
                logger.info(`[SISNET-Service] Referencia cargada correctamente: tipo=${tpoDocRef}, serie=${refSerie}, nro=${refNumero}`);
            } else {
                logger.warn(`[SISNET-Service] Documento referenciado con ID ${doc.DocIdDocumentoRef} no fue encontrado en la base de datos.`);
            }
        } catch (errRef) {
            logger.error("[SISNET-Service] Error consultando referencia en BD: " + errRef.message);
        }
    }

    return new Promise((resolve, reject) => {
        logger.info(`[SISNET-Service] Conectando a SOAP: ${WSDL_URL}`);
        
        soap.createClient(WSDL_URL, (err, client) => {
            if (err) {
                logger.error("[SISNET-Service] Error creando cliente SOAP: ", err);
                return reject(new Error('Error conectando a SISNET: ' + err.message));
            }

            // 1. Configurar seguridad básica (usuario/password) en los headers SOAP
            const security = new soap.BasicAuthSecurity(USER, PASS);
            client.setSecurity(security);

            // 2. Determinar tipo de CFE y Tipo de Documento del Receptor
            // Para e-Facturas (B2B): se incluye wsReceptor con RUT real
            // Para e-Tickets (B2C): NO se incluye wsReceptor (DGI no lo requiere y rechaza RUTs inválidos)
            const docCliDoc = (doc.CliRUT || doc.DocCliDocumento || '').replace(/\D/g, '').trim();
            const esRUT = (docCliDoc.length === 12); // RUT uruguayo = 12 dígitos
            const esCI  = (docCliDoc.length >= 6 && docCliDoc.length <= 8);
            // tipoDocRecep: 2=RUT, 3=CI (solo aplica para e-Facturas)
            const tipoDocRecep = esRUT ? 2 : 3;

            const docTipoUpper = (doc.DocTipo || '').toUpperCase();
            let tipoCFE = 101;
            if (docTipoUpper.includes('CREDITO') || docTipoUpper.includes('CRE')) {
                tipoCFE = esRUT ? 112 : 102;
            } else if (docTipoUpper.includes('DEBITO') || docTipoUpper.includes('DEB')) {
                tipoCFE = esRUT ? 113 : 103;
            } else {
                tipoCFE = esRUT ? 111 : 101;
            }

            // ¿Es e-Ticket (B2C)? → tipoCFE 101, 102, 103 → NO enviar wsReceptor
            const esETicket = [101, 102, 103].includes(tipoCFE);

            const rznSoc = (doc.CliRazonSocial || doc.DocCliNombre || '').trim() || 'Consumidor Final';
            const direccion = (doc.CliDireccion || doc.DocCliDireccion || '').trim() || 'Sin Direccion';
            const ciudad = (doc.DocCliCiudad || '').trim() || 'Montevideo';

            // 3. Solicitar CAE
            logger.info(`[SISNET-Service] Solicitando CAE para Tipo CFE: ${tipoCFE}...`);
            const argsCAE = { tipoCFE, claveUnicaCaja: CAJA };

            client.obtenerCAE(argsCAE, (errCae, resultCae) => {
                if (errCae || resultCae?.return?.hayError) {
                    const errorMsg = errCae ? errCae.message : resultCae?.return?.errorDes;
                    logger.error("[SISNET-Service] Error obteniendo CAE: ", errorMsg);
                    return reject(new Error('Error al obtener CAE: ' + errorMsg));
                }

                logger.info(`[SISNET-Service] CAE obtenido con éxito: ${resultCae.return.numero}`);
                const wsCAE = resultCae.return;

                // DGI exige estricta precisión matemática (2 decimales) independientemente de la moneda.
                const fixD = (num) => Number(Number(num || 0).toFixed(2));

                // 4. Mapear Líneas
                let mntNetoIvaTasaBasica = 0;
                let mntNoGrv = 0;
                
                const listaWsItems = lineas.map((linea, index) => {
                    let indFact = 3; // 3 = Gravado a Tasa Básica por defecto, 2 = Mínima, 1 = Exento
                    if (linea.DcdImpuestos === 0) indFact = 1;

                    let montoLineaBruto = (indFact === 3 || indFact === 2) ? (linea.DcdSubtotal || 0) : (linea.DcdTotal || 0);
                    let montoLinea = fixD(montoLineaBruto);

                    if (indFact === 3) {
                        mntNetoIvaTasaBasica += montoLinea;
                    } else if (indFact === 1) {
                        mntNoGrv += montoLinea;
                    }

                    // Aseguramos que la matemática de la línea cuadre perfecto para SISNET
                    // SISNET valida estrictamente: montoItem = cantidad * precioUnitario
                    const cantidadItem = linea.DcdCantidad || 1;
                    const precioUn = montoLinea / cantidadItem;

                    return {
                        nroLinDet: index + 1,
                        indFact: indFact, 
                        nomItem: (linea.DcdNomItem || 'Item').substring(0, 80),
                        cantidad: cantidadItem,
                        uniMed: 'UN',
                        precioUnitario: Number(precioUn.toFixed(4)),
                        montoItem: montoLinea
                    };
                });

                // DGI REGLA ESTRICTA: El IVA enviado a SISNET debe ser el 22% exacto (a 2 decimales) del Neto Gravado.
                let mntIVATasaBas = fixD(mntNetoIvaTasaBasica * 0.22);

                // 5. Construir Objeto Principal
                // Calculamos el Total estrictamente a partir de lo acumulado para no fallar la regla de DGI
                const mntTotal = fixD(mntNetoIvaTasaBasica + mntIVATasaBas + mntNoGrv);

                const cfeData = {
                    // Para e-Tickets (B2C) NO se incluye wsReceptor — DGI no lo requiere
                    // Para e-Facturas (B2B) se incluye con el RUT real del comprador
                    ...(esETicket ? {} : {
                        wsReceptor: {
                            tipoDocRecep: tipoDocRecep,
                            codPaisRecep: 'UY',
                            docRecep: docCliDoc,
                            rznSocRecep: (doc.CliRazonSocial || doc.DocCliNombre || '').trim() || 'Sin Nombre',
                            dirRecep: (doc.CliDireccion || doc.DocCliDireccion || '').trim() || 'Sin Direccion',
                            ciudadRecep: (doc.DocCliCiudad || '').trim() || 'Montevideo',
                            deptoRecep: 'Montevideo'
                        }
                    }),
                    wsTotales: {
                        tpoMoneda: doc.MonIdMoneda === 2 ? 'USD' : 'UYU', 
                        tpoCambio: doc.MonIdMoneda === 2 ? cotDolar : 1.0,
                        mntNoGrv: mntNoGrv, 
                        mntNetoIvaTasaBasica: mntNetoIvaTasaBasica,
                        iVATasaBas: TASA_BASICA,
                        mntIVATasaBas: mntIVATasaBas,
                        mntNetoIvaTasaMin: 0,
                        iVATasaMin: TASA_MINIMA,
                        mntIVATasaMin: 0,
                        mntTotal: mntTotal,
                        cantLinDet: listaWsItems.length,
                        montoNF: 0,
                        mntPagar: mntTotal
                    },
                    listaWsItems: listaWsItems,
                    listaWsReferencias: listaWsReferencias,
                    wsVarios: {
                        fchEmis: new Date().toLocaleDateString('en-GB'), // DD/MM/YYYY
                        fhcVenc: new Date().toLocaleDateString('en-GB'), // Podría sumarle DocDiasVencimiento
                        fmaPago: doc.DocPagado ? 1 : 2, // 1 Contado, 2 Credito
                        comprobanteTipo: tipoCFE, 
                        mntBruto: 0,
                        textoObservacion: doc.DocObservaciones ? doc.DocObservaciones.substring(0, 100) : ''
                    },
                    wsCAE: wsCAE
                };

                logger.info(`[SISNET-Service] Enviando CFE a SISNET...`);

                // 6. Enviar a RecepcionCFE
                client.recepcionCFE(cfeData, (err, result) => {
                    if (err) {
                        logger.error("[SISNET-Service] Error en recepcionCFE: ", err);
                        return reject(new Error('Error enviando CFE: ' + err.message));
                    }

                    if (result?.return?.hayError) {
                        logger.error("[SISNET-Service] Rechazo SISNET: ", result.return.mensaje);
                        return reject(new Error('SISNET Rechazó el documento: ' + result.return.mensaje));
                    }

                    logger.info(`[SISNET-Service] Factura aceptada exitosamente. Hash: ${result.return.hash}`);
                    
                    // Extraer número y serie reales del urlQR
                    let docNum = wsCAE.numero;
                    let docSerie = wsCAE.serie || 'B';
                    if (result.return.urlQR) {
                        try {
                            const parts = result.return.urlQR.split('?');
                            if (parts.length > 1) {
                                const queryParams = parts[1].split(',');
                                if (queryParams.length >= 4) {
                                    if (queryParams[2]) docSerie = queryParams[2].trim();
                                    if (queryParams[3]) docNum = parseInt(queryParams[3].trim(), 10);
                                }
                            }
                        } catch (e) {
                            logger.error("[SISNET-Service] Error parsing urlQR for document number/serie:", e);
                        }
                    }

                    // Reconstruir la serie/número en el formato esperado por el frontend
                    const template = result.return.datosCaeSerie || '';
                    const match = template.match(/Nro\.\s+de\s+CAE\s+(\d+)\s+Serie\s+([A-Za-z]+)\s+(\d+)\s*(?:\/\s*(\d+))?/i);
                    let caeAutorizacion = wsCAE.numeroAutorizacion || '';
                    let totalRange = '';

                    if (match) {
                        caeAutorizacion = match[1];
                        if (!docSerie) docSerie = match[2];
                        totalRange = match[4] || '';
                    }

                    const rebuiltSerie = `Nro. de CAE ${caeAutorizacion} Serie ${docSerie} ${docNum}${totalRange ? ' / ' + totalRange : ''}`;

                    resolve({
                        cae: wsCAE.numeroAutorizacion || wsCAE.numero,
                        serie: rebuiltSerie,
                        vencimiento: result.return.datosCaeVencimiento,
                        hash: result.return.hash,
                        qr: result.return.qr,
                        urlQR: result.return.urlQR,
                        resolucion: result.return.resolucion
                    });
                });
            });
        });
    });
};
