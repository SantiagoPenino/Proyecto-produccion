const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { calcularSaldoEfectivo, aplicarAnticipoAOrden } = require('../services/anticipoService');

/**
 * POST /api/audit-deposito/check
 * Recibe un array de strings `scannedCodes` escaneados físicamente en el depósito.
 * Compara con la base de datos y categoriza.
 */
exports.checkAudit = async (req, res) => {
  try {
    const { scannedCodes = [] } = req.body;
    const pool = await getPool();

    // Traer la configuración de días máximos en depósito
    const confRes = await pool.request().query("SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'DIAS_MAX_DEPOSITO'");
    const maxDiasDeposito = confRes.recordset.length > 0 ? parseInt(confRes.recordset[0].Valor, 10) : 15;

    // Traer las rdenes que estn en depsito (< 9) O que pertenezcan a las escaneadas
    let query = `
      SELECT 
        o.OrdCodigoOrden,
        o.OrdNombreTrabajo,
        o.OrdEstadoActual,
        o.OrdFechaIngresoOrden,
        o.PagIdPago,
        o.OReIdOrdenRetiro,
        c.Nombre AS ClienteNombre,
        c.TelefonoTrabajo AS ClienteTelefono,
        c.Email AS ClienteEmail,
        tc.TClDescripcion AS ClienteTipo,
        r.FormaRetiro AS FormaRetiro
      FROM dbo.OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
      LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
      LEFT JOIN dbo.OrdenesRetiro r WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
      WHERE o.OrdEstadoActual < 9 OR o.OrdEstadoActual IS NULL
         OR (o.OrdEstadoActual >= 9 AND o.PagIdPago IS NULL)
    `;

    // Si hay ms de 0 cdigos, ampliamos la condicin para traer las que podran ya estar entregadas
    if (scannedCodes.length > 0) {
      query += ` OR o.OrdCodigoOrden IN (${scannedCodes.map(c => `'${c.trim()}'`).join(',')})`;
    }

    const { recordset } = await pool.request().query(query);

    // Clasificacin
    const dbMap = new Map();
    recordset.forEach(row => {
      // Estado < 9 indica que debera estar fsicamente en el depsito (activo)
      dbMap.set(row.OrdCodigoOrden.trim().toUpperCase(), row);
    });

    const setScanned = new Set(scannedCodes.map(c => c.trim().toUpperCase()));

    const resultado = {
      totales: [],           // Todas las rdenes activas en el depsito
      faltaEnDeposito: [],   // Debera estar y no se escane
      sobraEnDeposito: [],   // Se escane y en DB figura >= 9 (o no existe)
      ok: [],                // Debera estar y se escane
      olvidadas: [],         // Debera estar pero lleva > X das
      desconocido: [],       // Cdigo no pertenece a OrdenesDeposito en absoluto
      entregadasSinPago: []  // Est entregada pero no tiene PagIdPago
    };

    const hoy = new Date();

    // Analizar lo que hay en DB vs lo Escaneado
    for (const [code, row] of dbMap.entries()) {
      const estaEnDbComoActiva = row.OrdEstadoActual !== null && row.OrdEstadoActual < 9;
      const fueEscaneado = setScanned.has(code);
      
      let diasEnDeposito = 0;
      if (row.OrdFechaIngresoOrden) {
        const diffTime = Math.abs(hoy - new Date(row.OrdFechaIngresoOrden));
        diasEnDeposito = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      }

      const item = {
        codigo: row.OrdCodigoOrden,
        trabajo: row.OrdNombreTrabajo,
        cliente: row.ClienteNombre,
        clienteTelefono: row.ClienteTelefono,
        clienteEmail: row.ClienteEmail,
        clienteTipo: row.ClienteTipo || 'Desconocido',
        pagoEstado: row.PagIdPago ? 'Pagado' : 'Pendiente',
        ordenRetiro: row.OReIdOrdenRetiro ? `ID: ${row.OReIdOrdenRetiro} - ${row.FormaRetiro || 'S/D'}` : 'Sin Asignar',
        estadoActualId: row.OrdEstadoActual,
        diasEnDeposito,
        maxDiasDeposito
      };

      if (estaEnDbComoActiva) {
        resultado.totales.push(item);
      }

      // Si est activa y lleva mucho tiempo se agrega en olvidadas
      if (estaEnDbComoActiva && diasEnDeposito > maxDiasDeposito) {
        resultado.olvidadas.push(item);
      }

      if (estaEnDbComoActiva && fueEscaneado) {
        resultado.ok.push(item);
      } else if (estaEnDbComoActiva && !fueEscaneado) {
        resultado.faltaEnDeposito.push(item);
      } else if (!estaEnDbComoActiva && fueEscaneado) {
        resultado.sobraEnDeposito.push(item);
      }

      // Clasificacin Entregadas Sin Pago (que estn efectivamente entregadas)
      if (row.OrdEstadoActual >= 9 && !row.PagIdPago) {
        resultado.entregadasSinPago.push(item);
      }
    }

    // Analizar cdigos escaneados que ni siquiera estn en el registro trado
    for (const code of setScanned) {
      if (!dbMap.has(code)) {
        resultado.desconocido.push({
          codigo: code,
          trabajo: 'N/A', cliente: 'N/A', clienteTipo: 'N/A', pagoEstado: 'N/A', ordenRetiro: 'N/A', estadoActualId: null
        });
      }
    }

    res.json({ success: true, data: resultado });
  } catch (err) {
    logger.error('[AUDIT_DEPOSITO] Error en checkAudit:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/audit-deposito/actions
 * Actualiza el estado de las ordenes seleccionadas en lote.
 * body: { codigos: ["RT-42", "XX-11"], accion: "ENTREGADO" | "A_DEPOSITO" }
 */
exports.performAction = async (req, res) => {
  try {
    const { codigos, accion } = req.body;
    const usuarioId = req.user?.id || 1; 

    if (!codigos || codigos.length === 0) {
      return res.status(400).json({ success: false, error: 'Sin cdigos para procesar.' });
    }

    const pool = await getPool();
    const tran = pool.transaction();
    await tran.begin();

    try {
      // 9 = Entregado. 
      // 5 = Listo (Pendiente de pago). 8 = Listo (Pagado).
      // Evaluaremos 5 u 8 basado en si PagIdPago est nulo al hacer el UPDATE (mejor slo asignar un estado de depsito acorde).
      const sqlCodes = codigos.map(c => `'${c.trim()}'`).join(',');

      if (accion === 'ENTREGADO') {
        // OrdenesDeposito -> 9 (Entregado)
        await tran.request().query(`
          UPDATE dbo.OrdenesDeposito
          SET OrdEstadoActual = 9, OrdFechaEstadoActual = GETDATE()
          WHERE OrdCodigoOrden IN (${sqlCodes})
        `);
        await tran.request().query(`
          INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT OrdIdOrden, 9, GETDATE(), ${usuarioId}
          FROM dbo.OrdenesDeposito WHERE OrdCodigoOrden IN (${sqlCodes})
        `);
        
        // Sincronizar con Estado global en Ordenes
        try {
            const mainOrdersRes = await tran.request().query(`
                SELECT OrdenID FROM Ordenes WITH(NOLOCK) WHERE CodigoOrden IN (${sqlCodes}) OR NoDocERP IN (${sqlCodes})
            `);
            if (mainOrdersRes.recordset.length > 0) {
                const { changeOrderState } = require('../services/stateManagerService');
                for (const row of mainOrdersRes.recordset) {
                    await changeOrderState(tran, {
                        target: { type: 'ORDER', id: row.OrdenID },
                        estado: 'Entregado',
                        userObj: req.user || 'Sistema',
                        detalle: 'Estado global sincronizado (Entregado en depósito)',
                        io: req.app.get('socketio')
                    });
                }
            }
        } catch (syncErr) {
            console.error('Error sincronizando estado global a Entregado en auditDeposito:', syncErr);
        }

        // OrdenesRetiro -> 5 (Entregado)
        await tran.request().query(`
          UPDATE r
          SET r.OReEstadoActual = 5, r.OReFechaEstadoActual = GETDATE(), r.ORePasarPorCaja = 0
          FROM dbo.OrdenesRetiro r
          INNER JOIN dbo.OrdenesDeposito d ON r.OReIdOrdenRetiro = d.OReIdOrdenRetiro
          WHERE d.OrdCodigoOrden IN (${sqlCodes})
        `);
        await tran.request().query(`
          INSERT INTO dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT DISTINCT d.OReIdOrdenRetiro, 5, GETDATE(), ${usuarioId}
          FROM dbo.OrdenesDeposito d
          WHERE d.OrdCodigoOrden IN (${sqlCodes}) AND d.OReIdOrdenRetiro IS NOT NULL
        `);

        // Liberar estantes correspondientes
        await tran.request().query(`
          DELETE FROM dbo.OcupacionEstantes
          WHERE OrdenRetiro IN (
              SELECT DISTINCT COALESCE(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR)
              FROM dbo.OrdenesRetiro r
              INNER JOIN dbo.OrdenesDeposito d ON r.OReIdOrdenRetiro = d.OReIdOrdenRetiro
              WHERE d.OrdCodigoOrden IN (${sqlCodes}) AND d.OReIdOrdenRetiro IS NOT NULL
          )
        `);

        // Marcar bultos como DESPACHADO
        await tran.request().query(`
          UPDATE lb
          SET lb.Estado = 'DESPACHADO'
          FROM dbo.Logistica_Bultos lb
          INNER JOIN dbo.Ordenes o ON o.OrdenID = lb.OrdenID
          WHERE o.CodigoOrden IN (${sqlCodes})
          AND lb.Estado NOT IN ('DESPACHADO', 'PERDIDO')
        `);

        await tran.commit();
        return res.json({ success: true, message: `${codigos.length} órdenes entregadas con éxito.` });

      } else if (accion === 'A_DEPOSITO') {
        // ── 1. Actualizar OrdenesDeposito → estado 7 ────────────────────────────
        await tran.request().query(`
          UPDATE dbo.OrdenesDeposito
          SET OrdEstadoActual = 7, OrdFechaEstadoActual = GETDATE()
          WHERE OrdCodigoOrden IN (${sqlCodes})
        `);
        await tran.request().query(`
          INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT OrdIdOrden, 7, GETDATE(), ${usuarioId}
          FROM dbo.OrdenesDeposito WHERE OrdCodigoOrden IN (${sqlCodes})
        `);

        // ── 2. OrdenesRetiro: estado provisional según si ya tenía pago ──────────
        await tran.request().query(`
          UPDATE r
          SET r.OReEstadoActual = CASE WHEN r.PagIdPago IS NOT NULL THEN 8 ELSE 7 END,
              r.OReFechaEstadoActual = GETDATE()
          FROM dbo.OrdenesRetiro r
          INNER JOIN dbo.OrdenesDeposito d ON r.OReIdOrdenRetiro = d.OReIdOrdenRetiro
          WHERE d.OrdCodigoOrden IN (${sqlCodes})
        `);
        await tran.request().query(`
          INSERT INTO dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT DISTINCT d.OReIdOrdenRetiro, CASE WHEN r.PagIdPago IS NOT NULL THEN 8 ELSE 7 END, GETDATE(), ${usuarioId}
          FROM dbo.OrdenesDeposito d
          INNER JOIN dbo.OrdenesRetiro r ON d.OReIdOrdenRetiro = r.OReIdOrdenRetiro
          WHERE d.OrdCodigoOrden IN (${sqlCodes})
        `);

        // Marcar bultos como DESPACHADO al pasar al depósito (salen del área de producción)
        await tran.request().query(`
          UPDATE lb
          SET lb.Estado = 'DESPACHADO'
          FROM dbo.Logistica_Bultos lb
          INNER JOIN dbo.Ordenes o ON o.OrdenID = lb.OrdenID
          WHERE o.CodigoOrden IN (${sqlCodes})
          AND lb.Estado NOT IN ('DESPACHADO', 'PERDIDO')
        `);

        // ── 3. AUTO-APROBACIÓN POR ANTICIPO ─────────────────────────────────────
        // Para cada OrdenRetiro sin pago, verificar si el cliente tiene saldo
        // efectivo suficiente y, de ser así, imputarlo automáticamente.
        const retirosSinPago = await tran.request().query(`
          SELECT DISTINCT
            r.OReIdOrdenRetiro,
            r.OReCostoTotalOrden,
            o.CliIdCliente,
            o.MonIdMoneda
          FROM dbo.OrdenesRetiro r WITH(NOLOCK)
          INNER JOIN dbo.OrdenesDeposito o WITH(NOLOCK)
                  ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
          WHERE o.OrdCodigoOrden IN (${sqlCodes})
            AND r.PagIdPago IS NULL
            AND (r.ReferenciaPagoOnline IS NULL OR r.ReferenciaPagoOnline != 'ANTICIPO')
            AND o.CliIdCliente IS NOT NULL
        `);

        const resumenAnticipo = { aprobadas: [], pendientesCaja: [] };

        for (const retiro of retirosSinPago.recordset) {
          const { OReIdOrdenRetiro, OReCostoTotalOrden, CliIdCliente, MonIdMoneda } = retiro;
          const monto    = parseFloat(OReCostoTotalOrden) || 0;
          const monedaId = MonIdMoneda || 1;
          if (monto <= 0 || !CliIdCliente) continue;

          try {
            // Calcular saldo efectivo (descontando órdenes ya comprometidas)
            const pool = await getPool();
            const { cuentaId, saldoEfectivo } = await calcularSaldoEfectivo(CliIdCliente, monedaId, pool);

            if (cuentaId && saldoEfectivo >= monto) {
              // ✅ Saldo suficiente → imputar anticipo
              const { pagIdPago } = await aplicarAnticipoAOrden({
                oReId:     OReIdOrdenRetiro,
                cliId:     CliIdCliente,
                cuentaId,
                monto,
                monedaId,
                usuarioId,
                tran,
              });
              resumenAnticipo.aprobadas.push({
                oReId: OReIdOrdenRetiro,
                monto,
                pagIdPago,
                saldoRestante: parseFloat((saldoEfectivo - monto).toFixed(2)),
              });
              logger.info(`[AUDIT-DEPOSITO] ✅ Anticipo auto-aprobado: OReId=${OReIdOrdenRetiro} Monto=${monto} PagId=${pagIdPago}`);
            } else {
              // ❌ Saldo insuficiente → queda en caja
              resumenAnticipo.pendientesCaja.push({
                oReId:            OReIdOrdenRetiro,
                monto,
                saldoDisponible:  parseFloat((saldoEfectivo || 0).toFixed(2)),
                faltante:         parseFloat((monto - (saldoEfectivo || 0)).toFixed(2)),
              });
              // Asegurarse de que ORePasarPorCaja = 1
              await tran.request()
                .input('OReId', sql.Int, OReIdOrdenRetiro)
                .query('UPDATE dbo.OrdenesRetiro SET ORePasarPorCaja = 1 WHERE OReIdOrdenRetiro = @OReId');
            }
          } catch (eAnt) {
            logger.warn(`[AUDIT-DEPOSITO] Error al evaluar anticipo para OReId=${OReIdOrdenRetiro}: ${eAnt.message}`);
            resumenAnticipo.pendientesCaja.push({ oReId: OReIdOrdenRetiro, monto, error: eAnt.message });
          }
        }

        await tran.commit();
        return res.json({
          success: true,
          message: `${codigos.length} órdenes actualizadas.`,
          resumenAnticipo,
        });

      } else {
        throw new Error('Accin invlida.');
      }
    } catch (txErr) {
      await tran.rollback();
      throw txErr;
    }
  } catch (err) {
    logger.error('[AUDIT_DEPOSITO] Error en performAction:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/audit-deposito/notify
 * Enva un aviso (WhatsApp/Email) a la lista de cdigos seleccionados.
 */
exports.notifyAction = async (req, res) => {
  try {
    const { codigos, accion, mensaje } = req.body;
    if (!codigos || !Array.isArray(codigos) || codigos.length === 0) {
      return res.status(400).json({ success: false, error: 'Lista de códigos vacía.' });
    }

    const { getPool } = require('../config/db');
    const pool = await getPool();
    const sqlCodes = codigos.map(c => `'${c.trim()}'`).join(',');

    if (accion === 'ESTADO') {
        await pool.request().query(`
          UPDATE dbo.OrdenesDeposito
          SET OrdEstadoActual = 12, OrdFechaEstadoActual = GETDATE()
          WHERE OrdCodigoOrden IN (${sqlCodes})
        `);
        return res.json({ success: true, message: `Estado cambiado a 'Avisar nuevamente' para ${codigos.length} órdenes.` });
    } 
    
    if (accion === 'EMAIL') {
        const { sendMail } = require('../services/emailService');
        const { recordset } = await pool.request().query(`
          SELECT o.OrdCodigoOrden, c.Email
          FROM dbo.OrdenesDeposito o WITH(NOLOCK)
          LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
          WHERE o.OrdCodigoOrden IN (${sqlCodes}) AND c.Email IS NOT NULL AND DATALENGTH(LTRIM(RTRIM(c.Email))) > 0
        `);

        let sentCount = 0;
        for (const row of recordset) {
            const clientEmail = row.Email.trim();
            if (clientEmail) {
                const finalMessage = (mensaje || 'Tiene una orden lista para retiro en nuestro deposito.').replace(/\[CODIGO\]/g, row.OrdCodigoOrden);
                const html = `<div style="font-family:Arial, sans-serif; max-width:600px; padding: 20px;">
                    <h2>Aviso de Orden en Depósito</h2>
                    <p>${finalMessage.replace(/\n/g, '<br/>')}</p>
                    <hr>
                    <p style="color: #888; font-size: 12px;">User - Sistema de Producción</p>
                </div>`;

                await sendMail(clientEmail, `Aviso de Retiro - Orden #${row.OrdCodigoOrden}`, html);
                sentCount++;
            }
        }
        
        return res.json({ success: true, message: `Emails enviados a ${sentCount} clientes (Sin cambiar el estado internamente).` });
    }

    return res.status(400).json({ success: false, error: 'Acción inválida.' });
  } catch (err) {
    logger.error('[AUDIT_DEPOSITO] Error en notifyAction:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/audit-deposito/init
 * Endpoint unificado: devuelve los liveCodes guardados + el resultado del check
 * en un solo request para reducir latencia en redes LAN.
 */
exports.initAudit = async (req, res) => {
  try {
    const pool = await getPool();

    // Traer liveCodes y ejecutar el check en paralelo
    const [liveRes, checkRes] = await Promise.all([
      pool.request().query('SELECT Codigo FROM dbo.AuditoriaScansTemp ORDER BY Fecha ASC'),
      // Reutilizamos la lógica de checkAudit inline para evitar un segundo round-trip HTTP
      (async () => {
        const confRes = await pool.request().query("SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'DIAS_MAX_DEPOSITO'");
        const maxDias = confRes.recordset.length > 0 ? parseInt(confRes.recordset[0].Valor, 10) : 15;

        // Traer todas las órdenes activas (sin filtrar por escaneados en el init — aún no sabemos cuáles son)
        const { recordset } = await pool.request().query(`
          SELECT o.OrdCodigoOrden, o.OrdNombreTrabajo, o.OrdEstadoActual, o.OrdFechaIngresoOrden,
                 o.PagIdPago, o.OReIdOrdenRetiro,
                 c.Nombre AS ClienteNombre, c.TelefonoTrabajo AS ClienteTelefono, c.Email AS ClienteEmail,
                 tc.TClDescripcion AS ClienteTipo, r.FormaRetiro
          FROM dbo.OrdenesDeposito o WITH(NOLOCK)
          LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
          LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
          LEFT JOIN dbo.OrdenesRetiro r WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
          WHERE o.OrdEstadoActual < 9 OR o.OrdEstadoActual IS NULL
             OR (o.OrdEstadoActual >= 9 AND o.PagIdPago IS NULL)
        `);
        return { recordset, maxDias };
      })()
    ]);

    const liveCodes = liveRes.recordset.map(x => x.Codigo);
    const { recordset, maxDias } = checkRes;

    // Clasificar igual que checkAudit
    const dbMap = new Map();
    recordset.forEach(row => dbMap.set(row.OrdCodigoOrden.trim().toUpperCase(), row));
    const setScanned = new Set(liveCodes.map(c => c.trim().toUpperCase()));
    const hoy = new Date();

    const auditData = { totales: [], faltaEnDeposito: [], sobraEnDeposito: [], ok: [], olvidadas: [], desconocido: [], entregadasSinPago: [] };

    for (const [code, row] of dbMap.entries()) {
      const activa = row.OrdEstadoActual !== null && row.OrdEstadoActual < 9;
      const escaneado = setScanned.has(code);
      const dias = row.OrdFechaIngresoOrden ? Math.floor(Math.abs(hoy - new Date(row.OrdFechaIngresoOrden)) / 86400000) : 0;
      const item = {
        codigo: row.OrdCodigoOrden, trabajo: row.OrdNombreTrabajo, cliente: row.ClienteNombre,
        clienteTelefono: row.ClienteTelefono, clienteEmail: row.ClienteEmail,
        clienteTipo: row.ClienteTipo || 'Desconocido',
        pagoEstado: row.PagIdPago ? 'Pagado' : 'Pendiente',
        ordenRetiro: row.OReIdOrdenRetiro ? `ID: ${row.OReIdOrdenRetiro} - ${row.FormaRetiro || 'S/D'}` : 'Sin Asignar',
        estadoActualId: row.OrdEstadoActual, diasEnDeposito: dias, maxDiasDeposito: maxDias
      };
      if (activa) auditData.totales.push(item);
      if (activa && dias > maxDias) auditData.olvidadas.push(item);
      if (activa && escaneado) auditData.ok.push(item);
      else if (activa && !escaneado) auditData.faltaEnDeposito.push(item);
      else if (!activa && escaneado) auditData.sobraEnDeposito.push(item);
      if (row.OrdEstadoActual >= 9 && !row.PagIdPago) auditData.entregadasSinPago.push(item);
    }
    for (const code of setScanned) {
      if (!dbMap.has(code)) auditData.desconocido.push({ codigo: code, trabajo: 'N/A', cliente: 'N/A', clienteTipo: 'N/A', pagoEstado: 'N/A', ordenRetiro: 'N/A', estadoActualId: null });
    }

    res.json({ success: true, liveCodes, auditData });
  } catch (err) {
    logger.error('[AUDIT_DEPOSITO] Error en initAudit:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.getLiveScans = async (req, res) => {
  try {
    const { getPool } = require('../config/db');
    const pool = await getPool();
    const { recordset } = await pool.request().query('SELECT Codigo FROM dbo.AuditoriaScansTemp ORDER BY Fecha ASC');
    res.json({ success: true, data: recordset.map(x => x.Codigo) });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.addLiveScan = async (req, res) => {
  try {
    const { codigo } = req.body;
    if(!codigo) return res.status(400).json({success:false});
    const { getPool } = require('../config/db');
    const pool = await getPool();
    await pool.request().input('codigo', require('mssql').VarChar, codigo).query("IF NOT EXISTS (SELECT 1 FROM dbo.AuditoriaScansTemp WHERE Codigo=@codigo) INSERT INTO dbo.AuditoriaScansTemp(Codigo) VALUES(@codigo)");
    
    if (req.app.get('socketio')) {
      req.app.get('socketio').emit('audit:scan_added', { codigo });
    }
    
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.removeLiveScan = async (req, res) => {
  try {
    const { codigo } = req.body;
    if(!codigo) return res.status(400).json({success:false});
    const { getPool } = require('../config/db');
    const pool = await getPool();
    await pool.request().input('codigo', require('mssql').VarChar, codigo).query("DELETE FROM dbo.AuditoriaScansTemp WHERE Codigo=@codigo");
    
    if (req.app.get('socketio')) {
      req.app.get('socketio').emit('audit:scan_removed', { codigo });
    }

    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.clearLiveScans = async (req, res) => {
  try {
    const { getPool } = require('../config/db');
    const pool = await getPool();
    await pool.request().query("TRUNCATE TABLE dbo.AuditoriaScansTemp");
    
    if (req.app.get('socketio')) {
      req.app.get('socketio').emit('audit:scans_cleared');
    }

    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
