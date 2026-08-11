const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { calcularSaldoEfectivo, aplicarAnticipoAOrden } = require('../services/anticipoService');

/**
 * Claves de comparación de un código de orden/etiqueta.
 *
 * La etiqueta FÍSICA que se escanea es `{NoDocERP}/B{idEtiqueta}` (ej. `9471/B11575`), mientras que
 * `OrdenesDeposito.OrdCodigoOrden` guarda el CodigoOrden CON prefijo de área (`SUB-9471`). Comparar
 * literal no matcheaba NUNCA: todo lo escaneado caía en "desconocido" (Falta Por Ingresar) y las
 * órdenes reales quedaban como extraviadas (de ahí que Activas y Extraviadas dieran el mismo número).
 *
 *   9471/B11575 → {'9471'}          SUB-9471 → {'SUB-9471', '9471'}     → matchean por '9471'
 *
 * Solo se quita el prefijo de área del INICIO: `SUB-7684-R1` → `7684-R1` (no `1`, que colisionaría
 * con cualquier código terminado en 1).
 */
const clavesDeCodigo = (raw) => {
    const base = String(raw || '').trim().toUpperCase().split('/')[0]; // saca el /B11575 de la etiqueta
    const claves = new Set();
    if (!base) return claves;
    claves.add(base);
    claves.add(base.replace(/^[A-Z]+-/, ''));
    return claves;
};

/**
 * Cobro "vía documento" (semanales / cuenta corriente): esas órdenes no estampan
 * OrdenesDeposito.PagIdPago nunca — el cargo va como mov ORDEN a la cuenta, el cierre de ciclo
 * lo liga a un PC/factura (DocIdDocumento) y el cobro salda ese DOCUMENTO (DocPagado=1 /
 * DeudaDocumento saldada). Sin este join, toda orden así figuraba "Pendiente" eternamente.
 *
 * OJO: MovimientosCuenta.OrdIdOrden NO sirve para unir con OrdenesDeposito (la vía logística
 * graba el ID de Ordenes, otra tabla). El único match confiable es el código de orden, que es
 * el primer token del MovConcepto (`${CodigoOrden} ${NombreTrabajo}`).
 */
const SQL_COLS_PAGO_DOC = `,
        doc.DocIdDocumento AS DocIdVinculado,
        doc.DocSerie       AS DocSerieVinculada,
        doc.DocNumero      AS DocNumeroVinculado,
        doc.DocPagado      AS DocPagadoVinculado,
        dd.DeudasTotales, dd.DeudasVivas,
        CASE WHEN mv.Cod IS NOT NULL THEN 1 ELSE 0 END AS TieneMovOrden`;

const SQL_JOIN_PAGO_DOC = `
      LEFT JOIN (
        SELECT UPPER(LTRIM(RTRIM(CASE WHEN CHARINDEX(' ', mc.MovConcepto) > 0
                     THEN LEFT(mc.MovConcepto, CHARINDEX(' ', mc.MovConcepto) - 1)
                     ELSE mc.MovConcepto END))) AS Cod,
               MAX(mc.DocIdDocumento) AS DocId
        FROM dbo.MovimientosCuenta mc WITH(NOLOCK)
        WHERE mc.MovTipo = 'ORDEN' AND ISNULL(mc.MovAnulado, 0) = 0
        GROUP BY UPPER(LTRIM(RTRIM(CASE WHEN CHARINDEX(' ', mc.MovConcepto) > 0
                     THEN LEFT(mc.MovConcepto, CHARINDEX(' ', mc.MovConcepto) - 1)
                     ELSE mc.MovConcepto END)))
      ) mv ON mv.Cod = UPPER(LTRIM(RTRIM(o.OrdCodigoOrden)))
      LEFT JOIN dbo.DocumentosContables doc WITH(NOLOCK)
             ON doc.DocIdDocumento = mv.DocId AND doc.DocEstado <> 'ANULADO'
      LEFT JOIN (
        SELECT DocIdDocumento,
               COUNT(*) AS DeudasTotales,
               SUM(CASE WHEN DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND DDeImportePendiente > 0.01
                        THEN 1 ELSE 0 END) AS DeudasVivas
        FROM dbo.DeudaDocumento WITH(NOLOCK)
        GROUP BY DocIdDocumento
      ) dd ON dd.DocIdDocumento = doc.DocIdDocumento`;

