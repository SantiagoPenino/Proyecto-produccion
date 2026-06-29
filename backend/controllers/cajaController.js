'use strict';

const cajaService = require('../services/cajaService');
const logger      = require('../utils/logger');
const contabilidadSvc = require('../services/contabilidadService');
const contabilidadCore = require('../services/contabilidadCore'); // ERP Core
const { getPool, sql } = require('../config/db');
const pdfService  = require('../services/pdfService');

// ─────────────────────────────────────────────
const io = (req) => req.app.get('socketio');

// ─────────────────────────────────────────────

const procesarTransaccion = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  try {
    const { header, aplicaciones, pagos } = req.body;
    if (!header || !aplicaciones?.length)
      return res.status(400).json({ success:false, error:'Faltan header o aplicaciones.' });

    const pool = await getPool();

    // Validar tipo de documento
    let esCredito = false;
    if (header.tipoDocumento && header.tipoDocumento !== 'NINGUNO') {
      const rTipo = await pool.request()
        .input('d', sql.VarChar(10), header.tipoDocumento)
        .query('SELECT AfectaCtaCte FROM Config_TiposDocumento WHERE CodDocumento = @d');
      if (!rTipo.recordset.length)
        return res.status(400).json({ success:false, error:'tipoDocumento inválido.' });
      esCredito = rTipo.recordset[0].AfectaCtaCte === true;
    }

    // ─────────────────────────────────────────────
    // Crédito explícito: el frontend envía esCredito:true cuando el usuario eligió modo Crédito en PEDIDO CAJA
    if (!esCredito && !header.esCredito && (!pagos || pagos.length === 0))
      return res.status(400).json({ success:false, error:'Debe incluir al menos un método de pago para documentos de contado.' });

    const resultado = await cajaService.procesarTransaccion({ header, aplicaciones, pagos: pagos || [], usuarioId });
    const s = io(req); if (s) { s.emit('actualizado',{type:'actualizacion'}); s.emit('retiros:update',{type:'pago'}); }
    return res.status(201).json(resultado);
  } catch (err) {
    logger.error('[CAJA] procesarTransaccion:', err.message);
    return res.status(500).json({ success:false, error:err.message });
  }
};

const procesarVentaDirecta = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  try {
    const data = req.body; // { header, items, pagos }
    if (!data.header || !data.items?.length)
      return res.status(400).json({ success:false, error:'Faltan datos de la venta.' });

    const esCredito = ['02', '08', 'FACT_CREDITO'].includes(data.header.tipoDocumento) || !!data.header.esCredito;
    if (!esCredito && (!data.pagos || data.pagos.length === 0)) {
      return res.status(400).json({ success:false, error:'Debe incluir al menos un metodo de pago valido para ventas al contado.' });
    }

    const resultado = await cajaService.procesarVentaDirecta({ ...data, usuarioId });
    const s = io(req); if (s) { s.emit('actualizado',{type:'actualizacion'}); s.emit('retiros:update',{type:'venta'}); }
    return res.status(201).json(resultado);
  } catch (err) {
    logger.error('[CAJA] procesarVentaDirecta:', err.message);
    logger.error('[CAJA] procesarVentaDirecta STACK:', err.stack);
    return res.status(500).json({ success:false, error:err.message });
  }
};

const getProductosVenta = async (req, res) => {
  try {
    const data = await cajaService.getProductosVenta();
    return res.json({ success:true, data });
  } catch (err) {
    logger.error('[CAJA] getProductosVenta:', err.message);
    return res.status(500).json({ success:false, error:err.message });
  }
};

const anularTransaccion = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success:false, error:'ID inválido.' });
  try {
    const r = await cajaService.anularTransaccion({ tcaIdTransaccion:id, usuarioId, motivo:req.body.motivo });
    const s = io(req); if (s) s.emit('retiros:update',{type:'anulacion'});
    return res.json(r);
  } catch (err) {
    logger.error('[CAJA] anularTransaccion:', err.message);
    return res.status(500).json({ success:false, error:err.message });
  }
};

const getTransaccion = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success:false, error:'ID inválido.' });
  try {
    const data = await cajaService.getTransaccion(id);
    if (!data) return res.status(404).json({ success:false, error:'Transacción no encontrada.' });
    return res.json({ success:true, data });
  } catch (err) { return res.status(500).json({ success:false, error:err.message }); }
};

const getHistorialCliente = async (req, res) => {
  const clienteId = parseInt(req.params.clienteId, 10);
  if (isNaN(clienteId)) return res.status(400).json({ success:false, error:'clienteId inválido.' });
  const { desde, hasta, limit } = req.query;
  try {
    const data = await cajaService.getTransaccionesByCliente({ clienteId, desde:desde||null, hasta:hasta||null, limit:parseInt(limit||50) });
    return res.json({ success:true, total:data.length, data });
  } catch (err) { return res.status(500).json({ success:false, error:err.message }); }
};

// ─────────────────────────────────────────────

/** GET /api/contabilidad/caja/sesion/actual ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â sesión activa de hoy */
const getSesionActual = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 1
        StuIdSesion, StuFechaApertura, StuUsuarioAbre, StuMontoInicial, StuEstado,
        DATEDIFF(MINUTE, StuFechaApertura, GETDATE()) AS MinutosAbierta
      FROM dbo.SesionesTurno WITH(NOLOCK)
      WHERE StuEstado = 'ABIERTA'
      ORDER BY StuFechaApertura DESC
    `);
    if (result.recordset.length === 0)
      return res.json({ success:true, sesion:null, mensaje:'No hay caja abierta hoy.' });
    return res.json({ success:true, sesion:result.recordset[0] });
  } catch (err) {
    logger.error('[CAJA] getSesionActual:', err.message);
    return res.status(500).json({ success:false, error:err.message });
  }
};

/** POST /api/contabilidad/caja/sesion/abrir */
const abrirSesion = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  const { montoInicial = 0 } = req.body;
  try {
    const pool = await getPool();

    // ─────────────────────────────────────────────
    const chk = await pool.request().query(`
      SELECT 1 FROM dbo.SesionesTurno WITH(NOLOCK)
      WHERE StuEstado = 'ABIERTA'
    `);
    if (chk.recordset.length > 0) {
      return res.status(409).json({ success: false, error: 'Ya existe una sesión de caja ABIERTA en el sistema. Ciérrela antes de abrir una nueva.' });
    }

    const result = await pool.request()
      .input('UsuarioId',       sql.Int,           usuarioId)
      .input('MontoInicial',    sql.Decimal(18,2), parseFloat(montoInicial) || 0)
      .input('MontoInicialUSD', sql.Decimal(18,2), parseFloat(req.body.montoInicialUSD) || 0)
      .query(`
        INSERT INTO dbo.SesionesTurno (StuFechaApertura, StuUsuarioAbre, StuMontoInicial, StuMontoInicialUSD, StuEstado)
        VALUES (GETDATE(), @UsuarioId, @MontoInicial, @MontoInicialUSD, 'ABIERTA');
        SELECT SCOPE_IDENTITY() AS StuIdSesion, GETDATE() AS FechaApertura;
      `);

    logger.info(`[CAJA] 💰 Caja abierta por usuario ${usuarioId}. Sesión: ${result.recordset[0]?.StuIdSesion}`);
    return res.status(201).json({ success:true, sesion:result.recordset[0] });
  } catch (err) {
    logger.error('[CAJA] abrirSesion:', err.message);
    const status = err.message.includes('ya existe') ? 409 : 500;
    return res.status(status).json({ success:false, error:err.message });
  }
};

/** POST /api/contabilidad/caja/sesion/:id/cerrar */
const cerrarSesion = async (req, res) => {
  const usuarioId  = req.user?.id || 70;
  const id         = parseInt(req.params.id, 10);
  const { montoFinal, montoFinalUSD = 0, observaciones } = req.body;
  if (isNaN(id))      return res.status(400).json({ success:false, error:'ID de sesión inválido.' });
  if (!montoFinal && montoFinal !== 0) return res.status(400).json({ success:false, error:'montoFinal es requerido.' });
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('StuIdSesion',   sql.Int,           id)
      .input('UsuarioId',     sql.Int,           usuarioId)
      .input('MontoFinal',    sql.Decimal(18,2), parseFloat(montoFinal))
      .input('MontoFinalUSD', sql.Decimal(18,2), parseFloat(montoFinalUSD))
      .input('Observaciones', sql.NVarChar(500), observaciones || null)
      .execute('SP_CerrarSesionCaja');
    logger.info(`[CAJA] ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â´ Caja cerrada. Sesión: ${id}. Diferencia: ${result.recordset[0]?.Diferencia}`);
    return res.json({ success:true, resumen:result.recordset[0] });
  } catch (err) {
    logger.error('[CAJA] cerrarSesion:', err.message);
    return res.status(500).json({ success:false, error:err.message });
  }
};

/** GET /api/contabilidad/caja/sesion/:id/resumen ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â totales de una sesión */
const getResumenSesion = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success:false, error:'ID inválido.' });
  try {
    const pool = await getPool();
    const [sesRes, cobRes, egrRes] = await Promise.all([
      pool.request().input('Id',sql.Int,id).query(`SELECT * FROM dbo.SesionesTurno WITH(NOLOCK) WHERE StuIdSesion=@Id`),
      pool.request().input('Id',sql.Int,id).query(`
        SELECT COUNT(*) AS CantCobros, ISNULL(SUM(TcaTotalCobrado),0) AS TotalCobrado,
               ISNULL(SUM(TcaTotalAjuste),0) AS TotalAjuste
        FROM dbo.TransaccionesCaja WITH(NOLOCK) WHERE StuIdSesion=@Id AND TcaEstado IN ('COMPLETADO', 'COMPLETADA', 'COBRADO')`),
      pool.request().input('Id',sql.Int,id).query(`
        SELECT COUNT(*) AS CantEgresos, ISNULL(SUM(EgrMontoConvertido),0) AS TotalEgresos
        FROM dbo.EgresosCaja WITH(NOLOCK) WHERE StuIdSesion=@Id AND EgrEstado='REGISTRADO'`),
    ]);
    if (!sesRes.recordset.length) return res.status(404).json({ success:false, error:'Sesión no encontrada.' });
    return res.json({
      success: true,
      sesion:  sesRes.recordset[0],
      cobros:  cobRes.recordset[0],
      egresos: egrRes.recordset[0],
    });
  } catch (err) { return res.status(500).json({ success:false, error:err.message }); }
};

/** GET /api/contabilidad/caja/resumen-diario ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â totales del día actual para administrador */
const getResumenDiario = async (req, res) => {
  try {
    const pool = await getPool();
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    
    const [cobRes, egrRes] = await Promise.all([
      pool.request().input('Fec',sql.DateTime,hoy).query(`
        SELECT COUNT(*) AS CantCobros, ISNULL(SUM(TcaTotalCobrado),0) AS TotalCobrado,
               ISNULL(SUM(TcaTotalAjuste),0) AS TotalAjuste
        FROM dbo.TransaccionesCaja WITH(NOLOCK) WHERE StuIdSesion IS NULL AND TcaFecha >= @Fec AND TcaEstado IN ('COMPLETADO', 'COMPLETADA', 'COBRADO')`),
      pool.request().input('Fec',sql.DateTime,hoy).query(`
        SELECT COUNT(*) AS CantEgresos, ISNULL(SUM(EgrMontoConvertido),0) AS TotalEgresos
        FROM dbo.EgresosCaja WITH(NOLOCK) WHERE StuIdSesion IS NULL AND EgrFecha >= @Fec AND EgrEstado='REGISTRADO'`),
    ]);
    return res.json({
      success: true,
      sesion:  { StuMontoInicial: 0 },
      cobros:  cobRes.recordset[0],
      egresos: egrRes.recordset[0],
    });
  } catch (err) { return res.status(500).json({ success:false, error:err.message }); }
};

// ─────────────────────────────────────────────
const getMovimientosTurno = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  const isAdmin = req.query.admin === 'true';
  try {
    const pool = await getPool();
    
    let sid = null;
    let fecAbierta = new Date();
    
    if (!isAdmin) {
      // ─────────────────────────────────────────────
      const sR = await pool.request().query(`SELECT StuIdSesion, StuFechaApertura FROM dbo.SesionesTurno WITH(NOLOCK) WHERE StuEstado = 'ABIERTA' ORDER BY StuFechaApertura DESC`);
      if(!sR.recordset.length) return res.json({ success:true, movimientos:[], totales:{} });
      sid = sR.recordset[0].StuIdSesion;
      fecAbierta = sR.recordset[0].StuFechaApertura;
    } else {
      if (req.query.desde) {
        const [y,m,d] = req.query.desde.split('T')[0].split('-');
        fecAbierta = new Date(y, m-1, d);
      } else {
        fecAbierta.setHours(0,0,0,0);
      }
    }

    let fecHasta = new Date();
    fecHasta.setHours(23,59,59,999);
    if (isAdmin && req.query.hasta) {
       const [y,m,d] = req.query.hasta.split('T')[0].split('-');
       fecHasta = new Date(y, m-1, d);
       fecHasta.setHours(23,59,59,999);
    }

    const movimientos = await pool.request()
      .input('Sid', sql.Int, sid)
      .input('FecA', sql.DateTime, fecAbierta)
      .input('FecH', sql.DateTime, fecHasta)
      .input('IsAdmin', sql.Bit, isAdmin ? 1 : 0)
      .query(`
      SELECT 
        'INGRESO' as TipoOperacion,
        t.TcaFecha as Fecha,
        ISNULL(ct1.Detalle, t.TcaTipoDocumento) as TipoComprobante,
        ISNULL(t.TcaSerieDoc,'') + '-' + ISNULL(t.TcaNumeroDoc,'Pendiente') as Comprobante,
        ISNULL(NULLIF(t.TcaObservaciones, ''), 'Cobro Mostrador') + 
        CASE WHEN c.Nombre IS NOT NULL THEN ' (' + RTRIM(c.Nombre) + ')' ELSE '' END +
        COALESCE(' [' + (
          SELECT STRING_AGG(RTRIM(td.TdeCodigoReferencia), ', ') 
          FROM dbo.TransaccionDetalle td WITH(NOLOCK) 
          WHERE td.TcaIdTransaccion = t.TcaIdTransaccion AND td.TdeCodigoReferencia IS NOT NULL AND td.TdeCodigoReferencia <> ''
        ) + ']', '') as Concepto,
        mp.MPaDescripcionMetodo as MedioDePago,
        CASE WHEN p.PagIdMonedaPago = 2 THEN 'USD' ELSE 'UYU' END as Moneda,
        p.PagMontoPago as Entrada,
        0 as Salida,
        COALESCE(u.Nombre, u.Usuario, 'Sistema') as Usuario
      FROM dbo.TransaccionesCaja t WITH(NOLOCK)
      JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
      LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
      LEFT JOIN dbo.Config_TiposDocumento ct1 WITH(NOLOCK) ON ct1.CodDocumento = t.TcaTipoDocumento
      LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = t.TcaClienteId
      LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = t.TcaUsuarioId
      WHERE (
         (@IsAdmin = 0 AND t.StuIdSesion = @Sid AND t.EsCajaAdmin = 0) OR
         (@IsAdmin = 1 AND t.EsCajaAdmin = 1 AND t.TcaFecha >= @FecA AND t.TcaFecha <= @FecH)
      ) AND t.TcaEstado IN ('COMPLETADO', 'COMPLETADA', 'COBRADO') AND p.PagTipoMovimiento != 'ANULADO'
      UNION ALL
      SELECT 
        'EGRESO' as TipoOperacion,
        e.EgrFecha as Fecha,
        ISNULL(ct2.Detalle, e.EgrTipoDocumento) as TipoComprobante,
        ISNULL(e.EgrSerieDoc,'') + '-' + ISNULL(e.EgrNumeroDoc,'Pendiente') as Comprobante,
        e.EgrConcepto + CASE WHEN e.EgrProveedor IS NOT NULL AND e.EgrProveedor != '' THEN ' (' + e.EgrProveedor + ')' ELSE '' END as Concepto,
        mp.MPaDescripcionMetodo as MedioDePago,
        e.EgrMoneda as Moneda,
        0 as Entrada,
        e.EgrMonto as Salida,
        COALESCE(u.Nombre, u.Usuario, 'Sistema') as Usuario
      FROM dbo.EgresosCaja e WITH(NOLOCK)
      LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = e.MPaIdMetodoPago
      LEFT JOIN dbo.Config_TiposDocumento ct2 WITH(NOLOCK) ON ct2.CodDocumento = e.EgrTipoDocumento
      LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = e.EgrUsuarioId
      WHERE (
         (@IsAdmin = 0 AND e.StuIdSesion = @Sid AND e.EsCajaAdmin = 0) OR
         (@IsAdmin = 1 AND e.EsCajaAdmin = 1 AND e.EgrFecha >= @FecA AND e.EgrFecha <= @FecH)
      ) AND e.EgrEstado = 'REGISTRADO'
      ORDER BY Fecha ASC
    `);

    return res.json({ success:true, movimientos: movimientos.recordset });
  } catch (err) {
    return res.status(500).json({ success:false, error:err.message });
  }
};

// ─────────────────────────────────────────────

/** GET /api/contabilidad/caja/siguiente-numero?tipoDoc=ETICKET&serie=A */
const getSiguienteNumero = async (req, res) => {
  const { tipoDoc } = req.query;
  if (!tipoDoc) return res.status(400).json({ success:false, error:'tipoDoc es requerido.' });
  try {
    const pool = await getPool();
    // ─────────────────────────────────────────────
    const result = await pool.request()
      .input('TipoDoc', sql.VarChar(20), tipoDoc)
      .query(`
        IF EXISTS (SELECT 1 FROM Config_TiposDocumento WHERE CodDocumento = @TipoDoc)
        BEGIN
          SELECT
            s.SecUltimoNumero + 1  AS NumeroEntero,
            ISNULL(s.SecPrefijo,'') +
              RIGHT(REPLICATE('0', s.SecDigitos) + CAST(s.SecUltimoNumero+1 AS VARCHAR(10)), s.SecDigitos)
                                 AS NumeroFormato,
            s.SecTipoDoc AS TipoDoc,
            s.SecSerie   AS Serie,
            ISNULL(s.SecPrefijo,'') AS Prefijo
          FROM Config_TiposDocumento c WITH(NOLOCK)
          JOIN dbo.SecuenciaDocumentos s WITH(NOLOCK) ON c.SecIdSecuencia = s.SecIdSecuencia
          WHERE c.CodDocumento = @TipoDoc AND s.SecActivo = 1
        END
        ELSE
        BEGIN
          SELECT
            s.SecUltimoNumero + 1  AS NumeroEntero,
            ISNULL(s.SecPrefijo,'') +
              RIGHT(REPLICATE('0', s.SecDigitos) + CAST(s.SecUltimoNumero+1 AS VARCHAR(10)), s.SecDigitos)
                                 AS NumeroFormato,
            s.SecTipoDoc AS TipoDoc,
            s.SecSerie   AS Serie,
            ISNULL(s.SecPrefijo,'') AS Prefijo
          FROM dbo.SecuenciaDocumentos s WITH(NOLOCK)
          WHERE s.SecTipoDoc = @TipoDoc AND s.SecActivo = 1
        END
      `);
    if (!result.recordset.length)
      return res.status(404).json({ success:false, error:`No hay secuencia para el tipo de documento ${tipoDoc}.` });
    return res.json({ success:true, ...result.recordset[0] });
  } catch (err) { return res.status(500).json({ success:false, error:err.message }); }
};

/** GET /api/contabilidad/caja/secuencias ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â todas las series activas */
const getSecuencias = async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT SecIdSecuencia, SecTipoDoc, SecSerie, ISNULL(SecPrefijo,'') AS SecPrefijo,
             SecDigitos, SecUltimoNumero, SecActivo
      FROM dbo.SecuenciaDocumentos WITH(NOLOCK)
      ORDER BY SecTipoDoc, SecSerie
    `);
    return res.json({ success:true, data:r.recordset });
  } catch (err) { return res.status(500).json({ success:false, error:err.message }); }
};

