const { getPool, sql } = require("../config/db");
const { changeOrderState } = require('../services/stateManagerService');
const axios = require("axios");
const logger = require('../utils/logger');

// ================= ENV =================
const CALLBELL_API_KEY = process.env.CALLBELL_API_KEY;
const CALLBELL_TEMPLATE_UUID = process.env.CALLBELL_TEMPLATE_UUID;
const CALLBELL_CHANNEL_UUID = process.env.CALLBELL_CHANNEL_UUID;

const FORCE_TEST_TO = String(process.env.FORCE_TEST_TO ?? "false") === "true";
const WA_TEST_TO = process.env.WA_TEST_TO;
const ESTADO_POR_AVISAR = Number(process.env.WSP_ESTADO_POR_AVISAR ?? 1);
const GLOBAL_CONCURRENCY = Number(process.env.WSP_GLOBAL_CONCURRENCY ?? 4);
const PER_RECIPIENT_MIN_INTERVAL_MS = Number(process.env.WSP_PER_RECIPIENT_DELAY_MS ?? 4000);
const WSP_ENABLED_ENV = String(process.env.WSP_ENABLED ?? "true").toLowerCase() === "true";
const CALLBELL_SEND_URL = "https://api.callbell.eu/v1/messages/send";

// ======================================

function assertEnv() {
    const missing = [];
    if (!CALLBELL_API_KEY) missing.push("CALLBELL_API_KEY");
    if (!CALLBELL_TEMPLATE_UUID) missing.push("CALLBELL_TEMPLATE_UUID");
    if (!CALLBELL_CHANNEL_UUID) missing.push("CALLBELL_CHANNEL_UUID");
    if (FORCE_TEST_TO && !WA_TEST_TO) missing.push("WA_TEST_TO (porque FORCE_TEST_TO=true)");
    if (missing.length) logger.warn(`[WHATSAPP] Atención: Faltan variables .env: ${missing.join(", ")}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizePhone(raw) {
    if (!raw) return null;
    let digits = String(raw).replace(/[^\d]/g, "");
    if (!digits) return null;
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("598")) {
        const rest = digits.slice(3);
        if (rest.length < 7) return null;
        return `+${digits}`;
    }
    if (digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 8) return `+598${digits}`;
    if (digits.length === 9) return `+598${digits}`;
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
    return null;
}

function formatDateUY(date = new Date()) {
    return new Intl.DateTimeFormat("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatNumberUY(value, decimals = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "0";
    return new Intl.NumberFormat("es-UY", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num);
}

async function enviarTemplateWsp({ to, params }) {
    const payload = {
        to,
        from: "whatsapp",
        channel_uuid: CALLBELL_CHANNEL_UUID,
        type: "text",
        content: { text: String(params?.[0] ?? "-") },
        template_uuid: CALLBELL_TEMPLATE_UUID,
        optin_contact: true,
        template_values: (params || []).map((v) => String(v ?? "")),
    };

    // ── DIAGNÓSTICO: logear payload exacto antes de enviar ──
    logger.info('[WHATSAPP PAYLOAD]', JSON.stringify({
        to: payload.to,
        template_uuid: payload.template_uuid,
        template_values: payload.template_values,
        channel_uuid: payload.channel_uuid,
    }, null, 2));

    const { data } = await axios.post(CALLBELL_SEND_URL, payload, {
        headers: { Authorization: `Bearer ${CALLBELL_API_KEY}`, "Content-Type": "application/json" },
        timeout: 15000,
    });

    logger.info('[WHATSAPP RESPUESTA CALLBELL]', JSON.stringify(data));
    return data;
}


async function marcarOrdenEnviada(pool, ordId) {
    await pool.request()
        .input("id", sql.Int, ordId)
        .query(`
      UPDATE OrdenesDeposito
      SET OrdAvisoWsp = 1, OrdFechaAvisoWsp = GETDATE(), OrdEstadoActual = 6
      WHERE OrdIdOrden = @id
    `);
}

function createConcurrencyLimiter(maxConcurrent) {
    let active = 0; const queue = [];
    const next = () => {
        if (active >= maxConcurrent) return;
        const job = queue.shift();
        if (!job) return;
        active++;
        Promise.resolve().then(job.fn).then(job.resolve, job.reject).finally(() => { active--; next(); });
    };
    return function limit(fn) { return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); }); };
}

function createPerRecipientThrottle(minIntervalMs) {
    const nextAllowedAt = new Map(); const chains = new Map();
    return async function runForRecipient(to, fn) {
        const prev = chains.get(to) || Promise.resolve();
        const p = prev.catch(() => { }).then(async () => {
            const wait = Math.max(0, (nextAllowedAt.get(to) || 0) - Date.now());
            if (wait > 0) await sleep(wait);
            nextAllowedAt.set(to, Date.now() + minIntervalMs);
            return fn();
        });
        chains.set(to, p); return p;
    };
}

const _warnedNoCelular = new Set();

// `grupo`: filas de OrdenesDeposito del mismo pedido (NoDocERP). Se envía UN solo
// mensaje (r ya viene agregado) y se marcan todas las filas/órdenes como avisadas.
async function procesarUnaOrdenWsp(io, r, pool, throttle, grupo = [r]) {
    const codigoOrden = r.OrdCodigoOrden || "-";
    const toReal = normalizePhone(r.TelefonoTrabajo);
    const to = FORCE_TEST_TO ? normalizePhone(WA_TEST_TO) : toReal;

    if (!to) {
        if (!_warnedNoCelular.has(codigoOrden)) {
            logger.warn(`[WHATSAPP JOB] ${codigoOrden} sin celular válido.`);
            _warnedNoCelular.add(codigoOrden);
        }
        if (io) io.emit("actualizado_wsp", { codigoOrden: r.OrdCodigoOrden, ordId: r.OrdIdOrden, status: 'error', reason: 'Número de teléfono inválido o vacío' });
        return;
    }

    const params = [
        formatDateUY(new Date()),                                               // {{1}} Fecha del mensaje
        codigoOrden,                                                           // {{2}} Orden
        r.OrdNombreTrabajo || '-',                                             // {{3}} Trabajo
        r.Producto || '-',                                                     // {{4}} Producto
        formatNumberUY(r.Cantidad ?? 0, 2),                                    // {{5}} Cantidad
        `${r.MonSimbolo || '$'} ${formatNumberUY(r.CostoFinal ?? 0, 2)}`,     // {{6}} Total
    ];


    try {
        const fnSend = async () => {
            if (!CALLBELL_API_KEY) { logger.warn("[WHATSAPP] Simulando envío, sin API_KEY en .env"); return { message: { uuid: "sim-" + Date.now(), status: 'enqueued' } }; }
            return await enviarTemplateWsp({ to, params });
        };

        let sendResp;
        if (throttle) sendResp = await throttle(to, fnSend);
        else sendResp = await fnSend();

        // Marcar TODAS las filas del pedido como avisadas (un solo mensaje por pedido)
        for (const fila of grupo) {
            await marcarOrdenEnviada(pool, fila.OrdIdOrden);
        }

        // Marcar EstadoenArea = 'Avisado' en dbo.Ordenes para que quede visible en producción
        try {
            const tran = new sql.Transaction(pool);
            await tran.begin();
            try {
                const codigosGrupo = [...new Set(grupo.map(g => g.OrdCodigoOrden).filter(Boolean))];
                for (const codGrupo of codigosGrupo) {
                    const ordRes = await new sql.Request(tran)
                        .input('Cod', sql.NVarChar(50), codGrupo)
                        .query('SELECT OrdenID FROM dbo.Ordenes WHERE CodigoOrden = @Cod');
                    for (const ord of ordRes.recordset) {
                        await changeOrderState(tran, {
                            target  : { type: 'ORDER', id: ord.OrdenID },
                            estado  : 'Avisado',
                            userObj : 'Sistema (WSP)',
                            detalle : `WhatsApp de aviso enviado`,
                            guard   : "Estado NOT IN ('Entregado', 'Cancelado')",
                            io
                        });
                    }
                }
                await tran.commit();
            } catch (e) {
                await tran.rollback();
                logger.warn(`[WHATSAPP JOB] No se pudo marcar Avisado para ${codigoOrden}:`, e.message);
            }
        } catch (e) {
            logger.warn(`[WHATSAPP JOB] Error iniciando transacción para Avisado (${codigoOrden}):`, e.message);
        }

        if (io) {
            for (const fila of grupo) {
                io.emit("actualizado_wsp", { codigoOrden: fila.OrdCodigoOrden, ordId: fila.OrdIdOrden, status: 'success' });
            }
        }
        logger.info(`[WHATSAPP JOB] Enviado OK ${codigoOrden}${grupo.length > 1 ? ` (aviso único por pedido, ${grupo.length} órdenes)` : ''}`);
    } catch (err) {
        const details = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
        logger.error(`[WHATSAPP JOB] Error enviando WhatsApp - ${codigoOrden}:`, details);
        if (io) io.emit("actualizado_wsp", { codigoOrden: r.OrdCodigoOrden, ordId: r.OrdIdOrden, status: 'error', reason: `Fallo WS: ${details.substring(0, 50)}...` });
    }
}

async function procesarAvisosBatch(io) {
    assertEnv();
    const pool = await getPool();
    const query = `
  ;WITH CotiDia AS ( SELECT TOP (1) CotFecha, CotDolar FROM Cotizaciones WITH (NOLOCK) ORDER BY CotFecha DESC )
  SELECT
    Ord.OrdIdOrden,
    Cli.TelefonoTrabajo,
    Ord.OrdCodigoOrden,
    Ord.OrdNombreTrabajo,
    Ord.OrdEstadoActual,
    Ped.NoDocERP,
    LTRIM(RTRIM(Pro.Descripcion))              AS Producto,
    CAST(Ord.OrdCantidad   AS decimal(18,2))   AS Cantidad,
    CAST(Ord.OrdCostoFinal AS decimal(18,2))   AS CostoFinal,
    Mon.MonIdMoneda,
    Mon.MonSimbolo,
    ISNULL(Cd.CotDolar, NULL)                  AS CotDolarDia
  FROM OrdenesDeposito Ord WITH (NOLOCK)
  JOIN Clientes Cli WITH (NOLOCK) ON Cli.CliIdCliente = Ord.CliIdCliente
  LEFT JOIN Articulos Pro WITH (NOLOCK) ON Pro.ProIdProducto = Ord.ProIdProducto
  JOIN Monedas Mon WITH (NOLOCK) ON Mon.MonIdMoneda = Ord.MonIdMoneda
  LEFT JOIN CotiDia Cd ON 1 = 1
  OUTER APPLY (
    SELECT TOP 1 O2.NoDocERP
    FROM dbo.Ordenes O2 WITH (NOLOCK)
    WHERE O2.CodigoOrden = Ord.OrdCodigoOrden
  ) Ped
  WHERE (
      Ord.OrdEstadoActual IN (@Estado, 6)
      AND ISNULL(Ord.OrdAvisoWsp, 0) = 0
      AND Cli.TelefonoTrabajo IS NOT NULL
      -- GATE PEDIDO COMPLETO: no avisar si alguna orden hermana del pedido
      -- (cualquier área) aún no llegó a depósito
      AND (
          Ped.NoDocERP IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM dbo.Ordenes oh WITH (NOLOCK)
              WHERE oh.NoDocERP = Ped.NoDocERP
                AND UPPER(LTRIM(RTRIM(ISNULL(oh.Estado, '')))) <> 'CANCELADO'
                AND UPPER(LTRIM(RTRIM(ISNULL(oh.EstadoenArea, '')))) <> 'CANCELADO'
                AND UPPER(LTRIM(RTRIM(ISNULL(oh.EstadoenArea, '')))) NOT IN
                    ('INGRESADO', 'AVISADO', 'ENTREGADO', 'FINALIZADO')
                AND UPPER(LTRIM(RTRIM(ISNULL(oh.Estado, '')))) NOT IN
                    ('INGRESADO', 'AVISADO', 'ENTREGADO', 'FINALIZADO')
          )
      )
      -- GATE BULTOS (solo controla el CUÁNDO, no toca el mensaje): si la fila aún no pasó
      -- por el gate WMS (BultosEsperados NULL = la creó el pistoleo directo), no avisar
      -- mientras el pedido tenga bultos físicos (PROD_TERMINADO vivos, ni procesados ni
      -- perdidos) sin llegar al depósito. Las filas gestionadas por el gate (completas o
      -- FORZADAS, con contadores escritos) avisan normal.
      AND NOT (
          Ord.BultosEsperados IS NULL
          AND EXISTS (
              SELECT 1
              FROM dbo.Ordenes oh3 WITH (NOLOCK)
              JOIN dbo.Logistica_Bultos b3 WITH (NOLOCK)
                ON b3.OrdenID = oh3.OrdenID
               AND b3.Tipocontenido = 'PROD_TERMINADO'
               AND b3.Estado NOT IN ('PROCESADO', 'PERDIDO')
              WHERE (
                    (Ped.NoDocERP IS NOT NULL AND oh3.NoDocERP = Ped.NoDocERP)
                 OR (Ped.NoDocERP IS NULL AND oh3.CodigoOrden = Ord.OrdCodigoOrden)
              )
                AND UPPER(LTRIM(RTRIM(ISNULL(oh3.Estado, '')))) <> 'CANCELADO'
                AND NOT (b3.Estado = 'EN_STOCK' AND b3.UbicacionActual = 'DEPOSITO')
          )
      )
  )
  OR Ord.OrdEstadoActual = 12;
  `;
    const result = await pool.request().input("Estado", sql.Int, ESTADO_POR_AVISAR).query(query);
    const rows = result.recordset || [];
    logger.info(`[WHATSAPP JOB] Tick — estadoBuscado=${ESTADO_POR_AVISAR}, candidatas=${rows.length}`);
    if (!rows.length) return;

    // ── AVISO POR ORDEN (cada material su mensaje) ──
    // La plantilla de Callbell tiene campos fijos de UN material: cada orden envía su
    // propio WhatsApp con su producto/cantidad/importe, sin tocar el formato del mensaje.
    // El CUÁNDO lo controla el gate de bultos por pedido (receiveDispatch): las órdenes
    // hermanas pasan a estado 1 juntas recién cuando el pedido está físicamente completo,
    // así que los mensajes del pedido salen en la misma corrida (espaciados por el throttle).
    const grupos = new Map();
    for (const r of rows) {
        const key = `ROW:${r.OrdIdOrden}`;
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push(r);
    }

    const buildFilaEnvio = (grupo) => {
        if (grupo.length === 1) return grupo[0];
        // Código base sin sufijo (n/m); si hay varias áreas, unir códigos distintos
        const codigosBase = [...new Set(grupo.map(g => (g.OrdCodigoOrden || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim()))];
        return {
            ...grupo[0],
            OrdCodigoOrden: codigosBase.join(' + '),
            Cantidad: grupo.reduce((s, g) => s + (parseFloat(g.Cantidad) || 0), 0),
            CostoFinal: grupo.reduce((s, g) => s + (parseFloat(g.CostoFinal) || 0), 0),
        };
    };

    const limit = createConcurrencyLimiter(GLOBAL_CONCURRENCY);
    const throttle = createPerRecipientThrottle(PER_RECIPIENT_MIN_INTERVAL_MS);

    const tasks = [...grupos.values()].map((grupo) =>
        limit(() => procesarUnaOrdenWsp(io, buildFilaEnvio(grupo), pool, throttle, grupo))
    );
    await Promise.allSettled(tasks);
}

let timeoutId = null;

async function runWspLoop(io) {
    let mins = 1;
    let dbEnabled = true;

    try {
        const pool = await getPool();
        const resConf = await pool.request().query("SELECT Valor FROM ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = 'IntervaloAviso'");
        if (resConf.recordset.length > 0) { mins = Number(resConf.recordset[0].Valor) || 1; }

        const resConfEnable = await pool.request().query("SELECT Valor FROM ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = 'ActivarAvisosWSP'");
        if (resConfEnable.recordset.length > 0) {
            const val = String(resConfEnable.recordset[0].Valor).toLowerCase();
            dbEnabled = val === "1" || val === "true";
        }
    } catch (e) { }

    if (WSP_ENABLED_ENV && dbEnabled) {
        try { await procesarAvisosBatch(io); } catch (e) { logger.error("[WHATSAPP JOB] Error general:", e.message); }
    } else {
        logger.info(`[WHATSAPP JOB] Tick omitido — WSP_ENABLED(env)=${WSP_ENABLED_ENV}, ActivarAvisosWSP(DB)=${dbEnabled}`);
    }

    const msec = Math.max(1, mins) * 60000;
    timeoutId = setTimeout(() => runWspLoop(io), msec);
}

function startWspJob(io) {
    assertEnv();
    logger.info("⏱️ [CRON] WhatsApp Avisos Activado.");
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => runWspLoop(io), 5000); // initial start in 5s
}

module.exports = { startWspJob, procesarUnaOrdenWsp, normalizePhone };
