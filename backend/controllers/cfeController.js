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
const envioEmailLog = require('../services/envioEmailLog');

/**
 * CfeTipoCFE es una columna nueva (backend/scripts/add_CfeTipoCFE.sql). Se consulta una
 * sola vez y se cachea, para que el código funcione igual antes y después de la migración
 * en vez de romper el listado con "Invalid column name".
 */
let _cacheColCfeTipoCFE = null;
async function columnaCfeTipoCFEExiste(pool) {
    if (_cacheColCfeTipoCFE !== null) return _cacheColCfeTipoCFE;
    try {
        const r = await pool.request().query(`
            SELECT 1 AS x FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='DocumentosContables' AND COLUMN_NAME='CfeTipoCFE'`);
        _cacheColCfeTipoCFE = r.recordset.length > 0;
    } catch (e) {
        _cacheColCfeTipoCFE = false;
    }
    return _cacheColCfeTipoCFE;
}

/**
 * Email del cliente para la bandeja CFE (envío del PDF por correo).
 * Devuelve DOS campos separados a propósito, NO un COALESCE:
 *   · CliEmail       → el de la ficha (dbo.Clientes.Email). Es char(40), así que
 *                      un mail más largo llegó truncado; además hay basura vieja
 *                      cargada ('-', 'a', 'VIVASPORTS'), por eso se exige formato.
 *   · CliEmailPortal → el del alta web (Clientesreact.CliMail, varchar(200)).
 * Se mantienen separados porque el del portal a veces es el del operador que dio
 * de alta al cliente, no el del cliente: quien envía tiene que ver de dónde sale
 * cada dirección y elegir, en lugar de que el sistema caiga en uno en silencio.
 *
 * El vínculo Clientes↔Clientesreact NO es 1:1 (hay fichas que matchean 3 filas del
 * portal), por eso va como subconsulta TOP 1 y no como JOIN: un JOIN duplicaría
 * documentos en el listado.
 *
 * Requiere que el SELECT tenga la tabla Clientes con el alias `c`.
 */
const SQL_EMAIL_CLIENTE = `
                NULLIF(LTRIM(RTRIM(CASE WHEN c.Email LIKE '%_@_%._%' THEN c.Email END)), '') AS CliEmail,
                (SELECT TOP 1 LTRIM(RTRIM(cr.CliMail))
                   FROM dbo.Clientesreact cr WITH(NOLOCK)
                  WHERE (cr.CliCodigoCliente = c.IDCliente
                     OR (c.IDReact IS NOT NULL AND c.IDReact <> ''
                         AND CAST(c.IDReact AS VARCHAR(50)) = CAST(cr.CliIdCliente AS VARCHAR(50))))
                    AND cr.CliMail LIKE '%_@_%._%'
                  ORDER BY cr.CliIdCliente DESC) AS CliEmailPortal`;