// ─────────────────────────────────────────────
/** GET /api/contabilidad/caja/tipos-egreso */
const getTiposEgreso = async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT CegTipoEgreso AS tipo, CegNombreTipo AS nombre, 
             CegCueCodigo AS cueCodigo, CegCueNombre AS cueNombre,
             CegEmoji AS emoji, CegOrden AS orden
      FROM Config_CuentasEgreso 
      WHERE CegActivo = 1 
      ORDER BY CegOrden
    `);
    return res.json({ success: true, data: r.recordset });
  } catch (err) {
    logger.error('[CAJA] getTiposEgreso:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────

/** POST /api/contabilidad/caja/egreso */
const registrarEgreso = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  // ─────────────────────────────────────────────
  let { stuIdSesion, tipoEgreso, concepto, proveedor, monto, moneda='UYU', monedaId=1,
          cotizacion, metodoPagoId, tipoDocumento, serieDoc, numeroDoc, observaciones,
          // fallback para compatibilidad con llamadas antiguas
          cuentaGastoCodigo: cuentaManual, admin } = req.body;

  if (!monto) return res.status(400).json({ success:false, error:'monto es obligatorio.' });
  if (!tipoEgreso && !cuentaManual)
    return res.status(400).json({ success:false, error:'tipoEgreso es obligatorio.' });

  const montoNum  = parseFloat(monto);
  const cotNum    = parseFloat(cotizacion) || null;
  const convertido = (moneda === 'USD' && cotNum) ? montoNum * cotNum : montoNum;

  const pool = await getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    if (admin) stuIdSesion = null;

    // ─────────────────────────────────────────────
    let cuentaGastoCodigo = cuentaManual || null;
    let cuentaGastoNombre = concepto || 'Gasto';
    
    if (tipoEgreso) {
      const cfgR = await new sql.Request(transaction)
        .input('Tipo', sql.VarChar(30), tipoEgreso)
        .query('SELECT CegCueCodigo, CegCueNombre, CegNombreTipo FROM Config_CuentasEgreso WHERE CegTipoEgreso = @Tipo AND CegActivo = 1');
      
      if (!cfgR.recordset.length)
        throw new Error(`Tipo de egreso '${tipoEgreso}' no configurado en el sistema.`);
      
      cuentaGastoCodigo = cfgR.recordset[0].CegCueCodigo;
      cuentaGastoNombre = cfgR.recordset[0].CegNombreTipo;
      logger.info(`[EGRESO] TipoEgreso='${tipoEgreso}' resuelto a cuenta [${cuentaGastoCodigo}] ${cuentaGastoNombre}`);
    }

    let numeroDocFinal = numeroDoc || null;
    if (tipoDocumento && tipoDocumento !== 'NINGUNO' && !numeroDoc) {
      try {
        const seqR = await new sql.Request(transaction)
          .input('CodDoc', sql.VarChar(10), tipoDocumento)
          .input('Serie',  sql.VarChar(5),  serieDoc || 'A')
          .query(`
            DECLARE @SecId INT;
            SELECT @SecId = s.SecIdSecuencia
            FROM Config_TiposDocumento c
            JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
            WHERE c.CodDocumento = @CodDoc AND s.SecSerie = @Serie AND s.SecActivo = 1;

            IF @SecId IS NOT NULL
            BEGIN
              UPDATE SecuenciaDocumentos
              SET SecUltimoNumero = SecUltimoNumero + 1
              OUTPUT 
                RIGHT(REPLICATE('0', INSERTED.SecDigitos) + CAST(INSERTED.SecUltimoNumero AS VARCHAR(10)), INSERTED.SecDigitos) AS NumeroFormato
              WHERE SecIdSecuencia = @SecId;
            END
          `);
        if (seqR.recordset && seqR.recordset.length) {
            numeroDocFinal = seqR.recordset[0].NumeroFormato;
        }
      } catch (errSeq) { logger.error('Error seq egreso:', errSeq.message); }
    }

    const result = await new sql.Request(transaction)
      .input('StuIdSesion',      sql.Int,           stuIdSesion   || null)
      .input('EgrUsuarioId',     sql.Int,           usuarioId)
      .input('EgrConcepto',      sql.NVarChar(200),  concepto || cuentaGastoNombre)
      .input('EgrProveedor',     sql.NVarChar(150),  proveedor     || null)
      .input('EgrMonto',         sql.Decimal(18,4),  montoNum)
      .input('EgrMoneda',        sql.VarChar(10),    moneda)
      .input('EgrCotizacion',    sql.Decimal(18,4),  cotNum)
      .input('EgrConvertido',    sql.Decimal(18,4),  convertido)
      .input('MPaIdMetodoPago',  sql.Int,            metodoPagoId  || null)
      .input('EgrTipoDoc',       sql.VarChar(20),    tipoDocumento || null)
      .input('EgrSerieDoc',      sql.VarChar(5),     serieDoc      || null)
      .input('EgrNumeroDoc',     sql.VarChar(20),    numeroDocFinal)
      .input('EgrTipoEgreso',    sql.VarChar(30),    tipoEgreso    || null)
      .input('EgrObservaciones', sql.NVarChar(300),  observaciones || null)
      .input('EsAdmin',          sql.Bit,            admin ? 1 : 0)
      .query(`
        INSERT INTO dbo.EgresosCaja
          (StuIdSesion, EgrFecha, EgrUsuarioId, EgrConcepto, EgrProveedor,
           EgrMonto, EgrMoneda, EgrCotizacion, EgrMontoConvertido,
           MPaIdMetodoPago, EgrTipoDocumento, EgrSerieDoc, EgrNumeroDoc,
           EgrTipoEgreso, EgrEstado, EgrObservaciones, EsCajaAdmin)
        OUTPUT INSERTED.EgrIdEgreso
        VALUES
          (@StuIdSesion, GETDATE(), @EgrUsuarioId, @EgrConcepto, @EgrProveedor,
           @EgrMonto, @EgrMoneda, @EgrCotizacion, @EgrConvertido,
           @MPaIdMetodoPago, @EgrTipoDoc, @EgrSerieDoc, @EgrNumeroDoc,
           @EgrTipoEgreso, 'REGISTRADO', @EgrObservaciones, @EsAdmin)
      `);
    
    const idEgreso = result.recordset[0].EgrIdEgreso;

    // ─────────────────────────────────────────────
    const lineasContables = [];
    lineasContables.push({
      codigoCuenta: cuentaGastoCodigo,
      debeBase: montoNum, haberBase: 0,
      monedaId: moneda === 'USD' ? 2 : 1, cotizacion: cotNum || 1,
      entidadId: null, entidadTipo: 'PROVEEDOR'
    });
    lineasContables.push({
      codigoCuenta: moneda === 'USD' ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU,
      debeBase: 0, haberBase: montoNum,
      monedaId: moneda === 'USD' ? 2 : 1, cotizacion: cotNum || 1
    });

    const asientoResult = await contabilidadCore.generarAsientoCompleto({
      concepto: `${cuentaGastoNombre}: ${proveedor || concepto || 'Egreso'}`,
      usuarioId, tcaIdTransaccion: idEgreso, origen: 'CAJA_EGRESOS',
      lineas: lineasContables
    }, transaction);
    const asiId = asientoResult?.asiId || null;

    // ─────────────────────────────────────────────
    // ─────────────────────────────────────────────
    const vcSeq = await new sql.Request(transaction).query(`
      UPDATE SecuenciaDocumentos
      SET SecUltimoNumero = SecUltimoNumero + 1
      OUTPUT ISNULL(INSERTED.SecPrefijo,'') +
             RIGHT(REPLICATE('0', INSERTED.SecDigitos) + CAST(INSERTED.SecUltimoNumero AS VARCHAR(10)), INSERTED.SecDigitos)
             AS VoucherNumero
      WHERE SecTipoDoc = 'VOUCHER_CAJA' AND SecSerie = 'A' AND SecActivo = 1
    `);
    const voucherNumero = vcSeq.recordset[0]?.VoucherNumero || `VC-${idEgreso}`;

    // Buscar CueIdCuenta de la cuenta Caja para el DocumentosContables
    const cajaCtaR = await new sql.Request(transaction)
      .input('CodCta', sql.VarChar(20), moneda === 'USD' ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU)
      .query('SELECT CueId FROM Cont_PlanCuentas WHERE CueCodigo = @CodCta');
    const cajaCueId = cajaCtaR.recordset[0]?.CueId || 1;

    // ─────────────────────────────────────────────
    const cliR = await new sql.Request(transaction).query(`
      SELECT TOP 1 CliIdCliente 
      FROM Clientes 
      WHERE Nombre LIKE '%Consumidor%' OR Nombre LIKE '%Final%' OR Nombre LIKE '%Gen%rico%' OR CliIdCliente = 0
      ORDER BY CliIdCliente ASC
    `);
    let cliIdGenerico = cliR.recordset.length ? cliR.recordset[0].CliIdCliente : 1; // ─────────────────────────────────────────────

    // Documento contable de salida de caja (EGRESO_CAJA)
    const docId = await contabilidadCore.crearDocumentoContable({
      header: {
        cueIdCuenta:      cajaCueId,
        clienteId:        cliIdGenerico,
        monedaId:         moneda === 'USD' ? 2 : 1,
        tipo:             'EGRESO_CAJA',
        numero:           voucherNumero,
        serie:            'EG',
        subtotal:         montoNum,
        impuestos:        0,
        total:            convertido,
        estado:           'PAGADO',
        cfeEstado:        null,
        usuarioId:        usuarioId,
        tcaIdTransaccion: idEgreso,
        asiIdAsiento:     asiId,
        observaciones:    (cuentaGastoNombre + ' | ' + (proveedor || '') + ' | ' + (observaciones || '')).substring(0, 200),
        docPagado:        true
      },
      lineas: [{
        nomItem:        ('Egreso: ' + cuentaGastoNombre).substring(0, 200),
        dscItem:        ((proveedor || '') + ' - ' + (observaciones || '')).trim().substring(0, 500),
        cantidad:       1,
        precioUnitario: montoNum,
        subtotal:       montoNum,
        impuestos:      0,
        total:          montoNum
      }]
    }, transaction);

    // Vincular DocIdDocumento de vuelta en EgresosCaja
    await new sql.Request(transaction)
      .input('EgrId', sql.Int, idEgreso)
      .input('DocId', sql.Int, docId)
      .query('UPDATE dbo.EgresosCaja SET DocIdDocumento = @DocId WHERE EgrIdEgreso = @EgrId');

    await transaction.commit();

    logger.info(`[CAJA-ERP] Egreso ID=${idEgreso} | Voucher=${voucherNumero} | Doc=${docId} | Monto=${montoNum} ${moneda}`);

    // ─── Generar y guardar PDF del voucher de egreso automáticamente ─────────
    try {
      const pool2 = await getPool();
      const vr = await pool2.request()
        .input('Id', sql.Int, idEgreso)
        .query(`
          SELECT e.EgrIdEgreso, e.EgrFecha, e.EgrConcepto, e.EgrProveedor,
                 e.EgrMonto, e.EgrMoneda, e.EgrCotizacion, e.EgrMontoConvertido,
                 e.EgrObservaciones,
                 dc.DocNumero AS VoucherNumero, dc.DocSerie AS VoucherSerie,
                 dc.AsiIdAsiento,
                 mp.MPaDescripcionMetodo AS MetodoPago,
                 u.NombreCompleto AS UsuarioNombre,
                 cfg.CegNombreTipo AS TipoEgresoLabel,
                 cfg.CegCueCodigo AS CuentaCodigo,
                 cfg.CegCueNombre AS CuentaNombre,
                 emp.RazSocial AS EmpresaNombre, emp.RUC AS EmpresaRuc
          FROM dbo.EgresosCaja e WITH(NOLOCK)
          LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = e.DocIdDocumento
          LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = e.MPaIdMetodoPago
          LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = e.EgrUsuarioId
          LEFT JOIN dbo.Config_CuentasEgreso cfg WITH(NOLOCK) ON cfg.CegTipoEgreso = e.EgrTipoEgreso
          OUTER APPLY (SELECT TOP 1 RazSocial, RUC FROM dbo.ConfiguracionGlobal) emp
          WHERE e.EgrIdEgreso = @Id
        `);
      if (vr.recordset.length) {
        const filePath = await pdfService.generarPdfEgreso(vr.recordset[0]);
        logger.info(`[CAJA-PDF] Egreso PDF guardado: ${filePath}`);
      }
    } catch (errPdf) {
      // No crítico: el egreso ya fue registrado correctamente
      logger.warn(`[CAJA-PDF] No se pudo generar PDF del egreso: ${errPdf.message}`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    return res.status(201).json({
      success:       true,
      egrIdEgreso:   idEgreso,
      voucherNumero,
      docId,
      numeroDoc:     numeroDocFinal
    });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    logger.error('[CAJA-ERP] registrarEgreso Error:', err.message);
    return res.status(500).json({ success:false, error:err.message });
  }
};

// ─────────────────────────────────────────────
/** GET /api/contabilidad/caja/egreso/:id/voucher */
const getVoucherEgreso = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido.' });
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('Id', sql.Int, id)
      .query(`
        SELECT
          e.EgrIdEgreso,
          e.EgrFecha,
          e.EgrConcepto,
          e.EgrProveedor,
          e.EgrMonto,
          e.EgrMoneda,
          e.EgrCotizacion,
          e.EgrMontoConvertido,
          e.EgrTipoEgreso,
          e.EgrObservaciones,
          e.EgrEstado,
          e.DocIdDocumento,
          dc.DocNumero      AS VoucherNumero,
          dc.DocSerie       AS VoucherSerie,
          dc.DocFechaEmision,
          dc.AsiIdAsiento,
          mp.MPaDescripcionMetodo AS MetodoPago,
          u.NombreCompleto  AS UsuarioNombre,
          st.StuFechaApertura,
          cfg.CegNombreTipo   AS TipoEgresoLabel,
          cfg.CegCueCodigo    AS CuentaCodigo,
          cfg.CegCueNombre    AS CuentaNombre,
          cta.CueNombre       AS CuentaContableNombre,
          emp.RazSocial       AS EmpresaNombre,
          emp.RUC             AS EmpresaRuc
        FROM dbo.EgresosCaja e WITH(NOLOCK)
        LEFT JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = e.DocIdDocumento
        LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = e.MPaIdMetodoPago
        LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = e.EgrUsuarioId
        LEFT JOIN dbo.SesionesTurno st WITH(NOLOCK) ON st.StuIdSesion = e.StuIdSesion
        LEFT JOIN dbo.Config_CuentasEgreso cfg WITH(NOLOCK) ON cfg.CegTipoEgreso = e.EgrTipoEgreso
        LEFT JOIN dbo.Cont_PlanCuentas cta WITH(NOLOCK) ON cta.CueCodigo = cfg.CegCueCodigo
        OUTER APPLY (SELECT TOP 1 RazSocial, RUC FROM dbo.ConfiguracionGlobal) emp
        WHERE e.EgrIdEgreso = @Id
      `);

    if (!r.recordset.length)
      return res.status(404).json({ success: false, error: 'Egreso no encontrado.' });

    return res.json({ success: true, voucher: r.recordset[0] });
  } catch (err) {
    logger.error('[CAJA] getVoucherEgreso:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────

const registrarIngresoGenerico = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  let { stuIdSesion, concepto, monto, moneda='UYU', monedaId=1,
          cotizacion, metodoPagoId, tipoDocumento, serieDoc, numeroDoc, observaciones, admin } = req.body;
  if (!concepto || !monto || !metodoPagoId) return res.status(400).json({ success:false, error:'Concepto, monto y método son obligatorios.' });
  
  const montoNum  = parseFloat(monto);
  const cotNum    = parseFloat(cotizacion) || null;
  const convertido = (moneda === 'USD' && cotNum) ? montoNum * cotNum : montoNum;
  
  const pool = await getPool();
  const transaction = pool.transaction();
  
  try {
    await transaction.begin();

    if (admin) stuIdSesion = null;

    let numeroDocFinal = numeroDoc || null;
    if (tipoDocumento && tipoDocumento !== 'NINGUNO' && !numeroDoc) {
      try {
        const seqR = await new sql.Request(transaction)
          .input('CodDoc', sql.VarChar(10), tipoDocumento)
          .input('Serie',  sql.VarChar(5),  serieDoc || 'A')
          .query(`
            DECLARE @SecId INT;
            SELECT @SecId = s.SecIdSecuencia
            FROM Config_TiposDocumento c
            JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
            WHERE c.CodDocumento = @CodDoc AND s.SecSerie = @Serie AND s.SecActivo = 1;

            IF @SecId IS NOT NULL
            BEGIN
              UPDATE SecuenciaDocumentos
              SET SecUltimoNumero = SecUltimoNumero + 1
              OUTPUT 
                RIGHT(REPLICATE('0', INSERTED.SecDigitos) + CAST(INSERTED.SecUltimoNumero AS VARCHAR(10)), INSERTED.SecDigitos) AS NumeroFormato
              WHERE SecIdSecuencia = @SecId;
            END
          `);
        if (seqR.recordset && seqR.recordset.length) {
            numeroDocFinal = seqR.recordset[0].NumeroFormato;
        }
      } catch (errSeq) { logger.error('Error seq ingreso generico:', errSeq.message); }
    }

    const rCli = await new sql.Request(transaction).query(`
      SELECT TOP 1 CliIdCliente FROM dbo.Clientes 
      WHERE Nombre LIKE '%Consumidor%' OR Nombre LIKE '%Final%' OR CodCliente = '0' OR CliIdCliente = 2089
    `);
    const clientePorDefecto = rCli.recordset.length > 0 ? rCli.recordset[0].CliIdCliente : 1;

    // Insertar TransaccionesCaja
    const tcaRes = await new sql.Request(transaction)
      .input('StuIdSesion',      sql.Int,           stuIdSesion   || null)
      .input('TcaUsuarioId',     sql.Int,           usuarioId)
      .input('TcaClienteId',     sql.Int,           clientePorDefecto)
      .input('TcaTipoDoc',       sql.VarChar(20),   tipoDocumento || 'OTROS_INGRESOS')
      .input('TcaSerieDoc',      sql.VarChar(5),    serieDoc      || 'A')
      .input('TcaNumeroDoc',     sql.VarChar(20),   numeroDocFinal || 'S/N')
      .input('TcaBruto',         sql.Decimal(18,4), montoNum)
      .input('TcaNeto',          sql.Decimal(18,4), montoNum)
      .input('TcaCobrado',       sql.Decimal(18,4), montoNum)
      .input('TcaMonedaBase',    sql.VarChar(10),   moneda)
      .input('TcaObservaciones', sql.NVarChar(300), observaciones || concepto)
      .input('EsAdmin',          sql.Bit,           admin ? 1 : 0)
      .query(`
        INSERT INTO dbo.TransaccionesCaja
          (StuIdSesion, TcaFecha, TcaUsuarioId, TcaClienteId, TcaTipoDocumento, TcaSerieDoc, TcaNumeroDoc,
           TcaTotalBruto, TcaTotalAjuste, TcaTotalNeto, TcaTotalCobrado, TcaMonedaBase, TcaEstado, TcaObservaciones, EsCajaAdmin)
        OUTPUT INSERTED.TcaIdTransaccion
        VALUES
          (@StuIdSesion, GETDATE(), @TcaUsuarioId, @TcaClienteId, @TcaTipoDoc, @TcaSerieDoc, @TcaNumeroDoc,
           @TcaBruto, 0, @TcaNeto, @TcaCobrado, @TcaMonedaBase, 'COBRADO', @TcaObservaciones, @EsAdmin)
      `);
    const tcaId = tcaRes.recordset[0].TcaIdTransaccion;

    // Insertar en Pagos
    await new sql.Request(transaction)
      .input('tcaId',   sql.Int,           tcaId)
      .input('metodo',  sql.Int,           parseInt(metodoPagoId, 10))
      .input('moneda',  sql.Int,           parseInt(monedaId, 10) || 1)
      .input('monto',   sql.Decimal(18,4), montoNum)
      .input('cot',     sql.Decimal(18,4), cotNum || 1)
      .input('convert', sql.Decimal(18,4), convertido)
      .input('usuario', sql.Int,           usuarioId)
      .query(`
        INSERT INTO dbo.Pagos
          (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
           PagMontoPago, PagFechaPago, PagUsuarioAlta, PagCotizacion,
           PagMontoConvertido, PagTipoMovimiento)
        VALUES
          (@tcaId, @metodo, @moneda,
           @monto, GETDATE(), @usuario, @cot,
           @convert, 'COBRO')
      `);

    // Asiento contable
    const lineasContables = [];
    // 1. Débito a Caja
    lineasContables.push({
      codigoCuenta: moneda === 'USD' ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU,
      debeBase: montoNum,
      haberBase: 0,
      monedaId: moneda === 'USD' ? 2 : 1,
      cotizacion: cotNum || 1
    });

    // 2. Crédito a Ingresos Varios (usamos la default de ingresos)
    lineasContables.push({
      codigoCuenta: contabilidadCore.CUENTAS.VENTA_SERV,
      debeBase: 0,
      haberBase: montoNum,
      monedaId: moneda === 'USD' ? 2 : 1,
      cotizacion: cotNum || 1,
      entidadTipo: 'NINGUNO'
    });

    await contabilidadCore.generarAsientoCompleto({
      concepto: `Ingreso Genérico: ${concepto}`,
      usuarioId,
      tcaIdTransaccion: tcaId,
      origen: 'CAJA_INGRESOS',
      lineas: lineasContables
    }, transaction);

    await transaction.commit();

    logger.info(`[CAJA-ERP] Ingreso Genérico Registrado ID=${tcaId} Monto=${montoNum} ${moneda}`);
    const s = io(req); if (s) s.emit('actualizado', { type: 'caja-ingreso' });
    return res.status(201).json({ success:true, tcaId, numeroDoc:numeroDocFinal });
  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    logger.error('[CAJA-ERP] registrarIngresoGenerico Error:', err.message);
    return res.status(500).json({ success:false, error:err.message });
  }
};

// ─────────────────────────────────────────────

/** POST /api/contabilidad/caja/autorizar */
const autorizarSinPago = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  const { oreIdOrdenRetiro, motivo, montoDeuda=0, fechaVencimiento } = req.body;
  if (!oreIdOrdenRetiro || !motivo?.trim())
    return res.status(400).json({ success:false, error:'oreIdOrdenRetiro y motivo son obligatorios.' });

  // Soporta número plano (123) o string formateado ("R-123", "RW-0018")
  const numMatch = String(oreIdOrdenRetiro).match(/(\d+)$/);
  const OReId = numMatch ? parseInt(numMatch[1], 10) : NaN;
  if (isNaN(OReId)) return res.status(400).json({ success:false, error:`ID de retiro inválido: ${oreIdOrdenRetiro}` });

  try {
    const pool = await getPool();
    const transaction = pool.transaction();
    await transaction.begin();
    try {
      // Cambiar estado de la orden a 9 (Autorizado sin pago)
      await new sql.Request(transaction)
        .input('Id',  sql.Int, OReId)
        .input('Usr', sql.Int, usuarioId)
        .query(`
          UPDATE dbo.OrdenesRetiro
          SET OReEstadoActual = 9, OReFechaEstadoActual = GETDATE(), ORePasarPorCaja = 0
          WHERE OReIdOrdenRetiro = @Id;
          INSERT INTO dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          VALUES (@Id, 9, GETDATE(), @Usr);
        `);
      // Registrar en la tabla de autorizaciones
      const auzRes = await new sql.Request(transaction)
        .input('OReId',    sql.Int,           OReId)
        .input('Usr',      sql.Int,           usuarioId)
        .input('Motivo',   sql.NVarChar(300),  motivo.trim())
        .input('Monto',    sql.Decimal(18,2),  parseFloat(montoDeuda) || 0)
        .input('FechaVenc',sql.Date,           fechaVencimiento || null)
        .query(`
          INSERT INTO dbo.AutorizacionesSinPago
            (OReIdOrdenRetiro, AuzFecha, AuzUsuarioId, AuzMotivo, AuzMontoDeuda, AuzFechaVencimiento, AuzEstado)
          OUTPUT INSERTED.AuzIdAutorizacion
          VALUES (@OReId, GETDATE(), @Usr, @Motivo, @Monto, @FechaVenc, 'ACTIVA')
        `);
      await transaction.commit();
      const s = io(req); if (s) { s.emit('retiros:update',{type:'autorizacion'}); }
      logger.info(`[CAJA] ✅ Autorización sin pago: OrdenRetiro=${oreIdOrdenRetiro}`);
      return res.status(201).json({ success:true, auzIdAutorizacion:auzRes.recordset[0].AuzIdAutorizacion });
    } catch (e) { await transaction.rollback(); throw e; }
  } catch (err) {
    logger.error('[CAJA] autorizarSinPago:', err.message);
    return res.status(500).json({ success:false, error:err.message });
  }
};

// ─────────────────────────────────────────────

/**
 * POST /api/contabilidad/caja/operacion-manual
 *
 * El cajero elige una operacion del Motor (EvtCodigo) y el sistema:
 *  1. Carga las reglas de Cont_ReglasAsiento para ese evento
 *  2. Registra MovimientosCuenta según EvtAfectaSaldo del evento
 *  3. Genera el asiento en Libro Mayor via contabilidadCore
 *  4. Crea el documento en DocumentosContables si EvtGeneraDeuda
 *
 * Payload:
 *  { evtCodigo, clienteId, importe, moneda, monedaId, cotizacion,
 *    metodoPagoId, serieDoc, observaciones }
 */
const motorContable = require('../services/motorContable');

const registrarOperacionManual = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  const {
    evtCodigo, clienteId, importe, moneda = 'UYU', monedaId = 1,
    cotizacion, metodoPagoId, serieDoc = 'A', observaciones = '', admin
  } = req.body;

  if (!evtCodigo) return res.status(400).json({ success: false, error: 'evtCodigo es obligatorio.' });
  if (!importe || isNaN(parseFloat(importe))) return res.status(400).json({ success: false, error: 'importe es obligatorio.' });

  // Cargar el evento del motor
  const evento = await motorContable.getEvento(evtCodigo);
  if (!evento) return res.status(404).json({ success: false, error: `Evento '${evtCodigo}' no encontrado en el Motor.` });
  if (!evento.EvtActivo) return res.status(400).json({ success: false, error: `Evento '${evtCodigo}' está inactivo.` });
  if (evento.EvtUsaEntidad && !clienteId) return res.status(400).json({ success: false, error: `El evento '${evento.EvtNombre}' requiere un cliente.` });

  const montoNum = parseFloat(importe);
  const cotNum   = parseFloat(cotizacion) || 1;
  const convertido = moneda === 'USD' ? montoNum * cotNum : montoNum;

  const pool = await getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    // 1. Verificar caja abierta (si no es administrativa)
    let sesionId = null;
    if (!admin) {
      const sRes = await new sql.Request(transaction).query("SELECT TOP 1 StuIdSesion FROM dbo.SesionesTurno WITH(UPDLOCK) WHERE StuEstado='ABIERTA'");
      if (!sRes.recordset.length) { await transaction.rollback(); return res.status(400).json({ success: false, error: 'No hay caja abierta.' }); }
      sesionId = sRes.recordset[0].StuIdSesion;
    }

    // 2. Encabezado de transaccion
    const nDoc = await new sql.Request(transaction)
      .input('T', sql.VarChar(20), evento.EvtPrefijo || evtCodigo)
      .query('SELECT ISNULL(MAX(TcaNumeroDoc),0)+1 AS N FROM dbo.TransaccionesCaja WITH(UPDLOCK) WHERE TcaTipoDocumento=@T');
    const numDoc = nDoc.recordset[0].N;

    const rTca = await new sql.Request(transaction)
      .input('Ses', sql.Int, sesionId)
      .input('Usr', sql.Int, usuarioId)
      .input('Cli', sql.Int, clienteId || null)
      .input('TipoD', sql.VarChar(50), evento.EvtPrefijo || evtCodigo)
      .input('Serie', sql.VarChar(10), serieDoc)
      .input('Num',  sql.VarChar(20), String(numDoc))
      .input('Bruto', sql.Decimal(18,2), montoNum)
      .input('Neto',  sql.Decimal(18,2), montoNum)
      .input('Cob',   sql.Decimal(18,2), convertido)
      .input('Moneda',sql.VarChar(10),   moneda || 'UYU')
      .input('Obs',   sql.NVarChar(500), observaciones || evento.EvtNombre)
      .input('AdminFlag', sql.Bit, admin ? 1 : 0)
      .query(`INSERT INTO dbo.TransaccionesCaja
        (StuIdSesion,TcaUsuarioId,TcaClienteId,TcaFecha,TcaTipoDocumento,TcaSerieDoc,TcaNumeroDoc,TcaEstado,TcaTotalBruto,TcaTotalAjuste,TcaTotalNeto,TcaTotalCobrado,TcaMonedaBase,TcaObservaciones,EsCajaAdmin)
        OUTPUT INSERTED.TcaIdTransaccion
        VALUES (@Ses,@Usr,@Cli,GETDATE(),@TipoD,@Serie,@Num,'COMPLETADO',@Bruto,0,@Neto,@Cob,@Moneda,@Obs,@AdminFlag)`);
    const tcaId = rTca.recordset[0].TcaIdTransaccion;

    // 3. Movimiento en Submayor del cliente (si el evento afecta saldo y hay cliente)
    let docId = null;
    if (clienteId && evento.EvtAfectaSaldo !== 0) {
      const tipoCuenta = moneda === 'USD' ? 'DINERO_USD' : 'DINERO_UYU';
      const cRes = await new sql.Request(transaction)
        .input('Cli', sql.Int, clienteId)
        .input('T', sql.VarChar(20), tipoCuenta)
        .query('SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente=@Cli AND CueTipo=@T AND CueActiva=1');
      
      let cuentaId = cRes.recordset[0]?.CueIdCuenta;
      if (!cuentaId) {
        const nCta = await new sql.Request(transaction)
          .input('Cli', sql.Int, clienteId).input('T', sql.VarChar(20), tipoCuenta)
          .input('Mon', sql.Int, monedaId).input('Usr', sql.Int, usuarioId)
          .query(`INSERT INTO dbo.CuentasCliente (CliIdCliente,CueTipo,MonIdMoneda,CPaIdCondicion,CueSaldoActual,CueLimiteCredito,CuePuedeNegativo,CueCicloActivo,CueActiva,CueFechaAlta,CueUsuarioAlta)
                  OUTPUT INSERTED.CueIdCuenta VALUES (@Cli,@T,@Mon,1,0,0,0,0,1,GETDATE(),@Usr)`);
        cuentaId = nCta.recordset[0].CueIdCuenta;
      }

      // El importe tiene el signo segun EvtAfectaSaldo (+1 acredita, -1 debita)
      const importeMov = montoNum * evento.EvtAfectaSaldo;
      // Documento de deuda si aplica
      if (evento.EvtGeneraDeuda) {
        const rDoc = await new sql.Request(transaction)
          .input('Cta', sql.Int, cuentaId)
          .input('Cli', sql.Int, clienteId)
          .input('Tot', sql.Decimal(18,2), montoNum)
          .input('Usr', sql.Int, usuarioId)
          .input('Tca', sql.Int, tcaId)
          .input('Serie', sql.VarChar(10), serieDoc)
          .input('MonId', sql.Int, monedaId || 1)
          .query(`INSERT INTO dbo.DocumentosContables (CueIdCuenta,CliIdCliente,DocTipo,DocNumero,DocSerie,DocSubtotal,DocTotal,DocTotalDescuentos,DocTotalRecargos,MonIdMoneda,DocFechaEmision,DocEstado,DocUsuarioAlta)
                  OUTPUT INSERTED.DocIdDocumento
                  VALUES (@Cta,@Cli,'${evtCodigo}',CAST(@Tca AS VARCHAR),@Serie,@Tot,@Tot,0,0,@MonId,GETDATE(),'PENDIENTE',@Usr)`);
        docId = rDoc.recordset[0].DocIdDocumento;

        // Insertar detalle del documento
        await new sql.Request(transaction)
          .input('DocId',    sql.Int,           docId)
          .input('Nom',      sql.VarChar(200),  `${evento.EvtNombre}`.substring(0, 200))
          .input('Desc',     sql.VarChar(500),  `${observaciones || ''}`.substring(0, 500))
          .input('Monto',    sql.Decimal(18,2), montoNum)
          .query(`
            INSERT INTO dbo.DocumentosContablesDetalle
              (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal)
            VALUES
              (@DocId, @Nom, @Desc, 1.0, @Monto, @Monto, 0.0, @Monto)
          `);
      }

      await contabilidadSvc.registrarMovimiento({
        CueIdCuenta: cuentaId,
        MovTipo: evtCodigo,
        MovConcepto: `${evento.EvtNombre}${observaciones ? ': '+observaciones : ''}`,
        MovImporte: importeMov,
        MovUsuarioAlta: usuarioId,
        DocIdDocumento: docId
      }, transaction);
    }

    // 4. Asiento en Libro Mayor usando reglas del Motor
    const reglasAsiento = await motorContable.getReglasAsiento(evtCodigo);
    if (reglasAsiento.length > 0) {
      try {
        const iva22 = montoNum / 1.22 * 0.22;
        const neto  = montoNum - iva22;
        const contexto = { importeTotal: montoNum, importeNeto: neto, importeIva: iva22, importeDescuento: 0 };
        const formulaMap = { TOTAL: montoNum, NETO: neto, IVA: iva22, DESCUENTO: 0 };

        const lineasContables = reglasAsiento.map(r => {
          const monto = formulaMap[r.RasFormula] ?? montoNum;
          return {
            codigoCuenta: r.CueCodigo === 'META_CLIENTE' ? (moneda === 'USD' ? contabilidadCore.CUENTAS.CLIENTE_USD : contabilidadCore.CUENTAS.CLIENTE_UYU)
                        : r.CueCodigo === 'META_CAJA'    ? (moneda === 'USD' ? contabilidadCore.CUENTAS.CAJA_USD    : contabilidadCore.CUENTAS.CAJA_UYU)
                        : r.CueCodigo,
            debeBase:  r.RasNaturaleza === 'DEBE'  ? monto : 0,
            haberBase: r.RasNaturaleza === 'HABER' ? monto : 0,
            monedaId, cotizacion: cotNum,
            entidadId: clienteId || null, entidadTipo: 'CLIENTE',
          };
        });

        await contabilidadCore.generarAsientoCompleto({
          concepto: `${evento.EvtNombre}${observaciones ? ': ' + observaciones : ''}`,
          usuarioId, tcaIdTransaccion: tcaId, origen: 'CAJA_MOTOR',
          lineas: lineasContables
        }, transaction);
      } catch (eAsiento) {
        logger.warn(`[MOTOR] Asiento parcial para ${evtCodigo}: ${eAsiento.message}`);
      }
    }

    await transaction.commit();
    logger.info(`[CAJA-MOTOR] Operacion '${evtCodigo}' TcaId=${tcaId} Cliente=${clienteId} Monto=${montoNum}`);
    return res.status(201).json({ success: true, tcaIdTransaccion: tcaId, evtCodigo, importe: montoNum, docId });

  } catch (err) {
    try { await transaction.rollback(); } catch (_) {}
    logger.error('[CAJA-MOTOR] registrarOperacionManual:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};


// ─────────────────────────────────────────────
// POST /caja/pago-deuda
// Recibe: { header, aplicaciones: [{ddeId, descripcion, montoOriginal}], pagos: [...] }
// 1. Registra los pagos en la caja (MovimientosCaja)
// 2. Imputa contra cada DeudaDocumento seleccionada (actualiza DDeImportePendiente / DDeEstado)
// 3. Registra movimientos en libro mayor (MovimientosCuenta)
const procesarPagoDeuda = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  try {
    const { header, aplicaciones, pagos } = req.body;
    if (!header?.clienteId) return res.status(400).json({ error: 'clienteId es requerido.' });
    if (!aplicaciones?.length) return res.status(400).json({ error: 'Debe seleccionar al menos una deuda.' });
    if (!pagos?.length) return res.status(400).json({ error: 'Debe incluir al menos un método de pago.' });

    // ─────────────────────────────────────────────
    const sumDeudas = aplicaciones.reduce((s, a) => s + (Number(a.montoOriginal) || 0), 0);
    const sumPagos  = pagos.reduce((s, p) => s + (Number(p.montoOriginal) || 0), 0);
    const exceso = sumPagos - sumDeudas;
    if (exceso > 0.01) {
      logger.warn(`[PAGO-DEUDA] Exceso rechazado: deudas=${sumDeudas.toFixed(2)} pagos=${sumPagos.toFixed(2)} exceso=${exceso.toFixed(2)}`);
      return res.status(400).json({
        error: `El pago excede las deudas seleccionadas en ${exceso.toFixed(2)}. No se permiten comprobantes con excedente.`
      });
    }
    // ─────────────────────────────────────────────
    const esParcial = sumDeudas - sumPagos > 0.01;
    if (esParcial) logger.info(`[PAGO-DEUDA] Pago parcial: deudas=${sumDeudas.toFixed(2)} pagos=${sumPagos.toFixed(2)}`);

    const pool = await getPool();
    const transaction = pool.transaction();
    await transaction.begin();

    let totalImputado = 0;

    try {
      // ─────────────────────────────────────────────
      // El pago real (sumPagos) se distribuye proporcionalmente entre las deudas seleccionadas.
      // Esto evita marcar como COBRADO cuando el pago es parcial.
      let pagoRestante = sumPagos;

      for (const ap of aplicaciones) {
        const { ddeId, montoOriginal } = ap;
        if (!ddeId || !montoOriginal || pagoRestante <= 0) continue;

        // ─────────────────────────────────────────────
        const ddeRes = await new sql.Request(transaction)
          .input('ddeId', sql.Int, ddeId)
          .query(`
            SELECT DDeImportePendiente, DDeEstado, CueIdCuenta, OrdIdOrden
            FROM dbo.DeudaDocumento WITH (UPDLOCK, ROWLOCK)
            WHERE DDeIdDocumento = @ddeId
          `);

        if (!ddeRes.recordset.length) {
          logger.warn(`[PAGO-DEUDA] DeudaDocumento #${ddeId} no encontrada ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â saltada.`);
          continue;
        }

        const dde = ddeRes.recordset[0];
        // Guardar OrdIdOrden y cueIdCuenta en la aplicación
        ap.ordIdOrden = dde.OrdIdOrden || ap.ordIdOrden || null;
        ap.cueIdCuenta = dde.CueIdCuenta;
        const pendienteActual = Number(dde.DDeImportePendiente);
        // Aplicar solo lo que hay disponible en el pago restante, sin exceder la deuda pendiente
        const montoAplicar   = Math.min(pagoRestante, pendienteActual);
        const nuevoPendiente = Math.max(0, pendienteActual - montoAplicar);
        const nuevoEstado    = nuevoPendiente < 0.01 ? 'COBRADO' : 'PARCIAL';
        pagoRestante -= montoAplicar;

        // Centralizado: reduce pendiente y ajusta estado automáticamente
        await contabilidadSvc.reducirDeuda({ ddeId, monto: montoAplicar }, transaction);

        // ─────────────────────────────────────────────
        await contabilidadSvc.registrarMovimiento({
          CueIdCuenta:      dde.CueIdCuenta,
          MovTipo:          'PAGO',
          MovConcepto:      ('Pago deuda - ' + (ap.descripcion || ('Deuda #' + ddeId))).substring(0, 300),
          MovImporte:       montoAplicar,
          MovUsuarioAlta:   usuarioId,
          MovObservaciones: ('DeudaDoc #' + ddeId + ' | Pagado: ' + montoAplicar.toFixed(4) + ' | Pendiente: ' + nuevoPendiente.toFixed(4) + ' | Estado: ' + nuevoEstado).substring(0, 500),
        });

        // ─────────────────────────────────────────────
        // Cubre el caso donde el cliente paga directamente por "Pago de Deuda" sin pasar por Retiro.
        if (nuevoEstado === 'COBRADO') {
          try {
            await new sql.Request(transaction)
              .input('ddeId', sql.Int, ddeId)
              .input('Usr',   sql.Int, usuarioId)
              .query(`
                UPDATE od
                SET od.OrdEstadoActual = 7, od.OrdFechaEstadoActual = GETDATE()
                FROM dbo.OrdenesDeposito od
                WHERE od.OrdEstadoActual NOT IN (7, 9)
                  AND od.OrdIdOrden IN (
                    SELECT td.TdeReferenciaId
                    FROM dbo.TransaccionDetalle td
                    JOIN dbo.DocumentosContables dc ON dc.TcaIdTransaccion = td.TcaIdTransaccion
                    JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = dc.DocIdDocumento
                    WHERE dd.DDeIdDocumento = @ddeId
                      AND td.TdeTipoReferencia = 'ORDEN_DEPOSITO'
                  );

                INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                SELECT od.OrdIdOrden, 7, GETDATE(), @Usr
                FROM dbo.OrdenesDeposito od
                WHERE od.OrdEstadoActual = 7
                  AND od.OrdFechaEstadoActual >= DATEADD(SECOND, -5, GETDATE())
                  AND od.OrdIdOrden IN (
                    SELECT td.TdeReferenciaId
                    FROM dbo.TransaccionDetalle td
                    JOIN dbo.DocumentosContables dc ON dc.TcaIdTransaccion = td.TcaIdTransaccion
                    JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = dc.DocIdDocumento
                    WHERE dd.DDeIdDocumento = @ddeId
                      AND td.TdeTipoReferencia = 'ORDEN_DEPOSITO'
                  );
              `);
            logger.info(`[PAGO-DEUDA] OrdenesDeposito vinculadas a DeudaDoc #${ddeId} marcadas como Pagadas.`);
          } catch (eOrden) {
            logger.warn(`[PAGO-DEUDA] No se pudo marcar OrdenDeposito como pagada para DeudaDoc #${ddeId}: ${eOrden.message}`);
            // ─────────────────────────────────────────────
          }
        }

        totalImputado += montoAplicar;
        logger.info(`[PAGO-DEUDA] Deuda #${ddeId}: aplicado=${montoAplicar.toFixed(2)} nuevo_pendiente=${nuevoPendiente.toFixed(2)} estado=${nuevoEstado}`);
      }

      // ─────────────────────────────────────────────
      // ─────────────────────────────────────────────
      // Prioridad: header.moneda > monedaId del primer pago > UYU
      const primerPagoBase = pagos.find(p => p.montoOriginal > 0) || pagos[0];
      const monedaBaseStr  = header.moneda
        || (parseInt(primerPagoBase?.monedaId, 10) === 2 ? 'USD' : 'UYU');
      const monedaBaseId   = monedaBaseStr === 'USD' ? 2 : 1;
      // ─────────────────────────────────────────────
      let sesionId = header.sesionId || null;
      if (!sesionId && !header.admin && !header.esAdministrativa) {
        const sesRes = await new sql.Request(transaction)
          .input('uid', sql.Int, usuarioId)
          .query(`SELECT TOP 1 StuIdSesion FROM dbo.SesionesTurno WHERE StuEstado='ABIERTA' ORDER BY StuFechaApertura DESC`);
        if (sesRes.recordset.length) sesionId = sesRes.recordset[0].StuIdSesion;
      }

      // ─────────────────────────────────────────────
      let tipoTransaccion = 'PAGO_DEUDA';
      let serieTransaccion = header.serieDoc || 'A';
      let docNumero = null;
      let docTipoStr = null;
      let generaDocumentoContable = false;

      // ─────────────────────────────────────────────
      // ─────────────────────────────────────────────
      logger.info('[PAGO-DEUDA] Aplicaciones: ' + JSON.stringify(aplicaciones.map(a => ({ ddeId: a.ddeId, docIdDocumento: a.docIdDocumento }))));
      logger.info('[PAGO-DEUDA] header.tieneOrdenSinFactura=' + header.tieneOrdenSinFactura);
      const sinFactura = aplicaciones.filter(ap => !ap.docIdDocumento);
      const tieneOrdenSinFactura = header.tieneOrdenSinFactura === true || sinFactura.length > 0;
      logger.info('[PAGO-DEUDA] sinFactura=' + sinFactura.length + ' tieneOrdenSinFactura=' + tieneOrdenSinFactura);

      // ─────────────────────────────────────────────
      if (tieneOrdenSinFactura) {
        // ─────────────────────────────────────────────
        const pedidoCajaR = await new sql.Request(transaction).query(`
          SELECT TOP 1 c.CodDocumento, s.SecIdSecuencia, c.Codigo_Efact, s.SecSerie, c.Detalle
          FROM dbo.Config_TiposDocumento c
          JOIN dbo.SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
          WHERE (c.CodDocumento = '40' OR c.Detalle LIKE '%Pedido%' OR c.Detalle LIKE '%PEDIDO%')
            AND s.SecActivo = 1
          ORDER BY CASE c.CodDocumento WHEN '40' THEN 0 ELSE 9 END
        `);
        if (pedidoCajaR.recordset.length) {
          tipoTransaccion  = pedidoCajaR.recordset[0].CodDocumento;
          serieTransaccion = pedidoCajaR.recordset[0].SecSerie;
          docTipoStr       = pedidoCajaR.recordset[0].Detalle || 'Pedido Caja';
          logger.info(`[PAGO-DEUDA] Orden sin factura detectada -> PEDIDO CAJA tipo=${tipoTransaccion} serie=${serieTransaccion}`);
          // Avanzar secuencia
          const seqR = await new sql.Request(transaction)
            .input('SecId', sql.Int, pedidoCajaR.recordset[0].SecIdSecuencia)
            .query(`
              UPDATE dbo.SecuenciaDocumentos
              SET SecUltimoNumero = SecUltimoNumero + 1
              OUTPUT RIGHT(REPLICATE('0', INSERTED.SecDigitos) + CAST(INSERTED.SecUltimoNumero AS VARCHAR(10)), INSERTED.SecDigitos) AS NumeroFormato
              WHERE SecIdSecuencia = @SecId
            `);
          if (seqR.recordset.length) docNumero = seqR.recordset[0].NumeroFormato;
          generaDocumentoContable = true;
        }
      } else if (header.tipoDocumento && header.tipoDocumento !== 'NINGUNO') {
        // ─────────────────────────────────────────────
        tipoTransaccion  = header.tipoDocumento;
        serieTransaccion = header.serieDoc || 'A';
      } else {
        // ─────────────────────────────────────────────
        const autoDocR = await new sql.Request(transaction)
          .input('Serie', sql.VarChar(5), 'A')
          .query(`
            SELECT TOP 1 c.CodDocumento, s.SecIdSecuencia, c.Detalle
            FROM dbo.Config_TiposDocumento c
            JOIN dbo.SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
            WHERE s.SecActivo = 1 AND s.SecSerie = @Serie
            ORDER BY CASE c.CodDocumento WHEN '05' THEN 0 ELSE 9 END
          `);
        if (autoDocR.recordset.length) {
          tipoTransaccion = autoDocR.recordset[0].CodDocumento;
          logger.info(`[PAGO-DEUDA] tipoDocumento no especificado -> usando tipo auto-detectado: ${tipoTransaccion} (${autoDocR.recordset[0].Detalle})`);
        }
      }

      // Si aun no tenemos docNumero (caso E-Ticket/Recibo normal, no PEDIDO CAJA)
      if (!docNumero && tipoTransaccion !== 'PAGO_DEUDA') {
        const tipoDocR = await new sql.Request(transaction)
          .input('CodDoc', sql.VarChar(10), tipoTransaccion)
          .input('Serie',  sql.VarChar(5),  serieTransaccion)
          .query(`
            SELECT c.Detalle AS DocTipoStr, s.SecIdSecuencia
            FROM dbo.Config_TiposDocumento c
            JOIN dbo.SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
            WHERE c.CodDocumento = @CodDoc AND s.SecSerie = @Serie AND s.SecActivo = 1
          `);
        if (tipoDocR.recordset && tipoDocR.recordset.length) {
          docTipoStr = tipoDocR.recordset[0].DocTipoStr || 'E-Ticket';
          const seqR2 = await new sql.Request(transaction)
            .input('SecId', sql.Int, tipoDocR.recordset[0].SecIdSecuencia)
            .query(`
              UPDATE dbo.SecuenciaDocumentos
              SET SecUltimoNumero = SecUltimoNumero + 1
              OUTPUT RIGHT(REPLICATE('0', INSERTED.SecDigitos) + CAST(INSERTED.SecUltimoNumero AS VARCHAR(10)), INSERTED.SecDigitos) AS NumeroFormato
              WHERE SecIdSecuencia = @SecId
            `);
          if (seqR2.recordset && seqR2.recordset.length) docNumero = seqR2.recordset[0].NumeroFormato;
        }
      }

      if (!docNumero) {
        generaDocumentoContable = false;
        tipoTransaccion = 'PAGO_DEUDA';
        const nDocRes = await new sql.Request(transaction)
          .query(`SELECT ISNULL(MAX(TcaNumeroDoc),0)+1 AS Siguiente FROM dbo.TransaccionesCaja WHERE TcaTipoDocumento='PAGO_DEUDA'`);
        docNumero = String(nDocRes.recordset[0].Siguiente);
        logger.warn('[PAGO-DEUDA] Sin secuencia fiscal disponible');
      } else {
        generaDocumentoContable = true;
      }

      const tcaRes = await new sql.Request(transaction)
        .input('sesId',    sql.Int,          sesionId)
        .input('usuario',  sql.Int,          usuarioId)
        .input('cliente',  sql.Int,          header.clienteId)
        .input('tipo',     sql.VarChar(20),  tipoTransaccion)
        .input('serie',    sql.VarChar(10),  serieTransaccion)
        .input('num',      sql.VarChar(20),  docNumero)
        .input('neto',     sql.Decimal(18,4), totalImputado)
        .input('monedaBase', sql.VarChar(10), monedaBaseStr)
        .input('obs',      sql.VarChar(500), header.observaciones || 'Pago de deuda cuenta corriente')
        .input('AdminFlag', sql.Bit, (header.admin || header.esAdministrativa) ? 1 : 0)
        .query(`
          INSERT INTO dbo.TransaccionesCaja
            (StuIdSesion, TcaUsuarioId, TcaClienteId, TcaFecha,
             TcaTipoDocumento, TcaSerieDoc, TcaNumeroDoc, TcaEstado,
             TcaTotalBruto, TcaTotalAjuste, TcaTotalNeto, TcaTotalCobrado, TcaMonedaBase, TcaObservaciones, EsCajaAdmin)
          OUTPUT INSERTED.TcaIdTransaccion
          VALUES
            (@sesId, @usuario, @cliente, GETDATE(),
             @tipo, @serie, @num, 'COBRADO',
             @neto, 0, @neto, @neto, @monedaBase, @obs, @AdminFlag)
        `);
      const tcaIdPago = tcaRes.recordset[0].TcaIdTransaccion;

      // ─────────────────────────────────────────────
      let docId = null;
      if (generaDocumentoContable && docNumero) {
        try {
          const rCaja = await new sql.Request(transaction)
            .input('codCaja', sql.VarChar(20), monedaBaseStr === 'USD' ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU)
            .query(`SELECT CueId FROM Cont_PlanCuentas WHERE CueCodigo = @codCaja`);
          const cueCaja = rCaja.recordset.length ? rCaja.recordset[0].CueId : 1;

          // Calcular IVA 22% para PEDIDO CAJA (igual que en cerrarCicloCompleto)
          const esPedidoCaja = tieneOrdenSinFactura;
          const docTotal     = totalImputado;
          const docSubtotal  = esPedidoCaja ? Math.round((docTotal / 1.22) * 10000) / 10000 : docTotal;
          const docImpuestos = esPedidoCaja ? Math.round((docTotal - docSubtotal) * 10000) / 10000 : 0;

          const tipoDocVal   = docTipoStr || 'Pedido Caja';
          const cfeEstadoVal = esPedidoCaja ? 'BORRADOR' : null;

          docId = await contabilidadCore.crearDocumentoContable({
            header: {
              cueIdCuenta:      cueCaja,
              clienteId:        header.clienteId,
              monedaId:         monedaBaseId,
              tipo:             tipoDocVal,
              numero:           docNumero,
              serie:            serieTransaccion,
              subtotal:         docSubtotal,
              impuestos:        docImpuestos,
              total:            docTotal,
              estado:           'COBRADO',
              cfeEstado:        cfeEstadoVal,
              usuarioId:        usuarioId,
              tcaIdTransaccion: tcaIdPago,
              observaciones:    (header.observaciones || 'Pago de deuda cuenta corriente').substring(0, 200),
              docPagado:        true
            },
            lineas: []
          }, transaction);
          

          // ── RECIBO de caja (correlativo RC-) ──────────────────────────────
          if (docId && totalImputado > 0) {
            try {
              const recSeq = await new sql.Request(transaction)
                .query(`UPDATE dbo.SecuenciaDocumentos SET SecUltimoNumero = SecUltimoNumero + 1
                        OUTPUT INSERTED.SecUltimoNumero
                        WHERE SecTipoDoc = 'RECIBO' AND SecSerie = 'RC'`);
              const numRecibo = recSeq.recordset[0]?.SecUltimoNumero;
              if (numRecibo) {
                const reciboId = await contabilidadCore.crearDocumentoContable({
                  header: {
                    cueIdCuenta:       cueCaja,
                    clienteId:         header.clienteId,
                    monedaId:          monedaBaseId,
                    tipo:              'RECIBO',
                    numero:            String(numRecibo),
                    serie:             'RC',
                    subtotal:          totalImputado,
                    impuestos:         0,
                    total:             totalImputado,
                    estado:            'COBRADO',
                    cfeEstado:         null,
                    usuarioId:         usuarioId,
                    tcaIdTransaccion:  tcaIdPago,
                    observaciones:     ('Recibo de cobro - ' + tipoDocVal + ' ' + serieTransaccion + '-' + docNumero).substring(0, 200),
                    docPagado:         true,
                    docIdDocumentoRef: docId
                  },
                  lineas: [{
                    nomItem:        'Cobro en efectivo',
                    dscItem:        ('Corresponde a: ' + tipoDocVal + ' ' + serieTransaccion + '-' + docNumero).substring(0, 500),
                    cantidad:       1,
                    precioUnitario: totalImputado,
                    subtotal:       totalImputado,
                    impuestos:      0,
                    total:          totalImputado
                  }]
                }, transaction);
                logger.info(`[PAGO-DEUDA] Recibo RC-${String(numRecibo).padStart(6,'0')} (ID=${reciboId}) generado para Doc #${docId}`);
              }
            } catch (eRecibo) {
              logger.warn(`[PAGO-DEUDA] Recibo no generado (no critico): ${eRecibo.message}`);
            }
          }
          // ─────────────────────────────────────────────────────────────────

          // Insertar detalle del documento
          if (docId) {
            if (esPedidoCaja && sinFactura.length > 0) {
              // PEDIDO CAJA: items reales via PedidosCobranza.OrdenID (link directo)
              for (const ap of sinFactura) {
                if (!ap.ordIdOrden) {
                  logger.warn(`[PAGO-DEUDA] ordIdOrden null para ddeId=${ap.ddeId} - saltando`);
                  continue;
                }
                logger.info(`[PAGO-DEUDA] Insertando items de OrdId=${ap.ordIdOrden}`);
                const itemsR = await new sql.Request(transaction)
                  .input('OrdId', sql.Int, ap.ordIdOrden)
                  .input('DocId', sql.Int, docId)
                  .input('MontoApli', sql.Decimal(18,4), Number(ap.montoOriginal) || 0)
                  .query(`
                    WITH CTE_Suma AS (
                        SELECT SUM(pcd2.Subtotal) as TotalOriginal
                        FROM dbo.OrdenesDeposito od2
                        JOIN dbo.PedidosCobranza pc2
                            ON CAST(pc2.NoDocERP AS VARCHAR(100)) = LEFT(od2.OrdCodigoOrden,
                                   CASE WHEN CHARINDEX(' ', od2.OrdCodigoOrden) > 0
                                        THEN CHARINDEX(' ', od2.OrdCodigoOrden) - 1
                                        ELSE LEN(od2.OrdCodigoOrden) END)
                        JOIN dbo.PedidosCobranzaDetalle pcd2 ON pcd2.PedidoCobranzaID = pc2.ID
                        WHERE od2.OrdIdOrden = @OrdId
                    )
                    INSERT INTO dbo.DocumentosContablesDetalle
                      (DocIdDocumento, OrdCodigoOrden, DcdNomItem, DcdDscItem,
                       DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal)
                    SELECT
                        @DocId,
                        od.OrdCodigoOrden,
                        LEFT(COALESCE(
                             NULLIF(NULLIF(LTRIM(RTRIM(art.Descripcion)), 'Articulos User'), 'Articulos User USD'),
                             NULLIF(LTRIM(RTRIM(od.OrdMaterialPlanilla)), ''),
                             od.OrdNombreTrabajo,
                             'Servicio de Produccion'
                        ), 80),
                        LEFT('Orden: ' + od.OrdCodigoOrden
                             + ISNULL(' (' + od.OrdNombreTrabajo + ')', ''), 500),
                        CAST(ISNULL(pcd.Cantidad, ISNULL(od.OrdCantidad, 1.0)) AS DECIMAL(18,4)),
                        ROUND((pcd.Subtotal * (CASE WHEN (SELECT TotalOriginal FROM CTE_Suma) > 0 THEN (@MontoApli / (SELECT TotalOriginal FROM CTE_Suma)) ELSE 1 END)) / NULLIF(ISNULL(pcd.Cantidad, ISNULL(od.OrdCantidad, 1.0)), 0) / 1.22, 4),
                        ROUND((pcd.Subtotal * (CASE WHEN (SELECT TotalOriginal FROM CTE_Suma) > 0 THEN (@MontoApli / (SELECT TotalOriginal FROM CTE_Suma)) ELSE 1 END)) / 1.22, 4),
                        ROUND((pcd.Subtotal * (CASE WHEN (SELECT TotalOriginal FROM CTE_Suma) > 0 THEN (@MontoApli / (SELECT TotalOriginal FROM CTE_Suma)) ELSE 1 END)) - (pcd.Subtotal * (CASE WHEN (SELECT TotalOriginal FROM CTE_Suma) > 0 THEN (@MontoApli / (SELECT TotalOriginal FROM CTE_Suma)) ELSE 1 END)) / 1.22, 4),
                        ROUND(pcd.Subtotal * (CASE WHEN (SELECT TotalOriginal FROM CTE_Suma) > 0 THEN (@MontoApli / (SELECT TotalOriginal FROM CTE_Suma)) ELSE 1 END), 4)
                    FROM dbo.OrdenesDeposito od
                    JOIN dbo.PedidosCobranza pc
                        ON CAST(pc.NoDocERP AS VARCHAR(100)) = LEFT(od.OrdCodigoOrden,
                               CASE WHEN CHARINDEX(' ', od.OrdCodigoOrden) > 0
                                    THEN CHARINDEX(' ', od.OrdCodigoOrden) - 1
                                    ELSE LEN(od.OrdCodigoOrden) END)
                    JOIN dbo.PedidosCobranzaDetalle pcd ON pcd.PedidoCobranzaID = pc.ID
                    LEFT JOIN dbo.Articulos art ON art.ProIdProducto = pcd.ProIdProducto
                    WHERE od.OrdIdOrden = @OrdId
                  `);
                logger.info(`[PAGO-DEUDA] Items insertados: ${itemsR.rowsAffected[0]} fila(s)`);
                if (!itemsR.rowsAffected[0] || itemsR.rowsAffected[0] === 0) {
                  logger.warn(`[PAGO-DEUDA] Sin PedidosCobranza para OrdId=${ap.ordIdOrden} - fallback`);
                  const bruto = Number(ap.montoOriginal) || 0;
                  const neto  = Math.round((bruto / 1.22) * 10000) / 10000;
                  const iva   = Math.round((bruto - neto) * 10000) / 10000;
                  const odFbR = await new sql.Request(transaction)
                    .input('OrdId2', sql.Int, ap.ordIdOrden)
                    .query(`SELECT TOP 1 OrdCodigoOrden, OrdMaterialPlanilla, OrdNombreTrabajo FROM dbo.OrdenesDeposito WHERE OrdIdOrden = @OrdId2`);
                  const odFb = odFbR.recordset[0] || {};
                  const descFb = (odFb.OrdMaterialPlanilla || odFb.OrdNombreTrabajo || ap.descripcion || 'Servicio').substring(0, 190);
                  await new sql.Request(transaction)
                    .input('DocId3', sql.Int,           docId)
                    .input('OrdCod', sql.VarChar(50),   odFb.OrdCodigoOrden || null)
                    .input('desc',   sql.VarChar(200),  descFb)
                    .input('neto',   sql.Decimal(18,4), neto)
                    .input('imp',    sql.Decimal(18,4), iva)
                    .input('tot',    sql.Decimal(18,4), bruto)
                    .query(`
                      INSERT INTO dbo.DocumentosContablesDetalle
                        (DocIdDocumento, OrdCodigoOrden, DcdNomItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal)
                      VALUES (@DocId3, @OrdCod, @desc, 1, @tot, @neto, @imp, @tot)
                    `);
                }
              }
            } else {
              // RECIBO: deudas ya facturadas, una linea simple por aplicacion
              for (const app of aplicaciones) {
                const bruto = Number(app.montoOriginal) || 0;
                const desc  = (app.descripcion || app.codigoRef || 'Pago de deuda').substring(0, 190);
                if (bruto > 0) {
                  await new sql.Request(transaction)
                    .input('docId', sql.Int,           docId)
                    .input('desc',  sql.VarChar(200),  desc)
                    .input('tot',   sql.Decimal(18,4), bruto)
                    .query(`
                      INSERT INTO dbo.DocumentosContablesDetalle
                        (DocIdDocumento, DcdNomItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdTotal)
                      VALUES (@docId, @desc, 1, @tot, @tot, @tot)
                    `);
                }
              }
            }

            // Vincular PEDIDO CAJA a los DeudaDocumento de ordenes sin factura
            if (tieneOrdenSinFactura && sinFactura.length > 0) {
              for (const ap of sinFactura) {
                if (ap.ddeId) {
                  await new sql.Request(transaction)
                    .input("DocId", sql.Int, docId)
                    .input("DdeId", sql.Int, ap.ddeId)
                    .query(`
                      UPDATE dbo.DeudaDocumento
                      SET DocIdDocumento = @DocId
                      WHERE DDeIdDocumento = @DdeId AND DocIdDocumento IS NULL;

                      UPDATE m
                      SET m.DocIdDocumento = @DocId
                      FROM dbo.MovimientosCuenta m
                      JOIN dbo.DeudaDocumento d ON d.OrdIdOrden = m.OrdIdOrden
                      WHERE d.DDeIdDocumento = @DdeId
                        AND m.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
                        AND m.DocIdDocumento IS NULL;
                    `);
                }
              }
              logger.info("[PAGO-DEUDA] PEDIDO CAJA #" + docId + " vinculado a " + sinFactura.length + " DeudaDocumento(s).");

              // Insertar movimiento de débito VTA_CAJA en la cuenta del cliente para contrarrestar el PAGO
              // ya que la orden ya no debita el saldo por defecto hasta que se factura.
              try {
                const cueIdCuenta = sinFactura[0].cueIdCuenta;
                if (cueIdCuenta) {
                  await contabilidadSvc.registrarMovimiento({
                    CueIdCuenta: cueIdCuenta,
                    MovTipo: 'VTA_CAJA',
                    MovConcepto: 'Facturado (' + tipoDocVal + ' ' + serieTransaccion + '-' + docNumero + ')',
                    MovImporte: -docTotal, // débito por el total del Pedido Caja
                    MovUsuarioAlta: usuarioId,
                    DocIdDocumento: docId
                  }, transaction);
                  logger.info(`[PAGO-DEUDA] Movimiento VTA_CAJA insertado por ${docTotal} en cuenta ${cueIdCuenta}`);
                }
              } catch (eMov) {
                logger.error(`[PAGO-DEUDA] Error al insertar VTA_CAJA: ${eMov.message}`);
              }
            }
          }
        } catch (eDoc) {
          logger.error(`[PAGO-DEUDA] Error al generar Documento Contable: ${eDoc.message}`);
        }
      }

      for (const p of pagos) {
        if (!p.metodoPagoId || !p.montoOriginal) continue;
        await new sql.Request(transaction)
          .input('tcaId',   sql.Int,          tcaIdPago)
          .input('metodo',  sql.Int,          parseInt(p.metodoPagoId, 10))
          .input('moneda',  sql.Int,          parseInt(p.monedaId, 10) || 1)
          .input('monto',   sql.Decimal(18,4), Number(p.montoOriginal))
          .input('cot',     sql.Decimal(18,4), Number(p.cotizacion) || 1)
          .input('usuario', sql.Int,          usuarioId)
          .query(`
            INSERT INTO dbo.Pagos
              (PagTcaIdTransaccion, MPaIdMetodoPago, PagIdMonedaPago,
               PagMontoPago, PagFechaPago, PagUsuarioAlta, PagCotizacion,
               PagMontoConvertido, PagTipoMovimiento)
            VALUES
              (@tcaId, @metodo, @moneda,
               @monto, GETDATE(), @usuario, @cot,
               @monto, 'COBRO')
          `);
      }

      // ─────────────────────────────────────────────
      // DEBE: Caja (dinero que entra)
      // HABER: Clientes (reduce la cuenta por cobrar)
      if (totalImputado > 0) {
        try {
          const monedaId     = monedaBaseId;  // ya resuelto arriba con la moneda real de la deuda
          const monedaStr    = monedaBaseStr;
          const cotizacion   = Number(primerPagoBase?.cotizacion) || 1;
          await contabilidadCore.generarAsientoCompleto({
            concepto:         ("Pago deuda #" + header.clienteId + " - " + (header.observaciones || "Cobro cuenta corriente")).substring(0, 200),
            usuarioId,
            tcaIdTransaccion: tcaIdPago,
            origen:           'PAGO_DEUDA',
            lineas: [
              {
                // DEBE: Caja recibe el dinero
                codigoCuenta: monedaStr === 'USD' ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU,
                debeBase:  totalImputado,
                haberBase: 0,
                monedaId,
                cotizacion,
              },
              {
                // HABER: Reduce la deuda del cliente
                codigoCuenta: monedaStr === 'USD' ? contabilidadCore.CUENTAS.CLIENTE_USD : contabilidadCore.CUENTAS.CLIENTE_UYU,
                debeBase:  0,
                haberBase: totalImputado,
                monedaId,
                cotizacion,
                entidadId:   header.clienteId,
                entidadTipo: 'CLIENTE',
              },
            ],
          }, transaction);
        } catch (eAsiento) {
          logger.warn(`[PAGO-DEUDA] Asiento contable parcial: ${eAsiento.message}`);
          // ─────────────────────────────────────────────
        }
      }

      // ─────────────────────────────────────────────
      const oreId = header.ordenRetiroId ? parseInt(header.ordenRetiroId, 10) : null;
      if (oreId && !isNaN(oreId)) {
        // ─────────────────────────────────────────────
        const primerPagoRes = await new sql.Request(transaction)
          .input('TcaId', sql.Int, tcaIdPago)
          .query('SELECT TOP 1 PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @TcaId ORDER BY PagIdPago ASC');
        const primerPagoId = primerPagoRes.recordset[0]?.PagIdPago || null;

        const retRes = await new sql.Request(transaction)
          .input('RID', sql.Int, oreId)
          .query('SELECT OReEstadoActual FROM dbo.OrdenesRetiro WHERE OReIdOrdenRetiro = @RID');
        if (retRes.recordset.length) {
          const nuevoEst = retRes.recordset[0].OReEstadoActual === 1 ? 3 : 8;
          await new sql.Request(transaction)
            .input('RID',    sql.Int, oreId)
            .input('PagId',  sql.Int, primerPagoId)
            .input('Estado', sql.Int, nuevoEst)
            .query(`
              UPDATE dbo.OrdenesRetiro
              SET PagIdPago = @PagId, OReEstadoActual = @Estado,
                  OReFechaEstadoActual = GETDATE(), ORePasarPorCaja = 0
              WHERE OReIdOrdenRetiro = @RID;

              INSERT INTO dbo.HistoricoEstadosOrdenesRetiro
                (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
              VALUES (@RID, @Estado, GETDATE(), ${usuarioId});
            `);
          logger.info(`[PAGO-DEUDA] OrdenRetiro ${oreId} -> estado ${nuevoEst}, PagId=${primerPagoId}`);
        }



      }

      await transaction.commit();
      logger.info(`[PAGO-DEUDA] Cli=${header.clienteId} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â ${aplicaciones.length} deuda(s) ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Total: ${totalImputado}`);

      const s = io(req); if (s) s.emit('actualizado', { type: 'pago-deuda' });

      return res.status(201).json({
        success: true,
        totalImputado,
        deudasCanceladas: aplicaciones.length,
        message: `Pago registrado: $ ${totalImputado.toFixed(2)} imputado en ${aplicaciones.length} deuda(s).`,
        docId,
        docNumero,
        docTipoStr
      });

    } catch (errTx) {
      await transaction.rollback();
      throw errTx;
    }
  } catch (err) {
    logger.error('[PAGO-DEUDA]', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// POST /contabilidad/caja/nota-credito
// Body: { docIdOrigen, monto, motivo, clienteId, cuentaId, monedaId }
const generarNotaCredito = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  try {
    const { docIdOrigen, monto, motivo, clienteId, cuentaId, monedaId, Lineas, Totales } = req.body;
    if (!docIdOrigen || !clienteId || !cuentaId)
      return res.status(400).json({ error: 'Faltan parámetros: docIdOrigen, clienteId, cuentaId' });

    const pool = await getPool();
    const transaction = pool.transaction();
    await transaction.begin();
    try {
      const docR = await new sql.Request(transaction)
        .input('DocId', sql.Int, parseInt(docIdOrigen))
        .query(`SELECT DocTipo, DocSerie, DocNumero, DocTotal, MonIdMoneda, CueIdCuenta, DocSubtotal, DocImpuestos, DocTotalDescuentos, DocTotalRecargos, CliIdCliente
                FROM dbo.DocumentosContables WHERE DocIdDocumento = @DocId`);
      if (!docR.recordset.length) throw new Error('Documento origen no encontrado');
      const docOrigen = docR.recordset[0];

      // ─────────────────────────────────────────────
      let montoNum = Totales ? Number(Totales.total) : Number(monto);
      if (isNaN(montoNum) || montoNum <= 0) {
        // Fallback si no viene monto ni Totales
        montoNum = Number(docOrigen.DocTotal) || 0;
      }

      if (montoNum > Number(docOrigen.DocTotal)) {
        throw new Error(`El total de la Nota de Crédito (${montoNum}) no puede superar al total del documento original (${docOrigen.DocTotal})`);
      }

      // '10' = E-Ticket Nota De Credito, '04' = E-Factura Nota De Credito
      const esETicket = !docOrigen.DocTipo?.toUpperCase().includes('FACTURA');
      const codNC = esETicket ? '10' : '04';

      const seqR = await new sql.Request(transaction)
        .input('CodDoc', sql.VarChar(10), codNC)
        .query(`SELECT s.SecIdSecuencia, s.SecPrefijo, s.SecSerie, s.SecDigitos, c.Detalle
                FROM Config_TiposDocumento c
                JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
                WHERE c.CodDocumento = @CodDoc AND s.SecActivo = 1`);
      if (!seqR.recordset.length) throw new Error(`Sin secuencia para NC (${codNC})`);
      const seq = seqR.recordset[0];

      const numR = await new sql.Request(transaction)
        .input('SecId', sql.Int, seq.SecIdSecuencia)
        .query(`UPDATE SecuenciaDocumentos SET SecUltimoNumero = SecUltimoNumero + 1
                OUTPUT INSERTED.SecSerie AS Serie,
                       RIGHT(REPLICATE('0', INSERTED.SecDigitos) + CAST(INSERTED.SecUltimoNumero AS VARCHAR(10)), INSERTED.SecDigitos) AS NumeroSolo
                WHERE SecIdSecuencia = @SecId`);
      const ncSerie  = numR.recordset[0].Serie || seq.SecSerie || 'NC';
      const ncNumero = numR.recordset[0].NumeroSolo;
      const ncTipo   = (seq.Detalle?.trim() || 'Nota de Credito').substring(0, 20);
      const monId    = parseInt(monedaId) || docOrigen.MonIdMoneda || 1;
      const cueId    = parseInt(cuentaId) || docOrigen.CueIdCuenta;

      // ─────────────────────────────────────────────
      const CONSUMIDOR_FINAL_ID = 2089;
      const cliIdNum = parseInt(clienteId) || docOrigen.CliIdCliente;
      const esConsumidorFinalGenerico = cliIdNum === CONSUMIDOR_FINAL_ID;

      // Buscar la cuenta corriente real del cliente para la moneda correspondiente
      const tipoCtaReal = monId === 2 ? 'DINERO_USD' : 'DINERO_UYU';
      let cueIdReal = null;
      if (!esConsumidorFinalGenerico) {
        const contabilidadService = require('../services/contabilidadService');
        cueIdReal = await contabilidadService.obtenerOCrearCuenta(cliIdNum, tipoCtaReal, {
            MonIdMoneda: monId,
            UsuarioAlta: usuarioId
        }, transaction);
        if (!cueIdReal) {
          throw new Error('El cliente no tiene una cuenta corriente activa para esta moneda.');
        }
      }

      const subtotalVal = Totales ? Number(Totales.subtotal) : (docOrigen.DocSubtotal || 0);
      const impuestosVal = Totales ? Number(Totales.iva) : (docOrigen.DocImpuestos || 0);
      const totalVal = Totales ? Number(Totales.total) : (docOrigen.DocTotal || 0);
      const totalDescVal = Totales ? 0 : (docOrigen.DocTotalDescuentos || 0);
      const totalRecVal = Totales ? 0 : (docOrigen.DocTotalRecargos || 0);

      const ncR = await new sql.Request(transaction)
        .input('Cue',   sql.Int,           cueId)
        .input('Cli',   sql.Int,           parseInt(clienteId) || docOrigen.CliIdCliente)
        .input('Tipo',  sql.VarChar(20),   ncTipo)
        .input('Num',   sql.VarChar(20),   ncNumero)
        .input('Serie', sql.VarChar(10),   ncSerie)
        .input('MonId', sql.Int,           monId)
        .input('Usr',   sql.Int,           usuarioId)
        .input('DocRef',sql.Int,           parseInt(docIdOrigen))
        .input('Motivo',sql.NVarChar(300), motivo || 'Nota de crédito')
        .input('Subtotal', sql.Decimal(18,2), subtotalVal)
        .input('TotalDescuentos', sql.Decimal(18,2), totalDescVal)
        .input('TotalRecargos', sql.Decimal(18,2), totalRecVal)
        .input('Total', sql.Decimal(18,2), totalVal)
        .input('Impuestos', sql.Decimal(18,2), impuestosVal)
        .query(`INSERT INTO dbo.DocumentosContables
                  (CueIdCuenta,CliIdCliente,MonIdMoneda,DocTipo,DocNumero,DocSerie,
                   DocSubtotal,DocTotalDescuentos,DocTotalRecargos,DocTotal,DocImpuestos,
                   DocEstado,CfeEstado,DocFechaEmision,DocUsuarioAlta,DocObservaciones,DocIdDocumentoRef,DocMotivoRef,DocPagado)
                OUTPUT INSERTED.DocIdDocumento
                VALUES (@Cue,@Cli,@MonId,@Tipo,@Num,@Serie,
                        @Subtotal,@TotalDescuentos,@TotalRecargos,@Total,@Impuestos,
                        'COBRADO','PENDIENTE',GETDATE(),@Usr,@Motivo,@DocRef,@Motivo,1)`);
      const ncId = ncR.recordset[0].DocIdDocumento;

      if (Array.isArray(Lineas) && Lineas.length > 0) {
        for (const linea of Lineas) {
          const cant = parseFloat(linea.cantidad) || 0;
          const precio = parseFloat(linea.precioUnitario) || 0;
          const ivaRate = parseFloat(linea.iva) || 22;
          const lineTotal = cant * precio;
          const lineNeto = lineTotal / (1 + ivaRate / 100);
          const lineIva = lineTotal - lineNeto;

          const reqLine = new sql.Request(transaction);
          await reqLine
            .input('DocId', sql.Int, ncId)
            .input('Nom', sql.NVarChar(255), (linea.concepto || '').substring(0, 255))
            .input('Dsc', sql.NVarChar(255), (linea.DcdDscItem || '').substring(0, 255))
            .input('Cant', sql.Decimal(18, 4), cant)
            .input('Precio', sql.Decimal(18, 4), precio)
            .input('Sub', sql.Decimal(18, 2), lineNeto)
            .input('Imp', sql.Decimal(18, 2), lineIva)
            .input('Tot', sql.Decimal(18, 2), lineTotal)
            .input('TotalDescuentos', sql.Decimal(18,2), 0)
            .input('DescuentoStr', sql.VarChar(50), '')
            .query(`INSERT INTO dbo.DocumentosContablesDetalle
                      (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr)
                    VALUES (@DocId, @Nom, @Dsc, @Cant, @Precio, @Sub, @Imp, @Tot, @TotalDescuentos, @DescuentoStr)`);
        }
      } else {
        await new sql.Request(transaction)
          .input('DocId', sql.Int,          ncId)
          .input('DocRef',sql.Int,          parseInt(docIdOrigen))
          .query(`INSERT INTO dbo.DocumentosContablesDetalle
                    (DocIdDocumento, OrdCodigoOrden, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr)
                  SELECT 
                    @DocId, OrdCodigoOrden, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr
                  FROM dbo.DocumentosContablesDetalle
                  WHERE DocIdDocumento = @DocRef`);
      }

      const fullNcNumero = `${ncSerie}-${ncNumero}`;

      // ─────────────────────────────────────────────
      if (!esConsumidorFinalGenerico) {
        // Registro centralizado: saldo calculado por SP, no a mano
        await contabilidadSvc.registrarMovimiento({
          CueIdCuenta:    cueIdReal,
          MovTipo:        'NOTA_CREDITO',
          MovConcepto:    motivo || `NC ${fullNcNumero}`,
          MovImporte:     montoNum,
          MovUsuarioAlta: usuarioId,
          DocIdDocumento: ncId,
        }, transaction);

        // NC reduce la deuda del documento al que hace referencia
        await contabilidadSvc.reducirDeuda({ docId: parseInt(docIdOrigen), monto: montoNum }, transaction);
      }

      // ─────────────────────────────────────────────
      // ─────────────────────────────────────────────
      try {
        const lineasNc = await contabilidadCore.resolverLineasDesdeMotor('NOTA_CREDITO', {
          moneda: monedaId === 2 ? 'USD' : 'UYU',
          cotizacion: 1,
          clienteId,
          totalNeto: montoNum,
          totalBruto: montoNum,
        });

        const cuentaCliente = monedaId === 2 ? contabilidadCore.CUENTAS.CLIENTE_USD : contabilidadCore.CUENTAS.CLIENTE_UYU;
        const cuentaVentas  = contabilidadCore.CUENTAS.VENTA_SERV;

        const lineas = lineasNc.length >= 2 ? lineasNc : [
          { codigoCuenta: cuentaVentas,  debeBase: montoNum, haberBase: 0, monedaId, cotizacion: 1, entidadId: clienteId, entidadTipo: 'CLIENTE' },
          { codigoCuenta: cuentaCliente, debeBase: 0, haberBase: montoNum, monedaId, cotizacion: 1, entidadId: clienteId, entidadTipo: 'CLIENTE' },
        ];

        await contabilidadCore.generarAsientoCompleto({
          concepto: `Nota de Crédito ${fullNcNumero} - ${motivo || 'Reverso'}`,
          usuarioId,
          tcaIdTransaccion: null,
          origen: 'NOTA_CREDITO',
          lineas,
        }, transaction);
      } catch (eAsiento) {
        logger.warn(`[NOTA-CREDITO] Asiento contable no generado: ${eAsiento.message}`);
      }

      await transaction.commit();
      logger.info(`[NOTA-CREDITO] Doc #${docIdOrigen} -> NC #${ncId} (${fullNcNumero}) Monto:${montoNum}`);
      const s = io(req); if (s) s.emit('actualizado', { type: 'nota-credito' });
      return res.status(201).json({ success: true, ncId, ncNumero: fullNcNumero, ncTipo, message: `Nota de Crédito ${fullNcNumero} generada` });
    } catch (errTx) { await transaction.rollback(); throw errTx; }
  } catch (err) { logger.error('[NOTA-CREDITO]', err.message); return res.status(500).json({ error: err.message }); }
};

// ─────────────────────────────────────────────
// POST /contabilidad/caja/nota-debito
// Body: { docIdOrigen, monto, motivo, clienteId, cuentaId, monedaId, Lineas, Totales }
const generarNotaDebito = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  try {
    const { docIdOrigen, monto, motivo, clienteId, cuentaId, monedaId, Lineas, Totales } = req.body;
    if (!docIdOrigen || !clienteId || !cuentaId)
      return res.status(400).json({ error: 'Faltan parámetros: docIdOrigen, clienteId, cuentaId' });

    const pool = await getPool();
    const transaction = pool.transaction();
    await transaction.begin();
    try {
      const docR = await new sql.Request(transaction)
        .input('DocId', sql.Int, parseInt(docIdOrigen))
        .query(`SELECT DocTipo, DocSerie, DocNumero, DocTotal, MonIdMoneda, CueIdCuenta, DocSubtotal, DocImpuestos, DocTotalDescuentos, DocTotalRecargos, CliIdCliente
                FROM dbo.DocumentosContables WHERE DocIdDocumento = @DocId`);
      if (!docR.recordset.length) throw new Error('Documento origen no encontrado');
      const docOrigen = docR.recordset[0];

      // ─────────────────────────────────────────────
      let montoNum = Totales ? Number(Totales.total) : Number(monto);
      if (isNaN(montoNum) || montoNum <= 0) {
        montoNum = Number(docOrigen.DocTotal) || 0;
      }

      if (montoNum > Number(docOrigen.DocTotal)) {
        throw new Error(`El total de la Nota de Débito (${montoNum}) no puede superar al total del documento original (${docOrigen.DocTotal})`);
      }

      // '11' = E-Ticket Nota De Debito, '06' = E-Factura Nota De Debito
      const esETicket = !docOrigen.DocTipo?.toUpperCase().includes('FACTURA');
      const codND = esETicket ? '11' : '06';

      const seqR = await new sql.Request(transaction)
        .input('CodDoc', sql.VarChar(10), codND)
        .query(`SELECT s.SecIdSecuencia, s.SecPrefijo, s.SecSerie, s.SecDigitos, c.Detalle
                FROM Config_TiposDocumento c
                JOIN SecuenciaDocumentos s ON c.SecIdSecuencia = s.SecIdSecuencia
                WHERE c.CodDocumento = @CodDoc AND s.SecActivo = 1`);
      if (!seqR.recordset.length) throw new Error(`Sin secuencia para ND (${codND})`);
      const seq = seqR.recordset[0];

      const numR = await new sql.Request(transaction)
        .input('SecId', sql.Int, seq.SecIdSecuencia)
        .query(`UPDATE SecuenciaDocumentos SET SecUltimoNumero = SecUltimoNumero + 1
                OUTPUT INSERTED.SecSerie AS Serie,
                       RIGHT(REPLICATE('0', INSERTED.SecDigitos) + CAST(INSERTED.SecUltimoNumero AS VARCHAR(10)), INSERTED.SecDigitos) AS NumeroSolo
                WHERE SecIdSecuencia = @SecId`);
      const ndSerie  = numR.recordset[0].Serie || seq.SecSerie || 'ND';
      const ndNumero = numR.recordset[0].NumeroSolo;
      const ndTipo   = (seq.Detalle?.trim() || 'Nota de Debito').substring(0, 20);
      const monId    = parseInt(monedaId) || docOrigen.MonIdMoneda || 1;
      const cueId    = parseInt(cuentaId) || docOrigen.CueIdCuenta;

      // ─────────────────────────────────────────────
      const CONSUMIDOR_FINAL_ID = 2089;
      const cliIdNum = parseInt(clienteId) || docOrigen.CliIdCliente;
      const esConsumidorFinalGenerico = cliIdNum === CONSUMIDOR_FINAL_ID;

      // Buscar la cuenta corriente real del cliente para la moneda correspondiente
      const tipoCtaReal = monId === 2 ? 'DINERO_USD' : 'DINERO_UYU';
      let cueIdReal = null;
      if (!esConsumidorFinalGenerico) {
        const contabilidadSvc = require('../services/contabilidadService');
        cueIdReal = await contabilidadSvc.obtenerOCrearCuenta(cliIdNum, tipoCtaReal, {
            MonIdMoneda: monId,
            UsuarioAlta: usuarioId
        }, transaction);
        if (!cueIdReal) {
          throw new Error('El cliente no tiene una cuenta corriente activa para esta moneda.');
        }
      }

      const subtotalVal = Totales ? Number(Totales.subtotal) : (docOrigen.DocSubtotal || 0);
      const impuestosVal = Totales ? Number(Totales.iva) : (docOrigen.DocImpuestos || 0);
      const totalVal = Totales ? Number(Totales.total) : (docOrigen.DocTotal || 0);
      const totalDescVal = Totales ? 0 : (docOrigen.DocTotalDescuentos || 0);
      const totalRecVal = Totales ? 0 : (docOrigen.DocTotalRecargos || 0);

      const ndR = await new sql.Request(transaction)
        .input('Cue',   sql.Int,           cueId)
        .input('Cli',   sql.Int,           parseInt(clienteId) || docOrigen.CliIdCliente)
        .input('Tipo',  sql.VarChar(20),   ndTipo)
        .input('Num',   sql.VarChar(20),   ndNumero)
        .input('Serie', sql.VarChar(10),   ndSerie)
        .input('MonId', sql.Int,           monId)
        .input('Usr',   sql.Int,           usuarioId)
        .input('DocRef',sql.Int,           parseInt(docIdOrigen))
        .input('Motivo',sql.NVarChar(300), motivo || 'Nota de débito')
        .input('Subtotal', sql.Decimal(18,2), subtotalVal)
        .input('TotalDescuentos', sql.Decimal(18,2), totalDescVal)
        .input('TotalRecargos', sql.Decimal(18,2), totalRecVal)
        .input('Total', sql.Decimal(18,2), totalVal)
        .input('Impuestos', sql.Decimal(18,2), impuestosVal)
        .query(`INSERT INTO dbo.DocumentosContables
                  (CueIdCuenta,CliIdCliente,MonIdMoneda,DocTipo,DocNumero,DocSerie,
                   DocSubtotal,DocTotalDescuentos,DocTotalRecargos,DocTotal,DocImpuestos,
                   DocEstado,CfeEstado,DocFechaEmision,DocUsuarioAlta,DocObservaciones,DocIdDocumentoRef,DocMotivoRef,DocPagado)
                OUTPUT INSERTED.DocIdDocumento
                VALUES (@Cue,@Cli,@MonId,@Tipo,@Num,@Serie,
                        @Subtotal,@TotalDescuentos,@TotalRecargos,@Total,@Impuestos,
                        'PENDIENTE','PENDIENTE',GETDATE(),@Usr,@Motivo,@DocRef,@Motivo,0)`);
      const ndId = ndR.recordset[0].DocIdDocumento;

      if (Array.isArray(Lineas) && Lineas.length > 0) {
        for (const linea of Lineas) {
          const cant = parseFloat(linea.cantidad) || 0;
          const precio = parseFloat(linea.precioUnitario) || 0;
          const ivaRate = parseFloat(linea.iva) || 22;
          const lineTotal = cant * precio;
          const lineNeto = lineTotal / (1 + ivaRate / 100);
          const lineIva = lineTotal - lineNeto;

          const reqLine = new sql.Request(transaction);
          await reqLine
            .input('DocId', sql.Int, ndId)
            .input('Nom', sql.NVarChar(255), (linea.concepto || '').substring(0, 255))
            .input('Dsc', sql.NVarChar(255), (linea.DcdDscItem || '').substring(0, 255))
            .input('Cant', sql.Decimal(18, 4), cant)
            .input('Precio', sql.Decimal(18, 4), precio)
            .input('Sub', sql.Decimal(18, 2), lineNeto)
            .input('Imp', sql.Decimal(18, 2), lineIva)
            .input('Tot', sql.Decimal(18, 2), lineTotal)
            .input('TotalDescuentos', sql.Decimal(18,2), 0)
            .input('DescuentoStr', sql.VarChar(50), '')
            .query(`INSERT INTO dbo.DocumentosContablesDetalle
                      (DocIdDocumento, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr)
                    VALUES (@DocId, @Nom, @Dsc, @Cant, @Precio, @Sub, @Imp, @Tot, @TotalDescuentos, @DescuentoStr)`);
        }
      } else {
        await new sql.Request(transaction)
          .input('DocId', sql.Int,          ndId)
          .input('DocRef',sql.Int,          parseInt(docIdOrigen))
          .query(`INSERT INTO dbo.DocumentosContablesDetalle
                    (DocIdDocumento, OrdCodigoOrden, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr)
                  SELECT 
                    @DocId, OrdCodigoOrden, DcdNomItem, DcdDscItem, DcdCantidad, DcdPrecioUnitario, DcdSubtotal, DcdImpuestos, DcdTotal, DcdTotalDescuentos, DcdDescuentoStr
                  FROM dbo.DocumentosContablesDetalle
                  WHERE DocIdDocumento = @DocRef`);
      }

      const fullNdNumero = `${ndSerie}-${ndNumero}`;

      // ─────────────────────────────────────────────
      if (!esConsumidorFinalGenerico) {
        // ─────────────────────────────────────────────
        // Registro centralizado: saldo calculado por SP, no a mano
        await contabilidadSvc.registrarMovimiento({
          CueIdCuenta:    cueIdReal,
          MovTipo:        'NOTA_DEBITO',
          MovConcepto:    motivo || `ND ${fullNdNumero}`,
          MovImporte:     -montoNum,    // negativo: genera deuda al cliente
          MovUsuarioAlta: usuarioId,
          DocIdDocumento: ndId,
        }, transaction);

        // ─────────────────────────────────────────────
        // ND: crear nueva deuda con la función centralizada
        await contabilidadSvc.crearDeudaDocumento({
          CueIdCuenta:    cueIdReal,
          DocIdDocumento: ndId,
          Importe:        montoNum,
        }, transaction);
        /*
          --- bloque SQL original reemplazado ---
        await new sql.Request(transaction)
          .input('Cue', sql.Int, cueIdReal)
          .input('DocId', sql.Int, ndId)
          .input('Monto', sql.Decimal(18, 4), montoNum)
          .query(`
            INSERT INTO dbo.DeudaDocumento
              (CueIdCuenta, DocIdDocumento, DDeImporteOriginal, DDeImportePendiente, DDeFechaEmision, DDeFechaVencimiento, DDeEstado)
            VALUES
              (@Cue, @DocId, @Monto, @Monto, GETDATE(), DATEADD(DAY, 7, GETDATE()), 'PENDIENTE')
          `);
        --- fin bloque SQL original ---
        */
      }

      // Asiento Contable
      try {
        const contabilidadCore = require('../services/contabilidadCore');
        const cuentaCliente = monId === 2 ? contabilidadCore.CUENTAS.CLIENTE_USD : contabilidadCore.CUENTAS.CLIENTE_UYU;
        const cuentaVentas  = contabilidadCore.CUENTAS.VENTA_SERV;

        const lineas = [
          { codigoCuenta: cuentaCliente, debeBase: montoNum, haberBase: 0, monedaId: monId, cotizacion: 1, entidadId: clienteId, entidadTipo: 'CLIENTE' },
          { codigoCuenta: cuentaVentas,  debeBase: 0, haberBase: montoNum, monedaId: monId, cotizacion: 1, entidadId: clienteId, entidadTipo: 'CLIENTE' },
        ];

        await contabilidadCore.generarAsientoCompleto({
          concepto: `Nota de Débito ${fullNdNumero} - ${motivo || 'Reverso NC'}`,
          usuarioId,
          tcaIdTransaccion: null,
          origen: 'NOTA_DEBITO',
          lineas,
        }, transaction);
      } catch (eAsiento) {
        logger.warn(`[NOTA-DEBITO] Asiento contable no generado: ${eAsiento.message}`);
      }

      await transaction.commit();
      logger.info(`[NOTA-DEBITO] Doc #${docIdOrigen} -> ND #${ndId} (${fullNdNumero}) Monto:${montoNum}`);
      const s = io(req); if (s) s.emit('actualizado', { type: 'nota-debito' });
      return res.status(201).json({ success: true, ndId, ndNumero: fullNdNumero, ndTipo, message: 'Nota de Debito ' + fullNdNumero + ' generada' });
    } catch (errTx) { await transaction.rollback(); throw errTx; }
  } catch (err) { logger.error('[NOTA-DEBITO]', err.message); return res.status(500).json({ error: err.message }); }
};

