// =====================================================================
// CONSULTA AL CLIENTE — lógica de negocio (SB · DTF · ECOUV)
// =====================================================================
// El operario hace UNA pregunta sobre un archivo (o sobre la orden entera) con
// hasta 5 fotos, la orden queda FRENADA, y el cliente responde UNA vez desde su
// portal: aprueba o cancela. No hay hilo, no hay réplica.
//
// Plan y decisiones: docs/consultas-cliente-plan.md
//
// Las tres reglas que sostienen todo esto:
//
//  1. EL FRENO REUSA LO QUE YA FRENA. `Ordenes.EstadoDependencia` con un valor
//     distinto de NULL/'OK' saca la orden de la grilla activa, del kanban y de la
//     selección para lote (ordersController.getOrdersByArea). No se inventa un
//     estado nuevo en ArchivosOrden: hay 56 lugares del backend que filtran esa
//     columna por literal.
//  2. AL LIBERAR SE RESTAURA EL ESTADO REAL ANTERIOR, no un 'OK' asumido: la orden
//     pudo estar esperando otra cosa (ESPERANDO_IMPRESION, ESPERANDO_RETIRO_WMS).
//     Por eso se guarda el previo al congelar.
//  3. LA CANCELACIÓN NO SE REIMPLEMENTA. Si el cliente cancela, se llama a
//     ordersController.cancelFile / cancelOrder, que ya saben auto-cancelar la
//     orden cuando no quedan archivos, arrastrar la hermana de terminaciones,
//     escribir el historial y resincronizar el ERP. Una tercera ruta de
//     cancelación es el bug más probable de esta funcionalidad.
// =====================================================================
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { rollbackSeguro } = require('../utils/rollbackSeguro');
const { changeOrderState } = require('./stateManagerService');
const { buscarHermanaTerminaciones } = require('../utils/hermanaTerminaciones');

// Áreas habilitadas. El portal y producción nombran distinto la misma área.
const AREAS_HABILITADAS = ['SB', 'SUB', 'DF', 'DTF', 'ECOUV'];

const DEPENDENCIA_CONSULTA = 'ESPERANDO_CONSULTA';
const ESTADO_AREA_CONSULTA = 'Esperando Cliente';

// Plazo por defecto, en horas. Configurable en ConfiguracionGlobal sin deploy
// (clave CONSULTA_SLA_HORAS). 0 o vacío = sin vencimiento.
const SLA_HORAS_DEFAULT = 24;

