/**
 * Auditoría de Depósito — sesión + fotografía (snapshot) + registro permanente de casos.
 *
 * Dos capas separadas (ver docs/Auditoria deposito/ESPEC_registro_de_casos.md):
 *   - AUDITORÍA: un evento. Al ABRIR se congela la fotografía de las órdenes activas
 *     (AuditoriaDepositoSnapshot) y los escaneos de la pistola se guardan contra esa sesión.
 *     Todos los hallazgos se calculan CONTRA LA FOTOGRAFÍA, nunca contra la tabla viva.
 *   - CASO: un problema concreto sobre una orden concreta, con su historia. Es permanente:
 *     una auditoría no genera una lista nueva, alimenta el registro que ya existe.
 *
 * Invariantes (no se rompen):
 *   1. Un solo caso vivo por (orden, tipo): lo garantiza la base (índices únicos filtrados).
 *   2. La identidad del caso es OrdenesDeposito.OrdIdOrden, NUNCA el código.
 *   3. El auto-cierre solo toca casos cuya orden estuvo en el alcance de la auditoría.
 *   4. Hallazgos contra el snapshot.
 *   5. Ningún caso pasa a ASUMIDO sin motivo y sin responsable (también CHECK en la base).
 *   6. Lo que se movió durante la auditoría (entró o salió del depósito) NO genera caso.
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { prefijoDe, claveSinPrefijo, SQL_JOIN_PAGO_DOC } = require('./auditDepositoSql');

const TIPOS = {
    FALTANTE:      { nombre: 'Faltante físico',             fisico: true  },
    SOBRANTE:      { nombre: 'Sobrante (figura entregada)',  fisico: true  },
    SIN_INGRESO:   { nombre: 'Sin ingreso a depósito',      fisico: true  },
    NO_REGISTRADA: { nombre: 'Sin registro en el sistema',  fisico: true  },
    SIN_AVISO:     { nombre: 'Cliente sin aviso',           fisico: false },
    PERMANENCIA:   { nombre: 'Excede plazo en depósito',    fisico: false },
};
const TIPOS_DEFAULT = Object.keys(TIPOS).join(',');
const ESTADOS_VIVOS = ['ABIERTO', 'EN_CURSO', 'ESPERANDO'];
const ESTADOS_CERRADOS = ['RESUELTO', 'ASUMIDO'];
// Estados de OrdenesDeposito en los que la orden YA debería tener aviso al cliente
// (5 Para avisar, 6 Avisado, 7 Pronto para entregar, 12 Avisar nuevamente). 1 Ingresado y
// 13 Esperando Bultos todavía no están para avisar.
const ESTADOS_AVISABLES = [5, 6, 7, 12];

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const usuarioDe = (u) => ({
    id: u && u.id != null && Number.isFinite(Number(u.id)) ? Number(u.id) : null,
    nombre: String((u && (u.name || u.username)) || 'sistema').slice(0, 100),
});
const listaCsv = (v) => String(v || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const diasEntre = (desde, hasta) => Math.floor((new Date(hasta) - new Date(desde)) / 86400000);
const esDuplicadoUnico = (err) => err && (err.number === 2601 || err.number === 2627);

/* ═══════════════════════════════ CONFIGURACIÓN ═══════════════════════════════ */

async function leerConfig(exec) {
    const r = await exec.request().query(`
        SELECT Clave, Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK)
        WHERE Clave IN ('DIAS_MAX_DEPOSITO','AUDIT_DEP_UMBRAL_VALOR_ALTA','AUDIT_DEP_DIAS_SIN_AVISO','AUDIT_DEP_TIPOS_ACTIVOS')`);
    const map = {};
    r.recordset.forEach(x => { map[String(x.Clave).trim()] = x.Valor; });
    const tipos = listaCsv(map.AUDIT_DEP_TIPOS_ACTIVOS || TIPOS_DEFAULT).filter(t => TIPOS[t]);
    let cotDolar = 40;
    try {
        const c = await exec.request().query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones WITH(NOLOCK) ORDER BY CotFecha DESC');
        cotDolar = parseFloat(c.recordset[0] && c.recordset[0].CotDolar) || 40;
    } catch (e) { logger.warn('[AUDIT-DEP] Sin cotización, uso 40: ' + e.message); }
    return {
        diasMax: parseInt(map.DIAS_MAX_DEPOSITO, 10) || 15,
        umbralValorAlta: parseFloat(map.AUDIT_DEP_UMBRAL_VALOR_ALTA) || 5000,
        diasSinAviso: parseInt(map.AUDIT_DEP_DIAS_SIN_AVISO, 10) || 3,
        tiposActivos: tipos.length ? tipos : Object.keys(TIPOS),
        cotDolar,
    };
}

/* ═══════════════════════════════ SESIÓN ═══════════════════════════════ */

async function obtenerSesionAbierta(exec) {
    const r = await exec.request().query(`SELECT TOP 1 * FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudEstado = 'ABIERTA'`);
    return r.recordset[0] || null;
}

// Contadores en vivo de la sesión (para la barra de la pantalla). Nada de esto es un "hallazgo":
// hasta cerrar, lo no escaneado es solo "pendiente de escaneo".
async function contadoresSesion(exec, audId) {
    const r = await exec.request().input('A', sql.Int, audId).query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoSnapshot WHERE AudId = @A) AS snapshotCant,
          (SELECT COUNT(DISTINCT OrdIdOrden) FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Resultado = 'OK' AND Duplicado = 0) AS escaneadas,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Duplicado = 0) AS escaneos,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Duplicado = 1) AS duplicados,
          (SELECT COUNT(DISTINCT OrdIdOrden) FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Resultado = 'ENTREGADA' AND Duplicado = 0) AS sobrantes,
          (SELECT COUNT(DISTINCT Codigo) FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Resultado = 'SIN_INGRESO' AND Duplicado = 0) AS sinIngreso,
          (SELECT COUNT(DISTINCT Codigo) FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Resultado = 'DESCONOCIDO' AND Duplicado = 0) AS desconocidos,
          (SELECT COUNT(DISTINCT Codigo) FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Resultado = 'FUERA_ALCANCE' AND Duplicado = 0) AS fueraAlcance,
          (SELECT COUNT(DISTINCT Codigo) FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Resultado = 'INGRESO_POSTERIOR' AND Duplicado = 0) AS ingresoPosterior`);
    const c = r.recordset[0];
    return { ...c, sinEscanear: c.snapshotCant - c.escaneadas };
}

function sesionPublica(row, contadores) {
    if (!row) return null;
    return {
        audId: row.AudId,
        codigo: row.AudCodigo,
        estado: row.AudEstado,
        alcanceTipo: row.AudAlcanceTipo,
        alcanceValor: row.AudAlcanceValor,
        alcanceTexto: row.AudAlcanceTipo === 'TOTAL' ? 'depósito completo' : `solo ${row.AudAlcanceValor}`,
        tiposActivos: listaCsv(row.AudTiposActivos),
        esLineaBase: !!row.AudEsLineaBase,
        fechaApertura: row.AudFechaApertura,
        usuarioApertura: row.AudUsuarioAperturaNombre,
        fechaCierre: row.AudFechaCierre,
        usuarioCierre: row.AudUsuarioCierreNombre,
        cotizacionDolar: row.AudCotizacionDolar,
        diasMaxDeposito: row.AudDiasMaxDeposito,
        snapshotCant: row.AudSnapshotCant,
        escaneosCant: row.AudEscaneosCant,
        escaneosDuplicados: row.AudEscaneosDuplicados,
        nuevos: row.AudNuevos, existentes: row.AudExistentes, reincidentes: row.AudReincidentes,
        resueltos: row.AudResueltos, abiertosTotal: row.AudAbiertosTotal, movidas: row.AudMovidas,
        observaciones: row.AudObservaciones,
        resumen: row.AudResumenJson ? safeJson(row.AudResumenJson) : null,
        contadores: contadores || null,
    };
}
const safeJson = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

/** Estado del módulo para la pantalla: sesión abierta (si hay), última cerrada, escaneos sueltos pendientes. */
async function estadoModulo() {
    const pool = await getPool();
    const abierta = await obtenerSesionAbierta(pool);
    const contadores = abierta ? await contadoresSesion(pool, abierta.AudId) : null;
    const ult = await pool.request().query(`SELECT TOP 1 * FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudEstado = 'CERRADA' ORDER BY AudFechaCierre DESC, AudId DESC`);
    const cnt = await pool.request().query(`
        SELECT (SELECT COUNT(*) FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudEstado = 'CERRADA') AS cerradas,
               (SELECT COUNT(*) FROM dbo.AuditoriaScansTemp WITH(NOLOCK)) AS escaneosSueltos`);
    const cfg = await leerConfig(pool);
    return {
        sesion: sesionPublica(abierta, contadores),
        ultimaCerrada: sesionPublica(ult.recordset[0] || null),
        auditoriasCerradas: cnt.recordset[0].cerradas,
        escaneosSueltos: cnt.recordset[0].escaneosSueltos,
        config: { diasMax: cfg.diasMax, umbralValorAlta: cfg.umbralValorAlta, diasSinAviso: cfg.diasSinAviso, tiposActivos: cfg.tiposActivos },
        tipos: TIPOS,
    };
}

/** Prefijos de área con órdenes activas hoy (para elegir el alcance). */
async function listarPrefijosActivos() {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT LEFT(OrdCodigoOrden, CHARINDEX('-', OrdCodigoOrden + '-') - 1) AS prefijo, COUNT(*) AS n
        FROM dbo.OrdenesDeposito WITH(NOLOCK)
        WHERE (OrdEstadoActual < 9 OR OrdEstadoActual IS NULL) AND OrdCodigoOrden LIKE '%-%'
        GROUP BY LEFT(OrdCodigoOrden, CHARINDEX('-', OrdCodigoOrden + '-') - 1)
        ORDER BY n DESC`);
    return r.recordset.map(x => ({ prefijo: String(x.prefijo).trim().toUpperCase(), n: x.n }));
}

