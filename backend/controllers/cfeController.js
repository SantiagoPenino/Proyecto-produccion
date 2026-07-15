const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// ID del cliente genérico "Consumidor Final" — no tiene cuenta corriente propia
const CONSUMIDOR_FINAL_ID = 2089;

// Resuelve la fecha de emisión elegida por el usuario (retrofecha de documentos
// aún no enviados a DGI). Recibe 'YYYY-MM-DD' del frontend y devuelve un Date con
// la HORA ACTUAL, de modo que:
//   · el orden intradía se preserva (evita medianoche 00:00 que reordenaría la bandeja),
//   · si no se envía fecha, retorna null → cada INSERT cae en su GETDATE() (comportamiento actual).
// Devuelve null ante formato inválido para no romper el flujo (se usa GETDATE()).
function resolverFechaDocumento(fechaStr) {
    if (!fechaStr) return null;
    const m = String(fechaStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (!y || !mo || !d || mo > 12 || d > 31) return null;
    const ahora = new Date();
    return new Date(y, mo - 1, d, ahora.getHours(), ahora.getMinutes(), ahora.getSeconds());
}
const { resolverLineasDesdeMotor, generarAsientoCompleto, crearDocumentoContable, actualizarFirmaCFE, anularDocumentoContable } = require('../services/contabilidadCore');
const { validarDocumentoUY } = require('../utils/documentoUY');
const sisnetService = require('../services/sisnetService');
const contabilidadService = require('../services/contabilidadService');

exports.getDocumentosCFE = async (req, res) => {
    try {
        const { fechaDesde, fechaHasta, tipo, estado, clienteId, empresaId, metodoPagoId } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let baseQuery = `
            SELECT 
                d.*,
                c.NombreFantasia AS CliNombreFantasia,
                c.Nombre AS CliRazonSocial,
                c.CioRuc AS CliRUT,
                c.CioRuc AS CliDocumento,
                c.IDCliente AS StringIDCliente,
                (SELECT TOP 1 mp.MPaDescripcionMetodo 
                 FROM dbo.Pagos p WITH(NOLOCK)
                 JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON p.MPaIdMetodoPago = mp.MPaIdMetodoPago
                 WHERE p.PagTcaIdTransaccion = d.TcaIdTransaccion) AS MetodoPagoNombre
            FROM DocumentosContables d
            LEFT JOIN Clientes c ON d.CliIdCliente = c.CliIdCliente
            WHERE d.CfeEstado IS NOT NULL
        `;

        if (fechaDesde) {
            baseQuery += ` AND d.DocFechaEmision >= @fechaDesde`;
            request.input('fechaDesde', sql.Date, fechaDesde);
        }
        if (fechaHasta) {
            baseQuery += ` AND d.DocFechaEmision < DATEADD(day, 1, CAST(@fechaHasta AS DATE))`;
            request.input('fechaHasta', sql.Date, fechaHasta);
        }
        if (tipo) {
            if (tipo === 'FACTURA') {
                baseQuery += ` AND (d.DocTipo LIKE '%Factura%' OR d.DocTipo LIKE '%FACTURA%') AND d.DocTipo NOT LIKE '%Nota%' AND d.DocTipo NOT LIKE '%NOTA%' AND d.CicIdCiclo IS NULL`;
            } else if (tipo === 'FACTURA_CICLO') {
                baseQuery += ` AND (d.DocTipo LIKE '%Factura%' OR d.DocTipo LIKE '%FACTURA%') AND d.CicIdCiclo IS NOT NULL`;
            } else if (tipo === 'E-TICKET') {
                baseQuery += ` AND (d.DocTipo LIKE '%Ticket%' OR d.DocTipo LIKE '%TICKET%') AND d.DocTipo NOT LIKE '%Nota%' AND d.DocTipo NOT LIKE '%NOTA%'`;
            } else if (tipo === 'NOTA_CREDITO') {
                baseQuery += ` AND (d.DocTipo LIKE '%Nota%' OR d.DocTipo LIKE '%NOTA%' OR d.DocTipo LIKE '%Crédito%' OR d.DocTipo LIKE '%CREDITO%')`;
            } else if (tipo === 'RECIBO') {
                baseQuery += ` AND (d.DocTipo LIKE '%RECIBO%' OR d.DocTipo LIKE '%Recibo%')`;
            } else if (tipo === 'PEDIDO_CAJA') {
                baseQuery += ` AND (d.DocTipo LIKE '%Pedido%' OR d.DocTipo LIKE '%PEDIDO%' OR d.DocTipo = 'PedidoCaja' OR d.CfeEstado = 'BORRADOR')`;
            } else {
                baseQuery += ` AND d.DocTipo = @tipo`;
                request.input('tipo', sql.VarChar(50), tipo);
            }
        }
        if (estado) {
            baseQuery += ` AND d.CfeEstado = @estado`;
            request.input('estado', sql.VarChar(50), estado);
        }
        if (clienteId) {
            baseQuery += ` AND d.CliIdCliente = @clienteId`;
            request.input('clienteId', sql.Int, clienteId);
        }
        if (empresaId) {
            baseQuery += ` AND d.EmpIdEmpresa = @empresaId`;
            request.input('empresaId', sql.Int, empresaId);
        }
        if (metodoPagoId) {
            baseQuery += ` AND EXISTS (SELECT 1 FROM dbo.Pagos p2 WITH(NOLOCK) WHERE p2.PagTcaIdTransaccion = d.TcaIdTransaccion AND p2.MPaIdMetodoPago = @metodoPagoId)`;
            request.input('metodoPagoId', sql.Int, metodoPagoId);
        }

        baseQuery += ` ORDER BY d.DocFechaEmision DESC`;

        const result = await request.query(baseQuery);
        res.json(result.recordset);
    } catch (error) {
        logger.error('Error obteniendo documentos CFE:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Inserta una clave en ConfiguracionGlobal SOLO si no existe.
 * La estructura de esa tabla varía según la instalación (columnas NOT NULL como AreaID),
 * así que se descubren las columnas reales vía INFORMATION_SCHEMA y se rellenan
 * las obligatorias sin default: números → 0, fechas → GETDATE(), texto → '' (AreaID → 'ADMIN',
 * que es la convención de esta tabla para claves globales).
 */
async function asegurarClaveConfigGlobal(pool, clave, valorPorDefecto) {
    const existe = await pool.request()
        .input('clave', sql.VarChar(50), clave)
        .query(`SELECT 1 AS x FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = @clave`);
    if (existe.recordset.length > 0) return false;

    const colsRes = await pool.request().query(`
        SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'ConfiguracionGlobal'
    `);
    const nombres = ['[Clave]', '[Valor]'];
    const valores = ['@clave', '@valor'];
    for (const c of colsRes.recordset) {
        if (c.COLUMN_NAME === 'Clave' || c.COLUMN_NAME === 'Valor') continue;
        if (c.IS_NULLABLE === 'NO' && c.COLUMN_DEFAULT == null) {
            const t = String(c.DATA_TYPE || '').toLowerCase();
            nombres.push(`[${c.COLUMN_NAME}]`);
            if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'bit'].includes(t)) {
                valores.push('0');
            } else if (t.includes('date') || t.includes('time')) {
                valores.push('GETDATE()');
            } else {
                valores.push(c.COLUMN_NAME === 'AreaID' ? "'ADMIN'" : "''");
            }
        }
    }
    await pool.request()
        .input('clave', sql.VarChar(50), clave)
        .input('valor', sql.VarChar(100), String(valorPorDefecto))
        .query(`INSERT INTO dbo.ConfiguracionGlobal (${nombres.join(', ')}) VALUES (${valores.join(', ')})`);
    return true;
}

/**
 * GET /contabilidad/cfe/config-dgi
 * Umbral DGI para identificar al receptor en e-Tickets (10.000 UI) y valor de la UI.
 * Configurable en dbo.ConfiguracionGlobal (claves DGI_LIMITE_UI / DGI_VALOR_UI) sin rebuild.
 */
exports.getConfigDGI = async (req, res) => {
    try {
        const pool = await getPool();
        // Seed idempotente: crea las claves si no existen para que queden editables en ConfiguracionGlobal
        try {
            await asegurarClaveConfigGlobal(pool, 'DGI_LIMITE_UI', '10000');
            await asegurarClaveConfigGlobal(pool, 'DGI_VALOR_UI', '6.5321');
        } catch (seedErr) {
            logger.warn('[CFE] No se pudieron sembrar las claves DGI en ConfiguracionGlobal: ' + seedErr.message);
        }
        const r = await pool.request()
            .query(`SELECT Clave, Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave IN ('DGI_LIMITE_UI','DGI_VALOR_UI')`);
        const map = {};
        r.recordset.forEach(x => { map[x.Clave] = x.Valor; });
        const limiteUI = parseFloat(map.DGI_LIMITE_UI) || 10000;
        const valorUI = parseFloat(map.DGI_VALOR_UI) || 6.5321;
        res.json({ success: true, limiteUI, valorUI, umbralUYU: Math.round(limiteUI * valorUI * 100) / 100 });
    } catch (error) {
        logger.error('Error obteniendo config DGI:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * PUT /contabilidad/cfe/config-dgi
 * Actualiza el tope (en UI) y el valor de la UI desde la pantalla de administración.
 */
exports.updateConfigDGI = async (req, res) => {
    try {
        const limiteUI = parseFloat(req.body?.limiteUI);
        const valorUI = parseFloat(req.body?.valorUI);
        if (!(limiteUI > 0) || !(valorUI > 0)) {
            return res.status(400).json({ error: 'Parámetros inválidos: el tope (UI) y el valor de la UI deben ser números mayores a 0. Solución: revisá los campos (ej: 10000 y 6.5321).' });
        }
        const pool = await getPool();
        // Asegurar que existan (con la estructura real de la tabla) y luego actualizar
        await asegurarClaveConfigGlobal(pool, 'DGI_LIMITE_UI', String(limiteUI));
        await asegurarClaveConfigGlobal(pool, 'DGI_VALOR_UI', String(valorUI));
        await pool.request()
            .input('lim', sql.VarChar(50), String(limiteUI))
            .input('val', sql.VarChar(50), String(valorUI))
            .query(`
                UPDATE dbo.ConfiguracionGlobal SET Valor = @lim WHERE Clave = 'DGI_LIMITE_UI';
                UPDATE dbo.ConfiguracionGlobal SET Valor = @val WHERE Clave = 'DGI_VALOR_UI';
            `);
        logger.info(`[CFE] Parámetros DGI actualizados: limiteUI=${limiteUI}, valorUI=${valorUI}`);
        res.json({ success: true, limiteUI, valorUI, umbralUYU: Math.round(limiteUI * valorUI * 100) / 100 });
    } catch (error) {
        logger.error('Error actualizando config DGI:', error);
        res.status(500).json({ error: error.message });
    }
};

exports.enviarADGI = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();
        
        // 1. Obtener documento con datos de cliente
        const docResult = await pool.request()
            .input('Id', sql.Int, id)
            .query(`
                SELECT d.*, c.Nombre AS CliRazonSocial, c.CioRuc AS CliRUT, c.DireccionTrabajo AS CliDireccion 
                FROM DocumentosContables d
                LEFT JOIN Clientes c ON d.CliIdCliente = c.CliIdCliente
                WHERE DocIdDocumento = @Id
            `);
            
        if (docResult.recordset.length === 0) {
            return res.status(404).json({ error: 'Documento no encontrado' });
        }
        
        const doc = docResult.recordset[0];
        if (doc.CfeEstado === 'ACEPTADO_DGI') {
            return res.status(400).json({ error: 'Este documento ya fue firmado y aceptado por DGI.' });
        }
        if (doc.CfeEstado === 'BORRADOR') {
            const isFiscal = doc.DocTipo && !doc.DocTipo.toLowerCase().includes('pedido') && doc.DocTipo.toLowerCase().trim() !== 'pc';
            if (!isFiscal) {
                return res.status(400).json({ error: 'El Pedido Caja es un borrador interno. Debe convertirlo a e-Ticket o e-Factura antes de enviarlo a DGI.' });
            }
        }

        // 1.5 Obtener empresa emisora (multiempresa) — datos completos server-side (incluye credenciales SISNET)
        let empresa = null;
        if (doc.EmpIdEmpresa) {
            const empResult = await pool.request()
                .input('Emp', sql.Int, doc.EmpIdEmpresa)
                .query(`SELECT * FROM dbo.Empresas WHERE EmpIdEmpresa = @Emp`);
            empresa = empResult.recordset[0] || null;
        }
        if (!empresa) {
            const empDefResult = await pool.request()
                .query(`SELECT TOP 1 * FROM dbo.Empresas WHERE EmpPorDefecto=1 ORDER BY EmpIdEmpresa`);
            empresa = empDefResult.recordset[0] || null;
        }

        // Validación: la empresa emisora debe existir, estar activa y tener caja SISNET configurada
        if (!empresa || !empresa.EmpActiva || !empresa.EmpSisnetCaja) {
            logger.warn(`Emisión a DGI bloqueada para DocId ${id}: empresa emisora no configurada (EmpIdEmpresa=${doc.EmpIdEmpresa}).`);
            return res.status(400).json({ error: 'La empresa emisora no está configurada para facturación electrónica (requiere estar activa y tener caja SISNET).' });
        }

        // 2. Obtener lineas
        const lineasResult = await pool.request()
            .input('Id', sql.Int, id)
            .query(`SELECT * FROM DocumentosContablesDetalle WHERE DocIdDocumento = @Id`);

        // 3. Obtener cotización del día para el tipo de cambio
        const cotResult = await pool.request()
            .query(`SELECT TOP 1 CotDolar FROM Cotizaciones ORDER BY CotFecha DESC`);
        const cotDolar = cotResult.recordset.length > 0 ? cotResult.recordset[0].CotDolar : 40.0;

        // 3.5 Validaciones DGI del receptor — mensajes claros ANTES de llamar a SISNET
        const docTipoUpperV = String(doc.DocTipo || '').toUpperCase();
        const esFacturaCFE = docTipoUpperV.includes('FACTURA');
        const esTicketCFE = docTipoUpperV.includes('TICKET');
        const valReceptor = validarDocumentoUY(doc.CliRUT || doc.DocCliDocumento);

        if (esFacturaCFE && (!valReceptor.valido || valReceptor.tipo !== 'RUT')) {
            return res.status(400).json({
                error: `No se puede enviar a DGI: las e-Facturas requieren un RUT válido del cliente (12 dígitos). ${valReceptor.motivo || ''}. Solución: editá el documento y corregí el campo "Documento (RUT/CI)" del cliente, o emitilo como e-Ticket si es consumidor final.`
            });
        }

        if (esTicketCFE) {
            // Umbral DGI configurable (ConfiguracionGlobal: DGI_LIMITE_UI / DGI_VALOR_UI)
            let limiteUI = 10000, valorUI = 6.5321;
            try {
                const cfgR = await pool.request()
                    .query(`SELECT Clave, Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave IN ('DGI_LIMITE_UI','DGI_VALOR_UI')`);
                for (const row of cfgR.recordset) {
                    if (row.Clave === 'DGI_LIMITE_UI') limiteUI = parseFloat(row.Valor) || limiteUI;
                    if (row.Clave === 'DGI_VALOR_UI') valorUI = parseFloat(row.Valor) || valorUI;
                }
            } catch (eCfg) {
                logger.warn('[CFE] Config DGI no disponible, usando valores por defecto: ' + eCfg.message);
            }
            const umbralUYU = limiteUI * valorUI;
            const totalUYU = doc.MonIdMoneda === 2 ? Number(doc.DocTotal || 0) * cotDolar : Number(doc.DocTotal || 0);
            if (totalUYU > umbralUYU && !valReceptor.valido) {
                return res.status(400).json({
                    error: `No se puede enviar a DGI: este e-Ticket equivale a $ ${totalUYU.toFixed(2)} UYU y supera el umbral de $ ${umbralUYU.toFixed(2)} (${limiteUI} UI), por lo que DGI exige identificar al comprador. ${valReceptor.motivo}. Solución: editá el documento, cargá la Cédula (6-8 dígitos) o el RUT (12 dígitos) del cliente y reenviá.`
                });
            }
        }

        // 4. Emitir a SISNET
        logger.info(`Iniciando emisión a SISNET para DocId: ${id} con cotización: ${cotDolar}`);
        const resultSISNET = await sisnetService.emitirCFE(doc, lineasResult.recordset, cotDolar, empresa);
        
        // 4. Actualizar base de datos con respuesta real
        await actualizarFirmaCFE(id, {
            cae: resultSISNET.vencimiento, // Guardamos el texto de vencimiento/CAE aquí para retrocompatibilidad
            numeroOficial: resultSISNET.serie,
            urlQR: resultSISNET.urlQR
        });
            
        logger.info(`Documento ${id} emitido exitosamente a DGI. CAE: ${resultSISNET.cae}`);
        res.json({ message: 'Documento enviado exitosamente', cae: resultSISNET.cae, numeroOficial: resultSISNET.serie });
    } catch (error) {
        logger.error('Error enviando a DGI:', error);
        res.status(500).json({ error: error.message });
    }
};

exports.crearFacturaManual = async (req, res) => {
    const { DocTipo, MonIdMoneda, CliIdCliente, Lineas, Totales, DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad, DocPagado, MetodoPagoId, Pagos, empresaId, DocFechaEmision } = req.body;
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    // Fecha de emisión elegida (retrofecha). null => se usa GETDATE() en cada INSERT.
    const fechaDoc = resolverFechaDocumento(DocFechaEmision);

    try {
        await transaction.begin();
        const request = transaction.request();
        
        // 1. Obtener configuración del documento y secuencia
        const resConfig = await request
            .input('codDoc', sql.NVarChar(100), DocTipo)
            .query(`
                SELECT c.EvtCodigo, c.Detalle, s.SecSerie, s.SecUltimoNumero, s.SecIdSecuencia, c.CodDocumento 
                FROM Config_TiposDocumento c
                LEFT JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
                WHERE c.CodDocumento = @codDoc OR c.Detalle = @codDoc
            `);
            
        if (resConfig.recordset.length === 0) {
            throw new Error('Tipo de documento no configurado o inactivo.');
        }
        
        const config = resConfig.recordset[0];
        const serie = config.SecSerie || 'M';
        let numero = 1;

        if (config.SecIdSecuencia) {
            const resSeq = await request
                .input('secId', sql.Int, config.SecIdSecuencia)
                .query(`
                    UPDATE SecuenciaDocumentos 
                    SET SecUltimoNumero = SecUltimoNumero + 1 
                    OUTPUT INSERTED.SecUltimoNumero 
                    WHERE SecIdSecuencia = @secId
                `);
            numero = resSeq.recordset[0].SecUltimoNumero;
        } else {
            const resMax = await request.query(`SELECT ISNULL(MAX(DocNumero), 0) + 1 AS num FROM DocumentosContables WHERE DocSerie='M'`);
            numero = resMax.recordset[0].num;
        }

        // 1.5 Registrar Transacción de Caja y Pago si es Contado
        const isPaid = DocPagado === true || DocPagado === 1 || DocPagado === 'true';
        let tcaId = null;

        if (isPaid) {
            const cotResult = await request.query(`SELECT TOP 1 CotDolar FROM Cotizaciones ORDER BY CotFecha DESC`);
            const cotDolar = cotResult.recordset.length > 0 ? cotResult.recordset[0].CotDolar : 40.0;
            const cotNum = MonIdMoneda === 2 ? cotDolar : 1;
            const convertido = MonIdMoneda === 2 ? Totales.total * cotNum : Totales.total;

            const tcaRes = await request
                .input('TcaUsuarioId', sql.Int, req.user?.id || 1)
                .input('TcaClienteId', sql.Int, CliIdCliente || 1)
                .input('TcaTipoDoc', sql.VarChar(20), (config.CodDocumento || DocTipo).substring(0, 20))
                .input('TcaSerieDoc', sql.VarChar(5), serie)
                .input('TcaNumeroDoc', sql.VarChar(20), String(numero))
                .input('TcaBruto', sql.Decimal(18, 4), Totales.total)
                .input('TcaNeto', sql.Decimal(18, 4), Totales.total)
                .input('TcaCobrado', sql.Decimal(18, 4), convertido)
                .input('TcaMonedaBase', sql.VarChar(10), MonIdMoneda === 2 ? 'USD' : 'UYU')
                .input('TcaFecha', sql.DateTime, fechaDoc)
                .query(`
                    INSERT INTO dbo.TransaccionesCaja
                        (TcaFecha, TcaUsuarioId, TcaClienteId, TcaTipoDocumento, TcaSerieDoc, TcaNumeroDoc,
                         TcaTotalBruto, TcaTotalAjuste, TcaTotalNeto, TcaTotalCobrado, TcaMonedaBase, TcaEstado, TcaObservaciones, EsCajaAdmin)
                    OUTPUT INSERTED.TcaIdTransaccion
                    VALUES
                        (ISNULL(@TcaFecha, GETDATE()), @TcaUsuarioId, @TcaClienteId, @TcaTipoDoc, @TcaSerieDoc, @TcaNumeroDoc,
                         @TcaBruto, 0, @TcaNeto, @TcaCobrado, @TcaMonedaBase, 'COBRADO', 'Pago Factura Manual', 1)
                `);
            tcaId = tcaRes.recordset[0].TcaIdTransaccion;

            if (Array.isArray(Pagos) && Pagos.length > 0) {
                for (const pago of Pagos) {
                    const pMonto = parseFloat(pago.monto) || 0;
                    const pMonedaId = parseInt(pago.monedaId) || MonIdMoneda;
                    const pCot = pMonedaId === 2 ? cotDolar : 1;
                    const pConvertido = pMonedaId === 2 ? pMonto * pCot : pMonto;

                    const reqPago = transaction.request();
                    await reqPago
                        .input('tcaId', sql.Int, tcaId)
                        .input('metodo', sql.Int, pago.metodoPagoId || 1)
                        .input('moneda', sql.Int, pMonedaId)
                        .input('monto', sql.Decimal(18, 4), pMonto)
                        .input('cot', sql.Decimal(18, 4), pCot)
                        .input('convert', sql.Decimal(18, 4), pConvertido)
                        .input('usuario', sql.Int, req.user?.id || 1)
                        .input('pagFecha', sql.DateTime, fechaDoc)
                        .query(`
                            INSERT INTO dbo.Pagos
                                (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
                                 PagMontoPago, PagFechaPago, PagUsuarioAlta, PagCotizacion,
                                 PagMontoConvertido, PagTipoMovimiento)
                            VALUES
                                (@tcaId, @metodo, @moneda,
                                 @monto, ISNULL(@pagFecha, GETDATE()), @usuario, @cot,
                                 @convert, 'COBRO')
                        `);
                }
            } else {
                await request
                    .input('tcaId', sql.Int, tcaId)
                    .input('metodo', sql.Int, MetodoPagoId || 1)
                    .input('moneda', sql.Int, MonIdMoneda)
                    .input('monto', sql.Decimal(18, 4), Totales.total)
                    .input('cot', sql.Decimal(18, 4), cotNum)
                    .input('convert', sql.Decimal(18, 4), convertido)
                    .input('usuario', sql.Int, req.user?.id || 1)
                    .input('pagFecha', sql.DateTime, fechaDoc)
                    .query(`
                        INSERT INTO dbo.Pagos
                            (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
                             PagMontoPago, PagFechaPago, PagUsuarioAlta, PagCotizacion,
                             PagMontoConvertido, PagTipoMovimiento)
                        VALUES
                            (@tcaId, @metodo, @moneda,
                             @monto, ISNULL(@pagFecha, GETDATE()), @usuario, @cot,
                             @convert, 'COBRO')
                    `);
            }
        }

        // 2. Crear documento CFE y sus detalles
        const mappedLineas = (Array.isArray(Lineas) ? Lineas : []).map(linea => {
            const cant = parseFloat(linea.cantidad) || 0;
            const precio = parseFloat(linea.precioUnitario) || 0;
            const ivaRate = parseFloat(linea.iva) || 22;
            const lineTotal = cant * precio;
            const lineNeto = lineTotal / (1 + ivaRate / 100);
            const lineIva = lineTotal - lineNeto;
            return {
                nomItem: (linea.concepto || '').substring(0, 255),
                dscItem: linea.DcdDscItem || linea.sublinea || '',
                cantidad: cant,
                precioUnitario: precio,
                subtotal: lineNeto,
                impuestos: lineIva,
                total: lineTotal
            };
        });

        const docTipoStr = config.Detalle || '';
        const docId = await crearDocumentoContable({
            header: {
                cueIdCuenta: MonIdMoneda === 2 ? 119 : 118,
                clienteId: CliIdCliente || 2089, // 2089 = CONSUMIDOR FINAL genérico (1 es un cliente real)
                monedaId: MonIdMoneda,
                tipo: docTipoStr,
                numero: String(numero),
                serie: serie,
                subtotal: Totales.subtotal,
                impuestos: Totales.iva,
                total: Totales.total,
                estado: 'COBRADO',
                cfeEstado: (docTipoStr.includes('Pedido') || docTipoStr.includes('PEDIDO') || docTipoStr === 'PedidoCaja') ? 'BORRADOR' : 'PENDIENTE',
                usuarioId: req.user?.id || 1,
                tcaIdTransaccion: tcaId,
                docPagado: isPaid,
                docCliNombre: DocCliNombre || '',
                docCliDocumento: DocCliDocumento || '',
                docCliDireccion: DocCliDireccion || '',
                docCliCiudad: DocCliCiudad || '',
                empresaId: empresaId || null,
                docFechaEmision: fechaDoc // retrofecha elegida; null => GETDATE()
            },
            lineas: mappedLineas
        }, transaction);

        // 2.7 Registrar en Cuenta Corriente de Cliente si es cliente real
        // El genérico (ID 2089 = "Consumidor Final") NO tiene cuenta corriente propia.
        // Cualquier otro cliente — aunque el doc sea e-Ticket (B2C para DGI) — sí la tiene.
        const cliIdNum = parseInt(CliIdCliente) || 0;
        const isRealClient = cliIdNum > 0 && cliIdNum !== CONSUMIDOR_FINAL_ID && cliIdNum !== 100101;
        if (isRealClient) {
            const cueTipo = MonIdMoneda === 2 ? 'DINERO_USD' : 'DINERO_UYU';
            const ctaMonedaId = await contabilidadService.obtenerOCrearCuenta(CliIdCliente, cueTipo, {
                MonIdMoneda,
                UsuarioAlta: req.user?.id || 1
            }, transaction);

            const cicloActivoObj = await contabilidadService.obtenerCicloActivo(ctaMonedaId, transaction);
            const cicId = cicloActivoObj ? cicloActivoObj.CicIdCiclo : null;

            // 2.7.1 Cargar el Cargo (Venta)
            const conceptCargo = `Venta ${config.Detalle || config.CodDocumento || DocTipo}: ${serie}-${numero}${DocCliNombre ? ' (' + DocCliNombre + ')' : ''}`;
            await contabilidadService.registrarMovimiento({
                CueIdCuenta: ctaMonedaId,
                MovTipo: 'VTA_CAJA',
                MovConcepto: conceptCargo,
                MovImporte: -Totales.total,
                MovUsuarioAlta: req.user?.id || 1,
                DocIdDocumento: docId,
                CicIdCiclo: cicId,
                MovFecha: fechaDoc
            }, transaction);

            // 2.7.2 Si es Contado, registrar el Abono (Pago)
            if (isPaid) {
                const conceptPago = `Pago (${config.Detalle || config.CodDocumento || DocTipo}): ${serie}-${numero}`;
                await contabilidadService.registrarMovimiento({
                    CueIdCuenta: ctaMonedaId,
                    MovTipo: 'PAGO',
                    MovConcepto: conceptPago,
                    MovImporte: Totales.total,
                    MovUsuarioAlta: req.user?.id || 1,
                    DocIdDocumento: docId,
                    CicIdCiclo: cicId,
                    MovFecha: fechaDoc
                }, transaction);
            } else {
                // 2.7.3 Si es Crédito → crear deuda centralizada
                await contabilidadService.crearDeudaDocumento({
                    CueIdCuenta:    ctaMonedaId,
                    DocIdDocumento: docId,
                    Importe:        Totales.total,
                }, transaction);
            }
        }

        // 3. Contabilizar automáticamente
        const evtCodigo = config.EvtCodigo;
        
        const cotResult = await request.query(`SELECT TOP 1 CotDolar FROM Cotizaciones ORDER BY CotFecha DESC`);
        const cotDolar = cotResult.recordset.length > 0 ? cotResult.recordset[0].CotDolar : 40.0;

        const lineasContables = await resolverLineasDesdeMotor(evtCodigo, {
            totalNeto: Totales.total,
            neto: Totales.subtotal,
            ivaMonto: Totales.iva,
            moneda: MonIdMoneda === 2 ? 'USD' : 'UYU',
            cotizacion: MonIdMoneda === 2 ? cotDolar : 1,
            clienteId: CliIdCliente
        });

        if (lineasContables.length > 0) {
            const asiId = await generarAsientoCompleto({
                fecha: fechaDoc || new Date(),
                concepto: `${config.CodDocumento || DocTipo} Manual M-${docId} - ${CliIdCliente ? 'Cliente ' + CliIdCliente : 'Consumidor'}`,
                usuarioId: req.user?.id || 1,
                origen: 'FACTURACION_MANUAL',
                lineas: lineasContables
            }, transaction);
            
            if (asiId) {
                await request
                    .input('docId', sql.Int, docId)
                    .input('asiId', sql.Int, asiId)
                    .query(`UPDATE DocumentosContables SET AsiIdAsiento = @asiId WHERE DocIdDocumento = @docId`);
            }
        }

        await transaction.commit();
        res.json({ success: true, message: 'Documento CFE generado exitosamente', docId });

    } catch (err) {
        logger.error('Error en crearFacturaManual:', err);
        try {
            await transaction.rollback();
        } catch (rollbackErr) {
            // Ignorar
        }
        res.status(500).json({ error: err.message });
    }
};

exports.getNomencladores = async (req, res) => {
    try {
        const pool = await getPool();
        const [resMonedas, resDocTipos] = await Promise.all([
            pool.request().query('SELECT MonIdMoneda as id, MonDescripcionMoneda as nombre, MonSimbolo as simbolo FROM Monedas ORDER BY MonIdMoneda'),
            pool.request().query(`
                SELECT 
                    c.CodDocumento as value, 
                    c.Detalle as label, 
                    c.Codigo_Efact, 
                    c.RutObligatorio, 
                    c.AfectaCtaCte, 
                    c.Referenciado, 
                    c.NroCaja, 
                    c.EvtCodigo,
                    s.SecSerie
                FROM Config_TiposDocumento c
                LEFT JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
                WHERE c.EvtCodigo IS NOT NULL
                ORDER BY c.CodDocumento
            `)
        ]);

        res.json({
            success: true,
            monedas: resMonedas.recordset,
            tiposDocumentos: resDocTipos.recordset
        });
    } catch (err) {
        logger.error('Error en getNomencladores CFE:', err);
        res.status(500).json({ error: err.message });
    }
};

// ── Anular documento (solo si está PENDIENTE — no fue enviado a DGI aún) ─────────
// Si ya fue ACEPTADO_DGI, debe emitirse una Nota de Crédito en su lugar.
exports.anularFactura = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();
        const transaction = pool.transaction();
        await transaction.begin();

        const docRes = await transaction.request()
            .input('id', sql.Int, id)
            .query('SELECT CfeEstado, DocPagado, AsiIdAsiento, TcaIdTransaccion, DocTotal FROM DocumentosContables WHERE DocIdDocumento = @id');
        
        if (docRes.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Documento no encontrado' });
        }
        
        const doc = docRes.recordset[0];
        if (doc.CfeEstado === 'ACEPTADO_DGI') {
            await transaction.rollback();
            return res.status(400).json({
                error: 'Este documento ya fue aceptado por DGI. Para revertirlo debés emitir una Nota de Crédito (e-NC tipo 102 o 112).'
            });
        }

        // Si está pagado, revertir transacciones de caja y liberar las órdenes asociadas
        const tcaId = doc.TcaIdTransaccion || null;
        const usuarioId = req.user?.id || 70;
        if (doc.DocPagado && tcaId) {

            // 1. Obtener los IDs de las órdenes de retiro antes de borrarlas
            const ordRetiroRes = await transaction.request()
                .input('tcaId', sql.Int, tcaId)
                .query(`
                    SELECT OReIdOrdenRetiro, OReEstadoActual 
                    FROM dbo.OrdenesRetiro 
                    WHERE PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @tcaId)
                `);

            // 2. Marcar TransaccionesCaja como ANULADO
            await transaction.request()
                .input('tcaId', sql.Int, tcaId)
                .input('usuarioId', sql.Int, usuarioId)
                .query(`
                    UPDATE dbo.TransaccionesCaja
                    SET TcaEstado = 'ANULADO',
                        TcaFechaAnulacion = GETDATE(),
                        TcaUsuarioAnula = @usuarioId,
                        TcaObservaciones = ISNULL(TcaObservaciones, '') + ' | ANULADO POR ANULACION COMPROBANTE'
                    WHERE TcaIdTransaccion = @tcaId
                `);

            // 3. Revertir pagos relacionados
            await transaction.request()
                .input('tcaId', sql.Int, tcaId)
                .query(`
                    UPDATE dbo.Pagos
                    SET PagTipoMovimiento = 'ANULADO'
                    WHERE PagTcaIdTransaccion = @tcaId
                `);

            // 4. Revertir OrdenesRetiro
            await transaction.request()
                .input('tcaId', sql.Int, tcaId)
                .query(`
                    UPDATE dbo.OrdenesRetiro
                    SET PagIdPago = NULL,
                        OReEstadoActual = CASE
                            WHEN OReEstadoActual IN (3, 4) THEN 1
                            WHEN OReEstadoActual = 8 THEN 5
                            ELSE OReEstadoActual
                        END,
                        OReFechaEstadoActual = GETDATE(),
                        ORePasarPorCaja = 1
                    WHERE PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @tcaId)
                `);

            // 5. Insertar histórico
            for (const o of ordRetiroRes.recordset) {
                const nuevoEstado = (o.OReEstadoActual === 3 || o.OReEstadoActual === 4) ? 1 : (o.OReEstadoActual === 8 ? 5 : o.OReEstadoActual);
                await transaction.request()
                    .input('oreId', sql.Int, o.OReIdOrdenRetiro)
                    .input('estado', sql.Int, nuevoEstado)
                    .input('usuarioId', sql.Int, usuarioId)
                    .query(`
                        INSERT INTO dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                        VALUES (@oreId, @estado, GETDATE(), @usuarioId)
                    `);
            }

            // 6. Revertir OrdenesDeposito
            await transaction.request()
                .input('tcaId', sql.Int, tcaId)
                .query(`
                    UPDATE dbo.OrdenesDeposito
                    SET PagIdPago = NULL,
                        OrdEstadoActual = 6,
                        OrdFechaEstadoActual = GETDATE()
                    WHERE PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @tcaId)
                `);
        }

        // Anulación centralizada: revierte automáticamente los saldos en CuentasCliente
        await contabilidadService.anularMovimientosPorFiltro(
            { docId: parseInt(id), tcaId: tcaId || null, excluirTipos: ['ORDEN', 'ENTREGA'] },
            transaction
        );

        // Revertir la compra de recurso (rollo por adelantado) si la venta creó/recargó un plan.
        // El movimiento ENTRADA del recurso no tiene DocIdDocumento, así que no lo alcanza el
        // filtro anterior; se revierte por su etiqueta MovRefExterna = <TcaId>.
        await contabilidadService.revertirRecursosPorTransaccion(tcaId || null, usuarioId, transaction);

        // Si hay deudas individuales de las órdenes que fueron absorbidas, restaurarlas a PENDIENTE
        await transaction.request()
            .input('id', sql.Int, id)
            .query(`
                UPDATE dd
                SET    dd.DDeEstado = 'PENDIENTE',
                       dd.DDeImportePendiente = dd.DDeImporteOriginal
                FROM   dbo.DeudaDocumento dd
                WHERE  dd.DocIdDocumento IS NULL
                  AND  dd.DDeEstado = 'PAGADO'
                  AND  dd.OrdIdOrden IN (
                         SELECT DISTINCT m.OrdIdOrden
                         FROM   dbo.MovimientosCuenta m
                         WHERE  m.DocIdDocumento = @id
                           AND  m.MovTipo IN ('ORDEN', 'ENTREGA')
                       )
            `);

        // Liberar los movimientos de tipo ORDEN y ENTREGA quitándoles la vinculación al documento y al ciclo
        await transaction.request()
            .input('id', sql.Int, id)
            .query("UPDATE dbo.MovimientosCuenta SET DocIdDocumento = NULL, CicIdCiclo = NULL WHERE DocIdDocumento = @id AND MovTipo IN ('ORDEN', 'ENTREGA')");

        // Revertir en DeudaDocumento
        await transaction.request()
            .input('id', sql.Int, id)
            .query("UPDATE dbo.DeudaDocumento SET DDeEstado = 'CANCELADA', DDeImportePendiente = 0 WHERE DocIdDocumento = @id");

        // Marcar como anulado el documento
        await anularDocumentoContable(id, transaction);

        // Revertir Asiento Contable si existe
        if (doc.AsiIdAsiento) {
            await transaction.request()
                .input('asiId', sql.Int, doc.AsiIdAsiento)
                .query("UPDATE Cont_AsientosCabecera SET AsiEstado = 0 WHERE AsiId = @asiId");
        }

        await transaction.commit();
        res.json({ success: true, message: 'Documento anulado correctamente' });
    } catch (err) {
        logger.error('Error anulando documento CFE:', err);
        try {
            await transaction.rollback();
        } catch (rollbackErr) {
            // Ignorar si ya se abortó la transacción
        }
        res.status(500).json({ error: err.message });
    }
};

// ── Editar documento (solo si está PENDIENTE — no fue enviado a DGI aún) ─────────
exports.editarFactura = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            DocTipo, CliIdCliente, MonIdMoneda, DocSubtotal, DocImpuestos, DocTotal, DocObservaciones,
            lineas, DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad,
            DocPagado, MetodoPagoId, Pagos, empresaId, preservarPagos, DocFechaEmision
        } = req.body;

        const pool = await getPool();
        const transaction = pool.transaction();
        await transaction.begin();

        const docRes = await transaction.request()
            .input('id', sql.Int, id)
            .query('SELECT DocTipo, CfeEstado, DocPagado, AsiIdAsiento, TcaIdTransaccion, DocTotal, DocSerie, DocNumero, DocFechaEmision FROM DocumentosContables WHERE DocIdDocumento = @id');

        if (docRes.recordset.length === 0) {
            await transaction.rollback();
            return res.status(404).json({ error: 'Documento no encontrado' });
        }

        const doc = docRes.recordset[0];
        if (doc.CfeEstado !== 'PENDIENTE' && doc.CfeEstado !== 'BORRADOR') {
            await transaction.rollback();
            return res.status(400).json({ error: 'Solo se pueden editar documentos en estado PENDIENTE o BORRADOR. Si ya fue enviado a DGI, emití una Nota de Crédito.' });
        }

        // Fecha de emisión editable (retrofecha). El endpoint ya bloquea documentos
        // enviados a DGI, así que aquí siempre es seguro cambiarla.
        //   · fechaEdit     = fecha nueva elegida (null si el usuario no la cambia → se conserva)
        //   · fechaEfectiva = fecha que llevarán los registros NUEVOS creados en esta edición
        //                     (Tca/Pago por transición contado↔crédito). null => GETDATE().
        const fechaEdit = resolverFechaDocumento(DocFechaEmision);
        const fechaEfectiva = fechaEdit || (doc.DocFechaEmision ? new Date(doc.DocFechaEmision) : null);

        const cleanDocTipo = String(DocTipo || '').trim();
        const cleanOldDocTipo = String(doc.DocTipo || '').trim();

        // 1. Obtener configuraciones de ambos tipos de documentos
        const resConfig = await transaction.request()
            .input('newDocTipo', sql.NVarChar(100), cleanDocTipo)
            .input('oldDocTipo', sql.NVarChar(100), cleanOldDocTipo)
            .query(`
                SELECT c.EvtCodigo, c.Detalle, s.SecSerie, s.SecUltimoNumero, s.SecIdSecuencia, c.CodDocumento 
                FROM Config_TiposDocumento c
                LEFT JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
                WHERE c.CodDocumento IN (@newDocTipo, @oldDocTipo) 
                   OR LTRIM(RTRIM(c.Detalle)) IN (LTRIM(RTRIM(@newDocTipo)), LTRIM(RTRIM(@oldDocTipo)))
            `);

        const configs = resConfig.recordset;
        // Buscar el config para el nuevo tipo. Si cleanDocTipo es código, buscamos por CodDocumento. Si no, por Detalle.
        const newConfig = configs.find(c => c.CodDocumento === cleanDocTipo || c.Detalle.trim() === cleanDocTipo);
        // Buscar el config para el viejo tipo
        const oldConfig = configs.find(c => c.CodDocumento === cleanOldDocTipo || c.Detalle.trim() === cleanOldDocTipo);

        const isTypeChanged = !oldConfig || !newConfig || oldConfig.CodDocumento !== newConfig.CodDocumento;

        let newSerie = doc.DocSerie;
        let newNumero = doc.DocNumero;
        let newCfeEstado = doc.CfeEstado;
        let savedDocTipo = doc.DocTipo; // default to old type

        if (newConfig) {
            savedDocTipo = newConfig.Detalle; // Store description for consistency
        }

        if (isTypeChanged && newConfig) {
            newSerie = newConfig.SecSerie || 'M';
            
            // Si el nuevo tipo de documento tiene una secuencia configurada, incrementamos y obtenemos el número
            if (newConfig.SecIdSecuencia) {
                const resSeq = await transaction.request()
                    .input('secId', sql.Int, newConfig.SecIdSecuencia)
                    .query(`
                        UPDATE SecuenciaDocumentos 
                        SET SecUltimoNumero = SecUltimoNumero + 1 
                        OUTPUT INSERTED.SecUltimoNumero 
                        WHERE SecIdSecuencia = @secId
                    `);
                newNumero = resSeq.recordset[0].SecUltimoNumero;
            } else {
                // Si no, asignamos por máximo + 1 de la serie
                const resMax = await transaction.request()
                    .input('serie', sql.VarChar(10), newSerie)
                    .query(`SELECT ISNULL(MAX(DocNumero), 0) + 1 AS num FROM DocumentosContables WHERE DocSerie = @serie`);
                newNumero = resMax.recordset[0].num;
            }

            // Resolver CfeEstado según el nuevo tipo
            const newDocTipoStr = newConfig.CodDocumento || cleanDocTipo;
            if (newDocTipoStr.includes('Pedido') || newDocTipoStr.includes('PEDIDO') || newDocTipoStr === 'PedidoCaja' || newDocTipoStr === 'PC' || newDocTipoStr === '40') {
                newCfeEstado = 'BORRADOR';
            } else {
                newCfeEstado = 'PENDIENTE';
            }
        } else {
            // Si el tipo no cambió, pero se guarda y por algún motivo el CfeEstado necesita actualizarse
            const docTipoStr = newConfig ? newConfig.CodDocumento : (cleanDocTipo || cleanOldDocTipo);
            if (docTipoStr.includes('Pedido') || docTipoStr.includes('PEDIDO') || docTipoStr === 'PedidoCaja' || docTipoStr === 'PC' || docTipoStr === '40') {
                newCfeEstado = 'BORRADOR';
            } else {
                newCfeEstado = 'PENDIENTE';
            }
        }

        const newPaid = DocPagado === true || DocPagado === 1 || DocPagado === 'true';
        const oldPaid = doc.DocPagado === true || doc.DocPagado === 1;

        // 1. Actualizar cabecera del documento
        await transaction.request()
            .input('id', sql.Int, id)
            .input('docTipo', sql.NVarChar(50), savedDocTipo)
            .input('clienteId', sql.Int, CliIdCliente || 2089) // 2089 = CONSUMIDOR FINAL genérico (1 es un cliente real)
            .input('moneda', sql.Int, MonIdMoneda)
            .input('subtotal', sql.Decimal(18, 2), DocSubtotal)
            .input('iva', sql.Decimal(18, 2), DocImpuestos)
            .input('total', sql.Decimal(18, 2), DocTotal)
            .input('cuenta', sql.Int, MonIdMoneda === 2 ? 119 : 118)
            .input('obs', sql.NVarChar(500), DocObservaciones || '')
            .input('cliNombre', sql.NVarChar(200), DocCliNombre || '')
            .input('cliDoc', sql.NVarChar(20), DocCliDocumento || '')
            .input('cliDir', sql.NVarChar(200), DocCliDireccion || '')
            .input('cliCiu', sql.NVarChar(100), DocCliCiudad || '')
            .input('docPagado', sql.Bit, newPaid ? 1 : 0)
            .input('serie', sql.VarChar(10), newSerie)
            .input('numero', sql.Int, newNumero)
            .input('cfeEstado', sql.VarChar(20), newCfeEstado)
            .input('emp', sql.Int, empresaId || null)
            .input('fechaEmis', sql.DateTime, fechaEdit)
            .query(`
                UPDATE DocumentosContables SET
                    DocTipo           = CASE WHEN @docTipo <> '' THEN @docTipo ELSE DocTipo END,
                    CliIdCliente      = @clienteId,
                    MonIdMoneda       = @moneda,
                    DocSubtotal       = @subtotal,
                    DocImpuestos      = @iva,
                    DocTotal          = @total,
                    CueIdCuenta       = @cuenta,
                    DocObservaciones  = @obs,
                    DocCliNombre      = @cliNombre,
                    DocCliDocumento   = @cliDoc,
                    DocCliDireccion   = @cliDir,
                    DocCliCiudad      = @cliCiu,
                    DocPagado         = @docPagado,
                    DocSerie          = @serie,
                    DocNumero         = @numero,
                    CfeEstado         = @cfeEstado,
                    EmpIdEmpresa      = ISNULL(@emp, EmpIdEmpresa),
                    DocFechaEmision   = ISNULL(@fechaEmis, DocFechaEmision)
                WHERE DocIdDocumento = @id
            `);

        // Propagar la nueva fecha al asiento contable del documento (si cambió y existe)
        if (fechaEdit && doc.AsiIdAsiento) {
            await transaction.request()
                .input('asiId', sql.Int, doc.AsiIdAsiento)
                .input('fechaEmis', sql.DateTime, fechaEdit)
                .query(`UPDATE dbo.Cont_AsientosCabecera SET AsiFecha = @fechaEmis WHERE AsiId = @asiId`);
        }

        // 2. Si vienen líneas, reprocesar el detalle
        if (Array.isArray(lineas) && lineas.length > 0) {
            // Borrar las líneas anteriores
            await transaction.request()
                .input('docId', sql.Int, id)
                .query('DELETE FROM DocumentosContablesDetalle WHERE DocIdDocumento = @docId');

            // Reinsertar las líneas editadas
            for (const linea of lineas) {
                await transaction.request()
                    .input('docId', sql.Int, id)
                    .input('nom', sql.NVarChar(255), linea.DcdNomItem || '')
                    .input('dsc', sql.NVarChar(255), linea.DcdDscItem || '')
                    .input('cant', sql.Decimal(18, 4), parseFloat(linea.DcdCantidad) || 1)
                    .input('precio', sql.Decimal(18, 4), parseFloat(linea.DcdPrecioUnitario) || 0)
                    .input('sub', sql.Decimal(18, 2), parseFloat(linea.DcdSubtotal) || 0)
                    .input('imp', sql.Decimal(18, 2), parseFloat(linea.DcdImpuestos) || 0)
                    .input('tot', sql.Decimal(18, 2), parseFloat(linea.DcdTotal) || 0)
                    .query(`
                        INSERT INTO DocumentosContablesDetalle
                            (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal)
                        VALUES (@docId, @nom, @dsc, @cant, @precio, @sub, @imp, @tot)
                    `);
            }
        }

        // ── Estrategia de movimientos ───────────────────────────────────────────────
        // El endpoint ya bloquea documentos enviados a DGI (ACEPTADO, COBRADO, etc.)
        // Cualquier documento que llega aquí (BORRADOR o PENDIENTE) es editable.
        // Política: siempre actualizamos en el lugar — sin rastro de anulación.
        const tipoChanged  = cleanDocTipo !== cleanOldDocTipo;
        const montoChanged = Math.abs(DocTotal - (doc.DocTotal || 0)) > 0.001;
        const paidChanged  = newPaid !== oldPaid;

        const cliIdNum     = parseInt(CliIdCliente) || 0;
        const isRealClient = cliIdNum > 0 && cliIdNum !== CONSUMIDOR_FINAL_ID && cliIdNum !== 100101;

        if (isRealClient && (tipoChanged || montoChanged || paidChanged)) {
          const cueTipoEdit = MonIdMoneda === 2 ? 'DINERO_USD' : 'DINERO_UYU';
          const ctaEditId   = await contabilidadService.obtenerOCrearCuenta(cliIdNum, cueTipoEdit, {
            MonIdMoneda, UsuarioAlta: req.user?.id || 1
          }, transaction);
          const cicloObj = await contabilidadService.obtenerCicloActivo(ctaEditId, transaction);
          const cicId    = cicloObj ? cicloObj.CicIdCiclo : null;

          // 1. Actualizar concepto e importe del movimiento de CARGO (siempre)
          const nuevoConcepto = `Venta ${newConfig?.Detalle || DocTipo}: ${newSerie}-${newNumero}${DocCliNombre ? ' (' + DocCliNombre + ')' : ''}`;
          await transaction.request()
            .input('docId',    sql.Int,          parseInt(id))
            .input('imp',      sql.Decimal(18,4), -DocTotal)
            .input('concepto', sql.VarChar(200),  nuevoConcepto)
            .input('fechaEmis', sql.DateTime,     fechaEdit)
            .query(`
              UPDATE dbo.MovimientosCuenta
              SET MovImporte  = @imp,
                  MovConcepto = @concepto,
                  MovFecha    = ISNULL(@fechaEmis, MovFecha)
              WHERE DocIdDocumento = @docId
                -- CIERRE_CICLO incluido: al editar un documento de cierre de ciclo, su movimiento
                -- de facturación en el libro mayor DEBE seguir al DocTotal (= -@imp), o el saldo
                -- queda desfasado de la factura (la factura manda).
                AND MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                AND (MovAnulado IS NULL OR MovAnulado = 0)
            `);

          // 2. Transición de pago
          if (oldPaid && !newPaid) {
            // ── Contado → Crédito ──────────────────────────────────────────────
            // 2a. Eliminar el movimiento de PAGO (el efectivo se "devuelve")
            // El PAGO puede estar vinculado de DOS formas distintas según quién lo creó:
            //   · Por DocIdDocumento  → cuando lo creó editarFactura/crearFacturaManual
            //   · Por PagIdPago→TcaId → cuando lo creó Caja, pagoService o procesarTransaccion
            // Buscamos ambos para no dejar ningún PAGO huérfano.
            const tcaIdViejo = doc.TcaIdTransaccion || null;
            await transaction.request()
              .input('docId', sql.Int, parseInt(id))
              .input('tcaId', sql.Int, tcaIdViejo)
              .query(`
                DELETE mc FROM dbo.MovimientosCuenta mc
                WHERE mc.MovTipo = 'PAGO'
                  AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
                  AND (
                    mc.DocIdDocumento = @docId
                    OR (
                      @tcaId IS NOT NULL
                      AND mc.PagIdPago IN (
                        SELECT p.PagIdPago FROM dbo.Pagos p
                        WHERE p.PagTcaIdTransaccion = @tcaId
                      )
                    )
                  )
              `);

            // 2b. Ajustar saldo de CuentasCliente: el cliente ahora debe el monto
            await transaction.request()
              .input('Dif', sql.Decimal(18,4), -DocTotal)
              .input('C',   sql.Int,            ctaEditId)
              .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Dif WHERE CueIdCuenta = @C`);

            // 2c. Crear DeudaDocumento
            await contabilidadService.crearDeudaDocumento({
              CueIdCuenta:    ctaEditId,
              DocIdDocumento: parseInt(id),
              Importe:        DocTotal,
            }, transaction);

          } else if (!oldPaid && newPaid) {
            // ── Crédito → Contado ──────────────────────────────────────────────
            const conceptoPago = `Pago (${newConfig?.Detalle || DocTipo}): ${newSerie}-${newNumero}`;
            await contabilidadService.registrarMovimiento({
                CueIdCuenta: ctaEditId,
                MovTipo: 'PAGO',
                MovConcepto: conceptoPago,
                MovImporte: DocTotal,
                MovUsuarioAlta: req.user?.id || 1,
                DocIdDocumento: parseInt(id),
                CicIdCiclo: cicId,
                MovFecha: fechaEfectiva
            }, transaction);



            // 2d. Eliminar DeudaDocumento existente (ya pagó)
            await transaction.request()
              .input('docId', sql.Int, parseInt(id))
              .query(`DELETE FROM dbo.DeudaDocumento WHERE DocIdDocumento = @docId AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')`);

          } else if (newPaid && montoChanged) {
            // ── Sigue Contado pero cambió el monto ────────────────────────────
            const conceptoPago = `Pago (${newConfig?.Detalle || DocTipo}): ${newSerie}-${newNumero}`;
            await transaction.request()
              .input('docId',    sql.Int,          parseInt(id))
              .input('imp',      sql.Decimal(18,4), DocTotal)
              .input('concepto', sql.VarChar(200),  conceptoPago)
              .input('fechaEmis', sql.DateTime,     fechaEdit)
              .query(`
                UPDATE dbo.MovimientosCuenta
                SET MovImporte  = @imp, MovConcepto = @concepto,
                    MovFecha    = ISNULL(@fechaEmis, MovFecha)
                WHERE DocIdDocumento = @docId
                  AND MovTipo = 'PAGO'
                  AND (MovAnulado IS NULL OR MovAnulado = 0)
              `);
            // Ajustar saldo por diferencia
            const dif = DocTotal - (doc.DocTotal || 0);
            await transaction.request()
              .input('Dif', sql.Decimal(18,4), -dif) // cargo neto: cargo sube pero pago también
              .input('C',   sql.Int,            ctaEditId)
              .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Dif WHERE CueIdCuenta = @C`);

          } else if (!newPaid && montoChanged) {
            // ── Sigue Crédito pero cambió el monto ────────────────────────────
            const dif = DocTotal - (doc.DocTotal || 0);
            await transaction.request()
              .input('Dif', sql.Decimal(18,4), -dif)
              .input('C',   sql.Int,            ctaEditId)
              .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @Dif WHERE CueIdCuenta = @C`);

            await transaction.request()
              .input('docId',    sql.Int,          parseInt(id))
              .input('nuevoImp', sql.Decimal(18,4), DocTotal)
              .query(`
                UPDATE dbo.DeudaDocumento
                SET DDeImporteOriginal  = @nuevoImp,
                    DDeImportePendiente = @nuevoImp
                WHERE DocIdDocumento = @docId
                  AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
              `);
          }
        }

        // 4. Actualizar Transacciones de Caja e Historial de Cobros
        let currentTcaId = doc.TcaIdTransaccion;

        if (oldPaid) {
            if (!newPaid) {
                // Cambió de Contado a Crédito: anular transacción de caja y pagos
                if (currentTcaId) {
                    await transaction.request()
                        .input('tcaId', sql.Int, currentTcaId)
                        .input('usuarioId', sql.Int, req.user?.id || 1)
                        .query(`
                            UPDATE dbo.TransaccionesCaja
                            SET TcaEstado = 'ANULADO',
                                TcaFechaAnulacion = GETDATE(),
                                TcaUsuarioAnula = @usuarioId,
                                TcaObservaciones = ISNULL(TcaObservaciones, '') + ' | CAMBIADO A CREDITO POR EDICION'
                            WHERE TcaIdTransaccion = @tcaId;

                            UPDATE dbo.Pagos
                            SET PagTipoMovimiento = 'ANULADO'
                            WHERE PagTcaIdTransaccion = @tcaId;
                        `);
                    
                    await transaction.request()
                        .input('id', sql.Int, id)
                        .query("UPDATE DocumentosContables SET TcaIdTransaccion = NULL WHERE DocIdDocumento = @id");
                    
                    currentTcaId = null;
                }
            } else {
                // Se mantiene Contado: actualizar transacciones y pagos
                if (currentTcaId && preservarPagos) {
                    // ── PRESERVAR EL COBRO REAL ─────────────────────────────────
                    // Los pagos vienen intactos de BD y pueden diferir del total de
                    // la factura por un ajuste monetario de caja (redondeo/pago
                    // cerrado → 5.2.03/4.2.2). NO tocar dbo.Pagos (mantiene los
                    // PagIdPago vinculados a OrdenesDeposito/OrdenesRetiro) ni
                    // TcaTotalCobrado (lo realmente cobrado). Solo sincronizar los
                    // datos del documento en la transacción.
                    const configRes = await transaction.request()
                        .input('codDoc', sql.NVarChar(100), DocTipo)
                        .query(`SELECT CodDocumento FROM Config_TiposDocumento WHERE CodDocumento = @codDoc OR Detalle = @codDoc`);
                    const config = configRes.recordset[0] || { CodDocumento: DocTipo };

                    await transaction.request()
                        .input('tcaId', sql.Int, currentTcaId)
                        .input('clienteId', sql.Int, CliIdCliente || 2089)
                        .input('tipoDoc', sql.VarChar(20), (config.CodDocumento || DocTipo).substring(0, 20))
                        .input('total', sql.Decimal(18, 4), DocTotal)
                        .input('serie', sql.VarChar(5), newSerie)
                        .input('numero', sql.VarChar(20), String(newNumero))
                        .query(`
                            UPDATE dbo.TransaccionesCaja
                            SET TcaClienteId = @clienteId,
                                TcaTipoDocumento = @tipoDoc,
                                TcaTotalBruto = @total,
                                TcaTotalNeto = @total,
                                TcaSerieDoc = @serie,
                                TcaNumeroDoc = @numero
                            WHERE TcaIdTransaccion = @tcaId
                        `);
                } else if (currentTcaId) {
                    const cotResult = await transaction.request().query(`SELECT TOP 1 CotDolar FROM Cotizaciones ORDER BY CotFecha DESC`);
                    const cotDolar = cotResult.recordset.length > 0 ? cotResult.recordset[0].CotDolar : 40.0;
                    const cotNum = MonIdMoneda === 2 ? cotDolar : 1;
                    const convertido = MonIdMoneda === 2 ? DocTotal * cotNum : DocTotal;

                    const configRes = await transaction.request()
                        .input('codDoc', sql.NVarChar(100), DocTipo)
                        .query(`SELECT CodDocumento FROM Config_TiposDocumento WHERE CodDocumento = @codDoc OR Detalle = @codDoc`);
                    const config = configRes.recordset[0] || { CodDocumento: DocTipo };

                    await transaction.request()
                        .input('tcaId', sql.Int, currentTcaId)
                        .input('clienteId', sql.Int, CliIdCliente || 2089) // 2089 = CONSUMIDOR FINAL genérico (1 es un cliente real)
                        .input('tipoDoc', sql.VarChar(20), (config.CodDocumento || DocTipo).substring(0, 20))
                        .input('total', sql.Decimal(18, 4), DocTotal)
                        .input('cobrado', sql.Decimal(18, 4), convertido)
                        .input('moneda', sql.VarChar(10), MonIdMoneda === 2 ? 'USD' : 'UYU')
                        .input('serie', sql.VarChar(5), newSerie)
                        .input('numero', sql.VarChar(20), String(newNumero))
                        .input('tcaFecha', sql.DateTime, fechaEdit)
                        .query(`
                            UPDATE dbo.TransaccionesCaja
                            SET TcaClienteId = @clienteId,
                                TcaTipoDocumento = @tipoDoc,
                                TcaTotalBruto = @total,
                                TcaTotalNeto = @total,
                                TcaTotalCobrado = @cobrado,
                                TcaMonedaBase = @moneda,
                                TcaSerieDoc = @serie,
                                TcaNumeroDoc = @numero,
                                TcaFecha = ISNULL(@tcaFecha, TcaFecha)
                            WHERE TcaIdTransaccion = @tcaId
                        `);

                    // Eliminar pagos antiguos de esta transacción
                    await transaction.request()
                        .input('tcaId', sql.Int, currentTcaId)
                        .query("DELETE FROM dbo.Pagos WHERE PagTcaIdTransaccion = @tcaId");

                    // Insertar nuevos pagos
                    if (Array.isArray(Pagos) && Pagos.length > 0) {
                        for (const pago of Pagos) {
                            const pMonto = parseFloat(pago.monto) || 0;
                            const pMonedaId = parseInt(pago.monedaId) || MonIdMoneda;
                            const pCot = pMonedaId === 2 ? cotDolar : 1;
                            const pConvertido = pMonedaId === 2 ? pMonto * pCot : pMonto;

                            await transaction.request()
                                .input('tcaId', sql.Int, currentTcaId)
                                .input('metodo', sql.Int, pago.metodoPagoId || 1)
                                .input('moneda', sql.Int, pMonedaId)
                                .input('monto', sql.Decimal(18, 4), pMonto)
                                .input('cot', sql.Decimal(18, 4), pCot)
                                .input('convert', sql.Decimal(18, 4), pConvertido)
                                .input('usuario', sql.Int, req.user?.id || 1)
                                .input('pagFecha', sql.DateTime, fechaEfectiva)
                                .query(`
                                    INSERT INTO dbo.Pagos
                                        (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
                                         PagMontoPago, PagFechaPago, PagUsuarioAlta, PagCotizacion,
                                         PagMontoConvertido, PagTipoMovimiento)
                                    VALUES
                                        (@tcaId, @metodo, @moneda,
                                         @monto, ISNULL(@pagFecha, GETDATE()), @usuario, @cot,
                                         @convert, 'COBRO')
                                `);
                        }
                    } else {
                        await transaction.request()
                            .input('tcaId', sql.Int, currentTcaId)
                            .input('metodo', sql.Int, MetodoPagoId || 1)
                            .input('moneda', sql.Int, MonIdMoneda)
                            .input('monto', sql.Decimal(18, 4), DocTotal)
                            .input('cot', sql.Decimal(18, 4), cotNum)
                            .input('convert', sql.Decimal(18, 4), convertido)
                            .input('usuario', sql.Int, req.user?.id || 1)
                            .input('pagFecha', sql.DateTime, fechaEfectiva)
                            .query(`
                                INSERT INTO dbo.Pagos
                                    (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
                                     PagMontoPago, PagFechaPago, PagUsuarioAlta, PagCotizacion,
                                     PagMontoConvertido, PagTipoMovimiento)
                                VALUES
                                    (@tcaId, @metodo, @moneda,
                                     @monto, ISNULL(@pagFecha, GETDATE()), @usuario, @cot,
                                     @convert, 'COBRO')
                            `);
                    }
                }
            }
        } else {
            if (newPaid) {
                // Cambió de Crédito a Contado: crear transacción de caja y pagos
                const cotResult = await transaction.request().query(`SELECT TOP 1 CotDolar FROM Cotizaciones ORDER BY CotFecha DESC`);
                const cotDolar = cotResult.recordset.length > 0 ? cotResult.recordset[0].CotDolar : 40.0;
                const cotNum = MonIdMoneda === 2 ? cotDolar : 1;
                const convertido = MonIdMoneda === 2 ? DocTotal * cotNum : DocTotal;

                const configRes = await transaction.request()
                    .input('codDoc', sql.NVarChar(100), DocTipo)
                    .query(`SELECT CodDocumento, SecSerie FROM Config_TiposDocumento c LEFT JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia WHERE c.CodDocumento = @codDoc OR c.Detalle = @codDoc`);
                const config = configRes.recordset[0] || { CodDocumento: DocTipo, SecSerie: 'M' };
                const serie = newSerie;
                const numero = newNumero;

                const tcaRes = await transaction.request()
                    .input('TcaUsuarioId', sql.Int, req.user?.id || 1)
                    .input('TcaClienteId', sql.Int, CliIdCliente || 1)
                    .input('TcaTipoDoc', sql.VarChar(20), (config.CodDocumento || DocTipo).substring(0, 20))
                    .input('TcaSerieDoc', sql.VarChar(5), serie)
                    .input('TcaNumeroDoc', sql.VarChar(20), String(numero))
                    .input('TcaBruto', sql.Decimal(18, 4), DocTotal)
                    .input('TcaNeto', sql.Decimal(18, 4), DocTotal)
                    .input('TcaCobrado', sql.Decimal(18, 4), convertido)
                    .input('TcaMonedaBase', sql.VarChar(10), MonIdMoneda === 2 ? 'USD' : 'UYU')
                    .input('TcaFecha', sql.DateTime, fechaEfectiva)
                    .query(`
                        INSERT INTO dbo.TransaccionesCaja
                            (TcaFecha, TcaUsuarioId, TcaClienteId, TcaTipoDocumento, TcaSerieDoc, TcaNumeroDoc,
                             TcaTotalBruto, TcaTotalAjuste, TcaTotalNeto, TcaTotalCobrado, TcaMonedaBase, TcaEstado, TcaObservaciones, EsCajaAdmin)
                        OUTPUT INSERTED.TcaIdTransaccion
                        VALUES
                            (ISNULL(@TcaFecha, GETDATE()), @TcaUsuarioId, @TcaClienteId, @TcaTipoDoc, @TcaSerieDoc, @TcaNumeroDoc,
                             @TcaBruto, 0, @TcaNeto, @TcaCobrado, @TcaMonedaBase, 'COBRADO', 'Pago Factura Manual Edicion', 1)
                    `);
                currentTcaId = tcaRes.recordset[0].TcaIdTransaccion;

                if (Array.isArray(Pagos) && Pagos.length > 0) {
                    for (const pago of Pagos) {
                        const pMonto = parseFloat(pago.monto) || 0;
                        const pMonedaId = parseInt(pago.monedaId) || MonIdMoneda;
                        const pCot = pMonedaId === 2 ? cotDolar : 1;
                        const pConvertido = pMonedaId === 2 ? pMonto * pCot : pMonto;

                        await transaction.request()
                            .input('tcaId', sql.Int, currentTcaId)
                            .input('metodo', sql.Int, pago.metodoPagoId || 1)
                            .input('moneda', sql.Int, pMonedaId)
                            .input('monto', sql.Decimal(18, 4), pMonto)
                            .input('cot', sql.Decimal(18, 4), pCot)
                            .input('convert', sql.Decimal(18, 4), pConvertido)
                            .input('usuario', sql.Int, req.user?.id || 1)
                            .input('pagFecha', sql.DateTime, fechaEfectiva)
                            .query(`
                                INSERT INTO dbo.Pagos
                                    (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
                                     PagMontoPago, PagFechaPago, PagUsuarioAlta, PagCotizacion,
                                     PagMontoConvertido, PagTipoMovimiento)
                                VALUES
                                    (@tcaId, @metodo, @moneda,
                                     @monto, ISNULL(@pagFecha, GETDATE()), @usuario, @cot,
                                     @convert, 'COBRO')
                            `);
                    }
                } else {
                    await transaction.request()
                        .input('tcaId', sql.Int, currentTcaId)
                        .input('metodo', sql.Int, MetodoPagoId || 1)
                        .input('moneda', sql.Int, MonIdMoneda)
                        .input('monto', sql.Decimal(18, 4), DocTotal)
                        .input('cot', sql.Decimal(18, 4), cotNum)
                        .input('convert', sql.Decimal(18, 4), convertido)
                        .input('usuario', sql.Int, req.user?.id || 1)
                        .input('pagFecha', sql.DateTime, fechaEfectiva)
                        .query(`
                            INSERT INTO dbo.Pagos
                                (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
                                 PagMontoPago, PagFechaPago, PagUsuarioAlta, PagCotizacion,
                                 PagMontoConvertido, PagTipoMovimiento)
                            VALUES
                                (@tcaId, @metodo, @moneda,
                                 @monto, ISNULL(@pagFecha, GETDATE()), @usuario, @cot,
                                 @convert, 'COBRO')
                        `);
                }

                await transaction.request()
                    .input('docId', sql.Int, id)
                    .input('tcaId', sql.Int, currentTcaId)
                    .query("UPDATE DocumentosContables SET TcaIdTransaccion = @tcaId WHERE DocIdDocumento = @docId");
            }
        }

        // 3. Reemitir asiento contable si existe
        if (doc.AsiIdAsiento) {
            await transaction.request()
                .input('asiId', sql.Int, doc.AsiIdAsiento)
                .query('DELETE FROM Cont_AsientosDetalle WHERE AsiId = @asiId');

            const cotResult = await transaction.request().query(`SELECT TOP 1 CotDolar FROM Cotizaciones ORDER BY CotFecha DESC`);
            const cotDolar = cotResult.recordset.length > 0 ? cotResult.recordset[0].CotDolar : 40.0;
            const cotiz = MonIdMoneda === 2 ? cotDolar : 1;
            const totalUYU = DocTotal * cotiz;

            const cuentaCliente = MonIdMoneda === 2 ? 119 : 118;
            const cuentaVentas = 411;

            await transaction.request()
                .input('asiId', sql.Int, doc.AsiIdAsiento)
                .input('cuentaCli', sql.Int, cuentaCliente)
                .input('cuentaVen', sql.Int, cuentaVentas)
                .input('totalUYU', sql.Decimal(18, 2), totalUYU)
                .input('totalOriginal', sql.Decimal(18, 2), DocTotal)
                .input('cotizacion', sql.Decimal(18, 4), cotiz)
                .input('monedaId', sql.Int, MonIdMoneda)
                .input('clienteId', sql.Int, CliIdCliente || null)
                .query(`
                    INSERT INTO Cont_AsientosDetalle 
                        (AsiId, CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetCotizacion, DetMonedaId, DetEntidadId, DetEntidadTipo)
                    VALUES
                        (@asiId, @cuentaCli, @totalUYU, 0, @totalOriginal, @cotizacion, @monedaId, @clienteId, 'CLIENTE'),
                        (@asiId, @cuentaVen, 0, @totalUYU, @totalOriginal, @cotizacion, @monedaId, @clienteId, 'CLIENTE')
                `);
        }

        await transaction.commit();
        res.json({ success: true, message: 'Documento y líneas actualizados correctamente' });
    } catch (err) {
        logger.error('Error editando documento CFE:', err);
        try {
            await transaction.rollback();
        } catch (rollbackErr) {
            // Ignorar si ya se abortó la transacción
        }
        res.status(500).json({ error: err.message });
    }
};

