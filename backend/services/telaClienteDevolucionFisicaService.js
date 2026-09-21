'use strict';

/**
 * TELA CLIENTE — Devolución física del excedente al cliente.
 * ────────────────────────────────────────────────────────────────────────────
 * Distinto de `utils/telaClienteDevolucion.js` (que devuelve metros AL SALDO
 * cuando se cancela una orden). Este módulo devuelve la TELA FÍSICA: cierra la
 * bobina, y genera una orden/bulto que sale por el circuito normal de
 * depósito → retiro/encomienda, con costo $0 (no se cobra flete).
 *
 * Bandeja única (`TelaClienteEventos`) para dos cosas que comparten el mismo
 * ciclo de vida PENDIENTE → APROBADA/RECHAZADA → ENVIADA/RESUELTA:
 *   - SOLICITUD_CLIENTE: el cliente (portal) o alguien interno (bobina) pide
 *     devolver o descartar el excedente de una bobina puntual.
 *   - AVISO_EXCEDENTE: candidata detectada por el job de umbral — hay que
 *     avisarle al cliente que le queda tela y preguntarle qué hacer.
 *
 * Patrón "auto-heal" del esquema, igual que consultasClienteService.ensureSchema.
 */

const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

const UMBRAL_DEFAULT_METROS = 5;
const ACCIONES_VALIDAS = ['DEVOLVER', 'DESCARTAR'];

// ============================================================
// ESQUEMA
// ============================================================
let _schemaOk = false;
async function ensureSchema(pool) {
    if (_schemaOk) return;
    await pool.request().query(`
        IF OBJECT_ID('dbo.TelaClienteEventos', 'U') IS NULL
            CREATE TABLE dbo.TelaClienteEventos (
                TevID              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TelaClienteEventos PRIMARY KEY,
                BobinaID           INT            NOT NULL,
                ClienteID          NVARCHAR(200)  NOT NULL,
                Tipo               VARCHAR(20)    NOT NULL,   -- AVISO_EXCEDENTE | SOLICITUD_CLIENTE
                Accion             VARCHAR(12)    NULL,       -- DEVOLVER | DESCARTAR (solo SOLICITUD_CLIENTE)
                Canal              VARCHAR(12)    NULL,       -- RETIRO | ENCOMIENDA (solo Accion=DEVOLVER)
                Estado             VARCHAR(16)    NOT NULL CONSTRAINT DF_Tev_Estado DEFAULT 'PENDIENTE',
                MetrosInvolucrados DECIMAL(10,2)  NULL,
                Origen             VARCHAR(12)    NOT NULL,   -- PORTAL | INTERNO | JOB
                Observaciones      NVARCHAR(500)  NULL,
                OrdenGeneradaID    INT            NULL,
                UsuarioSolicita    INT            NULL,
                UsuarioResuelve    INT            NULL,
                FechaCreacion      DATETIME NOT NULL CONSTRAINT DF_Tev_Alta DEFAULT GETDATE(),
                FechaResolucion    DATETIME       NULL
            );

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TelaClienteEventos_Estado')
            CREATE INDEX IX_TelaClienteEventos_Estado ON dbo.TelaClienteEventos (Estado, Tipo);

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TelaClienteEventos_Bobina')
            CREATE INDEX IX_TelaClienteEventos_Bobina ON dbo.TelaClienteEventos (BobinaID);

        -- Candado, UNO POR TIPO: no puede haber dos SOLICITUD_CLIENTE abiertas, ni dos
        -- AVISO_EXCEDENTE abiertos, para la misma bobina — pero un aviso pendiente NO
        -- debe trabar una solicitud real del cliente (son cosas distintas: el aviso es
        -- "che, avisale que le queda tela", la solicitud ya es la decisión tomada).
        -- (Reemplaza el índice viejo UX_TelaClienteEventos_AbiertoPorBobina, que
        -- bloqueaba cualquier combinación — bug real: BOB-74, 17-sep-2026.)
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_TelaClienteEventos_AbiertoPorBobina')
            DROP INDEX UX_TelaClienteEventos_AbiertoPorBobina ON dbo.TelaClienteEventos;

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_TelaClienteEventos_SolicitudAbierta')
            CREATE UNIQUE INDEX UX_TelaClienteEventos_SolicitudAbierta
                ON dbo.TelaClienteEventos (BobinaID) WHERE Tipo = 'SOLICITUD_CLIENTE' AND Estado IN ('PENDIENTE', 'APROBADA');

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_TelaClienteEventos_AvisoAbierto')
            CREATE UNIQUE INDEX UX_TelaClienteEventos_AvisoAbierto
                ON dbo.TelaClienteEventos (BobinaID) WHERE Tipo = 'AVISO_EXCEDENTE' AND Estado = 'PENDIENTE';

        IF COL_LENGTH('dbo.InventarioBobinas', 'DecisionExcedente') IS NULL
            ALTER TABLE dbo.InventarioBobinas ADD DecisionExcedente NVARCHAR(20) NULL;

        -- Datos de envío (solo Accion=DEVOLVER + Canal=ENCOMIENDA) — se guardan en la
        -- solicitud para que "Empaquetar" pueda armar el retiro/encomienda real sin
        -- tener que volver a preguntarle nada al cliente.
        IF COL_LENGTH('dbo.TelaClienteEventos', 'Direccion') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD Direccion NVARCHAR(200) NULL;
        IF COL_LENGTH('dbo.TelaClienteEventos', 'Departamento') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD Departamento NVARCHAR(50) NULL;
        IF COL_LENGTH('dbo.TelaClienteEventos', 'Localidad') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD Localidad NVARCHAR(50) NULL;
        IF COL_LENGTH('dbo.TelaClienteEventos', 'AgenciaID') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD AgenciaID INT NULL;
        IF COL_LENGTH('dbo.TelaClienteEventos', 'AgenciaOtra') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD AgenciaOtra NVARCHAR(200) NULL;
        IF COL_LENGTH('dbo.TelaClienteEventos', 'OReIdOrdenRetiro') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD OReIdOrdenRetiro INT NULL;
        IF COL_LENGTH('dbo.TelaClienteEventos', 'ReceptorNombre') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD ReceptorNombre NVARCHAR(200) NULL;

        -- Recordatorios + escalamiento del AVISO_EXCEDENTE sin respuesta: no se
        -- auto-decide nada en nombre del cliente, solo se insiste (push) y, pasado
        -- un tiempo, se marca para que un humano lo llame.
        IF COL_LENGTH('dbo.TelaClienteEventos', 'FechaUltimoRecordatorio') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD FechaUltimoRecordatorio DATETIME NULL;
        IF COL_LENGTH('dbo.TelaClienteEventos', 'Escalado') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD Escalado BIT NOT NULL CONSTRAINT DF_Tev_Escalado DEFAULT 0;
        IF COL_LENGTH('dbo.TelaClienteEventos', 'FechaEscalado') IS NULL
            ALTER TABLE dbo.TelaClienteEventos ADD FechaEscalado DATETIME NULL;

        -- Umbral de metros para que el job de excedente proponga avisar al cliente.
        -- Configurable sin deploy (ConfiguracionGlobal, mismo AreaID 'ADMIN' que usan
        -- IntervaloAviso/ActivarAvisosWSP).
        IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'TELA_CLIENTE_UMBRAL_AVISO_METROS' AND AreaID = 'ADMIN')
            INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('TELA_CLIENTE_UMBRAL_AVISO_METROS', 'ADMIN', '${UMBRAL_DEFAULT_METROS}');
        IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'TELA_CLIENTE_RECORDATORIO_DIAS' AND AreaID = 'ADMIN')
            INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('TELA_CLIENTE_RECORDATORIO_DIAS', 'ADMIN', '3');
        IF NOT EXISTS (SELECT 1 FROM dbo.ConfiguracionGlobal WHERE Clave = 'TELA_CLIENTE_ESCALADO_DIAS' AND AreaID = 'ADMIN')
            INSERT INTO dbo.ConfiguracionGlobal (Clave, AreaID, Valor) VALUES ('TELA_CLIENTE_ESCALADO_DIAS', 'ADMIN', '7');
    `);
    _schemaOk = true;
}