// =====================================================================
// ESQUEMA (auto-heal, mismo patrón que ensureColFechaAprobacion / OrdenTexturasTPU)
// =====================================================================
let _schemaOk = false;
async function ensureSchema(pool) {
    if (_schemaOk) return;
    await pool.request().query(`
        IF OBJECT_ID('dbo.MotivosConsulta', 'U') IS NULL
            CREATE TABLE dbo.MotivosConsulta (
                MotConIdMotivo    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MotivosConsulta PRIMARY KEY,
                MotConTitulo      NVARCHAR(80)  NOT NULL,
                MotConDescDefault NVARCHAR(400) NULL,
                MotConActivo      BIT NOT NULL CONSTRAINT DF_MotCon_Activo DEFAULT 1,
                MotConOrden       INT NOT NULL CONSTRAINT DF_MotCon_Orden DEFAULT 0
            );

        IF OBJECT_ID('dbo.ConsultasCliente', 'U') IS NULL
            CREATE TABLE dbo.ConsultasCliente (
                ConIdConsulta      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ConsultasCliente PRIMARY KEY,
                OrdIdOrden         INT            NOT NULL,
                ArchivoID          INT            NULL,
                MotConIdMotivo     INT            NOT NULL,
                ConPregunta        NVARCHAR(1500) NOT NULL,
                ConEstado          VARCHAR(24)    NOT NULL,
                ConRespuesta       VARCHAR(12)    NULL,
                ConComentarioCli   NVARCHAR(1000) NULL,
                ConBloqueaProd     BIT NOT NULL CONSTRAINT DF_Con_Bloquea DEFAULT 1,
                ConDependenciaPrev VARCHAR(50)    NULL,
                ConEstadoAreaPrev  NVARCHAR(50)   NULL,
                ConUsuarioAlta     INT            NOT NULL,
                ConFechaAlta       DATETIME NOT NULL CONSTRAINT DF_Con_Alta DEFAULT GETDATE(),
                ConFechaVence      DATETIME       NULL,
                ConFechaRespuesta  DATETIME       NULL,
                ConRecordatorios   INT NOT NULL CONSTRAINT DF_Con_Recordatorios DEFAULT 0
            );

        -- Recordatorios ya mandados al cliente (0, 1 o 2). Va como ALTER además de estar
        -- en el CREATE porque la tabla ya existe en las bases donde F0 corrió antes que F5.
        IF COL_LENGTH('dbo.ConsultasCliente', 'ConRecordatorios') IS NULL
            ALTER TABLE dbo.ConsultasCliente
                ADD ConRecordatorios INT NOT NULL CONSTRAINT DF_Con_Recordatorios DEFAULT 0;

        -- El archivo se editó DESPUÉS de que el cliente aprobó: la conformidad ya no cubre
        -- lo que se va a imprimir. No se borra la respuesta (es el registro de lo que el
        -- cliente dijo y cuándo): se marca, y el detalle de la orden deja de mostrarla en verde.
        IF COL_LENGTH('dbo.ConsultasCliente', 'ConArteCambiado') IS NULL
            ALTER TABLE dbo.ConsultasCliente
                ADD ConArteCambiado BIT NOT NULL CONSTRAINT DF_Con_ArteCambiado DEFAULT 0;

        IF OBJECT_ID('dbo.ConsultasClienteFotos', 'U') IS NULL
            CREATE TABLE dbo.ConsultasClienteFotos (
                CFoIdFoto      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ConsultasClienteFotos PRIMARY KEY,
                ConIdConsulta  INT           NOT NULL,
                CFoRutaArchivo VARCHAR(500)  NOT NULL,
                CFoNombre      NVARCHAR(200) NULL,
                CFoFecha       DATETIME NOT NULL CONSTRAINT DF_CFo_Fecha DEFAULT GETDATE()
            );

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ConsultasCliente_AbiertaPorOrden')
            CREATE UNIQUE INDEX UX_ConsultasCliente_AbiertaPorOrden
                ON dbo.ConsultasCliente (OrdIdOrden) WHERE ConEstado = 'ENVIADA';

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ConsultasCliente_Estado')
            CREATE INDEX IX_ConsultasCliente_Estado ON dbo.ConsultasCliente (ConEstado, ConFechaVence);

        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ConsultasClienteFotos_Consulta')
            CREATE INDEX IX_ConsultasClienteFotos_Consulta ON dbo.ConsultasClienteFotos (ConIdConsulta);

        -- changeOrderState deriva el Estado general del PADRE en ConfigEstados: sin
        -- esta fila, frenar la orden le borraría el estado general. Cuelga de
        -- 'Pendiente' (id 2), igual que el 'Esperando' de TPU.
        -- OJO: EstadoID es la CLAVE PRIMARIA y NO es identity, hay que calcularlo. El
        -- lock de tabla evita que dos procesos arrancando a la vez (pm2 con varias
        -- instancias, o un restart en caliente) calculen el mismo MAX+1 y choquen
        -- contra la PK: el segundo esperaría, vería la fila ya insertada y no haría nada.
        IF NOT EXISTS (SELECT 1 FROM dbo.ConfigEstados WHERE Nombre = '${ESTADO_AREA_CONSULTA}' AND TipoEstado = 'ESTADOENAREA')
        BEGIN
            BEGIN TRANSACTION;
            DECLARE @nuevoEstadoID INT =
                (SELECT ISNULL(MAX(EstadoID), 0) + 1 FROM dbo.ConfigEstados WITH (TABLOCKX, HOLDLOCK));
            IF NOT EXISTS (SELECT 1 FROM dbo.ConfigEstados WHERE Nombre = '${ESTADO_AREA_CONSULTA}' AND TipoEstado = 'ESTADOENAREA')
                INSERT INTO dbo.ConfigEstados (EstadoID, AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado, EstadoPadreID)
                VALUES (@nuevoEstadoID, 'ADMIN', '${ESTADO_AREA_CONSULTA}', '#b45309', 28, 0, 'ESTADOENAREA', 2);
            COMMIT TRANSACTION;
        END

        IF NOT EXISTS (SELECT 1 FROM dbo.MotivosConsulta)
            INSERT INTO dbo.MotivosConsulta (MotConTitulo, MotConOrden) VALUES
                (N'Resolución / calidad del archivo', 1), (N'Medidas o proporción', 2),
                (N'Color / tonalidad', 3), (N'Contenido, texto u ortografía', 4),
                (N'Material o terminación', 5), (N'Sangrado / elementos cortados', 6),
                (N'Consulta general del pedido', 7), (N'Otro', 99);
    `);
    _schemaOk = true;
}

/** Horas de plazo configuradas (ConfiguracionGlobal.CONSULTA_SLA_HORAS). 0 = sin vencimiento. */
async function slaHoras(pool) {
    try {
        const r = await pool.request()
            .query("SELECT Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = 'CONSULTA_SLA_HORAS'");
        const v = parseFloat(r.recordset[0]?.Valor);
        return Number.isFinite(v) && v >= 0 ? v : SLA_HORAS_DEFAULT;
    } catch (_) {
        return SLA_HORAS_DEFAULT;
    }
}