exports.getDetalleFactura = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();
        
        const result = await pool.request()
            .input('docId', sql.Int, id)
            .query(`
                SELECT 
                    DcdIdDetalle,
                    OrdCodigoOrden,
                    DcdNomItem,
                    DcdDscItem,
                    DcdCantidad,
                    DcdPrecioUnitario,
                    DcdSubtotal,
                    DcdImpuestos,
                    DcdTotal,
                    DcdTotalDescuentos,
                    DcdDescuentoStr
                FROM DocumentosContablesDetalle
                WHERE DocIdDocumento = @docId
            `);
            
        const docResult = await pool.request()
            .input('docId', sql.Int, id)
            .query(`
                SELECT 
                    d.*,
                    c.NombreFantasia      AS CliNombreFantasia,
                    c.Nombre             AS CliRazonSocial,
                    c.CioRuc             AS CliRUT,
                    c.CioRuc             AS CliDocumento,
                    c.IDCliente          AS StringIDCliente,
                    c.TelefonoTrabajo    AS CliTelefono,
                    c.TClIdTipoCliente   AS CliFamilia,
                    u.Nombre             AS VendedorNombre,
                    u.IdUsuario          AS VendedorId,
                    -- Datos secuencia/autorización DGI
                    s.SecNroResolucion,
                    s.SecRangoDesde,
                    s.SecRangoHasta,
                    s.SecFechaVencimientoCAE,
                    -- Código de tipo de comprobante DGI (ej: 111 = e-Ticket, 101 = e-Factura)
                    (SELECT TOP 1 ct2.Codigo_Efact FROM dbo.Config_TiposDocumento ct2 WHERE ct2.Detalle = d.DocTipo) AS CodigoEfact,
                    -- Config CFE global
                    (SELECT CfeCfgValor FROM dbo.Config_CFE WHERE CfeCfgClave = 'URL_VERIFICACION' AND CfeCfgActivo = 1) AS CfeUrlVerificacion,
                    (SELECT CfeCfgValor FROM dbo.Config_CFE WHERE CfeCfgClave = 'TEXTO_IVA_AL_DIA' AND CfeCfgActivo = 1) AS CfeTextoIvaDia,
                    -- Datos de la empresa emisora (multiempresa)
                    e.EmpRuc,
                    e.EmpRazonSocial,
                    e.EmpNombreFantasia,
                    e.EmpDireccion,
                    e.EmpCiudad,
                    e.EmpDepartamento,
                    e.EmpTelefono,
                    e.EmpLogoUrl,
                    e.EmpColorPrimario,
                    -- Total unidades del documento
                    (SELECT SUM(DcdCantidad) FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = d.DocIdDocumento) AS DocTotalUnidades
                FROM DocumentosContables d
                LEFT JOIN Clientes c ON d.CliIdCliente = c.CliIdCliente
                LEFT JOIN dbo.Empresas e ON e.EmpIdEmpresa = ISNULL(d.EmpIdEmpresa, (SELECT TOP 1 EmpIdEmpresa FROM dbo.Empresas WHERE EmpPorDefecto = 1))
                LEFT JOIN dbo.Usuarios u ON u.IdUsuario = ISNULL(d.DocVendedorId, d.DocUsuarioAlta)
                LEFT JOIN dbo.SecuenciaDocumentos s ON s.SecSerie = d.DocSerie
                    AND s.SecIdSecuencia = (
                        SELECT TOP 1 ct.SecIdSecuencia FROM dbo.Config_TiposDocumento ct 
                        WHERE ct.Detalle = d.DocTipo
                    )
                WHERE d.DocIdDocumento = @docId
            `);

        const doc = docResult.recordset[0] || null;
        let pagos = [];
        if (doc && doc.TcaIdTransaccion) {
            const pagosRes = await pool.request()
                .input('tcaId', sql.Int, doc.TcaIdTransaccion)
                .query('SELECT * FROM dbo.Pagos WITH(NOLOCK) WHERE PagTcaIdTransaccion = @tcaId');
            pagos = pagosRes.recordset;
        }

        res.json({ success: true, doc, detalles: result.recordset, pagos });
    } catch (err) {
        logger.error('Error obteniendo detalle de factura:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.getTiposDocumentosExistentes = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT DISTINCT DocTipo 
            FROM dbo.DocumentosContables WITH(NOLOCK) 
            WHERE CfeEstado IS NOT NULL 
              AND DocTipo IS NOT NULL
              AND DocTipo != ''
              AND DocTipo NOT LIKE '%RECIBO%'
              AND DocTipo NOT LIKE '%Recibo%'
            ORDER BY DocTipo
        `);
        const list = result.recordset.map(r => r.DocTipo);
        res.json({ success: true, data: list });
    } catch (err) {
        logger.error('Error en getTiposDocumentosExistentes:', err);
        res.status(500).json({ error: err.message });
    }
};