// ============================================================
// HELPERS
// ============================================================

async function getUmbralMetros(pool) {
    const r = await pool.request().query(
        "SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'TELA_CLIENTE_UMBRAL_AVISO_METROS' AND AreaID = 'ADMIN'"
    );
    const v = parseFloat(r.recordset[0]?.Valor);
    return Number.isFinite(v) ? v : UMBRAL_DEFAULT_METROS;
}

function proximoNumeroEtiqueta() {
    // Mismo espíritu que los códigos GEN-<timestamp> de PackingView: no depende de
    // una secuencia propia, alcanza para una etiqueta legible y única.
    return Date.now().toString().slice(-8);
}


// ============================================================
// 1. SOLICITAR (portal o vista de bobina interna)
// ============================================================
async function solicitarDevolucion(pool, { clienteId, bobinaId, accion, origen, usuarioId, observaciones }) {
    await ensureSchema(pool);

    const accionNorm = String(accion || '').toUpperCase();
    if (!ACCIONES_VALIDAS.includes(accionNorm)) {
        throw new Error(`Acción inválida: ${accion}. Debe ser DEVOLVER o DESCARTAR.`);
    }

    const bobina = await pool.request()
        .input('BID', sql.Int, bobinaId)
        .input('CLI', sql.NVarChar(255), clienteId)
        .query(`SELECT BobinaID, MetrosRestantes, Estado FROM InventarioBobinas WHERE BobinaID = @BID AND ClienteID = @CLI`);
    if (!bobina.recordset.length) throw new Error('Bobina no encontrada o no pertenece a este cliente.');
    if (['Cerrado', 'Agotado'].includes(bobina.recordset[0].Estado)) {
        throw new Error(`Esa bobina ya está ${bobina.recordset[0].Estado} — no admite más solicitudes.`);
    }

    // El candado es SOLO contra otra SOLICITUD_CLIENTE abierta — un AVISO_EXCEDENTE
    // pendiente de la misma bobina no bloquea (ver abajo: se auto-resuelve).
    const abierto = await pool.request()
        .input('BID', sql.Int, bobinaId)
        .query(`SELECT TevID FROM dbo.TelaClienteEventos WHERE BobinaID = @BID AND Tipo = 'SOLICITUD_CLIENTE' AND Estado IN ('PENDIENTE', 'APROBADA')`);
    if (abierto.recordset.length) {
        throw new Error('Ya hay una solicitud en curso para esta bobina.');
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        // El canal (Retiro/Encomienda) y la dirección de envío YA NO se piden acá —
        // se definen recién cuando el cliente efectivamente retira, por el circuito
        // normal de retiros (portal/tótem/WebRetirosPage), igual que cualquier otra
        // orden. Ver retiroService.crearRetiro (marcador EstadoDependencia).
        const ins = await new sql.Request(transaction)
            .input('BID', sql.Int, bobinaId)
            .input('CLI', sql.NVarChar(200), clienteId)
            .input('Acc', sql.VarChar(12), accionNorm)
            .input('Met', sql.Decimal(10, 2), bobina.recordset[0].MetrosRestantes)
            .input('Ori', sql.VarChar(12), origen || 'INTERNO')
            .input('Obs', sql.NVarChar(500), observaciones || null)
            .input('Usr', sql.Int, usuarioId || null)
            .query(`
                INSERT INTO dbo.TelaClienteEventos
                    (BobinaID, ClienteID, Tipo, Accion, Estado, MetrosInvolucrados, Origen, Observaciones, UsuarioSolicita)
                OUTPUT INSERTED.TevID
                VALUES (@BID, @CLI, 'SOLICITUD_CLIENTE', @Acc, 'PENDIENTE', @Met, @Ori, @Obs, @Usr)
            `);

        // La solicitud del cliente ya contesta lo que el aviso preguntaba — cerrarlo,
        // si no queda ahí PENDIENTE para siempre (nadie va a "marcarlo enviado").
        await new sql.Request(transaction)
            .input('BID', sql.Int, bobinaId)
            .input('Usr', sql.Int, usuarioId || null)
            .query(`
                UPDATE dbo.TelaClienteEventos
                SET Estado = 'RESUELTA', UsuarioResuelve = @Usr, FechaResolucion = GETDATE(),
                    Observaciones = 'Resuelto por la solicitud del cliente'
                WHERE BobinaID = @BID AND Tipo = 'AVISO_EXCEDENTE' AND Estado = 'PENDIENTE'
            `);

        await transaction.commit();
        return { tevId: ins.recordset[0].TevID };
    } catch (err) {
        try { await transaction.rollback(); } catch (_) {}
        throw err;
    }
}