// Devuelve la situación de pago para mostrar + si la orden ya está saldada vía documento
// (en cuyo caso NO va a "Entregadas Sin Pago"). Documento saldado = DocPagado=1 o todas sus
// deudas saldadas (DocPagado puede quedar rezagado en docs cobrados por cuenta corriente).
const resolverSituacionPago = (row) => {
  if (row.PagIdPago) return { pagoEstado: 'Pagado', saldadaPorDoc: false };
  if (row.DocIdVinculado) {
    const serie = String(row.DocSerieVinculada || '').trim();
    const numero = String(row.DocNumeroVinculado || '').trim();
    const docRef = [serie, numero].filter(Boolean).join('-') || `Doc ${row.DocIdVinculado}`;
    const saldada = row.DocPagadoVinculado === true || row.DocPagadoVinculado === 1
      || ((row.DeudasTotales || 0) > 0 && (row.DeudasVivas || 0) === 0);
    if (saldada) return { pagoEstado: `Pagado (${docRef})`, saldadaPorDoc: true };
    return { pagoEstado: `Facturado - impago (${docRef})`, saldadaPorDoc: false };
  }
  if (row.TieneMovOrden) return { pagoEstado: 'En cta. cte. (sin facturar)', saldadaPorDoc: false };
  return { pagoEstado: 'Pendiente', saldadaPorDoc: false };
};

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
        r.FormaRetiro AS FormaRetiro${SQL_COLS_PAGO_DOC}
      FROM dbo.OrdenesDeposito o WITH(NOLOCK)
      LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
      LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
      LEFT JOIN dbo.OrdenesRetiro r WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro${SQL_JOIN_PAGO_DOC}
      WHERE o.OrdEstadoActual < 9 OR o.OrdEstadoActual IS NULL
         OR (o.OrdEstadoActual >= 9 AND o.PagIdPago IS NULL)
    `;

    // Si hay ms de 0 cdigos, ampliamos la condicin para traer las que podran ya estar entregadas.
    // Parametrizado: antes los códigos escaneados se concatenaban crudos dentro del IN (...).
    const request = pool.request();
    if (scannedCodes.length > 0) {
      const params = [];
      scannedCodes.forEach((c, i) => {
        [...clavesDeCodigo(c)].forEach((k, j) => {
          const p = `sc${i}_${j}`;
          request.input(p, sql.NVarChar(100), k);
          params.push(`@${p}`);
        });
      });
      if (params.length) query += ` OR UPPER(LTRIM(RTRIM(o.OrdCodigoOrden))) IN (${params.join(',')})`;
    }

    const { recordset } = await request.query(query);

    // Clasificacin. Un mismo registro se indexa por TODAS sus claves (con y sin prefijo).
    const dbMap = new Map();          // clave -> row
    const rowsPorCodigo = new Map();  // OrdCodigoOrden -> row (para recorrer sin duplicar)
    recordset.forEach(row => {
      const cod = String(row.OrdCodigoOrden || '').trim().toUpperCase();
      if (!cod) return;
      rowsPorCodigo.set(cod, row);
      clavesDeCodigo(cod).forEach(k => { if (!dbMap.has(k)) dbMap.set(k, row); });
    });

    // Escaneados, ya normalizados a sus claves
    const setScanned = new Set();
    scannedCodes.forEach(c => clavesDeCodigo(c).forEach(k => setScanned.add(k)));

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

    // Analizar lo que hay en DB vs lo Escaneado.
    // Se recorre rowsPorCodigo (una entrada por orden) y NO dbMap, que indexa la misma fila bajo
    // varias claves — iterarlo duplicaría cada orden en los resultados.
    for (const [code, row] of rowsPorCodigo.entries()) {
      const estaEnDbComoActiva = row.OrdEstadoActual !== null && row.OrdEstadoActual < 9;
      // Matchea por cualquiera de sus claves: la etiqueta trae el número pelado (9471) y el
      // depósito el código con prefijo (SUB-9471).
      const fueEscaneado = [...clavesDeCodigo(code)].some(k => setScanned.has(k));
      
      let diasEnDeposito = 0;
      if (row.OrdFechaIngresoOrden) {
        const diffTime = Math.abs(hoy - new Date(row.OrdFechaIngresoOrden));
        diasEnDeposito = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      }

      const { pagoEstado, saldadaPorDoc } = resolverSituacionPago(row);
      const item = {
        codigo: row.OrdCodigoOrden,
        trabajo: row.OrdNombreTrabajo,
        cliente: row.ClienteNombre,
        clienteTelefono: row.ClienteTelefono,
        clienteEmail: row.ClienteEmail,
        clienteTipo: row.ClienteTipo || 'Desconocido',
        pagoEstado,
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

      // Clasificacin Entregadas Sin Pago (que estn efectivamente entregadas).
      // Las saldadas vía documento (PC/factura del cierre ya cobrado) NO son "sin pago".
      if (row.OrdEstadoActual >= 9 && !row.PagIdPago && !saldadaPorDoc) {
        resultado.entregadasSinPago.push(item);
      }
    }

    // Analizar cdigos escaneados que ni siquiera estn en el registro trado.
    // Se recorren los códigos ORIGINALES (no las claves normalizadas): reportar las claves
    // mostraría el mismo escaneo dos veces (SUB-9471 y 9471) y con el texto que el operario
    // no vio nunca. Se marca desconocido solo si NINGUNA de sus claves matcheó.
    const vistos = new Set();
    for (const raw of scannedCodes) {
      const original = String(raw || '').trim().toUpperCase();
      if (!original || vistos.has(original)) continue;
      vistos.add(original);
      const claves = [...clavesDeCodigo(original)];
      if (!claves.some(k => dbMap.has(k))) {
        resultado.desconocido.push({
          codigo: original,
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
    const usuarioId = req.user?.id || 1;
    // IN parametrizado: los códigos vienen del body, nunca concatenarlos al SQL.
    const bindCodes = (request) => codigos.map((c, i) => {
      request.input(`c${i}`, sql.VarChar(100), String(c).trim());
      return `@c${i}`;
    }).join(',');

    if (accion === 'ESTADO') {
        // "Avisar nuevamente" NO toca órdenes resueltas (9/10/11): el 26/06/26 este UPDATE sin
        // guard devolvió a la cola de avisos ~60 órdenes YA ENTREGADAS y el job de WhatsApp las
        // re-avisó a todas. Además deja rastro en el historial (antes cambiaba estado en silencio).
        const reqEstado = pool.request().input('Usr', sql.Int, usuarioId);
        const inCodes = bindCodes(reqEstado);
        await reqEstado.query(`
          DECLARE @cambios TABLE (OrdIdOrden INT, EstadoViejo INT, EstadoNuevo INT);

          UPDATE dbo.OrdenesDeposito
          SET OrdEstadoActual = 12, OrdFechaEstadoActual = GETDATE()
          OUTPUT inserted.OrdIdOrden, deleted.OrdEstadoActual, inserted.OrdEstadoActual INTO @cambios
          WHERE OrdCodigoOrden IN (${inCodes})
            AND OrdEstadoActual NOT IN (9, 10, 11);

          INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT OrdIdOrden, EstadoNuevo, GETDATE(), @Usr
          FROM @cambios WHERE EstadoViejo <> EstadoNuevo;
        `);
        return res.json({ success: true, message: `Estado cambiado a 'Avisar nuevamente' para ${codigos.length} órdenes (las entregadas/canceladas no se tocan).` });
    }

    if (accion === 'EMAIL') {
        const { sendMail } = require('../services/emailService');
        const reqEmail = pool.request();
        const inCodesEmail = bindCodes(reqEmail);
        const { recordset } = await reqEmail.query(`
          SELECT o.OrdCodigoOrden, c.Email
          FROM dbo.OrdenesDeposito o WITH(NOLOCK)
          LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
          WHERE o.OrdCodigoOrden IN (${inCodesEmail}) AND c.Email IS NOT NULL AND DATALENGTH(LTRIM(RTRIM(c.Email))) > 0
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
                 tc.TClDescripcion AS ClienteTipo, r.FormaRetiro${SQL_COLS_PAGO_DOC}
          FROM dbo.OrdenesDeposito o WITH(NOLOCK)
          LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON o.CliIdCliente = c.CliIdCliente
          LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
          LEFT JOIN dbo.OrdenesRetiro r WITH(NOLOCK) ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro${SQL_JOIN_PAGO_DOC}
          WHERE o.OrdEstadoActual < 9 OR o.OrdEstadoActual IS NULL
             OR (o.OrdEstadoActual >= 9 AND o.PagIdPago IS NULL)
        `);
        return { recordset, maxDias };
      })()
    ]);

    const liveCodes = liveRes.recordset.map(x => x.Codigo);
    const { recordset, maxDias } = checkRes;

    // Clasificar igual que checkAudit — con la MISMA normalización: la etiqueta física trae el
    // número pelado (9471/B11575) y el depósito el código con prefijo (SUB-9471).
    const dbMap = new Map();          // clave -> row (una fila se indexa bajo varias claves)
    const rowsPorCodigo = new Map();  // OrdCodigoOrden -> row (para recorrer sin duplicar)
    recordset.forEach(row => {
      const cod = String(row.OrdCodigoOrden || '').trim().toUpperCase();
      if (!cod) return;
      rowsPorCodigo.set(cod, row);
      clavesDeCodigo(cod).forEach(k => { if (!dbMap.has(k)) dbMap.set(k, row); });
    });
    const setScanned = new Set();
    liveCodes.forEach(c => clavesDeCodigo(c).forEach(k => setScanned.add(k)));
    const hoy = new Date();

    const auditData = { totales: [], faltaEnDeposito: [], sobraEnDeposito: [], ok: [], olvidadas: [], desconocido: [], entregadasSinPago: [] };

    for (const [code, row] of rowsPorCodigo.entries()) {
      const activa = row.OrdEstadoActual !== null && row.OrdEstadoActual < 9;
      const escaneado = [...clavesDeCodigo(code)].some(k => setScanned.has(k));
      const dias = row.OrdFechaIngresoOrden ? Math.floor(Math.abs(hoy - new Date(row.OrdFechaIngresoOrden)) / 86400000) : 0;
      const { pagoEstado, saldadaPorDoc } = resolverSituacionPago(row);
      const item = {
        codigo: row.OrdCodigoOrden, trabajo: row.OrdNombreTrabajo, cliente: row.ClienteNombre,
        clienteTelefono: row.ClienteTelefono, clienteEmail: row.ClienteEmail,
        clienteTipo: row.ClienteTipo || 'Desconocido',
        pagoEstado,
        ordenRetiro: row.OReIdOrdenRetiro ? `ID: ${row.OReIdOrdenRetiro} - ${row.FormaRetiro || 'S/D'}` : 'Sin Asignar',
        estadoActualId: row.OrdEstadoActual, diasEnDeposito: dias, maxDiasDeposito: maxDias
      };
      if (activa) auditData.totales.push(item);
      if (activa && dias > maxDias) auditData.olvidadas.push(item);
      if (activa && escaneado) auditData.ok.push(item);
      else if (activa && !escaneado) auditData.faltaEnDeposito.push(item);
      else if (!activa && escaneado) auditData.sobraEnDeposito.push(item);
      // Saldadas vía documento (PC/factura cobrado) NO van a "Entregadas Sin Pago"
      if (row.OrdEstadoActual >= 9 && !row.PagIdPago && !saldadaPorDoc) auditData.entregadasSinPago.push(item);
    }
    // Sobre los códigos ORIGINALES (no las claves normalizadas): si no, el mismo escaneo se
    // reportaría dos veces y con un texto que el operario nunca vio en la etiqueta.
    const vistosInit = new Set();
    for (const raw of liveCodes) {
      const original = String(raw || '').trim().toUpperCase();
      if (!original || vistosInit.has(original)) continue;
      vistosInit.add(original);
      if (![...clavesDeCodigo(original)].some(k => dbMap.has(k))) {
        auditData.desconocido.push({ codigo: original, trabajo: 'N/A', cliente: 'N/A', clienteTipo: 'N/A', pagoEstado: 'N/A', ordenRetiro: 'N/A', estadoActualId: null });
      }
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