// ─────────────────────────────────────────────
// POST /contabilidad/caja/reversar-doc
// ─────────────────────────────────────────────
const reversarDocumento = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  try {
    const { docId, clienteId, cuentaId, motivo } = req.body;
    if (!docId || !clienteId || !cuentaId)
      return res.status(400).json({ error: 'Faltan parámetros: docId, clienteId, cuentaId' });

    const pool = await getPool();
    const docR = await pool.request()
      .input('DocId', sql.Int, parseInt(docId))
      .query(`SELECT DocTipo, DocSerie, DocNumero, DocTotal, MonIdMoneda, DocPagado, DocEstado, CfeEstado
              FROM dbo.DocumentosContables WHERE DocIdDocumento=@DocId`);
    if (!docR.recordset.length) return res.status(404).json({ error: 'Documento no encontrado' });
    const doc = docR.recordset[0];
    if (doc.DocEstado === 'ANULADO') return res.status(400).json({ error: 'El documento ya está anulado' });

    // ─────────────────────────────────────────────
    if (doc.CfeEstado === 'ACEPTADO_DGI') {
      return res.status(400).json({
        error: 'Este documento ya fue aceptado por la DGI y no puede anularse directamente. Debe emitir una Nota de Crédito correctiva.'
      });
    }

    const monto  = Number(doc.DocTotal);
    const cueId  = parseInt(cuentaId);
    const docRef = parseInt(docId);

    // Determinar si el documento es una NC (en cuyo caso se resta en lugar de sumar)
    const esNotaCredito = (doc.DocTipo || '').toUpperCase().includes('NOTA DE CRE') ||
                          (doc.DocTipo || '').toUpperCase().includes('NOTA_CREDITO') ||
                          (doc.DocTipo || '').toUpperCase().includes('NOTA DE ÉDITO');
    const ajusteImporte = esNotaCredito ? -monto : monto;

    await pool.request()
      .input('DocId', sql.Int, docRef)
      .query(`UPDATE dbo.DocumentosContables SET DocEstado='ANULADO' WHERE DocIdDocumento=@DocId`);

    // Registro centralizado — sin SQL crudo
    await contabilidadSvc.registrarMovimiento({
      CueIdCuenta:    cueId,
      MovTipo:        'REVERSO',
      MovConcepto:    motivo || `Reverso ${doc.DocTipo} ${doc.DocSerie}-${doc.DocNumero}`,
      MovImporte:     ajusteImporte,
      MovUsuarioAlta: usuarioId,
      DocIdDocumento: docRef,
    });

    // Reverso: cancelar la deuda del documento revertido
    await contabilidadSvc.cancelarDeuda({ docId: docRef });

    logger.info(`[REVERSAR-DOC] Doc #${docId} anulado`);
    const s = io(req); if (s) s.emit('actualizado', { type: 'reverso-doc' });
    return res.json({ success: true, message: `Documento ${doc.DocSerie}-${doc.DocNumero} revertido correctamente` });
  } catch (err) { logger.error('[REVERSAR-DOC]', err.message); return res.status(500).json({ error: err.message }); }
};

