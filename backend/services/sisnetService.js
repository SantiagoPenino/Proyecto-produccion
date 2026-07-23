const soap = require('soap');
const logger = require('../utils/logger');
const { getPool, sql } = require('../config/db');
const crypto = require('./cryptoService');
const { validarDocumentoUY } = require('../utils/documentoUY');

// La URL de WSDL y las credenciales vienen del .env
const WSDL_URL = process.env.SISNET_WSDL_URL || 'http://test.sisnet.com.uy:8062/EfacturaWeb/wsService?wsdl';
const USER = process.env.SISNET_USER || '001099';
const PASS = process.env.SISNET_PASS || '001099';
const CAJA = process.env.SISNET_CAJA || '1/TEST';
const TASA_BASICA = process.env.SISNET_TASA_BASICA || 'tasa_basica';
const TASA_MINIMA = process.env.SISNET_TASA_MINIMA || 'tasa_Minima';

/**
 * Decide QUÉ tipo de CFE se le pide a DGI. Es la única fuente de verdad: la usa
 * emitirCFE y también el script de verificación, para que lo que se audita sea
 * exactamente lo que se envía.
 *
 * 101 e-Ticket | 102 NC de e-Ticket | 103 ND de e-Ticket
 * 111 e-Factura | 112 NC de e-Factura | 113 ND de e-Factura
 *
 * @param {string} docTipo   - DocTipo del documento a emitir (ojo: varchar(20), viene truncado).
 * @param {string} docCliDoc - RUT/CI del receptor (solo dígitos o con formato).
 * @param {boolean|null} refEsFactura - true si el documento REFERENCIADO es e-Factura,
 *                                      false si es e-Ticket, null si no hay referencia.
 */
exports.resolverTipoCFE = (docTipo, docCliDoc, refEsFactura = null) => {
    const esRUT = String(docCliDoc || '').replace(/\D/g, '').trim().length === 12;

    // DocTipo es varchar(20) en la base: "E-Ticket Nota De Credito" se guarda TRUNCADO como
    // "E-Ticket Nota De Cre". Por eso comparamos contra el prefijo "NOTA DE CR"/"NOTA DE D",
    // no contra la palabra completa. Los prefijos quedan antes de cualquier tilde
    // ("NOTA DE CRÉDITO" empieza igual que "NOTA DE CREDITO"), así que no hace falta normalizar.
    const t = String(docTipo || '').toUpperCase();
    const isDocNC = /\bNC\b/.test(t) || t.includes('NOTA DE CR') || t.includes('NOTA_CREDITO');
    const isDocND = /\bND\b/.test(t) || t.includes('NOTA DE D')  || t.includes('NOTA_DEBITO');

    // Para NC/ND la familia (e-Ticket vs e-Factura) la manda el documento REFERENCIADO,
    // no el RUT del cliente: DGI rechaza una NC de e-Factura (112) que referencie un e-Ticket.
    const familiaEsFactura = (isDocNC || isDocND) && refEsFactura !== null ? refEsFactura : esRUT;

    let tipoCFE;
    if (isDocNC)      tipoCFE = familiaEsFactura ? 112 : 102;
    else if (isDocND) tipoCFE = familiaEsFactura ? 113 : 103;
    else              tipoCFE = esRUT ? 111 : 101;

    const NOMBRES = {
        101: 'e-Ticket', 102: 'NC de e-Ticket', 103: 'ND de e-Ticket',
        111: 'e-Factura', 112: 'NC de e-Factura', 113: 'ND de e-Factura'
    };
    return {
        tipoCFE,
        nombre: NOMBRES[tipoCFE],
        isDocNC,
        isDocND,
        esRUT,
        familia: familiaEsFactura ? 'e-Factura' : 'e-Ticket'
    };
};