// ============================================================
// 2. BANDEJA — listar / aprobar / rechazar
// ============================================================
async function listarBandeja(pool, { estado } = {}) {
    await ensureSchema(pool);
    const req = pool.request();
    let where = '1=1';
    if (estado) { req.input('Est', sql.VarChar(16), estado); where += ' AND t.Estado = @Est'; }

    const r = await req.query(`
        SELECT
            t.TevID, t.BobinaID, t.ClienteID, t.Tipo, t.Accion, t.Canal, t.Estado,
            t.MetrosInvolucrados, t.Origen, t.Observaciones, t.OrdenGeneradaID, t.OReIdOrdenRetiro, t.ReceptorNombre,
            t.Escalado, t.FechaEscalado, t.FechaUltimoRecordatorio,
            t.FechaCreacion, t.FechaResolucion,
            ib.CodigoEtiqueta, ib.Estado AS EstadoBobina, ib.MetrosRestantes AS MetrosActuales,
            COALESCE(NULLIF(ib.DescripcionTela, ''), ins.Nombre) AS TipoTela,
            COALESCE(ib.NombreCliente, ib.ClienteID) AS NombreCliente,
            -- Solo hay algo para imprimir cuando ya se empaquetó (Estado='ENVIADA')
            o.CodigoOrden, o.DescripcionTrabajo, o.ModoRetiro,
            lb.CodigoEtiqueta AS BultoCodigoEtiqueta,
            et.CodigoQR AS BultoCodigoQR,
            r.FormaRetiro,
            CASE WHEN r.OReIdOrdenRetiro IS NOT NULL THEN r.FormaRetiro + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR) ELSE NULL END AS CodigoRetiro
        FROM dbo.TelaClienteEventos t
        JOIN dbo.InventarioBobinas ib ON ib.BobinaID = t.BobinaID
        JOIN dbo.Insumos ins ON ins.InsumoID = ib.InsumoID
        LEFT JOIN dbo.Ordenes o ON o.OrdenID = t.OrdenGeneradaID
        LEFT JOIN dbo.Logistica_Bultos lb ON lb.OrdenID = t.OrdenGeneradaID AND lb.Tipocontenido = 'DEV_TELA_CLIENTE'
        LEFT JOIN dbo.Etiquetas et ON et.OrdenID = t.OrdenGeneradaID
        LEFT JOIN dbo.OrdenesRetiro r ON r.OReIdOrdenRetiro = t.OReIdOrdenRetiro
        WHERE ${where}
        ORDER BY CASE t.Estado WHEN 'PENDIENTE' THEN 0 WHEN 'APROBADA' THEN 1 WHEN 'EMPAQUETADA' THEN 2 WHEN 'EN_DEPOSITO' THEN 3 ELSE 4 END, t.FechaCreacion ASC
    `);
    return r.recordset;
}

/**
 * Avisos de excedente PENDIENTE de UN cliente puntual — para que el portal se
 * los muestre como un aviso persistente (ticket), no dependiente de WhatsApp
 * ni de permisos de push del navegador.
 */
async function listarAvisosPendientesCliente(pool, clienteId) {
    await ensureSchema(pool);
    const r = await pool.request()
        .input('CLI', sql.NVarChar(200), clienteId)
        .query(`
            SELECT t.TevID, t.BobinaID, t.MetrosInvolucrados, t.FechaCreacion,
                   ib.CodigoEtiqueta, ib.MetrosRestantes AS MetrosActuales,
                   COALESCE(NULLIF(ib.DescripcionTela, ''), ins.Nombre) AS TipoTela
            FROM dbo.TelaClienteEventos t
            JOIN dbo.InventarioBobinas ib ON ib.BobinaID = t.BobinaID
            JOIN dbo.Insumos ins ON ins.InsumoID = ib.InsumoID
            WHERE t.Tipo = 'AVISO_EXCEDENTE' AND t.Estado = 'PENDIENTE' AND t.ClienteID = @CLI
            ORDER BY t.FechaCreacion ASC
        `);
    return r.recordset;
}

async function _cargarEvento(transaction, tevId) {
    const r = await new sql.Request(transaction)
        .input('TID', sql.Int, tevId)
        .query(`SELECT * FROM dbo.TelaClienteEventos WITH (UPDLOCK, ROWLOCK) WHERE TevID = @TID`);
    if (!r.recordset.length) throw new Error('Solicitud/aviso no encontrado.');
    return r.recordset[0];
}

async function rechazarSolicitud(pool, { tevId, usuarioId, motivo }) {
    await ensureSchema(pool);
    const r = await pool.request()
        .input('TID', sql.Int, tevId)
        .input('Usr', sql.Int, usuarioId || null)
        .input('Obs', sql.NVarChar(500), motivo || null)
        .query(`
            UPDATE dbo.TelaClienteEventos
            SET Estado = 'RECHAZADA', UsuarioResuelve = @Usr, FechaResolucion = GETDATE(),
                Observaciones = COALESCE(@Obs, Observaciones)
            WHERE TevID = @TID AND Estado = 'PENDIENTE'
        `);
    if (!r.rowsAffected[0]) throw new Error('La solicitud ya no está pendiente.');
    return { ok: true };
}