// =====================================================================
// FRENAR / LIBERAR
// =====================================================================

/**
 * Congela una orden por consulta. Guarda el estado anterior en la consulta para
 * poder devolverla exactamente a donde estaba.
 * Si es ECOUV, arrastra a su hermana de terminaciones: sin impresión no hay qué terminar.
 */
async function congelarOrden(transaction, orden, opts = {}) {
    await new sql.Request(transaction)
        .input('OID', sql.Int, orden.OrdenID)
        .input('Dep', sql.VarChar(50), DEPENDENCIA_CONSULTA)
        .query('UPDATE dbo.Ordenes SET EstadoDependencia = @Dep WHERE OrdenID = @OID');

    await changeOrderState(transaction, {
        target : { type: 'ORDER', id: orden.OrdenID },
        estado : ESTADO_AREA_CONSULTA,
        userObj: opts.userObj,
        detalle: opts.detalle || 'Consulta enviada al cliente — orden frenada',
        io     : opts.io,
    });

    // ECOUV → su hermana TERMINAC también queda frenada (decisión 2 del plan).
    const hermana = await buscarHermanaTerminaciones(transaction, orden.OrdenID);
    if (hermana) {
        await new sql.Request(transaction)
            .input('HID', sql.Int, hermana.OrdenID)
            .input('Dep', sql.VarChar(50), DEPENDENCIA_CONSULTA)
            .query('UPDATE dbo.Ordenes SET EstadoDependencia = @Dep WHERE OrdenID = @HID');
        logger.info(`[CONSULTA] Hermana de terminaciones ${hermana.CodigoOrden} frenada junto a la ECOUV ${orden.CodigoOrden}.`);
    }
    return hermana;
}

/**
 * Libera la orden devolviéndola al estado que tenía ANTES de la consulta.
 * `EstadoDependencia` vuelve a su valor previo (que puede no ser 'OK'), y el estado
 * en área también. Si no hay previo guardado (consulta vieja), cae a 'OK' / 'Pendiente'.
 */
async function liberarOrden(transaction, consulta, opts = {}) {
    const depPrev = consulta.ConDependenciaPrev || 'OK';
    const areaPrev = consulta.ConEstadoAreaPrev || 'Pendiente';

    await new sql.Request(transaction)
        .input('OID', sql.Int, consulta.OrdIdOrden)
        .input('Dep', sql.VarChar(50), depPrev)
        .query('UPDATE dbo.Ordenes SET EstadoDependencia = @Dep WHERE OrdenID = @OID');

    // Solo se toca el estado en área si sigue siendo el que puso la consulta: si
    // alguien lo movió a mano mientras tanto, se respeta lo que haya.
    await changeOrderState(transaction, {
        target : { type: 'ORDER', id: consulta.OrdIdOrden },
        estado : areaPrev,
        userObj: opts.userObj,
        detalle: opts.detalle || 'Consulta resuelta — orden liberada',
        guard  : `EstadoenArea = '${ESTADO_AREA_CONSULTA}'`,
        io     : opts.io,
    });

    const hermana = await buscarHermanaTerminaciones(transaction, consulta.OrdIdOrden);
    if (hermana && String(hermana.EstadoDependencia || '') === DEPENDENCIA_CONSULTA) {
        await new sql.Request(transaction)
            .input('HID', sql.Int, hermana.OrdenID)
            .query("UPDATE dbo.Ordenes SET EstadoDependencia = 'OK' WHERE OrdenID = @HID");
    }
}

// =====================================================================
// CREAR
// =====================================================================

/**
 * Crea la consulta y frena la orden.
 * @returns {Promise<{consultaId:number, codigoOrden:string, codCliente:number}>}
 * @throws  Error con `.status` (400/404/409) para que el controller lo traduzca.
 */
