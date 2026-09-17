const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { changeOrderState } = require('../services/stateManagerService');

// [BANDEJA GENÉRICA] Bandeja simple de órdenes (NO lotes) — reemplaza la Mesa de
// Armado/Control por lotes que usan el resto de las áreas. Nace para Bordado (EMB) y se
// generalizó para Estampado (EST): ambas son "servicios" sin archivo de impresión propio
// (Magnitud='0' a propósito), cada tarjeta es UNA orden. Mismo espíritu que Terminaciones
// (EcoUvFinishing), pero sin nada de hermanas XEUV/terminaciones-por-archivo — acá el gate
// es el checklist de Requisitos (ConfigRequisitosProduccion / OrdenCumplimientoRequisitos)
// que ya usa OrderRequirementsList. Todas las funciones toman `area` de req.query.area
// (default 'EMB' por compatibilidad) — embRoutes.js la fuerza a 'EMB', estRoutes.js a 'EST'.
//
// fase=trabajo (default): pendientes CON todos los requisitos bloqueantes cumplidos.
// fase=control: ya trabajadas (EstadoenArea='Control y Calidad'), esperando el conteo de
//   Control y la cantidad de bultos antes de aprobar (recién ahí se generan etiquetas).

// Extraer ID de Drive de una URL (mismo helper que productionController.js) — para armar
// el link de miniatura pública sin generar nada del lado del servidor.
const getDriveId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:id=|\/d\/)([\w-]+)/);
    return match ? match[1] : null;
};

// Campos comunes que se agregan a la orden en ambas fases: máquina/operario asignados,
// TODOS los archivos de referencia recientes (boceto + logo, no solo el último) y resumen
// de notas — todo con subconsultas correlacionadas en la MISMA query, sin N+1 por tarjeta.
const CAMPOS_ENRIQUECIDOS = `
    m.Nombre AS MaquinaNombre,
    u.Nombre AS OperarioNombre,
    (
        SELECT TOP 4 RefID, NombreOriginal, TipoArchivo, UbicacionStorage
        FROM ArchivosReferencia WHERE OrdenID = o.OrdenID
        ORDER BY FechaSubida DESC
        FOR JSON PATH
    ) AS RefsJson,
    (SELECT COUNT(*) FROM OrdenNotasProduccion WHERE OrdenID = o.OrdenID) AS NotasCount,
    -- [CORTE] Tizadas de la orden con su medición y su avance propio: el trabajo y el
    -- control se llevan POR ARCHIVO (cada tizada es un corte distinto), no de a una
    -- bolsa de prendas sueltas. Solo trae los archivos que tienen piezas medidas.
    (
        SELECT ao.ArchivoID, ao.NombreArchivo, ao.Copias, ao.Piezas, ao.MetrosCorte,
               ao.Metros, ao.Ancho, ao.Alto, ao.PiezasTrabajadas, ao.PiezasControladas,
               ao.RutaAlmacenamiento,
               -- [BORDADO] El diseño: cuántas puntadas lleva y con qué hilos y
               -- puntadas se borda cada parte. Es lo que el bordador necesita ver
               -- antes de enhebrar; sin esto tenía que sacarle los colores a ojo
               -- a una imagen.
               ao.PuntadasEstimadas, ao.PaletaBordado
        FROM ArchivosOrden ao
        WHERE ao.OrdenID = o.OrdenID AND ao.Piezas IS NOT NULL
        ORDER BY ao.ArchivoID
        FOR JSON PATH
    ) AS TizadasJson,
    (SELECT TOP 1 Texto FROM OrdenNotasProduccion WHERE OrdenID = o.OrdenID ORDER BY FechaCreacion DESC) AS UltimaNota,
    -- [PRENDAS] Hermana de una prenda comprada+personalizada: la cantidad REAL vive en la
    -- orden madre PRO (misma NoDocERP), la propia Magnitud queda en '0' a propósito (ver
    -- prendasOrdersController.js). Sin esto, el progreso nunca cierra para estas órdenes.
    -- [CORTE] El CONTROL cuenta PIEZAS: si la orden tiene tizadas medidas (Piezas en los
    -- archivos de producción ArchivosOrden — × copias — o en ArchivosReferencia para las
    -- órdenes viejas), el total a controlar es la suma de piezas — la Magnitud puede estar
    -- en METROS de corte (lo que se cotiza, según la UM del artículo) y no sirve para contar.
    CASE
        WHEN (SELECT SUM(ao.Piezas * ISNULL(ao.Copias, 1)) FROM ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID AND ao.Piezas IS NOT NULL) > 0
            THEN CAST((SELECT SUM(ao.Piezas * ISNULL(ao.Copias, 1)) FROM ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID AND ao.Piezas IS NOT NULL) AS VARCHAR(50))
        WHEN (SELECT SUM(ar.Piezas) FROM ArchivosReferencia ar WHERE ar.OrdenID = o.OrdenID AND ar.Piezas IS NOT NULL) > 0
            THEN CAST((SELECT SUM(ar.Piezas) FROM ArchivosReferencia ar WHERE ar.OrdenID = o.OrdenID AND ar.Piezas IS NOT NULL) AS VARCHAR(50))
        WHEN TRY_CAST(o.Magnitud AS FLOAT) > 0 THEN o.Magnitud
        ELSE pro.Magnitud
    END AS MagnitudEfectiva
`;
// [PRENDAS] La orden PRO de la que una orden de decoración toma su cantidad de prendas
// (cuando su propia Magnitud está en 0). Antes era un LEFT JOIN a "la PRO del pedido",
// que asumía UNA sola: con "Comprar y personalizar" hay una PRO por artículo del carrito,
// y el Bordado salía repetido una vez por cada PRO (3 tarjetas iguales en la bandeja, cada
// una con la cantidad de otro artículo — caso BOR-20947). Ahora se toma UNA:
//   1) la ancla de retiro VEN- de SU MISMO grupo (ComboItemID): es el artículo que
//      realmente se borda, con su cantidad real (vale para combos y para el carrito);
//   2) si no hay ancla, la orden madre del pedido (PRO sin ComboItemID);
//   3) en último caso, cualquier PRO del pedido — nunca más de una fila.
const APPLY_PRO_DE_LA_ORDEN = `
    OUTER APPLY (
        SELECT TOP 1 p.Magnitud
        FROM Ordenes p
        WHERE (
                o.ComboItemID IS NOT NULL
                AND p.ComboItemID = o.ComboItemID
                AND p.EstadoDependencia = 'VENTA_DIRECTA'
                AND LTRIM(RTRIM(p.ComboPedidoNoDocERP)) = LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
              )
           OR (LTRIM(RTRIM(p.NoDocERP)) = LTRIM(RTRIM(o.NoDocERP)) AND p.AreaID = 'PRO')
        ORDER BY
            CASE WHEN o.ComboItemID IS NOT NULL AND p.ComboItemID = o.ComboItemID
                      AND p.EstadoDependencia = 'VENTA_DIRECTA' THEN 0
                 WHEN p.ComboItemID IS NULL THEN 1
                 ELSE 2 END,
            p.OrdenID
    ) pro
`;