// ─────────────────────────────────────────────
// POST /contabilidad/caja/pago-anticipo
// Body: { clienteId, cuentaId, importe, metodoPagoId, monedaId, concepto }
const registrarPagoAnticipo = async (req, res) => {
  const usuarioId = req.user?.id || 70;
  try {
    const { clienteId, cuentaId, importe, metodoPagoId, monedaId, concepto, admin } = req.body;
    if (!clienteId || !importe)
      return res.status(400).json({ error: 'Faltan parámetros: clienteId, importe' });
    const montoNum = Number(importe);
    if (montoNum <= 0) return res.status(400).json({ error: 'El importe debe ser mayor a 0' });

    const pool = await getPool();
    const transaction = pool.transaction();
    await transaction.begin();
    try {
      const monId  = parseInt(monedaId) || 1;
      const monStr = monId === 2 ? 'USD' : 'UYU';
      const cliId  = parseInt(clienteId);
      const conceptoFull = concepto || 'Pago anticipado cuenta corriente';

      // ─────────────────────────────────────────────
      let cueId = cuentaId ? parseInt(cuentaId) : null;
      if (!cueId) {
        const tipoCuenta = monStr === 'USD' ? 'DINERO_USD' : 'DINERO_UYU';
        const cueR = await new sql.Request(transaction)
          .input('Cli', sql.Int, cliId)
          .input('Tipo', sql.VarChar(20), tipoCuenta)
          .query(`SELECT TOP 1 CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente=@Cli AND CueTipo=@Tipo AND CueActiva=1`);
        if (cueR.recordset.length) {
          cueId = cueR.recordset[0].CueIdCuenta;
        } else {
          // Crear la cuenta si no existe
          const newCue = await new sql.Request(transaction)
            .input('Cli',   sql.Int,          cliId)
            .input('Tipo',  sql.VarChar(20),  tipoCuenta)
            .input('MonId', sql.Int,          monId)
            .input('Usr',   sql.Int,          usuarioId)
            .query(`INSERT INTO dbo.CuentasCliente
                      (CliIdCliente, CPaIdCondicion, CueTipo, MonIdMoneda,
                       CueSaldoActual, CueLimiteCredito, CuePuedeNegativo,
                       CueCicloActivo, CueActiva, CueFechaAlta, CueUsuarioAlta)
                    OUTPUT INSERTED.CueIdCuenta
                    VALUES(@Cli, 1, @Tipo, @MonId, 0, 0, 0, 0, 1, GETDATE(), @Usr)`);
          cueId = newCue.recordset[0].CueIdCuenta;
          logger.info(`[ANTICIPO] Cuenta ${tipoCuenta} creada automáticamente (CueId=${cueId}) para Cli=${cliId}`);
        }
      }

      // ─────────────────────────────────────────────

      let sesionId = null;
      if (!admin) {
        try {
          const sesR = await new sql.Request(transaction)
            .query(`SELECT TOP 1 StuIdSesion FROM dbo.SesionesTurno WHERE StuEstado='ABIERTA' ORDER BY StuFechaApertura DESC`);
          if (sesR.recordset.length) sesionId = sesR.recordset[0].StuIdSesion;
        } catch {}
      }

      // ─────────────────────────────────────────────
      const nDocR = await new sql.Request(transaction)
        .query(`SELECT ISNULL(MAX(TcaNumeroDoc),0)+1 AS N FROM dbo.TransaccionesCaja WHERE TcaTipoDocumento='ANTICIPO'`);
      const tcaNum = String(nDocR.recordset[0].N);

      const tcaR = await new sql.Request(transaction)
        .input('Ses',  sql.Int,           sesionId)
        .input('Usr',  sql.Int,           usuarioId)
        .input('Cli',  sql.Int,           cliId)
        .input('Num',  sql.VarChar(20),   tcaNum)
        .input('Mon',  sql.VarChar(10),   monStr)
        .input('Monto',sql.Decimal(18,4), montoNum)
        .input('Obs',  sql.VarChar(500),  conceptoFull)
        .input('AdminFlag', sql.Bit, admin ? 1 : 0)
        .query(`INSERT INTO dbo.TransaccionesCaja
                  (StuIdSesion,TcaUsuarioId,TcaClienteId,TcaFecha,TcaTipoDocumento,TcaSerieDoc,TcaNumeroDoc,
                   TcaEstado,TcaTotalBruto,TcaTotalAjuste,TcaTotalNeto,TcaTotalCobrado,TcaMonedaBase,TcaObservaciones,EsCajaAdmin)
                OUTPUT INSERTED.TcaIdTransaccion
                VALUES(@Ses,@Usr,@Cli,GETDATE(),'ANTICIPO','A',@Num,'COBRADO',@Monto,0,@Monto,@Monto,@Mon,@Obs,@AdminFlag)`);
      const tcaId = tcaR.recordset[0].TcaIdTransaccion;

      // ─────────────────────────────────────────────
      if (metodoPagoId) {
        await new sql.Request(transaction)
          .input('Tca',  sql.Int,          tcaId)
          .input('Met',  sql.Int,          parseInt(metodoPagoId))
          .input('MonId',sql.Int,          monId)
          .input('Monto',sql.Decimal(18,4),montoNum)
          .input('Usr',  sql.Int,          usuarioId)
          .query(`INSERT INTO dbo.Pagos(PagTcaIdTransaccion,MPaIdMetodoPago,PagIdMonedaPago,PagMontoPago,PagFechaPago,PagUsuarioAlta,PagCotizacion,PagMontoConvertido,PagTipoMovimiento)
                  VALUES(@Tca,@Met,@MonId,@Monto,GETDATE(),@Usr,1,@Monto,'INGRESO')`);
      }

      // ─────────────────────────────────────────────
      let docId = null;
      try {
        const rCaja = await new sql.Request(transaction)
          .input('codCaja', sql.VarChar(20), monStr === 'USD' ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU)
          .query(`SELECT CueId FROM Cont_PlanCuentas WHERE CueCodigo = @codCaja`);
        const cueCaja = rCaja.recordset.length ? rCaja.recordset[0].CueId : 1;

        // ─────────────────────────────────────────────
        let metodoNombre = '';
        if (metodoPagoId) {
          const metR = await new sql.Request(transaction)
            .input('Met', sql.Int, parseInt(metodoPagoId))
            .query(`SELECT MPaDescripcionMetodo FROM dbo.MetodosPagos WHERE MPaIdMetodoPago=@Met`);
          if (metR.recordset.length) metodoNombre = metR.recordset[0].MPaDescripcionMetodo;
        }

        // Obtener secuencia propia del Recibo de Anticipo (serie 'RC', independiente de CFE)
        const seqAnticipo = await new sql.Request(transaction)
          .query(`
            IF NOT EXISTS (SELECT 1 FROM dbo.SecuenciaDocumentos WHERE SecTipoDoc = 'RECIBO_ANTICIPO' AND SecSerie = 'RC')
              INSERT INTO dbo.SecuenciaDocumentos (SecTipoDoc, SecSerie, SecPrefijo, SecDigitos, SecUltimoNumero, SecActivo)
              VALUES ('RECIBO_ANTICIPO', 'RC', 'RC-', 5, 0, 1);
            UPDATE dbo.SecuenciaDocumentos
            SET SecUltimoNumero = SecUltimoNumero + 1
            OUTPUT INSERTED.SecUltimoNumero
            WHERE SecTipoDoc = 'RECIBO_ANTICIPO' AND SecSerie = 'RC';
          `);
        const numAnticipo = seqAnticipo.recordset[0]?.SecUltimoNumero || parseInt(tcaNum) || 1;

        docId = await contabilidadCore.crearDocumentoContable({
          header: {
            cueIdCuenta:      cueCaja,
            clienteId:        cliId,
            monedaId:         monId,
            tipo:             'RECIBO ANTICIPO',
            numero:           String(numAnticipo),
            serie:            'RC',
            subtotal:         montoNum,
            impuestos:        0,
            total:            montoNum,
            estado:           'COBRADO',
            cfeEstado:        null,
            usuarioId:        usuarioId,
            tcaIdTransaccion: tcaId,
            observaciones:    (conceptoFull + (metodoNombre ? ' - ' + metodoNombre : '')).substring(0, 200),
            docPagado:        true
          },
          lineas: [{
            nomItem:        ('Anticipo: ' + conceptoFull).substring(0, 200),
            dscItem:        '',
            cantidad:       1,
            precioUnitario: montoNum,
            subtotal:       montoNum,
            impuestos:      0,
            total:          montoNum
          }]
        }, transaction);
      } catch (eDoc) {
        logger.error(`[ANTICIPO] Error al generar Documento Contable: ${eDoc.message}`);
      }

      // ─────────────────────────────────────────────
      let metodoDesc = '';
      if (metodoPagoId) {
        const metR2 = await new sql.Request(transaction)
          .input('Met', sql.Int, parseInt(metodoPagoId))
          .query(`SELECT MPaDescripcionMetodo FROM dbo.MetodosPagos WHERE MPaIdMetodoPago=@Met`);
        if (metR2.recordset.length) metodoDesc = ` (${metR2.recordset[0].MPaDescripcionMetodo})`;
      }

      const { MovIdGenerado: movId } = await contabilidadSvc.registrarMovimiento({
        CueIdCuenta:    cueId,
        MovTipo:        'ANTICIPO',
        MovConcepto:    `Pago: ${conceptoFull}${metodoDesc}`,
        MovImporte:     montoNum,
        MovUsuarioAlta: usuarioId,
        DocIdDocumento: docId,
      }, transaction);

      // ─────────────────────────────────────────────
      // DEBE: Caja (dinero que entra)
      // ─────────────────────────────────────────────
      try {
        await contabilidadCore.generarAsientoCompleto({
          concepto:         ('Anticipo #' + cliId + ' - ' + conceptoFull).substring(0, 200),
          usuarioId,
          tcaIdTransaccion: tcaId,
          origen:           'ANTICIPO',
          lineas: [
            {
              codigoCuenta: monStr === 'USD' ? contabilidadCore.CUENTAS.CAJA_USD : contabilidadCore.CUENTAS.CAJA_UYU,
              debeBase:  montoNum,
              haberBase: 0,
              monedaId: monId,
              cotizacion: 1,
            },
            {
              codigoCuenta: monStr === 'USD' ? contabilidadCore.CUENTAS.CLIENTE_USD : contabilidadCore.CUENTAS.CLIENTE_UYU,
              debeBase:  0,
              haberBase: montoNum,
              monedaId: monId,
              cotizacion: 1,
              entidadId:   cliId,
              entidadTipo: 'CLIENTE',
            },
          ],
        }, transaction);
      } catch (eAsiento) {
        logger.warn(`[ANTICIPO] Asiento contable parcial: ${eAsiento.message}`);
      }

      // ─────────────────────────────────────────────
      let deudasImputadas = 0;
      let montoImputado = 0;
      try {
        const deudasR = await new sql.Request(transaction)
          .input('Cue', sql.Int, cueId)
          .query(`SELECT DDeIdDocumento, DDeImportePendiente
                  FROM dbo.DeudaDocumento WITH(NOLOCK)
                  WHERE CueIdCuenta=@Cue AND DDeEstado IN ('PENDIENTE','PARCIAL') AND DDeImportePendiente > 0
                  ORDER BY DDeFechaEmision ASC`);

        let saldoDisponible = montoNum;
        for (const d of deudasR.recordset) {
          if (saldoDisponible <= 0) break;
          const pendiente = Number(d.DDeImportePendiente);
          const aplicar = Math.min(saldoDisponible, pendiente);
          const nuevoPend = Math.max(0, pendiente - aplicar);
          const nuevoEstado = nuevoPend < 0.01 ? 'COBRADO' : 'PARCIAL';

          // Imputar anticipo a deuda: centralizado
          await contabilidadSvc.reducirDeuda({ ddeId: d.DDeIdDocumento, monto: aplicar }, transaction);

          saldoDisponible -= aplicar;
          montoImputado += aplicar;
          deudasImputadas++;
          logger.info(`[ANTICIPO] Imputado ${aplicar.toFixed(2)} a deuda #${d.DDeIdDocumento} -> pendiente: ${nuevoPend.toFixed(2)} (${nuevoEstado})`);
        }
      } catch (eDeu) {
        logger.warn(`[ANTICIPO] Error al imputar deudas: ${eDeu.message}`);
      }

      await transaction.commit();
      const msgImputado = deudasImputadas > 0
        ? ` Se imputó ${monStr} ${montoImputado.toFixed(2)} contra ${deudasImputadas} deuda(s) pendiente(s).`
        : '';
      logger.info(`[ANTICIPO] Cli=${cliId} Cue=${cueId} Monto=${montoNum} DocId=${docId} TcaId=${tcaId}${msgImputado}`);
      const s = io(req); if (s) s.emit('actualizado', { type: 'anticipo' });
      return res.status(201).json({
        success: true, tcaId, docId, movId,
        message: `Anticipo ${monStr} ${montoNum.toFixed(2)} registrado correctamente.${msgImputado}`
      });
    } catch (errTx) { await transaction.rollback(); throw errTx; }
  } catch (err) { logger.error('[ANTICIPO]', err.message); return res.status(500).json({ error: err.message }); }
};