exports.getDocumentosCFE = async (req, res) => {
    try {
        const { fechaDesde, fechaHasta, tipo, estado, clienteId, empresaId, metodoPagoId } = req.query;
        const pool = await getPool();
        const request = pool.request();

        // Último envío por email de cada documento, para que la bandeja pueda mostrar
        // "ya se le mandó" y a qué casilla. El historial es compartido con los demás
        // módulos (estados de cuenta, etc.), por eso el fragmento SQL lo arma el
        // servicio. Si todavía no se corrió add_EnvioEmail.sql devuelve NULLs y el
        // listado funciona igual.
        const _envio = await envioEmailLog.sqlUltimoEnvio(envioEmailLog.MODULOS.CFE, 'd.DocIdDocumento');

        let baseQuery = `
            SELECT 
                d.*,
                c.NombreFantasia AS CliNombreFantasia,
                c.Nombre AS CliRazonSocial,
                c.CioRuc AS CliRUT,
                c.CioRuc AS CliDocumento,
                c.IDCliente AS StringIDCliente,
                ${SQL_EMAIL_CLIENTE},
                (SELECT TOP 1 mp.MPaDescripcionMetodo
                 FROM dbo.Pagos p WITH(NOLOCK)
                 JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON p.MPaIdMetodoPago = mp.MPaIdMetodoPago
                 WHERE p.PagTcaIdTransaccion = d.TcaIdTransaccion) AS MetodoPagoNombre,
                ref.DocTipo AS RefDocTipo,
                ref.CfeEstado AS RefCfeEstado,
                ${await columnaCfeTipoCFEExiste(pool) ? 'ref.CfeTipoCFE' : 'CAST(NULL AS INT)'} AS RefCfeTipoCFE,
                ${_envio.select}
            FROM DocumentosContables d
            LEFT JOIN Clientes c ON d.CliIdCliente = c.CliIdCliente
            LEFT JOIN DocumentosContables ref ON ref.DocIdDocumento = d.DocIdDocumentoRef
            ${_envio.apply}
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

        // Tipo de CFE según el nomenclador de DGI (101/111 venta, 102/112 NC, 103/113 ND).
        // Se devuelven DOS datos distintos, porque no son lo mismo:
        //   DgiTipoCorrecto -> el que corresponde hoy (lo que se va a emitir)
        //   DgiTipoEmitido  -> el que se le pidió a DGI cuando se emitió
        // En documentos ya aceptados antes del fix del DocTipo truncado, el emitido se
        // reconstruye con la lógica vieja (DgiEmitidoInferido=true) porque no quedó grabado.
        // Si difieren, DgiAlerta marca la fila: eso es exactamente lo que pasó con las NC.
        const docs = result.recordset.map(d => {
            // Solo aplica a documentos fiscales: los borradores (Pedido Caja), recibos y
            // egresos no se emiten como CFE, así que no se les inventa un tipo.
            const tipoUp = String(d.DocTipo || '').toUpperCase();
            const esFiscal = tipoUp.includes('TICKET') || tipoUp.includes('FACTURA');
            if (d.CfeEstado === 'BORRADOR' || !esFiscal) {
                return { ...d, DgiTipoCorrecto: null, DgiTipoCorrectoNombre: null, DgiTipoEmitido: null, DgiAlerta: false };
            }

            const cliDoc = String(d.DocCliDocumento || d.CliRUT || '').replace(/\D/g, '');
            // La familia del referenciado sale de lo que DGI realmente tiene, no del DocTipo interno
            const refEsFactura = d.RefDocTipo
                ? sisnetService.resolverReferencia(
                    { DocTipo: d.RefDocTipo, CfeEstado: d.RefCfeEstado, CfeTipoCFE: d.RefCfeTipoCFE }, cliDoc).esFactura
                : null;
            const correcto = sisnetService.resolverTipoCFE(d.DocTipo, cliDoc, refEsFactura);

            const yaEmitido = d.CfeEstado === 'ACEPTADO_DGI';
            let emitido = null;
            let inferido = false;
            if (yaEmitido) {
                if (d.CfeTipoCFE) {
                    emitido = d.CfeTipoCFE;                                        // dato grabado al emitir
                } else {
                    emitido = sisnetService.resolverTipoCFE_LEGACY(d.DocTipo, cliDoc); // reconstruido
                    inferido = true;
                }
            }

            const NOMBRES = {
                101: 'e-Ticket', 102: 'NC de e-Ticket', 103: 'ND de e-Ticket',
                111: 'e-Factura', 112: 'NC de e-Factura', 113: 'ND de e-Factura'
            };

            return {
                ...d,
                DgiTipoCorrecto: correcto.tipoCFE,
                DgiTipoCorrectoNombre: correcto.nombre,
                DgiTipoEmitido: emitido,
                DgiTipoEmitidoNombre: emitido ? NOMBRES[emitido] : null,
                DgiEmitidoInferido: inferido,
                DgiAlerta: !!(emitido && emitido !== correcto.tipoCFE)
            };
        });

        res.json(docs);
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

        // 3.5 Validaciones DGI del receptor — mensajes claros ANTES de llamar a SISNET.
        // El documento del receptor se resuelve IGUAL que en prepararCFE (la emisión real):
        // un e-Ticket sin RUT en el snapshot es consumidor final y NO hereda el RUT de la ficha.
        // Así el chequeo del umbral coincide con lo que realmente viaja (no valida un RUT que no va).
        const docTipoUpperV = String(doc.DocTipo || '').toUpperCase();
        const esFacturaCFE = docTipoUpperV.includes('FACTURA');
        const esTicketCFE = docTipoUpperV.includes('TICKET');
        const _snapVacioV = String(doc.DocCliDocumento || '').trim() === '';
        const docReceptorReal = (esTicketCFE && !docTipoUpperV.includes('NOTA') && _snapVacioV)
            ? ''                                        // consumidor final: sin receptor
            : (doc.DocCliDocumento || doc.CliRUT || '');
        const valReceptor = validarDocumentoUY(docReceptorReal);

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
            
        // Dejamos GRABADO el tipo de CFE que se le pidió a DGI. Sin esto, la bandeja solo
        // puede recalcular lo que "debería" haberse emitido, que no es lo mismo que lo emitido.
        // Tolerante a que la columna todavía no exista en esta instalación.
        try {
            await pool.request()
                .input('Id', sql.Int, id)
                .input('Tipo', sql.Int, resultSISNET.tipoCFE || null)
                .query(`UPDATE DocumentosContables SET CfeTipoCFE = @Tipo WHERE DocIdDocumento = @Id`);
        } catch (eTipo) {
            logger.warn(`[CFE] No se pudo guardar CfeTipoCFE del doc ${id} (¿falta la columna?): ${eTipo.message}`);
        }

        logger.info(`Documento ${id} emitido a DGI como CFE ${resultSISNET.tipoCFE} (${resultSISNET.nombreCFE}). CAE: ${resultSISNET.cae}`);
        res.json({
            message: 'Documento enviado exitosamente',
            cae: resultSISNET.cae,
            numeroOficial: resultSISNET.serie,
            tipoCFE: resultSISNET.tipoCFE,
            nombreCFE: resultSISNET.nombreCFE
        });
    } catch (error) {
        logger.error('Error enviando a DGI:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /contabilidad/cfe/documentos/:id/preview-dgi
 * Muestra EXACTAMENTE qué CFE se le va a pedir a la DGI para este documento, sin
 * emitir nada: no pide CAE, no llama a SISNET, no toca la base.
 * Arma el payload con sisnetService.prepararCFE, la misma función que usa el envío real.
 */
exports.previewDGI = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();

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

        // Misma resolución de empresa emisora que enviarADGI
        let empresa = null;
        if (doc.EmpIdEmpresa) {
            const empResult = await pool.request()
                .input('Emp', sql.Int, doc.EmpIdEmpresa)
                .query(`SELECT * FROM dbo.Empresas WHERE EmpIdEmpresa = @Emp`);
            empresa = empResult.recordset[0] || null;
        }
        if (!empresa) {
            const empDef = await pool.request()
                .query(`SELECT TOP 1 * FROM dbo.Empresas WHERE EmpPorDefecto=1 ORDER BY EmpIdEmpresa`);
            empresa = empDef.recordset[0] || null;
        }

        const lineasResult = await pool.request()
            .input('Id', sql.Int, id)
            .query(`SELECT * FROM DocumentosContablesDetalle WHERE DocIdDocumento = @Id`);

        const cotResult = await pool.request()
            .query(`SELECT TOP 1 CotDolar FROM Cotizaciones ORDER BY CotFecha DESC`);
        const cotDolar = cotResult.recordset.length > 0 ? cotResult.recordset[0].CotDolar : 40.0;

        const prep = await sisnetService.prepararCFE(doc, lineasResult.recordset, cotDolar, empresa);

        const bloqueos = [...prep.bloqueos];
        if (!empresa || !empresa.EmpActiva || !empresa.EmpSisnetCaja) {
            bloqueos.push('La empresa emisora no está configurada para facturación electrónica (requiere estar activa y tener caja SISNET).');
        }
        if (doc.CfeEstado === 'ACEPTADO_DGI') {
            bloqueos.push('Este documento ya fue firmado y aceptado por DGI.');
        }

        // Datos del documento referenciado, para mostrarlos legibles
        let referencia = null;
        if (prep.listaWsReferencias.length > 0) {
            const r = prep.listaWsReferencias[0];
            referencia = {
                tipo: r.tpoDocRef,
                serie: r.serie,
                numero: r.nroCFERef,
                fecha: r.fechaCFEref,
                monto: r.mntCFEref,
                razon: r.razonReferencia,
                // Referencia global = el documento corregido no es un CFE (factura del sistema
                // anterior). Va sin tipo/serie/número a propósito: DGI no lo busca en su base.
                esGlobal: r.indicadorReferenciaGlobal === 1
            };
        }

        res.json({
            documento: {
                id: doc.DocIdDocumento,
                docTipo: doc.DocTipo,
                serie: doc.DocSerie,
                numero: doc.DocNumero,
                estadoCfe: doc.CfeEstado,
                total: doc.DocTotal,
                moneda: doc.MonIdMoneda === 2 ? 'USD' : 'UYU'
            },
            // Los nombres reales de las columnas son EmpRazonSocial/EmpNombreFantasia y EmpRuc:
            // EmpNombre y EmpRut no existen en la tabla, por eso salían vacíos en la previa.
            emisor: empresa ? {
                nombre: empresa.EmpNombreFantasia || empresa.EmpRazonSocial,
                rut: empresa.EmpRuc,
                caja: empresa.EmpSisnetCaja
            } : null,
            cfe: {
                tipoCFE: prep.tipoCFE,
                nombre: prep.nombreCFE,
                familia: prep.familia,
                esNC: prep.esNC,
                esND: prep.esND,
                incluyeReceptor: prep.incluyeReceptor
            },
            receptor: prep.incluyeReceptor ? prep.cfeData.wsReceptor : null,
            receptorValidacion: {
                valido: prep.valReceptor.valido,
                tipo: prep.valReceptor.tipo,
                motivo: prep.valReceptor.motivo || null
            },
            referencia,
            totales: prep.cfeData.wsTotales,
            varios: prep.cfeData.wsVarios,
            lineas: prep.cfeData.listaWsItems,
            bloqueos
        });
    } catch (error) {
        logger.error('Error generando vista previa DGI:', error);
        res.status(500).json({ error: error.message });
    }
};

exports.crearFacturaManual = async (req, res) => {
    const { DocTipo, MonIdMoneda, CliIdCliente, Lineas, Totales, DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad, DocCliNombreFantasia, DocPagado, MetodoPagoId, Pagos, empresaId, DocFechaEmision } = req.body;
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
            // Descuento por línea: el precio unitario es el bruto y el % se guarda aparte
            // para poder imprimirlo tal cual se tipeó.
            const descPct = Math.min(100, Math.max(0, parseFloat(linea.descPct) || 0));
            const bruto = cant * precio;
            const descMonto = bruto * (descPct / 100);
            const lineTotal = bruto - descMonto;
            const lineNeto = lineTotal / (1 + ivaRate / 100);
            const lineIva = lineTotal - lineNeto;
            return {
                nomItem: (linea.concepto || '').substring(0, 255),
                dscItem: linea.DcdDscItem || linea.sublinea || '',
                cantidad: cant,
                precioUnitario: precio,
                subtotal: lineNeto,
                impuestos: lineIva,
                total: lineTotal,
                totalDescuentos: descPct > 0 ? descMonto : 0,
                descuentoPct: descPct > 0 ? descPct : null
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
                // Fantasía del comprobante: se congela acá y NO toca la ficha del cliente.
                docCliNombreFantasia: (DocCliNombreFantasia || '').trim(),
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
            // 3/4 (Abonado) → 1 (Ingresado); 8 (Empaquetado y abonado) → 7 (Empaquetado SIN abonar).
            // OJO: 8 nunca va a 5 (Entregado) — anular un pago no puede "entregar" un retiro que el
            // cliente todavía no pasó a buscar. El resto de los estados (incluido 5) se preserva.
            await transaction.request()
                .input('tcaId', sql.Int, tcaId)
                .query(`
                    UPDATE dbo.OrdenesRetiro
                    SET PagIdPago = NULL,
                        OReEstadoActual = CASE
                            WHEN OReEstadoActual IN (3, 4) THEN 1
                            WHEN OReEstadoActual = 8 THEN 7
                            ELSE OReEstadoActual
                        END,
                        OReFechaEstadoActual = CASE WHEN OReEstadoActual IN (3, 4, 8) THEN GETDATE() ELSE OReFechaEstadoActual END,
                        ORePasarPorCaja = 1
                    WHERE PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @tcaId)
                `);

            // 5. Insertar histórico — SOLO de los retiros cuyo estado realmente cambió (antes insertaba
            // una fila por TODOS, y un retiro ya Entregado quedaba con un "Entregado" fantasma de quien anuló).
            for (const o of ordRetiroRes.recordset) {
                const nuevoEstado = (o.OReEstadoActual === 3 || o.OReEstadoActual === 4) ? 1 : (o.OReEstadoActual === 8 ? 7 : o.OReEstadoActual);
                if (nuevoEstado === o.OReEstadoActual) continue;
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
            // Solo se revierte el estado que puso el PAGO (7 = Pronto para entregar → 6 = Avisado).
            // Cualquier otro estado se preserva: anular un pago NO des-entrega una orden que el cliente
            // ya retiró (9 = Entregado). Antes encajaba 6 a lo bruto y "des-entregaba" órdenes.
            // Se registra en el histórico solo lo que realmente cambió (igual que el retiro, paso 5).
            await transaction.request()
                .input('tcaId', sql.Int, tcaId)
                .input('usuarioId', sql.Int, usuarioId)
                .query(`
                    DECLARE @cambios TABLE (OrdIdOrden INT, EstadoViejo INT, EstadoNuevo INT);

                    UPDATE dbo.OrdenesDeposito
                    SET PagIdPago = NULL,
                        OrdEstadoActual      = CASE WHEN OrdEstadoActual = 7 THEN 6 ELSE OrdEstadoActual END,
                        OrdFechaEstadoActual = CASE WHEN OrdEstadoActual = 7 THEN GETDATE() ELSE OrdFechaEstadoActual END
                    OUTPUT inserted.OrdIdOrden, deleted.OrdEstadoActual, inserted.OrdEstadoActual INTO @cambios
                    WHERE PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @tcaId);

                    INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                    SELECT OrdIdOrden, EstadoNuevo, GETDATE(), @usuarioId
                    FROM @cambios WHERE EstadoViejo <> EstadoNuevo;
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
            lineas, DocCliNombre, DocCliDocumento, DocCliDireccion, DocCliCiudad, DocCliNombreFantasia,
            DocPagado, MetodoPagoId, Pagos, empresaId, preservarPagos, DocFechaEmision,
            // Solo los manda la edición de una NC/ND (documento que corrige + motivo)
            DocIdDocumentoRef, DocMotivoRef,
            // { tipo:'TICKET'|'FACTURA', serie, numero, fecha, total, monedaId } — datos del CFE
            // original cuando la nota corrige una factura del sistema anterior.
            referenciaExterna,
            // El front lo manda solo cuando el usuario confirmó el aviso de "esta factura ya
            // fue cobrada". Sin esto, una edición que la devuelva a pendientes se rechaza.
            confirmarRevertirCobro
        } = req.body;

        const pool = await getPool();
        const transaction = pool.transaction();
        await transaction.begin();

        const docRes = await transaction.request()
            .input('id', sql.Int, id)
            .query('SELECT DocTipo, CfeEstado, DocPagado, AsiIdAsiento, TcaIdTransaccion, DocTotal, DocSerie, DocNumero, DocFechaEmision, MonIdMoneda FROM DocumentosContables WHERE DocIdDocumento = @id');

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

        const cleanOldDocTipo = String(doc.DocTipo || '').trim();

        // CANDADO: una nota de crédito/débito NO puede cambiar de tipo al editarse.
        // El modal de facturación solo conoce las tres solapas de venta (Pedido Caja /
        // e-Ticket / e-Factura), así que al abrir una NC mandaba "E-Ticket Contado" y la
        // edición la CONVERTÍA en venta: consumía un número de la secuencia ET y
        // reescribía serie y número. Acá se ignora el tipo entrante y se conserva el propio.
        const esNotaCreditoDebito = /nota\s*de\s*cr|nota_credito|nota\s*de\s*de|nota_debito/i.test(cleanOldDocTipo);
        if (esNotaCreditoDebito && String(DocTipo || '').trim() !== cleanOldDocTipo) {
            logger.warn(`[CFE-EDIT] Doc #${id} es "${cleanOldDocTipo}": se ignora el cambio de tipo a "${String(DocTipo || '').trim()}" (una nota no se convierte en venta).`);
        }
        const cleanDocTipo = esNotaCreditoDebito ? cleanOldDocTipo : String(DocTipo || '').trim();

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

        // ─────────────────────────────────────────────
        // CANDADO: no devolver a pendientes una factura que ya se cobró.
        // Guardar con "no pagado" una factura cobrada le regenera la deuda y el cliente
        // vuelve a aparecer debiendo algo que ya pagó. El front puede pisar DocPagado sin
        // que el usuario se dé cuenta, así que la confirmación se exige acá.
        // Se mide el cobro REAL (plata imputada), no la bandera DocPagado.
        if (!newPaid) {
            const cobroRes = await transaction.request()
                .input('docId', sql.Int, parseInt(id))
                .query(`
                    SELECT
                      Imputado = ISNULL((
                        SELECT SUM(dd.DDeImporteOriginal - dd.DDeImportePendiente)
                        FROM dbo.DeudaDocumento dd WHERE dd.DocIdDocumento = @docId
                      ), 0),
                      MovsPago = ISNULL((
                        SELECT COUNT(*) FROM dbo.MovimientosCuenta m
                        WHERE m.DocIdDocumento = @docId AND m.MovTipo IN ('PAGO','COBRO')
                          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      ), 0)
                `);
            const { Imputado, MovsPago } = cobroRes.recordset[0];
            const yaCobrada = Number(Imputado) > 0.01 || Number(MovsPago) > 0 || oldPaid;
            if (yaCobrada && confirmarRevertirCobro !== true) {
                await transaction.rollback();
                return res.status(409).json({
                    error: 'FACTURA_YA_COBRADA',
                    requiereConfirmacion: true,
                    importeImputado: Number(Imputado) || 0,
                    cantidadPagos: Number(MovsPago) || 0,
                    documento: `${doc.DocSerie}-${doc.DocNumero}`,
                    mensaje: `La factura ${doc.DocSerie}-${doc.DocNumero} ya fue cobrada`
                           + (Number(Imputado) > 0.01 ? ` (${Number(Imputado).toFixed(2)} imputado${Number(MovsPago) > 0 ? ` en ${MovsPago} pago(s)` : ''})` : '')
                           + '. Guardarla como NO pagada le va a regenerar la deuda y va a volver a aparecer en pendientes.'
                });
            }
            if (yaCobrada) {
                logger.warn(`[CFE-EDIT] Doc #${id} (${doc.DocSerie}-${doc.DocNumero}) cobrado por ${Number(Imputado).toFixed(2)} se revierte a pendiente — confirmado por usuario ${req.user?.id || '?'}.`);
            }
        }

        // CANDADO: la cabecera y el detalle tienen que cerrar por el mismo importe.
        // Si no cierran, el documento queda mintiendo: nuestro PDF imprime el total de la
        // cabecera, pero el CFE que se le manda a DGI se calcula sumando las LÍNEAS. Pasó de
        // verdad — una nota impresa por 3,08 con una sola línea de 1,08 — y salió emitida así.
        if (Array.isArray(lineas) && lineas.length) {
            const sumaLineas = lineas.reduce((acc, l) => acc + (parseFloat(l.DcdTotal) || 0), 0);
            if (Math.abs(sumaLineas - (parseFloat(DocTotal) || 0)) > 0.02) {
                await transaction.rollback();
                logger.warn(`[CFE-EDIT] Doc #${id} rechazado: la suma de las líneas (${sumaLineas.toFixed(2)}) ` +
                    `no coincide con el total del documento (${Number(DocTotal).toFixed(2)}).`);
                return res.status(400).json({
                    error: `El detalle no cierra con el total: las líneas suman ${sumaLineas.toFixed(2)} ` +
                           `y el documento dice ${Number(DocTotal).toFixed(2)}. No se guardó nada.`
                });
            }
        }

        // 1. Actualizar cabecera del documento
        await transaction.request()
            .input('id', sql.Int, id)
            // DocTipo es varchar(20) en la base. El Detalle puede ser más largo (ej.
            // "E-Factura Nota De Credito" = 25): con ANSI_WARNINGS ON, escribir eso reventaba
            // el UPDATE por truncamiento. Se acota a 20 (mismo largo que ya guarda la columna).
            .input('docTipo', sql.NVarChar(20), String(savedDocTipo || '').substring(0, 20))
            .input('clienteId', sql.Int, CliIdCliente || 2089) // 2089 = CONSUMIDOR FINAL genérico (1 es un cliente real)
            .input('moneda', sql.Int, MonIdMoneda)
            .input('subtotal', sql.Decimal(18, 2), DocSubtotal)
            .input('iva', sql.Decimal(18, 2), DocImpuestos)
            .input('total', sql.Decimal(18, 2), DocTotal)
            .input('cuenta', sql.Int, MonIdMoneda === 2 ? 119 : 118)
            .input('obs', sql.NVarChar(500), DocObservaciones || '')
            // Los largos van al tamaño REAL de cada columna (DocCliNombre/Direccion 255,
            // Documento 50). Estaban en 200/20: un nombre o dirección más largo que eso hacía
            // fallar el request con "invalid data length" — el mismo bug de @concepto.
            .input('cliNombre', sql.NVarChar(255), String(DocCliNombre || '').substring(0, 255))
            .input('cliDoc', sql.NVarChar(50), String(DocCliDocumento || '').substring(0, 50))
            .input('cliDir', sql.NVarChar(255), String(DocCliDireccion || '').substring(0, 255))
            .input('cliCiu', sql.NVarChar(100), String(DocCliCiudad || '').substring(0, 100))
            // Si el front no manda el campo (edición vieja), no se pisa lo que ya tenía el doc.
            .input('cliFant', sql.NVarChar(200), DocCliNombreFantasia !== undefined ? String(DocCliNombreFantasia || '').trim().substring(0, 200) : null)
            .input('docPagado', sql.Bit, newPaid ? 1 : 0)
            .input('serie', sql.VarChar(10), newSerie)
            .input('numero', sql.Int, newNumero)
            .input('cfeEstado', sql.VarChar(20), newCfeEstado)
            .input('emp', sql.Int, empresaId || null)
            .input('fechaEmis', sql.DateTime, fechaEdit)
            // Referencia de la NC/ND: el documento que corrige y el motivo. Solo se tocan si el
            // front los manda (una edición de factura común no los envía y no debe borrarlos).
            .input('docRef', sql.Int, DocIdDocumentoRef != null ? Number(DocIdDocumentoRef) : null)
            .input('motivoRef', sql.NVarChar(300), DocMotivoRef != null ? String(DocMotivoRef).substring(0, 300) : null)
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
                    DocCliNombreFantasia = ISNULL(@cliFant, DocCliNombreFantasia),
                    DocPagado         = @docPagado,
                    DocSerie          = @serie,
                    DocNumero         = @numero,
                    CfeEstado         = @cfeEstado,
                    EmpIdEmpresa      = ISNULL(@emp, EmpIdEmpresa),
                    DocFechaEmision   = ISNULL(@fechaEmis, DocFechaEmision),
                    DocIdDocumentoRef = ISNULL(@docRef, DocIdDocumentoRef),
                    DocMotivoRef      = ISNULL(@motivoRef, DocMotivoRef)
                WHERE DocIdDocumento = @id
            `);

        // 1.b Datos del CFE ORIGINAL cuando la nota corrige una factura externa.
        // Esos datos no viven en la nota: viven en el documento "stub" que la nota referencia
        // (lo crea generarNotaCreditoExterna). Si no coinciden EXACTAMENTE con lo que DGI tiene
        // registrado, la nota se rechaza con "No se encontró el CFE referenciado" — por eso
        // tienen que poder corregirse. Solo se toca un stub externo: nunca un documento propio.
        if (referenciaExterna && typeof referenciaExterna === 'object') {
            const refActual = await transaction.request()
                .input('id', sql.Int, id)
                .query(`SELECT r.DocIdDocumento, r.DocTipo
                        FROM DocumentosContables d
                        JOIN DocumentosContables r ON r.DocIdDocumento = d.DocIdDocumentoRef
                        WHERE d.DocIdDocumento = @id`);
            const stub = refActual.recordset[0];
            if (!stub) {
                logger.warn(`[CFE-EDIT] Doc #${id}: se mandaron datos de factura externa pero no tiene documento referenciado. Se ignoran.`);
            } else if (!/extern[oa]/i.test(stub.DocTipo || '')) {
                logger.warn(`[CFE-EDIT] Doc #${id}: el referenciado #${stub.DocIdDocumento} es "${String(stub.DocTipo).trim()}", no un stub externo. No se toca.`);
            } else {
                const esFacturaOrigen = String(referenciaExterna.tipo || '').toUpperCase() === 'FACTURA';
                const monRef = Number(referenciaExterna.monedaId) === 2 ? 2 : 1;
                await transaction.request()
                    .input('refId',   sql.Int, stub.DocIdDocumento)
                    .input('tipo',    sql.NVarChar(50), esFacturaOrigen ? 'E-Factura Externa' : 'E-Ticket Externo')
                    .input('serie',   sql.VarChar(10), String(referenciaExterna.serie || '').trim().substring(0, 10))
                    .input('numero',  sql.VarChar(50), String(referenciaExterna.numero || '').trim().substring(0, 50))
                    .input('fecha',   sql.DateTime, referenciaExterna.fecha ? new Date(referenciaExterna.fecha) : null)
                    .input('total',   sql.Decimal(18, 2), Number(referenciaExterna.total) || 0)
                    .input('moneda',  sql.Int, monRef)
                    .query(`
                        UPDATE DocumentosContables SET
                            DocTipo         = @tipo,
                            DocSerie        = @serie,
                            DocNumero       = @numero,
                            DocFechaEmision = ISNULL(@fecha, DocFechaEmision),
                            DocSubtotal     = @total,
                            DocTotal        = @total,
                            MonIdMoneda     = @moneda
                        WHERE DocIdDocumento = @refId
                    `);
                logger.info(`[CFE-EDIT] Doc #${id}: datos del CFE externo referenciado (#${stub.DocIdDocumento}) actualizados → ` +
                    `${esFacturaOrigen ? 'E-Factura' : 'E-Ticket'} ${referenciaExterna.serie}-${referenciaExterna.numero}`);
            }
        }

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

            // Reinsertar las líneas editadas.
            // Los descuentos viajan en el payload: si no se reinsertaran, cada edición borraría
            // el % y el importe descontado, y la factura se reimprimía sin descuento y con el
            // precio unitario ya neteado.
            for (const linea of lineas) {
                const descMonto = parseFloat(linea.DcdTotalDescuentos) || 0;
                const descPct = (linea.DcdDescuentoPct != null && Number(linea.DcdDescuentoPct) > 0)
                    ? Number(linea.DcdDescuentoPct)
                    : null;
                await transaction.request()
                    .input('docId', sql.Int, id)
                    // DcdNomItem en la base es nvarchar(80): un concepto más largo hacía
                    // fallar el INSERT por truncamiento. Se acota a 80 (el detalle largo va en
                    // DcdDscItem, que es nvarchar(1000)).
                    .input('nom', sql.NVarChar(80), String(linea.DcdNomItem || '').substring(0, 80))
                    .input('dsc', sql.NVarChar(1000), String(linea.DcdDscItem || '').substring(0, 1000))
                    .input('cant', sql.Decimal(18, 4), parseFloat(linea.DcdCantidad) || 1)
                    .input('precio', sql.Decimal(18, 4), parseFloat(linea.DcdPrecioUnitario) || 0)
                    .input('sub', sql.Decimal(18, 2), parseFloat(linea.DcdSubtotal) || 0)
                    .input('imp', sql.Decimal(18, 2), parseFloat(linea.DcdImpuestos) || 0)
                    .input('tot', sql.Decimal(18, 2), parseFloat(linea.DcdTotal) || 0)
                    .input('desc', sql.Decimal(18, 2), descMonto > 0.001 ? descMonto : null)
                    .input('descStr', sql.VarChar(100), linea.DcdDescuentoStr || null)
                    .input('descPct', sql.Decimal(9, 4), descPct)
                    .query(`
                        INSERT INTO DocumentosContablesDetalle
                            (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr, DcdDescuentoPct)
                        VALUES (@docId, @nom, @dsc, @cant, @precio, @sub, @imp, @tot, @desc, @descStr, @descPct)
                    `);
            }
        }

        // ── Estrategia de movimientos ───────────────────────────────────────────────
        // El endpoint ya bloquea documentos enviados a DGI (ACEPTADO, COBRADO, etc.)
        // Cualquier documento que llega aquí (BORRADOR o PENDIENTE) es editable.
        // Política: siempre actualizamos en el lugar — sin rastro de anulación.
        const tipoChanged   = cleanDocTipo !== cleanOldDocTipo;
        const montoChanged  = Math.abs(DocTotal - (doc.DocTotal || 0)) > 0.001;
        const paidChanged   = newPaid !== oldPaid;
        const monedaChanged = parseInt(MonIdMoneda) !== parseInt(doc.MonIdMoneda);

        const cliIdNum     = parseInt(CliIdCliente) || 0;
        const isRealClient = cliIdNum > 0 && cliIdNum !== CONSUMIDOR_FINAL_ID && cliIdNum !== 100101;

        if (isRealClient && (tipoChanged || montoChanged || paidChanged || monedaChanged)) {
          const cueTipoEdit = MonIdMoneda === 2 ? 'DINERO_USD' : 'DINERO_UYU';
          const ctaEditId   = await contabilidadService.obtenerOCrearCuenta(cliIdNum, cueTipoEdit, {
            MonIdMoneda, UsuarioAlta: req.user?.id || 1
          }, transaction);
          const cicloObj = await contabilidadService.obtenerCicloActivo(ctaEditId, transaction);
          const cicId    = cicloObj ? cicloObj.CicIdCiclo : null;

          // ── Migrar deuda/movimientos a la cuenta de la NUEVA moneda ──────────
          // DeudaDocumento no tiene columna propia de moneda: la hereda de
          // CuentasCliente.MonIdMoneda vía CueIdCuenta. Si solo cambia la moneda del
          // documento (mismo monto, mismo tipo, mismo estado de pago), ninguna de las
          // ramas de abajo se ejecuta y la deuda queda huérfana apuntando a la cuenta
          // vieja (la moneda mostrada en el modal de cobro nunca sigue al documento).
          // Acá se migra TODO lo que ya existe para este documento a ctaEditId antes de
          // que las ramas de abajo apliquen sus deltas de monto (que sí asumen ctaEditId
          // como cuenta "hogar" del documento).
          // MovimientosCuenta y DeudaDocumento se migran de forma INDEPENDIENTE (no asumir
          // que comparten la misma cuenta vieja): en datos reales se encontró un documento
          // donde MovimientosCuenta ya estaba en la cuenta correcta pero DeudaDocumento
          // seguía huérfana en la cuenta vieja.
          if (monedaChanged) {
            // El marcador de trazabilidad del cierre cross-moneda (importe 0, obs
            // 'Cross-moneda:...') vive EN LA CUENTA DE ORIGEN a propósito: no se migra.
            // Si se migrara, quedaría en la misma cuenta que el cargo real y el UPDATE
            // de abajo lo convertiría en un segundo cargo (caso FA-254 Posse).
            const wrongMovRes = await transaction.request()
              .input('docId',  sql.Int, parseInt(id))
              .input('target', sql.Int, ctaEditId)
              .query(`
                SELECT DISTINCT CueIdCuenta
                FROM dbo.MovimientosCuenta
                WHERE DocIdDocumento = @docId AND CueIdCuenta <> @target
                  AND (MovAnulado IS NULL OR MovAnulado = 0)
                  AND NOT (MovObservaciones LIKE 'Cross-moneda:%')
              `);

            for (const { CueIdCuenta: oldCtaId } of wrongMovRes.recordset) {
              const sumRes = await transaction.request()
                .input('docId',  sql.Int, parseInt(id))
                .input('oldCta', sql.Int, oldCtaId)
                .query(`
                  SELECT ISNULL(SUM(MovImporte), 0) AS Total
                  FROM dbo.MovimientosCuenta
                  WHERE DocIdDocumento = @docId AND CueIdCuenta = @oldCta
                    AND (MovAnulado IS NULL OR MovAnulado = 0)
                    AND NOT (MovObservaciones LIKE 'Cross-moneda:%')
                `);
              const totalMovido = Number(sumRes.recordset[0].Total) || 0;

              await transaction.request()
                .input('docId',  sql.Int, parseInt(id))
                .input('oldCta', sql.Int, oldCtaId)
                .input('newCta', sql.Int, ctaEditId)
                .query(`
                  UPDATE dbo.MovimientosCuenta
                  SET CueIdCuenta = @newCta
                  WHERE DocIdDocumento = @docId AND CueIdCuenta = @oldCta
                    AND (MovAnulado IS NULL OR MovAnulado = 0)
                    AND NOT (MovObservaciones LIKE 'Cross-moneda:%')
                `);

              if (Math.abs(totalMovido) > 0.001) {
                await transaction.request()
                  .input('oldCta', sql.Int, oldCtaId)
                  .input('total',  sql.Decimal(18,4), totalMovido)
                  .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual - @total WHERE CueIdCuenta = @oldCta`);
                await transaction.request()
                  .input('newCta', sql.Int, ctaEditId)
                  .input('total',  sql.Decimal(18,4), totalMovido)
                  .query(`UPDATE dbo.CuentasCliente SET CueSaldoActual = CueSaldoActual + @total WHERE CueIdCuenta = @newCta`);
              }

              logger.info(`[CFE-EDIT] Doc #${id}: MovimientosCuenta migrado de cuenta ${oldCtaId} a ${ctaEditId} por cambio de moneda (MonIdMoneda=${MonIdMoneda}).`);
            }

            const deudaMigRes = await transaction.request()
              .input('docId',  sql.Int, parseInt(id))
              .input('target', sql.Int, ctaEditId)
              .query(`
                UPDATE dbo.DeudaDocumento
                SET CueIdCuenta = @target
                OUTPUT DELETED.CueIdCuenta AS Anterior
                WHERE DocIdDocumento = @docId AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                  AND CueIdCuenta <> @target
              `);
            if (deudaMigRes.recordset.length) {
              logger.info(`[CFE-EDIT] Doc #${id}: DeudaDocumento migrada a cuenta ${ctaEditId} (antes: ${deudaMigRes.recordset.map(r => r.Anterior).join(',')}).`);
            }
          }

          // 1. Actualizar concepto e importe del movimiento de CARGO (siempre)
          // MovConcepto es nvarchar(500). El parámetro estaba declarado VarChar(200): con un
          // nombre de cliente largo el texto pasaba de 200 y tedious rechazaba el request
          // ("@concepto ... invalid data length"). Se declara al largo real y se acota por las dudas.
          const nuevoConcepto = `Venta ${newConfig?.Detalle || DocTipo}: ${newSerie}-${newNumero}${DocCliNombre ? ' (' + DocCliNombre + ')' : ''}`.substring(0, 500);
          await transaction.request()
            .input('docId',    sql.Int,          parseInt(id))
            .input('imp',      sql.Decimal(18,4), -DocTotal)
            .input('concepto', sql.NVarChar(500), nuevoConcepto)
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
                -- El marcador cross-moneda de la cuenta ORIGEN nace con importe 0 y debe
                -- seguir en 0: estamparle el total acá creaba un cargo duplicado en la otra
                -- moneda (caso Palmero PC-2515: billetera USD y UYU con la misma deuda).
                AND NOT (MovObservaciones LIKE 'Cross-moneda:%')
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
            const conceptoPago = `Pago (${newConfig?.Detalle || DocTipo}): ${newSerie}-${newNumero}`.substring(0, 500);
            await transaction.request()
              .input('docId',    sql.Int,          parseInt(id))
              .input('imp',      sql.Decimal(18,4), DocTotal)
              .input('concepto', sql.NVarChar(500), conceptoPago)
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
                    DcdDescuentoStr,
                    DcdDescuentoPct
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
                    ${SQL_EMAIL_CLIENTE},
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

        // Cobro REAL del documento (plata efectivamente imputada), no la bandera DocPagado.
        // Una factura nacida a crédito y cobrada por cuenta corriente puede tener DocPagado=0
        // y estar saldada igual: sin este dato la pantalla de edición no puede avisar.
        let cobro = { importeImputado: 0, cantidadPagos: 0, pendiente: 0, estaCobrada: false };
        if (doc) {
            const cobroRes = await pool.request()
                .input('docId', sql.Int, id)
                .query(`
                    SELECT
                      Imputado = ISNULL((
                        SELECT SUM(dd.DDeImporteOriginal - dd.DDeImportePendiente)
                        FROM dbo.DeudaDocumento dd WITH(NOLOCK) WHERE dd.DocIdDocumento = @docId
                      ), 0),
                      Pendiente = ISNULL((
                        SELECT SUM(dd.DDeImportePendiente)
                        FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                        WHERE dd.DocIdDocumento = @docId AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                      ), 0),
                      MovsPago = ISNULL((
                        SELECT COUNT(*) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                        WHERE m.DocIdDocumento = @docId AND m.MovTipo IN ('PAGO','COBRO')
                          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      ), 0)
                `);
            const c = cobroRes.recordset[0] || {};
            cobro = {
                importeImputado: Number(c.Imputado) || 0,
                pendiente:       Number(c.Pendiente) || 0,
                cantidadPagos:   Number(c.MovsPago) || 0,
                estaCobrada:     Number(c.Imputado) > 0.01 || Number(c.MovsPago) > 0
                                 || doc.DocPagado === true || doc.DocPagado === 1,
            };
        }

        // Documento REFERENCIADO (el que la NC/ND corrige). La pantalla de edición lo
        // necesita legible: DocIdDocumentoRef solo es un número, y lo que define si DGI
        // acepta la nota es si ese documento llegó a ser un CFE (tiene CAE) o no.
        let referencia = null;
        if (doc && doc.DocIdDocumentoRef) {
            const refRes = await pool.request()
                .input('refId', sql.Int, doc.DocIdDocumentoRef)
                .query(`
                    SELECT DocIdDocumento, LTRIM(RTRIM(DocTipo)) AS DocTipo, DocSerie, DocNumero,
                           DocFechaEmision, DocTotal, MonIdMoneda, CfeEstado, CfeNumeroOficial
                    FROM dbo.DocumentosContables WITH(NOLOCK) WHERE DocIdDocumento = @refId
                `);
            const r = refRes.recordset[0];
            if (r) {
                // Tres orígenes distintos, y la pantalla tiene que poder distinguirlos:
                //  PROPIO  → lo emitió este sistema y DGI lo aceptó (tiene CAE).
                //  EXTERNO → factura del sistema de facturación anterior, declarada a mano.
                //            CfeEstado es null a propósito (así no entra en la Bandeja CFE),
                //            pero SÍ es un CFE que DGI tiene: la nota lo referencia normal.
                //  SIN_EMITIR → documento propio que nunca se envió. DGI no lo conoce.
                const esExterno = /extern[oa]/i.test(r.DocTipo || '');
                referencia = {
                    ...r,
                    origen: (r.CfeEstado === 'ACEPTADO_DGI' && r.CfeNumeroOficial) ? 'PROPIO'
                          : esExterno ? 'EXTERNO'
                          : 'SIN_EMITIR',
                };
            }
        }

        res.json({ success: true, doc, detalles: result.recordset, pagos, cobro, referencia });
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

/* ────────────────────────────────────────────────────────────────────────────
   ENVÍO DEL PDF POR EMAIL (Bandeja CFE)
   ──────────────────────────────────────────────────────────────────────────── */

// Validación de email deliberadamente estricta: exige algo@algo.tld sin espacios.
// La ficha del cliente tiene basura vieja cargada ('-', 'a', 'VIVASPORTS') y un
// destinatario inválido haría fallar el envío después de generar todo el PDF.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

const MAX_PDF_BYTES = 8 * 1024 * 1024;   // 8 MB: una factura pesa unos pocos KB

/**
 * Elige con qué servicio se manda el correo. Se usa el que REALMENTE tenga
 * credenciales cargadas, sin necesidad de configurar nada extra:
 *
 *   1. Brevo (contabilidadEmailService) si tiene usuario Y contraseña SMTP.
 *      Es el que usa contabilidad para los estados de cuenta.
 *   2. Si no —hoy es el caso: Brevo tiene host y puerto pero el usuario y la
 *      contraseña están vacíos— se usa Resend (emailService), que ya tiene su
 *      API key y el dominio user.com.uy verificado.
 *   3. Si no hay ninguno, queda Brevo, que entra en MODO SIMULADO: loguea el
 *      envío, no manda nada, y la respuesta lo dice explícitamente.
 *
 * Para forzar uno: CFE_EMAIL_PROVIDER=resend|brevo en el .env.
 */
function proveedorEmailConfigurado() {
    const forzado = String(process.env.CFE_EMAIL_PROVIDER || '').trim().toLowerCase();
    if (forzado === 'resend' || forzado === 'brevo') return forzado;

    if (process.env.BREVO_SMTP_USER && process.env.BREVO_SMTP_PASS) return 'brevo';
    if (process.env.RESEND_API_KEY) return 'resend';
    return 'brevo';
}

/**
 * Número OFICIAL del comprobante ante DGI, que es el que el cliente ve impreso en
 * el PDF y por el que va a preguntar. NO es el interno (DocSerie-DocNumero): la
 * factura interna FA-332 es, para DGI, la Serie A N° 27614.
 *
 * Solo devuelve algo si el documento fue ACEPTADO por DGI; mientras esté pendiente
 * todavía no tiene número oficial y hay que seguir usando el interno.
 *
 * Formato que graba SISNET (los 1365 aceptados de la base lo respetan):
 *     "Nro. de CAE 90262053670 Serie A 27503 / 29250"
 */
function numeroOficialDGI(doc) {
    if (!doc || doc.CfeEstado !== 'ACEPTADO_DGI') return null;
    const texto = String(doc.CfeNumeroOficial || '').trim();
    if (!texto) return null;

    const m = texto.match(/Nro\.\s*de\s*CAE\s*(\d+)\s*Serie\s*([A-Za-z]+)\s*(\d+)/i);
    if (m) return { cae: m[1], serie: m[2].toUpperCase(), numero: m[3] };

    // Formato simple "A-27503", por si alguna emisión vieja quedó grabada así.
    const s = texto.match(/(?:Serie\s+)?([A-Za-z]+)\s*-\s*(\d+)/i);
    if (s) return { cae: null, serie: s[1].toUpperCase(), numero: s[2] };

    return null;
}

function armarHtmlEmailDocumento({ doc, mensaje }) {
    const empresa  = (doc.EmpNombreFantasia || doc.EmpRazonSocial || 'User').trim();
    const color    = doc.EmpColorPrimario || '#0d47a1';
    const cliente  = (doc.DocCliNombre || doc.CliNombreFantasia || doc.CliRazonSocial || '').trim();
    const tipoDoc  = (doc.DocTipo || 'Documento').trim();
    // Si ya está en DGI, el número que va en el mail es el OFICIAL: es el que el
    // cliente tiene impreso en el PDF. El interno (FA-332) no le dice nada.
    const oficial  = numeroOficialDGI(doc);
    const numero   = oficial
        ? `Serie ${oficial.serie} N° ${oficial.numero}`
        : ([doc.DocSerie, doc.DocNumero].filter(Boolean).join('-') || `#${doc.DocIdDocumento}`);
    const simbolo  = doc.MonSimbolo || '$';
    const total    = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2 })
                        .format(Number(doc.DocTotal || 0));
    const fecha    = doc.DocFechaEmision
        ? new Date(doc.DocFechaEmision).toLocaleDateString('es-UY', { timeZone: 'America/Montevideo' })
        : '';
    const esc = (s) => String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.10);">
  <div style="background:${color};padding:18px 28px;">
    <div style="font-size:19px;font-weight:800;color:#fff;">${esc(empresa)}</div>
  </div>
  <div style="padding:26px 28px;">
    ${cliente ? `<p style="margin:0 0 14px;font-size:15px;color:#333;">Hola ${esc(cliente)},</p>` : ''}
    <p style="margin:0 0 18px;font-size:15px;color:#555;line-height:1.6;">
      ${mensaje ? esc(mensaje) : 'Te adjuntamos tu comprobante en PDF.'}
    </p>
    <table style="width:100%;border-collapse:collapse;background:#fafbfc;border-radius:8px;">
      <tr><td style="padding:10px 14px;font-size:13px;color:#888;">Comprobante</td>
          <td style="padding:10px 14px;font-size:13px;color:#222;font-weight:600;text-align:right;">${esc(tipoDoc)} ${esc(numero)}</td></tr>
      ${fecha ? `<tr><td style="padding:10px 14px;font-size:13px;color:#888;border-top:1px solid #eee;">Fecha</td>
          <td style="padding:10px 14px;font-size:13px;color:#222;text-align:right;border-top:1px solid #eee;">${esc(fecha)}</td></tr>` : ''}
      <tr><td style="padding:10px 14px;font-size:13px;color:#888;border-top:1px solid #eee;">Total</td>
          <td style="padding:10px 14px;font-size:15px;color:${color};font-weight:800;text-align:right;border-top:1px solid #eee;">${esc(simbolo)} ${total}</td></tr>
      ${oficial && oficial.cae ? `<tr><td style="padding:10px 14px;font-size:13px;color:#888;border-top:1px solid #eee;">Autorización DGI</td>
          <td style="padding:10px 14px;font-size:12px;color:#666;text-align:right;border-top:1px solid #eee;">CAE ${esc(oficial.cae)}</td></tr>` : ''}
    </table>
  </div>
  <div style="background:#f5f5f5;padding:14px 28px;border-top:1px solid #e0e0e0;">
    <div style="font-size:11px;color:#aaa;">Mensaje automático — no responder este correo.</div>
  </div>