/**
 * ABRIR: toma la fotografía y deja la sesión abierta. Solo puede haber una (índice único filtrado).
 * La PRIMERA auditoría cerrada del sistema no existe todavía → esta es LÍNEA BASE: solo tipos físicos.
 */
async function abrirAuditoria({ usuario, alcanceTipo = 'TOTAL', alcanceValor = null, importarPrevios = false, observaciones = null }) {
    const pool = await getPool();
    const u = usuarioDe(usuario);
    const tipoAlc = String(alcanceTipo || 'TOTAL').toUpperCase();
    if (!['TOTAL', 'PREFIJO'].includes(tipoAlc)) throw httpError(400, 'Alcance inválido: debe ser TOTAL o PREFIJO.');
    const prefijos = tipoAlc === 'PREFIJO' ? listaCsv(alcanceValor).filter(p => /^[A-Z]+$/.test(p)) : [];
    if (tipoAlc === 'PREFIJO' && !prefijos.length) throw httpError(400, 'Para el alcance por prefijo hay que indicar al menos un prefijo de área (ej. SUB,DTF).');

    const cfg = await leerConfig(pool);
    const cerradas = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudEstado = 'CERRADA'`);
    const esLineaBase = cerradas.recordset[0].n === 0;
    // Trampa de la primera corrida: la línea base solo mira diferencias físicas.
    const tiposActivos = esLineaBase ? cfg.tiposActivos.filter(t => TIPOS[t].fisico) : cfg.tiposActivos;

    const tran = pool.transaction();
    await tran.begin();
    try {
        const rq = () => tran.request();
        const cod = await rq().query(`
            SELECT FORMAT(GETDATE(), 'yyyy-MMdd') AS f,
                   (SELECT COUNT(*) FROM dbo.AuditoriaDeposito WHERE CAST(AudFechaApertura AS DATE) = CAST(GETDATE() AS DATE)) AS n`);
        const codigo = `AUD-${cod.recordset[0].f}-${String(cod.recordset[0].n + 1).padStart(2, '0')}`;

        let audId;
        try {
            const ins = await rq()
                .input('Cod', sql.VarChar(30), codigo)
                .input('AlcT', sql.VarChar(10), tipoAlc)
                .input('AlcV', sql.VarChar(200), prefijos.length ? prefijos.join(',') : null)
                .input('Tipos', sql.VarChar(200), tiposActivos.join(','))
                .input('LB', sql.Bit, esLineaBase ? 1 : 0)
                .input('UId', sql.Int, u.id)
                .input('UNom', sql.VarChar(100), u.nombre)
                .input('Cot', sql.Decimal(18, 4), cfg.cotDolar)
                .input('DiasMax', sql.Int, cfg.diasMax)
                .input('Obs', sql.NVarChar(500), observaciones ? String(observaciones).slice(0, 500) : null)
                .query(`
                    INSERT INTO dbo.AuditoriaDeposito
                        (AudCodigo, AudEstado, AudAlcanceTipo, AudAlcanceValor, AudTiposActivos, AudEsLineaBase,
                         AudUsuarioApertura, AudUsuarioAperturaNombre, AudCotizacionDolar, AudDiasMaxDeposito, AudObservaciones)
                    OUTPUT inserted.AudId
                    VALUES (@Cod, 'ABIERTA', @AlcT, @AlcV, @Tipos, @LB, @UId, @UNom, @Cot, @DiasMax, @Obs)`);
            audId = ins.recordset[0].AudId;
        } catch (e) {
            if (esDuplicadoUnico(e)) throw httpError(409, 'Ya hay una auditoría abierta. Cerrala o anulala antes de abrir otra.');
            throw e;
        }

        // ── LA FOTOGRAFÍA: copia, no referencia ──
        const snapReq = rq().input('A', sql.Int, audId).input('Cot', sql.Decimal(18, 4), cfg.cotDolar);
        let filtroPrefijo = '';
        if (prefijos.length) {
            filtroPrefijo = ' AND LEFT(o.OrdCodigoOrden, CHARINDEX(\'-\', o.OrdCodigoOrden + \'-\') - 1) IN (' +
                prefijos.map((p, i) => { snapReq.input(`p${i}`, sql.VarChar(10), p); return `@p${i}`; }).join(',') + ')';
        }
        await snapReq.query(`
            INSERT INTO dbo.AuditoriaDepositoSnapshot
                (AudId, OrdIdOrden, OrdCodigoOrden, Prefijo, ClaveCodigo, CliIdCliente, ClienteNombre, ClienteTipo,
                 ClienteTelefono, ClienteEmail, OrdNombreTrabajo, OrdEstadoActual, OrdFechaIngresoOrden, OrdFechaEstadoActual,
                 OrdAvisoWsp, OrdFechaAvisoWsp, OrdCostoFinal, MonIdMoneda, ValorPesos, PagIdPago, OReIdOrdenRetiro, FormaRetiro,
                 BultosEsperados, BultosRecibidos, Estante, DiasEnDeposito)
            SELECT @A, o.OrdIdOrden,
                   UPPER(LTRIM(RTRIM(o.OrdCodigoOrden))),
                   CASE WHEN o.OrdCodigoOrden LIKE '%-%' THEN UPPER(LEFT(o.OrdCodigoOrden, CHARINDEX('-', o.OrdCodigoOrden) - 1)) ELSE NULL END,
                   UPPER(LTRIM(RTRIM(CASE WHEN o.OrdCodigoOrden LIKE '%-%' THEN SUBSTRING(o.OrdCodigoOrden, CHARINDEX('-', o.OrdCodigoOrden) + 1, 20) ELSE o.OrdCodigoOrden END))),
                   o.CliIdCliente, c.Nombre, tc.TClDescripcion, c.TelefonoTrabajo, c.Email,
                   o.OrdNombreTrabajo, o.OrdEstadoActual, o.OrdFechaIngresoOrden, o.OrdFechaEstadoActual,
                   o.OrdAvisoWsp, o.OrdFechaAvisoWsp, o.OrdCostoFinal, o.MonIdMoneda,
                   CASE WHEN o.MonIdMoneda = 2 THEN ROUND(ISNULL(o.OrdCostoFinal, 0) * @Cot, 2) ELSE ROUND(ISNULL(o.OrdCostoFinal, 0), 2) END,
                   o.PagIdPago, o.OReIdOrdenRetiro, r.FormaRetiro, o.BultosEsperados, o.BultosRecibidos,
                   est.Estante,
                   CASE WHEN o.OrdFechaIngresoOrden IS NULL THEN 0 ELSE DATEDIFF(day, o.OrdFechaIngresoOrden, GETDATE()) END
            FROM dbo.OrdenesDeposito o WITH(NOLOCK)
            LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
            LEFT JOIN dbo.TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            LEFT JOIN dbo.OrdenesRetiro r WITH(NOLOCK) ON r.OReIdOrdenRetiro = o.OReIdOrdenRetiro
            OUTER APPLY (
                SELECT TOP 1 RTRIM(e.EstanteID) + '-' + CAST(e.Seccion AS VARCHAR(10)) + '-' + CAST(e.Posicion AS VARCHAR(10)) AS Estante
                FROM dbo.OcupacionEstantes e WITH(NOLOCK)
                WHERE r.OReIdOrdenRetiro IS NOT NULL
                  AND e.OrdenRetiro = COALESCE(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR(20))
            ) est
            WHERE (o.OrdEstadoActual < 9 OR o.OrdEstadoActual IS NULL)${filtroPrefijo}`);

        // Situación de pago congelada con la MISMA lógica que la pestaña (pago vía documento incluido).
        await rq().input('A', sql.Int, audId).query(`
            UPDATE o SET
                o.SaldadaPorDoc = CASE WHEN o.PagIdPago IS NULL AND doc.DocIdDocumento IS NOT NULL
                                        AND (doc.DocPagado = 1 OR (ISNULL(dd.DeudasTotales, 0) > 0 AND ISNULL(dd.DeudasVivas, 0) = 0))
                                       THEN 1 ELSE 0 END,
                o.PagoEstado = CASE
                    WHEN o.PagIdPago IS NOT NULL THEN 'Pagado'
                    WHEN doc.DocIdDocumento IS NOT NULL THEN
                        CASE WHEN (doc.DocPagado = 1 OR (ISNULL(dd.DeudasTotales, 0) > 0 AND ISNULL(dd.DeudasVivas, 0) = 0))
                             THEN 'Pagado (' ELSE 'Facturado - impago (' END
                        + ISNULL(NULLIF(CONCAT_WS('-', NULLIF(LTRIM(RTRIM(CAST(doc.DocSerie AS VARCHAR(20)))), ''),
                                                       NULLIF(LTRIM(RTRIM(CAST(doc.DocNumero AS VARCHAR(30)))), '')), ''),
                                 'Doc ' + CAST(doc.DocIdDocumento AS VARCHAR(20))) + ')'
                    WHEN mv.Cod IS NOT NULL THEN 'En cta. cte. (sin facturar)'
                    ELSE 'Pendiente' END
            FROM dbo.AuditoriaDepositoSnapshot o${SQL_JOIN_PAGO_DOC}
            WHERE o.AudId = @A`);

        const sesRow = (await rq().input('A', sql.Int, audId).query(`SELECT * FROM dbo.AuditoriaDeposito WHERE AudId = @A`)).recordset[0];

        // Escaneos sueltos hechos ANTES de abrir (tabla temporal vieja): se importan solo si se pidió.
        let importados = 0;
        if (importarPrevios) {
            const prev = await rq().query(`SELECT Codigo, Fecha FROM dbo.AuditoriaScansTemp ORDER BY Fecha ASC`);
            for (const p of prev.recordset) {
                await registrarEscaneo({ exec: tran, sesion: sesRow, codigo: p.Codigo, usuario, fecha: p.Fecha });
                importados++;
            }
            if (importados) await rq().query(`DELETE FROM dbo.AuditoriaScansTemp`);
        }

        await rq().input('A', sql.Int, audId).query(`
            UPDATE dbo.AuditoriaDeposito SET AudSnapshotCant = (SELECT COUNT(*) FROM dbo.AuditoriaDepositoSnapshot WHERE AudId = @A) WHERE AudId = @A`);
        await tran.commit();

        const abierta = await obtenerSesionAbierta(pool);
        const contadores = await contadoresSesion(pool, abierta.AudId);
        logger.info(`[AUDIT-DEP] ${codigo} abierta por ${u.nombre} (alcance ${tipoAlc}${prefijos.length ? ' ' + prefijos.join(',') : ''}, fotografía ${contadores.snapshotCant} órdenes, línea base=${esLineaBase})`);
        return { sesion: sesionPublica(abierta, contadores), importados };
    } catch (e) {
        try { await tran.rollback(); } catch (_) { /* ya cerrada */ }
        throw e;
    }
}

/* ═══════════════════════════════ ESCANEO ═══════════════════════════════ */

/**
 * Resuelve QUÉ orden es la etiqueta leída.
 *   9471/B11575  → Logistica_Bultos.CodigoEtiqueta → Ordenes.CodigoOrden exacto (SUB-9471). Distingue órdenes hermanas.
 *   SUB-9471     → código exacto.
 *   9471         → por clave sin prefijo (si hay hermanas activas, prefiere la que aún no se escaneó).
 * Orden de búsqueda: fotografía → OrdenesDeposito viva → Ordenes (producción) → desconocido.
 */
async function resolverCodigo(exec, sesion, raw) {
    const base = raw.split('/')[0];
    const clave = claveSinPrefijo(raw);
    let codigoExacto = prefijoDe(base) ? base : null;
    let ordenProdId = null;
    let clienteProd = null;

    if (raw.includes('/B')) {
        const b = await exec.request().input('et', sql.NVarChar(100), raw).query(`
            SELECT TOP 1 b.OrdenID, o.CodigoOrden, o.Cliente
            FROM dbo.Logistica_Bultos b WITH(NOLOCK)
            JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = b.OrdenID
            WHERE b.CodigoEtiqueta = @et AND b.Tipocontenido = 'PROD_TERMINADO'`);
        if (b.recordset.length) {
            codigoExacto = String(b.recordset[0].CodigoOrden || '').trim().toUpperCase() || null;
            ordenProdId = b.recordset[0].OrdenID;
            clienteProd = b.recordset[0].Cliente;
        }
    }

    // 1) La fotografía
    const rqSnap = exec.request().input('A', sql.Int, sesion.AudId);
    let whereSnap;
    if (codigoExacto) { rqSnap.input('cod', sql.VarChar(100), codigoExacto); whereSnap = 's.OrdCodigoOrden = @cod'; }
    else { rqSnap.input('clave', sql.VarChar(100), clave); whereSnap = 's.ClaveCodigo = @clave'; }
    const snap = await rqSnap.query(`
        SELECT TOP 1 s.OrdIdOrden, s.OrdCodigoOrden, s.ClienteNombre, s.Prefijo,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.AuditoriaDepositoEscaneo e WHERE e.AudId = s.AudId AND e.OrdIdOrden = s.OrdIdOrden AND e.Duplicado = 0)
                    THEN 1 ELSE 0 END AS YaEscaneada
        FROM dbo.AuditoriaDepositoSnapshot s
        WHERE s.AudId = @A AND ${whereSnap}
        ORDER BY YaEscaneada ASC, s.OrdIdOrden ASC`);
    if (snap.recordset.length) {
        const s = snap.recordset[0];
        return { resultado: 'OK', ordIdOrden: s.OrdIdOrden, ordenCodigo: s.OrdCodigoOrden, cliente: s.ClienteNombre, prefijo: s.Prefijo, ordenProdId, ordenYaEscaneada: !!s.YaEscaneada };
    }

    // 2) OrdenesDeposito viva (no estaba en la fotografía: entregada, ingresó después o es de otra área)
    const rqVivo = exec.request();
    let whereVivo;
    if (codigoExacto) { rqVivo.input('cod', sql.VarChar(100), codigoExacto); whereVivo = 'UPPER(LTRIM(RTRIM(o.OrdCodigoOrden))) = @cod'; }
    else { rqVivo.input('clave', sql.VarChar(100), clave); whereVivo = `UPPER(LTRIM(RTRIM(CASE WHEN o.OrdCodigoOrden LIKE '%-%' THEN SUBSTRING(o.OrdCodigoOrden, CHARINDEX('-', o.OrdCodigoOrden) + 1, 20) ELSE o.OrdCodigoOrden END))) = @clave`; }
    const vivo = await rqVivo.query(`
        SELECT TOP 1 o.OrdIdOrden, UPPER(LTRIM(RTRIM(o.OrdCodigoOrden))) AS OrdCodigoOrden, o.OrdEstadoActual, c.Nombre AS ClienteNombre
        FROM dbo.OrdenesDeposito o WITH(NOLOCK)
        LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
        WHERE ${whereVivo}
        ORDER BY CASE WHEN o.OrdEstadoActual < 9 OR o.OrdEstadoActual IS NULL THEN 0 ELSE 1 END, o.OrdIdOrden DESC`);
    if (vivo.recordset.length) {
        const v = vivo.recordset[0];
        const pref = prefijoDe(v.OrdCodigoOrden);
        const activa = v.OrdEstadoActual === null || v.OrdEstadoActual < 9;
        let resultado = 'ENTREGADA';
        if (activa) {
            const fueraAlcance = sesion.AudAlcanceTipo === 'PREFIJO' && !listaCsv(sesion.AudAlcanceValor).includes(pref || '');
            resultado = fueraAlcance ? 'FUERA_ALCANCE' : 'INGRESO_POSTERIOR';
        }
        return { resultado, ordIdOrden: v.OrdIdOrden, ordenCodigo: v.OrdCodigoOrden, cliente: v.ClienteNombre, prefijo: pref, ordenProdId, ordenYaEscaneada: false };
    }

    // 3) Existe en producción (Ordenes) pero nunca se pistoleó al depósito
    if (ordenProdId) {
        return { resultado: 'SIN_INGRESO', ordIdOrden: null, ordenCodigo: codigoExacto, cliente: clienteProd, prefijo: prefijoDe(codigoExacto), ordenProdId, ordenYaEscaneada: false };
    }
    const rqProd = exec.request();
    let whereProd;
    if (codigoExacto) { rqProd.input('cod', sql.VarChar(100), codigoExacto); whereProd = 'UPPER(LTRIM(RTRIM(o.CodigoOrden))) = @cod'; }
    else { rqProd.input('clave', sql.VarChar(100), clave); whereProd = 'UPPER(LTRIM(RTRIM(o.NoDocERP))) = @clave'; }
    const prod = await rqProd.query(`
        SELECT TOP 1 o.OrdenID, UPPER(LTRIM(RTRIM(o.CodigoOrden))) AS CodigoOrden, o.Cliente
        FROM dbo.Ordenes o WITH(NOLOCK) WHERE ${whereProd} ORDER BY o.OrdenID DESC`);
    if (prod.recordset.length) {
        const p = prod.recordset[0];
        return { resultado: 'SIN_INGRESO', ordIdOrden: null, ordenCodigo: p.CodigoOrden, cliente: p.Cliente, prefijo: prefijoDe(p.CodigoOrden), ordenProdId: p.OrdenID, ordenYaEscaneada: false };
    }

    // 4) No existe en ningún lado
    return { resultado: 'DESCONOCIDO', ordIdOrden: null, ordenCodigo: null, cliente: null, prefijo: prefijoDe(base), ordenProdId: null, ordenYaEscaneada: false };
}

/** Registra UNA lectura de la pistola dentro de la sesión. La misma etiqueta dos veces se guarda como Duplicado=1 (no suma). */
async function registrarEscaneo({ exec, sesion, codigo, usuario, fecha = null }) {
    const raw = String(codigo || '').trim().toUpperCase();
    if (!raw) throw httpError(400, 'Código vacío.');
    if (raw.length > 100) throw httpError(400, 'Código demasiado largo.');
    const u = usuarioDe(usuario);
    const ejec = exec || await getPool();

    const dup = await ejec.request().input('A', sql.Int, sesion.AudId).input('c', sql.VarChar(100), raw)
        .query(`SELECT TOP 1 EscId FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Codigo = @c AND Duplicado = 0`);
    const esDuplicado = dup.recordset.length > 0;

    const r = await resolverCodigo(ejec, sesion, raw);
    const ins = ejec.request()
        .input('A', sql.Int, sesion.AudId)
        .input('c', sql.VarChar(100), raw)
        .input('clave', sql.VarChar(50), claveSinPrefijo(raw))
        .input('oid', sql.Int, r.ordIdOrden)
        .input('pid', sql.Int, r.ordenProdId)
        .input('res', sql.VarChar(20), r.resultado)
        .input('dup', sql.Bit, esDuplicado ? 1 : 0)
        .input('uid', sql.Int, u.id)
        .input('unom', sql.VarChar(100), u.nombre);
    let fechaSql = 'GETDATE()';
    if (fecha) { ins.input('f', sql.DateTime, new Date(fecha)); fechaSql = '@f'; }
    await ins.query(`
        INSERT INTO dbo.AuditoriaDepositoEscaneo (AudId, Codigo, ClaveCodigo, OrdIdOrden, OrdenProdId, Resultado, Duplicado, Fecha, UsuarioId, UsuarioNombre)
        VALUES (@A, @c, @clave, @oid, @pid, @res, @dup, ${fechaSql}, @uid, @unom)`);

    return { codigo: raw, duplicado: esDuplicado, ...r };
}

async function quitarEscaneo({ sesion, codigo }) {
    const raw = String(codigo || '').trim().toUpperCase();
    const pool = await getPool();
    const r = await pool.request().input('A', sql.Int, sesion.AudId).input('c', sql.VarChar(100), raw)
        .query(`DELETE FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A AND Codigo = @c`);
    return { borrados: r.rowsAffected[0] || 0 };
}

/**
 * Clasificación EN VIVO de la sesión, con la misma forma que devuelve la pantalla hoy
 * (totales / faltaEnDeposito / sobraEnDeposito / ok / olvidadas / desconocido), calculada contra la
 * fotografía. "faltaEnDeposito" acá significa SIN ESCANEAR TODAVÍA: no es un hallazgo hasta cerrar.
 */
async function clasificarSesion(exec, sesion) {
    const rq = () => exec.request().input('A', sql.Int, sesion.AudId);
    const [snap, esc] = await Promise.all([
        rq().query(`SELECT * FROM dbo.AuditoriaDepositoSnapshot WITH(NOLOCK) WHERE AudId = @A ORDER BY OrdCodigoOrden`),
        rq().query(`
            SELECT e.EscId, e.Codigo, e.OrdIdOrden, e.OrdenProdId, e.Resultado, e.Duplicado, e.Fecha, e.UsuarioNombre,
                   COALESCE(s.OrdCodigoOrden, v.OrdCodigoOrden, po.CodigoOrden) AS OrdenCodigo,
                   COALESCE(s.ClienteNombre, cv.Nombre, po.Cliente) AS Cliente,
                   v.OrdEstadoActual AS EstadoVivo, v.OrdFechaIngresoOrden AS IngresoVivo, v.OReIdOrdenRetiro AS RetiroVivo, rv.FormaRetiro AS FormaRetiroVivo,
                   tcv.TClDescripcion AS ClienteTipoVivo, cv.TelefonoTrabajo AS TelVivo, cv.Email AS EmailVivo, v.PagIdPago AS PagVivo
            FROM dbo.AuditoriaDepositoEscaneo e WITH(NOLOCK)
            LEFT JOIN dbo.AuditoriaDepositoSnapshot s WITH(NOLOCK) ON s.AudId = e.AudId AND s.OrdIdOrden = e.OrdIdOrden
            LEFT JOIN dbo.OrdenesDeposito v WITH(NOLOCK) ON v.OrdIdOrden = e.OrdIdOrden AND s.OrdIdOrden IS NULL
            LEFT JOIN dbo.Clientes cv WITH(NOLOCK) ON cv.CliIdCliente = v.CliIdCliente
            LEFT JOIN dbo.TiposClientes tcv WITH(NOLOCK) ON tcv.TClIdTipoCliente = cv.TClIdTipoCliente
            LEFT JOIN dbo.OrdenesRetiro rv WITH(NOLOCK) ON rv.OReIdOrdenRetiro = v.OReIdOrdenRetiro
            LEFT JOIN dbo.Ordenes po WITH(NOLOCK) ON po.OrdenID = e.OrdenProdId AND e.OrdIdOrden IS NULL
            WHERE e.AudId = @A
            ORDER BY e.EscId`),
    ]);
    const maxDias = sesion.AudDiasMaxDeposito || 15;
    const itemSnap = (s) => ({
        ordIdOrden: s.OrdIdOrden,
        codigo: s.OrdCodigoOrden, trabajo: s.OrdNombreTrabajo, cliente: s.ClienteNombre,
        clienteTelefono: s.ClienteTelefono, clienteEmail: s.ClienteEmail, clienteTipo: s.ClienteTipo || 'Desconocido',
        pagoEstado: s.PagoEstado || 'Pendiente',
        ordenRetiro: s.OReIdOrdenRetiro ? `ID: ${s.OReIdOrdenRetiro} - ${s.FormaRetiro || 'S/D'}` : 'Sin Asignar',
        estadoActualId: s.OrdEstadoActual, diasEnDeposito: s.DiasEnDeposito || 0, maxDiasDeposito: maxDias,
        valorPesos: Number(s.ValorPesos || 0), estante: s.Estante || null, avisado: !!s.OrdAvisoWsp, fechaAviso: s.OrdFechaAvisoWsp,
        bultosEsperados: s.BultosEsperados,
        // para reportes (Fase 4)
        prefijo: s.Prefijo, moneda: s.MonIdMoneda, costo: Number(s.OrdCostoFinal || 0), cliIdCliente: s.CliIdCliente, fechaIngreso: s.OrdFechaIngresoOrden,
    });
    const escaneadas = new Set(esc.recordset.filter(e => e.Resultado === 'OK' && !e.Duplicado && e.OrdIdOrden).map(e => e.OrdIdOrden));

    const data = { totales: [], faltaEnDeposito: [], sobraEnDeposito: [], ok: [], olvidadas: [], desconocido: [], sinIngreso: [], fueraAlcance: [], ingresoPosterior: [], entregadasSinPago: null };
    for (const s of snap.recordset) {
        const it = itemSnap(s);
        data.totales.push(it);
        if ((s.DiasEnDeposito || 0) > maxDias) data.olvidadas.push(it);
        if (escaneadas.has(s.OrdIdOrden)) data.ok.push(it); else data.faltaEnDeposito.push(it);
    }
    const vistosCod = new Set();
    const vistosOrden = new Set();
    for (const e of esc.recordset) {
        if (e.Duplicado) continue;
        const itVivo = () => ({
            ordIdOrden: e.OrdIdOrden, codigo: e.OrdenCodigo || e.Codigo, codigoEscaneado: e.Codigo, trabajo: null, cliente: e.Cliente,
            clienteTelefono: e.TelVivo, clienteEmail: e.EmailVivo, clienteTipo: e.ClienteTipoVivo || 'Desconocido',
            pagoEstado: e.PagVivo ? 'Pagado' : 'Pendiente',
            ordenRetiro: e.RetiroVivo ? `ID: ${e.RetiroVivo} - ${e.FormaRetiroVivo || 'S/D'}` : 'Sin Asignar',
            estadoActualId: e.EstadoVivo, diasEnDeposito: e.IngresoVivo ? diasEntre(e.IngresoVivo, new Date()) : 0, maxDiasDeposito: maxDias,
        });
        if (e.Resultado === 'ENTREGADA') { if (!vistosOrden.has('E' + e.OrdIdOrden)) { vistosOrden.add('E' + e.OrdIdOrden); data.sobraEnDeposito.push(itVivo()); } }
        else if (e.Resultado === 'FUERA_ALCANCE') { if (!vistosOrden.has('F' + e.OrdIdOrden)) { vistosOrden.add('F' + e.OrdIdOrden); data.fueraAlcance.push(itVivo()); } }
        else if (e.Resultado === 'INGRESO_POSTERIOR') { if (!vistosOrden.has('I' + e.OrdIdOrden)) { vistosOrden.add('I' + e.OrdIdOrden); data.ingresoPosterior.push(itVivo()); } }
        else if (e.Resultado === 'SIN_INGRESO') { if (!vistosCod.has(e.Codigo)) { vistosCod.add(e.Codigo); data.sinIngreso.push({ codigo: e.Codigo, ordenCodigo: e.OrdenCodigo, cliente: e.Cliente, ordenProdId: e.OrdenProdId, trabajo: 'En producción, sin ingreso a depósito', clienteTipo: 'N/A', pagoEstado: 'N/A', ordenRetiro: 'N/A', estadoActualId: null }); } }
        else if (e.Resultado === 'DESCONOCIDO') { if (!vistosCod.has(e.Codigo)) { vistosCod.add(e.Codigo); data.desconocido.push({ codigo: e.Codigo, trabajo: 'N/A', cliente: 'N/A', clienteTipo: 'N/A', pagoEstado: 'N/A', ordenRetiro: 'N/A', estadoActualId: null }); } }
    }
    const liveScans = esc.recordset.map(e => ({
        codigo: e.Codigo, resultado: e.Resultado, duplicado: !!e.Duplicado, ordenCodigo: e.OrdenCodigo, cliente: e.Cliente, fecha: e.Fecha, usuario: e.UsuarioNombre,
    }));
    const liveCodes = [...new Set(esc.recordset.filter(e => !e.Duplicado).map(e => e.Codigo))];
    return { liveCodes, liveScans, auditData: data };
}

/* ═══════════════════════════════ SEVERIDAD ═══════════════════════════════ */

/**
 * Derivada, nunca se carga a mano. Se recalcula en cada fusión: un caso que reaparece sube solo.
 *   ALTA : 3+ detecciones · FALTANTE con valor > umbral · caso u orden con más de 90 días
 *   MEDIA: cualquier diferencia física (FALTANTE/SOBRANTE/SIN_INGRESO/NO_REGISTRADA) · más de 30 días
 *   BAJA : el resto (SIN_AVISO y PERMANENCIA recientes)
 * Desvío respecto de la spec: un FALTANTE nunca es BAJA (queda MEDIA aunque valga poco).
 */
function calcSeveridad(c, cfg, ahora = new Date()) {
    const diasCaso = c.PrimeraDeteccion ? diasEntre(c.PrimeraDeteccion, ahora) : 0;
    const diasDep = Number(c.DiasEnDeposito) || 0;
    if ((Number(c.VecesDetectado) || 1) >= 3) return 'ALTA';
    if (c.Tipo === 'FALTANTE' && Number(c.ValorPesos || 0) > cfg.umbralValorAlta) return 'ALTA';
    if (diasCaso > 90 || diasDep > 90) return 'ALTA';
    if (TIPOS[c.Tipo] && TIPOS[c.Tipo].fisico) return 'MEDIA';
    if (diasCaso > 30 || diasDep > 30) return 'MEDIA';
    return 'BAJA';
}

/* ═══════════════════════════════ CIERRE = DETECCIÓN + FUSIÓN ═══════════════════════════════ */

async function insertarEvento(exec, { casoId, tipo, audId = null, usuario, detalle, estadoNuevo = null }) {
    const u = usuarioDe(usuario);
    await exec.request()
        .input('C', sql.Int, casoId).input('T', sql.VarChar(20), tipo).input('A', sql.Int, audId)
        .input('U', sql.Int, u.id).input('UN', sql.VarChar(100), u.nombre)
        .input('E', sql.VarChar(10), estadoNuevo).input('D', sql.NVarChar(500), String(detalle || '').slice(0, 500))
        .query(`INSERT INTO dbo.AuditoriaDepositoCasoEvento (CasoId, Tipo, AudId, UsuarioId, UsuarioNombre, EstadoNuevo, Detalle)
                VALUES (@C, @T, @A, @U, @UN, @E, @D)`);
}

/**
 * CERRAR la auditoría abierta: detecta hallazgos contra la fotografía y los fusiona con el registro
 * de casos, en UNA transacción. Es el port de cerrarAuditoria() del mockup (§5 de la spec).
 */
async function cerrarAuditoria({ usuario, io = null }) {
    const pool = await getPool();
    const u = usuarioDe(usuario);
    const cfg = await leerConfig(pool);
    const tran = pool.transaction();
    await tran.begin();
    try {
        const rq = () => tran.request();
        const sesRes = await rq().query(`SELECT TOP 1 * FROM dbo.AuditoriaDeposito WITH (UPDLOCK, HOLDLOCK) WHERE AudEstado = 'ABIERTA'`);
        if (!sesRes.recordset.length) throw httpError(409, 'No hay ninguna auditoría abierta para cerrar.');
        const ses = sesRes.recordset[0];
        const audId = ses.AudId;
        const apertura = new Date(ses.AudFechaApertura);
        const tiposActivos = listaCsv(ses.AudTiposActivos).filter(t => TIPOS[t]);
        const activo = (t) => tiposActivos.includes(t);
        const diasMax = ses.AudDiasMaxDeposito || cfg.diasMax;
        const cot = Number(ses.AudCotizacionDolar) || cfg.cotDolar;
        const prefijosAlcance = ses.AudAlcanceTipo === 'PREFIJO' ? new Set(listaCsv(ses.AudAlcanceValor)) : null;
        const enAlcance = (pref) => !prefijosAlcance || (!!pref && prefijosAlcance.has(String(pref).toUpperCase()));
        const ahora = new Date();

        // ── 1. Fotografía + estado VIVO de cada orden (para detectar lo que se movió durante la auditoría)
        const snap = (await rq().input('A', sql.Int, audId).query(`
            SELECT s.*, o.OrdIdOrden AS ExisteViva, o.OrdEstadoActual AS EstadoVivo, o.OrdFechaEstadoActual AS FechaEstadoVivo
            FROM dbo.AuditoriaDepositoSnapshot s
            LEFT JOIN dbo.OrdenesDeposito o WITH(NOLOCK) ON o.OrdIdOrden = s.OrdIdOrden
            WHERE s.AudId = @A`)).recordset;
        const esc = (await rq().input('A', sql.Int, audId).query(`
            SELECT EscId, Codigo, ClaveCodigo, OrdIdOrden, OrdenProdId, Resultado, Fecha, Duplicado
            FROM dbo.AuditoriaDepositoEscaneo WHERE AudId = @A ORDER BY EscId`)).recordset;
        const escValidos = esc.filter(e => !e.Duplicado);
        const escaneadas = new Set(escValidos.filter(e => e.Resultado === 'OK' && e.OrdIdOrden).map(e => e.OrdIdOrden));
        const snapIds = new Set(snap.map(s => s.OrdIdOrden));

        // ── 2. DETECCIÓN (contra el snapshot)
        const hallazgos = [];
        const movidas = [];
        const hSnap = (tipo, s) => ({
            tipo, ordIdOrden: s.OrdIdOrden, codigo: s.OrdCodigoOrden, prefijo: s.Prefijo, cliIdCliente: s.CliIdCliente,
            cliente: s.ClienteNombre, valorPesos: Number(s.ValorPesos || 0), diasEnDeposito: s.DiasEnDeposito || 0, ordenProdId: null,
        });
        for (const s of snap) {
            const salio = !s.ExisteViva || (s.EstadoVivo !== null && s.EstadoVivo >= 9);
            if (!escaneadas.has(s.OrdIdOrden)) {
                if (salio) movidas.push({ tipo: 'FALTANTE', codigo: s.OrdCodigoOrden, cliente: s.ClienteNombre, motivo: `Salió del depósito durante la auditoría (estado ${s.ExisteViva ? s.EstadoVivo : 'sin fila'})` });
                else if (activo('FALTANTE')) hallazgos.push(hSnap('FALTANTE', s));
            }
            if (salio) continue;
            if (activo('SIN_AVISO') && ESTADOS_AVISABLES.includes(s.OrdEstadoActual) && !s.OrdAvisoWsp && (s.DiasEnDeposito || 0) > cfg.diasSinAviso) hallazgos.push(hSnap('SIN_AVISO', s));
            if (activo('PERMANENCIA') && (s.DiasEnDeposito || 0) > diasMax) hallazgos.push(hSnap('PERMANENCIA', s));
        }

        // SOBRANTE: escaneada pero el sistema la da por entregada. Si se entregó DESPUÉS de abrir, es movimiento, no hallazgo.
        const idsEntregadas = [...new Set(escValidos.filter(e => e.Resultado === 'ENTREGADA' && e.OrdIdOrden).map(e => e.OrdIdOrden))];
        if (idsEntregadas.length) {
            const viv = (await rq().input('ids', sql.VarChar(sql.MAX), idsEntregadas.join(',')).query(`
                SELECT o.OrdIdOrden, UPPER(LTRIM(RTRIM(o.OrdCodigoOrden))) AS OrdCodigoOrden, o.OrdEstadoActual, o.OrdFechaEstadoActual,
                       o.CliIdCliente, c.Nombre AS ClienteNombre, o.OrdCostoFinal, o.MonIdMoneda, o.OrdFechaIngresoOrden
                FROM dbo.OrdenesDeposito o WITH(NOLOCK)
                LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
                WHERE o.OrdIdOrden IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`)).recordset;
            for (const v of viv) {
                const entregadaDurante = v.OrdFechaEstadoActual && new Date(v.OrdFechaEstadoActual) > apertura;
                if (entregadaDurante) { movidas.push({ tipo: 'SOBRANTE', codigo: v.OrdCodigoOrden, cliente: v.ClienteNombre, motivo: 'Se entregó durante la auditoría (estaba en depósito al escanearla)' }); continue; }
                if (!activo('SOBRANTE')) continue;
                const valor = v.MonIdMoneda === 2 ? Number(v.OrdCostoFinal || 0) * cot : Number(v.OrdCostoFinal || 0);
                hallazgos.push({ tipo: 'SOBRANTE', ordIdOrden: v.OrdIdOrden, codigo: v.OrdCodigoOrden, prefijo: prefijoDe(v.OrdCodigoOrden), cliIdCliente: v.CliIdCliente,
                    cliente: v.ClienteNombre, valorPesos: Math.round(valor * 100) / 100, diasEnDeposito: v.OrdFechaIngresoOrden ? diasEntre(v.OrdFechaIngresoOrden, ahora) : 0, ordenProdId: null });
            }
        }
        // SIN_INGRESO: la etiqueta es de una orden de producción que nunca se pistoleó al depósito
        if (activo('SIN_INGRESO')) {
            const porProd = new Map();
            escValidos.filter(e => e.Resultado === 'SIN_INGRESO').forEach(e => { const k = e.OrdenProdId ? `P${e.OrdenProdId}` : `C${e.Codigo}`; if (!porProd.has(k)) porProd.set(k, e); });
            const ids = [...porProd.values()].filter(e => e.OrdenProdId).map(e => e.OrdenProdId);
            const info = new Map();
            if (ids.length) {
                (await rq().input('ids', sql.VarChar(sql.MAX), ids.join(',')).query(`
                    SELECT o.OrdenID, UPPER(LTRIM(RTRIM(o.CodigoOrden))) AS CodigoOrden, o.Cliente
                    FROM dbo.Ordenes o WITH(NOLOCK) WHERE o.OrdenID IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`)).recordset
                    .forEach(r => info.set(r.OrdenID, r));
            }
            const vistosCod = new Set();
            for (const e of porProd.values()) {
                const i = e.OrdenProdId ? info.get(e.OrdenProdId) : null;
                const codigo = (i && i.CodigoOrden) || e.Codigo;
                if (vistosCod.has(codigo)) continue;
                vistosCod.add(codigo);
                hallazgos.push({ tipo: 'SIN_INGRESO', ordIdOrden: null, codigo, prefijo: prefijoDe(codigo), cliIdCliente: null, cliente: i ? i.Cliente : null, valorPesos: 0, diasEnDeposito: 0, ordenProdId: e.OrdenProdId || null });
            }
        }
        // NO_REGISTRADA: no existe en ningún lado
        if (activo('NO_REGISTRADA')) {
            const vistos = new Set();
            for (const e of escValidos.filter(x => x.Resultado === 'DESCONOCIDO')) {
                if (vistos.has(e.Codigo)) continue;
                vistos.add(e.Codigo);
                hallazgos.push({ tipo: 'NO_REGISTRADA', ordIdOrden: null, codigo: e.Codigo, prefijo: prefijoDe(e.Codigo), cliIdCliente: null, cliente: null, valorPesos: 0, diasEnDeposito: 0, ordenProdId: null });
            }
        }
        // DUPLICADO: solo informe (0 activos hoy). Códigos repetidos dentro de la fotografía.
        const porCodigo = new Map();
        snap.forEach(s => porCodigo.set(s.OrdCodigoOrden, (porCodigo.get(s.OrdCodigoOrden) || 0) + 1));
        const duplicados = [...porCodigo.entries()].filter(([, n]) => n > 1).map(([codigo, n]) => ({ codigo, filas: n }));

        // ── 3. FUSIÓN contra el registro
        const keyDe = (x) => x.ordIdOrden ? `O${x.ordIdOrden}|${x.tipo}` : `C${x.codigo}|${x.tipo}`;
        const keyCaso = (c) => c.OrdIdOrden ? `O${c.OrdIdOrden}|${c.Tipo}` : `C${c.OrdCodigoOrden}|${c.Tipo}`;
        const vivos = (await rq().query(`SELECT * FROM dbo.AuditoriaDepositoCaso WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')`)).recordset;
        const porClave = new Map();
        vivos.forEach(c => porClave.set(keyCaso(c), c));
        const idsH = [...new Set(hallazgos.filter(h => h.ordIdOrden).map(h => h.ordIdOrden))];
        const codsH = [...new Set(hallazgos.filter(h => !h.ordIdOrden).map(h => h.codigo))];
        if (idsH.length || codsH.length) {
            const rqC = rq().input('ids', sql.VarChar(sql.MAX), idsH.join(',') || '-1').input('cods', sql.NVarChar(sql.MAX), codsH.join(',') || '~');
            const cerrados = (await rqC.query(`
                SELECT * FROM dbo.AuditoriaDepositoCaso
                WHERE Estado IN ('RESUELTO','ASUMIDO')
                  AND ( OrdIdOrden IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
                        OR (OrdIdOrden IS NULL AND OrdCodigoOrden IN (SELECT value FROM STRING_SPLIT(@cods, ','))) )
                ORDER BY CasoId ASC`)).recordset;
            cerrados.forEach(c => { const k = keyCaso(c); if (!porClave.has(k)) porClave.set(k, c); }); // el último cerrado (CasoId mayor) gana
        }

        const res = { nuevos: 0, existentes: 0, reincidentes: 0, resueltos: 0 };
        const vistos = new Set();
        for (const h of hallazgos) {
            const k = keyDe(h);
            if (vistos.has(k)) continue; // el mismo hallazgo dos veces no cuenta doble
            vistos.add(k);
            const c = porClave.get(k);
            if (!c) {                                                            // ── NUEVO
                const nuevo = { Tipo: h.tipo, ValorPesos: h.valorPesos, DiasEnDeposito: h.diasEnDeposito, VecesDetectado: 1, PrimeraDeteccion: ahora };
                const sev = calcSeveridad(nuevo, cfg, ahora);
                const ins = await rq()
                    .input('oid', sql.Int, h.ordIdOrden).input('cod', sql.VarChar(100), h.codigo).input('pid', sql.Int, h.ordenProdId)
                    .input('pref', sql.VarChar(10), h.prefijo).input('cli', sql.Int, h.cliIdCliente).input('cln', sql.NVarChar(200), h.cliente)
                    .input('tipo', sql.VarChar(20), h.tipo).input('sev', sql.VarChar(5), sev).input('val', sql.Decimal(18, 2), h.valorPesos)
                    .input('dias', sql.Int, h.diasEnDeposito).input('A', sql.Int, audId)
                    .query(`
                        INSERT INTO dbo.AuditoriaDepositoCaso
                            (OrdIdOrden, OrdCodigoOrden, OrdenProdId, Prefijo, CliIdCliente, ClienteNombre, Tipo, Estado, Severidad, ValorPesos, DiasEnDeposito,
                             PrimeraAudId, PrimeraDeteccion, UltimaAudId, UltimaDeteccion, VecesDetectado, Reincidente)
                        OUTPUT inserted.CasoId
                        VALUES (@oid, @cod, @pid, @pref, @cli, @cln, @tipo, 'ABIERTO', @sev, @val, @dias, @A, GETDATE(), @A, GETDATE(), 1, 0)`);
                const casoId = ins.recordset[0].CasoId;
                await insertarEvento(tran, { casoId, tipo: 'DETECCION', audId, usuario, detalle: `Detectado en ${ses.AudCodigo}`, estadoNuevo: 'ABIERTO' });
                porClave.set(k, { CasoId: casoId, Estado: 'ABIERTO', OrdIdOrden: h.ordIdOrden, OrdCodigoOrden: h.codigo, Tipo: h.tipo });
                res.nuevos++;
            } else if (ESTADOS_VIVOS.includes(c.Estado)) {                        // ── YA EXISTENTE: no se duplica
                const veces = (c.VecesDetectado || 1) + 1;
                const sev = calcSeveridad({ ...c, VecesDetectado: veces, ValorPesos: h.valorPesos || c.ValorPesos, DiasEnDeposito: h.diasEnDeposito || c.DiasEnDeposito }, cfg, ahora);
                await rq().input('id', sql.Int, c.CasoId).input('A', sql.Int, audId).input('sev', sql.VarChar(5), sev)
                    .input('val', sql.Decimal(18, 2), h.valorPesos || c.ValorPesos || 0).input('dias', sql.Int, h.diasEnDeposito || c.DiasEnDeposito || 0)
                    .query(`UPDATE dbo.AuditoriaDepositoCaso
                            SET VecesDetectado = VecesDetectado + 1, UltimaAudId = @A, UltimaDeteccion = GETDATE(), Severidad = @sev,
                                ValorPesos = @val, DiasEnDeposito = @dias, ActualizadoEn = GETDATE()
                            WHERE CasoId = @id`);
                await insertarEvento(tran, { casoId: c.CasoId, tipo: 'DETECCION', audId, usuario, detalle: `Vuelve a detectarse en ${ses.AudCodigo} (${veces}ª vez)` });
                res.existentes++;
            } else {                                                             // ── REINCIDENTE: reabre el mismo caso
                const veces = (c.VecesDetectado || 1) + 1;
                const sev = calcSeveridad({ ...c, VecesDetectado: veces, ValorPesos: h.valorPesos || c.ValorPesos, DiasEnDeposito: h.diasEnDeposito || c.DiasEnDeposito }, cfg, ahora);
                const cerradoEl = c.CerradoEn ? new Date(c.CerradoEn).toLocaleDateString('es-UY') : 's/f';
                await rq().input('id', sql.Int, c.CasoId).input('A', sql.Int, audId).input('sev', sql.VarChar(5), sev)
                    .input('val', sql.Decimal(18, 2), h.valorPesos || c.ValorPesos || 0).input('dias', sql.Int, h.diasEnDeposito || c.DiasEnDeposito || 0)
                    .query(`UPDATE dbo.AuditoriaDepositoCaso
                            SET Estado = 'ABIERTO', Reincidente = 1, VecesDetectado = VecesDetectado + 1, UltimaAudId = @A, UltimaDeteccion = GETDATE(),
                                Severidad = @sev, ValorPesos = @val, DiasEnDeposito = @dias,
                                MotivoCierre = NULL, CerradoEn = NULL, CerradoPor = NULL, CerradoPorNombre = NULL, ActualizadoEn = GETDATE()
                            WHERE CasoId = @id`);
                await insertarEvento(tran, { casoId: c.CasoId, tipo: 'CAMBIO_ESTADO', audId, usuario, estadoNuevo: 'ABIERTO',
                    detalle: `Reabierto: reapareció en ${ses.AudCodigo} tras haberse cerrado el ${cerradoEl} (${c.Estado}: ${c.MotivoCierre || 'sin motivo'})` });
                res.reincidentes++;
            }
        }

        // ── 4. AUTO-CIERRE: solo casos cuya orden estuvo en el alcance (INVARIANTE 3)
        const idsFuera = vivos.filter(c => c.OrdIdOrden && !snapIds.has(c.OrdIdOrden)).map(c => c.OrdIdOrden);
        const vivasFuera = new Map();
        if (idsFuera.length) {
            (await rq().input('ids', sql.VarChar(sql.MAX), idsFuera.join(',')).query(`
                SELECT OrdIdOrden, OrdEstadoActual FROM dbo.OrdenesDeposito WITH(NOLOCK)
                WHERE OrdIdOrden IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`)).recordset
                .forEach(r => vivasFuera.set(r.OrdIdOrden, r));
        }
        for (const c of vivos) {
            if (vistos.has(keyCaso(c))) continue;          // generó hallazgo: sigue vivo
            if (!activo(c.Tipo)) continue;                  // este tipo no se miró en esta auditoría
            let motivo = null;
            if (c.OrdIdOrden) {
                if (snapIds.has(c.OrdIdOrden)) {
                    motivo = `No reapareció en ${ses.AudCodigo}`;
                } else {
                    if (!enAlcance(c.Prefijo)) continue;    // otra área: no se miró
                    const v = vivasFuera.get(c.OrdIdOrden);
                    if (v && (v.OrdEstadoActual === null || v.OrdEstadoActual < 9)) continue; // activa pero entró después de abrir: no se miró
                    motivo = c.Tipo === 'SOBRANTE'
                        ? `No reapareció en ${ses.AudCodigo}`
                        : `La orden ya no está en depósito (estado ${v ? v.OrdEstadoActual : 'sin fila'}) al cierre de ${ses.AudCodigo}`;
                }
            } else {
                if (!enAlcance(c.Prefijo)) continue;        // sin prefijo y alcance parcial: no se puede afirmar que se miró
                motivo = `No reapareció en ${ses.AudCodigo}`;
            }
            await rq().input('id', sql.Int, c.CasoId).input('m', sql.NVarChar(300), motivo).input('U', sql.Int, u.id).input('UN', sql.VarChar(100), 'cierre automático')
                .query(`UPDATE dbo.AuditoriaDepositoCaso
                        SET Estado = 'RESUELTO', MotivoCierre = @m, CerradoEn = GETDATE(), CerradoPor = @U, CerradoPorNombre = @UN, ActualizadoEn = GETDATE()
                        WHERE CasoId = @id`);
            await insertarEvento(tran, { casoId: c.CasoId, tipo: 'CAMBIO_ESTADO', audId, usuario: { id: u.id, name: 'cierre automático' }, estadoNuevo: 'RESUELTO', detalle: `Resuelto: ${motivo}` });
            res.resueltos++;
        }

        // ── 5. Cierre de la sesión
        const abiertos = (await rq().query(`SELECT COUNT(*) AS n FROM dbo.AuditoriaDepositoCaso WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')`)).recordset[0].n;
        const porTipo = {};
        Object.keys(TIPOS).forEach(t => { porTipo[t] = 0; });
        const vistosTipo = new Set();
        hallazgos.forEach(h => { const k = keyDe(h); if (!vistosTipo.has(k)) { vistosTipo.add(k); porTipo[h.tipo]++; } });
        const resumen = {
            alcance: { tipo: ses.AudAlcanceTipo, valor: ses.AudAlcanceValor }, lineaBase: !!ses.AudEsLineaBase, tiposActivos,
            snapshot: snap.length, escaneos: escValidos.length, escaneadas: escaneadas.size, sinEscanear: snap.length - escaneadas.size,
            hallazgosPorTipo: porTipo, movidas, duplicados, cotizacionDolar: cot, diasMaxDeposito: diasMax,
        };
        await rq().input('A', sql.Int, audId).input('U', sql.Int, u.id).input('UN', sql.VarChar(100), u.nombre)
            .input('esc', sql.Int, escValidos.length).input('dup', sql.Int, esc.length - escValidos.length)
            .input('n', sql.Int, res.nuevos).input('e', sql.Int, res.existentes).input('r', sql.Int, res.reincidentes).input('s', sql.Int, res.resueltos)
            .input('ab', sql.Int, abiertos).input('mov', sql.Int, movidas.length).input('json', sql.NVarChar(sql.MAX), JSON.stringify(resumen))
            .query(`UPDATE dbo.AuditoriaDeposito
                    SET AudEstado = 'CERRADA', AudFechaCierre = GETDATE(), AudUsuarioCierre = @U, AudUsuarioCierreNombre = @UN,
                        AudEscaneosCant = @esc, AudEscaneosDuplicados = @dup, AudNuevos = @n, AudExistentes = @e, AudReincidentes = @r,
                        AudResueltos = @s, AudAbiertosTotal = @ab, AudMovidas = @mov, AudResumenJson = @json
                    WHERE AudId = @A`);
        await tran.commit();

        const salida = { audId, codigo: ses.AudCodigo, lineaBase: !!ses.AudEsLineaBase, ...res, abiertosTotal: abiertos, ...resumen };
        logger.info(`[AUDIT-DEP] ${ses.AudCodigo} cerrada por ${u.nombre}: nuevos ${res.nuevos} · ya existentes ${res.existentes} · reincidentes ${res.reincidentes} · resueltos ${res.resueltos} · abiertos ${abiertos} · movidas ${movidas.length}`);
        if (io) { try { io.emit('audit:cerrada', { codigo: ses.AudCodigo, ...res, abiertosTotal: abiertos }); } catch (_) { /* socket opcional */ } }
        return salida;
    } catch (e) {
        try { await tran.rollback(); } catch (_) { /* ya cerrada */ }
        throw e;
    }
}