async function crearConsulta({ ordenId, archivoId, motivoId, pregunta, bloquea = true, usuarioId, io }) {
    const pool = await getPool();
    await ensureSchema(pool);

    const texto = String(pregunta || '').trim();
    if (texto.length < 10) {
        throw Object.assign(new Error('Escribile la consulta al cliente: una foto sin pregunta no se entiende.'), { status: 400 });
    }
    if (!motivoId) throw Object.assign(new Error('Elegí un motivo de consulta.'), { status: 400 });

    const horas = await slaHoras(pool);
    let transaction = null;
    try {
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const ordRes = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`SELECT OrdenID, CodigoOrden, AreaID, Estado, EstadoenArea, EstadoDependencia,
                           RolloID, CodCliente, CliIdCliente, DescripcionTrabajo
                    FROM dbo.Ordenes WHERE OrdenID = @OID`);
        const orden = ordRes.recordset[0];
        if (!orden) throw Object.assign(new Error('La orden no existe.'), { status: 404 });

        const area = String(orden.AreaID || '').trim().toUpperCase();
        if (!AREAS_HABILITADAS.includes(area)) {
            throw Object.assign(new Error(`Las consultas al cliente están habilitadas solo en Sublimación, DTF y ECOUV (esta orden es de ${area || 'sin área'}).`), { status: 400 });
        }

        // Decisión 6: solo sobre pendientes. Con la orden en un lote o en máquina el
        // trabajo ya arrancó y frenarla no evita nada — además el material puede
        // estar viajando a otra área.
        const estadoGeneral = String(orden.Estado || '').trim().toLowerCase();
        if (estadoGeneral !== 'pendiente' || orden.RolloID != null) {
            throw Object.assign(new Error('Solo se puede consultar una orden que todavía está pendiente y sin lote asignado.'), { status: 409 });
        }

        const abiertaRes = await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query("SELECT TOP 1 ConIdConsulta FROM dbo.ConsultasCliente WHERE OrdIdOrden = @OID AND ConEstado = 'ENVIADA'");
        if (abiertaRes.recordset.length) {
            throw Object.assign(new Error('Esta orden ya tiene una consulta esperando respuesta del cliente.'), { status: 409 });
        }

        if (archivoId) {
            const archRes = await new sql.Request(transaction)
                .input('AID', sql.Int, archivoId)
                .input('OID', sql.Int, ordenId)
                .query("SELECT TOP 1 ArchivoID FROM dbo.ArchivosOrden WHERE ArchivoID = @AID AND OrdenID = @OID AND ISNULL(EstadoArchivo,'') NOT IN ('CANCELADO','Cancelado')");
            if (!archRes.recordset.length) {
                throw Object.assign(new Error('El archivo no pertenece a esta orden o está cancelado.'), { status: 400 });
            }
        }

        const insRes = await new sql.Request(transaction)
            .input('OID',   sql.Int, ordenId)
            .input('AID',   sql.Int, archivoId || null)
            .input('Mot',   sql.Int, motivoId)
            .input('Preg',  sql.NVarChar(1500), texto)
            .input('Bloq',  sql.Bit, bloquea ? 1 : 0)
            .input('DepP',  sql.VarChar(50), orden.EstadoDependencia || 'OK')
            .input('AreaP', sql.NVarChar(50), orden.EstadoenArea || 'Pendiente')
            .input('Usr',   sql.Int, usuarioId || 1)
            .input('Horas', sql.Float, horas)
            .query(`
                INSERT INTO dbo.ConsultasCliente
                    (OrdIdOrden, ArchivoID, MotConIdMotivo, ConPregunta, ConEstado, ConBloqueaProd,
                     ConDependenciaPrev, ConEstadoAreaPrev, ConUsuarioAlta, ConFechaVence)
                OUTPUT INSERTED.ConIdConsulta
                VALUES (@OID, @AID, @Mot, @Preg, 'ENVIADA', @Bloq,
                        @DepP, @AreaP, @Usr,
                        CASE WHEN @Horas > 0 THEN DATEADD(HOUR, @Horas, GETDATE()) ELSE NULL END)
            `);
        const consultaId = insRes.recordset[0].ConIdConsulta;

        if (bloquea) {
            await congelarOrden(transaction, orden, {
                userObj: usuarioId,
                detalle: `Consulta al cliente #${consultaId} — orden frenada`,
                io,
            });
        }

        await transaction.commit();
        logger.info(`[CONSULTA] #${consultaId} creada sobre ${orden.CodigoOrden}${archivoId ? ` (archivo ${archivoId})` : ' (orden completa)'} por el usuario ${usuarioId}.`);
        return {
            consultaId,
            ordenId,
            codigoOrden: String(orden.CodigoOrden || '').trim(),
            codCliente: orden.CodCliente,
            trabajo: orden.DescripcionTrabajo,
        };
    } catch (err) {
        await rollbackSeguro(transaction, `crearConsulta orden ${ordenId}`);
        throw err;
    }
}

/** Guarda las fotos ya movidas a su carpeta definitiva. Best-effort: no tumba la consulta. */
async function guardarFotos(consultaId, archivos) {
    if (!archivos || archivos.length === 0) return 0;
    try {
        const pool = await getPool();
        for (const f of archivos) {
            await pool.request()
                .input('CID', sql.Int, consultaId)
                .input('Ruta', sql.VarChar(500), f.path)
                .input('Nom', sql.NVarChar(200), f.originalname || f.filename)
                .query('INSERT INTO dbo.ConsultasClienteFotos (ConIdConsulta, CFoRutaArchivo, CFoNombre) VALUES (@CID, @Ruta, @Nom)');
        }
        return archivos.length;
    } catch (err) {
        logger.error(`[CONSULTA] #${consultaId}: no se pudieron registrar las fotos: ${err.message}`);
        return 0;
    }
}

