/**
 * estadosCuenta.job.js
 * ────────────────────────────────────────────────────────────────────────────
 * CRON — Generación automática de estados de cuenta al cierre del día.
 *
 * Flujo:
 *   1. Al dispararse (hora configurable en ConfiguracionGlobal), consulta todos
 *      los clientes con cuentas activas y deuda o movimientos del período.
 *   2. Para cada cliente genera un snapshot JSON del estado de su cuenta.
 *   3. Inserta el registro en ColaEstadosCuenta con estado PENDIENTE.
 *   4. Un operador revisa la cola, aprueba y envía.
 *      (El envío automático es opcional — ver CONT_EMAIL_AUTOENVIOM)
 *
 * Variables de entorno (.env):
 *   CONT_ESTADOS_HORA       → hora de ejecución (default: "20")  → 20:00 hs
 *   CONT_ESTADOS_MINUTO     → minuto (default: "0")
 *   CONT_EMAIL_AUTOENVIO    → "true" para enviar sin revisión manual (default: false)
 *   CONT_ESTADOS_ENABLED    → "true" | "false" (default: true)
 * ────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { getPool, sql } = require('../config/db');
const logger           = require('../utils/logger');
const svc              = require('../services/contabilidadService');
const emailSvc         = require('../services/contabilidadEmailService');

// ============================================================
// SECCIÓN 1: CONFIGURACIÓN
// ============================================================

const HORA_EJECUCION   = process.env.CONT_ESTADOS_HORA    || '23';
const MINUTO_EJECUCION = process.env.CONT_ESTADOS_MINUTO  || '59';
const DIA_SEMANA       = process.env.CONT_ESTADOS_DIA     || '4'; // 4 = Jueves
const AUTOENVIO        = String(process.env.CONT_EMAIL_AUTOENVIO ?? 'false').toLowerCase() === 'true';
const ENABLED_ENV      = String(process.env.CONT_ESTADOS_ENABLED ?? 'true').toLowerCase() === 'true';
const USUARIO_SISTEMA  = 1; // ID de usuario para movimientos generados por el sistema

// ============================================================
// SECCIÓN 2: GENERACIÓN DEL ESTADO DE CUENTA DE UN CLIENTE
// ============================================================

/**
 * generarEstadoParaCliente
 * Crea el snapshot JSON y lo inserta en ColaEstadosCuenta.
 * Calcula automáticamente el período (inicio del mes → hoy).
 *
 * @param {object} pool    SQL pool
 * @param {object} cliente { CliIdCliente, Nombre, Email }
 * @returns {Promise<number|null>} ColIdCola insertado, o null si no tiene movimientos
 */