/** ANULAR: descarta la sesión abierta sin generar ni cerrar casos. Los escaneos quedan guardados como rastro. */
async function anularAuditoria({ usuario, motivo = null }) {
    const pool = await getPool();
    const u = usuarioDe(usuario);
    const r = await pool.request().input('U', sql.Int, u.id).input('UN', sql.VarChar(100), u.nombre)
        .input('m', sql.NVarChar(500), `ANULADA por ${u.nombre}${motivo ? ': ' + String(motivo).slice(0, 400) : ''}`)
        .query(`UPDATE dbo.AuditoriaDeposito
                SET AudEstado = 'ANULADA', AudFechaCierre = GETDATE(), AudUsuarioCierre = @U, AudUsuarioCierreNombre = @UN,
                    AudObservaciones = LEFT(ISNULL(AudObservaciones + ' | ', '') + @m, 500)
                OUTPUT inserted.AudCodigo
                WHERE AudEstado = 'ABIERTA'`);
    if (!r.recordset.length) throw httpError(409, 'No hay ninguna auditoría abierta para anular.');
    logger.info(`[AUDIT-DEP] ${r.recordset[0].AudCodigo} anulada por ${u.nombre}`);
    return { codigo: r.recordset[0].AudCodigo };
}

/* ═══════════════════════════════ HISTORIAL ═══════════════════════════════ */