/**
 * Aprobar una SOLICITUD_CLIENTE.
 *  - DESCARTAR: se ejecuta de una — cierra la bobina y deja constancia. No hay
 *    bulto ni entrega.
 *  - DEVOLVER: solo pasa a APROBADA. La bobina puede estar "En Uso" todavía —
 *    el cierre real + generación de la orden de entrega pasan en
 *    `empaquetarDevolucion`, cuando la tela efectivamente está libre.
 */
async function aprobarSolicitud(pool, { tevId, usuarioId }) {
    await ensureSchema(pool);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        const evt = await _cargarEvento(transaction, tevId);
        if (evt.Tipo !== 'SOLICITUD_CLIENTE') throw new Error('Este evento no es una solicitud del cliente.');
        if (evt.Estado !== 'PENDIENTE') throw new Error('La solicitud ya no está pendiente.');

        if (evt.Accion === 'DESCARTAR') {
            const bob = await new sql.Request(transaction)
                .input('BID', sql.Int, evt.BobinaID)
                .query(`SELECT MetrosRestantes, InsumoID FROM InventarioBobinas WITH (UPDLOCK, ROWLOCK) WHERE BobinaID = @BID`);
            const metros = parseFloat(bob.recordset[0]?.MetrosRestantes) || 0;

            await new sql.Request(transaction)
                .input('BID', sql.Int, evt.BobinaID)
                .query(`UPDATE InventarioBobinas SET Estado = 'Cerrado' WHERE BobinaID = @BID`);

            await new sql.Request(transaction)
                .input('IID', sql.Int, bob.recordset[0].InsumoID)
                .input('BID', sql.Int, evt.BobinaID)
                .input('Met', sql.Decimal(10, 2), -metros)
                .input('Usr', sql.Int, usuarioId || 1)
                .query(`
                    INSERT INTO MovimientosInsumos (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID)
                    VALUES (@IID, @BID, 'DESCARTE_CLIENTE', @Met, 'Descarte autorizado por el cliente', @Usr)
                `);

            await new sql.Request(transaction)
                .input('TID', sql.Int, tevId)
                .input('Usr', sql.Int, usuarioId || null)
                .query(`
                    UPDATE dbo.TelaClienteEventos
                    SET Estado = 'RESUELTA', UsuarioResuelve = @Usr, FechaResolucion = GETDATE()
                    WHERE TevID = @TID
                `);
        } else {
            await new sql.Request(transaction)
                .input('TID', sql.Int, tevId)
                .input('Usr', sql.Int, usuarioId || null)
                .query(`
                    UPDATE dbo.TelaClienteEventos
                    SET Estado = 'APROBADA', UsuarioResuelve = @Usr, FechaResolucion = GETDATE()
                    WHERE TevID = @TID
                `);
        }

        await transaction.commit();
        return { ok: true, accion: evt.Accion };
    } catch (err) {
        try { await transaction.rollback(); } catch (_) {}
        throw err;
    }
}

// ============================================================
// 3. EMPAQUETAR — ejecuta la devolución física (Accion=DEVOLVER, ya APROBADA)
// ============================================================
async function listarParaEmpaquetar(pool) {
    await ensureSchema(pool);
    const r = await pool.request().query(`
        SELECT t.TevID, t.BobinaID, t.ClienteID, t.Canal, t.MetrosInvolucrados,
               ib.CodigoEtiqueta, ib.Estado AS EstadoBobina, ib.MetrosRestantes AS MetrosActuales,
               COALESCE(NULLIF(ib.DescripcionTela, ''), ins.Nombre) AS TipoTela,
               COALESCE(ib.NombreCliente, ib.ClienteID) AS NombreCliente
        FROM dbo.TelaClienteEventos t
        JOIN dbo.InventarioBobinas ib ON ib.BobinaID = t.BobinaID
        JOIN dbo.Insumos ins ON ins.InsumoID = ib.InsumoID
        WHERE t.Tipo = 'SOLICITUD_CLIENTE' AND t.Accion = 'DEVOLVER' AND t.Estado = 'APROBADA'
        ORDER BY t.FechaResolucion ASC
    `);
    return r.recordset;
}

/**
 * Empaquetar = arma el bulto físico y PARA AHÍ — igual que cualquier orden
 * normal que sale de un área. NO crea todavía OrdenesDeposito, NO arma el
 * retiro, NO avisa al cliente: eso pasa recién en `finalizarLlegadaDeposito`,
 * cuando el bulto llega de verdad a depósito por el remito de siempre
 * (backend/controllers/logisticsController.js, función receiveDispatch).
 * Antes esto lo hacía todo junto, asumiendo que la tela "ya estaba" en
 * depósito — cambiado a pedido del usuario (21-sep-2026) para que se
 * comporte como cualquier otra orden: bulto → remito → recepción → aviso.
 */