const JOINS_ENRIQUECIDOS = `
    LEFT JOIN ConfigEquipos m ON m.EquipoID = o.MaquinaID
    LEFT JOIN Usuarios u ON u.IdUsuario = o.OperarioAsignadoID
    ${APPLY_PRO_DE_LA_ORDEN}
`;

// [ESTAMPADO] Cuando hay DTF y TPU activos a la vez, se crean DOS órdenes de Estampado
// (una por cada transfer — ver prendasOrdersController.js, fisicasEST), cada una encadenada
// con LiberaCuandoOrdenID a SU fuente específica (la orden DF o la TPU de la que depende).
// EstadoDependencia='OK' solo dice que la PRODUCCIÓN de esa fuente terminó — no que el
// transfer ya llegó físicamente a Estampado. En vez de un requisito con nombre fijo
// ('DTF'/'TPU', que le aparecería a las DOS órdenes de EST por igual aunque cada una solo
// dependa de una), este chequeo es automático por orden: ¿ya hay un bulto de la orden
// LiberaCuandoOrdenID físicamente en stock en esta área? "Prendas a Estampar" (el gate
// PRENDA vía Requisitos) sigue siendo el checklist con nombre — es común a las dos.
const SQL_TRANSFER_LLEGO = `
    (o.LiberaCuandoOrdenID IS NULL OR EXISTS (
        SELECT 1 FROM Logistica_Bultos lb
        WHERE lb.OrdenID = o.LiberaCuandoOrdenID AND lb.UbicacionActual = @Area AND lb.Estado = 'EN_STOCK'
    ))
`;

// Área efectiva de la request: query param si viene (estRoutes.js/embRoutes.js lo fuerzan),
// si no default 'EMB' por compatibilidad con el código ya desplegado.
const getArea = (req) => (req.query?.area || req.body?.area || 'EMB').toString().trim().toUpperCase();

// [PRENDAS] Cantidad real de prendas de la orden: si es hermana de una orden madre PRO
// (Magnitud propia en '0' a propósito, ver prendasOrdersController.js), sale de ahí.
// Compartida por setProgreso / setProgresoControl / aprobarControl para no repetir el JOIN.
// Exportada para libroEntregasController (Spec 39, envío por orden): necesita la MISMA
// magnitud efectiva que usa esta bandeja para saber si una orden sigue en producción.
exports.getMagnitudEfectiva = getMagnitudEfectiva;
async function getMagnitudEfectiva(pool, ordenId) {
    const r = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query(`
            SELECT CASE
                -- [CORTE] el control cuenta PIEZAS (suma de las tizadas medidas), no la
                -- Magnitud en metros de corte (misma regla que CAMPOS_ENRIQUECIDOS).
                WHEN (SELECT SUM(ao.Piezas * ISNULL(ao.Copias, 1)) FROM ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID AND ao.Piezas IS NOT NULL) > 0
                    THEN CAST((SELECT SUM(ao.Piezas * ISNULL(ao.Copias, 1)) FROM ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID AND ao.Piezas IS NOT NULL) AS VARCHAR(50))
                WHEN (SELECT SUM(ar.Piezas) FROM ArchivosReferencia ar WHERE ar.OrdenID = o.OrdenID AND ar.Piezas IS NOT NULL) > 0
                    THEN CAST((SELECT SUM(ar.Piezas) FROM ArchivosReferencia ar WHERE ar.OrdenID = o.OrdenID AND ar.Piezas IS NOT NULL) AS VARCHAR(50))
                WHEN TRY_CAST(o.Magnitud AS FLOAT) > 0 THEN o.Magnitud
                ELSE pro.Magnitud
            END AS MagnitudEfectiva
            FROM Ordenes o
            ${APPLY_PRO_DE_LA_ORDEN}
            WHERE o.OrdenID = @OID
        `);
    if (!r.recordset.length) return null;
    return parseFloat(r.recordset[0].MagnitudEfectiva) || 0;
}

// Arma la URL de preview de cada referencia (miniatura pública de Drive si hay ID, si no
// el thumbnail local que ya genera el sistema al subir — thumbnailGenerator.js). Distingue
// boceto de logo/matriz por TipoArchivo (BOCETO_BORDADO / LOGO_BORDADO, ver
// PrendaOrderForm.jsx) para poder mostrar los dos por separado en el detalle.
function enriquecerPreview(row) {
    let refs = [];
    try { refs = row.RefsJson ? JSON.parse(row.RefsJson) : []; } catch (e) { refs = []; }
    row.Referencias = refs.map(f => {
        const driveId = getDriveId(f.UbicacionStorage);
        const previewUrl = driveId
            ? `https://drive.google.com/thumbnail?id=${driveId}&sz=w300`
            : `/thumbnails/${encodeURIComponent(row.CodigoOrden)}/${f.RefID}.jpg`;
        const tipo = (f.TipoArchivo || '').toUpperCase();
        // [BORDADO] El prediseño se chequea PRIMERO y se excluye de las otras dos
        // categorías: es el arte que coloreó el cliente y es solo REFERENCIA — la
        // matriz la hace igual un diseñador. Si cayera como "logo", el bordador
        // podría ponchar sobre él creyendo que es el arte original.
        const esPrediseno = tipo.includes('PREDISENO');
        const esBoceto = !esPrediseno && tipo.includes('BOCETO');
        const esLogo = !esPrediseno && (tipo.includes('LOGO') || tipo.includes('MATRIZ'));
        return { ...f, previewUrl, esBoceto, esLogo, esPrediseno };
    });
    // Compat con lo que ya pintaba la tarjeta chica de la bandeja (primer archivo, cualquiera).
    row.PreviewUrl = row.Referencias[0]?.previewUrl || null;
    delete row.RefsJson;

    // [CORTE] Tizadas con su avance propio (trabajo/control por archivo).
    let tizadas = [];
    try { tizadas = row.TizadasJson ? JSON.parse(row.TizadasJson) : []; } catch (e) { tizadas = []; }
    row.Tizadas = tizadas.map(t => {
        // [BORDADO] La paleta viaja como JSON en la columna: se entrega ya parseada
        // para que la pantalla no tenga que saber que era texto.
        let paleta = [];
        try { paleta = t.PaletaBordado ? JSON.parse(t.PaletaBordado) : []; } catch (e) { paleta = []; }
        return {
            ...t,
            Paleta: paleta,
            // Total de piezas de ESE archivo = piezas de la tizada × veces que se corta
            PiezasTotal: (parseInt(t.Piezas) || 0) * (parseInt(t.Copias) || 1),
            MetrosCorteTotal: (parseFloat(t.MetrosCorte) || 0) * (parseInt(t.Copias) || 1),
            MetrosTelaTotal: (parseFloat(t.Metros) || 0) * (parseInt(t.Copias) || 1),
        };
    });
    delete row.TizadasJson;
    return row;
}

// [CORTE] Sincroniza el total de la ORDEN con la suma del avance de sus tizadas: el gate de
// "Aprobar Control" y el % de la tarjeta siguen leyendo CantidadTerminada/CantidadControlada.
/**
 * Spec 39 (extensión "aprobar por tandas"): cuánto llegó realmente del área INMEDIATAMENTE
 * anterior del pedido — el límite físico real para el avance de Trabajo. Si no hay área
 * anterior (primera de la cadena), o esa área no declara cantidad en una unidad comparable
 * (ej. Sublimación mide metros, no prendas — cantidad queda null), no hay con qué validar y
 * se deja como antes (solo contra la magnitud total de la orden).
 */