async function listarAuditorias({ limit = 100 } = {}) {
    const pool = await getPool();
    const r = await pool.request().input('n', sql.Int, Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500))
        .query(`SELECT TOP (@n) * FROM dbo.AuditoriaDeposito WITH(NOLOCK) ORDER BY AudId DESC`);
    return r.recordset.map(x => sesionPublica(x));
}

async function obtenerAuditoria(audId) {
    const pool = await getPool();
    const id = parseInt(audId, 10);
    const a = await pool.request().input('A', sql.Int, id).query(`SELECT * FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudId = @A`);
    if (!a.recordset.length) throw httpError(404, 'Auditoría no encontrada.');
    const row = a.recordset[0];
    const { liveScans, auditData } = await clasificarSesion(pool, row);
    return { auditoria: sesionPublica(row), escaneos: liveScans, fotografia: auditData.totales, sinEscanear: auditData.faltaEnDeposito, sobrantes: auditData.sobraEnDeposito, sinIngreso: auditData.sinIngreso, desconocidos: auditData.desconocido };
}

/* ═══════════════════════════════ CASOS ═══════════════════════════════ */

const SQL_CASO_BASE = `
    SELECT c.*, pa.AudCodigo AS PrimeraAudCodigo, ua.AudCodigo AS UltimaAudCodigo
    FROM dbo.AuditoriaDepositoCaso c WITH(NOLOCK)
    LEFT JOIN dbo.AuditoriaDeposito pa WITH(NOLOCK) ON pa.AudId = c.PrimeraAudId
    LEFT JOIN dbo.AuditoriaDeposito ua WITH(NOLOCK) ON ua.AudId = c.UltimaAudId`;