/**
 * Reproduce la lógica VIEJA (con el bug del DocTipo truncado) para poder auditar qué
 * tipo de CFE se le pidió realmente a DGI en los documentos emitidos ANTES del fix.
 * No se usa para emitir: solo para comparar "lo que se mandó" contra "lo que correspondía".
 *
 * El bug: DocTipo es varchar(20), "E-Ticket Nota De Credito" se guardaba como
 * "E-Ticket Nota De Cre", y ni 'NC' ni 'NOTA DE CREDITO' aparecen ahí, así que toda
 * NC/ND caía en la rama de venta (111/101).
 */
exports.resolverTipoCFE_LEGACY = (docTipo, docCliDoc) => {
    const t = String(docTipo || '').toUpperCase();
    const esRUT = String(docCliDoc || '').replace(/\D/g, '').trim().length === 12;
    const isDocNC = t.includes('NC') || t.includes('NOTA DE CREDITO') || t.includes('NOTA DE CRÉDITO');
    const isDocND = t.includes('ND') || t.includes('NOTA DE DEBITO') || t.includes('NOTA DE DÉBITO');
    if (isDocNC) return esRUT ? 112 : 102;
    if (isDocND) return esRUT ? 113 : 103;
    return esRUT ? 111 : 101;
};

/**
 * Clasifica el documento REFERENCIADO para el bloque de referencias que exige DGI.
 * Usa la misma detección tolerante al truncado de DocTipo que resolverTipoCFE.
 * @returns {string} e_Ticket | e_Factura | nc_e_Ticket | nc_e_Factura | nd_e_Ticket | nd_e_Factura
 */
exports.resolverTpoDocRef = (refDocTipo, esRUT = false) => {
    const t = String(refDocTipo || '').toUpperCase();
    const isNC = /\bNC\b/.test(t) || t.includes('NOTA DE CR') || t.includes('NOTA_CREDITO');
    const isND = /\bND\b/.test(t) || t.includes('NOTA DE D')  || t.includes('NOTA_DEBITO');

    let familia;
    if (t.includes('TICKET'))       familia = 'e_Ticket';
    else if (t.includes('FACTURA')) familia = 'e_Factura';
    else                            familia = esRUT ? 'e_Factura' : 'e_Ticket';

    if (isNC) return 'nc_' + familia;
    if (isND) return 'nd_' + familia;
    return familia;
};

const TIPO_CFE_A_TPODOCREF = {
    101: 'e_Ticket',    111: 'e_Factura',
    102: 'nc_e_Ticket', 112: 'nc_e_Factura',
    103: 'nd_e_Ticket', 113: 'nd_e_Factura'
};

/**
 * Decide cómo se describe ante DGI el documento REFERENCIADO por una NC/ND.
 *
 * Regla: se describe tal como la DGI lo tiene, no como lo llamamos internamente.
 * Un "E-Ticket Contado" a un cliente con RUT se emitió como e-Factura (111), así que
 * la NC debe referenciar un e_Factura y ser 112 — no 102. Guiarse por el DocTipo
 * interno hace que la NC no cierre contra el comprobante real.
 *
 * Prioridad: CfeTipoCFE guardado → reconstrucción con la lógica vigente al emitir →
 * DocTipo interno (único caso: el referenciado nunca se emitió por este sistema,
 * como las facturas del sistema anterior en una NC externa).
 *
 * @param {Object} refDoc { DocTipo, CfeEstado, CfeTipoCFE }
 * @param {string} rutReceptor documento del comprador
 */
exports.resolverReferencia = (refDoc, rutReceptor = '') => {
    const esRUT = String(rutReceptor || '').replace(/\D/g, '').trim().length === 12;

    let tipoEmitido = null;
    let origenDato = null;
    if (refDoc && refDoc.CfeTipoCFE) {
        tipoEmitido = refDoc.CfeTipoCFE;
        origenDato = 'guardado';
    } else if (refDoc && refDoc.CfeEstado === 'ACEPTADO_DGI') {
        tipoEmitido = exports.resolverTipoCFE_LEGACY(refDoc.DocTipo, rutReceptor);
        origenDato = 'reconstruido';
    }

    const tpoDocRef = (tipoEmitido && TIPO_CFE_A_TPODOCREF[tipoEmitido])
        || exports.resolverTpoDocRef(refDoc && refDoc.DocTipo, esRUT);

    return { tpoDocRef, tipoEmitido, origenDato, esFactura: tpoDocRef.includes('e_Factura') };
};