</div>
</body></html>`;
}

/**
 * POST /contabilidad/cfe/documentos/:id/enviar-email
 * Body: { destinatario, pdfBase64, asunto?, mensaje? }
 *
 * El PDF lo genera el NAVEGADOR (src/utils/pdfGenerator.js → generarPdfFacturaDGI) y
 * lo manda en base64. Es a propósito: el backend no sabe dibujar la factura, y así el
 * cliente recibe exactamente el mismo PDF que el operador ve en pantalla, sin mantener
 * dos maquetaciones distintas.
 */
exports.enviarDocumentoPorEmail = async (req, res) => {
    const { id } = req.params;
    const { destinatario, pdfBase64, asunto, mensaje } = req.body || {};

    try {
        // ── Validaciones ──────────────────────────────────────────────────────
        const docId = parseInt(id, 10);
        if (!docId) return res.status(400).json({ error: 'Id de documento inválido.' });

        const mail = String(destinatario || '').trim();
        if (!mail)                return res.status(400).json({ error: 'Falta el destinatario.' });
        if (!EMAIL_RE.test(mail)) return res.status(400).json({ error: `"${mail}" no es una dirección de email válida.` });

        if (!pdfBase64) return res.status(400).json({ error: 'Falta el PDF a adjuntar.' });
        const base64 = String(pdfBase64).replace(/^data:application\/pdf;base64,/, '');
        let pdfBuffer;
        try {
            pdfBuffer = Buffer.from(base64, 'base64');
        } catch (e) {
            return res.status(400).json({ error: 'El PDF adjunto no es base64 válido.' });
        }
        if (!pdfBuffer.length)                return res.status(400).json({ error: 'El PDF adjunto llegó vacío.' });
        if (pdfBuffer.length > MAX_PDF_BYTES) return res.status(400).json({ error: `El PDF pesa ${(pdfBuffer.length / 1048576).toFixed(1)} MB y el máximo es 8 MB.` });
        if (pdfBuffer.slice(0, 4).toString('latin1') !== '%PDF')
            return res.status(400).json({ error: 'El archivo adjunto no es un PDF.' });

        // ── Datos del documento ───────────────────────────────────────────────
        const pool = await getPool();
        const r = await pool.request()
            .input('docId', sql.Int, docId)
            .query(`
                SELECT d.DocIdDocumento, d.DocTipo, d.DocSerie, d.DocNumero, d.DocTotal,
                       d.DocFechaEmision, d.CfeEstado, d.CfeNumeroOficial, d.DocCliNombre,
                       d.CliIdCliente,
                       c.Nombre AS CliRazonSocial, c.NombreFantasia AS CliNombreFantasia,
                       m.MonSimbolo,
                       e.EmpRazonSocial, e.EmpNombreFantasia, e.EmpColorPrimario
                FROM dbo.DocumentosContables d
                LEFT JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
                LEFT JOIN dbo.Monedas  m ON m.MonIdMoneda  = d.MonIdMoneda
                LEFT JOIN dbo.Empresas e ON e.EmpIdEmpresa = ISNULL(d.EmpIdEmpresa,
                            (SELECT TOP 1 EmpIdEmpresa FROM dbo.Empresas WHERE EmpPorDefecto = 1))
                WHERE d.DocIdDocumento = @docId`);

        const doc = r.recordset[0];
        if (!doc) return res.status(404).json({ error: `No existe el documento ${docId}.` });

        const tipoDoc = String(doc.DocTipo || 'Documento').trim();

        // El asunto y el nombre del adjunto llevan el número OFICIAL de DGI cuando el
        // documento ya fue aceptado: es el dato con el que el cliente identifica su
        // factura. Mientras esté pendiente se usa el interno, que es lo único que hay.
        const oficial   = numeroOficialDGI(doc);
        const numeroDoc = oficial
            ? `Serie ${oficial.serie} N° ${oficial.numero}`
            : ([doc.DocSerie, doc.DocNumero].filter(Boolean).join('-') || `#${docId}`);

        const asuntoFinal = String(asunto || '').trim() || `${tipoDoc} ${numeroDoc}`;
        const nombreArchivo = `${tipoDoc} ${oficial ? `${oficial.serie}-${oficial.numero}` : numeroDoc}.pdf`
            .replace(/[^\w\s.-]/g, '')
            .replace(/\s+/g, '_');

        // ── Envío ─────────────────────────────────────────────────────────────
        const proveedor = proveedorEmailConfigurado();
        const html = armarHtmlEmailDocumento({ doc, mensaje });
        const adjunto = { filename: nombreArchivo, content: pdfBuffer, contentType: 'application/pdf' };

        let estado = 'ENVIADO';
        let errorMsg = null;
        let simulado = false;

        try {
            if (proveedor === 'resend') {
                const ok = await require('../services/emailService').sendMail(mail, asuntoFinal, html, [adjunto]);
                if (!ok) throw new Error('Resend rechazó el envío (ver logs del servidor).');
            } else {
                const out = await require('../services/contabilidadEmailService')
                    .enviarEmail({ to: mail, subject: asuntoFinal, html, attachments: [adjunto] });
                simulado = !!(out && out.simulado);
                if (simulado) estado = 'SIMULADO';
            }
        } catch (err) {
            estado = 'ERROR';
            errorMsg = err.message;
        }

        // ── Registro en el historial compartido de envíos ─────────────────────
        // No tira excepción ni aunque falte la tabla: el mail ya salió.
        await envioEmailLog.registrarEnvio({
            modulo:       envioEmailLog.MODULOS.CFE,
            refId:        docId,
            refTexto:     `${tipoDoc} ${numeroDoc}`,
            cliIdCliente: doc.CliIdCliente || null,
            destinatario: mail,
            asunto:       asuntoFinal,
            adjunto:      nombreArchivo,
            estado,
            proveedor,
            error:        errorMsg,
            usuarioId:    req.user?.id || null,
        });

        if (estado === 'ERROR') {
            logger.error(`[CFE-EMAIL] Doc ${docId} -> ${mail}: ${errorMsg}`);
            return res.status(502).json({ error: `No se pudo enviar el email: ${errorMsg}` });
        }

        logger.info(`[CFE-EMAIL] Doc ${docId} (${tipoDoc} ${numeroDoc}) -> ${mail} [${estado}]`);
        return res.json({
            success: true,
            estado,                       // ENVIADO | SIMULADO
            simulado,
            destinatario: mail,
            asunto: asuntoFinal,
            proveedor,
            numeroDgi: oficial ? `Serie ${oficial.serie} N° ${oficial.numero}` : null,
            // El front avisa antes de mandar algo que todavía no es un comprobante firme.
            advertencia: doc.CfeEstado === 'ACEPTADO_DGI' ? null
                : `Este documento está en estado ${doc.CfeEstado || 'sin estado'}: todavía no fue aceptado por DGI.`,
            mensaje: simulado
                ? 'Envío SIMULADO: no hay credenciales SMTP cargadas, así que el mail no salió.'
                : `Enviado a ${mail}.`
        });

    } catch (err) {
        logger.error('Error en enviarDocumentoPorEmail:', err);
        return res.status(500).json({ error: err.message });
    }
};