async function getRecibidoDeAreaAnterior(pool, ordenId) {
    const o = await new sql.Request(pool).input('id', sql.Int, ordenId)
        .query(`SELECT AreaID, LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) AS NoDoc FROM Ordenes WHERE OrdenID = @id`);
    const row = o.recordset[0];
    if (!row?.NoDoc) return null;

    // [VENTA/COMBO] Si la orden sale de una venta de retiro (ancla VEN- de su mismo grupo,
    // ComboItemID) y esa venta la tiene como PRIMER paso físico, lo que "llegó del área
    // anterior" es ese retiro — no lo que diga el libro de entregas. El libro ordena las
    // áreas del pedido entero, sin separar por prenda: en un pedido con Short (Bordado) y
    // Gorro (Bordado → Estampado) le tomaba Estampado del Gorro como área anterior al
    // Bordado del Short, no encontraba nada llegado y trababa el trabajo en 0 aunque el
    // bulto de la venta ya estaba en Bordado (caso BOR-20947 / VEN-2405).
    try {
        const g = await new sql.Request(pool).input('id', sql.Int, ordenId).query(`
            SELECT TOP 1 a.Magnitud AS AnclaMagnitud,
                   (SELECT COUNT(*) FROM Logistica_Bultos b WHERE b.OrdenID = a.OrdenID) AS BultosAncla,
                   (SELECT COUNT(DISTINCT b.BultoID)
                      FROM Logistica_Bultos b
                      JOIN MovimientosLogistica m ON m.CodigoBulto = b.CodigoEtiqueta
                                                 AND m.EsRecepcion = 1 AND m.AreaID = o.AreaID
                     WHERE b.OrdenID = a.OrdenID) AS BultosRecibidos
            FROM Ordenes o
            JOIN Ordenes a ON a.EstadoDependencia = 'VENTA_DIRECTA'
                          AND a.ComboItemID = o.ComboItemID
                          AND LTRIM(RTRIM(a.ComboPedidoNoDocERP)) = LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50))))
                          AND UPPER(LTRIM(RTRIM(a.ProximoServicio))) = UPPER(LTRIM(RTRIM(o.AreaID)))
            WHERE o.OrdenID = @id AND o.ComboItemID IS NOT NULL
        `);
        if (g.recordset.length) {
            const { AnclaMagnitud, BultosAncla, BultosRecibidos } = g.recordset[0];
            // No llegó ningún bulto de la venta: de verdad no hay nada para trabajar.
            if (!BultosRecibidos) return 0;
            // Llegó una parte de los bultos: no se sabe cuántas prendas trae cada uno, así que
            // no se inventa un número — se deja pasar (mismo criterio que "unidad no comparable").
            if (BultosAncla > 0 && BultosRecibidos < BultosAncla) return null;
            // Llegó todo: la cantidad es la de la venta de retiro.
            return parseFloat(AnclaMagnitud) || null;
        }
    } catch (e) { logger.warn('[Bandeja] getRecibidoDeAreaAnterior (retiro): ' + e.message); }

    try {
        const libro = require('../services/libroEntregasService');
        // Mirado desde ESTA orden: en un pedido con varias prendas solo cuentan las órdenes
        // que le mandan prendas a ella (getPendientesParaOrden); sin prendas separadas, igual
        // que antes.
        const pendientes = await libro.getPendientesParaOrden(ordenId, row.NoDoc, row.AreaID, pool);
        const anteriores = pendientes.anteriores || [];
        if (!anteriores.length) return null;
        const inmediata = anteriores[anteriores.length - 1];
        const deInmediata = (pendientes.ordenes || []).filter(p => p.AreaID === inmediata);
        if (!deInmediata.length) return null;
        // Si todavía no llegó NADA (0 envíos), es 0 de verdad — se valida contra 0. Si llegó
        // algo pero esa área no declaró cantidad (unidad no comparable, ej. metros), no hay
        // con qué validar y se deja pasar (null).
        if (deInmediata.some(p => (p.recibido?.envios || 0) > 0 && p.recibido?.cantidad == null)) return null;
        return deInmediata.reduce((s, p) => s + Number(p.recibido?.cantidad || 0), 0);
    } catch (e) { logger.warn('[Bandeja] getRecibidoDeAreaAnterior: ' + e.message); return null; }
}

async function recalcularAvanceDesdeArchivos(pool, ordenId) {
    await pool.request()
        .input('OID', sql.Int, ordenId)
        .query(`
            UPDATE Ordenes SET
                CantidadTerminada  = ISNULL((SELECT SUM(ISNULL(ao.PiezasTrabajadas, 0))  FROM ArchivosOrden ao WHERE ao.OrdenID = @OID AND ao.Piezas IS NOT NULL), CantidadTerminada),
                CantidadControlada = ISNULL((SELECT SUM(ISNULL(ao.PiezasControladas, 0)) FROM ArchivosOrden ao WHERE ao.OrdenID = @OID AND ao.Piezas IS NOT NULL), CantidadControlada)
            WHERE OrdenID = @OID
        `);
}

// GATE MÁQUINA + OPERARIO (todas las áreas de esta bandeja: EMB, EST, TWC, TWT).
// Sin los dos asignados no se puede iniciar el trabajo ni cargar cantidades hechas: si no,
// la producción queda sin responsable ni equipo y los reportes por operario/máquina salen
// vacíos. El Control (calidad) NO pasa por acá — es otra fase, con otra persona.
async function faltaMaquinaUOperario(pool, ordenId) {
    const r = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query('SELECT MaquinaID, OperarioAsignadoID FROM Ordenes WHERE OrdenID = @OID');
    if (!r.recordset.length) return 'Orden no encontrada.';
    const { MaquinaID, OperarioAsignadoID } = r.recordset[0];
    const faltan = [];
    if (!MaquinaID) faltan.push('la máquina');
    if (!OperarioAsignadoID) faltan.push('el operario');
    if (!faltan.length) return null;
    return `Asigná ${faltan.join(' y ')} antes de iniciar o cargar el avance del trabajo.`;
}

// Piezas totales de UNA tizada (piezas del archivo × veces que se corta) — tope del contador.
async function getPiezasDeArchivo(pool, ordenId, archivoId) {
    const r = await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('AID', sql.Int, archivoId)
        .query(`SELECT ISNULL(Piezas, 0) * ISNULL(Copias, 1) AS PiezasTotal
                FROM ArchivosOrden WHERE ArchivoID = @AID AND OrdenID = @OID`);
    if (!r.recordset.length) return null;
    return parseInt(r.recordset[0].PiezasTotal) || 0;
}