/**
 * Arma el CFE exacto que se le va a mandar a SISNET/DGI, SIN enviarlo y sin pedir CAE.
 *
 * Es la única fuente de verdad del payload: emitirCFE la llama y solo le agrega el
 * wsCAE antes de despachar. Por eso la vista previa de la bandeja CFE muestra lo que
 * realmente viaja, no una reconstrucción aparte que se pueda desincronizar.
 *
 * @returns {Promise<Object>} { tipoCFE, nombreCFE, esETicket, cfeData (sin wsCAE),
 *                              listaWsReferencias, valReceptor, bloqueos[] }
 */
exports.prepararCFE = async (doc, lineas, cotDolar = 40.0, empresa = null) => {
    const TB_EFF = (empresa && empresa.EmpSisnetTasaBasica) || TASA_BASICA;
    const TM_EFF = (empresa && empresa.EmpSisnetTasaMinima) || TASA_MINIMA;

    // Motivos por los que la emisión NO puede seguir. La vista previa los muestra;
    // emitirCFE los convierte en error antes de tocar SISNET.
    const bloqueos = [];

    // 1. Cargar referencias si existen (Requerido por DGI para Notas de Crédito y Débito)
    let listaWsReferencias = [];
    // Naturaleza del documento referenciado: true = e-Factura, false = e-Ticket, null = sin referencia.
    // DGI exige que la NC/ND sea de la MISMA familia que el CFE que corrige.
    let refEsFactura = null;
    if (doc.DocIdDocumentoRef) {
        try {
            logger.info(`[SISNET-Service] Buscando documento referenciado con ID: ${doc.DocIdDocumentoRef}`);
            const pool = await getPool();
            const refRes = await pool.request()
                .input('RefId', sql.Int, doc.DocIdDocumentoRef)
                // SELECT * a propósito: CfeTipoCFE es una columna nueva y nombrarla haría
                // fallar la emisión en una instalación donde todavía no se corrió la migración.
                .query(`SELECT * FROM dbo.DocumentosContables WHERE DocIdDocumento = @RefId`);

            if (refRes.recordset.length > 0) {
                const refDoc = refRes.recordset[0];
                // Para e-Tickets (B2C) NO se envía wsReceptor → no necesitamos el RUT aquí
                // Solo para e-Facturas (B2B) leemos el RUT del comprador
                const rutReceptorRef = (doc.CliRUT || doc.DocCliDocumento || '').replace(/\D/g, '').trim();
                const esRUT = (rutReceptorRef.length === 12);

                // La referencia tiene que describir el CFE tal como LA DGI LO TIENE, no como lo
                // llamamos internamente. Un "E-Ticket Contado" a un cliente con RUT se emite como
                // e-Factura 111: si lo referenciamos como e_Ticket, la NC no cierra contra el
                // comprobante real. Por eso mandamos el tipo realmente emitido.
                const ref = exports.resolverReferencia(refDoc, rutReceptorRef);
                const tpoDocRef = ref.tpoDocRef;

                if (ref.tipoEmitido) {
                    logger.info(`[SISNET-Service] Referencia según lo realmente emitido: CFE ${ref.tipoEmitido} → ${tpoDocRef}` +
                        `${ref.origenDato === 'guardado' ? ' (guardado)' : ' (reconstruido)'} — DocTipo interno: "${String(refDoc.DocTipo).trim()}"`);
                }

                // El CFE que estamos emitiendo debe pertenecer a la misma familia que el referenciado
                refEsFactura = tpoDocRef.includes('e_Factura');

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
                
                // ¿El comprobante corregido lo emitió ESTE sistema? Los documentos "Externo/Externa"
                // son facturas del proveedor de facturación anterior: existen en DGI, pero NO en la
                // base de SISNET, y SISNET valida la referencia contra la suya. Probado con serie y
                // número reales (A-50050): igual responde "No se encontró el CFE referenciado en la
                // base de datos". Por serie y número no hay forma.
                const refEsExterno = /extern[oa]/i.test(refDoc.DocTipo || '');

                // Moneda del comprobante referenciado. SISNET la exige en la referencia de toda
                // NC/ND ("Campo es requerido por parámetro V25"), y hasta ahora nunca se mandaba:
                // cuando el CFE referenciado estaba en su base la deducía sola, pero si no lo
                // encuentra —o va referencia global— no tiene de dónde sacarla y rechaza.
                // Es la del ORIGINAL, no la de la nota: puede diferir.
                const refMoneda = (refDoc.MonIdMoneda ?? doc.MonIdMoneda) === 2 ? 'USD' : 'UYU';

                if (!refEsExterno) {
                    listaWsReferencias.push({
                        nroLinRef: 1,
                        indicadorReferenciaGlobal: 0,
                        tpoDocRef: tpoDocRef,
                        serie: refSerie,
                        nroCFERef: refNumero,
                        fechaCFEref: fechaRef,
                        razonReferencia: (doc.DocMotivoRef || 'Reverso').substring(0, 90),
                        mntCFEref: Number(Number(refDoc.DocTotal || 0).toFixed(2)),
                        monedaReferencia: refMoneda
                    });
                    logger.info(`[SISNET-Service] Referencia cargada correctamente: tipo=${tpoDocRef}, serie=${refSerie}, nro=${refNumero}`);
                } else {
                    // REFERENCIA GLOBAL: sin tipo, serie ni número, así SISNET no busca nada.
                    // Los datos del comprobante original viajan como texto en razonReferencia,
                    // que es donde el estándar espera que se describa un documento referenciado
                    // que no se puede identificar por su CFE.
                    const desc = [
                        /factura/i.test(refDoc.DocTipo || '') ? 'e-Factura' : 'e-Ticket',
                        [refDoc.DocSerie, refDoc.DocNumero].filter(Boolean).join('-'),
                        `del ${fechaRef}`,
                        doc.DocMotivoRef ? `- ${doc.DocMotivoRef}` : ''
                    ].filter(Boolean).join(' ');

                    // El monto sí se informa: con monedaReferencia presente ya es válido, y deja
                    // asentado ante DGI el importe del comprobante que se está corrigiendo.
                    listaWsReferencias.push({
                        nroLinRef: 1,
                        indicadorReferenciaGlobal: 1,
                        razonReferencia: desc.substring(0, 90),
                        fechaCFEref: fechaRef,
                        mntCFEref: Number(Number(refDoc.DocTotal || 0).toFixed(2)),
                        monedaReferencia: refMoneda
                    });
                    // La familia (e-Ticket vs e-Factura) se mantiene con el tipo que el usuario
                    // declaró del original: DGI exige que la NC sea de la misma familia que el
                    // comprobante que corrige, y acá ese dato solo lo sabe quien lo cargó.
                    refEsFactura = /factura/i.test(refDoc.DocTipo || '');
                    logger.warn(`[SISNET-Service] Referenciado #${refDoc.DocIdDocumento} es externo ` +
                        `("${String(refDoc.DocTipo).trim()}" ${refDoc.DocSerie}-${refDoc.DocNumero}): SISNET no lo tiene ` +
                        `en su base. Se referencia en forma GLOBAL: "${desc.substring(0, 90)}"`);
                }
            } else {
                logger.warn(`[SISNET-Service] Documento referenciado con ID ${doc.DocIdDocumentoRef} no fue encontrado en la base de datos.`);
            }
        } catch (errRef) {
            logger.error("[SISNET-Service] Error consultando referencia en BD: " + errRef.message);
        }
    }

    // 2. Determinar tipo de CFE y Tipo de Documento del Receptor
    // Para e-Facturas (B2B): se incluye wsReceptor con RUT real
    // Para e-Tickets (B2C): NO se incluye wsReceptor (DGI no lo requiere y rechaza RUTs inválidos)
    const docCliDoc = (doc.CliRUT || doc.DocCliDocumento || '').replace(/\D/g, '').trim();

    // El tipo de CFE lo resuelve una sola función (exports.resolverTipoCFE), para que
    // la vista previa y el script de verificación auditen exactamente lo que se envía.
    const resTipo = exports.resolverTipoCFE(doc.DocTipo, docCliDoc, refEsFactura);
    const { tipoCFE, isDocNC, isDocND } = resTipo;

    if (isDocNC || isDocND) {
        logger.info(`[SISNET-Service] ${isDocNC ? 'NC' : 'ND'} detectada (DocTipo="${doc.DocTipo}") → tipoCFE=${tipoCFE} (${resTipo.nombre})` +
            ` | familia=${resTipo.familia} refEsFactura=${refEsFactura} referencias=${listaWsReferencias.length}`);
        if (listaWsReferencias.length === 0) {
            bloqueos.push('Una Nota de Crédito/Débito no se puede emitir sin la referencia al documento original: la DGI la exige. Verificá que el documento tenga cargado el documento de origen.');
        }
    }

    // ¿Es e-Ticket (B2C)? → tipoCFE 101, 102, 103 → NO enviar wsReceptor
    const esETicket = [101, 102, 103].includes(tipoCFE);

    // DGI exige estricta precisión matemática (2 decimales) independientemente de la moneda.
    const fixD = (num) => Number(Number(num || 0).toFixed(2));

    // 3. Mapear Líneas
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

    // 4. Construir Objeto Principal
    // Calculamos el Total estrictamente a partir de lo acumulado para no fallar la regla de DGI
    const mntTotal = fixD(mntNetoIvaTasaBasica + mntIVATasaBas + mntNoGrv);

    // Receptor: e-Facturas SIEMPRE lo llevan; e-Tickets lo llevan solo cuando hay
    // CI/RUT VÁLIDO (dígito verificador OK) — DGI exige identificar al comprador
    // en tickets sobre el umbral de UI, y así el dato realmente llega a DGI.
    const valReceptor = validarDocumentoUY(docCliDoc);
    const wsReceptorData = {
        wsReceptor: {
            tipoDocRecep: valReceptor.tipo === 'RUT' ? 2 : 3, // 2=RUT, 3=CI
            codPaisRecep: 'UY',
            docRecep: valReceptor.normalizado || docCliDoc,
            rznSocRecep: (doc.CliRazonSocial || doc.DocCliNombre || '').trim() || 'Sin Nombre',
            dirRecep: (doc.CliDireccion || doc.DocCliDireccion || '').trim() || 'Sin Direccion',
            ciudadRecep: (doc.DocCliCiudad || '').trim() || 'Montevideo',
            deptoRecep: 'Montevideo'
        }
    };
    if (esETicket && valReceptor.valido) {
        logger.info(`[SISNET-Service] e-Ticket con receptor identificado (${valReceptor.tipo} ${valReceptor.normalizado})`);
    }

    // Una NC/ND de e-Factura sin receptor identificado no es emitible
    if ((isDocNC || isDocND) && !esETicket && !valReceptor.valido) {
        bloqueos.push(`Una Nota de Crédito/Débito de e-Factura necesita el RUT válido del cliente. ${valReceptor.motivo || ''}`.trim());
    }

    const cfeData = {
        ...(esETicket ? (valReceptor.valido ? wsReceptorData : {}) : wsReceptorData),
        wsTotales: {
            tpoMoneda: doc.MonIdMoneda === 2 ? 'USD' : 'UYU',
            tpoCambio: doc.MonIdMoneda === 2 ? cotDolar : 1.0,
            mntNoGrv: mntNoGrv,
            mntNetoIvaTasaBasica: mntNetoIvaTasaBasica,
            iVATasaBas: TB_EFF,
            mntIVATasaBas: mntIVATasaBas,
            mntNetoIvaTasaMin: 0,
            iVATasaMin: TM_EFF,
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
        }
        // wsCAE lo agrega emitirCFE con el CAE que devuelve SISNET
    };

    return {
        tipoCFE,
        nombreCFE: resTipo.nombre,
        familia: resTipo.familia,
        esETicket,
        esNC: isDocNC,
        esND: isDocND,
        incluyeReceptor: !!cfeData.wsReceptor,
        valReceptor,
        listaWsReferencias,
        cfeData,
        bloqueos
    };
};