// =====================================================================
// RESPONDER / RETIRAR
// =====================================================================

/**
 * El cliente responde. Es la ÚNICA respuesta: después la consulta es historial.
 * APROBADO  → libera la orden y deja la conformidad escrita.
 * CANCELADO → libera el freno y delega en la cancelación existente (ver §3 de la cabecera).
 *
 * @returns {Promise<{consulta:object, cancelar:object|null}>} `cancelar` le dice al
 *          controller qué handler invocar; el service no llama handlers HTTP.
 */
async function responderConsulta({ consultaId, respuesta, comentario, codCliente, io }) {
    const pool = await getPool();
    await ensureSchema(pool);

    const resp = String(respuesta || '').trim().toUpperCase();
    if (!['APROBADO', 'CANCELADO'].includes(resp)) {
        throw Object.assign(new Error('Respuesta inválida.'), { status: 400 });
    }

    let transaction = null;
    try {
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // UPDLOCK: dos toques al botón (o el push abierto en dos dispositivos) no
        // pueden responder dos veces la misma consulta.
        const cRes = await new sql.Request(transaction)
            .input('CID', sql.Int, consultaId)
            .query(`SELECT c.*, o.CodCliente, o.CodigoOrden, o.AreaID
                    FROM dbo.ConsultasCliente c WITH(UPDLOCK, ROWLOCK)
                    JOIN dbo.Ordenes o ON o.OrdenID = c.OrdIdOrden
                    WHERE c.ConIdConsulta = @CID`);
        const consulta = cRes.recordset[0];
        if (!consulta) throw Object.assign(new Error('La consulta no existe.'), { status: 404 });

        // Es del cliente que está respondiendo (el portal ya autentica, esto es el candado real).
        if (codCliente != null && String(consulta.CodCliente || '').trim() !== String(codCliente).trim()) {
            throw Object.assign(new Error('Esta consulta no es de tu cuenta.'), { status: 403 });
        }
        if (String(consulta.ConEstado) !== 'ENVIADA') {
            throw Object.assign(new Error('Esta consulta ya fue respondida.'), { status: 409 });
        }

        await new sql.Request(transaction)
            .input('CID', sql.Int, consultaId)
            .input('Resp', sql.VarChar(12), resp)
            .input('Com', sql.NVarChar(1000), (comentario || '').trim().substring(0, 1000) || null)
            .query(`UPDATE dbo.ConsultasCliente
                    SET ConEstado = 'RESPONDIDA', ConRespuesta = @Resp,
                        ConComentarioCli = @Com, ConFechaRespuesta = GETDATE()
                    WHERE ConIdConsulta = @CID`);

        // En los dos casos se suelta el freno: si aprobó, para que siga; si canceló,
        // porque la cancelación tiene que poder trabajar sobre la orden.
        if (consulta.ConBloqueaProd) {
            await liberarOrden(transaction, consulta, {
                userObj: 'Cliente',
                detalle: resp === 'APROBADO'
                    ? `Consulta #${consultaId}: el cliente aprobó continuar`
                    : `Consulta #${consultaId}: el cliente pidió cancelar`,
                io,
            });
        }

        await transaction.commit();
        logger.info(`[CONSULTA] #${consultaId} respondida por el cliente: ${resp}.`);

        return {
            consulta: { ...consulta, ConRespuesta: resp, ConEstado: 'RESPONDIDA' },
            cancelar: resp === 'CANCELADO'
                ? { tipo: consulta.ArchivoID ? 'FILE' : 'ORDER', ordenId: consulta.OrdIdOrden, archivoId: consulta.ArchivoID, consultaId }
                : null,
        };
    } catch (err) {
        await rollbackSeguro(transaction, `responderConsulta ${consultaId}`);
        throw err;
    }
}

/** El operario da de baja su propia consulta (se equivocó, o ya lo resolvió por teléfono). */
async function retirarConsulta({ consultaId, usuarioId, motivo, io }) {
    const pool = await getPool();
    await ensureSchema(pool);

    let transaction = null;
    try {
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        const cRes = await new sql.Request(transaction)
            .input('CID', sql.Int, consultaId)
            .query('SELECT * FROM dbo.ConsultasCliente WITH(UPDLOCK, ROWLOCK) WHERE ConIdConsulta = @CID');
        const consulta = cRes.recordset[0];
        if (!consulta) throw Object.assign(new Error('La consulta no existe.'), { status: 404 });
        if (String(consulta.ConEstado) !== 'ENVIADA') {
            throw Object.assign(new Error('Esta consulta ya no está abierta.'), { status: 409 });
        }

        await new sql.Request(transaction)
            .input('CID', sql.Int, consultaId)
            .query("UPDATE dbo.ConsultasCliente SET ConEstado = 'RETIRADA', ConFechaRespuesta = GETDATE() WHERE ConIdConsulta = @CID");

        if (consulta.ConBloqueaProd) {
            await liberarOrden(transaction, consulta, {
                userObj: usuarioId,
                detalle: motivo || `Consulta #${consultaId} retirada por el operario`,
                io,
            });
        }

        await transaction.commit();
        logger.info(`[CONSULTA] #${consultaId} retirada por el usuario ${usuarioId}.`);
        return { ok: true, ordenId: consulta.OrdIdOrden };
    } catch (err) {
        await rollbackSeguro(transaction, `retirarConsulta ${consultaId}`);
        throw err;
    }
}