// ─────────────────────────────────────────────
// POST /contabilidad/caja/anular-factura
// Body: { docId, clienteId, cuentaId, motivo }
// Flujo:
//   1. Verifica que CfeEstado != 'ACEPTADO_DGI'
//   2. Marca DocumentosContables como ANULADO
//   3. Cancela DeudaDocumento
//   4. Anula el movimiento CIERRE_CICLO (MovAnulado=1, corrige saldo cuenta)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
const anularFactura = async (req, res) => {
  const usuarioId = req.user?.id || 1;
  try {
    const { docId, clienteId, cuentaId, motivo } = req.body;
    if (!docId || !cuentaId)
      return res.status(400).json({ error: 'Faltan parámetros: docId, cuentaId' });

    const pool = await getPool();

    // 1. Cargar el documento
    const docR = await pool.request()
      .input('DocId', sql.Int, parseInt(docId))
      .query(`SELECT DocTipo, DocSerie, DocNumero, DocTotal, MonIdMoneda,
                     DocEstado, CfeEstado, CicIdCiclo
              FROM dbo.DocumentosContables WHERE DocIdDocumento=@DocId`);
    if (!docR.recordset.length) return res.status(404).json({ error: 'Documento no encontrado' });
    const doc = docR.recordset[0];

    if (doc.DocEstado === 'ANULADO')
      return res.status(400).json({ error: 'El documento ya está anulado' });
    if (doc.CfeEstado === 'ACEPTADO_DGI')
      return res.status(400).json({ error: 'No se puede anular: el documento ya fue aceptado por DGI. Use Nota de Crédito.' });

    const docRef  = parseInt(docId);
    const cueId   = parseInt(cuentaId);
    const monto   = Number(doc.DocTotal || 0);
    const cicId   = doc.CicIdCiclo;
    const motivoFull = `Anulación ${doc.DocTipo} ${doc.DocSerie}-${doc.DocNumero}: ${motivo || 'Sin motivo'}`;

    const transaction = pool.transaction();
    await transaction.begin();
    try {
      // 2. Marcar documento ANULADO
      await new sql.Request(transaction)
        .input('DocId', sql.Int, docRef)
        .input('Mot', sql.NVarChar(300), motivoFull)
        .query(`UPDATE dbo.DocumentosContables
                SET DocEstado='ANULADO', DocObservaciones=COALESCE(DocObservaciones+' | ','')+@Mot
                WHERE DocIdDocumento=@DocId`);

      // 3. Cancelar DeudaDocumento
      await new sql.Request(transaction)
        .input('DocId', sql.Int, docRef)
        .query(`UPDATE dbo.DeudaDocumento
                SET DDeEstado='CANCELADA', DDeImportePendiente=0
                WHERE DocIdDocumento=@DocId`);

      // 4. Anular el movimiento original CIERRE_CICLO usando el helper centralizado
      await contabilidadSvc.anularMovimientosPorFiltro(
        { docId: docRef, excluirTipos: ['ORDEN', 'ENTREGA'] },
        transaction
      );

      // Registro centralizado del AJUSTE tras anular ciclo
      await contabilidadSvc.registrarMovimiento({
        CueIdCuenta:    cueId,
        MovTipo:        'AJUSTE',
        MovConcepto:    motivoFull,
        MovImporte:     monto,
        MovUsuarioAlta: usuarioId,
        DocIdDocumento: docRef,
        CicIdCiclo:     cicId || null,
      }, transaction);

      // 6. Marcar ciclo como ANULADO (NO reabrirlo) para mantener trazabilidad
      if (cicId) {
        await new sql.Request(transaction)
          .input('CicId', sql.Int, parseInt(cicId))
          .input('Mot', sql.NVarChar(300), motivoFull)
          .query(`UPDATE dbo.CiclosCredito
                  SET CicEstado='ANULADO',
                      CicObservaciones=COALESCE(CicObservaciones+' | ','')+@Mot
                  WHERE CicIdCiclo=@CicId`);

        // ─────────────────────────────────────────────
        //    para que puedan ser tomadas por un nuevo ciclo
        await new sql.Request(transaction)
          .input('CicId', sql.Int, parseInt(cicId))
          .query(`UPDATE dbo.MovimientosCuenta
                  SET CicIdCiclo=NULL
                  WHERE CicIdCiclo=@CicId
                    AND MovTipo IN ('ORDEN','ENTREGA')
                    AND MovAnulado=0`);

        // ─────────────────────────────────────────────
        const cicloActivoR = await new sql.Request(transaction)
          .input('Cue', sql.Int, cueId)
          .input('CicAnulado', sql.Int, parseInt(cicId))
        .input('CicAnulado', sql.Int, parseInt(cicId))
        .query(`SELECT TOP 1 CicIdCiclo FROM dbo.CiclosCredito
                WHERE CueIdCuenta=@Cue AND CicEstado='ABIERTO' AND CicIdCiclo<>@CicAnulado
                ORDER BY CicFechaInicio DESC`);

        if (cicloActivoR.recordset.length) {
          const nuevoCicId = cicloActivoR.recordset[0].CicIdCiclo;

          // ─────────────────────────────────────────────
          await new sql.Request(transaction)
            .input('NuevoCic', sql.Int, nuevoCicId)
            .input('Cue', sql.Int, cueId)
            .query(`UPDATE dbo.MovimientosCuenta
                    SET CicIdCiclo=@NuevoCic
                    WHERE CueIdCuenta=@Cue
                      AND CicIdCiclo IS NULL
                      AND MovTipo IN ('ORDEN','ENTREGA')
                      AND MovAnulado=0
                      AND MovFecha >= DATEADD(month, -2, GETDATE())`);

          // Recalcular totales del ciclo activo
          await new sql.Request(transaction)
            .input('CicId', sql.Int, nuevoCicId)
            .query(`UPDATE c SET
                      c.CicTotalOrdenes = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta WHERE CicIdCiclo=c.CicIdCiclo AND MovTipo IN ('ORDEN', 'ENTREGA', 'ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado=0)), 0),
                      c.CicTotalPagos   = ISNULL((SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta WHERE CicIdCiclo=c.CicIdCiclo AND MovTipo IN ('PAGO', 'PAGO_CRUZADO', 'ANTICIPO', 'COBRO', 'SALDO_A_FAVOR') AND (MovAnulado IS NULL OR MovAnulado=0)), 0)
                    FROM dbo.CiclosCredito c WHERE c.CicIdCiclo=@CicId`);

          logger.info(`[ANULAR-FACTURA] Órdenes reasignadas al ciclo activo #${nuevoCicId}. Totales recalculados.`);
        } else {
          logger.info(`[ANULAR-FACTURA] Ciclo #${cicId} marcado ANULADO. Órdenes liberadas (sin ciclo activo para reasignar).`);
        }
      }

      await transaction.commit();
      logger.info(`[ANULAR-FACTURA] Doc #${docId} (${doc.DocSerie}-${doc.DocNumero}) ANULADO. Ciclo #${cicId} cerrado como ANULADO.`);
      const s = io(req); if (s) s.emit('actualizado', { type: 'anular-factura', cicId });
      return res.json({
        success: true,
        message: `Factura ${doc.DocSerie}-${doc.DocNumero} anulada correctamente. Las órdenes quedan libres para ser tomadas por un nuevo ciclo.`,
        cicloAnulado: !!cicId,
      });
    } catch (errTx) { await transaction.rollback(); throw errTx; }
  } catch (err) { logger.error('[ANULAR-FACTURA]', err.message); return res.status(500).json({ error: err.message }); }
};