/**
 * Emite un CFE real a SISNET usando la factura y sus detalles.
 * @param {Object} doc - El objeto de la cabecera de la factura (con datos del cliente).
 * @param {Array} lineas - Array de DocumentosContablesDetalle.
 * @param {Number} cotDolar - Cotización del dólar actual.
 * @returns {Promise<Object>} - Devuelve un objeto con CAE, URL, Serie, etc.
 */
exports.emitirCFE = async (doc, lineas, cotDolar = 40.0, empresa = null) => {
    // 0. Config efectiva: prefiere valores de la empresa (multiempresa), cae al .env si no hay empresa
    const WSDL_EFF = (empresa && empresa.EmpSisnetWsdlUrl) || WSDL_URL;
    const USER_EFF = (empresa && empresa.EmpSisnetUser)    || USER;
    const CAJA_EFF = (empresa && empresa.EmpSisnetCaja)    || CAJA;
    const PASS_EFF = (empresa && empresa.EmpSisnetPass ? crypto.decrypt(empresa.EmpSisnetPass) : null) || PASS;

    logger.info('[SISNET-Service] Emisor caja=' + CAJA_EFF + (empresa ? ' empresaId=' + empresa.EmpIdEmpresa : ' (fallback .env)'));

    // Se arma el MISMO payload que muestra la vista previa de la bandeja
    const prep = await exports.prepararCFE(doc, lineas, cotDolar, empresa);

    if (prep.bloqueos.length > 0) {
        logger.error(`[SISNET-Service] Emisión abortada: ${prep.bloqueos.join(' | ')}`);
        throw new Error(prep.bloqueos.join(' '));
    }

    const { tipoCFE, cfeData } = prep;

    return new Promise((resolve, reject) => {
        logger.info(`[SISNET-Service] Conectando a SOAP: ${WSDL_EFF}`);

        soap.createClient(WSDL_EFF, (err, client) => {
            if (err) {
                logger.error("[SISNET-Service] Error creando cliente SOAP: ", err);
                return reject(new Error('Error conectando a SISNET: ' + err.message));
            }

            // Configurar seguridad básica (usuario/password) en los headers SOAP
            const security = new soap.BasicAuthSecurity(USER_EFF, PASS_EFF);
            client.setSecurity(security);

            // Solicitar CAE del tipo que corresponde (101/111 venta, 102/112 NC, 103/113 ND)
            logger.info(`[SISNET-Service] Solicitando CAE para Tipo CFE: ${tipoCFE} (${prep.nombreCFE})...`);
            const argsCAE = { tipoCFE, claveUnicaCaja: CAJA_EFF };

            client.obtenerCAE(argsCAE, (errCae, resultCae) => {
                if (errCae || resultCae?.return?.hayError) {
                    const errorMsg = errCae ? errCae.message : resultCae?.return?.errorDes;
                    logger.error("[SISNET-Service] Error obteniendo CAE: ", errorMsg);
                    return reject(new Error('Error al obtener CAE: ' + errorMsg));
                }

                logger.info(`[SISNET-Service] CAE obtenido con éxito: ${resultCae.return.numero}`);
                cfeData.wsCAE = resultCae.return;
                const wsCAE = cfeData.wsCAE;

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
                        tipoCFE,              // lo que efectivamente se le pidió a DGI
                        nombreCFE: prep.nombreCFE,
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