async function empaquetarDevolucion(pool, { tevId, usuarioId, userName }) {
    await ensureSchema(pool);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        const evt = await _cargarEvento(transaction, tevId);
        if (evt.Tipo !== 'SOLICITUD_CLIENTE' || evt.Accion !== 'DEVOLVER') throw new Error('Este evento no es una devolución aprobada.');
        if (evt.Estado !== 'APROBADA') throw new Error('La devolución todavía no está aprobada.');

        const bob = await new sql.Request(transaction)
            .input('BID', sql.Int, evt.BobinaID)
            .query(`
                SELECT ib.MetrosRestantes, ib.Estado, ib.InsumoID, ib.ClienteID, ib.AreaID,
                       COALESCE(NULLIF(ib.DescripcionTela, ''), ins.Nombre) AS TipoTela,
                       COALESCE(ib.NombreCliente, ib.ClienteID) AS NombreCliente
                FROM InventarioBobinas ib WITH (UPDLOCK, ROWLOCK)
                JOIN Insumos ins ON ins.InsumoID = ib.InsumoID
                WHERE ib.BobinaID = @BID
            `);
        const b = bob.recordset[0];
        if (!b) throw new Error('Bobina no encontrada.');
        if (!['Disponible', 'Pendiente'].includes(b.Estado)) {
            throw new Error(`La tela todavía está "${b.Estado}" — hay que esperar a que se libere antes de empaquetar la devolución.`);
        }

        const metros = parseFloat(b.MetrosRestantes) || 0;

        // 1. Cerrar la bobina
        await new sql.Request(transaction)
            .input('BID', sql.Int, evt.BobinaID)
            .query(`UPDATE InventarioBobinas SET Estado = 'Cerrado' WHERE BobinaID = @BID`);

        // 2. Ledger
        await new sql.Request(transaction)
            .input('IID', sql.Int, b.InsumoID)
            .input('BID', sql.Int, evt.BobinaID)
            .input('Met', sql.Decimal(10, 2), -metros)
            .input('Usr', sql.Int, usuarioId || 1)
            .query(`
                INSERT INTO MovimientosInsumos (InsumoID, BobinaID, TipoMovimiento, Cantidad, Referencia, UsuarioID)
                VALUES (@IID, @BID, 'DEVOLUCION_FISICA_CLIENTE', @Met, 'Devolución física de excedente al cliente', @Usr)
            `);

        // 3. Orden ancla (mismo espíritu que la VENTA_DIRECTA de tienda: existe para
        //    poder imprimir la etiqueta y seguir el camino normal de depósito/retiro).
        const codigoOrden = `DEV-${tevId}`;
        const descTrabajo = `DEVOLUCIÓN TELA CLIENTE — ${b.TipoTela} (${metros.toFixed(2)}m)`;
        const cliIdInt = parseInt(b.ClienteID, 10) || null;

        const insOrden = await new sql.Request(transaction)
            .input('Cliente', sql.NVarChar(400), b.NombreCliente || b.ClienteID)
            .input('CliId', sql.Int, cliIdInt)
            .input('Desc', sql.NVarChar(600), descTrabajo)
            .input('Mat', sql.VarChar(255), b.TipoTela)
            .input('Mag', sql.NVarChar(100), String(metros.toFixed(2)))
            .input('Cod', sql.VarChar(100), codigoOrden)
            .input('Modo', sql.VarChar(100), 'A DEFINIR AL RETIRAR')
            .query(`
                INSERT INTO Ordenes (
                    AreaID, Cliente, CliIdCliente, DescripcionTrabajo, Prioridad,
                    FechaIngreso, FechaEstimadaEntrega, Material, CodigoOrden,
                    Magnitud, ProximoServicio, UM, Estado, EstadoenArea,
                    EstadoDependencia, ModoRetiro
                )
                OUTPUT INSERTED.OrdenID
                VALUES (
                    'PRO', @Cliente, @CliId, @Desc, 'Normal',
                    GETDATE(), DATEADD(day, 3, GETDATE()), @Mat, @Cod,
                    @Mag, 'DEPOSITO', 'm', 'Pendiente', 'Pendiente',
                    'DEVOLUCION_TELA_CLIENTE', @Modo
                )
            `);
        const ordenId = insOrden.recordset[0].OrdenID;

        // 4. Etiqueta + bulto — nace "esperando remito" en el área REAL donde está
        //    la bobina (ib.AreaID), NO directo en depósito — mismo patrón que
        //    LabelGenerationService.addOneBulto para cualquier orden normal.
        //    CodigoQR: mismo formato "$ * " que usa el resto del sistema para poder
        //    reimprimir/resolver el bulto (ver rollsController.js).
        const codigoEtiqueta = `${codigoOrden}/B1`;
        const nombreClienteSafe = String(b.NombreCliente || b.ClienteID || '').replace(/\$\*/g, ' ');
        const descSafe = descTrabajo.replace(/\$\*/g, ' ');
        const matSafe = String(b.TipoTela || '').replace(/\$\*/g, ' ');
        const qrString = `${codigoOrden} $ * 1 $ * ${nombreClienteSafe} $ * ${descSafe} $ * Normal $ * ${matSafe} $ * ${metros.toFixed(2)}m $ * ${codigoEtiqueta}`;
        const areaOrigen = b.AreaID || 'DEPOSITO';
        await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .input('Num', sql.Int, 1)
            .input('User', sql.VarChar(100), userName || 'Sistema')
            .input('QR', sql.NVarChar(sql.MAX), qrString)
            .query(`
                INSERT INTO Etiquetas (OrdenID, NumeroBulto, TotalBultos, CodigoQR, FechaGeneracion, Usuario, CreadoPor)
                VALUES (@OID, @Num, @Num, @QR, GETDATE(), @User, @User)
            `);
        await new sql.Request(transaction)
            .input('Cod', sql.NVarChar(50), codigoEtiqueta)
            .input('OID', sql.Int, ordenId)
            .input('Desc', sql.NVarChar(255), descTrabajo)
            .input('UID', sql.Int, usuarioId || 1)
            .input('Area', sql.VarChar(20), areaOrigen)
            .query(`
                INSERT INTO Logistica_Bultos (CodigoEtiqueta, Tipocontenido, OrdenID, Descripcion, UbicacionActual, Estado, UsuarioCreador)
                VALUES (@Cod, 'DEV_TELA_CLIENTE', @OID, @Desc, @Area, 'EN_STOCK', @UID)
            `);

        // 5. Evento queda EMPAQUETADA — el bulto existe y se puede imprimir/mandar
        //    por remito, pero el retiro y el aviso todavía NO se generaron.
        await new sql.Request(transaction)
            .input('TID', sql.Int, tevId)
            .input('OID', sql.Int, ordenId)
            .query(`
                UPDATE dbo.TelaClienteEventos
                SET Estado = 'EMPAQUETADA', OrdenGeneradaID = @OID
                WHERE TevID = @TID
            `);

        await transaction.commit();
        return {
            ok: true, ordenId, codigoOrden, metros, areaOrigen,
            qrString, descTrabajo, nombreCliente: nombreClienteSafe,
        };
    } catch (err) {
        try { await transaction.rollback(); } catch (_) {}
        throw err;
    }
}

