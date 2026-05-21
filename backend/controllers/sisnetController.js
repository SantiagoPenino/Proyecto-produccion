// Modificado para forzar reinicio de nodemon y recargar .env
const soap = require('soap');
const logger = require('../utils/logger');

const url = process.env.SISNET_WSDL_URL || 'http://test.sisnet.com.uy:8062/EfacturaWeb/wsService?wsdl';
const user = process.env.SISNET_USER || 'admin';
const pass = process.env.SISNET_PASS || 'admin';

let soapClient = null;

async function getClient() {
  if (soapClient) return soapClient;
  try {
    soapClient = await soap.createClientAsync(url);
    // Configurar autenticación, usualmente Basic Auth para este tipo de WSDL, 
    // o WSSecurity si está configurado así en el WS.
    soapClient.setSecurity(new soap.BasicAuthSecurity(user, pass));
    return soapClient;
  } catch (error) {
    console.error("Error al crear cliente SOAP SISNET:", error);
    throw error;
  }
}

// 1. Probar estado (status)
exports.testStatus = async (req, res) => {
  try {
    const client = await getClient();
    
    // El método WSDL se llama status o statusTest, llamamos statusTest ya que es testing.
    // También podemos llamar a 'status'
    client.statusTest({}, (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Error en SOAP statusTest', error: err.message });
      }
      return res.json({ success: true, data: result });
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Excepción al conectar', error: error.message });
  }
};

// 2. Probar obtención de CAE
exports.testObtenerCAE = async (req, res) => {
  try {
    const client = await getClient();
    const args = {
      tipoCFE: req.params.tipo || 111, // 111 = e-Factura por defecto
      claveUnicaCaja: process.env.SISNET_CAJA || 'CAJA1'
    };
    
    client.obtenerCAE(args, (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Error al obtener CAE', error: err.message });
      }
      return res.json({ success: true, data: result });
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Excepción al obtener CAE', error: error.message });
  }
};

// 3. Probar envío de CFE (recepcionCFE)
exports.testEnviarCFE = async (req, res) => {
  try {
    logger.info("==========================================");
    logger.info("[SISNET] Iniciando prueba de envío CFE (recepcionCFE)");
    const client = await getClient();
    
    // Objeto Mock basado en la documentación de SISNET
    const cfeMock = {
      wsReceptor: {
        tipoDocRecep: 2, // 2 = RUC
        codPaisRecep: 'UY',
        docRecep: process.env.SISNET_RUT || '219999830019',
        rznSocRecep: 'EMPRESA PRUEBA SA',
        dirRecep: '18 de Julio 1234',
        ciudadRecep: 'Montevideo',
        deptoRecep: 'Montevideo'
      },
      wsTotales: {
        tpoMoneda: 'UYU', // Según tipoMoneda (enum)
        tpoCambio: 1.0,
        mntNoGrv: 0,
        mntNetoIvaTasaBasica: 1000, // Total sin iva
        iVATasaBas: 'tasa_basica',
        mntIVATasaBas: 220, // 22% de 1000
        mntNetoIvaTasaMin: 0,
        iVATasaMin: 'tasa_Minima',
        mntIVATasaMin: 0,
        mntTotal: 1220, // Total
        cantLinDet: 1,
        montoNF: 0,
        mntPagar: 1220
      },
      listaWsItems: [
        {
          nroLinDet: 1,
          indFact: 3, // 3 = Tasa Básica
          nomItem: 'Producto de Prueba',
          cantidad: 1,
          uniMed: 'UN',
          precioUnitario: 1000,
          montoItem: 1000
        }
      ],
      wsVarios: {
        fchEmis: new Date().toLocaleDateString('en-GB'), // Formato DD/MM/YYYY
        fhcVenc: new Date().toLocaleDateString('en-GB'),
        fmaPago: 1, // 1 contado, 2 credito
        comprobanteTipo: 111, // e-Factura
        mntBruto: 0,
        textoObservacion: 'Prueba desde sistema'
      }
    };
    
    logger.info("[SISNET] Solicitando CAE previo al envío...");
    const argsCAE = { tipoCFE: 111, claveUnicaCaja: process.env.SISNET_CAJA };
    
    client.obtenerCAE(argsCAE, (errCae, resultCae) => {
      if (errCae || resultCae?.return?.hayError) {
        logger.error("[SISNET] Error obteniendo CAE: ", errCae || resultCae?.return?.errorDes);
        return res.status(500).json({ success: false, message: 'Error obteniendo CAE', error: errCae || resultCae?.return?.errorDes });
      }

      logger.info("[SISNET] CAE obtenido con éxito: " + resultCae.return.numero);
      cfeMock.wsCAE = resultCae.return;

      logger.info("[SISNET] Construyendo el objeto MOCK a enviar:");
      logger.info(JSON.stringify(cfeMock, null, 2));

      client.recepcionCFE(cfeMock, (err, result) => {
        if (err) {
          logger.error("[SISNET] Error en recepcionCFE: ", err);
          return res.status(500).json({ success: false, message: 'Error en recepcionCFE', error: err.message });
        }
        logger.info("[SISNET] Respuesta de SISNET recibida con éxito:");
        logger.info(JSON.stringify(result, null, 2));
        return res.json({ success: true, data: result });
      });
    });
  } catch (error) {
    logger.error("[SISNET] Excepción en recepcionCFE: ", error);
    return res.status(500).json({ success: false, message: 'Excepción en recepcionCFE', error: error.message });
  }
};
