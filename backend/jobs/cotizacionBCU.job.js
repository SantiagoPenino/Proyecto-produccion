const axios = require('axios');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// ── BCU SOAP API (Banco Central del Uruguay) ──────────────────────────────────
// Moneda 2222 = Dólar USA | 9800 = Unidad Indexada | Grupo 0 = Todos
// WSDL: https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones?wsdl
//
// BCU devuelve cotización INTERBANCARIA. Para llevarla a precio BANCARIO (BROU)
// se aplican estos spreads:
//   Compra = BCU × 0.9945  (-0.55%)
//   Venta  = BCU × 1.0242  (+2.42%)
const BCU_SOAP_URL = 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones';
const BCU_SOAP_ACTION = 'Cotizaaction/AWSBCUCOTIZACIONES.Execute';
const MONEDA_DOLAR = 2222;
const MONEDA_UI = 9800;
const SPREAD_COMPRA = 0.9945;
const SPREAD_VENTA = 1.0150;

function buildBCUSoapRequest(fechaDesde, fechaHasta, moneda = MONEDA_DOLAR) {
    return '<?xml version="1.0" encoding="utf-8"?>' +
        '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">' +
        '<soap:Body>' +
        '<cot:wsbcucotizaciones.Execute>' +
        '<cot:Entrada>' +
        '<cot:Moneda><cot:item>' + moneda + '</cot:item></cot:Moneda>' +
        '<cot:FechaDesde>' + fechaDesde + '</cot:FechaDesde>' +
        '<cot:FechaHasta>' + fechaHasta + '</cot:FechaHasta>' +
        '<cot:Grupo>0</cot:Grupo>' +
        '</cot:Entrada>' +
        '</cot:wsbcucotizaciones.Execute>' +
        '</soap:Body>' +
        '</soap:Envelope>';
}

function formatDate(d) {
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

// Intenta hoy y hasta 4 días atrás (cubre fines de semana y feriados)
async function fetchCotizacionBCU() {
    const fechas = [];
    for (let i = 0; i < 5; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        fechas.push(formatDate(d));
    }

    for (const fecha of fechas) {
        try {
            const soapXml = buildBCUSoapRequest(fecha, fecha);
            const { data } = await axios.post(BCU_SOAP_URL, soapXml, {
                timeout: 15000,
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': BCU_SOAP_ACTION
                }
            });

            const xml = String(data);
            const tcvMatch = xml.match(/<TCV>([\d.]+)<\/TCV>/);
            const tccMatch = xml.match(/<TCC>([\d.]+)<\/TCC>/);
            const interbancario = parseFloat(tcvMatch?.[1] || tccMatch?.[1] || '0');

            if (isFinite(interbancario) && interbancario > 1) {
                const compra = parseFloat((interbancario * SPREAD_COMPRA).toFixed(2));
                const venta = parseFloat((interbancario * SPREAD_VENTA).toFixed(2));
                logger.info(`[COTIZACION] BCU ${fecha}: interbancario=${interbancario} → compra=${compra}, venta=${venta}`);
                return { interbancario, compra, venta };
            }
        } catch (err) {
            logger.warn(`[COTIZACION] BCU ${fecha} falló:`, err.message);
        }
    }

    // Fallback: open.er-api.com (ya devuelve tasa de mercado, no aplicar spread)
    logger.info('[COTIZACION] BCU sin datos, usando fallback open.er-api.com...');
    const { data } = await axios.get('https://open.er-api.com/v6/latest/USD', { timeout: 15000 });
    const rate = data?.rates?.UYU;
    if (!rate || !isFinite(rate) || rate <= 0) {
        throw new Error(`Fallback inválido: UYU=${rate}`);
    }
    const r = parseFloat(rate.toFixed(2));
    return { interbancario: r, compra: r, venta: r };
}

// Valor de la Unidad Indexada de una fecha (AAAA-MM-DD). El BCU tiene la UI de todos los días,
// fines de semana y feriados incluidos (el INE la calcula por adelantado), así que no hace falta
// ir para atrás como con el dólar. Sin fallback: si el BCU no contesta, se lanza el error.
async function fetchUnidadIndexadaBCU(fecha) {
    const { data } = await axios.post(BCU_SOAP_URL, buildBCUSoapRequest(fecha, fecha, MONEDA_UI), {
        timeout: 15000,
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': BCU_SOAP_ACTION
        }
    });
    const xml = String(data);
    const valor = parseFloat(xml.match(/<TCV>([\d.]+)<\/TCV>/)?.[1] || '0');
    if (!(isFinite(valor) && valor > 1)) {
        const mensaje = xml.match(/<mensaje>([^<]*)<\/mensaje>/)?.[1];
        throw new Error(`el BCU no devolvió la UI del ${fecha}${mensaje ? ` (${mensaje})` : ''}`);
    }
    return valor;
}

async function runCotizacionJob() {
    try {
        const pool = await getPool();

        // Verificar si ya se insertó hoy
        const check = await pool.request().query(`
            SELECT COUNT(*) AS cnt FROM Cotizaciones WITH(NOLOCK)
            WHERE CONVERT(DATE, CotFecha) = CONVERT(DATE, GETDATE())
        `);
        if (check.recordset[0].cnt > 0) {
            logger.info('[COTIZACION JOB] Ya existe cotización para hoy. Saltando.');
            return;
        }

        // Obtener cotización
        const cot = await fetchCotizacionBCU();

        // Insertar en DB (guardamos la venta bancaria)
        await pool.request()
            .input('cot', sql.Float, cot.venta)
            .query(`INSERT INTO Cotizaciones (CotIdCotizacion, CotFecha, CotDolar)
                    VALUES ((SELECT ISNULL(MAX(CotIdCotizacion),0)+1 FROM Cotizaciones), GETDATE(), @cot)`);

        logger.info(`[COTIZACION JOB] ✅ Cotización insertada: compra=$U ${cot.compra} / venta=$U ${cot.venta} (interbancario: ${cot.interbancario})`);

    } catch (err) {
        logger.error('[COTIZACION JOB] ❌ Error:', err.message);
    }
}

// ── Scheduler: corre a las 09:10 y 13:30 (BCU publica ~13hs) ──────
function startCotizacionJob() {
    const cron = require('node-cron');

    cron.schedule('10 9 * * 1-5', () => {
        logger.info('[COTIZACION JOB] Ejecutando (09:10 lun-vie)...');
        runCotizacionJob();
    }, { timezone: 'America/Montevideo' });

    cron.schedule('30 13 * * 1-5', () => {
        logger.info('[COTIZACION JOB] Ejecutando respaldo (13:30 lun-vie)...');
        runCotizacionJob();
    }, { timezone: 'America/Montevideo' });

    logger.info('⏱️ [CRON] Cotización BCU: Activado (09:10 y 13:30, Lun-Vie).');
}

module.exports = { startCotizacionJob, runCotizacionJob, fetchCotizacionBCU, fetchUnidadIndexadaBCU };