/**
 * Se llama SOLO desde logisticsController.receiveDispatch, cuando un bulto
 * Tipocontenido='DEV_TELA_CLIENTE' se recibe de verdad en DEPOSITO. Acá recién
 * se genera el retiro/encomienda real y se avisa al cliente. Transacción
 * propia (no la de receiveDispatch) y best-effort — si falla, la recepción
 * del remito NO se aborta, solo queda logueado para revisar a mano.
 *
 * Idempotente: si el evento ya no está EMPAQUETADA (por ej. una segunda
 * recepción del mismo bulto), no hace nada.
 */
async function finalizarLlegadaDeposito(pool, { ordenId, usuarioId }) {
    await ensureSchema(pool);
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
        const evtRes = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`SELECT * FROM dbo.TelaClienteEventos WITH (UPDLOCK, ROWLOCK) WHERE OrdenGeneradaID = @OID AND Tipo = 'SOLICITUD_CLIENTE'`);
        const evt = evtRes.recordset[0];
        if (!evt) { await transaction.rollback(); return { ok: false, motivo: 'No es una orden de devolución de tela cliente.' }; }
        if (evt.Estado !== 'EMPAQUETADA') { await transaction.rollback(); return { ok: false, motivo: `Evento en estado ${evt.Estado}, no EMPAQUETADA — no se toca (ya procesado o todavía no).` }; }

        const ordRes = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`SELECT CodigoOrden, DescripcionTrabajo, Material FROM Ordenes WHERE OrdenID = @OID`);
        const ord = ordRes.recordset[0];
        if (!ord) throw new Error(`Orden ${ordenId} no encontrada.`);

        const cliIdInt = parseInt(evt.ClienteID, 10) || null;
        const metros = parseFloat(evt.MetrosInvolucrados) || 0;

        // 1. OrdenesDeposito con costo $0 — recién ahora, al llegar de verdad.
        const insDep = await new sql.Request(transaction)
            .input('Cod', sql.VarChar(20), ord.CodigoOrden)
            .input('Cant', sql.Float, metros)
            .input('Cli', sql.Int, cliIdInt)
            .input('Trab', sql.VarChar(200), ord.DescripcionTrabajo.substring(0, 200))
            .input('Usr', sql.Int, usuarioId || 1)
            .query(`
                INSERT INTO OrdenesDeposito (
                    OrdCodigoOrden, OrdCantidad, CliIdCliente, OrdNombreTrabajo,
                    MOrIdModoOrden, ProIdProducto, MonIdMoneda, OrdCostoFinal,
                    OrdFechaIngresoOrden, OrdUsuarioAlta, OrdEstadoActual, OrdFechaEstadoActual,
                    OrdAvisoWsp, OrdMaterialPlanilla
                )
                OUTPUT INSERTED.OrdIdOrden
                VALUES (
                    @Cod, @Cant, @Cli, @Trab,
                    1, NULL, 1, 0,
                    GETDATE(), @Usr, 1, GETDATE(),
                    0, 'DEVOLUCION'
                )
            `);
        const ordIdDeposito = insDep.recordset[0].OrdIdOrden;

        // Teléfono del cliente, para el aviso post-commit.
        const cliRes = await new sql.Request(transaction)
            .input('CID', sql.Int, cliIdInt)
            .query(`SELECT TelefonoTrabajo FROM Clientes WHERE CliIdCliente = @CID`);
        const telefono = cliRes.recordset[0]?.TelefonoTrabajo || null;

        // 2. Cerrar el evento como EN_DEPOSITO — el retiro/encomienda real todavía NO
        // existe: nace recién cuando el cliente lo retira de verdad por el circuito
        // normal (portal/tótem/WebRetirosPage), donde ahí elige canal y dirección
        // como cualquier otra orden. retiroService.crearRetiro reconoce esta orden
        // (EstadoDependencia='DEVOLUCION_TELA_CLIENTE') y la deja Abonada sin pasar
        // por caja, y de paso cierra este evento a 'ENVIADA' con el OReIdOrdenRetiro.
        await new sql.Request(transaction)
            .input('TID', sql.Int, evt.TevID)
            .input('Usr', sql.Int, usuarioId || null)
            .query(`
                UPDATE dbo.TelaClienteEventos
                SET Estado = 'EN_DEPOSITO', UsuarioResuelve = @Usr
                WHERE TevID = @TID
            `);

        await transaction.commit();

        // 3. Aviso por WhatsApp — best-effort DESPUÉS del commit (mismo Callbell y
        // plantilla de siempre, vía la misma función que usa el job normal). Deja la
        // orden en OrdEstadoActual=6 (Avisado), igual que cualquier orden lista.
        try {
            const { procesarUnaOrdenWsp } = require('../jobs/wspAvisos.job');
            await procesarUnaOrdenWsp(null, {
                OrdIdOrden: ordIdDeposito,
                OrdCodigoOrden: ord.CodigoOrden,
                TelefonoTrabajo: telefono,
                OrdNombreTrabajo: ord.DescripcionTrabajo,
                Producto: ord.Material,
                Cantidad: metros,
                CostoFinal: 0,
                MonSimbolo: '$',
            }, pool);
        } catch (eWsp) {
            logger.warn(`[TELA-CLIENTE] No se pudo mandar el WhatsApp de ${ord.CodigoOrden}: ${eWsp.message}`);
        }

        return { ok: true, tevId: evt.TevID, ordIdDeposito };
    } catch (err) {
        try { await transaction.rollback(); } catch (_) {}
        throw err;
    }
}

// ============================================================
// 4. AVISO DE EXCEDENTE — detección por umbral + marcar enviado
// ============================================================

/**
 * Candidatas: bobinas Disponibles con un remanente CHICO — MENOS metros que el
 * umbral configurado (un retazo que ya no rinde para otra orden) —, sin
 * decisión de excedente tomada, y sin ya tener un evento abierto. Un remanente
 * grande (>= umbral) no entra: se asume que todavía sirve para más pedidos.
 *
 * Simplificación deliberada (MVP): no mira si el cliente tiene otras órdenes
 * activas que puedan seguir consumiendo esa tela — una bobina "Disponible" ya
 * significa que ninguna orden la tiene reservada en este momento.
 */