// PUT /orders/:ordenId/archivos/:archivoId/progreso — piezas cortadas de ESA tizada.
// campo = 'PiezasTrabajadas' (trabajo) | 'PiezasControladas' (control).
async function setAvanceArchivo(req, res, campo, etiqueta) {
    const ordenId = parseInt(req.params.ordenId, 10);
    const archivoId = parseInt(req.params.archivoId, 10);
    const cantidad = parseInt(req.body?.cantidad, 10);
    if (!ordenId || !archivoId) return res.status(400).json({ error: 'ordenId/archivoId inválido.' });
    if (isNaN(cantidad) || cantidad < 0) return res.status(400).json({ error: 'Cantidad inválida.' });
    try {
        const pool = await getPool();
        // El avance de TRABAJO exige máquina y operario; el de Control no.
        if (etiqueta === 'trabajo') {
            const falta = await faltaMaquinaUOperario(pool, ordenId);
            if (falta) return res.status(400).json({ error: falta });
        }
        const total = await getPiezasDeArchivo(pool, ordenId, archivoId);
        if (total === null) return res.status(404).json({ error: 'Tizada no encontrada en esta orden.' });
        if (total > 0 && cantidad > total) {
            return res.status(400).json({ error: `No puede superar las ${total} piezas de esta tizada.` });
        }
        // Spec 39 (extensión "aprobar por tandas"): Control no puede declarar más piezas de
        // ESTA tizada que las que Trabajo ya marcó como cortadas.
        if (etiqueta === 'control') {
            const tr = await pool.request().input('AID', sql.Int, archivoId)
                .query(`SELECT PiezasTrabajadas FROM ArchivosOrden WHERE ArchivoID = @AID`);
            const trabajadas = tr.recordset[0]?.PiezasTrabajadas;
            // NULL (esta tizada nunca registró avance de Trabajo) no es lo mismo que 0: sin
            // dato no hay con qué comparar, se deja pasar.
            if (trabajadas != null && cantidad > trabajadas) {
                return res.status(400).json({ error: `No podés controlar más de lo que se trabajó en esta tizada (${trabajadas}).` });
            }
        }
        // Trabajo no puede superar lo que realmente llegó del área anterior del pedido
        // (cuando esa área declara cantidad en una unidad comparable).
        if (etiqueta === 'trabajo') {
            const recibido = await getRecibidoDeAreaAnterior(pool, ordenId);
            if (recibido != null) {
                const otras = await pool.request().input('OID', sql.Int, ordenId).input('AID', sql.Int, archivoId)
                    .query(`SELECT ISNULL(SUM(ISNULL(PiezasTrabajadas, 0)), 0) AS Suma FROM ArchivosOrden WHERE OrdenID = @OID AND ArchivoID <> @AID AND Piezas IS NOT NULL`);
                const nuevoTotal = (otras.recordset[0]?.Suma || 0) + cantidad;
                if (nuevoTotal > recibido) {
                    return res.status(400).json({ error: `No podés trabajar más de lo que llegó del área anterior (${recibido} en total de la orden). Si te falta, reportá un faltante.` });
                }
            }
        }

        await pool.request()
            .input('AID', sql.Int, archivoId)
            .input('Cant', sql.Int, cantidad)
            .query(`UPDATE ArchivosOrden SET ${campo} = @Cant WHERE ArchivoID = @AID`);

        await recalcularAvanceDesdeArchivos(pool, ordenId);
        res.json({ success: true });
    } catch (err) {
        logger.error(`[Bandeja] avance ${etiqueta} por tizada: ` + err.message);
        res.status(500).json({ error: err.message });
    }
}

exports.setProgresoArchivo = (req, res) => setAvanceArchivo(req, res, 'PiezasTrabajadas', 'trabajo');
exports.setProgresoControlArchivo = (req, res) => setAvanceArchivo(req, res, 'PiezasControladas', 'control');