/**
 * El operario editó un archivo. Dos cosas, las dos del plan §7:
 *
 *  1. Si había una consulta ABIERTA sobre ese archivo, se retira: la pregunta era sobre
 *     el arte viejo y ya no tiene sentido que el cliente la conteste. Eso libera la orden.
 *  2. Si el cliente YA había aprobado ese archivo, la conformidad se marca como vencida
 *     (`ConArteCambiado`): un arte nuevo no está aprobado. NO se borra la respuesta — es
 *     el registro de lo que el cliente dijo y cuándo, y es lo que sostiene el reclamo.
 *
 * Best-effort desde el punto de vista del que llama: esto NO puede tumbar la edición de
 * un archivo, que es la operación que el usuario pidió.
 */
async function archivoEditado({ ordenId, archivoId, usuarioId, io }) {
    const pool = await getPool();
    await ensureSchema(pool);

    const inval = await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('AID', sql.Int, archivoId)
        .query(`UPDATE dbo.ConsultasCliente
                SET ConArteCambiado = 1
                WHERE OrdIdOrden = @OID AND ArchivoID = @AID
                  AND ConEstado = 'RESPONDIDA' AND ConRespuesta = 'APROBADO'
                  AND ConArteCambiado = 0`);

    // Solo las de ESE archivo. Una consulta sobre la orden entera no queda sin sentido
    // porque se haya tocado un archivo, así que no se toca: la retira el operario si quiere.
    const abiertaRes = await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('AID', sql.Int, archivoId)
        .query(`SELECT TOP 1 ConIdConsulta FROM dbo.ConsultasCliente WITH(NOLOCK)
                WHERE OrdIdOrden = @OID AND ArchivoID = @AID AND ConEstado = 'ENVIADA'`);
    const abierta = abiertaRes.recordset[0];

    if (abierta) {
        await retirarConsulta({
            consultaId: abierta.ConIdConsulta,
            usuarioId,
            motivo: 'El archivo se editó: la consulta quedó sin efecto y la orden se liberó',
            io,
        });
    }

    return {
        retirada: abierta ? abierta.ConIdConsulta : null,
        conformidadesInvalidadas: inval.rowsAffected[0] || 0,
    };
}

// =====================================================================
// VENCIMIENTO (F5)
// =====================================================================

/**
 * Consultas abiertas cuyo plazo ya pasó.
 * Las que se crearon con `CONSULTA_SLA_HORAS = 0` no tienen ConFechaVence y nunca vencen.
 */
async function getConsultasVencidas(pool) {
    await ensureSchema(pool);
    const r = await pool.request().query(`
        SELECT c.ConIdConsulta, c.OrdIdOrden, c.ConFechaAlta, c.ConFechaVence,
               LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden, m.MotConTitulo AS Motivo
        FROM dbo.ConsultasCliente c WITH(NOLOCK)
        JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = c.OrdIdOrden
        LEFT JOIN dbo.MotivosConsulta m WITH(NOLOCK) ON m.MotConIdMotivo = c.MotConIdMotivo
        WHERE c.ConEstado = 'ENVIADA'
          AND c.ConFechaVence IS NOT NULL
          AND c.ConFechaVence <= GETDATE()
        ORDER BY c.ConFechaVence ASC`);
    return r.recordset;
}

/**
 * Vence una consulta: la orden vuelve a estar trabajable y se le avisa AL OPERADOR.
 *
 * VENCER NO CANCELA (plan §4). Cancelar por silencio destruye ventas: el cliente pudo
 * estar de vacaciones, el mail pudo caer en spam. Lo que se hace es devolver la orden a
 * donde estaba y dejar escrito que nadie respondió, para que una persona decida.
 *
 * El aviso al operador es una NOTA DE PRODUCCIÓN (la misma que se ve en el detalle de la
 * orden) más el historial que escribe changeOrderState: no hay bandeja de notificaciones
 * internas en el sistema, y una nota queda donde el operario va a mirar igual.
 */