/**
 * Antes de crear avisos nuevos, refresca los PENDIENTE que ya existen: si la
 * bobina dejó de calificar (se consumió del todo, se decidió "Queda", o volvió
 * a tener más metros que el umbral) el aviso se cierra solo — así no quedan
 * acumulados avisos viejos que ya no aplican. A los que siguen calificando se
 * les actualiza el remanente (puede haber cambiado desde que se creó el aviso).
 * Los ya resueltos/aprobados/enviados NUNCA se toca — son historial.
 */
async function refrescarAvisosPendientes(pool) {
    await ensureSchema(pool);
    const umbral = await getUmbralMetros(pool);

    const cerrados = await pool.request()
        .input('Umbral', sql.Decimal(10, 2), umbral)
        .query(`
            UPDATE t
            SET Estado = 'RESUELTA', FechaResolucion = GETDATE(),
                Observaciones = 'Cerrado automático: ' + CASE
                    WHEN ib.Estado <> 'Disponible' THEN 'la bobina ya no está Disponible (' + ib.Estado + ')'
                    WHEN ISNULL(ib.DecisionExcedente, '') = 'QUEDA' THEN 'se decidió que la tela queda para otras órdenes'
                    WHEN ib.MetrosRestantes <= 0 THEN 'la bobina se agotó'
                    ELSE 'el remanente ya no es chico (' + CAST(ib.MetrosRestantes AS VARCHAR) + 'm >= umbral ' + CAST(@Umbral AS VARCHAR) + 'm)'
                END
            OUTPUT INSERTED.TevID
            FROM dbo.TelaClienteEventos t
            JOIN dbo.InventarioBobinas ib ON ib.BobinaID = t.BobinaID
            WHERE t.Tipo = 'AVISO_EXCEDENTE' AND t.Estado = 'PENDIENTE'
              AND (ib.Estado <> 'Disponible' OR ISNULL(ib.DecisionExcedente, '') = 'QUEDA'
                   OR ib.MetrosRestantes <= 0 OR ib.MetrosRestantes >= @Umbral)
        `);

    const actualizados = await pool.request()
        .input('Umbral', sql.Decimal(10, 2), umbral)
        .query(`
            UPDATE t
            SET MetrosInvolucrados = ib.MetrosRestantes
            OUTPUT INSERTED.TevID
            FROM dbo.TelaClienteEventos t
            JOIN dbo.InventarioBobinas ib ON ib.BobinaID = t.BobinaID
            WHERE t.Tipo = 'AVISO_EXCEDENTE' AND t.Estado = 'PENDIENTE'
              AND ib.Estado = 'Disponible' AND ISNULL(ib.DecisionExcedente, '') <> 'QUEDA'
              AND ib.MetrosRestantes > 0 AND ib.MetrosRestantes < @Umbral
              AND ABS(t.MetrosInvolucrados - ib.MetrosRestantes) > 0.005
        `);

    return { cerrados: cerrados.recordset.length, actualizados: actualizados.recordset.length };
}

async function detectarCandidatosExcedente(pool) {
    await ensureSchema(pool);
    const umbral = await getUmbralMetros(pool);

    const candidatas = await pool.request()
        .input('Umbral', sql.Decimal(10, 2), umbral)
        .query(`
            SELECT ib.BobinaID, ib.ClienteID, ib.MetrosRestantes, ib.CodigoEtiqueta,
                   COALESCE(NULLIF(ib.DescripcionTela, ''), ins.Nombre) AS TipoTela,
                   cli.CodCliente
            FROM InventarioBobinas ib
            JOIN Insumos ins ON ins.InsumoID = ib.InsumoID
            LEFT JOIN Clientes cli ON cli.CliIdCliente = TRY_CAST(ib.ClienteID AS INT)
            WHERE ib.Estado = 'Disponible'
              AND ib.ClienteID IS NOT NULL AND LTRIM(RTRIM(ib.ClienteID)) <> ''
              AND ISNULL(ib.DecisionExcedente, '') <> 'QUEDA'
              AND ib.MetrosRestantes > 0 AND ib.MetrosRestantes < @Umbral
              AND NOT EXISTS (SELECT 1 FROM dbo.TelaClienteEventos t WHERE t.BobinaID = ib.BobinaID AND t.Estado IN ('PENDIENTE', 'APROBADA', 'ENVIADA'))
        `);

    let creados = 0;
    for (const c of candidatas.recordset) {
        try {
            await pool.request()
                .input('BID', sql.Int, c.BobinaID)
                .input('CLI', sql.NVarChar(200), c.ClienteID)
                .input('Met', sql.Decimal(10, 2), c.MetrosRestantes)
                .query(`
                    INSERT INTO dbo.TelaClienteEventos (BobinaID, ClienteID, Tipo, Estado, MetrosInvolucrados, Origen)
                    VALUES (@BID, @CLI, 'AVISO_EXCEDENTE', 'PENDIENTE', @Met, 'JOB')
                `);
            creados++;

            // Push al portal — best-effort: si el cliente no tiene push suscripto no
            // pasa nada (sendToClient no hace nada), el ticket sigue esperándolo en
            // "Mis Recursos". No hay plantilla que tocar (no es WhatsApp/Callbell).
            if (c.CodCliente) {
                try {
                    const push = require('./pushNotificationService');
                    await push.sendToClient(c.CodCliente, {
                        title: 'Te queda tela en el depósito',
                        body: `${parseFloat(c.MetrosRestantes).toFixed(2)}m de ${c.TipoTela} (${c.CodigoEtiqueta}). Entrá a decidir qué hacer.`,
                        url: '/portal/recursos',
                        tag: `excedente-${c.BobinaID}`,
                    });
                } catch (ePush) {
                    logger.warn(`[TELA-CLIENTE-EXCEDENTE] No se pudo mandar el push de la bobina ${c.BobinaID}: ${ePush.message}`);
                }
            }
        } catch (e) {
            // El índice único filtrado puede rechazar una carrera entre el chequeo y el
            // insert (dos ticks del job superpuestos); no es un error real.
            logger.warn(`[TELA-CLIENTE-EXCEDENTE] No se pudo crear aviso para bobina ${c.BobinaID}: ${e.message}`);
        }
    }
    return { candidatas: candidatas.recordset.length, creados };
}