function casoPublico(c) {
    return {
        casoId: c.CasoId, codigo: c.CasoCodigo,
        ordIdOrden: c.OrdIdOrden, ordenCodigo: c.OrdCodigoOrden, ordenProdId: c.OrdenProdId, prefijo: c.Prefijo,
        cliIdCliente: c.CliIdCliente, cliente: c.ClienteNombre,
        tipo: c.Tipo, tipoNombre: TIPOS[c.Tipo] ? TIPOS[c.Tipo].nombre : c.Tipo,
        estado: c.Estado, vivo: ESTADOS_VIVOS.includes(c.Estado), severidad: c.Severidad,
        valorPesos: Number(c.ValorPesos || 0), diasEnDeposito: c.DiasEnDeposito,
        primeraAudId: c.PrimeraAudId, primeraAud: c.PrimeraAudCodigo, primeraDeteccion: c.PrimeraDeteccion,
        ultimaAudId: c.UltimaAudId, ultimaAud: c.UltimaAudCodigo, ultimaDeteccion: c.UltimaDeteccion,
        veces: c.VecesDetectado, reincidente: !!c.Reincidente,
        responsableId: c.ResponsableId, responsable: c.ResponsableNombre,
        // DATE → 'AAAA-MM-DD' (sin zona horaria: evita el "un día antes" de toLocaleDateString)
        fechaLimite: c.FechaLimite ? new Date(c.FechaLimite).toISOString().slice(0, 10) : null,
        vencido: !!(c.FechaLimite && ESTADOS_VIVOS.includes(c.Estado) && new Date(c.FechaLimite).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)),
        motivoCierre: c.MotivoCierre, cerradoEn: c.CerradoEn, cerradoPor: c.CerradoPorNombre, actualizadoEn: c.ActualizadoEn,
    };
}