async function vencerConsulta({ consultaId, io }) {
    const pool = await getPool();
    await ensureSchema(pool);

    let transaction = null;
    try {
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // UPDLOCK: con varias instancias de pm2, dos jobs pueden agarrar la misma consulta.
        const cRes = await new sql.Request(transaction)
            .input('CID', sql.Int, consultaId)
            .query('SELECT * FROM dbo.ConsultasCliente WITH(UPDLOCK, ROWLOCK) WHERE ConIdConsulta = @CID');
        const consulta = cRes.recordset[0];
        if (!consulta) throw Object.assign(new Error('La consulta no existe.'), { status: 404 });

        // El cliente pudo responder entre el SELECT del job y este UPDATE: no se pisa.
        if (String(consulta.ConEstado) !== 'ENVIADA') {
            await transaction.rollback();
            return { ok: false, motivo: 'ya no estaba abierta' };
        }

        await new sql.Request(transaction)
            .input('CID', sql.Int, consultaId)
            .query("UPDATE dbo.ConsultasCliente SET ConEstado = 'VENCIDA', ConFechaRespuesta = GETDATE() WHERE ConIdConsulta = @CID");

        if (consulta.ConBloqueaProd) {
            await liberarOrden(transaction, consulta, {
                userObj: 'Sistema',
                detalle: `Consulta #${consultaId} vencida sin respuesta del cliente — orden liberada`,
                io,
            });
        }

        const horas = Math.round((Date.now() - new Date(consulta.ConFechaAlta).getTime()) / 3600000);
        await new sql.Request(transaction)
            .input('OID', sql.Int, consulta.OrdIdOrden)
            .input('Texto', sql.NVarChar(sql.MAX),
                `⏰ La consulta al cliente #${consultaId} venció sin respuesta (${horas} h). ` +
                `La orden volvió a estar disponible SIN la aprobación del cliente: decidí vos si se imprime igual, ` +
                `se lo llamás o se cancela.`)
            .query(`INSERT INTO dbo.OrdenNotasProduccion (OrdenID, Texto, UsuarioID, UsuarioNombre, FechaCreacion)
                    VALUES (@OID, @Texto, NULL, 'Sistema', GETDATE())`);

        await transaction.commit();
        logger.warn(`[CONSULTA] #${consultaId} VENCIDA sin respuesta tras ${horas} h. Orden ${consulta.OrdIdOrden} liberada.`);
        return { ok: true, ordenId: consulta.OrdIdOrden, horas };
    } catch (err) {
        await rollbackSeguro(transaction, `vencerConsulta ${consultaId}`);
        throw err;
    }
}

// Recordatorios al cliente: uno a las 4 h y otro a las 20 h de enviada la consulta
// (plan F5). Son absolutos y no proporcionales al plazo: si alguien configura un SLA
// más corto, la consulta vence antes y el job simplemente no llega a mandarlos.
const RECORDATORIOS_HORAS = [4, 20];

/** Consultas abiertas a las que les toca un recordatorio, con cuál les toca. */
async function getConsultasParaRecordar(pool) {
    await ensureSchema(pool);
    const r = await pool.request().query(`
        SELECT c.ConIdConsulta, c.OrdIdOrden, c.ConRecordatorios, c.ConFechaAlta,
               DATEDIFF(MINUTE, c.ConFechaAlta, GETDATE()) AS MinutosDeVida,
               LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden
        FROM dbo.ConsultasCliente c WITH(NOLOCK)
        JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = c.OrdIdOrden
        WHERE c.ConEstado = 'ENVIADA'
          AND c.ConRecordatorios < ${RECORDATORIOS_HORAS.length}
          AND (c.ConFechaVence IS NULL OR c.ConFechaVence > GETDATE())`);

    return r.recordset
        .map(c => {
            // Cuál es el último umbral cumplido. Si la consulta estuvo 21 h (el server
            // estuvo caído, por ejemplo), manda UNO solo y salta al contador 2: no tiene
            // sentido mandarle dos push seguidos al cliente.
            const horas = c.MinutosDeVida / 60;
            let nivel = 0;
            RECORDATORIOS_HORAS.forEach((h, i) => { if (horas >= h) nivel = i + 1; });
            return { ...c, nivel };
        })
        .filter(c => c.nivel > c.ConRecordatorios);
}

/** Deja escrito qué recordatorio se mandó, para no repetirlo. */
async function marcarRecordatorio(pool, consultaId, nivel) {
    await pool.request()
        .input('CID', sql.Int, consultaId)
        .input('N', sql.Int, nivel)
        .query('UPDATE dbo.ConsultasCliente SET ConRecordatorios = @N WHERE ConIdConsulta = @CID AND ConRecordatorios < @N');
}

// =====================================================================
// LECTURA
// =====================================================================

async function getMotivos() {
    const pool = await getPool();
    await ensureSchema(pool);
    const r = await pool.request().query(`
        SELECT MotConIdMotivo, MotConTitulo, MotConDescDefault
        FROM dbo.MotivosConsulta WITH(NOLOCK)
        WHERE MotConActivo = 1 ORDER BY MotConOrden, MotConTitulo`);
    return r.recordset;
}