async function marcarAvisoEnviado(pool, { tevId, usuarioId }) {
    await ensureSchema(pool);
    const r = await pool.request()
        .input('TID', sql.Int, tevId)
        .input('Usr', sql.Int, usuarioId || null)
        .query(`
            UPDATE dbo.TelaClienteEventos
            SET Estado = 'ENVIADA', UsuarioResuelve = @Usr, FechaResolucion = GETDATE()
            WHERE TevID = @TID AND Tipo = 'AVISO_EXCEDENTE' AND Estado = 'PENDIENTE'
        `);
    if (!r.rowsAffected[0]) throw new Error('El aviso ya no está pendiente.');
    return { ok: true };
}

/**
 * Insiste con push mientras el AVISO_EXCEDENTE siga PENDIENTE (sin límite de
 * tiempo), y lo marca "Escalado" pasado un tiempo más largo — para que
 * atención al cliente lo llame. NO auto-decide nada en nombre del cliente:
 * descartarle o devolverle la tela sin que conteste puede volverse un
 * reclamo. Una vez Escalado, dejan de mandarse más push (ya es un humano el
 * que sigue) pero el ticket persistente en el portal se mantiene igual.
 */
async function procesarRecordatoriosYEscalado(pool) {
    await ensureSchema(pool);
    const cfg = await pool.request().query(`
        SELECT Clave, Valor FROM dbo.ConfiguracionGlobal
        WHERE Clave IN ('TELA_CLIENTE_RECORDATORIO_DIAS', 'TELA_CLIENTE_ESCALADO_DIAS') AND AreaID = 'ADMIN'
    `);
    const porClave = Object.fromEntries(cfg.recordset.map(r => [r.Clave, parseFloat(r.Valor)]));
    const recordatorioDias = Number.isFinite(porClave.TELA_CLIENTE_RECORDATORIO_DIAS) ? porClave.TELA_CLIENTE_RECORDATORIO_DIAS : 3;
    const escaladoDias = Number.isFinite(porClave.TELA_CLIENTE_ESCALADO_DIAS) ? porClave.TELA_CLIENTE_ESCALADO_DIAS : 7;

    // 1. Escalar primero — así un aviso que cruza el umbral hoy no manda un
    // recordatorio de más en la misma corrida.
    const escalados = await pool.request()
        .input('Dias', sql.Decimal(10, 2), escaladoDias)
        .query(`
            UPDATE dbo.TelaClienteEventos
            SET Escalado = 1, FechaEscalado = GETDATE()
            OUTPUT INSERTED.TevID
            WHERE Tipo = 'AVISO_EXCEDENTE' AND Estado = 'PENDIENTE' AND Escalado = 0
              AND DATEDIFF(HOUR, FechaCreacion, GETDATE()) >= @Dias * 24
        `);

    // 2. Recordatorios — a los que siguen sin escalar y ya pasó el intervalo
    // desde el último recordatorio (o desde la creación, si nunca se mandó uno).
    const candidatos = await pool.request()
        .input('Dias', sql.Decimal(10, 2), recordatorioDias)
        .query(`
            SELECT t.TevID, t.BobinaID, t.MetrosInvolucrados,
                   ib.CodigoEtiqueta, COALESCE(NULLIF(ib.DescripcionTela, ''), ins.Nombre) AS TipoTela,
                   cli.CodCliente
            FROM dbo.TelaClienteEventos t
            JOIN dbo.InventarioBobinas ib ON ib.BobinaID = t.BobinaID
            JOIN dbo.Insumos ins ON ins.InsumoID = ib.InsumoID
            LEFT JOIN dbo.Clientes cli ON cli.CliIdCliente = TRY_CAST(t.ClienteID AS INT)
            WHERE t.Tipo = 'AVISO_EXCEDENTE' AND t.Estado = 'PENDIENTE' AND t.Escalado = 0
              AND DATEDIFF(HOUR, ISNULL(t.FechaUltimoRecordatorio, t.FechaCreacion), GETDATE()) >= @Dias * 24
        `);

    let recordados = 0;
    for (const c of candidatos.recordset) {
        if (c.CodCliente) {
            try {
                const push = require('./pushNotificationService');
                await push.sendToClient(c.CodCliente, {
                    title: 'Seguís teniendo tela en el depósito',
                    body: `${parseFloat(c.MetrosInvolucrados).toFixed(2)}m de ${c.TipoTela} (${c.CodigoEtiqueta}) esperando tu decisión.`,
                    url: '/portal/recursos',
                    tag: `excedente-${c.BobinaID}`,
                });
            } catch (ePush) {
                logger.warn(`[TELA-CLIENTE-EXCEDENTE] No se pudo mandar el recordatorio de la bobina ${c.BobinaID}: ${ePush.message}`);
            }
        }
        await pool.request().input('TID', sql.Int, c.TevID).query(
            `UPDATE dbo.TelaClienteEventos SET FechaUltimoRecordatorio = GETDATE() WHERE TevID = @TID`
        );
        recordados++;
    }

    return { escalados: escalados.recordset.length, recordados };
}

module.exports = {
    ensureSchema,
    solicitarDevolucion,
    listarBandeja,
    aprobarSolicitud,
    rechazarSolicitud,
    listarParaEmpaquetar,
    listarAvisosPendientesCliente,
    empaquetarDevolucion,
    finalizarLlegadaDeposito,
    refrescarAvisosPendientes,
    detectarCandidatosExcedente,
    marcarAvisoEnviado,
    procesarRecordatoriosYEscalado,
    getUmbralMetros,
};