const guardarComprobante = async (req, res) => {
  const { nombreDocumento, pdfBase64 } = req.body;
  if (!nombreDocumento || !pdfBase64) {
    return res.status(400).json({ error: 'Faltan parametros nombreDocumento o pdfBase64' });
  }
  try {
    let subcarpeta = 'facturas';
    const nom = nombreDocumento.toUpperCase();
    if (nom.startsWith('EG-') || nom.startsWith('VC-'))      subcarpeta = 'egresos';
    else if (nom.startsWith('RC-') || nom.startsWith('REC-')) subcarpeta = 'recibos';
    else if (nom.startsWith('IG-'))                           subcarpeta = 'ingresos';
    else if (nom.startsWith('CIERRE-') || nom.startsWith('CC-')) subcarpeta = 'cierres';
    const filePath = pdfService.guardarDesdeBase64(nombreDocumento, pdfBase64, subcarpeta);
    logger.info("[COMPROBANTE] Guardado en servidor: " + filePath);
    return res.json({ success: true, path: filePath });
  } catch (err) {
    logger.error("[COMPROBANTE] Error al guardar: " + err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────

/** GET /api/contabilidad/caja/autorizaciones-sin-pago
 *  Devuelve registros de AutorizacionesSinPago con datos del retiro, cliente y usuario.
 *  Params opcionales: desde (ISO), hasta (ISO), sesionId (Int)
 */
const getAutorizacionesSinPago = async (req, res) => {
  try {
    const { desde, hasta, sesionId } = req.query;
    const pool = await getPool();
    const request = pool.request();

    let dateFilter = '';
    if (sesionId) {
      request.input('SesId', sql.Int, parseInt(sesionId, 10));
      dateFilter = `AND a.AuzFecha >= (SELECT StuFechaApertura FROM dbo.SesionesTurno WHERE StuIdSesion = @SesId)
                   AND (@SesId IS NULL OR a.AuzFecha <= COALESCE((SELECT StuFechaCierre FROM dbo.SesionesTurno WHERE StuIdSesion = @SesId), GETDATE()))`;
    } else if (desde) {
      request.input('Desde', sql.DateTime, new Date(desde));
      dateFilter = 'AND a.AuzFecha >= @Desde';
      if (hasta) {
        request.input('Hasta', sql.DateTime, new Date(hasta + 'T23:59:59'));
        dateFilter += ' AND a.AuzFecha <= @Hasta';
      }
    }

    const result = await request.query(`
      SELECT
        a.AuzIdAutorizacion,
        a.OReIdOrdenRetiro,
        COALESCE(r.FormaRetiro, 'R') + '-' + CAST(a.OReIdOrdenRetiro AS VARCHAR) AS OrdenCodigo,
        a.AuzFecha,
        a.AuzMotivo,
        a.AuzMontoDeuda,
        a.AuzFechaVencimiento,
        a.AuzEstado,
        a.AuzNotaGestion,
        u.Nombre AS NombreAutorizador,
        COALESCE(
          (SELECT TOP 1 LTRIM(RTRIM(cx.Nombre))
           FROM dbo.OrdenesDeposito odx WITH(NOLOCK)
           JOIN dbo.Clientes cx WITH(NOLOCK) ON cx.CliIdCliente = odx.CliIdCliente
           WHERE odx.OReIdOrdenRetiro = a.OReIdOrdenRetiro),
          (SELECT TOP 1 LTRIM(RTRIM(crx.Nombre))
           FROM dbo.Clientes crx WITH(NOLOCK)
           WHERE crx.CodCliente = r.CodCliente)
        ) AS NombreCliente,
        COALESCE(r.CodCliente, '') AS CodigoCliente,
        r.OReCostoTotalOrden,
        r.OReEstadoActual,
        er.EORNombreEstado AS EstadoRetiro,
        (
          SELECT rel.OrdIdOrden AS orderId,
                 od.OrdCodigoOrden AS codigo,
                 art.Descripcion AS producto,
                 CAST(od.OrdCantidad AS DECIMAL(10,2)) AS cantidad,
                 CAST(od.OrdCostoFinal AS FLOAT) AS monto,
                 mon.MonSimbolo AS moneda,
                 mo.MOrNombreModo AS modo,
                 od.OrdEstadoActual AS estado,
                 eo.EOrNombreEstado AS estadoNombre
          FROM dbo.RelOrdenesRetiroOrdenes rel WITH(NOLOCK)
          JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdIdOrden = rel.OrdIdOrden
          LEFT JOIN dbo.Monedas mon WITH(NOLOCK) ON mon.MonIdMoneda = od.MonIdMoneda
          LEFT JOIN dbo.Articulos art WITH(NOLOCK) ON art.ProIdProducto = od.ProIdProducto
          LEFT JOIN dbo.ModosOrdenes mo WITH(NOLOCK) ON mo.MOrIdModoOrden = od.MOrIdModoOrden
          LEFT JOIN dbo.EstadosOrdenes eo WITH(NOLOCK) ON eo.EOrIdEstadoOrden = od.OrdEstadoActual
          WHERE rel.OReIdOrdenRetiro = a.OReIdOrdenRetiro
          FOR JSON PATH
        ) AS OrdenesJSON,
        (
          SELECT COUNT(*)
          FROM dbo.RelOrdenesRetiroOrdenes rel WITH(NOLOCK)
          WHERE rel.OReIdOrdenRetiro = a.OReIdOrdenRetiro
        ) AS CantOrdenes
      FROM dbo.AutorizacionesSinPago a WITH(NOLOCK)
      LEFT JOIN dbo.OrdenesRetiro r WITH(NOLOCK) ON r.OReIdOrdenRetiro = a.OReIdOrdenRetiro
      LEFT JOIN dbo.EstadosOrdenesRetiro er WITH(NOLOCK) ON er.EORIdEstadoOrden = r.OReEstadoActual
      LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = a.AuzUsuarioId
      WHERE 1=1 ${dateFilter}
      ORDER BY a.AuzFecha DESC
    `);

    const data = result.recordset.map(row => ({
      ...row,
      Ordenes: row.OrdenesJSON ? JSON.parse(row.OrdenesJSON) : [],
      OrdenesJSON: undefined,
    }));
    res.json({ success: true, data });
  } catch (err) {
    logger.error('[CAJA] getAutorizacionesSinPago:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────

/** PUT /api/contabilidad/caja/autorizaciones-sin-pago/:id
 *  Actualiza estado de una autorización sin pago (Pendiente→Cobrado/Condonado).
 */
const gestionarAutorizacionSinPago = async (req, res) => {
  const { id } = req.params;
  const { estado, nota } = req.body;
  const usuarioId = req.user?.id || 70;

  const ESTADOS_VALIDOS = { Pendiente: 'ACTIVA', Cobrado: 'COBRADA', Condonado: 'CONDONADA' };
  if (!ESTADOS_VALIDOS[estado])
    return res.status(400).json({ success: false, error: 'Estado inválido. Valores: Pendiente, Cobrado, Condonado' });

  try {
    const pool = await getPool();
    await pool.request()
      .input('Id',       sql.Int,          parseInt(id, 10))
      .input('Estado',   sql.VarChar(20),   ESTADOS_VALIDOS[estado])
      .input('Nota',     sql.NVarChar(500), nota?.trim() || null)
      .input('Usr',      sql.Int,           usuarioId)
      .input('FechaCob', sql.DateTime,      estado === 'Cobrado' ? new Date() : null)
      .query(`
        UPDATE dbo.AutorizacionesSinPago
        SET AuzEstado       = @Estado,
            AuzFechaCobro   = @FechaCob,
            AuzNotaGestion  = @Nota
        WHERE AuzIdAutorizacion = @Id
      `);

    logger.info(`[CAJA] Autorización ${id} → ${estado} por usuario ${usuarioId}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('[CAJA] gestionarAutorizacionSinPago:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────
module.exports = {
  // Transacciones
  procesarTransaccion, procesarVentaDirecta, procesarPagoDeuda, getProductosVenta, anularTransaccion, getTransaccion, getHistorialCliente,
  // ─────────────────────────────────────────────
  getSesionActual, abrirSesion, cerrarSesion, getResumenSesion, getResumenDiario, getMovimientosTurno,
  // ─────────────────────────────────────────────
  getSiguienteNumero, getSecuencias,
  // Egresos e Ingresos
  registrarEgreso, getTiposEgreso, getVoucherEgreso, registrarIngresoGenerico,
  // Autorizaciones
  autorizarSinPago, getAutorizacionesSinPago, gestionarAutorizacionSinPago,
  // ─────────────────────────────────────────────
  registrarOperacionManual,
  // Operaciones desde Estado de Cuenta (Caja Administrativa)
  generarNotaCredito, generarNotaDebito, reversarDocumento, registrarPagoAnticipo, anularFactura,
  // Guardar Comprobantes en Servidor
  guardarComprobante,
};


// ─────────────────────────────────────────────
/**
 * POST /contabilidad/caja/imputar-anticipo-deuda
 * Usa el saldo a favor que ya tiene el cliente para cancelar una deuda específica.
 * NO ingresa plata nueva ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â solo mueve el saldo existente.
 */
async function imputarAnticipoADeuda(req, res) {
  const { cuentaId, ddeIdDocumento, monto, clienteId } = req.body;
  const usuarioId = req.user?.id || req.user?.UsrIdUsuario || 1;
  if (!cuentaId || !ddeIdDocumento) return res.status(400).json({ error: 'cuentaId y ddeIdDocumento son requeridos.' });
  const pool = await getPool();
  const transaction = pool.transaction();
  await transaction.begin();
  try {
    const cuentaR = await new sql.Request(transaction)
      .input('CueId', sql.Int, cuentaId)
      .query('SELECT CueSaldoActual, MonIdMoneda FROM dbo.CuentasCliente WITH(UPDLOCK) WHERE CueIdCuenta=@CueId');
    if (!cuentaR.recordset.length) throw new Error('Cuenta no encontrada.');
    const saldoActual = Number(cuentaR.recordset[0].CueSaldoActual);
    const monedaId = cuentaR.recordset[0].MonIdMoneda;
    if (saldoActual <= 0) throw new Error(`El cliente no tiene saldo a favor (saldo actual: ${saldoActual.toFixed(2)}).`);

    const deudaR = await new sql.Request(transaction)
      .input('DdeId', sql.Int, ddeIdDocumento)
      .input('CueId', sql.Int, cuentaId)
      .query('SELECT DDeImportePendiente, DDeEstado, DocIdDocumento FROM dbo.DeudaDocumento WITH(UPDLOCK) WHERE DDeIdDocumento=@DdeId AND CueIdCuenta=@CueId');
    if (!deudaR.recordset.length) throw new Error('Deuda no encontrada para esta cuenta.');
    const deuda = deudaR.recordset[0];
    if (!['PENDIENTE','PARCIAL'].includes(deuda.DDeEstado)) throw new Error(`La deuda ya está en estado: ${deuda.DDeEstado}`);

    const pendiente = Number(deuda.DDeImportePendiente);
    const montoAplicar = monto ? Math.min(Number(monto), pendiente, saldoActual) : Math.min(pendiente, saldoActual);
    if (montoAplicar <= 0.009) throw new Error('Monto a imputar debe ser mayor a 0.');
    const monStr = monedaId === 2 ? 'U$S' : '$';

    // Centralizado: reduce pendiente y maneja estado automáticamente
    await contabilidadSvc.reducirDeuda({ ddeId: ddeIdDocumento, monto: montoAplicar }, transaction);
    const nuevoPendiente = Math.max(0, pendiente - montoAplicar);
    const nuevoEstado = nuevoPendiente < 0.01 ? 'COBRADO' : 'PARCIAL';

    if (nuevoEstado === 'COBRADO' && deuda.DocIdDocumento) {
      await new sql.Request(transaction).input('DocId', sql.Int, deuda.DocIdDocumento)
        .query('UPDATE dbo.DocumentosContables SET DocPagado=1 WHERE DocIdDocumento=@DocId');
    }

    const resMov = await contabilidadSvc.registrarMovimiento({
      CueIdCuenta: cuentaId,
      MovTipo: 'PAGO',
      MovConcepto: `Imputación anticipo a deuda #${ddeIdDocumento}`,
      MovImporte: -montoAplicar,
      MovUsuarioAlta: usuarioId,
      DocIdDocumento: deuda.DocIdDocumento || null
    }, transaction);
    const saldoPosterior = resMov.SaldoResultante;

    await transaction.commit();
    logger.info(`[IMPUTAR-ANT] Cue=${cuentaId} Deuda=${ddeIdDocumento} Aplicado=${montoAplicar} SaldoRestante=${saldoPosterior}`);
    return res.json({ success: true, montoAplicado: montoAplicar, nuevoEstado, saldoRestante: saldoPosterior,
      message: `${monStr} ${montoAplicar.toFixed(2)} imputados. Deuda: ${nuevoEstado}. Saldo restante: ${monStr} ${saldoPosterior.toFixed(2)}` });
  } catch (err) {
    try { await transaction.rollback(); } catch(_) {}
    logger.error(`[IMPUTAR-ANT] ${err.message}`);
    return res.status(400).json({ error: err.message });
  }
}
module.exports.imputarAnticipoADeuda = imputarAnticipoADeuda;
module.exports.guardarComprobante = guardarComprobante;


// --- BANDEJA DOCUMENTOS INTERNOS (no-CFE) ------------------------------------
const getDocumentosInternos = async (req, res) => {
  try {
    const pool = await getPool();
    const { desde = null, hasta = null, tipo = 'TODOS', cliente = '', page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const fechaDesde = desde
      ? (() => { const [y,m,d] = desde.split('T')[0].split('-'); const dt = new Date(y,m-1,d); dt.setHours(0,0,0,0); return dt; })()
      : (() => { const dt = new Date(); dt.setDate(dt.getDate()-30); dt.setHours(0,0,0,0); return dt; })();
    const fechaHasta = hasta
      ? (() => { const [y,m,d] = hasta.split('T')[0].split('-'); const dt = new Date(y,m-1,d); dt.setHours(23,59,59,999); return dt; })()
      : (() => { const dt = new Date(); dt.setHours(23,59,59,999); return dt; })();
    const filtroCliente = cliente ? '%' + cliente.trim() + '%' : null;
    const r = pool.request()
      .input('FecDesde', sql.DateTime, fechaDesde)
      .input('FecHasta', sql.DateTime, fechaHasta)
      .input('Limit',    sql.Int, parseInt(limit))
      .input('Offset',   sql.Int, offset)
      .input('FiltroCliente', sql.NVarChar(200), filtroCliente);

    const clienteFilter = filtroCliente ? 'AND (c.Nombre LIKE @FiltroCliente OR c.NombreFantasia LIKE @FiltroCliente)' : '';
    const clienteFilterEgr = filtroCliente ? 'AND e.EgrProveedor LIKE @FiltroCliente' : '';

    const ingresoQ = `
      SELECT 'INGRESO' AS TipoOperacion, t.TcaIdTransaccion AS DocId, t.TcaFecha AS Fecha,
        ISNULL(ct1.Detalle, t.TcaTipoDocumento) AS TipoDoc, t.TcaTipoDocumento AS CodTipoDoc,
        ISNULL(t.TcaSerieDoc,'') AS Serie, ISNULL(t.TcaNumeroDoc,'') AS Numero,
        ISNULL(c.Nombre, 'Consumidor Final') AS ClienteNombre, t.TcaClienteId AS ClienteId,
        CASE WHEN p.PagIdMonedaPago = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
        SUM(p.PagMontoPago) AS Total, t.TcaEstado AS Estado,
        ISNULL(t.TcaObservaciones,'') AS Observaciones, mp.MPaDescripcionMetodo AS MetodoPago,
        COALESCE(u.Nombre, u.Usuario, 'Sistema') AS Usuario
      FROM dbo.TransaccionesCaja t WITH(NOLOCK)
      JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
      LEFT JOIN dbo.MetodosPagos mp WITH(NOLOCK) ON mp.MPaIdMetodoPago = p.MPaIdMetodoPago
      LEFT JOIN dbo.Config_TiposDocumento ct1 WITH(NOLOCK) ON ct1.CodDocumento = t.TcaTipoDocumento
      LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = t.TcaClienteId
      LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = t.TcaUsuarioId
      WHERE t.TcaFecha BETWEEN @FecDesde AND @FecHasta
        AND t.TcaEstado IN ('COMPLETADO','COMPLETADA','COBRADO')
        AND p.PagTipoMovimiento != 'ANULADO'
        AND NOT EXISTS (
          SELECT 1 FROM dbo.DocumentosContables dc WITH(NOLOCK)
          WHERE dc.TcaIdTransaccion = t.TcaIdTransaccion
        )
        ${clienteFilter}
      GROUP BY t.TcaIdTransaccion, t.TcaFecha, ct1.Detalle, t.TcaTipoDocumento,
               t.TcaSerieDoc, t.TcaNumeroDoc, c.Nombre, t.TcaClienteId,
               p.PagIdMonedaPago, t.TcaEstado, t.TcaObservaciones, mp.MPaDescripcionMetodo, u.Nombre, u.Usuario
    `;
    const egresoQ = `
      SELECT 'EGRESO' AS TipoOperacion, e.EgrIdEgreso AS DocId, e.EgrFecha AS Fecha,
        ISNULL(ct2.Detalle, e.EgrTipoDocumento) AS TipoDoc, e.EgrTipoDocumento AS CodTipoDoc,
        ISNULL(e.EgrSerieDoc,'') AS Serie, ISNULL(e.EgrNumeroDoc,'') AS Numero,
        ISNULL(e.EgrProveedor,'-') AS ClienteNombre, NULL AS ClienteId,
        e.EgrMoneda AS Moneda, e.EgrMonto AS Total, e.EgrEstado AS Estado,
        ISNULL(e.EgrConcepto,'') AS Observaciones, mp2.MPaDescripcionMetodo AS MetodoPago,
        COALESCE(u2.Nombre, u2.Usuario, 'Sistema') AS Usuario
      FROM dbo.EgresosCaja e WITH(NOLOCK)
      LEFT JOIN dbo.MetodosPagos mp2 WITH(NOLOCK) ON mp2.MPaIdMetodoPago = e.MPaIdMetodoPago
      LEFT JOIN dbo.Config_TiposDocumento ct2 WITH(NOLOCK) ON ct2.CodDocumento = e.EgrTipoDocumento
      LEFT JOIN dbo.Usuarios u2 WITH(NOLOCK) ON u2.IdUsuario = e.EgrUsuarioId
      WHERE e.EgrFecha BETWEEN @FecDesde AND @FecHasta AND e.EgrEstado = 'REGISTRADO'
        ${clienteFilterEgr}
    `;

    let finalQ;
    if (tipo === 'INGRESO') finalQ = ingresoQ + ' ORDER BY Fecha DESC OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY';
    else if (tipo === 'EGRESO') finalQ = egresoQ + ' ORDER BY Fecha DESC OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY';
    else finalQ = `SELECT * FROM (${ingresoQ} UNION ALL ${egresoQ}) AS docs ORDER BY Fecha DESC OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY`;

    const result = await r.query(finalQ);
    return res.json({ success: true, data: result.recordset, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error('[CAJA] getDocumentosInternos:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
module.exports.getDocumentosInternos = getDocumentosInternos;

/** POST /api/contabilidad/caja/upload-comprobante-transferencia
 *  Recibe un archivo (imagen/PDF) de comprobante de transferencia bancaria
 *  enviado por vendedores de atención al cliente al vender rollo por adelantado.
 *  multerConfig ya guarda el archivo en disco; aquí solo registramos la referencia.
 */
const subirComprobanteTransferencia = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    const { referenciaId, tipo } = req.body;
    const pool = await getPool();
    await pool.request()
      .input('TcaIdTransaccion', sql.Int, referenciaId ? parseInt(referenciaId, 10) : null)
      .input('Archivo',          sql.NVarChar(500), req.file.filename)
      .input('Tipo',             sql.NVarChar(100), tipo || 'TRANSFERENCIA_VENTA_ROLLO')
      .input('FechaSubida',      sql.DateTime,      new Date())
      .query(`
        INSERT INTO dbo.ComprobantesTransferencia (TcaIdTransaccion, Archivo, Tipo, FechaSubida)
        VALUES (@TcaIdTransaccion, @Archivo, @Tipo, @FechaSubida)
      `).catch(() => {
        // Si la tabla no existe, igualmente respondemos OK (el archivo ya está en disco)
      });
    return res.json({ success: true, archivo: req.file.filename, mensaje: 'Comprobante subido correctamente' });
  } catch (err) {
    logger.error('[CAJA] subirComprobanteTransferencia:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
module.exports.subirComprobanteTransferencia = subirComprobanteTransferencia;