/** Consultas de una orden (todas, con sus fotos): alimenta el detalle de orden. */
async function getConsultasDeOrden(ordenId) {
    const pool = await getPool();
    await ensureSchema(pool);
    const r = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query(`
            SELECT c.*, m.MotConTitulo AS Motivo,
                   a.NombreArchivo,
                   u.Nombre AS UsuarioNombre
            FROM dbo.ConsultasCliente c WITH(NOLOCK)
            LEFT JOIN dbo.MotivosConsulta m WITH(NOLOCK) ON m.MotConIdMotivo = c.MotConIdMotivo
            LEFT JOIN dbo.ArchivosOrden  a WITH(NOLOCK) ON a.ArchivoID = c.ArchivoID
            LEFT JOIN dbo.Usuarios       u WITH(NOLOCK) ON u.IdUsuario = c.ConUsuarioAlta
            WHERE c.OrdIdOrden = @OID
            ORDER BY c.ConIdConsulta DESC`);
    return adjuntarFotos(pool, r.recordset);
}

/** Consultas ESPERANDO respuesta de un cliente: alimenta el portal. */
async function getConsultasPendientesCliente(codCliente) {
    const pool = await getPool();
    await ensureSchema(pool);
    const r = await pool.request()
        .input('Cod', sql.NVarChar(10), String(codCliente ?? ''))
        .query(`
            SELECT c.ConIdConsulta, c.OrdIdOrden, c.ArchivoID, c.ConPregunta, c.ConFechaAlta, c.ConFechaVence,
                   m.MotConTitulo AS Motivo,
                   LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden,
                   LTRIM(RTRIM(o.NoDocERP))    AS NoDocERP,
                   o.DescripcionTrabajo, o.Material,
                   a.NombreArchivo
            FROM dbo.ConsultasCliente c WITH(NOLOCK)
            JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = c.OrdIdOrden
            LEFT JOIN dbo.MotivosConsulta m WITH(NOLOCK) ON m.MotConIdMotivo = c.MotConIdMotivo
            LEFT JOIN dbo.ArchivosOrden  a WITH(NOLOCK) ON a.ArchivoID = c.ArchivoID
            WHERE c.ConEstado = 'ENVIADA' AND o.CodCliente = @Cod
            ORDER BY c.ConFechaAlta ASC`);
    return adjuntarFotos(pool, r.recordset);
}

async function adjuntarFotos(pool, filas) {
    if (!filas.length) return filas;
    const ids = filas.map(f => f.ConIdConsulta).join(',');
    const fRes = await pool.request().query(
        `SELECT CFoIdFoto, ConIdConsulta, CFoNombre FROM dbo.ConsultasClienteFotos WITH(NOLOCK) WHERE ConIdConsulta IN (${ids})`);
    for (const fila of filas) {
        fila.fotos = fRes.recordset.filter(x => x.ConIdConsulta === fila.ConIdConsulta);
    }
    return filas;
}

/**
 * Órdenes (de una lista) que tienen una consulta abierta. La usa el guard de
 * assignRoll: sin esto, una orden frenada podría entrar a un lote por API, porque
 * assignRoll no valida ningún estado.
 */
async function ordenesConConsultaAbierta(pool, ordenIds) {
    const ids = (ordenIds || []).map(n => parseInt(n, 10)).filter(Number.isFinite);
    if (!ids.length) return [];
    try {
        await ensureSchema(pool);
        const r = await pool.request().query(`
            SELECT c.OrdIdOrden, LTRIM(RTRIM(o.CodigoOrden)) AS CodigoOrden
            FROM dbo.ConsultasCliente c WITH(NOLOCK)
            JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = c.OrdIdOrden
            WHERE c.ConEstado = 'ENVIADA' AND c.ConBloqueaProd = 1 AND c.OrdIdOrden IN (${ids.join(',')})`);
        return r.recordset;
    } catch (err) {
        // Un fallo del chequeo no puede impedir armar lotes: se avisa y se sigue.
        logger.warn(`[CONSULTA] ordenesConConsultaAbierta falló: ${err.message}`);
        return [];
    }
}

module.exports = {
    ensureSchema,
    crearConsulta,
    guardarFotos,
    responderConsulta,
    retirarConsulta,
    archivoEditado,
    getConsultasVencidas,
    vencerConsulta,
    getConsultasParaRecordar,
    marcarRecordatorio,
    RECORDATORIOS_HORAS,
    getMotivos,
    getConsultasDeOrden,
    getConsultasPendientesCliente,
    ordenesConConsultaAbierta,
    AREAS_HABILITADAS,
    DEPENDENCIA_CONSULTA,
    ESTADO_AREA_CONSULTA,
};