async function generarEstadoParaCliente(pool, cliente) {
  const { CliIdCliente, Nombre, Email } = cliente;

  try {
    // 1. Obtener cuentas con saldo activo o deuda pendiente
    const cuentas = await svc.getSaldoCliente(CliIdCliente);

    if (cuentas.length === 0) {
      logger.info(`[ESTADOS-CRON] CliId=${CliIdCliente} (${Nombre}) sin cuentas → skip`);
      return null;
    }

    // 2. Para cada cuenta buscar movimientos del mes actual y deudas activas
    const hoy     = new Date();
    const primeroDeMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

    const cuentasDetalle = await Promise.all(
      cuentas.map(async (c) => {
        const [movimientos, deudas] = await Promise.all([
          svc.getMovimientos(c.CueIdCuenta, primeroDeMes, hoy, 500),
          svc.getDeudas(c.CueIdCuenta),
        ]);
        return { ...c, movimientos, deudas };
      })
    );

    // 3. Filtrar cuentas que tienen saldo distinto de cero o tienen deudas pendientes
    const cuentasActivas = cuentasDetalle.filter(c => Number(c.CueSaldoActual) !== 0 || c.deudas.length > 0);

    // Si después de filtrar no queda ninguna cuenta con saldo/deuda, no enviamos nada
    if (cuentasActivas.length === 0) {
      logger.info(`[ESTADOS-CRON] CliId=${CliIdCliente} saldos en cero → skip`);
      return null;
    }

    // 4. Armar el snapshot JSON completo solo con las cuentas activas
    const snapshot = {
      cliente: {
        CliIdCliente,
        Nombre,
        Email,
      },
      cuentas: cuentasActivas,
      periodoDesde: primeroDeMes.toISOString(),
      periodoHasta: hoy.toISOString(),
      generadoEn:   hoy.toISOString(),
    };

    // 5. Formatear fechas para el asunto
    const fechaStr = hoy.toLocaleDateString('es-UY', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      timeZone: 'America/Montevideo',
    });
    const asunto = `Estado de cuenta — ${Nombre} — ${fechaStr}`;

    // 6. Verificar que no exista ya un PENDIENTE del mismo cliente/día
    const existeRes = await pool.request()
      .input('CliIdCliente', sql.Int, CliIdCliente)
      .query(`
        SELECT TOP 1 ColIdCola FROM dbo.ColaEstadosCuenta WITH (NOLOCK)
        WHERE CliIdCliente = @CliIdCliente
          AND ColEstado    = 'PENDIENTE'
          AND CAST(ColFechaGeneracion AS DATE) = CAST(GETDATE() AS DATE)
      `);

    if (existeRes.recordset.length > 0) {
      logger.info(`[ESTADOS-CRON] CliId=${CliIdCliente} ya tiene PENDIENTE hoy → skip`);
      return existeRes.recordset[0].ColIdCola;
    }

    // 7. Insertar en la cola
    const insertRes = await pool.request()
      .input('CliIdCliente',    sql.Int,          CliIdCliente)
      .input('ColContenidoJSON',sql.NVarChar(sql.MAX), JSON.stringify(snapshot))
      .input('ColAsunto',       sql.NVarChar(300), asunto)
      .input('ColEmailDestino', sql.NVarChar(300), Email || '')
      .input('ColFechaDesde',   sql.Date,         primeroDeMes)
      .input('ColFechaHasta',   sql.Date,         hoy)
      .query(`
        -- Obtener la primera cuenta del cliente para el FK requerido
        DECLARE @CueIdCuenta INT = (
          SELECT TOP 1 CueIdCuenta FROM dbo.CuentasCliente
          WHERE CliIdCliente = @CliIdCliente AND CueActiva = 1
          ORDER BY CueIdCuenta
        );

        INSERT INTO dbo.ColaEstadosCuenta
          (CliIdCliente, CueIdCuenta, ColContenidoJSON, ColAsunto,
           ColEmailDestino, ColFechaDesde, ColFechaHasta,
           ColEstado, ColFechaGeneracion, ColTipoDisparo)
        OUTPUT INSERTED.ColIdCola
        VALUES
          (@CliIdCliente, @CueIdCuenta, @ColContenidoJSON, @ColAsunto,
           @ColEmailDestino, @ColFechaDesde, @ColFechaHasta,
           'PENDIENTE', GETDATE(), 'CRON')
      `);

    const ColIdCola = insertRes.recordset[0].ColIdCola;
    logger.info(`[ESTADOS-CRON] ✅ CliId=${CliIdCliente} (${Nombre}) → ColIdCola=${ColIdCola}`);
    return ColIdCola;

  } catch (err) {
    logger.error(`[ESTADOS-CRON] ❌ Error CliId=${CliIdCliente}: ${err.message}`);
    return null;
  }
}

// ============================================================
// SECCIÓN 3: TAMBIÉN DETECTAR CICLOS VENCIDOS
// ============================================================

/**
 * marcarCiclosVencidos
 * Actualiza a 'VENCIDO' los CiclosCredito cuya CicFechaCierre ya pasó.
 */
async function marcarCiclosVencidos(pool) {
  try {
    const result = await pool.request().query(`
      UPDATE dbo.CiclosCredito
      SET    CicEstado = 'VENCIDO'
      WHERE  CicEstado = 'ABIERTO'
        AND  DATEADD(day, ISNULL(CicDiasAprobados, 7), CicFechaInicio) < CAST(GETDATE() AS DATE)
    `);
    if (result.rowsAffected[0] > 0) {
      logger.warn(`[ESTADOS-CRON] ⚠️ ${result.rowsAffected[0]} ciclo(s) marcados como VENCIDO`);
    }
  } catch (err) {
    logger.warn(`[ESTADOS-CRON] Error marcando ciclos vencidos: ${err.message}`);
  }
}

/**
 * marcarDeudasVencidas
 * Actualiza a 'VENCIDO' las DeudaDocumento cuya DDeFechaVencimiento ya pasó.
 */