exports.getEmbOrders = async (req, res) => {
    const fase = (req.query.fase || 'trabajo').toLowerCase();
    const area = getArea(req);
    try {
        const pool = await getPool();
        const query = fase === 'control'
            ? `
                SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material, o.Variante, o.Nota,
                       o.Magnitud, o.Prioridad, o.FechaIngreso, o.Estado, o.EstadoenArea, o.NoDocERP,
                       o.MaquinaID, o.OperarioAsignadoID, o.EstadoTrabajoEmb, o.CantidadTerminada, o.CantidadControlada, o.CantidadAprobadaBultos, ${CAMPOS_ENRIQUECIDOS},
                       -- [CONTROL] Falla reportada desde acá que todavía no se repuso: la pantalla
                       -- avisa que solo se puede aprobar por tandas hasta que llegue.
                       (SELECT COUNT(*) FROM Reposiciones rp
                         WHERE rp.OrdenReportaID = o.OrdenID
                           AND rp.Estado IN ('ESPERANDO_INSUMO','BLOQUEADA','PENDIENTE','EN_PRODUCCION','ENVIADA')) AS ReposicionesAbiertas,
                       (SELECT ISNULL(SUM(ISNULL(rp.Cantidad, 0)), 0) FROM Reposiciones rp
                         WHERE rp.OrdenReportaID = o.OrdenID
                           AND rp.Estado IN ('ESPERANDO_INSUMO','BLOQUEADA','PENDIENTE','EN_PRODUCCION','ENVIADA')) AS CantidadEnReposicion
                FROM Ordenes o
                ${JOINS_ENRIQUECIDOS}
                WHERE o.AreaID = @Area AND o.Estado NOT IN ('Cancelado')
                  AND o.EstadoenArea = 'Control y Calidad'
                ORDER BY o.FechaIngreso ASC
            `
            : `
                SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material, o.Variante, o.Nota,
                       o.Magnitud, o.Prioridad, o.FechaIngreso, o.Estado, o.EstadoenArea, o.NoDocERP,
                       o.MaquinaID, o.OperarioAsignadoID, o.EstadoTrabajoEmb, o.CantidadTerminada, o.CantidadAprobadaBultos,
                       CONVERT(VARCHAR(10), ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega), 23) AS FechaPrometidaEfectiva,
                       ${CAMPOS_ENRIQUECIDOS}
                FROM Ordenes o
                ${JOINS_ENRIQUECIDOS}
                WHERE o.AreaID = @Area
                  AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Pronto')
                  -- 'Recibido en Destino' / 'En transito': la orden ya se mandó completa (en camino o ya llegó) a su
                  -- próximo servicio (ver recibidasIntermedias en logisticsController) — tan
                  -- terminada como 'Pronto', no puede seguir "por trabajar" acá.
                  AND ISNULL(o.EstadoenArea, '') NOT IN ('Pronto', 'Control y Calidad', 'Recibido en Destino', 'En transito')
                  AND (o.EstadoDependencia IS NULL OR o.EstadoDependencia = 'OK')
                  AND ${SQL_TRANSFER_LLEGO}
                  AND NOT EXISTS (
                      SELECT 1 FROM ConfigRequisitosProduccion req
                      WHERE req.AreaID = @Area AND req.EsBloqueante = 1
                        AND NOT EXISTS (
                            SELECT 1 FROM OrdenCumplimientoRequisitos cum
                            WHERE cum.OrdenID = o.OrdenID AND cum.RequisitoID = req.RequisitoID
                              AND cum.Estado = 'CUMPLIDO'
                        )
                  )
                ORDER BY
                    CASE WHEN o.Prioridad = 'Urgente' THEN 0 ELSE 1 END,
                    ISNULL(o.FechaCompromiso, o.FechaEstimadaEntrega) ASC,
                    o.FechaIngreso ASC
            `;
        const r = await pool.request().input('Area', sql.VarChar(20), area).query(query);
        let data = r.recordset.map(enriquecerPreview);

        // [CAPACIDAD] Semáforo por orden (fase='trabajo' solamente): cruza con el mismo motor
        // que ya usa la pantalla de Planificación (planificacionController.calcularSituacion) —
        // reusado, no reimplementado. No bloqueante: si falla o el área no tiene capacidad
        // cargada, las filas quedan sin diaProyectado/semaforo y el front simplemente no los
        // muestra (mismo criterio que el resto de los campos opcionales de esta bandeja).
        if (fase !== 'control') {
            try {
                const { calcularSituacion } = require('./planificacionController');
                const hoyStr = new Date().toISOString().slice(0, 10);
                const situacion = await calcularSituacion(pool, area, { desde: hoyStr, dias: 90 });
                if (situacion.tieneCapacidad) {
                    const porOrden = new Map(situacion.ordenes.map(o => [o.OrdenID, o]));
                    data = data.map(o => {
                        const proy = porOrden.get(o.OrdenID);
                        return proy ? { ...o, diaProyectado: proy.diaProyectado, semaforo: proy.semaforo } : o;
                    });
                }
            } catch (semErr) {
                logger.error('[Bandeja] semáforo de capacidad falló (no bloqueante): ' + semErr.message);
            }
        }

        res.json({ success: true, data });
    } catch (err) {
        logger.error('[Bandeja] getEmbOrders: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// Pendientes SIN todos los requisitos cumplidos (o esperando que llegue el transfer
// encadenado — ver SQL_TRANSFER_LLEGO) — para que la bandeja también pueda mostrar "esto
// está trabado, falta X" en vez de solo lo que ya está listo. Cada orden cae en UN solo
// motivo (mutuamente excluyentes: si el transfer no llegó, esa es la razón que se muestra,
// aunque además le falte algún requisito con nombre).
exports.getEmbOrdersBloqueadas = async (req, res) => {
    const area = getArea(req);
    try {
        const pool = await getPool();
        const r = await pool.request().input('Area', sql.VarChar(20), area).query(`
            SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material,
                   o.FechaIngreso, o.NoDocERP,
                   STRING_AGG(req.Descripcion, ', ') AS FaltantePendiente
            FROM Ordenes o
            JOIN ConfigRequisitosProduccion req ON req.AreaID = @Area AND req.EsBloqueante = 1
            LEFT JOIN OrdenCumplimientoRequisitos cum
                ON cum.OrdenID = o.OrdenID AND cum.RequisitoID = req.RequisitoID AND cum.Estado = 'CUMPLIDO'
            WHERE o.AreaID = @Area
              AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Pronto')
              AND ISNULL(o.EstadoenArea, '') NOT IN ('Pronto', 'Recibido en Destino', 'En transito')
              AND (o.EstadoDependencia IS NULL OR o.EstadoDependencia = 'OK')
              AND ${SQL_TRANSFER_LLEGO}
              AND cum.OrdenID IS NULL
            GROUP BY o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material, o.FechaIngreso, o.NoDocERP

            UNION ALL

            -- Esperando que llegue el transfer encadenado (DTF o TPU, según corresponda) —
            -- prioridad sobre el motivo de arriba: si el material no llegó, no importa qué
            -- requisito con nombre falte, lo que hay que mostrar es "está en camino".
            SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material,
                   o.FechaIngreso, o.NoDocERP,
                   'Esperando que llegue el material (transfer DTF/TPU)' AS FaltantePendiente
            FROM Ordenes o
            WHERE o.AreaID = @Area
              AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Pronto')
              AND ISNULL(o.EstadoenArea, '') NOT IN ('Pronto', 'Recibido en Destino', 'En transito')
              AND (o.EstadoDependencia IS NULL OR o.EstadoDependencia = 'OK')
              AND NOT (${SQL_TRANSFER_LLEGO})

            UNION ALL

            -- [PRENDAS] Cualquier otro gate TODAVÍA activo (EstadoDependencia con algo que no
            -- sea NULL/OK) — antes esto dejaba la orden INVISIBLE en todas partes (ni en
            -- "trabajo" ni acá, que solo cubría EstadoDependencia NULL/OK) hasta que se
            -- liberara. Cubre 'ESPERANDO_IMPRESION' (esperando que termine su DTF/TPU) y
            -- 'ESPERANDO_RETIRO_WMS' (esperando que se confirme el retiro del depósito) — se ve
            -- desde que se crea el pedido, con el motivo real.
            SELECT o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.Material,
                   o.FechaIngreso, o.NoDocERP,
                   CASE o.EstadoDependencia
                       WHEN 'ESPERANDO_IMPRESION' THEN CONCAT('Esperando que termine ',
                           ISNULL(NULLIF(LTRIM(RTRIM(fuente.AreaID)), ''), 'su origen'), ' (', ISNULL(fuente.CodigoOrden, '—'), ')')
                       WHEN 'ESPERANDO_RETIRO_WMS' THEN 'Esperando que se confirme el retiro del depósito (WMS)'
                       -- Spec 39: eslabón de una cadena de reposición: se libera cuando llega la reposición del área anterior
                       WHEN 'ESPERANDO_REPOSICION' THEN CONCAT('Esperando la reposición del área anterior ',
                           ISNULL(NULLIF(LTRIM(RTRIM(fuente.AreaID)), ''), ''), ' (', ISNULL(fuente.CodigoOrden, '—'), ')')
                       ELSE CONCAT('Esperando: ', o.EstadoDependencia)
                   END AS FaltantePendiente
            FROM Ordenes o
            LEFT JOIN Ordenes fuente ON fuente.OrdenID = o.LiberaCuandoOrdenID
            WHERE o.AreaID = @Area
              AND o.Estado NOT IN ('Cancelado', 'Finalizado', 'Entregado', 'Pronto')
              AND ISNULL(o.EstadoenArea, '') NOT IN ('Pronto', 'Recibido en Destino', 'En transito')
              AND o.EstadoDependencia IS NOT NULL AND o.EstadoDependencia <> 'OK'

            ORDER BY FechaIngreso ASC
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        logger.error('[Bandeja] getEmbOrdersBloqueadas: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// Máquinas activas del área (mismo patrón correcto que ya usa productionKanbanController.js
// — NO el equiposController.getEquipos viejo, que apunta a una tabla "Maquinas" que no existe).
exports.getMaquinasEmb = async (req, res) => {
    const area = getArea(req);
    try {
        const pool = await getPool();
        const r = await pool.request().input('Area', sql.VarChar(20), area).query(`
            SELECT EquipoID, Nombre FROM ConfigEquipos WHERE AreaID = @Area AND Activo = 1 ORDER BY Nombre
        `);
        res.json({ success: true, data: r.recordset });
    } catch (err) {
        logger.error('[Bandeja] getMaquinasEmb: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.asignarMaquina = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const maquinaId = req.body?.maquinaId ? parseInt(req.body.maquinaId, 10) : null;
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    try {
        const pool = await getPool();
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('MID', sql.Int, maquinaId)
            .query('UPDATE Ordenes SET MaquinaID = @MID WHERE OrdenID = @OID');
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] asignarMaquina: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.asignarOperario = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const operarioId = req.body?.operarioId ? parseInt(req.body.operarioId, 10) : null;
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    try {
        const pool = await getPool();
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('UID', sql.Int, operarioId)
            .query('UPDATE Ordenes SET OperarioAsignadoID = @UID WHERE OrdenID = @OID');
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] asignarOperario: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// [BORDADO] Inicio/Pausa — igual que "Iniciar"/"Pausar" de un lote (MachineControl.jsx:
// Rollos.Estado 'En maquina'/'En cola'), pero por orden individual: acá se refleja en
// Ordenes.EstadoenArea con el mismo mecanismo central (changeOrderState) que usa el resto
// de las áreas, para que la Planilla y cualquier otra pantalla vean el estado real — no
// solo el flag EstadoTrabajoEmb interno de esta bandeja.
// "Fin" tampoco vive acá: es exports.finalizarTrabajo, más abajo (mueve a Control y
// Calidad — el cierre real con etiqueta/bulto pasa recién en la fase Control).
exports.setEstadoTrabajo = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const estado = req.body?.estado; // 'EN_PROCESO' | 'PAUSADO' | null (volver a "sin iniciar")
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    if (estado && !['EN_PROCESO', 'PAUSADO'].includes(estado)) {
        return res.status(400).json({ error: "estado debe ser 'EN_PROCESO', 'PAUSADO' o null." });
    }
    try {
        const pool = await getPool();

        // Iniciar exige máquina Y operario (pausar o desiniciar siempre se puede).
        if (estado === 'EN_PROCESO') {
            const falta = await faltaMaquinaUOperario(pool, ordenId);
            if (falta) return res.status(400).json({ error: falta });
        }

        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Est', sql.VarChar(20), estado || null)
            .query('UPDATE Ordenes SET EstadoTrabajoEmb = @Est WHERE OrdenID = @OID');

        // EstadoenArea real, mismo vocabulario que ConfigEstados ya usa en el resto del
        // sistema ('En Maquina' al iniciar; volver a 'Pendiente' al pausar o desiniciar).
        const estadoenArea = estado === 'EN_PROCESO' ? 'En Maquina' : 'Pendiente';
        await changeOrderState(pool, {
            target : { type: 'ORDER', id: ordenId },
            estado : estadoenArea,
            userObj: req.user || 'Sistema',
            detalle: estado === 'EN_PROCESO' ? 'Trabajo iniciado' : 'Trabajo pausado',
            io     : req.app.get('socketio'),
        });

        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] setEstadoTrabajo: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// Cuántas prendas de esta orden ya están bordadas — para el % de avance en la tarjeta.
// Rango válido: >= 1 y <= cantidad total (aflojado — con cantidades chicas, ej. 2, no
// había ningún valor entero posible entre 1 y el total en estricto "mayor/menor que").
exports.setProgreso = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const cantidad = parseFloat(req.body?.cantidadTerminada);
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    if (isNaN(cantidad)) return res.status(400).json({ error: 'Cantidad inválida.' });
    try {
        const pool = await getPool();
        // Cargar avance de TRABAJO exige máquina y operario asignados.
        const falta = await faltaMaquinaUOperario(pool, ordenId);
        if (falta) return res.status(400).json({ error: falta });

        const magnitud = await getMagnitudEfectiva(pool, ordenId);
        if (magnitud === null) return res.status(404).json({ error: 'Orden no encontrada.' });

        if (cantidad < 1) {
            return res.status(400).json({ error: 'La cantidad de bordados hechos debe ser al menos 1.' });
        }
        if (cantidad > magnitud) {
            return res.status(400).json({ error: `No puede superar la cantidad total de prendas (${magnitud}).` });
        }
        // Spec 39 (extensión "aprobar por tandas"): no se puede trabajar más de lo que
        // realmente llegó del área anterior del pedido (cuando esa área declara cantidad).
        const recibido = await getRecibidoDeAreaAnterior(pool, ordenId);
        if (recibido != null && cantidad > recibido) {
            return res.status(400).json({ error: `No podés trabajar más de lo que llegó del área anterior (${recibido}). Si te falta, reportá un faltante.` });
        }

        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Cant', sql.Float, cantidad)
            .query('UPDATE Ordenes SET CantidadTerminada = @Cant WHERE OrdenID = @OID');
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] setProgreso: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// [BORDADO] "Finalizar Tarea" de la Bandeja: el trabajo de bordar terminó, pasa a Control
// y Calidad (mismo verbo que usa Terminaciones — EcoUvFinishing fase 'trabajo'). Todavía
// NO genera etiqueta/bulto: eso se decide recién en Control, con la cantidad real de
// bultos que salen físicamente.
exports.finalizarTrabajo = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    try {
        const pool = await getPool();

        // No se finaliza lo que nunca se empezó: la orden tiene que haber pasado por
        // "Iniciar" (queda EN_PROCESO, o PAUSADO si se frenó en el medio). Sin eso, la
        // orden saltaría a Control sin registro de trabajo, máquina ni operario.
        const est = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query('SELECT EstadoTrabajoEmb FROM Ordenes WHERE OrdenID = @OID');
        if (!est.recordset.length) return res.status(404).json({ error: 'Orden no encontrada.' });
        if (!['EN_PROCESO', 'PAUSADO'].includes(est.recordset[0].EstadoTrabajoEmb)) {
            return res.status(400).json({ error: 'Primero iniciá el trabajo: no se puede finalizar una orden que nunca se empezó.' });
        }

        await changeOrderState(pool, {
            target : { type: 'ORDER', id: ordenId },
            estado : 'Control y Calidad',
            userObj: req.user || 'Sistema',
            detalle: 'Trabajo terminado — pasa a Control y Calidad',
            io     : req.app.get('socketio'),
        });
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] finalizarTrabajo: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// Cuántas prendas ya se controlaron — CONTADOR APARTE del de bordado (CantidadTerminada):
// una cosa es cuántas se van bordando, otra cuántas ya se verificaron en Control.
exports.setProgresoControl = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const cantidad = parseFloat(req.body?.cantidadControlada);
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    if (isNaN(cantidad)) return res.status(400).json({ error: 'Cantidad inválida.' });
    try {
        const pool = await getPool();
        const magnitud = await getMagnitudEfectiva(pool, ordenId);
        if (magnitud === null) return res.status(404).json({ error: 'Orden no encontrada.' });

        if (cantidad < 1) {
            return res.status(400).json({ error: 'La cantidad controlada debe ser al menos 1.' });
        }
        if (cantidad > magnitud) {
            return res.status(400).json({ error: `No puede superar la cantidad total de prendas (${magnitud}).` });
        }
        // Spec 39 (extensión "aprobar por tandas"): Control no puede declarar más prendas
        // controladas que las que Trabajo dice hechas — son contadores independientes, pero
        // Calidad no puede verificar lo que todavía no se produjo. Si Trabajo nunca se usó
        // para esta orden (NULL — ej. una -F que llega a Control por otro camino), no hay con
        // qué comparar y se deja pasar, igual que con "recibido" cuando la unidad no aplica.
        const trab = await pool.request().input('OID', sql.Int, ordenId)
            .query('SELECT CantidadTerminada FROM Ordenes WHERE OrdenID = @OID');
        const trabajado = trab.recordset[0]?.CantidadTerminada;
        if (trabajado != null && cantidad > parseFloat(trabajado)) {
            return res.status(400).json({ error: `No podés controlar más de lo que se trabajó (${trabajado}).` });
        }

        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Cant', sql.Float, cantidad)
            .query('UPDATE Ordenes SET CantidadControlada = @Cant WHERE OrdenID = @OID');
        res.json({ success: true });
    } catch (err) {
        logger.error('[Bandeja] setProgresoControl: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};

// [BORDADO] "Aprobar Control": gate por conteo controlado completo (mismo espíritu que el
// conteo de copias por archivo de Terminaciones), pasa la orden a Pronto y genera los N
// bultos/etiquetas elegidos por quien controla — sobre la MISMA orden de bordado (no la
// madre PRO): cada hermana rutea su propio bulto a su ProximoServicio (EST o DEPOSITO,
// definido al crearla — ver prendasOrdersController.js), así que el bulto tiene que
// seguir viajando con el código de bordado, no el de la prenda comprada.
exports.aprobarControl = async (req, res) => {
    const ordenId = parseInt(req.params.ordenId, 10);
    const cantBultos = Math.max(1, parseInt(req.body?.bultos, 10) || 1);
    // Spec 39 (RN-FLT extensión, 10-sep-2026): aprobar por TANDAS — mandar lo ya controlado
    // (ej. 10 de 30 prendas) sin terminar de controlar el resto, en áreas con envío parcial
    // habilitado. `parcial: true` en el body lo pide explícitamente; sin eso, el comportamiento
    // es EXACTAMENTE el de siempre (exige el 100% controlado).
    const quiereParcial = req.body?.parcial === true;
    if (!ordenId) return res.status(400).json({ error: 'ordenId inválido.' });
    try {
        const pool = await getPool();

        const ordRes = await pool.request()
            .input('OID', sql.Int, ordenId)
            .query(`
                SELECT o.CantidadControlada, o.CantidadAprobadaBultos, o.CantidadTerminada, o.AreaID, o.ProximoServicio, o.EstadoTrabajoEmb,
                       LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR(50)))) AS NoDoc,
                       CASE
                           -- [CORTE] el control cuenta PIEZAS de las tizadas medidas, no metros
                           WHEN (SELECT SUM(ao.Piezas * ISNULL(ao.Copias, 1)) FROM ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID AND ao.Piezas IS NOT NULL) > 0
                               THEN CAST((SELECT SUM(ao.Piezas * ISNULL(ao.Copias, 1)) FROM ArchivosOrden ao WHERE ao.OrdenID = o.OrdenID AND ao.Piezas IS NOT NULL) AS VARCHAR(50))
                           WHEN (SELECT SUM(ar.Piezas) FROM ArchivosReferencia ar WHERE ar.OrdenID = o.OrdenID AND ar.Piezas IS NOT NULL) > 0
                               THEN CAST((SELECT SUM(ar.Piezas) FROM ArchivosReferencia ar WHERE ar.OrdenID = o.OrdenID AND ar.Piezas IS NOT NULL) AS VARCHAR(50))
                           WHEN TRY_CAST(o.Magnitud AS FLOAT) > 0 THEN o.Magnitud
                           ELSE pro.Magnitud
                       END AS MagnitudEfectiva
                FROM Ordenes o
                ${APPLY_PRO_DE_LA_ORDEN}
                WHERE o.OrdenID = @OID
            `);
        if (!ordRes.recordset.length) return res.status(404).json({ error: 'Orden no encontrada.' });
        const ordenRow = ordRes.recordset[0];
        const magnitud = parseFloat(ordenRow.MagnitudEfectiva) || 0;
        const controlado = parseFloat(ordenRow.CantidadControlada) || 0;
        // NULL (nunca se usó Trabajo para esta orden — ej. una -F que llega a Control por otro
        // camino) no es lo mismo que 0: sin dato no hay con qué comparar, se deja pasar.
        const trabajadoRaw = ordenRow.CantidadTerminada;
        const trabajado = trabajadoRaw != null ? parseFloat(trabajadoRaw) : null;
        const aprobadoPrevio = parseFloat(ordenRow.CantidadAprobadaBultos) || 0;
        let esUltimaTanda = magnitud === 0 || controlado >= magnitud;
        // Lo que se puede aprobar: lo controlado, salvo que haya prendas en reposición (ver abajo).
        let controladoAprobable = controlado;

        // Candado defensivo: si quedó un Control mayor al Trabajo (dato guardado antes de esta
        // validación, o corregido a mano), no se aprueba hasta que se reconcilien los conteos.
        if (magnitud > 0 && trabajado != null && controlado > trabajado) {
            return res.status(400).json({ error: `El control (${controlado}) quedó por encima de lo trabajado (${trabajado}). Corregí el conteo de Control antes de aprobar — no puede ser mayor a lo que Trabajo marca hecho.` });
        }

        // [CONTROL] Con una reposición abierta (se reportó una falla y la prenda todavía no llegó)
        // no se puede aprobar el TOTAL: la orden no está completa. Sí se aprueban tandas de lo sano.
        if (esUltimaTanda) {
            const repAb = await pool.request().input('OID', sql.Int, ordenId).query(`
                SELECT COUNT(*) AS n, ISNULL(SUM(ISNULL(Cantidad, 0)), 0) AS cant FROM Reposiciones
                WHERE OrdenReportaID = @OID AND Estado IN ('ESPERANDO_INSUMO','BLOQUEADA','PENDIENTE','EN_PRODUCCION','ENVIADA')`);
            const nRep = repAb.recordset[0]?.n || 0;
            if (nRep > 0) {
                const cantRep = parseFloat(repAb.recordset[0]?.cant) || 0;
                if (!quiereParcial) {
                    return res.status(400).json({ error: `Esta orden tiene ${cantRep > 0 ? cantRep + ' prenda(s)' : 'una falla'} en reposición: todavía no se puede aprobar completa. Aprobá lo sano con "Aprobar esta tanda"; el resto se aprueba cuando llegue la reposición.` });
                }
                // Tanda con el conteo completo: se aprueban solo las sanas (total − en reposición).
                esUltimaTanda = false;
                if (magnitud > 0 && cantRep > 0) controladoAprobable = Math.max(0, Math.min(controlado, magnitud - cantRep));
            }
        }
        const nuevoEnEstaTanda = controladoAprobable - aprobadoPrevio;

        if (!esUltimaTanda && !quiereParcial) {
            return res.status(400).json({ error: `Controlaste ${controlado} de ${magnitud} prenda(s): completá el conteo antes de aprobar.` });
        }
        if (!esUltimaTanda) {
            const libro = require('../services/libroEntregasService');
            const areaE = (ordenRow.AreaID || '').trim().toUpperCase();
            if (!(await libro.areasConParcial(pool)).includes(areaE)) {
                return res.status(400).json({ error: `Aprobar por tandas no está habilitado para ${areaE}. Completá el conteo (${controlado}/${magnitud}) para aprobar todo junto.` });
            }
            if (nuevoEnEstaTanda <= 0) {
                return res.status(400).json({ error: 'Ya aprobaste todo lo que controlaste hasta ahora. Contá más prendas para aprobar una tanda nueva.' });
            }
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        let reposicionCerrada = null;
        try {
            if (esUltimaTanda) {
                await changeOrderState(tx, {
                    target : { type: 'ORDER', id: ordenId },
                    estado : 'Pronto',
                    userObj: req.user || 'Sistema',
                    detalle: aprobadoPrevio > 0 ? `Control aprobado (última tanda: ${nuevoEnEstaTanda} de ${magnitud}, ya se habían aprobado ${aprobadoPrevio})` : 'Control aprobado',
                    io     : req.app.get('socketio'),
                });
                // Spec 39: si es una orden de falla con reposición registrada, decidir si su material se
                // incorpora a la madre (misma área, madre sin envío parcial → CERRADA) o viaja como complemento.
                try {
                    const reposiciones = require('../services/reposicionesService');
                    reposicionCerrada = await reposiciones.alTerminarOrdenFalla(tx, ordenId, req.user || 'Sistema', req.app.get('socketio'));
                } catch (eRep) { logger.warn('[Bandeja] aprobarControl reposiciones: ' + eRep.message); }
            } else {
                // Tanda parcial: NO se marca Pronto. Vuelve al estado de trabajo (mismo
                // vocabulario que setEstadoTrabajo) para seguir controlando/produciendo el resto.
                // [CONTROL] Si Trabajo ya terminó todas las prendas, el resto solo falta controlarlo:
                // la orden se queda en Control y Calidad (no vuelve a la Bandeja de trabajo).
                const yaTrabajadoTodo = magnitud > 0 && ((trabajado != null && trabajado >= magnitud) || controlado >= magnitud);
                const estadoenArea = yaTrabajadoTodo ? 'Control y Calidad' : ordenRow.EstadoTrabajoEmb === 'EN_PROCESO' ? 'En Maquina' : 'Pendiente';
                await changeOrderState(tx, {
                    target : { type: 'ORDER', id: ordenId },
                    estado : estadoenArea,
                    userObj: req.user || 'Sistema',
                    detalle: `Tanda aprobada: ${nuevoEnEstaTanda} de ${magnitud} (van ${controladoAprobable} aprobables de ${controlado} controladas). ${yaTrabajadoTodo ? 'Sigue en Control por el resto.' : 'Sigue en producción por el resto.'}`,
                    io     : req.app.get('socketio'),
                });
            }
            await new sql.Request(tx).input('OID', sql.Int, ordenId).input('Ap', sql.Decimal(12, 2), controladoAprobable)
                .query('UPDATE Ordenes SET CantidadAprobadaBultos = @Ap WHERE OrdenID = @OID');
            await tx.commit();
        } catch (e) { await tx.rollback(); throw e; }
        // Reposición cerrada en la misma área: el material se incorpora a la madre, no se etiqueta aparte.
        if (reposicionCerrada && reposicionCerrada.viaja === false) {
            return res.json({ success: true, totalBultos: 0, esperandoHermanaEst: false, areaID: ordenRow.AreaID, proximoServicio: ordenRow.ProximoServicio || null,
                              reposicion: { estado: 'CERRADA', madre: reposicionCerrada.CodigoMadre }, message: `Reposición terminada: su material se incorpora a la orden ${reposicionCerrada.CodigoMadre}. No lleva bultos propios.` });
        }

        // [PRENDAS] Estampado puede tener varias hermanas para el MISMO pedido (una por
        // cada DTF/TPU activo), todas trabajando sobre la MISMA prenda física — si cada
        // una generara su propio bulto "producto terminado" al aprobarse, quedarían N
        // sets de bultos para una sola prenda. Mientras quede alguna hermana EST sin
        // aprobar, esta NO genera bulto: el bulto final lo genera la ÚLTIMA en aprobarse.
        // Solo aplica a la aprobación FINAL: una tanda parcial siempre genera su bulto,
        // porque es material en camino, no el consolidado final de la prenda.
        let esperandoHermanaEst = false;
        if (esUltimaTanda && (ordenRow.AreaID || '').trim().toUpperCase() === 'EST' && ordenRow.NoDoc) {
            const sibRes = await pool.request()
                .input('ND', sql.VarChar, ordenRow.NoDoc)
                .input('OID', sql.Int, ordenId)
                .query(`
                    SELECT COUNT(*) AS Pendientes
                    FROM Ordenes
                    WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(50)))) = @ND
                      AND AreaID = 'EST' AND OrdenID <> @OID
                      AND (EstadoenArea IS NULL OR UPPER(LTRIM(RTRIM(EstadoenArea))) NOT IN ('PRONTO', 'RECIBIDO EN DESTINO'))
                      AND (Estado IS NULL OR UPPER(LTRIM(RTRIM(Estado))) <> 'CANCELADO')
                `);
            esperandoHermanaEst = (sibRes.recordset[0]?.Pendientes || 0) > 0;
        }

        let totalBultos = 0;
        if (!esperandoHermanaEst) {
            try {
                const LabelGenerationService = require('../services/LabelGenerationService');
                // Tipo de bulto según destino real (igual criterio que addOneBulto): si el
                // próximo paso NO es Depósito (ej. Bordado que todavía va a Estampado), es
                // material EN_PROCESO, no producto terminado — si no, nunca deja de "esperar
                // bultos" en el gate de Depósito porque ese bulto jamás llega ahí. Una tanda
                // parcial NUNCA es PROD_TERMINADO aunque el próximo paso sea Depósito: todavía
                // queda producción de esta misma orden sin controlar (invariante RN-FLT.02).
                const prox = (ordenRow.ProximoServicio || 'DEPOSITO').trim().toUpperCase();
                const esUltimoServicio = esUltimaTanda && (prox.includes('DEPOSITO') || prox === '');
                // Sin `ubicacion` explícita: addBultosTerminados usa o.AreaID por default —
                // así el bulto queda en la ubicación real de la orden (EMB o EST), no fija.
                const lr = await LabelGenerationService.addBultosTerminados(
                    ordenId, cantBultos, req.user?.id || 1, req.user?.usuario || 'Sistema',
                    { tipoBulto: esUltimoServicio ? 'PROD_TERMINADO' : 'EN_PROCESO' }
                );
                if (lr.success) totalBultos = lr.totalBultos;
                else logger.warn('[Bandeja] aprobarControl: no se generó la etiqueta: ' + lr.error);
            } catch (eLab) {
                logger.warn('[Bandeja] aprobarControl: error generando etiquetas: ' + eLab.message);
            }
        } else {
            logger.info(`[Bandeja] aprobarControl: orden ${ordenId} aprobada; bulto final pendiente de otra hermana EST del mismo pedido.`);
        }

        const message = !esUltimaTanda
            ? `Tanda aprobada: ${totalBultos} bulto(s) con ${nuevoEnEstaTanda} de ${magnitud} prenda(s). Quedan ${magnitud - controladoAprobable} por aprobar; ${magnitud > 0 && ((trabajado != null && trabajado >= magnitud) || controlado >= magnitud) ? 'la orden sigue en Control.' : 'la orden sigue en producción.'}`
            : undefined;
        res.json({
            success: true, totalBultos, esperandoHermanaEst, parcial: !esUltimaTanda,
            pendiente: !esUltimaTanda ? (magnitud - controladoAprobable) : 0,
            areaID: ordenRow.AreaID,
            proximoServicio: ordenRow.ProximoServicio || null,
            message,
        });
    } catch (err) {
        logger.error('[Bandeja] aprobarControl: ' + err.message);
        res.status(500).json({ error: err.message });
    }
};
