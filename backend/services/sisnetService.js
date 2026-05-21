const soap = require('soap');
const logger = require('../utils/logger');

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
            // Mapeo básico: e-Factura=111, e-Ticket=101. Asumimos e-Factura (111) para RUT y 101 para CI.
            // Limpiamos los strings de la BD que suelen venir con espacios o ser nulos/vacíos
            const rutReceptor = (doc.CliRUT || doc.DocCliDocumento || '').trim() || '999999999999';
            const tipoCFE = (rutReceptor.length === 12) ? 111 : 101; 
            const tipoDocRecep = tipoCFE === 111 ? 2 : 3; // 2=RUT, 3=CI

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
                    wsReceptor: {
                        tipoDocRecep: tipoDocRecep,
                        codPaisRecep: 'UY',
                        docRecep: rutReceptor,
                        rznSocRecep: rznSoc,
                        dirRecep: direccion,
                        ciudadRecep: ciudad,
                        deptoRecep: 'Montevideo'
                    },
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
                    wsVarios: {
                        fchEmis: new Date().toLocaleDateString('en-GB'), // DD/MM/YYYY
                        fhcVenc: new Date().toLocaleDateString('en-GB'), // Podría sumarle DocDiasVencimiento
                        fmaPago: 1, // 1 Contado, 2 Credito
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
                    
                    resolve({
                        cae: wsCAE.numero,
                        serie: result.return.datosCaeSerie,
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