async function marcarDeudasVencidas(pool) {
  try {
    const result = await pool.request().query(`
      UPDATE dbo.DeudaDocumento
      SET    DDeEstado = 'VENCIDO'
      WHERE  DDeEstado = 'PENDIENTE'
        AND  DDeFechaVencimiento < CAST(GETDATE() AS DATE)
    `);
    if (result.rowsAffected[0] > 0) {
      logger.info(`[ESTADOS-CRON] ${result.rowsAffected[0]} deuda(s) marcadas como VENCIDO`);
    }
  } catch (err) {
    logger.warn(`[ESTADOS-CRON] Error marcando deudas vencidas: ${err.message}`);
  }
}

// ============================================================
// SECCIÓN 4: ASEGURAR CICLOS SEMANALES
// ============================================================

/**
 * asegurarCiclosSemanalesAbiertos
 * Detecta clientes que tienen TipoCliente = 2 (Semanal) pero no tienen
 * un ciclo abierto, y se los abre automáticamente.
 */
async function asegurarCiclosSemanalesAbiertos(pool) {
  try {
    const result = await pool.request().query(`
      SELECT c.CliIdCliente, cc.CueIdCuenta
      FROM dbo.Clientes c WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CliIdCliente = c.CliIdCliente
      LEFT JOIN dbo.CiclosCredito cic WITH(NOLOCK) ON cic.CueIdCuenta = cc.CueIdCuenta AND cic.CicEstado = 'ABIERTO'
      WHERE c.TClIdTipoCliente = 2
        AND cc.CueActiva = 1
        AND cic.CicIdCiclo IS NULL
        AND cc.CueTipo IN ('UYU', 'USD', 'ARS')
    `);

    const clientes = result.recordset;
    if (clientes.length === 0) return;

    logger.info(`[ESTADOS-CRON] Detectados ${clientes.length} clientes Semanales sin ciclo abierto. Abriendo automáticamente...`);
    
    for (const c of clientes) {
      await svc.abrirCicloPorCuenta({ CueIdCuenta: c.CueIdCuenta, CliIdCliente: c.CliIdCliente, UsuarioAlta: 1 });
    }
  } catch (err) {
    logger.warn(`[ESTADOS-CRON] Error asegurando ciclos semanales: ${err.message}`);
  }
}

// ============================================================
// SECCIÓN 5: PROCESO BATCH PRINCIPAL
// ============================================================

/**
 * runEstadosCuentaBatch
 * Ejecuta el proceso completo: marcar vencimientos + generar estados.
 * Puede llamarse manualmente desde el controller (disparo manual).
 */
async function runEstadosCuentaBatch() {
  logger.info('[ESTADOS-CRON] ▶ Iniciando generación de estados de cuenta...');
  const pool = await getPool();

  // DESACTIVADO: El cierre de ciclos se hace manualmente desde la UI
  // await svc.forzarCierreTodosCiclosAbiertos();
  logger.info('[ESTADOS-CRON] ℹ️ Cierre automático de ciclos DESACTIVADO (solo manual desde UI)');
  await marcarDeudasVencidas(pool);
  await asegurarCiclosSemanalesAbiertos(pool);

  // 2. Obtener clientes con cuentas activas y email configurado
  const clientesRes = await pool.request().query(`
    SELECT DISTINCT
      c.CliIdCliente,
      c.Nombre,
      c.Email
    FROM  dbo.CuentasCliente cc WITH (NOLOCK)
    JOIN  dbo.Clientes        c  WITH (NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
    WHERE cc.CueActiva = 1
      AND c.Email IS NOT NULL
      AND LEN(LTRIM(RTRIM(c.Email))) > 5
      AND (c.TClIdTipoCliente = 2 OR cc.CueTipo NOT IN ('UYU', 'USD', 'ARS'))
    ORDER BY c.Nombre
  `);

  const clientes = clientesRes.recordset;
  logger.info(`[ESTADOS-CRON] Procesando ${clientes.length} clientes...`);

  let generados = 0;
  let omitidos  = 0;
  const colaIds = [];

  for (const cliente of clientes) {
    const colId = await generarEstadoParaCliente(pool, cliente);
    if (colId !== null) {
      generados++;
      colaIds.push({ colId, email: cliente.Email, nombre: cliente.Nombre });
    } else {
      omitidos++;
    }
  }

  logger.info(`[ESTADOS-CRON] ✅ Generados: ${generados} | Omitidos: ${omitidos}`);

  // 3. Si AUTOENVIO está activado → enviar sin revisión manual
  if (AUTOENVIO && colaIds.length > 0) {
    logger.info(`[ESTADOS-CRON] AUTOENVIO activado → enviando ${colaIds.length} estados...`);
    await enviarColaAprobados(pool, colaIds.map(x => x.colId));
  }

  return { generados, omitidos, colaIds };
}