async function listarCasos({ estado = 'VIVOS', tipo = null, severidad = null, q = null, responsableId = null, limit = 500 } = {}) {
    const pool = await getPool();
    const rq = pool.request();
    const where = [];
    const est = String(estado || 'VIVOS').toUpperCase();
    if (est === 'VIVOS') where.push(`c.Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')`);
    else if (est === 'CERRADOS') where.push(`c.Estado IN ('RESUELTO','ASUMIDO')`);
    else if (est === 'CRONICOS') where.push(`c.Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND c.VecesDetectado >= 3`);
    else if (est === 'REINCIDENTES') where.push(`c.Reincidente = 1`);
    else if (est === 'ALTA') where.push(`c.Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND c.Severidad = 'ALTA'`);
    else if (est === 'VENCIDOS') where.push(`c.Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND c.FechaLimite IS NOT NULL AND c.FechaLimite < CAST(GETDATE() AS DATE)`);
    else if (['ABIERTO', 'EN_CURSO', 'ESPERANDO', 'RESUELTO', 'ASUMIDO'].includes(est)) { rq.input('est', sql.VarChar(10), est); where.push('c.Estado = @est'); }
    if (tipo && TIPOS[String(tipo).toUpperCase()]) { rq.input('tipo', sql.VarChar(20), String(tipo).toUpperCase()); where.push('c.Tipo = @tipo'); }
    if (severidad && ['ALTA', 'MEDIA', 'BAJA'].includes(String(severidad).toUpperCase())) { rq.input('sev', sql.VarChar(5), String(severidad).toUpperCase()); where.push('c.Severidad = @sev'); }
    if (responsableId != null && responsableId !== '') {
        if (String(responsableId).toUpperCase() === 'SIN_ASIGNAR') where.push('c.ResponsableId IS NULL');
        else if (Number.isFinite(Number(responsableId))) { rq.input('resp', sql.Int, Number(responsableId)); where.push('c.ResponsableId = @resp'); }
    }
    if (q && String(q).trim()) { rq.input('q', sql.NVarChar(200), `%${String(q).trim()}%`); where.push(`(c.OrdCodigoOrden LIKE @q OR c.ClienteNombre LIKE @q OR ('CASO-' + RIGHT('000000' + CAST(c.CasoId AS VARCHAR(10)), 6)) LIKE @q)`); }
    rq.input('n', sql.Int, Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000));
    const r = await rq.query(`${SQL_CASO_BASE.replace('SELECT c.*', 'SELECT TOP (@n) c.*')}
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY CASE c.Severidad WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END, c.ValorPesos DESC, c.VecesDetectado DESC, c.CasoId ASC`);
    const k = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')) AS vivos,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND VecesDetectado >= 3) AS cronicos,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND Severidad = 'ALTA') AS alta,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Reincidente = 1) AS reincidentes,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('RESUELTO','ASUMIDO')) AS cerrados,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK)) AS total,
          (SELECT COUNT(*) FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND FechaLimite IS NOT NULL AND FechaLimite < CAST(GETDATE() AS DATE)) AS vencidos,
          (SELECT COUNT(*) FROM dbo.AuditoriaDeposito WITH(NOLOCK) WHERE AudEstado = 'CERRADA') AS auditoriasCerradas`);
    const resp = await pool.request().query(`
        SELECT ResponsableId AS id, MAX(ResponsableNombre) AS nombre, COUNT(*) AS n
        FROM dbo.AuditoriaDepositoCaso WITH(NOLOCK) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO') AND ResponsableId IS NOT NULL
        GROUP BY ResponsableId ORDER BY MAX(ResponsableNombre)`);
    return { casos: r.recordset.map(casoPublico), kpis: k.recordset[0], tipos: TIPOS, responsables: resp.recordset };
}

async function obtenerCaso(casoId) {
    const pool = await getPool();
    const id = parseInt(casoId, 10);
    const c = await pool.request().input('id', sql.Int, id).query(`${SQL_CASO_BASE} WHERE c.CasoId = @id`);
    if (!c.recordset.length) throw httpError(404, 'Caso no encontrado.');
    const ev = await pool.request().input('id', sql.Int, id).query(`
        SELECT e.EvtId, e.Fecha, e.Tipo, e.AudId, a.AudCodigo, e.UsuarioNombre, e.EstadoNuevo, e.Detalle
        FROM dbo.AuditoriaDepositoCasoEvento e WITH(NOLOCK)
        LEFT JOIN dbo.AuditoriaDeposito a WITH(NOLOCK) ON a.AudId = e.AudId
        WHERE e.CasoId = @id ORDER BY e.Fecha ASC, e.EvtId ASC`);
    return { caso: casoPublico(c.recordset[0]), eventos: ev.recordset.map(e => ({ id: e.EvtId, fecha: e.Fecha, tipo: e.Tipo, auditoria: e.AudCodigo, usuario: e.UsuarioNombre, estadoNuevo: e.EstadoNuevo, detalle: e.Detalle })) };
}

const ACCIONES = {
    TOMAR:     { nombre: 'Tomar el caso',       necesitaDetalle: false },
    REGISTRAR: { nombre: 'Registrar acción',    necesitaDetalle: true  },   // Recontar / Avisar / Revertir / Alta manual / Derivar…
    ESPERAR:   { nombre: 'Dejar en espera',     necesitaDetalle: true  },
    COMENTAR:  { nombre: 'Comentar',            necesitaDetalle: true  },
    ASIGNAR:   { nombre: 'Asignar responsable', necesitaDetalle: false },
    RESOLVER:  { nombre: 'Marcar resuelto',     necesitaDetalle: true  },   // motivo obligatorio
    ASUMIR:    { nombre: 'Asumir la pérdida',   necesitaDetalle: true  },   // motivo + responsable obligatorios (INVARIANTE 5)
    REABRIR:   { nombre: 'Reabrir',             necesitaDetalle: true  },
};

/** Una acción humana sobre un caso. Cada acción deja un evento; las que cambian estado lo dicen explícitamente. */
async function accionCaso({ casoId, accion, detalle = null, usuario, responsableId = null, responsableNombre = null, fechaLimite }) {
    const acc = String(accion || '').toUpperCase();
    if (!ACCIONES[acc]) throw httpError(400, `Acción desconocida: ${accion}.`);
    const det = detalle ? String(detalle).trim().slice(0, 500) : '';
    if (ACCIONES[acc].necesitaDetalle && !det) throw httpError(400, `"${ACCIONES[acc].nombre}" necesita un motivo o detalle.`);
    const u = usuarioDe(usuario);
    if (!u.id) throw httpError(401, 'Usuario no identificado.');
    // fechaLimite: undefined = no tocar · null/'' = borrar · 'YYYY-MM-DD' = fijar (solo TOMAR / ASIGNAR / REGISTRAR / ESPERAR)
    let limite;
    if (fechaLimite !== undefined && ['TOMAR', 'ASIGNAR', 'REGISTRAR', 'ESPERAR'].includes(acc)) {
        if (fechaLimite === null || fechaLimite === '') limite = null;
        else if (/^\d{4}-\d{2}-\d{2}$/.test(String(fechaLimite))) limite = String(fechaLimite);
        else throw httpError(400, 'Fecha límite inválida: usar AAAA-MM-DD.');
    }
    const pool = await getPool();
    const tran = pool.transaction();
    await tran.begin();
    try {
        const rq = () => tran.request();
        const cr = await rq().input('id', sql.Int, parseInt(casoId, 10)).query(`SELECT * FROM dbo.AuditoriaDepositoCaso WITH (UPDLOCK, HOLDLOCK) WHERE CasoId = @id`);
        if (!cr.recordset.length) throw httpError(404, 'Caso no encontrado.');
        const c = cr.recordset[0];
        const vivo = ESTADOS_VIVOS.includes(c.Estado);
        const respId = responsableId != null ? Number(responsableId) : (c.ResponsableId || u.id);
        const respNom = responsableId != null ? String(responsableNombre || `usuario ${responsableId}`).slice(0, 100) : (c.ResponsableNombre || u.nombre);

        let set = 'ActualizadoEn = GETDATE()';
        let estadoNuevo = null;
        let tipoEvento = 'ACCION';
        let texto = '';
        switch (acc) {
            case 'TOMAR':
                if (!vivo) throw httpError(409, 'El caso está cerrado: reabrilo antes de tomarlo.');
                estadoNuevo = 'EN_CURSO'; tipoEvento = 'CAMBIO_ESTADO';
                set += `, Estado = 'EN_CURSO', ResponsableId = @rid, ResponsableNombre = @rnom`;
                texto = `Tomado por ${respNom}${det ? ': ' + det : ''}`;
                break;
            case 'REGISTRAR':
                if (!vivo) throw httpError(409, 'El caso está cerrado: reabrilo antes de registrar acciones.');
                set += `, ResponsableId = @rid, ResponsableNombre = @rnom`;
                if (c.Estado === 'ABIERTO') { set += `, Estado = 'EN_CURSO'`; estadoNuevo = 'EN_CURSO'; }
                texto = `Acción: ${det}`;
                break;
            case 'ESPERAR':
                if (!vivo) throw httpError(409, 'El caso está cerrado.');
                estadoNuevo = 'ESPERANDO'; tipoEvento = 'CAMBIO_ESTADO';
                set += `, Estado = 'ESPERANDO', ResponsableId = @rid, ResponsableNombre = @rnom`;
                texto = `En espera: ${det}`;
                break;
            case 'COMENTAR':
                tipoEvento = 'COMENTARIO'; texto = det;
                break;
            case 'ASIGNAR':
                set += `, ResponsableId = @rid, ResponsableNombre = @rnom`;
                texto = `Responsable: ${respNom}${det ? ' (' + det + ')' : ''}`;
                break;
            case 'RESOLVER':
                if (!vivo) throw httpError(409, 'El caso ya está cerrado.');
                estadoNuevo = 'RESUELTO'; tipoEvento = 'CAMBIO_ESTADO';
                set += `, Estado = 'RESUELTO', MotivoCierre = @det, CerradoEn = GETDATE(), CerradoPor = @uid, CerradoPorNombre = @unom, ResponsableId = @rid, ResponsableNombre = @rnom`;
                texto = `Resuelto por ${u.nombre}: ${det}`;
                break;
            case 'ASUMIR':
                if (!vivo) throw httpError(409, 'El caso ya está cerrado.');
                estadoNuevo = 'ASUMIDO'; tipoEvento = 'CAMBIO_ESTADO';
                set += `, Estado = 'ASUMIDO', MotivoCierre = @det, CerradoEn = GETDATE(), CerradoPor = @uid, CerradoPorNombre = @unom, ResponsableId = @rid, ResponsableNombre = @rnom`;
                texto = `Pérdida asumida por ${respNom}: ${det}`;
                break;
            case 'REABRIR':
                if (vivo) throw httpError(409, 'El caso ya está abierto.');
                estadoNuevo = 'ABIERTO'; tipoEvento = 'CAMBIO_ESTADO';
                set += `, Estado = 'ABIERTO', MotivoCierre = NULL, CerradoEn = NULL, CerradoPor = NULL, CerradoPorNombre = NULL`;
                texto = `Reabierto a mano por ${u.nombre}: ${det}`;
                break;
            default: break;
        }
        if (limite !== undefined) { set += ', FechaLimite = @fl'; texto += limite ? ` · fecha límite ${limite}` : ' · sin fecha límite'; }
        await rq().input('id', sql.Int, c.CasoId).input('rid', sql.Int, respId).input('rnom', sql.VarChar(100), respNom)
            .input('det', sql.NVarChar(300), det ? det.slice(0, 300) : null).input('uid', sql.Int, u.id).input('unom', sql.VarChar(100), u.nombre)
            .input('fl', sql.Date, limite === undefined ? null : limite)
            .query(`UPDATE dbo.AuditoriaDepositoCaso SET ${set} WHERE CasoId = @id`);
        await insertarEvento(tran, { casoId: c.CasoId, tipo: tipoEvento, usuario, detalle: texto, estadoNuevo });
        await tran.commit();
        return { casoId: c.CasoId, codigo: c.CasoCodigo, estado: estadoNuevo || c.Estado, accion: acc };
    } catch (e) {
        try { await tran.rollback(); } catch (_) { /* ya cerrada */ }
        throw e;
    }
}

/** La misma acción sobre varios casos. Cada caso va en su transacción: uno que falla no frena a los demás. */
async function accionLote({ casoIds, accion, detalle = null, usuario, responsableId = null, responsableNombre = null, fechaLimite }) {
    const ids = [...new Set((Array.isArray(casoIds) ? casoIds : []).map(x => parseInt(x, 10)).filter(Number.isFinite))];
    if (!ids.length) throw httpError(400, 'No se indicó ningún caso.');
    if (ids.length > 500) throw httpError(400, 'Máximo 500 casos por lote.');
    const ok = []; const errores = [];
    for (const id of ids) {
        try { ok.push(await accionCaso({ casoId: id, accion, detalle, usuario, responsableId, responsableNombre, fechaLimite })); }
        catch (e) { errores.push({ casoId: id, error: e.message }); }
    }
    return { aplicados: ok.length, errores, resultados: ok };
}

module.exports = {
    TIPOS, ACCIONES, ESTADOS_VIVOS, ESTADOS_CERRADOS, ESTADOS_AVISABLES,
    leerConfig, obtenerSesionAbierta, contadoresSesion, estadoModulo, listarPrefijosActivos,
    abrirAuditoria, registrarEscaneo, quitarEscaneo, clasificarSesion, cerrarAuditoria, anularAuditoria,
    listarAuditorias, obtenerAuditoria,
    listarCasos, obtenerCaso, accionCaso, accionLote, calcSeveridad,
};