/**
 * enviarColaAprobados
 * Envía todos los registros APROBADOS (o los IDs pasados) de la cola.
 * Llamado desde el controller cuando el operador confirma el envío.
 *
 * @param {object} pool
 * @param {number[]|null} soloIds  Si es null → envía todos los APROBADOS
 */
async function enviarColaAprobados(pool, soloIds = null) {
  let query;
  const request = pool.request();

  if (soloIds && soloIds.length > 0) {
    const inClause = soloIds.map((id, i) => {
      request.input(`id${i}`, sql.Int, id);
      return `@id${i}`;
    }).join(',');
    query = `
      SELECT ColIdCola, CliIdCliente, ColContenidoJSON, ColAsunto, ColEmailDestino
      FROM   dbo.ColaEstadosCuenta
      WHERE  ColIdCola IN (${inClause})
        AND  ColEstado IN ('PENDIENTE', 'APROBADO', 'ERROR')
    `;
  } else {
    query = `
      SELECT ColIdCola, CliIdCliente, ColContenidoJSON, ColAsunto, ColEmailDestino
      FROM   dbo.ColaEstadosCuenta
      WHERE  ColEstado = 'APROBADO'
      ORDER  BY ColFechaGeneracion ASC
    `;
  }

  const colaRes = await request.query(query);
  const items   = colaRes.recordset;

  logger.info(`[ESTADOS-CRON] Enviando ${items.length} estado(s) de cuenta...`);
  let enviados = 0;
  let errores  = 0;

  for (const item of items) {
    let datos;
    try { datos = JSON.parse(item.ColContenidoJSON); } catch { datos = {}; }

    const result = await emailSvc.enviarDesdeCola({
      ColIdCola:    item.ColIdCola,
      destinatario: item.ColEmailDestino,
      asunto:       item.ColAsunto,
      datos,
      pool,
      sql,
    });

    if (result.ok) enviados++; else errores++;
  }

  logger.info(`[ESTADOS-CRON] Envío completado — OK: ${enviados} | Error: ${errores}`);
  return { enviados, errores };
}

// ============================================================
// SECCIÓN 5: INICIO DEL CRON
// ============================================================

function startEstadosCuentaJob() {
  const cron = require('node-cron');

  // Verificar si está habilitado en ConfiguracionGlobal (o fallback al .env)
  // Formato: minuto hora diaDelMes mes diaDeLaSemana
  const expresionCron = `${MINUTO_EJECUCION} ${HORA_EJECUCION} * * ${DIA_SEMANA}`;

  cron.schedule(expresionCron, async () => {
    // Verificar switch en BD (puede desactivarse sin reiniciar)
    try {
      const pool = await getPool();
      const confRes = await pool.request().query(`
        SELECT Valor FROM ConfiguracionGlobal WITH(NOLOCK)
        WHERE  Clave = 'ActivarEstadosCuenta'
      `);
      const dbEnabled = confRes.recordset.length === 0
        ? true  // si no existe la clave → enabled por defecto
        : ['1', 'true'].includes(String(confRes.recordset[0].Valor).toLowerCase());

      if (!ENABLED_ENV || !dbEnabled) {
        logger.info('[ESTADOS-CRON] Deshabilitado (ENV o ConfiguracionGlobal).');
        return;
      }
    } catch { /* si falla la BD, igual ejecutamos */ }

    await runEstadosCuentaBatch();

  }, { timezone: 'America/Montevideo' });

  logger.info(`⏱️ [CRON] EstadosCuenta activado: ${expresionCron} (America/Montevideo)`);
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  startEstadosCuentaJob,
  runEstadosCuentaBatch,    // exportado para trigger manual desde controller
  enviarColaAprobados,      // exportado para el controller de la cola
  marcarCiclosVencidos,
  marcarDeudasVencidas,
};
